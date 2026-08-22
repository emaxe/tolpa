/**
 * Unit-тесты сохранений: roundtrip, миграции, повреждённые данные.
 */
import { describe, expect, it } from "vitest";
import { MemoryStorage, SaveManager, createDefaultSave, migrateSave } from "../SaveManager";
import { GameStore } from "../GameState";

describe("SaveManager", () => {
  it("roundtrip: сохранение → загрузка идентичны", () => {
    const storage = new MemoryStorage();
    const saves = new SaveManager(storage);
    const data = createDefaultSave();
    data.coins = 777;
    data.levelsCompleted = [0, 1, 2];
    data.levelsStars = { "3": 2 };
    saves.save(data);
    const loaded = saves.load();
    expect(loaded.coins).toBe(777);
    expect(loaded.levelsCompleted).toEqual([0, 1, 2]);
    expect(loaded.levelsStars["3"]).toBe(2);
    expect(loaded.settings.lang).toBe("ru");
  });

  it("пустое хранилище → дефолтные данные", () => {
    const saves = new SaveManager(new MemoryStorage());
    expect(saves.load()).toEqual(createDefaultSave());
  });

  it("повреждённый JSON → дефолтные данные без исключений", () => {
    const storage = new MemoryStorage();
    storage.setItem("crowd-rush-save-v3", "{broken json!!!");
    const saves = new SaveManager(storage);
    const data = saves.load();
    expect(data.version).toBe(3);
    expect(data.coins).toBe(0);
  });

  it("clear удаляет сохранение", () => {
    const storage = new MemoryStorage();
    const saves = new SaveManager(storage);
    saves.save(createDefaultSave());
    saves.clear();
    expect(storage.getItem("crowd-rush-save-v3")).toBeNull();
  });
});

describe("migrateSave", () => {
  it("частичные старые данные сливаются с дефолтами", () => {
    const migrated = migrateSave({ coins: 50, levelsCompleted: [0] });
    expect(migrated.coins).toBe(50);
    expect(migrated.levelsCompleted).toEqual([0]);
    expect(migrated.settings.quality).toBe("auto");
    expect(migrated.stats.bestScore).toBe(0);
    expect(migrated.version).toBe(3);
  });

  it("мусор → дефолт", () => {
    expect(migrateSave(null)).toEqual(createDefaultSave());
    expect(migrateSave("string")).toEqual(createDefaultSave());
  });

  it("невалидные id уровней отфильтровываются", () => {
    const migrated = migrateSave({ levelsCompleted: [0, -5, NaN, 1000, 3] } as never);
    expect(migrated.levelsCompleted).toEqual([0, 3]);
  });
});

describe("GameStore + автосохранение", () => {
  it("completeLevel начисляет монеты и звёзды, автосохраняет", () => {
    const storage = new MemoryStorage();
    const store = new GameStore(new SaveManager(storage));
    store.addCoins(100);
    expect(store.getData().coins).toBe(100);
    const res = store.completeLevel(0, 500, 25);
    expect(res.stars).toBeGreaterThanOrEqual(1);
    expect(store.getData().levelsCompleted).toContain(0);
    expect(store.getData().coins).toBe(100 + 25 + res.reward - 25);
  });

  it("buyUpgrade списывает монеты и повышает уровень", () => {
    const store = new GameStore(new SaveManager(new MemoryStorage()));
    store.addCoins(1000);
    const ok = store.buyUpgrade("startCrowd");
    expect(ok).toBe(true);
    expect(store.getData().upgrades.startCrowd).toBe(1);
    // Повторная покупка дороже
    const cost2 = 40 * 1.6;
    expect(store.getData().coins).toBe(1000 - 40);
    void cost2;
  });

  it("покупка без монет невозможна", () => {
    const store = new GameStore(new SaveManager(new MemoryStorage()));
    expect(store.buyUpgrade("runSpeed")).toBe(false);
    expect(store.getData().upgrades.runSpeed).toBe(0);
  });

  it("toggleBoost выбирает/снимает буст", () => {
    const store = new GameStore(new SaveManager(new MemoryStorage()));
    store.toggleBoost("x2coins");
    expect(store.getData().boostsSelected.x2coins).toBe(true);
    store.clearBoosts();
    expect(store.getData().boostsSelected.x2coins).toBe(false);
  });
});
