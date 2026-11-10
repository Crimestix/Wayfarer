/** Befehle des Bereichs „Erkundung“. */
import type { CampaignDb } from '../../data/db';
import { freshSeed } from '../../domain/random';
import type { Area, Hex } from '../../domain/schema';
import { generateHexes, recognize, type GenerateInput } from './generate';

/** Ändert ein Feld einer Karte; fehlt die Karte oder das Feld, geschieht nichts. */
export function patchHex(
  db: CampaignDb,
  areaId: string,
  coord: { q: number; r: number },
  change: Partial<Omit<Hex, 'q' | 'r'>>,
): void {
  const area = db.getSnapshot().areas[areaId];
  if (!area) return;
  let found = false;
  const hexes = area.hexes.map((hex) => {
    if (hex.q !== coord.q || hex.r !== coord.r) return hex;
    found = true;
    return { ...hex, ...change };
  });
  if (found) db.patch('areas', areaId, { hexes });
}

/** Deckt alle Felder auf oder wieder zu; das Feld des Startortes bleibt immer entdeckt. */
export function setAllDiscovered(db: CampaignDb, areaId: string, discovered: boolean): void {
  const area = db.getSnapshot().areas[areaId];
  if (!area) return;
  db.patch('areas', areaId, {
    hexes: area.hexes.map((hex) => ({
      ...hex,
      discovered: discovered || (hex.placeId !== null && hex.placeId === area.fromId),
    })),
  });
}

/** Die Angaben, mit denen eine erzeugte Karte neu gebaut werden kann; null, wenn sie fehlen. */
export function rerollInput(
  db: CampaignDb,
  area: Area,
  seed: number = freshSeed(),
): GenerateInput | null {
  if (!area.fromId || !area.toId || !area.biome || !area.distanceKm) return null;
  const known = recognize(db.getSnapshot(), area.fromId, area.toId);
  return {
    fromId: area.fromId,
    toId: area.toId,
    distanceKm: area.distanceKm,
    biome: area.biome,
    hexKm: area.hexKm,
    seed,
    direction: known.direction,
    between: known.between,
  };
}

/**
 * Würfelt das Gelände einer erzeugten Karte neu. Name und Notizen bleiben; alles, was an den
 * Feldern eingetragen war, geht verloren – `undo` stellt den alten Stand wieder her.
 */
export function rerollArea(db: CampaignDb, areaId: string): (() => void) | null {
  const area = db.getSnapshot().areas[areaId];
  const input = area ? rerollInput(db, area) : null;
  if (!area || !input) return null;
  const { hexes } = generateHexes(input);
  db.patch('areas', areaId, { hexes, seed: input.seed });
  return () => {
    if (db.getSnapshot().areas[areaId])
      db.patch('areas', areaId, { hexes: area.hexes, seed: area.seed });
  };
}

/** Löscht eine Karte; `undo` holt sie zurück. */
export function removeArea(db: CampaignDb, areaId: string): (() => void) | null {
  const area = db.getSnapshot().areas[areaId];
  if (!area) return null;
  db.remove('areas', areaId);
  return () => {
    if (!db.getSnapshot().areas[areaId]) db.put('areas', { ...area, rev: 0 });
  };
}
