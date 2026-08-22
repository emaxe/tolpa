import * as THREE from 'three';
import { BiomeType, BossData, GateData } from '../types/game';

// Canvas texture generator for Math Gates
export function createGateTexture(
  gate: GateData,
  side: 'left' | 'right',
  _theme: BiomeType = 'cyber_city'
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const op = side === 'left' ? gate.leftOp : gate.rightOp;
  const val = side === 'left' ? gate.leftVal : gate.rightVal;
  const condition = side === 'left' ? gate.leftCondition : gate.rightCondition;

  const isPositive = op === 'add' || op === 'multiply' || op === 'adrenaline' || (op === 'conditional');
  const isDanger = op === 'subtract' || op === 'divide';

  // Base background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 0, 512);
  if (isPositive) {
    bgGrad.addColorStop(0, 'rgba(6, 182, 212, 0.85)'); // Cyan / Blue
    bgGrad.addColorStop(1, 'rgba(16, 185, 129, 0.75)'); // Emerald
  } else if (isDanger) {
    bgGrad.addColorStop(0, 'rgba(239, 68, 68, 0.85)'); // Crimson Red
    bgGrad.addColorStop(1, 'rgba(185, 28, 28, 0.75)');
  } else {
    bgGrad.addColorStop(0, 'rgba(168, 85, 247, 0.85)'); // Purple Mystery
    bgGrad.addColorStop(1, 'rgba(126, 34, 206, 0.75)');
  }

  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 512, 512);

  // Outer glowing border
  ctx.lineWidth = 24;
  ctx.strokeStyle = isPositive ? '#67e8f9' : isDanger ? '#fca5a5' : '#f472b6';
  ctx.strokeRect(12, 12, 488, 488);

  // Tech grid lines
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  for (let i = 40; i < 512; i += 40) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 512);
    ctx.stroke();
  }

  // Draw Gate Text
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 12;

  if (op === 'conditional' && condition) {
    // Conditional gate: "IF > N" -> "+X / -Y"
    ctx.fillStyle = '#fef08a';
    ctx.font = 'bold 52px Orbitron, sans-serif';
    ctx.fillText(`ЕСЛИ > ${condition.minMobs}`, 256, 140);

    ctx.font = 'bold 74px Orbitron, sans-serif';
    ctx.fillStyle = '#86efac';
    const passSymbol = condition.passOp === 'multiply' ? '×' : '+';
    ctx.fillText(`${passSymbol}${condition.passVal}`, 256, 260);

    ctx.font = 'bold 54px Orbitron, sans-serif';
    ctx.fillStyle = '#fca5a5';
    const failSymbol = condition.failOp === 'divide' ? '÷' : '−';
    ctx.fillText(`ИНАЧЕ ${failSymbol}${condition.failVal}`, 256, 380);
  } else if (op === 'mystery') {
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 160px Orbitron, sans-serif';
    ctx.fillText('?', 256, 256);
  } else if (op === 'adrenaline') {
    ctx.fillStyle = '#fef08a';
    ctx.font = 'bold 90px Orbitron, sans-serif';
    ctx.fillText('⚡ RUSH', 256, 220);
    ctx.font = 'bold 64px Orbitron, sans-serif';
    ctx.fillText('МАКС. СКОРОСТЬ', 256, 330);
  } else {
    // Normal Math gate: +10, ×2, −5, ÷2
    let symbol = '+';
    if (op === 'multiply') symbol = '×';
    if (op === 'subtract') symbol = '−';
    if (op === 'divide') symbol = '÷';

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 140px Orbitron, sans-serif';
    ctx.fillText(`${symbol}${val}`, 256, 240);

    ctx.font = 'bold 44px Orbitron, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillText(isPositive ? 'БОНУС' : 'ОПАСНОСТЬ', 256, 380);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Procedural Humanoid Mesh for Crowd
export function createHumanoidGeometry(): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  // Head (Sphere)
  const headGeo = new THREE.SphereGeometry(0.22, 10, 10);
  headGeo.translate(0, 1.25, 0);
  geometries.push(headGeo);

  // Torso (Capsule/Cylinder)
  const torsoGeo = new THREE.CylinderGeometry(0.18, 0.14, 0.55, 10);
  torsoGeo.translate(0, 0.8, 0);
  geometries.push(torsoGeo);

  // Left Leg
  const legGeoL = new THREE.CylinderGeometry(0.065, 0.055, 0.55, 8);
  legGeoL.translate(-0.09, 0.28, 0);
  geometries.push(legGeoL);

  // Right Leg
  const legGeoR = new THREE.CylinderGeometry(0.065, 0.055, 0.55, 8);
  legGeoR.translate(0.09, 0.28, 0);
  geometries.push(legGeoR);

  // Left Arm
  const armGeoL = new THREE.CylinderGeometry(0.05, 0.045, 0.45, 8);
  armGeoL.rotateZ(0.2);
  armGeoL.translate(-0.25, 0.8, 0);
  geometries.push(armGeoL);

  // Right Arm
  const armGeoR = new THREE.CylinderGeometry(0.05, 0.045, 0.45, 8);
  armGeoR.rotateZ(-0.2);
  armGeoR.translate(0.25, 0.8, 0);
  geometries.push(armGeoR);

  // Visor / Cyber Mask
  const visorGeo = new THREE.BoxGeometry(0.22, 0.08, 0.12);
  visorGeo.translate(0, 1.28, 0.14);
  geometries.push(visorGeo);

  // Merge geometries into single buffer
  const merged = mergeBufferGeometries(geometries);
  return merged;
}

