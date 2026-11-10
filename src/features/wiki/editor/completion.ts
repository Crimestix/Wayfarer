/**
 * Vorschläge für Verweise: nach `[[` und nach einem `@` am Wortanfang. Welche Artikel passen,
 * entscheidet die Seite (`suggestLinks`); hier wird nur erkannt, was getippt wurde, und der
 * gewählte Vorschlag als `[[Ziel]]` eingesetzt.
 */
import {
  autocompletion,
  pickedCompletion,
  type Completion,
  type CompletionSource,
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { inCode } from './commands';
import { hasExactMatch, linkQueryBefore, linkText } from './helpers';
import { hostFacet } from './host';

/** Ersetzt das Getippte (samt einem schon vorhandenen `]]` dahinter) durch den Verweis. */
function applyLink(target: string) {
  return (view: EditorView, completion: Completion, from: number, to: number): void => {
    const end = view.state.doc.sliceString(to, to + 2) === ']]' ? to + 2 : to;
    const insert = linkText(target);
    view.dispatch({
      changes: { from, to: end, insert },
      selection: { anchor: from + insert.length },
      scrollIntoView: true,
      userEvent: 'input.complete',
      annotations: pickedCompletion.of(completion),
    });
  };
}

const linkSource: CompletionSource = (context) => {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const typed = linkQueryBefore(line.text.slice(0, pos - line.from));
  if (!typed || inCode(state, pos)) return null;
  const query = typed.query.trim();
  const suggestions = state.facet(hostFacet).suggestLinks(query);
  // Nach einem @ kann gewöhnlicher Text folgen: Mit Leerzeichen zählt nur, was wirklich passt.
  const loose = typed.trigger === 'at' && /\s/.test(typed.query);
  if (loose && suggestions.length === 0) return null;
  const options: Completion[] = suggestions.map((suggestion) => ({
    label: suggestion.label,
    detail: suggestion.detail,
    apply: applyLink(suggestion.target),
  }));
  if (query && !loose && !hasExactMatch(query, suggestions))
    options.push({
      label: `„${query}“ als neuen Verweis einfügen`,
      type: 'new',
      apply: applyLink(query),
    });
  if (options.length === 0) return null;
  return { from: line.from + typed.from, to: pos, options, filter: false };
};

export function linkCompletion(): Extension {
  return autocompletion({
    override: [linkSource],
    icons: false,
    activateOnTyping: true,
    closeOnBlur: true,
    maxRenderedOptions: 40,
    optionClass: (completion) => (completion.type === 'new' ? 'wf-wiki-ed-option-new' : ''),
    tooltipClass: () => 'wf-wiki-ed-suggest',
  });
}
