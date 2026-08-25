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
import { clamp, checkCircleRectCollision, circleRectGap, getNearMissMultiplier } from '../utils/math';
import { DEFAULT_TRACK_WIDTH } from './LevelGenerator';

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
  // Состояние кибер-собаки: свободное гуляние / отдых / атака.
  dogState?: 'wander' | 'idle' | 'attack';
  // Текущая целевая точка блуждания (локальные координаты вокруг анкера).
  dogTargetX?: number;
  dogTargetZ?: number;
  dogStateTime?: number; // сколько времени в текущем состоянии
  dogAnimPhase?: number; // фаза анимации шага/хвоста
  dogFacing?: number; // куда повёрнута собака (радианы, мировой Y)
  dogLungeT?: number; // прогресс броска при атаке (0..1), -1 когда не атакует
  // One-shot флаг удара гидравлического молота (звук hammer_impact играет один раз
  // за проход бойка через нижнюю точку, а не каждый кадр).
  hammerImpacted?: boolean;
  // Near-Miss (уворот в упор): one-shot флаг награды за проход вплотную к активной
  // ловушке без касания + последняя Z-позиция лидера для детекта пересечения плоскости.
  nearMissAwarded?: boolean;
  lastLeaderZ?: number;
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
  private _vUp = new THREE.Vector3(0, 1, 0);
  private _vDir = new THREE.Vector3();

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
        // Меш сам стоит на полу (локальный y=0 = пол); рама поднимается
        // до перекладины PIVOT_Y, маятник свисает с неё.
        mesh = createPendulumAxeMesh();
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
      // Кибер-собака стартует в состоянии «гуляет» с текущей целевой точкой.
      dogState: 'wander',
      dogTargetX: (Math.random() - 0.5) * 1.5,
      dogTargetZ: (Math.random() - 0.5) * 1.5,
      dogStateTime: 0,
      dogAnimPhase: Math.random() * Math.PI * 2,
      dogFacing: Math.random() * Math.PI * 2,
      dogLungeT: -1,
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

  /**
   * Кибер-собака: свободно гуляет по доступному радиусу вокруг анкера,
   * периодически останавливается отдохнуть (сидит/лежит) и, когда толпа
   * входит в радиус, бросается в атаку (рывок + укус). Вместо прежнего
   * «пропеллерного» кружения по синусу — реалистичное поведение с анимацией.
   * Структура dogGroup (children[2] у группы препятствия):
   *   [0] body, [1] headPivot (внутри head, eyes, jaw), [2..5] лапы,
   *   [6] tailPivot, [7] stripeL, [8] stripeR.
   */
  private updateGuardDog(
    vis: ObstacleVisual,
    crowd: CrowdManager,
    dt: number,
    aliveMobs: MobInstance[]
  ): void {
    const obs = vis.data;

    // Кулдаун между укусами
    if (vis.attackCooldown && vis.attackCooldown > 0) {
      vis.attackCooldown -= dt;
    }

    const dogGroup = vis.mesh.children[2] as THREE.Group;
    if (!dogGroup) {
      this.setHazard(vis, obs.x, obs.z, obs.range * 2, obs.range * 2);
      return;
    }

    // Позиция собаки (смещена от анкера — она свободно гуляет).
    const dogX = obs.x + dogGroup.position.x;
    const dogZ = obs.z + dogGroup.position.z;

    // Радиус атаки от собаки: цепь тянется до obs.range, плюс запас на саму собаку.
    const attackRange = obs.range + 1.2;

    // ---- 1. Определяем целевое состояние на кадр ----
    // Цель — ближайший живой моб в радиусе атаки ОТ ПОЗИЦИИ СОБАКИ (не анкера).
    let nearestMob: MobInstance | null = null;
    let bestSq = 1e9;
    for (const m of aliveMobs) {
      if (!m.alive) continue;
      const dx = m.x - dogX;
      const dz = m.z - dogZ;
      const dSq = dx * dx + dz * dz;
      if (dSq <= attackRange * attackRange && dSq < bestSq) {
        bestSq = dSq;
        nearestMob = m;
      }
    }

    // Скорость атаки: attackRate (1..3 моб/сек) или 1 по умолчанию. Кулдаун между укусами.
    const attackRate = obs.attackRate ?? 1;
    const biteCooldown = 1 / attackRate;

    // Атака активна, пока есть цель в радиусе — независимо от кулдауна укуса
    // (кулдаун только замедляет укусы, но собака продолжает преследовать).
    const attacking = !!nearestMob;
    vis.dogStateTime = (vis.dogStateTime || 0) + dt;

    if (attacking) {
      vis.dogState = 'attack';
    } else if (vis.dogState === 'attack') {
      // Атака закончилась (цель вышла из радиуса) → возврат к гулянию/отдыху.
      // Кулдаун задаётся скоростью атаки, чтобы собака не кусала мгновенно.
      vis.dogState = 'wander';
      vis.dogStateTime = 0;
      vis.dogLungeT = -1;
      // новая случайная цель
      vis.dogTargetX = (Math.random() - 0.5) * obs.range * 1.5;
      vis.dogTargetZ = (Math.random() - 0.5) * obs.range * 1.5;
    } else if (vis.dogState === 'wander') {
      // Периодически останавливаемся отдохнуть (сидим/лежим ~2-3с)
      if (vis.dogStateTime > 4 + Math.random() * 2) {
        vis.dogState = 'idle';
        vis.dogStateTime = 0;
      }
    } else if (vis.dogState === 'idle') {
      if (vis.dogStateTime > 2 + Math.random() * 1.5) {
        vis.dogState = 'wander';
        vis.dogStateTime = 0;
        vis.dogTargetX = (Math.random() - 0.5) * obs.range * 1.5;
        vis.dogTargetZ = (Math.random() - 0.5) * obs.range * 1.5;
      }
    }

    // ---- 2. Атака: рывок-преследование к ближайшему мобу ----
    if (vis.dogState === 'attack' && nearestMob) {
      // Направление к цели (мировые координаты) в локальном радиусе от анкера.
      const tx = nearestMob.x - obs.x;
      const tz = nearestMob.z - obs.z;
      const dist = Math.sqrt(tx * tx + tz * tz) || 1;
      // Рывок: бежим к цели, но не выходим за длину цепи (obs.range) от анкера.
      const reach = Math.min(dist, obs.range * 0.95);
      const speed = 5.0;
      const step = Math.min(speed * dt, dist);
      // Плавно двигаемся к точке у цели (не телепортом).
      const dirX = tx / dist;
      const dirZ = tz / dist;
      let newRelX = dogGroup.position.x + dirX * step;
      let newRelZ = dogGroup.position.z + dirZ * step;
      // Ограничение цепью: локальный радиус вокруг анкера не превышает obs.range.
      const chainLen = Math.sqrt(newRelX * newRelX + newRelZ * newRelZ);
      if (chainLen > obs.range) {
        newRelX = (newRelX / chainLen) * obs.range;
        newRelZ = (newRelZ / chainLen) * obs.range;
      }
      dogGroup.position.set(newRelX, 0, newRelZ);
      vis.dogFacing = Math.atan2(tx, tz);
      dogGroup.rotation.y = vis.dogFacing;
      vis.dogAnimPhase = (vis.dogAnimPhase || 0) + dt * 14; // быстрый перебор лап при беге
      // Укус происходит в resolveDog (механика там); здесь только визуал.
    } else if (vis.dogState === 'wander') {
      // Двигаемся к цели гулять
      const gx = vis.dogTargetX ?? 0;
      const gz = vis.dogTargetZ ?? 0;
      const dxg = gx - dogGroup.position.x;
      const dzg = gz - dogGroup.position.z;
      const dg = Math.sqrt(dxg * dxg + dzg * dzg);
      const speed = 1.6;
      if (dg < 0.25) {
        // дошли до цели — берём новую случайную в радиусе
        vis.dogTargetX = (Math.random() - 0.5) * obs.range * 1.5;
        vis.dogTargetZ = (Math.random() - 0.5) * obs.range * 1.5;
      } else {
        const step = Math.min(speed * dt, dg);
        dogGroup.position.x += (dxg / dg) * step;
        dogGroup.position.z += (dzg / dg) * step;
        vis.dogFacing = Math.atan2(dxg, dzg);
        dogGroup.rotation.y = vis.dogFacing;
      }
      vis.dogAnimPhase = (vis.dogAnimPhase || 0) + dt * 9; // шаг
    } else {
      // idle: стоим / присаживаемся
      vis.dogAnimPhase = 0;
    }

    // ---- 3. Анимация частей собаки ----
    const body = dogGroup.children[0] as THREE.Mesh;
    const headPivot = dogGroup.children[1] as THREE.Group;
    const tailPivot = dogGroup.children[6] as THREE.Group;
    const legPivots = [
      dogGroup.children[2] as THREE.Group,
      dogGroup.children[3] as THREE.Group,
      dogGroup.children[4] as THREE.Group,
      dogGroup.children[5] as THREE.Group,
    ];
    const phase = vis.dogAnimPhase || 0;

    // Пасть: открывается в атаке (нужно разжать нижнюю челюсть)
    const jaw = headPivot ? headPivot.children[2] as THREE.Mesh : null;

    if (vis.dogState === 'attack') {
      // Атака: тело наклонено вперёд, пасть открыта, хвост прижат, уши назад
      if (body) body.rotation.x = 0.35;
      if (headPivot) headPivot.rotation.x = -0.5;
      if (jaw) jaw.rotation.x = 0.7; // раскрытая пасть
      if (tailPivot) tailPivot.rotation.y = 0.6; // прижатый хвост
      // Ноги в прыжке согнуты
      legPivots.forEach((lp) => { if (lp) lp.rotation.x = 0.4 * Math.sin(phase); });
    } else if (vis.dogState === 'wander') {
      // Гуляние: перебор лап (противофаза перед/зад), хвост виляет, голова чуть покачивается
      if (body) body.rotation.x = 0.05 * Math.sin(phase * 0.5);
      if (headPivot) headPivot.rotation.x = 0.15 + 0.1 * Math.sin(phase * 0.7);
      if (jaw) jaw.rotation.x = 0.08;
      if (tailPivot) tailPivot.rotation.y = Math.sin(phase * 0.8) * 0.6;
      // шаг: передние и задние противофазно
      const stepAmp = 0.5;
      legPivots.forEach((L, i) => {
        if (!L) return;
        const side = i % 2 === 0 ? 1 : -1;
        const front = i < 2 ? 1 : -1;
        L.rotation.x = Math.sin(phase + front * Math.PI / 2) * stepAmp * side;
      });
    } else {
      // Idle/отдых: собака сидит — зад опущен, корпус наклонён, передние лапы
      // прямые, задние подогнуты, голова приподнята, хвост лениво виляет.
      if (body) body.rotation.x = 0.35; // сидя: грудью вверх
      if (headPivot) headPivot.rotation.x = -0.1 + 0.05 * Math.sin(performance.now() * 0.001 * 1.2);
      if (jaw) jaw.rotation.x = 0.05;
      if (tailPivot) tailPivot.rotation.y = Math.sin(performance.now() * 0.001 * 2.5) * 0.3;
      // Передние лапы (i<2) прямые вниз, задние (i>=2) подогнуты под корпус.
      legPivots.forEach((L, i) => {
        if (!L) return;
        L.rotation.x = i >= 2 ? -1.1 : 0.05; // задние согнуты, передние стоят
      });
    }

    // ---- 4. Цепь ----
    const chain = vis.mesh.children[1] as THREE.Mesh;
    if (chain) {
      const dogX = dogGroup.position.x;
      const dogZ = dogGroup.position.z;
      const len = Math.sqrt(dogX * dogX + dogZ * dogZ);
      chain.position.set(dogX * 0.5, 0.25, dogZ * 0.5);
      chain.scale.set(1, Math.max(0.1, len), 1);
      this._vDir.set(dogX, 0.05, dogZ).normalize();
      chain.quaternion.setFromUnitVectors(this._vUp, this._vDir);
    }

    // Hazard: зона атаки вокруг собаки (смещённая), не статика анкера
    this.setHazard(vis, obs.x + dogGroup.position.x, obs.z + dogGroup.position.z, obs.range * 1.6, obs.range * 1.6);
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
    const aliveMobs = crowd.getAliveMobs();

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
          // Полный свип от борта до борта: база x + размах range, не выходим за трассу.
          const baseSawX = obsVis.subX ?? 0;
          const trackHalfWidth = DEFAULT_TRACK_WIDTH / 2;
          obsVis.mesh.position.x = clamp(
            baseSawX + Math.sin(t) * obs.range,
            -(trackHalfWidth - 1.0),
            +(trackHalfWidth - 1.0)
          );
          obs.x = obsVis.mesh.position.x;
          this.setHazard(obsVis, obs.x, obs.z, 1.7, 1.2);
          break;

        case 'axe_pendulum':
          // Маятник качается; убивающая часть — голова-топор на конце. Её X сдвигается
          // по дуге. Активен только в нижней точке (isHazardActive |rotZ|<0.55).
          // Вращаем ТОЛЬКО подгруппу качания (children[0]) — неподвижная П-рама
          // (перекладина + стойки) остаётся на месте.
          obsVis.mesh.children[0].rotation.z = Math.sin(t) * 1.1;
          const swingZ = obsVis.mesh.children[0].rotation.z;
          const axeHeadX = obsVis.mesh.position.x + Math.sin(swingZ) * 3.0;
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
          this.updateGuardDog(obsVis, crowd, dt, aliveMobs);
          break;

        case 'swinging_hammer':
          // Качание шарнира бойка (child 4) в плоскости YZ вдоль трассы
          const hammerPivot = obsVis.mesh.children[4] as THREE.Group;
          if (hammerPivot) {
            hammerPivot.rotation.x = Math.sin(t * 1.8) * 1.25;
            const hammerHeadZ = obsVis.mesh.position.z + Math.sin(hammerPivot.rotation.x) * 2.9;
            this.setHazard(obsVis, obs.x, hammerHeadZ, obs.width, 1.8);

            // Звук удара молота по наковальне: голова в нижней точке, когда rotation.x
            // проходит через 0. One-shot флаг + гистерезис — звук играет один раз за
            // проход через нижнюю точку, а не каждый кадр.
            if (Math.abs(hammerPivot.rotation.x) < 0.15) {
              if (!obsVis.hammerImpacted) {
                obsVis.hammerImpacted = true;
                const vol = this.proximityVolume(obs.z, crowd.leaderZ);
                if (vol > 0) soundEngine.playSound('hammer_impact', 1, vol);
              }
            } else if (Math.abs(hammerPivot.rotation.x) > 0.3) {
              obsVis.hammerImpacted = false;
            }
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

      // Ранний выход: препятствия далеко от толпы не проверяем на коллизии (CPU hot-path).
      const dz = obs.z - crowd.leaderZ;
      if (dz > 10 || dz < -25) return;

      // Check collision with crowd
      this.checkObstacleCollision(obsVis, crowd, particles, aliveMobs);
      // Near-Miss: награда за проход вплотную к активной ловушке без касания.
      this.checkNearMiss(obsVis, crowd, particles);
    });
    // 2. Update and check coins
    const crowdLeaderX = crowd.leaderX;
    const crowdLeaderZ = crowd.leaderZ;

    this.coins.forEach((coinVis) => {
      const coin = coinVis.data;
      if (coin.collected) return;

      coinVis.mesh.rotation.z += dt * 4;

      // Distance check to crowd. Шеренга (wide) расширяет окно сбора монет по X.
      const dx = coin.x - crowdLeaderX;
      const dz = coin.z - crowdLeaderZ;
      const reachX = crowd.formation === 'wide' ? 5.5 : 3.5;
      if (Math.abs(dz) < 2.2 && Math.abs(dx) < reachX) {
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
        return Math.abs(obsVis.mesh.children[0].rotation.z) < 0.55;
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
    particles: ParticleSystem,
    aliveMobs: MobInstance[]
  ): void {
    if (!this.isHazardActive(obsVis)) return;

    const obs = obsVis.data;

    // Громкость звуков препятствия зависит от расстояния до толпы:
    // позади толпы (уже пройдено) — тишина, впереди — растёт с приближением.
    const vol = this.proximityVolume(obs.z, crowd.leaderZ);

    // Кастомная обработка для бомбы (AoE детонация)
    if (obs.type === 'bomb') {
      this.resolveBomb(obsVis, crowd, particles, vol, aliveMobs);
      return;
    }

    // Кастомная обработка для кибер-собаки (атака 1 моба с кулдауном)
    if (obs.type === 'guard_dog') {
      this.resolveDog(obsVis, crowd, particles, vol, aliveMobs);
      return;
    }

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
        if (isHyper || (obs.destructible && hasTanks) || crowd.canRamObstacles()) {
          // Сломать препятствие! Фаланга (circle) с достаточной толпой таранит ловушку
          // силой массы — теряет лишь 1 бойца вместо уничтожения всех коснувшихся.
          if (crowd.canRamObstacles() && !isHyper && !(obs.destructible && hasTanks)) {
            crowd.killMobs(1, 'obstacle');
          }
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
      // Металлический лязг удара об ловушку (отличается от гейт-урона mob_death)
      // и лёгкая тряска камеры. Никакого hitCooldown — каждый коснувшийся гибнет.
      if (vol > 0) soundEngine.playSound('obstacle_hit', 1, vol);
      if (vol > 0) soundEngine.playSound('mob_death', 1, vol);
      eventBus.emit('screenShake', { intensity: 0.3 });
      // Толпа понесла урон от ловушки — серия уворотов сбрасывается.
      stateManager.runResetNearMissStreak();
    }
  }

  // Near-Miss (уворот в упор): награда за проход лидера вплотную к АКТИВНОЙ ловушке
  // без касания. Детект по пересечению плоскости Z препятствия (один замер на ловушку),
  // зазор считается чистой функцией circleRectGap. Полноширинные ловушки (laser_grid,
  // lava_pit, широкие spike_trap) дают gap<=0 — награды нет. 0 аллокаций в горячем цикле.
  private checkNearMiss(
    obsVis: ObstacleVisual,
    crowd: CrowdManager,
    particles: ParticleSystem
  ): void {
    const obs = obsVis.data;
    const rz = obs.z;
    const lz = crowd.leaderZ;

    // Сброс, пока ловушка неактивна/уничтожена или уже позади — чтобы следующий
    // проход (например, у качающегося маятника) мог снова дать награду.
    if (obs.isDead || !this.isHazardActive(obsVis)) {
      obsVis.nearMissAwarded = false;
      obsVis.lastLeaderZ = lz;
      return;
    }

    const prev = obsVis.lastLeaderZ ?? rz - 1000;
    // Фиксируем момент пересечения плоскости Z лидером = один замер на препятствие.
    if (prev < rz && lz >= rz && !obsVis.nearMissAwarded) {
      const gap = circleRectGap(
        crowd.leaderX,
        rz,
        0.3, // радиус лидера
        obsVis.hazardX,
        obsVis.hazardZ,
        obsVis.hazardW,
        obsVis.hazardD
      );
      // Прошёл в зазоре (0..0.35 м от края активного хитбокса), не коснувшись.
      if (gap >= 0 && gap <= 0.35) {
        obsVis.nearMissAwarded = true;
        // Серия уворотов: инкремент + множитель награды (x1/x2/x5/x10).
        const { streak, multiplier } = stateManager.runRecordNearMissStreak();
        const coins = 8 * multiplier;
        stateManager.runAddCoins(coins);
        // Эскалация звука по уровню серии (pitch выше на каждом увороте).
        soundEngine.playSound('near_miss', 1.0 + Math.min(1.0, streak * 0.05));
        // Эскалация визуального фидбека: больше частиц и ярче цвет на высоких сериях.
        const count = multiplier >= 10 ? 36 : multiplier >= 5 ? 26 : multiplier >= 2 ? 18 : 10;
        const color = multiplier >= 10 ? 0xfacc15 : multiplier >= 5 ? 0xa855f7 : multiplier >= 2 ? 0x00f0ff : 0x38bdf8;
        particles.emitBurst(obsVis.hazardX, 1.2, rz, count, color, 3.0 + multiplier * 0.2);
        eventBus.emit('nearMiss', { x: obsVis.hazardX, z: rz, coins, streak, multiplier });
      } else if (gap > 0.35 && gap <= 2.2) {
        // Безопасный объезд в той же полосе (0.35..2.2 м от хитбокса) — игрок не
        // рискнул, серия уворотов сбрасывается. Полноширинные ловушки (gap <= 0)
        // серию НЕ ломают — там награда невозможна в принципе.
        obsVis.nearMissAwarded = true;
        stateManager.runResetNearMissStreak();
      }
    }
    obsVis.lastLeaderZ = lz;
  }

  private resolveBomb(
    vis: ObstacleVisual,
    crowd: CrowdManager,
    particles: ParticleSystem,
    vol: number,
    aliveMobs: MobInstance[]
  ): void {
    if (vis.exploded || vis.data.isDead) return;
    const obs = vis.data;
    const r = obs.range;
    const rSq = r * r;
    if (aliveMobs.length === 0) return;

    // Hyper / Танки обезвреживают мину без потерь
    const isHyper = crowd.isHyperMode;
    const hasTanks = aliveMobs.some((m) => m.type === 'tank');
    if (isHyper || (obs.destructible && hasTanks)) {
      let touched = false;
      for (const m of aliveMobs) {
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
    for (const m of aliveMobs) {
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

    for (const m of aliveMobs) {
      if (!m.alive) continue;
      const dx = m.x - obs.x;
      const dz = m.z - obs.z;
      if (dx * dx + dz * dz <= rSq) {
        crowd.killMobById(m.id);
        this.playDeathEffect(obs, m.x, 0.8, m.z, particles);
      }
    }
    // Взрыв мины убил мобов — серия уворотов сбрасывается.
    stateManager.runResetNearMissStreak();
  }

  private resolveDog(
    vis: ObstacleVisual,
    crowd: CrowdManager,
    particles: ParticleSystem,
    vol: number,
    aliveMobs: MobInstance[]
  ): void {
    if (vis.data.isDead) return;
    const obs = vis.data;
    // Радиус укуса чуть больше длины цепи, чтобы собака реально доставала моба.
    const r = obs.range + 0.8;
    const rSq = r * r;
    if (aliveMobs.length === 0) return;

    // Танки / гипер уничтожают кибер-собаку
    const isHyper = crowd.isHyperMode;
    const hasTanks = aliveMobs.some((m) => m.type === 'tank');
    if (isHyper || (obs.destructible && hasTanks)) {
      let touched = false;
      for (const m of aliveMobs) {
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

    // Позиция собаки (смещена от анкера — она гуляет в радиусе). Укус происходит
    // от текущего местоположения собаки, а не от статичного анкера.
    const dogGroup = vis.mesh.children[2] as THREE.Group | undefined;
    const dogX = obs.x + (dogGroup ? dogGroup.position.x : 0);
    const dogZ = obs.z + (dogGroup ? dogGroup.position.z : 0);

    // Поиск ближайшего живого моба в радиусе укуса (вокруг собаки)
    let nearest: MobInstance | null = null;
    let bestDistSq = 1e9;
    for (const m of aliveMobs) {
      if (!m.alive) continue;
      const dx = m.x - dogX;
      const dz = m.z - dogZ;
      const dSq = dx * dx + dz * dz;
      if (dSq <= rSq && dSq < bestDistSq) {
        bestDistSq = dSq;
        nearest = m;
      }
    }

    if (!nearest) return;

    // Укус: убиваем одного моба. Кулдаун = 1/attackRate (1..3 моб/сек),
    // т.е. при attackRate=1 — раз в сек, при 3 — до трёх раз в сек.
    crowd.killMobById(nearest.id);
    vis.attackCooldown = 1 / (obs.attackRate ?? 1);
    this.playDeathEffect(obs, nearest.x, 0.8, nearest.z, particles);
    if (vol > 0) soundEngine.playSound('dog_snap', 1, vol);
    eventBus.emit('screenShake', { intensity: 0.25 });
    // Собака укусила моба — серия уворотов сбрасывается.
    stateManager.runResetNearMissStreak();
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

  /** Текущая длина серии уворотов в упор (для HUD-индикатора). */
  public getNearMissStreak(): number {
    return stateManager.getNearMissStreak();
  }

  public dispose(): void {
    this.clear();
    this.coinGeo.dispose();
    this.coinMat.dispose();
  }
}
