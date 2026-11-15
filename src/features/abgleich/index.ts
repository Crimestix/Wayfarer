/**
 * Abgleich mit einer privaten Ablage bei GitHub. Die Rechnung steht in `domain/sync.ts` und
 * `domain/syncMerge.ts`, der Ablauf in `engine.ts`, der Bote zur Rust-Seite in `port.ts`, der
 * Stand für die Oberfläche in `state.ts`.
 */
import type { CampaignDb } from '../../data/db';
import { isDesktopApp, onSyncProgress, type SyncProgress } from '../../data/platform';
import { DATA_VERSION } from '../../domain/schema';
import { createSyncEngine, type EngineOptions, type SyncEngine } from './engine';
import { desktopPort, type SyncPort } from './port';
import { setActiveView } from './state';

export { createSyncEngine, fetchIntoEmptyFolder } from './engine';
export type { SyncEngine } from './engine';
export { desktopPort } from './port';
export type { SyncPort } from './port';
export { useSync } from './state';
export type { SyncView } from './state';

/** Womit der Abgleich spricht: in der App die Rust-Seite, in der Probe der Vorschau die Attrappe. */
export interface SyncEnv {
  port: SyncPort;
  onProgress: (fn: (progress: SyncProgress) => void) => () => void;
}

export const desktopEnv: SyncEnv = { port: desktopPort, onProgress: onSyncProgress };

let probeEnv: SyncEnv | null = null;
/** Nur die Probe der Vorschau (`?abgleich`): die Attrappe statt der Rust-Seite. */
export function setProbeEnv(env: SyncEnv | null): void {
  probeEnv = env;
}
/** Die Umgebung des Abgleichs – null, wenn es keinen gibt (Vorschau ohne Probe). */
export function syncEnv(): SyncEnv | null {
  return probeEnv ?? (isDesktopApp() ? desktopEnv : null);
}

interface Active {
  engine: SyncEngine;
  port: SyncPort;
  root: string;
}
let active: Active | null = null;
let offProgress: (() => void) | null = null;

/** Der laufende Abgleich (Ablauf, Bote, Ordner) – null in der Vorschau ohne Probe. */
export function activeSync(): Active | null {
  return active;
}

/**
 * Startet den Abgleich für die geöffnete Kampagne (nur in der installierten App). Er läuft nur,
 * wenn für diesen Ordner eine Verbindung besteht; sonst tut er nichts.
 */
export function startSync(db: CampaignDb, options: EngineOptions = {}): SyncEngine | null {
  const env = syncEnv();
  if (!env) return null;
  stopSync();
  const root = db.store.location;
  const engine = createSyncEngine(db, env.port, { root, ...options });
  active = { engine, port: env.port, root };
  offProgress = env.onProgress((progress) => {
    // Nur während eines Laufs; danach räumt der Ablauf den Fortschritt selbst weg.
    if (engine.view.get().phase === 'running' || progress.done < progress.total)
      engine.view.set({ progress });
  });
  setActiveView(engine.view);
  engine.start();
  return engine;
}

export function stopSync(): void {
  offProgress?.();
  offProgress = null;
  active?.engine.stop();
  active = null;
  setActiveView(null);
}

/** Für Tests: einen Ablauf mit eigenem Boten als den laufenden eintragen. */
export function setActiveSync(next: { engine: SyncEngine; port: SyncPort; root: string } | null) {
  active = next;
}

/**
 * Vor dem Austausch des ganzen Spielstands (Sicherung einspielen, alte Version übernehmen, neu
 * beginnen): Der gemeinsame Stand gilt danach nicht mehr – der nächste Abgleich lädt nichts
 * still hoch, sondern fragt, welcher Stand gilt. Ohne Verbindung geschieht nichts.
 */
export async function syncBeforeRestore(): Promise<void> {
  if (!active) return;
  const { engine, port, root } = active;
  // Nie neben einem laufenden Abgleich: Er schriebe sonst den alten gemeinsamen Stand zurück.
  await engine.hold(async () => {
    const st = await port.state(root, DATA_VERSION);
    if (!st.link) return;
    await port.mark({ root, dropBase: true });
  });
}
