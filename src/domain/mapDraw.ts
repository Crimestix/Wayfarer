/**
 * Gezeichnete Karten: „Jeder Strich bedeutet etwas.“ Eine Karte ist kein Bild, sondern Formen –
 * Pinselstriche für das Gelände, Linien für Straßen, Pfade und Flüsse, Punkte für Orte. Aus den
 * Formen liest Wayfarer, was an einer Stelle ist, wie lang ein Weg ist und wie lange man für ihn
 * braucht. Wie die Karte aussieht, ist Sache des Zeichners (`features/karten`).
 *
 * Reine Funktionen. Koordinaten sind Karteneinheiten; der Maßstab (`map.scale`) sagt, wie viele
 * Kilometer eine Einheit ist.
 */
import { placeAncestors } from './derive';
import type {
  CampaignData,
  GameMap,
  MapGround,
  MapLine,
  MapMarker,
  MapStroke,
  Terrain,
} from './schema';

/** Tempo zu Fuß nach den Reiseregeln, normales Tempo: 3 Meilen je Stunde. */
const WALK_KMH = 4.8;

export interface GroundType {
  label: string;
  /** Das Gelände nach den Reiseregeln – für Tempo, Begegnungen und Hexkarten. */
  terrain: Terrain;
  /** Schwieriges Gelände: abseits von Straßen kommt man nur halb so schnell voran. */
  difficult: boolean;
  /** Wasser: zu Fuß nicht begehbar, außer über eine Straße (Brücke, Furt). */
  water: boolean;
  /** Fels oder Abgrund: kein Durchkommen, außer auf einem Gang. */
  solid: boolean;
  /** Welches Zeichen der Zeichner dort verstreut. */
  symbol: 'tree' | 'hill' | 'peak' | 'reed' | 'dune' | 'mushroom' | 'stone' | null;
}

const ground = (
  label: string,
  terrain: Terrain,
  traits: Partial<Pick<GroundType, 'difficult' | 'water' | 'solid' | 'symbol'>> = {},
): GroundType => ({
  label,
  terrain,
  difficult: false,
  water: false,
  solid: false,
  symbol: null,
  ...traits,
});

export const GROUNDS: Record<MapGround, GroundType> = {
  plain: ground('Ebene', 'grassland'),
  forest: ground('Wald', 'forest', { difficult: true, symbol: 'tree' }),
  hills: ground('Hügel', 'hills', { difficult: true, symbol: 'hill' }),
  mountains: ground('Gebirge', 'mountains', { difficult: true, symbol: 'peak' }),
  swamp: ground('Sumpf', 'swamp', { difficult: true, symbol: 'reed' }),
  desert: ground('Wüste', 'desert', { difficult: true, symbol: 'dune' }),
  snow: ground('Schnee und Eis', 'arctic', { difficult: true }),
  water: ground('Wasser', 'water', { water: true }),
  rock: ground('Fels', 'underdark', { solid: true }),
  cave: ground('Höhle', 'underdark'),
  fungus: ground('Pilzwald', 'underdark', { difficult: true, symbol: 'mushroom' }),
  rubble: ground('Geröll', 'underdark', { difficult: true, symbol: 'stone' }),
  chasm: ground('Abgrund', 'underdark', { solid: true }),
};

/** Welches Gelände sich auf welcher Ebene malen lässt – das erste ist der übliche Grund. */
export const LEVEL_GROUNDS: Record<GameMap['level'], readonly MapGround[]> = {
  surface: ['plain', 'forest', 'hills', 'mountains', 'swamp', 'desert', 'snow', 'water'],
  underground: ['rock', 'cave', 'fungus', 'rubble', 'water', 'chasm'],
};

const LINE_LABEL: Record<MapLine['kind'], string> = {
  road: 'Straße',
  path: 'Pfad',
  river: 'Fluss',
  border: 'Grenze',
};

/** Unter der Erde ist die Straße ein Gang: Er gräbt sich durch den Fels. */
export const lineLabel = (kind: MapLine['kind'], level: GameMap['level']): string =>
  level === 'underground' && kind === 'road' ? 'Gang' : LINE_LABEL[kind];

/** Breite eines Ganges in Karteneinheiten. */
export const TUNNEL_WIDTH = 12;

type Point = readonly [number, number];

/** Abstand eines Punktes zu einer Strecke. */
function segmentDistance(px: number, py: number, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / length));
  return Math.hypot(a[0] + t * dx - px, a[1] + t * dy - py);
}

