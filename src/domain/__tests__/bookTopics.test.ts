import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { bookEntries, emptyBook, topicListing, type BookItem } from '../book';
import {
  bookRules,
  bookTopics,
  emptyTopic,
  legacyRules,
  topicEntries,
  topicLabel,
  type BookTopic,
} from '../bookTopics';
import { ArticleSchema, createEntity, type Book, type Entity } from '../schema';

/**
 * Hohenfurt mit der Salzgrotte (und einem Keller als Raum), Burg Graufels; Kräuter, ein Erz,
 * Krummzahn und Mira Tannhaus; Artikel in den Ordnern „Welt › Kräuter“ und „Welt › Leute“ –
 * alles erfunden.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const put = (init: Parameters<typeof createEntity>[0]) => db.put('entities', createEntity(init));
  const article = (id: string, title: string, extra: Record<string, unknown> = {}) =>
    db.put('articles', ArticleSchema.parse({ id, title, ...extra }));
  article('art-welt', 'Welt');
  article('art-kraeuter', 'Kräuter', { parentId: 'art-welt' });
  article('art-leute', 'Leute', { parentId: 'art-welt' });
  article('art-feuerkraut', 'Feuerkraut', { parentId: 'art-kraeuter', tags: ['Heilkunde'] });
  article('art-mira', 'Mira Tannhaus', { parentId: 'art-leute', hidden: true });
  article('art-vorlage', 'Vorlage', { template: true });
  const link = (id: string, title: string) => ({ lk: { resourceId: id, title } });

  const town = put({ kind: 'place', name: 'Hohenfurt' });
  const grotto = put({ kind: 'place', name: 'Salzgrotte', place: { parentId: town.id } });
  const cellar = put({
    kind: 'place',
    name: 'Keller',
    place: { parentId: grotto.id, room: true },
  });
  const castle = put({ kind: 'place', name: 'Burg Graufels' });
  const fire = put({
    kind: 'plant',
    name: 'Feuerkraut',
    tags: ['giftig'],
    ...link('art-feuerkraut', 'Feuerkraut'),
    plant: { category: 'Kraut', regionIds: [grotto.id] },
  });
  const moss = put({
    kind: 'plant',
    name: 'Moosling',
    aliases: ['Grottenmoos'],
    tags: ['GIFTIG'],
    plant: { category: 'Pilz', regionIds: [town.id] },
  });
  const thistle = put({
    kind: 'plant',
    name: 'Graudistel',
    plant: { category: 'Kraut', regionIds: [castle.id] },
  });
  const ore = put({ kind: 'mineral', name: 'Eisenerz', mineral: { category: 'Erz' } });
  const krummzahn = put({ kind: 'person', name: 'Krummzahn', person: { placeId: grotto.id } });
  const mira = put({ kind: 'person', name: 'Mira Tannhaus', ...link('art-mira', 'Mira Tannhaus') });
  const book = put({
    kind: 'item',
    name: 'Grünes Buch',
    item: { category: 'Buch', book: emptyBook() },
  });
  const data = () => db.getSnapshot();
  const setBook = (change: Partial<Book>) => {
    const current = data().entities[book.id] as BookItem;
    db.put('entities', {
      ...current,
      item: { ...current.item, book: { ...current.item.book, ...change } },
    });
  };
  const bookNow = () => data().entities[book.id] as BookItem;
  return {
    db,
    data,
    setBook,
    bookNow,
    town,
    grotto,
    cellar,
    castle,
    fire,
    moss,
    thistle,
    ore,
    krummzahn,
    mira,
    book,
  };
}

const names = (list: Entity[]) => list.map((entity) => entity.name);
const topic = (change: Partial<BookTopic>): BookTopic => ({ ...emptyTopic(), ...change });

describe('Themen zum Durchsehen', () => {
  it('zählt Arten ohne Räume, kennt Einordnungen und Schlagworte der gewählten Art', async () => {
    const w = await setup();
    const all = bookTopics(w.data());
    // Der Grundstand bringt die Gefährten mit.
    expect(all.kinds.filter((k) => k.kind !== 'character')).toEqual([
      { kind: 'person', count: 2 },
      { kind: 'place', count: 3 },
      { kind: 'item', count: 1 },
      { kind: 'plant', count: 3 },
      { kind: 'mineral', count: 1 },
    ]);
    const plants = bookTopics(w.data(), 'plant');
    expect(plants.categories).toEqual([
      { label: 'Kraut', count: 2 },
      { label: 'Pilz', count: 1 },
    ]);
    // Schlagworte des Eintrags und seines Artikels, ohne Rücksicht auf Groß- und Kleinschreibung.
    expect(plants.tags).toEqual([
      { label: 'giftig', count: 2 },
      { label: 'Heilkunde', count: 1 },
    ]);
    expect(bookTopics(w.data(), 'mineral').categories).toEqual([{ label: 'Erz', count: 1 }]);
    expect(all.categories.map((c) => c.label)).toContain('Buch');
  });

  it('kennt Gegenden mit Orten darunter und Ordner mit Einträgen – wie in den Bäumen', async () => {
    const w = await setup();
    const { regions, folders } = bookTopics(w.data());
    // Jeder Ort ist eine Gegend – auch die Salzgrotte mit nur einem Raum darunter; Räume nicht.
    expect(regions).toEqual([
      { id: w.castle.id, name: 'Burg Graufels', depth: 0 },
      { id: w.town.id, name: 'Hohenfurt', depth: 0 },
      { id: w.grotto.id, name: 'Salzgrotte', depth: 1 },
    ]);
    expect(folders.map((f) => [f.title, f.path, f.count])).toEqual([
      ['Welt', [], 2],
      ['Kräuter', ['Welt'], 1],
      ['Leute', ['Welt'], 1],
    ]);
  });

  it('findet die Einträge eines Themas – ohne Räume und ohne das Buch selbst', async () => {
    const w = await setup();
    const of = (change: Partial<BookTopic>) =>
      names(topicEntries(w.data(), topic(change), w.book.id));
    expect(of({ kind: 'plant', category: ' kraut ' })).toEqual(['Feuerkraut', 'Graudistel']);
    expect(of({ tag: 'Giftig' })).toEqual(['Feuerkraut', 'Moosling']);
    expect(of({ tag: 'heilkunde' })).toEqual(['Feuerkraut']);
    expect(of({ regionId: w.town.id })).toEqual([
      'Feuerkraut',
      'Hohenfurt',
      'Krummzahn',
      'Moosling',
      'Salzgrotte',
    ]);
    expect(of({ regionId: w.town.id, kind: 'person' })).toEqual(['Krummzahn']);
    expect(of({ folderId: 'art-welt' })).toEqual(['Feuerkraut', 'Mira Tannhaus']);
    expect(of({ folderId: 'art-kraeuter' })).toEqual(['Feuerkraut']);
    expect(of({ regionId: 'gibt-es-nicht' })).toEqual([]);
    expect(of({ kind: 'item' })).toEqual([]);
    const everything = of({});
    expect(everything).not.toContain('Keller');
    expect(everything).not.toContain('Grünes Buch');
    const characters = Object.values(w.data().entities).filter((e) => e.kind === 'character');
    expect(everything).toHaveLength(9 + characters.length);
  });

  it('liest die ältere Regel als Verbindungen aus Art, Gegend und Einordnung', () => {
    const selection = {
      ...emptyBook().selection,
      kinds: ['plant', 'mineral'] as const,
      categories: ['Kraut', ' ', 'kraut'],
      regionIds: ['ort-a'],
    };
    const rules = legacyRules({ ...selection, kinds: [...selection.kinds] });
    expect(rules).toEqual([
      topic({ kind: 'plant', regionId: 'ort-a', category: 'Kraut' }),
      topic({ kind: 'mineral', regionId: 'ort-a', category: 'Kraut' }),
    ]);
    expect(legacyRules(emptyBook().selection)).toEqual([]);
    // Doppeltes und Leeres zählt nicht.
    expect(
      bookRules({
        ...emptyBook().selection,
        kinds: ['plant'],
        rules: [topic({ kind: 'plant' }), topic({}), topic({ kind: 'plant' })],
      }),
    ).toEqual([topic({ kind: 'plant' })]);
  });

  it('nimmt Räume nicht über ein Thema ins Buch, aber einzeln', async () => {
    const w = await setup();
    w.setBook({
      selection: { ...emptyBook().selection, regionIds: [w.grotto.id], kinds: ['place'] },
    });
    expect(names(bookEntries(w.data(), w.bookNow()))).toEqual(['Salzgrotte']);
    w.setBook({
      selection: {
        ...emptyBook().selection,
        rules: [topic({ kind: 'place', regionId: w.grotto.id })],
        include: [w.cellar.id],
      },
    });
    expect(names(bookEntries(w.data(), w.bookNow()))).toEqual(['Keller', 'Salzgrotte']);
  });
});

describe('Ein Thema durchsehen', () => {
  it('nennt ein Thema in Worten', async () => {
    const w = await setup();
    expect(topicLabel(w.data(), emptyTopic())).toBe('Alles');
    expect(
      topicLabel(
        w.data(),
        topic({
          kind: 'plant',
          category: 'Kraut',
          tag: 'giftig',
          regionId: w.town.id,
          folderId: 'art-kraeuter',
        }),
      ),
    ).toBe('Pflanzen · Kraut · „giftig“ · in Hohenfurt · Ordner Kräuter');
  });

  it('zeigt ohne Thema und Suche nichts', async () => {
    const w = await setup();
    const listing = topicListing(w.data(), w.bookNow(), emptyTopic());
    expect(listing).toMatchObject({
      idle: true,
      total: 0,
      groups: [],
      elsewhere: [],
      elsewhereByRule: 0,
    });
  });

  it('gruppiert nach Einordnung, kreuzt an, was im Buch steht, und nennt den Rest', async () => {
    const w = await setup();
    w.setBook({
      selection: {
        ...emptyBook().selection,
        rules: [topic({ kind: 'plant', category: 'Kraut' })],
        include: [w.moss.id, w.krummzahn.id],
        exclude: [w.thistle.id],
      },
    });
    const listing = topicListing(w.data(), w.bookNow(), topic({ kind: 'plant' }));
    expect(
      listing.groups.map((g) => [g.label, g.rows.map((r) => [r.entity.name, r.inBook, r.byRule])]),
    ).toEqual([
      [
        'Kraut',
        [
          ['Feuerkraut', true, true],
          ['Graudistel', false, true],
        ],
      ],
      ['Pilz', [['Moosling', true, false]]],
    ]);
    expect(listing).toMatchObject({ idle: false, total: 3, inBook: 2, ruleOn: false });
    expect(names(listing.elsewhere)).toEqual(['Krummzahn']);
    // Außerhalb des Themas: einzeln Genommenes mit Namen, über ein Thema Genommenes nur gezählt.
    const people = topicListing(w.data(), w.bookNow(), topic({ kind: 'person' }));
    expect(names(people.elsewhere)).toEqual(['Moosling']);
    expect(people.elsewhereByRule).toBe(1);
    // Ohne Thema steht alles Einzelne darunter.
    const idle = topicListing(w.data(), w.bookNow(), emptyTopic());
    expect(idle.idle).toBe(true);
    expect(names(idle.elsewhere)).toEqual(['Krummzahn', 'Moosling']);
    expect(idle.elsewhereByRule).toBe(1);
    expect(
      topicListing(w.data(), w.bookNow(), topic({ kind: 'plant', category: 'KRAUT' })).ruleOn,
    ).toBe(true);
  });

  it('gruppiert ohne Art nach Art, sucht in Namen und Beinamen und kennt verborgene Artikel', async () => {
    const w = await setup();
    const listing = topicListing(w.data(), w.bookNow(), topic({ folderId: 'art-welt' }));
    expect(listing.groups.map((g) => g.label)).toEqual(['Personen', 'Pflanzen']);
    expect(listing.groups[0]!.rows[0]).toMatchObject({ withheld: true, inBook: false });
    const people = topicListing(w.data(), w.bookNow(), topic({ kind: 'person' }));
    expect(people.groups.map((g) => g.label)).toEqual(['Personen']);
    const search = topicListing(w.data(), w.bookNow(), emptyTopic(), 'grottenmoos');
    expect(search.groups.flatMap((g) => g.rows.map((r) => r.entity.name))).toEqual(['Moosling']);
    expect(search.idle).toBe(false);
  });
});
