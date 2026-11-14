/**
 * Die Welt an einem Tag: Der Spielstand wird auf einen früheren Zeitpunkt zurückgerechnet – mit
 * den Wirkungen, die die Chronik gespeichert hat. Erfundene Welt: Die Gruppe kommt nach Hohenfurt
 * und zieht weiter zur Salzgrotte; Mira Tannhaus wird freundlicher; Brann Eichwald stirbt; Odo
 * Tannhaus geht nach Burg Graufels; Lando Furtner steigt auf und bekommt die Salzkrone.
 */
import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { recordEntry, type RecordResult } from '../../data/record';
import { emptyCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { findRelation } from '../derive';
import { lifeFacts } from '../lifespan';
import {
  PARTY_ID,
  createClock,
  createEntity,
  createGuess,
  createLoot,
  createRelation,
  createSession,
  type CampaignData,
  type Entity,
} from '../schema';
import { MINUTES_PER_DAY, fromTime, toTime } from '../time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../time/elaris';
import { worldAt, worldOn } from '../worldAt';

const DAY = MINUTES_PER_DAY;
const cal = ELARIS_CALENDAR;
const NOW = ELARIS_START;
const T1 = NOW - 30 * DAY;
const T2 = NOW - 20 * DAY;
const T3 = NOW - 10 * DAY;
const T4 = NOW - 2 * DAY;
const year = fromTime(cal, NOW).year;
const yearStart = (y: number) => toTime(cal, { year: y, month: 0, day: 1, hour: 0, minute: 0 });

function ok(result: RecordResult) {
  if ('problem' in result) throw new Error(result.problem);
  return result.entry;
}

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), emptyCampaign('Testwelt', cal, NOW));
  const add = <E extends Entity>(entity: E): E => db.put('entities', entity) as E;
  const hohenfurt = add(createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const grotte = add(createEntity({ kind: 'place', name: 'Salzgrotte' }));
  const graufels = add(
    createEntity({
      kind: 'place',
      name: 'Burg Graufels',
      born: { at: yearStart(year - 300), precision: 'year' },
      ended: { at: yearStart(year - 10), precision: 'year' },
    }),
  );
  const mira = add(
    createEntity({
      kind: 'person',
      name: 'Mira Tannhaus',
      born: { at: yearStart(year - 30), precision: 'year' },
    }),
  );
  const odo = add(
    createEntity({ kind: 'person', name: 'Odo Tannhaus', person: { placeId: hohenfurt.id } }),
  );
  const brann = add(createEntity({ kind: 'person', name: 'Brann Eichwald' }));
  const ilka = add(
    createEntity({
      kind: 'person',
      name: 'Ilka Sturmfels',
      born: { at: NOW - 15 * DAY, precision: 'day' },
    }),
  );
  const lando = add(createEntity({ kind: 'character', name: 'Lando Furtner' }));
  const crown = add(
    createEntity({ kind: 'item', name: 'Salzkrone', item: { history: true, holderId: mira.id } }),
  );
  const s1 = db.put('sessions', createSession({ number: 1, startAt: T1 - 60, endAt: T1 + DAY }));
  const s2 = db.put('sessions', createSession({ number: 2, startAt: T3 - 60, endAt: T3 + DAY }));

  // In der Reihenfolge der Weltzeit festgehalten – wie am Tisch.
  ok(recordEntry(db, { kind: 'travel', at: T1, travel: { toId: hohenfurt.id } }));
  ok(
    recordEntry(db, {
      kind: 'meeting',
      at: T1 + 30,
      text: 'Mira an der Furt',
      refs: [mira.id],
    }),
  );
  ok(
    recordEntry(db, {
      kind: 'attitude',
      at: T1 + 60,
      attitude: { fromId: mira.id, toId: PARTY_ID, value: 1 },
    }),
  );
  ok(
    recordEntry(db, {
      kind: 'whereabouts',
      at: T2,
      whereabouts: { entityId: odo.id, placeId: graufels.id },
    }),
  );
  ok(
    recordEntry(db, {
      kind: 'milestone',
      at: T2 + 10,
      text: 'Stufe 2',
      milestone: { characterId: lando.id, level: 2 },
    }),
  );
  const arrow = ok(
    recordEntry(db, {
      kind: 'condition',
      at: T2 + 20,
      text: 'Pfeil im Bein',
      condition: { entityId: lando.id },
    }),
  );
  ok(
    recordEntry(db, {
      kind: 'change',
      at: T2 + 30,
      text: 'Mira gibt Lando die Krone.',
      holder: { itemId: crown.id, holderId: lando.id },
    }),
  );
  db.put('entities', { ...crown, item: { ...crown.item, holderId: lando.id } });
  ok(recordEntry(db, { kind: 'travel', at: T3, travel: { toId: grotte.id } }));
  ok(
    recordEntry(db, {
      kind: 'meeting',
      at: T3 + 10,
      text: 'Ilka in der Grotte',
      refs: [ilka.id],
    }),
  );
  ok(
    recordEntry(db, {
      kind: 'fate',
      at: T3 + 20,
      fate: { entityId: brann.id, status: 'dead' },
    }),
  );
  ok(
    recordEntry(db, {
      kind: 'attitude',
      at: T3 + 30,
      attitude: { fromId: mira.id, toId: PARTY_ID, value: 3 },
    }),
  );
  ok(
    recordEntry(db, {
      kind: 'condition',
      at: T3 + 40,
      text: 'Pfeil im Bein',
      condition: { entityId: lando.id, ended: true, endsId: arrow.id },
    }),
  );
  ok(
    recordEntry(db, {
      kind: 'milestone',
      at: T4,
      text: 'Stufe 3',
      milestone: { characterId: lando.id, level: 3 },
    }),
  );
  db.put(
    'clocks',
    createClock({
      title: 'Die Salzsieder rücken vor',
      start: T1 - 5 * DAY,
      steps: [
        {
          id: 'a',
          text: 'Sie besetzen den Steg',
          days: 3,
          delay: 0,
          at: T1 - 2 * DAY,
          skipped: false,
          needs: '',
          runId: null,
        },
        {
          id: 'b',
          text: 'Sie sperren die Grotte',
          days: 5,
          delay: 0,
          at: T3 + 50,
          skipped: false,
          needs: '',
          runId: null,
        },
        {
          id: 'c',
          text: 'Sie verkaufen das Salz',
          days: 30,
          delay: 0,
          at: null,
          skipped: false,
          needs: '',
          runId: null,
        },
      ],
    }),
  );
  db.put('guesses', createGuess({ text: 'Odo lügt', at: T3 + 60, refs: [odo.id] }));
  db.put('loot', createLoot({ text: '20 Goldmünzen', given: true, at: T3 + 70, toId: lando.id }));
  return { db, hohenfurt, grotte, graufels, mira, odo, brann, ilka, lando, crown, s1, s2 };
}

