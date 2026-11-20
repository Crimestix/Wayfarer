/**
 * Straßen, Pfade und Flüsse auf der Hexkarte als **Linien** (Rückmeldung des Spielleiters,
 * 20. 11. 2026: „Pfad und Straße ziehen ist quasi dasselbe und macht nicht wirklich was“, „Fluss
 * ziehen sieht noch sehr schlecht aus“ – und: einer Straße einen Artikel geben, „indem man die
 * Straße auswählt“).
 *
 * Ob ein Feld Straße oder Fluss trägt, sagen weiter `hex.road` und `hex.river` – daran hängen die
 * Regeln (Tempo, Halt am Fluss). Neu ist, **wohin** die Linie von einem Feld aus führt
 * (`hex.roadLinks`, `hex.riverLinks`: Seiten 0–5 wie `HEX_DIRECTIONS`): Gezogen wird von Feld zu
 * Feld, verbunden ist nur, was gezogen wurde – nie mehr jedes Nachbarfeld mit jedem. null heißt:
 * eine ältere oder erzeugte Karte, dort gilt wie früher jeder Nachbar mit derselben Linie.
 * Eine zusammenhängende Linie (`lineRun`) kann einen Eintrag der Welt tragen (`hex.roadId`,
 * `hex.riverId`). Reine Funktionen.
 */
import { HEX_DIRECTIONS, hexKey, type HexCoord } from './hex';
import type { Hex, RoadKind } from './schema';

export type LineKind = 'road' | 'river';

const linksField = { road: 'roadLinks', river: 'riverLinks' } as const;
const idField = { road: 'roadId', river: 'riverId' } as const;

const coordKey = (c: HexCoord) => hexKey({ q: c.q, r: c.r, level: c.level ?? 0 });
const opposite = (side: number) => (side + 3) % 6;

/** Trägt das Feld diese Linie? */
export const hasLine = (hex: Pick<Hex, 'road' | 'river'>, kind: LineKind): boolean =>
  kind === 'road' ? hex.road !== 'none' : hex.river !== '';

/** Die Felder einer Karte nach Schlüssel. */
export function hexIndex(hexes: readonly Hex[]): Map<string, Hex> {
  return new Map(hexes.map((hex) => [hexKey(hex), hex]));
}

const neighbourOf = (hex: Hex, side: number): HexCoord => {
  const d = HEX_DIRECTIONS[side]!;
  return { q: hex.q + d.q, r: hex.r + d.r, level: hex.level };
};

/** Die Seite, über die man von `a` zum Nachbarn `b` kommt – null, wenn sie nicht nebeneinander liegen. */
export function sideBetween(a: HexCoord, b: HexCoord): number | null {
  if ((a.level ?? 0) !== (b.level ?? 0)) return null;
  const side = HEX_DIRECTIONS.findIndex((d) => a.q + d.q === b.q && a.r + d.r === b.r);
  return side < 0 ? null : side;
}

/**
 * Über welche Seiten die Linie dieses Feld verlässt. Mit eingetragenen Verbindungen genau die
 * (soweit dort ein Feld mit der Linie liegt und nicht widerspricht); ohne Eintrag jeder Nachbar
 * mit derselben Linie, der seinerseits nicht widerspricht.
 */
export function linkSides(hex: Hex, kind: LineKind, byKey: ReadonlyMap<string, Hex>): number[] {
  if (!hasLine(hex, kind)) return [];
  const own = hex[linksField[kind]] ?? null;
  const out: number[] = [];
  for (let side = 0; side < 6; side++) {
    if (own && !own.includes(side)) continue;
    const other = byKey.get(coordKey(neighbourOf(hex, side)));
    if (!other || !hasLine(other, kind)) continue;
    const theirs = other[linksField[kind]] ?? null;
    if (theirs && !theirs.includes(opposite(side))) continue;
    out.push(side);
  }
  return out;
}

/** Was eine gezogene Linie an einem Feld setzt: Straße oder Pfad, oder der Name des Flusses. */
export type LineValue =
  { kind: 'road'; road: Exclude<RoadKind, 'none'> } | { kind: 'river'; name: string };

function withLine(hex: Hex, value: LineValue): Hex {
  return value.kind === 'road'
    ? { ...hex, road: value.road, manual: true }
    : { ...hex, river: hex.river || value.name.trim() || 'Fluss', manual: true };
}

/**
 * Setzt die Linie auf ein Feld, ohne es zu verbinden – der Anfang eines Strichs. Ein Feld, das die
 * Linie schon trägt, bleibt verbunden, wie es ist (bei einer Straße wechselt nur die Art).
 */
export function markLine(hexes: readonly Hex[], at: HexCoord, value: LineValue): Hex[] {
  const key = coordKey(at);
  const byKey = hexIndex(hexes);
  return hexes.map((hex) => {
    if (hexKey(hex) !== key) return hex;
    const had = hasLine(hex, value.kind);
    const field = linksField[value.kind];
    // Bisher ohne Eintrag verbunden (ältere Karte): die Verbindungen festschreiben, sonst gingen sie verloren.
    const links = had ? (hex[field] ?? linkSides(hex, value.kind, byKey)) : [];
    return { ...withLine(hex, value), [field]: links };
  });
}

/**
 * Zieht die Linie von einem Feld zum Nachbarn: Beide tragen sie danach und sind über die
 * gemeinsame Seite verbunden. Liegen die Felder nicht nebeneinander, ändert sich nichts.
 */
