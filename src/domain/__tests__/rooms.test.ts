import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { addRooms, setRoomState, setRooms } from '../../features/welt/rooms';
import { parseRoomLines, roomCandidates, roomsOf } from '../rooms';
import { createEntity, type Place } from '../schema';

const placeUnder = (name: string, parentId: string, category: string): Place => {
  const place = createEntity({ kind: 'place', name });
  return { ...place, place: { ...place.place, parentId, category } };
};

describe('Räume', () => {
  it('liest Zeilen und legt Räume unter einem Ort an', async () => {
    expect(
      parseRoomLines('1 Torhaus – Fallgitter\n- 2 Halle\n\n10 Gruft: noch nicht betreten'),
    ).toEqual([
      { name: '1 Torhaus', tagline: 'Fallgitter' },
      { name: '2 Halle', tagline: '' },
      { name: '10 Gruft', tagline: 'noch nicht betreten' },
    ]);
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const keep = db.put('entities', createEntity({ kind: 'place', name: 'Burg Graufels' }));
    addRooms(db, keep.id, '10 Gruft\n2 Halle\n1 Torhaus');
    expect(roomsOf(db.getSnapshot(), keep.id).map((room) => room.name)).toEqual([
      '1 Torhaus',
      '2 Halle',
      '10 Gruft',
    ]);
    const hall = roomsOf(db.getSnapshot(), keep.id)[1]!;
    setRoomState(db, hall.id, ' eingestürzt ');
    expect(roomsOf(db.getSnapshot(), keep.id)[1]!.place.roomState).toBe('eingestürzt');
  });

  it('wandelt Unterorte, die wie Räume aussehen, um – und zurück', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const keep = db.put('entities', createEntity({ kind: 'place', name: 'Burg Graufels' }));
    const cellar = db.put('entities', placeUnder('Keller', keep.id, 'Dungeonraum'));
    db.put('entities', placeUnder('Dorf', keep.id, 'Dorf'));
    expect(roomCandidates(db.getSnapshot(), keep.id).map((p) => p.id)).toEqual([cellar.id]);
    const undo = setRooms(db, [cellar.id], true);
    expect(roomsOf(db.getSnapshot(), keep.id).map((p) => p.id)).toEqual([cellar.id]);
    expect(roomCandidates(db.getSnapshot(), keep.id)).toEqual([]);
    undo();
    expect(roomsOf(db.getSnapshot(), keep.id)).toEqual([]);
  });
});
