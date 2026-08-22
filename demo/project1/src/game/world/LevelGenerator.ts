/**
 * Процедурный генератор уровней (детерминированный, seed = index).
 * 55 уровней: 5 миров × (10 уровней + 1 босс).
 * Инварианты проверяются функцией validateLevel (smoke-тесты).
 */
import { Rng } from "../core/Rng";
import type { GateKind } from "./Gates";

export const TOTAL_LEVELS = 55;
export const LEVELS_PER_WORLD = 11;
export const TRACK_HALF = 7; // половина ширины трассы
export const LANES = [-3.4, 0, 3.4];

export type ThemeId = "city" | "harbor" | "desert" | "lab" | "neon";
export type ObstacleKind = "barrier" | "crate" | "cone" | "spikes" | "saw" | "mine" | "block";
export type BonusKind = "speed" | "shield" | "magnet" | "adrenaline" | "team" | "special" | "boost";
export type EventKind = "meteor" | "wind" | "coinrain" | "swarm" | "frenzy";
export type WallAttackKind = "spikes" | "wave" | "freeze" | "mines";

export interface GateDef {
  z: number;
  x: number;
  kind: GateKind;
  n?: number;
}

export interface ConditionalGateDef {
  z: number;
  x: number; // левая арка (зелёная: толпа >= threshold)
  threshold: number;
  n: number;
}

export interface ObstacleDef {
  z: number;
  x: number;
  kind: ObstacleKind;
  w: number; // полуширина
  d: number; // полуглубина
  damage: number;
  persistent: boolean;
}

export interface CoinDef {
  z: number;
  x: number;
}

export interface BonusDef {
  z: number;
  x: number;
  kind: BonusKind;
}

export interface EventDef {
  z: number;
  kind: EventKind;
}

export interface WallAttackDef {
  kind: WallAttackKind;
  first: number;
  every: number;
}

export interface LevelData {
  index: number;
  world: number;
  isBoss: boolean;
  theme: ThemeId;
  length: number;
  baseSpeed: number;
  parScore: number;
  gates: GateDef[];
  conditionals: ConditionalGateDef[];
  obstacles: ObstacleDef[];
  coins: CoinDef[];
  bonuses: BonusDef[];
  events: EventDef[];
  wall: { hp: number; width: number; attacks: WallAttackDef[] } | null;
  seed: number;
}

export function worldOf(index: number): number {
  return Math.floor(index / LEVELS_PER_WORLD);
}

export function isBossLevel(index: number): boolean {
  return index % LEVELS_PER_WORLD === LEVELS_PER_WORLD - 1;
}

export function themeOf(index: number): ThemeId {
  return (["city", "harbor", "desert", "lab", "neon"] as const)[worldOf(index)];
}

const GATE_KINDS_EASY: GateKind[] = ["double", "plus", "plus", "double"];
const GATE_KINDS_MID: GateKind[] = ["double", "plus", "triple", "minus", "half", "gamble"];
const GATE_KINDS_HARD: GateKind[] = ["double", "triple", "minus", "half", "gamble", "special"];

const OBSTACLE_SETS: Record<number, ObstacleKind[]> = {
  0: ["barrier", "crate", "cone"],
  1: ["barrier", "crate", "cone", "spikes"],
  2: ["crate", "spikes", "block", "saw"],
  3: ["spikes", "saw", "mine", "block"],
  4: ["saw", "mine", "spikes", "block", "barrier"],
};

