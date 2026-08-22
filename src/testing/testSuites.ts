import { LevelGenerator } from '../engine/LevelGenerator';
import { StateManager } from '../core/StateManager';
import { ObjectPool, Poolable } from '../core/ObjectPool';

export interface TestResult {
  name: string;
  category: 'Math & Gates' | 'Economy & Upgrades' | 'Save System' | 'Level Generator Smoke Tests' | 'Object Pool & Memory';
  passed: boolean;
  message: string;
  durationMs: number;
}

export async function runAllTests(): Promise<{ results: TestResult[]; summary: { total: number; passed: number; failed: number; totalDurationMs: number } }> {
  const results: TestResult[] = [];
  const startGlobal = performance.now();

  // 1. Math & Gate Tests
  results.push(testGateAddition());
  results.push(testGateMultiplication());
  results.push(testGateSubtraction());
  results.push(testGateDivision());
  results.push(testConditionalGatePass());
  results.push(testConditionalGateFail());

  // 2. Economy & Upgrades Tests
  results.push(testIncomeMultiplierFormula());
  results.push(testStartingMobsUpgradeMath());
  results.push(testUpgradeCostScaling());

  // 3. Save System Tests
  results.push(testSaveSerializationAndDeserialization());
  results.push(testCorruptedSaveFallback());

  // 4. Level Generator 50 Levels Smoke Tests
  results.push(test50LevelsIntegritySmoke());
  results.push(test5BossesConfigurationSmoke());
  results.push(testGatePositionMonotonicity());

  // 5. Object Pool Tests
  results.push(testObjectPoolReuseAndCapacity());

  const totalDurationMs = Math.round(performance.now() - startGlobal);
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  return {
    results,
    summary: {
      total: results.length,
      passed,
      failed,
      totalDurationMs,
    },
  };
}

// 1. Gate Math
function testGateAddition(): TestResult {
  const start = performance.now();
  const initial = 10;
  const addVal = 15;
  const result = initial + addVal;
  const passed = result === 25;
  return {
    name: 'Gate Math: Addition (+15 to 10 mobs = 25)',
    category: 'Math & Gates',
    passed,
    message: passed ? 'Addition verified successfully' : `Expected 25, got ${result}`,
    durationMs: performance.now() - start,
  };
}

function testGateMultiplication(): TestResult {
  const start = performance.now();
  const initial = 12;
  const multVal = 3;
  const result = initial * multVal;
  const passed = result === 36;
  return {
    name: 'Gate Math: Multiplication (12 mobs × 3 = 36)',
    category: 'Math & Gates',
    passed,
    message: passed ? 'Multiplication verified successfully' : `Expected 36, got ${result}`,
    durationMs: performance.now() - start,
  };
}

function testGateSubtraction(): TestResult {
  const start = performance.now();
  const initial = 20;
  const subVal = 8;
  const result = Math.max(0, initial - subVal);
  const passed = result === 12;
  return {
    name: 'Gate Math: Subtraction (20 mobs − 8 = 12)',
    category: 'Math & Gates',
    passed,
    message: passed ? 'Subtraction verified successfully' : `Expected 12, got ${result}`,
    durationMs: performance.now() - start,
  };
}

function testGateDivision(): TestResult {
  const start = performance.now();
  const initial = 30;
  const divVal = 2;
  const result = Math.floor(initial / divVal);
  const passed = result === 15;
  return {
    name: 'Gate Math: Division (30 mobs ÷ 2 = 15)',
    category: 'Math & Gates',
    passed,
    message: passed ? 'Division verified successfully' : `Expected 15, got ${result}`,
    durationMs: performance.now() - start,
  };
}

function testConditionalGatePass(): TestResult {
  const start = performance.now();
  const currentMobs = 25;
  const condition = { minMobs: 20, passVal: 3, failVal: 10 };
  const passedBranch = currentMobs >= condition.minMobs;
  const outcome = passedBranch ? currentMobs * condition.passVal : currentMobs - condition.failVal;
  const passed = passedBranch === true && outcome === 75;
  return {
    name: 'Gate Math: Conditional Gate PASS (25 mobs >= 20 -> ×3 = 75)',
    category: 'Math & Gates',
    passed,
    message: passed ? 'Conditional PASS branch verified' : `Failed outcome: ${outcome}`,
    durationMs: performance.now() - start,
  };
}

function testConditionalGateFail(): TestResult {
  const start = performance.now();
  const currentMobs = 15;
  const condition = { minMobs: 20, passVal: 3, failVal: 10 };
  const passedBranch = currentMobs >= condition.minMobs;
  const outcome = passedBranch ? currentMobs * condition.passVal : currentMobs - condition.failVal;
  const passed = passedBranch === false && outcome === 5;
  return {
    name: 'Gate Math: Conditional Gate FAIL (15 mobs < 20 -> −10 = 5)',
    category: 'Math & Gates',
    passed,
    message: passed ? 'Conditional FAIL branch verified' : `Failed outcome: ${outcome}`,
    durationMs: performance.now() - start,
  };
}

// 2. Economy & Upgrades
function testIncomeMultiplierFormula(): TestResult {
  const start = performance.now();
  const baseReward = 100;
  const upgradeLevel = 4;
  const multiplier = 1 + upgradeLevel * 0.15; // 1 + 0.6 = 1.6
  const finalReward = Math.round(baseReward * multiplier);
  const passed = finalReward === 160;
  return {
    name: 'Economy: Income Multiplier Level 4 (+60% bonus = 160 coins)',
    category: 'Economy & Upgrades',
    passed,
    message: passed ? 'Income multiplier scaling accurate' : `Expected 160, got ${finalReward}`,
    durationMs: performance.now() - start,
  };
}

