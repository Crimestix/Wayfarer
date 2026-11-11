import { describe, expect, it } from 'vitest';
import { ELARIS_CALENDAR, ELARIS_START } from '../../domain/time/elaris';
import {
  lkDate,
  lkLeap,
  monthMap,
  planTimeline,
  yearOffset,
  type LkCalendar,
  type LkTimelineEvent,
} from './timeline';

/** Ein Kalender, wie ihn der Export beschreibt: dieselben Monate wie Wayfarers Kalender. */
const calendar = (id: string, abbr: string, more: Partial<LkCalendar> = {}): LkCalendar => ({
  id,
  name: `Kalender ${abbr}`,
  hasZeroYear: false,
  hoursInDay: 24,
  minutesInHour: 60,
  months: ELARIS_CALENDAR.months.map((month) => ({ name: month.name, length: month.days })),
  leapDays: [{ month: 1, interval: '400,!100,4' }],
  eras: [{ abbr, startsAt: 0, resets: false }],
  ...more,
});
const DAY = 24 * 60;
const event = (
  id: string,
  calendarId: string,
  start: number,
  more: Partial<LkTimelineEvent> = {},
) =>
  ({
    id,
    name: `Ereignis ${id}`,
    calendarId,
    start,
    end: null,
    detail: 3,
    articleId: 'chronik',
    linkedArticleId: null,
    ...more,
  }) satisfies LkTimelineEvent;

describe('Zeitleisten aus dem Export', () => {
  it('kennt die Schaltregel „400,!100,4“', () => {
    expect(lkLeap('400,!100,4', 2000)).toBe(true);
    expect(lkLeap('400,!100,4', 1900)).toBe(false);
    expect(lkLeap('400,!100,4', 1904)).toBe(true);
    expect(lkLeap('400,!100,4', 1901)).toBe(false);
    expect(lkLeap('', 4)).toBe(false);
  });

  it('rechnet Minuten in ein Datum des Kalenders um', () => {
    const cal = calendar('a', 'AD');
    expect(lkDate(cal, 0)).toEqual({ year: 1, month: 0, day: 1, hour: 0, minute: 0 });
    expect(lkDate(cal, 31 * DAY + 90)).toEqual({ year: 1, month: 1, day: 1, hour: 1, minute: 30 });
    // Das Jahr 1 hat 365 Tage, das Jahr 4 einen Schalttag im zweiten Monat.
    expect(lkDate(cal, 365 * DAY)).toMatchObject({ year: 2, month: 0, day: 1 });
    expect(lkDate(cal, (3 * 365 + 31 + 28) * DAY)).toMatchObject({ year: 4, month: 1, day: 29 });
    // Vor dem Beginn: Auf das Jahr 1 folgt rückwärts das Jahr −1.
    expect(lkDate(cal, -DAY)).toMatchObject({ year: -1, month: 11, day: 31 });
  });

  it('ordnet die Jahre über eine gemeinsame Zeitrechnung zu', () => {
    expect(yearOffset(calendar('a', 'AD'), ELARIS_CALENDAR)).toBe(27387);
    expect(yearOffset(calendar('j', 'jf'), ELARIS_CALENDAR)).toBe(0);
    expect(yearOffset(calendar('s', 'SK'), ELARIS_CALENDAR)).toBeNull();
    // Beginnt die Zählung mit einer Zeitrechnung neu, ist die Zuordnung nicht eindeutig.
    const resets = calendar('r', 'AD', { eras: [{ abbr: 'AD', startsAt: 0, resets: true }] });
    expect(yearOffset(resets, ELARIS_CALENDAR)).toBeNull();
    expect(monthMap(calendar('a', 'AD'), ELARIS_CALENDAR)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    const other = calendar('o', 'AD', { months: [{ name: 'Nebelmond', length: 30 }] });
    expect(monthMap(other, ELARIS_CALENDAR)).toBeNull();
  });

  it('macht aus Ereignissen Termine in Wayfarers Kalender', () => {
    const ad = calendar('ad', 'AD');
    const cosmic = calendar('jf', 'JF');
    const unknown = calendar('sk', 'SK', { name: 'Kriegskalender' });
    // 17. Tauwind 701 AD, 16:00 – im AD-Kalender des Exports: 700 Jahre mit 169 Schalttagen.
    const start = (700 * 365 + 169 + 16) * DAY + 16 * 60;
    const plan = planTimeline(
      ELARIS_CALENDAR,
      [ad, cosmic, unknown],
      [
        event('a', 'ad', start, { detail: 4, linkedArticleId: 'hohenfurt' }),
        // Der kosmische Kalender zählt wie Wayfarer selbst: dieselbe Minutenzahl.
        event('b', 'jf', ELARIS_START - 5 * DAY, { end: ELARIS_START - 2 * DAY }),
        event('c', 'jf', 1000 * DAY, { end: 1000 * DAY + 400 * 366 * DAY, detail: 1 }),
        event('d', 'sk', 0),
        event('e', 'jf', -10 * DAY),
        event('f', 'fehlt', 0),
      ],
      (id) => ({ chronik: 'Chronik von Hohenfurt', hohenfurt: 'Hohenfurt' })[id],
    );
    expect(plan.events.map((e) => e.id)).toEqual(['lk-zeit-c', 'lk-zeit-b', 'lk-zeit-a']);
    const [long, short, exact] = plan.events;
    expect(exact).toMatchObject({ at: ELARIS_START, timed: true, durationDays: null });
    expect(exact!.details).toBe(
      'Aus der Zeitleiste von „Chronik von Hohenfurt“. Artikel: Hohenfurt.',
    );
    expect(short).toMatchObject({ at: ELARIS_START - 5 * DAY, timed: false, durationDays: 3 });
    // Ein Zeitalter steht nicht als Dauer im Kalender, sondern als Satz im Termin.
    expect(long!.durationDays).toBeNull();
    expect(long!.details).toContain('Dauert bis zum ');
    expect(plan.unknown).toEqual([
      { calendar: 'Kriegskalender', events: 1 },
      { calendar: 'ohne Namen', events: 1 },
    ]);
    expect(plan.tooEarly).toBe(1);
  });
});
