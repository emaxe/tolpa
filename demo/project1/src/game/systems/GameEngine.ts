/**
 * GameEngine — ядро игрового процесса (компонентно-ориентированный подход,
 * системы обновляются в фиксированном порядке; сущности — пулы объектов).
 *
 * Системы:
 *  - CrowdSystem: размер/типы толпы, формации, урон
 *  - GateSystem: ворота и условные арки
 *  - CollisionSystem: препятствия, монеты, бонусы (бакетизация по z)
 *  - ComboSystem / AdrenalineSystem / EventSystem / WallSystem (боссы)
 *
 * В игровом цикле нет аллокаций: массивы переиспользуются.
 */
import { EventEmitter } from "../core/EventEmitter";
import { ObjectPool } from "../core/ObjectPool";
import { l10n } from "../localization/LocalizationManager";
import { audio } from "../audio/AudioEngine";
import { InputManager } from "../input/InputManager";
import { ThreeRenderer } from "../engine/ThreeRenderer";
import type { Quality } from "../engine/ThreeRenderer";
import { generateLevel } from "../world/LevelGenerator";
import type { LevelData } from "../world/LevelGenerator";
import { applyConditional, applyGate } from "../world/Gates";
import type { GateKind } from "../world/Gates";
import { applyUpgrades, wallPushScore } from "../core/Economy";
import type { RunMods } from "../core/Economy";
import type { GameStore } from "../core/GameState";

export const CROWD_CAP = 200;
export const TRACK_LIMIT = 6.2;

export type MobType = 0 | 1 | 2 | 3 | 4; // normal | speedster | tank | magnet | clover

interface ObstacleEntity {
  x: number;
  z: number;
  w: number;
  d: number;
  kind: string;
  damage: number;
  persistent: boolean;
  dead: boolean;
  cooldown: number;
}

interface CoinEntity {
  x: number;
  z: number;
  dead: boolean;
  magnetized: boolean;
}

interface BonusEntity {
  x: number;
  z: number;
  kind: string;
  dead: boolean;
}

interface MeteorEntity {
  x: number;
  z: number;
  y: number;
  vx: number;
  active: boolean;
  impact: boolean;
}

interface GateEntity {
  x: number;
  z: number;
  kind: GateKind;
  n: number;
  good: boolean;
  passed: boolean;
  missed: boolean;
}

export interface HudData {
  count: number;
  score: number;
  coins: number;
  combo: number;
  mult: number;
  adrenaline: number;
  adrenalineActive: boolean;
  shield: number;
  speedT: number;
  magnetT: number;
  freezeT: number;
  doubleCoins: boolean;
  doubleScore: boolean;
  speedMps: number;
  level: number;
  isBoss: boolean;
  wallHp: number;
  wallMax: number;
  banner: string;
  bannerUntil: number;
  formation: number;
  formationsUnlocked: number;
  specialists: { speedster: number; tank: number; magnet: number; clover: number };
  countdown: number;
  fps: number;
}

export interface LevelResult {
  levelIndex: number;
  score: number;
  coins: number;
  stars: number;
  par: number;
  isBoss: boolean;
  newBest: boolean;
  reward: number;
}

export type EngineEvents = {
  hud: HudData;
  complete: LevelResult;
  fail: { levelIndex: number; score: number; coins: number };
  pause: boolean;
  banner: string;
  state: "idle" | "countdown" | "running" | "paused" | "finished";
};

interface RunBoosts {
  x2coins: boolean;
  x2score: boolean;
  plusCrowd: boolean;
}

const FORMATION_NAMES = ["formation.0", "formation.1", "formation.2", "formation.3"];

export class GameEngine {
  readonly events = new EventEmitter<EngineEvents>();
  readonly renderer: ThreeRenderer;

  private store: GameStore;
  private input: InputManager;
  private raf = 0;
  private lastT = 0;
  private fpsEMA = 60;
  private disposed = false;

  // Текущий уровень
  private level: LevelData | null = null;
  private levelIndex = 0;
  private mods: RunMods = applyUpgrades({} as never);

  // Толпа
  private count = 0;
  private specialists: Record<Exclude<MobType, 0>, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  private mobTypes = new Uint8Array(CROWD_CAP);
  private positions = new Float32Array(CROWD_CAP * 3);
  private formation = 0;
  private leaderX = 0;
  private leaderZ = 0;
  private steer = 0;
  private swayT = 0;

  // Ресурсы забега
  private score = 0;
  private coins = 0;
  private combo = 0;
  private mult = 1;
  private adrenaline = 0;
  private adrenalineActive = false;
  private adrenalineT = 0;
  private shieldT = 0;
  private speedT = 0;
  private magnetT = 0;
  private freezeT = 0;
  private boostT = 0; // ×2 очки
  private doubleCoins = false;
  private windForce = 0;
  private windT = 0;
  private boostApplied = false;

