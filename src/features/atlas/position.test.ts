/**
 * Was aus der Lage folgt: Küstennähe, Klima, Sonne, Reisestrecke und das Gelände der Hexkarten.
 * Die Welt hier ist erfunden: ein Planet mit einem einzigen großen Land.
 */
import { describe, expect, it } from 'vitest';
import { elarisCampaign } from '../../data/seed';
import {
  describeSite,
  siteClimate,
  siteCooling,
  sitePreset,
  warmestMonthAt,
} from '../../domain/geoClimate';
import { hexKey } from '../../domain/hex';
import {
  AtlasSchema,
  MapSchema,
  createEntity,
  type CampaignData,
  type Entity,
  type GameMap,
} from '../../domain/schema';
import { warmestMonth, weatherZone } from '../../domain/weatherZone';
import {
  generateHexes,
  groundOf,
  groundTerrain,
  recognize,
  type GenerateInput,
} from '../erkundung/generate';
import {
  coastKm,
  describeSun,
  encodeHeights,
  formatMinuteOfDay,
  isDark,
  mapsOfPlace,
  placeGeo,
  placedPlaces,
  planetOf,
  sunAt,
} from './model';

/** 6.000 km Halbmesser: Ein Grad auf dem Äquator sind 104,72 km. */
const RADIUS = 6000;
const KM_PER_DEGREE = (2 * Math.PI * RADIUS) / 360;

/** „Nordland“ reicht von 0° bis 60° Ost und von 40° Süd bis 80° Nord. */
const planetDoc = () =>
  AtlasSchema.parse({
    id: 'planet',
    rev: 0,
    created: '',
    updated: '',
    kind: 'planet',
    name: 'Probe',
    radiusKm: RADIUS,
    obliquityDeg: 25,
    lands: [{ id: 'nordland', name: 'Nordland', rings: [[0, -40, 60, -40, 60, 80, 0, 80]] }],
  });

/** Höhen in Zellen von 10°: überall 100 m, nur um 35° Ost, 45° Nord ein Gebirge von 2.500 m. */
const reliefDoc = () => {
  const heights = new Int16Array(36 * 18).fill(100);
  heights[4 * 36 + 21] = 2500;
  return AtlasSchema.parse({
    id: 'relief',
    rev: 0,
    created: '',
    updated: '',
    kind: 'relief',
    width: 36,
    height: 18,
    heights: encodeHeights(heights),
  });
};

const place = (name: string, lon: number | null, lat = 0, parent?: Entity) =>
  createEntity({
    kind: 'place',
    name,
    place: { geo: lon === null ? null : { lon, lat }, parentId: parent?.id ?? null },
  });

const world = (entities: Entity[], atlas = true): CampaignData => ({
  ...elarisCampaign(),
  entities: Object.fromEntries(entities.map((e) => [e.id, e])),
  atlas: atlas ? { planet: planetDoc(), relief: reliefDoc() } : {},
});

/** Eine Karte mit Punkten: [Ort, x, y] – x nach rechts, y nach unten. */
const chart = (name: string, points: [Entity, number, number][]): GameMap =>
  MapSchema.parse({
    id: `karte-${name}`,
    rev: 0,
    created: '',
    updated: '',
    name,
    markers: points.map(([entity, x, y], i) => ({ id: `m${i}`, x, y, entityId: entity.id })),
  });

