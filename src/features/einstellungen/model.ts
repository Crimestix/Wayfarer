/**
 * Fachlogik der Einstellungen: Kampagnenname, Ordnerprüfung, Erklärung von Ladeproblemen und
 * die lesbare Beschreibung des Kalenders. Reine Funktionen ohne React.
 */
import type { LoadProblem } from '../../data/db';
import {
  MINUTES_PER_DAY,
  formatYear,
  fromTime,
  isLeapYear,
  moonPhase,
  yearLength,
  type CalendarDef,
  type MoonDef,
  type WorldTime,
} from '../../domain/time/calendar';

// ── Kampagne ───────────────────────────────────────────────────────────────

export const CAMPAIGN_NAME_MAX = 60;

/** Bereinigt einen eingegebenen Kampagnennamen; null, wenn nichts Brauchbares übrig bleibt. */
export function cleanCampaignName(input: string): string | null {
  const name = input.replace(/\s+/g, ' ').trim().slice(0, CAMPAIGN_NAME_MAX).trim();
  return name || null;
}

const normalizePath = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * Liegt `candidate` im Ordner `folder` (oder ist es derselbe)? Vergleicht ohne Rücksicht auf
 * Groß-/Kleinschreibung und Schrägstrich-Richtung, wie es macOS und Windows tun.
 */
export function isInsideFolder(folder: string, candidate: string): boolean {
  const base = normalizePath(folder);
  const other = normalizePath(candidate);
  return !!base && (other === base || other.startsWith(base + '/'));
}

// ── Probleme beim Laden ────────────────────────────────────────────────────

export type ProblemKind = 'conflict' | 'damaged' | 'shape';

export interface ExplainedProblem {
  path: string;
  kind: ProblemKind;
  /** Um was für ein Dokument es geht: „Eintrag der Welt“, „Chronikeintrag“ … */
  what: string;
  /** Ein Satz, was mit der Datei nicht stimmt. */
  reason: string;
  /** Die ursprüngliche Meldung – für den Fall, dass jemand genauer hinsehen will. */
  detail: string;
}

const FOLDER_LABEL: Record<string, string> = {
  entities: 'Eintrag der Welt',
  relations: 'Beziehung',
  chronicle: 'Chronikeintrag',
  events: 'Termin',
  sessions: 'Session',
  timers: 'Timer',
  maps: 'Karte',
  paths: 'Weg',
  journeys: 'Reise',
  mounts: 'Reittier oder Fahrzeug',
  climates: 'Klimazone',
  weather: 'Tageswetter',
  areas: 'Erkundungsgebiet',
  tables: 'Tabelle',
  rests: 'Rast',
  articles: 'Artikel',
  atlas: 'Atlas',
  clocks: 'Uhren',
  threads: 'Fäden',
  stories: 'Geschichten',
  creatures: 'Bestiarium',
  encounters: 'Begegnungen',
  stocks: 'Bestände',
};

/** Typische Namenszusätze, die Cloud-Laufwerke an Konfliktkopien hängen. */
const CONFLICT_NAME =
  /konflikt|conflict|\(\d+\)\.json$| - kopie| copy|-[A-Z0-9]{4,}-[A-Z0-9-]+\.json$|\s\d+\.json$/i;

export function explainProblem(problem: LoadProblem): ExplainedProblem {
  const folder = problem.path.split('/')[0] ?? '';
  const what = FOLDER_LABEL[folder] ?? 'Datei';
  const base = { path: problem.path, what, detail: problem.message };
  if (/Konfliktkopie/.test(problem.message) || CONFLICT_NAME.test(problem.path))
    return {
      ...base,
      kind: 'conflict',
      reason:
        'Vermutlich eine Konfliktkopie: Der Dateiname passt nicht zum Inhalt oder trägt einen Zusatz des Cloud-Laufwerks.',
    };
  if (
    /JSON|Unexpected|Unterminated|Expected .* in|end of data|Unlesbar/i.test(problem.message) &&
    !/^\[/.test(problem.message.trim())
  )
    return {
      ...base,
      kind: 'damaged',
      reason:
        'Die Datei ist beschädigt oder unvollständig – oft, weil sie beim Abgleich nur halb übertragen wurde.',
    };
  return {
    ...base,
    kind: 'shape',
    reason:
      'Der Inhalt hat nicht die erwartete Form – etwa von Hand geändert oder von einer neueren Wayfarer-Version geschrieben.',
  };
}

/**
 * Alle Ladeprobleme, je Datei einmal und nach Pfad sortiert. Meldet die Dateiüberwachung eine
 * unlesbare Datei mehrfach (etwa während das Cloud-Laufwerk abgleicht), zählt die letzte Meldung.
 */
export function explainProblems(problems: readonly LoadProblem[]): ExplainedProblem[] {
  const byPath = new Map<string, LoadProblem>();
  for (const problem of problems) byPath.set(problem.path, problem);
  return [...byPath.values()]
    .map(explainProblem)
    .sort((a, b) => a.path.localeCompare(b.path, 'de'));
}

// ── Kalender lesbar ────────────────────────────────────────────────────────

const numberDe = (value: number, digits = 0) =>
  new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);

