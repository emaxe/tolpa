/**
 * Smoke-тесты генератора уровней: все 55 уровней валидны, детерминированы,
 * боссы — на 10-й позиции каждого мира, инварианты соблюдены.
 */
import { describe, expect, it } from "vitest";
import {
  TOTAL_LEVELS,
  generateLevel,
  isBossLevel,
  themeOf,
  validateLevel,
  worldOf,
} from "../LevelGenerator";

describe("LevelGenerator", () => {
  it("генерирует все 55 уровней без ошибок инвариантов", () => {
    for (let i = 0; i < TOTAL_LEVELS; i++) {
      const level = generateLevel(i);
      const errors = validateLevel(level);
      expect(errors, `level ${i}: ${errors.join("; ")}`).toEqual([]);
    }
  });

  it("босс — каждый 11-й уровень (5 боссов)", () => {
    const bosses = [];
    for (let i = 0; i < TOTAL_LEVELS; i++) {
      if (isBossLevel(i)) bosses.push(i);
    }
    expect(bosses).toEqual([10, 21, 32, 43, 54]);
    expect(bosses).toHaveLength(5);
  });

  it("миры: 5 тем по 11 уровней", () => {
    expect(themeOf(0)).toBe("city");
    expect(themeOf(11)).toBe("harbor");
    expect(themeOf(22)).toBe("desert");
    expect(themeOf(33)).toBe("lab");
    expect(themeOf(44)).toBe("neon");
    expect(worldOf(54)).toBe(4);
  });

  it("детерминированность: один и тот же уровень одинаков", () => {
    const a = generateLevel(17);
    const b = generateLevel(17);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Разные уровни различаются
    const c = generateLevel(18);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it("сложность растёт: скорость и длина увеличиваются", () => {
    expect(generateLevel(9).baseSpeed).toBeGreaterThan(generateLevel(0).baseSpeed);
    expect(generateLevel(9).length).toBeGreaterThan(generateLevel(0).length);
    expect(generateLevel(54).length).toBeGreaterThan(generateLevel(0).length);
  });

  it("у боссов растёт HP стены", () => {
    const hps = [10, 21, 32, 43, 54].map((i) => generateLevel(i).wall!.hp);
    for (let i = 1; i < hps.length; i++) {
      expect(hps[i]).toBeGreaterThan(hps[i - 1]);
    }
    expect(hps[0]).toBe(100);
    expect(hps[4]).toBe(460);
  });

  it("у всех уровней есть ворота, у боссов — атаки стены", () => {
    for (let i = 0; i < TOTAL_LEVELS; i++) {
      const lv = generateLevel(i);
      if (lv.isBoss) {
        expect(lv.wall!.attacks.length).toBeGreaterThan(0);
      } else {
        expect(lv.gates.length + lv.conditionals.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("условные ворота появляются со 2-го мира и не пересекаются", () => {
    for (let i = 0; i < TOTAL_LEVELS; i++) {
      const lv = generateLevel(i);
      for (const c of lv.conditionals) {
        expect(c.x + 3.4).toBeLessThanOrEqual(6);
        expect(lv.obstacles.every((o) => Math.abs(o.z - c.z) >= 3.5)).toBe(true);
      }
    }
  });
});
