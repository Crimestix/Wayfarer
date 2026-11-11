import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { toTime } from '../../domain/time/calendar';
import { ELARIS_CALENDAR } from '../../domain/time/elaris';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  COLLECTION_NAMES,
  COLLECTION_SCHEMAS,
  createEntity,
  createRelation,
  type CampaignData,
  type Entity,
} from '../../domain/schema';
import { MISSING_NAME_TAG, placeholderName } from '../import/v157';
import { lkExportFixture } from './__fixtures__/lkExport';
import { adoptArticle, applyLkImport, canUndoLkImport, undoLkImport } from './actions';
import { planLkImport } from './apply';
import { readLkFile } from './files';
import { convertLkExport, pinScale, pinToPixel, resourceOfUri } from './lkexport';
import {
  articlePath,
  articleTree,
  asNodes,
  backlinks,
  childArticles,
  entitiesOfArticle,
  missingDocs,
  searchArticles,
  searchIndex,
  shownDocs,
  splitPage,
} from './model';
import { setLocalMedia } from '../../data/media';
import { campaignImages, fetchImages, formatBytes } from './media';
import { recognizeKind } from './recognize';

const conversion = () => convertLkExport(lkExportFixture());
const named = (data: CampaignData, name: string): Entity | undefined =>
  Object.values(data.entities).find((e) => e.name === name);

describe('LegendKeeper-Export lesen', () => {
  it('liest die gepackte Datei und weist anderes mit einem klaren Satz ab', async () => {
    const packed = new Blob([gzipSync(JSON.stringify(lkExportFixture()))]);
    expect(convertLkExport(await readLkFile(packed)).stats.articles).toBe(13);
    // Auch ungepackt, falls jemand die Datei schon ausgepackt hat.
    const plain = new Blob([JSON.stringify(lkExportFixture())]);
    expect(convertLkExport(await readLkFile(plain)).stats.articles).toBe(13);
    await expect(readLkFile(new Blob(['kein json']))).rejects.toThrow(/kein LegendKeeper-Export/);
    await expect(readLkFile(new Blob([new Uint8Array([0x1f, 0x8b, 1, 2, 3])]))).rejects.toThrow(
      /auspacken/,
    );
    expect(() => convertLkExport({ irgendwas: true })).toThrow(/kein LegendKeeper-Export/);
  });

  it('zählt, was drin ist, und überspringt Unlesbares', () => {
    const { stats, articles, maps } = conversion();
    expect(stats).toMatchObject({
      articles: 13,
      maps: 1,
      pins: 3,
      shapes: 2,
      boards: 1,
      timelines: 1,
      events: 1,
      skipped: 1,
    });
    expect(articles).toHaveLength(13);
    expect(maps).toHaveLength(1);
    // Banner, Bild im Text, zwei Steckbrief-Bilder, Kartenbild.
    expect(stats.images).toBe(5);
  });

  it('wandelt Text, Verweise, Listen, Geheimes und Unbekanntes um', () => {
    const city = conversion().articles.find((a) => a.title === 'Hohenfurt')!;
    expect(city).toMatchObject({
      parentId: 'laender1',
      aliases: ['Die Furt'],
      tags: ['Stadt'],
      icon: 'city',
      banner: 'https://assets.example.org/banner.jpg',
      source: 'legendkeeper',
      template: false,
    });
    const nodes = asNodes(city.docs[0]!.nodes);
    // Das Verzeichnis der Unterseiten entfällt: Die Unterartikel führt Wayfarer selbst auf.
    expect(nodes.map((n) => n.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'secret',
      'image',
      'paragraph',
    ]);
    const paragraph = nodes[1]!;
    expect(paragraph.type === 'paragraph' && paragraph.inlines).toEqual([
      { type: 'text', text: 'Hohenfurt liegt an der Brack. ' },
      { type: 'text', text: 'Hier', bold: true },
      { type: 'text', text: ' herrscht ' },
      { type: 'mention', resourceId: 'mira0001', label: 'Mira Tannhaus' },
      { type: 'text', text: '.' },
    ]);
    // Aus der unbekannten Blockart bleibt der Text.
    const rescued = nodes[5]!;
    expect(rescued.type === 'paragraph' && rescued.inlines).toEqual([
      { type: 'text', text: 'Gerettet.' },
    ]);
    expect(city.docs.map((d) => d.kind)).toEqual(['page', 'map', 'time', 'board']);
  });

  it('übersetzt den Steckbrief', () => {
    const inn = conversion().articles.find((a) => a.title === 'Zum Krummen Aal')!;
    const side = asNodes(inn.sidebar);
    expect(side.map((n) => n.type)).toEqual(['image', 'group', 'links']);
    expect(side[1]).toMatchObject({ type: 'group', title: 'Zusammenfassung' });
    expect(side[2]).toMatchObject({
      type: 'links',
      title: 'Liegt in',
      items: [{ resourceId: 'hafen001' }],
    });
  });

  it('rechnet Kartenpunkte in Bildpunkte um', () => {
    expect(pinScale(2000, 1000)).toBe(8);
    expect(pinScale(7016, 4960)).toBe(32);
    expect(pinScale(1448, 1086)).toBe(8);
    expect(pinScale(200, 100)).toBe(1);
    expect(pinToPixel([-50, 100], { minX: 0, maxY: 0, scale: 8 })).toEqual([800, 400]);
    expect(pinToPixel(['x', 1], { minX: 0, maxY: 0, scale: 8 })).toBeNull();
    expect(resourceOfUri('abc12345')).toBe('abc12345');
    expect(resourceOfUri('lk://resources/abc12345')).toBe('abc12345');
    expect(resourceOfUri('lk://resources/abc12345/docs/xyz')).toBe('abc12345');
    expect(resourceOfUri(undefined)).toBe('');

    const map = conversion().maps[0]!;
    expect(map).toMatchObject({
      id: 'hohenf01-kartehf',
      name: 'Hohenfurt',
      lk: { resourceId: 'hohenf01', docId: 'kartehf' },
      frame: { width: 2000, height: 1000 },
      image: 'https://assets.example.org/hohenfurt.png',
    });
    expect(map.markers.map((m) => [m.label, m.x, m.y, m.articleId])).toEqual([
      ['Krummer Aal', 800, 400, 'aal00001'],
      ['Speicher', 1600, 800, 'speich01'],
      ['Alte Eiche', 80, 80, null],
    ]);
    expect(map.shapes).toEqual([
      {
        id: 'weg1',
        kind: 'path',
        label: 'Uferweg',
        points: [
          [80, 80],
          [320, 160],
          [720, 240],
        ],
        articleId: null,
      },
      {
        id: 'gebiet1',
        kind: 'region',
        label: 'Hafenviertel',
        points: [
          [640, 320],
          [960, 320],
          [960, 560],
        ],
        articleId: 'hafen001',
      },
    ]);
  });
});

