/**
 * Welche Art die Übersicht links gerade zeigt. Liegt außerhalb der Übersicht, damit auch der
 * Einstieg rechts sie umstellen kann („6 Orte“ anklicken zeigt die Orte). Gilt, solange die App läuft.
 */
import { useSyncExternalStore } from 'react';
import type { KindFilter } from './model';

let current: KindFilter = 'all';
const listeners = new Set<() => void>();

export function setKindFilter(next: KindFilter) {
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

export const getKindFilter = () => current;

export function useKindFilter(): KindFilter {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
