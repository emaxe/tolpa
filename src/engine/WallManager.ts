import * as THREE from 'three';
import { WallData, MobInstance } from '../types/game';
import { createWallTexture } from '../utils/proceduralMeshes';
import { CrowdManager } from './CrowdManager';
import { ParticleSystem } from './ParticleSystem';
import { soundEngine } from '../audio/SoundEngine';
import { eventBus } from '../core/EventBus';
import { stateManager } from '../core/StateManager';

interface WallVisual {
  data: WallData;
  group: THREE.Group;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  // Обновление текстуры счётчика (−N → −(N-1) ...) при каждом убийстве.
  baseTexture: THREE.CanvasTexture;
  // Мобы, которые уже «учтены» стеной (прошли через неё).
  processedMobs: Set<number>;
  // Анимация падения (когда счётчик дошёл до 0).
  falling: boolean;
  fallT: number;
}

const WALL_HEIGHT = 4.2;

export class WallManager {
  private static readonly PRUNE_MARGIN = 40;
  private scene: THREE.Scene;
  private walls: WallVisual[] = [];
  private throughScratch: MobInstance[] = [];
  private sharedPlaneGeo: THREE.PlaneGeometry | null = null;
  private sharedPillarGeo: THREE.CylinderGeometry | null = null;
  private sharedPillarMat: THREE.MeshStandardMaterial | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private ensureSharedGeometry(): void {
    if (this.sharedPlaneGeo) return;
    this.sharedPlaneGeo = new THREE.PlaneGeometry(4, WALL_HEIGHT);
    this.sharedPillarGeo = new THREE.CylinderGeometry(0.14, 0.14, WALL_HEIGHT + 0.5, 8);
    this.sharedPillarMat = new THREE.MeshStandardMaterial({
      color: 0x991b1b,
      metalness: 0.8,
      roughness: 0.3,
      emissive: 0xdc2626,
      emissiveIntensity: 0.3,
    });
  }

