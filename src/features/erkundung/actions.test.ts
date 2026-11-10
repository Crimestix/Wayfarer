import { describe, expect, it } from 'vitest';
import { deleteEntity } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity } from '../../domain/schema';
import { repairReferences } from '../import/integrity';
import { patchHex, removeArea, rerollArea, rerollInput, setAllDiscovered } from './actions';
import { generateArea } from './generate';

async function setup() {
  const a = createEntity({ kind: 'place', name: 'Hohenfurt' });
  const b = createEntity({ kind: 'place', name: 'Graufels' });
  const base = elarisCampaign();
  const data = { ...base, entities: { ...base.entities, [a.id]: a, [b.id]: b } };
  const area = generateArea(data, {
    fromId: a.id,
    toId: b.id,
    distanceKm: 120,
    biome: 'forest',
    hexKm: 10,
    seed: 99,
  });
  const store = new MemoryStore();
  const db = await CampaignDb.create(store, { ...data, areas: { [area.id]: area } });
  return { db, store, a, b, area };
}

describe('Hexkarten im Spielstand', () => {
  it('werden gespeichert und genauso wieder gelesen', async () => {
    const { db, store, area } = await setup();
    await db.flush();
    expect(store.files.has(`areas/${area.id}.json`)).toBe(true);
    const reopened = await CampaignDb.open(store);
    expect(reopened.problems).toEqual([]);
    expect(reopened.getSnapshot().areas[area.id]).toEqual(db.getSnapshot().areas[area.id]);
  });

  it('ändern einzelne Felder und decken auf, ohne den Start je zu verdecken', async () => {
    const { db, area } = await setup();
    const target = area.hexes.find((h) => !h.placeId)!;
    patchHex(db, area.id, target, { note: 'Hier lagert eine Karawane.', discovered: true });
    const now = () => db.getSnapshot().areas[area.id]!;
    expect(now().hexes.find((h) => h.q === target.q && h.r === target.r)).toMatchObject({
      note: 'Hier lagert eine Karawane.',
      discovered: true,
    });
    // Ein Feld, das es nicht gibt, ändert nichts.
    const rev = now().rev;
    patchHex(db, area.id, { q: 999, r: 999 }, { note: 'x' });
    expect(now().rev).toBe(rev);

    setAllDiscovered(db, area.id, true);
    expect(now().hexes.every((h) => h.discovered)).toBe(true);
    setAllDiscovered(db, area.id, false);
    expect(
      now()
        .hexes.filter((h) => h.discovered)
        .map((h) => h.placeId),
    ).toEqual([area.fromId]);
  });

  it('würfeln das Gelände neu und lassen sich zurücknehmen', async () => {
    const { db, area } = await setup();
    patchHex(db, area.id, area.hexes[3]!, { note: 'eigener Eintrag' });
    const before = db.getSnapshot().areas[area.id]!;
    const undo = rerollArea(db, area.id)!;
    const after = db.getSnapshot().areas[area.id]!;
    expect(after.seed).not.toBe(before.seed);
    expect(after.name).toBe(before.name);
    expect(after.hexes.map((h) => h.terrain)).not.toEqual(before.hexes.map((h) => h.terrain));
    // Start und Ziel bleiben, wo sie sind.
    expect(after.hexes.filter((h) => h.placeId).map((h) => h.placeId)).toEqual(
      before.hexes.filter((h) => h.placeId).map((h) => h.placeId),
    );
    undo();
    expect(db.getSnapshot().areas[area.id]!.hexes).toEqual(before.hexes);
    // Eine Karte ohne Herkunft (von Hand oder aus der alten Version) lässt sich nicht neu würfeln.
    expect(rerollInput(db, { ...before, seed: null, fromId: null })).toBeNull();
  });

  it('lassen sich löschen und zurückholen', async () => {
    const { db, area } = await setup();
    const undo = removeArea(db, area.id)!;
    expect(db.getSnapshot().areas[area.id]).toBeUndefined();
    undo();
    expect(db.getSnapshot().areas[area.id]!.hexes).toHaveLength(area.hexes.length);
    expect(removeArea(db, 'fehlt')).toBeNull();
  });

  it('verlieren einen gelöschten Ort von ihrem Feld', async () => {
    const { db, area, b } = await setup();
    deleteEntity(db, b.id);
    const now = db.getSnapshot().areas[area.id]!;
    expect(now.toId).toBeNull();
    expect(now.hexes.some((h) => h.placeId === b.id)).toBe(false);
    expect(now.fromId).toBe(area.fromId);
  });

  it('werden beim Einspielen von Verweisen ins Leere befreit', async () => {
    const { db, area, b } = await setup();
    const data = db.getSnapshot();
    const entities = { ...data.entities };
    delete entities[b.id];
    const { data: fixed, repaired } = repairReferences({ ...data, entities });
    expect(repaired).toBe(2);
    expect(fixed.areas[area.id]!.toId).toBeNull();
    expect(fixed.areas[area.id]!.hexes.some((h) => h.placeId === b.id)).toBe(false);
  });
});
