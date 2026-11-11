import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { demoCampaign } from '../../data/__fixtures__/demoWorld';
import { MemoryStore } from '../../data/store';
import { entitiesOfKind } from '../../domain/derive';
import { NODATA } from '../../domain/geo';
import { addLand, applyAtlas, isOwnLand, removeAtlas, setPlaceGeo } from './actions';
import { NOT_AN_ATLAS, NOT_A_HEIGHTMAP, convertAtlasWorld, convertHeights } from './import';
import {
  daylightAt,
  decodeHeights,
  describeTerrain,
  encodeHeights,
  formatGeo,
  formatHours,
  formatKm,
  legBetween,
  placeGeo,
  placedPlaces,
  planetOf,
  reliefOf,
  seasonFraction,
  terrainAt,
} from './model';

/** Eine erfundene Weltdatei in der Form des alten Atlas: ein Kontinent mit Binnensee, eine Insel. */
const world = () => {
  // Ein Rechteck mit vielen Zwischenpunkten – die fallen beim Vereinfachen weg.
  const coast: [number, number][] = [];
  for (let lon = 0; lon <= 40; lon += 0.5) coast.push([lon, 0]);
  for (let lat = 0.5; lat <= 30; lat += 0.5) coast.push([40, lat]);
  for (let lon = 39.5; lon >= 0; lon -= 0.5) coast.push([lon, 30]);
  for (let lat = 29.5; lat >= 0.5; lat -= 0.5) coast.push([0, lat]);
  return {
    name: 'Probewelt',
    planet: { name: 'Probe', radiusKm: 6000, dayHours: 20, yearDays: 300, obliquityDeg: 25 },
    epochs: [
      {
        id: 'frueher',
        features: [
          {
            id: 'ur',
            name: 'Urland',
            rings: [
              [
                [0, 0],
                [1, 0],
                [1, 1],
              ],
            ],
          },
        ],
      },
      {
        id: 'today',
        features: [
          {
            id: 'nordland',
            name: 'Nordland',
            rings: [
              coast,
              [
                [60, 10],
                [62, 10],
                [62, 12],
                [60, 12],
              ],
            ],
            holes: [
              [
                [10, 10],
                [14, 10],
                [14, 14],
                [10, 14],
              ],
            ],
          },
          { id: 'leer', name: 'Ohne Küste', rings: [] },
        ],
      },
    ],
    hydrography: {
      nordland: {
        lakes: [
          {
            id: 'see',
            name: 'Spiegelsee',
            shoreline: [
              [20, 20],
              [22, 20],
              [22, 22],
              [20, 22],
            ],
          },
          // Seen ohne Uferlinie (nur Mittelpunkt) werden übergangen.
          { id: 'ohne', center: [5, 5] },
        ],
        channels: [
          {
            id: 'fluss',
            name: 'Graubach',
            points: [
              [30, 5],
              [31, 6],
              [32, 8],
            ],
            halfWidthsKm: [1, 2, 3],
          },
        ],
      },
    },
  };
};

const planet = () => convertAtlasWorld(world(), 'world.json');

