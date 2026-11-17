/**
 * Bausteine für Blätter, auf denen der Spielleiter etwas von oben nach unten schreibt (eine
 * Geschichte, die Vorbereitung eines Abends): Abschnitte mit einem Satz, was hierhin gehört,
 * Listen zum Schreiben und der Rat am Rand, was noch leer ist. Geschrieben wird beim Verlassen
 * eines Feldes – ein „Speichern“ gibt es auf einem Blatt nicht.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Circle, Minus, X } from 'lucide-react';
import { Input, TextArea } from './components';
import { useHoldDraft } from './drafts';
import { useMention, type MentionOptions } from './mention';
import './sheet.css';

/** Der Browser hält ein Textfeld von selbst so hoch wie seinen Inhalt (`field-sizing`). */
const FITS_ITSELF =
  typeof CSS !== 'undefined' &&
  typeof CSS.supports === 'function' &&
  CSS.supports('field-sizing', 'content');

/** Wo der Browser es nicht selbst tut: das Feld so hoch machen wie das, was darin steht. */
function fitHeight(field: HTMLTextAreaElement | null): void {
  if (FITS_ITSELF || !field) return;
  field.style.height = 'auto';
  // Nicht zu sehen (ein verborgenes Fach): Dann lässt sich nichts messen.
  if (!field.scrollHeight) return;
  field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
}

