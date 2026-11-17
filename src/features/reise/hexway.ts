/**
 * Wegenetz, Hexkarte und Unterwegs greifen ineinander (Wunsch des Spielleiters, 17. 11.): Das
 * Wegenetz ist die Übersicht, eine Hexkarte das Gelände einer Verbindung („Gelände dazwischen“,
 * `path.areaId`), und Unterwegs reist einen solchen Weg Feld für Feld. Die Hexkarte wird einmal
 * erzeugt – mit einem Ausgangswert aus dem Weg, damit sie bei jedem Erzeugen gleich ausfällt.
 */
import type { CampaignDb } from '../../data/db';
import { hexKey, type HexCoord } from '../../domain/hex';
import type { JourneyPlan, LegPlan } from '../../domain/journey';
import { TRAVEL_HOURS } from '../../domain/march';
import { partyMeans } from '../../domain/mounts';
import { seedOf } from '../../domain/random';
import {
  createPath,
  type Area,
  type CampaignData,
  type Journey,
  type TravelPath,
} from '../../domain/schema';
import { DAY_KM } from '../../domain/terrain';
import { areaLine, generateArea, groundOf, recognize, suggestHexKm } from '../erkundung/generate';
import { hexMinutes, stepMinutes } from '../erkundung/travel';

/** Minuten je km zu Fuß im normalen Tempo. */
const MINUTES_PER_KM = (TRAVEL_HOURS * 60) / DAY_KM.normal;

/** Die Länge eines Weges in km: eingetragen, aus der Welt gelesen oder aus seiner Dauer. */
function wayKm(data: CampaignData, path: TravelPath): number | null {
  if (path.distanceKm) return path.distanceKm;
  const known = recognize(data, path.fromId, path.toId).distanceKm;
  if (known) return known;
  return path.minutes ? Math.max(1, Math.round(path.minutes / MINUTES_PER_KM)) : null;
}

/** Erzeugt die Hexkarte zwischen zwei Orten – gleicher Ausgangswert, gleiche Karte. */
function makeArea(
  data: CampaignData,
  fromId: string,
  toId: string,
  km: number,
  seedKey: string,
): Area {
  const known = recognize(data, fromId, toId);
  const hexKm = suggestHexKm(km);
  return generateArea(data, {
    fromId,
    toId,
    distanceKm: km,
    biome: known.biome,
    hexKm,
    seed: seedOf('weg', seedKey),
    direction: known.direction,
    between: known.between,
    ground: groundOf(data, known.origin, hexKm),
    route: known.route,
  });
}

/**
 * „Gelände dazwischen“: die Hexkarte eines Weges – die vorhandene, sonst wird sie erzeugt und am
 * Weg festgehalten. null, wenn die Länge des Weges nicht bekannt ist.
 */
export function hexMapForWay(db: CampaignDb, pathId: string): Area | null {
  const data = db.getSnapshot();
  const path = data.paths[pathId];
  if (!path) return null;
  const existing = path.areaId ? data.areas[path.areaId] : undefined;
  if (existing) return existing;
  const km = wayKm(data, path);
  if (!km || km > 5000) return null;
  return db.batch(() => {
    const area = db.put('areas', makeArea(data, path.fromId, path.toId, km, path.id));
    db.patch('paths', path.id, { areaId: area.id, distanceKm: path.distanceKm ?? Math.round(km) });
    return area;
  });
}

/**
 * Eine freie Strecke bekommt einen Weg mit Hexkarte: Danach ist sie Teil des Wegenetzes und wird
 * Feld für Feld gereist. Gibt den Weg zurück – null, wenn die Länge fehlt.
 */
export function wayWithHexMap(
  db: CampaignDb,
  fromId: string,
  toId: string,
  km: number,
): TravelPath | null {
  if (!km || km > 5000) return null;
  return db.batch(() => {
    const path = db.put('paths', createPath({ fromId, toId, distanceKm: Math.round(km) }));
    const area = db.put('areas', makeArea(db.getSnapshot(), fromId, toId, km, path.id));
    return db.patch('paths', path.id, { areaId: area.id }) ?? path;
  });
}

/**
 * Die Felder eines Abschnitts auf der Hexkarte seines Weges, mit den Minuten ab Beginn. In
 * Gegenrichtung gegangen, läuft die Linie rückwärts. Schwieriges Gelände der Gegend verdoppelt.
 */
export function hexTrail(
  data: CampaignData,
  area: Area,
  reverse: boolean,
  slow: boolean,
): { hexes: { q: number; r: number; at: number }[]; minutes: number } {
  const line = areaLine(area);
  const ordered: HexCoord[] = reverse ? [...line].reverse() : line;
  const byKey = new Map(area.hexes.map((hex) => [hexKey(hex), hex]));
  const by = partyMeans(data);
  let at = 0;
  const hexes = ordered.map((coord, index) => {
    if (index > 0) {
      const hex = byKey.get(hexKey(coord));
      // Gemalte Gegend und Straße zählen (`stepMinutes`); ohne eigene Gegend gilt die des Weges.
      const own = hex ? stepMinutes(data, area, hex, 'normal', by) : null;
      const step = own ?? hexMinutes(area.hexKm, hex?.terrain ?? null, 'normal', by) ?? 0;
      at += step * (slow && !hex?.regionId && hex?.road === 'none' ? 2 : 1);
    }
    return { q: coord.q, r: coord.r, at: Math.round(at) };
  });
  return { hexes, minutes: Math.round(at) };
}

/** Nimmt in einen Reiseplan die Hexkarten der Wege auf: Solche Abschnitte gehen Feld für Feld. */
export function withHexes(data: CampaignData, plan: JourneyPlan): JourneyPlan {
  const legs = plan.legs.map((leg): LegPlan => {
    const path = leg.pathId ? data.paths[leg.pathId] : undefined;
    const area = path?.areaId ? data.areas[path.areaId] : undefined;
    if (!area) return leg;
    const trail = hexTrail(data, area, leg.reverse, leg.slow);
    if (trail.hexes.length < 2 || trail.minutes <= 0) return leg;
    // Eine feste Dauer am Weg gilt weiter; die Felder teilen sie dann gleichmäßig auf.
    const fixed = path?.minutes ?? null;
    const scale = fixed ? fixed / trail.minutes : 1;
    return {
      ...leg,
      areaId: area.id,
      hexes: trail.hexes.map((hex) => ({ ...hex, at: Math.round(hex.at * scale) })),
      minutes: fixed ?? trail.minutes,
    };
  });
  return { ...plan, legs, minutes: legs.reduce((sum, leg) => sum + leg.minutes, 0) };
}

/** Das Feld, auf dem die Reise gerade steht (letztes erreichtes Feld des Abschnitts). */
export function hexAtProgress(
  journey: Journey,
): { areaId: string; hex: HexCoord; passed: HexCoord[] } | null {
  const leg = journey.legs[journey.progress.leg];
  if (!leg?.areaId || !leg.hexes.length) return null;
  const passed = leg.hexes.filter((hex) => hex.at <= journey.progress.minutes);
  const hex = passed[passed.length - 1] ?? leg.hexes[0]!;
  return { areaId: leg.areaId, hex: { q: hex.q, r: hex.r }, passed };
}
