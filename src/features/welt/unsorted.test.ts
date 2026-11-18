import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { trashOf } from '../../domain/versions';
import { createArticle, createArticleOfKind } from '../wiki/actions';
import { dropArticles, filterUnsorted, sortArticles, unsortedRows } from './unsorted';

/** Eine erfundene alte Ordnerstruktur: leere Ordnerseiten, eine Abhandlung, ein Artikel mit Eintrag. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const data = () => db.getSnapshot();
  const before = new Set(Object.keys(data().articles));
  const folder = createArticle(db, { title: 'Sternkunde', parentId: null })!;
  const essay = createArticle(db, {
    title: 'Vom Lauf der Monde',
    parentId: folder.id,
    text: 'Drei Monde ziehen über den Himmel, und jeder hat seine eigene Zeit.',
  })!;
  const moon = createArticle(db, { title: 'Silbermond', parentId: folder.id })!;
  createArticleOfKind(db, {
    title: 'Sternwarte',
    parentId: folder.id,
    kind: 'place',
    scaffold: false,
  });
  const rows = () => unsortedRows(data()).filter((row) => !before.has(row.article.id));
  return { db, data, folder, essay, moon, rows };
}

describe('Ohne Kategorie', () => {
  it('zeigt alle Artikel ohne Eintrag – mit Ordner, Länge und was darunter hängt', async () => {
    const { rows } = await setup();
    expect(rows().map((row) => [row.article.title, row.path, row.words, row.children])).toEqual([
      ['Sternkunde', '', 0, 3],
      ['Silbermond', 'Sternkunde', 0, 0],
      ['Vom Lauf der Monde', 'Sternkunde', 12, 0],
    ]);
    expect(filterUnsorted(rows(), 'mond', false).map((row) => row.article.title)).toEqual([
      'Silbermond',
      'Vom Lauf der Monde',
    ]);
    expect(filterUnsorted(rows(), '', true).map((row) => row.article.title)).toEqual([
      'Sternkunde',
      'Silbermond',
    ]);
  });

  it('gibt Artikeln eine Kategorie – der Text bleibt, mit Rückgängig', async () => {
    const { db, data, moon, essay, rows } = await setup();
    const result = sortArticles(db, [moon.id, essay.id], 'celestial');
    expect(result.count).toBe(2);
    const made = Object.values(data().entities).find((entity) => entity.name === 'Silbermond');
    expect(made).toMatchObject({ kind: 'celestial', lk: { resourceId: moon.id } });
    expect(rows().map((row) => row.article.title)).toEqual(['Sternkunde']);
    // Ein zweites Mal entsteht kein zweiter Eintrag.
    expect(sortArticles(db, [moon.id], 'place').count).toBe(0);
    result.undo();
    expect(rows()).toHaveLength(3);
    expect(data().articles[essay.id]).toBeDefined();
  });

  it('löscht in den Papierkorb und holt alles zurück, wie es hing', async () => {
    const { db, data, folder, moon, rows } = await setup();
    const result = dropArticles(db, [folder.id, moon.id]);
    expect(result.count).toBe(2);
    expect(rows().map((row) => [row.article.title, row.path])).toEqual([
      ['Vom Lauf der Monde', ''],
    ]);
    expect(
      trashOf(data())
        .map((entry) => entry.title)
        .sort(),
    ).toEqual(['Silbermond', 'Sternkunde']);
    result.undo();
    expect(rows().map((row) => [row.article.title, row.path])).toEqual([
      ['Sternkunde', ''],
      ['Silbermond', 'Sternkunde'],
      ['Vom Lauf der Monde', 'Sternkunde'],
    ]);
  });
});
