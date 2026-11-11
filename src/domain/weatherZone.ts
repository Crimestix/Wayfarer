/**
 * Welches Wetter an einem Ort herrscht: die Klimazone des Ortes finden (festgelegt, aus der Lage
 * gerechnet, erkannt oder die Vorgabe) und daraus das Wetter eines Tages rechnen. Reine
 * Funktionen über dem Spielstand.
 */
import { siteAt, siteClimate, southern, warmestMonthAt, type Site } from './geoClimate';
import { exactGeo, placeChain, planetOf, reliefOf } from './planet';
import { seedOf } from './random';
import { weatherId, type CampaignData, type Climate, type Place } from './schema';
import { ELARIS_WARMEST_MONTH } from './time/elaris';
import { dayIndexOf, MINUTES_PER_DAY } from './time/calendar';
import {
  presetClimate,
  presetOfClimateId,
  recognizeClimate,
  simulateDay,
  weatherAtMinute,
  weatherEffects,
  withManual,
  type ClimatePreset,
  type DayWeather,
  type WeatherEffect,
  type WeatherNow,
} from './weather';

/**
 * Der wärmste Monat des Jahres (0-basiert). Steht in der Kampagne, sobald der Spielleiter ihn
 * festgelegt hat; sonst gilt für Elaris der Hochsommer seines Kalenders und für fremde Kalender
 * ein Jahr, das im tiefen Winter beginnt.
 */
export function warmestMonth(data: CampaignData): number {
  const count = data.campaign.calendar.months.length;
  const chosen = data.campaign.warmestMonth;
  if (chosen !== null && chosen < count) return chosen;
  if (data.campaign.calendar.id === 'elaris') return ELARIS_WARMEST_MONTH;
  return Math.min(count - 1, Math.round((count * 6.5) / 12));
}

/** So groß ist eine Gegend mit gemeinsamem Wetter, in Grad. */
const WEATHER_CELL_DEG = 2;

export interface WeatherZone {
  climate: Climate;
  /**
   * Vom Spielleiter festgelegt, aus der Lage auf dem Planeten gerechnet, aus den Worten der Orte
   * erkannt oder die allgemeine Vorgabe.
   */
  source: 'chosen' | 'position' | 'recognized' | 'default';
  /** Bei „position“: Breite, Höhe und Küstennähe, aus denen das Klima gerechnet wurde. */
  site?: Site;
  /** Die Vorgabe hinter der Zone, wenn es eine ist. */
  preset: ClimatePreset | null;
  /** Der Ort, an dem die Zone hängt: wo sie festgelegt oder erkannt wurde. */
  from: Place | null;
  /** Ausgangswert für das Wetter dieser Gegend. */
  seed: number;
}

/**
 * Die Klimazone eines Ortes. Der Ort selbst geht vor, dann die Orte darüber: Wo ein Klima
 * festgelegt ist, gilt es für alles darunter. Ohne Festlegung rechnet Wayfarer es aus der Lage
 * auf dem Planeten (Breite, Höhe, Küstennähe) oder liest es aus den Namen – was näher am Ort
 * steht, gilt; auf gleicher Stufe gehen deutliche Worte („Wüste“, „Gletscher“) der Lage vor,
 * nur „Hafen“ und „Insel“ nicht. Unter der Erde gibt es nie Wetter. Sonst gilt „Gemäßigt“.
 * Orte derselben Zone unter demselben Ort teilen ihr Wetter.
 */
