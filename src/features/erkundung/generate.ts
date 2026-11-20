/**
 * Hexkarten zwischen zwei Orten – erzeugt, nicht gezeichnet. „Wo andere Spielleiter
 * Zufallstabellen nutzen, nutzen wir Wayfarer“: Aus dem, was die Welt schon weiß, erkennt
 * Wayfarer, wie weit es von A nach B ist, was für eine Landschaft dazwischen liegt und welche
 * bekannten Orte am Weg liegen – und baut daraus ein zusammenhängendes Gelände mit
 * Besonderheiten. Für die Geschichte Wichtiges entsteht hier nicht.
 *
 * Reine Funktionen. Gleicher Ausgangswert und gleiche Angaben → dieselbe Karte, damit die
 * Rückreise dieselbe Welt vorfindet.
 */
import { isUnderground } from '../../domain/underground';
import { normalize, placeAncestors } from '../../domain/derive';
import {
  along as pointAlong,
  bearingDeg,
  destination,
  distanceKm as surfaceKm,
  wrapLon,
  type LonLat,
} from '../../domain/geo';
import { biomeOfPreset, describeSite, siteAt, sitePreset } from '../../domain/geoClimate';
import { crossesWater, landRoute } from '../../domain/landRoute';
import { exactGeo, placeGeo, planetOf, reliefOf, terrainAt } from '../../domain/planet';
import { PRESET, type ClimatePreset } from '../../domain/weather';
import {
  hexAt,
  hexBand,
  hexCenter,
  hexDistance,
  hexKey,
  hexLine,
  hexNeighbors,
  type HexCoord,
} from '../../domain/hex';
import { rngOf, seedOf, smoothNoise } from '../../domain/random';
import {
  AreaSchema,
  newId,
  nowIso,
  type Area,
  type CampaignData,
  type Hex,
  type Terrain,
} from '../../domain/schema';
import { TERRAIN_LABEL } from '../../domain/terrain';
import { generateCaves, type CaveQuality } from '../../domain/caves';
import { entryParts, pickFrom } from '../../domain/rollTable';
import { DEFAULT_GENERATOR_TABLES, generatorTables, type GeneratorTables } from './tables';
import { assignSurfaceKinds, caveKind, warmthOf, type Field } from './kinds';

// ── Erkennen: Entfernung, Richtung, Orte am Weg ────────────────────────────

export interface Recognition {
  /** Entfernung in km; null, wenn die Welt sie nicht hergibt. */
  distanceKm: number | null;
  /** Woher die Entfernung stammt – ein Satz für den Dialog. */
  distanceSource: string;
  /** Richtung von Start zu Ziel als Einheitsvektor (x nach Osten, y nach Süden); null = unbekannt. */
  direction: { x: number; y: number } | null;
  /** Bekannte Orte zwischen Start und Ziel: Anteil am Weg (0–1) und Abstand zur Linie in km. */
  between: { placeId: string; along: number; offsetKm: number }[];
  biome: Terrain;
  /** Woran die Landschaft erkannt wurde. */
  biomeSource: string;
  /** Vorgeschlagene Feldgröße in km. */
  hexKm: number;
  /**
   * Lage des Startortes auf dem Planeten, wenn das Gelände dem Atlas folgen kann: Entfernung und
   * Richtung stammen vom Planeten, und der Start hat dort selbst eine Lage. Sonst null.
   */
  origin: LonLat | null;
  /** Entfernung und Richtung stammen vom Planeten. */
  fromAtlas: boolean;
  /**
   * Die Luftlinie führt übers Wasser: der Weg über Land, ums Wasser herum, als Punkte in Kilometern
   * vom Start aus (x nach Osten, y nach Süden; der letzte ist das Ziel). Null, wenn die Luftlinie
   * an Land bleibt oder es keinen Landweg gibt.
   */
  route: { x: number; y: number }[] | null;
  /** Die Luftlinie führt übers Wasser, und es gibt keinen Weg über Land. */
  seaOnly: boolean;
  /** Das Klima auf halber Strecke, wenn der Planet es hergibt – für die Geländearten. */
  climate: ClimatePreset | null;
}

/** Stichworte (ohne Umlaute und Akzente, siehe `normalize`), an denen eine Landschaft zu erkennen ist. */
const BIOME_WORDS: [Terrain, RegExp][] = [
  ['underdark', /unterreich|underdark|hohle|kaverne|grotte|stollen|tunnel|unterwelt|tiefen\b/],
  ['swamp', /sumpf|moor|marsch|morast|ried\b|bruch\b/],
  ['forest', /wald|forst|hain\b|dschungel|urwald|dickicht/],
  ['mountains', /gebirge|berg|gipfel|klamm|grat\b|zinnen/],
  ['hills', /hugel|hochland|heide|kuppen/],
  ['desert', /wuste|dune|odland|einode|salzpfanne/],
  ['arctic', /eis\b|eisland|schnee|frost|tundra|gletscher/],
  ['coast', /kuste|strand|bucht|kliff|gestade|hafen/],
  ['water', /\bsee\b|meer|ozean|\binsel/],
  ['grassland', /steppe|ebene|grasland|wiesen|felder|aue\b/],
];

const HEX_SIZES = [2, 10, 50] as const;
/** So viele Felder soll der direkte Weg höchstens lang sein. */
const MAX_LENGTH = 80;

