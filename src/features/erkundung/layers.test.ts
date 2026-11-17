import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { afarFrom, bearing, sightingLine } from '../../domain/afar';
import { journeyUnderway, nextHalt, type Roll } from '../../domain/journey';
import {
  AreaSchema,
  HexSchema,
  JourneyLegSchema,
  createEntity,
  createJourney,
  newId,
  type Terrain,
} from '../../domain/schema';
import { dayIndexOf } from '../../domain/time/calendar';
import { placeParty, rerollArea, searchHex, travelTo } from './actions';
import { searchMinutes } from './travel';
import { searchOnJourney, travelOn } from '../reise/actions';

const dice = (...values: number[]): Roll => {
  const queue = [...values];
  return () => queue.shift() ?? 1;
};

/**
 * Eine Reihe Felder von West nach Ost: A(0,0) … B(6,0). Auf (5,0) steht ein Turm, den man von
 * fern sieht; auf (2,0) liegt etwas Verborgenes.
 */
async function world(terrain: Terrain = 'grassland') {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const a = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const b = db.put('entities', createEntity({ kind: 'place', name: 'Graufels' }));
  const area = db.put(
    'areas',
    AreaSchema.parse({
      id: 'karte',
      created: '',
      updated: '',
      name: 'Probe',
      hexKm: 10,
      orientation: 'pointy',
      fromId: a.id,
      toId: b.id,
      seed: 3,
      hexes: [0, 1, 2, 3, 4, 5, 6].map((q) => ({
        q,
        r: 0,
        terrain: q === 0 ? terrain : 'grassland',
        placeId: q === 0 ? a.id : q === 6 ? b.id : null,
        afar: q === 5 ? 'Ein schiefer Turm' : '',
        hidden: q === 2 ? 'Ein vergrabener Kupferkessel' : '',
      })),
    }),
  );
  return { db, data: () => db.getSnapshot(), area, a, b };
}

describe('Von fern zu sehen', () => {
  it('nennt die Himmelsrichtung', () => {
    expect(bearing({ q: 0, r: 0 }, { q: 2, r: 0 })).toBe('Osten');
    expect(bearing({ q: 0, r: 0 }, { q: -2, r: 0 })).toBe('Westen');
    expect(bearing({ q: 0, r: 0 }, { q: 1, r: -2 })).toBe('Norden');
    expect(bearing({ q: 0, r: 0 }, { q: -1, r: 2 })).toBe('Süden');
  });

  it('sieht über offenes Land drei Felder weit, aus dem Wald nur eins', async () => {
    const { data } = await world();
    const area = data().areas.karte!;
    expect(afarFrom(area, { q: 0, r: 0 })).toEqual([]);
    const seen = afarFrom(area, { q: 2, r: 0 });
    expect(seen.map(sightingLine)).toEqual(['Im Osten (3 Felder): Ein schiefer Turm']);
    const forest = {
      hexes: area.hexes.map((hex) => (hex.q === 2 ? { ...hex, terrain: 'forest' as const } : hex)),
    };
    expect(afarFrom(forest, { q: 2, r: 0 })).toEqual([]);
    expect(afarFrom(forest, { q: 4, r: 0 })).toHaveLength(1);
  });

  it('gibt es unter der Erde nicht', () => {
    const cave = HexSchema.parse({ q: 0, r: 0, terrain: 'underdark', exits: [] });
    const tower = HexSchema.parse({ q: 1, r: 0, terrain: 'underdark', exits: [], afar: 'Licht' });
    expect(afarFrom({ hexes: [cave, tower] }, cave)).toEqual([]);
  });

  it('meldet den Turm beim Schritt einmal, danach gilt er als gesehen', async () => {
    const { db, data } = await world();
    placeParty(db, 'karte', { q: 0, r: 0 });
    const first = travelTo(db, 'karte', { q: 1, r: 0 });
    if (typeof first === 'string') throw new Error(first);
    expect(first.step.sighted).toEqual([]);
    const second = travelTo(db, 'karte', { q: 2, r: 0 });
    if (typeof second === 'string') throw new Error(second);
    expect(second.step.sighted.map((s) => s.text)).toEqual(['Ein schiefer Turm']);
    expect(data().areas.karte!.hexes.find((h) => h.q === 5)!.sighted).toBe(true);
    const third = travelTo(db, 'karte', { q: 3, r: 0 });
    if (typeof third === 'string') throw new Error(third);
    expect(third.step.sighted).toEqual([]);
  });

  it('bleibt beim Neu würfeln am Feld', async () => {
    const { db, data } = await world();
    rerollArea(db, 'karte');
    const hexes = data().areas.karte!.hexes;
    expect(hexes.find((h) => h.afar)?.afar).toBe('Ein schiefer Turm');
    expect(hexes.find((h) => h.hidden)?.hidden).toBe('Ein vergrabener Kupferkessel');
  });
});

