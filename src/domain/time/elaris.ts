import type { CalendarDef } from './calendar';
import { toTime } from './calendar';

/**
 * Kalender von Elaris als Daten. Das absolute Jahr ist das „kosmische“ Jahr (JF);
 * die Hauptzeitrechnung AD liegt 27387 Jahre dahinter (701 AD = JF 28088).
 */
const ELARIS_BASE: Omit<CalendarDef, 'weekdayAnchor'> = {
  id: 'elaris',
  name: 'Kalender von Elaris',
  months: [
    { name: 'Tauwind', days: 31 },
    { name: 'Grünbruch', days: 28, leapDays: 1 },
    { name: 'Blüthain', days: 31 },
    { name: 'Sonnfeld', days: 30 },
    { name: 'Hochbrand', days: 31 },
    { name: 'Erntfall', days: 30 },
    { name: 'Dämmsturm', days: 31 },
    { name: 'Nebelruh', days: 31 },
    { name: 'Frostfall', days: 30 },
    { name: 'Eisbruch', days: 31 },
    { name: 'Glutnacht', days: 30 },
    { name: 'Sonnend', days: 31 },
  ],
  weekdays: ['Ruhnacht', 'Erdtag', 'Wassertag', 'Windtag', 'Feuertag', 'Schwerttag', 'Leuchtabend'],
  leapRule: 'gregorian',
  eras: [
    { id: 'ad', label: 'AD', offset: 27387 },
    { id: 'jf', label: 'JF', offset: 0 },
  ],
  moons: [
    { id: 'caldus', name: 'Caldus', period: 32976, anchor: 32760, color: '#e8dbc0' },
    { id: 'damaros', name: 'Damaros', period: 59040, anchor: 48240, color: '#adb5a5' },
  ],
};

/** Der 14. Blüthain 0 AD war ein Windtag. */
const anchorDay = Math.floor(
  toTime(
    { ...ELARIS_BASE, weekdayAnchor: { day: 0, weekday: 0 } },
    {
      year: 27387,
      month: 2,
      day: 14,
      hour: 0,
      minute: 0,
    },
  ) / 1440,
);

export const ELARIS_CALENDAR: CalendarDef = {
  ...ELARIS_BASE,
  weekdayAnchor: { day: anchorDay, weekday: 3 },
};

/** Stand der Kampagne beim Start von Wayfarer: 17. Tauwind 701 AD, 16:00. */
export const ELARIS_START = toTime(ELARIS_CALENDAR, {
  year: 701 + 27387,
  month: 0,
  day: 17,
  hour: 16,
  minute: 0,
});