describe('Karten in den Planeten einhängen', () => {
  const a = place('Hohenfurt', 10, 0);
  const b = place('Graufels', 20, 0);
  const c = place('Reusenhof', null);
  const d = place('Aalweiher', null);
  const e = place('Nebelmoor', null);
  const lone = place('Einödhof', null);
  // Norden ist oben: Graufels liegt 500 Einheiten östlich, der Reusenhof 250 nördlich der Mitte.
  const north = chart('Nordland', [
    [a, 100, 500],
    [b, 600, 500],
    [c, 350, 250],
  ]);
  // Eine zweite, gedrehte Karte hängt am Reusenhof, dessen Lage erst aus der ersten folgt.
  const turned = chart('Seenplatte', [
    [b, 0, 0],
    [c, 0, 100],
    [d, 0, 50],
  ]);
  const single = chart('Moorkarte', [
    [a, 10, 10],
    [e, 50, 50],
    [lone, 90, 90],
  ]);
  const withMaps = (...maps: GameMap[]): CampaignData => ({
    ...world([a, b, c, d, e, lone]),
    maps: Object.fromEntries(maps.map((map) => [map.id, map])),
  });

  it('rechnet aus zwei bekannten Orten die Lage aller anderen Orte der Karte', () => {
    const data = withMaps(north);
    const found = placeGeo(data, c.id)!;
    expect(found).toMatchObject({ own: false, exact: true, from: { id: c.id } });
    expect(found.via?.name).toBe('Nordland');
    expect(found.geo.lon).toBeCloseTo(15, 1);
    expect(found.geo.lat).toBeCloseTo(5, 1);
    // Eingetragene Lagen bleiben, wie sie sind.
    expect(placeGeo(data, a.id)).toMatchObject({ own: true, exact: true, via: null });
    // Auf der Karte des Atlas erscheint der Ort mit; das Klima rechnet mit seiner Lage.
    expect(placedPlaces(data).map((p) => p.place.name)).toEqual([
      'Graufels',
      'Hohenfurt',
      'Reusenhof',
    ]);
    expect(weatherZone(data, c.id)).toMatchObject({ source: 'position', from: { id: c.id } });
  });

  it('hängt weitere Karten an Orten ein, deren Lage selbst aus einer Karte stammt', () => {
    const data = withMaps(north, turned);
    // Auf der gedrehten Karte liegt der Weiher auf halbem Weg von Graufels zum Reusenhof.
    const pond = placeGeo(data, d.id)!;
    expect(pond.via?.name).toBe('Seenplatte');
    expect(pond.geo.lon).toBeCloseTo(17.5, 0);
    expect(pond.geo.lat).toBeCloseTo(2.5, 0);
    // Ohne die erste Karte fehlt der zweite bekannte Ort.
    expect(placeGeo(withMaps(turned), d.id)).toBeNull();
  });

  it('sagt, was einer Karte zum Einhängen fehlt – und rechnet nicht ohne Atlas', () => {
    const data = withMaps(north, single);
    expect(placeGeo(data, e.id)).toBeNull();
    expect(mapsOfPlace(data, e.id)).toMatchObject([
      { map: { name: 'Moorkarte' }, placed: 1, anchored: false },
    ]);
    expect(mapsOfPlace(data, c.id)).toMatchObject([
      { map: { name: 'Nordland' }, placed: 3, anchored: true },
    ]);
    const noAtlas = { ...data, atlas: {} };
    expect(placeGeo(noAtlas, c.id)).toBeNull();
  });
});

describe('Küstennähe', () => {
  const planet = planetOf(world([]))!;

  it('findet das Meer Ring für Ring', () => {
    // Knapp hinter der Westküste: Schon der erste Ring erreicht das Meer.
    expect(coastKm(planet, { lon: 0.3, lat: 45 })).toBe(60);
    expect(coastKm(planet, { lon: 1.5, lat: 0 })).toBe(300);
    // Mitten im Land ist im ganzen Umkreis kein Meer, auf dem Meer ist es null Kilometer weit.
    expect(coastKm(planet, { lon: 30, lat: 20 })).toBeNull();
    expect(coastKm(planet, { lon: -20, lat: 0 })).toBe(0);
  });
});

