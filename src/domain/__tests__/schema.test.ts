import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { demoCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createBackup, readBackup } from '../../features/einstellungen/backup';
import { repairReferences } from '../../features/import/integrity';
import { KIND_LABEL, KIND_LABEL_PLURAL } from '../derive';
import { RELATION_TYPES, relationLabel } from '../relations';
import {
  AreaSchema,
  ClimateSchema,
  COLLECTION_NAMES,
  COLLECTION_SCHEMAS,
  ENTITY_KINDS,
  EntitySchema,
  JourneySchema,
  LATER_COLLECTIONS,
  MapSchema,
  MountSchema,
  PathSchema,
  RestSchema,
  RollTableSchema,
  TimerSchema,
  WeatherSchema,
  createEntity,
  createTimer,
  emptyCollections,
  weatherId,
  type CampaignData,
} from '../schema';

describe('Datenmodell der zweiten Welle', () => {
  it('kennt die neuen Arten der Weltdatenbank mit deutschen Bezeichnungen', () => {
    for (const kind of ['family', 'species', 'language', 'script', 'ability'] as const) {
      expect(ENTITY_KINDS).toContain(kind);
      const entity = createEntity({ kind, name: 'Probe' });
      expect(entity.kind).toBe(kind);
      expect(entity[kind as keyof typeof entity]).toBeTypeOf('object');
      expect(KIND_LABEL[kind]).toBeTruthy();
      expect(KIND_LABEL_PLURAL[kind]).toBeTruthy();
    }
    expect(KIND_LABEL.family).toBe('Familie');
    expect(KIND_LABEL_PLURAL.ability).toBe('Fähigkeiten');
  });

  it('liest Dateien der ersten Welle weiter und füllt die neuen Felder mit Vorgaben', () => {
    const person = EntitySchema.parse({ id: 'p1', kind: 'person', name: 'Bruder Teoric' });
    expect(person.kind === 'person' && person.person).toMatchObject({
      species: '',
      speciesId: null,
      workplaceId: null,
    });
    const place = EntitySchema.parse({ id: 'o1', kind: 'place', name: 'Krähenmoor' });
    expect(place.kind === 'place' && place.place.climateId).toBeNull();
    const timer = TimerSchema.parse({ id: 't1', label: 'Fackel', start: 0, end: 60 });
    expect(timer).toMatchObject({
      kind: 'effect',
      casterId: null,
      concentration: false,
      participants: [],
    });
  });

  it('kennt Zauber mit Konzentration und Teilgruppe als Timer', () => {
    const spell = createTimer({
      label: 'Segnen',
      kind: 'spell',
      start: 0,
      end: 10,
      casterId: 'naelmira',
      concentration: true,
      participants: ['tomlin', 'neil'],
    });
    expect(spell.kind).toBe('spell');
    expect(spell.concentration).toBe(true);
  });

  it('hat Beziehungen für Sprachen, Schriften und Fähigkeiten', () => {
    const keys = RELATION_TYPES.map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining(['speaks', 'writes', 'has-ability', 'member']));
    expect(relationLabel({ type: 'speaks', label: '' }, 'from')).toBe('spricht');
    expect(relationLabel({ type: 'speaks', label: '' }, 'to')).toBe('wird gesprochen von');
  });

  it('füllt jede neue Sammlung aus einer knappen Datei mit sinnvollen Vorgaben', () => {
    expect(
      MapSchema.parse({ id: 'k1', name: 'Veloran', lk: { resourceId: 'r', docId: 'd' } }),
    ).toMatchObject({ placeId: null, frame: null, scale: null, markers: [] });
    expect(PathSchema.parse({ id: 'w1', fromId: 'a', toId: 'b' })).toMatchObject({
      distanceKm: null,
      minutes: null,
      terrain: 'grassland',
      road: 'none',
      oneWay: false,
      secret: false,
      points: [],
    });
    expect(JourneySchema.parse({ id: 'r1' })).toMatchObject({
      pace: 'normal',
      status: 'planned',
      progress: { leg: 0, km: 0 },
      participants: [],
      legs: [],
    });
    expect(MountSchema.parse({ id: 'm1', name: 'Reitpferd' })).toMatchObject({
      kind: 'mount',
      speed: null,
      builtIn: false,
    });
    const climate = ClimateSchema.parse({
      id: 'gemaessigt',
      name: 'Gemäßigt',
      months: [{ tempMin: -2, tempMax: 6 }],
    });
    expect(climate.months[0]).toEqual({
      tempMin: -2,
      tempMax: 6,
      precipitation: 30,
      wind: 30,
      fog: 5,
    });
    expect(
      WeatherSchema.parse({
        id: weatherId('gemaessigt', 28088),
        climateId: 'gemaessigt',
        day: 28088,
        temperature: 4,
      }),
    ).toMatchObject({ id: 'gemaessigt-28088', precipitation: 'none', wind: 'none', manual: false });
    expect(AreaSchema.parse({ id: 'g1', name: 'Grauwald', hexes: [{ q: 0, r: 0 }] })).toMatchObject(
      {
        hexKm: 10,
        origin: [0, 0],
        orientation: 'flat',
        hexes: [{ q: 0, r: 0, terrain: null, discovered: false, prepared: '' }],
      },
    );
    expect(
      RollTableSchema.parse({
        id: 'b1',
        name: 'Unterreich, tief',
        die: 4,
        dc: 15,
        entries: [{ id: 'e1', min: 1, max: 1, text: 'Schleifspuren' }],
      }),
    ).toMatchObject({ kind: 'encounter', placeId: null });
    expect(RestSchema.parse({ id: 'ra1', start: 100 })).toMatchObject({
      kind: 'long',
      status: 'running',
      end: null,
      watches: [],
    });
  });

  it('lehnt unsinnige Werte ab', () => {
    expect(() =>
      ClimateSchema.parse({ id: 'x', name: 'x', months: [{ tempMin: 0, tempMax: 1, wind: 150 }] }),
    ).toThrow();
    expect(() => RollTableSchema.parse({ id: 'x', name: 'x', die: 1 })).toThrow();
    expect(() => PathSchema.parse({ id: 'x', fromId: 'a', toId: 'b', distanceKm: -3 })).toThrow();
    expect(() => JourneySchema.parse({ id: 'x', pace: 'galopp' })).toThrow();
  });

  it('führt alle Sammlungen in emptyCollections und markiert die neuen für ältere Sicherungen', () => {
    expect(Object.keys(emptyCollections()).sort()).toEqual([...COLLECTION_NAMES].sort());
    for (const name of LATER_COLLECTIONS) expect(COLLECTION_NAMES).toContain(name);
    // Ordnernamen müssen zur Pfadprüfung passen: nur Kleinbuchstaben.
    for (const name of COLLECTION_NAMES) expect(name).toMatch(/^[a-z]+$/);
  });
});

