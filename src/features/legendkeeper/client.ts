/**
 * Zugriffsschicht auf LegendKeeper – ausschließlich lesend (nur GET).
 *
 * Zwei Wege:
 *  - installierte App: über die Rust-Seite (`lk_get`); der API-Key liegt im Schlüsselbund des
 *    Systems und ist für die Oberfläche nie sichtbar.
 *  - Browser-Vorschau: über den Entwicklungs-Proxy „/lk-api“ (siehe vite.config.ts). Dort gibt
 *    es keinen Key; Antworten kommen nur, wenn die Entwicklungsumgebung selbst einen einsetzt.
 *
 * Darüber: Zwischenspeicher mit Ablaufzeit, Zusammenlegen gleicher Anfragen, Abbruch veralteter
 * Anfragen und seitenweises Laden.
 */
import { isDesktopApp, lkGet as invokeLkGet, type LkQuery } from '../../data/platform';
import { LkError, isPassing, parseRetryAfter, readResponse, transportError } from './errors';
import type {
  LkDocumentBlocks,
  LkPage,
  LkProject,
  LkResource,
  LkResourceListItem,
  LkSearchHit,
} from './types';

export type { LkQuery };
export type LkMode = 'desktop' | 'preview';

/** Rohantwort eines Weges: Status und Text, unverändert. */
export interface LkRawResponse {
  status: number;
  body: string;
  retryAfterSec?: number;
}

/** Ein Weg zur API. Wirft `LkError`, wenn gar keine Antwort zustande kommt. */
export interface LkTransport {
  readonly mode: LkMode;
  get(path: string, query: LkQuery | undefined, signal: AbortSignal): Promise<LkRawResponse>;
}

export interface LkGetOptions {
  /** Bricht ab, sobald das Ergebnis niemand mehr braucht. */
  signal?: AbortSignal;
  /**
   * So alt darf eine gemerkte Antwort höchstens sein (Millisekunden). Eine ältere wird neu
   * geholt – scheitert das an einer vorübergehenden Störung (kein Netz, keine Antwort), gilt
   * die ältere weiter: am Tisch bleibt lesbar, was schon einmal da war.
   */
  maxAgeMs?: number;
  /** Gemerkte Antwort übergehen und neu holen – ohne Rückgriff auf die alte („Aktualisieren“). */
  force?: boolean;
}

export interface LkListOptions extends LkGetOptions {
  pageSize?: number;
  maxPages?: number;
  /** Wird nach jeder geladenen Seite mit der bisherigen Anzahl aufgerufen. */
  onPage?: (loaded: number) => void;
}

export interface LkClient {
  readonly mode: LkMode;
  /** Liest einen Pfad der API, z. B. „/projects“. */
  get<T>(path: string, query?: LkQuery, options?: LkGetOptions): Promise<T>;
  /** Liest eine Liste vollständig, Seite für Seite. */
  list<T>(path: string, query?: LkQuery, options?: LkListOptions): Promise<T[]>;
  /** Das Projekt, zu dem der Key gehört. Alle weiteren Pfade hängen darunter. */
  project(options?: LkGetOptions): Promise<Required<LkProject>>;
  /** Vergisst gemerkte Antworten – alle oder die, deren Pfad passt. */
  forget(match?: (path: string) => boolean): void;
  /** Wann die gemerkte Antwort zu einem Pfad tatsächlich geholt wurde – falls eine gemerkt ist. */
  fetchedAt(path: string, query?: LkQuery): number | undefined;
}

const MINUTE = 60_000;
export const ARTICLE_MAX_AGE = 5 * MINUTE;
export const CATALOG_MAX_AGE = 15 * MINUTE;
export const SEARCH_MAX_AGE = MINUTE;
const PROJECT_MAX_AGE = 60 * MINUTE;

/** Zeitgrenze im Browser. Die App-Seite bricht selbst nach 25 Sekunden ab; hier nur die Reserve. */
const PREVIEW_TIMEOUT_MS = 25_000;
const DESKTOP_TIMEOUT_MS = 40_000;

