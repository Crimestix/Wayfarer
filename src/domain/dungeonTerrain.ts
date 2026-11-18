/**
 * Gelände eines Dungeons (Wunsch des Spielleiters, 18. 11. 2026: „verschiedene Geländearten,
 * difficult terrain, … Höhlen“; Höhen in Fuß, Höhlen gemalt und erzeugt): was ein Feld für die
 * Regeln bedeutet, Höhen und Kletterei, schräge Wände, Höhlen, und Ausschnitte zum Kopieren,
 * Spiegeln und Drehen. Reine Rechnung; erzeugt wird nur Gestalt, nach festen Regeln
 * (`domain/random.ts`), nie Inhalt.
 */
import { cellKey, cellOfKey, cellsOfEdge, keyOf } from './dungeon';
import { rngOf, seedOf } from './random';
import {
  newId,
  type DungeonCell,
  type DungeonLevel,
  type DungeonSave,
  type DungeonTile,
} from './schema';

// ── Was ein Feld bedeutet ──────────────────────────────────────────────────

export interface TileRule {
  /** Schwieriges Gelände: Jeder Schritt kostet doppelt. */
  slow: boolean;
  /** Man sieht nicht hindurch (nur hinein). */
  veil: boolean;
  /** Licht reicht nicht hinein; auch Dunkelsicht sieht dort nichts. */
  lightless: boolean;
  /** Löscht offene Flammen (Fackeln), wenn man hineingerät. */
  douses: boolean;
  /** Was beim Betreten zu entscheiden ist – der Weg meidet solche Felder, wenn es anders geht. */
  danger: { title: string; save: DungeonSave; dc: number | null; damage: string } | null;
}

const plain: TileRule = { slow: false, veil: false, lightless: false, douses: false, danger: null };

/** Die Regeln je Geländeart. Schaden und SG sind Vorgaben in eigenen Worten – der Spielleiter entscheidet. */
export const TILE_RULE: Record<DungeonTile, TileRule> = {
  floor: plain,
  secret: plain,
  bridge: plain,
  chasm: plain,
  air: plain,
  rubble: { ...plain, slow: true },
  water: { ...plain, slow: true },
  mud: { ...plain, slow: true },
  deep: {
    ...plain,
    slow: true,
    douses: true,
    danger: { title: 'Tiefes Wasser – schwimmen', save: 'str', dc: 10, damage: '' },
  },
  ice: {
    ...plain,
    danger: { title: 'Eis – rutschig', save: 'dex', dc: 10, damage: 'sonst liegend' },
  },
  lava: {
    ...plain,
    slow: true,
    danger: { title: 'Lava', save: 'none', dc: null, damage: '10W10 Feuer beim Betreten' },
  },
  acid: {
    ...plain,
    slow: true,
    danger: { title: 'Säure', save: 'none', dc: null, damage: '2W6 Säure beim Betreten' },
  },
  thorns: {
    ...plain,
    slow: true,
    danger: { title: 'Dornen', save: 'none', dc: null, damage: '1W4 Stich je Feld' },
  },
  web: {
    ...plain,
    slow: true,
    danger: { title: 'Spinnweben', save: 'str', dc: 12, damage: 'sonst festgehalten' },
  },
  fog: { ...plain, veil: true },
  dark: { ...plain, veil: true, lightless: true },
};

export const isRough = (level: DungeonLevel, cell: DungeonCell): boolean =>
  level.rough.includes(keyOf(cell));

/** Ist das Feld schwieriges Gelände – nach seiner Art oder weil der Spielleiter es so gesetzt hat? */
export function isSlow(level: DungeonLevel, cell: DungeonCell): boolean {
  const tile = level.tiles[keyOf(cell)];
  return (tile !== undefined && TILE_RULE[tile].slow) || isRough(level, cell);
}

