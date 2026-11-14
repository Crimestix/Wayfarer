import { describe, expect, it } from 'vitest';
import { deleteEntity } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { bookEntries, bookPages, bookView } from '../../domain/book';
import { ArticleSchema, createEntity, type Item } from '../../domain/schema';
import { emptyTopic } from '../../domain/bookTopics';
import {
  pageToHandout,
  patchSelection,
  readBookPage,
  resetBookPage,
  setBookRule,
  setInBook,
  setIsBook,
  writeBookPage,
} from './book';

/** Hohenfurt, ein Kraut mit Artikel, Brann Eichwald als Verfasser – erfunden. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const town = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const article = db.put(
    'articles',
    ArticleSchema.parse({
      id: 'art-feuerkraut',
      title: 'Feuerkraut',
      docs: [
        { id: 'doc-feuerkraut', text: '> [!steckbrief]\n> Fundort: [[Hohenfurt]]\n\nBrennt.' },
      ],
    }),
  );
  db.put('articles', ArticleSchema.parse({ id: 'art-hohenfurt', title: 'Hohenfurt' }));
  const herb = db.put(
    'entities',
    createEntity({
      kind: 'plant',
      name: 'Feuerkraut',
      lk: { resourceId: article.id, title: article.title },
      plant: { category: 'Kraut', regionIds: [town.id] },
    }),
  );
  const brann = db.put('entities', createEntity({ kind: 'person', name: 'Brann Eichwald' }));
  const book = db.put('entities', createEntity({ kind: 'item', name: 'Grünes Buch' }));
  const item = () => db.getSnapshot().entities[book.id] as Item;
  return { db, town, herb, brann, book, item };
}

describe('Befehle für Bücher', () => {
  it('macht einen Gegenstand zum Buch und wählt aus', async () => {
    const w = await setup();
    setIsBook(w.db, w.book.id, true);
    expect(w.item().item.book).not.toBeNull();
    const kraut = { ...emptyTopic(), kind: 'plant' as const, category: 'kraut' };
    setBookRule(w.db, w.book.id, kraut, true);
    setBookRule(w.db, w.book.id, { ...kraut, category: ' KRAUT ' }, true);
    expect(w.item().item.book!.selection.rules).toEqual([kraut]);
    expect(bookEntries(w.db.getSnapshot(), w.item()).map((e) => e.name)).toEqual(['Feuerkraut']);
    setBookRule(w.db, w.book.id, kraut, false);
    expect(w.item().item.book!.selection).toMatchObject({ rules: [], include: [w.herb.id] });
  });

  it('schreibt eine Seite in den Worten des Verfassers und setzt sie zurück', async () => {
    const w = await setup();
    setIsBook(w.db, w.book.id, true);
    patchSelection(w.db, w.book.id, { include: [w.herb.id] });
    const source = bookPages(w.db.getSnapshot(), w.item())[0]!.source;
    writeBookPage(w.db, w.book.id, w.herb.id, 'Brennt nie.', source);
    let page = bookPages(w.db.getSnapshot(), w.item())[0]!;
    expect(page).toMatchObject({ own: true, changed: false, text: 'Brennt nie.' });
    resetBookPage(w.db, w.book.id, w.herb.id);
    page = bookPages(w.db.getSnapshot(), w.item())[0]!;
    expect(page).toMatchObject({ own: false, text: 'Brennt.' });
    // Leer gespeichert setzt ebenfalls zurück.
    writeBookPage(w.db, w.book.id, w.herb.id, 'Brennt nie.', source);
    writeBookPage(w.db, w.book.id, w.herb.id, '  ', source);
    page = bookPages(w.db.getSnapshot(), w.item())[0]!;
    expect(page).toMatchObject({ own: false, text: 'Brennt.' });
  });

  it('lässt einen Eintrag weg und nimmt eine Seite als Handout', async () => {
    const w = await setup();
    setIsBook(w.db, w.book.id, true);
    patchSelection(w.db, w.book.id, { include: [w.herb.id] });
    const view = bookView(w.db.getSnapshot(), w.item())!;
    const handout = pageToHandout(w.db, view, view.groups[0]!.pages[0]!);
    expect(w.db.getSnapshot().handouts[handout.id]?.text).toBe(
      'Feuerkraut\n\nFundort: Hohenfurt\n\nBrennt.',
    );
    setInBook(w.db, w.book.id, [w.herb.id], false);
    expect(w.item().item.book!.selection).toMatchObject({ include: [], exclude: [] });
    expect(bookEntries(w.db.getSnapshot(), w.item())).toEqual([]);
  });

  it('liest Steckbrief und Text mit den Verweisen des Wikis', async () => {
    const w = await setup();
    setIsBook(w.db, w.book.id, true);
    patchSelection(w.db, w.book.id, { include: [w.herb.id] });
    const page = bookPages(w.db.getSnapshot(), w.item())[0]!;
    const reading = readBookPage(w.db.getSnapshot().articles, page);
    expect(reading.facts[0]!.label).toBe('Fundort');
    expect(reading.facts[0]!.value[0]).toMatchObject({
      type: 'mention',
      resourceId: 'art-hohenfurt',
    });
    expect(reading.nodes[0]).toMatchObject({ type: 'paragraph' });
  });

  it('behält den Verfasser als Namen, wenn sein Eintrag gelöscht wird', async () => {
    const w = await setup();
    setIsBook(w.db, w.book.id, true);
    const item = w.item();
    w.db.put('entities', {
      ...item,
      item: { ...item.item, book: { ...item.item.book!, authorId: w.brann.id } },
    });
    deleteEntity(w.db, w.brann.id);
    expect(w.item().item.book).toMatchObject({ authorId: null, authorText: 'Brann Eichwald' });
    expect(bookView(w.db.getSnapshot(), w.item())!.author).toBe('Brann Eichwald');
  });
});

describe('Ankreuzen beim Durchsehen', () => {
  /** Dazu: Moosling (Pilz) in Hohenfurt, Graudistel (Kraut) anderswo, Krummzahn in Hohenfurt. */
  async function world() {
    const w = await setup();
    setIsBook(w.db, w.book.id, true);
    const put = (init: Parameters<typeof createEntity>[0]) =>
      w.db.put('entities', createEntity(init));
    const moss = put({
      kind: 'plant',
      name: 'Moosling',
      plant: { category: 'Pilz', regionIds: [w.town.id] },
    });
    const thistle = put({ kind: 'plant', name: 'Graudistel', plant: { category: 'Kraut' } });
    const krummzahn = put({ kind: 'person', name: 'Krummzahn', person: { placeId: w.town.id } });
    const names = () => bookEntries(w.db.getSnapshot(), w.item()).map((e) => e.name);
    const selection = () => w.item().item.book!.selection;
    return { ...w, moss, thistle, krummzahn, names, selection };
  }
  const plants = { ...emptyTopic(), kind: 'plant' as const };

  it('nimmt Angekreuztes einzeln dazu und Abgewähltes wieder heraus', async () => {
    const w = await world();
    setInBook(w.db, w.book.id, [w.herb.id, w.krummzahn.id, w.book.id], true);
    expect(w.selection().include.sort()).toEqual([w.herb.id, w.krummzahn.id].sort());
    expect(w.names()).toEqual(['Feuerkraut', 'Krummzahn']);
    setInBook(w.db, w.book.id, [w.krummzahn.id], false);
    expect(w.selection()).toMatchObject({ include: [w.herb.id], exclude: [] });
  });

  it('lässt über ein Thema Genommenes nur über „weg“ heraus – und nimmt es ohne „dazu“ zurück', async () => {
    const w = await world();
    setBookRule(w.db, w.book.id, plants, true);
    expect(w.names()).toEqual(['Feuerkraut', 'Graudistel', 'Moosling']);
    setInBook(w.db, w.book.id, [w.moss.id], false);
    expect(w.selection()).toMatchObject({ include: [], exclude: [w.moss.id] });
    expect(w.names()).toEqual(['Feuerkraut', 'Graudistel']);
    setInBook(w.db, w.book.id, [w.moss.id], true);
    expect(w.selection()).toMatchObject({ include: [], exclude: [] });
    // Alle und keine: in einem Zug.
    setInBook(w.db, w.book.id, [w.herb.id, w.thistle.id, w.moss.id], false);
    expect(w.names()).toEqual([]);
    expect(w.selection().exclude).toHaveLength(3);
  });

  it('nimmt mit dem Thema auch, was später dazukommt – und behält beim Abschalten, was angekreuzt ist', async () => {
    const w = await world();
    setInBook(w.db, w.book.id, [w.krummzahn.id, w.herb.id], true);
    setBookRule(w.db, w.book.id, plants, true);
    // Was das Thema nun ohnehin nimmt, braucht kein „dazu“ mehr.
    expect(w.selection().include).toEqual([w.krummzahn.id]);
    const later = w.db.put('entities', createEntity({ kind: 'plant', name: 'Eisenhut' }));
    setInBook(w.db, w.book.id, [w.moss.id], false);
    expect(w.names()).toEqual(['Eisenhut', 'Feuerkraut', 'Graudistel', 'Krummzahn']);
    setBookRule(w.db, w.book.id, plants, false);
    expect(w.names()).toEqual(['Eisenhut', 'Feuerkraut', 'Graudistel', 'Krummzahn']);
    expect(w.selection()).toMatchObject({ rules: [], exclude: [] });
    expect(w.selection().include).toContain(later.id);
    w.db.put('entities', createEntity({ kind: 'plant', name: 'Bilsenkraut' }));
    expect(w.names()).not.toContain('Bilsenkraut');
  });

  it('macht aus der älteren Regel Themen, die sich einzeln abschalten lassen', async () => {
    const w = await world();
    patchSelection(w.db, w.book.id, { kinds: ['plant', 'person'], regionIds: [w.town.id] });
    expect(w.names()).toEqual(['Feuerkraut', 'Krummzahn', 'Moosling']);
    setBookRule(w.db, w.book.id, { ...emptyTopic(), kind: 'person', regionId: w.town.id }, false);
    expect(w.selection()).toMatchObject({ kinds: [], regionIds: [], categories: [] });
    expect(w.selection().rules).toEqual([{ ...plants, regionId: w.town.id }]);
    // Krummzahn bleibt einzeln; wer später nach Hohenfurt zieht, kommt nicht mehr von selbst dazu.
    expect(w.selection().include).toEqual([w.krummzahn.id]);
    w.db.put(
      'entities',
      createEntity({ kind: 'person', name: 'Lando Furtner', person: { placeId: w.town.id } }),
    );
    expect(w.names()).toEqual(['Feuerkraut', 'Krummzahn', 'Moosling']);
  });

  it('lässt ein Thema fallen, wenn seine Gegend gelöscht wird', async () => {
    const w = await world();
    setBookRule(w.db, w.book.id, { ...plants, regionId: w.town.id }, true);
    setBookRule(w.db, w.book.id, { ...emptyTopic(), kind: 'person' }, true);
    deleteEntity(w.db, w.town.id);
    expect(w.selection().rules).toEqual([{ ...emptyTopic(), kind: 'person' }]);
  });
});