/** Sechs Meilen je Feld, wie in den Regelwerken üblich: zwei Stunden im normalen Tempo. */
export const SIX_MILES_KM = 6 * 1.609344;

/**
 * Feldgröße, bei der der direkte Weg überschaubar bleibt. Unter der Erde immer sechs Meilen
 * (Entscheidung des Spielleiters, 17. 11.).
 */
/**
 * Die Feldgrößen zur Wahl im Fenster „Neue Hexkarte“: die üblichen, dazu die gerade geltende,
 * wenn sie keine davon ist (unter der Erde sechs Meilen). So zeigt die Auswahl immer genau den
 * Maßstab, mit dem Vorschau und Karte rechnen (F09).
 */
export function hexSizeOptions(current: number): number[] {
  const sizes: number[] = [...HEX_SIZES];
  if (!sizes.some((s) => Math.abs(s - current) < 1e-9)) sizes.push(current);
  return sizes.sort((a, b) => a - b);
}

export function suggestHexKm(distanceKm: number | null, biome: Terrain | null = null): number {
  if (biome === 'underdark') return SIX_MILES_KM;
  if (distanceKm === null) return 10;
  return HEX_SIZES.find((size) => distanceKm / size <= MAX_LENGTH) ?? 50;
}

function markerOf(data: CampaignData, placeId: string) {
  for (const map of Object.values(data.maps)) {
    const marker = map.markers.find((m) => m.entityId === placeId);
    if (marker) return { map, marker };
  }
  return null;
}

/** Landschaft aus Namen, Art, Schlagworten und Kurzbeschreibung der Orte und ihrer Umgebung. */
export function recognizeBiome(
  data: CampaignData,
  placeIds: readonly string[],
): { biome: Terrain; source: string; found: boolean } {
  const scores = new Map<Terrain, { score: number; from: Set<string> }>();
  const hit = (terrain: Terrain, weight: number, from: string) => {
    const entry = scores.get(terrain) ?? { score: 0, from: new Set<string>() };
    entry.score += weight;
    entry.from.add(from);
    scores.set(terrain, entry);
  };
  const read = (text: string, weight: number, from: string) => {
    const plain = normalize(text);
    for (const [terrain, words] of BIOME_WORDS) if (words.test(plain)) hit(terrain, weight, from);
  };
  for (const placeId of placeIds) {
    const place = data.entities[placeId];
    if (place?.kind !== 'place') continue;
    // Der Ort selbst zählt am meisten, die Gebiete darüber immer weniger.
    [place, ...placeAncestors(data, placeId)].forEach((p, depth) => {
      const weight = 3 / (depth + 1);
      read(`${p.name} ${p.kind === 'place' ? p.place.category : ''}`, weight, p.name);
      read(`${p.tags.join(' ')} ${p.tagline}`, weight / 2, p.name);
    });
    // Karten, auf denen der Ort liegt, sagen etwas über die Umgebung.
    const found = markerOf(data, placeId);
    if (found) read(`${found.map.name} ${found.map.notes}`, 1.5, `Karte „${found.map.name}“`);
  }
  // Ein gespeicherter Weg zwischen genau diesen Orten kennt sein Gelände.
  const [a, b] = placeIds;
  for (const path of Object.values(data.paths))
    if (
      a &&
      b &&
      ((path.fromId === a && path.toId === b) || (path.fromId === b && path.toId === a)) &&
      // „Grasland“ ist nur die Vorgabe eines Weges, „Stadt“ sagt nichts über das Land dazwischen.
      path.terrain !== 'urban' &&
      path.terrain !== 'grassland'
    )
      hit(path.terrain, 4, path.name ? `Weg „${path.name}“` : 'gespeicherter Weg');

  // Liegen die Orte unter der Erde (`isUnderground`: Klima, Unterreich-Karte, Namen), ist das
  // Land dazwischen es auch – das wiegt mehr als jedes Wort.
  const below = placeIds.filter((id) => isUnderground(data, id));
  if (below.length && below.length === placeIds.filter((id) => data.entities[id]).length)
    hit('underdark', 20, data.entities[below[0]!]?.name ?? 'unter der Erde');

  let best: Terrain | null = null;
  for (const [terrain, entry] of scores)
    if (best === null || entry.score > scores.get(best)!.score) best = terrain;
  if (best === null)
    return {
      biome: 'grassland',
      found: false,
      source:
        'Nichts in der Welt deutet auf eine besondere Landschaft – angenommen ist offenes Land.',
    };
  return {
    biome: best,
    found: true,
    source: `Erkannt an ${[...scores.get(best)!.from].map((n) => (n.startsWith('Karte') || n.startsWith('Weg') || n === 'gespeicherter Weg' ? n : `„${n}“`)).join(', ')}.`,
  };
}

