import { describe, expect, it } from 'vitest';
import { fateSinceLabel, recordHeadline } from '../../domain/chronicleKinds';
import { findRelation, partyStays } from '../../domain/derive';
import {
  activeConditions,
  conditionEnding,
  fateSince,
  isNewestOfSort,
  partyPlaceAt,
  sessionAt,
  sessionForEntry,
} from '../../domain/history';
import {
  ChronicleEntrySchema,
  PARTY_ID,
  createEntity,
  createEvent,
  createPrep,
  createSession,
  createThread,
  type ChronicleEntry,
  type Entity,
} from '../../domain/schema';
import { formatDayMonth } from '../../domain/time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../../domain/time/elaris';
import { logEntry, moveParty, setAttitude, startSession } from '../actions';
import { CampaignDb } from '../db';
import {
  endCondition,
  recordEntries,
  recordEntry,
  removeRecorded,
  setRumorTruth,
  type RecordResult,
} from '../record';
import { emptyCampaign } from '../seed';
import { MemoryStore } from '../store';

const DAY = 24 * 60;
const NOW = ELARIS_START;

async function setup() {
  const db = await CampaignDb.create(
    new MemoryStore(),
    emptyCampaign('Testwelt', ELARIS_CALENDAR, NOW),
  );
  const add = <E extends Entity>(entity: E): E => db.put('entities', entity) as E;
  const hohenfurt = add(createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const grotte = add(createEntity({ kind: 'place', name: 'Salzgrotte' }));
  const moor = add(createEntity({ kind: 'place', name: 'Krähenmoor' }));
  const mira = add(createEntity({ kind: 'person', name: 'Mira Tannhaus' }));
  const lando = add(createEntity({ kind: 'person', name: 'Lando Furtner' }));
  const krummzahn = add(createEntity({ kind: 'person', name: 'Krummzahn' }));
  const bande = add(createEntity({ kind: 'faction', name: 'Die Krähenbande' }));
  const brann = add(
    createEntity({ kind: 'character', name: 'Brann Eichwald', character: { level: 3 } }),
  );
  db.setState({ placeId: hohenfurt.id });
  return { db, hohenfurt, grotte, moor, mira, lando, krummzahn, bande, brann };
}

const data = (db: CampaignDb) => db.getSnapshot();
function ok(result: RecordResult) {
  if ('problem' in result) throw new Error(result.problem);
  return result;
}
function problem(result: RecordResult): string {
  return 'problem' in result ? result.problem : '';
}
const person = (db: CampaignDb, id: string) => {
  const entity = data(db).entities[id];
  if (entity?.kind !== 'person') throw new Error('keine Person');
  return entity.person;
};
const character = (db: CampaignDb, id: string) => {
  const entity = data(db).entities[id];
  if (entity?.kind !== 'character') throw new Error('kein Gefährte');
  return entity.character;
};

describe('Festhalten: Grundregeln', () => {
  it('hält jetzt fest – mit laufender Session und dem Ort der Gruppe', async () => {
    const { db, hohenfurt } = await setup();
    const session = startSession(db, { title: 'Probe' });
    const { entry } = ok(recordEntry(db, { kind: 'decision', text: 'Wir meiden das Moor.' }));
    expect(entry).toMatchObject({
      kind: 'decision',
      at: NOW,
      sessionId: session.id,
      placeId: hohenfurt.id,
      backfilled: false,
      precision: 'exact',
    });
  });

  it('lehnt Zukunft, Termine und leere Texte ab und schreibt dann nichts', async () => {
    const { db } = await setup();
    const before = Object.keys(data(db).chronicle).length;
    expect(problem(recordEntry(db, { kind: 'note', text: 'x', at: NOW + 1 }))).toMatch(/Zukunft/);
    expect(problem(recordEntry(db, { kind: 'event' as 'note', text: 'x' }))).toMatch(/Termine/);
    expect(problem(recordEntry(db, { kind: 'quote', text: '  ' }))).toMatch(/Zitat/);
    expect(Object.keys(data(db).chronicle)).toHaveLength(before);
  });

  it('ordnet Früheres der Session seiner Weltzeit und dem damaligen Ort zu', async () => {
    const { db, hohenfurt, grotte } = await setup();
    const past = db.put(
      'sessions',
      createSession({ number: 1, startAt: NOW - 10 * DAY, endAt: NOW - 8 * DAY }),
    );
    ok(recordEntry(db, { kind: 'travel', at: NOW - 9 * DAY, travel: { toId: grotte.id } }));
    // Der Ortswechsel war der jüngste – die Gruppe ist seitdem in der Salzgrotte.
    expect(data(db).state.placeId).toBe(grotte.id);
    ok(recordEntry(db, { kind: 'travel', at: NOW - DAY, travel: { toId: hohenfurt.id } }));
    const { entry } = ok(
      recordEntry(db, { kind: 'lore', text: 'In der Grotte spukt es.', at: NOW - 9 * DAY + 60 }),
    );
    expect(entry).toMatchObject({ sessionId: past.id, placeId: grotte.id, backfilled: true });
    expect(sessionAt(data(db), NOW - 9 * DAY)?.id).toBe(past.id);
    expect(sessionForEntry(data(db), NOW - 3 * DAY)).toBeNull();
    expect(partyPlaceAt(data(db), NOW - 2 * DAY)).toBe(grotte.id);
    expect(partyPlaceAt(data(db), NOW)).toBe(hohenfurt.id);
  });

  it('stellt keine Zeit vor und löst keine Termine aus', async () => {
    const { db } = await setup();
    db.put('events', createEvent({ title: 'Markt', at: NOW - 2 * DAY }));
    const state = data(db).state;
    ok(recordEntry(db, { kind: 'note', text: 'Früher', at: NOW - 3 * DAY }));
    expect(data(db).state.now).toBe(state.now);
    expect(Object.values(data(db).chronicle).filter((e) => e.kind === 'event')).toEqual([]);
  });

  it('lädt alte Einträge ohne die neuen Felder unverändert', () => {
    const old = ChronicleEntrySchema.parse({ id: 'alt1', kind: 'note', at: 5, text: 'Alt' });
    expect(old).toMatchObject({
      backfilled: false,
      precision: 'exact',
      fate: null,
      bond: null,
      condition: null,
    });
  });
});

describe('Festhalten: Ortswechsel früher', () => {
  it('prüft die Reihenfolge gegen den nächsten späteren Ortswechsel', async () => {
    const { db, grotte, moor } = await setup();
    moveParty(db, grotte.id); // jetzt: Hohenfurt → Salzgrotte
    const ahead = recordEntry(db, { kind: 'travel', at: NOW - DAY, travel: { toId: moor.id } });
    expect(problem(ahead)).toMatch(/bricht die Gruppe aus Hohenfurt auf/);
    // Auch zusammen festgehalten muss die Folge am Ende zum späteren Aufbruch passen.
    const before = Object.keys(data(db).chronicle).length;
    const round = recordEntries(db, [
      { kind: 'travel', at: NOW - 2 * DAY, travel: { toId: moor.id } },
      { kind: 'travel', at: NOW - DAY, travel: { toId: grotte.id } },
    ]);
    expect(Object.keys(data(db).chronicle)).toHaveLength(before);
    expect('problem' in round).toBe(true);
  });

  it('nimmt eine Rundreise zwischen zwei Ortswechsel auf und lässt den Ort von heute stehen', async () => {
    const { db, hohenfurt, grotte, moor } = await setup();
    moveParty(db, grotte.id);
    const result = recordEntries(db, [
      { kind: 'travel', at: NOW - 2 * DAY, travel: { toId: moor.id } },
      { kind: 'travel', at: NOW - DAY, travel: { toId: hohenfurt.id } },
    ]);
    expect('problem' in result).toBe(false);
    expect(data(db).state.placeId).toBe(grotte.id);
    expect(partyStays(data(db)).map((stay) => stay.placeId)).toEqual([
      moor.id,
      hohenfurt.id,
      grotte.id,
    ]);
    if ('undo' in result) result.undo();
    expect(partyStays(data(db)).map((stay) => stay.placeId)).toEqual([grotte.id]);
  });

  it('Löschen eines Ortswechsels mittendrin lässt den nächsten dort aufbrechen, wo die Gruppe war', async () => {
    const { db, hohenfurt, grotte, moor } = await setup();
    const first = ok(
      recordEntry(db, { kind: 'travel', at: NOW - 3 * DAY, travel: { toId: moor.id } }),
    );
    const middle = ok(
      recordEntry(db, { kind: 'travel', at: NOW - 2 * DAY, travel: { toId: grotte.id } }),
    );
    const last = ok(recordEntry(db, { kind: 'travel', travel: { toId: hohenfurt.id } }));
    expect(first.entry.travel?.fromId).toBe(hohenfurt.id);
    const undo = removeRecorded(db, middle.entry.id)!;
    expect(data(db).chronicle[last.entry.id]!.travel).toEqual({
      fromId: moor.id,
      toId: hohenfurt.id,
    });
    expect(data(db).state.placeId).toBe(hohenfurt.id);
    undo();
    expect(data(db).chronicle[middle.entry.id]).toBeTruthy();
    expect(data(db).chronicle[last.entry.id]!.travel?.fromId).toBe(grotte.id);
  });

  it('Löschen des jüngsten Ortswechsels bringt die Gruppe zurück', async () => {
    const { db, hohenfurt, grotte } = await setup();
    const { entry, undo } = ok(recordEntry(db, { kind: 'travel', travel: { toId: grotte.id } }));
    expect(data(db).state.placeId).toBe(grotte.id);
    undo();
    expect(data(db).state.placeId).toBe(hohenfurt.id);
    expect(data(db).chronicle[entry.id]).toBeUndefined();
  });
});

describe('Festhalten: der jüngste Eintrag zählt', () => {
  it('Schicksal: ein nachgetragenes älteres ändert den heutigen Zustand nicht', async () => {
    const { db, krummzahn } = await setup();
    const dead = ok(
      recordEntry(db, {
        kind: 'fate',
        at: NOW - DAY,
        fate: { entityId: krummzahn.id, status: 'dead' },
      }),
    );
    expect(person(db, krummzahn.id).status).toBe('dead');
    expect(dead.entry.fate?.before).toBe('alive');
    const older = ok(
      recordEntry(db, {
        kind: 'fate',
        at: NOW - 5 * DAY,
        fate: { entityId: krummzahn.id, status: 'missing' },
      }),
    );
    expect(person(db, krummzahn.id).status).toBe('dead');
    expect(isNewestOfSort(data(db), older.entry)).toBe(false);
    // Der spätere Eintrag fand nun „verschollen“ vor.
    expect(data(db).chronicle[dead.entry.id]!.fate?.before).toBe('missing');
    expect(fateSince(data(db), krummzahn.id)?.since).toBe(NOW - DAY);
    expect(fateSinceLabel(data(db), krummzahn.id)).toBe(
      `Tot seit ${formatDayMonth(ELARIS_CALENDAR, NOW - DAY)}`,
    );
    expect(recordHeadline(data(db), dead.entry)).toBe('Krummzahn: tot');
    // Löschen des jüngsten: Es gilt wieder der davor.
    removeRecorded(db, dead.entry.id);
    expect(person(db, krummzahn.id).status).toBe('missing');
    older.undo();
    expect(person(db, krummzahn.id).status).toBe('alive');
  });

  it('Haltung früher: vorher aus dem Verlauf, die Beziehung nur beim jüngsten', async () => {
    const { db, lando } = await setup();
    setAttitude(db, lando.id, PARTY_ID, 2, 'Geholfen');
    const past = ok(
      recordEntry(db, {
        kind: 'attitude',
        at: NOW - 3 * DAY,
        attitude: { fromId: lando.id, toId: PARTY_ID, value: -1 },
      }),
    );
    expect(past.entry.attitude).toMatchObject({ before: null, after: -1 });
    expect(findRelation(data(db), lando.id, PARTY_ID)?.attitude).toBe(2);
    const now = Object.values(data(db).chronicle).find(
      (e) => e.kind === 'attitude' && e.at === NOW,
    )!;
    expect(now.attitude?.before).toBe(-1);
  });

  it('Aufenthalt gilt für Personen und Gefährten und lässt sich zurücknehmen', async () => {
    const { db, mira, brann, grotte } = await setup();
    ok(
      recordEntry(db, {
        kind: 'whereabouts',
        whereabouts: { entityId: mira.id, placeId: grotte.id },
      }),
    );
    expect(person(db, mira.id).placeId).toBe(grotte.id);
    const { undo } = ok(
      recordEntry(db, {
        kind: 'whereabouts',
        whereabouts: { entityId: brann.id, placeId: grotte.id },
      }),
    );
    expect(character(db, brann.id).placeId).toBe(grotte.id);
    undo();
    expect(character(db, brann.id).placeId).toBeNull();
  });

  it('Meilenstein setzt die Stufe, Löschen nimmt sie zurück', async () => {
    const { db, brann } = await setup();
    const { undo } = ok(
      recordEntry(db, { kind: 'milestone', milestone: { characterId: brann.id, level: 4 } }),
    );
    expect(character(db, brann.id).level).toBe(4);
    undo();
    expect(character(db, brann.id).level).toBe(3);
  });

  it('Begegnung macht bekannt; Löschen nimmt es zurück, wenn keine andere bleibt', async () => {
    const { db, mira } = await setup();
    const first = ok(recordEntry(db, { kind: 'meeting', refs: [mira.id] }));
    const second = ok(recordEntry(db, { kind: 'meeting', refs: [mira.id] }));
    expect(person(db, mira.id).met).toBe(true);
    expect(second.entry.meeting?.firstMet).toEqual([]);
    first.undo();
    expect(person(db, mira.id).met).toBe(true);
    removeRecorded(db, second.entry.id);
    expect(person(db, mira.id).met).toBe(true); // die zweite hat nichts geändert
  });

  it('Begegnung zum ersten Mal: Löschen macht wieder unbekannt', async () => {
    const { db, mira } = await setup();
    const { undo } = ok(recordEntry(db, { kind: 'meeting', refs: [mira.id] }));
    expect(person(db, mira.id).met).toBe(true);
    undo();
    expect(person(db, mira.id).met).toBe(false);
  });

  it('Beziehung beginnt und endet', async () => {
    const { db, mira, lando } = await setup();
    const start = ok(
      recordEntry(db, { kind: 'bond', bond: { fromId: mira.id, toId: lando.id, type: 'ally' } }),
    );
    const relationId = start.entry.bond!.relationId!;
    expect(data(db).relations[relationId]).toMatchObject({ type: 'ally', ended: false });
    const end = ok(
      recordEntry(db, {
        kind: 'bond',
        bond: { fromId: mira.id, toId: lando.id, type: 'ally', ended: true },
      }),
    );
    expect(data(db).relations[relationId]!.ended).toBe(true);
    expect(recordHeadline(data(db), end.entry)).toBe(
      'Beziehung beendet: Mira Tannhaus verbündet mit Lando Furtner',
    );
    end.undo();
    expect(data(db).relations[relationId]!.ended).toBe(false);
    start.undo();
    expect(data(db).relations[relationId]).toBeUndefined();
  });

  it('Spielerwunsch setzt das Ziel nur, wenn gewünscht', async () => {
    const { db, brann } = await setup();
    ok(
      recordEntry(db, {
        kind: 'wish',
        text: 'Ein eigenes Schiff',
        wish: { characterId: brann.id },
      }),
    );
    expect(character(db, brann.id).goal).toBe('');
    const { undo } = ok(
      recordEntry(db, {
        kind: 'wish',
        text: 'Den Vater finden',
        wish: { characterId: brann.id, setGoal: true },
      }),
    );
    expect(character(db, brann.id).goal).toBe('Den Vater finden');
    undo();
    expect(character(db, brann.id).goal).toBe('');
  });

  it('Hinweis gefunden und Geheimnis aufgedeckt wirken am Faden und am Abend-Blatt', async () => {
    const { db } = await setup();
    const thread = db.put(
      'threads',
      createThread({
        title: 'Wer führt die Krähenbande?',
        known: false,
        hints: [{ id: 'h1', text: 'Ein Siegel', placeId: null, sourceId: null, found: false }],
      }),
    );
    const clue = ok(recordEntry(db, { kind: 'clue', clue: { threadId: thread.id, hintId: 'h1' } }));
    expect(data(db).threads[thread.id]).toMatchObject({ known: true, state: 'active' });
    expect(data(db).threads[thread.id]!.hints[0]!.found).toBe(true);
    clue.undo();
    expect(data(db).threads[thread.id]).toMatchObject({ known: false, state: 'open' });
    expect(data(db).threads[thread.id]!.hints[0]!.found).toBe(false);

    const prep = db.put(
      'preps',
      createPrep({
        secrets: [
          {
            id: 's1',
            text: 'Lando ist ein Spitzel',
            storyId: null,
            revealed: false,
            revealedAt: null,
            hint: null,
            carried: 0,
          },
        ],
      }),
    );
    const reveal = ok(
      recordEntry(db, { kind: 'reveal', at: NOW - 60, reveal: { prepSecretId: 's1' } }),
    );
    expect(reveal.entry.text).toBe('Lando ist ein Spitzel');
    expect(data(db).preps[prep.id]!.secrets[0]).toMatchObject({
      revealed: true,
      revealedAt: NOW - 60,
    });
    reveal.undo();
    expect(data(db).preps[prep.id]!.secrets[0]).toMatchObject({
      revealed: false,
      revealedAt: null,
    });
  });
});

describe('Zustände und Gerüchte', () => {
  it('ein Zustand bleibt offen, bis er aufgehoben wird – auch rückwirkend', async () => {
    const { db, brann } = await setup();
    const arrow = ok(
      recordEntry(db, {
        kind: 'condition',
        text: 'Pfeil im Bein',
        at: NOW - 2 * DAY,
        condition: { entityId: brann.id },
      }),
    );
    expect(activeConditions(data(db), brann.id).map((c) => c.entry.id)).toEqual([arrow.entry.id]);
    const ended = ok(endCondition(db, arrow.entry.id, { at: NOW - DAY }));
    expect(ended.entry).toMatchObject({
      text: 'Pfeil im Bein',
      condition: { entityId: brann.id, ended: true, endsId: arrow.entry.id },
    });
    expect(activeConditions(data(db), brann.id)).toEqual([]);
    expect(activeConditions(data(db), brann.id, NOW - DAY - 1)).toHaveLength(1);
    expect(conditionEnding(data(db), arrow.entry.id)?.id).toBe(ended.entry.id);
    expect(recordHeadline(data(db), data(db).chronicle[arrow.entry.id]!)).toBe(
      'Zustand von Brann Eichwald (aufgehoben)',
    );
    expect(problem(endCondition(db, ended.entry.id))).toMatch(/gibt es nicht/);
    ended.undo();
    expect(activeConditions(data(db), brann.id)).toHaveLength(1);
  });

  it('ein Ende ohne Verweis hebt den gleichlautenden jüngsten Zustand auf', async () => {
    const { db, mira } = await setup();
    ok(
      recordEntry(db, {
        kind: 'condition',
        text: 'verflucht',
        at: NOW - DAY,
        condition: { entityId: mira.id },
      }),
    );
    ok(
      recordEntry(db, {
        kind: 'condition',
        text: 'Verflucht',
        condition: { entityId: mira.id, ended: true },
      }),
    );
    expect(activeConditions(data(db), mira.id)).toEqual([]);
  });

  it('der Stand eines Gerüchts lässt sich ändern', async () => {
    const { db, lando } = await setup();
    const { entry } = ok(
      recordEntry(db, {
        kind: 'rumor',
        text: 'In der Salzgrotte liegt Gold.',
        rumor: { sourceId: lando.id },
      }),
    );
    expect(entry.rumor).toEqual({ sourceId: lando.id, truth: 'unchecked' });
    expect(entry.refs).toContain(lando.id);
    setRumorTruth(db, entry.id, 'false');
    const after: ChronicleEntry = data(db).chronicle[entry.id]!;
    expect(after.rumor?.truth).toBe('false');
    expect(recordHeadline(data(db), after)).toBe('Gerücht von Lando Furtner · falsch');
  });
});

describe('bisherige Befehle bleiben, wie sie sind', () => {
  it('logEntry und moveParty schreiben wie bisher', async () => {
    const { db, hohenfurt, grotte } = await setup();
    const note = logEntry(db, { text: ' Notiz ' });
    expect(note).toMatchObject({
      kind: 'note',
      text: 'Notiz',
      placeId: hohenfurt.id,
      backfilled: false,
    });
    const travel = moveParty(db, grotte.id)!;
    expect(travel.travel).toEqual({ fromId: hohenfurt.id, toId: grotte.id });
    expect(data(db).state.placeId).toBe(grotte.id);
  });
});
