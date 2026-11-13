/**
 * Zeit beim Lesen der Notizen: Die Vorschläge einer Session bekommen ihre Weltzeit in der
 * Reihenfolge des Textes. Angaben im Text verschieben Tag und Uhrzeit – „Nächster Tag“, „am
 * nächsten Morgen“, „8 Uhr“, „Mittags“, „abends“, „3 Tage später“, „Insgesamt 5 Tage vergangen“
 * oder ein Datum des Kalenders („5. Tauwind, 14:00“). Nie nach „jetzt“, nie vor dem Beginn der
 * Session. Rein, ohne Welt außer dem Kalender.
 */
import {
  MINUTES_PER_DAY,
  dayIndexOf,
  minuteOfDay,
  startOfDay,
  type CalendarDef,
  type WorldTime,
} from '../../domain/time/calendar';
import { findDates } from '../../domain/time/textDates';
import type { ChroniclePrecision } from '../../domain/schema';

/** Eine Zeitangabe im Text. */
export type TimeMark =
  | { at: number; to: number; kind: 'nextDay'; clock: number | null }
  | { at: number; to: number; kind: 'days'; days: number }
  | { at: number; to: number; kind: 'clock'; clock: number }
  | { at: number; to: number; kind: 'date'; day: number; clock: number | null }
  | { at: number; to: number; kind: 'total'; days: number };

const NUMBER_WORDS: Record<string, number> = {
  ein: 1,
  eine: 1,
  einen: 1,
  einem: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
};
const NUM = `\\d{1,2}|${Object.keys(NUMBER_WORDS).join('|')}`;
const amount = (raw: string) => NUMBER_WORDS[raw.toLocaleLowerCase('de')] ?? Number(raw);

const H = (hour: number, minute = 0) => hour * 60 + minute;

/** Tageszeiten in Worten. */
const PARTS: { pattern: RegExp; clock: number }[] = [
  {
    pattern:
      /(?<![\p{L}])(?:beim\s+frühstück|frühmorgens|morgens|am\s+morgen|in\s+der\s+früh)(?![\p{L}])/giu,
    clock: H(8),
  },
  { pattern: /(?<![\p{L}])(?:vormittags|am\s+vormittag)(?![\p{L}])/giu, clock: H(10) },
  {
    pattern: /(?<![\p{L}])(?:mittags|am\s+mittag|zu\s+mittag|zum\s+mittagessen)(?![\p{L}])/giu,
    clock: H(12),
  },
  { pattern: /(?<![\p{L}])(?:nachmittags|am\s+nachmittag)(?![\p{L}])/giu, clock: H(15) },
  {
    pattern:
      /(?<![\p{L}])(?:abends|am\s+abend|zum\s+abendessen|bei\s+sonnenuntergang)(?![\p{L}])/giu,
    clock: H(19),
  },
  {
    pattern: /(?<![\p{L}])(?:nachts|in\s+der\s+nacht|um\s+mitternacht|mitternacht)(?![\p{L}])/giu,
    clock: H(23),
  },
];

const NEXT_DAY =
  /(?<![\p{L}])(?:am\s+)?(?:nächste[nrs]?|folgende[nrs]?|darauffolgende[nrs]?)\s+(tag|morgen|mittag|abend)(?![\p{L}])|(?<![\p{L}])am\s+tag\s+darauf(?![\p{L}])/giu;
const LATER = new RegExp(
  `(?<![\\p{L}\\p{N}])(${NUM})\\s+(tage?n?|wochen?)\\s+(?:später|danach)(?![\\p{L}])`,
  'giu',
);
const TOTAL = new RegExp(
  `(?<![\\p{L}])insgesamt\\s+(?:sind\\s+)?(?:etwa\\s+|rund\\s+)?(${NUM})\\s+(tage?n?|wochen?)(?![\\p{L}])`,
  'giu',
);
/** „8 Uhr“, „9:15 Uhr“, „14:00“. */
const CLOCK =
  /(?<![\p{L}\p{N}:])([01]?\d|2[0-3])(?::([0-5]\d))?\s*uhr(?![\p{L}])|(?<![\p{L}\p{N}:.])([01]?\d|2[0-3]):([0-5]\d)(?![\p{N}])/giu;

