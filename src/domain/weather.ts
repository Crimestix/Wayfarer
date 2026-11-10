/**
 * Wettersimulation. Reine Funktionen, wiederholbar: Aus Klima, Kalender, Ausgangswert und Tag
 * entsteht immer dasselbe Wetter – eine Rückreise findet dieselbe Welt vor.
 *
 * Das Wetter eines Tages wird nicht für sich gewürfelt. Feuchte, Wind und Temperatur folgen
 * Wetterlagen, die über mehrere Tage ziehen: Auf einen Regentag folgt eher ein weiterer, eine
 * Kälteperiode hält an. Trotzdem lässt sich jeder Tag direkt ausrechnen, ohne die Tage davor
 * durchzugehen – das Wetter in drei Wochen steht fest, ohne dass etwas gespeichert wird.
 */
import { seedOf } from './random';
import type { Climate, Weather } from './schema';
import { fromTime, monthLength, type CalendarDef } from './time/calendar';

export type Level = 'none' | 'light' | 'heavy';
export type WindLevel = 'none' | 'light' | 'strong';
export type Sky = 'clear' | 'fair' | 'cloudy' | 'overcast';
export type PrecipitationKind = 'rain' | 'snow' | 'sleet';
export type DayPartKey = 'night' | 'morning' | 'day' | 'evening';

export const DAY_PARTS: readonly DayPartKey[] = ['night', 'morning', 'day', 'evening'];
export const DAY_PART_LABEL: Record<DayPartKey, string> = {
  night: 'Nacht',
  morning: 'Vormittag',
  day: 'Nachmittag',
  evening: 'Abend',
};

export interface DayPart {
  key: DayPartKey;
  /** °C zur Mitte des Abschnitts. */
  temperature: number;
  precipitation: Level;
  fog: boolean;
}

export interface DayWeather {
  /** Tagesindex seit Beginn der Weltzeit. */
  day: number;
  /** Höchstwert am Nachmittag, °C. */
  high: number;
  /** Tiefstwert vor Sonnenaufgang, °C. */
  low: number;
  /** Stärkster Niederschlag des Tages. */
  precipitation: Level;
  /** Regen, Schnee oder Schneeregen – null ohne Niederschlag. */
  kind: PrecipitationKind | null;
  wind: WindLevel;
  /** Nebel zu irgendeiner Zeit des Tages. */
  fog: boolean;
  sky: Sky;
  /** Der Tag in vier Abschnitten zu je sechs Stunden. */
  parts: DayPart[];
  /** Vom Spielleiter festgelegt statt errechnet. */
  manual: boolean;
  /** Kein Wetter: unter der Erde oder sonst abgeschirmt. */
  sheltered: boolean;
  note: string;
}

// ── Zusammenhängender Zufall ───────────────────────────────────────────────

/** Gleichverteilte Zahl in [0, 1) für einen Tag – ohne Zusammenhang mit den Nachbartagen. */
function noise(seed: number, channel: string, day: number): number {
  // Zweimal mischen: Aufeinanderfolgende Tage sollen nichts miteinander zu tun haben.
  let h = seedOf(seed, channel, day);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1));
const choose = (n: number, k: number): number => factorial(n) / (factorial(k) * factorial(n - k));

/** Verteilungsfunktion der Summe von `n` gleichverteilten Zahlen (Irwin–Hall). */
function sumCdf(sum: number, n: number): number {
  if (sum <= 0) return 0;
  if (sum >= n) return 1;
  let total = 0;
  for (let k = 0; k <= Math.floor(sum); k++)
    total += (k % 2 === 0 ? 1 : -1) * choose(n, k) * (sum - k) ** n;
  return Math.min(1, Math.max(0, total / factorial(n)));
}

/**
 * Gleichverteilte Zahl in [0, 1], die sich von Tag zu Tag nur allmählich ändert: der Mittelwert
 * der Zufallswerte der letzten `span` Tage, zurückgerechnet auf eine gleichmäßige Verteilung.
 * So bleibt „an 30 % der Tage regnet es“ wahr, und die Regentage hängen trotzdem zusammen.
 */
export function drift(seed: number, channel: string, day: number, span: number): number {
  let sum = 0;
  for (let i = 0; i < span; i++) sum += noise(seed, channel, day - i);
  return sumCdf(sum, span);
}

// ── Klima ──────────────────────────────────────────────────────────────────

