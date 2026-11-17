/**
 * Reisen auf der Hexkarte – reine Funktionen: wie lange ein Schritt dauert, was die Gruppe dabei
 * entdeckt, wann sie ankommt und wann aus der Reise ein Gewaltmarsch wird.
 *
 * Regeln nach D&D 2024: Reisetempo 2, 3 oder 4 Meilen je Stunde (langsam, normal, schnell) bei
 * acht Stunden Reise am Tag; jede weitere Stunde ist ein Gewaltmarsch. Das Gelände begrenzt,
 * wie schnell es höchstens vorangeht.
 */
import { groundOf as journeyGround } from '../../domain/journey';
import { lightStatus } from '../../domain/underground';
import { hexDistance, hexKey, hexNeighbors, type HexCoord } from '../../domain/hex';
import { carries, ignoresGround, meansKmh, partyMeans } from '../../domain/mounts';
import { rngOf, seedOf } from '../../domain/random';
import type { Area, CampaignData, Hex, Mount, Pace, RollTable, Terrain } from '../../domain/schema';
import { DAY_KM } from '../../domain/terrain';
import { dayIndexOf } from '../../domain/time/calendar';
import {
  TRAVEL_HOURS,
  forcedMarch,
  marchedMinutes,
  recentLegs,
  type ForcedMarch,
} from '../../domain/march';

export { TRAVEL_HOURS, forcedMarch, type ForcedMarch } from '../../domain/march';

/**
 * Das höchste Tempo, das ein Gelände zulässt (Regelwerk 2024, Reisen nach Gelände); null = zu
 * Fuß nicht zu durchqueren. Ohne eingetragenes Gelände gilt freies Feld.
 */
export const TERRAIN_MAX_PACE: Record<Terrain, Pace | null> = {
  grassland: 'fast',
  arctic: 'fast',
  coast: 'normal',
  desert: 'normal',
  forest: 'normal',
  hills: 'normal',
  underdark: 'normal',
  urban: 'normal',
  mountains: 'slow',
  swamp: 'slow',
  water: null,
};

const PACE_ORDER: Pace[] = ['slow', 'normal', 'fast'];

/** Das Tempo, mit dem die Gruppe ein Feld tatsächlich durchquert; null = unpassierbar. */
export function effectivePace(terrain: Terrain | null, pace: Pace): Pace | null {
  const limit = terrain ? TERRAIN_MAX_PACE[terrain] : 'fast';
  if (limit === null) return null;
  return PACE_ORDER[Math.min(PACE_ORDER.indexOf(pace), PACE_ORDER.indexOf(limit))]!;
}

const round5 = (minutes: number) => Math.max(5, Math.round(minutes / 5) * 5);

/**
 * Minuten, um ein Feld zu durchqueren, auf fünf Minuten gerundet; null = unpassierbar. Mit einem
 * Fortbewegungsmittel (`by`, `domain/mounts.ts`), wo es das Feld trägt: ein Schiff auf dem
 * Wasser, Fliegendes überall (beide ohne Rücksicht aufs Gelände), ein Reittier mit eigenem Tempo
 * an Land – dort begrenzt das Gelände weiter das Tempo.
 */
export function hexMinutes(
  hexKm: number,
  terrain: Terrain | null,
  pace: Pace,
  by: Mount | null = null,
): number | null {
  const used = by && carries(by, { terrain: terrain ?? 'grassland' }) ? by : null;
  const actual = effectivePace(terrain, pace);
  if (used && ignoresGround(used)) {
    // Ohne eingetragenes Tempo so schnell wie die Gruppe im normalen Tempo.
    const kmh = meansKmh(used, pace) ?? DAY_KM.normal / TRAVEL_HOURS;
    return round5((hexKm / kmh) * 60);
  }
  if (!actual) return null;
  const kmPerHour = (used && meansKmh(used, actual)) ?? DAY_KM[actual] / TRAVEL_HOURS;
  return round5((hexKm / kmPerHour) * 60);
}

/**
 * Die Minuten für einen Schritt auf ein Feld, mit dem, was der Spielleiter gemalt hat: Auf einer
 * Straße oder einem Pfad geht es im Tempo offenen Landes; in einer Gegend, die schwer zu
 * durchqueren ist (`groundOf`), doppelt so lange – außer auf der Straße. null = unpassierbar.
 */
export function stepMinutes(
  data: CampaignData,
  area: Pick<Area, 'hexKm'>,
  hex: Pick<Hex, 'terrain' | 'road' | 'regionId'>,
  pace: Pace,
  by: Mount | null = null,
): number | null {
  const onRoad = hex.road !== 'none' && hex.terrain !== 'water';
  const base = hexMinutes(area.hexKm, onRoad ? 'grassland' : hex.terrain, pace, by);
  if (base === null) return null;
  const slow = !onRoad && !!hex.regionId && !!journeyGround(data, hex.regionId)?.slow;
  return slow ? base * 2 : base;
}

