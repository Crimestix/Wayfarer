import { describe, expect, it } from 'vitest';
import { HEX_KINDS } from '../../domain/hexKinds';
import { HexSchema } from '../../domain/schema';
import { LAND_GROUND, landGroundOf } from './HexGround';
import { CAVE_GROUND } from './HexLayers';
import { CAVE_SYMBOLS, LAND_SYMBOLS, caveSymbolsOf, symbolsOf } from './HexSymbols';

describe('Gemalter Boden der Hexkarte', () => {
  it('hat für jede Geländeart der Oberwelt einen Boden', () => {
    const missing = HEX_KINDS.filter((kind) => kind.group !== 'underdark')
      .map((kind) => kind.key)
      .filter((key) => !LAND_GROUND[key]);
    expect(missing).toEqual([]);
  });

  it('kennt keinen Boden für eine Art, die es nicht gibt', () => {
    const known = new Set(HEX_KINDS.map((kind) => kind.key));
    expect(Object.keys(LAND_GROUND).filter((key) => !known.has(key))).toEqual([]);
    expect(Object.keys(CAVE_GROUND).filter((key) => !known.has(key))).toEqual([]);
  });

  it('färbt nur Arten ein, die sich eine Kachel teilen', () => {
    const bySrc = new Map<string, string[]>();
    for (const [key, ground] of Object.entries(LAND_GROUND))
      bySrc.set(ground.src, [...(bySrc.get(ground.src) ?? []), key]);
    for (const keys of bySrc.values()) {
      // Höchstens eine Art trägt die Kachel ohne Farbe – sonst wären zwei nicht zu unterscheiden.
      expect(keys.filter((key) => LAND_GROUND[key]!.tint === 0).length).toBeLessThanOrEqual(1);
    }
  });

  it('hat gemalte Zeichen nur für Arten der Oberwelt – und für alles, was aufragt', () => {
    const surface = new Set(
      HEX_KINDS.filter((kind) => kind.group !== 'underdark').map((kind) => kind.key),
    );
    expect(Object.keys(LAND_SYMBOLS).filter((key) => !surface.has(key))).toEqual([]);
    for (const list of Object.values(LAND_SYMBOLS)) expect(list.length).toBeGreaterThan(0);
    // Wälder, Höhen und Siedlungen haben einen schlichten Boden: Ohne Zeichen sähe man sie nicht.
    for (const key of ['forest', 'pine', 'dense-forest', 'jungle', 'glade', 'dead-forest'])
      expect(LAND_SYMBOLS[key]?.length, key).toBeGreaterThan(0);
    for (const key of [
      'hills',
      'mountains',
      'highpeak',
      'volcano',
      'crater',
      'urban',
      'village',
      'ruins',
    ])
      expect(LAND_SYMBOLS[key]?.length, key).toBeGreaterThan(0);
  });

  it('setzt Zeichen nur auf Felder der Oberwelt', () => {
    const forest = HexSchema.parse({ q: 0, r: 0, terrain: 'forest' });
    expect(symbolsOf(forest)).toBe(LAND_SYMBOLS.forest);
    expect(symbolsOf({ ...forest, exits: [] })).toBeNull();
    expect(symbolsOf({ ...forest, terrain: 'grassland' })).toBeNull();
    expect(symbolsOf({ ...forest, terrain: null })).toBeNull();
  });

  it('hat unter der Erde Zeichen für alles, was dort wächst oder liegt – nie für Fels', () => {
    const under = new Set(
      HEX_KINDS.filter((kind) => kind.group === 'underdark').map((kind) => kind.key),
    );
    // `floor` sind Kleinigkeiten für den blanken Höhlenboden.
    expect(Object.keys(CAVE_SYMBOLS).filter((key) => key !== 'floor' && !under.has(key))).toEqual(
      [],
    );
    // Glutspalten sind blanker Boden mit Rissen – dort steht nichts.
    for (const key of Object.keys(CAVE_GROUND).filter((kind) => kind !== 'magma'))
      expect(CAVE_SYMBOLS[key]?.length, key).toBeGreaterThan(0);
    const cave = HexSchema.parse({ q: 0, r: 0, terrain: 'underdark', kind: 'fungus', exits: [] });
    expect(caveSymbolsOf(cave)).toBe(CAVE_SYMBOLS.fungus);
    expect(caveSymbolsOf({ ...cave, kind: 'cavern' })).toBe(CAVE_SYMBOLS.floor);
    expect(caveSymbolsOf({ ...cave, kind: 'solid-rock' })).toBeNull();
    // Im Gang (Ganggeflecht) liegt höchstens ein Brocken; Fels ohne Ausgang trägt nichts.
    expect(
      caveSymbolsOf({ ...cave, kind: null, exits: [{ dir: 0, kind: 'open', found: false }] }),
    ).toBe(CAVE_SYMBOLS.floor);
    expect(caveSymbolsOf({ ...cave, kind: null })).toBeNull();
    expect(symbolsOf(cave)).toBeNull();
  });

  it('gilt nur oben: Felder mit Gängen und Unterreich malt das Gangnetz', () => {
    const forest = HexSchema.parse({ q: 0, r: 0, terrain: 'forest', kind: 'pine' });
    expect(landGroundOf(forest)).toBe(LAND_GROUND.pine);
    expect(landGroundOf({ ...forest, kind: null })).toBe(LAND_GROUND.forest);
    // Eine Art, die nicht zum Grundgelände passt, zählt nicht – dann gilt das Grundgelände.
    expect(landGroundOf({ ...forest, kind: 'dunes' })).toBe(LAND_GROUND.forest);
    expect(landGroundOf({ ...forest, exits: [] })).toBeNull();
    expect(landGroundOf({ ...forest, terrain: 'underdark', kind: null })).toBeNull();
    expect(landGroundOf({ ...forest, terrain: null, kind: null })).toBeNull();
  });
});
