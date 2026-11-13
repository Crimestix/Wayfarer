import { describe, expect, it } from 'vitest';
import { startSession } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { recordEntry, type RecordResult } from '../../data/record';
import { emptyCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { conditionEnding } from '../../domain/history';
import { PARTY_ID, createEntity, type Entity } from '../../domain/schema';
import { ELARIS_CALENDAR, ELARIS_START } from '../../domain/time/elaris';
import {
  deleteRecorded,
  isFixedKind,
  reviseRecorded,
  revisionNeedsEffect,
  revisionPatch,
  withoutEntry,
} from './actions';
import {
  TEXT_KINDS,
  deleteConsequence,
  entryPlainText,
  freeRefsOf,
  meaningRefsOf,
  milestoneLine,
  milestonesOf,
  sessionSummaryText,
} from './model';
import { draftOfEntry, recordInputOf, type RecordCommon } from './recordDraft';
import { recordProblem } from '../../data/record';

const DAY = 24 * 60;

async function setup() {
  const db = await CampaignDb.create(
    new MemoryStore(),
    emptyCampaign('Testwelt', ELARIS_CALENDAR, ELARIS_START),
  );
  const hohenfurt = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const mira = db.put('entities', createEntity({ kind: 'person', name: 'Mira Tannhaus' }));
  const krummzahn = db.put('entities', createEntity({ kind: 'person', name: 'Krummzahn' }));
  const lando = db.put('entities', createEntity({ kind: 'character', name: 'Lando Furtner' }));
  db.setState({ placeId: hohenfurt.id });
  return { db, hohenfurt, mira, krummzahn, lando };
}

function ok(result: RecordResult) {
  if ('problem' in result) throw new Error(result.problem);
  return result.entry;
}

const statusOf = (db: CampaignDb, person: Entity) => {
  const entity = db.getSnapshot().entities[person.id];
  return entity?.kind === 'person' ? entity.person.status : null;
};

const commonOf = (text: string): RecordCommon => ({ text, refs: [], secret: false });

describe('Einträge löschen und ändern', () => {
  it('löscht samt Wirkung und holt beides zurück', async () => {
    const { db, krummzahn } = await setup();
    const fate = ok(
      recordEntry(db, { kind: 'fate', fate: { entityId: krummzahn.id, status: 'dead' } }),
    );
    expect(statusOf(db, krummzahn)).toBe('dead');
    expect(deleteConsequence(db.getSnapshot(), fate)).toContain('wieder als „lebt“');
    const undo = deleteRecorded(db, fate.id);
    expect(undo).not.toBeNull();
    expect(db.getSnapshot().chronicle[fate.id]).toBeUndefined();
    expect(statusOf(db, krummzahn)).toBe('alive');
    undo!();
    expect(db.getSnapshot().chronicle[fate.id]).toBeDefined();
    expect(statusOf(db, krummzahn)).toBe('dead');
    expect(deleteRecorded(db, 'gibt-es-nicht')).toBeNull();
  });

  it('sagt beim Löschen, wenn der heutige Stand bleibt', async () => {
    const { db, krummzahn } = await setup();
    const older = ok(
      recordEntry(db, {
        kind: 'fate',
        at: ELARIS_START - 2 * DAY,
        fate: { entityId: krummzahn.id, status: 'missing' },
      }),
    );
    ok(recordEntry(db, { kind: 'fate', fate: { entityId: krummzahn.id, status: 'dead' } }));
    expect(deleteConsequence(db.getSnapshot(), older)).toContain('bleibt, wie er ist');
  });

  it('ändert die Angaben eines Schicksals mit Wirkung und behält die Kennung', async () => {
    const { db, krummzahn } = await setup();
    const fate = ok(
      recordEntry(db, { kind: 'fate', fate: { entityId: krummzahn.id, status: 'dead' } }),
    );
    const draft = { ...draftOfEntry(fate), status: 'missing' as const };
    expect(revisionNeedsEffect(fate, 'fate', draft, fate.text)).toBe(true);
    expect(revisionNeedsEffect(fate, 'fate', draftOfEntry(fate), 'Nur ein Wort')).toBe(false);
    const input = recordInputOf('fate', draft, { ...commonOf(''), at: fate.at }, ELARIS_START);
    expect(reviseRecorded(db, fate.id, input)).toBe('');
    const after = db.getSnapshot().chronicle[fate.id]!;
    expect(after.fate?.status).toBe('missing');
    expect(after.created).toBe(fate.created);
    expect(Object.keys(db.getSnapshot().chronicle)).toEqual([fate.id]);
    expect(statusOf(db, krummzahn)).toBe('missing');
  });

  it('macht aus einer Notiz ein Gerücht', async () => {
    const { db, mira } = await setup();
    const note = ok(recordEntry(db, { kind: 'note', text: 'Gold in der Salzgrotte' }));
    const draft = { ...draftOfEntry(note), whoId: mira.id };
    expect(revisionNeedsEffect(note, 'rumor', draft, note.text)).toBe(true);
    const input = recordInputOf(
      'rumor',
      draft,
      { ...commonOf(note.text), at: note.at },
      ELARIS_START,
    );
    expect(reviseRecorded(db, note.id, input)).toBe('');
    const rumor = db.getSnapshot().chronicle[note.id]!;
    expect(rumor.kind).toBe('rumor');
    expect(rumor.rumor).toEqual({ sourceId: mira.id, truth: 'unchecked' });
  });

  it('lässt bei einem Widerspruch alles, wie es war', async () => {
    const { db, krummzahn } = await setup();
    const fate = ok(
      recordEntry(db, { kind: 'fate', fate: { entityId: krummzahn.id, status: 'dead' } }),
    );
    // Ohne Text gibt es kein Weltwissen.
    const input = recordInputOf('lore', draftOfEntry(fate), commonOf(''), ELARIS_START);
    expect(reviseRecorded(db, fate.id, input)).toContain('fehlt der Text');
    expect(db.getSnapshot().chronicle[fate.id]?.kind).toBe('fate');
    expect(statusOf(db, krummzahn)).toBe('dead');
  });

  it('ein Ende eines Zustands bleibt gültig, wenn sein Beginn geändert wird', async () => {
    const { db, lando } = await setup();
    const start = ok(
      recordEntry(db, {
        kind: 'condition',
        at: ELARIS_START - DAY,
        text: 'Pfeil im Bein',
        condition: { entityId: lando.id },
      }),
    );
    const end = ok(
      recordEntry(db, {
        kind: 'condition',
        condition: { entityId: lando.id, ended: true, endsId: start.id },
      }),
    );
    const input = recordInputOf(
      'condition',
      draftOfEntry(start),
      { ...commonOf('Pfeil im linken Bein'), at: start.at - DAY },
      ELARIS_START,
    );
    expect(reviseRecorded(db, start.id, input)).toBe('');
    expect(conditionEnding(db.getSnapshot(), start.id)?.id).toBe(end.id);
  });

  it('feste Arten werden nur geändert, nicht neu festgehalten', async () => {
    const { db } = await setup();
    const elsewhere = db.put('entities', createEntity({ kind: 'place', name: 'Salzgrotte' }));
    const travel = ok(recordEntry(db, { kind: 'travel', travel: { toId: elsewhere.id } }));
    expect(isFixedKind('travel')).toBe(true);
    expect(isFixedKind('fate')).toBe(false);
    expect(revisionNeedsEffect(travel, 'note', draftOfEntry(travel), '')).toBe(false);
    expect(reviseRecorded(db, travel.id, { kind: 'note', text: 'x' })).toContain('nicht ändern');
    expect(db.getSnapshot().state.placeId).toBe(elsewhere.id);
    expect(deleteConsequence(db.getSnapshot(), travel)).toContain(
      'Die Gruppe steht danach wieder in Hohenfurt',
    );
  });

  it('ändert Text und Verweise und behält die Frist auf die Minute', async () => {
    const { db, mira } = await setup();
    const promise = ok(
      recordEntry(db, {
        kind: 'promise',
        text: 'Den Zoll zahlen',
        promise: { due: ELARIS_START + 3 * DAY + 17 },
      }),
    );
    const draft = draftOfEntry(promise);
    const input = recordInputOf(
      'promise',
      draft,
      { ...commonOf('Den Zoll bis Vollmond zahlen'), refs: [mira.id] },
      ELARIS_START,
    );
    const change = revisionPatch(promise, input, { keepDue: true });
    expect(change.text).toBe('Den Zoll bis Vollmond zahlen');
    expect(change.refs).toEqual([mira.id]);
    expect(change.promise?.due).toBe(ELARIS_START + 3 * DAY + 17);
    expect(revisionPatch(promise, input).promise?.due).toBe(ELARIS_START + 3 * DAY);
  });

  it('prüft eine Änderung so, als gäbe es den alten Eintrag nicht', async () => {
    const { db, mira } = await setup();
    const note = ok(recordEntry(db, { kind: 'note', text: 'Hallo', refs: [mira.id] }));
    const without = withoutEntry(db.getSnapshot(), note.id);
    expect(without.chronicle[note.id]).toBeUndefined();
    expect(db.getSnapshot().chronicle[note.id]).toBeDefined();
  });
});

describe('Verweise, Meilensteine und Zusammenfassung', () => {
  it('trennt die Verweise der Bedeutung von den frei gewählten', async () => {
    const { db, mira, krummzahn, hohenfurt } = await setup();
    const meeting = ok(
      recordEntry(db, { kind: 'meeting', refs: [krummzahn.id, mira.id], placeId: hohenfurt.id }),
    );
    expect(freeRefsOf(meeting)).toEqual([]);
    const quote = ok(
      recordEntry(db, { kind: 'quote', text: 'Nie wieder', refs: [mira.id, hohenfurt.id] }),
    );
    expect(freeRefsOf(quote)).toEqual([hohenfurt.id]);
    expect(meaningRefsOf(quote)).toEqual([mira.id]);
    const fate = ok(
      recordEntry(db, {
        kind: 'fate',
        refs: [mira.id],
        fate: { entityId: krummzahn.id, status: 'dead' },
      }),
    );
    expect(freeRefsOf(fate)).toEqual([mira.id]);
    expect(meaningRefsOf(fate)).toEqual([krummzahn.id]);
  });

  it('jede Art mit Pflichttext wird ohne Text abgelehnt', async () => {
    const { db, lando } = await setup();
    const data = db.getSnapshot();
    for (const kind of TEXT_KINDS) {
      if (kind === 'event') continue;
      const problem = recordProblem(data, {
        kind,
        text: '',
        refs: [lando.id],
        condition: { entityId: lando.id },
        wish: { characterId: lando.id },
      });
      expect(problem, kind).not.toBe('');
    }
  });

  it('listet die Meilensteine eines Gefährten, den jüngsten zuerst', async () => {
    const { db, lando } = await setup();
    const first = ok(
      recordEntry(db, {
        kind: 'milestone',
        at: ELARIS_START - DAY,
        text: 'Den Turm gehalten',
        milestone: { characterId: lando.id, level: 4 },
      }),
    );
    const second = ok(recordEntry(db, { kind: 'milestone', milestone: { characterId: lando.id } }));
    expect(milestonesOf(db.getSnapshot(), lando.id).map((e) => e.id)).toEqual([
      second.id,
      first.id,
    ]);
    expect(milestoneLine(first)).toBe('Stufe 4 · Den Turm gehalten');
    expect(milestoneLine(second)).toBe('Meilenstein');
  });

  it('für die Spieler: Gerücht ohne Stand, Zitat als Zitat, Haltung und Geheimes nicht', async () => {
    const { db, mira } = await setup();
    const session = startSession(db);
    if (mira.kind === 'person')
      db.put('entities', { ...mira, person: { ...mira.person, met: true } });
    const rumor = ok(
      recordEntry(db, {
        kind: 'rumor',
        text: 'Die Krähenbande zahlt keinen Zoll',
        rumor: { sourceId: mira.id, truth: 'false' },
      }),
    );
    ok(recordEntry(db, { kind: 'quote', text: 'Nie wieder', refs: [mira.id] }));
    ok(recordEntry(db, { kind: 'lore', text: 'Die Grotte ist verflucht', secret: true }));
    ok(
      recordEntry(db, {
        kind: 'attitude',
        attitude: { fromId: mira.id, toId: PARTY_ID, value: 2 },
      }),
    );
    const data = db.getSnapshot();
    expect(entryPlainText(data, rumor)).toContain('Gerücht von Mira Tannhaus · falsch');
    expect(entryPlainText(data, rumor, 'players')).toBe(
      'Gerücht von Mira Tannhaus: Die Krähenbande zahlt keinen Zoll [Hohenfurt]',
    );
    const players = sessionSummaryText(data, session.id, 'players');
    expect(players).toContain('Gerücht von Mira Tannhaus: Die Krähenbande');
    expect(players).not.toContain('falsch');
    expect(players).toContain('„Nie wieder“ – Mira Tannhaus');
    expect(players).not.toContain('verflucht');
    expect(players).not.toContain('gegenüber');
    expect(sessionSummaryText(data, session.id, 'gm')).toContain('verflucht');
  });
});
