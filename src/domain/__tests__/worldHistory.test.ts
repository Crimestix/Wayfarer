/**
 * Die Geschichte der Welt in der Zeitleiste und die Zeitalter. Erfundene Welt: Burg Graufels,
 * gegründet um 401, fiel 650; Hohenfurt mit dem Brückenfest; die Salzsieder.
 */
import { describe, expect, it } from 'vitest';
import { emptyCampaign } from '../../data/seed';
import { agesAt, agesIn, agesSorted, readAge } from '../ages';
import {
  ArticleSchema,
  createChronicleEntry,
  createEntity,
  createEvent,
  createSession,
  type CampaignData,
  type Entity,
} from '../schema';
import { MINUTES_PER_DAY, fromTime, toTime } from '../time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../time/elaris';
import {
  laneChoices,
  laneOf,
  layoutLane,
  pieceWhen,
  thinPieces,
  THIN_KEEP,
  type TimelinePiece,
  type TimelineView,
} from '../timeline';
import { articleDates, campaignStart, sentenceAround } from '../worldHistory';

const DAY = MINUTES_PER_DAY;
const cal = ELARIS_CALENDAR;
const NOW = ELARIS_START;
/** Die Jahreszahl der Hauptzeitrechnung (AD) als Jahr des Kalenders. */
const ad = (shown: number) => shown + (fromTime(cal, NOW).year - 701);
const yearStart = (shown: number) =>
  toTime(cal, { year: ad(shown), month: 0, day: 1, hour: 0, minute: 0 });

const article = (title: string, text: string, extra: Record<string, unknown> = {}) =>
  ArticleSchema.parse({
    id: `a${title.replace(/\W/g, '').slice(0, 20)}`,
    title,
    docs: [{ id: 'd1', text }],
    ...extra,
  });

function world(init: Partial<CampaignData> = {}): CampaignData {
  const data = emptyCampaign('Testwelt', cal, NOW) as CampaignData;
  return { ...data, ...init };
}
const byId = <T extends { id: string }>(...docs: T[]) =>
  Object.fromEntries(docs.map((d) => [d.id, d]));

describe('Sätze aus dem Text', () => {
  it('nimmt den Satz um das Datum – Ordnungszahlen und Abkürzungen beenden keinen Satz', () => {
    const text =
      'Die Burg ist alt. Am 3. Tauwind 650 AD fiel sie nach z. B. drei Tagen. Danach kam Ruhe.';
    const at = text.indexOf('3. Tauwind');
    expect(sentenceAround(text, at, at + '3. Tauwind 650 AD'.length)).toBe(
      'Am 3. Tauwind 650 AD fiel sie nach z. B. drei Tagen.',
    );
  });

  it('bleibt in der Zeile, lässt Aufzählungszeichen weg und kürzt um das Datum', () => {
    const text = 'Erste Zeile\n- Im Jahr 401 legten Siedler den Grundstein\nDritte Zeile';
    const at = text.indexOf('Jahr 401');
    expect(sentenceAround(text, at, at + 8)).toBe('Im Jahr 401 legten Siedler den Grundstein');
    const before = 'Lange vorher wanderten Sippen durch das Tal und suchten Salz. ';
    const after = 'und dann geschah noch sehr viel mehr ';
    const long = `${before.repeat(4)}Erst 650 AD kam die Wende ${after.repeat(5)}.`;
    const pos = long.indexOf('650 AD');
    const short = sentenceAround(long, pos, pos + 6, 80);
    expect(short.length).toBeLessThanOrEqual(84);
    expect(short.startsWith('Erst 650 AD kam die Wende')).toBe(true);
    expect(short.endsWith(' …')).toBe(true);
    // Mitten in einem langen Satz: an beiden Seiten gekürzt, an Wortgrenzen.
    const middle = `${'und weiter '.repeat(20)}im Jahr 650 ${'und weiter '.repeat(20)}`;
    const inside = middle.indexOf('Jahr 650');
    const cut = sentenceAround(middle, inside, inside + 8, 60);
    expect(cut).toMatch(/^… und weiter .*Jahr 650.* und weiter …$/);
  });

  it('Daten im Artikel: mit Jahr, ohne Steckbrief, ohne Vorlagen', () => {
    const burg = article(
      'Burg Graufels',
      [
        '> [!steckbrief]',
        '> Gegründet: 401',
        '',
        'Die [[Burg Graufels]] fiel im **Jahr 650**. Am 3. Tauwind gibt es ein Fest.',
        '',
        '> [!geheim]',
        '> Seit Tauwind 652 AD wohnt dort ein Drache.',
      ].join('\n'),
    );
    const dates = articleDates(cal, burg);
    expect(dates.map((d) => d.precision)).toEqual(['year', 'month']);
    expect(dates[0]!.sentence).toBe('Die Burg Graufels fiel im Jahr 650.');
    expect(fromTime(cal, dates[0]!.at).year).toBe(ad(650));
    expect(dates[1]!.sentence).toBe('Seit Tauwind 652 AD wohnt dort ein Drache.');
    expect(articleDates(cal, { ...burg, template: true })).toEqual([]);
    // Derselbe Artikel wird nicht zweimal gelesen.
    expect(articleDates(cal, burg)).toBe(dates);
  });
});

