/**
 * Befehle der Wegenetze: ein Netz anlegen, Punkte setzen und verschieben, Wege ziehen – und eine
 * Strecke übernehmen, die als Text geschrieben ist. Orte und Wege entstehen dabei in der Welt
 * (`entities`, `paths`); das Netz merkt sich nur, welche Orte dazugehören und wo sie liegen.
 */
import type { CampaignDb } from '../../data/db';
import { freeSpot, placeNamed, planRoutes } from '../../domain/net';
import {
  createEntity,
  createNet,
  type Net,
  type NetPoint,
  type Place,
  type TravelPath,
} from '../../domain/schema';
import { directWay } from '../../domain/ways';
import { saveWay } from '../wege/actions';

/** Legt ein leeres Wegenetz an. */
export function addNet(db: CampaignDb, name = ''): Net {
  return db.put('nets', createNet({ name: name.trim() || 'Neues Wegenetz' }));
}

/** Ändert Name, Notiz oder die Art der Wege, die in diesem Netz neu entstehen. */
export function patchNet(
  db: CampaignDb,
  netId: string,
  change: Partial<Pick<Net, 'name' | 'note' | 'waySort'>>,
): void {
  if (!db.getSnapshot().nets[netId]) return;
  db.patch('nets', netId, {
    ...change,
    ...(change.name !== undefined ? { name: change.name.trim() || 'Wegenetz ohne Namen' } : {}),
  });
}

/** Löscht ein Wegenetz. Orte und Wege bleiben in der Welt. `undo` holt es zurück. */
export function removeNet(db: CampaignDb, netId: string): (() => void) | null {
  const net = db.getSnapshot().nets[netId];
  if (!net) return null;
  db.remove('nets', netId);
  return () => {
    if (!db.getSnapshot().nets[netId]) db.put('nets', { ...net, rev: 0 });
  };
}

const withPoints = (db: CampaignDb, netId: string, change: (points: NetPoint[]) => NetPoint[]) => {
  const net = db.getSnapshot().nets[netId];
  if (net) db.patch('nets', netId, { points: change([...net.points]) });
};

/**
 * Nimmt einen Ort als Punkt ins Netz – an die Stelle `at`, sonst rechts neben `afterId`, sonst in
 * eine neue Zeile. Steht er schon drin, geschieht nichts.
 */
export function addPoint(
  db: CampaignDb,
  netId: string,
  placeId: string,
  at?: { x: number; y: number } | null,
  afterId?: string | null,
): void {
  if (db.getSnapshot().entities[placeId]?.kind !== 'place') return;
  withPoints(db, netId, (points) => {
    if (points.some((point) => point.placeId === placeId)) return points;
    const after = afterId ? points.find((point) => point.placeId === afterId) : null;
    const spot = at ?? freeSpot(points, after);
    return [...points, { placeId, x: Math.round(spot.x), y: Math.round(spot.y) }];
  });
}

/** Verschiebt einen Punkt auf dem Blatt. */
export function movePoint(db: CampaignDb, netId: string, placeId: string, x: number, y: number) {
  withPoints(db, netId, (points) =>
    points.map((point) =>
      point.placeId === placeId ? { ...point, x: Math.round(x), y: Math.round(y) } : point,
    ),
  );
}

/** Nimmt einen Punkt aus dem Netz. Der Ort und seine Wege bleiben in der Welt. */
export function removePoint(db: CampaignDb, netId: string, placeId: string): (() => void) | null {
  const before = db.getSnapshot().nets[netId]?.points.find((point) => point.placeId === placeId);
  if (!before) return null;
  withPoints(db, netId, (points) => points.filter((point) => point.placeId !== placeId));
  return () =>
    withPoints(db, netId, (points) =>
      points.some((point) => point.placeId === placeId) ? points : [...points, before],
    );
}

/**
 * Verbindet zwei Punkte: Gibt es schon einen Weg zwischen ihnen, bleibt er; sonst entsteht einer,
 * dessen Dauer noch offen ist (oder `minutes`).
 */
