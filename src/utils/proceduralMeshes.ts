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

  // Шлем-гребень / тактический плавник (читаемый силуэт сверху и сзади)
  const crestGeo = new THREE.BoxGeometry(0.04, 0.12, 0.28);
  crestGeo.translate(0, 1.54, 0.02);
  geometries.push(crestGeo);

  // Шейный переход (связывает голову с плечами)
  const neckGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.12, 8);
  neckGeo.translate(0, 1.18, 0);
  geometries.push(neckGeo);

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

  // Наручи / броня предплечий (заполняют пустоту между локтем и кулаком)
  const bracerGeoL = new THREE.BoxGeometry(0.08, 0.16, 0.09);
  bracerGeoL.rotateZ(0.2);
  bracerGeoL.translate(-0.30, 0.72, 0);
  geometries.push(bracerGeoL);
  const bracerGeoR = new THREE.BoxGeometry(0.08, 0.16, 0.09);
  bracerGeoR.rotateZ(-0.2);
  bracerGeoR.translate(0.30, 0.72, 0);
  geometries.push(bracerGeoR);

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

  // Двойные дюзы джетпака (вид со спины)
  const thrusterGeoL = new THREE.CylinderGeometry(0.035, 0.045, 0.10, 6);
  thrusterGeoL.translate(-0.06, 0.82, -0.25);
  geometries.push(thrusterGeoL);
  const thrusterGeoR = new THREE.CylinderGeometry(0.035, 0.045, 0.10, 6);
  thrusterGeoR.translate(0.06, 0.82, -0.25);
  geometries.push(thrusterGeoR);

  // Chest emblem — glowing core plate on the torso
  const emblemGeo = new THREE.BoxGeometry(0.12, 0.1, 0.03);
  emblemGeo.translate(0, 0.9, 0.2);
  geometries.push(emblemGeo);

  // Грудное ядро (объёмный октаэдр под общее свечение)
  const coreGeo = new THREE.OctahedronGeometry(0.08);
  coreGeo.translate(0, 0.92, 0.22);
  geometries.push(coreGeo);

  // Тактический бронепояс (разграничивает торс и ноги)
  const beltGeo = new THREE.BoxGeometry(0.34, 0.06, 0.22);
  beltGeo.translate(0, 0.58, 0);
  geometries.push(beltGeo);

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

/**
 * Геометрия зрителя на трибуне — упрощённый человечек БЕЗ статичных рук
 * (руки анимируются отдельными InstancedMesh в GameEngine, чтобы не было
 * «3 рук»). Чуть шире плечи и явная голова, чтобы силуэт читался издали.
 */
export function createSpectatorGeometry(): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];

  // Голова (чуть крупнее для читаемости с трибуны)
  const headGeo = new THREE.SphereGeometry(0.26, 10, 10);
  headGeo.translate(0, 1.35, 0);
  geometries.push(headGeo);

  // Торс — широкие плечи, сужение к талии
  const torsoGeo = new THREE.CylinderGeometry(0.24, 0.16, 0.62, 10);
  torsoGeo.translate(0, 0.85, 0);
  geometries.push(torsoGeo);

  // Наплечники (кибер-броня) — шире, чтобы силуэт читался
  const shoulderGeo = new THREE.SphereGeometry(0.12, 8, 8);
  shoulderGeo.scale(1, 0.7, 1.2);
  shoulderGeo.translate(-0.24, 1.16, 0);
  geometries.push(shoulderGeo);
  const shoulderGeoR = new THREE.SphereGeometry(0.12, 8, 8);
  shoulderGeoR.scale(1, 0.7, 1.2);
  shoulderGeoR.translate(0.24, 1.16, 0);
  geometries.push(shoulderGeoR);

  // Ноги
  const legGeoL = new THREE.CylinderGeometry(0.075, 0.065, 0.6, 8);
  legGeoL.translate(-0.11, 0.3, 0);
  geometries.push(legGeoL);
  const legGeoR = new THREE.CylinderGeometry(0.075, 0.065, 0.6, 8);
  legGeoR.translate(0.11, 0.3, 0);
  geometries.push(legGeoR);

  // Ступни
  const footGeo = new THREE.BoxGeometry(0.13, 0.08, 0.2);
  footGeo.translate(-0.11, 0.04, 0.05);
  geometries.push(footGeo);
  const footGeoR = new THREE.BoxGeometry(0.13, 0.08, 0.2);
  footGeoR.translate(0.11, 0.04, 0.05);
  geometries.push(footGeoR);

  // Визор / кибер-маска — светящаяся полоса через лицо
  const visorGeo = new THREE.BoxGeometry(0.28, 0.1, 0.15);
  visorGeo.translate(0, 1.38, 0.16);
  geometries.push(visorGeo);

  // Нагрудный эмблема-пластина
  const emblemGeo = new THREE.BoxGeometry(0.13, 0.11, 0.03);
  emblemGeo.translate(0, 0.92, 0.21);
  geometries.push(emblemGeo);

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

