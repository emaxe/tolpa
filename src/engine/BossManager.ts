import * as THREE from 'three';
import { BossAttack, BossData } from '../types/game';
import {
  createBossMesh,
  createBossLaserBeamMesh,
  createBossLaserTelegraphMesh,
} from '../utils/proceduralMeshes';
import { CrowdManager } from './CrowdManager';
import { ParticleSystem } from './ParticleSystem';
import { soundEngine } from '../audio/SoundEngine';
import { eventBus } from '../core/EventBus';
import { stateManager } from '../core/StateManager';

// Пауза между атаками босса, масштабируемая по уровню (tier = level/10, 1..5).
// L10 — заметная пауза (обучающий ритм), к L50 почти исчезает (эскалация).
const BOSS_BASE_ATTACK_COOLDOWN = 2.5; // пауза на L10, сек
const BOSS_COOLDOWN_PER_TIER = 0.55; // уменьшение паузы на каждый тир
const BOSS_MIN_ATTACK_COOLDOWN = 0.3; // пол L50 — почти без паузы

export class BossManager {
  private scene: THREE.Scene;
  public bossData: BossData | null = null;
  public bossMesh: THREE.Group | null = null;
  private telegraphMesh: THREE.Mesh | null = null;
  private laserBeamMesh: THREE.Mesh | null = null;
  private laserTelegraphMesh: THREE.Mesh | null = null;
  private attackTimer: number = 0;
  private currentAttackIndex: number = 0;
  private lastAttackIndex: number = -1;
  private isAttacking: boolean = false;
  public isDefeated: boolean = false;
  private isDefeatCollapsing: boolean = false;
  private defeatTimer: number = 0;
  private defeatBurstTimer: number = 0;
  private hitFlashTimer: number = 0;
  private cachedMaterials: { mat: THREE.MeshStandardMaterial; baseEmissive: number }[] = [];
  private bossArenaZ: number = 0;
  public isActive(): boolean { return !!this.bossData && !this.isDefeated && !this.isDefeatCollapsing; }
  public getArenaZ(): number { return this.bossArenaZ; }
  private retaliationTimer: number = 0;
  // Телеграф возмездия: за ~0.45с до удара босс подаёт визуальный сигнал (янтарное
  // кольцо-«зона поражения»), чтобы игрок успел перестроить толпу в безопасную
  // формацию. Флаг гейтит однократный эмит VFX внутри окна предупреждения.
  private retaliationTelegraphed: boolean = false;
  // Окно предупреждения перед ударом возмездия (сек).
  private static readonly RETALIATION_TELEGRAPH_TIME = 0.45;
  // Накопитель тиков урона для атаки "minions" (рой мелких тварей грызёт толпу
  // в течение всей длительности атаки, а не одним ударом как slam/laser).
  private minionTickAccum: number = 0;
  // Накопитель фидбек-фикций босс-урона. Меле-урон толпы приходит каждый кадр (60 Гц);
  // без этого накопителя soundEngine boss_hit + частицы + eventBus.emit('bossDamaged')
  // спамятся 60 раз/сек, форсируя тяжёлый ре-рендер HUD на 60 Гц. Гейтим фидбек ~6 Гц.
  private hitFxAccum: number = 0;
  // Накопитель урона между фидбек-тиками (~6 Гц). damage из takeDamage приходит
  // каждый кадр (amount*dt); без накопителя floating number показывал бы урон
  // за один кадр, а не за период. Суммируем и сбрасываем при каждом эмите.
  private hitDamageAccum: number = 0;
  // Пауза между атаками (attack cooldown), масштабируемая по уровню босса.
  // Раньше босс бил непрерывно (telegraph → attack → сразу следующий telegraph)
  // на всех уровнях — не было окна передышки для перестроения толпы. Теперь
  // между атаками есть пауза: на L10 заметная (новичок успевает перестроиться),
  // к L50 почти исчезает (эскалация сложности).
  private isCoolingDown: boolean = false;
  private attackCooldown: number = 0;
  private attackInterval: number = 2.5;
  private bossLevel: number = 10;
  // Атака "shield" (энергетический купол): пока активен, босс блокирует урон толпы.
  private isShielded: boolean = false;
  private shieldMesh: THREE.Mesh | null = null;
  private particles: ParticleSystem;
  // Драматичное появление босса при первом входе толпы в арену (distanceToArena <= 35).
  // Раньше босс молча активировал боевой цикл — звук boss_roar играл на старте уровня
  // за полминуты до контакта, а в момент сближения не было никакого визуального события.
  // Теперь: ударная волна + световой столб + тряска + рев — однократный "boss appear" VFX.
  private arenaEntered: boolean = false;