describe('Atlas übernehmen', () => {
  it('liest Planet, Küsten, Seen und Flüsse und vereinfacht die Küsten', () => {
    const { planet: doc, stats } = planet();
    expect(doc).toMatchObject({
      kind: 'planet',
      name: 'Probewelt',
      radiusKm: 6000,
      dayHours: 20,
      yearDays: 300,
      obliquityDeg: 25,
      source: 'world.json',
    });
    // Nur der heutige Stand der Welt; Landmassen ohne Küste fallen weg.
    expect(doc.lands.map((land) => land.name)).toEqual(['Nordland']);
    expect(doc.lands[0]!.rings[0]).toEqual([0, 0, 40, 0, 40, 30, 0, 30]);
    expect(doc.lands[0]!.rings).toHaveLength(2);
    expect(doc.lands[0]!.holes).toEqual([[10, 10, 14, 10, 14, 14, 10, 14]]);
    expect(doc.lakes).toEqual([
      { id: 'see', name: 'Spiegelsee', ring: [20, 20, 22, 20, 22, 22, 20, 22] },
    ]);
    expect(doc.rivers).toEqual([
      { id: 'fluss', name: 'Graubach', points: [30, 5, 31, 6, 32, 8], widthKm: 4 },
    ]);
    expect(stats).toMatchObject({ lands: 1, lakes: 1, rivers: 1 });
    expect(stats.pointsBefore).toBeGreaterThan(280);
    expect(stats.pointsAfter).toBe(12);
  });

  it('weist anderes mit einem klaren Satz ab', () => {
    expect(() => convertAtlasWorld({ irgendwas: 1 })).toThrow(NOT_AN_ATLAS);
    expect(() => convertAtlasWorld({ planet: {}, epochs: [{ features: [] }] })).toThrow(
      NOT_AN_ATLAS,
    );
    expect(() => convertHeights(new ArrayBuffer(10))).toThrow(NOT_A_HEIGHTMAP);
    expect(() => convertHeights(new Float32Array(9).buffer)).toThrow(NOT_A_HEIGHTMAP);
  });

  it('verkleinert die Höhenkarte und behält Lücken', () => {
    // 8 × 4 Zellen: Norden 100 m, Süden 300 m, ganz links ohne Angabe.
    const source = new Float32Array(32);
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 8; x++) source[y * 8 + x] = x < 2 ? NaN : y < 2 ? 100 : 300;
    const relief = convertHeights(source.buffer, 'height.f32', 4);
    expect(relief).toMatchObject({ kind: 'relief', width: 4, height: 2, source: 'height.f32' });
    expect([...decodeHeights(relief.heights, 8)]).toEqual([
      NODATA,
      100,
      100,
      100,
      NODATA,
      300,
      300,
      300,
    ]);
    // Hin und zurück bleibt jede Zahl, auch die negativen.
    const values = Int16Array.from([0, 1, -1, 32767, -32767, NODATA, 1234, -4321]);
    expect([...decodeHeights(encodeHeights(values), values.length)]).toEqual([...values]);
  });
});

