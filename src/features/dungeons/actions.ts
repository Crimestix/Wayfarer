/**
 * Befehle der Dungeons: anlegen, umbenennen, löschen, die Ebenen schreiben. Was sich an einer
 * Ebene ändert, rechnet `domain/dungeon.ts`; hier wird nur gespeichert.
 */
import type { CampaignDb } from '../../data/db';
import { addLevel, healStairs } from '../../domain/dungeon';
import { createDungeon, type Dungeon, type DungeonLevel } from '../../domain/schema';

/** Ein neuer Dungeon mit einer ersten, leeren Ebene. Ohne Namen entsteht nichts. */
export function newDungeon(db: CampaignDb, name: string): Dungeon | null {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const { dungeon } = addLevel({ levels: [] as DungeonLevel[] }, 'above');
  return db.put('dungeons', createDungeon({ name: clean, levels: dungeon.levels }));
}

export function patchDungeon(
  db: CampaignDb,
  id: string,
  change: Partial<Pick<Dungeon, 'name' | 'note' | 'cellFeet'>>,
): void {
  const dungeon = db.getSnapshot().dungeons[id];
  if (!dungeon) return;
  const name = change.name === undefined ? undefined : change.name.replace(/\s+/g, ' ').trim();
  if (name === '') return;
  db.patch('dungeons', id, { ...change, ...(name === undefined ? {} : { name }) });
}

/** Schreibt die Ebenen eines Dungeons; Etagenwechsel ohne Gegenstück verlieren dabei ihr Ziel. */
export function saveLevels(db: CampaignDb, id: string, levels: DungeonLevel[]): void {
  if (!db.getSnapshot().dungeons[id]) return;
  db.patch('dungeons', id, { levels: healStairs({ levels }).levels });
}

/** Löscht einen Dungeon. `undo` legt ihn wieder hin. */
export function removeDungeon(db: CampaignDb, id: string): (() => void) | null {
  const dungeon = db.getSnapshot().dungeons[id];
  if (!dungeon) return null;
  db.remove('dungeons', id);
  return () => {
    if (!db.getSnapshot().dungeons[id]) db.put('dungeons', dungeon);
  };
}
