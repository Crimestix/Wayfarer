import { describe, expect, it } from 'vitest';
import { recordEntry, type RecordResult } from '../../data/record';
import { CampaignDb } from '../../data/db';
import { emptyCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { KIND_ORDER, RECORD_GROUPS, kindOfChoice } from '../../domain/chronicleKinds';
import { placeStatus } from '../../domain/derive';
import { CHRONICLE_KINDS, createEntity } from '../../domain/schema';
import { ELARIS_CALENDAR, ELARIS_START } from '../../domain/time/elaris';
import { worldTurn } from '../../domain/worldTurn';
import {
  entryHeadline,
  entryPlainText,
  filterEntries,
  isForPlayers,
  keepsOrder,
  lockedRefs,
  EMPTY_FILTER,
} from './model';

const DAY = 24 * 60;

async function setup() {
  const db = await CampaignDb.create(
    new MemoryStore(),
    emptyCampaign('Testwelt', ELARIS_CALENDAR, ELARIS_START),
  );
  const hohenfurt = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const mira = db.put('entities', createEntity({ kind: 'person', name: 'Mira Tannhaus' }));
  const krummzahn = db.put('entities', createEntity({ kind: 'person', name: 'Krummzahn' }));
  const brann = db.put('entities', createEntity({ kind: 'character', name: 'Brann Eichwald' }));
  db.setState({ placeId: hohenfurt.id });
  return { db, hohenfurt, mira, krummzahn, brann };
}
function ok(result: RecordResult) {
  if ('problem' in result) throw new Error(result.problem);
  return result.entry;
}

describe('Arten der Chronik', () => {
  it('jede Art steht genau einmal in den Filtern; jede festhaltbare in einer Gruppe', () => {
    expect([...KIND_ORDER].sort()).toEqual([...CHRONICLE_KINDS].sort());
    const grouped = RECORD_GROUPS.flatMap((g) => g.choices.map((c) => kindOfChoice(c.choice)));
    for (const kind of CHRONICLE_KINDS.filter((k) => k !== 'event'))
      expect(grouped).toContain(kind);
    expect(RECORD_GROUPS.map((g) => g.label)).toEqual([
      'Am Tisch',
      'Die Welt',
      'Zwischen Leuten',
      'Die Gruppe',
      'Geheimnisse',
    ]);
  });

  it('Kopfzeile, Text für die Zusammenfassung und „ungefähr“', async () => {
    const { db, mira, krummzahn } = await setup();
    const quote = ok(recordEntry(db, { kind: 'quote', text: 'Nie wieder', refs: [mira.id] }));
    const fate = ok(
      recordEntry(db, {
        kind: 'fate',
        at: ELARIS_START - DAY,
        precision: 'approx',
        fate: { entityId: krummzahn.id, status: 'dead' },
      }),
    );
    const rumor = ok(recordEntry(db, { kind: 'rumor', text: 'Gold in der Grotte' }));
    const data = db.getSnapshot();
    expect(entryHeadline(data, fate)).toBe('Krummzahn: tot');
    expect(entryPlainText(data, quote)).toBe('„Nie wieder“ – Mira Tannhaus [Hohenfurt]');
    expect(entryPlainText(data, fate)).toBe('(ungefähr) Krummzahn: tot [Hohenfurt]');
    expect(entryPlainText(data, rumor)).toBe('Gerücht · ungeprüft: Gold in der Grotte [Hohenfurt]');
    expect(lockedRefs(fate)).toEqual([krummzahn.id]);
    expect(
      filterEntries(data, Object.values(data.chronicle), { ...EMPTY_FILTER, query: 'ungefähr' }),
    ).toEqual([fate]);
  });

  it('Wissen anderer bleibt bei der Spielleitung', async () => {
    const { db, mira, brann } = await setup();
    const npc = ok(recordEntry(db, { kind: 'knowledge', text: 'Das Siegel', refs: [mira.id] }));
    const own = ok(recordEntry(db, { kind: 'knowledge', text: 'Das Siegel', refs: [brann.id] }));
    const data = db.getSnapshot();
    expect(isForPlayers(data, npc)).toBe(false);
    expect(isForPlayers(data, own)).toBe(true);
  });

  it('die Reihenfolge der Schicksale einer Person bleibt beim Verschieben', async () => {
    const { db, krummzahn } = await setup();
    const a = ok(
      recordEntry(db, {
        kind: 'fate',
        at: ELARIS_START - 2 * DAY,
        fate: { entityId: krummzahn.id, status: 'missing' },
      }),
    );
    ok(
      recordEntry(db, {
        kind: 'fate',
        at: ELARIS_START - DAY,
        fate: { entityId: krummzahn.id, status: 'dead' },
      }),
    );
    expect(keepsOrder(db.getSnapshot(), a, ELARIS_START - 3 * DAY)).toBe(true);
    expect(keepsOrder(db.getSnapshot(), a, ELARIS_START)).toBe(false);
  });

  it('ein Schicksal zählt zum Weltgeschehen und zu dem, was sich an einem Ort verändert hat', async () => {
    const { db, hohenfurt, krummzahn } = await setup();
    const elsewhere = db.put('entities', createEntity({ kind: 'place', name: 'Salzgrotte' }));
    if (krummzahn.kind === 'person')
      db.put('entities', { ...krummzahn, person: { ...krummzahn.person, placeId: hohenfurt.id } });
    db.setState({ placeId: null });
    ok(
      recordEntry(db, {
        kind: 'travel',
        at: ELARIS_START - 5 * DAY,
        travel: { toId: hohenfurt.id },
      }),
    );
    ok(
      recordEntry(db, {
        kind: 'travel',
        at: ELARIS_START - 3 * DAY,
        travel: { toId: elsewhere.id },
      }),
    );
    const fate = ok(
      recordEntry(db, {
        kind: 'fate',
        at: ELARIS_START - DAY,
        placeId: hohenfurt.id,
        fate: { entityId: krummzahn.id, status: 'dead' },
      }),
    );
    ok(recordEntry(db, { kind: 'rest', at: ELARIS_START - DAY, placeId: hohenfurt.id }));
    const data = db.getSnapshot();
    expect(placeStatus(data, hohenfurt.id).changesSince.map((e) => e.id)).toEqual([fate.id]);
    const turn = worldTurn(data);
    expect(
      [...turn.watched, ...turn.weighty, ...turn.rest].find(
        (item) => item.key === `chronicle:${fate.id}`,
      ),
    ).toMatchObject({
      kind: 'change',
      title: 'Krummzahn: tot',
    });
  });
});
