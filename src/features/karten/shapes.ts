/**
 * Aus Strichen werden Formen: Der Zeichner malt keine Pinselkleckse, sondern Umrisse, wie von
 * Hand gezogen. Dafür wird die Karte gerastert (welches Gelände liegt wo?), der Rand jedes
 * gemalten Strichs leicht bewegt – immer gleich für dieselbe Stelle – und aus dem Raster werden
 * geschlossene Linien gelesen.
 *
 * Das ist nur die Ansicht. Was an einer Stelle gilt (Tempo, Durchkommen), sagt weiter
 * `groundAt()` aus `domain/mapDraw.ts`; die gezeichnete Kante weicht davon höchstens um die
 * Breite eines Federstrichs ab. Reine Funktionen, ohne Zeichenfläche.
 */
import { GROUNDS, TUNNEL_WIDTH, type GroundType } from '../../domain/mapDraw';
import { rngOf, seedOf, smoothNoise } from '../../domain/random';
import { MAP_GROUNDS, type GameMap, type MapGround } from '../../domain/schema';

/** Weite des Rasters in Karteneinheiten. */
export const STEP = 2.5;
/** So weit außerhalb der Karte verlaufen Umrisse, die an ihren Rand stoßen. */
const OUTSIDE = 90;

type Point = readonly [number, number];
type Symbol = NonNullable<GroundType['symbol']>;

export interface Outline {
  points: [number, number][];
  /** Kasten um die Linie: links, oben, rechts, unten. */
  box: [number, number, number, number];
}

export interface Site {
  x: number;
  y: number;
  symbol: Symbol;
  /** Abstand der Zeichen dieser Art in Karteneinheiten – daran bemisst sich ihre Größe. */
  spread: number;
  /** 0…1 – für kleine Unterschiede in Größe und Form, immer gleich für dieselbe Stelle. */
  roll: number;
}

export interface Shapes {
  /** Umrisse je Gelände – geschlossene Linien; Löcher sind eigene Linien (gerade-ungerade füllen). */
  areas: Partial<Record<MapGround, Outline[]>>;
  /** Wo Bäume, Hügel, Gipfel, Schilf, Dünen, Pilze und Steine stehen – von hinten nach vorn. */
  sites: Site[];
}

export interface Raster {
  /** Je Rasterpunkt die Nummer des Geländes (Stelle in `MAP_GROUNDS`). */
  grid: Uint8Array;
  cols: number;
  rows: number;
  step: number;
}

const index = (ground: MapGround): number => MAP_GROUNDS.indexOf(ground);

/**
 * Rastert die Karte: der Grund, darüber Strich für Strich, zuletzt die Gänge durch den Fels.
 * Gemalte Striche bekommen einen bewegten Rand, Rechtecke bleiben gerade.
 */
export function rasterize(map: GameMap, step = STEP): Raster {
  const frame = map.frame ?? { width: 0, height: 0 };
  const cols = Math.floor(frame.width / step) + 1;
  const rows = Math.floor(frame.height / step) + 1;
  const grid = new Uint8Array(cols * rows).fill(index(map.ground));
  const seed = seedOf(map.id, 'umriss');
  // Wie weit der Rand an jeder Stelle nach innen oder außen rückt (−1…1), in zwei Wellenlängen.
  const wobble = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const [x, y] = [i * step, j * step];
      wobble[j * cols + i] =
        (smoothNoise(seed, x / 46, y / 46) - 0.5) * 1.3 +
        (smoothNoise(seed + 7, x / 15, y / 15) - 0.5) * 0.7;
    }

  /** Setzt `value` überall, wo `covers` gilt – nur im Kasten um die Strecke a–b. */
  const sweep = (
    a: Point,
    b: Point,
    reach: number,
    covers: (distance: number, along: number, cell: number) => boolean,
    value: number,
    only = -1,
  ) => {
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach) / step));
    const i1 = Math.min(cols - 1, Math.ceil((Math.max(a[0], b[0]) + reach) / step));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach) / step));
    const j1 = Math.min(rows - 1, Math.ceil((Math.max(a[1], b[1]) + reach) / step));
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const length = dx * dx + dy * dy;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const cell = j * cols + i;
        if (only >= 0 && grid[cell] !== only) continue;
        const [x, y] = [i * step, j * step];
        const along = length === 0 ? 0 : ((x - a[0]) * dx + (y - a[1]) * dy) / length;
        const t = Math.max(0, Math.min(1, along));
        const distance = Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
        if (covers(distance, along, cell)) grid[cell] = value;
      }
  };

  for (const stroke of map.strokes) {
    const half = stroke.width / 2;
    const value = index(stroke.ground);
    const points = stroke.points;
    if (stroke.cap === 'butt') {
      for (let k = 1; k < points.length; k++)
        sweep(
          points[k - 1]!,
          points[k]!,
          half,
          (distance, along) => along >= 0 && along <= 1 && distance <= half,
          value,
        );
      continue;
    }
    // Je breiter der Pinsel, desto freier der Rand – wie eine Küste, nicht wie ein Zirkel.
    const rough = Math.min(half * 0.42, 13);
    const covers = (distance: number, _along: number, cell: number) =>
      distance <= half + wobble[cell]! * rough;
    if (points.length === 1) sweep(points[0]!, points[0]!, half + rough, covers, value);
    for (let k = 1; k < points.length; k++)
      sweep(points[k - 1]!, points[k]!, half + rough, covers, value);
  }

  if (map.level === 'underground') {
    const [rock, cave] = [index('rock'), index('cave')];
    const half = TUNNEL_WIDTH / 2;
    for (const line of map.lines) {
      if (line.kind !== 'road') continue;
      for (let k = 1; k < line.points.length; k++)
        sweep(
          line.points[k - 1]!,
          line.points[k]!,
          half + 1.5,
          (distance, _along, cell) => distance <= half + wobble[cell]! * 1.2,
          cave,
          rock,
        );
    }
  }
  return { grid, cols, rows, step };
}

