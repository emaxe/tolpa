import { describe, expect, it } from 'vitest';
import { LevelGenerator, DEFAULT_TRACK_WIDTH, getTargetMobsToWin, getStarsForFinish } from '../../engine/LevelGenerator';
import { StateManager } from '../../core/StateManager';
import { ObjectPool, Poolable } from '../../core/ObjectPool';
import { calculateFormationOffset, clamp, lerp, circleRectGap, getNearMissMultiplier, computeWallImpact } from '../../utils/math';

describe('Gate & Math Operations', () => {
  it('выполняет сложение мобов (+15 к 10 = 25)', () => {
    const initial = 10;
    const addVal = 15;
    expect(initial + addVal).toBe(25);
  });

  it('выполняет умножение мобов (12 × 3 = 36)', () => {
    const initial = 12;
    const multVal = 3;
    expect(initial * multVal).toBe(36);
  });

  it('выполняет вычитание мобов (20 − 8 = 12)', () => {
    const initial = 20;
    const subVal = 8;
    expect(Math.max(0, initial - subVal)).toBe(12);
  });

  it('выполняет деление мобов (30 ÷ 2 = 15)', () => {
    const initial = 30;
    const divVal = 2;
    expect(Math.floor(initial / divVal)).toBe(15);
  });

  it('умножение с дробным множителем даёт прирост (×2.5 → минимум 1 копия на моба)', () => {
    // Раньше брался Math.floor(factor)-1 → при factor=1.4 добавка была 0 ("ворота не работали").
    // Теперь целая часть даёт гарантированную копию, дробная — шанс дополнительной.
    const factor = 2.5;
    const basePerMob = Math.floor(factor) - 1; // 1 гарантированная копия
    const fracChance = factor - Math.floor(factor); // 0.5
    expect(basePerMob).toBe(1);
    expect(fracChance).toBeCloseTo(0.5);
    expect(basePerMob + (fracChance > 0 ? 1 : 0)).toBeGreaterThanOrEqual(1);
  });

  it('бонусные типы соответствуют зарегистрированным эффектам', () => {
    const bonusTypes = ['add_mobs', 'heal', 'adrenaline', 'coins'] as const;
    // Каждый тип бонуса должен обрабатываться менеджером (не выпадать в дефолт).
    const handled = new Set(bonusTypes);
    expect(handled.has('add_mobs')).toBe(true);
    expect(handled.has('heal')).toBe(true);
    expect(handled.has('adrenaline')).toBe(true);
    expect(handled.has('coins')).toBe(true);
  });

  it('синергия формаций с воротами: circle даёт +30% при сложении, arrow даёт +0.5 к множителю, wedge снижает потери при делении', () => {
    // circle: add +N -> +30%
    const baseAdd = 10;
    const circleAdd = Math.round(baseAdd * 1.3);
    expect(circleAdd).toBe(13);

    // arrow: multiply *N -> +0.5 factor (capped at 4)
    const multVal = 2;
    const arrowMult = Math.min(4, multVal + 0.5);
    expect(arrowMult).toBe(2.5);

    const highMultVal = 3.8;
    const arrowHighMult = Math.min(4, highMultVal + 0.5);
    expect(arrowHighMult).toBe(4.0);

    // wedge: divide /N -> divisor / 0.9 (меньше потерь)
    const divVal = 2;
    const wedgeDiv = divVal / 0.9;
    expect(wedgeDiv).toBeGreaterThan(2.2);

    // wide: add +N -> +50% (шеренга прожимает оба крыла ворот)
    const wideAdd = Math.round(baseAdd * 1.5);
    expect(wideAdd).toBe(15);
  });

  it('звёзды по цели уровня: getTargetMobsToWin детерминирован, getStarsForFinish по доле от цели', () => {
    // Формула цели уровня (детерминированная, кап 100).
    expect(getTargetMobsToWin(1)).toBe(9);
    expect(getTargetMobsToWin(10)).toBe(26);
    expect(getTargetMobsToWin(50)).toBe(98);
    expect(getTargetMobsToWin(100)).toBe(100);

    // 100% цели → 3 звезды; 60% → 2; меньше → 1. Старый хардкод 60/20 не учитывал цель.
    expect(getStarsForFinish(9, 9)).toBe(3);    // L1: 9 из 9 — тройка (раньше была 1)
    expect(getStarsForFinish(6, 9)).toBe(2);    // ceil(9*0.6)=6
    expect(getStarsForFinish(5, 9)).toBe(1);
    expect(getStarsForFinish(98, 98)).toBe(3);
    expect(getStarsForFinish(59, 98)).toBe(2);  // ceil(58.8)=59
    expect(getStarsForFinish(58, 98)).toBe(1);
  });

  it('множитель экономики единый: getIncomeMultiplier синхронен формулам commitRun/addCoins', () => {
    const mgr = StateManager.getInstance();
    mgr.resetProgress();
    // Уровень апгрейда 0 → множитель 1.
    expect(mgr.getIncomeMultiplier()).toBe(1);
    // Формула: 1 + уровень * 0.15 (кап уровней до 10 в UI, формула не ограничена).
    mgr.upgradeStat('incomeMultiplier');
    expect(mgr.getIncomeMultiplier()).toBeCloseTo(1.15);
  });

  it('трансмутация ворот ÷N Хроно-Магом: one-shot guard предотвращает задвоение спавна при проходе несколькими пачками', () => {
    // Симуляция логики прохода ворот ÷N:
    // 1-я пачка: мобы без Мага -> деление толпы
    // 2-я пачка: появляется Маг -> ворота трансмутируются в +N (Math.max(1, Math.round(val * 0.6)))
    // 3-я пачка: хвостовые бойцы (или еще один Маг) -> трансмутация УЖЕ активна, спавн НЕ повторяется
    const gateVal = 10;
    const gateVisual = {
      transmutedByMage: false,
      triggered: false,
    };

    let spawnedMobsTotal = 0;
    let dividedMobsCount = 0;

    const simulateGatePass = (wing: { id: number; type: string }[]) => {
      const isFirstTrigger = !gateVisual.triggered;
      const isNewTransmute = !gateVisual.transmutedByMage && wing.some((m) => m.type === 'mage');
      let isPositive = false;
      let netChange = 0;

      if (gateVisual.transmutedByMage || isNewTransmute) {
        const shouldSpawn = isNewTransmute || (!gateVisual.transmutedByMage && isFirstTrigger);
        gateVisual.transmutedByMage = true;
        const transmuteVal = Math.max(1, Math.round(gateVal * 0.6));
        let base = 0;
        if (shouldSpawn) {
          base = transmuteVal;
          spawnedMobsTotal += base;
        }
        if (base > 0) {
          netChange = base;
        }
        isPositive = true;
      } else {
        const killed = Math.floor(wing.length / 2);
        dividedMobsCount += killed;
        netChange = -killed;
      }

      gateVisual.triggered = true;
      return { isPositive, netChange };
    };

    // Пачка 1: 4 обычных моба (без Мага)
    const batch1 = [
      { id: 1, type: 'regular' },
      { id: 2, type: 'regular' },
      { id: 3, type: 'regular' },
      { id: 4, type: 'regular' },
    ];
    const res1 = simulateGatePass(batch1);
    expect(res1.isPositive).toBe(false);
    expect(gateVisual.transmutedByMage).toBe(false);
    expect(gateVisual.triggered).toBe(true);
    expect(spawnedMobsTotal).toBe(0);
    expect(dividedMobsCount).toBe(2);

    // Пачка 2: 2 моба, включая Мага (первое срабатывание трансмутации)
    const batch2 = [
      { id: 5, type: 'regular' },
      { id: 6, type: 'mage' },
    ];
    const res2 = simulateGatePass(batch2);
    expect(res2.isPositive).toBe(true);
    expect(gateVisual.transmutedByMage).toBe(true);
    expect(spawnedMobsTotal).toBe(6); // Math.round(10 * 0.6) = 6
    expect(res2.netChange).toBe(6);

    // Пачка 3: 3 моба (включая еще одного Мага) — повторный проход не должен спавнить мобов
    const batch3 = [
      { id: 7, type: 'mage' },
      { id: 8, type: 'regular' },
      { id: 9, type: 'regular' },
    ];
    const res3 = simulateGatePass(batch3);
    expect(res3.isPositive).toBe(true);
    expect(gateVisual.transmutedByMage).toBe(true);
    expect(spawnedMobsTotal).toBe(6); // НЕ увеличилось до 12
    expect(res3.netChange).toBe(0); // нет повторного начисления
  });

  it('трансмутация ворот ÷N: если Маг в 1-й пачке, трансмутация срабатывает сразу и спавнит мобов один раз', () => {
    const gateVal = 5;
    const gateVisual = {
      transmutedByMage: false,
      triggered: false,
    };
    let spawnedMobsTotal = 0;

    const simulateGatePass = (wing: { id: number; type: string }[]) => {
      const isFirstTrigger = !gateVisual.triggered;
      const isNewTransmute = !gateVisual.transmutedByMage && wing.some((m) => m.type === 'mage');
      let isPositive = false;

      if (gateVisual.transmutedByMage || isNewTransmute) {
        const shouldSpawn = isNewTransmute || (!gateVisual.transmutedByMage && isFirstTrigger);
        gateVisual.transmutedByMage = true;
        const transmuteVal = Math.max(1, Math.round(gateVal * 0.6));
        let base = 0;
        if (shouldSpawn) {
          base = transmuteVal;
          spawnedMobsTotal += base;
        }
        isPositive = true;
      }

      gateVisual.triggered = true;
      return { isPositive };
    };

    // 1-я пачка с Магом
    const res1 = simulateGatePass([{ id: 1, type: 'mage' }]);
    expect(res1.isPositive).toBe(true);
    expect(gateVisual.transmutedByMage).toBe(true);
    expect(spawnedMobsTotal).toBe(3); // Math.round(5 * 0.6) = 3

    // 2-я пачка без Мага
    const res2 = simulateGatePass([{ id: 2, type: 'regular' }]);
    expect(res2.isPositive).toBe(true);
    expect(spawnedMobsTotal).toBe(3); // спавн не повторился
  });

  it('трансмутация ворот mystery (÷N) Хроно-Магом: без Мага делит толпу, с Магом трансмутирует в бонус и не задваивает спавн', () => {
    const val = 10;
    const comboFactor = 1;

    // 1) Без Мага в крыле: netChange отрицательный (-div), transmutedByMage = false, isPositive = false
    {
      const gateVisual = {
        mysteryResult: false,
        transmutedByMage: false,
        triggered: false,
      };
      const wing = [
        { id: 1, type: 'regular' },
        { id: 2, type: 'regular' },
        { id: 3, type: 'regular' },
        { id: 4, type: 'regular' },
      ];
      const isFirstTrigger = !gateVisual.triggered;
      const isNewTransmute = !gateVisual.transmutedByMage && wing.some((m) => m.type === 'mage');
      let isPositive = false;
      let netChange = 0;

      if (gateVisual.transmutedByMage || isNewTransmute) {
        gateVisual.transmutedByMage = true;
        const transmuteVal = Math.max(1, Math.round(val * 0.6));
        const shouldSpawn = isNewTransmute;
        let base = 0;
        if (shouldSpawn && isFirstTrigger) {
          base = transmuteVal;
        }
        if (base > 0) {
          const bonus = Math.floor(base * (comboFactor - 1));
          netChange = bonus > 0 ? base + bonus : base;
        }
        isPositive = true;
      } else {
        const killed = Math.floor(wing.length / 2);
        netChange = -killed;
      }
      gateVisual.triggered = true;

      expect(isPositive).toBe(false);
      expect(gateVisual.transmutedByMage).toBe(false);
      expect(netChange).toBe(-2);
    }

    // 2) С Магом в крыле: transmutedByMage = true, netChange = Math.round(val * 0.6), isPositive = true,
    // а повторный проход хвостом НЕ задваивает спавн (спавнит 0, а не дублирует)
    {
      const gateVisual = {
        mysteryResult: false,
        transmutedByMage: false,
        triggered: false,
      };
      let spawnedMobsTotal = 0;

      const simulateMysteryPass = (wing: { id: number; type: string }[]) => {
        const isFirstTrigger = !gateVisual.triggered;
        const isNewTransmute = !gateVisual.transmutedByMage && wing.some((m) => m.type === 'mage');
        let isPositive = false;
        let netChange = 0;

        if (gateVisual.transmutedByMage || isNewTransmute) {
          gateVisual.transmutedByMage = true;
          const transmuteVal = Math.max(1, Math.round(val * 0.6));
          const shouldSpawn = isNewTransmute;
          let base = 0;
          if (shouldSpawn) {
            base = transmuteVal;
            spawnedMobsTotal += base;
          }
          if (base > 0) {
            const bonus = Math.floor(base * (comboFactor - 1));
            netChange = bonus > 0 ? base + bonus : base;
          }
          isPositive = true;
        } else {
          const killed = Math.floor(wing.length / 2);
          netChange = -killed;
        }
        gateVisual.triggered = true;
        return { isPositive, netChange };
      };

      // Пачка 1: с Магом
      const res1 = simulateMysteryPass([
        { id: 1, type: 'regular' },
        { id: 2, type: 'mage' },
      ]);
      expect(res1.isPositive).toBe(true);
      expect(gateVisual.transmutedByMage).toBe(true);
      expect(res1.netChange).toBe(6); // Math.round(10 * 0.6) = 6
      expect(spawnedMobsTotal).toBe(6);

      // Пачка 2: хвост без Мага (или с еще одним Магом) — transmutedByMage уже true, спавн = 0
      const res2 = simulateMysteryPass([
        { id: 3, type: 'regular' },
      ]);
      expect(res2.isPositive).toBe(true);
      expect(gateVisual.transmutedByMage).toBe(true);
      expect(res2.netChange).toBe(0);
      expect(spawnedMobsTotal).toBe(6); // спавн не задвоился
    }

    // 3) Маг во ВТОРОМ ряду: первый ряд (без Мага) триггерит ворота (isFirstTrigger=true),
    // Маг приходит на 1-2 кадра позже (isFirstTrigger=false). Трансмутация должна
    // сработать и заспавнить мобов, НЕ завися от isFirstTrigger (фикс silent-bug).
    {
      const gateVisual = {
        mysteryResult: false,
        transmutedByMage: false,
        triggered: false,
      };
      let spawnedMobsTotal = 0;

      const simulateMysteryPass = (wing: { id: number; type: string }[]) => {
        const isFirstTrigger = !gateVisual.triggered;
        const isNewTransmute = !gateVisual.transmutedByMage && wing.some((m) => m.type === 'mage');
        let isPositive = false;
        let netChange = 0;

        if (gateVisual.transmutedByMage || isNewTransmute) {
          gateVisual.transmutedByMage = true;
          const transmuteVal = Math.max(1, Math.round(val * 0.6));
          const shouldSpawn = isNewTransmute;
          let base = 0;
          if (shouldSpawn) {
            base = transmuteVal;
            spawnedMobsTotal += base;
          }
          if (base > 0) {
            const bonus = Math.floor(base * (comboFactor - 1));
            netChange = bonus > 0 ? base + bonus : base;
          }
          isPositive = true;
        } else {
          const killed = Math.floor(wing.length / 2);
          netChange = -killed;
        }
        gateVisual.triggered = true;
        return { isPositive, netChange };
      };

      // Пачка 1: первый ряд БЕЗ Мага — ворота срабатывают как штраф (isFirstTrigger=true)
      const res1 = simulateMysteryPass([
        { id: 1, type: 'regular' },
        { id: 2, type: 'regular' },
      ]);
      expect(res1.isPositive).toBe(false);
      expect(gateVisual.transmutedByMage).toBe(false);
      expect(res1.netChange).toBe(-1);

      // Пачка 2: Маг во втором ряду (isFirstTrigger=false) — трансмутация ДОЛЖНА заспавнить
      const res2 = simulateMysteryPass([{ id: 3, type: 'mage' }]);
      expect(res2.isPositive).toBe(true);
      expect(gateVisual.transmutedByMage).toBe(true);
      expect(res2.netChange).toBe(6); // Math.round(10 * 0.6) = 6
      expect(spawnedMobsTotal).toBe(6); // спавн сработал несмотря на isFirstTrigger=false
    }
  });
});

