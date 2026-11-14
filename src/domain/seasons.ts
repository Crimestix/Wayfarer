/**
 * Jahreszeiten: so, wie der Spielleiter sie im Kalender festgelegt hat (`calendar.seasons`, je
 * Jahreszeit Name und Monate) – sonst errechnet als vier gleiche Viertel um den wärmsten Monat.
 * Alles, was nach Jahreszeiten fragt (was hier wächst und lebt, das Lexikon, die Einstellungen),
 * liest über `seasonsAt`. Reine Funktionen.
 *
 * Auf der Südhalbkugel ist alles ein halbes Jahr versetzt – die errechneten Viertel wie die
 * festgelegten Monate. Die üblichen Wörter („Herbst“) gelten weiter: Sie meinen die eigene
 * Jahreszeit dieses Namens, sonst die, die die meisten Monate des errechneten Herbstes hat.
 */
import { warmestMonthAt } from './geoClimate';
import { placeGeo } from './planet';
import type { CampaignData } from './schema';
import { fromTime, type CalendarDef, type SeasonDef, type WorldTime } from './time/calendar';
import { warmestMonth } from './weatherZone';

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

export const SEASON_LABEL: Record<Season, string> = {
  spring: 'Frühling',
  summer: 'Sommer',
  autumn: 'Herbst',
  winter: 'Winter',
};

const SEASON_WORDS: Record<Season, string[]> = {
  spring: ['fruhling', 'fruhjahr', 'lenz'],
  summer: ['sommer', 'hochsommer', 'fruhsommer', 'spatsommer'],
  autumn: ['herbst', 'spatherbst', 'fruhherbst'],
  winter: ['winter', 'hochwinter', 'spatwinter'],
};

