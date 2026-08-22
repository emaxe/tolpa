/**
 * Централизованное состояние игры (GameState) с сериализацией.
 * Единственный источник правды для прогресса, экономики, настроек и статистики.
 * Все мутации проходят через commit() → автосохранение + уведомление UI.
 */
import { EventEmitter } from "./EventEmitter";
import { SaveManager, createDefaultSave } from "./SaveManager";
import type { SaveData, StorageLike } from "./SaveManager";
import { MemoryStorage } from "./SaveManager";
import {
  BOOSTS,
  UPGRADES,
  levelRewardCoins,
  starRating,
  upgradeCost,
} from "./Economy";
import type { BoostId, UpgradeId } from "./Economy";

export const TOTAL_LEVELS = 55; // 50 уровней + 5 боссов

export class GameStore {
  readonly events = new EventEmitter<{
    change: SaveData;
    toast: string;
  }>();

  private data: SaveData;
  private saves: SaveManager;

  constructor(saves: SaveManager) {
    this.saves = saves;
    this.data = saves.load();
  }

  getData(): SaveData {
    return this.data;
  }

  /** Сохранить (с дебаунсом) и оповестить UI. */
  commit(): void {
    this.saves.autosave(this.data);
    this.events.emit("change", this.data);
  }

  addCoins(n: number): void {
    this.data.coins += n;
    this.data.stats.totalCoinsEarned += n;
    this.commit();
  }

  spendCoins(n: number): boolean {
    if (this.data.coins < n) return false;
    this.data.coins -= n;
    this.commit();
    return true;
  }

  /** Завершение уровня: награды, звёзды, разблокировки, статистика. */
  completeLevel(
    index: number,
    score: number,
    coinsEarned: number,
  ): { stars: number; reward: number; newBest: boolean } {
    const prevBest = this.data.levelsBest[index] ?? 0;
    const newBest = score > prevBest;
    const stars = Math.max(1, starRating(score, this.levelPar(index)));
    const prevStars = this.data.levelsStars[index] ?? 0;
    this.data.levelsStars[index] = Math.max(prevStars, stars);
    if (!this.data.levelsCompleted.includes(index)) {
      this.data.levelsCompleted.push(index);
    }
    this.data.levelsBest[index] = Math.max(prevBest, score);
    this.data.stats.totalScore += score;
    if (score > this.data.stats.bestScore) this.data.stats.bestScore = score;
    this.data.stats.levelsDone += 1;

    const reward = levelRewardCoins(index, stars);
    this.addCoins(reward + coinsEarned);
    return { stars, reward: reward + coinsEarned, newBest };
  }

  levelPar(index: number): number {
    // Совпадает с формулой генератора (см. LevelGenerator.parScore)
    const lw = index % 11;
    const w = Math.floor(index / 11);
    const length = 150 + lw * 12 + w * 10;
    const gates = Math.max(3, Math.floor(length / 22));
    return Math.round(length * 22 + gates * 140 + 300);
  }

  isUnlocked(index: number): boolean {
    if (index === 0) return true;
    return this.data.levelsCompleted.includes(index - 1);
  }

  /** Купить уровень улучшения. */
  buyUpgrade(id: UpgradeId): boolean {
    const lvl = this.data.upgrades[id] ?? 0;
    const def = UPGRADES[id];
    if (lvl >= def.max) return false;
    const cost = upgradeCost(id, lvl);
    if (!this.spendCoins(cost)) return false;
    this.data.upgrades[id] = lvl + 1;
    this.commit();
    return true;
  }

  /** Выбрать/снять буст на следующий забег. */
  toggleBoost(id: BoostId): void {
    const selected = this.data.boostsSelected as Record<string, boolean>;
    selected[id] = !selected[id];
    this.commit();
  }

  /** Снять выбор всех бустов (после применения в забеге). */
  clearBoosts(): void {
    const boosts = this.data.boostsSelected as Record<string, boolean>;
    for (const key of Object.keys(boosts)) {
      boosts[key] = false;
    }
    this.commit();
  }

  markStorySeen(id: string): void {
    if (!this.data.storySeen.includes(id)) {
      this.data.storySeen.push(id);
      this.commit();
    }
  }

  isStorySeen(id: string): boolean {
    return this.data.storySeen.includes(id);
  }

  setSettings(patch: Partial<SaveData["settings"]>): void {
    Object.assign(this.data.settings, patch);
    this.commit();
  }

  resetAll(): void {
    this.data = createDefaultSave();
    this.saves.clear();
    this.commit();
  }

  /** Монеты, которые можно потратить на буст (проверка доступа). */
  canAffordBoost(id: BoostId): boolean {
    return this.data.coins >= BOOSTS[id].cost;
  }
}

/** Единственный экземпляр хранилища на приложение. */
const browserStorage: StorageLike =
  typeof localStorage !== "undefined" ? localStorage : new MemoryStorage();

export const store = new GameStore(new SaveManager(browserStorage));