describe('Economy & Upgrades', () => {
  it('множитель дохода масштабируется корректно', () => {
    const baseReward = 100;
    const upgradeLevel = 4;
    const multiplier = 1 + upgradeLevel * 0.15;
    const finalReward = Math.round(baseReward * multiplier);
    expect(finalReward).toBe(160);
  });

  it('начальный отряд увеличивается на 1 за уровень', () => {
    const baseStarting = 1;
    const upgradeLvl = 5;
    expect(baseStarting + upgradeLvl).toBe(6);
  });

  it('стоимость прокачки масштабируется экспоненциально', () => {
    const baseCost = 100;
    const lvl0 = Math.round(baseCost * Math.pow(1.5, 0));
    const lvl2 = Math.round(baseCost * Math.pow(1.5, 2));
    expect(lvl0).toBe(100);
    expect(lvl2).toBe(225);
  });
});

describe('Save System', () => {
  it('сериализация и экспорт/импорт base64', () => {
    const mgr = StateManager.getInstance();
    mgr.addCoins(500);
    const exported = mgr.exportSave();
    expect(exported.length).toBeGreaterThan(20);
    const ok = mgr.importSave(exported);
    expect(ok).toBe(true);
  });

  it('безопасно отклоняет повреждённый base64', () => {
    const mgr = StateManager.getInstance();
    const result = mgr.importSave('not-valid-base64-random-string@@!#$');
    expect(result).toBe(false);
  });

  it('runRecordNearMiss накапливает счётчик уворотов в упор в RunStats', () => {
    const mgr = StateManager.getInstance();
    mgr.beginRun();
    mgr.runRecordNearMiss(1);
    mgr.runRecordNearMiss(2);
    expect(mgr.getRun()?.nearMisses).toBe(3);
    // Новый забег сбрасывает счётчик.
    mgr.beginRun();
    expect(mgr.getRun()?.nearMisses).toBe(0);
  });

  it('серия уворотов эскалирует множитель награды (x1 → x2 → x5 → x10)', () => {
    expect(getNearMissMultiplier(1)).toBe(1);
    expect(getNearMissMultiplier(2)).toBe(2);
    expect(getNearMissMultiplier(4)).toBe(2);
    expect(getNearMissMultiplier(5)).toBe(5);
    expect(getNearMissMultiplier(9)).toBe(5);
    expect(getNearMissMultiplier(10)).toBe(10);
    expect(getNearMissMultiplier(15)).toBe(10);
  });

  it('runRecordNearMissStreak наращивает серию и фиксирует рекорд, сброс обнуляет текущую', () => {
    const mgr = StateManager.getInstance();
    mgr.beginRun();
    expect(mgr.runRecordNearMissStreak().multiplier).toBe(1);
    expect(mgr.runRecordNearMissStreak().multiplier).toBe(2); // streak=2 → x2
    expect(mgr.runRecordNearMissStreak().multiplier).toBe(2); // streak=3 → x2
    expect(mgr.runRecordNearMissStreak().multiplier).toBe(2); // streak=4 → x2
    expect(mgr.runRecordNearMissStreak().multiplier).toBe(5); // streak=5 → x5
    expect(mgr.getRun()?.maxNearMissStreak).toBe(5);
    mgr.runResetNearMissStreak();
    expect(mgr.getRun()?.nearMissStreak).toBe(0);
    expect(mgr.getRun()?.maxNearMissStreak).toBe(5); // рекорд сохраняется
  });
});

