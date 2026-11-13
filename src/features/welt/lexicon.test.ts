import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity, createRelation } from '../../domain/schema';
import { NO_LEXICON_FILTER, lexicon, lexiconFacets } from './lexicon';

/** Ein erfundenes Herbarium rund um Hohenfurt. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const put = (init: object) => db.put('entities', createEntity(init as never));
  const mark = put({ kind: 'place', name: 'Nordmark', place: { category: 'Region' } });
  const forest = put({ kind: 'place', name: 'Dunkelwald', place: { parentId: mark.id } });
  const swamp = put({ kind: 'place', name: 'Krummzahn', place: { category: 'Sumpf' } });
  put({
    kind: 'plant',
    name: 'Mondkraut',
    tagline: 'Senkt Fieber.',
    plant: {
      category: 'Kraut',
      habitat: ['Wald'],
      seasons: ['Frühling'],
      rarity: 'rare',
      price: 2.5,
    },
  });
  put({ kind: 'plant', name: 'Sumpfwurz', plant: { category: 'Kraut', habitat: ['Sümpfe'] } });
  put({ kind: 'plant', name: 'Eisenbuche', plant: { category: 'Baum', regionIds: [mark.id] } });
  put({ kind: 'plant', name: 'Irrlichtpilz', plant: { habitat: ['Schilfgürtel', 'Moorland'] } });
  return { db, mark, forest, swamp, put };
}

const names = (groups: ReturnType<typeof lexicon>) =>
  groups.map((g) => `${g.category || '–'}: ${g.rows.map((r) => r.entity.name).join(', ')}`);

describe('Lexikon der Pflanzen', () => {
  it('gruppiert nach Einordnung, ohne Einordnung zuletzt', async () => {
    const { db } = await setup();
    const groups = lexicon(db.getSnapshot(), 'plant');
    expect(names(groups)).toEqual([
      'Baum: Eisenbuche',
      'Kraut: Mondkraut, Sumpfwurz',
      '–: Irrlichtpilz',
    ]);
    const moon = groups[1]!.rows[0]!;
    expect(moon).toMatchObject({
      line: 'Senkt Fieber.',
      rarity: 'selten',
      habitats: 'Wald',
      seasons: 'Frühling',
      price: '2,5 GM',
    });
  });

  it('filtert nach Lebensraum, Gegend und Jahreszeit', async () => {
    const { db, mark, forest, swamp } = await setup();
    const data = db.getSnapshot();
    const by = (filter: Partial<typeof NO_LEXICON_FILTER>) =>
      names(lexicon(data, 'plant', { ...NO_LEXICON_FILTER, ...filter }));
    // „Sümpfe“ und „Moorland“ sind beide Sumpf.
    expect(by({ habitat: 'k:sumpf' })).toEqual(['Kraut: Sumpfwurz', '–: Irrlichtpilz']);
    expect(by({ habitat: 'w:schilfgürtel' })).toEqual(['–: Irrlichtpilz']);
    // Der Dunkelwald liegt in der Nordmark (Eisenbuche); sein Name sagt Wald (Mondkraut).
    expect(by({ regionId: forest.id })).toEqual(['Baum: Eisenbuche', 'Kraut: Mondkraut']);
    expect(by({ regionId: mark.id })).toEqual(['Baum: Eisenbuche']);
    expect(by({ regionId: swamp.id })).toEqual(['Kraut: Sumpfwurz', '–: Irrlichtpilz']);
    // Im Winter fehlt das Mondkraut; ohne Angabe wächst alles das ganze Jahr.
    expect(by({ season: 's:winter' })).toEqual([
      'Baum: Eisenbuche',
      'Kraut: Sumpfwurz',
      '–: Irrlichtpilz',
    ]);
    expect(by({ season: 'm:0' })).toHaveLength(3);
  });

  it('bietet nur an, was an den Einträgen vorkommt', async () => {
    const { db, mark } = await setup();
    const facets = lexiconFacets(db.getSnapshot(), 'plant');
    expect(facets.habitats).toEqual([
      { value: 'w:schilfgürtel', label: 'Schilfgürtel', count: 1 },
      { value: 'k:sumpf', label: 'Sumpf', count: 2 },
      { value: 'k:wald', label: 'Wald', count: 1 },
    ]);
    expect(facets.regions.map((p) => p.id)).toEqual([mark.id]);
    expect(facets.seasons[0]).toEqual({ value: 's:spring', label: 'Frühling' });
    expect(facets.seasons[4]).toEqual({ value: 'm:0', label: 'Tauwind' });
  });
});

describe('Lexikon der Berufe', () => {
  it('nennt Werkzeug und wer ihn ausübt', async () => {
    const { db, put } = await setup();
    const smith = put({
      kind: 'profession',
      name: 'Schmied',
      profession: { category: 'Handwerk', tool: 'Schmiedewerkzeug' },
    });
    const brann = put({ kind: 'person', name: 'Brann Eichwald' });
    db.put('relations', createRelation({ from: brann.id, to: smith.id, type: 'practises' }));
    const [group] = lexicon(db.getSnapshot(), 'profession');
    expect(group!.category).toBe('Handwerk');
    expect(group!.rows[0]!.tool).toBe('Schmiedewerkzeug');
    expect(group!.rows[0]!.people.map((p) => p.name)).toEqual(['Brann Eichwald']);
    expect(lexiconFacets(db.getSnapshot(), 'profession').habitats).toEqual([]);
  });
});
