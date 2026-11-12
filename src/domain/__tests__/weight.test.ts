import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { gridSpans, spansBetween, splitDay } from '../../features/kalender/model';
import { buildAgenda } from '../../features/tisch/model';
import {
  createEntity,
  createEvent,
  createThread,
  type CalendarEvent,
  type Place,
  type Repeat,
} from '../schema';
import { MINUTES_PER_DAY, dayIndexOf } from '../time/calendar';
import { eventWeight, isNear } from '../weight';

/**
 * Erfundene Welt: Die Gruppe steht auf dem Markt von Graufels. Hohenfurt liegt woanders.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string, parentId: string | null = null) =>
    db.put('entities', createEntity({ kind: 'place', name, place: { parentId } })) as Place;
  const town = place('Graufels');
  const market = place('Markt', town.id);
  const gate = place('Nordtor', town.id);
  const far = place('Hohenfurt');
  db.setState({ placeId: market.id });
  const now = db.getSnapshot().state.now;
  const event = (
    title: string,
    repeat: Repeat | null,
    more: Partial<CalendarEvent> = {},
  ): CalendarEvent => db.put('events', createEvent({ title, at: now + 60, repeat, ...more }));
  const data = () => db.getSnapshot();
  const weight = (entry: CalendarEvent) => eventWeight(data(), data().events[entry.id]!);
  return { db, data, now, town, market, gate, far, event, weight };
}

const DAILY: Repeat = { every: 1, unit: 'day' };
const WEEKLY: Repeat = { every: 1, unit: 'week' };

describe('Wo die Gruppe ist', () => {
  it('der Ort selbst, alles darüber und alles darin', async () => {
    const { data, town, market, gate, far } = await setup();
    expect(isNear(data(), market.id)).toBe(true);
    expect(isNear(data(), town.id)).toBe(true);
    // Das Nordtor liegt in derselben Stadt, aber die Gruppe steht nicht dort.
    expect(isNear(data(), gate.id)).toBe(false);
    expect(isNear(data(), far.id)).toBe(false);
    expect(isNear(data(), null)).toBe(false);
  });
});

describe('Was in den Kalender gehört', () => {
  it('Einmaliges, Vorhaben, Fristen und Feste zählen immer', async () => {
    const { event, weight, far } = await setup();
    expect(weight(event('Der Graf trifft ein', null, { placeId: far.id }))).toBe('main');
    expect(weight(event('Wache schieben', DAILY, { kind: 'plan' }))).toBe('main');
    expect(weight(event('Schuld begleichen', null, { kind: 'deadline' }))).toBe('main');
    expect(weight(event('Erntefest', { every: 1, unit: 'year' }))).toBe('main');
    expect(weight(event('Zunftversammlung', { every: 1, unit: 'month' }))).toBe('main');
  });

  it('Wöchentliches zählt dort, wo die Gruppe ist – anderswo ist es Alltag', async () => {
    const { event, weight, town, far } = await setup();
    expect(weight(event('Markttag in Graufels', WEEKLY, { placeId: town.id }))).toBe('local');
    expect(weight(event('Markttag in Hohenfurt', WEEKLY, { placeId: far.id }))).toBe('everyday');
    expect(weight(event('Irgendwo ist Markt', WEEKLY))).toBe('everyday');
  });

  it('Tägliches ist Alltag – auch am Ort der Gruppe', async () => {
    const { event, weight, market } = await setup();
    expect(weight(event('Am Markt wird die Glocke geläutet', DAILY, { placeId: market.id }))).toBe(
      'everyday',
    );
  });

  it('der Spielleiter kann es je Termin anders festlegen', async () => {
    const { event, weight } = await setup();
    expect(weight(event('Die Gezeichneten ziehen um', DAILY, { weight: 'important' }))).toBe(
      'main',
    );
    expect(weight(event('Ein Händler kommt an', null, { weight: 'everyday' }))).toBe('everyday');
  });

  it('was an einem offenen Faden hängt, gehört zur Geschichte', async () => {
    const { db, event, weight } = await setup();
    const thread = db.put('threads', createThread({ title: 'Wer läutet nachts die Glocke?' }));
    const bell = event('Die Glocke läutet um Mitternacht', DAILY, { threadId: thread.id });
    expect(weight(bell)).toBe('story');
    // Ist der Faden gelöst, ist es wieder Alltag.
    db.patch('threads', thread.id, { state: 'solved' });
    expect(weight(bell)).toBe('everyday');
  });
});

describe('Der Kalender zeigt, was zählt', () => {
  it('das Raster lässt den Alltag weg und sagt, wie viel fehlt', async () => {
    const { data, event, now, far } = await setup();
    event('Der Graf trifft ein', null);
    event('Wachwechsel am Tor', DAILY);
    event('Fütterung der Echsen', DAILY);
    event('Markttag in Hohenfurt', WEEKLY, { placeId: far.id });
    const today = dayIndexOf(now);
    const spans = spansBetween(data(), today, today + 13);
    const grid = gridSpans(data(), spans);
    const titles = grid.spans.map((span) => span.event.title);
    expect(titles).toContain('Der Graf trifft ein');
    for (const title of ['Wachwechsel am Tor', 'Fütterung der Echsen', 'Markttag in Hohenfurt'])
      expect(titles).not.toContain(title);
    // Drei verschiedene Termine fehlen – nicht jedes ihrer vielen Vorkommen einzeln gezählt.
    expect(grid.hidden).toBe(3);
    expect(gridSpans(data(), spans, true).spans).toHaveLength(spans.length);
  });

  it('am Tag steht der Alltag getrennt – was hier geschieht, zuerst', async () => {
    const { data, event, now, market, far } = await setup();
    event('Der Graf trifft ein', null);
    event('Fütterung der Echsen', DAILY, { placeId: far.id });
    event('Am Markt wird die Glocke geläutet', DAILY, { placeId: market.id });
    const today = dayIndexOf(now);
    const day = splitDay(data(), spansBetween(data(), today, today), today);
    expect(day.main.map((span) => span.event.title)).toEqual(['Der Graf trifft ein']);
    expect(day.everyday.map((span) => span.event.title)).toEqual([
      'Am Markt wird die Glocke geläutet',
      'Fütterung der Echsen',
    ]);
  });

  it('unter „Anstehend“ am Spieltisch steht kein Alltag', async () => {
    const { data, event, now, town } = await setup();
    event('Der Graf trifft ein', null, { at: now + MINUTES_PER_DAY });
    event('Wachwechsel am Tor', DAILY);
    event('Markttag in Graufels', WEEKLY, { placeId: town.id });
    const titles = buildAgenda(data(), 7).map((item) => item.title);
    expect(titles).toContain('Der Graf trifft ein');
    expect(titles).toContain('Markttag in Graufels');
    expect(titles).not.toContain('Wachwechsel am Tor');
  });
});