  // Сущности (пулы)
  private obstacles: ObstacleEntity[] = [];
  private obstacleBuckets = new Map<number, ObstacleEntity[]>();
  private coinsArr: CoinEntity[] = [];
  private bonuses: BonusEntity[] = [];
  private gates: GateEntity[] = [];
  private meteors: MeteorEntity[] = [];
  private eventQueue: { z: number; kind: string; fired: boolean }[] = [];
  private poolObstacle = new ObjectPool<ObstacleEntity>(
    () => ({ x: 0, z: 0, w: 1, d: 0.7, kind: "barrier", damage: 1, persistent: false, dead: false, cooldown: 0 }),
    (o) => {
      o.dead = true;
      o.cooldown = 0;
    },
  );

  // Босс
  private wallHp = 0;
  private wallMax = 0;
  private wallZ = 0;
  private pushing = false;
  private attacks: { kind: string; next: number }[] = [];
  private freezeUntil = 0;

  // Состояние
  private state: "idle" | "countdown" | "running" | "paused" | "finished" = "idle";
  private countdownT = 0;
  private banner = "";
  private bannerUntil = 0;
  private hudTimer = 0;
  private hud: HudData = {
    count: 0, score: 0, coins: 0, combo: 0, mult: 1, adrenaline: 0, adrenalineActive: false,
    shield: 0, speedT: 0, magnetT: 0, freezeT: 0, doubleCoins: false, doubleScore: false,
    speedMps: 0, level: 0, isBoss: false, wallHp: 0, wallMax: 0, banner: "", bannerUntil: 0,
    formation: 0, formationsUnlocked: 0, specialists: { speedster: 0, tank: 0, magnet: 0, clover: 0 },
    countdown: -1, fps: 60,
  };
  private lastHudCount = -1;
  private lastHudScore = -1;
  private lastHudCoins = -1;
  private lastHudBanner = "";
  private dist = 0;
  private wallDamage = 0;
  private runCoins = 0;
  private gateStreak = 0;

  private onVis: () => void;

  constructor(container: HTMLElement, store: GameStore, quality: Quality) {
    this.store = store;
    const data = store.getData();
    this.mods = applyUpgrades(data.upgrades);
    this.renderer = new ThreeRenderer(container, quality);
    this.input = new InputManager(container, {
      onSteer: (s) => {
        this.steer = s;
      },
      onAction: (a) => {
        if (a === "adrenaline") this.tryAdrenaline();
        else if (a === "formation") this.cycleFormation();
        else if (a === "pause") {
          if (this.state === "running") this.setPaused(true);
          else if (this.state === "paused") this.setPaused(false);
        } else if (a === "confirm") {
          if (this.state === "countdown") this.countdownT = 0;
        }
      },
    });
    this.input.attach();
    this.onVis = () => {
      if (document.hidden && this.state === "running") this.setPaused(true);
    };
    document.addEventListener("visibilitychange", this.onVis);
    this.applySettings();
    this.startLoop();
  }

  // ---------------- Публичное API ----------------

  applySettings(): void {
    const s = this.store.getData().settings;
    audio.setSound(s.sound);
    audio.setMusic(s.music);
    audio.hapticsOn = s.haptics;
  }

  startLevel(index: number): void {
    this.levelIndex = index;
    this.level = generateLevel(index);
    this.mods = applyUpgrades(this.store.getData().upgrades);
    this.renderer.setTheme(this.level.theme, this.level.seed);
    this.renderer.resetLevel();
    this.buildLevelEntities();
    this.resetRun();
    // Бусты на забег
    const boosts = this.store.getData().boostsSelected as unknown as RunBoosts;
    this.doubleCoins = boosts.x2coins;
    this.boostApplied = boosts.x2score;
    this.count = Math.min(CROWD_CAP, this.count + (boosts.plusCrowd ? 20 : 0));
    this.store.clearBoosts();
    this.state = "countdown";
    this.events.emit("state", "countdown");
    this.countdownT = 3.6;
    audio.ensure();
    this.emitHud(true);
  }

  restart(): void {
    this.startLevel(this.levelIndex);
  }

  setPaused(p: boolean): void {
    if (p && this.state === "running") {
      this.state = "paused";
      this.events.emit("pause", true);
      this.events.emit("state", "paused");
    } else if (!p && this.state === "paused") {
      this.state = "running";
      this.lastT = performance.now();
      this.events.emit("pause", false);
      this.events.emit("state", "running");
    }
  }