/** Was die Welt über die Strecke zwischen zwei Orten weiß. */
export function recognize(data: CampaignData, fromId: string, toId: string): Recognition {
  const words = recognizeBiome(data, [fromId, toId]);
  let { biome, source: biomeSource } = words;
  let distanceKm: number | null = null;
  let distanceSource = 'Die Welt kennt die Entfernung nicht – bitte eintragen.';
  let direction: Recognition['direction'] = null;
  const between: Recognition['between'] = [];
  let fromAtlas = false;

  // Der Planet: Haben beide Orte eine Lage, sind Entfernung und Richtung gerechnet.
  const planet = planetOf(data);
  const geoFrom = planet ? placeGeo(data, fromId) : null;
  const geoTo = planet ? placeGeo(data, toId) : null;
  const atlasKm =
    planet && geoFrom && geoTo ? surfaceKm(planet.radiusKm, geoFrom.geo, geoTo.geo) : 0;
  const measureOnPlanet = () => {
    if (!planet || !geoFrom || !geoTo || atlasKm < 1) return;
    const bearing = bearingDeg(geoFrom.geo, geoTo.geo);
    const rad = (bearing * Math.PI) / 180;
    distanceKm = atlasKm;
    direction = { x: Math.sin(rad), y: -Math.cos(rad) };
    fromAtlas = true;
    const rough = [geoFrom, geoTo]
      .filter((entry) => !entry.exact)
      .map((entry) => `„${entry.from.name}“`);
    distanceSource = rough.length
      ? `Gemessen auf dem Planeten (Luftlinie) – grob: Gerechnet wird mit der Lage von ${rough.join(' und ')}.`
      : 'Gemessen auf dem Planeten (Luftlinie).';
    // Andere Orte mit eigener Lage, die nahe an der Linie liegen.
    for (const entity of Object.values(data.entities)) {
      const there = entity.kind === 'place' ? exactGeo(data, entity)?.geo : null;
      if (!there) continue;
      if (entity.id === fromId || entity.id === toId) continue;
      if (entity.id === geoFrom.from.id || entity.id === geoTo.from.id) continue;
      const km = surfaceKm(planet.radiusKm, geoFrom.geo, there);
      const turn = ((bearingDeg(geoFrom.geo, there) - bearing) * Math.PI) / 180;
      const along = (km * Math.cos(turn)) / atlasKm;
      const offsetKm = km * Math.sin(turn);
      if (along <= 0.02 || along >= 0.98 || Math.abs(offsetKm) > atlasKm / 2) continue;
      between.push({ placeId: entity.id, along, offsetKm });
    }
    between.sort((x, y) => x.along - y.along);
  };
  if (geoFrom?.exact && geoTo?.exact) measureOnPlanet();

  const from = markerOf(data, fromId);
  const to = from ? from.map.markers.find((m) => m.entityId === toId) : undefined;
  if (distanceKm === null && from && to) {
    const dx = to.x - from.marker.x;
    const dy = to.y - from.marker.y;
    const units = Math.hypot(dx, dy);
    if (units > 0) {
      direction = { x: dx / units, y: dy / units };
      const scale = from.map.scale?.kmPerUnit ?? null;
      if (scale) {
        distanceKm = units * scale;
        distanceSource = `Gemessen auf der Karte „${from.map.name}“ (Luftlinie).`;
        // Andere bekannte Orte dieser Karte, die nahe an der Linie liegen.
        const seen = new Set([fromId, toId]);
        for (const marker of from.map.markers) {
          if (!marker.entityId || seen.has(marker.entityId)) continue;
          if (data.entities[marker.entityId]?.kind !== 'place') continue;
          const px = marker.x - from.marker.x;
          const py = marker.y - from.marker.y;
          const along = (px * dx + py * dy) / (units * units);
          const offsetKm = ((px * dy - py * dx) / units) * scale;
          if (along <= 0.02 || along >= 0.98) continue;
          seen.add(marker.entityId);
          between.push({ placeId: marker.entityId, along, offsetKm });
        }
        between.sort((x, y) => x.along - y.along);
      } else
        distanceSource = `Beide Orte liegen auf der Karte „${from.map.name}“, aber sie hat noch keinen Maßstab.`;
    }
  }
  if (distanceKm === null) {
    for (const path of Object.values(data.paths)) {
      const direct =
        (path.fromId === fromId && path.toId === toId) ||
        (path.fromId === toId && path.toId === fromId);
      if (!direct) continue;
      const scale = path.mapId ? (data.maps[path.mapId]?.scale?.kmPerUnit ?? null) : null;
      const measured =
        scale && path.points.length > 1
          ? path.points.slice(1).reduce((sum, p, i) => {
              const prev = path.points[i]!;
              return sum + Math.hypot(p[0] - prev[0], p[1] - prev[1]);
            }, 0) * scale
          : null;
      const km = path.distanceKm ?? measured;
      if (km && km > 0) {
        distanceKm = km;
        distanceSource = `Länge des gespeicherten Weges${path.name ? ` „${path.name}“` : ''}.`;
        break;
      }
    }
  }
  // Ohne Karte und Weg: lieber grob über die Lage der Orte darüber als gar nicht.
  if (distanceKm === null) measureOnPlanet();

  // Führt die Luftlinie übers Meer, folgt die Reise dem Landweg – wenn es einen gibt.
  let route: Recognition['route'] = null;
  let seaOnly = false;
  if (fromAtlas && planet && geoFrom && geoTo && crossesWater(planet, geoFrom.geo, geoTo.geo)) {
    const found = landRoute(planet, geoFrom.geo, geoTo.geo);
    if (found) {
      route = found.points.slice(1).map((point) => {
        const km = surfaceKm(planet.radiusKm, geoFrom.geo, point);
        const rad = (bearingDeg(geoFrom.geo, point) * Math.PI) / 180;
        return { x: km * Math.sin(rad), y: -km * Math.cos(rad) };
      });
      distanceSource = `Landweg auf dem Planeten, ums Wasser herum – die Luftlinie wären ${Math.round(atlasKm).toLocaleString('de-DE')} km.`;
      distanceKm = found.km;
    } else seaOnly = true;
  }

  // Deutet kein Wort auf eine Landschaft, sagt das Klima auf halber Strecke etwas über sie.
  let climate: ClimatePreset | null = null;
  if (planet && geoFrom && geoTo) {
    const site = siteAt(planet, reliefOf(data), pointAlong(geoFrom.geo, geoTo.geo, 0.5));
    const preset = sitePreset(site);
    climate = preset;
    if (!words.found) {
      biome = biomeOfPreset(preset);
      biomeSource = `Aus der Lage gerechnet: ${PRESET[preset].name} auf halber Strecke (${describeSite(site)}).`;
    }
  }
  return {
    distanceKm,
    distanceSource,
    direction,
    between,
    biome,
    biomeSource,
    hexKm: suggestHexKm(distanceKm, biome),
    // Nur wenn die Richtung vom Planeten stammt und der Start selbst dort liegt – eine Wiki-Karte
    // muss nicht nach Norden zeigen, und die Lage des Landes ist nicht die der Stadt.
    origin: fromAtlas && geoFrom?.exact ? geoFrom.geo : null,
    fromAtlas,
    route,
    seaOnly,
    climate,
  };
}

