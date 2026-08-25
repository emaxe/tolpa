import * as THREE from 'three';
import { GateData, GateOp, GateMotion, MobInstance } from '../types/game';
import { createGateTexture } from '../utils/proceduralMeshes';
import { CrowdManager } from './CrowdManager';
import { ParticleSystem } from './ParticleSystem';
import { soundEngine } from '../audio/SoundEngine';
import { eventBus } from '../core/EventBus';
import { stateManager } from '../core/StateManager';

interface GateVisual {
  data: GateData;
  group: THREE.Group;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  texture: THREE.CanvasTexture;
  // Мобы, которые уже прошли через эти ворота — чтобы каждый человечек обрабатывался
  // воротами независимо (по своей реальной позиции и по попаданию в проём по X).
  processedMobs: Set<number>;
  // Движение: текущее смещение по X и Y (для horizontal/vertical), угол поворота (rotate).
  motionPhase: number;
  baseX: number;
  baseY: number;
}

export class GateManager {
  private scene: THREE.Scene;
  private gates: GateVisual[] = [];
  private comboStreak: number = 0;

  // Все ворота уровня используют одну ширину/высоту рамок — общая геометрия.
  private sharedPlaneGeo: THREE.PlaneGeometry | null = null;
  private sharedPillarGeo: THREE.CylinderGeometry | null = null;
  private sharedPillarMat: THREE.MeshStandardMaterial | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private static readonly GATE_HEIGHT = 3.8;
  // Бонус за комбо-серию позитивных ворот: +8% мобов за каждый шаг серии > 1,
  // максимум +80% (фактор ≤ 1.8). Награждает удержание серии правильных крыльев.
  private static readonly COMBO_BONUS_PER_STEP = 0.08;
  private static readonly COMBO_BONUS_CAP = 0.8;