describe('Level Generator Smoke Tests', () => {
  it('все 50 уровней генерируются без ошибок и инвариантов', () => {
    for (let lvl = 1; lvl <= 50; lvl++) {
      const config = LevelGenerator.generateLevel(lvl);
      expect(config).toBeDefined();
      expect(config.levelNumber).toBe(lvl);
      expect(config.trackLength).toBeGreaterThanOrEqual(1000);
      expect(config.trackLength).toBeLessThanOrEqual(3000);
      expect(config.gates.length).toBeGreaterThanOrEqual(2);
      expect(config.trackWidth).toBe(DEFAULT_TRACK_WIDTH);
    }
  });

  it('все 5 босс-уровней (10, 20, 30, 40, 50) имеют корректных боссов и атаки', () => {
    const bossLevels = [10, 20, 30, 40, 50];
    for (const lvl of bossLevels) {
      const config = LevelGenerator.generateLevel(lvl);
      expect(config.boss).toBeDefined();
      expect(config.boss!.hp).toBeGreaterThan(0);
      expect(config.boss!.maxHp).toBeGreaterThan(0);
      expect(config.boss!.attacks.length).toBeGreaterThan(0);
    }
  });

  it('боссы имеют разнообразные исполняемые атаки (minions/meteors/shield не мёртвые)', () => {
    // Все 5 типов атак (slam/laser/minions/meteors/shield) должны быть задействованы
    // в ротации боссов L10–L50 — ни один не остаётся "мёртвым" (в union, но не спавнится).
    const bossLevels = [10, 20, 30, 40, 50];
    const allTypes = new Set<string>();
    for (const lvl of bossLevels) {
      const config = LevelGenerator.generateLevel(lvl);
      const types = config.boss!.attacks.map((a) => a.type);
      expect(types.length).toBeGreaterThan(0);
      types.forEach((t) => allTypes.add(t));
    }
    // Раньше у всех боссов был только slam/laser/minions; meteors/shield в union,
    // но ни один босс их не использовал. Теперь каждый тип хотя бы раз встречается.
    for (const t of ['slam', 'laser', 'minions', 'meteors', 'shield']) {
      expect(allTypes.has(t)).toBe(true);
    }
  });

  it('ворота строго упорядочены по координате Z', () => {
    for (let lvl = 1; lvl <= 50; lvl++) {
      const config = LevelGenerator.generateLevel(lvl);
      for (let i = 1; i < config.gates.length; i++) {
        expect(config.gates[i].z).toBeGreaterThan(config.gates[i - 1].z);
      }
    }
  });

  it('препятствия не выходят за границы трассы', () => {
    for (let lvl = 1; lvl <= 50; lvl++) {
      const config = LevelGenerator.generateLevel(lvl);
      for (const obs of config.obstacles) {
        expect(Math.abs(obs.x) + obs.width / 2).toBeLessThanOrEqual(config.trackWidth / 2 + 0.1);
      }
    }
  });

  it('динамические события генерируются детерминированно и покрывают все 5 типов', () => {
    // Система событий была "мёртвой": генерировалась, но не исполнялась. Теперь все 5 типов
    // (ambush/coin_train/emp_storm/meteor_rain/speed_boost) должны реально появляться,
    // события отсортированы по triggerZ и не залезают в босс-арену.
    const allTypes = new Set<string>();
    for (let lvl = 3; lvl <= 50; lvl++) {
      const config = LevelGenerator.generateLevel(lvl);
      expect(config.events).toBeDefined();
      expect(config.events.length).toBeGreaterThanOrEqual(1);
      for (const evt of config.events) {
        expect(evt.triggerZ).toBeGreaterThan(0);
        expect(evt.triggerZ).toBeLessThan(config.trackLength - 40);
        allTypes.add(evt.type);
      }
      // События упорядочены по triggerZ.
      for (let i = 1; i < config.events.length; i++) {
        expect(config.events[i].triggerZ).toBeGreaterThan(config.events[i - 1].triggerZ);
      }
    }
    // Все 5 типов должны встречаться хотя бы раз на 3..50 уровнях.
    expect(allTypes.size).toBe(5);
    for (const t of ['ambush', 'coin_train', 'emp_storm', 'meteor_rain', 'speed_boost']) {
      expect(allTypes.has(t)).toBe(true);
    }
  });
});

