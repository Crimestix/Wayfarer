/**
 * Befehle der Chronik über mehrere Dokumente: einen Eintrag samt seiner Wirkung löschen und einen
 * Eintrag der neuen Arten so ändern, dass seine Wirkung mitzieht. Die Wirkung selbst rechnet
 * `data/record.ts`; hier wird nur entschieden, welcher Weg gilt.
 */
import type { CampaignDb } from '../../data/db';
import { recordEntries, recordEntry, removeRecorded, type RecordInput } from '../../data/record';
import { sameSort } from '../../domain/history';
import type { CampaignData, ChronicleEntry } from '../../domain/schema';
import { dropLootLine } from '../beute/actions';
import { createArticle } from '../wiki/actions';
import { flushEdits } from '../wiki/editing';
import { titleKey } from '../wiki/text';
import { lockedRefs } from './model';
import { draftOfEntry, kindOfFields, type RecordDraft, type RecordFieldsKind } from './recordDraft';

/** Arten, deren Bedeutung fest ist: Sie werden nur in Anmerkung, Zeit, Ort und Verweisen geändert. */
export const FIXED_KINDS = ['travel', 'attitude', 'event', 'trade'] as const;

export const isFixedKind = (kind: ChronicleEntry['kind']): boolean =>
  (FIXED_KINDS as readonly string[]).includes(kind);

/** Ist der Eintrag die Zeile einer Ausgabe im Beute-Buch? */
export const isLootLine = (data: CampaignData, entryId: string): boolean =>
  Object.values(data.loot).some((loot) => loot.given && loot.chronicleId === entryId);

/**
 * Löscht einen Eintrag samt seiner Wirkung, solange sie noch gilt (`removeRecorded`). Die Zeile
 * einer Ausgabe im Beute-Buch geht über `dropLootLine`: Die Beute liegt danach wieder bereit.
 * Gibt den Handgriff zurück, der alles zurücknimmt; null, wenn es den Eintrag nicht gibt.
 */
export function deleteRecorded(db: CampaignDb, entryId: string): (() => void) | null {
  if (!db.getSnapshot().chronicle[entryId]) return null;
  return dropLootLine(db, entryId) ?? removeRecorded(db, entryId);
}

/**
 * Muss eine Änderung die Wirkung neu anwenden? Ja, wenn sich die Art oder die Angaben der Art
 * ändern – und bei einem Spielerwunsch, der Ziel geworden ist, auch, wenn sich sein Text ändert.
 * Eine Abmachung wirkt nur auf sich selbst und wird immer nur geändert.
 */
export function revisionNeedsEffect(
  entry: ChronicleEntry,
  choice: RecordFieldsKind,
  draft: RecordDraft,
  text: string,
): boolean {
  if (isFixedKind(entry.kind)) return false;
  const kind = kindOfFields(choice);
  if (kind !== entry.kind) return true;
  if (kind === 'promise') return false;
  if (kind === 'wish' && entry.wish?.setGoal && text.trim() !== entry.text) return true;
  return JSON.stringify(draft) !== JSON.stringify(draftOfEntry(entry));
}

/**
 * Was sich an einem Eintrag ändert, wenn seine Wirkung bleibt: Text, Zeitpunkt, Ort, Session,
 * Verweise, Genauigkeit, „nur für die Spielleitung“ und bei einer Abmachung Frist und Stand. Die
 * Verweise, die zur Bedeutung gehören (`lockedRefs`), bleiben. Mit `keepDue` bleibt die Frist
 * einer Abmachung auf die Minute, wie sie war (das Feld zählt nur ganze Tage).
 */
