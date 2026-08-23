import * as THREE from 'three';
import { ObstacleData, CoinData } from '../types/game';
import {
  createSawBladeMesh,
  createPendulumAxeMesh,
  createCrusherMesh,
  createLaserGridMesh,
  createSpikeTrapMesh,
  createWreckingBallMesh,
  createLavaPitMesh,
  createBarrierGateMesh,
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
  // Активный "убивающий" хитбокс — фактическая геометрия части препятствия, которая
  // реально убивает (плита шлагбаума, голова маятника, шар крушителя и т.д.).
  // Обновляется каждый кадр в switch update() под анимацию. Коллизия ведётся ТОЛЬКО
  // против этой области, а не против всего статичного бокса препятствия.
  hazardX: number;
  hazardZ: number;
  hazardW: number;
  hazardD: number;
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
      case 'wrecking_ball':
        mesh = createWreckingBallMesh();
        break;
      case 'lava_pit':
        mesh = createLavaPitMesh();
        break;
      case 'barrier_gate':
        mesh = createBarrierGateMesh();
        break;
      default:
        mesh = createSawBladeMesh();
        break;
    }

    mesh.position.set(obs.x, obs.y || 0.5, obs.z);
    this.scene.add(mesh);

    return {
      data: obs,
      mesh,
      animTime: obs.initialOffset || 0,
      // Начальное значение hazard-бокса — по базовым габаритам; каждый кадр update()
      // пересчитывает его под фактическую убивающую часть.
      hazardX: obs.x,
      hazardZ: obs.z,
      hazardW: obs.width,
      hazardD: obs.depth,
    };
  }

  /** Центрирует "убивающий" хитбокс по (x,z) с размером (w,d). Вызывается из update() каждый кадр. */
  private setHazard(vis: ObstacleVisual, x: number, z: number, w: number, d: number): void {
    vis.hazardX = x;
    vis.hazardZ = z;
    vis.hazardW = w;
    vis.hazardD = d;
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

      obsVis.animTime += dt * obs.speed;
      const t = obsVis.animTime;

      switch (obs.type) {
        case 'saw_blade':
          // Диск пилы вращается и ездит по X — убивает только сам диск, а не всё
          // габаритное место. hazard-бокс центрирован по фактической X пилы.
          obsVis.mesh.rotation.z += dt * 15;
          obsVis.mesh.position.x = Math.sin(t) * obs.range;
          obs.x = obsVis.mesh.position.x;
          this.setHazard(obsVis, obs.x, obs.z, 1.7, 1.2);
          break;

        case 'axe_pendulum':
          // Маятник качается; убивающая часть — голова-топор на конце. Её X сдвигается
          // по дуге. Активен только в нижней точке (isHazardActive |rotZ|<0.55).
          obsVis.mesh.rotation.z = Math.sin(t) * 1.1;
          const axeHeadX = obsVis.mesh.position.x + Math.sin(obsVis.mesh.rotation.z) * 3.0;
          obs.x = axeHeadX;
          this.setHazard(obsVis, axeHeadX, obs.z, 1.3, 0.9);
          break;

        case 'crusher':
          // Пресс бьёт вниз; убивает плита, когда она у земли (isHazardActive y<=1.2).
          const slamY = Math.abs(Math.sin(t * 1.5));
          obsVis.mesh.position.y = 0.5 + slamY * 2.0;
          obs.y = obsVis.mesh.position.y;
          this.setHazard(obsVis, obsVis.mesh.position.x, obs.z, obs.width, obs.depth);
          break;

        case 'laser_grid':
          // Лазерная решётка статична, убивает всей своей площадью.
          this.setHazard(obsVis, obs.x, obs.z, obs.width, obs.depth);
          break;

        case 'wrecking_ball':
          // Шар раскачивается поперёк трассы (по X). Убивает ТОЛЬКО сам шар (child 3)
          // — его фактическая X-координата, узкий хитбокс по ширине шара.
          const ball = obsVis.mesh.children[3];
          if (ball) {
            ball.position.x = Math.sin(t) * obs.range;
            obs.x = obsVis.mesh.position.x + ball.position.x;
            this.setHazard(obsVis, obs.x, obs.z, 1.6, 1.6);
          }
          break;

        case 'lava_pit':
          // Лава пульсирует свечением — статична по позиции, убивает площадью.
          const lavaMesh = obsVis.mesh.children[1] as THREE.Mesh;
          if (lavaMesh) {
            const pulse = 0.7 + Math.abs(Math.sin(t * 2)) * 0.3;
            (lavaMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
          }
          this.setHazard(obsVis, obs.x, obs.z, obs.width, obs.depth);
          break;

        case 'barrier_gate':
          // Плита-ворота (child 3) опускается/поднимается. Убивает ТОЛЬКО сама плита:
          // хитбокс — тонкая полоса по ширине плиты (3.3) и малой глубине (0.4),
          // центрируется по позиции группы. isHazardActive фильтрует по высоте плиты:
          // когда плита поднята — она не убивает (толпа проходит под ней), несмотря
          // на то что моб стоит в габарите всей конструкции (стойки/перекладина).
          const barrierGate = obsVis.mesh.children[3] as THREE.Mesh;
          if (barrierGate) {
            const gateY = 1.4 + 1.15 * Math.sin(t * 1.6);
            barrierGate.position.y = gateY;
            const intensity = 0.3 + Math.max(0, 1 - gateY / 2.6) * 0.6;
            (barrierGate.material as THREE.MeshStandardMaterial).emissiveIntensity = intensity;
          }
          this.setHazard(obsVis, obs.x, obs.z, 3.4, 0.45);
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
      case 'barrier_gate':
        // Плита-ворота опасна только когда опущена вниз (мировая Y < ~2.4),
        // когда поднята — толпа проходит под ней.
        const bg = obsVis.mesh.children[3] as THREE.Mesh;
        return bg ? obsVis.mesh.position.y + bg.position.y < 2.4 : true;
      default:
        return true;
    }
  }

  // Разные спецэффекты смерти для каждого типа препятствия: цвет искр, разлёт,
  // вертикальное смещение. Партиклы берутся из общего пула (0-GC), новый объект не создаётся.
  private playDeathEffect(obs: ObstacleData, x: number, y: number, z: number, particles: ParticleSystem): void {
    switch (obs.type) {
      case 'saw_blade':
        // Пылающая пила — оранжево-красные искры разлетаются по горизонтали
        particles.emitBurst(x, y, z, 14, 0xf97316, 5.5, 1.2);
        break;
      case 'axe_pendulum':
        // Маятник — холодные металлические искры, резкий разлёт в сторону
        particles.emitBurst(x, y, z, 12, 0x94a3b8, 6.0, 1.0);
        break;
      case 'crusher':
        // Пресс — сплющивание: искры у земли, красный всплеск
        particles.emitBurst(x, y - 0.3, z, 16, 0xef4444, 3.5, 0.4);
        break;
      case 'laser_grid':
        // Лазер — яркий циановый столб искр вверх
        particles.emitBurst(x, y, z, 14, 0x22d3ee, 6.5, 2.8);
        break;
      case 'spike_trap':
        // Шипы — колючий фиолетовый разброс
        particles.emitBurst(x, y, z, 13, 0xa855f7, 5.0, 1.6);
        break;
      case 'wrecking_ball':
        // Крушащий шар — тяжёлый удар, оранжево-серые искры
        particles.emitBurst(x, y, z, 16, 0xfb923c, 6.0, 0.8);
        break;
      case 'lava_pit':
        // Лава — поднимающиеся вверх оранжевые угли
        particles.emitBurst(x, y, z, 14, 0xea580c, 4.0, 3.0);
        break;
      case 'barrier_gate':
      default:
        // Барьер — белые/желтоватые искры
        particles.emitBurst(x, y, z, 12, 0xfacc15, 4.5, 1.4);
        break;
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

    // Если Hyper Mode активен или есть танки — препятствие можно сломать.
    const isHyper = crowd.isHyperMode;
    const hasTanks = aliveMobs.some((m) => m.type === 'tank');

    let anyHit = false;
    for (let mob of aliveMobs) {
      if (!mob.alive) continue;

      // Коллизия ведётся ТОЛЬКО против активного "убивающего" хитбокса препятствия
      // (плита шлагбаума, голова маятника, шар крушителя), а не против статичного
      // габаритного прямоугольника. Поэтому моб не гибнет при простом прохождении
      // мимо конструкции — только когда касается реально опасной её части.
      const hit = checkCircleRectCollision(
        mob.x,
        mob.z,
        0.45 * mob.scale,
        obsVis.hazardX,
        obsVis.hazardZ,
        obsVis.hazardW,
        obsVis.hazardD
      );

      if (hit) {
        if (isHyper || (obs.destructible && hasTanks)) {
          // Сломать препятствие!
          obs.isDead = true;
          this.scene.remove(obsVis.mesh);
          soundEngine.playSound('obstacle_smash');
          particles.emitBurst(obs.x, 1.0, obs.z, 30, 0xf97316, 6.0);
          stateManager.runRecordObstacleSmash();
          eventBus.emit('obstacleSmashed', { type: obs.type, x: obs.x, z: obs.z });
          break;
        } else {
          // Препятствие уничтожает КАЖДОГО моба, который его касается — в этом же кадре.
          // killMobById помечает моба умирающим (death-анимация) и убирает из живых,
          // поэтому один и тот же моб не погибает дважды, а остальные в этом кадре
          // проверяются независимо и тоже гибнут, если касаются.
          crowd.killMobById(mob.id);
          this.playDeathEffect(obs, mob.x, 0.8, mob.z, particles);
          anyHit = true;
        }
      }
    }

    if (anyHit) {
      // Звук смерти и лёгкая тряска камеры. Никакого hitCooldown — каждый коснувшийся гибнет.
      soundEngine.playSound('mob_death');
      eventBus.emit('screenShake', { intensity: 0.3 });
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
