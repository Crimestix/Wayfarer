/** Was die Einstellungen über die Verbindung sagen. Reine Funktionen. */
import { describeError, isPassing, type LkError } from './errors';

export interface StatusInput {
  phase: 'idle' | 'checking' | 'ready' | 'failed';
  projectName?: string;
  error?: LkError;
  /** Installierte App (mit Schlüsselbund) oder Vorschau im Browser. */
  desktop: boolean;
  catalog: { status: 'idle' | 'loading' | 'ready' | 'failed'; loaded: number };
  checkedAt?: number;
}

export interface StatusView {
  tone: 'ok' | 'off' | 'problem' | 'busy';
  title: string;
  text: string;
}

/** Uhrzeit wie „14:05“. */
export function clockTime(at: number): string {
  const date = new Date(at);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

const articles = (n: number) => (n === 1 ? '1 Artikel' : `${n.toLocaleString('de-DE')} Artikel`);

function catalogText(catalog: StatusInput['catalog']): string {
  switch (catalog.status) {
    case 'ready':
      return `${articles(catalog.loaded)} im Verzeichnis`;
    case 'loading':
      return catalog.loaded > 0
        ? `Verzeichnis wird geladen – bisher ${articles(catalog.loaded)}`
        : 'Verzeichnis wird geladen …';
    case 'failed':
      return 'Das Verzeichnis der Artikel ließ sich nicht laden';
    default:
      return 'Projekt erreichbar';
  }
}

/** Eine Zeile Zustand: verbunden, nicht eingerichtet oder was schiefgeht. */
export function statusView(input: StatusInput): StatusView {
  if (input.phase === 'idle' || input.phase === 'checking') {
    return {
      tone: 'busy',
      title: 'Verbindung wird geprüft …',
      text: 'Wayfarer fragt bei LegendKeeper nach.',
    };
  }
  if (input.phase === 'ready') {
    const checked = input.checkedAt ? ` · geprüft um ${clockTime(input.checkedAt)}` : '';
    const how = input.desktop ? '' : ' · Zugang über die Entwicklungsumgebung';
    return {
      tone: 'ok',
      title: `Verbunden mit „${input.projectName ?? 'LegendKeeper-Projekt'}“`,
      text: `${catalogText(input.catalog)}${checked}${how}`,
    };
  }
  const error = input.error;
  if (!error || error.kind === 'not-configured') {
    return {
      tone: 'off',
      title: 'Noch nicht eingerichtet',
      text: 'Es ist kein API-Key hinterlegt. Ohne ihn kann Wayfarer keine Artikel nachschlagen.',
    };
  }
  if (error.kind === 'preview') {
    return {
      tone: 'off',
      title: 'In der Vorschau nicht verbunden',
      text: 'Die Vorschau im Browser hat keinen Zugang zu LegendKeeper. Eingerichtet wird die Verbindung in der installierten App – nur dort liegt der API-Key sicher im Schlüsselbund des Systems.',
    };
  }
  const view = describeError(error, 'connection');
  return { tone: 'problem', title: view.title, text: view.text };
}

export const RECHECK_AFTER_MS = 15_000;

/**
 * Soll die Verbindung von selbst noch einmal geprüft werden? Ja, wenn die letzte Prüfung an
 * etwas Vorübergehendem scheiterte (kein Netz, keine Antwort) und eine Weile her ist – etwa wenn
 * das WLAN am Spieltisch kurz weg war und man den nächsten Eintrag öffnet.
 */
export function shouldRecheck(
  state: { phase: string; error?: LkError; checkedAt?: number },
  now: number,
): boolean {
  if (state.phase !== 'failed' || !state.error || state.checkedAt === undefined) return false;
  // Was von selbst vorübergeht, ist kein Grund, auf einen Klick zu warten.
  return isPassing(state.error) && now - state.checkedAt >= RECHECK_AFTER_MS;
}