const person = (data: CampaignData, id: string) => {
  const e = data.entities[id];
  if (e?.kind !== 'person') throw new Error('keine Person');
  return e.person;
};
const character = (data: CampaignData, id: string) => {
  const e = data.entities[id];
  if (e?.kind !== 'character') throw new Error('kein Gefährte');
  return e.character;
};

describe('worldAt: der Spielstand zu einem früheren Zeitpunkt', () => {
  it('heute (und später) ist der heutige Stand', async () => {
    const { db } = await setup();
    const data = db.getSnapshot();
    expect(worldAt(data, NOW)).toBe(data);
    expect(worldAt(data, NOW + DAY)).toBe(data);
  });

  it('Chronik bis dahin, Weltzeit, Ort der Gruppe, laufende Session', async () => {
    const { db, hohenfurt, grotte, s1, s2 } = await setup();
    const data = db.getSnapshot();
    const then = worldAt(data, T2);
    expect(then.state.now).toBe(T2);
    expect(Object.values(then.chronicle).every((e) => e.at <= T2)).toBe(true);
    expect(Object.values(then.chronicle).some((e) => e.at === T2)).toBe(true);
    expect(then.state.placeId).toBe(hohenfurt.id);
    expect(worldAt(data, T3 + 5).state.placeId).toBe(grotte.id);
    // Zwischen den Abenden lief keiner; an einem Abend der damalige – spätere gab es noch nicht.
    expect(then.state.sessionId).toBeNull();
    expect(Object.keys(then.sessions)).toEqual([s1.id]);
    expect(worldAt(data, T1 + 120).state.sessionId).toBe(s1.id);
    expect(worldAt(data, T3 + 120).state.sessionId).toBe(s2.id);
    // Der heutige Stand bleibt unberührt.
    expect(data.state.now).toBe(NOW);
    expect(data.state.placeId).toBe(grotte.id);
  });

  it('Schicksal, Aufenthalt, Haltung nach dem jüngsten Eintrag davor – sonst wie vorgefunden', async () => {
    const { db, mira, odo, brann, hohenfurt, graufels } = await setup();
    const data = db.getSnapshot();
    expect(person(data, brann.id).status).toBe('dead');
    expect(person(worldAt(data, T2), brann.id).status).toBe('alive');
    expect(person(worldAt(data, T3 + 20), brann.id).status).toBe('dead');

    expect(person(data, odo.id).placeId).toBe(graufels.id);
    expect(person(worldAt(data, T1), odo.id).placeId).toBe(hohenfurt.id);
    expect(person(worldAt(data, T2), odo.id).placeId).toBe(graufels.id);

    const attitude = (d: CampaignData) => findRelation(d, mira.id, PARTY_ID)?.attitude ?? null;
    expect(attitude(data)).toBe(3);
    expect(attitude(worldAt(data, T2))).toBe(1);
    // Vor der ersten Haltung war sie unbekannt.
    expect(attitude(worldAt(data, T1))).toBeNull();
  });

  it('Stufe, Zustände, Begegnungen, Besitzer, Beute, Vermutungen', async () => {
    const { db, lando, ilka, mira, crown } = await setup();
    const data = db.getSnapshot();
    expect(character(worldAt(data, T1), lando.id).level).toBe(1);
    expect(character(worldAt(data, T3), lando.id).level).toBe(2);
    expect(character(data, lando.id).level).toBe(3);

    expect(person(worldAt(data, T2), ilka.id).met).toBe(false);
    expect(person(worldAt(data, T4), ilka.id).met).toBe(true);
    expect(person(worldAt(data, T1 + 40), mira.id).met).toBe(true);

    const holder = (d: CampaignData) => {
      const e = d.entities[crown.id];
      return e?.kind === 'item' ? e.item.holderId : undefined;
    };
    expect(holder(worldAt(data, T1))).toBe(mira.id);
    expect(holder(worldAt(data, T3))).toBe(lando.id);

    const loot = (d: CampaignData) => Object.values(d.loot)[0]!.given;
    expect(loot(worldAt(data, T2))).toBe(false);
    expect(loot(worldAt(data, T4))).toBe(true);
    expect(Object.keys(worldAt(data, T2).guesses)).toHaveLength(0);
    expect(Object.keys(worldAt(data, T4).guesses)).toHaveLength(1);
  });

  it('Uhren: Was später eintrat, stand noch aus', async () => {
    const { db } = await setup();
    const data = db.getSnapshot();
    const clock = Object.values(worldAt(data, T2).clocks)[0]!;
    expect(clock.steps.map((s) => s.at !== null)).toEqual([true, false, false]);
    const today = Object.values(data.clocks)[0]!;
    expect(today.steps.map((s) => s.at !== null)).toEqual([true, true, false]);
  });
});

