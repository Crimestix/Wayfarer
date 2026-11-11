/**
 * Die Weltkarte: der ganze Planet flach ausgebreitet (Länge nach rechts, Breite nach oben), zum
 * Verschieben und Vergrößern. Zeichnet Meer, Land mit Gelände, Seen, Flüsse, Küsten, das Gradnetz
 * und die Orte. Rechnet nichts Fachliches – das steht in `model.ts` und `domain/geo.ts`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Scan } from 'lucide-react';
import { NODATA, ringBounds, wrapLon, type HeightGrid, type LonLat } from '../../domain/geo';
import { iceShare } from '../../domain/geoClimate';
import { IconButton } from '../../ui';
import { isOwnLand, type Planet } from './model';

export interface MapPlace {
  id: string;
  name: string;
  geo: LonLat;
  /** Orte ohne übergeordneten Ort mit Lage: Sie tragen ihren Namen schon aus der Ferne. */
  major: boolean;
}

/** Eine Landmasse, die gerade eingepasst wird: Ringe flach als Länge, Breite. */
export interface DraftShape {
  rings: number[][];
  holes: number[][];
}

/** Die Fläche eines Ortes: die Küsten seiner Landmassen, flach als Länge, Breite. */
export interface AreaShape {
  rings: readonly (readonly number[])[];
  holes: readonly (readonly number[])[];
}

export interface MapArea {
  id: string;
  name: string;
  /** Die Mitte der Fläche. */
  at: LonLat;
}

export interface MapView {
  lon: number;
  lat: number;
  /** Bildpunkte je Grad. */
  scale: number;
}

interface Props {
  planet: Planet;
  grid: HeightGrid | null;
  places: MapPlace[];
  selectedId: string | null;
  /** Wo die Gruppe ist. */
  party: LonLat | null;
  /** Es wird gerade eine Lage gesucht: Der Zeiger wird zum Fadenkreuz. */
  placing: boolean;
  /** Springt dorthin, wenn sich der Wert ändert. */
  focus: LonLat | null;
  /** Eine Landmasse, die gerade eingepasst wird – hervorgehoben über der Karte. */
  draft?: DraftShape | null;
  /** Die Fläche des gewählten Ortes (ein Kontinent, eine Kontinentalwelt) – leicht hervorgehoben. */
  highlight?: AreaShape | null;
  /** Namen der Orte, die eine Fläche sind (Kontinente) – stehen aus der Ferne auf der Karte. */
  areas?: readonly MapArea[];
  onPick: (point: LonLat) => void;
  onSelect: (placeId: string) => void;
  onHover: (point: LonLat | null) => void;
}

const MAX_SCALE = 600;
const TOKENS = {
  sea: '--terrain-water',
  low: '--terrain-grassland',
  wood: '--terrain-forest',
  hill: '--terrain-hills',
  rock: '--terrain-mountains',
  snow: '--terrain-arctic',
  ice: '--terrain-ice',
  ink: '--bg-void',
  line: '--line-strong',
  gold: '--gold-bright',
  text: '--ink',
  blood: '--blood-bright',
} as const;

type Rgb = [number, number, number];

