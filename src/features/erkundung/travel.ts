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
import { hexDistance, hexKey, sameHex, type HexCoord } from '../../domain/hex';
import {
  PASSAGE_FACTOR,
  VERTICAL_MINUTES,
  cellKey,
  cheapestPath,
  dirTo,
  indexHexes,
  isRock,
  passageBetween,
  passagesFrom,
  type Passage,
} from '../../domain/passages';
import { carries, ignoresGround, meansKmh, partyMeans } from '../../domain/mounts';
import { rngOf, seedOf } from '../../domain/random';
import { sensesAt, type Sense } from '../../domain/senses';
import { markSighted, newSightings, type Sighting } from '../../domain/afar';
import { isNightAt, meetingLine, meetingOf, pickRow } from '../../domain/roaming';
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

/**
 * Die Felder, die die Gruppe von `at` aus sieht (`sightRadius`). Unter der Erde sieht man nicht
 * durch Fels: nur entlang der Gänge, so weit das Licht reicht.
 */
export function seenFrom(data: CampaignData, area: Pick<Area, 'hexes'>, at: HexCoord): Set<string> {
  const here = area.hexes.find((hex) => sameHex(hex, at));
  const radius = here ? sightRadius(data, here) : 1;
  if (!here || here.exits === null)
    return new Set(
      area.hexes
        .filter((hex) => hex.level === (at.level ?? 0) && hexDistance(hex, at) <= radius)
        .map((hex) => hexKey(hex)),
    );
  const index = indexHexes(area.hexes);
  const seen = new Set([cellKey(here)]);
  let ring: Hex[] = [here];
  for (let step = 0; step < radius; step++) {
    const next: Hex[] = [];
    for (const hex of ring)
      for (const passage of passagesFrom(index, hex)) {
        const key = cellKey(passage.to);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(passage.to);
      }
    ring = next;
  }
  return seen;
}

const find = (area: Pick<Area, 'hexes'>, coord: HexCoord): Hex | undefined =>
  area.hexes.find((hex) => sameHex(hex, coord));

/** Das Feld, auf dem die Gruppe steht. */
export const partyHex = (area: Area): Hex | undefined =>
  area.party ? find(area, area.party) : undefined;

/**
 * Die Minuten für einen Durchgang: das Feld dahinter nach Gelände, Straße und Gegend
 * (`stepMinutes`), mal der Art des Durchgangs (Engstelle, Kletterei, Wasser doppelt). Ein Schacht
 * hinauf oder hinab bleibt im selben Feld und kostet eine Stunde (ein Abbruch eine Viertelstunde).
 */
export function passageMinutes(
  data: CampaignData,
  area: Pick<Area, 'hexKm'>,
  passage: Passage,
  pace: Pace,
  by: Mount | null = null,
): number | null {
  if (passage.dir >= 6)
    return passage.kind === 'drop' ? 15 : VERTICAL_MINUTES * PASSAGE_FACTOR[passage.kind];
  const base = stepMinutes(data, area, passage.to, pace, by);
  return base === null ? null : base * PASSAGE_FACTOR[passage.kind];
}

export type StepProblem = 'no-party' | 'not-adjacent' | 'off-map' | 'impassable' | 'wall';

export const STEP_PROBLEM: Record<StepProblem, string> = {
  'no-party': 'Die Gruppe steht noch nicht auf dieser Karte.',
  'not-adjacent': 'Das Feld grenzt nicht an das Feld der Gruppe.',
  'off-map': 'Dort endet die Karte.',
  impassable: 'Wasser lässt sich zu Fuß nicht durchqueren – mit einem Schiff oder Boot schon.',
  wall: 'Dorthin führt kein Gang.',
};

/**
 * Warum die Gruppe ein Feld nicht in einem Schritt erreicht – oder null, wenn es geht. Mit einem
 * Schiff (`by`) ist Wasser kein Hindernis.
 */
export function stepProblem(area: Area, to: HexCoord, by: Mount | null = null): StepProblem | null {
  if (!area.party) return 'no-party';
  const target = find(area, to);
  if (!target) return 'off-map';
  const here = partyHex(area);
  if (!here || dirTo(here, target) === null) return 'not-adjacent';
  if (isRock(target) || !passageBetween(indexHexes(area.hexes), here, target)) return 'wall';
  if (hexMinutes(area.hexKm, target.terrain, area.party.pace, by) === null) return 'impassable';
  return null;
}

export interface Encounter {
  table: RollTable;
  /** Wurf der Begegnungsprüfung (W20) – null, wenn die Tabelle keine Prüfung verlangt. */
  check: number | null;
  /** Aus wie vielen Zeilen gewählt wurde (nach Tageszeit). */
  from: number;
  /** Die Zeile mit Anzahl, Spuren und Bau aus dem Bestiarium, als ein Satz. */
  text: string;
  refs: string[];
}

