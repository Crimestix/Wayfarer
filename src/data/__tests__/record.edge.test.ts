/**
 * Schwierige Fälle beim Festhalten: gleiche Weltzeit, Reihenfolge beim Nachtragen, Zurücknehmen
 * der Wirkung, wenn sich der Spielstand inzwischen geändert hat. Erfundene Welt.
 */
import { describe, expect, it } from 'vitest';
import { findRelation, partyStays } from '../../domain/derive';
import { activeConditions } from '../../domain/history';
import {
  PARTY_ID,
  createChronicleEntry,
  createEntity,
  createSession,
  type Entity,
} from '../../domain/schema';
import { ELARIS_CALENDAR, ELARIS_START } from '../../domain/time/elaris';
import { setAttitude, startSession } from '../actions';
import { CampaignDb } from '../db';
import { reviseRecorded } from '../../features/chronik/actions';
import { recordEntries, recordEntry, removeRecorded, type RecordResult } from '../record';
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
  const krummzahn = add(createEntity({ kind: 'person', name: 'Krummzahn' }));
  const brann = add(createEntity({ kind: 'character', name: 'Brann Eichwald' }));
  db.setState({ placeId: hohenfurt.id });
  return { db, hohenfurt, grotte, moor, mira, krummzahn, brann };
}

const data = (db: CampaignDb) => db.getSnapshot();
function ok(result: RecordResult) {
  if ('problem' in result) throw new Error(result.problem);
  return result;
}
const status = (db: CampaignDb, id: string) => {
  const entity = data(db).entities[id];
  return entity?.kind === 'person' ? entity.person.status : null;
};

describe('Festhalten: gleiche Weltzeit', () => {
  it('ein jetzt Festgehaltenes ist der jüngste seiner Sorte, auch wenn ein anderer Rechner vorging', async () => {
    const { db, mira } = await setup();
    // Ein Eintrag derselben Minute, auf einem Rechner mit vorgehender Uhr festgehalten.
    db.put(
      'chronicle',
      createChronicleEntry({
        kind: 'attitude',
        at: NOW,
        created: '2999-01-01T00:00:00.000Z',
        attitude: { fromId: mira.id, toId: PARTY_ID, before: null, after: 1 },
      }),
    );
    ok(
      recordEntry(db, {
        kind: 'attitude',
        attitude: { fromId: mira.id, toId: PARTY_ID, value: 3 },
      }),
    );
    expect(findRelation(data(db), mira.id, PARTY_ID)?.attitude).toBe(3);
  });

  it('ein Schicksal derselben Minute überschreibt das vorige', async () => {
    const { db, krummzahn } = await setup();
    ok(recordEntry(db, { kind: 'fate', fate: { entityId: krummzahn.id, status: 'missing' } }));
    ok(recordEntry(db, { kind: 'fate', fate: { entityId: krummzahn.id, status: 'dead' } }));
    expect(status(db, krummzahn.id)).toBe('dead');
  });
});

describe('Festhalten: Session und Ort', () => {
  it('eine Rast gehört zur laufenden Session', async () => {
    const { db } = await setup();
    const session = startSession(db, { title: 'Probe' });
    const { entry } = ok(recordEntry(db, { kind: 'rest', text: '', rest: { long: true } }));
    expect(entry.sessionId).toBe(session.id);
  });

  it('eine frühere Rast gehört zur Session ihrer Weltzeit', async () => {
    const { db } = await setup();
    const past = db.put(
      'sessions',
      createSession({ number: 1, startAt: NOW - 10 * DAY, endAt: NOW - 8 * DAY }),
    );
    const { entry } = ok(
      recordEntry(db, { kind: 'rest', at: NOW - 9 * DAY, rest: { long: false } }),
    );
    expect(entry.sessionId).toBe(past.id);
  });
});

describe('Festhalten: mehrere zusammen', () => {
  it('nimmt eine Rundreise auch in umgekehrter Reihenfolge auf', async () => {
    const { db, hohenfurt, grotte, moor } = await setup();
    ok(recordEntry(db, { kind: 'travel', travel: { toId: grotte.id } }));
    const result = recordEntries(db, [
      { kind: 'travel', at: NOW - DAY, travel: { toId: hohenfurt.id } },
      { kind: 'travel', at: NOW - 2 * DAY, travel: { toId: moor.id } },
    ]);
    if ('problem' in result) throw new Error(result.problem);
    // Die Einträge kommen in der Reihenfolge der Eingabe zurück.
    expect(result.entries.map((e) => e.travel?.toId)).toEqual([hohenfurt.id, moor.id]);
    expect(partyStays(data(db)).map((stay) => stay.placeId)).toEqual([
      moor.id,
      hohenfurt.id,
      grotte.id,
    ]);
    expect(data(db).state.placeId).toBe(grotte.id);
    result.undo();
    expect(partyStays(data(db)).map((stay) => stay.placeId)).toEqual([grotte.id]);
  });
});

