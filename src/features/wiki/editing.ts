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

let focusEnd = false;

/**
 * Der nächste Editor, der sich öffnet, bekommt den Fokus und setzt die Einfügemarke ans Ende –
 * so geht ein angefangenes Wort auf einer leeren Seite nahtlos im Editor weiter.
 */
export function requestFocusEnd(): void {
  focusEnd = true;
  typedAhead = '';
  startCapture();
}

/**
 * Was getippt wird, während die leere Seite schon weg und der Editor noch nicht da ist: Es geht
 * nicht verloren, sondern wartet hier, bis der Editor es übernimmt (`takeTypedAhead`).
 */
let typedAhead = '';
/** Ein unsichtbares Feld fängt die Tasten – so kommen auch Umlaute, Akzente und AltGr an. */
let catcher: HTMLTextAreaElement | null = null;
let captureTimer: ReturnType<typeof setTimeout> | undefined;

function startCapture(): void {
  if (typeof document === 'undefined') return;
  stopCapture();
  const field = document.createElement('textarea');
  field.setAttribute('aria-hidden', 'true');
  field.tabIndex = -1;
  field.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
  document.body.appendChild(field);
  field.focus();
  catcher = field;
  captureTimer = setTimeout(stopCapture, 4000);
}

function stopCapture(): void {
  clearTimeout(captureTimer);
  if (!catcher) return;
  typedAhead += catcher.value;
  catcher.remove();
  catcher = null;
}

/**
 * Der Editor übernimmt, was inzwischen getippt wurde. Geleert wird erst danach – ein Editor, der
 * gleich noch einmal aufgebaut wird (Prüfmodus der Vorschau), bekommt dasselbe.
 */
export function takeTypedAhead(): string {
  stopCapture();
  setTimeout(() => {
    if (!catcher) typedAhead = '';
  }, 0);
  return typedAhead;
}

/** Ob der nächste Editor ans Ende springen soll – der Editor fragt beim Öffnen. */
export function wantsFocusEnd(): boolean {
  return focusEnd;
}

/** Der Editor hat den Wunsch erfüllt (nach dem Öffnen, damit ein zweiter Aufbau ihn noch sieht). */
export function clearFocusEnd(): void {
  focusEnd = false;
}

/** Wartezeit nach dem letzten Tastendruck, bis gespeichert wird. */
export const SAVE_DELAY_MS = 600;