describe('worldOn: was „Welt an einem Tag“ zeigt', () => {
  it('Gruppe, Abend, Gefährten mit Stufe und Zuständen damals', async () => {
    const { db, hohenfurt, lando } = await setup();
    const data = db.getSnapshot();
    const on = worldOn(data, T2 + 25);
    expect(on.at).toBe(T2 + 25);
    expect(on.future).toBe(false);
    expect(on.placeId).toBe(hohenfurt.id);
    expect(on.session).toBeNull();
    const member = on.party.find((m) => m.entity.id === lando.id)!;
    expect(member.level).toEqual({ then: 2, today: 3, changed: true });
    expect(member.conditions).toEqual(['Pfeil im Bein']);
    expect(worldOn(data, T4).party[0]!.conditions).toEqual([]);
  });

  it('wer lebte und wie alt – nie genauer als bekannt; Vergangenes und Späteres nur gezählt', async () => {
    const { db, mira, graufels, ilka, brann } = await setup();
    const data = db.getSnapshot();
    const on = worldOn(data, yearStart(year - 20) + 100 * DAY);
    const miraThen = on.lives.find((l) => l.entity.id === mira.id)!;
    expect(miraThen.facts[0]!.text).toBe('etwa 10 Jahre');
    const burg = on.lives.find((l) => l.entity.id === graufels.id)!;
    expect(burg.facts[0]!.text).toMatch(/^etwa 280 Jahre/);
    // Ilka war noch nicht geboren.
    expect(on.lives.some((l) => l.entity.id === ilka.id)).toBe(false);
    expect(on.notYet).toBe(1);
    expect(on.past).toBe(0);
    // Heute ist die Burg gefallen – sie steht nicht mehr unter denen, die bestehen.
    const today = worldOn(data, NOW);
    expect(today.lives.some((l) => l.entity.id === graufels.id)).toBe(false);
    expect(today.past).toBe(1);
    expect(lifeFacts(data, graufels).some((f) => f.label === 'Untergegangen')).toBe(true);
    // Brann hat keine Lebensdaten – er steht unter den Schicksalen, nicht hier.
    expect(today.lives.some((l) => l.entity.id === brann.id)).toBe(false);
  });

  it('vor dem ersten Abend zog die Gruppe noch nicht gemeinsam', async () => {
    const { db } = await setup();
    const data = db.getSnapshot();
    const early = worldOn(data, T1 - 2 * DAY);
    expect(early.beforeCampaign).toBe(true);
    expect(early.party).toEqual([]);
    expect(early.knew).toEqual([]);
  });

  it('von Hand Gesetztes ohne Eintrag gilt erst ab dem ersten Abend', async () => {
    const { db, odo, ilka } = await setup();
    const o = db.getSnapshot().entities[odo.id]!;
    if (o.kind === 'person')
      db.put('entities', { ...o, person: { ...o.person, status: 'missing' } });
    db.put('relations', createRelation({ from: ilka.id, to: PARTY_ID, attitude: 2 }));
    const data = db.getSnapshot();
    const early = worldOn(data, T1 - 2 * DAY);
    expect(early.fates.some((f) => f.entity.id === odo.id)).toBe(false);
    expect(early.attitudes.some((a) => a.entity.id === ilka.id)).toBe(false);
    // Mira hat Einträge: Vor dem ersten war ihre Haltung unbekannt.
    expect(early.attitudes.map((a) => a.value.then)).toEqual([null]);
    const later = worldOn(data, T2);
    expect(later.fates.some((f) => f.entity.id === odo.id)).toBe(true);
    expect(later.attitudes.find((a) => a.entity.id === ilka.id)?.value.then).toBe(2);
    expect(worldOn(data, T2).beforeCampaign).toBe(false);
  });

  it('Schicksale, Haltungen, Besitzer: damals neben heute', async () => {
    const { db, brann, mira, crown, lando } = await setup();
    const data = db.getSnapshot();
    const on = worldOn(data, T2);
    expect(on.fates.find((f) => f.entity.id === brann.id)?.status).toEqual({
      then: 'alive',
      today: 'dead',
      changed: true,
    });
    expect(on.attitudes.find((a) => a.entity.id === mira.id)?.value).toEqual({
      then: 1,
      today: 3,
      changed: true,
    });
    // Die Krone wechselte erst eine halbe Stunde später.
    expect(on.holders.find((h) => h.entity.id === crown.id)?.holderId.then).toBe(mira.id);
    expect(worldOn(data, T3).holders[0]!.holderId.then).toBe(lando.id);
    expect(worldOn(data, T1).holders[0]!.holderId).toEqual({
      then: mira.id,
      today: lando.id,
      changed: true,
    });
    expect(on.whereabouts).toHaveLength(1);
  });

  it('Uhren und was die Gruppe wusste', async () => {
    const { db } = await setup();
    const data = db.getSnapshot();
    const on = worldOn(data, T2);
    expect(on.clocks).toHaveLength(1);
    expect(on.clocks[0]!.behind.map((s) => s.step.text)).toEqual(['Sie besetzen den Steg']);
    expect(on.clocks[0]!.next?.step.text).toBe('Sie sperren die Grotte');
    const people = (o: ReturnType<typeof worldOn>) =>
      o.knew.find((k) => k.label === 'Personen')?.names ?? [];
    expect(people(on)).toEqual(['Mira Tannhaus']);
    expect(people(worldOn(data, T4))).toEqual(['Ilka Sturmfels', 'Mira Tannhaus']);
    expect(on.recent[0]!.at).toBeLessThanOrEqual(T2);
  });

  it('ein Tag nach heute zeigt heute', async () => {
    const { db } = await setup();
    const on = worldOn(db.getSnapshot(), NOW + 5 * DAY);
    expect(on.future).toBe(true);
    expect(on.at).toBe(NOW);
  });
});
