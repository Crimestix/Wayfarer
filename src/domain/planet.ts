/**
 * Der Planet im Spielstand, vorbereitet zum Fragen: Küsten mit ihrer Ausdehnung, Höhenraster,
 * was an einer Lage ist und wo ein Ort liegt. Reine Funktionen; die Rechnung auf der Kugel steht
 * in `geo.ts`. Die Oberfläche fragt über `features/atlas/model.ts`, das alles hier weiterreicht.
 */
import { placeAncestors } from './derive';
import {
  NODATA,
  destination,
  heightAt,
  inRing,
  ringBounds,
  type HeightGrid,
  type LonLat,
  type Ring,
  type RingBounds,
} from './geo';
import type { Atlas, CampaignData, Place } from './schema';

export const PLANET_ID = 'planet';
export const RELIEF_ID = 'relief';

/** Kennung der Landmassen, die in Wayfarer aus einem Bild eingelesen wurden. */
export const OWN_LAND_PREFIX = 'bild-';
export const isOwnLand = (land: { id: string }): boolean => land.id.startsWith(OWN_LAND_PREFIX);

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
  let enclosed = false;
  for (const land of planet.lands) {
    if (!land.rings.some((s) => inRing(s.ring, point, s.bounds))) continue;
    // Ein Loch in der Landmasse ist ein Binnenmeer oder ein großer See – es sei denn, eine
    // andere Landmasse liegt dort (eingelesene Bilder dürfen sich überlappen).
    if (land.holes.some((s) => inRing(s.ring, point, s.bounds))) {
      enclosed = true;
      continue;
    }
    return { land: { id: land.id, name: land.name }, water: null, heightM };
  }
  return enclosed
    ? { land: null, water: 'lake', heightM }
    : { land: null, water: 'sea', heightM: null };
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

// ── Küstennähe ─────────────────────────────────────────────────────────────

/** So weit wird nach dem Meer gesucht, in Kilometern – Ring für Ring. */
export const COAST_STEPS = [60, 150, 300, 600] as const;

const coastCache = new WeakMap<Planet, Map<string, number | null>>();

/**
 * Wie weit das offene Meer ungefähr entfernt ist: 0 auf dem Meer selbst, sonst der erste Ring aus
 * `COAST_STEPS`, auf dem in irgendeiner der acht Richtungen Meer liegt. Ohne Meer im Umkreis: null
 * – tiefes Binnenland. Seen zählen nicht.
 */
export function coastKm(planet: Planet, point: LonLat): number | null {
  const key = `${point.lon.toFixed(2)}/${point.lat.toFixed(2)}`;
  let cache = coastCache.get(planet);
  if (!cache) coastCache.set(planet, (cache = new Map()));
  const known = cache.get(key);
  if (known !== undefined) return known;
  let found: number | null = null;
  if (terrainAt(planet, null, point).water === 'sea') found = 0;
  else
    search: for (const km of COAST_STEPS)
      for (let bearing = 0; bearing < 360; bearing += 45)
        if (
          terrainAt(planet, null, destination(planet.radiusKm, point, bearing, km)).water === 'sea'
        ) {
          found = km;
          break search;
        }
  cache.set(key, found);
  return found;
}

/** Die Orte eines Ortes aufwärts, er selbst zuerst – leer, wenn es kein Ort ist. */
export function placeChain(data: Pick<CampaignData, 'entities'>, placeId: string | null): Place[] {
  const start = placeId ? data.entities[placeId] : undefined;
  return start?.kind === 'place' ? [start, ...placeAncestors(data as CampaignData, start.id)] : [];
}