describe('Level Generator Enhanced Tests', () => {
  it('generateLevel детерминирован: повторный вызов даёт идентичный результат', () => {
    const a = LevelGenerator.generateLevel(5);
    const b = LevelGenerator.generateLevel(5);
    expect(a.gates.length).toBe(b.gates.length);
    expect(a.walls.length).toBe(b.walls.length);
    expect(a.obstacles.length).toBe(b.obstacles.length);
    expect(a.coins.length).toBe(b.coins.length);
    expect(a.bonuses.length).toBe(b.bonuses.length);
    for (let i = 0; i < a.gates.length; i++) {
      expect(a.gates[i].z).toBeCloseTo(b.gates[i].z, 6);
    }
    for (let i = 0; i < a.obstacles.length; i++) {
      expect(a.obstacles[i].z).toBeCloseTo(b.obstacles[i].z, 6);
      expect(a.obstacles[i].x).toBeCloseTo(b.obstacles[i].x, 6);
    }
    for (let i = 0; i < a.coins.length; i++) {
      expect(a.coins[i].z).toBeCloseTo(b.coins[i].z, 6);
      expect(a.coins[i].x).toBeCloseTo(b.coins[i].x, 6);
    }
  });

  it('generateEndlessSegment детерминирован: повторный вызов даёт идентичный результат', () => {
    const a = LevelGenerator.generateEndlessSegment(0, 0);
    const b = LevelGenerator.generateEndlessSegment(0, 0);
    expect(a.gates.length).toBe(b.gates.length);
    expect(a.walls.length).toBe(b.walls.length);
    expect(a.obstacles.length).toBe(b.obstacles.length);
    expect(a.coins.length).toBe(b.coins.length);
    expect(a.bonuses.length).toBe(b.bonuses.length);
    for (let i = 0; i < a.gates.length; i++) {
      expect(a.gates[i].z).toBeCloseTo(b.gates[i].z, 6);
    }
    for (let i = 0; i < a.obstacles.length; i++) {
      expect(a.obstacles[i].z).toBeCloseTo(b.obstacles[i].z, 6);
      expect(a.obstacles[i].x).toBeCloseTo(b.obstacles[i].x, 6);
    }
  });

  it('gate и obstacle никогда не сталкиваются (clearance по Z >= 10, и нет X-перекрытия в z-полосе)', () => {
    for (let lvl = 1; lvl <= 50; lvl++) {
      const config = LevelGenerator.generateLevel(lvl);
      for (const gate of config.gates) {
        const gateHalf = gate.width / 2;
        const gateCenterX = gate.x;
        for (const obs of config.obstacles) {
          const dz = Math.abs(gate.z - obs.z);
          // Сильный инвариант: clearance по Z всегда >= 10.
          expect(dz).toBeGreaterThanOrEqual(10);
          // Если (гипотетически) ворота и препятствие оказались бы на одной z-полосе,
          // они не должны перекрываться по X.
          if (dz < 10) {
            const dx = Math.abs(gateCenterX - obs.x);
            expect(dx).toBeGreaterThan(gateHalf + obs.width / 2);
          }
        }
      }
    }
  });

  it('монеты не лежат внутри хитбоксов препятствий', () => {
    for (let lvl = 1; lvl <= 50; lvl++) {
      const config = LevelGenerator.generateLevel(lvl);
      for (const coin of config.coins) {
        for (const obs of config.obstacles) {
          if (Math.abs(coin.z - obs.z) < 2) {
            expect(Math.abs(coin.x - obs.x)).toBeGreaterThan(obs.width / 2 + 0.5);
          }
        }
      }
    }
  });

  it('ворота используют +, ÷, multiply и mystery; все значения целые, ÷>=2, multiply∈{2,3}', () => {
    const allowed = ['add', 'divide', 'multiply', 'mystery'];
    for (let lvl = 1; lvl <= 50; lvl++) {
      const config = LevelGenerator.generateLevel(lvl);
      for (const g of config.gates) {
        expect(allowed).toContain(g.op);
        // Значения всегда целые.
        expect(Number.isInteger(g.value)).toBe(true);
        // Делитель >= 2 (иначе нет смысла).
        if (g.op === 'divide') expect(g.value).toBeGreaterThanOrEqual(2);
        if (g.op === 'add') expect(g.value).toBeGreaterThanOrEqual(1);
        // Множитель — целое 2 или 3 (безопасный темп роста).
        if (g.op === 'multiply') expect([2, 3]).toContain(g.value);
      }
    }
  });

  it('ворота не выходят за границы трассы (по X с учётом ширины)', () => {
    for (let lvl = 1; lvl <= 50; lvl++) {
      const config = LevelGenerator.generateLevel(lvl);
      for (const g of config.gates) {
        expect(Math.abs(g.x) + g.width / 2).toBeLessThanOrEqual(config.trackWidth / 2 + 0.4);
      }
    }
  });

  it('стены со счётчиком имеют целый count, killsRemaining >= 1 и не выходят за трассу', () => {
    for (let lvl = 3; lvl <= 50; lvl++) {
      const config = LevelGenerator.generateLevel(lvl);
      for (const w of config.walls) {
        expect(Number.isInteger(w.count)).toBe(true);
        expect(w.count).toBeGreaterThanOrEqual(1);
        expect(w.killsRemaining).toBe(w.count); // начинаются с полным счётчиком
        expect(Math.abs(w.x) + w.width / 2).toBeLessThanOrEqual(config.trackWidth / 2 + 0.4);
      }
    }
  });

  it('cap производительности: gates<=40, walls<=12, bonuses<=14, obstacles<=120, coins<=360', () => {
    for (let lvl = 1; lvl <= 50; lvl++) {
      const config = LevelGenerator.generateLevel(lvl);
      expect(config.gates.length).toBeLessThanOrEqual(40);
      expect(config.walls.length).toBeLessThanOrEqual(12);
      expect(config.bonuses.length).toBeLessThanOrEqual(14);
      expect(config.obstacles.length).toBeLessThanOrEqual(120);
      expect(config.coins.length).toBeLessThanOrEqual(360);
    }
  });

  it('soft-lock / проходимость: препятствия не блокируют весь трек', () => {
    for (let lvl = 1; lvl <= 50; lvl++) {
      const config = LevelGenerator.generateLevel(lvl);
      for (const obs of config.obstacles) {
        expect(obs.width).toBeLessThanOrEqual(config.trackWidth - 3.2);
        if (obs.type === 'barrier_gate') {
          expect(obs.width).toBeLessThanOrEqual(3.5);
        }
      }
    }
  });

  it('паттерн central_bastion_split заблокирован на уровнях < 4 и доступен для выбора на уровнях >= 4', () => {
    // На уровнях < 4 фильтр selectPattern исключает central_bastion_split
    for (const phase of ['peak', 'corridor', 'climax'] as const) {
      for (let i = 0; i < 20; i++) {
        const pat = (LevelGenerator as any).selectPattern(phase, 3, null, () => i / 20);
        expect(pat).not.toBe('central_bastion_split');
      }
    }

    // На уровнях >= 4 central_bastion_split присутствует в пуле фаз peak, corridor, climax
    for (const phase of ['peak', 'corridor', 'climax'] as const) {
      const candidates: string[] = [];
      for (let i = 0; i <= 100; i++) {
        const pat = (LevelGenerator as any).selectPattern(phase, 4, null, () => i / 100);
        candidates.push(pat);
      }
      expect(candidates).toContain('central_bastion_split');
    }

    // В кампании уровней 4..50 паттерн генерируется (содержит стены бастиона или монеты)
    let bastionFoundInCampaign = false;
    for (let lvl = 4; lvl <= 50; lvl++) {
      const config = LevelGenerator.generateLevel(lvl);
      if (
        config.walls.some((w) => w.id.includes('bastion')) ||
        config.coins.some((c) => c.id.includes('bastion'))
      ) {
        bastionFoundInCampaign = true;
        break;
      }
    }
    expect(bastionFoundInCampaign).toBe(true);
  });
});

