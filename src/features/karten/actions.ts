/**
 * Befehle des Bereichs „Karten“: eine Karte anlegen, Gelände malen, Linien ziehen, Orte setzen.
 * Jeder Befehl gibt zurück, wie er sich zurücknehmen lässt.
 */
import type { CampaignDb } from '../../data/db';
import { markerNear, simplify } from '../../domain/mapDraw';
import {
  createMap,
  createPath,
  newId,
  type GameMap,
  type MapGround,
  type MapLine,
  type MapStroke,
} from '../../domain/schema';

/** Breite einer neuen Karte in Karteneinheiten; die Höhe folgt dem Seitenverhältnis 10 : 7. */
export const SHEET = { width: 1000, height: 700 } as const;
/** So nah muss das Ende einer Linie an einem Ort liegen, um an ihm anzudocken. */
export const SNAP = 16;

type Undo = () => void;

export interface NewMap {
  name: string;
  /** Wie viele Kilometer die Karte von West nach Ost zeigt. */
  widthKm: number;
  placeId: string | null;
  level: GameMap['level'];
  /** Das Gelände, wo nichts gemalt ist – Wasser für eine Insel, Ebene für ein Binnenland. */
  ground: MapGround;
}

const scaleOf = (widthKm: number, width: number) => ({
  kmPerUnit: Math.max(0.001, widthKm) / width,
  calibration: null,
});

/** Legt eine leere Karte zum Zeichnen an. */
export function createDrawnMap(db: CampaignDb, input: NewMap): GameMap {
  return db.put(
    'maps',
    createMap({
      name: input.name.trim() || 'Neue Karte',
      kind: 'drawn',
      level: input.level,
      ground: input.ground,
      placeId: input.placeId,
      frame: { ...SHEET },
      scale: scaleOf(input.widthKm, SHEET.width),
    }),
  );
}

/** Ändert Namen, Ort, Breite, Grund und Ebene einer gezeichneten Karte. */
export function updateDrawnMap(db: CampaignDb, mapId: string, input: NewMap): void {
  const map = db.getSnapshot().maps[mapId];
  if (!map) return;
  db.patch('maps', mapId, {
    name: input.name.trim() || map.name,
    level: input.level,
    ground: input.ground,
    placeId: input.placeId,
    scale: scaleOf(input.widthKm, map.frame?.width ?? SHEET.width),
  });
}

/**
 * Ändert die Karte und gibt zurück, wie sich genau diese Änderung zurücknehmen lässt – ohne
 * anzufassen, was seither sonst an der Karte geschehen ist.
 */
function change(
  db: CampaignDb,
  mapId: string,
  apply: (map: GameMap) => Partial<GameMap>,
  revert: (map: GameMap) => Partial<GameMap>,
): Undo {
  const map = db.getSnapshot().maps[mapId];
  if (!map) return () => {};
  db.patch('maps', mapId, apply(map));
  return () => {
    const now = db.getSnapshot().maps[mapId];
    if (now) db.patch('maps', mapId, revert(now));
  };
}

const without = <T extends { id: string }>(list: readonly T[], id: string): T[] =>
  list.filter((entry) => entry.id !== id);

/** Malt einen Pinselstrich Gelände. */
export function paintGround(
  db: CampaignDb,
  mapId: string,
  ground: MapGround,
  width: number,
  points: readonly (readonly [number, number])[],
): Undo {
  if (!points.length) return () => {};
  const stroke: MapStroke = {
    id: newId(),
    ground,
    width,
    points: simplify(points, 1.2),
    cap: 'round',
  };
  return change(
    db,
    mapId,
    (map) => ({ strokes: [...map.strokes, stroke] }),
    (map) => ({ strokes: without(map.strokes, stroke.id) }),
  );
}

/**
 * Malt ein Rechteck Gelände – einen Raum, ein Feld. Gespeichert wird es als gerader Strich mit
 * stumpfen Enden: so breit wie das Rechteck hoch ist.
 */
export function paintRect(
  db: CampaignDb,
  mapId: string,
  ground: MapGround,
  from: readonly [number, number],
  to: readonly [number, number],
): Undo {
  const [x0, x1] = [Math.min(from[0], to[0]), Math.max(from[0], to[0])];
  const [y0, y1] = [Math.min(from[1], to[1]), Math.max(from[1], to[1])];
  if (x1 - x0 < 1 || y1 - y0 < 1) return () => {};
  const middle = (y0 + y1) / 2;
  const stroke: MapStroke = {
    id: newId(),
    ground,
    width: y1 - y0,
    points: [
      [x0, middle],
      [x1, middle],
    ],
    cap: 'butt',
  };
  return change(
    db,
    mapId,
    (map) => ({ strokes: [...map.strokes, stroke] }),
    (map) => ({ strokes: without(map.strokes, stroke.id) }),
  );
}

