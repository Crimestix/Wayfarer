/**
 * Handgriffe beim Schreiben: Listen und Kästen fortsetzen, einrücken, Auszeichnung umschalten,
 * Verweis setzen. Die Regeln selbst stehen als reine Funktionen in `helpers.ts`.
 */
import { acceptCompletion, startCompletion } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { EditorSelection, type ChangeSpec, type EditorState } from '@codemirror/state';
import type { Command, EditorView, KeyBinding } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { continueMarkup, quotePrefixLength, shiftListIndent, toggleWrap } from './helpers';

/** Steht diese Stelle in Code (Block oder Zeile)? Dort gelten die Zeichen nicht. */
export function inCode(state: EditorState, pos: number): boolean {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    node;
    node = node.parent
  )
    if (node.name === 'FencedCode' || node.name === 'InlineCode') return true;
  return false;
}

/** Eingabetaste: Liste, Zitat oder Kasten geht weiter; eine leere Fortsetzung endet. */
const continueOnEnter: Command = (view) => {
  const { state } = view;
  if (state.readOnly) return false;
  const steps = state.selection.ranges.map((range) => {
    if (!range.empty || inCode(state, range.head)) return null;
    const line = state.doc.lineAt(range.head);
    const step = continueMarkup(line.text, range.head - line.from);
    return step ? { line, step, head: range.head } : null;
  });
  if (steps.some((step) => step === null)) return false;
  let index = 0;
  view.dispatch(
    state.changeByRange(() => {
      const { line, step, head } = steps[index++]!;
      if (step.kind === 'continue')
        return {
          changes: { from: head, insert: step.insert },
          range: EditorSelection.cursor(head + step.insert.length),
        };
      // Die Schreibmarke bleibt hinter dem, was von der Zeile übrig ist.
      const from = line.from + step.from;
      const to = line.from + step.to;
      return {
        changes: { from, to, insert: step.insert },
        range: EditorSelection.cursor(Math.max(from, head - (to - from)) + step.insert.length),
      };
    }),
    { scrollIntoView: true, userEvent: 'input' },
  );
  return true;
};

/** Umschalt+Eingabe im Zitat oder Kasten: ein neuer Absatz, der im Kasten bleibt. */
const paragraphInQuote: Command = (view) => {
  const { state } = view;
  const { main } = state.selection;
  if (state.readOnly || !main.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(main.head);
  const length = quotePrefixLength(line.text);
  if (length === 0 || main.head - line.from < length || inCode(state, main.head)) return false;
  const quote = line.text.slice(0, length).replace(/>[ \t]?/g, '> ');
  const insert = `\n${quote.trimEnd()}\n${quote}`;
  view.dispatch({
    changes: { from: main.head, insert },
    selection: { anchor: main.head + insert.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
};

/**
 * Tab und Umschalt+Tab rücken die Listenpunkte der Auswahl ein und aus. Außerhalb von Listen tut
 * die Taste nichts – sie soll beim Schreiben nicht aus dem Text springen.
 */
function shiftList(by: 1 | -1): Command {
  return (view) => {
    const { state } = view;
    if (state.readOnly) return false;
    const changes: ChangeSpec[] = [];
    const seen = new Set<number>();
    for (const range of state.selection.ranges) {
      const last = state.doc.lineAt(range.to).number;
      for (let n = state.doc.lineAt(range.from).number; n <= last; n++) {
        if (seen.has(n)) continue;
        seen.add(n);
        const line = state.doc.line(n);
        const change = shiftListIndent(line.text, by);
        if (change)
          changes.push({
            from: line.from + change.from,
            to: line.from + change.to,
            insert: change.insert,
          });
      }
    }
    if (changes.length)
      view.dispatch({ changes, userEvent: by > 0 ? 'input.indent' : 'delete.dedent' });
    return true;
  };
}

/** Schaltet eine Auszeichnung um jede Auswahl um (`**`, `*`, `[[`…`]]`). */
export function toggleMarkup(view: EditorView, before: string, after: string): boolean {
  const { state } = view;
  if (state.readOnly) return false;
  view.dispatch(
    state.changeByRange((range) => {
      // Die Zeilen der Auswahl genügen, um zu sehen, ob die Auszeichnung schon da ist.
      const base = state.doc.lineAt(range.from).from;
      const text = state.doc.sliceString(base, state.doc.lineAt(range.to).to);
      const result = toggleWrap(text, range.from - base, range.to - base, before, after);
      return {
        changes: result.changes.map((change) => ({
          from: base + change.from,
          to: base + change.to,
          insert: change.insert,
        })),
        range: EditorSelection.range(base + result.from, base + result.to),
      };
    }),
    { scrollIntoView: true, userEvent: 'input' },
  );
  return true;
}

/** Strg/Cmd+K: Die Auswahl wird ein Verweis; ohne Auswahl öffnen sich die Vorschläge. */
const insertLink: Command = (view) => {
  const { main } = view.state.selection;
  if (!main.empty) return toggleMarkup(view, '[[', ']]');
  if (view.state.readOnly) return false;
  view.dispatch({
    changes: { from: main.head, insert: '[[]]' },
    selection: { anchor: main.head + 2 },
    scrollIntoView: true,
    userEvent: 'input',
  });
  startCompletion(view);
  return true;
};

export const writingKeymap: readonly KeyBinding[] = [
  { key: 'Enter', run: continueOnEnter, shift: paragraphInQuote },
  { key: 'Tab', run: (view) => acceptCompletion(view) || shiftList(1)(view), shift: shiftList(-1) },
  { key: 'Mod-b', run: (view) => toggleMarkup(view, '**', '**') },
  { key: 'Mod-i', run: (view) => toggleMarkup(view, '*', '*') },
  { key: 'Mod-k', run: insertLink, preventDefault: true },
];