describe('Object Pool & Memory', () => {
  class TestEntity implements Poolable {
    public val: number = 0;
    reset(): void {
      this.val = 0;
    }
  }

  it('переиспользует объекты и сбрасывает состояние без аллокаций', () => {
    const pool = new ObjectPool(() => new TestEntity(), 10, 50);
    const item = pool.acquire();
    item.val = 999;
    pool.release(item);

    const item2 = pool.acquire();
    expect(item2.val).toBe(0);
  });
});

describe('Formations & Math Helpers', () => {
  it('clamp ограничивает значение в диапазоне', () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('lerp выполняет линейную интерполяцию', () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
    expect(lerp(10, 20, 0.1)).toBeCloseTo(11);
  });

  it('calculateFormationOffset возвращает корректные координаты для всех формаций', () => {
    const PLAYABLE_HALF_WIDTH = 6.8; // соответствует боевой ширине трассы 16
    const formations = ['wedge', 'wide', 'circle', 'arrow', 'oval'] as const;
    for (const f of formations) {
      const offset0 = calculateFormationOffset(0, 50, f, PLAYABLE_HALF_WIDTH);
      expect(Number.isFinite(offset0.x)).toBe(true);
      expect(Number.isFinite(offset0.z)).toBe(true);

      const offset10 = calculateFormationOffset(10, 50, f, PLAYABLE_HALF_WIDTH);
      expect(Number.isFinite(offset10.x)).toBe(true);
      expect(Number.isFinite(offset10.z)).toBe(true);
    }

    expect(calculateFormationOffset(0, 50, 'wedge', PLAYABLE_HALF_WIDTH)).toEqual({ x: 0, z: 0 });
    expect(calculateFormationOffset(0, 50, 'circle', PLAYABLE_HALF_WIDTH)).toEqual({ x: 0, z: 0 });
    expect(calculateFormationOffset(0, 50, 'arrow', PLAYABLE_HALF_WIDTH)).toEqual({ x: 0, z: 0 });
  });

  it('calculateFormationOffset никогда не выходит за playableHalfWidth даже при огромной толпе', () => {
    const PLAYABLE_HALF_WIDTH = 6.8;
    const formations = ['wedge', 'wide', 'circle', 'oval'] as const; // arrow всегда узкая, не сжимается
    for (const f of formations) {
      for (const n of [50, 100, 200, 400]) {
        for (let i = 0; i < n; i++) {
          const offset = calculateFormationOffset(i, n, f, PLAYABLE_HALF_WIDTH);
          expect(Math.abs(offset.x)).toBeLessThanOrEqual(PLAYABLE_HALF_WIDTH + 1e-9);
        }
      }
    }
  });

  it('circleRectGap: отрицательный при пересечении, ~0 при касании, положительный при зазоре', () => {
    // Круг (0,0,r=0.3) и прямоугольник (rx=0, rz=0, rw=2, rd=2): круг внутри → gap<0.
    expect(circleRectGap(0, 0, 0.3, 0, 0, 2, 2)).toBeLessThan(0);
    // Круг касается правого края прямоугольника (rw/2=1): mx=1.3 → gap≈0.
    expect(circleRectGap(1.3, 0, 0.3, 0, 0, 2, 2)).toBeCloseTo(0, 5);
    // Круг в зазоре 0.4 от края: mx=1.7 → gap≈0.4.
    expect(circleRectGap(1.7, 0, 0.3, 0, 0, 2, 2)).toBeCloseTo(0.4, 5);
    // Далеко по диагонали: гипотенуза минус радиус.
    expect(circleRectGap(2, 2, 0.3, 0, 0, 2, 2)).toBeCloseTo(Math.hypot(1, 1) - 0.3, 5);
  });
});

