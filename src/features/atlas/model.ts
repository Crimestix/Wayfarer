/**
 * Der Atlas im Spielstand: der Planet mit Küsten, Gewässern und Höhen – und was sich daraus
 * ablesen lässt. Reine Funktionen; die Rechnung auf der Kugel steht in `domain/geo.ts`.
 */
import {
  NODATA,
  compass,
  bearingDeg,
  daylightHours,
  distanceKm,
  heightAt,
  inRing,
  ringBounds,
  type HeightGrid,
  type LonLat,
  type Ring,
  type RingBounds,
} from '../../domain/geo';
import type { Atlas, CampaignData, Place } from '../../domain/schema';
import { MINUTES_PER_DAY, daysBeforeYear, fromTime, yearLength } from '../../domain/time/calendar';
import { warmestMonth } from '../../domain/weatherZone';

export const PLANET_ID = 'planet';
export const RELIEF_ID = 'relief';

interface Shape {
  ring: Ring;
  bounds: RingBounds;
}

export interface LandIndex {
  id: string;
  name: string;
  rings: Shape[];
  holes: Shape[];
}

/** Der Planet, vorbereitet zum Fragen: jede Küste mit ihrer Ausdehnung. */
export interface Planet {
  doc: Atlas;
  radiusKm: number;
  lands: LandIndex[];
  lakes: { id: string; name: string; shape: Shape }[];
}

const shape = (ring: Ring): Shape => ({ ring, bounds: ringBounds(ring) });

const planetCache = new WeakMap<Atlas, Planet>();

/** Der Planet der Kampagne – oder null, solange kein Atlas übernommen wurde. */
export function planetOf(data: Pick<CampaignData, 'atlas'>): Planet | null {
  const doc = data.atlas[PLANET_ID];
  if (!doc || doc.kind !== 'planet') return null;
  let planet = planetCache.get(doc);
  if (!planet) {
    planet = {
      doc,
      radiusKm: doc.radiusKm,
      lands: doc.lands.map((land) => ({
        id: land.id,
        name: land.name,
        rings: land.rings.map(shape),
        holes: land.holes.map(shape),
      })),
      lakes: doc.lakes.map((lake) => ({ id: lake.id, name: lake.name, shape: shape(lake.ring) })),
    };
    planetCache.set(doc, planet);
  }
  return planet;
}

// ── Höhenraster ────────────────────────────────────────────────────────────

