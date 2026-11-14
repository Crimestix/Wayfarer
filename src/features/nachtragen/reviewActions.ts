/**
 * Befehle beim Prüfen einer nachgetragenen Session: Vorschläge annehmen (einzeln oder alle
 * sicheren), verwerfen, zurücknehmen; Fragen zu Namen beantworten; die Weltzeit der Session
 * setzen. Angenommen wird über `recordFiled` (Chronik, nachgetragen, mit der Genauigkeit des
 * Vorschlags), Beute über `giveLootAt`, Fäden über `saveThread`, Artikel nur über `savePageText`
 * – und dort nur die Zeile im Steckbrief und der Punkt unter „Was geschah“. Was ein Vorschlag
 * angelegt und geändert hat, steht an ihm (`created`, `edits`): So lässt er sich auch nach einem
 * Neustart zurücknehmen.
 */
import type { CampaignDb } from '../../data/db';
import { effectHolds } from '../../data/record';
import {
  type CampaignData,
  type EntityKind,
  type ReadProposal,
  type Session,
  type SessionReading,
} from '../../domain/schema';
import { threadByTitle } from '../../domain/looseThreads';
import type { WorldTime } from '../../domain/time/calendar';
import { giveLootAt, removeLoot } from '../beute/actions';
import { WRITINGS_FOLDER, deleteRecorded, recordFiled } from '../chronik/actions';
import { removeThread, saveThread } from '../faeden/actions';
import { createNamedEntity, savePageText } from '../wiki/actions';
import { flushEdits } from '../wiki/editing';
import { addHappenedLine, removeHappenedLine, setFactLine, unsetFactLine } from '../wiki/factLines';
import { pageText, titleKey } from '../wiki/text';
import { foldName } from '../../domain/readNames';
import { storeReading } from './readActions';
import {
  articleTarget,
  happenedText,
  planAccept,
  sessionTimeProblem,
  type AcceptPlan,
  type ProposalChange,
} from './review';

type Created = ReadProposal['created'][number];
type Edit = ReadProposal['edits'][number];

// ── Artikel ────────────────────────────────────────────────────────────────

/** Ändert den Text der ersten Seite eines Artikels. false, wenn sich nichts geändert hat. */
function editArticle(db: CampaignDb, articleId: string, change: (text: string) => string): boolean {
  const data = db.getSnapshot();
  const article = data.articles[articleId];
  const doc = article?.docs.find((d) => d.kind === 'page');
  if (!article || !doc) return false;
  const text = pageText(data.articles, article, doc);
  const next = change(text);
  if (next === text) return false;
  savePageText(db, articleId, doc.id, next);
  return true;
}

/** Nimmt die Änderungen an Artikeln und zweiten Namen zurück – soweit sie noch so dastehen. */
function revertEdits(db: CampaignDb, edits: readonly Edit[]): void {
  for (const edit of [...edits].reverse()) {
    if (edit.kind === 'fact')
      editArticle(db, edit.targetId, (text) =>
        unsetFactLine(text, { line: edit.line, before: edit.before, made: edit.made }),
      );
    else if (edit.kind === 'happened')
      editArticle(db, edit.targetId, (text) =>
        removeHappenedLine(text, { line: edit.line, made: edit.made }),
      );
    else if (edit.kind === 'source') {
      // Die Session stand als Quelle an einem Faden, den es schon gab – sie geht wieder weg.
      const thread = db.getSnapshot().threads[edit.targetId];
      if (edit.made && thread?.sessionIds.includes(edit.line))
        db.patch('threads', thread.id, {
          sessionIds: thread.sessionIds.filter((id) => id !== edit.line),
        });
    } else if (edit.kind === 'alias') {
      const entity = db.getSnapshot().entities[edit.targetId];
      if (entity?.aliases.includes(edit.line))
        db.patch('entities', entity.id, {
          aliases: entity.aliases.filter((a) => a !== edit.line),
        });
    }
    // `story` merkt nur, an welche Geschichte ein neuer Faden kam (`undoAccepted`).
  }
}

/** Fügt einen zweiten Namen hinzu, wenn das Ding ihn noch nicht trägt. */
function addAlias(db: CampaignDb, entityId: string, name: string): boolean {
  const entity = db.getSnapshot().entities[entityId];
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!entity || !clean) return false;
  const known = [entity.name, ...entity.aliases].map(foldName);
  if (known.includes(foldName(clean))) return false;
  db.patch('entities', entityId, { aliases: [...entity.aliases, clean] });
  return true;
}

