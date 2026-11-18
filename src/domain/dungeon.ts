/**
 * Dungeons (Wunsch des Spielleiters, 18. 11. 2026: „ein funktionierender Map-Editor, wo wir einen
 * Dungeon bauen können. Fallen, Türen, Wände, Geheimtüren, Geheimgänge, Etagenwechsel mit
 * Funktionen“). Ein Dungeon ist jeder Ort mit Räumen und Ebenen; jede Ebene ist ein Raster aus
 * Feldern von fünf Fuß.
 *
 * Das Raster ist nicht nur ein Bild: Ein Feld ist Boden oder Fels, Räume sind Flächen, und was
 * zwischen zwei Feldern liegt, sagt einzig `edgeBetween` – eingetragen (Tür, Geheimtür, Gitter,
 * Durchgang, Wand) oder von selbst: Zwischen Räumen und um Geheimgänge steht eine Wand. Alles hier
 * ist reine Rechnung; geändert wird über `features/dungeons/actions.ts`.
 */
import {
  DungeonEdgeSchema,
  DungeonLevelSchema,
  DungeonMarkerSchema,
  DungeonStairSchema,
  DungeonTrapSchema,
  newId,
  type Dungeon,
  type DungeonCell,
  type DungeonEdge,
  type DungeonEdgeKind,
  type DungeonLevel,
  type DungeonMarker,
  type DungeonRoom,
  type DungeonSave,
  type DungeonStair,
  type DungeonStairKind,
  type DungeonThing,
  type DungeonTile,
  type DungeonTrap,
} from './schema';

// ── Felder und Kanten ──────────────────────────────────────────────────────

export const cellKey = (x: number, y: number): string => `${x},${y}`;
export const keyOf = (cell: DungeonCell): string => cellKey(cell.x, cell.y);
export const sameCell = (a: DungeonCell, b: DungeonCell): boolean => a.x === b.x && a.y === b.y;

export function cellOfKey(key: string): DungeonCell {
  const [x, y] = key.split(',');
  return { x: Number(x), y: Number(y) };
}

/** Die vier Seiten eines Feldes. */
export type Side = 'n' | 'e' | 's' | 'w';
export const SIDES: readonly Side[] = ['n', 'e', 's', 'w'];
const STEP: Record<Side, DungeonCell> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

export const neighbour = (cell: DungeonCell, side: Side): DungeonCell => ({
  x: cell.x + STEP[side].x,
  y: cell.y + STEP[side].y,
});

/**
 * Der Schlüssel einer Kante: „x,y,n“ ist die obere Kante des Feldes, „x,y,w“ die linke. Die
 * untere und die rechte gehören dem Nachbarn – so hat jede Kante genau einen Schlüssel.
 */
export function edgeKey(cell: DungeonCell, side: Side): string {
  if (side === 'n') return `${cell.x},${cell.y},n`;
  if (side === 'w') return `${cell.x},${cell.y},w`;
  if (side === 's') return `${cell.x},${cell.y + 1},n`;
  return `${cell.x + 1},${cell.y},w`;
}

/** Die beiden Felder an einer Kante: `a` liegt oben bzw. links, `b` unten bzw. rechts. */
export function cellsOfEdge(key: string): { a: DungeonCell; b: DungeonCell; side: 'n' | 'w' } {
  const [x, y, side] = key.split(',');
  const b = { x: Number(x), y: Number(y) };
  return side === 'n'
    ? { a: { x: b.x, y: b.y - 1 }, b, side: 'n' }
    : { a: { x: b.x - 1, y: b.y }, b, side: 'w' };
}

/** Die Kante zwischen zwei Nachbarfeldern; null, wenn sie nicht nebeneinander liegen. */
export function edgeKeyBetween(a: DungeonCell, b: DungeonCell): string | null {
  const side = SIDES.find((s) => sameCell(neighbour(a, s), b));
  return side ? edgeKey(a, side) : null;
}

export const tileAt = (level: DungeonLevel, cell: DungeonCell): DungeonTile | null =>
  level.tiles[keyOf(cell)] ?? null;
export const isFloor = (level: DungeonLevel, cell: DungeonCell): boolean =>
  level.tiles[keyOf(cell)] !== undefined;
export const roomAt = (level: DungeonLevel, cell: DungeonCell): string | null =>
  level.roomOf[keyOf(cell)] ?? null;

/** Was zwischen zwei Nachbarfeldern liegt. */
export type Between =
  /** Beides Fels – dort ist nichts. */
  | 'none'
  /** Boden an Fels. */
  | 'rock'
  | DungeonEdgeKind;

export interface EdgeView {
  kind: Between;
  /** Der Eintrag, wenn die Kante eingetragen ist. */
  edge: DungeonEdge | null;
  /** Von selbst entstanden: Wand zwischen Räumen oder um einen Geheimgang. */
  implied: boolean;
}

/**
 * Was zwischen zwei Nachbarfeldern liegt. Eingetragenes gilt; sonst steht zwischen zwei Räumen,
 * zwischen Raum und Gang und um jeden Geheimgang von selbst eine Wand, alles Übrige ist offen.
 */
export function edgeBetween(level: DungeonLevel, a: DungeonCell, b: DungeonCell): EdgeView {
  const key = edgeKeyBetween(a, b);
  const edge = key ? (level.edges[key] ?? null) : null;
  const ta = tileAt(level, a);
  const tb = tileAt(level, b);
  if (!ta && !tb) return { kind: 'none', edge: null, implied: false };
  if (!ta || !tb) {
    // Eine Tür in den Fels bleibt stehen – der Spielleiter gräbt vielleicht noch dahinter.
    if (edge && edge.kind !== 'wall' && edge.kind !== 'open')
      return { kind: edge.kind, edge, implied: false };
    return { kind: 'rock', edge: null, implied: false };
  }
  if (edge) return { kind: edge.kind, edge, implied: false };
  const walled = roomAt(level, a) !== roomAt(level, b) || (ta === 'secret') !== (tb === 'secret');
  return { kind: walled ? 'wall' : 'open', edge: null, implied: walled };
}

/** Kommt man von einem Feld ins Nachbarfeld? Geheimtüren nur, wenn `secrets` gilt. */
export function canPass(
  level: DungeonLevel,
  a: DungeonCell,
  b: DungeonCell,
  options: { secrets?: boolean } = {},
): boolean {
  const { kind } = edgeBetween(level, a, b);
  const walk = isWalkable(tileAt(level, a)) && isWalkable(tileAt(level, b));
  if (kind === 'open' || kind === 'door' || kind === 'gate' || kind === 'curtain') return walk;
  if (kind === 'secret') return !!options.secrets && walk;
  return false;
}

