import { describe, expect, it } from 'vitest';
import { endSession, logEntry, moveParty, setTime, startSession } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { recordEntry } from '../../data/record';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { dismissRecap } from '../../features/tisch/commands';
import {
  RECAP_LINES,
  hasRecorded,
  recap,
  recapAhead,
  recapEntries,
  sessionBefore,
  tableRecap,
} from '../recap';
import { createClock, createEntity, createEvent, newId } from '../schema';
import { MINUTES_PER_DAY } from '../time/calendar';

/** Ein erfundener Abend in Hohenfurt: ein paar Einträge, darunter Alltag. */
async function played() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  endSession(db);
  const data = () => db.getSnapshot();
  for (const name of ['chronicle', 'sessions', 'events', 'clocks'] as const)
    for (const id of Object.keys(data()[name])) db.remove(name, id);
  const town = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const grotto = db.put('entities', createEntity({ kind: 'place', name: 'Salzgrotte' }));
  moveParty(db, town.id);
  const first = startSession(db);
  const tick = () => setTime(db, data().state.now + 30);
  logEntry(db, { text: 'Lando Furtner bittet um Hilfe.' });
  tick();
  recordEntry(db, { kind: 'rest', rest: { long: false } });
  tick();
  recordEntry(db, { kind: 'decision', text: 'Die Gruppe nimmt den Weg durch die Grotte.' });
  tick();
  logEntry(db, { kind: 'promise', text: 'Mira Tannhaus bekommt ihr Boot zurück.' });
  tick();
  moveParty(db, grotto.id);
  tick();
  logEntry(db, { text: '   ' });
  endSession(db);
  return { db, data, first, town, grotto };
}

describe('Letztes Mal', () => {
  it('gibt es nicht ohne früheren Abend', async () => {
    const { db, data } = await played();
    for (const id of Object.keys(data().sessions)) db.remove('sessions', id);
    expect(recap(data())).toBeNull();
    expect(sessionBefore(data(), 5)).toBeNull();
  });

  it('zeigt die Einträge des vorigen Abends, wie sie geschrieben wurden – ohne Alltag', async () => {
    const { data, first, grotto } = await played();
    const back = recap(data())!;
    expect(back.session.id).toBe(first.id);
    expect(back.entries.map((entry) => entry.kind)).toEqual([
      'note',
      'decision',
      'promise',
      'travel',
    ]);
    expect(back.entries[0]!.text).toBe('Lando Furtner bittet um Hilfe.');
    expect(back.more).toBe(0);
    expect(back.placeId).toBe(grotto.id);
    // Die offene Abmachung hängt noch.
    expect(back.open.groups).toContainEqual({ reason: 'promise', count: 1 });
    expect(back.open.total).toBeGreaterThanOrEqual(1);
  });

  it('wählt bei vielen Einträgen die gewichtigsten und zeigt sie in ihrer Reihenfolge', async () => {
    const { db, data } = await played();
    const second = startSession(db);
    for (let i = 0; i < RECAP_LINES + 2; i++) {
      setTime(db, data().state.now + 10);
      logEntry(db, { text: `Notiz ${i}` });
    }
    setTime(db, data().state.now + 10);
    recordEntry(db, { kind: 'decision', text: 'Brann Eichwald bleibt in Hohenfurt.' });
    const { entries, more } = recapEntries(data(), second.id);
    expect(entries).toHaveLength(RECAP_LINES);
    expect(more).toBe(3);
    // Die Entscheidung wiegt mehr; von den Notizen bleiben die späteren.
    expect(entries.at(-1)!.kind).toBe('decision');
    expect(entries[0]!.text).toBe('Notiz 3');
    expect(entries.map((entry) => entry.at)).toEqual(
      [...entries.map((entry) => entry.at)].sort((a, b) => a - b),
    );
  });

  it('nennt, was als Nächstes ansteht: Termine ohne Alltag und Schritte von Uhren', async () => {
    const { db, data } = await played();
    const now = data().state.now;
    db.put('events', createEvent({ title: 'Markt in Hohenfurt', at: now + 2 * MINUTES_PER_DAY }));
    db.put(
      'events',
      createEvent({ title: 'Brot backen', at: now, repeat: { every: 1, unit: 'day' } }),
    );
    db.put('events', createEvent({ title: 'Viel später', at: now + 30 * MINUTES_PER_DAY }));
    db.put(
      'clocks',
      createClock({
        title: 'Die Schmuggler von Burg Graufels',
        start: now,
        steps: [{ id: newId(), text: 'Das Boot legt ab.', days: 3 } as never],
      }),
    );
    const ahead = recapAhead(data());
    expect(ahead.map((item) => item.title)).toEqual(['Markt in Hohenfurt', 'Das Boot legt ab.']);
    expect(ahead[1]).toMatchObject({
      kind: 'clock',
      clockTitle: 'Die Schmuggler von Burg Graufels',
    });
  });

  it('steht am Spieltisch, bis im neuen Abend etwas festgehalten oder er weggeklickt ist', async () => {
    const { db, data, first } = await played();
    // Ohne laufenden Abend nicht.
    expect(tableRecap(data())).toBeNull();
    const second = startSession(db);
    expect(tableRecap(data())!.session.id).toBe(first.id);
    expect(hasRecorded(data(), second.id)).toBe(false);

    dismissRecap(db);
    expect(data().state.recapDismissed).toBe(second.id);
    expect(tableRecap(data())).toBeNull();
    dismissRecap(db, true);
    expect(tableRecap(data())).not.toBeNull();

    logEntry(db, { text: 'Ilka Sturmfels kommt zu spät.' });
    expect(hasRecorded(data(), second.id)).toBe(true);
    expect(tableRecap(data())).toBeNull();
    // Auf „Abend vorbereiten“ bleibt der Rückblick auf den Abend vor dem laufenden.
    expect(recap(data(), second.number)!.session.id).toBe(first.id);
  });

  it('nimmt den Rückblick, den der Spielleiter zum Abend geschrieben hat, wörtlich', async () => {
    const { db, data, first } = await played();
    db.patch('sessions', first.id, { recap: '  Ihr seid in der Salzgrotte erwacht.  ' });
    expect(recap(data())!.told).toBe('Ihr seid in der Salzgrotte erwacht.');
  });
});
