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
  | { type: 'move' }
  | { type: 'search' }
  | { type: 'time' }
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
/** Öffnet die Ortswahl für die Gruppe. */
export const openMoveParty = () => set({ type: 'move' });
/** Öffnet die Suche. */
export const openSearch = () => set({ type: 'search' });
/** Öffnet „Zeit vergehen lassen“ mit freier Dauer oder Zieldatum. */
export const openTimeDialog = () => set({ type: 'time' });
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
