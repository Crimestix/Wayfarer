/**
 * Testmodus (siehe `domain/testMode.ts`): einschalten, ausschalten, und ob er gerade läuft.
 *
 * - Der beiseitegelegte Stand liegt im Kampagnenordner – so übersteht der Testmodus einen
 *   Neustart: Liegt das Zeichen da, läuft er (`detectTestMode`, gefragt beim Öffnen).
 * - Solange er läuft, ruht der Abgleich (die App startet ihn nicht, `App.tsx`) – nichts aus dem
 *   Testmodus erreicht den anderen Rechner.
 * - Ausschalten setzt den Stand über `db.replaceAll` wieder ein: alles oder nichts. Erst wenn er
 *   auf der Platte steht, verschwindet das Zeichen.
 */
import { useSyncExternalStore } from 'react';
import {
  joinSnapshot,
  readManifest,
  snapshotFiles,
  TEST_MANIFEST,
  testPartPath,
} from '../domain/testMode';
import { nowIso } from '../domain/schema';
import type { CampaignDb } from './db';
import type { CampaignStore } from './store';

export interface TestModeInfo {
  /** Echte Zeit des Einschaltens – leer, wenn das Zeichen sie nicht mehr hergibt. */
  startedAt: string;
}

let active: TestModeInfo | null = null;
const listeners = new Set<() => void>();

function set(next: TestModeInfo | null) {
  active = next;
  for (const listener of listeners) listener();
}

/** Läuft der Testmodus? */
export const testModeInfo = (): TestModeInfo | null => active;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Für die Oberfläche: der laufende Testmodus oder null. */
export function useTestMode(): TestModeInfo | null {
  return useSyncExternalStore(subscribe, testModeInfo);
}

/** Beim Öffnen einer Kampagne: Liegt das Zeichen im Ordner, läuft der Testmodus weiter. */
export async function detectTestMode(store: CampaignStore): Promise<boolean> {
  let text: string | null;
  try {
    text = await store.read(TEST_MANIFEST);
  } catch {
    // Lässt sich nicht nachsehen, gilt die vorsichtige Antwort: Er läuft, der Abgleich ruht.
    text = '';
  }
  set(text === null ? null : { startedAt: readManifest(text)?.startedAt ?? '' });
  return text !== null;
}

/** Entfernt Teile, bis keiner mehr da ist (auch Reste eines abgebrochenen Einschaltens). */
async function removeParts(store: CampaignStore, from = 0): Promise<void> {
  for (let index = from; index < 9999; index++) {
    const path = testPartPath(index);
    if ((await store.read(path)) === null) return;
    await store.remove(path);
  }
}

/** Schaltet den Testmodus ein: Der ganze Stand wird beiseitegelegt, das Zeichen zuletzt. */
export async function startTestMode(db: CampaignDb): Promise<void> {
  if (active) return;
  await db.flush();
  if (db.hasUnsavedChanges())
    throw new Error(
      'Der Spielstand ließ sich gerade nicht speichern. Der Testmodus bleibt aus – bitte gleich noch einmal versuchen.',
    );
  const startedAt = nowIso();
  const { manifest, parts } = snapshotFiles(db.getSnapshot(), startedAt);
  const store = db.store;
  try {
    for (const [index, text] of parts.entries()) await store.write(testPartPath(index), text);
    await removeParts(store, parts.length);
    await store.write(TEST_MANIFEST, manifest);
  } catch (error) {
    // Ohne Zeichen gilt nichts davon: Reste wegräumen, der Spielstand ist unberührt.
    await removeParts(store).catch(() => undefined);
    throw new Error(
      `Der Stand ließ sich nicht beiseitelegen, der Testmodus bleibt aus. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  set({ startedAt });
}

/**
 * Schaltet den Testmodus aus. Ohne `keep` wird alles seit dem Einschalten verworfen: Der
 * beiseitegelegte Stand gilt wieder. Mit `keep` bleibt, was im Testmodus entstand (für den Fall,
 * dass darin versehentlich echt gespielt wurde).
 */
export async function endTestMode(db: CampaignDb, keep = false): Promise<void> {
  const store = db.store;
  if (!keep) {
    const manifestText = await store.read(TEST_MANIFEST);
    const count = readManifest(manifestText)?.parts ?? 0;
    const parts: (string | null)[] = [];
    for (let index = 0; index < count; index++) parts.push(await store.read(testPartPath(index)));
    db.replaceAll(joinSnapshot(manifestText, parts));
    await db.flush();
    if (db.hasUnsavedChanges())
      throw new Error(
        'Der alte Stand ließ sich nicht ganz zurückschreiben. Der Testmodus bleibt an – bitte gleich noch einmal ausschalten.',
      );
  }
  await store.remove(TEST_MANIFEST);
  set(null);
  await removeParts(store).catch(() => undefined);
}
