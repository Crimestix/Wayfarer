import { describe, expect, it } from 'vitest';
import { elarisCampaign } from '../../data/seed';
import {
  hexAt,
  hexBand,
  hexCenter,
  hexDistance,
  hexKey,
  hexLine,
  hexNeighbors,
  hexRound,
} from '../../domain/hex';
import {
  AreaSchema,
  MapSchema,
  PathSchema,
  RollTableSchema,
  TERRAINS,
  createEntity,
  type CampaignData,
  type Entity,
  type Hex,
} from '../../domain/schema';
import { DAY_KM, formatDays, travelDays } from '../../domain/terrain';
import {
  FEATURES,
  MAX_HEXES,
  areaLine,
  generateArea,
  generateHexes,
  recognize,
  recognizeBiome,
  suggestHexKm,
  terrainNoise,
  terrainOf,
  terrainShares,
  type GenerateInput,
} from './generate';
import { generatorTables } from './tables';

const place = (name: string, details: Record<string, unknown> = {}, extra: object = {}) =>
  createEntity({ kind: 'place', name, place: details, ...extra });
const world = (entities: Entity[], more: Partial<CampaignData> = {}): CampaignData => ({
  ...elarisCampaign(),
  entities: Object.fromEntries(entities.map((e) => [e.id, e])),
  ...more,
});

describe('Rechnen mit Hexfeldern', () => {
  it('zählt Abstände in Feldern und kennt sechs Nachbarn', () => {
    const origin = { q: 0, r: 0 };
    expect(hexDistance(origin, { q: 3, r: -1 })).toBe(3);
    expect(hexDistance({ q: -2, r: 5 }, { q: -2, r: 5 })).toBe(0);
    const neighbors = hexNeighbors(origin);
    expect(new Set(neighbors.map(hexKey)).size).toBe(6);
    for (const n of neighbors) expect(hexDistance(origin, n)).toBe(1);
  });

  it('zieht lückenlose Linien und Streifen darum', () => {
    const line = hexLine({ q: 0, r: 0 }, { q: 7, r: -3 });
    expect(line).toHaveLength(8);
    expect(line[0]).toEqual({ q: 0, r: 0 });
    expect(line[7]).toEqual({ q: 7, r: -3 });
    for (let i = 1; i < line.length; i++) expect(hexDistance(line[i - 1]!, line[i]!)).toBe(1);
    const band = hexBand(line, 2);
    expect(new Set(band.map(hexKey)).size).toBe(band.length);
    for (const hex of band)
      expect(Math.min(...line.map((l) => hexDistance(l, hex)))).toBeLessThanOrEqual(2);
    expect(hexBand([{ q: 0, r: 0 }], 1)).toHaveLength(7);
  });

  it('rechnet zwischen Feld und Ebene hin und zurück', () => {
    for (const hex of [
      { q: 0, r: 0 },
      { q: 4, r: -2 },
      { q: -3, r: 7 },
    ]) {
      const { x, y } = hexCenter(hex);
      expect(hexAt(x, y)).toEqual(hex);
    }
    // Nachbarfelder liegen genau eine Feldgröße auseinander.
    const a = hexCenter({ q: 0, r: 0 });
    for (const n of hexNeighbors({ q: 0, r: 0 })) {
      const b = hexCenter(n);
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(1, 9);
    }
    expect(hexRound(0.3, 0.2)).toEqual({ q: 0, r: 0 });
    // Beide Ausrichtungen rechnen hin und zurück.
    for (const orientation of ['flat', 'pointy'] as const) {
      const c = hexCenter({ q: 5, r: -2 }, orientation);
      expect(hexAt(c.x, c.y, orientation)).toEqual({ q: 5, r: -2 });
    }
    // Auf der Spitze stehend liegt der Nachbar im Osten genau eine Feldgröße weiter rechts.
    expect(hexCenter({ q: 1, r: 0 }, 'pointy')).toEqual({ x: 1, y: 0 });
    expect(Object.is(hexRound(-0.1, 0.05).q, -0)).toBe(false);
  });
});

