import * as THREE from 'three';
import { BonusData, BonusType } from '../types/game';
import { CrowdManager } from './CrowdManager';
import { ParticleSystem } from './ParticleSystem';
import { soundEngine } from '../audio/SoundEngine';
import { eventBus } from '../core/EventBus';
import { stateManager } from '../core/StateManager';
import { lerp } from '../utils/math';

interface BonusVisual {
  data: BonusData;
  group: THREE.Group;
  core: THREE.Mesh;
  glow: THREE.Mesh;
  ring: THREE.Mesh;
  spinTimer: number;
}

// Цвета бонусов по типу
const BONUS_COLORS: Record<BonusType, number> = {
  add_mobs: 0x10b981, // изумрудный — +мобы
  heal: 0x34d399,      // светло-зелёный — лечение
  adrenaline: 0xfacc15, // жёлтый — гипер-режим
  coins: 0xf59e0b,     // янтарный — монеты
};

// Символ на сфере (Canvas2D текстура, zero-asset)
function createBonusTexture(color: number, label: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;

  // Радиальный градиент подложки
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 62);
  const c = new THREE.Color(color);
  g.addColorStop(0, `rgba(${(c.r * 255) | 0}, ${(c.g * 255) | 0}, ${(c.b * 255) | 0}, 0.9)`);
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);

  if (label) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 44px Orbitron, sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillText(label, 64, 64);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