// Helper to merge buffer geometries manually without heavy external modules
function mergeBufferGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let posCount = 0;
  let normCount = 0;
  let uvCount = 0;
  let indexCount = 0;

  geometries.forEach((g) => {
    posCount += g.attributes.position.array.length;
    if (g.attributes.normal) normCount += g.attributes.normal.array.length;
    if (g.attributes.uv) uvCount += g.attributes.uv.array.length;
    if (g.index) indexCount += g.index.array.length;
  });

  const mergedPos = new Float32Array(posCount);
  const mergedNorm = new Float32Array(normCount);
  const mergedIndices = indexCount > 0 ? new Uint32Array(indexCount) : null;

  let posOffset = 0;
  let normOffset = 0;
  let idxOffset = 0;
  let vertOffset = 0;

  geometries.forEach((g) => {
    mergedPos.set(g.attributes.position.array, posOffset);
    posOffset += g.attributes.position.array.length;

    if (g.attributes.normal) {
      mergedNorm.set(g.attributes.normal.array, normOffset);
      normOffset += g.attributes.normal.array.length;
    }

    if (g.index && mergedIndices) {
      const gIndex = g.index.array;
      for (let i = 0; i < gIndex.length; i++) {
        mergedIndices[idxOffset + i] = gIndex[i] + vertOffset;
      }
      idxOffset += gIndex.length;
    }

    vertOffset += g.attributes.position.count;
  });

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
  if (normCount > 0) {
    merged.setAttribute('normal', new THREE.BufferAttribute(mergedNorm, 3));
  } else {
    merged.computeVertexNormals();
  }
  if (mergedIndices) {
    merged.setIndex(new THREE.BufferAttribute(mergedIndices, 1));
  }

  return merged;
}

// Procedural Saw Blade Mesh
export function createSawBladeMesh(): THREE.Group {
  const group = new THREE.Group();
  
  // Center cylinder
  const centerGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.15, 16);
  const centerMat = new THREE.MeshStandardMaterial({ color: 0x222226, metalness: 0.9, roughness: 0.2 });
  const centerMesh = new THREE.Mesh(centerGeo, centerMat);
  centerMesh.rotation.x = Math.PI / 2;
  group.add(centerMesh);

  // Outer blade disc
  const discGeo = new THREE.CylinderGeometry(1.2, 1.2, 0.05, 24);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.95,
    roughness: 0.1,
    emissive: 0xef4444,
    emissiveIntensity: 0.3,
  });
  const discMesh = new THREE.Mesh(discGeo, bladeMat);
  discMesh.rotation.x = Math.PI / 2;
  group.add(discMesh);

  // Teeth around edge
  const teethCount = 8;
  for (let i = 0; i < teethCount; i++) {
    const angle = (i / teethCount) * Math.PI * 2;
    const toothGeo = new THREE.ConeGeometry(0.2, 0.4, 3);
    const toothMat = new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.8, roughness: 0.2 });
    const tooth = new THREE.Mesh(toothGeo, toothMat);
    tooth.position.set(Math.cos(angle) * 1.25, Math.sin(angle) * 1.25, 0);
    tooth.rotation.z = angle - Math.PI / 2;
    group.add(tooth);
  }

  return group;
}

