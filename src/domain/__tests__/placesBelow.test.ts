import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createDrawnMap, placeMarker, removeMarker } from '../../features/karten/actions';
import { placesBelow } from '../mapDraw';
import { createEntity, type Place } from '../schema';
import { isUnderground, lightStatus } from '../underground';
import { presetClimate } from '../weather';
import { weatherAt, weatherZone } from '../weatherZone';

/**
 * Erfundene Orte ohne sprechende Namen: die Torhalle (darin die Wachstube), der Aufgang und das
 * Städtchen Hohenfurt. Wayfarer weiß über sie nur, was die Karten sagen.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string, parentId: string | null = null) =>
    db.put('entities', createEntity({ kind: 'place', name, place: { parentId } })) as Place;
  const hall = place('Torhalle');
  const guard = place('Wachstube', hall.id);
  const stairs = place('Aufgang');
  const town = place('Hohenfurt');
  const deeps = createDrawnMap(db, {
    name: 'Die Tiefen unter Graufels',
    widthKm: 2,
    placeId: null,
    level: 'underground',
    ground: 'rock',
  });
  const land = createDrawnMap(db, {
    name: 'Das Umland von Hohenfurt',
    widthKm: 50,
    placeId: null,
    level: 'surface',
    ground: 'plain',
  });
  const data = () => db.getSnapshot();
  return { db, data, hall, guard, stairs, town, deeps, land };
}

describe('Was auf einer Karte des Unterreichs steht, liegt unter der Erde', () => {
  it('ohne Karte gilt, was Namen und Lage sagen – hier: oben', async () => {
    const { data, hall } = await setup();
    expect(isUnderground(data(), hall.id)).toBe(false);
    expect(placesBelow(data().maps).size).toBe(0);
  });

  it('der Ort auf der Karte – und alles, was in ihm liegt', async () => {
    const { db, data, hall, guard, town, deeps } = await setup();
    placeMarker(db, deeps.id, [700, 300], hall.id);
    expect(isUnderground(data(), hall.id)).toBe(true);
    expect(isUnderground(data(), guard.id)).toBe(true);
    expect(isUnderground(data(), town.id)).toBe(false);

    const zone = weatherZone(data(), guard.id);
    expect(zone).toMatchObject({
      source: 'map',
      preset: 'underground',
      from: { id: hall.id },
      onMap: { id: deeps.id },
    });
    // Dort gibt es kein Wetter, dafür Licht und Dunkelheit.
    expect(weatherAt(data(), guard.id, data().state.now).today.sheltered).toBe(true);
    expect(lightStatus(data(), guard.id, data().state.now)).not.toBeNull();
    expect(lightStatus(data(), town.id, data().state.now)).toBeNull();
  });

  it('eine Karte der Oberwelt macht niemanden zum Höhlenbewohner', async () => {
    const { db, data, town, land } = await setup();
    placeMarker(db, land.id, [300, 300], town.id);
    expect(isUnderground(data(), town.id)).toBe(false);
  });

  it('wer auf beiden Karten steht – ein Aufgang –, bleibt, was er sonst ist', async () => {
    const { db, data, stairs, deeps, land } = await setup();
    placeMarker(db, deeps.id, [100, 100], stairs.id);
    expect(isUnderground(data(), stairs.id)).toBe(true);
    placeMarker(db, land.id, [600, 200], stairs.id);
    expect(isUnderground(data(), stairs.id)).toBe(false);
  });

  it('ein festgelegtes Klima geht der Karte vor', async () => {
    const { db, data, hall, deeps } = await setup();
    placeMarker(db, deeps.id, [700, 300], hall.id);
    const months = data().campaign.calendar.months.length;
    const temperate = db.put('climates', presetClimate('temperate', months, 6));
    db.patch('entities', hall.id, { place: { ...hall.place, climateId: temperate.id } });
    expect(weatherZone(data(), hall.id).source).toBe('chosen');
    expect(isUnderground(data(), hall.id)).toBe(false);
  });

  it('verschwindet der Punkt von der Karte, gilt wieder das Alte', async () => {
    const { db, data, hall, deeps } = await setup();
    placeMarker(db, deeps.id, [700, 300], hall.id);
    const marker = data().maps[deeps.id]!.markers[0]!;
    removeMarker(db, deeps.id, marker.id);
    expect(isUnderground(data(), hall.id)).toBe(false);
  });
});
