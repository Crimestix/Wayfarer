import { describe, expect, it } from 'vitest';
import { HEX_KINDS, hexKind, kindKeyOf, kindLabelOf, kindsByGroup, paintOfKind } from '../hexKinds';
import { TERRAINS } from '../schema';
import { withChange } from '../../features/erkundung/prep';
import { HexSchema } from '../schema';

describe('Geländearten', () => {
  it('hat eindeutige Schlüssel, und jedes Grundgelände ist auch eine Art', () => {
    const keys = HEX_KINDS.map((kind) => kind.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const terrain of TERRAINS) expect(hexKind(terrain)?.base).toBe(terrain);
    expect(HEX_KINDS.length).toBeGreaterThan(40);
  });

  it('malt Art und Grundgelände zusammen – das Grundgelände selbst ohne eigene Art', () => {
    expect(paintOfKind('bog')).toEqual({ terrain: 'swamp', kind: 'bog' });
    expect(paintOfKind('swamp')).toEqual({ terrain: 'swamp', kind: null });
    expect(paintOfKind('gibt-es-nicht')).toBeNull();
  });

  it('nennt ein Feld nach seiner Art, sonst nach dem Grundgelände', () => {
    expect(kindLabelOf({ terrain: 'swamp', kind: 'bog' })).toBe('Moor');
    expect(kindLabelOf({ terrain: 'swamp', kind: null })).toBe('Sumpf');
    // Passt die Art nicht mehr zum Grundgelände, gilt das Grundgelände.
    expect(kindKeyOf({ terrain: 'forest', kind: 'bog' })).toBe('forest');
  });

  it('vergisst die Art, wenn sich das Grundgelände von Hand ändert', () => {
    const hex = HexSchema.parse({ q: 0, r: 0, terrain: 'swamp', kind: 'bog' });
    expect(withChange(hex, { terrain: 'forest' }).kind).toBeNull();
    expect(withChange(hex, { terrain: 'swamp' }).kind).toBe('bog');
    expect(withChange(hex, { terrain: 'forest', kind: 'pine' }).kind).toBe('pine');
  });

  it('sucht nach Namen und Gruppen', () => {
    expect(kindsByGroup('moor').flatMap((g) => g.kinds.map((k) => k.key))).toEqual(['bog']);
    expect(kindsByGroup('wälder')[0]!.kinds.length).toBeGreaterThan(4);
    expect(kindsByGroup('').length).toBe(9);
  });
});
