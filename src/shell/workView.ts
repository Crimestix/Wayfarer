/**
 * Die Arbeitsansicht: Vorbereiten oder Spielen (F06). Sie ist reine Ansicht – ein Wechsel ändert
 * nichts an der Kampagne: keine Session beginnt, keine Zeit vergeht, nichts wird aufgedeckt oder
 * versetzt. Beim Vorbereiten tritt die Live-Steuerung (Zeit, Ort, Session, Wetter) in der Leiste
 * zurück; beim Spielen ist sie ganz da. Hexkarte und Dungeon beginnen in der passenden lokalen
 * Ansicht (F13) – umschalten lässt sich dort jederzeit.
 *
 * Gespeichert wird sie nicht: Ohne eigene Wahl folgt sie dem Abend – läuft eine Session, wird
 * gespielt, sonst vorbereitet (`defaultWorkView`). Eine Wahl gilt bis zum Neustart.
 */
import { useSyncExternalStore } from 'react';

export type WorkView = 'prep' | 'play';

export const WORK_VIEW_LABEL: Record<WorkView, string> = {
  prep: 'Vorbereiten',
  play: 'Spielen',
};

/** Ohne eigene Wahl: Läuft ein Abend, wird gespielt. */
export function defaultWorkView(sessionRunning: boolean): WorkView {
  return sessionRunning ? 'play' : 'prep';
}

let chosen: WorkView | null = null;
const listeners = new Set<() => void>();

export function setWorkView(view: WorkView): void {
  if (chosen === view) return;
  chosen = view;
  for (const listener of listeners) listener();
}

/** Die geltende Ansicht: die eigene Wahl, sonst die Vorgabe nach dem Abend. */
export function useWorkView(sessionRunning: boolean): WorkView {
  const own = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => chosen,
  );
  return own ?? defaultWorkView(sessionRunning);
}

/**
 * Womit eine Karte (Hexkarte, Dungeon) beginnt: Spielen nur, wenn gerade gespielt wird und es dort
 * etwas zu spielen gibt (eine Gruppe auf der Hexkarte) – sonst Vorbereiten (F13).
 */
export function localWorkView(global: WorkView, playable: boolean): WorkView {
  return global === 'play' && playable ? 'play' : 'prep';
}

/** Die geltende Ansicht, ohne den Abend zu kennen – für Seiten, die sie nur als Vorgabe lesen. */
export function currentWorkView(sessionRunning: boolean): WorkView {
  return chosen ?? defaultWorkView(sessionRunning);
}

/** Nur für Tests: zurück zur Vorgabe. */
export function resetWorkView(): void {
  chosen = null;
  for (const listener of listeners) listener();
}