/** Kann man auf dem Feld stehen? Abgrund und Luftraum nicht – dort fällt man. */
export const isWalkable = (tile: DungeonTile | null): boolean =>
  tile !== null && tile !== 'chasm' && tile !== 'air';

// ── Zeichnen: was der Editor und später das Brett zeigen ───────────────────

export interface EdgeSegment {
  key: string;
  /** Anfang und Ende in Feldkoordinaten (Ecken des Rasters). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: Exclude<Between, 'none'>;
  edge: DungeonEdge | null;
  implied: boolean;
}

/** Jede Kante der Ebene, an der etwas zu zeichnen ist – einmal je Kante. */
export function edgeSegments(level: DungeonLevel): EdgeSegment[] {
  const keys = new Set<string>();
  for (const key of Object.keys(level.tiles)) {
    const cell = cellOfKey(key);
    for (const side of SIDES) keys.add(edgeKey(cell, side));
  }
  for (const key of Object.keys(level.edges)) keys.add(key);
  const out: EdgeSegment[] = [];
  for (const key of keys) {
    const { a, b, side } = cellsOfEdge(key);
    const view = edgeBetween(level, a, b);
    if (view.kind === 'none') continue;
    // Offenes ohne Eintrag ist keine Linie.
    if (view.kind === 'open' && !view.edge) continue;
    out.push({
      key,
      x1: b.x,
      y1: b.y,
      x2: side === 'n' ? b.x + 1 : b.x,
      y2: side === 'n' ? b.y : b.y + 1,
      kind: view.kind,
      edge: view.edge,
      implied: view.implied,
    });
  }
  return out;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Der Rahmen um alles, was auf der Ebene liegt; null, wenn sie leer ist. */
export function levelBounds(level: DungeonLevel): Bounds | null {
  const cells = [
    ...Object.keys(level.tiles).map(cellOfKey),
    ...level.stairs,
    ...level.markers,
    ...level.traps.flatMap((trap) => trap.cells),
  ];
  if (cells.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of cells) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

// ── Formen zum Malen ───────────────────────────────────────────────────────

/** Alle Felder eines Rechtecks zwischen zwei Ecken. */
export function rectCells(a: DungeonCell, b: DungeonCell): DungeonCell[] {
  const out: DungeonCell[] = [];
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++)
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) out.push({ x, y });
  return out;
}

/** Die Felder unter einem Pinsel der Größe 1–5 (ein Quadrat um das Feld). */
export function brushCells(center: DungeonCell, size: number): DungeonCell[] {
  const s = Math.max(1, Math.min(5, Math.round(size)));
  const from = -Math.floor((s - 1) / 2);
  const out: DungeonCell[] = [];
  for (let dy = 0; dy < s; dy++)
    for (let dx = 0; dx < s; dx++) out.push({ x: center.x + from + dx, y: center.y + from + dy });
  return out;
}

/**
 * Der Weg von einem Feld zum anderen in Schritten über Kanten (nie diagonal) – so reißt ein
 * schneller Strich nicht ab, und ein Gang hängt immer zusammen. Das Startfeld gehört dazu.
 */
export function lineCells(from: DungeonCell, to: DungeonCell): DungeonCell[] {
  const out: DungeonCell[] = [{ ...from }];
  let { x, y } = from;
  const dx = Math.abs(to.x - x);
  const dy = Math.abs(to.y - y);
  const sx = to.x > x ? 1 : -1;
  const sy = to.y > y ? 1 : -1;
  let ix = 0;
  let iy = 0;
  while (ix < dx || iy < dy) {
    // Der Schritt, der näher an der geraden Linie bleibt.
    if ((0.5 + ix) / Math.max(dx, 1e-9) < (0.5 + iy) / Math.max(dy, 1e-9) && ix < dx) {
      x += sx;
      ix++;
    } else if (iy < dy) {
      y += sy;
      iy++;
    } else {
      x += sx;
      ix++;
    }
    out.push({ x, y });
  }
  return out;
}

// ── Ebene ändern ───────────────────────────────────────────────────────────

/** Räumt auf, was nach einer Änderung in der Luft hängt. */
function tidy(level: DungeonLevel): DungeonLevel {
  const roomOf: Record<string, string> = {};
  const used = new Set<string>();
  for (const [key, roomId] of Object.entries(level.roomOf)) {
    if (level.tiles[key] === undefined) continue;
    roomOf[key] = roomId;
    used.add(roomId);
  }
  const edges: Record<string, DungeonEdge> = {};
  for (const [key, edge] of Object.entries(level.edges)) {
    const { a, b } = cellsOfEdge(key);
    const fa = level.tiles[keyOf(a)] !== undefined;
    const fb = level.tiles[keyOf(b)] !== undefined;
    if (!fa && !fb) continue;
    // Eine Wand oder ein Durchgang am Fels sagt nichts.
    if ((!fa || !fb) && (edge.kind === 'wall' || edge.kind === 'open')) continue;
    edges[key] = edge;
  }
  return { ...level, roomOf, edges, rooms: level.rooms.filter((room) => used.has(room.id)) };
}

/**
 * Malt Felder: `tile` setzt, was sie sind (ein Raum bleibt, wie er war), null macht sie zu Fels –
 * mit allem, was darauf lag (Fallen verlieren diese Felder, Etagenwechsel und Markierungen gehen).
 */
export function paintTiles(
  level: DungeonLevel,
  cells: readonly DungeonCell[],
  tile: DungeonTile | null,
): DungeonLevel {
  if (cells.length === 0) return level;
  const tiles = { ...level.tiles };
  let changed = false;
  for (const cell of cells) {
    const key = keyOf(cell);
    if (tile === null) {
      if (tiles[key] !== undefined) {
        delete tiles[key];
        changed = true;
      }
    } else if (tiles[key] !== tile) {
      tiles[key] = tile;
      changed = true;
    }
  }
  if (!changed) return level;
  if (tile !== null) return { ...level, tiles };
  const gone = new Set(cells.map(keyOf));
  const stairs = level.stairs.filter((stair) => !gone.has(keyOf(stair)));
  return tidy({
    ...level,
    tiles,
    traps: level.traps
      .map((trap) => ({
        ...trap,
        cells: trap.cells.filter((cell) => !gone.has(keyOf(cell))),
        spots: trap.spots.filter((cell) => !gone.has(keyOf(cell))),
      }))
      .filter((trap) => trap.cells.length > 0),
    stairs,
    markers: level.markers.filter((marker) => !gone.has(keyOf(marker))),
  });
}

/**
 * Ein Strich mit dem Boden-Pinsel entlang eines Weges von Feld zu Feld. Führt er durch eine Wand,
 * die von selbst dasteht (in einen Raum, aus einem Geheimgang), entsteht dort ein Durchgang – bei
 * einem Geheimgang eine Geheimtür. So hängt, was man zieht, auch zusammen.
 */
export function digPath(
  level: DungeonLevel,
  path: readonly DungeonCell[],
  tile: DungeonTile,
  size = 1,
): DungeonLevel {
  let next = level;
  for (let i = 0; i < path.length; i++) {
    const cells = brushCells(path[i]!, size);
    next = paintTiles(next, cells, tile);
    const before = path[i - 1];
    if (!before || sameCell(before, path[i]!)) continue;
    // Ein breiter Gang öffnet sich auf ganzer Breite: jede Spur für sich.
    const lanes = brushCells(before, size);
    for (let lane = 0; lane < cells.length; lane++) {
      const from = lanes[lane]!;
      const to = cells[lane]!;
      const view = edgeBetween(next, from, to);
      if (view.kind !== 'wall' || !view.implied) continue;
      const key = edgeKeyBetween(from, to);
      if (!key) continue;
      const secret = tileAt(next, from) === 'secret' || tileAt(next, to) === 'secret';
      next = setEdge(next, key, { kind: secret ? 'secret' : 'open' });
    }
  }
  return next;
}

/** Der nächste freie Name „Raum N“ einer Ebene. */
export function nextRoomName(level: DungeonLevel): string {
  const taken = new Set(level.rooms.map((room) => room.name.trim().toLowerCase()));
  for (let n = level.rooms.length + 1; ; n++) if (!taken.has(`raum ${n}`)) return `Raum ${n}`;
}

/**
 * Zieht einen Raum auf: Die Felder werden Boden (was schon Boden war, bleibt, was es ist) und
 * gehören dem neuen Raum. Wände zu allem ringsum stehen von selbst.
 */
export function addRoom(
  level: DungeonLevel,
  cells: readonly DungeonCell[],
  name?: string,
  init: Partial<Pick<DungeonRoom, 'round' | 'spanId' | 'note'>> & { tile?: DungeonTile } = {},
): { level: DungeonLevel; room: DungeonRoom } {
  const room: DungeonRoom = {
    id: newId(),
    name: name?.trim() || nextRoomName(level),
    note: init.note ?? '',
    round: init.round ?? null,
    spanId: init.spanId ?? null,
  };
  const fresh = cells.filter((cell) => !isFloor(level, cell));
  const painted = paintTiles(level, fresh, init.tile ?? 'floor');
  const roomOf = { ...painted.roomOf };
  for (const cell of cells) roomOf[keyOf(cell)] = room.id;
  return { level: tidy({ ...painted, roomOf, rooms: [...painted.rooms, room] }), room };
}

/** Schlägt Bodenfelder einem Raum zu oder nimmt sie heraus (null). Fels bleibt Fels. */
export function assignRoom(
  level: DungeonLevel,
  cells: readonly DungeonCell[],
  roomId: string | null,
): DungeonLevel {
  if (roomId && !level.rooms.some((room) => room.id === roomId)) return level;
  const roomOf = { ...level.roomOf };
  let changed = false;
  for (const cell of cells) {
    const key = keyOf(cell);
    if (level.tiles[key] === undefined) continue;
    if (roomId === null) {
      if (roomOf[key] !== undefined) {
        delete roomOf[key];
        changed = true;
      }
    } else if (roomOf[key] !== roomId) {
      roomOf[key] = roomId;
      changed = true;
    }
  }
  return changed ? tidy({ ...level, roomOf }) : level;
}

export function patchRoom(
  level: DungeonLevel,
  roomId: string,
  change: Partial<Pick<DungeonRoom, 'name' | 'note'>>,
): DungeonLevel {
  return {
    ...level,
    rooms: level.rooms.map((room) => (room.id === roomId ? { ...room, ...change } : room)),
  };
}

/** Löst einen Raum auf: Der Boden bleibt, er gehört nur keinem Raum mehr. */
export function dissolveRoom(level: DungeonLevel, roomId: string): DungeonLevel {
  const roomOf = Object.fromEntries(Object.entries(level.roomOf).filter(([, id]) => id !== roomId));
  return { ...level, roomOf, rooms: level.rooms.filter((room) => room.id !== roomId) };
}

export const roomCells = (level: DungeonLevel, roomId: string): DungeonCell[] =>
  Object.entries(level.roomOf)
    .filter(([, id]) => id === roomId)
    .map(([key]) => cellOfKey(key));

/**
 * Wo der Name eines Raums steht: das Feld des Raums, das seiner Mitte am nächsten liegt – so
 * steht er auch bei einem L-förmigen Raum auf dessen Boden.
 */
export function roomAnchor(cells: readonly DungeonCell[]): DungeonCell | null {
  if (cells.length === 0) return null;
  const cx = cells.reduce((sum, cell) => sum + cell.x, 0) / cells.length;
  const cy = cells.reduce((sum, cell) => sum + cell.y, 0) / cells.length;
  let best = cells[0]!;
  let bestDist = Infinity;
  for (const cell of cells) {
    const dist = (cell.x - cx) ** 2 + (cell.y - cy) ** 2;
    if (dist < bestDist) {
      best = cell;
      bestDist = dist;
    }
  }
  return best;
}

/** Trägt an einer Kante etwas ein (fehlende Angaben nach Vorgabe) oder nimmt den Eintrag weg (null). */
export function setEdge(
  level: DungeonLevel,
  key: string,
  edge: (Partial<DungeonEdge> & { kind: DungeonEdgeKind }) | null,
): DungeonLevel {
  const edges = { ...level.edges };
  if (edge === null) {
    if (edges[key] === undefined) return level;
    delete edges[key];
    return { ...level, edges };
  }
  edges[key] = DungeonEdgeSchema.parse({ ...edges[key], ...edge });
  return tidy({ ...level, edges });
}

export function patchEdge(
  level: DungeonLevel,
  key: string,
  change: Partial<DungeonEdge>,
): DungeonLevel {
  const edge = level.edges[key];
  if (!edge) return level;
  return {
    ...level,
    edges: { ...level.edges, [key]: DungeonEdgeSchema.parse({ ...edge, ...change }) },
  };
}

// ── Breite Türen ───────────────────────────────────────────────────────────

/**
 * Die Kanten, die mit dieser zusammen eine Öffnung bilden: gleiche Art, in einer Linie, ohne
 * Lücke. Zwei Türen nebeneinander sind eine Doppeltür, drei Durchgänge ein breiter Durchgang.
 * Wände gehören nie zusammen. Geordnet von oben bzw. links.
 */
export function edgeRun(level: DungeonLevel, key: string): string[] {
  const edge = level.edges[key];
  if (!edge || edge.kind === 'wall') return [key];
  const [x, y, side] = key.split(',');
  const at = (step: number) =>
    side === 'n' ? `${Number(x) + step},${y},n` : `${x},${Number(y) + step},w`;
  const run = [key];
  for (let step = -1; level.edges[at(step)]?.kind === edge.kind; step--) run.unshift(at(step));
  for (let step = 1; level.edges[at(step)]?.kind === edge.kind; step++) run.push(at(step));
  return run;
}

/** Ändert eine Öffnung auf ganzer Breite – eine Doppeltür ist eine Tür. */
export function patchEdgeRun(
  level: DungeonLevel,
  key: string,
  change: Partial<DungeonEdge>,
): DungeonLevel {
  return edgeRun(level, key).reduce((lv, k) => patchEdge(lv, k, change), level);
}

/** Nimmt eine Öffnung auf ganzer Breite weg. */
export function removeEdgeRun(level: DungeonLevel, key: string): DungeonLevel {
  return edgeRun(level, key).reduce((lv, k) => setEdge(lv, k, null), level);
}

/** Der Name einer Öffnung: zwei Türen nebeneinander sind eine „Doppeltür“. */
export function edgeName(kind: DungeonEdgeKind, width: number): string {
  if (width < 2) return EDGE_LABEL[kind];
  if (kind === 'door') return width === 2 ? 'Doppeltür' : 'Breites Tor';
  if (kind === 'open') return 'Breiter Durchgang';
  return EDGE_LABEL[kind];
}

// ── Runde Räume ────────────────────────────────────────────────────────────

export interface RoundShape {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Das Rechteck zwischen zwei Ecken als Form eines runden Raums. */
export const roundBetween = (a: DungeonCell, b: DungeonCell): RoundShape => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(a.x - b.x) + 1,
  h: Math.abs(a.y - b.y) + 1,
});

