import { describe, expect, it } from 'vitest';
import { createEntity, type CampaignData, type Entity } from '../../domain/schema';
import { CampaignDb } from '../db';
import { demoCampaign, elarisCampaign } from '../seed';
import { MemoryStore } from '../store';

async function demoDb() {
  const store = new MemoryStore();
  const db = await CampaignDb.create(store, demoCampaign());
  return { store, db };
}

describe('Spielstand austauschen (replaceAll)', () => {
  it('entfernt alle bisherigen Dokumente, schreibt die neuen und lädt danach genau den neuen Stand', async () => {
    const { store, db } = await demoDb();
    const before = new Set(store.files.keys());
    const next = elarisCampaign();
    db.replaceAll(next);
    expect(db.getSnapshot()).toEqual(next);
    expect(db.hasUnsavedChanges()).toBe(true);
    await db.flush();
    expect(db.hasUnsavedChanges()).toBe(false);
    expect(db.getStatus()).toBe('saved');

    const expected = new Set([
      'campaign.json',
      'state.json',
      ...Object.keys(next.entities).map((id) => `entities/${id}.json`),
      ...Object.keys(next.sessions).map((id) => `sessions/${id}.json`),
      ...Object.keys(next.events).map((id) => `events/${id}.json`),
    ]);
    expect(new Set(store.files.keys())).toEqual(expected);
    // Von der Beispielwelt ist außer campaign.json und state.json nichts mehr übrig.
    expect([...before].filter((path) => store.files.has(path)).sort()).toEqual(['campaign.json', 'state.json']);

    const reopened = await CampaignDb.open(store);
    expect(reopened.getSnapshot()).toEqual(next);
    expect(reopened.problems).toEqual([]);
  });

  it('benachrichtigt genau einmal', async () => {
    const { db } = await demoDb();
    let calls = 0;
    db.subscribe(() => calls++);
    db.replaceAll(elarisCampaign());
    expect(calls).toBe(1);
  });

  it('lässt den bisherigen Stand unangetastet, wenn der neue ungültig ist', async () => {
    const { store, db } = await demoDb();
    await db.flush();
    const snapshot = db.getSnapshot();
    const files = new Map(store.files);
    const good = elarisCampaign();
    const broken = createEntity({ kind: 'place', name: 'Kaputt' });
    const bad: CampaignData = {
      ...good,
      entities: { ...good.entities, [broken.id]: { ...broken, name: 42 } as unknown as Entity },
    };
    expect(() => db.replaceAll(bad)).toThrow();
    const mismatched: CampaignData = { ...good, entities: { ...good.entities, anders: broken } };
    expect(() => db.replaceAll(mismatched)).toThrow(/Kennung/);
    expect(db.getSnapshot()).toBe(snapshot);
    expect(db.hasUnsavedChanges()).toBe(false);
    await db.flush();
    expect(store.files).toEqual(files);
  });

  it('überschreibt keine Datei, die beim Laden unlesbar war', async () => {
    const { store } = await demoDb();
    store.files.set('entities/kaputt.json', '{ nicht json');
    const db = await CampaignDb.open(store);
    const place = { ...createEntity({ kind: 'place', name: 'Neu' }), id: 'kaputt' };
    const next = elarisCampaign();
    expect(() => db.replaceAll({ ...next, entities: { ...next.entities, kaputt: place } })).toThrow(/unlesbare Datei/);
    db.replaceAll(next);
    await db.flush();
    expect(store.files.get('entities/kaputt.json')).toBe('{ nicht json');
  });

  it('verträgt weitere Änderungen direkt nach dem Austausch', async () => {
    const { store, db } = await demoDb();
    const next = elarisCampaign();
    db.replaceAll(next);
    const place = db.put('entities', createEntity({ kind: 'place', name: 'Furt' }));
    db.setCampaign({ name: 'Neue Kampagne' });
    await db.flush();
    const reopened = await CampaignDb.open(store);
    expect(reopened.getSnapshot().entities[place.id]?.name).toBe('Furt');
    expect(reopened.getSnapshot().campaign.name).toBe('Neue Kampagne');
    expect(Object.keys(reopened.getSnapshot().entities)).toHaveLength(Object.keys(next.entities).length + 1);
  });
});
