/**
 * Zeichnet eine Ebene eines Dungeons auf eine Leinwand: heller Boden, kräftige Wände, Schraffur im
 * Fels ringsum. Gezeichnet wird nie das Gemalte selbst, sondern was `domain/dungeon.ts` daraus
 * liest (`edgeSegments`) – so sieht eine Wand, die von selbst dasteht, aus wie jede andere.
 */
import {
  cellOfKey,
  cellsOfEdge,
  edgeSegments,
  keyOf,
  roomAnchor,
  trapSpots,
  type DungeonPick,
  type EdgeSegment,
} from '../../domain/dungeon';
import type { DungeonCell, DungeonLevel, DungeonTile } from '../../domain/schema';

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
    font: get('--font-display') || 'Georgia, serif',
  };
}

interface Parsed {
  cells: { x: number; y: number; tile: DungeonTile; roomId: string | null }[];
  segments: EdgeSegment[];
  /** Felsfelder, die an Boden grenzen – dort steht die Schraffur. */
  rim: DungeonCell[];
  labels: { roomId: string; name: string; x: number; y: number }[];
}

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
  const parsed = { cells, segments: edgeSegments(level), rim: [...rim.values()], labels };
  parsedOf.set(level, parsed);
  return parsed;
}

export interface Scene {
  level: DungeonLevel;
  /** Eine andere Ebene, die blass durchscheint. */
  ghost: DungeonLevel | null;
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
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (const cell of parsed.rim) {
      if (!visible(cell.x, cell.y)) continue;
      const x = sx(cell.x);
      const y = sy(cell.y);
      const flip = (cell.x + cell.y) % 2 === 0;
      for (let i = 1; i <= 3; i++) {
        const t = (i / 4) * z;
        if (flip) {
          ctx.moveTo(x + t, y + z * 0.12);
          ctx.lineTo(x + z * 0.12, y + t);
          ctx.moveTo(x + z * 0.88, y + t);
          ctx.lineTo(x + t, y + z * 0.88);
        } else {
          ctx.moveTo(x + t, y + z * 0.12);
          ctx.lineTo(x + z * 0.88, y + z - t);
          ctx.moveTo(x + z * 0.12, y + t);
          ctx.lineTo(x + z - t, y + z * 0.88);
        }
      }
    }
    ctx.stroke();
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

  // Boden.
  for (const cell of parsed.cells) {
    if (!visible(cell.x, cell.y)) continue;
    const x = sx(cell.x);
    const y = sy(cell.y);
    ctx.fillStyle =
      cell.tile === 'water' ? palette.water : cell.tile === 'chasm' ? palette.chasm : palette.floor;
    ctx.fillRect(x, y, z + 0.5, z + 0.5);
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
    }
  }

  // Raster auf dem Boden.
  if (z >= 9) {
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const cell of parsed.cells) {
      if (!visible(cell.x, cell.y) || cell.tile === 'chasm') continue;
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
  ctx.strokeStyle = palette.wall;
  ctx.lineWidth = wallWidth;
  ctx.beginPath();
  for (const seg of parsed.segments) {
    if (seg.kind !== 'rock' && seg.kind !== 'wall' && seg.kind !== 'secret') continue;
    ctx.moveTo(sx(seg.x1), sy(seg.y1));
    ctx.lineTo(sx(seg.x2), sy(seg.y2));
  }
  ctx.stroke();
  for (const seg of parsed.segments) {
    if (seg.kind === 'rock' || seg.kind === 'wall') continue;
    drawOpening(ctx, seg, sx, sy, z, wallWidth, palette);
  }
  ctx.lineCap = 'butt';

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
    const r = z * 0.24;
    ctx.fillStyle = palette.wall;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
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

  // Auswahl.
  ctx.strokeStyle = palette.gold;
  ctx.lineWidth = 2;
  const pick = scene.selection;
  if (pick?.type === 'edge') {
    const { b, side } = cellsOfEdge(pick.key);
    ctx.lineWidth = wallWidth + 3;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(sx(b.x), sy(b.y));
    ctx.lineTo(sx(side === 'n' ? b.x + 1 : b.x), sy(side === 'n' ? b.y : b.y + 1));
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
    ctx.strokeRect(sx(minX) + 0.5, sy(minY) + 0.5, (maxX - minX + 1) * z, (maxY - minY + 1) * z);
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
  ctx.lineTo(...at(0.18));
  ctx.moveTo(...at(0.82));
  ctx.lineTo(x2, y2);
  ctx.stroke();

  if (seg.kind === 'door') {
    const long = z * 0.6;
    const thick = Math.max(4, z * 0.24);
    const w = horizontal ? long : thick;
    const h = horizontal ? thick : long;
    const opened = !!seg.edge?.opened;
    ctx.lineWidth = Math.max(1.5, z * 0.06);
    ctx.strokeStyle = palette.wall;
    if (opened) {
      // Offen: der Türflügel steht quer zur Kante.
      ctx.beginPath();
      ctx.moveTo(...at(0.2));
      if (horizontal) ctx.lineTo(x1 + (x2 - x1) * 0.2, y1 + z * 0.55);
      else ctx.lineTo(x1 + z * 0.55, y1 + (y2 - y1) * 0.2);
      ctx.stroke();
    } else {
      ctx.fillStyle = palette.floor;
      ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
      if (seg.edge?.locked) {
        ctx.fillStyle = palette.wall;
        const s = Math.max(3, thick * 0.5);
        ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
      }
    }
  } else if (seg.kind === 'gate') {
    ctx.fillStyle = palette.wall;
    const r = Math.max(1.5, z * 0.055);
    for (const t of [0.3, 0.43, 0.57, 0.7]) {
      const [px, py] = at(t);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (seg.edge?.opened) {
      ctx.strokeStyle = palette.floor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(...at(0.3));
      ctx.lineTo(...at(0.7));
      ctx.stroke();
    }
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
