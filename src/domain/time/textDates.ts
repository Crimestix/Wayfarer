/**
 * Daten des Kalenders im Fließtext erkennen: „17. Tauwind 701 AD“, „17. Tauwind“, „Tauwind 701“,
 * „701 AD“, „1. Tauwind, Jahr 701“, „Jahr 701“. Feste Muster aus den Monatsnamen und Zeitrechnungen des Kalenders – der Kalender ist
 * Daten, also sind es auch die Muster. Ohne Jahr gilt das laufende Jahr der Kampagne.
 */
import {
  absoluteYear,
  dayIndexOf,
  formatDate,
  formatRelative,
  formatYear,
  fromTime,
  isValidDate,
  primaryEra,
  toTime,
  weekdayName,
  type CalendarDef,
  type WorldTime,
} from './calendar';

export interface TextDate {
  from: number;
  to: number;
  /** Beginn des Tages, Monats oder Jahres. */
  time: WorldTime;
  precision: 'day' | 'month' | 'year';
  /** Im Text steht kein Jahr; angenommen ist das laufende. */
  assumedYear: boolean;
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternatives = (values: string[]) =>
  values
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|');

const patternCache = new WeakMap<CalendarDef, RegExp | null>();

function patternOf(cal: CalendarDef): RegExp | null {
  const cached = patternCache.get(cal);
  if (cached !== undefined) return cached;
  const months = alternatives(cal.months.map((month) => month.name));
  const eras = alternatives(cal.eras.map((era) => era.label));
  let pattern: RegExp | null = null;
  if (months) {
    const era = eras ? `(?:\\s?(?<ERA>${eras}))?` : '';
    const year = `(?<YEAR>\\d{1,6})${era}`;
    // „17. Tauwind 701“, auch „17. Tauwind, Jahr 701“ und „Tauwind im Jahr 701“.
    const before = `(?:,?\\s+(?:im\\s+)?Jahre?\\s+|\\s+)`;
    const parts = [
      // 17. Tauwind [701 [AD]]
      `(?<day>\\d{1,2})\\.\\s?(?<month>${months})(?:${before}${year.replace('YEAR', 'y1').replace('ERA', 'e1')})?`,
      // Tauwind 701 [AD]
      `(?<month2>${months})${before}${year.replace('YEAR', 'y2').replace('ERA', 'e2')}`,
      // 701 AD
      ...(eras ? [`(?<y3>\\d{1,6})\\s?(?<e3>${eras})`] : []),
      // Jahr 701 [AD]
      `Jahre?\\s+${year.replace('YEAR', 'y4').replace('ERA', 'e4')}(?!\\.\\d)`,
    ];
    pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  }
  patternCache.set(cal, pattern);
  return pattern;
}

/** Alle Daten in einem Text, von links nach rechts. Ungültige Daten (31. eines kurzen Monats) nicht. */
export function findDates(cal: CalendarDef, text: string, now: WorldTime): TextDate[] {
  const pattern = patternOf(cal);
  if (!pattern || !/\d/.test(text)) return [];
  const out: TextDate[] = [];
  const thisYear = fromTime(cal, now).year;
  const yearOf = (shown: string | undefined, label: string | undefined): number | null => {
    if (shown === undefined) return null;
    const era = cal.eras.find((entry) => entry.label === label) ?? primaryEra(cal);
    const year = absoluteYear(cal, Number(shown), era);
    return Number.isSafeInteger(year) && year >= 1 ? year : null;
  };
  const monthOf = (name: string) => cal.months.findIndex((month) => month.name === name);
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const g = match.groups ?? {};
    const from = match.index;
    const to = from + match[0].length;
    let parts: { year: number; month: number; day: number } | null = null;
    let precision: TextDate['precision'] = 'day';
    let assumedYear = false;
    if (g.day !== undefined && g.month !== undefined) {
      const year = yearOf(g.y1, g.e1);
      if (g.y1 !== undefined && year === null) continue;
      assumedYear = year === null;
      parts = { year: year ?? thisYear, month: monthOf(g.month), day: Number(g.day) };
    } else if (g.month2 !== undefined) {
      const year = yearOf(g.y2, g.e2);
      if (year === null) continue;
      parts = { year, month: monthOf(g.month2), day: 1 };
      precision = 'month';
    } else if (g.y3 !== undefined || g.y4 !== undefined) {
      const year = g.y3 !== undefined ? yearOf(g.y3, g.e3) : yearOf(g.y4, g.e4);
      if (year === null) continue;
      parts = { year, month: 0, day: 1 };
      precision = 'year';
    }
    if (!parts) continue;
    const date = { ...parts, hour: 0, minute: 0 };
    if (!isValidDate(cal, date)) continue;
    out.push({ from, to, time: toTime(cal, date), precision, assumedYear });
  }
  return out;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Abstand in Monaten als Worte; ab zwei Jahren in Jahren („vor rund 50 Jahren“). */
function monthsApart(cal: CalendarDef, months: number): string {
  const count = Math.abs(months);
  const perYear = cal.months.length;
  const amount =
    count >= 2 * perYear
      ? `rund ${plural(Math.round(count / perYear), 'Jahr', 'Jahren')}`
      : plural(count, 'Monat', 'Monaten');
  return months > 0 ? `in ${amount}` : `vor ${amount}`;
}

/** Ab so vielen Tagen Abstand liest sich „vor 9 Monaten“ besser als „vor 274 Tagen“. */
const DAYS_AS_MONTHS = 90;

/** Was Wayfarer über ein Datum im Text weiß: Wochentag und Abstand zu heute. */
export function describeDate(cal: CalendarDef, now: WorldTime, date: TextDate): string {
  const then = fromTime(cal, date.time);
  const today = fromTime(cal, now);
  if (date.precision === 'year') {
    const years = then.year - today.year;
    const distance =
      years === 0
        ? 'dieses Jahr'
        : years > 0
          ? `in ${plural(years, 'Jahr', 'Jahren')}`
          : `vor ${plural(-years, 'Jahr', 'Jahren')}`;
    return `Jahr ${formatYear(cal, then.year)} – ${distance}`;
  }
  if (date.precision === 'month') {
    const months = (then.year - today.year) * cal.months.length + (then.month - today.month);
    const distance = months === 0 ? 'dieser Monat' : monthsApart(cal, months);
    return `${cal.months[then.month]!.name} ${formatYear(cal, then.year)} – ${distance}`;
  }
  const days = dayIndexOf(date.time) - dayIndexOf(now);
  const months = (then.year - today.year) * cal.months.length + (then.month - today.month);
  const distance =
    days === 0
      ? 'heute'
      : Math.abs(days) > DAYS_AS_MONTHS
        ? monthsApart(cal, months)
        : formatRelative(now, date.time);
  const weekday = weekdayName(cal, date.time);
  return [
    `${weekday ? `${weekday}, ` : ''}${formatDate(cal, date.time)} – ${distance}`,
    date.assumedYear ? ' (ohne Jahr geschrieben: als dieses Jahr gelesen)' : '',
  ].join('');
}
