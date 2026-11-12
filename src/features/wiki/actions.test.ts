import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity, type Article, type CampaignData } from '../../domain/schema';
import { lkExportFixture } from './__fixtures__/lkExport';
import {
  addPage,
  createArticle,
  deleteArticle,
  linkTwins,
  isWithin,
  moveArticle,
  removePage,
  renameArticle,
  renamePage,
  savePageText,
  setArticleMeta,
  syncFacts,
} from './actions';
import { twins } from './facts';
import { planLkImport } from './apply';
import { convertLkExport } from './lkexport';
import { articleSuggestions, backlinks, splitPage, wantedArticles } from './model';
import { articleAsText, linkIndex, linkTargets, pageNodes, pageText, relinked } from './text';

const imported = (): CampaignData =>
  planLkImport(elarisCampaign(), convertLkExport(lkExportFixture())).data;

async function setup() {
  const store = new MemoryStore();
  const db = await CampaignDb.create(store, imported());
  const articles = () => db.getSnapshot().articles;
  const byTitle = (title: string): Article =>
    Object.values(articles()).find((a) => a.title === title)!;
  const text = (title: string, page = 0): string =>
    byTitle(title).docs.filter((d) => d.kind === 'page')[page]!.text;
  return { db, store, articles, byTitle, text };
}

describe('Artikel als Text', () => {
  it('kommen bei der Übernahme als Text an, der Steckbrief oben auf der ersten Seite', async () => {
    const { byTitle, text, articles } = await setup();
    const inn = byTitle('Zum Krummen Aal');
    expect(inn.sidebar).toEqual([]);
    expect(inn.docs.every((d) => d.nodes.length === 0)).toBe(true);
    expect(text('Zum Krummen Aal')).toBe(
      [
        '> [!steckbrief]',
        '> ![](https://assets.example.org/aal.jpg)',
        '>',
        '> **Zusammenfassung**',
        '>',
        '> Eine Hafenschenke mit schiefem Giebel. Der Wirt schweigt.',
        '>',
        '> Liegt in: [[Hafenviertel]]',
        '',
        'Es riecht nach Teer.',
      ].join('\n'),
    );
    expect(text('Hohenfurt')).toContain('Hier** herrscht [[Mira Tannhaus]].');
    expect(text('Hohenfurt')).toContain('> [!geheim]\n> Der Rat ist bestochen.');
    // Verweise im Text führen wieder zum Artikel.
    const city = byTitle('Hohenfurt');
    const nodes = pageNodes(articles(), city, city.docs[0]!);
    expect(JSON.stringify(nodes)).toContain('"resourceId":"mira0001"');
    expect(linkTargets(text('Die Aalfischer'))).toEqual([
      'Odo Tannhaus',
      'Zum Krummen Aal',
      'Odo Tannhaus',
    ]);
  });

  it('liest Artikel der alten Form weiter und schreibt sie beim ersten Speichern um', async () => {
    // So lagen Artikel vor der Umstellung im Spielstand: als Knoten, mit eigenem Steckbrief.
    const conversion = convertLkExport(lkExportFixture());
    const old = Object.fromEntries(conversion.articles.map((a) => [a.id, a]));
    const inn = old.aal00001!;
    expect(inn.docs[0]!.text).toBe('');
    expect(pageText(old, inn, inn.docs[0]!)).toContain('> [!steckbrief]');
    expect(splitPage(old, inn, inn.docs[0]).side.map((n) => n.type)).toEqual(['infobox']);
    expect(articleAsText(old, inn).article.docs[0]!.text).toBe(pageText(old, inn, inn.docs[0]!));

    const db = await CampaignDb.create(new MemoryStore(), { ...elarisCampaign(), articles: old });
    savePageText(db, 'aal00001', inn.docs[0]!.id, 'Neu geschrieben.');
    const saved = db.getSnapshot().articles.aal00001!;
    expect(saved).toMatchObject({ source: 'wayfarer', sidebar: [] });
    expect(saved.docs[0]).toMatchObject({ text: 'Neu geschrieben.', nodes: [] });
  });
});

