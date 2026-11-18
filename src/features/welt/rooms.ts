/**
 * Befehle für Räume und Etagen: anlegen (auch ein ganzes Haus auf einmal), zum Raum oder zur Etage
 * machen, zum eigenen Eintrag machen, Etagen ordnen, Räume umhängen, Stand setzen – und
 * übernehmen, was unter einem Ort schon geschrieben steht (`takeRoomSources`).
 */
import type { CampaignDb } from '../../data/db';
import {
  floorsOf,
  guessLevel,
  parseRoomPlan,
  roomSources,
  type RoomLine,
} from '../../domain/rooms';
import { createEntity, type Entity, type Place } from '../../domain/schema';
import { adoptArticle } from '../wiki/actions';

const fold = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de');

/**
 * Legt Räume unter einem Ort an – eine Zeile je Raum; eine Zeile mit eingerückten Zeilen darunter
 * ist eine Etage (`parseRoomPlan`). Eine Etage, die es unter dem Ort schon gibt (gleicher Name),
 * wird genommen, nie ein zweites Mal angelegt; neue stehen unter den vorhandenen, in der
 * geschriebenen Reihenfolge. Gibt die neuen Räume und Etagen zurück.
 */
export function addRooms(db: CampaignDb, parentId: string, text: string): Place[] {
  const plan = parseRoomPlan(text);
  return db.batch(() => {
    const made: Place[] = [];
    const room = (line: RoomLine, under: string, floor: boolean, level: number | null) => {
      const entity = createEntity({ kind: 'place', name: line.name, tagline: line.tagline });
      const put = db.put('entities', {
        ...entity,
        place: { ...entity.place, parentId: under, room: true, floor, level },
      }) as Place;
      made.push(put);
      return put;
    };
    const known = floorsOf(db.getSnapshot(), parentId);
    const lowest = Math.min(0, ...known.map((floor) => floor.place.level ?? 0));
    let fresh = 0;
    for (const line of plan.floors) {
      const floor =
        known.find((entry) => fold(entry.name) === fold(line.name)) ??
        room(line, parentId, true, lowest - ++fresh);
      for (const inside of line.rooms) room(inside, floor.id, false, null);
    }
    for (const line of plan.rooms) room(line, parentId, false, null);
    return made;
  });
}

/** Stellt Einträge wieder her, wie sie waren – nur die, die es noch gibt. */
function restore(db: CampaignDb, before: readonly Entity[], created: readonly string[] = []) {
  db.batch(() => {
    const now = db.getSnapshot();
    for (const entity of before) if (now.entities[entity.id]) db.put('entities', entity);
    for (const id of created) if (now.entities[id]) db.remove('entities', id);
  });
}

/**
 * Macht Orte zu Räumen (oder Räume und Etagen wieder zu eigenen Einträgen). Aus einer Etage wird
 * dabei ein gewöhnlicher Raum. Gibt `undo` zurück.
 */
export function setRooms(db: CampaignDb, ids: string[], room: boolean): () => void {
  const before: Entity[] = [];
  db.batch(() => {
    for (const id of ids) {
      const entity = db.getSnapshot().entities[id];
      if (entity?.kind !== 'place') continue;
      if (entity.place.room === room && !entity.place.floor) continue;
      before.push(entity);
      db.put('entities', { ...entity, place: { ...entity.place, room, floor: false } });
    }
  });
  return () => restore(db, before);
}

/** Macht Orte (oder Räume) zu Etagen des Ortes darüber – mit der üblichen Lage nach dem Namen. */
export function setFloors(db: CampaignDb, ids: string[]): () => void {
  const before: Entity[] = [];
  db.batch(() => {
    for (const id of ids) {
      const entity = db.getSnapshot().entities[id];
      if (entity?.kind !== 'place' || (entity.place.room && entity.place.floor)) continue;
      before.push(entity);
      db.put('entities', {
        ...entity,
        place: {
          ...entity.place,
          room: true,
          floor: true,
          level: entity.place.level ?? guessLevel(entity.name),
        },
      });
    }
  });
  return () => restore(db, before);
}

/**
 * Rückt eine Etage eine Stelle nach oben (-1) oder unten (+1). Danach sind alle Etagen des Ortes
 * von oben nach unten durchgezählt – so bleibt die Reihenfolge, wie sie dasteht.
 */