/**
 * Wählt auf den Tabellen, die für ein Feld gelten (die des Feldes, sonst die des Gebiets), eine
 * Zeile nach Häufigkeit – oben nach Tageszeit, unter der Erde nicht. Wiederholbar: Derselbe
 * Schritt zur selben Weltzeit ergibt dasselbe. Verlangt eine Tabelle eine Prüfung, kommt es nur
 * bei einem W20-Wurf ab ihrer Schwierigkeit zu einem Ergebnis.
 */
export function rollEncounters(data: CampaignData, area: Area, hex: Hex, at: number): Encounter[] {
  const ids = hex.tableIds.length ? hex.tableIds : area.tableIds;
  const night = hex.exits !== null || hex.terrain === 'underdark' ? null : isNightAt(at);
  const out: Encounter[] = [];
  for (const id of ids) {
    const table = data.tables[id];
    if (!table || !table.entries.length) continue;
    const rng = rngOf(seedOf(area.seed ?? 0, area.id, table.id, hex.q, hex.r, at));
    const roll = (sides: number) => rng.int(1, sides);
    const check = table.dc === null ? null : rng.int(1, 20);
    if (check !== null && check < table.dc!) continue;
    const picked = pickRow(data, table, roll, night);
    if (!picked) continue;
    const meeting = meetingOf(data, picked.row, hex.regionId ?? table.placeId, roll);
    out.push({
      table,
      check,
      from: picked.from,
      text: meetingLine(meeting),
      refs: picked.row.refs,
    });
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
  /** Witterung: was die Gruppe von den Feldern ringsum bemerkt (`sensesAt`). */
  senses: Sense[];
  /** Was mit diesem Schritt zum ersten Mal in der Ferne auftauchte (`domain/afar.ts`). */
  sighted: Sighting[];
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
  const passage = passageBetween(indexHexes(area.hexes), partyHex(area)!, target)!;
  const pace = effectivePace(target.terrain, party.pace) ?? party.pace;
  const minutes =
    passageMinutes(data, area, passage, party.pace, by) ??
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
  // Was von hier aus zum ersten Mal in der Ferne auftaucht.
  const sighted = newSightings({ hexes }, [to]);
  const marked = markSighted(hexes, [to]);
  const trail = [...party.trail, { q: party.q, r: party.r, level: party.level }].slice(-400);
  const moved: Area = {
    ...area,
    hexes: marked,
    party: {
      ...party,
      q: to.q,
      r: to.r,
      level: target.level,
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
    senses: sensesAt(data, moved, target, party),
    sighted,
  };
}

/**
 * Wie lange es dauert, ein Feld zu durchsuchen: so lange, wie es zu Fuß im normalen Tempo zu
 * durchqueren (`stepMinutes` – Gelände, Straße, langsame Gegend). Ein Feld voll Wasser lässt sich
 * nicht durchsuchen (null).
 */
export function searchMinutes(
  data: CampaignData,
  area: Pick<Area, 'hexKm'>,
  hex: Pick<Hex, 'terrain' | 'road' | 'regionId'>,
): number | null {
  if (hex.terrain === 'water') return null;
  return stepMinutes(data, area, { ...hex, road: 'none' }, 'normal');
}

export interface SearchPlan {
  hex: Hex;
  minutes: number;
  /** Was verborgen lag – null, wenn dort nichts ist (die Spieler erfahren nur: nichts gefunden). */
  found: string | null;
  /** Begegnungen während der Suche: einmal auf den Tabellen des Feldes gewürfelt. */
  encounters: Encounter[];
}

/**
 * Die Gruppe durchsucht ihr Feld, beginnend zur Weltzeit `now`. Ändert nichts – geschrieben wird
 * über `searchHex` (`actions.ts`).
 */
export function planSearch(data: CampaignData, area: Area, now: number): SearchPlan | null {
  const hex = partyHex(area);
  if (!hex) return null;
  const minutes = searchMinutes(data, area, hex);
  if (minutes === null) return null;
  return {
    hex,
    minutes,
    found: hex.hidden.trim() || null,
    encounters: rollEncounters(data, area, hex, now + minutes),
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
  const pace = area.party.pace;
  const found = cheapestPath(indexHexes(area.hexes), area.party, goal, (passage) => {
    const minutes = hexMinutes(area.hexKm, passage.to.terrain, pace, by);
    if (minutes === null) return null;
    if (passage.dir >= 6) return passage.kind === 'drop' ? 15 : VERTICAL_MINUTES;
    // Bei gleicher Zeit lieber durch Gelände, das schneller sein könnte (ein Hauch Aufschlag).
    const limit = passage.to.terrain ? TERRAIN_MAX_PACE[passage.to.terrain] : 'fast';
    return minutes * PASSAGE_FACTOR[passage.kind] + (limit === 'fast' ? 0 : 0.001);
  });
  if (!found) return null;
  return {
    steps: found.steps.map((hex) => ({ q: hex.q, r: hex.r, level: hex.level })),
    minutes: Math.round(found.cost),
  };
}
