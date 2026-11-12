/**
 * Karten – was die Seite wissen muss, ohne selbst zu rechnen: die Liste der Karten, der Ausschnitt
 * der Zeichenfläche und was eine Linie oder eine Stelle der Karte bedeutet.
 */
import { GROUNDS, LINE_LABEL, groundAt, kmOf, walkAlong } from '../../domain/mapDraw';
import type { CampaignData, GameMap, MapGround, MapLine } from '../../domain/schema';

/** Pinselbreiten in Karteneinheiten (die Karte ist 1000 breit). */
export const BRUSHES = [
  { id: 'small', label: 'Fein', width: 22 },
  { id: 'medium', label: 'Mittel', width: 52 },
  { id: 'large', label: 'Breit', width: 110 },
] as const;
export type BrushId = (typeof BRUSHES)[number]['id'];

/** Weite des Rasters, auf dem Bäume, Hügel und Gipfel stehen. */
export const SYMBOL_CELL = 21;

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
  const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  let km = steps[0]!;
  for (const step of steps) if (step / kmPerPx <= maxPx) km = step;
  return { km, px: km / kmPerPx };
}

// ── Bedeutung ──────────────────────────────────────────────────────────────

export interface LineFacts {
  /** „Straße“, „Fluss“ … */
  sort: string;
  km: number | null;
  /** Zu Fuß, normales Tempo – nur für Straßen und Pfade. */
  minutes: number | null;
  /** Anteil der Strecke, auf dem schwieriges Gelände bremst (0…1). */
  difficult: number;
  /** Ein Pfad führt durch Wasser. */
  wet: boolean;
  /** Der Weg im Wegenetz, der aus der Linie entstanden ist. */
  way: { from: string; to: string } | null;
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
    sort: LINE_LABEL[line.kind],
    km: walk?.km ?? kmOf(map, line.points),
    minutes: walk?.minutes ?? null,
    difficult: walk?.difficult ?? 0,
    wet: walk?.wet ?? false,
    way: path
      ? {
          from: data.entities[path.fromId]?.name ?? '?',
          to: data.entities[path.toId]?.name ?? '?',
        }
      : null,
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
    note: type.water
      ? 'Zu Fuß nicht begehbar. Eine Straße darüber gilt als Brücke oder Furt.'
      : type.difficult
        ? 'Schwieriges Gelände: Abseits von Straßen kommt man nur halb so schnell voran.'
        : 'Leichtes Gelände: volles Tempo, auch abseits der Wege.',
  };
}
