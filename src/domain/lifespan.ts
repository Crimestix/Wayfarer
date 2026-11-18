/**
 * Lebensdaten und Alter von selbst: Geboren/gegründet (`entity.born`) und gestorben/untergegangen
 * (`entity.ended`) stehen als Weltzeit mit Genauigkeit am Eintrag. Daraus rechnet Wayfarer
 * „34 Jahre“, „starb mit 52 – vor 12 Jahren“ oder „gegründet vor 300 Jahren“, immer bezogen auf
 * den heutigen Tag der Welt. Ein Tod aus der Chronik (Schicksal) zählt, wenn kein Tag eingetragen
 * ist. Reine Funktionen.
 */
import { fateSince } from './history';
import type { CampaignData, DatePoint, Entity, EntityKind } from './schema';
import {
  MINUTES_PER_DAY,
  formatDate,
  formatYear,
  fromTime,
  primaryEra,
  toTime,
  type CalendarDef,
  type WorldTime,
} from './time/calendar';
import { findDates } from './time/textDates';

/** Wie Anfang und Ende bei dieser Art heißen. */
export interface LifeWords {
  start: string;
  end: string;
  /** „Alter“ bei Lebewesen, sonst „Besteht seit“. */
  age: string;
}

const LIVING: LifeWords = { start: 'Geboren', end: 'Gestorben', age: 'Alter' };
const FOUNDED: LifeWords = { start: 'Gegründet', end: 'Untergegangen', age: 'Besteht seit' };

export function lifeWords(kind: EntityKind): LifeWords {
  switch (kind) {
    case 'person':
    case 'character':
      return LIVING;
    case 'faction':
    case 'family':
      return { start: 'Gegründet', end: 'Aufgelöst', age: 'Besteht seit' };
    case 'item':
      return { start: 'Geschaffen', end: 'Zerstört', age: 'Alter' };
    case 'place':
      return FOUNDED;
    default:
      return { start: 'Entstanden', end: 'Vergangen', age: 'Besteht seit' };
  }
}

/** Ganze Jahre von `from` bis `to` – nach Tag und Monat, bei nur bekanntem Jahr nach dem Jahr. */
export function yearsBetween(
  cal: CalendarDef,
  from: DatePoint,
  to: WorldTime,
  toPrecision: DatePoint['precision'] = 'day',
): number {
  const a = fromTime(cal, from.at);
  const b = fromTime(cal, to);
  let years = b.year - a.year;
  if (from.precision === 'year' || toPrecision === 'year') return Math.max(0, years);
  if (b.month < a.month || (b.month === a.month && from.precision === 'day' && b.day < a.day))
    years--;
  return Math.max(0, years);
}

const years = (n: number) => (n === 1 ? '1 Jahr' : `${n} Jahren`);
const yearsOld = (n: number) => (n === 1 ? '1 Jahr' : `${n} Jahre`);

/** Ein Tag, ein Monat oder ein Jahr der Welt in Worten. */
export function formatDatePoint(cal: CalendarDef, point: DatePoint): string {
  const d = fromTime(cal, point.at);
  if (point.precision === 'year') return formatYear(cal, d.year);
  if (point.precision === 'month')
    return `${cal.months[d.month]?.name ?? ''} ${formatYear(cal, d.year)}`.trim();
  return formatDate(cal, point.at);
}

/**
 * Liest einen Tag aus Worten: „3. Tauwind 667“, „Tauwind 667“, „667“, „Jahr 667“, „vor 300
 * Jahren“ – und bei Lebewesen auch ein Alter: „34 Jahre“, „Alter 34“ (dann ist das Geburtsjahr
 * gemeint). Eine Zahl allein ist ein Jahr – ein Alter nur mit `bareAge` (das Feld heißt „Alter“).
 * Gibt null, wenn nichts zu lesen ist.
 */
