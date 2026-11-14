import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../data/db';
import { elarisCampaign } from '../data/seed';
import { MemoryStore } from '../data/store';
import {
  createClock,
  createCreature,
  createEncounter,
  createEntity,
  createEvent,
  createBastion,
  createHandout,
  createGuess,
  createLoot,
  createShop,
  createStock,
  createStory,
  createThread,
  createTrack,
} from '../domain/schema';
import { MINUTES_PER_DAY, dayIndexOf } from '../domain/time/calendar';
import { saveRun } from '../features/geschehen/actions';
import { createArticle } from '../features/wiki/actions';
import { searchWorld } from './search';

/** Eine erfundene Gegend rund um Hohenfurt, in der vieles „Aal“ im Namen trägt. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  for (const id of Object.keys(db.getSnapshot().events)) db.remove('events', id);
  const now = db.getSnapshot().state.now;
  const town = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const isle = db.put('entities', createEntity({ kind: 'place', name: 'Aalinsel' }));
  const guild = db.put('entities', createEntity({ kind: 'faction', name: 'Die Aalfischer' }));
  const story = db.put(
    'stories',
    createStory({ title: 'Die Aalfischer greifen nach dem Hafen', ownerId: guild.id }),
  );
  const thread = db.put(
    'threads',
    createThread({ title: 'Wer bezahlt den Aalwächter?', storyId: story.id }),
  );
  const loose = db.put('threads', createThread({ title: 'Das Licht auf der Aalinsel' }));
  const clock = db.put('clocks', createClock({ title: 'Der Aalzug beginnt', start: now }));
  const run = saveRun(db, {
    name: 'Salzkahn',
    fromId: town.id,
    toId: isle.id,
    start: now,
    every: { every: 5, unit: 'day' },
    carrier: 'Aalkutter',
    operatorId: null,
    stoppedAt: null,
    stopReason: '',
    note: '',
  });
  const market = db.put(
    'events',
    createEvent({
      title: 'Aalmarkt',
      at: now - 3 * MINUTES_PER_DAY,
      placeId: town.id,
      repeat: { every: 1, unit: 'week' },
    }),
  );
  const creature = db.put('creatures', createCreature({ name: 'Aalwächter' }));
  const encounter = db.put(
    'encounters',
    createEncounter({ name: 'Überfall am Aalsteg', placeId: town.id }),
  );
  const stock = db.put('stocks', createStock({ name: 'Nest der Moorhunde', placeId: isle.id }));
  const article = createArticle(db, { title: 'Vom Aalfang' })!;
  return {
    db,
    data: () => db.getSnapshot(),
    now,
    isle,
    story,
    thread,
    loose,
    clock,
    run,
    market,
    creature,
    encounter,
    stock,
    article,
  };
}

describe('Die Suche', () => {
  it('findet alles, was angelegt ist – nicht nur die Welt', async () => {
    const world = await setup();
    const hits = searchWorld(world.data(), 'aal');
    const sorts = new Set(hits.map((hit) => hit.sort));
    expect([...sorts].sort()).toEqual(
      [
        'article',
        'clock',
        'creature',
        'encounter',
        'entity',
        'event',
        'run',
        'story',
        'thread',
      ].sort(),
    );
    // Die Einträge der Welt stehen vorn.
    expect(hits[0]!.sort).toBe('entity');
    expect(searchWorld(world.data(), 'moorhund').map((hit) => hit.key)).toEqual([
      `stock:${world.stock.id}`,
    ]);
    expect(searchWorld(world.data(), '  ')).toEqual([]);
  });

  it('sagt, wohin ein Treffer führt und was die Seite zeigen soll', async () => {
    const world = await setup();
    const hit = (key: string) => searchWorld(world.data(), 'aal').find((h) => h.key === key)!;
    expect(hit(`creature:${world.creature.id}`).href).toBe(`/bestiarium/${world.creature.id}`);
    expect(hit(`encounter:${world.encounter.id}`)).toMatchObject({
      href: `/begegnungen/${world.encounter.id}`,
      sub: 'Begegnung · Hohenfurt',
    });
    // Eine Geschichte öffnet ihr Blatt.
    expect(hit(`story:${world.story.id}`)).toMatchObject({
      href: `/geschichte/${world.story.id}`,
      sub: 'Geschichte · Die Aalfischer',
    });
    // Ein Faden einer Geschichte liegt auf deren Karte, ein loser auf seiner eigenen.
    expect(hit(`thread:${world.thread.id}`).focus).toEqual({
      type: 'card',
      key: `story:${world.story.id}`,
    });
    expect(hit(`thread:${world.loose.id}`).focus).toEqual({
      type: 'card',
      key: `thread:${world.loose.id}`,
    });
    expect(hit(`clock:${world.clock.id}`).focus).toEqual({ type: 'clock', id: world.clock.id });
    // Der Ablauf wird über seinen Träger gefunden.
    expect(hit(`run:${world.run.id}`)).toMatchObject({
      href: '/geschehen',
      sub: 'Ablauf · Hohenfurt → Aalinsel · alle 5 Tage',
    });
    // Ein Termin, der sich wiederholt, führt zu seinem nächsten Mal.
    expect(hit(`event:${world.market.id}`).focus).toEqual({
      type: 'day',
      day: dayIndexOf(world.now) + 4,
    });
    expect(hit(`article:${world.article.id}`).href).toBe(`/wiki/${world.article.id}`);
  });

  it('stellt voran, was genau so heißt wie gesucht', async () => {
    const world = await setup();
    const hits = searchWorld(world.data(), 'Salzkahn');
    expect(hits[0]!.key).toBe(`run:${world.run.id}`);
    const exact = searchWorld(world.data(), 'aalinsel');
    expect(exact[0]).toMatchObject({ sort: 'entity', label: 'Aalinsel' });
  });

  it('findet Fortschrittsleisten, Handouts, Bastionen mit Einrichtungen und Beute', async () => {
    const world = await setup();
    const db = world.db;
    const track = db.put(
      'tracks',
      createTrack({ name: 'Schulden beim Aalhändler', ownerId: null }),
    );
    const letter = db.put(
      'handouts',
      createHandout({ kind: 'letter', title: '', text: 'Kommt allein zum Aalsteg.' }),
    );
    const keep = db.put(
      'bastions',
      createBastion({
        name: 'Burg Graufels',
        placeId: world.isle.id,
        facilities: [
          {
            id: 'f1',
            name: 'Aalräucherei',
            roomId: null,
            kind: 'special',
            ownerId: null,
            orders: [],
            hirelings: '',
            state: 'ready',
            trackId: null,
            order: null,
            notes: '',
          },
        ],
      }),
    );
    const loot = db.put('loot', createLoot({ text: 'Silberner Aalhaken', source: 'aus dem Nest' }));
    const guess = db.put(
      'guesses',
      createGuess({ text: 'Der Aalkönig lebt noch', truth: 'half', note: 'Nur halb' }),
    );
    const hits = searchWorld(world.data(), 'aal');
    const hit = (key: string) => hits.find((h) => h.key === key)!;
    expect(hit(`track:${track.id}`)).toMatchObject({
      href: '/fortschritt',
      sub: 'Fortschritt · Gruppe',
    });
    // Ein Handout ohne Titel heißt nach seiner Art und wird über seinen Wortlaut gefunden.
    expect(hit(`handout:${letter.id}`)).toMatchObject({
      label: 'Brief',
      focus: { type: 'handout', id: letter.id },
    });
    expect(hit('facility:f1')).toMatchObject({
      sub: 'Einrichtung · Burg Graufels',
      focus: { type: 'bastion', id: keep.id },
    });
    expect(hit(`loot:${loot.id}`)).toMatchObject({
      href: '/beute',
      sub: 'Beute · liegt bereit · aus dem Nest',
    });
    expect(hit(`guess:${guess.id}`)).toMatchObject({
      href: '/spielerbuch',
      sub: 'Vermutung · halb',
      focus: { type: 'guess', id: guess.id },
    });
    expect(searchWorld(world.data(), 'graufels')[0]).toMatchObject({
      key: `bastion:${keep.id}`,
      sub: 'Bastion · Aalinsel',
    });
  });

  it('findet Läden – nach Namen, Art und Waren', async () => {
    const world = await setup();
    const shop = world.db.put(
      'shops',
      createShop({
        title: 'Zum Rostigen Aal',
        kind: 'Krämer',
        placeId: world.isle.id,
        stock: [
          {
            id: 's1',
            entityId: null,
            text: 'Räucheraal',
            price: 0.5,
            qty: null,
            srdId: null,
            creatureId: null,
            unit: '',
          },
        ],
      }),
    );
    const hit = searchWorld(world.data(), 'rostigen')[0];
    expect(hit).toMatchObject({
      key: `shop:${shop.id}`,
      sort: 'shop',
      sub: 'Laden · Krämer · Aalinsel',
      href: `/welt/${world.isle.id}`,
      focus: { type: 'shop', id: shop.id },
    });
    expect(searchWorld(world.data(), 'räucheraal').map((h) => h.key)).toContain(`shop:${shop.id}`);
  });
});
