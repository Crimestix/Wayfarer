/**
 * Festhalten, Schritt 1b in der Chronik: Entwürfe der neuen Arten, Schriftstücke als Artikel,
 * Lieferungen als Termin und die Darstellung als Text. Erfundene Welt.
 */
import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { recordEntry, type RecordResult } from '../../data/record';
import { emptyCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { recognizeDelivery, recognizeEntry } from '../../domain/recognize';
import { createEntity } from '../../domain/schema';
import { ELARIS_CALENDAR, ELARIS_START } from '../../domain/time/elaris';
import { WRITINGS_FOLDER, fileWriting, recordFiled, reviseRecorded } from './actions';
import { deleteConsequence, entryPlainText, lockedRefs } from './model';
import {
  choiceOfEntry,
  deliveryEvent,
  draftFromRecognized,
  draftOfEntry,
  draftProblem,
  emptyRecordDraft,
  recordInputOf,
  toggleRecognized,
  partOf,
  type RecordCommon,
} from './recordDraft';

const DAY = 24 * 60;
const NOW = ELARIS_START;

async function setup() {
  const db = await CampaignDb.create(
    new MemoryStore(),
    emptyCampaign('Testwelt', ELARIS_CALENDAR, NOW),
  );
  const hohenfurt = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const mira = db.put('entities', createEntity({ kind: 'person', name: 'Mira Tannhaus' }));
  const feder = db.put(
    'entities',
    createEntity({ kind: 'person', name: 'Schwarzfeder', person: { role: 'Begleiter' } }),
  );
  const brann = db.put('entities', createEntity({ kind: 'character', name: 'Brann Eichwald' }));
  db.setState({ placeId: hohenfurt.id });
  return { db, hohenfurt, mira, feder, brann };
}

const common = (text: string, refs: string[] = []): RecordCommon => ({
  text,
  refs,
  secret: false,
});

function ok(result: RecordResult) {
  if ('problem' in result) throw new Error(result.problem);
  return result.entry;
}

describe('Entwürfe der neuen Arten', () => {
  it('„Auftrag“ wird eine Abmachung der Sorte „Auftrag“ mit dem Auftraggeber vorn', async () => {
    const { mira } = await setup();
    const input = recordInputOf(
      'job',
      { ...emptyRecordDraft(), whoId: mira.id, dueDays: '2' },
      common('Den Wolf erlegen.'),
      NOW,
    );
    expect(input).toMatchObject({
      kind: 'promise',
      refs: [mira.id],
      promise: { sort: 'job', due: NOW + 2 * DAY, outcome: 'open' },
    });
  });

  it('Schriftstück, Zwischenzeit, Wandlung und Begleiter tragen ihre Angaben', async () => {
    const { mira, brann, feder } = await setup();
    const d = emptyRecordDraft();
    expect(
      recordInputOf(
        'writing',
        { ...d, whoId: mira.id, title: 'Brief', createArticle: true },
        common('W'),
        NOW,
      ).writing,
    ).toEqual({ title: 'Brief', articleId: null, createArticle: true });
    expect(
      recordInputOf(
        'downtime',
        {
          ...d,
          days: '42',
          activities: [
            { characterId: brann.id, text: 'lernt' },
            { characterId: brann.id, text: ' ' },
          ],
        },
        common(''),
        NOW,
      ).downtime,
    ).toEqual({ days: 42, activities: [{ characterId: brann.id, text: 'lernt' }] });
    expect(
      recordInputOf('transformation', { ...d, whoId: brann.id }, common('x'), NOW).transformation,
    ).toEqual({ characterId: brann.id });
    expect(
      recordInputOf(
        'companion',
        { ...d, whoId: feder.id, towardId: brann.id, ended: true },
        common(''),
        NOW,
      ).companion,
    ).toEqual({ entityId: feder.id, joined: false, ownerId: brann.id });
    expect(
      recordInputOf('reveal', { ...d, whoId: mira.id, aliasName: ' Mirjana ' }, common('x'), NOW)
        .reveal,
    ).toEqual({ prepSecretId: null, alias: { entityId: mira.id, name: 'Mirjana' } });
  });

  it('sagt, was noch fehlt', () => {
    const d = emptyRecordDraft();
    expect(draftProblem('writing', { ...d, createArticle: true })).toMatch(/Titel/);
    expect(draftProblem('downtime', { ...d, days: 'sechs' })).toMatch(/Tagen/);
    expect(draftProblem('transformation', d)).toMatch(/Gefährte/);
    expect(draftProblem('companion', d)).toMatch(/Tier/);
    expect(draftProblem('reveal', { ...d, aliasName: 'X' })).toMatch(/Wessen/);
    expect(draftProblem('job', { ...d, dueDays: 'bald' })).toMatch(/Frist/);
  });

  it('ein vorhandener Eintrag kommt mit seiner Wahl zurück', async () => {
    const { db, mira, feder, brann } = await setup();
    const job = ok(
      recordEntry(db, {
        kind: 'promise',
        text: 'Jagen.',
        refs: [mira.id],
        promise: { sort: 'job' },
      }),
    );
    expect(choiceOfEntry(job)).toBe('job');
    expect(draftOfEntry(job).whoId).toBe(mira.id);
    const came = ok(
      recordEntry(db, { kind: 'companion', companion: { entityId: feder.id, ownerId: brann.id } }),
    );
    expect(draftOfEntry(came)).toMatchObject({ whoId: feder.id, towardId: brann.id, ended: false });
    expect(lockedRefs(came)).toEqual([feder.id, brann.id]);
  });

  it('ein erkannter Auftrag wird zur Wahl „Auftrag“', async () => {
    const { db, mira } = await setup();
    const [item] = recognizeEntry(db.getSnapshot(), 'Mira Tannhaus beauftragt uns.').filter(
      (i) => i.kind === 'promise',
    );
    const { parts } = toggleRecognized([partOf('note')], item!);
    expect(parts.map((p) => p.choice)).toEqual(['job']);
    expect(draftFromRecognized(item!).draft.whoId).toBe(mira.id);
  });
});

describe('Schriftstück als Artikel', () => {
  it('legt Ordner und Artikel mit dem Wortlaut an – Rückgängig nimmt beides weg', async () => {
    const { db, mira } = await setup();
    const text = 'Kommt allein zur Mühle.\n— M.';
    const result = recordFiled(db, [
      {
        kind: 'writing',
        text,
        refs: [mira.id],
        writing: { title: 'Brief an Brann', createArticle: true },
      },
    ]);
    if ('problem' in result) throw new Error(result.problem);
    const entry = result.entries[0]!;
    const articles = Object.values(db.getSnapshot().articles);
    const folder = articles.find((a) => a.title === WRITINGS_FOLDER);
    const article = articles.find((a) => a.title === 'Brief an Brann');
    expect(folder?.parentId).toBeNull();
    expect(article?.parentId).toBe(folder?.id);
    expect(article?.docs[0]?.text).toBe(text);
    expect(entry.writing?.articleId).toBe(article?.id);
    expect(deleteConsequence(db.getSnapshot(), entry)).toMatch(/bleibt im Wiki/);
    result.undo();
    expect(Object.values(db.getSnapshot().articles)).toEqual([]);
    expect(db.getSnapshot().chronicle[entry.id]).toBeUndefined();
  });

  it('ein zweites Schriftstück kommt in denselben Ordner; ohne Häkchen kein Artikel', async () => {
    const { db } = await setup();
    const first = ok(
      recordEntry(db, { kind: 'writing', text: 'Eins', writing: { title: 'Erster' } }),
    );
    expect(Object.values(db.getSnapshot().articles)).toEqual([]);
    fileWriting(db, first.id);
    const second = recordFiled(db, [
      { kind: 'writing', text: 'Zwei', writing: { title: 'Zweiter', createArticle: true } },
    ]);
    if ('problem' in second) throw new Error(second.problem);
    const folders = Object.values(db.getSnapshot().articles).filter(
      (a) => a.title === WRITINGS_FOLDER,
    );
    expect(folders).toHaveLength(1);
    // Schon abgelegt: kein zweiter Artikel.
    expect(fileWriting(db, first.id)).toBeNull();
  });

  it('beim Ändern bleibt der Artikel; ein nachträgliches Häkchen legt ihn an', async () => {
    const { db } = await setup();
    const entry = ok(
      recordEntry(db, { kind: 'writing', text: 'Wortlaut', writing: { title: 'Alt' } }),
    );
    const draft = { ...draftOfEntry(entry), createArticle: true, title: 'Neu' };
    expect(
      reviseRecorded(db, entry.id, recordInputOf('writing', draft, common('Wortlaut'), NOW)),
    ).toBe('');
    const after = db.getSnapshot().chronicle[entry.id]!;
    expect(after.writing?.title).toBe('Neu');
    expect(db.getSnapshot().articles[after.writing!.articleId!]?.title).toBe('Neu');
  });
});

describe('Lieferung als Termin', () => {
  it('liegt so viele Tage nach dem Eintrag, ohne Uhrzeit, mit dem Satz als Bezeichnung', () => {
    const offer = recognizeDelivery('Das Schwert ist in 3 Tagen fertig.')!;
    const event = deliveryEvent(offer, NOW, NOW);
    expect(event?.title).toBe('Das Schwert ist in 3 Tagen fertig.');
    expect(event!.at % DAY).toBe(0);
    expect(Math.floor(event!.at / DAY) - Math.floor(NOW / DAY)).toBe(3);
  });

  it('bietet nichts an, was schon vorbei ist', () => {
    const offer = recognizeDelivery('Das Schwert ist in 3 Tagen fertig.')!;
    expect(deliveryEvent(offer, NOW - 10 * DAY, NOW)).toBeNull();
  });
});

describe('Als Text', () => {
  it('Schriftstück wörtlich, Zwischenzeit mit Tätigkeiten, Auftrag als Auftrag', async () => {
    const { db, mira, brann } = await setup();
    const writing = ok(
      recordEntry(db, {
        kind: 'writing',
        text: 'Zeile eins\nZeile zwei',
        writing: { title: 'Aushang' },
      }),
    );
    expect(entryPlainText(db.getSnapshot(), writing)).toMatch(
      /^Schriftstück „Aushang“ \[Hohenfurt\]\nZeile eins\nZeile zwei$/,
    );
    const downtime = ok(
      recordEntry(db, {
        kind: 'downtime',
        at: NOW - 7 * DAY,
        downtime: { days: 7, activities: [{ characterId: brann.id, text: 'schmiedet' }] },
      }),
    );
    expect(entryPlainText(db.getSnapshot(), downtime)).toBe(
      'Freie Zeit: 1 Woche [Hohenfurt]\n- Brann Eichwald: schmiedet',
    );
    const job = ok(
      recordEntry(db, {
        kind: 'promise',
        text: 'Jagen.',
        refs: [mira.id],
        promise: { sort: 'job' },
      }),
    );
    expect(entryPlainText(db.getSnapshot(), job)).toBe(
      'Auftrag von Mira Tannhaus: Jagen. (offen) [Hohenfurt]',
    );
  });
});
