import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { hexMinutes, stepProblem } from '../../features/erkundung/travel';
import {
  addMeans,
  removeMeans,
  saveMeans,
  setMeansCondition,
  travelWith,
} from '../../features/fortbewegung/actions';
import { saveWay, walkRoute } from '../../features/wege/actions';
import { setManualWeather } from '../../features/wetter/actions';
import {
  meansFromWare,
  meansGroups,
  meansKmh,
  meansMph,
  paceText,
  partyMeans,
  partyTravel,
  travelNotes,
  upkeepSince,
  upkeepText,
  wayFit,
} from '../mounts';
import {
  AreaSchema,
  MountSchema,
  PlayStateSchema,
  createEntity,
  createMount,
  createPath,
  createSession,
  type Mount,
  type Place,
} from '../schema';
import { MINUTES_PER_DAY, dayIndexOf } from '../time/calendar';
import { routeBetween, routeFit, wayMinutes, waysFrom } from '../ways';
import { WAY_SORT_VALUES, sortOfWay, soilOf, wayCondition } from '../wayState';
import { weatherZone } from '../weatherZone';

const horse = (more: Partial<Mount> = {}) => createMount({ name: 'Reitpferd', ...more });
const ship = (more: Partial<Mount> = {}) =>
  createMount({ name: 'Seewind', kind: 'ship', pace: 4, ...more });