  private ensureSharedGeometry(): void {
    if (this.sharedPlaneGeo) return;
    const h = GateManager.GATE_HEIGHT;
    this.sharedPlaneGeo = new THREE.PlaneGeometry(4, h);
    this.sharedPillarGeo = new THREE.CylinderGeometry(0.12, 0.12, h + 0.4, 8);
    this.sharedPillarMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.4,
    });
  }

  private buildGateVisual(gate: GateData): GateVisual {
    const h = GateManager.GATE_HEIGHT;
    const planeGeo = this.sharedPlaneGeo!;
    const pillarGeo = this.sharedPillarGeo!;
    const pillarMat = this.sharedPillarMat!;

    const group = new THREE.Group();
    group.position.z = gate.z;
    group.position.x = gate.x;
    group.position.y = 0;

    // Один проём — одна текстура с операцией (не пара створок).
    const texture = createGateTexture(gate);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(planeGeo, mat);
    mesh.position.set(0, h / 2, 0);
    mesh.rotation.y = Math.PI;
    mesh.scale.set(gate.width / 4, 1, 1); // растягиваем текстуру под ширину проёма
    group.add(mesh);

    // Рамка: два столба по краям проёма.
    const halfW = gate.width / 2;
    const pL = new THREE.Mesh(pillarGeo, pillarMat);
    pL.position.set(-halfW, h / 2, 0);
    const pR = new THREE.Mesh(pillarGeo, pillarMat);
    pR.position.set(halfW, h / 2, 0);
    group.add(pL);
    group.add(pR);

    this.scene.add(group);

    return {
      data: gate,
      group,
      mesh,
      mat,
      texture,
      processedMobs: new Set<number>(),
      motionPhase: Math.random() * Math.PI * 2,
      baseX: gate.x,
      baseY: 0,
    };
  }

  public initGates(gatesData: GateData[]): void {
    this.clear();
    this.comboStreak = 0;
    this.ensureSharedGeometry();
    gatesData.forEach((gate) => this.gates.push(this.buildGateVisual(gate)));
  }

  /** Добавляет ворота к уже существующим — используется endless-режимом. */
  public appendGates(gatesData: GateData[]): void {
    this.ensureSharedGeometry();
    gatesData.forEach((gate) => this.gates.push(this.buildGateVisual(gate)));
  }

  public update(dt: number, crowd: CrowdManager, particles: ParticleSystem): void {
    // Буфер живых мобов собирается ОДИН раз на кадр, а не для каждых ворот:
    // aliveScratch — живой массив-объект, поэтому после executeGateEffect следующая
    // итерация цикла увидит актуальные данные.
    const aliveMobs = crowd.getAliveMobs();
    this.gates.forEach((gateVisual) => {
      const gate = gateVisual.data;
      if (gate.passed) return;
      // Пространственный отсев: ворота далеко от лидера ещё не достигнуты — не сканируем.
      if (Math.abs(gate.z - crowd.leaderZ) > 80) return;

      // Движение ворот.
      this.applyMotion(gateVisual, dt);

      // Текущая позиция проёма (с учётом движения).
      const cx = gateVisual.group.position.x;
      const cy = gateVisual.group.position.y;
      const halfW = gate.width / 2;

      // Per-mob обработка: каждый моб, прошедший через проём этих ворот, обрабатывается
      // независимо. Мобы, чей X не попадает в проём, этими воротами не затрагиваются.
      const through: MobInstance[] = [];
      let any = false;
      for (const mob of aliveMobs) {
        if (gateVisual.processedMobs.has(mob.id)) continue;
        if (mob.z < gate.z - 0.5) continue;
        // Проверяем попадание в проём по X (вращение ворот учитываем упрощённо — по центру).
        if (Math.abs(mob.x - cx) > halfW + 0.4) continue;
        gateVisual.processedMobs.add(mob.id);
        through.push(mob);
        any = true;
      }

      if (any && through.length > 0) {
        this.executeGateEffect(gate.op, gate.value, crowd, particles, cx, gate.z, through, cy);
        gate.passed = true;
        gateVisual.mat.opacity = 0.3;
      }
    });
  }

  private applyMotion(gv: GateVisual, dt: number): void {
    const gate = gv.data;
    if (gate.motion === 'none') return;
    gv.motionPhase += dt * gate.motionSpeed;

    if (gate.motion === 'horizontal') {
      const off = Math.sin(gv.motionPhase) * gate.motionRange;
      gv.group.position.x = gv.baseX + off;
    } else if (gate.motion === 'vertical') {
      // Вертикальное движение только ВВЕРХ от пола: основание проёма никогда не
      // опускается ниже y=0 (иначе ворота «уходят в пол»). Сдвиг берём по модулю.
      const off = Math.abs(Math.sin(gv.motionPhase)) * gate.motionRange;
      gv.group.position.y = gv.baseY + off;
    } else if (gate.motion === 'rotate') {
      // Вращение вокруг Y — проём поворачивается, что меняет фактическую ширину по X.
      gv.group.rotation.y = Math.sin(gv.motionPhase) * gate.motionRange * 0.5;
    }
  }

  private executeGateEffect(
    op: GateOp,
    val: number,
    crowd: CrowdManager,
    particles: ParticleSystem,
    gateX: number,
    gateZ: number,
    wing: MobInstance[],
    gateY: number
  ): void {
    let isPositive = false;
    let netChange = 0;
    // Фактор бонуса за серию позитивных ворот: 1.0 при серии ≤ 1 (старое поведение),
    // растёт до 1.8 при длинной серии. Награждает удержание серии правильных крыльев.
    const comboFactor = this.comboStreak > 1
      ? 1 + Math.min((this.comboStreak - 1) * GateManager.COMBO_BONUS_PER_STEP, GateManager.COMBO_BONUS_CAP)
      : 1;

    if (op === 'add') {
      // +N: добавляет N мобов к толпе у ворот (на всех прошедших).
      const base = crowd.addMobsNear(val, gateX, gateZ);
      if (base > 0) {
        const bonus = Math.floor(base * (comboFactor - 1));
        netChange = bonus > 0 ? base + crowd.addMobsNear(bonus, gateX, gateZ) : base;
      }
      if (netChange > 0) soundEngine.playSound('gate_pass_positive');
      particles.emitBurst(gateX, (gateY || 0) + 1.5, gateZ, netChange > 0 ? 25 : 6, 0x10b981, netChange > 0 ? 5.0 : 2.0);
      isPositive = true;
    } else if (op === 'multiply') {
      // ×N: каждый прошедший моб порождает (N-1) копий (N — целое).
      const base = crowd.multiplyGroup(wing, val, gateX, gateZ);
      if (base > 0) {
        const bonus = Math.floor(base * (comboFactor - 1));
        netChange = bonus > 0 ? base + crowd.addMobsNear(bonus, gateX, gateZ) : base;
      }
      if (netChange > 0) soundEngine.playSound('gate_pass_multiplier');
      particles.emitBurst(gateX, (gateY || 0) + 1.5, gateZ, netChange > 0 ? 35 : 6, 0x00f0ff, netChange > 0 ? 6.0 : 2.0);
      isPositive = true;
    } else if (op === 'divide') {
      const hasMage = wing.some((m) => m.type === 'mage');
      if (hasMage) {
        // Хроно-Маг: трансмутирует отрицательные ворота в прибавку мобов
        const transmuteVal = Math.max(1, Math.round(val * 0.6));
        const base = crowd.addMobsNear(transmuteVal, gateX, gateZ);
        if (base > 0) {
          const bonus = Math.floor(base * (comboFactor - 1));
          netChange = bonus > 0 ? base + crowd.addMobsNear(bonus, gateX, gateZ) : base;
        }
        if (netChange > 0) soundEngine.playSound('gate_pass_positive');
        particles.emitBurst(gateX, (gateY || 0) + 1.5, gateZ, netChange > 0 ? 25 : 6, 0x10b981, netChange > 0 ? 5.0 : 2.0);
        isPositive = true;
      } else {
        // ÷N: пропускает каждого N-го по очереди, остальных убирает.
        netChange = -crowd.divideMobsByStep(wing, val, 'gate');
        soundEngine.playSound('gate_pass_negative');
        particles.emitBurst(gateX, (gateY || 0) + 1.5, gateZ, 20, 0xef4444, 4.0);
        eventBus.emit('screenShake', { intensity: 0.3 });
      }
    }

    if (isPositive) {
      this.comboStreak++;
      if (this.comboStreak > 1) {
        soundEngine.playSound('combo_ding', 1.0 + this.comboStreak * 0.1);
      }
      stateManager.runRecordCombo(this.comboStreak);
    } else {
      this.comboStreak = 0;
    }

    stateManager.runRecordGatePass();
    eventBus.emit('gatePassed', { op, val, isPositive, netChange, comboStreak: this.comboStreak, comboFactor, x: gateX, z: gateZ });
  }

  public getCombo(): number {
    return this.comboStreak;
  }

  // ---------------------------------------------------------------------------
  // EMP-шторм: на время события позитивные ворота (add/multiply) превращаются в
  // ÷2 — то есть начинают прореживать толпу. divide остаётся divide. Сброс по clearEmpStorm.
  // ---------------------------------------------------------------------------
  private empActive: boolean = false;
  private empOriginals: { gate: GateData; op: GateOp; value: number }[] = [];

  public applyEmpStorm(): void {
    if (this.empActive) return;
    this.empActive = true;
    this.empOriginals = [];
    for (const gv of this.gates) {
      const gate = gv.data;
      if (gate.passed) continue;
      this.empOriginals.push({ gate, op: gate.op, value: gate.value });
      gate.op = 'divide';
      gate.value = 2;
      // Тонировка в фиолетовый — визуальный сигнал искажения.
      gv.mat.color.setHex(0xa855f7);
      gv.mat.needsUpdate = true;
    }
  }

  public clearEmpStorm(): void {
    if (!this.empActive) return;
    this.empActive = false;
    for (const orig of this.empOriginals) {
      orig.gate.op = orig.op;
      orig.gate.value = orig.value;
    }
    this.empOriginals = [];
    for (const gv of this.gates) {
      gv.mat.color.setHex(0xffffff);
      gv.mat.needsUpdate = true;
    }
  }

  public isEmpActive(): boolean {
    return this.empActive;
  }

  public clear(): void {
    this.gates.forEach((g) => {
      this.scene.remove(g.group);
      g.texture.dispose();
      g.mat.dispose();
    });
    this.gates = [];

    this.sharedPlaneGeo?.dispose();
    this.sharedPillarGeo?.dispose();
    this.sharedPillarMat?.dispose();
    this.sharedPlaneGeo = null;
    this.sharedPillarGeo = null;
    this.sharedPillarMat = null;
  }
}
