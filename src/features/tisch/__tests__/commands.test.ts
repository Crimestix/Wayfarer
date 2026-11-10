import { describe, expect, it } from 'vitest';
import { logEntry, moveParty } from '../../../data/actions';
import { CampaignDb } from '../../../data/db';
import { demoCampaign } from '../../../data/__fixtures__/demoWorld';
import { MemoryStore } from '../../../data/store';
import {
  entitiesOfKind,
  openPromises,
  overdueEvents,
  placeStatus,
  runningTimers,
} from '../../../domain/derive';
import { createEvent, createTimer } from '../../../domain/schema';
import {
  canDeleteEntry,
  deleteEntry,
  restoreEntry,
  reviseEntry,
  setExhaustion,
  settleAgendaItem,
  undoMove,
} from '../commands';
import { buildAgenda } from '../model';

async function demoDb() {
  const store = new MemoryStore();
  const db = await CampaignDb.create(store, demoCampaign());
  return { db, store };
}
const place = (db: CampaignDb, name: string) =>
  entitiesOfKind(db.getSnapshot(), 'place').find((p) => p.name === name)!;

describe('Ortswechsel zurücknehmen', () => {
  it('stellt Ort und Chronik wieder her', async () => {
    const { db } = await demoDb();
    const before = db.getSnapshot();
    const entry = moveParty(db, place(db, 'Dornhafen').id)!;
    expect(db.getSnapshot().state.placeId).toBe(place(db, 'Dornhafen').id);
    expect(undoMove(db, entry.id)).toBe(true);
    const after = db.getSnapshot();
    expect(after.state.placeId).toBe(before.state.placeId);
    expect(Object.keys(after.chronicle).sort()).toEqual(Object.keys(before.chronicle).sort());
    expect(placeStatus(after, place(db, 'Dornhafen').id).here).toBe(false);
  });

  it('weigert sich, wenn die Gruppe inzwischen weitergezogen ist', async () => {
    const { db } = await demoDb();
    const first = moveParty(db, place(db, 'Dornhafen').id)!;
    const second = moveParty(db, place(db, 'Zum Salzigen Raben').id)!;
    expect(undoMove(db, first.id)).toBe(false);
    expect(db.getSnapshot().chronicle[first.id]).toBeDefined();
    expect(undoMove(db, second.id)).toBe(true);
    expect(db.getSnapshot().state.placeId).toBe(place(db, 'Dornhafen').id);
    expect(undoMove(db, second.id)).toBe(false);
    const note = logEntry(db, { text: 'Kein Ortswechsel' });
    expect(undoMove(db, note.id)).toBe(false);
  });
});

describe('Erschöpfung', () => {
  it('setzt die Stufe in den Grenzen 0 bis 6 und bleibt nach dem Laden erhalten', async () => {
    const { db, store } = await demoDb();
    const tomlin = entitiesOfKind(db.getSnapshot(), 'character').find((c) => c.name === 'Tomlin')!;
    setExhaustion(db, tomlin.id, 3);
    setExhaustion(db, tomlin.id, 3);
    expect(db.getSnapshot().entities[tomlin.id]).toMatchObject({
      character: { exhaustion: 3 },
      rev: tomlin.rev + 1,
    });
    setExhaustion(db, tomlin.id, 11);
    await db.flush();
    const reopened = await CampaignDb.open(store);
    expect(reopened.getSnapshot().entities[tomlin.id]).toMatchObject({
      character: { exhaustion: 6 },
    });
    setExhaustion(db, tomlin.id, -2);
    expect(db.getSnapshot().entities[tomlin.id]).toMatchObject({ character: { exhaustion: 0 } });
    // Kein Gefährte: nichts geschieht.
    setExhaustion(db, place(db, 'Dornhafen').id, 2);
    setExhaustion(db, 'gibtesnicht', 2);
  });
});

describe('Anstehendes abhaken', () => {
  it('erledigt Fristen, Abmachungen und Timer und nimmt den Haken zurück', async () => {
    const { db } = await demoDb();
    const now = db.getSnapshot().state.now;
    const deadline = db.put(
      'events',
      createEvent({ title: 'Zoll bezahlen', at: now - 2880, kind: 'deadline' }),
    );
    const timer = db.put('timers', createTimer({ label: 'Fackel', start: now, end: now + 60 }));
    const promise = openPromises(db.getSnapshot())[0]!;
    const item = (id: string) => buildAgenda(db.getSnapshot()).find((i) => i.id === id);

    settleAgendaItem(db, item(deadline.id)!);
    expect(overdueEvents(db.getSnapshot())).toEqual([]);
    expect(item(deadline.id)).toBeUndefined();
    settleAgendaItem(db, { source: 'event', id: deadline.id }, false);
    expect(item(deadline.id)?.tone).toBe('overdue');

    settleAgendaItem(db, item(promise.id)!);
    expect(openPromises(db.getSnapshot())).toEqual([]);
    settleAgendaItem(db, { source: 'promise', id: promise.id }, false);
    expect(openPromises(db.getSnapshot())).toHaveLength(1);

    settleAgendaItem(db, item(timer.id)!);
    expect(runningTimers(db.getSnapshot())).toEqual([]);
    // Verschwundenes wirft nicht.
    settleAgendaItem(db, { source: 'timer', id: 'fort' });
    settleAgendaItem(db, { source: 'event', id: 'fort' });
  });
});

describe('Einträge der Mitschrift', () => {
  it('ändert Text und Verweise', async () => {
    const { db } = await demoDb();
    const entry = logEntry(db, { text: 'Tipfehler', refs: [place(db, 'Dornhafen').id] });
    reviseEntry(db, entry.id, { text: '  Tippfehler behoben ' });
    expect(db.getSnapshot().chronicle[entry.id]).toMatchObject({
      text: 'Tippfehler behoben',
      refs: [place(db, 'Dornhafen').id],
    });
    const raven = place(db, 'Zum Salzigen Raben').id;
    reviseEntry(db, entry.id, { text: 'Neu', refs: [raven, raven] });
    expect(db.getSnapshot().chronicle[entry.id]!.refs).toEqual([raven]);
    reviseEntry(db, 'fort', { text: 'x' });
  });

  it('löscht nur Notizen, Abmachungen und Veränderungen – und stellt sie wieder her', async () => {
    const { db } = await demoDb();
    const note = logEntry(db, { text: 'Kann weg' });
    const travel = moveParty(db, place(db, 'Dornhafen').id)!;
    expect(canDeleteEntry(note)).toBe(true);
    expect(canDeleteEntry(travel)).toBe(false);
    expect(deleteEntry(db, travel.id)).toBeNull();
    expect(db.getSnapshot().chronicle[travel.id]).toBeDefined();
    const removed = deleteEntry(db, note.id)!;
    expect(db.getSnapshot().chronicle[note.id]).toBeUndefined();
    restoreEntry(db, removed);
    expect(db.getSnapshot().chronicle[note.id]?.text).toBe('Kann weg');
    restoreEntry(db, removed);
    expect(db.getSnapshot().chronicle[note.id]?.rev).toBe(removed.rev + 1);
  });
});