  getState(): string {
    return this.state;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener("visibilitychange", this.onVis);
    this.input.dispose();
    this.renderer.dispose();
    this.poolObstacle.dispose();
  }

  // ---------------- Подготовка уровня ----------------

  private buildLevelEntities(): void {
    const lv = this.level!;
    this.obstacles.length = 0;
    this.obstacleBuckets.clear();
    for (const o of lv.obstacles) {
      const e = this.poolObstacle.acquire();
      e.x = o.x;
      e.z = o.z;
      e.w = o.w;
      e.d = o.d;
      e.kind = o.kind;
      e.damage = o.damage;
      e.persistent = o.persistent;
      e.dead = false;
      const key = Math.round(o.z / 4);
      let arr = this.obstacleBuckets.get(key);
      if (!arr) {
        arr = [];
        this.obstacleBuckets.set(key, arr);
      }
      arr.push(e);
      this.obstacles.push(e);
    }
    this.coinsArr = lv.coins.map((c) => ({ x: c.x, z: c.z, dead: false, magnetized: false }));
    this.bonuses = lv.bonuses.map((b) => ({ x: b.x, z: b.z, kind: b.kind, dead: false }));
    this.gates = [
      ...lv.gates.map((g) => ({ x: g.x, z: g.z, kind: g.kind, n: g.n ?? 10, good: true, passed: false, missed: false })),
      ...lv.conditionals.map((c) => [
        { x: c.x, z: c.z, kind: "conditional" as GateKind, n: c.n, good: true, passed: false, missed: false },
        { x: c.x + 3.4, z: c.z, kind: "conditional" as GateKind, n: c.n, good: false, passed: false, missed: false },
      ]).flat(),
    ];
    this.gates.sort((a, b) => a.z - b.z);
    this.eventQueue = lv.events.map((e) => ({ z: e.z, kind: e.kind, fired: false }));
    this.meteors = [];
    if (lv.wall) {
      this.wallMax = this.wallHp = lv.wall.hp;
      this.wallZ = lv.length - 12;
      this.attacks = lv.wall.attacks.map((a) => ({ kind: a.kind, next: a.first }));
      this.renderer.setupWall(lv.world, lv.wall.hp, this.wallZ, lv.wall.width);
    } else {
      this.wallMax = this.wallHp = 0;
      this.wallZ = 0;
      this.attacks = [];
    }
    // Синхронизация рендера
    this.renderer.syncGates(this.gates.map((g) => ({ x: g.x, z: g.z, kind: g.kind, n: g.n, good: g.good })));
    this.renderer.syncObstacles(this.obstacles.map((o) => ({ x: o.x, z: o.z, kind: o.kind as never, w: o.w, active: !o.dead })));
    this.renderer.syncCoins(this.coinsArr.map((c) => ({ x: c.x, z: c.z })));
    this.renderer.syncBonuses(this.bonuses.map((b) => ({ x: b.x, z: b.z, kind: b.kind })));
  }

  private resetRun(): void {
    const start = Math.min(CROWD_CAP, this.mods.startCrowd);
    this.count = start;
    this.specialists = { 1: 0, 2: 0, 3: 0, 4: 0 };
    this.mobTypes.fill(0);
    this.positions.fill(0);
    this.leaderX = 0;
    this.leaderZ = 0;
    this.steer = 0;
    this.score = 0;
    this.coins = 0;
    this.runCoins = 0;
    this.combo = 0;
    this.mult = 1;
    this.adrenaline = 0;
    this.adrenalineActive = false;
    this.adrenalineT = 0;
    this.shieldT = this.mods.shieldStart;
    this.speedT = 0;
    this.magnetT = 0;
    this.freezeT = 0;
    this.windForce = 0;
    this.windT = 0;
    this.dist = 0;
    this.wallDamage = 0;
    this.gateStreak = 0;
    this.banner = "";
    this.bannerUntil = 0;
    this.pushing = false;
    this.hudTimer = 0;
    const st = this.store.getData().stats;
    st.runsStarted += 1;
    this.store.commit();
  }

  // ---------------- Игровой цикл ----------------