export function connectLine(
  hexes: readonly Hex[],
  from: HexCoord,
  to: HexCoord,
  value: LineValue,
): Hex[] {
  const side = sideBetween(from, to);
  if (side === null) return [...hexes];
  const byKey = hexIndex(hexes);
  const a = byKey.get(coordKey(from));
  const b = byKey.get(coordKey(to));
  if (!a || !b) return [...hexes];
  const field = linksField[value.kind];
  const idOf = idField[value.kind];
  const joined = (hex: Hex, via: number, other: Hex): Hex => {
    const before = hasLine(hex, value.kind)
      ? (hex[field] ?? linkSides(hex, value.kind, byKey))
      : [];
    return {
      ...withLine(hex, value),
      [field]: before.includes(via) ? before : [...before, via].sort((x, y) => x - y),
      // Wer an eine Linie mit Eintrag anschließt, gehört zu ihr.
      [idOf]: hex[idOf] ?? other[idOf] ?? null,
    };
  };
  return hexes.map((hex) =>
    hex === a ? joined(a, side, b) : hex === b ? joined(b, opposite(side), a) : hex,
  );
}

/** Nimmt die Linie von Feldern – und bei den Nachbarn die Verbindung dorthin. */
export function eraseLine(
  hexes: readonly Hex[],
  coords: readonly HexCoord[],
  kind: LineKind,
): Hex[] {
  const gone = new Set(coords.map(coordKey));
  const field = linksField[kind];
  return hexes.map((hex) => {
    if (gone.has(hexKey(hex))) {
      if (!hasLine(hex, kind) && !hex[field] && !hex[idField[kind]]) return hex;
      return {
        ...hex,
        ...(kind === 'road' ? { road: 'none' as const } : { river: '' }),
        [field]: null,
        [idField[kind]]: null,
        manual: true,
      };
    }
    const links = hex[field];
    if (!links) return hex;
    const kept = links.filter((side) => !gone.has(coordKey(neighbourOf(hex, side))));
    return kept.length === links.length ? hex : { ...hex, [field]: kept };
  });
}

/** Die zusammenhängende Linie, zu der ein Feld gehört: alle Felder, die mit ihm verbunden sind. */
export function lineRun(hexes: readonly Hex[], at: HexCoord, kind: LineKind): Hex[] {
  const byKey = hexIndex(hexes);
  const start = byKey.get(coordKey(at));
  if (!start || !hasLine(start, kind)) return [];
  const seen = new Set([hexKey(start)]);
  const out = [start];
  for (let i = 0; i < out.length; i++) {
    const hex = out[i]!;
    for (const side of linkSides(hex, kind, byKey)) {
      const other = byKey.get(coordKey(neighbourOf(hex, side)));
      if (!other || seen.has(hexKey(other))) continue;
      seen.add(hexKey(other));
      out.push(other);
    }
  }
  return out;
}

/**
 * Gibt einer Linie ihren Eintrag der Welt (oder nimmt ihn weg). Ein Fluss heißt danach wie sein
 * Eintrag (`name`); ohne Eintrag behält er seinen Namen.
 */
export function setLineEntity(
  hexes: readonly Hex[],
  coords: readonly HexCoord[],
  kind: LineKind,
  entityId: string | null,
  name = '',
): Hex[] {
  const keys = new Set(coords.map(coordKey));
  return hexes.map((hex) => {
    if (!keys.has(hexKey(hex)) || !hasLine(hex, kind)) return hex;
    return {
      ...hex,
      [idField[kind]]: entityId,
      ...(kind === 'river' && entityId && name.trim() ? { river: name.trim() } : {}),
      manual: true,
    };
  });
}

/** Der Eintrag, den eine Linie trägt – der erste, den eines ihrer Felder nennt. */
export function lineEntityId(run: readonly Hex[], kind: LineKind): string | null {
  return run.find((hex) => hex[idField[kind]])?.[idField[kind]] ?? null;
}

export interface NamedLine {
  kind: LineKind;
  entityId: string;
  /** Das Feld der Linie, das ihrer Mitte am nächsten liegt – dort steht ihr Name. */
  at: Hex;
  hexes: Hex[];
}

/** Die Linien einer Ebene, die einen Eintrag tragen – je Eintrag und Art eine, für die Beschriftung. */
export function namedLines(hexes: readonly Hex[]): NamedLine[] {
  const out: NamedLine[] = [];
  for (const kind of ['road', 'river'] as const) {
    const groups = new Map<string, Hex[]>();
    for (const hex of hexes) {
      const entityId = hex[idField[kind]];
      if (!entityId || !hasLine(hex, kind)) continue;
      const key = `${entityId}:${hex.level}`;
      const list = groups.get(key);
      if (list) list.push(hex);
      else groups.set(key, [hex]);
    }
    for (const list of groups.values()) {
      const cq = list.reduce((sum, hex) => sum + hex.q, 0) / list.length;
      const cr = list.reduce((sum, hex) => sum + hex.r, 0) / list.length;
      let at = list[0]!;
      let best = Infinity;
      for (const hex of list) {
        const far = (hex.q - cq) ** 2 + (hex.r - cr) ** 2 + (hex.q - cq) * (hex.r - cr);
        if (far < best) {
          best = far;
          at = hex;
        }
      }
      out.push({ kind, entityId: list[0]![idField[kind]]!, at, hexes: list });
    }
  }
  return out;
}
