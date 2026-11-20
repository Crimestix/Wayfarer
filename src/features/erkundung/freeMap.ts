/**
 * Freie Hexkarten und Hineinzoomen (Wunsch des Spielleiters, 17. 11. 2026: „Wayfarer muss dem
 * Spielleiter die Möglichkeit bieten, Karten in verschiedenen Maßstäben zu erstellen … Den
 * Maßstab kann er selbst anlegen. Wenn die Spieler in den Wald selbst kommen, kann er die
 * Hexkarte des Waldes erstellen und perfektionieren“).
 *
 * - `blankArea`: eine Karte ohne Start und Ziel – Breite und Höhe in Feldern, ein Maßstab, ein
 *   Gelände oder eine Landschaft als Grund. Gemalt wird danach von Hand.
 * - `zoomArea`: ein Feld einer Karte im Kleinen – eine feinere Karte, deren Felder Gelände,
 *   Landschaft und Gegend des Feldes darüber erben (am Rand die der Nachbarfelder). Sie merkt sich
 *   ihr Feld (`area.parent`); `zoomOf` findet sie wieder.
 *
 * Reine Rechnung, fest und wiederholbar.
 */
import { SOLID_ROCK } from '../../domain/hexKinds';
import { hexAt, hexCenter, hexDistance, sameHex, type HexCoord } from '../../domain/hex';
import { seedOf } from '../../domain/random';
import {
  AreaSchema,
  HexSchema,
  newId,
  nowIso,
  type Area,
  type Hex,
  type Landscape,
  type Terrain,
} from '../../domain/schema';
import { paintOfLandscape } from '../../domain/landscape';

/** Eine Meile in km – D&D rechnet Reisen in Meilen. */
export const MILE_KM = 1.609344;

/** Gängige Maßstäbe zur Wahl; jeder andere geht auch. */
export const SCALE_PRESETS: readonly { label: string; km: number }[] = [
  { label: '6 Meilen – Reise über Land', km: 6 * MILE_KM },
  { label: '1 Meile – eine Gegend', km: MILE_KM },
  { label: '100 Meter – ein Ort aus der Nähe', km: 0.1 },
];

/** Größte freie Karte, damit sie bedienbar bleibt. */
export const MAX_SIDE = 60;

/** Ein Maßstab in Worten: „6 Meilen je Feld“, „1,5 km je Feld“, „100 m je Feld“. */
export function scaleWords(hexKm: number): string {
  const miles = hexKm / MILE_KM;
  if (Math.abs(miles - Math.round(miles)) < 0.02 && miles >= 1)
    return `${Math.round(miles)} ${Math.round(miles) === 1 ? 'Meile' : 'Meilen'} je Feld`;
  if (hexKm < 1) return `${Math.round(hexKm * 1000)} m je Feld`;
  return `${hexKm.toLocaleString('de-DE', { maximumFractionDigits: 1 })} km je Feld`;
}

export interface BlankInput {
  name: string;
  cols: number;
  rows: number;
  hexKm: number;
  /** Der Grund: ein Gelände – oder eine Landschaft deiner Welt. */
  terrain: Terrain;
  landscape?: Landscape | null;
}

/** Eine freie Hexkarte: Breite × Höhe Felder (Spitze oben, Reihen versetzt), alle gleich. */
export function blankArea(input: BlankInput): Area {
  const cols = Math.max(1, Math.min(MAX_SIDE, Math.round(input.cols)));
  const rows = Math.max(1, Math.min(MAX_SIDE, Math.round(input.rows)));
  const ground = input.landscape
    ? paintOfLandscape(input.landscape)
    : {
        terrain: input.terrain,
        // Eine freie Karte unter der Erde beginnt als Fels: Gänge und Höhlen malt man hinein.
        kind: input.terrain === 'underdark' ? SOLID_ROCK : null,
        landscapeId: null,
      };
  const hexes: Hex[] = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++)
      hexes.push(
        HexSchema.parse({
          q: col - (row - (row & 1)) / 2,
          r: row,
          ...ground,
          discovered: false,
        }),
      );
  const stamp = nowIso();
  return AreaSchema.parse({
    id: newId(),
    created: stamp,
    updated: stamp,
    name: input.name.trim() || 'Neue Hexkarte',
    hexKm: input.hexKm,
    orientation: 'pointy',
    hexes,
    biome: ground.terrain,
  });
}

/** Die feinere Karte eines Feldes, wenn es sie schon gibt. */
export function zoomOf(
  areas: Readonly<Record<string, Area>>,
  areaId: string,
  at: HexCoord & { level?: number },
): Area | undefined {
  return Object.values(areas).find(
    (area) =>
      area.parent?.areaId === areaId &&
      area.parent.q === at.q &&
      area.parent.r === at.r &&
      area.parent.level === (at.level ?? 0),
  );
}

/** Wie viel feiner die Karte darunter ist: aus 6 Meilen wird 1 Meile, aus 1 Meile 100 m. */
export function zoomFactor(hexKm: number): number {
  return hexKm > 3 ? 6 : hexKm > 0.4 ? 8 : 5;
}

/**
 * Ein Feld im Kleinen: eine Karte, die das Feld ganz abdeckt und an jedem Rand ein Stück der
 * Nachbarn zeigt. Jedes feine Feld erbt Gelände, Art, Landschaft und Gegend des groben Feldes,
 * in dem seine Mitte liegt; Orte, Wege, Vorbereitetes erbt es nicht – das schreibt der Spielleiter.
 * Ein Ort auf dem groben Feld steht auf dem mittleren feinen.
 */
export function zoomArea(
  parent: Area,
  at: HexCoord & { level?: number },
  factor?: number,
): Area | null {
  const level = at.level ?? 0;
  const origin = parent.hexes.find((hex) => sameHex(hex, { ...at, level }));
  if (!origin) return null;
  const k = factor ?? zoomFactor(parent.hexKm);
  const childKm = parent.hexKm / k;
  const orientation = parent.orientation;
  const center = hexCenter(origin, orientation);
  // Halbmesser in feinen Feldern: das grobe Feld und ein Saum der Nachbarn.
  const radius = Math.ceil(k * 0.75);
  const byKey = new Map(
    parent.hexes.filter((hex) => hex.level === level).map((hex) => [`${hex.q},${hex.r}`, hex]),
  );
  const hexes: Hex[] = [];
  for (let q = -radius; q <= radius; q++)
    for (let r = -radius; r <= radius; r++) {
      const fine = { q, r };
      if (hexDistance(fine, { q: 0, r: 0 }) > radius) continue;
      // Wo die Mitte des feinen Feldes auf der groben Karte liegt.
      const offset = hexCenter(fine, orientation);
      const coarse = hexAt(center.x + offset.x / k, center.y + offset.y / k, orientation);
      const under = byKey.get(`${coarse.q},${coarse.r}`);
      if (!under) continue;
      hexes.push(
        HexSchema.parse({
          q,
          r,
          terrain: under.terrain,
          kind: under.kind,
          landscapeId: under.landscapeId ?? null,
          regionId: under.regionId,
          placeId: q === 0 && r === 0 ? origin.placeId : null,
          discovered: false,
        }),
      );
    }
  const stamp = nowIso();
  return AreaSchema.parse({
    id: newId(),
    created: stamp,
    updated: stamp,
    name: `${parent.name} – Feld im Kleinen`,
    hexKm: childKm,
    orientation,
    hexes,
    biome: origin.terrain ?? parent.biome,
    seed: seedOf(parent.id, 'zoom', at.q, at.r, level),
    parent: { areaId: parent.id, q: at.q, r: at.r, level },
  });
}
