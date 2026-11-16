import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  AreaSchema,
  RestSchema,
  RollTableSchema,
  createChronicleEntry,
  createEntity,
  type Area,
  type CampaignData,
  type Terrain,
} from '../../domain/schema';
import { dayIndexOf } from '../../domain/time/calendar';
import { placeParty, rerollArea, setTravelPace, travelTo } from './actions';
import { generateArea } from './generate';
import {
  TERRAIN_MAX_PACE,
  effectivePace,
  forcedMarch,
  hexMinutes,
  hexOfPlace,
  planStep,
  rollEncounters,
  routeTo,
  stepProblem,
} from './travel';
import { marchAfter, marchedMinutes } from '../../domain/march';

/**
 * Eine kleine Karte: oben der direkte Weg von A nach B mit Wald, Gebirge und einem See, darunter
 * eine Reihe Grasland, über die man den See umgeht.
 *
 *   A(0,0) Wald(1,0) Gebirge(2,0) See(3,0) Gras(4,0) B(5,0)
 *     Gras(-1,1) … Gras(4,1)
 */
function world(pace: 'slow' | 'normal' | 'fast' = 'normal', at: [number, number] | null = [0, 0]) {
  const base = elarisCampaign();
  const a = createEntity({ kind: 'place', name: 'Hohenfurt' });
  const b = createEntity({ kind: 'place', name: 'Graufels' });
  const top: Terrain[] = ['grassland', 'forest', 'mountains', 'water', 'grassland', 'grassland'];
  const area = AreaSchema.parse({
    id: 'karte',
    created: '',
    updated: '',
    name: 'Probe',
    hexKm: 10,
    orientation: 'pointy',
    fromId: a.id,
    toId: b.id,
    seed: 5,
    hexes: [
      ...top.map((terrain, q) => ({
        q,
        r: 0,
        terrain,
        placeId: q === 0 ? a.id : q === 5 ? b.id : null,
        discovered: q === 0,
      })),
      ...[-1, 0, 1, 2, 3, 4].map((q) => ({ q, r: 1, terrain: 'grassland' as const })),
    ],
    party: at ? { q: at[0], r: at[1], pace } : null,
  });
  const data: CampaignData = {
    ...base,
    entities: { ...base.entities, [a.id]: a, [b.id]: b },
    areas: { [area.id]: area },
  };
  return { data, area, a, b };
}

const NOON = (data: CampaignData) => dayIndexOf(data.state.now) * 1440 + 12 * 60;

describe('Reisetempo', () => {
  it('folgt dem Regelwerk und wird vom Gelände begrenzt', () => {
    // 10 km bei 2, 3 und 4 Meilen je Stunde.
    expect(hexMinutes(10, 'grassland', 'slow')).toBe(165);
    expect(hexMinutes(10, 'grassland', 'normal')).toBe(125);
    expect(hexMinutes(10, 'grassland', 'fast')).toBe(100);
    // Wald lässt höchstens normales Tempo zu, Gebirge und Sumpf nur langsames.
    expect(effectivePace('forest', 'fast')).toBe('normal');
    expect(effectivePace('forest', 'slow')).toBe('slow');
    expect(hexMinutes(10, 'mountains', 'fast')).toBe(165);
    expect(hexMinutes(10, 'swamp', 'normal')).toBe(165);
    // Wasser geht zu Fuß nicht; ein Feld ohne Gelände bremst nicht.
    expect(hexMinutes(10, 'water', 'normal')).toBeNull();
    expect(hexMinutes(10, null, 'fast')).toBe(100);
    expect(hexMinutes(0.1, 'grassland', 'fast')).toBe(5);
    expect(Object.keys(TERRAIN_MAX_PACE)).toHaveLength(11);
  });

  it('macht aus mehr als acht Stunden einen Gewaltmarsch', () => {
    expect(forcedMarch(480)).toBeNull();
    expect(forcedMarch(481)).toEqual({ hours: 1, dc: 11 });
    expect(forcedMarch(540)).toEqual({ hours: 1, dc: 11 });
    expect(forcedMarch(600)).toEqual({ hours: 2, dc: 12 });
  });
});

