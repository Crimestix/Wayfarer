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
import { Feather } from './HexGround';
import type { Hex, PassageKind } from '../../domain/schema';
import ground from '../../ui/assets/hexkarte/cave-floor.webp';
import groundIce from '../../ui/assets/hexkarte/cave-ice.webp';
import rock from '../../ui/assets/hexkarte/cave-rock.webp';
import water from '../../ui/assets/hexkarte/cave-water.webp';
import groundMagma from '../../ui/assets/hexkarte/oben/lava.webp';
import groundCrystal from '../../ui/assets/hexkarte/crystal.webp';
import groundRuins from '../../ui/assets/hexkarte/deep-ruins.webp';
import groundFungus from '../../ui/assets/hexkarte/fungus.webp';
import groundMine from '../../ui/assets/hexkarte/mine.webp';
import groundRubble from '../../ui/assets/hexkarte/rubble.webp';
import groundStalagmites from '../../ui/assets/hexkarte/stalagmites.webp';

/**
 * Der eigene Boden einer Geländeart unter der Erde (Rückmeldung des Spielleiters, 20. 11. 2026:
 * „Die Zeichen passen auch nicht, es sollte das Gelände verändert werden, also eine andere
 * Textur“): Wo ein Pilzwald, Kristalle, Tropfsteine, Geröll, Ruinen oder ein Bergwerk sind, ist
 * der Höhlenboden selbst anders gemalt – kein Zeichen auf dem Feld. Kacheln in
 * `ui/assets/hexkarte`.
 */
export const CAVE_GROUND: Readonly<Record<string, string>> = {
  fungus: groundFungus,
  crystal: groundCrystal,
  stalagmites: groundStalagmites,
  rubble: groundRubble,
  'deep-ruins': groundRuins,
  mine: groundMine,
  // Glutspalten und Eishöhle sind Boden, kein Fleck darauf (Rückmeldung 20. 11.: „auch
  // Gluthöhlen sieht noch nicht gut aus“): dunkler Basalt mit glühenden Rissen, blankes Eis.
  magma: groundMagma,
  'ice-cave': groundIce,
};
const GROUND_KINDS = Object.keys(CAVE_GROUND);

/**
 * Licht im Dunkeln (Auftrag des Spielleiters, 20. 11. 2026: „Das Unterreich sieht immer noch nicht
 * so gut aus wie die Oberwelt. Lass dir nochmal was einfallen, du kannst völlig entscheiden“ –
 * angesehen: sein Zielbild und Höhlenwelten aus Hex-Spielen). Oben ist die Karte schön, weil sie
 * bunt und hell ist; unten ist es finster – schön wird es dort durch **Licht**: Der Fels versinkt
 * fern der Höhlen im Dunkel und ist nur an den Höhlen zu sehen, und was leuchtet, wirft seinen
 * Schein auf Boden und Wand. Je Geländeart der Farbton (`--hex-glow-<ton>`) und wie weit der
 * Schein reicht (in Feldgrößen).
 */
const CAVE_GLOW: Readonly<Record<string, { tone: string; reach: number }>> = {
  fungus: { tone: 'fungus', reach: 1.05 },
  crystal: { tone: 'crystal', reach: 0.95 },
  'ice-cave': { tone: 'crystal', reach: 0.85 },
  magma: { tone: 'magma', reach: 1.25 },
  'deep-lake': { tone: 'water', reach: 0.9 },
  mine: { tone: 'lamp', reach: 0.6 },
};
const GLOW_TONES = ['fungus', 'crystal', 'magma', 'water', 'lamp'] as const;

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

/**
 * Fels, durch den nichts führt: als Massivfels gemalt – oder ohne Ausgang. Eine Höhle ohne Ausgang
 * ist kein Fels: Sie steht als geschlossene Kammer da, bis ein Gang hinführt.
 */
export const isSolid = (hex: Hex): boolean => {
  const kind = kindKeyOf(hex);
  if (kind === SOLID_ROCK) return true;
  return isRock(hex) && !(kind && WIDE_CAVE_KINDS.has(kind));
};

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
  open: 0.18,
  narrow: 0.11,
  climb: 0.16,
  water: 0.18,
  hidden: 0,
  drop: 0.16,
};

/** Flächen eigener Art im Höhlenboden, tiefer als er: See und Abgrund. */
const POOL_KIND: Record<string, string> = {
  'deep-lake': 'water',
  chasm: 'chasm',
  // Glutspalten: ein Netz glühender Risse im Basalt – schmal, von Feld zu Feld verbunden.
  magma: 'magma',
};
const POOL_TONES = ['water', 'chasm', 'magma'] as const;

