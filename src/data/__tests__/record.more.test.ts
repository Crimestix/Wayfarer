/**
 * Festhalten, Schritt 1b: Schriftstück, Zwischenzeit, Wandlung, Begleiter, Auftrag, das Schicksal
 * eines Gefährten und ein enthüllter zweiter Name. Erfundene Welt (Hohenfurt, Mira Tannhaus,
 * Brann Eichwald, die Krähe Schwarzfeder …).
 */
import { describe, expect, it } from 'vitest';
import { fateSinceLabel, isJob, recordHeadline } from '../../domain/chronicleKinds';
import { promiseOutcome } from '../../domain/derive';
import { fateSince, partyCompanions, transformationsOf } from '../../domain/history';
import {
  ChronicleEntrySchema,
  EntitySchema,
  PARTY_ID,
  createEntity,
  type Entity,
} from '../../domain/schema';
import { ELARIS_CALENDAR, ELARIS_START } from '../../domain/time/elaris';
import { setPromiseOutcome } from '../actions';
import { CampaignDb } from '../db';
import { effectHolds, recordEntry, removeRecorded, type RecordResult } from '../record';
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
  const mira = add(createEntity({ kind: 'person', name: 'Mira Tannhaus' }));
  const feder = add(
    createEntity({ kind: 'person', name: 'Schwarzfeder', person: { role: 'Begleiter' } }),
  );
  const brann = add(createEntity({ kind: 'character', name: 'Brann Eichwald' }));
  const ilka = add(createEntity({ kind: 'character', name: 'Ilka Sturmfels' }));
  db.setState({ placeId: hohenfurt.id });
  return { db, hohenfurt, mira, feder, brann, ilka };
}

const data = (db: CampaignDb) => db.getSnapshot();
function ok(result: RecordResult) {
  if ('problem' in result) throw new Error(result.problem);
  return result;
}
const problem = (result: RecordResult) => ('problem' in result ? result.problem : '');
const character = (db: CampaignDb, id: string) => {
  const entity = data(db).entities[id];
  if (entity?.kind !== 'character') throw new Error('kein Gefährte');
  return entity.character;
};

describe('Alte Spielstände', () => {
  it('laden Gefährten ohne Schicksal und Abmachungen ohne Sorte', () => {
    const old = EntitySchema.parse({
      id: 'brann',
      created: '',
      updated: '',
      name: 'Brann',
      kind: 'character',
      character: { level: 2 },
    });
    expect(old.kind === 'character' && old.character.status).toBe('alive');
    const promise = ChronicleEntrySchema.parse({
      id: 'p',
      created: '',
      updated: '',
      kind: 'promise',
      at: 0,
      promise: { due: null },
    });
    expect(promise.promise?.sort).toBeUndefined();
    expect(isJob(promise)).toBe(false);
    expect(promise.writing).toBeNull();
    expect(promise.downtime).toBeNull();
    expect(promise.companion).toBeNull();
  });
});

describe('Schicksal eines Gefährten', () => {
  it('setzt den Gefährten auf tot, bleibt in der Gruppe – Rückkehr ist „lebt“', async () => {
    const { db, brann } = await setup();
    const died = ok(
      recordEntry(db, {
        kind: 'fate',
        text: 'Brann fällt am Anleger.',
        at: NOW - 2 * DAY,
        fate: { entityId: brann.id, status: 'dead' },
      }),
    );
    expect(character(db, brann.id).status).toBe('dead');
    expect(character(db, brann.id).active).toBe(true);
    expect(fateSince(data(db), brann.id)?.since).toBe(NOW - 2 * DAY);
    expect(fateSinceLabel(data(db), brann.id)).toMatch(/^Tot seit /);
    const back = ok(
      recordEntry(db, { kind: 'fate', fate: { entityId: brann.id, status: 'alive' } }),
    );
    expect(character(db, brann.id).status).toBe('alive');
    back.undo();
    expect(character(db, brann.id).status).toBe('dead');
    died.undo();
    expect(character(db, brann.id).status).toBe('alive');
  });

  it('ein nachgetragener älterer Tod ändert den heutigen Stand nicht', async () => {
    const { db, brann } = await setup();
    ok(
      recordEntry(db, {
        kind: 'fate',
        at: NOW - DAY,
        fate: { entityId: brann.id, status: 'alive' },
      }),
    );
    ok(
      recordEntry(db, {
        kind: 'fate',
        at: NOW - 5 * DAY,
        fate: { entityId: brann.id, status: 'dead' },
      }),
    );
    expect(character(db, brann.id).status).toBe('alive');
  });

  it('lehnt Fraktionen und Orte ab', async () => {
    const { db, hohenfurt } = await setup();
    expect(
      problem(recordEntry(db, { kind: 'fate', fate: { entityId: hohenfurt.id, status: 'dead' } })),
    ).toMatch(/Personen und Gefährten/);
  });
});

