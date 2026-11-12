import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { lightUp } from '../../features/unterreich/actions';
import { rememberWay, removeWay, saveWay, walk, walkRoute } from '../../features/wege/actions';
import { MapSchema, createEntity, createEvent } from '../schema';
import { LIGHT_PRESETS, burningLights } from '../underground';
import {
  describeVia,
  directWay,
  formatWayTime,
  routeBetween,
  suggestedKm,
  wayLine,
  wayMinutes,
  waysAround,
  waysFrom,
} from '../ways';

/**
 * Eine erfundene Stadt: Hohenfurt mit Markt, Hafen, Oberstadt und Reusenhof. Im Hafen liegt das
 * Gasthaus „Zum Aal“.
 *
 *   Markt ──10── Hafen ──15── Reusenhof
 *     └────────40─────────────┘        Markt ──► Oberstadt (20, nur hinauf)
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  for (const id of Object.keys(db.getSnapshot().events)) db.remove('events', id);
  const place = (name: string, parentId: string | null = null) =>
    db.put('entities', createEntity({ kind: 'place', name, place: { parentId } }));
  const town = place('Hohenfurt');
  const market = place('Markt', town.id);
  const harbour = place('Hafen', town.id);
  const yard = place('Reusenhof', town.id);
  const upper = place('Oberstadt', town.id);
  const inn = place('Zum Aal', harbour.id);
  const quay = saveWay(db, { fromId: market.id, toId: harbour.id, minutes: 10, name: 'Kaigasse' });
  saveWay(db, { fromId: harbour.id, toId: yard.id, minutes: 15 });
  const long = saveWay(db, { fromId: market.id, toId: yard.id, minutes: 40 });
  const stairs = saveWay(db, { fromId: market.id, toId: upper.id, minutes: 20, oneWay: true });
  db.setState({ placeId: market.id });
  const data = () => db.getSnapshot();
  const names = (ids: string[]) => ids.map((id) => data().entities[id]!.name);
  return { db, data, names, town, market, harbour, yard, upper, inn, quay, long, stairs };
}

describe('Wege', () => {
  it('kennt die Wege, die von einem Ort abgehen – in beide Richtungen, der kürzeste zuerst', async () => {
    const { data, names, market, harbour, upper } = await setup();
    expect(names(waysFrom(data(), market.id).map((w) => w.toId))).toEqual([
      'Hafen',
      'Oberstadt',
      'Reusenhof',
    ]);
    expect(
      waysFrom(data(), harbour.id).map((w) => [names([w.toId])[0], w.minutes, w.reverse]),
    ).toEqual([
      ['Markt', 10, true],
      ['Reusenhof', 15, false],
    ]);
    // Die Treppe führt nur hinauf: Von der Oberstadt geht kein Weg zurück.
    expect(waysFrom(data(), upper.id)).toEqual([]);
  });

  it('bricht aus dem Gasthaus vom Viertel aus auf', async () => {
    const { data, names, harbour, inn, town } = await setup();
    const around = waysAround(data(), inn.id)!;
    expect(around.origin.id).toBe(harbour.id);
    expect(names(around.ways.map((w) => w.toId))).toEqual(['Markt', 'Reusenhof']);
    // Die Stadt selbst hat keine Wege, und darüber liegt nichts.
    expect(waysAround(data(), town.id)).toBeNull();
    expect(waysAround(data(), null)).toBeNull();
  });

  it('findet die schnellste Route über mehrere Punkte', async () => {
    const { data, names, market, yard, upper, harbour } = await setup();
    // Über den Hafen sind es 25 Minuten, direkt 40.
    const route = routeBetween(data(), market.id, yard.id)!;
    expect(route.minutes).toBe(25);
    expect(names(route.via)).toEqual(['Hafen']);
    expect(describeVia(data(), route)).toBe('über Hafen');
    expect(route.unknown).toBe(false);
    expect(directWay(data(), market.id, yard.id)?.minutes).toBe(40);
    // In die Oberstadt kommt man, aus ihr auf diesem Netz nicht wieder heraus.
    expect(routeBetween(data(), harbour.id, upper.id)?.minutes).toBe(30);
    expect(routeBetween(data(), upper.id, market.id)).toBeNull();
    expect(routeBetween(data(), market.id, market.id)).toBeNull();
  });

  it('wer im Viertel steht, nimmt auch die Wege der Stadt – und kommt auf dem Rückweg wieder an', async () => {
    const { db, data, names, town, market, harbour, inn } = await setup();
    const place = (name: string, parentId: string | null = null) =>
      db.put('entities', createEntity({ kind: 'place', name, place: { parentId } }));
    const isle = place('Aalinsel');
    const hut = place('Fischerhütte', isle.id);
    saveWay(db, { fromId: town.id, toId: isle.id, minutes: 180 });
    // Vom Markt geht kein Weg zur Insel, aber von der Stadt, in der er liegt.
    const out = routeBetween(data(), market.id, isle.id)!;
    expect(out).toMatchObject({ minutes: 180, via: [], unknown: false, toId: isle.id });
    expect(out.legs[0]!.fromId).toBe(town.id);
    // Zurück endet der Weg in der Stadt – angekommen ist die Gruppe am Markt.
    const back = routeBetween(data(), isle.id, market.id)!;
    expect(back).toMatchObject({ minutes: 180, toId: market.id });
    expect(back.legs[0]!.toId).toBe(town.id);
    db.setState({ placeId: isle.id });
    walkRoute(db, back);
    expect(data().state.placeId).toBe(market.id);
    // Aus dem Gasthaus im Hafen bis zur Hütte auf der Insel: derselbe Weg.
    expect(routeBetween(data(), inn.id, hut.id)?.minutes).toBe(180);
    // Die Stadt, in der die Gruppe steht, ist kein Punkt auf dem Weg.
    expect(routeBetween(data(), market.id, town.id)).toBeNull();
    // Ein eingetragener Weg geht vor: Vom Hafen fährt ein Boot.
    saveWay(db, { fromId: harbour.id, toId: isle.id, minutes: 90, name: 'Fähre' });
    expect(routeBetween(data(), harbour.id, isle.id)?.minutes).toBe(90);
    expect(routeBetween(data(), market.id, isle.id)).toMatchObject({ minutes: 100, toId: isle.id });

    // Am Tisch: erst die Wege des Viertels, dann die aus der Stadt hinaus.
    const around = waysAround(data(), market.id)!;
    expect(around.origin.id).toBe(market.id);
    expect(around.above?.origin.id).toBe(town.id);
    expect(names(around.above!.ways.map((way) => way.toId))).toEqual(['Aalinsel']);
  });

  it('rechnet die Dauer aus der Länge, wenn keine feste eingetragen ist', async () => {
    const { db, data, market, upper, stairs } = await setup();
    // 2,4 km bei 4,8 km/h: eine halbe Stunde.
    const path = db.patch('paths', stairs.id, { minutes: null, distanceKm: 2.4 });
    expect(wayMinutes(data(), path)).toBe(30);
    expect(wayMinutes(data(), path, 'slow')).toBe(45);
    // Im Gebirge dauert es doppelt so lang.
    expect(wayMinutes(data(), { ...path, terrain: 'mountains' })).toBe(60);
    // Weder Dauer noch Länge: unbekannt – die Route sagt es dazu.
    db.patch('paths', stairs.id, { distanceKm: null });
    const route = routeBetween(data(), market.id, upper.id)!;
    expect(route).toMatchObject({ minutes: 0, unknown: true });
  });

  it('misst Wege auf einer Karte mit Maßstab und zeichnet sie zwischen den Punkten', async () => {
    const { db, data, market, harbour, yard, quay, long } = await setup();
    const map = db.put(
      'maps',
      MapSchema.parse({
        id: 'stadtplan',
        rev: 0,
        created: '',
        updated: '',
        name: 'Stadtplan',
        frame: { width: 1000, height: 1000 },
        scale: { kmPerUnit: 0.002 },
        markers: [
          { id: 'm1', x: 100, y: 100, entityId: market.id },
          { id: 'm2', x: 400, y: 500, entityId: harbour.id },
        ],
      }),
    );
    // 500 Einheiten Luftlinie zu 2 m: ein Kilometer.
    expect(suggestedKm(data(), market.id, harbour.id)).toBeCloseTo(1, 6);
    expect(suggestedKm(data(), market.id, yard.id)).toBeNull();
    expect(wayLine(map, quay)).toEqual([
      [100, 100],
      [400, 500],
    ]);
    // Der Reusenhof liegt nicht auf der Karte: Dieser Weg wird dort nicht gezeichnet.
    expect(wayLine(map, long)).toBeNull();
    // Ein gezeichneter Verlauf geht der Geraden vor und bestimmt die Länge.
    const drawn = db.patch('paths', quay.id, {
      minutes: null,
      mapId: map.id,
      points: [
        [100, 100],
        [100, 500],
        [400, 500],
      ],
    });
    expect(wayLine(map, drawn)).toHaveLength(3);
    // 700 Einheiten = 1,4 km: 17,5 Minuten, gerundet 18.
    expect(wayMinutes(data(), drawn)).toBe(18);
  });

  it('lässt beim Gehen die Zeit vergehen – Termine treten ein, Lichter brennen herunter', async () => {
    const { db, data, market, harbour, yard } = await setup();
    const start = data().state.now;
    db.put(
      'events',
      createEvent({ title: 'Die Seeschwalbe legt ab', at: start + 20, timed: true }),
    );
    lightUp(
      db,
      LIGHT_PRESETS.find((p) => p.id === 'torch')!,
    );
    const result = walkRoute(db, routeBetween(data(), market.id, yard.id)!);
    expect(data().state).toMatchObject({ now: start + 25, placeId: yard.id });
    expect(result.advance?.occurred.map((o) => o.event.title)).toEqual(['Die Seeschwalbe legt ab']);
    expect(burningLights(data())[0]!.end - data().state.now).toBe(35);
    // Der Ortswechsel steht bei der Ankunft in der Chronik, mit Route und Dauer.
    expect(result.entry).toMatchObject({
      kind: 'travel',
      at: start + 25,
      text: 'über Hafen · 25 Min.',
      travel: { fromId: market.id, toId: yard.id },
    });
    // Zurücknehmen: Zeit und Ort sind wie vorher.
    result.undo();
    expect(data().state).toMatchObject({ now: start, placeId: market.id });
    expect(Object.values(data().chronicle).filter((e) => e.kind === 'travel')).toEqual([]);
    // Ein einzelner Weg ohne Dauer: Die Zeit bleibt stehen, der Ort wechselt.
    const still = walk(db, harbour.id, 0);
    expect(data().state).toMatchObject({ now: start, placeId: harbour.id });
    expect(still.advance).toBeNull();
  });

  it('merkt sich die Dauer eines neuen Weges – auch für den Rückweg', async () => {
    const { db, data, yard, upper } = await setup();
    expect(rememberWay(db, yard.id, upper.id, 35)).toMatchObject({ minutes: 35, terrain: 'urban' });
    expect(directWay(data(), upper.id, yard.id)?.minutes).toBe(35);
    // Gibt es den Weg schon, bleibt er, wie er ist.
    expect(rememberWay(db, upper.id, yard.id, 50)).toBeNull();
    expect(rememberWay(db, yard.id, yard.id, 5)).toBeNull();
    expect(rememberWay(db, yard.id, upper.id, 0)).toBeNull();
    // Entfernen lässt sich zurücknehmen.
    const way = directWay(data(), yard.id, upper.id)!;
    const undo = removeWay(db, way.path.id)!;
    expect(directWay(data(), yard.id, upper.id)).toBeNull();
    undo();
    expect(directWay(data(), yard.id, upper.id)?.minutes).toBe(35);
  });

  it('schreibt Dauern lesbar', () => {
    expect([5, 60, 135, 1440, 4560, 0].map(formatWayTime)).toEqual([
      '5 Min.',
      '1 Std.',
      '2 Std. 15 Min.',
      '1 Tag',
      '3 Tage 4 Std.',
      '0 Min.',
    ]);
  });
});