/** Abstand eines Punktes zu einer Linie aus mehreren Strecken. */
export function lineDistance(points: readonly Point[], x: number, y: number): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(points[0]![0] - x, points[0]![1] - y);
  let best = Infinity;
  for (let i = 1; i < points.length; i++)
    best = Math.min(best, segmentDistance(x, y, points[i - 1]!, points[i]!));
  return best;
}

/** Der Kasten um einen Pinselstrich – gemerkt, damit die Frage „was ist hier?“ schnell bleibt. */
const boxes = new WeakMap<MapStroke, readonly [number, number, number, number]>();
function boxOf(stroke: MapStroke): readonly [number, number, number, number] {
  let box = boxes.get(stroke);
  if (!box) {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of stroke.points) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const half = stroke.width / 2;
    box = [x0 - half, y0 - half, x1 + half, y1 + half];
    boxes.set(stroke, box);
  }
  return box;
}

/** Liegt die Stelle unter diesem Pinselstrich? */
export function strokeCovers(stroke: MapStroke, x: number, y: number): boolean {
  const box = boxOf(stroke);
  if (x < box[0] || y < box[1] || x > box[2] || y > box[3]) return false;
  if (stroke.cap !== 'butt') return lineDistance(stroke.points, x, y) <= stroke.width / 2;
  // Stumpfe Enden: Die Stelle muss neben einer Strecke liegen, nicht vor oder hinter ihr.
  for (let i = 1; i < stroke.points.length; i++) {
    const [a, b] = [stroke.points[i - 1]!, stroke.points[i]!];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const length = dx * dx + dy * dy;
    if (length === 0) continue;
    const t = ((x - a[0]) * dx + (y - a[1]) * dy) / length;
    if (t < 0 || t > 1) continue;
    if (Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y) <= stroke.width / 2) return true;
  }
  return false;
}

type Painted = Pick<GameMap, 'strokes' | 'ground'> & Partial<Pick<GameMap, 'lines' | 'level'>>;

/**
 * Das Gelände an einer Stelle: der oberste Pinselstrich, der sie bedeckt – sonst der Grund der
 * Karte. Unter der Erde ist ein Gang durch den Fels begehbarer Boden.
 */
export function groundAt(map: Painted, x: number, y: number): MapGround {
  let found = map.ground;
  for (let i = map.strokes.length - 1; i >= 0; i--)
    if (strokeCovers(map.strokes[i]!, x, y)) {
      found = map.strokes[i]!.ground;
      break;
    }
  if (found === 'rock' && map.level === 'underground' && map.lines)
    for (const line of map.lines)
      if (line.kind === 'road' && lineDistance(line.points, x, y) <= TUNNEL_WIDTH / 2)
        return 'cave';
  return found;
}

/** Länge einer Linie in Karteneinheiten. */
export function unitsOf(points: readonly Point[]): number {
  let units = 0;
  for (let i = 1; i < points.length; i++)
    units += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  return units;
}

/** Länge einer Linie in Kilometern – null, wenn die Karte keinen Maßstab hat. */
export function kmOf(map: Pick<GameMap, 'scale'>, points: readonly Point[]): number | null {
  const scale = map.scale?.kmPerUnit;
  return scale ? unitsOf(points) * scale : null;
}

export interface Walk {
  km: number;
  minutes: number;
  /** Anteil der Strecke durch schwieriges Gelände (0…1). */
  difficult: number;
  /** Die Strecke führt durch Wasser, ohne dass eine Straße (Brücke, Furt) sie trägt. */
  wet: boolean;
  /** Die Strecke führt durch Fels oder über einen Abgrund, ohne dass ein Gang sie trägt. */
  blocked: boolean;
}

/**
 * Wie lange man eine Linie entlang zu Fuß braucht: Stück für Stück nach dem Gelände darunter. Auf
 * einer Straße zählt schwieriges Gelände nicht, auf einem Pfad und querfeldein halbiert es das
 * Tempo. Null ohne Maßstab.
 */
