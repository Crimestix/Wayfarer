import { describe, expect, it } from 'vitest';
import { HEX_KINDS } from '../../domain/hexKinds';
import { HexSchema } from '../../domain/schema';
import { LAND_GROUND, landGroundOf } from './HexGround';
import { CAVE_GROUND } from './HexLayers';

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
