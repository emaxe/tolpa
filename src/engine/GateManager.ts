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
  // Мобы, которые уже прошли через эти ворота — чтобы каждый человечек обрабатывался
  // воротами независимо (по своей реальной позиции), а не по лидеру толпы.
  processedMobs: Set<number>;
}

export class GateManager {
  private scene: THREE.Scene;
  private gates: GateVisual[] = [];
  private comboStreak: number = 0;

  // Все ворота уровня используют одну и ту же ширину/высоту, поэтому геометрии рамок
  // общие на весь набор ворот — раньше их создавали заново под каждые ворота и никогда
  // не диспозили (clear() чистил только текстуры/материалы створок).
  private sharedPlaneGeo: THREE.PlaneGeometry | null = null;
  private sharedPillarGeo: THREE.CylinderGeometry | null = null;
  private sharedPillarMat: THREE.MeshStandardMaterial | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  private static readonly GATE_HEIGHT = 3.8;

  private ensureSharedGeometry(referenceWidth: number): void {
    if (this.sharedPlaneGeo) return;
    const gateHeight = GateManager.GATE_HEIGHT;
    this.sharedPlaneGeo = new THREE.PlaneGeometry(referenceWidth || 4, gateHeight);
    this.sharedPillarGeo = new THREE.CylinderGeometry(0.12, 0.12, gateHeight + 0.4, 8);
    this.sharedPillarMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.9,
      roughness: 0.2,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.4,
    });
  }

  private buildGateVisual(gate: GateData): GateVisual {
    const gateHeight = GateManager.GATE_HEIGHT;
    const planeGeo = this.sharedPlaneGeo!;
    const pillarGeo = this.sharedPillarGeo!;
    const pillarMat = this.sharedPillarMat!;

    const group = new THREE.Group();
    group.position.z = gate.z;

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
    leftMesh.rotation.y = Math.PI;

    const rightMesh = new THREE.Mesh(planeGeo, rightMat);
    rightMesh.position.set(gate.xRight, gateHeight / 2, 0);
    rightMesh.rotation.y = Math.PI;

    group.add(leftMesh);
    group.add(rightMesh);

    // Frame pillars (Left post, Center post, Right post) — общая геометрия/материал
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

    return { data: gate, group, leftMesh, rightMesh, leftMat, rightMat, leftTexture, rightTexture, processedMobs: new Set<number>() };
  }

  public initGates(gatesData: GateData[]): void {
    this.clear();
    this.comboStreak = 0;
    this.ensureSharedGeometry(gatesData[0]?.width || 4);
    gatesData.forEach((gate) => this.gates.push(this.buildGateVisual(gate)));
  }

  /** Добавляет ворота к уже существующим, не очищая уровень — используется endless-режимом. */
  public appendGates(gatesData: GateData[]): void {
    this.ensureSharedGeometry(gatesData[0]?.width || 4);
    gatesData.forEach((gate) => this.gates.push(this.buildGateVisual(gate)));
  }

  public update(
    dt: number,
    crowd: CrowdManager,
    particles: ParticleSystem
  ): void {
    this.gates.forEach((gateVisual) => {
      const gate = gateVisual.data;
      if (gate.passed) return;

      // Check dynamic flipping gate
      if (gate.isDynamic) {
        gate.flipTimer = (gate.flipTimer || 0) + dt;
        gateVisual.leftMesh.position.y = 1.9 + Math.sin(gate.flipTimer * 3) * 0.15;
        gateVisual.rightMesh.position.y = 1.9 + Math.cos(gate.flipTimer * 3) * 0.15;
      }

      // Каждый человечек обрабатывается воротами НЕЗАВИСИМО — по своей реальной позиции,
      // а не по лидеру толпы. Ворота срабатывают один раз, когда через них проходит
      // первый моб, но выбор створки определяется по реальному распределению мобов,
      // пересекших плоскость ворот (а не по leaderX). Если толпа растянута по ширине
      // так, что часть мобов у левой створки, а часть у правой — обе створки срабатывают
      // для своих мобов.
      const aliveMobs = crowd.getAliveMobs();
      let leftCount = 0;
      let rightCount = 0;
      let anyProcessed = false;
      for (const mob of aliveMobs) {
        if (gateVisual.processedMobs.has(mob.id)) continue;
        if (mob.z < gate.z - 0.5) continue;
        gateVisual.processedMobs.add(mob.id);
        anyProcessed = true;
        if (Math.abs(mob.x - gate.xLeft) < Math.abs(mob.x - gate.xRight)) leftCount++;
        else rightCount++;
      }

      if (anyProcessed) {
        // Обрабатываем обе створки, через которые реально прошли мобы
        if (leftCount > 0) {
          this.executeGateEffect(
            gate.leftOp, gate.leftVal, gate.leftCondition,
            crowd, crowd.getAliveMobs().some((m) => m.type === 'mage'),
            particles, gate.xLeft, gate.z
          );
        }
        if (rightCount > 0) {
          this.executeGateEffect(
            gate.rightOp, gate.rightVal, gate.rightCondition,
            crowd, crowd.getAliveMobs().some((m) => m.type === 'mage'),
            particles, gate.xRight, gate.z
          );
        }

        gate.passed = true;
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
    let netChange = 0; // фактическое изменение числа мобов — для флоатинг-текста в HUD

    if (op === 'add') {
      netChange = crowd.addMobs(val);
      // Толпа уже на потолке 400 — молчим, чтобы не хвалить игрока за нулевой результат.
      if (netChange > 0) soundEngine.playSound('gate_pass_positive');
      particles.emitBurst(gateX, 1.5, gateZ, netChange > 0 ? 25 : 6, 0x10b981, netChange > 0 ? 5.0 : 2.0);
      isPositive = true;
    } else if (op === 'multiply') {
      netChange = crowd.multiplyMobs(val);
      if (netChange > 0) soundEngine.playSound('gate_pass_multiplier');
      particles.emitBurst(gateX, 1.5, gateZ, netChange > 0 ? 35 : 6, 0x00f0ff, netChange > 0 ? 6.0 : 2.0);
      isPositive = true;
    } else if (op === 'subtract') {
      if (hasMages) {
        // Transmute negative gate to bonus!
        netChange = crowd.addMobs(val);
        soundEngine.playSound('gate_pass_positive');
        particles.emitBurst(gateX, 1.5, gateZ, 30, 0xa855f7, 5.0);
        isPositive = true;
      } else {
        netChange = -crowd.killMobs(val, 'gate');
        soundEngine.playSound('gate_pass_negative');
        particles.emitBurst(gateX, 1.5, gateZ, 20, 0xef4444, 4.0);
        eventBus.emit('screenShake', { intensity: 0.3 });
      }
    } else if (op === 'divide') {
      if (hasMages) {
        netChange = crowd.multiplyMobs(val);
        soundEngine.playSound('gate_pass_multiplier');
        particles.emitBurst(gateX, 1.5, gateZ, 30, 0xa855f7, 5.0);
        isPositive = true;
      } else {
        const before = crowd.getAliveCount();
        crowd.divideMobs(val);
        netChange = crowd.getAliveCount() - before;
        soundEngine.playSound('gate_pass_negative');
        particles.emitBurst(gateX, 1.5, gateZ, 20, 0xef4444, 4.0);
        eventBus.emit('screenShake', { intensity: 0.3 });
      }
    } else if (op === 'conditional' && condition) {
      if (mobCount >= condition.minMobs) {
        netChange = condition.passOp === 'multiply' ? crowd.multiplyMobs(condition.passVal) : crowd.addMobs(condition.passVal);
        soundEngine.playSound('gate_pass_multiplier');
        particles.emitBurst(gateX, 1.5, gateZ, 40, 0x00f0ff, 6.0);
        isPositive = true;
      } else {
        if (condition.failOp === 'divide') {
          const before = crowd.getAliveCount();
          crowd.divideMobs(condition.failVal);
          netChange = crowd.getAliveCount() - before;
        } else {
          netChange = -crowd.killMobs(condition.failVal, 'gate');
        }
        soundEngine.playSound('gate_pass_negative');
        particles.emitBurst(gateX, 1.5, gateZ, 20, 0xef4444, 4.0);
        eventBus.emit('screenShake', { intensity: 0.3 });
      }
    } else if (op === 'mystery') {
      // Mystery box: 60% бонус, 40% штраф (раньше всегда бонус — не было риска).
      // Штраф не может убить всю толпу: максимум 30% текущего состава.
      if (Math.random() < 0.6) {
        const bonus = Math.random() < 0.3 ? 18 : 8;
        netChange = crowd.addMobs(bonus);
        soundEngine.playSound('gate_pass_multiplier');
        particles.emitBurst(gateX, 1.5, gateZ, 35, 0xf59e0b, 5.5);
        isPositive = true;
      } else {
        const penalty = Math.max(1, Math.floor(crowd.getAliveCount() * 0.3));
        netChange = -crowd.killMobs(penalty, 'gate');
        soundEngine.playSound('gate_pass_negative');
        particles.emitBurst(gateX, 1.5, gateZ, 20, 0xef4444, 4.0);
        eventBus.emit('screenShake', { intensity: 0.3 });
      }
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
      stateManager.runRecordCombo(this.comboStreak);
    } else {
      this.comboStreak = 0;
    }

    stateManager.runRecordGatePass();
    eventBus.emit('gatePassed', { op, val, isPositive, netChange, comboStreak: this.comboStreak, x: gateX, z: gateZ });
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

    this.sharedPlaneGeo?.dispose();
    this.sharedPillarGeo?.dispose();
    this.sharedPillarMat?.dispose();
    this.sharedPlaneGeo = null;
    this.sharedPillarGeo = null;
    this.sharedPillarMat = null;
  }
}