// Procedural Saw Blade Mesh — вращающийся шипастый диск на полу.
// Лежит горизонтально (плоскость XZ, ось вращения Y), поднят чуть над настилом,
// чтобы с камеры за толпой читался как ОПАСНЫЙ вращающийся диск, а не как
// тёмная «палка на полу». Яркие зубья + светящееся кольцо + ступица.
export function createSawBladeMesh(): THREE.Group {
  const group = new THREE.Group();

  // Вращающаяся группа: сам диск с зубьями (анимируется в ObstacleManager.update).
  const spin = new THREE.Group();
  spin.position.y = 0.55; // чуть выше настила, чтобы диск был виден сбоку

  // Ступица-вал по центру (вертикальный, ось вращения Y)
  const hubGeo = new THREE.CylinderGeometry(0.28, 0.32, 0.5, 12);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9, roughness: 0.25 });
  const hub = new THREE.Mesh(hubGeo, hubMat);
  hub.position.y = 0.05;
  spin.add(hub);

  // Диск лезвия — горизонтальная пластина
  const discGeo = new THREE.CylinderGeometry(1.25, 1.25, 0.09, 28);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    metalness: 0.95,
    roughness: 0.15,
    emissive: 0x94a3b8,
    emissiveIntensity: 0.7,
  });
  const disc = new THREE.Mesh(discGeo, bladeMat);
  spin.add(disc);

  // Высококонтрастная стрелка-спица на поверхности диска. Крутится вместе с
  // диском и делает вращение читаемым с плоского ракурса камеры: без неё
  // плоский светлый диск на тёмном настиле сливается в «тёмную палку».
  // Жёлтая, яркая, не влияет на кольцо (кольцо остаётся тонким).
  const spokeMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  const spokeBody = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 2.2), spokeMat);
  spokeBody.position.y = 0.06;
  spin.add(spokeBody);
  const spokeHead = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), spokeMat);
  spokeHead.rotation.x = Math.PI / 2;
  spokeHead.position.set(0, 0.06, 1.25);
  spin.add(spokeHead);

  // Светящееся кольцо по краю лезвия — обозначает опасную зону
  const ringGeo = new THREE.TorusGeometry(1.25, 0.06, 8, 48);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  spin.add(ring);

  // Крупные яркие зубья по периметру (смотрят наружу, выделяются на тёмном настиле)
  const teethCount = 12;
  const toothMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    metalness: 0.8,
    roughness: 0.2,
    emissive: 0xef4444,
    emissiveIntensity: 0.5,
  });
  for (let i = 0; i < teethCount; i++) {
    const angle = (i / teethCount) * Math.PI * 2;
    const toothGeo = new THREE.BoxGeometry(0.22, 0.5, 0.22);
    const tooth = new THREE.Mesh(toothGeo, toothMat);
    tooth.position.set(Math.cos(angle) * 1.35, 0, Math.sin(angle) * 1.35);
    tooth.rotation.z = -angle;
    spin.add(tooth);
  }

  group.add(spin);
  return group;
}