// ── Annehmen ───────────────────────────────────────────────────────────────

interface Applied {
  created: Created[];
  edits: Edit[];
  notes: string[];
}

const writingsFolderId = (db: CampaignDb): string | null =>
  Object.values(db.getSnapshot().articles).find(
    (a) => a.parentId === null && titleKey(a.title) === titleKey(WRITINGS_FOLDER),
  )?.id ?? null;

/** Steckbrief und „Was geschah“ nach dem Festhalten eines Vorschlags. */
function writeArticles(
  db: CampaignDb,
  session: Session,
  proposal: ReadProposal,
  plan: Extract<AcceptPlan, { kind: 'record' }>,
  entryId: string,
  into: Applied,
): void {
  const data = db.getSnapshot();
  const entry = data.chronicle[entryId];
  const input = plan.inputs[0];
  if (!entry || !input) return;
  for (const alias of plan.aliases)
    if (addAlias(db, alias.entityId, alias.name))
      into.edits.push({
        kind: 'alias',
        targetId: alias.entityId,
        line: alias.name.trim(),
        before: null,
        made: false,
      });
  if (!plan.checks.fact && !plan.checks.happened) return;
  const target = articleTarget(data, input);
  if (!target) return;
  const title = data.articles[target.articleId]?.title ?? '';
  if (plan.checks.fact && target.fact) {
    if (!effectHolds(data, entry))
      into.notes.push(
        `Der Steckbrief von „${title}“ bleibt: Ein späterer Eintrag bestimmt den heutigen Stand.`,
      );
    else {
      const fact = target.fact;
      let edit: Edit | null = null;
      editArticle(db, target.articleId, (text) => {
        const result = setFactLine(text, fact.kind, fact.field, fact.value);
        if (result.text !== text)
          edit = {
            kind: 'fact',
            targetId: target.articleId,
            line: result.line,
            before: result.before,
            made: result.made,
          };
        return result.text;
      });
      if (edit) into.edits.push(edit);
    }
  }
  if (plan.checks.happened) {
    const line = happenedText(
      data.campaign.calendar,
      session,
      entry.at,
      entry.precision,
      proposal.quote || proposal.text,
    );
    let edit: Edit | null = null;
    editArticle(db, target.articleId, (text) => {
      const result = addHappenedLine(text, line);
      if (result.added)
        edit = {
          kind: 'happened',
          targetId: target.articleId,
          line: result.line,
          before: null,
          made: result.made,
        };
      return result.text;
    });
    if (edit) into.edits.push(edit);
  }
}

/**
 * Schreibt Beute und Fäden; Einträge der Chronik kommen gesammelt über `recordAll`. Einen Faden,
 * den es mit demselben Satz schon gibt, legt es nicht noch einmal an: Die Session kommt bei ihm
 * als Quelle dazu (`source`). Ein neuer Faden weiß, aus welcher Session er stammt, und kommt
 * gleich an die gewählte Geschichte (`story`).
 */
function applyOther(
  db: CampaignDb,
  session: Session,
  plan: Exclude<AcceptPlan, { kind: 'record' }>,
): Applied | { problem: string } {
  if (plan.kind === 'loot') {
    const result = giveLootAt(db, plan.loot, plan.when);
    if ('problem' in result) return result;
    return { created: [{ collection: 'loot', id: result.loot.id }], edits: [], notes: [] };
  }
  const data = db.getSnapshot();
  const twin = threadByTitle(data, plan.thread.title);
  if (twin) {
    const made = !twin.sessionIds.includes(session.id);
    if (made) db.patch('threads', twin.id, { sessionIds: [...twin.sessionIds, session.id] });
    return {
      created: [],
      edits: [{ kind: 'source', targetId: twin.id, line: session.id, before: null, made }],
      notes: [`Den Faden „${twin.title}“ gibt es schon – es wurde kein zweiter angelegt.`],
    };
  }
  const storyId =
    plan.thread.storyId && data.stories[plan.thread.storyId] ? plan.thread.storyId : null;
  const thread = saveThread(db, {
    title: plan.thread.title,
    truth: '',
    state: 'open',
    storyId,
    refs: plan.thread.refs,
    known: true,
    hints: [],
    sessionIds: [session.id],
  });
  return {
    created: [{ collection: 'threads', id: thread.id }],
    edits: storyId
      ? [{ kind: 'story', targetId: thread.id, line: storyId, before: null, made: false }]
      : [],
    notes: [],
  };
}

