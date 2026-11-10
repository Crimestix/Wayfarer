/** Handgriffe der Weltdatenbank, die mehr als ein Dokument ändern. */
import { deleteEntity, moveParty } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import { linksTo } from '../../domain/derive';
import {
  COLLECTION_NAMES,
  createRelation,
  type ChronicleEntry,
  type CollectionName,
  type CollectionTypes,
  type Entity,
  type Relation,
} from '../../domain/schema';

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
    const taken = Object.values(data.relations).some(
      (r) => r.from === relation.from && r.to === relation.to,
    );
    if (!taken) db.put('relations', relation);
  };
}

/**
 * Löscht einen Eintrag samt seiner Beziehungen (wie `deleteEntity`) und gibt eine Funktion
 * zurück, die das Löschen zurücknimmt: Der Eintrag, seine Beziehungen und alle Angaben, die
 * dabei bei anderen Einträgen geleert wurden, kommen wieder. Was seit dem Löschen von Hand
 * geändert wurde, bleibt unangetastet.
 */
export function deleteEntityUndoable(db: CampaignDb, entityId: string): () => void {
  const before = db.getSnapshot();
  deleteEntity(db, entityId);
  const after = db.getSnapshot();
  const restore = <C extends CollectionName>(name: C) => {
    const was = before[name] as Readonly<Record<string, CollectionTypes[C]>>;
    const became = after[name] as Readonly<Record<string, CollectionTypes[C]>>;
    for (const doc of Object.values(was)) {
      if (became[doc.id] === doc) continue;
      const current = (db.getSnapshot()[name] as Readonly<Record<string, CollectionTypes[C]>>)[
        doc.id
      ];
      // Nur zurückdrehen, was noch so dasteht, wie das Löschen es hinterlassen hat.
      if (current !== became[doc.id]) continue;
      db.put(name, { ...doc, rev: Math.max(doc.rev, current?.rev ?? 0) });
    }
  };
  return () =>
    db.batch(() => {
      for (const name of COLLECTION_NAMES) restore(name);
      if (
        before.state.placeId !== after.state.placeId &&
        db.getSnapshot().state.placeId === after.state.placeId
      )
        db.setState({ placeId: before.state.placeId });
    });
}

/** Ändert einzelne Felder eines Eintrags, sofern es ihn noch gibt. Gibt zurück, ob gespeichert wurde. */
export function patchEntityIfPresent(
  db: CampaignDb,
  entityId: string,
  change: Partial<Pick<Entity, 'notes' | 'secret'>>,
): boolean {
  if (!db.getSnapshot().entities[entityId]) return false;
  db.patch('entities', entityId, change);
  return true;
}

/**
 * Räumt Orte wieder weg, die in einem Dialog über „neu anlegen“ entstanden sind, aber am Ende
 * nicht verwendet werden. Entfernt nur, was seither niemand angefasst hat und worauf nichts
 * verweist. Gibt die entfernten Einträge zurück, damit man sie wiederherstellen kann.
 */
export function discardUnusedDrafts(
  db: CampaignDb,
  createdIds: string[],
  keep: string[],
): Entity[] {
  const data = db.getSnapshot();
  const removed: Entity[] = [];
  db.batch(() => {
    for (const id of createdIds) {
      const entity = data.entities[id];
      if (!entity || keep.includes(id) || entity.rev > 1 || isReferenced(db, id)) continue;
      db.remove('entities', id);
      removed.push(entity);
    }
  });
  return removed;
}

function isReferenced(db: CampaignDb, id: string): boolean {
  const data = db.getSnapshot();
  if (data.state.placeId === id) return true;
  for (const other of Object.values(data.entities))
    if (other.id !== id && linksTo(other, id)) return true;
  return (
    Object.values(data.relations).some((r) => r.from === id || r.to === id) ||
    Object.values(data.chronicle).some((e) => e.placeId === id || e.refs.includes(id)) ||
    Object.values(data.events).some((e) => e.placeId === id || e.refs.includes(id))
  );
}

/**
 * Gleicht die Beziehungen einer Art ab, die von `fromId` ausgehen – etwa die Sprachen einer
 * Person („spricht“). Fehlende werden angelegt, nicht mehr gewählte entfernt; nur Beziehungen
 * dieser Art zu Einträgen der genannten Arten sind betroffen, alles andere bleibt unangetastet.
 */
export function syncLinkedRelations(
  db: CampaignDb,
  fromId: string,
  type: string,
  targetKinds: readonly Entity['kind'][],
  targetIds: readonly string[],
): void {
  const data = db.getSnapshot();
  const wanted = new Set(targetIds.filter((id) => targetKinds.includes(data.entities[id]?.kind!)));
  db.batch(() => {
    const present = new Set<string>();
    for (const relation of Object.values(data.relations)) {
      if (relation.from !== fromId || relation.type !== type) continue;
      const target = data.entities[relation.to];
      if (!target || !targetKinds.includes(target.kind)) continue;
      if (wanted.has(relation.to)) present.add(relation.to);
      else db.remove('relations', relation.id);
    }
    for (const id of wanted) {
      if (present.has(id)) continue;
      // Gibt es zwischen beiden schon eine Beziehung anderer Art, bekommt sie die neue Art nicht
      // übergestülpt; eine zweite in dieselbe Richtung legt Wayfarer nicht an.
      const other = Object.values(db.getSnapshot().relations).find(
        (r) => r.from === fromId && r.to === id,
      );
      if (other) continue;
      db.put('relations', createRelation({ from: fromId, to: id, type }));
    }
  });
}

/**
 * Ändert die Felder, die zur Art des Eintrags gehören (z. B. Aufenthaltsort einer Person).
 * Geht vom gespeicherten Stand aus, nicht vom gezeigten: So geht keine Änderung verloren, die
 * inzwischen hinzukam, und ein gelöschter Eintrag entsteht nicht neu.
 */
export function patchDetails<E extends Entity>(
  db: CampaignDb,
  entity: E,
  change: Partial<DetailsOf<E>>,
): void {
  const current = db.getSnapshot().entities[entity.id];
  if (!current || current.kind !== entity.kind) return;
  const key = current.kind as keyof Entity;
  db.put('entities', {
    ...current,
    [key]: { ...(current[key] as object), ...change },
  } as Entity);
}

type DetailsOf<E extends Entity> = E extends { kind: infer K }
  ? K extends keyof E
    ? E[K]
    : never
  : never;