/** Abfrageparameter als Zeile: Listen werden wiederholt, `null` entfällt. Namen sortiert. */
export function queryString(query: LkQuery | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const name of Object.keys(query).sort()) {
    const value = query[name];
    if (value === null || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(name, String(item));
  }
  const line = params.toString();
  return line ? `?${line}` : '';
}

const cacheKey = (path: string, query: LkQuery | undefined) => `${path}${queryString(query)}`;
const pathOfKey = (key: string) => key.split('?')[0] ?? key;

interface Flight {
  promise: Promise<unknown>;
  controller: AbortController;
  waiters: number;
}

/**
 * In der Vorschau gibt es keinen Key. Lehnt LegendKeeper ab oder antwortet statt der API eine
 * Webseite, heißt das schlicht: hier besteht kein Zugang.
 */
function previewError(error: LkError, path: string): LkError {
  if (error.kind === 'unauthorized') return new LkError('preview', { status: error.status });
  if (error.kind === 'unexpected' && path === '/projects')
    return new LkError('preview', { status: error.status });
  if (error.kind === 'server' && !error.code)
    return new LkError('offline', { status: error.status });
  return error;
}

export function createLkClient(transport: LkTransport, now: () => number = Date.now): LkClient {
  const cache = new Map<string, { at: number; value: unknown }>();
  const flights = new Map<string, Flight>();
  /** Zählt hoch, wenn alles vergessen wird; Antworten von davor werden nicht mehr gemerkt. */
  let generation = 0;

  function start(key: string, path: string, query: LkQuery | undefined): Flight {
    const controller = new AbortController();
    const born = generation;
    const flight: Flight = { promise: Promise.resolve(), controller, waiters: 0 };
    flight.promise = transport
      .get(path, query, controller.signal)
      .then((raw) => readResponse<unknown>(raw.status, raw.body, raw.retryAfterSec))
      .then(
        (value) => {
          if (born === generation) cache.set(key, { at: now(), value });
          return value;
        },
        (cause: unknown) => {
          const error = transportError(cause);
          throw transport.mode === 'preview' ? previewError(error, path) : error;
        },
      )
      .finally(() => {
        if (flights.get(key) === flight) flights.delete(key);
      });
    // Ohne Zuhörer (alle abgesprungen) darf ein Fehler nicht als unbehandelt gelten.
    flight.promise.catch(() => undefined);
    flights.set(key, flight);
    return flight;
  }

  /** Wartet auf eine laufende Anfrage. Springt der letzte Wartende ab, wird sie abgebrochen. */
  function join<T>(key: string, flight: Flight, signal: AbortSignal | undefined): Promise<T> {
    flight.waiters += 1;
    return new Promise<T>((resolve, reject) => {
      let left = false;
      const leave = () => {
        left = true;
        signal?.removeEventListener('abort', onAbort);
        flight.waiters -= 1;
      };
      const onAbort = () => {
        if (left) return;
        leave();
        if (flight.waiters === 0) {
          if (flights.get(key) === flight) flights.delete(key);
          flight.controller.abort();
        }
        reject(new LkError('aborted'));
      };
      signal?.addEventListener('abort', onAbort);
      flight.promise.then(
        (value) => {
          if (left) return;
          leave();
          resolve(value as T);
        },
        (error: unknown) => {
          if (left) return;
          leave();
          reject(error);
        },
      );
    });
  }

  const client: LkClient = {
    mode: transport.mode,

    get<T>(path: string, query?: LkQuery, options: LkGetOptions = {}): Promise<T> {
      const { signal, maxAgeMs = ARTICLE_MAX_AGE, force = false } = options;
      if (signal?.aborted) return Promise.reject(new LkError('aborted'));
      const key = cacheKey(path, query);
      const hit = force ? undefined : cache.get(key);
      if (hit && now() - hit.at <= maxAgeMs) return Promise.resolve(hit.value as T);
      const fresh = join<T>(key, flights.get(key) ?? start(key, path, query), signal);
      if (!hit) return fresh;
      return fresh.catch((error: unknown) => {
        // Bei einer vorübergehenden Störung ist die ältere Antwort besser als gar keine.
        if (isPassing(error)) return hit.value as T;
        throw error;
      });
    },

    async list<T>(path: string, query: LkQuery = {}, options: LkListOptions = {}): Promise<T[]> {
      const { pageSize = 100, maxPages = 200, onPage, ...rest } = options;
      const items: T[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < maxPages; page += 1) {
        const answer: LkPage<T> = await client.get<LkPage<T>>(
          path,
          { ...query, limit: pageSize, cursor },
          rest,
        );
        if (!Array.isArray(answer.data)) {
          throw new LkError('unexpected', { detail: 'LegendKeeper hat keine Liste geschickt.' });
        }
        items.push(...answer.data);
        onPage?.(items.length);
        const next = answer.hasMore ? (answer.nextCursor ?? null) : null;
        if (!next || next === cursor) break;
        cursor = next;
      }
      return items;
    },

    async project(options: LkGetOptions = {}): Promise<Required<LkProject>> {
      const page = await client.get<LkPage<LkProject>>(
        '/projects',
        { limit: 1 },
        { maxAgeMs: PROJECT_MAX_AGE, ...options },
      );
      const first = Array.isArray(page.data) ? page.data[0] : undefined;
      if (!first || typeof first.id !== 'string' || !first.id) {
        throw new LkError('unexpected', {
          detail: 'Zu diesem API-Key gehört kein LegendKeeper-Projekt.',
        });
      }
      const name =
        typeof first.name === 'string' && first.name.trim()
          ? first.name.trim()
          : 'LegendKeeper-Projekt';
      return { id: first.id, name };
    },

    forget(match?: (path: string) => boolean) {
      if (!match) {
        generation += 1;
        cache.clear();
        for (const flight of flights.values()) flight.controller.abort();
        flights.clear();
        return;
      }
      for (const key of [...cache.keys()]) if (match(pathOfKey(key))) cache.delete(key);
    },

    fetchedAt(path: string, query?: LkQuery) {
      return cache.get(cacheKey(path, query))?.at;
    },
  };
  return client;
}

