/**
 * Zeichnet eine Ebene eines Dungeons auf eine Leinwand: heller Boden, kräftige Wände, Schraffur im
 * Fels ringsum. Gezeichnet wird nie das Gemalte selbst, sondern was `domain/dungeon.ts` daraus
 * liest (`edgeSegments`) – so sieht eine Wand, die von selbst dasteht, aus wie jede andere.
 */
import { caveLoops, spotNoise, type CaveLoop } from './caveShape';
import {
  cellOfKey,
  cellsOfEdge,
  edgeRun,
  edgeSegments,
  keyOf,
  roomAnchor,
  roundOf,
  trapSpots,
  type DungeonPick,
  type EdgeSegment,
  type RoundShape,
} from '../../domain/dungeon';
import type { DungeonCell, DungeonLevel, DungeonMarker, DungeonTile } from '../../domain/schema';

/** Wo die Karte auf der Leinwand liegt: Pixel je Feld und Verschiebung. */
export interface View {
  zoom: number;
  ox: number;
  oy: number;
}

export const MIN_ZOOM = 6;
export const MAX_ZOOM = 72;
export const DEFAULT_ZOOM = 30;

/** Die Farben der Karte – aus `tokens.css`, einmal gelesen. */
export interface Palette {
  rock: string;
  hatch: string;
  floor: string;
  grid: string;
  wall: string;
  inkSoft: string;
  water: string;
  waterLine: string;
  chasm: string;
  rubble: string;
  gold: string;
  blood: string;
  arcane: string;
  ember: string;
  snow: string;
  lava: string;
  mud: string;
  moss: string;
  glow: string;
  font: string;
}

export function readPalette(element: HTMLElement): Palette {
  const style = getComputedStyle(element);
  const get = (name: string) => style.getPropertyValue(name).trim();
  return {
    rock: get('--bg-inset'),
    hatch: get('--line-strong'),
    floor: get('--map-paper'),
    grid: get('--map-paper-edge'),
    wall: get('--map-ink'),
    inkSoft: get('--map-ink-soft'),
    water: get('--map-water'),
    waterLine: get('--map-water-line'),
    chasm: get('--map-chasm'),
    rubble: get('--map-rubble'),
    gold: get('--gold-bright'),
    blood: get('--blood-bright'),
    arcane: get('--arcane'),
    ember: get('--ember'),
    snow: get('--map-snow'),
    lava: get('--terrain-lava'),
    mud: get('--map-road'),
    moss: get('--moss'),
    glow: get('--map-glow'),
    font: get('--font-display') || 'Georgia, serif',
  };
}

interface Parsed {
  cells: TileCell[];
  segments: EdgeSegment[];
  /** Felsfelder, die an Boden grenzen – dort steht die Schraffur. */
  rim: DungeonCell[];
  labels: { roomId: string; name: string; x: number; y: number }[];
  /** Felder, die als Höhle gezeichnet werden. */
  caveKeys: Set<string>;
  /** Der Umriss der Höhlen. */
  caveLoops: CaveLoop[];
  /** Felsfelder im zweiten Ring um den Boden – dort läuft die Schraffur aus. */
  rimFar: DungeonCell[];
  /** Türen, Gitter, Fenster … – nebeneinanderliegende gleicher Art als eine Öffnung. */
  openings: EdgeSegment[];
  /** Runde Räume: ihre Form, ihre Felder und was an ihrem Rand eine Öffnung ist. */
  rounds: { shape: RoundShape; cells: TileCell[]; openings: EdgeSegment[] }[];
  /** Felder runder Räume – sie werden mit ihrem Raum gezeichnet, nicht einzeln. */
  roundKeys: Set<string>;
  /** Kanten zwischen Boden und Luftraum: dort endet der Boden. */
  ledges: [number, number, number, number][];
}

type TileCell = { x: number; y: number; tile: DungeonTile; roomId: string | null };

const parsedOf = new WeakMap<DungeonLevel, Parsed>();

function parse(level: DungeonLevel): Parsed {
  const known = parsedOf.get(level);
  if (known) return known;
  const cells = Object.entries(level.tiles).map(([key, tile]) => ({
    ...cellOfKey(key),
    tile,
    roomId: level.roomOf[key] ?? null,
  }));
  const rim = new Map<string, DungeonCell>();
  for (const cell of cells)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const near = { x: cell.x + dx, y: cell.y + dy };
        const key = keyOf(near);
        if (level.tiles[key] === undefined) rim.set(key, near);
      }
  const rimFar = new Map<string, DungeonCell>();
  for (const cell of rim.values())
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const near = { x: cell.x + dx, y: cell.y + dy };
        const key = keyOf(near);
        if (level.tiles[key] === undefined && !rim.has(key)) rimFar.set(key, near);
      }
  const byRoom = new Map<string, DungeonCell[]>();
  for (const cell of cells) {
    if (!cell.roomId) continue;
    const list = byRoom.get(cell.roomId) ?? [];
    list.push(cell);
    byRoom.set(cell.roomId, list);
  }
  const labels: Parsed['labels'] = [];
  const taken = new Set([...level.stairs, ...level.markers].map(keyOf));
  for (const room of level.rooms) {
    const own = byRoom.get(room.id);
    const name = room.name.trim();
    if (!own || !name) continue;
    // Die Mitte der Fläche, wenn sie auf ihrem Boden liegt; sonst das Feld, das ihr am nächsten ist.
    const cx = own.reduce((sum, c) => sum + c.x + 0.5, 0) / own.length;
    const cy = own.reduce((sum, c) => sum + c.y + 0.5, 0) / own.length;
    const inside = level.roomOf[keyOf({ x: Math.floor(cx), y: Math.floor(cy) })] === room.id;
    const anchor = roomAnchor(own)!;
    let x = inside ? cx : anchor.x + 0.5;
    let y = inside ? cy : anchor.y + 0.5;
    // Liegt dort eine Treppe oder Markierung, rückt der Name eine Reihe hinauf oder hinab.
    const busy = (px: number, py: number) =>
      taken.has(keyOf({ x: Math.floor(px), y: Math.floor(py) }));
    const free = (px: number, py: number) =>
      level.roomOf[keyOf({ x: Math.floor(px), y: Math.floor(py) })] === room.id && !busy(px, py);
    if (busy(x, y)) {
      const row = Math.floor(y) + 0.5;
      if (free(x, row - 1)) y = row - 1;
      else if (free(x, row + 1)) y = row + 1;
    }
    labels.push({ roomId: room.id, name, x, y });
  }
  // Runde Räume: Ihre Wand ist die Ellipse, nicht der Rand ihrer Felder.
  const roundRoomOf = new Map<string, string>();
  const rounds: Parsed['rounds'] = [];
  const roundIndex = new Map<string, number>();
  for (const room of level.rooms) {
    const shape = roundOf(level, room);
    const own = byRoom.get(room.id) as TileCell[] | undefined;
    if (!shape || !own) continue;
    roundIndex.set(room.id, rounds.length);
    rounds.push({ shape, cells: own, openings: [] });
    for (const cell of own) roundRoomOf.set(keyOf(cell), room.id);
  }
  const caveKeys = new Set(level.cave);
  const segments: EdgeSegment[] = [];
  const ledges: Parsed['ledges'] = [];
  for (const seg of edgeSegments(level)) {
    const { a, b } = cellsOfEdge(seg.key);
    const ra = roundRoomOf.get(keyOf(a));
    const rb = roundRoomOf.get(keyOf(b));
    if (ra !== rb) {
      // Am Rand eines runden Raums: Wand und Fels zeichnet die Ellipse, Öffnungen bleiben.
      if (seg.kind === 'rock' || seg.kind === 'wall') continue;
      for (const id of [ra, rb]) if (id) rounds[roundIndex.get(id)!]!.openings.push(seg);
    }
    if (seg.kind === 'rock') {
      // Eine schräge Wand zeichnet sich selbst; an Höhlenboden ist der Rand unregelmäßig.
      if (seg.implied) continue;
      const floor = level.tiles[keyOf(a)] !== undefined ? a : b;
      if (caveKeys.has(keyOf(floor))) continue;
    }
    segments.push(seg);
  }
  for (const cell of cells) {
    if (cell.tile !== 'air') continue;
    const sides: [number, number, number, number, number, number][] = [
      [0, -1, 0, 0, 1, 0],
      [1, 0, 1, 0, 1, 1],
      [0, 1, 0, 1, 1, 1],
      [-1, 0, 0, 0, 0, 1],
    ];
    for (const [dx, dy, x1, y1, x2, y2] of sides) {
      const other = level.tiles[keyOf({ x: cell.x + dx, y: cell.y + dy })];
      if (other !== undefined && other !== 'air')
        ledges.push([cell.x + x1, cell.y + y1, cell.x + x2, cell.y + y2]);
    }
  }
  // Öffnungen: Zwei Türen nebeneinander sind eine Doppeltür – einmal gezeichnet, auf ganzer Breite.
  const openings: EdgeSegment[] = [];
  const merged = new Set<string>();
  const byKey = new Map(segments.map((seg) => [seg.key, seg]));
  for (const seg of segments) {
    if (seg.kind === 'rock' || seg.kind === 'wall' || merged.has(seg.key)) continue;
    const run = (seg.edge ? edgeRun(level, seg.key) : [seg.key]).filter(
      (key) => byKey.get(key)?.kind === seg.kind,
    );
    for (const key of run) merged.add(key);
    const first = byKey.get(run[0]!) ?? seg;
    const last = byKey.get(run[run.length - 1]!) ?? seg;
    openings.push({ ...seg, x1: first.x1, y1: first.y1, x2: last.x2, y2: last.y2 });
  }
  const parsed = {
    cells,
    segments,
    openings,
    rim: [...rim.values()],
    labels,
    rounds,
    roundKeys: new Set(roundRoomOf.keys()),
    caveKeys,
    caveLoops: caveLoops(caveKeys, (x, y) => level.tiles[`${x},${y}`] !== undefined),
    rimFar: [...rimFar.values()],
    ledges,
  };
  parsedOf.set(level, parsed);
  return parsed;
}

