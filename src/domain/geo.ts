/**
 * Rechnen auf der Kugel: Lage, Entfernung, Richtung, Land oder Wasser, Höhe, Tageslänge.
 *
 * Der Planet ist eine Kugel mit festem Radius. Eine Lage sind Länge und Breite in Grad: Länge
 * −180…180 (Osten positiv), Breite −90…90 (Norden positiv). Küsten sind Ringe aus Punkten; ein
 * Ring liegt flach als `[Länge, Breite, Länge, Breite, …]` vor, damit große Küsten wenig Platz
 * brauchen.
 */

export interface LonLat {
  lon: number;
  lat: number;
}

const RAD = Math.PI / 180;

/** Bringt eine Länge in den Bereich −180…180. */
export function wrapLon(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  // 180 und −180 sind derselbe Meridian; −180 ist die Schreibweise.
  return wrapped === 180 ? -180 : wrapped;
}

const clampLat = (lat: number) => Math.max(-90, Math.min(90, lat));

/** Entfernung zweier Lagen über die Oberfläche (Großkreis), in Kilometern. */
export function distanceKm(radiusKm: number, a: LonLat, b: LonLat): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = wrapLon(b.lon - a.lon) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Richtung von `a` nach `b` beim Aufbruch, in Grad: 0 = Norden, 90 = Osten. */
export function bearingDeg(a: LonLat, b: LonLat): number {
  const dLon = wrapLon(b.lon - a.lon) * RAD;
  const y = Math.sin(dLon) * Math.cos(b.lat * RAD);
  const x =
    Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) -
    Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

const COMPASS = [
  'Norden',
  'Nordosten',
  'Osten',
  'Südosten',
  'Süden',
  'Südwesten',
  'Westen',
  'Nordwesten',
];

/** Die Himmelsrichtung zu einer Gradzahl: „Nordosten“. */
export const compass = (bearing: number): string =>
  COMPASS[Math.round((((bearing % 360) + 360) % 360) / 45) % 8]!;

/** Die Lage, die man erreicht, wenn man von `from` aus `km` weit in eine Richtung geht. */
export function destination(radiusKm: number, from: LonLat, bearing: number, km: number): LonLat {
  const d = km / radiusKm;
  const lat1 = from.lat * RAD;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing * RAD),
  );
  const lon2 =
    from.lon * RAD +
    Math.atan2(
      Math.sin(bearing * RAD) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lon: wrapLon(lon2 / RAD), lat: clampLat(lat2 / RAD) };
}

/** Ein Punkt auf dem Weg von `a` nach `b`: `t` = 0 ist der Anfang, 1 das Ziel. */
export function along(a: LonLat, b: LonLat, t: number): LonLat {
  const lat1 = a.lat * RAD;
  const lon1 = a.lon * RAD;
  const lat2 = b.lat * RAD;
  const lon2 = lon1 + wrapLon(b.lon - a.lon) * RAD;
  const h =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  if (d < 1e-12) return { lon: a.lon, lat: a.lat };
  const p = Math.sin((1 - t) * d) / Math.sin(d);
  const q = Math.sin(t * d) / Math.sin(d);
  const x = p * Math.cos(lat1) * Math.cos(lon1) + q * Math.cos(lat2) * Math.cos(lon2);
  const y = p * Math.cos(lat1) * Math.sin(lon1) + q * Math.cos(lat2) * Math.sin(lon2);
  const z = p * Math.sin(lat1) + q * Math.sin(lat2);
  return {
    lon: wrapLon(Math.atan2(y, x) / RAD),
    lat: clampLat(Math.atan2(z, Math.hypot(x, y)) / RAD),
  };
}

// ── Ringe: Küsten, Seen ────────────────────────────────────────────────────

/** Ein geschlossener Ring als flache Liste `[Länge, Breite, …]`; der letzte Punkt schließt zum ersten. */
export type Ring = readonly number[];

export interface RingBounds {
  south: number;
  north: number;
  /** Mitte und halbe Breite in Längengraden – so stimmt es auch über die Datumsgrenze hinweg. */
  lon: number;
  halfWidth: number;
  /** Der Ring läuft einmal um die Achse: Er umschließt einen Pol. */
  polar: 'north' | 'south' | null;
}

/** Die Ausdehnung eines Rings – einmal gerechnet, spart sie die meisten Prüfungen. */
export function ringBounds(ring: Ring): RingBounds {
  let south = 90;
  let north = -90;
  let turn = 0;
  let offset = 0;
  let min = 0;
  let max = 0;
  let latSum = 0;
  const count = ring.length / 2;
  for (let i = 0; i < count; i++) {
    const lat = ring[i * 2 + 1]!;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    latSum += lat;
    const next = (i + 1) % count;
    const step = wrapLon(ring[next * 2]! - ring[i * 2]!);
    turn += step;
    // Die Längen fortlaufend abgewickelt, vom ersten Punkt aus.
    if (i < count - 1) {
      offset += step;
      if (offset < min) min = offset;
      if (offset > max) max = offset;
    }
  }
  const around = Math.abs(turn) > 180;
  const start = ring[0] ?? 0;
  return {
    south: around && latSum < 0 ? -90 : south,
    north: around && latSum >= 0 ? 90 : north,
    lon: around ? 0 : wrapLon(start + (min + max) / 2),
    halfWidth: around ? 180 : (max - min) / 2,
    polar: around ? (latSum >= 0 ? 'north' : 'south') : null,
  };
}