/** Das Gelände des Rasters an einer Stelle der Karte. */
export function rasterAt(raster: Raster, x: number, y: number): MapGround {
  const i = Math.max(0, Math.min(raster.cols - 1, Math.round(x / raster.step)));
  const j = Math.max(0, Math.min(raster.rows - 1, Math.round(y / raster.step)));
  return MAP_GROUNDS[raster.grid[j * raster.cols + i]!]!;
}

/** Glättet ein Feld: jeder Punkt wird zum Mittel seiner Nachbarschaft. */
function blur(field: Float32Array, width: number, height: number, reach: number): Float32Array {
  const pass = new Float32Array(field.length);
  const out = new Float32Array(field.length);
  const span = 2 * reach + 1;
  for (let j = 0; j < height; j++) {
    let sum = 0;
    for (let i = -reach; i <= reach; i++)
      sum += field[j * width + Math.min(width - 1, Math.max(0, i))]!;
    for (let i = 0; i < width; i++) {
      pass[j * width + i] = sum / span;
      sum +=
        field[j * width + Math.min(width - 1, i + reach + 1)]! -
        field[j * width + Math.max(0, i - reach)]!;
    }
  }
  for (let i = 0; i < width; i++) {
    let sum = 0;
    for (let j = -reach; j <= reach; j++)
      sum += pass[Math.min(height - 1, Math.max(0, j)) * width + i]!;
    for (let j = 0; j < height; j++) {
      out[j * width + i] = sum / span;
      sum +=
        pass[Math.min(height - 1, j + reach + 1) * width + i]! -
        pass[Math.max(0, j - reach) * width + i]!;
    }
  }
  return out;
}

/**
 * Liest aus einem Feld die Linien, auf denen es den Wert `level` hat (wandernde Quadrate). Das
 * Feld muss am Rand unter `level` liegen – dann sind alle Linien geschlossen.
 */
