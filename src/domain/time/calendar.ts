/**
 * Kalender-Engine. Der Kalender einer Welt ist reine Daten (CalendarDef); hier steht nur die Rechnung.
 *
 * Weltzeit (WorldTime) = ganze Minuten seit Beginn des absoluten Jahres 1, Tag 1, 00:00.
 * Ein Tag hat immer 24 Stunden zu 60 Minuten.
 */

export type WorldTime = number;

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 1440;

export interface MonthDef {
  name: string;
  days: number;
  /** Zusätzliche Tage in Schaltjahren. */
  leapDays?: number;
}

export interface EraDef {
  id: string;
  /** Kürzel hinter der Jahreszahl, z. B. „AD“. */
  label: string;
  /** Angezeigtes Jahr = absolutes Jahr − offset. */
  offset: number;
}

export interface MoonDef {
  id: string;
  name: string;
  /** Umlaufzeit in Minuten. */
  period: number;
  /** Ein Zeitpunkt, an dem Neumond war. */
  anchor: WorldTime;
  color: string;
}

export interface CalendarDef {
  id: string;
  name: string;
  months: MonthDef[];
  weekdays: string[];
  /** „gregorian“: Schaltjahr, wenn das absolute Jahr durch 4, aber nicht 100 (außer 400) teilbar ist. */
  leapRule: 'none' | 'gregorian';
  /** Ein bekannter Tag (Tagesindex seit Epoche) und sein Wochentag. */
  weekdayAnchor: { day: number; weekday: number };
  /** Zeitrechnungen; die erste ist die Hauptanzeige. */
  eras: EraDef[];
  moons: MoonDef[];
}

