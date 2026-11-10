/** Handgriffe der Weltdatenbank, die mehr als ein Dokument ändern. */
import { moveParty } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import type { ChronicleEntry, Entity, Relation } from '../../domain/schema';

export interface MoveResult {
  entry: ChronicleEntry;
  /** Nimmt den Ortswechsel samt Chronik-Eintrag zurück. */
  undo: () => void;
}

/** Die Gruppe wechselt an diesen Ort. Gibt null zurück, wenn sie schon dort ist. */
export function movePartyTo(db: CampaignDb, placeId: string): MoveResult | null {
  const before = db.getSnapshot().state.placeId;
  const entry = moveParty(db, placeId);
  if (!entry) return null;
  return {
    entry,
    undo: () =>
      db.batch(() => {
        // Nur zurücknehmen, wenn die Gruppe seither nicht schon weitergezogen ist.
        if (db.getSnapshot().state.placeId !== placeId) return;
        db.remove('chronicle', entry.id);
        db.setState({ placeId: before });
      }),
  };
}

/** Löscht eine Beziehung; `undo` stellt sie wieder her. */
export function removeRelation(db: CampaignDb, relation: Relation): () => void {
  db.remove('relations', relation.id);
  return () => {
    const data = db.getSnapshot();
    const taken = Object.values(data.relations).some((r) => r.from === relation.from && r.to === relation.to);
    if (!taken) db.put('relations', relation);
  };
}

/** Ändert die Felder, die zur Art des Eintrags gehören (z. B. Aufenthaltsort einer Person). */
export function patchDetails<E extends Entity>(db: CampaignDb, entity: E, change: Partial<DetailsOf<E>>): void {
  const key = entity.kind as keyof E;
  db.put('entities', { ...entity, [key]: { ...(entity[key] as object), ...change } } as Entity);
}

type DetailsOf<E extends Entity> = E extends { kind: infer K } ? (K extends keyof E ? E[K] : never) : never;