describe('Ein Schritt auf der Karte', () => {
  it('geht nur auf ein passierbares Nachbarfeld', () => {
    const { area } = world();
    expect(stepProblem(area, { q: 1, r: 0 })).toBeNull();
    expect(stepProblem(area, { q: 2, r: 0 })).toBe('not-adjacent');
    expect(stepProblem(area, { q: 0, r: -1 })).toBe('off-map');
    expect(stepProblem({ ...area, party: null }, { q: 1, r: 0 })).toBe('no-party');
    const atMountain = { ...area, party: { ...area.party!, q: 2, r: 0 } };
    expect(stepProblem(atMountain, { q: 3, r: 0 })).toBe('impassable');
  });

  it('kostet Zeit, deckt auf und merkt sich den Weg', () => {
    const { data, area } = world('fast');
    const now = NOON(data);
    const step = planStep(data, area, { q: 1, r: 0 }, now);
    if (typeof step === 'string') throw new Error(step);
    // Der Wald bremst von schnell auf normal.
    expect(step).toMatchObject({
      minutes: 125,
      pace: 'normal',
      slowed: true,
      marched: 125,
      march: null,
      arrivedAt: null,
    });
    expect(step.area.party).toMatchObject({
      q: 1,
      r: 0,
      pace: 'fast',
      day: dayIndexOf(now),
      minutes: 125,
      trail: [{ q: 0, r: 0 }],
    });
    // Betreten: (1,0). Zu sehen: die Nachbarn auf der Karte – (2,0), (0,1), (1,1); (0,0) war es schon.
    expect(step.revealed).toBe(4);
    expect(
      step.area.hexes
        .filter((h) => h.discovered)
        .map((h) => `${h.q},${h.r}`)
        .sort(),
    ).toEqual(['0,0', '0,1', '1,0', '1,1', '2,0']);
    // Das Ausgangsgebiet bleibt unberührt.
    expect(area.party).toMatchObject({ q: 0, r: 0 });
    const after = { ...data, areas: { [area.id]: step.area } };
    expect(step.area.party!.legs).toEqual([{ at: now + 125, minutes: 125 }]);
    expect(marchedMinutes(after, now + 125)).toBe(125);
    // Nach 24 Stunden zählt der Schritt nicht mehr, auch ohne Rast.
    expect(marchedMinutes(after, now + 125 + 1440)).toBe(0);
  });

  it('zählt die Reisezeit seit der letzten Langen Rast und meldet den Gewaltmarsch', () => {
    const { data, area } = world('normal');
    const now = NOON(data);
    const tired = (at: number): Area => ({
      ...area,
      party: { ...area.party!, legs: [{ at, minutes: 400 }] },
    });
    const step = planStep(data, tired(now), { q: 0, r: 1 }, now);
    if (typeof step === 'string') throw new Error(step);
    expect(step.marched).toBe(525);
    expect(step.march).toEqual({ hours: 1, dc: 11 });
    // Mitternacht beginnt keinen neuen Reisetag: Der Marsch geht weiter.
    const late = dayIndexOf(now) * 1440 + 23 * 60;
    const night = planStep(data, tired(late), { q: 0, r: 1 }, late);
    if (typeof night === 'string') throw new Error(night);
    expect(night.marched).toBe(525);
    expect(night.march).toEqual({ hours: 1, dc: 11 });
    // Nach einer Langen Rast beginnt die Zählung neu.
    const rest = RestSchema.parse({ id: 'rast1', start: late - 480, end: late, status: 'done' });
    const rested = { ...data, rests: { [rest.id]: rest } };
    const fresh = planStep(rested, tired(late), { q: 0, r: 1 }, late);
    if (typeof fresh === 'string') throw new Error(fresh);
    expect(fresh.marched).toBe(125);
    expect(fresh.march).toBeNull();
  });

  it('zählt Wege und Hexkarte zusammen', () => {
    const { data, area } = world('normal');
    const now = NOON(data);
    const entry = createChronicleEntry({
      kind: 'travel',
      at: now,
      travel: { fromId: null, toId: null, minutes: 6 * 60 },
    });
    const walked = { ...data, chronicle: { [entry.id]: entry }, state: { ...data.state, now } };
    expect(marchedMinutes(walked, now)).toBe(360);
    // Noch drei Stunden auf einem Weg: eine Stunde über acht.
    expect(marchAfter(walked, 180)).toEqual({ hours: 1, dc: 11 });
    const step = planStep(walked, area, { q: 1, r: 0 }, now);
    if (typeof step === 'string') throw new Error(step);
    expect(step.marched).toBe(360 + 125);
    expect(step.march).toEqual({ hours: 1, dc: 11 });
  });

  it('meldet die Ankunft an einem Ort', () => {
    const { data, area, b } = world('normal', [4, 0]);
    const step = planStep(data, area, { q: 5, r: 0 }, NOON(data));
    if (typeof step === 'string') throw new Error(step);
    expect(step.arrivedAt).toBe(b.id);
    expect(hexOfPlace(area, b.id)).toMatchObject({ q: 5, r: 0 });
    expect(hexOfPlace(area, null)).toBeUndefined();
  });
});