export function revisionPatch(
  entry: ChronicleEntry,
  input: RecordInput,
  options: { keepDue?: boolean } = {},
): Partial<ChronicleEntry> {
  const change: Partial<ChronicleEntry> = {
    text: (input.text ?? '').trim(),
    refs: [...new Set([...lockedRefs(entry), ...(input.refs ?? [])])],
    secret: input.secret ?? entry.secret,
  };
  if (input.at !== undefined) change.at = input.at;
  if (input.placeId !== undefined) change.placeId = input.placeId;
  if (input.sessionId !== undefined) change.sessionId = input.sessionId;
  if (input.precision !== undefined) change.precision = input.precision;
  // Titel eines Schriftstücks und Tätigkeiten der Zwischenzeit wirken auf nichts außer sich selbst.
  if (entry.kind === 'writing' && input.writing)
    change.writing = {
      title: (input.writing.title ?? '').replace(/\s+/g, ' ').trim(),
      articleId: entry.writing?.articleId ?? null,
    };
  if (entry.kind === 'downtime' && input.downtime)
    change.downtime = {
      ...(entry.downtime?.minutes ? { minutes: entry.downtime.minutes } : {}),
      days: input.downtime.days,
      activities: (input.downtime.activities ?? [])
        .map((a) => ({ characterId: a.characterId, text: a.text.trim() }))
        .filter((a) => a.text),
    };
  if (entry.kind === 'promise' && input.promise) {
    const outcome = input.promise.outcome ?? 'open';
    const sort = input.promise.sort ?? entry.promise?.sort;
    change.promise = {
      due: options.keepDue ? (entry.promise?.due ?? null) : (input.promise.due ?? null),
      done: outcome !== 'open',
      failed: outcome === 'failed',
      ...(sort ? { sort } : {}),
    };
  }
  return change;
}

/**
 * Ändert einen Eintrag so, dass seine Wirkung mitzieht: Die alte Wirkung wird zurückgenommen
 * (`removeRecorded`), der Eintrag neu festgehalten (`recordEntry`) und behält dabei seine
 * Kennung – ein Ende eines Zustands, das auf ihn zeigt, bleibt gültig. Bei einem Widerspruch
 * bleibt alles, wie es war, und der Satz dazu kommt zurück; leer, wenn es geklappt hat.
 */
export function reviseRecorded(db: CampaignDb, entryId: string, input: RecordInput): string {
  const entry = db.getSnapshot().chronicle[entryId];
  if (!entry) return 'Diesen Eintrag gibt es nicht mehr.';
  if (isFixedKind(entry.kind) || isLootLine(db.getSnapshot(), entryId))
    return 'Bei diesem Eintrag lässt sich die Art nicht ändern.';
  return db.batch(() => {
    const undo = removeRecorded(db, entryId);
    if (!undo) return 'Bei diesem Eintrag lässt sich die Art nicht ändern.';
    const result = recordEntry(db, {
      ...input,
      backfilled: input.backfilled ?? entry.backfilled,
      storyId: input.storyId === undefined ? entry.storyId : input.storyId,
    });
    if ('problem' in result) {
      undo();
      return result.problem;
    }
    const fresh = db.getSnapshot().chronicle[result.entry.id]!;
    // Das Schriftstück bleibt der Artikel, als den es abgelegt wurde.
    if (fresh.writing && entry.writing?.articleId && !fresh.writing.articleId)
      fresh.writing = { ...fresh.writing, articleId: entry.writing.articleId };
    // Der Eintrag behält seinen Platz unter den Einträgen derselben Minute – außer, er stünde dann
    // vor einem Eintrag seiner Sorte, nach dem seine Wirkung eben berechnet wurde.
    const reorders = sameSort(db.getSnapshot(), fresh).some(
      (other) => other.id !== fresh.id && other.at === fresh.at && other.created > entry.created,
    );
    db.remove('chronicle', fresh.id);
    db.put('chronicle', {
      ...fresh,
      id: entry.id,
      created: reorders ? fresh.created : entry.created,
      // Angeheftet oder erledigt („Noch offen“) bleibt, was es war.
      loose: entry.loose,
      rev: Math.max(entry.rev, fresh.rev),
    });
    if (input.writing?.createArticle && !db.getSnapshot().chronicle[entry.id]?.writing?.articleId)
      fileWriting(db, entry.id);
    return '';
  });
}

// ── Schriftstücke ──────────────────────────────────────────────────────────

/** Der Ordner im Wiki, in den Schriftstücke als Artikel kommen. */
export const WRITINGS_FOLDER = 'Schriftstücke';

