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
  // One-shot эффекты (комбо, звук, партиклы, eventBus) срабатывают только при первом
  // мобе, прошедшем ворота. Per-mob математика (multiply/divide) применяется к каждому
  // пересекающему мобу отдельно, пока ворота не будут полностью пройдены толпой.
  triggered: boolean;
  // Хроно-Маг трансмутировал эти ворота (÷N → +N). Запоминается при первом проходе Мага,
  // чтобы хвостовые бойцы на следующих кадрах не переключали ворота обратно в divide.
  transmutedByMage: boolean;
  // Счётчик шагов для операции divide (÷N) — персистентный между кадрами для растянутых формаций.
  divideStep: { step: number };
  // Зафиксированный исход mystery-ворот (true = бонус +N, false = штраф ÷N). Кэшируется при
  // первом срабатывании, чтобы растянутая формация (овал/стрела), переходящая ворота несколько
  // кадров, получала ОДИН согласованный исход, а не перебрасывала Math.random() каждый кадр
  // (голова — бонус, хвост — штраф на том же объекте).
  mysteryResult?: boolean;
  // Движение: текущее смещение по X и Y (для horizontal/vertical), угол поворота (rotate).
  motionPhase: number;
  baseX: number;
  baseY: number;
}

export class GateManager {
  private scene: THREE.Scene;
  private gates: GateVisual[] = [];
  private comboStreak: number = 0;
  private lastComboTier: number = 0;
  // Флаг празднования достижения потолка серии ворот (×1.8). Сбрасывается в clear().
  private comboMaxCelebrated: boolean = false;
  private throughScratch: MobInstance[] = [];
  private preEffectIds: Set<number> = new Set();

