/**
 * Wer ist für ein Tastenkürzel zuständig? Ein Kürzel löst genau eine Aktion aus (F17): Global
 * gilt die Vorgabe der Leiste (Strg/Befehl+E = Festhalten); eine Arbeitsfläche, die dasselbe
 * Kürzel für sich braucht (der geöffnete Artikel: Lesen ↔ Schreiben), meldet sich hier an und
 * hat dann Vorrang. Die zuletzt angemeldete Fläche gewinnt – ein Seitenblatt vor der Seite
 * darunter. Gelesen wird nur von `useShortcuts` in `AppShell`, es gibt keinen zweiten Lauscher.
 */
import { useEffect, useRef } from 'react';

export type ShortcutKey = 'e';

const owners: Record<ShortcutKey, { id: number; run: () => void }[]> = { e: [] };
let nextId = 0;

/** Die zuständige Arbeitsfläche für ein Kürzel, oder null = die Vorgabe der Leiste. */
export function shortcutOwner(key: ShortcutKey): (() => void) | null {
  const list = owners[key];
  return list.length ? list[list.length - 1]!.run : null;
}

/** Meldet eine Arbeitsfläche für ein Kürzel an; gibt das Abmelden zurück. */
export function claimShortcut(key: ShortcutKey, run: () => void): () => void {
  const entry = { id: ++nextId, run };
  owners[key] = [...owners[key], entry];
  return () => {
    owners[key] = owners[key].filter((owner) => owner.id !== entry.id);
  };
}

/** Solange die Komponente steht, gehört ihr das Kürzel. */
export function useShortcut(key: ShortcutKey, run: () => void, active = true): void {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => (active ? claimShortcut(key, () => latest.current()) : undefined), [key, active]);
}
