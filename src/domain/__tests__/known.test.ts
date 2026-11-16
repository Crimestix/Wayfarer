import { describe, expect, it } from 'vitest';
import { emptyCampaign } from '../../data/seed';
import { hasStance, isUnmetPerson, knowsPerson } from '../known';
import { playerBook } from '../playerBook';
import { PARTY_ID, createEntity, createRelation, type CampaignData, type Entity } from '../schema';
import { ELARIS_CALENDAR, ELARIS_START } from '../time/elaris';

function world(entities: Entity[], relations: ReturnType<typeof createRelation>[]): CampaignData {
  const base = emptyCampaign('Testwelt', ELARIS_CALENDAR, ELARIS_START) as CampaignData;
  return {
    ...base,
    entities: Object.fromEntries(entities.map((e) => [e.id, e])),
    relations: Object.fromEntries(relations.map((r) => [r.id, r])),
  };
}

describe('Wen die Gruppe kennt', () => {
  it('kennt, wen sie getroffen hat – und jeden mit einer Haltung zu ihr oder einem Gefährten', () => {
    const met = createEntity({ kind: 'person', name: 'Ulla Kerb', person: { met: true } });
    const foe = createEntity({ kind: 'person', name: 'Oswin Taube' });
    const rival = createEntity({ kind: 'person', name: 'Brin Lohe' });
    const stranger = createEntity({ kind: 'person', name: 'Nella Fass' });
    const cold = createEntity({ kind: 'person', name: 'Teo Harz' });
    const hero = createEntity({ kind: 'character', name: 'Askel' });
    const data = world(
      [met, foe, rival, stranger, cold, hero],
      [
        createRelation({ from: foe.id, to: PARTY_ID, type: 'enemy', attitude: -4 }),
        createRelation({ from: rival.id, to: hero.id, type: 'rival', attitude: -1 }),
        // Ohne Haltung (oder beendet) sagt eine Beziehung nichts.
        createRelation({ from: stranger.id, to: PARTY_ID, type: 'knows', attitude: null }),
        createRelation({ from: cold.id, to: PARTY_ID, attitude: 2, ended: true }),
      ],
    );
    expect(knowsPerson(data, met)).toBe(true);
    expect(knowsPerson(data, foe)).toBe(true);
    expect(hasStance(data, foe.id)).toBe(true);
    expect(knowsPerson(data, rival)).toBe(true);
    expect(knowsPerson(data, stranger)).toBe(false);
    expect(knowsPerson(data, cold)).toBe(false);
    expect(isUnmetPerson(data, stranger)).toBe(true);
    expect(isUnmetPerson(data, hero)).toBe(false);
    // Auch das Spielerbuch kennt sie dann.
    const book = playerBook(data);
    const people = JSON.stringify(book);
    expect(people).toContain(foe.id);
    expect(people).not.toContain(stranger.id);
  });
});
