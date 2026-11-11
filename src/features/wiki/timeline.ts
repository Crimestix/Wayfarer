/**
 * Zeitleisten aus dem LegendKeeper-Export → Termine im Kalender. LegendKeeper zählt die Zeit je
 * Kalender in Minuten seit dessen Beginn; hier wird daraus ein Datum in jenem Kalender und dann
 * derselbe Tag in Wayfarers Kalender. Welches Jahr gemeint ist, sagt die Zeitrechnung: Trägt ein
 * Kalender des Exports eine, die Wayfarers Kalender auch kennt („AD“, „JF“), ist die Zuordnung
 * eindeutig; sonst bleibt die Zeitleiste draußen und wird genannt. Reine Funktionen.
 */
import { normalize as fold } from '../../domain/derive';
import {
  MINUTES_PER_DAY,
  formatDate,
  monthLength,
  toTime,
  type CalendarDef,
} from '../../domain/time/calendar';

/** Ein Kalender, wie er im Export steht – nur, was zum Umrechnen gebraucht wird. */
export interface LkCalendar {
  id: string;
  name: string;
  /** Es gibt ein Jahr 0; sonst beginnt die Zählung mit dem Jahr 1. */
  hasZeroYear: boolean;
  hoursInDay: number;
  minutesInHour: number;
  months: { name: string; length: number }[];
  /** Schalttage: in welchem Monat (0-basiert) und nach welcher Regel, z. B. „400,!100,4“. */
  leapDays: { month: number; interval: string }[];
  /** Zeitrechnungen: Kürzel und ob die Jahreszählung mit ihr neu beginnt. */
  eras: { abbr: string; startsAt: number; resets: boolean }[];
}

/** Ein Ereignis einer Zeitleiste, wie es im Export steht. */
export interface LkTimelineEvent {
  id: string;
  name: string;
  calendarId: string;
  /** Minuten seit Beginn des Kalenders. */
  start: number;
  end: number | null;
  /** Genauigkeit: 1 = Jahr, 2 = Monat, 3 = Tag, 4 = Uhrzeit. */
  detail: number;
  /** Artikel, zu dem die Zeitleiste gehört, und Artikel, auf den das Ereignis verweist. */
  articleId: string;
  linkedArticleId: string | null;
}

/** Trifft die Schaltregel („400,!100,4“) auf ein Jahr zu? Die erste passende Zahl entscheidet. */
export function lkLeap(interval: string, year: number): boolean {
  for (const token of interval.split(',')) {
    const not = token.trim().startsWith('!');
    const every = Number(token.trim().replace('!', ''));
    if (!Number.isFinite(every) || every <= 0) continue;
    if (((year % every) + every) % every === 0) return !not;
  }
  return false;
}

const lkMonthLength = (cal: LkCalendar, year: number, month: number): number =>
  cal.months[month]!.length +
  cal.leapDays.filter((leap) => leap.month === month && lkLeap(leap.interval, year)).length;

const lkYearLength = (cal: LkCalendar, year: number): number =>
  cal.months.reduce((sum, _, month) => sum + lkMonthLength(cal, year, month), 0);

export interface LkDate {
  year: number;
  /** 0-basiert. */
  month: number;
  /** 1-basiert. */
  day: number;
  hour: number;
  minute: number;
}

/** Das Datum zu einer Minutenzahl in einem Kalender des Exports. */
export function lkDate(cal: LkCalendar, minutes: number): LkDate {
  const perDay = cal.hoursInDay * cal.minutesInHour;
  let days = Math.floor(minutes / perDay);
  const rest = minutes - days * perDay;
  let year = cal.hasZeroYear ? 0 : 1;
  // Ohne Jahr 0 folgt auf das Jahr −1 das Jahr 1.
  const before = (y: number) => (y - 1 === 0 && !cal.hasZeroYear ? -1 : y - 1);
  const after = (y: number) => (y + 1 === 0 && !cal.hasZeroYear ? 1 : y + 1);
  while (days < 0) {
    year = before(year);
    days += lkYearLength(cal, year);
  }
  for (let length = lkYearLength(cal, year); days >= length; length = lkYearLength(cal, year)) {
    days -= length;
    year = after(year);
  }
  let month = 0;
  for (let length = lkMonthLength(cal, year, 0); days >= length;) {
    days -= length;
    month++;
    length = lkMonthLength(cal, year, month);
  }
  return {
    year,
    month,
    day: days + 1,
    hour: Math.floor(rest / cal.minutesInHour),
    minute: Math.floor(rest % cal.minutesInHour),
  };
}

/**
 * Wie die Jahre eines Kalenders des Exports zu Wayfarers absoluten Jahren stehen: Trägt er eine
 * Zeitrechnung, die Wayfarers Kalender unter demselben Kürzel kennt, und läuft seine Zählung
 * vom Beginn an durch, dann ist das absolute Jahr sein Jahr plus der Versatz jener Zeitrechnung.
 * Sonst null.
 */