/** Setzt oder nimmt schwieriges Gelände auf Bodenfeldern. */
export function setRough(
  level: DungeonLevel,
  cells: readonly DungeonCell[],
  on: boolean,
): DungeonLevel {
  const set = new Set(level.rough);
  for (const cell of cells) {
    const key = keyOf(cell);
    if (level.tiles[key] === undefined) continue;
    if (on) set.add(key);
    else set.delete(key);
  }
  return set.size === level.rough.length && [...set].every((k) => level.rough.includes(k))
    ? level
    : { ...level, rough: [...set] };
}

// ── Höhen ──────────────────────────────────────────────────────────────────

export const heightAt = (level: DungeonLevel, cell: DungeonCell): number =>
  level.heights[keyOf(cell)] ?? 0;

/** Setzt die Höhe von Bodenfeldern in Fuß; 0 nimmt den Eintrag weg. */
export function setHeights(
  level: DungeonLevel,
  cells: readonly DungeonCell[],
  feet: number,
): DungeonLevel {
  const heights = { ...level.heights };
  for (const cell of cells) {
    const key = keyOf(cell);
    if (level.tiles[key] === undefined) continue;
    if (feet === 0) delete heights[key];
    else heights[key] = Math.round(feet);
  }
  return { ...level, heights };
}

/** Bis zu diesem Unterschied geht man einfach weiter: eine Stufe, eine Rampe. */
export const STEP_FEET = 5;
/** Ab dieser Tiefe ist ein Schritt hinab ein Sturz. */
export const FALL_FEET = 10;

export interface Climb {
  /** Höhenunterschied in Fuß (positiv: hinauf). */
  diff: number;
  /** Zusätzliche Bewegung in Fuß: Klettern kostet doppelt. */
  extra: number;
  kind: 'level' | 'climb' | 'drop';
}

/** Was der Schritt von einem Feld ins andere an Höhe bedeutet. */
export function climbBetween(level: DungeonLevel, a: DungeonCell, b: DungeonCell): Climb {
  const diff = heightAt(level, b) - heightAt(level, a);
  if (Math.abs(diff) <= STEP_FEET) return { diff, extra: 0, kind: 'level' };
  if (diff > 0) return { diff, extra: diff, kind: 'climb' };
  return { diff, extra: 0, kind: -diff >= FALL_FEET ? 'drop' : 'level' };
}

/** Sturzschaden in Worten: 1W6 je zehn Fuß, höchstens 20W6. */
export function fallWords(feet: number): string {
  const dice = Math.min(20, Math.floor(Math.abs(feet) / 10));
  return dice > 0 ? `${dice}W6 Wucht` : 'kein Schaden';
}

// ── Schräge Wände ──────────────────────────────────────────────────────────

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** Setzt die Fels-Ecke eines Bodenfelds (eine schräge Wand) oder nimmt sie weg. */
export function setCorner(
  level: DungeonLevel,
  cell: DungeonCell,
  corner: Corner | null,
): DungeonLevel {
  const key = keyOf(cell);
  if (level.tiles[key] === undefined) return level;
  const corners = { ...level.corners };
  if (corner === null || corners[key] === corner) delete corners[key];
  else corners[key] = corner;
  return { ...level, corners };
}

/** Die Ecke eines Feldes, der eine Stelle im Feld (Anteile 0–1) am nächsten liegt. */
export const cornerNear = (fx: number, fy: number): Corner =>
  `${fy < 0.5 ? 'n' : 's'}${fx < 0.5 ? 'w' : 'e'}` as Corner;

// ── Höhlen ─────────────────────────────────────────────────────────────────

/** Markiert Bodenfelder als Höhle (unregelmäßiger Rand) oder nimmt die Markierung weg. */
export function setCave(
  level: DungeonLevel,
  cells: readonly DungeonCell[],
  on: boolean,
): DungeonLevel {
  const set = new Set(level.cave);
  for (const cell of cells) {
    const key = keyOf(cell);
    if (on && level.tiles[key] !== undefined) set.add(key);
    else if (!on) set.delete(key);
  }
  return { ...level, cave: [...set] };
}

