/** Platzhalter: nur, solange noch nichts Eigenes dasteht. Erfundene Welt. */
import { describe, expect, it } from 'vitest';
import { emptyCampaign } from '../../data/seed';
import {
  ArticleSchema,
  createEntity,
  createStory,
  newId,
  type Article,
  type CampaignData,
  type Entity,
} from '../schema';
import { articleHasText, hasOwnWriting, isStub, stubRows } from '../stub';
import { ELARIS_CALENDAR } from '../time/elaris';

const article = (title: string, text: string): Article =>
  ArticleSchema.parse({
    id: newId(),
    created: '',
    updated: '',
    title,
    docs: [{ id: newId(), text }],
  });

function world(entities: Entity[], articles: Article[] = []): CampaignData {
  const base = emptyCampaign('Testwelt', ELARIS_CALENDAR, 0) as CampaignData;
  return {
    ...base,
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    articles: Object.fromEntries(articles.map((entry) => [entry.id, entry])),
  };
}

describe('Platzhalter', () => {
  it('ist ein Eintrag nur, wenn er als Platzhalter angelegt wurde', () => {
    const plain = createEntity({ kind: 'place', name: 'Hohenfurt' });
    const stub = createEntity({ kind: 'place', name: 'Salzgrotte', stub: true });
    const data = world([plain, stub]);
    expect(isStub(data, plain)).toBe(false);
    expect(isStub(data, stub)).toBe(true);
    expect(isStub(data, undefined)).toBe(false);
  });

  it('bleibt es mit dem einen Satz vom Anlegen', () => {
    const stub = createEntity({
      kind: 'person',
      name: 'Lando Furtner',
      stub: true,
      tagline: 'Fährmann an der Furt',
    });
    expect(isStub(world([stub]), stub)).toBe(true);
  });

  it('gilt von selbst nicht mehr, sobald Notizen oder ein Geheimnis dastehen', () => {
    const noted = createEntity({ kind: 'person', name: 'Mira Tannhaus', stub: true, notes: 'x' });
    const secret = createEntity({ kind: 'person', name: 'Odo Tannhaus', stub: true, secret: 'y' });
    const data = world([noted, secret]);
    expect(hasOwnWriting(data, noted)).toBe(true);
    expect(isStub(data, noted)).toBe(false);
    expect(isStub(data, secret)).toBe(false);
  });

  it('bleibt es mit einem leeren Steckbrief-Gerüst – und endet mit dem ersten geschriebenen Wort', () => {
    const empty = article('Salzgrotte', '> [!steckbrief]\n> Art: \n> Liegt in: \n');
    const filled = article('Burg Graufels', '> [!steckbrief]\n> Art: Burg\n');
    const written = article('Hohenfurt', 'Ein Dorf an der Furt.');
    expect(articleHasText(empty)).toBe(false);
    expect(articleHasText(filled)).toBe(true);
    expect(articleHasText(written)).toBe(true);
    const link = (entry: Article) => ({ lk: { resourceId: entry.id, title: entry.title } });
    const a = createEntity({ kind: 'place', name: 'Salzgrotte', stub: true, ...link(empty) });
    const b = createEntity({ kind: 'place', name: 'Burg Graufels', stub: true, ...link(filled) });
    const c = createEntity({ kind: 'place', name: 'Hohenfurt', stub: true, ...link(written) });
    const data = world([a, b, c], [empty, filled, written]);
    expect(isStub(data, a)).toBe(true);
    expect(isStub(data, b)).toBe(false);
    expect(isStub(data, c)).toBe(false);
  });

  it('listet für „Noch zu schreiben“ nach Geschichte, die ohne Geschichte zuletzt', () => {
    const zoll = createStory({ title: 'Der Zoll an der Furt' });
    const burg = createStory({ title: 'Burg Graufels fällt' });
    const lando = createEntity({
      kind: 'person',
      name: 'Lando Furtner',
      stub: true,
      fromStoryId: zoll.id,
    });
    const ilka = createEntity({
      kind: 'person',
      name: 'Ilka Sturmfels',
      stub: true,
      fromStoryId: burg.id,
    });
    const grotte = createEntity({ kind: 'place', name: 'Salzgrotte', stub: true });
    // Die Geschichte gibt es nicht mehr: Der Platzhalter bleibt, ohne Geschichte.
    const lost = createEntity({ kind: 'item', name: 'Zollsiegel', stub: true, fromStoryId: 'weg' });
    const done = createEntity({ kind: 'place', name: 'Hohenfurt', stub: true, notes: 'Dorf' });
    const data = {
      ...world([lando, ilka, grotte, lost, done]),
      stories: { [zoll.id]: zoll, [burg.id]: burg },
    };
    expect(stubRows(data).map((row) => [row.entity.name, row.story?.title ?? null])).toEqual([
      ['Ilka Sturmfels', 'Burg Graufels fällt'],
      ['Lando Furtner', 'Der Zoll an der Furt'],
      ['Salzgrotte', null],
      ['Zollsiegel', null],
    ]);
  });
});
