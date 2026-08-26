import * as THREE from 'three';
import { BossAttack, BossData } from '../types/game';
import { createBossMesh } from '../utils/proceduralMeshes';
import { CrowdManager } from './CrowdManager';
import { ParticleSystem } from './ParticleSystem';
import { soundEngine } from '../audio/SoundEngine';
import { eventBus } from '../core/EventBus';
import { stateManager } from '../core/StateManager';

// Пауза между атаками босса, масштабируемая по уровню (tier = level/10, 1..5).
// L10 — заметная пауза (обучающий ритм), к L50 почти исчезает (эскалация).
const BOSS_BASE_ATTACK_COOLDOWN = 2.5; // пауза на L10, сек
const BOSS_COOLDOWN_PER_TIER = 0.55; // уменьшение паузы на каждый тир
const BOSS_MIN_ATTACK_COOLDOWN = 0.3; // пол L50 — почти без паузы

export class BossManager {
  private scene: THREE.Scene;
  public bossData: BossData | null = null;
  public bossMesh: THREE.Group | null = null;
  private telegraphMesh: THREE.Mesh | null = null;
  private attackTimer: number = 0;
  private currentAttackIndex: number = 0;
  private lastAttackIndex: number = -1;
  private isAttacking: boolean = false;
  public isDefeated: boolean = false;
  private bossArenaZ: number = 0;
  private retaliationTimer: number = 0;
  // Накопитель тиков урона для атаки "minions" (рой мелких тварей грызёт толпу
  // в течение всей длительности атаки, а не одним ударом как slam/laser).
  private minionTickAccum: number = 0;
  // Накопитель фидбек-фикций босс-урона. Меле-урон толпы приходит каждый кадр (60 Гц);
  // без этого накопителя soundEngine boss_hit + частицы + eventBus.emit('bossDamaged')
  // спамятся 60 раз/сек, форсируя тяжёлый ре-рендер HUD на 60 Гц. Гейтим фидбек ~6 Гц.
  private hitFxAccum: number = 0;
  // Пауза между атаками (attack cooldown), масштабируемая по уровню босса.
  // Раньше босс бил непрерывно (telegraph → attack → сразу следующий telegraph)
  // на всех уровнях — не было окна передышки для перестроения толпы. Теперь
  // между атаками есть пауза: на L10 заметная (новичок успевает перестроиться),
  // к L50 почти исчезает (эскалация сложности).
  private isCoolingDown: boolean = false;
  private attackCooldown: number = 0;
  private attackInterval: number = 2.5;
  private bossLevel: number = 10;
  // Атака "shield" (энергетический купол): пока активен, босс блокирует урон толпы.
  private isShielded: boolean = false;
  private shieldMesh: THREE.Mesh | null = null;
  private particles: ParticleSystem;

  constructor(scene: THREE.Scene, particles: ParticleSystem) {
    this.scene = scene;
    this.particles = particles;
  }