interface Planned {
  proposal: ReadProposal;
  plan: AcceptPlan;
}

/**
 * Hält alle Einträge der Chronik in einem Zug fest (damit eine Folge von Ortswechseln zwischen
 * vorhandene passt), dann Artikel, Beute und Fäden. Alles oder nichts.
 */
function applyAll(
  db: CampaignDb,
  session: Session,
  planned: Planned[],
): Map<string, Applied> | { problem: string } {
  return db.batch(() => {
    const out = new Map<string, Applied>();
    const records = planned.filter(
      (p): p is Planned & { plan: Extract<AcceptPlan, { kind: 'record' }> } =>
        p.plan.kind === 'record',
    );
    const inputs = records.flatMap((r) => r.plan.inputs);
    const folderBefore = writingsFolderId(db);
    const undos: (() => void)[] = [];
    const fail = (problem: string) => {
      for (const undo of undos.reverse()) undo();
      return { problem };
    };
    if (inputs.length) {
      const result = recordFiled(db, inputs);
      if ('problem' in result) return { problem: result.problem };
      undos.push(result.undo);
      let index = 0;
      let folderGiven = false;
      for (const r of records) {
        const entries = result.entries.slice(index, index + r.plan.inputs.length);
        index += r.plan.inputs.length;
        const applied: Applied = {
          created: entries.map((e) => ({ collection: 'chronicle', id: e.id })),
          edits: [],
          notes: [],
        };
        for (const entry of entries) {
          const articleId = db.getSnapshot().chronicle[entry.id]?.writing?.articleId;
          if (!articleId) continue;
          applied.created.push({ collection: 'articles', id: articleId });
          const folder = writingsFolderId(db);
          if (!folderBefore && folder && !folderGiven) {
            applied.created.push({ collection: 'articles', id: folder });
            folderGiven = true;
          }
        }
        out.set(r.proposal.id, applied);
      }
    }
    for (const { proposal, plan } of planned) {
      if (plan.kind === 'record') continue;
      const applied = applyOther(db, session, plan);
      if ('problem' in applied) return fail(applied.problem);
      undos.push(() => {
        revertEdits(db, applied.edits);
        for (const made of applied.created)
          if (made.collection === 'loot') removeLoot(db, made.id);
          else if (made.collection === 'threads') removeThread(db, made.id);
      });
      out.set(proposal.id, applied);
    }
    // Artikel zuletzt, wenn alle Einträge stehen – damit „gilt heute“ stimmt.
    for (const r of records) {
      const applied = out.get(r.proposal.id)!;
      const first = applied.created.find((c) => c.collection === 'chronicle');
      if (first) writeArticles(db, session, r.proposal, r.plan, first.id, applied);
    }
    return out;
  });
}

function patchProposals(
  db: CampaignDb,
  sessionId: string,
  update: (p: ReadProposal) => ReadProposal,
): void {
  const session = db.getSnapshot().sessions[sessionId];
  if (!session?.reading) return;
  const reading: SessionReading = {
    ...session.reading,
    proposals: session.reading.proposals.map(update),
  };
  db.patch('sessions', sessionId, { reading });
}

export interface AcceptRequest {
  id: string;
  change?: ProposalChange;
}

export interface AcceptResult {
  /** Angenommene Vorschläge. */
  accepted: string[];
  /** Was sich nicht annehmen ließ – mit dem Grund. */
  failed: { id: string; problem: string }[];
  /** Hinweise, etwa ein Steckbrief, der bleibt. */
  notes: string[];
  /** Nimmt alles Angenommene zurück. */
  undo: () => void;
}

/**
 * Nimmt Vorschläge an. Zuerst alle zusammen; passt das nicht (etwa weil ein Ortswechsel nicht in
 * die Reihenfolge passt), einzeln – dann bleibt, was nicht ging, offen und nennt seinen Grund.
 */
