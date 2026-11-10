/**
 * Gemeinsamer Zustand der LegendKeeper-Anbindung: steht die Verbindung, und welche Artikel gibt es?
 * Liegt außerhalb der Komponenten, damit jede Stelle der App denselben Stand sieht und das
 * Verzeichnis nur einmal geladen wird. Nichts davon wird gespeichert.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { isDesktopApp, lkClearKey, lkSetKey, lkStatus } from '../../data/platform';
import { buildCatalog, type Catalog } from './catalog';
import { CATALOG_MAX_AGE, fetchResourceList, lk } from './client';
import { LkError, isAborted, transportError } from './errors';
import { shouldRecheck } from './status';

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// ── Verbindung ───────────────────────────────────────────────────────────────

export type Connection =
  /** Noch nicht geprüft. */
  | { phase: 'idle'; hasKey: boolean | null }
  | { phase: 'checking'; hasKey: boolean | null }
  | {
      phase: 'ready';
      hasKey: boolean | null;
      project: { id: string; name: string };
      checkedAt: number;
    }
  | { phase: 'failed'; hasKey: boolean | null; error: LkError; checkedAt: number };

const connection = createStore<Connection>({ phase: 'idle', hasKey: null });
let checking: Promise<Connection> | null = null;

async function runCheck(force: boolean): Promise<Connection> {
  // In der Vorschau gibt es keinen Schlüsselbund; `hasKey` bleibt dort unbekannt.
  let hasKey: boolean | null = null;
  connection.set({ phase: 'checking', hasKey: connection.get().hasKey });
  try {
    if (isDesktopApp()) {
      hasKey = (await lkStatus()).hasKey;
      if (!hasKey) throw new LkError('not-configured');
    }
    const project = await lk.project({ force });
    return { phase: 'ready', hasKey, project, checkedAt: Date.now() };
  } catch (cause) {
    return { phase: 'failed', hasKey, error: transportError(cause), checkedAt: Date.now() };
  }
}

/** Prüft, ob LegendKeeper erreichbar ist und zu welchem Projekt der Key gehört. */
export function checkConnection(force = false): Promise<Connection> {
  if (!checking) {
    checking = runCheck(force)
      .then((result) => {
        connection.set(result);
        return result;
      })
      .finally(() => {
        checking = null;
      });
  }
  return checking;
}

/**
 * Stand der Verbindung. Prüft beim ersten Gebrauch von selbst – und noch einmal, wenn die letzte
 * Prüfung an etwas Vorübergehendem scheiterte und eine Weile her ist.
 */
export function useConnection(): Connection {
  const state = useSyncExternalStore(connection.subscribe, connection.get);
  useEffect(() => {
    const current = connection.get();
    if (current.phase === 'idle') void checkConnection();
    else if (shouldRecheck(current, Date.now())) void checkConnection(true);
  }, []);
  return state;
}

/** Nach einem Wechsel des Keys gilt nichts Gemerktes mehr. */
function resetSession() {
  lk.forget();
  catalogAbort?.abort();
  catalogAbort = null;
  catalog.set(EMPTY_CATALOG);
}

/**
 * Legt den Key im Schlüsselbund des Systems ab und prüft ihn gleich. Der Key wird hier nur
 * durchgereicht – nie gemerkt, nie in die Kampagne geschrieben. Wirft den Satz der App-Seite,
 * wenn das Ablegen scheitert.
 */
export async function saveKey(key: string): Promise<Connection> {
  await lkSetKey(key);
  resetSession();
  return checkConnection(true);
}

export async function removeKey(): Promise<Connection> {
  await lkClearKey();
  resetSession();
  return checkConnection(true);
}

// ── Verzeichnis aller Artikel ────────────────────────────────────────────────

export interface CatalogState {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  /** Bisher geladene Artikel (während des Ladens). */
  loaded: number;
  catalog: Catalog | null;
  error: LkError | null;
  loadedAt: number | null;
}

const EMPTY_CATALOG: CatalogState = {
  status: 'idle',
  loaded: 0,
  catalog: null,
  error: null,
  loadedAt: null,
};
const catalog = createStore<CatalogState>(EMPTY_CATALOG);
let catalogAbort: AbortController | null = null;

/** Lädt das Verzeichnis, wenn es fehlt oder veraltet ist. Ein vorhandenes bleibt solange sichtbar. */
export function ensureCatalog(force = false): void {
  const current = catalog.get();
  if (current.status === 'loading') return;
  const fresh =
    current.status === 'ready' &&
    current.loadedAt !== null &&
    Date.now() - current.loadedAt < CATALOG_MAX_AGE;
  if (fresh && !force) return;
  const controller = new AbortController();
  catalogAbort = controller;
  catalog.set({ ...current, status: 'loading', loaded: 0, error: null });
  fetchResourceList({
    signal: controller.signal,
    force,
    onPage: (loaded) => {
      if (catalogAbort === controller) catalog.set({ ...catalog.get(), loaded });
    },
  }).then(
    (items) => {
      if (catalogAbort !== controller) return;
      const built = buildCatalog(items);
      catalog.set({
        status: 'ready',
        loaded: built.entries.length,
        catalog: built,
        error: null,
        loadedAt: Date.now(),
      });
    },
    (cause: unknown) => {
      if (catalogAbort !== controller || isAborted(cause)) return;
      catalog.set({ ...catalog.get(), status: 'failed', error: transportError(cause) });
    },
  );
}

/** Das Verzeichnis aller Artikel. Lädt es, sobald `enabled` gilt (Verbindung steht). */
export function useCatalog(enabled: boolean): CatalogState {
  const state = useSyncExternalStore(catalog.subscribe, catalog.get);
  useEffect(() => {
    if (enabled) ensureCatalog();
  }, [enabled]);
  return state;
}
