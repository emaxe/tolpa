export type MobType = 'regular' | 'tank' | 'ninja' | 'mage';

export type FormationType = 'wedge' | 'wide' | 'circle' | 'arrow' | 'oval';

// Ворота применяют только позитивные операции к толпе (целые числа).
// subtract (−N) вынесен в отдельные СТЕНЫ (см. WallData) со счётчиком.
export type GateOp = 'add' | 'multiply' | 'divide';

// Тип движения ворот: могут стоять, ездить влево/вправо, подниматься/опускаться,
// вращаться — или комбинироваться.
export type GateMotion = 'none' | 'horizontal' | 'vertical' | 'rotate';

// Бонусы — собираемые светящиеся объекты (сферы/звёзды). В отличие от ворот,
// они не привязаны к арифметике толпы: это одноразовые подбираемые бусты.
export type BonusType = 'add_mobs' | 'heal' | 'adrenaline' | 'coins';

export interface BonusData {
  id: string;
  type: BonusType;
  x: number;
  y: number;
  z: number;
  value: number; // add_mobs: +N мобов; heal: +N hp всем живым; adrenaline: +N сек гипер; coins: +N монет
  collected?: boolean;
}

// Независимые ворота: НЕ пара створок, а одно ворото на своей позиции.
// Могут стоять, двигаться, вращаться. Применяют одну операцию к проходящим.
export interface GateData {
  id: string;
  z: number;
  x: number;        // центр ворот по X
  width: number;    // ширина проёма (может занимать всю трассу или часть)
  op: GateOp;
  value: number;    // целое значение (add:+N, multiply:×N, divide:÷N)
  motion: GateMotion;
  motionSpeed: number; // скорость движения/вращения
  motionRange: number; // размах движения по X (horizontal) или Y (vertical), для rotate — не используется
  passed?: boolean;
}

// Стена со счётчиком: убивает ровно `count` мобов, затем падает.
export interface WallData {
  id: string;
  z: number;
  x: number;
  width: number;
  count: number;      // сколько мобов должна убить, пока не упадёт
  killsRemaining: number; // текущий остаток счётчика
  destroyed?: boolean;
}

export type ObstacleType = 
  | 'saw_blade' 
  | 'axe_pendulum' 
  | 'crusher' 
  | 'spike_trap' 
  | 'wrecking_ball' 
  | 'laser_grid' 
  | 'barrier_gate' 
  | 'lava_pit'
  | 'bomb'
  | 'guard_dog'
  | 'swinging_hammer'
  | 'rolling_spike_ball';

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
  /** Киборг-собака: сколько человечков собака может убить в секунду (1..3). */
  attackRate?: number;
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
  walls: WallData[];
  bonuses: BonusData[];
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
  // Моб упал с края дорожки и сейчас падает вниз (анимация падения) — ещё не удалён из сцены.
  falling?: boolean;
  fallVy?: number;
  fallRotX?: number;
  fallRotZ?: number;
  // Моб погибает (от препятствия/ловушки) — проигрывается death-анимация перед удалением.
  dying?: boolean;
  deathT?: number;
  deathRotX?: number;
  deathRotZ?: number;
  deathScale?: number;
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

/** Стиль 3D-модели скина: определяет ФОРМУ/силуэт лидера (не только цвет). */
export type ModelStyle =
  | 'cyber'
  | 'neon'
  | 'samurai'
  | 'gold'
  | 'ghost'
  | 'demon'
  | 'titan'
  | 'clown'
  | 'banana'
  | 'dino'
  | 'zombie'
  | 'duck'
  | 'panda'
  | 'burger'
  | 'dog';

/** Категория скина — базовый цветовой или уникальная 3D-модель. */
export type SkinCategory = 'humanoid' | 'animal' | 'food' | 'creature' | 'mecha';

export interface PlayerSkin {
  id: string;
  nameKey: string;
  descKey: string;
  colorHex: string;
  emissiveHex: string;
  modelStyle: ModelStyle;
  trailType: 'glow' | 'lightning' | 'fire' | 'matrix' | 'rainbow' | 'stars';
  cost: number;
  currency: 'coins' | 'gems';
  unlocked: boolean;
  /** Категория скина: базовые — цветовой гуманоид, экзотические — уникальная модель. */
  category: SkinCategory;
  /** Метка бонусного скина: как получить (покупка | награда за уровень | награда за достижение). */
  reward?: 'shop' | 'level' | 'achievement';
  /** Для reward='level' — номер уровня-босс, после которого скин открывается автоматически. */
  rewardLevel?: number;
  /** Для reward='achievement' — id достижения, дающего скин. */
  rewardAchievement?: string;
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
  /** Необязательный бонусный скин, выдаваемый при получении награды. */
  rewardSkinId?: string;
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
  totalAdrenalineActivations: number;
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
