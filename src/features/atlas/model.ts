/**
 * Der Atlas im Spielstand: der Planet mit Küsten, Gewässern und Höhen – und was sich daraus
 * ablesen lässt. Reine Funktionen; die Rechnung auf der Kugel steht in `domain/geo.ts`, der
 * Planet selbst (Küsten, Höhen, Lage der Orte) in `domain/planet.ts` und wird hier weitergereicht.
 */
import { compass, bearingDeg, daylightHours, distanceKm, type LonLat } from '../../domain/geo';
import { exactGeo, geoIndex, placeGeo, planetOf, type Terrain } from '../../domain/planet';
import type { CampaignData, GameMap, Place } from '../../domain/schema';
import { MINUTES_PER_DAY, daysBeforeYear, fromTime, yearLength } from '../../domain/time/calendar';
import { warmestMonth } from '../../domain/weatherZone';

export * from '../../domain/planet';

export interface Leg {
  km: number;
  /** Richtung beim Aufbruch: Grad und Wort („Nordosten“). */
  bearing: number;
  direction: string;
}

/** Luftlinie und Richtung zwischen zwei Orten – null, wenn einer keine Lage hat oder beide dieselbe. */
export function legBetween(data: CampaignData, fromId: string, toId: string): Leg | null {
  const planet = planetOf(data);
  const a = placeGeo(data, fromId);
  const b = placeGeo(data, toId);
  if (!planet || !a || !b) return null;
  const km = distanceKm(planet.radiusKm, a.geo, b.geo);
  if (km < 0.001) return null;
  const bearing = bearingDeg(a.geo, b.geo);
  return { km, bearing, direction: compass(bearing) };
}

// ── Worte ──────────────────────────────────────────────────────────────────

const degrees = (value: number) =>
  Math.abs(value).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** „12,3° N, 45,6° O“ */
export function formatGeo(point: LonLat): string {
  return `${degrees(point.lat)}° ${point.lat >= 0 ? 'N' : 'S'}, ${degrees(point.lon)}° ${point.lon >= 0 ? 'O' : 'W'}`;
}

/** „1 240 km“, unter zehn Kilometern mit einer Nachkommastelle. */
export function formatKm(km: number): string {
  return `${km.toLocaleString('de-DE', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

/** Was an einer Lage ist, in Worten: „Land · 340 m“, „Meer“, „See“. */
export function describeTerrain(terrain: Terrain): string {
  if (terrain.water === 'sea') return 'Meer';
  const meters =
    terrain.heightM === null ? '' : Math.round(terrain.heightM).toLocaleString('de-DE');
  const height =
    terrain.heightM === null
      ? ''
      : terrain.generated
        ? ` · etwa ${meters} m (erzeugt)`
        : ` · ${meters} m`;
  if (terrain.water === 'lake') return `See${height}`;
  return `${terrain.land?.name || 'Land'}${height}`;
}

// ── Sonne ──────────────────────────────────────────────────────────────────

/**
 * Wie weit das Jahr seit der Frühlings-Tagundnachtgleiche der Nordhalbkugel fortgeschritten ist
 * (0…1). Der Kalender nennt keine Sonnenwende; Wayfarer nimmt den längsten Tag am Beginn des
 * wärmsten Monats an – das Wetter hinkt der Sonne etwa einen halben Monat nach.
 */
export function seasonFraction(data: CampaignData, time: number): number {
  const cal = data.campaign.calendar;
  const date = fromTime(cal, time);
  const length = yearLength(cal, date.year);
  const dayOfYear = Math.floor(time / MINUTES_PER_DAY) - daysBeforeYear(cal, date.year);
  let solstice = 0;
  const warmest = warmestMonth(data);
  for (let month = 0; month < warmest; month++) solstice += cal.months[month]!.days;
  const fraction = (dayOfYear - solstice) / length + 0.25;
  return ((fraction % 1) + 1) % 1;
}

/** Stunden Tageslicht an einer Lage zur Weltzeit – null, solange kein Atlas übernommen ist. */
export function daylightAt(data: CampaignData, point: LonLat, time: number): number | null {
  const planet = planetOf(data);
  if (!planet) return null;
  return daylightHours(
    point.lat,
    planet.doc.obliquityDeg,
    seasonFraction(data, time),
    planet.doc.dayHours,
  );
}

export interface Sun {
  /** Stunden Tageslicht. */
  hours: number;
  /** Aufgang und Untergang als Minute des Tages; null am Polartag und in der Polarnacht. */
  rise: number | null;
  set: number | null;
  /** Die Sonne geht den ganzen Tag nicht unter (`day`) oder nicht auf (`night`). */
  polar: 'day' | 'night' | null;
}

/**
 * Die Sonne am Ort zur Weltzeit: Tageslänge, Aufgang und Untergang. Mittag ist die Mitte des
 * Tages. Null, solange kein Atlas übernommen ist oder der Ort keine Lage hat.
 */
export function sunAt(data: CampaignData, placeId: string | null, time: number): Sun | null {
  const planet = planetOf(data);
  const located = placeGeo(data, placeId);
  if (!planet || !located) return null;
  const hours = daylightAt(data, located.geo, time)!;
  const share = hours / planet.doc.dayHours;
  if (share >= 1) return { hours, rise: null, set: null, polar: 'day' };
  if (share <= 0) return { hours, rise: null, set: null, polar: 'night' };
  const half = (share * MINUTES_PER_DAY) / 2;
  return {
    hours,
    rise: Math.round(MINUTES_PER_DAY / 2 - half),
    set: Math.round(MINUTES_PER_DAY / 2 + half),
    polar: null,
  };
}

/** Ist es zu dieser Minute des Tages dunkel? */
export function isDark(sun: Sun, minuteOfDay: number): boolean {
  if (sun.polar) return sun.polar === 'night';
  return minuteOfDay < sun.rise! || minuteOfDay >= sun.set!;
}

/** „07:10“ aus der Minute des Tages. */
export function formatMinuteOfDay(minute: number): string {
  const m = ((Math.round(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Ein Satz zur Sonne: „Hell von 07:10 bis 16:50 (9 Std. 40 Min.)“. */
export function describeSun(sun: Sun): string {
  if (sun.polar === 'day') return 'Polartag – die Sonne geht nicht unter';
  if (sun.polar === 'night') return 'Polarnacht – die Sonne geht nicht auf';
  return `Hell von ${formatMinuteOfDay(sun.rise!)} bis ${formatMinuteOfDay(sun.set!)} (${formatHours(sun.hours)})`;
}

/** „9 Std. 40 Min.“ */
export function formatHours(hours: number): string {
  const minutes = Math.round(hours * 60);
  const h = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${h} Std. ${rest} Min.` : `${h} Std.`;
}

