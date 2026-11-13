/**
 * Befehle, die jede Seite auslösen kann und die das Gerüst ausführt:
 * festhalten, Haltung ändern, Ort wechseln, suchen. So sehen diese Handgriffe überall gleich aus.
 */
import { useSyncExternalStore } from 'react';
import type { ChronicleKind } from '../domain/schema';

export interface QuickLogRequest {
  kind?: Extract<ChronicleKind, 'note' | 'promise' | 'change'>;
  refs?: string[];
  text?: string;
}

export interface AttitudeRequest {
  fromId: string;
  /** Vorgabe: die Gruppe. */
  toId?: string;
}

export type ShellRequest =
  | { type: 'log'; request: QuickLogRequest }
  | { type: 'attitude'; request: AttitudeRequest }
  | { type: 'move'; placeId?: string }
  | { type: 'search' }
  | { type: 'time' }
  | { type: 'rest'; kind: 'short' | 'long' }
  | { type: 'downtime' }
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
export const openMoveParty = (preset: { placeId?: string } = {}) =>
  set({ type: 'move', placeId: preset.placeId });
/** Öffnet die Suche. */
export const openSearch = () => set({ type: 'search' });
/** Öffnet „Zeit vergehen lassen“ mit freier Dauer oder Zieldatum. */
export const openTimeDialog = () => set({ type: 'time' });
/** Öffnet die Rast: Kurze oder Lange Rast mit Wachplan. */
export const openRest = (kind: 'short' | 'long' = 'long') => set({ type: 'rest', kind });
/** Öffnet „Freie Zeit“: Tage vergehen, die Gefährten gehen ihren Vorhaben nach. */
export const openDowntime = () => set({ type: 'downtime' });
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
