import { describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY, fromTime, startOfDay } from '../../domain/time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../../domain/time/elaris';
import { dayEnd, isAfterToday, readDay, stepDay } from './model';

const cal = ELARIS_CALENDAR;
const NOW = ELARIS_START;

describe('Welt an einem Tag: welcher Augenblick', () => {
  it('ein Tag zählt bis zu seinem Ende – heute bis jetzt', () => {
    const before = startOfDay(NOW) - 3 * MINUTES_PER_DAY;
    expect(dayEnd(before + 600, NOW)).toBe(before + MINUTES_PER_DAY - 1);
    expect(dayEnd(startOfDay(NOW), NOW)).toBe(NOW);
    expect(isAfterToday(NOW + MINUTES_PER_DAY, NOW)).toBe(true);
    expect(isAfterToday(startOfDay(NOW), NOW)).toBe(false);
  });

  it('liest Tage, Monate und Jahre – und blättert um Tage und Jahre', () => {
    const day = readDay(cal, '3. Tauwind 650', NOW)!;
    expect(fromTime(cal, day)).toMatchObject({ day: 3, hour: 0, minute: 0 });
    expect(fromTime(cal, readDay(cal, '650', NOW)!)).toMatchObject({ month: 0, day: 1 });
    expect(readDay(cal, 'irgendwann', NOW)).toBeNull();
    expect(stepDay(cal, day, 1, 'day') - day).toBe(MINUTES_PER_DAY);
    const later = fromTime(cal, stepDay(cal, day, 10, 'year'));
    expect(later.year - fromTime(cal, day).year).toBe(10);
    expect(later.day).toBe(3);
  });
});