interface CavePlan {
  floor: CaveBlob[];
  /** Der Boden je Geländeart mit eigener Textur: die Formen ihrer Felder. */
  grounds: Record<string, CaveBlob[]>;
  pools: Record<string, CaveBlob[]>;
  /** Wasser, das durch einen Gang fließt: Linien in Feldgrößen. */
  streams: [number, number, number, number, number, number][];
}

/**
 * Aus den Feldern die Formen, die zusammen den Höhlenboden ergeben – in Feldgrößen. Gänge laufen
 * **mittig**: Sie queren jede Feldseite genau in ihrer Mitte und führen durch die Mitte des
 * Feldes – mit zwei Ausgängen als ein glatter Bogen von Seite zu Seite, sonst als Stern um eine
 * kleine Kammer. Eine weite Höhle füllt ihr Feld und wächst mit weiten Nachbarn zusammen.
 */
function cavePlan(hexes: readonly Hex[], orientation: HexOrientation): CavePlan {
  const byKey = new Map(hexes.map((hex) => [hexKey(hex), hex]));
  const plan: CavePlan = { floor: [], grounds: {}, pools: {}, streams: [] };
  const pool = (tone: string, blob: CaveBlob) => (plan.pools[tone] ??= []).push(blob);
  for (const hex of hexes) {
    if (isSolid(hex)) continue;
    const key = hexKey(hex);
    const c = hexCenter(hex, orientation);
    const cell: LayerCell = { hex, x: c.x, y: c.y, points: '' };
    const wide = isWide(hex);
    const kindKey = kindKeyOf(hex) ?? '';
    const tone = POOL_KIND[kindKey];
    /** Die Formen dieses Feldes – zusammen der Boden, für sich der Boden seiner Geländeart. */
    const own: CaveBlob[] = [];
    const ways = openings(hex, byKey)
      .map(({ side, kind }) => {
        const d = HEX_DIRECTIONS[side]!;
        const other = byKey.get(hexKey({ q: hex.q + d.q, r: hex.r + d.r, level: hex.level }));
        const both = wide && !!other && isWide(other) && kind === 'open';
        return {
          side,
          kind,
          other,
          both,
          r: both ? 0.4 : PASSAGE_RADIUS[kind],
          p: crossing(cell, side, 1, orientation, 0),
        };
      })
      .filter((way) => way.r > 0);

    if (wide) {
      own.push({ x1: c.x, y1: c.y, r: 0.55 });
      for (const way of ways) own.push({ x1: c.x, y1: c.y, x2: way.p.x, y2: way.p.y, r: way.r });
    } else if (ways.length === 2) {
      // Ein Gang durch das Feld: ein glatter Bogen von Seite zu Seite über die Mitte.
      const [a, b] = ways as [(typeof ways)[0], (typeof ways)[0]];
      const steps = 6;
      let px = a.p.x;
      let py = a.p.y;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        const x = u * u * a.p.x + 2 * u * t * c.x + t * t * b.p.x;
        const y = u * u * a.p.y + 2 * u * t * c.y + t * t * b.p.y;
        own.push({ x1: px, y1: py, x2: x, y2: y, r: t <= 0.5 ? a.r : b.r });
        px = x;
        py = y;
      }
    } else {
      // Ein Ende oder eine Kreuzung: jede Seite läuft gerade in die Mitte, dort eine kleine Kammer.
      const widest = Math.max(0.18, ...ways.map((way) => way.r));
      own.push({ x1: c.x, y1: c.y, r: widest * (ways.length >= 3 ? 1.3 : 1.15) });
      for (const way of ways) own.push({ x1: c.x, y1: c.y, x2: way.p.x, y2: way.p.y, r: way.r });
    }
    plan.floor.push(...own);
    if (CAVE_GROUND[kindKey]) (plan.grounds[kindKey] ??= []).push(...own);
    // Grenzt die Fläche an ein Feld derselben Art, wachsen beide zu **einer** Fläche zusammen –
    // breit genug, dass zwischen drei Nachbarn kein Loch bleibt (Rückmeldung des Spielleiters,
    // 20. 11. 2026: „Abgrund verbindet sich nicht richtig“ – über mehrere Felder stand ein Gitter
    // aus Rissen mit hellen Inseln darin).
    const same = (way: (typeof ways)[number]) =>
      !!tone && way.both && !!way.other && POOL_KIND[kindKeyOf(way.other) ?? ''] === tone;
    const joined = ways.some(same);
    for (const way of ways) {
      if (way.kind === 'water')
        plan.streams.push([c.x, c.y, (c.x + way.p.x) / 2, (c.y + way.p.y) / 2, way.p.x, way.p.y]);
      if (tone && same(way))
        pool(tone, {
          x1: c.x,
          y1: c.y,
          x2: way.p.x,
          y2: way.p.y,
          r: tone === 'magma' ? 0.036 : 0.3,
        });
    }

    if (tone === 'magma' || (tone === 'chasm' && !joined)) {
      // Ein einzelner Abgrund ist ein Riss: schmal und lang, in fester Richtung je Feld.
      const turn = wobble(`${key}riss`) * Math.PI;
      const reach = 0.2 + Math.abs(wobble(`${key}weit`)) * 0.1;
      pool(tone, {
        x1: c.x - Math.cos(turn) * reach,
        y1: c.y - Math.sin(turn) * reach,
        x2: c.x + Math.cos(turn) * reach,
        y2: c.y + Math.sin(turn) * reach,
        r: tone === 'magma' ? 0.05 : 0.13,
      });
    } else if (tone) {
      // Ein See liegt nicht genau in der Mitte und ist nie kreisrund.
      pool(tone, {
        x1: c.x + wobble(`${key}sx`) * 0.06,
        y1: c.y + wobble(`${key}sy`) * 0.06,
        r: (joined ? 0.33 : 0.29) + wobble(`${key}sr`) * 0.04,
      });
    }
    // Ein Fluss, der durch die Höhle fließt, steht als Wasser in ihrer Mitte.
    if (hex.river && !tone) pool('water', { x1: c.x, y1: c.y, r: 0.12 });
  }
  return plan;
}