  private startLoop(): void {
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      const dtRaw = (t - this.lastT) / 1000;
      this.lastT = t;
      if (dtRaw <= 0 || dtRaw > 0.1) return; // пропускаем заморозки вкладки
      this.fpsEMA = this.fpsEMA * 0.95 + (1 / dtRaw) * 0.05;
      this.update(dtRaw);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private update(dt: number): void {
    if (this.state === "paused" || this.state === "finished" || this.state === "idle") {
      this.renderer.render();
      return;
    }
    if (this.state === "countdown") {
      this.countdownT -= dt;
      if (this.countdownT <= 0) {
        this.state = "running";
        this.events.emit("state", "running");
        audio.go();
      }
      this.updateFormation();
      this.renderer.updateCrowd(this.count, this.positions, this.mobTypes, this.level!.seed);
      this.hud.countdown = Math.max(0, Math.ceil(this.countdownT));
      this.emitHud(true);
      this.renderer.update(dt, this.leaderX, this.leaderZ, 0);
      this.renderer.render();
      return;
    }

    const lv = this.level!;
    const speed = this.currentSpeed();

    // --- Ввод: движение влево/вправо ---
    let target = this.steer * TRACK_LIMIT;
    if (this.windT > 0) {
      this.windT -= dt;
      target += this.windForce * 2.4;
    }
    this.leaderX += (target - this.leaderX) * Math.min(1, dt * (this.steer !== 0 ? 7 : 4.5));
    this.leaderX = Math.max(-TRACK_LIMIT, Math.min(TRACK_LIMIT, this.leaderX));

    // --- Продвижение ---
    this.leaderZ += speed * dt;
    this.dist += speed * dt;
    this.swayT += dt;

    // --- Таймеры ---
    this.shieldT = Math.max(0, this.shieldT - dt);
    this.speedT = Math.max(0, this.speedT - dt);
    this.magnetT = Math.max(0, this.magnetT - dt);
    this.freezeT = Math.max(0, this.freezeT - dt);
    if (this.adrenalineActive) {
      this.adrenalineT -= dt;
      if (this.adrenalineT <= 0) this.adrenalineActive = false;
    }

    // --- Очки ---
    const scoreMult =
      this.mult *
      (this.adrenalineActive ? 2 : 1) *
      (this.boostApplied || this.boostT > 0 ? 2 : 1) *
      (this.formation === 2 ? 1.1 : 1);
    this.score += speed * dt * 10 * scoreMult;
    this.hudTimer -= dt;
    if (this.bannerUntil > 0 && performance.now() / 1000 > this.bannerUntil) {
      this.banner = "";
      this.bannerUntil = 0;
    }

    // --- Формация толпы ---
    this.updateFormation();

    // --- События ---
    this.updateEvents(dt);

    // --- Ворота ---
    this.updateGates();

    // --- Коллизии ---
    this.updateCollisions(dt);

    // --- Бонусы ---
    this.updateBonuses();

    // --- Босс: стена ---
    this.updateWall(dt);

    // --- Финиш ---
    if (!lv.isBoss && this.leaderZ >= lv.length) {
      this.finishLevel(true);
      return;
    }
    if (this.count <= 0) {
      this.failLevel();
      return;
    }

    // --- Рендер ---
    const renderer = this.renderer;
    renderer.updateCrowd(this.count, this.positions, this.mobTypes, lv.seed);
    renderer.update(dt, this.leaderX, this.leaderZ, speed);
    renderer.updateEventFx(this.windT > 0 ? "wind" : "none", this.leaderX, this.leaderZ, dt);
    renderer.syncMeteors(this.meteors);
    if (this.wallMax > 0) renderer.updateWall(this.wallHp, true);
    renderer.render();

    // --- HUD ---
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.emitHud(false);
    }
  }

  private currentSpeed(): number {
    const lv = this.level!;
    let s = lv.baseSpeed * this.mods.speedMult;
    if (this.speedT > 0) s *= 1.4;
    if (this.adrenalineActive) s *= 1.55;
    if (this.freezeT > 0 || this.freezeUntil > performance.now() / 1000) s *= 0.45;
    if (this.formation === 1) s *= 1.05;
    s *= 1 + this.specialists[1] * 0.006; // скороходы
    return Math.min(20, s);
  }

  // ---------------- Формации ----------------

  cycleFormation(): void {
    const maxF = this.mods.formationLevel;
    if (maxF <= 0) {
      this.showBanner("formation.0");
      return;
    }
    this.formation = (this.formation + 1) % (maxF + 1);
    audio.ui();
    this.emitHud(true);
  }

