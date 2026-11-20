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
 *   ai_status() -> { hasKey: boolean }
 *   ai_set_key({ key })   ai_clear_key()                    Claude-Key, ebenfalls im Schlüsselbund
 *   ai_ask({ request }) -> { status: number, body: string }       ein Leseauftrag an die Claude-API
 *   media_list({ root }) -> string[]                        Namen der Bilder in <root>/media
 *   media_fetch({ root, url, name }) -> number              holt ein Bild (nur https) nach <root>/media/<name>;
 *                                                           Ergebnis: Größe in Bytes
 *   Adressschema „wfmedia“                                   liefert <root>/media/<name> an das Fenster
 *   app_close({ state: 'saving' | 'syncing' | 'saved' | 'unsaved' })
 *                                                           Antwort auf das Ereignis „close-requested“:
 *                                                           sofort „saving“, nach dem Speichern „saved“ –
 *                                                           oder „unsaved“, dann fragt die App nach;
 *                                                           „syncing“ = gespeichert, der Abgleich lädt
 *                                                           noch hoch (höchstens 12 s, die Frist steht in Rust)
 *
 * Abgleich mit einer privaten Ablage bei GitHub (Entwurf docs/abgleich/abgleich-entwurf-fertig.md,
 * Abschnitt 4.4). Fehler kommen als { kind, message, retryAfter } (→ `SyncFailure`):
 *   sync_state({ root, dataVersion }) -> SyncStateInfo         ohne Netz; liest den Schlüssel einmal je Start
 *   sync_set_key({ key })   sync_clear_key()                   Zugangsschlüssel im Schlüsselbund
 *   sync_probe({ owner?, repo? }) -> SyncProbeResult           wer bin ich, welche Ablage
 *   sync_link({ root, link, moveTo? })                         verbindung.json schreiben; null = trennen
 *   sync_recover({ root }) -> { finished, left }               liegenden Merkzettel zu Ende bringen (ohne Netz)
 *   sync_scan({ root, remote, retryKey?, link? }) -> SyncScan  lokale Liste, Kopf und Baum der Ablage
 *   sync_fetch({ root, items, link? }) -> FetchedFile[]        Fassungen nach .abgleich/eingang/
 *   sync_apply_begin({ … }) -> { run, busy }                   beiseitelegen, dann Merkzettel
 *   sync_apply_end({ root, run }) -> { done, left }            gemeinsamen Stand nachtragen, Merkzettel weg
 *   sync_apply_abort({ root, run })
 *   sync_push({ … }) -> { head, tree }                         hochladen, Umschalten nie mit „force“
 *   sync_mark({ root, base?, decided?, synced?, dropBase?, olderEdits? })
 *   sync_aside_list({ root }) / sync_aside_read / sync_aside_put / sync_aside_drop
 *   Ereignis „sync-progress“ { phase, done, total }
 *
 * Die Rust-Seite meldet Fehler als deutschen Satz. Hier wird daraus ein gewöhnlicher Error,
 * damit `error.message` überall den Satz liefert.
 */
import { convertFileSrc, invoke as tauriInvoke } from '@tauri-apps/api/core';
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

/** Kampagnenordner auf der Festplatte. */
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
    void listen<{ paths: string[] }>('store-changed', (event) =>
      onChange(event.payload.paths),
    ).then((fn) => {
      if (stopped) fn();
      else unlisten = fn;
    });
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
export type LkQuery = Record<
  string,
  string | number | boolean | null | Array<string | number | boolean>
>;

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

// ── KI-Leser (nur in der installierten App) ──────────────────────────────────

export interface AiStatus {
  hasKey: boolean;
}

/** Was gelesen werden soll: Modell, Auftrag, Text und die Form der Antwort. */
export interface AiAskRequest {
  model: string;
  system: string;
  user: string;
  schema: unknown;
  maxTokens: number;
}

/** Antwort der Claude-API, unverändert: auch 401 oder 429 kommen so zurück. */
export interface AiAskResponse {
  status: number;
  body: string;
}

/** Ist ein Claude-Key im Schlüsselbund des Systems hinterlegt? */
export const aiStatus = () => invoke<AiStatus>('ai_status');
/** Legt den Key im Schlüsselbund ab. Er verlässt die Rust-Seite danach nie wieder. */
export const aiSetKey = (key: string) => invoke<void>('ai_set_key', { key });
export const aiClearKey = () => invoke<void>('ai_clear_key');
/**
 * Schickt einen Leseauftrag an Claude. Die Adresse ist fest eingebaut. Schlägt fehl, wenn kein
 * Key hinterlegt ist oder keine Verbindung zustande kommt.
 */
