import { describe, expect, it } from 'vitest';
import {
  advanceTime,
  endSession,
  logEntry,
  moveParty,
  setAttitude,
  startSession,
} from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { agoText, memoryOf, nameMemory, namesInText } from '../memory';
import {
  PARTY_ID,
  createChronicleEntry,
  createEntity,
  type Character,
  type Person,
} from '../schema';
import { MINUTES_PER_DAY } from '../time/calendar';

/** Erfunden: Hohenfurt mit der Mühle, die Salzgrotte, Mira Tannhaus, Lando Furtner, Krummzahn … */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const town = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const mill = db.put(
    'entities',
    createEntity({ kind: 'place', name: 'Alte Mühle', place: { parentId: town.id } } as never),
  );
  const grotto = db.put('entities', createEntity({ kind: 'place', name: 'Salzgrotte' }));
  const mira = db.put(
    'entities',
    createEntity({
      kind: 'person',
      name: 'Mira Tannhaus',
      tagline: 'Fährfrau, die mehr weiß, als sie sagt',
    }),
  );
  const lando = db.put('entities', createEntity({ kind: 'person', name: 'Lando Furtner' }));
  const krummzahn = db.put('entities', createEntity({ kind: 'person', name: 'Krummzahn' }));
  const brann = db.put('entities', createEntity({ kind: 'character', name: 'Brann Eichwald' }));
  const band = db.put('entities', createEntity({ kind: 'faction', name: 'Die Krähenbande' }));
  const wolf = db.put('entities', createEntity({ kind: 'species', name: 'Grubenschleicher' }));
  moveParty(db, town.id);
  const later = (days: number) =>
    advanceTime(db, db.getSnapshot().state.now + days * MINUTES_PER_DAY);
  return {
    db,
    town,
    mill,
    grotto,
    mira,
    lando,
    krummzahn,
    brann,
    band,
    wolf,
    later,
    data: () => db.getSnapshot(),
  };
}

const texts = (facts: { text: string }[]) => facts.map((fact) => fact.text);

describe('Gedächtnis: Namen im Text', () => {
  it('findet Namen als ganze Wörter, zuletzt genannte zuerst, jeden einmal', async () => {
    const w = await setup();
    const ids = namesInText(
      w.data(),
      'Mira Tannhaus trifft Lando Furtner in Hohenfurt. Danach wieder Mira.',
    );
    expect(ids).toEqual([w.mira.id, w.town.id, w.lando.id]);
  });

  it('nimmt nur Personen, Gefährten, Orte, Fraktionen und Gegenstände', async () => {
    const w = await setup();
    expect(
      namesInText(w.data(), 'Brann kämpft mit der Krähenbande gegen einen Grubenschleicher.'),
    ).toEqual([w.band.id, w.brann.id]);
  });

  it('erkennt keine Wortteile und nichts in leerem Text', async () => {
    const w = await setup();
    expect(namesInText(w.data(), 'Hohenfurter Bier und Krummzahnig')).toEqual([]);
    expect(namesInText(w.data(), '   ')).toEqual([]);
  });

  it('mehrdeutige Vornamen zählen nur, wenn ein Verweis sie eindeutig macht', async () => {
    const w = await setup();
    const other = w.db.put('entities', createEntity({ kind: 'person', name: 'Mira Kessel' }));
    expect(namesInText(w.data(), 'Mira lacht.')).toEqual([]);
    expect(namesInText(w.data(), 'Mira lacht.', [other.id])).toEqual([other.id]);
  });
});

