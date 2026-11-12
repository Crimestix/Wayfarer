import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { saveWay } from '../../features/wege/actions';
import { setManualWeather } from '../../features/wetter/actions';
import { createEntity, type Place, type Weather } from '../schema';
import { dayIndexOf } from '../time/calendar';
import { soilOf, wayCondition } from '../wayState';
import { routeBetween, routeDetour, wayNotes, wayWeather, waysFrom } from '../ways';
import { weatherZone } from '../weatherZone';

/**
 * Erfundene Gegend: Von Hohenfurt führt ein Pfad nach Graufels (60 Min.) und ein Steg durchs Moor
 * zur Aalinsel (30 Min.); von Graufels geht eine Straße zur Aalinsel (90 Min.). In Graufels
 * verbindet eine Gasse Markt und Hafen, darunter liegt ein Gang.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string, parentId: string | null = null) =>
    db.put('entities', createEntity({ kind: 'place', name, place: { parentId } })) as Place;
  const ford = place('Hohenfurt');
  const town = place('Graufels');
  const isle = place('Aalinsel');
  const market = place('Markt', town.id);
  const harbour = place('Hafen', town.id);
  const trail = saveWay(db, { fromId: ford.id, toId: town.id, minutes: 60, sort: 'trail' });
  const bog = saveWay(db, { fromId: ford.id, toId: isle.id, minutes: 30, sort: 'swamp' });
  const road = saveWay(db, { fromId: town.id, toId: isle.id, minutes: 90, sort: 'road' });
  const alley = saveWay(db, { fromId: market.id, toId: harbour.id, minutes: 5 });
  const tunnel = saveWay(db, {
    fromId: market.id,
    toId: ford.id,
    minutes: 200,
    sort: 'underground',
  });
  const data = () => db.getSnapshot();
  const today = dayIndexOf(data().state.now);
  /** Legt das Wetter eines Tages fest: `back` Tage vor heute. */
  const sky = (back: number, precipitation: Weather['precipitation'], temperature = 12) => {
    // Jeder Ort kann seine eigene Wetterzone haben (die Insel erkennt Wayfarer am Namen).
    for (const where of [ford, town, isle])
      setManualWeather(db, weatherZone(data(), where.id), today - back, {
        temperature,
        precipitation,
        wind: 'none',
        fog: false,
        note: '',
      });
  };
  const dry = () => [0, 1, 2].forEach((back) => sky(back, 'none'));
  const state = (id: string) => wayCondition(data(), data().paths[id]!).state;
  return { db, data, ford, town, isle, market, trail, bog, road, alley, tunnel, sky, dry, state };
}

describe('Der Boden eines Weges', () => {
  it('befestigt, fest, nass oder unter der Erde', async () => {
    const { data, trail, bog, road, alley, tunnel } = await setup();
    const soil = (id: string) => soilOf(data(), data().paths[id]!);
    expect([trail, bog, road, alley, tunnel].map((way) => soil(way.id))).toEqual([
      'firm',
      'wet',
      'paved',
      'paved',
      'sheltered',
    ]);
  });
});

describe('Das Wetter wirkt auf den Weg', () => {
  it('bei trockenem Wetter sind alle Wege frei', async () => {
    const { data, dry, ford, state, trail, bog, road } = await setup();
    dry();
    expect([trail, bog, road].map((way) => state(way.id))).toEqual(['clear', 'clear', 'clear']);
    expect(waysFrom(data(), ford.id).map((way) => [way.minutes, way.barred])).toEqual([
      [30, false],
      [60, false],
      [200, false],
    ]);
  });

  it('Starkregen: der Pfad verschlammt, der Steg durchs Moor geht verloren, die Straße hält', async () => {
    const { data, dry, sky, ford, state, trail, bog, road, alley, tunnel } = await setup();
    dry();
    sky(0, 'heavy');
    expect([trail, bog, road, alley, tunnel].map((way) => state(way.id))).toEqual([
      'muddy',
      'lost',
      'clear',
      'clear',
      'clear',
    ]);
    const ways = waysFrom(data(), ford.id);
    const path = ways.find((way) => way.path.id === trail.id)!;
    // Halbes Tempo: aus einer Stunde werden zwei.
    expect(path.minutes).toBe(120);
    expect(wayNotes(data(), path)).toEqual(['Verschlammt: Starkregen heute – halbes Tempo']);
    expect(ways.find((way) => way.path.id === bog.id)).toMatchObject({ minutes: 60, barred: true });
  });

  it('der Regen von gestern wirkt nach – nach zwei trockenen Tagen ist der Pfad wieder frei', async () => {
    const { dry, sky, state, trail, bog } = await setup();
    dry();
    sky(1, 'heavy');
    expect([state(trail.id), state(bog.id)]).toEqual(['muddy', 'lost']);
    dry();
    sky(2, 'heavy');
    // Fester Boden ist abgetrocknet; im Moor steht der Schlamm noch.
    expect([state(trail.id), state(bog.id)]).toEqual(['clear', 'muddy']);
  });

  it('Dauerregen weicht nur nassen Grund auf', async () => {
    const { dry, sky, state, trail, bog } = await setup();
    dry();
    sky(0, 'light');
    sky(1, 'light');
    expect([state(trail.id), state(bog.id)]).toEqual(['clear', 'muddy']);
  });

  it('starker Schnee macht jeden Weg im Freien beschwerlich – nicht die Gasse, nicht den Gang', async () => {
    const { dry, sky, state, trail, bog, road, alley, tunnel } = await setup();
    dry();
    sky(1, 'heavy', -6);
    expect([trail, bog, road, alley, tunnel].map((way) => state(way.id))).toEqual([
      'snowed',
      'snowed',
      'snowed',
      'clear',
      'clear',
    ]);
  });
});

describe('Die Route folgt dem Wetter', () => {
  it('nimmt den Umweg, wenn das Moor den Steg verschluckt hat', async () => {
    const { data, dry, sky, ford, isle, town } = await setup();
    dry();
    expect(routeBetween(data(), ford.id, isle.id)).toMatchObject({ minutes: 30, via: [] });
    sky(0, 'heavy');
    const route = routeBetween(data(), ford.id, isle.id)!;
    // Über Graufels: der verschlammte Pfad (120) und die Straße (90).
    expect(route).toMatchObject({ minutes: 210, via: [town.id], barred: false });
    expect(routeDetour(data(), route)).toBe(
      'Der direkte Weg ist versperrt: Nicht passierbar: Starkregen heute hat den Weg durch den nassen Grund verschluckt',
    );
  });

  it('ohne anderen Weg bleibt die Route – als versperrt gemeldet', async () => {
    const { db, data, dry, sky, ford, isle, road } = await setup();
    db.remove('paths', road.id);
    dry();
    sky(0, 'heavy');
    expect(routeBetween(data(), ford.id, isle.id)).toMatchObject({ barred: true, via: [] });
  });

  it('Fachlogik, die nur Orte und Wege kennt, rechnet ohne Wetter', async () => {
    const { data, dry, sky, bog } = await setup();
    dry();
    sky(0, 'heavy');
    const { entities, paths, maps } = data();
    expect(wayWeather({ entities, paths, maps }, paths[bog.id]!)).toBeNull();
    expect(wayWeather(data(), paths[bog.id]!)?.state).toBe('lost');
  });
});
