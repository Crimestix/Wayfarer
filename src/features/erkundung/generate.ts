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
import { normalize, placeAncestors } from '../../domain/derive';
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
import { rngOf, seedOf } from '../../domain/random';
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

/** Feldgröße, bei der der direkte Weg überschaubar bleibt. */
export function suggestHexKm(distanceKm: number | null): number {
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
): { biome: Terrain; source: string } {
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
      path.terrain !== 'urban'
    )
      hit(path.terrain, 4, path.name ? `Weg „${path.name}“` : 'gespeicherter Weg');

  let best: Terrain | null = null;
  for (const [terrain, entry] of scores)
    if (best === null || entry.score > scores.get(best)!.score) best = terrain;
  if (best === null)
    return {
      biome: 'grassland',
      source:
        'Nichts in der Welt deutet auf eine besondere Landschaft – angenommen ist offenes Land.',
    };
  return {
    biome: best,
    source: `Erkannt an ${[...scores.get(best)!.from].map((n) => (n.startsWith('Karte') || n.startsWith('Weg') || n === 'gespeicherter Weg' ? n : `„${n}“`)).join(', ')}.`,
  };
}

/** Was die Welt über die Strecke zwischen zwei Orten weiß. */
export function recognize(data: CampaignData, fromId: string, toId: string): Recognition {
  const { biome, source: biomeSource } = recognizeBiome(data, [fromId, toId]);
  let distanceKm: number | null = null;
  let distanceSource = 'Die Welt kennt die Entfernung nicht – bitte eintragen.';
  let direction: Recognition['direction'] = null;
  const between: Recognition['between'] = [];

  const from = markerOf(data, fromId);
  const to = from ? from.map.markers.find((m) => m.entityId === toId) : undefined;
  if (from && to) {
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
  return {
    distanceKm,
    distanceSource,
    direction,
    between,
    biome,
    biomeSource,
    hexKm: suggestHexKm(distanceKm),
  };
}

// ── Gelände: zusammenhängend statt gewürfelt ───────────────────────────────

/** Fester Zufallswert in [0, 1) für einen Gitterpunkt. */
function lattice(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Weiches Rauschen: benachbarte Punkte haben ähnliche Werte. */
function smoothNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = lattice(seed, x0, y0) * (1 - sx) + lattice(seed, x0 + 1, y0) * sx;
  const bottom = lattice(seed, x0, y0 + 1) * (1 - sx) + lattice(seed, x0 + 1, y0 + 1) * sx;
  return top * (1 - sy) + bottom * sy;
}

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

/** Besonderheiten der Landschaft – das, wofür andere eine Entdeckungstabelle würfeln. */
export const FEATURES: Record<Terrain, string[]> = {
  grassland: [
    'Einzelner alter Baum',
    'Flacher Bachlauf',
    'Felsblock im offenen Land',
    'Wildblumenwiese',
    'Verfallene Wegmarke',
    'Ausgetretener Wildwechsel',
    'Kleiner Tümpel',
    'Windschiefe Feldscheune',
  ],
  forest: [
    'Lichtung',
    'Uralter Baumriese',
    'Windbruch',
    'Moosbedeckter Findling',
    'Bachlauf',
    'Verlassene Köhlerstelle',
    'Dichtes Unterholz',
    'Hohler Baum',
  ],
  hills: [
    'Aussichtskuppe',
    'Steiniger Hohlweg',
    'Quelle am Hang',
    'Verfallene Schäferhütte',
    'Felsüberhang',
    'Geröllfeld',
    'Alter Grenzstein',
    'Einsame Baumgruppe',
  ],
  mountains: [
    'Schmaler Pass',
    'Geröllhalde',
    'Wasserfall',
    'Höhleneingang',
    'Felsnadel',
    'Schneefeld',
    'Bergsee',
    'Steile Klamm',
  ],
  swamp: [
    'Trockene Insel im Moor',
    'Schwarzes Wasserloch',
    'Nebelsenke',
    'Alter Knüppeldamm',
    'Versunkene Baumstümpfe',
    'Schilfdickicht',
    'Torfstich',
    'Faulig riechender Grund',
  ],
  desert: [
    'Wasserloch',
    'Felsbogen',
    'Wanderdüne',
    'Ausgetrocknetes Flussbett',
    'Salzpfanne',
    'Windgeschliffene Felsen',
    'Dornengestrüpp',
    'Schattige Felsnische',
  ],
  arctic: [
    'Gletscherspalte',
    'Eishöhle',
    'Windgepeitschter Grat',
    'Zugefrorener See',
    'Schneewechte',
    'Heiße Quelle',
    'Blankes Eisfeld',
    'Geschützte Senke',
  ],
  coast: [
    'Felsbucht',
    'Gezeitentümpel',
    'Treibholzstrand',
    'Steilklippe',
    'Sandbank',
    'Seevogelkolonie',
    'Dünengürtel',
    'Angespültes Wrackteil',
  ],
  water: [
    'Sandbank',
    'Felsriff',
    'Starke Strömung',
    'Treibgutfeld',
    'Kleine Felseninsel',
    'Nebelbank',
    'Untiefe',
    'Tangteppich',
  ],
  underdark: [
    'Tropfsteinhalle',
    'Enger Kriechgang',
    'Leuchtende Flechten',
    'Eingestürzter Stollen',
    'Heiße Quelle',
    'Pilzhain',
    'Tiefe Kluft',
    'Kristalladern',
    'Alte Wegmarke',
    'Unterirdischer Wasserlauf',
  ],
  urban: [],
};

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
}