type ClimateMonth = Climate['months'][number];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Rundet auf ganze Grad – und macht aus „−0“ eine gewöhnliche Null. */
const whole = (value: number): number => Math.round(value) + 0;

/** Die Werte des Klimas an einem Tag: zwischen den Monatsmitten fließend überblendet. */
export function climateOn(climate: Climate, cal: CalendarDef, day: number): ClimateMonth | null {
  const count = climate.months.length;
  if (!count) return null;
  const date = fromTime(cal, day * 1440);
  const position = (date.day - 0.5) / monthLength(cal, date.year, date.month) - 0.5;
  const here = climate.months[date.month % count]!;
  const other = climate.months[(date.month + (position < 0 ? -1 : 1) + count) % count]!;
  const t = Math.abs(position);
  return {
    tempMin: lerp(here.tempMin, other.tempMin, t),
    tempMax: lerp(here.tempMax, other.tempMax, t),
    precipitation: lerp(here.precipitation, other.precipitation, t),
    wind: lerp(here.wind, other.wind, t),
    fog: lerp(here.fog, other.fog, t),
  };
}

/** Ein Klima ohne Wetter – etwa unter der Erde: nie Niederschlag, Wind oder Nebel. */
export const isSheltered = (climate: Climate): boolean =>
  climate.months.length > 0 &&
  climate.months.every((m) => m.precipitation === 0 && m.wind === 0 && m.fog === 0);

// ── Ein Tag ────────────────────────────────────────────────────────────────

/** Uhrzeit (Stunde) zur Mitte jedes Tagesabschnitts. */
const PART_HOUR: Record<DayPartKey, number> = { night: 3, morning: 9, day: 15, evening: 21 };

/** Temperatur zu einer Uhrzeit: am kältesten gegen 3 Uhr, am wärmsten gegen 15 Uhr. */
export function temperatureAt(weather: Pick<DayWeather, 'high' | 'low'>, hour: number): number {
  const mid = (weather.high + weather.low) / 2;
  const swing = (weather.high - weather.low) / 2;
  return whole(mid + swing * Math.cos(((hour - 15) / 24) * 2 * Math.PI));
}

function precipitationKind(high: number, low: number): PrecipitationKind {
  if (high <= 1) return 'snow';
  if (high <= 4 && low <= 0) return 'sleet';
  return 'rain';
}

/** Verteilt Niederschlag und Nebel über die vier Abschnitte des Tages. */
function partsOf(
  seed: number,
  day: number,
  base: Pick<DayWeather, 'high' | 'low' | 'precipitation' | 'fog'>,
): DayPart[] {
  const wet = new Map<DayPartKey, Level>();
  if (base.precipitation !== 'none') {
    const heavy = base.precipitation === 'heavy';
    // Leichter Niederschlag: ein bis drei Abschnitte am Stück; starker: zwei bis vier.
    const length = (heavy ? 2 : 1) + Math.floor(noise(seed, 'dauer', day) * 3);
    const start = Math.floor(noise(seed, 'beginn', day) * 4);
    for (let i = 0; i < Math.min(length, 4); i++) {
      const key = DAY_PARTS[(start + i) % 4]!;
      // Ein langer Starkregen beginnt und endet schwächer.
      const edge = length >= 3 && (i === 0 || i === length - 1);
      wet.set(key, heavy && !edge ? 'heavy' : 'light');
    }
  }
  const foggy = new Set<DayPartKey>();
  if (base.fog) {
    foggy.add('morning');
    const roll = noise(seed, 'nebeldauer', day);
    if (roll < 0.55) foggy.add('night');
    if (roll < 0.15) foggy.add('day');
  }
  return DAY_PARTS.map((key) => ({
    key,
    temperature: temperatureAt(base, PART_HOUR[key]),
    precipitation: wet.get(key) ?? 'none',
    // Im Starkregen hält sich kein Nebel.
    fog: foggy.has(key) && wet.get(key) !== 'heavy',
  }));
}

/**
 * Das errechnete Wetter eines Tages. `seed` unterscheidet Kampagnen und Gegenden voneinander;
 * gleiche Angaben ergeben immer dasselbe Wetter.
 */