/** Die Felder eines runden Raums: jedes, dessen Mitte in der Ellipse liegt. */
export function roundCells(shape: RoundShape): DungeonCell[] {
  const rx = shape.w / 2;
  const ry = shape.h / 2;
  const out: DungeonCell[] = [];
  for (let j = 0; j < shape.h; j++)
    for (let i = 0; i < shape.w; i++) {
      const dx = (i + 0.5 - rx) / rx;
      const dy = (j + 0.5 - ry) / ry;
      if (dx * dx + dy * dy <= 1) out.push({ x: shape.x + i, y: shape.y + j });
    }
  return out;
}

/**
 * Die runde Form eines Raums – nur, solange seine Felder genau die der Ellipse sind. Wurde an
 * ihm gemalt oder genommen, ist er ein eckiger Raum wie jeder andere.
 */
export function roundOf(level: DungeonLevel, room: DungeonRoom): RoundShape | null {
  if (!room.round) return null;
  const cells = roundCells(room.round);
  const own = roomCells(level, room.id);
  if (cells.length !== own.length) return null;
  return cells.every((cell) => level.roomOf[keyOf(cell)] === room.id) ? room.round : null;
}

// ── Räume verschieben ──────────────────────────────────────────────────────

const shiftKey = (key: string, dx: number, dy: number): string => {
  const [x, y, side] = key.split(',');
  return side === undefined
    ? `${Number(x) + dx},${Number(y) + dy}`
    : `${Number(x) + dx},${Number(y) + dy},${side}`;
};

