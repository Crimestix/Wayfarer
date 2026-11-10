/**
 * Fachlogik des Kalender-Bereichs: Monatsraster, Termine über mehrere Tage, Mondereignisse,
 * Kennzeichen aus der Chronik und die Prüfung der Dialogeingaben. Reine Funktionen.
 */
import { byTime, occurrencesBetween, occurrencesOf, type Occurrence } from '../../domain/derive';
import type {
  CalendarEvent,
  CampaignData,
  ChronicleEntry,
  EventKind,
  Repeat,
  Timer,
} from '../../domain/schema';
import {
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  MOON_PHASES,
  absoluteYear,
  dayIndexOf,
  displayYear,
  formatDuration,
  fromTime,
  isValidDate,
  monthLength,
  toTime,
  weekdayOfDay,
  type CalendarDef,
  type MoonDef,
  type WorldTime,
} from '../../domain/time/calendar';

// ── Monatsraster ───────────────────────────────────────────────────────────

export interface DayCell {
  dayIndex: number;
  /** Tagesbeginn als Weltzeit. */
  time: WorldTime;
  year: number;
  month: number;
  day: number;
  weekday: number;
  /** Gehört der Tag zum angezeigten Monat (sonst Ausläufer des Nachbarmonats)? */
  inMonth: boolean;
}

export interface MonthGrid {
  year: number;
  month: number;
  /** Erster und letzter Tagesindex des Rasters (einschließlich der Ausläufer). */
  firstDay: number;
  lastDay: number;
  /** Wochenzeilen; jede hat so viele Spalten wie der Kalender Wochentage. null = vor Beginn der Zeit. */
  weeks: (DayCell | null)[][];
}

/** Raster eines Monats mit Wochentags-Spalten; die erste Spalte ist der erste Wochentag des Kalenders. */
export function monthGrid(cal: CalendarDef, year: number, month: number): MonthGrid {
  const width = cal.weekdays.length;
  const first = dayIndexOf(toTime(cal, { year, month, day: 1, hour: 0, minute: 0 }));
  const length = monthLength(cal, year, month);
  const lead = weekdayOfDay(cal, first);
  const rows = Math.ceil((lead + length) / width);
  const start = first - lead;
  const weeks: (DayCell | null)[][] = [];
  for (let row = 0; row < rows; row++) {
    const week: (DayCell | null)[] = [];
    for (let col = 0; col < width; col++) {
      const dayIndex = start + row * width + col;
      if (dayIndex < 0) {
        week.push(null);
        continue;
      }
      const time = dayIndex * MINUTES_PER_DAY;
      const d = fromTime(cal, time);
      week.push({
        dayIndex,
        time,
        year: d.year,
        month: d.month,
        day: d.day,
        weekday: d.weekday,
        inMonth: dayIndex >= first && dayIndex < first + length,
      });
    }
    weeks.push(week);
  }
  return { year, month, firstDay: start, lastDay: start + rows * width - 1, weeks };
}

/** „Heute“, „Morgen“, „in 5 Tagen“, „vor 3 Tagen“ – Abstand in ganzen Tagen. */
export function relativeDay(today: number, dayIndex: number): string {
  const diff = dayIndex - today;
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  if (diff === -1) return 'Gestern';
  return diff > 0 ? `in ${diff} Tagen` : `vor ${-diff} Tagen`;
}

// ── Termine über Tage hinweg ───────────────────────────────────────────────

/** Ein Vorkommen eines Termins mit den Tagen, die es belegt. */
export interface DaySpan {
  event: CalendarEvent;
  at: WorldTime;
  startDay: number;
  endDay: number;
}

const spanLength = (span: DaySpan) => span.endDay - span.startDay + 1;

function toSpan(o: Occurrence): DaySpan {
  const startDay = dayIndexOf(o.at);
  return { event: o.event, at: o.at, startDay, endDay: startDay + (o.event.durationDays ?? 1) - 1 };
}

