/**
 * Eigene Kategorien anlegen, umbenennen, entfernen und Einträgen zuweisen (`domain/ownKind.ts`).
 * Alles mit Rückgängig. Eine Kategorie zu entfernen löscht nie einen Eintrag – er steht danach
 * wieder nur unter der Kategorie, wie die sie sich verhielt.
 */
import type { CampaignDb } from '../../data/db';
import { ownKindById, ownKindNamed, type OwnKind } from '../../domain/ownKind';
import { newId, type Entity, type EntityKind } from '../../domain/schema';

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Legt eine eigene Kategorie an. Gibt es sie schon (gleicher Name, gleiche Grundkategorie), wird
 * die vorhandene genommen – nie zwei gleichen Namens.
 */
export function addOwnKind(
  db: CampaignDb,
  input: { name: string; plural?: string; base: EntityKind },
): { own: OwnKind; created: boolean; undo: () => void } | null {
  const name = clean(input.name);
  if (!name) return null;
  const data = db.getSnapshot();
  const existing = ownKindNamed(data, input.base, name);
  if (existing) return { own: existing, created: false, undo: () => undefined };
  const own: OwnKind = { id: newId(), name, plural: clean(input.plural ?? ''), base: input.base };
  db.setCampaign({ ownKinds: [...data.campaign.ownKinds, own] });
  return {
    own,
    created: true,
    undo: () => {
      const now = db.getSnapshot();
      db.batch(() => {
        for (const entity of Object.values(now.entities))
          if (entity.ownKindId === own.id) db.put('entities', { ...entity, ownKindId: null });
        db.setCampaign({ ownKinds: now.campaign.ownKinds.filter((kind) => kind.id !== own.id) });
      });
    },
  };
}

/** Ändert Name und Mehrzahl. Die Grundkategorie bleibt – an ihr hängt, was die Einträge können. */
export function patchOwnKind(
  db: CampaignDb,
  id: string,
  change: { name?: string; plural?: string },
): void {
  const data = db.getSnapshot();
  const own = ownKindById(data, id);
  if (!own) return;
  const name = change.name === undefined ? own.name : clean(change.name) || own.name;
  const plural = change.plural === undefined ? own.plural : clean(change.plural);
  if (name === own.name && plural === own.plural) return;
  db.setCampaign({
    ownKinds: data.campaign.ownKinds.map((kind) =>
      kind.id === id ? { ...kind, name, plural } : kind,
    ),
  });
}

/** Entfernt eine eigene Kategorie; ihre Einträge bleiben, nur ohne sie. Gibt `undo` zurück. */
export function removeOwnKind(db: CampaignDb, id: string): (() => void) | null {
  const data = db.getSnapshot();
  const own = ownKindById(data, id);
  if (!own) return null;
  const members = Object.values(data.entities).filter((entity) => entity.ownKindId === id);
  db.batch(() => {
    for (const entity of members) db.put('entities', { ...entity, ownKindId: null });
    db.setCampaign({ ownKinds: data.campaign.ownKinds.filter((kind) => kind.id !== id) });
  });
  return () =>
    db.batch(() => {
      const now = db.getSnapshot();
      if (!ownKindById(now, id)) db.setCampaign({ ownKinds: [...now.campaign.ownKinds, own] });
      for (const entity of members) {
        const current = now.entities[entity.id];
        if (current && current.kind === own.base && !current.ownKindId)
          db.put('entities', { ...current, ownKindId: id });
      }
    });
}

/**
 * Weist Einträgen eine eigene Kategorie zu (oder nimmt sie mit `null`). Nur Einträge, deren
 * Kategorie zur Grundkategorie passt. Gibt `undo` zurück.
 */
export function setOwnKind(
  db: CampaignDb,
  entityIds: readonly string[],
  ownId: string | null,
): () => void {
  const data = db.getSnapshot();
  const own = ownKindById(data, ownId);
  const before: Entity[] = [];
  db.batch(() => {
    for (const entityId of entityIds) {
      const entity = data.entities[entityId];
      if (!entity || entity.ownKindId === ownId) continue;
      if (own && entity.kind !== own.base) continue;
      before.push(entity);
      db.put('entities', { ...entity, ownKindId: own ? own.id : null });
    }
  });
  return () =>
    db.batch(() => {
      const now = db.getSnapshot();
      for (const entity of before) {
        const current = now.entities[entity.id];
        if (current) db.put('entities', { ...current, ownKindId: entity.ownKindId });
      }
    });
}

/**
 * Macht aus einem eigenen Wort eine eigene Kategorie („47 Orte heißen Stadt“): legt sie an und
 * weist ihr die genannten Einträge zu – das eigene Wort der Einträge bleibt stehen.
 */
export function ownKindFromWord(
  db: CampaignDb,
  input: { base: EntityKind; word: string; entityIds: readonly string[] },
): { own: OwnKind; undo: () => void } | null {
  return db.batch(() => {
    const added = addOwnKind(db, { name: input.word, base: input.base });
    if (!added) return null;
    const unset = setOwnKind(db, input.entityIds, added.own.id);
    return {
      own: added.own,
      undo: () => {
        unset();
        added.undo();
      },
    };
  });
}

/**
 * Was die Meldung nach dem Entfernen sagt – an einer Stelle, damit Kachel, Liste und Kacheln der
 * Unterkategorie dasselbe sagen.
 */
export function removedOwnKindText(name: string, count: number, basePlural: string) {
  return {
    title: `Unterkategorie „${name}“ entfernt`,
    body:
      count === 0
        ? 'Sie hatte keine Einträge.'
        : `${count === 1 ? 'Ihr Eintrag ist' : `Ihre ${count} Einträge sind`} geblieben – unter ${basePlural}.`,
  };
}
