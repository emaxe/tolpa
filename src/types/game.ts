export type MobType = 'regular' | 'tank' | 'ninja' | 'mage';

export type FormationType = 'wedge' | 'wide' | 'circle' | 'arrow';

export type GateOp = 'add' | 'multiply' | 'subtract' | 'divide' | 'conditional' | 'mystery' | 'adrenaline';

export interface GateData {
  id: string;
  z: number;
  xLeft: number;
  xRight: number;
  width: number;
  leftOp: GateOp;
  leftVal: number;
  leftCondition?: { minMobs: number; passOp: GateOp; passVal: number; failOp: GateOp; failVal: number };
  rightOp: GateOp;
  rightVal: number;
  rightCondition?: { minMobs: number; passOp: GateOp; passVal: number; failOp: GateOp; failVal: number };
  isDynamic?: boolean; // Changes value or flips periodically
  flipTimer?: number;
  passed?: boolean;
}

export type ObstacleType = 
  | 'saw_blade' 
  | 'axe_pendulum' 
  | 'crusher' 
  | 'spike_trap' 
  | 'wrecking_ball' 
  | 'laser_grid' 
  | 'barrier_gate' 
  | 'lava_pit';

export interface ObstacleData {
  id: string;
  type: ObstacleType;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  speed: number;
  range: number;
  initialOffset?: number;
  damage: number; // Mob damage count or instant kill
  destructible?: boolean; // Can be smashed by Tanks / Adrenaline
  hp?: number;
  maxHp?: number;
  isDead?: boolean;
}

export interface CoinData {
  id: string;
  x: number;
  y: number;
  z: number;
  value: number;
  collected?: boolean;
}

export type BiomeType = 'cyber_city' | 'magma_citadel' | 'crystal_cavern' | 'quantum_void' | 'celestial_core';

export interface BossAttack {
  type: 'slam' | 'laser' | 'minions' | 'shield' | 'meteors';
  telegraphTime: number;
  duration: number;
  damage: number;
  areaRadius?: number;
  direction?: number;
}

export interface BossData {
  id: string;
  nameKey: string;
  titleKey: string;
  maxHp: number;
  hp: number;
  biome: BiomeType;
  modelType: 'iron_golem' | 'magma_colossus' | 'crystal_wyrm' | 'titan_nullifier' | 'apex_overlord';
  attacks: BossAttack[];
  dialogueBefore?: DialogueLine[];
  dialogueAfter?: DialogueLine[];
}

export interface LevelDynamicEvent {
  triggerZ: number;
  type: 'ambush' | 'coin_train' | 'emp_storm' | 'meteor_rain' | 'speed_boost';
  duration: number;
  intensity: number;
  executed?: boolean;
}

export interface LevelConfig {
  levelNumber: number;
  biome: BiomeType;
  trackLength: number;
  trackWidth: number;
  startingMobs: number;
  targetMobsToWin: number;
  gates: GateData[];
  obstacles: ObstacleData[];
  coins: CoinData[];
  events: LevelDynamicEvent[];
  boss?: BossData;
  multiplierWallSteps: number; // Castle tower steps at the finish (e.g. 10 steps from 1.2x to 10x)
}

export interface MobInstance {
  id: number;
  type: MobType;
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetZ: number;
  vx: number;
  vz: number;
  alive: boolean;
  scale: number;
  color: number;
  hp: number;
  maxHp: number;
  shieldHp: number;
  animOffset: number;
  invulnerableTime: number;
}

export interface DialogueLine {
  speaker: 'commander' | 'professor' | 'echo' | 'boss';
  speakerNameKey: string;
  avatar: string; // procedural / icon tag
  textKey: string;
  fallbackText: string;
  soundCue?: string;
}

export interface UpgradeConfig {
  id: string;
  nameKey: string;
  descKey: string;
  level: number;
  maxLevel: number;
  baseCost: number;
  costMultiplier: number;
  currency: 'coins' | 'gems';
  icon: string;
}

export interface PlayerSkin {
  id: string;
  nameKey: string;
  descKey: string;
  colorHex: string;
  emissiveHex: string;
  modelStyle: 'cyber' | 'neon' | 'samurai' | 'gold' | 'ghost' | 'demon' | 'titan';
  trailType: 'glow' | 'lightning' | 'fire' | 'matrix' | 'rainbow' | 'stars';
  cost: number;
  currency: 'coins' | 'gems';
  unlocked: boolean;
}

export interface AchievementItem {
  id: string;
  titleKey: string;
  descKey: string;
  icon: string;
  progress: number;
  goal: number;
  rewardCoins: number;
  rewardGems: number;
  claimed: boolean;
  category: 'crowd' | 'combat' | 'levels' | 'economy';
}

export interface GameStats {
  totalMobsSpawned: number;
  totalGatesPassed: number;
  totalObstaclesSmashed: number;
  totalBossesDefeated: number;
  totalCoinsEarned: number;
  totalGemsEarned: number;
  highestCombo: number;
  maxCrowdReached: number;
  gamesPlayed: number;
  levelsCompleted: number;
}

export interface GameSettings {
  language: 'ru' | 'en';
  soundVolume: number; // 0..1
  musicVolume: number; // 0..1
  graphicsQuality: 'high' | 'medium' | 'low';
  enableShadows: boolean;
  enablePostFX: boolean;
  enableScreenShake: boolean;
  enableHaptics: boolean;
  controlsSensitivity: number; // 0.5 .. 2.0
  invertX: boolean;
  fpsLimit: 30 | 60;
  showFps: boolean;
}

export interface PlayerUpgrades {
  startingMobs: number; // Level 0..10
  incomeMultiplier: number; // Level 0..10
  adrenalineDuration: number; // Level 0..10
  tankSpawnChance: number; // Level 0..5
  ninjaSpawnChance: number; // Level 0..5
  mageSpawnChance: number; // Level 0..5
  defenseAura: number; // Level 0..5
}

export interface SaveData {
  version: number;
  coins: number;
  gems: number;
  currentLevel: number;
  maxUnlockedLevel: number;
  levelStars: Record<number, number>; // levelNumber -> 1..3 stars
  levelHighScores: Record<number, number>;
  upgrades: PlayerUpgrades;
  equippedSkin: string;
  equippedTrail: string;
  unlockedSkins: string[];
  achievements: Record<string, { progress: number; claimed: boolean }>;
  stats: GameStats;
  settings: GameSettings;
  endlessHighScore: number;
  storyProgress: number; // Dialogue progress
}

export type GamePhase = 
  | 'main_menu' 
  | 'level_select' 
  | 'story_dialogue' 
  | 'running'
  | 'paused'
  | 'boss_fight'
  | 'finish_celebration' 
  | 'level_won' 
  | 'level_lost' 
  | 'shop' 
  | 'settings' 
  | 'achievements' 
  | 'guide' 
  | 'test_suite' 
  | 'endless_mode';
