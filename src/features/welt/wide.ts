/**
 * Breit schreiben (F11): Die Liste links und die Spalte „Jetzt“ treten bei Bedarf zurück, damit
 * der Text Platz hat. Reine Ansicht – nicht gespeichert, gilt bis zum Neustart; alles bleibt über
 * denselben Knopf wieder da.
 */
import { useSyncExternalStore } from 'react';

let wide = false;
const listeners = new Set<() => void>();

export function setWideText(next: boolean): void {
  if (wide === next) return;
  wide = next;
  for (const listener of listeners) listener();
}

export function useWideText(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => wide,
  );
}