/** Beispielwelt mit je einem Dokument der neuen Sammlungen. */
function withSecondWave(): CampaignData {
  const data = demoCampaign();
  const places = Object.values(data.entities).filter((e) => e.kind === 'place');
  const [a, b] = places;
  if (!a || !b) throw new Error('Die Beispielwelt braucht zwei Orte.');
  const parse = <N extends keyof typeof COLLECTION_SCHEMAS>(name: N, doc: unknown) =>
    COLLECTION_SCHEMAS[name].parse(doc);
  return {
    ...data,
    paths: { w1: parse('paths', { id: 'w1', fromId: a.id, toId: b.id, distanceKm: 12 }) },
    maps: {
      k1: parse('maps', {
        id: 'k1',
        name: 'Karte',
        placeId: a.id,
        markers: [{ id: 'm1', x: 1, y: 2, entityId: b.id }],
      }),
    },
    journeys: {
      r1: parse('journeys', { id: 'r1', startId: a.id, legs: [{ id: 'l1', pathId: 'w1' }] }),
    },
    climates: { c1: parse('climates', { id: 'c1', name: 'Gemäßigt' }) },
    tables: { b1: parse('tables', { id: 'b1', name: 'Wald' }) },
  } as CampaignData;
}

describe('Neue Sammlungen im Spielstand', () => {
  it('werden gespeichert und beim erneuten Öffnen genauso gelesen', async () => {
    const store = new MemoryStore();
    const data = withSecondWave();
    await CampaignDb.create(store, data);
    expect(store.files.has('paths/w1.json')).toBe(true);
    expect(store.files.has('maps/k1.json')).toBe(true);
    const reopened = await CampaignDb.open(store);
    expect(reopened.getSnapshot()).toEqual(data);
    expect(reopened.problems).toEqual([]);
  });

  it('gehen in die Sicherung und unverändert wieder heraus', () => {
    const data = withSecondWave();
    const restored = readBackup(JSON.parse(JSON.stringify(createBackup(data))));
    expect(restored.data).toEqual(data);
    expect(restored.skipped).toEqual([]);
  });

  it('fehlen in einer Sicherung der ersten Welle, ohne dass das als Mangel gemeldet wird', () => {
    const file = createBackup(demoCampaign()) as unknown as Record<string, unknown>;
    for (const name of LATER_COLLECTIONS) delete file[name];
    const restored = readBackup(JSON.parse(JSON.stringify(file)));
    expect(restored.skipped).toEqual([]);
    for (const name of LATER_COLLECTIONS) expect(restored.data[name]).toEqual({});
  });

  it('räumt Verweise auf, die ins Leere zeigen', () => {
    const data = withSecondWave();
    const [a] = Object.values(data.entities).filter((e) => e.kind === 'place');
    const person = createEntity({
      kind: 'person',
      name: 'Probe',
      person: { speciesId: a!.id, workplaceId: 'fehlt' },
    });
    const timer = createTimer({
      label: 'Segnen',
      kind: 'spell',
      start: 0,
      end: 10,
      casterId: 'fehlt',
      participants: ['fehlt'],
    });
    const broken: CampaignData = {
      ...data,
      entities: { ...data.entities, [person.id]: person },
      timers: { [timer.id]: timer },
      paths: {
        ...data.paths,
        w2: PathSchema.parse({ id: 'w2', fromId: a!.id, toId: 'fehlt' }),
      },
    };
    const { data: fixed, repaired } = repairReferences(broken);
    expect(repaired).toBe(5);
    const fixedPerson = fixed.entities[person.id]!;
    // Ein Ort ist keine Spezies.
    expect(fixedPerson.kind === 'person' && fixedPerson.person.speciesId).toBeNull();
    expect(fixedPerson.kind === 'person' && fixedPerson.person.workplaceId).toBeNull();
    expect(fixed.timers[timer.id]).toMatchObject({ casterId: null, participants: [] });
    expect(fixed.paths.w2).toBeUndefined();
    expect(fixed.paths.w1).toBeDefined();
    expect(fixed.journeys.r1!.legs[0]!.pathId).toBe('w1');
  });
});
