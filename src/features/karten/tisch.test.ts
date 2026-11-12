import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { markerOfPlace } from '../../domain/mapDraw';
import { createEntity, type Place } from '../../domain/schema';
import { placeMaps } from '../tisch/wiki';
import { saveWay } from '../wege/actions';
import { createDrawnMap, drawLine, paintGround, placeMarker } from './actions';
import { pickAt, routeText } from './model';

/**
 * Erfundene Gewölbe unter Graufels: Pilzgrotte und Torhalle stehen auf der Karte, verbunden durch
 * einen Gang. In der Torhalle liegt die Wachstube – sie hat keinen eigenen Punkt.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string, parentId: string | null = null) =>
    db.put('entities', createEntity({ kind: 'place', name, place: { parentId } })) as Place;
  const deeps = place('Die Tiefen');
  const grotto = place('Pilzgrotte', deeps.id);
  const hall = place('Torhalle', deeps.id);
  const guard = place('Wachstube', hall.id);
  const far = place('Hohenfurt');
  const map = createDrawnMap(db, {
    name: 'Die Tiefen unter Graufels',
    widthKm: 2,
    placeId: deeps.id,
    level: 'underground',
    ground: 'rock',
  });
  paintGround(db, map.id, 'cave', 100, [[220, 300]]);
  paintGround(db, map.id, 'cave', 100, [[700, 300]]);
  placeMarker(db, map.id, [220, 300], grotto.id);
  placeMarker(db, map.id, [700, 300], hall.id);
  placeMarker(db, map.id, [450, 500], null, 'Alter Schacht');
  const { line } = drawLine(db, map.id, 'road', [
    [220, 300],
    [700, 300],
  ]);
  const data = () => db.getSnapshot();
  const current = () => data().maps[map.id]!;
  return { db, data, current, deeps, grotto, hall, guard, far, line: line! };
}

describe('Wo die Gruppe auf der Karte steht', () => {
  it('am Punkt ihres Ortes – sonst an dem des nächsten Ortes darüber', async () => {
    const { data, current, grotto, hall, guard, far } = await setup();
    expect(markerOfPlace(data(), current(), grotto.id)?.entityId).toBe(grotto.id);
    // Die Wachstube hat keinen Punkt: Die Gruppe steht dann an der Torhalle.
    expect(markerOfPlace(data(), current(), guard.id)?.entityId).toBe(hall.id);
    expect(markerOfPlace(data(), current(), far.id)).toBeNull();
    expect(markerOfPlace(data(), current(), null)).toBeNull();
  });
});

describe('Gezeichnete Karten am Spieltisch', () => {
  it('die Karte des Ortes selbst und die seiner Umgebung, mit dem Punkt der Gruppe', async () => {
    const { data, deeps, grotto, hall, guard, far } = await setup();
    expect(placeMaps(data(), deeps)).toMatchObject([{ own: true, marker: null }]);
    const around = placeMaps(data(), grotto);
    expect(around).toHaveLength(1);
    expect(around[0]).toMatchObject({ own: false, of: { id: deeps.id } });
    expect(around[0]!.marker?.entityId).toBe(grotto.id);
    // Die Wachstube steht nicht selbst auf der Karte: markiert ist die Torhalle darüber.
    expect(placeMaps(data(), guard)[0]!.marker?.entityId).toBe(hall.id);
    expect(placeMaps(data(), far)).toEqual([]);
  });

  it('auch eine Karte ohne zugeordneten Ort, wenn der Ort als Punkt darauf steht', async () => {
    const { db, data, grotto, hall, far } = await setup();
    const loose = createDrawnMap(db, {
      name: 'Alte Skizze',
      widthKm: 1,
      placeId: null,
      level: 'underground',
      ground: 'rock',
    });
    placeMarker(db, loose.id, [500, 350], hall.id);
    const maps = placeMaps(data(), hall);
    expect(maps.map((entry) => entry.map.name)).toEqual([
      'Die Tiefen unter Graufels',
      'Alte Skizze',
    ]);
    expect(maps[1]).toMatchObject({ own: false, of: { id: hall.id } });
    expect(maps[1]!.marker?.entityId).toBe(hall.id);
    // Wer nicht darauf steht, bekommt sie nicht angeboten.
    expect(placeMaps(data(), grotto).map((entry) => entry.map.name)).toEqual([
      'Die Tiefen unter Graufels',
    ]);
    expect(placeMaps(data(), far)).toEqual([]);
  });
});

describe('Ein Klick auf die Karte', () => {
  it('trifft zuerst den Ort, dann die Linie, dann das Gelände', async () => {
    const { current, line } = await setup();
    const map = current();
    const marker = map.markers[0]!;
    expect(pickAt(map, [224, 303], 1)).toEqual({ kind: 'marker', id: marker.id });
    expect(pickAt(map, [450, 304], 1)).toEqual({ kind: 'line', id: line.id });
    expect(pickAt(map, [450, 320], 1)).toEqual({ kind: 'ground', at: [450, 320] });
    expect(pickAt(map, [-20, 320], 1)).toBeNull();
    // Weit hineingezoomt liegt dieselbe Stelle am Schirm weiter vom Ort entfernt.
    expect(pickAt(map, [224, 310], 4)).toEqual({ kind: 'ground', at: [224, 310] });
  });
});

describe('Der Weg von hier', () => {
  it('nennt die Dauer – über die Karte gerechnet – und den Umweg', async () => {
    const { db, data, grotto, hall, guard, far } = await setup();
    // 480 Einheiten bei 2 m je Einheit: 960 m Gang, zwölf Minuten.
    expect(routeText(data(), grotto.id, hall.id)).toBe('12 Min.');
    expect(routeText(data(), hall.id, grotto.id)).toBe('12 Min.');
    saveWay(db, { fromId: hall.id, toId: guard.id, minutes: 3 });
    expect(routeText(data(), grotto.id, guard.id)).toBe('15 Min. über Torhalle');
    expect(routeText(data(), grotto.id, grotto.id)).toBeNull();
    expect(routeText(data(), null, hall.id)).toBeNull();
    expect(routeText(data(), grotto.id, far.id)).toBeNull();
  });
});