export function simulateDay(
  climate: Climate,
  cal: CalendarDef,
  seed: number,
  day: number,
): DayWeather {
  const month = climateOn(climate, cal, day);
  const none: DayWeather = {
    day,
    high: 0,
    low: 0,
    precipitation: 'none',
    kind: null,
    wind: 'none',
    fog: false,
    sky: 'clear',
    parts: [],
    manual: false,
    sheltered: false,
    note: '',
  };
  if (!month) return { ...none, parts: partsOf(seed, day, none) };

  // Temperatur: eine Wetterlage hält etwa fünf Tage.
  const swing = (drift(seed, 'temperatur', day, 5) - 0.5) * 2;
  const spread = Math.max(0, month.tempMax - month.tempMin) * 0.45;
  let high = month.tempMax + swing * spread;
  let low = month.tempMin + swing * spread;

  if (isSheltered(climate)) {
    const steady = { high: whole(high), low: whole(low) };
    return {
      ...none,
      ...steady,
      sheltered: true,
      parts: partsOf(seed, day, { ...steady, precipitation: 'none', fog: false }),
    };
  }

  // Feuchte: Regen zieht in Fronten von etwa drei Tagen durch.
  const wet = drift(seed, 'feuchte', day, 3);
  const pRain = month.precipitation / 100;
  const precipitation: Level = wet < pRain * 0.3 ? 'heavy' : wet < pRain ? 'light' : 'none';
  const sky: Sky =
    precipitation !== 'none'
      ? 'overcast'
      : wet < pRain + 0.2
        ? 'cloudy'
        : wet < pRain + 0.45
          ? 'fair'
          : 'clear';

  // Wind: kommt gern mit dem Regen.
  const gust = drift(seed, 'wind', day, 2);
  const pWind = Math.min(
    0.95,
    (month.wind / 100) * (precipitation === 'heavy' ? 1.8 : precipitation === 'light' ? 1.3 : 0.85),
  );
  const wind: WindLevel = gust < pWind * 0.3 ? 'strong' : gust < pWind ? 'light' : 'none';

  // Nebel: nur bei ruhiger Luft und nicht im Starkregen.
  const mist = noise(seed, 'nebel', day);
  const pFog = (month.fog / 100) * (wind === 'none' ? 1.4 : wind === 'light' ? 0.5 : 0);
  const fog = precipitation !== 'heavy' && mist < pFog;

  // Wolken dämpfen den Tag und halten die Nacht warm; klarer Himmel tut das Gegenteil.
  if (precipitation === 'heavy') [high, low] = [high - 3.5, low + 1];
  else if (precipitation === 'light') [high, low] = [high - 2, low + 1];
  else if (sky === 'clear') [high, low] = [high + 1, low - 1.5];
  high = whole(high);
  low = Math.min(high, whole(low));

  const base = { high, low, precipitation, fog };
  return {
    ...none,
    ...base,
    kind: precipitation === 'none' ? null : precipitationKind(high, low),
    wind,
    sky,
    parts: partsOf(seed, day, base),
  };
}

/** Legt ein von Hand festgelegtes Wetter über das errechnete. */
export function withManual(simulated: DayWeather, manual: Weather | undefined): DayWeather {
  if (!manual) return simulated;
  const high = whole(manual.temperature);
  // Die Schwankung über den Tag bleibt, wie sie errechnet war.
  const low = Math.min(high, high - (simulated.high - simulated.low));
  const precipitation: Level = manual.precipitation;
  const wind: WindLevel = manual.wind;
  const base = { high, low, precipitation, fog: manual.fog };
  return {
    ...simulated,
    ...base,
    kind: precipitation === 'none' ? null : precipitationKind(high, low),
    wind,
    sky:
      precipitation !== 'none'
        ? 'overcast'
        : simulated.sky === 'overcast'
          ? 'cloudy'
          : simulated.sky,
    // Festgelegtes gilt den ganzen Tag: der Niederschlag durchgehend, der Nebel bis zum Mittag.
    parts: DAY_PARTS.map((key) => ({
      key,
      temperature: temperatureAt(base, PART_HOUR[key]),
      precipitation,
      fog: manual.fog && (key === 'night' || key === 'morning'),
    })),
    manual: true,
    sheltered: false,
    note: manual.note,
  };
}

// ── Jetzt ──────────────────────────────────────────────────────────────────

export interface WeatherNow {
  temperature: number;
  precipitation: Level;
  kind: PrecipitationKind | null;
  wind: WindLevel;
  fog: boolean;
  sky: Sky;
  part: DayPartKey;
  sheltered: boolean;
}