/** Die gemalten Flächen, aus denen die Karte unter der Erde besteht – einmal je Karte. */
export function CaveDefs({ size }: { size: number }) {
  // Fels und Boden sind ruhige Flächen und liegen groß; was auf dem Boden wächst oder liegt, ist
  // feiner gemalt: Man soll Pilze und Brocken erkennen.
  const tile = Math.max(110, size * 3.6);
  const fine = Math.max(72, size * 2.4);
  return (
    <defs>
      <pattern id="wf-hex-rock" patternUnits="userSpaceOnUse" width={tile} height={tile}>
        <image href={rock} width={tile} height={tile} preserveAspectRatio="none" />
      </pattern>
      {/* Der Höhlenboden: heller als der Fels – man soll das Gangnetz auf einen Blick lesen. */}
      <pattern id="wf-hex-ground" patternUnits="userSpaceOnUse" width={tile} height={tile}>
        <image href={ground} width={tile} height={tile} preserveAspectRatio="none" />
        <rect className="wf-hexcave__floortint" width={tile} height={tile} />
      </pattern>
      {/* Die Höhlenwand von oben: gebrochener Stein, hell – als lägen Licht und Staub darauf. */}
      <pattern id="wf-hex-wall" patternUnits="userSpaceOnUse" width={fine} height={fine}>
        <image href={CAVE_GROUND.rubble} width={fine} height={fine} preserveAspectRatio="none" />
        <rect className="wf-hexcave__walltint" width={fine} height={fine} />
      </pattern>
      {/* Der Schein dessen, was leuchtet: in der Mitte hell, zum Rand hin nichts. */}
      {GLOW_TONES.map((tone) => (
        <radialGradient key={tone} id={`wf-hex-glow-${tone}`}>
          <stop
            offset="0"
            stopOpacity={tone === 'magma' ? 0.3 : 0.5}
            style={{ stopColor: `var(--hex-glow-${tone})` }}
          />
          <stop
            offset="0.45"
            stopOpacity={tone === 'magma' ? 0.14 : 0.22}
            style={{ stopColor: `var(--hex-glow-${tone})` }}
          />
          <stop offset="1" stopOpacity="0" style={{ stopColor: `var(--hex-glow-${tone})` }} />
        </radialGradient>
      ))}
      <pattern id="wf-hex-water" patternUnits="userSpaceOnUse" width={fine} height={fine}>
        <image href={water} width={fine} height={fine} preserveAspectRatio="none" />
      </pattern>
      {GROUND_KINDS.map((kind) => (
        <pattern
          key={kind}
          id={`wf-hex-ground-${kind}`}
          patternUnits="userSpaceOnUse"
          width={fine}
          height={fine}
        >
          <image href={CAVE_GROUND[kind]} width={fine} height={fine} preserveAspectRatio="none" />
        </pattern>
      ))}
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
          // Die Höhlenwand ist schroff: feine Zacken, auch an schmalen Gängen.
          floor: caveOutline(used.floor, { rough: 0.15, step: 0.08, crisp: 0.022 }),
          glows: part.dim
            ? []
            : part.hexes
                .filter((hex) => !isSolid(hex) && CAVE_GLOW[kindKeyOf(hex) ?? ''])
                .map((hex) => {
                  const c = hexCenter(hex, orientation);
                  const glow = CAVE_GLOW[kindKeyOf(hex) ?? '']!;
                  return { key: hexKey(hex), x: c.x, y: c.y, ...glow };
                }),
          grounds: GROUND_KINDS.filter((kind) => used.grounds[kind]?.length).map((kind) => ({
            kind,
            // Dasselbe Rauschen wie der Boden: Der Rand der Fläche folgt der Höhlenwand.
            loops: caveOutline(used.grounds[kind]!, { rough: 0.15 }),
          })),
          pools: POOL_TONES.filter((tone) => used.pools[tone]?.length).map((tone) => ({
            tone,
            loops: caveOutline(used.pools[tone]!, {
              rough: tone === 'water' ? 0.15 : 0.16,
              ...(tone === 'magma' ? { crisp: 0.02, step: 0.07 } : {}),
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
      {/* Der Fels – und die Finsternis darüber: Fern der Höhlen sieht man ihn kaum. */}
      <path className="wf-hexcave__rock" d={rockPath} />
      <path className="wf-hexcave__dark" d={rockPath} />
      {shapes.map((part) => {
        const floor = outlinePath(part.floor, size);
        const clip = `wf-hexcave-floor-${part.key}`;
        return (
          <g key={part.key} className="wf-hexcave__open" data-dim={part.dim || undefined}>
            <clipPath id={clip}>
              <path d={floor} clipRule="evenodd" />
            </clipPath>
            {/* An den Höhlen ist der Fels zu sehen: derselbe Stein noch einmal, ohne Finsternis,
                weich auslaufend. Ihre Wand hat Stärke: ein Band aus hellem, gebrochenem Stein mit
                dunkler Kante. */}
            {!part.dim && <Feather d={floor} paint="url(#wf-hex-rock)" scale={2.6} />}
            <path className="wf-hexcave__shade" d={floor} />
            <path className="wf-hexcave__rim-ink" d={floor} />
            <path className="wf-hexcave__rim" d={floor} />
            <path className="wf-hexcave__floor" d={floor} fillRule="evenodd" />
            {part.grounds.length > 0 && (
              // Der eigene Boden einer Geländeart: nie über die Höhlenwand hinaus.
              <g clipPath={`url(#${clip})`}>
                {part.grounds.map(({ kind, loops }) => {
                  const d = outlinePath(loops, size);
                  const paint = `url(#wf-hex-ground-${kind})`;
                  return (
                    <g key={kind}>
                      <Feather d={d} paint={paint} scale={0.8} />
                      <path className="wf-hexcave__ground" d={d} fill={paint} fillRule="evenodd" />
                    </g>
                  );
                })}
              </g>
            )}
            {/* Der Boden liegt tiefer als der Fels, das Licht kommt von oben links (wie bei allen
                gemalten Zeichen): Die Wand oben links wirft Schatten auf den Boden, die Wand unten
                rechts steht im Licht. Derselbe Umriss, versetzt und auf den Boden beschnitten. */}
            <g clipPath={`url(#${clip})`}>
              <path className="wf-hexcave__wallshade" d={floor} />
              <g transform={`translate(${fmt(size * 0.07)} ${fmt(size * 0.085)})`}>
                <path className="wf-hexcave__cast wf-hexcave__cast--far" d={floor} />
                <path className="wf-hexcave__cast" d={floor} />
              </g>
              <path
                className="wf-hexcave__lit"
                d={floor}
                transform={`translate(${fmt(-size * 0.03)} ${fmt(-size * 0.04)})`}
              />
            </g>
            <path className="wf-hexcave__edge" d={floor} />
            {/* Was leuchtet, wirft seinen Schein auf Boden, Wand und Fels. */}
            {part.glows.map((glow) => (
              <circle
                key={glow.key}
                className="wf-hexcave__glow"
                cx={fmt(glow.x * size)}
                cy={fmt(glow.y * size)}
                r={fmt(glow.reach * size)}
                fill={`url(#wf-hex-glow-${glow.tone})`}
              />
            ))}
            {part.pools.map(({ tone, loops }) => {
              const d = outlinePath(loops, size);
              return (
                <g key={tone}>
                  {/* Der Rand: am See nasser Boden, am Abgrund eine Kante aus Stein. */}
                  <path className={`wf-hexcave__pool-lip wf-hexcave__pool-lip--${tone}`} d={d} />
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