  private updateFormation(): void {
    const n = this.count;
    const cap = CROWD_CAP;
    for (let i = 0; i < n; i++) {
      let dx: number;
      let dz: number;
      if (this.formation === 1) {
        // Клин
        const row = Math.floor((Math.sqrt(8 * i + 1) - 1) / 2);
        const pos = i - (row * (row + 1)) / 2;
        dx = (pos - row) * 0.95;
        dz = -(1.5 + row * 1.1);
      } else if (this.formation === 2) {
        // Ромб
        const cols = Math.min(11, Math.max(3, Math.ceil(Math.sqrt(n * 1.8))));
        const rows = Math.ceil(n / cols);
        const col = i % cols;
        const row = Math.floor(i / cols);
        dx = (col - (cols - 1) / 2) * 1.02 * (1 - (row / Math.max(1, rows)) * 0.3);
        dz = -(1.7 + row * 0.95) + (row % 2) * 0.45;
      } else if (this.formation === 3) {
        // Квадрат
        const cols = Math.ceil(Math.sqrt(n));
        dx = (i % cols - (cols - 1) / 2) * 1.18;
        dz = -(1.9 + Math.floor(i / cols) * 1.12);
      } else {
        // Колонна
        const cols = Math.min(11, Math.max(3, Math.ceil(Math.sqrt(n * 1.6))));
        const col = i % cols;
        const row = Math.floor(i / cols);
        dx = (col - (cols - 1) / 2) * 1.05;
        dz = -(1.6 + row * 0.95) + (row % 2) * 0.3;
      }
      const bob = Math.sin(this.swayT * 7 + i * 0.6) * 0.04;
      this.positions[i * 3] = this.leaderX + dx;
      this.positions[i * 3 + 1] = 0.62 + bob;
      this.positions[i * 3 + 2] = this.leaderZ + dz;
    }
    void cap;
  }

  // ---------------- Ворота ----------------

  private updateGates(): void {
    for (const g of this.gates) {
      if (g.passed || g.missed) continue;
      if (this.leaderZ < g.z - 1.2) continue;
      if (this.leaderZ > g.z + 3) {
        g.missed = true;
        continue;
      }
      const dx = Math.abs(this.leaderX - g.x);
      if (dx > 1.3) continue;
      g.passed = true;
      this.resolveGate(g);
    }
  }

  private resolveGate(g: GateEntity): void {
    const prevCount = this.count;
    let outcome;
    if (g.kind === "conditional") {
      outcome = applyConditional(this.count, this.gateThreshold(g), g.n, g.good);
    } else {
      outcome = applyGate(this.count, g.kind, g.n);
    }
    this.count = outcome.count;
    this.applyTypeChanges(g, outcome.passed);
    this.store.getData().stats.gatesPassed += 1;

    const gained = outcome.count - prevCount;
    if (gained > 0) {
      this.combo += 1;
      this.gateStreak += 1;
      this.mult = Math.min(4, 1 + this.combo * 0.2);
      this.adrenaline = Math.min(100, this.adrenaline + 12 * this.mods.adrenalineGain);
      this.score += gained * 25 * this.mult;
      audio.gateGood();
      this.renderer.spawnParticles(this.leaderX, 1.5, g.z, 0x2ecc71, 14, 4);
    } else if (gained < 0) {
      this.combo = 0;
      this.mult = 1;
      audio.gateBad();
      this.renderer.spawnParticles(this.leaderX, 1.5, g.z, 0xe74c3c, 14, 4);
    } else {
      audio.gateGood();
    }
    if (outcome.passed) audio.combo(this.combo);
    this.renderer.shake(0.12);
    this.emitHud(true);
  }

  private gateThreshold(g: GateEntity): number {
    // Порог условных ворот из уровня
    const lv = this.level!;
    const c = lv.conditionals.find((c) => Math.abs(c.z - g.z) < 0.5);
    return c?.threshold ?? 20;
  }

  private applyTypeChanges(g: GateEntity, passed: boolean): void {
    // Ворота-специалисты превращают N обычных в специалистов
    if (g.kind === "special" && passed) {
      this.convertToSpecialists(5);
    }
  }

  private convertToSpecialists(n: number): void {
    let converted = 0;
    for (let i = 0; i < this.count && converted < n; i++) {
      if (this.mobTypes[i] === 0) {
        const t = [1, 2, 3, 4][Math.floor(Math.random() * 4)] as 1 | 2 | 3 | 4;
        this.mobTypes[i] = t;
        this.specialists[t] += 1;
        converted++;
      }
    }
    if (converted > 0) {
      audio.specialist();
      this.renderer.spawnParticles(this.leaderX, 1.6, this.leaderZ, 0xffd23f, 18, 5);
    }
  }

  // ---------------- Коллизии ----------------