describe('Schriftstück', () => {
  it('hält den Wortlaut fest, mit Titel und Absender', async () => {
    const { db, mira } = await setup();
    const text = 'Kommt allein zur Mühle.\n— M.';
    const { entry } = ok(
      recordEntry(db, {
        kind: 'writing',
        text,
        refs: [mira.id],
        writing: { title: 'Brief an Brann' },
      }),
    );
    expect(entry.text).toBe(text);
    expect(entry.writing).toEqual({ title: 'Brief an Brann', articleId: null });
    expect(recordHeadline(data(db), entry)).toBe('Schriftstück: Brief an Brann');
    expect(problem(recordEntry(db, { kind: 'writing', text: ' ' }))).toMatch(/Schriftstück/);
  });

  it('verlangt einen Titel, wenn es ein Artikel werden soll', async () => {
    const { db } = await setup();
    expect(
      problem(
        recordEntry(db, { kind: 'writing', text: 'Wortlaut', writing: { createArticle: true } }),
      ),
    ).toMatch(/Titel/);
  });
});

describe('Zwischenzeit', () => {
  it('steht am Beginn, stellt die Weltzeit nicht vor und nennt die Tätigkeiten', async () => {
    const { db, brann, ilka } = await setup();
    const { entry } = ok(
      recordEntry(db, {
        kind: 'downtime',
        at: NOW - 42 * DAY,
        downtime: {
          days: 42,
          activities: [
            { characterId: brann.id, text: 'lernt Zwergisch' },
            { characterId: ilka.id, text: '  ' },
          ],
        },
      }),
    );
    expect(data(db).state.now).toBe(NOW);
    expect(entry.downtime).toEqual({
      days: 42,
      activities: [{ characterId: brann.id, text: 'lernt Zwergisch' }],
    });
    expect(entry.refs).toContain(brann.id);
    expect(recordHeadline(data(db), entry)).toBe('Zwischenzeit: 6 Wochen');
    expect(entry.backfilled).toBe(true);
  });

  it('lehnt eine leere Zwischenzeit und Tätigkeiten von Personen ab', async () => {
    const { db, mira } = await setup();
    expect(problem(recordEntry(db, { kind: 'downtime', downtime: { days: 0 } }))).toMatch(
      /Wie lange/,
    );
    expect(
      problem(
        recordEntry(db, {
          kind: 'downtime',
          downtime: { days: 3, activities: [{ characterId: mira.id, text: 'wartet' }] },
        }),
      ),
    ).toMatch(/Gefährten/);
  });
});

describe('Wandlung', () => {
  it('gehört zu einem Gefährten und steht auf seiner Seite', async () => {
    const { db, brann, mira } = await setup();
    const { entry } = ok(
      recordEntry(db, {
        kind: 'transformation',
        text: 'Verliert den linken Arm.',
        transformation: { characterId: brann.id },
      }),
    );
    expect(transformationsOf(data(db), brann.id).map((e) => e.id)).toEqual([entry.id]);
    expect(recordHeadline(data(db), entry)).toBe('Wandlung: Brann Eichwald');
    expect(
      problem(
        recordEntry(db, {
          kind: 'transformation',
          text: 'x',
          transformation: { characterId: mira.id },
        }),
      ),
    ).toMatch(/Gefährten/);
    expect(
      problem(
        recordEntry(db, { kind: 'transformation', transformation: { characterId: brann.id } }),
      ),
    ).toMatch(/Text/);
  });
});