describe('Reisetage nach Regelwerk', () => {
  it('rechnet mit 18, 24 und 30 Meilen am Tag', () => {
    expect(DAY_KM.normal).toBeCloseTo(38.62, 1);
    expect(travelDays(640)).toBe(16.5);
    expect(travelDays(640, 'fast')).toBe(13.5);
    expect(travelDays(5)).toBe(0.5);
    expect([0.5, 1, 1.5, 3].map(formatDays)).toEqual(['½ Tag', '1 Tag', '1½ Tage', '3 Tage']);
  });
});

describe('Erkennen, was zwischen zwei Orten liegt', () => {
  it('liest die Landschaft aus Namen, Art und Umgebung der Orte', () => {
    const moor = place('Krähenmoor', { category: 'Wildnis' });
    const village = place('Dornweiler', { parentId: moor.id });
    const data = world([moor, village]);
    const result = recognizeBiome(data, [village.id, moor.id]);
    expect(result.biome).toBe('swamp');
    expect(result.source).toContain('„Krähenmoor“');

    const deep = place('Die Tiefen', { category: 'Unterreich' });
    const city = place('Steinheim', { parentId: deep.id });
    expect(recognizeBiome(world([deep, city]), [city.id]).biome).toBe('underdark');

    const plain = place('Altbruck');
    const none = recognizeBiome(world([plain]), [plain.id]);
    expect(none.biome).toBe('grassland');
    expect(none.source).toContain('offenes Land');
  });

  it('misst Entfernung und Richtung auf der Karte und findet Orte am Weg', () => {
    const a = place('Hohenfurt');
    const b = place('Graufels');
    const mid = place('Salzmühle');
    const far = place('Abseits');
    const map = MapSchema.parse({
      id: 'k1',
      name: 'Aschenmark',
      scale: { kmPerUnit: 2 },
      markers: [
        { id: 'm1', x: 100, y: 100, entityId: a.id },
        { id: 'm2', x: 200, y: 100, entityId: b.id },
        { id: 'm3', x: 150, y: 110, entityId: mid.id },
        { id: 'm4', x: 400, y: 100, entityId: far.id },
      ],
    });
    const result = recognize(world([a, b, mid, far], { maps: { k1: map } }), a.id, b.id);
    expect(result.distanceKm).toBeCloseTo(200);
    expect(result.distanceSource).toContain('Karte „Aschenmark“');
    expect(result.direction).toEqual({ x: 1, y: 0 });
    expect(result.between).toEqual([{ placeId: mid.id, along: 0.5, offsetKm: -20 }]);
    expect(result.hexKm).toBe(10);
  });

  it('nimmt sonst die Länge eines gespeicherten Weges – oder sagt, dass sie fehlt', () => {
    const a = place('Hohenfurt');
    const b = place('Graufels');
    const path = PathSchema.parse({
      id: 'w1',
      fromId: b.id,
      toId: a.id,
      name: 'Salzstraße',
      distanceKm: 42,
      terrain: 'hills',
    });
    const known = recognize(world([a, b], { paths: { w1: path } }), a.id, b.id);
    expect(known.distanceKm).toBe(42);
    expect(known.distanceSource).toContain('„Salzstraße“');
    expect(known.biome).toBe('hills');
    const unknown = recognize(world([a, b]), a.id, b.id);
    expect(unknown.distanceKm).toBeNull();
    expect(unknown.distanceSource).toContain('bitte eintragen');
    expect(unknown.direction).toBeNull();
  });

  it('wählt die Feldgröße so, dass der Weg überschaubar bleibt', () => {
    expect(suggestHexKm(20)).toBe(2);
    expect(suggestHexKm(640)).toBe(10);
    expect(suggestHexKm(3000)).toBe(50);
    expect(suggestHexKm(null)).toBe(10);
  });
});

