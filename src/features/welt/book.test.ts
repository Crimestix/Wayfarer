import { describe, expect, it } from 'vitest';
import { deleteEntity } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { bookEntries, bookPages, bookView } from '../../domain/book';
import { ArticleSchema, createEntity, type Item } from '../../domain/schema';
import {
  leaveOut,
  pageToHandout,
  patchSelection,
  readBookPage,
  resetBookPage,
  setIsBook,
  toggleBookCategory,
  toggleBookKind,
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
    toggleBookKind(w.db, w.book.id, 'plant');
    toggleBookCategory(w.db, w.book.id, 'kraut');
    toggleBookCategory(w.db, w.book.id, 'Pilz');
    toggleBookCategory(w.db, w.book.id, 'PILZ');
    expect(w.item().item.book!.selection).toMatchObject({
      kinds: ['plant'],
      categories: ['kraut'],
    });
    expect(bookEntries(w.db.getSnapshot(), w.item()).map((e) => e.name)).toEqual(['Feuerkraut']);
    toggleBookKind(w.db, w.book.id, 'plant');
    expect(w.item().item.book!.selection.kinds).toEqual([]);
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
    leaveOut(w.db, w.book.id, w.herb.id);
    expect(w.item().item.book!.selection).toMatchObject({ include: [], exclude: [w.herb.id] });
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