export function weatherZone(data: CampaignData, placeId: string | null): WeatherZone {
  const chain: Place[] = placeChain(data, placeId);
  const months = data.campaign.calendar.months.length;
  const warmest = warmestMonth(data);
  const seedFor = (climateId: string, cell: Place | null) =>
    seedOf(data.campaign.created, climateId, cell?.id ?? 'welt');

  for (const place of chain) {
    const climate = place.place.climateId ? data.climates[place.place.climateId] : undefined;
    if (climate)
      return {
        climate,
        source: 'chosen',
        preset: presetOfClimateId(climate.id),
        from: place,
        seed: seedFor(climate.id, place),
      };
  }
  const recognized = recognizeClimate(
    chain.map((place) => ({ name: place.name, category: place.place.category, tags: place.tags })),
  );
  // Die Lage: der nächste Ort der Kette, an dem selbst eine eingetragen ist.
  const planet = planetOf(data);
  const placedIndex = planet ? chain.findIndex((place) => exactGeo(data, place)) : -1;
  const placed = placedIndex >= 0 ? chain[placedIndex]! : null;
  const placedGeo = placed ? exactGeo(data, placed)!.geo : null;
  const wordsWin =
    recognized !== null &&
    (recognized.preset === 'underground' ||
      placed === null ||
      recognized.index < placedIndex ||
      (recognized.index === placedIndex && recognized.preset !== 'maritime'));
  if (planet && placed && placedGeo && !wordsWin) {
    const site = siteAt(planet, reliefOf(data), placedGeo);
    const { climate, preset } = siteClimate(site, months, warmest);
    // Orte derselben Gegend teilen ihr Wetter: Der Ausgangswert hängt am Feld des Gradnetzes
    // (zwei Grad, rund 250 km), nicht am einzelnen Ort.
    const cell = `${Math.round(placedGeo.lon / WEATHER_CELL_DEG)}/${Math.round(placedGeo.lat / WEATHER_CELL_DEG)}`;
    return {
      climate,
      source: 'position',
      preset,
      from: placed,
      seed: seedOf(data.campaign.created, 'lage', cell),
      site,
    };
  }
  if (recognized) {
    const from = chain[recognized.index] ?? null;
    // Liegt der Ort bekanntermaßen im Süden, sind die Jahreszeiten versetzt.
    const lat = placedGeo?.lat ?? 0;
    const north = presetClimate(recognized.preset, months, warmest);
    const climate =
      lat < 0 && recognized.preset !== 'underground'
        ? southern(
            presetClimate(recognized.preset, months, warmestMonthAt(warmest, months, lat)),
            recognized.preset,
          )
        : north;
    return {
      climate,
      source: 'recognized',
      preset: recognized.preset,
      from,
      seed: seedFor(climate.id, from),
    };
  }
  // Ohne jeden Hinweis: ein Wetter für die ganze Welt über dem Ort.
  const climate = presetClimate('temperate', months, warmest);
  const top = chain[chain.length - 1] ?? null;
  return {
    climate,
    source: 'default',
    preset: 'temperate',
    from: null,
    seed: seedFor(climate.id, top),
  };
}

/** Das Wetter eines Tages in einer Zone – festgelegtes Wetter geht dem errechneten vor. */
export function zoneWeather(data: CampaignData, zone: WeatherZone, day: number): DayWeather {
  const simulated = simulateDay(zone.climate, data.campaign.calendar, zone.seed, day);
  const manual = data.weather[weatherId(zone.climate.id, day)];
  return withManual(simulated, manual?.manual ? manual : undefined);
}

export interface PlaceWeather {
  zone: WeatherZone;
  today: DayWeather;
  now: WeatherNow;
  effects: WeatherEffect[];
}

/** Das Wetter an einem Ort zu einer Weltzeit. */
export function weatherAt(data: CampaignData, placeId: string | null, time: number): PlaceWeather {
  const zone = weatherZone(data, placeId);
  const day = dayIndexOf(time);
  const today = zoneWeather(data, zone, day);
  const now = weatherAtMinute(today, time - day * MINUTES_PER_DAY);
  return { zone, today, now, effects: weatherEffects(now) };
}

/** Das Wetter der kommenden Tage in einer Zone, beginnend mit `fromDay`. */
export function forecast(
  data: CampaignData,
  zone: WeatherZone,
  fromDay: number,
  days: number,
): DayWeather[] {
  return Array.from({ length: days }, (_, i) => zoneWeather(data, zone, fromDay + i));
}
