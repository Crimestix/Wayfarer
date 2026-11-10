/**
 * Die Weltkarte: der ganze Planet flach ausgebreitet (Länge nach rechts, Breite nach oben), zum
 * Verschieben und Vergrößern. Zeichnet Meer, Land mit Gelände, Seen, Flüsse, Küsten, das Gradnetz
 * und die Orte. Rechnet nichts Fachliches – das steht in `model.ts` und `domain/geo.ts`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Scan } from 'lucide-react';
import { NODATA, wrapLon, type HeightGrid, type LonLat } from '../../domain/geo';
import { IconButton } from '../../ui';
import type { Planet } from './model';

export interface MapPlace {
  id: string;
  name: string;
  geo: LonLat;
  /** Orte ohne übergeordneten Ort mit Lage: Sie tragen ihren Namen schon aus der Ferne. */
  major: boolean;
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

/** Das Gelände als Bild: Farbe nach Höhe, dazu Licht von Nordwesten. Einmal je Höhenraster. */
export function reliefImage(
  grid: HeightGrid,
  colors: ReturnType<typeof readColors>,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = grid.width;
  canvas.height = grid.height;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(grid.width, grid.height);
  const stops: [number, Rgb][] = [
    [0, colors.low.rgb],
    [500, colors.wood.rgb],
    [1500, colors.hill.rgb],
    [3200, colors.rock.rgb],
    [6000, colors.snow.rgb],
  ];
  const tint = (height: number): Rgb => {
    for (let i = 1; i < stops.length; i++) {
      const [to, color] = stops[i]!;
      const [from, before] = stops[i - 1]!;
      if (height <= to) return mix(before, color, Math.max(0, (height - from) / (to - from)));
    }
    return stops[stops.length - 1]![1];
  };
  const at = (x: number, y: number): number => {
    const cx = ((x % grid.width) + grid.width) % grid.width;
    const cy = Math.max(0, Math.min(grid.height - 1, y));
    return grid.data[cy * grid.width + cx]!;
  };
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const value = at(x, y);
      const i = (y * grid.width + x) * 4;
      if (value === NODATA) continue;
      const west = at(x - 1, y);
      const north = at(x, y - 1);
      // Gefälle nach Südosten heißt: der Hang zeigt zum Licht.
      const slope = (west === NODATA ? 0 : value - west) + (north === NODATA ? 0 : value - north);
      const light = Math.max(0.62, Math.min(1.3, 1 + slope / 2600));
      const [r, g, b] = tint(value);
      image.data[i] = Math.min(255, r * light);
      image.data[i + 1] = Math.min(255, g * light);
      image.data[i + 2] = Math.min(255, b * light);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Fügt einen Ring als geschlossene Linie in Länge und Breite an – fortlaufend abgewickelt. */
export function addRing(
  path: Path2D,
  ring: readonly number[],
  polar: 'north' | 'south' | null,
): void {
  const count = ring.length / 2;
  if (count < 3) return;
  let lon = ring[0]!;
  path.moveTo(lon, ring[1]!);
  for (let i = 1; i < count; i++) {
    lon += wrapLon(ring[i * 2]! - ring[(i - 1) * 2]!);
    path.lineTo(lon, ring[i * 2 + 1]!);
  }
  if (polar) {
    // Ein Ring um den Pol schließt sich über den Rand der Karte.
    const edge = polar === 'north' ? 90 : -90;
    const end = lon + wrapLon(ring[0]! - ring[(count - 1) * 2]!);
    path.lineTo(end, ring[1]!);
    path.lineTo(end, edge);
    path.lineTo(ring[0]!, edge);
  }
  path.closePath();
}

const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];

export function WorldMap({
  planet,
  grid,
  places,
  selectedId,
  party,
  placing,
  focus,
  onPick,
  onSelect,
  onHover,
}: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<MapView>({ lon: 0, lat: 0, scale: 0 });
  const drag = useRef<{ x: number; y: number; view: MapView; moved: boolean } | null>(null);

  const colors = useMemo(readColors, []);
  const relief = useMemo(() => (grid ? reliefImage(grid, colors) : null), [grid, colors]);
  const shapes = useMemo(() => {
    const land = new Path2D();
    for (const entry of planet.lands) {
      for (const s of entry.rings) addRing(land, s.ring, s.bounds.polar);
      for (const s of entry.holes) addRing(land, s.ring, null);
    }
    const lakes = new Path2D();
    for (const lake of planet.lakes) addRing(lakes, lake.shape.ring, null);
    const rivers = planet.doc.rivers.map((river) => {
      const path = new Path2D();
      let lon = river.points[0]!;
      path.moveTo(lon, river.points[1]!);
      for (let i = 1; i < river.points.length / 2; i++) {
        lon += wrapLon(river.points[i * 2]! - river.points[(i - 1) * 2]!);
        path.lineTo(lon, river.points[i * 2 + 1]!);
      }
      return { path, widthKm: river.widthKm };
    });
    return { land, lakes, rivers };
  }, [planet]);

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
    element.width = Math.round(size.width * dpr);
    element.height = Math.round(size.height * dpr);
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

    pixels();
    ctx.fillStyle = colors.sea.css;
    ctx.fillRect(0, 0, size.width, size.height);

    for (const copy of copies) {
      // Land: das Gelände, an der Küste scharf abgeschnitten.
      ctx.save();
      geo(copy);
      ctx.clip(shapes.land, 'evenodd');
      pixels();
      if (relief) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
          relief,
          size.width / 2 + (copy * 360 - 180 - view.lon) * scale,
          size.height / 2 + (view.lat - 90) * scale,
          360 * scale,
          180 * scale,
        );
      } else {
        ctx.fillStyle = colors.low.css;
        ctx.fillRect(0, 0, size.width, size.height);
      }
      ctx.restore();

      geo(copy);
      ctx.fillStyle = colors.sea.css;
      ctx.fill(shapes.lakes, 'evenodd');
      ctx.strokeStyle = colors.sea.css;
      ctx.lineJoin = 'round';
      const kmPerDegree = (2 * Math.PI * planet.radiusKm) / 360;
      for (const river of shapes.rivers) {
        ctx.lineWidth = Math.max(1.2 * px, river.widthKm / kmPerDegree);
        ctx.stroke(river.path);
      }
      ctx.strokeStyle = colors.ink.css;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = px;
      ctx.stroke(shapes.land);
      ctx.stroke(shapes.lakes);
      ctx.globalAlpha = 1;
    }

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

    // Orte
    const font = getComputedStyle(element).fontFamily;
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
  }, [view, size, colors, relief, shapes, places, selectedId, party, planet, toScreen, minScale]);

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