/**
 * Verschiebt einen Raum mit allem, was dazugehört: Boden, Türen und Wände an seinen Feldern,
 * Fallen, Etagenwechsel, Einrichtung. Liegt am Ziel schon anderer Boden, geschieht nichts (null).
 */
export function moveRoom(
  level: DungeonLevel,
  roomId: string,
  dx: number,
  dy: number,
): DungeonLevel | null {
  if (dx === 0 && dy === 0) return level;
  const own = roomCells(level, roomId);
  if (own.length === 0) return null;
  const ownKeys = new Set(own.map(keyOf));
  const moved = (cell: DungeonCell): DungeonCell => ({ x: cell.x + dx, y: cell.y + dy });
  for (const cell of own) {
    const key = keyOf(moved(cell));
    if (!ownKeys.has(key) && level.tiles[key] !== undefined) return null;
  }
  const tiles = { ...level.tiles };
  const roomOf = { ...level.roomOf };
  for (const key of ownKeys) {
    delete tiles[key];
    delete roomOf[key];
  }
  for (const cell of own) {
    const key = keyOf(moved(cell));
    tiles[key] = level.tiles[keyOf(cell)]!;
    roomOf[key] = roomId;
  }
  const edges: Record<string, DungeonEdge> = {};
  const carried: [string, DungeonEdge][] = [];
  for (const [key, edge] of Object.entries(level.edges)) {
    const { a, b } = cellsOfEdge(key);
    if (ownKeys.has(keyOf(a)) || ownKeys.has(keyOf(b))) carried.push([shiftKey(key, dx, dy), edge]);
    else edges[key] = edge;
  }
  for (const [key, edge] of carried) edges[key] = edge;
  const inRoom = (cell: DungeonCell) => ownKeys.has(keyOf(cell));
  const shift = <T extends DungeonCell>(thing: T): T =>
    inRoom(thing) ? { ...thing, ...moved(thing) } : thing;
  return tidy({
    ...level,
    tiles,
    roomOf,
    edges,
    rooms: level.rooms.map((room) =>
      room.id === roomId && room.round
        ? { ...room, round: { ...room.round, x: room.round.x + dx, y: room.round.y + dy } }
        : room,
    ),
    traps: level.traps.map((trap) => ({
      ...trap,
      cells: trap.cells.map(shift),
      spots: trap.spots.map(shift),
    })),
    stairs: level.stairs.map(shift),
    markers: level.markers.map(shift),
  });
}