// ── Gelände vom Planeten ───────────────────────────────────────────────────

/** Was der Atlas über eine Stelle sagt. */
export interface GroundSample {
  water: 'sea' | 'lake' | null;
  /** Höhe in Metern; null ohne Angabe. */
  heightM: number | null;
  /** Ein Fluss in der Nähe: sein Name, sonst „Fluss“. */
  river?: string;
}

/** Fragt den Planeten: `xKm` nach Osten und `yKm` nach Süden vom Startort aus. */
export type Ground = (xKm: number, yKm: number) => GroundSample;

/**
 * Das Gelände rund um eine Lage, wie es im Atlas steht – oder nichts, wenn es keinen Atlas gibt.
 * Die Karte liegt flach auf der Kugel auf: Entfernung und Richtung vom Start stimmen.
 */
export function groundOf(
  data: CampaignData,
  origin: LonLat | null,
  hexKm = 10,
): Ground | undefined {
  const planet = planetOf(data);
  if (!planet || !origin) return undefined;
  const grid = reliefOf(data);
  const kmPerDegree = (2 * Math.PI * planet.radiusKm) / 360;
  // Ein Fluss gehört zum Feld, wenn er näher als ein halbes Feld an dessen Mitte vorbeifließt.
  const rivers = planet.rivers.map((river) => {
    let south = 90;
    let north = -90;
    for (let i = 1; i < river.points.length; i += 2) {
      south = Math.min(south, river.points[i]!);
      north = Math.max(north, river.points[i]!);
    }
    return {
      name: river.name || 'Fluss',
      points: river.points,
      south,
      north,
      // Ein breiter Strom reicht weiter als ein halbes Feld.
      reach: Math.max(hexKm / 2, river.widthKm / 2),
    };
  });
  const riverAt = (point: LonLat): string | undefined => {
    const shrink = Math.cos((point.lat * Math.PI) / 180);
    for (const river of rivers) {
      const { reach } = river;
      const margin = reach / kmPerDegree;
      if (point.lat < river.south - margin || point.lat > river.north + margin) continue;
      for (let i = 0; i + 3 < river.points.length; i += 2) {
        // Abstand zur Strecke, in Kilometern, in der Ebene um die Stelle herum.
        const ax = wrapLon(river.points[i]! - point.lon) * kmPerDegree * shrink;
        const ay = (river.points[i + 1]! - point.lat) * kmPerDegree;
        const bx = wrapLon(river.points[i + 2]! - point.lon) * kmPerDegree * shrink;
        const by = (river.points[i + 3]! - point.lat) * kmPerDegree;
        const length = (bx - ax) ** 2 + (by - ay) ** 2;
        const t = length
          ? Math.max(0, Math.min(1, -(ax * (bx - ax) + ay * (by - ay)) / length))
          : 0;
        if (Math.hypot(ax + t * (bx - ax), ay + t * (by - ay)) <= reach) return river.name;
      }
    }
    return undefined;
  };
  return (xKm, yKm) => {
    const km = Math.hypot(xKm, yKm);
    const point =
      km < 0.001
        ? origin
        : destination(planet.radiusKm, origin, (Math.atan2(xKm, -yKm) * 180) / Math.PI, km);
    const { water, heightM } = terrainAt(planet, grid, point);
    return { water, heightM, river: water ? undefined : riverAt(point) };
  };
}

/** Ab dieser Höhe ist ein Feld Hügelland, ab der zweiten Gebirge (Meter). */
const HILLS_M = 600;
const MOUNTAINS_M = 1600;

/**
 * Gelände eines Feldes, wenn der Atlas die Stelle kennt: Wasser, Hügel und Berge stammen von
 * dort; im Tiefland entscheidet die Landschaft wie sonst – nur erfindet sie kein Gewässer und
 * kein Gebirge dazu, das der Planet nicht hat.
 */
export function groundTerrain(
  biome: Terrain,
  sample: GroundSample,
  height: number,
  wet: number,
): Terrain {
  if (sample.water) return 'water';
  if (sample.heightM !== null && sample.heightM >= MOUNTAINS_M) return 'mountains';
  if (sample.heightM !== null && sample.heightM >= HILLS_M) return 'hills';
  const open: Terrain =
    biome === 'desert' || biome === 'arctic' || biome === 'forest' || biome === 'swamp'
      ? biome
      : 'grassland';
  const terrain = terrainOf(open, height, wet, 0);
  if (terrain === 'water')
    return open === 'desert' || open === 'arctic' ? open : wet > 0.5 ? 'swamp' : 'grassland';
  return terrain === 'mountains' ? 'hills' : terrain;
}

