/**
 * Schichten der Hexkarte, die über einzelne Felder hinausgehen:
 *
 * - **Wege und Flüsse** (Rückmeldung des Spielleiters, 20. 11. 2026: „Fluss ziehen sieht noch sehr
 *   schlecht aus“): geschwungene Linien von Feldseite zu Feldseite, gezeichnet aus den gezogenen
 *   Verbindungen (`domain/hexLines.ts`) – ein Fluss mit Ufer, Wasser und Glanz, eine Straße mit
 *   Rand und Belag, ein Pfad gestrichelt. Wo die Linie eine Feldseite quert, sitzt sie ein Stück
 *   neben der Mitte (fest je Seite), damit sie nicht wie mit dem Lineal gezogen wirkt.
 * - **Unterreich** (Zielbild des Spielleiters, 20. 11.: „Gerade das Gangnetz und wie der massive
 *   Fels gebaut ist“): Fels ist eine durchgehende, gemalte Fläche über alle Felder; Gänge und
 *   Höhlen liegen als frei geformte, helle Fläche mit Rand darin, Seen, Abgründe und Glut als eigene
 *   Flächen. Die Regeln rechnen weiter mit Feldern und Ausgängen – das hier ist nur ihr Bild.
 */
import { memo, useMemo } from 'react';
import { HEX_DIRECTIONS, hexCenter, hexKey, type HexOrientation } from '../../domain/hex';
import { SOLID_ROCK, WIDE_CAVE_KINDS, kindKeyOf } from '../../domain/hexKinds';
import { linkSides, namedLines, type LineKind } from '../../domain/hexLines';
import { isRock } from '../../domain/passages';
import type { Hex, PassageKind } from '../../domain/schema';
import ground from '../../ui/assets/dungeon/ground.webp';
import rock from '../../ui/assets/dungeon/rock.webp';
import water from '../../ui/assets/dungeon/water.webp';

export interface LayerCell {
  hex: Hex;
  x: number;
  y: number;
  points: string;
}

/** Eine feste Zahl zwischen −1 und 1 aus einem Wort – dieselbe an jedem Rechner. */
function wobble(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2001) / 1000 - 1;
}