// ── Räume über mehrere Ebenen ──────────────────────────────────────────────

/** Die Ebene gleich darüber oder darunter; null, wenn es keine gibt. */
export function levelBeside(
  dungeon: Pick<Dungeon, 'levels'>,
  levelId: string,
  dir: 'up' | 'down',
): DungeonLevel | null {
  const sorted = levelsSorted(dungeon);
  const index = sorted.findIndex((level) => level.id === levelId);
  return index < 0 ? null : (sorted[dir === 'up' ? index - 1 : index + 1] ?? null);
}

/** Derselbe Raum auf den anderen Ebenen, von oben nach unten. */
export function roomSpan(
  dungeon: Pick<Dungeon, 'levels'>,
  room: DungeonRoom,
): { level: DungeonLevel; room: DungeonRoom }[] {
  if (!room.spanId) return [];
  return levelsSorted(dungeon).flatMap((level) =>
    level.rooms
      .filter((other) => other.spanId === room.spanId && other.id !== room.id)
      .map((other) => ({ level, room: other })),
  );
}

/**
 * Setzt einen Raum auf der Ebene darüber oder darunter fort – dieselbe Fläche, derselbe Raum.
 * Darüber entsteht Luftraum (man sieht hinab; eine Galerie malt der Spielleiter als Boden hinein),
 * darunter Boden. Gibt es die Ebene noch nicht, entsteht sie. Was dort schon Boden ist, bleibt.
 */
export function extendRoom<D extends Pick<Dungeon, 'levels'>>(
  dungeon: D,
  levelId: string,
  roomId: string,
  dir: 'up' | 'down',
): { dungeon: D; levelId: string; roomId: string } | null {
  const level = levelOf(dungeon, levelId);
  const room = level?.rooms.find((r) => r.id === roomId);
  if (!level || !room) return null;
  const cells = roomCells(level, roomId);
  if (cells.length === 0) return null;
  let next = dungeon;
  let target = levelBeside(next, levelId, dir);
  if (!target) {
    const made = addLevel(next, dir === 'up' ? 'above' : 'below');
    next = made.dungeon;
    target = made.level;
  }
  const spanId = room.spanId ?? newId();
  const targetId = target.id;
  let newRoomId = '';
  next = withLevel(next, levelId, (lv) => ({
    ...lv,
    rooms: lv.rooms.map((r) => (r.id === roomId ? { ...r, spanId } : r)),
  }));
  next = withLevel(next, targetId, (lv) => {
    const made = addRoom(lv, cells, room.name, {
      round: roundOf(level, room),
      spanId,
      note: room.note,
      tile: dir === 'up' ? 'air' : 'floor',
    });
    newRoomId = made.room.id;
    return made.level;
  });
  return { dungeon: next, levelId: targetId, roomId: newRoomId };
}

/** Name und Notiz eines Raums ändern – auf allen Ebenen, über die er reicht. */
export function patchRoomEverywhere<D extends Pick<Dungeon, 'levels'>>(
  dungeon: D,
  levelId: string,
  roomId: string,
  change: Partial<Pick<DungeonRoom, 'name' | 'note'>>,
): D {
  const room = levelOf(dungeon, levelId)?.rooms.find((r) => r.id === roomId);
  if (!room) return dungeon;
  let next = withLevel(dungeon, levelId, (lv) => patchRoom(lv, roomId, change));
  for (const other of roomSpan(dungeon, room))
    next = withLevel(next, other.level.id, (lv) => patchRoom(lv, other.room.id, change));
  return next;
}

// ── Fallen ─────────────────────────────────────────────────────────────────

export const trapAt = (level: DungeonLevel, cell: DungeonCell): DungeonTrap | null =>
  level.traps.find((trap) => trap.cells.some((c) => sameCell(c, cell))) ?? null;

export function addTrap(
  level: DungeonLevel,
  cell: DungeonCell,
): { level: DungeonLevel; trap: DungeonTrap } {
  const trap = DungeonTrapSchema.parse({ id: newId(), cells: [cell] });
  return { level: { ...level, traps: [...level.traps, trap] }, trap };
}

export function patchTrap(
  level: DungeonLevel,
  trapId: string,
  change: Partial<Omit<DungeonTrap, 'id'>>,
): DungeonLevel {
  return {
    ...level,
    traps: level.traps.map((trap) =>
      trap.id === trapId ? DungeonTrapSchema.parse({ ...trap, ...change }) : trap,
    ),
  };
}

export const removeTrap = (level: DungeonLevel, trapId: string): DungeonLevel => ({
  ...level,
  traps: level.traps.filter((trap) => trap.id !== trapId),
});

/** Nimmt ein Feld in eine Liste von Feldern auf oder heraus. */
export function toggleCell(cells: readonly DungeonCell[], cell: DungeonCell): DungeonCell[] {
  return cells.some((c) => sameCell(c, cell))
    ? cells.filter((c) => !sameCell(c, cell))
    : [...cells, cell];
}

/** So weit ringsum ist eine Falle zu bemerken, wenn der Spielleiter keine Felder gewählt hat. */
export const TRAP_SPOT_RANGE = 2;

/**
 * Von wo eine Falle zu bemerken ist: die gewählten Felder, sonst der Boden bis zwei Felder (zehn
 * Fuß) um ihre Auslöser.
 */
export function trapSpots(level: DungeonLevel, trap: DungeonTrap): DungeonCell[] {
  if (trap.spots.length > 0) return trap.spots;
  const seen = new Map<string, DungeonCell>();
  for (const cell of trap.cells)
    for (let dy = -TRAP_SPOT_RANGE; dy <= TRAP_SPOT_RANGE; dy++)
      for (let dx = -TRAP_SPOT_RANGE; dx <= TRAP_SPOT_RANGE; dx++) {
        const spot = { x: cell.x + dx, y: cell.y + dy };
        if (isFloor(level, spot)) seen.set(keyOf(spot), spot);
      }
  return [...seen.values()];
}

export const SAVE_LABEL: Record<DungeonSave, string> = {
  none: 'kein Rettungswurf',
  str: 'Stärke',
  dex: 'Geschicklichkeit',
  con: 'Konstitution',
  int: 'Intelligenz',
  wis: 'Weisheit',
  cha: 'Charisma',
};

