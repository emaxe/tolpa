/**
 * Unit-тесты экономики: цены улучшений, модификаторы, звёзды, награды.
 */
import { describe, expect, it } from "vitest";
import {
  BOOSTS,
  UPGRADES,
  applyUpgrades,
  levelRewardCoins,
  starRating,
  upgradeCost,
  wallPushScore,
} from "../Economy";

describe("upgradeCost", () => {
  it("цены растут с уровнем", () => {
    for (const id of Object.keys(UPGRADES) as (keyof typeof UPGRADES)[]) {
      const c0 = upgradeCost(id, 0);
      const c1 = upgradeCost(id, 1);
      expect(c1).toBeGreaterThan(c0);
      expect(c0).toBeGreaterThan(0);
    }
  });

  it("нельзя превысить максимум уровня", () => {
    expect(UPGRADES.startCrowd.max).toBe(10);
    expect(UPGRADES.formations.max).toBe(3);
  });
});

describe("applyUpgrades", () => {
  it("нулевые уровни дают базовые значения", () => {
    const m = applyUpgrades({
      startCrowd: 0,
      runSpeed: 0,
      magnetTime: 0,
      coinLuck: 0,
      shieldStart: 0,
      adrenalineGain: 0,
      formations: 0,
    });
    expect(m.startCrowd).toBe(10);
    expect(m.speedMult).toBe(1);
    expect(m.coinLuck).toBe(1);
    expect(m.formationLevel).toBe(0);
  });

  it("максимальные уровни дают ожидаемые модификаторы", () => {
    const m = applyUpgrades({
      startCrowd: 10,
      runSpeed: 8,
      magnetTime: 6,
      coinLuck: 8,
      shieldStart: 3,
      adrenalineGain: 5,
      formations: 3,
    });
    expect(m.startCrowd).toBe(30);
    expect(m.speedMult).toBeCloseTo(1.24);
    expect(m.magnetTime).toBe(18);
    expect(m.coinLuck).toBeCloseTo(2.2);
    expect(m.shieldStart).toBe(12);
    expect(m.formationLevel).toBe(3);
  });
});

describe("starRating", () => {
  it("границы звёзд", () => {
    expect(starRating(99, 100)).toBe(0);
    expect(starRating(100, 100)).toBe(1);
    expect(starRating(199, 100)).toBe(1);
    expect(starRating(200, 100)).toBe(2);
    expect(starRating(349, 100)).toBe(2);
    expect(starRating(350, 100)).toBe(3);
  });
});

describe("levelRewardCoins", () => {
  it("награда растёт с прогрессом и звёздами", () => {
    expect(levelRewardCoins(0, 1)).toBeGreaterThan(0);
    expect(levelRewardCoins(10, 1)).toBeGreaterThan(levelRewardCoins(0, 1));
    expect(levelRewardCoins(5, 3)).toBeGreaterThan(levelRewardCoins(5, 1));
  });

  it("босс-уровни дают двойную награду", () => {
    expect(levelRewardCoins(10, 1)).toBe(levelRewardCoins(9, 1) * 2 + 6); // 30+27+20 vs 30+30+40
  });
});

describe("wallPushScore", () => {
  it("большая толпа толкает эффективнее", () => {
    expect(wallPushScore(100, 10)).toBeGreaterThan(wallPushScore(10, 10));
    expect(wallPushScore(0, 10)).toBe(10);
  });
});

describe("BOOSTS", () => {
  it("все бусты имеют положительную цену", () => {
    for (const id of Object.keys(BOOSTS) as (keyof typeof BOOSTS)[]) {
      expect(BOOSTS[id].cost).toBeGreaterThan(0);
    }
  });
});
