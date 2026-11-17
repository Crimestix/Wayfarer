import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  groundOf,
  journeyUnderway,
  journeyView,
  nextHalt,
  planJourney,
  type Roll,
} from '../../domain/journey';
import { marchedMinutes } from '../../domain/march';
import { createEntity, createPath, createRollTable, type Place } from '../../domain/schema';
import { campCheck, endJourney, startJourney, travelOn } from './actions';
import { hexMapForWay, withHexes } from './hexway';

/** Ein Würfel, der der Reihe nach die gegebenen Zahlen zeigt (danach 1). */
const dice = (...values: number[]): Roll => {
  const queue = [...values];
  return () => queue.shift() ?? 1;
};

/** Eine erfundene Strecke unter der Erde – dort gibt es kein Wetter, das Wege verändert. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string, more: Partial<Place['place']> = {}) =>
    db.put('entities', createEntity({ kind: 'place', name, place: more })) as Place;
  const below = place('Unterreich');
  const wide = place('Dunkelweite', {
    parentId: below.id,
    ground: 'Enge Kriechgänge',
    groundSlow: true,
  });
  const start = place('Kesselbrück', { parentId: below.id });
  const grotto = place('Glimmergrotten', { parentId: wide.id });
  const goal = place('Nachtzinne', { parentId: wide.id });
  // Fest eingetragene Dauer (gilt immer) und eine Dauer aus der Länge (zählt doppelt).
  db.put('paths', createPath({ fromId: start.id, toId: grotto.id, minutes: 600, name: 'Schlund' }));
  db.put('paths', createPath({ fromId: grotto.id, toId: goal.id, distanceKm: 10 }));
  db.setState({ placeId: start.id });
  return { db, data: () => db.getSnapshot(), wide, start, grotto, goal };
}

describe('Gelände aus der Welt', () => {
  it('gilt für alles unter der Gegend, die es trägt', async () => {
    const { data, wide, grotto, start } = await setup();
    expect(groundOf(data(), grotto.id)).toEqual({
      regionId: wide.id,
      word: 'Enge Kriechgänge',
      slow: true,
    });
    expect(groundOf(data(), start.id)).toBeNull();
  });

  it('verdoppelt nur Dauern, die nicht fest am Weg stehen', async () => {
    const { data, goal } = await setup();
    const plan = planJourney(data(), data().state.placeId!, goal.id)!;
    expect(plan.legs).toHaveLength(2);
    expect(plan.legs[0]).toMatchObject({ minutes: 600, slow: true, ground: 'Enge Kriechgänge' });
    const free = planJourney({ ...data(), paths: {} }, data().state.placeId!, goal.id);
    expect(free).toMatchObject({ free: true, unknown: true });
    expect(plan.legs[1]!.minutes).toBeGreaterThan(0);
  });
});

describe('Unterwegs', () => {
  it('reist bis zur nächsten Entscheidung: acht Stunden, dann der Ort am Weg', async () => {
    const { db, data, grotto, goal } = await setup();
    const plan = planJourney(data(), data().state.placeId!, goal.id)!;
    const started = startJourney(db, { toId: goal.id, plan, food: 10, water: 4 })!;
    expect(journeyUnderway(data())!.id).toBe(started.journey.id);
    const t0 = data().state.now;

    const first = travelOn(db, dice())!;
    expect(first.halt).toMatchObject({ kind: 'rest', minutes: 480, arrives: false });
    expect(data().state.now).toBe(t0 + 480);
    expect(journeyUnderway(data())!.progress).toMatchObject({ leg: 0, minutes: 480 });
    expect(marchedMinutes(data(), data().state.now)).toBe(480);

    const second = travelOn(db, dice())!;
    expect(second.halt).toMatchObject({ kind: 'place', minutes: 120, arrives: true });
    expect(data().state.placeId).toBe(grotto.id);
    expect(journeyUnderway(data())!.progress).toMatchObject({ leg: 1, minutes: 0 });
    // Die Prüfungen nach vier und acht Stunden ergaben nichts – das hält nicht an.
    second.undo();
    expect(data().state.placeId).not.toBe(grotto.id);
    expect(journeyUnderway(data())!.progress).toMatchObject({ leg: 0, minutes: 480 });
  });

  it('hält bei einer Begegnung aus der Tabelle der Gegend', async () => {
    const { db, data, wide, goal } = await setup();
    db.put(
      'tables',
      createRollTable({
        name: 'Begegnungen in der Dunkelweite',
        kind: 'encounter',
        placeId: wide.id,
        die: 8,
        dc: 15,
        entries: [
          { id: 'a', min: 1, max: 4, text: 'Eine Grauzwerg-Streife', refs: [] },
          { id: 'b', min: 5, max: 8, text: 'Ein hungriger Wurm', refs: [] },
        ],
      }),
    );
    const plan = planJourney(data(), data().state.placeId!, goal.id)!;
    startJourney(db, { toId: goal.id, plan });
    const view = journeyView(data(), journeyUnderway(data())!);
    expect(view.total).toBe(plan.minutes);
    // W20 = 16 (ab 15), W8 = 2: nach vier Stunden.
    const met = travelOn(db, dice(16, 2))!;
    expect(met.halt).toMatchObject({
      kind: 'encounter',
      minutes: 240,
      text: 'Eine Grauzwerg-Streife',
    });
    expect(met.halt.roll).toContain('W20 = 16 (ab 15)');
    expect(journeyUnderway(data())!.halt).toMatchObject({ kind: 'encounter' });
    expect(
      Object.values(data().chronicle).some((entry) => entry.text.includes('Grauzwerg-Streife')),
    ).toBe(true);
    // Die Nachtprüfung im Lager würfelt einmal.
    expect(campCheck(db, dice(3))).toBeNull();
    expect(campCheck(db, dice(20, 8))).toMatchObject({ text: 'Ein hungriger Wurm' });
  });

  it('kommt am Ziel an und endet', async () => {
    const { db, data, goal } = await setup();
    const plan = planJourney(data(), data().state.placeId!, goal.id)!;
    startJourney(db, { toId: goal.id, plan });
    for (let i = 0; i < 6 && journeyUnderway(data()); i++) travelOn(db, dice());
    expect(journeyUnderway(data())).toBeNull();
    expect(data().state.placeId).toBe(goal.id);
    expect(endJourney(db, true)).toBeNull();
  });

  it('nimmt eine Stunde, wenn man nur ein Stück weiter will', async () => {
    const { db, data, goal } = await setup();
    startJourney(db, { toId: goal.id, plan: planJourney(data(), data().state.placeId!, goal.id)! });
    const hour = nextHalt(data(), journeyUnderway(data())!, dice(), 60)!;
    expect(hour).toMatchObject({ kind: 'hour', minutes: 60 });
  });
});

describe('Wegenetz, Hexkarte und Unterwegs', () => {
  it('gibt einem Weg einmal seine Hexkarte – danach bleibt sie dieselbe', async () => {
    const { db, data, grotto, goal } = await setup();
    const path = Object.values(data().paths).find((p) => p.fromId === grotto.id)!;
    const first = hexMapForWay(db, path.id)!;
    expect(first.hexes.length).toBeGreaterThan(1);
    // Beide Orte liegen unter der Erde – das Gelände dazwischen auch.
    expect(first.biome).toBe('underdark');
    expect(data().paths[path.id]!.areaId).toBe(first.id);
    expect(hexMapForWay(db, path.id)!.id).toBe(first.id);
    expect(goal.id).toBeTruthy();
  });

  it('reist einen Weg mit Hexkarte Feld für Feld, hält an Vorbereitetem und zieht die Karte mit', async () => {
    const { db, data, grotto, goal } = await setup();
    db.setState({ placeId: grotto.id });
    const path = Object.values(data().paths).find((p) => p.fromId === grotto.id)!;
    const area = hexMapForWay(db, path.id)!;
    const plan = withHexes(data(), planJourney(data(), grotto.id, goal.id)!);
    const leg = plan.legs[0]!;
    expect(leg.areaId).toBe(area.id);
    expect(leg.hexes.length).toBeGreaterThan(2);
    // Auf einem Feld in der Mitte wartet etwas Vorbereitetes.
    const middle = leg.hexes[Math.floor(leg.hexes.length / 2)]!;
    db.patch('areas', area.id, {
      hexes: data().areas[area.id]!.hexes.map((hex) =>
        hex.q === middle.q && hex.r === middle.r
          ? { ...hex, prepared: 'Ein eingestürzter Gang' }
          : hex,
      ),
    });
    startJourney(db, { toId: goal.id, plan });
    let result = travelOn(db, dice())!;
    while (result.halt.kind !== 'prepared' && journeyUnderway(data()))
      result = travelOn(db, dice())!;
    expect(result.halt).toMatchObject({ kind: 'prepared', text: 'Ein eingestürzter Gang' });
    expect(data().areas[area.id]!.party).toMatchObject({ q: middle.q, r: middle.r });
    const passed = data().areas[area.id]!.hexes.filter((hex) => hex.discovered).length;
    expect(passed).toBeGreaterThan(0);
  });
});
