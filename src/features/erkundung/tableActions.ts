/**
 * Würfeltabellen der Erzeuger ändern (Einstellungen → Würfeltabellen). Geschrieben wird die
 * eigene Tabelle des Spielleiters für einen Platz; gleicht sie wieder der Vorgabe, fällt sie weg.
 * Eine leere Tabelle ist erlaubt – dann erzeugt Wayfarer an diesem Platz nichts.
 */
import type { CampaignDb } from '../../data/db';
import { readTable, tableToText } from '../../domain/rollTable';
import { createRollTable, newId, type RollTable } from '../../domain/schema';
import { DEFAULT_TABLES } from './tables';

const ownOf = (db: CampaignDb, slot: string): RollTable | undefined =>
  Object.values(db.getSnapshot().tables).find(
    (table) => table.kind === 'generator' && table.slot === slot,
  );

/** Schreibt die Tabelle eines Platzes aus Text: eine Zeile je Eintrag. Gibt `undo` zurück. */
export function saveGeneratorTable(db: CampaignDb, slot: string, text: string): () => void {
  const def = DEFAULT_TABLES.find((entry) => entry.slot === slot);
  const before = ownOf(db, slot);
  const restore = () => {
    const now = ownOf(db, slot);
    if (now) db.remove('tables', now.id);
    if (before) db.put('tables', { ...before, rev: 0 });
  };
  if (!def) return () => {};
  const read = readTable(def.name, text);
  if (tableToText(read.rows) === tableToText(readTable(def.name, def.entries.join('\n')).rows)) {
    if (before) db.remove('tables', before.id);
    return restore;
  }
  const entries = read.rows.map((row) => ({ id: newId(), ...row, refs: [] }));
  const die = Math.max(2, read.die);
  if (before) db.patch('tables', before.id, { entries, die, name: def.name });
  else db.put('tables', createRollTable({ name: def.name, kind: 'generator', slot, die, entries }));
  return restore;
}

/** Nimmt die eigene Tabelle eines Platzes weg – es gilt wieder die Vorgabe. */
export function resetGeneratorTable(db: CampaignDb, slot: string): () => void {
  const before = ownOf(db, slot);
  if (before) db.remove('tables', before.id);
  return () => {
    if (before && !ownOf(db, slot)) db.put('tables', { ...before, rev: 0 });
  };
}