describe('Geschichte der Welt', () => {
  const graufels: Entity = createEntity({
    kind: 'place',
    name: 'Burg Graufels',
    born: { at: yearStart(401), precision: 'year' },
    ended: { at: yearStart(650) + 40 * DAY, precision: 'month' },
  });
  const guild = createEntity({
    kind: 'faction',
    name: 'Salzsieder',
    born: { at: yearStart(612) + 3 * DAY, precision: 'day' },
  });
  const firstEvening = NOW - 10 * DAY;
  const data = world({
    entities: byId<Entity>(
      graufels,
      guild,
      createEntity({ kind: 'person', name: 'Mira Tannhaus' }),
    ),
    articles: byId(article('Hohenfurt', 'Seit dem Jahr 530 steht die Brücke von Hohenfurt.')),
    sessions: byId(createSession({ number: 1, startAt: firstEvening, endAt: firstEvening + DAY })),
    events: byId(
      createEvent({ title: 'Die Schlacht am Steg', at: yearStart(690) + 100 * DAY }),
      createEvent({ title: 'Markttag', at: NOW - 3 * DAY }),
    ),
    chronicle: byId(
      createChronicleEntry({
        kind: 'lore',
        at: yearStart(699),
        text: 'Die Salzsieder kaufen die Grotte',
        precision: 'day',
      }),
      createChronicleEntry({ kind: 'note', at: NOW - 5 * DAY, text: 'Am Tisch' }),
    ),
  });

  it('die Kampagne beginnt mit dem ersten Abend', () => {
    expect(campaignStart(data)).toBe(firstEvening);
    expect(campaignStart(world())).toBe(NOW);
  });

  it('Lebensdaten nie genauer als bekannt, Sätze aus Artikeln, Vorgeschichte', () => {
    const lane = laneOf(data, 'history', { from: 0, to: NOW })!;
    expect(lane.kind).toBe('history');
    expect(lane.title).toBe('Geschichte der Welt');
    const texts = lane.pieces.map((p) => p.text);
    expect(texts).toEqual([
      'Gegründet: Burg Graufels',
      'Seit dem Jahr 530 steht die Brücke von Hohenfurt.',
      'Gegründet: Salzsieder',
      'Untergegangen: Burg Graufels',
      'Die Schlacht am Steg',
      expect.stringContaining('Die Salzsieder kaufen die Grotte'),
    ]);
    const founded = lane.pieces[0]!;
    expect(founded.precision).toBe('year');
    expect(pieceWhen(cal, founded)).toBe('401 AD');
    expect(founded.weight).toBe(3);
    const fall = lane.pieces.find((p) => p.text.startsWith('Untergegangen'))!;
    expect(fall.tone).toBe('end');
    expect(fall.precision).toBe('month');
    const sentence = lane.pieces[1]!;
    expect(sentence.kind).toBe('text');
    expect(sentence.link).toEqual({ type: 'article', id: 'aHohenfurt' });
    expect(sentence.source).toBe('Hohenfurt');
    // Was am Tisch geschah und Termine seit dem ersten Abend gehören nicht dazu.
    expect(texts).not.toContain('Markttag');
    expect(texts).not.toContain('Am Tisch');
  });

  it('steht unter „Immer zur Hand“ zur Wahl', () => {
    expect(laneChoices(data).map((c) => c.key)).toContain('history');
  });
});

