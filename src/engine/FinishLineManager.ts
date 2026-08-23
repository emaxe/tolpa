import * as THREE from 'three';
import { CrowdManager } from './CrowdManager';
import { ParticleSystem } from './ParticleSystem';
import { soundEngine } from '../audio/SoundEngine';
import { eventBus } from '../core/EventBus';
import confetti from 'canvas-confetti';

interface WallStep {
  mesh: THREE.Mesh;
  multiplier: number;
  costMobs: number;
  z: number;
  smashed: boolean;
}

export class FinishLineManager {
  private scene: THREE.Scene;
  private wallSteps: WallStep[] = [];
  private finishLineZ: number = 0;
  public hasCrossedFinish: boolean = false;
  public finalMultiplier: number = 1.0;
  // Сколько легионеров пожертвовано на пробитие финишных стен — усиливает итоговый бонус.
  public sacrificedTotal: number = 0;
  private finalStepIndex: number = 0;
  private isCelebrating: boolean = false;
  private chestMesh: THREE.Group | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public initFinishLine(finishZ: number, stepsCount: number = 10): void {
    this.clear();
    this.finishLineZ = finishZ;
    this.hasCrossedFinish = false;
    this.finalMultiplier = 1.0;
    this.sacrificedTotal = 0;
    this.finalStepIndex = 0;
    this.isCelebrating = false;

    // Multiplier steps
    const multipliers = [1.2, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0];
    // Стоимость пробития каждой стены в легионерах (сумма = 66). Толпа реально редеет на финише.
    const costs = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15];

    for (let i = 0; i < stepsCount; i++) {
      const mult = multipliers[i] || 1.0 + i * 0.5;
      const stepZ = finishZ + 10 + i * 8;
      const cost = costs[i] ?? Math.floor(2 + i * 3.5);

      // Create Step Barrier Mesh
      const stepGeo = new THREE.BoxGeometry(8, 2.0 + i * 0.3, 2.5);
      const stepMat = new THREE.MeshStandardMaterial({
        color: i === stepsCount - 1 ? 0xfacc15 : 0x334155,
        metalness: 0.8,
        roughness: 0.2,
        emissive: i === stepsCount - 1 ? 0xeab308 : 0x0ea5e9,
        emissiveIntensity: 0.3 + i * 0.05,
      });

      const stepMesh = new THREE.Mesh(stepGeo, stepMat);
      stepMesh.position.set(0, (2.0 + i * 0.3) / 2, stepZ);
      this.scene.add(stepMesh);

      this.wallSteps.push({
        mesh: stepMesh,
        multiplier: mult,
        costMobs: cost,
        z: stepZ,
        smashed: false,
      });
    }

    // Grand Chest at the apex
    const chestGroup = new THREE.Group();
    const chestGeo = new THREE.BoxGeometry(2.5, 1.8, 1.8);
    const chestMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.95,
      roughness: 0.1,
      emissive: 0xffd700,
      emissiveIntensity: 0.6,
    });
    const chest = new THREE.Mesh(chestGeo, chestMat);
    chest.position.set(0, 3.5, finishZ + 10 + stepsCount * 8 + 4);
    chestGroup.add(chest);
    this.scene.add(chestGroup);
    this.chestMesh = chestGroup;
  }

  public update(
    _dt: number,
    crowd: CrowdManager,
    particles: ParticleSystem,
    onLevelWon: (finalScore: number, finalMultiplier: number, remainingMobs: number) => void
  ): void {
    const crowdZ = crowd.leaderZ;

    if (!this.hasCrossedFinish && crowdZ >= this.finishLineZ) {
      this.hasCrossedFinish = true;
      eventBus.emit('finishLineCrossed');
    }

    if (this.hasCrossedFinish && !this.isCelebrating) {
      const mobCount = crowd.getAliveCount();

      // Check step collisions
      if (this.finalStepIndex < this.wallSteps.length) {
        const step = this.wallSteps[this.finalStepIndex];

        if (crowdZ >= step.z - 1.0 && !step.smashed) {
          if (mobCount > step.costMobs) {
            // Жертвуем легионеров на кинетический прорыв стены — толпа реально редеет.
            // Строгое условие > гарантирует, что после жертвы останется минимум 1 живой.
            const sacrificed = crowd.consumeMobs(step.costMobs);
            this.sacrificedTotal += sacrificed;

            // Smash wall!
            step.smashed = true;
            this.finalMultiplier = step.multiplier;
            soundEngine.playSound('finish_wall_hit', 1.0 + this.finalStepIndex * 0.08);
            particles.emitBurst(0, 1.5, step.z, 35, 0x00f0ff, 6.0);
            eventBus.emit('screenShake', { intensity: 0.35 });

            // Красная вспышка урона + плавающий текст потерь при жертве.
            if (sacrificed > 0) {
              eventBus.emit('mobsKilled', { count: sacrificed, reason: 'finish_wall', x: 0, z: step.z });
            }

            // Animate barrier breaking downwards
            step.mesh.position.y = -2;

            this.finalStepIndex++;
          } else {
            // Толпе не хватает массы пробить стену — триумфальная остановка на достигнутом множителе.
            this.triggerVictory(crowd, particles, onLevelWon);
          }
        }
      } else {
        // Conquered ALL steps!
        this.triggerVictory(crowd, particles, onLevelWon);
      }
    }
  }

  private triggerVictory(
    crowd: CrowdManager,
    particles: ParticleSystem,
    onLevelWon: (finalScore: number, finalMultiplier: number, remainingMobs: number) => void
  ): void {
    if (this.isCelebrating) return;
    this.isCelebrating = true;

    soundEngine.playSound('level_win');
    // Радостный победный возглас толпы — разовая ликующая «волна» в момент победы.
    soundEngine.playSound('crowd_cheer');
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.6 },
    });
    if (this.chestMesh) {
      // Сундук открывается — отдельный яркий звук награды
      soundEngine.playSound('finish_chest_open');
      particles.emitBurst(0, 3.5, this.chestMesh.position.z, 60, 0xfacc15, 8.0);
    }

    const remainingMobs = crowd.getAliveCount();
    // Чем больше легионеров пожертвовано на пробитие стен — тем выше итоговый бонус.
    // Коэффициент мал (0.005), чтобы не взорвать баланс: при 66 пожертвованных даёт ×1.33.
    this.finalMultiplier *= 1 + this.sacrificedTotal * 0.005;
    const baseScore = remainingMobs * 100;
    const finalScore = Math.round(baseScore * this.finalMultiplier);

    onLevelWon(finalScore, this.finalMultiplier, remainingMobs);
  }

  /** Индекс текущей преодолеваемой стены (0..N) — для HUD-индикатора финиша. */
  public getFinishStepsDone(): number {
    return this.finalStepIndex;
  }

  /** Общее число финишных стен — для HUD-индикатора финиша. */
  public getFinishStepsTotal(): number {
    return this.wallSteps.length;
  }

  public clear(): void {
    this.wallSteps.forEach((s) => {
      this.scene.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    });
    this.wallSteps = [];

    if (this.chestMesh) {
      this.scene.remove(this.chestMesh);
      this.chestMesh = null;
    }
    this.hasCrossedFinish = false;
    this.isCelebrating = false;
    this.sacrificedTotal = 0;
  }
}