// Procedural Pendulum Axe Mesh
export function createPendulumAxeMesh(): THREE.Group {
  const group = new THREE.Group();

  // Arm/Shaft
  const armGeo = new THREE.CylinderGeometry(0.08, 0.08, 3.5, 8);
  const armMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 });
  const arm = new THREE.Mesh(armGeo, armMat);
  arm.position.y = -1.75;
  group.add(arm);

  // Crescent Blade
  const bladeGeo = new THREE.TorusGeometry(0.8, 0.12, 8, 16, Math.PI);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.9,
    roughness: 0.1,
    emissive: 0x38bdf8,
    emissiveIntensity: 0.4,
  });
  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  blade.position.y = -3.2;
  blade.rotation.z = Math.PI / 2;
  group.add(blade);

  return group;
}

// Procedural Crusher Mesh
export function createCrusherMesh(): THREE.Group {
  const group = new THREE.Group();

  // Upper support pillar
  const pillarGeo = new THREE.BoxGeometry(0.4, 2.5, 0.4);
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.3 });
  const pillar = new THREE.Mesh(pillarGeo, pillarMat);
  pillar.position.y = 2.0;
  group.add(pillar);

  // Heavy crushing block
  const blockGeo = new THREE.BoxGeometry(2.2, 1.4, 1.2);
  const blockMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.7,
    roughness: 0.4,
    emissive: 0xf97316,
    emissiveIntensity: 0.3,
  });
  const block = new THREE.Mesh(blockGeo, blockMat);
  block.position.y = 0.7;
  group.add(block);

  // Spikes on bottom of block
  for (let x = -0.8; x <= 0.8; x += 0.5) {
    for (let z = -0.3; z <= 0.3; z += 0.3) {
      const spikeGeo = new THREE.ConeGeometry(0.1, 0.3, 4);
      const spikeMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.9, roughness: 0.1 });
      const spike = new THREE.Mesh(spikeGeo, spikeMat);
      spike.rotation.x = Math.PI;
      spike.position.set(x, 0, z);
      group.add(spike);
    }
  }

  return group;
}

// Procedural Laser Grid Mesh
export function createLaserGridMesh(width: number): THREE.Group {
  const group = new THREE.Group();

  // Left & Right Emitter Posts
  const postGeo = new THREE.CylinderGeometry(0.2, 0.25, 2.5, 8);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.9, roughness: 0.2, emissive: 0x06b6d4, emissiveIntensity: 0.4 });
  
  const leftPost = new THREE.Mesh(postGeo, postMat);
  leftPost.position.set(-width / 2, 1.25, 0);
  group.add(leftPost);

  const rightPost = new THREE.Mesh(postGeo, postMat);
  rightPost.position.set(width / 2, 1.25, 0);
  group.add(rightPost);

  // Glowing Laser Beams
  for (let y = 0.4; y <= 2.0; y += 0.5) {
    const beamGeo = new THREE.CylinderGeometry(0.04, 0.04, width, 8);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.rotation.z = Math.PI / 2;
    beam.position.set(0, y, 0);
    group.add(beam);
  }

  return group;
}

