import { describe, expect, it } from 'vitest';
import { HexSchema, type Hex } from '../../domain/schema';
import {
  CLEAR_CONTENT,
  EMPTY_HISTORY,
  patchMany,
  prepOverview,
  recordStep,
  redoHistory,
  toggleSelection,
  undoHistory,
} from './prep';

const cell = (q: number, r: number, more: Partial<Hex> = {}): Hex =>
  HexSchema.parse({ q, r, terrain: 'grassland', ...more });

describe('Hexkarten vorbereiten', () => {
  it('ändert mehrere Felder zugleich und markiert sie als von Hand', () => {
    const hexes = [cell(0, 0), cell(1, 0), cell(2, 0, { feature: 'Lichtung' })];
    const next = patchMany(
      hexes,
      [
        { q: 1, r: 0 },
        { q: 2, r: 0 },
      ],
      { terrain: 'forest' },
    );
    expect(next.map((hex) => hex.terrain)).toEqual(['grassland', 'forest', 'forest']);
    expect(next.map((hex) => hex.manual)).toEqual([false, true, true]);
    const cleared = patchMany(next, [{ q: 2, r: 0 }], CLEAR_CONTENT);
    expect(cleared[2]!.feature).toBe('');
    expect(cleared[2]!.terrain).toBe('forest');
  });

  it('wählt ein Feld allein oder nimmt mit Umschalt weitere dazu und heraus', () => {
    const a = { q: 0, r: 0 };
    const b = { q: 1, r: 0 };
    expect(toggleSelection([a], b, false)).toEqual([b]);
    expect(toggleSelection([a], b, true)).toEqual([a, b]);
    expect(toggleSelection([a, b], a, true)).toEqual([b]);
  });

  it('nimmt viele Schritte zurück und wiederholt sie', () => {
    const one = [cell(0, 0)];
    const two = [cell(0, 0, { terrain: 'forest' })];
    const three = [cell(0, 0, { terrain: 'hills' })];
    let history = recordStep(EMPTY_HISTORY, one);
    history = recordStep(history, two);
    const back = undoHistory(history, three)!;
    expect(back.restore).toBe(two);
    const backAgain = undoHistory(back.history, two)!;
    expect(backAgain.restore).toBe(one);
    expect(undoHistory(backAgain.history, one)).toBeNull();
    const forward = redoHistory(backAgain.history, one)!;
    expect(forward.restore).toBe(two);
    // Ein neuer Schritt nimmt das Wiederholen weg.
    expect(recordStep(forward.history, two).future).toEqual([]);
  });

  it('zählt, was schon vorbereitet ist – leere Sorten fehlen', () => {
    const rows = prepOverview({
      hexes: [
        cell(0, 0, { afar: 'Ein Turm', feature: 'Ruine' }),
        cell(1, 0, { hidden: 'Silber' }),
        cell(2, 0),
      ],
    });
    expect(rows.map((row) => [row.key, row.coords.length])).toEqual([
      ['afar', 1],
      ['feature', 1],
      ['hidden', 1],
      ['empty', 1],
    ]);
  });
});