const spanOrder = (a: DaySpan, b: DaySpan) =>
  a.startDay - b.startDay ||
  spanLength(b) - spanLength(a) ||
  Number(a.event.timed) - Number(b.event.timed) ||
  a.at - b.at ||
  a.event.title.localeCompare(b.event.title) ||
  a.event.id.localeCompare(b.event.id);

/** Alle Vorkommen, die einen der Tage [fromDay, toDay] berühren – auch solche, die vorher begannen. */
export function spansBetween(data: CampaignData, fromDay: number, toDay: number): DaySpan[] {
  const longest = Math.max(1, ...Object.values(data.events).map((e) => e.durationDays ?? 1));
  const from = Math.max(0, fromDay - (longest - 1)) * MINUTES_PER_DAY;
  const to = (toDay + 1) * MINUTES_PER_DAY - 1;
  return occurrencesBetween(data, from, to)
    .map(toSpan)
    .filter((span) => span.endDay >= fromDay)
    .sort(spanOrder);
}

/** Termine eines Tages: ganztägige und laufende zuerst, dann nach Uhrzeit. */
export function spansOnDay(spans: DaySpan[], dayIndex: number): DaySpan[] {
  return spans
    .filter((span) => span.startDay <= dayIndex && span.endDay >= dayIndex)
    .sort(
      (a, b) =>
        Number(a.event.timed && a.startDay === dayIndex) -
          Number(b.event.timed && b.startDay === dayIndex) ||
        a.at - b.at ||
        a.event.title.localeCompare(b.event.title),
    );
}

export type SpanState = 'open' | 'done' | 'overdue' | 'past';

/** Stand eines Vorkommens: offen, abgehakt, überfällig (Vorhaben/Frist) oder schlicht vorbei. */
export function spanState(span: DaySpan, now: WorldTime): SpanState {
  const { event } = span;
  if (event.done && !event.repeat) return 'done';
  const today = dayIndexOf(now);
  // Wie overdueEvents: Vorhaben und Fristen sind überfällig, sobald ihr Beginn verstrichen ist.
  const started = event.timed ? span.at < now : span.startDay < today;
  if (!event.repeat && event.kind !== 'world' && started) return 'overdue';
  const over = event.timed && span.endDay === span.startDay ? span.at < now : span.endDay < today;
  return over ? 'past' : 'open';
}

export interface WeekSegment {
  span: DaySpan;
  /** Erste Spalte (0-basiert) und Anzahl der Spalten in dieser Woche. */
  col: number;
  length: number;
  /** Zeile innerhalb der Woche, 0 = oberste. */
  lane: number;
  /** Der Termin begann schon vor dieser Woche bzw. läuft danach weiter. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  /**
   * Die Zeile darunter ist an diesem Tag frei: ein eintägiger Termin darf seinen Titel auf zwei
   * Zeilen umbrechen, statt ihn abzuschneiden.
   */
  tall: boolean;
}

export interface WeekLayout {
  segments: WeekSegment[];
  /** Je Spalte: wie viele Termine keinen Platz mehr fanden. */
  hidden: number[];
}

/**
 * Verteilt die Termine einer Woche auf Zeilen, sodass mehrtägige als durchgehender Balken
 * erscheinen. Reicht der Platz an einem Tag nicht, weicht die unterste Zeile dort dem Hinweis
 * „+ n weitere“.
 */
