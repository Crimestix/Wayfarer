/**
 * Welche Art die Übersicht links gerade zeigt. Liegt außerhalb der Übersicht, damit auch der
 * Einstieg rechts sie umstellen kann („6 Orte“ anklicken zeigt die Orte). Gilt, solange die App läuft.
 */
import { useSyncExternalStore } from 'react';
import type { NetMode } from '../../domain/factionNet';
import type { KindFilter } from './model';
import type { WorldView } from './scope';

let current: KindFilter = 'all';
const listeners = new Set<() => void>();

export function setKindFilter(next: KindFilter) {
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

export const getKindFilter = () => current;

/** Eingrenzung der Übersicht auf einen Bereich und auf Bekanntes. Gilt, solange die App läuft. */
let view: WorldView = { scopeId: null, knownOnly: false };

export function setWorldView(change: Partial<WorldView>) {
  view = { ...view, ...change };
  listeners.forEach((l) => l());
}

export function useWorldView(): WorldView {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => view,
  );
}

export function useKindFilter(): KindFilter {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/**
 * Die Ansicht der Übersicht: nach Art, in den Ordnern, als Fraktionsnetz – oder was im Wiki noch
 * zu schreiben ist. Liegt hier, weil auch die Bühne rechts sie braucht (Netz und „Noch zu
 * schreiben“ zeigen sich dort). Gilt, solange die App läuft.
 */
export type WorldLayout = 'kinds' | 'tree' | 'net' | 'gaps';

let layout: WorldLayout = 'kinds';

export function setWorldLayout(next: WorldLayout) {
  if (next === layout) return;
  layout = next;
  listeners.forEach((l) => l());
}

export function useWorldLayout(): WorldLayout {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => layout,
  );
}

/** Das Fraktionsnetz: welche Sicht, was hervorgehoben ist (aus der Liste links) und die Suche. */
export interface NetView {
  mode: NetMode;
  /** Der Knoten, über dem die Maus in der Liste links steht. */
  hover: string | null;
  query: string;
}

let netView: NetView = { mode: 'people', hover: null, query: '' };

export function setNetView(change: Partial<NetView>) {
  const next = { ...netView, ...change };
  if (next.mode === netView.mode && next.hover === netView.hover && next.query === netView.query)
    return;
  netView = next;
  listeners.forEach((l) => l());
}

export function useNetView(): NetView {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => netView,
  );
}