// ── Die beiden Wege ──────────────────────────────────────────────────────────

/** Lässt ein Versprechen an einer Zeitgrenze oder einem Abbruch scheitern. */
function guarded<T>(work: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const finish = (settle: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      settle();
    };
    const onAbort = () => finish(() => reject(new LkError('aborted')));
    const timer = setTimeout(() => finish(() => reject(new LkError('timeout'))), timeoutMs);
    signal.addEventListener('abort', onAbort);
    work.then(
      (value) => finish(() => resolve(value)),
      (cause: unknown) => finish(() => reject(cause)),
    );
  });
}

/** Installierte App: die Rust-Seite ruft ab und setzt den Key aus dem Schlüsselbund ein. */
export const desktopTransport: LkTransport = {
  mode: 'desktop',
  async get(path, query, signal) {
    try {
      // Ein laufender Abruf der App-Seite lässt sich nicht stoppen; sein Ergebnis wird dann verworfen.
      return await guarded(invokeLkGet(path, query), DESKTOP_TIMEOUT_MS, signal);
    } catch (cause) {
      throw transportError(cause);
    }
  },
};

export const PREVIEW_BASE = '/lk-api';

/** Browser-Vorschau: über den Entwicklungs-Proxy. Schickt selbst nie einen Key mit. */
export const previewTransport: LkTransport = {
  mode: 'preview',
  async get(path, query, signal) {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), PREVIEW_TIMEOUT_MS);
    const onAbort = () => timeout.abort();
    signal.addEventListener('abort', onAbort);
    try {
      const response = await fetch(`${PREVIEW_BASE}${path}${queryString(query)}`, {
        signal: timeout.signal,
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'omit',
      });
      const body = await response.text();
      return {
        status: response.status,
        body,
        retryAfterSec: parseRetryAfter(response.headers.get('retry-after')),
      };
    } catch (cause) {
      if (signal.aborted) throw new LkError('aborted');
      if (timeout.signal.aborted) throw new LkError('timeout');
      throw transportError(cause);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
  },
};