const BOSS_WALLS: { hp: number; width: number; attacks: WallAttackDef[] }[] = [
  { hp: 100, width: 13, attacks: [{ kind: "spikes", first: 6, every: 7 }] },
  { hp: 170, width: 13.5, attacks: [{ kind: "spikes", first: 5, every: 8 }, { kind: "freeze", first: 10, every: 11 }] },
  { hp: 250, width: 14, attacks: [{ kind: "wave", first: 6, every: 8 }, { kind: "spikes", first: 3, every: 9 }] },
  { hp: 340, width: 14.5, attacks: [{ kind: "wave", first: 5, every: 7 }, { kind: "mines", first: 8, every: 9 }, { kind: "freeze", first: 13, every: 12 }] },
  { hp: 460, width: 15, attacks: [{ kind: "spikes", first: 4, every: 7 }, { kind: "wave", first: 7, every: 8 }, { kind: "mines", first: 11, every: 10 }, { kind: "freeze", first: 15, every: 13 }] },
];

export function generateLevel(index: number): LevelData {
  const world = worldOf(index);
  const lw = index % LEVELS_PER_WORLD; // 0..10 (10 = босс)
  const boss = isBossLevel(index);
  const rng = new Rng(index * 7919 + 12345);
  const theme = themeOf(index);

  const length = 150 + lw * 12 + world * 10;
  const baseSpeed = Math.min(13, 7.5 + lw * 0.3 + world * 0.6);

  const gates: GateDef[] = [];
  const conditionals: ConditionalGateDef[] = [];
  const obstacles: ObstacleDef[] = [];
  const coins: CoinDef[] = [];
  const bonuses: BonusDef[] = [];
  const events: EventDef[] = [];

  let wall: LevelData["wall"] = null;

  if (boss) {
    const bw = BOSS_WALLS[world];
    wall = {
      hp: bw.hp,
      width: bw.width,
      attacks: bw.attacks.map((a) => ({ ...a })),
    };
    // У босса короткая дорога с препятствиями и воротами
    placeSegment(8, length - 42, world, lw, gates, conditionals, obstacles, coins, bonuses, events, index);
    return {
      index,
      world,
      isBoss: true,
      theme,
      length,
      baseSpeed,
      parScore: Math.round(length * 24 + 500),
      gates,
      conditionals,
      obstacles,
      coins,
      bonuses,
      events,
      wall,
      seed: index * 7919 + 12345,
    };
  }

  // Обычный уровень: сегменты «ворота → препятствия → монеты»
  let z = 24;
  let seg = 0;
  while (z < length - 40) {
    placeSegment(z, Math.min(z + 34, length - 40), world, lw, gates, conditionals, obstacles, coins, bonuses, events, index + seg);
    z += rng.int(26, 38);
    seg++;
  }
  // Финальный рывок — монеты дугой
  for (let i = 0; i < 6; i++) {
    coins.push({ z: length - 26 + i * 1.4, x: Math.sin(i * 0.8) * 3 });
  }

  return {
    index,
    world,
    isBoss: false,
    theme,
    length,
    baseSpeed,
    parScore: Math.round(length * 22 + gates.length * 140 + coins.length * 10 + 300),
    gates,
    conditionals,
    obstacles,
    coins,
    bonuses,
    events,
    wall,
    seed: index * 7919 + 12345,
  };
}