/** Ein Wort zum Vergleichen: Kleinbuchstaben ohne Akzente und Zeichen. */
export function compactWord(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Die errechnete Jahreszeit eines Monats: Der wärmste Monat ist die Mitte des Sommers; jede
 * Jahreszeit dauert ein Viertel des Jahres. Bei zwölf Monaten: der wärmste mit seinen Nachbarn.
 */
export function seasonOfMonth(month: number, monthCount: number, warmest: number): Season {
  const offset = (((month - warmest) % monthCount) + monthCount) % monthCount;
  const shifted = (offset + monthCount / 12) % monthCount;
  const quarter = Math.min(3, Math.floor(shifted / (monthCount / 4)));
  return (['summer', 'autumn', 'winter', 'spring'] as const)[quarter] ?? 'summer';
}

// ── Das Jahr ───────────────────────────────────────────────────────────────

export interface YearSeason {
  /** `spring` … `winter` bei errechneten, `own-<Stelle>` bei festgelegten Jahreszeiten. */
  key: string;
  name: string;
  /** Ihre Monate (0-basiert), aufsteigend. */
  months: number[];
}

export interface SeasonYear {
  /** Die Jahreszeiten in ihrer Reihenfolge – festgelegt oder errechnet. */
  seasons: YearSeason[];
  /** Vom Spielleiter festgelegt? */
  own: boolean;
  monthCount: number;
  /** Was die üblichen Wörter („Herbst“) meinen. */
  usual: Record<Season, YearSeason>;
}

/** Die vier errechneten Jahreszeiten, Frühling zuerst. */
export function computedSeasons(monthCount: number, warmest: number): YearSeason[] {
  return SEASONS.map((season) => ({
    key: season,
    name: SEASON_LABEL[season],
    months: Array.from({ length: monthCount }, (_, m) => m).filter(
      (m) => seasonOfMonth(m, monthCount, warmest) === season,
    ),
  }));
}

/** Die festgelegten Jahreszeiten, soweit brauchbar: mit Namen, Monate im Kalender, keiner doppelt. */
export function cleanSeasons(defs: readonly SeasonDef[], monthCount: number): SeasonDef[] {
  const taken = new Set<number>();
  return defs.map((def) => {
    const months = [...new Set(def.months)].filter(
      (m) => Number.isInteger(m) && m >= 0 && m < monthCount && !taken.has(m),
    );
    for (const m of months) taken.add(m);
    return { name: def.name, months: months.sort((a, b) => a - b) };
  });
}

/**
 * Das Jahr nach seinen Jahreszeiten. `warmest` ist der wärmste Monat an dieser Stelle (im Süden
 * schon versetzt); `south` versetzt auch die festgelegten Monate um ein halbes Jahr.
 */
export function seasonYear(cal: CalendarDef, warmest: number, south = false): SeasonYear {
  const monthCount = cal.months.length;
  const computed = computedSeasons(monthCount, warmest);
  const shift = south ? Math.round(monthCount / 2) : 0;
  const own = cleanSeasons(cal.seasons ?? [], monthCount)
    .map((def, index) => ({ def, index }))
    .filter(({ def }) => def.name.trim() !== '')
    .map(({ def, index }) => ({
      key: `own-${index}`,
      name: def.name.trim(),
      months: def.months.map((m) => (m + shift) % monthCount).sort((a, b) => a - b),
    }));
  if (!own.length) {
    const usual = Object.fromEntries(computed.map((s) => [s.key, s])) as Record<Season, YearSeason>;
    return { seasons: computed, own: false, monthCount, usual };
  }
  const usual = {} as Record<Season, YearSeason>;
  SEASONS.forEach((season, i) => {
    const named = own.find((s) => SEASON_WORDS[season].includes(compactWord(s.name)));
    const months = new Set(computed[i]!.months);
    let best: YearSeason | null = null;
    let most = 0;
    for (const candidate of own) {
      const overlap = candidate.months.filter((m) => months.has(m)).length;
      if (overlap > most) [best, most] = [candidate, overlap];
    }
    usual[season] = named ?? best ?? computed[i]!;
  });
  return { seasons: own, own: true, monthCount, usual };
}

/**
 * Die Jahreszeiten an einem Ort (ohne Ort: die des Kalenders, Nordhalbkugel). Die eine Stelle,
 * über die alles liest, was nach Jahreszeiten fragt.
 */
export function seasonsAt(data: CampaignData, placeId: string | null = null): SeasonYear {
  const cal = data.campaign.calendar;
  const lat = placeId ? (placeGeo(data, placeId)?.geo.lat ?? 0) : 0;
  return seasonYear(cal, warmestMonthAt(warmestMonth(data), cal.months.length, lat), lat < 0);
}

/** Die Jahreszeit eines Monats – null, wenn der Spielleiter ihn keiner zugeordnet hat. */
export const seasonOfMonthIn = (year: SeasonYear, month: number): YearSeason | null =>
  year.seasons.find((season) => season.months.includes(month)) ?? null;

/** Monat und Jahreszeit jetzt an einem Ort. */
export function seasonNow(
  data: CampaignData,
  placeId: string | null,
  now: WorldTime = data.state.now,
): { month: number; season: YearSeason | null } {
  const month = fromTime(data.campaign.calendar, now).month;
  return { month, season: seasonOfMonthIn(seasonsAt(data, placeId), month) };
}

/** Ein Wort als Jahreszeit: ein eigener Name oder eines der üblichen Wörter. */
export function seasonOfWord(year: SeasonYear, word: string): YearSeason | null {
  const key = compactWord(word);
  if (!key) return null;
  const own = year.seasons.find((season) => compactWord(season.name) === key);
  if (own) return own;
  for (const season of SEASONS) if (SEASON_WORDS[season].includes(key)) return year.usual[season];
  return null;
}

// ── Lesen ──────────────────────────────────────────────────────────────────

const ALWAYS = new Set(['immer', 'ganzjahrig', 'ganzesjahr', 'dasganzejahr', 'jederzeit']);

/** Ein Wort als Monat des Kalenders (Index) oder null. */
function monthOf(cal: CalendarDef, word: string): number | null {
  const key = compactWord(word);
  if (!key) return null;
  const index = cal.months.findIndex((month) => compactWord(month.name) === key);
  return index >= 0 ? index : null;
}

/** Die Monate von `from` bis `to`, auch über den Jahreswechsel. */
function monthRange(from: number, to: number, count: number): number[] {
  const out: number[] = [];
  for (let m = from; ; m = (m + 1) % count) {
    out.push(m);
    if (m === to || out.length >= count) break;
  }
  return out;
}

export interface SeasonReading {
  /** Die Monate (Index), in denen es vorkommt; null = immer. */
  months: Set<number> | null;
  /** Wörter, die Wayfarer nicht lesen konnte. */
  unread: string[];
}

/**
 * Liest die Angaben „wann“: Jahreszeiten („Herbst“, auch eigene Namen), Monate des Kalenders
 * („Blüthain“) und Spannen („Blüthain bis Erntfall“, „Frühling–Herbst“). Nichts Lesbares
 * heißt „immer“.
 */
export function readSeasons(
  cal: CalendarDef,
  year: SeasonYear,
  entries: readonly string[],
): SeasonReading {
  const months = new Set<number>();
  const unread: string[] = [];
  const count = cal.months.length;
  let always = false;
  const addAll = (list: readonly number[]) => list.forEach((m) => months.add(m));
  for (const entry of entries) {
    const text = entry.trim();
    if (!text) continue;
    if (ALWAYS.has(compactWord(text))) {
      always = true;
      continue;
    }
    const range = text.split(/\s*(?:–|—|-|\bbis\b)\s*/i).filter(Boolean);
    if (range.length === 2) {
      const [from, to] = [monthOf(cal, range[0]!), monthOf(cal, range[1]!)];
      if (from !== null && to !== null) {
        addAll(monthRange(from, to, count));
        continue;
      }
      const [a, b] = [seasonOfWord(year, range[0]!), seasonOfWord(year, range[1]!)];
      const order = year.seasons;
      const [i, j] = [a ? order.indexOf(a) : -1, b ? order.indexOf(b) : -1];
      if (a && b && i >= 0 && j >= 0) {
        for (let k = i; ; k = (k + 1) % order.length) {
          addAll(order[k]!.months);
          if (k === j) break;
        }
        continue;
      }
      if (a && b) {
        addAll(a.months);
        addAll(b.months);
        continue;
      }
    }
    const month = monthOf(cal, text);
    if (month !== null) {
      months.add(month);
      continue;
    }
    const season = seasonOfWord(year, text);
    if (season) {
      addAll(season.months);
      continue;
    }
    unread.push(text);
  }
  return { months: always || months.size === 0 ? null : months, unread };
}

/** Monat oder Jahreszeit als Auswahl für eine Sicht: „s:winter“, „s:own-1“ oder „m:3“. */
export function monthsOfChoice(
  cal: CalendarDef,
  year: SeasonYear,
  choice: string,
): Set<number> | null {
  if (choice.startsWith('s:')) {
    const season = year.seasons.find((s) => s.key === choice.slice(2));
    return season ? new Set(season.months) : null;
  }
  if (choice.startsWith('m:')) {
    const month = Number(choice.slice(2));
    return Number.isInteger(month) && month >= 0 && month < cal.months.length
      ? new Set([month])
      : null;
  }
  return null;
}

// ── Festlegen ──────────────────────────────────────────────────────────────

/** Die errechneten Jahreszeiten als Ausgangspunkt zum Festlegen (Nordhalbkugel). */
export const seasonsFromComputed = (monthCount: number, warmest: number): SeasonDef[] =>
  computedSeasons(monthCount, warmest).map(({ name, months }) => ({ name, months }));

/** Ordnet einen Monat einer Jahreszeit zu (Stelle in der Liste) – oder keiner (null). */
export function assignMonth(
  seasons: readonly SeasonDef[],
  month: number,
  index: number | null,
): SeasonDef[] {
  return seasons.map((season, i) => {
    const rest = season.months.filter((m) => m !== month);
    return { ...season, months: i === index ? [...rest, month].sort((a, b) => a - b) : rest };
  });
}

/** Benennt eine Jahreszeit um – der Name, wie der Spielleiter ihn schreibt. */
export const renameSeason = (
  seasons: readonly SeasonDef[],
  index: number,
  name: string,
): SeasonDef[] => seasons.map((season, i) => (i === index ? { ...season, name } : season));

/** Eine weitere Jahreszeit, noch ohne Monate. */
export const addSeason = (seasons: readonly SeasonDef[], name: string): SeasonDef[] => [
  ...seasons,
  { name, months: [] },
];

/** Nimmt eine Jahreszeit heraus; ihre Monate gehören dann zu keiner. */
export const removeSeason = (seasons: readonly SeasonDef[], index: number): SeasonDef[] =>
  seasons.filter((_, i) => i !== index);
