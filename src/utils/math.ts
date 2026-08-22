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

// Зазор от лидера до рельса — общий для клампа лидера (CrowdManager) и коридора
// препятствий (LevelGenerator), чтобы оба места не расходились по магическому числу.
export const TRACK_RAIL_MARGIN = 1.2;

const WEDGE_SPREAD = 0.55;
const WEDGE_Z_STEP = 0.65;
const WIDE_SPREAD = 0.55;
const WIDE_Z_STEP = 0.5;
const CIRCLE_COEF = 0.42;

// Calculate mob positions based on crowd count and formation.
// playableHalfWidth ограничивает формацию по ширине трассы: если "естественная"
// полуширина построения при данном totalCount превышает доступное пространство,
// шаг между бойцами (и по X, и по Z, чтобы форма не расплющивалась) равномерно
// сжимается — толпа физически не может вылезти за пределы дорожки, а при росте
// отряда видно, как построение уплотняется.
export function calculateFormationOffset(
  index: number,
  totalCount: number,
  formation: FormationType,
  playableHalfWidth: number
): { x: number; z: number } {
  switch (formation) {
    case 'wedge': {
      // V-shape / Wedge formation
      if (index === 0) return { x: 0, z: 0 };
      const row = Math.floor(Math.sqrt(index));
      const col = index - row * row;
      const maxRow = Math.floor(Math.sqrt(Math.max(0, totalCount - 1)));
      const naturalHalf = maxRow * WEDGE_SPREAD;
      const scale = naturalHalf > playableHalfWidth ? playableHalfWidth / naturalHalf : 1;
      const spread = WEDGE_SPREAD * scale;
      const x = (col - row) * spread;
      const z = row * WEDGE_Z_STEP * scale;
      return { x, z };
    }

    case 'wide': {
      // Wide sweep horizontal line
      const cols = Math.min(18, Math.max(6, Math.ceil(Math.sqrt(totalCount) * 2.2)));
      const row = Math.floor(index / cols);
      const col = index % cols;
      const naturalHalf = ((cols - 1) / 2) * WIDE_SPREAD;
      const scale = naturalHalf > playableHalfWidth ? playableHalfWidth / naturalHalf : 1;
      const x = (col - (cols - 1) / 2) * WIDE_SPREAD * scale;
      const z = row * WIDE_Z_STEP * scale;
      return { x, z };
    }

    case 'circle': {
      // Concentric circular phalanx
      if (index === 0) return { x: 0, z: 0 };
      const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~137.5 degrees
      const naturalMax = Math.sqrt(Math.max(0, totalCount - 1)) * CIRCLE_COEF;
      const scale = naturalMax > playableHalfWidth ? playableHalfWidth / naturalMax : 1;
      const r = Math.sqrt(index) * CIRCLE_COEF * scale;
      const theta = index * goldenAngle;
      const x = r * Math.cos(theta);
      const z = r * Math.sin(theta);
      return { x, z };
    }

    case 'arrow': {
      // Penetrating arrow: narrow column with pointed head.
      // Максимальный офсет константен (0.9) — формация и так узкая, сжимать незачем.
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
