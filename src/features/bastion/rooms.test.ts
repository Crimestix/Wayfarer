import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { facilityCandidates, facilityInRoom } from '../../domain/bastion';
import { roomsOf } from '../../domain/rooms';
import { createEntity, type Place } from '../../domain/schema';
import { pagePlan } from '../welt/page';
import { createArticle, createArticleOfKind } from '../wiki/actions';
import { addBastion, facilitiesFromRooms } from './actions';

/**
 * Eine erfundene Feste: ein Ort mit Artikel, darunter ein Raum, ein Ort darin und ein Artikel, zu
 * dem es noch keinen Eintrag gibt.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const data = () => db.getSnapshot();
  const keep = createArticleOfKind(db, {
    title: 'Graufeste',
    parentId: null,
    kind: 'place',
    scaffold: false,
  })!;
  const home = keep.entity as Place;
  const forge = db.put(
    'entities',
    createEntity({ kind: 'place', name: 'Schmiede', place: { parentId: home.id, room: true } }),
  ) as Place;
  const garden = db.put(
    'entities',
    createEntity({ kind: 'place', name: 'Kräutergarten', place: { parentId: home.id } }),
  ) as Place;
  const library = createArticle(db, { title: 'Bibliothek', parentId: keep.article.id })!;
  // Liegt nicht in der Feste – steht nicht zur Wahl.
  db.put('entities', createEntity({ kind: 'place', name: 'Fremde Mühle' }));
  const bastion = addBastion(db, 'Graufeste', home.id);
  return { db, data, home, forge, garden, library, bastion };
}

describe('Einrichtungen aus Räumen und Artikeln', () => {
  it('bietet an, was unter dem Ort der Bastion steht – auch Artikel ohne Eintrag', async () => {
    const { data, bastion, library } = await setup();
    expect(
      facilityCandidates(data(), data().bastions[bastion.id]!).map((c) => [c.name, c.note]),
    ).toEqual([
      ['Bibliothek', 'Artikel ohne Eintrag'],
      ['Kräutergarten', 'Ort darin'],
      ['Schmiede', 'Raum'],
    ]);
    // Ohne Ort weiß Wayfarer nicht, welche Räume gemeint sind.
    expect(facilityCandidates(data(), { ...data().bastions[bastion.id]!, placeId: null })).toEqual(
      [],
    );
    expect(library.title).toBe('Bibliothek');
  });

  it('macht daraus Einrichtungen, deren Seite der geschriebene Artikel ist', async () => {
    const { db, data, bastion, home, forge, garden, library } = await setup();
    const result = facilitiesFromRooms(
      db,
      bastion.id,
      facilityCandidates(data(), data().bastions[bastion.id]!),
    )!;
    expect(result.added).toBe(3);
    const facilities = data().bastions[bastion.id]!.facilities;
    expect(facilities.map((f) => f.name).sort()).toEqual([
      'Bibliothek',
      'Kräutergarten',
      'Schmiede',
    ]);
    // Der Artikel ohne Eintrag ist jetzt ein Raum der Bastion – mit seinem Artikel.
    const libraryRoom = Object.values(data().entities).find(
      (e) => e.name === 'Bibliothek',
    ) as Place;
    expect(libraryRoom).toMatchObject({
      kind: 'place',
      place: { parentId: home.id, room: true },
      lk: { resourceId: library.id },
    });
    // Der Ort unmittelbar darin wird ein Raum; alle drei stehen unter „Räume“ der Feste.
    expect((data().entities[garden.id] as Place).place.room).toBe(true);
    expect(roomsOf(data(), home.id).map((room) => room.name)).toEqual([
      'Bibliothek',
      'Kräutergarten',
      'Schmiede',
    ]);
    expect(facilityInRoom(data(), forge.id)?.facility.name).toBe('Schmiede');
    // Auf der Seite des Raums steht die Einrichtung gleich nach dem Steckbrief.
    expect(
      pagePlan(data(), data().entities[forge.id] as Place, { hasText: false }).main.slice(0, 2),
    ).toEqual(['box', 'facility']);
    // Was schon Einrichtung ist, steht nicht noch einmal zur Wahl.
    expect(facilityCandidates(data(), data().bastions[bastion.id]!)).toEqual([]);

    result.undo();
    expect(data().bastions[bastion.id]!.facilities).toEqual([]);
    expect((data().entities[garden.id] as Place).place.room).toBe(false);
    expect(Object.values(data().entities).some((e) => e.name === 'Bibliothek')).toBe(false);
    expect(data().articles[library.id]).toBeDefined();
  });

  it('gibt einer Einrichtung, die es schon gibt, ihren Raum – statt einer zweiten', async () => {
    const { db, data, bastion, forge } = await setup();
    // Schon von Hand eingetragen, mit Besitzer-Notiz, aber ohne Raum.
    db.patch('bastions', bastion.id, {
      facilities: [
        {
          id: 'f-schmiede',
          name: 'schmiede',
          roomId: null,
          kind: 'special',
          ownerId: null,
          orders: ['craft'],
          hirelings: 'zwei Gesellen',
          state: 'damaged',
          trackId: null,
          order: null,
          notes: '',
        },
      ],
    });
    const candidates = facilityCandidates(data(), data().bastions[bastion.id]!);
    expect(candidates.find((c) => c.name === 'Schmiede')?.joins).toBe('f-schmiede');
    expect(candidates.find((c) => c.name === 'Bibliothek')?.joins).toBeNull();

    const result = facilitiesFromRooms(db, bastion.id, candidates)!;
    expect([result.added, result.joined]).toEqual([2, 1]);
    const facilities = data().bastions[bastion.id]!.facilities;
    expect(facilities).toHaveLength(3);
    // Sie bleibt, wie sie war – nur der Raum ist dazugekommen.
    expect(facilities.find((f) => f.id === 'f-schmiede')).toMatchObject({
      name: 'schmiede',
      roomId: forge.id,
      orders: ['craft'],
      hirelings: 'zwei Gesellen',
      state: 'damaged',
    });

    result.undo();
    expect(data().bastions[bastion.id]!.facilities).toEqual([
      expect.objectContaining({ id: 'f-schmiede', roomId: null, hirelings: 'zwei Gesellen' }),
    ]);
  });
});
