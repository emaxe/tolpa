/**
 * Unit-тесты логики ворот (pure functions из world/Gates.ts).
 */
import { describe, expect, it } from "vitest";
import { applyConditional, applyGate, gateSymbol, isBeneficial } from "../Gates";

describe("applyGate", () => {
  it("удваивает толпу (double)", () => {
    const r = applyGate(20, "double");
    expect(r.count).toBe(40);
    expect(r.gained).toBe(20);
    expect(r.lost).toBe(0);
  });

  it("утраивает толпу (triple)", () => {
    const r = applyGate(10, "triple");
    expect(r.count).toBe(30);
    expect(r.gained).toBe(20);
  });

  it("прибавляет N (plus)", () => {
    const r = applyGate(15, "plus", 10);
    expect(r.count).toBe(25);
    expect(r.gained).toBe(10);
  });

  it("вычитает N, но не ниже нуля (minus)", () => {
    const r = applyGate(5, "minus", 10);
    expect(r.count).toBe(0);
    expect(r.lost).toBe(5);
  });

  it("делит пополам с округлением потерь вверх (half)", () => {
    const r = applyGate(11, "half");
    expect(r.count).toBe(5);
    expect(r.lost).toBe(6);
  });

  it("не превышает лимит толпы (cap 200)", () => {
    const r = applyGate(150, "double");
    expect(r.count).toBe(200);
  });

  it("gamble: детерминирован при инжектированном rng", () => {
    const win = applyGate(20, "gamble", 10, () => 0.1);
    expect(win.count).toBe(40);
    const lose = applyGate(20, "gamble", 10, () => 0.9);
    expect(lose.count).toBe(10);
  });

  it("special даёт +5", () => {
    const r = applyGate(10, "special");
    expect(r.count).toBe(15);
  });
});

describe("applyConditional", () => {
  it("зелёная арка срабатывает, если толпа >= порога", () => {
    const r = applyConditional(30, 20, 10, true);
    expect(r.passed).toBe(true);
    expect(r.count).toBe(40);
    expect(r.gained).toBe(10);
  });

  it("зелёная арка штрафует, если толпа < порога", () => {
    const r = applyConditional(10, 20, 10, true);
    expect(r.passed).toBe(false);
    expect(r.count).toBe(0);
    expect(r.lost).toBe(10);
  });

  it("красная арка срабатывает, если толпа < порога", () => {
    const r = applyConditional(10, 20, 10, false);
    expect(r.passed).toBe(true);
    expect(r.count).toBe(20);
  });

  it("красная арка штрафует при большой толпе", () => {
    const r = applyConditional(30, 20, 10, false);
    expect(r.passed).toBe(false);
    expect(r.count).toBe(20);
  });
});

describe("helpers", () => {
  it("isBeneficial классифицирует ворота", () => {
    expect(isBeneficial("double", 5)).toBe(true);
    expect(isBeneficial("minus", 50)).toBe(false);
    expect(isBeneficial("gamble", 10)).toBe(false);
    expect(isBeneficial("gamble", 50)).toBe(true);
  });

  it("gateSymbol возвращает читаемые символы", () => {
    expect(gateSymbol("double")).toBe("×2");
    expect(gateSymbol("plus", 15)).toBe("+15");
    expect(gateSymbol("half")).toBe("÷2");
    expect(gateSymbol("gamble")).toBe("?");
  });
});
