/**
 * Die ganze Kette des Nachtragens an einer erfundenen Kladde mit drei Sessions: Datei trennen,
 * einordnen, übernehmen, lesen, prüfen, annehmen, neu lesen, zurücknehmen. Geprüft wird, dass
 * die Daten stimmen: Nummern, vorhandene Sessions, Weltzeit vor „jetzt“ und ohne Überschneidung,
 * die Wirkung der Einträge, Beute und Fäden zur Zeit von damals, Artikel nur in Steckbrief und
 * „Was geschah“ – und dass nichts die Simulation anstößt. Erfundene Welt (Hohenfurt …).
 */
import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../../data/db';
import { MemoryStore } from '../../../data/store';
import { recordEntry } from '../../../data/record';
import {
  createSession,
  SessionSchema,
  type CampaignData,
  type ReadProposal,
} from '../../../domain/schema';
import { createArticle } from '../../wiki/actions';
import { pageText } from '../../wiki/text';
import { takeOverSessions } from '../actions';
import { takeOverPlan } from '../model';
import { placeSessions } from '../order';
import type { NotesFile } from '../read';
import { storeReading } from '../readActions';
import { reviewProgress } from '../review';
import { acceptProposal, acceptProposals, answerQuestion, undoAccepted } from '../reviewActions';
import { splitSessions } from '../split';
import { NOW, at, readWorld } from './readWorld';

const READ_AT = '2026-11-13T10:00:00.000Z';
const KRUMMZAHN_TEXT = 'Krummzahn führt die Grubenschleicher.\n\nEr hasst das Licht.';

/** Eine erfundene Kladde: Vorspann, drei Abende, Session 4 gibt es schon im Spielstand. */
const KLADDE = `Vorbereitung: die Runde trifft sich in Hohenfurt.

Session 1 – Ankunft
Intro
Ihr seid nach langer Reise in Hohenfurt angekommen. Der Regen hat euch begleitet.
Ihr habt Krummzahn am Anleger gesehen.


Notizen
Sind in Hohenfurt angekommen, haben mit Odo Kessler gesprochen.
Brann hat Krummzahn erschlagen.
Lando sprach mit Tessa am Brunnen. Tessa gab ihnen einen Apfel.
Der Bote brachte eine Nachricht von Hagen Brack.
Dort stand:
Mira,
kommt nicht in die Grotte. Dort wartet die Bande.
Grüße, Hagen
Bei den Toten fand die Gruppe:
12 Goldmünzen
Rostiger Schlüssel

Aktuelle Plothooks:
* Der Schlüssel der Grotte
* Wer bezahlt die Krähenbande?

Session 2
Drei Tage später.
Mira sprach mit Tessa über den Schlüssel.
Nächster Tag.
Lando gab sich als Wido aus.

Session 3
Krummzahn lachte und floh in die Salzgrotte.
Die Gruppe folgte ihm.
`;

const file = (text = KLADDE): NotesFile => ({
  name: 'kladde.txt',
  kind: 'txt',
  text,
  headings: [],
  encoding: 'utf-8',
});

/** Was die Simulation anstoßen würde – darf sich beim Nachtragen nie ändern. */
const simulation = (data: CampaignData) => ({
  now: data.state.now,
  sessionId: data.state.sessionId,
  placeId: data.state.placeId,
  events: data.events,
  clocks: data.clocks,
  runs: data.runs,
  timers: data.timers,
  weather: data.weather,
});

