/**
 * Karten – was die Seite wissen muss, ohne selbst zu rechnen: die Liste der Karten, der Ausschnitt
 * der Zeichenfläche und was eine Linie oder eine Stelle der Karte bedeutet.
 */
import {
  GROUNDS,
  groundAt,
  kmOf,
  lineDistance,
  DOOR_STATES,
  lineLabel,
  lineOfSign,
  markerNear,
  signLabel,
  signNear,
  signNote,
  signsAlong,
  walkAlong,
} from '../../domain/mapDraw';
import type { CampaignData, GameMap, MapGround, MapLine, MapSign } from '../../domain/schema';
import {
  describeVia,
  formatWayTime,
  routeBetween,
  routeDetour,
  routeNotes,
} from '../../domain/ways';

/** Pinselbreiten in Karteneinheiten (die Karte ist 1000 breit). */
export const BRUSHES = [
  { id: 'small', label: 'Fein', width: 22 },
  { id: 'medium', label: 'Mittel', width: 52 },
  { id: 'large', label: 'Breit', width: 110 },
] as const;
export type BrushId = (typeof BRUSHES)[number]['id'];

// ── Liste ──────────────────────────────────────────────────────────────────

export interface MapRow {
  id: string;
  name: string;
  /** „Gezeichnet · Hohenfurt“ */
  line: string;
  drawn: boolean;
}

const fold = (text: string) => text.toLocaleLowerCase('de').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Alle Karten: erst die gezeichneten, dann die Bildkarten, jeweils nach Namen. */
export function mapRows(data: Pick<CampaignData, 'maps' | 'entities'>, query = ''): MapRow[] {
  const needle = fold(query.trim());
  return Object.values(data.maps)
    .map((map): MapRow => {
      const place = map.placeId ? data.entities[map.placeId]?.name : undefined;
      const drawn = map.kind === 'drawn';
      const sort = drawn ? (map.level === 'underground' ? 'Unterreich' : 'Gezeichnet') : 'Bild';
      return {
        id: map.id,
        name: map.name || 'Karte ohne Namen',
        line: place && place !== map.name ? `${sort} · ${place}` : sort,
        drawn,
      };
    })
    .filter((row) => !needle || fold(`${row.name} ${row.line}`).includes(needle))
    .sort((a, b) => Number(b.drawn) - Number(a.drawn) || a.name.localeCompare(b.name, 'de'));
}

// ── Ausschnitt ─────────────────────────────────────────────────────────────

/** Ausschnitt der Zeichenfläche: `x`/`y` ist die Stelle der Karte oben links, `zoom` Pixel je Einheit. */
export interface View {
  zoom: number;
  x: number;
  y: number;
}
type Frame = { width: number; height: number };

/** Die ganze Karte, mittig, mit etwas Rand. */
export function fitView(frame: Frame, width: number, height: number): View {
  const zoom = Math.max(0.05, Math.min(width / frame.width, height / frame.height) * 0.94);
  return { zoom, x: frame.width / 2 - width / 2 / zoom, y: frame.height / 2 - height / 2 / zoom };
}

/** Hält die Karte im Blick: Mindestens ihre Mitte bleibt erreichbar. */
export function clampView(view: View, frame: Frame, width: number, height: number): View {
  const [w, h] = [width / view.zoom, height / view.zoom];
  return {
    zoom: view.zoom,
    x: Math.max(-w / 2, Math.min(frame.width - w / 2, view.x)),
    y: Math.max(-h / 2, Math.min(frame.height - h / 2, view.y)),
  };
}

/** Vergrößert um `factor`; die Stelle unter (px, py) bleibt, wo sie ist. */
export function zoomView(
  view: View,
  factor: number,
  px: number,
  py: number,
  frame: Frame,
  width: number,
  height: number,
): View {
  const least = fitView(frame, width, height).zoom * 0.6;
  const zoom = Math.max(least, Math.min(40, view.zoom * factor));
  const [mx, my] = [view.x + px / view.zoom, view.y + py / view.zoom];
  return clampView({ zoom, x: mx - px / zoom, y: my - py / zoom }, frame, width, height);
}

export const toMap = (view: View, px: number, py: number): [number, number] => [
  view.x + px / view.zoom,
  view.y + py / view.zoom,
];

