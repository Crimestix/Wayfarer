/**
 * Befehle rund um Wege: einen Weg anlegen, ändern, entfernen – und ihn gehen. Beim Gehen vergeht
 * die Weltzeit (Termine treten ein, Uhren laufen, Lichter brennen herunter), dann steht die Gruppe
 * am Ziel und der Wechsel in der Chronik.
 */
import {
  advanceTime,
  moveParty,
  undoTimeAdvance,
  type TimeAdvanceResult,
} from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import { createPath, type ChronicleEntry, type TravelPath } from '../../domain/schema';
import { describeVia, directWay, formatWayTime, type Route } from '../../domain/ways';
import { WAY_SORT_VALUES, sortOfWay, type WaySort } from '../../domain/wayState';
import { undoMove } from '../tisch/commands';

export interface WayInput {
  /** Vorhandenen Weg ändern; ohne Angabe entsteht ein neuer. */
  id?: string;
  fromId: string;
  toId: string;
  name?: string;
  /** Feste Dauer in Minuten; null = aus der Länge rechnen. */
  minutes: number | null;
  distanceKm?: number | null;
  conditions?: string;
  oneWay?: boolean;
  secret?: boolean;
  /** Was für ein Weg das ist; ohne Angabe bleibt ein vorhandener, wie er ist. */
  sort?: WaySort;
}

/** Legt einen Weg an oder ändert ihn. */
export function saveWay(db: CampaignDb, input: WayInput): TravelPath {
  const values = {
    fromId: input.fromId,
    toId: input.toId,
    name: input.name?.trim() ?? '',
    minutes: input.minutes === null ? null : Math.max(0, Math.round(input.minutes)),
    distanceKm: input.distanceKm ?? null,
    conditions: input.conditions?.trim() ?? '',
    oneWay: input.oneWay ?? false,
    secret: input.secret ?? false,
  };
  const existing = input.id ? db.getSnapshot().paths[input.id] : undefined;
  // Die Art nur ändern, wenn sie wirklich eine andere ist: Gelände von der Karte bleibt sonst.
  const sort =
    input.sort && (!existing || sortOfWay(existing) !== input.sort)
      ? WAY_SORT_VALUES[input.sort]
      : {};
  if (existing) return db.patch('paths', existing.id, { ...values, ...sort });
  // Ohne Angabe ist ein neuer Weg eine Gasse: Das Wetter ändert nichts an ihm.
  return db.put('paths', createPath({ ...values, terrain: 'urban', ...sort }));
}

/** Entfernt einen Weg. `undo` legt ihn wieder an. */
export function removeWay(db: CampaignDb, id: string): (() => void) | null {
  const path = db.getSnapshot().paths[id];
  if (!path) return null;
  db.remove('paths', id);
  return () => {
    if (!db.getSnapshot().paths[id]) db.put('paths', path);
  };
}

export interface WalkResult {
  /** Was in der Zeit unterwegs eingetreten ist; null, wenn keine Zeit verging. */
  advance: TimeAdvanceResult | null;
  /** Der Ortswechsel in der Chronik; null, wenn die Gruppe schon dort war. */
  entry: ChronicleEntry | null;
  minutes: number;
  undo: () => void;
}

/**
 * Die Gruppe geht zu einem Ort: Erst vergeht die Zeit des Weges, dann kommt sie an. `note` steht
 * am Ortswechsel in der Chronik.
 */
export function walk(db: CampaignDb, toId: string, minutes: number, note = ''): WalkResult {
  const length = Math.max(0, Math.round(minutes));
  return db.batch(() => {
    const advance = length > 0 ? advanceTime(db, db.getSnapshot().state.now + length) : null;
    const entry = moveParty(db, toId, note);
    return {
      advance,
      entry,
      minutes: length,
      undo: () => {
        if (entry) undoMove(db, entry.id);
        if (advance) undoTimeAdvance(db);
      },
    };
  });
}

/** Die Gruppe geht eine Route durchs Wegenetz: „über Marktplatz · 25 Min.“ steht in der Chronik. */
export function walkRoute(db: CampaignDb, route: Route): WalkResult {
  const last = route.legs[route.legs.length - 1];
  if (!last) throw new Error('Die Route hat keinen Abschnitt.');
  const data = db.getSnapshot();
  const names = route.legs.map((leg) => leg.path.name).filter(Boolean);
  const note = [
    describeVia(data, route) || (names.length === 1 ? `über ${names[0]}` : ''),
    route.minutes > 0 ? formatWayTime(route.minutes) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return walk(db, route.toId, route.minutes, note);
}

/**
 * Merkt sich die Dauer zwischen zwei Orten als Weg, falls es noch keinen direkten gibt – damit sie
 * beim nächsten Mal und auf dem Rückweg schon da ist.
 */
export function rememberWay(
  db: CampaignDb,
  fromId: string,
  toId: string,
  minutes: number,
): TravelPath | null {
  if (minutes <= 0 || fromId === toId) return null;
  if (directWay(db.getSnapshot(), fromId, toId)) return null;
  return saveWay(db, { fromId, toId, minutes });
}
