/**
 * Eine gelesene Session prüfen: Stand, markierte Notizen, Folgen beim Annehmen, Annehmen und
 * Zurücknehmen (Chronik, Beute, Fäden, Schriftstücke, Steckbrief, „Was geschah“), Fragen zu
 * Namen und die Weltzeit der Session. Erfundene Welt (Hohenfurt, Krummzahn, Mira Tannhaus …).
 */
import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../../data/db';
import { MemoryStore } from '../../../data/store';
import { recordEntry } from '../../../data/record';
import { threadOrigin } from '../../../domain/looseThreads';
import {
  createSession,
  createStory,
  type ReadProposal,
  type Session,
} from '../../../domain/schema';
import { createArticle, savePageText } from '../../wiki/actions';
import { pageText } from '../../wiki/text';
import { storeReading } from '../readActions';
import {
  consequencesOf,
  happenedText,
  isReviewed,
  nextToReview,
  noteView,
  planAccept,
  proposalWhen,
  questionGuesses,
  reviewProgress,
  reviewState,
  sessionTimeProblem,
  threadTwinNote,
} from '../review';
import {
  acceptProposal,
  acceptProposals,
  answerQuestion,
  dismissProposal,
  setSessionTime,
  undoAccepted,
} from '../reviewActions';
import { proposalInput } from '../readSession';
import { ABEND_EINS, ABEND_ZWEI, NOW, at, noted, readWorld } from './readWorld';

const READ_AT = '2026-11-13T10:00:00.000Z';
const KRUMMZAHN_TEXT = 'Krummzahn führt die Grubenschleicher.\n\nEr hasst das Licht.';

async function setup(options: { article?: boolean; later?: boolean } = {}) {
  const w = readWorld();
  const db = await CampaignDb.create(new MemoryStore(), w.data);
  const s1 = noted(1, ABEND_EINS, at(3, 1, 701, 9), at(5, 1, 701, 22));
  db.put('sessions', s1);
  if (options.later) db.put('sessions', noted(2, ABEND_ZWEI, at(6, 1, 701, 9), at(6, 1, 701, 22)));
  db.setState({ placeId: w.hohenfurt.id });
  let articleId = '';
  if (options.article !== false) {
    articleId = createArticle(db, { title: 'Krummzahn', text: KRUMMZAHN_TEXT })!.id;
  }
  storeReading(db, s1.id, READ_AT);
  const session = () => db.getSnapshot().sessions[s1.id]!;
  const proposal = (find: (p: ReadProposal) => boolean) => session().reading!.proposals.find(find)!;
  const articleText = () => {
    const data = db.getSnapshot();
    const article = data.articles[articleId]!;
    return pageText(data.articles, article, article.docs[0]!);
  };
  return { w, db, s1, session, proposal, articleId, articleText };
}

describe('Stand des Prüfens', () => {
  it('sagt, wie weit eine Session ist', async () => {
    const { db, session, proposal } = await setup();
    const unread = createSession({ number: 9, startAt: 0 });
    expect(reviewState(unread)).toMatchObject({ text: 'noch nicht gelesen', tone: 'mute' });
    const start = reviewProgress(session());
    expect(start.read).toBe(true);
    expect(start.total).toBeGreaterThan(5);
    expect(start.questions).toBe(1);
    expect(reviewState(session()).text).toBe(`gelesen · ${start.total} Vorschläge`);
    dismissProposal(db, session().id, proposal((p) => p.kind === 'fate').id);
    expect(reviewState(session()).text).toBe(`1 von ${start.total} geprüft`);
    expect(isReviewed(session())).toBe(false);
    expect(nextToReview([session()])?.id).toBe(session().id);
  });

  it('zeigt Widersprüche als Warnung', async () => {
    const { db, w } = await setup({ later: true });
    const s1 = Object.values(db.getSnapshot().sessions).find((s) => s.number === 1)!;
    expect(reviewProgress(s1).contradictions).toBe(1);
    expect(reviewState(s1)).toMatchObject({ text: '1 Widerspruch', tone: 'warn' });
    expect(w.krummzahn.id).toBeTruthy();
  });
});

