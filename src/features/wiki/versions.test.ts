import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity } from '../../domain/schema';
import { trashOf, versionsOf } from '../../domain/versions';
import {
  createArticle,
  deleteArticle,
  purgeArticle,
  restoreArticle,
  restoreVersion,
  savePageText,
} from './actions';

let clock = new Date(2026, 10, 14, 10, 0).getTime();
const later = (minutes: number) => {
  clock += minutes * 60_000;
  vi.setSystemTime(clock);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  clock = new Date(2026, 10, 14, 10, 0).getTime();
  vi.setSystemTime(clock);
});
afterEach(() => {
  vi.useRealTimers();
});

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const article = createArticle(db, { title: 'Hohenfurt', text: 'Ein Dorf.' })!;
  const docId = article.docs[0]!.id;
  const text = () => db.getSnapshot().articles[article.id]?.docs[0]?.text;
  const versions = () => versionsOf(db.getSnapshot(), article.id);
  const write = (value: string) => savePageText(db, article.id, docId, value);
  return { db, article, docId, text, versions, write };
}

describe('Frühere Fassungen beim Schreiben', () => {
  it('legen den Wortlaut vor der Änderung ab – höchstens einmal in zehn Minuten', async () => {
    const { versions, write } = await setup();
    write('Ein Dorf an der Furt.');
    expect(versions().map((v) => v.text)).toEqual(['Ein Dorf.']);
    later(3);
    write('Ein Dorf an der Furt. Mit Mühle.');
    expect(versions()).toHaveLength(1);
    later(10);
    write('Ein Dorf an der Furt. Mit Mühle und Brücke.');
    expect(versions().map((v) => v.text)).toEqual([
      'Ein Dorf an der Furt. Mit Mühle.',
      'Ein Dorf.',
    ]);
    expect(versions().every((v) => v.reason === 'edit' && v.title === 'Hohenfurt')).toBe(true);
  });

  it('ohne Änderung entsteht keine Fassung', async () => {
    const { versions, write } = await setup();
    write('Ein Dorf.');
    expect(versions()).toEqual([]);
  });

  it('dünnen beim Schreiben aus: nie mehr als 60 je Artikel', async () => {
    const { versions, write } = await setup();
    for (let i = 0; i < 80; i++) {
      later(60 * 24);
      write(`Fassung ${i}`);
    }
    expect(versions()).toHaveLength(60);
  });
});

describe('Eine Fassung zurückholen', () => {
  it('setzt den alten Wortlaut ein und hebt den heutigen vorher auf; Rückgängig', async () => {
    const { db, versions, write, text } = await setup();
    write('Ein Dorf an der Furt.');
    later(1);
    write('Ganz anders.');
    const old = versions()[0]!;
    expect(old.text).toBe('Ein Dorf.');
    later(1);
    const done = restoreVersion(db, old.id)!;
    expect(text()).toBe('Ein Dorf.');
    // Der heutige Text liegt jetzt als Fassung „vor dem Zurückholen“ bereit – trotz zehn Minuten.
    expect(versions()[0]).toMatchObject({ reason: 'restore', text: 'Ganz anders.' });
    done.undo();
    expect(text()).toBe('Ganz anders.');
  });

  it('tut nichts, wenn die Seite schon so lautet', async () => {
    const { db, versions, write } = await setup();
    write('Neu.');
    later(1);
    write('Ein Dorf.');
    const same = versions().find((v) => v.text === 'Ein Dorf.')!;
    expect(restoreVersion(db, same.id)).toBeNull();
  });
});

describe('Papierkorb', () => {
  it('nimmt einen gelöschten Artikel auf; Rückgängig beim Löschen leert ihn wieder', async () => {
    const { db, article } = await setup();
    const undo = deleteArticle(db, article.id)!;
    const trash = trashOf(db.getSnapshot());
    expect(trash).toHaveLength(1);
    expect(trash[0]).toMatchObject({ title: 'Hohenfurt', text: 'Ein Dorf.', reason: 'delete' });
    undo();
    expect(trashOf(db.getSnapshot())).toEqual([]);
    expect(Object.values(db.getSnapshot().versions)).toHaveLength(0);
  });

  it('stellt wieder her – mit Kennung, Fassungen und Eintrag der Welt', async () => {
    const { db, article, write, versions } = await setup();
    const odo = db.put(
      'entities',
      createEntity({
        kind: 'person',
        name: 'Hohenfurter Wirt',
        lk: { resourceId: article.id, title: 'Hohenfurt' },
      }),
    );
    write('Ein Dorf an der Furt.');
    deleteArticle(db, article.id);
    expect(db.getSnapshot().entities[odo.id]!.lk).toBeNull();
    const [trash] = trashOf(db.getSnapshot());
    const back = restoreArticle(db, trash!.id);
    if (typeof back === 'string') throw new Error(back);
    const data = db.getSnapshot();
    expect(data.articles[article.id]?.docs[0]?.text).toBe('Ein Dorf an der Furt.');
    expect(data.entities[odo.id]!.lk?.resourceId).toBe(article.id);
    expect(trashOf(data)).toEqual([]);
    expect(versions().map((v) => v.text)).toEqual(['Ein Dorf.']);
    back.undo();
    expect(db.getSnapshot().articles[article.id]).toBeUndefined();
    expect(trashOf(db.getSnapshot())).toHaveLength(1);
  });

  it('verlangt einen anderen Titel, wenn der alte inzwischen vergeben ist', async () => {
    const { db, article } = await setup();
    deleteArticle(db, article.id);
    createArticle(db, { title: 'Hohenfurt' });
    const [trash] = trashOf(db.getSnapshot());
    expect(restoreArticle(db, trash!.id)).toBe('taken');
    expect(restoreArticle(db, trash!.id, '  ')).toBe('empty');
    const back = restoreArticle(db, trash!.id, 'Hohenfurt (alt)');
    if (typeof back === 'string') throw new Error(back);
    expect(back.article.title).toBe('Hohenfurt (alt)');
  });

  it('legt einen Artikel ganz oben ab, wenn sein Platz nicht mehr da ist', async () => {
    const { db } = await setup();
    const mine = createArticle(db, { title: 'Salzgrotte' })!;
    const child = createArticle(db, { title: 'Graufels', parentId: mine.id })!;
    deleteArticle(db, child.id);
    deleteArticle(db, mine.id);
    const trash = trashOf(db.getSnapshot()).find((v) => v.articleId === child.id)!;
    const back = restoreArticle(db, trash.id);
    if (typeof back === 'string') throw new Error(back);
    expect(back.article.parentId).toBeNull();
  });

  it('entfernt endgültig – samt allen Fassungen', async () => {
    const { db, article, write } = await setup();
    write('Ein Dorf an der Furt.');
    deleteArticle(db, article.id);
    const [trash] = trashOf(db.getSnapshot());
    expect(purgeArticle(db, trash!.id)).toBe(2);
    expect(Object.values(db.getSnapshot().versions)).toEqual([]);
  });
});