describe('Schreiben', () => {
  it('speichert den Text und macht den Artikel zu einem von Wayfarer', async () => {
    const { db, store, byTitle, text } = await setup();
    const odo = byTitle('Odo Tannhaus');
    const page = odo.docs[0]!;
    expect(odo.source).toBe('legendkeeper');
    savePageText(
      db,
      odo.id,
      page.id,
      'Fährmann. Bruder von [[Mira Tannhaus]] und Freund von [[Graufels]].',
    );
    expect(text('Odo Tannhaus')).toContain('[[Graufels]]');
    expect(byTitle('Odo Tannhaus').source).toBe('wayfarer');
    // Rückverweise folgen dem neuen Text.
    expect(
      backlinks(db.getSnapshot().articles)
        .get('mira0001')
        ?.map((a) => a.title),
    ).toContain('Odo Tannhaus');
    // Ohne Änderung wird nichts geschrieben.
    const rev = byTitle('Odo Tannhaus').rev;
    savePageText(db, odo.id, page.id, text('Odo Tannhaus'));
    expect(byTitle('Odo Tannhaus').rev).toBe(rev);
    savePageText(db, 'gibtsnicht', page.id, 'x');
    await db.flush();
    const reopened = await CampaignDb.open(store);
    expect(reopened.problems).toEqual([]);
    expect(reopened.getSnapshot().articles[odo.id]).toEqual(byTitle('Odo Tannhaus'));

    // Ein neuer Import überschreibt das Geschriebene nicht.
    const again = planLkImport(db.getSnapshot(), convertLkExport(lkExportFixture()));
    expect(again.data.articles[odo.id]!.docs[0]!.text).toContain('[[Graufels]]');
    expect(again.sections.hints.join(' ')).toMatch(/1 Artikel wurde in Wayfarer geändert/);
    // Die übrigen werden aufgefrischt wie zuvor.
    expect(again.data.articles.hohenf01!.source).toBe('legendkeeper');
  });

  it('liest beim Tippen nur die geänderte Seite neu', async () => {
    const { db, articles, byTitle } = await setup();
    const odo = byTitle('Odo Tannhaus');
    const mira = byTitle('Mira Tannhaus');
    const before = articles();
    const stamp = linkIndex(before).stamp;
    const miraNodes = pageNodes(before, mira, mira.docs[0]!);
    savePageText(db, odo.id, odo.docs[0]!.id, 'Fährmann am [[Hohenfurt]]er Ufer.');
    // Kein Titel hat sich geändert: Was andere Seiten zeigen, gilt weiter.
    expect(linkIndex(articles()).stamp).toBe(stamp);
    expect(pageNodes(articles(), byTitle('Mira Tannhaus'), mira.docs[0]!)).toBe(miraNodes);
    expect(
      backlinks(articles())
        .get('hohenf01')
        ?.map((a) => a.title),
    ).toContain('Odo Tannhaus');
    // Ein neuer Titel kann Verweise anders auflösen – dann wird neu gelesen.
    renameArticle(db, mira.id, 'Mira vom Fluss');
    expect(linkIndex(articles()).stamp).not.toBe(stamp);
  });

  it('schlägt Artikel zum Verknüpfen vor: Titelanfang vor Wortanfang vor Zweitnamen', async () => {
    const { db, articles, byTitle } = await setup();
    setArticleMeta(db, byTitle('Hohenfurt').id, { aliases: ['Die Tannenstadt'] });
    const titles = (query: string) => articleSuggestions(articles(), query).map((a) => a.title);
    // Bei gleichem Rang zuerst der kürzere Titel.
    expect(titles('tann')).toEqual(['Odo Tannhaus', 'Mira Tannhaus', 'Hohenfurt']);
    expect(titles('odo')[0]).toBe('Odo Tannhaus');
    expect(titles('gibt es nicht')).toEqual([]);
    // Vorlagen werden nie vorgeschlagen; ohne Eingabe kommen die zuletzt geänderten.
    expect(articleSuggestions(articles(), '').some((a) => a.template)).toBe(false);
    // „Zuletzt geändert“ misst in Millisekunden: Die nächste Änderung muss spürbar später liegen.
    await new Promise((resolve) => setTimeout(resolve, 5));
    savePageText(db, byTitle('Odo Tannhaus').id, byTitle('Odo Tannhaus').docs[0]!.id, 'Neu.');
    expect(titles('')[0]).toBe('Odo Tannhaus');
  });

  it('zeigt, was erwähnt wird, aber noch keinen Artikel hat', async () => {
    const { db, articles, byTitle } = await setup();
    const page = (title: string) => byTitle(title).docs[0]!.id;
    savePageText(
      db,
      byTitle('Odo Tannhaus').id,
      page('Odo Tannhaus'),
      'Freund von [[Graufels]], fürchtet [[Die Nebelbank]].',
    );
    savePageText(
      db,
      byTitle('Mira Tannhaus').id,
      page('Mira Tannhaus'),
      'Kennt [[graufels|die alte Feste]] gut.',
    );
    const before = wantedArticles(articles()).filter((w) => /graufels|nebelbank/i.test(w.title));
    // Am häufigsten Erwähntes zuerst; Groß- und Kleinschreibung zählt nicht.
    expect(before.map((w) => [w.title, w.from.map((a) => a.title)])).toEqual([
      ['graufels', ['Mira Tannhaus', 'Odo Tannhaus']],
      ['Die Nebelbank', ['Odo Tannhaus']],
    ]);
    // Angelegt verschwindet der Name aus der Liste, und die Verweise führen hin.
    const created = createArticle(db, { title: 'Graufels' })!;
    expect(wantedArticles(articles()).map((w) => w.title)).not.toContain('graufels');
    expect(
      backlinks(articles())
        .get(created.id)
        ?.map((a) => a.title),
    ).toEqual(['Mira Tannhaus', 'Odo Tannhaus']);
  });

  it('legt Artikel an, auch unter einem anderen', async () => {
    const { db, byTitle, articles } = await setup();
    expect(createArticle(db, { title: '   ' })).toBeNull();
    const city = byTitle('Hohenfurt');
    const tower = createArticle(db, { title: '  Der  Wachturm ', parentId: city.id })!;
    expect(tower).toMatchObject({
      title: 'Der Wachturm',
      parentId: city.id,
      source: 'wayfarer',
      template: false,
    });
    expect(tower.docs).toHaveLength(1);
    expect(tower.docs[0]).toMatchObject({ kind: 'page', text: '' });
    // Er steht hinter seinen Geschwistern.
    const siblings = Object.values(articles())
      .filter((a) => a.parentId === city.id)
      .sort((a, b) => (a.order < b.order ? -1 : 1));
    expect(siblings[siblings.length - 1]!.id).toBe(tower.id);
    const top = createArticle(db, { title: 'Notizen', parentId: 'gibtsnicht' })!;
    expect(top.parentId).toBeNull();
    // Ein Verweis, der bisher ins Leere ging, findet den neuen Artikel.
    const odo = byTitle('Odo Tannhaus');
    savePageText(db, odo.id, odo.docs[0]!.id, 'Wacht am [[Der Wachturm]].');
    expect(
      backlinks(articles())
        .get(tower.id)
        ?.map((a) => a.title),
    ).toEqual(['Odo Tannhaus']);
  });

  it('benennt um und zieht alle Verweise mit', async () => {
    const { db, byTitle, text, articles } = await setup();
    const mira = byTitle('Mira Tannhaus');
    expect(renameArticle(db, mira.id, '  ')).toBe('empty');
    expect(renameArticle(db, 'gibtsnicht', 'x')).toBe('missing');
    expect(renameArticle(db, mira.id, 'Mira Tannhaus')).toEqual({ relinked: 0 });

    const result = renameArticle(db, mira.id, 'Mira von Hohenfurt');
    expect(result).toEqual({ relinked: 1 });
    expect(text('Hohenfurt')).toContain('herrscht [[Mira von Hohenfurt]].');
    expect(byTitle('Mira von Hohenfurt')).toMatchObject({ id: mira.id, source: 'wayfarer' });
    // Der Eintrag der Welt merkt sich den neuen Titel der Verknüpfung.
    const entity = Object.values(db.getSnapshot().entities).find(
      (e) => e.lk?.resourceId === mira.id,
    )!;
    expect(entity.lk!.title).toBe('Mira von Hohenfurt');
    expect(
      backlinks(articles())
        .get(mira.id)
        ?.map((a) => a.title),
    ).toEqual(['Hohenfurt']);
  });

  it('hält Verweise auseinander, wenn zwei Artikel gleich heißen', async () => {
    const { db, byTitle, text, articles } = await setup();
    const harbour = byTitle('Hafenviertel');
    // Die Schenke verweist im Steckbrief auf das Hafenviertel.
    expect(text('Zum Krummen Aal')).toContain('[[Hafenviertel]]');
    const second = createArticle(db, { title: 'Hafenviertel' })!;
    // Der alte Verweis führt weiter zum alten Artikel – jetzt mit Kennung.
    expect(text('Zum Krummen Aal')).toContain(`[[Hafenviertel~${harbour.id}]]`);
    const index = linkIndex(articles());
    expect(index.resolve(`Hafenviertel~${harbour.id}`)?.id).toBe(harbour.id);
    expect(index.targetOf(second.id)).toEqual({ title: 'Hafenviertel', unique: false });
    // Wird der zweite umbenannt, ist der Titel wieder eindeutig und die Kennung verschwindet.
    renameArticle(db, second.id, 'Neues Hafenviertel');
    expect(text('Zum Krummen Aal')).toContain('[[Hafenviertel]]');
    expect(text('Zum Krummen Aal')).not.toContain('~');
  });

  it('findet Verweise über Zweitnamen und behält den gezeigten Text', async () => {
    const { db, byTitle, text, articles } = await setup();
    const odo = byTitle('Odo Tannhaus');
    savePageText(
      db,
      odo.id,
      odo.docs[0]!.id,
      'Er lebt in [[Die Furt]] und liebt [[Hohenfurt|die Stadt]].',
    );
    const city = byTitle('Hohenfurt');
    expect(linkIndex(articles()).resolve('die furt')?.id).toBe(city.id);
    renameArticle(db, city.id, 'Hohenfurt am Fluss');
    // Der Zweitname gilt weiter; der andere Verweis bekommt den neuen Titel, sein Text bleibt.
    expect(text('Odo Tannhaus')).toBe(
      'Er lebt in [[Die Furt]] und liebt [[Hohenfurt am Fluss|die Stadt]].',
    );
    setArticleMeta(db, city.id, {
      aliases: ['Flussstadt', ' flussstadt ', ''],
      tags: ['Stadt', 'Hafen'],
    });
    expect(byTitle('Hohenfurt am Fluss')).toMatchObject({
      aliases: ['Flussstadt'],
      tags: ['Stadt', 'Hafen'],
    });
    // Ohne den Zweitnamen führt „Die Furt“ nirgends mehr hin. Der Verweis bleibt beim Artikel und
    // zeigt weiter denselben Wortlaut.
    expect(linkIndex(articles()).resolve('Die Furt')).toBeNull();
    expect(text('Odo Tannhaus')).toContain('[[Hohenfurt am Fluss|Die Furt]]');
  });

  it('verschiebt Artikel, aber nie unter sich selbst', async () => {
    const { db, byTitle, articles } = await setup();
    const city = byTitle('Hohenfurt');
    const harbour = byTitle('Hafenviertel');
    const store = byTitle('Der Speicher');
    expect(isWithin(articles(), store.id, city.id)).toBe(true);
    expect(moveArticle(db, city.id, store.id)).toBe(false);
    expect(moveArticle(db, city.id, city.id)).toBe(false);
    expect(moveArticle(db, store.id, harbour.id)).toBe(false);
    expect(moveArticle(db, store.id, 'gibtsnicht')).toBe(false);
    expect(moveArticle(db, store.id, null)).toBe(true);
    expect(byTitle('Der Speicher').parentId).toBeNull();
    expect(moveArticle(db, store.id, city.id)).toBe(true);
    expect(byTitle('Der Speicher').parentId).toBe(city.id);
  });

  it('löscht Artikel und holt sie zurück', async () => {
    const { db, byTitle, text, articles } = await setup();
    const harbour = byTitle('Hafenviertel');
    const store = byTitle('Der Speicher');
    const owner = Object.values(db.getSnapshot().entities).find(
      (e) => e.lk?.resourceId === harbour.id,
    )!;
    const undo = deleteArticle(db, harbour.id)!;
    expect(articles()[harbour.id]).toBeUndefined();
    // Der Unterartikel rückt nach oben, der Eintrag der Welt bleibt ohne Verknüpfung.
    expect(byTitle('Der Speicher').parentId).toBe(harbour.parentId);
    expect(db.getSnapshot().entities[owner.id]).toMatchObject({ name: 'Hafenviertel', lk: null });
    // Der Verweis bleibt als Name stehen und führt ins Leere.
    expect(text('Zum Krummen Aal')).toContain('[[Hafenviertel]]');
    expect(linkIndex(articles()).resolve('Hafenviertel')).toBeNull();
    undo();
    expect(articles()[harbour.id]).toMatchObject({ title: 'Hafenviertel' });
    expect(articles()[store.id]!.parentId).toBe(harbour.id);
    expect(db.getSnapshot().entities[owner.id]!.lk).toEqual(owner.lk);
    expect(deleteArticle(db, 'gibtsnicht')).toBeNull();
  });

  it('verwaltet die Seiten eines Artikels', async () => {
    const { db, byTitle } = await setup();
    const city = byTitle('Hohenfurt');
    // Hohenfurt: Text, Karte, Zeitleiste, Zeichenfläche.
    const pageId = addPage(db, city.id, ' Gerüchte ')!;
    expect(byTitle('Hohenfurt').docs.map((d) => d.kind)).toEqual([
      'page',
      'map',
      'page',
      'time',
      'board',
    ]);
    renamePage(db, city.id, pageId, 'Gerede');
    savePageText(db, city.id, pageId, 'Man sagt, die Fähre sei verflucht.');
    expect(byTitle('Hohenfurt').docs[2]).toMatchObject({
      title: 'Gerede',
      text: 'Man sagt, die Fähre sei verflucht.',
    });
    const undo = removePage(db, city.id, pageId)!;
    expect(byTitle('Hohenfurt').docs).toHaveLength(4);
    undo();
    expect(byTitle('Hohenfurt').docs[2]).toMatchObject({ id: pageId, title: 'Gerede' });
    expect(addPage(db, 'gibtsnicht')).toBeNull();
    expect(removePage(db, city.id, 'gibtsnicht')).toBeNull();
  });

  it('ein Artikel und ein Eintrag gleichen Namens gehören zusammen – nichts entsteht doppelt', async () => {
    const { db } = await setup();
    const named = (name: string) =>
      Object.values(db.getSnapshot().entities).filter((e) => e.name === name);
    // Erst der Eintrag, dann der Artikel: Der Artikel wird sein Text.
    const ferryman = db.put('entities', createEntity({ kind: 'person', name: 'Lando Furtner' }));
    const article = createArticle(db, {
      title: 'Lando Furtner',
      text: '> [!steckbrief]\n> Spezies: Mensch\n> Beruf: Fährmann',
    })!;
    expect(db.getSnapshot().entities[ferryman.id]!.lk?.resourceId).toBe(article.id);
    const sync = syncFacts(db, [article.id]);
    expect(sync.created).toEqual([]);
    expect(named('Lando Furtner')).toHaveLength(1);

    // Erst der Artikel, dann der Eintrag: Verbunden wird, sobald beide da sind.
    const mill = createArticle(db, { title: 'Alte Mühle' })!;
    const place = db.put('entities', createEntity({ kind: 'place', name: 'alte mühle' }));
    expect(twins(db.getSnapshot()).map((twin) => twin.entity.id)).toEqual([place.id]);
    linkTwins(db);
    expect(db.getSnapshot().entities[place.id]!.lk?.resourceId).toBe(mill.id);
    expect(twins(db.getSnapshot())).toEqual([]);

    // Zwei Einträge gleichen Namens: Wayfarer rät nicht, wer gemeint ist.
    db.put('entities', createEntity({ kind: 'place', name: 'Nordtor' }));
    db.put('entities', createEntity({ kind: 'place', name: 'Nordtor' }));
    createArticle(db, { title: 'Nordtor' });
    expect(named('Nordtor').every((e) => e.lk === null)).toBe(true);

    // Der Steckbrief nennt eine andere Art als der Eintrag: Das sind zwei Dinge.
    const eel = db.put('entities', createEntity({ kind: 'person', name: 'Krummzahn' }));
    createArticle(db, { title: 'Krummzahn', text: '> [!steckbrief]\n> Art: Dorf' });
    expect(db.getSnapshot().entities[eel.id]!.lk).toBeNull();
  });

  it('zieht Verweise nur dort nach, wo sich etwas ändert', async () => {
    const { articles } = await setup();
    expect(relinked(articles(), articles())).toEqual([]);
  });
});
