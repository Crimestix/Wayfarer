/**
 * Übernahme aus dem alten Atlas: die Weltdatei (`world.json`) mit Planet, Küsten, Seen und Flüssen
 * und – wenn gewünscht – die Höhenkarte (`height.f32`). Reine Umwandlung: Küsten werden
 * vereinfacht, die Höhenkarte verkleinert, damit beides in den Spielstand passt. Geschrieben wird
 * in `actions.ts`.
 */
import { NODATA, simplifyRing, wrapLon } from '../../domain/geo';
import type { Atlas } from '../../domain/schema';
import { encodeHeights } from './model';

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const number = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Küsten werden auf etwa 700 m genau behalten (bei 139 km je Grad). */
export const COAST_TOLERANCE_DEG = 0.005;
/** Auf drei Stellen gerundet: gut hundert Meter – genauer ist die Vorlage nicht gemeint. */
const round = (value: number) => Math.round(value * 1000) / 1000;

/** Liest eine Punktliste `[[Länge, Breite], …]` als flachen Ring; Unlesbares fällt weg. */
function flat(points: unknown): number[] {
  const out: number[] = [];
  for (const point of list(points)) {
    if (!Array.isArray(point)) continue;
    const lon = point[0];
    const lat = point[1];
    if (typeof lon !== 'number' || typeof lat !== 'number') continue;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90) continue;
    out.push(wrapLon(lon), lat);
  }
  return out;
}

const tidy = (ring: number[], tolerance: number): number[] =>
  simplifyRing(ring, tolerance).map(round);

export interface AtlasStats {
  lands: number;
  /** Punkte der Küsten vor und nach dem Vereinfachen. */
  pointsBefore: number;
  pointsAfter: number;
  lakes: number;
  rivers: number;
}

export interface AtlasConversion {
  planet: Omit<Atlas, 'id' | 'rev' | 'created' | 'updated'>;
  stats: AtlasStats;
}

/** Fehlertext, wenn eine Datei nicht die Weltdatei des Atlas ist. */
export const NOT_AN_ATLAS =
  'Das ist nicht die Weltdatei des Atlas. Erwartet wird „world.json“ aus dem Ordner „inputs“.';

/**
 * Wandelt die Weltdatei des alten Atlas um. Genommen wird der heutige Stand der Welt (der erste
 * Zeitabschnitt, oder der mit der Kennung „today“).
 */
export function convertAtlasWorld(
  raw: unknown,
  source = '',
  tolerance = COAST_TOLERANCE_DEG,
): AtlasConversion {
  if (!isRaw(raw) || !isRaw(raw.planet) || !Array.isArray(raw.epochs))
    throw new Error(NOT_AN_ATLAS);
  const epochs = raw.epochs.filter(isRaw);
  const epoch = epochs.find((e) => e.id === 'today') ?? epochs[0];
  if (!epoch) throw new Error(NOT_AN_ATLAS);

  const stats: AtlasStats = { lands: 0, pointsBefore: 0, pointsAfter: 0, lakes: 0, rivers: 0 };
  const rings = (value: unknown): number[][] =>
    list(value)
      .map(flat)
      .filter((ring) => ring.length >= 6)
      .map((ring) => {
        stats.pointsBefore += ring.length / 2;
        const simple = tidy(ring, tolerance);
        stats.pointsAfter += simple.length / 2;
        return simple;
      });

  const lands: Atlas['lands'] = [];
  for (const feature of list(epoch.features).filter(isRaw)) {
    const shape = rings(feature.rings);
    if (!shape.length) continue;
    lands.push({
      id: text(feature.id) || `land-${lands.length + 1}`,
      name: text(feature.name),
      placeId: null,
      rings: shape,
      holes: rings(feature.holes),
      relief: 'generated',
    });
  }
  if (!lands.length) throw new Error(NOT_AN_ATLAS);
  stats.lands = lands.length;

  // Seen mit eigener Uferlinie und Flüsse stehen je Kontinent unter „hydrography“.
  const lakes: Atlas['lakes'] = [];
  const rivers: Atlas['rivers'] = [];
  for (const region of Object.values(isRaw(raw.hydrography) ? raw.hydrography : {})) {
    if (!isRaw(region)) continue;
    for (const lake of list(region.lakes).filter(isRaw)) {
      const ring = flat(lake.shoreline);
      if (ring.length < 6) continue;
      lakes.push({
        id: text(lake.id) || `see-${lakes.length + 1}`,
        name: text(lake.name),
        ring: tidy(ring, tolerance),
      });
    }
    for (const channel of list(region.channels).filter(isRaw)) {
      const points = flat(channel.points);
      if (points.length < 4) continue;
      const widths = list(channel.halfWidthsKm).filter((w): w is number => typeof w === 'number');
      const mean = widths.length ? widths.reduce((sum, w) => sum + w, 0) / widths.length : 0;
      rivers.push({
        id: text(channel.id) || `fluss-${rivers.length + 1}`,
        name: text(channel.name),
        points: points.map(round),
        widthKm: Math.round(mean * 2 * 10) / 10,
      });
    }
  }
  stats.lakes = lakes.length;
  stats.rivers = rivers.length;

  const planet = raw.planet;
  return {
    planet: {
      kind: 'planet',
      name: text(raw.name) || text(planet.name),
      radiusKm: number(planet.radiusKm, 6371),
      dayHours: number(planet.dayHours, 24),
      yearDays: number(planet.yearDays, 365),
      obliquityDeg: Math.max(0, Math.min(90, number(planet.obliquityDeg, 0))),
      lands,
      hiddenLands: [],
      lakes,
      rivers,
      width: 0,
      height: 0,
      heights: '',
      source,
    },
    stats,
  };
}

