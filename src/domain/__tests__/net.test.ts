import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { saveWay } from '../../features/wege/actions';
import {
  addNet,
  addNextPoint,
  addPoint,
  addRoutes,
  connectPoints,
  movePoint,
  removeNet,
  removePoint,
} from '../../features/wegenetz/actions';
import {
  NET_ROW,
  NET_STEP,
  freeSpot,
  hangingAt,
  netView,
  netsOfPlace,
  parseDurationText,
  parseRoutes,
  planRoutes,
} from '../net';
import { createEncounter, createEntity, createStock, createStory, type Place } from '../schema';
import { routeBetween, wayNotes, waysFrom } from '../ways';

const DAY = 24 * 60;

/** Eine erfundene Strecke in die Tiefe: von der Tiefen Pforte über die Salzgrotte zum Schwarzen See. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const data = () => db.getSnapshot();
  const net = addNet(db, 'Der Weg zum Schwarzen See');
  const live = () => data().nets[net.id]!;
  const place = (name: string) =>
    Object.values(data().entities).find((e): e is Place => e.kind === 'place' && e.name === name)!;
  const names = (ids: string[]) => ids.map((id) => data().entities[id]!.name);
  return { db, data, net, live, place, names };
}

describe('Eine Strecke als Text', () => {
  it('liest Dauern, wie man sie schreibt', () => {
    expect(parseDurationText('2 Tage')).toBe(2 * DAY);
    expect(parseDurationText('4 Std.')).toBe(240);
    expect(parseDurationText('1 Tag 6 Std')).toBe(DAY + 360);
    expect(parseDurationText('1,5 Stunden')).toBe(90);
    expect(parseDurationText('30 Min.')).toBe(30);
    expect(parseDurationText('1 Woche')).toBe(7 * DAY);
    expect(parseDurationText('90')).toBe(90);
    expect(parseDurationText('bei Ebbe')).toBeNull();
    expect(parseDurationText('2 Tage bei Ebbe')).toBeNull();
    expect(parseDurationText('')).toBeNull();
  });

  it('liest Ketten von Punkten mit Pfeilen – die Dauer steht in Klammern hinter dem Ziel', () => {
    expect(
      parseRoutes(
        'Tiefe Pforte -> Salzgrotte (4 Std.) → Schwarzer See (2 Tage)\n\n  Salzgrotte -> Krummzahns Bau (im Fels)  ',
      ),
    ).toEqual([
      [
        { name: 'Tiefe Pforte', minutes: null },
        { name: 'Salzgrotte', minutes: 240 },
        { name: 'Schwarzer See', minutes: 2 * DAY },
      ],
      [
        { name: 'Salzgrotte', minutes: null },
        // Klammern, die keine Dauer sind, gehören zum Namen.
        { name: 'Krummzahns Bau (im Fels)', minutes: null },
      ],
    ]);
    expect(parseRoutes('  \n')).toEqual([]);
  });

  it('legt Orte, Punkte und Wege an – was es gibt, wird genommen', async () => {
    const { db, data, net, live, place, names } = await setup();
    // Die Salzgrotte steht schon in der Welt, mit einem zweiten Namen.
    const grotto = db.put(
      'entities',
      createEntity({ kind: 'place', name: 'Salzgrotte', aliases: ['Die Grotte'] }),
    );
    const plan = planRoutes(data(), live(), 'Tiefe Pforte -> die grotte -> Schwarzer See');
    expect(plan[0]!.map((step) => step.place?.name ?? null)).toEqual([null, 'Salzgrotte', null]);

    const added = addRoutes(
      db,
      net.id,
      'Tiefe Pforte -> Salzgrotte (4 Std.) -> Schwarzer See (2 Tage)\nSalzgrotte -> Krummzahns Bau',
    );
    expect(added).toMatchObject({ places: 3, points: 4, ways: 3 });
    expect(names(live().points.map((point) => point.placeId))).toEqual([
      'Tiefe Pforte',
      'Salzgrotte',
      'Schwarzer See',
      'Krummzahns Bau',
    ]);
    // Die Kette liegt in einer Zeile, die Abzweigung rückt eine Zeile tiefer.
    expect(live().points.map((point) => [point.x, point.y])).toEqual([
      [0, 0],
      [NET_STEP, 0],
      [2 * NET_STEP, 0],
      [2 * NET_STEP, NET_ROW],
    ]);
    const gate = place('Tiefe Pforte');
    const lake = place('Schwarzer See');
    expect(routeBetween(data(), gate.id, lake.id)).toMatchObject({ minutes: 240 + 2 * DAY });
    // Die Wege sind Gänge, Pfade oder Gassen – so, wie es für das Netz eingestellt ist.
    expect(waysFrom(data(), gate.id)[0]!.path).toMatchObject({ road: 'trail', minutes: 240 });
    expect(waysFrom(data(), grotto.id).map((way) => way.minutes)).toEqual([240, 2 * DAY, null]);

    // Noch einmal dasselbe: Es entsteht nichts doppelt.
    expect(addRoutes(db, net.id, 'Tiefe Pforte -> Salzgrotte -> Schwarzer See')).toMatchObject({
      places: 0,
      points: 0,
      ways: 0,
    });
    // Eine Dauer, die später dabeisteht, füllt eine offene.
    addRoutes(db, net.id, 'Salzgrotte -> Krummzahns Bau (30 Min.)');
    expect(waysFrom(data(), place('Krummzahns Bau').id)[0]!.minutes).toBe(30);
    addRoutes(db, net.id, 'Salzgrotte -> Krummzahns Bau (3 Std.)');
    expect(waysFrom(data(), place('Krummzahns Bau').id)[0]!.minutes).toBe(30);

    added.undo();
    expect(live().points).toEqual([]);
    expect(Object.values(data().entities).some((e) => e.name === 'Tiefe Pforte')).toBe(false);
    expect(data().entities[grotto.id]).toBeDefined();
  });
});

describe('Das Netz', () => {
  it('zeigt Punkte und Wege – und wo die Gruppe steht', async () => {
    const { db, data, net, live, place } = await setup();
    addRoutes(db, net.id, 'Tiefe Pforte -> Salzgrotte (4 Std.) -> Schwarzer See (2 Tage)');
    const [gate, grotto, lake] = [
      place('Tiefe Pforte'),
      place('Salzgrotte'),
      place('Schwarzer See'),
    ];
    const hut = db.put(
      'entities',
      createEntity({ kind: 'place', name: 'Hütte des Fährmanns', place: { parentId: grotto.id } }),
    );
    db.setState({ placeId: hut.id });
    let view = netView(data(), live());
    expect(view.points.map((point) => [point.place.name, point.here])).toEqual([
      ['Tiefe Pforte', false],
      ['Salzgrotte', true],
      ['Schwarzer See', false],
    ]);
    expect(
      view.links.map((link) => [link.from.place.name, link.to.place.name, link.minutes]),
    ).toEqual(
      expect.arrayContaining([
        ['Tiefe Pforte', 'Salzgrotte', 240],
        ['Salzgrotte', 'Schwarzer See', 2 * DAY],
      ]),
    );
    expect(view.links).toHaveLength(2);
    expect(netsOfPlace(data(), hut.id).map((n) => n.id)).toEqual([net.id]);
    expect(netsOfPlace(data(), null)).toEqual([]);

    // Ein Weg zu einem Ort außerhalb des Netzes gehört nicht dazu, bis der Ort ein Punkt ist.
    const far = db.put('entities', createEntity({ kind: 'place', name: 'Graufels' }));
    saveWay(db, { fromId: lake.id, toId: far.id, minutes: 60 });
    expect(netView(data(), live()).links).toHaveLength(2);
    addPoint(db, net.id, far.id, null, lake.id);
    view = netView(data(), live());
    expect(view.links).toHaveLength(3);
    expect(live().points[3]).toMatchObject({ x: 3 * NET_STEP, y: 0 });

    // Ein gelöschter Ort verschwindet aus dem Bild, ohne dass das Netz kaputtgeht.
    db.remove('entities', gate.id);
    expect(netView(data(), live()).points.map((point) => point.place.name)).not.toContain(
      'Tiefe Pforte',
    );
  });

  it('weiß, was an einem Punkt hängt und was unterwegs wartet', async () => {
    const { db, data, net, live, place } = await setup();
    addRoutes(db, net.id, 'Tiefe Pforte -> Salzgrotte (4 Std.)');
    const [gate, grotto] = [place('Tiefe Pforte'), place('Salzgrotte')];
    db.put('stories', createStory({ title: 'Die Aalfischer graben', refs: [grotto.id] }));
    db.put('stocks', createStock({ name: 'Nest der Grubenschleicher', placeId: grotto.id }));
    const ambush = db.put('encounters', createEncounter({ name: 'Hinterhalt im Gang' }));
    const hanging = hangingAt(data(), grotto.id);
    expect(hanging.stories).toHaveLength(1);
    expect(hanging.stocks).toHaveLength(1);
    const way = waysFrom(data(), gate.id)[0]!;
    db.patch('paths', way.path.id, {
      onTheWay: 'Der Gang ist halb eingestürzt.',
      encounterId: ambush.id,
    });
    const view = netView(data(), live());
    expect(view.points.map((point) => [point.hanging, point.prepared])).toEqual([
      [0, false],
      [2, true],
    ]);
    expect(view.links[0]!.eventful).toBe(true);
    expect(wayNotes(data(), waysFrom(data(), gate.id)[0]!)).toEqual([
      'Der Gang ist halb eingestürzt',
      'Begegnung „Hinterhalt im Gang“',
    ]);
  });

  it('setzt Punkte, verschiebt sie, verbindet sie und nimmt sie wieder heraus', async () => {
    const { db, data, net, live, place } = await setup();
    const gate = db.put('entities', createEntity({ kind: 'place', name: 'Tiefe Pforte' }));
    addPoint(db, net.id, gate.id, { x: 40.4, y: 80.6 });
    addPoint(db, net.id, gate.id);
    expect(live().points).toEqual([{ placeId: gate.id, x: 40, y: 81 }]);
    const next = addNextPoint(db, net.id, gate.id, ' Salzgrotte ', 90)!;
    expect(next.place.name).toBe('Salzgrotte');
    expect(next.path).toMatchObject({ fromId: gate.id, toId: next.place.id, minutes: 90 });
    expect(live().points[1]).toEqual({ placeId: next.place.id, x: 40 + NET_STEP, y: 81 });
    expect(addNextPoint(db, net.id, gate.id, '  ')).toBeNull();
    // Zwei Punkte, zwischen denen es schon einen Weg gibt: Es bleibt bei dem einen.
    expect(connectPoints(db, net.id, next.place.id, gate.id)!.id).toBe(next.path!.id);
    expect(Object.keys(data().paths)).toHaveLength(1);
    movePoint(db, net.id, gate.id, 10, 20);
    expect(live().points[0]).toMatchObject({ x: 10, y: 20 });
    const undo = removePoint(db, net.id, gate.id)!;
    expect(live().points).toHaveLength(1);
    // Der Ort und sein Weg bleiben in der Welt.
    expect(place('Tiefe Pforte').id).toBe(gate.id);
    expect(Object.keys(data().paths)).toHaveLength(1);
    undo();
    expect(live().points).toHaveLength(2);
    const back = removeNet(db, net.id)!;
    expect(data().nets[net.id]).toBeUndefined();
    back();
    expect(live().points).toHaveLength(2);
  });

  it('findet einen freien Platz auf dem Blatt', () => {
    expect(freeSpot([])).toEqual({ x: 0, y: 0 });
    const points = [
      { placeId: 'a', x: 0, y: 0 },
      { placeId: 'b', x: NET_STEP, y: 0 },
    ];
    // Rechts neben a liegt schon b: eine Zeile tiefer.
    expect(freeSpot(points, points[0])).toEqual({ x: NET_STEP, y: NET_ROW });
    expect(freeSpot(points, points[1])).toEqual({ x: 2 * NET_STEP, y: 0 });
    expect(freeSpot(points)).toEqual({ x: 0, y: NET_ROW });
  });
});
