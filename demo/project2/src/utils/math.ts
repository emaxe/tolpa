import { FormationType } from '../types/game';

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Calculate mob positions based on crowd count and formation
export function calculateFormationOffset(
  index: number,
  totalCount: number,
  formation: FormationType,
  _crowdRadius?: number
): { x: number; z: number } {
  switch (formation) {
    case 'wedge': {
      // V-shape / Wedge formation
      if (index === 0) return { x: 0, z: 0 };
      const row = Math.floor(Math.sqrt(index));
      const col = index - row * row;
      const spread = 0.55;
      const x = (col - row) * spread;
      const z = row * 0.65;
      return { x, z };
    }

    case 'wide': {
      // Wide sweep horizontal line
      const cols = Math.min(18, Math.max(6, Math.ceil(Math.sqrt(totalCount) * 2.2)));
      const row = Math.floor(index / cols);
      const col = index % cols;
      const x = (col - (cols - 1) / 2) * 0.55;
      const z = row * 0.5;
      return { x, z };
    }

    case 'circle': {
      // Concentric circular phalanx
      if (index === 0) return { x: 0, z: 0 };
      const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~137.5 degrees
      const r = Math.sqrt(index) * 0.42;
      const theta = index * goldenAngle;
      const x = r * Math.cos(theta);
      const z = r * Math.sin(theta);
      return { x, z };
    }

    case 'arrow': {
      // Penetrating arrow: narrow column with pointed head
      if (index === 0) return { x: 0, z: 0 };
      if (index < 5) {
        // Arrowhead
        const side = index % 2 === 0 ? 1 : -1;
        const depth = Math.ceil(index / 2);
        return { x: side * depth * 0.45, z: depth * 0.5 };
      }
      // Narrow shaft
      const shaftIdx = index - 5;
      const row = Math.floor(shaftIdx / 3);
      const col = (shaftIdx % 3) - 1;
      return { x: col * 0.4, z: 2.5 + row * 0.45 };
    }

    default:
      return { x: 0, z: 0 };
  }
}

// Distance 2D
export function dist2D(x1: number, z1: number, x2: number, z2: number): number {
  const dx = x1 - x2;
  const dz = z1 - z2;
  return Math.sqrt(dx * dx + dz * dz);
}

// AABB / Circle overlap
export function checkCircleRectCollision(
  cx: number,
  cz: number,
  cr: number,
  rx: number,
  rz: number,
  rw: number,
  rd: number
): boolean {
  const closestX = clamp(cx, rx - rw / 2, rx + rw / 2);
  const closestZ = clamp(cz, rz - rd / 2, rz + rd / 2);
  const dx = cx - closestX;
  const dz = cz - closestZ;
  return dx * dx + dz * dz < cr * cr;
}