// ── Orte für die Karte ─────────────────────────────────────────────────────

export interface PlacedPlace {
  place: Place;
  geo: LonLat;
  /** Kein Ort darüber hat selbst eine Lage. */
  major: boolean;
  /** Die Karte, aus der die Lage gerechnet ist; null, wenn sie eingetragen wurde. */
  via: GameMap | null;
}

export interface PlaceOnMap {
  map: GameMap;
  /** So viele Orte dieser Karte haben schon eine Lage. */
  placed: number;
  /** Die Karte hängt im Planeten: Zwei ihrer Orte haben eine Lage. */
  anchored: boolean;
}

/** Die Karten, auf denen ein Ort eingetragen ist – und wie weit sie vom Einhängen entfernt sind. */
export function mapsOfPlace(
  data: Pick<CampaignData, 'entities' | 'maps' | 'atlas'>,
  placeId: string,
): PlaceOnMap[] {
  const index = geoIndex(data);
  const out: PlaceOnMap[] = [];
  for (const map of Object.values(data.maps)) {
    if (!map.markers.some((marker) => marker.entityId === placeId)) continue;
    const placed = new Set<string>();
    for (const marker of map.markers) {
      const entity = marker.entityId ? data.entities[marker.entityId] : undefined;
      if (entity?.kind === 'place' && exactGeo(data, entity)) placed.add(entity.id);
    }
    out.push({ map, placed: placed.size, anchored: index.anchors.has(map.id) });
  }
  return out.sort((a, b) => a.map.name.localeCompare(b.map.name, 'de'));
}

/** Alle Orte mit einer Lage, die zu ihnen selbst gehört – eingetragen oder aus einer Karte. */
export function placedPlaces(
  data: Pick<CampaignData, 'entities'> & Partial<Pick<CampaignData, 'maps' | 'atlas'>>,
): PlacedPlace[] {
  const out: PlacedPlace[] = [];
  for (const entity of Object.values(data.entities)) {
    const found = entity.kind === 'place' ? exactGeo(data, entity) : null;
    if (entity.kind !== 'place' || !found) continue;
    const above = entity.place.parentId ? placeGeo(data, entity.place.parentId) : null;
    out.push({ place: entity, geo: found.geo, major: above === null, via: found.map });
  }
  return out.sort((a, b) => a.place.name.localeCompare(b.place.name, 'de'));
}
