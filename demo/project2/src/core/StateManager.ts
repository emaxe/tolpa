import { SaveData, GameSettings, PlayerUpgrades, GameStats, PlayerSkin, AchievementItem } from '../types/game';
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
    trailType: 'rainbow',
    cost: 100,
    currency: 'gems',
    unlocked: false,
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
];

export class StateManager {
  private static instance: StateManager;
  private state: SaveData;
  private listeners: Set<() => void> = new Set();

  private constructor() {
    this.state = this.loadState();
    i18n.setLanguage(this.state.settings.language);
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

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((cb) => cb());
    this.saveState();
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

  private loadState(): SaveData {
    try {
      const serialized = localStorage.getItem(SAVE_KEY);
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
      console.warn('Failed to load save from localStorage, using fresh initial data', e);
    }
    return this.getInitialData();
  }

  public saveState(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error('Failed to save to localStorage', e);
    }
  }

  public resetProgress(): void {
    this.state = this.getInitialData();
    i18n.setLanguage(this.state.settings.language);
    this.notify();
  }

  // Currency
  public addCoins(amount: number): void {
    const incomeMultiplier = 1 + (this.state.upgrades.incomeMultiplier * 0.15);
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
    this.state.stats.gamesPlayed += 1;

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

    this.notify();
    eventBus.emit('levelCompleted', { levelNum, score, crowdCount, stars });
  }

  public setEndlessHighScore(score: number): void {
    if (score > this.state.endlessHighScore) {
      this.state.endlessHighScore = score;
      this.notify();
    }
  }

  public setCurrentLevel(levelNum: number): void {
    if (levelNum >= 1 && levelNum <= this.state.maxUnlockedLevel) {
      this.state.currentLevel = levelNum;
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
      return true;
    }
    return false;
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
  public updateAchievementProgress(achId: string, progressValue: number): void {
    const current = this.state.achievements[achId] || { progress: 0, claimed: false };
    if (progressValue > current.progress) {
      this.state.achievements[achId] = {
        ...current,
        progress: progressValue,
      };
      this.notify();
    }
  }

  public claimAchievement(achId: string): boolean {
    const achDef = INITIAL_ACHIEVEMENTS.find((a) => a.id === achId);
    if (!achDef) return false;

    const userAch = this.state.achievements[achId];
    if (userAch && userAch.progress >= achDef.goal && !userAch.claimed) {
      userAch.claimed = true;
      this.addCoins(achDef.rewardCoins);
      this.addGems(achDef.rewardGems);
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
        this.state = {
          ...this.getInitialData(),
          ...parsed,
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
