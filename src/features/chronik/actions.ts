/**
 * Befehle der Chronik über mehrere Dokumente: einen Eintrag samt seiner Wirkung löschen und einen
 * Eintrag der neuen Arten so ändern, dass seine Wirkung mitzieht. Die Wirkung selbst rechnet
 * `data/record.ts`; hier wird nur entschieden, welcher Weg gilt.
 */
import type { CampaignDb } from '../../data/db';
import { recordEntry, removeRecorded, type RecordInput } from '../../data/record';
import { sameSort } from '../../domain/history';
import type { CampaignData, ChronicleEntry } from '../../domain/schema';
import { dropLootLine } from '../beute/actions';
import { lockedRefs } from './model';
import { draftOfEntry, type RecordDraft, type RecordFieldsKind } from './recordDraft';

/** Arten, deren Bedeutung fest ist: Sie werden nur in Anmerkung, Zeit, Ort und Verweisen geändert. */
export const FIXED_KINDS = ['travel', 'attitude', 'event'] as const;

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
  const kind = choice === 'repute' ? 'attitude' : choice;
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
  if (entry.kind === 'promise' && input.promise) {
    const outcome = input.promise.outcome ?? 'open';
    change.promise = {
      due: options.keepDue ? (entry.promise?.due ?? null) : (input.promise.due ?? null),
      done: outcome !== 'open',
      failed: outcome === 'failed',
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
      rev: Math.max(entry.rev, fresh.rev),
    });
    return '';
  });
}

/** Der Spielstand ohne diesen Eintrag – um eine Änderung vorher zu prüfen. */
export function withoutEntry(data: CampaignData, entryId: string): CampaignData {
  if (!data.chronicle[entryId]) return data;
  const chronicle = { ...data.chronicle };
  delete chronicle[entryId];
  return { ...data, chronicle };
}