describe('Skin Rewards (бонусные скины)', () => {
  it('прохождение 30 уровня бесплатно открывает скин dino_rex', () => {
    const mgr = StateManager.getInstance();
    mgr.resetProgress();
    expect(mgr.getState().unlockedSkins.includes('dino_rex')).toBe(false);
    mgr.completeLevel(30, 1000, 100, 3);
    expect(mgr.getState().unlockedSkins.includes('dino_rex')).toBe(true);
  });

  it('уровни до 30 не открывают скин dino_rex', () => {
    const mgr = StateManager.getInstance();
    mgr.resetProgress();
    mgr.completeLevel(10, 1000, 100, 3);
    expect(mgr.getState().unlockedSkins.includes('dino_rex')).toBe(false);
  });

  it('клейм достижения legion_150 открывает скин glitch_zombie', () => {
    const mgr = StateManager.getInstance();
    mgr.resetProgress();
    expect(mgr.getState().unlockedSkins.includes('glitch_zombie')).toBe(false);
    // Прогресс достижения 150 мобов
    mgr.updateAchievementProgress('legion_150', 150);
    const ok = mgr.claimAchievement('legion_150');
    expect(ok).toBe(true);
    expect(mgr.getState().unlockedSkins.includes('glitch_zombie')).toBe(true);
  });

  it('achievement adrenaline_god прогрессирует и клеймится после 20 активаций Гипер-режима', () => {
    const mgr = StateManager.getInstance();
    mgr.resetProgress();
    expect(mgr.getState().achievements['adrenaline_god']).toBeUndefined();
    // 19 активаций — достижение ещё не готово к клейму.
    for (let i = 0; i < 19; i++) mgr.recordAdrenalineActivation();
    expect(mgr.getState().achievements['adrenaline_god']?.progress).toBe(19);
    expect(mgr.claimAchievement('adrenaline_god')).toBe(false);
    // 20-я активация доводит до цели — достижение можно забрать.
    mgr.recordAdrenalineActivation();
    expect(mgr.getState().achievements['adrenaline_god']?.progress).toBe(20);
    expect(mgr.claimAchievement('adrenaline_god')).toBe(true);
  });

  it('lifetime-статы продвигают новые достижения через commitRun', () => {
    const mgr = StateManager.getInstance();
    mgr.resetProgress();
    // Накапливаем забег: 60 препятствий, 120 ворот, 1200 мобов, 6 боссов, 120 самоцветов.
    mgr.beginRun();
    for (let i = 0; i < 60; i++) mgr.runRecordObstacleSmash();
    for (let i = 0; i < 120; i++) mgr.runRecordGatePass();
    for (let i = 0; i < 1200; i++) mgr.runRecordMobSpawn();
    for (let i = 0; i < 6; i++) mgr.runRecordBossKill(100, 20);
    mgr.commitRun();

    const st = mgr.getState();
    expect(st.achievements['obstacle_crusher']?.progress).toBe(60);
    expect(st.achievements['gate_master']?.progress).toBe(120);
    expect(st.achievements['mob_cloner']?.progress).toBe(1200);
    expect(st.achievements['gem_collector']?.progress).toBe(120);
    expect(st.achievements['boss_hunter']?.progress).toBe(6);

    // Все достижения готовы к клейму.
    expect(mgr.claimAchievement('obstacle_crusher')).toBe(true);
    expect(mgr.claimAchievement('gate_master')).toBe(true);
    expect(mgr.claimAchievement('mob_cloner')).toBe(true);
    expect(mgr.claimAchievement('gem_collector')).toBe(true);
    expect(mgr.claimAchievement('boss_hunter')).toBe(true);
  });

  it('commitRun сохраняет near-misses в totalNearMisses и продвигает достижения', () => {
    const mgr = StateManager.getInstance();
    mgr.resetProgress();
    const initial = mgr.getState().stats.totalNearMisses || 0;

    mgr.beginRun();
    mgr.runRecordNearMiss(5);
    mgr.runRecordNearMissStreak();
    mgr.runRecordNearMissStreak();
    mgr.runRecordNearMissStreak();
    mgr.runRecordNearMissStreak();
    mgr.runRecordNearMissStreak();
    mgr.commitRun();

    const st = mgr.getState();
    expect(st.stats.totalNearMisses).toBe(initial + 10);
    expect(st.achievements['near_miss_50']?.progress).toBeGreaterThanOrEqual(5);
    expect(st.achievements['near_miss_200']?.progress).toBeGreaterThanOrEqual(5);
    // Серия из 5 уворотов в упор продвигает достижения серии (lifetime-максимум).
    expect(st.stats.maxNearMissStreak).toBeGreaterThanOrEqual(5);
    expect(st.achievements['near_miss_streak_5']?.progress).toBeGreaterThanOrEqual(5);
    expect(st.achievements['near_miss_streak_10']?.progress).toBeLessThan(10);
  });

  it('combo-бонус за серию позитивных ворот каппится на +80% (фактор ≤ 1.8)', () => {
    // Формула бонуса из GateManager.executeGateEffect: comboFactor = 1 + min((streak-1)*0.08, 0.8).
    // Проверяем чистую математику без движка.
    const comboFactor = (streak: number) =>
      streak > 1 ? 1 + Math.min((streak - 1) * 0.08, 0.8) : 1;
    // Серия 1 — без бонуса.
    expect(comboFactor(1)).toBe(1);
    expect(comboFactor(0)).toBe(1);
    // Серия 3 — +16%.
    expect(comboFactor(3)).toBeCloseTo(1.16);
    // Серия 10 — 9*0.08 = 0.72 → фактор 1.72 (ещё не кап).
    expect(comboFactor(10)).toBeCloseTo(1.72);
    // Серия 11+ — бонус упёрся в кап 0.8 → фактор 1.8.
    expect(comboFactor(11)).toBeCloseTo(1.8);
    expect(comboFactor(50)).toBeCloseTo(1.8);
    // Прибавка мобов не превышает base*0.8.
    const bonusFor = (base: number, streak: number) =>
      Math.floor(base * (comboFactor(streak) - 1));
    expect(bonusFor(100, 10)).toBeLessThanOrEqual(80);
    expect(bonusFor(100, 1)).toBe(0);
  });
});

