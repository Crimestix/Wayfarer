/**
 * Der Zeichner: bringt eine gezeichnete Karte auf die Zeichenfläche – Tinte auf Pergament, unter
 * der Erde heller Strich auf dunklem Fels. Er zeichnet Formen (`shapes.ts`), keine Pinselstriche,
 * und rechnet nichts über die Welt; was eine Stelle bedeutet, sagt `domain/mapDraw.ts`.
 */
import { TUNNEL_WIDTH } from '../../domain/mapDraw';
import { rngOf, seedOf, smoothNoise } from '../../domain/random';
import type { GameMap, MapGround, MapLine, MapStroke } from '../../domain/schema';
import { formatLength, scaleBar, type View } from './model';
import type { Outline, Shapes } from './shapes';

type Point = readonly [number, number];
type Ctx = CanvasRenderingContext2D;

export interface Palette {
  /** Das Blatt – und der Hof um Schrift und Zeichen. */
  paper: string;
  /** Der begehbare Boden, wo Wasser, Fels oder Abgrund der Grund der Karte sind. */
  floor: string;
  edge: string;
  ink: string;
  inkSoft: string;
  canopy: string;
  canopyShade: string;
  /** Hut der Pilze. */
  cap: string;
  water: string;
  waterLine: string;
  river: string;
  road: string;
  snow: string;
  /** Schimmer im Fels um die Höhlen. */
  glow: string;
  /** Hervorhebung für das Gewählte. */
  mark: string;
  ground: Record<MapGround, string>;
  display: string;
  body: string;
}

