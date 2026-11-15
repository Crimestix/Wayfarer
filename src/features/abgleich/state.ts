/**
 * Was der Abgleich gerade tut und braucht – als Sicht für die Oberfläche (Zeichen in der Leiste,
 * Abschnitt in den Einstellungen; Abschnitt B). Jeder Ablauf (`engine.ts`) hat seinen eigenen
 * Stand; die App zeigt den des laufenden Ablaufs (`useSync`). Nichts davon wird gespeichert.
 */
import { useSyncExternalStore } from 'react';
import type { SettleSummary } from '../../data/actions';
import type { SyncLink } from '../../data/platform';
import type { ChangeCounts, MassGroup } from '../../domain/sync';
import type { FieldClash, Json } from '../../domain/syncMerge';

export type SyncPhase = 'off' | 'unlinked' | 'synced' | 'running' | 'offline' | 'needsYou';

export type NeedsWhy =
  | 'conflicts'
  | 'version'
  | 'shape'
  | 'key'
  | 'nokey'
  | 'keychain'
  | 'denied'
  | 'missing'
  | 'public'
  | 'foreign'
  | 'emptied'
  | 'moved'
  | 'firstSync'
  | 'local';

export type ConflictKind =
  'fields' | 'time' | 'whole' | 'deletedThere' | 'referenced' | 'deletedHere' | 'mass';

/** Eine Rückfrage, noch ohne Worte (die macht `model.ts` in Abschnitt B). */
export interface RawConflict {
  /** Pfad, bei „sehr viel“ der Schlüssel der Gruppe. */
  id: string;
  path: string;
  kind: ConflictKind;
  local: { json: Json | null; at: string | null };
  remote: { json: Json | null; at: string | null; device: string | null };
  fields: FieldClash[];
  mass?: MassGroup;
  /** Verweist: wer hier auf den dort gelöschten Eintrag zeigt. */
  by?: string;
  /** Ganze Fassung: warum nur als Ganzes (`unreadable` = die Fassung von dort ist hier unlesbar). */
  why?: 'noBase' | 'unknown' | 'invalid' | 'unreadable';
}

/** Erster Abgleich ohne gemeinsamen Stand: was gleich ist und was nicht (Frage 1.9). */
export interface FirstSyncInfo {
  same: number;
  onlyLocal: string[];
  onlyRemote: string[];
  different: string[];
  /** Die Ablage ist leer oder hat nur eine README. */
  remoteEmpty: boolean;
  /** Hier wurde ein ganzer Stand eingespielt. */
  restored: boolean;
}

export interface SyncView {
  phase: SyncPhase;
  /** Hier gibt es Änderungen, die noch nicht in der Ablage sind, oder Anwenden steht aus. */
  due: boolean;
  needs: null | { why: NeedsWhy; detail?: string };
  offline: null | { why: 'net' | 'server' | 'behind' | 'limit'; until?: string };
  link: SyncLink | null;
  syncedAt: string | null;
  other: { device: string | null; pushedAt: string | null };
  last: null | { up: ChangeCounts; down: ChangeCounts; from: string | null };
  /** Die ruhige Zeile „Vom MacBook kommt Neues“. */
  incoming: null | { count: number; from: string | null };
  conflicts: RawConflict[];
  heldSince: string | null;
  skipped: { path: string; why: string; title: string | null }[];
  progress: null | { phase: string; done: number; total: number };
  closing: boolean;
  /** Dieses Programm ist älter als das, das zuletzt hochgeladen hat (nur holen). */
  older: boolean;
  /** Der andere Rechner braucht die neue Version (sein Name). */
  otherNeedsUpdate: string | null;
  /** So heißt der andere Rechner laut Marke der Ablage (null = keiner bekannt). */
  peer: string | null;
  reopened: SettleSummary | null;
  firstSync: FirstSyncInfo | null;
}

export const INITIAL_VIEW: SyncView = {
  phase: 'off',
  due: false,
  needs: null,
  offline: null,
  link: null,
  syncedAt: null,
  other: { device: null, pushedAt: null },
  last: null,
  incoming: null,
  conflicts: [],
  heldSince: null,
  skipped: [],
  progress: null,
  closing: false,
  older: false,
  otherNeedsUpdate: null,
  peer: null,
  reopened: null,
  firstSync: null,
};

export interface ViewStore {
  get(): SyncView;
  set(change: Partial<SyncView>): void;
  subscribe(listener: () => void): () => void;
}

export function createViewStore(initial: SyncView = INITIAL_VIEW): ViewStore {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(change) {
      value = { ...value, ...change };
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// ── Der Stand des laufenden Ablaufs für die Oberfläche ──────────────────────

let active: ViewStore | null = null;
let activeOff: (() => void) | null = null;
const activeListeners = new Set<() => void>();
const notifyActive = () => {
  for (const listener of [...activeListeners]) listener();
};

/** Der Ablauf, dessen Stand die App zeigt (null = keiner, etwa in der Vorschau). */
export function setActiveView(store: ViewStore | null): void {
  activeOff?.();
  active = store;
  activeOff = store?.subscribe(notifyActive) ?? null;
  notifyActive();
}

function subscribeActive(listener: () => void): () => void {
  activeListeners.add(listener);
  return () => {
    activeListeners.delete(listener);
  };
}

export const useSync = (): SyncView =>
  useSyncExternalStore(subscribeActive, () => active?.get() ?? INITIAL_VIEW);