describe('Die Notizen', () => {
  it('markiert Namen, unbekannte Namen, Zeitangaben und die Sätze der Vorschläge', async () => {
    const { db, session, proposal, w } = await setup();
    const lines = noteView(db.getSnapshot(), session());
    expect(lines).toHaveLength(ABEND_EINS.split('\n').length);
    expect(lines[0]!.heading).toContain('Rückblick für die Spieler');
    // Im Rückblick wird nichts markiert.
    expect(lines.slice(0, 4).every((l) => l.segments.every((s) => !s.entityId))).toBe(true);
    const brann = lines.find((l) => ABEND_EINS.slice(l.from, l.to).startsWith('Brann hat'))!;
    const krummzahn = brann.segments.find((s) => s.text === 'Krummzahn')!;
    expect(krummzahn.entityId).toBe(w.krummzahn.id);
    const fate = proposal((p) => p.kind === 'fate');
    expect(krummzahn.proposals).toContain(fate.id);
    const tessa = lines.flatMap((l) => l.segments).filter((s) => s.question === 'tesa');
    expect(tessa.map((s) => s.text)).toEqual(['Tessa', 'Tessa']);
    expect(lines.flatMap((l) => l.segments).some((s) => s.date && s.text === 'Nächster Tag')).toBe(
      true,
    );
    expect(lines.find((l) => l.section === 'hooks')?.heading).toBe('Offene Fäden');
    // Die Stücke ergeben die Zeile wörtlich.
    for (const line of lines)
      expect(line.segments.map((s) => s.text).join('')).toBe(ABEND_EINS.slice(line.from, line.to));
  });
});

describe('Folgen beim Annehmen', () => {
  it('bietet Steckbrief und „Was geschah“ nur an, wenn das Ding einen Artikel hat', async () => {
    const { db, session, proposal } = await setup();
    const fate = proposal((p) => p.kind === 'fate');
    const input = proposalInput(fate, session().id);
    expect(consequencesOf(db.getSnapshot(), input).map((c) => [c.key, c.label, c.checked])).toEqual(
      [
        ['fact', 'Zustand bei Krummzahn: tot – auch im Steckbrief', true],
        ['happened', 'Bei Krummzahn unter „Was geschah“ deinen Satz eintragen', true],
      ],
    );
    const none = await setup({ article: false });
    const bare = none.proposal((p) => p.kind === 'fate');
    expect(consequencesOf(none.db.getSnapshot(), proposalInput(bare, none.s1.id))).toEqual([]);
    const writing = proposal((p) => p.kind === 'writing');
    expect(consequencesOf(db.getSnapshot(), proposalInput(writing, session().id))).toEqual([
      { key: 'article', label: 'Als Artikel unter „Schriftstücke“ ablegen', checked: true },
    ]);
  });

  it('schreibt den Punkt mit Tag, Session und dem Satz wörtlich', async () => {
    const { db } = await setup();
    const cal = db.getSnapshot().campaign.calendar;
    expect(happenedText(cal, { number: 5 }, at(8, 1, 701, 9), 'day', 'Krummzahn  ist\ntot.')).toBe(
      '8. Tauwind 701 AD (Session 5): Krummzahn ist tot.',
    );
    expect(happenedText(cal, { number: 5 }, at(8, 1, 701), 'order', 'x')).toBe(
      'ungefähr 8. Tauwind 701 AD (Session 5): x',
    );
    expect(proposalWhen(cal, { at: at(8, 1, 701, 9, 30), precision: 'exact' })).toBe(
      '8. Tauwind 701 AD, 09:30',
    );
    expect(proposalWhen(cal, { at: at(8, 1, 701), precision: 'approx' })).toBe(
      'ungefähr 8. Tauwind 701 AD',
    );
  });

  it('plant Beute mit der Zeit des Vorschlags und ohne „jetzt“', async () => {
    const { db, session, proposal, w } = await setup();
    const loot = proposal((p) => p.kind === 'loot');
    const plan = planAccept(db.getSnapshot(), session(), loot);
    expect(plan).toMatchObject({
      kind: 'loot',
      loot: { text: 'Rostiger Schlüssel', gold: 12.5, toId: null, source: 'Krummzahn' },
      when: { at: loot.at, sessionId: session().id, placeId: w.hohenfurt.id },
    });
  });

  it('sagt, was fehlt, wenn erst etwas gewählt werden muss', async () => {
    const { db, session, proposal } = await setup();
    const fate = proposal((p) => p.kind === 'fate');
    const open = { ...fate, payload: { fate: { entityId: null, status: 'dead' } } };
    expect(planAccept(db.getSnapshot(), session(), open)).toEqual({
      problem: 'Wessen Schicksal ist es? Wähle es über „Ändern“.',
    });
  });
});