/**
 * Erzeugt die Gestalt einer Höhle in einem Rechteck – nach fester Regel, gleicher Ausgangswert
 * gibt dieselbe Höhle: zufällig gefüllt, mehrfach geglättet, dann nur das größte
 * zusammenhängende Stück. Kammern, Engstellen und Sackgassen entstehen von selbst.
 */
export function generateCave(
  rect: { x: number; y: number; w: number; h: number },
  seed: string,
): DungeonCell[] {
  const { w, h } = rect;
  if (w < 3 || h < 3) return [];
  const rng = rngOf(seedOf('höhle', seed, rect.x, rect.y, w, h));
  let open: boolean[][] = [];
  for (let y = 0; y < h; y++) {
    open.push([]);
    for (let x = 0; x < w; x++) open[y]!.push(rng.chance(0.56));
  }
  const at = (grid: boolean[][], x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h ? grid[y]![x]! : false;
  for (let pass = 0; pass < 4; pass++) {
    const next: boolean[][] = [];
    for (let y = 0; y < h; y++) {
      next.push([]);
      for (let x = 0; x < w; x++) {
        let around = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && at(open, x + dx, y + dy)) around++;
        next[y]!.push(around >= 5 || (at(open, x, y) && around >= 4));
      }
    }
    open = next;
  }
  // Das größte zusammenhängende Stück.
  const seen = new Set<string>();
  let best: DungeonCell[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!open[y]![x] || seen.has(cellKey(x, y))) continue;
      const part: DungeonCell[] = [];
      const queue: DungeonCell[] = [{ x, y }];
      seen.add(cellKey(x, y));
      while (queue.length > 0) {
        const cell = queue.pop()!;
        part.push(cell);
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = cell.x + dx;
          const ny = cell.y + dy;
          const key = cellKey(nx, ny);
          if (!at(open, nx, ny) || seen.has(key)) continue;
          seen.add(key);
          queue.push({ x: nx, y: ny });
        }
      }
      if (part.length > best.length) best = part;
    }
  return best.map((cell) => ({ x: cell.x + rect.x, y: cell.y + rect.y }));
}

// ── Ausschnitte: kopieren, spiegeln, drehen, einfügen ──────────────────────

type Stamped = Pick<
  DungeonLevel,
  | 'tiles'
  | 'roomOf'
  | 'rooms'
  | 'edges'
  | 'traps'
  | 'markers'
  | 'dwellers'
  | 'heights'
  | 'rough'
  | 'cave'
  | 'corners'
>;

/** Ein Ausschnitt einer Ebene, gemessen von seiner linken oberen Ecke. */
export interface Stamp extends Stamped {
  w: number;
  h: number;
}

/** Hebt alles in einem Rechteck als Ausschnitt heraus – die Ebene bleibt, wie sie ist. */
export function copyRegion(
  level: DungeonLevel,
  rect: { x: number; y: number; w: number; h: number },
): Stamp {
  const inside = (c: DungeonCell) =>
    c.x >= rect.x && c.y >= rect.y && c.x < rect.x + rect.w && c.y < rect.y + rect.h;
  const rel = <T extends DungeonCell>(c: T): T => ({ ...c, x: c.x - rect.x, y: c.y - rect.y });
  const relKey = (key: string) => keyOf(rel(cellOfKey(key)));
  const pickKeys = <V>(record: Record<string, V>): Record<string, V> =>
    Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => inside(cellOfKey(key)))
        .map(([key, value]) => [relKey(key), value]),
    );
  const edges: Stamp['edges'] = {};
  for (const [key, edge] of Object.entries(level.edges)) {
    const { a, b, side } = cellsOfEdge(key);
    // Nur Kanten, deren beide Felder im Ausschnitt liegen – Türen nach draußen bleiben draußen.
    if (!inside(a) || !inside(b)) continue;
    const moved = rel(b);
    edges[`${moved.x},${moved.y},${side}`] = edge;
  }
  const roomOf = pickKeys(level.roomOf);
  const used = new Set(Object.values(roomOf));
  return {
    w: rect.w,
    h: rect.h,
    tiles: pickKeys(level.tiles),
    roomOf,
    rooms: level.rooms.filter((room) => used.has(room.id)),
    edges,
    traps: level.traps
      .filter((trap) => trap.cells.every(inside))
      .map((trap) => ({
        ...trap,
        cells: trap.cells.map(rel),
        spots: trap.spots.filter(inside).map(rel),
      })),
    markers: level.markers.filter(inside).map(rel),
    dwellers: level.dwellers
      .filter(inside)
      .map((d) => ({ ...rel(d), route: d.route.filter(inside).map(rel) })),
    heights: pickKeys(level.heights),
    rough: level.rough.filter((key) => inside(cellOfKey(key))).map(relKey),
    cave: level.cave.filter((key) => inside(cellOfKey(key))).map(relKey),
    corners: pickKeys(level.corners),
  };
}