export function layoutWeek(
  spans: DaySpan[],
  weekStart: number,
  weekLength: number,
  maxLanes: number,
): WeekLayout {
  const weekEnd = weekStart + weekLength - 1;
  const placed: WeekSegment[] = [];
  const lanes: number[] = []; // je Zeile: letzte belegte Spalte
  for (const span of [...spans].sort(spanOrder)) {
    if (span.endDay < weekStart || span.startDay > weekEnd) continue;
    const col = Math.max(span.startDay, weekStart) - weekStart;
    const end = Math.min(span.endDay, weekEnd) - weekStart;
    let lane = lanes.findIndex((lastCol) => lastCol < col);
    if (lane === -1) lane = lanes.length;
    lanes[lane] = end;
    placed.push({
      span,
      col,
      length: end - col + 1,
      lane,
      continuesBefore: span.startDay < weekStart,
      continuesAfter: span.endDay > weekEnd,
      tall: false,
    });
  }
  const crowded = new Array<boolean>(weekLength).fill(false);
  for (const seg of placed)
    if (seg.lane >= maxLanes)
      for (let c = seg.col; c < seg.col + seg.length; c++) crowded[c] = true;
  const hidden = new Array<number>(weekLength).fill(0);
  const segments: WeekSegment[] = [];
  for (const seg of placed) {
    const cols = Array.from({ length: seg.length }, (_, i) => seg.col + i);
    const fits =
      seg.lane < maxLanes - 1 || (seg.lane === maxLanes - 1 && !cols.some((c) => crowded[c]));
    if (fits) segments.push(seg);
    else for (const c of cols) hidden[c]! += 1;
  }
  // Eintägige Termine dürfen die Zeile darunter mitbenutzen, wenn dort nichts steht.
  const taken = new Set<string>();
  for (const seg of segments)
    for (let c = seg.col; c < seg.col + seg.length; c++) taken.add(`${seg.lane}:${c}`);
  for (let c = 0; c < weekLength; c++) if (hidden[c]! > 0) taken.add(`${maxLanes - 1}:${c}`);
  for (const seg of segments)
    seg.tall =
      seg.length === 1 && seg.lane + 1 < maxLanes && !taken.has(`${seg.lane + 1}:${seg.col}`);
  return { segments, hidden };
}

// ── Chronik im Raster ──────────────────────────────────────────────────────

export interface DayMarks {
  /** Einträge der Chronik an diesem Tag, ohne Ortswechsel. */
  entries: number;
  /** Ortswechsel der Gruppe an diesem Tag. */
  travels: ChronicleEntry[];
}

/** Welche Tage haben Chronik-Einträge, und an welchen hat die Gruppe den Ort gewechselt? */
export function chronicleMarks(
  data: CampaignData,
  fromDay: number,
  toDay: number,
): Map<number, DayMarks> {
  const marks = new Map<number, DayMarks>();
  for (const entry of Object.values(data.chronicle)) {
    const day = dayIndexOf(entry.at);
    if (day < fromDay || day > toDay) continue;
    let mark = marks.get(day);
    if (!mark) marks.set(day, (mark = { entries: 0, travels: [] }));
    if (entry.kind === 'travel') mark.travels.push(entry);
    else mark.entries += 1;
  }
  for (const mark of marks.values()) mark.travels.sort(byTime);
  return marks;
}

export function chronicleOnDay(data: CampaignData, dayIndex: number): ChronicleEntry[] {
  return Object.values(data.chronicle)
    .filter((entry) => dayIndexOf(entry.at) === dayIndex)
    .sort(byTime);
}

// ── Monde ──────────────────────────────────────────────────────────────────

/** 0 = Neumond, 1 = erstes Viertel, 2 = Vollmond, 3 = letztes Viertel. */
export type MoonQuarter = 0 | 1 | 2 | 3;

export interface MoonEvent {
  moon: MoonDef;
  quarter: MoonQuarter;
  at: WorldTime;
  label: string;
}

