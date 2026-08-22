/**
 * Чистая логика ворот (pure functions) — покрыта unit-тестами.
 * Ворота изменяют размер толпы по формулам; условные ворота — ветвление
 * «зелёная арка (если толпа >= N) / красная арка (если толпа < N)».
 */

export type GateKind =
  | "double" // ×2
  | "triple" // ×3
  | "plus" // +N
  | "minus" // −N
  | "half" // ÷2
  | "gamble" // ×2 или ÷2 (50/50)
  | "special" // +5 специалистов
  | "conditional"; // ветвление по порогу

export interface GateOutcome {
  kind: GateKind;
  count: number;
  gained: number;
  lost: number;
  passed: boolean;
}

export const GATE_MAX_COUNT = 200;

function clampCount(n: number): number {
  return Math.max(0, Math.min(GATE_MAX_COUNT, Math.round(n)));
}

/**
 * Применить ворота к текущему размеру толпы.
 * @param rng инжектируемый генератор для 'gamble' (тестируемость).
 */
export function applyGate(
  count: number,
  kind: GateKind,
  n = 10,
  rng: () => number = Math.random,
): GateOutcome {
  const start = clampCount(count);
  let result = start;
  let gained = 0;
  let lost = 0;

  switch (kind) {
    case "double":
      gained = start;
      result = start * 2;
      break;
    case "triple":
      gained = start * 2;
      result = start * 3;
      break;
    case "plus":
      gained = Math.min(n, GATE_MAX_COUNT - start);
      result = start + n;
      break;
    case "minus":
      lost = Math.min(n, start);
      result = start - n;
      break;
    case "half":
      lost = Math.ceil(start / 2);
      result = start - lost;
      break;
    case "gamble": {
      if (rng() < 0.5) {
        gained = start;
        result = start * 2;
      } else {
        lost = Math.ceil(start / 2);
        result = start - lost;
      }
      break;
    }
    case "special":
      gained = 5;
      result = start + 5;
      break;
    case "conditional":
      // Разрешается только через applyConditional
      return { kind, count: start, gained: 0, lost: 0, passed: true };
  }

  result = clampCount(result);
  return { kind, count: result, gained, lost, passed: true };
}

/**
 * Условные ворота: игрок выбирает арку.
 * Зелёная: срабатывает если count >= threshold (бонус +n).
 * Красная: срабатывает если count < threshold (бонус +n).
 */
export function applyConditional(
  count: number,
  threshold: number,
  n: number,
  choseGreen: boolean,
): GateOutcome {
  const start = clampCount(count);
  const greenPassed = start >= threshold;
  const passed = choseGreen ? greenPassed : !greenPassed;
  if (passed) {
    const gained = Math.min(n, GATE_MAX_COUNT - start);
    return {
      kind: "conditional",
      count: clampCount(start + n),
      gained,
      lost: 0,
      passed: true,
    };
  }
  const lost = Math.min(n, start);
  return {
    kind: "conditional",
    count: clampCount(start - n),
    gained: 0,
    lost,
    passed: false,
  };
}

/** Благоприятны ли ворота для текущего размера толпы (для подсказок). */
export function isBeneficial(kind: GateKind, count: number): boolean {
  switch (kind) {
    case "double":
    case "triple":
    case "plus":
    case "special":
      return true;
    case "minus":
    case "half":
      return false;
    case "gamble":
      return count >= 30;
    default:
      return true;
  }
}

/** Символ для процедурной вывески над воротами. */
export function gateSymbol(kind: GateKind, n = 10): string {
  switch (kind) {
    case "double":
      return "×2";
    case "triple":
      return "×3";
    case "plus":
      return `+${n}`;
    case "minus":
      return `−${n}`;
    case "half":
      return "÷2";
    case "gamble":
      return "?";
    case "special":
      return "★";
    case "conditional":
      return "⚖";
  }
}