describe('Gedächtnis: was zu einem Namen gehört', () => {
  it('Schicksal zuerst, dann Haltung; Tote sind nirgends', async () => {
    const w = await setup();
    w.db.patch('entities', w.krummzahn.id, {
      person: { ...(w.krummzahn as Person).person, status: 'dead', placeId: w.grotto.id },
    } as never);
    setAttitude(w.db, w.krummzahn.id, PARTY_ID, -4);
    const facts = memoryOf(w.data(), w.krummzahn.id);
    expect(facts[0]).toEqual({ kind: 'fate', text: 'tot' });
    expect(facts[1]).toEqual({ kind: 'attitude', text: 'hasserfüllt' });
    expect(facts.some((fact) => fact.kind === 'where')).toBe(false);
  });

  it('sagt, wo eine Person jetzt ist – oder dass sie hier ist', async () => {
    const w = await setup();
    w.db.patch('entities', w.lando.id, {
      person: { ...(w.lando as Person).person, placeId: w.grotto.id },
    } as never);
    expect(memoryOf(w.data(), w.lando.id)).toContainEqual({
      kind: 'where',
      text: 'jetzt in Salzgrotte',
    });
    w.db.patch('entities', w.lando.id, {
      person: { ...(w.lando as Person).person, placeId: w.mill.id },
    } as never);
    expect(memoryOf(w.data(), w.lando.id)).toContainEqual({ kind: 'where', text: 'hier am Ort' });
  });

  it('zuletzt gesehen: nach Abenden, mit dem Ort des Eintrags', async () => {
    const w = await setup();
    startSession(w.db);
    logEntry(w.db, { text: 'Mira Tannhaus setzt uns über.', refs: [w.mira.id] });
    endSession(w.db);
    w.later(1);
    startSession(w.db);
    endSession(w.db);
    w.later(1);
    const seen = memoryOf(w.data(), w.mira.id).find((fact) => fact.kind === 'seen');
    expect(seen?.text).toBe('zuletzt vor 2 Abenden in Hohenfurt');
    startSession(w.db);
    logEntry(w.db, { text: 'Wieder bei Mira.', refs: [w.mira.id] });
    expect(memoryOf(w.data(), w.mira.id).find((fact) => fact.kind === 'seen')?.text).toBe(
      'zuletzt an diesem Abend in Hohenfurt',
    );
  });

  it('Veränderungen und eingetretene Termine zählen nicht als Begegnung', async () => {
    const w = await setup();
    w.db.put(
      'chronicle',
      createChronicleEntry({
        kind: 'change',
        at: w.data().state.now,
        text: 'Lando zieht weg.',
        refs: [w.lando.id],
      }),
    );
    expect(memoryOf(w.data(), w.lando.id)).toEqual([]);
  });

  it('ohne Session: in Tagen der Welt', async () => {
    const w = await setup();
    const at = w.data().state.now;
    expect(agoText(w.data(), at, null)).toBe('heute');
    w.later(1);
    expect(agoText(w.data(), at, null)).toBe('gestern');
    w.later(3);
    expect(agoText(w.data(), at, null)).toBe('vor 4 Tagen');
  });

  it('nennt offene Abmachungen und füllt mit dem Satz für den Tisch auf – höchstens drei', async () => {
    const w = await setup();
    setAttitude(w.db, w.mira.id, PARTY_ID, 2);
    logEntry(w.db, { kind: 'promise', text: 'Mira bringt uns zur Grotte.', refs: [w.mira.id] });
    const facts = memoryOf(w.data(), w.mira.id);
    expect(facts.map((fact) => fact.kind)).toEqual(['attitude', 'seen', 'promises']);
    expect(texts(facts)).toEqual([
      'wohlgesonnen',
      'zuletzt an diesem Abend in Hohenfurt',
      'eine offene Abmachung',
    ]);

    const fresh = await setup();
    expect(memoryOf(fresh.data(), fresh.mira.id)).toEqual([
      { kind: 'tagline', text: 'Fährfrau, die mehr weiß, als sie sagt' },
    ]);
  });

  it('Orte: wo sie liegen und ob die Gruppe hier ist oder wann sie zuletzt dort war', async () => {
    const w = await setup();
    expect(texts(memoryOf(w.data(), w.mill.id))).toEqual(['in Hohenfurt']);
    expect(texts(memoryOf(w.data(), w.town.id))).toEqual(['die Gruppe ist hier']);
    startSession(w.db);
    moveParty(w.db, w.grotto.id);
    endSession(w.db);
    w.later(1);
    expect(texts(memoryOf(w.data(), w.town.id))).toEqual(['zuletzt besucht am vorigen Abend']);
  });

  it('Gefährten: nur, wenn sie abseits der Gruppe sind', async () => {
    const w = await setup();
    expect(memoryOf(w.data(), w.brann.id)).toEqual([]);
    w.db.patch('entities', w.brann.id, {
      character: { ...(w.brann as Character).character, placeId: w.grotto.id },
    } as never);
    expect(texts(memoryOf(w.data(), w.brann.id))).toEqual(['abseits der Gruppe in Salzgrotte']);
  });

  it('Zeilen: höchstens zwei Namen, ohne Namen, zu denen nichts eingetragen ist', async () => {
    const w = await setup();
    setAttitude(w.db, w.lando.id, PARTY_ID, -1);
    setAttitude(w.db, w.krummzahn.id, PARTY_ID, -5);
    const lines = nameMemory(w.data(), 'Krummzahn, Lando Furtner, Mira Tannhaus und Brann');
    expect(lines.map((line) => line.name)).toEqual(['Mira Tannhaus', 'Lando Furtner']);
  });
});
