import { describe, expect, it } from 'vitest';
import type { CampaignData } from '../../../domain/schema';
import {
  formatDate,
  MINUTES_PER_DAY,
  startOfDay,
  type WorldTime,
} from '../../../domain/time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../../../domain/time/elaris';
import { placeSessions, type ExistingSessionLike, type PlaceData } from '../order';
import type { NotesFile } from '../read';
import { splitSessions } from '../split';

const cal = ELARIS_CALENDAR;
/** 17. Tauwind 701 AD, 16:00 */
const now = ELARIS_START;
const DAY = MINUTES_PER_DAY;

// Der Spielstand passt, ohne umgebaut zu werden.
export const fromCampaign = (data: CampaignData): PlaceData => data;

const txt = (text: string, name = 'notizen.txt'): NotesFile => ({
  name,
  kind: 'txt',
  text,
  headings: [],
  encoding: 'utf-8',
});

function data(sessions: ExistingSessionLike[] = []): PlaceData {
  return {
    campaign: { calendar: cal },
    state: { now },
    sessions: Object.fromEntries(sessions.map((s) => [s.id, s])),
  };
}

const session = (init: Partial<ExistingSessionLike> & { number: number; startAt: WorldTime }) => ({
  id: `s${init.number}`,
  title: '',
  realDate: '',
  endAt: null,
  notes: '',
  ...init,
});

const day = (time: WorldTime) => formatDate(cal, time);
const place = (text: string, sessions: ExistingSessionLike[] = []) =>
  placeSessions(splitSessions([txt(text)], cal, now), data(sessions));

