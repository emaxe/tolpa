import * as THREE from 'three';
import { BossData } from '../types/game';
import { createBossMesh } from '../utils/proceduralMeshes';
import { CrowdManager } from './CrowdManager';
import { ParticleSystem } from './ParticleSystem';
import { soundEngine } from '../audio/SoundEngine';
import { eventBus } from '../core/EventBus';
import { stateManager } from '../core/StateManager';

export class BossManager {
  private scene: THREE.Scene;
  public bossData: BossData | null = null;
  public bossMesh: THREE.Group | null = null;
  private telegraphMesh: THREE.Mesh | null = null;
  private attackTimer: number = 0;
  private currentAttackIndex: number = 0;
  private isAttacking: boolean = false;
  public isDefeated: boolean = false;
  private bossArenaZ: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public initBoss(bossData: BossData, arenaZ: number): void {
    this.clear();
    this.bossData = { ...bossData, hp: bossData.maxHp };
    this.bossArenaZ = arenaZ;
    this.isDefeated = false;
    this.attackTimer = 0;
    this.currentAttackIndex = 0;

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

    // 1. Attack cycle
    this.attackTimer += dt;
    const attacks = this.bossData.attacks;
    const currentAttack = attacks[this.currentAttackIndex % attacks.length];

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
      if (this.attackTimer >= currentAttack.duration) {
        this.isAttacking = false;
        this.attackTimer = 0;
        this.currentAttackIndex++;
        if (this.telegraphMesh) {
          (this.telegraphMesh.material as THREE.MeshBasicMaterial).opacity = 0;
        }
      }
    }

    // 2. Crowd attacks boss on close contact
    if (distanceToArena <= 6) {
      const aliveMobs = crowd.getAliveMobs();
      const crowdPower = aliveMobs.length * dt * 35; // Damage scales with crowd size

      this.takeDamage(crowdPower, particles);

      // Boss retaliation
      if (Math.random() < 0.08) {
        crowd.killMobs(1, 'boss');
      }
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
      particles.emitBurst(0, 0.5, this.bossArenaZ - 4, 40, 0xef4444, 8.0);

      // Kill mobs in slam radius unless in Phalanx/Circle formation or Hyper mode
      const aliveMobs = crowd.getAliveMobs();
      aliveMobs.forEach((mob) => {
        const d = Math.sqrt(mob.x * mob.x + (mob.z - (this.bossArenaZ - 4)) ** 2);
        if (d <= (attack.areaRadius || 3.5)) {
          crowd.killMobs(1, 'boss_slam');
        }
      });
    } else if (attack.type === 'laser') {
      soundEngine.playSound('boss_laser');
      eventBus.emit('screenShake', { intensity: 0.4 });
      particles.emitBurst(0, 1.5, this.bossArenaZ - 2, 30, 0x00f0ff, 6.0);
      crowd.killMobs(Math.floor(attack.damage / 3), 'boss_laser');
    }
  }

  public takeDamage(amount: number, particles: ParticleSystem): void {
    if (!this.bossData || this.isDefeated) return;

    this.bossData.hp = Math.max(0, this.bossData.hp - amount);
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

    stateManager.recordBossKill();
    stateManager.addCoins(500);
    stateManager.addGems(15);
    eventBus.emit('bossDefeated', { boss: this.bossData });
  }

  public clear(): void {
    if (this.bossMesh) {
      this.scene.remove(this.bossMesh);
      this.bossMesh = null;
    }
    if (this.telegraphMesh) {
      this.scene.remove(this.telegraphMesh);
      this.telegraphMesh = null;
    }
    this.bossData = null;
    this.isDefeated = false;
  }
}
