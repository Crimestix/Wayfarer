/**
 * Höhen für Landmassen, die aus einem Kartenbild eingelesen wurden. Ein Bild kennt nur Küsten;
 * damit dort nicht alles flach ist, erzeugt Wayfarer ein Gelände nach festen Regeln: an der Küste
 * niedrig, im Inneren höher, mit Gebirgszügen aus weichem Rauschen. Gleiche Landmasse, gleiches
 * Gelände. Reine Funktionen.
 */
import { NODATA, inRing, ringBounds, wrapLon, type HeightGrid, type Ring } from './geo';
import { seedOf, smoothNoise } from './random';

/** Eine Landmasse zum Erzeugen: Küsten, Gewässer und die Kennung als Ausgangswert. */
export interface ReliefLand {
  id: string;
  rings: readonly Ring[];
  holes: readonly Ring[];
}

/**
 * Trägt in `mask` ein, welche Zellen eines Rasters über den ganzen Planeten in einem Ring liegen
 * (`value` 1) oder nimmt sie wieder heraus (`value` 0). Zeile für Zeile: Wo die Küste den
 * Breitengrad der Zeile schneidet, wechselt innen und außen.
 */
export function fillRing(
  mask: Uint8Array,
  width: number,
  height: number,
  ring: Ring,
  value: 0 | 1,
): void {
  const count = ring.length / 2;
  if (count < 3) return;
  const bounds = ringBounds(ring);
  const cell = 360 / width;
  const first = Math.max(0, Math.floor((90 - bounds.north) / (180 / height)));
  const last = Math.min(height - 1, Math.ceil((90 - bounds.south) / (180 / height)));
  const crossings: number[] = [];
  for (let row = first; row <= last; row++) {
    // Die Mitte der Zeile, ein Hauch daneben, damit kein Küstenpunkt genau darauf liegt.
    const lat = 90 - ((row + 0.5) * 180) / height + 1e-7;
    crossings.length = 0;
    let lon = ring[0]!;
    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count;
      const latA = ring[i * 2 + 1]!;
      const latB = ring[next * 2 + 1]!;
      const step = wrapLon(ring[next * 2]! - ring[i * 2]!);
      if (latA > lat !== latB > lat)
        crossings.push(wrapLon(lon + (step * (lat - latA)) / (latB - latA)));
      lon += step;
    }
    if (crossings.length < 2) {
      // Keine Küste auf dieser Breite: Die ganze Zeile liegt innen oder außen.
      if (inRing(ring, { lon: 0, lat }, bounds))
        for (let x = 0; x < width; x++) mask[row * width + x] = value;
      continue;
    }
    crossings.sort((a, b) => a - b);
    // Liegt das Stück nach dem ersten Schnitt innen? Danach wechselt es mit jedem Schnitt.
    const probe = (crossings[0]! + crossings[1]!) / 2;
    const start = inRing(ring, { lon: probe, lat }, bounds) ? 0 : 1;
    for (let k = start; k < crossings.length; k += 2) {
      const from = crossings[k]!;
      const to = crossings[(k + 1) % crossings.length]! + (k + 1 >= crossings.length ? 360 : 0);
      // Zellen, deren Mitte zwischen den beiden Schnitten liegt.
      const x0 = Math.ceil((from + 180) / cell - 0.5);
      const x1 = Math.floor((to + 180) / cell - 0.5);
      for (let x = x0; x <= x1; x++) mask[row * width + (((x % width) + width) % width)] = value;
    }
  }
}

/** Welche Zellen des Rasters auf einer Landmasse liegen: 1 = Land. */
export function landCells(land: ReliefLand, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const ring of land.rings) fillRing(mask, width, height, ring, 1);
  for (const hole of land.holes) fillRing(mask, width, height, hole, 0);
  return mask;
}

/**
 * Wie weit jede Landzelle von der Küste entfernt ist, in Zellen (über Eck etwas weiter). Wasser
 * hat 0. Links und rechts schließt die Welt aneinander an.
 */