describe('Klima aus der Lage', () => {
  const site = (lat: number, coast: number | null = null, heightM: number | null = 100) => ({
    lat,
    heightM,
    coastKm: coast,
  });

  it('liest die Vorgabe aus Breite und Küstennähe', () => {
    expect(sitePreset(site(75))).toBe('arctic');
    expect(sitePreset(site(60))).toBe('cold');
    expect(sitePreset(site(45))).toBe('temperate');
    expect(sitePreset(site(45, 60))).toBe('maritime');
    expect(sitePreset(site(28))).toBe('desert');
    expect(sitePreset(site(28, 150))).toBe('warm');
    expect(sitePreset(site(5))).toBe('tropical');
    // Im Süden gilt dasselbe, gespiegelt.
    expect(sitePreset(site(-45))).toBe('temperate');
    expect(sitePreset(site(-75, 0))).toBe('arctic');
  });

  it('kühlt mit der Höhe ab und nennt, woran es das Klima abliest', () => {
    expect(siteCooling(site(45, null, 100))).toBe(0);
    expect(siteCooling(site(45, null, 2300))).toBe(13);
    expect(siteCooling(site(45, null, null))).toBe(0);
    expect(describeSite(site(-52, 60, 340))).toBe('52° Süd, 340 m hoch, nahe am Meer');
    expect(describeSite(site(20))).toBe('20° Nord, fern vom Meer');
  });

  it('baut die Klimazone: im Süden versetzt, in der Höhe kälter und wie im Gebirge', () => {
    const low = siteClimate(site(45), 12, 6);
    expect(low).toMatchObject({ preset: 'temperate', cooling: 0, south: false });
    expect(low.climate.id).toBe('klima-lage-temperate');
    const hottest = (months: { tempMax: number }[]) =>
      months.indexOf(months.reduce((a, b) => (b.tempMax > a.tempMax ? b : a)));
    expect(hottest(low.climate.months)).toBe(6);

    const south = siteClimate(site(-45), 12, 6);
    expect(south.climate.id).toBe('klima-lage-temperate-s');
    expect(hottest(south.climate.months)).toBe(0);
    expect(warmestMonthAt(6, 12, -45)).toBe(0);
    expect(warmestMonthAt(6, 12, 45)).toBe(6);

    const high = siteClimate(site(45, null, 2300), 12, 6);
    expect(high.climate.id).toBe('klima-lage-temperate-13-g');
    expect(high.climate.name).toBe('Gebirge (Gemäßigt)');
    expect(high.climate.months[6]!.tempMax).toBeCloseTo(low.climate.months[6]!.tempMax - 13, 6);
    expect(high.climate.months[6]!.wind).toBeGreaterThan(low.climate.months[6]!.wind);
  });

  it('gibt Orten mit einer Lage ihr Klima – und allem darunter', () => {
    const town = place('Hohenfurt', 30, 20);
    const square = place('Marktplatz', null, 0, town);
    const data = world([town, square]);
    const zone = weatherZone(data, town.id);
    expect(zone).toMatchObject({ source: 'position', preset: 'desert', from: { id: town.id } });
    expect(zone.site).toMatchObject({ lat: 20, coastKm: null });
    expect(weatherZone(data, square.id)).toMatchObject({
      source: 'position',
      from: { id: town.id },
    });
    // Beide teilen ihr Wetter.
    expect(weatherZone(data, square.id).seed).toBe(zone.seed);
    // Ohne Atlas sagt die Lage nichts.
    expect(weatherZone(world([town, square], false), town.id).source).toBe('default');
  });

  it('lässt deutliche Worte gelten, wo sie näher am Ort stehen als die Lage', () => {
    const land = place('Graufels', 30, 45);
    const glacier = place('Gletscherfeld', null, 0, land);
    const cave = place('Tropfsteinhöhle', 30, 45, land);
    const salt = place('Salzwüste', 30, 45, land);
    const port = place('Hafen Aalfischer', 0.3, 45, land);
    const data = world([land, glacier, cave, salt, port]);
    expect(weatherZone(data, land.id)).toMatchObject({ source: 'position', preset: 'temperate' });
    // Ein Wort am Ort selbst schlägt die Lage des Ortes darüber.
    expect(weatherZone(data, glacier.id)).toMatchObject({ source: 'recognized', preset: 'arctic' });
    // Unter der Erde gibt es kein Wetter – egal, wo es liegt.
    expect(weatherZone(data, cave.id).preset).toBe('underground');
    // Auf gleicher Stufe gilt „Wüste“, „Hafen“ dagegen überlässt es der Lage.
    expect(weatherZone(data, salt.id)).toMatchObject({ source: 'recognized', preset: 'desert' });
    expect(weatherZone(data, port.id)).toMatchObject({ source: 'position', preset: 'maritime' });
  });

  it('versetzt die Jahreszeiten erkannter Zonen, wenn der Ort im Süden liegt', () => {
    const south = place('Südmark', 30, -30);
    const glacier = place('Gletscherfeld', null, 0, south);
    const data = world([south, glacier]);
    const zone = weatherZone(data, glacier.id);
    expect(zone).toMatchObject({ source: 'recognized', preset: 'arctic' });
    expect(zone.climate.id).toBe('klima-arctic-s');
    const months = zone.climate.months;
    const hottest = months.indexOf(months.reduce((a, b) => (b.tempMax > a.tempMax ? b : a)));
    expect(hottest).toBe(warmestMonthAt(warmestMonth(data), months.length, -30));
    expect(hottest).not.toBe(warmestMonth(data));
  });
});