/** Datum in absoluten Jahren. Monat 0-basiert, Tag 1-basiert. */
export interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export interface DateInfo extends DateParts {
  weekday: number;
  /** Tagesindex seit Epoche. */
  dayIndex: number;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

export function isLeapYear(cal: CalendarDef, year: number): boolean {
  if (cal.leapRule === 'none') return false;
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function monthLength(cal: CalendarDef, year: number, month: number): number {
  const def = cal.months[month];
  if (!def) throw new Error(`Monat ${month} gibt es in diesem Kalender nicht.`);
  return def.days + (isLeapYear(cal, year) ? (def.leapDays ?? 0) : 0);
}

const commonYearLength = (cal: CalendarDef) => cal.months.reduce((n, m) => n + m.days, 0);
const leapExtra = (cal: CalendarDef) => cal.months.reduce((n, m) => n + (m.leapDays ?? 0), 0);

export function yearLength(cal: CalendarDef, year: number): number {
  return commonYearLength(cal) + (isLeapYear(cal, year) ? leapExtra(cal) : 0);
}

/** Tage vor dem 1. Tag des absoluten Jahres. */
export function daysBeforeYear(cal: CalendarDef, year: number): number {
  const y = year - 1;
  const leaps =
    cal.leapRule === 'gregorian' ? Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) : 0;
  return commonYearLength(cal) * y + leapExtra(cal) * leaps;
}

export function isValidDate(cal: CalendarDef, p: DateParts): boolean {
  return (
    [p.year, p.month, p.day, p.hour, p.minute].every(Number.isInteger) &&
    p.year >= 1 &&
    p.month >= 0 &&
    p.month < cal.months.length &&
    p.day >= 1 &&
    p.day <= monthLength(cal, p.year, p.month) &&
    p.hour >= 0 &&
    p.hour < 24 &&
    p.minute >= 0 &&
    p.minute < 60
  );
}

export function toTime(cal: CalendarDef, p: DateParts): WorldTime {
  if (!isValidDate(cal, p)) throw new Error('Ungültiges Datum.');
  let days = daysBeforeYear(cal, p.year);
  for (let m = 0; m < p.month; m++) days += monthLength(cal, p.year, m);
  return (days + p.day - 1) * MINUTES_PER_DAY + p.hour * MINUTES_PER_HOUR + p.minute;
}

export function fromTime(cal: CalendarDef, time: WorldTime): DateInfo {
  if (!Number.isSafeInteger(time) || time < 0) throw new Error('Zeitpunkt außerhalb des Kalenders.');
  const dayIndex = Math.floor(time / MINUTES_PER_DAY);
  const average = commonYearLength(cal) + (cal.leapRule === 'gregorian' ? leapExtra(cal) * 0.2425 : 0);
  let year = Math.max(1, Math.floor(dayIndex / average) + 1);
  while (daysBeforeYear(cal, year) > dayIndex) year--;
  while (daysBeforeYear(cal, year + 1) <= dayIndex) year++;
  let rest = dayIndex - daysBeforeYear(cal, year);
  let month = 0;
  while (rest >= monthLength(cal, year, month)) {
    rest -= monthLength(cal, year, month);
    month++;
  }
  const minuteOfDay = time - dayIndex * MINUTES_PER_DAY;
  return {
    year,
    month,
    day: rest + 1,
    hour: Math.floor(minuteOfDay / MINUTES_PER_HOUR),
    minute: minuteOfDay % MINUTES_PER_HOUR,
    weekday: weekdayOfDay(cal, dayIndex),
    dayIndex,
  };
}

export function weekdayOfDay(cal: CalendarDef, dayIndex: number): number {
  return mod(dayIndex - cal.weekdayAnchor.day + cal.weekdayAnchor.weekday, cal.weekdays.length);
}

export const dayIndexOf = (time: WorldTime) => Math.floor(time / MINUTES_PER_DAY);
export const startOfDay = (time: WorldTime) => dayIndexOf(time) * MINUTES_PER_DAY;
export const minuteOfDay = (time: WorldTime) => time - startOfDay(time);

/** Nächster Zeitpunkt nach `time` mit der Uhrzeit hour:minute. */
export function nextTimeOfDay(time: WorldTime, hour: number, minute = 0): WorldTime {
  const target = startOfDay(time) + hour * MINUTES_PER_HOUR + minute;
  return target > time ? target : target + MINUTES_PER_DAY;
}

/** Erster Tag des Monats, der `offset` Monate vom Monat von `time` entfernt liegt. */
export function shiftMonth(cal: CalendarDef, year: number, month: number, offset: number) {
  const total = (year - 1) * cal.months.length + month + offset;
  return { year: Math.floor(total / cal.months.length) + 1, month: mod(total, cal.months.length) };
}

// ── Anzeige ────────────────────────────────────────────────────────────────

export function primaryEra(cal: CalendarDef): EraDef {
  return cal.eras[0] ?? { id: 'abs', label: '', offset: 0 };
}

export function displayYear(cal: CalendarDef, year: number, era: EraDef = primaryEra(cal)): number {
  return year - era.offset;
}

/** Wandelt ein Jahr der Hauptzeitrechnung in ein absolutes Jahr um. */
export function absoluteYear(cal: CalendarDef, shown: number, era: EraDef = primaryEra(cal)): number {
  return shown + era.offset;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatClock(time: WorldTime): string {
  const m = minuteOfDay(time);
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function formatYear(cal: CalendarDef, year: number, era: EraDef = primaryEra(cal)): string {
  return `${displayYear(cal, year, era)}${era.label ? ' ' + era.label : ''}`;
}

/** „17. Tauwind 701 AD“ */
export function formatDate(cal: CalendarDef, time: WorldTime, era?: EraDef): string {
  const d = fromTime(cal, time);
  return `${d.day}. ${cal.months[d.month]!.name} ${formatYear(cal, d.year, era)}`;
}

/** „17. Tauwind“ – ohne Jahr. */
export function formatDayMonth(cal: CalendarDef, time: WorldTime): string {
  const d = fromTime(cal, time);
  return `${d.day}. ${cal.months[d.month]!.name}`;
}

export function formatDateTime(cal: CalendarDef, time: WorldTime): string {
  return `${formatDate(cal, time)}, ${formatClock(time)}`;
}

export function weekdayName(cal: CalendarDef, time: WorldTime): string {
  return cal.weekdays[fromTime(cal, time).weekday] ?? '';
}

/** „3 Tage 4 Std.“ – Dauer in Worten, für Abstände zwischen zwei Zeitpunkten. */
export function formatDuration(minutes: number): string {
  const total = Math.abs(Math.round(minutes));
  const d = Math.floor(total / MINUTES_PER_DAY);
  const h = Math.floor((total % MINUTES_PER_DAY) / 60);
  const m = total % 60;
  const parts: string[] = [];
  if (d) parts.push(d === 1 ? '1 Tag' : `${d} Tage`);
  if (h && d < 14) parts.push(`${h} Std.`);
  if (m && !d) parts.push(`${m} Min.`);
  return parts.length ? parts.join(' ') : '0 Min.';
}

/** „vor 3 Tagen“, „in 2 Std.“, „jetzt“. */
export function formatRelative(now: WorldTime, time: WorldTime): string {
  const diff = time - now;
  if (diff === 0) return 'jetzt';
  const days = dayIndexOf(time) - dayIndexOf(now);
  if (days === 0) return diff > 0 ? `in ${formatDuration(diff)}` : `vor ${formatDuration(diff)}`;
  if (days === 1) return 'morgen';
  if (days === -1) return 'gestern';
  return days > 0 ? `in ${days} Tagen` : `vor ${-days} Tagen`;
}

// ── Monde ──────────────────────────────────────────────────────────────────

export const MOON_PHASES = [
  'Neumond',
  'Zunehmende Sichel',
  'Erstes Viertel',
  'Zunehmender Mond',
  'Vollmond',
  'Abnehmender Mond',
  'Letztes Viertel',
  'Abnehmende Sichel',
] as const;

export interface MoonPhase {
  /** 0 = Neumond, 0,5 = Vollmond. */
  fraction: number;
  index: number;
  label: (typeof MOON_PHASES)[number];
  /** Beleuchteter Anteil 0–100. */
  light: number;
  nextFull: WorldTime;
  nextNew: WorldTime;
}

export function moonPhase(moon: MoonDef, time: WorldTime): MoonPhase {
  const fraction = mod(time - moon.anchor, moon.period) / moon.period;
  const index = Math.floor(fraction * 8 + 0.5) % 8;
  const until = (target: number) => Math.round((mod(target - fraction, 1) || 1) * moon.period);
  return {
    fraction,
    index,
    label: MOON_PHASES[index]!,
    light: Math.round(((1 - Math.cos(2 * Math.PI * fraction)) / 2) * 100),
    nextFull: time + until(0.5),
    nextNew: time + until(0),
  };
}
