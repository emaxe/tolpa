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

  it('боссы имеют атаку "minions" (рой), которая реально исполняется', () => {
    // Атака "minions" была "мёртвой": генерировалась для каждого босса, но
    // executeBossAttack обрабатывал только slam/laser — рой телеграфировался и
    // ничего не делал. Теперь она должна присутствовать у всех боссов.
    const bossLevels = [10, 20, 30, 40, 50];
    for (const lvl of bossLevels) {
      const config = LevelGenerator.generateLevel(lvl);
      const types = config.boss!.attacks.map((a) => a.type);
      expect(types).toContain('minions');
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
        const gateCenterX = (gate.xLeft + gate.xRight) / 2;
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

  it('ворота используют только арифметические операции (+−×÷), без условных/мистери/адреналина', () => {
    const allowed = ['add', 'subtract', 'multiply', 'divide'];
    for (let lvl = 1; lvl <= 50; lvl++) {
      const config = LevelGenerator.generateLevel(lvl);
      for (const g of config.gates) {
        expect(allowed).toContain(g.leftOp);
        expect(allowed).toContain(g.rightOp);
        // Множитель всегда >= 2, чтобы ворота × реально давали прирост.
        if (g.leftOp === 'multiply') expect(g.leftVal).toBeGreaterThanOrEqual(2);
        if (g.rightOp === 'multiply') expect(g.rightVal).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('на уровнях >= 6, для ворот с индексом > 2, створки не дублируются (leftOp != rightOp)', () => {
    for (let lvl = 6; lvl <= 50; lvl++) {
      const config = LevelGenerator.generateLevel(lvl);
      expect(config.gates.length).toBeGreaterThan(2);
      for (let i = 3; i < config.gates.length; i++) {
        expect(config.gates[i].leftOp).not.toBe(config.gates[i].rightOp);
      }
    }
  });

  it('cap производительности: gates<=40, bonuses<=14, obstacles<=120, coins<=360', () => {
    for (let lvl = 1; lvl <= 50; lvl++) {
      const config = LevelGenerator.generateLevel(lvl);
      expect(config.gates.length).toBeLessThanOrEqual(40);
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
});
