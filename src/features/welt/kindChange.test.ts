import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { isPast } from '../../domain/lifespan';
import { placeScale, scaleOfWord } from '../../domain/placeScale';
import { roomLikes } from '../../domain/rooms';
import { createEntity, createRelation, type Place } from '../../domain/schema';
import { settleKindChange } from './actions';
import { galleryEntries } from './galleryModel';
import { historyRows } from './history';
import { draftOf, draftWithKind, entityFromDraft, type WorldEntity } from './model';
import { setRooms } from './rooms';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const put = (entity: ReturnType<typeof createEntity>) =>
    db.put('entities', entity) as WorldEntity;
  return { db, data: () => db.getSnapshot(), put };
}

describe('Kategorie ändern', () => {
  it('macht aus einem Ort eine Person – derselbe Eintrag, mit Text, Notizen und Beziehungen', async () => {
    const { db, data, put } = await setup();
    const town = put(createEntity({ kind: 'place', name: 'Grauhafen' }));
    const wrong = put(
      createEntity({
        kind: 'place',
        name: 'Jana Becker',
        tagline: 'Wirtin am Hafen',
        notes: 'Kennt jeden Lotsen.',
        secret: 'Schuldet der Gilde Geld.',
        place: { parentId: town.id, category: 'Wirtin' },
        lk: { resourceId: 'artikel-1', title: 'Jana Becker' },
      }),
    );
    const friend = put(createEntity({ kind: 'person', name: 'Tomas' }));
    db.put('relations', createRelation({ from: friend.id, to: wrong.id, type: 'knows' }));

    const draft = draftWithKind(draftOf(wrong, data()), 'person');
    // Das eigene Wort wird die Rolle, „liegt in“ wird der Aufenthalt.
    expect(draft).toMatchObject({ kind: 'person', role: 'Wirtin', placeId: town.id });
    const person = db.put('entities', entityFromDraft(draft, wrong, data()));
    settleKindChange(db, wrong);

    expect(person.id).toBe(wrong.id);
    expect(person).toMatchObject({
      kind: 'person',
      name: 'Jana Becker',
      tagline: 'Wirtin am Hafen',
      notes: 'Kennt jeden Lotsen.',
      secret: 'Schuldet der Gilde Geld.',
      lk: { resourceId: 'artikel-1' },
    });
    expect(person.kind === 'person' && person.person.placeId).toBe(town.id);
    // Die Beziehung hängt an der Kennung – sie bleibt.
    expect(Object.values(data().relations).some((r) => r.to === wrong.id)).toBe(true);
    expect(Object.values(data().entities).filter((e) => e.name === 'Jana Becker')).toHaveLength(1);
  });

  it('macht aus einer Person eine Fraktion und löst nur, was nicht mehr passt – mit Rückgängig', async () => {
    const { db, data, put } = await setup();
    const hall = put(createEntity({ kind: 'place', name: 'Knochenhalle' }));
    const legion = put(
      createEntity({
        kind: 'person',
        name: 'Die Bleichen Legionäre',
        person: { role: 'Söldnerorden', placeId: hall.id },
      }),
    );
    const draft = draftWithKind(draftOf(legion, data()), 'faction');
    expect(draft).toMatchObject({ kind: 'faction', category: 'Söldnerorden', seatId: hall.id });
    db.put('entities', entityFromDraft(draft, legion, data()));
    const settled = settleKindChange(db, legion);
    expect(data().entities[legion.id]).toMatchObject({
      kind: 'faction',
      faction: { seatId: hall.id },
    });

    settled.undo();
    expect(data().entities[legion.id]).toMatchObject({
      kind: 'person',
      person: { placeId: hall.id },
    });
  });

  it('löst „liegt in“, wenn der Ort darüber kein Ort mehr ist', async () => {
    const { db, data, put } = await setup();
    const planet = put(createEntity({ kind: 'place', name: 'Aurelis' }));
    const continent = put(
      createEntity({ kind: 'place', name: 'Westmark', place: { parentId: planet.id } }),
    ) as Place;
    db.put(
      'entities',
      entityFromDraft(draftWithKind(draftOf(planet, data()), 'celestial'), planet),
    );
    const settled = settleKindChange(db, planet);
    expect(settled.loosened).toBe(1);
    expect(data().entities[planet.id]!.kind).toBe('celestial');
    expect((data().entities[continent.id] as Place).place.parentId).toBeNull();
    settled.undo();
    expect((data().entities[continent.id] as Place).place.parentId).toBe(planet.id);
    expect(data().entities[planet.id]!.kind).toBe('place');
  });
});

describe('Orte: Räume und Größe', () => {
  it('zeigt Räume nicht zwischen den Orten und schlägt raum-artige Orte zum Umwandeln vor', async () => {
    const { db, data, put } = await setup();
    const keep = put(createEntity({ kind: 'place', name: 'Schwarzfeste' }));
    const cell = put(
      createEntity({
        kind: 'place',
        name: '3 Wachstube',
        place: { parentId: keep.id, category: 'Dungeonraum' },
      }),
    );
    put(createEntity({ kind: 'place', name: 'Alte Halle', place: { category: 'Halle' } }));
    const filter = { query: '', placeId: null, known: 'all' as const };
    // Nur mit einem Ort darüber ist es ein Raum – die Halle für sich bleibt ein Ort.
    expect(roomLikes(data()).map((place) => place.id)).toEqual([cell.id]);
    setRooms(db, [cell.id], true);
    expect(roomLikes(data())).toEqual([]);
    const names = galleryEntries(data(), 'place', filter).map((entry) => entry.name);
    expect(names).toContain('Schwarzfeste');
    expect(names).toContain('Alte Halle');
    expect(names).not.toContain('3 Wachstube');
  });

  it('kennt über der Gegend noch Kontinent und Welt', async () => {
    const { data, put } = await setup();
    expect(scaleOfWord('Kontinentalwelt')).toBe('world');
    expect(scaleOfWord('Kontinent')).toBe('world');
    expect(scaleOfWord('Königreich')).toBe('region');
    expect(scaleOfWord('Hafenstadt')).toBe('settlement');
    const world = put(
      createEntity({ kind: 'place', name: 'Drakonia', place: { category: 'Kontinentalwelt' } }),
    ) as Place;
    expect(placeScale(data(), world)).toBe('world');
  });
});

describe('Vergangenes von Hand', () => {
  it('steht unter „Geschichte“, auch ohne Datum', async () => {
    const { data, put } = await setup();
    const ruin = put(createEntity({ kind: 'place', name: 'Altenfurt', past: true }));
    put(createEntity({ kind: 'place', name: 'Neufurt' }));
    expect(isPast(data(), ruin)).toBe(true);
    const rows = historyRows(data(), { kind: null, old: false, query: '' });
    expect(rows.map((row) => row.entity.name)).toEqual(['Altenfurt']);
    // Das Häkchen geht durch das Fenster „Bearbeiten“ hin und zurück.
    const draft = draftOf(ruin, data());
    expect(draft.past).toBe(true);
    expect(entityFromDraft({ ...draft, past: false }, ruin, data()).past).toBe(false);
  });
});
