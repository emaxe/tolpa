import * as THREE from 'three';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  scale: number;
  color: THREE.Color;
  active: boolean;
}

export class ParticleSystem {
  private particles: Particle[] = [];
  private instancedMesh: THREE.InstancedMesh;
  private dummy: THREE.Object3D = new THREE.Object3D();
  private colorDummy: THREE.Color = new THREE.Color();

  constructor(scene: THREE.Scene, maxParticles: number = 300) {
    const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    this.instancedMesh = new THREE.InstancedMesh(geo, mat, maxParticles);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Тот же баг с кэшируемым boundingSphere, что у CrowdManager — неактивные частицы
    // паркуются в (0,-100,0), сфера застывает статичной и меш пропадает после ~60м пути.
    this.instancedMesh.frustumCulled = false;
    scene.add(this.instancedMesh);

    for (let i = 0; i < maxParticles; i++) {
      this.particles.push({
        x: 0,
        y: -100,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1.0,
        scale: 1.0,
        color: new THREE.Color(0x00ffff),
        active: false,
      });
      this.dummy.position.set(0, -100, 0);
      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  public emitBurst(
    x: number,
    y: number,
    z: number,
    count: number = 15,
    colorHex: number = 0x00f0ff,
    speed: number = 4.0,
    upBias: number = 1.5
  ): void {
    let emitted = 0;
    this.colorDummy.setHex(colorHex);

    for (let i = 0; i < this.particles.length && emitted < count; i++) {
      const p = this.particles[i];
      if (!p.active) {
        p.active = true;
        p.x = x;
        p.y = y;
        p.z = z;
        p.life = 0;
        p.maxLife = 0.4 + Math.random() * 0.4;
        p.scale = 0.8 + Math.random() * 0.6;
        p.color.setHex(colorHex);

        const angle = Math.random() * Math.PI * 2;
        const elev = (Math.random() - 0.2) * Math.PI;
        const spd = speed * (0.6 + Math.random() * 0.8);

        p.vx = Math.cos(angle) * Math.cos(elev) * spd;
        p.vy = Math.sin(elev) * spd + upBias;
        p.vz = Math.sin(angle) * Math.cos(elev) * spd;

        this.instancedMesh.setColorAt(i, p.color);
        emitted++;
      }
    }
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  public update(dt: number): void {
    let changed = false;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (p.active) {
        p.life += dt;
        if (p.life >= p.maxLife) {
          p.active = false;
          p.y = -100;
          this.dummy.position.set(0, -100, 0);
          this.dummy.updateMatrix();
          this.instancedMesh.setMatrixAt(i, this.dummy.matrix);
          changed = true;
          continue;
        }

        // Apply physics
        p.vy -= 9.8 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;

        const lifeRatio = 1 - p.life / p.maxLife;
        const scale = p.scale * lifeRatio;

        this.dummy.position.set(p.x, p.y, p.z);
        this.dummy.scale.set(scale, scale, scale);
        this.dummy.updateMatrix();
        this.instancedMesh.setMatrixAt(i, this.dummy.matrix);
        changed = true;
      }
    }

    if (changed) {
      this.instancedMesh.instanceMatrix.needsUpdate = true;
    }
  }

  public clear(): void {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.active = false;
      this.dummy.position.set(0, -100, 0);
      this.dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }

  public dispose(): void {
    this.instancedMesh.geometry.dispose();
    if (Array.isArray(this.instancedMesh.material)) {
      this.instancedMesh.material.forEach((m) => m.dispose());
    } else {
      this.instancedMesh.material.dispose();
    }
  }
}
