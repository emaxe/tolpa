import {
  BiomeType,
  LevelConfig,
  GateData,
  WallData,
  GateMotion,
  BonusData,
  BonusType,
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

export type PatternType =
  | 'slalom_cascade'
  | 'choke_point_funnel'
  | 'checkerboard_hazard'
  | 'tank_breach_cluster'
  | 'gate_trap_dilemma'
  | 'central_bastion_split'
  | 'pendulum_sweep_wave'
  | 'cyborg_hound_pack'
  | 'single_hazard';

export interface PatternContext {
  out: ObstacleData[];
  z0: number;
  levelNum: number;
  trackWidth: number;
  playableHalf: number;
  phaseMult: number;
  rng: () => number;
  rawGates: GateData[];
  rawWalls: WallData[];
  coins: CoinData[];
  bonuses: BonusData[];
  idPrefix?: string;
}

export class LevelGenerator {
  /** Цикл биомов для бесконечного режима: после сегмента 40 кампанийный
   *  getBiomeForLevel навсегда застревает на celestial_core, поэтому в Endless
   *  используем строгий циклический обход всех 5 биомов, чтобы вариативность
   *  окружения не умирала на длинных забегах. */
  private static readonly ENDLESS_BIOME_CYCLE: BiomeType[] = [
    'cyber_city',
    'magma_citadel',
    'crystal_cavern',
    'quantum_void',
    'celestial_core',
  ];

  /** Биом для бесконечного сегмента: строго по кругу через все 5 биомов.
   *  segmentIndex 0 → cyber_city (совпадает с инициализацией endlessBiome). */
  public static getEndlessBiome(segmentIndex: number): BiomeType {
    const i = Math.max(0, segmentIndex) % LevelGenerator.ENDLESS_BIOME_CYCLE.length;
    return LevelGenerator.ENDLESS_BIOME_CYCLE[i];
  }

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
    const rawWalls: WallData[] = [];
    const rawObstacles: ObstacleData[] = [];
    const coins: CoinData[] = [];
    const bonuses: BonusData[] = [];
    const events: LevelDynamicEvent[] = [];

    const startingMobs = 8;
    const targetMobsToWin = Math.min(100, 8 + Math.floor(levelNum * 1.8));

    // -------------------------------------------------------------
    // ЭТАП 3: НЕЗАВИСИМЫЕ ВОРОТА (add/divide) и СТЕНЫ (−N со счётчиком)
    // -------------------------------------------------------------
    // Ворота теперь независимые: 1..3 на ряд, могут быть уступами, занимать часть ширины
    // или всю, и могут двигаться/вращаться. Операции позитивные (add/divide/multiply).
    // multiply (×N) возрождён: редкая награда за риск, N∈{2,3}, не раньше 3-х ворот.
    // subtract (−N) вынесен в отдельные стены со счётчиком.
    const motionTypes: GateMotion[] = ['none', 'none', 'none', 'horizontal', 'vertical', 'rotate'];
    const gateCount = Math.min(40, 16 + Math.floor(levelNum / 2));
    const baseGateSpacing = (trackLength - 120) / Math.max(1, gateCount);

    const laneOffset = trackWidth / 2 - 2.0;
    let lastLane = 1; // средний лейн перед циклом

    let currentGateZ = 32;
    for (let g = 0; g < gateCount; g++) {
      const z = g === 0 ? 32 + rng() * 2 : currentGateZ + baseGateSpacing + (rng() * 4 - 2);
      currentGateZ = z;

      const addVal = Math.max(3, Math.round(6 + Math.floor(rng() * 8) + Math.floor(levelNum * 0.12)));
      const divVal = 2 + Math.floor(rng() * 2); // 2 или 3

      // Выбор операции: на старте безопасный add, дальше add/divide/multiply.
      // multiply (×N) — редкая награда за риск (N∈{2,3}), не раньше 3-х ворот.
      let op: GateOp;
      let value: number;
      if (g < 2) {
        op = 'add';
        value = addVal;
      } else {
        // add/divide поровну, с лёгким перекосом в add на ранних уровнях.
        // mystery — редкая операция риска/награды (~12%).
        // multiply — редкая награда за риск (~10%), N∈{2,3}.
        const addChance = levelNum < 5 ? 0.6 : 0.45;
        const roll = rng();
        if (roll < addChance) {
          op = 'add';
          value = addVal;
        } else if (roll < addChance + 0.1) {
          op = 'multiply';
          value = 2 + Math.floor(rng() * 2); // 2 или 3
        } else if (roll < addChance + 0.22) {
          op = 'mystery';
          value = 8 + Math.floor(rng() * 6);
        } else {
          op = 'divide';
          value = divVal;
        }
      }

      // 1..3 ворот на ряд уступами: 3-полосная сетка лейнов.
      const rowCount = 1 + Math.floor(rng() * 3); // 1..3
      let x: number;
      let width: number;
      if (rowCount === 1) {
        let lane = Math.floor(rng() * 3);
        if (lane === lastLane) lane = (lane + 1) % 3;
        lastLane = lane;
        x = (lane - 1) * laneOffset;
        width = 4.2;
      } else {
        const baseLane = lastLane;
        const slot = g % rowCount;
        const lane = (baseLane + slot) % 3;
        lastLane = lane;
        x = (lane - 1) * laneOffset;
        width = rowCount === 2 ? trackWidth / 2 - 0.6 : laneOffset - 0.6;
      }
      // Не даём воротам выйти за трассу.
      x = Math.max(-(trackWidth / 2 - width / 2 - 0.4), Math.min(trackWidth / 2 - width / 2 - 0.4, x));

      const motion = motionTypes[Math.floor(rng() * motionTypes.length)];
      const motionSpeed = motion === 'none' ? 0 : 0.8 + rng() * 1.0;
      const motionRange = motion === 'horizontal' || motion === 'vertical'
        ? 1.2 + rng() * 1.6
        : motion === 'rotate' ? 0.5 + rng() * 0.6 : 0;

      rawGates.push({
        id: `gate_${levelNum}_${g}`,
        z,
        x,
        width,
        op,
        value,
        motion,
        motionSpeed,
        motionRange,
      });
    }

    // СТЕНЫ (−N со счётчиком): появляются с уровня 3, не на старте и не впритык к воротам.
    const wallCount = levelNum >= 3 ? Math.min(12, 2 + Math.floor(levelNum / 8)) : 0;
    for (let w = 0; w < wallCount; w++) {
      const wallZ = 80 + w * ((trackLength - 160) / Math.max(1, wallCount)) + (rng() * 8 - 4);
      // Не ставим стену вплотную к воротам и к босс-арене.
      if (Math.abs(wallZ - currentGateZ) < 8) continue;
      if (wallZ > trackLength - 60) continue;
      const wallWidth = Math.min(trackWidth - 2.4, 3.5 + rng() * 3.5);
      let wallX = (Math.floor(rng() * 3) - 1) * laneOffset;
      wallX = Math.max(-(trackWidth / 2 - wallWidth / 2 - 0.4), Math.min(trackWidth / 2 - wallWidth / 2 - 0.4, wallX));
      rawWalls.push({
        id: `wall_${levelNum}_${w}`,
        z: wallZ,
        x: wallX,
        width: wallWidth,
        count: 5 + Math.floor(rng() * 6) + Math.floor(levelNum * 0.25),
        killsRemaining: 0, // перезапишем ниже одним значением
      });
    }
    // Синхронизируем killsRemaining = count одним числом (два отдельных rng давали разные значения).
    for (const w of rawWalls) {
      w.killsRemaining = w.count;
    }

    // Строгое упорядочение ворот и стен по Z
    rawGates.sort((a, b) => a.z - b.z);
    rawWalls.sort((a, b) => a.z - b.z);

    // -------------------------------------------------------------
    // ЭТАП 2: РИТМ УРОВНЯ, ПАТТЕРНЫ ПРЕПЯТСТВИЙ И SAFE CORRIDORS
    // -------------------------------------------------------------
    let obsIndex = 0;
    const baseObstacleTarget = Math.min(120, Math.floor(trackLength / 26));

    let sectionZ = 55;
    let lastPattern: PatternType | null = null;
    let sectionIndex = 0;

    while (sectionZ < trackLength - 60 && obsIndex < baseObstacleTarget) {
      const phase = this.getPhaseInfo(sectionZ, trackLength);

      // Safe Corridor: каждые ~4 секции gap без ловушек (реже, чтобы не было пустых участков)
      if (sectionIndex % 4 === 3 && rng() < 0.45) {
        sectionIndex++;
        sectionZ += 26;
        continue;
      }
      sectionIndex++;

      const pattern = this.selectPattern(phase.phaseName, levelNum, lastPattern, rng);
      lastPattern = pattern;
      const span = this.runPattern(
        pattern,
        {
          out: rawObstacles,
          z0: sectionZ,
          levelNum,
          trackWidth,
          playableHalf,
          phaseMult: phase.phaseMult,
          rng,
          rawGates,
          rawWalls,
          coins,
          bonuses,
        },
        phase.phaseName
      );
      obsIndex += span.count;
      sectionZ += Math.max(26, span.spanZ);
    }

    // -------------------------------------------------------------
    // ЭТАП 1: resolveOverlaps (ГАРАНТИЯ ЧИСТЫХ ВОРОТ И ХИТБОКСОВ)
    // -------------------------------------------------------------
    const obstacles = this.resolveOverlaps(rawGates, rawObstacles, trackWidth, 45, trackLength - 25);
    const gates = rawGates;

    // -------------------------------------------------------------
    // ЭТАП 3.5: БОНУСЫ (собираемые светящиеся сферы) — в safe corridors, мимо ворот и препятствий
    // -------------------------------------------------------------
    const bonusCount = Math.min(14, 4 + Math.floor(levelNum / 4));
    for (let b = 0; b < bonusCount; b++) {
      const z = 60 + b * ((trackLength - 120) / Math.max(1, bonusCount)) + (rng() * 6 - 3);
      const x = (rng() * 2 - 1) * (trackWidth / 2 - 2.2);
      // Не ставить бонус вплотную к воротам (чтоб не путать с створками) и к препятствиям.
      const nearGate = gates.some((g) => Math.abs(g.z - z) < GATE_CLEARANCE);
      const nearObs = obstacles.some((o) => Math.abs(o.z - z) < 4);
      if (nearGate || nearObs) continue;

      const roll = rng();
      let type: BonusType;
      let value: number;
      if (roll < 0.40) {
        type = 'add_mobs';
        value = 6 + Math.floor(rng() * 6) + Math.floor(levelNum * 0.15);
      } else if (roll < 0.62) {
        type = 'heal';
        value = 2 + Math.floor(levelNum * 0.06); // +N hp всем живым
      } else if (roll < 0.80) {
        type = 'adrenaline';
        value = 4 + Math.floor(levelNum * 0.04); // сек гипер-режима
      } else {
        type = 'coins';
        value = 25 + Math.floor(rng() * 25) + levelNum * 2;
      }

      bonuses.push({
        id: `bonus_${levelNum}_${b}`,
        type,
        x,
        y: 1.0,
        z,
        value,
      });
    }

    // -------------------------------------------------------------
    // ЭТАП 4: БОНУСЫ И МОНЕТЫ В SAFE CORRIDORS С ОБХОДОМ ХИТБОКСОВ
    // -------------------------------------------------------------
    const coinClusters = Math.min(90, Math.floor(trackLength / 40));
    for (let c = 0; c < coinClusters; c++) {
      const zCenter = 16 + c * (trackLength / Math.max(1, coinClusters));
      const rawXCenter = (rng() - 0.5) * (trackWidth - 4);
      const safeXCenter = this.findSafeCoinX(rawXCenter, zCenter, obstacles, trackWidth);
      if (safeXCenter === null) continue;

      for (let i = 0; i < 4; i++) {
        const coinZ = zCenter + i * 1.5;
        const individualSafeX = this.findSafeCoinX(safeXCenter, coinZ, obstacles, trackWidth);
        if (individualSafeX === null) continue;
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

    // Кап и упорядочение элементов уровня
    rawWalls.sort((a, b) => a.z - b.z);
    if (rawWalls.length > 12) rawWalls.length = 12;

    bonuses.sort((a, b) => a.z - b.z);
    if (bonuses.length > 14) bonuses.length = 14;

    coins.sort((a, b) => a.z - b.z);
    if (coins.length > 360) coins.length = 360;

    // Данные босса для юбилейных уровней (10, 20, 30, 40, 50)
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
      walls: rawWalls,
      bonuses,
      obstacles,
      coins,
      events,
      boss,
      multiplierWallSteps: 10,
    };
  }

  private static pickObstacleType(
    phaseName: PhaseInfo['phaseName'],
    rng: () => number
  ): ObstacleType {
    if (phaseName === 'warmup') {
      return rng() < 0.6 ? 'saw_blade' : 'spike_trap';
    } else if (phaseName === 'ramp') {
      const pool: ObstacleType[] = ['saw_blade', 'spike_trap', 'crusher', 'axe_pendulum', 'rolling_spike_ball'];
      return pool[Math.floor(rng() * pool.length)];
    } else if (phaseName === 'peak') {
      const pool: ObstacleType[] = [
        'saw_blade',
        'crusher',
        'axe_pendulum',
        'laser_grid',
        'barrier_gate',
        'bomb',
        'guard_dog',
        'swinging_hammer',
        'rolling_spike_ball',
      ];
      return pool[Math.floor(rng() * pool.length)];
    } else {
      // corridor / climax: all obstacles available
      const pool: ObstacleType[] = [
        'saw_blade',
        'axe_pendulum',
        'crusher',
        'spike_trap',
        'laser_grid',
        'wrecking_ball',
        'lava_pit',
        'barrier_gate',
        'bomb',
        'guard_dog',
        'swinging_hammer',
        'rolling_spike_ball',
      ];
      return pool[Math.floor(rng() * pool.length)];
    }
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
    let baseDmg = 12;
    let speed = 1.5 + rng() * 2.0;

    if (type === 'laser_grid') {
      obsWidth = 4.0;
      const side = rng() < 0.5 ? -1 : 1;
      x = side * (playableHalf - obsWidth / 2);
      range = 0;
      baseDmg = 6;
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
    } else if (type === 'bomb') {
      obsWidth = 2.4;
      x = (rng() * 2 - 1) * (playableHalf - 1.2);
      range = 3.5;
      baseDmg = 999;
      speed = 0.8;
    } else if (type === 'guard_dog') {
      obsWidth = 2.0;
      x = (rng() * 2 - 1) * (playableHalf - 1.0);
      range = 2.6;
      baseDmg = 1;
      speed = 1.6;
    } else if (type === 'swinging_hammer') {
      obsWidth = 3.2;
      x = (rng() * 2 - 1) * (playableHalf - 1.6);
      range = 0;
      baseDmg = 20;
      speed = 1.8 + rng() * 0.8;
    } else if (type === 'rolling_spike_ball') {
      obsWidth = 2.2;
      x = (rng() * 2 - 1) * (playableHalf - 1.1);
      range = 2.0;
      baseDmg = 15;
      speed = 2.5;
    } else if (type === 'saw_blade') {
      const bladeHalf = 0.85; // половина диска
      obsWidth = 2.0;
      // Полный свип: пила ездит от левого до правого борта.
      x = 0;
      range = Math.max(0, trackWidth / 2 - obsWidth / 2 - 0.6); // ~6.8 при trackWidth 16
      baseDmg = 6;
    } else if (type === 'spike_trap') {
      obsWidth = 2.0;
      // Шипы статичны: размещаем по лейну, квантовано.
      x = (Math.floor(rng() * 3) - 1) * (trackWidth / 2 - 2.0);
      range = 0;
      baseDmg = 6;
    } else {
      const maxHalfX = (trackWidth / 2 - 0.6) - 1.0;
      obsWidth = 2.0;
      x = (rng() * 2 - 1) * maxHalfX;
      range = Math.min(3.5, maxHalfX);
    }

    const damage = type === 'bomb' ? 999 : type === 'guard_dog' ? 1 : Math.round((baseDmg + Math.floor(levelNum * 0.16)) * phaseMult);

    return {
      id: `obs_${levelNum}_${index}`,
      type,
      x,
      y: 0,
      z,
      width: obsWidth,
      height: 2,
      depth: 2,
      speed,
      range,
      initialOffset: rng() * Math.PI * 2,
      damage,
      attackRate: type === 'guard_dog' ? Math.min(3, 1 + Math.floor(levelNum / 17)) : undefined,
      destructible:
        type === 'crusher' ||
        type === 'axe_pendulum' ||
        type === 'wrecking_ball' ||
        type === 'guard_dog' ||
        type === 'swinging_hammer',
      hp: 15,
      maxHp: 15,
    };
  }

  /**
   * Создаёт препятствие через createObstacleDef и переопределяет параметры
   */
  private static pushObs(
    out: ObstacleData[],
    type: ObstacleType,
    z: number,
    x: number,
    levelNum: number,
    trackWidth: number,
    phaseMult: number,
    rng: () => number,
    overrides?: Partial<ObstacleData>
  ): void {
    const index = out.length;
    const def = this.createObstacleDef(type, z, levelNum, index, trackWidth, phaseMult, rng);
    def.x = x;
    def.z = z;
    if (overrides) {
      Object.assign(def, overrides);
    }
    out.push(def);
  }

  // 1. Слалом из 3 препятствий (чередование сторон X=±3.6, шаг Z=12м)
  private static patternSlalomCascade(ctx: PatternContext): { count: number; spanZ: number } {
    const types: ObstacleType[] = ['saw_blade', 'rolling_spike_ball', 'axe_pendulum'];
    const chosenType = types[Math.floor(ctx.rng() * types.length)];
    const side = ctx.rng() < 0.5 ? -1 : 1;
    const idPrefix = ctx.idPrefix;

    for (let i = 0; i < 3; i++) {
      const x = (i % 2 === 0 ? side : -side) * 3.6;
      const z = ctx.z0 + i * 12;
      const initialOffset = i % 2 === 0 ? 0 : Math.PI;
      this.pushObs(
        ctx.out,
        chosenType,
        z,
        x,
        ctx.levelNum,
        ctx.trackWidth,
        ctx.phaseMult,
        ctx.rng,
        {
          range: 1.0,
          initialOffset,
          ...(idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : {}),
        }
      );
    }

    return { count: 3, spanZ: 28 };
  }

  // 2. Бутылочное горлышко (2 фланговых ловушки X=±4.8, безопасный центр >=3.5м, +3 монеты)
  private static patternChokePointFunnel(ctx: PatternContext): { count: number; spanZ: number } {
    const idPrefix = ctx.idPrefix;
    // Левый фланг
    this.pushObs(
      ctx.out,
      'laser_grid',
      ctx.z0,
      -4.8,
      ctx.levelNum,
      ctx.trackWidth,
      ctx.phaseMult,
      ctx.rng,
      {
        width: 4.0,
        range: 0,
        initialOffset: 0,
        ...(idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : {}),
      }
    );

    // Правый фланг
    this.pushObs(
      ctx.out,
      'barrier_gate',
      ctx.z0 + 3,
      4.8,
      ctx.levelNum,
      ctx.trackWidth,
      ctx.phaseMult,
      ctx.rng,
      {
        width: 3.3,
        range: 0,
        initialOffset: Math.PI * 0.5,
        ...(idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : {}),
      }
    );

    // +3 монеты по центру (свободная зона)
    if (ctx.coins.length <= 350) {
      for (let i = 0; i < 3; i++) {
        ctx.coins.push({
          id: `coin_${ctx.levelNum}_choke_${Math.floor(ctx.z0)}_${i}`,
          x: 0,
          y: 0.5,
          z: ctx.z0 + i * 2.0,
          value: 10,
        });
      }
    }

    return { count: 2, spanZ: 14 };
  }

  // 3. Шахматная сетка из 4 точечных ловушек (2 ряда по 2 ловушки)
  private static patternCheckerboardHazard(ctx: PatternContext): { count: number; spanZ: number } {
    const pool: ObstacleType[] = ['spike_trap', 'bomb', 'lava_pit'];
    const idPrefix = ctx.idPrefix;

    const r1o1 = pool[Math.floor(ctx.rng() * pool.length)];
    const r1o2 = pool[Math.floor(ctx.rng() * pool.length)];
    const r2o1 = pool[Math.floor(ctx.rng() * pool.length)];
    const r2o2 = pool[Math.floor(ctx.rng() * pool.length)];

    // Ряд 1: X = -4.0, +1.8
    this.pushObs(ctx.out, r1o1, ctx.z0, -4.0, ctx.levelNum, ctx.trackWidth, ctx.phaseMult, ctx.rng, {
      range: 0,
      ...(idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : {}),
    });
    this.pushObs(ctx.out, r1o2, ctx.z0, 1.8, ctx.levelNum, ctx.trackWidth, ctx.phaseMult, ctx.rng, {
      range: 0,
      ...(idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : {}),
    });

    // Ряд 2: X = -1.8, +4.0 (Z + 10)
    this.pushObs(ctx.out, r2o1, ctx.z0 + 10, -1.8, ctx.levelNum, ctx.trackWidth, ctx.phaseMult, ctx.rng, {
      range: 0,
      ...(idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : {}),
    });
    this.pushObs(ctx.out, r2o2, ctx.z0 + 10, 4.0, ctx.levelNum, ctx.trackWidth, ctx.phaseMult, ctx.rng, {
      range: 0,
      ...(idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : {}),
    });

    return { count: 4, spanZ: 18 };
  }

  // 4. Прорыв танком (2 разрушаемых препятствия + бонус в центре)
  private static patternTankBreachCluster(ctx: PatternContext): { count: number; spanZ: number } {
    const idPrefix = ctx.idPrefix;
    const type2 = ctx.rng() < 0.5 ? 'axe_pendulum' : 'swinging_hammer';

    // 2 разрушаемых препятствия
    this.pushObs(ctx.out, 'crusher', ctx.z0, -2.2, ctx.levelNum, ctx.trackWidth, ctx.phaseMult, ctx.rng, {
      width: 2.6,
      range: 0.8,
      speed: 2.2,
      destructible: true,
      ...(idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : {}),
    });
    this.pushObs(ctx.out, type2, ctx.z0 + 7, 2.2, ctx.levelNum, ctx.trackWidth, ctx.phaseMult, ctx.rng, {
      width: 2.6,
      range: 0.8,
      speed: 2.2,
      destructible: true,
      ...(idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : {}),
    });

    // +1 бонус (adrenaline / add_mobs)
    if (ctx.bonuses.length < 14) {
      const isAdrenaline = ctx.rng() < 0.5;
      const type: BonusType = isAdrenaline ? 'adrenaline' : 'add_mobs';
      const value = isAdrenaline
        ? 4 + Math.floor(ctx.levelNum * 0.04)
        : 6 + Math.floor(ctx.rng() * 4) + Math.floor(ctx.levelNum * 0.15);
      ctx.bonuses.push({
        id: `bonus_${ctx.levelNum}_tank_${Math.floor(ctx.z0)}`,
        type,
        x: 0,
        y: 1.0,
        z: ctx.z0 + 6,
        value,
      });
    }

    return { count: 2, spanZ: 16 };
  }

  // 5. Дилемма у ворот (страж перед воротами на dz=11 > 10.5)
  private static patternGateTrapDilemma(ctx: PatternContext): { count: number; spanZ: number } {
    const idPrefix = ctx.idPrefix;
    const nearestGate = ctx.rawGates.find((g) => g.z >= ctx.z0 + 11 && g.z <= ctx.z0 + 45);

    if (nearestGate) {
      const guardZ = nearestGate.z - 11;
      const guardType: ObstacleType = ctx.rng() < 0.6 ? 'guard_dog' : 'saw_blade';
      const guardX = Math.max(-4.5, Math.min(4.5, nearestGate.x));
      this.pushObs(
        ctx.out,
        guardType,
        guardZ,
        guardX,
        ctx.levelNum,
        ctx.trackWidth,
        ctx.phaseMult,
        ctx.rng,
        {
          range: 1.5,
          ...(idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : {}),
        }
      );
      return { count: 1, spanZ: Math.max(16, (nearestGate.z - ctx.z0) + 4) };
    }

    // Если подходящих ворот нет — одиночная ловушка
    const fallbackType = this.pickObstacleType('ramp', ctx.rng);
    const x = (ctx.rng() * 2 - 1) * 3.0;
    this.pushObs(
      ctx.out,
      fallbackType,
      ctx.z0,
      x,
      ctx.levelNum,
      ctx.trackWidth,
      ctx.phaseMult,
      ctx.rng,
      idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : undefined
    );
    return { count: 1, spanZ: 14 };
  }

  // 6. Центральный бастион (стена по центру + 2 фланговые ловушки + 4 монеты)
  private static patternCentralBastionSplit(ctx: PatternContext): { count: number; spanZ: number } {
    const idPrefix = ctx.idPrefix;

    // Центральная стена (X=0, W=4.4)
    if (ctx.rawWalls.length < 12 && ctx.levelNum >= 3) {
      const nearGate = ctx.rawGates.some((g) => Math.abs(g.z - ctx.z0) < 8);
      if (!nearGate) {
        const wallCount = 6 + Math.floor(ctx.rng() * 4) + Math.floor(ctx.levelNum * 0.2);
        ctx.rawWalls.push({
          id: `wall_${ctx.levelNum}_bastion_${Math.floor(ctx.z0)}`,
          z: ctx.z0,
          x: 0,
          width: 4.4,
          count: wallCount,
          killsRemaining: wallCount,
        });
      }
    }

    // 2 фланговых препятствия на разной глубине
    this.pushObs(ctx.out, 'saw_blade', ctx.z0 + 6, -4.8, ctx.levelNum, ctx.trackWidth, ctx.phaseMult, ctx.rng, {
      width: 2.0,
      range: 0.6,
      ...(idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : {}),
    });
    this.pushObs(ctx.out, 'spike_trap', ctx.z0 + 12, 4.8, ctx.levelNum, ctx.trackWidth, ctx.phaseMult, ctx.rng, {
      width: 2.0,
      range: 0,
      ...(idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : {}),
    });

    // 4 монеты в одном из рукавов
    if (ctx.coins.length <= 350) {
      const coinSide = ctx.rng() < 0.5 ? -1 : 1;
      for (let i = 0; i < 4; i++) {
        ctx.coins.push({
          id: `coin_${ctx.levelNum}_bastion_${Math.floor(ctx.z0)}_${i}`,
          x: coinSide * 3.2,
          y: 0.5,
          z: ctx.z0 + 4 + i * 2.0,
          value: 10,
        });
      }
    }

    return { count: 2, spanZ: 18 };
  }

  // 7. Волна маятников (2 динамических маятника с противофазой)
  private static patternPendulumSweepWave(ctx: PatternContext): { count: number; spanZ: number } {
    const idPrefix = ctx.idPrefix;
    const type1 = ctx.rng() < 0.5 ? 'axe_pendulum' : 'wrecking_ball';
    const type2 = ctx.rng() < 0.5 ? 'axe_pendulum' : 'wrecking_ball';

    this.pushObs(ctx.out, type1, ctx.z0, 0, ctx.levelNum, ctx.trackWidth, ctx.phaseMult, ctx.rng, {
      width: 2.2,
      range: 3.2,
      speed: 2.2,
      initialOffset: 0,
      ...(idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : {}),
    });
    this.pushObs(ctx.out, type2, ctx.z0 + 14, 0, ctx.levelNum, ctx.trackWidth, ctx.phaseMult, ctx.rng, {
      width: 2.2,
      range: 3.2,
      speed: 2.2,
      initialOffset: Math.PI,
      ...(idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : {}),
    });

    return { count: 2, spanZ: 20 };
  }

  // 8. Стая кибер-гончих (2 guard_dog)
  private static patternCyborgHoundPack(ctx: PatternContext): { count: number; spanZ: number } {
    const idPrefix = ctx.idPrefix;
    const rate = Math.min(3, 1 + Math.floor(ctx.levelNum / 17));

    this.pushObs(ctx.out, 'guard_dog', ctx.z0, -3.2, ctx.levelNum, ctx.trackWidth, ctx.phaseMult, ctx.rng, {
      width: 2.0,
      range: 2.6,
      attackRate: rate,
      destructible: true,
      damage: 1,
      speed: 1.6,
      ...(idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : {}),
    });
    this.pushObs(ctx.out, 'guard_dog', ctx.z0 + 14, 3.2, ctx.levelNum, ctx.trackWidth, ctx.phaseMult, ctx.rng, {
      width: 2.0,
      range: 2.6,
      attackRate: rate,
      destructible: true,
      damage: 1,
      speed: 1.6,
      ...(idPrefix ? { id: `${idPrefix}_${ctx.out.length}` } : {}),
    });

    return { count: 2, spanZ: 20 };
  }

  // 9. Одиночная ловушка (fallback)
  private static patternSingleHazard(
    ctx: PatternContext,
    phaseName?: PhaseInfo['phaseName']
  ): { count: number; spanZ: number } {
    const idPrefix = ctx.idPrefix;
    const type = this.pickObstacleType(phaseName || 'warmup', ctx.rng);
    const obs = this.createObstacleDef(
      type,
      ctx.z0,
      ctx.levelNum,
      ctx.out.length,
      ctx.trackWidth,
      ctx.phaseMult,
      ctx.rng
    );
    if (idPrefix) {
      obs.id = `${idPrefix}_${ctx.out.length}`;
    }
    ctx.out.push(obs);
    return { count: 1, spanZ: 14 };
  }

  /**
   * Выбор паттерна по фазе с учетом весов и уровневых блокировок
   */
  private static selectPattern(
    phaseName: PhaseInfo['phaseName'],
    levelNum: number,
    lastPattern: PatternType | null,
    rng: () => number
  ): PatternType {
    let table: [PatternType, number][];

    switch (phaseName) {
      case 'warmup':
        table = [
          ['slalom_cascade', 0.5],
          ['checkerboard_hazard', 0.3],
          ['single_hazard', 0.2],
        ];
        break;
      case 'ramp':
        table = [
          ['slalom_cascade', 0.35],
          ['checkerboard_hazard', 0.25],
          ['pendulum_sweep_wave', 0.2],
          ['single_hazard', 0.2],
        ];
        break;
      case 'peak':
        table = [
          ['choke_point_funnel', 0.3],
          ['tank_breach_cluster', 0.3],
          ['gate_trap_dilemma', 0.2],
          ['cyborg_hound_pack', 0.2],
          ['central_bastion_split', 0.2],
        ];
        break;
      case 'corridor':
        table = [
          ['choke_point_funnel', 0.35],
          ['checkerboard_hazard', 0.25],
          ['pendulum_sweep_wave', 0.2],
          ['slalom_cascade', 0.2],
          ['central_bastion_split', 0.2],
        ];
        break;
      case 'climax':
      default:
        table = [
          ['gate_trap_dilemma', 0.3],
          ['tank_breach_cluster', 0.25],
          ['choke_point_funnel', 0.25],
          ['cyborg_hound_pack', 0.2],
          ['central_bastion_split', 0.2],
        ];
        break;
    }

    // Уровневые блокировки:
    // levelNum < 4 → убрать tank_breach, hound, gate_trap, central_bastion
    // levelNum < 8 → убрать gate_trap
    const filtered = table.filter(([pat]) => {
      if (
        levelNum < 4 &&
        (pat === 'tank_breach_cluster' ||
          pat === 'cyborg_hound_pack' ||
          pat === 'gate_trap_dilemma' ||
          pat === 'central_bastion_split')
      ) {
        return false;
      }
      if (levelNum < 8 && pat === 'gate_trap_dilemma') {
        return false;
      }
      return true;
    });

    const candidateTable =
      filtered.length > 0 ? filtered : ([['single_hazard', 1.0]] as [PatternType, number][]);

    const pickWeighted = (tbl: [PatternType, number][]) => {
      const total = tbl.reduce((acc, [, w]) => acc + w, 0);
      if (total <= 0) return 'single_hazard';
      const r = rng() * total;
      let cur = 0;
      for (const [p, w] of tbl) {
        cur += w;
        if (r <= cur) return p;
      }
      return tbl[tbl.length - 1][0];
    };

    let chosen = pickWeighted(candidateTable);
    if (chosen === lastPattern && candidateTable.length > 1) {
      for (let retry = 0; retry < 2; retry++) {
        const next = pickWeighted(candidateTable);
        if (next !== lastPattern) {
          chosen = next;
          break;
        }
      }
    }

    return chosen;
  }

  /**
   * Диспетчер исполнения паттерна
   */
  private static runPattern(
    pattern: PatternType,
    ctx: PatternContext,
    phaseName?: PhaseInfo['phaseName']
  ): { count: number; spanZ: number } {
    switch (pattern) {
      case 'slalom_cascade':
        return this.patternSlalomCascade(ctx);
      case 'choke_point_funnel':
        return this.patternChokePointFunnel(ctx);
      case 'checkerboard_hazard':
        return this.patternCheckerboardHazard(ctx);
      case 'tank_breach_cluster':
        return this.patternTankBreachCluster(ctx);
      case 'gate_trap_dilemma':
        return this.patternGateTrapDilemma(ctx);
      case 'central_bastion_split':
        return this.patternCentralBastionSplit(ctx);
      case 'pendulum_sweep_wave':
        return this.patternPendulumSweepWave(ctx);
      case 'cyborg_hound_pack':
        return this.patternCyborgHoundPack(ctx);
      case 'single_hazard':
      default:
        return this.patternSingleHazard(ctx, phaseName);
    }
  }

  public static resolveOverlaps(
    gates: GateData[],
    obstacles: ObstacleData[],
    trackWidth: number,
    minZ: number,
    maxZ: number,
    peers?: ObstacleData[]
  ): ObstacleData[] {
    const validObstacles: ObstacleData[] = [];
    const checkPeers = (z: number) => {
      if (validObstacles.some((p) => Math.abs(p.z - z) < 6)) return true;
      if (peers && peers.some((p) => Math.abs(p.z - z) < 6)) return true;
      return false;
    };

    for (const obs of obstacles) {
      if (obs.z < minZ || obs.z > maxZ) {
        continue;
      }

      let safeZ = obs.z;
      let hasGateOverlap = gates.some((g) => Math.abs(g.z - safeZ) < GATE_CLEARANCE);

      if (hasGateOverlap) {
        let resolved = false;
        // Первая попытка: сдвиг с проверкой чистоты от ворот и от соседних препятствий
        for (let attempt = 1; attempt <= 6; attempt++) {
          const offset = attempt * 4.5;
          const candidateForward = obs.z + offset;
          if (
            candidateForward <= maxZ &&
            !gates.some((g) => Math.abs(g.z - candidateForward) < GATE_CLEARANCE) &&
            !checkPeers(candidateForward)
          ) {
            safeZ = candidateForward;
            resolved = true;
            break;
          }
          const candidateBackward = obs.z - offset;
          if (
            candidateBackward >= minZ &&
            !gates.some((g) => Math.abs(g.z - candidateBackward) < GATE_CLEARANCE) &&
            !checkPeers(candidateBackward)
          ) {
            safeZ = candidateBackward;
            resolved = true;
            break;
          }
        }
        // Вторая попытка: если со строгим peer-чеком не нашли, ищем хотя бы чистый от ворот слот
        if (!resolved) {
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
  ): number | null {
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

    // Если все полосы перекрыты — безопасной позиции нет, монету не спавним.
    // Возвращаем null, вызывающий код пропускает монету (иначе она легла бы
    // вплотную к хитбоксу препятствия, что ломает тест и геймплей).
    return null;
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

    // Сложность босса нарастает с уровнем: HP уже растёт через bossMap (maxHp),
    // но ритм и урон атак были идентичны для ВСЕХ боссов. Теперь босс на L50
    // бьёт заметно быстрее и больнее, чем на L10, чтобы поздние бои читались
    // как эскалация, а не как перекраска одного и того же паттерна.
    // tier = 1..5 (боссы на 10/20/30/40/50). L10 — базовый «обучающий» ритм,
    // к L50 урон ×2.4, телеграф короче на 0.45с (сложнее уклониться).
    const tier = Math.max(1, Math.floor(levelNum / 10));
    const tierScale = 1 + (tier - 1) * 0.35; // 1.0 → 2.4
    const telegraphBonus = Math.min(0.45, (tier - 1) * 0.12); // 0 → 0.48, клампим

    const slamDamage = Math.round(15 * tierScale);
    const laserDamage = Math.round(25 * tierScale);
    // Уникальные боевые паттерны под каждого босса (тир). Поздние боссы получают
    // более широкий арсенал: метеоритный залп (meteors) и энергетический купол (shield).
    const minionsDamage = Math.round(12 * tierScale);
    const meteorDamage = Math.round(30 * tierScale);
    const baseSlam = { type: 'slam' as const, telegraphTime: Math.max(1.0, 1.5 - telegraphBonus), duration: 0.8, damage: slamDamage, areaRadius: 3.5 };
    const baseLaser = { type: 'laser' as const, telegraphTime: Math.max(1.2, 2.0 - telegraphBonus), duration: 1.2, damage: laserDamage, direction: 0 };
    const baseMinions = { type: 'minions' as const, telegraphTime: Math.max(0.7, 1.0 - telegraphBonus), duration: 0.5, damage: minionsDamage };
    const meteors = { type: 'meteors' as const, telegraphTime: Math.max(1.0, 1.5 - telegraphBonus), duration: 0.9, damage: meteorDamage, areaRadius: 3 };
    const shield = { type: 'shield' as const, telegraphTime: Math.max(0.8, 1.2 - telegraphBonus), duration: 2.2, damage: 0 };

    // Набор атак зависит от модели босса (тира), а не одинаков для всех.
    let attacks: BossData['attacks'];
    switch (def.modelType) {
      case 'magma_colossus':
        attacks = [baseSlam, meteors, baseMinions];
        break;
      case 'crystal_wyrm':
        attacks = [baseLaser, baseMinions, baseSlam];
        break;
      case 'titan_nullifier':
        attacks = [shield, baseLaser, meteors];
        break;
      case 'apex_overlord':
        attacks = [meteors, shield, baseLaser, baseSlam];
        break;
      case 'iron_golem':
      default:
        attacks = [baseSlam, baseLaser, baseMinions];
        break;
    }

    return {
      id: def.id || `boss_${levelNum}`,
      nameKey: def.nameKey || 'boss1Name',
      titleKey: def.titleKey || 'boss1Title',
      maxHp: def.maxHp || 200,
      hp: def.maxHp || 200,
      biome,
      modelType: def.modelType || 'iron_golem',
      attacks,
    };
  }

  public static generateEndlessBoss(segmentIndex: number, biome: BiomeType): BossData {
    const bossInterval = 5;
    const cycle = Math.floor(segmentIndex / bossInterval); // 1, 2, 3, ...
    const tier = Math.min(5, Math.max(1, cycle)); // 1..5
    const levelNum = tier * 10; // 10, 20, 30, 40, 50
    const boss = this.generateBoss(levelNum, biome);
    // Рост HP для циклов после 5 (segmentIndex >= 25): +40% за каждый полный цикл
    const extraCycles = Math.max(0, Math.floor(segmentIndex / (bossInterval * 5)));
    if (extraCycles > 0) {
      const hpMult = 1 + extraCycles * 0.4;
      boss.maxHp = Math.round(boss.maxHp * hpMult);
      boss.hp = boss.maxHp;
    }
    return boss;
  }

  public static generateEndlessSegment(
    segmentIndex: number,
    currentZ: number
  ): {
    gates: GateData[];
    walls: WallData[];
    bonuses: BonusData[];
    obstacles: ObstacleData[];
    coins: CoinData[];
    events: LevelDynamicEvent[];
    length: number;
    boss?: BossData;
    bossArenaZ?: number;
    bossLevel?: number;
  } {
    const length = 120;
    const rawGates: GateData[] = [];
    const rawWalls: WallData[] = [];
    const rawObstacles: ObstacleData[] = [];
    const coins: CoinData[] = [];
    const bonuses: BonusData[] = [];
    const trackWidth = DEFAULT_TRACK_WIDTH;
    const playableHalf = trackWidth / 2 - TRACK_RAIL_MARGIN;
    const isBossSegment = segmentIndex > 0 && segmentIndex % 5 === 0;
    const bossArenaZoneStart = isBossSegment ? currentZ + length - 45 : Infinity;

    // Детерминированный PRNG для бесконечного режима
    const rng = createRng(segmentIndex * 7919 + 9973);

    // 2-3 независимых ворот в сегменте (add/divide/multiply)
    // multiply (×N) возрождён: редкая награда за риск, N∈{2,3}.
    const motionTypes: GateMotion[] = ['none', 'none', 'none', 'horizontal', 'vertical', 'rotate'];
    const gateCount = 2 + (rng() < 0.5 ? 1 : 0);
    const gateSpacing = (length - 40) / Math.max(1, gateCount);
    for (let i = 0; i < gateCount; i++) {
      const z = currentZ + 20 + i * gateSpacing + (rng() * 4 - 2);
      let op: GateOp;
      let value: number;

      // add/divide поровну — ворота +, ÷ и редкий multiply (×N).
      // mystery — редкая операция риска/награды (~12%).
      const roll = rng();
      if (roll < 0.45) {
        op = 'add';
        value = 10 + Math.floor(rng() * 8);
      } else if (roll < 0.55) {
        op = 'multiply';
        value = 2 + Math.floor(rng() * 2); // 2 или 3
      } else if (roll < 0.67) {
        op = 'mystery';
        value = 8 + Math.floor(rng() * 6);
      } else {
        op = 'divide';
        value = 2 + Math.floor(rng() * 2);
      }

      // Ширина и позиция ворот.
      const width = Math.min(4.5, 2.5 + rng() * 2.5);
      const x = Math.max(-(trackWidth / 2 - width / 2 - 0.4), Math.min(trackWidth / 2 - width / 2 - 0.4, (rng() * 2 - 1) * (trackWidth / 2 - 2)));

      const motion = motionTypes[Math.floor(rng() * motionTypes.length)];
      const motionSpeed = motion === 'none' ? 0 : 0.8 + rng() * 1.0;
      const motionRange = motion === 'horizontal' || motion === 'vertical'
        ? 1.0 + rng() * 1.4
        : motion === 'rotate' ? 0.4 + rng() * 0.5 : 0;

      rawGates.push({
        id: `endless_gate_${segmentIndex}_${i}`,
        z,
        x,
        width,
        op,
        value,
        motion,
        motionSpeed,
        motionRange,
      });
    }

    rawGates.sort((a, b) => a.z - b.z);
    const gates = rawGates;

    // 1 стена (−N со счётчиком) в сегменте.
    const wallZ = currentZ + 30 + rng() * (length - 50);
    const wallWidth = Math.min(trackWidth - 2.4, 3.5 + rng() * 3.5);
    const wallCount = 5 + Math.floor(rng() * 6);
    rawWalls.push({
      id: `endless_wall_${segmentIndex}`,
      z: wallZ,
      x: (rng() * 2 - 1) * (trackWidth / 2 - wallWidth / 2 - 0.4),
      width: wallWidth,
      count: wallCount,
      killsRemaining: wallCount,
    });

    // 3 слота паттернов препятствий в 120м сегменте
    // Слот 1 (Z+10..Z+40): движение (slalom/pendulum)
    const zSlot1 = currentZ + 12 + (rng() * 4 - 2);
    const p1: PatternType = rng() < 0.5 ? 'slalom_cascade' : 'pendulum_sweep_wave';
    this.runPattern(p1, {
      out: rawObstacles,
      z0: zSlot1,
      levelNum: segmentIndex,
      trackWidth,
      playableHalf,
      phaseMult: 1.0,
      rng,
      rawGates,
      rawWalls,
      coins,
      bonuses,
      idPrefix: `endless_obs_${segmentIndex}`,
    });

    // Слот 2 (Z+48..Z+80): выбор (gate_trap/central_bastion/checkerboard)
    const zSlot2 = currentZ + 50 + (rng() * 4 - 2);
    const r2 = rng();
    const p2: PatternType = r2 < 0.4 ? 'gate_trap_dilemma' : r2 < 0.7 ? 'central_bastion_split' : 'checkerboard_hazard';
    this.runPattern(p2, {
      out: rawObstacles,
      z0: zSlot2,
      levelNum: segmentIndex,
      trackWidth,
      playableHalf,
      phaseMult: 1.0,
      rng,
      rawGates,
      rawWalls,
      coins,
      bonuses,
      idPrefix: `endless_obs_${segmentIndex}`,
    });

    // Слот 3 (Z+88..Z+115): препятствия (tank_breach/choke/hound)
    const zSlot3 = currentZ + 88 + (rng() * 4 - 2);
    const r3 = rng();
    const p3: PatternType = r3 < 0.4 ? 'tank_breach_cluster' : r3 < 0.75 ? 'choke_point_funnel' : 'cyborg_hound_pack';
    this.runPattern(p3, {
      out: rawObstacles,
      z0: zSlot3,
      levelNum: segmentIndex,
      trackWidth,
      playableHalf,
      phaseMult: 1.0,
      rng,
      rawGates,
      rawWalls,
      coins,
      bonuses,
      idPrefix: `endless_obs_${segmentIndex}`,
    });

    if (isBossSegment) {
      // Убираем препятствия из зоны арены босса (последние 45м) — толпа будет драться там
      const filtered = rawObstacles.filter(o => o.z < bossArenaZoneStart);
      rawObstacles.length = 0;
      rawObstacles.push(...filtered);
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
      if (safeCoinX === null) continue;

      coins.push({
        id: `endless_coin_${segmentIndex}_${c}`,
        x: safeCoinX,
        y: 0.5,
        z: coinZ,
        value: 10,
      });
    }

    // Бонусы (светящиеся сферы) — 1-2 на сегмент, мимо ворот и препятствий
    const bonusCount = 1 + (rng() < 0.5 ? 1 : 0);
    for (let b = 0; b < bonusCount; b++) {
      const z = currentZ + 14 + b * (length / Math.max(1, bonusCount + 1));
      const nearGate = gates.some((g) => Math.abs(g.z - z) < GATE_CLEARANCE);
      const nearObs = obstacles.some((o) => Math.abs(o.z - z) < 4);
      if (nearGate || nearObs) continue;

      const roll = rng();
      let type: BonusType;
      let value: number;
      if (roll < 0.40) {
        type = 'add_mobs';
        value = 8 + Math.floor(rng() * 5);
      } else if (roll < 0.62) {
        type = 'heal';
        value = 3;
      } else if (roll < 0.80) {
        type = 'adrenaline';
        value = 4;
      } else {
        type = 'coins';
        value = 30 + Math.floor(rng() * 30);
      }

      bonuses.push({
        id: `endless_bonus_${segmentIndex}_${b}`,
        type,
        x: (rng() * 2 - 1) * (trackWidth / 2 - 2.2),
        y: 1.0,
        z,
        value,
      });
    }

    // Динамические события (метеоритный дождь, засада, ЭМИ-шторм, поезд монет, ускорение)
    const events: LevelDynamicEvent[] = [];
    // ~55% шанс события на сегмент, не на первых 3 сегментах (разогрев)
    if (segmentIndex >= 3 && rng() < 0.55) {
      const biome = LevelGenerator.getEndlessBiome(segmentIndex);
      const triggerZ = currentZ + 30 + rng() * (length - 60); // в середине сегмента
      // Тип события по биому
      let type: LevelDynamicEvent['type'];
      const roll = rng();
      if (biome === 'magma_citadel') {
        type = roll < 0.6 ? 'meteor_rain' : roll < 0.8 ? 'ambush' : 'coin_train';
      } else if (biome === 'cyber_city' || biome === 'quantum_void') {
        type = roll < 0.5 ? 'emp_storm' : roll < 0.75 ? 'speed_boost' : 'coin_train';
      } else if (biome === 'crystal_cavern') {
        type = roll < 0.5 ? 'ambush' : roll < 0.8 ? 'meteor_rain' : 'speed_boost';
      } else {
        // celestial_core
        type = roll < 0.4 ? 'speed_boost' : roll < 0.7 ? 'coin_train' : 'meteor_rain';
      }
      // Интенсивность растёт с сегментом (кап 3.0)
      const intensity = Math.min(3.0, 1.0 + segmentIndex * 0.03);
      const duration = type === 'coin_train' ? 1.0 : 6.0 + rng() * 4.0;
      events.push({ triggerZ, type, duration, intensity });
    }

    let boss: BossData | undefined;
    let bossArenaZ: number | undefined;
    let bossLevel: number | undefined;
    if (isBossSegment) {
      boss = LevelGenerator.generateEndlessBoss(segmentIndex, LevelGenerator.getEndlessBiome(segmentIndex));
      bossArenaZ = currentZ + length - 20;
      bossLevel = Math.min(50, Math.floor(segmentIndex / 5) * 10);
    }

    rawWalls.sort((a, b) => a.z - b.z);
    bonuses.sort((a, b) => a.z - b.z);
    coins.sort((a, b) => a.z - b.z);

    return { gates, walls: rawWalls, bonuses, obstacles, coins, events, length, boss, bossArenaZ, bossLevel };
  }

  /** Базовая скорость для уровня кампании (рост 18 -> 27 к L50, кап 30). */
  public static getBaseSpeed(levelNum: number): number {
    const clampedLevel = Math.max(1, levelNum);
    const speed = 18.0 + (clampedLevel - 1) * (9.0 / 49.0);
    return Math.min(30.0, Math.round(speed * 100) / 100);
  }

  /** Базовая скорость для сегмента бесконечного режима (+0.18 м/с за сегмент, кап 30). */
  public static getEndlessBaseSpeed(segmentIndex: number): number {
    const s = Math.max(0, segmentIndex);
    return Math.min(30.0, Math.round((18.0 + s * 0.18) * 100) / 100);
  }
}
