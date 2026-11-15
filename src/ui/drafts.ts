/**
 * Register offener Entwürfe: Wo gerade ungespeicherter Text steht (ein Feld eines Blatts, der
 * Editor eines Artikels, ein offener Dialog, der Wesen-Editor), meldet sich die Stelle hier an.
 * Der Abgleich übernimmt Änderungen vom anderen Rechner nur in einem ruhigen Moment
 * (`hasOpenDrafts()` ist falsch) – sonst würde er unter dem Tippen den Text austauschen.
 *
 * Wer ein Feld, Formular oder einen Dialog baut, der Eingaben hält, meldet sich an
 * (`useHoldDraft(aktiv)` bzw. `holdDraft`).
 */
import { useEffect } from 'react';

const held = new Map<symbol, string>();
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of [...listeners]) listener();
};

/** Hält einen Entwurf offen. Gibt das Freigeben zurück (mehrfaches Freigeben schadet nicht). */
export function holdDraft(key: string): () => void {
  const token = Symbol(key);
  held.set(token, key);
  notify();
  return () => {
    if (held.delete(token)) notify();
  };
}

/** Steht irgendwo ungespeicherter Text? */
export function hasOpenDrafts(): boolean {
  return held.size > 0;
}

/** Meldet jede Änderung des Registers. Gibt die Abmeldung zurück. */
export function subscribeDrafts(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Das Register als Baustein für den Abgleich (dort als Parameter, damit Tests ohne Oberfläche laufen). */
export const draftRegister = { has: hasOpenDrafts, subscribe: subscribeDrafts };

/** Hält einen Entwurf, solange `active` wahr ist. */
export function useHoldDraft(active: boolean, key: string): void {
  useEffect(() => (active ? holdDraft(key) : undefined), [active, key]);
}
