/**
 * Der Weg über Land zwischen zwei Lagen: Führt die Luftlinie übers Meer, sucht Wayfarer den
 * kürzesten Weg, der an Land bleibt – auf einem groben Raster des Planeten, also ungefähr.
 * Reine Funktionen.
 */
import { along, distanceKm, wrapLon, type LonLat } from './geo';
import { fillRing } from './landRelief';
import type { Planet } from './planet';

/** Ein Raster über den ganzen Planeten: 1 = Land, über das man gehen kann. */
export interface LandGrid {
  width: number;
  height: number;
  land: Uint8Array;
}

/** Zellen je Erdumfang: ein halbes Grad je Zelle. */
const GRID_WIDTH = 720;

const gridCache = new WeakMap<Planet, LandGrid>();

/** Das Land des Planeten als Raster – Seen und Binnenmeere sind kein Land. */
export function landGrid(planet: Planet, width = GRID_WIDTH): LandGrid {
  const cached = width === GRID_WIDTH ? gridCache.get(planet) : undefined;
  if (cached) return cached;
  const height = width / 2;
  const land = new Uint8Array(width * height);
  // Jede Landmasse für sich, damit ein Binnenmeer der einen nicht das Land einer anderen löscht.
  for (const entry of planet.lands) {
    const own = new Uint8Array(width * height);
    for (const shape of entry.rings) fillRing(own, width, height, shape.ring, 1);
    for (const shape of entry.holes) fillRing(own, width, height, shape.ring, 0);
    for (let i = 0; i < own.length; i++) if (own[i]) land[i] = 1;
  }
  for (const lake of planet.lakes) fillRing(land, width, height, lake.shape.ring, 0);
  const grid = { width, height, land };
  if (width === GRID_WIDTH) gridCache.set(planet, grid);
  return grid;
}

const cellOf = (grid: LandGrid, point: LonLat): [number, number] => [
  Math.min(
    grid.width - 1,
    Math.max(0, Math.floor(((wrapLon(point.lon) + 180) / 360) * grid.width)),
  ),
  Math.min(grid.height - 1, Math.max(0, Math.floor(((90 - point.lat) / 180) * grid.height))),
];

const centerOf = (grid: LandGrid, x: number, y: number): LonLat => ({
  lon: -180 + ((x + 0.5) * 360) / grid.width,
  lat: 90 - ((y + 0.5) * 180) / grid.height,
});

const isLand = (grid: LandGrid, x: number, y: number): boolean =>
  y >= 0 &&
  y < grid.height &&
  grid.land[y * grid.width + (((x % grid.width) + grid.width) % grid.width)] === 1;

/** Führt die Luftlinie zwischen zwei Lagen irgendwo über Wasser? Die Enden selbst zählen nicht. */
export function crossesWater(planet: Planet, a: LonLat, b: LonLat): boolean {
  const grid = landGrid(planet);
  const km = distanceKm(planet.radiusKm, a, b);
  const cellKm = (Math.PI * planet.radiusKm) / grid.height;
  const steps = Math.max(2, Math.ceil(km / (cellKm / 2)));
  // Start und Ziel dürfen am Wasser liegen: Ein Hafen ist kein Umweg.
  const skip = Math.min(steps / 2 - 1, 2);
  for (let i = 1 + skip; i < steps - skip; i++) {
    const [x, y] = cellOf(grid, along(a, b, i / steps));
    if (!isLand(grid, x, y)) return true;
  }
  return false;
}

/** Die nächste Landzelle zu einer Lage – höchstens drei Zellen entfernt; sonst null. */
function nearestLand(grid: LandGrid, point: LonLat): [number, number] | null {
  const [cx, cy] = cellOf(grid, point);
  for (let reach = 0; reach <= 3; reach++)
    for (let dy = -reach; dy <= reach; dy++)
      for (let dx = -reach; dx <= reach; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== reach) continue;
        if (isLand(grid, cx + dx, cy + dy))
          return [(((cx + dx) % grid.width) + grid.width) % grid.width, cy + dy];
      }
  return null;
}

export interface LandRoute {
  /** Länge des Weges in Kilometern. */
  km: number;
  /** Der Weg vom Start zum Ziel, beide eingeschlossen. */
  points: LonLat[];
}

