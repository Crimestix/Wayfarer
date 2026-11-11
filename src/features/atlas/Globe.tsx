/**
 * Die Kugel: derselbe Planet wie auf der Weltkarte, als drehbarer Globus. Gezeichnet wird ohne
 * weitere Bibliothek: Für jeden Bildpunkt der Scheibe wird ausgerechnet, welche Stelle des
 * Planeten dort zu sehen ist, und ihre Farbe aus einem einmal gemalten Bild der ganzen Welt
 * genommen. Ziehen dreht, das Rad vergrößert.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Scan } from 'lucide-react';
import { wrapLon, type HeightGrid, type LonLat } from '../../domain/geo';
import { IconButton } from '../../ui';
import type { Planet } from './model';
import { addRing, readColors, reliefImage, type MapPlace } from './WorldMap';

interface Props {
  planet: Planet;
  grid: HeightGrid | null;
  places: MapPlace[];
  selectedId: string | null;
  party: LonLat | null;
  placing: boolean;
  focus: LonLat | null;
  onPick: (point: LonLat) => void;
  onSelect: (placeId: string) => void;
  onHover: (point: LonLat | null) => void;
}

const RAD = Math.PI / 180;
const TEXTURE_WIDTH = 4096;
const MAX_ZOOM = 12;

interface Texture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Malt die ganze Welt einmal flach – Meer, Land mit Gelände, Seen, Flüsse, Küsten. */
function worldTexture(
  planet: Planet,
  grid: HeightGrid | null,
  colors: ReturnType<typeof readColors>,
): Texture {
  const width = TEXTURE_WIDTH;
  const height = width / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const scale = width / 360;
  const land = new Path2D();
  for (const entry of planet.lands) {
    for (const s of entry.rings) addRing(land, s.ring, s.bounds.polar);
    for (const s of entry.holes) addRing(land, s.ring, null);
  }
  const lakes = new Path2D();
  for (const lake of planet.lakes) addRing(lakes, lake.shape.ring, null);
  // In der Größe des Weltbildes gerechnet, damit das Gelände auch vergrößert weich bleibt.
  const relief = grid
    ? reliefImage(grid, colors, Math.max(1, Math.round(width / grid.width)))
    : null;

  ctx.fillStyle = colors.sea.css;
  ctx.fillRect(0, 0, width, height);
  // Küsten können über die Datumsgrenze laufen: dreimal versetzt gezeichnet, ist alles da.
  for (const copy of [-1, 0, 1]) {
    const geo = () =>
      ctx.setTransform(scale, 0, 0, -scale, width / 2 + copy * 360 * scale, height / 2);
    ctx.save();
    geo();
    ctx.clip(land, 'evenodd');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (relief) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(relief, 0, 0, width, height);
    } else {
      ctx.fillStyle = colors.low.css;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();
    geo();
    ctx.fillStyle = colors.sea.css;
    ctx.fill(lakes, 'evenodd');
    ctx.strokeStyle = colors.sea.css;
    const kmPerDegree = (2 * Math.PI * planet.radiusKm) / 360;
    for (const river of planet.doc.rivers) {
      const path = new Path2D();
      let lon = river.points[0]!;
      path.moveTo(lon, river.points[1]!);
      for (let i = 1; i < river.points.length / 2; i++) {
        lon += wrapLon(river.points[i * 2]! - river.points[(i - 1) * 2]!);
        path.lineTo(lon, river.points[i * 2 + 1]!);
      }
      ctx.lineWidth = Math.max(1.5 / scale, river.widthKm / kmPerDegree);
      ctx.stroke(path);
    }
    ctx.strokeStyle = colors.ink.css;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.2 / scale;
    ctx.stroke(land);
    ctx.stroke(lakes);
    ctx.globalAlpha = 1;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}

interface GlobeView {
  lon: number;
  lat: number;
  /** 1 = die ganze Kugel passt in die Fläche. */
  zoom: number;
}

export function Globe({
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
  const [view, setView] = useState<GlobeView>({ lon: 0, lat: 15, zoom: 1 });
  /** Während des Drehens wird gröber gezeichnet, damit es flüssig bleibt. */
  const [moving, setMoving] = useState(false);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drag = useRef<{ x: number; y: number; view: GlobeView; moved: boolean } | null>(null);

  const colors = useMemo(readColors, []);
  const texture = useMemo(() => worldTexture(planet, grid, colors), [planet, grid, colors]);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (focus) setView((current) => ({ ...current, lon: focus.lon, lat: focus.lat }));
  }, [focus]);

  const radius = (Math.min(size.width, size.height) / 2) * 0.9 * view.zoom;
  const cx = size.width / 2;
  const cy = size.height / 2;

  /** Die Stelle des Planeten unter einem Bildpunkt – null neben der Kugel. */
  const toGeo = useCallback(
    (x: number, y: number): LonLat | null => {
      const vx = (x - cx) / radius;
      const vy = -(y - cy) / radius;
      const d = vx * vx + vy * vy;
      if (d > 1) return null;
      const vz = Math.sqrt(1 - d);
      const a = view.lat * RAD;
      const l = view.lon * RAD;
      const y1 = vy * Math.cos(a) + vz * Math.sin(a);
      const z1 = -vy * Math.sin(a) + vz * Math.cos(a);
      const X = vx * Math.cos(l) + z1 * Math.sin(l);
      const Z = -vx * Math.sin(l) + z1 * Math.cos(l);
      return {
        lon: wrapLon(Math.atan2(X, Z) / RAD),
        lat: Math.asin(Math.max(-1, Math.min(1, y1))) / RAD,
      };
    },
    [cx, cy, radius, view.lat, view.lon],
  );

  /** Wo eine Stelle des Planeten auf dem Bild liegt – null auf der Rückseite. */
  const toScreen = useCallback(
    (point: LonLat): { x: number; y: number } | null => {
      const phi = point.lat * RAD;
      const lambda = point.lon * RAD;
      const X = Math.cos(phi) * Math.sin(lambda);
      const Y = Math.sin(phi);
      const Z = Math.cos(phi) * Math.cos(lambda);
      const a = view.lat * RAD;
      const l = view.lon * RAD;
      const vx = X * Math.cos(l) - Z * Math.sin(l);
      const z1 = X * Math.sin(l) + Z * Math.cos(l);
      const vy = Y * Math.cos(a) - z1 * Math.sin(a);
      const vz = Y * Math.sin(a) + z1 * Math.cos(a);
      return vz > 0.02 ? { x: cx + vx * radius, y: cy - vy * radius } : null;
    },
    [cx, cy, radius, view.lat, view.lon],
  );

  // ── Zeichnen ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const element = canvas.current;
    if (!element || !size.width || !size.height) return;
    const dpr = moving ? 1 : Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(size.width * dpr);
    const h = Math.round(size.height * dpr);
    element.width = w;
    element.height = h;
    const ctx = element.getContext('2d')!;
    const image = ctx.createImageData(w, h);
    const out = image.data;
    const R = radius * dpr;
    const ox = cx * dpr;
    const oy = cy * dpr;
    const a = view.lat * RAD;
    const l = view.lon * RAD;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cl = Math.cos(l);
    const sl = Math.sin(l);
    const { width: tw, height: th, data } = texture;
    // Licht von links oben, damit die Kugel rund wirkt.
    const lx = -0.42;
    const ly = 0.48;
    const lz = 0.77;
    const x0 = Math.max(0, Math.floor(ox - R));
    const x1 = Math.min(w - 1, Math.ceil(ox + R));
    const y0 = Math.max(0, Math.floor(oy - R));
    const y1 = Math.min(h - 1, Math.ceil(oy + R));
    for (let py = y0; py <= y1; py++) {
      const vy = -(py - oy) / R;
      for (let px = x0; px <= x1; px++) {
        const vx = (px - ox) / R;
        const d = vx * vx + vy * vy;
        if (d > 1) continue;
        const vz = Math.sqrt(1 - d);
        const yy = vy * ca + vz * sa;
        const zz = -vy * sa + vz * ca;
        const X = vx * cl + zz * sl;
        const Z = -vx * sl + zz * cl;
        const u = (Math.atan2(X, Z) / (2 * Math.PI) + 0.5) * tw;
        const v = (0.5 - Math.asin(yy > 1 ? 1 : yy < -1 ? -1 : yy) / Math.PI) * th;
        const tx = Math.min(tw - 1, u | 0);
        const ty = Math.min(th - 1, v | 0);
        const t = (ty * tw + tx) * 4;
        const shade = 0.4 + 0.72 * Math.max(0, vx * lx + vy * ly + vz * lz);
        // Am Rand weich auslaufen lassen.
        const edge = d > 0.985 ? (1 - d) / 0.015 : 1;
        const o = (py * w + px) * 4;
        out[o] = data[t]! * shade;
        out[o + 1] = data[t + 1]! * shade;
        out[o + 2] = data[t + 2]! * shade;
        out[o + 3] = 255 * edge;
      }
    }
    ctx.putImageData(image, 0, 0);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Ein heller Saum wie eine dünne Lufthülle.
    const glow = ctx.createRadialGradient(cx, cy, radius * 0.985, cx, cy, radius * 1.05);
    glow.addColorStop(0, 'transparent');
    glow.addColorStop(0.35, colors.text.css);
    glow.addColorStop(1, 'transparent');
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Gradnetz: alle 30 Grad, als Linien über die sichtbare Seite.
    ctx.strokeStyle = colors.text.css;
    ctx.lineWidth = 1;
    const line = (points: LonLat[], alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      let open = false;
      for (const point of points) {
        const p = toScreen(point);
        if (!p) {
          open = false;
          continue;
        }
        if (open) ctx.lineTo(p.x, p.y);
        else ctx.moveTo(p.x, p.y);
        open = true;
      }
      ctx.stroke();
    };
    for (let lat = -60; lat <= 60; lat += 30) {
      const points: LonLat[] = [];
      for (let lon = -180; lon <= 180; lon += 4) points.push({ lon, lat });
      line(points, lat === 0 ? 0.22 : 0.09);
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const points: LonLat[] = [];
      for (let lat = -88; lat <= 88; lat += 4) points.push({ lon, lat });
      line(points, lon === 0 ? 0.22 : 0.09);
    }
    ctx.globalAlpha = 1;

    // Orte
    const font = getComputedStyle(element).fontFamily;
    ctx.textBaseline = 'middle';
    const labels = view.zoom > 2.2;
    for (const place of places) {
      const p = toScreen(place.geo);
      if (!p || p.x < -80 || p.x > size.width + 80 || p.y < -20 || p.y > size.height + 20) continue;
      const selected = place.id === selectedId;
      ctx.beginPath();
      ctx.arc(p.x, p.y, selected ? 5 : place.major ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = selected ? colors.gold.css : colors.text.css;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = colors.ink.css;
      ctx.stroke();
      if (selected || place.major || labels) {
        ctx.font = `${selected ? 600 : 500} ${selected || place.major ? 14 : 12}px ${font}`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = colors.ink.css;
        ctx.strokeText(place.name, p.x + 8, p.y);
        ctx.fillStyle = selected ? colors.gold.css : colors.text.css;
        ctx.fillText(place.name, p.x + 8, p.y);
      }
    }
    const group = party ? toScreen(party) : null;
    if (group) {
      ctx.beginPath();
      ctx.arc(group.x, group.y, 8, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = colors.blood.css;
      ctx.stroke();
    }
  }, [view, size, moving, texture, colors, places, selectedId, party, radius, cx, cy, toScreen]);

  // ── Bedienung ─────────────────────────────────────────────────────────────
  /** Merkt, dass gerade gedreht wird, und zeichnet kurz danach wieder fein. */
  const stir = () => {
    setMoving(true);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => setMoving(false), 180);
  };
  useEffect(() => () => clearTimeout(settle.current), []);

  const zoomBy = (factor: number) => {
    stir();
    setView((current) => ({
      ...current,
      zoom: Math.max(0.6, Math.min(MAX_ZOOM, current.zoom * factor)),
    }));
  };

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * 0.0015));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  });

  const local = (event: { clientX: number; clientY: number }) => {
    const box = canvas.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const turn = (lon: number, lat: number) => {
    stir();
    setView((current) => ({
      ...current,
      lon: wrapLon(current.lon + lon),
      lat: Math.max(-89, Math.min(89, current.lat + lat)),
    }));
  };

  return (
    <div className="wf-atlas-map wf-atlas-map--globe" ref={frame}>
      <canvas
        ref={canvas}
        className="wf-atlas-map__canvas"
        data-placing={placing}
        tabIndex={0}
        aria-label="Der Planet als Kugel. Mit der Maus drehen, mit dem Rad vergrößern, mit Plus und Minus vergrößern, mit den Pfeiltasten drehen."
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
            if (start.moved) {
              stir();
              const perPixel = 1 / radius / RAD;
              setView({
                zoom: start.view.zoom,
                lon: wrapLon(start.view.lon - dx * perPixel),
                lat: Math.max(-89, Math.min(89, start.view.lat + dy * perPixel)),
              });
            }
          } else onHover(toGeo(at.x, at.y));
        }}
        onPointerUp={(event) => {
          const start = drag.current;
          drag.current = null;
          if (!start || start.moved) return;
          const at = local(event);
          const hit = places.find((place) => {
            const p = toScreen(place.geo);
            return p !== null && Math.hypot(p.x - at.x, p.y - at.y) <= 9;
          });
          if (hit && !placing) return onSelect(hit.id);
          const point = toGeo(at.x, at.y);
          if (point) onPick(point);
        }}
        onPointerLeave={() => onHover(null)}
        onKeyDown={(event) => {
          const step = 12 / view.zoom;
          if (event.key === '+' || event.key === '=') zoomBy(1.4);
          else if (event.key === '-') zoomBy(1 / 1.4);
          else if (event.key === 'ArrowLeft') turn(-step, 0);
          else if (event.key === 'ArrowRight') turn(step, 0);
          else if (event.key === 'ArrowUp') turn(0, step);
          else if (event.key === 'ArrowDown') turn(0, -step);
          else return;
          event.preventDefault();
        }}
      />
      <div className="wf-atlas-map__zoom">
        <IconButton label="Vergrößern" size="sm" onClick={() => zoomBy(1.5)}>
          <Plus />
        </IconButton>
        <IconButton label="Verkleinern" size="sm" onClick={() => zoomBy(1 / 1.5)}>
          <Minus />
        </IconButton>
        <IconButton
          label="Die ganze Kugel zeigen"
          size="sm"
          onClick={() => setView((current) => ({ ...current, zoom: 1 }))}
        >
          <Scan />
        </IconButton>
      </div>
    </div>
  );
}
