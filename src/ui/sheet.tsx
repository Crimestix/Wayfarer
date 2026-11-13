/**
 * Bausteine für Blätter, auf denen der Spielleiter etwas von oben nach unten schreibt (eine
 * Geschichte, die Vorbereitung eines Abends): Abschnitte mit einem Satz, was hierhin gehört,
 * Listen zum Schreiben und der Rat am Rand, was noch leer ist. Geschrieben wird beim Verlassen
 * eines Feldes – ein „Speichern“ gibt es auf einem Blatt nicht.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Check, Circle } from 'lucide-react';
import './sheet.css';

/**
 * Eine Liste zum Schreiben: Getippt wird nur hier; geschrieben wird beim Verlassen eines Feldes
 * (`flush`) oder sofort bei einer Auswahl (`set`). Leere Zeilen bleiben stehen, bis etwas darin
 * steht – gespeichert werden sie nie.
 */
export function useDraftList<T extends { id: string }>(
  source: readonly T[],
  save: (items: T[]) => void,
  isEmpty: (item: T) => boolean,
) {
  const [items, setItems] = useState<T[]>(() => [...source]);
  const key = JSON.stringify(source);
  // Ändert sich der Spielstand (auch durch das eigene Speichern), gilt er – leere Zeilen bleiben.
  useEffect(() => {
    setItems((before) => [
      ...source,
      ...before.filter((item) => isEmpty(item) && !source.some((kept) => kept.id === item.id)),
    ]);
    // `source` und `isEmpty` sind bei jedem Zeichnen neu; gemeint ist der Inhalt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const filled = (list: T[]) => list.filter((item) => !isEmpty(item));
  return {
    items,
    /** Tippen: nur hier. */
    edit: (id: string, change: Partial<T>) =>
      setItems((list) => list.map((item) => (item.id === id ? { ...item, ...change } : item))),
    /** Feld verlassen: schreiben. */
    flush: () => save(filled(items)),
    /** Eine Auswahl: gleich schreiben. */
    set: (id: string, change: Partial<T>) => {
      const next = items.map((item) => (item.id === id ? { ...item, ...change } : item));
      setItems(next);
      save(filled(next));
    },
    add: (item: T) => setItems((list) => [...list, item]),
    remove: (id: string) => {
      const next = items.filter((item) => item.id !== id);
      setItems(next);
      save(filled(next));
    },
  };
}

/** Ein Abschnitt eines Blatts: Titel, ein Satz, was hierhin gehört, und der Inhalt. */
export function SheetSection({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  /** Was hierhin gehört – ein Satz. */
  hint: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="wf-sheet__sec">
      <header className="wf-sheet__head">
        <h2>{title}</h2>
        {action}
      </header>
      <p className="wf-sheet__hint">{hint}</p>
      {children}
    </section>
  );
}

export interface SheetAdviceItem {
  key: string;
  done: boolean;
  text: string;
  why: string;
}

/** Der Rat am Rand: was geschrieben ist, was noch offen ist – und warum es hilft. */
export function SheetAdvice({ items }: { items: readonly SheetAdviceItem[] }) {
  return (
    <ul className="wf-sheet-advice">
      {items.map((entry) => (
        <li key={entry.key} data-done={entry.done} title={entry.why}>
          {entry.done ? <Check aria-label="geschrieben" /> : <Circle aria-label="offen" />}
          <span>
            {entry.text}
            {!entry.done && <em>{entry.why}</em>}
          </span>
        </li>
      ))}
    </ul>
  );
}