export function readDatePoint(
  cal: CalendarDef,
  text: string,
  now: WorldTime,
  options: { age?: boolean; bareAge?: boolean } = {},
): DatePoint | null {
  const raw = text.trim();
  if (!raw) return null;
  const thisYear = fromTime(cal, now).year;
  const yearStart = (year: number): WorldTime =>
    toTime(cal, { year, month: 0, day: 1, hour: 0, minute: 0 });
  // „vor 300 Jahren“
  const ago = /^(?:etwa\s+|ungefähr\s+|ca\.?\s+)?vor\s+(\d{1,5})\s+Jahr(?:en)?$/i.exec(raw);
  if (ago) return { at: yearStart(thisYear - Number(ago[1])), precision: 'year' };
  // Ein Alter: „34 Jahre“, „34 Jahre alt“, „Alter 34“ – nur, wo ein Alter gemeint sein kann. Eine
  // Zahl allein („Geboren: 650“) ist ein Jahr, außer das Feld selbst heißt „Alter“.
  const age = /^(Alter\s*:?\s*)?(\d{1,4})(\s+Jahre?(?:\s+alt)?)?$/i.exec(raw);
  const marked = !!age && (!!age[1] || !!age[3]);
  if (
    (options.age || options.bareAge) &&
    age &&
    (marked || options.bareAge) &&
    Number(age[2]) < 2000
  )
    return { at: yearStart(thisYear - Number(age[2])), precision: 'year' };
  const found = findDates(cal, raw, now)[0];
  if (found && !found.assumedYear) return { at: found.time, precision: found.precision };
  // Eine Jahreszahl allein, mit oder ohne Zeitrechnung: „667“, „Jahr 667“, „667 AD“.
  const era = primaryEra(cal);
  const year = new RegExp(
    `^(?:Jahr\\s+)?(\\d{1,5})(?:\\s*${era.label ? era.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : ''})?$`,
    'i',
  ).exec(raw);
  if (year) return { at: yearStart(Number(year[1]) + era.offset), precision: 'year' };
  if (found) return { at: found.time, precision: found.precision };
  return null;
}

/** Ein Tag als Text für das Eingabefeld: „3. Tauwind 667 AD“ oder „667 AD“. */
export const datePointText = (cal: CalendarDef, point: DatePoint | null) =>
  point ? formatDatePoint(cal, point) : '';

export interface LifeFact {
  label: string;
  text: string;
  tone?: 'danger';
}

/** Der Tod: eingetragen oder aus der Chronik (Schicksal „tot“). */
export function endOf(data: CampaignData, entity: Entity): DatePoint | null {
  if (entity.ended) return entity.ended;
  if (entity.kind !== 'person' && entity.kind !== 'character') return null;
  const status = entity.kind === 'person' ? entity.person.status : entity.character.status;
  if (status !== 'dead') return null;
  const since = fateSince(data, entity.id);
  return since ? { at: since.since, precision: 'day' } : null;
}

/**
 * Gehört der Eintrag der Vergangenheit an? Eine Person, die tot ist, und alles, dessen Ende
 * (gestorben, untergegangen, aufgelöst, zerstört) schon erreicht ist. Gezeigt wird es trotzdem –
 * nur für sich, nicht zwischen dem, was heute ist.
 */
export function isPast(data: CampaignData, entity: Entity): boolean {
  if (entity.past) return true;
  if (entity.kind === 'person' && entity.person.status === 'dead') return true;
  if (entity.kind === 'character' && entity.character.status === 'dead') return true;
  const end = endOf(data, entity);
  return !!end && end.at <= data.state.now;
}

/** Wann es zu Ende ging, in wenigen Worten („gestorben vor 300 Jahren“) – leer ohne Datum. */
export function pastLine(data: CampaignData, entity: Entity): string {
  const fact = lifeFacts(data, entity).find((f) => f.tone === 'danger');
  return fact ? `${fact.label.toLowerCase()} ${fact.text}` : '';
}

/** Was Lebensdaten über einen Eintrag sagen – für die Zeile unter dem Namen. */
export function lifeFacts(data: CampaignData, entity: Entity): LifeFact[] {
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const words = lifeWords(entity.kind);
  const born = entity.born;
  const ended = endOf(data, entity);
  const out: LifeFact[] = [];
  const about = (point: DatePoint) => (point.precision === 'year' ? 'etwa ' : '');
  if (born && born.at <= now) {
    // Ein Ende, das erst noch kommt, zählt noch nicht.
    if (ended && ended.at <= now && ended.at >= born.at) {
      const reached = yearsBetween(cal, born, ended.at, ended.precision);
      out.push({
        label: words.age,
        text:
          words === LIVING
            ? `${words.end === 'Gestorben' ? 'starb' : 'endete'} mit ${about(born)}${reached}`
            : `bestand ${about(born)}${yearsOld(reached)}`,
      });
    } else {
      const age = yearsBetween(cal, born, now);
      out.push({
        label: words.age,
        text:
          words === LIVING
            ? `${about(born)}${yearsOld(age)}`
            : `${about(born)}${yearsOld(age)} (${words.start.toLowerCase()} ${formatDatePoint(cal, born)})`,
      });
    }
  }
  if (ended && ended.at <= now) {
    const since = yearsBetween(cal, ended, now);
    const when =
      since === 0
        ? Math.floor((now - ended.at) / MINUTES_PER_DAY) < 1
          ? 'heute'
          : `seit ${formatDatePoint(cal, ended)}`
        : `vor ${about(ended)}${years(since)}`;
    out.push({ label: words.end, text: when, tone: 'danger' });
  }
  return out;
}
