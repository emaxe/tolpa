import { describe, expect, it } from 'vitest';
import { LevelGenerator, DEFAULT_TRACK_WIDTH } from '../../engine/LevelGenerator';
import { StateManager } from '../../core/StateManager';
import { ObjectPool, Poolable } from '../../core/ObjectPool';
import { calculateFormationOffset, clamp, lerp } from '../../utils/math';

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

  it('условные ворота: ветка PASS при mobs >= threshold', () => {
    const mobs = 25;
    const cond = { minMobs: 20, passVal: 3, failVal: 10 };
    const passed = mobs >= cond.minMobs;
    const outcome = passed ? mobs * cond.passVal : mobs - cond.failVal;
    expect(passed).toBe(true);
    expect(outcome).toBe(75);
  });

  it('условные ворота: ветка FAIL при mobs < threshold', () => {
    const mobs = 15;
    const cond = { minMobs: 20, passVal: 3, failVal: 10 };
    const passed = mobs >= cond.minMobs;
    const outcome = passed ? mobs * cond.passVal : mobs - cond.failVal;
    expect(passed).toBe(false);
    expect(outcome).toBe(5);
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
});
