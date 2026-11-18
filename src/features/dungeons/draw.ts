/**
 * Zeichnet eine Ebene eines Dungeons auf eine Leinwand: heller Boden, kräftige Wände, Schraffur im
 * Fels ringsum. Gezeichnet wird nie das Gemalte selbst, sondern was `domain/dungeon.ts` daraus
 * liest (`edgeSegments`) – so sieht eine Wand, die von selbst dasteht, aus wie jede andere.
 */
import { rngOf, seedOf } from '../../domain/random';
import { textureOf, type TextureName } from './textures';
import { caveLoops, outward, spotNoise, type CaveLoop } from './caveShape';
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
  lake: string;
  deepLake: string;
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
    lake: get('--terrain-lake'),
    deepLake: get('--terrain-deep-lake'),
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
  /** Gelände als zusammenhängende Flächen mit eigenem Rand – Wasser, Lava, Schlamm … */
  patches: Patch[];
  /** Felder, die unter einer deckenden Fläche liegen (Wasser, Lava, Säure, Abgrund). */
  liquidKeys: Set<string>;
  /** Der Umriss der Höhlen. */
  caveLoops: CaveLoop[];
  /** Je Punkt des Umrisses die Richtung vom Boden weg. */
  caveNormals: [number, number][][];
  /** Brocken am Fuß der Höhlenwand. */
  caveStones: { x: number; y: number; r: number; turn: number }[];
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

type PatchKind = 'mud' | 'ice' | 'web' | 'thorns' | 'water' | 'deep' | 'acid' | 'lava' | 'chasm';
/** In dieser Reihenfolge liegen die Flächen übereinander. */
const PATCH_ORDER: readonly PatchKind[] = [
  'mud',
  'ice',
  'web',
  'thorns',
  'water',
  'deep',
  'acid',
  'lava',
  'chasm',
];
interface Patch {
  kind: PatchKind;
  loops: CaveLoop[];
  cells: TileCell[];
  /** Streifen zum Fels hin: In Höhlen reicht der Boden über sein Feld hinaus. */
  strips: [number, number, number, number][];
}

/** Zu welchen Flächen ein Feld gehört. Tiefes Wasser liegt in Wasser; eine Brücke über dem, was sie überspannt. */
function patchKinds(level: DungeonLevel, cell: TileCell): PatchKind[] {
  switch (cell.tile) {
    case 'water':
      return ['water'];
    case 'deep':
      return ['water', 'deep'];
    case 'mud':
    case 'ice':
    case 'web':
    case 'thorns':
    case 'acid':
    case 'lava':
    case 'chasm':
      return [cell.tile];
    case 'bridge': {
      const near = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].map(([dx, dy]) => level.tiles[`${cell.x + dx!},${cell.y + dy!}`]);
      if (near.includes('water') || near.includes('deep')) return ['water'];
      if (near.includes('lava')) return ['lava'];
      if (near.includes('acid')) return ['acid'];
      return ['chasm'];
    }
    default:
      return [];
  }
}

