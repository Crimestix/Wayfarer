/**
 * Zeitalter: Abschnitte der Weltgeschichte, die der Spielleiter benennt – „Das Zeitalter der
 * Asche“ von 412 bis 650. Sie liegen als breite, sanft getönte Bänder über allen Bahnen der
 * Zeitleiste und sagen auf „Welt an diesem Tag“, in welchem Zeitalter ein Tag lag. Wayfarer
 * erfindet keine; es liest nur, was eingetragen ist. Reine Funktionen.
 */
import { readDatePoint } from './lifespan';
import type { Age, CampaignData, DatePoint } from './schema';
import {
  MINUTES_PER_DAY,
  fromTime,
  shiftMonth,
  startOfDay,
  toTime,
  type CalendarDef,
  type WorldTime,
} from './time/calendar';

/** Wie weit ein Tag, Monat oder Jahr reicht: vom ersten Augenblick bis zum nächsten. */
export function pointSpan(cal: CalendarDef, point: DatePoint): { lo: WorldTime; hi: WorldTime } {
  const d = fromTime(cal, point.at);
  switch (point.precision) {
    case 'day':
      return { lo: startOfDay(point.at), hi: startOfDay(point.at) + MINUTES_PER_DAY };
    case 'month': {
      const next = shiftMonth(cal, d.year, d.month, 1);
      return {
        lo: toTime(cal, { year: d.year, month: d.month, day: 1, hour: 0, minute: 0 }),
        hi: toTime(cal, { year: next.year, month: next.month, day: 1, hour: 0, minute: 0 }),
      };
    }
    case 'year':
      return {
        lo: toTime(cal, { year: d.year, month: 0, day: 1, hour: 0, minute: 0 }),
        hi: toTime(cal, { year: d.year + 1, month: 0, day: 1, hour: 0, minute: 0 }),
      };
  }
}

/** Ein Zeitalter als Strecke: vom Beginn seines ersten bis zum Ende seines letzten Jahres. */
export interface AgeSpan {
  age: Age;
  from: WorldTime;
  /** null = es dauert noch an. */
  to: WorldTime | null;
  /** Abwechselnd getönt, damit zwei aneinanderstoßende Zeitalter zu unterscheiden sind (0 oder 1). */
  shade: 0 | 1;
}

/** Die Zeitalter, das früheste zuerst – ohne solche, deren Ende vor dem Beginn liegt. */
export function agesSorted(data: Pick<CampaignData, 'campaign'>): AgeSpan[] {
  const cal = data.campaign.calendar;
  return data.campaign.ages
    .map((age) => ({
      age,
      from: pointSpan(cal, age.from).lo,
      to: age.to ? pointSpan(cal, age.to).hi : null,
    }))
    .filter((span) => span.to === null || span.to > span.from)
    .sort((a, b) => a.from - b.from || a.age.name.localeCompare(b.age.name, 'de'))
    .map((span, index) => ({ ...span, shade: (index % 2) as 0 | 1 }));
}

/** Die Zeitalter, in die ein Zeitpunkt fällt (meist eins; überschneiden sie sich, alle). */
export function agesAt(data: Pick<CampaignData, 'campaign'>, at: WorldTime): AgeSpan[] {
  return agesSorted(data).filter((span) => span.from <= at && (span.to === null || at < span.to));
}

/** Die Zeitalter, die in einem Fenster liegen. */
export function agesIn(
  data: Pick<CampaignData, 'campaign'>,
  from: WorldTime,
  to: WorldTime,
): AgeSpan[] {
  return agesSorted(data).filter(
    (span) => span.from <= to && (span.to === null || span.to >= from),
  );
}

export interface AgeInput {
  name: string;
  /** Beginn in Worten: „412“, „Tauwind 412“, „vor 300 Jahren“. */
  from: string;
  /** Ende in Worten; leer = bis heute. */
  to: string;
}

/**
 * Liest ein Zeitalter aus den Feldern – oder sagt, was nicht passt. Der Name ist Wort für Wort
 * der des Spielleiters.
 */
export function readAge(
  cal: CalendarDef,
  input: AgeInput,
  now: WorldTime,
): { from: DatePoint; to: DatePoint | null; name: string } | { problem: string } {
  const name = input.name.trim();
  if (!name) return { problem: 'Das Zeitalter braucht einen Namen.' };
  const from = readDatePoint(cal, input.from, now);
  if (!from)
    return { problem: 'Der Beginn lässt sich nicht lesen – etwa „412“ oder „Tauwind 412“.' };
  if (!input.to.trim()) return { name, from, to: null };
  const to = readDatePoint(cal, input.to, now);
  if (!to) return { problem: 'Das Ende lässt sich nicht lesen – leer lassen heißt „bis heute“.' };
  if (pointSpan(cal, to).hi <= pointSpan(cal, from).lo)
    return { problem: 'Das Ende liegt vor dem Beginn.' };
  return { name, from, to };
}