describe('Erkennen, was ein Artikel beschreibt', () => {
  const kindOf = (name: string) => {
    const info = conversion().resources.find((r) => r.name === name)!;
    return recognizeKind(info);
  };

  it('nutzt Vorlage, Schlagworte, Symbol und Karte', () => {
    expect(kindOf('Hohenfurt')).toEqual({ kind: 'place', category: 'Stadt' });
    // Das Gotteshaus ist nur das Symbol der Vorlage, keine Einordnung.
    expect(kindOf('Zum Krummen Aal')).toEqual({ kind: 'place', category: '' });
    expect(kindOf('Hafenviertel')).toEqual({ kind: 'place', category: '' });
    expect(kindOf('Mira Tannhaus')).toEqual({ kind: 'person', category: '' });
    expect(kindOf('Odo Tannhaus')).toEqual({ kind: 'person', category: '' });
    expect(kindOf('Die Aalfischer')).toEqual({ kind: 'faction', category: '' });
  });

  it('hält Ordner und Vorlagen heraus', () => {
    expect(kindOf('Länder und Städte')).toBeNull();
    expect(kindOf('Wichtige Leute')).toBeNull();
    expect(kindOf('Person')).toBeNull();
  });

  it('entscheidet nicht bei widersprüchlichen Hinweisen', () => {
    const base = conversion().resources.find((r) => r.name === 'Odo Tannhaus')!;
    expect(recognizeKind({ ...base, tags: ['Stadt'] })).toBeNull();
    expect(recognizeKind({ ...base, icon: 'file-lines' })).toBeNull();
    // Eine Karte allein macht noch keinen Ort.
    expect(recognizeKind({ ...base, icon: 'file-lines', hasMap: true })).toBeNull();
  });
});

