/**
 * Ein Name für die Mitschrift: Ein Klick auf einen Gefährten in der Leiste setzt ihn in die
 * Zeile – so steht schnell da, wer was getan hat. Nur im Arbeitsspeicher, nie im Spielstand.
 */
export interface JournalName {
  id: string;
  name: string;
}

const listeners = new Set<(name: JournalName) => void>();

/** Setzt den Namen in die Zeile der Mitschrift (verknüpft, wie mit „@“ gewählt). */
export function nameIntoJournal(name: JournalName): void {
  listeners.forEach((listener) => listener(name));
}

/** Für die Zeile der Mitschrift: hört auf Namen aus der Leiste. */
export function onJournalName(listener: (name: JournalName) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Der Text nach dem Einsetzen: am Anfang einer leeren Zeile, sonst hinten angefügt. */
export function withName(text: string, name: string): string {
  if (!text.trim()) return `${name} `;
  return `${text.replace(/\s+$/, '')} ${name} `;
}