// Procedural Pendulum Axe Mesh
export function createPendulumAxeMesh(): THREE.Group {
  const group = new THREE.Group();

  // Arm/Shaft — светлый, чтобы не сливался с тёмным настилом.
  const armGeo = new THREE.CylinderGeometry(0.14, 0.14, 3.5, 8);
  const armMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.25 });
  const arm = new THREE.Mesh(armGeo, armMat);
  arm.position.y = -1.75;
  group.add(arm);

  // Crescent Blade — крупная, яркая голова-топор (главный визуальный маркер)
  const bladeGeo = new THREE.TorusGeometry(1.1, 0.2, 12, 20, Math.PI);
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xfdba74,
    metalness: 0.9,
    roughness: 0.15,
    emissive: 0xf97316,
    emissiveIntensity: 0.55,
  });
  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  blade.position.y = -3.35;
  blade.rotation.z = Math.PI / 2;
  group.add(blade);

  // Яркое лезвийное остриё в нижней точке дуги (острая часть топора)
  const tipGeo = new THREE.ConeGeometry(0.14, 0.5, 6);
  const tipMat = new THREE.MeshStandardMaterial({
    color: 0xfca5a5,
    metalness: 0.95,
    roughness: 0.1,
    emissive: 0xef4444,
    emissiveIntensity: 0.6,
  });
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.position.y = -3.85;
  tip.rotation.z = Math.PI;
  group.add(tip);

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

// Procedural Bomb Mesh — мина с AoE радиусом.
// children[0] — верхний мигающий диод-маячок (пульсирует в update).
// children[1] — нижняя магнитная подставка-диск.
// children[2] — сферический корпус мины.
export function createBombMesh(): THREE.Group {
  const group = new THREE.Group();

  // 0. Верхний мигающий диод-маячок (индекс 0 для быстрой анимации пульсации)
  const beaconGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.22, 8);
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xef4444,
    emissiveIntensity: 1.0,
    roughness: 0.2,
  });
  const beacon = new THREE.Mesh(beaconGeo, beaconMat);
  beacon.position.y = 1.65;
  group.add(beacon);

  // 1. Нижняя магнитная подставка-диск
  const baseGeo = new THREE.CylinderGeometry(0.7, 0.85, 0.16, 12);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.3 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.08;
  group.add(base);

  // 2. Сферический корпус мины
  const bodyGeo = new THREE.SphereGeometry(0.85, 14, 14);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    metalness: 0.8,
    roughness: 0.2,
    emissive: 0xef4444,
    emissiveIntensity: 0.4,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.85;
  group.add(body);

  // 3..6. 4 шипа-детонатора по горизонтальным осям
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0x71717a, metalness: 0.9, roughness: 0.2 });
  const angles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
  for (let i = 0; i < 4; i++) {
    const spikeGeo = new THREE.ConeGeometry(0.14, 0.45, 6);
    const spike = new THREE.Mesh(spikeGeo, spikeMat);
    const ang = angles[i];
    spike.position.set(Math.cos(ang) * 0.9, 0.85, Math.sin(ang) * 0.9);
    spike.rotation.z = Math.PI / 2;
    spike.rotation.y = -ang;
    group.add(spike);
  }

  return group;
}

