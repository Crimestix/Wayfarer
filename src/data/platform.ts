/**
 * Brücke zur installierten App (Tauri). In der Browser-Vorschau gibt es sie nicht;
 * dann arbeitet Wayfarer mit einer Ablage im Browser und ohne LegendKeeper.
 *
 * Die Rust-Seite (src-tauri) stellt genau diese Befehle bereit:
 *   config_get() -> { campaignDir: string | null }
 *   config_set({ campaignDir: string | null })
 *   store_read_all({ root }) -> { path, content }[]        nur *.json, rekursiv
 *   store_read({ root, path }) -> string | null
 *   store_write({ root, path, content })                    atomar (temporäre Datei + Umbenennen)
 *   store_remove({ root, path })
 *   store_watch({ root })                                   sendet Ereignis „store-changed“ { paths: string[] }
 *   lk_status() -> { hasKey: boolean }
 *   lk_set_key({ key })   lk_clear_key()                    Schlüssel liegt im Schlüsselbund des Systems
 *   lk_get({ path, query }) -> { status: number, body: string }   nur GET auf die LegendKeeper-API
 *
 * Die Rust-Seite meldet Fehler als deutschen Satz. Hier wird daraus ein gewöhnlicher Error,
 * damit `error.message` überall den Satz liefert.
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { CampaignStore, StoredFile } from './store';

/** Ruft einen Befehl der Rust-Seite auf; Fehler kommen als Error mit verständlichem Satz an. */
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(typeof error === 'string' ? error : 'Unerwarteter Fehler in der App.');
  }
}

export const isDesktopApp = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface AppConfig {
  campaignDir: string | null;
}

export const getConfig = () => invoke<AppConfig>('config_get');
export const setConfig = (config: AppConfig) => invoke<void>('config_set', { ...config });

/** Kampagnenordner auf der Festplatte (oder im Cloud-Laufwerk). */
export class FolderStore implements CampaignStore {
  constructor(readonly root: string) {}
  get location() {
    return this.root;
  }
  readAll() {
    return invoke<StoredFile[]>('store_read_all', { root: this.root });
  }
  read(path: string) {
    return invoke<string | null>('store_read', { root: this.root, path });
  }
  write(path: string, content: string) {
    return invoke<void>('store_write', { root: this.root, path, content });
  }
  remove(path: string) {
    return invoke<void>('store_remove', { root: this.root, path });
  }
  watch(onChange: (paths: string[]) => void) {
    let stopped = false;
    let unlisten: (() => void) | null = null;
    // Ohne Überwachung läuft die App weiter; Änderungen von außen erscheinen dann erst beim nächsten Start.
    invoke('store_watch', { root: this.root }).catch((error) =>
      console.warn('Der Kampagnenordner wird nicht überwacht:', error),
    );
    void listen<{ paths: string[] }>('store-changed', (event) => onChange(event.payload.paths)).then(
      (fn) => {
        if (stopped) fn();
        else unlisten = fn;
      },
    );
    return () => {
      stopped = true;
      unlisten?.();
    };
  }
}

/** Fragt nach einem Ordner. Gibt null zurück, wenn abgebrochen wurde. */
export async function pickFolder(title: string): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const result = await open({ directory: true, multiple: false, title });
  return typeof result === 'string' ? result : null;
}

// ── LegendKeeper (nur in der installierten App) ──────────────────────────────

export interface LkStatus {
  hasKey: boolean;
}

/** Antwort der LegendKeeper-API, unverändert: auch 401 oder 404 kommen so zurück. */
export interface LkResponse {
  status: number;
  body: string;
}

/** Abfrageparameter: Name → Wert (Listen werden wiederholt, null entfällt). */
export type LkQuery = Record<string, string | number | boolean | null | Array<string | number | boolean>>;

/** Ist ein LegendKeeper-Key im Schlüsselbund des Systems hinterlegt? */
export const lkStatus = () => invoke<LkStatus>('lk_status');
/** Legt den Key im Schlüsselbund ab. Er verlässt die Rust-Seite danach nie wieder. */
export const lkSetKey = (key: string) => invoke<void>('lk_set_key', { key });
export const lkClearKey = () => invoke<void>('lk_clear_key');
/**
 * Liest von der LegendKeeper-API. `path` ist ein Pfad innerhalb der API, z. B. „/projects“ –
 * nie eine vollständige Adresse. Schlägt fehl, wenn kein Key hinterlegt ist oder keine
 * Verbindung zustande kommt.
 */
export const lkGet = (path: string, query?: LkQuery) =>
  invoke<LkResponse>('lk_get', { path, query: query ?? null });