export class BonusManager {
  private static readonly PRUNE_MARGIN = 40;
  // Окно анимации бонусов: впереди толпы ~45м, позади ~30м (камера на leaderZ-16,
  // видимое окно ~45м вперёд/30м назад). Бонусы вне окна не анимируем (0-GC).
  private static readonly BONUS_ANIM_CULL_AHEAD = 45;
  private static readonly BONUS_ANIM_CULL_BACK = 30;
  private scene: THREE.Scene;
  private bonuses: BonusVisual[] = [];
  private coreGeo: THREE.SphereGeometry;
  private ringGeo: THREE.TorusGeometry;
  private glowGeo: THREE.SphereGeometry;
  private sharedTextures: Map<string, THREE.CanvasTexture> = new Map();
  private spinTimer: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.coreGeo = new THREE.SphereGeometry(0.45, 16, 16);
    this.ringGeo = new THREE.TorusGeometry(0.75, 0.06, 8, 24);
    this.glowGeo = new THREE.SphereGeometry(0.7, 16, 16);
  }

  private textureFor(type: BonusType, label: string): THREE.CanvasTexture {
    const key = `${type}:${label}`;
    let tex = this.sharedTextures.get(key);
    if (!tex) {
      tex = createBonusTexture(BONUS_COLORS[type], label);
      this.sharedTextures.set(key, tex);
    }
    return tex;
  }

  private labelFor(type: BonusType): string {
    switch (type) {
      case 'add_mobs': return '+';
      case 'heal': return '♥';
      case 'adrenaline': return '⚡';
      case 'coins': return '$';
    }
  }

  private buildBonus(data: BonusData): BonusVisual {
    const group = new THREE.Group();
    group.position.set(data.x, data.y, data.z);
    const color = BONUS_COLORS[data.type];

    // Ядро — светящаяся сфера с иконкой
    const core = new THREE.Mesh(
      this.coreGeo,
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0.95,
      })
    );
    group.add(core);

    // Внешняя «звезда»-глоу (полупрозрачная оболочка)
    const glow = new THREE.Mesh(
      this.glowGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22 })
    );
    group.add(glow);

    // Вращающееся кольцо
    const ring = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    // Иконка на поверхности ядра
    const iconMat = new THREE.MeshBasicMaterial({
      map: this.textureFor(data.type, this.labelFor(data.type)),
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const icon = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), iconMat);
    icon.rotation.y = Math.PI;
    core.add(icon);

    this.scene.add(group);
    return { data, group, core, glow, ring, spinTimer: Math.random() * Math.PI * 2 };
  }

  public initBonuses(data: BonusData[]): void {
    this.clear();
    data.forEach((b) => this.bonuses.push(this.buildBonus(b)));
  }

  /** Добавляет бонусы к уже существующим — используется endless-режимом. */
  public appendBonuses(data: BonusData[]): void {
    data.forEach((b) => this.bonuses.push(this.buildBonus(b)));
  }

  public update(dt: number, crowd: CrowdManager, particles: ParticleSystem): void {
    this.spinTimer += dt;
    const leaderX = crowd.leaderX;
    const leaderZ = crowd.leaderZ;

    for (const bv of this.bonuses) {
      const b = bv.data;
      if (b.collected) continue;

      // Spatial culling: бонусы вне зоны видимости (далеко впереди/позади толпы)
      // не анимируем — вращение/покачивание/пульсация и обновление матриц Three.js
      // бесполезны для невидимых объектов. Коллекция и магнит работают только вблизи
      // (dz < 2.2 / 16), поэтому пропуск далёких не влияет на геймплей.
      const bdz = b.z - leaderZ;
      if (bdz > BonusManager.BONUS_ANIM_CULL_AHEAD || bdz < -BonusManager.BONUS_ANIM_CULL_BACK) continue;

      // Магнитное притяжение бонусов к центру толпы при активном гипер-режиме
      if (crowd.isHyperMode) {
        const bdx = b.x - leaderX;
        if (Math.abs(bdz) < 16 && Math.abs(bdx) < 9) {
          const t = Math.min(1.0, 10.0 * dt);
          b.x = lerp(b.x, leaderX, t);
          b.z = lerp(b.z, leaderZ, t);
          bv.group.position.x = b.x;
          bv.group.position.z = b.z;
        }
      }

      // Плавное вращение и покачивание
      bv.spinTimer += dt * 2.5;
      bv.group.rotation.y = bv.spinTimer * 0.7;
      bv.group.position.y = b.y + Math.sin(this.spinTimer * 2 + b.z) * 0.15;
      bv.ring.rotation.x = Math.PI / 2 + bv.spinTimer * 0.5;

      // Пульсация свечения
      const pulse = 1.0 + Math.sin(this.spinTimer * 4 + bv.spinTimer) * 0.15;
      bv.glow.scale.setScalar(pulse);

      // Коллекция лидером толпы. Шеренга (wide) расширяет зону захвата бонусов по X.
      const dx = b.x - leaderX;
      const dz = b.z - leaderZ;
      const reachX = crowd.formation === 'wide' ? 5.5 : 3.5;
      if (Math.abs(dz) < 2.2 && Math.abs(dx) < reachX) {
        b.collected = true;
        this.scene.remove(bv.group);
        this.applyEffect(b, crowd, particles);
      }
    }

    this.prune(leaderZ);
  }

  /**
   * Удаляет собранные и оставшиеся позади бонусы (endless-режим, 0-GC compaction).
   */
  public prune(leaderZ: number): void {
    const threshold = leaderZ - BonusManager.PRUNE_MARGIN;
    let writeIdx = 0;
    for (let i = 0; i < this.bonuses.length; i++) {
      const bv = this.bonuses[i];
      if (bv.data.collected || bv.data.z < threshold) {
        if (!bv.data.collected) {
          this.scene.remove(bv.group);
        }
        bv.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.Material | THREE.Material[];
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
            else mat?.dispose();
            if (child.geometry && child.geometry !== this.coreGeo && child.geometry !== this.ringGeo) {
              child.geometry.dispose();
            }
          }
        });
      } else {
        this.bonuses[writeIdx++] = bv;
      }
    }
    this.bonuses.length = writeIdx;
  }

  private applyEffect(b: BonusData, crowd: CrowdManager, particles: ParticleSystem): void {
    const color = BONUS_COLORS[b.type];
    particles.emitBurst(b.x, b.y, b.z, 22, color, 5.0);

    switch (b.type) {
      case 'add_mobs': {
        const added = crowd.addMobsNear(b.value, b.x, b.z);
        if (added > 0) {
          soundEngine.playSound('gate_pass_positive');
          eventBus.emit('bonusCollected', { type: b.type, value: added, x: b.x, z: b.z });
        }
        break;
      }
      case 'heal': {
        const healed = crowd.healAll(b.value);
        if (healed > 0) {
          // Звук 'heal' уже играет healAll() (CrowdManager) — здесь только событие,
          // иначе подбор лечащего бонуса даёт сдвоенный клип.
          eventBus.emit('bonusCollected', { type: b.type, value: healed, x: b.x, z: b.z });
        }
        break;
      }
      case 'adrenaline': {
        crowd.activateHyperMode(b.value);
        soundEngine.playSound('adrenaline_activate');
        eventBus.emit('bonusCollected', { type: b.type, value: b.value, x: b.x, z: b.z });
        break;
      }
      case 'coins': {
        stateManager.runAddCoins(b.value);
        // Бонус-монеты всегда кристальные: звон + золотой burst.
        soundEngine.playSound('gem_pickup');
        particles.emitBurst(b.x, 1.0, b.z, 28, 0xf59e0b, 5.5);
        eventBus.emit('coinCollected', { value: b.value, x: b.x, z: b.z, tier: 2 });
        break;
      }
    }
  }

  public clear(): void {
    this.bonuses.forEach((bv) => {
      this.scene.remove(bv.group);
      bv.group.children.forEach((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat.dispose();
          if (child.geometry && child !== bv.core && child !== bv.ring && child !== bv.glow) child.geometry.dispose();
        }
      });
    });
    this.bonuses = [];
    this.sharedTextures.forEach((t) => t.dispose());
    this.sharedTextures.clear();
  }

  public dispose(): void {
    this.clear();
    this.coreGeo.dispose();
    this.ringGeo.dispose();
    this.glowGeo.dispose();
  }
}