describe('Gelände', () => {
  it('hängt zusammen: Nachbarpunkte sind ähnlich, derselbe Ausgangswert gibt dasselbe', () => {
    let jumps = 0;
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      const a = terrainNoise(11, x, 3.1);
      const b = terrainNoise(11, x + 0.05, 3.1);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
      if (Math.abs(a - b) > 0.08) jumps++;
    }
    expect(jumps).toBe(0);
    expect(terrainNoise(11, 4.2, 9.9)).toBe(terrainNoise(11, 4.2, 9.9));
    expect(terrainNoise(12, 4.2, 9.9)).not.toBe(terrainNoise(11, 4.2, 9.9));
  });

  it('liest Höhe und Feuchte je nach Landschaft', () => {
    expect(terrainOf('grassland', 0.9, 0.5, 0)).toBe('mountains');
    expect(terrainOf('grassland', 0.5, 0.8, 0)).toBe('forest');
    expect(terrainOf('grassland', 0.5, 0.2, 0)).toBe('grassland');
    expect(terrainOf('grassland', 0.1, 0.5, 0)).toBe('water');
    expect(terrainOf('underdark', 0.5, 0.5, 0)).toBe('underdark');
    expect(terrainOf('desert', 0.5, 0.5, 0)).toBe('desert');
    // An der Küste liegt das Meer auf einer Seite des Weges.
    expect(terrainOf('coast', 0.5, 0.5, 0.9)).toBe('water');
    expect(terrainOf('coast', 0.5, 0.3, -0.9)).toBe('grassland');
    for (const biome of TERRAINS)
      for (const h of [0.05, 0.5, 0.95]) expect(TERRAINS).toContain(terrainOf(biome, h, 0.5, 0));
  });
});