describe('Übernahme in den Spielstand', () => {
  it('legt Artikel, Karten und erkannte Einträge an und ordnet sie ein', () => {
    const plan = planLkImport(elarisCampaign(), conversion());
    const { data, counts } = plan;
    for (const name of COLLECTION_NAMES)
      for (const doc of Object.values(data[name])) COLLECTION_SCHEMAS[name].parse(doc);

    expect(Object.keys(data.articles)).toHaveLength(13);
    expect(counts.created).toEqual({ person: 4, place: 4, faction: 1, item: 0 });

    const city = named(data, 'Hohenfurt')!;
    const inn = named(data, 'Zum Krummen Aal')!;
    const harbour = named(data, 'Hafenviertel')!;
    const store = named(data, 'Der Speicher')!;
    const mira = named(data, 'Mira Tannhaus')!;
    const odo = named(data, 'Odo Tannhaus')!;
    const jost = named(data, 'Jost Reuse')!;
    const vera = named(data, 'Vera Kohl')!;
    const guild = named(data, 'Die Aalfischer')!;

    expect(city).toMatchObject({
      kind: 'place',
      aliases: ['Die Furt'],
      lk: { resourceId: 'hohenf01', title: 'Hohenfurt' },
      place: { category: 'Stadt', parentId: null },
    });
    // „Liegt in“ aus dem Steckbrief geht der Lage im Baum vor.
    expect(inn).toMatchObject({
      kind: 'place',
      tagline: 'Eine Hafenschenke mit schiefem Giebel.',
      image: 'https://assets.example.org/aal.jpg',
      place: { parentId: harbour.id },
    });
    expect(harbour).toMatchObject({ kind: 'place', place: { parentId: city.id } });
    expect(store).toMatchObject({ kind: 'place', place: { parentId: harbour.id } });
    expect(mira).toMatchObject({
      kind: 'person',
      tagline: 'Vögtin von Hohenfurt, streng und müde.',
      person: { homeId: city.id },
    });
    // Ohne Zusammenfassung gilt der erste Satz des Artikels.
    expect(odo).toMatchObject({ tagline: 'Miras Bruder, Fährmann.', person: { homeId: city.id } });
    // Der Ordner „Wichtige Leute“ ist kein Ort: kein Wohnort.
    expect(vera).toMatchObject({ kind: 'person', person: { homeId: null } });
    expect(guild).toMatchObject({ kind: 'faction', faction: { seatId: inn.id } });
    // Weder Entwurf noch Vorlage noch Ordner stehen in der Welt.
    for (const name of ['Alte Idee', 'Person', 'Wichtige Leute', 'Länder und Städte'])
      expect(named(data, name)).toBeUndefined();

    const relations = Object.values(data.relations).map(
      (r) =>
        `${data.entities[r.from]?.name} ${r.type}${r.label ? `:${r.label}` : ''} ${data.entities[r.to]?.name}`,
    );
    expect(relations.sort()).toEqual(
      [
        'Mira Tannhaus friend Odo Tannhaus',
        'Mira Tannhaus enemy Die Aalfischer',
        'Odo Tannhaus member Die Aalfischer',
        'Jost Reuse member Die Aalfischer',
        'Die Aalfischer custom:gegründet von Odo Tannhaus',
      ].sort(),
    );
    expect(counts.relations).toBe(5);
    expect(plan.sections.adopted.join(' ')).toMatch(
      /5 Beziehungen aus den Steckbriefen und dem Aufbau des Wikis: 2 Mitgliedschaften, 1 Freundschaft, 1 Feindschaft, 1 weitere./,
    );

    const map = data.maps['hohenf01-kartehf']!;
    expect(map.placeId).toBe(city.id);
    expect(map.markers.map((m) => m.entityId)).toEqual([inn.id, store.id, null]);

    expect(plan.personIds.sort()).toEqual([mira.id, odo.id, jost.id, vera.id].sort());
    expect(plan.sections.adopted[0]).toMatch(/^13 Artikel mit 10 Textseiten/);
    expect(plan.sections.hints.join(' ')).toMatch(/5 Bilder liegen weiterhin bei LegendKeeper/);
    expect(plan.sections.omitted.join(' ')).toMatch(/1 Zeichenfläche/);

    // Das Ereignis der Zeitleiste steht als Termin im Kalender – am Ort, auf den es verweist,
    // und abgehakt, weil es lange vor dem Jetzt der Kampagne liegt.
    expect(plan.counts.events).toBe(1);
    expect(plan.data.events['lk-zeit-faehre01']).toMatchObject({
      title: 'Die Fähre sinkt',
      at: toTime(ELARIS_CALENDAR, { year: 650 + 27387, month: 0, day: 1, hour: 0, minute: 0 }),
      timed: false,
      kind: 'world',
      placeId: city.id,
      done: true,
      details: 'Aus der Zeitleiste von „Hohenfurt“.',
    });
    expect(plan.sections.adopted.join(' ')).toMatch(
      /1 Ereignis aus den Zeitleisten steht als Termin im Kalender/,
    );
    expect(plan.sections.skipped).toHaveLength(1);
  });

  it('legt beim zweiten Einlesen nichts doppelt an', () => {
    const first = planLkImport(elarisCampaign(), conversion());
    const second = planLkImport(first.data, conversion());
    expect(second.counts.created).toEqual({ person: 0, place: 0, faction: 0, item: 0 });
    expect(second.counts.relations).toBe(0);
    expect(Object.keys(second.data.entities).sort()).toEqual(
      Object.keys(first.data.entities).sort(),
    );
    expect(Object.keys(second.data.relations)).toHaveLength(
      Object.keys(first.data.relations).length,
    );
    expect(Object.keys(second.data.articles)).toHaveLength(13);
    // Auch der Termin aus der Zeitleiste entsteht kein zweites Mal – und bleibt, wie er ist.
    expect(second.counts.events).toBe(0);
    expect(Object.keys(second.data.events)).toEqual(Object.keys(first.data.events));
    expect(second.sections.hints.join(' ')).toMatch(/1 Ereignis aus den Zeitleisten stand schon/);
  });

  it('lässt stehen, was schon eingetragen ist, und verknüpft Vorhandenes', () => {
    const base = elarisCampaign();
    const elsewhere = createEntity({ kind: 'place', name: 'Graufels' });
    const city = createEntity({
      kind: 'place',
      name: 'hohenfurt',
      tagline: 'Meine eigene Notiz.',
      place: { category: 'Festung', parentId: elsewhere.id },
    });
    const pending = createEntity({
      kind: 'person',
      name: placeholderName('mira0001'),
      tags: [MISSING_NAME_TAG],
      lk: { resourceId: 'mira0001', title: '' },
    });
    const hero = createEntity({ kind: 'character', name: 'Odo' });
    const known = createRelation({ from: pending.id, to: hero.id, type: 'friend' });
    const data: CampaignData = {
      ...base,
      entities: {
        [elsewhere.id]: elsewhere,
        [city.id]: city,
        [pending.id]: pending,
        [hero.id]: hero,
      },
      relations: { [known.id]: known },
      maps: {
        alt: COLLECTION_SCHEMAS.maps.parse({
          id: 'alt',
          created: base.campaign.created,
          updated: base.campaign.updated,
          name: 'Meine Stadtkarte',
          lk: { resourceId: 'hohenf01', docId: 'kartehf' },
          // Halb so groß wie das Bild im Export: Punkte und Linien rechnen sich um.
          frame: { width: 1000, height: 500 },
          scale: { kmPerUnit: 0.01 },
          markers: [
            { id: 'm1', x: 1, y: 2, lkFeatureId: 'pin1', entityId: elsewhere.id, label: 'Aal' },
            { id: 'm2', x: 5, y: 6, label: 'Von Hand' },
          ],
        }),
      },
    };
    const plan = planLkImport(data, conversion());
    const next = plan.data;

    // Die vorhandene Stadt wird verknüpft, nicht verdoppelt; eigene Angaben bleiben.
    expect(Object.values(next.entities).filter((e) => /hohenfurt/i.test(e.name))).toHaveLength(1);
    expect(next.entities[city.id]).toMatchObject({
      name: 'hohenfurt',
      tagline: 'Meine eigene Notiz.',
      lk: { resourceId: 'hohenf01' },
      place: { category: 'Festung', parentId: elsewhere.id },
    });
    // Der Verweis ohne Namen trägt jetzt seinen Namen.
    expect(next.entities[pending.id]).toMatchObject({ name: 'Mira Tannhaus', tags: [] });
    expect(plan.counts.named).toBe(1);
    expect(plan.personIds).toContain(pending.id);
    // „Odo Tannhaus“ gehört zum Gefährten Odo – keine zweite Person.
    expect(next.entities[hero.id]).toMatchObject({
      kind: 'character',
      lk: { resourceId: 'odo00001' },
    });
    expect(named(next, 'Odo Tannhaus')).toBeUndefined();
    expect(plan.counts.linked).toBe(2);
    // Die Freundschaft gab es schon.
    expect(
      Object.values(next.relations).filter(
        (r) => r.type === 'friend' && r.from === pending.id && r.to === hero.id,
      ),
    ).toHaveLength(1);

    // Die vorhandene Karte behält Kennung, Namen, Maßstab und ihre Verknüpfungen.
    expect(Object.keys(next.maps)).toEqual(['alt']);
    const map = next.maps.alt!;
    expect(map).toMatchObject({
      name: 'Meine Stadtkarte',
      frame: { width: 1000, height: 500 },
      scale: { kmPerUnit: 0.01 },
      image: 'https://assets.example.org/hohenfurt.png',
    });
    expect(map.markers.map((m) => [m.id, m.x, m.y, m.label])).toEqual([
      ['m1', 400, 200, 'Aal'],
      ['pin2', 800, 400, 'Speicher'],
      ['pin3', 40, 40, 'Alte Eiche'],
      ['m2', 5, 6, 'Von Hand'],
    ]);
    expect(map.markers[0]!.entityId).toBe(elsewhere.id);
    expect(map.shapes[0]!.points[0]).toEqual([40, 40]);
    // Der Artikel zeigt auf die vorhandene Karte.
    const article = next.articles.hohenf01!;
    expect(article.docs.find((d) => d.kind === 'map')?.mapId).toBe('alt');
  });

  it('legt ohne Erkennung nur Wiki und Karten an', () => {
    const base = elarisCampaign();
    const plan = planLkImport(base, conversion(), { recognize: false });
    expect(Object.keys(plan.data.entities)).toEqual(Object.keys(base.entities));
    expect(Object.keys(plan.data.relations)).toEqual(Object.keys(base.relations));
    expect(Object.keys(plan.data.articles)).toHaveLength(13);
    expect(plan.sections.hints.join(' ')).toMatch(/Erkennung war abgewählt/);
  });

  it('wird gespeichert, wieder gelesen und lässt sich zurücknehmen', async () => {
    const store = new MemoryStore();
    const db = await CampaignDb.create(store, elarisCampaign());
    const before = db.getSnapshot();
    const families = applyLkImport(db, planLkImport(before, conversion()), 'welt.lk');
    // Zwei Tannhaus: eine Familie aus dem Nachnamen.
    expect(families?.text).toBe('Familie Tannhaus angelegt (2 Mitglieder)');
    await db.flush();
    expect(store.files.has('articles/hohenf01.json')).toBe(true);
    const reopened = await CampaignDb.open(store);
    expect(reopened.problems).toEqual([]);
    expect(reopened.getSnapshot().articles).toEqual(db.getSnapshot().articles);
    expect(reopened.getSnapshot().maps).toEqual(db.getSnapshot().maps);

    expect(canUndoLkImport(db)).toBe(true);
    expect(undoLkImport(db)).toBe(true);
    expect(db.getSnapshot().articles).toEqual({});
    expect(Object.keys(db.getSnapshot().entities)).toEqual(Object.keys(before.entities));
    expect(undoLkImport(db)).toBe(false);
    await db.flush();
    expect(store.files.has('articles/hohenf01.json')).toBe(false);
  });

  it('nimmt eine Übernahme nicht mehr zurück, sobald etwas geändert wurde', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    applyLkImport(db, planLkImport(db.getSnapshot(), conversion()), 'welt.lk');
    const article = db.getSnapshot().articles.entwurf1!;
    const entity = adoptArticle(db, article, 'topic');
    expect(entity).toMatchObject({
      kind: 'topic',
      name: 'Alte Idee',
      lk: { resourceId: 'entwurf1' },
    });
    expect(canUndoLkImport(db)).toBe(false);
    expect(undoLkImport(db)).toBe(false);
    expect(entitiesOfArticle(db.getSnapshot(), 'entwurf1')).toHaveLength(1);
  });
});

