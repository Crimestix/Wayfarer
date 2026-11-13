import { describe, expect, it } from 'vitest';
import { formatDate, toTime } from './calendar';
import { ELARIS_CALENDAR, ELARIS_START } from './elaris';
import { describeDate, findDates } from './textDates';

const cal = ELARIS_CALENDAR;
/** 17. Tauwind 701 AD, 16:00 */
const now = ELARIS_START;

const read = (text: string) =>
  findDates(cal, text, now).map((date) => [
    text.slice(date.from, date.to),
    date.precision,
    formatDate(cal, date.time),
    ...(date.assumedYear ? ['ohne Jahr'] : []),
  ]);

describe('Daten im Text erkennen', () => {
  it('liest Tag, Monat und Jahr in den Schreibweisen des Kalenders', () => {
    expect(read('Am 3. Blüthain 699 AD fiel die Brücke.')).toEqual([
      ['3. Blüthain 699 AD', 'day', '3. Blüthain 699 AD'],
    ]);
    // Ohne Zeitrechnung gilt die Hauptzeitrechnung, mit JF das kosmische Jahr.
    expect(read('Am 3.Blüthain 699 und am 1. Tauwind 28088 JF.')).toEqual([
      ['3.Blüthain 699', 'day', '3. Blüthain 699 AD'],
      ['1. Tauwind 28088 JF', 'day', '1. Tauwind 701 AD'],
    ]);
    // Ohne Jahr: das laufende Jahr der Kampagne.
    expect(read('Treffen am 20. Tauwind, mittags.')).toEqual([
      ['20. Tauwind', 'day', '20. Tauwind 701 AD', 'ohne Jahr'],
    ]);
  });

  it('liest Monat mit Jahr und Jahr mit Zeitrechnung', () => {
    expect(read('Im Hochbrand 650 begann die Dürre; sie endete 652 AD.')).toEqual([
      ['Hochbrand 650', 'month', '1. Hochbrand 650 AD'],
      ['652 AD', 'year', '1. Tauwind 652 AD'],
    ]);
  });

  it('liest das Jahr auch hinter dem Wort „Jahr“', () => {
    expect(read('Am 1. Tauwind, Jahr 699 kamen sie an.')).toEqual([
      ['1. Tauwind, Jahr 699', 'day', '1. Tauwind 699 AD'],
    ]);
    expect(read('Der 3. Blüthain im Jahr 700 AD und der 4. Blüthain Jahr 698')).toEqual([
      ['3. Blüthain im Jahr 700 AD', 'day', '3. Blüthain 700 AD'],
      ['4. Blüthain Jahr 698', 'day', '4. Blüthain 698 AD'],
    ]);
    expect(read('Im Hochbrand, Jahr 650 begann es; im Jahr 652 endete es.')).toEqual([
      ['Hochbrand, Jahr 650', 'month', '1. Hochbrand 650 AD'],
      ['Jahr 652', 'year', '1. Tauwind 652 AD'],
    ]);
    // Ein Komma ohne „Jahr“ trennt Tag und Zahl; „Jahr 3.5“ ist kein Jahr.
    expect(read('Am 20. Tauwind, 700 Mann. Jahr 3.5 der Regel.')).toEqual([
      ['20. Tauwind', 'day', '20. Tauwind 701 AD', 'ohne Jahr'],
    ]);
  });

  it('lässt in Ruhe, was kein Datum ist', () => {
    // Ein Monat hat keinen 31., eine bloße Zahl ist kein Jahr, ein Monatsname allein kein Datum.
    expect(read('Der 31. Sonnfeld, 700 Mann, im Tauwind, Kapitel 3. Tauwindig, 12ADX')).toEqual([]);
    expect(read('Kein Datum weit und breit.')).toEqual([]);
    // Der Schalttag gilt nur im Schaltjahr (701 AD ist das kosmische Jahr 28088).
    expect(read('29. Grünbruch 700 und 29. Grünbruch 701')).toEqual([
      ['29. Grünbruch 701', 'day', '29. Grünbruch 701 AD'],
    ]);
  });

  it('beschreibt ein Datum mit Wochentag und Abstand zu heute', () => {
    const [soon] = findDates(cal, '20. Tauwind', now);
    expect(describeDate(cal, now, soon!)).toBe(
      'Wassertag, 20. Tauwind 701 AD – in 3 Tagen (ohne Jahr geschrieben: als dieses Jahr gelesen)',
    );
    const [today] = findDates(cal, '17. Tauwind 701 AD', now);
    expect(describeDate(cal, now, today!)).toBe('Leuchtabend, 17. Tauwind 701 AD – heute');
    const [past] = findDates(cal, '16. Tauwind 701', now);
    expect(describeDate(cal, now, past!)).toMatch(/– gestern$/);
    const [month] = findDates(cal, 'Hochbrand 700', now);
    expect(describeDate(cal, now, month!)).toBe('Hochbrand 700 AD – vor 8 Monaten');
    // Weit Entferntes in Monaten, sehr weit Entferntes in Jahren.
    const [months] = findDates(cal, '3. Blüthain 700 AD', now);
    expect(describeDate(cal, now, months!)).toBe('Erdtag, 3. Blüthain 700 AD – vor 10 Monaten');
    const [long] = findDates(cal, 'Hochbrand 650', now);
    expect(describeDate(cal, now, long!)).toBe('Hochbrand 650 AD – vor rund 51 Jahren');
    const [year] = findDates(cal, '652 AD', now);
    expect(describeDate(cal, now, year!)).toBe('Jahr 652 AD – vor 49 Jahren');
    expect(toTime(cal, { year: 28088, month: 0, day: 17, hour: 16, minute: 0 })).toBe(now);
  });
});
