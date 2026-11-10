/**
 * Was beim Schreiben im Wiki über mehrere Bausteine hinweg gilt: in welcher Ansicht ein Artikel
 * offen ist und wie noch nicht gespeicherte Eingaben vor einem anderen Handgriff gesichert werden.
 */

/** Lesen, Schreiben (schöne Ansicht) oder Quelltext. */
export type WikiMode = 'read' | 'live' | 'source';

export const MODE_LABEL: Record<WikiMode, string> = {
  read: 'Lesen',
  live: 'Schreiben',
  source: 'Quelltext',
};

const flushers = new Set<() => void>();

/** Ein offener Editor meldet, wie er seine Eingaben sofort speichert. Gibt das Abmelden zurück. */
export function registerFlush(flush: () => void): () => void {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}

/**
 * Speichert, was gerade getippt, aber noch nicht geschrieben ist. Gehört vor jeden Handgriff, der
 * Artikel verändert (umbenennen, verschieben, löschen), damit er auf dem aktuellen Text arbeitet.
 */
export function flushEdits(): void {
  for (const flush of [...flushers]) flush();
}

/** Wartezeit nach dem letzten Tastendruck, bis gespeichert wird. */
export const SAVE_DELAY_MS = 600;
