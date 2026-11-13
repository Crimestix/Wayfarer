/** Handgriffe der Weltdatenbank, die mehr als ein Dokument ändern. */
import { deleteEntity, moveParty } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import { recordEntry } from '../../data/record';
import { entityName, linksTo } from '../../domain/derive';
import { holderWord } from '../../domain/itemHistory';
import { DERIVED_FAMILY_TAG, describePlan, planFamilies } from './dynasty';
import {
  COLLECTION_NAMES,
  createEntity,
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

export interface FamilyAdoption {
  /** Ein Satz für die Meldung: „Familie Venn angelegt (2 Mitglieder)“. */
  text: string;
  /** Kennung der ersten angelegten Familie – zum Hinspringen. */
  familyId: string | null;
  /** Nimmt alles zurück, was seither niemand angefasst hat. */
  undo: () => void;
}

/**
 * Ordnet Personen der Familie zu, die ihr Nachname nahelegt, und legt fehlende Familien an.
 * Ohne Angabe gilt das für alle Personen. Gibt null zurück, wenn nichts zu tun war.
 */
export function adoptFamilies(
  db: CampaignDb,
  personIds?: readonly string[],
  minMembers = 1,
): FamilyAdoption | null {
  const data = db.getSnapshot();
  const plan = planFamilies(data, personIds, minMembers);
  if (!plan.create.length && !plan.join.length) return null;
  const text = describePlan(data, plan);
  const families: string[] = [];
  const relations: string[] = [];
  const member = (personId: string, familyId: string) =>
    relations.push(
      db.put('relations', createRelation({ from: personId, to: familyId, type: 'member' })).id,
    );
  db.batch(() => {
    for (const planned of plan.create) {
      const family = db.put(
        'entities',
        createEntity({ kind: 'family', name: planned.name, tags: [DERIVED_FAMILY_TAG] }),
      );
      families.push(family.id);
      for (const personId of planned.personIds) member(personId, family.id);
    }
    for (const { personId, familyId } of plan.join) member(personId, familyId);
  });
  return {
    text,
    familyId: families[0] ?? null,
    undo: () =>
      db.batch(() => {
        const now = db.getSnapshot();
        for (const id of relations) if (now.relations[id]?.rev === 1) db.remove('relations', id);
        for (const id of families) {
          const family = db.getSnapshot().entities[id];
          const used = Object.values(db.getSnapshot().relations).some(
            (r) => r.from === id || r.to === id,
          );
          if (family?.rev === 1 && !used) db.remove('entities', id);
        }
      }),
  };
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
  db.batch(() => {
    const saved = db.put('entities', {
      ...current,
      [key]: { ...(current[key] as object), ...change },
    } as Entity);
    noteHolderChange(db, current, saved);
  });
}

/**
 * Führt ein Gegenstand seinen Lebenslauf und hat der Spielleiter eben seinen Besitzer geändert,
 * steht das jetzt als Veränderung in der Chronik: „Kompass ist jetzt bei Mira“ – mit dem
 * Gegenstand und dem neuen Besitzer, am Ort der Gruppe. Ohne Lebenslauf geschieht nichts.
 * Aufrufen, nachdem der neue Stand gespeichert ist (`before` = der Stand davor).
 */
export function noteHolderChange(
  db: CampaignDb,
  before: Entity | undefined,
  after: Entity,
): ChronicleEntry | null {
  if (after.kind !== 'item' || !after.item.history) return null;
  if (before?.kind !== 'item') return null;
  const from = before.item.holderId;
  const to = after.item.holderId;
  if (from === to) return null;
  const data = db.getSnapshot();
  const result = recordEntry(db, {
    kind: 'change',
    text: to
      ? `${after.name} ist jetzt ${holderWord(data, to)} ${entityName(data, to)}`
      : `Verbleib von ${after.name} ist jetzt unbekannt`,
    holder: { itemId: after.id, holderId: to, before: from },
    // Ob die Gruppe davon weiß, sagt nur der Spielleiter: sonst stünde es im Spielerbuch.
    secret: true,
  });
  return 'entry' in result ? result.entry : null;
}

type DetailsOf<E extends Entity> = E extends { kind: infer K }
  ? K extends keyof E
    ? E[K]
    : never
  : never;
