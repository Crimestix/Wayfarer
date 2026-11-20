/**
 * Editor für Artikel: ein Text, zwei Ansichten. `live` setzt den Text, während man schreibt
 * (Zeichen nur dort sichtbar, wo der Cursor steht), `source` zeigt ihn, wie er gespeichert wird.
 * Gespeichert wird immer nur der Text selbst.
 */
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  keymap,
  placeholder as placeholderText,
} from '@codemirror/view';
import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type Ref,
} from 'react';
import { toggleMarkup, writingKeymap } from './commands';
import { linkCompletion } from './completion';
import { blockInsertion, togglePrefix } from './helpers';
import { hostFacet, refreshEffect, type EditorHost } from './host';
import { liveView, sourceView } from './live';
import { wikiMarkdown } from './syntax';
import { editorTheme, liveColors, sourceColors } from './theme';
import { takeTypedAhead } from '../editing';
import './editor.css';

export type EditorMode = 'live' | 'source';

export interface LinkSuggestion {
  /** Was in der Liste steht. */
  label: string;
  /** Ziel, das zwischen die Klammern kommt (ohne Klammern). */
  target: string;
  /** Kleine Zusatzzeile, z. B. der Pfad im Baum. */
  detail?: string;
}

export interface MarkdownEditorProps {
  /** Text beim Einhängen. Danach führt der Editor selbst; ein anderer Artikel bekommt per `key` einen neuen Editor. */
  initialValue: string;
  /** Bei jeder Änderung mit dem ganzen Text. */
  onChange: (text: string) => void;
  mode: EditorMode;
  /** Vorschläge für Verweise zu dem, was nach `[[` oder `@` getippt wurde (leer = alle wichtigen). */
  suggestLinks: (query: string) => LinkSuggestion[];
  /** Gibt es den Artikel zu diesem Verweisziel? Unbekannte Ziele werden anders gefärbt. */
  isKnownLink: (target: string) => boolean;
  /** Strg/Cmd+Klick auf einen Verweis (in `live` auch ein gewöhnlicher Klick auf einen Verweis außerhalb der Cursorzeile). */
  onOpenLink?: (target: string) => void;
  /** Macht aus einer Bildadresse die Adresse, die geladen wird (lokale Datei); ohne Angabe die Adresse selbst. */
  imageSrc?: (url: string) => string | undefined;
  placeholder?: string;
  autoFocus?: boolean;
  /** Zusätzliche Klasse am äußeren Element. */
  className?: string;
}

/** Was eine Werkzeugleiste außerhalb des Editors auslösen kann. */
export interface MarkdownEditorHandle {
  focus(): void;
  getValue(): string;
  /** Ersetzt die Auswahl durch `text` (ohne Auswahl: fügt an der Schreibmarke ein). */
  insertText(text: string): void;
  /** Schaltet eine Auszeichnung um die Auswahl um, etwa `**`…`**`. Steht sie schon da, fällt sie weg. */
  wrapSelection(before: string, after: string): void;
  /**
   * Setzt `prefix` (`## `, `- `, `1. `, `> `) vor jede Zeile der Auswahl; steht er schon da, fällt
   * er weg. Eine Überschrift ersetzt eine andere Überschrift.
   */
  prefixLines(prefix: string): void;
  /** Fügt `text` als eigenen Absatz hinter dem aktuellen ein und setzt die Schreibmarke an sein Ende. */
  insertBlock(text: string): void;
}

/** Beschriftungen der Teile, die CodeMirror selbst mitbringt (Suche im Text, Vorschläge). */
const PHRASES: Record<string, string> = {
  Find: 'Suchen',
  Replace: 'Ersetzen durch',
  next: 'Weiter',
  previous: 'Zurück',
  all: 'Alle markieren',
  'match case': 'Groß- und Kleinschreibung beachten',
  regexp: 'Als Suchmuster lesen',
  'by word': 'Nur ganze Wörter',
  replace: 'Ersetzen',
  'replace all': 'Alle ersetzen',
  close: 'Schließen',
  'current match': 'Aktueller Treffer',
  'replaced $ matches': '$ Treffer ersetzt',
  'replaced match on line $': 'Treffer in Zeile $ ersetzt',
  'on line': 'in Zeile',
  'Go to line': 'Gehe zu Zeile',
  go: 'Los',
  Completions: 'Vorschläge',
  'Selection deleted': 'Auswahl gelöscht',
  'Control character': 'Steuerzeichen',
};

function modeExtensions(mode: EditorMode): Extension {
  return mode === 'live'
    ? [liveView(), liveColors, EditorView.editorAttributes.of({ class: 'wf-wiki-ed--live' })]
    : [sourceView(), sourceColors, EditorView.editorAttributes.of({ class: 'wf-wiki-ed--source' })];
}

const placeholderExtension = (text: string | undefined): Extension =>
  text ? placeholderText(text) : [];

