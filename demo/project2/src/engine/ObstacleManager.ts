import * as THREE from 'three';
import { ObstacleData, CoinData } from '../types/game';
import {
  createSawBladeMesh,
  createPendulumAxeMesh,
  createCrusherMesh,
  createLaserGridMesh,
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

  public initObstacles(obsData: ObstacleData[], coinData: CoinData[]): void {
    this.clear();

    // 1. Obstacles
    obsData.forEach((obs) => {
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
        default:
          mesh = createSawBladeMesh();
          break;
      }

      mesh.position.set(obs.x, obs.y || 0.5, obs.z);
      this.scene.add(mesh);

      this.obstacles.push({
        data: obs,
        mesh,
        animTime: obs.initialOffset || 0,
      });
    });

    // 2. Coins
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
          // Laser pulse
          break;
      }

      // Check collision with crowd
      this.checkObstacleCollision(obsVis, crowd, particles);
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
      if (Math.abs(dz) < 2.0 && Math.abs(dx) < 3.0) {
        coin.collected = true;
        this.scene.remove(coinVis.mesh);
        
        // Double coins if crowd has Ninjas
        const hasNinjas = crowd.getAliveMobs().some((m) => m.type === 'ninja');
        const coinVal = hasNinjas ? coin.value * 2 : coin.value;

        stateManager.addCoins(coinVal);
        soundEngine.playSound('coin_pickup');
        particles.emitBurst(coin.x, coin.y, coin.z, 8, 0xfacc15, 3.5);
        eventBus.emit('coinCollected', { value: coinVal });
      }
    });
  }

  private checkObstacleCollision(
    obsVis: ObstacleVisual,
    crowd: CrowdManager,
    particles: ParticleSystem
  ): void {
    const obs = obsVis.data;
    const aliveMobs = crowd.getAliveMobs();

    // If Hyper Mode active or Tank hits destructible obstacle -> smash obstacle!
    const isHyper = crowd.isHyperMode;
    const hasTanks = aliveMobs.some((m) => m.type === 'tank');

    for (let mob of aliveMobs) {
      if (!mob.alive) continue;

      const hit = checkCircleRectCollision(
        mob.x,
        mob.z,
        0.5,
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
          stateManager.recordObstacleSmash();
          eventBus.emit('obstacleSmashed', { type: obs.type });
          break;
        } else {
          // Hurt crowd! Wedge formation reduces damage
          const formationReduction = crowd.formation === 'wedge' ? 0.6 : 1.0;
          const damage = Math.max(1, Math.round(obs.damage * formationReduction));

          crowd.killMobs(damage, 'obstacle');
          soundEngine.playSound('obstacle_hit');
          particles.emitBurst(mob.x, 0.8, mob.z, 12, 0xef4444, 4.0);
          eventBus.emit('screenShake', { intensity: 0.3 });
          break;
        }
      }
    }
  }

  public clear(): void {
    this.obstacles.forEach((o) => {
      this.scene.remove(o.mesh);
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
