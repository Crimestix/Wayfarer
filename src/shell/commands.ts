/**
 * Befehle, die jede Seite auslösen kann und die das Gerüst ausführt:
 * festhalten, Haltung ändern, Ort wechseln, suchen. So sehen diese Handgriffe überall gleich aus.
 */
import { useSyncExternalStore } from 'react';
import type { ChronicleKind } from '../domain/schema';
import type { WorldTime } from '../domain/time/calendar';
import type { RecordPart } from '../features/chronik/recordDraft';

export interface QuickLogRequest {
  kind?: Extract<ChronicleKind, 'note' | 'promise' | 'change'>;
  refs?: string[];
  text?: string;
  /** Vorgewählte Arten mit Angaben (aus der Mitschrift); gehen vor `kind`. */
  parts?: RecordPart[];
  /** Gleich Beute, Vermutung oder Handel öffnen. */
  own?: 'loot' | 'guess' | 'trade';
  /** Bei Beute: was die Mitschrift schon sagt. */
  loot?: { text: string; gold: number | null; toId: string | null };
  /** Zeitpunkt, wenn er vor jetzt liegt (eine Notiz nachträglich umwandeln). */
  at?: WorldTime;
  /** Die Notiz, an deren Stelle der neue Eintrag tritt – sie verschwindet beim Festhalten. */
  replaces?: string;
  /** Nach dem Festhalten (etwa: die Zeile der Mitschrift leeren). */
  onSaved?: () => void;
}

export interface MoveRequest {
  placeId?: string;
  /** Was die Mitschrift dazu schon geschrieben hat. */
  text?: string;
  onSaved?: () => void;
}

export interface SpellRequest {
  /** Was in der Mitschrift stand („Unsichtbarkeit“). */
  text?: string;
  refs?: string[];
  onSaved?: () => void;
}

export interface AttitudeRequest {
  fromId: string;
  /** Vorgabe: die Gruppe. */
  toId?: string;
}

export type ShellRequest =
  | { type: 'log'; request: QuickLogRequest }
  | { type: 'attitude'; request: AttitudeRequest }
  | { type: 'move'; placeId?: string; text?: string; onSaved?: () => void }
  | { type: 'spell'; request: SpellRequest }
  | { type: 'search' }
  | { type: 'journey'; toId: string | null }
  | { type: 'time' }
  | { type: 'rest'; kind: 'short' | 'long' }
  | { type: 'downtime' }
  | { type: 'shop'; shopId: string | null; direction: 'buy' | 'sell' }
  | null;

let current: ShellRequest = null;
const listeners = new Set<() => void>();

function set(next: ShellRequest) {
  current = next;
  listeners.forEach((l) => l());
}

/** Öffnet „Festhalten“: eine Notiz, Abmachung oder Veränderung für die Chronik. */
export const openQuickLog = (request: QuickLogRequest = {}) => set({ type: 'log', request });
/** Öffnet den Dialog, um die Haltung einer Person oder Fraktion zu ändern. */
export const openAttitude = (request: AttitudeRequest) => set({ type: 'attitude', request });
/**
 * Öffnet die Ortswahl für die Gruppe, auf Wunsch mit einem vorgeschlagenen Ort. Die Gruppe zieht
 * erst um, wenn der Spielleiter das bestätigt – ein bloßer Klick auf einen Ort versetzt sie nie.
 */
export const openMoveParty = (preset: MoveRequest = {}) => set({ type: 'move', ...preset });
/** Öffnet „Zauber“: wer wirkt was, wie lange, mit Konzentration. */
export const openSpell = (request: SpellRequest = {}) => set({ type: 'spell', request });
/** Öffnet „Reise antreten“, auf Wunsch mit einem Ziel. */
export const openJourney = (toId: string | null = null) => set({ type: 'journey', toId });
/** Öffnet die Suche. */
export const openSearch = () => set({ type: 'search' });
/** Öffnet „Zeit vergehen lassen“ mit freier Dauer oder Zieldatum. */
export const openTimeDialog = () => set({ type: 'time' });
/** Öffnet die Rast: Kurze oder Lange Rast mit Wachplan. */
export const openRest = (kind: 'short' | 'long' = 'long') => set({ type: 'rest', kind });
/** Öffnet „Freie Zeit“: Tage vergehen, die Gefährten gehen ihren Vorhaben nach. */
export const openDowntime = () => set({ type: 'downtime' });
/**
 * Öffnet den Laden zum Kaufen oder Verkaufen. Ohne Laden fragt der Dialog, wo gehandelt wird –
 * auch ohne Laden geht es.
 */
export const openShop = (shopId: string | null = null, direction: 'buy' | 'sell' = 'buy') =>
  set({ type: 'shop', shopId, direction });
export const closeShellRequest = () => set(null);

export function useShellRequest(): ShellRequest {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
