/**
 * Rechnen mit Hexfeldern. Felder haben axiale Koordinaten (q, r); Abstände zählen in Feldern.
 * Die Größe eines Feldes (`hexKm`) ist der Abstand zweier Nachbarfelder von Mitte zu Mitte.
 *
 * Zwei Ausrichtungen:
 * - `pointy` (Spitze oben): Nachbarn liegen genau im Osten und Westen – ein Weg nach Osten ist
 *   eine gerade Reihe. Erzeugte Karten nutzen diese Ausrichtung.
 * - `flat` (flache Seite oben): Nachbarn liegen genau im Norden und Süden.
 */

export interface HexCoord {
  q: number;
  r: number;
}

export type HexOrientation = 'flat' | 'pointy';

export const hexKey = (hex: HexCoord): string => `${hex.q},${hex.r}`;

/** Die sechs Nachbarn. */
export const HEX_DIRECTIONS: readonly HexCoord[] = [
  { q: 1, r: -1 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
];

export const hexNeighbors = (hex: HexCoord): HexCoord[] =>
  HEX_DIRECTIONS.map((d) => ({ q: hex.q + d.q, r: hex.r + d.r }));

/** Abstand zweier Felder in Schritten. */
export function hexDistance(a: HexCoord, b: HexCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Rundet gebrochene Koordinaten auf das nächste Feld. */
export function hexRound(q: number, r: number): HexCoord {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  // „-0“ vermeiden, damit Vergleiche und Schlüssel stimmen.
  return { q: rq + 0, r: rr + 0 };
}

/** Alle Felder auf der geraden Linie von a nach b, beide eingeschlossen. */
export function hexLine(a: HexCoord, b: HexCoord): HexCoord[] {
  const steps = hexDistance(a, b);
  if (steps === 0) return [{ ...a }];
  const out: HexCoord[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Ein Hauch Versatz, damit Linien genau zwischen zwei Feldern nicht hin und her springen.
    out.push(hexRound(a.q + (b.q - a.q) * t + 1e-6, a.r + (b.r - a.r) * t + 1e-6));
  }
  return out;
}

/** Alle Felder, die höchstens `radius` Schritte von einem der genannten Felder entfernt sind. */
export function hexBand(line: readonly HexCoord[], radius: number): HexCoord[] {
  const seen = new Map<string, HexCoord>();
  for (const center of line)
    for (let dq = -radius; dq <= radius; dq++)
      for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
        const hex = { q: center.q + dq, r: center.r + dr };
        seen.set(hexKey(hex), hex);
      }
  return [...seen.values()].sort((a, b) => a.q - b.q || a.r - b.r);
}

const H = Math.sqrt(3) / 2;

/**
 * Mitte eines Feldes in der Ebene, in Einheiten von Feldgrößen (Nachbarabstand = 1):
 * x nach Osten, y nach Süden.
 */
export function hexCenter(
  hex: HexCoord,
  orientation: HexOrientation = 'pointy',
): { x: number; y: number } {
  return orientation === 'pointy'
    ? { x: hex.q + hex.r / 2, y: H * hex.r }
    : { x: H * hex.q, y: hex.r + hex.q / 2 };
}

/** Das Feld, in dem ein Punkt der Ebene liegt (Umkehrung von `hexCenter`). */
export function hexAt(x: number, y: number, orientation: HexOrientation = 'pointy'): HexCoord {
  if (orientation === 'pointy') {
    const r = y / H;
    return hexRound(x - r / 2, r);
  }
  const q = x / H;
  return hexRound(q, y - q / 2);
}

/** Die sechs Ecken eines Feldes, in denselben Einheiten wie `hexCenter`. */
export function hexCorners(
  hex: HexCoord,
  orientation: HexOrientation = 'pointy',
): { x: number; y: number }[] {
  const { x, y } = hexCenter(hex, orientation);
  // Umkreisradius, wenn der Nachbarabstand 1 ist.
  const radius = 1 / Math.sqrt(3);
  const offset = orientation === 'pointy' ? Math.PI / 6 : 0;
  return Array.from({ length: 6 }, (_, i) => {
    const angle = offset + (Math.PI / 3) * i;
    return { x: x + radius * Math.cos(angle), y: y + radius * Math.sin(angle) };
  });
}
