/**
 * Würfeltabellen der Erzeuger ändern (Einstellungen → Würfeltabellen). Geschrieben wird die
 * eigene Tabelle des Spielleiters für einen Platz – Zeile für Zeile, wie sie in der Tabelle steht;
 * gleicht sie wieder der Vorgabe, fällt sie weg. Eine leere Tabelle ist erlaubt – dann erzeugt
 * Wayfarer an diesem Platz nichts. Jede Änderung gibt `undo` zurück.
 */
import type { CampaignDb } from '../../data/db';
import { readTable, rowsOf, tableToText, type TableRow } from '../../domain/rollTable';
import { createRollTable, newId, type RollTable } from '../../domain/schema';
import { DEFAULT_TABLES } from './tables';

const ownOf = (db: CampaignDb, slot: string): RollTable | undefined =>
  Object.values(db.getSnapshot().tables).find(
    (table) => table.kind === 'generator' && table.slot === slot,
  );

/** Schreibt die Zeilen einer Tabelle (Text und Häufigkeit). */
export function saveGeneratorRows(
  db: CampaignDb,
  slot: string,
  entries: readonly { text: string; weight: number }[],
): () => void {
  const def = DEFAULT_TABLES.find((entry) => entry.slot === slot);
  const before = ownOf(db, slot);
  const restore = () => {
    const now = ownOf(db, slot);
    if (now) db.remove('tables', now.id);
    if (before) db.put('tables', { ...before, rev: 0 });
  };
  if (!def) return () => {};
  const rows: TableRow[] = rowsOf(entries);
  const fallback = readTable(def.name, def.entries.join('\n')).rows;
  if (tableToText(rows) === tableToText(fallback)) {
    if (before) db.remove('tables', before.id);
    return restore;
  }
  const stored = rows.map((row) => ({ id: newId(), ...row, refs: [] }));
  const die = Math.max(2, rows.length ? rows[rows.length - 1]!.max : 0);
  if (before) db.patch('tables', before.id, { entries: stored, die, name: def.name });
  else
    db.put(
      'tables',
      createRollTable({ name: def.name, kind: 'generator', slot, die, entries: stored }),
    );
  return restore;
}

/** Schreibt eine Tabelle aus Text: eine Zeile je Eintrag, „3×“ für häufiger. */
export function saveGeneratorTable(db: CampaignDb, slot: string, text: string): () => void {
  return saveGeneratorRows(
    db,
    slot,
    readTable('', text).rows.map((row) => ({ text: row.text, weight: row.max - row.min + 1 })),
  );
}

/** Nimmt die eigene Tabelle eines Platzes weg – es gilt wieder die Vorgabe. */
export function resetGeneratorTable(db: CampaignDb, slot: string): () => void {
  const before = ownOf(db, slot);
  if (before) db.remove('tables', before.id);
  return () => {
    if (before && !ownOf(db, slot)) db.put('tables', { ...before, rev: 0 });
  };
}