// ── Gelände: zusammenhängend statt gewürfelt ───────────────────────────────

/** Drei Ebenen Rauschen: große Züge, darin kleinere, darin Einzelheiten. */
export function terrainNoise(seed: number, x: number, y: number): number {
  return (
    0.6 * smoothNoise(seed, x, y) +
    0.3 * smoothNoise(seed + 1, x * 2, y * 2) +
    0.1 * smoothNoise(seed + 2, x * 4, y * 4)
  );
}

/**
 * Gelände eines Feldes aus Höhe und Feuchte (je 0–1) – je nach Landschaft anders gelesen.
 * `side` ist die Lage quer zum Weg (−1 … +1) und trennt an der Küste Land und Meer.
 */
export function terrainOf(biome: Terrain, height: number, wet: number, side: number): Terrain {
  switch (biome) {
    case 'underdark':
      return height < 0.24 ? 'water' : 'underdark';
    case 'water':
      return height > 0.78 ? 'coast' : 'water';
    case 'desert':
      if (height > 0.78) return 'mountains';
      if (height > 0.64) return 'hills';
      return height < 0.2 && wet > 0.7 ? 'grassland' : 'desert';
    case 'arctic':
      if (height > 0.76) return 'mountains';
      if (height > 0.62) return 'hills';
      if (height < 0.2) return 'water';
      return wet > 0.72 ? 'forest' : 'arctic';
    case 'swamp':
      if (height < 0.26) return 'water';
      if (height > 0.74) return 'hills';
      if (height > 0.58) return wet > 0.5 ? 'forest' : 'grassland';
      return 'swamp';
    case 'forest':
      if (height > 0.82) return 'mountains';
      if (height > 0.7) return 'hills';
      if (height < 0.2) return 'water';
      if (height < 0.34 && wet > 0.66) return 'swamp';
      return wet < 0.3 ? 'grassland' : 'forest';
    case 'mountains':
      if (height > 0.5) return 'mountains';
      if (height > 0.34) return 'hills';
      if (height < 0.18) return 'water';
      return wet > 0.55 ? 'forest' : 'grassland';
    case 'hills':
      if (height > 0.8) return 'mountains';
      if (height > 0.42) return 'hills';
      if (height < 0.18) return 'water';
      return wet > 0.6 ? 'forest' : 'grassland';
    case 'coast': {
      // Auf der einen Seite des Weges liegt das Meer; die Küstenlinie schwingt mit der Höhe.
      const shore = side + (0.5 - height) * 0.9;
      if (shore > 0.5) return 'water';
      if (shore > 0.22) return 'coast';
      if (height > 0.8) return 'hills';
      return wet > 0.62 ? 'forest' : 'grassland';
    }
    default:
      if (height > 0.84) return 'mountains';
      if (height > 0.68) return 'hills';
      if (height < 0.2) return 'water';
      if (height < 0.34 && wet > 0.68) return 'swamp';
      return wet > 0.6 ? 'forest' : 'grassland';
  }
}

export { CAVE_FEATURES, DEAD_END_FEATURES, FEATURES } from './tables';

// ── Erzeugen ───────────────────────────────────────────────────────────────

export interface GenerateInput {
  fromId: string;
  toId: string;
  distanceKm: number;
  biome: Terrain;
  hexKm: number;
  seed: number;
  /** Aus `recognize`: Richtung und Orte am Weg, soweit bekannt. */
  direction?: Recognition['direction'];
  between?: Recognition['between'];
  /** Aus `groundOf`: Dann folgen Meer, Küste und Höhen dem Atlas statt dem Zufall. */
  ground?: Ground;
  /** Aus `recognize`: der Landweg ums Wasser herum. Dann folgt die Karte ihm statt der Luftlinie. */
  route?: Recognition['route'];
  /** Orte, die schon auf Feldern stehen (Neu würfeln): Unter der Erde führen Gänge zu ihnen. */
  pinned?: { q: number; r: number; placeId: string }[];
  /** Die Tabellen des Spielleiters (`generatorTables`); ohne sie gelten die Vorgaben. */
  tables?: GeneratorTables;
  /** Das Klima (aus `recognize`) – oben wählt es Geländearten wie Dschungel oder Tundra. */
  climate?: ClimatePreset | null;
}

/** So viele Felder hat eine Karte höchstens; breitere Streifen werden schmaler gemacht. */
export const MAX_HEXES = 1400;
/** Anteil der Felder mit einer Besonderheit. */
const FEATURE_SHARE = 0.16;
/**
 * Fundstellen und Verborgenes (Wunsch 17. 11.: „Nicht jedes Hex darf mit allem voll sein“): ein
 * Feld bekommt höchstens eins – eine Besonderheit, eine Fundstelle oder etwas Verborgenes –,
 * Fundstellen liegen mindestens drei Felder auseinander, Verborgenes nie nebeneinander.
 */
const SITE_SHARE = 0.09;
const SITE_SPACING = 3;
const HIDDEN_SHARE = 0.07;