export const aiAsk = (request: AiAskRequest) => invoke<AiAskResponse>('ai_ask', { request });

// ── Bilder (nur in der installierten App) ────────────────────────────────────

/** Was eine vollständige Kopie der Kampagne enthält (F19). */
export interface CopyReport {
  folder: string;
  files: number;
  media: number;
  bytes: number;
}

/**
 * Kopiert den ganzen Kampagnenordner – Daten und Bilder, ohne den Zustand des Abgleichs – in
 * einen neuen Ordner `name` unter `target`. Überschreibt nie etwas.
 */
export const campaignCopy = (root: string, target: string, name: string) =>
  invoke<CopyReport>('campaign_copy', { root, target, name });

/** Namen der Bilder, die im Kampagnenordner unter „media“ liegen. */
export const mediaList = (root: string) => invoke<string[]>('media_list', { root });
/** Holt ein Bild aus dem Netz in den Kampagnenordner. Ergebnis: Größe der Datei in Bytes. */
export const mediaFetch = (root: string, url: string, name: string) =>
  invoke<number>('media_fetch', { root, url, name });
/** Die Adresse, unter der das Fenster ein Bild aus dem Kampagnenordner lädt. */
export const mediaAddress = (name: string): string => convertFileSrc(name, 'wfmedia');

// ── Schließen (nur in der installierten App) ─────────────────────────────────

/** Schreibt, was noch aussteht. Ergebnis: Ist jetzt alles gespeichert? */
export type ClosingHandler = () => Promise<boolean>;

const closingHandlers = new Set<ClosingHandler>();
const afterSaveHandlers = new Set<() => Promise<void>>();

/**
 * Meldet an, was vor dem Schließen des Fensters noch gespeichert werden muss. Die App wartet
 * darauf; bleibt etwas ungespeichert, fragt sie nach, statt die Änderungen stillschweigend zu
 * verlieren. Gibt die Abmeldung zurück. In der Browser-Vorschau geschieht nichts.
 */
export function onAppClosing(handler: ClosingHandler): () => void {
  closingHandlers.add(handler);
  return () => {
    closingHandlers.delete(handler);
  };
}

/** Fragt alle angemeldeten Stellen. Ein Fehler zählt als „nicht gespeichert“. */
export async function settleBeforeClosing(handlers: Iterable<ClosingHandler>): Promise<boolean> {
  const results = await Promise.all([...handlers].map((handler) => handler().catch(() => false)));
  return results.every(Boolean);
}

if (isDesktopApp()) {
  void listen('close-requested', async () => {
    // Sofort melden, dass gespeichert wird – sonst schließt das Fenster nach kurzer Frist von selbst.
    await invoke('app_close', { state: 'saving' }).catch(() => undefined);
    const saved = await settleBeforeClosing(closingHandlers);
    if (saved && afterSaveHandlers.size) {
      // Gespeichert; der Abgleich lädt noch hoch. Die Frist (12 s) wacht auf der Rust-Seite.
      await invoke('app_close', { state: 'syncing' }).catch(() => undefined);
      await settleAfterSave(afterSaveHandlers);
    }
    await invoke('app_close', { state: saved ? 'saved' : 'unsaved' }).catch(() => undefined);
  });
}

/**
 * Meldet an, was nach gelungenem Speichern vor dem Schließen noch geschehen soll (der Abgleich
 * lädt hoch). Die App wartet höchstens `CLOSE_SYNC_MS` und schließt danach in jedem Fall. Gibt
 * die Abmeldung zurück.
 */
export function onAppClosingAfterSave(handler: () => Promise<void>): () => void {
  afterSaveHandlers.add(handler);
  return () => {
    afterSaveHandlers.delete(handler);
  };
}

/** „Sofort schließen“ während der Abgleich beim Schließen noch hochlädt (Tafel 1.6). */
export const closeNow = () =>
  isDesktopApp() ? invoke<void>('app_close', { state: 'saved' }) : Promise.resolve();

/** So lange darf der Abgleich beim Schließen noch hochladen. */
export const CLOSE_SYNC_MS = 12_000;

/** Wartet auf alle angemeldeten Stellen, höchstens `ms` lang. Fehler zählen nicht. */
export async function settleAfterSave(
  handlers: Iterable<() => Promise<void>>,
  ms: number = CLOSE_SYNC_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)));
  await Promise.race([
    Promise.all([...handlers].map((handler) => handler().catch(() => undefined))),
    deadline,
  ]);
  clearTimeout(timer);
}

// ── Abgleich (nur in der installierten App) ──────────────────────────────────