describe('Hexkarte erzeugen', () => {
  const a = place('Hohenfurt');
  const b = place('Graufels');
  const mid = place('Salzmühle');
  const data = world([a, b, mid]);
  const input: GenerateInput = {
    fromId: a.id,
    toId: b.id,
    distanceKm: 200,
    biome: 'grassland',
    hexKm: 10,
    seed: 4711,
    between: [{ placeId: mid.id, along: 0.5, offsetKm: 20 }],
  };

  it('ist wiederholbar und ändert sich mit dem Ausgangswert', () => {
    const one = generateHexes(input);
    expect(generateHexes(input)).toEqual(one);
    const other = generateHexes({ ...input, seed: 4712 });
    expect(other.hexes.map((h) => h.terrain)).not.toEqual(one.hexes.map((h) => h.terrain));
  });

  it('legt Start, Ziel und Orte am Weg an die richtige Stelle', () => {
    const { hexes, line } = generateHexes(input);
    expect(line).toHaveLength(21);
    const at = (id: string) => hexes.find((h) => h.placeId === id)!;
    expect(at(a.id)).toMatchObject({ q: 0, r: 0, discovered: true });
    expect(hexDistance(at(a.id), at(b.id))).toBe(20);
    // Auf halbem Weg, zwei Felder südlich der Linie.
    const m = at(mid.id);
    expect(hexDistance(at(a.id), m)).toBeGreaterThanOrEqual(9);
    expect(hexCenter(m).y).toBeGreaterThan(1);
    expect(hexes.filter((h) => h.discovered)).toHaveLength(1);
    expect(new Set(hexes.map(hexKey)).size).toBe(hexes.length);
  });

  it('ergibt eine abwechslungsreiche, aber begehbare Landschaft', () => {
    const { hexes, line } = generateHexes(input);
    const kinds = new Set(hexes.map((h) => h.terrain));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    // Der direkte Weg führt nie durch offenes Wasser, und Orte stehen an Land.
    const byKey = new Map(hexes.map((h) => [hexKey(h), h]));
    for (const step of line) expect(byKey.get(hexKey(step))!.terrain).not.toBe('water');
    for (const hex of hexes) if (hex.placeId) expect(hex.terrain).not.toBe('water');
    // Gelände bildet Flächen: Die meisten Felder haben einen Nachbarn mit demselben Gelände.
    const alike = hexes.filter((h) =>
      hexNeighbors(h).some((n) => byKey.get(hexKey(n))?.terrain === h.terrain),
    );
    expect(alike.length / hexes.length).toBeGreaterThan(0.85);
  });

  it('streut Besonderheiten passend zum Gelände, nie zwei nebeneinander', () => {
    const { hexes } = generateHexes(input);
    const byKey = new Map(hexes.map((h) => [hexKey(h), h]));
    const isLandscape = (h: Hex) => FEATURES[h.terrain!].includes(h.feature);
    const marked = hexes.filter((h) => h.feature && isLandscape(h));
    expect(marked.length / hexes.length).toBeGreaterThan(0.05);
    expect(marked.length / hexes.length).toBeLessThan(0.25);
    for (const hex of marked) {
      expect(hex.placeId).toBeNull();
      for (const n of hexNeighbors(hex)) {
        const other = byKey.get(hexKey(n));
        if (other && isLandscape(other)) expect(other.feature).toBe('');
      }
    }
  });

  it('legt Fundstellen und Verborgenes selten und verstreut aus den Tabellen', () => {
    const { hexes } = generateHexes(input);
    const sites = hexes.filter((h) => h.feature && !FEATURES[h.terrain!].includes(h.feature));
    const hiddenOnly = hexes.filter((h) => h.hidden && !h.feature);
    // Nicht jedes Feld ist voll: zusammen weit unter der Hälfte.
    const filled = hexes.filter((h) => h.feature || h.hidden || h.afar);
    expect(filled.length / hexes.length).toBeLessThan(0.4);
    expect(sites.length).toBeGreaterThan(0);
    expect(hiddenOnly.length).toBeGreaterThan(0);
    for (const a of sites)
      for (const b of sites) if (a !== b) expect(hexDistance(a, b)).toBeGreaterThanOrEqual(3);
    // Was man von fern sieht, gehört immer zu einer Fundstelle.
    for (const hex of hexes.filter((h) => h.afar)) expect(sites).toContain(hex);
  });

  it('nimmt die Tabelle des Spielleiters, wenn es eine gibt', () => {
    const tables = generatorTables({
      tables: {
        eigene: RollTableSchema.parse({
          id: 'eigene',
          created: '',
          updated: '',
          name: 'Fundstellen',
          kind: 'generator',
          slot: 'site',
          die: 2,
          entries: [
            { id: 'z1', min: 1, max: 2, text: 'Ein Kobold-Markt (von fern: bunte Fahnen)' },
          ],
        }),
      },
    });
    const { hexes } = generateHexes({ ...input, tables });
    const sites = hexes.filter((h) => h.feature === 'Ein Kobold-Markt');
    expect(sites.length).toBeGreaterThan(0);
    for (const hex of sites) expect(hex.afar).toBe('Bunte Fahnen');
  });

  it('folgt der bekannten Richtung und bleibt auch bei langen Wegen handlich', () => {
    const south = generateHexes({ ...input, direction: { x: 0, y: 1 } });
    const end = hexCenter(south.hexes.find((h) => h.placeId === b.id)!);
    // Genau im Süden, 200 km entfernt; über Felder ist der Weg dorthin etwas länger.
    expect(Math.abs(end.x)).toBeLessThanOrEqual(0.5);
    expect(end.y).toBeCloseTo(20, 0);
    expect(south.line.length).toBeGreaterThan(21);
    expect(south.line.length).toBeLessThanOrEqual(25);
    const long = generateHexes({ ...input, distanceKm: 800, between: [] });
    expect(long.hexes.length).toBeLessThanOrEqual(MAX_HEXES);
    expect(long.radius).toBeGreaterThanOrEqual(2);
    const tiny = generateHexes({ ...input, distanceKm: 3, between: [] });
    expect(tiny.line.length).toBe(2);
  });

  it('wird ein gültiges Erkundungsgebiet mit Namen, Herkunft und Ausgangswert', () => {
    const area = generateArea(data, input);
    expect(AreaSchema.parse(area)).toEqual(area);
    expect(area).toMatchObject({
      name: 'Hohenfurt → Graufels',
      fromId: a.id,
      toId: b.id,
      biome: 'grassland',
      seed: 4711,
      hexKm: 10,
      distanceKm: 200,
    });
    expect(areaLine(area)).toHaveLength(21);
    const shares = terrainShares(area);
    expect(shares[0]!.count).toBeGreaterThanOrEqual(shares[shares.length - 1]!.count);
    expect(shares.reduce((sum, s) => sum + s.count, 0)).toBe(area.hexes.length);
    expect(generateArea(data, input, '  Salzroute ').name).toBe('Salzroute');
  });

  it('kennt für jede Landschaft eine eigene Prägung', () => {
    const dominant = (biome: GenerateInput['biome']) =>
      terrainShares({ hexes: generateHexes({ ...input, biome, between: [] }).hexes })[0]!.terrain;
    expect(dominant('underdark')).toBe('underdark');
    expect(dominant('desert')).toBe('desert');
    expect(dominant('swamp')).toBe('swamp');
    expect(dominant('forest')).toBe('forest');
    expect(dominant('water')).toBe('water');
  });
});