/** Eine Falle in einer Zeile: „Bemerken SG 15 · Geschicklichkeit SG 13 · 2W10 Stich“. */
export function trapLine(trap: DungeonTrap): string {
  return [
    trap.findDc !== null && `Bemerken SG ${trap.findDc}`,
    trap.disarmDc !== null && `Entschärfen SG ${trap.disarmDc}`,
    trap.save !== 'none' &&
      `${SAVE_LABEL[trap.save]}${trap.saveDc !== null ? ` SG ${trap.saveDc}` : ''}`,
    trap.damage.trim(),
  ]
    .filter(Boolean)
    .join(' · ');
}

// ── Markierungen ───────────────────────────────────────────────────────────

export const markerAt = (level: DungeonLevel, cell: DungeonCell): DungeonMarker | null =>
  level.markers.find((marker) => sameCell(marker, cell)) ?? null;

export function addMarker(
  level: DungeonLevel,
  cell: DungeonCell,
  kind: DungeonThing = 'note',
): { level: DungeonLevel; marker: DungeonMarker } {
  const marker = DungeonMarkerSchema.parse({ id: newId(), ...cell, kind });
  return { level: { ...level, markers: [...level.markers, marker] }, marker };
}

export function patchMarker(
  level: DungeonLevel,
  markerId: string,
  change: Partial<Omit<DungeonMarker, 'id'>>,
): DungeonLevel {
  return {
    ...level,
    markers: level.markers.map((marker) =>
      marker.id === markerId ? { ...marker, ...change } : marker,
    ),
  };
}

export const removeMarker = (level: DungeonLevel, markerId: string): DungeonLevel => ({
  ...level,
  markers: level.markers.filter((marker) => marker.id !== markerId),
});

// ── Ebenen ─────────────────────────────────────────────────────────────────

/** Die Ebenen von oben nach unten. */
export const levelsSorted = (dungeon: Pick<Dungeon, 'levels'>): DungeonLevel[] =>
  [...dungeon.levels].sort((a, b) => b.order - a.order);

export const levelOf = (dungeon: Pick<Dungeon, 'levels'>, levelId: string): DungeonLevel | null =>
  dungeon.levels.find((level) => level.id === levelId) ?? null;

/** Ändert eine Ebene; gibt es sie nicht, bleibt der Dungeon, wie er ist. */
export function withLevel<D extends Pick<Dungeon, 'levels'>>(
  dungeon: D,
  levelId: string,
  change: (level: DungeonLevel) => DungeonLevel,
): D {
  let changed = false;
  const levels = dungeon.levels.map((level) => {
    if (level.id !== levelId) return level;
    const next = change(level);
    if (next !== level) changed = true;
    return next;
  });
  return changed ? { ...dungeon, levels } : dungeon;
}

/** Der nächste freie Name „Ebene N“. */
function nextLevelName(dungeon: Pick<Dungeon, 'levels'>): string {
  const taken = new Set(dungeon.levels.map((level) => level.name.trim().toLowerCase()));
  for (let n = dungeon.levels.length + 1; ; n++) if (!taken.has(`ebene ${n}`)) return `Ebene ${n}`;
}

/** Eine neue leere Ebene über oder unter allen anderen. */
export function addLevel<D extends Pick<Dungeon, 'levels'>>(
  dungeon: D,
  where: 'above' | 'below',
  name?: string,
): { dungeon: D; level: DungeonLevel } {
  const orders = dungeon.levels.map((level) => level.order);
  const order =
    orders.length === 0 ? 0 : where === 'above' ? Math.max(...orders) + 1 : Math.min(...orders) - 1;
  const level = DungeonLevelSchema.parse({
    id: newId(),
    name: name?.trim() || nextLevelName(dungeon),
    order,
  });
  return { dungeon: { ...dungeon, levels: [...dungeon.levels, level] }, level };
}

/** Tauscht eine Ebene mit der über oder unter ihr. Etagenwechsel zeigen danach neu hinauf oder hinab. */
export function moveLevel<D extends Pick<Dungeon, 'levels'>>(
  dungeon: D,
  levelId: string,
  dir: 'up' | 'down',
): D {
  const sorted = levelsSorted(dungeon);
  const index = sorted.findIndex((level) => level.id === levelId);
  const other = sorted[dir === 'up' ? index - 1 : index + 1];
  const self = sorted[index];
  if (!self || !other) return dungeon;
  const levels = dungeon.levels.map((level) =>
    level.id === self.id
      ? { ...level, order: other.order }
      : level.id === other.id
        ? { ...level, order: self.order }
        : level,
  );
  return aimStairs({ ...dungeon, levels });
}

/** Nimmt eine Ebene weg; Etagenwechsel, die dorthin führten, haben kein Ziel mehr. */
export function removeLevel<D extends Pick<Dungeon, 'levels'>>(dungeon: D, levelId: string): D {
  if (!dungeon.levels.some((level) => level.id === levelId)) return dungeon;
  const levels = dungeon.levels
    .filter((level) => level.id !== levelId)
    .map((level) =>
      level.stairs.some((stair) => stair.to?.levelId === levelId)
        ? {
            ...level,
            stairs: level.stairs.map((stair) =>
              stair.to?.levelId === levelId ? { ...stair, to: null } : stair,
            ),
          }
        : level,
    );
  return { ...dungeon, levels };
}

// ── Etagenwechsel ──────────────────────────────────────────────────────────

export const STAIR_LABEL: Record<DungeonStairKind, string> = {
  stairs: 'Treppe',
  ladder: 'Leiter',
  shaft: 'Schacht',
  trapdoor: 'Falltür',
  portal: 'Portal',
  spiral: 'Wendeltreppe',
};

export const stairAt = (level: DungeonLevel, cell: DungeonCell): DungeonStair | null =>
  level.stairs.find((stair) => sameCell(stair, cell)) ?? null;

export function addStair(
  level: DungeonLevel,
  cell: DungeonCell,
  init: Partial<Omit<DungeonStair, 'id' | 'x' | 'y'>> = {},
): { level: DungeonLevel; stair: DungeonStair } {
  const stair = DungeonStairSchema.parse({ id: newId(), ...cell, ...init });
  return { level: { ...level, stairs: [...level.stairs, stair] }, stair };
}

export function patchStair(
  level: DungeonLevel,
  stairId: string,
  change: Partial<Omit<DungeonStair, 'id'>>,
): DungeonLevel {
  return {
    ...level,
    stairs: level.stairs.map((stair) =>
      stair.id === stairId ? DungeonStairSchema.parse({ ...stair, ...change }) : stair,
    ),
  };
}

export interface StairRef {
  levelId: string;
  stairId: string;
}