function rgb(color: string): [number, number, number] {
  const text = color.trim();
  const parts = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(text);
  if (parts) return [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const hex = text.replace('#', '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
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
  const tints = {
    forest: read('--map-forest'),
    hills: read('--map-hills'),
    mountains: read('--map-mountains'),
    swamp: read('--map-swamp'),
    desert: read('--map-desert'),
    snow: read('--map-snow'),
  };
  if (level === 'surface') {
    const paper = read('--map-paper');
    const ink = read('--map-ink');
    return {
      paper,
      floor: paper,
      edge: read('--map-paper-edge'),
      ink,
      inkSoft: read('--map-ink-soft'),
      canopy: read('--map-canopy'),
      canopyShade: read('--map-canopy-shade'),
      cap: read('--map-canopy'),
      water: read('--map-water'),
      waterLine: read('--map-water-line'),
      river: read('--map-river'),
      road: read('--map-road'),
      snow: read('--map-snow'),
      glow: read('--map-paper-edge'),
      mark: read('--blood-bright'),
      ground: {
        plain: paper,
        water: read('--map-water'),
        ...tints,
        // Gelände des Unterreichs, falls es auf einer Karte der Oberwelt liegt.
        rock: mix(paper, ink, 0.4),
        cave: paper,
        fungus: tints.forest,
        rubble: tints.hills,
        chasm: mix(paper, ink, 0.85),
      },
      ...fonts,
    };
  }
  const rock = read('--map-rock');
  const cave = read('--map-cave');
  const ink = read('--map-rock-ink');
  const dim = (color: string, share = 0.3) => mix(cave, color, share);
  const water = mix(rock, read('--map-river'), 0.62);
  return {
    paper: rock,
    floor: cave,
    edge: read('--map-rock-edge'),
    ink,
    inkSoft: mix(rock, ink, 0.55),
    canopy: dim(read('--map-canopy'), 0.5),
    canopyShade: dim(read('--map-canopy-shade'), 0.5),
    cap: read('--map-fungus-cap'),
    water,
    waterLine: mix(water, ink, 0.45),
    river: mix(water, ink, 0.5),
    road: read('--gold'),
    snow: dim(read('--map-snow'), 0.6),
    glow: read('--map-glow'),
    mark: read('--gold-bright'),
    ground: {
      rock,
      cave,
      plain: cave,
      fungus: read('--map-fungus'),
      rubble: read('--map-rubble'),
      chasm: read('--map-chasm'),
      water,
      // Gelände der Oberwelt, falls es auf einer Karte des Unterreichs liegt.
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

/** Papier: feine Körnung und große, weiche Flecken – einmal erzeugt, immer gleich. */
export interface Textures {
  grain: HTMLCanvasElement;
  stains: HTMLCanvasElement;
}

export function makeTextures(level: GameMap['level']): Textures {
  const grain = document.createElement('canvas');
  grain.width = grain.height = 240;
  const g = grain.getContext('2d')!;
  const speck = g.createImageData(240, 240);
  const rng = rngOf(seedOf('karte', 'korn'));
  for (let i = 0; i < speck.data.length; i += 4) {
    const light = rng.next() > 0.5;
    const value = light ? 255 : 30;
    speck.data[i] = value;
    speck.data[i + 1] = light ? 246 : 20;
    speck.data[i + 2] = light ? 225 : 10;
    speck.data[i + 3] = Math.round(rng.next() * (light ? 20 : 26));
  }
  g.putImageData(speck, 0, 0);

  const stains = document.createElement('canvas');
  [stains.width, stains.height] = [160, 112];
  const s = stains.getContext('2d')!;
  const blot = s.createImageData(160, 112);
  const seed = seedOf('karte', 'flecken');
  const tone = level === 'surface' ? [112, 78, 34] : [6, 4, 12];
  for (let j = 0; j < 112; j++)
    for (let i = 0; i < 160; i++) {
      const cloud =
        smoothNoise(seed, i / 26, j / 26) * 0.6 +
        smoothNoise(seed + 3, i / 9, j / 9) * 0.3 +
        smoothNoise(seed + 5, i / 3, j / 3) * 0.1;
      const k = (j * 160 + i) * 4;
      blot.data[k] = tone[0]!;
      blot.data[k + 1] = tone[1]!;
      blot.data[k + 2] = tone[2]!;
      blot.data[k + 3] = Math.round(Math.max(0, cloud - 0.42) * (level === 'surface' ? 150 : 230));
    }
  s.putImageData(blot, 0, 0);
  return { grain, stains };
}

export type Draft =
  | { kind: 'ground'; ground: MapGround; width: number; points: Point[] }
  | { kind: 'rect'; ground: MapGround; from: Point; to: Point }
  | { kind: 'line'; line: MapLine['kind']; points: Point[] };

export interface Scene {
  map: GameMap;
  view: View;
  /** Größe der Zeichenfläche in Bildschirmpunkten. */
  width: number;
  height: number;
  dpr: number;
  /** Umrisse des Geländes und Stellen der Zeichen. */
  shapes: Shapes;
  /** Beschriftung je Kartenpunkt. */
  labels: ReadonlyMap<string, string>;
  /** Was gerade gezogen wird. */
  draft: Draft | null;
  /** Kennung der gewählten Linie oder des gewählten Punktes. */
  selected: string | null;
  /** Der Pinsel unter dem Zeiger: Stelle der Karte und Breite. */
  brush: { at: Point; width: number } | null;
}

/** Gelände, das als Fläche mit Randlinie gezeichnet wird; alles andere ist Tönung auf dem Blatt. */
const SOLID: readonly MapGround[] = ['water', 'chasm', 'rock'];

const TURN = Math.PI * 2;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Zeichnet die Karte. */
export function drawMap(ctx: Ctx, textures: Textures, scene: Scene, palette: Palette): void {
  const { map, view, width, height, dpr, shapes } = scene;
  const frame = map.frame;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!frame) return;
  const below = map.level === 'underground';
  const sx = (x: number) => (x - view.x) * view.zoom;
  const sy = (y: number) => (y - view.y) * view.zoom;
  const sheet = [sx(0), sy(0), frame.width * view.zoom, frame.height * view.zoom] as const;

  /** Legt die Umrisse eines Geländes als Pfad an – nur, was im Bild liegt. */
  const trace = (outlines: readonly Outline[] | undefined, pad = 0): boolean => {
    ctx.beginPath();
    let any = false;
    for (const outline of outlines ?? []) {
      const box = outline.box;
      if (
        sx(box[2]) < -pad ||
        sy(box[3]) < -pad ||
        sx(box[0]) > width + pad ||
        sy(box[1]) > height + pad
      )
        continue;
      const points = outline.points;
      ctx.moveTo(sx(points[0]![0]), sy(points[0]![1]));
      for (let i = 1; i < points.length; i++) ctx.lineTo(sx(points[i]![0]), sy(points[i]![1]));
      ctx.closePath();
      any = true;
    }
    return any;
  };
  /** Zieht den angelegten Pfad nach. */
  const ink = (color: string, lineWidth: number, alpha = 1, dash: number[] = []) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = alpha;
    ctx.setLineDash(dash);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  };
  /** Ein Pinselstrich, solange er gezogen wird. */
  const paint = (
    stroke: { points: readonly Point[]; width: number; cap: MapStroke['cap'] },
    color: string,
  ) => {
    const points = stroke.points;
    const widthPx = stroke.width * view.zoom;
    if (!points.length) return;
    ctx.fillStyle = ctx.strokeStyle = color;
    ctx.beginPath();
    if (points.length === 1) {
      ctx.arc(sx(points[0]![0]), sy(points[0]![1]), widthPx / 2, 0, TURN);
      ctx.fill();
      return;
    }
    ctx.moveTo(sx(points[0]![0]), sy(points[0]![1]));
    for (let i = 1; i < points.length; i++) ctx.lineTo(sx(points[i]![0]), sy(points[i]![1]));
    ctx.lineWidth = widthPx;
    ctx.stroke();
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
  /** Breite eines Ganges auf dem Schirm. */
  const tunnel = Math.max(4, TUNNEL_WIDTH * view.zoom);
  const strokeLine = (kind: MapLine['kind'], points: readonly Point[]) => {
    curve(points);
    if (kind === 'road' && below) {
      // Der Gang selbst ist aus dem Fels geschnitten; die Punktlinie zeigt seinen Verlauf.
      ink(palette.road, 1.3, 0.8, [1, 5]);
    } else if (kind === 'road') {
      ink(palette.paper, 4.6);
      ink(palette.road, 2.1);
    } else if (kind === 'path') {
      ink(palette.road, 1.5, 1, [5, 4]);
    } else if (kind === 'river') {
      ink(palette.river, clamp(2.2 * view.zoom ** 0.45, 1.4, 6));
    } else {
      ink(palette.inkSoft, 1.5, 1, [10, 5, 2, 5]);
    }
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

  // Der Grund – und die Tönung des Geländes, das keine eigene Fläche ist.
  const flat = !SOLID.includes(map.ground);
  ctx.fillStyle = flat ? palette.ground[map.ground] : palette.floor;
  ctx.fillRect(...sheet);
  for (const [ground, outlines] of Object.entries(shapes.areas) as [MapGround, Outline[]][]) {
    if (SOLID.includes(ground) || (flat && ground === map.ground)) continue;
    if (!trace(outlines, 8)) continue;
    ctx.fillStyle = palette.ground[ground];
    ctx.fill('evenodd');
    // Ein weicher Saum statt einer harten Kante.
    ink(palette.ground[ground], 7, 0.45);
  }

  // Papier: große, weiche Flecken über das ganze Blatt, darüber die Körnung.
  const texture = () => {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(textures.stains, ...sheet);
    const grain = ctx.createPattern(textures.grain, 'repeat');
    if (grain) {
      ctx.translate(sheet[0], sheet[1]);
      ctx.fillStyle = grain;
      ctx.fillRect(0, 0, sheet[2], sheet[3]);
    }
    ctx.restore();
  };

  const halo = (line: MapLine) => {
    curve(line.points);
    ink(palette.mark, line.kind === 'road' && below ? tunnel + 6 : 11, 0.5);
  };
  // Flüsse zuerst: Wo sie in einen See oder ins Meer münden, verschwinden sie im Wasser.
  for (const line of map.lines)
    if (line.kind === 'river') {
      if (line.id === scene.selected) halo(line);
      strokeLine(line.kind, line.points);
    }

  const sea = shapes.areas.water;
  if (!below) {
    // Der nachgedunkelte Rand des Blattes.
    ctx.beginPath();
    ctx.rect(...sheet);
    ink(palette.edge, 26, 0.45);
    if (trace(sea, 60)) {
      // Der Ufersaum auf dem Land, dann das Wasser mit seinen Wellenlinien vor der Küste.
      ink(palette.edge, 13, 0.6);
      ctx.fillStyle = palette.water;
      ctx.fill('evenodd');
      ctx.save();
      ctx.clip('evenodd');
      for (let ring = 4; ring >= 1; ring--) {
        ink(palette.waterLine, ring * 7, 0.24 + (4 - ring) * 0.09);
        ink(palette.water, ring * 7 - 1.1);
      }
      ctx.restore();
    }
    texture();
    if (trace(sea, 4)) ink(palette.ink, 1.4);
  } else {
    if (trace(sea, 30)) {
      ctx.fillStyle = palette.water;
      ctx.fill('evenodd');
      ctx.save();
      ctx.clip('evenodd');
      for (let ring = 2; ring >= 1; ring--) {
        ink(palette.waterLine, ring * 8, 0.3 + (2 - ring) * 0.15);
        ink(palette.water, ring * 8 - 1.1);
      }
      ctx.restore();
      ink(palette.inkSoft, 1.1);
    }
    const chasm = shapes.areas.chasm;
    if (trace(chasm, 20)) {
      ctx.fillStyle = palette.ground.chasm;
      ctx.fill('evenodd');
      // Kurze Striche von der Kante in die Tiefe.
      ctx.save();
      ctx.clip('evenodd');
      ctx.lineCap = 'butt';
      ink(palette.ink, 12, 0.5, [1, 3.1]);
      ctx.restore();
      ink(palette.ink, 1.2);
    }
    const rock = shapes.areas.rock;
    if (trace(rock, 30)) {
      // Schatten am Fuß der Wände, dann der Fels mit Schimmer und Schraffur.
      ink(palette.paper, 7, 0.5);
      ctx.fillStyle = palette.ground.rock;
      ctx.fill('evenodd');
      ctx.save();
      ctx.clip('evenodd');
      ink(palette.glow, 34, 0.07);
      ink(palette.glow, 16, 0.1);
      ctx.lineCap = 'butt';
      ink(palette.ink, 13, 0.42, [1.1, 3.3]);
      ink(palette.ink, 24, 0.22, [1.1, 7.7]);
      ctx.restore();
    }
    texture();
    if (trace(rock, 4)) ink(palette.ink, 1.6);
  }
  ctx.lineCap = ctx.lineJoin = 'round';

  for (const line of map.lines)
    if (line.kind === 'border') {
      if (line.id === scene.selected) halo(line);
      strokeLine(line.kind, line.points);
    }

  // Zeichen: Bäume, Hügel, Gipfel, Schilf, Dünen, Pilze, Steine – von hinten nach vorn.
  for (const site of shapes.sites) {
    const size = site.spread * view.zoom;
    const [x, y] = [sx(site.x), sy(site.y)];
    if (x < -size * 2 || y < -size * 2 || x > width + size * 2 || y > height + size * 3) continue;
    const roll = site.roll;
    if (site.symbol === 'peak') {
      const z = clamp(size * 0.5, 5, 90) * (0.65 + roll * 0.75);
      const t = z * (1.05 + roll * 0.35);
      const [ax, ay] = [x + (roll - 0.5) * z * 0.15, y - t];
      ctx.beginPath();
      ctx.moveTo(x - z, y);
      ctx.quadraticCurveTo(x - z * 0.4, y - t * 0.55, ax, ay);
      ctx.quadraticCurveTo(x + z * 0.45, y - t * 0.5, x + z, y);
      ctx.fillStyle = palette.paper;
      ctx.fill();
      ink(palette.ink, 1.2);
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
      ink(palette.ink, 0.75, 0.75);
      if (roll > 0.62) {
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
      const z = clamp(size * 0.36, 4, 60) * (0.8 + roll * 0.4);
      ctx.beginPath();
      ctx.moveTo(x - z, y);
      ctx.quadraticCurveTo(x, y - z * 1.05, x + z, y);
      ink(palette.ink, 1);
      ctx.beginPath();
      ctx.moveTo(x + z * 0.35, y - z * 0.38);
      ctx.lineTo(x + z * 0.2, y - z * 0.08);
      ctx.moveTo(x + z * 0.62, y - z * 0.22);
      ctx.lineTo(x + z * 0.5, y - z * 0.02);
      ink(palette.ink, 0.7);
    } else if (site.symbol === 'tree') {
      const r = clamp(size * 0.36, 2.2, 44) * (0.75 + roll * 0.5);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - r * 0.6);
      ink(palette.ink, Math.max(0.6, r * 0.16));
      ctx.beginPath();
      ctx.arc(x, y - r * 1.25, r, 0, TURN);
      ctx.fillStyle = palette.canopy;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + r * 0.18, y - r * 1.2, r * 0.78, -0.6, 1.9);
      ink(palette.canopyShade, Math.max(0.8, r * 0.35));
      ctx.beginPath();
      ctx.arc(x, y - r * 1.25, r, 0, TURN);
      ink(palette.ink, Math.max(0.55, r * 0.13));
    } else if (site.symbol === 'reed') {
      const z = clamp(size * 0.27, 3.5, 30);
      ctx.beginPath();
      ctx.moveTo(x - z * 1.2, y);
      ctx.lineTo(x + z * 1.2, y);
      for (const d of [-0.6, 0, 0.6]) {
        ctx.moveTo(x + d * z, y - 1);
        ctx.lineTo(x + d * z * 1.3, y - z * (d === 0 ? 1.1 : 0.8));
      }
      ink(palette.river, 0.9);
    } else if (site.symbol === 'mushroom') {
      const r = clamp(size * 0.36, 2.4, 40) * (0.7 + roll * 0.6);
      const top = y - r * (0.8 + roll * 0.5);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, top);
      ink(palette.ink, Math.max(0.7, r * 0.2));
      ctx.beginPath();
      ctx.ellipse(x, top, r, r * 0.62, 0, Math.PI, TURN);
      ctx.closePath();
      ctx.fillStyle = palette.cap;
      ctx.fill();
      ink(palette.ink, Math.max(0.55, r * 0.12));
    } else if (site.symbol === 'stone') {
      const z = clamp(size * 0.23, 2.2, 26);
      for (const [dx, dy, scale] of [
        [-0.9, 0, 1],
        [0.75, -0.25, 0.7],
        [0.15, 0.6, 0.55],
      ] as const) {
        ctx.beginPath();
        ctx.ellipse(x + dx * z, y + dy * z, z * scale * 0.8, z * scale * 0.55, roll * 3, 0, TURN);
        ink(palette.inkSoft, 0.9);
      }
    } else {
      const z = clamp(size * 0.32, 4, 50);
      ctx.beginPath();
      ctx.moveTo(x - z, y);
      ctx.quadraticCurveTo(x - z * 0.3, y - z * 0.55, x + z * 0.25, y - z * 0.12);
      ctx.quadraticCurveTo(x + z * 0.6, y + z * 0.08, x + z, y - z * 0.05);
      ink(palette.inkSoft, 0.9);
    }
  }

  for (const line of map.lines)
    if (line.kind === 'road' || line.kind === 'path') {
      if (line.id === scene.selected) halo(line);
      strokeLine(line.kind, line.points);
    }

  // Was gerade gezogen wird – noch als Pinselstrich; beim Loslassen wird daraus die Form.
  const draft = scene.draft;
  if (draft?.kind === 'ground') {
    ctx.globalAlpha = 0.75;
    paint({ points: draft.points, width: draft.width, cap: 'round' }, palette.ground[draft.ground]);
    ctx.globalAlpha = 1;
  } else if (draft?.kind === 'rect') {
    const box = [
      sx(Math.min(draft.from[0], draft.to[0])),
      sy(Math.min(draft.from[1], draft.to[1])),
      Math.abs(draft.to[0] - draft.from[0]) * view.zoom,
      Math.abs(draft.to[1] - draft.from[1]) * view.zoom,
    ] as const;
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = palette.ground[draft.ground];
    ctx.fillRect(...box);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 1;
    ctx.strokeRect(...box);
  } else if (draft) {
    if (draft.line === 'road' && below) {
      curve(draft.points);
      ink(palette.floor, tunnel, 0.85);
    }
    strokeLine(draft.line, draft.points);
  }

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
    ink(palette.ink, 1.4);
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
  ctx.strokeStyle = below ? palette.inkSoft : palette.ink;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.strokeRect(sheet[0] + 5, sheet[1] + 5, sheet[2] - 10, sheet[3] - 10);
  ctx.globalAlpha = 1;

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
    ink(palette.ink, 1, 0.7, [4, 3]);
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
    const text = formatLength(bar.km);
    ctx.strokeStyle = palette.paper;
    ctx.lineWidth = 3.6;
    ctx.strokeText(text, 0, -4);
    ctx.fillStyle = palette.ink;
    ctx.fillText(text, 0, -4);
    ctx.restore();
  }
}