/** Hauptphasen aller Monde in den Tagen [fromDay, toDay], nach Tagesindex. */
export function moonEventsBetween(
  cal: CalendarDef,
  fromDay: number,
  toDay: number,
): Map<number, MoonEvent[]> {
  const out = new Map<number, MoonEvent[]>();
  const from = fromDay * MINUTES_PER_DAY;
  const to = (toDay + 1) * MINUTES_PER_DAY;
  for (const moon of cal.moons) {
    const step = moon.period / 4;
    // Sehr schnelle Monde hätten täglich mehrere Phasen; das Raster zeigt dann keine einzelnen.
    if (!(step >= MINUTES_PER_DAY / 2)) continue;
    for (let k = Math.ceil((from - moon.anchor) / step); ; k++) {
      const at = Math.round(moon.anchor + k * step);
      if (at >= to) break;
      if (at < from) continue;
      const quarter = (((k % 4) + 4) % 4) as MoonQuarter;
      const day = dayIndexOf(at);
      const list = out.get(day) ?? [];
      list.push({ moon, quarter, at, label: MOON_PHASES[quarter * 2]! });
      out.set(day, list);
    }
  }
  return out;
}

/** Stellt einen Mond so, dass zum Zeitpunkt `at` Voll- bzw. Neumond ist. Der Kalender bleibt sonst gleich. */
export function calibrateMoon(
  cal: CalendarDef,
  moonId: string,
  at: WorldTime,
  phase: 'full' | 'new',
): CalendarDef {
  return {
    ...cal,
    moons: cal.moons.map((moon) =>
      moon.id === moonId
        ? { ...moon, anchor: Math.round(phase === 'new' ? at : at - moon.period / 2) }
        : moon,
    ),
  };
}

// ── Wiederholung ───────────────────────────────────────────────────────────

export function describeRepeat(repeat: Repeat | null): string {
  if (!repeat) return 'einmalig';
  const { every, unit } = repeat;
  if (every === 1)
    return { day: 'täglich', week: 'jede Woche', month: 'jeden Monat', year: 'jedes Jahr' }[unit];
  return `alle ${every} ${{ day: 'Tage', week: 'Wochen', month: 'Monate', year: 'Jahre' }[unit]}`;
}

/** Die nächsten Vorkommen eines (auch noch nicht gespeicherten) Termins ab `from`. */
export function nextOccurrences(
  cal: CalendarDef,
  event: CalendarEvent,
  from: WorldTime,
  count: number,
): WorldTime[] {
  if (!event.repeat) return [];
  const { every, unit } = event.repeat;
  const days =
    unit === 'day'
      ? every
      : unit === 'week'
        ? every * cal.weekdays.length
        : unit === 'month'
          ? every * 31
          : every * 366;
  const horizon = Math.max(from, event.at) + days * (count + 1) * MINUTES_PER_DAY;
  return occurrencesOf(cal, event, from, horizon)
    .slice(0, count)
    .map((o) => o.at);
}

// ── Termin-Dialog ──────────────────────────────────────────────────────────

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  world: 'Weltereignis',
  plan: 'Vorhaben',
  deadline: 'Frist',
};

/** Wie ein abgehakter Termin heißt: Weltereignisse treten ein, Vorhaben und Fristen werden erledigt. */
export const EVENT_DONE_LABEL: Record<EventKind, string> = {
  world: 'Eingetreten',
  plan: 'Erledigt',
  deadline: 'Erledigt',
};

export const EVENT_KIND_HINT: Record<EventKind, string> = {
  world: 'Unabhängig von der Gruppe',
  plan: 'Das hat die Gruppe vor',
  deadline: 'Bis dahin muss es erledigt sein',
};

export type RepeatChoice = 'none' | Repeat['unit'];

/** Inhalt des Termin-Dialogs; Zahlenfelder als Text, wie sie eingegeben werden. */
export interface EventForm {
  title: string;
  day: string;
  month: number;
  /** Jahr in der Hauptzeitrechnung. */
  year: string;
  timed: boolean;
  hour: string;
  minute: string;
  kind: EventKind;
  placeId: string | null;
  refs: string[];
  durationDays: string;
  repeatUnit: RepeatChoice;
  repeatEvery: string;
  details: string;
  done: boolean;
}