/** Liest die Farben des Designs und rechnet sie in Zahlen um, damit sich Gelände mischen lässt. */
export function readColors(): Record<keyof typeof TOKENS, { css: string; rgb: Rgb }> {
  const style = getComputedStyle(document.documentElement);
  const probe = document.createElement('canvas');
  probe.width = probe.height = 1;
  const ctx = probe.getContext('2d', { willReadFrequently: true })!;
  const out = {} as Record<keyof typeof TOKENS, { css: string; rgb: Rgb }>;
  for (const [key, token] of Object.entries(TOKENS) as [keyof typeof TOKENS, string][]) {
    const css = style.getPropertyValue(token).trim() || '#888';
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    out[key] = { css, rgb: [r!, g!, b!] };
  }
  return out;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/**
 * Das Gelände als Bild: Farbe nach Höhe, dazu Licht von Nordwesten. Einmal je Höhenraster.
 * Zu den Polen hin liegt Eis über dem Land (`iceShare`): Die Pole sind weiß, weiter zum Äquator
 * nur noch die Gipfel.
 * `factor` vergrößert das Bild; die Höhen werden dabei zwischen den Zellen gemittelt, damit das
 * Gelände auch aus der Nähe weich bleibt statt Kästchen zu zeigen.
 */
export function reliefImage(
  grid: HeightGrid,
  colors: ReturnType<typeof readColors>,
  factor = 1,
): HTMLCanvasElement {
  const width = grid.width * factor;
  const height = grid.height * factor;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(width, height);
  const stops: [number, Rgb][] = [
    [0, colors.low.rgb],
    [500, colors.wood.rgb],
    [1500, colors.hill.rgb],
    [3200, colors.rock.rgb],
    [6000, colors.snow.rgb],
  ];
  const tint = (value: number): Rgb => {
    for (let i = 1; i < stops.length; i++) {
      const [to, color] = stops[i]!;
      const [from, before] = stops[i - 1]!;
      if (value <= to) return mix(before, color, Math.max(0, (value - from) / (to - from)));
    }
    return stops[stops.length - 1]![1];
  };
  const cell = (x: number, y: number): number => {
    const cx = ((x % grid.width) + grid.width) % grid.width;
    const cy = Math.max(0, Math.min(grid.height - 1, y));
    return grid.data[cy * grid.width + cx]!;
  };

  // Die Höhen in der Größe des Bildes; ohne Angabe: NaN.
  const heights = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const gy = (y + 0.5) / factor - 0.5;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    for (let x = 0; x < width; x++) {
      const gx = (x + 0.5) / factor - 0.5;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      let sum = 0;
      let weight = 0;
      const add = (value: number, w: number) => {
        if (value === NODATA || w <= 0) return;
        sum += value * w;
        weight += w;
      };
      if (factor === 1) add(cell(x, y), 1);
      else {
        add(cell(x0, y0), (1 - fx) * (1 - fy));
        add(cell(x0 + 1, y0), fx * (1 - fy));
        add(cell(x0, y0 + 1), (1 - fx) * fy);
        add(cell(x0 + 1, y0 + 1), fx * fy);
      }
      heights[y * width + x] = weight > 0 ? sum / weight : NaN;
    }
  }

  for (let y = 0; y < height; y++) {
    // Zeile 0 liegt im Norden.
    const lat = 90 - ((y + 0.5) / height) * 180;
    for (let x = 0; x < width; x++) {
      const value = heights[y * width + x]!;
      if (Number.isNaN(value)) continue;
      const west = heights[y * width + ((x - 1 + width) % width)]!;
      const north = heights[Math.max(0, y - 1) * width + x]!;
      // Gefälle nach Südosten heißt: der Hang zeigt zum Licht.
      const slope =
        ((Number.isNaN(west) ? 0 : value - west) + (Number.isNaN(north) ? 0 : value - north)) *
        factor;
      const light = Math.max(0.62, Math.min(1.3, 1 + slope / 2600));
      const [r, g, b] = mix(tint(value), colors.ice.rgb, iceShare(lat, value));
      const i = (y * width + x) * 4;
      image.data[i] = Math.min(255, r * light);
      image.data[i + 1] = Math.min(255, g * light);
      image.data[i + 2] = Math.min(255, b * light);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** So oft wird ein Ring um den Pol hintereinander angefügt – genug für jede Ansicht der Karte. */
const POLAR_TURNS = 4;

/**
 * Fügt einen Ring als geschlossene Linie in Länge und Breite an – fortlaufend abgewickelt und um
 * `shift` Grad versetzt.
 *
 * Ein Ring um den Pol läuft einmal um die Welt und schließt sich über den Rand der Karte. Er wird
 * mehrfach hintereinander angefügt, von zwei Welten westlich bis zwei Welten östlich: Die Küste
 * darf dabei vor- und zurücklaufen, und die senkrechten Schlusslinien liegen außerhalb von allem,
 * was gezeigt wird. So ein Ring bringt seine Kopien selbst mit und wird nur einmal gezeichnet.
 */
export function addRing(
  path: Path2D,
  ring: readonly number[],
  polar: 'north' | 'south' | null,
  shift = 0,
): void {
  const count = ring.length / 2;
  if (count < 3) return;
  if (!polar) {
    let lon = ring[0]! + shift;
    path.moveTo(lon, ring[1]!);
    for (let i = 1; i < count; i++) {
      lon += wrapLon(ring[i * 2]! - ring[(i - 1) * 2]!);
      path.lineTo(lon, ring[i * 2 + 1]!);
    }
    path.closePath();
    return;
  }
  const closing = wrapLon(ring[0]! - ring[(count - 1) * 2]!);
  let around = closing;
  for (let i = 1; i < count; i++) around += wrapLon(ring[i * 2]! - ring[(i - 1) * 2]!);
  const start = ring[0]! + shift - (POLAR_TURNS / 2) * around;
  let lon = start;
  path.moveTo(lon, ring[1]!);
  for (let turn = 0; turn < POLAR_TURNS; turn++) {
    for (let i = 1; i < count; i++) {
      lon += wrapLon(ring[i * 2]! - ring[(i - 1) * 2]!);
      path.lineTo(lon, ring[i * 2 + 1]!);
    }
    lon += closing;
    path.lineTo(lon, ring[1]!);
  }
  const edge = polar === 'north' ? 90 : -90;
  path.lineTo(lon, edge);
  path.lineTo(start, edge);
  path.closePath();
}

/** Eine Fläche zum Zeichnen. */
export interface LandPath {
  path: Path2D;
  /**
   * Die Fläche reicht um einen Pol und enthält schon alle Kopien der Welt: Sie wird einmal
   * gezeichnet, nicht je Kopie.
   */
  once: boolean;
}

/** Küsten und Gewässer einer Landmasse als eine Fläche. */
export function shapePath(
  rings: readonly { ring: readonly number[]; polar: 'north' | 'south' | null }[],
  holes: readonly (readonly number[])[],
): LandPath {
  const path = new Path2D();
  const once = rings.some((entry) => entry.polar !== null);
  // Neben einem Ring um den Pol braucht auch alles Übrige seine Kopien in derselben Fläche.
  const shifts = once ? [-360, 0, 360] : [0];
  for (const entry of rings)
    if (entry.polar) addRing(path, entry.ring, entry.polar);
    else for (const shift of shifts) addRing(path, entry.ring, null, shift);
  for (const hole of holes) for (const shift of shifts) addRing(path, hole, null, shift);
  return { path, once };
}

/**
 * Das Land als Flächen zum Zeichnen. Die Landmassen der Weltdatei überlappen sich nie und
 * teilen sich eine Fläche. Eine eigene bekommt, was um einen Pol reicht, und jede aus einem Bild
 * eingelesene Landmasse – sie darf über anderem Land liegen, ohne dass sich beides aufhebt.
 */
export function landPaths(planet: Planet): LandPath[] {
  const base = new Path2D();
  const paths: LandPath[] = [{ path: base, once: false }];
  for (const entry of planet.lands) {
    if (!isOwnLand(entry) && !entry.rings.some((s) => s.bounds.polar)) {
      for (const s of entry.rings) addRing(base, s.ring, null);
      for (const s of entry.holes) addRing(base, s.ring, null);
      continue;
    }
    paths.push(
      shapePath(
        entry.rings.map((s) => ({ ring: s.ring, polar: s.bounds.polar })),
        entry.holes.map((s) => s.ring),
      ),
    );
  }
  return paths;
}

const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

interface TerrainShapes {
  lands: LandPath[];
  lakes: Path2D;
  rivers: { path: Path2D; widthKm: number }[];
}

interface TerrainFrame {
  width: number;
  height: number;
  /** Bildpunkte je Grad. */
  scale: number;
  lon: number;
  lat: number;
  dpr: number;
  /** Welche Abbilder der Welt nebeneinander zu sehen sind. */
  copies: number[];
}

/**
 * Malt Meer, Land mit Gelände, Seen, Flüsse und Küsten. Das ist der teure Teil der Karte: jede
 * Landmasse wird an ihrer Küste ausgeschnitten. Er läuft deshalb einmal für das Bild der ganzen
 * Welt (`terrain`) und sonst nur, wenn die Karte stillsteht und nah herangeholt ist.
 */
function paintTerrain(
  ctx: CanvasRenderingContext2D,
  frame: TerrainFrame,
  shapes: TerrainShapes,
  relief: HTMLCanvasElement | null,
  colors: ReturnType<typeof readColors>,
  radiusKm: number,
): void {
  const { width, height, scale, dpr } = frame;
  const px = 1 / scale;
  const geo = (copy: number) =>
    ctx.setTransform(
      scale * dpr,
      0,
      0,
      -scale * dpr,
      (width / 2 + (copy * 360 - frame.lon) * scale) * dpr,
      (height / 2 + frame.lat * scale) * dpr,
    );
  const pixels = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  pixels();
  ctx.fillStyle = colors.sea.css;
  ctx.fillRect(0, 0, width, height);

  for (const copy of frame.copies) {
    // Land: das Gelände, an der Küste scharf abgeschnitten.
    for (const land of shapes.lands) {
      if (land.once && copy !== 0) continue;
      ctx.save();
      geo(copy);
      ctx.clip(land.path, 'evenodd');
      pixels();
      // Land ohne Höhenangabe (etwa aus einem Bild eingelesen) zeigt die Farbe des Tieflands.
      ctx.fillStyle = colors.low.css;
      ctx.fillRect(0, 0, width, height);
      if (relief) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        // Land, das über die Datumsgrenze reicht, liegt zum Teil im Nachbarbild der Welt: Das
        // Gelände wird deshalb auch links und rechts daneben gemalt (um einen Pol noch weiter).
        const reach = land.once ? 2 : 1;
        for (let world = copy - reach; world <= copy + reach; world++) {
          const left = width / 2 + (world * 360 - 180 - frame.lon) * scale;
          if (left > width || left + 360 * scale < 0) continue;
          ctx.drawImage(
            relief,
            left,
            height / 2 + (frame.lat - 90) * scale,
            360 * scale,
            180 * scale,
          );
        }
      }
      ctx.restore();
    }

    geo(copy);
    ctx.fillStyle = colors.sea.css;
    ctx.fill(shapes.lakes, 'evenodd');
    ctx.strokeStyle = colors.sea.css;
    ctx.lineJoin = 'round';
    const kmPerDegree = (2 * Math.PI * radiusKm) / 360;
    for (const river of shapes.rivers) {
      ctx.lineWidth = Math.max(1.2 * px, river.widthKm / kmPerDegree);
      ctx.stroke(river.path);
    }
    ctx.strokeStyle = colors.ink.css;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = px;
    for (const land of shapes.lands) if (!land.once || copy === 0) ctx.stroke(land.path);
    ctx.stroke(shapes.lakes);
    ctx.globalAlpha = 1;
  }
  pixels();
}

/** Breite des Bildes der ganzen Welt in Bildpunkten – gut elf je Grad. */
const TERRAIN_WIDTH = 4096;

export function WorldMap({
  planet,
  grid,
  places,
  selectedId,
  party,
  placing,
  focus,
  draft,
  highlight,
  areas,
  onPick,
  onSelect,
  onHover,
}: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const draftPath = useMemo(() => {
    if (!draft) return null;
    return shapePath(
      draft.rings.map((ring) => ({ ring, polar: ringBounds(ring).polar })),
      draft.holes,
    );
  }, [draft]);
  const highlightPath = useMemo(() => {
    if (!highlight) return null;
    return shapePath(
      highlight.rings.map((ring) => ({ ring, polar: ringBounds(ring).polar })),
      highlight.holes,
    );
  }, [highlight]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<MapView>({ lon: 0, lat: 0, scale: 0 });
  const drag = useRef<{ x: number; y: number; view: MapView; moved: boolean } | null>(null);

  const colors = useMemo(readColors, []);
  const relief = useMemo(() => (grid ? reliefImage(grid, colors) : null), [grid, colors]);
  const shapes = useMemo(() => {
    const lands = landPaths(planet);
    const lakes = new Path2D();
    for (const lake of planet.lakes) addRing(lakes, lake.shape.ring, null);
    const rivers = planet.rivers.map((river) => {
      const path = new Path2D();
      let lon = river.points[0]!;
      path.moveTo(lon, river.points[1]!);
      for (let i = 1; i < river.points.length / 2; i++) {
        lon += wrapLon(river.points[i * 2]! - river.points[(i - 1) * 2]!);
        path.lineTo(lon, river.points[i * 2 + 1]!);
      }
      return { path, widthKm: river.widthKm };
    });
    return { lands, lakes, rivers };
  }, [planet]);

  // Die ganze Welt als fertiges Bild – einmal gemalt, beim Verschieben nur noch hingelegt.
  const terrain = useMemo(() => {
    const image = document.createElement('canvas');
    image.width = TERRAIN_WIDTH;
    image.height = TERRAIN_WIDTH / 2;
    paintTerrain(
      image.getContext('2d')!,
      {
        width: image.width,
        height: image.height,
        scale: image.width / 360,
        lon: 0,
        lat: 0,
        dpr: 1,
        copies: [0],
      },
      shapes,
      relief,
      colors,
      planet.radiusKm,
    );
    return image;
  }, [shapes, relief, colors, planet.radiusKm]);
  // Solange die Karte bewegt wird, zählt Tempo; steht sie still, wird sie scharf nachgezeichnet.
  const [moving, setMoving] = useState(false);
  const settle = useRef<number | undefined>(undefined);
  useEffect(() => {
    setMoving(true);
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => setMoving(false), 180);
    return () => window.clearTimeout(settle.current);
  }, [view]);

  /** Die kleinste Vergrößerung: Die Welt füllt die Fläche in der Breite oder Höhe. */
  const minScale = Math.max(size.width / 360, size.height / 180, 0.5);
  const clamp = useCallback(
    (next: MapView): MapView => {
      const scale = Math.max(minScale, Math.min(MAX_SCALE, next.scale));
      const half = size.height / 2 / scale;
      const lat = half >= 90 ? 0 : Math.max(-90 + half, Math.min(90 - half, next.lat));
      return { lon: wrapLon(next.lon), lat, scale };
    },
    [minScale, size.height],
  );

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Beim ersten Mal und nach Größenänderungen bleibt die Ansicht gültig.
  useEffect(() => {
    if (!size.width) return;
    setView((current) => clamp(current.scale ? current : { lon: 0, lat: 0, scale: minScale }));
  }, [size.width, size.height, clamp, minScale]);

  useEffect(() => {
    if (!focus || !size.width) return;
    setView((current) =>
      clamp({ lon: focus.lon, lat: focus.lat, scale: Math.max(current.scale, minScale * 4) }),
    );
    // Nur ein neues Ziel löst den Sprung aus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const toScreen = useCallback(
    (point: LonLat, copy = 0) => ({
      x: (wrapLon(point.lon - view.lon) + copy * 360) * view.scale + size.width / 2,
      y: (view.lat - point.lat) * view.scale + size.height / 2,
    }),
    [view, size],
  );
  const toGeo = useCallback(
    (x: number, y: number): LonLat => ({
      lon: wrapLon(view.lon + (x - size.width / 2) / view.scale),
      lat: Math.max(-90, Math.min(90, view.lat - (y - size.height / 2) / view.scale)),
    }),
    [view, size],
  );

  // ── Zeichnen ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const element = canvas.current;
    if (!element || !size.width || !view.scale) return;
    const dpr = window.devicePixelRatio || 1;
    const [w, h] = [Math.round(size.width * dpr), Math.round(size.height * dpr)];
    if (element.width !== w || element.height !== h) {
      element.width = w;
      element.height = h;
    }
    const ctx = element.getContext('2d')!;
    const { scale } = view;
    const px = 1 / scale;
    // Wie viele Abbilder der Welt nebeneinander zu sehen sind.
    const span = size.width / 2 / scale;
    const copies: number[] = [];
    for (let k = -1; k <= 1; k++)
      if (k * 360 + 180 - view.lon > -span - 360 && k * 360 - 180 - view.lon < span + 360)
        copies.push(k);
    /** Stellt um auf Länge und Breite; `copy` verschiebt um ganze Welten. */
    const geo = (copy: number) =>
      ctx.setTransform(
        scale * dpr,
        0,
        0,
        -scale * dpr,
        (size.width / 2 + (copy * 360 - view.lon) * scale) * dpr,
        (size.height / 2 + view.lat * scale) * dpr,
      );
    const pixels = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Das Gelände: beim Verschieben und aus der Ferne das fertige Bild der Welt, sonst gestochen
    // scharf aus den Küstenlinien.
    const coarse = moving || scale <= (terrain.width / 360) * 1.15;
    if (coarse) {
      pixels();
      ctx.fillStyle = colors.sea.css;
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = moving ? 'low' : 'high';
      for (const copy of copies)
        ctx.drawImage(
          terrain,
          size.width / 2 + (copy * 360 - 180 - view.lon) * scale,
          size.height / 2 + (view.lat - 90) * scale,
          360 * scale,
          180 * scale,
        );
    } else
      paintTerrain(
        ctx,
        {
          width: size.width,
          height: size.height,
          scale,
          lon: view.lon,
          lat: view.lat,
          dpr,
          copies,
        },
        shapes,
        relief,
        colors,
        planet.radiusKm,
      );

    // Gradnetz
    pixels();
    const step = scale > 40 ? 5 : scale > 12 ? 10 : 30;
    ctx.strokeStyle = colors.text.css;
    ctx.lineWidth = 1;
    const west = view.lon - span;
    for (let lon = Math.ceil(west / step) * step; lon <= view.lon + span; lon += step) {
      const x = (lon - view.lon) * scale + size.width / 2;
      ctx.globalAlpha = wrapLon(lon) === 0 ? 0.22 : 0.08;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, 0);
      ctx.lineTo(Math.round(x) + 0.5, size.height);
      ctx.stroke();
    }
    for (let lat = -90 + step; lat < 90; lat += step) {
      const y = (view.lat - lat) * scale + size.height / 2;
      if (y < 0 || y > size.height) continue;
      ctx.globalAlpha = lat === 0 ? 0.22 : 0.08;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y) + 0.5);
      ctx.lineTo(size.width, Math.round(y) + 0.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Die Fläche des gewählten Ortes: ein Hauch Gold und eine goldene Küste.
    if (highlightPath) {
      for (const copy of copies) {
        if (highlightPath.once && copy !== 0) continue;
        geo(copy);
        ctx.fillStyle = colors.gold.css;
        ctx.globalAlpha = 0.2;
        ctx.fill(highlightPath.path, 'evenodd');
        ctx.globalAlpha = 1;
        ctx.strokeStyle = colors.gold.css;
        ctx.lineWidth = 1.6 * px;
        ctx.stroke(highlightPath.path);
      }
      pixels();
    }

    // Eine Landmasse, die gerade eingepasst wird.
    if (draftPath) {
      for (const copy of copies) {
        if (draftPath.once && copy !== 0) continue;
        geo(copy);
        ctx.fillStyle = colors.gold.css;
        ctx.globalAlpha = 0.45;
        ctx.fill(draftPath.path, 'evenodd');
        ctx.globalAlpha = 1;
        ctx.strokeStyle = colors.gold.css;
        ctx.lineWidth = 1.5 * px;
        ctx.stroke(draftPath.path);
      }
      pixels();
    }

    // Namen der Kontinente: aus der Ferne groß und gesperrt, aus der Nähe treten sie zurück.
    const font = getComputedStyle(element).fontFamily;
    if (areas?.length) {
      const far = scale < minScale * 6;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `600 ${far ? 15 : 13}px ${font}`;
      ctx.letterSpacing = '0.18em';
      for (const copy of copies)
        for (const area of areas) {
          const { x, y } = toScreen(area.at, copy);
          if (x < -160 || x > size.width + 160 || y < -20 || y > size.height + 20) continue;
          const text = area.name.toLocaleUpperCase('de');
          ctx.globalAlpha = far ? 0.9 : 0.45;
          ctx.lineWidth = 3.5;
          ctx.strokeStyle = colors.ink.css;
          ctx.strokeText(text, x, y);
          ctx.fillStyle = area.id === selectedId ? colors.gold.css : colors.text.css;
          ctx.fillText(text, x, y);
        }
      ctx.globalAlpha = 1;
      ctx.letterSpacing = '0px';
      ctx.textAlign = 'start';
    }

    // Orte
    ctx.textBaseline = 'middle';
    const labels = scale > minScale * 2.5;
    for (const copy of copies) {
      for (const place of places) {
        const { x, y } = toScreen(place.geo, copy);
        if (x < -80 || x > size.width + 80 || y < -20 || y > size.height + 20) continue;
        const selected = place.id === selectedId;
        ctx.beginPath();
        ctx.arc(x, y, selected ? 5 : place.major ? 3.5 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = selected ? colors.gold.css : colors.text.css;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = colors.ink.css;
        ctx.stroke();
        if (selected || place.major || labels) {
          ctx.font = `${selected ? 600 : 500} ${selected || place.major ? 14 : 12}px ${font}`;
          ctx.lineWidth = 3;
          ctx.strokeStyle = colors.ink.css;
          ctx.strokeText(place.name, x + 8, y);
          ctx.fillStyle = selected ? colors.gold.css : colors.text.css;
          ctx.fillText(place.name, x + 8, y);
        }
      }
      if (party) {
        const { x, y } = toScreen(party, copy);
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = colors.blood.css;
        ctx.stroke();
      }
    }

    // Maßstab: eine runde Strecke, etwa 120 Bildpunkte lang, auf der Breite der Bildmitte.
    const kmPerPixel =
      ((2 * Math.PI * planet.radiusKm) / 360 / scale) *
      Math.max(0.2, Math.cos((view.lat * Math.PI) / 180));
    const km = NICE.findLast((value) => value / kmPerPixel <= 140) ?? NICE[0]!;
    const length = km / kmPerPixel;
    ctx.fillStyle = colors.ink.css;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(12, size.height - 34, length + 16, 24);
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.text.css;
    ctx.fillRect(20, size.height - 16, length, 2);
    ctx.font = `12px ${font}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${km.toLocaleString('de-DE')} km`, 20, size.height - 20);
  }, [
    view,
    size,
    colors,
    relief,
    shapes,
    draftPath,
    highlightPath,
    terrain,
    moving,
    areas,
    places,
    selectedId,
    party,
    planet,
    toScreen,
    minScale,
  ]);

  // ── Bedienung ─────────────────────────────────────────────────────────────
  const zoomAt = (factor: number, x = size.width / 2, y = size.height / 2) =>
    setView((current) => {
      const scale = Math.max(minScale, Math.min(MAX_SCALE, current.scale * factor));
      // Die Stelle unter dem Zeiger bleibt, wo sie ist.
      const lon = current.lon + (x - size.width / 2) * (1 / current.scale - 1 / scale);
      const lat = current.lat - (y - size.height / 2) * (1 / current.scale - 1 / scale);
      return clamp({ lon, lat, scale });
    });

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX - box.left, event.clientY - box.top);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  });

  const local = (event: { clientX: number; clientY: number }) => {
    const box = canvas.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  return (
    <div className="wf-atlas-map" ref={frame}>
      <canvas
        ref={canvas}
        className="wf-atlas-map__canvas"
        data-placing={placing}
        tabIndex={0}
        aria-label="Weltkarte. Mit der Maus verschieben, mit dem Rad vergrößern, mit Plus und Minus vergrößern, mit den Pfeiltasten verschieben."
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { ...local(event), view, moved: false };
        }}
        onPointerMove={(event) => {
          const at = local(event);
          const start = drag.current;
          if (start) {
            const dx = at.x - start.x;
            const dy = at.y - start.y;
            if (Math.hypot(dx, dy) > 4) start.moved = true;
            if (start.moved)
              setView(
                clamp({
                  lon: start.view.lon - dx / start.view.scale,
                  lat: start.view.lat + dy / start.view.scale,
                  scale: start.view.scale,
                }),
              );
          } else onHover(toGeo(at.x, at.y));
        }}
        onPointerUp={(event) => {
          const start = drag.current;
          drag.current = null;
          if (!start || start.moved) return;
          const at = local(event);
          // Ein Klick auf einen Ort wählt ihn; sonst gilt die Stelle.
          const hit = places.find((place) =>
            [-1, 0, 1].some((copy) => {
              const p = toScreen(place.geo, copy);
              return Math.hypot(p.x - at.x, p.y - at.y) <= 9;
            }),
          );
          if (hit && !placing) onSelect(hit.id);
          else onPick(toGeo(at.x, at.y));
        }}
        onPointerLeave={() => onHover(null)}
        onKeyDown={(event) => {
          const move = 60 / view.scale;
          if (event.key === '+' || event.key === '=') zoomAt(1.5);
          else if (event.key === '-') zoomAt(1 / 1.5);
          else if (event.key === 'ArrowLeft') setView(clamp({ ...view, lon: view.lon - move }));
          else if (event.key === 'ArrowRight') setView(clamp({ ...view, lon: view.lon + move }));
          else if (event.key === 'ArrowUp') setView(clamp({ ...view, lat: view.lat + move }));
          else if (event.key === 'ArrowDown') setView(clamp({ ...view, lat: view.lat - move }));
          else return;
          event.preventDefault();
        }}
      />
      <div className="wf-atlas-map__zoom">
        <IconButton label="Vergrößern" size="sm" onClick={() => zoomAt(1.6)}>
          <Plus />
        </IconButton>
        <IconButton label="Verkleinern" size="sm" onClick={() => zoomAt(1 / 1.6)}>
          <Minus />
        </IconButton>
        <IconButton
          label="Die ganze Welt zeigen"
          size="sm"
          onClick={() => setView(clamp({ lon: 0, lat: 0, scale: minScale }))}
        >
          <Scan />
        </IconButton>
      </div>
    </div>
  );
}