describe('Annehmen und zurücknehmen', () => {
  it('hält ein Schicksal nachgetragen fest – mit Steckbrief und „Was geschah“', async () => {
    const { db, session, proposal, articleText, w } = await setup();
    const fate = proposal((p) => p.kind === 'fate');
    const result = acceptProposal(db, session().id, fate.id);
    if ('problem' in result) throw new Error(result.problem);
    const accepted = proposal((p) => p.id === fate.id);
    expect(accepted.state).toBe('accepted');
    const entry = db.getSnapshot().chronicle[accepted.created[0]!.id]!;
    expect(entry).toMatchObject({
      kind: 'fate',
      at: fate.at,
      sessionId: session().id,
      backfilled: true,
      precision: fate.precision,
      text: 'Brann hat Krummzahn erschlagen.',
    });
    const krummzahn = db.getSnapshot().entities[w.krummzahn.id]!;
    expect(krummzahn.kind === 'person' && krummzahn.person.status).toBe('dead');
    const day = proposalWhen(db.getSnapshot().campaign.calendar, { ...fate, precision: 'day' });
    const when =
      fate.precision === 'approx' || fate.precision === 'order' ? `ungefähr ${day}` : day;
    expect(articleText()).toBe(
      `> [!steckbrief]\n> Zustand: tot\n\n${KRUMMZAHN_TEXT}\n\n## Was geschah\n\n- ${when} (Session 1): Brann hat Krummzahn erschlagen.\n`,
    );
    expect(accepted.edits.map((e) => e.kind)).toEqual(['fact', 'happened']);

    // Zurücknehmen – auch ohne die Handgriffe von eben, nur aus dem, was am Vorschlag steht.
    undoAccepted(db, session().id, [fate.id]);
    expect(db.getSnapshot().chronicle[entry.id]).toBeUndefined();
    const back = db.getSnapshot().entities[w.krummzahn.id]!;
    expect(back.kind === 'person' && back.person.status).toBe('alive');
    expect(articleText()).toBe(KRUMMZAHN_TEXT);
    expect(proposal((p) => p.id === fate.id)).toMatchObject({
      state: 'open',
      created: [],
      edits: [],
    });
  });

  it('lässt den Steckbrief ohne Häkchen in Ruhe', async () => {
    const { db, session, proposal, articleText } = await setup();
    const fate = proposal((p) => p.kind === 'fate');
    acceptProposal(db, session().id, fate.id, { checks: { fact: false, happened: false } });
    expect(articleText()).toBe(KRUMMZAHN_TEXT);
  });

  it('lässt Zeilen stehen, die der Spielleiter seither geändert hat', async () => {
    const { db, session, proposal, articleText, articleId } = await setup();
    const fate = proposal((p) => p.kind === 'fate');
    acceptProposal(db, session().id, fate.id);
    const changed = articleText().replace('> Zustand: tot', '> Zustand: sehr tot');
    savePageText(db, articleId, db.getSnapshot().articles[articleId]!.docs[0]!.id, changed);
    undoAccepted(db, session().id, [fate.id]);
    expect(articleText()).toBe(`> [!steckbrief]\n> Zustand: sehr tot\n\n${KRUMMZAHN_TEXT}`);
  });

  it('schreibt keinen Steckbrief, wenn ein späterer Eintrag den heutigen Stand bestimmt', async () => {
    const { db, session, proposal, articleText, w } = await setup();
    const later = acceptLaterFate(db, w.krummzahn.id);
    const fate = proposal((p) => p.kind === 'fate');
    const result = acceptProposal(db, session().id, fate.id);
    if ('problem' in result) throw new Error(result.problem);
    expect(result.notes[0]).toContain('Ein späterer Eintrag bestimmt den heutigen Stand');
    expect(articleText()).not.toContain('Zustand: tot');
    expect(articleText()).toContain('## Was geschah');
    expect(later).toBeTruthy();
  });

  it('gibt Beute zur Zeit der Session aus und nimmt sie zurück', async () => {
    const { db, session, proposal } = await setup();
    const loot = proposal((p) => p.kind === 'loot');
    const result = acceptProposal(db, session().id, loot.id);
    if ('problem' in result) throw new Error(result.problem);
    const made = proposal((p) => p.id === loot.id).created;
    expect(made).toEqual([{ collection: 'loot', id: expect.any(String) }]);
    const book = db.getSnapshot().loot[made[0]!.id]!;
    expect(book).toMatchObject({ given: true, at: loot.at, sessionId: session().id, gold: 12.5 });
    const line = db.getSnapshot().chronicle[book.chronicleId!]!;
    expect(line).toMatchObject({ at: loot.at, sessionId: session().id, backfilled: true });
    result.undo();
    expect(db.getSnapshot().loot[book.id]).toBeUndefined();
    expect(db.getSnapshot().chronicle[line.id]).toBeUndefined();
  });

  it('legt Fäden an und nimmt sie zurück, solange niemand weitergeschrieben hat', async () => {
    const { db, session, proposal } = await setup();
    const hook = proposal((p) => p.kind === 'thread');
    acceptProposal(db, session().id, hook.id);
    const id = proposal((p) => p.id === hook.id).created[0]!.id;
    expect(db.getSnapshot().threads[id]).toMatchObject({ title: 'Der Schlüssel der Grotte' });
    db.patch('threads', id, { truth: 'Er gehört dem Krämer.' });
    const { notes } = undoAccepted(db, session().id, [hook.id]);
    expect(notes[0]).toContain('bleibt');
    expect(db.getSnapshot().threads[id]).toBeDefined();
  });

  it('legt denselben Faden aus einer zweiten Session nicht noch einmal an – sie wird nur Quelle', async () => {
    const { db, session, proposal } = await setup();
    const s2 = noted(
      2,
      'Die Gruppe rastete.\nOffene Fragen:\n- der Schlüssel der Grotte?\n- Wer bezahlt die Krähenbande?',
      at(6, 1, 701, 9),
      at(6, 1, 701, 22),
    );
    db.put('sessions', s2);
    storeReading(db, s2.id, READ_AT);
    const later = () => db.getSnapshot().sessions[s2.id]!;
    const again = later().reading!.proposals.find(
      (p) => p.kind === 'thread' && p.text.toLowerCase().includes('schlüssel'),
    )!;
    // Solange es ihn nicht gibt, sagt der Vorschlag nichts.
    expect(threadTwinNote(db.getSnapshot(), again)).toBe('');
    const hook = proposal((p) => p.kind === 'thread');
    acceptProposal(db, session().id, hook.id);
    const id = proposal((p) => p.id === hook.id).created[0]!.id;
    expect(db.getSnapshot().threads[id]!.sessionIds).toEqual([session().id]);
    expect(threadTwinNote(db.getSnapshot(), again)).toContain('gibt es schon – als losen Faden');

    const result = acceptProposal(db, s2.id, again.id);
    if ('problem' in result) throw new Error(result.problem);
    expect(result.notes[0]).toContain('gibt es schon');
    expect(Object.keys(db.getSnapshot().threads)).toEqual([id]);
    expect(db.getSnapshot().threads[id]!.sessionIds).toEqual([session().id, s2.id]);
    const accepted = later().reading!.proposals.find((p) => p.id === again.id)!;
    expect(accepted).toMatchObject({ state: 'accepted', created: [] });
    expect(accepted.edits).toEqual([
      { kind: 'source', targetId: id, line: s2.id, before: null, made: true },
    ]);
    expect(
      threadOrigin(db.getSnapshot(), db.getSnapshot().threads[id]!).sessions.map((s) => s.number),
    ).toEqual([1, 2]);
    // Zurückgenommen ist nur die Quelle weg – der Faden der ersten Session bleibt.
    result.undo();
    expect(db.getSnapshot().threads[id]!.sessionIds).toEqual([session().id]);
    expect(later().reading!.proposals.find((p) => p.id === again.id)!.state).toBe('open');
    // „Alle sicheren annehmen“ legt auch dann nur den einen an, der noch fehlt.
    const all = acceptProposals(
      db,
      s2.id,
      later()
        .reading!.proposals.filter((p) => p.kind === 'thread')
        .map((p) => ({ id: p.id })),
    );
    expect(all.failed).toEqual([]);
    expect(
      Object.values(db.getSnapshot().threads)
        .map((t) => t.title)
        .sort(),
    ).toEqual(['Der Schlüssel der Grotte', 'Wer bezahlt die Krähenbande?']);
  });

  it('hängt einen Faden beim Annehmen gleich an die gewählte Geschichte', async () => {
    const { db, session, proposal } = await setup();
    const tale = db.put('stories', createStory({ title: 'Die Grotte' }));
    const hook = proposal((p) => p.kind === 'thread');
    expect(planAccept(db.getSnapshot(), session(), hook)).toMatchObject({
      kind: 'thread',
      thread: { storyId: null },
    });
    acceptProposal(db, session().id, hook.id, {
      thread: { title: 'Der Schlüssel der Grotte', refs: [], storyId: tale.id },
    });
    const id = proposal((p) => p.id === hook.id).created[0]!.id;
    expect(db.getSnapshot().threads[id]).toMatchObject({ storyId: tale.id, known: true });
    // Nur angehängt ist nicht weitergeschrieben: Zurücknehmen nimmt ihn wieder weg.
    expect(undoAccepted(db, session().id, [hook.id]).notes).toEqual([]);
    expect(db.getSnapshot().threads[id]).toBeUndefined();
    // Eine Geschichte, die es nicht gibt, gilt als „keine“.
    acceptProposal(db, session().id, hook.id, {
      thread: { title: 'Der Schlüssel der Grotte', refs: [], storyId: 'gibtsnicht' },
    });
    const loose = proposal((p) => p.id === hook.id).created[0]!.id;
    expect(db.getSnapshot().threads[loose]!.storyId).toBeNull();
    // An eine andere Geschichte gehängt: Dann bleibt er.
    db.patch('threads', loose, { storyId: tale.id });
    expect(undoAccepted(db, session().id, [hook.id]).notes[0]).toContain('bleibt');
  });

  it('legt ein Schriftstück als Artikel ab – und nimmt Artikel und Ordner zurück', async () => {
    const { db, session, proposal } = await setup({ article: false });
    const writing = proposal((p) => p.kind === 'writing');
    acceptProposal(db, session().id, writing.id);
    const created = proposal((p) => p.id === writing.id).created;
    expect(created.map((c) => c.collection)).toEqual(['chronicle', 'articles', 'articles']);
    const titles = Object.values(db.getSnapshot().articles).map((a) => a.title);
    expect(titles.sort()).toEqual(['Nachricht von Hagen Brack', 'Schriftstücke']);
    undoAccepted(db, session().id, [writing.id]);
    expect(Object.keys(db.getSnapshot().articles)).toEqual([]);
  });

  it('merkt sich Decknamen aus einer Notiz als zweiten Namen', async () => {
    const { db, session, proposal, w } = await setup();
    const alias = proposal((p) => p.label.startsWith('Zweiter Name'));
    acceptProposal(db, session().id, alias.id);
    expect(db.getSnapshot().entities[w.lando.id]!.aliases).toEqual(['Wido']);
    undoAccepted(db, session().id, [alias.id]);
    expect(db.getSnapshot().entities[w.lando.id]!.aliases).toEqual([]);
  });

  it('nimmt alle sicheren zusammen an – und alles wieder zurück', async () => {
    const { db, session } = await setup();
    const safe = reviewProgress(session()).safe;
    expect(safe).toBeGreaterThan(3);
    const before = Object.keys(db.getSnapshot().chronicle).length;
    const open = session().reading!.proposals.filter((p) => p.state === 'open');
    const result = acceptProposals(
      db,
      session().id,
      open.map((p) => ({ id: p.id })),
    );
    expect(result.accepted.length).toBeGreaterThanOrEqual(safe);
    expect(Object.keys(db.getSnapshot().chronicle).length).toBeGreaterThan(before);
    // Was nicht ging, nennt seinen Grund und bleibt offen.
    for (const failure of result.failed) expect(failure.problem).not.toBe('');
    result.undo();
    expect(Object.keys(db.getSnapshot().chronicle).length).toBe(before);
    expect(session().reading!.proposals.every((p) => p.state === 'open')).toBe(true);
  });

  it('verwirft und macht wieder offen', async () => {
    const { db, session, proposal } = await setup();
    const fate = proposal((p) => p.kind === 'fate');
    const undo = dismissProposal(db, session().id, fate.id);
    expect(proposal((p) => p.id === fate.id).state).toBe('dismissed');
    // Erneutes Lesen behält die Entscheidung.
    storeReading(db, session().id, READ_AT);
    expect(proposal((p) => p.id === fate.id).state).toBe('dismissed');
    undo();
    expect(proposal((p) => p.id === fate.id).state).toBe('open');
  });
});

