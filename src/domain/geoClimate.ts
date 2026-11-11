/**
 * Klima aus der Lage: Breite, Höhe und Küstennähe eines Punktes auf dem Planeten ergeben nach
 * festen Regeln eine Klimazone – ohne dass der Spielleiter sie eintragen muss. Reine Funktionen.
 */
import type { LonLat } from './geo';
import { coastKm, terrainAt, type Planet } from './planet';
import type { HeightGrid } from './geo';
import type { Climate, Terrain } from './schema';
import { PRESET, presetClimate, presetClimateId, type ClimatePreset } from './weather';

/** Was das Klima an einer Stelle bestimmt. */
export interface Site {
  /** Breite in Grad, Süden negativ. */
  lat: number;
  /** Höhe in Metern; null ohne Angabe. */
  heightM: number | null;
  /** Entfernung zum offenen Meer in km (siehe `coastKm`); null = tiefes Binnenland. */
  coastKm: number | null;
}

/** Die Stelle zu einer Lage auf dem Planeten. */
export function siteAt(planet: Planet, grid: HeightGrid | null, point: LonLat): Site {
  return {
    lat: point.lat,
    heightM: terrainAt(planet, grid, point).heightM,
    coastKm: coastKm(planet, point),
  };
}

/** Bis zu dieser Höhe zählt Land als Tiefland – darüber wird es kühler. */
const LOWLAND_M = 300;
/** Je 1 000 Höhenmeter wird es um so viel kälter, in °C. */
const LAPSE = 6.5;
/** Ab hier herrscht Gebirgswetter: windig, neblig, wechselhaft. */
const MOUNTAIN_M = 1800;
/** Näher am Meer ist das Klima mild und feucht. */
const NEAR_COAST_KM = 100;
/** Weiter vom Meer bleibt der Regen aus (in den trockenen Breiten). */
const FAR_INLAND_KM = 450;

/**
 * Die Vorgabe, die zur Stelle passt – nach der Breite, an der Küste milder, im trockenen Gürtel
 * fern vom Meer Wüste.
 */
export function sitePreset(site: Site): ClimatePreset {
  const lat = Math.abs(site.lat);
  const near = site.coastKm !== null && site.coastKm <= NEAR_COAST_KM;
  const inland = site.coastKm === null || site.coastKm > FAR_INLAND_KM;
  if (lat >= 68) return 'arctic';
  if (lat >= 55) return 'cold';
  if (lat >= 35) return near ? 'maritime' : 'temperate';
  if (lat >= 20) return inland ? 'desert' : 'warm';
  return inland && lat >= 12 ? 'desert' : 'tropical';
}

/** Um wie viele Grad es an der Stelle wegen der Höhe kälter ist. */
export function siteCooling(site: Site): number {
  return site.heightM === null
    ? 0
    : Math.round((Math.max(0, site.heightM - LOWLAND_M) / 1000) * LAPSE);
}

/**
 * Der wärmste Monat an einer Breite: Auf der Südhalbkugel liegt der Sommer ein halbes Jahr
 * versetzt.
 */
export function warmestMonthAt(warmestNorth: number, monthCount: number, lat: number): number {
  return lat < 0 ? (warmestNorth + Math.round(monthCount / 2)) % monthCount : warmestNorth;
}

export interface SiteClimate {
  climate: Climate;
  preset: ClimatePreset;
  /** Abkühlung durch die Höhe in °C. */
  cooling: number;
  south: boolean;
}

/**
 * Baut die Klimazone einer Stelle: die Vorgabe ihrer Breite, um die Höhe abgekühlt, im Hochgebirge
 * mit dessen Wind, Nebel und Niederschlag, auf der Südhalbkugel mit versetzten Jahreszeiten.
 * `warmestNorth` ist der wärmste Monat der Nordhalbkugel.
 */
export function siteClimate(site: Site, monthCount: number, warmestNorth: number): SiteClimate {
  const preset = sitePreset(site);
  const cooling = siteCooling(site);
  const south = site.lat < 0;
  const warmest = warmestMonthAt(warmestNorth, monthCount, site.lat);
  const base = presetClimate(preset, monthCount, warmest);
  const high = site.heightM !== null && site.heightM >= MOUNTAIN_M;
  const mountain = high ? presetClimate('mountain', monthCount, warmest) : null;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    preset,
    cooling,
    south,
    climate: {
      ...base,
      id: `klima-lage-${preset}${south ? '-s' : ''}${cooling ? `-${cooling}` : ''}${high ? '-g' : ''}`,
      name: high ? `${PRESET.mountain.name} (${PRESET[preset].name})` : PRESET[preset].name,
      months: base.months.map((month, index) => ({
        tempMax: round(month.tempMax - cooling),
        tempMin: round(month.tempMin - cooling),
        precipitation: mountain ? mountain.months[index]!.precipitation : month.precipitation,
        wind: mountain ? mountain.months[index]!.wind : month.wind,
        fog: mountain ? mountain.months[index]!.fog : month.fog,
      })),
    },
  };
}

/** Eine Vorgabe mit den Jahreszeiten der Südhalbkugel – für erkannte Zonen an Orten im Süden. */
export function southern(climate: Climate, preset: ClimatePreset): Climate {
  return { ...climate, id: `${presetClimateId(preset)}-s` };
}

/** Die Landschaft, die zu einem Klima gehört – für Hexkarten, wenn sonst nichts darauf deutet. */
export function biomeOfPreset(preset: ClimatePreset): Terrain {
  switch (preset) {
    case 'arctic':
      return 'arctic';
    case 'desert':
      return 'desert';
    case 'cold':
    case 'tropical':
      return 'forest';
    case 'mountain':
      return 'mountains';
    case 'underground':
      return 'underdark';
    default:
      return 'grassland';
  }
}

/** „52° Süd, 340 m, nahe am Meer“ – woran das Klima einer Stelle abgelesen wurde. */
export function describeSite(site: Site): string {
  const parts = [`${Math.round(Math.abs(site.lat))}° ${site.lat < 0 ? 'Süd' : 'Nord'}`];
  if (site.heightM !== null && site.heightM > LOWLAND_M)
    parts.push(`${(Math.round(site.heightM / 10) * 10).toLocaleString('de-DE')} m hoch`);
  if (site.coastKm !== null && site.coastKm <= NEAR_COAST_KM) parts.push('nahe am Meer');
  else if (site.coastKm === null || site.coastKm > FAR_INLAND_KM) parts.push('fern vom Meer');
  return parts.join(', ');
}
