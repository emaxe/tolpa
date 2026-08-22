import * as THREE from 'three';
import { ObstacleData, CoinData } from '../types/game';
import {
  createSawBladeMesh,
  createPendulumAxeMesh,
  createCrusherMesh,
  createLaserGridMesh,
  createSpikeTrapMesh,
} from '../utils/proceduralMeshes';
import { CrowdManager } from './CrowdManager';
import { ParticleSystem } from './ParticleSystem';
import { soundEngine } from '../audio/SoundEngine';
import { eventBus } from '../core/EventBus';
import { stateManager } from '../core/StateManager';
import { checkCircleRectCollision } from '../utils/math';

interface ObstacleVisual {
  data: ObstacleData;
  mesh: THREE.Group;
  animTime: number;
  hitCooldown: number;
}

interface CoinVisual {
  data: CoinData;
  mesh: THREE.Mesh;
}

export class ObstacleManager {
  private scene: THREE.Scene;
  private obstacles: ObstacleVisual[] = [];
  private coins: CoinVisual[] = [];
  private coinGeo: THREE.CylinderGeometry;
  private coinMat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.coinGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.08, 12);
    this.coinMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      metalness: 0.9,
      roughness: 0.1,
      emissive: 0xeab308,
      emissiveIntensity: 0.4,
    });
  }

  private buildObstacleVisual(obs: ObstacleData): ObstacleVisual {
    let mesh: THREE.Group;

    switch (obs.type) {
      case 'saw_blade':
        mesh = createSawBladeMesh();
        break;
      case 'axe_pendulum':
        mesh = createPendulumAxeMesh();
        mesh.position.y = 3.5;
        break;
      case 'crusher':
        mesh = createCrusherMesh();
        break;
      case 'laser_grid':
        mesh = createLaserGridMesh(obs.width);
        break;
      case 'spike_trap':
        mesh = createSpikeTrapMesh();
        break;
      default:
        mesh = createSawBladeMesh();
        break;
    }

    mesh.position.set(obs.x, obs.y || 0.5, obs.z);
    this.scene.add(mesh);

    return { data: obs, mesh, animTime: obs.initialOffset || 0, hitCooldown: 0 };
  }

  public initObstacles(obsData: ObstacleData[], coinData: CoinData[]): void {
    this.clear();
    this.appendObstacles(obsData, coinData);
  }

  /** Добавляет препятствия/монеты к уже существующим, не очищая уровень — для endless-режима. */
  public appendObstacles(obsData: ObstacleData[], coinData: CoinData[]): void {
    obsData.forEach((obs) => {
      this.obstacles.push(this.buildObstacleVisual(obs));
    });

    coinData.forEach((coin) => {
      const mesh = new THREE.Mesh(this.coinGeo, this.coinMat);
      mesh.position.set(coin.x, coin.y, coin.z);
      mesh.rotation.x = Math.PI / 2;
      this.scene.add(mesh);

      this.coins.push({
        data: coin,
        mesh,
      });
    });
  }

  public update(
    dt: number,
    crowd: CrowdManager,
    particles: ParticleSystem
  ): void {
    // 1. Update and animate obstacles
    this.obstacles.forEach((obsVis) => {
      const obs = obsVis.data;
      if (obs.isDead) return;

      if (obsVis.hitCooldown > 0) {
        obsVis.hitCooldown -= dt;
      }

      obsVis.animTime += dt * obs.speed;
      const t = obsVis.animTime;

      switch (obs.type) {
        case 'saw_blade':
          // Rotate blade and move horizontally
          obsVis.mesh.rotation.z += dt * 15;
          obsVis.mesh.position.x = Math.sin(t) * obs.range;
          obs.x = obsVis.mesh.position.x;
          break;

        case 'axe_pendulum':
          // Swing back and forth
          obsVis.mesh.rotation.z = Math.sin(t) * 1.1;
          obs.x = obsVis.mesh.position.x + Math.sin(obsVis.mesh.rotation.z) * 3.0;
          break;

        case 'crusher':
          // Slam up and down
          const slamY = Math.abs(Math.sin(t * 1.5));
          obsVis.mesh.position.y = 0.5 + slamY * 2.0;
          obs.y = obsVis.mesh.position.y;
          break;

        case 'laser_grid':
          // Laser grid remains static or pulses
          break;
      }

      // Check collision with crowd
      if (obsVis.hitCooldown <= 0) {
        this.checkObstacleCollision(obsVis, crowd, particles);
      }
    });

    // 2. Update and check coins
    const crowdLeaderX = crowd.leaderX;
    const crowdLeaderZ = crowd.leaderZ;

    this.coins.forEach((coinVis) => {
      const coin = coinVis.data;
      if (coin.collected) return;

      coinVis.mesh.rotation.z += dt * 4;

      // Distance check to crowd
      const dx = coin.x - crowdLeaderX;
      const dz = coin.z - crowdLeaderZ;
      if (Math.abs(dz) < 2.2 && Math.abs(dx) < 3.5) {
        coin.collected = true;
        this.scene.remove(coinVis.mesh);

        // Double coins if crowd has Ninjas
        const hasNinjas = crowd.getAliveMobs().some((m) => m.type === 'ninja');
        const coinVal = hasNinjas ? coin.value * 2 : coin.value;

        stateManager.runAddCoins(coinVal);
        soundEngine.playSound('coin_pickup');
        particles.emitBurst(coin.x, coin.y, coin.z, 8, 0xfacc15, 3.5);
        eventBus.emit('coinCollected', { value: coinVal, x: coin.x, z: coin.z });
      }
    });
  }

  /**
   * Некоторые препятствия опасны только часть цикла анимации: пресс — только у земли,
   * маятник — только в нижней точке дуги. checkCircleRectCollision работает исключительно
   * в плоскости XZ и не видит высоту, поэтому высоту фильтруем отдельно здесь.
   */
  private isHazardActive(obsVis: ObstacleVisual): boolean {
    const obs = obsVis.data;
    switch (obs.type) {
      case 'crusher':
        return obsVis.mesh.position.y <= 1.2;
      case 'axe_pendulum':
        return Math.abs(obsVis.mesh.rotation.z) < 0.55;
      default:
        return true;
    }
  }

  private checkObstacleCollision(
    obsVis: ObstacleVisual,
    crowd: CrowdManager,
    particles: ParticleSystem
  ): void {
    if (!this.isHazardActive(obsVis)) return;

    const obs = obsVis.data;
    const aliveMobs = crowd.getAliveMobs();

    // If Hyper Mode active or Tank hits destructible obstacle -> smash obstacle!
    const isHyper = crowd.isHyperMode;
    const hasTanks = aliveMobs.some((m) => m.type === 'tank');

    let anyHit = false;
    for (let mob of aliveMobs) {
      if (!mob.alive) continue;

      const hit = checkCircleRectCollision(
        mob.x,
        mob.z,
        0.45 * mob.scale,
        obs.x,
        obs.z,
        obs.width,
        obs.depth
      );

      if (hit) {
        if (isHyper || (obs.destructible && hasTanks)) {
          // Smash obstacle!
          obs.isDead = true;
          this.scene.remove(obsVis.mesh);
          soundEngine.playSound('obstacle_hit');
          particles.emitBurst(obs.x, 1.0, obs.z, 30, 0xf97316, 6.0);
          stateManager.runRecordObstacleSmash();
          eventBus.emit('obstacleSmashed', { type: obs.type });
          break;
        } else {
          // Препятствие уничтожает ВСЕХ человечков, которые его касаются — каждый моб,
          // попавший в зону препятствия, погибает (игнорируя броню/уклонение).
          crowd.killMobById(mob.id);
          particles.emitBurst(mob.x, 0.8, mob.z, 12, 0xef4444, 4.0);
          anyHit = true;
        }
      }
    }

    if (anyHit) {
      obsVis.hitCooldown = 0.8; // Safe cooldown to avoid multi-frame wiping
      soundEngine.playSound('obstacle_hit');
      eventBus.emit('screenShake', { intensity: 0.35 });
    }
  }

  private disposeMeshTree(root: THREE.Object3D): void {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  }

  /** Дистанция до ближайшего живого препятствия впереди — для предупреждения в HUD. -1, если нет. */
  public getNextHazardDistance(fromZ: number): number {
    let closest = -1;
    for (const o of this.obstacles) {
      if (o.data.isDead) continue;
      const d = o.data.z - fromZ;
      if (d > 0 && (closest === -1 || d < closest)) closest = d;
    }
    return closest;
  }

  public clear(): void {
    this.obstacles.forEach((o) => {
      this.scene.remove(o.mesh);
      this.disposeMeshTree(o.mesh);
    });
    this.obstacles = [];

    this.coins.forEach((c) => {
      this.scene.remove(c.mesh);
    });
    this.coins = [];
  }

  public dispose(): void {
    this.clear();
    this.coinGeo.dispose();
    this.coinMat.dispose();
  }
}