const ROT_CORNER: Record<Corner, Corner> = { nw: 'ne', ne: 'se', se: 'sw', sw: 'nw' };
const FLIP_CORNER: Record<Corner, Corner> = { nw: 'ne', ne: 'nw', sw: 'se', se: 'sw' };

/** Bildet einen Ausschnitt ab: jedes Feld und jede Kante über dieselbe Regel. */
function mapStamp(
  stamp: Stamp,
  size: { w: number; h: number },
  cell: (c: DungeonCell) => DungeonCell,
  corner: (c: Corner) => Corner,
): Stamp {
  const mapCell = <T extends DungeonCell>(c: T): T => ({ ...c, ...cell(c) });
  const mapKey = (key: string) => keyOf(cell(cellOfKey(key)));
  const mapRecord = <V>(record: Record<string, V>): Record<string, V> =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [mapKey(key), value]));
  const edges: Stamp['edges'] = {};
  for (const [key, edge] of Object.entries(stamp.edges)) {
    const { a, b } = cellsOfEdge(key);
    const na = cell(a);
    const nb = cell(b);
    const vertical = na.y === nb.y;
    const first = vertical ? (na.x < nb.x ? na : nb) : na.y < nb.y ? na : nb;
    const second = first === na ? nb : na;
    // Eine Einbahntür zeigt weiter in dieselbe Richtung, auch wenn ihre Felder die Plätze tauschen.
    const swapped = first !== na;
    const oneWay =
      edge.oneWay === 'none' || !swapped ? edge.oneWay : edge.oneWay === 'ab' ? 'ba' : 'ab';
    edges[`${second.x},${second.y},${vertical ? 'w' : 'n'}`] = { ...edge, oneWay };
  }
  return {
    ...size,
    tiles: mapRecord(stamp.tiles),
    roomOf: mapRecord(stamp.roomOf),
    // Rund bleibt ein Raum nur ungedreht – sonst ist er ein Raum aus seinen Feldern.
    rooms: stamp.rooms.map((room) => ({ ...room, round: null })),
    edges,
    traps: stamp.traps.map((t) => ({
      ...t,
      cells: t.cells.map(mapCell),
      spots: t.spots.map(mapCell),
    })),
    markers: stamp.markers.map(mapCell),
    dwellers: stamp.dwellers.map((d) => ({ ...mapCell(d), route: d.route.map(mapCell) })),
    heights: mapRecord(stamp.heights),
    rough: stamp.rough.map(mapKey),
    cave: stamp.cave.map(mapKey),
    corners: Object.fromEntries(
      Object.entries(stamp.corners).map(([key, c]) => [mapKey(key), corner(c)]),
    ),
  };
}

/** Dreht einen Ausschnitt um ein Viertel im Uhrzeigersinn. */
export const rotateStamp = (stamp: Stamp): Stamp =>
  mapStamp(
    stamp,
    { w: stamp.h, h: stamp.w },
    (c) => ({ x: stamp.h - 1 - c.y, y: c.x }),
    (c) => ROT_CORNER[c],
  );