/**
 * Legt ein Schriftstück als Artikel an – mit seinem Titel und dem Text wörtlich – im Ordner
 * „Schriftstücke“ (der entsteht, wenn es ihn noch nicht gibt) und merkt sich den Artikel am
 * Eintrag. `undo` nimmt Artikel und Ordner wieder weg, solange sie niemand geändert hat. null,
 * wenn der Eintrag kein Schriftstück ist oder schon einen Artikel hat.
 */
export function fileWriting(db: CampaignDb, entryId: string): (() => void) | null {
  const entry = db.getSnapshot().chronicle[entryId];
  if (entry?.kind !== 'writing' || !entry.writing) return null;
  if (entry.writing.articleId && db.getSnapshot().articles[entry.writing.articleId]) return null;
  const title = entry.writing.title.trim() || firstWords(entry.text);
  if (!title) return null;
  flushEdits();
  return db.batch(() => {
    const articles = db.getSnapshot().articles;
    let folder = Object.values(articles).find(
      (a) => a.parentId === null && titleKey(a.title) === titleKey(WRITINGS_FOLDER),
    );
    const madeFolder = !folder;
    if (!folder) folder = createArticle(db, { title: WRITINGS_FOLDER }) ?? undefined;
    const article = createArticle(db, { title, parentId: folder?.id ?? null, text: entry.text });
    if (!article) return null;
    db.patch('chronicle', entryId, {
      writing: { ...entry.writing!, title, articleId: article.id },
    });
    const made = db.getSnapshot();
    const articleRev = made.articles[article.id]?.rev ?? null;
    const folderId = madeFolder ? (folder?.id ?? null) : null;
    const folderRev = folderId ? (made.articles[folderId]?.rev ?? null) : null;
    return () =>
      db.batch(() => {
        const now = db.getSnapshot();
        if (now.articles[article.id]?.rev === articleRev) db.remove('articles', article.id);
        const current = now.chronicle[entryId];
        if (current?.writing?.articleId === article.id)
          db.patch('chronicle', entryId, { writing: { ...current.writing, articleId: null } });
        const after = db.getSnapshot();
        const empty = !Object.values(after.articles).some((a) => a.parentId === folderId);
        if (folderId && empty && after.articles[folderId]?.rev === folderRev)
          db.remove('articles', folderId);
      });
  });
}

/** Die ersten Wörter eines Textes als Titel, wenn keiner gegeben ist. */
function firstWords(text: string): string {
  const line = text.trim().split('\n')[0]!.trim();
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}

/**
 * Hält fest wie `recordEntry` bzw. `recordEntries` – und legt danach jedes Schriftstück, das als
 * Artikel abgelegt werden soll (`writing.createArticle`), im Wiki an. Ein `undo` nimmt alles
 * zusammen zurück. So legen „Festhalten“, die Chronik und das Nachtragen Einträge an.
 */
export function recordFiled(
  db: CampaignDb,
  inputs: RecordInput[],
): { entries: ChronicleEntry[]; undo: () => void } | { problem: string } {
  if (!inputs.length) return { problem: 'Es gibt nichts festzuhalten.' };
  return db.batch(() => {
    const single = inputs.length === 1 ? recordEntry(db, inputs[0]!) : null;
    const result = single
      ? 'problem' in single
        ? single
        : { entries: [single.entry], undo: single.undo }
      : recordEntries(db, inputs);
    if ('problem' in result) return result;
    const undos: (() => void)[] = [];
    result.entries.forEach((entry, index) => {
      if (!inputs[index]?.writing?.createArticle) return;
      const undo = fileWriting(db, entry.id);
      if (undo) undos.push(undo);
    });
    const snapshot = db.getSnapshot();
    return {
      entries: result.entries.map((entry) => snapshot.chronicle[entry.id] ?? entry),
      undo: () =>
        db.batch(() => {
          for (const undo of [...undos].reverse()) undo();
          result.undo();
        }),
    };
  });
}

/** Der Spielstand ohne diesen Eintrag – um eine Änderung vorher zu prüfen. */
export function withoutEntry(data: CampaignData, entryId: string): CampaignData {
  if (!data.chronicle[entryId]) return data;
  const chronicle = { ...data.chronicle };
  delete chronicle[entryId];
  return { ...data, chronicle };
}
