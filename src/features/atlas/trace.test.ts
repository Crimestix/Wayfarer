import { describe, expect, it } from 'vitest';
import { distanceKm, inRing, ringBounds } from '../../domain/geo';
import {
  blurPixels,
  cleanMask,
  cropMask,
  dropAreas,
  dominantColor,
  landMask,
  placeShape,
  traceImage,
  traceMask,
  type Placement,
  type Rgb,
} from './trace';

const SEA: Rgb = [10, 40, 90];
const LAND: Rgb = [200, 190, 170];
const ICE: Rgb = [235, 240, 245];
const SHALLOWS: Rgb = [40, 130, 150];
/** Ein erfundener Planet: 6.000 km Halbmesser. */
const RADIUS = 6000;
const GRID: Placement = {
  kind: 'grid',
  lon: 0,
  lat: 0,
  widthDeg: 40,
  heightDeg: 40,
  widthKm: 0,
  turnDeg: 0,
};
const LOCAL: Placement = { ...GRID, kind: 'local', widthKm: 2000 };

/** Malt ein Bild aus Zeichen: „.“ Meer, „#“ Land, „*“ Eis. */
function picture(rows: string[]) {
  const height = rows.length;
  const width = rows[0]!.length;
  const pixels = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) =>
    [...row].forEach((char, x) => {
      const [r, g, b] = char === '#' ? LAND : char === '*' ? ICE : SEA;
      pixels.set([r, g, b, 255], (y * width + x) * 4);
    }),
  );
  return { pixels, width, height };
}

const show = (mask: Uint8Array, width: number) =>
  Array.from({ length: mask.length / width }, (_, y) =>
    [...mask.slice(y * width, (y + 1) * width)].map((v) => (v ? '#' : '.')).join(''),
  );