// Procedural Boss Mesh Generator
export function createBossMesh(boss: BossData): THREE.Group {
  const group = new THREE.Group();

  switch (boss.modelType) {
    case 'iron_golem': {
      // Mecha Titan
      const bodyGeo = new THREE.BoxGeometry(2.5, 3.2, 1.8);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        metalness: 0.8,
        roughness: 0.2,
        emissive: 0x0ea5e9,
        emissiveIntensity: 0.3,
      });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = 2.8;
      group.add(body);

      // Core Reactor
      const coreGeo = new THREE.SphereGeometry(0.6, 16, 16);
      const coreMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.set(0, 2.8, 0.95);
      group.add(core);

      // Massive Arms
      const armGeo = new THREE.BoxGeometry(0.8, 2.4, 0.8);
      const armMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.9, roughness: 0.2 });
      
      const leftArm = new THREE.Mesh(armGeo, armMat);
      leftArm.position.set(-1.8, 2.5, 0);
      group.add(leftArm);

      const rightArm = new THREE.Mesh(armGeo, armMat);
      rightArm.position.set(1.8, 2.5, 0);
      group.add(rightArm);

      // Head
      const headGeo = new THREE.BoxGeometry(1.2, 1.0, 1.0);
      const head = new THREE.Mesh(headGeo, armMat);
      head.position.set(0, 4.8, 0);
      group.add(head);

      // Glowing Eyes
      const eyeGeo = new THREE.BoxGeometry(0.8, 0.15, 0.2);
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
      const eyes = new THREE.Mesh(eyeGeo, eyeMat);
      eyes.position.set(0, 4.8, 0.55);
      group.add(eyes);
      break;
    }

    case 'magma_colossus': {
      // Fiery Rock Titan
      const rockGeo = new THREE.DodecahedronGeometry(2.0, 1);
      const rockMat = new THREE.MeshStandardMaterial({
        color: 0x451a03,
        metalness: 0.3,
        roughness: 0.9,
        emissive: 0xf97316,
        emissiveIntensity: 0.6,
      });
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.position.y = 3.0;
      group.add(rock);

      // Lava Spikes on Back
      for (let i = 0; i < 6; i++) {
        const spikeGeo = new THREE.ConeGeometry(0.3, 1.5, 4);
        const spikeMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xffedd5, emissiveIntensity: 0.5 });
        const spike = new THREE.Mesh(spikeGeo, spikeMat);
        const angle = (i / 6) * Math.PI * 2;
        spike.position.set(Math.cos(angle) * 1.5, 3.5 + Math.sin(angle) * 0.8, -0.8);
        spike.rotation.x = -0.5;
        group.add(spike);
      }
      break;
    }

    case 'crystal_wyrm': {
      // Segmented Crystal Wyrm
      for (let i = 0; i < 5; i++) {
        const segGeo = new THREE.OctahedronGeometry(1.6 - i * 0.2, 0);
        const segMat = new THREE.MeshStandardMaterial({
          color: 0x10b981,
          metalness: 0.9,
          roughness: 0.1,
          emissive: 0x34d399,
          emissiveIntensity: 0.5,
          wireframe: false,
        });
        const seg = new THREE.Mesh(segGeo, segMat);
        seg.position.set(0, 2.5 + Math.sin(i * 0.8) * 0.8, -i * 1.6);
        group.add(seg);
      }
      break;
    }

    case 'titan_nullifier': {
      // Floating Quantum Geometric Entity
      const coreGeo = new THREE.IcosahedronGeometry(1.8, 1);
      const coreMat = new THREE.MeshStandardMaterial({
        color: 0x6b21a8,
        metalness: 0.8,
        roughness: 0.1,
        emissive: 0xa855f7,
        emissiveIntensity: 0.7,
      });
      const core = new THREE.Mesh(coreGeo, coreMat);
      core.position.y = 3.2;
      group.add(core);

      // Orbiting Quantum Rings
      const ringGeo = new THREE.TorusGeometry(3.0, 0.15, 8, 32);
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xc084fc, wireframe: true });
      const ring1 = new THREE.Mesh(ringGeo, ringMat);
      ring1.position.y = 3.2;
      ring1.rotation.x = 0.5;
      group.add(ring1);
      break;
    }

    case 'apex_overlord':
    default: {
      // Apex Overlord Malakor
      const baseGeo = new THREE.CylinderGeometry(1.2, 1.8, 3.5, 12);
      const baseMat = new THREE.MeshStandardMaterial({
        color: 0x09090b,
        metalness: 0.95,
        roughness: 0.1,
        emissive: 0xd946ef,
        emissiveIntensity: 0.6,
      });
      const base = new THREE.Mesh(baseGeo, baseMat);
      base.position.y = 3.0;
      group.add(base);

      // Floating Crown / Wings
      for (let side of [-1, 1]) {
        const wingGeo = new THREE.BoxGeometry(0.2, 3.0, 1.5);
        const wingMat = new THREE.MeshStandardMaterial({
          color: 0x18181b,
          metalness: 0.9,
          emissive: 0xec4899,
          emissiveIntensity: 0.8,
        });
        const wing = new THREE.Mesh(wingGeo, wingMat);
        wing.position.set(side * 2.2, 3.5, 0.5);
        wing.rotation.z = side * 0.3;
        group.add(wing);
      }
      break;
    }
  }

  return group;
}
