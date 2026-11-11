/**
 * Der Planet im Spielstand, vorbereitet zum Fragen: Küsten mit ihrer Ausdehnung, Höhenraster,
 * was an einer Lage ist und wo ein Ort liegt. Reine Funktionen; die Rechnung auf der Kugel steht
 * in `geo.ts`. Die Oberfläche fragt über `features/atlas/model.ts`, das alles hier weiterreicht.
 */
import { placeAncestors } from './derive';
import {
  NODATA,
  bearingDeg,
  destination,
  distanceKm,
  heightAt,
  inRing,
  ringBounds,
  type HeightGrid,
  type LonLat,
  type Ring,
  type RingBounds,
} from './geo';
import { withGeneratedRelief } from './landRelief';
import type { Atlas, CampaignData, GameMap, Place } from './schema';

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
  /** Die sichtbaren Landmassen – ausgeblendete der Weltdatei fehlen hier. */
  lands: LandIndex[];
  lakes: { id: string; name: string; shape: Shape }[];
  /** Flüsse, ohne die auf ausgeblendeten Landmassen. */
  rivers: Atlas['rivers'];
  /** Ausgeblendete Landmassen der Weltdatei. */
  hidden: { id: string; name: string }[];
}

const shape = (ring: Ring): Shape => ({ ring, bounds: ringBounds(ring) });

const planetCache = new WeakMap<Atlas, Planet>();

