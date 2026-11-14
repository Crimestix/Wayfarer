/**
 * Anlegen beim Schreiben: Die Welt wächst aus der Geschichte. Wo der Spielleiter einen Eintrag
 * wählt oder einen Namen schreibt, den es noch nicht gibt, entsteht ein Platzhalter – Name, Art,
 * höchstens ein Satz –, ohne die Seite zu verlassen. Fertig geschrieben wird später („Noch zu
 * schreiben“). Nie ein zweiter Eintrag für einen Namen: Gibt es ihn schon, wird er genommen.
 */
import type { CampaignDb } from '../../data/db';
import type { Entity, EntityKind } from '../../domain/schema';
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
  /** Nimmt das Anlegen zurück. Bei einem Eintrag, den es schon gab, geschieht nichts. */
  undo: () => void;
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
  return { entity, created: true, otherKind: false, undo };
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
