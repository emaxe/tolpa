import * as THREE from 'three';
import { BiomeType, BossData, GateData } from '../types/game';

// Canvas texture generator for Math Gates
export function createGateTexture(
  gate: GateData,
  _theme: BiomeType = 'cyber_city'
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const op = gate.op;
  const val = gate.value;

  const isPositive = op === 'add' || op === 'multiply';
  const isDanger = op === 'divide';

  // Base background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 0, 512);
  if (isPositive) {
    bgGrad.addColorStop(0, 'rgba(6, 182, 212, 0.85)'); // Cyan / Blue
    bgGrad.addColorStop(1, 'rgba(16, 185, 129, 0.75)'); // Emerald
  } else {
    bgGrad.addColorStop(0, 'rgba(239, 68, 68, 0.85)'); // Crimson Red
    bgGrad.addColorStop(1, 'rgba(185, 28, 28, 0.75)');
  }

  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 512, 512);

  // Outer glowing border
  ctx.lineWidth = 24;
  ctx.strokeStyle = isPositive ? '#67e8f9' : '#fca5a5';
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

  // Math gate: +N, ×N, ÷N (все целые)
  let symbol = '+';
  if (op === 'multiply') symbol = '×';
  if (op === 'divide') symbol = '÷';

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 140px Orbitron, sans-serif';
  ctx.fillText(`${symbol}${val}`, 256, 240);

  ctx.font = 'bold 44px Orbitron, sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fillText(isPositive ? 'БОНУС' : 'КВОТА', 256, 380);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Текстура стены со счётчиком: −N, где N — сколько мобов надо убить, пока стена не падёт.
