/**
 * Worte und Zustände des Abgleichs für die Oberfläche – reine Funktionen (Entwurf, Abschnitt 1).
 * Komponenten rechnen nicht selbst: Was am Zeichen steht, wie eine Karte im Dialog „Das
 * entscheidest du“ heißt, wie ein Wert in Worten lautet, steht hier.
 *
 * Wörter: „Abgleich“, „Ablage bei GitHub“ (danach „Ablage“), „Zugangsschlüssel“; nie Commit,
 * Push, Merge, Token (außer GitHubs eigene Beschriftungen in Anführungszeichen), Dateipfade.
 * Gezählt wird in Einträgen.
 */
import { KIND_LABEL } from '../../domain/derive';
import {
  COLLECTION_NAMES,
  ENTITY_KINDS,
  type CampaignData,
  type CollectionName,
  type EntityKind,
} from '../../domain/schema';
import type { ChangeCounts } from '../../domain/sync';
import type { FieldClash, Json } from '../../domain/syncMerge';
import { formatClock, formatDate, formatDateTime } from '../../domain/time/calendar';
import type { SettleSummary } from '../../data/actions';
import type {
  FoundRepo,
  RepoInfo,
  SyncFailure,
  SyncFrozen,
  SyncLink,
  SyncProbeResult,
} from '../../data/platform';
import { COLLECTION_LABEL } from '../einstellungen/backup';
import type { Choice } from './engine';
import type { ConflictKind, FirstSyncInfo, NeedsWhy, RawConflict, SyncView } from './state';

// ── Feste Angaben ────────────────────────────────────────────────────────────

/** Vorschlag für den Namen der Ablage (Entscheidung des Spielleiters, 15. 11. 2026). */
export const SUGGESTED_REPO = 'spielstand-elaris';
export const GITHUB_HOME = 'https://github.com/';
export const NEW_REPO_URL = `https://github.com/new?name=${SUGGESTED_REPO}&visibility=private`;
/** Die neuen Fassungen von Wayfarer (Mac-Paket) – beim Bau festgelegt. */
export const RELEASES_URL = 'https://github.com/Crimestix/Wayfarer/releases';
export const DEVICE_MAX = 30;

/** Die Seite bei GitHub, auf der der Zugangsschlüssel entsteht – vorbelegt. */
export function tokenPageUrl(device: string): string {
  const name = encodeURIComponent(`Wayfarer ${device}`).replace(/%20/g, '+');
  return (
    'https://github.com/settings/personal-access-tokens/new' +
    `?name=${name}&description=Abgleich+des+Spielstands&expires_in=none&contents=write`
  );
}

/** So heißt dieser Rechner vorab: nach System. */
export function defaultDeviceName(userAgent: string): string {
  return /Mac/i.test(userAgent) ? 'MacBook' : 'Windows-PC';
}

/** Der Name des Rechners: 1–30 Zeichen ohne Leerraum am Rand; leer = ungültig. */
export function cleanDeviceName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, DEVICE_MAX);
}

export const isMacAgent = (userAgent: string) => /Mac/i.test(userAgent);

// ── Zahlen und Zeiten ────────────────────────────────────────────────────────