/** Das Wetter zu einer Uhrzeit des Tages (Minuten seit Mitternacht). */
export function weatherAtMinute(weather: DayWeather, minuteOfDay: number): WeatherNow {
  const hour = minuteOfDay / 60;
  const part = DAY_PARTS[Math.min(3, Math.max(0, Math.floor(hour / 6)))]!;
  const current = weather.parts.find((p) => p.key === part);
  const precipitation = current?.precipitation ?? 'none';
  return {
    temperature: temperatureAt(weather, hour),
    precipitation,
    kind: precipitation === 'none' ? null : weather.kind,
    wind: weather.wind,
    fog: current?.fog ?? false,
    // Zwischen den Schauern bleibt es bedeckt.
    sky: weather.sky,
    part,
    sheltered: weather.sheltered,
  };
}

// ── Worte ──────────────────────────────────────────────────────────────────

const SKY_LABEL: Record<Sky, string> = {
  clear: 'Klar',
  fair: 'Heiter',
  cloudy: 'Bewölkt',
  overcast: 'Bedeckt',
};

const PRECIPITATION_LABEL: Record<PrecipitationKind, Record<Exclude<Level, 'none'>, string>> = {
  rain: { light: 'Leichter Regen', heavy: 'Starker Regen' },
  snow: { light: 'Leichter Schneefall', heavy: 'Starker Schneefall' },
  sleet: { light: 'Schneeregen', heavy: 'Starker Schneeregen' },
};

export const WIND_LABEL: Record<WindLevel, string> = {
  none: 'Windstill',
  light: 'Windig',
  strong: 'Starker Wind',
};

type Described = Pick<WeatherNow, 'precipitation' | 'kind' | 'wind' | 'fog' | 'sky' | 'sheltered'>;

/** Das Wetter in wenigen Worten: „Starker Regen, starker Wind“, „Heiter“, „Nebel“. */
export function describeWeather(weather: Described): string {
  if (weather.sheltered) return 'Kein Wetter';
  const words: string[] = [];
  if (weather.precipitation !== 'none')
    words.push(PRECIPITATION_LABEL[weather.kind ?? 'rain'][weather.precipitation]);
  if (weather.fog) words.push('Nebel');
  if (!words.length) words.push(SKY_LABEL[weather.sky]);
  // Der Wind steht hinten und beginnt dort klein („…, starker Wind“); Hauptwörter bleiben groß.
  if (weather.wind !== 'none') {
    const wind = WIND_LABEL[weather.wind];
    words.push(words.length ? wind.charAt(0).toLowerCase() + wind.slice(1) : wind);
  }
  return words.join(', ');
}

export const temperatureLabel = (celsius: number): string =>
  `${celsius < 0 ? '−' : ''}${Math.abs(Math.round(celsius))} °C`;

/** Grenzen des Regelwerks (D&D 2024): extreme Kälte ab 0 °F, extreme Hitze ab 100 °F. */
export const EXTREME_COLD = -18;
export const EXTREME_HEAT = 38;

export interface WeatherEffect {
  title: string;
  /** Was das Regelwerk dazu sagt, in einem Satz. */
  rule: string;
}

/** Folgen nach dem Regelwerk (D&D 2024) für das Wetter eines Augenblicks. */
export function weatherEffects(
  weather: Pick<
    WeatherNow,
    'temperature' | 'precipitation' | 'kind' | 'wind' | 'fog' | 'sheltered'
  >,
): WeatherEffect[] {
  if (weather.sheltered) return [];
  const effects: WeatherEffect[] = [];
  if (weather.temperature <= EXTREME_COLD)
    effects.push({
      title: 'Extreme Kälte',
      rule: 'Wer ungeschützt draußen ist, legt am Ende jeder Stunde einen Konstitutionsrettungswurf (SG 10) ab oder erhält eine Stufe Erschöpfung. Resistenz oder Immunität gegen Kälte besteht automatisch.',
    });
  if (weather.temperature >= EXTREME_HEAT)
    effects.push({
      title: 'Extreme Hitze',
      rule: 'Wer ohne Trinkwasser draußen ist, legt am Ende jeder Stunde einen Konstitutionsrettungswurf ab (SG 5, je weitere Stunde +1) oder erhält eine Stufe Erschöpfung; in mittlerer oder schwerer Rüstung mit Nachteil.',
    });
  if (weather.wind === 'strong')
    effects.push({
      title: 'Starker Wind',
      rule: 'Nachteil auf Fernkampfangriffe. Offene Flammen erlöschen, Nebel verweht, und wer ohne Magie fliegt, muss am Ende seines Zuges landen oder stürzt ab.',
    });
  if (weather.precipitation === 'heavy')
    effects.push({
      title: weather.kind === 'snow' ? 'Starker Schneefall' : 'Starker Niederschlag',
      rule: 'Alles im Freien ist leicht verschleiert; Würfe auf Weisheit (Wahrnehmung) haben Nachteil. Starker Regen löscht offene Flammen.',
    });
  if (weather.fog)
    effects.push({
      title: 'Nebel',
      rule: 'Dichter Nebel verschleiert stark: Wer hineinsieht, gilt als blind für alles darin.',
    });
  return effects;
}