/**
 * Wie weit die Gruppe von einem Feld aus sieht – so viele Ringe von Feldern gelten als entdeckt:
 * von Bergen drei, von Hügeln zwei, im offenen Land eins, im Wald und Sumpf nur das eigene Feld.
 * Unter der Erde hängt es am Licht (`lightStatus`): ohne Licht nur das eigene Feld.
 */
export function sightRadius(data: CampaignData, hex: Pick<Hex, 'terrain'>): number {
  switch (hex.terrain) {
    case 'mountains':
      return 3;
    case 'hills':
      return 2;
    case 'forest':
    case 'swamp':
      return 0;
    case 'underdark':
      return lightStatus(data)?.state === 'dark' ? 0 : 1;
    default:
      return 1;
  }
}

/** Die Felder, die die Gruppe von `at` aus sieht (`sightRadius`). */
export function seenFrom(data: CampaignData, area: Pick<Area, 'hexes'>, at: HexCoord): Set<string> {
  const here = area.hexes.find((hex) => hex.q === at.q && hex.r === at.r);
  const radius = here ? sightRadius(data, here) : 1;
  return new Set(
    area.hexes.filter((hex) => hexDistance(hex, at) <= radius).map((hex) => hexKey(hex)),
  );
}

const find = (area: Area, coord: HexCoord): Hex | undefined =>
  area.hexes.find((hex) => hex.q === coord.q && hex.r === coord.r);

export type StepProblem = 'no-party' | 'not-adjacent' | 'off-map' | 'impassable';

export const STEP_PROBLEM: Record<StepProblem, string> = {
  'no-party': 'Die Gruppe steht noch nicht auf dieser Karte.',
  'not-adjacent': 'Das Feld grenzt nicht an das Feld der Gruppe.',
  'off-map': 'Dort endet die Karte.',
  impassable: 'Wasser lässt sich zu Fuß nicht durchqueren – mit einem Schiff oder Boot schon.',
};

/**
 * Warum die Gruppe ein Feld nicht in einem Schritt erreicht – oder null, wenn es geht. Mit einem
 * Schiff (`by`) ist Wasser kein Hindernis.
 */
export function stepProblem(area: Area, to: HexCoord, by: Mount | null = null): StepProblem | null {
  if (!area.party) return 'no-party';
  const target = find(area, to);
  if (!target) return 'off-map';
  if (hexDistance(area.party, to) !== 1) return 'not-adjacent';
  if (hexMinutes(area.hexKm, target.terrain, area.party.pace, by) === null) return 'impassable';
  return null;
}

export interface Encounter {
  table: RollTable;
  /** Wurf der Begegnungsprüfung (W20) – null, wenn die Tabelle keine Prüfung verlangt. */
  check: number | null;
  /** Wurf auf der Tabelle. */
  roll: number;
  text: string;
  refs: string[];
}

/**
 * Würfelt auf den Tabellen, die für ein Feld gelten (die des Feldes, sonst die des Gebiets).
 * Wiederholbar: Derselbe Schritt zur selben Weltzeit ergibt dasselbe. Verlangt eine Tabelle
 * eine Prüfung, kommt es nur bei einem W20-Wurf ab ihrer Schwierigkeit zu einem Ergebnis.
 */
export function rollEncounters(data: CampaignData, area: Area, hex: Hex, at: number): Encounter[] {
  const ids = hex.tableIds.length ? hex.tableIds : area.tableIds;
  const out: Encounter[] = [];
  for (const id of ids) {
    const table = data.tables[id];
    if (!table || !table.entries.length) continue;
    const rng = rngOf(seedOf(area.seed ?? 0, area.id, table.id, hex.q, hex.r, at));
    const check = table.dc === null ? null : rng.int(1, 20);
    if (check !== null && check < table.dc!) continue;
    const roll = rng.int(1, table.die);
    const entry = table.entries.find((e) => roll >= e.min && roll <= e.max);
    if (!entry || !entry.text.trim()) continue;
    out.push({ table, check, roll, text: entry.text.trim(), refs: entry.refs });
  }
  return out;
}

export interface TravelStep {
  /** Das Gebiet nach dem Schritt: neue Stellung, entdeckte Felder. */
  area: Area;
  target: Hex;
  minutes: number;
  /** Das Tempo, das das Gelände zugelassen hat. */
  pace: Pace;
  /** Die Gruppe wurde vom Gelände gebremst. */
  slowed: boolean;
  /** Reisezeit seit der letzten Langen Rast nach dem Schritt, in Minuten (Wege und Hexkarten). */
  marched: number;
  march: ForcedMarch | null;
  /** Felder, die mit diesem Schritt neu ins Blickfeld kamen. */
  revealed: number;
  /** Ein Ort auf dem Zielfeld – dort kommt die Gruppe an. */
  arrivedAt: string | null;
  encounters: Encounter[];
}