describe('Die Sonne am Ort', () => {
  it('kennt Aufgang, Untergang und Tageslänge – im Norden anders als im Süden', () => {
    const north = place('Nordwacht', 30, 60);
    const south = place('Südwacht', 30, -40);
    const pole = place('Eiswarte', 30, 79);
    const nowhere = place('Irgendwo', null);
    const data = world([north, south, pole, nowhere]);
    // Ein Tag im wärmsten Monat des Nordens: dort lang, im Süden kurz.
    const cal = data.campaign.calendar;
    let day = 0;
    for (let month = 0; month < warmestMonth(data); month++) day += cal.months[month]!.days;
    const time = (day + 3) * 24 * 60 + 12 * 60;
    const up = sunAt(data, north.id, time)!;
    const down = sunAt(data, south.id, time)!;
    expect(up.hours).toBeGreaterThan(15);
    expect(down.hours).toBeLessThan(11);
    expect(up.rise! + up.set!).toBe(24 * 60);
    expect(isDark(up, 12 * 60)).toBe(false);
    expect(isDark(up, 30)).toBe(true);
    expect(describeSun(up)).toMatch(/^Hell von \d\d:\d\d bis \d\d:\d\d \(\d+ Std\./);
    // Jenseits des Polarkreises geht die Sonne dann nicht unter.
    const polar = sunAt(data, pole.id, time)!;
    expect(polar).toMatchObject({ polar: 'day', rise: null, set: null });
    expect(isDark(polar, 0)).toBe(false);
    expect(describeSun(polar)).toContain('Polartag');
    // Ohne Lage oder ohne Atlas weiß Wayfarer nichts über die Sonne.
    expect(sunAt(data, nowhere.id, time)).toBeNull();
    expect(sunAt(world([north], false), north.id, time)).toBeNull();
    expect(formatMinuteOfDay(7 * 60 + 5)).toBe('07:05');
  });
});

describe('Reisen nach dem Atlas', () => {
  it('misst Entfernung und Richtung auf dem Planeten und findet Orte am Weg', () => {
    const a = place('Hohenfurt', 10, 0);
    const b = place('Graufels', 20, 0);
    const c = place('Reusenhof', 15, 0.5);
    const far = place('Fernwacht', 15, 30);
    const data = world([a, b, c, far]);
    const known = recognize(data, a.id, b.id);
    expect(known.distanceKm).toBeCloseTo(10 * KM_PER_DEGREE, 3);
    expect(known.distanceSource).toBe('Gemessen auf dem Planeten (Luftlinie).');
    expect(known.fromAtlas).toBe(true);
    expect(known.origin).toEqual({ lon: 10, lat: 0 });
    // Nach Osten: x zeigt nach Osten, y nach Süden.
    expect(known.direction!.x).toBeCloseTo(1, 6);
    expect(known.direction!.y).toBeCloseTo(0, 6);
    // Der Hof liegt auf halbem Weg, ein halbes Grad nördlich – also links der Strecke.
    expect(known.between).toHaveLength(1);
    expect(known.between[0]).toMatchObject({ placeId: c.id });
    expect(known.between[0]!.along).toBeCloseTo(0.5, 2);
    expect(known.between[0]!.offsetKm).toBeCloseTo(-0.5 * KM_PER_DEGREE, 0);
    // Kein Wort deutet auf eine Landschaft: Das Klima auf halber Strecke sagt „Tropen“.
    expect(known.biome).toBe('forest');
    expect(known.biomeSource).toContain('Aus der Lage gerechnet: Tropen');
  });

  it('rechnet notfalls grob mit der Lage des Ortes darüber', () => {
    const a = place('Hohenfurt', 10, 0);
    const land = place('Graufels', 20, 0);
    const inn = place('Zum Aal', null, 0, land);
    const known = recognize(world([a, land, inn]), a.id, inn.id);
    expect(known.distanceKm).toBeCloseTo(10 * KM_PER_DEGREE, 3);
    expect(known.distanceSource).toContain('grob');
    expect(known.distanceSource).toContain('„Graufels“');
    // Ohne Atlas bleibt die Entfernung offen.
    expect(recognize(world([a, land, inn], false), a.id, inn.id).distanceKm).toBeNull();
  });

  it('liest das Gelände eines Feldes vom Planeten', () => {
    expect(groundTerrain('forest', { water: 'sea', heightM: null }, 0.5, 0.5)).toBe('water');
    expect(groundTerrain('forest', { water: null, heightM: 2000 }, 0.5, 0.5)).toBe('mountains');
    expect(groundTerrain('forest', { water: null, heightM: 900 }, 0.5, 0.5)).toBe('hills');
    // Im Tiefland entscheidet die Landschaft – ohne erfundene Seen und Gebirge.
    expect(groundTerrain('forest', { water: null, heightM: 100 }, 0.1, 0.9)).toBe('swamp');
    expect(groundTerrain('desert', { water: null, heightM: 100 }, 0.5, 0.5)).toBe('desert');
    expect(groundTerrain('arctic', { water: null, heightM: 100 }, 0.1, 0.5)).toBe('arctic');
    expect(groundTerrain('grassland', { water: null, heightM: 100 }, 0.9, 0.5)).toBe('hills');
    expect(groundTerrain('mountains', { water: null, heightM: 100 }, 0.5, 0.2)).toBe('grassland');
  });

  it('baut Hexkarten mit dem Meer und der Küste des Atlas', () => {
    // Von knapp hinter der Westküste hinaus zu einer Insel, die der Atlas nicht kennt.
    const a = place('Hohenfurt', 1.5, 10);
    const b = place('Aalinsel', -1.5, 10);
    const data = world([a, b]);
    const known = recognize(data, a.id, b.id);
    const input: GenerateInput = {
      fromId: a.id,
      toId: b.id,
      distanceKm: known.distanceKm!,
      biome: 'grassland',
      hexKm: 10,
      seed: 7,
      direction: known.direction,
      between: known.between,
      ground: groundOf(data, known.origin),
    };
    const map = generateHexes(input);
    const byKey = new Map(map.hexes.map((hex) => [hexKey(hex), hex]));
    const line = map.line.map((cell) => byKey.get(hexKey(cell))!);
    // Der Start liegt an Land, das Ziel bekommt Boden unter die Füße, dazwischen ist Meer.
    expect(line[0]!.terrain).not.toBe('water');
    expect(line[line.length - 1]!).toMatchObject({ placeId: b.id, terrain: 'coast' });
    expect(line.filter((hex) => hex.terrain === 'water').length).toBeGreaterThan(8);
    // Östlich des Starts gibt es kein Wasser – der Atlas kennt dort keins.
    expect(map.hexes.filter((hex) => hex.q + hex.r / 2 > 1 && hex.terrain === 'water')).toEqual([]);
    // Wo Land ans Meer stößt, liegt Küste.
    expect(map.hexes.some((hex) => hex.terrain === 'coast' && !hex.placeId)).toBe(true);
    // Gleiche Angaben, gleiche Karte.
    expect(generateHexes(input)).toEqual(map);
    // Ohne Atlas gibt es kein Gelände vom Planeten.
    expect(groundOf(world([a, b], false), known.origin)).toBeUndefined();
  });

  it('legt Hügel und Berge dorthin, wo das Höhenraster sie hat', () => {
    const a = place('Hohenfurt', 28, 45);
    const b = place('Graufels', 42, 45);
    const data = world([a, b]);
    const known = recognize(data, a.id, b.id);
    const map = generateHexes({
      fromId: a.id,
      toId: b.id,
      distanceKm: known.distanceKm!,
      biome: 'grassland',
      hexKm: 50,
      seed: 3,
      direction: known.direction,
      ground: groundOf(data, known.origin),
    });
    const byKey = new Map(map.hexes.map((hex) => [hexKey(hex), hex]));
    const line = map.line.map((cell) => byKey.get(hexKey(cell))!);
    expect(line[Math.floor(line.length / 2)]!.terrain).toBe('mountains');
    expect(map.hexes.some((hex) => hex.terrain === 'water')).toBe(false);
  });
});