// Procedural Guard Dog Mesh — кибер-собака на энергетической цепи.
// children[0] — анкерный столб-цилиндр на полу.
// children[1] — энергетическая цепь (цилиндр от столба к собаке).
// children[2] — корпус собаки (THREE.Group: торс, лапы, голова, пасть, хвост).
// Внутри dogGroup (children[2]): children[3] — нижняя челюсть / пасть для анимации укуса.
export function createGuardDogMesh(): THREE.Group {
  const group = new THREE.Group();

  // 0. Анкерный столб на полу
  const postGeo = new THREE.CylinderGeometry(0.2, 0.28, 0.45, 8);
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    metalness: 0.9,
    roughness: 0.25,
    emissive: 0xa855f7,
    emissiveIntensity: 0.3,
  });
  const post = new THREE.Mesh(postGeo, postMat);
  post.position.y = 0.22;
  group.add(post);

  // 1. Энергетическая цепь (динамически ориентируется в update)
  const chainGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6);
  const chainMat = new THREE.MeshStandardMaterial({
    color: 0xc084fc,
    emissive: 0xa855f7,
    emissiveIntensity: 0.8,
    roughness: 0.3,
  });
  const chain = new THREE.Mesh(chainGeo, chainMat);
  chain.position.set(0, 0.25, 0.5);
  chain.rotation.x = Math.PI / 2;
  group.add(chain);

  // 2. Корпус собаки (группа) — двигается в update по свободному радиусу
  const dogGroup = new THREE.Group();
  dogGroup.position.set(0, 0, 1.4);

  // 2.0. Угловатый торс
  const bodyGeo = new THREE.BoxGeometry(0.55, 0.42, 0.9);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.8,
    roughness: 0.3,
    emissive: 0xa855f7,
    emissiveIntensity: 0.25,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.45;
  dogGroup.add(body);

  // 2.1. Голова-шарнир (наклоняется вниз-вверх для анимации нюхания/атаки)
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.62, 0.55);

  const headGeo = new THREE.BoxGeometry(0.38, 0.3, 0.42);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.2 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.set(0, 0.03, 0);
  headPivot.add(head);

  // 2.2. Красный визор-глаза
  const eyeGeo = new THREE.BoxGeometry(0.3, 0.07, 0.08);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const eyes = new THREE.Mesh(eyeGeo, eyeMat);
  eyes.position.set(0, 0.08, 0.2);
  headPivot.add(eyes);

  // 2.3. Подвижная пасть / нижняя челюсть (открывается при атаке)
  const jawGeo = new THREE.BoxGeometry(0.32, 0.1, 0.32);
  const jawMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.85,
    roughness: 0.2,
    emissive: 0xef4444,
    emissiveIntensity: 0.4,
  });
  const jaw = new THREE.Mesh(jawGeo, jawMat);
  jaw.position.set(0, -0.09, 0.06);
  headPivot.add(jaw);

  dogGroup.add(headPivot);

  // 2.4..2.7. Кибер-лапы (4 лапы-шарнира, качаются при ходьбе).
  // Каждая лапа = pivot (вверху) + нога-цилиндр вниз.
  const legGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.35, 6);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.85, roughness: 0.2 });
  const legPositions = [
    [-0.24, 0.32, 0.35],
    [0.24, 0.32, 0.35],
    [-0.24, 0.32, -0.35],
    [0.24, 0.32, -0.35],
  ];
  legPositions.forEach(([lx, ly, lz]) => {
    const legPivot = new THREE.Group();
    legPivot.position.set(lx, ly, lz);
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.y = -0.17;
    legPivot.add(leg);
    dogGroup.add(legPivot);
  });

  // 2.8. Хвост-шарнир (виляет при ходьбе, прижимается при атаке)
  const tailPivot = new THREE.Group();
  tailPivot.position.set(0, 0.7, -0.55);
  const tailGeo = new THREE.CylinderGeometry(0.02, 0.03, 0.4, 4);
  const tail = new THREE.Mesh(tailGeo, legMat);
  tail.position.y = -0.2;
  tail.rotation.x = -Math.PI / 4;
  tailPivot.add(tail);
  dogGroup.add(tailPivot);

  // Неоновые полосы на боках торса
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xc084fc });
  const stripeL = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.7), stripeMat);
  stripeL.position.set(0.28, 0.45, 0);
  dogGroup.add(stripeL);
  const stripeR = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.7), stripeMat);
  stripeR.position.set(-0.28, 0.45, 0);
  dogGroup.add(stripeR);

  group.add(dogGroup);
  return group;
}