/** Ein Tag als Ganzes: der stärkste Niederschlag, der Himmel am Tag. */
export function dayGlance(day: DayWeather): Described {
  return {
    precipitation: day.precipitation,
    kind: day.kind,
    wind: day.wind,
    fog: day.fog && day.precipitation === 'none',
    sky: day.sky,
    sheltered: day.sheltered,
  };
}

/** Alle Folgen nach dem Regelwerk, die an einem Tag zu irgendeiner Tageszeit gelten. */
export function dayEffects(day: DayWeather): WeatherEffect[] {
  const seen = new Map<string, WeatherEffect>();
  // Zur Mitte jedes der vier Tagesabschnitte.
  for (let part = 0; part < DAY_PARTS.length; part++)
    for (const effect of weatherEffects(weatherAtMinute(day, part * 360 + 180)))
      if (!seen.has(effect.title)) seen.set(effect.title, effect);
  return [...seen.values()];
}

// ── Vorgaben für Klimazonen ────────────────────────────────────────────────

export const CLIMATE_PRESETS = [
  'temperate',
  'maritime',
  'cold',
  'arctic',
  'warm',
  'desert',
  'tropical',
  'mountain',
  'underground',
] as const;
export type ClimatePreset = (typeof CLIMATE_PRESETS)[number];

interface PresetValues {
  name: string;
  hint: string;
  /** Höchst- und Tiefstwert im wärmsten und im kältesten Monat, °C. */
  summer: [high: number, low: number];
  winter: [high: number, low: number];
  /** Anteil der Tage mit Niederschlag, Wind und Nebel im wärmsten / kältesten Monat, in %. */
  precipitation: [summer: number, winter: number];
  wind: [summer: number, winter: number];
  fog: [summer: number, winter: number];
}

export const PRESET: Record<ClimatePreset, PresetValues> = {
  temperate: {
    name: 'Gemäßigt',
    hint: 'Warme Sommer, kalte Winter, Regen das ganze Jahr.',
    summer: [23, 13],
    winter: [3, -3],
    precipitation: [35, 45],
    wind: [25, 35],
    fog: [4, 14],
  },
  maritime: {
    name: 'Küste',
    hint: 'Mild und feucht, viel Wind, selten Frost.',
    summer: [20, 14],
    winter: [7, 2],
    precipitation: [40, 55],
    wind: [45, 60],
    fog: [8, 12],
  },
  cold: {
    name: 'Kalter Norden',
    hint: 'Kurze, kühle Sommer und lange, strenge Winter.',
    summer: [16, 6],
    winter: [-8, -18],
    precipitation: [35, 35],
    wind: [30, 35],
    fog: [5, 8],
  },
  arctic: {
    name: 'Eisland',
    hint: 'Frost fast das ganze Jahr, eisiger Wind.',
    summer: [5, -3],
    winter: [-22, -34],
    precipitation: [25, 20],
    wind: [40, 50],
    fog: [6, 4],
  },
  warm: {
    name: 'Warmer Süden',
    hint: 'Heiße, trockene Sommer und milde, feuchte Winter.',
    summer: [31, 19],
    winter: [13, 5],
    precipitation: [10, 40],
    wind: [25, 30],
    fog: [1, 6],
  },
  desert: {
    name: 'Wüste',
    hint: 'Glühende Tage, kalte Nächte, kaum Regen.',
    summer: [40, 22],
    winter: [20, 5],
    precipitation: [2, 6],
    wind: [30, 30],
    fog: [0, 1],
  },
  tropical: {
    name: 'Tropen',
    hint: 'Immer heiß und schwül, mit einer Regenzeit.',
    summer: [31, 24],
    winter: [29, 22],
    precipitation: [70, 35],
    wind: [20, 20],
    fog: [6, 6],
  },
  mountain: {
    name: 'Gebirge',
    hint: 'Kühl, windig, das Wetter schlägt schnell um.',
    summer: [14, 4],
    winter: [-4, -13],
    precipitation: [45, 45],
    wind: [50, 55],
    fog: [12, 12],
  },
  underground: {
    name: 'Unter der Erde',
    hint: 'Kein Wetter. Gleichbleibend kühl, sommers wie winters.',
    summer: [12, 10],
    winter: [12, 10],
    precipitation: [0, 0],
    wind: [0, 0],
    fog: [0, 0],
  },
};