export function createWallTexture(count: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const bgGrad = ctx.createLinearGradient(0, 0, 0, 512);
  bgGrad.addColorStop(0, 'rgba(185, 28, 28, 0.9)');
  bgGrad.addColorStop(1, 'rgba(127, 29, 29, 0.85)');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 512, 512);

  // Красный контур.
  ctx.lineWidth = 24;
  ctx.strokeStyle = '#fca5a5';
  ctx.strokeRect(12, 12, 488, 488);

  // Внутренние «плашки» — стена-шлагбаум.
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  for (let y = 60; y < 512; y += 100) {
    ctx.fillRect(40, y, 432, 28);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 12;

  // Большой «−N» (сколько мобов сожрёт).
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 150px Orbitron, sans-serif';
  ctx.fillText(`−${count}`, 256, 240);

  ctx.font = 'bold 46px Orbitron, sans-serif';
  ctx.fillStyle = '#fca5a5';
  ctx.fillText('СТЕНА', 256, 380);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

// Procedural Humanoid Mesh for Crowd
export function createHumanoidGeometry(): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  // Head (Sphere) — slightly larger, more readable silhouette
  const headGeo = new THREE.SphereGeometry(0.24, 12, 12);
  headGeo.translate(0, 1.3, 0);
  geometries.push(headGeo);

  // Torso (Capsule/Cylinder) — tapered chest with shoulder mass
  const torsoGeo = new THREE.CylinderGeometry(0.2, 0.15, 0.6, 12);
  torsoGeo.translate(0, 0.82, 0);
  geometries.push(torsoGeo);

  // Shoulder pads (cyber armor) — give the silhouette a distinct armored look
  const shoulderGeo = new THREE.SphereGeometry(0.1, 8, 8);
  shoulderGeo.scale(1, 0.7, 1.2);
  shoulderGeo.translate(-0.2, 1.12, 0);
  geometries.push(shoulderGeo);
  const shoulderGeoR = new THREE.SphereGeometry(0.1, 8, 8);
  shoulderGeoR.scale(1, 0.7, 1.2);
  shoulderGeoR.translate(0.2, 1.12, 0);
  geometries.push(shoulderGeoR);

  // Left Leg
  const legGeoL = new THREE.CylinderGeometry(0.07, 0.06, 0.6, 8);
  legGeoL.translate(-0.1, 0.3, 0);
  geometries.push(legGeoL);

  // Right Leg
  const legGeoR = new THREE.CylinderGeometry(0.07, 0.06, 0.6, 8);
  legGeoR.translate(0.1, 0.3, 0);
  geometries.push(legGeoR);

  // Feet (boots) — grounded stance
  const footGeo = new THREE.BoxGeometry(0.12, 0.08, 0.2);
  footGeo.translate(-0.1, 0.04, 0.05);
  geometries.push(footGeo);
  const footGeoR = new THREE.BoxGeometry(0.12, 0.08, 0.2);
  footGeoR.translate(0.1, 0.04, 0.05);
  geometries.push(footGeoR);

  // Left Arm
  const armGeoL = new THREE.CylinderGeometry(0.055, 0.05, 0.5, 8);
  armGeoL.rotateZ(0.2);
  armGeoL.translate(-0.28, 0.85, 0);
  geometries.push(armGeoL);

  // Right Arm
  const armGeoR = new THREE.CylinderGeometry(0.055, 0.05, 0.5, 8);
  armGeoR.rotateZ(-0.2);
  armGeoR.translate(0.28, 0.85, 0);
  geometries.push(armGeoR);

  // Hands (fists)
  const handGeo = new THREE.SphereGeometry(0.06, 6, 6);
  handGeo.translate(-0.3, 0.6, 0);
  geometries.push(handGeo);
  const handGeoR = new THREE.SphereGeometry(0.06, 6, 6);
  handGeoR.translate(0.3, 0.6, 0);
  geometries.push(handGeoR);

  // Visor / Cyber Mask — wider, glowing band across the face
  const visorGeo = new THREE.BoxGeometry(0.26, 0.09, 0.14);
  visorGeo.translate(0, 1.33, 0.15);
  geometries.push(visorGeo);

  // Backpack / jetpack core — cyber runner detail
  const packGeo = new THREE.BoxGeometry(0.2, 0.3, 0.14);
  packGeo.translate(0, 0.95, -0.2);
  geometries.push(packGeo);

  // Chest emblem — glowing core plate on the torso
  const emblemGeo = new THREE.BoxGeometry(0.12, 0.1, 0.03);
  emblemGeo.translate(0, 0.9, 0.2);
  geometries.push(emblemGeo);

  // Knee pads — armored shin guards
  const kneeGeo = new THREE.SphereGeometry(0.05, 6, 6);
  kneeGeo.scale(1, 1, 0.6);
  kneeGeo.translate(-0.1, 0.42, 0.06);
  geometries.push(kneeGeo);
  const kneeGeoR = new THREE.SphereGeometry(0.05, 6, 6);
  kneeGeoR.scale(1, 1, 0.6);
  kneeGeoR.translate(0.1, 0.42, 0.06);
  geometries.push(kneeGeoR);

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

// Procedural Spike Trap Mesh (ground hazard)
export function createSpikeTrapMesh(): THREE.Group {
  const group = new THREE.Group();

  // Base plate
  const baseGeo = new THREE.BoxGeometry(2.2, 0.15, 2.2);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.8,
    roughness: 0.3,
    emissive: 0xdc2626,
    emissiveIntensity: 0.25,
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.1;
  group.add(base);

  // Warning chevron stripes on the plate
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  for (let i = -1; i <= 1; i++) {
    const stripeGeo = new THREE.BoxGeometry(0.12, 0.02, 1.6);
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(i * 0.5, 0.2, 0);
    stripe.rotation.y = Math.PI / 4;
    group.add(stripe);
  }

  // Spikes (retractable cones)
  const spikeMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.95,
    roughness: 0.1,
    emissive: 0xef4444,
    emissiveIntensity: 0.4,
  });
  for (let x = -0.7; x <= 0.7; x += 0.45) {
    for (let z = -0.7; z <= 0.7; z += 0.45) {
      const spikeGeo = new THREE.ConeGeometry(0.12, 0.5, 6);
      const spike = new THREE.Mesh(spikeGeo, spikeMat);
      spike.position.set(x, 0.4, z);
      group.add(spike);
    }
  }

  return group;
}

