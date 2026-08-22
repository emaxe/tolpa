import { LevelConfig, GateData, ObstacleData, CoinData, LevelDynamicEvent, BiomeType, BossData, GateOp } from '../types/game';

export class LevelGenerator {
  public static getBiomeForLevel(levelNum: number): BiomeType {
    if (levelNum <= 10) return 'cyber_city';
    if (levelNum <= 20) return 'magma_citadel';
    if (levelNum <= 30) return 'crystal_cavern';
    if (levelNum <= 40) return 'quantum_void';
    return 'celestial_core';
  }

  public static generateLevel(levelNum: number): LevelConfig {
    const biome = this.getBiomeForLevel(levelNum);
    const trackWidth = 10;
    // Track length scales with level, e.g. 180m at L1 to 350m at L50
    const trackLength = 180 + Math.min(32, levelNum) * 5;
    const isBossLevel = levelNum % 10 === 0;

    const gates: GateData[] = [];
    const obstacles: ObstacleData[] = [];
    const coins: CoinData[] = [];
    const events: LevelDynamicEvent[] = [];

    const startingMobs = 1;
    const targetMobsToWin = Math.min(150, 10 + Math.floor(levelNum * 2.2));

    // Number of gate pairs (roughly every 30-40 meters)
    const gateCount = Math.floor((trackLength - 50) / 35);
    for (let g = 0; g < gateCount; g++) {
      const z = 30 + g * 35 + (Math.random() * 4 - 2);
      const gateId = `gate_${levelNum}_${g}`;

      let leftOp: GateOp = 'add';
      let leftVal = 5 + Math.floor(Math.random() * (levelNum > 15 ? 15 : 10));
      let rightOp: GateOp = 'multiply';
      let rightVal = 2;

      // Introduce multipliers, subtractions, conditionals
      const rand = Math.random();
      if (rand < 0.25) {
        leftOp = 'add';
        leftVal = 10 + Math.floor(Math.random() * 15);
        rightOp = 'multiply';
        rightVal = levelNum > 20 ? 3 : 2;
      } else if (rand < 0.5) {
        leftOp = 'multiply';
        leftVal = 2;
        rightOp = 'subtract';
        rightVal = 5 + Math.floor(Math.random() * 10);
      } else if (rand < 0.7) {
        // One positive, one conditional
        leftOp = 'add';
        leftVal = 8;
        rightOp = 'conditional';
        rightVal = 0;
      } else if (rand < 0.85) {
        // Mystery gate
        leftOp = 'mystery';
        leftVal = 0;
        rightOp = 'add';
        rightVal = 12;
      } else {
        // Adrenaline gate
        leftOp = 'adrenaline';
        leftVal = 0;
        rightOp = 'multiply';
        rightVal = 2;
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
        isDynamic: levelNum > 5 && Math.random() < 0.35,
        flipTimer: 0,
      });
    }

    // Place Obstacles between gates
    const obstacleCount = Math.floor(gateCount * 1.6) + Math.floor(levelNum * 0.4);
    for (let o = 0; o < obstacleCount; o++) {
      const z = 18 + (o / obstacleCount) * (trackLength - 55) + (Math.random() * 6 - 3);
      
      // Ensure not too close to gates
      const tooCloseToGate = gates.some((gate) => Math.abs(gate.z - z) < 8);
      if (tooCloseToGate) continue;

      const types: ('saw_blade' | 'axe_pendulum' | 'crusher' | 'spike_trap' | 'laser_grid')[] = [
        'saw_blade',
        'axe_pendulum',
        'crusher',
        'spike_trap',
        'laser_grid',
      ];
      const type = types[Math.floor(Math.random() * types.length)];
      const x = (Math.random() - 0.5) * (trackWidth - 3);

      obstacles.push({
        id: `obs_${levelNum}_${o}`,
        type,
        x,
        y: 0,
        z,
        width: type === 'laser_grid' ? 6 : 2,
        height: 2,
        depth: 2,
        speed: 1.5 + Math.random() * 2.0,
        range: 3.5,
        initialOffset: Math.random() * Math.PI * 2,
        damage: type === 'saw_blade' || type === 'laser_grid' ? 4 : 8,
        destructible: type === 'crusher' || type === 'axe_pendulum',
        hp: 15,
        maxHp: 15,
      });
    }

    // Place Coins along paths
    const coinClusters = Math.floor(trackLength / 20);
    for (let c = 0; c < coinClusters; c++) {
      const zCenter = 15 + c * 20;
      const xCenter = (Math.random() - 0.5) * (trackWidth - 4);
      for (let i = 0; i < 4; i++) {
        coins.push({
          id: `coin_${levelNum}_${c}_${i}`,
          x: xCenter + (Math.random() - 0.5) * 1.5,
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
    const trackWidth = 10;

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
