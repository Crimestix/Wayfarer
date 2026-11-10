import { describe, expect, it } from 'vitest';
import { moveParty } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity, createRelation, type CampaignData, type Entity } from '../../domain/schema';
import { lkExportFixture } from '../wiki/__fixtures__/lkExport';
import { planLkImport } from '../wiki/apply';
import { convertLkExport } from '../wiki/lkexport';
import { placeTreeRows, searchWorld, worldCounts } from './model';
import { isKnown, scopeChoices, scopeMembers, visibleIds, visitedPlaces } from './scope';

const world = (): CampaignData =>
  planLkImport(elarisCampaign(), convertLkExport(lkExportFixture())).data;
const named = (data: CampaignData, name: string): Entity =>
  Object.values(data.entities).find((e) => e.name === name)!;
const names = (data: CampaignData, ids: Iterable<string>) =>
  [...ids].map((id) => data.entities[id]!.name).sort();

describe('Bereich der Welt', () => {
  it('umfasst den Ort, was darunter liegt, und wer dazugehört', () => {
    const data = world();
    expect(names(data, scopeMembers(data, named(data, 'Hohenfurt').id))).toEqual([
      'Der Speicher',
      'Die Aalfischer',
      'Hafenviertel',
      'Hohenfurt',
      'Jost Reuse',
      'Mira Tannhaus',
      'Odo Tannhaus',
      'Zum Krummen Aal',
    ]);
    // Im Hafenviertel sitzt die Zunft (in der Schenke) – ihre Mitglieder gehören dazu.
    expect(names(data, scopeMembers(data, named(data, 'Hafenviertel').id))).toEqual([
      'Der Speicher',
      'Die Aalfischer',
      'Hafenviertel',
      'Jost Reuse',
      'Odo Tannhaus',
      'Zum Krummen Aal',
    ]);
    expect(names(data, scopeMembers(data, named(data, 'Der Speicher').id))).toEqual([
      'Der Speicher',
    ]);
  });

  it('nimmt Familien, Arbeitsplätze und Gegenstände mit', () => {
    const base = world();
    const inn = named(base, 'Zum Krummen Aal');
    const mira = named(base, 'Mira Tannhaus');
    const family = createEntity({ kind: 'family', name: 'Familie Tannhaus' });
    const cook = createEntity({ kind: 'person', name: 'Koch', person: { workplaceId: inn.id } });
    const key = createEntity({ kind: 'item', name: 'Fährschlüssel', item: { holderId: mira.id } });
    const far = createEntity({ kind: 'item', name: 'Ferner Ring' });
    const member = createRelation({ from: mira.id, to: family.id, type: 'member' });
    const data: CampaignData = {
      ...base,
      entities: {
        ...base.entities,
        [family.id]: family,
        [cook.id]: cook,
        [key.id]: key,
        [far.id]: far,
      },
      relations: { ...base.relations, [member.id]: member },
    };
    const scope = scopeMembers(data, named(data, 'Hohenfurt').id);
    expect(scope.has(family.id)).toBe(true);
    expect(scope.has(cook.id)).toBe(true);
    expect(scope.has(key.id)).toBe(true);
    expect(scope.has(far.id)).toBe(false);
  });

  it('bietet den Ort der Gruppe und die Orte darüber an', async () => {
    const db = await CampaignDb.create(new MemoryStore(), world());
    expect(scopeChoices(db.getSnapshot(), null)).toEqual([]);
    const store = named(db.getSnapshot(), 'Der Speicher');
    moveParty(db, store.id);
    const data = db.getSnapshot();
    expect(scopeChoices(data, null).map((p) => p.name)).toEqual([
      'Der Speicher',
      'Hafenviertel',
      'Hohenfurt',
    ]);
    // Ein anderswo gewählter Bereich bleibt wählbar.
    const elsewhere = createEntity({ kind: 'place', name: 'Graufels' });
    const more = { ...data, entities: { ...data.entities, [elsewhere.id]: elsewhere } };
    expect(scopeChoices(more, elsewhere.id).map((p) => p.name)).toEqual([
      'Der Speicher',
      'Hafenviertel',
      'Hohenfurt',
      'Graufels',
    ]);

    // Besucht ist der Ort samt allem darüber – nicht, was daneben liegt.
    const visited = visitedPlaces(data);
    expect(names(data, visited)).toEqual(['Der Speicher', 'Hafenviertel', 'Hohenfurt']);
    expect(isKnown(named(data, 'Zum Krummen Aal'), visited)).toBe(false);
    expect(isKnown(named(data, 'Mira Tannhaus'), visited)).toBe(false);
    expect(isKnown(named(data, 'Die Aalfischer'), visited)).toBe(true);
  });

  it('grenzt Zählung, Baum und Suche ein', async () => {
    const db = await CampaignDb.create(new MemoryStore(), world());
    moveParty(db, named(db.getSnapshot(), 'Der Speicher').id);
    const data = db.getSnapshot();
    expect(visibleIds(data, { scopeId: null, knownOnly: false })).toBeNull();

    const harbour = visibleIds(data, { scopeId: named(data, 'Hafenviertel').id, knownOnly: false });
    expect(worldCounts(data, harbour)).toMatchObject({ place: 3, person: 2, faction: 1 });
    // Der Bereich steht im Baum ganz oben, obwohl er in der Welt tiefer liegt.
    expect(placeTreeRows(data, {}, harbour).map((r) => [r.place.name, r.depth])).toEqual([
      ['Hafenviertel', 0],
      ['Der Speicher', 1],
      ['Zum Krummen Aal', 1],
    ]);
    expect(searchWorld(data, 'tannhaus', 'all', harbour).map((e) => e.name)).toEqual([
      'Odo Tannhaus',
    ]);
    expect(searchWorld(data, 'tannhaus', 'all').map((e) => e.name)).toEqual([
      'Mira Tannhaus',
      'Odo Tannhaus',
    ]);

    const known = visibleIds(data, { scopeId: null, knownOnly: true })!;
    expect(worldCounts(data, known)).toMatchObject({ place: 3, person: 0, faction: 1 });
    const both = visibleIds(data, { scopeId: named(data, 'Hohenfurt').id, knownOnly: true })!;
    expect(names(data, both)).toEqual([
      'Der Speicher',
      'Die Aalfischer',
      'Hafenviertel',
      'Hohenfurt',
    ]);
    // Ein gelöschter Bereich grenzt nichts mehr ein.
    expect(visibleIds(data, { scopeId: 'weg', knownOnly: false })).toBeNull();
  });
});
