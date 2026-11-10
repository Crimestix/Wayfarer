/**
 * Was beim Lesen aus LegendKeeper schiefgehen kann – und wie Wayfarer es dem Spielleiter sagt.
 * Reine Funktionen; die Oberfläche zeigt nur an, was hier entschieden wird.
 */
import type { LkErrorBody } from './types';

export type LkErrorKind =
  /** Installierte App: es ist noch kein Key hinterlegt. */
  | 'not-configured'
  /** Browser-Vorschau: dort gibt es keinen Key und damit keinen Zugang. */
  | 'preview'
  /** LegendKeeper lehnt den Key ab (unbekannt, widerrufen, abgelaufen). */
  | 'unauthorized'
  /** Der Key darf das nicht (Rolle, anderes Projekt). */
  | 'forbidden'
  /** Das Projekt hat keinen bezahlten Tarif; Keys funktionieren dann nicht. */
  | 'plan'
  /** Den Artikel gibt es nicht (mehr) oder der Key sieht ihn nicht. */
  | 'not-found'
  | 'rate-limited'
  | 'offline'
  | 'timeout'
  /** LegendKeeper selbst hat einen Fehler gemeldet (Status ab 500). */
  | 'server'
  /** Antwort, mit der Wayfarer nichts anfangen kann (kein JSON, unbekannter Aufbau). */
  | 'unexpected'
  /** Die Anfrage wurde überholt und verworfen. Wird nie angezeigt. */
  | 'aborted';

export interface LkErrorInfo {
  status?: number;
  /** Fehlercode der API, z. B. `WRONG_PROJECT`. */
  code?: string;
  /** Bei „zu viele Anfragen“: Sekunden, bis es wieder geht – falls bekannt. */
  retryAfterSec?: number;
  /** Zusatz für die Anzeige, z. B. der Satz, den die App-Seite geliefert hat. */
  detail?: string;
}

export class LkError extends Error {
  readonly kind: LkErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly retryAfterSec?: number;
  readonly detail?: string;

  constructor(kind: LkErrorKind, info: LkErrorInfo = {}) {
    super(`LegendKeeper: ${kind}${info.status ? ` (${info.status})` : ''}`);
    this.name = 'LkError';
    this.kind = kind;
    this.status = info.status;
    this.code = info.code;
    this.retryAfterSec = info.retryAfterSec;
    this.detail = info.detail;
  }
}

export const isLkError = (value: unknown): value is LkError => value instanceof LkError;
export const isAborted = (value: unknown): boolean => isLkError(value) && value.kind === 'aborted';

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function errorBody(body: string): LkErrorBody {
  const parsed = parseJson(body);
  if (!parsed || typeof parsed !== 'object') return {};
  const { code, message } = parsed as Record<string, unknown>;
  return {
    code: typeof code === 'string' ? code : undefined,
    message: typeof message === 'string' ? message : undefined,
  };
}

/** „Retry-After“ in Sekunden; die API schickt eine Zahl. Unbrauchbares wird zu `undefined`. */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(Math.ceil(seconds), 24 * 3600);
}

/**
 * Wertet eine Antwort der API aus: gibt den gelesenen Inhalt zurück oder wirft einen `LkError`.
 * LegendKeeper beantwortet Adressen, die es in der API nicht gibt, mit einer HTML-Seite –
 * auch das wird hier als Fehler erkannt, nicht als Inhalt.
 */
export function readResponse<T>(status: number, body: string, retryAfterSec?: number): T {
  if (status >= 200 && status < 300) {
    const parsed = parseJson(body);
    if (parsed === undefined || parsed === null || typeof parsed !== 'object') {
      throw new LkError('unexpected', { status, detail: 'Die Antwort ist kein lesbarer Inhalt.' });
    }
    return parsed as T;
  }
  const { code } = errorBody(body);
  const info: LkErrorInfo = { status, code };
  if (status === 401) throw new LkError('unauthorized', info);
  if (status === 402) throw new LkError('plan', info);
  if (status === 403) throw new LkError('forbidden', info);
  // Ein echtes „gibt es nicht“ kommt als JSON mit Code; eine HTML-Seite heißt: falsche Adresse.
  if (status === 404) throw new LkError(code ? 'not-found' : 'unexpected', info);
  if (status === 429) throw new LkError('rate-limited', { ...info, retryAfterSec });
  if (status === 408 || status === 504) throw new LkError('timeout', info);
  if (status >= 500) throw new LkError('server', info);
  throw new LkError('unexpected', info);
}

/**
 * Der Satz, den die App-Seite zu einem Fehler geliefert hat – als Text oder als schlichter
 * `Error` (so reicht `platform.ts` ihn weiter). Fehler des Browsers (TypeError …) zählen nicht.
 */
export function appSentence(cause: unknown): string | undefined {
  if (typeof cause === 'string') return cause.trim() || undefined;
  if (cause instanceof Error && cause.name === 'Error' && !(cause instanceof LkError)) {
    return cause.message.trim() || undefined;
  }
  return undefined;
}

/**
 * Ordnet einen Fehler ein, bei dem gar keine Antwort der API zustande kam. Die App-Seite meldet
 * solche Fehler als deutschen Satz; im Browser wirft `fetch` einen `TypeError`.
 */
