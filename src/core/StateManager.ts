import { SaveData, GameSettings, PlayerUpgrades, GameStats, PlayerSkin, AchievementItem } from '../types/game';
import { getNearMissMultiplier } from '../utils/math';
import { eventBus } from './EventBus';
import { i18n } from './Localization';

const SAVE_KEY = 'CROWD_EVOLUTION_SAVE_V1';

export const INITIAL_SETTINGS: GameSettings = {
  language: 'ru',
  soundVolume: 0.8,
  musicVolume: 0.6,
  graphicsQuality: 'high',
  enableShadows: true,
  enablePostFX: true,
  enableScreenShake: true,
  enableHaptics: true,
  controlsSensitivity: 1.0,
  invertX: false,
  fpsLimit: 60,
  showFps: true,
};

export const INITIAL_UPGRADES: PlayerUpgrades = {
  startingMobs: 0,
  incomeMultiplier: 0,
  adrenalineDuration: 0,
  tankSpawnChance: 0,
  ninjaSpawnChance: 0,
  mageSpawnChance: 0,
  defenseAura: 0,
};

export const INITIAL_STATS: GameStats = {
  totalMobsSpawned: 0,
  totalGatesPassed: 0,
  totalObstaclesSmashed: 0,
  totalBossesDefeated: 0,
  totalCoinsEarned: 0,
  totalGemsEarned: 0,
  highestCombo: 0,
  maxCrowdReached: 0,
  totalAdrenalineActivations: 0,
  totalNearMisses: 0, // Начальное значение счётчика уворотов в упор
  maxNearMissStreak: 0, // Максимальная серия уворотов в упор (для достижений)
  gamesPlayed: 0,
  levelsCompleted: 0,
};

export const INITIAL_SKINS: PlayerSkin[] = [
  {
    id: 'cyber_cyan',
    nameKey: 'skins.cyan',
    descKey: 'skins.cyanDesc',
    colorHex: '#00f0ff',
    emissiveHex: '#0077aa',
    modelStyle: 'cyber',
    category: 'humanoid',
    trailType: 'glow',
    cost: 0,
    currency: 'coins',
    unlocked: true,
  },
  {
    id: 'plasma_pink',
    nameKey: 'skins.pink',
    descKey: 'skins.pinkDesc',
    colorHex: '#ff007f',
    emissiveHex: '#880044',
    modelStyle: 'neon',
    category: 'humanoid',
    trailType: 'lightning',
    cost: 500,
    currency: 'coins',
    unlocked: false,
  },
  {
    id: 'solar_gold',
    nameKey: 'skins.gold',
    descKey: 'skins.goldDesc',
    colorHex: '#ffd700',
    emissiveHex: '#ff8800',
    modelStyle: 'gold',
    category: 'humanoid',
    trailType: 'stars',
    cost: 1500,
    currency: 'coins',
    unlocked: false,
  },
  {
    id: 'matrix_green',
    nameKey: 'skins.matrix',
    descKey: 'skins.matrixDesc',
    colorHex: '#00ff66',
    emissiveHex: '#008822',
    modelStyle: 'ghost',
    category: 'humanoid',
    trailType: 'matrix',
    cost: 2500,
    currency: 'coins',
    unlocked: false,
  },
  {
    id: 'inferno_red',
    nameKey: 'skins.inferno',
    descKey: 'skins.infernoDesc',
    colorHex: '#ff2200',
    emissiveHex: '#aa0000',
    modelStyle: 'demon',
    category: 'creature',
    trailType: 'fire',
    cost: 50,
    currency: 'gems',
    unlocked: false,
  },
  {
    id: 'quantum_purple',
    nameKey: 'skins.void',
    descKey: 'skins.voidDesc',
    colorHex: '#9933ff',
    emissiveHex: '#5511aa',
    modelStyle: 'titan',
    category: 'mecha',
    trailType: 'rainbow',
    cost: 100,
    currency: 'gems',
    unlocked: false,
  },
  {
    id: 'clown_chaos',
    nameKey: 'skins.clown',
    descKey: 'skins.clownDesc',
    colorHex: '#ff0055',
    emissiveHex: '#ffcc00',
    modelStyle: 'clown',
    category: 'humanoid',
    trailType: 'rainbow',
    cost: 3500,
    currency: 'coins',
    unlocked: false,
    reward: 'shop',
  },
  {
    id: 'party_banana',
    nameKey: 'skins.banana',
    descKey: 'skins.bananaDesc',
    colorHex: '#ffe600',
    emissiveHex: '#a3e635',
    modelStyle: 'banana',
    category: 'food',
    trailType: 'lightning',
    cost: 75,
    currency: 'gems',
    unlocked: false,
    reward: 'shop',
  },
  {
    id: 'dino_rex',
    nameKey: 'skins.dino',
    descKey: 'skins.dinoDesc',
    colorHex: '#10b981',
    emissiveHex: '#047857',
    modelStyle: 'dino',
    category: 'creature',
    trailType: 'fire',
    cost: 0,
    currency: 'coins',
    unlocked: false,
    reward: 'level',
    rewardLevel: 30,
  },
  {
    id: 'glitch_zombie',
    nameKey: 'skins.zombie',
    descKey: 'skins.zombieDesc',
    colorHex: '#06b6d4',
    emissiveHex: '#7c3aed',
    modelStyle: 'zombie',
    category: 'creature',
    trailType: 'matrix',
    cost: 0,
    currency: 'coins',
    unlocked: false,
    reward: 'achievement',
    rewardAchievement: 'legion_150',
  },
  {
    id: 'cyber_duck',
    nameKey: 'skins.duck',
    descKey: 'skins.duckDesc',
    colorHex: '#ffd23f',
    emissiveHex: '#ff9f1c',
    modelStyle: 'duck',
    category: 'animal',
    trailType: 'glow',
    cost: 4500,
    currency: 'coins',
    unlocked: false,
    reward: 'shop',
  },
  {
    id: 'panda_bamboo',
    nameKey: 'skins.panda',
    descKey: 'skins.pandaDesc',
    colorHex: '#f5f5f5',
    emissiveHex: '#22c55e',
    modelStyle: 'panda',
    category: 'animal',
    trailType: 'stars',
    cost: 6000,
    currency: 'coins',
    unlocked: false,
    reward: 'shop',
  },
  {
    id: 'burger_boy',
    nameKey: 'skins.burger',
    descKey: 'skins.burgerDesc',
    colorHex: '#fbbf24',
    emissiveHex: '#f97316',
    modelStyle: 'burger',
    category: 'food',
    trailType: 'rainbow',
    cost: 80,
    currency: 'gems',
    unlocked: false,
    reward: 'shop',
  },
  {
    id: 'cyber_doggo',
    nameKey: 'skins.dog',
    descKey: 'skins.dogDesc',
    colorHex: '#94a3b8',
    emissiveHex: '#38bdf8',
    modelStyle: 'dog',
    category: 'animal',
    trailType: 'lightning',
    cost: 120,
    currency: 'gems',
    unlocked: false,
    reward: 'shop',
  },
  {
    id: 'samurai_shadow',
    nameKey: 'skins.samurai',
    descKey: 'skins.samuraiDesc',
    colorHex: '#a1a1aa',
    emissiveHex: '#ef4444',
    modelStyle: 'samurai',
    category: 'humanoid',
    trailType: 'fire',
    cost: 150,
    currency: 'gems',
    unlocked: false,
    reward: 'shop',
  },
];