/**
 * Der kürzeste Weg von `a` nach `b`, der an Land bleibt – oder null, wenn es keinen gibt (Insel,
 * anderer Kontinent). Gesucht wird von Zelle zu Zelle, danach wird der Weg begradigt, wo die
 * direkte Linie über Land führt.
 */
export function landRoute(planet: Planet, a: LonLat, b: LonLat): LandRoute | null {
  const key = [a.lon, a.lat, b.lon, b.lat].map((value) => value.toFixed(2)).join('/');
  let known = routeCache.get(planet);
  if (!known) routeCache.set(planet, (known = new Map()));
  if (!known.has(key)) known.set(key, findRoute(planet, a, b));
  return known.get(key)!;
}

const routeCache = new WeakMap<Planet, Map<string, LandRoute | null>>();

function findRoute(planet: Planet, a: LonLat, b: LonLat): LandRoute | null {
  const grid = landGrid(planet);
  const start = nearestLand(grid, a);
  const goal = nearestLand(grid, b);
  if (!start || !goal) return null;
  const { width, height } = grid;
  const index = (x: number, y: number) => y * width + x;
  const from = index(start[0], start[1]);
  const to = index(goal[0], goal[1]);
  const goalPoint = centerOf(grid, goal[0], goal[1]);
  const cost = new Float64Array(width * height).fill(Infinity);
  const previous = new Int32Array(width * height).fill(-1);
  const done = new Uint8Array(width * height);
  // Vorrangschlange als Halde: [geschätzte Gesamtlänge, Zelle].
  const heap: [number, number][] = [];
  const push = (priority: number, cell: number) => {
    heap.push([priority, cell]);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent]![0] <= heap[i]![0]) break;
      [heap[parent], heap[i]] = [heap[i]!, heap[parent]!];
      i = parent;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let best = i;
        if (left < heap.length && heap[left]![0] < heap[best]![0]) best = left;
        if (right < heap.length && heap[right]![0] < heap[best]![0]) best = right;
        if (best === i) break;
        [heap[best], heap[i]] = [heap[i]!, heap[best]!];
        i = best;
      }
    }
    return top;
  };
  const estimate = (x: number, y: number) =>
    distanceKm(planet.radiusKm, centerOf(grid, x, y), goalPoint);

  cost[from] = 0;
  push(estimate(start[0], start[1]), from);
  while (heap.length) {
    const [, cell] = pop();
    if (done[cell]) continue;
    done[cell] = 1;
    if (cell === to) break;
    const x = cell % width;
    const y = (cell - x) / width;
    const here = centerOf(grid, x, y);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const ny = y + dy;
        const nx = (x + dx + width) % width;
        if (!isLand(grid, nx, ny)) continue;
        const next = index(nx, ny);
        if (done[next]) continue;
        const total = cost[cell]! + distanceKm(planet.radiusKm, here, centerOf(grid, nx, ny));
        if (total >= cost[next]!) continue;
        cost[next] = total;
        previous[next] = cell;
        push(total + estimate(nx, ny), next);
      }
  }
  if (!done[to]) return null;

  // Rückwärts aufsammeln, dann begradigen: so weit vorausspringen, wie die Linie an Land bleibt.
  const cells: LonLat[] = [];
  for (let cell = to; cell !== -1; cell = previous[cell]!) {
    const x = cell % width;
    cells.push(centerOf(grid, x, (cell - x) / width));
  }
  cells.reverse();
  const raw = [a, ...cells.slice(1, -1), b];
  const points: LonLat[] = [a];
  let at = 0;
  while (at < raw.length - 1) {
    let next = at + 1;
    // Weit vorausschauen, aber nicht jede Möglichkeit prüfen: in Sprüngen zurückgehen.
    for (let far = raw.length - 1; far > at + 1; far -= Math.max(1, Math.floor((far - at) / 6)))
      if (!crossesWater(planet, raw[at]!, raw[far]!)) {
        next = far;
        break;
      }
    points.push(raw[next]!);
    at = next;
  }
  let km = 0;
  for (let i = 1; i < points.length; i++)
    km += distanceKm(planet.radiusKm, points[i - 1]!, points[i]!);
  return { km, points };
}