  private updateCollisions(dt: number): void {
    // Препятствия
    for (let i = 0; i < this.count; i++) {
      const fx = this.positions[i * 3];
      const fz = this.positions[i * 3 + 2];
      const b = Math.round(fz / 4);
      for (let k = b - 1; k <= b + 1; k++) {
        const arr = this.obstacleBuckets.get(k);
        if (!arr) continue;
        for (const ob of arr) {
          if (ob.dead) continue;
          if (Math.abs(fz - ob.z) < ob.d + 0.45 && Math.abs(fx - ob.x) < ob.w + 0.45) {
            this.hitObstacle(ob, fx, fz, dt);
            if (this.count <= 0) return;
          }
        }
      }
    }
    // Монеты
    const magnetR = this.magnetT > 0 ? 6.5 + this.specialists[3] * 0.8 : 1.9;
    for (const c of this.coinsArr) {
      if (c.dead) continue;
      const dx = c.x - this.leaderX;
      const dz = c.z - this.leaderZ;
      const d2 = dx * dx + dz * dz;
      if (d2 < magnetR * magnetR) {
        if (d2 < 2.2) {
          this.collectCoin(c);
        } else {
          // Притяжение
          c.x += dx * dt * 6;
          c.z += dz * dt * 6;
        }
      }
    }
  }

  private hitObstacle(ob: ObstacleEntity, fx: number, fz: number, dt: number): void {
    if (this.adrenalineActive || this.shieldT > 0) {
      // Щит/адреналин: сносим препятствие без потерь
      if (!ob.persistent) {
        ob.dead = true;
        this.renderer.spawnParticles(fx, 1, fz, 0xffffff, 12, 7);
      }
      return;
    }
    if (ob.persistent) {
      ob.cooldown -= dt;
      if (ob.cooldown > 0) return;
      ob.cooldown = 0.55;
      this.killMobs(ob.damage, fx, fz);
      return;
    }
    ob.dead = true;
    this.killMobs(ob.damage, fx, fz);
    this.renderer.spawnParticles(fx, 1, fz, 0xff8a65, 18, 6);
    audio.hit();
  }

  private killMobs(n: number, fx: number, fz: number): void {
    let dmg = n;
    // Танки поглощают урон
    const tanks = this.specialists[2];
    if (tanks > 0) {
      const absorbed = Math.min(tanks, dmg);
      this.specialists[2] -= absorbed;
      dmg -= absorbed;
      let left = absorbed;
      for (let i = this.count - 1; i >= 0 && left > 0; i--) {
        if (this.mobTypes[i] === 2) {
          this.mobTypes[i] = 0;
          left--;
        }
      }
    }
    if (dmg <= 0) return;
    this.count = Math.max(0, this.count - dmg);
    this.combo = 0;
    this.mult = 1;
    this.store.getData().stats.mobsLost += dmg;
    this.renderer.spawnParticles(fx, 1, fz, 0xe57373, 8, 5);
    this.renderer.shake(0.3);
    if (this.count <= 0) {
      this.failLevel();
    }
  }

  private collectCoin(c: CoinEntity): void {
    c.dead = true;
    const value = Math.round(5 * this.mods.coinLuck * (this.doubleCoins ? 2 : 1));
    this.coins += value;
    this.runCoins += value;
    this.score += 10 * this.mult;
    audio.coin();
    this.renderer.spawnParticles(c.x, 1, c.z, 0xffd23f, 5, 3);
  }

  // ---------------- Бонусы ----------------

  private updateBonuses(): void {
    for (const b of this.bonuses) {
      if (b.dead) continue;
      const dx = b.x - this.leaderX;
      const dz = b.z - this.leaderZ;
      if (dx * dx + dz * dz < 2.1) {
        b.dead = true;
        this.applyBonus(b.kind);
      }
    }
  }

  private applyBonus(kind: string): void {
    audio.pickBonus();
    this.renderer.spawnParticles(this.leaderX, 1.6, this.leaderZ, 0x69f0ae, 16, 5);
    switch (kind) {
      case "speed":
        this.speedT = 6;
        this.showBanner("banner.speed");
        break;
      case "shield":
        this.shieldT = Math.max(this.shieldT, 6);
        this.showBanner("banner.shield");
        break;
      case "magnet":
        this.magnetT = this.mods.magnetTime;
        this.showBanner("banner.magnet");
        break;
      case "adrenaline":
        this.adrenaline = Math.min(100, this.adrenaline + 40);
        if (this.adrenaline >= 100) this.tryAdrenaline();
        break;
      case "team":
        this.addMobs(10);
        this.showBanner("event.swarm");
        break;
      case "special":
        this.convertToSpecialists(5);
        break;
      case "boost":
        this.boostT = 10;
        this.showBanner("banner.boost");
        break;
    }
    this.emitHud(true);
  }

  private addMobs(n: number): void {
    const prev = this.count;
    this.count = Math.min(CROWD_CAP, this.count + n);
    for (let i = prev; i < this.count; i++) this.mobTypes[i] = 0;
    this.renderer.spawnParticles(this.leaderX, 1.4, this.leaderZ - 2, 0x81c784, 20, 5);
  }