export interface Scene {
  level: DungeonLevel;
  /** Eine andere Ebene, die blass durchscheint. */
  ghost: DungeonLevel | null;
  /** Höhen als Zahl zeigen – solange das Höhen-Werkzeug gewählt ist. */
  heightNumbers?: boolean;
  /** Die Ebene darunter – sie ist durch Luftraum zu sehen. */
  below: DungeonLevel | null;
  /** Die Form eines runden Raums, der gerade aufgezogen wird. */
  hoverRound: RoundShape | null;
  view: View;
  width: number;
  height: number;
  palette: Palette;
  selection: DungeonPick | null;
  /** Felder unter dem Zeiger (Pinsel, Rechteck). */
  hoverCells: readonly DungeonCell[];
  /** Kante unter dem Zeiger. */
  hoverEdge: string | null;
  /** Felder, die gerade gewählt werden (Auslöser, „zu bemerken von“). */
  pickCells: readonly DungeonCell[] | null;
  /** Die beiden Ecken eines aufgezogenen Ausschnitts. */
  region?: readonly DungeonCell[] | null;
  /** Am Tisch: Figuren, Sicht und der Weg unter dem Zeiger. */
  play?: PlayOverlay | null;
}

export interface TokenDraw {
  id: string;
  x: number;
  y: number;
  name: string;
  kind: 'hero' | 'foe';
  selected: boolean;
  /** In Runden am Zug. */
  turn: boolean;
  light: boolean;
  /** Besiegt (keine Trefferpunkte mehr). */
  down: boolean;
  /** Hat die Gruppe bemerkt. */
  alert: boolean;
}

export interface PlayOverlay {
  /** Felder, die die Gruppe gerade sieht. */
  visible: ReadonlySet<string>;
  /** Felder, die sie schon gesehen hat. */
  seen: ReadonlySet<string>;
  /** Die Sicht der Spieler: Ungesehenes ist ganz dunkel. */
  playerView: boolean;
  tokens: readonly TokenDraw[];
  /** Lichter der Karte, die gerade aus sind, und Schalter, die an sind. */
  unlit: ReadonlySet<string>;
  switched: ReadonlySet<string>;
  /** Der Weg unter dem Zeiger mit seiner Länge in Fuß. */
  route: { cells: readonly DungeonCell[]; feet: number } | null;
}

