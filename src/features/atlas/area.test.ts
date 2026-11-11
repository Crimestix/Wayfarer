/**
 * Orte, die eine Fläche sind: Ein Kontinent ist kein Punkt, sondern eine Landmasse – und eine
 * Kontinentalwelt umfasst die Landmassen ihrer Kontinente. Die Welt hier ist erfunden.
 */
import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { AtlasSchema, createEntity } from '../../domain/schema';
import { applyAtlas, setLandHidden, setLandPlace, setPlaceGeo } from './actions';
import { landOwners, landsCenter, placeGeo, placeLands, planetOf } from './model';

/** Drei Landmassen: Westmark um 20° West, Buchtland um 40° Ost, die Aalinsel weit im Süden. */
const planetDoc = () =>
  AtlasSchema.parse({
    id: 'planet',
    rev: 0,
    created: '',
    updated: '',
    kind: 'planet',
    name: 'Probe',
    radiusKm: 6000,
    lands: [
      { id: 'westmark', name: 'Wéstmark', rings: [[-30, 0, -10, 0, -10, 20, -30, 20]] },
      { id: 'buchtland', name: 'Buchtland', rings: [[30, 0, 50, 0, 50, 20, 30, 20]] },
      { id: 'insel', name: 'Die namenlose Insel', rings: [[0, -60, 4, -60, 4, -56, 0, -56]] },
    ],
  });

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  applyAtlas(db, planetDoc());
  const place = (name: string, parentId: string | null = null) =>
    db.put('entities', createEntity({ kind: 'place', name, place: { parentId } }));
  const world = place('Nordwelt');
  const west = place('Westmark', world.id);
  const bay = place('Buchtland', world.id);
  const town = place('Hohenfurt', west.id);
  const isle = place('Aalinsel');
  return { db, world, west, bay, town, isle };
}

describe('Orte als Fläche', () => {
  it('erkennt am Namen, welcher Ort eine Landmasse ist – Akzente zählen nicht', async () => {
    const { db, west, bay, isle } = await setup();
    const owners = landOwners(db.getSnapshot());
    expect(owners.byLand.get('westmark')?.id).toBe(west.id);
    expect(owners.byLand.get('buchtland')?.id).toBe(bay.id);
    // Die Insel heißt anders als jeder Ort: Sie gehört noch niemandem.
    expect(owners.byLand.has('insel')).toBe(false);
    expect(placeLands(db.getSnapshot(), isle.id)).toEqual([]);
  });

  it('fasst unter einer Kontinentalwelt die Landmassen ihrer Kontinente zusammen', async () => {
    const { db, world, west, town } = await setup();
    const data = db.getSnapshot();
    expect(placeLands(data, west.id)).toEqual(['westmark']);
    expect(placeLands(data, world.id).sort()).toEqual(['buchtland', 'westmark']);
    // Eine Stadt auf dem Kontinent ist selbst keine Fläche.
    expect(placeLands(data, town.id)).toEqual([]);
  });

  it('nimmt bei gleichen Namen den Ort, der in der Welt weiter oben steht', async () => {
    const { db, west, town } = await setup();
    const inn = db.put(
      'entities',
      createEntity({ kind: 'place', name: 'Westmark', place: { parentId: town.id } }),
    );
    const owners = landOwners(db.getSnapshot());
    expect(owners.byLand.get('westmark')?.id).toBe(west.id);
    expect(placeLands(db.getSnapshot(), inn.id)).toEqual([]);
  });

  it('lässt eine Landmasse von Hand zuordnen – das geht dem Namen vor', async () => {
    const { db, world, west, isle } = await setup();
    setLandPlace(db, 'insel', isle.id);
    expect(landOwners(db.getSnapshot()).byLand.get('insel')?.id).toBe(isle.id);
    expect(placeLands(db.getSnapshot(), isle.id)).toEqual(['insel']);
    // Auch gegen den Namen: Westmark gehört jetzt zur Aalinsel.
    setLandPlace(db, 'westmark', isle.id);
    expect(placeLands(db.getSnapshot(), west.id)).toEqual([]);
    expect(placeLands(db.getSnapshot(), world.id)).toEqual(['buchtland']);
    // Zurück an Wayfarer: Der Name gilt wieder.
    setLandPlace(db, 'westmark', null);
    expect(placeLands(db.getSnapshot(), west.id)).toEqual(['westmark']);
    // Wird die Weltdatei neu eingelesen, bleibt die Zuordnung.
    applyAtlas(db, planetDoc());
    expect(placeLands(db.getSnapshot(), isle.id)).toEqual(['insel']);
  });

  it('gibt einem Kontinent die Mitte seiner Landmasse als ungefähre Lage – und allem darunter', async () => {
    const { db, world, west, town } = await setup();
    const data = db.getSnapshot();
    const planet = planetOf(data)!;
    const center = landsCenter(planet, ['westmark'])!;
    expect(center.lon).toBeCloseTo(-20, 0);
    expect(center.lat).toBeCloseTo(10, 0);
    expect(placeGeo(data, west.id)).toMatchObject({
      own: false,
      exact: false,
      area: ['westmark'],
      from: { id: west.id },
    });
    // Die Stadt übernimmt die Mitte des Kontinents – als ungefähre Lage.
    const inherited = placeGeo(data, town.id)!;
    expect(inherited.from.id).toBe(west.id);
    expect(inherited.exact).toBe(false);
    expect(inherited.geo.lon).toBeCloseTo(center.lon, 6);
    // Die Kontinentalwelt liegt zwischen ihren beiden Kontinenten.
    expect(placeGeo(data, world.id)!.geo.lon).toBeCloseTo(10, 0);
    // Eine eingetragene Lage geht immer vor.
    setPlaceGeo(db, town.id, { lon: -12, lat: 3 });
    expect(placeGeo(db.getSnapshot(), town.id)).toMatchObject({
      own: true,
      exact: true,
      geo: { lon: -12, lat: 3 },
    });
  });

  it('zählt ausgeblendete Landmassen nicht mit', async () => {
    const { db, world, west } = await setup();
    setLandHidden(db, 'westmark', true);
    expect(placeLands(db.getSnapshot(), west.id)).toEqual([]);
    expect(placeLands(db.getSnapshot(), world.id)).toEqual(['buchtland']);
    expect(placeGeo(db.getSnapshot(), west.id)?.from.id).toBe(world.id);
  });
});