/** Der Planet der Kampagne – oder null, solange kein Atlas übernommen wurde. */
export function planetOf(data: Pick<CampaignData, 'atlas'>): Planet | null {
  const doc = data.atlas[PLANET_ID];
  if (!doc || doc.kind !== 'planet') return null;
  let planet = planetCache.get(doc);
  if (!planet) {
    const hidden = new Set(doc.hiddenLands);
    const gone = doc.lands.filter((land) => hidden.has(land.id));
    const goneShapes = gone.flatMap((land) => land.rings.map(shape));
    // Seen und Flüsse einer ausgeblendeten Landmasse verschwinden mit ihr.
    const onGone = (lon: number | undefined, lat: number | undefined) =>
      lon !== undefined &&
      lat !== undefined &&
      goneShapes.some((s) => inRing(s.ring, { lon, lat }, s.bounds));
    planet = {
      doc,
      radiusKm: doc.radiusKm,
      lands: doc.lands
        .filter((land) => !hidden.has(land.id))
        .map((land) => ({
          id: land.id,
          name: land.name,
          rings: land.rings.map(shape),
          holes: land.holes.map(shape),
        })),
      lakes: doc.lakes
        .filter((lake) => !onGone(lake.ring[0], lake.ring[1]))
        .map((lake) => ({ id: lake.id, name: lake.name, shape: shape(lake.ring) })),
      rivers: doc.rivers.filter((river) => {
        const middle = Math.floor(river.points.length / 4) * 2;
        return !onGone(river.points[middle], river.points[middle + 1]);
      }),
      hidden: gone.map((land) => ({ id: land.id, name: land.name })),
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

const fullCache = new WeakMap<Atlas, { planet: Atlas; grid: HeightGrid }>();

/**
 * Das Höhenraster der Kampagne – oder null, wenn keines übernommen wurde. Landmassen aus einem
 * Kartenbild bringen keine Höhen mit; für sie ist ein erzeugtes Gelände eingerechnet, solange
 * es an der Landmasse nicht abgeschaltet ist. Unter ausgeblendeten Landmassen der Weltdatei
 * gelten deren Höhen nicht mehr.
 */
export function reliefOf(data: Pick<CampaignData, 'atlas'>): HeightGrid | null {
  const base = baseRelief(data);
  const planet = data.atlas[PLANET_ID];
  const doc = data.atlas[RELIEF_ID];
  if (!base || !doc || !planet || planet.kind !== 'planet') return base;
  const hidden = new Set(planet.hiddenLands);
  const lands = planet.lands.filter((land) => isOwnLand(land) && land.relief !== 'flat');
  const cleared = planet.lands.filter((land) => hidden.has(land.id));
  if (!lands.length && !cleared.length) return base;
  const cached = fullCache.get(doc);
  if (cached && cached.planet === planet) return cached.grid;
  const grid = withGeneratedRelief(base, lands, planet.radiusKm, cleared);
  fullCache.set(doc, { planet, grid });
  return grid;
}

/** Das Höhenraster, wie es übernommen wurde – ohne erzeugtes Gelände. */
function baseRelief(data: Pick<CampaignData, 'atlas'>): HeightGrid | null {
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
  /** Die Höhe ist erzeugt: Die Landmasse stammt aus einem Kartenbild. */
  generated?: boolean;
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
    return {
      land: { id: land.id, name: land.name },
      water: null,
      heightM,
      generated: heightM !== null && isOwnLand(land),
    };
  }
  return enclosed
    ? { land: null, water: 'lake', heightM }
    : { land: null, water: 'sea', heightM: null };
}

// ── Lage von Orten ─────────────────────────────────────────────────────────

/** Was zum Fragen nach einer Lage gebraucht wird: die Orte – und für Karten auch diese und der Planet. */
type GeoData = Pick<CampaignData, 'entities'> & Partial<Pick<CampaignData, 'maps' | 'atlas'>>;

/**
 * Eine Karte, die im Planeten hängt: Zwei ihrer Punkte haben eine bekannte Lage. Daraus folgen
 * Maßstab und Drehung – und die Lage jedes anderen Punktes der Karte.
 */
export interface MapAnchor {
  map: GameMap;
  /** Die beiden Punkte, an denen die Karte hängt: Ort, Stelle auf der Karte, Lage. */
  a: { placeId: string; x: number; y: number; geo: LonLat };
  b: { placeId: string; x: number; y: number; geo: LonLat };
  /** Kilometer je Karteneinheit. */
  kmPerUnit: number;
  /** Um so viele Grad ist „oben“ auf der Karte gegen Norden gedreht (im Uhrzeigersinn). */
  turnDeg: number;
}

/**
 * Hängt eine Karte ein, wenn mindestens zwei ihrer Orte eine Lage haben – genommen werden die
 * beiden, die auf der Karte am weitesten auseinanderliegen. Sonst null.
 */
export function mapAnchor(
  map: GameMap,
  geoOf: (placeId: string) => LonLat | null | undefined,
  radiusKm: number,
): MapAnchor | null {
  const known: MapAnchor['a'][] = [];
  for (const marker of map.markers) {
    const geo = marker.entityId ? geoOf(marker.entityId) : null;
    if (geo && marker.entityId)
      known.push({ placeId: marker.entityId, x: marker.x, y: marker.y, geo });
  }
  let best: [MapAnchor['a'], MapAnchor['a']] | null = null;
  let bestUnits = 0;
  let km = 0;
  for (let i = 0; i < known.length; i++)
    for (let j = i + 1; j < known.length; j++) {
      const units = Math.hypot(known[j]!.x - known[i]!.x, known[j]!.y - known[i]!.y);
      if (units <= bestUnits) continue;
      // Derselbe Ort an zwei Stellen der Karte (oder zwei Orte an derselben Lage) trägt nichts.
      const apart = distanceKm(radiusKm, known[i]!.geo, known[j]!.geo);
      if (apart < 0.001) continue;
      bestUnits = units;
      km = apart;
      best = [known[i]!, known[j]!];
    }
  if (!best) return null;
  const [a, b] = best;
  // Richtung von a nach b auf der Karte, im Uhrzeigersinn von „oben“ aus (y wächst nach unten).
  const onMap = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI;
  return { map, a, b, kmPerUnit: km / bestUnits, turnDeg: bearingDeg(a.geo, b.geo) - onMap };
}

/** Die Lage eines Punktes einer eingehängten Karte. Die Karte liegt dabei flach auf der Kugel auf. */
export function anchoredGeo(anchor: MapAnchor, radiusKm: number, x: number, y: number): LonLat {
  const dx = x - anchor.a.x;
  const dy = y - anchor.a.y;
  const units = Math.hypot(dx, dy);
  if (units === 0) return anchor.a.geo;
  const bearing = (Math.atan2(dx, -dy) * 180) / Math.PI + anchor.turnDeg;
  const point = destination(radiusKm, anchor.a.geo, bearing, units * anchor.kmPerUnit);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return { lon: round(point.lon), lat: round(point.lat) };
}

/** Was sich aus den Karten über die Lage von Orten ergibt. */
export interface GeoIndex {
  /** Orte ohne eigene Lage, deren Lage aus einer eingehängten Karte folgt. */
  derived: Map<string, { geo: LonLat; map: GameMap }>;
  /** Eingehängte Karten nach ihrer Kennung. */
  anchors: Map<string, MapAnchor>;
}

const NO_INDEX: GeoIndex = { derived: new Map(), anchors: new Map() };
const indexCache = new WeakMap<
  object,
  { maps: object; planet: Atlas | undefined; index: GeoIndex }
>();

/**
 * Hängt alle Karten ein, die sich einhängen lassen, und rechnet die Lage ihrer übrigen Orte aus.
 * Eine so gewonnene Lage kann wieder eine weitere Karte einhängen – in bis zu vier Durchgängen.
 * Karten mit eingetragenen Lagen gehen vor; sonst entscheidet die Kennung der Karte.
 */
export function geoIndex(data: GeoData): GeoIndex {
  const planet = data.atlas?.[PLANET_ID];
  const maps = data.maps;
  if (!maps || !planet || planet.kind !== 'planet') return NO_INDEX;
  const cached = indexCache.get(data.entities);
  if (cached && cached.maps === maps && cached.planet === planet) return cached.index;
  const index: GeoIndex = { derived: new Map(), anchors: new Map() };
  const geoOf = (placeId: string) => {
    const entity = data.entities[placeId];
    if (entity?.kind !== 'place') return null;
    return entity.place.geo ?? index.derived.get(placeId)?.geo ?? null;
  };
  const sorted = Object.values(maps).sort((x, y) => x.id.localeCompare(y.id));
  for (let pass = 0; pass < 4; pass++) {
    let grew = false;
    for (const map of sorted) {
      if (index.anchors.has(map.id)) continue;
      const anchor = mapAnchor(map, geoOf, planet.radiusKm);
      if (!anchor) continue;
      index.anchors.set(map.id, anchor);
      grew = true;
      for (const marker of map.markers) {
        const entity = marker.entityId ? data.entities[marker.entityId] : undefined;
        if (entity?.kind !== 'place' || entity.place.geo || index.derived.has(entity.id)) continue;
        index.derived.set(entity.id, {
          geo: anchoredGeo(anchor, planet.radiusKm, marker.x, marker.y),
          map,
        });
      }
    }
    if (!grew) break;
  }
  indexCache.set(data.entities, { maps, planet, index });
  return index;
}

/** Die Lage genau dieses Ortes – eingetragen oder aus einer Karte –, ohne die Orte darüber. */
export function exactGeo(data: GeoData, place: Place): { geo: LonLat; map: GameMap | null } | null {
  if (place.place.geo) return { geo: place.place.geo, map: null };
  return geoIndex(data).derived.get(place.id) ?? null;
}

export interface PlaceGeo {
  geo: LonLat;
  /** Die Lage ist am Ort selbst eingetragen. */
  own: boolean;
  /** Die Lage gehört zu diesem Ort selbst – eingetragen oder aus einer Karte –, nicht zu einem darüber. */
  exact: boolean;
  /** Der Ort, zu dem die Lage gehört. */
  from: Place;
  /** Die Karte, aus der die Lage gerechnet ist; null, wenn sie eingetragen wurde. */
  via: GameMap | null;
}

/**
 * Die Lage eines Ortes: seine eigene, sonst die aus einer eingehängten Karte, sonst die des
 * nächsten übergeordneten Ortes, der eine hat.
 */
export function placeGeo(data: GeoData, placeId: string | null | undefined): PlaceGeo | null {
  const seen = new Set<string>();
  let current = placeId ? data.entities[placeId] : undefined;
  let exact = true;
  while (current?.kind === 'place' && !seen.has(current.id)) {
    const found = exactGeo(data, current);
    if (found)
      return {
        geo: found.geo,
        own: exact && found.map === null,
        exact,
        from: current,
        via: found.map,
      };
    seen.add(current.id);
    exact = false;
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