const two = (n: number) => String(n).padStart(2, '0');

/** Leeres Formular für einen neuen Termin an einem Tag. */
export function blankEventForm(
  cal: CalendarDef,
  dayTime: WorldTime,
  kind: EventKind = 'world',
): EventForm {
  const d = fromTime(cal, dayTime);
  return {
    title: '',
    day: String(d.day),
    month: d.month,
    year: String(displayYear(cal, d.year)),
    timed: false,
    hour: '12',
    minute: '00',
    kind,
    placeId: null,
    refs: [],
    durationDays: '',
    repeatUnit: 'none',
    repeatEvery: '1',
    details: '',
    done: false,
  };
}

export function eventToForm(cal: CalendarDef, event: CalendarEvent): EventForm {
  const d = fromTime(cal, event.at);
  return {
    title: event.title,
    day: String(d.day),
    month: d.month,
    year: String(displayYear(cal, d.year)),
    timed: event.timed,
    hour: event.timed ? two(d.hour) : '12',
    minute: event.timed ? two(d.minute) : '00',
    kind: event.kind,
    placeId: event.placeId,
    refs: event.refs,
    durationDays: event.durationDays && event.durationDays > 1 ? String(event.durationDays) : '',
    repeatUnit: event.repeat?.unit ?? 'none',
    repeatEvery: String(event.repeat?.every ?? 1),
    details: event.details,
    done: event.done,
  };
}

export type EventFields = Pick<
  CalendarEvent,
  | 'title'
  | 'at'
  | 'timed'
  | 'kind'
  | 'placeId'
  | 'refs'
  | 'durationDays'
  | 'repeat'
  | 'details'
  | 'done'
>;

export type FormResult<T> = { ok: true; value: T } | { ok: false; error: string };

const wholeNumber = (text: string): number | null => {
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
};

/** Prüft die Eingaben des Termin-Dialogs und macht daraus die Felder eines Termins. */
export function parseEventForm(cal: CalendarDef, form: EventForm): FormResult<EventFields> {
  const title = form.title.trim();
  if (!title) return { ok: false, error: 'Der Termin braucht einen Titel.' };
  const day = wholeNumber(form.day);
  const year = /^-?\d+$/.test(form.year.trim()) ? Number(form.year.trim()) : null;
  const hour = form.timed ? wholeNumber(form.hour) : 0;
  const minute = form.timed ? wholeNumber(form.minute) : 0;
  if (hour === null || minute === null || hour > 23 || minute > 59)
    return { ok: false, error: 'Diese Uhrzeit gibt es nicht.' };
  const parts = {
    year: year === null ? NaN : absoluteYear(cal, year),
    month: form.month,
    day: day ?? NaN,
    hour,
    minute,
  };
  if (!isValidDate(cal, parts))
    return { ok: false, error: 'Dieses Datum gibt es im Kalender nicht.' };
  let durationDays: number | null = null;
  if (form.durationDays.trim()) {
    const n = wholeNumber(form.durationDays);
    if (n === null || n < 1)
      return { ok: false, error: 'Die Dauer ist eine ganze Zahl von Tagen ab 1.' };
    durationDays = n > 1 ? n : null;
  }
  let repeat: Repeat | null = null;
  if (form.repeatUnit !== 'none') {
    const every = wholeNumber(form.repeatEvery);
    if (every === null || every < 1)
      return { ok: false, error: 'Die Wiederholung braucht eine ganze Zahl ab 1.' };
    repeat = { every, unit: form.repeatUnit };
  }
  return {
    ok: true,
    value: {
      title,
      at: toTime(cal, parts),
      timed: form.timed,
      kind: form.kind,
      placeId: form.placeId,
      refs: form.refs,
      durationDays,
      repeat,
      details: form.details.trim(),
      // Wiederkehrende Termine lassen sich nicht als Ganzes abhaken.
      done: repeat ? false : form.done,
    },
  };
}