/** Schreibt Höhen als Base64 (16 Bit, das niederwertige Byte zuerst). */
export function encodeHeights(data: Int16Array): string {
  const bytes = new Uint8Array(data.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < data.length; i++) view.setInt16(i * 2, data[i]!, true);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

export function decodeHeights(text: string, cells: number): Int16Array {
  const binary = atob(text);
  const out = new Int16Array(cells);
  const count = Math.min(cells, Math.floor(binary.length / 2));
  for (let i = 0; i < count; i++) {
    const value = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
    out[i] = value >= 0x8000 ? value - 0x10000 : value;
  }
  for (let i = count; i < cells; i++) out[i] = NODATA;
  return out;
}

const gridCache = new WeakMap<Atlas, HeightGrid>();

/** Das Höhenraster der Kampagne – oder null, wenn keines übernommen wurde. */
export function reliefOf(data: Pick<CampaignData, 'atlas'>): HeightGrid | null {
  const doc = data.atlas[RELIEF_ID];
  if (!doc || doc.kind !== 'relief' || !doc.width || !doc.height || !doc.heights) return null;
  let grid = gridCache.get(doc);
  if (!grid) {
    grid = {
      width: doc.width,
      height: doc.height,
      data: decodeHeights(doc.heights, doc.width * doc.height),
    };
    gridCache.set(doc, grid);
  }
  return grid;
}

// ── Was an einer Lage ist ──────────────────────────────────────────────────

export interface Terrain {
  /** Die Landmasse, auf der die Lage liegt; null auf dem Meer. */
  land: { id: string; name: string } | null;
  /** Wasser an dieser Stelle: offenes Meer, Binnenmeer oder See. */
  water: 'sea' | 'lake' | null;
  /** Höhe in Metern; null ohne Angabe. */
  heightM: number | null;
}

/** Land oder Wasser, Landmasse und Höhe an einer Lage. */
export function terrainAt(planet: Planet, grid: HeightGrid | null, point: LonLat): Terrain {
  const heightM = grid ? heightAt(grid, point) : null;
  for (const lake of planet.lakes)
    if (inRing(lake.shape.ring, point, lake.shape.bounds))
      return { land: null, water: 'lake', heightM };
  for (const land of planet.lands) {
    if (!land.rings.some((s) => inRing(s.ring, point, s.bounds))) continue;
    // Ein Loch in der Landmasse ist ein Binnenmeer oder ein großer See.
    if (land.holes.some((s) => inRing(s.ring, point, s.bounds)))
      return { land: null, water: 'lake', heightM };
    return { land: { id: land.id, name: land.name }, water: null, heightM };
  }
  return { land: null, water: 'sea', heightM: null };
}

// ── Lage von Orten ─────────────────────────────────────────────────────────

/**
 * Die Lage eines Ortes: seine eigene oder die des nächsten übergeordneten Ortes, der eine hat.
 * `own` sagt, ob sie am Ort selbst eingetragen ist.
 */
export function placeGeo(
  data: Pick<CampaignData, 'entities'>,
  placeId: string | null | undefined,
): { geo: LonLat; own: boolean; from: Place } | null {
  const seen = new Set<string>();
  let current = placeId ? data.entities[placeId] : undefined;
  let own = true;
  while (current?.kind === 'place' && !seen.has(current.id)) {
    if (current.place.geo) return { geo: current.place.geo, own, from: current };
    seen.add(current.id);
    own = false;
    current = current.place.parentId ? data.entities[current.place.parentId] : undefined;
  }
  return null;
}

export interface Leg {
  km: number;
  /** Richtung beim Aufbruch: Grad und Wort („Nordosten“). */
  bearing: number;
  direction: string;
}

/** Luftlinie und Richtung zwischen zwei Orten – null, wenn einer keine Lage hat oder beide dieselbe. */
export function legBetween(data: CampaignData, fromId: string, toId: string): Leg | null {
  const planet = planetOf(data);
  const a = placeGeo(data, fromId);
  const b = placeGeo(data, toId);
  if (!planet || !a || !b) return null;
  const km = distanceKm(planet.radiusKm, a.geo, b.geo);
  if (km < 0.001) return null;
  const bearing = bearingDeg(a.geo, b.geo);
  return { km, bearing, direction: compass(bearing) };
}

// ── Worte ──────────────────────────────────────────────────────────────────

const degrees = (value: number) =>
  Math.abs(value).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** „12,3° N, 45,6° O“ */
export function formatGeo(point: LonLat): string {
  return `${degrees(point.lat)}° ${point.lat >= 0 ? 'N' : 'S'}, ${degrees(point.lon)}° ${point.lon >= 0 ? 'O' : 'W'}`;
}

/** „1 240 km“, unter zehn Kilometern mit einer Nachkommastelle. */
export function formatKm(km: number): string {
  return `${km.toLocaleString('de-DE', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

/** Was an einer Lage ist, in Worten: „Land · 340 m“, „Meer“, „See“. */
export function describeTerrain(terrain: Terrain): string {
  if (terrain.water === 'sea') return 'Meer';
  const height =
    terrain.heightM === null ? '' : ` · ${Math.round(terrain.heightM).toLocaleString('de-DE')} m`;
  if (terrain.water === 'lake') return `See${height}`;
  return `${terrain.land?.name || 'Land'}${height}`;
}

// ── Sonne ──────────────────────────────────────────────────────────────────

/**
 * Wie weit das Jahr seit der Frühlings-Tagundnachtgleiche der Nordhalbkugel fortgeschritten ist
 * (0…1). Der Kalender nennt keine Sonnenwende; Wayfarer nimmt den längsten Tag am Beginn des
 * wärmsten Monats an – das Wetter hinkt der Sonne etwa einen halben Monat nach.
 */
export function seasonFraction(data: CampaignData, time: number): number {
  const cal = data.campaign.calendar;
  const date = fromTime(cal, time);
  const length = yearLength(cal, date.year);
  const dayOfYear = Math.floor(time / MINUTES_PER_DAY) - daysBeforeYear(cal, date.year);
  let solstice = 0;
  const warmest = warmestMonth(data);
  for (let month = 0; month < warmest; month++) solstice += cal.months[month]!.days;
  const fraction = (dayOfYear - solstice) / length + 0.25;
  return ((fraction % 1) + 1) % 1;
}

/** Stunden Tageslicht an einer Lage zur Weltzeit – null, solange kein Atlas übernommen ist. */
export function daylightAt(data: CampaignData, point: LonLat, time: number): number | null {
  const planet = planetOf(data);
  if (!planet) return null;
  return daylightHours(
    point.lat,
    planet.doc.obliquityDeg,
    seasonFraction(data, time),
    planet.doc.dayHours,
  );
}

/** „9 Std. 40 Min.“ */
export function formatHours(hours: number): string {
  const minutes = Math.round(hours * 60);
  const h = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${h} Std. ${rest} Min.` : `${h} Std.`;
}

// ── Orte für die Karte ─────────────────────────────────────────────────────

export interface PlacedPlace {
  place: Place;
  geo: LonLat;
  /** Kein Ort darüber hat selbst eine Lage. */
  major: boolean;
}

/** Alle Orte, an denen selbst eine Lage eingetragen ist. */
export function placedPlaces(data: Pick<CampaignData, 'entities'>): PlacedPlace[] {
  const out: PlacedPlace[] = [];
  for (const entity of Object.values(data.entities)) {
    if (entity.kind !== 'place' || !entity.place.geo) continue;
    const above = entity.place.parentId ? placeGeo(data, entity.place.parentId) : null;
    out.push({ place: entity, geo: entity.place.geo, major: above === null });
  }
  return out.sort((a, b) => a.place.name.localeCompare(b.place.name, 'de'));
}