export function MarkdownEditor(
  props: MarkdownEditorProps & { ref?: Ref<MarkdownEditorHandle> },
): JSX.Element {
  const { mode, placeholder, className, isKnownLink, imageSrc, ref } = props;
  const parent = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** Die jeweils aktuellen Angaben der Seite; der Editor fragt sie erst ab, wenn er sie braucht. */
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });
  const [compartments] = useState(() => ({
    mode: new Compartment(),
    placeholder: new Compartment(),
  }));

  useEffect(() => {
    const host: EditorHost = {
      suggestLinks: (query) => latest.current.suggestLinks(query),
      isKnownLink: (target) => latest.current.isKnownLink(target),
      openLink: (target) => {
        const open = latest.current.onOpenLink;
        if (!open) return false;
        open(target);
        return true;
      },
      imageSrc: (url) => latest.current.imageSrc?.(url) ?? url,
    };
    const view = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: latest.current.initialValue,
        extensions: [
          hostFacet.of(host),
          history(),
          drawSelection(),
          EditorView.lineWrapping,
          EditorState.phrases.of(PHRASES),
          wikiMarkdown(),
          linkCompletion(),
          search({ top: true }),
          Prec.high(keymap.of(writingKeymap)),
          keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap]),
          editorTheme,
          compartments.mode.of(modeExtensions(latest.current.mode)),
          compartments.placeholder.of(placeholderExtension(latest.current.placeholder)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    if (latest.current.autoFocus) {
      // Die Einfügemarke ans Ende: Wer auf einer leeren Seite angefangen hat, schreibt weiter.
      // Was getippt wurde, während der Editor lud, kommt dazu (`takeTypedAhead`).
      const end = view.state.doc.length;
      const ahead = takeTypedAhead();
      view.dispatch({
        changes: ahead ? { from: end, insert: ahead } : undefined,
        selection: { anchor: end + ahead.length },
      });
      view.focus();
    }
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [compartments]);

  // Wechsel der Ansicht: Text, Cursor und Rückgängig-Verlauf bleiben, nur die Darstellung tauscht.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.mode.reconfigure(modeExtensions(mode)) });
  }, [compartments, mode]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.placeholder.reconfigure(placeholderExtension(placeholder)),
    });
  }, [compartments, placeholder]);

  // Andere Antworten der Seite (neuer Artikel angelegt, Bild geholt): Verweise und Bilder neu prüfen.
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshEffect.of(null) });
  }, [isKnownLink, imageSrc]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => viewRef.current?.focus(),
      getValue: () => viewRef.current?.state.doc.toString() ?? latest.current.initialValue,
      insertText: (text) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch(view.state.replaceSelection(text), {
          scrollIntoView: true,
          userEvent: 'input',
        });
        view.focus();
      },
      wrapSelection: (before, after) => {
        const view = viewRef.current;
        if (!view) return;
        toggleMarkup(view, before, after);
        view.focus();
      },
      prefixLines: (prefix) => {
        const view = viewRef.current;
        if (!view) return;
        const { doc, selection } = view.state;
        const first = doc.lineAt(selection.main.from).number;
        const last = doc.lineAt(selection.main.to).number;
        const lines = Array.from({ length: last - first + 1 }, (_, n) => doc.line(first + n));
        const next = togglePrefix(
          lines.map((line) => line.text),
          prefix,
        );
        // Nur der Zeilenanfang ändert sich; so bleibt die Schreibmarke bei ihrem Text.
        const changes = lines.flatMap((line, n) => {
          const now = next[n]!;
          if (now === line.text) return [];
          let same = 0;
          while (
            same < Math.min(now.length, line.length) &&
            now[now.length - 1 - same] === line.text[line.length - 1 - same]
          )
            same++;
          return [
            {
              from: line.from,
              to: line.to - same,
              insert: now.slice(0, now.length - same),
            },
          ];
        });
        // Steht die Schreibmarke am Zeilenanfang, gehört sie hinter den neuen Anfang, nicht davor.
        const only = changes.length === 1 && selection.main.empty ? changes[0]! : null;
        const atStart = only !== null && selection.main.head === only.from;
        view.dispatch({
          changes,
          ...(atStart ? { selection: { anchor: only.from + only.insert.length } } : {}),
          scrollIntoView: true,
          userEvent: 'input',
        });
        view.focus();
      },
      insertBlock: (text) => {
        const view = viewRef.current;
        if (!view) return;
        const { from, to, insert, cursor } = blockInsertion(
          view.state.doc.toString(),
          view.state.selection.main.head,
          text,
        );
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: cursor },
          scrollIntoView: true,
          userEvent: 'input',
        });
        view.focus();
      },
    }),
    [],
  );

  return <div ref={parent} className={className ? `wf-wiki-ed ${className}` : 'wf-wiki-ed'} />;
}