  constructor(scene: THREE.Scene, particles: ParticleSystem) {
    this.scene = scene;
    this.particles = particles;
  }

  public initBoss(bossData: BossData, arenaZ: number, level: number = 10): void {
    this.clear();
    this.bossData = { ...bossData, hp: bossData.maxHp };
    this.bossArenaZ = arenaZ;
    this.isDefeated = false;
    this.isDefeatCollapsing = false;
    this.defeatTimer = 0;
    this.defeatBurstTimer = 0;
    this.hitFlashTimer = 0;
    this.attackTimer = 0;
    this.currentAttackIndex = this.selectNextAttackIndex();
    this.lastAttackIndex = -1;
    this.retaliationTimer = 1.0;
    this.retaliationTelegraphed = false;
    this.bossLevel = level;
    this.attackInterval = this.computeAttackInterval(level);
    // Грейс-пауза перед первой атакой: даёт игроку время перестроить толпу
    // после входа в арену (distanceToArena <= 35), а не получать удар сразу.
    this.isCoolingDown = true;
    this.attackCooldown = 1.0 + this.attackInterval;

    // Create 3D Mesh
    this.bossMesh = createBossMesh(this.bossData);
    this.bossMesh.position.set(0, 0, arenaZ);
    this.scene.add(this.bossMesh);

    // Кэшируем Standard-материалы для 0-GC хит-флэша при уроне
    this.cachedMaterials = [];
    this.bossMesh.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          if ('emissiveIntensity' in m) {
            this.cachedMaterials.push({
              mat: m as THREE.MeshStandardMaterial,
              baseEmissive: (m as THREE.MeshStandardMaterial).emissiveIntensity ?? 0,
            });
          }
        });
      }
    });

    // Create Telegraph Ring Mesh (для круговых атак / slam)
    const teleGeo = new THREE.RingGeometry(0.1, 4.0, 32);
    const teleMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
    });
    this.telegraphMesh = new THREE.Mesh(teleGeo, teleMat);
    this.telegraphMesh.rotation.x = -Math.PI / 2;
    this.telegraphMesh.position.set(0, 0.05, arenaZ - 5);
    this.telegraphMesh.visible = false;
    this.scene.add(this.telegraphMesh);

    // Create Laser Telegraph & Laser Beam Meshes (0-GC: живут весь бой)
    this.laserTelegraphMesh = createBossLaserTelegraphMesh(arenaZ);
    this.laserTelegraphMesh.visible = false;
    this.scene.add(this.laserTelegraphMesh);

    this.laserBeamMesh = createBossLaserBeamMesh(arenaZ);
    this.laserBeamMesh.visible = false;
    this.scene.add(this.laserBeamMesh);

    soundEngine.playSound('boss_roar');
    soundEngine.playMusic('boss_battle');
  }

  /** Рассчитывает паузу между атаками по уровню босса (tier = level/10, 1..5).
   *  L10 — заметная пауза (обучающий ритм), к L50 почти исчезает (эскалация). */
  private computeAttackInterval(level: number): number {
    const tier = Math.max(1, Math.floor(level / 10));
    return Math.max(
      BOSS_MIN_ATTACK_COOLDOWN,
      BOSS_BASE_ATTACK_COOLDOWN - (tier - 1) * BOSS_COOLDOWN_PER_TIER
    );
  }

  public update(
    dt: number,
    crowd: CrowdManager,
    particles: ParticleSystem
  ): void {
    if (!this.bossData || !this.bossMesh) return;

    // Фаза гибели (1.0-секундный коллапс корпуса)
    if (this.isDefeatCollapsing) {
      this.defeatTimer += dt;
      this.defeatBurstTimer += dt;

      // Оседание корпуса и опрокидывание назад
      this.bossMesh.position.y -= dt * 2.5;
      this.bossMesh.rotation.x -= dt * 1.4;
      // Лёгкая предсмертная вибрация по X
      this.bossMesh.position.x = (Math.random() - 0.5) * 0.15;

      // Каскадные вспышки взрывов каждые 0.15с
      if (this.defeatBurstTimer >= 0.15) {
        this.defeatBurstTimer = 0;
        const rx = (Math.random() - 0.5) * 3.0;
        const ry = 1.0 + Math.random() * 3.0;
        const rz = this.bossArenaZ + (Math.random() - 0.5) * 2.0;
        const color = Math.random() > 0.5 ? 0xfacc15 : 0xef4444;
        particles.emitBurst(rx, ry, rz, 25, color, 6.0);
        soundEngine.playSound('boss_hit');
        eventBus.emit('screenShake', { intensity: 0.25 });
      }

      // По истечении 1.0с — окончательное скрытие меша и эмит события bossDefeated
      if (this.defeatTimer >= 1.0) {
        this.isDefeatCollapsing = false;
        particles.emitBurst(0, 2.5, this.bossArenaZ, 80, 0xfacc15, 10.0);
        particles.emitShockwave(0, this.bossArenaZ, 0xfacc15);
        this.scene.remove(this.bossMesh);
        if (this.telegraphMesh) this.scene.remove(this.telegraphMesh);
        if (this.laserTelegraphMesh) this.scene.remove(this.laserTelegraphMesh);
        if (this.laserBeamMesh) this.scene.remove(this.laserBeamMesh);
        stateManager.runRecordBossKill(500, 15);
        eventBus.emit('bossDefeated', { boss: this.bossData });
      }
      return;
    }

    if (this.isDefeated) return;

    const crowdZ = crowd.leaderZ;
    const distanceToArena = this.bossArenaZ - crowdZ;

    // Boss breathing / idle animation
    this.bossMesh.position.y = Math.sin(Date.now() * 0.003) * 0.2;
    this.bossMesh.position.x = 0;

    // Хит-флэш реакция на материалах корпуса (0.08с)
    if (this.hitFlashTimer > 0) {
      this.hitFlashTimer -= dt;
      const isFlashing = this.hitFlashTimer > 0;
      const boost = isFlashing ? 1.5 : 0;
      for (let i = 0; i < this.cachedMaterials.length; i++) {
        const item = this.cachedMaterials[i];
        item.mat.emissiveIntensity = item.baseEmissive + boost;
      }
    }

    // Only engage battle when crowd is within 35 units of boss arena
    if (distanceToArena > 35) return;

    // Драматичное появление босса: ОДИН раз при первом входе толпы в зону арены.
    // Ударная волна + световой столб + тряска экрана + рев — игрок видит "босс проснулся".
    if (!this.arenaEntered) {
      this.arenaEntered = true;
      this.particles.emitShockwave(0, this.bossArenaZ, 0xef4444);
      this.particles.emitLightPillar(0, this.bossArenaZ, 40, 0xff4444);
      this.particles.emitBurst(0, 2.0, this.bossArenaZ, 30, 0xef4444, 7.0);
      soundEngine.playSound('boss_roar');
      eventBus.emit('screenShake', { intensity: 0.5 });
    }

    // 1. Attack cycle (с паузой между атаками, масштабируемой по уровню босса).
    //    Во время паузы (isCoolingDown) attackTimer НЕ инкрементируется — иначе
    //    первый кадр после паузы мгновенно завершил бы telegraph следующей атаки.
    if (this.isCoolingDown) {
      this.attackCooldown -= dt;
      if (this.attackCooldown <= 0) {
        this.isCoolingDown = false;
        this.attackTimer = 0;
      }
      // Скрываем все телеграфы и луч во время кулдауна
      if (this.telegraphMesh) {
        this.telegraphMesh.visible = false;
        (this.telegraphMesh.material as THREE.MeshBasicMaterial).opacity = 0;
      }
      if (this.laserTelegraphMesh) {
        this.laserTelegraphMesh.visible = false;
        (this.laserTelegraphMesh.material as THREE.MeshBasicMaterial).opacity = 0;
      }
      if (this.laserBeamMesh) {
        this.laserBeamMesh.visible = false;
      }
    } else {
      this.attackTimer += dt;
      const attacks = this.bossData.attacks;
      const currentAttack = attacks[this.currentAttackIndex];

      if (!this.isAttacking) {
        // Telegraph phase
        const prog = Math.min(1.0, this.attackTimer / currentAttack.telegraphTime);
        if (currentAttack.type === 'laser') {
          if (this.telegraphMesh) {
            this.telegraphMesh.visible = false;
            (this.telegraphMesh.material as THREE.MeshBasicMaterial).opacity = 0;
          }
          if (this.laserTelegraphMesh) {
            this.laserTelegraphMesh.visible = true;
            const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.02);
            const alpha = Math.min(0.75, prog * 0.5 + pulse * 0.25);
            (this.laserTelegraphMesh.material as THREE.MeshBasicMaterial).opacity = alpha;
            const scaleX = 1.0 + Math.sin(Date.now() * 0.025) * 0.15;
            this.laserTelegraphMesh.scale.set(scaleX, 1.0, 1.0);
          }
        } else {
          if (this.laserTelegraphMesh) {
            this.laserTelegraphMesh.visible = false;
            (this.laserTelegraphMesh.material as THREE.MeshBasicMaterial).opacity = 0;
          }
          if (this.telegraphMesh) {
            this.telegraphMesh.visible = true;
            (this.telegraphMesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.7, prog * 0.7);
            this.telegraphMesh.scale.set(prog, prog, prog);
          }
        }

        if (this.attackTimer >= currentAttack.telegraphTime) {
          this.isAttacking = true;
          this.attackTimer = 0;
          if (this.telegraphMesh) {
            this.telegraphMesh.visible = false;
            (this.telegraphMesh.material as THREE.MeshBasicMaterial).opacity = 0;
          }
          if (this.laserTelegraphMesh) {
            this.laserTelegraphMesh.visible = false;
            (this.laserTelegraphMesh.material as THREE.MeshBasicMaterial).opacity = 0;
          }
          this.executeBossAttack(currentAttack, crowd, particles);
        }
      } else {
        // Attack execution phase
        if (currentAttack.type === 'laser' && this.laserBeamMesh) {
          this.laserBeamMesh.visible = true;
          const attackDur = Math.max(0.1, currentAttack.duration || 1.5);
          const p = Math.min(1.0, this.attackTimer / attackDur);

          // Анимация толщины луча: всплеск (0..0.15) -> удержание (0.15..0.75) -> затухание (0.75..1.0)
          let thickness = 1.0;
          if (p < 0.15) {
            thickness = (p / 0.15) * 1.35;
          } else if (p < 0.75) {
            thickness = 1.0 + Math.sin(Date.now() * 0.04) * 0.12;
          } else {
            thickness = Math.max(0.01, 1.0 - (p - 0.75) / 0.25);
          }

          // Вибрация по X/Y
          const jitterX = (Math.random() - 0.5) * 0.12;
          const jitterY = (Math.random() - 0.5) * 0.12;
          this.laserBeamMesh.position.set(jitterX, 1.8 + jitterY, this.bossArenaZ - 14);
          this.laserBeamMesh.scale.set(thickness, thickness, 1.0);
          (this.laserBeamMesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, thickness * 0.9);

          // Искры на стыке луча с зоной поражения
          if (Math.random() < 0.3) {
            particles.emitBurst(
              (Math.random() - 0.5) * 2.5,
              0.5 + Math.random() * 1.5,
              this.bossArenaZ - 6 - Math.random() * 12,
              4,
              0x00f0ff,
              3.0
            );
          }
        }

        // Рой мелких тварей наносит урон тиками на протяжении всей длительности атаки.
        this.tickMinionDamage(dt, crowd, particles);
        if (this.attackTimer >= currentAttack.duration) {
          this.isAttacking = false;
          this.attackTimer = 0;
          this.lastAttackIndex = this.currentAttackIndex;
          this.currentAttackIndex = this.selectNextAttackIndex();
          if (this.laserBeamMesh) {
            this.laserBeamMesh.visible = false;
            this.laserBeamMesh.position.set(0, 1.8, this.bossArenaZ - 14);
            this.laserBeamMesh.scale.set(1, 1, 1);
          }
          // Атака "shield": по завершении купол спадает, босс снова уязвим.
          if (this.isShielded) {
            this.setShielded(false);
          }
          // Начинаем паузу перед следующей атакой.
          this.isCoolingDown = true;
          this.attackCooldown = this.attackInterval;
          if (this.telegraphMesh) {
            this.telegraphMesh.visible = false;
            (this.telegraphMesh.material as THREE.MeshBasicMaterial).opacity = 0;
          }
          if (this.laserTelegraphMesh) {
            this.laserTelegraphMesh.visible = false;
            (this.laserTelegraphMesh.material as THREE.MeshBasicMaterial).opacity = 0;
          }
        }
      }
    }

    // 2. Crowd attacks boss on close contact.
    // Диапазон -3..6: толпа бьёт босса, только пока реально стоит рядом с ним, а не всю
    // дорогу до финиша после того как пробежала мимо (distanceToArena становится отрицательной).
    if (distanceToArena <= 6 && distanceToArena >= -3) {
      const aliveMobs = crowd.getAliveMobs();
      // Раньше 35 dps на моба означало, что толпа в полсотни бойцов сносила босса L10
      // (150 HP) за 0.086 секунды — "бой" не успевал начаться. Теперь урон растёт
      // медленнее и не зависит от размера толпы линейно.
      const crowdPower = Math.min(140, 12 + aliveMobs.length * 1.6) * dt;
      // Тактический бонус Фаланги (circle): толпа в плотном строю наносит боссу больше урона.
      const crowdMult = crowd.getBossDamageMultiplier();
      // Фаланга (circle) пробивает энергетический купол на 20% от урона.
      this.takeDamage(crowdPower * crowdMult, particles, crowd.formation === 'circle');

      // Boss retaliation — было "8% шанс за кадр" (~4.8 смертей/сек на 60 FPS без единого
      // предупреждения). Теперь фиксированный ритм с небольшой тряской-телеграфом.
      this.retaliationTimer -= dt;
      // Телеграф: за ~0.45с до удара босс подаёт янтарное кольцо-«зону поражения»,
      // чтобы игрок успел перестроить толпу в безопасную формацию (phalanx/circle).
      if (this.retaliationTimer <= BossManager.RETALIATION_TELEGRAPH_TIME && !this.retaliationTelegraphed) {
        this.retaliationTelegraphed = true;
        this.particles.emitShockwave(0, this.bossArenaZ - 4.5, 0xf59e0b);
        this.particles.emitBurst(0, 1.0, this.bossArenaZ - 4.0, 12, 0xf59e0b, 2.5, 0.5);
      }
      if (this.retaliationTimer <= 0) {
        this.retaliationTimer = 1.4;
        this.retaliationTelegraphed = false;
        eventBus.emit('screenShake', { intensity: 0.25 });
        crowd.killMobs(1 + Math.floor(aliveMobs.length * 0.02), 'boss');
      }
    }

    // Блокируем продвижение толпы, пока босс жив — иначе толпа физически пробегает
    // сквозь него и "бой" сводится к паре кадров контакта.
    if (!this.isDefeated && !this.isDefeatCollapsing) {
      crowd.leaderZ = Math.min(crowd.leaderZ, this.bossArenaZ - 5.5);
    }
  }

  private executeBossAttack(
    attack: any,
    crowd: CrowdManager,
    particles: ParticleSystem
  ): void {
    if (!this.bossMesh) return;

    if (attack.type === 'slam') {
      soundEngine.playSound('boss_slam');
      eventBus.emit('screenShake', { intensity: 0.6 });
      this.particles.emitShockwave(0, this.bossArenaZ - 4, 0xef4444);
      particles.emitBurst(0, 0.5, this.bossArenaZ - 4, 40, 0xef4444, 8.0);

      // Kill mobs in slam radius unless in Phalanx/Circle formation or Hyper mode.
      // Раньше killMobs(1) вызывался на КАЖДОГО моба в радиусе — 60 мобов в радиусе
      // давали 60 вызовов, каждый с filter+sort по всему массиву (мгновенный вайп + фриз).
      // Считаем число попавших под удар один раз и бьём одним вызовом.
      const radius = attack.areaRadius || 3.5;
      const hitCount = crowd
        .getAliveMobs()
        .reduce((n, mob) => {
          const d = Math.sqrt(mob.x * mob.x + (mob.z - (this.bossArenaZ - 4)) ** 2);
          return d <= radius ? n + 1 : n;
        }, 0);
      if (hitCount > 0) {
        crowd.killMobs(Math.max(1, Math.round(hitCount * 0.35)), 'boss_slam');
      }
    } else if (attack.type === 'laser') {
      soundEngine.playSound('boss_laser');
      eventBus.emit('screenShake', { intensity: 0.4 });
      particles.emitBurst(0, 1.5, this.bossArenaZ - 2, 30, 0x00f0ff, 6.0);
      crowd.killMobs(Math.floor(attack.damage / 3), 'boss_laser');
    } else if (attack.type === 'minions') {
      // Рой мелких тварей: босс призывает рой, который грызёт толпу в течение всей
      // длительности атаки. Урон наносится тиками (каждые ~0.5с), а не одним ударом,
      // чтобы атака читалась как "затяжной урон", а не мгновенный вайп.
      soundEngine.playSound('boss_minions');
      eventBus.emit('screenShake', { intensity: 0.3 });
      particles.emitBurst(0, 1.0, this.bossArenaZ - 3, 25, 0xa855f7, 5.0);
      this.minionTickAccum = 0;
    } else if (attack.type === 'meteors') {
      // Метеоритный залп: серия огненных всплесков по арене перед боссом.
      soundEngine.playSound('boss_slam');
      eventBus.emit('screenShake', { intensity: 0.5 });
      const strikes = attack.areaRadius ? Math.floor(attack.areaRadius) : 3;
      for (let i = 0; i < strikes; i++) {
        const sx = (Math.random() - 0.5) * 8;
        const sz = this.bossArenaZ - 4 - Math.random() * 4;
        particles.emitBurst(sx, 0.6, sz, 22, 0xf97316, 7.0);
      }
      // Урон ограничен безопасной долей от численности отряда, чтобы метеоры
      // не выкашивали всю толпу на поздних уровнях.
      const capped = Math.min(attack.damage, Math.floor(crowd.getAliveCount() * 0.2));
      if (capped > 0) {
        crowd.killMobs(Math.max(1, capped), 'boss_slam');
      }
    } else if (attack.type === 'shield') {
      // Энергетический купол: на время атаки босс блокирует урон толпы.
      soundEngine.playSound('boss_slam');
      eventBus.emit('screenShake', { intensity: 0.3 });
      particles.emitBurst(0, 2.0, this.bossArenaZ, 30, 0x00f0ff, 6.0);
      this.setShielded(true);
    }
  }

  /** Включает/выключает энергетический щит босса (атака "shield"). */
  private setShielded(on: boolean): void {
    this.isShielded = on;
    if (on) {
      if (!this.shieldMesh && this.bossMesh) {
        const shieldGeo = new THREE.SphereGeometry(3.2, 24, 16);
        const shieldMat = new THREE.MeshBasicMaterial({
          color: 0x00f0ff,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        });
        this.shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
        this.shieldMesh.position.set(0, 2.0, this.bossArenaZ);
        this.scene.add(this.shieldMesh);
      }
    } else {
      if (this.shieldMesh) {
        this.scene.remove(this.shieldMesh);
        this.shieldMesh.geometry.dispose();
        (this.shieldMesh.material as THREE.Material).dispose();
        this.shieldMesh = null;
      }
    }
  }

  /** Тикает урон роя мелких тварей во время активной атаки "minions". */
  private tickMinionDamage(dt: number, crowd: CrowdManager, particles: ParticleSystem): void {
    if (!this.bossData || this.isDefeated) return;
    const currentAttack = this.bossData.attacks[this.currentAttackIndex];
    if (currentAttack.type !== 'minions') return;

    this.minionTickAccum += dt;
    const tickInterval = 0.5;
    if (this.minionTickAccum >= tickInterval) {
      this.minionTickAccum = 0;
      // Урон за тик — доля от полного урона атаки, чтобы за всю длительность
      // (обычно 2-3с) суммарный урон был сопоставим с slam/laser.
      const perTick = Math.max(1, Math.round((currentAttack.damage / 3) * tickInterval));
      crowd.killMobs(perTick, 'boss_minions');
      particles.emitBurst(
        (Math.random() - 0.5) * 4,
        0.8 + Math.random(),
        this.bossArenaZ - 3 + (Math.random() - 0.5) * 4,
        8,
        0xa855f7,
        3.0
      );
    }
  }

  public takeDamage(amount: number, particles: ParticleSystem, pierceShield: boolean = false): void {
    if (!this.bossData || this.isDefeated || this.isDefeatCollapsing) return;

    // Энергетический купол (атака "shield") блокирует урон толпы. Фаланга (circle)
    // пробивает барьер на 20% от урона (тактическая синергия плотного строя).
    if (this.isShielded) {
      amount = pierceShield ? amount * 0.2 : 0;
    }

    if (amount > 0) {
      // Хит-флэш на материалах корпуса (0.08с)
      this.hitFlashTimer = 0.08;
    }

    this.bossData.hp = Math.max(0, this.bossData.hp - amount);
    this.hitDamageAccum += amount;

    // Фидбек-фикции гейтим ~6 Гц: меле-урон толпы приходит каждый кадр (60 Гц),
    // спам звука/частиц/событий форсировал бы тяжёлый ре-рендер HUD на 60 Гц.
    // HP при этом списывается непрерывно — тормозим только аудио/визуал/эмит.
    this.hitFxAccum -= 1;
    if (this.hitFxAccum > 0) {
      if (this.bossData.hp <= 0 && !this.isDefeatCollapsing && !this.isDefeated) {
        // Добивающий урон в окне троттлинга: эмитим bossDamaged с hp=0, чтобы
        // HUD-полоса HP упала до нуля сразу, а не замирала на остаточном значении
        // на всю секунду анимации коллапса. Иначе финальный урон теряется.
        eventBus.emit('bossDamaged', {
          hp: 0,
          maxHp: this.bossData.maxHp,
          nameKey: this.bossData.nameKey,
          x: 0,
          z: this.bossArenaZ,
          damage: this.hitDamageAccum,
        });
        this.hitDamageAccum = 0;
        this.defeatBoss(particles);
      }
      return;
    }
    this.hitFxAccum = 10; // ~6 Гц при 60 FPS (60/10)

    // Энергокупол босса: блокированный удар (Фаланга не пробила) получает ОТДЕЛЬНЫЙ
    // акустический/визуальный фидбек «отражения» вместо ложного звука попадания по
    // плоти + белых искр, из-за которого игрок думал «полоска HP забагована».
    // Пробитие щита Фалангой (pierceShield, 20% урона) — комбинированные искры.
    if (this.isShielded) {
      soundEngine.playSound('hammer_impact', 1.5, 0.7);
      if (this.bossMesh) {
        const sparkColor = pierceShield ? 0xf59e0b : 0x00f0ff;
        particles.emitBurst(
          (Math.random() - 0.5) * 2,
          2.5 + Math.random(),
          this.bossArenaZ,
          10,
          sparkColor,
          4.5
        );
      }
      if (pierceShield) {
        eventBus.emit('bossShieldPierced', { x: 0, z: this.bossArenaZ, amount: this.hitDamageAccum });
      } else {
        eventBus.emit('bossShieldBlocked', { x: 0, z: this.bossArenaZ });
      }
      this.hitDamageAccum = 0;
      return;
    }

    soundEngine.playSound('boss_hit');

    if (this.bossMesh) {
      particles.emitBurst(
        (Math.random() - 0.5) * 2,
        2.5 + Math.random(),
        this.bossArenaZ,
        6,
        0xffffff,
        4.0
      );
    }

    eventBus.emit('bossDamaged', {
      hp: this.bossData.hp,
      maxHp: this.bossData.maxHp,
      nameKey: this.bossData.nameKey,
      x: 0,
      z: this.bossArenaZ,
      damage: this.hitDamageAccum,
    });
    this.hitDamageAccum = 0;

    if (this.bossData.hp <= 0 && !this.isDefeatCollapsing && !this.isDefeated) {
      this.defeatBoss(particles);
    }
  }

  private defeatBoss(particles: ParticleSystem): void {
    this.isDefeated = true;
    this.isDefeatCollapsing = true;
    this.defeatTimer = 0;
    this.defeatBurstTimer = 0;
    soundEngine.playSound('boss_defeat');

    if (this.telegraphMesh) {
      this.telegraphMesh.visible = false;
      (this.telegraphMesh.material as THREE.MeshBasicMaterial).opacity = 0;
    }
    if (this.laserTelegraphMesh) {
      this.laserTelegraphMesh.visible = false;
      (this.laserTelegraphMesh.material as THREE.MeshBasicMaterial).opacity = 0;
    }
    if (this.laserBeamMesh) {
      this.laserBeamMesh.visible = false;
    }
    if (this.isShielded) {
      this.setShielded(false);
    }

    particles.emitBurst(0, 3.0, this.bossArenaZ, 40, 0xfacc15, 8.0);
    eventBus.emit('screenShake', { intensity: 0.6 });
  }

  public clear(): void {
    if (this.bossMesh) {
      this.scene.remove(this.bossMesh);
      this.bossMesh.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      this.bossMesh = null;
    }
    if (this.telegraphMesh) {
      this.scene.remove(this.telegraphMesh);
      this.telegraphMesh.geometry.dispose();
      (this.telegraphMesh.material as THREE.Material).dispose();
      this.telegraphMesh = null;
    }
    if (this.laserTelegraphMesh) {
      this.scene.remove(this.laserTelegraphMesh);
      this.laserTelegraphMesh.geometry.dispose();
      (this.laserTelegraphMesh.material as THREE.Material).dispose();
      this.laserTelegraphMesh = null;
    }
    if (this.laserBeamMesh) {
      this.scene.remove(this.laserBeamMesh);
      this.laserBeamMesh.geometry.dispose();
      (this.laserBeamMesh.material as THREE.Material).dispose();
      this.laserBeamMesh = null;
    }
    if (this.shieldMesh) {
      this.scene.remove(this.shieldMesh);
      this.shieldMesh.geometry.dispose();
      (this.shieldMesh.material as THREE.Material).dispose();
      this.shieldMesh = null;
    }
    this.cachedMaterials = [];
    this.isShielded = false;
    this.bossData = null;
    this.isDefeated = false;
    this.isDefeatCollapsing = false;
    this.defeatTimer = 0;
    this.defeatBurstTimer = 0;
    this.hitFlashTimer = 0;
    this.retaliationTelegraphed = false;
    this.isCoolingDown = false;
    this.attackCooldown = 0;
    this.currentAttackIndex = 0;
    this.lastAttackIndex = -1;
    this.hitFxAccum = 0;
    this.hitDamageAccum = 0;
    this.arenaEntered = false;
  }

  public dispose(): void {
    this.clear();
  }

  /** Дефолтные веса атак по типу (если не заданы явно в LevelGenerator). */
  private static readonly DEFAULT_ATTACK_WEIGHTS: Record<BossAttack['type'], number> = {
    slam: 30,
    laser: 25,
    minions: 25,
    meteors: 20,
    shield: 15,
  };

  /** Взвешенный случайный выбор следующей атаки без немедленного повтора.
   *  Исключает прошлую атаку (lastAttackIndex) из пула кандидатов, чтобы одна и
   *  та же атака не шла дважды подряд. При n==2 остаётся ровно 1 кандидат —
   *  строгое чередование; при n>=3 — чистый взвешенный выбор по остальным. */
  private selectNextAttackIndex(): number {
    const attacks = this.bossData?.attacks;
    if (!attacks || attacks.length === 0) return 0;
    if (attacks.length === 1) return 0;

    let totalWeight = 0;
    for (let i = 0; i < attacks.length; i++) {
      if (i === this.lastAttackIndex) continue;
      const w = attacks[i].weight ?? BossManager.DEFAULT_ATTACK_WEIGHTS[attacks[i].type] ?? 10;
      totalWeight += Math.max(1, w);
    }

    let rnd = Math.random() * totalWeight;
    for (let i = 0; i < attacks.length; i++) {
      if (i === this.lastAttackIndex) continue;
      const w = Math.max(1, attacks[i].weight ?? BossManager.DEFAULT_ATTACK_WEIGHTS[attacks[i].type] ?? 10);
      rnd -= w;
      if (rnd < 0) return i;
    }
    // Страховка: если rnd не упал ниже нуля (крайний случай), вернуть последний
    // не-исключённый индекс.
    for (let i = 0; i < attacks.length; i++) {
      if (i !== this.lastAttackIndex) return i;
    }
    return 0;
  }
}