/** Wird es nur erwähnt, ist es keine Zeit des Geschehens: „er soll morgen um 9 kommen“. */
const FUTURE_BEFORE = /(?:soll|sollte|sollen|will|wollen|wird|werden|bis|ab|um)\s*$/iu;

/**
 * Die Zeitangaben im Text, nach Stelle geordnet. `year` (absolut) ist das Jahr der Session – ein
 * Datum ohne Jahr gilt in ihm. Jahreszahlen allein (Gräber, Geschichte) zählen nicht.
 */
export function timeMarks(cal: CalendarDef, text: string, sessionStart: WorldTime): TimeMark[] {
  const marks: TimeMark[] = [];
  for (const m of text.matchAll(NEXT_DAY)) {
    const word = (m[1] ?? 'tag').toLocaleLowerCase('de');
    const clock =
      word === 'morgen' ? H(8) : word === 'mittag' ? H(12) : word === 'abend' ? H(19) : null;
    marks.push({ at: m.index, to: m.index + m[0].length, kind: 'nextDay', clock });
  }
  for (const m of text.matchAll(LATER)) {
    const n = amount(m[1]!);
    const days = /^woche/i.test(m[2]!) ? n * 7 : n;
    if (Number.isFinite(days) && days > 0)
      marks.push({ at: m.index, to: m.index + m[0].length, kind: 'days', days });
  }
  for (const m of text.matchAll(TOTAL)) {
    const n = amount(m[1]!);
    const days = /^woche/i.test(m[2]!) ? n * 7 : n;
    if (Number.isFinite(days) && days > 0)
      marks.push({ at: m.index, to: m.index + m[0].length, kind: 'total', days });
  }
  const covered = (at: number) => marks.some((mark) => at >= mark.at && at < mark.to);
  for (const part of PARTS)
    for (const m of text.matchAll(part.pattern)) {
      if (covered(m.index)) continue;
      marks.push({ at: m.index, to: m.index + m[0].length, kind: 'clock', clock: part.clock });
    }
  const dates = findDates(cal, text, sessionStart).filter((date) => date.precision === 'day');
  for (const m of text.matchAll(CLOCK)) {
    if (FUTURE_BEFORE.test(text.slice(Math.max(0, m.index - 12), m.index))) continue;
    const hour = Number(m[1] ?? m[3]);
    const minute = Number(m[2] ?? m[4] ?? 0);
    const clock = H(hour, minute);
    // Steht die Uhrzeit gleich hinter einem Datum, gehört sie zu ihm.
    const date = dates.find((d) => d.to <= m.index && m.index - d.to <= 4);
    if (date) continue;
    marks.push({ at: m.index, to: m.index + m[0].length, kind: 'clock', clock });
  }
  for (const date of dates) {
    const after = text.slice(date.to, date.to + 12);
    const clock = /^\s*,?\s*(?:um\s+)?([01]?\d|2[0-3]):([0-5]\d)/u.exec(after);
    marks.push({
      at: date.from,
      to: date.to,
      kind: 'date',
      day: dayIndexOf(date.time),
      clock: clock ? H(Number(clock[1]), Number(clock[2])) : null,
    });
  }
  // „morgen“ in der Zukunft („er soll morgen um 8 kommen“) ist kein neuer Tag des Geschehens.
  return marks
    .filter(
      (mark) =>
        !(
          mark.kind === 'nextDay' &&
          FUTURE_BEFORE.test(text.slice(Math.max(0, mark.at - 10), mark.at))
        ),
    )
    .sort((a, b) => a.at - b.at);
}

/** Die Weltzeit einer Session: Beginn, Ende (falls bekannt) und wie genau sie bekannt ist. */
export interface SessionTime {
  startAt: WorldTime;
  endAt: WorldTime | null;
  precision: ChroniclePrecision;
}

export interface PlacedTime {
  at: WorldTime;
  precision: ChroniclePrecision;
}

/** So viel Zeit vergeht zwischen zwei Vorschlägen ohne eigene Angabe. */
const STEP = 10;