describe('Begleiter', () => {
  it('kommt zur Gruppe, gehört einem Gefährten und geht wieder – Löschen nimmt es zurück', async () => {
    const { db, feder, brann } = await setup();
    const came = ok(
      recordEntry(db, {
        kind: 'companion',
        at: NOW - 3 * DAY,
        companion: { entityId: feder.id, ownerId: brann.id },
      }),
    );
    expect(partyCompanions(data(db))).toMatchObject([{ entityId: feder.id, ownerId: brann.id }]);
    expect(partyCompanions(data(db), brann.id)).toHaveLength(1);
    expect(recordHeadline(data(db), came.entry)).toBe('Schwarzfeder begleitet Brann Eichwald');
    const left = ok(
      recordEntry(db, { kind: 'companion', companion: { entityId: feder.id, joined: false } }),
    );
    expect(left.entry.companion?.ownerId).toBe(brann.id);
    expect(partyCompanions(data(db))).toEqual([]);
    expect(effectHolds(data(db), left.entry)).toBe(true);
    left.undo();
    expect(partyCompanions(data(db))).toHaveLength(1);
    came.undo();
    expect(partyCompanions(data(db))).toEqual([]);
    expect(Object.values(data(db).relations).filter((r) => r.type === 'companion')).toEqual([]);
  });

  it('gehört ohne Gefährten der ganzen Gruppe; nur Personen sind Begleiter', async () => {
    const { db, feder, hohenfurt } = await setup();
    ok(recordEntry(db, { kind: 'companion', companion: { entityId: feder.id } }));
    const [one] = partyCompanions(data(db));
    expect(one?.ownerId).toBeNull();
    expect(data(db).relations[one!.relationId]?.to).toBe(PARTY_ID);
    expect(
      problem(recordEntry(db, { kind: 'companion', companion: { entityId: hohenfurt.id } })),
    ).toMatch(/Tier oder Wesen/);
  });

  it('ein nachgetragenes älteres Kommen ändert nichts, wenn es danach schon ging', async () => {
    const { db, feder } = await setup();
    ok(
      recordEntry(db, {
        kind: 'companion',
        at: NOW - DAY,
        companion: { entityId: feder.id, joined: false },
      }),
    );
    const old = ok(
      recordEntry(db, { kind: 'companion', at: NOW - 9 * DAY, companion: { entityId: feder.id } }),
    );
    expect(old.entry.companion?.before).toBeNull();
    expect(partyCompanions(data(db))).toEqual([]);
  });
});

describe('Auftrag', () => {
  it('ist eine Abmachung der Sorte „Auftrag“ mit Auftraggeber, Frist und Stand', async () => {
    const { db, mira } = await setup();
    const { entry } = ok(
      recordEntry(db, {
        kind: 'promise',
        text: 'Den Wolf im Krähenmoor erlegen.',
        refs: [mira.id],
        promise: { sort: 'job', due: NOW + 3 * DAY },
      }),
    );
    expect(isJob(entry)).toBe(true);
    expect(recordHeadline(data(db), entry)).toBe('Auftrag von Mira Tannhaus');
    setPromiseOutcome(db, entry.id, 'kept');
    const after = data(db).chronicle[entry.id]!;
    expect(promiseOutcome(after.promise)).toBe('kept');
    expect(isJob(after)).toBe(true);
  });
});

describe('Enthüllter Name', () => {
  it('kommt als zweiter Name zum Eintrag – Löschen nimmt ihn wieder weg', async () => {
    const { db, mira } = await setup();
    const result = ok(
      recordEntry(db, {
        kind: 'reveal',
        text: 'Mira heißt in Wahrheit Mirjana.',
        reveal: { prepSecretId: null, alias: { entityId: mira.id, name: ' Mirjana ' } },
      }),
    );
    expect(data(db).entities[mira.id]?.aliases).toEqual(['Mirjana']);
    expect(result.entry.reveal?.alias).toEqual({ entityId: mira.id, name: 'Mirjana', added: true });
    expect(recordHeadline(data(db), result.entry)).toBe('Mira Tannhaus heißt auch „Mirjana“');
    // Schon bekannt: nichts hinzuzufügen, nichts zu entfernen.
    const again = ok(
      recordEntry(db, {
        kind: 'reveal',
        text: 'Noch einmal.',
        reveal: { prepSecretId: null, alias: { entityId: mira.id, name: 'mirjana' } },
      }),
    );
    expect(again.entry.reveal?.alias?.added).toBe(false);
    removeRecorded(db, again.entry.id);
    expect(data(db).entities[mira.id]?.aliases).toEqual(['Mirjana']);
    result.undo();
    expect(data(db).entities[mira.id]?.aliases).toEqual([]);
  });
});
