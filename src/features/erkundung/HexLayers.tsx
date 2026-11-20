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
 *   Höhlen liegen als **ein** frei geformter Umriss mit klarer Kante darin (`caveOutline.ts`),
 *   Seen, Abgründe und Glut als eigene Flächen. Die Regeln rechnen weiter mit Feldern und
 *   Ausgängen – das hier ist nur ihr Bild.
 */
import { memo, useMemo } from 'react';
import { HEX_DIRECTIONS, hexCenter, hexKey, type HexOrientation } from '../../domain/hex';
import { SOLID_ROCK, WIDE_CAVE_KINDS, kindKeyOf } from '../../domain/hexKinds';
import { linkSides, namedLines, type LineKind } from '../../domain/hexLines';
import { isRock } from '../../domain/passages';
import { caveOutline, outlinePath, type CaveBlob } from './caveOutline';
import type { Hex, PassageKind } from '../../domain/schema';
import ground from '../../ui/assets/dungeon/ground.webp';
import rock from '../../ui/assets/dungeon/hexrock.webp';
import water from '../../ui/assets/dungeon/water.webp';
import iconCrystal from '../../ui/assets/hexkarte/crystal.webp';
import iconRuins from '../../ui/assets/hexkarte/deep-ruins.webp';
import iconFungus from '../../ui/assets/hexkarte/fungus.webp';
import iconMine from '../../ui/assets/hexkarte/mine.webp';
import iconRubble from '../../ui/assets/hexkarte/rubble.webp';
import iconStalagmites from '../../ui/assets/hexkarte/stalagmites.webp';

/**
 * Gemalte Zeichen für Geländearten unter der Erde (`ui/assets/hexkarte`): was dort wächst oder
 * liegt. Eine Art ohne Bild trägt weiter ihr gezeichnetes Zeichen.
 */
export const CAVE_ICON: Readonly<Record<string, string>> = {
  fungus: iconFungus,
  crystal: iconCrystal,
  stalagmites: iconStalagmites,
  rubble: iconRubble,
  'deep-ruins': iconRuins,
  mine: iconMine,
};

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

/** Wie breit ein Durchgang ist: sein halber Durchmesser in Feldgrößen (0 = nicht zu sehen). */
const PASSAGE_RADIUS: Record<PassageKind, number> = {
  open: 0.165,
  narrow: 0.11,
  climb: 0.14,
  water: 0.155,
  hidden: 0,
  drop: 0.14,
};

/** Flächen eigener Farbe im Höhlenboden: See, Abgrund, Glut, Eis. */
const POOL_KIND: Record<string, string> = {
  'deep-lake': 'water',
  chasm: 'chasm',
  magma: 'magma',
  'ice-cave': 'ice',
};
const POOL_TONES = ['water', 'ice', 'magma', 'chasm'] as const;

interface CavePlan {
  floor: CaveBlob[];
  pools: Record<string, CaveBlob[]>;
  /** Wasser, das durch einen Gang fließt: Linien in Feldgrößen. */
  streams: [number, number, number, number, number, number][];
}

/**
 * Aus den Feldern die Formen, die zusammen den Höhlenboden ergeben – in Feldgrößen. Eine weite
 * Höhle ist ein großer Kreis, der mit weiten Nachbarn zusammenwächst; ein Gang ein schmales Band,
 * das von der (versetzten) Mitte über einen Knick zur Seite des Feldes läuft: So windet er sich.
 */
function cavePlan(hexes: readonly Hex[], orientation: HexOrientation): CavePlan {
  const byKey = new Map(hexes.map((hex) => [hexKey(hex), hex]));
  const plan: CavePlan = { floor: [], pools: {}, streams: [] };
  const pool = (tone: string, blob: CaveBlob) => (plan.pools[tone] ??= []).push(blob);
  for (const hex of hexes) {
    if (isSolid(hex)) continue;
    const key = hexKey(hex);
    const c = hexCenter(hex, orientation);
    const cell: LayerCell = { hex, x: c.x, y: c.y, points: '' };
    const wide = isWide(hex);
    const cx = c.x + wobble(`${key}cx`) * (wide ? 0.04 : 0.17);
    const cy = c.y + wobble(`${key}cy`) * (wide ? 0.04 : 0.17);
    const tone = POOL_KIND[kindKeyOf(hex) ?? ''];
    plan.floor.push({ x1: cx, y1: cy, r: wide ? 0.52 : 0.18 });
    if (tone === 'chasm') {
      // Ein Abgrund ist ein Riss: schmal und lang, in fester Richtung je Feld.
      const turn = wobble(`${key}riss`) * Math.PI;
      const reach = 0.2 + Math.abs(wobble(`${key}weit`)) * 0.1;
      pool(tone, {
        x1: cx - Math.cos(turn) * reach,
        y1: cy - Math.sin(turn) * reach,
        x2: cx + Math.cos(turn) * reach,
        y2: cy + Math.sin(turn) * reach,
        r: 0.13,
      });
    } else if (tone) {
      // Ein See liegt nicht in der Mitte und ist nie kreisrund.
      pool(tone, {
        x1: cx + wobble(`${key}sx`) * 0.08,
        y1: cy + wobble(`${key}sy`) * 0.08,
        r: 0.27 + wobble(`${key}sr`) * 0.05,
      });
    }
    for (const { side, kind } of openings(hex, byKey)) {
      const d = HEX_DIRECTIONS[side]!;
      const other = byKey.get(hexKey({ q: hex.q + d.q, r: hex.r + d.r, level: hex.level }));
      const both = wide && !!other && isWide(other) && kind === 'open';
      const r = both ? 0.46 : PASSAGE_RADIUS[kind];
      if (!r) continue;
      // Weite Höhlen gehen gerade ineinander über; ein Gang quert die Seite ein Stück neben der Mitte.
      const p = crossing(cell, side, 1, orientation, both ? 0 : 0.17);
      if (both) plan.floor.push({ x1: cx, y1: cy, x2: p.x, y2: p.y, r });
      else {
        // Ein Knick auf halbem Weg, quer zur Richtung versetzt.
        const bend = wobble(`${key}k${side}`) * 0.11;
        const dx = p.x - cx;
        const dy = p.y - cy;
        const len = Math.hypot(dx, dy) || 1;
        const mx = (cx + p.x) / 2 - (dy / len) * bend;
        const my = (cy + p.y) / 2 + (dx / len) * bend;
        plan.floor.push(
          { x1: cx, y1: cy, x2: mx, y2: my, r },
          { x1: mx, y1: my, x2: p.x, y2: p.y, r },
        );
        if (kind === 'water') plan.streams.push([cx, cy, mx, my, p.x, p.y]);
      }
      if (tone && both && other && POOL_KIND[kindKeyOf(other) ?? ''] === tone)
        pool(tone, { x1: cx, y1: cy, x2: p.x, y2: p.y, r: tone === 'chasm' ? 0.11 : 0.24 });
    }
    // Ein Fluss, der durch die Höhle fließt, steht als Wasser in ihrer Mitte.
    if (hex.river && !tone) pool('water', { x1: cx, y1: cy, r: 0.13 });
  }
  return plan;
}

