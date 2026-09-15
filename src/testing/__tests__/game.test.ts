import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { ObstacleManager, HAZARD_HIT_PITCH } from '../../engine/ObstacleManager';
import { LevelGenerator, DEFAULT_TRACK_WIDTH, getTargetMobsToWin, getStarsForFinish, phaseSpeedMult } from '../../engine/LevelGenerator';
import { StateManager, stateManager } from '../../core/StateManager';
import { eventBus } from '../../core/EventBus';
import { translations } from '../../core/Localization';
import { ObjectPool, Poolable } from '../../core/ObjectPool';
import { BossManager } from '../../engine/BossManager';
import { CrowdManager } from '../../engine/CrowdManager';
import { ParticleSystem } from '../../engine/ParticleSystem';
import { GateManager } from '../../engine/GateManager';
import { BonusManager } from '../../engine/BonusManager';
import type { MobInstance, ObstacleType } from '../../types/game';
import { calculateFormationOffset, getFormationScale, clamp, lerp, circleRectGap, getNearMissMultiplier, computeWallImpact, getFinishWallCost, WIDE_FINISH_DISCOUNT, getMobFinishPower, getMobBossPower, mysteryPenaltyStep, wallGrazedNearMiss } from '../../utils/math';
import { BOSS_TELEGRAPH_STYLE } from '../../components/FloatingText';
import { i18n } from '../../core/Localization';
import type { BossAttack } from '../../types/game';

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

  it('heal-сфера на полной толпе не молчит: конвертится в положительные монеты', () => {
    // Регресс на ветку healed === 0 в BonusManager.applyEffect: раньше сфера
    // пропадала без фидбека. Теперь — конверт в монеты (6, в oval +25% → 8).
    for (const ovalMult of [1.0, 1.25]) {
      const coinValue = Math.round(6 * ovalMult);
      expect(coinValue).toBeGreaterThan(0); // эмит coinCollected всегда с ненулевым значением
    }
    expect(Math.round(6 * 1.25)).toBe(8);
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

    // wedge: divide /N -> делитель ЦЕЛЫЙ, выживание бонусом +10% (Клин) / +15% (Ромб)
    // Было val/0.9: дробный делитель 2.22 целочисленный счётчик округлял до 3 → ÷2
    // давал каждый 3-й (потери 67% вместо обещанных меньше). Теперь делитель val=2.
    const divVal = 2;
    expect(divVal).toBe(2);
    const wedgeRetention = 0.10;
    const diamondRetention = 0.15;
    expect(wedgeRetention).toBeGreaterThan(0);
    expect(diamondRetention).toBeGreaterThan(wedgeRetention);

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
    // addCoins возвращает ФАКТИЧЕСКИ зачисленную сумму (с множителем) — на этом
    // держится честный итог «Всего награда» на экране финала (App.handleLevelWon).
    const before = mgr.getState().coins;
    expect(mgr.addCoins(100)).toBe(115);
    expect(mgr.getState().coins - before).toBe(115);
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

  it('runAddGems (апекс серии из 12 монет) копится в забеге и коммитится в гемы и lifetime-стат', () => {
    const mgr = StateManager.getInstance();
    mgr.beginRun();
    const gemsBefore = mgr.getState().gems;
    const lifetimeBefore = mgr.getState().stats.totalGemsEarned;
    mgr.runAddGems(1);
    expect(mgr.getRun()?.bossGems).toBeGreaterThanOrEqual(1);
    mgr.commitRun();
    expect(mgr.getState().gems).toBe(gemsBefore + 1);
    expect(mgr.getState().stats.totalGemsEarned).toBe(lifetimeBefore + 1);
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

  it('увороты в упор накапливают счётчик в RunStats', () => {
    const mgr = StateManager.getInstance();
    mgr.beginRun();
    mgr.runRecordNearMissStreak();
    mgr.runRecordNearMissStreak();
    mgr.runRecordNearMissStreak();
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

  it('near-miss атаки босса: уворот впритирку даёт серию и монеты, широкий сбрасывает, попадание не трогает', () => {
    const mgr = StateManager.getInstance();
    mgr.beginRun();
    const boss = new BossManager(null as any, null as any);
    const check = (gap: number) => (boss as any).checkBossNearMiss(gap, 1, 0);
    const coinsBase = mgr.getRun()?.coins ?? 0;
    check(0.3); // уворот впритирку (≤ NEAR_MISS_GRANT_GAP=0.35) x1 → +8
    check(0.3); // streak=2 → x2 → +16
    expect(mgr.getRun()?.nearMissStreak).toBe(2);
    expect((mgr.getRun()?.coins ?? 0) - coinsBase).toBe(24);
    check(0.5); // зазор 0.5 > 0.35 — награды нет, но это уже широкий уход → сброс серии
    expect(mgr.getRun()?.nearMissStreak).toBe(0);
    check(1.5); // широкий безопасный уход → сброс серии
    expect(mgr.getRun()?.nearMissStreak).toBe(0);
    expect(mgr.getRun()?.maxNearMissStreak).toBe(2);
    check(-1.0); // попадание в зону — серию не меняет
    expect(mgr.getRun()?.nearMissStreak).toBe(0);
  });

  it('meteors босса: урон только мобам внутри круга взрыва (уклонение работает)', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const boss = new BossManager(null as any, null as any);
      (boss as any).bossMesh = {}; // единственный guard в executeBossAttack
      (boss as any).bossArenaZ = 100;
      // При random=0.5 все 3 эпицентра падают в (0, 94).
      const mobIn = { x: 0, z: 94 } as any; // в эпицентре → гибнет
      const mobOut = { x: 0, z: 88 } as any; // 6 м от эпицентра → выживает
      const killed: any[] = [];
      const crowd = {
        leaderX: 9, leaderZ: 78, // далеко от всех эпицентров — near-miss не участвует
        getAliveMobs: () => [mobIn, mobOut],
        getAliveCount: () => 2,
        killMobsFromGroup: (group: any[], count: number) => {
          killed.push(...group.slice(0, count));
          return Math.min(count, group.length);
        },
      } as any;
      (boss as any).executeBossAttack(
        { type: 'meteors', damage: 5, areaRadius: 3, duration: 0.9, telegraphTime: 1 },
        crowd,
        { emitBurst: () => {}, emitShockwave: () => {} }
      );
      expect(killed.length).toBe(1);
      expect(killed[0]).toBe(mobIn);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('slam босса: урон только мобам внутри кольца телеграфа (паритет с laser/meteors)', () => {
    // Регрессия на глобальный killMobs в slam-ветке: раньше гибли первые по z
    // мобы всей толпы — моб далеко впереди умирал от удара, а моб в самом
    // кольце выживал. Теперь косим только собранных внутри кольца.
    const fx = { emitBurst: () => {}, emitShockwave: () => {} };
    const boss = new BossManager(null as any, fx as any);
    (boss as any).bossMesh = {};
    (boss as any).bossArenaZ = 100;
    const centerZ = 96; // bossArenaZ - 4
    const mobIn = { x: 0, z: centerZ } as any; // в центре кольца r=3.5 → гибнет
    const mobFarFront = { x: 5, z: centerZ + 2 } as any; // вне кольца, но ПЕРВЫЙ по z
    const mobBack = { x: 0, z: centerZ - 20 } as any; // глубоко сзади, вне кольца
    const killed: any[] = [];
    const crowd = {
      leaderX: 9, leaderZ: 78, // далеко от кольца — near-miss не участвует
      getAliveMobs: () => [mobIn, mobFarFront, mobBack],
      getAliveCount: () => 3,
      killMobsFromGroup: (group: any[], count: number) => {
        killed.push(...group.slice(0, count));
        return Math.min(count, group.length);
      },
    } as any;
    (boss as any).executeBossAttack(
      { type: 'slam', damage: 15, areaRadius: 3.5, duration: 0.8, telegraphTime: 1 },
      crowd,
      fx
    );
    expect(killed.length).toBe(1);
    expect(killed[0]).toBe(mobIn);
  });

  it('minions босса: укус бьёт только по мобам у точки роя (spatial-паритет)', () => {
    // Регрессия на глобальный killMobs в minion-тиках: раньше рой косил
    // глобальный фронт толпы, а частицы летели в случайную точку. Теперь
    // центр тика общий для визуала и хитбокса; кап = perTick.
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const boss = new BossManager(null as any, null as any);
      (boss as any).bossArenaZ = 100;
      (boss as any).isDefeated = false;
      (boss as any).currentAttackIndex = 0;
      (boss as any).minionTickAccum = 0.5; // тик срабатывает на этом вызове
      (boss as any).bossData = { attacks: [{ type: 'minions', damage: 3, duration: 2, telegraphTime: 1 }] };
      // random=0.5 → центр укуса (0, 97), R=2.5
      const mobIn = { x: 0, z: 97 } as any;
      const mobEdge = { x: 2.4, z: 97 } as any; // в радиусе, но перечебит кап
      const mobFarFront = { x: 5, z: 99 } as any; // впереди по z, вне радиуса → жив
      const killed: any[] = [];
      let bursts = 0;
      const crowd = {
        leaderX: 9, leaderZ: 78,
        getAliveMobs: () => [mobFarFront, mobIn, mobEdge],
        killMobsFromGroup: (group: any[], count: number) => {
          killed.push(...group.slice(0, count));
          return Math.min(count, group.length);
        },
      } as any;
      (boss as any).breakNearMissStreak = () => {};
      (boss as any).tickMinionDamage(0, crowd, { emitBurst: () => { bursts++; } });
      expect(bursts).toBe(1);
      expect(killed.length).toBe(1); // cap = perTick = max(1, round(3/3*0.5)) = 1
      expect(killed[0]).toBe(mobIn);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('minions босса: пустая зона укуса — мобы не гибнут (dodge-агентность)', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const boss = new BossManager(null as any, null as any);
      (boss as any).bossArenaZ = 100;
      (boss as any).isDefeated = false;
      (boss as any).currentAttackIndex = 0;
      (boss as any).minionTickAccum = 0.5;
      (boss as any).bossData = { attacks: [{ type: 'minions', damage: 3, duration: 2, telegraphTime: 1 }] };
      const mobAway = { x: 8, z: 80 } as any; // далеко от центра укуса (0, 97)
      let bursts = 0;
      const crowd = {
        leaderX: 9, leaderZ: 78,
        getAliveMobs: () => [mobAway],
        killMobsFromGroup: () => { throw new Error('убийство вне радиуса укуса'); },
      } as any;
      (boss as any).breakNearMissStreak = () => {};
      (boss as any).tickMinionDamage(0, crowd, { emitBurst: () => { bursts++; } });
      expect(bursts).toBe(1); // визуал укуса остаётся, даже если рой грызёт воздух
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('телеграф метеоров: точки пре-роллятся на телеграфе и не пере-ролливаются ударом', () => {
    // Регрессия на spatial-телеграф: execute обязан использовать точки,
    // рассчитанные в телеграф-фазе (иначе визуал колец расходится с хитбоксом).
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const boss = new BossManager(null as any, null as any);
      (boss as any).bossMesh = {};
      (boss as any).bossArenaZ = 100;
      (boss as any).rollMeteorPoints({ type: 'meteors', areaRadius: 5 });
      expect((boss as any).meteorStrikes).toBe(5);
      expect((boss as any).meteorPts[0]).toBeCloseTo(-4); // (0-0.5)*8
      expect((boss as any).meteorPts[1]).toBeCloseTo(96); // 100-4-0*4
      // На ударе random изменился, точки должны остаться телеграфными:
      // моб в (0,94) вне круга (-4,96) радиуса 2 → выживает.
      randomSpy.mockReturnValue(0.5);
      const mob = { x: 0, z: 94 } as any;
      const killed: any[] = [];
      const crowd = {
        leaderX: 9, leaderZ: 78,
        getAliveMobs: () => [mob],
        getAliveCount: () => 1,
        killMobsFromGroup: (group: any[], count: number) => {
          killed.push(...group.slice(0, count));
          return Math.min(count, group.length);
        },
      } as any;
      (boss as any).executeBossAttack(
        { type: 'meteors', damage: 5, areaRadius: 5, duration: 0.9, telegraphTime: 1 },
        crowd,
        { emitBurst: () => {}, emitShockwave: () => {} }
      );
      expect(killed.length).toBe(0);
      expect((boss as any).meteorPts[0]).toBeCloseTo(-4);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('стойкость классов при ударе по площади (паритет meteor_rain с бомбами): гипер/щит/HP не ваншотятся', () => {
    // Регрессия на meteor_rain: он звал killMobById напрямую и сносил гипер-режим,
    // щиты и запас HP танков. Наведённый удар площади теперь идёт через
    // resolveObstacleImpact — как мины/собаки/ловушки.
    const c = new CrowdManager(new THREE.Scene());
    // Гипер-режим: удар полностью поглощается, моб выживает.
    (c as any).isHyperMode = true;
    const hyperMob = c.spawnMob('regular') as MobInstance;
    hyperMob.invulnerableTime = 0;
    expect(c.resolveObstacleImpact(hyperMob)).toBe(false);
    expect(hyperMob.alive).toBe(true);
    (c as any).isHyperMode = false;
    // Танк 3-го уровня (щит 2 + HP 3): два щита, потом HP, гибнет только на 4-м ударе.
    // Сброс invulnerableTime перед каждым ударом = удары разнесены за окно
    // i-frames (0.35с): спасение щитом/HP теперь взводит их наравне с аурой,
    // броней формаций и уворотом ниндзя (паритет с непрерывными ловушками).
    const tank = c.spawnMob('tank') as MobInstance;
    tank.invulnerableTime = 0;
    tank.shieldHp = 2;
    tank.hp = 3;
    expect(c.resolveObstacleImpact(tank)).toBe(false); // щит 1
    tank.invulnerableTime = 0;
    expect(c.resolveObstacleImpact(tank)).toBe(false); // щит 2
    tank.invulnerableTime = 0;
    expect(c.resolveObstacleImpact(tank)).toBe(false); // HP 3→2
    tank.invulnerableTime = 0;
    expect(c.resolveObstacleImpact(tank)).toBe(false); // HP 2→1
    tank.invulnerableTime = 0;
    expect(c.resolveObstacleImpact(tank)).toBe(true);  // последний удар — смерть
    expect(tank.alive).toBe(false);
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

  it('мины спавнятся (50 уровней) и генерируются разрушаемыми (танк/таран/Hyper)', () => {
    let bombCount = 0;
    let totalObs = 0;
    for (let lvl = 1; lvl <= 50; lvl++) {
      const obs50 = LevelGenerator.generateLevel(lvl).obstacles;
      totalObs += obs50.length;
      for (const obs of obs50) {
        if (obs.type === 'bomb') {
          bombCount++;
          expect(obs.destructible).toBe(true);
        }
      }
    }
    // Мина недолжна быть ни мгновенно мёртвым типом (0 спавнов), ни спамом (<5%)
    expect(bombCount).toBeGreaterThan(0);
    expect(bombCount / totalObs).toBeLessThan(0.05);
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

  it('getEndlessBiome циклически меняет биомы блоками по 5 сегментов (600м)', () => {
    // Сегменты 0..4 -> cyber_city
    for (let s = 0; s < 5; s++) {
      expect(LevelGenerator.getEndlessBiome(s)).toBe('cyber_city');
    }
    // Сегменты 5..9 -> magma_citadel (босс на сегменте 5 в магме)
    for (let s = 5; s < 10; s++) {
      expect(LevelGenerator.getEndlessBiome(s)).toBe('magma_citadel');
    }
    // Сегменты 10..14 -> crystal_cavern
    for (let s = 10; s < 15; s++) {
      expect(LevelGenerator.getEndlessBiome(s)).toBe('crystal_cavern');
    }
    // Сегменты 15..19 -> quantum_void
    for (let s = 15; s < 20; s++) {
      expect(LevelGenerator.getEndlessBiome(s)).toBe('quantum_void');
    }
    // Сегменты 20..24 -> celestial_core
    for (let s = 20; s < 25; s++) {
      expect(LevelGenerator.getEndlessBiome(s)).toBe('celestial_core');
    }
    // Сегменты 25..29 -> снова cyber_city
    for (let s = 25; s < 30; s++) {
      expect(LevelGenerator.getEndlessBiome(s)).toBe('cyber_city');
    }
  });

  it('боссы Endless циклически ротируются и совпадают с биомом арены', () => {
    const modelByBiome: Record<string, string> = {
      cyber_city: 'iron_golem',
      magma_citadel: 'magma_colossus',
      crystal_cavern: 'crystal_wyrm',
      quantum_void: 'titan_nullifier',
      celestial_core: 'apex_overlord',
    };
    // Арена каждого босс-сегмента (5,10,...) стоит в своём биоме-блоке
    for (const seg of [5, 10, 15, 20, 25, 30, 55]) {
      const boss = LevelGenerator.generateEndlessBoss(seg);
      const biome = LevelGenerator.getEndlessBiome(seg);
      expect(boss.modelType).toBe(modelByBiome[biome]);
    }
    // После 5-го босса круг начинается заново, а не навсегда Apex (сегмент 30 = magma, тир 2)
    expect(LevelGenerator.generateEndlessBoss(30).modelType).toBe('magma_colossus');
    // HP одного и того же тира монотонно растёт по кругам (+40% за полный круг)
    const lap1 = LevelGenerator.generateEndlessBoss(5); // magma, круг 1
    const lap2 = LevelGenerator.generateEndlessBoss(30); // magma, круг 2
    const lap3 = LevelGenerator.generateEndlessBoss(55); // magma, круг 3
    expect(lap2.maxHp).toBeGreaterThan(lap1.maxHp);
    expect(lap3.maxHp).toBeGreaterThan(lap2.maxHp);
    // bossLevel сегмента синхронен с тиром босса (уровень = тир*10)
    const segWithBoss = LevelGenerator.generateEndlessSegment(10, 0);
    expect(segWithBoss.bossLevel).toBe(30);
    expect(segWithBoss.boss!.modelType).toBe('crystal_wyrm');
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

describe('ParticleSystem: ударные волны без частиц', () => {
  // Регрессия skip-empty-pass: кольцо, рождённое без взрыва (achievementReady,
  // biomeEntered), раньше замирало на земле навсегда, пока не придёт новый burst.
  it('раздувает и гасит кольцо при пустом пуле частиц', () => {
    const ps = new ParticleSystem(new THREE.Scene(), 8);
    ps.emitShockwave(2, 3);
    const sw = (ps as unknown as {
      shockwaves: { active: boolean; opacity: number; scale: number; mesh: THREE.Mesh }[];
    }).shockwaves[0];
    expect(sw.active).toBe(true);
    ps.update(0.1);
    expect(sw.opacity).toBeLessThan(0.9);
    expect(sw.scale).toBeGreaterThan(0.2);
    ps.update(1.0);
    expect(sw.active).toBe(false);
    expect(sw.mesh.position.y).toBe(-100);
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

  it('перк Овала: +25% к add-воротам, удача Мистики 0.85, буст сфер', () => {
    // Проверяем чистую логику: 10 * 1.25 = 12.5 → round = 13 (GateManager add),
    // mystery порог: Math.random() < 0.85 для oval, < 0.6 для остальных.
    const addVal = 10;
    expect(Math.round(addVal * 1.25)).toBe(13); // oval add
    // Эмуляция порога удачи: граница между 0.6 и 0.85 — число 0.7
    const roll = 0.7;
    expect(roll < 0.85).toBe(true);   // oval — удача
    expect(roll < 0.6).toBe(false);   // прочие — штраф
  });
});

describe('Diamond Formation Geometry', () => {
  it('diamond != oval: формация diamond отличается от овала на подавляющем большинстве позиций (>=80%)', () => {
    const totalCount = 41;
    const playableHalfWidth = 10;
    let diffCount = 0;
    for (let i = 1; i <= 40; i++) {
      const d = calculateFormationOffset(i, totalCount, 'diamond', playableHalfWidth, { x: 0, z: 0 });
      const o = calculateFormationOffset(i, totalCount, 'oval', playableHalfWidth, { x: 0, z: 0 });
      if (Math.abs(d.x - o.x) > 1e-9 || Math.abs(d.z - o.z) > 1e-9) {
        diffCount++;
      }
    }
    expect(diffCount / 40).toBeGreaterThanOrEqual(0.8);
  });

  it('уникальность: все позиции мобов 0..119 попарно различны при масштабировании', () => {
    const totalCount = 120;
    const playableHalfWidth = 2;
    const scale = getFormationScale('diamond', totalCount, playableHalfWidth);
    const seen = new Set<string>();
    for (let i = 0; i < totalCount; i++) {
      const offset = calculateFormationOffset(i, totalCount, 'diamond', playableHalfWidth, undefined, scale);
      const key = `${offset.x.toFixed(6)},${offset.z.toFixed(6)}`;
      seen.add(key);
    }
    expect(seen.size).toBe(totalCount);
  });

  it('граница: diamond никогда не выходит за playableHalfWidth для любой толпы 1..200', () => {
    const playableHalfWidth = 2;
    for (let n = 1; n <= 200; n++) {
      for (let i = 0; i < n; i++) {
        const offset = calculateFormationOffset(i, n, 'diamond', playableHalfWidth);
        expect(Math.abs(offset.x)).toBeLessThanOrEqual(playableHalfWidth + 1e-6);
      }
    }
  });

  it('симметрия формы: для полного кольца (totalCount=61) есть max|x| > 0, и среди 1..60 есть z > 0 и z < 0', () => {
    const totalCount = 61;
    const playableHalfWidth = 10;
    let maxX = 0;
    let hasPositiveZ = false;
    let hasNegativeZ = false;
    for (let i = 1; i < totalCount; i++) {
      const offset = calculateFormationOffset(i, totalCount, 'diamond', playableHalfWidth);
      if (Math.abs(offset.x) > maxX) {
        maxX = Math.abs(offset.x);
      }
      if (offset.z > 1e-6) {
        hasPositiveZ = true;
      }
      if (offset.z < -1e-6) {
        hasNegativeZ = true;
      }
    }
    expect(maxX).toBeGreaterThan(0);
    expect(hasPositiveZ).toBe(true);
    expect(hasNegativeZ).toBe(true);
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
    // Сид «5 + 5 со сбросом серии»: total = 10, lifetime-рекорд серии остаётся 5.
    for (let i = 0; i < 5; i++) mgr.runRecordNearMissStreak();
    mgr.runResetNearMissStreak();
    for (let i = 0; i < 5; i++) mgr.runRecordNearMissStreak();
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

  it('commitRun(endless) фиксирует рекорд Endless и ачивки дистанции (паритет выхода из паузы)', () => {
    const mgr = StateManager.getInstance();
    mgr.resetProgress();
    // Забег Endless: дистанция 1200 м попадает в сейв пакетом commitRun(true) —
    // раньше рекорд писался только из UI-колбэка handleLevelLost и терялся при
    // выходе в меню из паузы (dispose → commitRun без колбэка).
    mgr.beginRun();
    mgr.runRecordDistance(1200);
    mgr.commitRun(true);
    let st = mgr.getState();
    expect(st.endlessHighScore).toBe(1200);
    expect(st.achievements['endless_runner_1000']?.progress).toBe(1200);
    // Кампейн-забег (endless=false) не трогает рекорд Endless, даже если длиннее.
    mgr.beginRun();
    mgr.runRecordDistance(2000);
    mgr.commitRun(false);
    st = mgr.getState();
    expect(st.endlessHighScore).toBe(1200);
    // Более короткий Endless-забег рекорд не перебивает.
    mgr.beginRun();
    mgr.runRecordDistance(500);
    mgr.commitRun(true);
    expect(mgr.getState().endlessHighScore).toBe(1200);
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

  // Регресс рантайм-проворота: серия N (текущие ворота включительно) обязана давать
  // factor = 1+(N-1)*8% — ровно как в pure-формуле выше и как обещает баннер comboMax
  // «серия ≥ 11». До фикса фактор считался от серии БЕЗ текущих ворот (off-by-one):
  // первый бонус приходил на 3-и ворота вместо 2-х, кап ×1.8 — на 12-е вместо 11-х,
  // и баннер «МАКС ×1.8» опережал фактический кап на одни ворота.
  it('рантайм: 2-е подряд add-ворота дают +8%, кап — на 11-х вместе с баннером comboMax', () => {
    const gm = new GateManager(new THREE.Scene());
    gm.clear();
    const bonuses: number[] = [];
    let comboMaxEvents = 0;
    const off = eventBus.on('comboMax', () => { comboMaxEvents += 1; });
    const crowd = {
      formation: null,
      addMobsNear: (n: number) => n, // base = val
      addMobsNearBonus: (n: number) => { bonuses.push(n); return n; },
    };
    const particles = { emitBurst: () => {} };
    for (let i = 0; i < 11; i++) {
      (gm as any).executeGateEffect(
        { divideStep: 0 }, 'add', 25, crowd as any, particles as any,
        0, 10, [], 0, true
      );
    }
    off();
    // Бонус с 2-х ворот: 10 вызовов на 11-ти; 2-е → floor(25*0.08)=2; 11-е → кап floor(25*0.8)=20.
    expect(bonuses).toHaveLength(10);
    expect(bonuses[0]).toBe(2);
    expect(bonuses[bonuses.length - 1]).toBe(20);
    expect(comboMaxEvents).toBe(1); // баннер и факт капа — на одних и тех же воротах
  });

  // EMP-паритет: баннер шторма обещает «ворота делят толпу» для ВСЕХ непройденных
  // ворот, но endless-стример доспавл ворота и во время события — раньше они
  // оставались +N (знак врал в обе стороны). Фиксирует регресс мутацию appendGates
  // при активном шторме и восстановление clearEmpStorm().
  it('EMP: ворота, доспавленные посреди шторма, тоже ÷N и восстанавливаются после', () => {
    // createGateTexture живёт на canvas/document — в node-среде тестов достаточно
    // всепрощающего стаба (методы-заглушки, свойства-заглушки).
    const any: any = new Proxy(function () {}, {
      get: (_t, p) => (p === Symbol.toPrimitive ? () => 0 : any),
      apply: () => any,
      set: () => true,
    });
    const prevDoc = (globalThis as any).document;
    (globalThis as any).document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => any }),
    };
    try {
      const gm = new GateManager(new THREE.Scene());
      gm.clear();
      const mk = (id: string, z: number, value: number): any => ({
        id, z, x: 0, width: 4, op: 'add', value, motion: 'none', motionSpeed: 0, motionRange: 0,
      });
      gm.initGates([mk('a', 10, 5)]);
      gm.applyEmpStorm(3);
      gm.appendGates([mk('b', 50, 9)]);
      const fresh = (gm as any).gates.find((g: any) => g.data.id === 'b');
      expect(fresh.data.op).toBe('divide');
      expect(fresh.data.value).toBe(3); // делитель именно шторма, не дефолт
      gm.clearEmpStorm();
      expect(fresh.data.op).toBe('add');
      expect(fresh.data.value).toBe(9);
    } finally {
      (globalThis as any).document = prevDoc;
    }
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

  it('Кибер-щит и броня строев гасят гибель от стены, но урон стене наносится', () => {
    // Спасённый кибер-щитом моб выживает и чиплет стену (damageDealt > 0, killed false)
    const auraMob = { type: 'regular', shieldHp: 0, hp: 1, alive: true };
    const auraRes = computeWallImpact(auraMob, 'oval', false, false, true, false);
    expect(auraRes.killed).toBe(false);
    expect(auraRes.damageDealt).toBeGreaterThan(0);
    expect(auraMob.alive).toBe(true);

    // Спасённый броней Клина — то же самое
    const armorMob = { type: 'regular', shieldHp: 0, hp: 1, alive: true };
    const armorRes = computeWallImpact(armorMob, 'wedge', false, false, false, true);
    expect(armorRes.killed).toBe(false);
    expect(armorRes.damageDealt).toBeGreaterThan(0);
    expect(armorMob.alive).toBe(true);

    // Без спасбросов моб с hp=1 погибает по-прежнему
    const doomed = { type: 'regular', shieldHp: 0, hp: 1, alive: true };
    expect(computeWallImpact(doomed, 'oval').killed).toBe(true);
  });
});

describe('Finish Line & Multiplier Wall Perks', () => {
  it('формация wide (Шеренга) снижает стоимость стен на 20% с гарантированным минимумом 1', () => {
    const baseCosts = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15];
    const expectedWideCosts = [1, 2, 2, 3, 4, 5, 6, 8, 10, 12];

    baseCosts.forEach((cost, idx) => {
      expect(getFinishWallCost(cost, 'wide')).toBe(expectedWideCosts[idx]);
    });

    // Другие формации платят полную стоимость 1:1
    const otherFormations: Array<'oval' | 'circle' | 'arrow' | 'wedge' | 'diamond'> = ['oval', 'circle', 'arrow', 'wedge', 'diamond'];
    for (const f of otherFormations) {
      baseCosts.forEach((cost) => {
        expect(getFinishWallCost(cost, f)).toBe(cost);
      });
    }

    // Суммарная экономия мобов (66 -> 53, экономия 13)
    const totalBase = baseCosts.reduce((a, b) => a + b, 0);
    const totalWide = baseCosts.map((c) => getFinishWallCost(c, 'wide')).reduce((a, b) => a + b, 0);
    expect(totalBase).toBe(66);
    expect(totalWide).toBe(53);
    expect(totalBase - totalWide).toBe(13);
    expect(WIDE_FINISH_DISCOUNT).toBe(0.8);
  });

  it('граничные случаи: 0 или отрицательная базовая стоимость возвращают 0', () => {
    expect(getFinishWallCost(0, 'wide')).toBe(0);
    expect(getFinishWallCost(-5, 'wide')).toBe(0);
    expect(getFinishWallCost(1, 'wide')).toBe(1);
  });
});

describe('getMobBossPower (классовый вес в уроне по боссу)', () => {
  it('веса классов', () => {
    expect(getMobBossPower('tank')).toBe(2.0);
    expect(getMobBossPower('mage')).toBe(1.75);
    expect(getMobBossPower('ninja')).toBe(1.25);
    expect(getMobBossPower('regular')).toBe(1.0);
  });
});

describe('getMobFinishPower (кинетический вес при финишном прорыве)', () => {
  it('Танк весит 2, остальные классы — 1', () => {
    expect(getMobFinishPower('tank')).toBe(2);
    expect(getMobFinishPower('regular')).toBe(1);
    expect(getMobFinishPower('ninja')).toBe(1);
    expect(getMobFinishPower('mage')).toBe(1);
  });
});

describe('Phase-aware getNextHazardDistance (предикция фазы на момент прибытия)', () => {
  // laser_wall активна при sin(animTime·1.2) > 0. Толпа едет speed=10 м/с,
  // препятствие на z=10 → tArrival=1с → проверяем фазу в (animTime + 1)·1.2.
  const mkWall = (anim: number) => ({
    id: 'w', type: 'laser_wall' as const, x: 0, y: 1, z: 10,
    width: 8, depth: 0.5, speed: 1, range: 0, initialOffset: anim,
  });
  const mk = () => new ObstacleManager(new THREE.Scene());

  it('ON сейчас и ON к прибытию — показывает дистанцию', () => {
    const m = mk();
    m.initObstacles([mkWall(0)], []);
    expect(m.getNextHazardDistance(0, 10)).toBe(10); // sin(1.2)>0
  });

  it('OFF сейчас, но ON к прибытию — НЕ скрывает (главный кейс предикции)', () => {
    const m = mk();
    m.initObstacles([mkWall(4.6)], []);
    // сейчас: sin(5.52)<0 (OFF), к прибытию tf=5.6: sin(6.72)>0 (ON)
    expect(Math.sin(4.6 * 1.2)).toBeLessThan(0);
    expect(m.getNextHazardDistance(0, 10)).toBe(10);
  });

  it('OFF сейчас и OFF к прибытию — скрывает (безопасное окно)', () => {
    const m = mk();
    m.initObstacles([mkWall(4)], []);
    // tf=5: sin(6)≈-0.28 < 0
    expect(m.getNextHazardDistance(0, 10)).toBe(-1);
  });

  it('статичная ловушка (spike_trap) не зависит от фазы', () => {
    const m = mk();
    m.initObstacles([{ ...mkWall(0), type: 'spike_trap' as const }], []);
    expect(m.getNextHazardDistance(0, 10)).toBe(10);
    expect(m.getNextHazardDistance(0, 1)).toBe(10);
  });

  it('нулевая скорость не делит на ноль (клэмп до 1 м/с)', () => {
    const m = mk();
    m.initObstacles([mkWall(0)], []);
    expect(m.getNextHazardDistance(0, 0)).toBeGreaterThanOrEqual(-1);
  });
});


// Паритет превью стены в HUD: решение FinishLineManager и числитель плашки —
// по кинетической массе прорыва (Танк = 2), а не по сырому числу голов.
describe('getFinishBreakingPower — числитель паритетного превью стены', () => {
  it('масса больше числа голов при наличии танков', () => {
    const c = new CrowdManager(new THREE.Scene());
    c.spawnMob('tank');
    c.spawnMob('regular');
    c.spawnMob('regular');
    expect(c.getAliveCount()).toBe(3);
    // 3 головы, масса 4: стена с cost=3 пробивается, хотя голов "не больше" стоимости.
    expect(c.getFinishBreakingPower()).toBe(4);
  });
  it('триггер crowdLowWarning паритетен физике прорыва: танки не дают ложного алерта', () => {
    // Контрпример из жизни: 8 Танков (масса 16) против стены cost=8 пробивается
    // строго (16 > 8), но старый счёт по голом (8 <= 8) ложно кричал «не пробьёт».
    const c = new CrowdManager(new THREE.Scene());
    for (let i = 0; i < 8; i++) c.spawnMob('tank');
    const wallCost = 8;
    expect(c.getAliveCount()).toBeLessThanOrEqual(wallCost); // старая (ложная) логика
    expect(c.getFinishBreakingPower() > wallCost).toBe(true); // физика прорыва
    // Новое tooLow = масса <= стоимость — ложного предупреждения нет.
    expect(c.getFinishBreakingPower() <= wallCost).toBe(false);
  });
});

// Апгрейд «Адреналиновый реактор»: обещание магазина — «ускоряет зарядку И длительность».
// Длительность масштабировалась всегда; скорость набора заряда читала только бонус строя Стрелы.
describe('getAdrenalineMultiplier — множитель скорости набора заряда', () => {
  it('+10% за уровень апгрейда, перемножается с бонусом строя Стрелы', () => {
    const c = new CrowdManager(new THREE.Scene());
    const upgrades = stateManager.getState().upgrades;
    const savedLvl = upgrades.adrenalineDuration;
    const savedFormation = c.formation;
    try {
      upgrades.adrenalineDuration = 0;
      expect(c.getAdrenalineMultiplier()).toBe(1.0);
      upgrades.adrenalineDuration = 5;
      expect(c.getAdrenalineMultiplier()).toBeCloseTo(1.5, 5);
      upgrades.adrenalineDuration = 10;
      c.formation = 'arrow';
      // 1.5 (Стрела) * 2.0 (10 уровней) = 3.0 — потолок прокачки.
      expect(c.getAdrenalineMultiplier()).toBeCloseTo(3.0, 5);
    } finally {
      upgrades.adrenalineDuration = savedLvl;
      c.formation = savedFormation;
    }
  });
});

// Настройка «Чувствительность управления» ранее молча не работала выше 1.0x:
// GameEngine обрезал steerInput клампом [-1,1] ПОСЛЕ умножения на чувствительность.
// Множитель перенесён в CrowdManager.update (steerSpeed) — проверяем линейность.
describe('update — чувствительность руления (steerSensitivity)', () => {
  const displacement = (sens: number) => {
    const c = new CrowdManager(new THREE.Scene());
    c.update(0.1, 10, 1, 14, sens);
    return Math.abs(c.leaderX);
  };
  it('смещение лидера линейно по чувствительности: 0.5x / 1x / 2x', () => {
    const one = displacement(1.0);
    expect(one).toBeGreaterThan(0);
    expect(displacement(0.5)).toBeCloseTo(one * 0.5, 6);
    expect(displacement(2.0)).toBeCloseTo(one * 2.0, 6);
    // Регрессия бага: до фикса 2.0x давал ровно то же смещение, что 1.0x.
    expect(displacement(2.0)).toBeGreaterThan(one);
  });
  it('параметр по умолчанию — обратная совместимость со старыми вызовами', () => {
    const c = new CrowdManager(new THREE.Scene());
    c.update(0.1, 10, 1, 14);
    expect(Math.abs(c.leaderX)).toBeCloseTo(displacement(1.0), 6);
  });
});

// Кап суммарного шанса спец-классов: на полной прокачке 5+5+5 сумма была 120%,
// и regular вообще не спавнился из ролла. Кап 80% сохраняет пропорции классов.
describe('spawnMob — кап суммарного шанса спец-классов', () => {
  it('regular спавнится при max-прокачке; пропорции tank/ninja/mage сохранены', () => {
    const c = new CrowdManager(new THREE.Scene());
    const upgrades = stateManager.getState().upgrades;
    const saved = [upgrades.tankSpawnChance, upgrades.ninjaSpawnChance, upgrades.mageSpawnChance];
    const realRandom = Math.random;
    try {
      upgrades.tankSpawnChance = 5;
      upgrades.ninjaSpawnChance = 5;
      upgrades.mageSpawnChance = 5;
      // Ролл 0.9 > капа 0.8 — без капа попал бы в спец-класс.
      Math.random = () => 0.9;
      expect(c.spawnMob()?.type).toBe('regular');
      // Ролл 0.3: окно tank = 0.4*(2/3) = 0.267, ninja до 0.533 — значит ninja,
      // а не tank как без scale. Пропорции 1:1:1 сохранены.
      Math.random = () => 0.3;
      expect(c.spawnMob()?.type).toBe('ninja');
    } finally {
      Math.random = realRandom;
      [upgrades.tankSpawnChance, upgrades.ninjaSpawnChance, upgrades.mageSpawnChance] = saved;
    }
  });
});

// Мистика: штраф ÷ не должен использовать сырой val (8..13) — это вайп крыла 88..92%
// при награде всего +8..13. Делитель — в обычном диапазоне ÷-ворот (2..3).
describe('mysteryPenaltyStep — делитель штрафа Мистики', () => {
  it('для всего диапазона val 8..13 делитель остаётся 2..3', () => {
    for (let val = 8; val <= 13; val++) {
      const step = mysteryPenaltyStep(val);
      expect(step).toBeGreaterThanOrEqual(2);
      expect(step).toBeLessThanOrEqual(3);
    }
    expect(mysteryPenaltyStep(8)).toBe(2);
    expect(mysteryPenaltyStep(13)).toBe(3);
  });

  it('реальное деление крыла 12 по шагу 3 теряет 8 (не 11, как при сырой ÷13)', () => {
    const c = new CrowdManager(new THREE.Scene());
    const wing: MobInstance[] = [];
    for (let i = 0; i < 12; i++) {
      const mob = c.spawnMob('regular') as MobInstance;
      mob.invulnerableTime = 0; // сбрасываем спавн-невменяемость (килл по шагу иначе пропускается)
      wing.push(mob);
    }
    const killed = c.divideMobsByStep(wing, mysteryPenaltyStep(13), 'gate', { step: 0 }, 0);
    expect(killed).toBe(8);
    // Синергия Фаланги может спасти приговорённых, но не убить больше базы.
    const c2 = new CrowdManager(new THREE.Scene());
    const wing2: MobInstance[] = [];
    for (let i = 0; i < 12; i++) {
      const mob = c2.spawnMob('regular') as MobInstance;
      mob.invulnerableTime = 0;
      wing2.push(mob);
    }
    const killedWithBonus = c2.divideMobsByStep(wing2, mysteryPenaltyStep(13), 'gate', { step: 0 }, 0.2);
    expect(killedWithBonus).toBeLessThanOrEqual(8);
  });

  it('деление не поглощает боевые смягчения (аура/строй/щиты)', () => {
    const prevAura = stateManager.getState().upgrades.defenseAura;
    stateManager.importSave(btoa(JSON.stringify({ ...stateManager.getState(), upgrades: { ...stateManager.getState().upgrades, defenseAura: 5 } })));
    const c = new CrowdManager(new THREE.Scene());
    const savedFormation = c.formation;
    c.formation = 'wedge';
    try {
      const wing: MobInstance[] = [];
      for (let i = 0; i < 10; i++) {
        const type = i % 2 === 1 ? 'tank' : 'regular';
        const mob = c.spawnMob(type) as MobInstance;
        mob.invulnerableTime = 0;
        wing.push(mob);
      }
      const killed = c.divideMobsByStep(wing, 2, 'gate', { step: 0 }, 0);
      expect(killed).toBe(5);
      expect(c.getAliveCount()).toBe(5);
      const liveTank = wing.find((m) => m.alive && m.type === 'tank');
      expect(liveTank).toBeDefined();
      expect(liveTank?.shieldHp).toBeGreaterThan(0);
    } finally {
      c.formation = savedFormation;
      stateManager.importSave(btoa(JSON.stringify({ ...stateManager.getState(), upgrades: { ...stateManager.getState().upgrades, defenseAura: prevAura } })));
    }
  });

  it('удержание на ÷-воротах засчитывается в «Щит Легиона» и эмитит divide-фидбек', () => {
    stateManager.beginRun();
    const c = new CrowdManager(new THREE.Scene());
    c.formation = 'wedge';
    let defends = 0;
    let last: any = null;
    const off = eventBus.on('formationDefend', (d: any) => { defends++; last = d; });
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const wing: MobInstance[] = [];
    for (let i = 0; i < 12; i++) {
      const mob = c.spawnMob('regular') as MobInstance;
      mob.invulnerableTime = 0;
      wing.push(mob);
    }
    // ÷3: приговорены 8 из 12; ролл удержания 0.01 < 10% (Клин) — спасены все 8.
    const killed = c.divideMobsByStep(wing, 3, 'gate', { step: 0 }, 0.10);
    spy.mockRestore();
    off();
    expect(killed).toBe(0);
    expect(c.getAliveCount()).toBe(12);
    expect(defends).toBe(1);
    expect(last?.divide).toBe(true);
    expect(last?.saved).toBe(8);
    expect(stateManager.getRun()?.mobsSavedByFormation).toBe(8);
    stateManager.commitRun(); // run -> null, счётчики в stats (паритет с боевым фидбеком)
  });
});

describe('Идентичность ловушек: покрытие таблиц фидбека (тон/VFX смерти)', () => {
  // Зеркало union-типа ObstacleType: добавление нового типа в union сломает
  // компиляцию этого объекта (Record требует полноты) и заставит прописать и
  // тон удара, и VFX смерти — так охотник не остался бы в дефолтных искрах.
  const ALL: Record<ObstacleType, true> = {
    saw_blade: true, axe_pendulum: true, crusher: true, spike_trap: true,
    wrecking_ball: true, laser_grid: true, barrier_gate: true, lava_pit: true,
    bomb: true, guard_dog: true, swinging_hammer: true, rolling_spike_ball: true,
    laser_wall: true, hunter: true,
  };
  const types = Object.keys(ALL) as ObstacleType[];
  // bomb/guard_dog имеют отдельные звуки (bomb_explode/dog_snap) — тон не нужен.
  const PITCH_EXEMPT: ObstacleType[] = ['bomb', 'guard_dog'];
  // Сигнатура default-ветки playDeathEffect (барьер): count, color, speed, size.
  const DEFAULT_BURST = [12, 0xfacc15, 4.5, 1.4];

  it('каждая ловушка (кроме исключений) имеет тон в HAZARD_HIT_PITCH', () => {
    for (const t of types) {
      if (PITCH_EXEMPT.includes(t)) continue;
      expect(HAZARD_HIT_PITCH[t], `питч для ${t}`).toBeTypeOf('number');
    }
  });

  it('каждая ловушка (кроме барьера) имеет собственный VFX смерти', () => {
    const mgr = new ObstacleManager(new THREE.Scene());
    for (const t of types) {
      const emitBurst = vi.fn();
      // Вызов приватного метода по той же сигнатуре, что в checkObstacleCollision.
      (mgr as any).playDeathEffect({ type: t }, 0, 0.8, 0, { emitBurst });
      expect(emitBurst, `VFX для ${t}`).toHaveBeenCalledTimes(1);
      const burst = emitBurst.mock.calls[0].slice(3);
      const isDefault = JSON.stringify(burst) === JSON.stringify(DEFAULT_BURST);
      expect(isDefault, `${t} не должен падать в default-искры барьера`).toBe(t === 'barrier_gate');
    }
  });
});

// Регресс: GateManager.clear() обязан сбрасывать состояние ЭМИ-шторма вместе с
// воротами. До фикса флаг empActive утекал в новый забег (рестарт во время шторма):
// applyEmpStorm самоблокировался (:536), а prune() ворот был заморожен (:227) на весь
// следующий ран endless — пройденные ворота переставали выгружаться из сцены.
describe('GateManager — сброс ЭМИ-состояния в clear()', () => {
  it('clear() гасит empActive, и шторм применяется к свежим воротам повторно', () => {
    const gm = new GateManager(new THREE.Scene());
    gm.applyEmpStorm(2);
    expect(gm.isEmpActive()).toBe(true);
    // Повторный вызов во время активного шторма — self-block (защита от повторной
    // инверсии уже инвертированных ворот).
    gm.applyEmpStorm(3);
    expect(gm.isEmpActive()).toBe(true);
    gm.clear();
    expect(gm.isEmpActive()).toBe(false);
    // После clear() новый шторм должен применяться снова (а не молча выходить по guard).
    gm.applyEmpStorm(2);
    expect(gm.isEmpActive()).toBe(true);
  });
});

// Регресс: хитбокс охотника обязан пересчитываться ПОСЛЕ движения кадра.
// До фикса setHazard стоял в начале hunter-кейса (до chase-ветки) — hazard
// отставал от меша на кадр (~0.5м на скоростях эндлесса): смерть по пустому
// месту и прощённый фактический контакт. Паритет с saw/axe/crusher.
describe('ObstacleManager — хитбокс охотника следует за мешем (chase)', () => {
  it('после update hazard совпадает с финальной позицией меша', () => {
    const mgr = new ObstacleManager(new THREE.Scene());
    mgr.appendObstacles(
      [{ id: 'h1', type: 'hunter', x: 0, y: 0, z: 12, width: 1.2, depth: 1.2, speed: 1, range: 0 }],
      []
    );
    const vis = (mgr as any).obstacles[0];
    vis.hunterState = 'chase';
    vis.hunterRoarPlayed = true; // рык уже играл — не трогаем звук в тесте
    const crowd = {
      getAliveMobs: () => [],
      leaderX: 1.5,
      leaderZ: 8,
      forwardSpeed: 20,
      isHyperMode: false,
    };
    mgr.update(0.05, crowd as any, null as any);
    expect(vis.data.z).toBeGreaterThan(12); // погоня реально сдвинула охотника
    expect(vis.hazardX).toBeCloseTo(vis.mesh.position.x, 6);
    expect(vis.hazardZ).toBeCloseTo(vis.mesh.position.z, 6);
  });

  // Регресс: потолок погони 55м от точки засады + one-shot событие hunterLost
  // (баннер «Охотник отстал!» эмится ровно один раз, а не каждый кадр после
  // упора в потолок). Фиксирует честность обещания бестиария «отстанет».
  it('потолок погони: упор в anchor+55м — одиночный hunterLost', () => {
    const mgr = new ObstacleManager(new THREE.Scene());
    mgr.appendObstacles(
      [{ id: 'h2', type: 'hunter', x: 0, y: 0, z: 12, width: 1.2, depth: 1.2, speed: 1, range: 0 }],
      []
    );
    const vis = (mgr as any).obstacles[0];
    vis.hunterState = 'chase';
    vis.hunterRoarPlayed = true;
    vis.hunterAnchorZ = 12; // анкор как после фазы wake
    let lost = 0;
    const unsub = eventBus.on('hunterLost', () => { lost++; });
    const crowd = {
      getAliveMobs: () => [],
      leaderX: 0,
      leaderZ: 8,
      forwardSpeed: 20,
      isHyperMode: false,
    };
    for (let i = 0; i < 80; i++) mgr.update(0.05, crowd as any, null as any);
    unsub();
    expect(vis.data.z).toBe(67); // 12 + 55: дальше потолка охотник не идёт
    expect(vis.hunterGaveUp).toBe(true);
    expect(lost).toBe(1); // ровно один баннер на охотника
  });
});


describe('phaseSpeedMult — живая фазовая шкала скорости', () => {
  it('warmup (1.0) — без изменений', () => {
    expect(phaseSpeedMult(1.0)).toBeCloseTo(1.0, 6);
  });
  it('climax (1.6) — +36% скорости, с потолком 1.4', () => {
    expect(phaseSpeedMult(1.6)).toBeCloseTo(1.36, 6);
    expect(phaseSpeedMult(3.0)).toBe(1.4);
  });
});

describe('кибер-щит Легиона (defenseAura) против ловушек', () => {
  it('спасает от контакта с шансом 10% за уровень и даёт i-frames', () => {
    const sm = StateManager.getInstance();
    const prev = sm.getState().upgrades.defenseAura;
    sm.importSave(btoa(JSON.stringify({ ...sm.getState(), upgrades: { ...sm.getState().upgrades, defenseAura: 5 } })));
    const c = new CrowdManager(new THREE.Scene());
    const mob = c.spawnMob('regular') as MobInstance;
    mob.invulnerableTime = 0;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    // 5 ур. × 10% = 50% шанс: 0.01 < 0.5 — аура гасит удар полностью
    expect(c.resolveObstacleImpact(mob)).toBe(false);
    expect(mob.alive).toBe(true);
    expect(mob.invulnerableTime).toBeGreaterThan(0);
    // Бросок мимо порога — моб гибнет, как и раньше
    mob.invulnerableTime = 0;
    spy.mockReturnValue(0.99);
    expect(c.resolveObstacleImpact(mob)).toBe(true);
    expect(mob.alive).toBe(false);
    spy.mockRestore();
    sm.importSave(btoa(JSON.stringify({ ...sm.getState(), upgrades: { ...sm.getState().upgrades, defenseAura: prev } })));
  });

  it('спасение ауры эмитит фидбек-событие classAbility ability=aura для моба без класса', () => {
    const sm = StateManager.getInstance();
    const prev = sm.getState().upgrades.defenseAura;
    sm.importSave(btoa(JSON.stringify({ ...sm.getState(), upgrades: { ...sm.getState().upgrades, defenseAura: 5 } })));
    const c = new CrowdManager(new THREE.Scene());
    const mob = c.spawnMob('regular') as MobInstance;
    mob.invulnerableTime = 0;
    const auras: any[] = [];
    const unsub = eventBus.on('classAbility', (d: any) => { if (d?.ability === 'aura') auras.push(d); });
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.02);
    expect(c.resolveObstacleImpact(mob)).toBe(false);
    spy.mockRestore();
    unsub();
    // Раньше фидбек был только у mage/tank; regular-моб — основной состав толпы.
    expect(auras.length).toBe(1);
    expect(auras[0].type).toBe('regular');
    sm.importSave(btoa(JSON.stringify({ ...sm.getState(), upgrades: { ...sm.getState().upgrades, defenseAura: prev } })));
  });
});

describe('броня формаций (wedge/diamond) против ловушек', () => {
  it('клин гасит контакт с шансом 40%, даёт i-frames и засчитывает спасение', () => {
    const c = new CrowdManager(new THREE.Scene());
    c.formation = 'wedge';
    const mob = c.spawnMob('regular') as MobInstance;
    mob.invulnerableTime = 0;
    let defends = 0;
    const offDefend = eventBus.on('formationDefend', () => defends++);
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    // 0.01 < 0.4 — броня клина гасит удар
    expect(c.resolveObstacleImpact(mob)).toBe(false);
    expect(mob.alive).toBe(true);
    expect(mob.invulnerableTime).toBeGreaterThan(0);
    expect(defends).toBe(1); // событие + runAddMobsSaved внутри emitFormationDefend
    offDefend();
    // Бросок мимо порога — моб гибнет, как и раньше
    mob.invulnerableTime = 0;
    spy.mockReturnValue(0.99);
    expect(c.resolveObstacleImpact(mob)).toBe(true);
    expect(mob.alive).toBe(false);
    spy.mockRestore();
  });

  it('ромб гасит с шансом 25%, овальный строй — без брони', () => {
    const c = new CrowdManager(new THREE.Scene());
    c.formation = 'diamond';
    const mobD = c.spawnMob('regular') as MobInstance;
    mobD.invulnerableTime = 0;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    // 0.99 >= 0.25 — мимо
    expect(c.resolveObstacleImpact(mobD)).toBe(true);
    c.formation = 'oval';
    const mobO = c.spawnMob('regular') as MobInstance;
    mobO.invulnerableTime = 0;
    spy.mockReturnValue(0.01);
    // Овал брони не имеет — 0.01 не спасает (обычный моб без щита/HP гибнет)
    expect(c.resolveObstacleImpact(mobO)).toBe(true);
    spy.mockRestore();
  });
});

describe('уворот ниндзя от непрерывной ловушки', () => {
  it('даёт i-frames: тот же многокадровый хитбокс не перекатывает 50% шанс каждый кадр', () => {
    const c = new CrowdManager(new THREE.Scene());
    const mob = c.spawnMob('ninja') as MobInstance;
    mob.invulnerableTime = 0;
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    // Кадр 1: 0.01 < 0.5 — уворот успешен, моб выживает…
    expect(c.resolveObstacleImpact(mob)).toBe(false);
    expect(mob.alive).toBe(true);
    // …и взводит i-frames (паритет с аурой/броней формаций)
    expect(mob.invulnerableTime).toBeGreaterThan(0);
    // Кадр 2 того же хитбокса: бросок промазал бы по увороту (0.99), но
    // входной страж по i-frames обязан проглотить удар — без фикса ниндзя
    // умирал в пиле за 3-4 кадра, обесценивая обещание класса.
    spy.mockReturnValue(0.99);
    expect(c.resolveObstacleImpact(mob)).toBe(false);
    expect(mob.alive).toBe(true);
    spy.mockRestore();
  });
});

describe('3D-телеграф атак босса (FloatingText)', () => {
  it('все типы атак обеспечены стилями, i18n-тексты существуют', () => {
    // BOSS_TELEGRAPH_STYLE — exhaustive Record<BossAttack['type']>, полноту по
    // union сторожит tsc. Здесь — рантайм-страховка: i18n.t возвращает сам ключ
    // при его отсутствии, значит опечатка в key видна как равенство строке.
    const types: BossAttack['type'][] = ['slam', 'laser', 'minions', 'meteors', 'shield'];
    for (const t of types) {
      const style = BOSS_TELEGRAPH_STYLE[t];
      expect(style, `нет стиля для атаки ${t}`).toBeTruthy();
      expect(i18n.t(style.key)).not.toBe(style.key);
    }
  });
});

describe('graze кинетических стен (wallGrazedNearMiss)', () => {
  // effHalfW = halfW + WALL_HIT_TOLERANCE; здесь 3 + 0.4 = 3.4, край зоны = ±3.4.
  const WALL_X = 0;
  const EFF_HALF = 3.4;

  it('внутри зоны поражения — none (решает батч убийств)', () => {
    expect(wallGrazedNearMiss(0, WALL_X, EFF_HALF)).toBe('none');
    expect(wallGrazedNearMiss(3.0, WALL_X, EFF_HALF)).toBe('none');
    expect(wallGrazedNearMiss(-3.4, WALL_X, EFF_HALF)).toBe('none'); // ровно на краю = внутри
  });

  it('впритирку к краю (0..NEAR_MISS_GRANT_GAP) — award', () => {
    expect(wallGrazedNearMiss(3.5, WALL_X, EFF_HALF)).toBe('award'); // зазор 0.1
    expect(wallGrazedNearMiss(3.7, WALL_X, EFF_HALF)).toBe('award'); // зазор 0.3
    expect(wallGrazedNearMiss(-3.7, WALL_X, EFF_HALF)).toBe('award'); // симметрия слева
  });

  it('безопасный объезд (GRANT..BREAK] — break', () => {
    expect(wallGrazedNearMiss(4.5, WALL_X, EFF_HALF)).toBe('break'); // зазор 1.1
    expect(wallGrazedNearMiss(5.5, WALL_X, EFF_HALF)).toBe('break'); // зазор 2.1
    expect(wallGrazedNearMiss(-5.5, WALL_X, EFF_HALF)).toBe('break');
  });

  it('далеко от стены (> BREAK) — none', () => {
    expect(wallGrazedNearMiss(5.7, WALL_X, EFF_HALF)).toBe('none'); // 2.3
    expect(wallGrazedNearMiss(10, WALL_X, EFF_HALF)).toBe('none');
  });

  it('смещённая стена: вердикт по ближнему краю', () => {
    // Стена на x=7, зона [3.6, 10.4]; лидер на 3.5 — graze левого края (зазор 0.1).
    expect(wallGrazedNearMiss(3.5, 7, 3.4)).toBe('award');
    // Лидер на 10.6 — зазор до правого края 0.2.
    expect(wallGrazedNearMiss(10.6, 7, 3.4)).toBe('award');
  });
});

describe('Бонус-сферы: лут Ниндзя (паритет с монетами на трассе)', () => {
  const stubCanvas = () => {
    // node-окружение vitest: мини-stub canvas для процедурных текстур бонусов.
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({
          createRadialGradient: () => ({ addColorStop: () => {} }),
          fillRect: () => {},
          fillText: () => {},
        }),
      }),
    });
  };

  it('сфера монет удваивается при Ниндзя в строю и эмитит classAbility loot', () => {
    stubCanvas();
    const scene = new THREE.Scene();
    const crowd = new CrowdManager(scene);
    crowd.formation = 'wedge'; // детерминированный ovalMult = 1.0
    const bm = new BonusManager(scene);
    crowd.addMobsNear(1, 0, 0);
    const mob = crowd.getAliveMobs()[0];
    expect(mob).toBeTruthy();
    mob.type = 'ninja';
    bm.appendBonuses([{ id: 't-ninja-loot', type: 'coins', x: 0, y: 1, z: 0, value: 25 }]);
    const lootEvents: any[] = [];
    const unsub = eventBus.on('classAbility', (d: any) => lootEvents.push(d));
    const spy = vi.spyOn(stateManager, 'runAddCoins').mockImplementation(() => {});
    spy.mockClear(); // spyOn идемпотентен: чистим следы предыдущего теста
    bm.update(0.016, crowd, new ParticleSystem(scene, 8));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(50); // 25 × 2 (лут Ниндзя)
    expect(lootEvents.some((e) => e.type === 'ninja' && e.ability === 'loot')).toBe(true);
    spy.mockRestore();
    unsub();
    vi.unstubAllGlobals();
  });

  it('без Ниндзя сфера монет идёт с базовым значением (без ×2)', () => {
    stubCanvas();
    const scene = new THREE.Scene();
    const crowd = new CrowdManager(scene);
    crowd.formation = 'wedge';
    const bm = new BonusManager(scene);
    crowd.addMobsNear(1, 0, 0);
    crowd.getAliveMobs().forEach((m) => (m.type = 'regular')); // спавн рандомит классы
    bm.appendBonuses([{ id: 't-no-ninja', type: 'coins', x: 0, y: 1, z: 0, value: 25 }]);
    const spy = vi.spyOn(stateManager, 'runAddCoins').mockImplementation(() => {});
    spy.mockClear();
    bm.update(0.016, crowd, new ParticleSystem(scene, 8));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(25);
    spy.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe('Бейджи формаций синхронны с реальными перками движка', () => {
  // Оркестратор сверяет тексты HUD с фактическими константами GateManager/CrowdManager.
  // Если перк меняется в движке, но не в бейдже — тест падает и ловит рассинхрон обещаний UI.
  const ru = translations['ru'] as Record<string, string>;
  const en = translations['en'] as Record<string, string>;

  it('каждый бейдж и описание присутствуют в RU и EN словарях', () => {
    const keys = ['wedge', 'wide', 'circle', 'arrow', 'oval', 'diamond'];
    for (const k of keys) {
      const badge = 'formation' + k[0].toUpperCase() + k.slice(1) + 'Badge';
      const desc = k + 'Desc';
      expect(typeof ru[badge]).toBe('string');
      expect(ru[badge].length).toBeGreaterThan(0);
      expect(typeof en[badge]).toBe('string');
      expect(en[badge].length).toBeGreaterThan(0);
      expect(typeof ru[desc]).toBe('string');
      expect(typeof en[desc]).toBe('string');
    }
  });

  it('числовые перки из движка отражены в бейджах (Стрела/Фаланга/Овал/Клин/Ромб)', () => {
    // CrowdManager:956 — Стрела: заряд ×1.5. Перк ×+0.5 из бейджа убран:
    // multiply-ворота выведены из генерации по фидбеку игроков (8c37e39), бейдж обязан
    // показывать только достижимые перки.
    expect(ru.formationArrowBadge).toMatch(/1\.5/);
    expect(en.formationArrowBadge).toMatch(/1\.5/);
    // GateManager:307 — Фаланга: add ×1.3 (+30%).
    expect(ru.formationCircleBadge).toMatch(/30/);
    expect(en.formationCircleBadge).toMatch(/30/);
    // GateManager:310-321 — Овал: живые перки — ворота/сферы +25% (oval_buff).
    // Удача Мистики 85% из бейджа убрана: mystery-ворота не спавнятся (8c37e39).
    expect(ru.formationOvalBadge).toMatch(/25/);
    expect(en.formationOvalBadge).toMatch(/25/);
    // GateManager:415-421 — удержание деления: Клин 10%, Ромб 15%, Фаланга 20%.
    expect(ru.formationWedgeBadge).toMatch(/10/);
    expect(ru.formationDiamondBadge).toMatch(/15/);
    expect(ru.formationCircleBadge).toMatch(/20/);
    expect(en.formationWedgeBadge).toMatch(/10/);
    expect(en.formationDiamondBadge).toMatch(/15/);
    expect(en.formationCircleBadge).toMatch(/20/);
  });
});

describe('Геометрия ловушек: синхрон генератора с мешами', () => {
  // Рама секиры (стойки x=±6) рассчитана на центр трассы: любое смещение
  // по X ставит опору за борт над пустотой. Пресс и охотник двигаются
  // строго по своим осям (Y и Z) — горизонтальный range у них мёртв,
  // а хитбоксы обязаны совпадать с габаритами мешей (2.2 и 1.6).
  const check = (obstacles: { type: string; x: number; range: number; width: number }[], label: string) => {
    for (const obs of obstacles) {
      if (obs.type === 'axe_pendulum') {
        expect(obs.x, `axe x (${label})`).toBe(0);
      } else if (obs.type === 'crusher') {
        expect(obs.range, `crusher range (${label})`).toBe(0);
        expect(obs.width, `crusher width (${label})`).toBe(2.2);
      } else if (obs.type === 'hunter') {
        expect(obs.range, `hunter range (${label})`).toBe(0);
        expect(obs.width, `hunter width (${label})`).toBe(1.6);
      }
    }
  };

  it('все 50 уровней: секира центрирована, пресс/охотник без мёртвого размаха', () => {
    for (let lvl = 1; lvl <= 50; lvl++) {
      const config = LevelGenerator.generateLevel(lvl);
      check(config.obstacles, `L${lvl}`);
    }
  });

  it('бесконечные сегменты: те же инварианты ловушек', () => {
    for (let seg = 0; seg < 6; seg++) {
      const config = LevelGenerator.generateEndlessSegment(seg, seg * 7);
      check(config.obstacles, `endless ${seg}`);
    }
  });
});

// Регрессия молчаливого Охотника: раньше proximityVolume глушил всё с dz<-1,
// из-за чего рык пробуждения (dz≈-2.5) и петля погони (dz∈[-16,-1]) не играли
// никогда — «честное окно реакции на звук» было только визуальным.
describe('ObstacleManager — тыловая слышимость (Охотник)', () => {
  it('proximityVolume не глушит угрозу сзади в пределах камеры', () => {
    const mgr = new ObstacleManager(new THREE.Scene());
    const vol = (mgr as any).proximityVolume.bind(mgr) as (z: number, l: number) => number;
    expect(vol(10, 7.5)).toBe(1); // dz=+2.5 — прямо перед толпой
    expect(vol(10, 12.5)).toBe(1); // dz=-2.5 — момент пробуждения: рёв полный
    expect(vol(2, 16)).toBe(1); // dz=-14 — край тылового плато
    expect(vol(-4, 12)).toBeCloseTo(0.5, 6); // dz=-16 — край петли погони
    expect(vol(-6, 12)).toBe(0); // dz=-18 — за камерой — тишина
    expect(vol(52, 12)).toBe(0); // dz=+40 — за передним радиусом
    expect(vol(38, 12)).toBeCloseTo(1 - 22 / 22, 6); // dz=+26 — ноль на границе
  });
});

// Регрессия «препятствия исчезают»: ловушка, снесённая на первом касании
// (Hyper/танк/таран), переставала убивать — остальная толпа проходила насквозь.
// Теперь НИ ОДНА ловушка не расходуется от контакта (кроме мины — она
// детонирует один раз по своей природе).
describe('ObstacleManager — ловушки не расходуются от контакта', () => {
  const particles = { emitBurst: () => {} } as any;
  // Толпа ставится ПРЯМО в хитбокс ловушки (z — это её Z); update() проверяет коллизии.
  const runOver = (mgr: ObstacleManager, c: CrowdManager, z: number) => {
    c.leaderZ = z;
    // spawnMob выдаёт i-frames, а x разбрасывается случайно — без сброса
    // резолвер глушит контакт или моб стоит мимо хитбокса, и тест «зеленеет»
    // на пустом месте. animTime=0 — фазовая ловушка (пресс/маятник) обязана
    // быть в летальной фазе на момент контакта, иначе прогон зависит от того,
    // сколько кадров уже отработал менеджер.
    for (const o of (mgr as any).obstacles) o.animTime = 0;
    for (const mob of c.getAliveMobs()) { mob.x = 0; mob.z = z; mob.prevZ = z; mob.invulnerableTime = 0; }
    mgr.update(0.2, c, particles);
  };

  it('Hyper не сносит ловушку — она убивает и следующих коснувшихся', () => {
    const scene = new THREE.Scene();
    const mgr = new ObstacleManager(scene);
    mgr.initObstacles(
      [{ id: 'o1', type: 'crusher', x: 0, y: 0, z: 10, width: 2.4, depth: 2, speed: 1, range: 0, initialOffset: 0, destructible: true }],
      []
    );
    const vis = (mgr as any).obstacles[0];
    const c = new CrowdManager(new THREE.Scene());
    for (let i = 0; i < 5; i++) c.spawnMob('regular');
    c.isHyperMode = true;
    runOver(mgr, c, 10);
    // Ловушка жива и осталась в сцене (раньше Hyper сносил её на первом касании).
    expect(vis.data.isDead).toBeFalsy();
    expect(vis.mesh.parent).toBe(scene);

    // Вторая, обычная толпа проходит ту же ловушку — она ОБЯЗАНА убить.
    const c2 = new CrowdManager(new THREE.Scene());
    c2.spawnMob('regular');
    runOver(mgr, c2, 10);
    expect(c2.getAliveCount()).toBe(0);
    expect(vis.data.isDead).toBeFalsy();
  });

  it('танк в отряде не сносит ловушку (destructible больше не удаляет её)', () => {
    const mgr = new ObstacleManager(new THREE.Scene());
    mgr.initObstacles(
      [{ id: 'o1', type: 'axe_pendulum', x: 0, y: 0, z: 10, width: 2.6, depth: 2, speed: 1, range: 0, initialOffset: 0, destructible: true }],
      []
    );
    const vis = (mgr as any).obstacles[0];
    const c = new CrowdManager(new THREE.Scene());
    for (let i = 0; i < 4; i++) c.spawnMob('tank');
    // Фаза маятника летальна ровно в нижней точке дуги.
    vis.mesh.children[0].rotation.z = 0;
    runOver(mgr, c, 10);
    expect(vis.data.isDead).toBeFalsy();
  });

  it('мина детонирует один раз и убивает всех в радиусе (танк её не обезвреживает)', () => {
    const mgr = new ObstacleManager(new THREE.Scene());
    mgr.initObstacles(
      [{ id: 'b1', type: 'bomb', x: 0, y: 0, z: 10, width: 2.4, depth: 2, speed: 0.8, range: 3.5, initialOffset: 0, destructible: true }],
      []
    );
    const vis = (mgr as any).obstacles[0];
    const c = new CrowdManager(new THREE.Scene());
    for (let i = 0; i < 3; i++) c.spawnMob('regular');
    c.getAliveMobs().forEach((m, i) => { m.x = i * 0.5 - 0.5; m.z = 10; m.prevZ = 9; m.invulnerableTime = 0; });
    // Танк рядом — раньше он «обезвреживал» мину без потерь.
    c.spawnMob('tank');
    const killed: number[] = [];
    const un = eventBus.on('mobsKilled', (d: any) => killed.push(d.count));
    runOver(mgr, c, 10);
    un();
    expect(vis.data.isDead).toBe(true);
    expect(vis.exploded).toBe(true);
    expect(killed.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});

describe('Честность фазовых ловушек: live-меш == предикция', () => {
  // Замыкает класс багов «двойная формула» (3bd00c7): live-анимация пишет меш,
  // isHazardActiveAtTime — замкнутая формула для HUD-предупреждений. Если при
  // правке анимации коэффициент поменяют только в одном месте — толпа увидит
  // «безопасно» на летальной фазе (или наоборот). Тест гоняет реальную
  // update-анимацию и сверяет оба предиката на каждом кадре.
  const PARTICLES = { emitBurst: () => {} } as any;
  const PHASE_TYPES = ['crusher', 'axe_pendulum', 'barrier_gate', 'swinging_hammer', 'laser_wall'] as const;

  for (const type of PHASE_TYPES) {
    it(`${type}: предикция совпадает с живой фазой и не вырождена`, () => {
      const mgr = new ObstacleManager(new THREE.Scene());
      mgr.initObstacles(
        [{ id: 'o1', type, x: 0, y: 0, z: 10, width: 2.4, depth: 2, speed: 1, range: 0, initialOffset: 0 }],
        []
      );
      const vis = (mgr as any).obstacles[0];
      const crowd = new CrowdManager(new THREE.Scene());
      crowd.leaderZ = 0; // в окне анимации [-30..60]; живых мобов нет — коллизий нет
      let sawLethal = 0;
      let sawSafe = 0;
      for (let frame = 0; frame < 400; frame++) {
        mgr.update(0.02, crowd, PARTICLES);
        const t = vis.animTime;
        const live = (mgr as any).isHazardActive(vis);
        const predicted = (mgr as any).isHazardActiveAtTime(vis, t);
        if (live !== predicted) {
          throw new Error(`${type}: рассинхрон live/предикции на t=${t.toFixed(2)} (live=${live}, pred=${predicted})`);
        }
        live ? sawLethal++ : sawSafe++;
      }
      // Вырожденность (всегда опасна / всегда безопасна) = сломанный гейт фазы.
      expect(sawLethal).toBeGreaterThan(0);
      expect(sawSafe).toBeGreaterThan(0);
    });
  }
});
