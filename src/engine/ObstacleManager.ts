import * as THREE from 'three';
import { ObstacleData, CoinData, MobInstance } from '../types/game';
import {
  createSawBladeMesh,
  createPendulumAxeMesh,
  createCrusherMesh,
  createLaserGridMesh,
  createSpikeTrapMesh,
  createWreckingBallMesh,
  createLavaPitMesh,
  createBarrierGateMesh,
  createBombMesh,
  createGuardDogMesh,
  createSwingingHammerMesh,
  createRollingSpikeBallMesh,
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
  // Runtime-состояния для новых типов препятствий
  exploded?: boolean;
  attackCooldown?: number;
  subX?: number;
  subZ?: number;
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
      case 'bomb':
        mesh = createBombMesh();
        break;
      case 'guard_dog':
        mesh = createGuardDogMesh();
        break;
      case 'swinging_hammer':
        mesh = createSwingingHammerMesh();
        break;
      case 'rolling_spike_ball':
        mesh = createRollingSpikeBallMesh();
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
      exploded: false,
      attackCooldown: 0,
      subX: obs.x,
      subZ: obs.z,
    };
  }

  /** Центрирует "убивающий" хитбокс по (x,z) с размером (w,d). Вызывается из update() каждый кадр. */
  private setHazard(vis: ObstacleVisual, x: number, z: number, w: number, d: number): void {
    vis.hazardX = x;
    vis.hazardZ = z;
    vis.hazardW = w;
    vis.hazardD = d;
  }

  /**
   * Громкость звука препятствия в зависимости от расстояния до толпы (0..1).
   * - Препятствия ПОЗАДИ толпы (leaderZ уже прошла мимо) → 0 (звука нет).
   * - Впереди в радиусе PROX_RADIUS → громкость растёт линейно с приближением,
   *   максимум при |dz| < 4 (прямо перед толпой).
   * Используется для всех SFX, связанных с препятствиями, чтобы ушедшие за спину
   * объекты не продолжали звучать.
   */
  private proximityVolume(obsZ: number, leaderZ: number): number {
    const dz = obsZ - leaderZ;
    if (dz < -1) return 0; // позади (или вплотную сзади) — тишина
    const PROX_RADIUS = 26;
    if (dz > PROX_RADIUS) return 0;
    const near = 4;
    if (dz <= near) return 1;
    return Math.max(0, Math.min(1, 1 - (dz - near) / (PROX_RADIUS - near)));
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
          // Диск пилы вращается (горизонтальное лезвие, ось Y) и ездит по X —
          // убивает только сам диск, а не всё габаритное место. hazard-бокс
          // центрирован по фактической X пилы.
          obsVis.mesh.children[0].rotation.y += dt * 6;
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

        case 'bomb':
          // Пульсация верхнего диода-маячка (child 0)
          const beacon = obsVis.mesh.children[0] as THREE.Mesh;
          if (beacon && beacon.material instanceof THREE.MeshStandardMaterial) {
            beacon.material.emissiveIntensity = 0.5 + Math.sin(t * 8) * 0.5;
          }
          this.setHazard(obsVis, obs.x, obs.z, obs.width, obs.depth);
          break;

        case 'guard_dog':
          // Кулдаун атаки
          if (obsVis.attackCooldown && obsVis.attackCooldown > 0) {
            obsVis.attackCooldown -= dt;
          }
          // Анимация пасти и движение собаки (child 2 = dogGroup, внутри неё child 3 = jaw)
          const dogGroup = obsVis.mesh.children[2] as THREE.Group;
          if (dogGroup) {
            const jaw = dogGroup.children[3] as THREE.Mesh;
            if (jaw) {
              jaw.rotation.x = Math.sin(t * 6) * 0.25 + 0.15;
            }
            // Патрулирование собаки в пределах радиуса цепи
            const patrolAngle = t * 1.5;
            const patrolRadius = Math.min(obs.range * 0.6, 1.8);
            const dogRelX = Math.cos(patrolAngle) * patrolRadius;
            const dogRelZ = Math.sin(patrolAngle) * patrolRadius;
            dogGroup.position.set(dogRelX, 0, dogRelZ);
            dogGroup.rotation.y = -patrolAngle + Math.PI / 2;

            // Обновление ориентации цепи (child 1)
            const chain = obsVis.mesh.children[1] as THREE.Mesh;
            if (chain) {
              const chainLen = Math.sqrt(dogRelX * dogRelX + dogRelZ * dogRelZ);
              chain.position.set(dogRelX * 0.5, 0.25, dogRelZ * 0.5);
              chain.scale.set(1, Math.max(0.1, chainLen), 1);
              chain.quaternion.setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                new THREE.Vector3(dogRelX, 0.05, dogRelZ).normalize()
              );
            }
          }
          this.setHazard(obsVis, obs.x, obs.z, obs.range * 2, obs.range * 2);
          break;

        case 'swinging_hammer':
          // Качание шарнира бойка (child 4) в плоскости YZ вдоль трассы
          const hammerPivot = obsVis.mesh.children[4] as THREE.Group;
          if (hammerPivot) {
            hammerPivot.rotation.x = Math.sin(t * 1.8) * 1.25;
            const hammerHeadZ = obsVis.mesh.position.z + Math.sin(hammerPivot.rotation.x) * 2.9;
            this.setHazard(obsVis, obs.x, hammerHeadZ, obs.width, 1.8);
          } else {
            this.setHazard(obsVis, obs.x, obs.z, obs.width, 1.8);
          }
          break;

        case 'rolling_spike_ball':
          // Катится навстречу толпе по -Z
          obs.z -= dt * (obs.speed * 2.2);
          obsVis.mesh.position.z = obs.z;
          // Вращение шара (child 0) вокруг оси X
          const ballSpike = obsVis.mesh.children[0] as THREE.Group;
          if (ballSpike) {
            ballSpike.rotation.x -= dt * 8;
          }
          this.setHazard(obsVis, obs.x, obs.z, 2.0, 2.0);
          // Если шар укатился далеко позади толпы — убираем
          if (obs.z < crowd.leaderZ - 25) {
            obs.isDead = true;
            this.scene.remove(obsVis.mesh);
          }
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
      case 'bomb':
        return !obsVis.exploded;
      case 'guard_dog':
        return true;
      case 'swinging_hammer':
        // Молот опасен в нижней точке траектории удара по настилу
        const hammerPivot = obsVis.mesh.children[4] as THREE.Group;
        return hammerPivot ? Math.abs(hammerPivot.rotation.x) < 0.25 : true;
      case 'rolling_spike_ball':
        return true;
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
      case 'bomb':
        // Бомба — яркий огненный взрыв
        particles.emitBurst(x, y, z, 24, 0xff4400, 8.5, 3.0);
        break;
      case 'guard_dog':
        // Кибер-собака — неоново-фиолетовые искры
        particles.emitBurst(x, y, z, 14, 0xa855f7, 5.0, 1.4);
        break;
      case 'swinging_hammer':
        // Молот — золотисто-жёлтый разлёт у земли
        particles.emitBurst(x, y - 0.2, z, 16, 0xfacc15, 5.5, 0.6);
        break;
      case 'rolling_spike_ball':
        // Катящийся шар — оранжево-металлические искры
        particles.emitBurst(x, y, z, 16, 0xf59e0b, 6.0, 1.0);
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

    // Громкость звуков препятствия зависит от расстояния до толпы:
    // позади толпы (уже пройдено) — тишина, впереди — растёт с приближением.
    const vol = this.proximityVolume(obs.z, crowd.leaderZ);

    // Кастомная обработка для бомбы (AoE детонация)
    if (obs.type === 'bomb') {
      this.resolveBomb(obsVis, crowd, particles, vol);
      return;
    }

    // Кастомная обработка для кибер-собаки (атака 1 моба с кулдауном)
    if (obs.type === 'guard_dog') {
      this.resolveDog(obsVis, crowd, particles, vol);
      return;
    }

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
          if (vol > 0) soundEngine.playSound('obstacle_smash', 1, vol);
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
      if (vol > 0) soundEngine.playSound('mob_death', 1, vol);
      eventBus.emit('screenShake', { intensity: 0.3 });
    }
  }

  private resolveBomb(
    vis: ObstacleVisual,
    crowd: CrowdManager,
    particles: ParticleSystem,
    vol: number
  ): void {
    if (vis.exploded || vis.data.isDead) return;
    const obs = vis.data;
    const r = obs.range;
    const rSq = r * r;
    const alive = crowd.getAliveMobs();
    if (alive.length === 0) return;

    // Hyper / Танки обезвреживают мину без потерь
    const isHyper = crowd.isHyperMode;
    const hasTanks = alive.some((m) => m.type === 'tank');
    if (isHyper || (obs.destructible && hasTanks)) {
      let touched = false;
      for (const m of alive) {
        if (!m.alive) continue;
        const dx = m.x - obs.x;
        const dz = m.z - obs.z;
        if (dx * dx + dz * dz <= rSq) {
          touched = true;
          break;
        }
      }
      if (touched) {
        obs.isDead = true;
        vis.exploded = true;
        this.scene.remove(vis.mesh);
        if (vol > 0) soundEngine.playSound('obstacle_smash', 1, vol);
        particles.emitBurst(obs.x, 1.0, obs.z, 35, 0xf97316, 6.5);
        stateManager.runRecordObstacleSmash();
        eventBus.emit('obstacleSmashed', { type: obs.type, x: obs.x, z: obs.z });
      }
      return;
    }

    // Проверяем, коснулся ли хоть один живой моб зоны взрыва
    let triggered = false;
    for (const m of alive) {
      if (!m.alive) continue;
      const dx = m.x - obs.x;
      const dz = m.z - obs.z;
      if (dx * dx + dz * dz <= rSq) {
        triggered = true;
        break;
      }
    }
    if (!triggered) return;

    // Взрыв мины: детонирует один раз, уничтожает всех живых мобов в радиусе
    vis.exploded = true;
    obs.isDead = true;
    this.scene.remove(vis.mesh);

    if (vol > 0) soundEngine.playSound('bomb_explode', 1, vol);
    particles.emitBurst(obs.x, 1.0, obs.z, 50, 0xff4400, 8.5, 3.0);
    eventBus.emit('screenShake', { intensity: 0.7 });

    for (const m of alive) {
      if (!m.alive) continue;
      const dx = m.x - obs.x;
      const dz = m.z - obs.z;
      if (dx * dx + dz * dz <= rSq) {
        crowd.killMobById(m.id);
        this.playDeathEffect(obs, m.x, 0.8, m.z, particles);
      }
    }
  }

  private resolveDog(
    vis: ObstacleVisual,
    crowd: CrowdManager,
    particles: ParticleSystem,
    vol: number
  ): void {
    if (vis.data.isDead) return;
    const obs = vis.data;
    const r = obs.range;
    const rSq = r * r;
    const alive = crowd.getAliveMobs();
    if (alive.length === 0) return;

    // Танки / гипер уничтожают кибер-собаку
    const isHyper = crowd.isHyperMode;
    const hasTanks = alive.some((m) => m.type === 'tank');
    if (isHyper || (obs.destructible && hasTanks)) {
      let touched = false;
      for (const m of alive) {
        if (!m.alive) continue;
        const dx = m.x - obs.x;
        const dz = m.z - obs.z;
        if (dx * dx + dz * dz <= rSq) {
          touched = true;
          break;
        }
      }
      if (touched) {
        obs.isDead = true;
        this.scene.remove(vis.mesh);
        if (vol > 0) soundEngine.playSound('obstacle_smash', 1, vol);
        particles.emitBurst(obs.x, 1.0, obs.z, 30, 0xa855f7, 6.0);
        stateManager.runRecordObstacleSmash();
        eventBus.emit('obstacleSmashed', { type: obs.type, x: obs.x, z: obs.z });
        return;
      }
    }

    if (vis.attackCooldown && vis.attackCooldown > 0) return;

    // Поиск ближайшего живого моба в радиусе цепи
    let nearest: MobInstance | null = null;
    let bestDistSq = 1e9;
    for (const m of alive) {
      if (!m.alive) continue;
      const dx = m.x - obs.x;
      const dz = m.z - obs.z;
      const dSq = dx * dx + dz * dz;
      if (dSq <= rSq && dSq < bestDistSq) {
        bestDistSq = dSq;
        nearest = m;
      }
    }

    if (!nearest) return;

    // Атака строго одного моба с кулдауном
    crowd.killMobById(nearest.id);
    vis.attackCooldown = 0.9;
    this.playDeathEffect(obs, nearest.x, 0.8, nearest.z, particles);
    if (vol > 0) soundEngine.playSound('dog_snap', 1, vol);
    eventBus.emit('screenShake', { intensity: 0.25 });
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