/** Spiegelt einen Ausschnitt an seiner senkrechten Mitte (links und rechts tauschen). */
export const mirrorStamp = (stamp: Stamp): Stamp =>
  mapStamp(
    stamp,
    { w: stamp.w, h: stamp.h },
    (c) => ({ x: stamp.w - 1 - c.x, y: c.y }),
    (c) => FLIP_CORNER[c],
  );

/**
 * Legt einen Ausschnitt auf die Ebene – was dort lag, weicht. Räume, Fallen, Einrichtung und
 * Bewohner bekommen neue Kennungen: Es ist eine Kopie, nie dasselbe Ding zweimal.
 */
export function pasteStamp(level: DungeonLevel, stamp: Stamp, at: DungeonCell): DungeonLevel {
  const move = <T extends DungeonCell>(c: T): T => ({ ...c, x: c.x + at.x, y: c.y + at.y });
  const moveKey = (key: string) => keyOf(move(cellOfKey(key)));
  const inside = (c: DungeonCell) =>
    c.x >= at.x && c.y >= at.y && c.x < at.x + stamp.w && c.y < at.y + stamp.h;
  const outsideKeys = <V>(record: Record<string, V>): Record<string, V> =>
    Object.fromEntries(Object.entries(record).filter(([key]) => !inside(cellOfKey(key))));
  const placed = <V>(record: Record<string, V>): Record<string, V> =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [moveKey(key), value]));
  const roomIds = new Map(stamp.rooms.map((room) => [room.id, newId()]));
  const edges = Object.fromEntries(
    Object.entries(level.edges).filter(([key]) => {
      const { a, b } = cellsOfEdge(key);
      return !inside(a) && !inside(b);
    }),
  );
  for (const [key, edge] of Object.entries(stamp.edges)) {
    const { b, side } = cellsOfEdge(key);
    const moved = move(b);
    edges[`${moved.x},${moved.y},${side}`] = edge;
  }
  const roomOf = {
    ...outsideKeys(level.roomOf),
    ...Object.fromEntries(
      Object.entries(stamp.roomOf).map(([key, id]) => [moveKey(key), roomIds.get(id) ?? id]),
    ),
  };
  const used = new Set(Object.values(roomOf));
  return {
    ...level,
    tiles: { ...outsideKeys(level.tiles), ...placed(stamp.tiles) },
    roomOf,
    rooms: [
      ...level.rooms.filter((room) => used.has(room.id)),
      ...stamp.rooms.map((room) => ({ ...room, id: roomIds.get(room.id)!, spanId: null })),
    ],
    edges,
    traps: [
      ...level.traps
        .map((t) => ({
          ...t,
          cells: t.cells.filter((c) => !inside(c)),
          spots: t.spots.filter((c) => !inside(c)),
        }))
        .filter((t) => t.cells.length > 0),
      ...stamp.traps.map((t) => ({
        ...t,
        id: newId(),
        cells: t.cells.map(move),
        spots: t.spots.map(move),
      })),
    ],
    stairs: level.stairs.filter((s) => !inside(s)),
    markers: [
      ...level.markers.filter((m) => !inside(m)),
      ...stamp.markers.map((m) => ({ ...move(m), id: newId(), links: [] })),
    ],
    dwellers: [
      ...level.dwellers.filter((d) => !inside(d)),
      ...stamp.dwellers.map((d) => ({ ...move(d), id: newId(), route: d.route.map(move) })),
    ],
    zones: level.zones
      .map((z) => ({ ...z, cells: z.cells.filter((c) => !inside(c)) }))
      .filter((z, i) => z.cells.length > 0 || level.zones[i]!.cells.length === 0),
    heights: { ...outsideKeys(level.heights), ...placed(stamp.heights) },
    rough: [...level.rough.filter((key) => !inside(cellOfKey(key))), ...stamp.rough.map(moveKey)],
    cave: [...level.cave.filter((key) => !inside(cellOfKey(key))), ...stamp.cave.map(moveKey)],
    corners: { ...outsideKeys(level.corners), ...placed(stamp.corners) },
  };
}
