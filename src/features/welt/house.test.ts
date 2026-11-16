import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { emptyCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { SUGGESTION } from '../../domain/dismiss';
import {
  PARTY_ID,
  createEntity,
  createRelation,
  createStory,
  type CampaignData,
  type Entity,
  type Faction,
  type Family,
} from '../../domain/schema';
import { ELARIS_CALENDAR, ELARIS_START } from '../../domain/time/elaris';
import { houseMembers, houseName, houseTwins, mergeHouse, rewireId } from './house';

/** Eine erfundene Welt mit einem Haus, das zweimal angelegt ist. */
function world() {
  const base = emptyCampaign('Testwelt', ELARIS_CALENDAR, ELARIS_START) as CampaignData;
  const seat = createEntity({ kind: 'place', name: 'Burg Hagelstein' });
  const faction = createEntity({
    kind: 'faction',
    name: 'Haus Vellmor',
    notes: 'Hält den Pass.',
    faction: { category: 'Adelshaus', seatId: seat.id },
  }) as Faction;
  const family = createEntity({
    kind: 'family',
    name: 'Vellmor',
    tagline: 'Blut vom Pass.',
    notes: 'Alte Linie.',
  }) as Family;
  const lord = createEntity({ kind: 'person', name: 'Arden Vellmor' });
  const wife = createEntity({ kind: 'person', name: 'Ilse Brandt' });
  const steward = createEntity({ kind: 'person', name: 'Gerold Fink' });
  const guard = createEntity({ kind: 'person', name: 'Tamm' });
  const cook = createEntity({
    kind: 'person',
    name: 'Mara Seil',
    person: { workplaceId: faction.id },
  });
  const relations = [
    createRelation({ from: lord.id, to: faction.id, type: 'leads' }),
    createRelation({ from: wife.id, to: faction.id, type: 'member' }),
    createRelation({ from: wife.id, to: lord.id, type: 'family', kin: 'spouse' }),
    createRelation({ from: steward.id, to: faction.id, type: 'serves' }),
    createRelation({ from: guard.id, to: faction.id, type: 'member' }),
    createRelation({ from: lord.id, to: family.id, type: 'member' }),
    // Beide haben eine Haltung zur Gruppe – nach dem Zusammenlegen gilt eine.
    createRelation({ from: faction.id, to: PARTY_ID, type: 'knows', attitude: -2 }),
    createRelation({ from: family.id, to: PARTY_ID, type: 'knows', attitude: null }),
  ];
  const entities: Entity[] = [seat, faction, family, lord, wife, steward, guard, cook];
  const story = createStory({ title: 'Der Pass', ownerId: faction.id, refs: [faction.id] });
  const data: CampaignData = {
    ...base,
    entities: Object.fromEntries(entities.map((e) => [e.id, e])),
    relations: Object.fromEntries(relations.map((r) => [r.id, r])),
    stories: { [story.id]: story },
  };
  return { data, seat, faction, family, lord, wife, steward, guard, cook, story };
}

describe('Häuser', () => {
  it('teilt die Leute in Familie und Gefolge – aus Name, Verwandtschaft und Art der Beziehung', () => {
    const { data, faction, lord, wife, steward, guard, cook } = world();
    const { family, service, split } = houseMembers(data, faction);
    expect(split).toBe(true);
    // Der Name des Hauses und die Eingeheiratete sind Familie …
    expect(family.map((m) => m.entity.id).sort()).toEqual([lord.id, wife.id].sort());
    // … wer dient, dort arbeitet oder ohne Verwandtschaft dazugehört, ist Gefolge.
    expect(service.map((m) => m.entity.id).sort()).toEqual([steward.id, guard.id, cook.id].sort());
  });

  it('lässt eine Fraktion ohne Familie darin, wie sie ist', () => {
    const base = emptyCampaign('Testwelt', ELARIS_CALENDAR, ELARIS_START) as CampaignData;
    const guild = createEntity({ kind: 'faction', name: 'Gilde der Seiler' }) as Faction;
    const member = createEntity({ kind: 'person', name: 'Ole Hanf' });
    const data: CampaignData = {
      ...base,
      entities: { [guild.id]: guild, [member.id]: member },
      relations: Object.fromEntries(
        [createRelation({ from: member.id, to: guild.id, type: 'member' })].map((r) => [r.id, r]),
      ),
    };
    const result = houseMembers(data, guild);
    expect(result.split).toBe(false);
    expect(result.service.map((m) => m.entity.name)).toEqual(['Ole Hanf']);
  });

  it('erkennt dasselbe Haus in beiden Arten – weggeklickt nicht mehr', () => {
    const { data, faction, family } = world();
    const twins = houseTwins(data);
    expect(twins.map((t) => [t.faction.id, t.family.id])).toEqual([[faction.id, family.id]]);
    expect(houseName(family, faction)).toBe('Haus Vellmor');
    const dismissed = {
      ...data,
      state: { ...data.state, dismissed: [SUGGESTION.house(faction.id, family.id)] },
    };
    expect(houseTwins(dismissed)).toEqual([]);
  });

  it('ersetzt Kennungen in Werten und Schlüsseln, sonst nichts', () => {
    const doc = { a: 'x1', b: ['story:x1', 'x12', 'ax1'], c: { x1: 3 }, d: 4 };
    expect(rewireId(doc, 'x1', 'y9')).toEqual({
      a: 'y9',
      b: ['story:y9', 'x12', 'ax1'],
      c: { y9: 3 },
      d: 4,
    });
    const untouched = { a: 'z', b: [1, 2] };
    expect(rewireId(untouched, 'x1', 'y9')).toBe(untouched);
  });

  it('legt beide zu einem Haus zusammen – alles zieht mit, Rückgängig stellt alles wieder her', async () => {
    const { data, faction, family, seat, steward, story } = world();
    const db = await CampaignDb.create(new MemoryStore(), data);
    const before = db.getSnapshot();
    const result = mergeHouse(db, family.id, faction.id)!;
    const after = db.getSnapshot();
    expect(after.entities[faction.id]).toBeUndefined();
    const house = after.entities[family.id] as Family;
    expect(house.name).toBe('Haus Vellmor');
    expect(house.aliases).toContain('Vellmor');
    expect(house.family.seatId).toBe(seat.id);
    expect(house.family.category).toBe('Adelshaus');
    expect(house.notes).toBe('Alte Linie.\n\nHält den Pass.');
    // Ohne eigenen Satz der Fraktion bleibt der der Familie.
    expect(house.tagline).toBe('Blut vom Pass.');
    // Verweise ziehen mit: Geschichte, Beziehungen.
    expect(after.stories[story.id]!.ownerId).toBe(family.id);
    expect(after.stories[story.id]!.refs).toEqual([family.id]);
    const relations = Object.values(after.relations);
    expect(relations.some((r) => r.from === faction.id || r.to === faction.id)).toBe(false);
    expect(relations.find((r) => r.from === steward.id)!.to).toBe(family.id);
    // Arden war in beiden – jetzt eine Beziehung; zur Gruppe eine Haltung, die der Fraktion.
    const toParty = relations.filter((r) => r.from === family.id && r.to === PARTY_ID);
    expect(toParty).toHaveLength(1);
    expect(toParty[0]!.attitude).toBe(-2);
    const lordLinks = relations.filter(
      (r) => r.to === family.id && after.entities[r.from]?.name === 'Arden Vellmor',
    );
    expect(lordLinks).toHaveLength(1);
    expect(lordLinks[0]!.type).toBe('leads');
    expect(houseTwins(after)).toEqual([]);

    result.undo();
    const back = db.getSnapshot();
    const strip = (docs: Readonly<Record<string, object>>) =>
      Object.fromEntries(
        Object.entries(docs).map(([id, doc]) => [id, { ...doc, rev: 0, updated: '' }]),
      );
    expect(strip(back.entities)).toEqual(strip(before.entities));
    expect(strip(back.relations)).toEqual(strip(before.relations));
    expect(strip(back.stories)).toEqual(strip(before.stories));
  });
});

describe('Häuser: der eine Satz', () => {
  it('nimmt den Satz von der Seite, deren Name bleibt – der andere steht über den Notizen', async () => {
    const { data, faction, family } = world();
    const both: CampaignData = {
      ...data,
      entities: {
        ...data.entities,
        [faction.id]: { ...faction, tagline: 'Herren des Passes.' },
      },
    };
    const db = await CampaignDb.create(new MemoryStore(), both);
    mergeHouse(db, family.id, faction.id);
    const house = db.getSnapshot().entities[family.id] as Family;
    expect(house.tagline).toBe('Herren des Passes.');
    expect(house.notes).toBe('Blut vom Pass.\n\nAlte Linie.\n\nHält den Pass.');
  });
});
