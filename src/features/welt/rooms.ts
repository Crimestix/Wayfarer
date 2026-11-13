/** Befehle für Räume: anlegen, zum Raum machen, zum eigenen Eintrag machen, Stand setzen. */
import type { CampaignDb } from '../../data/db';
import { parseRoomLines } from '../../domain/rooms';
import { createEntity, type Place } from '../../domain/schema';

/** Legt Räume unter einem Ort an – eine Zeile je Raum. Gibt die neuen Räume zurück. */
export function addRooms(db: CampaignDb, parentId: string, text: string): Place[] {
  const lines = parseRoomLines(text);
  return db.batch(() =>
    lines.map((line) => {
      const room = createEntity({ kind: 'place', name: line.name, tagline: line.tagline });
      return db.put('entities', {
        ...room,
        place: { ...room.place, parentId, room: true },
      }) as Place;
    }),
  );
}

/** Macht Orte zu Räumen (oder Räume wieder zu eigenen Einträgen). Gibt `undo` zurück. */
export function setRooms(db: CampaignDb, ids: string[], room: boolean): () => void {
  const before = new Map<string, boolean>();
  db.batch(() => {
    for (const id of ids) {
      const entity = db.getSnapshot().entities[id];
      if (entity?.kind !== 'place' || entity.place.room === room) continue;
      before.set(id, entity.place.room);
      db.put('entities', { ...entity, place: { ...entity.place, room } });
    }
  });
  return () =>
    db.batch(() => {
      for (const [id, was] of before) {
        const entity = db.getSnapshot().entities[id];
        if (entity?.kind === 'place')
          db.put('entities', { ...entity, place: { ...entity.place, room: was } });
      }
    });
}

export function setRoomState(db: CampaignDb, id: string, roomState: string): void {
  const entity = db.getSnapshot().entities[id];
  if (entity?.kind !== 'place' || entity.place.roomState === roomState.trim()) return;
  db.put('entities', { ...entity, place: { ...entity.place, roomState: roomState.trim() } });
}
