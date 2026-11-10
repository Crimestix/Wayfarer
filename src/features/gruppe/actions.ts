/** Befehle des Bereichs „Gefährten“. Alles, was mehrere Dokumente ändert, läuft hierüber. */
import { logEntry, setAttitude } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import { activeParty, entityName, findRelation } from '../../domain/derive';
import { createEntity, createRelation, type Character, type Relation } from '../../domain/schema';
import {
  clickExhaustionMark,
  longRestChanges,
  longRestText,
  toggleCondition,
  type DraftResult,
  type RestChange,
} from './model';

type Details = Character['character'];

function getCharacter(db: CampaignDb, id: string): Character | null {
  const entity = db.getSnapshot().entities[id];
  return entity?.kind === 'character' ? entity : null;
}

/** Ändert einzelne Spielwerte eines Gefährten. */
export function patchCharacter(db: CampaignDb, id: string, change: Partial<Details>): void {
  const current = getCharacter(db, id);
  if (!current) return;
  db.put('entities', { ...current, character: { ...current.character, ...change } });
}

/** Klick auf eine Erschöpfungsmarke. */
export function clickExhaustion(db: CampaignDb, id: string, mark: number): void {
  const current = getCharacter(db, id);
  if (!current) return;
  patchCharacter(db, id, { exhaustion: clickExhaustionMark(current.character.exhaustion, mark) });
}

export function toggleCharacterCondition(db: CampaignDb, id: string, name: string): void {
  const current = getCharacter(db, id);
  if (!current) return;
  patchCharacter(db, id, { conditions: toggleCondition(current.character.conditions, name) });
}

export interface PlaceChangeResult {
  /** Stellt den vorigen Aufenthaltsort wieder her und nimmt die Chroniknotiz zurück. */
  undo: () => void;
  text: string;
}

/**
 * Ein Gefährte trennt sich von der Gruppe (placeId) oder stößt wieder zu ihr (null).
 * Das steht als Notiz in der Chronik.
 */
export function moveCharacter(db: CampaignDb, id: string, placeId: string | null): PlaceChangeResult | null {
  const current = getCharacter(db, id);
  if (!current || current.character.placeId === placeId) return null;
  const before = current.character.placeId;
  const data = db.getSnapshot();
  const text = placeId
    ? `${current.name} ist abseits der Gruppe unterwegs: ${entityName(data, placeId)}.`
    : `${current.name} ist wieder bei der Gruppe.`;
  const entry = db.batch(() => {
    patchCharacter(db, id, { placeId });
    return logEntry(db, {
      text,
      refs: [id, placeId ?? before].filter((ref): ref is string => !!ref),
      placeId: placeId ?? data.state.placeId,
    });
  });
  return {
    text,
    undo: () =>
      db.batch(() => {
        patchCharacter(db, id, { placeId: before });
        db.remove('chronicle', entry.id);
      }),
  };
}

/** Legt einen Gefährten an (id = null) oder speichert die Eingaben des Dialogs. Gibt die ID zurück. */
export function saveCharacter(
  db: CampaignDb,
  id: string | null,
  value: NonNullable<DraftResult['value']>,
): string {
  const current = id ? getCharacter(db, id) : null;
  if (current) {
    db.put('entities', {
      ...current,
      name: value.name,
      tagline: value.tagline,
      image: value.image,
      character: value.character,
    });
    return current.id;
  }
  return db.put(
    'entities',
    createEntity({
      kind: 'character',
      name: value.name,
      tagline: value.tagline,
      image: value.image,
      character: value.character,
    }),
  ).id;
}

export interface LongRestResult {
  changes: RestChange[];
  text: string;
  undo: () => void;
}

/**
 * Schließt eine Lange Rast ab: senkt bei allen aktiven Gefährten die Erschöpfung um 1 und hält
 * das in der Chronik fest. Die Weltzeit bleibt, wie sie ist – die stellt die Weltleiste.
 */
export function completeLongRest(db: CampaignDb): LongRestResult {
  const changes = longRestChanges(activeParty(db.getSnapshot()));
  const text = longRestText(changes);
  const entry = db.batch(() => {
    for (const change of changes) patchCharacter(db, change.id, { exhaustion: change.after });
    return logEntry(db, { text, refs: changes.map((c) => c.id) });
  });
  return {
    changes,
    text,
    undo: () =>
      db.batch(() => {
        for (const change of changes) {
          // Nur zurücksetzen, was seit der Rast niemand von Hand geändert hat.
          if (getCharacter(db, change.id)?.character.exhaustion === change.after)
            patchCharacter(db, change.id, { exhaustion: change.before });
        }
        db.remove('chronicle', entry.id);
      }),
  };
}

export interface BondInput {
  /** Von wem die Beziehung ausgeht (Person, Fraktion …). */
  fromId: string;
  /** Der Gefährte, auf den sie sich richtet. */
  characterId: string;
  type: string;
  label: string;
  attitude: number | null;
  note: string;
  secret: boolean;
  ended: boolean;
}

/**
 * Legt die Beziehung eines Eintrags zu einem Gefährten an oder ändert sie. Eine neue oder
 * geänderte Haltung steht – wie überall – in der Chronik.
 */
export function saveBond(db: CampaignDb, input: BondInput): Relation {
  const existing = findRelation(db.getSnapshot(), input.fromId, input.characterId);
  const fields = {
    type: input.type,
    label: input.type === 'custom' ? input.label.trim() : '',
    note: input.note.trim(),
    secret: input.secret,
    ended: input.ended,
  };
  return db.batch(() => {
    if ((existing?.attitude ?? null) !== input.attitude) {
      const relation = setAttitude(db, input.fromId, input.characterId, input.attitude);
      return db.patch('relations', relation.id, fields);
    }
    if (existing) return db.patch('relations', existing.id, fields);
    return db.put(
      'relations',
      createRelation({ from: input.fromId, to: input.characterId, attitude: input.attitude, ...fields }),
    );
  });
}

export function removeBond(db: CampaignDb, relationId: string): void {
  db.remove('relations', relationId);
}