describe('Wiki', () => {
  const articles = () => planLkImport(elarisCampaign(), conversion()).data.articles;

  it('baut den Baum in der Reihenfolge der Vorlage und hält Vorlagen getrennt', () => {
    const tree = articleTree(articles());
    expect(tree.roots.map((n) => n.article.title)).toEqual([
      'Länder und Städte',
      'Wichtige Leute',
      'Alte Idee',
    ]);
    expect(tree.templates.map((a) => a.title)).toEqual(['Person']);
    const city = tree.roots[0]!.children[0]!;
    expect(city.children.map((n) => n.article.title)).toEqual([
      'Zum Krummen Aal',
      'Hafenviertel',
      'Mira Tannhaus',
      'Odo Tannhaus',
      'Die Aalfischer',
    ]);
    expect(tree.roots[0]!.size).toBe(8);
    expect(articlePath(articles(), 'speich01').map((a) => a.title)).toEqual([
      'Länder und Städte',
      'Hohenfurt',
      'Hafenviertel',
    ]);
    expect(childArticles(articles(), 'hafen001').map((a) => a.title)).toEqual(['Der Speicher']);
  });

  it('übersteht fehlende Eltern und Kreise', () => {
    const all = articles();
    const broken = {
      ...all,
      speich01: { ...all.speich01!, parentId: 'weg' },
      laender1: { ...all.laender1!, parentId: 'hohenf01' },
    };
    const tree = articleTree(broken);
    const titles: string[] = [];
    const visit = (nodes: typeof tree.roots) =>
      nodes.forEach((n) => {
        titles.push(n.article.title);
        visit(n.children);
      });
    visit(tree.roots);
    expect(titles).toHaveLength(12);
    expect(new Set(titles).size).toBe(12);
    expect(articlePath(broken, 'hohenf01').map((a) => a.id)).toEqual(['laender1']);
  });

  it('trennt Seiten, die es zeigt, von denen, die noch fehlen', () => {
    const city = articles().hohenf01!;
    expect(shownDocs(city).map((d) => d.kind)).toEqual(['page', 'map']);
    expect(missingDocs(city).map((d) => d.kind)).toEqual(['time', 'board']);
    const inn = articles().aal00001!;
    const page = splitPage(articles(), inn, shownDocs(inn)[0]);
    // Der Steckbrief steht jetzt im Text der ersten Seite und wird beim Lesen wieder zum Kasten.
    expect(page.side.map((n) => n.type)).toEqual(['infobox']);
    const box = page.side[0]!;
    expect(box.type === 'infobox' && box.children.map((n) => n.type)).toEqual([
      'image',
      'group',
      'facts',
    ]);
    expect(page.body.map((n) => n.type)).toEqual(['paragraph']);
  });

  it('sucht in Titeln, Zweitnamen und im Text', () => {
    const index = searchIndex(articles());
    expect(searchArticles(index, 'tannhaus').map((h) => [h.article.title, h.where])).toEqual([
      ['Mira Tannhaus', 'title'],
      ['Odo Tannhaus', 'title'],
      // Auch Verweise im Fließtext und im Steckbrief zählen als Text.
      ['Die Aalfischer', 'text'],
      ['Hohenfurt', 'text'],
    ]);
    expect(searchArticles(index, 'furt')[0]).toMatchObject({ where: 'title' });
    expect(searchArticles(index, 'die furt')[0]).toMatchObject({ where: 'names' });
    const teer = searchArticles(index, 'TEER');
    expect(teer).toHaveLength(1);
    expect(teer[0]).toMatchObject({ where: 'text' });
    expect(teer[0]!.snippet).toMatch(/^… .*Liegt in: Hafenviertel Es riecht nach Teer\.$/);
    expect(searchArticles(index, 'fähre schlüssel').map((h) => h.article.title)).toEqual([
      'Mira Tannhaus',
    ]);
    // Vorlagen sind kein Inhalt.
    expect(searchArticles(index, 'person')).toEqual([]);
    expect(searchArticles(index, '   ')).toEqual([]);
  });

  it('weiß, wo ein Artikel erwähnt wird', () => {
    const links = backlinks(articles());
    expect(links.get('mira0001')?.map((a) => a.title)).toEqual(['Hohenfurt']);
    expect(links.get('odo00001')?.map((a) => a.title)).toEqual(['Die Aalfischer', 'Mira Tannhaus']);
    // Verweise auf gelöschte Artikel zählen nicht.
    expect(links.has('gibtsnicht')).toBe(false);
  });
});