export function acceptProposals(
  db: CampaignDb,
  sessionId: string,
  requests: readonly AcceptRequest[],
): AcceptResult {
  const nothing: AcceptResult = { accepted: [], failed: [], notes: [], undo: () => {} };
  const data = db.getSnapshot();
  const session = data.sessions[sessionId];
  if (!session?.reading) return nothing;
  flushEdits();
  const failed: AcceptResult['failed'] = [];
  const planned: Planned[] = [];
  for (const request of requests) {
    const proposal = session.reading.proposals.find((p) => p.id === request.id);
    if (!proposal || proposal.state === 'accepted') continue;
    const plan = planAccept(data, session, proposal, request.change);
    if ('problem' in plan) failed.push({ id: proposal.id, problem: plan.problem });
    else planned.push({ proposal, plan });
  }
  // In der Reihenfolge der Weltzeit: So bricht jeder Ortswechsel dort auf, wo der vorige hinführte.
  planned.sort((a, b) => a.proposal.at - b.proposal.at || a.proposal.from - b.proposal.from);

  const done = new Map<string, Applied>();
  db.batch(() => {
    const together = planned.length ? applyAll(db, session, planned) : new Map<string, Applied>();
    if (!('problem' in together)) for (const [id, applied] of together) done.set(id, applied);
    else if (planned.length === 1)
      failed.push({ id: planned[0]!.proposal.id, problem: together.problem });
    else
      for (const item of planned) {
        const one = applyAll(db, session, [item]);
        if ('problem' in one) failed.push({ id: item.proposal.id, problem: one.problem });
        else for (const [id, applied] of one) done.set(id, applied);
      }
    patchProposals(db, sessionId, (p) => {
      const applied = done.get(p.id);
      return applied
        ? { ...p, state: 'accepted', created: applied.created, edits: applied.edits }
        : p;
    });
  });
  const accepted = [...done.keys()];
  return {
    accepted,
    failed,
    notes: [...done.values()].flatMap((a) => a.notes),
    undo: () => void undoAccepted(db, sessionId, accepted),
  };
}

/** Nimmt einen Vorschlag an – mit den Änderungen aus „Ändern“ und den Häkchen. */
export function acceptProposal(
  db: CampaignDb,
  sessionId: string,
  id: string,
  change?: ProposalChange,
): { undo: () => void; notes: string[] } | { problem: string } {
  const result = acceptProposals(db, sessionId, [{ id, change }]);
  if (!result.accepted.length)
    return { problem: result.failed[0]?.problem ?? 'Der Vorschlag ließ sich nicht annehmen.' };
  return { undo: result.undo, notes: result.notes };
}

// ── Zurücknehmen und verwerfen ─────────────────────────────────────────────

/**
 * Die Sessions, deren angenommene Vorschläge einen Faden ebenfalls nennen – als Quelle (`source`)
 * oder weil sie ihn angelegt haben; ohne die Vorschläge, die gerade zurückgenommen werden
 * (`wanted`, in `sessionId`). Solange es eine gibt, nimmt das Zurücknehmen den Faden nicht weg.
 */
function otherSources(
  data: CampaignData,
  threadId: string,
  sessionId: string,
  wanted: ReadonlySet<string>,
): string[] {
  const found = new Set<string>();
  for (const session of Object.values(data.sessions))
    for (const proposal of session.reading?.proposals ?? []) {
      if (proposal.kind !== 'thread' || proposal.state !== 'accepted') continue;
      if (session.id === sessionId && wanted.has(proposal.id)) continue;
      const names =
        proposal.created.some((made) => made.collection === 'threads' && made.id === threadId) ||
        proposal.edits.some((edit) => edit.kind === 'source' && edit.targetId === threadId);
      if (names) found.add(session.id);
    }
  return [...found];
}

/**
 * Nimmt angenommene Vorschläge zurück: Einträge der Chronik samt Wirkung, Beute, Fäden und
 * Schriftstücke gehen wieder weg, Zeilen in Artikeln und zweite Namen auch – soweit sie noch so
 * dastehen, wie das Annehmen sie hinterließ. Was der Spielleiter seither weitergeschrieben hat
 * (ein Faden mit Hinweisen, ein geänderter Artikel), bleibt und wird genannt. Der Vorschlag ist
 * danach wieder offen.
 */
