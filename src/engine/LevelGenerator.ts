import {
  BiomeType,
  LevelConfig,
  GateData,
  ObstacleData,
  CoinData,
  LevelDynamicEvent,
  GateOp,
  BossData,
} from '../types/game';
import { TRACK_RAIL_MARGIN } from '../utils/math';

// Единственный источник ширины трассы — кампания и бесконечный режим используют
// одно и то же значение, чтобы не разъезжаться (раньше было два независимых
// хардкода 10 в этом файле плюс третий хардкод в GameEngine для endless-режима).
export const DEFAULT_TRACK_WIDTH = 16;

function createRng(seed: number) {
  let s = (seed * 1664525 + 1013904223) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class LevelGenerator {
  public static getBiomeForLevel(levelNum: number): BiomeType {
    if (levelNum <= 10) return 'cyber_city';
    if (levelNum <= 20) return 'magma_citadel';
    if (levelNum <= 30) return 'crystal_cavern';
    if (levelNum <= 40) return 'quantum_void';
    return 'celestial_core';
  }

  public static generateLevel(levelNum: number): LevelConfig {
    const rng = createRng(levelNum * 7919 + 12345);
    const biome = this.getBiomeForLevel(levelNum);
    const trackWidth = DEFAULT_TRACK_WIDTH;
    // Track length scales with level. Удлинено в ~12-16 раз относительно прежнего
    // (было 180..340м): L1 ≈ 2300м, L50 ≈ 5400м — полноценная длинная трасса.
    const trackLength = 2200 + Math.min(32, levelNum) * 100;
    const isBossLevel = levelNum % 10 === 0;

    const gates: GateData[] = [];
    const obstacles: ObstacleData[] = [];
    const coins: CoinData[] = [];
    const events: LevelDynamicEvent[] = [];

    // Раньше было 1 — любое касание препятствия (урон 4-8) гарантированно означало
    // мгновенный game over ещё до первых ворот. 8 даёт толпе шанс среагировать и
    // соответствует BALANCE.md ("до 11 бойцов на старте при максимальном апгрейде").
    const startingMobs = 8;
    const targetMobsToWin = Math.min(150, 10 + Math.floor(levelNum * 2.2));

    // Number of gate pairs. Плотность НЕ растёт с длиной трассы — иначе на 2200-5400м
    // было бы 56-140 ворот, толпа упёрлась бы в потолок 400 за первые 500м, а сцена
    // перегрузилась бы тысячами объектов. Вместо этого держим разумное число ворот
    // (8 на L1 → 18 на L50) и равномерно распределяем их по всей длине.
    const gateCount = Math.min(20, 8 + Math.floor(levelNum / 5));
    const gateSpacing = (trackLength - 60) / Math.max(1, gateCount);
    for (let g = 0; g < gateCount; g++) {
      const z = 32 + g * gateSpacing + (rng() * 2 - 1);
      const gateId = `gate_${levelNum}_${g}`;

      // Множитель масштабируется ОБРАТНО уровню: на ранних уровнях толпа мала и ×3
      // безопасен, на поздних (толпа уже 100-200) большой множитель мгновенно упирается
      // в потолок 400 и обесценивает экономику. На L1-10 ×3, к L50 плавно падает до ×1.6.
      const multVal = Math.max(1.6, 3 - levelNum * 0.028);
      // Вычитание смягчено на ранних уровнях (стартовая толпа всего 8-11 бойцов):
      // -5..-15 на L1 могло убить всю толпу ещё до первых ворот.
      const subVal = Math.max(3, 5 + Math.floor(rng() * 10) - Math.floor(levelNum * 0.15));

      let leftOp: GateOp = 'add';
      let leftVal = 5 + Math.floor(rng() * (levelNum > 15 ? 15 : 10));
      let rightOp: GateOp = 'multiply';
      let rightVal = multVal;

      // Introduce multipliers, subtractions, conditionals
      const rand = rng();
      if (rand < 0.25) {
        leftOp = 'add';
        leftVal = 10 + Math.floor(rng() * 15);
        rightOp = 'multiply';
        rightVal = multVal;
      } else if (rand < 0.5) {
        leftOp = 'multiply';
        leftVal = multVal;
        rightOp = 'subtract';
        rightVal = subVal;
      } else if (rand < 0.7) {
        // One positive, one conditional
        leftOp = 'add';
        leftVal = 8;
        rightOp = 'conditional';
        rightVal = 0;
      } else if (rand < 0.85) {
        // Mystery gate — теперь с риском: 60% бонус, 40% штраф (раньше всегда бонус)
        leftOp = 'mystery';
        leftVal = 0;
        rightOp = 'add';
        rightVal = 12;
      } else {
        // Adrenaline gate
        leftOp = 'adrenaline';
        leftVal = 0;
        rightOp = 'multiply';
        rightVal = multVal;
      }

      const conditionalData = {
        minMobs: 10 + Math.floor(g * 3 + levelNum * 0.5),
        passOp: 'multiply' as GateOp,
        passVal: 3,
        failOp: 'subtract' as GateOp,
        failVal: 10,
      };

      gates.push({
        id: gateId,
        z,
        xLeft: -trackWidth / 4,
        xRight: trackWidth / 4,
        width: trackWidth / 2 - 0.4,
        leftOp,
        leftVal,
        leftCondition: leftOp === ('conditional' as GateOp) ? conditionalData : undefined,
        rightOp,
        rightVal,
        rightCondition: rightOp === ('conditional' as GateOp) ? conditionalData : undefined,
        isDynamic: levelNum > 5 && rng() < 0.35,
        flipTimer: 0,
      });
    }

    // Strict gate ordering
    gates.sort((a, b) => a.z - b.z);

    // Первые ворота уровня не должны быть способны обнулить только что стартовавшую
    // толпу — обе створки положительны/нейтральны.
    if (gates.length > 0) {
      gates[0].leftOp = 'add';
      gates[0].leftVal = 10 + Math.floor(rng() * 10);
      gates[0].leftCondition = undefined;
      gates[0].rightOp = 'multiply';
      gates[0].rightVal = Math.max(1.6, 3 - levelNum * 0.028);
      gates[0].rightCondition = undefined;
      gates[0].isDynamic = false;
    }

    const GATE_CLEARANCE = 10.5;

    // Place Obstacles between gates. Плотность фиксирована (~1 препятствие на 60м),
    // а не растёт с длиной — иначе на 5400м было бы ~70 препятствий и сцена
    // перегрузилась бы. Равномерно распределяем по всей длине трассы.
    const obstacleCount = Math.min(60, Math.floor(trackLength / 60));
    for (let o = 0; o < obstacleCount; o++) {
      let z = 55 + (o / Math.max(1, obstacleCount - 1)) * (trackLength - 105) + (rng() * 4 - 2);

      // Ensure safe clearance from all gates — nudge past the offending gate instead of
      // silently dropping the obstacle (dropping made actual density much lower than
      // obstacleCount promised).
      for (let attempt = 0; attempt < 6; attempt++) {
        const blocking = gates.find((gate) => Math.abs(gate.z - z) < GATE_CLEARANCE);
        if (!blocking) break;
        z = z >= blocking.z ? blocking.z + GATE_CLEARANCE + 0.5 : blocking.z - GATE_CLEARANCE - 0.5;
      }
      z = Math.min(trackLength - 15, Math.max(50, z));
      if (gates.some((gate) => Math.abs(gate.z - z) < GATE_CLEARANCE)) continue; // не нашли места — пропускаем

      const types: ('saw_blade' | 'axe_pendulum' | 'crusher' | 'spike_trap' | 'laser_grid')[] = [
        'saw_blade',
        'axe_pendulum',
        'crusher',
        'spike_trap',
        'laser_grid',
      ];
      const type = types[Math.floor(rng() * types.length)];
      const playableHalf = trackWidth / 2 - TRACK_RAIL_MARGIN; // совпадает с клампом лидера в CrowdManager.update

      let obsWidth: number;
      let x: number;
      let range: number;

      if (type === 'laser_grid') {
        // Решётка прижимается к одному краю, гарантируя проходимый коридор с другого —
        // раньше решётка шириной 6 на трассе 10 могла перекрыть весь проходимый диапазон.
        obsWidth = 4.0;
        const side = rng() < 0.5 ? -1 : 1;
        x = side * (playableHalf - obsWidth / 2);
        range = 0;
      } else {
        const maxHalfX = Math.max(0.5, (trackWidth / 2 - 0.6) - 2 / 2);
        obsWidth = 2;
        x = (rng() * 2 - 1) * maxHalfX;
        range = Math.min(3.5, maxHalfX);
      }

      obstacles.push({
        id: `obs_${levelNum}_${o}`,
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
        // Урон масштабируется с уровнем, но не смертелен на старте: базовый урон
        // препятствия (4-8) + плавный рост до ~+6 к L50. На ранних уровнях толпа
        // маленькая, поэтому урон остаётся щадящим; на поздних — толпа большая и
        // может пережить более серьёзные потери.
        damage:
          (type === 'saw_blade' || type === 'laser_grid' || type === 'spike_trap' ? 4 : 8) +
          Math.floor(levelNum * 0.12),
        destructible: type === 'crusher' || type === 'axe_pendulum',
        hp: 15,
        maxHp: 15,
      });
    }

    // Sort obstacles by Z
    obstacles.sort((a, b) => a.z - b.z);

    // Place Coins along paths. Плотность фиксирована (~1 кластер на 40м), а не растёт
    // с длиной — иначе на 5400м было бы ~250 кластеров / 1000 монет и сцена
    // перегрузилась бы. Равномерно распределяем по всей длине.
    const coinClusters = Math.min(90, Math.floor(trackLength / 40));
    for (let c = 0; c < coinClusters; c++) {
      const zCenter = 16 + c * (trackLength / Math.max(1, coinClusters));
      const xCenter = (rng() - 0.5) * (trackWidth - 4);
      for (let i = 0; i < 4; i++) {
        coins.push({
          id: `coin_${levelNum}_${c}_${i}`,
          x: xCenter + (rng() - 0.5) * 1.5,
          y: 0.5,
          z: zCenter + i * 1.5,
          value: 10,
        });
      }
    }

    // Dynamic Events (Ambush / Coin Train / EMP)
    if (levelNum >= 3) {
      events.push({
        triggerZ: trackLength * 0.45,
        type: levelNum % 4 === 0 ? 'emp_storm' : levelNum % 3 === 0 ? 'ambush' : 'coin_train',
        duration: 5.0,
        intensity: 1.0 + levelNum * 0.05,
      });
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

  public static generateEndlessSegment(segmentIndex: number, currentZ: number): {
    gates: GateData[];
    obstacles: ObstacleData[];
    coins: CoinData[];
    length: number;
  } {
    const length = 120;
    const gates: GateData[] = [];
    const obstacles: ObstacleData[] = [];
    const coins: CoinData[] = [];
    const trackWidth = DEFAULT_TRACK_WIDTH;

    // 2 Gates in this segment
    for (let i = 0; i < 2; i++) {
      const z = currentZ + 30 + i * 45;
      gates.push({
        id: `endless_gate_${segmentIndex}_${i}`,
        z,
        xLeft: -trackWidth / 4,
        xRight: trackWidth / 4,
        width: trackWidth / 2 - 0.4,
        leftOp: Math.random() < 0.5 ? 'multiply' : 'add',
        leftVal: Math.random() < 0.5 ? 2 : 10,
        rightOp: Math.random() < 0.5 ? 'subtract' : 'add',
        rightVal: Math.random() < 0.5 ? 5 : 15,
      });
    }

    // 4 Obstacles
    for (let o = 0; o < 4; o++) {
      const z = currentZ + 15 + o * 25;
      obstacles.push({
        id: `endless_obs_${segmentIndex}_${o}`,
        type: 'saw_blade',
        x: (Math.random() - 0.5) * (trackWidth - 3),
        y: 0,
        z,
        width: 2,
        height: 2,
        depth: 2,
        speed: 2.5,
        range: 3.0,
        initialOffset: Math.random() * Math.PI * 2,
        damage: 5,
      });
    }

    // Coins
    for (let c = 0; c < 10; c++) {
      coins.push({
        id: `endless_coin_${segmentIndex}_${c}`,
        x: (Math.random() - 0.5) * (trackWidth - 4),
        y: 0.5,
        z: currentZ + 10 + c * 10,
        value: 10,
      });
    }

    return { gates, obstacles, coins, length };
  }
}