export function findStair(
  dungeon: Pick<Dungeon, 'levels'>,
  ref: StairRef | null,
): { level: DungeonLevel; stair: DungeonStair } | null {
  if (!ref) return null;
  const level = levelOf(dungeon, ref.levelId);
  const stair = level?.stairs.find((s) => s.id === ref.stairId);
  return level && stair ? { level, stair } : null;
}

/** Löst die Verbindung eines Etagenwechsels – auf beiden Seiten. */
export function unlinkStair<D extends Pick<Dungeon, 'levels'>>(dungeon: D, ref: StairRef): D {
  const found = findStair(dungeon, ref);
  if (!found?.stair.to) return dungeon;
  const partner = found.stair.to;
  let next = withLevel(dungeon, ref.levelId, (level) =>
    patchStair(level, ref.stairId, { to: null }),
  );
  const other = findStair(next, partner);
  if (other?.stair.to?.levelId === ref.levelId && other.stair.to.stairId === ref.stairId)
    next = withLevel(next, partner.levelId, (level) =>
      patchStair(level, partner.stairId, { to: null }),
    );
  return next;
}

/** Hinauf oder hinab – nach der Lage der beiden Ebenen; auf derselben Ebene bleibt es, wie es ist. */
function dirBetween(
  dungeon: Pick<Dungeon, 'levels'>,
  fromLevelId: string,
  toLevelId: string,
): 'up' | 'down' | null {
  const from = levelOf(dungeon, fromLevelId);
  const to = levelOf(dungeon, toLevelId);
  if (!from || !to || from.order === to.order) return null;
  return to.order > from.order ? 'up' : 'down';
}

/** Richtet alle verbundenen Etagenwechsel nach der Lage ihrer Ebenen aus. */
function aimStairs<D extends Pick<Dungeon, 'levels'>>(dungeon: D): D {
  const levels = dungeon.levels.map((level) => ({
    ...level,
    stairs: level.stairs.map((stair) => {
      const dir = stair.to ? dirBetween(dungeon, level.id, stair.to.levelId) : null;
      return dir && dir !== stair.dir ? { ...stair, dir } : stair;
    }),
  }));
  return { ...dungeon, levels };
}

/**
 * Verbindet einen Etagenwechsel mit einem Feld einer anderen (oder derselben) Ebene. Liegt dort
 * schon einer, wird er das Gegenstück; sonst entsteht es dort, gleicher Art. Frühere Verbindungen
 * beider Enden lösen sich, die Richtung folgt der Lage der Ebenen.
 */
export function linkStairs<D extends Pick<Dungeon, 'levels'>>(
  dungeon: D,
  from: StairRef,
  target: { levelId: string } & DungeonCell,
): D {
  const source = findStair(dungeon, from);
  const targetLevel = levelOf(dungeon, target.levelId);
  if (!source || !targetLevel) return dungeon;
  const there = stairAt(targetLevel, target);
  if (there && there.id === from.stairId && target.levelId === from.levelId) return dungeon;
  let next = unlinkStair(dungeon, from);
  let partnerId: string;
  if (there) {
    partnerId = there.id;
    next = unlinkStair(next, { levelId: target.levelId, stairId: there.id });
  } else {
    partnerId = newId();
    next = withLevel(next, target.levelId, (level) => {
      const floor = isFloor(level, target) ? level : paintTiles(level, [target], 'floor');
      return {
        ...floor,
        stairs: [
          ...floor.stairs,
          DungeonStairSchema.parse({
            id: partnerId,
            x: target.x,
            y: target.y,
            kind: source.stair.kind,
          }),
        ],
      };
    });
  }
  next = withLevel(next, from.levelId, (level) =>
    patchStair(level, from.stairId, { to: { levelId: target.levelId, stairId: partnerId } }),
  );
  next = withLevel(next, target.levelId, (level) =>
    patchStair(level, partnerId, { to: { levelId: from.levelId, stairId: from.stairId } }),
  );
  return aimStairs(next);
}

/** Nimmt einen Etagenwechsel weg; sein Gegenstück bleibt, ohne Ziel. */
export function removeStair<D extends Pick<Dungeon, 'levels'>>(dungeon: D, ref: StairRef): D {
  const next = unlinkStair(dungeon, ref);
  return withLevel(next, ref.levelId, (level) => ({
    ...level,
    stairs: level.stairs.filter((stair) => stair.id !== ref.stairId),
  }));
}

/** Etagenwechsel, deren Gegenstück es nicht mehr gibt (etwa weil sein Feld Fels wurde), verlieren ihr Ziel. */
export function healStairs<D extends Pick<Dungeon, 'levels'>>(dungeon: D): D {
  let changed = false;
  const levels = dungeon.levels.map((level) => {
    const stairs = level.stairs.map((stair) => {
      if (!stair.to || findStair(dungeon, stair.to)) return stair;
      changed = true;
      return { ...stair, to: null };
    });
    return changed ? { ...level, stairs } : level;
  });
  return changed ? { ...dungeon, levels } : dungeon;
}

/** Ein Etagenwechsel in einer Zeile: „Treppe hinab → Keller“. */
export function stairLine(dungeon: Pick<Dungeon, 'levels'>, stair: DungeonStair): string {
  const target = stair.to ? levelOf(dungeon, stair.to.levelId) : null;
  const way = stair.kind === 'portal' ? '' : stair.dir === 'up' ? ' hinauf' : ' hinab';
  return `${STAIR_LABEL[stair.kind]}${way}${target ? ` → ${target.name || 'Ebene'}` : ' – noch ohne Ziel'}`;
}

// ── Was auf einem Feld liegt, was gewählt ist ──────────────────────────────

/** Etwas, das sich auf der Karte auswählen lässt. */
export type DungeonPick =
  | { type: 'room'; id: string }
  | { type: 'edge'; key: string }
  | { type: 'trap'; id: string }
  | { type: 'stair'; id: string }
  | { type: 'marker'; id: string };

export const samePick = (a: DungeonPick | null, b: DungeonPick | null): boolean =>
  !!a &&
  !!b &&
  a.type === b.type &&
  (a.type === 'edge' ? a.key === (b as { key: string }).key : a.id === (b as { id: string }).id);

/** Was auf einem Feld liegt – Etagenwechsel vor Markierung vor Falle. */
export function thingAt(level: DungeonLevel, cell: DungeonCell): DungeonPick | null {
  const stair = stairAt(level, cell);
  if (stair) return { type: 'stair', id: stair.id };
  const marker = markerAt(level, cell);
  if (marker) return { type: 'marker', id: marker.id };
  const trap = trapAt(level, cell);
  if (trap) return { type: 'trap', id: trap.id };
  return null;
}