/**
 * Zieht eine Linie. Enden nahe einem Ort docken an ihm an. Verbindet eine Straße oder ein Pfad
 * zwei Orte der Welt, entsteht daraus ein Weg im Wegenetz – seine Dauer rechnet Wayfarer aus dem
 * Gelände, über das er führt.
 */
export function drawLine(
  db: CampaignDb,
  mapId: string,
  kind: MapLine['kind'],
  raw: readonly (readonly [number, number])[],
): { undo: Undo; line: MapLine | null } {
  const data = db.getSnapshot();
  const map = data.maps[mapId];
  if (!map || raw.length < 2) return { undo: () => {}, line: null };
  const points = simplify(raw, 1.6);
  const [first, last] = [points[0]!, points[points.length - 1]!];
  const start = markerNear(map.markers, first[0], first[1], SNAP);
  const end = markerNear(map.markers, last[0], last[1], SNAP);
  if (start) points[0] = [start.x, start.y];
  if (end) points[points.length - 1] = [end.x, end.y];
  const placeOf = (id: string | null | undefined): string | null =>
    id && data.entities[id]?.kind === 'place' ? id : null;
  const [fromId, toId] = [placeOf(start?.entityId), placeOf(end?.entityId)];
  const walkable = kind === 'road' || kind === 'path';
  return db.batch(() => {
    const pathId =
      walkable && fromId && toId && fromId !== toId
        ? db.put(
            'paths',
            createPath({ fromId, toId, mapId, points, road: kind === 'road' ? 'road' : 'trail' }),
          ).id
        : null;
    const line: MapLine = { id: newId(), kind, name: '', points, pathId };
    const undoMap = change(
      db,
      mapId,
      (current) => ({ lines: [...current.lines, line] }),
      (current) => ({ lines: without(current.lines, line.id) }),
    );
    return {
      line,
      undo: () => {
        undoMap();
        if (pathId && db.getSnapshot().paths[pathId]) db.remove('paths', pathId);
      },
    };
  });
}

/** Setzt einen Punkt für einen Ort der Welt (oder nur mit Namen). */
export function placeMarker(
  db: CampaignDb,
  mapId: string,
  at: readonly [number, number],
  entityId: string | null,
  label = '',
): Undo {
  const marker = {
    id: newId(),
    x: at[0],
    y: at[1],
    entityId,
    label,
    lkFeatureId: null,
    articleId: null,
  };
  return change(
    db,
    mapId,
    (map) => ({ markers: [...map.markers, marker] }),
    (map) => ({ markers: without(map.markers, marker.id) }),
  );
}

/** Entfernt eine Linie – und den Weg, der aus ihr entstanden ist. */
export function removeLine(db: CampaignDb, mapId: string, lineId: string): Undo {
  const map = db.getSnapshot().maps[mapId];
  const line = map?.lines.find((entry) => entry.id === lineId);
  if (!map || !line) return () => {};
  const path = line.pathId ? db.getSnapshot().paths[line.pathId] : undefined;
  return db.batch(() => {
    const undoMap = change(
      db,
      mapId,
      (current) => ({ lines: without(current.lines, lineId) }),
      (current) => ({ lines: [...without(current.lines, lineId), line] }),
    );
    if (path) db.remove('paths', path.id);
    return () => {
      undoMap();
      if (path && !db.getSnapshot().paths[path.id]) db.put('paths', path);
    };
  });
}

/** Entfernt einen Punkt. Wege, die an ihm enden, bleiben – sie führen weiter zu ihrem Ort. */
export function removeMarker(db: CampaignDb, mapId: string, markerId: string): Undo {
  const marker = db.getSnapshot().maps[mapId]?.markers.find((entry) => entry.id === markerId);
  if (!marker) return () => {};
  return change(
    db,
    mapId,
    (map) => ({ markers: without(map.markers, markerId) }),
    (map) => ({ markers: [...without(map.markers, markerId), marker] }),
  );
}

export function renameLine(db: CampaignDb, mapId: string, lineId: string, name: string): Undo {
  const before = db.getSnapshot().maps[mapId]?.lines.find((line) => line.id === lineId)?.name;
  if (before === undefined) return () => {};
  const named = (text: string) => (map: GameMap) => ({
    lines: map.lines.map((line) => (line.id === lineId ? { ...line, name: text } : line)),
  });
  return change(db, mapId, named(name), named(before));
}

/** Löscht eine gezeichnete Karte samt den Wegen, die aus ihren Linien entstanden sind. */
export function removeDrawnMap(db: CampaignDb, mapId: string): void {
  const map = db.getSnapshot().maps[mapId];
  if (!map) return;
  db.batch(() => {
    for (const line of map.lines)
      if (line.pathId && db.getSnapshot().paths[line.pathId]) db.remove('paths', line.pathId);
    db.remove('maps', mapId);
  });
}