export interface GeneratedMap {
  hexes: Hex[];
  /** Unter der Erde: wie gut das Höhlennetz geraten ist (`domain/caves.ts`). */
  caves?: CaveQuality;
  /** Felder des direkten Weges, vom Start zum Ziel. */
  line: HexCoord[];
  /** Halbe Breite des Streifens in Feldern. */
  radius: number;
}

/**
 * Baut das Gelände. Start liegt auf (0, 0), das Ziel in der bekannten Richtung (Norden oben),
 * sonst genau im Osten. Die Felder stehen auf der Spitze: Ost–West ist eine gerade Reihe, sodass
 * die Zahl der Felder dort der Entfernung entspricht. In schräge Richtungen ist der Weg über
 * Felder bis zu einem Siebtel länger als die Luftlinie – wie bei jeder Hexkarte.
 */
export function generateHexes(input: GenerateInput): GeneratedMap {
  if (input.biome === 'underdark') return generateUnderdark(input);
  const length = Math.max(1, Math.round(input.distanceKm / input.hexKm));
  const dir = input.direction ?? { x: 1, y: 0 };
  const start: HexCoord = { q: 0, r: 0 };
  // Mit einem Landweg führt die Karte über dessen Punkte; das Ziel liegt, wo der Planet es hat.
  const stops = (input.route ?? []).map((point) =>
    hexAt(point.x / input.hexKm, point.y / input.hexKm),
  );
  let end = stops.length ? stops[stops.length - 1]! : hexAt(dir.x * length, dir.y * length);
  if (hexDistance(start, end) === 0) end = { q: 1, r: 0 };
  let line = hexLine(start, end);
  if (stops.length > 1) {
    line = [start];
    for (const stop of [...stops.slice(0, -1), end]) {
      const last = line[line.length - 1]!;
      if (hexDistance(last, stop) > 0) line.push(...hexLine(last, stop).slice(1));
    }
  }
  // Orte am Weg liegen entlang der Luftlinie – so lang ist sie in Feldern.
  const span = stops.length ? hexDistance(start, end) : length;
  let radius = Math.min(7, Math.max(3, Math.round(line.length / 7)));
  let cells = hexBand(line, radius);
  while (radius > 2 && cells.length > MAX_HEXES) cells = hexBand(line, --radius);

  // Bekannte Orte: Start, Ziel und was die Karte dazwischen zeigt.
  const places = new Map<string, string>([
    [hexKey(start), input.fromId],
    [hexKey(end), input.toId],
  ]);
  const inside = new Set(cells.map(hexKey));
  for (const between of input.between ?? []) {
    const along = between.along * span;
    const offset = between.offsetKm / input.hexKm;
    // Quer zum Weg: die Richtung um 90° gedreht.
    const hex = hexAt(dir.x * along - dir.y * offset, dir.y * along + dir.x * offset);
    const key = hexKey(hex);
    if (inside.has(key) && !places.has(key)) places.set(key, between.placeId);
  }

  const onLine = new Set(line.map(hexKey));
  // Züge der Landschaft sind einige Felder groß; bei kurzen Karten entsprechend kleiner.
  const grain = Math.max(2.5, Math.min(6, line.length / 4));
  const hexes: Hex[] = [];
  const ground = input.ground;
  const sea = new Set<string>();
  /** Höhe, Feuchte und Flecken je Feld – daraus folgen die Geländearten (`kinds.ts`). */
  const fields = new Map<string, Field>();
  for (const cell of cells) {
    const { x, y } = hexCenter(cell);
    const height = terrainNoise(input.seed, x / grain, y / grain);
    const wet = terrainNoise(input.seed + 7919, x / grain + 31.7, y / grain - 12.3);
    // Lage quer zum Weg, von −1 (links) bis +1 (rechts).
    const side = Math.max(-1, Math.min(1, (-dir.y * x + dir.x * y) / Math.max(1, radius)));
    const key = hexKey(cell);
    fields.set(key, {
      height,
      wet,
      patch: terrainNoise(input.seed + 104729, x / (grain * 0.7) + 5.1, y / (grain * 0.7) - 3.3),
    });
    const sample = ground?.(x * input.hexKm, y * input.hexKm);
    let terrain = sample
      ? groundTerrain(input.biome, sample, height, wet)
      : terrainOf(input.biome, height, wet, side);
    if (sample) {
      // Der Atlas gilt: Auch der direkte Weg kann übers Meer führen. Nur Orte stehen an Land.
      if (sample.water === 'sea') sea.add(key);
      // Ein Landweg ums Meer bleibt an Land: Wo er die Küste streift, führt er am Ufer entlang.
      if (terrain === 'water' && (places.has(key) || (stops.length > 0 && onLine.has(key)))) {
        terrain = 'coast';
        sea.delete(key);
      }
    } else if (
      terrain === 'water' &&
      input.biome !== 'water' &&
      (onLine.has(key) || places.has(key))
    )
      // Zwischen zwei Orten führt der direkte Weg nicht durch offenes Wasser – und Orte stehen an Land.
      terrain = input.biome === 'coast' ? 'coast' : input.biome === 'swamp' ? 'swamp' : input.biome;
    hexes.push({
      q: cell.q,
      r: cell.r,
      terrain,
      placeId: places.get(key) ?? null,
      note: '',
      discovered: key === hexKey(start),
      prepared: '',
      feature: '',
      river: terrain === 'water' ? '' : (sample?.river ?? ''),
      tableIds: [],
      regionId: null,
      road: 'none',
      roadLinks: null,
      riverLinks: null,
      roadId: null,
      riverId: null,
      manual: false,
      exits: null,
      level: 0,
      sign: '',
      dug: false,
      afar: '',
      sighted: false,
      hidden: '',
      searched: false,
      kind: null,
    });
  }

  // Am Meer liegt die Küste: flaches Land neben einem Feld offener See.
  if (sea.size)
    for (const hex of hexes)
      if (
        hex.terrain !== 'water' &&
        hex.terrain !== 'mountains' &&
        hexNeighbors(hex).some((n) => sea.has(hexKey(n)))
      )
        hex.terrain = 'coast';

  // Geländearten: Wiese, Moor, Hochgebirge … nach Höhe, Feuchte, Klima und Nachbarn.
  assignSurfaceKinds(hexes, fields, warmthOf(input.climate, input.biome), input.seed);

  // Besonderheiten: verstreut, nie zwei nebeneinander, nicht auf Feldern mit einem Ort.
  const byKey = new Map(hexes.map((hex) => [hexKey(hex), hex]));
  const tables = input.tables ?? DEFAULT_GENERATOR_TABLES;
  for (const hex of hexes) {
    if (hex.placeId || !hex.terrain) continue;
    const table = tables.slot(`feature:${hex.terrain}`);
    const rng = rngOf(seedOf(input.seed, 'feature', hex.q, hex.r));
    if (!table?.rows.length || !rng.chance(FEATURE_SHARE)) continue;
    if (hexNeighbors(hex).some((n) => byKey.get(hexKey(n))?.feature)) continue;
    hex.feature = entryParts(pickFrom(table, rng.int)).here;
  }
  placeFindings(hexes, input.seed, tables, (hex) =>
    hex.terrain && hex.terrain !== 'water' ? 'site' : null,
  );
  return { hexes, line, radius };
}