// Procedural Wrecking Ball Mesh — тяжёлый шипастый шар на цепи, раскачивающийся
// поперёк трассы. Убивает мобов, которых задевает. Разрушаем танками/адреналином.
export function createWreckingBallMesh(): THREE.Group {
  const group = new THREE.Group();

  // Верхняя балка-портальчик (гантри)
  const beamGeo = new THREE.BoxGeometry(4.2, 0.25, 0.25);
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.3 });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 3.6;
  group.add(beam);

  // Опорные столбы гантри
  const postGeo = new THREE.CylinderGeometry(0.12, 0.12, 3.6, 8);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.85, roughness: 0.3 });
  const postL = new THREE.Mesh(postGeo, postMat);
  postL.position.set(-2.0, 1.8, 0);
  group.add(postL);
  const postR = new THREE.Mesh(postGeo, postMat);
  postR.position.set(2.0, 1.8, 0);
  group.add(postR);

  // Цепь от балки к шару
  const chainGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6);
  const chainMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.9, roughness: 0.2 });
  const chain = new THREE.Mesh(chainGeo, chainMat);
  chain.position.y = 2.3;
  group.add(chain);

  // Тяжёлый шипастый шар
  const ballGeo = new THREE.SphereGeometry(1.0, 20, 20);
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0x1f2937,
    metalness: 0.95,
    roughness: 0.15,
    emissive: 0xf97316,
    emissiveIntensity: 0.35,
  });
  const ball = new THREE.Mesh(ballGeo, ballMat);
  ball.position.y = 1.0;
  group.add(ball);

  // Шипы на шаре
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.1 });
  for (let i = 0; i < 10; i++) {
    const phi = (i / 10) * Math.PI * 2;
    const theta = (i % 3) * 0.9 + 0.5;
    const spikeGeo = new THREE.ConeGeometry(0.18, 0.5, 6);
    const spike = new THREE.Mesh(spikeGeo, spikeMat);
    spike.position.set(
      Math.sin(theta) * Math.cos(phi) * 1.05,
      1.0 + Math.cos(theta) * 1.05,
      Math.sin(theta) * Math.sin(phi) * 1.05
    );
    spike.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi)
      )
    );
    group.add(spike);
  }

  return group;
}

// Procedural Lava Pit Mesh — наземная лужа лавы, убивающая мобов, которые в неё ступают.
// Статична (только пульсирующее свечение), неразрушаема.
export function createLavaPitMesh(): THREE.Group {
  const group = new THREE.Group();

  // Каменная окантовка
  const rimGeo = new THREE.BoxGeometry(2.6, 0.2, 2.6);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x1c1917, metalness: 0.6, roughness: 0.8 });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.position.y = 0.1;
  group.add(rim);

  // Лавовая поверхность
  const lavaGeo = new THREE.CylinderGeometry(1.05, 1.05, 0.12, 20);
  const lavaMat = new THREE.MeshStandardMaterial({
    color: 0xea580c,
    metalness: 0.1,
    roughness: 0.4,
    emissive: 0xf97316,
    emissiveIntensity: 0.9,
  });
  const lava = new THREE.Mesh(lavaGeo, lavaMat);
  lava.position.y = 0.18;
  group.add(lava);

  // Внутреннее яркое ядро
  const coreGeo = new THREE.CircleGeometry(0.7, 20);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xffedd5 });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.rotation.x = -Math.PI / 2;
  core.position.y = 0.25;
  group.add(core);

  // Предупреждающие жёлтые метки по краям
  const warnMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const warnGeo = new THREE.BoxGeometry(0.1, 0.04, 0.5);
    const warn = new THREE.Mesh(warnGeo, warnMat);
    warn.position.set(Math.cos(angle) * 1.15, 0.22, Math.sin(angle) * 1.15);
    warn.rotation.y = -angle;
    group.add(warn);
  }

  return group;
}

