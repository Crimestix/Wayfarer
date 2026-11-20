/**
 * Register offener Entwürfe: Wo gerade ungespeicherter Text steht (ein Feld eines Blatts, der
 * Editor eines Artikels, ein offener Dialog, der Wesen-Editor), meldet sich die Stelle hier an.
 * Der Abgleich übernimmt Änderungen vom anderen Rechner nur in einem ruhigen Moment
 * (`hasOpenDrafts()` ist falsch) – sonst würde er unter dem Tippen den Text austauschen.
 *
 * Wer ein Feld, Formular oder einen Dialog baut, der Eingaben hält, meldet sich an
 * (`useHoldDraft(aktiv)` bzw. `holdDraft`).
 */
import { useEffect, useRef } from 'react';

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

const savers = new Set<() => void>();

/**
 * Schreibt sofort, was in offenen Feldern steht – vor dem Schließen oder Neuladen der App, wenn
 * kein Feld mehr verlassen wird (K08). Felder melden sich über `useHoldDraft(…, save)` an.
 */
export function saveOpenDrafts(): void {
  for (const save of [...savers]) save();
}

/**
 * Hält einen Entwurf, solange `active` wahr ist. Mit `save` kann die App ihn vor dem Schließen
 * selbst schreiben lassen.
 */
export function useHoldDraft(active: boolean, key: string, save?: () => void): void {
  useEffect(() => (active ? holdDraft(key) : undefined), [active, key]);
  const latest = useRef(save);
  latest.current = save;
  useEffect(() => {
    if (!active || !latest.current) return;
    const run = () => latest.current?.();
    savers.add(run);
    return () => {
      savers.delete(run);
    };
  }, [active]);
}