export function contour(
  field: Float32Array,
  width: number,
  height: number,
  level: number,
): [number, number][][] {
  const count = width * height * 2;
  const first = new Int32Array(count).fill(-1);
  const second = new Int32Array(count).fill(-1);
  const link = (p: number, q: number) => {
    if (first[p]! < 0) first[p] = q;
    else second[p] = q;
    if (first[q]! < 0) first[q] = p;
    else second[q] = p;
  };
  for (let j = 0; j < height - 1; j++)
    for (let i = 0; i < width - 1; i++) {
      const k = j * width + i;
      const [a, b, c, d] = [field[k]!, field[k + 1]!, field[k + width + 1]!, field[k + width]!];
      const code =
        (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      // Kanten des Quadrats: oben, unten, links, rechts.
      const [top, bottom, left, right] = [k * 2, (k + width) * 2, k * 2 + 1, (k + 1) * 2 + 1];
      const middle = (a + b + c + d) / 4 > level;
      if (code === 1 || code === 14) link(left, bottom);
      else if (code === 2 || code === 13) link(bottom, right);
      else if (code === 3 || code === 12) link(left, right);
      else if (code === 4 || code === 11) link(top, right);
      else if (code === 6 || code === 9) link(top, bottom);
      else if (code === 7 || code === 8) link(left, top);
      else if ((code === 5) === middle) {
        link(left, top);
        link(bottom, right);
      } else {
        link(top, right);
        link(left, bottom);
      }
    }
  const at = (edge: number): [number, number] => {
    const k = edge >> 1;
    const [i, j] = [k % width, Math.floor(k / width)];
    if ((edge & 1) === 0) return [i + (level - field[k]!) / (field[k + 1]! - field[k]!), j];
    return [i, j + (level - field[k]!) / (field[k + width]! - field[k]!)];
  };
  const used = new Uint8Array(count);
  const lines: [number, number][][] = [];
  for (let start = 0; start < count; start++) {
    if (first[start]! < 0 || used[start]) continue;
    const line = [at(start)];
    used[start] = 1;
    let [previous, current] = [-1, start];
    for (;;) {
      const [n0, n1] = [first[current]!, second[current]!];
      const next = n0 >= 0 && n0 !== previous ? n0 : n1 >= 0 && n1 !== previous ? n1 : -1;
      if (next < 0 || next === start || used[next]) break;
      used[next] = 1;
      line.push(at(next));
      [previous, current] = [current, next];
    }
    if (line.length > 3) lines.push(line);
  }
  return lines;
}

/** Rundet eine geschlossene Linie ab, indem jede Ecke abgeschnitten wird (Chaikin). */
export function smooth(points: [number, number][], rounds: number): [number, number][] {
  let line = points;
  for (let round = 0; round < rounds; round++) {
    const next: [number, number][] = [];
    for (let i = 0; i < line.length; i++) {
      const [a, b] = [line[i]!, line[(i + 1) % line.length]!];
      next.push(
        [a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
        [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75],
      );
    }
    line = next;
  }
  return line;
}

/** Die Umrisse eines Geländes im Raster – in Karteneinheiten. */
export function outlinesOf(raster: Raster, ground: MapGround): Outline[] {
  const { grid, cols, rows, step } = raster;
  const value = index(ground);
  // Ein Rand aus Nullen rundherum schließt jede Fläche, auch die, die an den Kartenrand stößt.
  const [width, height] = [cols + 2, rows + 2];
  const field = new Float32Array(width * height);
  let any = false;
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++)
      if (grid[j * cols + i] === value) {
        field[(j + 1) * width + i + 1] = 1;
        any = true;
      }
  if (!any) return [];
  return contour(blur(field, width, height, 1), width, height, 0.5).map((line) => {
    // Wo eine Fläche an den Kartenrand stößt, läuft ihr Umriss weit außerhalb weiter – so
    // zeichnet der Rand des Blattes keine Küste und keine Felswand.
    const [right, bottom] = [(cols - 1) * step, (rows - 1) * step];
    const out = (value: number, limit: number) =>
      value < step * 0.6 ? -OUTSIDE : value > limit - step * 0.6 ? limit + OUTSIDE : value;
    const points = smooth(
      line.map(([x, y]): [number, number] => [(x - 1) * step, (y - 1) * step]),
      2,
    ).map(([x, y]): [number, number] => [out(x, right), out(y, bottom)]);
    const box: Outline['box'] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of points) {
      box[0] = Math.min(box[0], x);
      box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x);
      box[3] = Math.max(box[3], y);
    }
    return { points, box };
  });
}

/** Weite des Rasters je Zeichen: Gipfel stehen weiter auseinander als Bäume. */
const SPACING: Record<Symbol, number> = {
  tree: 14,
  hill: 27,
  peak: 25,
  reed: 23,
  dune: 28,
  mushroom: 15,
  stone: 22,
};

/**
 * Wo die Zeichen stehen: je Zeichen ein festes Raster, in jedem Feld leicht versetzt – und immer
 * gleich für dieselbe Karte, damit beim Zoomen und Wiederkommen nichts springt.
 */
export function sitesOf(map: Pick<GameMap, 'id' | 'frame'>, raster: Raster): Site[] {
  const frame = map.frame;
  if (!frame) return [];
  const present = new Set<Symbol>();
  for (const value of new Set(raster.grid)) {
    const symbol = GROUNDS[MAP_GROUNDS[value]!].symbol;
    if (symbol) present.add(symbol);
  }
  const sites: Site[] = [];
  for (const symbol of present) {
    const cell = SPACING[symbol];
    for (let row = 0; row * cell < frame.height; row++)
      for (let column = 0; column * cell < frame.width; column++) {
        const rng = rngOf(seedOf(map.id, symbol, column, row));
        const x = (column + 0.12 + 0.76 * rng.next()) * cell;
        const y = (row + 0.12 + 0.76 * rng.next()) * cell;
        const roll = rng.next();
        if (x > frame.width || y > frame.height) continue;
        // Ein Stück unterhalb muss dasselbe Gelände liegen: Der Fuß des Zeichens steht darin.
        if (GROUNDS[rasterAt(raster, x, y)].symbol !== symbol) continue;
        if (GROUNDS[rasterAt(raster, x, y - cell * 0.3)].symbol !== symbol && roll < 0.5) continue;
        sites.push({ x, y, symbol, spread: cell, roll });
      }
  }
  // Von oben nach unten: Was weiter vorn steht, verdeckt, was dahinter liegt.
  return sites.sort((a, b) => a.y - b.y);
}

/** Alles, was der Zeichner von einer Karte braucht. */
export function shapesOf(map: GameMap): Shapes {
  if (!map.frame) return { areas: {}, sites: [] };
  const raster = rasterize(map);
  const areas: Shapes['areas'] = {};
  for (const value of new Set(raster.grid)) {
    const ground = MAP_GROUNDS[value]!;
    areas[ground] = outlinesOf(raster, ground);
  }
  return { areas, sites: sitesOf(map, raster) };
}