/** Gibt es das Gewählte auf dieser Ebene noch? */
export function pickExists(level: DungeonLevel, pick: DungeonPick): boolean {
  if (pick.type === 'room') return level.rooms.some((room) => room.id === pick.id);
  if (pick.type === 'edge') return level.edges[pick.key] !== undefined;
  if (pick.type === 'trap') return level.traps.some((trap) => trap.id === pick.id);
  if (pick.type === 'stair') return level.stairs.some((stair) => stair.id === pick.id);
  return level.markers.some((marker) => marker.id === pick.id);
}

// ── Maße ───────────────────────────────────────────────────────────────────

export const EDGE_LABEL: Record<DungeonEdgeKind, string> = {
  wall: 'Wand',
  open: 'Durchgang',
  door: 'Tür',
  secret: 'Geheimtür',
  gate: 'Gitter',
  window: 'Fenster',
  curtain: 'Vorhang',
  false: 'Scheintür',
};

export const TILE_LABEL: Record<DungeonTile, string> = {
  floor: 'Boden',
  secret: 'Geheimgang',
  rubble: 'Geröll',
  water: 'Wasser',
  chasm: 'Abgrund',
  bridge: 'Brücke',
  air: 'Luftraum',
};

export const THING_LABEL: Record<DungeonThing, string> = {
  note: 'Notiz',
  pillar: 'Säule',
  statue: 'Statue',
  altar: 'Altar',
  chest: 'Truhe',
  lever: 'Hebel',
  well: 'Brunnen',
  fire: 'Feuer',
  table: 'Tisch',
  bed: 'Bett',
  coffin: 'Sarg',
  crate: 'Kiste',
  throne: 'Thron',
};

/** Der Name eines Dings auf der Karte: sein Wort, sonst seine Art. */
export const thingName = (marker: DungeonMarker): string =>
  marker.label.trim() || (marker.kind === 'note' ? 'Notiz ohne Wort' : THING_LABEL[marker.kind]);

/** Die Größe einer Fläche in Worten: „6 Felder · 150 Quadratfuß“. */
export function areaWords(cells: number, cellFeet: number): string {
  const fields = cells === 1 ? '1 Feld' : `${cells} Felder`;
  return `${fields} · ${(cells * cellFeet * cellFeet).toLocaleString('de-DE')} Quadratfuß`;
}

/** Breite mal Höhe eines Raums in Fuß, wenn er ein volles Rechteck ist; sonst null. */
export function roomSize(cells: readonly DungeonCell[], cellFeet: number): string | null {
  if (cells.length === 0) return null;
  const xs = cells.map((cell) => cell.x);
  const ys = cells.map((cell) => cell.y);
  const w = Math.max(...xs) - Math.min(...xs) + 1;
  const h = Math.max(...ys) - Math.min(...ys) + 1;
  return w * h === cells.length ? `${w * cellFeet} × ${h * cellFeet} Fuß` : null;
}

// ── Hinweise: was noch nicht zusammenpasst ─────────────────────────────────

export interface DungeonNote {
  key: string;
  levelId: string;
  text: string;
  /** Was der Hinweis meint – zum Auswählen und Hinspringen. */
  pick: DungeonPick | null;
  cell: DungeonCell | null;
}

/** Hat ein Raum einen Zugang – Durchgang, Tür, Geheimtür, Gitter oder einen Etagenwechsel? */
export function roomHasAccess(level: DungeonLevel, roomId: string): boolean {
  const cells = roomCells(level, roomId);
  for (const cell of cells) {
    if (stairAt(level, cell)) return true;
    for (const side of SIDES) {
      const other = neighbour(cell, side);
      if (roomAt(level, other) === roomId) continue;
      if (canPass(level, cell, other, { secrets: true })) return true;
    }
  }
  return false;
}

/**
 * Was noch nicht zusammenpasst – nur Hinweise, nie ein Hindernis: Etagenwechsel ohne Ziel, Türen
 * in den Fels, Räume ohne Zugang.
 */
export function dungeonNotes(dungeon: Pick<Dungeon, 'levels'>): DungeonNote[] {
  const notes: DungeonNote[] = [];
  for (const level of levelsSorted(dungeon)) {
    for (const stair of level.stairs)
      if (!stair.to)
        notes.push({
          key: `stair:${stair.id}`,
          levelId: level.id,
          text: `${STAIR_LABEL[stair.kind]} ohne Ziel`,
          pick: { type: 'stair', id: stair.id },
          cell: { x: stair.x, y: stair.y },
        });
    for (const [key, edge] of Object.entries(level.edges)) {
      // Ein Fenster nach draußen und eine Scheintür dürfen am Fels sitzen.
      if (['wall', 'open', 'window', 'false'].includes(edge.kind)) continue;
      const { a, b } = cellsOfEdge(key);
      if (isFloor(level, a) && isFloor(level, b)) continue;
      notes.push({
        key: `edge:${level.id}:${key}`,
        levelId: level.id,
        text: `${EDGE_LABEL[edge.kind]} führt in den Fels`,
        pick: { type: 'edge', key },
        cell: isFloor(level, a) ? a : b,
      });
    }
    for (const room of level.rooms)
      if (
        !roomHasAccess(level, room.id) &&
        // Reicht der Raum über mehrere Ebenen, genügt ein Zugang auf einer von ihnen.
        !roomSpan(dungeon, room).some((other) => roomHasAccess(other.level, other.room.id))
      )
        notes.push({
          key: `room:${room.id}`,
          levelId: level.id,
          text: `${room.name.trim() || 'Raum'} hat keinen Zugang`,
          pick: { type: 'room', id: room.id },
          cell: roomAnchor(roomCells(level, room.id)),
        });
  }
  return notes;
}

/** Eine Ebene in einer Zeile: „4 Räume · 2 Fallen · 1 Etagenwechsel“. */
export function levelLine(level: DungeonLevel): string {
  const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
  const parts = [
    level.rooms.length > 0 && count(level.rooms.length, 'Raum', 'Räume'),
    level.traps.length > 0 && count(level.traps.length, 'Falle', 'Fallen'),
    level.stairs.length > 0 && count(level.stairs.length, 'Etagenwechsel', 'Etagenwechsel'),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'noch leer';
}
