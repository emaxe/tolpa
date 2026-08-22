import * as THREE from 'three';
import { GateData } from '../types/game';
import { createGateTexture } from '../utils/proceduralMeshes';
import { CrowdManager } from './CrowdManager';
import { ParticleSystem } from './ParticleSystem';
import { soundEngine } from '../audio/SoundEngine';
import { eventBus } from '../core/EventBus';
import { stateManager } from '../core/StateManager';

interface GateVisual {
  data: GateData;
  group: THREE.Group;
  leftMesh: THREE.Mesh;
  rightMesh: THREE.Mesh;
  leftMat: THREE.MeshBasicMaterial;
  rightMat: THREE.MeshBasicMaterial;
  leftTexture: THREE.CanvasTexture;
  rightTexture: THREE.CanvasTexture;
}

export class GateManager {
  private scene: THREE.Scene;
  private gates: GateVisual[] = [];
  private comboStreak: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public initGates(gatesData: GateData[]): void {
    this.clear();
    this.comboStreak = 0;

    gatesData.forEach((gate) => {
      const group = new THREE.Group();
      group.position.z = gate.z;

      const gateHeight = 3.8;
      const planeGeo = new THREE.PlaneGeometry(gate.width, gateHeight);

      // Textures
      const leftTexture = createGateTexture(gate, 'left');
      const rightTexture = createGateTexture(gate, 'right');

      const leftMat = new THREE.MeshBasicMaterial({
        map: leftTexture,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      });
      const rightMat = new THREE.MeshBasicMaterial({
        map: rightTexture,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      });

      const leftMesh = new THREE.Mesh(planeGeo, leftMat);
      leftMesh.position.set(gate.xLeft, gateHeight / 2, 0);

      const rightMesh = new THREE.Mesh(planeGeo, rightMat);
      rightMesh.position.set(gate.xRight, gateHeight / 2, 0);

      group.add(leftMesh);
      group.add(rightMesh);

      // Frame pillars
      const pillarGeo = new THREE.CylinderGeometry(0.12, 0.12, gateHeight + 0.4, 8);
      const pillarMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        metalness: 0.9,
        roughness: 0.2,
        emissive: 0x0ea5e9,
        emissiveIntensity: 0.4,
      });

      // Left post, Center post, Right post
      const p1 = new THREE.Mesh(pillarGeo, pillarMat);
      p1.position.set(gate.xLeft - gate.width / 2, gateHeight / 2, 0);
      const p2 = new THREE.Mesh(pillarGeo, pillarMat);
      p2.position.set(0, gateHeight / 2, 0);
      const p3 = new THREE.Mesh(pillarGeo, pillarMat);
      p3.position.set(gate.xRight + gate.width / 2, gateHeight / 2, 0);

      group.add(p1);
      group.add(p2);
      group.add(p3);

      this.scene.add(group);

      this.gates.push({
        data: gate,
        group,
        leftMesh,
        rightMesh,
        leftMat,
        rightMat,
        leftTexture,
        rightTexture,
      });
    });
  }

  public update(
    dt: number,
    crowd: CrowdManager,
    particles: ParticleSystem
  ): void {
    const crowdZ = crowd.leaderZ;
    const crowdX = crowd.leaderX;

    this.gates.forEach((gateVisual) => {
      const gate = gateVisual.data;
      if (gate.passed) return;

      // Check dynamic flipping gate
      if (gate.isDynamic) {
        gate.flipTimer = (gate.flipTimer || 0) + dt;
        gateVisual.leftMesh.position.y = 1.9 + Math.sin(gate.flipTimer * 3) * 0.15;
        gateVisual.rightMesh.position.y = 1.9 + Math.cos(gate.flipTimer * 3) * 0.15;
      }

      // Check collision
      if (crowdZ >= gate.z - 0.5 && crowdZ <= gate.z + 1.2) {
        gate.passed = true;

        // Determine which side the player took
        const tookLeft = crowdX < 0;
        const op = tookLeft ? gate.leftOp : gate.rightOp;
        const val = tookLeft ? gate.leftVal : gate.rightVal;
        const condition = tookLeft ? gate.leftCondition : gate.rightCondition;

        // Check if crowd has Chrono-Mages (convert negative ops to positive)
        const hasMages = crowd.getAliveMobs().some((m) => m.type === 'mage');

        this.executeGateEffect(op, val, condition, crowd, hasMages, particles, tookLeft ? gate.xLeft : gate.xRight, gate.z);

        // Visual fade out
        gateVisual.leftMat.opacity = 0.3;
        gateVisual.rightMat.opacity = 0.3;
      }
    });
  }

  private executeGateEffect(
    op: string,
    val: number,
    condition: any,
    crowd: CrowdManager,
    hasMages: boolean,
    particles: ParticleSystem,
    gateX: number,
    gateZ: number
  ): void {
    const mobCount = crowd.getAliveCount();
    let isPositive = false;

    if (op === 'add') {
      crowd.addMobs(val);
      soundEngine.playSound('gate_pass_positive');
      particles.emitBurst(gateX, 1.5, gateZ, 25, 0x10b981, 5.0);
      isPositive = true;
    } else if (op === 'multiply') {
      crowd.multiplyMobs(val);
      soundEngine.playSound('gate_pass_multiplier');
      particles.emitBurst(gateX, 1.5, gateZ, 35, 0x00f0ff, 6.0);
      isPositive = true;
    } else if (op === 'subtract') {
      if (hasMages) {
        // Transmute negative gate to bonus!
        crowd.addMobs(val);
        soundEngine.playSound('gate_pass_positive');
        particles.emitBurst(gateX, 1.5, gateZ, 30, 0xa855f7, 5.0);
        isPositive = true;
      } else {
        crowd.killMobs(val, 'gate');
        soundEngine.playSound('gate_pass_negative');
        particles.emitBurst(gateX, 1.5, gateZ, 20, 0xef4444, 4.0);
      }
    } else if (op === 'divide') {
      if (hasMages) {
        crowd.multiplyMobs(val);
        soundEngine.playSound('gate_pass_multiplier');
        particles.emitBurst(gateX, 1.5, gateZ, 30, 0xa855f7, 5.0);
        isPositive = true;
      } else {
        crowd.divideMobs(val);
        soundEngine.playSound('gate_pass_negative');
        particles.emitBurst(gateX, 1.5, gateZ, 20, 0xef4444, 4.0);
      }
    } else if (op === 'conditional' && condition) {
      if (mobCount >= condition.minMobs) {
        if (condition.passOp === 'multiply') crowd.multiplyMobs(condition.passVal);
        else crowd.addMobs(condition.passVal);
        soundEngine.playSound('gate_pass_multiplier');
        particles.emitBurst(gateX, 1.5, gateZ, 40, 0x00f0ff, 6.0);
        isPositive = true;
      } else {
        if (condition.failOp === 'divide') crowd.divideMobs(condition.failVal);
        else crowd.killMobs(condition.failVal, 'gate');
        soundEngine.playSound('gate_pass_negative');
        particles.emitBurst(gateX, 1.5, gateZ, 20, 0xef4444, 4.0);
      }
    } else if (op === 'mystery') {
      // Mystery box: 70% positive, 30% huge jackpot
      const bonus = Math.random() < 0.3 ? 25 : 12;
      crowd.addMobs(bonus);
      soundEngine.playSound('gate_pass_multiplier');
      particles.emitBurst(gateX, 1.5, gateZ, 35, 0xf59e0b, 5.5);
      isPositive = true;
    } else if (op === 'adrenaline') {
      crowd.activateHyperMode(6.0);
      particles.emitBurst(gateX, 1.5, gateZ, 45, 0xfacc15, 7.0);
      isPositive = true;
    }

    // Handle combo streak
    if (isPositive) {
      this.comboStreak++;
      if (this.comboStreak > 1) {
        soundEngine.playSound('combo_ding', 1.0 + this.comboStreak * 0.1);
      }
      stateManager.recordCombo(this.comboStreak);
    } else {
      this.comboStreak = 0;
    }

    stateManager.recordGatePass();
    eventBus.emit('gatePassed', { op, val, isPositive, comboStreak: this.comboStreak });
  }

  public getCombo(): number {
    return this.comboStreak;
  }

  public clear(): void {
    this.gates.forEach((g) => {
      this.scene.remove(g.group);
      g.leftTexture.dispose();
      g.rightTexture.dispose();
      g.leftMat.dispose();
      g.rightMat.dispose();
    });
    this.gates = [];
  }
}