/**
 * Ein Schritt auf ein Nachbarfeld, beginnend zur Weltzeit `now`. Die Gruppe entdeckt das Feld,
 * das sie betritt, und sieht die Felder ringsum. Ändert nichts – das Ergebnis schreibt der
 * Befehl in `actions.ts`.
 */
export function planStep(
  data: CampaignData,
  area: Area,
  to: HexCoord,
  now: number,
): TravelStep | StepProblem {
  // Womit die Gruppe reist (`state.travelBy`) – ein Schiff trägt sie übers Wasser.
  const by = partyMeans(data);
  const problem = stepProblem(area, to, by);
  if (problem) return problem;
  const party = area.party!;
  const target = find(area, to)!;
  const pace = effectivePace(target.terrain, party.pace) ?? party.pace;
  const minutes =
    stepMinutes(data, area, target, party.pace, by) ??
    hexMinutes(area.hexKm, target.terrain, party.pace, by)!;
  const arrival = now + minutes;
  // Der Tag des Schritts und seine Minuten bleiben für ältere Fassungen des Programms stehen.
  const today = party.day === dayIndexOf(arrival) && dayIndexOf(arrival) === dayIndexOf(now);
  const legs = [...recentLegs(party.legs, arrival), { at: arrival, minutes }];

  const seen = new Set([hexKey(to), ...seenFrom(data, area, to)]);
  let revealed = 0;
  const hexes = area.hexes.map((hex) => {
    if (hex.discovered || !seen.has(hexKey(hex))) return hex;
    revealed++;
    return { ...hex, discovered: true };
  });
  const trail = [...party.trail, { q: party.q, r: party.r }].slice(-400);
  const moved: Area = {
    ...area,
    hexes,
    party: {
      ...party,
      q: to.q,
      r: to.r,
      day: dayIndexOf(arrival),
      minutes: (today ? party.minutes : 0) + minutes,
      trail,
      legs,
    },
  };
  // Seit der letzten Langen Rast gereist – über Wege und alle Hexkarten, mit diesem Schritt.
  const marched = marchedMinutes(data, arrival, moved);
  return {
    area: moved,
    target,
    minutes,
    pace,
    slowed: pace !== party.pace,
    marched,
    march: forcedMarch(marched),
    revealed,
    arrivedAt: target.placeId && data.entities[target.placeId] ? target.placeId : null,
    encounters: rollEncounters(data, area, target, arrival),
  };
}

/** Das Feld, auf dem ein Ort liegt. */
export function hexOfPlace(area: Area, placeId: string | null): Hex | undefined {
  return placeId ? area.hexes.find((hex) => hex.placeId === placeId) : undefined;
}

export interface Route {
  /** Die Felder des Wegs ab dem ersten Schritt, das Ziel eingeschlossen. */
  steps: HexCoord[];
  /** Reisezeit in Minuten beim Tempo der Gruppe. */
  minutes: number;
}

/**
 * Der schnellste Weg von der Stellung der Gruppe zu einem Feld: über Land, um Wasser herum,
 * durch schnelles Gelände lieber als durch langsames. Null, wenn die Gruppe nicht auf der Karte
 * steht oder kein Weg hinführt; ein leerer Weg, wenn sie schon dort ist.
 */
export function routeTo(area: Area, goal: HexCoord, by: Mount | null = null): Route | null {
  if (!area.party) return null;
  const byKey = new Map(area.hexes.map((hex) => [hexKey(hex), hex]));
  const goalKey = hexKey(goal);
  const startKey = hexKey(area.party);
  if (!byKey.has(goalKey) || !byKey.has(startKey)) return null;
  const cost = new Map<string, number>([[startKey, 0]]);
  const from = new Map<string, string>();
  const open = new Set([startKey]);
  const done = new Set<string>();
  while (open.size) {
    // Das nächstgelegene offene Feld; bei Karten dieser Größe genügt die einfache Suche.
    let current = '';
    let best = Infinity;
    for (const key of open) {
      const value = cost.get(key)!;
      if (value < best || (value === best && key < current)) [current, best] = [key, value];
    }
    if (current === goalKey) break;
    open.delete(current);
    done.add(current);
    for (const coord of hexNeighbors(byKey.get(current)!)) {
      const key = hexKey(coord);
      const hex = byKey.get(key);
      if (!hex || done.has(key)) continue;
      const minutes = hexMinutes(area.hexKm, hex.terrain, area.party.pace, by);
      if (minutes === null) continue;
      const total = best + minutes;
      if (total < (cost.get(key) ?? Infinity)) {
        cost.set(key, total);
        from.set(key, current);
        open.add(key);
      }
    }
  }
  if (!cost.has(goalKey)) return null;
  const steps: HexCoord[] = [];
  for (let key = goalKey; key !== startKey; key = from.get(key)!) {
    const hex = byKey.get(key)!;
    steps.unshift({ q: hex.q, r: hex.r });
  }
  return { steps, minutes: cost.get(goalKey)! };
}
