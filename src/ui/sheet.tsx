/**
 * Bausteine für Blätter, auf denen der Spielleiter etwas von oben nach unten schreibt (eine
 * Geschichte, die Vorbereitung eines Abends): Abschnitte mit einem Satz, was hierhin gehört,
 * Listen zum Schreiben und der Rat am Rand, was noch leer ist. Geschrieben wird beim Verlassen
 * eines Feldes – ein „Speichern“ gibt es auf einem Blatt nicht.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Circle } from 'lucide-react';
import { Input, TextArea } from './components';
import { useMention, type MentionOptions } from './mention';
import './sheet.css';

/**
 * Ein Textfeld, das beim Verlassen schreibt – und nur, wenn sich etwas geändert hat. Für Blätter,
 * auf denen es kein „Speichern“ gibt. Mit `rows` ein mehrzeiliges Feld. Mit `mention` schlägt „@“
 * Einträge der Welt vor und legt Fehlendes an; der Name steht danach als gewöhnlicher Text da.
 */
export function Written({
  value,
  onSave,
  rows,
  placeholder,
  label,
  className,
  list,
  mention,
}: {
  value: string;
  onSave: (text: string) => void;
  rows?: number;
  placeholder?: string;
  /** Wofür das Feld ist – für Vorleseprogramme. */
  label: string;
  className?: string;
  /** Vorschläge zum Auswählen (`<datalist>`), nur einzeilig. */
  list?: string;
  /** „@“ im Text: Einträge erwähnen und anlegen (`useMention`). */
  mention?: MentionOptions | undefined;
}) {
  const [text, setText] = useState(value);
  // Ändert sich der Wert woanders (ein anderes Fenster, ein anderes Blatt), gilt der neue.
  useEffect(() => setText(value), [value]);
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const commit = () => {
    if (text !== value) onSave(text);
  };
  const at = useMention({
    field: rows ? area : input,
    text,
    setText,
    options: mention ?? null,
    // Auf einem Blatt legt die Eingabetaste an, was das „@“ nicht findet – wie in der Auswahl.
    createOnEnter: true,
    onLeave: commit,
  });
  /** Verlassen schreibt – außer der Fokus ist nur in die Auswahl am „@“ gewandert. */
  const leave = (next: EventTarget | null) => {
    if (!at.leave(next)) commit();
  };
  return (
    <>
      {rows ? (
        <TextArea
          ref={area}
          className={className}
          rows={rows}
          value={text}
          aria-label={label}
          placeholder={placeholder}
          onChange={(event) => {
            setText(event.target.value);
            at.track(event.target, true);
          }}
          onSelect={(event) => at.track(event.currentTarget)}
          onKeyDown={(event) => {
            at.onKeyDown(event);
          }}
          onBlur={(event) => leave(event.relatedTarget)}
        />
      ) : (
        <Input
          ref={input}
          className={className}
          value={text}
          list={list}
          aria-label={label}
          placeholder={placeholder}
          onChange={(event) => {
            setText(event.target.value);
            at.track(event.target, true);
          }}
          onSelect={(event) => at.track(event.currentTarget)}
          onBlur={(event) => leave(event.relatedTarget)}
          onKeyDown={(event) => {
            if (at.onKeyDown(event)) return;
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
      )}
      {at.menu}
    </>
  );
}

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
