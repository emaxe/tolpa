/**
 * Экономика игры: цены улучшений, бусты, награды, звёзды.
 * Все функции чистые — покрыты unit-тестами.
 */

export type UpgradeId =
  | "startCrowd"
  | "runSpeed"
  | "magnetTime"
  | "coinLuck"
  | "shieldStart"
  | "adrenalineGain"
  | "formations";

export type BoostId = "x2coins" | "x2score" | "plusCrowd";

export interface UpgradeDef {
  id: UpgradeId;
  max: number;
  baseCost: number;
  growth: number;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  startCrowd: { id: "startCrowd", max: 10, baseCost: 40, growth: 1.6 },
  runSpeed: { id: "runSpeed", max: 8, baseCost: 60, growth: 1.7 },
  magnetTime: { id: "magnetTime", max: 6, baseCost: 80, growth: 1.65 },
  coinLuck: { id: "coinLuck", max: 8, baseCost: 70, growth: 1.6 },
  shieldStart: { id: "shieldStart", max: 3, baseCost: 120, growth: 1.8 },
  adrenalineGain: { id: "adrenalineGain", max: 5, baseCost: 100, growth: 1.75 },
  formations: { id: "formations", max: 3, baseCost: 150, growth: 2.2 },
};

export const UPGRADE_ORDER: UpgradeId[] = [
  "startCrowd",
  "runSpeed",
  "magnetTime",
  "coinLuck",
  "shieldStart",
  "adrenalineGain",
  "formations",
];

export const BOOSTS: Record<BoostId, { cost: number }> = {
  x2coins: { cost: 120 },
  x2score: { cost: 180 },
  plusCrowd: { cost: 140 },
};

export const BOOST_ORDER: BoostId[] = ["x2coins", "x2score", "plusCrowd"];

/** Стоимость следующего уровня улучшения (0-based уровень). */
export function upgradeCost(id: UpgradeId, currentLevel: number): number {
  const def = UPGRADES[id];
  return Math.round(def.baseCost * Math.pow(def.growth, currentLevel));
}

/** Итоговые модификаторы забега из уровней улучшений. */
export interface RunMods {
  startCrowd: number;
  speedMult: number;
  magnetTime: number;
  coinLuck: number;
  shieldStart: number;
  adrenalineGain: number;
  formationLevel: number;
}

export function applyUpgrades(levels: Record<UpgradeId, number>): RunMods {
  const lv = (id: UpgradeId) => levels[id] ?? 0;
  return {
    startCrowd: 10 + lv("startCrowd") * 2,
    speedMult: 1 + lv("runSpeed") * 0.03,
    magnetTime: 6 + lv("magnetTime") * 2,
    coinLuck: 1 + lv("coinLuck") * 0.15,
    shieldStart: lv("shieldStart") * 4,
    adrenalineGain: 1 + lv("adrenalineGain") * 0.12,
    formationLevel: lv("formations"),
  };
}

/** Рейтинг уровня по очкам: 0–3 звезды. */
export function starRating(score: number, par: number): number {
  if (score >= par * 3.5) return 3;
  if (score >= par * 2) return 2;
  if (score >= par) return 1;
  return 0;
}

/** Монеты за прохождение уровня. */
export function levelRewardCoins(levelIndex: number, stars: number): number {
  const base = 30 + levelIndex * 3 + stars * 20;
  const world = Math.floor(levelIndex / 11);
  const isBoss = levelIndex % 11 === 10;
  return Math.round(base * (isBoss ? 2 : 1) * (1 + world * 0.1));
}

/** Очки за финальное толкание стены (босс-уровни). */
export function wallPushScore(crowdCount: number, hpDamage: number): number {
  return Math.round(hpDamage * (1 + crowdCount * 0.02));
}
