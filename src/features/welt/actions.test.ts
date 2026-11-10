import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { demoCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { findRelation, placeStatus } from '../../domain/derive';
import { createEntity, type Entity } from '../../domain/schema';
import {
  deleteEntityUndoable,
  discardUnusedDrafts,
  movePartyTo,
  patchDetails,
  patchEntityIfPresent,
  removeRelation,
} from './actions';

async function demoDb() {
  const store = new MemoryStore();
  const db = await CampaignDb.create(store, demoCampaign());
  return { store, db };
}
const find = (db: CampaignDb, name: string): Entity =>
  Object.values(db.getSnapshot().entities).find((e) => e.name === name)!;
/** Inhalt ohne die Felder, die jede Speicherung fortschreibt. */
const content = (doc: object) => ({ ...doc, rev: 0, updated: '' });
const contents = (docs: Readonly<Record<string, object>>) =>
  Object.fromEntries(Object.entries(docs).map(([id, doc]) => [id, content(doc)]));

describe('Gruppe hierher', () => {
  it('wechselt den Ort, hält ihn in der Chronik fest und lässt sich zurücknehmen', async () => {
    const { db } = await demoDb();
    const before = db.getSnapshot();
    const hafen = find(db, 'Dornhafen');
    const result = movePartyTo(db, hafen.id)!;
    expect(db.getSnapshot().state.placeId).toBe(hafen.id);
    expect(placeStatus(db.getSnapshot(), hafen.id).here).toBe(true);
    expect(movePartyTo(db, hafen.id)).toBeNull();
    result.undo();
    expect(db.getSnapshot().state.placeId).toBe(before.state.placeId);
    expect(db.getSnapshot().chronicle).toEqual(before.chronicle);
  });

  it('nimmt nichts zurück, wenn die Gruppe schon weitergezogen ist', async () => {
    const { db } = await demoDb();
    const result = movePartyTo(db, find(db, 'Dornhafen').id)!;
    const onward = movePartyTo(db, find(db, 'Zum Salzigen Raben').id)!;
    result.undo();
    expect(db.getSnapshot().state.placeId).toBe(find(db, 'Zum Salzigen Raben').id);
    expect(db.getSnapshot().chronicle[result.entry.id]).toBeDefined();
    expect(db.getSnapshot().chronicle[onward.entry.id]).toBeDefined();
  });
});

describe('Beziehung löschen', () => {
  it('stellt die Beziehung wieder her, solange keine neue an ihre Stelle getreten ist', async () => {
    const { db } = await demoDb();
    const voss = find(db, 'Hauptmann Voss');
    const maera = find(db, 'Maera Duskryn');
    const relation = findRelation(db.getSnapshot(), voss.id, maera.id)!;
    const undo = removeRelation(db, relation);
    expect(findRelation(db.getSnapshot(), voss.id, maera.id)).toBeUndefined();
    undo();
    expect(findRelation(db.getSnapshot(), voss.id, maera.id)).toMatchObject({
      id: relation.id,
      type: 'serves',
      attitude: 2,
    });
    undo();
    expect(
      Object.values(db.getSnapshot().relations).filter((r) => r.id === relation.id),
    ).toHaveLength(1);
  });
});

describe('Eintrag löschen und zurückholen', () => {
  it('bringt Eintrag, Beziehungen und geleerte Angaben anderer Einträge zurück', async () => {
    const { store, db } = await demoDb();
    const before = db.getSnapshot();
    const moor = find(db, 'Krähenmoor');
    if (moor.kind !== 'place') throw new Error('Krähenmoor fehlt');
    const undo = deleteEntityUndoable(db, moor.id);
    const gone = db.getSnapshot();
    expect(gone.entities[moor.id]).toBeUndefined();
    expect(gone.state.placeId).toBeNull();
    const kloster = find(db, 'Kloster Sankt Vael');
    expect(kloster.kind === 'place' && kloster.place.parentId).toBe(moor.place.parentId);
    undo();
    const back = db.getSnapshot();
    expect(contents(back.entities)).toEqual(contents(before.entities));
    expect(contents(back.relations)).toEqual(contents(before.relations));
    expect(contents(back.events)).toEqual(contents(before.events));
    expect(back.chronicle).toEqual(before.chronicle);
    expect(back.state.placeId).toBe(before.state.placeId);
    // Auch nach dem Speichern und erneuten Laden ist alles wieder da.
    await db.flush();
    const reopened = await CampaignDb.open(store);
    expect(contents(reopened.getSnapshot().entities)).toEqual(contents(before.entities));
    expect(reopened.problems).toEqual([]);
  });

  it('holt eine Person samt ihren Beziehungen und Terminverweisen zurück', async () => {
    const { db } = await demoDb();
    const before = db.getSnapshot();
    const brann = find(db, 'Brann Eisenhaken');
    const undo = deleteEntityUndoable(db, brann.id);
    expect(Object.values(db.getSnapshot().relations).some((r) => r.from === brann.id)).toBe(false);
    expect(Object.values(db.getSnapshot().events).some((e) => e.refs.includes(brann.id))).toBe(
      false,
    );
    undo();
    expect(contents(db.getSnapshot().relations)).toEqual(contents(before.relations));
    expect(contents(db.getSnapshot().events)).toEqual(contents(before.events));
    // Die Fassungsnummer läuft nur vorwärts.
    for (const [id, doc] of Object.entries(db.getSnapshot().events))
      expect(doc.rev).toBeGreaterThanOrEqual(before.events[id]!.rev);
  });

  it('überschreibt nichts, was nach dem Löschen von Hand geändert wurde', async () => {
    const { db } = await demoDb();
    const kontor = find(db, 'Kontor der Duskryn');
    const taverne = find(db, 'Zum Salzigen Raben');
    const undo = deleteEntityUndoable(db, kontor.id);
    const maera = find(db, 'Maera Duskryn');
    if (maera.kind !== 'person') throw new Error('Maera fehlt');
    expect(maera.person.placeId).toBeNull();
    patchDetails(db, maera, { placeId: taverne.id });
    undo();
    const after = find(db, 'Maera Duskryn');
    expect(after.kind === 'person' && after.person.placeId).toBe(taverne.id);
    expect(db.getSnapshot().entities[kontor.id]).toBeDefined();
    const haus = find(db, 'Haus Duskryn');
    expect(haus.kind === 'faction' && haus.faction.seatId).toBe(kontor.id);
  });
});

describe('Kleine Handgriffe', () => {
  it('ändert Notizen nur, wenn es den Eintrag noch gibt', async () => {
    const { db } = await demoDb();
    const brann = find(db, 'Brann Eisenhaken');
    expect(patchEntityIfPresent(db, brann.id, { notes: 'Riecht nach Teer.' })).toBe(true);
    expect(find(db, 'Brann Eisenhaken').notes).toBe('Riecht nach Teer.');
    db.remove('entities', brann.id);
    expect(patchEntityIfPresent(db, brann.id, { notes: 'x' })).toBe(false);
    expect(db.getSnapshot().entities[brann.id]).toBeUndefined();
  });

  it('räumt im Dialog neu angelegte, unbenutzte Orte wieder weg', async () => {
    const { db } = await demoDb();
    const unused = db.put('entities', createEntity({ kind: 'place', name: 'Nirgendwo' }));
    const used = db.put('entities', createEntity({ kind: 'place', name: 'Fährhaus' }));
    const edited = db.put('entities', createEntity({ kind: 'place', name: 'Mühle' }));
    db.patch('entities', edited.id, { tagline: 'Klappert.' });
    const brann = find(db, 'Brann Eisenhaken');
    if (brann.kind !== 'person') throw new Error('Brann fehlt');
    patchDetails(db, brann, { homeId: used.id });
    const removed = discardUnusedDrafts(db, [unused.id, used.id, edited.id, 'gibt-es-nicht'], []);
    expect(removed.map((e) => e.name)).toEqual(['Nirgendwo']);
    const entities = db.getSnapshot().entities;
    expect(entities[unused.id]).toBeUndefined();
    expect(entities[used.id]).toBeDefined();
    expect(entities[edited.id]).toBeDefined();
    // Ausdrücklich Behaltenes bleibt.
    const kept = db.put('entities', createEntity({ kind: 'place', name: 'Brücke' }));
    expect(discardUnusedDrafts(db, [kept.id], [kept.id])).toEqual([]);
    expect(db.getSnapshot().entities[kept.id]).toBeDefined();
  });
});