describe('Ausdünnen nach Gewicht', () => {
  const t0 = NOW;
  const mark = (key: string, at: number, weight: 1 | 2 | 3): TimelinePiece => ({
    key,
    kind: 'life',
    from: at,
    to: null,
    precision: 'exact',
    lo: at,
    hi: at,
    text: key,
    link: null,
    weight,
    tone: 'plain',
  });
  const v: TimelineView = { from: t0, mpp: 1, width: 1000 };

  it('behält in dichten Fächern die Schwersten, bis das Fach voll ist; lockere Stellen bleiben ganz', () => {
    const dense = [
      mark('a', t0 + 1, 3),
      mark('b', t0 + 2, 2),
      mark('c', t0 + 3, 1),
      mark('d', t0 + 4, 2),
      mark('e', t0 + 5, 3),
    ];
    const loose = [mark('f', t0 + 500, 1), mark('g', t0 + 503, 1)];
    const out = thinPieces([...dense, ...loose], v);
    // Zwei mit Gewicht 3, dazu eins der beiden mit Gewicht 2 – das Fach fasst drei.
    expect(out.pieces.map((p) => p.key)).toEqual(['a', 'd', 'e', 'f', 'g']);
    expect(out.hidden).toBe(2);
    // Herangezoomt liegen die Marken in eigenen Fächern – nichts fehlt.
    const near = thinPieces(dense, { ...v, mpp: 1 / 60 });
    expect(near.hidden).toBe(0);
    expect(near.pieces).toHaveLength(5);
  });

  it('ein einzelnes schweres Stück verdrängt nicht alle anderen', () => {
    const list = [
      mark('h', t0 + 1, 3),
      ...Array.from({ length: 9 }, (_, i) => mark(`l${i}`, t0 + 2 + i, 1)),
    ];
    const out = thinPieces(list, v);
    expect(out.pieces).toHaveLength(THIN_KEEP);
    expect(out.pieces.map((p) => p.key)).toContain('h');
    expect(out.hidden).toBe(list.length - THIN_KEEP);
  });

  it('bis zu THIN_KEEP Marken je Fach bleiben immer', () => {
    const few = Array.from({ length: THIN_KEEP }, (_, i) => mark(`m${i}`, t0 + i, 1));
    expect(thinPieces(few, v).pieces).toHaveLength(THIN_KEEP);
  });

  it('ganz herausgezoomt bleibt eine Bahn mit Tausenden Stücken leicht', () => {
    const many = Array.from({ length: 5000 }, (_, i) =>
      mark(`x${i}`, i * 365 * DAY, ((i % 3) + 1) as 1 | 2 | 3),
    );
    const view: TimelineView = { from: 0, mpp: 25 * 365 * DAY, width: 1400 };
    const thin = thinPieces(many, view);
    expect(thin.pieces.length).toBeLessThan(200);
    expect(thin.pieces.every((p) => p.weight === 3)).toBe(true);
    expect(layoutLane(thin.pieces, view).items.length).toBeGreaterThan(0);
  });
});

describe('Zeitalter', () => {
  it('liest Name, Beginn und Ende – leer heißt bis heute', () => {
    expect(readAge(cal, { name: ' ', from: '401', to: '' }, NOW)).toEqual({
      problem: expect.stringContaining('Namen'),
    });
    expect(readAge(cal, { name: 'Asche', from: 'irgendwann', to: '' }, NOW)).toMatchObject({
      problem: expect.stringContaining('Beginn'),
    });
    expect(readAge(cal, { name: 'Asche', from: '650', to: '401' }, NOW)).toMatchObject({
      problem: 'Das Ende liegt vor dem Beginn.',
    });
    const read = readAge(cal, { name: 'Zeitalter der Asche', from: '401', to: '650' }, NOW);
    expect(read).toMatchObject({ name: 'Zeitalter der Asche', from: { precision: 'year' } });
    expect(readAge(cal, { name: 'Neue Zeit', from: '650', to: '' }, NOW)).toMatchObject({
      to: null,
    });
  });

  it('ordnet, tönt abwechselnd und weiß, in welchem Zeitalter ein Tag liegt', () => {
    const data = world();
    data.campaign = {
      ...data.campaign,
      ages: [
        { id: 'neu', name: 'Neue Zeit', from: { at: yearStart(650), precision: 'year' }, to: null },
        {
          id: 'asche',
          name: 'Zeitalter der Asche',
          from: { at: yearStart(401), precision: 'year' },
          to: { at: yearStart(649), precision: 'year' },
        },
      ],
    };
    const sorted = agesSorted(data);
    expect(sorted.map((s) => [s.age.id, s.shade])).toEqual([
      ['asche', 0],
      ['neu', 1],
    ]);
    // Das Ende „649“ meint das ganze Jahr 649.
    expect(sorted[0]!.to).toBe(yearStart(650));
    expect(agesAt(data, yearStart(500)).map((s) => s.age.id)).toEqual(['asche']);
    expect(agesAt(data, NOW).map((s) => s.age.id)).toEqual(['neu']);
    expect(agesAt(data, yearStart(300))).toEqual([]);
    expect(agesIn(data, yearStart(600), yearStart(660)).map((s) => s.age.id)).toEqual([
      'asche',
      'neu',
    ]);
  });
});