export const INITIAL_ACHIEVEMENTS: AchievementItem[] = [
  {
    id: 'first_step',
    titleKey: 'achFirstBlood',
    descKey: 'achFirstBloodDesc',
    icon: 'Footprints',
    progress: 0,
    goal: 1,
    rewardCoins: 200,
    rewardGems: 5,
    claimed: false,
    category: 'levels',
  },
  {
    id: 'legion_50',
    titleKey: 'achLegion50',
    descKey: 'achLegion50Desc',
    icon: 'Users',
    progress: 0,
    goal: 50,
    rewardCoins: 500,
    rewardGems: 10,
    claimed: false,
    category: 'crowd',
  },
  {
    id: 'legion_150',
    titleKey: 'achLegion150',
    descKey: 'achLegion150Desc',
    icon: 'ShieldAlert',
    progress: 0,
    goal: 150,
    rewardCoins: 1500,
    rewardGems: 25,
    claimed: false,
    category: 'crowd',
    rewardSkinId: 'glitch_zombie',
  },
  {
    id: 'boss_1',
    titleKey: 'achBossSlayer1',
    descKey: 'achBossSlayer1Desc',
    icon: 'Swords',
    progress: 0,
    goal: 1,
    rewardCoins: 1000,
    rewardGems: 20,
    claimed: false,
    category: 'combat',
  },
  {
    id: 'boss_5',
    titleKey: 'achBossSlayer5',
    descKey: 'achBossSlayer5Desc',
    icon: 'Crown',
    progress: 0,
    goal: 1,
    rewardCoins: 5000,
    rewardGems: 100,
    claimed: false,
    category: 'combat',
  },
  {
    id: 'combo_10',
    titleKey: 'achCombo10',
    descKey: 'achCombo10Desc',
    icon: 'Zap',
    progress: 0,
    goal: 10,
    rewardCoins: 800,
    rewardGems: 15,
    claimed: false,
    category: 'combat',
  },
  {
    id: 'adrenaline_god',
    titleKey: 'achAdrenalineGod',
    descKey: 'achAdrenalineGodDesc',
    icon: 'Flame',
    progress: 0,
    goal: 20,
    rewardCoins: 1200,
    rewardGems: 20,
    claimed: false,
    category: 'combat',
  },
  {
    id: 'rich_boy',
    titleKey: 'achRichBoy',
    descKey: 'achRichBoyDesc',
    icon: 'Coins',
    progress: 0,
    goal: 50000,
    rewardCoins: 2500,
    rewardGems: 50,
    claimed: false,
    category: 'economy',
  },
  {
    id: 'obstacle_crusher',
    titleKey: 'achObstacleCrusher',
    descKey: 'achObstacleCrusherDesc',
    icon: 'Hammer',
    progress: 0,
    goal: 50,
    rewardCoins: 1500,
    rewardGems: 20,
    claimed: false,
    category: 'combat',
  },
  {
    id: 'gate_master',
    titleKey: 'achGateMaster',
    descKey: 'achGateMasterDesc',
    icon: 'DoorOpen',
    progress: 0,
    goal: 100,
    rewardCoins: 1000,
    rewardGems: 15,
    claimed: false,
    category: 'levels',
  },
  {
    id: 'mob_cloner',
    titleKey: 'achMobCloner',
    descKey: 'achMobClonerDesc',
    icon: 'Users',
    progress: 0,
    goal: 1000,
    rewardCoins: 2000,
    rewardGems: 25,
    claimed: false,
    category: 'crowd',
  },
  {
    id: 'gem_collector',
    titleKey: 'achGemCollector',
    descKey: 'achGemCollectorDesc',
    icon: 'Gem',
    progress: 0,
    goal: 100,
    rewardCoins: 3000,
    rewardGems: 30,
    claimed: false,
    category: 'economy',
  },
  {
    id: 'boss_hunter',
    titleKey: 'achBossHunter',
    descKey: 'achBossHunterDesc',
    icon: 'Trophy',
    progress: 0,
    goal: 5,
    rewardCoins: 2500,
    rewardGems: 40,
    claimed: false,
    category: 'combat',
  },
  {
    id: 'near_miss_50',
    titleKey: 'achNearMiss50',
    descKey: 'achNearMiss50Desc',
    icon: 'Zap',
    progress: 0,
    goal: 50,
    rewardCoins: 1200,
    rewardGems: 15,
    claimed: false,
    category: 'combat',
  },
  {
    id: 'near_miss_200',
    titleKey: 'achNearMiss200',
    descKey: 'achNearMiss200Desc',
    icon: 'Flame',
    progress: 0,
    goal: 200,
    rewardCoins: 3000,
    rewardGems: 35,
    claimed: false,
    category: 'combat',
  },
  {
    id: 'near_miss_streak_5',
    titleKey: 'achNearMissStreak5',
    descKey: 'achNearMissStreak5Desc',
    icon: 'Flame',
    progress: 0,
    goal: 5,
    rewardCoins: 1000,
    rewardGems: 12,
    claimed: false,
    category: 'combat',
  },
  {
    id: 'near_miss_streak_10',
    titleKey: 'achNearMissStreak10',
    descKey: 'achNearMissStreak10Desc',
    icon: 'Skull',
    progress: 0,
    goal: 10,
    rewardCoins: 3000,
    rewardGems: 35,
    claimed: false,
    category: 'combat',
  },
  {
    id: 'veteran_25',
    titleKey: 'achVeteran25',
    descKey: 'achVeteran25Desc',
    icon: 'Star',
    progress: 0,
    goal: 25,
    rewardCoins: 2500,
    rewardGems: 20,
    claimed: false,
    category: 'levels',
  },
  {
    id: 'campaign_50',
    titleKey: 'achCampaign50',
    descKey: 'achCampaign50Desc',
    icon: 'Trophy',
    progress: 0,
    goal: 50,
    rewardCoins: 5000,
    rewardGems: 50,
    claimed: false,
    category: 'levels',
  },
  {
    id: 'games_played',
    titleKey: 'achGamesPlayed',
    descKey: 'achGamesPlayedDesc',
    icon: 'Gamepad2',
    progress: 0,
    goal: 100,
    rewardCoins: 1500,
    rewardGems: 15,
    claimed: false,
    category: 'levels',
  },
  {
    id: 'endless_runner_1000',
    titleKey: 'achEndlessRunner1000',
    descKey: 'achEndlessRunner1000Desc',
    icon: 'Route',
    progress: 0,
    goal: 1000,
    rewardCoins: 1500,
    rewardGems: 20,
    claimed: false,
    category: 'levels',
  },
  {
    id: 'endless_runner_5000',
    titleKey: 'achEndlessRunner5000',
    descKey: 'achEndlessRunner5000Desc',
    icon: 'Trophy',
    progress: 0,
    goal: 5000,
    rewardCoins: 5000,
    rewardGems: 50,
    claimed: false,
    category: 'levels',
  },
];

