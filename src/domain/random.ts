/**
 * Wiederholbarer Zufall: Aus demselben Ausgangswert entsteht immer dieselbe Folge. Alles, was
 * Wayfarer erzeugt (Wetter, Gelände, Vorschläge), rechnet hiermit – nie mit `Math.random` –,
 * damit eine Rückreise dieselbe Welt vorfindet und Tests dasselbe Ergebnis sehen.
 */

export interface Rng {
  /** Gleichverteilte Zahl in [0, 1). */
  next(): number;
  /** Ganze Zahl in [min, max] (beide eingeschlossen). */
  int(min: number, max: number): number;
  /** Ein Element der Liste; undefined bei leerer Liste. */
  pick<T>(items: readonly T[]): T | undefined;
  /** Ein Element nach Gewichten (Gewicht 0 = nie). */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T | undefined;
  /** Wahr mit der Wahrscheinlichkeit `p`. */
  chance(p: number): boolean;
}

/** Macht aus Text oder Zahl einen Ausgangswert (FNV-1a, 32 Bit). */
export function seedOf(...parts: (string | number)[]): number {
  let hash = 0x811c9dc5;
  for (const char of parts.join('\u0000')) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Zufallsfolge zu einem Ausgangswert (mulberry32). */
export function rngOf(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    pick: (items) => (items.length ? items[int(0, items.length - 1)] : undefined),
    weighted: (items, weight) => {
      const weights = items.map((item) => Math.max(0, weight(item)));
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) return undefined;
      let roll = next() * total;
      for (let i = 0; i < items.length; i++) {
        roll -= weights[i]!;
        if (roll < 0) return items[i];
      }
      return items[items.length - 1];
    },
    chance: (p) => next() < p,
  };
}

/** Ein frischer Ausgangswert für etwas, das der Spielleiter gerade auslöst. */
export const freshSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0]!;

/** Fester Zufallswert in [0, 1) für einen Gitterpunkt. */
function lattice(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Weiches Rauschen in [0, 1): Benachbarte Punkte haben ähnliche Werte, gleicher Ausgangswert gibt dasselbe. */
export function smoothNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = lattice(seed, x0, y0) * (1 - sx) + lattice(seed, x0 + 1, y0) * sx;
  const bottom = lattice(seed, x0, y0 + 1) * (1 - sx) + lattice(seed, x0 + 1, y0 + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}
