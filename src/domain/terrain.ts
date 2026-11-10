/** Gelände: Bezeichnungen und die Reisegeschwindigkeiten nach D&D 2024. */
import type { Pace, Terrain } from './schema';

export const TERRAIN_LABEL: Record<Terrain, string> = {
  grassland: 'Grasland',
  forest: 'Wald',
  hills: 'Hügelland',
  mountains: 'Gebirge',
  swamp: 'Sumpf',
  desert: 'Wüste',
  arctic: 'Eisland',
  coast: 'Küste',
  water: 'Wasser',
  underdark: 'Unterreich',
  urban: 'Siedlung',
};

export const PACE_LABEL: Record<Pace, string> = {
  slow: 'Langsam',
  normal: 'Normal',
  fast: 'Schnell',
};

const KM_PER_MILE = 1.609344;

/** Tagesstrecke zu Fuß nach Regelwerk: 18, 24 und 30 Meilen am Tag. */
export const DAY_KM: Record<Pace, number> = {
  slow: 18 * KM_PER_MILE,
  normal: 24 * KM_PER_MILE,
  fast: 30 * KM_PER_MILE,
};

/** Reisetage für eine Strecke, auf halbe Tage gerundet (mindestens ein halber). */
export function travelDays(km: number, pace: Pace = 'normal'): number {
  return Math.max(0.5, Math.round((km / DAY_KM[pace]) * 2) / 2);
}

/** „3 Tage“, „1 Tag“, „½ Tag“, „2½ Tage“. */
export function formatDays(days: number): string {
  const whole = Math.floor(days);
  const half = days - whole >= 0.5;
  if (whole === 0) return '½ Tag';
  return `${whole}${half ? '½' : ''} ${whole === 1 && !half ? 'Tag' : 'Tage'}`;
}
