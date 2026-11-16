import { describe, expect, it } from 'vitest';
import { demoCampaign } from '../../data/__fixtures__/demoWorld';
import { ArticleSchema, createEntity, type CampaignData, type Entity } from '../../domain/schema';
import { pastPlaceIds, placeTreeRows, splitPast, textsWithoutEntry } from './model';

const year = 365 * 24 * 60;
const withEntities = (source: CampaignData, ...entities: Entity[]): CampaignData => ({
  ...source,
  entities: { ...source.entities, ...Object.fromEntries(entities.map((e) => [e.id, e])) },
});

describe('Vergangenheit in der Übersicht', () => {
  it('trennt Tote und Untergegangenes ab, ohne etwas wegzulassen', () => {
    const base = demoCampaign();
    const king = createEntity({ kind: 'person', name: 'König Odran', person: { status: 'dead' } });
    const order = createEntity({ kind: 'faction', name: 'Orden der Asche' });
    order.ended = { at: base.state.now - 200 * year, precision: 'year' };
    const data = withEntities(base, king, order);
    const all = Object.values(data.entities);
    const { present, past } = splitPast(data, all);
    expect(past.map((e) => e.name).sort()).toEqual(['König Odran', 'Orden der Asche']);
    expect(present.length + past.length).toBe(all.length);
  });

  it('nimmt Orte nur mit allem darin aus dem Baum – ein Reich mit lebender Stadt bleibt', () => {
    const base = demoCampaign();
    const long = base.state.now - 300 * year;
    const realm = createEntity({ kind: 'place', name: 'Altreich', place: { category: 'Reich' } });
    realm.ended = { at: long, precision: 'year' };
    const sunken = createEntity({
      kind: 'place',
      name: 'Versunkene Stadt',
      place: { category: 'Stadt', parentId: realm.id },
    });
    sunken.ended = { at: long, precision: 'year' };
    const empire = createEntity({
      kind: 'place',
      name: 'Kaiserreich',
      place: { category: 'Reich' },
    });
    empire.ended = { at: long, precision: 'year' };
    const town = createEntity({
      kind: 'place',
      name: 'Neustadt',
      place: { category: 'Stadt', parentId: empire.id },
    });
    const data = withEntities(base, realm, sunken, empire, town);
    const past = pastPlaceIds(data);
    expect(past.has(realm.id)).toBe(true);
    expect(past.has(sunken.id)).toBe(true);
    expect(past.has(empire.id)).toBe(false);
    expect(past.has(town.id)).toBe(false);
    // Der Baum der Vergangenheit hält Altreich mit seiner Stadt zusammen.
    const rows = placeTreeRows(data, {}, past);
    expect(rows.map((row) => [row.place.name, row.depth])).toEqual([
      ['Altreich', 0],
      ['Versunkene Stadt', 1],
    ]);
  });

  it('kennt die Texte ohne Eintrag – ohne Vorlagen und Texte von Einträgen', () => {
    const base = demoCampaign();
    const folder = ArticleSchema.parse({ id: 'ordner1', title: 'Orte der Küste' });
    const template = ArticleSchema.parse({ id: 'vorlage1', title: 'Vorlage Ort', template: true });
    const owned = ArticleSchema.parse({ id: 'artikel1', title: 'Wirt Holm' });
    const holm = createEntity({ kind: 'person', name: 'Wirt Holm' });
    holm.lk = { resourceId: owned.id } as NonNullable<Entity['lk']>;
    const data = {
      ...withEntities(base, holm),
      articles: { [folder.id]: folder, [template.id]: template, [owned.id]: owned },
    };
    expect(textsWithoutEntry(data).map((a) => a.title)).toEqual(['Orte der Küste']);
  });
});
