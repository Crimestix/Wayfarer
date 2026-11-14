import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity } from '../../domain/schema';
import { defaultLaneKeys, laneKeysOf } from '../../domain/timeline';
import { addLane, moveLane, removeLane, resetLanes } from './actions';

/** Erfundene Welt: Brann Eichwald und Burg Graufels kommen als Bahnen dazu. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const brann = db.put('entities', createEntity({ kind: 'person', name: 'Brann Eichwald' }));
  const castle = db.put('entities', createEntity({ kind: 'place', name: 'Burg Graufels' }));
  return { db, data: () => db.getSnapshot(), brann, castle };
}

describe('Bahnen der Zeitleiste wählen', () => {
  it('nimmt Bahnen dazu, schiebt und entfernt sie – gemerkt im Spielstand', async () => {
    const { db, data, brann, castle } = await setup();
    expect(data().state.timelineLanes).toBeNull();
    addLane(db, `entity:${brann.id}`);
    // Was Wayfarer gewählt hatte, bleibt – die neue Bahn kommt unten dazu.
    expect(laneKeysOf(data())).toEqual([...defaultLaneKeys(data()), `entity:${brann.id}`]);
    addLane(db, `entity:${castle.id}`);
    addLane(db, `entity:${castle.id}`);
    moveLane(db, `entity:${castle.id}`, -1);
    expect(laneKeysOf(data()).slice(-2)).toEqual([`entity:${castle.id}`, `entity:${brann.id}`]);
    moveLane(db, 'party', -1);
    expect(laneKeysOf(data())[0]).toBe('party');
    removeLane(db, 'events');
    expect(laneKeysOf(data())).not.toContain('events');
    expect(data().state.timelineLanes).toEqual(laneKeysOf(data()));
    resetLanes(db);
    expect(data().state.timelineLanes).toBeNull();
    expect(laneKeysOf(data())).toEqual(defaultLaneKeys(data()));
  });
});