/**
 * Ein Textfeld, das beim Verlassen schreibt – und nur, wenn sich etwas geändert hat. Für Blätter,
 * auf denen es kein „Speichern“ gibt. Mit `rows` ein mehrzeiliges Feld fester Höhe. Mit `grow` ein
 * mehrzeiliges Feld und mit `wrap` eine Zeile, die umbricht, wenn der Satz länger wird (dort
 * schreibt die Eingabetaste, statt umzubrechen) – beide so hoch wie ihr Inhalt: Leer bleiben sie
 * eine Zeile. Mit `mention` schlägt „@“ Einträge der Welt vor und legt Fehlendes an; der Name
 * steht danach als gewöhnlicher Text da.
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
  autoFocus,
  selectAll,
  grow,
  wrap,
}: {
  value: string;
  onSave: (text: string) => void;
  rows?: number;
  /** Mehrzeilig und so hoch wie der Inhalt – leer eine Zeile. */
  grow?: boolean | undefined;
  /** Eine Zeile, die umbricht statt abzuschneiden – für Sätze in Listen. */
  wrap?: boolean | undefined;
  placeholder?: string;
  /** Wofür das Feld ist – für Vorleseprogramme. */
  label: string;
  className?: string;
  /** Vorschläge zum Auswählen (`<datalist>`), nur einzeilig. */
  list?: string;
  /** „@“ im Text: Einträge erwähnen und anlegen (`useMention`). */
  mention?: MentionOptions | undefined;
  /** Das Feld ist eben erst entstanden (eine neue Zeile): Die Schreibmarke steht gleich darin. */
  autoFocus?: boolean | undefined;
  /** Beim Hineinklicken ist alles markiert – für einen Namen, der noch die Vorgabe ist. */
  selectAll?: boolean | undefined;
}) {
  const [text, setText] = useState(value);
  // Ändert sich der Wert woanders (ein anderes Fenster, ein anderes Blatt), gilt der neue.
  useEffect(() => setText(value), [value]);
  // Ungeschriebener Text: Der Abgleich wartet mit dem Übernehmen, bis er geschrieben ist.
  useHoldDraft(text !== value, 'written');
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const commit = () => {
    if (text !== value) onSave(text);
  };
  const fit = !!grow || !!wrap;
  const multi = !!rows || fit;
  useLayoutEffect(() => {
    if (fit) fitHeight(area.current);
  }, [text, fit]);
  const at = useMention({
    field: multi ? area : input,
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
      {multi ? (
        <TextArea
          ref={area}
          className={fit ? (className ? `wf-written ${className}` : 'wf-written') : className}
          rows={fit ? 1 : rows}
          value={text}
          autoFocus={autoFocus}
          aria-label={label}
          placeholder={placeholder}
          onChange={(event) => {
            setText(event.target.value);
            at.track(event.target, true);
          }}
          onSelect={(event) => at.track(event.currentTarget)}
          onKeyDown={(event) => {
            if (at.onKeyDown(event) || !wrap) return;
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          onBlur={(event) => leave(event.relatedTarget)}
        />
      ) : (
        <Input
          ref={input}
          className={className}
          value={text}
          list={list}
          autoFocus={autoFocus}
          aria-label={label}
          placeholder={placeholder}
          onFocus={selectAll ? (event) => event.currentTarget.select() : undefined}
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
 * Die leere Zeile am Ende einer Liste auf einem Blatt: Mit dem ersten Wort entsteht der Eintrag –
 * vorher gibt es ihn nicht, also auch keine leeren Karteileichen. Nach der Eingabetaste steht die
 * Schreibmarke gleich in der nächsten leeren Zeile.
 */
export function NewLine({
  label,
  placeholder,
  onAdd,
  mention,
  className,
}: {
  /** Wofür die Zeile ist – für Vorleseprogramme. */
  label: string;
  /** Die Leitfrage zur Form – nie ein ausgedachtes Beispiel. */
  placeholder: string;
  onAdd: (text: string) => void;
  mention?: MentionOptions | undefined;
  className?: string | undefined;
}) {
  /** Zählt die angelegten Einträge: Danach ist die Zeile wieder leer. */
  const [round, setRound] = useState({ count: 0, focus: false });
  const viaEnter = useRef(false);
  return (
    <div
      className={className ? `wf-sheet__new ${className}` : 'wf-sheet__new'}
      onKeyDownCapture={(event) => {
        viaEnter.current = event.key === 'Enter';
      }}
      onPointerDownCapture={() => {
        viaEnter.current = false;
      }}
    >
      <Written
        key={round.count}
        autoFocus={round.focus}
        label={label}
        value=""
        wrap
        placeholder={placeholder}
        mention={mention}
        onSave={(text) => {
          const clean = text.replace(/\s+/g, ' ').trim();
          if (!clean) return;
          onAdd(clean);
          setRound((before) => ({ count: before.count + 1, focus: viaEnter.current }));
        }}
      />
    </div>
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

const sheetSectionId = (key: string) => `wf-sheet-sec-${key}`;

/**
 * Springt zu einem Fach des Blatts (`SheetSection` mit `id`) und setzt die Schreibmarke in sein
 * erstes Feld – gibt es noch keines, auf seinen ersten Knopf. Mit `label` in das Feld, das so
 * heißt (seine Beschriftung für Vorleseprogramme): Ein Fach kann mehrere Dinge fassen.
 */
export function focusSheetSection(key: string, label?: string): void {
  const section = document.getElementById(sheetSectionId(key));
  if (!section) return;
  const named = label
    ? [...section.querySelectorAll<HTMLElement>('[aria-label]')].find(
        (field) => field.getAttribute('aria-label') === label,
      )
    : undefined;
  // Ein Feld mitten im Fach kommt in die Mitte des Blatts – so bleibt sichtbar, wozu es gehört.
  if (named) named.scrollIntoView({ block: 'center', behavior: 'smooth' });
  else section.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const field =
    named ??
    section.querySelector<HTMLElement>(
      'textarea, input:not([type="checkbox"]), .wf-picker__value',
    ) ??
    section.querySelector<HTMLElement>('button, select');
  field?.focus({ preventScroll: true });
}

/**
 * Ein Abschnitt eines Blatts: Titel, ein Satz, was hierhin gehört, und der Inhalt. Mit `id` lässt
 * er sich anspringen (`focusSheetSection`).
 */
export function SheetSection({
  id,
  title,
  hint,
  action,
  children,
}: {
  id?: string | undefined;
  title: string;
  /** Was hierhin gehört – ein Satz: die Leitfrage zur Form, nie ein Inhalt. */
  hint: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="wf-sheet__sec" id={id ? sheetSectionId(id) : undefined}>
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
  /** Abgewählt („brauche ich nicht“). */
  off?: boolean | undefined;
}

/**
 * Der Rat am Rand: was geschrieben ist, was noch offen ist – und warum es hilft. Mit `onPick`
 * führt ein Punkt zu seinem Fach; mit `onOff` lässt sich jeder offene Punkt abwählen („brauche
 * ich nicht“) und wieder aufnehmen. Ein Rat, nie eine Pflicht.
 */
export function SheetAdvice<T extends SheetAdviceItem>({
  items,
  onPick,
  onOff,
}: {
  items: readonly T[];
  onPick?: ((item: T) => void) | undefined;
  onOff?: ((item: T, off: boolean) => void) | undefined;
}) {
  // Oben ein Satz: der nächste offene Punkt. Die ganze Reihe erst auf Wunsch – sie ist zum
  // Nachsehen da, nicht zum Abarbeiten (Rundgang 17. 11.: „wie ein Fragebogen“).
  const [all, setAll] = useState(false);
  const next = items.find((entry) => !entry.done && !entry.off);
  const done = items.filter((entry) => entry.done).length;
  const list = (
    <ul className="wf-sheet-advice">
      {items.map((entry) => {
        const off = !entry.done && !!entry.off;
        return (
          <li key={entry.key} data-done={entry.done} data-off={off} title={entry.why}>
            {entry.done ? (
              <Check aria-label="geschrieben" />
            ) : off ? (
              <Minus aria-label="abgewählt" />
            ) : (
              <Circle aria-label="offen" />
            )}
            <span>
              {onPick ? (
                <button
                  type="button"
                  className="wf-sheet-advice__go"
                  title="Zum Fach springen"
                  onClick={() => onPick(entry)}
                >
                  {entry.text}
                </button>
              ) : (
                entry.text
              )}
              {off && onOff && (
                <button
                  type="button"
                  className="wf-sheet-advice__back"
                  onClick={() => onOff(entry, false)}
                >
                  doch aufnehmen
                </button>
              )}
            </span>
            {!entry.done && !off && onOff && (
              <button
                type="button"
                className="wf-sheet-advice__off"
                title="Brauche ich nicht – der Punkt zählt dann nicht mehr als offen"
                aria-label={`„${entry.text}“ brauche ich nicht`}
                onClick={() => onOff(entry, true)}
              >
                <X aria-hidden />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
  return (
    <div className="wf-sheet-advice-box">
      {next ? (
        <div className="wf-sheet-advice__next">
          <span className="wf-sheet-advice__label">Als Nächstes</span>
          {onPick ? (
            <button
              type="button"
              className="wf-sheet-advice__go wf-sheet-advice__nexttext"
              onClick={() => onPick(next)}
            >
              {next.text}
            </button>
          ) : (
            <span className="wf-sheet-advice__nexttext">{next.text}</span>
          )}
          <em>{next.why}</em>
          {onOff && (
            <button
              type="button"
              className="wf-sheet-advice__back"
              onClick={() => onOff(next, true)}
            >
              brauche ich nicht
            </button>
          )}
        </div>
      ) : (
        <p className="wf-sheet-advice__next wf-sheet-advice__next--none">
          Nichts mehr offen – was jetzt noch fehlt, zeigt sich am Tisch.
        </p>
      )}
      {items.length > 1 && (
        <button
          type="button"
          className="wf-sheet-advice__all"
          aria-expanded={all}
          onClick={() => setAll((open) => !open)}
        >
          {all ? 'Weniger zeigen' : `Alle Punkte zeigen (${done} geschrieben)`}
        </button>
      )}
      {all && list}
    </div>
  );
}