export interface SyncLink {
  owner: string;
  repo: string;
  branch: string;
  /** So heißt dieser Rechner im Abgleich („Windows-PC“, „MacBook“). */
  device: string;
  /** Der Kampagnenordner, für den der Abgleich eingerichtet wurde. */
  root: string;
}
export interface SyncFile {
  path: string;
  sha: string;
  size: number;
}
export interface SyncFrozen {
  path: string;
  reason: 'case' | 'encoding' | 'size' | 'locked';
}
export interface SyncDecision {
  choice: 'local' | 'remote' | 'ok' | 'back';
  /** Die Kennung der Fassung dort, für die die Entscheidung gilt (null = dort gelöscht). */
  remote: string | null;
  /** Die strittigen Angaben (Feldpfade); null = die ganze Fassung. */
  fields: string[][] | null;
}
export type RemoteKind = 'empty' | 'fresh' | 'wayfarer' | 'foreign';
export interface Marker {
  datenstand: number;
  gestalt: string;
  geraete: Record<string, number>;
}
export interface SyncStateInfo {
  key: 'yes' | 'no' | 'denied';
  link: SyncLink | null;
  moved: boolean;
  hasBase: boolean;
  pending: 'run' | 'adopt' | 'remoteWins' | null;
  older: boolean;
  syncedAt: string | null;
  device: string | null;
  pushedAt: string | null;
  aside: number;
  /** Hier wurde ein ganzer Stand eingespielt (Sicherung, Neuanfang) – Frage 1.9. */
  restored: boolean;
}
export interface RepoInfo {
  owner: string;
  repo: string;
  branch: string;
  isPrivate: boolean;
  canPush: boolean;
  archived: boolean;
  kind: RemoteKind | null;
}
export interface FoundRepo {
  info: RepoInfo;
  kind: RemoteKind;
  files: number;
  marker: Marker | null;
  device: string | null;
  pushedAt: string | null;
  campaign: string | null;
  state: string | null;
}
export interface SyncProbeResult {
  login: string;
  repos: RepoInfo[];
  found: FoundRepo | null;
}
export interface RemoteScan {
  live: boolean;
  kind: RemoteKind;
  isPrivate: boolean;
  /** Die Ablage steht hinter dem zuletzt Gesehenen (oder daneben). */
  behind: boolean;
  head: string | null;
  tree: string | null;
  files: SyncFile[];
  marker: Marker | null;
  device: string | null;
  pushedAt: string | null;
}
export interface SyncScan {
  link: SyncLink | null;
  base: Record<string, string> | null;
  decided: Record<string, SyncDecision>;
  local: SyncFile[];
  frozen: SyncFrozen[];
  /** So viele Einträge eines liegenden Merkzettels wurden eben nachgetragen. */
  settled: number;
  maxVersion: number;
  olderEdits: boolean;
  /** Hier wurde ein ganzer Stand eingespielt (Sicherung, Neuanfang) – Frage 1.9. */
  restored: boolean;
  remote: RemoteScan | null;
}
export interface FetchItem {
  sha: string;
  path?: string;
}
export interface FetchedFile {
  sha: string;
  /** null = kein sauberes UTF-8. */
  content: string | null;
}
export type ApplyWrite = { path: string; expect: string | null; base: string | null } & (
  { sha: string } | { content: string }
);
export type ApplyKind = 'run' | 'adopt' | 'remoteWins';
export type AsideReason =
  'abgleich' | 'entscheidung' | 'erster-abgleich' | 'eingespielt' | 'zurueckholen';
export interface ApplyBeginInput {
  root: string;
  kind: ApplyKind;
  head: string | null;
  reason: AsideReason;
  writes: ApplyWrite[];
  deletes: { path: string; expect: string }[];
  /** Fassungen von dort (aus dem Eingang), die zusätzlich beiseitegelegt werden. */
  keep: { path: string; sha: string }[];
  link?: SyncLink;
  baseAll?: Record<string, string>;
}
export interface PushCounts {
  changed: number;
  added: number;
  removed: number;
}
export interface PushInput {
  root: string;
  head: string | null;
  tree: string | null;
  changes: { path: string; sha: string | null }[];
  dataVersion: number;
  dataShape: string;
  counts: PushCounts;
  /** Nur beim ersten Abgleich, bevor die Verbindung steht. */
  link?: SyncLink;
}
export interface MarkInput {
  root: string;
  base?: { path: string; sha: string | null }[];
  decided?: Record<string, SyncDecision | null>;
  synced?: boolean;
  dropBase?: boolean;
  olderEdits?: boolean;
}
export interface AsideEntry {
  side: 'hier' | 'dort';
  path: string;
  sha: string;
  title: string;
}
export interface AsideRun {
  run: number;
  at: string;
  reason: AsideReason;
  entries: AsideEntry[];
}
export type SyncErrorKind =
  | 'offline'
  | 'server'
  | 'limit'
  | 'key'
  | 'nokey'
  | 'keychain'
  | 'denied'
  | 'missing'
  | 'moved'
  | 'busy'
  | 'local'
  | 'input';