export interface RunStats {
  coins: number;
  mobsSpawned: number;
  gatesPassed: number;
  obstaclesSmashed: number;
  bossesDefeated: number;
  bossCoins: number;
  bossGems: number;
  maxCombo: number;
  maxCrowd: number;
  /** Пройденная дистанция забега в метрах (актуально для Бесконечного режима). */
  distance: number;
  /** Рекорд бесконечного режима побит в этом забеге (одноразовый juice). */
  recordBeaten: boolean;
  /** Число «уворотов в упор» (Near-Miss) за текущий забег. */
  nearMisses: number;
  /** Текущая серия уворотов в упор подряд (без урона и промахов). */
  nearMissStreak: number;
  /** Максимальная серия уворотов в упор за текущий забег. */
  maxNearMissStreak: number;
}

function createEmptyRun(): RunStats {
  return {
    coins: 0,
    mobsSpawned: 0,
    gatesPassed: 0,
    obstaclesSmashed: 0,
    bossesDefeated: 0,
    bossCoins: 0,
    bossGems: 0,
    maxCombo: 0,
    maxCrowd: 0,
    distance: 0,
    recordBeaten: false,
    nearMisses: 0,
    nearMissStreak: 0,
    maxNearMissStreak: 0,
  };
}

export class StateManager {
  private static instance: StateManager;
  private state: SaveData;
  private listeners: Set<() => void> = new Set();