export function undoAccepted(
  db: CampaignDb,
  sessionId: string,
  ids: readonly string[],
): { notes: string[] } {
  const session = db.getSnapshot().sessions[sessionId];
  if (!session?.reading) return { notes: [] };
  flushEdits();
  const notes: string[] = [];
  const wanted = new Set(ids);
  const proposals = session.reading.proposals.filter(
    (p) => wanted.has(p.id) && p.state === 'accepted',
  );
  db.batch(() => {
    for (const proposal of [...proposals].reverse()) {
      revertEdits(db, proposal.edits);
      const entryTexts = proposal.created
        .filter((c) => c.collection === 'chronicle')
        .map((c) => db.getSnapshot().chronicle[c.id]?.text.trim() ?? '');
      // Erst Schriftstücke, dann ihr Ordner, dann der Rest.
      const articles = proposal.created.filter((c) => c.collection === 'articles');
      const isFolder = (id: string) =>
        titleKey(db.getSnapshot().articles[id]?.title ?? '') === titleKey(WRITINGS_FOLDER);
      for (const c of articles.filter((a) => !isFolder(a.id))) {
        const data = db.getSnapshot();
        const article = data.articles[c.id];
        const doc = article?.docs.find((d) => d.kind === 'page');
        if (!article || !doc) continue;
        const text = pageText(data.articles, article, doc).trim();
        if (entryTexts.includes(text) || text === proposal.text.trim()) db.remove('articles', c.id);
        else notes.push(`Der Artikel „${article.title}“ bleibt – du hast ihn seither geändert.`);
      }
      for (const c of articles.filter((a) => isFolder(a.id))) {
        const data = db.getSnapshot();
        const empty = !Object.values(data.articles).some((a) => a.parentId === c.id);
        const page = data.articles[c.id]?.docs.find((d) => d.kind === 'page');
        if (empty && !page?.text.trim()) db.remove('articles', c.id);
      }
      for (const c of [...proposal.created].reverse()) {
        if (c.collection === 'chronicle') deleteRecorded(db, c.id);
        else if (c.collection === 'loot') removeLoot(db, c.id);
        else if (c.collection === 'threads') {
          const thread = db.getSnapshot().threads[c.id];
          if (!thread) continue;
          // Weitergeschrieben: Hinweise, Wahrheit, an eine (andere) Geschichte gehängt, ins
          // Spiel genommen oder sein Stand geändert – dann bleibt er.
          const givenStory =
            proposal.edits.find((e) => e.kind === 'story' && e.targetId === c.id)?.line ?? null;
          const untouched =
            !thread.hints.length &&
            !thread.truth.trim() &&
            (thread.storyId === null || thread.storyId === givenStory) &&
            !thread.inPlay &&
            thread.state === 'open';
          // Steht er auch in den Notizen eines anderen Abends (oder ein zweites Mal in diesen),
          // bleibt er für den – nur diese Quelle geht weg.
          const others = otherSources(db.getSnapshot(), c.id, sessionId, wanted);
          if (others.length) {
            if (!others.includes(sessionId) && thread.sessionIds.includes(sessionId))
              db.patch('threads', thread.id, {
                sessionIds: thread.sessionIds.filter((id) => id !== sessionId),
              });
            notes.push(
              `Der Faden „${thread.title}“ bleibt – er steht auch in anderen Notizen, die du angenommen hast.`,
            );
          } else if (untouched) removeThread(db, c.id);
          else
            notes.push(
              `Der Faden „${thread.title}“ bleibt – du hast ihn seither weitergeschrieben.`,
            );
        }
      }
    }
    patchProposals(db, sessionId, (p) =>
      wanted.has(p.id) && p.state === 'accepted'
        ? { ...p, state: 'open', created: [], edits: [] }
        : p,
    );
  });
  return { notes };
}

/** „Stimmt nicht“: Der Vorschlag ist verworfen. `undo` macht ihn wieder offen. */
export function dismissProposal(db: CampaignDb, sessionId: string, id: string): () => void {
  patchProposals(db, sessionId, (p) =>
    p.id === id && p.state === 'open' ? { ...p, state: 'dismissed' } : p,
  );
  return () => reopenProposal(db, sessionId, id);
}