describe('Der Weg zum Ziel', () => {
  it('führt um das Wasser herum und meidet langsames Gelände', () => {
    const { area } = world('normal');
    const route = routeTo(area, { q: 5, r: 0 })!;
    // Über die Reihe Grasland: kein Wald, kein Gebirge, kein See – sechs Schritte bis ans Ziel.
    const keys = route.steps.map((step) => `${step.q},${step.r}`);
    expect(keys).toHaveLength(6);
    expect(keys.slice(0, 4)).toEqual(['0,1', '1,1', '2,1', '3,1']);
    expect(keys[5]).toBe('5,0');
    for (const blocked of ['1,0', '2,0', '3,0']) expect(keys).not.toContain(blocked);
    expect(route.minutes).toBe(6 * 125);
    expect(routeTo(area, { q: 0, r: 0 })).toEqual({ steps: [], minutes: 0 });
    expect(routeTo(area, { q: 9, r: 9 })).toBeNull();
    expect(routeTo({ ...area, party: null }, { q: 5, r: 0 })).toBeNull();
    // Ins Wasser führt kein Weg.
    expect(routeTo(area, { q: 3, r: 0 })).toBeNull();
  });

  it('gibt es nicht, wenn Wasser das Ziel abschneidet', () => {
    const { area } = world();
    const cut: Area = {
      ...area,
      hexes: area.hexes.map((h) =>
        (h.q === 4 && h.r === 0) || (h.q === 4 && h.r === 1) || (h.q === 3 && h.r === 1)
          ? { ...h, terrain: 'water' as const }
          : h,
      ),
    };
    expect(routeTo(cut, { q: 5, r: 0 })).toBeNull();
  });
});