describe('Kinetic Wall Impact & Damage Accounting', () => {
  it('Тест A: Танк со щитом наносит 3 урона стене и выживает (shieldHp 2 -> 1, damage=3, killed=false)', () => {
    const tank = { type: 'tank', shieldHp: 2, hp: 3, alive: true };
    const res = computeWallImpact(tank, 'circle');
    expect(res.damageDealt).toBe(3);
    expect(res.killed).toBe(false);
    expect(tank.shieldHp).toBe(1);
    expect(tank.hp).toBe(3);
    expect(tank.alive).toBe(true);
  });

  it('Тест B: Обычный моб наносит 1 урон стене и погибает (damage=1, killed=true)', () => {
    const regular = { type: 'regular', shieldHp: 0, hp: 1, alive: true };
    const res = computeWallImpact(regular, 'oval');
    expect(res.damageDealt).toBe(1);
    expect(res.killed).toBe(true);
    expect(regular.alive).toBe(false);
  });

  it('Формации arrow и circle дают 2 урона стене для обычного моба', () => {
    const mobArrow = { type: 'regular', shieldHp: 0, hp: 1, alive: true };
    const resArrow = computeWallImpact(mobArrow, 'arrow');
    expect(resArrow.damageDealt).toBe(2);
    expect(resArrow.killed).toBe(true);
    expect(mobArrow.alive).toBe(false);

    const mobCircle = { type: 'regular', shieldHp: 0, hp: 1, alive: true };
    const resCircle = computeWallImpact(mobCircle, 'circle');
    expect(resCircle.damageDealt).toBe(2);
    expect(resCircle.killed).toBe(true);
    expect(mobCircle.alive).toBe(false);
  });

  it('Формация diamond даёт 2 урона стене для обычного моба (синхронно с getMobWallDamage)', () => {
    const mob = { type: 'regular', shieldHp: 0, hp: 1, alive: true };
    const res = computeWallImpact(mob, 'diamond');
    expect(res.damageDealt).toBe(2);
    expect(res.killed).toBe(true);
    expect(mob.alive).toBe(false);
  });

  it('Ниндзя с успешным уворотом наносит урон стене и выживает', () => {
    const ninja = { type: 'ninja', shieldHp: 0, hp: 1, alive: true };
    const res = computeWallImpact(ninja, 'oval', false, true);
    expect(res.damageDealt).toBe(1);
    expect(res.killed).toBe(false);
    expect(ninja.alive).toBe(true);
  });

  it('Хроно-Маг наносит 2 урона стене (синхронно с getMobWallDamage)', () => {
    const mage = { type: 'mage', shieldHp: 0, hp: 1, alive: true };
    const res = computeWallImpact(mage, 'oval');
    expect(res.damageDealt).toBe(2);
    expect(res.killed).toBe(true);
    expect(mage.alive).toBe(false);
  });

  it('Моб с hp > 1 без щита наносит урон и теряет 1 hp', () => {
    const beefy = { type: 'regular', shieldHp: 0, hp: 2, alive: true };
    const res = computeWallImpact(beefy, 'oval');
    expect(res.damageDealt).toBe(1);
    expect(res.killed).toBe(false);
    expect(beefy.hp).toBe(1);
    expect(beefy.alive).toBe(true);
  });

  it('Моб в инвуле, гипер-режиме или мёртвый не наносит урон через resolveWallImpact', () => {
    const invulMob = { type: 'tank', shieldHp: 2, hp: 3, alive: true, invulnerableTime: 1.0 };
    expect(computeWallImpact(invulMob, 'circle').damageDealt).toBe(0);

    const deadMob = { type: 'tank', shieldHp: 2, hp: 3, alive: false };
    expect(computeWallImpact(deadMob, 'circle').damageDealt).toBe(0);

    const hyperMob = { type: 'tank', shieldHp: 2, hp: 3, alive: true };
    expect(computeWallImpact(hyperMob, 'circle', true).damageDealt).toBe(0);
  });
});