// ── Wirkungen und Tätigkeiten ──────────────────────────────────────────────

export { TIMER_KIND_LABEL } from '../../domain/derive';

/** Dauer aus den drei Feldern Tage, Stunden, Minuten; null, wenn die Eingabe keine Dauer ergibt. */
export function parseDuration(days: string, hours: string, minutes: string): number | null {
  const parts = [days, hours, minutes].map((text) => (text.trim() ? wholeNumber(text) : 0));
  if (parts.some((n) => n === null)) return null;
  const total = parts[0]! * MINUTES_PER_DAY + parts[1]! * MINUTES_PER_HOUR + parts[2]!;
  return total > 0 && Number.isSafeInteger(total) ? total : null;
}

/** Zerlegt eine Dauer in die drei Felder des Dialogs; leere Felder statt Nullen. */
export function splitDuration(minutes: number): { days: string; hours: string; minutes: string } {
  const total = Math.max(0, Math.round(minutes));
  const text = (n: number) => (n ? String(n) : '');
  return {
    days: text(Math.floor(total / MINUTES_PER_DAY)),
    hours: text(Math.floor((total % MINUTES_PER_DAY) / MINUTES_PER_HOUR)),
    minutes: text(total % MINUTES_PER_HOUR),
  };
}

/** Verstrichener Anteil 0–1. */
export function timerProgress(timer: Pick<Timer, 'start' | 'end'>, now: WorldTime): number {
  const span = timer.end - timer.start;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (now - timer.start) / span));
}

// ── Zeit bis zu einem Tag vergehen lassen ──────────────────────────────────

export interface PassagePreview {
  to: WorldTime;
  minutes: number;
  /** Termine, die auf dem Weg eintreten würden. */
  occurred: Occurrence[];
  /** Wirkungen und Tätigkeiten, die dabei enden würden. */
  expired: Timer[];
}

/** Was geschähe, wenn die Zeit bis `to` verginge? null, wenn `to` nicht in der Zukunft liegt. */
export function previewPassage(data: CampaignData, to: WorldTime): PassagePreview | null {
  const now = data.state.now;
  if (to <= now) return null;
  return {
    to,
    minutes: to - now,
    occurred: occurrencesBetween(data, now + 1, to).filter(
      (o) => !(o.event.done && !o.event.repeat),
    ),
    expired: Object.values(data.timers).filter((t) => !t.done && t.end > now && t.end <= to),
  };
}

/** Was auf dem Weg zu einem Tag eintritt, bevor dieser Tag selbst beginnt. */
export function occurredBeforeDay(preview: PassagePreview, dayIndex: number): Occurrence[] {
  return preview.occurred.filter((o) => dayIndexOf(o.at) < dayIndex);
}

/** „2 Tage 14 Std. vergehen · 1 Termin tritt ein · 1 Wirkung endet“ */
export function describePassage(preview: PassagePreview): string {
  const parts = [`${formatDuration(preview.minutes)} vergehen`];
  const n = preview.occurred.length;
  if (n) parts.push(n === 1 ? '1 Termin tritt ein' : `${n} Termine treten ein`);
  const t = preview.expired.length;
  if (t)
    parts.push(
      t === 1 ? '1 Wirkung oder Tätigkeit endet' : `${t} Wirkungen oder Tätigkeiten enden`,
    );
  return parts.join(' · ');
}

/** „seit gestern überfällig“, „seit 3 Tagen überfällig“, „seit 2 Std. überfällig“ */
export function overdueLabel(now: WorldTime, event: Pick<CalendarEvent, 'at' | 'timed'>): string {
  const days = dayIndexOf(now) - dayIndexOf(event.at);
  if (days <= 0) return `seit ${formatDuration(now - event.at)} überfällig`;
  return days === 1 ? 'seit gestern überfällig' : `seit ${days} Tagen überfällig`;
}
