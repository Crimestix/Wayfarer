/** Öffnet den Dialog „Eintrag anlegen / bearbeiten“ von überall in der Weltdatenbank. */
import { useSyncExternalStore } from 'react';
import type { EntityDraft, WorldKind } from './model';

export type EntityDialogRequest =
  | { mode: 'create'; kind: WorldKind; preset?: Partial<EntityDraft> }
  | { mode: 'edit'; id: string };

let current: EntityDialogRequest | null = null;
const listeners = new Set<() => void>();

function set(next: EntityDialogRequest | null) {
  current = next;
  listeners.forEach((l) => l());
}

export const openEntityDialog = (request: EntityDialogRequest) => set(request);
export const closeEntityDialog = () => set(null);

export function useEntityDialogRequest(): EntityDialogRequest | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