function placeSegment(
  zStart: number,
  zEnd: number,
  world: number,
  lw: number,
  gates: GateDef[],
  conditionals: ConditionalGateDef[],
  obstacles: ObstacleDef[],
  coins: CoinDef[],
  bonuses: BonusDef[],
  events: EventDef[],
  seed: number,
): void {
  const segRng = new Rng(seed * 131 + 77);
  const zone = zEnd - zStart;
  if (zone < 8) return;

  // 1) Ворота
  const gz = zStart + segRng.int(2, 6);
  const kindPool = lw >= 6 ? GATE_KINDS_HARD : lw >= 3 ? GATE_KINDS_MID : GATE_KINDS_EASY;
  if (lw >= 2 && segRng.chance(0.22 + world * 0.05)) {
    const threshold = 15 + segRng.int(0, 5) * 5 + world * 5;
    conditionals.push({
      z: gz,
      x: segRng.chance(0.5) ? -2.6 : 0.6,
      threshold,
      n: 12 + world * 2,
    });
  } else {
    const kind = segRng.pick(kindPool);
    let n = 10;
    if (kind === "plus") n = 8 + segRng.int(0, 3) * 4 + world * 2;
    if (kind === "minus") n = 6 + world * 2 + Math.floor(lw / 3) * 2;
    gates.push({ z: gz, x: segRng.pick(LANES), kind, n });
  }

  // 2) Препятствия между воротами
  const oz = gz + 7;
  const obsCount = segRng.int(1, 3);
  const pool = OBSTACLE_SETS[Math.min(4, world)];
  const usedX: number[] = [];
  for (let i = 0; i < obsCount; i++) {
    const kind = segRng.pick(pool);
    const isPersistent = kind === "saw" || kind === "mine";
    const damage = isPersistent ? 1 : Math.min(9, 2 + Math.floor(lw / 2) + world);
    const w = kind === "block" ? 2.6 : kind === "barrier" ? segRng.range(1.4, 2.4) : 1.2;
    const maxAbsX = Math.max(0.5, (TRACK_HALF - 0.5) - w);
    let x = 0;
    for (let tries = 0; tries < 6; tries++) {
      x = segRng.range(-maxAbsX, maxAbsX);
      if (usedX.every((ux) => Math.abs(ux - x) > 2.6)) break;
    }
    usedX.push(x);
    obstacles.push({
      z: oz + segRng.int(0, 4),
      x,
      kind,
      w,
      d: 0.7,
      damage,
      persistent: isPersistent,
    });
  }

  // 3) Монеты вокруг препятствий (не внутри!)
  const coinCount = segRng.int(3, 6);
  for (let i = 0; i < coinCount; i++) {
    const cx = segRng.range(-5.5, 5.5);
    const cz = oz + segRng.range(-1, 7);
    const inside = obstacles.some((o) => Math.abs(o.z - cz) < o.d + 0.8 && Math.abs(o.x - cx) < o.w + 0.7);
    if (!inside) coins.push({ z: cz, x: cx });
  }

  // 4) Бонус (иногда)
  if (segRng.chance(0.45 + world * 0.08)) {
    const kinds: BonusKind[] = ["speed", "shield", "magnet", "team"];
    if (lw >= 4) kinds.push("adrenaline", "special");
    if (lw >= 6) kinds.push("boost");
    bonuses.push({ z: gz + 10 + segRng.int(0, 6), x: segRng.pick(LANES), kind: segRng.pick(kinds) });
  }

  // 5) Динамические события
  if (world >= 1 && segRng.chance(0.16 + world * 0.04)) {
    const kinds: EventKind[] = ["wind", "coinrain"];
    if (world >= 2) kinds.push("meteor");
    if (world >= 3) kinds.push("swarm");
    if (world >= 4) kinds.push("frenzy");
    events.push({ z: gz + 14, kind: segRng.pick(kinds) });
  }

  // Сортировка по z
  gates.sort((a, b) => a.z - b.z);
  conditionals.sort((a, b) => a.z - b.z);
  obstacles.sort((a, b) => a.z - b.z);
  coins.sort((a, b) => a.z - b.z);
  bonuses.sort((a, b) => a.z - b.z);
  events.sort((a, b) => a.z - b.z);
}