/**
 * Fundstellen und Verborgenes aus den Tabellen, selten und verstreut. Eine Fundstelle schreibt,
 * was die Gruppe vorfindet (Besonderheit), was man von fern sieht (unter der Erde: von nebenan,
 * die Witterung) und was verborgen liegt.
 */
function placeFindings(
  hexes: Hex[],
  seed: number,
  tables: GeneratorTables,
  slotOf: (hex: Hex) => string | null,
): void {
  const sites: Hex[] = [];
  const taken = (hex: Hex) => !!(hex.placeId || hex.feature || hex.afar || hex.hidden || hex.sign);
  for (const hex of hexes) {
    const slot = slotOf(hex);
    if (!slot || taken(hex)) continue;
    const rng = rngOf(seedOf(seed, 'fundstelle', hex.q, hex.r, hex.level));
    if (!rng.chance(SITE_SHARE)) continue;
    if (sites.some((site) => site.level === hex.level && hexDistance(site, hex) < SITE_SPACING))
      continue;
    const table = tables.slot(slot);
    if (!table?.rows.length) continue;
    const parts = entryParts(pickFrom(table, rng.int));
    if (!parts.here && !parts.afar && !parts.hidden) continue;
    hex.feature = parts.here;
    if (hex.exits === null) hex.afar = parts.afar;
    else hex.sign = parts.afar;
    hex.hidden = parts.hidden;
    sites.push(hex);
  }
  const byKey = new Map(hexes.map((hex) => [hexKey(hex), hex]));
  for (const hex of hexes) {
    if (!slotOf(hex) || taken(hex)) continue;
    const rng = rngOf(seedOf(seed, 'verborgen', hex.q, hex.r, hex.level));
    if (!rng.chance(HIDDEN_SHARE)) continue;
    if (hexNeighbors(hex).some((n) => byKey.get(hexKey(n))?.hidden)) continue;
    const table = tables.slot('hidden');
    if (!table?.rows.length) continue;
    hex.hidden = entryParts(pickFrom(table, rng.int)).here;
  }
}

// ── Unter der Erde ─────────────────────────────────────────────────────────

/** Felder unter der Erde höchstens, über alle Ebenen. */
const MAX_CAVE_HEXES = 2400;

/**
 * Das Unterreich zwischen zwei Orten: ein Höhlennetz auf ein bis drei Ebenen
 * (`generateCaves`) – Gänge, Kreuzungen, Höhlen, Schächte, ein Fluss, Sackgassen und
 * verborgene Gänge; alles andere ist Fels. Start, Ziel und Orte am Weg liegen auf der obersten.
 */