  private buildWall(wall: WallData): WallVisual {
    const planeGeo = this.sharedPlaneGeo!;
    const pillarGeo = this.sharedPillarGeo!;
    const pillarMat = this.sharedPillarMat!;

    const group = new THREE.Group();
    group.position.set(wall.x, 0, wall.z);

    const baseTexture = createWallTexture(wall.count);
    const mat = new THREE.MeshBasicMaterial({
      map: baseTexture,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(planeGeo, mat);
    mesh.position.set(0, WALL_HEIGHT / 2, 0);
    mesh.rotation.y = Math.PI;
    mesh.scale.set(wall.width / 4, 1, 1);
    group.add(mesh);

    const halfW = wall.width / 2;
    const pL = new THREE.Mesh(pillarGeo, pillarMat);
    pL.position.set(-halfW, WALL_HEIGHT / 2, 0);
    const pR = new THREE.Mesh(pillarGeo, pillarMat);
    pR.position.set(halfW, WALL_HEIGHT / 2, 0);
    group.add(pL);
    group.add(pR);

    this.scene.add(group);

    return { data: wall, group, mesh, mat, baseTexture, processedMobs: new Set<number>(), falling: false, fallT: 0 };
  }

  public initWalls(data: WallData[]): void {
    this.clear();
    this.ensureSharedGeometry();
    data.forEach((w) => this.walls.push(this.buildWall(w)));
  }

  /**
   * Единая точка инициации разрушения стены. Фидбек (звук, партиклы, статистика
   * obstaclesSmashed, событие obstacleSmashed, тряска экрана) срабатывает ОДИН раз
   * в момент старта коллапса, а не при завершении анимации падения. Это убирает
   * двойное начисление достижения obstacle_crusher и дубль звука/тряски в
   * гипер-режиме, и делает разрушение при обычном пробое snappier (без задержки ~0.4с).
   */
  private breakWall(wv: WallVisual, isHyper: boolean, particles: ParticleSystem): void {
    wv.falling = true;
    wv.fallT = 0;
    soundEngine.playSound('obstacle_smash');
    particles.emitBurst(wv.data.x, 1.5, wv.data.z, 30, isHyper ? 0xfacc15 : 0xef4444, isHyper ? 6.0 : 5.0);
    stateManager.runRecordObstacleSmash();
    eventBus.emit('obstacleSmashed', { type: 'wall', x: wv.data.x, z: wv.data.z });
    eventBus.emit('screenShake', { intensity: 0.35 });
  }

  public appendWalls(data: WallData[]): void {
    this.ensureSharedGeometry();
    data.forEach((w) => this.walls.push(this.buildWall(w)));
  }

  public update(dt: number, crowd: CrowdManager, particles: ParticleSystem): void {
    const leaderX = crowd.leaderX;
    const leaderZ = crowd.leaderZ;
    const aliveMobs = crowd.getAliveMobs();

    for (const wv of this.walls) {
      const wall = wv.data;
      if (wall.destroyed) continue;
      // Пространственный отсев: стена далеко от лидера ещё не достигнута — не сканируем.
      if (Math.abs(wall.z - leaderZ) > 80) continue;

      // Анимация падения стены (счётчик исчерпан).
      if (wv.falling) {
        wv.fallT += dt * 3;
        wv.group.rotation.x = Math.min(Math.PI / 2, wv.fallT);
        wv.group.position.y = -wv.fallT * 0.5;
        if (wv.fallT >= 1.2) {
          wall.destroyed = true;
          this.scene.remove(wv.group);
          // Удаление меша из сцены — фидбек уже отправлен в breakWall() в момент
          // старта коллапса; здесь только очистка.
        }
        continue;
      }

      // Мобы, проходящие через стену: стена убивает по одному, пока счётчик > 0.
      const halfW = wall.width / 2;
      this.throughScratch.length = 0;
      for (const mob of aliveMobs) {
        if (wv.processedMobs.has(mob.id)) continue;
        // Детект пересечения плоскости Z в текущем кадре (+Z направление движения),
        // а не статической позиции: иначе при смещении толпы назад (боковой обход
        // стены) условие повторно срабатывает и стена «в спину» убивает выживших.
        const crossed = mob.prevZ < wall.z && mob.z >= wall.z;
        if (!crossed) continue;
        if (Math.abs(mob.x - wall.x) > halfW + 0.4) continue;
        wv.processedMobs.add(mob.id);
        this.throughScratch.push(mob);
      }

      if (this.throughScratch.length === 0) continue;

      // Гипер-режим: толпа неуязвима (killOneFromGroup возвращает null), поэтому
      // кинетические стены мгновенно сокрушаются при контакте с толпой.
      if (crowd.isHyperMode) {
        this.breakWall(wv, true, particles);
        continue;
      }

      // Стена бьёт по проходящим мобам, пока счётчик > 0.
      // Кинетический пробой стен: урон зависит от класса моба (танки) и формации (стрела/фаланга).
      // Батч-обработка: аккумулируем урон за кадр, а фидбек (текстура счётчика, звук,
      // партиклы, тряска) отдаём ОДИН раз после цикла. Иначе при широком строе (wide/oval/circle)
      // в один кадр пересоздаётся CanvasTexture и дублируется звук/тряска на каждого моба
      // (0-GC нарушение + аудио-клиппинг).
      let totalDamage = 0;
      for (const _mob of this.throughScratch) {
        if (wall.killsRemaining <= 0) break;
        // Убиваем ровно одного моба и списываем урон ЭТОГО ЖЕ моба,
        // чтобы счётчик стены соответствовал реально погибшим мобам.
        const killed = crowd.killOneFromGroup(this.throughScratch, 'wall');
        if (killed) {
          const mobDmg = crowd.getMobWallDamage(killed);
          totalDamage += mobDmg;
          wall.killsRemaining -= mobDmg;
          if (wall.killsRemaining <= 0) break;
        }
      }
      if (totalDamage > 0) {
        if (wall.killsRemaining <= 0) {
          // Стена сокрушена в этом кадре — breakWall() сам даёт полный фидбек
          // (obstacle_smash, burst, тряска) ровно один раз.
          this.breakWall(wv, false, particles);
        } else {
          // Стена устояла — один батч-фидбек за кадр вместо N на каждого моба.
          this.updateCounterTexture(wv);
          soundEngine.playSound('gate_pass_negative');
          particles.emitBurst(wall.x, 1.5, wall.z, 12, 0xef4444, 4.0);
          eventBus.emit('screenShake', { intensity: 0.25 });
        }
      }
    }

    this.prune(leaderZ);
  }

  /**
   * Удаляет пройденные и уничтоженные стены позади игрока (endless-режим, 0-GC compaction).
   */
  public prune(leaderZ: number): void {
    const threshold = leaderZ - WallManager.PRUNE_MARGIN;
    let writeIdx = 0;
    for (let i = 0; i < this.walls.length; i++) {
      const wv = this.walls[i];
      if ((wv.data.destroyed || wv.data.z < threshold) && !wv.falling) {
        if (!wv.data.destroyed) {
          this.scene.remove(wv.group);
        }
        wv.baseTexture.dispose();
        wv.mat.dispose();
      } else {
        this.walls[writeIdx++] = wv;
      }
    }
    this.walls.length = writeIdx;
  }

  private updateCounterTexture(wv: WallVisual): void {
    // Пересоздаём текстуру с новым остатком счётчика.
    const remaining = Math.max(0, wv.data.killsRemaining);
    const newTex = createWallTexture(remaining);
    wv.baseTexture.dispose();
    wv.baseTexture = newTex;
    wv.mat.map = newTex;
    wv.mat.needsUpdate = true;
  }

  public clear(): void {
    this.walls.forEach((w) => {
      this.scene.remove(w.group);
      w.baseTexture.dispose();
      w.mat.dispose();
    });
    this.walls = [];
    this.sharedPlaneGeo?.dispose();
    this.sharedPillarGeo?.dispose();
    this.sharedPillarMat?.dispose();
    this.sharedPlaneGeo = null;
    this.sharedPillarGeo = null;
    this.sharedPillarMat = null;
  }
}
