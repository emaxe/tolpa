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
  private scene: THREE.Scene;
  private walls: WallVisual[] = [];
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
      color: 0x450a0a,
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
          particles.emitBurst(wall.x, 1.5, wall.z, 30, 0xef4444, 5.0);
          // Джуис/учёт: сломанная стена играет звук, засчитывается в
          // obstaclesSmashed (достижение obstacle_crusher) и даёт тряску экрана.
          soundEngine.playSound('obstacle_smash');
          stateManager.runRecordObstacleSmash();
          eventBus.emit('obstacleSmashed', { type: 'wall', x: wall.x, z: wall.z });
          eventBus.emit('screenShake', { intensity: 0.35 });
        }
        continue;
      }

      // Мобы, проходящие через стену: стена убивает по одному, пока счётчик > 0.
      const halfW = wall.width / 2;
      const through: MobInstance[] = [];
      for (const mob of aliveMobs) {
        if (wv.processedMobs.has(mob.id)) continue;
        if (mob.z < wall.z - 0.5) continue;
        if (Math.abs(mob.x - wall.x) > halfW + 0.4) continue;
        wv.processedMobs.add(mob.id);
        through.push(mob);
      }

      if (through.length === 0) continue;

      // Стена бьёт ровно по стольким мобам, сколько осталось в счётчике.
      // Фаланга (circle) пробивает стены вдвое быстрее: каждый проходящий боец
      // снимает 2 единицы счётчика вместо 1.
      const wallDamage = crowd.formation === 'circle' ? 2 : 1;
      const toConsume = Math.min(through.length, Math.ceil(wall.killsRemaining / wallDamage));
      for (let i = 0; i < toConsume; i++) {
        const killed = crowd.killOneFromGroup(through, 'wall');
        if (killed) {
          wall.killsRemaining -= wallDamage;
          this.updateCounterTexture(wv);
          soundEngine.playSound('gate_pass_negative');
          particles.emitBurst(wall.x, 1.5, wall.z, 12, 0xef4444, 4.0);
          eventBus.emit('screenShake', { intensity: 0.25 });
          if (wall.killsRemaining <= 0) {
            wv.falling = true;
            wv.fallT = 0;
            break;
          }
        }
      }
    }
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
