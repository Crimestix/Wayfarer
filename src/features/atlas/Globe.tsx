/**
 * Die Kugel: derselbe Planet wie auf der Weltkarte, als drehbarer Globus. Die Welt wird einmal
 * flach in ein Bild gemalt; die Grafikkarte legt es um die Kugel und rechnet für jeden Bildpunkt,
 * welche Stelle dort zu sehen ist. Darüber liegt eine zweite Fläche für Gradnetz und Orte.
 * Ziehen dreht, das Rad vergrößert. Ohne weitere Bibliothek.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Scan } from 'lucide-react';
import { wrapLon, type HeightGrid, type LonLat } from '../../domain/geo';
import { IconButton } from '../../ui';
import type { Planet } from './model';
import {
  addRing,
  landPaths,
  readColors,
  reliefImage,
  type DraftShape,
  type MapPlace,
} from './WorldMap';

interface Props {
  planet: Planet;
  grid: HeightGrid | null;
  places: MapPlace[];
  selectedId: string | null;
  party: LonLat | null;
  placing: boolean;
  focus: LonLat | null;
  /** Eine Landmasse, die gerade eingepasst wird. */
  draft?: DraftShape | null;
  onPick: (point: LonLat) => void;
  onSelect: (placeId: string) => void;
  onHover: (point: LonLat | null) => void;
}

const RAD = Math.PI / 180;
const TEXTURE_WIDTH = 4096;
const MAX_ZOOM = 14;

