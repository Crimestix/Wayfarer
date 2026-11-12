/**
 * Der Zeichner: bringt eine gezeichnete Karte auf die Zeichenfläche – Tinte auf Pergament, unter
 * der Erde heller Strich auf dunklem Fels. Er rechnet nichts über die Welt; was eine Stelle
 * bedeutet, sagt `domain/mapDraw.ts`.
 */
import type { SymbolSite } from '../../domain/mapDraw';
import type { GameMap, MapGround, MapLine } from '../../domain/schema';
import { scaleBar, type View } from './model';

type Point = readonly [number, number];
type Ctx = CanvasRenderingContext2D;

export interface Palette {
  paper: string;
  edge: string;
  ink: string;
  inkSoft: string;
  canopy: string;
  canopyShade: string;
  water: string;
  waterLine: string;
  river: string;
  road: string;
  snow: string;
  /** Hervorhebung für das Gewählte. */
  mark: string;
  ground: Record<MapGround, string>;
  display: string;
  body: string;
}

function rgb(hex: string): [number, number, number] {
  const text = hex.trim().replace('#', '');
  const full = text.length === 3 ? [...text].map((c) => c + c).join('') : text;
  const value = Number.parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Mischt zwei Farben: 0 = `a`, 1 = `b`. */
export function mix(a: string, b: string, share: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  const part = (i: 0 | 1 | 2) => Math.round(x[i] + (y[i] - x[i]) * share);
  return `rgb(${part(0)}, ${part(1)}, ${part(2)})`;
}

/** Liest die Farben der Karte aus den Gestaltungswerten (`tokens.css`). */
export function paletteOf(element: Element, level: GameMap['level']): Palette {
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const fonts = { display: read('--font-display'), body: read('--font-body') };
  const tints: Record<Exclude<MapGround, 'plain' | 'water'>, string> = {
    forest: read('--map-forest'),
    hills: read('--map-hills'),
    mountains: read('--map-mountains'),
    swamp: read('--map-swamp'),
    desert: read('--map-desert'),
    snow: read('--map-snow'),
  };
  if (level === 'surface') {
    const paper = read('--map-paper');
    return {
      paper,
      edge: read('--map-paper-edge'),
      ink: read('--map-ink'),
      inkSoft: read('--map-ink-soft'),
      canopy: read('--map-canopy'),
      canopyShade: read('--map-canopy-shade'),
      water: read('--map-water'),
      waterLine: read('--map-water-line'),
      river: read('--map-river'),
      road: read('--map-road'),
      snow: read('--map-snow'),
      mark: read('--blood-bright'),
      ground: { plain: paper, water: read('--map-water'), ...tints },
      ...fonts,
    };
  }
  const rock = read('--map-rock');
  const ink = read('--map-rock-ink');
  const dim = (color: string, share = 0.3) => mix(rock, color, share);
  const water = dim(read('--map-river'), 0.55);
  return {
    paper: rock,
    edge: read('--map-rock-edge'),
    ink,
    inkSoft: dim(ink, 0.55),
    canopy: dim(read('--map-canopy'), 0.5),
    canopyShade: dim(read('--map-canopy-shade'), 0.5),
    water,
    waterLine: dim(ink, 0.5),
    river: dim(ink, 0.7),
    road: read('--gold'),
    snow: dim(read('--map-snow'), 0.6),
    mark: read('--gold-bright'),
    ground: {
      plain: rock,
      water,
      forest: dim(tints.forest),
      hills: dim(tints.hills, 0.2),
      mountains: dim(tints.mountains, 0.3),
      swamp: dim(tints.swamp, 0.25),
      desert: dim(tints.desert, 0.28),
      snow: dim(tints.snow, 0.45),
    },
    ...fonts,
  };
}

/** Hilfsflächen für das Wasser: Maske, Arbeitsfläche, Füllung – so groß wie die Zeichenfläche. */
export interface Layers {
  mask: HTMLCanvasElement;
  work: HTMLCanvasElement;
  fill: HTMLCanvasElement;
}
export const makeLayers = (): Layers => ({
  mask: document.createElement('canvas'),
  work: document.createElement('canvas'),
  fill: document.createElement('canvas'),
});

export type Draft =
  | { kind: 'ground'; ground: MapGround; width: number; points: Point[] }
  | { kind: 'line'; line: MapLine['kind']; points: Point[] };

export interface Scene {
  map: GameMap;
  view: View;
  /** Größe der Zeichenfläche in Bildschirmpunkten. */
  width: number;
  height: number;
  dpr: number;
  sites: readonly SymbolSite[];
  /** Weite des Rasters der Zeichen in Karteneinheiten. */
  cell: number;
  /** Beschriftung je Kartenpunkt. */
  labels: ReadonlyMap<string, string>;
  /** Was gerade gezogen wird. */
  draft: Draft | null;
  /** Kennung der gewählten Linie oder des gewählten Punktes. */
  selected: string | null;
  /** Der Pinsel unter dem Zeiger: Stelle der Karte und Breite. */
  brush: { at: Point; width: number } | null;
}

const TURN = Math.PI * 2;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Zeichnet die Karte. */
export function drawMap(ctx: Ctx, layers: Layers, scene: Scene, palette: Palette): void {
  const { map, view, width, height, dpr } = scene;
  const frame = map.frame;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!frame) return;
  const sx = (x: number) => (x - view.x) * view.zoom;
  const sy = (y: number) => (y - view.y) * view.zoom;
  const sheet = [sx(0), sy(0), frame.width * view.zoom, frame.height * view.zoom] as const;

  /** Ein Pinselstrich: eine dicke Linie mit runden Enden. */
  const paint = (target: Ctx, points: readonly Point[], widthPx: number, color: string) => {
    if (!points.length) return;
    target.fillStyle = target.strokeStyle = color;
    target.beginPath();
    if (points.length === 1) {
      target.arc(sx(points[0]![0]), sy(points[0]![1]), widthPx / 2, 0, TURN);
      target.fill();
      return;
    }
    target.moveTo(sx(points[0]![0]), sy(points[0]![1]));
    for (let i = 1; i < points.length; i++) target.lineTo(sx(points[i]![0]), sy(points[i]![1]));
    target.lineWidth = widthPx;
    target.stroke();
  };
  /** Eine Linie, weich durch ihre Punkte gezogen. */
  const curve = (points: readonly Point[]) => {
    ctx.beginPath();
    if (points.length < 2) return;
    ctx.moveTo(sx(points[0]![0]), sy(points[0]![1]));
    for (let i = 1; i < points.length - 1; i++) {
      const [a, b] = [points[i]!, points[i + 1]!];
      ctx.quadraticCurveTo(sx(a[0]), sy(a[1]), sx((a[0] + b[0]) / 2), sy((a[1] + b[1]) / 2));
    }
    const last = points[points.length - 1]!;
    ctx.lineTo(sx(last[0]), sy(last[1]));
  };
  const strokeLine = (kind: MapLine['kind'], points: readonly Point[]) => {
    curve(points);
    ctx.setLineDash([]);
    if (kind === 'road') {
      ctx.strokeStyle = palette.paper;
      ctx.lineWidth = 4.6;
      ctx.stroke();
      ctx.strokeStyle = palette.road;
      ctx.lineWidth = 2.1;
      ctx.stroke();
    } else if (kind === 'path') {
      ctx.strokeStyle = palette.road;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
    } else if (kind === 'river') {
      ctx.strokeStyle = palette.river;
      ctx.lineWidth = clamp(2.2 * view.zoom ** 0.45, 1.4, 6);
      ctx.stroke();
    } else {
      ctx.strokeStyle = palette.inkSoft;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 5, 2, 5]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  };

  // Das Blatt mit seinem Schatten.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = palette.paper;
  ctx.fillRect(...sheet);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(...sheet);
  ctx.clip();
  ctx.lineCap = ctx.lineJoin = 'round';

  // Gelände: der Grund, darüber Strich für Strich.
  if (map.ground !== 'water' && map.ground !== 'plain') {
    ctx.fillStyle = palette.ground[map.ground];
    ctx.fillRect(...sheet);
  }
  let wet = map.ground === 'water';
  for (const stroke of map.strokes) {
    if (stroke.ground === 'water') wet = true;
    else paint(ctx, stroke.points, stroke.width * view.zoom, palette.ground[stroke.ground]);
  }
  // Der nachgedunkelte Rand des Blattes.
  ctx.strokeStyle = palette.edge;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 20;
  ctx.strokeRect(...sheet);
  ctx.globalAlpha = 1;

  if (wet) {
    // Wasser ist, wo der oberste Strich Wasser ist: Wasser malt in die Maske, Land radiert.
    const [w, h] = [ctx.canvas.width, ctx.canvas.height];
    for (const layer of [layers.mask, layers.work, layers.fill])
      if (layer.width !== w || layer.height !== h) {
        layer.width = w;
        layer.height = h;
      }
    const mask = layers.mask.getContext('2d')!;
    const work = layers.work.getContext('2d')!;
    const fill = layers.fill.getContext('2d')!;
    const wipe = (target: Ctx) => {
      target.setTransform(1, 0, 0, 1, 0, 0);
      target.globalCompositeOperation = 'source-over';
      target.globalAlpha = 1;
      target.clearRect(0, 0, w, h);
    };
    const around = (target: Ctx, source: HTMLCanvasElement, reach: number) => {
      for (let step = 0; step < 8; step++) {
        const angle = (step * TURN) / 8;
        target.drawImage(source, Math.cos(angle) * reach * dpr, Math.sin(angle) * reach * dpr);
      }
    };

    wipe(mask);
    mask.setTransform(dpr, 0, 0, dpr, 0, 0);
    mask.lineCap = mask.lineJoin = 'round';
    mask.fillStyle = '#000';
    if (map.ground === 'water') mask.fillRect(...sheet);
    for (const stroke of map.strokes) {
      mask.globalCompositeOperation = stroke.ground === 'water' ? 'source-over' : 'destination-out';
      paint(mask, stroke.points, stroke.width * view.zoom, '#000');
    }
    mask.globalCompositeOperation = 'destination-in';
    mask.fillRect(...sheet);

    // Das Land als Fläche – sein Saum tönt das Wasser vor der Küste.
    wipe(work);
    work.setTransform(dpr, 0, 0, dpr, 0, 0);
    work.fillStyle = palette.waterLine;
    work.fillRect(...sheet);
    work.setTransform(1, 0, 0, 1, 0, 0);
    work.globalCompositeOperation = 'destination-out';
    work.drawImage(layers.mask, 0, 0);

    wipe(fill);
    fill.drawImage(layers.mask, 0, 0);
    fill.globalCompositeOperation = 'source-in';
    fill.fillStyle = palette.water;
    fill.fillRect(0, 0, w, h);
    fill.globalCompositeOperation = 'source-atop';
    fill.globalAlpha = 0.085;
    for (const reach of [12, 7, 3]) around(fill, layers.work, reach);

    // Die Küstenlinie: das Wasser, um einen Strich geweitet, in Tinte.
    wipe(work);
    around(work, layers.mask, 1.2);
    work.globalCompositeOperation = 'source-in';
    work.fillStyle = palette.ink;
    work.fillRect(0, 0, w, h);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layers.work, 0, 0);
    ctx.drawImage(layers.fill, 0, 0);
    ctx.restore();
  }

  const halo = (points: readonly Point[]) => {
    curve(points);
    ctx.strokeStyle = palette.mark;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 11;
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  for (const line of map.lines)
    if (line.kind === 'river' || line.kind === 'border') {
      if (line.id === scene.selected) halo(line.points);
      strokeLine(line.kind, line.points);
    }

  // Zeichen: Bäume, Hügel, Gipfel, Schilf, Dünen – von hinten nach vorn.
  const size = scene.cell * view.zoom;
  for (const site of scene.sites) {
    const [x, y] = [sx(site.x), sy(site.y)];
    if (x < -size * 2 || y < -size * 2 || x > width + size * 2 || y > height + size * 3) continue;
    const roll = site.roll;
    if (site.symbol === 'peak') {
      const z = clamp(size * 0.66, 5, 90) * (0.8 + roll * 0.4);
      const t = z * (1.05 + roll * 0.35);
      const [ax, ay] = [x + (roll - 0.5) * z * 0.15, y - t];
      ctx.beginPath();
      ctx.moveTo(x - z, y);
      ctx.quadraticCurveTo(x - z * 0.4, y - t * 0.55, ax, ay);
      ctx.quadraticCurveTo(x + z * 0.45, y - t * 0.5, x + z, y);
      ctx.fillStyle = palette.paper;
      ctx.fill();
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // Schraffur auf der Schattenseite.
      ctx.beginPath();
      for (let k = 1; k <= 5; k++) {
        const u = k / 6.2;
        const [px, py] = [ax + (x + z - ax) * u, ay + (y - ay) * u];
        ctx.moveTo(px, py);
        ctx.lineTo(px - z * 0.22, Math.min(y - 1, py + z * 0.38));
      }
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(ax + z * 0.05, ay + t * 0.4, ax - z * 0.12, y - t * 0.2);
      ctx.lineWidth = 0.75;
      ctx.globalAlpha = 0.75;
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (roll > 0.6) {
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - z * 0.3, ay + t * 0.3);
        ctx.lineTo(ax - z * 0.08, ay + t * 0.24);
        ctx.lineTo(ax + z * 0.1, ay + t * 0.34);
        ctx.lineTo(ax + z * 0.25, ay + t * 0.26);
        ctx.closePath();
        ctx.fillStyle = palette.snow;
        ctx.fill();
      }
    } else if (site.symbol === 'hill') {
      const z = clamp(size * 0.46, 4, 60);
      ctx.beginPath();
      ctx.moveTo(x - z, y);
      ctx.quadraticCurveTo(x, y - z * 1.05, x + z, y);
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + z * 0.35, y - z * 0.38);
      ctx.lineTo(x + z * 0.2, y - z * 0.08);
      ctx.moveTo(x + z * 0.62, y - z * 0.22);
      ctx.lineTo(x + z * 0.5, y - z * 0.02);
      ctx.lineWidth = 0.7;
      ctx.stroke();
    } else if (site.symbol === 'tree') {
      const r = clamp(size * 0.34, 2.4, 44) * (0.85 + roll * 0.3);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - r * 0.6);
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = Math.max(0.6, r * 0.16);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - r * 1.25, r, 0, TURN);
      ctx.fillStyle = palette.canopy;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + r * 0.18, y - r * 1.2, r * 0.78, -0.6, 1.9);
      ctx.strokeStyle = palette.canopyShade;
      ctx.lineWidth = Math.max(0.8, r * 0.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y - r * 1.25, r, 0, TURN);
      ctx.strokeStyle = palette.ink;
      ctx.lineWidth = Math.max(0.55, r * 0.13);
      ctx.stroke();
    } else if (site.symbol === 'reed') {
      const z = clamp(size * 0.3, 3.5, 30);
      ctx.beginPath();
      ctx.moveTo(x - z * 1.2, y);
      ctx.lineTo(x + z * 1.2, y);
      for (const d of [-0.6, 0, 0.6]) {
        ctx.moveTo(x + d * z, y - 1);
        ctx.lineTo(x + d * z * 1.3, y - z * (d === 0 ? 1.1 : 0.8));
      }
      ctx.strokeStyle = palette.river;
      ctx.lineWidth = 0.9;
      ctx.stroke();
    } else {
      const z = clamp(size * 0.42, 4, 50);
      ctx.beginPath();
      ctx.moveTo(x - z, y);
      ctx.quadraticCurveTo(x - z * 0.3, y - z * 0.55, x + z * 0.25, y - z * 0.12);
      ctx.quadraticCurveTo(x + z * 0.6, y + z * 0.08, x + z, y - z * 0.05);
      ctx.strokeStyle = palette.inkSoft;
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
  }

  for (const line of map.lines)
    if (line.kind === 'road' || line.kind === 'path') {
      if (line.id === scene.selected) halo(line.points);
      strokeLine(line.kind, line.points);
    }

  // Was gerade gezogen wird.
  const draft = scene.draft;
  if (draft?.kind === 'ground') {
    ctx.globalAlpha = 0.8;
    paint(ctx, draft.points, draft.width * view.zoom, palette.ground[draft.ground]);
    ctx.globalAlpha = 1;
  } else if (draft) strokeLine(draft.line, draft.points);

  // Orte und ihre Namen.
  const taken: [number, number, number, number][] = [];
  for (const marker of map.markers) {
    const [x, y] = [sx(marker.x), sy(marker.y)];
    const r = marker.entityId ? 5.5 : 3.2;
    taken.push([x - r - 2, y - r - 2, x + r + 2, y + r + 2]);
    if (marker.id === scene.selected) {
      ctx.beginPath();
      ctx.arc(x, y, r + 6, 0, TURN);
      ctx.fillStyle = palette.mark;
      ctx.globalAlpha = 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TURN);
    ctx.fillStyle = marker.entityId ? palette.paper : palette.ink;
    ctx.fill();
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    if (marker.entityId) {
      ctx.beginPath();
      ctx.arc(x, y, 2.3, 0, TURN);
      ctx.fillStyle = palette.ink;
      ctx.fill();
    }
  }
  const write = (text: string, x: number, y: number, align: CanvasTextAlign): boolean => {
    const w = ctx.measureText(text).width;
    const left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
    const box: [number, number, number, number] = [left - 2, y - 10, left + w + 2, y + 10];
    if (taken.some((o) => !(box[2] < o[0] || box[0] > o[2] || box[3] < o[1] || box[1] > o[3])))
      return false;
    taken.push(box);
    ctx.textAlign = align;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = palette.paper;
    ctx.lineWidth = 3.6;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    return true;
  };
  ctx.textBaseline = 'middle';
  for (const marker of map.markers) {
    const text = scene.labels.get(marker.id);
    if (!text) continue;
    const [x, y] = [sx(marker.x), sy(marker.y)];
    const off = marker.entityId ? 10 : 7;
    ctx.font = marker.entityId ? `600 17px ${palette.display}` : `italic 15px ${palette.body}`;
    ctx.fillStyle = palette.ink;
    if (
      !write(text, x + off, y, 'left') &&
      !write(text, x - off, y, 'right') &&
      !write(text, x, y - off - 8, 'center')
    )
      write(text, x, y + off + 8, 'center');
  }
  ctx.font = `italic 14px ${palette.body}`;
  for (const line of map.lines) {
    if (!line.name || line.points.length < 2) continue;
    const middle = line.points[Math.floor(line.points.length / 2)]!;
    ctx.fillStyle = line.kind === 'river' ? palette.river : palette.ink;
    write(line.name, sx(middle[0]), sy(middle[1]) - 11, 'center');
  }
  ctx.restore();

  // Rahmen des Blattes.
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(...sheet);
  ctx.strokeStyle = palette.edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(sheet[0] + 5, sheet[1] + 5, sheet[2] - 10, sheet[3] - 10);

  // Windrose in der oberen rechten Ecke des Blattes.
  if (sheet[2] > 520) {
    const R = 24;
    ctx.save();
    ctx.translate(sheet[0] + sheet[2] - R - 26, sheet[1] + R + 34);
    ctx.strokeStyle = ctx.fillStyle = palette.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.62, 0, TURN);
    ctx.globalAlpha = 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
    for (let step = 0; step < 8; step++) {
      const angle = (step * Math.PI) / 4 - Math.PI / 2;
      const reach = step % 2 ? R * 0.55 : R;
      for (const side of [0.5, -0.5]) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
        ctx.lineTo(Math.cos(angle + side) * reach * 0.2, Math.sin(angle + side) * reach * 0.2);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fillStyle = side > 0 ? palette.ink : palette.paper;
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.fillStyle = palette.ink;
    ctx.font = `600 15px ${palette.display}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('N', 0, -R - 2);
    ctx.restore();
  }

  // Der Pinsel unter dem Zeiger.
  if (scene.brush) {
    ctx.beginPath();
    ctx.arc(
      sx(scene.brush.at[0]),
      sy(scene.brush.at[1]),
      (scene.brush.width * view.zoom) / 2,
      0,
      TURN,
    );
    ctx.strokeStyle = palette.ink;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // Maßstab unten links in der Ecke des Blattes.
  const scale = map.scale?.kmPerUnit;
  if (scale && sheet[2] > 260) {
    const bar = scaleBar(scale / view.zoom, Math.min(150, sheet[2] * 0.3));
    ctx.save();
    ctx.translate(sheet[0] + 22, sheet[1] + sheet[3] - 24);
    for (let part = 0; part < 4; part++) {
      ctx.fillStyle = part % 2 ? palette.paper : palette.ink;
      ctx.fillRect((part * bar.px) / 4, 0, bar.px / 4, 5);
    }
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, bar.px, 5);
    ctx.font = `15px ${palette.body}`;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    const text = `${bar.km.toLocaleString('de-DE')} km`;
    ctx.strokeStyle = palette.paper;
    ctx.lineWidth = 3.6;
    ctx.strokeText(text, 0, -4);
    ctx.fillStyle = palette.ink;
    ctx.fillText(text, 0, -4);
    ctx.restore();
  }
}
