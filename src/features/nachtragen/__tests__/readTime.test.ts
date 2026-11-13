/** Zeit beim Lesen: Angaben im Text, Verteilen über die Session. */
import { describe, expect, it } from 'vitest';
import { dayIndexOf, minuteOfDay } from '../../../domain/time/calendar';
import { ELARIS_CALENDAR as CAL } from '../../../domain/time/elaris';
import { spreadTimes, timeMarks } from '../readTime';
import { NOW, at } from './readWorld';

const START = at(3, 1, 701, 9);

describe('Zeitangaben im Text', () => {
  it('erkennt nächsten Tag, Uhrzeit, Tageszeit, Tage später und Insgesamt', () => {
    const text =
      'Mittags Ankunft. Nächster Tag. 8:30 Uhr Frühstück. abends Fest. Zwei Tage später Aufbruch. Insgesamt 5 Tage vergangen.';
    expect(timeMarks(CAL, text, START).map((m) => m.kind)).toEqual([
      'clock',
      'nextDay',
      'clock',
      'clock',
      'days',
      'total',
    ]);
  });

  it('liest ein Datum mit Uhrzeit des Kalenders', () => {
    const [mark] = timeMarks(CAL, 'Stand: 5. Tauwind, 14:00', START);
    expect(mark).toMatchObject({
      kind: 'date',
      day: dayIndexOf(at(5, 1, 701)),
      clock: 14 * 60,
    });
  });

  it('nimmt Jahreszahlen der Geschichte und Künftiges nicht als Zeit', () => {
    expect(timeMarks(CAL, 'Das Grab stammt aus dem Jahr 650.', START)).toEqual([]);
    expect(timeMarks(CAL, 'Er soll morgen um 8 Uhr kommen.', START)).toEqual([]);
  });
});

describe('Verteilen über die Session', () => {
  const session = { startAt: START, endAt: at(6, 1, 701, 22), precision: 'exact' as const };

  it('ohne Angaben: gleichmäßig, nur die Reihenfolge', () => {
    const times = spreadTimes(CAL, session, 'Brann kam. Mira ging. Lando blieb.', [0, 11, 22], NOW);
    expect(times.every((t) => t.precision === 'order')).toBe(true);
    expect(times[0]!.at).toBeGreaterThan(session.startAt);
    expect(times[2]!.at).toBeLessThan(session.endAt);
    expect(times[0]!.at).toBeLessThan(times[1]!.at);
  });

  it('mit Angaben: Tag und Uhrzeit, ungefähr', () => {
    const text = 'Ankunft.\nNächster Tag.\n8 Uhr - Brann kämpft.\nabends - Fest.';
    const offsets = [0, text.indexOf('Brann'), text.indexOf('Fest')];
    const [first, fight, feast] = spreadTimes(CAL, session, text, offsets, NOW);
    expect(first!.at).toBe(START);
    expect(dayIndexOf(fight!.at)).toBe(dayIndexOf(START) + 1);
    expect(minuteOfDay(fight!.at)).toBe(8 * 60);
    expect(minuteOfDay(feast!.at)).toBe(19 * 60);
    expect(fight!.precision).toBe('approx');
  });

  it('ein Datum mit Uhrzeit ist genau', () => {
    const text = 'Erst Gerede.\n5. Tauwind, 14:00\nBrann schläft.';
    const [, sleep] = spreadTimes(CAL, session, text, [0, text.indexOf('Brann')], NOW);
    expect(sleep).toEqual({ at: at(5, 1, 701, 14), precision: 'exact' });
  });

  it('schiebt zu viele Tage in die Session und bleibt in der Reihenfolge', () => {
    const short = { startAt: START, endAt: at(3, 1, 701, 22), precision: 'exact' as const };
    const text = 'A.\nNächster Tag.\nB.\nNächster Tag.\nC.\nInsgesamt 5 Tage vergangen.';
    const offsets = [0, text.indexOf('B.'), text.indexOf('C.')];
    const times = spreadTimes(CAL, short, text, offsets, NOW);
    expect(times.map((t) => t.at)).toEqual([...times.map((t) => t.at)].sort((a, b) => a - b));
    for (const t of times) {
      expect(t.at).toBeGreaterThanOrEqual(short.startAt);
      expect(t.at).toBeLessThanOrEqual(short.endAt);
    }
    expect(times[1]!.at).toBeGreaterThan(times[0]!.at);
  });

  it('nie nach jetzt', () => {
    const open = { startAt: NOW - 60, endAt: null, precision: 'exact' as const };
    const text = 'A.\nNächster Tag.\nB.';
    const times = spreadTimes(CAL, open, text, [0, text.indexOf('B.')], NOW);
    expect(times.every((t) => t.at <= NOW)).toBe(true);
  });

  it('übernimmt eine ungenaue Session als ungefähr bzw. Reihenfolge', () => {
    const loose = { ...session, precision: 'order' as const };
    const text = 'A.\nNächster Tag.\nB.';
    const [, b] = spreadTimes(CAL, loose, text, [0, text.indexOf('B.')], NOW);
    expect(b!.precision).toBe('order');
  });
});
