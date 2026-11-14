/**
 * Anlegen beim Schreiben: Die Welt wächst aus der Geschichte. Wo der Spielleiter einen Eintrag
 * wählt oder einen Namen schreibt, den es noch nicht gibt, entsteht ein Platzhalter – Name, Art,
 * höchstens ein Satz –, ohne die Seite zu verlassen. Fertig geschrieben wird später („Noch zu
 * schreiben“). Nie ein zweiter Eintrag für einen Namen: Gibt es ihn schon, wird er genommen.
 */
import type { CampaignDb } from '../../data/db';
import type { Entity, EntityKind, Prep, Story, Thread } from '../../domain/schema';
import { createNamedEntity } from '../wiki/actions';
import { flushEdits } from '../wiki/editing';
import { entryForTitle } from '../wiki/facts';

export interface WritingInput {
  name: string;
  kind: EntityKind;
  /** Ein Satz dazu – kann später kommen. */
  line?: string | undefined;
  /** Die Geschichte, bei deren Schreiben der Eintrag entsteht. */
  storyId?: string | null | undefined;
}

export interface WritingResult {
  entity: Entity;
  /** Gerade erst entstanden – sonst gab es den Namen schon. */
  created: boolean;
  /** Den Namen gab es schon, aber mit einer anderen Art als gewünscht. */
  otherKind: boolean;
  /**
   * Nimmt das Anlegen zurück – auch aus den Blättern, in die der Eintrag seither gewählt wurde.
   * Bei einem Eintrag, den es schon gab, geschieht nichts.
   */
  undo: () => void;
}

/**
 * Nimmt einen eben angelegten Eintrag aus den Blättern, in die er seither gewählt wurde: aus
 * Geschichten (Antreiber, Beteiligte, Ort eines Einstiegs oder einer Szene), ihren Uhren,
 * Fäden (Namen, „Wo?“ und „Wer weiß es?“ der Hinweise) und Abenden (Ort einer Szene). Sonst
 * bliebe dort nach „Rückgängig“ ein „Gelöschter Eintrag“ stehen. Der geschriebene Text bleibt.
 */
function takeFromSheets(db: CampaignDb, entityId: string): void {
  const data = db.getSnapshot();
  const other = (id: string) => id !== entityId;
  const placed = (list: readonly { placeId: string | null }[]) =>
    list.some((item) => item.placeId === entityId);
  const unplaced = <T extends { placeId: string | null }>(list: readonly T[]): T[] =>
    list.map((item) => (item.placeId === entityId ? { ...item, placeId: null } : item));
  for (const story of Object.values(data.stories)) {
    const change: Partial<Story> = {};
    if (story.ownerId === entityId) change.ownerId = null;
    if (story.refs.includes(entityId)) change.refs = story.refs.filter(other);
    if (story.roles[entityId])
      change.roles = Object.fromEntries(
        Object.entries(story.roles).filter(([id]) => id !== entityId),
      );
    if (placed(story.entries)) change.entries = unplaced(story.entries);
    if (placed(story.scenes)) change.scenes = unplaced(story.scenes);
    if (Object.keys(change).length) db.patch('stories', story.id, change);
  }
  // Die Uhr einer Geschichte gehört ihrem Antreiber.
  for (const clock of Object.values(data.clocks))
    if (clock.ownerId === entityId) db.patch('clocks', clock.id, { ownerId: null });
  for (const thread of Object.values(data.threads)) {
    const change: Partial<Thread> = {};
    if (thread.refs.includes(entityId)) change.refs = thread.refs.filter(other);
    if (thread.hints.some((hint) => hint.placeId === entityId || hint.sourceId === entityId))
      change.hints = thread.hints.map((hint) => ({
        ...hint,
        placeId: hint.placeId === entityId ? null : hint.placeId,
        sourceId: hint.sourceId === entityId ? null : hint.sourceId,
      }));
    if (Object.keys(change).length) db.patch('threads', thread.id, change);
  }
  for (const prep of Object.values(data.preps)) {
    const change: Partial<Prep> = {};
    if (placed(prep.scenes)) change.scenes = unplaced(prep.scenes);
    if (Object.keys(change).length) db.patch('preps', prep.id, change);
  }
}

/**
 * Nimmt den Eintrag dieses Namens oder legt ihn als Platzhalter an. Es gelten die Regeln der
 * Welt für Namen (`entryForTitle`): gleicher Name oder Zweitname, auch der Titel des Artikels –
 * nie ein ähnlicher. Ein Artikel dieses Titels ohne Eintrag wird der Text des neuen Eintrags
 * (`createNamedEntity`). null, wenn kein Name dasteht.
 */
export function addFromWriting(db: CampaignDb, input: WritingInput): WritingResult | null {
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  // Ein offener Editor speichert zuerst – sonst kennt die Welt seinen Titel noch nicht.
  flushEdits();
  const data = db.getSnapshot();
  const owner = entryForTitle(data, name);
  if (owner) {
    const entity = 'free' in owner ? owner.free : owner.taken;
    return { entity, created: false, otherKind: entity.kind !== input.kind, undo: () => {} };
  }
  const storyId = input.storyId && data.stories[input.storyId] ? input.storyId : null;
  const { entity, undo } = createNamedEntity(db, name, input.kind, [], {
    tagline: (input.line ?? '').replace(/\s+/g, ' ').trim(),
    stub: true,
    fromStoryId: storyId,
  });
  return {
    entity,
    created: true,
    otherKind: false,
    undo: () =>
      db.batch(() => {
        if (!db.getSnapshot().entities[entity.id]) return;
        takeFromSheets(db, entity.id);
        undo();
      }),
  };
}

/**
 * „Fertig – kein Platzhalter mehr“: Der Eintrag gilt als gewöhnlicher Eintrag, auch wenn noch
 * nichts weiter dasteht. Gibt `undo` zurück.
 */
export function finishStub(db: CampaignDb, entityId: string): () => void {
  const entity = db.getSnapshot().entities[entityId];
  if (!entity?.stub) return () => {};
  db.patch('entities', entityId, { stub: false });
  return () => {
    const now = db.getSnapshot().entities[entityId];
    if (now && !now.stub) db.patch('entities', entityId, { stub: true });
  };
}
