/**
 * Befehle rund um Fortbewegungsmittel (`mounts`): anlegen, ändern, entfernen, den Zustand setzen
 * und wählen, womit die Gruppe reist (`state.travelBy`). Die Rechnung steht in
 * `domain/mounts.ts`; Wege und Routen nehmen das Mittel über `partyTravel`.
 */
import type { CampaignDb } from '../../data/db';
import { createMount, type Mount, type MountCondition } from '../../domain/schema';

export type MeansInput = Partial<Omit<Mount, 'id' | 'rev' | 'created' | 'updated'>> & {
  name: string;
};

/** Legt ein Fortbewegungsmittel an oder ändert eines (`id`). Ohne Namen entsteht nichts. */
export function saveMeans(db: CampaignDb, input: MeansInput, id?: string): Mount | null {
  const name = input.name.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  const values = { ...input, name, notes: input.notes?.trim() ?? input.notes };
  const existing = id ? db.getSnapshot().mounts[id] : undefined;
  if (existing) return db.patch('mounts', existing.id, values);
  return db.put('mounts', createMount(values));
}

/**
 * Legt mehrere Fortbewegungsmittel auf einmal an – etwa nach einem Kauf. Gibt die neuen und was
 * sie wieder entfernt zurück.
 */
export function addMeans(
  db: CampaignDb,
  inputs: readonly MeansInput[],
): { mounts: Mount[]; undo: () => void } {
  const mounts = db.batch(() =>
    inputs.flatMap((input) => {
      const made = saveMeans(db, input);
      return made ? [made] : [];
    }),
  );
  return {
    mounts,
    undo: () =>
      db.batch(() => {
        for (const mount of mounts) removeMeans(db, mount.id);
      }),
  };
}

/**
 * Entfernt ein Fortbewegungsmittel. Reiste die Gruppe damit, geht sie danach zu Fuß. Gibt zurück,
 * was es wiederherstellt.
 */
export function removeMeans(db: CampaignDb, id: string): (() => void) | null {
  const mount = db.getSnapshot().mounts[id];
  if (!mount) return null;
  const riding = db.getSnapshot().state.travelBy === id;
  db.batch(() => {
    db.remove('mounts', id);
    if (riding) db.setState({ travelBy: null });
  });
  return () =>
    db.batch(() => {
      if (!db.getSnapshot().mounts[id]) db.put('mounts', { ...mount, rev: 0 });
      if (riding && db.getSnapshot().state.travelBy === null) db.setState({ travelBy: id });
    });
}

/** Setzt den Zustand: bereit, erschöpft, beschädigt. */
export function setMeansCondition(db: CampaignDb, id: string, condition: MountCondition): void {
  if (db.getSnapshot().mounts[id]) db.patch('mounts', id, { condition });
}

/** Womit die Gruppe reist: ein Mittel oder null (zu Fuß). */
export function travelWith(db: CampaignDb, id: string | null): void {
  const next = id && db.getSnapshot().mounts[id] ? id : null;
  if (db.getSnapshot().state.travelBy !== next) db.setState({ travelBy: next });
}
