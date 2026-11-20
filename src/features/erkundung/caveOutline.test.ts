import { describe, expect, it } from 'vitest';
import { caveOutline, outlinePath, smoothNoise } from './caveOutline';

/** Die Fläche eines geschlossenen Linienzugs (Betrag). */
const areaOf = (loop: number[]): number => {
  let sum = 0;
  const n = loop.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += loop[i * 2]! * loop[j * 2 + 1]! - loop[j * 2]! * loop[i * 2 + 1]!;
  }
  return Math.abs(sum) / 2;
};

describe('Umriss von Höhlen und Gängen', () => {
  it('macht aus einer Kammer einen geschlossenen Linienzug um sie herum', () => {
    const [loop, ...more] = caveOutline([{ x1: 0, y1: 0, r: 0.5 }], { rough: 0 });
    expect(more).toEqual([]);
    // Ohne Rauschen ist es der Kreis: Fläche π·r², alle Punkte nahe am Rand.
    expect(areaOf(loop!)).toBeGreaterThan(Math.PI * 0.25 * 0.9);
    expect(areaOf(loop!)).toBeLessThan(Math.PI * 0.25 * 1.15);
    for (let i = 0; i < loop!.length; i += 2)
      expect(Math.hypot(loop![i]!, loop![i + 1]!)).toBeCloseTo(0.5, 0);
  });

  it('lässt zwei Kammern, die ein Gang verbindet, zu einer Fläche verschmelzen', () => {
    const apart = caveOutline(
      [
        { x1: 0, y1: 0, r: 0.3 },
        { x1: 3, y1: 0, r: 0.3 },
      ],
      { rough: 0 },
    );
    expect(apart).toHaveLength(2);
    const joined = caveOutline(
      [
        { x1: 0, y1: 0, r: 0.3 },
        { x1: 3, y1: 0, r: 0.3 },
        { x1: 0, y1: 0, x2: 3, y2: 0, r: 0.12 },
      ],
      { rough: 0 },
    );
    expect(joined).toHaveLength(1);
  });

  it('reißt einen schmalen Gang auch mit Rauschen nicht ab', () => {
    const loops = caveOutline(
      [
        { x1: 0, y1: 0, r: 0.47 },
        { x1: 6, y1: 1, r: 0.47 },
        { x1: 0, y1: 0, x2: 3, y2: 0.8, r: 0.11 },
        { x1: 3, y1: 0.8, x2: 6, y2: 1, r: 0.11 },
      ],
      { rough: 0.2 },
    );
    expect(loops).toHaveLength(1);
  });

  it('ist fest: dieselben Formen geben denselben Umriss, andere Stellen einen anderen', () => {
    const blobs = [{ x1: 2, y1: 3, r: 0.5 }];
    expect(caveOutline(blobs, { rough: 0.2 })).toEqual(caveOutline(blobs, { rough: 0.2 }));
    expect(caveOutline(blobs, { rough: 0.2, salt: 1 })).not.toEqual(
      caveOutline(blobs, { rough: 0.2 }),
    );
    expect(smoothNoise(1.5, 2.5)).toBe(smoothNoise(1.5, 2.5));
    expect(Math.abs(smoothNoise(4.2, 9.1))).toBeLessThanOrEqual(1);
    expect(caveOutline([])).toEqual([]);
  });

  it('schreibt den Umriss als geschlossenen Pfad in Bildpunkten', () => {
    const d = outlinePath(caveOutline([{ x1: 0, y1: 0, r: 0.5 }], { rough: 0 }), 40);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).not.toContain('NaN');
  });
});
