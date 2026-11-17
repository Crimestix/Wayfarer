import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { hexNeighbors } from '../../domain/hex';
import { exitsOf, isRock } from '../../domain/passages';
import { createEntity } from '../../domain/schema';
import { digBetween, fillRock, placeParty, rerollArea, toggleShaft, travelTo } from './actions';
import { SIX_MILES_KM, generateArea } from './generate';
import { routeTo } from './travel';

/** Eine erfundene Strecke unter der Erde: 120 km, sechs Meilen je Feld. */
async function setup() {
  const a = createEntity({ kind: 'place', name: 'Schlundtor' });
  const b = createEntity({ kind: 'place', name: 'Tiefenhall' });
  const base = elarisCampaign();
  const data = { ...base, entities: { ...base.entities, [a.id]: a, [b.id]: b } };
  const area = generateArea(data, {
    fromId: a.id,
    toId: b.id,
    distanceKm: 120,
    biome: 'underdark',
    hexKm: SIX_MILES_KM,
    seed: 7,
  });
  const db = await CampaignDb.create(new MemoryStore(), { ...data, areas: { [area.id]: area } });
  return { db, area, a, b, get: () => db.getSnapshot().areas[area.id]! };
}

describe('Hexkarten unter der Erde', () => {
  it('erzeugt Fels, Gänge und Ebenen; Start und Ziel liegen oben und sind verbunden', async () => {
    const { area, a, b } = await setup();
    expect(area.hexes.some(isRock)).toBe(true);
    expect(Math.max(...area.hexes.map((h) => h.level))).toBeGreaterThanOrEqual(1);
    const start = area.hexes.find((h) => h.placeId === a.id)!;
    const goal = area.hexes.find((h) => h.placeId === b.id)!;
    expect([start.level, goal.level]).toEqual([0, 0]);
    const party = {
      q: start.q,
      r: start.r,
      level: 0,
      pace: 'normal' as const,
      day: 0,
      minutes: 0,
      trail: [],
      legs: [],
    };
    expect(routeTo({ ...area, party }, goal)?.steps.length).toBeGreaterThan(3);
  });

  it('geht nur durch Gänge: Fels und geschlossene Seiten halten auf', async () => {
    const { db, area, a } = await setup();
    const start = area.hexes.find((h) => h.placeId === a.id)!;
    placeParty(db, area.id, start);
    const open = new Set(exitsOf(start).map((e) => e.dir));
    const closed = hexNeighbors(start).find(
      (n, dir) =>
        !open.has(dir) && area.hexes.some((h) => h.level === 0 && h.q === n.q && h.r === n.r),
    )!;
    expect(travelTo(db, area.id, closed)).toBe('wall');
    const through = hexNeighbors(start)[[...open].find((d) => d < 6)!]!;
    expect(typeof travelTo(db, area.id, through)).toBe('object');
  });

  it('lässt Gänge ziehen, Fels setzen und Schächte öffnen – alles zurücknehmbar über den Stand', async () => {
    const { db, area, get } = await setup();
    const rock = get().hexes.find((h) => h.level === 0 && isRock(h) && !h.placeId)!;
    const n = get().hexes.find((h) => h.level === 0 && h.q === rock.q + 1 && h.r === rock.r)!;
    expect(digBetween(db, area.id, rock, n, 'climb')).toBe(true);
    const dug = get().hexes.find((h) => h.level === 0 && h.q === rock.q && h.r === rock.r)!;
    expect(exitsOf(dug)).toEqual([{ dir: 1, kind: 'climb', found: false }]);
    expect(dug.manual).toBe(true);
    expect(dug.dug).toBe(true);
    expect(fillRock(db, area.id, dug)).toBe(true);
    expect(
      isRock(get().hexes.find((h) => h.level === 0 && h.q === rock.q && h.r === rock.r)!),
    ).toBe(true);
    const top = get().hexes.find((h) => h.level === 0 && !isRock(h) && !h.placeId)!;
    expect(toggleShaft(db, area.id, top)).toBe(true);
    expect(toggleShaft(db, area.id, top)).toBe(false);
  });

  it('würfelt das Netz neu und behält, was an Feldern eingetragen ist', async () => {
    const { db, area, get } = await setup();
    const spot = get().hexes.find((h) => h.level === 0 && !isRock(h) && !h.placeId)!;
    db.patch('areas', area.id, {
      hexes: get().hexes.map((h) => (h === spot ? { ...h, prepared: 'Ein Hinterhalt' } : h)),
    });
    // Ein Gang von Hand in den Fels.
    const rock = get().hexes.find((h) => h.level === 0 && isRock(h) && !h.placeId)!;
    const next = get().hexes.find((h) => h.level === 0 && h.q === rock.q + 1 && h.r === rock.r)!;
    digBetween(db, area.id, rock, next, 'narrow');
    const undo = rerollArea(db, area.id)!;
    const kept = get().hexes.find((h) => h.level === 0 && h.q === spot.q && h.r === spot.r)!;
    expect(kept.prepared).toBe('Ein Hinterhalt');
    const stillDug = get().hexes.find((h) => h.level === 0 && h.q === rock.q && h.r === rock.r)!;
    expect(exitsOf(stillDug)).toContainEqual({ dir: 1, kind: 'narrow', found: false });
    // Eingetragenes (Notiz, Ort) friert keine Gänge ein – nur von Hand Gegrabenes bleibt.
    expect(kept.dug).toBe(false);
    // Kein Ort steht zweimal auf der Karte.
    const places = get().hexes.flatMap((h) => (h.placeId ? [h.placeId] : []));
    expect(new Set(places).size).toBe(places.length);
    undo();
    expect(get().seed).toBe(area.seed);
  });
});