// Procedural Barrier Gate Mesh — запирающий шлагбаум-стену: две опорные стойки и
// горизонтальная плита-ворота, которая периодически опускается (блокирует полосу) и
// поднимается (пропускает толпу). Опасно только когда плита внизу (проверяется в
// isHazardActive по Y позиции плиты).
export function createBarrierGateMesh(): THREE.Group {
  const group = new THREE.Group();

  // Опорные стойки по краям
  const postGeo = new THREE.CylinderGeometry(0.15, 0.15, 3.4, 8);
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.85,
    roughness: 0.3,
  });
  const postL = new THREE.Mesh(postGeo, postMat);
  postL.position.set(-1.6, 1.7, 0);
  group.add(postL);
  const postR = new THREE.Mesh(postGeo, postMat);
  postR.position.set(1.6, 1.7, 0);
  group.add(postR);

  // Верхняя перекладина
  const topGeo = new THREE.BoxGeometry(3.4, 0.2, 0.25);
  const topMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.85,
    roughness: 0.3,
  });
  const top = new THREE.Mesh(topGeo, topMat);
  top.position.y = 3.3;
  group.add(top);

  // Горизонтальная плита-ворота (светящаяся, съезжает вниз/вверх по циклу).
  // Индекс 3 — дочерний меш, чью Y-позицию читает isHazardActive и update().
  const gateGeo = new THREE.BoxGeometry(3.3, 0.35, 0.3);
  const gateMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.9,
    roughness: 0.15,
    emissive: 0xef4444,
    emissiveIntensity: 0.35,
  });
  const gate = new THREE.Mesh(gateGeo, gateMat);
  gate.position.y = 0.5;
  group.add(gate);

  // Предупреждающие жёлтые полосы на плите
  const warnMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  for (let i = -1; i <= 1; i += 2) {
    const stripeGeo = new THREE.BoxGeometry(0.18, 0.05, 0.32);
    const stripe = new THREE.Mesh(stripeGeo, warnMat);
    stripe.position.set(i * 1.0, 0, 0.16);
    gate.add(stripe);
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

// Procedural Street Lamp Mesh — Г-образный фонарь: столб, изогнутый кронштейн
// и светящийся плафон (MeshBasicMaterial, без PointLight).
export function createStreetLampMesh(): THREE.Group {
  const group = new THREE.Group();

  // Столб
  const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 4.0, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.3 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 2.0;
  group.add(pole);

  // Изогнутый кронштейн (сегменты, образующие дугу к плафону)
  const armMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.85, roughness: 0.3 });
  const segments = 5;
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6);
    const arm = new THREE.Mesh(armGeo, armMat);
    // Дуга: поднимаемся от верха столба и выносим вперёд по +Z
    arm.position.set(0, 4.0 + t * 0.6, t * 1.2);
    arm.rotation.x = -0.5 * t;
    group.add(arm);
  }

  // Плафон — светящаяся сфера
  const lampGeo = new THREE.SphereGeometry(0.28, 12, 12);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff7cc });
  const lamp = new THREE.Mesh(lampGeo, lampMat);
  lamp.position.set(0, 4.7, 1.25);
  group.add(lamp);

  // Внутреннее яркое ядро плафона
  const coreGeo = new THREE.SphereGeometry(0.12, 8, 8);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xfffde7 });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.set(0, 4.7, 1.25);
  group.add(core);

  return group;
}

