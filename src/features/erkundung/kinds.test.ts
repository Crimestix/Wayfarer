import { describe, expect, it } from 'vitest';
import { hexKind } from '../../domain/hexKinds';
import { generateHexes, type GenerateInput } from './generate';
import { caveKind, surfaceKind, warmthOf, type Field } from './kinds';

const field = (height: number, wet: number, patch = 0.5): Field => ({ height, wet, patch });
const ring = (...terrains: Parameters<typeof surfaceKind>[2]) => terrains;

describe('Geländearten oben', () => {
  it('liest die Wärme aus dem Klima, sonst aus der Landschaft', () => {
    expect(warmthOf('tropical', 'forest')).toBe('hot');
    expect(warmthOf('arctic', 'grassland')).toBe('cold');
    expect(warmthOf(null, 'desert')).toBe('hot');
    expect(warmthOf(undefined, 'forest')).toBe('temperate');
  });

  it('macht Ackerland um Orte, Dschungel in Hitze, Nadelwald in Kälte, Marsch am Wasser', () => {
    const grass = ring(
      'grassland',
      'grassland',
      'grassland',
      'grassland',
      'grassland',
      'grassland',
    );
    expect(
      surfaceKind({ terrain: 'grassland' }, field(0.5, 0.5), grass, 'temperate', true, false, 0.5),
    ).toBe('farmland');
    expect(
      surfaceKind({ terrain: 'forest' }, field(0.5, 0.7), grass, 'hot', false, false, 0.5),
    ).toBe('jungle');
    expect(
      surfaceKind({ terrain: 'forest' }, field(0.5, 0.7), grass, 'cold', false, false, 0.5),
    ).toBe('pine');
    const shore = ring('water', 'swamp', 'swamp', 'swamp', 'swamp', 'swamp');
    expect(
      surfaceKind({ terrain: 'swamp' }, field(0.3, 0.6), shore, 'temperate', false, false, 0.5),
    ).toBe('marsh');
    const deep = ring('forest', 'forest', 'forest', 'forest', 'forest', 'forest');
    expect(
      surfaceKind({ terrain: 'forest' }, field(0.4, 0.6), deep, 'temperate', false, false, 0.5),
    ).toBe('dense-forest');
    expect(
      surfaceKind({ terrain: 'water' }, field(0.1, 0.5), grass, 'temperate', false, true, 0.5),
    ).toBe('lake');
  });

  it('gibt nie eine Art, die nicht zum Grundgelände passt', () => {
    const { hexes } = generateHexes(surface);
    const kinds = hexes.filter((hex) => hex.kind);
    expect(kinds.length).toBeGreaterThan(10);
    for (const hex of kinds) expect(hexKind(hex.kind)?.base).toBe(hex.terrain);
    // Abwechslung, aber nicht alles: es bleiben auch reine Grundgelände.
    expect(new Set(kinds.map((hex) => hex.kind)).size).toBeGreaterThan(2);
    expect(kinds.length).toBeLessThan(hexes.length);
  });

  it('ist wiederholbar', () => {
    expect(generateHexes(surface).hexes.map((hex) => hex.kind)).toEqual(
      generateHexes(surface).hexes.map((hex) => hex.kind),
    );
  });
});

describe('Geländearten unten', () => {
  it('folgen dem Gepräge der Höhle, nie dem Klima', () => {
    const hex = { feature: 'Pilzwald', river: '', level: 0 };
    expect(caveKind(hex, 'cave', 3, false, 0.5)).toBe('fungus');
    expect(caveKind({ ...hex, feature: 'Kristallgrotte' }, 'cave', 3, false, 0.5)).toBe('crystal');
    expect(caveKind({ ...hex, feature: 'Unterirdischer See' }, 'cave', 3, false, 0.5)).toBe(
      'deep-lake',
    );
    expect(caveKind({ ...hex, feature: 'Warme Quellhöhle' }, 'cave', 3, false, 0.5)).toBe('magma');
    // Glut nur ganz unten.
    expect(caveKind({ ...hex, feature: '', level: 2 }, 'cave', 3, false, 0.6)).toBe('magma');
    expect(caveKind({ ...hex, feature: '', level: 0 }, 'cave', 3, false, 0.6)).toBeNull();
    expect(caveKind({ ...hex, feature: '' }, 'rock', 3, true, 0.9)).toBeNull();
  });

  it('erzeugt unter der Erde nur Arten des Unterreichs', () => {
    const { hexes } = generateHexes({ ...surface, biome: 'underdark', hexKm: 9.656 });
    const kinds = hexes.filter((hex) => hex.kind);
    expect(kinds.length).toBeGreaterThan(0);
    for (const hex of kinds) expect(hexKind(hex.kind)?.group).toBe('underdark');
  });
});

const surface: GenerateInput = {
  fromId: 'a',
  toId: 'b',
  distanceKm: 200,
  biome: 'forest',
  hexKm: 10,
  seed: 4711,
  climate: 'temperate',
};