function parsePatches(level: DungeonLevel, cells: TileCell[], caveKeys: Set<string>): Patch[] {
  const members = new Map<PatchKind, TileCell[]>();
  for (const cell of cells)
    for (const kind of patchKinds(level, cell)) {
      const list = members.get(kind) ?? [];
      list.push(cell);
      members.set(kind, list);
    }
  const rock = (x: number, y: number) => level.tiles[`${x},${y}`] === undefined;
  return PATCH_ORDER.flatMap((kind) => {
    const own = members.get(kind);
    if (!own) return [];
    const keys = new Set(own.map(keyOf));
    // Gerade bleibt der Rand am Fels und an der Wand zu einem anderen Raum; sonst ist er ein Ufer.
    const loops = caveLoops(
      keys,
      (nx, ny, x, y) =>
        rock(nx, ny) ||
        (level.roomOf[`${nx},${ny}`] ?? null) !== (level.roomOf[`${x},${y}`] ?? null),
    );
    const strips: Patch['strips'] = [];
    const pad = 0.8;
    for (const cell of own) {
      if (!caveKeys.has(keyOf(cell))) continue;
      // Nur zum Fels am Rand der Fläche hin: Grenzt der Fels auch an anderen Boden (ein Felsen
      // mitten in der Höhle, eine Ecke), bleibt dort ein Streifen Boden stehen.
      const outer = (x: number, y: number) =>
        rock(x, y) &&
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].every(([dx, dy]) => rock(x + dx!, y + dy!) || keys.has(`${x + dx!},${y + dy!}`));
      const n = outer(cell.x, cell.y - 1);
      const s = outer(cell.x, cell.y + 1);
      const w = outer(cell.x - 1, cell.y);
      const e = outer(cell.x + 1, cell.y);
      if (n) strips.push([cell.x, cell.y - pad, 1, pad]);
      if (s) strips.push([cell.x, cell.y + 1, 1, pad]);
      if (w) strips.push([cell.x - pad, cell.y, pad, 1]);
      if (e) strips.push([cell.x + 1, cell.y, pad, 1]);
      if (n && w) strips.push([cell.x - pad, cell.y - pad, pad, pad]);
      if (n && e) strips.push([cell.x + 1, cell.y - pad, pad, pad]);
      if (s && w) strips.push([cell.x - pad, cell.y + 1, pad, pad]);
      if (s && e) strips.push([cell.x + 1, cell.y + 1, pad, pad]);
    }
    return [{ kind, loops, cells: own, strips }];
  });
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
  const caveOutline = caveLoops(caveKeys, (x, y) => level.tiles[`${x},${y}`] !== undefined, true);
  // Geröll am Fuß der Höhlenwand: hier und da ein paar Brocken, ein Stück vom Rand im Boden.
  const caveStones: Parsed['caveStones'] = [];
  caveOutline.forEach((loop, li) => {
    const normals = outward(loop);
    loop.points.forEach(([x, y], i) => {
      if (loop.open[i] || spotNoise(i, li, 31) > 0.022) return;
      // Ein Haufen: ein großer Stein, daneben ein, zwei kleine.
      const count = 1 + Math.floor(spotNoise(i, li, 32) * 3);
      for (let k = 0; k < count; k++) {
        const r =
          k === 0 ? 0.13 + spotNoise(i, li, 41) * 0.12 : 0.06 + spotNoise(i, li, 41 + k) * 0.06;
        const inset = r * 0.9 + (k === 0 ? 0.02 : 0.1 + spotNoise(i, li, 33 + k) * 0.2);
        const along = k === 0 ? 0 : (k === 1 ? 1 : -1) * (0.2 + spotNoise(i, li, 37 + k) * 0.14);
        const [nx, ny] = normals[i]!;
        caveStones.push({
          x: x - nx * inset - ny * along,
          y: y - ny * inset + nx * along,
          r,
          turn: Math.floor(spotNoise(i, li, 45 + k) * 1000),
        });
      }
    });
  });
  const patches = parsePatches(level, cells, caveKeys);
  const liquidKeys = new Set(
    patches
      .filter(
        (p) => p.kind === 'water' || p.kind === 'acid' || p.kind === 'lava' || p.kind === 'chasm',
      )
      .flatMap((p) => p.cells.map(keyOf)),
  );
  const parsed = {
    cells,
    segments,
    openings,
    rim: [...rim.values()],
    labels,
    rounds,
    roundKeys: new Set(roundRoomOf.keys()),
    caveKeys,
    patches,
    liquidKeys,
    caveLoops: caveOutline,
    caveNormals: caveOutline.map(outward),
    caveStones,
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

  /** Eine Textur als Muster, an der Karte verankert; `cells` Felder breit. Null, solange sie lädt. */
  const tex = (name: TextureName, cells: number): CanvasPattern | null => {
    const image = textureOf(name);
    if (!image) return null;
    const pattern = ctx.createPattern(image, 'repeat');
    pattern?.setTransform(
      new DOMMatrix().translate(view.ox, view.oy).scale((cells * z) / image.width),
    );
    return pattern;
  };
  const textured = textureOf('flag') !== null && textureOf('ground') !== null;
  ctx.fillStyle = tex('rock', 9) ?? palette.rock;
  ctx.fillRect(0, 0, width, height);
  // Körnung: Stein und Pergament sind nie glatt. Sie hängt an der Karte, nicht am Fenster.
  const grain = ctx.createPattern(grainOf(), 'repeat');
  grain?.setTransform(new DOMMatrix().translate(view.ox, view.oy).scale(z / 36));
  const grainOver = (alpha: number) => {
    if (!grain) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  };
  grainOver(textured ? 0.25 : 0.5);

  // Schraffur im Fels am Rand des Bodens.
  // Die Schraffur gehört zum Tuschestil; über gemaltem Fels steht sie nicht.
  if (z >= 10 && !textured) {
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
    hatch(parsed.rim, z >= 18 ? 4 : 3, textured ? 0.42 : 0.6);
    hatch(parsed.rimFar, 2, textured ? 0.18 : 0.28);
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

  // Runde Räume zeichnen ihre Ellipse; sie wird auch gebraucht, um den Boden zu umreißen.
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
  /** Alles, was Boden ist, als ein Pfad: Felder, Höhlen, runde Räume. Zum Beschneiden. */
  const floorRegion = () => {
    ctx.beginPath();
    for (const cell of parsed.cells) {
      if (!visible(cell.x, cell.y)) continue;
      const key = keyOf(cell);
      if (parsed.roundKeys.has(key) || parsed.caveKeys.has(key)) continue;
      ctx.rect(sx(cell.x), sy(cell.y), z, z);
    }
    for (const loop of parsed.caveLoops) {
      loop.points.forEach(([x, y], i) =>
        i === 0 ? ctx.moveTo(sx(x), sy(y)) : ctx.lineTo(sx(x), sy(y)),
      );
      ctx.closePath();
    }
    for (const round of parsed.rounds) {
      const { shape } = round;
      ctx.moveTo(sx(shape.x + shape.w), sy(shape.y + shape.h / 2));
      ctx.ellipse(
        sx(shape.x + shape.w / 2),
        sy(shape.y + shape.h / 2),
        (shape.w / 2) * z,
        (shape.h / 2) * z,
        0,
        0,
        Math.PI * 2,
      );
    }
  };

  // Um den Boden herum hellt der Fels auf – so liegen Räume und Höhlen im Gestein, nicht davor.
  if (textured) {
    ctx.save();
    floorRegion();
    ctx.strokeStyle = palette.inkSoft;
    ctx.lineJoin = 'round';
    for (const [w, a] of [
      [2.4, 0.05],
      [1.5, 0.07],
      [0.8, 0.1],
    ] as const) {
      ctx.lineWidth = z * w;
      ctx.globalAlpha = a;
      ctx.stroke();
    }
    ctx.restore();
  }
  // Boden: erst überall der blanke Grund, dann das Gelände als Flächen darauf.
  // Gelegter Boden sind Steinplatten, gewachsener Boden ist Geröll und Erde.
  const flagFill = tex('flag', 4) ?? palette.floor;
  const groundFill = tex('ground', 6);
  ctx.fillStyle = palette.floor;
  for (const cell of parsed.cells) {
    if (!visible(cell.x, cell.y) || parsed.roundKeys.has(keyOf(cell))) continue;
    if (parsed.caveKeys.has(keyOf(cell))) continue;
    if (cell.tile === 'air') drawAir(ctx, scene.below, cell, sx(cell.x), sy(cell.y), z, palette);
    else {
      ctx.fillStyle = flagFill;
      ctx.fillRect(sx(cell.x), sy(cell.y), z + 0.5, z + 0.5);
    }
  }
  // Höhlenboden: innerhalb des Umrisses.
  if (caves.length > 0) {
    ctx.save();
    cavePath();
    ctx.clip();
    const pad = z * 0.8;
    ctx.fillStyle = groundFill ?? palette.floor;
    for (const cell of caves) {
      if (!visible(cell.x, cell.y)) continue;
      // Der Boden reicht bis an den Umriss, auch wo der über das Feld hinausgeht.
      ctx.fillRect(sx(cell.x) - pad, sy(cell.y) - pad, z + pad * 2, z + pad * 2);
    }
    // Gewachsener Boden ist eine Spur dunkler als gelegter.
    ctx.fillStyle = palette.grid;
    ctx.globalAlpha = groundFill ? 0 : 0.3;
    for (const cell of caves)
      if (visible(cell.x, cell.y))
        ctx.fillRect(sx(cell.x) - pad, sy(cell.y) - pad, z + pad * 2, z + pad * 2);
    ctx.globalAlpha = 1;
    for (const cell of caves)
      if (visible(cell.x, cell.y) && cell.tile === 'air')
        drawAir(ctx, scene.below, cell, sx(cell.x), sy(cell.y), z, palette);
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
    ctx.restore();
  }
  // Runde Räume: der Boden ist die Ellipse.
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
    ctx.fillStyle = airy ? palette.chasm : flagFill;
    ctx.fillRect(...box);
    if (airy && scene.below) {
      ctx.fillStyle = palette.floor;
      ctx.globalAlpha = 0.42;
      ctx.fillRect(...box);
      ctx.globalAlpha = 1;
    }
    for (const cell of round.cells) {
      if (airy && cell.tile !== 'air') {
        ctx.fillStyle = palette.floor;
        ctx.fillRect(sx(cell.x), sy(cell.y), z + 0.5, z + 0.5);
      } else if (!airy && cell.tile === 'air')
        drawAir(ctx, scene.below, cell, sx(cell.x), sy(cell.y), z, palette);
    }
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

  // Struktur im Boden: Platten in gebauten Räumen, Sprünge und Kiesel – damit er nicht wie Papier wirkt.
  if (z >= 14 && !textured) {
    ctx.save();
    floorRegion();
    ctx.clip();
    for (const cell of parsed.cells) {
      if (!visible(cell.x, cell.y) || cell.tile === 'air') continue;
      if (parsed.caveKeys.has(keyOf(cell))) continue;
      const t = spotNoise(cell.x, cell.y, 11);
      ctx.fillStyle = t < 0.5 ? palette.wall : palette.snow;
      ctx.globalAlpha = t < 0.5 ? (0.5 - t) * 0.11 : (t - 0.5) * 0.2;
      ctx.fillRect(sx(cell.x), sy(cell.y), z + 0.5, z + 0.5);
    }
    ctx.strokeStyle = palette.inkSoft;
    ctx.fillStyle = palette.inkSoft;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.32;
    ctx.beginPath();
    for (const cell of parsed.cells) {
      if (!visible(cell.x, cell.y) || cell.tile === 'air') continue;
      const cave = parsed.caveKeys.has(keyOf(cell));
      // Ein Sprung im Stein: in jedem sechsten Feld, in Höhlen öfter.
      if (spotNoise(cell.x, cell.y, 12) < (cave ? 0.3 : 0.16)) {
        const px = cell.x + 0.2 + spotNoise(cell.x, cell.y, 13) * 0.5;
        const py = cell.y + 0.2 + spotNoise(cell.x, cell.y, 14) * 0.5;
        const a = spotNoise(cell.x, cell.y, 15) * Math.PI * 2;
        ctx.moveTo(sx(px), sy(py));
        ctx.lineTo(sx(px + Math.cos(a) * 0.16), sy(py + Math.sin(a) * 0.16));
        ctx.lineTo(sx(px + Math.cos(a + 0.7) * 0.3), sy(py + Math.sin(a + 0.7) * 0.3));
      }
    }
    ctx.stroke();
    ctx.beginPath();
    for (const cell of parsed.cells) {
      if (!visible(cell.x, cell.y) || !parsed.caveKeys.has(keyOf(cell))) continue;
      for (let i = 0; i < 3; i++) {
        if (spotNoise(cell.x, cell.y, 20 + i) < 0.45) continue;
        const px = sx(cell.x + spotNoise(cell.x, cell.y, 23 + i));
        const py = sy(cell.y + spotNoise(cell.x, cell.y, 26 + i));
        const r = Math.max(0.8, z * (0.018 + spotNoise(cell.x, cell.y, 29 + i) * 0.022));
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Gelände als Flächen: zusammenhängend, mit eigenem Ufer – nie als eckige Felder.
  if (parsed.patches.length > 0) {
    ctx.save();
    floorRegion();
    ctx.clip();
    for (const patch of parsed.patches)
      drawPatch(
        ctx,
        patch,
        sx,
        sy,
        z,
        palette,
        visible,
        tex,
        // Am Ufer läuft der Boden in die Fläche hinein – der, auf dem sie liegt.
        patch.cells[0] && parsed.caveKeys.has(keyOf(patch.cells[0])) ? groundFill : tex('flag', 4),
      );
    ctx.restore();
  }
  // Was auf einzelnen Feldern liegt: Geröll, die Streifen des Geheimgangs, die Planken der Brücke.
  for (const cell of parsed.cells) {
    if (!visible(cell.x, cell.y)) continue;
    if (cell.tile === 'rubble' || cell.tile === 'secret' || cell.tile === 'bridge')
      drawDecor(ctx, level, cell, sx(cell.x), sy(cell.y), z, palette, tex('wood', 3));
  }

  // Zur Höhlenwand hin wird es dunkler – in mehreren Lagen, damit es weich ausläuft.
  if (parsed.caveLoops.length > 0) {
    ctx.save();
    cavePath();
    ctx.clip();
    ctx.strokeStyle = palette.wall;
    ctx.lineJoin = 'round';
    for (const width of [1.5, 1.05, 0.7, 0.4]) {
      ctx.lineWidth = z * width;
      ctx.globalAlpha = 0.055;
      caveWall();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Brocken am Fuß der Wand.
    if (z >= 12) {
      for (const stone of parsed.caveStones) {
        if (!visible(Math.floor(stone.x), Math.floor(stone.y))) continue;
        drawStone(ctx, sx(stone.x), sy(stone.y), stone.r * z, stone.turn, palette);
      }
    }
    ctx.restore();
  }
  // Die Körnung liegt über allem Boden, auch über Wasser und Lava.
  ctx.save();
  floorRegion();
  ctx.clip();
  grainOver(textured ? 0.22 : 0.6);
  ctx.restore();

  // Raster auf dem Boden – über Wasser, Lava und Säure nur ein Hauch, zum Zählen der Felder.
  if (z >= 9) {
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const cell of parsed.cells) {
      if (!visible(cell.x, cell.y) || cell.tile === 'air') continue;
      const key = keyOf(cell);
      if (parsed.roundKeys.has(key) || parsed.caveKeys.has(key) || parsed.liquidKeys.has(key))
        continue;
      const x = Math.round(sx(cell.x)) + 0.5;
      const y = Math.round(sy(cell.y)) + 0.5;
      ctx.moveTo(x, y + z);
      ctx.lineTo(x, y);
      ctx.lineTo(x + z, y);
    }
    ctx.stroke();
    if (parsed.liquidKeys.size > 0) {
      ctx.save();
      floorRegion();
      ctx.clip();
      ctx.globalAlpha = 0.26;
      ctx.beginPath();
      for (const cell of parsed.cells) {
        if (!visible(cell.x, cell.y) || cell.tile === 'chasm') continue;
        if (!parsed.liquidKeys.has(keyOf(cell))) continue;
        const x = Math.round(sx(cell.x)) + 0.5;
        const y = Math.round(sy(cell.y)) + 0.5;
        // Nur die Linien zwischen zwei Feldern der Fläche – am Ufer steht keine.
        if (parsed.liquidKeys.has(keyOf({ x: cell.x - 1, y: cell.y }))) {
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + z);
        }
        if (parsed.liquidKeys.has(keyOf({ x: cell.x, y: cell.y - 1 }))) {
          ctx.moveTo(x, y);
          ctx.lineTo(x + z, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    }
  }
  // Feuer und Fackeln werfen warmes Licht auf den Boden.
  ctx.save();
  floorRegion();
  ctx.clip();
  for (const marker of level.markers) {
    if (marker.kind !== 'fire' && marker.kind !== 'torch') continue;
    if (scene.play?.unlit.has(marker.id) || !visible(marker.x, marker.y)) continue;
    const cx = sx(marker.x + marker.w / 2);
    const cy = sy(marker.y + marker.h / 2);
    const r = z * (marker.kind === 'fire' ? 3.4 : 2.4);
    const light = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    light.addColorStop(0, palette.ember);
    light.addColorStop(1, fade(palette.ember));
    ctx.fillStyle = light;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // Dunst und magische Dunkelheit: weiche Schwaden ohne Rand.
  ctx.save();
  floorRegion();
  ctx.clip();
  for (const cell of parsed.cells) {
    if ((cell.tile !== 'fog' && cell.tile !== 'dark') || !visible(cell.x, cell.y)) continue;
    const dark = cell.tile === 'dark';
    for (let i = 0; i < 2; i++) {
      const cx = sx(cell.x + 0.5 + (spotNoise(cell.x, cell.y, 40 + i) - 0.5) * 0.5);
      const cy = sy(cell.y + 0.5 + (spotNoise(cell.x, cell.y, 50 + i) - 0.5) * 0.5);
      const r = z * (0.75 + spotNoise(cell.x, cell.y, 60 + i) * 0.3);
      const puff = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      puff.addColorStop(0, dark ? palette.chasm : palette.snow);
      puff.addColorStop(1, fade(dark ? palette.chasm : palette.snow));
      ctx.fillStyle = puff;
      ctx.globalAlpha = dark ? 0.7 : 0.42;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    if (dark) {
      const cx = sx(cell.x + 0.5);
      const cy = sy(cell.y + 0.5);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, z * 0.8);
      glow.addColorStop(0, palette.glow);
      glow.addColorStop(1, fade(palette.glow));
      ctx.fillStyle = glow;
      ctx.globalAlpha = 0.28;
      ctx.fillRect(cx - z, cy - z, z * 2, z * 2);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

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
      ctx.save();
      floorRegion();
      ctx.clip();
      for (const [key, feet] of Object.entries(level.heights)) {
        const cell = cellOfKey(key);
        if (!visible(cell.x, cell.y)) continue;
        ctx.fillStyle = feet > 0 ? palette.snow : palette.chasm;
        ctx.globalAlpha =
          feet > 0 ? Math.min(0.3, 0.08 + feet / 140) : Math.min(0.42, 0.1 + -feet / 80);
        ctx.fillRect(sx(cell.x), sy(cell.y), z + 0.5, z + 0.5);
      }
      ctx.globalAlpha = 1;
      // Wie hoch die Wandfläche einer Kante im Bild steht – eine Stufe schmal, ein Absatz breit.
      const faceOf = (drop: number) => Math.min(0.5, 0.05 + drop * 0.018);
      const shade = (
        x: number,
        y: number,
        w: number,
        h: number,
        dx: number,
        dy: number,
        a: number,
      ) => {
        const gradient = ctx.createLinearGradient(x, y, x + dx * w, y + dy * h);
        gradient.addColorStop(dx + dy > 0 ? 0 : 1, palette.wall);
        gradient.addColorStop(dx + dy > 0 ? 1 : 0, fade(palette.wall));
        ctx.fillStyle = gradient;
        ctx.globalAlpha = a;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
      };
      const rims: [number, number, number, number][] = [];
      const tops: [number, number, number, number][] = [];
      /** Die helle Kante oben auf dem Höheren, von hinten gesehen. */
      const lips: [number, number, number, number][] = [];
      for (const cell of parsed.cells) {
        if (!visible(cell.x, cell.y)) continue;
        const own = level.heights[keyOf(cell)] ?? 0;
        const x = sx(cell.x);
        const y = sy(cell.y);
        const north = heightOf(cell.x, cell.y - 1);
        const west = heightOf(cell.x - 1, cell.y);
        const south = heightOf(cell.x, cell.y + 1);
        const east = heightOf(cell.x + 1, cell.y);
        // Das Höhere liegt links: Man sieht seine Flanke schmal, dahinter fällt Schatten.
        if (west !== null && west > own) {
          const drop = west - own;
          const face = z * faceOf(drop) * 0.55;
          ctx.fillStyle = palette.inkSoft;
          ctx.fillRect(x, y, face, z + 0.5);
          ctx.fillStyle = palette.wall;
          ctx.globalAlpha = 0.3;
          ctx.fillRect(x, y, face, z + 0.5);
          ctx.globalAlpha = 1;
          shade(x + face, y, z * Math.min(0.6, 0.14 + drop / 60), z + 0.5, 1, 0, 0.4);
          tops.push([cell.x, cell.y, cell.x, cell.y + 1]);
        }
        // Das Höhere liegt oben: Man blickt auf seine Vorderseite – eine Wandfläche mit Fugen.
        if (north !== null && north > own) {
          const drop = north - own;
          const face = z * faceOf(drop);
          ctx.fillStyle = palette.inkSoft;
          ctx.fillRect(x, y, z + 0.5, face);
          ctx.strokeStyle = palette.wall;
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let i = 0; i < 3; i++) {
            const fx = x + z * (0.18 + i * 0.32 + (spotNoise(cell.x, cell.y, 70 + i) - 0.5) * 0.1);
            ctx.moveTo(fx, y + face * 0.15);
            ctx.lineTo(fx, y + face * 0.9);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
          shade(x, y + face, z + 0.5, z * Math.min(0.7, 0.16 + drop / 45), 0, 1, 0.5);
          tops.push([cell.x, cell.y, cell.x + 1, cell.y]);
          rims.push([cell.x, cell.y + face / z, cell.x + 1, cell.y + face / z]);
        }
        // Das Höhere liegt unten oder rechts: Von hier sieht man nur seine Kante.
        if (south !== null && south > own) {
          shade(x, y + z * 0.78, z + 0.5, z * 0.22, 0, -1, 0.3);
          tops.push([cell.x, cell.y + 1, cell.x + 1, cell.y + 1]);
          lips.push([cell.x, cell.y + 1.06, cell.x + 1, cell.y + 1.06]);
        }
        if (east !== null && east > own) {
          shade(x + z * 0.78, y, z * 0.22, z + 0.5, -1, 0, 0.3);
          tops.push([cell.x + 1, cell.y, cell.x + 1, cell.y + 1]);
          lips.push([cell.x + 1.06, cell.y, cell.x + 1.06, cell.y + 1]);
        }
      }
      ctx.lineCap = 'round';
      ctx.strokeStyle = palette.wall;
      ctx.lineWidth = Math.max(1.2, z * 0.05);
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of tops) {
        ctx.moveTo(sx(x1), sy(y1));
        ctx.lineTo(sx(x2), sy(y2));
      }
      ctx.stroke();
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = Math.max(1, z * 0.03);
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of rims) {
        ctx.moveTo(sx(x1), sy(y1));
        ctx.lineTo(sx(x2), sy(y2));
      }
      ctx.stroke();
      ctx.strokeStyle = palette.snow;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = Math.max(1, z * 0.04);
      ctx.beginPath();
      for (const [x1, y1, x2, y2] of lips) {
        ctx.moveTo(sx(x1), sy(y1));
        ctx.lineTo(sx(x2), sy(y2));
      }
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.globalAlpha = 1;
      ctx.restore();
      // Die Zahl steht nur da, solange mit dem Höhen-Werkzeug gearbeitet wird.
      if (scene.heightNumbers && z >= 22) {
        ctx.font = `600 ${Math.max(9, z * 0.28)}px ${palette.font}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        for (const [key, feet] of Object.entries(level.heights)) {
          const cell = cellOfKey(key);
          if (visible(cell.x, cell.y))
            haloText(
              ctx,
              `${feet > 0 ? '+' : ''}${feet}`,
              sx(cell.x) + 3,
              sy(cell.y + 1) - 1,
              palette,
            );
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
  const wallWidth = Math.max(2, z * (textured ? 0.24 : 0.15));
  const wallStone = tex('wall', 3);
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
  // Die Wände stehen: Ihr Schatten fällt nach unten rechts auf den Boden.
  if (z >= 12) {
    ctx.save();
    floorRegion();
    ctx.clip();
    ctx.translate(z * 0.1, z * 0.12);
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = wallWidth * 1.5;
    solidWalls();
    ctx.stroke();
    if (parsed.caveLoops.length > 0) {
      caveWall();
      ctx.stroke();
    }
    for (const round of parsed.rounds) {
      ellipse(round.shape);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    floorRegion();
    ctx.clip();
    ctx.globalAlpha = 0.07;
    ctx.lineWidth = z * 0.5;
    solidWalls();
    ctx.stroke();
    if (parsed.caveLoops.length > 0) {
      caveWall();
      ctx.stroke();
    }
    ctx.restore();
  }
  /** Eine Mauer: dunkler Rand, darin Stein, oben links ein Lichtstreif – sie hat Stärke. */
  const masonry = (path: () => void) => {
    ctx.strokeStyle = palette.wall;
    ctx.lineWidth = wallWidth;
    path();
    ctx.stroke();
    if (!wallStone) return;
    ctx.strokeStyle = wallStone;
    ctx.lineWidth = Math.max(1, wallWidth - Math.max(2, z * 0.07));
    path();
    ctx.stroke();
    ctx.save();
    ctx.translate(-wallWidth * 0.16, -wallWidth * 0.16);
    ctx.strokeStyle = palette.snow;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = wallWidth * 0.3;
    path();
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = palette.wall;
  };
  masonry(solidWalls);
  // Die Höhlenwand ist keine Linie gleicher Stärke, sondern Tusche: mal breit, mal schmal, außen rau.
  ctx.fillStyle = palette.wall;
  parsed.caveLoops.forEach((loop, li) => {
    const normals = parsed.caveNormals[li]!;
    const n = loop.points.length;
    const widthAt = (i: number) =>
      z *
      (0.13 +
        0.07 * Math.sin(i * 0.19 + li) * Math.sin(i * 0.053 + li * 2) +
        0.06 * spotNoise(i, li, 51));
    let run: number[] = [];
    const flush = () => {
      if (run.length < 2) {
        run = [];
        return;
      }
      ctx.beginPath();
      run.forEach((i, k) => {
        const [x, y] = loop.points[i % n]!;
        const [nx, ny] = normals[i % n]!;
        // Ein Hauch nach innen, damit die Tusche den Rand des Bodens sicher deckt.
        const px = sx(x) - nx * z * 0.03;
        const py = sy(y) - ny * z * 0.03;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      for (let k = run.length - 1; k >= 0; k--) {
        const i = run[k]!;
        const [x, y] = loop.points[i % n]!;
        const [nx, ny] = normals[i % n]!;
        const w = widthAt(i);
        ctx.lineTo(sx(x) + nx * w, sy(y) + ny * w);
      }
      ctx.closePath();
      ctx.fill();
      run = [];
    };
    for (let i = 0; i <= n; i++) {
      run.push(i);
      if (loop.open[i % n]) flush();
    }
    flush();
  });
  // Die Wand eines runden Raums ist seine Ellipse; wo eine Öffnung sitzt, ist sie unterbrochen.
  for (const round of parsed.rounds) {
    masonry(() => ellipse(round.shape));
    ctx.fillStyle = flagFill;
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
    const rockAt = (x: number, y: number) => level.tiles[`${x},${y}`] === undefined;
    // Zwei Durchgänge: was die Gruppe kennt, aber gerade nicht sieht – und was sie nie gesehen hat.
    for (const known of [true, false]) {
      ctx.beginPath();
      for (const cell of parsed.cells) {
        if (!visible(cell.x, cell.y)) continue;
        const key = keyOf(cell);
        if (play.visible.has(key) || play.seen.has(key) !== known) continue;
        const grow = known ? 0 : pad;
        ctx.rect(sx(cell.x) - grow, sy(cell.y) - grow, z + grow * 2, z + grow * 2);
        if (!parsed.caveKeys.has(key)) continue;
        // Höhlenboden reicht über sein Feld hinaus – zum Fels hin deckt der Schleier ihn mit.
        const out = z * 0.8;
        const n = rockAt(cell.x, cell.y - 1);
        const so = rockAt(cell.x, cell.y + 1);
        const w = rockAt(cell.x - 1, cell.y);
        const e = rockAt(cell.x + 1, cell.y);
        if (n) ctx.rect(sx(cell.x), sy(cell.y) - out, z, out);
        if (so) ctx.rect(sx(cell.x), sy(cell.y + 1), z, out);
        if (w) ctx.rect(sx(cell.x) - out, sy(cell.y), out, z);
        if (e) ctx.rect(sx(cell.x + 1), sy(cell.y), out, z);
        if (n && w) ctx.rect(sx(cell.x) - out, sy(cell.y) - out, out, out);
        if (n && e) ctx.rect(sx(cell.x + 1), sy(cell.y) - out, out, out);
        if (so && w) ctx.rect(sx(cell.x) - out, sy(cell.y + 1), out, out);
        if (so && e) ctx.rect(sx(cell.x + 1), sy(cell.y + 1), out, out);
      }
      ctx.globalAlpha = known ? 0.42 : play.playerView ? 1 : 0.7;
      ctx.fill();
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
let grainCanvas: HTMLCanvasElement | null = null;
/**
 * Eine Kachel Körnung: weiche Flecken in drei Größen und feine Sprenkel, hell und dunkel, an den
 * Rändern nahtlos. Einmal gerechnet, nach fester Regel – dieselbe Körnung an jedem Rechner.
 */
function grainOf(): HTMLCanvasElement {
  if (grainCanvas) return grainCanvas;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  grainCanvas = canvas;
  if (!ctx) return canvas;
  const rng = rngOf(seedOf('dungeon', 'grain'));
  const layers = [8, 20, 48].map((cells) => ({
    cells,
    values: Array.from({ length: cells * cells }, () => rng.next()),
  }));
  const ease = (t: number) => t * t * (3 - 2 * t);
  const sample = (layer: (typeof layers)[number], x: number, y: number) => {
    const fx = (x / size) * layer.cells;
    const fy = (y / size) * layer.cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = ease(fx - x0);
    const ty = ease(fy - y0);
    const at = (cx: number, cy: number) =>
      layer.values[(cy % layer.cells) * layer.cells + (cx % layer.cells)]!;
    const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
    const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bottom * ty;
  };
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v =
        sample(layers[0]!, x, y) * 0.45 +
        sample(layers[1]!, x, y) * 0.33 +
        sample(layers[2]!, x, y) * 0.22;
      const speck = rng.next();
      const dark = v < 0.5;
      let alpha = Math.abs(v - 0.5) * 2 * 70;
      // Feine Sprenkel: dunkle Körner, seltener helle.
      let tone = dark ? 20 : 255;
      if (speck < 0.035) {
        tone = 20;
        alpha = 95;
      } else if (speck > 0.985) {
        tone = 255;
        alpha = 80;
      }
      const o = (y * size + x) * 4;
      image.data[o] = tone;
      image.data[o + 1] = tone;
      image.data[o + 2] = tone;
      image.data[o + 3] = alpha;
    }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Ein Stein, gemalt: kantiger Umriss, Schatten nach unten rechts, eine helle Fläche oben links,
 * dunkle Kontur. `seed` legt seine Gestalt fest.
 */
function drawStone(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  seed: number,
  palette: Palette,
): void {
  const corners = 6 + (seed % 3);
  const squash = 0.72 + spotNoise(seed, 1, 3) * 0.24;
  const turn = spotNoise(seed, 2, 3) * Math.PI;
  const points: [number, number][] = [];
  for (let i = 0; i < corners; i++) {
    const a = (i / corners) * Math.PI * 2 + (spotNoise(seed, i, 4) - 0.5) * 0.5;
    const d = r * (0.78 + spotNoise(seed, i, 5) * 0.34);
    const px = Math.cos(a) * d;
    const py = Math.sin(a) * d * squash;
    points.push([
      px * Math.cos(turn) - py * Math.sin(turn),
      px * Math.sin(turn) + py * Math.cos(turn),
    ]);
  }
  const shape = (dx: number, dy: number, scale = 1) => {
    ctx.beginPath();
    points.forEach(([px, py], i) =>
      i === 0
        ? ctx.moveTo(cx + dx + px * scale, cy + dy + py * scale)
        : ctx.lineTo(cx + dx + px * scale, cy + dy + py * scale),
    );
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  // Schatten auf dem Boden.
  ctx.fillStyle = palette.wall;
  ctx.globalAlpha = 0.32;
  shape(r * 0.16, r * 0.2, 1.04);
  ctx.fill();
  // Der Stein selbst: warmes Grau.
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.grid;
  shape(0, 0);
  ctx.fill();
  ctx.fillStyle = palette.rubble;
  ctx.globalAlpha = 0.38;
  ctx.fill();
  // Schattenseite unten rechts, Licht oben links – als Flächen, nicht als Verlauf.
  ctx.save();
  shape(0, 0);
  ctx.clip();
  ctx.fillStyle = palette.wall;
  ctx.globalAlpha = 0.3;
  shape(r * 0.34, r * 0.38);
  ctx.fill();
  ctx.fillStyle = palette.snow;
  ctx.globalAlpha = 0.5;
  shape(-r * 0.3, -r * 0.34, 0.62);
  ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = palette.wall;
  ctx.lineWidth = Math.max(1, r * 0.13);
  shape(0, 0);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Dieselbe Farbe, durchsichtig: So läuft ein Verlauf aus, ohne grau zu werden. */
function fade(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}00` : 'transparent';
}

/** Luftraum: offen nach unten – man sieht hinab auf die Ebene darunter. */
function drawAir(
  ctx: CanvasRenderingContext2D,
  below: DungeonLevel | null,
  cell: { x: number; y: number },
  x: number,
  y: number,
  z: number,
  palette: Palette,
): void {
  ctx.fillStyle = palette.chasm;
  ctx.fillRect(x, y, z + 0.5, z + 0.5);
  const under = below?.tiles[keyOf(cell)];
  if (under !== undefined && under !== 'chasm' && under !== 'air') {
    ctx.fillStyle = under === 'water' ? palette.water : palette.floor;
    ctx.globalAlpha = 0.42;
    ctx.fillRect(x, y, z + 0.5, z + 0.5);
    ctx.globalAlpha = 1;
  }
}

/** Eine Fläche Gelände: gefüllt bis an ihr Ufer, mit dem, was sie ausmacht, und einer Uferlinie. */
function drawPatch(
  ctx: CanvasRenderingContext2D,
  patch: Patch,
  sx: (x: number) => number,
  sy: (y: number) => number,
  z: number,
  palette: Palette,
  visible: (x: number, y: number) => boolean,
  tex: (name: TextureName, cells: number) => CanvasPattern | null,
  blend: CanvasPattern | null,
): void {
  const area = () => {
    ctx.beginPath();
    for (const loop of patch.loops) {
      loop.points.forEach(([x, y], i) =>
        i === 0 ? ctx.moveTo(sx(x), sy(y)) : ctx.lineTo(sx(x), sy(y)),
      );
      ctx.closePath();
    }
    for (const [x, y, w, h] of patch.strips) ctx.rect(sx(x), sy(y), w * z, h * z);
  };
  /** Das Ufer: der Rand, wo er an Boden grenzt. */
  const shore = () => {
    ctx.beginPath();
    for (const loop of patch.loops) {
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
  const fill = (color: string | CanvasPattern, alpha = 1) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    area();
    ctx.fill();
    ctx.globalAlpha = 1;
  };
  const line = (color: string | CanvasPattern, width: number, alpha = 1) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    shore();
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  /** Innerhalb der Fläche zeichnen. */
  const inside = (draw: () => void) => {
    ctx.save();
    area();
    ctx.clip();
    draw();
    ctx.restore();
  };
  /** Ein weiches Ufer: Der Boden läuft in mehreren Lagen in die Fläche hinein. */
  const feather = () => {
    if (!blend) return;
    inside(() => {
      line(blend, z * 0.55, 0.3);
      line(blend, z * 0.3, 0.45);
      line(blend, z * 0.13, 0.6);
    });
  };
  const cells = patch.cells.filter((cell) => visible(cell.x, cell.y));
  const at = (cell: DungeonCell, salt: number) => spotNoise(cell.x, cell.y, salt);
  const detail = z >= 12;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  switch (patch.kind) {
    case 'water': {
      fill(tex('water', 7) ?? palette.water);
      fill(palette.lake, tex('water', 7) ? 0.22 : 0.34);
      inside(() => {
        // Flaches Wasser am Ufer ist heller.
        line(palette.snow, z * 0.34, 0.3);
        if (!detail) return;
        ctx.strokeStyle = palette.waterLine;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        for (const cell of cells)
          for (let i = 0; i < 2; i++) {
            if (at(cell, 80 + i) < 0.35) continue;
            const x = sx(cell.x + 0.12 + at(cell, 82 + i) * 0.5);
            const y = sy(cell.y + 0.2 + i * 0.4 + at(cell, 84 + i) * 0.2);
            const w = z * (0.2 + at(cell, 86 + i) * 0.14);
            ctx.moveTo(x, y);
            ctx.quadraticCurveTo(x + w * 0.25, y - z * 0.06, x + w * 0.5, y);
            ctx.quadraticCurveTo(x + w * 0.75, y + z * 0.06, x + w, y);
          }
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
      feather();
      line(palette.waterLine, Math.max(1, z * 0.035), blend ? 0.45 : 1);
      break;
    }
    case 'deep': {
      fill(palette.deepLake, 0.5);
      ctx.setLineDash([z * 0.16, z * 0.12]);
      line(palette.deepLake, Math.max(1, z * 0.035), 0.7);
      ctx.setLineDash([]);
      break;
    }
    case 'mud': {
      fill(tex('mud', 5) ?? palette.mud, tex('mud', 5) ? 0.92 : 0.5);
      inside(() => {
        line(palette.mud, z * 0.3, 0.25);
        if (!detail) return;
        ctx.strokeStyle = palette.wall;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.45;
        ctx.beginPath();
        for (const cell of cells)
          for (let i = 0; i < 3; i++) {
            const x = sx(cell.x + 0.1 + at(cell, 90 + i) * 0.7);
            const y = sy(cell.y + 0.15 + at(cell, 93 + i) * 0.7);
            ctx.moveTo(x, y);
            ctx.lineTo(x + z * (0.08 + at(cell, 96 + i) * 0.1), y);
          }
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
      feather();
      if (!blend) line(palette.mud, Math.max(1, z * 0.04), 0.8);
      break;
    }
    case 'ice': {
      fill(tex('ice', 6) ?? palette.snow, 0.9);
      fill(palette.lake, 0.12);
      inside(() => {
        if (!detail) return;
        ctx.strokeStyle = palette.waterLine;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        for (const cell of cells) {
          // Glanz: zwei kurze Striche; hier und da ein Riss.
          const x = sx(cell.x + 0.2 + at(cell, 100) * 0.3);
          const y = sy(cell.y + 0.5 + at(cell, 101) * 0.3);
          ctx.moveTo(x, y);
          ctx.lineTo(x + z * 0.22, y - z * 0.22);
          ctx.moveTo(x + z * 0.14, y + z * 0.06);
          ctx.lineTo(x + z * 0.26, y - z * 0.06);
          if (at(cell, 102) < 0.3) {
            const a = at(cell, 103) * Math.PI * 2;
            const px = sx(cell.x + 0.5);
            const py = sy(cell.y + 0.5);
            ctx.moveTo(px, py);
            ctx.lineTo(px + Math.cos(a) * z * 0.3, py + Math.sin(a) * z * 0.3);
            ctx.lineTo(px + Math.cos(a + 0.9) * z * 0.5, py + Math.sin(a + 0.9) * z * 0.5);
          }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
      feather();
      line(palette.waterLine, Math.max(1, z * 0.03), blend ? 0.35 : 0.7);
      break;
    }
    case 'web': {
      fill(palette.snow, 0.22);
      if (!detail) break;
      inside(() => {
        ctx.strokeStyle = palette.inkSoft;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        for (const cell of cells) {
          const cx = sx(cell.x + 0.5 + (at(cell, 110) - 0.5) * 0.3);
          const cy = sy(cell.y + 0.5 + (at(cell, 111) - 0.5) * 0.3);
          const turn = at(cell, 112) * Math.PI;
          const spokes = 7;
          for (let i = 0; i < spokes; i++) {
            const a = turn + (i / spokes) * Math.PI * 2;
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a) * z * 0.62, cy + Math.sin(a) * z * 0.62);
          }
          // Die Fäden dazwischen hängen durch.
          for (const r of [0.2, 0.36, 0.52])
            for (let i = 0; i < spokes; i++) {
              const a = turn + (i / spokes) * Math.PI * 2;
              const b = turn + ((i + 1) / spokes) * Math.PI * 2;
              const m = (a + b) / 2;
              ctx.moveTo(cx + Math.cos(a) * z * r, cy + Math.sin(a) * z * r);
              ctx.quadraticCurveTo(
                cx + Math.cos(m) * z * r * 0.82,
                cy + Math.sin(m) * z * r * 0.82,
                cx + Math.cos(b) * z * r,
                cy + Math.sin(b) * z * r,
              );
            }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
      break;
    }
    case 'thorns': {
      fill(palette.moss, 0.2);
      if (!detail) break;
      inside(() => {
        ctx.strokeStyle = palette.wall;
        ctx.lineWidth = Math.max(1, z * 0.035);
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        for (const cell of cells)
          for (let i = 0; i < 4; i++) {
            // Eine Ranke: ein Bogen mit Dornen.
            const x = sx(cell.x + at(cell, 120 + i));
            const y = sy(cell.y + at(cell, 124 + i));
            const a = at(cell, 128 + i) * Math.PI * 2;
            const dx = Math.cos(a) * z * 0.26;
            const dy = Math.sin(a) * z * 0.26;
            ctx.moveTo(x - dx, y - dy);
            ctx.quadraticCurveTo(x + dy * 0.6, y - dx * 0.6, x + dx, y + dy);
            for (const t of [-0.5, 0.1, 0.6]) {
              const px = x + dx * t;
              const py = y + dy * t;
              ctx.moveTo(px, py);
              ctx.lineTo(px - dy * 0.35, py + dx * 0.35);
            }
          }
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
      break;
    }
    case 'acid': {
      fill(tex('acid', 6) ?? palette.moss, 0.95);
      fill(palette.lake, tex('acid', 6) ? 0.08 : 0.18);
      inside(() => {
        line(palette.snow, z * 0.3, 0.28);
        if (!detail) return;
        ctx.strokeStyle = palette.floor;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        for (const cell of cells)
          for (let i = 0; i < 3; i++) {
            if (at(cell, 130 + i) < 0.3) continue;
            const x = sx(cell.x + at(cell, 133 + i));
            const y = sy(cell.y + at(cell, 136 + i));
            const r = z * (0.035 + at(cell, 139 + i) * 0.05);
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, Math.PI * 2);
          }
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
      feather();
      line(palette.wall, Math.max(1, z * 0.035), blend ? 0.4 : 0.75);
      break;
    }
    case 'lava': {
      // Die Glut scheint auf den Boden ringsum.
      line(palette.ember, z * 0.9, 0.12);
      line(palette.ember, z * 0.45, 0.2);
      fill(tex('lava', 4) ?? palette.lava);
      inside(() => {
        line(palette.ember, z * 0.36, 0.55);
        if (!detail || tex('lava', 4)) return;
        // Helle Adern in der Kruste.
        ctx.strokeStyle = palette.ember;
        ctx.lineWidth = Math.max(1, z * 0.045);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        for (const cell of cells)
          for (let i = 0; i < 2; i++) {
            const x = sx(cell.x + 0.1 + at(cell, 140 + i) * 0.8);
            const y = sy(cell.y + 0.1 + at(cell, 142 + i) * 0.8);
            const a = at(cell, 144 + i) * Math.PI * 2;
            ctx.moveTo(x, y);
            ctx.quadraticCurveTo(
              x + Math.cos(a) * z * 0.2,
              y + Math.sin(a) * z * 0.2,
              x + Math.cos(a + 0.8) * z * 0.38,
              y + Math.sin(a + 0.8) * z * 0.38,
            );
          }
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
      line(palette.wall, Math.max(1.2, z * 0.05), 0.8);
      break;
    }
    case 'chasm': {
      fill(tex('chasm', 8) ?? palette.chasm);
      inside(() => {
        // Die Wand des Abgrunds fällt ab: ein Saum, der nach innen dunkler wird.
        line(palette.rubble, z * 0.6, 0.5);
        line(palette.inkSoft, z * 0.26, 0.5);
      });
      line(palette.wall, Math.max(1.5, z * 0.07));
      break;
    }
  }
  ctx.lineCap = 'butt';
}

/** Was auf einem einzelnen Feld liegt: die Streifen des Geheimgangs, Geröll, die Planken einer Brücke. */
function drawDecor(
  ctx: CanvasRenderingContext2D,
  level: DungeonLevel,
  cell: { x: number; y: number; tile: DungeonTile },
  x: number,
  y: number,
  z: number,
  palette: Palette,
  wood: CanvasPattern | null,
): void {
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
    // Geröll: Brocken verschiedener Größe, in jedem Feld anders.
    // Kleine zuerst, die großen liegen obenauf.
    for (let i = 0; i < 5; i++) {
      const big = i >= 3;
      const px = x + (0.16 + spotNoise(cell.x, cell.y, 150 + i) * 0.68) * z;
      const py = y + (0.16 + spotNoise(cell.x, cell.y, 157 + i) * 0.68) * z;
      const r =
        z *
        (big
          ? 0.15 + spotNoise(cell.x, cell.y, 164 + i) * 0.09
          : 0.06 + spotNoise(cell.x, cell.y, 164 + i) * 0.05);
      drawStone(ctx, px, py, r, Math.floor(spotNoise(cell.x, cell.y, 171 + i) * 1000), palette);
    }
  } else if (cell.tile === 'bridge') {
    // Brücke: Planken quer zur Richtung, in der sie Boden verbindet.
    const solid = (dx: number, dy: number) => {
      const t = level.tiles[keyOf({ x: cell.x + dx, y: cell.y + dy })];
      return t !== undefined && t !== 'chasm' && t !== 'air' && t !== 'water';
    };
    const across = solid(-1, 0) || solid(1, 0) || !(solid(0, -1) || solid(0, 1));
    ctx.fillStyle = wood ?? palette.grid;
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