export function connectPoints(
  db: CampaignDb,
  netId: string,
  fromId: string,
  toId: string,
  minutes: number | null = null,
): TravelPath | null {
  const data = db.getSnapshot();
  const net = data.nets[netId];
  if (!net || fromId === toId) return null;
  const existing = directWay(data, fromId, toId) ?? directWay(data, toId, fromId);
  if (existing) {
    // Eine Dauer, die jetzt dabeisteht, füllt eine offene – sie überschreibt nie eine eingetragene.
    if (minutes !== null && existing.path.minutes === null && existing.path.distanceKm === null)
      return db.patch('paths', existing.path.id, { minutes });
    return existing.path;
  }
  return saveWay(db, { fromId, toId, minutes, sort: net.waySort });
}

/** Der Ort zu einem Namen: der gemeinte, sonst ein neuer. */
function placeFor(db: CampaignDb, netId: string, name: string): { place: Place; fresh: boolean } {
  const data = db.getSnapshot();
  const found = placeNamed(data, data.nets[netId]!, name);
  if (found) return { place: found, fresh: false };
  const clean = name.replace(/\s+/g, ' ').trim();
  return {
    place: db.put('entities', createEntity({ kind: 'place', name: clean })) as Place,
    fresh: true,
  };
}

/**
 * Der nächste Punkt einer Strecke: legt den Ort an (oder nimmt den, der so heißt), setzt ihn
 * rechts neben `fromId` und verbindet beide.
 */
export function addNextPoint(
  db: CampaignDb,
  netId: string,
  fromId: string,
  name: string,
  minutes: number | null = null,
): { place: Place; path: TravelPath | null } | null {
  if (!name.trim() || !db.getSnapshot().nets[netId]) return null;
  return db.batch(() => {
    const { place } = placeFor(db, netId, name);
    addPoint(db, netId, place.id, null, fromId);
    return { place, path: connectPoints(db, netId, fromId, place.id, minutes) };
  });
}

export interface RoutesAdded {
  /** Orte, die neu in der Welt entstanden sind. */
  places: number;
  /** Punkte, die neu ins Netz kamen. */
  points: number;
  /** Wege, die neu entstanden sind. */
  ways: number;
  undo: () => void;
}

/**
 * Übernimmt Strecken, die als Text geschrieben sind (`parseRoutes`): Orte, die es schon gibt,
 * werden genommen; fehlende entstehen. Zwischen aufeinanderfolgenden Punkten entsteht ein Weg,
 * wenn es noch keinen gibt.
 */
export function addRoutes(db: CampaignDb, netId: string, text: string): RoutesAdded {
  const before = db.getSnapshot();
  const net = before.nets[netId];
  const out = { places: 0, points: 0, ways: 0 };
  if (!net) return { ...out, undo: () => {} };
  const madePlaces: string[] = [];
  const madeWays: string[] = [];
  db.batch(() => {
    for (const chain of planRoutes(before, net, text)) {
      let previous: string | null = null;
      for (const step of chain) {
        const { place, fresh } = placeFor(db, netId, step.name);
        if (fresh) madePlaces.push(place.id);
        const inNet = db.getSnapshot().nets[netId]!.points.some((p) => p.placeId === place.id);
        if (!inNet) {
          addPoint(db, netId, place.id, null, previous);
          out.points++;
        }
        if (previous && previous !== place.id) {
          const known = new Set(Object.keys(db.getSnapshot().paths));
          const path = connectPoints(db, netId, previous, place.id, step.minutes);
          if (path && !known.has(path.id)) madeWays.push(path.id);
        }
        previous = place.id;
      }
    }
  });
  out.places = madePlaces.length;
  out.ways = madeWays.length;
  const undo = () =>
    db.batch(() => {
      const now = db.getSnapshot();
      for (const id of madeWays) if (now.paths[id]) db.remove('paths', id);
      for (const id of madePlaces) if (now.entities[id]) db.remove('entities', id);
      if (now.nets[netId]) db.patch('nets', netId, { points: net.points });
    });
  return { ...out, undo };
}
