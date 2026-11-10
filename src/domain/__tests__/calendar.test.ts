import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatClock,
  fromTime,
  moonPhase,
  toTime,
  weekdayName,
  nextTimeOfDay,
  formatRelative,
  monthLength,
} from '../time/calendar';
import { ELARIS_CALENDAR as cal, ELARIS_START } from '../time/elaris';

const at = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  toTime(cal, { year: year + 27387, month, day, hour, minute });

describe('Kalender von Elaris', () => {
  it('rechnet den Startzeitpunkt wie die bisherige App', () => {
    // 17. Tauwind 701 AD, 16:00 – Wert der v157-Zeitrechnung (Minuten seit kosmischem Jahr 1).
    const before = (y: number) =>
      365 * (y - 1) +
      Math.floor((y - 1) / 4) -
      Math.floor((y - 1) / 100) +
      Math.floor((y - 1) / 400);
    expect(ELARIS_START).toBe((before(28088) + 16) * 1440 + 16 * 60);
    expect(formatDate(cal, ELARIS_START)).toBe('17. Tauwind 701 AD');
    expect(formatDate(cal, ELARIS_START, cal.eras[1])).toBe('17. Tauwind 28088 JF');
    expect(formatClock(ELARIS_START)).toBe('16:00');
    expect(weekdayName(cal, ELARIS_START)).toBe('Leuchtabend');
  });

  it('kennt den Wochentag des Ankers', () => {
    expect(weekdayName(cal, at(0, 2, 14))).toBe('Windtag');
  });

  it('wandelt hin und zurück, auch über Schaltjahre', () => {
    for (const [y, m, d] of [
      [0, 0, 1],
      [702, 1, 28],
      [701, 1, 29],
      [705, 11, 31],
      [1213, 6, 15],
    ] as const) {
      const p = fromTime(cal, at(y, m, d, 23, 59));
      expect([p.year - 27387, p.month, p.day, p.hour, p.minute]).toEqual([y, m, d, 23, 59]);
    }
    expect(monthLength(cal, 701 + 27387, 1)).toBe(29); // JF 28088 ist durch 4 teilbar
    expect(monthLength(cal, 702 + 27387, 1)).toBe(28);
    expect(() => at(702, 1, 29)).toThrow();
  });

  it('zeigt Monde: Caldus ist am 17. Tauwind 701 nahe Neumond', () => {
    const caldus = moonPhase(cal.moons[0]!, ELARIS_START);
    expect(caldus.label).toBe('Neumond');
    expect(caldus.nextFull).toBeGreaterThan(ELARIS_START);
    expect(moonPhase(cal.moons[0]!, caldus.nextFull).label).toBe('Vollmond');
  });

  it('findet den nächsten Morgen und beschreibt Abstände', () => {
    expect(formatClock(nextTimeOfDay(ELARIS_START, 6))).toBe('06:00');
    expect(nextTimeOfDay(ELARIS_START, 6) - ELARIS_START).toBe(14 * 60);
    expect(formatRelative(ELARIS_START, ELARIS_START + 2 * 1440)).toBe('in 2 Tagen');
    expect(formatRelative(ELARIS_START, ELARIS_START - 1440)).toBe('gestern');
    expect(formatRelative(ELARIS_START, ELARIS_START + 90)).toBe('in 1 Std. 30 Min.');
  });
});