function generateUnderdark(input: GenerateInput): GeneratedMap {
  const length = Math.max(1, Math.round(input.distanceKm / input.hexKm));
  const dir = input.direction ?? { x: 1, y: 0 };
  const start: HexCoord = { q: 0, r: 0 };
  let end = hexAt(dir.x * length, dir.y * length);
  if (hexDistance(start, end) === 0) end = { q: 1, r: 0 };
  const line = hexLine(start, end);
  const levels = line.length >= 14 ? 3 : line.length >= 4 ? 2 : 1;
  let radius = Math.min(6, Math.max(2, Math.round(line.length / 4)));
  let cells = hexBand(line, radius);
  while (radius > 2 && cells.length * levels > MAX_CAVE_HEXES) cells = hexBand(line, --radius);

  const places = new Map<string, string>([
    [hexKey(start), input.fromId],
    [hexKey(end), input.toId],
  ]);
  const inside = new Set(cells.map(hexKey));
  for (const between of input.between ?? []) {
    const along = between.along * length;
    const offset = between.offsetKm / input.hexKm;
    const hex = hexAt(dir.x * along - dir.y * offset, dir.y * along + dir.x * offset);
    const key = hexKey(hex);
    if (inside.has(key) && !places.has(key)) places.set(key, between.placeId);
  }
  for (const pin of input.pinned ?? []) {
    const key = hexKey(pin);
    if (inside.has(key) && !places.has(key) && ![...places.values()].includes(pin.placeId))
      places.set(key, pin.placeId);
  }
  const fixed = [...places.keys()].map((key) => cells.find((c) => hexKey(c) === key)!);

  const caves = generateCaves({ cells, start, goal: end, levels, seed: input.seed, fixed });
  const tables = input.tables ?? DEFAULT_GENERATOR_TABLES;
  const featureOf = (slot: string, rng: ReturnType<typeof rngOf>) => {
    const table = tables.slot(slot);
    return table?.rows.length ? entryParts(pickFrom(table, rng.int)).here : '';
  };
  const hexes: Hex[] = caves.cells.map((cell) => {
    const rng = rngOf(seedOf(input.seed, 'hoehle', cell.q, cell.r, cell.level));
    const top = cell.level === 0;
    const feature =
      cell.role === 'cave'
        ? featureOf('feature:cave', rng)
        : cell.role === 'deadend'
          ? featureOf('feature:deadend', rng)
          : '';
    return {
      q: cell.q,
      r: cell.r,
      level: cell.level,
      terrain: 'underdark',
      placeId: top ? (places.get(hexKey(cell)) ?? null) : null,
      note: '',
      discovered: top && cell.q === start.q && cell.r === start.r,
      prepared: '',
      feature,
      river: cell.river ? 'Unterirdischer Fluss' : '',
      tableIds: [],
      regionId: null,
      road: 'none',
      roadLinks: null,
      riverLinks: null,
      roadId: null,
      riverId: null,
      manual: false,
      exits: cell.exits,
      sign: '',
      dug: false,
      afar: '',
      sighted: false,
      hidden: '',
      searched: false,
      kind: null,
    };
  });
  // Fundstellen in Gängen und Kreuzungen – Höhlen und Sackgassen haben schon ihr Gepräge.
  const roles = new Map(caves.cells.map((cell) => [hexKey(cell), cell.role]));
  placeFindings(hexes, input.seed, tables, (hex) => {
    const role = roles.get(hexKey(hex));
    return role === 'tunnel' || role === 'junction' ? 'site:underdark' : null;
  });
  // Geländearten unter der Erde: aus Höhlen, Tiefe und Wasser – nie aus Klima oder Licht.
  const cellAt = new Map(hexes.map((hex) => [hexKey(hex), hex]));
  for (const hex of hexes) {
    const role = roles.get(hexKey(hex)) ?? 'rock';
    const nearWater = !!hex.river || hexNeighbors(hex).some((n) => !!cellAt.get(hexKey(n))?.river);
    const patch = smoothNoise(seedOf(input.seed, 'art', hex.level), hex.q / 3, hex.r / 3);
    hex.kind = caveKind(hex, role, caves.cells.length ? levels : 1, nearWater, patch);
  }
  return { hexes, line, radius, caves: caves.quality };
}

/** Die fertige Karte als Erkundungsgebiet. */
export function generateArea(data: CampaignData, input: GenerateInput, name?: string): Area {
  const { hexes } = generateHexes({
    ...input,
    tables: input.tables ?? generatorTables(data),
    climate:
      input.climate !== undefined
        ? input.climate
        : recognize(data, input.fromId, input.toId).climate,
  });
  const stamp = nowIso();
  const fromName = data.entities[input.fromId]?.name ?? 'Start';
  const toName = data.entities[input.toId]?.name ?? 'Ziel';
  return AreaSchema.parse({
    id: newId(),
    created: stamp,
    updated: stamp,
    name: name?.trim() || `${fromName} → ${toName}`,
    hexKm: input.hexKm,
    orientation: 'pointy',
    hexes,
    fromId: input.fromId,
    toId: input.toId,
    biome: input.biome,
    seed: input.seed,
    distanceKm: input.distanceKm,
  });
}

// ── Lesen ──────────────────────────────────────────────────────────────────

/** Wie viele Felder welches Gelände haben, häufigstes zuerst. */
export function terrainShares(area: Pick<Area, 'hexes'>): { terrain: Terrain; count: number }[] {
  const counts = new Map<Terrain, number>();
  for (const hex of area.hexes)
    if (hex.terrain) counts.set(hex.terrain, (counts.get(hex.terrain) ?? 0) + 1);
  return [...counts]
    .map(([terrain, count]) => ({ terrain, count }))
    .sort(
      (a, b) =>
        b.count - a.count || TERRAIN_LABEL[a.terrain].localeCompare(TERRAIN_LABEL[b.terrain]),
    );
}

/** Der direkte Weg einer erzeugten Karte: vom Feld des Startortes zum Feld des Zielortes. */
export function areaLine(area: Pick<Area, 'hexes' | 'fromId' | 'toId'>): HexCoord[] {
  const start = area.hexes.find((h) => h.placeId !== null && h.placeId === area.fromId);
  const end = area.hexes.find((h) => h.placeId !== null && h.placeId === area.toId);
  return start && end ? hexLine(start, end) : [];
}
