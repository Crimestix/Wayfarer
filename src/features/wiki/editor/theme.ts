/**
 * Aussehen der Teile, die CodeMirror selbst zeichnet (Cursor, Auswahl, Suche, Vorschläge), und
 * die Färbung der Markdown-Zeichen. Alle Werte kommen aus `src/ui/tokens.css`; was die schöne
 * Ansicht setzt (Überschriften, Kästen, Listen), steht in `editor.css`.
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

export const MONO = "ui-monospace, 'Cascadia Mono', Consolas, monospace";

export const editorTheme: Extension = EditorView.theme(
  {
    '&': {
      height: '100%',
      color: 'var(--ink)',
      backgroundColor: 'transparent',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': {
      fontFamily: 'var(--font-body)',
      fontSize: '1.06rem',
      lineHeight: '1.6',
      overflow: 'auto',
    },
    '.cm-content': {
      padding: 'var(--s-4) 0 var(--s-7)',
      caretColor: 'var(--gold-bright)',
    },
    '.cm-line': {
      padding: '0 var(--s-5)',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeft: '2px solid var(--gold-bright)',
      marginLeft: '-1px',
    },
    '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground':
      {
        background: 'color-mix(in srgb, var(--gold) 26%, transparent)',
      },
    '.cm-placeholder': {
      color: 'var(--ink-faint)',
      fontStyle: 'italic',
    },
    '.cm-selectionMatch': {
      background: 'color-mix(in srgb, var(--gold) 12%, transparent)',
    },
    '.cm-searchMatch': {
      background: 'var(--ember-wash)',
      outline: '1px solid color-mix(in srgb, var(--ember) 55%, transparent)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      background: 'color-mix(in srgb, var(--ember) 40%, transparent)',
    },

    // Suche im Text
    '.cm-panels': {
      color: 'var(--ink-soft)',
      backgroundColor: 'var(--bg-2)',
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-sm)',
    },
    '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
    '.cm-panel.cm-search': {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 'var(--s-1) var(--s-2)',
      padding: 'var(--s-2) var(--s-7) var(--s-2) var(--s-3)',
    },
    '.cm-panel.cm-search br': { flexBasis: '100%', height: '0', content: '""' },
    '.cm-panel.cm-search label': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--s-1)',
      margin: '0',
      fontSize: 'var(--text-sm)',
      color: 'var(--ink-mute)',
    },
    '.cm-panel.cm-search input[type=checkbox]': { accentColor: 'var(--gold)', margin: '0' },
    '.cm-textfield': {
      margin: '0',
      padding: '3px var(--s-2)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--radius)',
      backgroundColor: 'var(--bg-inset)',
      color: 'var(--ink)',
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-sm)',
    },
    '.cm-textfield:focus': { outline: 'none', borderColor: 'var(--gold-deep)' },
    '.cm-button': {
      margin: '0',
      padding: '3px var(--s-3)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--radius)',
      backgroundImage: 'none',
      backgroundColor: 'var(--bg-3)',
      color: 'var(--ink-soft)',
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-sm)',
      cursor: 'pointer',
    },
    '.cm-button:hover': { color: 'var(--gold-bright)', borderColor: 'var(--line-strong)' },
    '.cm-button:active': { backgroundImage: 'none', backgroundColor: 'var(--bg-2)' },
    '.cm-panel.cm-search button[name=close]': {
      top: 'var(--s-2)',
      right: 'var(--s-3)',
      padding: '0 var(--s-1)',
      color: 'var(--ink-mute)',
      fontSize: 'var(--text-lg)',
      cursor: 'pointer',
    },
    '.cm-panel.cm-search button[name=close]:hover': { color: 'var(--gold-bright)' },

    // Vorschläge für Verweise
    '.cm-tooltip': {
      border: '1px solid var(--line-strong)',
      borderRadius: 'var(--radius)',
      backgroundColor: 'var(--bg-2)',
      color: 'var(--ink)',
      boxShadow: 'var(--shadow-float)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul': {
      minWidth: '260px',
      maxWidth: '460px',
      maxHeight: '18em',
      fontFamily: 'var(--font-body)',
      fontSize: 'var(--text-md)',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
      padding: 'var(--s-1) var(--s-3)',
      lineHeight: '1.25',
      borderLeft: '2px solid transparent',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--gold-glow)',
      borderLeftColor: 'var(--gold)',
      color: 'var(--gold-bright)',
    },
    '.cm-completionLabel': { display: 'block' },
    '.cm-completionDetail': {
      display: 'block',
      margin: '0',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      fontStyle: 'normal',
      fontSize: 'var(--text-xs)',
      color: 'var(--ink-mute)',
    },
    '.wf-wiki-ed-option-new': {
      borderTop: '1px solid var(--line)',
      color: 'var(--ink-soft)',
      fontStyle: 'italic',
    },
  },
  { dark: true },
);

/** Färbung, die beide Ansichten teilen: Die Zeichen selbst treten zurück. */
const shared = [
  { tag: tags.processingInstruction, color: 'var(--ink-faint)' },
  { tag: tags.url, color: 'var(--ink-mute)' },
  { tag: tags.string, color: 'var(--ink-mute)' },
  { tag: tags.labelName, color: 'var(--ink-mute)' },
  { tag: tags.escape, color: 'var(--ink-mute)' },
  { tag: tags.contentSeparator, color: 'var(--gold-deep)' },
  { tag: tags.atom, color: 'var(--gold)' },
];

const liveHighlight = HighlightStyle.define([
  ...shared,
  { tag: tags.monospace, fontFamily: MONO, fontSize: '0.86em' },
]);

const sourceHighlight = HighlightStyle.define([
  ...shared,
  { tag: tags.heading, color: 'var(--gold-bright)', fontWeight: '700' },
  { tag: tags.quote, color: 'var(--ink-soft)' },
]);

export const liveColors: Extension = syntaxHighlighting(liveHighlight);
export const sourceColors: Extension = syntaxHighlighting(sourceHighlight);