describe('Bilder der Kampagne', () => {
  it('sammelt jedes Bild einmal: Karten, Banner, Artikel, Porträts', () => {
    const data = planLkImport(elarisCampaign(), conversion()).data;
    expect(campaignImages(data).map((item) => item.name)).toEqual([
      'aal-wappen.png',
      'aal.jpg',
      'banner.jpg',
      'hohenfurt.png',
      'markt.jpg',
    ]);
    expect(campaignImages(elarisCampaign())).toEqual([]);
  });

  it('holt nur, was fehlt, und lässt sich von einzelnen Fehlschlägen nicht aufhalten', async () => {
    const data = planLkImport(elarisCampaign(), conversion()).data;
    const images = campaignImages(data);
    setLocalMedia(['banner.jpg']);
    const asked: string[] = [];
    const steps: number[] = [];
    const result = await fetchImages(
      'ordner',
      images,
      (progress) => steps.push(progress.done),
      undefined,
      async (_root, _url, name) => {
        asked.push(name);
        if (name === 'markt.jpg') throw new Error('Dieses Bild gibt es am Ursprung nicht mehr.');
        return 1000;
      },
    );
    expect(asked.sort()).toEqual(['aal-wappen.png', 'aal.jpg', 'hohenfurt.png', 'markt.jpg']);
    expect(result).toMatchObject({ done: 4, total: 4, bytes: 3000 });
    expect(result.failed.map((f) => [f.item.name, f.reason])).toEqual([
      ['markt.jpg', 'Dieses Bild gibt es am Ursprung nicht mehr.'],
    ]);
    expect(steps[0]).toBe(0);
    expect(steps[steps.length - 1]).toBe(4);
    // Ein zweiter Versuch fragt nur noch nach dem, was fehlt.
    asked.length = 0;
    await fetchImages(
      'ordner',
      images,
      () => {},
      undefined,
      async (_r, _u, name) => {
        asked.push(name);
        return 1;
      },
    );
    expect(asked).toEqual(['markt.jpg']);
    setLocalMedia([]);
  });

  it('hält an, wenn abgebrochen wird', async () => {
    const data = planLkImport(elarisCampaign(), conversion()).data;
    setLocalMedia([]);
    const controller = new AbortController();
    let calls = 0;
    const result = await fetchImages(
      'ordner',
      campaignImages(data),
      () => {},
      controller.signal,
      async () => {
        calls++;
        controller.abort();
        return 1;
      },
    );
    // Was schon unterwegs war, wird fertig – mehr nicht.
    expect(calls).toBeLessThanOrEqual(4);
    expect(result.done).toBe(calls);
    expect(result.total).toBe(5);
    setLocalMedia([]);
  });

  it('nennt Datenmengen verständlich', () => {
    expect(formatBytes(1_350_000_000)).toBe('1,4 GB');
    expect(formatBytes(310_400_000)).toBe('310 MB');
    expect(formatBytes(2_000)).toBe('2 KB');
    expect(formatBytes(10)).toBe('1 KB');
  });
});