  public initBoss(bossData: BossData, arenaZ: number, level: number = 10): void {
    this.clear();
    this.bossData = { ...bossData, hp: bossData.maxHp };
    this.bossArenaZ = arenaZ;
    this.isDefeated = false;
    this.attackTimer = 0;
    this.currentAttackIndex = this.selectNextAttackIndex();
    this.lastAttackIndex = -1;
    this.retaliationTimer = 1.0;
    this.bossLevel = level;
    this.attackInterval = this.computeAttackInterval(level);
    // Грейс-пауза перед первой атакой: даёт игроку время перестроить толпу
    // после входа в арену (distanceToArena <= 35), а не получать удар сразу.
    this.isCoolingDown = true;
    this.attackCooldown = 1.0 + this.attackInterval;

    // Create 3D Mesh
    this.bossMesh = createBossMesh(this.bossData);
    this.bossMesh.position.set(0, 0, arenaZ);
    this.scene.add(this.bossMesh);

    // Create Telegraph Ring Mesh
    const teleGeo = new THREE.RingGeometry(0.1, 4.0, 32);
    const teleMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
    });
    this.telegraphMesh = new THREE.Mesh(teleGeo, teleMat);
    this.telegraphMesh.rotation.x = -Math.PI / 2;
    this.telegraphMesh.position.set(0, 0.05, arenaZ - 5);
    this.scene.add(this.telegraphMesh);

    soundEngine.playSound('boss_roar');
    soundEngine.playMusic('boss_battle');
  }

  /** Рассчитывает паузу между атаками по уровню босса (tier = level/10, 1..5).
   *  L10 — заметная пауза (обучающий ритм), к L50 почти исчезает (эскалация). */
  private computeAttackInterval(level: number): number {
    const tier = Math.max(1, Math.floor(level / 10));
    return Math.max(
      BOSS_MIN_ATTACK_COOLDOWN,
      BOSS_BASE_ATTACK_COOLDOWN - (tier - 1) * BOSS_COOLDOWN_PER_TIER
    );
  }

  public update(
    dt: number,
    crowd: CrowdManager,
    particles: ParticleSystem
  ): void {
    if (!this.bossData || !this.bossMesh || this.isDefeated) return;

    const crowdZ = crowd.leaderZ;
    const distanceToArena = this.bossArenaZ - crowdZ;

    // Boss breathing / idle animation
    this.bossMesh.position.y = Math.sin(Date.now() * 0.003) * 0.2;

    // Only engage battle when crowd is within 35 units of boss arena
    if (distanceToArena > 35) return;

    // 1. Attack cycle (с паузой между атаками, масштабируемой по уровню босса).
    //    Во время паузы (isCoolingDown) attackTimer НЕ инкрементируется — иначе
    //    первый кадр после паузы мгновенно завершил бы telegraph следующей атаки.
    if (this.isCoolingDown) {
      this.attackCooldown -= dt;
      if (this.attackCooldown <= 0) {
        this.isCoolingDown = false;
        this.attackTimer = 0;
      }
      // Телеграф скрыт — opacity уже сброшен при завершении атаки.
    } else {
      this.attackTimer += dt;
      const attacks = this.bossData.attacks;
      const currentAttack = attacks[this.currentAttackIndex];

      if (!this.isAttacking) {
        // Telegraph phase
        if (this.telegraphMesh) {
          const prog = this.attackTimer / currentAttack.telegraphTime;
          (this.telegraphMesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.7, prog * 0.7);
          this.telegraphMesh.scale.set(prog, prog, prog);
        }

        if (this.attackTimer >= currentAttack.telegraphTime) {
          this.isAttacking = true;
          this.attackTimer = 0;
          this.executeBossAttack(currentAttack, crowd, particles);
        }
      } else {
        // Attack execution phase
        // Рой мелких тварей наносит урон тиками на протяжении всей длительности атаки.
        this.tickMinionDamage(dt, crowd, particles);
        if (this.attackTimer >= currentAttack.duration) {
          this.isAttacking = false;
          this.attackTimer = 0;
          this.lastAttackIndex = this.currentAttackIndex;
          this.currentAttackIndex = this.selectNextAttackIndex();
          // Атака "shield": по завершении купол спадает, босс снова уязвим.
          if (this.isShielded) {
            this.setShielded(false);
          }
          // Начинаем паузу перед следующей атакой.
          this.isCoolingDown = true;
          this.attackCooldown = this.attackInterval;
          if (this.telegraphMesh) {
            (this.telegraphMesh.material as THREE.MeshBasicMaterial).opacity = 0;
          }
        }
      }
    }

    // 2. Crowd attacks boss on close contact.
    // Диапазон -3..6: толпа бьёт босса, только пока реально стоит рядом с ним, а не всю
    // дорогу до финиша после того как пробежала мимо (distanceToArena становится отрицательной).
    if (distanceToArena <= 6 && distanceToArena >= -3) {
      const aliveMobs = crowd.getAliveMobs();
      // Раньше 35 dps на моба означало, что толпа в полсотни бойцов сносила босса L10
      // (150 HP) за 0.086 секунды — "бой" не успевал начаться. Теперь урон растёт
      // медленнее и не зависит от размера толпы линейно.
      const crowdPower = Math.min(140, 12 + aliveMobs.length * 1.6) * dt;
      // Тактический бонус Фаланги (circle): толпа в плотном строю наносит боссу больше урона.
      const crowdMult = crowd.getBossDamageMultiplier();
      // Фаланга (circle) пробивает энергетический купол на 20% от урона.
      this.takeDamage(crowdPower * crowdMult, particles, crowd.formation === 'circle');

      // Boss retaliation — было "8% шанс за кадр" (~4.8 смертей/сек на 60 FPS без единого
      // предупреждения). Теперь фиксированный ритм с небольшой тряской-телеграфом.
      this.retaliationTimer -= dt;
      if (this.retaliationTimer <= 0) {
        this.retaliationTimer = 1.4;
        eventBus.emit('screenShake', { intensity: 0.25 });
        crowd.killMobs(1 + Math.floor(aliveMobs.length * 0.02), 'boss');
      }
    }

    // Блокируем продвижение толпы, пока босс жив — иначе толпа физически пробегает
    // сквозь него и "бой" сводится к паре кадров контакта.
    if (!this.isDefeated) {
      crowd.leaderZ = Math.min(crowd.leaderZ, this.bossArenaZ - 5.5);
    }
  }

  private executeBossAttack(
    attack: any,
    crowd: CrowdManager,
    particles: ParticleSystem
  ): void {
    if (!this.bossMesh) return;

    if (attack.type === 'slam') {
      soundEngine.playSound('boss_slam');
      eventBus.emit('screenShake', { intensity: 0.6 });
      this.particles.emitShockwave(0, this.bossArenaZ - 4, 0xef4444);
      particles.emitBurst(0, 0.5, this.bossArenaZ - 4, 40, 0xef4444, 8.0);

      // Kill mobs in slam radius unless in Phalanx/Circle formation or Hyper mode.
      // Раньше killMobs(1) вызывался на КАЖДОГО моба в радиусе — 60 мобов в радиусе
      // давали 60 вызовов, каждый с filter+sort по всему массиву (мгновенный вайп + фриз).
      // Считаем число попавших под удар один раз и бьём одним вызовом.
      const radius = attack.areaRadius || 3.5;
      const hitCount = crowd
        .getAliveMobs()
        .reduce((n, mob) => {
          const d = Math.sqrt(mob.x * mob.x + (mob.z - (this.bossArenaZ - 4)) ** 2);
          return d <= radius ? n + 1 : n;
        }, 0);
      if (hitCount > 0) {
        crowd.killMobs(Math.max(1, Math.round(hitCount * 0.35)), 'boss_slam');
      }
    } else if (attack.type === 'laser') {
      soundEngine.playSound('boss_laser');
      eventBus.emit('screenShake', { intensity: 0.4 });
      particles.emitBurst(0, 1.5, this.bossArenaZ - 2, 30, 0x00f0ff, 6.0);
      crowd.killMobs(Math.floor(attack.damage / 3), 'boss_laser');
    } else if (attack.type === 'minions') {
      // Рой мелких тварей: босс призывает рой, который грызёт толпу в течение всей
      // длительности атаки. Урон наносится тиками (каждые ~0.5с), а не одним ударом,
      // чтобы атака читалась как "затяжной урон", а не мгновенный вайп.
      soundEngine.playSound('boss_minions');
      eventBus.emit('screenShake', { intensity: 0.3 });
      particles.emitBurst(0, 1.0, this.bossArenaZ - 3, 25, 0xa855f7, 5.0);
      this.minionTickAccum = 0;
    } else if (attack.type === 'meteors') {
      // Метеоритный залп: серия огненных всплесков по арене перед боссом.
      soundEngine.playSound('boss_laser');
      eventBus.emit('screenShake', { intensity: 0.5 });
      const strikes = attack.areaRadius ? Math.floor(attack.areaRadius) : 3;
      for (let i = 0; i < strikes; i++) {
        const sx = (Math.random() - 0.5) * 8;
        const sz = this.bossArenaZ - 4 - Math.random() * 4;
        particles.emitBurst(sx, 0.6, sz, 22, 0xf97316, 7.0);
      }
      // Урон ограничен безопасной долей от численности отряда, чтобы метеоры
      // не выкашивали всю толпу на поздних уровнях.
      const capped = Math.min(attack.damage, Math.floor(crowd.getAliveCount() * 0.2));
      if (capped > 0) {
        crowd.killMobs(Math.max(1, capped), 'boss_slam');
      }
    } else if (attack.type === 'shield') {
      // Энергетический купол: на время атаки босс блокирует урон толпы.
      soundEngine.playSound('boss_slam');
      eventBus.emit('screenShake', { intensity: 0.3 });
      particles.emitBurst(0, 2.0, this.bossArenaZ, 30, 0x00f0ff, 6.0);
      this.setShielded(true);
    }
  }

  /** Включает/выключает энергетический щит босса (атака "shield"). */
  private setShielded(on: boolean): void {
    this.isShielded = on;
    if (on) {
      if (!this.shieldMesh && this.bossMesh) {
        const shieldGeo = new THREE.SphereGeometry(3.2, 24, 16);
        const shieldMat = new THREE.MeshBasicMaterial({
          color: 0x00f0ff,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        });
        this.shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
        this.shieldMesh.position.set(0, 2.0, this.bossArenaZ);
        this.scene.add(this.shieldMesh);
      }
    } else {
      if (this.shieldMesh) {
        this.scene.remove(this.shieldMesh);
        this.shieldMesh.geometry.dispose();
        (this.shieldMesh.material as THREE.Material).dispose();
        this.shieldMesh = null;
      }
    }
  }

  /** Тикает урон роя мелких тварей во время активной атаки "minions". */
  private tickMinionDamage(dt: number, crowd: CrowdManager, particles: ParticleSystem): void {
    if (!this.bossData || this.isDefeated) return;
    const currentAttack = this.bossData.attacks[this.currentAttackIndex];
    if (currentAttack.type !== 'minions') return;

    this.minionTickAccum += dt;
    const tickInterval = 0.5;
    if (this.minionTickAccum >= tickInterval) {
      this.minionTickAccum = 0;
      // Урон за тик — доля от полного урона атаки, чтобы за всю длительность
      // (обычно 2-3с) суммарный урон был сопоставим с slam/laser.
      const perTick = Math.max(1, Math.round((currentAttack.damage / 3) * tickInterval));
      crowd.killMobs(perTick, 'boss_minions');
      particles.emitBurst(
        (Math.random() - 0.5) * 4,
        0.8 + Math.random(),
        this.bossArenaZ - 3 + (Math.random() - 0.5) * 4,
        8,
        0xa855f7,
        3.0
      );
    }
  }

  public takeDamage(amount: number, particles: ParticleSystem, pierceShield: boolean = false): void {
    if (!this.bossData || this.isDefeated) return;

    // Энергетический купол (атака "shield") блокирует урон толпы. Фаланга (circle)
    // пробивает барьер на 20% от урона (тактическая синергия плотного строя).
    if (this.isShielded) {
      amount = pierceShield ? amount * 0.2 : 0;
    }

    this.bossData.hp = Math.max(0, this.bossData.hp - amount);

    // Фидбек-фикции гейтим ~6 Гц: меле-урон толпы приходит каждый кадр (60 Гц),
    // спам звука/частиц/событий форсировал бы тяжёлый ре-рендер HUD на 60 Гц.
    // HP при этом списывается непрерывно — тормозим только аудио/визуал/эмит.
    this.hitFxAccum -= 1;
    if (this.hitFxAccum > 0) {
      if (this.bossData.hp <= 0) {
        this.defeatBoss(particles);
      }
      return;
    }
    this.hitFxAccum = 10; // ~6 Гц при 60 FPS (60/10)

    soundEngine.playSound('boss_hit');

    if (this.bossMesh) {
      particles.emitBurst(
        (Math.random() - 0.5) * 2,
        2.5 + Math.random(),
        this.bossArenaZ,
        6,
        0xffffff,
        4.0
      );
    }

    eventBus.emit('bossDamaged', {
      hp: this.bossData.hp,
      maxHp: this.bossData.maxHp,
      nameKey: this.bossData.nameKey,
    });

    if (this.bossData.hp <= 0) {
      this.defeatBoss(particles);
    }
  }

  private defeatBoss(particles: ParticleSystem): void {
    this.isDefeated = true;
    soundEngine.playSound('boss_defeat');

    if (this.bossMesh) {
      particles.emitBurst(0, 3.0, this.bossArenaZ, 80, 0xfacc15, 10.0);
      this.scene.remove(this.bossMesh);
    }
    if (this.telegraphMesh) {
      this.scene.remove(this.telegraphMesh);
    }

    stateManager.runRecordBossKill(500, 15);
    eventBus.emit('bossDefeated', { boss: this.bossData });
  }

  public clear(): void {
    if (this.bossMesh) {
      this.scene.remove(this.bossMesh);
      this.bossMesh.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      this.bossMesh = null;
    }
    if (this.telegraphMesh) {
      this.scene.remove(this.telegraphMesh);
      this.telegraphMesh.geometry.dispose();
      (this.telegraphMesh.material as THREE.Material).dispose();
      this.telegraphMesh = null;
    }
    if (this.shieldMesh) {
      this.scene.remove(this.shieldMesh);
      this.shieldMesh.geometry.dispose();
      (this.shieldMesh.material as THREE.Material).dispose();
      this.shieldMesh = null;
    }
    this.isShielded = false;
    this.bossData = null;
    this.isDefeated = false;
    this.isCoolingDown = false;
    this.attackCooldown = 0;
    this.currentAttackIndex = 0;
    this.lastAttackIndex = -1;
  }

  /** Дефолтные веса атак по типу (если не заданы явно в LevelGenerator). */
  private static readonly DEFAULT_ATTACK_WEIGHTS: Record<BossAttack['type'], number> = {
    slam: 30,
    laser: 25,
    minions: 25,
    meteors: 20,
    shield: 15,
  };

  /** Взвешенный случайный выбор следующей атаки без немедленного повтора.
   *  Исключает прошлую атаку (lastAttackIndex) из пула кандидатов, чтобы одна и
   *  та же атака не шла дважды подряд. При n==2 остаётся ровно 1 кандидат —
   *  строгое чередование; при n>=3 — чистый взвешенный выбор по остальным. */
  private selectNextAttackIndex(): number {
    const attacks = this.bossData?.attacks;
    if (!attacks || attacks.length === 0) return 0;
    if (attacks.length === 1) return 0;

    let totalWeight = 0;
    for (let i = 0; i < attacks.length; i++) {
      if (i === this.lastAttackIndex) continue;
      const w = attacks[i].weight ?? BossManager.DEFAULT_ATTACK_WEIGHTS[attacks[i].type] ?? 10;
      totalWeight += Math.max(1, w);
    }

    let rnd = Math.random() * totalWeight;
    for (let i = 0; i < attacks.length; i++) {
      if (i === this.lastAttackIndex) continue;
      const w = Math.max(1, attacks[i].weight ?? BossManager.DEFAULT_ATTACK_WEIGHTS[attacks[i].type] ?? 10);
      rnd -= w;
      if (rnd < 0) return i;
    }
    // Страховка: если rnd не упал ниже нуля (крайний случай), вернуть последний
    // не-исключённый индекс.
    for (let i = 0; i < attacks.length; i++) {
      if (i !== this.lastAttackIndex) return i;
    }
    return 0;
  }
}