/** Die gemalten Flächen, aus denen die Karte unter der Erde besteht – einmal je Karte. */
export function CaveDefs({ size }: { size: number }) {
  const tile = Math.max(120, size * 5);
  return (
    <defs>
      <pattern id="wf-hex-rock" patternUnits="userSpaceOnUse" width={tile} height={tile}>
        <image href={rock} width={tile} height={tile} preserveAspectRatio="none" />
      </pattern>
      <pattern id="wf-hex-ground" patternUnits="userSpaceOnUse" width={tile} height={tile}>
        <image href={ground} width={tile} height={tile} preserveAspectRatio="none" />
      </pattern>
      <pattern id="wf-hex-water" patternUnits="userSpaceOnUse" width={tile} height={tile}>
        <rect className="wf-hexcave__waterbase" width={tile} height={tile} />
        <image href={water} width={tile} height={tile} preserveAspectRatio="none" opacity="0.28" />
      </pattern>
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
  // Die Umrisse hängen nur an den Feldern, nicht an der Vergrößerung: einmal je Stand gerechnet.
  const hexes = useMemo(() => under.map((cell) => cell.hex), [under]);
  const shapes = useMemo(() => {
    // Spielen: Entdecktes klar, der Rest nur als Ahnung – so behält die Spielleitung den Überblick.
    const parts = fog
      ? [
          { key: 'dunkel', dim: true, hexes: hexes.filter((hex) => !hex.discovered) },
          { key: 'gesehen', dim: false, hexes: hexes.filter((hex) => hex.discovered) },
        ]
      : [{ key: 'alles', dim: false, hexes }];
    return parts
      .filter((part) => part.hexes.length)
      .map((part) => {
        // Zum Rechnen zählen alle Felder als Nachbarn – nur gezeichnet wird der eigene Teil.
        const own = new Set(part.hexes.map(hexKey));
        const plan = cavePlan(hexes, orientation);
        const mine = cavePlan(
          hexes.map((hex) =>
            own.has(hexKey(hex)) ? hex : { ...hex, exits: [], kind: 'solid-rock' },
          ),
          orientation,
        );
        const used = fog ? mine : plan;
        return {
          key: part.key,
          dim: part.dim,
          floor: caveOutline(used.floor, { rough: 0.2 }),
          pools: POOL_TONES.filter((tone) => used.pools[tone]?.length).map((tone) => ({
            tone,
            loops: caveOutline(used.pools[tone]!, {
              rough: tone === 'chasm' ? 0.16 : 0.17,
              salt: tone.length + 3,
              step: 0.1,
            }),
          })),
          streams: used.streams,
        };
      });
  }, [hexes, orientation, fog]);
  if (!under.length) return null;
  return (
    <g className="wf-hexcave" pointerEvents="none" style={{ ['--hex' as string]: `${size}px` }}>
      <path className="wf-hexcave__rock" d={rockPath} />
      {shapes.map((part) => {
        const floor = outlinePath(part.floor, size);
        return (
          <g key={part.key} className="wf-hexcave__open" data-dim={part.dim || undefined}>
            <path className="wf-hexcave__shade" d={floor} />
            <path className="wf-hexcave__rim" d={floor} />
            <path className="wf-hexcave__floor" d={floor} fillRule="evenodd" />
            <path className="wf-hexcave__edge" d={floor} />
            {part.pools.map(({ tone, loops }) => {
              const d = outlinePath(loops, size);
              return (
                <g key={tone}>
                  <path
                    className={`wf-hexcave__pool wf-hexcave__pool--${tone}`}
                    d={d}
                    fillRule="evenodd"
                  />
                  <path className={`wf-hexcave__pool-edge wf-hexcave__pool-edge--${tone}`} d={d} />
                </g>
              );
            })}
            {part.streams.map(([x1, y1, mx, my, x2, y2], index) => (
              <path
                key={index}
                className="wf-hexcave__stream"
                d={`M ${fmt(x1 * size)} ${fmt(y1 * size)} Q ${fmt(mx * size)} ${fmt(my * size)} ${fmt(x2 * size)} ${fmt(y2 * size)}`}
              />
            ))}
          </g>
        );
      })}
    </g>
  );
});