// ── Der eine Zugang der App ──────────────────────────────────────────────────

export const lk: LkClient = createLkClient(isDesktopApp() ? desktopTransport : previewTransport);

/** Liest einen Pfad der LegendKeeper-API. Wirft `LkError`. */
export function lkGet<T>(path: string, query?: LkQuery, options?: LkGetOptions): Promise<T> {
  return lk.get<T>(path, query, options);
}

/** Kennungen von LegendKeeper sind kurze Folgen aus Buchstaben und Ziffern. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function idSegment(id: string): string {
  if (!ID_PATTERN.test(id)) throw new LkError('not-found', { detail: 'Ungültige Kennung.' });
  return id;
}

async function projectPath(rest: string, options?: LkGetOptions): Promise<string> {
  const project = await lk.project({ signal: options?.signal });
  return `/projects/${idSegment(project.id)}${rest}`;
}

/** Ein Artikel mit Dokumenten, Eigenschaften der Seitenleiste und Pfad. */
export async function fetchResource(
  resourceId: string,
  options?: LkGetOptions,
): Promise<LkResource> {
  const path = await projectPath(`/resources/${idSegment(resourceId)}`, options);
  return lk.get<LkResource>(path, undefined, options);
}

/** Der Inhalt eines Seiten-Dokuments als Blöcke. */
export async function fetchBlocks(
  resourceId: string,
  documentId: string,
  options?: LkGetOptions,
): Promise<LkDocumentBlocks> {
  const path = await projectPath(
    `/resources/${idSegment(resourceId)}/docs/${idSegment(documentId)}/blocks`,
    options,
  );
  return lk.get<LkDocumentBlocks>(path, undefined, options);
}

/** Alle Artikel des Projekts (ohne Inhalte), Seite für Seite. */
export async function fetchResourceList(options?: LkListOptions): Promise<LkResourceListItem[]> {
  const path = await projectPath('/resources', options);
  return lk.list<LkResourceListItem>(path, {}, { maxAgeMs: CATALOG_MAX_AGE, ...options });
}

/** Volltextsuche von LegendKeeper: Namen, Zweitnamen und Inhalte. */
export async function searchRemote(
  text: string,
  limit: number,
  options?: LkGetOptions,
): Promise<LkSearchHit[]> {
  const q = text.trim().slice(0, 200);
  if (!q) return [];
  const path = await projectPath('/search', options);
  const page = await lk.get<LkPage<LkSearchHit>>(
    path,
    { q, limit },
    { maxAgeMs: SEARCH_MAX_AGE, ...options },
  );
  return Array.isArray(page.data) ? page.data : [];
}

/** Vergisst alles, was zu einem Artikel gemerkt ist (für „Aktualisieren“). */
export function forgetResource(resourceId: string): void {
  lk.forget(
    (path) =>
      path.endsWith(`/resources/${resourceId}`) || path.includes(`/resources/${resourceId}/`),
  );
}

/**
 * Wann ein Artikel (oder der Text einer seiner Seiten) zuletzt wirklich aus LegendKeeper geholt
 * wurde. Eine gemerkte Antwort kann einige Minuten alt sein; der Zeitpunkt der Anzeige wäre
 * dann geschönt.
 */
export function articleFetchedAt(
  projectId: string,
  resourceId: string,
  documentId?: string | null,
): number | undefined {
  const base = `/projects/${projectId}/resources/${resourceId}`;
  return lk.fetchedAt(documentId ? `${base}/docs/${documentId}/blocks` : base);
}

/** Adresse eines Artikels in LegendKeeper selbst – zum Öffnen im Browser. */
export function articleUrl(
  projectId: string,
  resourceId: string,
  documentId?: string | null,
): string {
  const parts = [projectId, resourceId, ...(documentId ? [documentId] : [])].map(
    encodeURIComponent,
  );
  return `https://www.legendkeeper.com/p/${parts.join('/')}/`;
}
