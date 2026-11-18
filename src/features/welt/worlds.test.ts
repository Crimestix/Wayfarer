import { describe, expect, it } from 'vitest';
import { deleteEntity } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity, type Celestial, type Dimension, type Place } from '../../domain/schema';
import { liesIn, unplacedRoots, worldContents, worldOfPlace } from '../../domain/worlds';
import { repairReferences } from '../import/integrity';
import { settleKindChange } from './actions';
import { draftOf, draftWithKind, entityFromDraft, type WorldEntity } from './model';

/**
 * Eine erfundene Welt mit zwei Dimensionen: In der einen liegt ein Himmelskörper mit Orten darauf,
 * in der anderen liegen Orte unmittelbar – sie hat keinen Himmelskörper.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const put = <E extends WorldEntity>(entity: ReturnType<typeof createEntity>) =>
    db.put('entities', entity) as E;
  const material = put<Dimension>(createEntity({ kind: 'dimension', name: 'Stoffwelt' }));
  const mist = put<Dimension>(createEntity({ kind: 'dimension', name: 'Nebelgrund' }));
  const planet = put<Celestial>(
    createEntity({ kind: 'celestial', name: 'Aurelis', celestial: { dimensionId: material.id } }),
  );
  const continent = put<Place>(
    createEntity({ kind: 'place', name: 'Westmark', place: { worldId: planet.id } }),
  );
  const town = put<Place>(
    createEntity({ kind: 'place', name: 'Grauhafen', place: { parentId: continent.id } }),
  );
  const loom = put<Place>(
    createEntity({ kind: 'place', name: 'Fadenhain', place: { worldId: mist.id } }),
  );
  return { db, data: () => db.getSnapshot(), put, material, mist, planet, continent, town, loom };
}

const names = (entities: readonly { name: string }[]) => entities.map((entity) => entity.name);

describe('Liegt in – über Orte, Himmelskörper und Dimensionen hinweg', () => {
  it('läuft von der Stadt bis zur Dimension durch', async () => {
    const { data, town, continent, planet, loom } = await setup();
    expect(names(liesIn(data(), town))).toEqual(['Stoffwelt', 'Aurelis', 'Westmark']);
    expect(names(liesIn(data(), continent))).toEqual(['Stoffwelt', 'Aurelis']);
    expect(names(liesIn(data(), planet))).toEqual(['Stoffwelt']);
    // Eine Dimension ohne Himmelskörper: Der Ort liegt unmittelbar in ihr.
    expect(names(liesIn(data(), loom))).toEqual(['Nebelgrund']);
    expect(worldOfPlace(data(), town)?.name).toBe('Aurelis');
  });

  it('zeigt auf der Seite einer Dimension oder eines Himmelskörpers, was darin liegt', async () => {
    const { data, material, mist, planet } = await setup();
    expect(worldContents(data(), material)).toMatchObject({
      celestials: [{ name: 'Aurelis' }],
      places: [],
    });
    // Nur die obersten Orte – die Stadt steht bei ihrem Kontinent.
    expect(names(worldContents(data(), planet).places)).toEqual(['Westmark']);
    expect(names(worldContents(data(), mist).places)).toEqual(['Fadenhain']);
  });

  it('nennt oberste Orte, die noch nirgends liegen', async () => {
    const { data, put } = await setup();
    put(createEntity({ kind: 'place', name: 'Niemandsland' }));
    expect(names(unplacedRoots(data()))).toEqual(['Niemandsland']);
  });

  it('gilt unter einem Ort nie selbst: Die Welt kommt vom obersten Ort darüber', async () => {
    const { db, data, town, mist } = await setup();
    // Ein alter Wert an einem Ort, der unter einem anderen liegt, zählt nicht.
    db.put('entities', { ...town, place: { ...town.place, worldId: mist.id } });
    expect(names(liesIn(data(), data().entities[town.id]!))).toEqual([
      'Stoffwelt',
      'Aurelis',
      'Westmark',
    ]);
    // Und das Fenster „Bearbeiten“ räumt ihn weg, sobald ein Ort darüber eingetragen ist.
    const saved = entityFromDraft(draftOf(data().entities[town.id] as Place, data()), town);
    expect(saved.kind === 'place' && saved.place.worldId).toBeNull();
  });
});

describe('Aus einem Ort wird ein Himmelskörper oder eine Dimension', () => {
  it('lässt darin liegen, was darin lag', async () => {
    const { db, data, put } = await setup();
    const cosmos = put<Place>(createEntity({ kind: 'place', name: 'Altes Jenseits' }));
    const realm = put<Place>(
      createEntity({ kind: 'place', name: 'Aschental', place: { parentId: cosmos.id } }),
    );
    const below = put<Place>(
      createEntity({ kind: 'place', name: 'Aschenfurt', place: { parentId: realm.id } }),
    );
    db.put(
      'entities',
      entityFromDraft(draftWithKind(draftOf(cosmos, data()), 'dimension'), cosmos),
    );
    const settled = settleKindChange(db, cosmos);
    expect(data().entities[cosmos.id]!.kind).toBe('dimension');
    expect(names(liesIn(data(), data().entities[below.id]!))).toEqual([
      'Altes Jenseits',
      'Aschental',
    ]);
    expect((data().entities[realm.id] as Place).place).toMatchObject({
      parentId: null,
      worldId: cosmos.id,
    });
    settled.undo();
    expect((data().entities[realm.id] as Place).place).toMatchObject({
      parentId: cosmos.id,
      worldId: null,
    });
  });

  it('behält als Himmelskörper die Dimension, in der der Ort lag', async () => {
    const { db, data, put, material } = await setup();
    const moon = put<Place>(
      createEntity({ kind: 'place', name: 'Rostmond', place: { worldId: material.id } }),
    );
    const draft = draftWithKind(draftOf(moon, data()), 'celestial');
    expect(draft.dimensionId).toBe(material.id);
    db.put('entities', entityFromDraft(draft, moon));
    expect(names(liesIn(data(), data().entities[moon.id]!))).toEqual(['Stoffwelt']);
  });
});

describe('Aufräumen', () => {
  it('löst die Welt eines Ortes, wenn es sie nicht mehr gibt', async () => {
    const { db, data, mist, loom } = await setup();
    deleteEntity(db, mist.id);
    expect((data().entities[loom.id] as Place).place.worldId).toBeNull();
    expect(names(unplacedRoots(data()))).toContain('Fadenhain');
  });

  it('lässt einen Ort nur in einem Himmelskörper oder einer Dimension liegen', async () => {
    const { db, data, put, loom } = await setup();
    const person = put(createEntity({ kind: 'person', name: 'Mira' }));
    db.put('entities', { ...loom, place: { ...loom.place, worldId: person.id } });
    const repaired = repairReferences(data()).data;
    expect((repaired.entities[loom.id] as Place).place.worldId).toBeNull();
  });
});