/** Kennung, unter der eine Vorgabe als Klimazone im Spielstand liegt. */
export const presetClimateId = (preset: ClimatePreset): string => `klima-${preset}`;

export const presetOfClimateId = (id: string): ClimatePreset | null =>
  CLIMATE_PRESETS.find((preset) => presetClimateId(preset) === id) ?? null;

/**
 * Baut aus einer Vorgabe die Klimazone für einen Kalender: Die Werte schwingen übers Jahr
 * zwischen dem wärmsten Monat und dem gegenüberliegenden.
 */
export function presetClimate(
  preset: ClimatePreset,
  monthCount: number,
  warmestMonth: number,
  stamp = '',
): Climate {
  const values = PRESET[preset];
  const round = (n: number) => Math.round(n * 10) / 10;
  const months = Array.from({ length: Math.max(1, monthCount) }, (_, month) => {
    // 1 im wärmsten Monat, 0 im kältesten.
    const season = 0.5 + 0.5 * Math.cos((2 * Math.PI * (month - warmestMonth)) / monthCount);
    const between = ([summer, winter]: [number, number]) => round(lerp(winter, summer, season));
    return {
      tempMax: between([values.summer[0], values.winter[0]]),
      tempMin: between([values.summer[1], values.winter[1]]),
      precipitation: between(values.precipitation),
      wind: between(values.wind),
      fog: between(values.fog),
    };
  });
  return {
    id: presetClimateId(preset),
    rev: 0,
    created: stamp,
    updated: stamp,
    name: values.name,
    months,
    notes: '',
  };
}

const plain = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Wörter in Namen, Art und Schlagworten eines Ortes, die auf ein Klima schließen lassen. */
const PRESET_WORDS: [ClimatePreset, RegExp][] = [
  ['desert', /wuste|dunen|oase\b|salzpfanne/],
  ['arctic', /eisland|eiswuste|gletscher|tundra|arktis|ewiges eis|polar/],
  ['tropical', /dschungel|tropen|tropisch|regenwald|urwald/],
  ['mountain', /gebirge|hochgebirge|gipfel|bergpass|\bpass\b|hochland/],
  ['maritime', /kuste|hafen|insel|bucht\b|strand|\bkap\b|gestade/],
];
const UNDERGROUND_WORDS =
  /unterreich|underdark|unterwelt|unterirdisch|hohle|grotte|\bmine\b|stollen|gewolbe|katakombe|dungeon|kanalisation|kaverne/;

/**
 * Welche Vorgabe zu einem Ort passt, gelesen aus den Worten des Ortes und der Orte darüber
 * (der nächste zuerst). Liegt irgendwo in der Kette etwas unter der Erde, gilt das – dort gibt
 * es kein Wetter, egal was sonst im Namen steht. `index` nennt den Ort der Kette, dessen Worte
 * den Ausschlag gaben. Ohne Hinweis: null.
 */
export function recognizeClimate(
  chain: readonly { name: string; category: string; tags: readonly string[] }[],
): { preset: ClimatePreset; index: number } | null {
  const texts = chain.map((place) =>
    plain(`${place.name} ${place.category} ${place.tags.join(' ')}`),
  );
  const below = texts.findIndex((text) => UNDERGROUND_WORDS.test(text));
  if (below >= 0) return { preset: 'underground', index: below };
  for (const [index, text] of texts.entries())
    for (const [preset, words] of PRESET_WORDS) if (words.test(text)) return { preset, index };
  return null;
}