/** „3 480“ – Tausender mit schmalem Abstand. */
export function numberText(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** „1 Eintrag“ / „14 Einträge“. */
export const entries = (n: number) => `${numberText(n)} ${n === 1 ? 'Eintrag' : 'Einträge'}`;

const total = (c: ChangeCounts) => c.changed + c.added + c.removed;

const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const pad = (n: number) => String(n).padStart(2, '0');
const clockOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;

/** „15. November 2026, 21:40 Uhr“ (Ortszeit); leer, wenn unlesbar. */
export function dateTimeText(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${clockOf(d)}`;
}

/** „heute, 21:40 Uhr“, „gestern, 23:58 Uhr“, „Donnerstag, 21:40 Uhr“, sonst mit Datum. */
export function whenText(iso: string | null, now: Date): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days === 0) return `heute, ${clockOf(d)}`;
  if (days === 1) return `gestern, ${clockOf(d)}`;
  if (days > 1 && days < 7) return `${WEEKDAYS[d.getDay()]}, ${clockOf(d)}`;
  return dateTimeText(iso);
}

/** „21:55 Uhr“ für eine Wartezeit. */
export const clockText = (iso: string | null | undefined) =>
  iso && !Number.isNaN(new Date(iso).getTime()) ? clockOf(new Date(iso)) : '';

// ── Der andere Rechner ───────────────────────────────────────────────────────

export interface OtherWords {
  /** „MacBook“ / „Anderer Rechner“ (am Satzanfang). */
  name: string;
  /** „vom MacBook“ / „vom anderen Rechner“. */
  from: string;
  /** „am MacBook“ / „am anderen Rechner“. */
  at: string;
  /** „Am MacBook“ / „Am anderen Rechner“. */
  At: string;
  /** „Vom MacBook“ / „Vom anderen Rechner“. */
  From: string;
}

export function other(device: string | null | undefined): OtherWords {
  const name = device?.trim();
  if (!name)
    return {
      name: 'Anderer Rechner',
      from: 'vom anderen Rechner',
      at: 'am anderen Rechner',
      At: 'Am anderen Rechner',
      From: 'Vom anderen Rechner',
    };
  return { name, from: `vom ${name}`, at: `am ${name}`, At: `Am ${name}`, From: `Vom ${name}` };
}

/**
 * Ein Rechner am Satzanfang mit dem richtigen Artikel: „Das MacBook“, „Der Windows-PC“, sonst
 * „Der Rechner „Name““ (bei einem frei gewählten Namen ist das Geschlecht unbekannt).
 */
export function deviceSubject(device: string | null | undefined): string {
  const name = device?.trim();
  if (!name) return 'Der andere Rechner';
  if (name === 'MacBook') return 'Das MacBook';
  if (name === 'Windows-PC') return 'Der Windows-PC';
  return `Der Rechner „${name}“`;
}

/** Der andere Rechner aus Sicht dieses Rechners (nie dieser selbst). */
export function otherDevice(view: Pick<SyncView, 'other' | 'link' | 'peer'>): string | null {
  const device = view.other.device;
  if (device && device !== view.link?.device) return device;
  return view.peer && view.peer !== view.link?.device ? view.peer : null;
}

// ── Das Zeichen in der Leiste ────────────────────────────────────────────────

export type SignDot = 'ok' | 'due' | 'run' | 'hollow' | 'needs';
export type SignClick = 'sync' | 'none' | 'decide' | 'settings';

export interface SignView {
  label: string;
  /** Zweite, kleine Zeile (nur „MacBook braucht die neue Version“). */
  note: string | null;
  dot: SignDot;
  /** Was beim Daraufzeigen erscheint. */
  title: string;
  click: SignClick;
}

/** Der Stand des anderen Rechners in einem Satz: „Letzter Stand vom MacBook: gestern, 23:58 Uhr.“ */
function otherStand(view: SyncView, now: Date, label = 'Letzter Stand'): string {
  const when = whenText(view.other.pushedAt, now);
  const dev = otherDevice(view);
  if (!when || !dev) return '';
  return ` ${label} ${other(dev).from}: ${when}.`;
}

/** Das Zeichen unter „Gespeichert“ (1.4) – null = nichts zeigen. */
export function signOf(view: SyncView, now: Date): SignView | null {
  switch (view.phase) {
    case 'off':
      return null;
    case 'unlinked':
      return {
        label: 'Abgleich nicht verbunden',
        note: null,
        dot: 'hollow',
        title:
          'Auf diesem Rechner liegt ein Zugangsschlüssel, aber dieser Kampagnenordner ist nicht verbunden.',
        click: 'settings',
      };
    case 'running':
      return {
        label: 'Gleicht ab …',
        note: null,
        dot: 'run',
        title: 'Wayfarer gleicht mit deiner Ablage bei GitHub ab.',
        click: 'none',
      };
    case 'offline':
      return {
        label: 'Kein Netz',
        note: null,
        dot: 'hollow',
        title: `${offlineText(view)}${otherStand(view, now, 'Stand')} Klick: jetzt versuchen.`,
        click: 'sync',
      };
    case 'needsYou': {
      const why = view.needs?.why ?? 'local';
      return {
        label: 'Abgleich braucht dich',
        note: null,
        dot: 'needs',
        title: needsSentence(view, now),
        click: why === 'conflicts' ? 'decide' : 'settings',
      };
    }
    case 'synced': {
      const synced = whenText(view.syncedAt, now);
      const base = `${synced ? `Zuletzt abgeglichen: ${synced}.` : ''}${otherStand(view, now)} Klick: jetzt abgleichen.`;
      const note = view.otherNeedsUpdate
        ? `${view.otherNeedsUpdate} braucht die neue Version`
        : null;
      return {
        label: 'Abgeglichen',
        note,
        dot: view.due ? 'due' : 'ok',
        title: (
          (view.due ? 'Hier gibt es Änderungen, die gleich hochgeladen werden. ' : '') +
          (note ? `${note}. ` : '') +
          base
        ).trim(),
        click: 'sync',
      };
    }
  }
}

// ── Störungen und was der Spielleiter tun kann ───────────────────────────────

export function offlineText(view: Pick<SyncView, 'offline'>): string {
  switch (view.offline?.why) {
    case 'limit': {
      const at = clockText(view.offline.until);
      return at
        ? `GitHub bittet um eine Pause. Wayfarer versucht es um ${at} wieder.`
        : 'GitHub bittet um eine Pause. Wayfarer versucht es gleich wieder.';
    }
    case 'behind':
      return 'Die Ablage zeigt gerade einen älteren Stand als zuletzt. Wayfarer wartet und versucht es wieder.';
    default:
      return 'GitHub ist gerade nicht erreichbar. Alles ist auf diesem Rechner gespeichert; Wayfarer versucht es von selbst wieder.';
  }
}

/** Was ein Knopf bei „braucht dich“ tut. */
export type NeedsAction =
  | 'decide'
  | 'replaceKey'
  | 'retry'
  | 'retryKeychain'
  | 'resetup'
  | 'firstSync'
  | 'move'
  | 'releases'
  | 'none';

export interface NeedsInfo {
  title: string;
  text: string;
  action: NeedsAction;
  /** Beschriftung des Knopfs (bei `none`/`move`/`firstSync` ohne eigenen Knopf leer). */
  button: string;
}

const repoName = (link: SyncLink | null) => (link ? `${link.owner}/${link.repo}` : 'deine Ablage');

/** Warum der Abgleich den Spielleiter braucht – Titel, Satz, Handgriff (1.10, 1.11, 1.15). */
export function needsInfo(view: SyncView, now: Date): NeedsInfo | null {
  const why: NeedsWhy | undefined = view.needs?.why;
  if (!why) return null;
  switch (why) {
    case 'conflicts': {
      const n = view.conflicts.length;
      const since = whenText(view.heldSince, now);
      return {
        title:
          n === 1
            ? 'Ein Eintrag wartet auf deine Entscheidung'
            : `${n} Einträge warten auf deine Entscheidung`,
        text: since
          ? `Seit ${since} ${n === 1 ? 'kommt dieser Eintrag' : 'kommen diese Einträge'} nicht in die Ablage. Alles andere wird weiter abgeglichen.`
          : `${n === 1 ? 'Dieser Eintrag kommt' : 'Diese Einträge kommen'} nicht in die Ablage, bis du entschieden hast. Alles andere wird weiter abgeglichen.`,
        action: 'decide',
        button: 'Ansehen und entscheiden',
      };
    }
    case 'key':
      return {
        title: 'Der Zugangsschlüssel gilt nicht mehr',
        text: 'GitHub nimmt den Zugangsschlüssel nicht mehr an – er wurde gelöscht oder ist abgelaufen. Dein Spielstand ist davon nicht berührt.',
        action: 'replaceKey',
        button: 'Zugangsschlüssel ersetzen',
      };
    case 'nokey':
      return {
        title: 'Kein Zugangsschlüssel auf diesem Rechner',
        text: 'Dieser Kampagnenordner ist verbunden, aber auf diesem Rechner liegt kein Zugangsschlüssel. Dein Spielstand ist davon nicht berührt.',
        action: 'replaceKey',
        button: 'Zugangsschlüssel einfügen',
      };
    case 'denied':
      return {
        title: 'Der Zugangsschlüssel darf nicht schreiben',
        text: 'Der Zugangsschlüssel darf in deine Ablage nicht schreiben. Bei GitHub muss für ihn unter „Contents“ „Read and write“ gewählt sein.',
        action: 'replaceKey',
        button: 'Zugangsschlüssel ersetzen',
      };
    case 'missing':
      return {
        title: 'Die Ablage ist nicht zu finden',
        text: `Wayfarer findet die Ablage ${repoName(view.link)} nicht mehr. Wurde sie umbenannt oder gelöscht?`,
        action: 'retry',
        button: 'Noch einmal versuchen',
      };
    case 'public':
      return {
        title: 'Die Ablage ist öffentlich',
        text: 'Deine Ablage ist jetzt öffentlich. Wayfarer lädt nichts mehr hoch, bis sie wieder privat ist.',
        action: 'retry',
        button: 'Noch einmal versuchen',
      };
    case 'foreign':
      return {
        title: 'In der Ablage liegt kein Spielstand',
        text: `In ${repoName(view.link)} liegen Dateien, die nicht von Wayfarer stammen. Wayfarer gleicht nur mit einer eigenen Ablage für den Spielstand ab.`,
        action: 'resetup',
        button: 'Abgleich neu einrichten',
      };
    case 'emptied':
      return {
        title: 'Die Ablage ist leer',
        text: 'Deine Ablage ist leer, obwohl hier schon abgeglichen wurde. Wurde sie gelöscht und neu angelegt?',
        action: 'resetup',
        button: 'Abgleich neu einrichten',
      };
    case 'keychain':
      return {
        title: 'Der Schlüsselbund verweigert den Zugriff',
        text: 'Der Schlüsselbund gibt den Zugangsschlüssel nicht heraus.',
        action: 'retryKeychain',
        button: 'Noch einmal versuchen',
      };
    case 'moved':
      return {
        title: 'Dieser Ordner ist eine Kopie oder wurde verschoben',
        text: 'Bis du sagst, ob dieser Ordner abgleichen soll, geht keine Anfrage an GitHub.',
        action: 'move',
        button: '',
      };
    case 'version':
      return {
        title: 'Wayfarer ist auf diesem Rechner älter',
        // Gilt auf beiden Rechnern – die neue Version liegt für Mac und Windows am selben Ort.
        text: `${deviceSubject(otherDevice(view))} arbeitet mit einer neueren Version. Dieser Rechner holt weiter, was von dort kommt, lädt aber nichts hoch, bis du Wayfarer hier aktualisiert hast. Was du hier änderst, bleibt sicher auf diesem Rechner und wird danach abgeglichen. Die neue Version liegt bei GitHub unter „Releases“.`,
        action: 'releases',
        button: 'Seite öffnen',
      };
    case 'shape':
      return {
        title: 'Verschieden gebaute Fassungen von Wayfarer',
        text: 'Die beiden Rechner haben verschieden gebaute Fassungen von Wayfarer. Bis beide dieselbe haben, gleicht keiner ab.',
        action: 'retry',
        button: 'Noch einmal versuchen',
      };
    case 'firstSync':
      return {
        title: view.firstSync?.restored
          ? 'Du hast hier einen ganzen Stand eingespielt'
          : 'Zwei Spielstände – welcher gilt?',
        text: 'Wayfarer mischt nie von selbst. Sag, welcher Stand gilt – bis dahin wird nicht abgeglichen.',
        action: 'firstSync',
        button: 'Ansehen und entscheiden',
      };
    case 'local':
      return {
        title: 'Der Abgleich ist hängen geblieben',
        text: view.needs?.detail
          ? `${view.needs.detail} Dein Spielstand ist auf diesem Rechner gespeichert.`
          : 'Etwas auf diesem Rechner hat den Abgleich angehalten. Dein Spielstand ist auf diesem Rechner gespeichert.',
        action: 'retry',
        button: 'Noch einmal versuchen',
      };
  }
}

/** Der Grund in einem Satz – für das Zeichen beim Daraufzeigen. */
export function needsSentence(view: SyncView, now: Date): string {
  const info = needsInfo(view, now);
  if (!info) return 'Der Abgleich braucht dich.';
  if (view.needs?.why === 'conflicts') return `${info.title}. Klick: ansehen und entscheiden.`;
  return `${info.title}. Klick: zu Einstellungen → Abgleich.`;
}

// ── Zeilen im Abschnitt ──────────────────────────────────────────────────────

/** „14 Einträge vom MacBook übernommen, 3 hochgeladen“ – leer, wenn nichts. */
export function movedText(last: SyncView['last']): string {
  if (!last) return '';
  const down = total(last.down);
  const up = total(last.up);
  const parts: string[] = [];
  if (down) parts.push(`${entries(down)} ${other(last.from).from} übernommen`);
  if (up) parts.push(down ? `${numberText(up)} hochgeladen` : `${entries(up)} hochgeladen`);
  return parts.join(', ');
}

/** Rückmeldung nach „Jetzt abgleichen“ (1.5). */
export function resultLine(view: SyncView, now: Date): string {
  const sentence = (text: string) => (/[.…]$/.test(text) ? text : `${text}.`);
  switch (view.phase) {
    case 'synced': {
      const moved = movedText(view.last);
      return moved ? `Abgeglichen – ${moved}.` : 'Abgeglichen – nichts Neues.';
    }
    case 'offline':
      return offlineText(view);
    case 'needsYou':
      return sentence(needsInfo(view, now)?.title ?? 'Der Abgleich braucht dich');
    default:
      return '';
  }
}

/** Kopf des Abschnitts, wenn eingerichtet (1.14): fett und der Rest der Zeile. */
export function statusLine(view: SyncView, now: Date): { head: string; rest: string } {
  const sign = signOf(view, now);
  const parts: string[] = [];
  if (view.link) {
    parts.push(`verbunden mit ${view.link.owner}/${view.link.repo}`);
    parts.push(`dieser Rechner: ${view.link.device}`);
  }
  const synced = whenText(view.syncedAt, now);
  if (synced) parts.push(`zuletzt ${synced}`);
  const dev = otherDevice(view);
  const stand = whenText(view.other.pushedAt, now);
  if (dev && stand) parts.push(`letzter Stand ${other(dev).from}: ${stand}`);
  return { head: sign?.label ?? 'Abgleich', rest: parts.join(' · ') };
}

/** „Zuletzt abgeglichen: … · 14 Einträge vom MacBook übernommen, 3 hochgeladen“. */
export function lastLine(view: SyncView, now: Date): string {
  const synced = whenText(view.syncedAt, now);
  if (!synced) return '';
  const moved = movedText(view.last);
  return `Zuletzt abgeglichen: ${synced}${moved ? ` · ${moved}` : ''}`;
}

/** Die ruhige Zeile unter der Weltleiste (1.4) – null, wenn nichts zu holen ist. */
export function incomingText(view: Pick<SyncView, 'incoming' | 'phase'>): string | null {
  if (!view.incoming || view.incoming.count <= 0 || view.phase !== 'running') return null;
  return `${other(view.incoming.from).From} kommt Neues (${entries(view.incoming.count)}) – gleich da.`;
}

/** „Wieder offen: 2 Termine, 1 Schritt einer Uhr · zusammengelegt: 1 Termin“ (1.8 b). */
export function reopenedText(summary: SettleSummary | null): string | null {
  if (!summary) return null;
  const { events, steps, timers } = summary.reopened;
  const open: string[] = [];
  if (events) open.push(events === 1 ? '1 Termin' : `${events} Termine`);
  if (steps) open.push(steps === 1 ? '1 Schritt einer Uhr' : `${steps} Schritte von Uhren`);
  if (timers) open.push(timers === 1 ? '1 Timer' : `${timers} Timer`);
  const parts: string[] = [];
  if (open.length) parts.push(`Wieder offen: ${open.join(', ')}`);
  if (summary.merged)
    parts.push(
      `zusammengelegt: ${summary.merged === 1 ? '1 Termin' : `${summary.merged} Termine`}`,
    );
  return parts.length ? parts.join(' · ') : null;
}

/** Wie weit ein Fortschritt ist (0 bis 1) – null ohne Fortschritt. */
export function progressShare(progress: SyncView['progress']): number | null {
  if (!progress || progress.total <= 0) return null;
  return Math.min(1, Math.max(0, progress.done / progress.total));
}

/** Fortschritt in Worten: „Lade hoch … 1 200 von 3 480 Einträgen“. */
export function progressText(progress: SyncView['progress']): string | null {
  if (!progress || progress.total <= 0) return null;
  const verb =
    progress.phase === 'hochladen'
      ? 'Lade hoch …'
      : progress.phase === 'holen'
        ? 'Hole den Spielstand …'
        : progress.phase === 'ablegen'
          ? 'Lege ab …'
          : 'Lese …';
  return `${verb} ${numberText(progress.done)} von ${numberText(progress.total)} Einträgen`;
}

// ── Namen von Einträgen ──────────────────────────────────────────────────────

type JsonObject = { [key: string]: Json };
const isObj = (v: Json | undefined): v is JsonObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: Json | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const short = (text: string, max = 48) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/** Sammlung und Kennung aus dem Pfad. */
export function pathParts(path: string): { collection: string | null; id: string | null } {
  const m = /^([a-z]{1,32})\/([A-Za-z0-9_-]{1,64})\.json$/.exec(path);
  return m ? { collection: m[1]!, id: m[2]! } : { collection: null, id: null };
}

const isCollection = (name: string | null): name is CollectionName =>
  !!name && (COLLECTION_NAMES as readonly string[]).includes(name);

/** Der Name, den ein Dokument selbst trägt (Name, Titel, Session, Anfang des Textes). */
export function ownName(json: Json | null | undefined): string | null {
  if (!isObj(json)) return null;
  const named = str(json.name) ?? str(json.title) ?? str(json.label);
  if (named) return short(named, 60);
  if (typeof json.number === 'number') return `Session ${json.number}`;
  const text = str(json.text) ?? str(json.summary);
  return text ? short(text.split('\n')[0]!) : null;
}

/** Die Art eines Eintrags in Worten („Person“, „Geschichte“, „Chronikeintrag“). */
export function kindWord(path: string, json: Json | null | undefined): string {
  if (path === 'campaign.json') return 'Kampagne';
  if (path === 'state.json') return 'Stand am Spieltisch';
  const { collection } = pathParts(path);
  if (collection === 'entities' && isObj(json) && typeof json.kind === 'string') {
    const kind = json.kind as EntityKind;
    if ((ENTITY_KINDS as readonly string[]).includes(kind)) return KIND_LABEL[kind];
  }
  if (isCollection(collection)) return COLLECTION_LABEL[collection][0];
  return 'Eintrag';
}

/** Ein Dokument des geladenen Spielstands zu einem Pfad. */
function docOf(data: CampaignData | null, path: string): Json | null {
  if (!data) return null;
  if (path === 'campaign.json') return data.campaign as unknown as Json;
  if (path === 'state.json') return data.state as unknown as Json;
  const { collection, id } = pathParts(path);
  if (!isCollection(collection) || !id) return null;
  const doc = (data[collection] as Record<string, unknown>)[id];
  return (doc as Json | undefined) ?? null;
}

/** „Person „Aldric““, „Chronikeintrag „Die Brücke brennt““, „Stand am Spieltisch“. */
export function entryLabel(
  path: string,
  json: Json | null | undefined,
  data: CampaignData | null,
): string {
  const doc = json ?? docOf(data, path);
  const kind = kindWord(path, doc);
  if (path === 'state.json') return kind;
  const name = ownName(doc);
  return name ? `${kind} „${name}“` : kind;
}

/** Der Name zu einer Kennung irgendwo im Spielstand (für Verweise in Werten). */
export function nameOfId(id: string, data: CampaignData | null): string | null {
  if (!data) return null;
  const entity = data.entities[id];
  if (entity) return entity.name;
  for (const name of COLLECTION_NAMES) {
    if (name === 'entities') continue;
    const doc = (data[name] as Record<string, unknown>)[id] as Json | undefined;
    if (doc !== undefined) return ownName(doc) ?? COLLECTION_LABEL[name][0];
  }
  return null;
}

// ── Angaben in Worten ────────────────────────────────────────────────────────

/** Bezeichnungen der Felder. Ohne Eintrag: „Angabe ohne Namen“ – aber immer mit beiden Werten. */
export const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  title: 'Titel',
  text: 'Text',
  summary: 'Zusammenfassung',
  notes: 'Notizen',
  secret: 'Geheimnis',
  tagline: 'Ein Satz',
  aliases: 'Weitere Namen',
  kind: 'Art',
  parentId: 'Liegt in',
  ownerId: 'Antreiber',
  placeId: 'Ort der Gruppe',
  sessionId: 'Laufende Session',
  travelBy: 'Reist mit',
  march: 'Marschordnung',
  now: 'Weltzeit',
  previousNow: 'Weltzeit vor dem letzten Sprung',
  at: 'Zeitpunkt',
  done: 'erledigt',
  failed: 'gescheitert',
  inPlay: 'im Spiel',
  hidden: 'verborgen',
  stub: 'Platzhalter',
  attitude: 'Haltung',
  type: 'Art der Beziehung',
  from: 'Von',
  to: 'Zu',
  refs: 'Beteiligte',
  scenes: 'Szenen',
  steps: 'Schritte',
  hints: 'Hinweise',
  questions: 'Fragen',
  needs: 'Was noch fehlt',
  stakes: 'Was auf dem Spiel steht',
  ending: 'Ende',
  memo: 'Merkzettel',
  image: 'Bild',
  price: 'Preis',
  tableRules: 'Regeln des Tisches',
  calendar: 'Kalender',
  warmestMonth: 'Wärmster Monat',
  aiModel: 'Sprachmodell des KI-Lesers',
  sign: 'Woran merkt die Gruppe das?',
  number: 'Nummer',
  plan: 'Wo wir stehen',
  goal: 'Ziel',
  level: 'Stufe',
  born: 'Geboren',
  ended: 'Lebensende',
};

/** Ein Element einer Liste heißt so („Szene „Der Überfall““). */
const ITEM_WORDS: Record<string, string> = {
  scenes: 'Szene',
  steps: 'Schritt',
  hints: 'Hinweis',
  questions: 'Frage',
  entries: 'Zeile',
  secrets: 'Geheimnis',
  pages: 'Seite',
  stock: 'Ware',
  facilities: 'Einrichtung',
  markers: 'Punkt',
  lines: 'Linie',
  ages: 'Zeitalter',
};

/** Felder, deren Zahl eine Weltzeit ist. */
const TIME_FIELDS = new Set(['now', 'previousNow', 'at', 'startedAt', 'endedAt', 'due', 'when']);

export interface WordsContext {
  data: CampaignData | null;
  /** So heißt dieser Rechner – er ist nie „der andere“. */
  self?: string | null;
  /** So heißt der andere Rechner, wenn bekannt (Marke der Ablage). */
  peer?: string | null;
}

/** Ein Wert in Worten – oder null, wenn er sich nicht lesbar zeigen lässt. */
export function valueWords(
  value: Json | undefined,
  key: string | null,
  ctx: WordsContext,
  group?: string,
): string | null {
  const cal = ctx.data?.campaign.calendar;
  if (group === 'time' && isObj(value) && typeof value.now === 'number' && cal)
    return formatDateTime(cal, value.now);
  if (value === undefined) return 'nicht vorhanden';
  if (value === null) return 'leer';
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  if (typeof value === 'number') {
    if (key && TIME_FIELDS.has(key) && cal && Number.isInteger(value))
      return formatDateTime(cal, value);
    return String(value);
  }
  if (typeof value === 'string') {
    if (!value.trim()) return 'leer';
    const named = nameOfId(value, ctx.data);
    if (named) return `„${named}“`;
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return dateTimeText(value) || value;
    return value;
  }
  if (Array.isArray(value)) {
    if (!value.length) return 'keine';
    const words = value.map((v) =>
      isObj(v) ? ownName(v) : typeof v === 'string' ? (nameOfId(v, ctx.data) ?? v) : null,
    );
    if (words.some((w) => w === null)) return null;
    const shown = words.slice(0, 6).map((w) => `„${w}“`);
    return value.length > 6
      ? `${shown.join(', ')} und ${value.length - 6} weitere`
      : shown.join(', ');
  }
  const named = ownName(value);
  return named ? `„${named}“` : null;
}

/** Die Bezeichnung einer strittigen Angabe aus ihrem Weg durch das Dokument. */
export function fieldLabel(at: readonly string[], doc: Json | null): string {
  const parts: (string | null)[] = [];
  let here: Json | undefined = doc ?? undefined;
  let listKey: string | null = null;
  at.forEach((seg, i) => {
    if (Array.isArray(here)) {
      const item = here.find((x) => isObj(x) && x.id === seg);
      const word = (listKey && ITEM_WORDS[listKey]) ?? 'Eintrag';
      const name = ownName(item);
      // Statt „Szenen“ steht dort die eine Szene.
      parts.pop();
      parts.push(name ? `${word} „${name}“` : word);
      here = item;
      listKey = null;
      return;
    }
    // Ein Feldname, den die Tabelle nicht kennt, erscheint nie als Wort aus dem Programm.
    parts.push(FIELD_LABELS[seg] ?? (i === at.length - 1 ? 'Angabe ohne Namen' : null));
    listKey = seg;
    here = isObj(here) ? here[seg] : undefined;
  });
  const shown = parts.filter((p): p is string => !!p);
  return shown.length ? shown.join(' – ') : 'Angabe ohne Namen';
}

// ── Karten im Dialog „Das entscheidest du“ (1.8) ─────────────────────────────

export interface CardRow {
  label: string;
  here: string;
  there: string;
  /** Lange Texte: als Zeilenvergleich mit „Text kopieren“. */
  long: boolean;
}

export interface CardOption {
  choice: Choice;
  label: string;
}

export interface ConflictCard {
  id: string;
  kind: ConflictKind;
  heading: string;
  /** „Eintrag zuletzt geändert – hier: … · MacBook: …“ */
  stamps: string | null;
  lead: string | null;
  rows: CardRow[];
  options: CardOption[];
  /** Vorgewählt (nur bei Gelöscht gegen Geändert). */
  preset: Choice | null;
  note: string | null;
}

const isLong = (a: Json | undefined, b: Json | undefined) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  (a.length > 90 || b.length > 90 || a.includes('\n') || b.includes('\n'));

/** Die Zeilen einer Karte – null, wenn eine Angabe nichts Lesbares zeigen kann. */
export function clashRows(
  fields: readonly FieldClash[],
  doc: Json | null,
  ctx: WordsContext,
): CardRow[] | null {
  const rows: CardRow[] = [];
  for (const f of fields) {
    const key = f.at[f.at.length - 1] ?? null;
    const long = isLong(f.local, f.remote);
    const here = long ? String(f.local) : valueWords(f.local, key, ctx, f.group);
    const there = long ? String(f.remote) : valueWords(f.remote, key, ctx, f.group);
    if (here === null || there === null) return null;
    rows.push({
      label: f.group === 'time' ? 'Weltzeit' : fieldLabel(f.at, doc),
      here,
      there,
      long,
    });
  }
  return rows;
}

/** „20. Tauwind 701, 14:30“ und der Ort, wenn er sich unterscheidet. */
function timeChoiceLabel(
  side: 'here' | 'there',
  conflict: RawConflict,
  ctx: WordsContext,
  dev: OtherWords,
): string {
  const json = side === 'here' ? conflict.local.json : conflict.remote.json;
  const otherJson = side === 'here' ? conflict.remote.json : conflict.local.json;
  const cal = ctx.data?.campaign.calendar;
  const now = isObj(json) && typeof json.now === 'number' ? json.now : null;
  const when = now !== null && cal ? `${formatDate(cal, now)}, ${formatClock(now)}` : 'unbekannt';
  const place = isObj(json) && typeof json.placeId === 'string' ? json.placeId : null;
  const otherPlace =
    isObj(otherJson) && typeof otherJson.placeId === 'string' ? otherJson.placeId : null;
  const where =
    place && place !== otherPlace
      ? ` · in ${nameOfId(place, ctx.data) ?? 'einem anderen Ort'}`
      : '';
  return side === 'here'
    ? `Weltzeit von hier: ${when}${where}`
    : `Weltzeit ${dev.from}: ${when}${where}`;
}

function stampsOf(conflict: RawConflict, dev: OtherWords): string | null {
  const here = dateTimeText(conflict.local.at);
  const there = dateTimeText(conflict.remote.at);
  if (!here && !there) return null;
  const parts: string[] = [];
  if (here) parts.push(`hier: ${here}`);
  if (there) parts.push(`${dev.name}: ${there}`);
  return `Eintrag zuletzt geändert – ${parts.join(' · ')}`;
}

/** Ein paar Beispiele für „sehr viel auf einmal“. */
function examples(paths: readonly string[], data: CampaignData | null): string {
  const named = paths.filter((p) => ownName(docOf(data, p)));
  if (named.length) {
    const shown = named.slice(0, 3).map((p) => entryLabel(p, null, data));
    return ` (zum Beispiel: ${shown.join(', ')}${paths.length > shown.length ? ' …' : ''})`;
  }
  // Was hier fehlt, hat hier keinen Namen mehr – nie dreimal „Eintrag der Welt“: nach Art gezählt.
  const byKind = new Map<CollectionName | null, number>();
  for (const p of paths) {
    const { collection } = pathParts(p);
    const key = isCollection(collection) ? collection : null;
    byKind.set(key, (byKind.get(key) ?? 0) + 1);
  }
  const plural = (c: CollectionName | null, n: number) =>
    c ? COLLECTION_LABEL[c][n === 1 ? 0 : 1] : n === 1 ? 'Eintrag' : 'Einträge';
  if (byKind.size === 1) {
    const [c, n] = [...byKind][0]!;
    return c ? ` (alles ${plural(c, n)})` : '';
  }
  return ` (${[...byKind].map(([c, n]) => `${numberText(n)} ${plural(c, n)}`).join(', ')})`;
}

/** Aus den Rückfragen des Ablaufs werden Karten in Worten. */
export function conflictCards(
  conflicts: readonly RawConflict[],
  ctx: WordsContext,
): ConflictCard[] {
  return conflicts.map((c) => conflictCard(c, ctx));
}

export function conflictCard(c: RawConflict, ctx: WordsContext): ConflictCard {
  const dev = other(
    c.remote.device && c.remote.device !== ctx.self ? c.remote.device : (ctx.peer ?? null),
  );
  const doc = c.local.json ?? c.remote.json;
  const heading = entryLabel(c.path, doc, ctx.data);
  const base: ConflictCard = {
    id: c.id,
    kind: c.kind,
    heading,
    stamps: null,
    lead: null,
    rows: [],
    options: [],
    preset: null,
    note: null,
  };
  const whole = (why?: RawConflict['why']): ConflictCard =>
    why === 'unreadable'
      ? {
          ...base,
          stamps: stampsOf(c, dev),
          lead: 'Diese Fassung kann Wayfarer hier nicht lesen. Stimmen die Versionen überein?',
          options: [{ choice: 'local', label: 'Fassung von hier hochladen' }],
          note: 'Die Fassung von dort legt Wayfarer beiseite.',
        }
      : {
          ...base,
          stamps: stampsOf(c, dev),
          lead:
            why === 'noBase'
              ? `Hier und ${dev.at} neu angelegt – Wayfarer kann sie nur als Ganzes nehmen.`
              : 'Diese beiden Fassungen lassen sich nur als Ganzes wählen.',
          options: [
            { choice: 'local', label: 'Fassung von hier' },
            { choice: 'remote', label: `Fassung ${dev.from}` },
          ],
          note: 'Die nicht gewählte Fassung legt Wayfarer beiseite.',
        };

  switch (c.kind) {
    case 'fields': {
      const rows = clashRows(c.fields, doc, ctx);
      if (!rows) return { ...whole(), lead: null };
      return {
        ...base,
        stamps: stampsOf(c, dev),
        rows,
        options: [
          { choice: 'local', label: 'Fassung von hier behalten' },
          { choice: 'remote', label: `Fassung ${dev.from} nehmen` },
        ],
        note: 'Es geht nur um die gezeigten Angaben; alles andere an diesem Eintrag ist schon zusammengeführt. Die nicht gewählte Fassung legt Wayfarer beiseite.',
      };
    }
    case 'time':
      return {
        ...base,
        heading: 'An beiden Rechnern ist Zeit vergangen',
        options: [
          { choice: 'local', label: timeChoiceLabel('here', c, ctx, dev) },
          { choice: 'remote', label: timeChoiceLabel('there', c, ctx, dev) },
        ],
        note: 'Was an beiden Rechnern festgehalten wurde, bleibt in der Chronik. Termine und Schritte von Uhren, die nach der gewählten Weltzeit eingetreten waren, stehen danach wieder aus; doppelt Eingetretenes räumt Wayfarer zusammen.',
      };
    case 'deletedThere':
    case 'referenced': {
      const changed = dateTimeText(c.local.at);
      const lead =
        c.kind === 'referenced'
          ? `${dev.At} gelöscht – hier verweist inzwischen etwas darauf${c.by ? ` (${entryLabel(c.by, null, ctx.data)})` : ''}.`
          : `${dev.At} gelöscht – hier inzwischen geändert${changed ? ` (${changed})` : ''}.`;
      return {
        ...base,
        lead,
        options: [
          { choice: 'local', label: 'Behalten' },
          { choice: 'remote', label: 'Auch hier löschen' },
        ],
        preset: 'local',
        note:
          pathParts(c.path).collection === 'entities'
            ? `Was beim Löschen ${dev.at} mit entfernt wurde (zum Beispiel Beziehungen), kommt durch „Behalten“ nicht von selbst zurück.`
            : null,
      };
    }
    case 'deletedHere':
      return {
        ...base,
        heading: entryLabel(c.path, c.remote.json, ctx.data),
        lead: `Hier gelöscht – ${dev.at} inzwischen geändert.`,
        options: [
          { choice: 'remote', label: 'Zurückholen' },
          { choice: 'local', label: 'Gelöscht lassen' },
        ],
        preset: 'remote',
      };
    case 'mass': {
      const group = c.mass!;
      const n = group.paths.length;
      const ex = examples(group.paths, ctx.data);
      if (group.kind === 'deleteThere')
        return {
          ...base,
          heading: 'Sehr viel auf einmal',
          lead: `${dev.At} wurden ${entries(n)} entfernt${ex}.`,
          options: [
            { choice: 'ok', label: 'Stimmt – hier auch entfernen' },
            { choice: 'back', label: 'Stimmt nicht – hier behalten und wieder hochladen' },
          ],
        };
      return {
        ...base,
        heading: 'Sehr viel auf einmal',
        lead:
          group.kind === 'deleteHere'
            ? `Seit dem letzten Abgleich fehlen hier ${entries(n)}${ex}.`
            : `Seit dem letzten Abgleich hast du hier ${entries(n)} geändert${ex}.`,
        options: [
          { choice: 'ok', label: 'Stimmt – so in die Ablage' },
          { choice: 'back', label: 'Stimmt nicht – aus der Ablage zurückholen' },
        ],
      };
    }
    case 'whole':
      return whole(c.why);
  }
}

/**
 * Die Einleitung des Dialogs. „An beiden Rechnern geändert“ stimmt nicht, wenn nur „Sehr viel
 * auf einmal“ wartet – das hat ein Rechner allein getan.
 */
export function decideLead(cards: readonly Pick<ConflictCard, 'kind'>[]): string {
  if (cards.length && cards.every((c) => c.kind === 'mass'))
    return 'Seit dem letzten Abgleich hat sich sehr viel auf einmal geändert. Damit nichts aus Versehen verloren geht, fragt Wayfarer nach. Bis du entscheidest, bleiben diese Einträge auf jedem Rechner, wie sie sind; alles andere wird abgeglichen.';
  return 'Diese Einträge wurden an beiden Rechnern geändert. Was sich nicht widerspricht, hat Wayfarer schon zusammengeführt. Bis du entscheidest, bleibt auf jedem Rechner seine Fassung dieser Einträge; alles andere wird abgeglichen.';
}

/** Der Fuß des Dialogs ist bedienbar, sobald mindestens eine Karte eine Wahl hat. */
export const canApply = (choices: Readonly<Record<string, Choice | undefined>>) =>
  Object.values(choices).some(Boolean);

/** Die Meldung nach dem Anwenden (1.8). */
export function decidedToast(n: number): { title: string; body: string } {
  return {
    title: 'Abgeglichen',
    body: `${n === 1 ? '1 Entscheidung' : `${n} Entscheidungen`} übernommen. Die nicht gewählten Fassungen liegen unter Einstellungen → Abgleich → „Beiseitegelegte Fassungen“.`,
  };
}

// ── Zwei Spielstände (1.9) ───────────────────────────────────────────────────

export interface FirstSyncGroup {
  label: string;
  items: string[];
  more: number;
}

export interface FirstSyncText {
  title: string;
  lead: string;
  counts: string;
  groups: FirstSyncGroup[];
  local: { title: string; text: string };
  remote: { title: string; text: string };
  /** Nur „Der Stand aus der Ablage gilt“ (dieses Programm ist älter). */
  onlyRemote: boolean;
  same: boolean;
}

const LIST_MAX = 30;

export function firstSyncText(
  info: FirstSyncInfo,
  data: CampaignData | null,
  otherSide: { device: string | null; pushedAt: string | null },
  older: boolean,
): FirstSyncText {
  const group = (label: string, paths: readonly string[], useData: boolean): FirstSyncGroup => ({
    label,
    items: paths.slice(0, LIST_MAX).map((p) => entryLabel(p, null, useData ? data : null)),
    more: Math.max(0, paths.length - LIST_MAX),
  });
  const thereStand = otherSide.pushedAt
    ? `zuletzt ${other(otherSide.device).from}, ${dateTimeText(otherSide.pushedAt)}`
    : '';
  const dropHere = info.different.length + info.onlyLocal.length;
  const dropThere = info.different.length + info.onlyRemote.length;
  return {
    title: info.restored
      ? 'Du hast hier einen ganzen Stand eingespielt'
      : 'Zwei Spielstände – welcher gilt?',
    lead: `Auf diesem Rechner und in deiner Ablage bei GitHub liegt jeweils ein Spielstand. Wayfarer weiß nicht, was davon neuer ist.${thereStand ? ` In der Ablage: ${thereStand}.` : ''}`,
    counts: `Gleich: ${numberText(info.same)} · nur hier: ${numberText(info.onlyLocal.length)} · nur dort: ${numberText(info.onlyRemote.length)} · verschieden: ${numberText(info.different.length)}`,
    groups: [
      group('Nur hier', info.onlyLocal, true),
      group('Nur dort', info.onlyRemote, false),
      group('Verschieden', info.different, true),
    ].filter((g) => g.items.length),
    local: {
      title: 'Der Stand dieses Rechners gilt',
      text: `Die Ablage wird auf den Stand dieses Rechners gebracht.${dropThere ? ` Was es dort anders gibt (${entries(dropThere)}), legt Wayfarer vorher hier beiseite.` : ''}`,
    },
    remote: {
      title: 'Der Stand aus der Ablage gilt',
      text: `Dieser Rechner wird auf den Stand der Ablage gebracht.${dropHere ? ` Was es hier anders gibt (${entries(dropHere)}), legt Wayfarer vorher beiseite.` : ''} Wayfarer startet dafür einmal neu.`,
    },
    onlyRemote: older,
    same: !info.different.length && !info.onlyLocal.length && !info.onlyRemote.length,
  };
}

export const SAME_STAND =
  'Dieser Rechner und die Ablage haben denselben Stand. Ab jetzt wird abgeglichen.';

// ── Einrichten (1.2) und Holen (1.3) ─────────────────────────────────────────

export type ProbeOutcome =
  | { kind: 'found'; found: FoundRepo; login: string }
  | { kind: 'choose'; repos: RepoInfo[]; login: string }
  | { kind: 'one'; repo: RepoInfo; login: string }
  | { kind: 'none'; login: string }
  | { kind: 'foreign'; name: string; login: string }
  | { kind: 'public'; name: string; login: string };

/** Was die Prüfung des Schlüssels gefunden hat. */
export function probeOutcome(result: SyncProbeResult): ProbeOutcome {
  const { login, found, repos } = result;
  if (found) {
    const name = `${found.info.owner}/${found.info.repo}`;
    if (!found.info.isPrivate) return { kind: 'public', name, login };
    if (found.kind === 'foreign') return { kind: 'foreign', name, login };
    return { kind: 'found', found, login };
  }
  const usable = repos.filter((r) => r.isPrivate && r.canPush && !r.archived);
  if (!usable.length) return { kind: 'none', login };
  if (usable.length === 1) return { kind: 'one', repo: usable[0]!, login };
  return { kind: 'choose', repos: usable, login };
}

/** Der Satz zu einem Ergebnis der Prüfung (Schritt 4). */
export function probeText(outcome: ProbeOutcome): string {
  switch (outcome.kind) {
    case 'found':
      return `Angemeldet als ${outcome.login}. Gefunden: die private Ablage ${outcome.found.info.owner}/${outcome.found.info.repo}.`;
    case 'choose':
      return 'Der Schlüssel gilt für mehrere Ablagen. Welche ist für den Spielstand gedacht?';
    case 'one':
      return `Angemeldet als ${outcome.login}.`;
    case 'none':
      return 'Der Schlüssel funktioniert, gilt aber für keine private Ablage, in die Wayfarer schreiben darf. Erzeuge ihn neu und wähle bei „Only select repositories“ die Ablage aus Schritt 2.';
    case 'foreign':
      return `Der Schlüssel gilt für ${outcome.name} – das ist nicht die Ablage für den Spielstand. Erzeuge den Schlüssel neu und wähle bei „Only select repositories“ die Ablage aus Schritt 2.`;
    case 'public':
      return `${outcome.name} ist öffentlich. Dort könnte jeder deinen Spielstand lesen – Wayfarer gleicht nur mit einer privaten Ablage ab. Stelle sie bei GitHub auf „Private“ oder lege eine neue an.`;
  }
}

/** Nur prüfen, ohne zu speichern: ein Schlüssel der älteren Art gälte für alle Ablagen. */
export function keyFormProblem(key: string): string | null {
  const k = key.trim();
  if (!k) return 'Füge zuerst den Zugangsschlüssel ein.';
  if (k.startsWith('ghp_'))
    return 'Das ist ein Schlüssel der älteren Art; er gälte für alle deine Ablagen. Bitte erzeuge einen „Fine-grained token“ wie in Schritt 3.';
  return null;
}

/** Ein Fehler beim Speichern oder Prüfen des Schlüssels in Worten (Schritt 4). */
export function keyErrorText(failure: Pick<SyncFailure, 'kind' | 'message'>): string {
  switch (failure.kind) {
    case 'key':
      return 'GitHub nimmt diesen Schlüssel nicht an. Wurde er vollständig kopiert? Er beginnt mit github_pat_.';
    case 'offline':
    case 'server':
      return 'GitHub ist gerade nicht erreichbar. Besteht eine Internetverbindung? Der Schlüssel ist gespeichert; versuche es gleich noch einmal.';
    case 'limit':
      return 'GitHub bittet um eine Pause. Versuche es in ein paar Minuten noch einmal.';
    case 'keychain':
      return 'Der Schlüsselbund deines Systems hat den Zugriff verweigert. Versuche es noch einmal und wähle „Immer erlauben“.';
    case 'denied':
      return 'Der Schlüssel darf nicht schreiben – bei „Contents“ fehlt „Read and write“.';
    case 'missing':
      return probeText({ kind: 'none', login: '' });
    default:
      return failure.message;
  }
}

/** Was in der gefundenen Ablage liegt: „leer“, „Spielstand“, „neuere Version“. */
export function foundState(found: FoundRepo, dataVersion: number): 'empty' | 'stand' | 'newer' {
  if (found.kind === 'empty' || found.kind === 'fresh' || !found.files) return 'empty';
  if (found.marker && found.marker.datenstand > dataVersion) return 'newer';
  return 'stand';
}

/** „Gefunden: o/r – Elaris, zuletzt hochgeladen vom Windows-PC am 15. November 2026, 21:40 Uhr.“ */
export function foundText(found: FoundRepo): string {
  const parts = [`Gefunden: ${found.info.owner}/${found.info.repo}`];
  const tail: string[] = [];
  if (found.campaign) tail.push(found.campaign);
  if (found.pushedAt)
    tail.push(
      `zuletzt hochgeladen${found.device ? ` vom ${found.device}` : ''} am ${dateTimeText(found.pushedAt)}`,
    );
  return `${parts[0]}${tail.length ? ` – ${tail.join(', ')}` : ''}.`;
}

export const FETCH_NOT_EMPTY =
  'In diesem Ordner liegt schon etwas. Zum Holen braucht Wayfarer einen neuen, leeren Ordner.';
export const FETCH_REPO_EMPTY =
  'In deiner Ablage liegt noch kein Spielstand. Richte den Abgleich zuerst am Rechner mit der Kampagne ein (Einstellungen → Abgleich).';
export const FETCH_NEWER =
  'Der Spielstand wurde mit einer neueren Version von Wayfarer geschrieben. Hol ihn trotzdem – Wayfarer lädt von hier aus nichts hoch, bis du es aktualisiert hast.';
export const FETCH_BROKEN =
  'Die Verbindung ist abgerissen. Was schon geholt wurde, bleibt; „In diesen Ordner holen“ macht dort weiter.';
export const PARTS_IN_FOLDER =
  'In diesem Ordner liegen schon Teile eines Spielstands. Wähle einen leeren Ordner.';

/** Ein Fehler beim Holen in Worten (1.3). */
export function fetchErrorText(failure: Pick<SyncFailure, 'kind' | 'message'>): string {
  if (failure.kind === 'offline' || failure.kind === 'server' || failure.kind === 'limit')
    return FETCH_BROKEN;
  return keyErrorText(failure);
}

// ── Ausgelassene Einträge (1.11, 2.7) ────────────────────────────────────────

const SKIP_WHY: Record<string, string> = {
  case: 'der Name unterscheidet sich nur in Groß- und Kleinschreibung von einem anderen',
  encoding: 'die Datei ist nicht sauber gespeichert',
  size: 'zu groß',
  unreadable: 'unlesbar – siehe „Probleme beim Laden“',
  'never-deleted': 'wird nie gelöscht',
};

/** „2 Einträge lässt der Abgleich aus: Person „Aldric“ (zu groß), …“ – gesperrte zählen nicht. */
export function skippedText(
  skipped: readonly { path: string; why: string; title: string | null }[],
  data: CampaignData | null,
): string | null {
  const shown = skipped.filter((s) => s.why !== 'locked');
  if (!shown.length) return null;
  const list = shown
    .slice(0, 5)
    .map((s) => {
      const label = s.title
        ? `${kindWord(s.path, null)} „${s.title}“`
        : entryLabel(s.path, null, data);
      const why = SKIP_WHY[s.why];
      return why ? `${label} (${why})` : label;
    })
    .join(', ');
  return `${entries(shown.length)} lässt der Abgleich aus: ${list}${shown.length > 5 ? ' …' : ''}`;
}

export const frozenWhy = (reason: SyncFrozen['reason']) => SKIP_WHY[reason] ?? '';

// ── Beiseitegelegte Fassungen (1.12) ─────────────────────────────────────────

export type AsideReasonWord =
  'abgleich' | 'entscheidung' | 'erster-abgleich' | 'eingespielt' | 'zurueckholen';

/** Gewöhnliches („beim Abgleich ersetzt“) steht erst hinter „Auch Ersetztes zeigen“. */
export const isOrdinaryAside = (reason: AsideReasonWord) =>
  reason === 'abgleich' || reason === 'zurueckholen';

/** „14. November 2026, 23:05 Uhr – deine Entscheidung: 2 Fassungen vom MacBook nicht gewählt“ */
export function asideRunText(
  run: { at: string; reason: AsideReasonWord; entries: { side: 'hier' | 'dort' }[] },
  device: string | null,
): string {
  const when = dateTimeText(run.at);
  const here = run.entries.filter((e) => e.side === 'hier').length;
  const there = run.entries.length - here;
  const fass = (n: number) => (n === 1 ? '1 Fassung' : `${n} Fassungen`);
  const sides = [
    here ? `${fass(here)} von hier` : '',
    there ? `${fass(there)} ${other(device).from}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const what = (() => {
    switch (run.reason) {
      case 'entscheidung':
        return `deine Entscheidung: ${sides} nicht gewählt`;
      case 'erster-abgleich':
        return `erster Abgleich: ${run.entries.length === 1 ? '1 Eintrag' : entries(run.entries.length)} ${here && !there ? 'von hier' : there && !here ? other(device).from : ''}`.trim();
      case 'eingespielt':
        return `eingespielter Stand: ${sides}`;
      case 'zurueckholen':
        return `zurückgeholt: ${sides} ersetzt`;
      default:
        return `beim Abgleich ersetzt: ${sides}`;
    }
  })();
  return `${when} – ${what}`;
}

/** „Person „Aldric“ (Fassung von hier)“ */
export function asideEntryText(
  entry: { side: 'hier' | 'dort'; path: string; title: string },
  json: Json | null,
  device: string | null,
): string {
  const kind = kindWord(entry.path, json);
  // Die Rust-Seite merkt sich „<ordner>: <Name>“ aus der beiseitegelegten Fassung selbst.
  const fromTitle = entry.title.includes(': ')
    ? entry.title.slice(entry.title.indexOf(': ') + 2)
    : '';
  const name = fromTitle.trim() || ownName(json);
  const label = name ? `${kind} „${name}“` : kind;
  return `${label} (${entry.side === 'hier' ? 'Fassung von hier' : `Fassung ${other(device).from}`})`;
}

/** Was eine beiseitegelegte Fassung von heute unterscheidet – Zeilen wie auf den Karten. */
export function compareRows(aside: Json | null, today: Json | null, ctx: WordsContext): CardRow[] {
  if (!isObj(aside) || !isObj(today)) return [];
  const rows: CardRow[] = [];
  const keys = new Set([...Object.keys(aside), ...Object.keys(today)]);
  for (const key of keys) {
    if (key === 'rev' || key === 'updated' || key === 'id') continue;
    const a = aside[key];
    const t = today[key];
    if (JSON.stringify(a) === JSON.stringify(t)) continue;
    const long = isLong(a, t);
    const there = long
      ? String(a)
      : (valueWords(a, key, ctx) ?? 'anders (nicht in Worten zu zeigen)');
    const here = long
      ? String(t)
      : (valueWords(t, key, ctx) ?? 'anders (nicht in Worten zu zeigen)');
    rows.push({ label: fieldLabel([key], today), here, there, long });
  }
  return rows;
}

// ── Erklärungen für das Einrichten (Wortlaut des Entwurfs) ────────────────────

export const SECTION_LEAD =
  'Derselbe Spielstand auf deinem Windows-PC und deinem MacBook. Wayfarer gleicht den Kampagnenordner selbst mit einer privaten Ablage bei GitHub ab – du musst dafür nichts weiter installieren.';
export const PREVIEW_ONLY = 'Der Abgleich arbeitet nur in der installierten App.';
export const NOT_SET_UP =
  'Einmal einrichten dauert etwa zehn Minuten. Du brauchst ein kostenloses Konto bei GitHub. Danach gleicht Wayfarer von selbst ab: beim Öffnen, nach Änderungen und beim Schließen.';

export const STEP_TITLES = [
  'Ein Konto bei GitHub',
  'Eine private Ablage anlegen',
  'Einen Zugangsschlüssel erzeugen',
  'Schlüssel einfügen',
  'Der erste Abgleich',
] as const;

export const STEP1 =
  'GitHub ist ein Dienst, bei dem man Dateien in privaten Ablagen aufbewahren kann. Wayfarer nutzt eine solche Ablage als Treffpunkt für deine beiden Rechner. Hast du noch kein Konto, lege eines an (kostenlos) und melde dich im Browser an.';

export const STEP2_LEAD =
  'Bei GitHub heißt so eine Ablage „Repository“. Der Knopf öffnet die passende Seite; Name und „privat“ sind schon ausgefüllt.';
export const STEP2_POINTS = [
  `Bei „Repository name“ steht ${SUGGESTED_REPO}. Ist der Name schon vergeben, nimm einen anderen – merk ihn dir, du brauchst ihn in Schritt 3.`,
  'Es muss „Private“ gewählt sein – nie „Public“: Sonst könnte jeder deinen Spielstand lesen. Eine öffentliche Ablage lehnt Wayfarer ab.',
  'Klicke unten auf „Create repository“.',
];

export const SECOND_LOGIN =
  'Melde dich dazu im Browser dieses Rechners mit demselben GitHub-Konto an; GitHub fragt dabei vielleicht noch einmal nach Passwort oder Code.';
export const SECOND_MACHINE = `Den Schlüssel vom anderen Rechner kannst du nicht noch einmal verwenden – er wird nirgends angezeigt. Erzeuge hier einen eigenen (zwei Minuten). ${SECOND_LOGIN}`;

export const STEP3_LEAD =
  'Der Zugangsschlüssel ist eine lange Zeichenfolge, mit der Wayfarer – und nur Wayfarer – in genau diese eine Ablage schreiben darf. Bei GitHub heißt er „Fine-grained personal access token“. Der Knopf öffnet die Seite; Name, Laufzeit und die nötige Erlaubnis sind schon ausgefüllt.';
/**
 * Die Punkte zu GitHubs Seite (Schritt 3). `repo`: Der Schlüssel wird für eine schon verbundene
 * Ablage ersetzt – dann steht ihr Name da, nie „die Ablage aus Schritt 2“ (die Schritte sieht man
 * beim Ersetzen nicht).
 */
export function step3Points(second: boolean, repo?: string): string[] {
  const which = repo
    ? `deine Ablage ${repo}`
    : second
      ? 'die Ablage, die du am anderen Rechner angelegt hast'
      : 'die Ablage aus Schritt 2';
  return [
    `Bei „Repository access“ wähle „Only select repositories“ und im Feld darunter ${which}. Liegt dort auch eine Ablage namens „Wayfarer“, ist das nicht die richtige.`,
    'Prüfe unter „Permissions“ → „Repository permissions“, dass bei „Contents“ „Read and write“ steht. „Metadata“ setzt GitHub von selbst dazu – lass es stehen.',
    'Bei „Expiration“ steht „No expiration“: Der Schlüssel läuft nicht ab. GitHub warnt davor; das darfst du übergehen. Löschen kannst du ihn bei GitHub jederzeit.',
    'Klicke unten auf „Generate token“ (fragt GitHub noch einmal nach Passwort oder Code, ist das normal) und kopiere die Zeichenfolge, die GitHub dir zeigt. Sie beginnt mit github_pat_ und wird nur dieses eine Mal angezeigt.',
  ];
}
export const STEP3_TAIL =
  'Für den zweiten Rechner erzeugst du später auf dieselbe Weise einen eigenen Schlüssel. So kannst du einen Rechner einzeln aussperren, falls er einmal verloren geht.';

export const KEY_HINT =
  'Der Schlüssel wird im Schlüsselbund deines Systems abgelegt, nicht im Kampagnenordner. Er wird nie angezeigt.';
export const MAC_KEYCHAIN =
  'Dein Mac fragt gleich nach deinem Anmeldepasswort, damit Wayfarer den Schlüssel im Schlüsselbund ablegen darf. Wähle „Immer erlauben“. Nach jeder neuen Version von Wayfarer fragt er einmal wieder.';

/** Schritt 5 a – der fette Teil (Name und Weltzeit) steht für sich. */
export function step5Empty(
  name: string,
  worldTime: string,
  parts: string,
): { before: string; strong: string; after: string } {
  return {
    before: 'Die Ablage ist noch leer. Wayfarer lädt jetzt den Spielstand dieses Rechners hoch: ',
    strong: `${name} · ${worldTime}`,
    after: `${parts ? ` · ${parts}` : ''}. Das kann ein paar Minuten dauern; der Balken zeigt, wie weit es ist. Bilder im Ordner „media“ reisen nicht mit.`,
  };
}
export const STEP5_WRONG_REPO =
  'Hast du den Abgleich am anderen Rechner schon eingerichtet, ist das die falsche Ablage – dort müsste dein Spielstand schon liegen.';
export const UPLOAD_DENIED =
  'Der Schlüssel darf nicht schreiben – bei „Contents“ fehlt „Read and write“.';

export function setUpDone(otherName: string): { title: string; body: string } {
  return {
    title: 'Abgleich eingerichtet',
    body: `Der Spielstand liegt jetzt auch in deiner Ablage. ${otherName === 'MacBook' ? 'Am MacBook' : 'Am anderen Rechner'}: Wayfarer öffnen und „Spielstand vom anderen Rechner holen“ wählen. Spielst du ohne Netz, öffne Wayfarer ${otherName === 'MacBook' ? 'am MacBook' : 'dort'} vorher einmal mit Netz, bis „Abgeglichen“ steht.`,
  };
}

/** Der andere Rechner aus Sicht dieses (für die Meldung nach dem Einrichten). */
export const otherMachineName = (device: string) =>
  device === 'MacBook' ? 'Windows-PC' : 'MacBook';

export const NEWER_HERE =
  'Diese Version speichert mehr als die vorige. Das MacBook holt weiter, kann aber erst wieder hochladen, wenn dort dieselbe Version läuft.';
export function newerHereText(device: string): string {
  return NEWER_HERE.replace('Das MacBook', deviceSubject(device));
}

export const DISCONNECT_TITLE = 'Abgleich auf diesem Rechner trennen?';
export const DISCONNECT_TEXT =
  'Wayfarer gleicht diesen Kampagnenordner dann nicht mehr ab. Der Spielstand bleibt hier und in deiner Ablage, wie er ist; nichts wird gelöscht.';
export const DISCONNECT_AFTER =
  'Die Ablage selbst löschst du – falls gewünscht – bei GitHub in den Einstellungen der Ablage („Delete this repository“).';

export function moveQuestion(oldRoot: string, newRoot: string): string {
  return `Der Abgleich wurde für ${oldRoot} eingerichtet; dieser Ordner liegt in ${newRoot}. Ist das eine Kopie – etwa eine Sicherung oder ein Ordner zum Ausprobieren –, soll sie nicht abgleichen: Sonst würde sie auf den heutigen Stand gebracht, und was du darin änderst, käme auf deinen anderen Rechner.`;
}

export function picturesNotice(local: number): string {
  return `Der Abgleich überträgt den Spielstand, nicht die Bilder (auf diesem Rechner: ${numberText(local)}). Hole sie auf jedem Rechner einmal – bevor du LegendKeeper kündigst.`;
}
