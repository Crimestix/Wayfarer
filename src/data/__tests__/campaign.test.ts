import { describe, expect, it } from 'vitest';
import {
  attitudeHistory,
  attitudeToParty,
  entitiesOfKind,
  placeCast,
  placePath,
  placeStatus,
  relationPairs,
  searchEntities,
  upcomingOccurrences,
  visitsTo,
} from '../../domain/derive';
import { PARTY_ID, createEvent, createTimer } from '../../domain/schema';
import {
  advanceTime,
  deleteEntity,
  logEntry,
  moveParty,
  setAttitude,
  undoTimeAdvance,
} from '../actions';
import { CampaignDb, CampaignMissingError } from '../db';
import { demoCampaign } from '../seed';
import { MemoryStore } from '../store';

async function demoDb() {
  const store = new MemoryStore();
  const db = await CampaignDb.create(store, demoCampaign());
  return { store, db };
}
const place = (db: CampaignDb, name: string) =>
  entitiesOfKind(db.getSnapshot(), 'place').find((p) => p.name === name)!;
const person = (db: CampaignDb, name: string) =>
  entitiesOfKind(db.getSnapshot(), 'person').find((p) => p.name === name)!;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Ablage', () => {
  it('speichert jedes Dokument als eigene Datei und lädt alles wieder', async () => {
    const { store, db } = await demoDb();
    expect(store.files.has('campaign.json')).toBe(true);
    expect(store.files.has('state.json')).toBe(true);
    const reopened = await CampaignDb.open(store);
    expect(reopened.getSnapshot()).toEqual(db.getSnapshot());
    expect(reopened.problems).toEqual([]);
  });

  it('meldet eine leere Ablage', async () => {
    await expect(CampaignDb.open(new MemoryStore())).rejects.toBeInstanceOf(CampaignMissingError);
  });

  it('überschreibt unlesbare Dateien nicht und meldet sie', async () => {
    const { store } = await demoDb();
    const anyEntity = [...store.files.keys()].find((k) => k.startsWith('entities/'))!;
    store.files.set('entities/kaputt.json', '{ nicht json');
    store.files.set('entities/kopie (Konflikt).json', store.files.get(anyEntity)!);
    const db = await CampaignDb.open(store);
    expect(db.problems.map((p) => p.path).sort()).toEqual([
      'entities/kaputt.json',
      'entities/kopie (Konflikt).json',
    ]);
    await db.flush();
    expect(store.files.get('entities/kaputt.json')).toBe('{ nicht json');
  });

  it('übernimmt Änderungen von einem anderen Gerät', async () => {
    const { store, db } = await demoDb();
    const hafen = place(db, 'Dornhafen');
    const changed = { ...hafen, name: 'Dornhafen (neu)', rev: hafen.rev + 1 };
    store.externalWrite(`entities/${hafen.id}.json`, JSON.stringify(changed));
    await tick();
    expect(db.getSnapshot().entities[hafen.id]!.name).toBe('Dornhafen (neu)');
    store.externalWrite(`entities/${hafen.id}.json`, null);
    await tick();
    expect(db.getSnapshot().entities[hafen.id]).toBeUndefined();
  });
});

describe('Ort, Personen, Besuche', () => {
  it('zeigt, wer an einem Ort eine Rolle spielt – auch in Orten darunter', async () => {
    const { db } = await demoDb();
    const data = db.getSnapshot();
    const cast = placeCast(data, place(db, 'Dornhafen').id);
    expect(cast.present.map((p) => p.name)).toEqual([
      'Brann Eisenhaken',
      'Hauptmann Voss',
      'Isolde Rabenschwinge',
      'Kessa Flutwind',
      'Maera Duskryn',
    ]);
    expect(cast.factions.map((f) => f.name)).toEqual(['Bruderschaft der Lotsen', 'Haus Duskryn']);
    const kloster = placeCast(data, place(db, 'Kloster Sankt Vael').id);
    expect(kloster.away.map((p) => p.name)).toEqual(['Bruder Teoric']);
    expect(placePath(data, place(db, 'Zum Salzigen Raben').id)).toBe(
      'Nebelküste › Dornhafen › Zum Salzigen Raben',
    );
  });

  it('leitet Besuche aus den Ortswechseln ab und sammelt, was sich seitdem verändert hat', async () => {
    const { db } = await demoDb();
    const data = db.getSnapshot();
    const hafen = place(db, 'Dornhafen');
    const status = placeStatus(data, hafen.id);
    expect(status.visits).toHaveLength(1);
    expect(status.here).toBe(false);
    expect(status.lastLeft).toBe(data.state.now - 6 * 1440);
    expect(status.changesSince.map((e) => e.kind)).toEqual(['change', 'change']);
    // Kloster liegt im Moor: Hin- und Rückweg bilden einen zusammenhängenden Aufenthalt im Moor.
    const moor = visitsTo(data, place(db, 'Krähenmoor').id);
    expect(moor).toHaveLength(1);
    expect(moor[0]!.to).toBeNull();
    expect(placeStatus(data, place(db, 'Kloster Sankt Vael').id).visits).toHaveLength(1);
  });

  it('hält Ortswechsel in der Chronik fest', async () => {
    const { db } = await demoDb();
    const hafen = place(db, 'Dornhafen');
    moveParty(db, hafen.id, 'Zurück in der Stadt.');
    const data = db.getSnapshot();
    expect(data.state.placeId).toBe(hafen.id);
    const status = placeStatus(data, hafen.id);
    expect(status.visits).toHaveLength(2);
    expect(status.here).toBe(true);
    // Auch nach der Rückkehr bleibt sichtbar, was in der Abwesenheit geschah.
    expect(status.changesSince.map((e) => e.kind)).toEqual(['change', 'change']);
    expect(moveParty(db, hafen.id)).toBeNull();
  });
});