/** Ein verworfener Vorschlag ist wieder offen. */
export function reopenProposal(db: CampaignDb, sessionId: string, id: string): void {
  patchProposals(db, sessionId, (p) =>
    p.id === id && p.state === 'dismissed' ? { ...p, state: 'open' } : p,
  );
}

// ── Fragen zu Namen ────────────────────────────────────────────────────────

/** link: ein vorhandener Eintrag (der Name wird sein zweiter Name); create: neu anlegen; none: niemand Bestimmtes. */
export type QuestionAnswer = { link: string } | { create: EntityKind } | { none: true };

function setQuestion(
  db: CampaignDb,
  sessionId: string,
  key: string,
  state: 'open' | 'linked' | 'created' | 'none',
  entityId: string | null,
): void {
  const session = db.getSnapshot().sessions[sessionId];
  if (!session?.reading) return;
  db.patch('sessions', sessionId, {
    reading: {
      ...session.reading,
      questions: session.reading.questions.map((q) =>
        q.key === key ? { ...q, state, entityId } : q,
      ),
    },
  });
}

/**
 * Beantwortet „Wer oder was ist X?“. Ein vorhandener Eintrag bekommt X als zweiten Namen; ein
 * neuer entsteht nur, wenn der Spielleiter das wählt. Danach werden die Notizen neu gelesen,
 * damit die offenen Vorschläge den Namen kennen. `undo` nimmt die Antwort zurück.
 */
export function answerQuestion(
  db: CampaignDb,
  sessionId: string,
  key: string,
  answer: QuestionAnswer,
): { undo: () => void; entityId: string | null } | null {
  const session = db.getSnapshot().sessions[sessionId];
  const question = session?.reading?.questions.find((q) => q.key === key);
  if (!session || !question) return null;
  let undoEntity: () => void = () => {};
  let entityId: string | null = null;
  db.batch(() => {
    if ('link' in answer) {
      const entity = db.getSnapshot().entities[answer.link];
      if (!entity) return;
      entityId = entity.id;
      const name = question.name.replace(/\s+/g, ' ').trim();
      if (addAlias(db, entity.id, name))
        undoEntity = () => {
          const now = db.getSnapshot().entities[entity.id];
          if (now?.aliases.includes(name))
            db.patch('entities', now.id, { aliases: now.aliases.filter((a) => a !== name) });
        };
      setQuestion(db, sessionId, key, 'linked', entity.id);
    } else if ('create' in answer) {
      const made = createNamedEntity(db, question.name, answer.create, []);
      entityId = made.entity.id;
      undoEntity = made.undo;
      setQuestion(db, sessionId, key, 'created', made.entity.id);
    } else setQuestion(db, sessionId, key, 'none', null);
    if (!('none' in answer)) storeReading(db, sessionId);
  });
  return {
    entityId,
    undo: () =>
      db.batch(() => {
        undoEntity();
        setQuestion(db, sessionId, key, 'open', null);
        storeReading(db, sessionId);
      }),
  };
}

// ── Weltzeit der Session ───────────────────────────────────────────────────

/**
 * Setzt Beginn und Ende einer nachgetragenen Session – dann ist ihre Zeit bekannt, und die
 * offenen Vorschläge werden neu eingeordnet. Angenommene Einträge behalten ihre Zeit. Gibt das
 * Problem zurück oder `undo`.
 */
export function setSessionTime(
  db: CampaignDb,
  sessionId: string,
  startAt: WorldTime | null,
  endAt: WorldTime | null,
): { undo: () => void } | { problem: string } {
  const data = db.getSnapshot();
  const session = data.sessions[sessionId];
  if (!session) return { problem: 'Diese Session gibt es nicht mehr.' };
  const problem = sessionTimeProblem(data, sessionId, startAt, endAt);
  if (problem || startAt === null || endAt === null) return { problem };
  const before = { startAt: session.startAt, endAt: session.endAt, source: session.source };
  db.batch(() => {
    db.patch('sessions', sessionId, {
      startAt,
      endAt,
      source: session.source ? { ...session.source, precision: 'exact' } : null,
    });
    if (session.reading) storeReading(db, sessionId);
  });
  return {
    undo: () =>
      db.batch(() => {
        if (!db.getSnapshot().sessions[sessionId]) return;
        db.patch('sessions', sessionId, before);
        if (db.getSnapshot().sessions[sessionId]?.reading) storeReading(db, sessionId);
      }),
  };
}