export function moveFloor(db: CampaignDb, floorId: string, by: -1 | 1): void {
  const floor = db.getSnapshot().entities[floorId];
  if (floor?.kind !== 'place' || !floor.place.parentId) return;
  const order = floorsOf(db.getSnapshot(), floor.place.parentId);
  const from = order.findIndex((entry) => entry.id === floorId);
  const to = from + by;
  if (from < 0 || to < 0 || to >= order.length) return;
  [order[from], order[to]] = [order[to]!, order[from]!];
  db.batch(() => {
    order.forEach((entry, index) => {
      const level = order.length - 1 - index;
      if (entry.place.level !== level)
        db.put('entities', { ...entry, place: { ...entry.place, level } });
    });
  });
}

/** Hängt einen Raum auf eine Etage oder unmittelbar an den Ort (`toId`). */
export function moveRoom(db: CampaignDb, roomId: string, toId: string): void {
  const room = db.getSnapshot().entities[roomId];
  const target = db.getSnapshot().entities[toId];
  if (room?.kind !== 'place' || target?.kind !== 'place' || roomId === toId) return;
  if (room.place.parentId === toId) return;
  db.put('entities', { ...room, place: { ...room.place, parentId: toId } });
}

export function setRoomState(db: CampaignDb, id: string, roomState: string): void {
  const entity = db.getSnapshot().entities[id];
  if (entity?.kind !== 'place' || entity.place.roomState === roomState.trim()) return;
  db.put('entities', { ...entity, place: { ...entity.place, roomState: roomState.trim() } });
}

export interface RoomPick {
  /** `RoomSource.key`. */
  key: string;
  as: 'floor' | 'room';
}

/**
 * Macht aus dem, was unter einem Ort schon geschrieben steht, seine Etagen und Räume
 * (`roomSources`): Ein Ort darin bleibt, wo er ist, und wird Etage oder Raum; ein Artikel ohne
 * Eintrag wird dabei ein Ort – unter dem, was aus dem Artikel über ihm wurde, sonst unter dem
 * nächsten Ort darüber. Am Text ändert sich nichts: Der Artikel ist danach die Seite des Raums.
 * Gibt zurück, wie viele es wurden, und `undo`.
 */
export function takeRoomSources(
  db: CampaignDb,
  placeId: string,
  picks: readonly RoomPick[],
): { rooms: number; floors: number; undo: () => void } | null {
  const sources = roomSources(db.getSnapshot(), placeId);
  const byKey = new Map(sources.map((source) => [source.key, source]));
  const wanted = new Map(picks.map((pick) => [pick.key, pick.as]));
  const before: Entity[] = [];
  const created: string[] = [];
  /** Vorschlag → der Ort, der aus ihm wurde (oder schon war). */
  const made = new Map<string, string>();
  let rooms = 0;
  let floors = 0;
  db.batch(() => {
    // In der Ordnung der Liste: erst, was darüber steht – so hat ein Raum seine Etage schon.
    for (const source of sources) {
      const as = wanted.get(source.key);
      if (!as) continue;
      let place: Entity | undefined;
      let parentId: string | null = null;
      if (source.placeId) {
        place = db.getSnapshot().entities[source.placeId];
        if (place?.kind !== 'place') continue;
        before.push(place);
      } else {
        const article = source.articleId ? db.getSnapshot().articles[source.articleId] : undefined;
        if (!article) continue;
        // Unter dem, was aus dem Artikel darüber wurde – sonst unter dem nächsten Ort, den es gibt.
        for (let up = source.parentKey; up && !parentId; up = byKey.get(up)?.parentKey ?? null)
          parentId = made.get(up) ?? null;
        parentId ??= source.anchorId;
        place = adoptArticle(db, article, 'place');
        created.push(place.id);
      }
      if (place.kind !== 'place') continue;
      const floor = as === 'floor';
      db.put('entities', {
        ...place,
        place: {
          ...place.place,
          parentId: parentId ?? place.place.parentId,
          room: true,
          floor,
          level: floor ? (place.place.level ?? guessLevel(place.name)) : place.place.level,
        },
      });
      made.set(source.key, place.id);
      if (floor) floors++;
      else rooms++;
    }
  });
  if (!rooms && !floors) return null;
  return { rooms, floors, undo: () => restore(db, before, created) };
}
