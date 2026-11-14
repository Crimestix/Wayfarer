/**
 * „Welt an einem Tag“: welcher Tag gemeint ist und bis zu welchem Augenblick gerechnet wird. Ein
 * Tag zählt bis zu seinem Ende – was an ihm geschah, gehört dazu –, nie über den heutigen
 * Augenblick der Welt hinaus. Die Welt selbst rechnet `worldOn` (`domain/worldAt.ts`).
 */
import { readDatePoint } from '../../domain/lifespan';
import {
  MINUTES_PER_DAY,
  dayIndexOf,
  fromTime,
  startOfDay,
  toTime,
  type CalendarDef,
  type WorldTime,
} from '../../domain/time/calendar';

/** Der Augenblick, bis zu dem für einen Tag gerechnet wird: sein Ende – heute: jetzt. */
export function dayEnd(day: WorldTime, now: WorldTime): WorldTime {
  return Math.min(now, startOfDay(day) + MINUTES_PER_DAY - 1);
}

/** Liest einen Tag aus Worten („3. Tauwind 650“, „Tauwind 650“, „650“) – bei Monat oder Jahr dessen ersten. */
export function readDay(cal: CalendarDef, text: string, now: WorldTime): WorldTime | null {
  const point = readDatePoint(cal, text, now);
  return point ? startOfDay(point.at) : null;
}

/** Ein Tag weiter oder zurück: um Tage oder um ganze Jahre (am selben Tag, so es ihn gibt). */
export function stepDay(
  cal: CalendarDef,
  day: WorldTime,
  by: number,
  unit: 'day' | 'year',
): WorldTime {
  if (unit === 'day') return Math.max(0, startOfDay(day) + by * MINUTES_PER_DAY);
  const d = fromTime(cal, day);
  const year = Math.max(1, d.year + by);
  const days = cal.months[d.month]?.days ?? 1;
  return startOfDay(
    toTime(cal, { year, month: d.month, day: Math.min(d.day, days), hour: 0, minute: 0 }),
  );
}

/** Liegt der Tag nach dem heutigen Tag der Welt? */
export const isAfterToday = (day: WorldTime, now: WorldTime): boolean =>
  dayIndexOf(day) > dayIndexOf(now);
