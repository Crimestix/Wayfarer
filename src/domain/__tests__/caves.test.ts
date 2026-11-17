import { describe, expect, it } from 'vitest';
import { generateCaves } from '../caves';
import { hexBand, hexLine } from '../hex';

/** Ein Streifen wie zwischen zwei Orten: `length` Felder lang, `radius` breit. */
function band(length: number, radius: number) {
  const start = { q: 0, r: 0 };
  const goal = { q: length, r: 0 };
  return { start, goal, cells: hexBand(hexLine(start, goal), radius) };
}

describe('Höhlennetz', () => {
  it('gibt mehrere getrennte Wege zum Ziel, Schleifen, Höhlen und Kreuzungen', () => {
    const { start, goal, cells } = band(20, 4);
    const t0 = performance.now();
    const result = generateCaves({ cells, start, goal, levels: 2, seed: 4711 });
    const ms = performance.now() - t0;
    expect(result.quality.routes).toBeGreaterThanOrEqual(2);
    expect(result.quality.loops).toBeGreaterThanOrEqual(2);
    expect(result.quality.junctions).toBeGreaterThan(2);
    expect(result.quality.levelsUsed).toBe(2);
    expect(ms).toBeLessThan(2000);
    // Fels gibt es, und er hat keine Ausgänge.
    const rock = result.cells.filter((c) => c.role === 'rock');
    expect(rock.length).toBeGreaterThan(cells.length / 3);
    expect(rock.every((c) => c.exits.length === 0)).toBe(true);
    console.log(JSON.stringify({ ms: Math.round(ms), ...result.quality, attempt: result.attempt }));
  });

  it('ist bei gleichem Ausgangswert gleich, bei anderem anders', () => {
    const { start, goal, cells } = band(12, 3);
    const a = generateCaves({ cells, start, goal, levels: 1, seed: 1 });
    const b = generateCaves({ cells, start, goal, levels: 1, seed: 1 });
    const c = generateCaves({ cells, start, goal, levels: 1, seed: 2 });
    expect(JSON.stringify(a.cells)).toBe(JSON.stringify(b.cells));
    expect(JSON.stringify(a.cells)).not.toBe(JSON.stringify(c.cells));
  });

  it('hält über viele Ausgangswerte: immer erreichbar, meist zwei Wege', () => {
    const { start, goal, cells } = band(16, 4);
    let twoRoutes = 0;
    const stats: string[] = [];
    for (let seed = 0; seed < 30; seed++) {
      const { quality } = generateCaves({ cells, start, goal, levels: 2, seed });
      expect(quality.routes).toBeGreaterThanOrEqual(1);
      if (quality.routes >= 2) twoRoutes++;
      stats.push(
        `${quality.routes}/${quality.loops}/${quality.bigCaves}/${quality.secrets}/${quality.deadEnds}`,
      );
    }
    console.log(stats.join(' '));
    expect(twoRoutes).toBeGreaterThanOrEqual(27);
  });
});
