import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity } from '../../domain/schema';
import { createHistoric, historyRows, historySections } from './history';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  return { db, data: () => db.getSnapshot() };
}

const ALL = { kind: null, old: false, query: '' } as const;

describe('Geschichte der Welt', () => {
  it('legt Vergangenes an: eine Person ist tot, ein Ort untergegangen – mit Datum', async () => {
    const { db, data } = await setup();
    const king = createHistoric(db, {
      name: 'König Aldric der Kahle',
      kind: 'person',
      ended: 'vor 300 Jahren',
      born: '',
      line: 'Gründete die Grenzmark.',
    });
    if ('problem' in king) throw new Error(king.problem);
    const person = data().entities[king.id]!;
    expect(person).toMatchObject({ kind: 'person', person: { status: 'dead' }, stub: true });
    expect(person.ended?.precision).toBe('year');
    const city = createHistoric(db, {
      name: 'Alt-Velmar',
      kind: 'place',
      ended: 'vor 50 Jahren',
      born: 'vor 800 Jahren',
      line: '',
    });
    if ('problem' in city) throw new Error(city.problem);
    const rows = historyRows(data(), ALL);
    // Das Ältere zuerst.
    expect(rows.map((row) => row.entity.name)).toEqual(['König Aldric der Kahle', 'Alt-Velmar']);
    expect(rows.every((row) => row.past)).toBe(true);
    king.undo();
    expect(data().entities[king.id]).toBeUndefined();
  });

  it('nimmt Tote ohne Datum unter „Ohne Datum“ und Altes nur auf Wunsch', async () => {
    const { db, data } = await setup();
    db.put(
      'entities',
      createEntity({ kind: 'person', name: 'Die alte Mara', person: { status: 'dead' } }),
    );
    const tower = createHistoric(db, {
      name: 'Turm am Kap',
      kind: 'place',
      ended: '',
      born: 'vor 600 Jahren',
      line: '',
    });
    if ('problem' in tower) throw new Error(tower.problem);
    expect(historyRows(data(), ALL).map((row) => row.entity.name)).toEqual(['Die alte Mara']);
    const old = historyRows(data(), { ...ALL, old: true });
    expect(old.map((row) => row.entity.name)).toEqual(['Turm am Kap', 'Die alte Mara']);
    const sections = historySections(data(), old);
    expect(sections.at(-1)).toMatchObject({ title: 'Ohne Datum' });
  });

  it('sagt, wenn sich ein Datum nicht lesen lässt, und tötet niemanden, den es schon gibt', async () => {
    const { db, data } = await setup();
    expect(
      createHistoric(db, { name: 'X', kind: 'person', ended: 'irgendwann', born: '', line: '' }),
    ).toMatchObject({ problem: expect.stringContaining('irgendwann') });
    const alive = db.put('entities', createEntity({ kind: 'person', name: 'Brann' }));
    createHistoric(db, { name: 'Brann', kind: 'person', ended: '', born: '', line: '' });
    expect(data().entities[alive.id]).toMatchObject({ person: { status: 'alive' } });
  });
});
