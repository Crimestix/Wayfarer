import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity, type Character } from '../../domain/schema';
import { marchIds, marchRows, moveInMarch, rowLabel } from './march';

/** Drei erfundene Gefährten, alle dabei – die Gefährten des Grundstands sind ausgeschieden. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  for (const entity of Object.values(db.getSnapshot().entities))
    if (entity.kind === 'character') db.remove('entities', entity.id);
  const mate = (name: string) =>
    db.put('entities', createEntity({ kind: 'character', name })) as Character;
  return { db, brann: mate('Brann'), ilka: mate('Ilka'), odo: mate('Odo') };
}

describe('Marschordnung', () => {
  it('ohne Ordnung zu zweit nach Namen; neue Gefährten gehen hinten mit', async () => {
    const { db, brann, ilka, odo } = await setup();
    expect(marchIds(marchRows(db.getSnapshot()))).toEqual([[brann.id, ilka.id], [odo.id]]);
    db.setState({ march: [[odo.id], [brann.id]] });
    expect(marchIds(marchRows(db.getSnapshot()))).toEqual([[odo.id], [brann.id], [ilka.id]]);
    // Wer nicht dabei ist, fällt weg.
    db.patch('entities', odo.id, { character: { ...odo.character, active: false } });
    expect(marchIds(marchRows(db.getSnapshot()))).toEqual([[brann.id], [ilka.id]]);
  });

  it('rückt nach vorn und hinten; am Rand entsteht eine neue Reihe', () => {
    const rows = [['a', 'b'], ['c']];
    expect(moveInMarch(rows, 'c', -1)).toEqual([['a', 'b', 'c']]);
    expect(moveInMarch(rows, 'a', -1)).toEqual([['a'], ['b'], ['c']]);
    expect(moveInMarch(rows, 'c', 1)).toEqual(rows); // allein hinten: bleibt
    expect(moveInMarch(rows, 'b', 1)).toEqual([['a'], ['c', 'b']]);
    expect(rowLabel(0, 3)).toBe('Vorn');
    expect(rowLabel(1, 3)).toBe('Mitte');
    expect(rowLabel(2, 3)).toBe('Hinten');
    expect(rowLabel(0, 1)).toBe('Alle');
  });
});