async function world() {
  const w = readWorld();
  const db = await CampaignDb.create(new MemoryStore(), w.data);
  // Session 4 gibt es schon: gespielt, mit einem Ortswechsel nach Hohenfurt.
  const s4 = db.put(
    'sessions',
    createSession({
      number: 4,
      title: 'Im Hafen',
      startAt: at(15, 1, 701, 10),
      endAt: at(15, 1, 701, 22),
    }),
  );
  const travel = recordEntry(db, {
    kind: 'travel',
    text: 'Zurück nach Hohenfurt.',
    at: at(15, 1, 701, 12),
    sessionId: s4.id,
    travel: { toId: w.hohenfurt.id },
  });
  if ('problem' in travel) throw new Error(travel.problem);
  const articleId = createArticle(db, { title: 'Krummzahn', text: KRUMMZAHN_TEXT })!.id;
  const articleText = () => {
    const data = db.getSnapshot();
    const article = data.articles[articleId]!;
    return pageText(data.articles, article, article.docs[0]!);
  };
  return { w, db, s4, articleId, articleText };
}

const planOf = (data: CampaignData, text = KLADDE) => {
  const drafts = splitSessions([file(text)], data.campaign.calendar, data.state.now);
  return takeOverPlan(placeSessions(drafts, data), data);
};

async function takenOver() {
  const setup = await world();
  const { db } = setup;
  const plan = planOf(db.getSnapshot());
  const result = takeOverSessions(db, plan)!;
  const byNumber = (n: number) =>
    Object.values(db.getSnapshot().sessions).find((s) => s.number === n)!;
  return { ...setup, plan, result, byNumber };
}

describe('Übernehmen', () => {
  it('legt drei Sessions vor die vorhandene an – wörtlich, vor „jetzt“, ohne Überschneidung', async () => {
    const { db, s4, plan, result, byNumber } = await takenOver();
    expect(plan.problems).toEqual([]);
    expect(plan.items.map((i) => [i.action, i.number])).toEqual([
      ['skip', null],
      ['create', 1],
      ['create', 2],
      ['create', 3],
    ]);
    expect(result.created).toHaveLength(3);
    const data = db.getSnapshot();
    const sessions = [1, 2, 3].map(byNumber);
    // Wörtlich: ohne die Zeile der Grenze, sonst unverändert.
    expect(sessions[0]!.source!.text).toContain('Brann hat Krummzahn erschlagen.');
    expect(sessions[2]!.source!.text.trim()).toBe(
      'Krummzahn lachte und floh in die Salzgrotte.\nDie Gruppe folgte ihm.',
    );
    for (const s of sessions) {
      expect(s.endAt).not.toBeNull();
      expect(s.endAt!).toBeLessThanOrEqual(data.state.now);
      expect(s.endAt!).toBeLessThanOrEqual(s4.startAt);
      expect(s.startAt).toBeLessThan(s.endAt!);
    }
    for (let i = 1; i < sessions.length; i++)
      expect(sessions[i]!.startAt).toBeGreaterThanOrEqual(sessions[i - 1]!.endAt!);
    // „Drei Tage später“ hält Abstand.
    expect(sessions[1]!.startAt - sessions[0]!.endAt!).toBeGreaterThanOrEqual(3 * 24 * 60);
    // Session 4 bleibt, wie sie ist.
    expect(data.sessions[s4.id]).toMatchObject({ number: 4, title: 'Im Hafen', source: null });
  });

  it('stößt nichts an und lässt sich zurücknehmen', async () => {
    const { db } = await world();
    const before = simulation(db.getSnapshot());
    const result = takeOverSessions(db, planOf(db.getSnapshot()))!;
    expect(simulation(db.getSnapshot())).toEqual(before);
    result.undo();
    expect(Object.values(db.getSnapshot().sessions).map((s) => s.number)).toEqual([4]);
    expect(simulation(db.getSnapshot())).toEqual(before);
  });

  it('erkennt beim zweiten Mal, dass die Notizen schon da sind', async () => {
    const { db } = await takenOver();
    const again = planOf(db.getSnapshot());
    expect(again.items.filter((i) => i.action !== 'skip').map((i) => i.action)).toEqual([
      'same',
      'same',
      'same',
    ]);
    expect(again.ready).toBe(false);
  });

  it('liest geänderte Notizen einer schon geprüften Session neu – Entschiedenes bleibt', async () => {
    const { db, byNumber } = await takenOver();
    const id = byNumber(1).id;
    storeReading(db, id, READ_AT);
    const fate = byNumber(1).reading!.proposals.find((p) => p.kind === 'fate')!;
    const accepted = acceptProposal(db, id, fate.id);
    if ('problem' in accepted) throw new Error(accepted.problem);
    const old = byNumber(1).reading!;
    const made = old.proposals.find((p) => p.id === fate.id)!.created;
    const changed = KLADDE.replace(
      'Brann hat Krummzahn erschlagen.',
      'Odo Kessler erzählte vom Krieg.\nBrann hat Krummzahn erschlagen.',
    );
    const plan = planOf(db.getSnapshot(), changed);
    expect(plan.items.find((i) => i.number === 1)?.action).toBe('attach');
    const result = takeOverSessions(db, plan)!;
    const reading = byNumber(1).reading!;
    expect(byNumber(1).source!.text).toContain('Odo Kessler erzählte vom Krieg.');
    const kept = reading.proposals.find((p) => p.id === fate.id)!;
    expect(kept).toMatchObject({ state: 'accepted', stale: false, created: made });
    // Die Stelle folgt den neuen Notizen.
    expect(byNumber(1).source!.text.slice(kept.from, kept.to)).toContain('Krummzahn erschlagen');
    result.undo();
    expect(byNumber(1).reading).toEqual(old);
  });

  it('übernimmt keine Zeit, die eine vorhandene Session überdeckt', async () => {
    const { db, s4 } = await world();
    const data = db.getSnapshot();
    const drafts = splitSessions([file()], data.campaign.calendar, data.state.now);
    const three = drafts.find((d) => d.number === 3)!;
    const plan = takeOverPlan(
      placeSessions(drafts, data, {
        [three.key]: { startAt: s4.startAt - 60, endAt: s4.startAt + 120 },
      }),
      data,
    );
    expect(plan.ready).toBe(false);
    expect(plan.problems.join(' ')).toContain('Session 4');
  });

  it('übernimmt keine Zeit nach „jetzt“', async () => {
    const { db } = await world();
    const data = db.getSnapshot();
    const drafts = splitSessions([file()], data.campaign.calendar, data.state.now);
    const three = drafts.find((d) => d.number === 3)!;
    const plan = takeOverPlan(
      placeSessions(drafts, data, { [three.key]: { startAt: NOW - 60, endAt: NOW + 60 } }),
      data,
    );
    expect(plan.ready).toBe(false);
  });
});