/** Проверка инвариантов уровня (smoke-тесты). */
export function validateLevel(level: LevelData): string[] {
  const errors: string[] = [];
  const check = (cond: boolean, msg: string) => {
    if (!cond) errors.push(msg);
  };

  check(level.index >= 0 && level.index < TOTAL_LEVELS, "index out of range");
  check(level.world === worldOf(level.index), "world mismatch");
  check(level.isBoss === isBossLevel(level.index), "boss flag mismatch");
  check(level.length > 60 && level.length < 600, "length out of range");
  check(level.baseSpeed > 5 && level.baseSpeed <= 14, "speed out of range");
  check(level.parScore > 0, "par score missing");

  // Боссы
  if (level.isBoss) {
    check(!!level.wall && level.wall.hp > 0, "boss without wall");
    check(level.wall!.attacks.length > 0, "boss without attacks");
  } else {
    check(level.wall === null, "non-boss with wall");
  }

  // Сортировка и границы
  const sorted = (arr: { z: number }[], name: string) => {
    for (let i = 1; i < arr.length; i++) {
      check(arr[i].z >= arr[i - 1].z, `${name} not sorted`);
    }
    for (const e of arr) check(e.z > 0 && e.z < level.length + 30, `${name} z out of bounds`);
  };
  sorted(level.gates, "gates");
  sorted(level.conditionals, "conditionals");
  sorted(level.obstacles, "obstacles");
  sorted(level.coins, "coins");
  sorted(level.bonuses, "bonuses");
  sorted(level.events, "events");

  // Ворота не пересекаются с препятствиями
  const gateZs = [...level.gates, ...level.conditionals].map((g) => g.z);
  for (const o of level.obstacles) {
    for (const gz of gateZs) {
      check(Math.abs(o.z - gz) >= 3.5, `obstacle overlaps gate at z=${o.z}`);
    }
  }

  // Препятствия не перекрывают всю трассу
  for (const o of level.obstacles) {
    check(Math.abs(o.x) + o.w <= TRACK_HALF - 0.4, `obstacle out of track: z=${o.z}`);
    check(o.damage >= 1 && o.damage <= 12, `obstacle damage out of range`);
  }

  // Монеты в пределах трассы и не внутри препятствий
  for (const c of level.coins) {
    check(Math.abs(c.x) <= TRACK_HALF - 0.5, `coin out of track`);
    const inside = level.obstacles.some(
      (o) => Math.abs(o.z - c.z) < o.d + 0.8 && Math.abs(o.x - c.x) < o.w + 0.7,
    );
    check(!inside, `coin inside obstacle at z=${c.z}`);
  }

  // Уровень проходим: минимум ворот и бонусов
  check(level.isBoss || level.gates.length + level.conditionals.length >= 2, "too few gates");

  return errors;
}

/** Тема мира: палитра для рендерера. */
export interface ThemePalette {
  skyTop: string;
  skyBottom: string;
  fog: string;
  ground: string;
  groundLine: string;
  decor: string[];
  accent: string;
}

export const THEMES: Record<ThemeId, ThemePalette> = {
  city: {
    skyTop: "#0c1220",
    skyBottom: "#2b3a55",
    fog: "#101827",
    ground: "#2a3040",
    groundLine: "#3d4a66",
    decor: ["#3b4a6b", "#2e3a55", "#45547a", "#27334d"],
    accent: "#ffd23f",
  },
  harbor: {
    skyTop: "#081a26",
    skyBottom: "#1d5a6e",
    fog: "#0e2c38",
    ground: "#27424a",
    groundLine: "#35606b",
    decor: ["#2f5561", "#24434d", "#3b6a76", "#1d3942"],
    accent: "#4fc3f7",
  },
  desert: {
    skyTop: "#1c0f08",
    skyBottom: "#8a5323",
    fog: "#2a1a0e",
    ground: "#5a4632",
    groundLine: "#75603f",
    decor: ["#6d5338", "#59422c", "#7d6040", "#4a3725"],
    accent: "#ff9800",
  },
  lab: {
    skyTop: "#050a12",
    skyBottom: "#123b4a",
    fog: "#0a141f",
    ground: "#1d2c3a",
    groundLine: "#2c4358",
    decor: ["#244052", "#1b3344", "#2f5066", "#15293a"],
    accent: "#69f0ae",
  },
  neon: {
    skyTop: "#0a0418",
    skyBottom: "#3a1068",
    fog: "#150a2b",
    ground: "#1b1030",
    groundLine: "#2e1a55",
    decor: ["#33195e", "#241246", "#402270", "#1c0e3a"],
    accent: "#ff4fd8",
  },
};