describe('Der Planet im Spielstand', () => {
  async function setup() {
    const db = await CampaignDb.create(new MemoryStore(), demoCampaign());
    const source = new Float32Array(8 * 4).fill(250);
    applyAtlas(db, planet().planet, convertHeights(source.buffer, 'height.f32', 4));
    const places = entitiesOfKind(db.getSnapshot(), 'place');
    return { db, places };
  }

  it('sagt, was an einer Lage ist', async () => {
    const { db } = await setup();
    const data = db.getSnapshot();
    const p = planetOf(data)!;
    const grid = reliefOf(data);
    expect(p.radiusKm).toBe(6000);
    const here = terrainAt(p, grid, { lon: 5, lat: 5 });
    expect(here).toMatchObject({ land: { id: 'nordland', name: 'Nordland' }, water: null });
    expect(here.heightM).toBeCloseTo(250, 6);
    expect(describeTerrain(terrainAt(p, grid, { lon: 5, lat: 5 }))).toBe('Nordland · 250 m');
    // Das Loch in der Landmasse und der See mit eigener Uferlinie sind Wasser.
    expect(terrainAt(p, grid, { lon: 12, lat: 12 }).water).toBe('lake');
    expect(terrainAt(p, grid, { lon: 21, lat: 21 }).water).toBe('lake');
    expect(describeTerrain(terrainAt(p, grid, { lon: -100, lat: -40 }))).toBe('Meer');
    // Die Insel gehört zur selben Landmasse.
    expect(terrainAt(p, grid, { lon: 61, lat: 11 }).land?.id).toBe('nordland');
    expect(formatGeo({ lon: -12.34, lat: 5.06 })).toBe('5,1° N, 12,3° W');
    expect(formatKm(1240.4)).toBe('1.240 km');
    expect(formatKm(3.26)).toBe('3,3 km');
  });

  it('nimmt Landmassen aus Bildern dazu – auch über anderem Land – und behält sie', async () => {
    const { db } = await setup();
    const at = (lon: number, lat: number) =>
      terrainAt(planetOf(db.getSnapshot())!, reliefOf(db.getSnapshot()), { lon, lat });
    // Eine Insel im Loch der Landmasse und im Meer daneben.
    const undo = addLand(db, {
      name: ' Seeinsel ',
      rings: [[11, 11, 13, 11, 13, 13, 11, 13]],
      holes: [],
    });
    expect(at(12, 12).land?.name).toBe('Seeinsel');
    expect(isOwnLand(at(12, 12).land!)).toBe(true);
    // Wo schon Land war, bleibt dessen Name.
    expect(at(5, 5).land?.name).toBe('Nordland');
    // Die Weltdatei neu eingelesen: Die eigene Landmasse bleibt.
    applyAtlas(db, planet().planet);
    expect(at(12, 12).land?.name).toBe('Seeinsel');
    undo();
    expect(at(12, 12).water).toBe('lake');
  });

  it('setzt die Lage von Orten; Orte darunter erben sie', async () => {
    const { db, places } = await setup();
    const parent = places.find((p) => places.some((c) => c.place.parentId === p.id))!;
    const child = places.find((c) => c.place.parentId === parent.id)!;
    const other = places.find(
      (p) => p.id !== parent.id && p.place.parentId !== parent.id && p.id !== child.id,
    )!;
    expect(placeGeo(db.getSnapshot(), child.id)).toBeNull();

    const undo = setPlaceGeo(db, parent.id, { lon: 190.123456, lat: 10 });
    // Gerundet und in den Bereich −180…180 gebracht.
    expect(placeGeo(db.getSnapshot(), parent.id)).toMatchObject({
      geo: { lon: -169.8765, lat: 10 },
      own: true,
    });
    expect(placeGeo(db.getSnapshot(), child.id)).toMatchObject({
      own: false,
      from: { id: parent.id },
    });

    // Zwei Orte mit Lage: Luftlinie und Richtung.
    setPlaceGeo(db, other.id, { lon: -169.8765, lat: 20 });
    const leg = legBetween(db.getSnapshot(), parent.id, other.id)!;
    expect(leg.km).toBeCloseTo((10 / 360) * 2 * Math.PI * 6000, 3);
    expect(leg.direction).toBe('Norden');
    // Ort und Unterort liegen (noch) an derselben Stelle – keine Strecke.
    expect(legBetween(db.getSnapshot(), parent.id, child.id)).toBeNull();

    undo();
    expect(placeGeo(db.getSnapshot(), child.id)).toBeNull();
    expect(legBetween(db.getSnapshot(), parent.id, other.id)).toBeNull();
  });

  it('kennt Jahreszeit und Tageslicht an einer Lage', async () => {
    const { db, places } = await setup();
    const data = db.getSnapshot();
    const now = data.state.now;
    const fraction = seasonFraction(data, now);
    expect(fraction).toBeGreaterThanOrEqual(0);
    expect(fraction).toBeLessThan(1);
    // Ein halbes Jahr später steht die Sonne gegenüber: Was im Norden lang war, ist dann kurz.
    // Das Jahr ist das des Kalenders der Kampagne (365 Tage), nicht das der Planetendatei.
    const half = Math.round((365 / 2) * 1440);
    const north = daylightAt(data, { lon: 0, lat: 50 }, now)!;
    db.setState({ now: now + half });
    const later = daylightAt(db.getSnapshot(), { lon: 0, lat: 50 }, now + half)!;
    expect(north + later).toBeCloseTo(20, 0);
    // Am Äquator ist der Tag immer halb so lang wie der ganze (hier 20 Stunden).
    expect(daylightAt(data, { lon: 0, lat: 0 }, now)).toBeCloseTo(10, 6);
    expect(formatHours(9.667)).toBe('9 Std. 40 Min.');
    expect(formatHours(12)).toBe('12 Std.');

    // Für die Karte: nur Orte mit eigener Lage; groß ist, über wem kein gesetzter Ort liegt.
    const parent = places.find((p) => places.some((c) => c.place.parentId === p.id))!;
    const child = places.find((c) => c.place.parentId === parent.id)!;
    setPlaceGeo(db, parent.id, { lon: 5, lat: 5 });
    setPlaceGeo(db, child.id, { lon: 6, lat: 6 });
    expect(
      placedPlaces(db.getSnapshot())
        .map((p) => [p.place.id, p.major])
        .sort(),
    ).toEqual(
      [
        [parent.id, true],
        [child.id, false],
      ].sort(),
    );
  });

  it('lässt sich wieder herausnehmen, ohne die Lage der Orte zu verlieren', async () => {
    const { db, places } = await setup();
    setPlaceGeo(db, places[0]!.id, { lon: 1, lat: 2 });
    removeAtlas(db);
    expect(planetOf(db.getSnapshot())).toBeNull();
    expect(reliefOf(db.getSnapshot())).toBeNull();
    expect(placeGeo(db.getSnapshot(), places[0]!.id)?.geo).toEqual({ lon: 1, lat: 2 });
  });
});