// Procedural Billboard Mesh — рекламный щит: рама + панель с CanvasTexture
// (текст на градиентном фоне, как в createGateTexture).
export function createBillboardMesh(text: string, accent: number): THREE.Group {
  const group = new THREE.Group();

  // Рама
  const frameGeo = new THREE.BoxGeometry(3.0, 2.0, 0.15);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.8, roughness: 0.3 });
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.y = 2.0;
  group.add(frame);

  // Панель с CanvasTexture
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Градиентный фон
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, `rgba(${(accent >> 16) & 255}, ${(accent >> 8) & 255}, ${accent & 255}, 0.9)`);
  grad.addColorStop(1, 'rgba(10, 10, 20, 0.95)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 256);

  // Светящаяся рамка
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(8, 8, 496, 240);

  // Текст
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px Orbitron, sans-serif';
  ctx.fillText(text, 256, 128);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  const panelGeo = new THREE.PlaneGeometry(2.8, 1.8);
  const panelMat = new THREE.MeshBasicMaterial({ map: texture });
  const panel = new THREE.Mesh(panelGeo, panelMat);
  panel.position.set(0, 2.0, 0.08);
  group.add(panel);

  // Опорные ножки
  const legGeo = new THREE.CylinderGeometry(0.1, 0.12, 1.0, 6);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.3 });
  const legL = new THREE.Mesh(legGeo, legMat);
  legL.position.set(-1.2, 0.5, 0);
  group.add(legL);
  const legR = new THREE.Mesh(legGeo, legMat);
  legR.position.set(1.2, 0.5, 0);
  group.add(legR);

  return group;
}

// Procedural Flag Mesh — шест + полупрозрачное полотнище.
// userData.animate = 'flag' для покачивания в update-цикле.
export function createFlagMesh(color: number): THREE.Group {
  const group = new THREE.Group();

  // Шест
  const poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 4.0, 6);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.3 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.y = 2.0;
  group.add(pole);

  // Полотнище — полупрозрачное
  const flagGeo = new THREE.PlaneGeometry(1.4, 0.8);
  const flagMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
  });
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(0.7, 3.4, 0);
  group.add(flag);

  // Навершие
  const tipGeo = new THREE.SphereGeometry(0.1, 6, 6);
  const tipMat = new THREE.MeshBasicMaterial({ color });
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.position.y = 4.0;
  group.add(tip);

  group.userData.animate = 'flag';
  return group;
}

// Procedural Drone Mesh — летающий транспорт: корпус, пропеллеры, светящиеся огни.
// userData.animate = 'drone' для парения в update-цикле.
export function createDroneMesh(accent: number): THREE.Group {
  const group = new THREE.Group();

  // Корпус
  const bodyGeo = new THREE.BoxGeometry(0.7, 0.25, 0.7);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.85,
    roughness: 0.25,
    emissive: accent,
    emissiveIntensity: 0.3,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);

  // Пропеллеры (4 шт.)
  const propMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.2 });
  const armMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.85, roughness: 0.3 });
  const offsets = [
    [-0.5, 0.5],
    [0.5, 0.5],
    [-0.5, -0.5],
    [0.5, -0.5],
  ];
  for (const [ox, oz] of offsets) {
    const armGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.5, 4);
    const arm = new THREE.Mesh(armGeo, armMat);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(ox * 0.5, 0.1, oz * 0.5);
    group.add(arm);

    const propGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.03, 12);
    const prop = new THREE.Mesh(propGeo, propMat);
    prop.position.set(ox * 0.5, 0.2, oz * 0.5);
    group.add(prop);
  }

  // Светящиеся огни
  const lightMat = new THREE.MeshBasicMaterial({ color: accent });
  const lightGeo = new THREE.SphereGeometry(0.06, 6, 6);
  const light = new THREE.Mesh(lightGeo, lightMat);
  light.position.set(0, 0.2, 0);
  group.add(light);

  const redMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const redGeo = new THREE.SphereGeometry(0.05, 6, 6);
  const red = new THREE.Mesh(redGeo, redMat);
  red.position.set(0, -0.15, 0.35);
  group.add(red);

  group.userData.animate = 'drone';
  return group;
}

// Procedural Confetti Geometry — маленький плоский квадрат для конфетти.
// Возвращает BufferGeometry, готовую к использованию в InstancedMesh.
export function createConfettiGeometry(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(0.12, 0.12);
  geo.rotateX(-Math.PI / 2);
  return geo;
}
