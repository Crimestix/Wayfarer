import { describe, expect, it } from 'vitest';
import { groundAt } from '../../domain/mapDraw';
import { MapSchema, type GameMap, type MapGround, type MapStroke } from '../../domain/schema';
import { contour, outlinesOf, rasterAt, rasterize, shapesOf, smooth } from './shapes';

type Stroke = Pick<MapStroke, 'ground' | 'width' | 'points'> & Partial<Pick<MapStroke, 'cap'>>;

/** Eine erfundene Karte, 1000 × 700 Einheiten. */
function sheet(
  ground: MapGround,
  strokes: Stroke[] = [],
  more: Partial<Pick<GameMap, 'level' | 'lines'>> = {},
): GameMap {
  return MapSchema.parse({
    id: 'aalinsel',
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    name: 'Die Aalinsel',
    kind: 'drawn',
    ground,
    frame: { width: 1000, height: 700 },
    scale: { kmPerUnit: 0.05 },
    strokes: strokes.map((stroke, index) => ({ id: `s${index}`, ...stroke })),
    ...more,
  });
}

/** Fläche einer geschlossenen Linie. */
function area(points: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [a, b] = [points[i]!, points[(i + 1) % points.length]!];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

const room: Stroke = {
  ground: 'cave',
  width: 100,
  cap: 'butt',
  points: [
    [700, 300],
    [800, 300],
  ],
};
const island: Stroke = { ground: 'plain', width: 110, points: [[500, 350]] };

describe('Raster', () => {
  it('ist der Grund der Karte, wo nichts gemalt ist', () => {
    const raster = rasterize(sheet('water'));
    expect(rasterAt(raster, 500, 350)).toBe('water');
    expect([raster.cols, raster.rows]).toEqual([401, 281]);
  });

  it('hält Rechtecke gerade', () => {
    const map = sheet('rock', [room], { level: 'underground' });
    const raster = rasterize(map);
    for (const [x, y] of [
      [700, 250],
      [800, 350],
      [750, 300],
      [697.5, 300],
      [750, 352.5],
    ] as const)
      expect(rasterAt(raster, x, y)).toBe(groundAt(map, x, y));
  });

  it('bewegt den Rand gemalter Striche – innen und weit draußen bleibt alles, wie gemalt', () => {
    const map = sheet('water', [island]);
    const raster = rasterize(map);
    expect(rasterAt(raster, 500, 350)).toBe('plain');
    expect(rasterAt(raster, 525, 350)).toBe('plain');
    expect(rasterAt(raster, 580, 350)).toBe('water');
    // Am Rand weicht das Bild vom strengen Kreis ab – sonst sähe es aus wie mit dem Zirkel gezogen.
    let differs = 0;
    for (let step = 0; step < 72; step++) {
      const angle = (step / 72) * Math.PI * 2;
      for (const reach of [52, 58]) {
        const [x, y] = [500 + Math.cos(angle) * reach, 350 + Math.sin(angle) * reach];
        if (rasterAt(raster, x, y) !== groundAt(map, x, y)) differs++;
      }
    }
    expect(differs).toBeGreaterThan(6);
  });

  it('gräbt Gänge durch den Fels – nur unter der Erde', () => {
    const lines = [
      {
        id: 'gang',
        kind: 'road' as const,
        name: '',
        pathId: null,
        points: [
          [200, 300],
          [700, 300],
        ] as [number, number][],
      },
    ];
    const below = rasterize(sheet('rock', [room], { level: 'underground', lines }));
    expect(rasterAt(below, 450, 300)).toBe('cave');
    expect(rasterAt(below, 450, 312.5)).toBe('rock');
    expect(rasterAt(rasterize(sheet('rock', [room], { lines })), 450, 300)).toBe('rock');
  });
});

describe('Umrisse', () => {
  it('liest aus einem Feld geschlossene Linien', () => {
    const field = new Float32Array(25);
    field[12] = 1;
    const lines = contour(field, 5, 5, 0.5);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(4);
    expect(smooth(lines[0]!, 1)).toHaveLength(8);
  });

  it('ein Raum bleibt ein Rechteck seiner Größe', () => {
    const raster = rasterize(sheet('rock', [room], { level: 'underground' }));
    const caves = outlinesOf(raster, 'cave');
    expect(caves).toHaveLength(1);
    const box = caves[0]!.box;
    for (const [value, target] of [
      [box[0], 700],
      [box[1], 250],
      [box[2], 800],
      [box[3], 350],
    ] as const)
      expect(Math.abs(value - target)).toBeLessThan(3);
    expect(area(caves[0]!.points) / 10000).toBeGreaterThan(0.93);
    expect(area(caves[0]!.points) / 10000).toBeLessThan(1.1);
  });

  it('eine Insel hat eine Küste – und das Meer reicht über den Kartenrand hinaus', () => {
    const shapes = shapesOf(sheet('water', [island]));
    const land = shapes.areas.plain!;
    expect(land).toHaveLength(1);
    const circle = Math.PI * 55 * 55;
    expect(area(land[0]!.points) / circle).toBeGreaterThan(0.7);
    expect(area(land[0]!.points) / circle).toBeLessThan(1.4);
    // Das Wasser: die Küste als Loch und ein Umriss weit außerhalb des Blattes.
    const sea = shapes.areas.water!;
    expect(sea).toHaveLength(2);
    const outer = sea.find((outline) => outline.box[0] < 0)!;
    expect(outer.box).toEqual([-90, -90, 1090, 790]);
    // Auf dem Blatt selbst liegt kein Stück dieses Umrisses.
    expect(outer.points.every(([x, y]) => x < 0 || y < 0 || x > 1000 || y > 700)).toBe(true);
  });

  it('rechnet dieselbe Karte immer gleich', () => {
    const map = sheet('water', [island, { ground: 'forest', width: 52, points: [[490, 340]] }]);
    expect(shapesOf(map)).toEqual(shapesOf(map));
    // Eine andere Karte bekommt eine andere Küste.
    const other = shapesOf({ ...map, id: 'westmark' });
    expect(other.areas.plain![0]!.points).not.toEqual(shapesOf(map).areas.plain![0]!.points);
  });
});

describe('Zeichen', () => {
  it('stehen nur in ihrem Gelände, von hinten nach vorn geordnet', () => {
    const forest: Stroke = {
      ground: 'forest',
      width: 110,
      points: [
        [300, 200],
        [600, 200],
      ],
    };
    const map = sheet('plain', [forest]);
    const { sites } = shapesOf(map);
    expect(sites.length).toBeGreaterThan(100);
    expect(sites.every((site) => site.symbol === 'tree' && site.spread === 14)).toBe(true);
    expect(
      sites.every((site) => site.y > 120 && site.y < 280 && site.x > 220 && site.x < 680),
    ).toBe(true);
    expect(sites.every((site, i) => i === 0 || sites[i - 1]!.y <= site.y)).toBe(true);
    expect(shapesOf(sheet('plain')).sites).toEqual([]);
  });

  it('Pilze im Pilzwald, Steine im Geröll', () => {
    const { sites } = shapesOf(
      sheet(
        'rock',
        [
          { ground: 'fungus', width: 110, points: [[300, 300]] },
          { ground: 'rubble', width: 110, points: [[700, 300]] },
        ],
        { level: 'underground' },
      ),
    );
    const kinds = new Set(sites.map((site) => site.symbol));
    expect([...kinds].sort()).toEqual(['mushroom', 'stone']);
    expect(sites.filter((site) => site.symbol === 'mushroom').every((site) => site.x < 500)).toBe(
      true,
    );
  });
});
