import { describe, expect, it } from 'vitest';
import { caveLoops } from '../caveShape';

const keys = (cells: [number, number][]) => new Set(cells.map(([x, y]) => `${x},${y}`));

describe('Umriss einer Höhle', () => {
  it('ein Block ergibt einen geschlossenen Umriss nahe am Raster', () => {
    const loops = caveLoops(
      keys([
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]),
      () => false,
    );
    expect(loops).toHaveLength(1);
    const loop = loops[0]!;
    expect(loop.points.length).toBeGreaterThan(16);
    expect(loop.open.every((open) => !open)).toBe(true);
    for (const [x, y] of loop.points) {
      expect(x).toBeGreaterThan(-0.3);
      expect(x).toBeLessThan(2.3);
      expect(y).toBeGreaterThan(-0.3);
      expect(y).toBeLessThan(2.3);
    }
  });

  it('bleibt gleich, wenn man ihn noch einmal rechnet', () => {
    const cave = keys([
      [3, 4],
      [4, 4],
      [4, 5],
    ]);
    expect(caveLoops(cave, () => false)).toEqual(caveLoops(cave, () => false));
  });

  it('an anderem Boden bleibt der Rand gerade und offen', () => {
    // Rechts vom Feld (0,0) liegt ein gebauter Gang.
    const loops = caveLoops(keys([[0, 0]]), (x, y) => x === 1 && y === 0);
    const loop = loops[0]!;
    const openPoints = loop.points.filter((_, i) => loop.open[i]);
    expect(openPoints.length).toBeGreaterThan(0);
    for (const [x] of openPoints) expect(x).toBe(1);
  });

  it('ein Felsen mitten in der Höhle ist ein eigener Umriss', () => {
    const ring: [number, number][] = [];
    for (let x = 0; x < 3; x++)
      for (let y = 0; y < 3; y++) if (x !== 1 || y !== 1) ring.push([x, y]);
    expect(caveLoops(keys(ring), () => false)).toHaveLength(2);
  });
});