export function walkAlong(
  map: Painted & Pick<GameMap, 'scale'>,
  points: readonly Point[],
  road: boolean,
): Walk | null {
  const scale = map.scale?.kmPerUnit;
  if (!scale || points.length < 2) return null;
  let km = 0;
  let hours = 0;
  let hard = 0;
  let wet = false;
  let blocked = false;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1]!, points[i]!];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // In Stücken von höchstens einem Hundertstel der Karte abtasten.
    const parts = Math.max(1, Math.ceil(length / 8));
    for (let k = 0; k < parts; k++) {
      const t = (k + 0.5) / parts;
      const ground = GROUNDS[groundAt(map, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)];
      const part = (length / parts) * scale;
      const slow = !road && ground.difficult;
      if (ground.water && !road) wet = true;
      if (ground.solid && !road) blocked = true;
      km += part;
      hard += slow ? part : 0;
      hours += (part / WALK_KMH) * (slow ? 2 : 1);
    }
  }
  return {
    km,
    minutes: Math.max(1, Math.round(hours * 60)),
    difficult: km ? hard / km : 0,
    wet,
    blocked,
  };
}

/**
 * Der Punkt, an dem ein Ort auf einer Karte steht: sein eigener – sonst der des nächsten Ortes
 * darüber, der auf der Karte eingetragen ist (die Schenke steht dann am Punkt ihrer Stadt).
 */
export function markerOfPlace(
  data: CampaignData,
  map: Pick<GameMap, 'markers'>,
  placeId: string | null | undefined,
): MapMarker | null {
  if (!placeId) return null;
  for (const id of [placeId, ...placeAncestors(data, placeId).map((place) => place.id)]) {
    const marker = map.markers.find((entry) => entry.entityId === id);
    if (marker) return marker;
  }
  return null;
}

const belowCache = new WeakMap<CampaignData['maps'], ReadonlyMap<string, GameMap>>();

/**
 * Was auf einer gezeichneten Karte des Unterreichs als Punkt steht, liegt unter der Erde – je
 * Eintrag die Karte, die das sagt. Wer zugleich auf einer gezeichneten Karte der Oberwelt steht
 * (ein Aufgang, ein Tor), zählt nicht: Er bleibt, was er sonst ist.
 */
export function placesBelow(maps: CampaignData['maps']): ReadonlyMap<string, GameMap> {
  const known = belowCache.get(maps);
  if (known) return known;
  const below = new Map<string, GameMap>();
  const above = new Set<string>();
  for (const map of Object.values(maps)) {
    if (map.kind !== 'drawn') continue;
    for (const marker of map.markers) {
      if (!marker.entityId) continue;
      if (map.level === 'underground') {
        if (!below.has(marker.entityId)) below.set(marker.entityId, map);
      } else above.add(marker.entityId);
    }
  }
  for (const id of above) below.delete(id);
  belowCache.set(maps, below);
  return below;
}

/** Der Kartenpunkt in der Nähe einer Stelle – der nächste innerhalb von `reach`. */
export function markerNear(
  markers: readonly MapMarker[],
  x: number,
  y: number,
  reach: number,
): MapMarker | null {
  let best: MapMarker | null = null;
  let distance = reach;
  for (const marker of markers) {
    const d = Math.hypot(marker.x - x, marker.y - y);
    if (d <= distance) {
      best = marker;
      distance = d;
    }
  }
  return best;
}

/**
 * Glättet eine gezogene Linie: lässt Punkte weg, die höchstens `tolerance` von der Verbindung
 * ihrer Nachbarn abweichen (Douglas–Peucker). Anfang und Ende bleiben.
 */
export function simplify(points: readonly Point[], tolerance: number): [number, number][] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]]);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    let worst = 0;
    let index = -1;
    for (let i = from + 1; i < to; i++) {
      const d = segmentDistance(points[i]![0], points[i]![1], points[from]!, points[to]!);
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (index >= 0 && worst > tolerance) {
      keep[index] = 1;
      stack.push([from, index], [index, to]);
    }
  }
  return points.filter((_, i) => keep[i]).map((p) => [p[0], p[1]]);
}

/** Wie viel der Karte welches Gelände bedeckt – grob gezählt, für die Übersicht. */
export function groundShares(
  map: Pick<GameMap, 'strokes' | 'ground' | 'frame'>,
  steps = 40,
): Partial<Record<MapGround, number>> {
  const frame = map.frame;
  if (!frame) return {};
  const count: Partial<Record<MapGround, number>> = {};
  for (let j = 0; j < steps; j++)
    for (let i = 0; i < steps; i++) {
      const ground = groundAt(
        map,
        ((i + 0.5) / steps) * frame.width,
        ((j + 0.5) / steps) * frame.height,
      );
      count[ground] = (count[ground] ?? 0) + 1;
    }
  const total = steps * steps;
  for (const key of Object.keys(count) as MapGround[]) count[key] = count[key]! / total;
  return count;
}