export function yearOffset(lk: LkCalendar, cal: CalendarDef): number | null {
  if (lk.eras.some((era) => era.resets)) return null;
  for (const era of lk.eras) {
    const known = cal.eras.find((own) => fold(own.label) === fold(era.abbr));
    if (known) return known.offset;
  }
  return null;
}

/** Die Monate eines Kalenders des Exports in Wayfarers Kalender: nach Namen, sonst null. */
export function monthMap(lk: LkCalendar, cal: CalendarDef): number[] | null {
  const out: number[] = [];
  for (const month of lk.months) {
    const index = cal.months.findIndex((own) => fold(own.name) === fold(month.name));
    if (index < 0) return null;
    out.push(index);
  }
  return out;
}

export interface PlannedEvent {
  /** Kennung des Termins: bleibt bei jeder Übernahme dieselbe. */
  id: string;
  title: string;
  at: number;
  timed: boolean;
  durationDays: number | null;
  details: string;
  articleId: string;
  linkedArticleId: string | null;
}

export interface TimelinePlan {
  events: PlannedEvent[];
  /** Kalender des Exports, deren Zeitrechnung Wayfarer nicht zuordnen kann, mit Zahl der Ereignisse. */
  unknown: { calendar: string; events: number }[];
  /** Ereignisse vor dem Beginn von Wayfarers Kalender. */
  tooEarly: number;
}

/** Länger laufende Ereignisse stehen nicht als Dauer im Kalender, sondern als Satz im Termin. */
const MAX_DURATION_DAYS = 366;

/**
 * Rechnet die Ereignisse der Zeitleisten in Wayfarers Kalender um. `titleOf` nennt den Titel
 * eines Artikels (für den Vermerk im Termin).
 */
export function planTimeline(
  cal: CalendarDef,
  calendars: readonly LkCalendar[],
  events: readonly LkTimelineEvent[],
  titleOf: (articleId: string) => string | undefined,
): TimelinePlan {
  const byId = new Map(calendars.map((entry) => [entry.id, entry]));
  const unknown = new Map<string, number>();
  const out: PlannedEvent[] = [];
  let tooEarly = 0;
  const convert = (lk: LkCalendar, offset: number, months: number[], minutes: number) => {
    const date = lkDate(lk, minutes);
    const year = date.year + offset;
    if (year < 1) return null;
    const month = months[date.month]!;
    return toTime(cal, {
      year,
      month,
      // Ein Schalttag, den Wayfarers Kalender in diesem Jahr nicht hat, rückt auf den Monatsletzten.
      day: Math.min(date.day, monthLength(cal, year, month)),
      hour: Math.min(23, date.hour),
      minute: Math.min(59, date.minute),
    });
  };
  for (const event of events) {
    const lk = byId.get(event.calendarId);
    const offset = lk ? yearOffset(lk, cal) : null;
    const months = lk ? monthMap(lk, cal) : null;
    if (!lk || offset === null || !months) {
      const name = lk?.name || 'ohne Namen';
      unknown.set(name, (unknown.get(name) ?? 0) + 1);
      continue;
    }
    const at = convert(lk, offset, months, event.start);
    if (at === null) {
      tooEarly++;
      continue;
    }
    const end =
      event.end !== null && event.end > event.start ? convert(lk, offset, months, event.end) : null;
    const days = end !== null ? Math.ceil((end - at) / MINUTES_PER_DAY) : 0;
    const notes: string[] = [];
    const source = titleOf(event.articleId);
    notes.push(source ? `Aus der Zeitleiste von „${source}“.` : 'Aus einer Zeitleiste.');
    if (end !== null && days > MAX_DURATION_DAYS)
      notes.push(`Dauert bis zum ${formatDate(cal, end)}.`);
    const linked = event.linkedArticleId ? titleOf(event.linkedArticleId) : undefined;
    if (linked && linked !== event.name && event.linkedArticleId !== event.articleId)
      notes.push(`Artikel: ${linked}.`);
    out.push({
      id: `lk-zeit-${event.id}`,
      title: event.name.trim() || 'Ereignis',
      at,
      timed: event.detail >= 4,
      durationDays: days > 1 && days <= MAX_DURATION_DAYS ? days : null,
      details: notes.join(' '),
      articleId: event.articleId,
      linkedArticleId: event.linkedArticleId,
    });
  }
  out.sort((a, b) => a.at - b.at || a.title.localeCompare(b.title, 'de'));
  return {
    events: out,
    unknown: [...unknown].map(([calendar, count]) => ({ calendar, events: count })),
    tooEarly,
  };
}
