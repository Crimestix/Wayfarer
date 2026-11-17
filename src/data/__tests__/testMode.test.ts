import { afterEach, describe, expect, it } from 'vitest';
import { demoCampaign } from '../__fixtures__/demoWorld';
import { CampaignDb } from '../db';
import { MemoryStore } from '../store';
import { detectTestMode, endTestMode, startTestMode, testModeInfo } from '../testMode';
import { createEntity } from '../../domain/schema';
import { isSyncedPath } from '../../domain/sync';
import { joinSnapshot, snapshotFiles, TEST_MANIFEST, testPartPath } from '../../domain/testMode';

const isTestFile = (path: string) => path.startsWith('testmodus');

async function setup() {
  const store = new MemoryStore();
  const db = await CampaignDb.create(store, demoCampaign());
  await db.flush();
  return { store, db };
}

/** Im Testmodus: etwas anlegen, etwas ändern, etwas löschen, die Zeit vorstellen. */
function playAround(db: CampaignDb) {
  const data = db.getSnapshot();
  db.put('entities', createEntity({ kind: 'place', name: 'Probeort' }));
  const [first, second] = Object.values(data.entities);
  db.patch('entities', first!.id, { name: 'Umbenannt im Test' });
  db.remove('entities', second!.id);
  db.setState({ now: data.state.now + 5000 });
  db.setCampaign({ name: 'Im Test umbenannt' });
}

afterEach(async () => {
  // Der Schalter ist ein Zustand des Programms – nach jedem Test wieder aus.
  await detectTestMode(new MemoryStore());
});

describe('Testmodus: der beiseitegelegte Stand', () => {
  it('zerlegt den Spielstand in Teile und setzt ihn gleich wieder zusammen', () => {
    const data = demoCampaign();
    const { manifest, parts } = snapshotFiles(data, '2026-11-18T10:00:00.000Z', 4000);
    expect(parts.length).toBeGreaterThan(2);
    expect(joinSnapshot(manifest, parts)).toEqual(data);
  });

  it('verlässt diesen Rechner nie: Seine Dateien passen nicht auf das Muster des Abgleichs', () => {
    expect(isSyncedPath(TEST_MANIFEST)).toBe(false);
    expect(isSyncedPath(testPartPath(0))).toBe(false);
    expect(isSyncedPath(testPartPath(41))).toBe(false);
  });

  it('ändert nichts, wenn ein Teil fehlt oder unlesbar ist', () => {
    const { manifest, parts } = snapshotFiles(demoCampaign(), '2026-11-18T10:00:00.000Z', 4000);
    expect(() => joinSnapshot(manifest, parts.slice(1))).toThrow(/fehlt ein Teil/);
    expect(() => joinSnapshot(manifest, [...parts.slice(1), null])).toThrow(/fehlt ein Teil/);
    expect(() => joinSnapshot(manifest, [...parts.slice(1), '{kaputt'])).toThrow(/unlesbar/);
    expect(() => joinSnapshot(null, [])).toThrow(/nicht mehr lesbar/);
  });
});

describe('Testmodus: ein- und ausschalten', () => {
  it('stellt beim Ausschalten jede Datei genau so wieder her, wie sie war', async () => {
    const { store, db } = await setup();
    const before = new Map(store.files);
    const dataBefore = db.getSnapshot();

    await startTestMode(db);
    expect(testModeInfo()).not.toBeNull();
    expect(store.files.has(TEST_MANIFEST)).toBe(true);
    // Der Spielstand selbst ist vom Einschalten unberührt.
    expect(new Map([...store.files].filter(([path]) => !isTestFile(path)))).toEqual(before);

    playAround(db);
    await db.flush();
    expect(db.getSnapshot().campaign.name).toBe('Im Test umbenannt');

    await endTestMode(db);
    expect(testModeInfo()).toBeNull();
    // Byte für Byte wie vorher – so hat auch der Abgleich danach nichts zu tun.
    expect(store.files).toEqual(before);
    expect(db.getSnapshot()).toEqual(dataBefore);
  });

  it('läuft nach einem Neustart weiter und lässt sich dann ausschalten', async () => {
    const { store, db } = await setup();
    const before = new Map(store.files);
    await startTestMode(db);
    playAround(db);
    await db.flush();
    db.close();

    // Neustart: Das Zeichen liegt im Ordner – der Testmodus läuft, der Spielstand lädt ohne Meldung.
    await detectTestMode(new MemoryStore());
    expect(testModeInfo()).toBeNull();
    const again = await CampaignDb.open(store);
    expect(again.problems).toEqual([]);
    expect(await detectTestMode(store)).toBe(true);
    expect(testModeInfo()?.startedAt).toMatch(/^\d{4}-/);

    await endTestMode(again);
    expect(store.files).toEqual(before);
  });

  it('behält auf Wunsch, was im Testmodus entstand', async () => {
    const { store, db } = await setup();
    await startTestMode(db);
    playAround(db);
    await db.flush();
    const played = new Map([...store.files].filter(([path]) => !isTestFile(path)));

    await endTestMode(db, true);
    expect(testModeInfo()).toBeNull();
    expect(store.files).toEqual(played);
    expect(db.getSnapshot().campaign.name).toBe('Im Test umbenannt');
  });

  it('bleibt an und ändert nichts, wenn vom alten Stand ein Teil fehlt', async () => {
    const { store, db } = await setup();
    await startTestMode(db);
    playAround(db);
    await db.flush();
    store.files.delete(testPartPath(0));
    const played = new Map(store.files);

    await expect(endTestMode(db)).rejects.toThrow(/Es wurde nichts geändert/);
    expect(testModeInfo()).not.toBeNull();
    expect(store.files).toEqual(played);
  });

  it('schaltet nicht zweimal ein: Der erste Stand bleibt der, der gilt', async () => {
    const { store, db } = await setup();
    const before = new Map(store.files);
    await startTestMode(db);
    playAround(db);
    await db.flush();
    await startTestMode(db);
    await endTestMode(db);
    expect(store.files).toEqual(before);
  });
});