/** So viele Felder hat eine Karte höchstens; breitere Streifen werden schmaler gemacht. */
export const MAX_HEXES = 1400;
/** Anteil der Felder mit einer Besonderheit. */
const FEATURE_SHARE = 0.16;

export interface GeneratedMap {
  hexes: Hex[];
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
  const length = Math.max(1, Math.round(input.distanceKm / input.hexKm));
  const dir = input.direction ?? { x: 1, y: 0 };
  const start: HexCoord = { q: 0, r: 0 };
  let end = hexAt(dir.x * length, dir.y * length);
  if (hexDistance(start, end) === 0) end = { q: 1, r: 0 };
  const line = hexLine(start, end);
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
    const along = between.along * length;
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
  for (const cell of cells) {
    const { x, y } = hexCenter(cell);
    const height = terrainNoise(input.seed, x / grain, y / grain);
    const wet = terrainNoise(input.seed + 7919, x / grain + 31.7, y / grain - 12.3);
    // Lage quer zum Weg, von −1 (links) bis +1 (rechts).
    const side = Math.max(-1, Math.min(1, (-dir.y * x + dir.x * y) / Math.max(1, radius)));
    let terrain = terrainOf(input.biome, height, wet, side);
    const key = hexKey(cell);
    // Zwischen zwei Orten führt der direkte Weg nicht durch offenes Wasser – und Orte stehen an Land.
    if (terrain === 'water' && input.biome !== 'water' && (onLine.has(key) || places.has(key)))
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
      tableIds: [],
    });
  }

  // Besonderheiten: verstreut, nie zwei nebeneinander, nicht auf Feldern mit einem Ort.
  const byKey = new Map(hexes.map((hex) => [hexKey(hex), hex]));
  for (const hex of hexes) {
    if (hex.placeId || !hex.terrain) continue;
    const options = FEATURES[hex.terrain];
    const rng = rngOf(seedOf(input.seed, 'feature', hex.q, hex.r));
    if (!options.length || !rng.chance(FEATURE_SHARE)) continue;
    if (hexNeighbors(hex).some((n) => byKey.get(hexKey(n))?.feature)) continue;
    hex.feature = rng.pick(options)!;
  }
  return { hexes, line, radius };
}

/** Die fertige Karte als Erkundungsgebiet. */
export function generateArea(data: CampaignData, input: GenerateInput, name?: string): Area {
  const { hexes } = generateHexes(input);
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
