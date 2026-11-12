import { describe, expect, it } from 'vitest';
import {
  groundAt,
  groundShares,
  kmOf,
  lineDistance,
  markerNear,
  simplify,
  walkAlong,
} from '../mapDraw';
import { MapSchema, type GameMap, type MapGround } from '../schema';

/**
 * Eine erfundene Karte: das Umland von Hohenfurt, 1000 × 700 Einheiten, 100 km breit (eine
 * Einheit = 100 m). Quer durch die Mitte zieht sich ein Wald, im Osten liegt ein See.
 */
function land(strokes: { ground: MapGround; width: number; points: [number, number][] }[] = []) {
  return MapSchema.parse({
    id: 'umland',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    name: 'Das Umland von Hohenfurt',
    kind: 'drawn',
    frame: { width: 1000, height: 700 },
    scale: { kmPerUnit: 0.1 },
    strokes: strokes.map((stroke, index) => ({ id: `s${index}`, ...stroke })),
  }) satisfies GameMap;
}

const forest = {
  ground: 'forest' as const,
  width: 100,
  points: [
    [400, 0],
    [400, 700],
  ] as [number, number][],
};
const lake = { ground: 'water' as const, width: 80, points: [[800, 350]] as [number, number][] };

describe('Gelände einer gezeichneten Karte', () => {
  it('ist der Grund der Karte, wo nichts gemalt ist', () => {
    expect(groundAt(land(), 500, 300)).toBe('plain');
    expect(groundAt({ ...land(), ground: 'water' }, 500, 300)).toBe('water');
  });

  it('ist der Pinselstrich, unter dem die Stelle liegt – bis zu seiner halben Breite', () => {
    const map = land([forest]);
    expect(groundAt(map, 400, 300)).toBe('forest');
    expect(groundAt(map, 449, 300)).toBe('forest');
    expect(groundAt(map, 451, 300)).toBe('plain');
  });

  it('ein einzelner Tupfer ist ein Kreis', () => {
    const map = land([lake]);
    expect(groundAt(map, 830, 370)).toBe('water');
    expect(groundAt(map, 830, 380)).toBe('plain');
  });

  it('der spätere Strich liegt oben', () => {
    const clearing = {
      ground: 'plain' as const,
      width: 40,
      points: [[400, 300]] as [number, number][],
    };
    const map = land([forest, clearing]);
    expect(groundAt(map, 400, 300)).toBe('plain');
    expect(groundAt(map, 400, 400)).toBe('forest');
    expect(groundAt(land([clearing, forest]), 400, 300)).toBe('forest');
  });

  it('zählt grob, wie viel der Karte welches Gelände bedeckt', () => {
    const shares = groundShares(land([forest]));
    expect(shares.forest).toBeCloseTo(0.1, 1);
    expect((shares.forest ?? 0) + (shares.plain ?? 0)).toBeCloseTo(1, 5);
  });
});

describe('Strecken auf der Karte', () => {
  const across: [number, number][] = [
    [0, 300],
    [1000, 300],
  ];

  it('misst nach dem Maßstab', () => {
    expect(kmOf(land(), across)).toBeCloseTo(100, 5);
    expect(kmOf({ scale: null }, across)).toBeNull();
    expect(lineDistance(across, 500, 320)).toBe(20);
  });

  it('über die Ebene: drei Meilen die Stunde', () => {
    const walk = walkAlong(
      land(),
      [
        [0, 300],
        [480, 300],
      ],
      false,
    )!;
    expect(walk.km).toBeCloseTo(48, 5);
    expect(walk.minutes).toBe(600);
    expect(walk.difficult).toBe(0);
    expect(walk.wet).toBe(false);
  });

  it('ein Pfad durch den Wald braucht dort doppelt so lange, eine Straße nicht', () => {
    const map = land([forest]);
    const path = walkAlong(map, across, false)!;
    const road = walkAlong(map, across, true)!;
    // 100 km, davon 10 km Wald: 90 km + 10 km doppelt = 110 km Aufwand.
    expect(road.minutes).toBe(1250);
    // Abgetastet wird in kleinen Stücken – auf zehn Minuten genau.
    expect(Math.abs(path.minutes - 1375)).toBeLessThanOrEqual(10);
    expect(path.difficult).toBeCloseTo(0.1, 2);
    expect(road.difficult).toBe(0);
  });

  it('merkt, wenn ein Pfad durchs Wasser führt – eine Straße gilt als Brücke', () => {
    const map = land([{ ...lake, points: [[800, 300]] }]);
    expect(walkAlong(map, across, false)!.wet).toBe(true);
    expect(walkAlong(map, across, true)!.wet).toBe(false);
    expect(walkAlong(land(), across, false)!.wet).toBe(false);
  });

  it('weiß ohne Maßstab keine Dauer', () => {
    expect(walkAlong({ ...land(), scale: null }, across, false)).toBeNull();
    expect(walkAlong(land(), [[0, 0]], false)).toBeNull();
  });
});

describe('Zeichnen', () => {
  it('glättet eine gezogene Linie, ohne Ecken zu verlieren', () => {
    const wobbly: [number, number][] = [
      [0, 0],
      [10, 0.4],
      [20, -0.3],
      [30, 0.2],
      [40, 0],
      [40, 30],
    ];
    expect(simplify(wobbly, 1)).toEqual([
      [0, 0],
      [40, 0],
      [40, 30],
    ]);
    expect(simplify([[3, 4]], 1)).toEqual([[3, 4]]);
  });

  it('findet den nächsten Kartenpunkt in Reichweite', () => {
    const marker = (id: string, x: number, y: number) => ({
      id,
      x,
      y,
      entityId: null,
      lkFeatureId: null,
      label: '',
      articleId: null,
    });
    const markers = [marker('a', 100, 100), marker('b', 110, 100)];
    expect(markerNear(markers, 108, 100, 16)?.id).toBe('b');
    expect(markerNear(markers, 200, 100, 16)).toBeNull();
  });
});