describe('Durchsuchen', () => {
  it('dauert so lange wie das Durchqueren und findet, was verborgen liegt', async () => {
    const { db, data } = await world();
    placeParty(db, 'karte', { q: 2, r: 0 });
    const before = data().state.now;
    const chronicle = Object.keys(data().chronicle).length;
    const hex = data().areas.karte!.hexes.find((h) => h.q === 2)!;
    const minutes = searchMinutes(data(), data().areas.karte!, hex)!;
    expect(minutes).toBeGreaterThan(0);
    const result = searchHex(db, 'karte')!;
    expect(result.search.found).toBe('Ein vergrabener Kupferkessel');
    expect(data().state.now).toBe(before + minutes);
    expect(data().areas.karte!.hexes.find((h) => h.q === 2)!.searched).toBe(true);
    expect(Object.keys(data().chronicle).length).toBe(chronicle + 1);
    result.undo();
    expect(data().state.now).toBe(before);
    expect(data().areas.karte!.hexes.find((h) => h.q === 2)!.searched).toBe(false);
    expect(Object.keys(data().chronicle).length).toBe(chronicle);
  });

  it('findet auf einem leeren Feld nichts – und schreibt dann nichts in die Chronik', async () => {
    const { db, data } = await world();
    placeParty(db, 'karte', { q: 3, r: 0 });
    const chronicle = Object.keys(data().chronicle).length;
    const result = searchHex(db, 'karte')!;
    expect(result.search.found).toBeNull();
    expect(Object.keys(data().chronicle).length).toBe(chronicle);
  });

  it('geht nicht auf dem Wasser', async () => {
    const { data } = await world();
    const water = HexSchema.parse({ q: 0, r: 0, terrain: 'water' });
    expect(searchMinutes(data(), data().areas.karte!, water)).toBeNull();
  });
});

describe('Unterwegs: in Sicht und durchsuchen', () => {
  /** Eine Reise über die Probekarte, eine Stunde je Feld. */
  async function journey() {
    const ctx = await world();
    const { db, data, a, b } = ctx;
    db.setState({ placeId: a.id });
    const leg = JourneyLegSchema.parse({
      id: newId(),
      fromId: a.id,
      toId: b.id,
      minutes: 360,
      areaId: 'karte',
      hexes: [0, 1, 2, 3, 4, 5, 6].map((q) => ({ q, r: 0, at: q * 60 })),
    });
    db.put(
      'journeys',
      createJourney({
        name: 'Graufels',
        startId: a.id,
        toId: b.id,
        legs: [leg],
        status: 'underway',
        departAt: data().state.now,
        // Orientierung ist heute schon geschehen.
        navDay: dayIndexOf(data().state.now),
      }),
    );
    return ctx;
  }

  it('hält, sobald der Turm in Sicht kommt – einmal', async () => {
    const { db, data } = await journey();
    const halt = nextHalt(data(), journeyUnderway(data())!, dice())!;
    expect(halt.kind).toBe('sighted');
    expect(halt.minutes).toBe(120);
    expect(halt.text).toBe('Im Osten (3 Felder): Ein schiefer Turm');
    travelOn(db, dice());
    expect(data().areas.karte!.hexes.find((h) => h.q === 5)!.sighted).toBe(true);
    const kinds: string[] = [];
    while (journeyUnderway(data())) kinds.push(travelOn(db, dice())!.halt.kind);
    expect(kinds).not.toContain('sighted');
  });

  it('durchsucht das Feld, auf dem die Reise steht, ohne voranzukommen', async () => {
    const { db, data } = await journey();
    travelOn(db, dice()); // bis Feld 2: der Turm kommt in Sicht
    const progress = journeyUnderway(data())!.progress;
    const before = data().state.now;
    const result = searchOnJourney(db, dice())!;
    expect(result.found).toBe('Ein vergrabener Kupferkessel');
    expect(data().state.now).toBe(before + result.minutes);
    expect(journeyUnderway(data())!.progress).toEqual(progress);
    expect(journeyUnderway(data())!.halt).toMatchObject({ kind: 'search' });
    result.undo();
    expect(data().state.now).toBe(before);
  });
});
