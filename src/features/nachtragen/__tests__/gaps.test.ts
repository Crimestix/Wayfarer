import { describe, expect, it } from 'vitest';
import {
  formatDate,
  fromTime,
  MINUTES_PER_DAY,
  type WorldTime,
} from '../../../domain/time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../../../domain/time/elaris';
import { daysWithin, gapAtStart } from '../gaps';
import { placeSessions, type PlaceData } from '../order';
import type { NotesFile } from '../read';
import { splitSessions } from '../split';

const cal = ELARIS_CALENDAR;
/** 17. Tauwind 701 AD, 16:00 */
const now = ELARIS_START;
const year = fromTime(cal, now).year;
const DAY = MINUTES_PER_DAY;
const day = (time: WorldTime) => formatDate(cal, time);

const gap = (text: string) => {
  const found = gapAtStart(cal, text, year);
  return found && { days: found.days, words: text.slice(found.from, found.to) };
};

describe('Zwischenzeit am Anfang einer Session', () => {
  it('liest Zahlen und Zahlwörter mit Tagen, Wochen und Monaten', () => {
    expect(gap('Sechs Wochen später treffen sie sich in Hohenfurt.')).toEqual({
      days: 42,
      words: 'Sechs Wochen später',
    });
    expect(gap('Downtime: 3 Tage\nMira näht.')).toEqual({ days: 3, words: 'Downtime: 3 Tage' });
    expect(gap('(Zwischenzeit von zwei Wochen)')).toEqual({
      days: 14,
      words: 'Zwischenzeit von zwei Wochen',
    });
    expect(gap('Nach einem Monat kehren sie zurück.')).toEqual({
      days: 31,
      words: 'Nach einem Monat',
    });
    expect(gap('Anderthalb Wochen vergehen.')).toEqual({
      days: 11,
      words: 'Anderthalb Wochen vergehen',
    });
  });

  it('kennt Zwischenzeit ohne Dauer und den nahtlosen Anschluss', () => {
    expect(gap('Downtime\nLando arbeitet in der Schmiede.')).toEqual({
      days: null,
      words: 'Downtime',
    });
    expect(gap('Am nächsten Morgen brechen sie auf.')).toEqual({
      days: 0,
      words: 'Am nächsten Morgen',
    });
  });

  it('nimmt nur den Anfang – und „insgesamt“ ist keine Zwischenzeit', () => {
    expect(gap('Insgesamt 5 Tage vergangen.')).toBeNull();
    expect(gap('Sie kämpfen.\nDrei Wochen später …')).toBeNull();
    expect(gap('Ein paar Tage später geht es weiter.')).toBeNull();
    expect(gap('Keine Woche später.')).toBeNull();
  });
});

describe('Tage innerhalb einer Session', () => {
  const within = (text: string) => daysWithin(cal, text, year, gapAtStart(cal, text, year)).days;

  it('zählt „Nächster Tag“ und „N Tage später“, „insgesamt“ setzt die Zahl', () => {
    expect(within('Sie reisen.')).toBe(1);
    expect(within('Ankunft.\nNächster Tag: Markt.\nAm nächsten Morgen weiter.')).toBe(3);
    expect(within('Ankunft.\nZwei Tage später der Zoll.')).toBe(3);
    expect(within('Viel los.\nInsgesamt 5 Tage vergangen.')).toBe(5);
  });

  it('zählt die Zwischenzeit am Anfang nicht mit', () => {
    expect(within('Drei Tage später: Ankunft in Hohenfurt.')).toBe(1);
  });
});

const txt = (text: string): NotesFile => ({
  name: 'notizen.txt',
  kind: 'txt',
  text,
  headings: [],
  encoding: 'utf-8',
});
const data: PlaceData = { campaign: { calendar: cal }, state: { now }, sessions: {} };

describe('Einordnen mit Zwischenzeiten', () => {
  it('legt Sessions vor einer langen Zwischenzeit entsprechend früher', () => {
    const notes = [
      'Session 1',
      'Ankunft in Hohenfurt.',
      'Session 2',
      'Die Krähenbande.',
      'Session 3',
      'Krummzahns Bau.',
      'Nächster Tag: Rückweg.',
      'Session 4',
      'Sechs Wochen später, am 1. Tauwind, Jahr 701, trifft man sich wieder.',
    ].join('\n');
    const placed = placeSessions(splitSessions([txt(notes)], cal, now), data);
    const s4 = placed[3]!;
    expect([s4.precision, day(s4.startAt)]).toEqual(['day', '1. Tauwind 701 AD']);
    const s3 = placed[2]!;
    // Session 3 endet sechs Wochen vor Session 4 und umfasst zwei Tage.
    expect(s4.startAt - s3.endAt).toBe(42 * DAY);
    expect(s3.endAt - s3.startAt).toBe(2 * DAY);
    expect(s3.precision).toBe('order');
    // Davor je ein Tag Abstand, wie ohne Zwischenzeit.
    expect(s3.startAt - placed[1]!.endAt).toBe(DAY);
    expect(placed[0]!.endAt).toBeLessThan(placed[1]!.startAt);
    expect(s4.notes.some((n) => n.includes('42 Tage Abstand'))).toBe(true);
  });

  it('reiht nach einer Session mit Tag ein und hält die Zwischenzeit', () => {
    const notes = [
      'Session 1',
      'Am 1. Tauwind, Jahr 701 in Hohenfurt.',
      'Session 2',
      'Downtime: eine Woche',
      'Mira näht.',
    ].join('\n');
    const placed = placeSessions(splitSessions([txt(notes)], cal, now), data);
    expect(day(placed[0]!.startAt)).toBe('1. Tauwind 701 AD');
    expect(placed[1]!.startAt - placed[0]!.endAt).toBe(7 * DAY);
    expect(placed[1]!.endAt).toBeLessThanOrEqual(now);
  });

  it('lässt Zwischenzeiten weg, wenn sie nicht vor den heutigen Stand passen', () => {
    const notes = [
      'Session 1',
      'Am 10. Tauwind, Jahr 701.',
      'Session 2',
      'Drei Wochen später …',
    ].join('\n');
    const placed = placeSessions(splitSessions([txt(notes)], cal, now), data);
    const s2 = placed[1]!;
    expect(s2.endAt).toBeLessThanOrEqual(now);
    expect(s2.notes.some((n) => n.includes('passen nicht'))).toBe(true);
  });

  it('nimmt eine von Hand gesetzte Weltzeit und reiht die anderen darum', () => {
    const notes = ['Session 1', 'Ankunft.', 'Session 2', 'Weiter.'].join('\n');
    const drafts = splitSessions([txt(notes)], cal, now);
    const start = now - 10 * DAY;
    const placed = placeSessions(drafts, data, {
      [drafts[1]!.key]: { startAt: start, endAt: start + 6 * 60 },
    });
    expect(placed[1]).toMatchObject({ precision: 'set', startAt: start, endAt: start + 360 });
    expect(placed[0]!.endAt).toBeLessThanOrEqual(start);
    expect(placed[0]!.precision).toBe('order');
  });
});
