import { describe, expect, it } from 'vitest';
import { advanceTime } from '../data/actions';
import { CampaignDb } from '../data/db';
import { elarisCampaign } from '../data/seed';
import { MemoryStore } from '../data/store';
import { createClock, createEntity, createEvent, createTimer } from '../domain/schema';
import { meanwhile } from './meanwhile';

const DAY = 24 * 60;

/** Eine erfundene Welt: Die Gruppe ist in Hohenfurt; anderswo liegt Graufels. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  for (const id of Object.keys(db.getSnapshot().events)) db.remove('events', id);
  const now = db.getSnapshot().state.now;
  const land = db.put('entities', createEntity({ kind: 'place', name: 'Nordland' }));
  const town = db.put(
    'entities',
    createEntity({ kind: 'place', name: 'Hohenfurt', place: { parentId: land.id } }),
  );
  const harbour = db.put(
    'entities',
    createEntity({ kind: 'place', name: 'Hafen', place: { parentId: town.id } }),
  );
  const far = db.put('entities', createEntity({ kind: 'place', name: 'Graufels' }));
  db.setState({ placeId: town.id });
  const weekly = (title: string, placeId: string | null) =>
    db.put(
      'events',
      createEvent({ title, at: now + DAY, placeId, repeat: { every: 1, unit: 'day' } }),
    );
  return { db, now, land, town, harbour, far, weekly };
}

describe('Währenddessen', () => {
  it('stellt Uhren, Einmaliges und Abgelaufenes vor die Routinen', async () => {
    const { db, now, town, harbour, far, weekly } = await setup();
    weekly('Markttag', town.id);
    weekly('Die Seeschwalbe legt ab', harbour.id);
    weekly('Wachwechsel in Graufels', far.id);
    weekly('Glockenläuten', null);
    db.put('events', createEvent({ title: 'Die Brücke stürzt ein', at: now + 2 * DAY }));
    db.put('timers', createTimer({ label: 'Segen der Hirtin', start: now, end: now + DAY }));
    db.put(
      'clocks',
      createClock({
        title: 'Die Aalfischer übernehmen den Hafen',
        start: now,
        steps: [
          {
            id: 'a',
            text: 'Der alte Hafenmeister verschwindet',
            days: 2,
            delay: 0,
            at: null,
            skipped: false,
          },
        ],
      }),
    );
    const result = advanceTime(db, now + 3 * DAY);
    const view = meanwhile(db.getSnapshot(), result);
    expect(view.lines).toEqual([
      {
        text: 'Der alte Hafenmeister verschwindet (Die Aalfischer übernehmen den Hafen)',
        weight: 'main',
      },
      { text: 'Eingetreten: Die Brücke stürzt ein', weight: 'main' },
      { text: 'Abgelaufen: Segen der Hirtin', weight: 'main' },
      // Routinen am Ort der Gruppe – auch im Hafen der Stadt –, mit Anzahl.
      { text: 'Die Seeschwalbe legt ab (3×)', weight: 'side' },
      { text: 'Markttag (3×)', weight: 'side' },
    ]);
    // Was anderswo oder nirgends Bestimmtes geschieht, wird nur gezählt.
    expect(view.elsewhere).toBe(2);
  });

  it('zählt als „hier“ auch das Land, in dem die Gruppe ist', async () => {
    const { db, now, land, weekly } = await setup();
    weekly('Erntedank im Nordland', land.id);
    const view = meanwhile(db.getSnapshot(), advanceTime(db, now + DAY));
    expect(view).toEqual({
      lines: [{ text: 'Erntedank im Nordland', weight: 'side' }],
      elsewhere: 0,
    });
  });

  it('nennt Routinen anderswo einzeln, wenn sonst nichts geschah', async () => {
    const { db, now, far, weekly } = await setup();
    weekly('Wachwechsel in Graufels', far.id);
    const view = meanwhile(db.getSnapshot(), advanceTime(db, now + 2 * DAY));
    expect(view).toEqual({
      lines: [{ text: 'Wachwechsel in Graufels (2×)', weight: 'side' }],
      elsewhere: 0,
    });
  });

  it('kürzt lange Meldungen – das Wichtige bleibt vorn', async () => {
    const { db, now, town, weekly } = await setup();
    for (let i = 1; i <= 6; i++) weekly(`Routine ${i}`, town.id);
    db.put('events', createEvent({ title: 'Die Brücke stürzt ein', at: now + DAY }));
    const view = meanwhile(db.getSnapshot(), advanceTime(db, now + DAY), 3);
    expect(view.lines.map((line) => line.text)).toEqual([
      'Eingetreten: Die Brücke stürzt ein',
      'Routine 1',
      'Routine 2',
    ]);
    expect(view.elsewhere).toBe(4);
  });
});