  // ---------------- Адреналин ----------------

  tryAdrenaline(): void {
    if (this.state !== "running" || this.adrenalineActive) return;
    if (this.adrenaline < 100) return;
    this.adrenaline = 0;
    this.adrenalineActive = true;
    this.adrenalineT = 5;
    this.showBanner("banner.adrenaline");
    audio.boost();
    this.renderer.kickFov(8);
    this.renderer.spawnParticles(this.leaderX, 1, this.leaderZ, 0xff7043, 30, 8);
    this.emitHud(true);
  }

  // ---------------- Динамические события ----------------

  private updateEvents(dt: number): void {
    for (const ev of this.eventQueue) {
      if (ev.fired) continue;
      if (this.leaderZ < ev.z) continue;
      ev.fired = true;
      this.triggerEvent(ev.kind);
    }
    // Метеоры
    for (const m of this.meteors) {
      if (!m.active) continue;
      m.y -= 16 * dt;
      m.x += m.vx * dt;
      if (m.y <= 0.2) {
        m.active = false;
        m.impact = true;
        if (Math.abs(m.x - this.leaderX) < 2.6 && Math.abs(m.z - this.leaderZ) < 2) {
          this.killMobs(4, m.x, m.z);
          audio.hit();
        }
        this.renderer.spawnParticles(m.x, 0.4, m.z, 0xff5722, 16, 6);
        this.renderer.shake(0.35);
      }
    }
    this.meteors = this.meteors.filter((m) => !m.impact);
    void dt;
  }

  private triggerEvent(kind: string): void {
    audio.event();
    switch (kind) {
      case "wind":
        this.windT = 6;
        this.windForce = Math.random() < 0.5 ? -1 : 1;
        this.showBanner("event.wind");
        this.renderer.setupEventFx("wind");
        break;
      case "coinrain":
        this.showBanner("event.coinrain");
        for (let i = 0; i < 36; i++) {
          this.coinsArr.push({
            x: Math.random() * 11 - 5.5,
            z: this.leaderZ + 3 + i * 0.5,
            dead: false,
            magnetized: false,
          });
        }
        this.renderer.syncCoins(this.coinsArr.map((c) => ({ x: c.x, z: c.z })));
        break;
      case "swarm":
        this.showBanner("event.swarm");
        this.addMobs(15);
        break;
      case "frenzy":
        this.showBanner("event.frenzy");
        this.adrenaline = 100;
        this.tryAdrenaline();
        break;
      case "meteor":
        this.showBanner("event.meteor");
        for (let i = 0; i < 5; i++) {
          this.meteors.push({
            x: this.leaderX + (Math.random() * 8 - 4),
            z: this.leaderZ + 6 + i * 3,
            y: 12,
            vx: (Math.random() - 0.5) * 2,
            active: true,
            impact: false,
          });
        }
        break;
    }
  }

  // ---------------- Босс: стена ----------------

  private updateWall(dt: number): void {
    if (this.wallMax <= 0) return;
    const reach = this.wallZ - 4.5;
    this.pushing = this.leaderZ >= reach;
    if (!this.pushing) return;

    const power = (1 + this.count * 0.015 + this.specialists[1] * 0.01) * (this.adrenalineActive ? 1.5 : 1);
    const dmg = power * 9 * dt;
    this.wallHp = Math.max(0, this.wallHp - dmg);
    this.wallDamage += dmg;
    this.score += wallPushScore(this.count, dmg) * this.mult * (this.boostApplied ? 2 : 1);
    if (Math.random() < 0.15) {
      audio.wallHit();
      this.renderer.flashWall();
      this.renderer.shake(0.08);
    }
    this.renderer.updateWall(this.wallHp, true);

    // Атаки босса
    for (const a of this.attacks) {
      a.next -= dt;
      if (a.next > 0) continue;
      a.next = this.attackEvery(a.kind);
      this.bossAttack(a.kind);
    }

    if (this.wallHp <= 0) {
      this.store.getData().stats.wallsBroken += 1;
      this.renderer.breakWall();
      audio.wallBreak();
      this.showBanner("banner.wallBreak");
      this.finishLevel(true);
    }
  }

  private attackEvery(kind: string): number {
    const lv = this.level!;
    const def = lv.wall!.attacks.find((a) => a.kind === kind);
    return def?.every ?? 8;
  }