/**
 * Verteilt Stellen im Text (`offsets`, aufsteigend) über die Session. Mit Zeitangaben im Text:
 * Tag für Tag ab dem Beginn; ohne: gleichmäßig zwischen Beginn und Ende. Immer in der
 * Reihenfolge des Textes, nie nach `now`.
 */
export function spreadTimes(
  cal: CalendarDef,
  session: SessionTime,
  text: string,
  offsets: number[],
  now: WorldTime,
): PlacedTime[] {
  const start = Math.min(session.startAt, now);
  const end = Math.min(session.endAt ?? Number.POSITIVE_INFINITY, now);
  const marks = timeMarks(cal, text, start);
  const known = session.precision === 'exact' || session.precision === 'day';
  const relative: ChroniclePrecision = known
    ? 'approx'
    : session.precision === 'approx'
      ? 'approx'
      : 'order';

  // Ohne Angaben im Text: gleichmäßig verteilt, nur die Reihenfolge ist bekannt.
  if (!marks.length) {
    const span = Number.isFinite(end) && end > start ? end - start : 0;
    return offsets.map((_, i) => ({
      at: span
        ? start + Math.round((span * (i + 1)) / (offsets.length + 1))
        : Math.min(start + i, now),
      precision: 'order',
    }));
  }

  // Tage aus den Angaben: wie viele Tage der Text umfasst.
  let lastDay = 0;
  {
    let day = 0;
    for (const mark of marks) {
      if (mark.kind === 'nextDay') day++;
      else if (mark.kind === 'days') day += mark.days;
      else if (mark.kind === 'date') day = Math.max(day, mark.day - dayIndexOf(start));
      else if (mark.kind === 'total') day = Math.max(day, mark.days - 1);
      lastDay = Math.max(lastDay, day);
    }
  }
  const firstDay = dayIndexOf(start);
  const spanDays = Number.isFinite(end) ? Math.max(0, dayIndexOf(end) - firstDay) : lastDay;
  // Passt der Text nicht in die Session, werden seine Tage zusammengeschoben.
  const squeeze = lastDay > spanDays && lastDay > 0 ? spanDays / lastDay : 1;

  const out: PlacedTime[] = [];
  let day = 0;
  let clock: number | null = start === session.startAt ? minuteOfDay(start) : null;
  let absolute = false;
  let timed = false;
  let marked = false;
  let cursor = start - STEP;
  let m = 0;
  for (const offset of offsets) {
    while (m < marks.length && marks[m]!.at <= offset) {
      const mark = marks[m++]!;
      marked = true;
      if (mark.kind === 'nextDay') {
        day++;
        clock = mark.clock;
        timed = false;
      } else if (mark.kind === 'days') {
        day += mark.days;
        clock = null;
        timed = false;
      } else if (mark.kind === 'clock') {
        if (clock === null || mark.clock >= clock || !timed) {
          clock = mark.clock;
          timed = true;
        }
      } else if (mark.kind === 'date') {
        const d = mark.day - firstDay;
        if (d >= 0 && d <= spanDays + 1) {
          day = d;
          absolute = true;
          clock = mark.clock;
          timed = mark.clock !== null;
        }
      }
    }
    let target: number;
    if (!absolute && squeeze < 1) {
      // Zusammengeschoben: Tag und Uhrzeit als Anteil an der ganzen Session.
      const within = (clock ?? (day === 0 ? minuteOfDay(start) : H(8))) / MINUTES_PER_DAY;
      target = start + Math.round(((day + within) / (lastDay + 1)) * (end - start));
    } else {
      const dayStart = startOfDay(start) + day * MINUTES_PER_DAY;
      target = dayStart + (clock ?? (day === 0 ? minuteOfDay(start) : H(8)));
    }
    // In der Reihenfolge des Textes, zwischen Beginn und Ende (und nie nach jetzt).
    const at = Math.max(Math.min(Math.max(cursor + STEP, target), end, now), cursor, start);
    cursor = at;
    const precision: ChroniclePrecision = absolute
      ? timed
        ? 'exact'
        : 'day'
      : marked
        ? relative
        : 'order';
    out.push({ at, precision });
  }
  return out;
}