export function coastDistance(mask: Uint8Array, width: number, height: number): Float32Array {
  const far = 1e9;
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? far : 0;
  const at = (x: number, y: number) =>
    y < 0 || y >= height ? far : out[y * width + ((x + width) % width)]!;
  // Zweimal hin und zurück, damit auch der Weg über den linken und rechten Rand stimmt.
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!out[i]) continue;
        out[i] = Math.min(
          out[i]!,
          at(x - 1, y) + 1,
          at(x, y - 1) + 1,
          at(x - 1, y - 1) + 1.414,
          at(x + 1, y - 1) + 1.414,
        );
      }
    for (let y = height - 1; y >= 0; y--)
      for (let x = width - 1; x >= 0; x--) {
        const i = y * width + x;
        if (!out[i]) continue;
        out[i] = Math.min(
          out[i]!,
          at(x + 1, y) + 1,
          at(x, y + 1) + 1,
          at(x + 1, y + 1) + 1.414,
          at(x - 1, y + 1) + 1.414,
        );
      }
  }
  return out;
}

/** Höchste erzeugte Gipfel, in Metern. */
const PEAK_M = 3000;
/** Ab dieser Entfernung zur Küste gilt Land als Inneres, in Kilometern. */
const INLAND_KM = 400;

/**
 * Die erzeugte Höhe einer Stelle in Metern: `coastKm` weit von der Küste, an der Lage
 * `lon`/`lat`. Tiefland überall, darin Gebirgszüge, zum Inneren hin höher.
 */
export function generatedHeight(seed: number, lon: number, lat: number, coastKm: number): number {
  const inland = 1 - Math.exp(-coastKm / INLAND_KM);
  // Große Züge über etwa acht Grad, Einzelheiten über etwa zwei.
  const ranges =
    0.7 * smoothNoise(seed, lon / 8, lat / 8) + 0.3 * smoothNoise(seed + 1, lon / 3, lat / 3);
  const detail = smoothNoise(seed + 2, lon / 2, lat / 2);
  const plain = 40 + 360 * inland * detail;
  const ridge = Math.max(0, (ranges - 0.45) / 0.55);
  return Math.round(plain + ridge * ridge * PEAK_M * (0.25 + 0.75 * inland));
}

/**
 * Ergänzt ein Höhenraster um erzeugte Höhen für die genannten Landmassen. Wo das Raster schon
 * eine Höhe kennt, bleibt sie – außer unter ausgeblendeten Landmassen (`cleared`), deren Höhen
 * vorher gelöscht werden. Gibt ein neues Raster zurück – oder dasselbe, wenn nichts zu tun ist.
 */
export function withGeneratedRelief(
  grid: HeightGrid,
  lands: readonly ReliefLand[],
  radiusKm: number,
  /** Landmassen, deren Höhen nicht mehr gelten (ausgeblendet): Dort wird das Raster geleert. */
  cleared: readonly ReliefLand[] = [],
): HeightGrid {
  if (!lands.length && !cleared.length) return grid;
  const { width, height } = grid;
  const data = grid.data.slice();
  for (const land of cleared) {
    const mask = landCells(land, width, height);
    for (let i = 0; i < mask.length; i++) if (mask[i]) data[i] = NODATA;
  }
  const cellKm = (Math.PI * radiusKm) / height;
  for (const land of lands) {
    const mask = landCells(land, width, height);
    const distance = coastDistance(mask, width, height);
    const seed = seedOf('gelaende', land.id);
    // Längen fortlaufend von der Mitte der Landmasse aus – kein Bruch an der Datumsgrenze.
    const center = land.rings.length ? ringBounds(land.rings[0]!).lon : 0;
    for (let y = 0; y < height; y++) {
      const lat = 90 - ((y + 0.5) * 180) / height;
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!mask[i] || data[i] !== NODATA) continue;
        const lon = center + wrapLon(-180 + ((x + 0.5) * 360) / width - center);
        data[i] = generatedHeight(seed, lon, lat, distance[i]! * cellKm);
      }
    }
  }
  return { width, height, data };
}