  // Batching: коалесируем notify() в рамках одного тика и дебаунсим запись в localStorage,
  // чтобы частые игровые события (монета, ворота, спавн моба) не дёргали React-подписчиков
  // и не писали на диск синхронно по нескольку раз в секунду.
  private notifyScheduled = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly SAVE_DEBOUNCE_MS = 500;

  // "Горячие" счётчики текущего забега уровня — не трогают SaveData/localStorage,
  // коммитятся в сейв одним пакетом через commitRun().
  private run: RunStats | null = null;

  private constructor() {
    this.state = this.loadState();
    i18n.setLanguage(this.state.settings.language);

    // Ретроактивная синхронизация lifetime-достижений по уже накопленным статам
    // (игроки со старыми сохранениями сразу видят заработанный прогресс).
    this.updateAchievementProgressSilent('obstacle_crusher', this.state.stats.totalObstaclesSmashed);
    this.updateAchievementProgressSilent('gate_master', this.state.stats.totalGatesPassed);
    this.updateAchievementProgressSilent('mob_cloner', this.state.stats.totalMobsSpawned);
    this.updateAchievementProgressSilent('gem_collector', this.state.stats.totalGemsEarned);
    this.updateAchievementProgressSilent('boss_hunter', this.state.stats.totalBossesDefeated);
    this.updateAchievementProgressSilent('near_miss_50', this.state.stats.totalNearMisses);
    this.updateAchievementProgressSilent('near_miss_200', this.state.stats.totalNearMisses);
    this.updateAchievementProgressSilent('near_miss_streak_5', this.state.stats.maxNearMissStreak);
    this.updateAchievementProgressSilent('near_miss_streak_10', this.state.stats.maxNearMissStreak);
    this.updateAchievementProgressSilent('games_played', this.state.stats.gamesPlayed);
    this.updateAchievementProgressSilent('endless_runner_1000', this.state.endlessHighScore);
    this.updateAchievementProgressSilent('endless_runner_5000', this.state.endlessHighScore);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flushSave();
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.flushSave());
    }
  }

  public static getInstance(): StateManager {
    if (!StateManager.instance) {
      StateManager.instance = new StateManager();
    }
    return StateManager.instance;
  }

  public getState(): Readonly<SaveData> {
    return this.state;
  }

  public getStats(): Readonly<GameStats> {
    return this.state.stats;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    if (!this.notifyScheduled) {
      this.notifyScheduled = true;
      Promise.resolve().then(() => {
        this.notifyScheduled = false;
        // Копия на случай, если колбэк отпишется/подпишется во время обхода
        Array.from(this.listeners).forEach((cb) => cb());
      });
    }
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveState();
    }, this.SAVE_DEBOUNCE_MS);
  }

  /** Форсирует немедленную запись в localStorage (конец уровня, потеря фокуса вкладки). */
  public flushSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveState();
  }

  // --- Забег уровня: горячие счётчики вне SaveData ---

  /** Начать новый забег — вызывается движком при загрузке уровня/эндлесса. */
  public beginRun(): void {
    this.run = createEmptyRun();
  }

  public getRun(): Readonly<RunStats> | null {
    return this.run;
  }

  /** Публичный множитель экономики (1 + уровень апгрейда * 0.15) — единый источник для commitRun/addCoins/UI. */
  public getIncomeMultiplier(): number {
    return 1 + this.state.upgrades.incomeMultiplier * 0.15;
  }

  /** Суммарное число монет, собранных в текущем активном забеге (трасса + награда за босса).
   *  Сырое значение ДО множителя экономики (incomeMultiplier применяется в commitRun). */
  public getRunCoins(): number {
    return this.run ? this.run.coins + this.run.bossCoins : 0;
  }

  public runAddCoins(amount: number): void {
    if (this.run) this.run.coins += amount;
  }

  public runRecordMobSpawn(count: number = 1): void {
    if (this.run) this.run.mobsSpawned += count;
  }

  public runRecordGatePass(): void {
    if (this.run) this.run.gatesPassed += 1;
  }

  public runRecordObstacleSmash(): void {
    if (this.run) this.run.obstaclesSmashed += 1;
  }

  public runRecordNearMiss(count: number = 1): void {
    if (this.run) this.run.nearMisses += count;
  }

  /**
   * Фиксирует успешный уворот в упор: инкрементирует общий счётчик, наращивает
   * текущую серию, обновляет рекорд maxNearMissStreak и возвращает множитель награды.
   * Без notify() — серия накапливается в RunStats и попадает в сейв только в commitRun().
   */
  public runRecordNearMissStreak(): { streak: number; multiplier: number } {
    if (!this.run) return { streak: 1, multiplier: 1 };
    this.run.nearMisses += 1;
    this.run.nearMissStreak += 1;
    if (this.run.nearMissStreak > this.run.maxNearMissStreak) {
      this.run.maxNearMissStreak = this.run.nearMissStreak;
    }
    return { streak: this.run.nearMissStreak, multiplier: getNearMissMultiplier(this.run.nearMissStreak) };
  }

  /** Сбрасывает текущую серию уворотов (при уроне толпы или безопасном объезде ловушки).
   *  Возвращает длину сброшенной серии (для фидбека о срыве). */
  public runResetNearMissStreak(): number {
    const prev = this.run?.nearMissStreak ?? 0;
    if (this.run) this.run.nearMissStreak = 0;
    return prev;
  }

  /** Возвращает текущую длину серии уворотов в активном забеге. */
  public getNearMissStreak(): number {
    return this.run?.nearMissStreak ?? 0;
  }

  public runRecordCombo(combo: number): void {
    if (this.run && combo > this.run.maxCombo) this.run.maxCombo = combo;
  }

  public runRecordMaxCrowd(count: number): void {
    if (this.run && count > this.run.maxCrowd) this.run.maxCrowd = count;
  }

  /** Обновляет пройденную дистанцию забега (метры) — для Бесконечного режима. */
  public runRecordDistance(meters: number): void {
    if (!this.run) return;
    if (meters > this.run.distance) this.run.distance = meters;
    // Одноразовый juice при побитии личного рекорда в Бесконечном режиме
    if (!this.run.recordBeaten && this.state.endlessHighScore > 0 && meters > this.state.endlessHighScore) {
      this.run.recordBeaten = true;
      eventBus.emit('endlessRecordBeaten', { distance: meters });
    }
  }

  public runRecordBossKill(coins: number, gems: number): void {
    if (!this.run) return;
    this.run.bossesDefeated += 1;
    this.run.bossCoins += coins;
    this.run.bossGems += gems;
  }

  /**
   * Коммитит накопленные за забег счётчики в сейв ОДНИМ пакетом: один notify(), одна
   * запись на диск. Безопасно вызывать без активного забега (no-op) и повторно
   * (второй вызов подряд ничего не делает — run уже обнулён).
   */
  public commitRun(): void {
    const r = this.run;
    if (!r) return;
    this.run = null;

    const incomeMultiplier = this.getIncomeMultiplier();
    const earnedCoins = Math.round((r.coins + r.bossCoins) * incomeMultiplier);

    this.state.coins += earnedCoins;
    this.state.gems += r.bossGems;
    this.state.stats.totalCoinsEarned += earnedCoins;
    this.state.stats.totalGemsEarned += r.bossGems;
    this.state.stats.totalMobsSpawned += r.mobsSpawned;
    this.state.stats.totalGatesPassed += r.gatesPassed;
    this.state.stats.totalObstaclesSmashed += r.obstaclesSmashed;
    this.state.stats.totalBossesDefeated += r.bossesDefeated;
    this.state.stats.totalNearMisses += r.nearMisses;
    if (r.maxNearMissStreak > this.state.stats.maxNearMissStreak) this.state.stats.maxNearMissStreak = r.maxNearMissStreak;
    if (r.maxCombo > this.state.stats.highestCombo) this.state.stats.highestCombo = r.maxCombo;
    if (r.maxCrowd > this.state.stats.maxCrowdReached) this.state.stats.maxCrowdReached = r.maxCrowd;

    // Счётчик сыгранных игр: раньше инкрементировался только в completeLevel() (победа
    // кампании), но поражения и забеги Endless завершаются через commitRun() без вызова
    // completeLevel() — счётчик не рос, достижение "100 игр" было невыполнимо (fix).
    this.state.stats.gamesPlayed += 1;

    this.updateAchievementProgressSilent('rich_boy', this.state.stats.totalCoinsEarned);
    this.updateAchievementProgressSilent('combo_10', this.state.stats.highestCombo);
    // Привязка lifetime-статистики к достижениям (dead-but-supported).
    this.updateAchievementProgressSilent('obstacle_crusher', this.state.stats.totalObstaclesSmashed);
    this.updateAchievementProgressSilent('gate_master', this.state.stats.totalGatesPassed);
    this.updateAchievementProgressSilent('mob_cloner', this.state.stats.totalMobsSpawned);
    this.updateAchievementProgressSilent('gem_collector', this.state.stats.totalGemsEarned);
    this.updateAchievementProgressSilent('boss_hunter', this.state.stats.totalBossesDefeated);
    this.updateAchievementProgressSilent('near_miss_50', this.state.stats.totalNearMisses);
    this.updateAchievementProgressSilent('near_miss_200', this.state.stats.totalNearMisses);
    // Достижения серии уворотов в упор — по lifetime-максимуму серии (забег завершён).
    this.updateAchievementProgressSilent('near_miss_streak_5', this.state.stats.maxNearMissStreak);
    this.updateAchievementProgressSilent('near_miss_streak_10', this.state.stats.maxNearMissStreak);
    // Достижения легиона в Бесконечном режиме: completeLevel() не вызывается в эндлессе,
    // поэтому прогресс legion_50/150 привязываем к lifetime-максимуму толпы.
    this.updateAchievementProgressSilent('legion_50', this.state.stats.maxCrowdReached);
    this.updateAchievementProgressSilent('legion_150', this.state.stats.maxCrowdReached);
    // Достижение "100 игр" привязано к gamesPlayed, который инкрементируется здесь
    // (commitRun) — охватывает все завершённые забеги: победы, поражения, Endless.
    this.updateAchievementProgressSilent('games_played', this.state.stats.gamesPlayed);

    this.notify();
    this.flushSave();
  }

  private getInitialData(): SaveData {
    return {
      version: 1,
      coins: 200,
      gems: 10,
      currentLevel: 1,
      maxUnlockedLevel: 1,
      levelStars: {},
      levelHighScores: {},
      upgrades: { ...INITIAL_UPGRADES },
      equippedSkin: 'cyber_cyan',
      equippedTrail: 'glow',
      unlockedSkins: ['cyber_cyan'],
      achievements: {},
      stats: { ...INITIAL_STATS },
      settings: { ...INITIAL_SETTINGS },
      endlessHighScore: 0,
      storyProgress: 0,
    };
  }

  private memoryStorage: Record<string, string> = {};

  private getStorageItem(key: string): string | null {
    try {
      if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(key);
      }
    } catch {
      // Fallback
    }
    return this.memoryStorage[key] || null;
  }

  private setStorageItem(key: string, value: string): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
        return;
      }
    } catch {
      // Fallback
    }
    this.memoryStorage[key] = value;
  }

  private loadState(): SaveData {
    try {
      const serialized = this.getStorageItem(SAVE_KEY);
      if (serialized) {
        const parsed = JSON.parse(serialized);
        // Schema migrations if needed
        return {
          ...this.getInitialData(),
          ...parsed,
          upgrades: { ...INITIAL_UPGRADES, ...(parsed.upgrades || {}) },
          settings: { ...INITIAL_SETTINGS, ...(parsed.settings || {}) },
          stats: { ...INITIAL_STATS, ...(parsed.stats || {}) },
        };
      }
    } catch (e) {
      console.warn('Failed to load save from storage, using fresh initial data', e);
    }
    return this.getInitialData();
  }

  public saveState(): void {
    try {
      this.setStorageItem(SAVE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error('Failed to save to storage', e);
    }
  }

  public resetProgress(): void {
    this.state = this.getInitialData();
    i18n.setLanguage(this.state.settings.language);
    this.notify();
  }

  // Currency
  public addCoins(amount: number): void {
    const incomeMultiplier = this.getIncomeMultiplier();
    const finalAmount = Math.round(amount * incomeMultiplier);
    this.state.coins += finalAmount;
    this.state.stats.totalCoinsEarned += finalAmount;
    this.updateAchievementProgress('rich_boy', this.state.stats.totalCoinsEarned);
    this.notify();
  }

  public addGems(amount: number): void {
    this.state.gems += amount;
    this.state.stats.totalGemsEarned += amount;
    this.notify();
  }

  public spendCoins(amount: number): boolean {
    if (this.state.coins >= amount) {
      this.state.coins -= amount;
      this.notify();
      return true;
    }
    return false;
  }

  public spendGems(amount: number): boolean {
    if (this.state.gems >= amount) {
      this.state.gems -= amount;
      this.notify();
      return true;
    }
    return false;
  }

  // Level Progression
  public completeLevel(levelNum: number, score: number, crowdCount: number, stars: number): void {
    this.state.stats.levelsCompleted += 1;
    // gamesPlayed инкрементируется в commitRun() (охватывает все забеги, не только победы).

    // High score
    if (!this.state.levelHighScores[levelNum] || score > this.state.levelHighScores[levelNum]) {
      this.state.levelHighScores[levelNum] = score;
    }

    // Stars
    if (!this.state.levelStars[levelNum] || stars > this.state.levelStars[levelNum]) {
      this.state.levelStars[levelNum] = stars;
    }

    // Unlock next level (up to 50)
    if (levelNum === this.state.maxUnlockedLevel && levelNum < 50) {
      this.state.maxUnlockedLevel = levelNum + 1;
    }
    this.state.currentLevel = Math.min(50, levelNum + 1);

    // Achievements check
    this.updateAchievementProgress('first_step', 1);
    if (crowdCount >= 50) this.updateAchievementProgress('legion_50', crowdCount);
    if (crowdCount >= 150) this.updateAchievementProgress('legion_150', crowdCount);
    if (levelNum >= 10) this.updateAchievementProgress('boss_1', 1);
    if (levelNum >= 50) this.updateAchievementProgress('boss_5', 1);
    // Прогресс прохождения кампании (dead-статы levelsCompleted были без достижений).
    this.updateAchievementProgress('veteran_25', this.state.stats.levelsCompleted);
    this.updateAchievementProgress('campaign_50', this.state.stats.levelsCompleted);

    // Бонусный скин за прохождение 30 уровня (Босс 3 — Кристальный Змей).
    if (levelNum >= 30 && !this.state.unlockedSkins.includes('dino_rex')) {
      this.unlockSkinFree('dino_rex');
    }

    this.notify();
    eventBus.emit('levelCompleted', { levelNum, score, crowdCount, stars });
  }

  public setEndlessHighScore(score: number): void {
    if (score > this.state.endlessHighScore) {
      this.state.endlessHighScore = score;
      this.updateAchievementProgressSilent('endless_runner_1000', score);
      this.updateAchievementProgressSilent('endless_runner_5000', score);
      this.notify();
    }
  }

  public setCurrentLevel(levelNum: number): void {
    if (levelNum >= 1 && levelNum <= this.state.maxUnlockedLevel) {
      this.state.currentLevel = levelNum;
      this.notify();
    }
  }

  /**
   * Фиксирует прогресс сюжетного диалога. Сюжет 1-го уровня не должен повторно
   * всплывать при каждом перезапуске уровня (dead-поле storyProgress).
   */
  public setStoryProgress(step: number): void {
    if (step > this.state.storyProgress) {
      this.state.storyProgress = step;
      this.notify();
    }
  }

  // Upgrades
  public getUpgradeCost(upgradeKey: keyof PlayerUpgrades): number {
    const currentLvl = this.state.upgrades[upgradeKey] || 0;
    const baseCostMap: Record<keyof PlayerUpgrades, number> = {
      startingMobs: 100,
      incomeMultiplier: 150,
      adrenalineDuration: 200,
      tankSpawnChance: 300,
      ninjaSpawnChance: 300,
      mageSpawnChance: 350,
      defenseAura: 250,
    };
    const base = baseCostMap[upgradeKey] || 100;
    return Math.round(base * Math.pow(1.5, currentLvl));
  }

  public upgradeStat(upgradeKey: keyof PlayerUpgrades): boolean {
    const cost = this.getUpgradeCost(upgradeKey);
    const maxLvl = upgradeKey === 'startingMobs' || upgradeKey === 'incomeMultiplier' || upgradeKey === 'adrenalineDuration' ? 10 : 5;
    
    if (this.state.upgrades[upgradeKey] < maxLvl && this.spendCoins(cost)) {
      this.state.upgrades[upgradeKey] += 1;
      this.notify();
      eventBus.emit('upgradePurchased', { upgradeKey, level: this.state.upgrades[upgradeKey] });
      return true;
    }
    return false;
  }

  // Skins
  public unlockSkin(skinId: string, cost: number, currency: 'coins' | 'gems'): boolean {
    if (this.state.unlockedSkins.includes(skinId)) return true;

    const paid = currency === 'coins' ? this.spendCoins(cost) : this.spendGems(cost);
    if (paid) {
      this.state.unlockedSkins.push(skinId);
      this.notify();
      // Событие skinUnlocked (покупка) — паритет с unlockSkinFree, чтобы уведомление в UI
      // срабатывало и при платной разблокировке скина, а не только при бесплатной.
      eventBus.emit('skinUnlocked', { skinId });
      return true;
    }
    return false;
  }

  /**
   * Бесплатная разблокировка скина (бонус за достижение/уровень-босса).
   * Не тратит валюту; эмитит событие skinUnlocked для уведомления в UI.
   */
  public unlockSkinFree(skinId: string): boolean {
    if (this.state.unlockedSkins.includes(skinId)) return false;
    this.state.unlockedSkins.push(skinId);
    this.notify();
    eventBus.emit('skinUnlocked', { skinId });
    return true;
  }

  public equipSkin(skinId: string): void {
    if (this.state.unlockedSkins.includes(skinId)) {
      this.state.equippedSkin = skinId;
      const skin = INITIAL_SKINS.find((s) => s.id === skinId);
      if (skin) {
        this.state.equippedTrail = skin.trailType;
      }
      this.notify();
    }
  }

  // Achievements
  private setAchievementProgress(achId: string, progressValue: number): boolean {
    const current = this.state.achievements[achId] || { progress: 0, claimed: false };
    if (progressValue > current.progress) {
      const achDef = INITIAL_ACHIEVEMENTS.find((a) => a.id === achId);
      // Детект первого пересечения порога: было ниже goal, стало >= goal и ещё не claimed
      const wasBelow = achDef ? current.progress < achDef.goal : false;
      this.state.achievements[achId] = {
        ...current,
        progress: progressValue,
      };
      // Эмит уведомления ровно один раз — при первом достижении порога
      if (achDef && wasBelow && progressValue >= achDef.goal && !current.claimed) {
        eventBus.emit('achievementReady', { achId, titleKey: achDef.titleKey });
      }
      return true;
    }
    return false;
  }

  public updateAchievementProgress(achId: string, progressValue: number): void {
    if (this.setAchievementProgress(achId, progressValue)) {
      this.notify();
    }
  }

  /** Как updateAchievementProgress, но без своего notify() — для батчинга внутри commitRun(). */
  private updateAchievementProgressSilent(achId: string, progressValue: number): void {
    this.setAchievementProgress(achId, progressValue);
  }

  public claimAchievement(achId: string): boolean {
    const achDef = INITIAL_ACHIEVEMENTS.find((a) => a.id === achId);
    if (!achDef) return false;

    const userAch = this.state.achievements[achId];
    if (userAch && userAch.progress >= achDef.goal && !userAch.claimed) {
      userAch.claimed = true;
      this.addCoins(achDef.rewardCoins);
      this.addGems(achDef.rewardGems);
      // Бонусный скин за достижение (если задан).
      if (achDef.rewardSkinId) {
        this.unlockSkinFree(achDef.rewardSkinId);
      }
      this.notify();
      return true;
    }
    return false;
  }

  // Stats Recording
  public recordMobSpawn(count: number = 1): void {
    this.state.stats.totalMobsSpawned += count;
  }

  public recordGatePass(): void {
    this.state.stats.totalGatesPassed += 1;
  }

  public recordObstacleSmash(): void {
    this.state.stats.totalObstaclesSmashed += 1;
  }

  public recordBossKill(): void {
    this.state.stats.totalBossesDefeated += 1;
  }

  public recordCombo(combo: number): void {
    if (combo > this.state.stats.highestCombo) {
      this.state.stats.highestCombo = combo;
      this.updateAchievementProgress('combo_10', combo);
    }
  }

  public recordMaxCrowd(crowd: number): void {
    if (crowd > this.state.stats.maxCrowdReached) {
      this.state.stats.maxCrowdReached = crowd;
    }
  }

  /** Считает активации Гипер-режима и продвигает достижение adrenaline_god. */
  public recordAdrenalineActivation(): void {
    this.state.stats.totalAdrenalineActivations += 1;
    this.updateAchievementProgress('adrenaline_god', this.state.stats.totalAdrenalineActivations);
  }

  // Settings
  public updateSettings(newSettings: Partial<GameSettings>): void {
    this.state.settings = { ...this.state.settings, ...newSettings };
    if (newSettings.language) {
      i18n.setLanguage(newSettings.language);
    }
    this.notify();
    eventBus.emit('settingsChanged', this.state.settings);
  }

  public exportSave(): string {
    return btoa(JSON.stringify(this.state));
  }

  public importSave(encodedStr: string): boolean {
    try {
      const decoded = atob(encodedStr);
      const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed === 'object') {
        // Глубокое слияние вложенных объектов, как в loadState(): импортированный
        // сейв со старой версии не должен затирать отсутствующие новые поля/статы.
        this.state = {
          ...this.getInitialData(),
          ...parsed,
          upgrades: { ...INITIAL_UPGRADES, ...(parsed.upgrades || {}) },
          settings: { ...INITIAL_SETTINGS, ...(parsed.settings || {}) },
          stats: { ...INITIAL_STATS, ...(parsed.stats || {}) },
        };
        i18n.setLanguage(this.state.settings.language);
        this.notify();
        return true;
      }
    } catch (e) {
      console.error('Import save failed:', e);
    }
    return false;
  }
}

export const stateManager = StateManager.getInstance();
