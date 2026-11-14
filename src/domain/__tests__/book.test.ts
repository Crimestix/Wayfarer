import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { articleParts, plainMarkdown, withoutSecrets } from '../articleText';
import {
  articleWording,
  bookEntries,
  bookGroups,
  bookPages,
  bookView,
  booksAbout,
  emptyBook,
  groupBooks,
  pageHandout,
  pagePlainText,
} from '../book';
import { replaceLink } from '../derive';
import { knowledgeOf, playerBook } from '../playerBook';
import {
  ArticleSchema,
  PARTY_ID,
  createEntity,
  type Book,
  type CampaignData,
  type Entity,
  type Item,
} from '../schema';

describe('Lesehilfe für Artikel', () => {
  const text = [
    '> [!steckbrief]',
    '> ![Bild](https://bild.example/kraut.png)',
    '> **Allgemein**',
    '> Art: Kraut',
    '> Fundort: [[Salzgrotte]]',
    '> Riecht nach Rauch.',
    '> > [!geheim]',
    '> > Wert: 500 Gold bei der Grauen Hand',
    '',
    'Feuerkraut wächst an **warmen** Felsen.',
    '',
    '> [!geheim] Nur für dich',
    '> Odo Tannhaus handelt damit.',
    '',
    '```',
    '> [!geheim] steht im Code und bleibt',
    '```',
    '',
    '> Ein gewöhnliches Zitat.',
  ].join('\n');

  it('nimmt Kästen für die Spielleitung heraus – auch verschachtelte, nie aus Code', () => {
    const open = withoutSecrets(text);
    expect(open).not.toContain('Odo Tannhaus');
    expect(open).not.toContain('500 Gold');
    expect(open).toContain('> [!geheim] steht im Code und bleibt');
    expect(open).toContain('> Ein gewöhnliches Zitat.');
    expect(open).toContain('Feuerkraut wächst an **warmen** Felsen.');
  });

  it('nimmt auch Kästen für die Spielleitung unter einem Listenpunkt heraus', () => {
    const list = [
      '- Wächst an Felsen',
      '  > [!geheim]',
      '  > Odo Tannhaus handelt damit.',
      '- Blüht im Herbst',
      '',
      '1. Trocknen',
      '   > [!sl] Nur für dich',
      '   > > Zitat darin',
      '   > Lando Furtner lügt.',
      '2. Mahlen',
      '\t> [!spielleitung]',
      '\t> Krummzahn weiß es.',
    ].join('\n');
    const open = withoutSecrets(list);
    for (const hidden of ['Odo Tannhaus', 'Lando Furtner', 'Krummzahn', 'Zitat darin'])
      expect(open).not.toContain(hidden);
    expect(open).toBe('- Wächst an Felsen\n- Blüht im Herbst\n\n1. Trocknen\n2. Mahlen');
    // Ein gewöhnliches Zitat unter einem Punkt bleibt, ein Geheimnis darin fällt heraus.
    expect(withoutSecrets('- Punkt\n  > Zitat\n  > > [!geheim]\n  > > Weg damit')).toBe(
      '- Punkt\n  > Zitat',
    );
  });

  it('lässt einen Text ohne Geheimes Wort für Wort stehen', () => {
    const plain = 'Erste Zeile\n\n> Zitat\n> zweite Zeile\n\nEnde';
    expect(withoutSecrets(plain)).toBe(plain);
  });

  it('trennt den Steckbrief vom Text', () => {
    const parts = articleParts(withoutSecrets(text));
    expect(parts.facts).toEqual([
      { label: 'Art', value: 'Kraut' },
      { label: 'Fundort', value: '[[Salzgrotte]]' },
    ]);
    expect(parts.box).toBe('Riecht nach Rauch.');
    expect(parts.body.startsWith('Feuerkraut wächst')).toBe(true);
    expect(parts.body).not.toContain('steckbrief');
  });

  it('macht aus Markdown lesbaren Text', () => {
    expect(
      plainMarkdown(
        '## Wirkung\n\nHeilt [[Brann Eichwald|Brann]] und [[Mira Tannhaus~abc]] **sofort**.',
      ),
    ).toBe('Wirkung\n\nHeilt Brann und Mira Tannhaus sofort.');
  });
});

