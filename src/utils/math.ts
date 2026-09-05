import { FormationType } from '../types/game';

export interface FormationOffset {
  x: number;
  z: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ==== Near-Miss Streak (серия уворотов в упор) ====
// Пороги серии и множители награды. Декуплировано от combo ворот: серия уворотов
// растёт только на последовательных near-miss и сбрасывается на уроне толпы или
// безопасном объезде ловушки в той же полосе. Чистая функция, 0 аллокаций.
export const NEAR_MISS_STREAK_TIERS = [2, 5, 10] as const; // пороги серии
export const NEAR_MISS_STREAK_MULT = [2, 5, 10] as const;  // множители на порогах

/** Возвращает множитель награды по длине серии уворотов (1 → x1, 2 → x2, 5 → x5, 10 → x10). */
export function getNearMissMultiplier(streak: number): number {
  let m = 1;
  for (let i = 0; i < NEAR_MISS_STREAK_TIERS.length; i++) {
    if (streak >= NEAR_MISS_STREAK_TIERS[i]) m = NEAR_MISS_STREAK_MULT[i];
  }
  return m;
}

// Минимальный зазор между кругом (моб/лидер) и прямоугольником (активный хитбокс
// препятствия) в плоскости XZ. >=0 — снаружи (зазор), <0 — пересечение/касание.
// Чистая числовая функция, 0 аллокаций — безопасна для горячего цикла.
export function circleRectGap(
  mx: number,
  mz: number,
  r: number,
  rx: number,
  rz: number,
  rw: number,
  rd: number
): number {
  const dx = Math.max(0, Math.abs(mx - rx) - rw / 2);
  const dz = Math.max(0, Math.abs(mz - rz) - rd / 2);
  return Math.hypot(dx, dz) - r;
}

// Зазор от лидера до рельса — общий для клампа лидера (CrowdManager) и коридора
// препятствий (LevelGenerator), чтобы оба места не расходились по магическому числу.
export const TRACK_RAIL_MARGIN = 1.2;

const WEDGE_SPREAD = 0.55;
const WEDGE_Z_STEP = 0.65;
const WIDE_SPREAD = 0.55;
const WIDE_Z_STEP = 0.5;
const CIRCLE_COEF = 0.42;
// Ромбовидная формация: плотный ромб за лидером. Как и овал, по X компактнее,
// по Z длиннее (X-коэф меньше Z), но сжимается сильнее (coef ~0.5 как у circle),
// чтобы держать узкий плотный строй с бронёй фронта.
const DIAMOND_COEF = 0.5;
const DIAMOND_X_COEF = 0.5;
const DIAMOND_Z_COEF = 0.9;
// Овальная формация: эллипс, вытянутый ВПЕРЁД (по Z). По X — компактнее, по Z — длиннее,
// чтобы толпа занимала больше места вдоль трассы и меньше по ширине.
const OVAL_X_COEF = 0.5;
const OVAL_Z_COEF = 0.9;
// Золотой угол (~137.5°) для равномерного распределения мобов по спирали
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Предаллоцированный scratch-объект на уровне модуля (0-GC)
const formationScratch: FormationOffset = { x: 0, z: 0 };

/**
 * Вычисляет коэффициент сжатия формации под ширину трассы.
 * Вызывается 1 раз за кадр на всю толпу для исключения повторных вычислений (0-GC).
 */
export function getFormationScale(
  formation: FormationType,
  totalCount: number,
  playableHalfWidth: number
): number {
  switch (formation) {
    case 'wedge': {
      const maxRow = Math.floor(Math.sqrt(Math.max(0, totalCount - 1)));
      const naturalHalf = maxRow * WEDGE_SPREAD;
      return naturalHalf > playableHalfWidth ? playableHalfWidth / naturalHalf : 1;
    }

    case 'wide': {
      const cols = Math.min(18, Math.max(6, Math.ceil(Math.sqrt(totalCount) * 2.2)));
      const naturalHalf = ((cols - 1) / 2) * WIDE_SPREAD;
      return naturalHalf > playableHalfWidth ? playableHalfWidth / naturalHalf : 1;
    }

    case 'circle': {
      const naturalMax = Math.sqrt(Math.max(0, totalCount - 1)) * CIRCLE_COEF;
      return naturalMax > playableHalfWidth ? playableHalfWidth / naturalMax : 1;
    }

    case 'diamond': {
      const naturalMax = Math.sqrt(Math.max(0, totalCount - 1)) * DIAMOND_COEF;
      return naturalMax > playableHalfWidth ? playableHalfWidth / naturalMax : 1;
    }

    case 'arrow':
      return 1;

    case 'oval': {
      const naturalMax = Math.sqrt(Math.max(0, totalCount - 1)) * OVAL_X_COEF;
      return naturalMax > playableHalfWidth ? playableHalfWidth / naturalMax : 1;
    }

    default:
      return 1;
  }
}

// Calculate mob positions based on crowd count and formation.
// playableHalfWidth ограничивает формацию по ширине трассы: если "естественная"
// полуширина построения при данном totalCount превышает доступное пространство,
// шаг между бойцами (и по X, и по Z, чтобы форма не расплющивалась) равномерно
// сжимается — толпа физически не может вылезти за пределы дорожки, а при росте
// отряда видно, как построение уплотняется.
// Оптимизировано для 0-GC: результат записывается в переданный `out`-объект
// (или в модульный `formationScratch`, если `out` не передан).
export function calculateFormationOffset(
  index: number,
  totalCount: number,
  formation: FormationType,
  playableHalfWidth: number,
  out?: FormationOffset,
  scale?: number
): FormationOffset {
  const target = out ?? formationScratch;

  switch (formation) {
    case 'wedge': {
      // V-shape / Wedge formation
      if (index === 0) {
        target.x = 0;
        target.z = 0;
        return target;
      }
      const row = Math.floor(Math.sqrt(index));
      const col = index - row * row;
      const s = scale ?? getFormationScale(formation, totalCount, playableHalfWidth);
      const spread = WEDGE_SPREAD * s;
      target.x = (col - row) * spread;
      target.z = row * WEDGE_Z_STEP * s;
      return target;
    }

    case 'wide': {
      // Wide sweep horizontal line
      const cols = Math.min(18, Math.max(6, Math.ceil(Math.sqrt(totalCount) * 2.2)));
      const row = Math.floor(index / cols);
      const col = index % cols;
      const s = scale ?? getFormationScale(formation, totalCount, playableHalfWidth);
      target.x = (col - (cols - 1) / 2) * WIDE_SPREAD * s;
      target.z = row * WIDE_Z_STEP * s;
      return target;
    }

    case 'circle': {
      // Concentric circular phalanx
      if (index === 0) {
        target.x = 0;
        target.z = 0;
        return target;
      }
      const s = scale ?? getFormationScale(formation, totalCount, playableHalfWidth);
      const r = Math.sqrt(index) * CIRCLE_COEF * s;
      const theta = index * GOLDEN_ANGLE;
      target.x = r * Math.cos(theta);
      target.z = r * Math.sin(theta);
      return target;
    }

    case 'arrow': {
      // Penetrating arrow: narrow column with pointed head.
      // Максимальный офсет константен (0.9) — формация и так узкая, сжимать незачем.
      if (index === 0) {
        target.x = 0;
        target.z = 0;
        return target;
      }
      if (index < 5) {
        // Arrowhead
        const side = index % 2 === 0 ? 1 : -1;
        const depth = Math.ceil(index / 2);
        target.x = side * depth * 0.45;
        target.z = depth * 0.5;
        return target;
      }
      // Narrow shaft
      const shaftIdx = index - 5;
      const row = Math.floor(shaftIdx / 3);
      const col = (shaftIdx % 3) - 1;
      target.x = col * 0.4;
      target.z = 2.5 + row * 0.45;
      return target;
    }

    case 'oval': {
      // Овал, вытянутый ВПЕРЁД (по Z). Золотой угол распределяет мобов по эллипсу
      // равномерно; X-коэффициент меньше Z-коэффициента, поэтому форма вытянута вдоль
      // трассы. Масштаб сжимается под ширину дорожки, чтобы овал не вылезал за края.
      if (index === 0) {
        target.x = 0;
        target.z = 0;
        return target;
      }
      const s = scale ?? getFormationScale(formation, totalCount, playableHalfWidth);
      const r = Math.sqrt(index) * s;
      const theta = index * GOLDEN_ANGLE;
      target.x = r * OVAL_X_COEF * Math.cos(theta);
      target.z = r * OVAL_Z_COEF * Math.sin(theta);
      return target;
    }

    case 'diamond': {
      // Плотный ромб за лидером. Золотой угол распределяет мобов равномерно по
      // ромбу (r*cos/sin), X-коэффициент меньше Z-коэффициента — форма вытянута
      // вдоль трассы как у овала, но у́же и плотнее (за счёт сильного сжатия
      // DIAMOND_COEF в getFormationScale). Масштаб сжимается под ширину дорожки.
      if (index === 0) {
        target.x = 0;
        target.z = 0;
        return target;
      }
      const s = scale ?? getFormationScale(formation, totalCount, playableHalfWidth);
      const r = Math.sqrt(index) * s;
      const theta = index * GOLDEN_ANGLE;
      target.x = r * DIAMOND_X_COEF * Math.cos(theta);
      target.z = r * DIAMOND_Z_COEF * Math.sin(theta);
      return target;
    }

    default:
      target.x = 0;
      target.z = 0;
      return target;
  }
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

export interface WallImpactMobInput {
  type: string;
  shieldHp: number;
  hp: number;
  alive: boolean;
  invulnerableTime?: number;
}

export interface WallImpactResult {
  damageDealt: number;
  killed: boolean;
}

/**
 * Чистая функция расчёта контакта моба с кинетической стеной (для тестов и чистой логики).
 * Не зависит от Three.js, Web Audio и EventBus.
 */
export function computeWallImpact(
  mob: WallImpactMobInput,
  formation: FormationType = 'oval',
  isHyperMode: boolean = false,
  dodgeSuccess: boolean = false
): WallImpactResult {
  if (isHyperMode || !mob.alive || (mob.invulnerableTime !== undefined && mob.invulnerableTime > 0)) {
    return { damageDealt: 0, killed: false };
  }

  const damageDealt = mob.type === 'tank' ? 3 : mob.type === 'mage' ? 2 : (formation === 'arrow' || formation === 'circle' || formation === 'diamond' ? 2 : 1);

  if (mob.type === 'ninja' && dodgeSuccess) {
    return { damageDealt, killed: false };
  }

  if (mob.shieldHp > 0) {
    mob.shieldHp--;
    return { damageDealt, killed: false };
  }

  if (mob.hp > 1) {
    mob.hp--;
    return { damageDealt, killed: false };
  }

  mob.alive = false;
  return { damageDealt, killed: true };
}

/**
 * Чистая функция расчёта стоимости пробития ступени финишной стены множителей
 * с учётом перка формации. Шеренга (wide) пробивает широкую стену «широким
 * фронтом» — жертвует на 20% меньше легионеров (минимум 1). Остальные формации
 * платят полную стоимость. 0 аллокаций, без зависимостей от Three.js/DOM.
 */
export const WIDE_FINISH_DISCOUNT = 0.8;

export function getFinishWallCost(baseCost: number, formation: FormationType = 'oval'): number {
  if (baseCost <= 0) return 0;
  if (formation === 'wide') {
    return Math.max(1, Math.round(baseCost * WIDE_FINISH_DISCOUNT));
  }
  return baseCost;
}
