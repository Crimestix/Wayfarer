/**
 * Befehle rund um Wege: einen Weg anlegen, ändern, entfernen – und ihn gehen. Beim Gehen vergeht
 * die Weltzeit (Termine treten ein, Uhren laufen, Lichter brennen herunter), dann steht die Gruppe
 * am Ziel und der Wechsel in der Chronik.
 */
import {
  advanceTime,
  moveParty,
  sendOff,
  undoTimeAdvance,
  type TimeAdvanceResult,
} from '../../data/actions';
import { isSplit, isWholeLed } from '../../domain/party';
import type { CampaignDb } from '../../data/db';
import { routeMeans, describeVia, directWay, formatWayTime, type Route } from '../../domain/ways';
import {
  createPath,
  type ChronicleEntry,
  type PartyGroup,
  type TravelPath,
} from '../../domain/schema';
import { WAY_SORT_VALUES, sortOfWay, type WaySort } from '../../domain/wayState';
import { tradeAt } from '../laden/actions';
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
 *
 * Getrennte Wege: `who` sagt, wer geht (Vorgabe: die geleitete Teilgruppe). Geht nur ein Teil
 * von ihr, trennt er sich – nur seine Uhr rückt um den Weg vor, die anderen bleiben in ihrer Zeit
 * (`sendOff`). Bei getrennter Gruppe merkt sich die geleitete ihren Weg, damit die anderen zu
 * ihrer Zeit „unterwegs nach …“ sehen.
 */
export function walk(
  db: CampaignDb,
  toId: string,
  minutes: number,
  note = '',
  who: readonly string[] = [],
): WalkResult {
  const length = Math.max(0, Math.round(minutes));
  const data = db.getSnapshot();
  if (!isWholeLed(data, who)) {
    const sent = sendOff(db, who, toId, length, note);
    return {
      advance: sent.advance.occurred.length || sent.advance.steps.length ? sent.advance : null,
      entry: sent.entry,
      minutes: length,
      undo: sent.undo,
    };
  }
  return db.batch(() => {
    const start = db.getSnapshot().state.now;
    const advance = length > 0 ? advanceTime(db, start + length) : null;
    const entry = moveParty(db, toId, note);
    const state = db.getSnapshot().state;
    const leadId = state.leadId;
    const doingBefore = state.groups.find((group) => group.id === leadId)?.doing ?? null;
    const setDoing = (doing: PartyGroup['doing']) =>
      db.setState({
        groups: db
          .getSnapshot()
          .state.groups.map((group) => (group.id === leadId ? { ...group, doing } : group)),
      });
    const marked = !!entry && length > 0 && isSplit(db.getSnapshot());
    if (marked) setDoing({ entryId: entry.id, from: start, until: start + length });
    return {
      advance,
      entry,
      minutes: length,
      undo: () =>
        db.batch(() => {
          if (entry) undoMove(db, entry.id);
          if (advance) undoTimeAdvance(db);
          // Getrennte Wege: Ohne den Weg ist sie auch nicht mehr „unterwegs“.
          if (marked) setDoing(doingBefore);
        }),
    };
  });
}

/**
 * Die Gruppe geht eine Route durchs Wegenetz: „über Marktplatz · mit Seewind · 25 Min.“ steht in
 * der Chronik.
 */
export function walkRoute(db: CampaignDb, route: Route): WalkResult {
  const last = route.legs[route.legs.length - 1];
  if (!last) throw new Error('Die Route hat keinen Abschnitt.');
  const data = db.getSnapshot();
  const names = route.legs.map((leg) => leg.path.name).filter(Boolean);
  const means = routeMeans(route).map((mount) => mount.name);
  const note = [
    describeVia(data, route) || (names.length === 1 ? `über ${names[0]}` : ''),
    means.length ? `mit ${means.join(' und ')}` : '',
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

export interface CrossingInput {
  runId: string;
  /** Die gebuchte Fahrt nach Fahrplan (`Crossing.next` aus `domain/crossing.ts`). */
  departs: number;
  arrives: number;
  /** Was die Überfahrt kostet, frei; null = nichts bezahlt. */
  price: number | null;
  /** Wer bezahlt: ein Gefährte; null = die Gruppe. */
  payerId: string | null;
  /** Gleich mitfahren: Die Zeit bis zur Ankunft vergeht, dann ist die Gruppe am Ziel. */
  ride: boolean;
}

export interface CrossingResult {
  /** Der Handel in der Mitschrift (nur mit Preis). */
  entry: ChronicleEntry | null;
  walk: WalkResult | null;
  undo: () => void;
}

/**
 * Bucht eine Überfahrt mit einem Ablauf nach Fahrplan: Der Preis steht als Handel in der
 * Mitschrift (`tradeAt`); mit `ride` fährt die Gruppe mit – bis zur Ankunft der Fahrt vergeht die
 * Zeit (`walk`), Warten am Anleger eingeschlossen. Gibt `problem` zurück, wenn es den Ablauf
 * nicht mehr gibt oder die Fahrt schon abgefahren ist.
 */
export function bookCrossing(
  db: CampaignDb,
  input: CrossingInput,
): CrossingResult | { problem: string } {
  const data = db.getSnapshot();
  const run = data.runs[input.runId];
  if (!run) return { problem: 'Diesen Ablauf gibt es nicht mehr.' };
  const now = data.state.now;
  if (input.ride && input.departs < now) return { problem: 'Diese Fahrt ist schon abgefahren.' };
  const to = data.entities[run.toId]?.name ?? 'Unbekannt';
  return db.batch(() => {
    let entry: ChronicleEntry | null = null;
    let undoTrade = () => {};
    if (input.price !== null) {
      const traded = tradeAt(db, {
        direction: 'buy',
        toId: input.payerId,
        lines: [{ text: `Überfahrt nach ${to} (${run.name})`, price: Math.max(0, input.price) }],
      });
      if ('problem' in traded) return traded;
      entry = traded.entry;
      undoTrade = traded.undo;
    }
    const ride = input.ride
      ? walk(
          db,
          run.toId,
          input.arrives - now,
          [`mit ${run.name}`, formatWayTime(input.arrives - input.departs)].join(' · '),
        )
      : null;
    return {
      entry,
      walk: ride,
      undo: () =>
        db.batch(() => {
          ride?.undo();
          undoTrade();
        }),
    };
  });
}