/** Der Maßstabsbalken: eine runde Strecke, die höchstens `maxPx` breit ist. */
export function scaleBar(kmPerPx: number, maxPx = 150): { km: number; px: number } {
  const steps = [
    0.005, 0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000,
  ];
  let km = steps[0]!;
  for (const step of steps) if (step / kmPerPx <= maxPx) km = step;
  return { km, px: km / kmPerPx };
}

/** „35 km“, „3,2 km“ – unter einem Kilometer in Metern: „250 m“. */
export function formatLength(km: number): string {
  if (km < 1) return `${Math.round(km * 1000).toLocaleString('de-DE')} m`;
  return `${km.toLocaleString('de-DE', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

// ── Bedeutung ──────────────────────────────────────────────────────────────

/** Was ein Klick auf die Karte trifft: einen Ort, ein Zeichen, eine Linie oder das Gelände. */
export type Picked =
  | { kind: 'line'; id: string }
  | { kind: 'marker'; id: string }
  | { kind: 'sign'; id: string }
  | { kind: 'ground'; at: [number, number] };

/**
 * Was an einer Stelle der Karte liegt – ein Ort geht vor einem Zeichen (Tür, Falle), das vor
 * einer Linie, eine Linie vor dem Gelände.
 * `zoom` sind Bildschirmpunkte je Karteneinheit: Getroffen wird, was am Schirm nahe liegt.
 */
export function pickAt(map: GameMap, at: readonly [number, number], zoom: number): Picked | null {
  const marker = markerNear(map.markers, at[0], at[1], 12 / zoom);
  if (marker) return { kind: 'marker', id: marker.id };
  const sign = signNear(map.signs, at[0], at[1], 11 / zoom);
  if (sign) return { kind: 'sign', id: sign.id };
  let best: MapLine | null = null;
  let distance = 8 / zoom;
  for (const line of map.lines) {
    const d = lineDistance(line.points, at[0], at[1]);
    if (d <= distance) [best, distance] = [line, d];
  }
  if (best) return { kind: 'line', id: best.id };
  const frame = map.frame;
  const inside = frame && at[0] >= 0 && at[1] >= 0 && at[0] <= frame.width && at[1] <= frame.height;
  return inside ? { kind: 'ground', at: [at[0], at[1]] } : null;
}

/**
 * Der Weg der Gruppe zu einem Ort, in Worten: „14 Min.“, „mindestens 2 Std. über Markt“ – null,
 * wenn kein Weg bekannt ist oder die Gruppe schon dort steht.
 */
export function routeText(
  data: Pick<CampaignData, 'entities' | 'paths' | 'maps'>,
  fromId: string | null | undefined,
  toId: string,
): string | null {
  if (!fromId || fromId === toId) return null;
  const route = routeBetween(data, fromId, toId);
  if (!route) return null;
  const via = describeVia(data, route);
  const time =
    route.unknown && route.minutes === 0
      ? 'Dauer unbekannt'
      : `${route.unknown ? 'mindestens ' : ''}${formatWayTime(route.minutes)}`;
  return via ? `${time} ${via}` : time;
}

/**
 * Was die Gruppe auf dem Weg zu einem Ort aufhält oder erwartet: verschlossene Türen, Geheimtüren,
 * scharfe Fallen. `barred`: Der einzige Weg ist versperrt. `detour`: warum es einen Umweg geht.
 */
export function routeWarnings(
  data: Pick<CampaignData, 'entities' | 'paths' | 'maps'>,
  fromId: string | null | undefined,
  toId: string,
): { notes: string[]; barred: boolean; detour: string | null } {
  const route = fromId && fromId !== toId ? routeBetween(data, fromId, toId) : null;
  return route
    ? { notes: routeNotes(data, route), barred: route.barred, detour: routeDetour(data, route) }
    : { notes: [], barred: false, detour: null };
}

export interface SignFacts {
  /** „Tür“, „Geheimtür“, „Falle“ … */
  sort: string;
  /** „verschlossen“, „scharf“ … */
  state: string;
  /** Der Gang, die Straße oder der Pfad, an dem das Zeichen sitzt – null, wenn es frei steht. */
  on: { sort: string; name: string; way: { from: string; to: string } | null } | null;
  /** Was das für die Gruppe bedeutet, in einem Satz. */
  meaning: string;
}

export function signFacts(
  data: Pick<CampaignData, 'paths' | 'entities'>,
  map: GameMap,
  sign: MapSign,
): SignFacts {
  const sort = signLabel(sign, map.level);
  const found = lineOfSign(map, sign);
  const path = found?.line.pathId ? data.paths[found.line.pathId] : undefined;
  const way = path
    ? {
        from: data.entities[path.fromId]?.name ?? '?',
        to: data.entities[path.toId]?.name ?? '?',
      }
    : null;
  const on = found
    ? { sort: lineLabel(found.line.kind, map.level), name: found.line.name, way }
    : null;
  const between = way ? ` zwischen ${way.from} und ${way.to}` : '';
  let meaning: string;
  if (sign.kind === 'trap')
    meaning = !sign.armed
      ? 'Ausgelöst oder entschärft – hier droht nichts mehr.'
      : way
        ? `Wer den Weg${between} geht, kommt an ihr vorbei. Wayfarer erinnert vor dem Aufbruch daran.`
        : on
          ? 'Sie liegt auf der Linie. Führt die von Ort zu Ort, erinnert Wayfarer vor dem Aufbruch daran.'
          : 'Sie liegt an keinem Gang und keiner Straße – sie gilt für keinen Weg.';
  else if (!on) meaning = 'Sie steht an keinem Gang und keiner Straße – sie versperrt keinen Weg.';
  else if (sign.door === 'locked')
    meaning = way
      ? `Der Weg${between} ist versperrt, bis sie offen ist.`
      : 'Verschlossen. Führt die Linie von Ort zu Ort, ist dieser Weg versperrt.';
  else if (sign.hidden)
    meaning = way
      ? `Der Weg${between} führt durch sie – die Gruppe kennt sie noch nicht.`
      : 'Die Gruppe kennt sie noch nicht.';
  else meaning = sign.door === 'open' ? 'Sie steht offen.' : 'Sie ist zu, aber nicht verschlossen.';
  return {
    sort,
    state:
      sign.kind === 'trap'
        ? sign.armed
          ? 'scharf'
          : 'ausgelöst oder entschärft'
        : DOOR_STATES[sign.door],
    on,
    meaning,
  };
}

export interface LineFacts {
  /** „Straße“, „Fluss“ … – unter der Erde ist die Straße ein „Gang“. */
  sort: string;
  km: number | null;
  /** Zu Fuß, normales Tempo – nur für Straßen und Pfade. */
  minutes: number | null;
  /** Anteil der Strecke, auf dem schwieriges Gelände bremst (0…1). */
  difficult: number;
  /** Ein Pfad führt durch Wasser. */
  wet: boolean;
  /** Ein Pfad führt durch Fels oder über einen Abgrund. */
  blocked: boolean;
  /** Der Weg im Wegenetz, der aus der Linie entstanden ist. */
  way: { from: string; to: string } | null;
  /** Was an der Linie zu beachten ist: verschlossene Türen, Geheimtüren, scharfe Fallen. */
  notes: string[];
}

export function lineFacts(
  data: Pick<CampaignData, 'paths' | 'entities'>,
  map: GameMap,
  line: MapLine,
): LineFacts {
  const walkable = line.kind === 'road' || line.kind === 'path';
  const walk = walkable ? walkAlong(map, line.points, line.kind === 'road') : null;
  const path = line.pathId ? data.paths[line.pathId] : undefined;
  return {
    sort: lineLabel(line.kind, map.level),
    km: walk?.km ?? kmOf(map, line.points),
    minutes: walk?.minutes ?? null,
    difficult: walk?.difficult ?? 0,
    wet: walk?.wet ?? false,
    blocked: walk?.blocked ?? false,
    way: path
      ? {
          from: data.entities[path.fromId]?.name ?? '?',
          to: data.entities[path.toId]?.name ?? '?',
        }
      : null,
    notes: walkable
      ? signsAlong(map, line.points).flatMap((sign) => signNote(sign, map.level) ?? [])
      : [],
  };
}

/** Was an einer Stelle der Karte ist, in Worten. */
export function groundFacts(
  map: GameMap,
  x: number,
  y: number,
): { ground: MapGround; note: string } {
  const ground = groundAt(map, x, y);
  const type = GROUNDS[ground];
  return {
    ground,
    note: type.solid
      ? 'Kein Durchkommen. Nur ein Gang führt durch den Fels oder über einen Abgrund.'
      : type.water
        ? 'Zu Fuß nicht begehbar. Eine Straße oder ein Gang darüber gilt als Brücke oder Furt.'
        : type.difficult
          ? 'Schwieriges Gelände: Abseits von Straßen und Gängen kommt man nur halb so schnell voran.'
          : 'Leichtes Gelände: volles Tempo, auch abseits der Wege.',
  };
}
