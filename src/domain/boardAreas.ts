/**
 * Bereiche auf dem Fadenbrett: benannte Rahmen zum Ordnen (`state.boardAreas`). Sie bedeuten für
 * die Welt nichts – sie sind die Ordnung des Spielleiters auf seinem Brett. Was mit seiner Mitte
 * in einem Bereich liegt, gehört zu ihm und zieht mit, wenn er verschoben wird.
 */
import type { PlayState } from './schema';
import { insideOnBoard, type BoardLayout, type Spot } from './story';

export type BoardArea = PlayState['boardAreas'][number];

/** So klein wird ein Bereich höchstens. */
export const AREA_MIN = { w: 220, h: 140 } as const;
/** Ein neuer Bereich ohne Auswahl. */
export const AREA_START = { w: 640, h: 420 } as const;
/** Rand um eine Auswahl, wenn ein Bereich um sie gelegt wird (oben Platz für den Namen). */
const PAD = { side: 60, top: 70, bottom: 60 } as const;

/** Was in einem Bereich liegt: Karten, Knoten, Namen und Artikel mit ihrer Mitte darin. */
export const insideArea = (layout: BoardLayout, area: BoardArea): string[] =>
  insideOnBoard(layout, { x: area.x, y: area.y }, { x: area.x + area.w, y: area.y + area.h });

/** Die Mitten der Stücke, wie `insideOnBoard` sie zählt – für den Rahmen um eine Auswahl. */
function middles(layout: BoardLayout, keys: readonly string[]): Spot[] {
  const out: Spot[] = [];
  for (const key of keys) {
    const card = layout.cards[key];
    if (card) {
      // Eine Karte ist breit und hoch: ihre vier Ecken zählen.
      out.push({ x: card.x - 125, y: card.y }, { x: card.x + 125, y: card.y + 170 });
      continue;
    }
    const knot = layout.knots[key];
    if (knot) {
      out.push({ x: knot.x, y: knot.y - 15 }, { x: knot.x + 210, y: knot.y + 15 });
      continue;
    }
    const pin = layout.pins.find((entry) => entry.key === key);
    if (pin) out.push({ x: pin.x - 75, y: pin.y - 17 }, { x: pin.x + 75, y: pin.y + 17 });
  }
  return out;
}

/**
 * Der Rahmen um eine Auswahl, mit etwas Rand; ohne Auswahl ein Rahmen mittlerer Größe um `at`.
 * Nie kleiner als `AREA_MIN`.
 */
export function areaAround(
  layout: BoardLayout,
  keys: readonly string[],
  at: Spot,
): { x: number; y: number; w: number; h: number } {
  const spots = middles(layout, keys);
  if (!spots.length)
    return {
      x: Math.round(at.x - AREA_START.w / 2),
      y: Math.round(at.y - AREA_START.h / 2),
      ...AREA_START,
    };
  const xs = spots.map((spot) => spot.x);
  const ys = spots.map((spot) => spot.y);
  const x = Math.min(...xs) - PAD.side;
  const y = Math.min(...ys) - PAD.top;
  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(Math.max(AREA_MIN.w, Math.max(...xs) + PAD.side - x)),
    h: Math.round(Math.max(AREA_MIN.h, Math.max(...ys) + PAD.bottom - y)),
  };
}