export interface MonthRow {
  index: number;
  name: string;
  days: number;
  /** Tage im Schaltjahr, wenn sie abweichen. */
  leapDays: number | null;
  /** Der Monat, in dem die Weltzeit gerade steht. */
  current: boolean;
}

export function monthRows(cal: CalendarDef, now: WorldTime): MonthRow[] {
  const today = fromTime(cal, now);
  return cal.months.map((month, index) => ({
    index,
    name: month.name,
    days: month.days,
    leapDays: cal.leapRule !== 'none' && month.leapDays ? month.days + month.leapDays : null,
    current: index === today.month,
  }));
}

/** „12 Monate · 365 Tage, im Schaltjahr 366 · Woche mit 7 Tagen“ */
export function calendarSummary(cal: CalendarDef): string {
  const common = cal.months.reduce((n, m) => n + m.days, 0);
  const leap =
    common + (cal.leapRule === 'none' ? 0 : cal.months.reduce((n, m) => n + (m.leapDays ?? 0), 0));
  return [
    cal.months.length === 1 ? '1 Monat' : `${cal.months.length} Monate`,
    leap !== common ? `${common} Tage, im Schaltjahr ${leap}` : `${common} Tage`,
    cal.weekdays.length === 1 ? 'Woche mit 1 Tag' : `Woche mit ${cal.weekdays.length} Tagen`,
  ].join(' · ');
}

/** Erklärt die Schaltjahre in einem Satz und nennt das laufende bzw. nächste. */
export function leapText(cal: CalendarDef, now: WorldTime): string {
  const extra = cal.months.filter((m) => m.leapDays);
  if (cal.leapRule === 'none' || !extra.length) return 'Dieser Kalender kennt keine Schaltjahre.';
  const absolute = cal.eras.find((e) => e.offset === 0);
  const counting = absolute ? `der Zählung ${absolute.label}` : 'der absoluten Zählung';
  const months = extra
    .map((m) => `der ${m.name} ${m.days + (m.leapDays ?? 0)} statt ${m.days} Tage`)
    .join(' und ');
  const year = fromTime(cal, now).year;
  let next = year;
  while (!isLeapYear(cal, next) && next < year + 1000) next++;
  const when =
    next === year
      ? `${formatYear(cal, year)} ist ein Schaltjahr.`
      : `Das nächste Schaltjahr ist ${formatYear(cal, next)}.`;
  return `Jedes vierte Jahr ${counting} ist ein Schaltjahr – ausgenommen volle Jahrhunderte, die nicht durch 400 teilbar sind. Dann hat ${months}. ${when}`;
}

export interface EraRow {
  id: string;
  label: string;
  /** Das laufende Jahr in dieser Zeitrechnung. */
  year: number;
  /** Die erste Zeitrechnung ist die Hauptanzeige. */
  primary: boolean;
  /** Verhältnis zur Hauptzeitrechnung in Worten; leer bei der Hauptzeitrechnung. */
  relation: string;
}

export function eraRows(cal: CalendarDef, now: WorldTime): EraRow[] {
  const year = fromTime(cal, now).year;
  const main = cal.eras[0];
  return cal.eras.map((era, i) => {
    const diff = main ? main.offset - era.offset : 0;
    return {
      id: era.id,
      label: era.label,
      year: year - era.offset,
      primary: i === 0,
      relation:
        i === 0 || !main || diff === 0
          ? ''
          : `${numberDe(Math.abs(diff))} Jahre ${diff > 0 ? 'vor' : 'hinter'} ${main.label}`,
    };
  });
}

export interface WeekdayRow {
  index: number;
  name: string;
  today: boolean;
}

export function weekdayRows(cal: CalendarDef, now: WorldTime): WeekdayRow[] {
  const today = fromTime(cal, now).weekday;
  return cal.weekdays.map((name, index) => ({ index, name, today: index === today }));
}

/** Umlaufzeit eines Mondes: „22,9 Tage“ */
export function moonCycleText(moon: MoonDef): string {
  const days = moon.period / MINUTES_PER_DAY;
  return `${numberDe(days, 1)} ${days === 1 ? 'Tag' : 'Tage'}`;
}

export interface MoonRow {
  moon: MoonDef;
  cycle: string;
  phase: string;
  light: number;
  /** Der letzte Neumond vor (oder genau) jetzt – daran lässt sich die Kalibrierung prüfen. */
  lastNew: WorldTime | null;
  nextFull: WorldTime;
}

export function moonRows(cal: CalendarDef, now: WorldTime): MoonRow[] {
  return cal.moons.map((moon) => {
    const phase = moonPhase(moon, now);
    const lastNew = Math.round(now - phase.fraction * moon.period);
    return {
      moon,
      cycle: moonCycleText(moon),
      phase: phase.label,
      light: phase.light,
      lastNew: lastNew >= 0 ? lastNew : null,
      nextFull: phase.nextFull,
    };
  });
}

/** Länge des laufenden Jahres in Tagen. */
export function currentYearLength(cal: CalendarDef, now: WorldTime): number {
  return yearLength(cal, fromTime(cal, now).year);
}