describe('Fragen zu Namen', () => {
  it('rät naheliegende Einträge', async () => {
    const { db, session, w } = await setup();
    const q = session().reading!.questions[0]!;
    db.patch('entities', w.mira.id, { name: 'Tessa Tannhaus' });
    expect(questionGuesses(db.getSnapshot(), q).map((e) => e.name)).toEqual(['Tessa Tannhaus']);
    expect(questionGuesses(db.getSnapshot(), { ...q, name: 'Xy' })).toEqual([]);
  });

  it('merkt sich den Namen am gewählten Eintrag und liest neu', async () => {
    const { db, session, w } = await setup();
    const result = answerQuestion(db, session().id, 'tesa', { link: w.mira.id })!;
    expect(db.getSnapshot().entities[w.mira.id]!.aliases).toEqual(['Tessa']);
    expect(session().reading!.questions.some((q) => q.key === 'tesa' && q.state === 'open')).toBe(
      false,
    );
    result.undo();
    expect(db.getSnapshot().entities[w.mira.id]!.aliases).toEqual([]);
    expect(session().reading!.questions.find((q) => q.key === 'tesa')?.state).toBe('open');
  });

  it('legt nur auf Wunsch einen neuen Eintrag an', async () => {
    const { db, session } = await setup();
    const count = Object.keys(db.getSnapshot().entities).length;
    const result = answerQuestion(db, session().id, 'tesa', { create: 'person' })!;
    expect(db.getSnapshot().entities[result.entityId!]).toMatchObject({
      kind: 'person',
      name: 'Tessa',
    });
    result.undo();
    expect(Object.keys(db.getSnapshot().entities).length).toBe(count);
    answerQuestion(db, session().id, 'tesa', { none: true });
    expect(session().reading!.questions[0]).toMatchObject({ key: 'tesa', state: 'none' });
    expect(Object.keys(db.getSnapshot().entities).length).toBe(count);
  });
});