/** Der Schlüssel der Seite zwischen einem Feld und seinem Nachbarn – von beiden Seiten gleich. */
function edgeKey(hex: Hex, side: number): string {
  const d = HEX_DIRECTIONS[side]!;
  const a = `${hex.q},${hex.r}`;
  const b = `${hex.q + d.q},${hex.r + d.r}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Wo eine Linie die Seite eines Feldes quert: auf der Seite, ein Stück neben ihrer Mitte (`sway`
 * als Anteil der Feldgröße; 0 = genau die Mitte).
 */
function crossing(
  cell: LayerCell,
  side: number,
  size: number,
  orientation: HexOrientation,
  sway: number,
): { x: number; y: number } {
  const d = hexCenter(HEX_DIRECTIONS[side]!, orientation);
  const shift = wobble(edgeKey(cell.hex, side)) * sway * size;
  // Entlang der Seite verschieben: senkrecht zur Richtung zum Nachbarn. Das Vorzeichen folgt dem
  // Schlüssel der Seite, damit beide Felder denselben Punkt meinen.
  const flip = side < 3 ? 1 : -1;
  return {
    x: cell.x + d.x * size * 0.5 - d.y * shift * flip,
    y: cell.y + d.y * size * 0.5 + d.x * shift * flip,
  };
}

const fmt = (n: number) => n.toFixed(1);

// ── Wege und Flüsse ────────────────────────────────────────────────────────

interface LinePath {
  key: string;
  kind: 'road' | 'trail' | 'river';
  d: string;
}

/** Die Wege eines Feldes als Kurven von Seite zu Seite durch seine (leicht versetzte) Mitte. */
function pathsOf(
  cell: LayerCell,
  kind: LineKind,
  byKey: ReadonlyMap<string, Hex>,
  size: number,
  orientation: HexOrientation,
): string | null {
  const sides = linkSides(cell.hex, kind, byKey);
  const sway = kind === 'river' ? 0.16 : 0.07;
  const key = hexKey(cell.hex);
  const cx = cell.x + wobble(`${key}x${kind}`) * size * (kind === 'river' ? 0.12 : 0.05);
  const cy = cell.y + wobble(`${key}y${kind}`) * size * (kind === 'river' ? 0.12 : 0.05);
  const points = sides.map((side) => crossing(cell, side, size, orientation, sway));
  if (points.length === 0) return null;
  if (points.length === 2) {
    const [a, b] = points as [(typeof points)[0], (typeof points)[0]];
    return `M ${fmt(a.x)} ${fmt(a.y)} Q ${fmt(cx)} ${fmt(cy)} ${fmt(b.x)} ${fmt(b.y)}`;
  }
  // Ein Ende oder eine Gabelung: jede Seite läuft in die Mitte.
  return points
    .map((p) => {
      const mx = (p.x + cx) / 2 + wobble(`${key}${p.x.toFixed(0)}`) * size * sway * 0.4;
      const my = (p.y + cy) / 2 + wobble(`${key}${p.y.toFixed(0)}`) * size * sway * 0.4;
      return `M ${fmt(p.x)} ${fmt(p.y)} Q ${fmt(mx)} ${fmt(my)} ${fmt(cx)} ${fmt(cy)}`;
    })
    .join(' ');
}

export const LineLayer = memo(function LineLayer({
  cells,
  size,
  orientation,
  fog,
  names,
}: {
  cells: readonly LayerCell[];
  size: number;
  orientation: HexOrientation;
  /** Spielen: nur, was die Gruppe entdeckt hat. */
  fog: boolean;
  /** Namen der Einträge, die Wege und Flüsse tragen. */
  names: Readonly<Record<string, string>>;
}) {
  const { paths, dots, labels } = useMemo(() => {
    const shown = cells.filter((cell) => !fog || cell.hex.discovered);
    const byKey = new Map(shown.map((cell) => [hexKey(cell.hex), cell.hex]));
    const byCell = new Map(shown.map((cell) => [hexKey(cell.hex), cell]));
    const paths: LinePath[] = [];
    const dots: { key: string; kind: LinePath['kind']; x: number; y: number }[] = [];
    for (const cell of shown) {
      const key = hexKey(cell.hex);
      // Unter der Erde fließt Wasser durch die Gänge – das zeichnet das Gangnetz.
      if (cell.hex.river && cell.hex.exits === null) {
        const d = pathsOf(cell, 'river', byKey, size, orientation);
        if (d) paths.push({ key: `w${key}`, kind: 'river', d });
        else dots.push({ key: `w${key}`, kind: 'river', x: cell.x, y: cell.y });
      }
      if (cell.hex.road !== 'none') {
        const kind = cell.hex.road === 'road' ? 'road' : 'trail';
        const d = pathsOf(cell, 'road', byKey, size, orientation);
        if (d) paths.push({ key: `r${key}`, kind, d });
        else dots.push({ key: `r${key}`, kind, x: cell.x, y: cell.y });
      }
    }
    const labels = namedLines(shown.map((cell) => cell.hex))
      .map((line) => ({ line, cell: byCell.get(hexKey(line.at)), name: names[line.entityId] }))
      .filter((entry) => entry.cell && entry.name);
    return { paths, dots, labels };
  }, [cells, size, orientation, fog, names]);

  const layer = (kind: LinePath['kind'], part: string) =>
    paths
      .filter((path) => path.kind === kind)
      .map((path) => (
        <path key={`${part}${path.key}`} className={`wf-hexline wf-hexline--${part}`} d={path.d} />
      ));
  if (!paths.length && !dots.length) return null;
  return (
    <g className="wf-hexlines" pointerEvents="none" style={{ ['--hex' as string]: `${size}px` }}>
      {layer('river', 'bank')}
      {layer('river', 'water')}
      {layer('river', 'glint')}
      {layer('trail', 'trail')}
      {layer('road', 'road-edge')}
      {layer('road', 'road')}
      {dots.map((dot) => (
        <circle
          key={dot.key}
          className={`wf-hexline__dot wf-hexline__dot--${dot.kind}`}
          cx={dot.x}
          cy={dot.y}
          r={size * (dot.kind === 'river' ? 0.11 : 0.07)}
        />
      ))}
      {size >= 20 &&
        labels.map(({ line, cell, name }) => (
          <text
            key={`${line.kind}${line.entityId}${hexKey(line.at)}`}
            className={`wf-hexline__name wf-hexline__name--${line.kind}`}
            x={cell!.x}
            y={cell!.y - size * 0.2}
            textAnchor="middle"
            style={{ fontSize: Math.max(10, size * 0.26) }}
          >
            {name}
          </text>
        ))}
    </g>
  );
});

// ── Unterreich ─────────────────────────────────────────────────────────────

/** Gehört dieses Feld zum Unterreich – wird es also als Fels mit Gängen gezeichnet? */
export const isUnderground = (hex: Hex): boolean =>
  hex.exits !== null || hex.terrain === 'underdark';

/** Fels, durch den nichts führt: kein Ausgang – oder als Massivfels gemalt. */
export const isSolid = (hex: Hex): boolean => isRock(hex) || kindKeyOf(hex) === SOLID_ROCK;

const isWide = (hex: Hex): boolean => {
  const kind = kindKeyOf(hex);
  if (kind && WIDE_CAVE_KINDS.has(kind)) return true;
  // Eine Kreuzung mit vier und mehr Ausgängen ist eine Höhle.
  return (hex.exits ?? []).filter((exit) => exit.dir < 6).length >= 4;
};

/** Wohin es von einem Feld des Unterreichs geht: Seite und Art des Durchgangs. */
function openings(
  hex: Hex,
  byKey: ReadonlyMap<string, Hex>,
): { side: number; kind: PassageKind }[] {
  if (isSolid(hex)) return [];
  if (hex.exits !== null)
    return hex.exits
      .filter((exit) => exit.dir < 6)
      .map((exit) => ({ side: exit.dir, kind: exit.kind }));
  // Eine Karte ohne Gänge (frei gemalt): offen ist, was nebeneinander liegt und kein Fels ist.
  const out: { side: number; kind: PassageKind }[] = [];
  for (let side = 0; side < 6; side++) {
    const d = HEX_DIRECTIONS[side]!;
    const other = byKey.get(hexKey({ q: hex.q + d.q, r: hex.r + d.r, level: hex.level }));
    if (other && isUnderground(other) && !isSolid(other)) out.push({ side, kind: 'open' });
  }
  return out;
}

/** Wie breit ein Durchgang gezeichnet wird, als Anteil der Feldgröße. */
const PASSAGE_WIDTH: Record<PassageKind, number> = {
  open: 0.27,
  narrow: 0.11,
  climb: 0.2,
  water: 0.24,
  hidden: 0,
  drop: 0.2,
};

/** Flächen eigener Farbe im Höhlenboden: See, Abgrund, Glut, Eis. */
const POOL_KIND: Record<string, string> = {
  'deep-lake': 'water',
  chasm: 'chasm',
  magma: 'magma',
  'ice-cave': 'ice',
};

interface CaveShape {
  key: string;
  /** Eine Linie (Gang) oder ein Kreis (Kammer). */
  d?: string;
  width?: number;
  cx?: number;
  cy?: number;
  r?: number;
}

function caveShapes(cells: readonly LayerCell[], size: number, orientation: HexOrientation) {
  const byKey = new Map(cells.map((cell) => [hexKey(cell.hex), cell.hex]));
  const floor: CaveShape[] = [];
  const pools: (CaveShape & { tone: string })[] = [];
  const streams: CaveShape[] = [];
  for (const cell of cells) {
    const { hex } = cell;
    if (isSolid(hex)) continue;
    const key = hexKey(hex);
    const wide = isWide(hex);
    const cx = cell.x + wobble(`${key}cx`) * size * (wide ? 0.05 : 0.12);
    const cy = cell.y + wobble(`${key}cy`) * size * (wide ? 0.05 : 0.12);
    const tone = POOL_KIND[kindKeyOf(hex) ?? ''];
    floor.push({ key: `k${key}`, cx, cy, r: size * (wide ? 0.4 : 0.15) });
    if (tone) pools.push({ key: `p${key}`, cx, cy, r: size * 0.29, tone });
    for (const { side, kind } of openings(hex, byKey)) {
      const d = HEX_DIRECTIONS[side]!;
      const other = byKey.get(hexKey({ q: hex.q + d.q, r: hex.r + d.r, level: hex.level }));
      const both = wide && !!other && isWide(other) && kind === 'open';
      const width = both ? 0.64 : PASSAGE_WIDTH[kind];
      if (!width) continue;
      // Breite Höhlen gehen gerade ineinander über; ein Gang windet sich ein wenig.
      const p = crossing(cell, side, size, orientation, both ? 0 : 0.14);
      const line = `M ${fmt(cx)} ${fmt(cy)} L ${fmt(p.x)} ${fmt(p.y)}`;
      floor.push({ key: `g${key}|${side}`, d: line, width: size * width });
      if (kind === 'water') streams.push({ key: `s${key}|${side}`, d: line, width: size * 0.12 });
      if (tone && both && other && POOL_KIND[kindKeyOf(other) ?? ''] === tone)
        pools.push({ key: `q${key}|${side}`, d: line, width: size * 0.42, tone });
    }
    // Ein Fluss, der durch die Höhle fließt, steht als Wasser in ihrer Mitte.
    if (hex.river && !tone) pools.push({ key: `r${key}`, cx, cy, r: size * 0.12, tone: 'water' });
  }
  return { floor, pools, streams };
}

function Shape({ shape, grow, className }: { shape: CaveShape; grow: number; className: string }) {
  return shape.d ? (
    <path className={className} d={shape.d} style={{ strokeWidth: shape.width! + grow * 2 }} />
  ) : (
    <circle className={className} cx={shape.cx} cy={shape.cy} r={shape.r! + grow} />
  );
}

/** Die gemalten Flächen, aus denen die Karte unter der Erde besteht – einmal je Karte. */
export function CaveDefs({ size }: { size: number }) {
  const tile = Math.max(96, size * 4);
  return (
    <defs>
      {/* Der Fels: die gemalte Textur über einem helleren Grund, damit das Raster darauf lesbar bleibt. */}
      <pattern id="wf-hex-rock" patternUnits="userSpaceOnUse" width={tile} height={tile}>
        <rect className="wf-hexcave__rockbase" width={tile} height={tile} />
        <image href={rock} width={tile} height={tile} preserveAspectRatio="none" opacity="0.5" />
      </pattern>
      <pattern id="wf-hex-ground" patternUnits="userSpaceOnUse" width={tile} height={tile}>
        <image href={ground} width={tile} height={tile} preserveAspectRatio="none" />
      </pattern>
      <pattern id="wf-hex-water" patternUnits="userSpaceOnUse" width={tile} height={tile}>
        <image href={water} width={tile} height={tile} preserveAspectRatio="none" />
      </pattern>
      {/* Verwackelt die Ränder: aus Kreisen und Bändern wird ein frei geformter Umriss. */}
      <filter id="wf-hex-crag" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency={(1.1 / size).toFixed(4)}
          numOctaves="2"
          seed="11"
          result="noise"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale={(size * 0.24).toFixed(1)}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </defs>
  );
}

export const CaveLayer = memo(function CaveLayer({
  cells,
  size,
  orientation,
  fog,
}: {
  cells: readonly LayerCell[];
  size: number;
  orientation: HexOrientation;
  fog: boolean;
}) {
  const under = useMemo(() => cells.filter((cell) => isUnderground(cell.hex)), [cells]);
  const rockPath = useMemo(
    () => under.map((cell) => `M ${cell.points.replace(/ /g, ' L ')} Z`).join(' '),
    [under],
  );
  const groups = useMemo(() => {
    const all = caveShapes(under, size, orientation);
    if (!fog) return [{ key: 'alles', dim: false, ...all }];
    // Spielen: Entdecktes klar, der Rest nur als Ahnung – so behält die Spielleitung den Überblick.
    const seen = new Set(
      under.filter((cell) => cell.hex.discovered).map((cell) => hexKey(cell.hex)),
    );
    const part = (keep: boolean) => {
      const match = (shape: CaveShape) => seen.has(shape.key.slice(1).split('|')[0]!) === keep;
      return {
        floor: all.floor.filter(match),
        pools: all.pools.filter(match),
        streams: all.streams.filter(match),
      };
    };
    return [
      { key: 'dunkel', dim: true, ...part(false) },
      { key: 'gesehen', dim: false, ...part(true) },
    ];
  }, [under, size, orientation, fog]);
  if (!under.length) return null;
  const rim = Math.max(1.5, size * 0.05);
  return (
    <g className="wf-hexcave" pointerEvents="none">
      <path className="wf-hexcave__rock" d={rockPath} />
      {groups.map((group) =>
        group.floor.length ? (
          <g
            key={group.key}
            className="wf-hexcave__open"
            data-dim={group.dim || undefined}
            filter="url(#wf-hex-crag)"
          >
            {group.floor.map((shape) => (
              <Shape key={`o${shape.key}`} shape={shape} grow={rim} className="wf-hexcave__rim" />
            ))}
            {group.floor.map((shape) => (
              <Shape key={`f${shape.key}`} shape={shape} grow={0} className="wf-hexcave__floor" />
            ))}
            {group.pools.map((shape) => (
              <Shape
                key={`e${shape.key}`}
                shape={shape}
                grow={rim * 0.6}
                className={`wf-hexcave__pool-edge wf-hexcave__pool-edge--${shape.tone}`}
              />
            ))}
            {group.pools.map((shape) => (
              <Shape
                key={`p${shape.key}`}
                shape={shape}
                grow={0}
                className={`wf-hexcave__pool wf-hexcave__pool--${shape.tone}`}
              />
            ))}
            {group.streams.map((shape) => (
              <Shape key={`s${shape.key}`} shape={shape} grow={0} className="wf-hexcave__stream" />
            ))}
          </g>
        ) : null,
      )}
    </g>
  );
});