export function transportError(cause: unknown): LkError {
  if (isLkError(cause)) return cause;
  if (cause instanceof DOMException && cause.name === 'AbortError') return new LkError('aborted');
  const text = typeof cause === 'string' ? cause : cause instanceof Error ? cause.message : '';
  if (/kein LegendKeeper-Key|noch kein .*Key/i.test(text)) return new LkError('not-configured');
  if (/nicht rechtzeitig|Zeitüberschreitung|timed? ?out/i.test(text)) return new LkError('timeout');
  if (/nicht erreichbar|Internetverbindung|Failed to fetch|NetworkError|Load failed/i.test(text)) {
    return new LkError('offline');
  }
  // Ein Satz der App-Seite ist bereits für den Spielleiter geschrieben und wird mit angezeigt.
  return new LkError('offline', { detail: appSentence(cause) });
}

/** Wo der Fehler angezeigt wird – der Text passt sich an. */
export type LkErrorContext = 'article' | 'search' | 'connection';

export interface LkErrorView {
  title: string;
  text: string;
  /** Was der Spielleiter als Nächstes tun kann. */
  action: 'settings' | 'retry' | 'none';
  /** Geht es um Gefahr (rot) oder nur um einen Hinweis? */
  tone: 'hint' | 'problem';
}

function waitText(seconds: number | undefined): string {
  if (seconds === undefined) return 'in etwa einer Minute';
  if (seconds <= 1) return 'gleich';
  if (seconds < 90) return `in ${seconds} Sekunden`;
  return `in etwa ${Math.round(seconds / 60)} Minuten`;
}

/** Überschrift, Erklärung und nächster Schritt zu einem Fehler – in ganzen deutschen Sätzen. */
export function describeError(error: LkError, context: LkErrorContext = 'article'): LkErrorView {
  switch (error.kind) {
    case 'not-configured':
      return {
        title: 'LegendKeeper ist noch nicht eingerichtet',
        text: 'Hinterlege in den Einstellungen den Schlüssel (API-Key) deines LegendKeeper-Projekts. Danach kannst du hier Artikel nachschlagen und verknüpfen.',
        action: 'settings',
        tone: 'hint',
      };
    case 'preview':
      return {
        title: 'Nur in der installierten App',
        text: 'Die Vorschau im Browser hat keinen Zugang zu LegendKeeper. Die Verbindung wird in der installierten App eingerichtet; dort liegt der Schlüssel sicher im Schlüsselbund des Systems.',
        action: 'settings',
        tone: 'hint',
      };
    case 'unauthorized':
      return {
        title: 'LegendKeeper lehnt den Schlüssel ab',
        text: 'Der hinterlegte API-Key ist unbekannt, abgelaufen oder wurde widerrufen. Erzeuge in LegendKeeper einen neuen und trage ihn in den Einstellungen ein.',
        action: 'settings',
        tone: 'problem',
      };
    case 'forbidden':
      return {
        title: 'Kein Zugriff',
        text:
          error.code === 'WRONG_PROJECT'
            ? 'Der API-Key gehört zu einem anderen LegendKeeper-Projekt als dem, das Wayfarer lesen wollte. Prüfe den Key in den Einstellungen.'
            : 'Der API-Key darf das nicht lesen. Prüfe in LegendKeeper, welche Rolle der Key hat.',
        action: 'settings',
        tone: 'problem',
      };
    case 'plan':
      return {
        title: 'LegendKeeper verlangt einen bezahlten Tarif',
        text: 'API-Keys funktionieren nur, solange das Projekt in einem bezahlten LegendKeeper-Tarif liegt (die Testphase zählt nicht).',
        action: 'none',
        tone: 'problem',
      };
    case 'not-found':
      return context === 'article'
        ? {
            title: 'Artikel nicht gefunden',
            text: 'Diesen Artikel gibt es in LegendKeeper nicht mehr – oder der API-Key darf ihn nicht sehen. Löse die Verknüpfung und wähle den passenden Artikel neu.',
            action: 'retry',
            tone: 'problem',
          }
        : {
            title: 'Nicht gefunden',
            text: 'LegendKeeper kennt das Gesuchte nicht (mehr).',
            action: 'retry',
            tone: 'problem',
          };
    case 'rate-limited':
      return {
        title: 'Zu viele Anfragen',
        text: `LegendKeeper bremst gerade, weil in kurzer Zeit sehr viel abgerufen wurde. Versuche es ${waitText(error.retryAfterSec)} noch einmal.`,
        action: 'retry',
        tone: 'hint',
      };
    case 'offline':
      return {
        title: 'Keine Verbindung zu LegendKeeper',
        text: error.detail ?? 'LegendKeeper ist nicht erreichbar. Besteht eine Internetverbindung?',
        action: 'retry',
        tone: 'problem',
      };
    case 'timeout':
      return {
        title: 'LegendKeeper antwortet nicht',
        text: 'Die Anfrage hat zu lange gedauert und wurde abgebrochen. Versuche es gleich noch einmal.',
        action: 'retry',
        tone: 'problem',
      };
    case 'server':
      return {
        title: 'LegendKeeper meldet eine Störung',
        text: 'Der Fehler liegt bei LegendKeeper, nicht bei dir. Versuche es in ein paar Minuten noch einmal.',
        action: 'retry',
        tone: 'problem',
      };
    case 'aborted':
      return {
        title: 'Abgebrochen',
        text: 'Die Anfrage wurde abgebrochen.',
        action: 'retry',
        tone: 'hint',
      };
    case 'unexpected':
    default:
      return {
        title: 'Unerwartete Antwort von LegendKeeper',
        text:
          error.detail ??
          'LegendKeeper hat etwas geschickt, das Wayfarer nicht lesen kann. Möglicherweise hat sich dort etwas geändert.',
        action: 'retry',
        tone: 'problem',
      };
  }
}