describe('Sessions in die Weltzeit legen', () => {
  it('reiht Sessions ohne Tage vor den heutigen Stand – je ein Tag, ein Tag Abstand', () => {
    const placed = place('Session 1\nA\nSession 2\nB\nSession 3\nC');
    expect(placed.map((p) => [p.precision, day(p.startAt), p.endAt - p.startAt])).toEqual([
      ['order', '11. Tauwind 701 AD', DAY],
      ['order', '13. Tauwind 701 AD', DAY],
      ['order', '15. Tauwind 701 AD', DAY],
    ]);
    expect(placed[0]!.notes).toContain('Weltzeit unbekannt – vor Session 2 eingereiht.');
    expect(placed[2]!.notes).toContain(
      'Weltzeit unbekannt – vor dem heutigen Stand der Welt eingereiht.',
    );
    expect(placed.every((p) => p.endAt <= now && !p.squeezed)).toBe(true);
  });

  it('nimmt Tage des Kalenders aus dem Text und reiht dazwischen ein', () => {
    const placed = place(
      [
        'Session 1 – Ankunft in Hohenfurt',
        'Am 2. Tauwind 701 kommen sie an, am 3. Tauwind 701 treffen sie Mira Tannhaus.',
        'Session 2',
        'Lando Furtner verlangt Zoll.',
        'Session 3',
        'Am 10. Tauwind 701 in der Salzgrotte.',
      ].join('\n'),
    );
    expect(placed.map((p) => [p.precision, day(p.startAt), day(p.endAt - 1)])).toEqual([
      ['day', '2. Tauwind 701 AD', '3. Tauwind 701 AD'],
      ['order', '5. Tauwind 701 AD', '5. Tauwind 701 AD'],
      ['day', '10. Tauwind 701 AD', '10. Tauwind 701 AD'],
    ]);
    expect(placed[1]!.notes).toContain('Weltzeit unbekannt – nach Session 1 eingereiht.');
  });

  it('schiebt zusammen und meldet es, wenn zwischen zwei Tagen zu wenig Platz ist', () => {
    const placed = place(
      'Session 1\nAm 2. Tauwind 701.\nSession 2\nB\nSession 3\nC\nSession 4\nD\nSession 5\nAm 4. Tauwind 701.',
    );
    const middle = placed.slice(1, 4);
    expect(middle.every((p) => p.squeezed && p.precision === 'order')).toBe(true);
    expect(middle[0]!.notes.some((n) => n.includes('zu wenig Zeit für 3 Sessions'))).toBe(true);
    for (const p of middle) {
      expect(p.startAt).toBeGreaterThanOrEqual(placed[0]!.endAt);
      expect(p.endAt).toBeLessThanOrEqual(placed[4]!.startAt);
    }
    expect(middle[0]!.startAt).toBeLessThan(middle[1]!.startAt);
  });

  it('übergeht alte und künftige Tage im Text und sagt es', () => {
    const placed = place(
      'Session 4\nDie Brücke fiel am 3. Blüthain 699 AD. Am 5. Tauwind 701 und 6. Tauwind 701 in der Grotte; das Fest ist am 20. Tauwind 701.',
    );
    expect([day(placed[0]!.startAt), day(placed[0]!.endAt - 1)]).toEqual([
      '5. Tauwind 701 AD',
      '6. Tauwind 701 AD',
    ]);
    expect(placed[0]!.notes).toEqual([
      'Nicht als Zeit genommen, weil lange vor dem heutigen Stand der Welt: 3. Blüthain 699 AD.',
      'Nicht als Zeit genommen, weil nach dem heutigen Stand der Welt: 20. Tauwind 701 AD.',
    ]);
  });

  it('findet Sessions, die es schon gibt, und hält sich an ihre Zeit', () => {
    const existing2 = session({
      number: 2,
      title: 'Der Zoll der Aalfischer',
      startAt: startOfDay(now) - 10 * DAY,
      endAt: startOfDay(now) - 9 * DAY,
      notes: 'Lando  Furtner\nverlangt Zoll.',
    });
    const running = session({ number: 13, startAt: startOfDay(now) - 2 * DAY + 600 });
    const placed = place('Session 1\nA\nSession 2\nLando Furtner verlangt Zoll.\nSession 3\nC', [
      existing2,
      running,
    ]);
    expect(placed.map((p) => [p.precision, day(p.startAt), p.existing?.id ?? null])).toEqual([
      ['order', '5. Tauwind 701 AD', null],
      ['existing', '7. Tauwind 701 AD', 's2'],
      ['order', '9. Tauwind 701 AD', null],
    ]);
    expect(placed[1]!.existing).toMatchObject({ hasNotes: true, sameNotes: true });
    expect(placed[1]!.notes).toContain(
      'Gibt es schon: Session 2 „Der Zoll der Aalfischer“ – mit denselben Notizen.',
    );
    // Session 3 endet vor Session 13, die es schon gibt.
    expect(placed[2]!.endAt).toBeLessThanOrEqual(running.startAt);
  });

  it('meldet, wenn die Tage im Text der vorhandenen Session widersprechen', () => {
    const placed = place('Session 2\nAm 3. Tauwind 701.', [
      session({ number: 2, startAt: startOfDay(now) - 5 * DAY, notes: 'eigene' }),
    ]);
    expect(placed[0]!.precision).toBe('existing');
    expect(placed[0]!.notes).toContain('Gibt es schon: Session 2 – mit eigenen Notizen.');
    expect(placed[0]!.notes.some((n) => n.startsWith('Die Notizen nennen 3. Tauwind 701 AD'))).toBe(
      true,
    );
  });

  it('meldet Tage gegen die Reihenfolge und gibt dem Vorspann keine eigene Zeit', () => {
    const placed = place('Vorrede\nSession 1\nAm 9. Tauwind 701.\nSession 2\nAm 4. Tauwind 701.');
    expect(placed[0]!.draft.vorspann).toBe(true);
    expect(placed[0]!.startAt).toBe(placed[1]!.startAt);
    expect(placed[0]!.endAt).toBe(placed[0]!.startAt);
    expect(placed[2]!.notes).toContain('Laut Weltzeit vor Session 1 – stimmt die Reihenfolge?');
  });

  it('findet eine Session ohne Nummer über das echte Datum', () => {
    const placed = place('12.04.2026\nAnkunft.', [
      session({ number: 1, realDate: '2026-04-12', startAt: startOfDay(now) - 7 * DAY }),
    ]);
    expect(placed[0]!.existing?.id).toBe('s1');
  });
});