/** Malt die ganze Welt einmal flach – Meer, Land mit Gelände, Seen, Flüsse, Küsten. */
function worldTexture(
  planet: Planet,
  grid: HeightGrid | null,
  colors: ReturnType<typeof readColors>,
): HTMLCanvasElement {
  const width = TEXTURE_WIDTH;
  const height = width / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const scale = width / 360;
  const lands = landPaths(planet);
  const lakes = new Path2D();
  for (const lake of planet.lakes) addRing(lakes, lake.shape.ring, null);
  // Doppelt so fein wie das Raster gerechnet: Das Gelände bleibt auch vergrößert weich.
  const relief = grid ? reliefImage(grid, colors, 2) : null;

  ctx.fillStyle = colors.sea.css;
  ctx.fillRect(0, 0, width, height);
  // Küsten können über die Datumsgrenze laufen: dreimal versetzt gezeichnet, ist alles da.
  for (const copy of [-1, 0, 1]) {
    const geo = () =>
      ctx.setTransform(scale, 0, 0, -scale, width / 2 + copy * 360 * scale, height / 2);
    for (const land of lands) {
      if (land.once && copy !== 0) continue;
      ctx.save();
      geo();
      ctx.clip(land.path, 'evenodd');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // Land ohne Höhenangabe (etwa aus einem Bild eingelesen) zeigt die Farbe des Tieflands.
      ctx.fillStyle = colors.low.css;
      ctx.fillRect(0, 0, width, height);
      if (relief) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(relief, 0, 0, width, height);
      }
      ctx.restore();
    }
    geo();
    ctx.fillStyle = colors.sea.css;
    ctx.fill(lakes, 'evenodd');
    ctx.strokeStyle = colors.sea.css;
    const kmPerDegree = (2 * Math.PI * planet.radiusKm) / 360;
    for (const river of planet.rivers) {
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
    for (const land of lands) if (!land.once || copy === 0) ctx.stroke(land.path);
    ctx.stroke(lakes);
    ctx.globalAlpha = 1;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return canvas;
}

// ── Zeichnen über die Grafikkarte ──────────────────────────────────────────

const VERTEX = `
attribute vec2 corner;
void main() {
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

/** Für jeden Bildpunkt: Welche Stelle der Kugel liegt hier, und welche Farbe hat sie im Weltbild? */
const FRAGMENT = `
precision highp float;
uniform vec2 center;
uniform float radius;
uniform vec2 turn;
uniform sampler2D world;
void main() {
  vec2 v = (gl_FragCoord.xy - center) / radius;
  float d = dot(v, v);
  if (d > 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float z = sqrt(1.0 - d);
  float ca = cos(turn.y);
  float sa = sin(turn.y);
  float cl = cos(turn.x);
  float sl = sin(turn.x);
  float yy = v.y * ca + z * sa;
  float zz = -v.y * sa + z * ca;
  float x = v.x * cl + zz * sl;
  float w = -v.x * sl + zz * cl;
  vec2 uv = vec2(atan(x, w) / 6.283185307 + 0.5, 0.5 - asin(clamp(yy, -1.0, 1.0)) / 3.141592654);
  vec3 color = texture2D(world, uv).rgb;
  // Licht von links oben, damit die Kugel rund wirkt; am Rand läuft sie weich aus.
  float shade = 0.4 + 0.72 * max(0.0, dot(vec3(v, z), vec3(-0.42, 0.48, 0.77)));
  float edge = smoothstep(0.0, 0.012, 1.0 - d);
  gl_FragColor = vec4(color * shade * edge, edge);
}`;

interface GlobeView {
  lon: number;
  lat: number;
  /** 1 = die ganze Kugel passt in die Fläche. */
  zoom: number;
}

interface Painter {
  draw: (width: number, height: number, cx: number, cy: number, r: number, view: GlobeView) => void;
  dispose: () => void;
}

/** Richtet die Grafikkarte ein; null, wenn das auf diesem Rechner nicht geht. */
function createPainter(canvas: HTMLCanvasElement, texture: HTMLCanvasElement): Painter | null {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, 'corner');
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

  const world = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, world);
  // Manche Grafikkarten nehmen keine so großen Bilder: dann halb so groß.
  const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  let source: HTMLCanvasElement = texture;
  if (texture.width > limit) {
    source = document.createElement('canvas');
    source.width = limit;
    source.height = limit / 2;
    source.getContext('2d')!.drawImage(texture, 0, 0, source.width, source.height);
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const uCenter = gl.getUniformLocation(program, 'center');
  const uRadius = gl.getUniformLocation(program, 'radius');
  const uTurn = gl.getUniformLocation(program, 'turn');
  gl.uniform1i(gl.getUniformLocation(program, 'world'), 0);
  gl.clearColor(0, 0, 0, 0);

  return {
    draw: (width, height, cx, cy, r, view) => {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // Die Grafikkarte zählt die Zeilen von unten.
      gl.uniform2f(uCenter, cx, height - cy);
      gl.uniform1f(uRadius, r);
      gl.uniform2f(uTurn, view.lon * RAD, view.lat * RAD);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose: () => {
      gl.deleteTexture(world);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}

export function Globe({
  planet,
  grid,
  places,
  selectedId,
  party,
  placing,
  focus,
  draft,
  onPick,
  onSelect,
  onHover,
}: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const sphere = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const painter = useRef<Painter | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<GlobeView>({ lon: 0, lat: 15, zoom: 1 });
  /** Zählt hoch, sobald das Weltbild auf der Grafikkarte liegt – dann wird neu gezeichnet. */
  const [ready, setReady] = useState(0);
  const [failed, setFailed] = useState(false);
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

  // Das Weltbild auf die Grafikkarte laden – neu, wenn sich der Planet ändert.
  useEffect(() => {
    const element = sphere.current;
    if (!element) return;
    const created = createPainter(element, texture);
    painter.current = created;
    setFailed(created === null);
    setReady((count) => count + 1);
    return () => {
      created?.dispose();
      painter.current = null;
    };
  }, [texture]);

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
    (lon: number, lat: number): { x: number; y: number } | null => {
      const phi = lat * RAD;
      const lambda = lon * RAD;
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
    const element = overlay.current;
    if (!element || !size.width || !size.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(size.width * dpr);
    const h = Math.round(size.height * dpr);
    painter.current?.draw(w, h, cx * dpr, cy * dpr, radius * dpr, view);

    element.width = w;
    element.height = h;
    const ctx = element.getContext('2d')!;
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

    /** Zieht eine Linie über die sichtbare Seite; `points` flach als Länge, Breite. */
    const line = (points: readonly number[], closed: boolean) => {
      ctx.beginPath();
      let open = false;
      const count = points.length / 2;
      for (let i = 0; i < count + (closed ? 1 : 0); i++) {
        const p = toScreen(points[(i % count) * 2]!, points[(i % count) * 2 + 1]!);
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

    // Gradnetz: alle 30 Grad.
    ctx.strokeStyle = colors.text.css;
    ctx.lineWidth = 1;
    for (let lat = -60; lat <= 60; lat += 30) {
      const points: number[] = [];
      for (let lon = -180; lon <= 180; lon += 4) points.push(lon, lat);
      ctx.globalAlpha = lat === 0 ? 0.22 : 0.09;
      line(points, false);
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const points: number[] = [];
      for (let lat = -88; lat <= 88; lat += 4) points.push(lon, lat);
      ctx.globalAlpha = lon === 0 ? 0.22 : 0.09;
      line(points, false);
    }
    ctx.globalAlpha = 1;

    // Eine Landmasse, die gerade eingepasst wird.
    if (draft) {
      ctx.strokeStyle = colors.gold.css;
      ctx.lineWidth = 1.5;
      for (const ring of [...draft.rings, ...draft.holes]) line(ring, true);
    }

    // Orte
    const font = getComputedStyle(element).fontFamily;
    ctx.textBaseline = 'middle';
    const labels = view.zoom > 2.2;
    for (const place of places) {
      const p = toScreen(place.geo.lon, place.geo.lat);
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
    const group = party ? toScreen(party.lon, party.lat) : null;
    if (group) {
      ctx.beginPath();
      ctx.arc(group.x, group.y, 8, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = colors.blood.css;
      ctx.stroke();
    }
  }, [view, size, ready, colors, places, selectedId, party, draft, radius, cx, cy, toScreen]);

  // ── Bedienung ─────────────────────────────────────────────────────────────
  const zoomBy = (factor: number) =>
    setView((current) => ({
      ...current,
      zoom: Math.max(0.6, Math.min(MAX_ZOOM, current.zoom * factor)),
    }));

  useEffect(() => {
    const element = overlay.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * 0.0015));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const local = (event: { clientX: number; clientY: number }) => {
    const box = overlay.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const turn = (lon: number, lat: number) =>
    setView((current) => ({
      ...current,
      lon: wrapLon(current.lon + lon),
      lat: Math.max(-89, Math.min(89, current.lat + lat)),
    }));

  return (
    <div className="wf-atlas-map wf-atlas-map--globe" ref={frame}>
      <canvas
        ref={sphere}
        className="wf-atlas-map__canvas wf-atlas-map__canvas--under"
        aria-hidden
      />
      <canvas
        ref={overlay}
        className="wf-atlas-map__canvas wf-atlas-map__canvas--over"
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
            const p = toScreen(place.geo.lon, place.geo.lat);
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
      {failed && (
        <p className="wf-atlas-map__note">
          Die Kugel braucht die Grafikkarte, und die steht hier gerade nicht zur Verfügung. Die
          Karte zeigt dasselbe flach.
        </p>
      )}
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