describe('Küsten aus einem Bild', () => {
  const map = picture(['********', '........', '.####...', '.#..#.#.', '.####...', '........']);

  it('erkennt das Meer als häufigste Farbe', () => {
    expect(dominantColor(map.pixels)).toEqual(SEA);
  });

  it('trennt Land und Wasser nach der Ähnlichkeit zu einer Farbe', () => {
    // Wasser gewählt: alles andere ist Land – auch das Eis.
    const byWater = landMask(map.pixels, map.width, map.height, {
      mode: 'water',
      colors: [SEA],
      tolerance: 40,
    });
    expect(show(byWater, map.width)[0]).toBe('########');
    // Land gewählt: Nur was ihm ähnelt, ist Land – das Eis nicht.
    const byLand = landMask(map.pixels, map.width, map.height, {
      mode: 'land',
      colors: [LAND],
      tolerance: 40,
    });
    expect(show(byLand, map.width)).toEqual([
      '........',
      '........',
      '.####...',
      '.#..#.#.',
      '.####...',
      '........',
    ]);
  });

  it('nimmt kleine Flecken heraus – im Wasser wie im Land', () => {
    const mask = landMask(map.pixels, map.width, map.height, {
      mode: 'land',
      colors: [LAND],
      tolerance: 40,
    });
    // Die einzelne Insel fällt weg, der kleine See im Land wird zugeschüttet.
    expect(show(cleanMask(mask, map.width, map.height, 3), map.width)).toEqual([
      '........',
      '........',
      '.####...',
      '.####...',
      '.####...',
      '........',
    ]);
    // Ohne Mindestgröße bleibt alles.
    expect(show(cleanMask(mask, map.width, map.height, 1), map.width)).toEqual(
      show(mask, map.width),
    );
  });

  it('zieht Küsten um das Land und Ufer um die Seen', () => {
    const traced = traceImage(map.pixels, map.width, map.height, {
      mode: 'land',
      colors: [LAND],
      tolerance: 40,
      minArea: 1,
    });
    // Zwei Landflächen (der Ring und die Insel), ein See.
    expect(traced.rings).toHaveLength(2);
    expect(traced.holes).toHaveLength(1);
    // Der See: die zwei Bildpunkte in der Mitte des Rings.
    const lake = traced.holes[0]!;
    const xs = lake.filter((_, i) => i % 2 === 0);
    const ys = lake.filter((_, i) => i % 2 === 1);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([
      2, 4, 3, 4,
    ]);
  });

  it('zeichnet weich: Einzelne helle Punkte im Meer verschwinden, große Flächen bleiben', () => {
    // Ein Meer mit Glanzlichtern und eine große Insel.
    const rows = Array.from({ length: 24 }, (_, y) =>
      Array.from({ length: 24 }, (_, x) =>
        x >= 12 && x < 22 && y >= 6 && y < 18 ? '#' : (x * 7 + y * 5) % 11 === 0 ? '#' : '.',
      ).join(''),
    );
    const img = picture(rows);
    const options = { mode: 'water', colors: [SEA], tolerance: 90, minArea: 1 } as const;
    const raw = traceImage(img.pixels, img.width, img.height, options);
    expect(raw.rings.length).toBeGreaterThan(10);
    const soft = traceImage(img.pixels, img.width, img.height, { ...options, smooth: 2 });
    expect(soft.rings).toHaveLength(1);
    // Ohne Radius bleibt das Bild dasselbe.
    expect(blurPixels(img.pixels, img.width, img.height, 0)).toBe(img.pixels);
  });

  it('nimmt mehrere Farben: tiefes und flaches Wasser sind beide Meer', () => {
    // „~“ ist flaches Wasser rund um die Insel.
    const height = 9;
    const width = 9;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const ring = Math.max(Math.abs(x - 4), Math.abs(y - 4));
        const [r, g, b] = ring <= 1 ? LAND : ring === 2 ? SHALLOWS : SEA;
        pixels.set([r, g, b, 255], (y * width + x) * 4);
      }
    const one = landMask(pixels, width, height, { mode: 'water', colors: [SEA], tolerance: 40 });
    const two = landMask(pixels, width, height, {
      mode: 'water',
      colors: [SEA, SHALLOWS],
      tolerance: 40,
    });
    // Mit einer Farbe zählt das flache Wasser zum Land, mit beiden nur die Insel.
    expect(one.reduce((sum, v) => sum + v, 0)).toBe(25);
    expect(two.reduce((sum, v) => sum + v, 0)).toBe(9);
    // Ohne Farbe ist nichts ähnlich: alles Land, wenn das Wasser gesucht wird.
    const none = landMask(pixels, width, height, { mode: 'water', colors: [], tolerance: 40 });
    expect(none.reduce((sum, v) => sum + v, 0)).toBe(81);
  });

  it('schneidet Ränder ab: Was dort liegt, wird Meer, das Bild behält seine Größe', () => {
    // Oben eine Insel, unten ein Streifen Eis über die ganze Breite.
    const img = picture(['..........', '..####....', '..####....', '..........', '**********']);
    const options = { mode: 'water', colors: [SEA], tolerance: 40, minArea: 1 } as const;
    expect(traceImage(img.pixels, img.width, img.height, options).rings).toHaveLength(2);
    const cut = traceImage(img.pixels, img.width, img.height, {
      ...options,
      crop: { top: 0, right: 0, bottom: 0.2, left: 0 },
    });
    expect(cut.rings).toHaveLength(1);
    expect([cut.width, cut.height]).toEqual([10, 5]);
    // Ohne Ränder bleibt die Maske dieselbe.
    const mask = Uint8Array.from([1, 0, 1, 1]);
    expect(cropMask(mask, 2, 2, undefined)).toBe(mask);
    expect(cropMask(mask, 2, 2, { top: 0, right: 0, bottom: 0, left: 0 })).toBe(mask);
    expect([...cropMask(mask, 2, 2, { top: 0, right: 0.5, bottom: 0, left: 0 })]).toEqual([
      1, 0, 1, 0,
    ]);
  });

  it('nimmt ganze Flächen weg, auf die gezeigt wird', () => {
    // Zwei Inseln; die rechte gehört nicht dazu.
    const img = picture(['..........', '.###..##..', '.###..##..', '..........']);
    const options = { mode: 'water', colors: [SEA], tolerance: 40, minArea: 1 } as const;
    expect(traceImage(img.pixels, img.width, img.height, options).rings).toHaveLength(2);
    const one = traceImage(img.pixels, img.width, img.height, { ...options, drop: [[7, 2]] });
    expect(one.rings).toHaveLength(1);
    expect(Math.max(...one.rings[0]!.filter((_, i) => i % 2 === 0))).toBe(4);
    // Ein Klick ins Wasser oder neben das Bild ändert nichts.
    const mask = Uint8Array.from([1, 0, 0, 1]);
    expect(dropAreas(mask, 2, 2, [[1, 0]])).toEqual(mask);
    expect(dropAreas(mask, 2, 2, [[5, 5]])).toEqual(mask);
    expect(dropAreas(mask, 2, 2, undefined)).toBe(mask);
    expect([...dropAreas(mask, 2, 2, [[0, 0]])]).toEqual([0, 0, 0, 1]);
  });

  it('hält Flächen auseinander, die sich nur über Eck berühren', () => {
    const mask = Uint8Array.from([1, 0, 0, 1]);
    const traced = traceMask(mask, 2, 2);
    expect(traced.rings).toHaveLength(2);
    expect(traced.rings.map((ring) => ring.length / 2)).toEqual([4, 4]);
  });

  it('legt die Küsten auf den Planeten und glättet die Treppenstufen', () => {
    // Ein Dreieck aus Bildpunkten: Die Schräge ist im Bild eine Treppe.
    const rows = Array.from({ length: 20 }, (_, y) => '#'.repeat(y + 1).padEnd(20, '.'));
    const img = picture(rows);
    const traced = traceImage(img.pixels, img.width, img.height, {
      mode: 'land',
      colors: [LAND],
      tolerance: 40,
      minArea: 1,
    });
    // Das Bild überdeckt 40° × 40° um die Lage 100° Ost, 10° Nord.
    const placed = placeShape(traced, { ...GRID, lon: 100, lat: 10 }, RADIUS);
    expect(placed.rings).toHaveLength(1);
    // Aus 40 Treppenstufen werden wenige Punkte.
    expect(placed.rings[0]!.length / 2).toBeLessThan(8);
    // Die linke untere Ecke des Bildes liegt bei 80° Ost, 10° Süd – dort ist Land.
    expect(inRing(placed.rings[0]!, { lon: 81, lat: -9 })).toBe(true);
    expect(inRing(placed.rings[0]!, { lon: 119, lat: 29 })).toBe(false);
    // Über die Datumsgrenze gelegt, bleibt die Form ganz.
    const far = placeShape(traced, { ...GRID, lon: 175 }, RADIUS);
    expect(inRing(far.rings[0]!, { lon: 156, lat: -19 })).toBe(true);
    expect(inRing(far.rings[0]!, { lon: -170, lat: -19.5 })).toBe(true);
    expect(inRing(far.rings[0]!, { lon: -170, lat: 15 })).toBe(false);
  });
  it('legt ein Gebiet nach Kilometern auf die Kugel – in der Form treu, wo immer es liegt', () => {
    // Ein Bild von 100 × 100 Punkten, in der Mitte ein Land von 40 × 40.
    const rows = Array.from({ length: 100 }, (_, y) =>
      Array.from({ length: 100 }, (_, x) =>
        x >= 30 && x < 70 && y >= 30 && y < 70 ? '#' : '.',
      ).join(''),
    );
    const img = picture(rows);
    const traced = traceImage(img.pixels, img.width, img.height, {
      mode: 'land',
      colors: [LAND],
      tolerance: 40,
      minArea: 1,
    });
    // 2.000 km breit: Das Land misst 800 km, seine Ecken liegen 566 km von der Mitte.
    for (const center of [
      { lon: 20, lat: 0 },
      { lon: -150, lat: 62 },
      { lon: 170, lat: -80 },
    ]) {
      const placed = placeShape(traced, { ...LOCAL, ...center }, RADIUS);
      expect(placed.rings).toHaveLength(1);
      const ring = placed.rings[0]!;
      let farthest = 0;
      let nearest = Infinity;
      for (let i = 0; i < ring.length; i += 2) {
        const km = distanceKm(RADIUS, center, { lon: ring[i]!, lat: ring[i + 1]! });
        farthest = Math.max(farthest, km);
        nearest = Math.min(nearest, km);
      }
      expect(farthest).toBeGreaterThan(555);
      expect(farthest).toBeLessThan(570);
      expect(nearest).toBeGreaterThan(395);
      expect(inRing(ring, center)).toBe(true);
    }
    // Oben im Bild ist Norden – gedreht um 90° zeigt oben nach Osten.
    const top = picture(
      Array.from({ length: 100 }, (_, y) =>
        Array.from({ length: 100 }, (_, x) => (x >= 45 && x < 55 && y < 20 ? '#' : '.')).join(''),
      ),
    );
    const tracedTop = traceImage(top.pixels, top.width, top.height, {
      mode: 'land',
      colors: [LAND],
      tolerance: 40,
      minArea: 1,
    });
    const north = placeShape(tracedTop, LOCAL, RADIUS).rings[0]!;
    expect(inRing(north, { lon: 0, lat: 8 })).toBe(true);
    expect(inRing(north, { lon: 8, lat: 0 })).toBe(false);
    const east = placeShape(tracedTop, { ...LOCAL, turnDeg: 90 }, RADIUS).rings[0]!;
    expect(inRing(east, { lon: 8, lat: 0 })).toBe(true);
    expect(inRing(east, { lon: 0, lat: 8 })).toBe(false);
  });

  it('legt Land über einen Pol: Der Ring läuft dann um die Achse', () => {
    const rows = Array.from({ length: 60 }, (_, y) =>
      Array.from({ length: 60 }, (_, x) => (Math.hypot(x - 29.5, y - 29.5) < 20 ? '#' : '.')).join(
        '',
      ),
    );
    const img = picture(rows);
    const traced = traceImage(img.pixels, img.width, img.height, {
      mode: 'land',
      colors: [LAND],
      tolerance: 40,
      minArea: 1,
    });
    // 3.000 km breit, die Mitte auf dem Südpol: eine Eiskappe mit 1.000 km Halbmesser (9,5°).
    const cap = placeShape(traced, { ...LOCAL, lat: -90, widthKm: 3000 }, RADIUS).rings[0]!;
    expect(ringBounds(cap).polar).toBe('south');
    for (const lon of [-170, -60, 0, 45, 130]) {
      expect(inRing(cap, { lon, lat: -85 })).toBe(true);
      expect(inRing(cap, { lon, lat: -75 })).toBe(false);
    }
  });
});