// Procedural Swinging Hammer Mesh — гидравлический молот, качающийся вдоль трассы (плоскость YZ).
// children[0] — верхняя балка портальной рамы.
// children[1] — левая опора.
// children[2] — правая опора.
// children[3] — наковальня-плита на настиле.
// children[4] — подвижный качающийся боёк-шарнир (THREE.Group: штанга + ударная голова с полосами).
export function createSwingingHammerMesh(): THREE.Group {
  const group = new THREE.Group();

  // 0. Верхняя балка-портал
  const beamGeo = new THREE.BoxGeometry(3.6, 0.35, 0.35);
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.25 });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = 3.6;
  group.add(beam);

  // 1. Левая опорная стойка
  const postGeo = new THREE.CylinderGeometry(0.14, 0.16, 3.6, 8);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 });
  const postL = new THREE.Mesh(postGeo, postMat);
  postL.position.set(-1.7, 1.8, 0);
  group.add(postL);

  // 2. Правая опорная стойка
  const postR = new THREE.Mesh(postGeo, postMat);
  postR.position.set(1.7, 1.8, 0);
  group.add(postR);

  // 3. Плита-наковальня на настиле
  const anvilGeo = new THREE.BoxGeometry(2.4, 0.16, 2.0);
  const anvilMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.9,
    roughness: 0.2,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.2,
  });
  const anvil = new THREE.Mesh(anvilGeo, anvilMat);
  anvil.position.y = 0.08;
  group.add(anvil);

  // 4. Подвижная группа шарнира бойка (качается вокруг оси X, в плоскости YZ)
  const hammerPivot = new THREE.Group();
  hammerPivot.position.set(0, 3.6, 0);

  // Штанга молота
  const shaftGeo = new THREE.CylinderGeometry(0.09, 0.09, 2.9, 8);
  const shaftMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.9, roughness: 0.2 });
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  shaft.position.y = -1.45;
  hammerPivot.add(shaft);

  // Массивная ударная голова молота
  const headGeo = new THREE.BoxGeometry(1.8, 0.85, 1.1);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    metalness: 0.85,
    roughness: 0.25,
    emissive: 0xfacc15,
    emissiveIntensity: 0.35,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = -2.9;
  hammerPivot.add(head);

  // Предупреждающие желто-черные полосы на бойке
  const warnMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  for (let i = -1; i <= 1; i += 2) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.86, 1.12), warnMat);
    stripe.position.set(i * 0.55, -2.9, 0);
    hammerPivot.add(stripe);
  }

  group.add(hammerPivot);
  return group;
}

// Procedural Rolling Spike Ball Mesh — тяжёлый шипастый шар, катящийся навстречу толпе.
// children[0] — вращающаяся сфера с коническими шипами и светящимся кольцом.
export function createRollingSpikeBallMesh(): THREE.Group {
  const group = new THREE.Group();

  // 0. Вращающаяся сфера-шар
  const ballGroup = new THREE.Group();
  ballGroup.position.y = 1.05;

  // Ядро — светло-металлическое с оранжевым свечением, чтобы НЕ сливаться с тёмным
  // настилом (раньше почти чёрный 0x09090b читался как «чёрная палка на полу»).
  const coreGeo = new THREE.SphereGeometry(1.0, 16, 16);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    metalness: 0.5,
    roughness: 0.35,
    emissive: 0xd97706,
    emissiveIntensity: 0.8,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  ballGroup.add(coreMesh);

  // Два перекрещивающихся светящихся кольца — сразу читается сфера, а не диск/палка.
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xfff7ed });
  const ringGeo = new THREE.TorusGeometry(1.02, 0.09, 8, 24);
  const ringA = new THREE.Mesh(ringGeo, ringMat);
  ballGroup.add(ringA);
  const ringB = new THREE.Mesh(ringGeo.clone(), ringMat);
  ringB.rotation.y = Math.PI / 2;
  ballGroup.add(ringB);

  // Крупные ярко-оранжевые конические шипы по поверхности — вращение видно явно.
  const spikeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.8,
    roughness: 0.2,
    emissive: 0xf97316,
    emissiveIntensity: 1.0,
  });
  for (let i = 0; i < 12; i++) {
    const phi = (i / 12) * Math.PI * 2;
    const theta = (i % 3) * 0.9 + 0.5;
    const spikeGeo = new THREE.ConeGeometry(0.22, 0.65, 6);
    const spike = new THREE.Mesh(spikeGeo, spikeMat);
    const x = Math.sin(theta) * Math.cos(phi) * 1.1;
    const y = Math.cos(theta) * 1.1;
    const z = Math.sin(theta) * Math.sin(phi) * 1.1;
    spike.position.set(x, y, z);
    spike.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(x, y, z).normalize()
    );
    ballGroup.add(spike);
  }

  group.add(ballGroup);
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

// ============================================================================
// МОДЕЛИ СКИНОВ (уникальные 3D-формы для лидера)
// ----------------------------------------------------------------------------
// Каждый скин в INITIAL_SKINS имеет modelStyle. Базовые скины (category:
// 'humanoid') используют стандартную геометрию бойца createHumanoidGeometry().
// Экзотические скины (животные, еда, существа, меха) получают уникальную
// процедурную форму через createLeaderSkinModel(style, colorHex, emissiveHex).
// Все модели строятся на месте с нулевой GC-нагрузкой во время игрового цикла:
// геометрии кэшируются в CrowdManager и переиспользуются между забегами.
// ============================================================================

