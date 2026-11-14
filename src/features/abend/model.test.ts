import { describe, expect, it } from 'vitest';
import { endSession, logEntry, moveParty, setTime, startSession } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { lastSessionLines } from '../../domain/prep';
import { recap } from '../../domain/recap';
import { createEntity, createEvent } from '../../domain/schema';
import { lastLinesView, recapView, startLineOf } from './model';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  endSession(db);
  const data = () => db.getSnapshot();
  for (const entry of Object.values(data().chronicle)) db.remove('chronicle', entry.id);
  for (const session of Object.values(data().sessions)) db.remove('sessions', session.id);
  return { db, data };
}

describe('Wo es zuletzt aufhörte – als Zeilen', () => {
  it('sagt, warum nichts dasteht, solange kein Abend gespielt ist', async () => {
    const { data } = await setup();
    const view = lastLinesView(data(), lastSessionLines(data()), '');
    expect(view.lines).toEqual([]);
    expect(view.empty).toContain('Sobald ein Abend gespielt ist');
  });

  it('zeigt Geschriebenes wörtlich und Ortswechsel als Kurzfassung', async () => {
    const { db, data } = await setup();
    const steg = db.put('entities', createEntity({ kind: 'place', name: 'Nebelsteg' }));
    startSession(db, { title: 'Das leere Boot' });
    logEntry(db, { text: 'Mira verschwindet im Schilf.' });
    setTime(db, data().state.now + 10);
    const travel = moveParty(db, steg.id, 'Im Regen.')!;
    endSession(db);

    expect(startLineOf(data(), travel)).toBe('Ankunft: Nebelsteg. Im Regen.');
    const view = lastLinesView(data(), lastSessionLines(data()), 'Mira verschwindet im Schilf.');
    expect(view.title).toMatch(/^Wo es zuletzt aufhörte – Session \d+ – Das leere Boot$/);
    expect(view.empty).toBe('');
    expect(view.lines.map((line) => [line.kind, line.line, line.taken])).toEqual([
      ['Notiz', 'Mira verschwindet im Schilf.', true],
      ['Ortswechsel', 'Ankunft: Nebelsteg. Im Regen.', false],
    ]);
  });

  it('sagt es, wenn der letzte Abend nichts in der Chronik hat', async () => {
    const { db, data } = await setup();
    startSession(db);
    endSession(db);
    const view = lastLinesView(data(), lastSessionLines(data()), '');
    expect(view.lines).toEqual([]);
    expect(view.empty).toMatch(/^Zu Session \d+ steht nichts in der Chronik\.$/);
  });
});

describe('Letztes Mal – als Zeilen', () => {
  it('zeigt Einträge wörtlich, wo die Gruppe steht, was offen ist und was ansteht', async () => {
    const { db, data } = await setup();
    const mark = db.put('entities', createEntity({ kind: 'place', name: 'Nordmark' }));
    const town = db.put(
      'entities',
      createEntity({ kind: 'place', name: 'Hohenfurt', place: { parentId: mark.id } } as never),
    );
    for (const id of Object.keys(data().events)) db.remove('events', id);
    startSession(db, { title: 'Das leere Boot' });
    logEntry(db, { kind: 'promise', text: 'Odo Tannhaus zahlt die Fähre.' });
    setTime(db, data().state.now + 30);
    moveParty(db, town.id);
    endSession(db);
    db.put(
      'events',
      createEvent({ title: 'Markt in Hohenfurt', at: data().state.now + 2 * 24 * 60 }),
    );
    const view = recapView(data(), recap(data())!);
    expect(view.title).toBe('Letztes Mal – Session 1 – Das leere Boot');
    expect(view.lines.map((line) => [line.kind, line.line])).toEqual([
      ['Abmachung', 'Odo Tannhaus zahlt die Fähre.'],
      ['Ortswechsel', 'Ankunft: Hohenfurt'],
    ]);
    expect(view.where).toEqual({ id: town.id, name: 'Hohenfurt', path: 'Nordmark › Hohenfurt' });
    expect(view.open).toBe('1 offen: 1× Abmachung');
    expect(view.ahead).toEqual([
      {
        key: expect.any(String),
        when: 'in 2 Tagen',
        title: 'Markt in Hohenfurt',
        sub: 'Termin',
        storyId: null,
      },
    ]);
    expect(view.empty).toBe('');
  });
});