/**
 * Liegt eine Lage in einem Ring? Gezählt wird, wie oft der Meridian von der Lage nach Norden die
 * Küste schneidet. Ringe um einen Pol und über die Datumsgrenze hinweg sind mit bedacht.
 */
export function inRing(ring: Ring, point: LonLat, bounds: RingBounds = ringBounds(ring)): boolean {
  if (point.lat < bounds.south || point.lat > bounds.north) return false;
  if (Math.abs(wrapLon(point.lon - bounds.lon)) > bounds.halfWidth) return false;
  const count = ring.length / 2;
  let crossings = 0;
  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count;
    const lonA = ring[i * 2]!;
    const latA = ring[i * 2 + 1]!;
    const step = wrapLon(ring[next * 2]! - lonA);
    if (step === 0) continue;
    const rel = wrapLon(point.lon - lonA);
    const within = step > 0 ? rel >= 0 && rel < step : rel <= 0 && rel > step;
    if (!within) continue;
    const lat = latA + (rel / step) * (ring[next * 2 + 1]! - latA);
    if (lat > point.lat) crossings++;
  }
  // Umschließt der Ring den Nordpol, liegt innen, wer auf dem Weg dorthin keine Küste kreuzt.
  return bounds.polar === 'north' ? crossings % 2 === 0 : crossings % 2 === 1;
}

/**
 * Vereinfacht einen Ring: Punkte, die weniger als `tolerance` Grad von der Linie ihrer Nachbarn
 * abweichen, fallen weg (Douglas–Peucker). Ein Ring behält mindestens vier Punkte.
 */
export function simplifyRing(ring: Ring, tolerance: number): number[] {
  const count = ring.length / 2;
  if (count <= 4 || tolerance <= 0) return [...ring];
  const keep = new Uint8Array(count);
  // Zwei feste Anker: der erste Punkt und der am weitesten davon entfernte.
  let far = 0;
  let farDistance = -1;
  for (let i = 1; i < count; i++) {
    const d = Math.hypot(wrapLon(ring[i * 2]! - ring[0]!), ring[i * 2 + 1]! - ring[1]!);
    if (d > farDistance) {
      farDistance = d;
      far = i;
    }
  }
  keep[0] = 1;
  keep[far] = 1;
  const stack: [number, number][] = [
    [0, far],
    [far, count],
  ];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    const end = to % count;
    const ax = ring[from * 2]!;
    const ay = ring[from * 2 + 1]!;
    const bx = ax + wrapLon(ring[end * 2]! - ax);
    const by = ring[end * 2 + 1]!;
    const length = Math.hypot(bx - ax, by - ay);
    let worst = -1;
    let worstDistance = tolerance;
    for (let i = from + 1; i < to; i++) {
      const px = ax + wrapLon(ring[i * 2]! - ax);
      const py = ring[i * 2 + 1]!;
      const d =
        length === 0
          ? Math.hypot(px - ax, py - ay)
          : Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / length;
      if (d > worstDistance) {
        worstDistance = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([from, worst], [worst, to]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (keep[i]) out.push(ring[i * 2]!, ring[i * 2 + 1]!);
  return out.length >= 8 ? out : [...ring];
}

// ── Höhen ──────────────────────────────────────────────────────────────────

/** Höhenraster über den ganzen Planeten: Zeile 0 liegt im Norden, Spalte 0 bei Länge −180. */
export interface HeightGrid {
  width: number;
  height: number;
  /** Höhe in Metern je Zelle; `NODATA`, wo es keine Angabe gibt (offenes Meer). */
  data: Int16Array;
}

export const NODATA = -32768;

/** Die Höhe an einer Lage in Metern, zwischen den Zellen gemittelt; null ohne Angabe. */
export function heightAt(grid: HeightGrid, point: LonLat): number | null {
  const x = ((wrapLon(point.lon) + 180) / 360) * grid.width - 0.5;
  const y = ((90 - clampLat(point.lat)) / 180) * grid.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  let sum = 0;
  let weight = 0;
  for (const [dx, dy, w] of [
    [0, 0, (1 - fx) * (1 - fy)],
    [1, 0, fx * (1 - fy)],
    [0, 1, (1 - fx) * fy],
    [1, 1, fx * fy],
  ] as const) {
    if (w <= 0) continue;
    const cx = (((x0 + dx) % grid.width) + grid.width) % grid.width;
    const cy = Math.max(0, Math.min(grid.height - 1, y0 + dy));
    const value = grid.data[cy * grid.width + cx]!;
    if (value === NODATA) continue;
    sum += value * w;
    weight += w;
  }
  return weight > 0 ? sum / weight : null;
}

// ── Sonne ──────────────────────────────────────────────────────────────────

/**
 * Wie lange es an einem Tag hell ist, in Stunden. `yearFraction` ist der Anteil des Jahres seit
 * der Frühlings-Tagundnachtgleiche der Nordhalbkugel (0…1); `obliquityDeg` die Neigung der Achse.
 * Jenseits der Polarkreise gibt es Tage ohne Nacht (ganzer Tag) und ohne Licht (0).
 */
export function daylightHours(
  lat: number,
  obliquityDeg: number,
  yearFraction: number,
  dayHours = 24,
): number {
  const declination = Math.asin(
    Math.sin(obliquityDeg * RAD) * Math.sin(2 * Math.PI * yearFraction),
  );
  const x = -Math.tan(clampLat(lat) * RAD) * Math.tan(declination);
  if (x <= -1) return dayHours;
  if (x >= 1) return 0;
  return (Math.acos(x) / Math.PI) * dayHours;
}