/** Hohenfurt mit Salzgrotte, Burg Graufels; Kräuter, ein Erz, Ilka Sturmfels – erfunden. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const put = <T extends Parameters<typeof createEntity>[0]>(init: T) =>
    db.put('entities', createEntity(init as never));
  const article = (title: string, text: string, extra: Record<string, unknown> = {}) =>
    db.put(
      'articles',
      ArticleSchema.parse({
        id: `art-${title.toLowerCase().replace(/[^a-z]/g, '')}`,
        title,
        docs: [{ id: `doc-${title.toLowerCase().replace(/[^a-z]/g, '')}`, text }],
        ...extra,
      }),
    );
  const town = put({ kind: 'place', name: 'Hohenfurt' });
  const grotto = put({ kind: 'place', name: 'Salzgrotte', place: { parentId: town.id } });
  const castle = put({ kind: 'place', name: 'Burg Graufels' });
  const fire = article(
    'Feuerkraut',
    '> [!steckbrief]\n> Art: Kraut\n\nWächst in der Salzgrotte.\n\n> [!geheim]\n> Gift für Zwerge.',
  );
  const firePlant = put({
    kind: 'plant',
    name: 'Feuerkraut',
    secret: 'Odo baut es heimlich an',
    notes: 'Spielleiternotiz',
    lk: { resourceId: fire.id, title: fire.title },
    plant: { category: 'Kraut', regionIds: [grotto.id] },
  });
  const moss = put({
    kind: 'plant',
    name: 'Moosling',
    plant: { category: 'Pilz', regionIds: [town.id] },
  });
  const thistle = put({
    kind: 'plant',
    name: 'Graudistel',
    plant: { category: 'Kraut', regionIds: [castle.id] },
  });
  const ore = put({
    kind: 'mineral',
    name: 'Eisenerz',
    mineral: { category: 'Erz', regionIds: [grotto.id] },
  });
  const ilka = put({ kind: 'person', name: 'Ilka Sturmfels' });
  const krummzahn = put({ kind: 'person', name: 'Krummzahn', person: { placeId: grotto.id } });
  const book = put({
    kind: 'item',
    name: 'Kräuterkunde von Hohenfurt',
    item: {
      category: 'Buch',
      book: {
        ...emptyBook(),
        authorId: ilka.id,
        selection: { ...emptyBook().selection, kinds: ['plant'], regionIds: [town.id] },
      },
    },
  });
  const data = () => db.getSnapshot();
  const setBook = (change: Partial<Book>) => {
    const current = data().entities[book.id] as Item;
    db.put('entities', {
      ...current,
      item: { ...current.item, book: { ...current.item.book!, ...change } },
    });
  };
  const bookNow = () => data().entities[book.id]!;
  return {
    db,
    data,
    setBook,
    bookNow,
    town,
    grotto,
    castle,
    fire,
    firePlant,
    moss,
    thistle,
    ore,
    ilka,
    krummzahn,
    book,
  };
}

const names = (list: Entity[]) => list.map((entity) => entity.name);

describe('Welche Einträge im Buch stehen', () => {
  it('nimmt Art und Gegend samt den Orten darunter', async () => {
    const w = await setup();
    expect(names(bookEntries(w.data(), w.bookNow()))).toEqual(['Feuerkraut', 'Moosling']);
  });

  it('grenzt nach Einordnung ein, ohne auf Groß- und Kleinschreibung zu achten', async () => {
    const w = await setup();
    w.setBook({
      selection: {
        ...emptyBook().selection,
        kinds: ['plant', 'mineral'],
        categories: ['kraut', 'ERZ'],
      },
    });
    expect(names(bookEntries(w.data(), w.bookNow()))).toEqual([
      'Eisenerz',
      'Feuerkraut',
      'Graudistel',
    ]);
  });

  it('nimmt einzelne Einträge dazu und weg – und nie das Buch selbst', async () => {
    const w = await setup();
    w.setBook({
      selection: {
        ...emptyBook().selection,
        kinds: ['plant', 'item'],
        regionIds: [w.town.id],
        include: [w.krummzahn.id, w.book.id],
        exclude: [w.moss.id],
      },
    });
    expect(names(bookEntries(w.data(), w.bookNow()))).toEqual(['Feuerkraut', 'Krummzahn']);
  });

  it('bleibt ohne Auswahl leer, bis etwas dazukommt', async () => {
    const w = await setup();
    w.setBook({ selection: emptyBook().selection });
    expect(bookEntries(w.data(), w.bookNow())).toEqual([]);
    w.setBook({ selection: { ...emptyBook().selection, include: [w.ore.id] } });
    expect(names(bookEntries(w.data(), w.bookNow()))).toEqual(['Eisenerz']);
  });

  it('ist kein Buch, wenn der Gegenstand keines ist', async () => {
    const w = await setup();
    const plain = w.db.put('entities', createEntity({ kind: 'item', name: 'Kompass' }));
    expect(bookEntries(w.data(), plain)).toEqual([]);
    expect(bookView(w.data(), plain)).toBeNull();
  });
});

describe('Die Seiten des Buches', () => {
  it('zeigt Steckbrief und Wortlaut des Artikels – ohne Geheimes, Geheimnis und Notizen', async () => {
    const w = await setup();
    const [fire, moss] = bookPages(w.data(), w.bookNow());
    expect(fire!.title).toBe('Feuerkraut');
    expect(fire!.facts).toEqual([{ label: 'Art', value: 'Kraut' }]);
    expect(fire!.text).toBe('Wächst in der Salzgrotte.');
    const all = JSON.stringify(fire);
    for (const hidden of ['Gift für Zwerge', 'heimlich', 'Spielleiternotiz'])
      expect(all).not.toContain(hidden);
    expect(fire!.own).toBe(false);
    expect(moss!.text).toBe('');
    expect(moss!.articleId).toBeNull();
  });

  it('wächst mit dem Artikel mit', async () => {
    const w = await setup();
    w.db.patch('articles', w.fire.id, {
      docs: [{ ...w.fire.docs[0]!, text: 'Wächst nur nachts.' }],
    });
    expect(bookPages(w.data(), w.bookNow())[0]!.text).toBe('Wächst nur nachts.');
  });

  it('nimmt eine überschriebene Seite in den Worten des Verfassers – auch wenn der Artikel sich ändert', async () => {
    const w = await setup();
    const source = articleWording(w.data(), w.firePlant).text;
    w.setBook({
      pages: {
        [w.firePlant.id]: {
          text: '> [!steckbrief]\n> Art: Heilkraut\n\nHeilt jedes Fieber.\n\n> [!geheim]\n> Stimmt nicht.',
          base: source,
        },
      },
    });
    let page = bookPages(w.data(), w.bookNow())[0]!;
    expect(page.own).toBe(true);
    expect(page.changed).toBe(false);
    expect(page.facts).toEqual([{ label: 'Art', value: 'Heilkraut' }]);
    expect(page.text).toBe('Heilt jedes Fieber.');
    w.db.patch('articles', w.fire.id, {
      docs: [{ ...w.fire.docs[0]!, text: 'Wächst nur nachts.' }],
    });
    page = bookPages(w.data(), w.bookNow())[0]!;
    expect(page.text).toBe('Heilt jedes Fieber.');
    expect(page.changed).toBe(true);
  });

  it('lässt verborgene Artikel und verborgene Seiten weg', async () => {
    const w = await setup();
    w.db.patch('articles', w.fire.id, { hidden: true });
    const page = bookPages(w.data(), w.bookNow())[0]!;
    expect(page.withheld).toBe(true);
    expect(page.text).toBe('');
  });

  it('nennt einen Eintrag mit verborgenem Artikel nicht im Buch – bis seine Seite überschrieben ist', async () => {
    const w = await setup();
    w.db.patch('articles', w.fire.id, { hidden: true });
    let view = bookView(w.data(), w.bookNow())!;
    expect(view.groups.flatMap((g) => g.pages).map((p) => p.title)).toEqual(['Moosling']);
    expect(view.pageCount).toBe(1);
    expect(view.withheldCount).toBe(1);
    // Die Spielleitung sieht in ihrer Liste weiter alle Einträge.
    expect(view.allGroups.flatMap((g) => g.pages).map((p) => p.title)).toEqual([
      'Feuerkraut',
      'Moosling',
    ]);
    w.setBook({ pages: { [w.firePlant.id]: { text: 'Ein seltenes Kraut.', base: '' } } });
    view = bookView(w.data(), w.bookNow())!;
    expect(view.pageCount).toBe(2);
    expect(view.withheldCount).toBe(0);
  });

  it('ordnet nach Buchstaben, Gegend oder Einordnung', async () => {
    const w = await setup();
    w.setBook({
      selection: { ...emptyBook().selection, kinds: ['plant', 'mineral', 'person'] },
    });
    const labels = () => bookGroups(w.data(), w.bookNow()).map((g) => g.label);
    expect(labels()).toEqual(['E', 'F', 'G', 'I', 'K', 'M']);
    w.setBook({ order: 'region' });
    expect(labels()).toEqual(['Burg Graufels', 'Hohenfurt', 'Salzgrotte', 'Ohne Ort']);
    w.setBook({ order: 'category' });
    expect(labels()).toEqual(['Erz', 'Kraut', 'Pilz', 'Personen']);
  });

  it('zeigt das ganze Buch mit Verfasser und Jahr', async () => {
    const w = await setup();
    w.setBook({ intro: 'Für meine Schüler.', written: { at: 0, precision: 'year' } });
    const view = bookView(w.data(), w.bookNow())!;
    expect(view.author).toBe('Ilka Sturmfels');
    expect(view.written).not.toBe('');
    expect(view.intro).toBe('Für meine Schüler.');
    expect(view.pageCount).toBe(2);
  });

  it('macht aus einer Seite ein Handout mit dem Wortlaut des Buches', async () => {
    const w = await setup();
    const view = bookView(w.data(), w.bookNow())!;
    const page = view.groups[0]!.pages[0]!;
    expect(pagePlainText(page)).toBe('Art: Kraut\n\nWächst in der Salzgrotte.');
    const handout = pageHandout(view, page);
    expect(handout.title).toBe('Kräuterkunde von Hohenfurt – Feuerkraut');
    expect(handout.signature).toBe('Ilka Sturmfels');
    expect(handout.text).toBe('Feuerkraut\n\nArt: Kraut\n\nWächst in der Salzgrotte.');
    expect(handout.sourceId).toBe(`book:${w.book.id}:${w.firePlant.id}`);
  });

  it('behält beim Löschen des Verfassers seinen Namen und lässt gelöschte Einträge fallen', async () => {
    const w = await setup();
    const book = w.bookNow();
    const cleaned = replaceLink(book, w.ilka.id, null, 'Ilka Sturmfels') as Item;
    expect(cleaned.item.book!.authorId).toBeNull();
    expect(cleaned.item.book!.authorText).toBe('Ilka Sturmfels');
    // Die einzige Gegend bleibt als gelöscht stehen: Das Buch wird leer statt weltweit.
    const noTown = replaceLink(book, w.town.id, null) as Item;
    expect(noTown.item.book!.selection.regionIds).toEqual([w.town.id]);
    w.db.remove('entities', w.town.id);
    w.db.put('entities', noTown);
    expect(bookEntries(w.data(), w.bookNow())).toEqual([]);
    // Von mehreren Gegenden fällt die gelöschte heraus.
    w.setBook({
      selection: {
        ...emptyBook().selection,
        kinds: ['plant'],
        regionIds: [w.grotto.id, w.castle.id],
      },
    });
    const noCastle = replaceLink(w.bookNow(), w.castle.id, null) as Item;
    expect(noCastle.item.book!.selection.regionIds).toEqual([w.grotto.id]);
  });
});

describe('Bücher im Spielerbuch', () => {
  const give = (data: () => CampaignData, db: CampaignDb, id: string, holderId: string) => {
    const current = data().entities[id] as Item;
    db.put('entities', { ...current, item: { ...current.item, holderId } });
  };

  it('zählt nicht, solange die Gruppe das Buch nicht hat', async () => {
    const w = await setup();
    expect(groupBooks(w.data())).toEqual([]);
    expect(knowledgeOf(w.data(), w.firePlant.id).books).toEqual([]);
  });

  it('zählt als Wissen der Gruppe – in der Fassung des Buches, ohne Geheimes', async () => {
    const w = await setup();
    w.setBook({
      pages: { [w.firePlant.id]: { text: 'Heilt jedes Fieber.', base: '' } },
    });
    give(w.data, w.db, w.book.id, PARTY_ID);
    const k = knowledgeOf(w.data(), w.firePlant.id);
    expect(k.inBook).toBe(true);
    expect(k.empty).toBe(false);
    expect(k.books).toHaveLength(1);
    expect(k.books[0]!.bookName).toBe('Kräuterkunde von Hohenfurt');
    expect(k.books[0]!.page.text).toBe('Heilt jedes Fieber.');
    expect(k.books[0]!.page.own).toBe(true);
    expect(JSON.stringify(k.books)).not.toContain('Gift für Zwerge');
    // Was nicht im Buch steht, weiß die Gruppe daraus nicht.
    expect(knowledgeOf(w.data(), w.thistle.id).books).toEqual([]);
  });

  it('verrät nichts aus einem verborgenen Artikel – weder Wissen noch Namen', async () => {
    const w = await setup();
    w.db.patch('articles', w.fire.id, { hidden: true });
    give(w.data, w.db, w.book.id, PARTY_ID);
    const k = knowledgeOf(w.data(), w.firePlant.id);
    expect(k.books).toEqual([]);
    expect(k.inBook).toBe(false);
    const section = playerBook(w.data()).sections.find((s) => s.sort === 'books');
    expect(JSON.stringify(section)).not.toContain('Feuerkraut');
    expect(JSON.stringify(section)).toContain('Moosling');
  });

  it('zählt auch, wenn ein Gefährte das Buch trägt – und steht im Spielerbuch', async () => {
    const w = await setup();
    const brann = w.db.put('entities', createEntity({ kind: 'character', name: 'Brann Eichwald' }));
    give(w.data, w.db, w.book.id, brann.id);
    expect(booksAbout(w.data(), w.moss.id).map((b) => b.page.title)).toEqual(['Moosling']);
    const section = playerBook(w.data()).sections.find((s) => s.sort === 'books');
    expect(section).toMatchObject({
      sort: 'books',
      books: [
        {
          name: 'Kräuterkunde von Hohenfurt',
          author: 'Ilka Sturmfels',
          entries: [
            { id: w.firePlant.id, name: 'Feuerkraut' },
            { id: w.moss.id, name: 'Moosling' },
          ],
        },
      ],
    });
  });
});