  // Все ворота уровня используют одну ширину/высоту рамок — общая геометрия.
  private sharedPlaneGeo: THREE.PlaneGeometry | null = null;
  private sharedPillarGeo: THREE.CylinderGeometry | null = null;
  private sharedPillarMat: THREE.MeshStandardMaterial | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private static readonly GATE_HEIGHT = 3.8;
  // Ворота остаются активными, пока лидер не прошёл их на эту дистанцию. Покрывает
  // trailing-мобов вытянутых формаций (arrow до ~32м при 200 юнитах, oval до ~13м),
  // чтобы каждый реально прошедший через проём моб гарантированно получил эффект.
  private static readonly GATE_DEACTIVATE_MARGIN = 36;
  // Дистанция позади лидера, за пределами которой пройденные ворота удаляются (endless-режим).
  private static readonly PRUNE_MARGIN = 40;
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
      triggered: false,
      transmutedByMage: false,
      motionPhase: Math.random() * Math.PI * 2,
      baseX: gate.x,
      baseY: 0,
      divideStep: { step: 0 },
    };
  }

  public initGates(gatesData: GateData[]): void {
    this.clear();
    this.comboStreak = 0;
    this.lastComboTier = 0;
    this.comboMaxCelebrated = false;
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
      // Ворота деактивируются, когда лидер прошёл их на margin — к этому моменту вся
      // толпа (включая trailing-мобов формаций) уже пересекла проём.
      if (crowd.leaderZ - gate.z > GateManager.GATE_DEACTIVATE_MARGIN) return;
      // Пространственный отсев: ворота далеко от лидера ещё не достигнуты — не сканируем.
      if (Math.abs(gate.z - crowd.leaderZ) > 80) return;

      // Движение ворот.
      this.applyMotion(gateVisual, dt);

      // Текущая позиция проёма (с учётом движения).
      const cx = gateVisual.group.position.x;
      const cy = gateVisual.group.position.y;
      const halfW = gate.width / 2;

      // Per-mob обработка: ворота срабатывают ТОЛЬКО в момент реального пересечения
      // плоскости проёма (prevZ < gate.z <= z), а не когда моб уже за линией и потом
      // сместился вбок. Это фикс: раньше условие `mob.z < gate.z` срабатывало для любого
      // моба, оказавшегося за линией ворот, даже если он прошёл мимо и сместился на их
      // линию позже — ворота срабатывали ложно.
      this.throughScratch.length = 0;
      let any = false;
      for (const mob of aliveMobs) {
        if (gateVisual.processedMobs.has(mob.id)) continue;
        // Пересечение плоскости по Z в текущем кадре (направление движения — +Z).
        const crossed = mob.prevZ < gate.z && mob.z >= gate.z;
        if (!crossed) continue;
        // Проверяем попадание в проём по X (вращение ворот учитываем упрощённо — по центру).
        if (Math.abs(mob.x - cx) > halfW + 0.4) continue;
        gateVisual.processedMobs.add(mob.id);
        this.throughScratch.push(mob);
        any = true;
      }

      if (any && this.throughScratch.length > 0) {
        // Фиксируем живых ДО эффекта, чтобы свежеспавненные клоны (новые id)
        // не пересекли плоскость позади ворот и не сработали повторно (лавина ×N).
        this.preEffectIds.clear();
        const aliveBefore = crowd.getAliveMobs();
        for (let i = 0; i < aliveBefore.length; i++) this.preEffectIds.add(aliveBefore[i].id);

        this.executeGateEffect(gateVisual, gate.op, gate.value, crowd, particles, cx, gate.z, this.throughScratch, cy, !gateVisual.triggered);
        gateVisual.triggered = true;
        gateVisual.mat.opacity = 0.3;

        // Новые мобы (id не было до эффекта) = клоны этого ворота. Помечаем пройденными.
        const aliveAfter = crowd.getAliveMobs();
        for (let i = 0; i < aliveAfter.length; i++) {
          const id = aliveAfter[i].id;
          if (!this.preEffectIds.has(id)) gateVisual.processedMobs.add(id);
        }
      }
    });

    if (!this.empActive) {
      this.prune(crowd.leaderZ);
    }
  }

  /**
   * Удаляет пройденные ворота далеко позади игрока (endless-режим, 0-GC compaction).
   * Не вызывается во время EMP-шторма, чтобы не нарушать соответствие empOriginals.
   */
  public prune(leaderZ: number): void {
    const threshold = leaderZ - GateManager.PRUNE_MARGIN;
    let writeIdx = 0;
    for (let i = 0; i < this.gates.length; i++) {
      const gv = this.gates[i];
      if (gv.data.z < threshold) {
        this.scene.remove(gv.group);
        gv.texture.dispose();
        gv.mat.dispose();
      } else {
        this.gates[writeIdx++] = gv;
      }
    }
    this.gates.length = writeIdx;
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
    gateVisual: GateVisual,
    op: GateOp,
    val: number,
    crowd: CrowdManager,
    particles: ParticleSystem,
    gateX: number,
    gateZ: number,
    wing: MobInstance[],
    gateY: number,
    isFirstTrigger: boolean
  ): void {
    let isPositive = false;
    let netChange = 0;
    // Фактор бонуса за серию позитивных ворот: 1.0 при серии ≤ 1 (старое поведение),
    // растёт до 1.8 при длинной серии. Награждает удержание серии правильных крыльев.
    const comboFactor = this.comboStreak > 1
      ? 1 + Math.min((this.comboStreak - 1) * GateManager.COMBO_BONUS_PER_STEP, GateManager.COMBO_BONUS_CAP)
      : 1;

    if (op === 'add') {
      // +N: добавляет N мобов к толпе у ворот. Срабатывает ТОЛЬКО один раз за ворота
      // (при первом прошедшем мобе) — не на каждого прошедшего. Раньше executeGateEffect
      // вызывался каждый кадр, пока толпа тянулась через проём, и addMobsNear выполнялся
      // заново на каждый кадр → лавинное добавление «на каждого человечка».
      let base = 0;
      if (isFirstTrigger) {
        base = crowd.addMobsNear(val, gateX, gateZ);
      }
      if (base > 0) {
        const bonus = Math.floor(base * (comboFactor - 1));
        netChange = bonus > 0 ? base + crowd.addMobsNear(bonus, gateX, gateZ) : base;
      }
      if (isFirstTrigger && netChange > 0) soundEngine.playSound('gate_pass_positive');
      if (isFirstTrigger) particles.emitBurst(gateX, (gateY || 0) + 1.5, gateZ, netChange > 0 ? 25 : 6, 0x10b981, netChange > 0 ? 5.0 : 2.0);
      isPositive = true;
    } else if (op === 'multiply') {
      // ×N: каждый прошедший моб порождает (N-1) копий (N — целое).
      // Per-mob математика: multiplyGroup вызывается для каждого нового моба/группы.
      // Копии спавнятся на z-1.0 позади ворот и не триггерят повторно.
      const base = crowd.multiplyGroup(wing, val, gateX, gateZ);
      // Комбо-бонус — награда за серию, начисляется ОДИН раз за ворота (isFirstTrigger),
      // не на каждый кадр пересечения растянутой формации (fix double-counting).
      if (isFirstTrigger && base > 0) {
        const bonus = Math.floor(base * (comboFactor - 1));
        netChange = bonus > 0 ? base + crowd.addMobsNear(bonus, gateX, gateZ) : base;
      }
      if (isFirstTrigger && netChange > 0) soundEngine.playSound('gate_pass_multiplier');
      if (isFirstTrigger) particles.emitBurst(gateX, (gateY || 0) + 1.5, gateZ, netChange > 0 ? 35 : 6, 0x00f0ff, netChange > 0 ? 6.0 : 2.0);
      isPositive = true;
    } else if (op === 'mystery') {
      // Мистика: 60% — бонус (+N мобов), 40% — штраф (÷N по шагу). Риск/награда.
      // One-shot guard: эффект применяется один раз за ворота (isFirstTrigger).
      // Исход кэшируется в gateVisual.mysteryResult при первом кадре срабатывания, чтобы
      // растянутая формация, переходящая ворота несколько кадров, получала ОДИН согласованный
      // результат — иначе Math.random() перебрасывался бы каждый кадр (голова — бонус, хвост —
      // штраф на том же объекте).
      const isLucky = gateVisual.mysteryResult ?? (gateVisual.mysteryResult = Math.random() < 0.6);
      if (isLucky) {
        let base = 0;
        if (isFirstTrigger) {
          base = crowd.addMobsNear(val, gateX, gateZ);
        }
        if (base > 0) {
          const bonus = Math.floor(base * (comboFactor - 1));
          netChange = bonus > 0 ? base + crowd.addMobsNear(bonus, gateX, gateZ) : base;
        }
        if (isFirstTrigger && netChange > 0) soundEngine.playSound('gate_pass_positive');
        if (isFirstTrigger) particles.emitBurst(gateX, (gateY || 0) + 1.5, gateZ, netChange > 0 ? 25 : 6, 0xa855f7, netChange > 0 ? 5.0 : 2.0);
        isPositive = true;
      } else {
        // Штраф ÷N (≈40% Mystery). Хроно-Маг трансмутирует и его (BALANCE.md «маг
        // трансмутирует −N/÷N»); иначе толпа делится по шагу. One-shot guard: результат
        // кэширован в mysteryResult сверху, а флаг transmutedByMage не даёт хвостовым
        // бойцам задваивать спавн (та же логика, что у divide).
        const isNewTransmute = !gateVisual.transmutedByMage && wing.some((m) => m.type === 'mage');
        if (gateVisual.transmutedByMage || isNewTransmute) {
          gateVisual.transmutedByMage = true;
          const transmuteVal = Math.max(1, Math.round(val * 0.6));
          if (isNewTransmute) {
            eventBus.emit('classAbility', {
              type: 'mage',
              ability: 'transmute',
              x: gateX,
              z: gateZ,
              value: transmuteVal,
            });
          }
          const shouldSpawn = isNewTransmute;
          let base = 0;
          if (shouldSpawn) {
            base = crowd.addMobsNear(transmuteVal, gateX, gateZ);
          }
          if (base > 0) {
            const bonus = Math.floor(base * (comboFactor - 1));
            netChange = bonus > 0 ? base + crowd.addMobsNear(bonus, gateX, gateZ) : base;
            soundEngine.playSound('gate_pass_positive');
            particles.emitBurst(gateX, (gateY || 0) + 1.5, gateZ, 25, 0x10b981, 5.0);
          }
          isPositive = true;
        } else {
          netChange = -crowd.divideMobsByStep(wing, val, 'gate', gateVisual.divideStep);
          if (isFirstTrigger) soundEngine.playSound('gate_pass_negative');
          if (isFirstTrigger) particles.emitBurst(gateX, (gateY || 0) + 1.5, gateZ, 20, 0xef4444, 4.0);
          if (isFirstTrigger) eventBus.emit('screenShake', { intensity: 0.3 });
        }
      }
    } else if (op === 'divide') {
      // Хроно-Маг: если Маг прошёл ворота (в любом ряду), трансмутируем ÷N в прибавку.
      // One-shot guard: трансмутация срабатывает ровно один раз за проход ворот.
      // Запоминается в transmutedByMage, чтобы хвостовые бойцы не делились и не задваивали спавн.
      const isNewTransmute = !gateVisual.transmutedByMage && wing.some((m) => m.type === 'mage');
      if (gateVisual.transmutedByMage || isNewTransmute) {
        const shouldSpawn = isNewTransmute || (!gateVisual.transmutedByMage && isFirstTrigger);
        gateVisual.transmutedByMage = true;
        const transmuteVal = Math.max(1, Math.round(val * 0.6));
        if (isNewTransmute) {
          eventBus.emit('classAbility', {
            type: 'mage',
            ability: 'transmute',
            x: gateX,
            z: gateZ,
            value: transmuteVal,
          });
        }
        let base = 0;
        if (shouldSpawn) {
          base = crowd.addMobsNear(transmuteVal, gateX, gateZ);
        }
        if (base > 0) {
          const bonus = Math.floor(base * (comboFactor - 1));
          netChange = bonus > 0 ? base + crowd.addMobsNear(bonus, gateX, gateZ) : base;
          soundEngine.playSound('gate_pass_positive');
          particles.emitBurst(gateX, (gateY || 0) + 1.5, gateZ, 25, 0x10b981, 5.0);
        }
        isPositive = true;
      } else {
        // ÷N: пропускает каждого N-го по очереди, остальных убирает для каждого нового моба/группы
        netChange = -crowd.divideMobsByStep(wing, val, 'gate', gateVisual.divideStep);
        if (isFirstTrigger) soundEngine.playSound('gate_pass_negative');
        if (isFirstTrigger) particles.emitBurst(gateX, (gateY || 0) + 1.5, gateZ, 20, 0xef4444, 4.0);
        if (isFirstTrigger) eventBus.emit('screenShake', { intensity: 0.3 });
      }
    }

    if (isFirstTrigger) {
      if (isPositive) {
        this.comboStreak++;
        if (this.comboStreak > 1) {
          soundEngine.playSound('combo_ding', 1.0 + this.comboStreak * 0.1);
        }
        const tier = Math.floor(this.comboStreak / 5);
        if (tier > 0 && tier > this.lastComboTier) {
          this.lastComboTier = tier;
          eventBus.emit('comboMilestone', { streak: this.comboStreak, x: gateX, z: gateZ, tier });
        }
        // Множитель бонуса толпы достиг потолка ×1.8 (COMBO_BONUS_CAP, серия ≥ 11) —
        // значимый момент: игрок выжал максимум из серии ворот. Отдельное праздничное
        // событие (VFX + cheer + тряска + баннер), которого раньше не было — HUD просто
        // показывал «МАКС» без 3D-отклика. Эмитим один раз при первом достижении капа.
        if (this.comboStreak >= 11 && !this.comboMaxCelebrated) {
          this.comboMaxCelebrated = true;
          eventBus.emit('comboMax', { streak: this.comboStreak, x: gateX, z: gateZ });
        }
        stateManager.runRecordCombo(this.comboStreak);
      } else {
        // Серия сбита отрицательными воротами. Если серия была длинной (≥5),
        // эмитим comboBreak — игрок теряет до ×1.8 множителя, это значимый момент.
        if (this.comboStreak >= 5) {
          eventBus.emit('comboBreak', { streak: this.comboStreak, x: gateX, z: gateZ });
        }
        this.comboStreak = 0;
        this.lastComboTier = 0;
      }

      stateManager.runRecordGatePass();
      eventBus.emit('gatePassed', { op, val, isPositive, netChange, comboStreak: this.comboStreak, comboFactor, x: gateX, z: gateZ });
    }
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
      if (gv.triggered) continue;
      this.empOriginals.push({ gate, op: gate.op, value: gate.value });
      gate.op = 'divide';
      gate.value = 2;
      // Перегенерируем текстуру, чтобы текст операции («+10» → «÷2») совпадал с логикой.
      const newTex = createGateTexture(gate);
      gv.texture.dispose();
      gv.texture = newTex;
      gv.mat.map = newTex;
      // Лёгкий фиолетовый оттенок — визуальный сигнал искажения.
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
      // Восстанавливаем текстуру с оригинальной операцией.
      const origTex = createGateTexture(gv.data);
      gv.texture.dispose();
      gv.texture = origTex;
      gv.mat.map = origTex;
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