/** Ein Fehler des Abgleichs: die Art (nie am Wortlaut erkannt), ein Satz, ggf. Wartezeit in Sekunden. */
export class SyncFailure extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    message: string,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

const SYNC_KINDS: readonly SyncErrorKind[] = [
  'offline',
  'server',
  'limit',
  'key',
  'nokey',
  'keychain',
  'denied',
  'missing',
  'moved',
  'busy',
  'local',
  'input',
];

/** Macht aus dem, was die Rust-Seite meldet, einen `SyncFailure`. */
export function toSyncFailure(error: unknown): SyncFailure {
  if (error instanceof SyncFailure) return error;
  if (error && typeof error === 'object' && 'kind' in error && 'message' in error) {
    const raw = error as { kind: unknown; message: unknown; retryAfter?: unknown };
    const kind = SYNC_KINDS.includes(raw.kind as SyncErrorKind)
      ? (raw.kind as SyncErrorKind)
      : 'server';
    return new SyncFailure(
      kind,
      String(raw.message),
      typeof raw.retryAfter === 'number' ? raw.retryAfter : null,
    );
  }
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unerwarteter Fehler.';
  return new SyncFailure('local', message);
}

async function invokeSync<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    throw toSyncFailure(error);
  }
}

/** Optionale Angaben ohne `undefined` weitergeben. */
const defined = (args: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));

export const syncState = (root: string, dataVersion: number) =>
  invokeSync<SyncStateInfo>('sync_state', { root, dataVersion });
export const syncSetKey = (key: string) => invokeSync<void>('sync_set_key', { key });
export const syncClearKey = () => invokeSync<void>('sync_clear_key');
export const syncProbe = (owner?: string, repo?: string) =>
  invokeSync<SyncProbeResult>('sync_probe', defined({ owner, repo }));
export const syncLink = (root: string, link: SyncLink | null, moveTo?: boolean) =>
  invokeSync<void>('sync_link', defined({ root, link, moveTo }));
export const syncRecover = (root: string) =>
  invokeSync<{ finished: number; left: { path: string; sha: string }[] }>('sync_recover', { root });
export const syncScan = (root: string, remote: boolean, retryKey?: boolean, link?: SyncLink) =>
  invokeSync<SyncScan>('sync_scan', defined({ root, remote, retryKey, link }));
export const syncFetch = (root: string, items: FetchItem[], link?: SyncLink) =>
  invokeSync<FetchedFile[]>('sync_fetch', defined({ root, items, link }));
export const syncApplyBegin = (input: ApplyBeginInput) =>
  invokeSync<{ run: number; busy: string[] }>('sync_apply_begin', defined(input));
export const syncApplyEnd = (root: string, run: number) =>
  invokeSync<{ done: string[]; left: string[] }>('sync_apply_end', { root, run });
export const syncApplyAbort = (root: string, run: number) =>
  invokeSync<void>('sync_apply_abort', { root, run });
export const syncPush = (input: PushInput) =>
  invokeSync<{ head: string; tree: string }>('sync_push', defined(input));
export const syncMark = (input: MarkInput) => invokeSync<void>('sync_mark', defined(input));
export const syncAsideList = (root: string) => invokeSync<AsideRun[]>('sync_aside_list', { root });
export const syncAsideRead = (root: string, run: number, side: 'hier' | 'dort', path: string) =>
  invokeSync<string>('sync_aside_read', { root, run, side, path });
export const syncAsidePut = (root: string, paths: string[], reason: AsideReason) =>
  invokeSync<{ run: number }>('sync_aside_put', { root, paths, reason });
export const syncAsideDrop = (root: string, run: number) =>
  invokeSync<void>('sync_aside_drop', { root, run });

/** Fortschritt eines Abgleichs (Lesen, Holen, Hochladen, Ablegen). */
export interface SyncProgress {
  phase: 'lesen' | 'holen' | 'hochladen' | 'ablegen';
  done: number;
  total: number;
}

/** Meldet den Fortschritt. Gibt die Abmeldung zurück. */
export function onSyncProgress(fn: (progress: SyncProgress) => void): () => void {
  let stopped = false;
  let unlisten: (() => void) | null = null;
  void listen<SyncProgress>('sync-progress', (event) => fn(event.payload)).then((off) => {
    if (stopped) off();
    else unlisten = off;
  });
  return () => {
    stopped = true;
    unlisten?.();
  };
}
