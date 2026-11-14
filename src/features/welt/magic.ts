/**
 * Befehle für magische Gegenstände: magisch machen, Angaben ändern, Ladungen verbrauchen und
 * auffrischen. Gerechnet wird in `domain/magicItem.ts`; hier wird nur geschrieben.
 */
import type { CampaignDb } from '../../data/db';
import { becomeMagic, rechargedCharges, stepCharges } from '../../domain/magicItem';
import type { Item, Magic } from '../../domain/schema';

const itemOf = (db: CampaignDb, itemId: string): Item | null => {
  const entity = db.getSnapshot().entities[itemId];
  return entity?.kind === 'item' ? entity : null;
};

function putMagic(db: CampaignDb, item: Item, magic: Magic | null) {
  db.put('entities', { ...item, item: { ...item.item, magic } });
}

/**
 * Macht einen Gegenstand magisch – oder wieder gewöhnlich. Eine Seltenheit aus einem älteren
 * Rezept zieht dabei in die Magie um, damit sie nur an einer Stelle steht. Gibt das Rückgängig
 * zurück; null, wenn sich nichts ändert.
 */
export function setMagical(db: CampaignDb, itemId: string, on: boolean): (() => void) | null {
  const before = itemOf(db, itemId);
  if (!before || on === (before.item.magic !== null)) return null;
  if (on) db.put('entities', { ...before, item: becomeMagic(before.item) });
  else putMagic(db, before, null);
  return () => {
    const now = itemOf(db, itemId);
    if (now)
      db.put('entities', {
        ...now,
        item: { ...now.item, magic: before.item.magic, recipe: before.item.recipe },
      });
  };
}

/** Ändert Angaben der Magie. */
export function patchMagic(db: CampaignDb, itemId: string, change: Partial<Magic>): void {
  const item = itemOf(db, itemId);
  if (!item?.item.magic) return;
  putMagic(db, item, { ...item.item.magic, ...change });
}

/** Eine Ladung mehr oder weniger – zur Weltzeit von jetzt. */
export function stepItemCharges(db: CampaignDb, itemId: string, delta: number): void {
  const item = itemOf(db, itemId);
  const charges = item?.item.magic?.charges;
  if (!item || !charges) return;
  const next = stepCharges(charges, delta, db.getSnapshot().state.now);
  if (next !== charges) putMagic(db, item, { ...item.item.magic!, charges: next });
}

/** Frischt auf: so viele Ladungen kommen zurück, höchstens bis zum Höchstwert. Gibt das Rückgängig zurück. */
export function rechargeItem(db: CampaignDb, itemId: string, gained: number): (() => void) | null {
  const item = itemOf(db, itemId);
  const charges = item?.item.magic?.charges;
  if (!item || !charges) return null;
  putMagic(db, item, { ...item.item.magic!, charges: rechargedCharges(charges, gained) });
  return () => {
    const now = itemOf(db, itemId);
    if (now?.item.magic) putMagic(db, now, { ...now.item.magic, charges });
  };
}

/** „Nicht jetzt“: Das Auffrischen wird erst beim nächsten Anlass (Morgengrauen, Rast) wieder angeboten. */
export function postponeRecharge(db: CampaignDb, itemId: string): void {
  const item = itemOf(db, itemId);
  const charges = item?.item.magic?.charges;
  if (!item || !charges) return;
  putMagic(db, item, {
    ...item.item.magic!,
    charges: { ...charges, spentAt: db.getSnapshot().state.now },
  });
}
