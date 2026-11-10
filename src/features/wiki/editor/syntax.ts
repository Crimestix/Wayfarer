/**
 * Die Textform der Artikel als Sprache für CodeMirror: gewöhnliches Markdown, erweitert um die
 * eigenen Zeichen (`[[Verweis]]`, `==markiert==`, `<u>unterstrichen</u>`) und bereinigt um alles,
 * was `../markdown.ts` nicht kennt (Unterstriche als Auszeichnung, eingerückter Code, unterstrichene
 * Überschriften). So sieht der Editor dieselben Bausteine wie die Anzeige des Artikels.
 */
import { commonmarkLanguage, markdown } from '@codemirror/lang-markdown';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';
import { Strikethrough, Table, TaskList, type MarkdownConfig } from '@lezer/markdown';

const BRACKET = 91; // [
const EQUALS = 61; // =
const LESS = 60; // <
const UNDERSCORE = 95; // _

/** `[[Titel]]`, `[[Titel|Text]]`: ein Verweis auf einen Artikel. */
const wikiLink: MarkdownConfig = {
  defineNodes: [{ name: 'WikiLink' }, { name: 'WikiLinkMark', style: tags.processingInstruction }],
  parseInline: [
    {
      name: 'WikiLink',
      parse(cx, next, pos) {
        if (next !== BRACKET || cx.char(pos + 1) !== BRACKET) return -1;
        const rest = cx.slice(pos + 2, cx.end);
        const end = rest.indexOf(']]');
        const inner = end > 0 ? rest.slice(0, end) : '';
        if (!inner.trim() || inner.includes('\n') || inner.includes('[[')) return -1;
        const close = pos + 2 + end;
        return cx.addElement(
          cx.elt('WikiLink', pos, close + 2, [
            cx.elt('WikiLinkMark', pos, pos + 2),
            cx.elt('WikiLinkMark', close, close + 2),
          ]),
        );
      },
      before: 'Link',
    },
  ],
};

const highlightDelimiter = { resolve: 'Highlight', mark: 'HighlightMark' };

/** `==markiert==`. */
const highlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight' },
    { name: 'HighlightMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === EQUALS)
          return -1;
        const spaceBefore = /\s|^$/.test(cx.slice(pos - 1, pos));
        const spaceAfter = /\s|^$/.test(cx.slice(pos + 2, pos + 3));
        return cx.addDelimiter(highlightDelimiter, pos, pos + 2, !spaceAfter, !spaceBefore);
      },
      after: 'Emphasis',
    },
  ],
};

const underlineDelimiter = { resolve: 'Underline', mark: 'UnderlineMark' };

/** `<u>unterstrichen</u>`. */
const underline: MarkdownConfig = {
  defineNodes: [
    { name: 'Underline' },
    { name: 'UnderlineMark', style: tags.processingInstruction },
  ],
  parseInline: [
    {
      name: 'Underline',
      parse(cx, next, pos) {
        if (next !== LESS) return -1;
        if (cx.slice(pos, pos + 3) === '<u>')
          return cx.addDelimiter(underlineDelimiter, pos, pos + 3, true, false);
        if (cx.slice(pos, pos + 4) === '</u>')
          return cx.addDelimiter(underlineDelimiter, pos, pos + 4, false, true);
        return -1;
      },
      before: 'HTMLTag',
    },
  ],
};

/** Unterstriche sind gewöhnlicher Text: Kursiv und fett gibt es nur mit Sternchen. */
const plainUnderscores: MarkdownConfig = {
  parseInline: [
    {
      name: 'PlainUnderscore',
      parse(cx, next, pos) {
        if (next !== UNDERSCORE) return -1;
        let end = pos + 1;
        while (cx.char(end) === UNDERSCORE) end++;
        return end;
      },
      before: 'Emphasis',
    },
  ],
};

/** Die Sprache der Artikel samt Erkennung für CodeMirror. */
export function wikiMarkdown(): Extension {
  return markdown({
    base: commonmarkLanguage,
    extensions: [
      Table,
      TaskList,
      Strikethrough,
      wikiLink,
      highlight,
      underline,
      plainUnderscores,
      { remove: ['IndentedCode', 'SetextHeading', 'LinkReference', 'HTMLBlock'] },
    ],
    addKeymap: false,
    completeHTMLTags: false,
  });
}