describe('Lesen, prüfen, annehmen', () => {
  it('liest jede Session, ohne etwas festzuhalten', async () => {
    const { db, byNumber } = await takenOver();
    const before = { ...simulation(db.getSnapshot()), chronicle: db.getSnapshot().chronicle };
    for (const n of [1, 2, 3]) storeReading(db, byNumber(n).id, READ_AT);
    expect({ ...simulation(db.getSnapshot()), chronicle: db.getSnapshot().chronicle }).toEqual(
      before,
    );
    const s1 = byNumber(1);
    expect(s1.recap).toContain('Ihr seid nach langer Reise');
    expect(s1.reading!.proposals.some((p) => p.quote.includes('Ihr seid'))).toBe(false);
    for (const p of s1.reading!.proposals) {
      expect(p.at).toBeGreaterThanOrEqual(s1.startAt);
      expect(p.at).toBeLessThanOrEqual(s1.endAt!);
    }
    // Krummzahn handelt in Session 3, obwohl er in Session 1 starb.
    expect(reviewProgress(s1).contradictions).toBe(1);
  });

  it('nimmt an, liest neu, behält die Entscheidungen und nimmt alles zurück', async () => {
    const { db, w, byNumber, articleText } = await takenOver();
    for (const n of [1, 2, 3]) storeReading(db, byNumber(n).id, READ_AT);
    const sim = simulation(db.getSnapshot());
    const chronicleBefore = db.getSnapshot().chronicle;
    const entitiesBefore = db.getSnapshot().entities;
    const s1 = () => byNumber(1);
    const find = (n: number, test: (p: ReadProposal) => boolean) =>
      byNumber(n).reading!.proposals.find(test)!;

    // Schicksal: Wirkung, Steckbrief und „Was geschah“ – Fließtext bleibt.
    const fate = find(1, (p) => p.kind === 'fate');
    const accepted = acceptProposal(db, s1().id, fate.id);
    if ('problem' in accepted) throw new Error(accepted.problem);
    const krummzahn = db.getSnapshot().entities[w.krummzahn.id]!;
    expect(krummzahn.kind === 'person' && krummzahn.person.status).toBe('dead');
    expect(articleText()).toContain('> Zustand: tot');
    expect(articleText()).toContain('(Session 1): Brann hat Krummzahn erschlagen.');
    expect(articleText()).toContain(KRUMMZAHN_TEXT);

    // Beute zur Zeit von damals, Faden, Schriftstück.
    const loot = find(1, (p) => p.kind === 'loot');
    const hook = find(1, (p) => p.kind === 'thread');
    const writing = find(1, (p) => p.kind === 'writing');
    const more = acceptProposals(db, s1().id, [
      { id: loot.id },
      { id: hook.id },
      { id: writing.id },
    ]);
    expect(more.failed).toEqual([]);
    const lootId = find(1, (p) => p.id === loot.id).created[0]!.id;
    const book = db.getSnapshot().loot[lootId]!;
    expect(book).toMatchObject({ given: true, at: loot.at, sessionId: s1().id });
    expect(db.getSnapshot().chronicle[book.chronicleId!]).toMatchObject({
      backfilled: true,
      sessionId: s1().id,
      at: loot.at,
    });
    const threadId = find(1, (p) => p.id === hook.id).created[0]!.id;
    expect(db.getSnapshot().threads[threadId]?.title).toBe('Der Schlüssel der Grotte');
    const writingEntry =
      db.getSnapshot().chronicle[find(1, (p) => p.id === writing.id).created[0]!.id]!;
    expect(writingEntry.text).toContain('kommt nicht in die Grotte.');
    const writingArticle = db.getSnapshot().articles[writingEntry.writing!.articleId!]!;
    expect(pageText(db.getSnapshot().articles, writingArticle, writingArticle.docs[0]!)).toBe(
      writingEntry.text,
    );

    // Eine Frage beantworten: der Name wird zweiter Name und alles wird neu gelesen.
    const tessa = s1().reading!.questions.find((q) => q.name === 'Tessa')!;
    const answer = answerQuestion(db, s1().id, tessa.key, { link: w.mira.id })!;
    expect(db.getSnapshot().entities[w.mira.id]!.aliases).toEqual(['Tessa']);

    // Erneutes Lesen behält alles Entschiedene – samt dem, was es angelegt hat.
    const decided = s1().reading!.proposals.filter((p) => p.state === 'accepted');
    expect(decided.map((p) => p.id).sort()).toEqual([fate.id, loot.id, hook.id, writing.id].sort());
    storeReading(db, s1().id, READ_AT);
    const reread = s1().reading!.proposals.filter((p) => p.state === 'accepted');
    expect(reread.map((p) => ({ id: p.id, created: p.created, edits: p.edits }))).toEqual(
      decided.map((p) => ({ id: p.id, created: p.created, edits: p.edits })),
    );
    // Beantwortet: Tessa ist jetzt bekannt – keine offene Frage mehr.
    expect(s1().reading!.questions.some((q) => q.key === tessa.key && q.state === 'open')).toBe(
      false,
    );

    // Nichts davon hat die Simulation angestoßen (der Ort der Gruppe bleibt: Session 4 ist jünger).
    expect(simulation(db.getSnapshot())).toEqual(sim);

    // Alles zurück: Chronik, Wirkung, Beute, Faden, Artikel, zweiter Name.
    undoAccepted(db, s1().id, [fate.id, loot.id, hook.id, writing.id]);
    answer.undo();
    expect(db.getSnapshot().chronicle).toEqual(chronicleBefore);
    expect(db.getSnapshot().loot).toEqual({});
    expect(db.getSnapshot().threads).toEqual({});
    expect(Object.values(db.getSnapshot().articles).map((a) => a.title)).toEqual(['Krummzahn']);
    expect(articleText()).toBe(KRUMMZAHN_TEXT);
    const strip = (entities: CampaignData['entities']) =>
      Object.values(entities).map((e) => ({ ...e, rev: 0, updated: '' }));
    expect(strip(db.getSnapshot().entities)).toEqual(strip(entitiesBefore));
    expect(s1().reading!.proposals.every((p) => p.state !== 'accepted')).toBe(true);
    expect(simulation(db.getSnapshot())).toEqual(sim);
  });

  it('nimmt alle sicheren aller Sessions an, ohne den Ort der Gruppe oder die Zeit zu ändern', async () => {
    const { db, byNumber } = await takenOver();
    for (const n of [1, 2, 3]) storeReading(db, byNumber(n).id, READ_AT);
    const sim = simulation(db.getSnapshot());
    const chronicleBefore = db.getSnapshot().chronicle;
    const undos: (() => void)[] = [];
    for (const n of [1, 2, 3]) {
      const session = byNumber(n);
      const open = session.reading!.proposals.filter((p) => p.state === 'open');
      const result = acceptProposals(
        db,
        session.id,
        open.map((p) => ({ id: p.id })),
      );
      for (const failure of result.failed) expect(failure.problem).not.toBe('');
      undos.push(result.undo);
      for (const id of result.accepted) {
        const p = session.reading!.proposals.find((q) => q.id === id)!;
        for (const c of byNumber(n).reading!.proposals.find((q) => q.id === id)!.created)
          if (c.collection === 'chronicle') {
            const entry = db.getSnapshot().chronicle[c.id]!;
            expect(entry.sessionId).toBe(session.id);
            expect(entry.backfilled).toBe(true);
            expect(entry.at).toBe(p.at);
          }
      }
    }
    expect(simulation(db.getSnapshot())).toEqual(sim);
    for (const undo of undos.reverse()) undo();
    expect(db.getSnapshot().chronicle).toEqual(chronicleBefore);
  });
});