describe('Begegnungen aus Tabellen', () => {
  const table = (id: string, dc: number | null) =>
    RollTableSchema.parse({
      id,
      created: '',
      updated: '',
      name: 'Am Weg',
      die: 4,
      dc,
      entries: [
        { id: 'e1', min: 1, max: 2, text: 'Ein umgestürzter Karren.' },
        { id: 'e2', min: 3, max: 4, text: 'Fahrende Händler.' },
      ],
    });

  it('würfelt wiederholbar und achtet die Prüfung', () => {
    const { data, area } = world();
    const always = table('immer', null);
    const never = table('nie', 21);
    const withTables: CampaignData = { ...data, tables: { immer: always, nie: never } };
    const mapped: Area = { ...area, tableIds: ['immer', 'nie', 'fehlt'] };
    const hex = mapped.hexes[1]!;
    const first = rollEncounters(withTables, mapped, hex, 1000);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ check: null });
    expect(['Ein umgestürzter Karren.', 'Fahrende Händler.']).toContain(first[0]!.text);
    expect(rollEncounters(withTables, mapped, hex, 1000)).toEqual(first);
    // Über viele Zeitpunkte kommen beide Einträge vor.
    const texts = new Set(
      Array.from({ length: 40 }, (_, i) => rollEncounters(withTables, mapped, hex, i)[0]!.text),
    );
    expect(texts.size).toBe(2);
    // Tabellen am Feld gehen denen des Gebiets vor.
    expect(rollEncounters(withTables, mapped, { ...hex, tableIds: ['nie'] }, 1000)).toEqual([]);
    expect(rollEncounters(withTables, { ...mapped, tableIds: [] }, hex, 1000)).toEqual([]);
    // Mit Prüfung: bei Schwierigkeit 11 etwa jedes zweite Mal.
    const half: CampaignData = { ...data, tables: { halb: table('halb', 11) } };
    const hits = Array.from(
      { length: 400 },
      (_, i) => rollEncounters(half, { ...area, tableIds: ['halb'] }, hex, i).length,
    ).reduce((a, b) => a + b, 0);
    expect(hits).toBeGreaterThan(150);
    expect(hits).toBeLessThan(250);
  });
});

describe('Reisen im Spielstand', () => {
  it('stellt die Gruppe auf, lässt sie ziehen und nimmt den Schritt zurück', async () => {
    const { data, area } = world('normal', null);
    const store = new MemoryStore();
    const db = await CampaignDb.create(store, data);
    const get = () => db.getSnapshot().areas[area.id]!;

    expect(travelTo(db, area.id, { q: 1, r: 0 })).toBe('no-party');
    placeParty(db, area.id, { q: 9, r: 9 });
    expect(get().party).toBeNull();
    placeParty(db, area.id, { q: 0, r: 0 });
    expect(get().party).toMatchObject({ q: 0, r: 0, pace: 'normal', minutes: 0, trail: [] });
    expect(get().hexes.filter((h) => h.discovered)).toHaveLength(4);
    setTravelPace(db, area.id, 'fast');
    expect(get().party!.pace).toBe('fast');

    const before = db.getSnapshot().state.now;
    const result = travelTo(db, area.id, { q: 0, r: 1 });
    if (typeof result === 'string') throw new Error(result);
    expect(result.step.minutes).toBe(100);
    expect(db.getSnapshot().state.now).toBe(before + 100);
    expect(get().party).toMatchObject({ q: 0, r: 1, minutes: 100, trail: [{ q: 0, r: 0 }] });
    expect(travelTo(db, area.id, { q: 4, r: 1 })).toBe('not-adjacent');

    // Übersteht Speichern und Laden.
    await db.flush();
    const reopened = await CampaignDb.open(store);
    expect(reopened.problems).toEqual([]);
    expect(reopened.getSnapshot().areas[area.id]!.party).toEqual(get().party);

    result.undo();
    expect(db.getSnapshot().state.now).toBe(before);
    expect(get().party).toMatchObject({ q: 0, r: 0, minutes: 0, trail: [] });

    placeParty(db, area.id, null);
    expect(get().party).toBeNull();
  });

  it('nimmt die Gruppe beim Neuwürfeln von der Karte', async () => {
    const { data, a, b } = world();
    const generated = generateArea(data, {
      fromId: a.id,
      toId: b.id,
      distanceKm: 80,
      biome: 'forest',
      hexKm: 10,
      seed: 3,
    });
    const db = await CampaignDb.create(new MemoryStore(), {
      ...data,
      areas: { [generated.id]: generated },
    });
    const start = hexOfPlace(generated, a.id)!;
    placeParty(db, generated.id, start);
    expect(db.getSnapshot().areas[generated.id]!.party).not.toBeNull();
    const undo = rerollArea(db, generated.id)!;
    expect(db.getSnapshot().areas[generated.id]!.party).toBeNull();
    undo();
    expect(db.getSnapshot().areas[generated.id]!.party).toMatchObject({ q: start.q, r: start.r });
  });
});