describe('Festhalten: Löschen, wenn sich etwas geändert hat', () => {
  it('eine Haltung „unbekannt“ lässt sich löschen, auch wenn die Beziehung fort ist', async () => {
    const { db, mira } = await setup();
    setAttitude(db, mira.id, PARTY_ID, 2);
    setAttitude(db, mira.id, PARTY_ID, null, 'Sie traut uns nicht mehr.');
    const entry = Object.values(data(db).chronicle).find((e) => e.attitude?.after === null)!;
    db.remove('relations', findRelation(data(db), mira.id, PARTY_ID)!.id);
    const undo = removeRecorded(db, entry.id);
    expect(undo).toBeTypeOf('function');
    expect(data(db).chronicle[entry.id]).toBeUndefined();
    expect(findRelation(data(db), mira.id, PARTY_ID)).toBeUndefined();
  });

  it('Rückgängig einer ersten Haltung entfernt die Beziehung, die erst dadurch entstand', async () => {
    const { db, mira } = await setup();
    const result = ok(
      recordEntry(db, {
        kind: 'attitude',
        attitude: { fromId: mira.id, toId: PARTY_ID, value: 2 },
      }),
    );
    expect(findRelation(data(db), mira.id, PARTY_ID)?.attitude).toBe(2);
    result.undo();
    expect(findRelation(data(db), mira.id, PARTY_ID)).toBeUndefined();
  });

  it('eine Beziehung mit eigenem Inhalt bleibt, wenn ihre erste Haltung gelöscht wird', async () => {
    const { db, mira } = await setup();
    const result = ok(
      recordEntry(db, {
        kind: 'attitude',
        attitude: { fromId: mira.id, toId: PARTY_ID, value: 2 },
      }),
    );
    const relation = findRelation(data(db), mira.id, PARTY_ID)!;
    db.patch('relations', relation.id, { note: 'Schuldet uns einen Gefallen.' });
    result.undo();
    expect(findRelation(data(db), mira.id, PARTY_ID)).toMatchObject({
      attitude: null,
      note: 'Schuldet uns einen Gefallen.',
    });
  });
});

describe('Festhalten: Zustände', () => {
  it('ein schon aufgehobener Zustand lässt sich nicht noch einmal aufheben', async () => {
    const { db, mira } = await setup();
    const start = ok(
      recordEntry(db, {
        kind: 'condition',
        text: 'Pfeil im Bein',
        at: NOW - 3 * DAY,
        condition: { entityId: mira.id },
      }),
    );
    ok(
      recordEntry(db, {
        kind: 'condition',
        at: NOW - DAY,
        condition: { entityId: mira.id, ended: true, endsId: start.entry.id },
      }),
    );
    const again = recordEntry(db, {
      kind: 'condition',
      at: NOW - 2 * DAY,
      condition: { entityId: mira.id, ended: true, endsId: start.entry.id },
    });
    expect('problem' in again && again.problem).toMatch(/schon aufgehoben/);
    expect(activeConditions(data(db), mira.id)).toEqual([]);
  });
});

describe('Festhalten: Spielerwunsch als Ziel', () => {
  const goal = (db: CampaignDb, id: string) => {
    const entity = data(db).entities[id];
    return entity?.kind === 'character' ? entity.character.goal : null;
  };

  it('ein nachgetragener älterer Wunsch ersetzt das heutige Ziel nicht', async () => {
    const { db, brann } = await setup();
    const today = ok(
      recordEntry(db, {
        kind: 'wish',
        text: 'Den Turm von Hohenfurt zurückerobern',
        wish: { characterId: brann.id, setGoal: true },
      }),
    );
    const older = ok(
      recordEntry(db, {
        kind: 'wish',
        text: 'Die Krähenbande zerschlagen',
        at: NOW - 5 * DAY,
        wish: { characterId: brann.id, setGoal: true },
      }),
    );
    expect(goal(db, brann.id)).toBe('Den Turm von Hohenfurt zurückerobern');
    expect(data(db).chronicle[today.entry.id]!.wish?.before).toBe('Die Krähenbande zerschlagen');
    // Löschen des älteren lässt das heutige Ziel stehen und gibt dem jüngeren den Stand davor zurück.
    removeRecorded(db, older.entry.id);
    expect(goal(db, brann.id)).toBe('Den Turm von Hohenfurt zurückerobern');
    expect(data(db).chronicle[today.entry.id]!.wish?.before).toBeNull();
    // Löschen des jüngsten stellt das Ziel davor wieder her.
    removeRecorded(db, today.entry.id);
    expect(goal(db, brann.id)).toBe('');
  });
});

describe('Bearbeiten: gleiche Minute', () => {
  it('ändert ein älteres Schicksal derselben Minute, ohne das jüngere zu überstimmen', async () => {
    const { db, krummzahn } = await setup();
    const first = ok(
      recordEntry(db, { kind: 'fate', fate: { entityId: krummzahn.id, status: 'missing' } }),
    );
    ok(recordEntry(db, { kind: 'fate', fate: { entityId: krummzahn.id, status: 'dead' } }));
    expect(
      reviseRecorded(db, first.entry.id, {
        kind: 'fate',
        text: '',
        fate: { entityId: krummzahn.id, status: 'alive' },
      }),
    ).toBe('');
    const fates = Object.values(data(db).chronicle)
      .filter((e) => e.kind === 'fate')
      .sort((a, b) => a.created.localeCompare(b.created));
    // Der Stand von heute folgt dem Eintrag, der zuletzt steht.
    expect(status(db, krummzahn.id)).toBe(fates.at(-1)!.fate!.status);
  });
});