  private bossAttack(kind: string): void {
    switch (kind) {
      case "spikes": {
        audio.hit();
        this.renderer.setSpikes(11, true);
        setTimeout(() => this.renderer.setSpikes(0, false), 900);
        this.killMobs(Math.max(1, Math.round(this.count * 0.08)), this.leaderX, this.wallZ - 1);
        this.renderer.shake(0.4);
        break;
      }
      case "wave": {
        audio.event();
        this.renderer.triggerShockwave(0, this.wallZ - 1.5);
        if (this.leaderZ > this.wallZ - 8) {
          this.leaderZ -= 3.5;
          this.killMobs(Math.max(1, Math.round(this.count * 0.05)), this.leaderX, this.leaderZ);
        }
        break;
      }
      case "freeze": {
        audio.gateBad();
        this.freezeT = 3;
        this.showBanner("banner.freeze");
        break;
      }
      case "mines": {
        for (let i = 0; i < 3; i++) {
          const e = this.poolObstacle.acquire();
          e.x = Math.random() * 9 - 4.5;
          e.z = this.wallZ - 2.5 - i * 1.6;
          e.w = 0.9;
          e.d = 0.7;
          e.kind = "mine";
          e.damage = 5;
          e.persistent = false;
          e.dead = false;
          const key = Math.round(e.z / 4);
          let arr = this.obstacleBuckets.get(key);
          if (!arr) {
            arr = [];
            this.obstacleBuckets.set(key, arr);
          }
          arr.push(e);
          this.obstacles.push(e);
        }
        this.renderer.syncObstacles(this.obstacles.map((o) => ({ x: o.x, z: o.z, kind: o.kind as never, w: o.w, active: !o.dead })));
        audio.event();
        break;
      }
    }
  }

  // ---------------- Финиш / провал ----------------

  private finishLevel(win: boolean): void {
    if (this.state === "finished") return;
    this.state = "finished";
    this.events.emit("state", "finished");
    const lv = this.level!;
    const finalScore = Math.floor(this.score);
    const res = this.store.completeLevel(this.levelIndex, finalScore, this.coins);
    if (win) {
      audio.win();
      this.renderer.setFlash();
      this.events.emit("complete", {
        levelIndex: this.levelIndex,
        score: finalScore,
        coins: this.coins,
        stars: res.stars,
        par: lv.parScore,
        isBoss: lv.isBoss,
        newBest: res.newBest,
        reward: res.reward,
      });
    } else {
      audio.lose();
      this.events.emit("fail", { levelIndex: this.levelIndex, score: finalScore, coins: this.coins });
    }
  }

  private failLevel(): void {
    this.renderer.spawnParticles(this.leaderX, 1, this.leaderZ, 0x90a4ae, 40, 8);
    this.renderer.shake(0.6);
    this.finishLevel(false);
  }

  // ---------------- HUD ----------------

  private showBanner(key: string): void {
    this.banner = l10n.t(key);
    this.bannerUntil = performance.now() / 1000 + 2.2;
  }

  private emitHud(force: boolean): void {
    const h = this.hud;
    h.count = this.count;
    h.score = Math.floor(this.score);
    h.coins = this.coins;
    h.combo = this.combo;
    h.mult = this.mult;
    h.adrenaline = this.adrenaline;
    h.adrenalineActive = this.adrenalineActive;
    h.shield = this.shieldT;
    h.speedT = this.speedT;
    h.magnetT = this.magnetT;
    h.freezeT = this.freezeT;
    h.doubleCoins = this.doubleCoins;
    h.doubleScore = this.boostApplied || this.boostT > 0;
    h.speedMps = this.currentSpeed();
    h.level = this.levelIndex + 1;
    h.isBoss = this.level?.isBoss ?? false;
    h.wallHp = Math.floor(this.wallHp);
    h.wallMax = this.wallMax;
    h.banner = this.banner;
    h.bannerUntil = this.bannerUntil;
    h.formation = this.formation;
    h.formationsUnlocked = this.mods.formationLevel;
    h.specialists = {
      speedster: this.specialists[1],
      tank: this.specialists[2],
      magnet: this.specialists[3],
      clover: this.specialists[4],
    };
    h.countdown = this.state === "countdown" ? Math.max(0, Math.ceil(this.countdownT)) : -1;
    h.fps = Math.round(this.fpsEMA);
    if (
      force ||
      h.count !== this.lastHudCount ||
      h.score !== this.lastHudScore ||
      h.coins !== this.lastHudCoins ||
      h.banner !== this.lastHudBanner
    ) {
      this.lastHudCount = h.count;
      this.lastHudScore = h.score;
      this.lastHudCoins = h.coins;
      this.lastHudBanner = h.banner;
      this.events.emit("hud", h);
    }
  }

  getLevelData(): LevelData | null {
    return this.level;
  }
}

export { FORMATION_NAMES };