describe('Zurücknehmen lässt Weitergeschriebenes stehen', () => {
  it('behält einen Faden, der inzwischen im Spiel ist', async () => {
    const { db, byNumber } = await takenOver();
    const id = byNumber(1).id;
    storeReading(db, id, READ_AT);
    const hook = byNumber(1).reading!.proposals.find((p) => p.kind === 'thread')!;
    acceptProposal(db, id, hook.id);
    const threadId = byNumber(1).reading!.proposals.find((p) => p.id === hook.id)!.created[0]!.id;
    db.patch('threads', threadId, { inPlay: true });
    const { notes } = undoAccepted(db, id, [hook.id]);
    expect(db.getSnapshot().threads[threadId]).toBeDefined();
    expect(notes.join(' ')).toContain('bleibt');
  });
});

describe('Alte Spielstände', () => {
  it('lädt Sessions ohne Quelle, Rückblick und Lesen – und Vorschläge ohne Änderungen', () => {
    const old = SessionSchema.parse({
      id: 's1',
      number: 1,
      title: '',
      realDate: '',
      startAt: 0,
      endAt: 10,
      notes: 'alt',
    });
    expect(old).toMatchObject({ source: null, recap: '', reading: null });
    const read = SessionSchema.parse({
      ...old,
      source: { file: 'a.txt', text: 'x' },
      reading: {
        readAt: READ_AT,
        proposals: [{ id: 'p', key: 'note:x', kind: 'note', quote: 'x', text: 'x', at: 1 }],
      },
    });
    expect(read.source).toMatchObject({ line: 0, precision: 'exact' });
    expect(read.reading!.proposals[0]).toMatchObject({ edits: [], created: [], state: 'open' });
  });
});
