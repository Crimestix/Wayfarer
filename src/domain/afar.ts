/**
 * Die drei Schichten eines Feldes (Wunsch des Spielleiters, 17. 11.: „Wie machen wir die Hexkarte
 * interessant für die Spieler?“ – „Allerdings darf nicht jedes Hex mit allem voll sein“):
 *
 * - **Von fern** (`hex.afar`): was man aus mehreren Feldern Entfernung sieht – ein Turm, eine
 *   Rauchsäule, kreisende Geier. Es zieht die Gruppe an; ob sie hingeht, entscheidet sie.
 * - **Beim Betreten**: Besonderheit, Ort, Vorbereitetes, von nebenan die Witterung (`senses.ts`).
 * - **Beim Durchsuchen** (`hex.hidden`): was man nur findet, wenn man sich die Zeit nimmt.
 *
 * Hier steht nur die Fernsicht. Wie weit man sieht, hängt am Feld der Gruppe: von Bergen weit, aus
 * dem Wald kaum. Unter der Erde gibt es keine Fernsicht – dort zählt, was man durch die Gänge
 * bemerkt.
 */
import { hexCenter, hexDistance, sameHex, type HexCoord } from './hex';
import type { Area, Hex, Terrain } from './schema';

/** So viele Felder weit sieht man etwas Hohes oder Weithin-Sichtbares, je nach eigenem Gelände. */
export const AFAR_RANGE: Record<Terrain, number> = {
  mountains: 6,
  hills: 4,
  grassland: 3,
  desert: 3,
  arctic: 3,
  water: 3,
  coast: 3,
  urban: 1,
  forest: 1,
  swamp: 1,
  underdark: 0,
};

const COMPASS = [
  'Osten',
  'Südosten',
  'Süden',
  'Südwesten',
  'Westen',
  'Nordwesten',
  'Norden',
  'Nordosten',
] as const;

/** Die Himmelsrichtung von einem Feld zum anderen: „Norden“, „Südwesten“ … */
export function bearing(from: HexCoord, to: HexCoord): string {
  const a = hexCenter(from);
  const b = hexCenter(to);
  // x nach Osten, y nach Süden: Winkel im Uhrzeigersinn ab Osten.
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const sector = Math.round(angle / (Math.PI / 4));
  return COMPASS[(sector + 8) % 8]!;
}

/** Wie weit man von einem Feld aus in die Ferne sieht (in Feldern). */
export function afarRange(hex: Pick<Hex, 'terrain' | 'exits'>): number {
  if (hex.exits !== null) return 0;
  return hex.terrain ? AFAR_RANGE[hex.terrain] : 3;
}

export interface Sighting {
  hex: Hex;
  /** Die Richtung: „Im Norden“. */
  where: string;
  /** Entfernung in Feldern. */
  distance: number;
  /** Was man sieht – der Wortlaut des Spielleiters. */
  text: string;
}

/**
 * Was die Gruppe von einem Feld aus in der Ferne sieht: jedes Feld mit „Von fern zu sehen“ in
 * Reichweite, ohne das eigene. Nach Entfernung, das Nächste zuerst.
 */
export function afarFrom(area: Pick<Area, 'hexes'>, at: HexCoord): Sighting[] {
  const here = area.hexes.find((hex) => sameHex(hex, at));
  if (!here) return [];
  const range = afarRange(here);
  if (range < 1) return [];
  const out: Sighting[] = [];
  for (const hex of area.hexes) {
    if (!hex.afar.trim() || hex.exits !== null || hex.level !== here.level) continue;
    const distance = hexDistance(here, hex);
    if (distance < 1 || distance > range) continue;
    out.push({ hex, where: `Im ${bearing(here, hex)}`, distance, text: hex.afar.trim() });
  }
  return out.sort((a, b) => a.distance - b.distance || a.text.localeCompare(b.text));
}

/** „Im Norden (2 Felder): Eine Rauchsäule“. */
export const sightingLine = (sight: Sighting): string =>
  `${sight.where}${sight.distance > 1 ? ` (${sight.distance} Felder)` : ''}: ${sight.text}`;

/**
 * Die Felder, deren Fernsicht die Gruppe von diesen Feldern aus zum ersten Mal hat – gemerkt in
 * `hex.sighted`, damit die Reise nur einmal dafür hält.
 */
export function newSightings(area: Pick<Area, 'hexes'>, from: readonly HexCoord[]): Sighting[] {
  const seen = new Map<Hex, Sighting>();
  for (const at of from)
    for (const sight of afarFrom(area, at))
      if (!sight.hex.sighted && !seen.has(sight.hex)) seen.set(sight.hex, sight);
  return [...seen.values()];
}

/** Die Felder mit `sighted`, die von diesen Feldern aus in Sicht kamen. */
export function markSighted(hexes: readonly Hex[], from: readonly HexCoord[]): Hex[] {
  const area = { hexes: [...hexes] };
  const keys = new Set(newSightings(area, from).map((sight) => sight.hex));
  return keys.size
    ? hexes.map((hex) => (keys.has(hex) ? { ...hex, sighted: true } : hex))
    : [...hexes];
}