describe('Beziehungen', () => {
  it('führt die Haltung zur Gruppe mit Verlauf', async () => {
    const { db } = await demoDb();
    const voss = person(db, 'Hauptmann Voss');
    expect(attitudeToParty(db.getSnapshot(), voss.id)).toBe(-2);
    setAttitude(db, voss.id, PARTY_ID, -3, 'Die Gruppe ist in das Kontor eingebrochen.');
    const data = db.getSnapshot();
    expect(attitudeToParty(data, voss.id)).toBe(-3);
    const history = attitudeHistory(data, voss.id, PARTY_ID);
    expect(history.map((e) => [e.attitude!.before, e.attitude!.after])).toEqual([
      [0, -2],
      [-2, -3],
    ]);
    const kessa = person(db, 'Kessa Flutwind');
    expect(attitudeToParty(data, kessa.id)).toBeNull();
    setAttitude(db, kessa.id, PARTY_ID, 1);
    expect(attitudeToParty(db.getSnapshot(), kessa.id)).toBe(1);
  });

  it('fasst Beziehungen je Gegenüber zusammen, die Gruppe zuerst', async () => {
    const { db } = await demoDb();
    const data = db.getSnapshot();
    const maera = person(db, 'Maera Duskryn');
    const pairs = relationPairs(data, maera.id);
    expect(pairs[0]!.otherId).toBe(PARTY_ID);
    const voss = pairs.find((p) => p.otherId === person(db, 'Hauptmann Voss').id)!;
    expect(voss.incoming?.type).toBe('serves');
    expect(voss.outgoing).toBeNull();
  });

  it('löst beim Löschen Beziehungen und Verweise', async () => {
    const { db } = await demoDb();
    const hafen = place(db, 'Dornhafen');
    const taverne = place(db, 'Zum Salzigen Raben');
    deleteEntity(db, hafen.id);
    const data = db.getSnapshot();
    expect(data.entities[hafen.id]).toBeUndefined();
    expect(placePath(data, taverne.id)).toBe('Nebelküste › Zum Salzigen Raben');
    expect(person(db, 'Brann Eisenhaken').person.placeId).toBeNull();
    expect(Object.values(data.relations).some((r) => r.to === hafen.id)).toBe(false);
  });
});

describe('Zeit', () => {
  it('lässt Termine eintreten, Timer ablaufen und nimmt den Sprung zurück', async () => {
    const { db } = await demoDb();
    const start = db.getSnapshot().state.now;
    db.put('timers', createTimer({ label: 'Fackel', start, end: start + 60 }));
    const before = Object.keys(db.getSnapshot().chronicle).length;
    const result = advanceTime(db, start + 3 * 1440);
    expect(result.occurred.map((o) => o.event.title)).toEqual([
      'Treffen mit Brann am Nordkai',
      'Der Graue Fang legt ab',
    ]);
    expect(result.expired.map((t) => t.label)).toEqual(['Fackel']);
    let data = db.getSnapshot();
    expect(Object.keys(data.chronicle).length).toBe(before + 2);
    const fang = Object.values(data.events).find((e) => e.title === 'Der Graue Fang legt ab')!;
    expect(fang.done).toBe(true);
    expect(undoTimeAdvance(db)).toBe(true);
    data = db.getSnapshot();
    expect(data.state.now).toBe(start);
    expect(Object.keys(data.chronicle).length).toBe(before);
    expect(data.events[fang.id]!.done).toBe(false);
    expect(Object.values(data.timers)[0]!.done).toBe(false);
    expect(undoTimeAdvance(db)).toBe(false);
    expect(() => advanceTime(db, start)).toThrow();
  });

  it('zeigt kommende Termine und Wiederholungen', async () => {
    const { db } = await demoDb();
    const now = db.getSnapshot().state.now;
    db.put(
      'events',
      createEvent({ title: 'Markttag', at: now + 1440, repeat: { every: 1, unit: 'week' } }),
    );
    const upcoming = upcomingOccurrences(db.getSnapshot(), 16);
    expect(upcoming.filter((o) => o.event.title === 'Markttag')).toHaveLength(3);
    expect(upcoming[0]!.event.title).toBe('Markttag');
  });

  it('protokolliert Notizen am Aufenthaltsort der Gruppe und findet Einträge', async () => {
    const { db } = await demoDb();
    const entry = logEntry(db, { text: ' Ein Rabe folgt der Gruppe. ' });
    expect(entry.text).toBe('Ein Rabe folgt der Gruppe.');
    expect(entry.placeId).toBe(place(db, 'Krähenmoor').id);
    expect(entry.sessionId).toBe(db.getSnapshot().state.sessionId);
    expect(searchEntities(db.getSnapshot(), 'krahen').map((e) => e.name)).toEqual(['Krähenmoor']);
    expect(
      searchEntities(db.getSnapshot(), 'dusk', { kinds: ['person'] }).map((e) => e.name),
    ).toEqual(['Maera Duskryn', 'Hauptmann Voss']); // Voss nur über die Kurzbeschreibung
  });
});
