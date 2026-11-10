/**
 * Welche Art die Übersicht links gerade zeigt. Liegt außerhalb der Übersicht, damit auch der
 * Einstieg rechts sie umstellen kann („6 Orte“ anklicken zeigt die Orte). Gilt, solange die App läuft.
 */
import { useSyncExternalStore } from 'react';
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
