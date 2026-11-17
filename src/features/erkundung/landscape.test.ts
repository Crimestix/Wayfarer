import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  dwellersOf,
  hexAreaKm2,
  lairPlan,
  lairsOnArea,
  landscapeLook,
  landscapeOfKind,
  paintOfLandscape,
} from '../../domain/landscape';
import { createCreature, createEntity, type Landscape } from '../../domain/schema';
import { lairToPlace, paintHexes, populateArea } from './actions';
import { brushPaint } from './HexEditor';
import { MILE_KM, blankArea, scaleWords, zoomArea, zoomOf } from './freeMap';

/** Ein erfundener Nebelforst, in dem Aschwölfe jagen. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const wolf = db.put(
    'creatures',
    createCreature({
      name: 'Aschwolf',
      roaming: { appearing: '3', signs: '', active: null, territoryKm2: 500 },
    }),
  );
  const forest = db.put(
    'entities',
    createEntity({
      kind: 'landscape',
      name: 'Nebelforst',
      landscape: {
        base: 'forest',
        look: 'dense-forest',
        slow: false,
        dwellerIds: [wolf.id],
        category: '',
      },
    }),
  ) as Landscape;
  const area = db.put(
    'areas',
    blankArea({ name: 'Grenzland', cols: 10, rows: 10, hexKm: 6 * MILE_KM, terrain: 'grassland' }),
  );
  return { db, data: () => db.getSnapshot(), wolf, forest, area };
}

describe('Freie Hexkarte', () => {
  it('hat Breite × Höhe Felder in einem eigenen Maßstab', async () => {
    const { area } = await setup();
    expect(area.hexes).toHaveLength(100);
    expect(area.fromId).toBeNull();
    expect(area.hexes.every((hex) => hex.terrain === 'grassland')).toBe(true);
    expect(scaleWords(area.hexKm)).toBe('6 Meilen je Feld');
    expect(scaleWords(0.1)).toBe('100 m je Feld');
  });
});

describe('Landschaften', () => {
  it('malen Grundgelände, Aussehen und die Landschaft selbst', async () => {
    const { forest, db, data } = await setup();
    expect(landscapeLook(forest)).toBe('dense-forest');
    expect(paintOfLandscape(forest)).toEqual({
      terrain: 'forest',
      kind: 'dense-forest',
      landscapeId: forest.id,
    });
    // Eine Landschaft gleichen Namens wie eine Geländeart übernimmt deren Platz in der Palette.
    const moor = db.put('entities', createEntity({ kind: 'landscape', name: 'Moor' }));
    expect(landscapeOfKind(data(), 'bog')?.id).toBe(moor.id);
    expect(brushPaint(data(), 'bog')).toMatchObject({ landscapeId: moor.id });
    expect(brushPaint(data(), 'heath')).toMatchObject({ landscapeId: null });
  });

  it('kennen ihre Bewohner in beide Richtungen', async () => {
    const { db, data, forest, wolf } = await setup();
    const owl = db.put('creatures', createCreature({ name: 'Grauschwinge' }));
    db.put(
      'entities',
      createEntity({
        kind: 'animal',
        name: 'Grauschwinge',
        animal: { creatureId: owl.id, habitat: ['Nebelforst'] },
      }),
    );
    expect(dwellersOf(data(), forest.id).map((d) => [d.name, d.via])).toEqual([
      ['Aschwolf', 'listed'],
      ['Grauschwinge', 'habitat'],
    ]);
    expect(wolf.id).toBeTruthy();
  });
});

describe('Beleben', () => {
  it('setzt so viele Baue, wie Reviere Platz haben – fest und nur einmal', async () => {
    const { db, data, area, forest, wolf } = await setup();
    // Ein Wald aus 5 × 7 Feldern.
    const cells = area.hexes.filter((hex) => hex.r < 7 && hex.q + Math.floor(hex.r / 2) < 5);
    expect(cells).toHaveLength(35);
    paintHexes(db, area.id, cells, paintOfLandscape(forest));
    const km2 = 35 * hexAreaKm2(area.hexKm);
    const plan = lairPlan(data(), data().areas[area.id]!);
    expect(plan).toHaveLength(Math.round(km2 / 500) > 18 ? 18 : Math.round(km2 / 500));
    expect(lairPlan(data(), data().areas[area.id]!)).toEqual(plan);
    const done = populateArea(db, area.id)!;
    expect(done.added).toBe(plan.length);
    const lairs = lairsOnArea(data(), area.id);
    expect(lairs[0]).toMatchObject({ generated: true, placeId: null });
    expect(lairs[0]!.groups[0]).toMatchObject({ creatureId: wolf.id, count: 3 });
    // Ein zweites Mal kommt nichts dazu.
    expect(populateArea(db, area.id)!.added).toBe(0);
    done.undo();
    expect(lairsOnArea(data(), area.id)).toHaveLength(0);
  });

  it('macht einen Bau auf Klick zum Ort der Welt', async () => {
    const { db, data, area, forest } = await setup();
    paintHexes(db, area.id, area.hexes, paintOfLandscape(forest));
    populateArea(db, area.id);
    const lair = lairsOnArea(data(), area.id)[0]!;
    const done = lairToPlace(db, lair.id)!;
    const placeId = data().stocks[lair.id]!.placeId!;
    expect(data().entities[placeId]).toMatchObject({ kind: 'place', name: 'Aschwolf-Bau' });
    const hex = data().areas[area.id]!.hexes.find((h) => h.q === lair.at!.q && h.r === lair.at!.r)!;
    expect(hex.placeId).toBe(placeId);
    done.undo();
    expect(data().stocks[lair.id]!.placeId).toBeNull();
    expect(data().entities[placeId]).toBeUndefined();
  });
});

describe('Hineinzoomen', () => {
  it('zeigt ein Feld im Kleinen – mit dem Gelände des Feldes und am Rand dem der Nachbarn', async () => {
    const { db, data, area, forest } = await setup();
    const middle = area.hexes.find((hex) => hex.q === 3 && hex.r === 4)!;
    paintHexes(db, area.id, [middle], paintOfLandscape(forest));
    const child = zoomArea(data().areas[area.id]!, middle)!;
    expect(child.hexKm).toBeCloseTo(MILE_KM, 5);
    expect(child.parent).toEqual({ areaId: area.id, q: 3, r: 4, level: 0 });
    const centre = child.hexes.find((hex) => hex.q === 0 && hex.r === 0)!;
    expect(centre.landscapeId).toBe(forest.id);
    expect(child.hexes.some((hex) => hex.terrain === 'grassland')).toBe(true);
    db.put('areas', child);
    expect(zoomOf(data().areas, area.id, middle)?.id).toBe(child.id);
  });
});