export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { level, view, width, height, palette } = scene;
  const z = view.zoom;
  const parsed = parse(level);
  const sx = (x: number) => x * z + view.ox;
  const sy = (y: number) => y * z + view.oy;
  const visible = (x: number, y: number) =>
    sx(x + 1) >= 0 && sy(y + 1) >= 0 && sx(x) <= width && sy(y) <= height;

  ctx.fillStyle = palette.rock;
  ctx.fillRect(0, 0, width, height);

  // Schraffur im Fels am Rand des Bodens.
  if (z >= 10) {
    ctx.strokeStyle = palette.hatch;
    ctx.lineWidth = 1;
    ctx.lineCap = 'round';
    // Wie mit der Feder gesetzt: kleine Bündel paralleler Striche in wechselnder Richtung.
    const hatch = (cells: DungeonCell[], bundles: number, alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (const cell of cells) {
        if (!visible(cell.x, cell.y)) continue;
        for (let b = 0; b < bundles; b++) {
          const salt = b * 7;
          const cx = cell.x + 0.18 + spotNoise(cell.x, cell.y, salt + 1) * 0.64;
          const cy = cell.y + 0.18 + spotNoise(cell.x, cell.y, salt + 2) * 0.64;
          const angle = spotNoise(cell.x, cell.y, salt + 3) * Math.PI;
          const len = 0.2 + spotNoise(cell.x, cell.y, salt + 4) * 0.12;
          const dx = Math.cos(angle);
          const dy = Math.sin(angle);
          for (let i = -1; i <= 1; i++) {
            const ox = cx - dy * i * 0.11;
            const oy = cy + dx * i * 0.11;
            const l = len * (i === 0 ? 1 : 0.8);
            ctx.moveTo(sx(ox - dx * l), sy(oy - dy * l));
            ctx.lineTo(sx(ox + dx * l), sy(oy + dy * l));
          }
        }
      }
      ctx.stroke();
    };
    hatch(parsed.rim, z >= 18 ? 4 : 3, 0.6);
    hatch(parsed.rimFar, 2, 0.28);
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  }

  // Die andere Ebene, blass.
  if (scene.ghost) {
    ctx.fillStyle = palette.arcane;
    ctx.globalAlpha = 0.16;
    for (const key of Object.keys(scene.ghost.tiles)) {
      const cell = cellOfKey(key);
      if (visible(cell.x, cell.y)) ctx.fillRect(sx(cell.x), sy(cell.y), z, z);
    }
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = palette.arcane;
    ctx.lineWidth = 1.5;
    for (const stair of scene.ghost.stairs) {
      if (!visible(stair.x, stair.y)) continue;
      ctx.strokeRect(sx(stair.x) + z * 0.2, sy(stair.y) + z * 0.2, z * 0.6, z * 0.6);
    }
    ctx.globalAlpha = 1;
  }

  // Höhlen: ein unregelmäßiger Rand statt gerader Wände – erst der dunkle Umriss, dann der Boden.
  const caves = parsed.cells.filter((cell) => parsed.caveKeys.has(keyOf(cell)));
  /** Der Umriss aller Höhlen als ein Pfad – zum Füllen und Beschneiden. */
  const cavePath = () => {
    ctx.beginPath();
    for (const loop of parsed.caveLoops) {
      loop.points.forEach(([x, y], i) =>
        i === 0 ? ctx.moveTo(sx(x), sy(y)) : ctx.lineTo(sx(x), sy(y)),
      );
      ctx.closePath();
    }
  };
  /** Nur die Strecken des Umrisses, die an Fels grenzen – die Höhlenwand. */
  const caveWall = () => {
    ctx.beginPath();
    for (const loop of parsed.caveLoops) {
      const n = loop.points.length;
      let drawing = false;
      for (let i = 0; i <= n; i++) {
        const [x, y] = loop.points[i % n]!;
        if (drawing) ctx.lineTo(sx(x), sy(y));
        if (loop.open[i % n]) drawing = false;
        else if (!drawing) {
          ctx.moveTo(sx(x), sy(y));
          drawing = true;
        }
      }
    }
  };

  // Boden.
  for (const cell of parsed.cells) {
    if (!visible(cell.x, cell.y) || parsed.roundKeys.has(keyOf(cell))) continue;
    if (parsed.caveKeys.has(keyOf(cell))) continue;
    drawTile(ctx, level, scene.below, cell, sx(cell.x), sy(cell.y), z, palette);
  }
  // Höhlenboden: innerhalb des Umrisses, jedes Feld mit dem, was es ist.
  if (caves.length > 0) {
    ctx.save();
    cavePath();
    ctx.clip();
    const pad = z * 0.3;
    for (const cell of caves) {
      if (!visible(cell.x, cell.y)) continue;
      // Der Boden reicht bis an den Umriss, auch wo der über das Feld hinausgeht.
      ctx.fillStyle = tileColor(cell.tile, palette);
      ctx.fillRect(sx(cell.x) - pad, sy(cell.y) - pad, z + pad * 2, z + pad * 2);
    }
    for (const cell of caves) {
      if (!visible(cell.x, cell.y) || cell.tile === 'floor') continue;
      drawTile(ctx, level, scene.below, cell, sx(cell.x), sy(cell.y), z, palette);
    }
    if (z >= 9) {
      // Das Raster der Höhle: nur zwischen ihren Feldern, nicht am Rand.
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      for (const cell of caves) {
        if (!visible(cell.x, cell.y)) continue;
        const x = Math.round(sx(cell.x)) + 0.5;
        const y = Math.round(sy(cell.y)) + 0.5;
        if (parsed.caveKeys.has(keyOf({ x: cell.x - 1, y: cell.y }))) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + z);
        }
        if (parsed.caveKeys.has(keyOf({ x: cell.x, y: cell.y - 1 }))) {
          ctx.moveTo(x, y);
          ctx.lineTo(x + z, y);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // Ein weicher Schatten entlang der Höhlenwand.
    ctx.strokeStyle = palette.wall;
    ctx.lineJoin = 'round';
    for (const [width, alpha] of [
      [0.7, 0.07],
      [0.4, 0.09],
    ] as const) {
      ctx.lineWidth = z * width;
      ctx.globalAlpha = alpha;
      caveWall();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  // Schräge Wände: Die Ecke des Feldes ist Fels.
  for (const [key, corner] of Object.entries(level.corners)) {
    const cell = cellOfKey(key);
    if (!visible(cell.x, cell.y)) continue;
    const x0 = sx(cell.x);
    const y0 = sy(cell.y);
    const cx = corner[1] === 'w' ? x0 : x0 + z;
    const cy = corner[0] === 'n' ? y0 : y0 + z;
    const ax = cx;
    const ay = corner[0] === 'n' ? y0 + z : y0;
    const bx = corner[1] === 'w' ? x0 + z : x0;
    const by = cy;
    ctx.fillStyle = palette.rock;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = palette.wall;
    ctx.lineWidth = Math.max(2, z * 0.13);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  // Höhen und schwieriges Gelände.
  if (z >= 9) {
    // Höhen: Was höher liegt, ist eine Spur heller und wirft einen Schatten auf das Tiefere daneben;
    // an der Kante steht eine Linie, ab zehn Fuß mit Strichen hangabwärts – wie auf alten Karten.
    const heightOf = (x: number, y: number): number | null =>
      level.tiles[`${x},${y}`] === undefined ? null : (level.heights[`${x},${y}`] ?? 0);
    if (Object.keys(level.heights).length > 0) {
      for (const [key, feet] of Object.entries(level.heights)) {
        const cell = cellOfKey(key);
        if (!visible(cell.x, cell.y)) continue;
        ctx.fillStyle = feet > 0 ? palette.snow : palette.chasm;
        ctx.globalAlpha =
          feet > 0 ? Math.min(0.26, 0.06 + feet / 160) : Math.min(0.4, 0.1 + -feet / 80);
        ctx.fillRect(sx(cell.x), sy(cell.y), z, z);
      }
      ctx.globalAlpha = 1;
      const sides = [
        // dx, dy des höheren Nachbarn; die Kante in Feldmaßen; wohin der Schatten fällt
        [0, -1, 0, 0, 1, 0, 0, 1, 1],
        [-1, 0, 0, 0, 0, 1, 1, 0, 1],
        [0, 1, 0, 1, 1, 1, 0, -1, 0.4],
        [1, 0, 1, 0, 1, 1, -1, 0, 0.4],
      ] as const;
      const ticks: [number, number, number, number][] = [];
      const lines: [number, number, number, number][] = [];
      for (const cell of parsed.cells) {
        if (!visible(cell.x, cell.y)) continue;
        const own = level.heights[keyOf(cell)] ?? 0;
        for (const [dx, dy, x1, y1, x2, y2, nx, ny, lit] of sides) {
          const other = heightOf(cell.x + dx, cell.y + dy);
          if (other === null || other <= own) continue;
          const drop = other - own;
          // Das Licht kommt von oben links: Dorthin, nach unten rechts, fällt der Schatten lang.
          const depth = z * Math.min(0.85, 0.2 + drop / 28) * (lit === 1 ? 1 : 0.6);
          const ax = sx(cell.x + x1);
          const ay = sy(cell.y + y1);
          const gradient = ctx.createLinearGradient(ax, ay, ax + nx * depth, ay + ny * depth);
          gradient.addColorStop(0, palette.wall);
          gradient.addColorStop(1, 'transparent');
          ctx.fillStyle = gradient;
          ctx.globalAlpha = Math.min(0.62, 0.2 + drop / 50) * lit;
          ctx.fillRect(
            Math.min(ax, ax + nx * depth),
            Math.min(ay, ay + ny * depth),
            nx === 0 ? z : depth,
            ny === 0 ? z : depth,
          );
          lines.push([cell.x + x1, cell.y + y1, cell.x + x2, cell.y + y2]);
          if (drop >= 10) {
            const len = Math.min(0.3, 0.1 + drop / 120);
            for (let i = 0; i < 4; i++) {
              const t = (i + 0.5) / 4;
              const px = cell.x + x1 + (x2 - x1) * t;
              const py = cell.y + y1 + (y2 - y1) * t;
              const l = len * (i % 2 === 0 ? 1 : 0.6);
              ticks.push([px, py, px + nx * l, py + ny * l]);
            }
          }
        }
      }
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = palette.wall;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.2, z * 0.05);
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of lines) {
        ctx.moveTo(sx(x1), sy(y1));
        ctx.lineTo(sx(x2), sy(y2));
      }
      ctx.stroke();
      ctx.lineWidth = Math.max(1, z * 0.035);
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of ticks) {
        ctx.moveTo(sx(x1), sy(y1));
        ctx.lineTo(sx(x2), sy(y2));
      }
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.globalAlpha = 1;
      // Die Zahl steht nur da, solange mit dem Höhen-Werkzeug gearbeitet wird.
      if (scene.heightNumbers && z >= 22) {
        ctx.font = `600 ${Math.max(9, z * 0.28)}px ${palette.font}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = palette.inkSoft;
        for (const [key, feet] of Object.entries(level.heights)) {
          const cell = cellOfKey(key);
          if (visible(cell.x, cell.y))
            ctx.fillText(`${feet > 0 ? '+' : ''}${feet}`, sx(cell.x) + 3, sy(cell.y) + 2);
        }
      }
    }
    ctx.fillStyle = palette.inkSoft;
    for (const key of level.rough) {
      const cell = cellOfKey(key);
      if (!visible(cell.x, cell.y)) continue;
      for (const [fx, fy] of [
        [0.72, 0.8],
        [0.84, 0.72],
        [0.86, 0.86],
      ] as const) {
        ctx.beginPath();
        ctx.arc(sx(cell.x + fx), sy(cell.y + fy), Math.max(1, z * 0.035), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // Runde Räume: der Boden ist die Ellipse.
  const ellipse = (shape: RoundShape) => {
    ctx.beginPath();
    ctx.ellipse(
      sx(shape.x + shape.w / 2),
      sy(shape.y + shape.h / 2),
      (shape.w / 2) * z,
      (shape.h / 2) * z,
      0,
      0,
      Math.PI * 2,
    );
  };
  for (const round of parsed.rounds) {
    ctx.save();
    ellipse(round.shape);
    ctx.clip();
    // Der Grund ist, was der Raum überwiegend ist – Luftraum bei einer Halle von oben gesehen.
    const airy = round.cells.filter((cell) => cell.tile === 'air').length * 2 > round.cells.length;
    const box = [
      sx(round.shape.x),
      sy(round.shape.y),
      round.shape.w * z,
      round.shape.h * z,
    ] as const;
    ctx.fillStyle = airy ? palette.chasm : palette.floor;
    ctx.fillRect(...box);
    if (airy && scene.below) {
      ctx.fillStyle = palette.floor;
      ctx.globalAlpha = 0.42;
      ctx.fillRect(...box);
      ctx.globalAlpha = 1;
    }
    for (const cell of round.cells)
      if (cell.tile !== (airy ? 'air' : 'floor'))
        drawTile(ctx, level, scene.below, cell, sx(cell.x), sy(cell.y), z, palette);
    if (z >= 9) {
      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < round.shape.w; i++) {
        const x = Math.round(sx(round.shape.x + i)) + 0.5;
        ctx.moveTo(x, sy(round.shape.y));
        ctx.lineTo(x, sy(round.shape.y + round.shape.h));
      }
      for (let j = 1; j < round.shape.h; j++) {
        const y = Math.round(sy(round.shape.y + j)) + 0.5;
        ctx.moveTo(sx(round.shape.x), y);
        ctx.lineTo(sx(round.shape.x + round.shape.w), y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  // Raster auf dem Boden.
  if (z >= 9) {
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const cell of parsed.cells) {
      if (!visible(cell.x, cell.y) || cell.tile === 'chasm' || cell.tile === 'air') continue;
      if (parsed.roundKeys.has(keyOf(cell)) || parsed.caveKeys.has(keyOf(cell))) continue;
      const x = Math.round(sx(cell.x)) + 0.5;
      const y = Math.round(sy(cell.y)) + 0.5;
      ctx.moveTo(x, y + z);
      ctx.lineTo(x, y);
      ctx.lineTo(x + z, y);
    }
    ctx.stroke();
  }

  // Der gewählte Raum.
  if (scene.selection?.type === 'room') {
    const roomId = scene.selection.id;
    ctx.fillStyle = palette.gold;
    ctx.globalAlpha = 0.28;
    const shape = parsed.rounds.find((round) => round.cells[0]?.roomId === roomId)?.shape;
    if (shape) {
      ellipse(shape);
      ctx.fill();
    } else
      for (const cell of parsed.cells)
        if (cell.roomId === roomId && visible(cell.x, cell.y))
          ctx.fillRect(sx(cell.x), sy(cell.y), z, z);
    ctx.globalAlpha = 1;
  }

  // Fallen: die Felder, auf denen sie auslösen.
  for (const trap of level.traps) {
    const chosen = scene.selection?.type === 'trap' && scene.selection.id === trap.id;
    if (chosen) {
      ctx.fillStyle = palette.arcane;
      ctx.globalAlpha = 0.22;
      for (const spot of trapSpots(level, trap)) ctx.fillRect(sx(spot.x), sy(spot.y), z, z);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = palette.blood;
    ctx.globalAlpha = chosen ? 0.5 : 0.3;
    for (const cell of trap.cells) ctx.fillRect(sx(cell.x), sy(cell.y), z, z);
    ctx.globalAlpha = 1;
  }

  // Wände, Türen, Gitter, Geheimtüren.
  const wallWidth = Math.max(2, z * 0.13);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = palette.wall;
  const solidWalls = () => {
    ctx.beginPath();
    for (const seg of parsed.segments) {
      if (!SOLID_EDGES.has(seg.kind)) continue;
      ctx.moveTo(sx(seg.x1), sy(seg.y1));
      ctx.lineTo(sx(seg.x2), sy(seg.y2));
    }
  };
  // Ein weicher Schatten am Fuß der Wände gibt den Räumen Tiefe.
  if (z >= 12) {
    for (const [width, alpha] of [
      [0.62, 0.06],
      [0.36, 0.08],
    ] as const) {
      ctx.lineWidth = z * width;
      ctx.globalAlpha = alpha;
      solidWalls();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.lineWidth = wallWidth;
  solidWalls();
  ctx.stroke();
  if (parsed.caveLoops.length > 0) {
    caveWall();
    ctx.stroke();
  }
  // Die Wand eines runden Raums ist seine Ellipse; wo eine Öffnung sitzt, ist sie unterbrochen.
  for (const round of parsed.rounds) {
    ctx.strokeStyle = palette.wall;
    ctx.lineWidth = wallWidth;
    ellipse(round.shape);
    ctx.stroke();
    ctx.fillStyle = palette.floor;
    for (const seg of round.openings) {
      if (SOLID_EDGES.has(seg.kind)) continue;
      const { a, b } = cellsOfEdge(seg.key);
      const horizontal = seg.y1 === seg.y2;
      // So weit reicht die Lücke auf jeder Seite, auf der Boden liegt.
      const before = level.tiles[keyOf(a)] !== undefined ? 0.5 : 0;
      const after = level.tiles[keyOf(b)] !== undefined ? 0.5 : 0;
      if (horizontal)
        ctx.fillRect(sx(seg.x1 + 0.16), sy(seg.y1 - before), z * 0.68, z * (before + after));
      else ctx.fillRect(sx(seg.x1 - before), sy(seg.y1 + 0.16), z * (before + after), z * 0.68);
    }
  }
  // Wo der Boden an Luftraum endet.
  if (parsed.ledges.length > 0) {
    ctx.strokeStyle = palette.inkSoft;
    ctx.lineWidth = Math.max(1.5, z * 0.06);
    ctx.setLineDash([z * 0.18, z * 0.1]);
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of parsed.ledges) {
      ctx.moveTo(sx(x1), sy(y1));
      ctx.lineTo(sx(x2), sy(y2));
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const seg of parsed.openings) {
    drawOpening(ctx, seg, sx, sy, z, wallWidth, palette);
    drawEdgeMarks(ctx, seg, sx, sy, z, palette);
  }
  ctx.lineCap = 'butt';

  // Auslöser: ihr Bereich, gestrichelt umrandet.
  for (const zone of level.zones) {
    const chosen = scene.selection?.type === 'zone' && scene.selection.id === zone.id;
    const keys = new Set(zone.cells.map(keyOf));
    ctx.fillStyle = palette.arcane;
    ctx.globalAlpha = chosen ? 0.3 : 0.14;
    for (const cell of zone.cells) ctx.fillRect(sx(cell.x), sy(cell.y), z, z);
    ctx.globalAlpha = chosen ? 1 : 0.75;
    ctx.strokeStyle = palette.arcane;
    ctx.lineWidth = chosen ? 2.5 : 1.5;
    ctx.setLineDash([z * 0.2, z * 0.14]);
    ctx.beginPath();
    for (const cell of zone.cells) {
      // Nur der Außenrand des Bereichs.
      if (!keys.has(keyOf({ x: cell.x, y: cell.y - 1 }))) {
        ctx.moveTo(sx(cell.x), sy(cell.y));
        ctx.lineTo(sx(cell.x + 1), sy(cell.y));
      }
      if (!keys.has(keyOf({ x: cell.x, y: cell.y + 1 }))) {
        ctx.moveTo(sx(cell.x), sy(cell.y + 1));
        ctx.lineTo(sx(cell.x + 1), sy(cell.y + 1));
      }
      if (!keys.has(keyOf({ x: cell.x - 1, y: cell.y }))) {
        ctx.moveTo(sx(cell.x), sy(cell.y));
        ctx.lineTo(sx(cell.x), sy(cell.y + 1));
      }
      if (!keys.has(keyOf({ x: cell.x + 1, y: cell.y }))) {
        ctx.moveTo(sx(cell.x + 1), sy(cell.y));
        ctx.lineTo(sx(cell.x + 1), sy(cell.y + 1));
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  // Bewohner, wie sie vorbereitet sind: ihr Platz und ihre Runde.
  for (const dweller of level.dwellers) {
    const chosen = scene.selection?.type === 'dweller' && scene.selection.id === dweller.id;
    if (dweller.route.length > 0) {
      ctx.strokeStyle = palette.blood;
      ctx.globalAlpha = chosen ? 0.95 : 0.45;
      ctx.lineWidth = Math.max(1.5, z * 0.06);
      ctx.setLineDash([z * 0.16, z * 0.14]);
      ctx.beginPath();
      ctx.moveTo(sx(dweller.x + 0.5), sy(dweller.y + 0.5));
      for (const stop of dweller.route) ctx.lineTo(sx(stop.x + 0.5), sy(stop.y + 0.5));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = palette.blood;
      dweller.route.forEach((stop) => {
        ctx.beginPath();
        ctx.arc(sx(stop.x + 0.5), sy(stop.y + 0.5), Math.max(2.5, z * 0.09), 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }
    const cx = sx(dweller.x + 0.5);
    const cy = sy(dweller.y + 0.5);
    ctx.fillStyle = palette.blood;
    ctx.beginPath();
    ctx.arc(cx, cy, z * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = chosen ? palette.gold : palette.wall;
    ctx.lineWidth = chosen ? 2.5 : 1.5;
    ctx.stroke();
    if (z >= 14) {
      ctx.fillStyle = palette.floor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const name = dweller.name.trim() || '?';
      ctx.font = `700 ${Math.max(10, z * 0.32)}px ${palette.font}`;
      ctx.fillText(name.slice(0, 1).toUpperCase() + (z >= 24 ? name.slice(1, 2) : ''), cx, cy + 1);
    }
  }
  // Worauf ein gewählter Schalter wirkt.
  if (scene.selection?.type === 'marker') {
    const id = scene.selection.id;
    const marker = level.markers.find((m) => m.id === id);
    ctx.strokeStyle = palette.gold;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    for (const link of marker?.links ?? []) {
      if (link.levelId !== level.id || !marker) continue;
      let tx: number | null = null;
      let ty = 0;
      if (link.kind === 'edge') {
        const run = edgeRun(level, link.ref);
        const a = cellsOfEdge(run[0]!);
        const b = cellsOfEdge(run[run.length - 1]!);
        tx = (a.b.x + b.b.x + (a.side === 'n' ? 1 : 0)) / 2;
        ty = (a.b.y + b.b.y + (a.side === 'w' ? 1 : 0)) / 2;
      } else if (link.kind === 'trap') {
        const cell = level.traps.find((t) => t.id === link.ref)?.cells[0];
        if (cell) [tx, ty] = [cell.x + 0.5, cell.y + 0.5];
      } else {
        const stair = level.stairs.find((s) => s.id === link.ref);
        if (stair) [tx, ty] = [stair.x + 0.5, stair.y + 0.5];
      }
      if (tx === null) continue;
      ctx.beginPath();
      ctx.moveTo(sx(marker.x + 0.5), sy(marker.y + 0.5));
      ctx.lineTo(sx(tx), sy(ty));
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx(tx), sy(ty), Math.max(3, z * 0.12), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Was auf Feldern liegt.
  for (const trap of level.traps) {
    const first = trap.cells[0];
    if (first && z >= 10) drawTrapSign(ctx, sx(first.x), sy(first.y), z, palette);
  }
  for (const stair of level.stairs) {
    if (!visible(stair.x, stair.y)) continue;
    drawStair(
      ctx,
      sx(stair.x),
      sy(stair.y),
      z,
      stair.kind,
      stair.dir,
      !stair.to,
      stair.secret,
      palette,
    );
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const marker of level.markers) {
    if (!visible(marker.x, marker.y)) continue;
    const cx = sx(marker.x) + z / 2;
    const cy = sy(marker.y) + z / 2;
    const r = z * 0.3;
    // Ein Ding kann mehrere Felder groß und gedreht sein: ein langer Tisch, ein Bett quer.
    const out =
      marker.kind === 'fire' || marker.kind === 'torch' ? scene.play?.unlit.has(marker.id) : false;
    ctx.save();
    ctx.translate(sx(marker.x) + (marker.w * z) / 2, sy(marker.y) + (marker.h * z) / 2);
    ctx.rotate((marker.rot * Math.PI) / 2);
    const turned = marker.rot % 2 === 1;
    ctx.scale(turned ? marker.h : marker.w, turned ? marker.w : marker.h);
    if (out) ctx.globalAlpha = 0.35;
    drawThing(ctx, marker.kind, -z / 2, -z / 2, z, palette);
    ctx.restore();
    if (scene.play?.switched.has(marker.id)) {
      // Ein Schalter, der an ist: ein kleines Messingzeichen.
      ctx.fillStyle = palette.gold;
      ctx.beginPath();
      ctx.arc(
        sx(marker.x) + z * 0.84,
        sy(marker.y) + z * 0.16,
        Math.max(2.5, z * 0.09),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    const label = marker.label.trim();
    if (label && z >= 18) {
      ctx.font = `600 ${Math.max(11, Math.min(15, z * 0.42))}px ${palette.font}`;
      haloText(ctx, label, cx + r + 3, cy, palette);
    }
  }

  // Namen der Räume.
  if (z >= 15) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.max(12, Math.min(19, z * 0.52))}px ${palette.font}`;
    for (const label of parsed.labels) haloText(ctx, label.name, sx(label.x), sy(label.y), palette);
  }

  // Am Tisch: der Schleier über allem, was die Gruppe gerade nicht sieht.
  const play = scene.play;
  if (play) {
    ctx.fillStyle = palette.rock;
    const pad = play.playerView ? wallWidth * 0.6 : 0;
    for (const cell of parsed.cells) {
      if (!visible(cell.x, cell.y)) continue;
      const key = keyOf(cell);
      if (play.visible.has(key)) continue;
      const known = play.seen.has(key);
      ctx.globalAlpha = known ? 0.42 : play.playerView ? 1 : 0.7;
      const grow = known ? 0 : pad;
      // Höhlenboden reicht über sein Feld hinaus – zum Fels hin deckt der Schleier ihn mit.
      const out = (dx: number, dy: number) =>
        parsed.caveKeys.has(key) &&
        level.tiles[keyOf({ x: cell.x + dx, y: cell.y + dy })] === undefined
          ? z * 0.3
          : grow;
      const [l, t, r, b] = [out(-1, 0), out(0, -1), out(1, 0), out(0, 1)];
      ctx.fillRect(sx(cell.x) - l, sy(cell.y) - t, z + l + r, z + t + b);
    }
    ctx.globalAlpha = 1;
    // Der Weg unter dem Zeiger.
    if (play.route && play.route.cells.length > 1) {
      ctx.strokeStyle = palette.gold;
      ctx.lineWidth = Math.max(2, z * 0.08);
      ctx.setLineDash([z * 0.2, z * 0.16]);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      play.route.cells.forEach((cell, index) => {
        if (index === 0) ctx.moveTo(sx(cell.x + 0.5), sy(cell.y + 0.5));
        else ctx.lineTo(sx(cell.x + 0.5), sy(cell.y + 0.5));
      });
      ctx.stroke();
      ctx.setLineDash([]);
      const end = play.route.cells[play.route.cells.length - 1]!;
      ctx.font = `600 ${Math.max(12, Math.min(16, z * 0.45))}px ${palette.font}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      haloText(ctx, `${play.route.feet} Fuß`, sx(end.x + 0.5), sy(end.y) - 2, palette);
    }
    // Die Figuren.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const token of play.tokens) {
      if (!visible(token.x, token.y)) continue;
      const cx = sx(token.x + 0.5);
      const cy = sy(token.y + 0.5);
      const r = z * 0.38;
      if (token.light) {
        ctx.fillStyle = palette.ember;
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // Wer besiegt ist, liegt blass da.
      const down = token.down;
      ctx.globalAlpha = down ? 0.35 : 1;
      ctx.fillStyle = token.kind === 'hero' ? palette.wall : palette.blood;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = token.selected || token.turn ? palette.gold : palette.floor;
      ctx.lineWidth = token.turn ? Math.max(3, z * 0.12) : Math.max(1.5, z * 0.07);
      ctx.stroke();
      if (z >= 14) {
        ctx.fillStyle = palette.floor;
        ctx.font = `700 ${Math.max(10, z * 0.4)}px ${palette.font}`;
        // Zwei Buchstaben, wenn Platz ist – so lassen sich Namen mit gleichem Anfang unterscheiden.
        const name = token.name.trim() || '?';
        const short =
          z >= 24 ? name.slice(0, 1).toUpperCase() + name.slice(1, 2) : name[0]!.toUpperCase();
        ctx.font = `700 ${Math.max(10, z * (short.length > 1 ? 0.32 : 0.4))}px ${palette.font}`;
        ctx.fillText(short, cx, cy + 1);
      }
      ctx.globalAlpha = 1;
      if (token.alert && !down) {
        // Hat die Gruppe bemerkt: ein Ausrufezeichen an der Figur.
        ctx.fillStyle = palette.gold;
        ctx.font = `700 ${Math.max(11, z * 0.5)}px ${palette.font}`;
        ctx.fillText('!', cx + r, cy - r);
      }
    }
  }

  // Auswahl.
  ctx.strokeStyle = palette.gold;
  ctx.lineWidth = 2;
  const pick = scene.selection;
  if (pick?.type === 'edge') {
    ctx.lineWidth = wallWidth + 3;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    for (const key of edgeRun(level, pick.key)) {
      const { b, side } = cellsOfEdge(key);
      ctx.moveTo(sx(b.x), sy(b.y));
      ctx.lineTo(sx(side === 'n' ? b.x + 1 : b.x), sy(side === 'n' ? b.y : b.y + 1));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2;
  } else if (pick?.type === 'stair' || pick?.type === 'marker') {
    const thing =
      pick.type === 'stair'
        ? level.stairs.find((s) => s.id === pick.id)
        : level.markers.find((m) => m.id === pick.id);
    if (thing) ctx.strokeRect(sx(thing.x) + 1, sy(thing.y) + 1, z - 2, z - 2);
  } else if (pick?.type === 'trap') {
    const trap = level.traps.find((t) => t.id === pick.id);
    for (const cell of trap?.cells ?? [])
      ctx.strokeRect(sx(cell.x) + 1, sy(cell.y) + 1, z - 2, z - 2);
  }

  // Felder, die gerade gewählt werden.
  if (scene.pickCells) {
    ctx.setLineDash([4, 3]);
    for (const cell of scene.pickCells)
      ctx.strokeRect(sx(cell.x) + 2, sy(cell.y) + 2, z - 4, z - 4);
    ctx.setLineDash([]);
  }

  // Der aufgezogene Ausschnitt.
  if (scene.region && scene.region.length === 2) {
    const [a, b] = scene.region as [DungeonCell, DungeonCell];
    ctx.strokeStyle = palette.gold;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(sx(a.x) + 1, sy(a.y) + 1, (b.x - a.x + 1) * z - 2, (b.y - a.y + 1) * z - 2);
    ctx.setLineDash([]);
  }

  // Unter dem Zeiger.
  if (scene.hoverCells.length > 0) {
    ctx.strokeStyle = palette.gold;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.9;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cell of scene.hoverCells) {
      minX = Math.min(minX, cell.x);
      minY = Math.min(minY, cell.y);
      maxX = Math.max(maxX, cell.x);
      maxY = Math.max(maxY, cell.y);
    }
    if (scene.hoverRound) {
      ellipse(scene.hoverRound);
      ctx.stroke();
      ctx.setLineDash([3, 3]);
    }
    ctx.strokeRect(sx(minX) + 0.5, sy(minY) + 0.5, (maxX - minX + 1) * z, (maxY - minY + 1) * z);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  if (scene.hoverEdge) {
    const { b, side } = cellsOfEdge(scene.hoverEdge);
    ctx.strokeStyle = palette.gold;
    ctx.lineWidth = Math.max(3, wallWidth);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(sx(b.x), sy(b.y));
    ctx.lineTo(sx(side === 'n' ? b.x + 1 : b.x), sy(side === 'n' ? b.y : b.y + 1));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

/** Kanten, die als durchgehende Wand gezeichnet werden. */
const SOLID_EDGES: ReadonlySet<string> = new Set(['rock', 'wall', 'secret', 'window', 'false']);

/** Die Grundfarbe einer Geländeart. */
function tileColor(tile: DungeonTile, palette: Palette): string {
  switch (tile) {
    case 'water':
      return palette.water;
    case 'deep':
      return palette.waterLine;
    case 'ice':
      return palette.snow;
    case 'lava':
      return palette.lava;
    case 'acid':
      return palette.moss;
    case 'dark':
      return palette.glow;
    case 'chasm':
    case 'air':
    case 'bridge':
      return palette.chasm;
    default:
      return palette.floor;
  }
}

/** Ein Feld mit dem, was es ist. */
function drawTile(
  ctx: CanvasRenderingContext2D,
  level: DungeonLevel,
  below: DungeonLevel | null,
  cell: { x: number; y: number; tile: DungeonTile },
  x: number,
  y: number,
  z: number,
  palette: Palette,
): void {
  ctx.fillStyle = tileColor(cell.tile, palette);
  ctx.fillRect(x, y, z + 0.5, z + 0.5);
  if (cell.tile === 'mud' || cell.tile === 'fog') {
    // Über dem Boden: Schlamm dunkelt, Dunst hellt auf.
    ctx.fillStyle = cell.tile === 'mud' ? palette.mud : palette.snow;
    ctx.globalAlpha = cell.tile === 'mud' ? 0.45 : 0.62;
    ctx.fillRect(x, y, z + 0.5, z + 0.5);
    ctx.globalAlpha = 1;
  } else if (z >= 12 && (cell.tile === 'thorns' || cell.tile === 'web' || cell.tile === 'ice')) {
    ctx.strokeStyle = cell.tile === 'thorns' ? palette.wall : palette.inkSoft;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (cell.tile === 'web') {
      // Spinnweben: Speichen und zwei Ringe.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI;
        ctx.moveTo(x + z / 2 - Math.cos(a) * z * 0.45, y + z / 2 - Math.sin(a) * z * 0.45);
        ctx.lineTo(x + z / 2 + Math.cos(a) * z * 0.45, y + z / 2 + Math.sin(a) * z * 0.45);
      }
      for (const r of [0.2, 0.36]) {
        ctx.moveTo(x + z / 2 + z * r, y + z / 2);
        ctx.arc(x + z / 2, y + z / 2, z * r, 0, Math.PI * 2);
      }
    } else if (cell.tile === 'thorns') {
      for (const [fx, fy] of RUBBLE) {
        ctx.moveTo(x + (fx - 0.09) * z, y + (fy - 0.09) * z);
        ctx.lineTo(x + (fx + 0.09) * z, y + (fy + 0.09) * z);
        ctx.moveTo(x + (fx + 0.09) * z, y + (fy - 0.09) * z);
        ctx.lineTo(x + (fx - 0.09) * z, y + (fy + 0.09) * z);
      }
    } else {
      // Eis: zwei feine Glanzstriche.
      ctx.moveTo(x + z * 0.2, y + z * 0.6);
      ctx.lineTo(x + z * 0.5, y + z * 0.3);
      ctx.moveTo(x + z * 0.5, y + z * 0.75);
      ctx.lineTo(x + z * 0.8, y + z * 0.45);
    }
    ctx.stroke();
  } else if (z >= 12 && (cell.tile === 'lava' || cell.tile === 'acid' || cell.tile === 'deep')) {
    // Lava, Säure, tiefes Wasser: Blasen bzw. eine dritte Welle.
    ctx.strokeStyle =
      cell.tile === 'lava' ? palette.ember : cell.tile === 'acid' ? palette.floor : palette.floor;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [fx, fy, r] of RUBBLE.slice(0, 3)) {
      ctx.moveTo(x + fx * z + r * z * 1.6, y + fy * z);
      ctx.arc(x + fx * z, y + fy * z, r * z * 1.6, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (cell.tile === 'secret') {
    // Geheimgang: derselbe Boden, schräg gestreift.
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, z, z);
    ctx.clip();
    ctx.strokeStyle = palette.inkSoft;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = Math.max(1, z * 0.07);
    ctx.beginPath();
    for (let i = -1; i <= 2; i++) {
      ctx.moveTo(x + i * z * 0.5, y + z);
      ctx.lineTo(x + i * z * 0.5 + z, y);
    }
    ctx.stroke();
    ctx.restore();
  } else if (cell.tile === 'rubble' && z >= 10) {
    ctx.fillStyle = palette.inkSoft;
    for (const [fx, fy, r] of RUBBLE) {
      ctx.beginPath();
      ctx.arc(x + fx * z, y + fy * z, r * z, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (cell.tile === 'water' && z >= 12) {
    ctx.strokeStyle = palette.waterLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const fy of [0.35, 0.68]) {
      ctx.moveTo(x + z * 0.18, y + z * fy);
      ctx.quadraticCurveTo(x + z * 0.34, y + z * (fy - 0.1), x + z * 0.5, y + z * fy);
      ctx.quadraticCurveTo(x + z * 0.66, y + z * (fy + 0.1), x + z * 0.82, y + z * fy);
    }
    ctx.stroke();
  } else if (cell.tile === 'chasm') {
    ctx.strokeStyle = palette.rubble;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + z * 0.14, y + z * 0.14, z * 0.72, z * 0.72);
  } else if (cell.tile === 'air') {
    // Luftraum: man sieht hinab auf die Ebene darunter.
    const under = below?.tiles[keyOf(cell)];
    if (under !== undefined && under !== 'chasm' && under !== 'air') {
      ctx.fillStyle = under === 'water' ? palette.water : palette.floor;
      ctx.globalAlpha = 0.42;
      ctx.fillRect(x, y, z + 0.5, z + 0.5);
      ctx.globalAlpha = 1;
    }
  } else if (cell.tile === 'bridge') {
    // Brücke: Planken quer zur Richtung, in der sie Boden verbindet.
    const solid = (dx: number, dy: number) => {
      const t = level.tiles[keyOf({ x: cell.x + dx, y: cell.y + dy })];
      return t !== undefined && t !== 'chasm' && t !== 'air' && t !== 'water';
    };
    const across = solid(-1, 0) || solid(1, 0) || !(solid(0, -1) || solid(0, 1));
    ctx.fillStyle = palette.grid;
    if (across) ctx.fillRect(x, y + z * 0.14, z + 0.5, z * 0.72);
    else ctx.fillRect(x + z * 0.14, y, z * 0.72, z + 0.5);
    ctx.strokeStyle = palette.wall;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      if (across) {
        ctx.moveTo(x + (i / 4) * z, y + z * 0.14);
        ctx.lineTo(x + (i / 4) * z, y + z * 0.86);
      } else {
        ctx.moveTo(x + z * 0.14, y + (i / 4) * z);
        ctx.lineTo(x + z * 0.86, y + (i / 4) * z);
      }
    }
    if (across) {
      ctx.moveTo(x, y + z * 0.14);
      ctx.lineTo(x + z, y + z * 0.14);
      ctx.moveTo(x, y + z * 0.86);
      ctx.lineTo(x + z, y + z * 0.86);
    } else {
      ctx.moveTo(x + z * 0.14, y);
      ctx.lineTo(x + z * 0.14, y + z);
      ctx.moveTo(x + z * 0.86, y);
      ctx.lineTo(x + z * 0.86, y + z);
    }
    ctx.stroke();
  }
}

/** Ein Stück Einrichtung als Zeichen auf seinem Feld. */
function drawThing(
  ctx: CanvasRenderingContext2D,
  kind: DungeonMarker['kind'],
  x: number,
  y: number,
  z: number,
  palette: Palette,
): void {
  const cx = x + z / 2;
  const cy = y + z / 2;
  const u = z / 100;
  const box = (w: number, h: number) => [cx - (w * u) / 2, cy - (h * u) / 2, w * u, h * u] as const;
  ctx.strokeStyle = palette.wall;
  ctx.fillStyle = palette.wall;
  ctx.lineWidth = Math.max(1.2, z * 0.055);
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  switch (kind) {
    case 'note': {
      const r = z * 0.24;
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'pillar':
      ctx.arc(cx, cy, 30 * u, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'statue':
      ctx.arc(cx, cy, 30 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const r = (i % 2 === 0 ? 22 : 9) * u;
        const px = cx + Math.cos(angle) * r;
        const py = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    case 'altar':
      ctx.fillStyle = palette.floor;
      ctx.fillRect(...box(72, 44));
      ctx.strokeRect(...box(72, 44));
      ctx.beginPath();
      ctx.moveTo(cx, cy - 14 * u);
      ctx.lineTo(cx, cy + 14 * u);
      ctx.moveTo(cx - 9 * u, cy - 5 * u);
      ctx.lineTo(cx + 9 * u, cy - 5 * u);
      ctx.stroke();
      break;
    case 'chest':
      ctx.fillStyle = palette.grid;
      ctx.fillRect(...box(64, 44));
      ctx.strokeRect(...box(64, 44));
      ctx.beginPath();
      ctx.moveTo(cx - 32 * u, cy - 6 * u);
      ctx.lineTo(cx + 32 * u, cy - 6 * u);
      ctx.stroke();
      ctx.fillStyle = palette.wall;
      ctx.fillRect(cx - 5 * u, cy - 9 * u, 10 * u, 12 * u);
      break;
    case 'lever':
      ctx.arc(cx, cy + 14 * u, 13 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.lineWidth = Math.max(2, z * 0.09);
      ctx.moveTo(cx, cy + 14 * u);
      ctx.lineTo(cx + 18 * u, cy - 26 * u);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + 18 * u, cy - 26 * u, 7 * u, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'well':
      ctx.fillStyle = palette.water;
      ctx.arc(cx, cy, 30 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(2.5, z * 0.11);
      ctx.stroke();
      break;
    case 'fire':
      ctx.fillStyle = palette.ember;
      ctx.arc(cx, cy, 16 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = palette.ember;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        ctx.moveTo(cx + Math.cos(angle) * 23 * u, cy + Math.sin(angle) * 23 * u);
        ctx.lineTo(cx + Math.cos(angle) * 34 * u, cy + Math.sin(angle) * 34 * u);
      }
      ctx.stroke();
      break;
    case 'table':
      ctx.fillStyle = palette.grid;
      ctx.fillRect(...box(70, 48));
      ctx.strokeRect(...box(70, 48));
      break;
    case 'bed':
      ctx.fillStyle = palette.floor;
      ctx.fillRect(...box(50, 76));
      ctx.strokeRect(...box(50, 76));
      ctx.fillStyle = palette.grid;
      ctx.fillRect(cx - 18 * u, cy - 32 * u, 36 * u, 16 * u);
      ctx.strokeRect(cx - 18 * u, cy - 32 * u, 36 * u, 16 * u);
      break;
    case 'coffin':
      ctx.fillStyle = palette.grid;
      ctx.moveTo(cx - 12 * u, cy - 38 * u);
      ctx.lineTo(cx + 12 * u, cy - 38 * u);
      ctx.lineTo(cx + 22 * u, cy - 16 * u);
      ctx.lineTo(cx + 13 * u, cy + 38 * u);
      ctx.lineTo(cx - 13 * u, cy + 38 * u);
      ctx.lineTo(cx - 22 * u, cy - 16 * u);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    case 'crate':
      ctx.fillStyle = palette.grid;
      ctx.fillRect(...box(54, 54));
      ctx.strokeRect(...box(54, 54));
      ctx.beginPath();
      ctx.moveTo(cx - 27 * u, cy - 27 * u);
      ctx.lineTo(cx + 27 * u, cy + 27 * u);
      ctx.moveTo(cx + 27 * u, cy - 27 * u);
      ctx.lineTo(cx - 27 * u, cy + 27 * u);
      ctx.stroke();
      break;
    case 'throne':
      ctx.fillStyle = palette.grid;
      ctx.fillRect(...box(52, 52));
      ctx.strokeRect(...box(52, 52));
      ctx.fillStyle = palette.wall;
      ctx.fillRect(cx - 30 * u, cy - 34 * u, 60 * u, 14 * u);
      break;
    case 'torch':
      // Fackelhalter: ein Stiel an der Wand und eine Flamme.
      ctx.moveTo(cx, cy + 30 * u);
      ctx.lineTo(cx, cy - 4 * u);
      ctx.stroke();
      ctx.fillStyle = palette.ember;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 34 * u);
      ctx.quadraticCurveTo(cx + 18 * u, cy - 8 * u, cx, cy);
      ctx.quadraticCurveTo(cx - 18 * u, cy - 8 * u, cx, cy - 34 * u);
      ctx.fill();
      break;
    case 'stalagmite':
      ctx.moveTo(cx, cy - 34 * u);
      ctx.lineTo(cx + 24 * u, cy + 26 * u);
      ctx.lineTo(cx - 24 * u, cy + 26 * u);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = palette.floor;
      ctx.beginPath();
      ctx.moveTo(cx - 4 * u, cy - 16 * u);
      ctx.lineTo(cx + 6 * u, cy + 16 * u);
      ctx.lineTo(cx - 10 * u, cy + 16 * u);
      ctx.closePath();
      ctx.fill();
      break;
  }
}

/** Steinchen eines Geröllfelds: Lage und Größe in Anteilen des Feldes. */
const RUBBLE: readonly (readonly [number, number, number])[] = [
  [0.25, 0.3, 0.06],
  [0.62, 0.22, 0.045],
  [0.75, 0.6, 0.07],
  [0.38, 0.7, 0.05],
  [0.5, 0.48, 0.035],
];

function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  palette: Palette,
): void {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = palette.floor;
  ctx.lineWidth = 4;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = palette.wall;
  ctx.fillText(text, x, y);
}

/** Tür, Durchgang, Gitter, Geheimtür auf einer Kante. */
function drawOpening(
  ctx: CanvasRenderingContext2D,
  seg: EdgeSegment,
  sx: (x: number) => number,
  sy: (y: number) => number,
  z: number,
  wallWidth: number,
  palette: Palette,
): void {
  const x1 = sx(seg.x1);
  const y1 = sy(seg.y1);
  const x2 = sx(seg.x2);
  const y2 = sy(seg.y2);
  const horizontal = seg.y1 === seg.y2;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const at = (t: number): [number, number] => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
  // Eine Öffnung kann mehrere Felder breit sein (Doppeltür): Maße zählen vom Ende, nicht in Anteilen.
  const length = Math.hypot(x2 - x1, y2 - y1);
  const f = (cells: number) => (cells * z) / length;

  if (seg.kind === 'window') {
    // Die Wand steht; darin ein schmales, helles Fenster.
    const thick = Math.max(3, z * 0.12);
    const long = length - z * 0.5;
    const w = horizontal ? long : thick;
    const h = horizontal ? thick : long;
    ctx.fillStyle = palette.water;
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.strokeStyle = palette.wall;
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    return;
  }
  if (seg.kind === 'false') {
    // Scheintür: sieht aus wie eine Tür, die Wand dahinter ist ganz.
    const long = length - z * 0.4;
    const thick = Math.max(4, z * 0.24);
    const w = horizontal ? long : thick;
    const h = horizontal ? thick : long;
    ctx.fillStyle = palette.floor;
    ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
    ctx.strokeStyle = palette.blood;
    ctx.lineWidth = Math.max(1.5, z * 0.06);
    ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy - h / 2);
    ctx.lineTo(cx + w / 2, cy + h / 2);
    ctx.stroke();
    return;
  }
  if (seg.kind === 'secret') {
    // Die Wand steht schon; darauf das Zeichen der Geheimtür.
    ctx.font = `700 ${Math.max(11, z * 0.5)}px ${palette.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = palette.floor;
    ctx.lineWidth = 4;
    ctx.strokeText('S', cx, cy);
    ctx.fillStyle = palette.blood;
    ctx.fillText('S', cx, cy);
    return;
  }

  // Die Laibung: zwei Wandstücke links und rechts der Öffnung.
  ctx.strokeStyle = palette.wall;
  ctx.lineWidth = wallWidth;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(...at(f(0.18)));
  ctx.moveTo(...at(1 - f(0.18)));
  ctx.lineTo(x2, y2);
  ctx.stroke();

  if (seg.kind === 'door') {
    const long = length - z * 0.4;
    const thick = Math.max(4, z * 0.24);
    const w = horizontal ? long : thick;
    const h = horizontal ? thick : long;
    const opened = !!seg.edge?.opened;
    ctx.lineWidth = Math.max(1.5, z * 0.06);
    ctx.strokeStyle = palette.wall;
    if (opened) {
      // Offen: der Türflügel steht quer zur Kante.
      ctx.beginPath();
      // Eine Doppeltür hat zwei Flügel, an jedem Ende einen.
      for (const t of length > z * 1.5 ? [f(0.2), 1 - f(0.2)] : [f(0.2)]) {
        const [px, py] = at(t);
        ctx.moveTo(px, py);
        if (horizontal) ctx.lineTo(px, py + z * 0.55);
        else ctx.lineTo(px + z * 0.55, py);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = palette.floor;
      ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
      if (length > z * 1.5) {
        // Doppeltür: zwei Flügel, die sich in der Mitte treffen.
        ctx.beginPath();
        if (horizontal) {
          ctx.moveTo(cx, cy - h / 2);
          ctx.lineTo(cx, cy + h / 2);
        } else {
          ctx.moveTo(cx - w / 2, cy);
          ctx.lineTo(cx + w / 2, cy);
        }
        ctx.stroke();
      }
      if (seg.edge?.locked) {
        ctx.fillStyle = palette.wall;
        const s = Math.max(3, thick * 0.5);
        ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
      }
    }
  } else if (seg.kind === 'squeeze') {
    // Engstelle: Die Wand rückt von beiden Seiten heran, ein schmaler Spalt bleibt.
    ctx.strokeStyle = palette.wall;
    ctx.lineWidth = wallWidth;
    ctx.beginPath();
    ctx.moveTo(...at(f(0.18)));
    ctx.lineTo(...at(0.5 - f(0.12)));
    ctx.moveTo(...at(0.5 + f(0.12)));
    ctx.lineTo(...at(1 - f(0.18)));
    ctx.stroke();
  } else if (seg.kind === 'curtain') {
    // Vorhang: eine Wellenlinie in der Öffnung.
    ctx.strokeStyle = palette.blood;
    ctx.lineWidth = Math.max(1.5, z * 0.07);
    ctx.beginPath();
    const waves = Math.max(2, Math.round((4 * length) / z));
    for (let i = 0; i <= waves * 4; i++) {
      const t = f(0.2) + ((1 - 2 * f(0.2)) * i) / (waves * 4);
      const off = Math.sin((i / 4) * Math.PI * 2) * z * 0.07;
      const [px, py] = at(t);
      const qx = horizontal ? px : px + off;
      const qy = horizontal ? py + off : py;
      if (i === 0) ctx.moveTo(qx, qy);
      else ctx.lineTo(qx, qy);
    }
    ctx.stroke();
  } else if (seg.kind === 'gate') {
    ctx.fillStyle = palette.wall;
    const r = Math.max(1.5, z * 0.055);
    const bars = Math.max(2, Math.round((length - z * 0.6) / (z * 0.133)) + 1);
    for (let i = 0; i < bars; i++) {
      const t = f(0.3) + ((1 - 2 * f(0.3)) * i) / (bars - 1);
      const [px, py] = at(t);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (seg.edge?.opened) {
      ctx.strokeStyle = palette.floor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(...at(f(0.3)));
      ctx.lineTo(...at(1 - f(0.3)));
      ctx.stroke();
    }
  }
}

/** Zeichen an einer Tür: ein Pfeil für die Einbahntür, ein Kreuz für eine, die klemmt. */
function drawEdgeMarks(
  ctx: CanvasRenderingContext2D,
  seg: EdgeSegment,
  sx: (x: number) => number,
  sy: (y: number) => number,
  z: number,
  palette: Palette,
): void {
  const edge = seg.edge;
  if (!edge || (edge.oneWay === 'none' && !edge.stuck)) return;
  const horizontal = seg.y1 === seg.y2;
  const cx = (sx(seg.x1) + sx(seg.x2)) / 2;
  const cy = (sy(seg.y1) + sy(seg.y2)) / 2;
  ctx.strokeStyle = palette.blood;
  ctx.fillStyle = palette.blood;
  ctx.lineWidth = Math.max(1.5, z * 0.06);
  if (edge.oneWay !== 'none') {
    // Der Pfeil zeigt, wohin man hindurchkommt.
    const dir = edge.oneWay === 'ab' ? 1 : -1;
    const tipX = horizontal ? cx : cx + dir * z * 0.34;
    const tipY = horizontal ? cy + dir * z * 0.34 : cy;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    if (horizontal) {
      ctx.lineTo(cx - z * 0.12, cy + dir * z * 0.16);
      ctx.lineTo(cx + z * 0.12, cy + dir * z * 0.16);
    } else {
      ctx.lineTo(cx + dir * z * 0.16, cy - z * 0.12);
      ctx.lineTo(cx + dir * z * 0.16, cy + z * 0.12);
    }
    ctx.closePath();
    ctx.fill();
  }
  if (edge.stuck) {
    const r = z * 0.1;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r);
    ctx.lineTo(cx + r, cy + r);
    ctx.moveTo(cx + r, cy - r);
    ctx.lineTo(cx - r, cy + r);
    ctx.stroke();
  }
}

function drawTrapSign(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  z: number,
  palette: Palette,
): void {
  const cx = x + z / 2;
  const top = y + z * 0.2;
  const bottom = y + z * 0.8;
  ctx.fillStyle = palette.blood;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(x + z * 0.84, bottom);
  ctx.lineTo(x + z * 0.16, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = palette.floor;
  ctx.fillRect(cx - z * 0.035, y + z * 0.4, z * 0.07, z * 0.2);
  ctx.fillRect(cx - z * 0.035, y + z * 0.66, z * 0.07, z * 0.07);
}

function drawStair(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  z: number,
  kind: string,
  dir: 'up' | 'down',
  loose: boolean,
  secret: boolean,
  palette: Palette,
): void {
  const cx = x + z / 2;
  const cy = y + z / 2;
  ctx.strokeStyle = palette.wall;
  ctx.fillStyle = palette.wall;
  ctx.lineWidth = Math.max(1.2, z * 0.06);
  if (secret) ctx.setLineDash([3, 2]);
  ctx.beginPath();
  if (kind === 'stairs') {
    // Stufen, die schmaler werden, wo es hinabgeht.
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const half = (dir === 'down' ? 0.4 - t * 0.26 : 0.14 + t * 0.26) * z;
      const py = y + z * (0.16 + t * 0.68);
      ctx.moveTo(cx - half, py);
      ctx.lineTo(cx + half, py);
    }
    ctx.stroke();
  } else if (kind === 'spiral') {
    ctx.arc(cx, cy, z * 0.38, 0, Math.PI * 2);
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      ctx.moveTo(cx + Math.cos(angle) * z * 0.1, cy + Math.sin(angle) * z * 0.1);
      ctx.lineTo(cx + Math.cos(angle) * z * 0.38, cy + Math.sin(angle) * z * 0.38);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, z * 0.1, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'ladder') {
    ctx.moveTo(x + z * 0.32, y + z * 0.14);
    ctx.lineTo(x + z * 0.32, y + z * 0.86);
    ctx.moveTo(x + z * 0.68, y + z * 0.14);
    ctx.lineTo(x + z * 0.68, y + z * 0.86);
    for (const t of [0.28, 0.5, 0.72]) {
      ctx.moveTo(x + z * 0.32, y + z * t);
      ctx.lineTo(x + z * 0.68, y + z * t);
    }
    ctx.stroke();
  } else if (kind === 'shaft') {
    ctx.arc(cx, cy, z * 0.34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, z * 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'trapdoor') {
    ctx.rect(x + z * 0.18, y + z * 0.18, z * 0.64, z * 0.64);
    ctx.moveTo(x + z * 0.18, y + z * 0.18);
    ctx.lineTo(x + z * 0.82, y + z * 0.82);
    ctx.moveTo(x + z * 0.82, y + z * 0.18);
    ctx.lineTo(x + z * 0.18, y + z * 0.82);
    ctx.stroke();
  } else {
    ctx.strokeStyle = palette.arcane;
    ctx.arc(cx, cy, z * 0.36, 0, Math.PI * 2);
    ctx.moveTo(cx + z * 0.22, cy);
    ctx.arc(cx, cy, z * 0.22, 0, Math.PI * 2);
    ctx.moveTo(cx + z * 0.08, cy);
    ctx.arc(cx, cy, z * 0.08, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (loose && z >= 12) {
    // Noch ohne Ziel: ein roter Punkt in der Ecke.
    ctx.fillStyle = palette.blood;
    ctx.beginPath();
    ctx.arc(x + z * 0.84, y + z * 0.16, Math.max(2.5, z * 0.09), 0, Math.PI * 2);
    ctx.fill();
  }
}