describe('Weltzeit der Session', () => {
  it('prüft Zukunft, Reihenfolge und Überschneidungen', async () => {
    const { db, session } = await setup({ later: true });
    const data = db.getSnapshot();
    const id = session().id;
    expect(sessionTimeProblem(data, id, at(4, 1, 701), at(3, 1, 701))).toBe(
      'Das Ende liegt vor dem Beginn.',
    );
    expect(sessionTimeProblem(data, id, at(4, 1, 701), NOW + 60)).toBe(
      'Eine nachgetragene Session endet nicht in der Zukunft.',
    );
    expect(sessionTimeProblem(data, id, at(5, 1, 701), at(6, 1, 701, 12))).toContain('Session 2');
    expect(sessionTimeProblem(data, id, at(1, 1, 701, 8), at(2, 1, 701, 20))).toBe('');
  });

  it('setzt die Zeit, macht sie genau und ordnet die offenen Vorschläge neu ein', async () => {
    const { db, session } = await setup();
    const before: Session = session();
    const result = setSessionTime(db, before.id, at(1, 1, 701, 8), at(2, 1, 701, 20));
    if ('problem' in result) throw new Error(result.problem);
    expect(session()).toMatchObject({ startAt: at(1, 1, 701, 8), endAt: at(2, 1, 701, 20) });
    expect(session().source!.precision).toBe('exact');
    expect(session().reading!.proposals.every((p) => p.at <= at(2, 1, 701, 20))).toBe(true);
    result.undo();
    expect(session()).toMatchObject({ startAt: before.startAt, endAt: before.endAt });
  });
});

/** Ein späteres Schicksal für dieselbe Person – nach der Session, vor jetzt. */
function acceptLaterFate(db: CampaignDb, personId: string) {
  const result = recordEntry(db, {
    kind: 'fate',
    text: 'Er lebt wieder.',
    at: at(10, 1, 701),
    fate: { entityId: personId, status: 'alive' },
  });
  if ('problem' in result) throw new Error(result.problem);
  return result.entry;
}