// ── Höhenkarte ─────────────────────────────────────────────────────────────

/** So breit wird das Höhenraster im Spielstand (und halb so hoch). */
export const RELIEF_WIDTH = 1024;

/** Fehlertext, wenn eine Datei nicht nach einer Höhenkarte des Atlas aussieht. */
export const NOT_A_HEIGHTMAP =
  'Das ist keine Höhenkarte des Atlas. Erwartet wird „height.f32“ aus dem Ordner „artifacts“ – doppelt so breit wie hoch.';

/**
 * Liest die Höhenkarte des Atlas (Gleitkommazahlen, je Zelle vier Byte, doppelt so breit wie hoch,
 * Norden oben) und verkleinert sie: Jede neue Zelle ist der Mittelwert der alten, die in ihr
 * liegen. Zellen ohne Angabe bleiben ohne Angabe.
 */
export function convertHeights(
  buffer: ArrayBuffer,
  source = '',
  targetWidth = RELIEF_WIDTH,
): Omit<Atlas, 'id' | 'rev' | 'created' | 'updated'> {
  const cells = buffer.byteLength / 4;
  const srcH = Math.round(Math.sqrt(cells / 2));
  const srcW = srcH * 2;
  if (!Number.isInteger(cells) || srcW * srcH !== cells || srcH < 2)
    throw new Error(NOT_A_HEIGHTMAP);
  const src = new Float32Array(buffer);
  const width = Math.min(targetWidth, srcW);
  const height = width / 2;
  const out = new Int16Array(width * height);
  const sum = new Float64Array(width * height);
  const count = new Uint32Array(width * height);
  for (let y = 0; y < srcH; y++) {
    const ty = Math.min(height - 1, Math.floor((y * height) / srcH));
    for (let x = 0; x < srcW; x++) {
      const value = src[y * srcW + x]!;
      if (Number.isNaN(value)) continue;
      const cell = ty * width + Math.min(width - 1, Math.floor((x * width) / srcW));
      sum[cell]! += value;
      count[cell]!++;
    }
  }
  for (let i = 0; i < out.length; i++)
    out[i] = count[i] ? Math.max(-32767, Math.min(32767, Math.round(sum[i]! / count[i]!))) : NODATA;
  return {
    kind: 'relief',
    name: '',
    radiusKm: 6371,
    dayHours: 24,
    yearDays: 365,
    obliquityDeg: 0,
    lands: [],
    hiddenLands: [],
    lakes: [],
    rivers: [],
    width,
    height,
    heights: encodeHeights(out),
    source,
  };
}
