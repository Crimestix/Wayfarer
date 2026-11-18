/** Öffnet den Dialog „Eintrag anlegen / bearbeiten“ von überall in der Weltdatenbank. */
import { useSyncExternalStore } from 'react';
import type { EntityDraft, WorldKind } from './model';

/** Ein abgebrochener Entwurf, mit dem der Dialog dort weitermacht, wo er geschlossen wurde. */
export interface EntityDialogResume {
  draft: EntityDraft;
  /** Orte, die im Dialog über „neu anlegen“ entstanden sind. */
  created: string[];
}

export type EntityDialogRequest = (
  { mode: 'create'; kind: WorldKind; preset?: Partial<EntityDraft> } | { mode: 'edit'; id: string }
) & { resume?: EntityDialogResume };

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

/** Das eine „Neu“ der Welt: Name und Art (`NewDialog`). */
export interface NewRequest {
  /** Vorgeschlagene Art; null = nur ein Text, ohne Art. Ohne Angabe: Person. */
  kind?: WorldKind | null;
  /** Eine eigene Kategorie des Spielleiters (`kind` ist dann die, wie die sie sich verhält). */
  ownKindId?: string | null;
  name?: string;
  /** Gleich den Text anfangen (Vorgabe: nein). */
  withText?: boolean;
}

let newRequest: NewRequest | null = null;
const newListeners = new Set<() => void>();

function setNew(next: NewRequest | null) {
  newRequest = next;
  newListeners.forEach((l) => l());
}

export const openNew = (request: NewRequest = {}) => setNew(request);
export const closeNew = () => setNew(null);

export function useNewRequest(): NewRequest | null {
  return useSyncExternalStore(
    (l) => {
      newListeners.add(l);
      return () => newListeners.delete(l);
    },
    () => newRequest,
  );
}