/**
 * Уникальная 3D-модель лидера по стилю скина. Возвращает Group с одним или
 * несколькими мешами (≤ ~400 треугольников). Точка опоры (y=0) — подошва/низ
 * модели, чтобы лидер стоял на земле вместе с толпой.
 */
export function createSkinLeaderModel(style: string, colorHex: string, emissiveHex: string): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex),
    roughness: 0.45,
    metalness: 0.4,
    emissive: new THREE.Color(emissiveHex),
    emissiveIntensity: 0.4,
  });
  const make = (geo: THREE.BufferGeometry): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  switch (style) {
    case 'banana': {
      // Изогнутое тело
      const body = bananaCylinder(0.26, 1.5, 8, 0.32);
      make(body);
      // Черенок сверху
      const tip = boxGeo(0.09, 0.14, 0.22);
      tip.translate(0, 1.1, 0);
      make(tip);
      // Ножки в кроссовках
      const leg = boxGeo(0.09, 0.22, 0.12);
      leg.translate(-0.1, 0.11, 0);
      make(leg);
      const leg2 = boxGeo(0.09, 0.22, 0.12);
      leg2.translate(0.1, 0.11, 0);
      make(leg2);
      // Ручки-перчатки
      const arm = boxGeo(0.07, 0.16, 0.08);
      arm.translate(-0.32, 0.75, 0);
      make(arm);
      const arm2 = boxGeo(0.07, 0.16, 0.08);
      arm2.translate(0.32, 0.75, 0);
      make(arm2);
      // Тёмные очки
      const glasses = boxGeo(0.3, 0.09, 0.06);
      glasses.translate(0, 0.95, 0.2);
      make(glasses);
      return group;
    }

    case 'duck': {
      // Туловище (сплюснутая сфера)
      const body = sphereGeo(0.4, 10, 8);
      body.scale(1, 0.9, 1.25);
      body.translate(0, 0.55, 0);
      make(body);
      // Голова
      const head = sphereGeo(0.26, 8, 8);
      head.translate(0, 1.1, 0.18);
      make(head);
      // Клюв
      const beak = boxGeo(0.22, 0.06, 0.22);
      beak.translate(0, 1.02, 0.45);
      make(beak);
      // Хвостик
      const tail = coneGeo(0.12, 0.28, 5);
      tail.rotateX(-Math.PI / 2);
      tail.translate(0, 0.75, -0.42);
      make(tail);
      // Лапки
      const foot = boxGeo(0.16, 0.05, 0.26);
      foot.translate(-0.13, 0.03, 0.05);
      make(foot);
      const foot2 = boxGeo(0.16, 0.05, 0.26);
      foot2.translate(0.13, 0.03, 0.05);
      make(foot2);
      return group;
    }

    case 'panda': {
      // Пухлое тело
      const body = sphereGeo(0.46, 10, 10);
      body.scale(1.1, 1.0, 1.0);
      body.translate(0, 0.55, 0);
      make(body);
      // Голова
      const head = sphereGeo(0.3, 10, 8);
      head.translate(0, 1.12, 0);
      make(head);
      // Ушки
      const ear = sphereGeo(0.1, 6, 6);
      ear.translate(-0.22, 1.38, 0);
      make(ear);
      const ear2 = sphereGeo(0.1, 6, 6);
      ear2.translate(0.22, 1.38, 0);
      make(ear2);
      // Тёмные очки вокруг глаз
      const patch = boxGeo(0.16, 0.12, 0.05);
      patch.translate(-0.12, 1.15, 0.24);
      make(patch);
      const patch2 = boxGeo(0.16, 0.12, 0.05);
      patch2.translate(0.12, 1.15, 0.24);
      make(patch2);
      // Лапы
      const paw = boxGeo(0.18, 0.5, 0.16);
      paw.translate(-0.2, 0.25, 0);
      make(paw);
      const paw2 = boxGeo(0.18, 0.5, 0.16);
      paw2.translate(0.2, 0.25, 0);
      make(paw2);
      // Бамбук за спиной
      const bamboo = cylinderGeo(0.06, 0.06, 1.2, 6);
      bamboo.rotateX(0.5);
      bamboo.translate(0, 0.7, -0.35);
      make(bamboo);
      return group;
    }

    case 'burger': {
      // Верхняя булочка (полусфера)
      const top = sphereGeo(0.44, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      top.translate(0, 0.92, 0);
      make(top);
      // Кунжут
      const seed = sphereGeo(0.04, 4, 4);
      seed.translate(0.2, 1.28, 0.15);
      make(seed);
      const seed2 = sphereGeo(0.04, 4, 4);
      seed2.translate(-0.15, 1.32, -0.1);
      make(seed2);
      const seed3 = sphereGeo(0.04, 4, 4);
      seed3.translate(0.05, 1.35, 0.2);
      make(seed3);
      // Котлета
      const patty = cylinderGeo(0.42, 0.42, 0.16, 10);
      patty.translate(0, 0.75, 0);
      make(patty);
      // Сыр
      const cheese = boxGeo(0.55, 0.04, 0.55);
      cheese.translate(0, 0.68, 0);
      make(cheese);
      // Нижняя булочка
      const bottom = cylinder(0.4, 0.38, 0.14, 10);
      bottom.translate(0, 0.5, 0);
      make(bottom);
      // Ножки
      const leg = boxGeo(0.1, 0.42, 0.12);
      leg.translate(-0.14, 0.18, 0);
      make(leg);
      const leg2 = boxGeo(0.1, 0.42, 0.12);
      leg2.translate(0.14, 0.18, 0);
      make(leg2);
      // Ручки
      const arm = boxGeo(0.08, 0.3, 0.09);
      arm.translate(-0.3, 0.55, 0);
      make(arm);
      const arm2 = boxGeo(0.08, 0.3, 0.09);
      arm2.translate(0.3, 0.55, 0);
      make(arm2);
      return group;
    }

    case 'dog': {
      // Тело (горизонтальная капсула вдоль Z)
      const body = cylinder(0.26, 0.24, 0.75, 8);
      body.rotateX(Math.PI / 2);
      body.translate(0, 0.55, 0);
      make(body);
      // Голова
      const head = boxGeo(0.3, 0.28, 0.34);
      head.translate(0, 0.72, 0.42);
      make(head);
      // Нос
      const nose = boxGeo(0.12, 0.1, 0.14);
      nose.translate(0, 0.68, 0.62);
      make(nose);
      // Уши
      const ear = coneGeo(0.1, 0.24, 4);
      ear.translate(-0.16, 0.9, 0.45);
      make(ear);
      const ear2 = coneGeo(0.1, 0.24, 4);
      ear2.translate(0.16, 0.9, 0.45);
      make(ear2);
      // Хвост
      const tail = coneGeo(0.09, 0.3, 5);
      tail.rotateX(Math.PI / 2);
      tail.translate(0, 0.72, -0.42);
      make(tail);
      // Лапки
      for (const dx of [-0.14, 0.14]) {
        for (const dz of [0.16, -0.16]) {
          const leg = boxGeo(0.1, 0.28, 0.1);
          leg.translate(dx, 0.15, dz);
          make(leg);
        }
      }
      return group;
    }

    case 'demon': {
      // Торс
      const body = cylinder(0.24, 0.16, 0.7, 10);
      body.translate(0, 0.85, 0);
      make(body);
      // Голова
      const head = sphereGeo(0.22, 8, 8);
      head.translate(0, 1.28, 0);
      make(head);
      // Рога
      const horn = coneGeo(0.08, 0.35, 6);
      horn.rotateZ(0.6);
      horn.translate(-0.16, 1.55, 0.05);
      make(horn);
      const horn2 = coneGeo(0.08, 0.35, 6);
      horn2.rotateZ(-0.6);
      horn2.translate(0.16, 1.55, 0.05);
      make(horn2);
      // Крылья за спиной
      const wing = coneGeo(0.06, 0.5, 4);
      wing.rotateY(0.4);
      wing.rotateZ(-0.2);
      wing.translate(-0.32, 1.0, -0.2);
      make(wing);
      const wing2 = coneGeo(0.06, 0.5, 4);
      wing2.rotateY(-0.4);
      wing2.rotateZ(0.2);
      wing2.translate(0.32, 1.0, -0.2);
      make(wing2);
      // Хвост
      const tail = coneGeo(0.05, 0.4, 5);
      tail.rotateX(Math.PI / 2);
      tail.translate(0, 0.5, -0.4);
      make(tail);
      return group;
    }

    case 'titan': {
      // Массивный торс
      const torso = boxGeo(0.5, 0.7, 0.4);
      torso.translate(0, 0.85, 0);
      make(torso);
      // Плечи
      const shoulder = boxGeo(0.34, 0.24, 0.24);
      shoulder.translate(-0.38, 1.2, 0);
      make(shoulder);
      const shoulder2 = boxGeo(0.34, 0.24, 0.24);
      shoulder2.translate(0.38, 1.2, 0);
      make(shoulder2);
      // Ракетные блоки на плечах
      const rocket = boxGeo(0.16, 0.2, 0.3);
      rocket.translate(-0.38, 1.38, 0);
      make(rocket);
      const rocket2 = boxGeo(0.16, 0.2, 0.3);
      rocket2.translate(0.38, 1.38, 0);
      make(rocket2);
      // Голова
      const head = boxGeo(0.22, 0.22, 0.22);
      head.translate(0, 1.5, 0);
      make(head);
      // Ноги
      const leg = boxGeo(0.2, 0.55, 0.22);
      leg.translate(-0.13, 0.28, 0);
      make(leg);
      const leg2 = boxGeo(0.2, 0.55, 0.22);
      leg2.translate(0.13, 0.28, 0);
      make(leg2);
      return group;
    }

    case 'samurai': {
      // Стандартный гуманоид + шлем кабуто и катана
      const geo = createHumanoidGeometry();
      const human = new THREE.Mesh(geo, mat);
      human.castShadow = true;
      human.receiveShadow = true;
      group.add(human);
      // Шлем с полумесяцем
      const helm = sphereGeo(0.26, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      helm.translate(0, 1.35, 0);
      make(helm);
      // Полумесяц на лбу
      const moon = boxGeo(0.3, 0.08, 0.05);
      moon.translate(0, 1.5, 0.16);
      make(moon);
      // Катана за спиной
      const katana = boxGeo(0.06, 0.9, 0.05);
      katana.rotateX(0.45);
      katana.translate(0.3, 1.0, -0.28);
      make(katana);
      return group;
    }

    // Базовые humanoid-скины и всё остальное — стандартная модель бойца.
    case 'cyber':
    case 'neon':
    case 'gold':
    case 'ghost':
    case 'clown':
    case 'zombie':
    default: {
      const body = createHumanoidGeo();
      const m = new THREE.Mesh(body, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
      return group;
    }
  }
}

// --- Вспомогательные конструкторы геометрий (короткие псевдонимы) -----------

function boxGeo(w: number, h: number, d: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(w, h, d);
}
function sphereGeo(
  r: number,
  w: number,
  h: number,
  phiStart = 0,
  phiLength = Math.PI * 2,
  thetaStart = 0,
  thetaLength = Math.PI
): THREE.SphereGeometry {
  return new THREE.SphereGeometry(r, w, h, phiStart, phiLength, thetaStart, thetaLength);
}
function cylinderGeo(rt: number, rb: number, height: number, seg: number): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(rt, rb, height, seg);
}
function coneGeo(r: number, height: number, seg: number): THREE.ConeGeometry {
  return new THREE.ConeGeometry(r, height, seg);
}
function cylinder(rt: number, rb: number, height: number, seg: number): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(rt, rb, height, seg);
}
// Псевдоним для читаемости (банан)
function bananaCylinder(rt: number, height: number, seg: number, bend: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(rt, rt, height, seg, 4, false);
  const pos = geo.attributes.position.array as Float32Array;
  for (let i = 0; i < pos.length; i += 3) {
    const z = pos[i + 2];
    pos[i] += Math.sin((z / height) * Math.PI) * bend;
  }
  geo.computeVertexNormals();
  return geo;
}
// Псевдоним createHumanoidGeometry для локального использования
function createHumanoidGeo(): THREE.BufferGeometry {
  return createHumanoidGeometry();
}
