/**
 * Сохранения: localStorage + версионирование + миграции + автосохранение.
 * Автосохранение вызывается после ключевых действий (прохождение уровня,
 * покупка, настройки) через дебаунс.
 */
import type { BoostId, UpgradeId } from "./Economy";

export const SAVE_VERSION = 3;
export const SAVE_KEY = "crowd-rush-save-v3";

export interface SaveSettings {
  lang: "ru" | "en";
  quality: "auto" | "low" | "med" | "high";
  sound: boolean;
  music: boolean;
  haptics: boolean;
  shake: boolean;
  showFps: boolean;
}

export interface SaveStats {
  bestScore: number;
  totalScore: number;
  totalCoinsEarned: number;
  levelsDone: number;
  gatesPassed: number;
  mobsLost: number;
  runsStarted: number;
  wallsBroken: number;
}

export interface SaveData {
  version: number;
  coins: number;
  levelsCompleted: number[];
  levelsStars: Record<string, number>;
  levelsBest: Record<string, number>;
  upgrades: Record<UpgradeId, number>;
  boostsSelected: Record<BoostId, boolean>;
  settings: SaveSettings;
  stats: SaveStats;
  storySeen: string[];
  muted: boolean;
}

export function createDefaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    coins: 0,
    levelsCompleted: [],
    levelsStars: {},
    levelsBest: {},
    upgrades: {
      startCrowd: 0,
      runSpeed: 0,
      magnetTime: 0,
      coinLuck: 0,
      shieldStart: 0,
      adrenalineGain: 0,
      formations: 0,
    },
    boostsSelected: { x2coins: false, x2score: false, plusCrowd: false },
    settings: {
      lang: "ru",
      quality: "auto",
      sound: true,
      music: true,
      haptics: true,
      shake: true,
      showFps: false,
    },
    stats: {
      bestScore: 0,
      totalScore: 0,
      totalCoinsEarned: 0,
      levelsDone: 0,
      gatesPassed: 0,
      mobsLost: 0,
      runsStarted: 0,
      wallsBroken: 0,
    },
    storySeen: [],
    muted: false,
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Миграция старых версий сохранений к актуальной структуре. */
export function migrateSave(raw: unknown): SaveData {
  const def = createDefaultSave();
  if (!raw || typeof raw !== "object") return def;
  const src = raw as Partial<SaveData>;
  const merged: SaveData = {
    ...def,
    ...src,
    settings: { ...def.settings, ...(src.settings ?? {}) },
    stats: { ...def.stats, ...(src.stats ?? {}) },
    upgrades: { ...def.upgrades, ...(src.upgrades ?? {}) },
    boostsSelected: { ...def.boostsSelected, ...(src.boostsSelected ?? {}) },
    levelsStars: { ...(src.levelsStars ?? {}) },
    levelsBest: { ...(src.levelsBest ?? {}) },
    levelsCompleted: Array.isArray(src.levelsCompleted)
      ? [...src.levelsCompleted].filter((n) => Number.isFinite(n) && n >= 0 && n < 55)
      : [],
    storySeen: Array.isArray(src.storySeen) ? [...src.storySeen] : [],
    version: SAVE_VERSION,
  };
  return merged;
}

export class SaveManager {
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private storage: StorageLike,
    private key: string = SAVE_KEY,
  ) {}

  load(): SaveData {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return createDefaultSave();
      return migrateSave(JSON.parse(raw));
    } catch (err) {
      console.warn("[SaveManager] load failed, using defaults:", err);
      return createDefaultSave();
    }
  }

  save(data: SaveData): void {
    try {
      this.storage.setItem(this.key, JSON.stringify(data));
    } catch (err) {
      console.warn("[SaveManager] save failed:", err);
    }
  }

  /** Сохранение с дебаунсом (автосохранение после ключевых действий). */
  autosave(data: SaveData): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(data), 350);
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  clear(): void {
    this.flush();
    try {
      this.storage.removeItem(this.key);
    } catch {
      /* noop */
    }
  }
}

/** In-memory хранилище (для тестов и SSR). */
export class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}