/**
 * Erfundene Küste: Vom Hafen Hohenfurt führt ein Bergpfad zur Salzgrotte (30 km Gebirge) und ein
 * Wasserweg um die Klippen (72 km). Brann Eichwald und Ilka Sturmfels reisen mit.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string) =>
    db.put('entities', createEntity({ kind: 'place', name })) as Place;
  const harbour = place('Hohenfurt');
  const grotto = place('Salzgrotte');
  const castle = place('Burg Graufels');
  const pass = db.put(
    'paths',
    createPath({
      fromId: harbour.id,
      toId: grotto.id,
      distanceKm: 30,
      terrain: 'mountains',
      road: 'trail',
      name: 'Bergpfad',
    }),
  );
  const sea = db.put(
    'paths',
    createPath({
      fromId: harbour.id,
      toId: grotto.id,
      distanceKm: 72,
      terrain: 'water',
      name: 'Um die Klippen',
    }),
  );
  saveWay(db, { fromId: grotto.id, toId: castle.id, minutes: 90, sort: 'road' });
  const brann = db.put('entities', createEntity({ kind: 'character', name: 'Brann Eichwald' }));
  const ilka = db.put('entities', createEntity({ kind: 'character', name: 'Ilka Sturmfels' }));
  db.setState({ placeId: harbour.id });
  const data = () => db.getSnapshot();
  // Trockenes Wetter rund um heute – Wege an Land verschlammen sonst je nach Würfel.
  const today = dayIndexOf(data().state.now);
  for (let back = -3; back <= 3; back++)
    for (const where of [harbour, grotto, castle])
      setManualWeather(db, weatherZone(data(), where.id), today - back, {
        temperature: 12,
        precipitation: 'none',
        wind: 'none',
        fog: false,
        note: '',
      });
  return { db, data, harbour, grotto, castle, pass, sea, brann, ilka };
}

describe('Fortbewegungsmittel im Spielstand', () => {
  it('liest alte Stände: neue Felder haben Vorgaben', () => {
    expect(MountSchema.parse({ id: 'm1', name: 'Karren', kind: 'vehicle' })).toMatchObject({
      kind: 'vehicle',
      ownerId: null,
      entityId: null,
      creatureId: null,
      pace: null,
      paceUnit: 'hour',
      flies: false,
      passengers: null,
      cargo: null,
      crew: null,
      upkeep: null,
      condition: 'ready',
    });
    expect(PlayStateSchema.parse({ id: 'state', now: 0 }).travelBy).toBeNull();
  });
});

describe('Tempo', () => {
  it('rechnet ein Tempo je Tag auf acht Reisestunden um', () => {
    expect(meansMph({ pace: 40, paceUnit: 'day' })).toBe(5);
    expect(meansMph({ pace: 3, paceUnit: 'hour' })).toBe(3);
    expect(meansMph({ pace: null, paceUnit: 'hour' })).toBeNull();
    expect(paceText({ pace: 40, paceUnit: 'day' })).toBe('40 Meilen am Tag');
    expect(paceText({ pace: 1.5, paceUnit: 'hour' })).toBe('1,5 Meilen je Stunde');
    expect(paceText({ pace: null, paceUnit: 'hour' })).toBe('im Tempo der Gruppe');
  });

  it('Reittiere folgen dem Reisetempo, Schiffe halten ihres', () => {
    const fast = horse({ pace: 6 });
    expect(meansKmh(fast, 'fast')! / meansKmh(fast, 'normal')!).toBeCloseTo(4 / 3);
    expect(meansKmh(ship(), 'slow')).toBeCloseTo(meansKmh(ship(), 'fast')!);
    expect(meansKmh(horse(), 'normal')).toBeNull();
  });

  it('die Dauer eines Weges folgt dem Mittel – feste Minuten gelten immer', () => {
    const data = { entities: {}, paths: {}, maps: {} };
    const road = createPath({ fromId: 'a', toId: 'b', distanceKm: 48, road: 'road' });
    expect(wayMinutes(data, road)).toBe(600);
    // Ohne eigenes Tempo reist ein Pferd im Tempo der Gruppe (Regelwerk).
    expect(wayMinutes(data, road, { pace: 'normal', by: horse() })).toBe(600);
    expect(wayMinutes(data, road, { pace: 'normal', by: horse({ pace: 6 }) })).toBe(298);
    expect(
      wayMinutes(data, { ...road, minutes: 45 }, { pace: 'normal', by: horse({ pace: 6 }) }),
    ).toBe(45);
    // Ein Schiff trägt nicht an Land: Dieser Weg geht zu Fuß.
    expect(wayMinutes(data, road, { pace: 'normal', by: ship() })).toBe(600);
  });

  it('Schiffe und Fliegendes kümmert schwieriges Gelände nicht', () => {
    const data = { entities: {}, paths: {}, maps: {} };
    const swamp = createPath({ fromId: 'a', toId: 'b', distanceKm: 24, terrain: 'swamp' });
    expect(wayMinutes(data, swamp)).toBe(600);
    const griffin = horse({ name: 'Greif', pace: 6, flies: true });
    expect(wayMinutes(data, swamp, { pace: 'normal', by: griffin })).toBe(149);
    const river = { ...swamp, terrain: 'water' as const };
    expect(wayMinutes(data, river, { pace: 'normal', by: ship({ pace: 2 }) })).toBe(447);
  });
});

describe('Passt das Mittel zum Weg?', () => {
  const trail = { terrain: 'swamp' as const, road: 'trail' as const };
  const road = { terrain: 'grassland' as const, road: 'road' as const };
  const water = { terrain: 'water' as const, road: 'none' as const };
  const coach = horse({ name: 'Kutsche', kind: 'vehicle' });

  it('gibt einen ruhigen Hinweis, nie ein Verbot', () => {
    expect(wayFit({ pace: 'normal', by: coach }, trail)).toBe(
      'Kutsche kommt hier schwer voran: ein schmaler Pfad (Sumpf)',
    );
    expect(wayFit({ pace: 'normal', by: coach }, { terrain: 'forest', road: 'none' })).toBe(
      'Kutsche kommt hier schwer voran: Es gibt keinen Weg für Räder',
    );
    expect(wayFit({ pace: 'normal', by: coach }, road)).toBeNull();
    expect(wayFit({ pace: 'normal', by: coach }, { terrain: 'urban', road: 'none' })).toBeNull();
    expect(wayFit({ pace: 'normal', by: ship() }, road)).toBe(
      'Seewind fährt nur auf dem Wasser – dieser Weg geht zu Fuß',
    );
    expect(wayFit({ pace: 'normal', by: ship() }, water)).toBeNull();
    expect(wayFit({ pace: 'normal', by: horse() }, water)).toBe(
      'Ein Wasserweg – Reitpferd braucht ein Schiff oder eine Fähre',
    );
    expect(wayFit('normal', water)).toBe(
      'Ein Wasserweg – ohne Schiff braucht die Gruppe eine Überfahrt',
    );
    expect(wayFit('normal', road)).toBeNull();
    expect(wayFit({ pace: 'normal', by: horse({ flies: true }) }, water)).toBeNull();
  });

  it('nennt Zustand und Rast nur als Hinweis', () => {
    expect(travelNotes({ pace: 'normal', by: horse({ condition: 'tired' }) }, 60)).toEqual([
      'Reitpferd ist erschöpft – eine Rast täte gut',
    ]);
    expect(travelNotes({ pace: 'normal', by: horse() }, 9 * 60)).toEqual([
      'Länger als ein Reisetag von acht Stunden: Die Tiere brauchen unterwegs Rast',
    ]);
    expect(travelNotes({ pace: 'normal', by: ship({ condition: 'damaged' }) }, 30 * 60)).toEqual([
      'Seewind ist beschädigt',
    ]);
    expect(travelNotes('normal', 30 * 60)).toEqual([]);
  });
});

describe('Wasserwege', () => {
  it('sind eine eigene Art von Weg, die kein Schlamm und kein Schnee kümmert', async () => {
    const { db, data, sea } = await setup();
    expect(WAY_SORT_VALUES.water).toEqual({ terrain: 'water', road: 'none' });
    expect(sortOfWay(data().paths[sea.id]!)).toBe('water');
    expect(soilOf(data(), data().paths[sea.id]!)).toBe('water');
    const today = dayIndexOf(data().state.now);
    for (const id of [sea.fromId, sea.toId])
      setManualWeather(db, weatherZone(data(), id), today, {
        temperature: -5,
        precipitation: 'heavy',
        wind: 'none',
        fog: false,
        note: '',
      });
    expect(wayCondition(data(), data().paths[sea.id]!).state).toBe('clear');
  });
});

describe('Reisen mit der Gruppe', () => {
  it('ein Schiff macht den Wasserweg zum schnelleren', async () => {
    const { db, data, harbour, grotto, sea, pass } = await setup();
    // Zu Fuß: 30 km Gebirge (doppelt) = 750 Min.; der Wasserweg zu Fuß gerechnet 900.
    expect(routeBetween(data(), harbour.id, grotto.id)!.legs[0]!.path.id).toBe(pass.id);
    const seewind = saveMeans(db, { name: 'Seewind', kind: 'ship', pace: 4 })!;
    travelWith(db, seewind.id);
    expect(partyMeans(data())?.id).toBe(seewind.id);
    const route = routeBetween(data(), harbour.id, grotto.id, partyTravel(data()))!;
    expect(route.legs[0]!.path.id).toBe(sea.id);
    expect(route.minutes).toBe(671);
    expect(route.legs[0]!.by?.id).toBe(seewind.id);
    expect(routeFit(route)).toEqual([]);

    // Weiter zur Burg geht es an Land: zu Fuß, mit Hinweis.
    const ways = waysFrom(data(), grotto.id, partyTravel(data()));
    const toCastle = ways.find((way) => way.path.terrain !== 'water' && way.path.minutes === 90)!;
    expect(toCastle.by).toBeNull();
    expect(toCastle.fit).toBe('Seewind fährt nur auf dem Wasser – dieser Weg geht zu Fuß');

    // In der Chronik steht, womit gereist wurde.
    const result = walkRoute(db, route);
    expect(data().chronicle[result.entry!.id]!.text).toContain('mit Seewind');
  });

  it('entfernt man das Mittel, geht die Gruppe wieder zu Fuß – rückgängig bringt beides zurück', async () => {
    const { db, data } = await setup();
    const mule = saveMeans(db, { name: 'Maultier', upkeep: 0.05 })!;
    travelWith(db, mule.id);
    const undo = removeMeans(db, mule.id)!;
    expect(data().mounts[mule.id]).toBeUndefined();
    expect(data().state.travelBy).toBeNull();
    undo();
    expect(data().mounts[mule.id]?.name).toBe('Maultier');
    expect(data().state.travelBy).toBe(mule.id);
    setMeansCondition(db, mule.id, 'tired');
    expect(data().mounts[mule.id]!.condition).toBe('tired');
    travelWith(db, 'gibt-es-nicht');
    expect(data().state.travelBy).toBeNull();
    expect(saveMeans(db, { name: '   ' })).toBeNull();
  });

  it('ordnet die Mittel nach Besitzer', async () => {
    const { db, data, brann } = await setup();
    const odo = db.put('entities', createEntity({ kind: 'person', name: 'Odo Tannhaus' }));
    const { mounts, undo } = addMeans(db, [
      { name: 'Ochsenkarren', kind: 'vehicle' },
      { name: 'Schlachtross', ownerId: brann.id },
      { name: 'Aalkahn', kind: 'ship', ownerId: odo.id },
    ]);
    expect(mounts).toHaveLength(3);
    expect(
      meansGroups(data()).map((group) => [group.label, group.mounts.map((m) => m.name)]),
    ).toEqual([
      ['Der Gruppe', ['Ochsenkarren']],
      ['Der Gefährten', ['Schlachtross']],
      ['Anderer', ['Aalkahn']],
    ]);
    undo();
    expect(Object.keys(data().mounts)).toEqual([]);
  });

  it('nennt den Unterhalt seit dem letzten Abend – abgezogen wird nichts', async () => {
    const { db, data } = await setup();
    for (const id of Object.keys(data().sessions)) db.remove('sessions', id);
    const mounts = addMeans(db, [
      { name: 'Maultier', upkeep: 0.05 },
      { name: 'Reitpferd', upkeep: 0.15 },
      { name: 'Ruderboot', kind: 'ship' },
    ]).mounts;
    expect(upkeepSince(data(), mounts)).toBeNull();
    const now = data().state.now;
    db.put('sessions', createSession({ number: 1, startAt: now - 10 * MINUTES_PER_DAY }));
    db.put('sessions', createSession({ number: 2, startAt: now - 3 * MINUTES_PER_DAY }));
    db.put('sessions', createSession({ number: 3, startAt: now + MINUTES_PER_DAY }));
    const upkeep = upkeepSince(data(), mounts)!;
    expect([upkeep.days, upkeep.gold, upkeep.since.number]).toEqual([3, 0.6, 2]);
    expect(upkeepText(upkeep)).toBe('Unterhalt seit dem letzten Abend: 6 SM (3 Tage)');
    expect(upkeepText({ ...upkeep, days: 0, gold: 0 })).toBe(
      'Unterhalt seit dem letzten Abend: noch keiner',
    );
  });
});

describe('Aus einem Kauf', () => {
  it('bringt die Werte des Regelwerks mit', () => {
    const data = { entities: {} };
    expect(meansFromWare(data, { srdId: 'srd-riding-horse', text: 'Reitpferd' })).toMatchObject({
      name: 'Reitpferd',
      kind: 'mount',
      speed: 60,
      capacity: 480,
      pace: null,
      builtIn: true,
    });
    expect(meansFromWare(data, { text: 'Segelschiff' })).toMatchObject({
      kind: 'ship',
      pace: 2,
      crew: 20,
      passengers: 20,
      cargo: 100,
    });
    expect(meansFromWare(data, { text: 'Luftschiff' })).toMatchObject({ flies: true });
    expect(meansFromWare(data, { text: 'Kutsche' })).toMatchObject({ kind: 'vehicle' });
    // Sattel und Überfahrt stehen im Regelwerk, sind aber kein Fortbewegungsmittel.
    expect(meansFromWare(data, { text: 'Reitsattel' })).toBeNull();
    expect(meansFromWare(data, { srdId: 'srd-passage-cabin' })).toBeNull();
  });

  it('erkennt Tiere und benannte Gegenstände der Welt', () => {
    const seewind = createEntity({ kind: 'item', name: 'Seewind', item: { category: 'Schiff' } });
    const pony = createEntity({ kind: 'animal', name: 'Bergpony' });
    const blanket = createEntity({ kind: 'item', name: 'Pferdedecke' });
    const data = { entities: { [seewind.id]: seewind, [pony.id]: pony, [blanket.id]: blanket } };
    expect(meansFromWare(data, { entityId: seewind.id })).toEqual({
      name: 'Seewind',
      kind: 'ship',
      entityId: seewind.id,
    });
    expect(meansFromWare(data, { entityId: pony.id })).toMatchObject({
      kind: 'mount',
      entityId: pony.id,
    });
    expect(meansFromWare(data, { entityId: blanket.id })).toBeNull();
    expect(meansFromWare(data, { text: 'Ochsenkarren' })).toMatchObject({ kind: 'vehicle' });
    expect(meansFromWare(data, { text: 'Laterne' })).toBeNull();
  });
});

describe('Auf der Hexkarte', () => {
  it('trägt ein Schiff übers Wasser', () => {
    const boat = ship({ pace: 3 });
    expect(hexMinutes(9.6, 'water', 'normal')).toBeNull();
    expect(hexMinutes(9.6, 'water', 'normal', boat)).toBe(120);
    // An Land geht es zu Fuß weiter.
    expect(hexMinutes(9.6, 'grassland', 'normal', boat)).toBe(
      hexMinutes(9.6, 'grassland', 'normal'),
    );
    expect(hexMinutes(9.6, 'grassland', 'normal', horse({ pace: 6 }))).toBe(60);
    const area = AreaSchema.parse({
      id: 'kueste',
      name: 'Küste',
      hexKm: 9.6,
      hexes: [
        { q: 0, r: 0, terrain: 'coast' },
        { q: 1, r: 0, terrain: 'water' },
      ],
      party: { q: 0, r: 0 },
    });
    expect(stepProblem(area, { q: 1, r: 0 })).toBe('impassable');
    expect(stepProblem(area, { q: 1, r: 0 }, boat)).toBeNull();
  });
});
