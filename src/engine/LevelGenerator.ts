import {
  BiomeType,
  LevelConfig,
  GateData,
  ObstacleData,
  CoinData,
  LevelDynamicEvent,
  GateOp,
  BossData,
  ObstacleType,
} from '../types/game';
import { TRACK_RAIL_MARGIN } from '../utils/math';

// Единственный источник ширины трассы — кампания и бесконечный режим используют
// одно и то же значение, чтобы не разъезжаться.
export const DEFAULT_TRACK_WIDTH = 16;
export const GATE_CLEARANCE = 10.5;

function createRng(seed: number) {
  let s = (seed * 1664525 + 1013904223) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PhaseInfo {
  phaseIndex: number;
  phaseName: 'warmup' | 'ramp' | 'peak' | 'corridor' | 'climax';
  phaseMult: number;
  densityMult: number;
}

export class LevelGenerator {
  public static getBiomeForLevel(levelNum: number): BiomeType {
    if (levelNum <= 10) return 'cyber_city';
    if (levelNum <= 20) return 'magma_citadel';
    if (levelNum <= 30) return 'crystal_cavern';
    if (levelNum <= 40) return 'quantum_void';
    return 'celestial_core';
  }

  public static getPhaseInfo(z: number, trackLength: number): PhaseInfo {
    const ratio = z / Math.max(1, trackLength);
    if (ratio < 0.15) {
      return { phaseIndex: 0, phaseName: 'warmup', phaseMult: 1.0, densityMult: 1.0 };
    } else if (ratio < 0.45) {
      return { phaseIndex: 1, phaseName: 'ramp', phaseMult: 1.15, densityMult: 1.15 };
    } else if (ratio < 0.70) {
      return { phaseIndex: 2, phaseName: 'peak', phaseMult: 1.30, densityMult: 1.30 };
    } else if (ratio < 0.85) {
      return { phaseIndex: 3, phaseName: 'corridor', phaseMult: 1.45, densityMult: 0.85 };
    } else {
      return { phaseIndex: 4, phaseName: 'climax', phaseMult: 1.60, densityMult: 1.45 };
    }
  }

  public static generateLevel(levelNum: number): LevelConfig {
    const rng = createRng(levelNum * 7919 + 12345);
    const biome = this.getBiomeForLevel(levelNum);
    const trackWidth = DEFAULT_TRACK_WIDTH;
    const playableHalf = trackWidth / 2 - TRACK_RAIL_MARGIN;
    const trackLength = 1100 + Math.min(32, levelNum) * 50;
    const isBossLevel = levelNum % 10 === 0;

    const rawGates: GateData[] = [];
    const rawObstacles: ObstacleData[] = [];
    const coins: CoinData[] = [];
    const events: LevelDynamicEvent[] = [];

    const startingMobs = 8;
    const targetMobsToWin = Math.min(100, 8 + Math.floor(levelNum * 1.8));

    // -------------------------------------------------------------
    // ЭТАП 3: ТАКТИЧЕСКИЕ ВОРОТА И КАСКАДНЫЕ ПАРЫ
    // -------------------------------------------------------------
    const gateCount = Math.min(30, 12 + Math.floor(levelNum / 3));
    const baseGateSpacing = (trackLength - 120) / Math.max(1, gateCount);

    // Определяем индексы для каскадных пар (начиная с уровня 6)
    const cascadeIndices = new Set<number>();
    if (levelNum >= 6) {
      cascadeIndices.add(3); // Каскадная пара в ramp-фазе (ворота 3 -> 4)
      if (levelNum >= 20) {
        cascadeIndices.add(Math.min(gateCount - 4, 7)); // Вторая пара в peak-фазе
      }
      if (levelNum >= 40) {
        cascadeIndices.add(Math.min(gateCount - 2, 12)); // Третья пара в corridor-фазе
      }
    }

    let currentGateZ = 32;
    for (let g = 0; g < gateCount; g++) {
      let z: number;
      const isCascadeChild = cascadeIndices.has(g - 1);

      if (g === 0) {
        z = 32 + rng() * 2;
      } else if (isCascadeChild) {
        // Каскадные ворота B: идут через ~14м после ворот A (10 <= dz <= 20)
        z = currentGateZ + 14.0;
      } else {
        z = currentGateZ + baseGateSpacing + (rng() * 4 - 2);
      }
      currentGateZ = z;

      const gateId = `gate_${levelNum}_${g}`;
      const phase = this.getPhaseInfo(z, trackLength);
      const multVal = Math.max(1.4, 2.2 - levelNum * 0.02);
      const subVal = Math.max(3, 5 + Math.floor(rng() * 8) - Math.floor(levelNum * 0.15));
      const addVal = 6 + Math.floor(rng() * 8) + Math.floor(levelNum * 0.12);

      const conditionalData = {
        minMobs: 8 + Math.floor(g * 2 + levelNum * 0.4),
        passOp: 'multiply' as GateOp,
        passVal: 2.5,
        failOp: 'subtract' as GateOp,
        failVal: 8,
      };

      let leftOp: GateOp = 'add';
      let leftVal = addVal;
      let rightOp: GateOp = 'multiply';
      let rightVal = multVal;
      let leftCondition = undefined;
      let rightCondition = undefined;

      // Обучающий каскад и ранжирование по фазам
      if (g === 0) {
        // 1-е ворота: всегда безопасны (add + multiply)
        leftOp = 'add';
        leftVal = 8 + Math.floor(rng() * 8);
        rightOp = 'multiply';
        rightVal = multVal;
      } else if (g === 1) {
        // 2-е ворота: мягкая проверка
        leftOp = 'add';
        leftVal = 10 + Math.floor(rng() * 6);
        rightOp = 'multiply';
        rightVal = multVal;
      } else if (g === 2) {
        // 3-е ворота: первый обучающий conditional
        leftOp = 'add';
        leftVal = addVal;
        rightOp = 'conditional';
        rightVal = 0;
        rightCondition = {
          minMobs: 10 + Math.floor(levelNum * 0.3),
          passOp: 'multiply' as GateOp,
          passVal: 2.2,
          failOp: 'subtract' as GateOp,
          failVal: 6,
        };
      } else if (isCascadeChild) {
        // Замыкание цикла каскадной пары бонусом
        leftOp = 'conditional';
        leftVal = 0;
        leftCondition = conditionalData;
        rightOp = 'add';
        rightVal = addVal + 4;
      } else {
        // Фазовое распределение операций
        const rand = rng();
        if (phase.phaseName === 'warmup') {
          if (rand < 0.5) {
            leftOp = 'add';
            leftVal = addVal + 2;
            rightOp = 'multiply';
            rightVal = multVal;
          } else {
            leftOp = 'multiply';
            leftVal = multVal;
            rightOp = 'add';
            rightVal = addVal;
          }
        } else if (phase.phaseName === 'ramp') {
          if (rand < 0.35) {
            leftOp = 'add';
            leftVal = addVal;
            rightOp = 'multiply';
            rightVal = multVal;
          } else if (rand < 0.70) {
            leftOp = 'multiply';
            leftVal = multVal;
            rightOp = 'subtract';
            rightVal = subVal;
          } else {
            leftOp = 'conditional';
            leftVal = 0;
            leftCondition = conditionalData;
            rightOp = 'add';
            rightVal = addVal;
          }
        } else if (phase.phaseName === 'peak') {
          if (rand < 0.30) {
            leftOp = 'conditional';
            leftVal = 0;
            leftCondition = conditionalData;
            rightOp = 'subtract';
            rightVal = subVal;
          } else if (rand < 0.60) {
            leftOp = 'mystery';
            leftVal = 0;
            rightOp = 'multiply';
            rightVal = multVal;
          } else if (rand < 0.85) {
            leftOp = 'adrenaline';
            leftVal = 0;
            rightOp = 'subtract';
            rightVal = subVal;
          } else {
            leftOp = 'multiply';
            leftVal = multVal;
            rightOp = 'conditional';
            rightVal = 0;
            rightCondition = conditionalData;
          }
        } else if (phase.phaseName === 'corridor') {
          if (rand < 0.40) {
            leftOp = 'multiply';
            leftVal = multVal;
            rightOp = 'add';
            rightVal = addVal + 6;
          } else if (rand < 0.75) {
            leftOp = 'add';
            leftVal = addVal + 8;
            rightOp = 'conditional';
            rightVal = 0;
            rightCondition = conditionalData;
          } else {
            leftOp = 'adrenaline';
            leftVal = 0;
            rightOp = 'add';
            rightVal = addVal + 4;
          }
        } else {
          // climax phase
          if (rand < 0.35) {
            leftOp = 'adrenaline';
            leftVal = 0;
            rightOp = 'conditional';
            rightVal = 0;
            rightCondition = conditionalData;
          } else if (rand < 0.70) {
            leftOp = 'conditional';
            leftVal = 0;
            leftCondition = conditionalData;
            rightOp = 'subtract';
            rightVal = subVal;
          } else {
            leftOp = 'mystery';
            leftVal = 0;
            rightOp = 'multiply';
            rightVal = multVal;
          }
        }
      }

      // Гарантия выбора створки: на уровнях >= 6 для ворот > 2 створки никогда не дублируются
      if (levelNum >= 6 && g > 2 && leftOp === rightOp) {
        rightOp = leftOp === 'multiply' ? 'add' : 'multiply';
        rightVal = rightOp === 'multiply' ? multVal : addVal;
        rightCondition = undefined;
      }

      rawGates.push({
        id: gateId,
        z,
        xLeft: -trackWidth / 4,
        xRight: trackWidth / 4,
        width: trackWidth / 2 - 0.4,
        leftOp,
        leftVal,
        leftCondition,
        rightOp,
        rightVal,
        rightCondition,
        isDynamic: g > 0 && levelNum > 5 && rng() < 0.35,
        flipTimer: 0,
        driftAmplitude:
          g > 0 && levelNum > 3 && rng() < 0.4 ? Math.min(2.2, 0.8 + levelNum * 0.05) : undefined,
        driftSpeed: g > 0 && levelNum > 3 && rng() < 0.4 ? 0.8 + rng() * 0.8 : undefined,
      });
    }

    // Строгое упорядочение ворот по Z
    rawGates.sort((a, b) => a.z - b.z);

    // -------------------------------------------------------------
    // ЭТАП 2: РИТМ УРОВНЯ, ПАТТЕРНЫ ПРЕПЯТСТВИЙ И SAFE CORRIDORS
    // -------------------------------------------------------------
    const allObstacleTypes: ObstacleType[] = [
      'saw_blade',
      'axe_pendulum',
      'crusher',
      'spike_trap',
      'laser_grid',
      'wrecking_ball',
      'lava_pit',
      'barrier_gate',
    ];

    let obsIndex = 0;
    const baseObstacleTarget = Math.min(90, Math.floor(trackLength / 34));

    // Проходим по трассе с шагом и генерируем тактические паттерны с учетом safe corridors
    const sectionStep = 34;
    const numSections = Math.floor((trackLength - 140) / sectionStep);

    for (let s = 0; s < numSections && obsIndex < baseObstacleTarget; s++) {
      const sectionZ = 55 + s * sectionStep + (rng() * 6 - 3);
      const phase = this.getPhaseInfo(sectionZ, trackLength);

      // Safe Corridor: каждые ~136м гарантированный gap без ловушек (реже, чтобы не было пустых участков)
      const isSafeCorridorGap = s % 4 === 3;
      if (isSafeCorridorGap && rng() < 0.45) {
        continue;
      }

      // Выбор паттерна в зависимости от фазы уровня
      const patternRand = rng();

      if (phase.phaseName === 'warmup') {
        // Warmup: одиночные простые ловушки
        const type: ObstacleType = rng() < 0.6 ? 'saw_blade' : 'spike_trap';
        const obsWidth = 2.0;
        const maxHalfX = (trackWidth / 2 - 0.6) - obsWidth / 2;
        const x = (rng() * 2 - 1) * maxHalfX;
        const damage = Math.round((6 + Math.floor(levelNum * 0.16)) * phase.phaseMult);

        rawObstacles.push({
          id: `obs_${levelNum}_${obsIndex++}`,
          type,
          x,
          y: 0,
          z: sectionZ,
          width: obsWidth,
          height: 2,
          depth: 2,
          speed: 1.5 + rng() * 1.5,
          range: Math.min(3.0, maxHalfX),
          initialOffset: rng() * Math.PI * 2,
          damage,
          destructible: false,
          hp: 15,
          maxHp: 15,
        });
      } else if (phase.phaseName === 'ramp') {
        // Ramp: слалом (чередование X +-3 через ~16м) или одиночные ловушки
        if (patternRand < 0.45 && obsIndex + 2 <= baseObstacleTarget) {
          // Паттерн: Слалом из двух препятствий
          const damage = Math.round((6 + Math.floor(levelNum * 0.16)) * phase.phaseMult);
          const side = rng() < 0.5 ? -1 : 1;

          rawObstacles.push({
            id: `obs_${levelNum}_${obsIndex++}`,
            type: 'saw_blade',
            x: side * 3.0,
            y: 0,
            z: sectionZ,
            width: 2.0,
            height: 2,
            depth: 2,
            speed: 2.0,
            range: 1.0,
            initialOffset: 0,
            damage,
            destructible: false,
            hp: 15,
            maxHp: 15,
          });

          rawObstacles.push({
            id: `obs_${levelNum}_${obsIndex++}`,
            type: 'saw_blade',
            x: -side * 3.0,
            y: 0,
            z: sectionZ + 16,
            width: 2.0,
            height: 2,
            depth: 2,
            speed: 2.0,
            range: 1.0,
            initialOffset: Math.PI,
            damage,
            destructible: false,
            hp: 15,
            maxHp: 15,
          });
        } else {
          // Одиночное препятствие
          const type = allObstacleTypes[Math.floor(rng() * allObstacleTypes.length)];
          const obstacleDef = this.createObstacleDef(type, sectionZ, levelNum, obsIndex++, trackWidth, phase.phaseMult, rng);
          rawObstacles.push(obstacleDef);
        }
      } else if (phase.phaseName === 'peak') {
        // Peak: бутылочное горлышко, деструктивный кластер (танки) или тяжелые ловушки
        if (patternRand < 0.35 && obsIndex + 2 <= baseObstacleTarget) {
          // Паттерн: Бутылочное горлышко (flank obstacles, safe center >= 3.5m)
          const damage = Math.round((12 + Math.floor(levelNum * 0.16)) * phase.phaseMult);
          const laserWidth = 4.0;
          const barrierWidth = 3.3;

          rawObstacles.push({
            id: `obs_${levelNum}_${obsIndex++}`,
            type: 'laser_grid',
            x: -(playableHalf - laserWidth / 2),
            y: 0,
            z: sectionZ,
            width: laserWidth,
            height: 2,
            depth: 2,
            speed: 2.0,
            range: 0,
            initialOffset: 0,
            damage,
            destructible: false,
            hp: 15,
            maxHp: 15,
          });

          rawObstacles.push({
            id: `obs_${levelNum}_${obsIndex++}`,
            type: 'barrier_gate',
            x: +(playableHalf - barrierWidth / 2),
            y: 0,
            z: sectionZ + 3,
            width: barrierWidth,
            height: 2,
            depth: 2,
            speed: 2.2,
            range: 0,
            initialOffset: Math.PI * 0.5,
            damage,
            destructible: false,
            hp: 15,
            maxHp: 15,
          });
        } else if (patternRand < 0.70 && obsIndex + 2 <= baseObstacleTarget) {
          // Паттерн: Деструктивный кластер (crusher + axe, стимул для класса Tank)
          const damage = Math.round((12 + Math.floor(levelNum * 0.16)) * phase.phaseMult);

          rawObstacles.push({
            id: `obs_${levelNum}_${obsIndex++}`,
            type: 'crusher',
            x: -2.4,
            y: 0,
            z: sectionZ,
            width: 2.0,
            height: 2,
            depth: 2,
            speed: 2.4,
            range: 1.2,
            initialOffset: 0,
            damage,
            destructible: true,
            hp: 15,
            maxHp: 15,
          });

          rawObstacles.push({
            id: `obs_${levelNum}_${obsIndex++}`,
            type: 'axe_pendulum',
            x: 2.4,
            y: 0,
            z: sectionZ + 7,
            width: 2.0,
            height: 2,
            depth: 2,
            speed: 2.4,
            range: 1.2,
            initialOffset: Math.PI,
            damage,
            destructible: true,
            hp: 15,
            maxHp: 15,
          });
        } else {
          const type = allObstacleTypes[Math.floor(rng() * allObstacleTypes.length)];
          const obstacleDef = this.createObstacleDef(type, sectionZ, levelNum, obsIndex++, trackWidth, phase.phaseMult, rng);
          rawObstacles.push(obstacleDef);
        }
      } else {
        // Climax / Boss-pre phase
        const type = allObstacleTypes[Math.floor(rng() * allObstacleTypes.length)];
        const obstacleDef = this.createObstacleDef(type, sectionZ, levelNum, obsIndex++, trackWidth, phase.phaseMult, rng);
        rawObstacles.push(obstacleDef);
      }
    }

    // -------------------------------------------------------------
    // ЭТАП 1: resolveOverlaps (ГАРАНТИЯ ЧИСТЫХ ВОРОТ И ХИТБОКСОВ)
    // -------------------------------------------------------------
    const obstacles = this.resolveOverlaps(rawGates, rawObstacles, trackWidth, 45, trackLength - 25);
    const gates = rawGates;

    // -------------------------------------------------------------
    // ЭТАП 4: БОНУСЫ И МОНЕТЫ В SAFE CORRIDORS С ОБХОДОМ ХИТБОКСОВ
    // -------------------------------------------------------------
    const coinClusters = Math.min(90, Math.floor(trackLength / 40));
    for (let c = 0; c < coinClusters; c++) {
      const zCenter = 16 + c * (trackLength / Math.max(1, coinClusters));
      const rawXCenter = (rng() - 0.5) * (trackWidth - 4);
      const safeXCenter = this.findSafeCoinX(rawXCenter, zCenter, obstacles, trackWidth);

      for (let i = 0; i < 4; i++) {
        const coinZ = zCenter + i * 1.5;
        const individualSafeX = this.findSafeCoinX(safeXCenter, coinZ, obstacles, trackWidth);
        coins.push({
          id: `coin_${levelNum}_${c}_${i}`,
          x: individualSafeX,
          y: 0.5,
          z: coinZ,
          value: 10,
        });
      }
    }

    // -------------------------------------------------------------
    // ЭТАП 4: ДИНАМИЧЕСКИЕ СОБЫТИЯ ПО ФАЗАМ
    // -------------------------------------------------------------
    if (levelNum >= 3) {
      const eventPool: LevelDynamicEvent['type'][] = [
        'coin_train',
        'speed_boost',
        'ambush',
        'emp_storm',
        'meteor_rain',
      ];
      const maxEventZ = Math.max(50, trackLength - 90);

      // 1-е событие — фазовое распределение по модулю уровня
      const firstType = eventPool[(levelNum - 3) % 5];
      let firstZ = trackLength * 0.4;
      if (firstType === 'coin_train') firstZ = trackLength * 0.72;
      else if (firstType === 'speed_boost') firstZ = trackLength * 0.38;
      else if (firstType === 'ambush') firstZ = trackLength * 0.48;
      else if (firstType === 'emp_storm') firstZ = trackLength * 0.58;
      else if (firstType === 'meteor_rain') firstZ = trackLength * 0.32;

      events.push({
        triggerZ: Math.max(45, Math.min(firstZ, maxEventZ)),
        type: firstType,
        duration: 5.0,
        intensity: 1.0 + levelNum * 0.04,
      });

      // На уровнях >= 15 (не-босс) — 2-е событие
      if (levelNum >= 15 && !isBossLevel) {
        let secondType = eventPool[(levelNum * 3 + 1) % 5];
        if (secondType === firstType) {
          secondType = eventPool[(levelNum * 3 + 2) % 5];
        }

        const secondZ = Math.max(events[0].triggerZ + 60, Math.min(trackLength * 0.76, maxEventZ));
        if (secondZ > events[0].triggerZ + 10) {
          events.push({
            triggerZ: secondZ,
            type: secondType,
            duration: 5.0,
            intensity: 1.0 + levelNum * 0.04,
          });
        }
      }

      events.sort((a, b) => a.triggerZ - b.triggerZ);
    }

    // Boss Data for milestone levels
    let boss: BossData | undefined;
    if (isBossLevel) {
      boss = this.generateBoss(levelNum, biome);
    }

    return {
      levelNumber: levelNum,
      biome,
      trackLength,
      trackWidth,
      startingMobs,
      targetMobsToWin,
      gates,
      obstacles,
      coins,
      events,
      boss,
      multiplierWallSteps: 10,
    };
  }

  private static createObstacleDef(
    type: ObstacleType,
    z: number,
    levelNum: number,
    index: number,
    trackWidth: number,
    phaseMult: number,
    rng: () => number
  ): ObstacleData {
    const playableHalf = trackWidth / 2 - TRACK_RAIL_MARGIN;
    let obsWidth: number;
    let x: number;
    let range: number;

    if (type === 'laser_grid') {
      obsWidth = 4.0;
      const side = rng() < 0.5 ? -1 : 1;
      x = side * (playableHalf - obsWidth / 2);
      range = 0;
    } else if (type === 'wrecking_ball') {
      obsWidth = 2.4;
      x = (rng() * 2 - 1) * (playableHalf - 1.2);
      range = Math.min(3.0, playableHalf - 1.2);
    } else if (type === 'lava_pit') {
      obsWidth = 2.4;
      x = (rng() * 2 - 1) * (playableHalf - 1.2);
      range = 0;
    } else if (type === 'barrier_gate') {
      obsWidth = 3.3;
      x = (rng() * 2 - 1) * (playableHalf - 1.65);
      range = 0;
    } else {
      const maxHalfX = (trackWidth / 2 - 0.6) - 1.0;
      obsWidth = 2.0;
      x = (rng() * 2 - 1) * maxHalfX;
      range = Math.min(3.5, maxHalfX);
    }

    const baseDmg = type === 'saw_blade' || type === 'laser_grid' || type === 'spike_trap' ? 6 : 12;
    const damage = Math.round((baseDmg + Math.floor(levelNum * 0.16)) * phaseMult);

    return {
      id: `obs_${levelNum}_${index}`,
      type,
      x,
      y: 0,
      z,
      width: obsWidth,
      height: 2,
      depth: 2,
      speed: 1.5 + rng() * 2.0,
      range,
      initialOffset: rng() * Math.PI * 2,
      damage,
      destructible: type === 'crusher' || type === 'axe_pendulum' || type === 'wrecking_ball',
      hp: 15,
      maxHp: 15,
    };
  }

  public static resolveOverlaps(
    gates: GateData[],
    obstacles: ObstacleData[],
    trackWidth: number,
    minZ: number,
    maxZ: number
  ): ObstacleData[] {
    const validObstacles: ObstacleData[] = [];

    for (const obs of obstacles) {
      if (obs.z < minZ || obs.z > maxZ) {
        continue;
      }

      let safeZ = obs.z;
      let hasGateOverlap = gates.some((g) => Math.abs(g.z - safeZ) < GATE_CLEARANCE);

      if (hasGateOverlap) {
        let resolved = false;
        for (let attempt = 1; attempt <= 6; attempt++) {
          const offset = attempt * 4.5;
          const candidateForward = obs.z + offset;
          if (
            candidateForward <= maxZ &&
            !gates.some((g) => Math.abs(g.z - candidateForward) < GATE_CLEARANCE)
          ) {
            safeZ = candidateForward;
            resolved = true;
            break;
          }
          const candidateBackward = obs.z - offset;
          if (
            candidateBackward >= minZ &&
            !gates.some((g) => Math.abs(g.z - candidateBackward) < GATE_CLEARANCE)
          ) {
            safeZ = candidateBackward;
            resolved = true;
            break;
          }
        }
        if (!resolved) {
          continue;
        }
      }

      // Финальная проверка clearance по Z
      if (gates.some((g) => Math.abs(g.z - safeZ) < GATE_CLEARANCE)) {
        continue;
      }

      // Проверка и клампинг ширины и координат X
      let obsWidth = obs.width;
      if (obs.type === 'barrier_gate') {
        obsWidth = Math.min(3.3, obsWidth);
      }
      obsWidth = Math.min(trackWidth - 3.2, obsWidth);

      const maxAllowedHalfX = trackWidth / 2 - obsWidth / 2 - 0.05;
      const safeX = Math.max(-maxAllowedHalfX, Math.min(maxAllowedHalfX, obs.x));

      let safeRange = obs.range;
      if (safeRange > 0) {
        safeRange = Math.min(safeRange, trackWidth / 2 - Math.abs(safeX) - obsWidth / 2);
        if (safeRange < 0) safeRange = 0;
      }

      validObstacles.push({
        ...obs,
        x: safeX,
        z: safeZ,
        width: obsWidth,
        range: safeRange,
      });
    }

    validObstacles.sort((a, b) => a.z - b.z);

    if (validObstacles.length > 90) {
      validObstacles.length = 90;
    }

    return validObstacles;
  }

  public static findSafeCoinX(
    candidateX: number,
    z: number,
    obstacles: ObstacleData[],
    trackWidth: number
  ): number {
    const maxPlayableX = trackWidth / 2 - 1.2;
    const nearbyObs = obstacles.filter((obs) => Math.abs(obs.z - z) < 2.5);

    if (nearbyObs.length === 0) {
      return Math.max(-maxPlayableX, Math.min(maxPlayableX, candidateX));
    }

    // Проверяем, свободна ли исходная позиция
    let isCandidateSafe = true;
    for (const obs of nearbyObs) {
      if (Math.abs(candidateX - obs.x) <= obs.width / 2 + 0.6) {
        isCandidateSafe = false;
        break;
      }
    }
    if (isCandidateSafe) {
      return Math.max(-maxPlayableX, Math.min(maxPlayableX, candidateX));
    }

    // Подбираем свободную полосу
    const testLanes = [0, -3.2, 3.2, -5.0, 5.0, -2.0, 2.0, -4.0, 4.0, -1.0, 1.0];
    for (const lane of testLanes) {
      if (Math.abs(lane) > maxPlayableX) continue;
      let laneSafe = true;
      for (const obs of nearbyObs) {
        if (Math.abs(lane - obs.x) <= obs.width / 2 + 0.6) {
          laneSafe = false;
          break;
        }
      }
      if (laneSafe) {
        return lane;
      }
    }

    // Если все перекрыты, выбираем самую удаленную от центров препятствий
    let bestLane = 0;
    let maxDist = -1;
    for (const lane of testLanes) {
      if (Math.abs(lane) > maxPlayableX) continue;
      let minDistToObs = 999;
      for (const obs of nearbyObs) {
        const d = Math.abs(lane - obs.x) - obs.width / 2;
        if (d < minDistToObs) minDistToObs = d;
      }
      if (minDistToObs > maxDist) {
        maxDist = minDistToObs;
        bestLane = lane;
      }
    }
    return bestLane;
  }

  private static generateBoss(levelNum: number, biome: BiomeType): BossData {
    const bossMap: Record<number, Partial<BossData>> = {
      10: {
        id: 'boss_10',
        nameKey: 'boss1Name',
        titleKey: 'boss1Title',
        modelType: 'iron_golem',
        maxHp: 150,
      },
      20: {
        id: 'boss_20',
        nameKey: 'boss2Name',
        titleKey: 'boss2Title',
        modelType: 'magma_colossus',
        maxHp: 350,
      },
      30: {
        id: 'boss_30',
        nameKey: 'boss3Name',
        titleKey: 'boss3Title',
        modelType: 'crystal_wyrm',
        maxHp: 650,
      },
      40: {
        id: 'boss_40',
        nameKey: 'boss4Name',
        titleKey: 'boss4Title',
        modelType: 'titan_nullifier',
        maxHp: 1100,
      },
      50: {
        id: 'boss_50',
        nameKey: 'boss5Name',
        titleKey: 'boss5Title',
        modelType: 'apex_overlord',
        maxHp: 2000,
      },
    };

    const def = bossMap[levelNum] || bossMap[10];

    return {
      id: def.id || `boss_${levelNum}`,
      nameKey: def.nameKey || 'boss1Name',
      titleKey: def.titleKey || 'boss1Title',
      maxHp: def.maxHp || 200,
      hp: def.maxHp || 200,
      biome,
      modelType: def.modelType || 'iron_golem',
      attacks: [
        { type: 'slam', telegraphTime: 1.5, duration: 0.8, damage: 15, areaRadius: 3.5 },
        { type: 'laser', telegraphTime: 2.0, duration: 1.2, damage: 25, direction: 0 },
        { type: 'minions', telegraphTime: 1.0, duration: 0.5, damage: 10 },
      ],
    };
  }

  public static generateEndlessSegment(
    segmentIndex: number,
    currentZ: number
  ): {
    gates: GateData[];
    obstacles: ObstacleData[];
    coins: CoinData[];
    length: number;
  } {
    const length = 120;
    const rawGates: GateData[] = [];
    const rawObstacles: ObstacleData[] = [];
    const coins: CoinData[] = [];
    const trackWidth = DEFAULT_TRACK_WIDTH;
    const playableHalf = trackWidth / 2 - TRACK_RAIL_MARGIN;

    // Детерминированный PRNG для бесконечного режима
    const rng = createRng(segmentIndex * 7919 + 9973);

    // 2-3 Ворот в сегменте
    const gateCount = 2 + (rng() < 0.5 ? 1 : 0);
    const gateSpacing = (length - 40) / Math.max(1, gateCount);
    for (let i = 0; i < gateCount; i++) {
      const z = currentZ + 20 + i * gateSpacing + (rng() * 4 - 2);
      const leftIsMult = rng() < 0.5;
      const leftOp: GateOp = leftIsMult ? 'multiply' : 'add';
      const leftVal = leftIsMult ? 2.0 : 10 + Math.floor(rng() * 8);

      let rightOp: GateOp;
      let rightVal = 0;
      const randR = rng();
      if (randR < 0.35) {
        rightOp = leftOp === 'add' ? 'multiply' : 'add';
        rightVal = rightOp === 'multiply' ? 1.8 : 12;
      } else if (randR < 0.65) {
        rightOp = 'subtract';
        rightVal = 5 + Math.floor(rng() * 6);
      } else if (randR < 0.85) {
        rightOp = 'conditional';
        rightVal = 0;
      } else {
        rightOp = 'adrenaline';
        rightVal = 0;
      }

      if (rightOp === leftOp) {
        rightOp = leftOp === 'add' ? 'multiply' : 'add';
        rightVal = rightOp === 'multiply' ? 2.0 : 8;
      }

      const conditionalData = {
        minMobs: 12 + Math.floor(rng() * 8),
        passOp: 'multiply' as GateOp,
        passVal: 2.2,
        failOp: 'subtract' as GateOp,
        failVal: 6,
      };

      rawGates.push({
        id: `endless_gate_${segmentIndex}_${i}`,
        z,
        xLeft: -trackWidth / 4,
        xRight: trackWidth / 4,
        width: trackWidth / 2 - 0.4,
        leftOp,
        leftVal,
        leftCondition: undefined,
        rightOp,
        rightVal,
        rightCondition: rightOp === 'conditional' ? conditionalData : undefined,
        isDynamic: rng() < 0.25,
        flipTimer: 0,
        driftAmplitude: rng() < 0.35 ? Math.min(2.0, 1.0 + rng() * 1.0) : undefined,
        driftSpeed: rng() < 0.35 ? 0.8 + rng() * 0.8 : undefined,
      });
    }

    rawGates.sort((a, b) => a.z - b.z);
    const gates = rawGates;

    // 4-5 Препятствий в сегменте
    const endlessTypes: ObstacleType[] = [
      'saw_blade',
      'axe_pendulum',
      'crusher',
      'spike_trap',
      'laser_grid',
      'wrecking_ball',
      'lava_pit',
      'barrier_gate',
    ];

    const obsCount = 4 + (rng() < 0.5 ? 1 : 0);
    for (let o = 0; o < obsCount; o++) {
      const z = currentZ + 12 + o * (length / Math.max(1, obsCount)) + (rng() * 4 - 2);
      const type = endlessTypes[Math.floor(rng() * endlessTypes.length)];

      let obsWidth = 2.0;
      let x = 0;
      let range = 0;

      if (type === 'laser_grid') {
        obsWidth = 4.0;
        const side = rng() < 0.5 ? -1 : 1;
        x = side * (playableHalf - obsWidth / 2);
        range = 0;
      } else if (type === 'wrecking_ball') {
        obsWidth = 2.4;
        x = (rng() * 2 - 1) * (playableHalf - 1.2);
        range = Math.min(3.0, playableHalf - 1.2);
      } else if (type === 'lava_pit') {
        obsWidth = 2.4;
        x = (rng() * 2 - 1) * (playableHalf - 1.2);
        range = 0;
      } else if (type === 'barrier_gate') {
        obsWidth = 3.3;
        x = (rng() * 2 - 1) * (playableHalf - 1.5);
        range = 0;
      } else {
        const maxHalfX = (trackWidth / 2 - 0.6) - 1.0;
        obsWidth = 2.0;
        x = (rng() * 2 - 1) * maxHalfX;
        range = Math.min(3.5, maxHalfX);
      }

      rawObstacles.push({
        id: `endless_obs_${segmentIndex}_${o}`,
        type,
        x,
        y: 0,
        z,
        width: obsWidth,
        height: 2,
        depth: 2,
        speed: 1.8 + rng() * 1.5,
        range,
        initialOffset: rng() * Math.PI * 2,
        damage: type === 'saw_blade' || type === 'laser_grid' || type === 'spike_trap' ? 6 : 12,
        destructible: type === 'crusher' || type === 'axe_pendulum' || type === 'wrecking_ball',
        hp: 15,
        maxHp: 15,
      });
    }

    const obstacles = this.resolveOverlaps(
      gates,
      rawObstacles,
      trackWidth,
      currentZ + 4,
      currentZ + length - 4
    );

    // Монеты с гарантированным обходом хитбоксов
    for (let c = 0; c < 10; c++) {
      const coinZ = currentZ + 8 + c * 11;
      const rawCoinX = (rng() - 0.5) * (trackWidth - 4);
      const safeCoinX = this.findSafeCoinX(rawCoinX, coinZ, obstacles, trackWidth);

      coins.push({
        id: `endless_coin_${segmentIndex}_${c}`,
        x: safeCoinX,
        y: 0.5,
        z: coinZ,
        value: 10,
      });
    }

    return { gates, obstacles, coins, length };
  }
}
