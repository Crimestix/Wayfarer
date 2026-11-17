/**
 * Das Seitenblatt (Rückmeldung des Spielleiters, 17. 11. 2026: „Dinge entstehen an einer Seite,
 * man muss woanders hin, wieder zurück“): Ein Name, auf den man am Spieltisch, auf dem Fadenbrett
 * oder auf einem Blatt klickt, öffnet seine Seite rechts daneben – die eigene Seite bleibt offen.
 * Weitere Namen darin legen sich darauf („Zurück“ führt zum vorigen). In der Welt selbst führen
 * Namen wie bisher auf ihre Seite.
 */
import { useSyncExternalStore } from 'react';

let stack: readonly string[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Höchstens so viele Seiten liegen aufeinander – die älteste fällt weg. */
const MOST = 8;

/** Öffnet die Seite eines Eintrags im Seitenblatt (liegt sie schon oben, bleibt alles). */
export function openSheet(id: string): void {
  if (stack[stack.length - 1] === id) return;
  stack = [...stack.filter((entry) => entry !== id), id].slice(-MOST);
  emit();
}

/** Eine Seite zurück; die letzte schließt das Blatt. */
export function sheetBack(): void {
  stack = stack.slice(0, -1);
  emit();
}

/** Schließt das Seitenblatt ganz. */
export function closeSheet(): void {
  if (!stack.length) return;
  stack = [];
  emit();
}

/** Die Seiten im Blatt, die oberste zuletzt (ohne React). */
export const sheetStack = (): readonly string[] => stack;

/** Die Seiten im Blatt, die oberste zuletzt. */
export function useSheetStack(): readonly string[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => stack,
  );
}

/** In der Welt (`/welt`, `/wiki`) führen Namen auf ihre Seite; überall sonst ins Seitenblatt. */
export const sheetOpensAt = (location: string): boolean => !/^\/(welt|wiki)(\/|$)/.test(location);