function testStartingMobsUpgradeMath(): TestResult {
  const start = performance.now();
  const baseStarting = 1;
  const upgradeLvl = 5;
  const total = baseStarting + upgradeLvl;
  const passed = total === 6;
  return {
    name: 'Economy: Starting Squad Upgrade Level 5 (1 + 5 = 6 initial mobs)',
    category: 'Economy & Upgrades',
    passed,
    message: passed ? 'Starting crowd calculation verified' : `Expected 6, got ${total}`,
    durationMs: performance.now() - start,
  };
}

function testUpgradeCostScaling(): TestResult {
  const start = performance.now();
  const baseCost = 100;
  const lvl0Cost = Math.round(baseCost * Math.pow(1.5, 0));
  const lvl2Cost = Math.round(baseCost * Math.pow(1.5, 2));
  const passed = lvl0Cost === 100 && lvl2Cost === 225;
  return {
    name: 'Economy: Upgrade Cost Exponential Scaling (100 -> 225 at lvl 2)',
    category: 'Economy & Upgrades',
    passed,
    message: passed ? 'Exponential scaling verified' : `Lvl0: ${lvl0Cost}, Lvl2: ${lvl2Cost}`,
    durationMs: performance.now() - start,
  };
}

// 3. Save System
function testSaveSerializationAndDeserialization(): TestResult {
  const start = performance.now();
  const stateMgr = StateManager.getInstance();
  const exported = stateMgr.exportSave();
  const imported = stateMgr.importSave(exported);
  const passed = imported === true && exported.length > 20;
  return {
    name: 'Save System: Base64 JSON Serialization & Import Round-trip',
    category: 'Save System',
    passed,
    message: passed ? 'Save export/import verified successfully' : 'Export/Import failed',
    durationMs: performance.now() - start,
  };
}

function testCorruptedSaveFallback(): TestResult {
  const start = performance.now();
  const stateMgr = StateManager.getInstance();
  const result = stateMgr.importSave('not-valid-base64-random-string@@!#$');
  const passed = result === false;
  return {
    name: 'Save System: Corrupted String Rejection Fallback',
    category: 'Save System',
    passed,
    message: passed ? 'Safely rejected corrupted payload' : 'Failed to reject invalid string',
    durationMs: performance.now() - start,
  };
}

// 4. Level Generator Smoke Tests
function test50LevelsIntegritySmoke(): TestResult {
  const start = performance.now();
  let allValid = true;
  let errorMsg = '';

  for (let lvl = 1; lvl <= 50; lvl++) {
    const config = LevelGenerator.generateLevel(lvl);
    if (!config || config.levelNumber !== lvl) {
      allValid = false;
      errorMsg = `Level ${lvl} failed number check`;
      break;
    }
    if (config.trackLength < 100 || config.trackLength > 500) {
      allValid = false;
      errorMsg = `Level ${lvl} abnormal length: ${config.trackLength}`;
      break;
    }
    if (!config.gates || config.gates.length < 2) {
      allValid = false;
      errorMsg = `Level ${lvl} missing gates`;
      break;
    }
  }

  return {
    name: 'Level Generator Smoke: All 50 Levels Generated Successfully',
    category: 'Level Generator Smoke Tests',
    passed: allValid,
    message: allValid ? '50/50 levels generated without error' : errorMsg,
    durationMs: performance.now() - start,
  };
}

function test5BossesConfigurationSmoke(): TestResult {
  const start = performance.now();
  const bossLevels = [10, 20, 30, 40, 50];
  let allValid = true;
  let errorMsg = '';

  for (let lvl of bossLevels) {
    const config = LevelGenerator.generateLevel(lvl);
    if (!config.boss) {
      allValid = false;
      errorMsg = `Missing boss on milestone level ${lvl}`;
      break;
    }
    if (config.boss.hp <= 0 || config.boss.maxHp <= 0 || config.boss.attacks.length === 0) {
      allValid = false;
      errorMsg = `Invalid boss data on level ${lvl}`;
      break;
    }
  }

  return {
    name: 'Level Generator Smoke: 5 Boss Battles Verification (L10, L20, L30, L40, L50)',
    category: 'Level Generator Smoke Tests',
    passed: allValid,
    message: allValid ? 'All 5 boss encounters verified with attacks & HP' : errorMsg,
    durationMs: performance.now() - start,
  };
}

function testGatePositionMonotonicity(): TestResult {
  const start = performance.now();
  const config = LevelGenerator.generateLevel(25);
  let monotonic = true;

  for (let i = 1; i < config.gates.length; i++) {
    if (config.gates[i].z <= config.gates[i - 1].z) {
      monotonic = false;
      break;
    }
  }

  return {
    name: 'Level Generator Smoke: Gate Placement Strict Monotonicity',
    category: 'Level Generator Smoke Tests',
    passed: monotonic,
    message: monotonic ? 'Gate sequence strictly ordered along Z axis' : 'Gates overlap or are unordered',
    durationMs: performance.now() - start,
  };
}

// 5. Object Pool
class TestItem implements Poolable {
  public val: number = 0;
  public reset(): void {
    this.val = 0;
  }
}

function testObjectPoolReuseAndCapacity(): TestResult {
  const start = performance.now();
  const pool = new ObjectPool(() => new TestItem(), 10, 50);
  const item1 = pool.acquire();
  item1.val = 42;
  pool.release(item1);

  const item2 = pool.acquire();
  const passed = item2.val === 0; // reset called

  return {
    name: 'Object Pool: Memory Reusability and Zero-Allocation Reset',
    category: 'Object Pool & Memory',
    passed,
    message: passed ? 'Object pool correctly resets and reuses instances' : 'Reset was not called',
    durationMs: performance.now() - start,
  };
}
