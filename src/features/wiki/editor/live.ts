/**
 * Die schöne Ansicht: Der Text bleibt reines Markdown, aber seine Zeichen werden gesetzt statt
 * gezeigt – Überschriften groß, Verweise als Verweise, Kästen als Kästen. Wo gerade der Cursor
 * oder die Auswahl steht, bleiben die Zeichen sichtbar, damit man sie bearbeiten kann.
 *
 * Dieselbe Erkennung färbt auch den Quelltext (dort wird nichts ausgeblendet).
 */
import { syntaxTree } from '@codemirror/language';
import {
  type EditorState,
  type Extension,
  type Range,
  StateField,
  type Text,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import {
  calloutHeader,
  factKeyLength,
  imageLine,
  imageLines,
  quotePrefixLength,
  toggledTaskBox,
  wikiLinkParts,
  type CalloutHeader,
} from './helpers';
import { hostFacet, refreshEffect } from './host';

// ── Eingesetzte Bausteine ──────────────────────────────────────────────────

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const dot = document.createElement('span');
    dot.className = 'wf-wiki-ed-bullet';
    dot.textContent = '•';
    return dot;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('span');
    box.className = `wf-wiki-ed-check${this.checked ? ' wf-wiki-ed-check--on' : ''}`;
    box.setAttribute('role', 'checkbox');
    box.setAttribute('aria-checked', String(this.checked));
    box.setAttribute('aria-label', this.checked ? 'Erledigt' : 'Offen');
    box.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const pos = view.posAtDOM(box);
      const next = toggledTaskBox(view.state.doc.sliceString(pos, pos + 3));
      if (next)
        view.dispatch({ changes: { from: pos, to: pos + 3, insert: next }, userEvent: 'input' });
    });
    return box;
  }
  ignoreEvent(): boolean {
    return true;
  }
}

class RuleWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const rule = document.createElement('span');
    rule.className = 'wf-wiki-ed-rule';
    return rule;
  }
}

class CalloutLabelWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  eq(other: CalloutLabelWidget): boolean {
    return other.label === this.label;
  }
  toDOM(): HTMLElement {
    const label = document.createElement('span');
    label.className = 'wf-wiki-ed-box-label';
    label.textContent = this.label;
    return label;
  }
}

class ImageLabelWidget extends WidgetType {
  constructor(readonly alt: string) {
    super();
  }
  eq(other: ImageLabelWidget): boolean {
    return other.alt === this.alt;
  }
  toDOM(): HTMLElement {
    const label = document.createElement('span');
    label.className = 'wf-wiki-ed-image-label';
    const tag = document.createElement('span');
    tag.className = 'wf-wiki-ed-image-label__tag';
    tag.textContent = 'Bild';
    label.append(tag);
    if (this.alt) label.append(this.alt);
    return label;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    /** Klassen des Kastens, in dem das Bild steht (leer außerhalb). */
    readonly frame: string,
  ) {
    super();
  }
  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt && other.frame === this.frame;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('div');
    box.className = this.frame ? `wf-wiki-ed-image ${this.frame}` : 'wf-wiki-ed-image';
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.alt = this.alt;
    image.draggable = false;
    image.addEventListener('load', () => view.requestMeasure());
    image.addEventListener('error', () => {
      const note = document.createElement('span');
      note.className = 'wf-wiki-ed-image__missing';
      note.textContent = 'Bild lässt sich nicht laden';
      box.replaceChildren(note);
      view.requestMeasure();
    });
    image.src = this.src;
    box.append(image);
    return box;
  }
  get estimatedHeight(): number {
    return 180;
  }
}

// ── Auszeichnung im Text ───────────────────────────────────────────────────

const hidden = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });

const INLINE: Record<string, Decoration | undefined> = {
  StrongEmphasis: Decoration.mark({ class: 'wf-wiki-ed-strong' }),
  Emphasis: Decoration.mark({ class: 'wf-wiki-ed-em' }),
  Strikethrough: Decoration.mark({ class: 'wf-wiki-ed-strike' }),
  Highlight: Decoration.mark({ class: 'wf-wiki-ed-mark' }),
  Underline: Decoration.mark({ class: 'wf-wiki-ed-u' }),
  InlineCode: Decoration.mark({ class: 'wf-wiki-ed-code' }),
};
const INLINE_MARKS = new Set([
  'EmphasisMark',
  'StrikethroughMark',
  'HighlightMark',
  'UnderlineMark',
  'CodeMark',
]);
const href = Decoration.mark({ class: 'wf-wiki-ed-href' });
const done = Decoration.mark({ class: 'wf-wiki-ed-done' });
const boxTitle = Decoration.mark({ class: 'wf-wiki-ed-box-title' });
const fact = Decoration.mark({ class: 'wf-wiki-ed-fact' });

const gap = Decoration.mark({ class: 'wf-wiki-ed-gap' });

/**
 * Breiten in em der Textschrift: ein Leerzeichen der Einrückung, der Listenpunkt, das Kästchen
 * und der Abstand dahinter. Dieselben Werte stehen in `editor.css`.
 */
const INDENT_EM = 0.6;
const BULLET_EM = 0.7;
const CHECK_EM = 0.86;
const GAP_EM = 0.5;
/** So weit nach oben wird der Anfang eines Zitats höchstens gesucht. */
const QUOTE_SCAN = 400;

/** Die erste Zeile des Zitats oder Kastens, zu dem die Zeile mit dieser Nummer gehört. */
function quoteStart(doc: Text, number: number): number {
  let first = number;
  while (first > 1 && number - first < QUOTE_SCAN && doc.line(first - 1).text.startsWith('>'))
    first--;
  return first;
}

/** Klassen für Leiste und Farbe: gewöhnliches Zitat oder Kasten seiner Art. */
function quoteClass(header: CalloutHeader | null): string {
  return header
    ? `wf-wiki-ed-quote wf-wiki-ed-box wf-wiki-ed-box--${header.kind}`
    : 'wf-wiki-ed-quote';
}

/** Sammelt Klassen und Maße je Zeile, damit jede Zeile genau eine Auszeichnung bekommt. */
class LineMarks {
  private readonly byLine = new Map<number, { classes: Set<string>; styles: string[] }>();

  add(from: number, className: string, style?: string): void {
    let entry = this.byLine.get(from);
    if (!entry) this.byLine.set(from, (entry = { classes: new Set(), styles: [] }));
    for (const part of className.split(' ')) entry.classes.add(part);
    if (style && !entry.styles.includes(style)) entry.styles.push(style);
  }

  ranges(): Range<Decoration>[] {
    return [...this.byLine].map(([from, entry]) =>
      Decoration.line({
        attributes: {
          class: [...entry.classes].join(' '),
          ...(entry.styles.length ? { style: entry.styles.join(';') } : {}),
        },
      }).range(from),
    );
  }
}

function buildDecorations(view: EditorView, live: boolean): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const host = state.facet(hostFacet);
  const tree = syntaxTree(state);
  const selection = state.selection.ranges;
  const touches = (from: number, to: number) =>
    selection.some((range) => range.from <= to && range.to >= from);
  const out: Range<Decoration>[] = [];
  const lines = new LineMarks();
  const knownLinks = new Map<string, boolean>();
  const isKnown = (target: string): boolean => {
    let known = knownLinks.get(target);
    if (known === undefined) knownLinks.set(target, (known = host.isKnownLink(target)));
    return known;
  };

  const hideMarks = (node: SyntaxNode) => {
    for (let child = node.firstChild; child; child = child.nextSibling)
      if (INLINE_MARKS.has(child.name) && child.to > child.from)
        out.push(hidden.range(child.from, child.to));
  };

  const decorateListMark = (mark: SyntaxNode) => {
    const item = mark.parent;
    const list = item?.parent;
    if (!item || !list) return;
    const line = doc.lineAt(mark.from);
    const indentFrom = line.from + quotePrefixLength(line.text);
    const lead = mark.from >= indentFrom ? doc.sliceString(indentFrom, mark.from) : 'x';
    let after = mark.to;
    while (
      after < line.to &&
      after - mark.to < 4 &&
      /[ \t]/.test(doc.sliceString(after, after + 1))
    )
      after++;
    const task = item.getChild('Task');
    const box = task?.getChild('TaskMarker') ?? null;
    // Zeichen und Abstand dahinter haben feste Breiten, damit umbrochene Zeilen bündig stehen.
    let width: number;
    let gapFrom = mark.to;
    let gapTo = after;
    const sized = (className: string) =>
      Decoration.mark({ class: className, attributes: { style: `min-width:${width}em` } });
    if (task && box && box.from === after) {
      width = CHECK_EM;
      gapFrom = box.to;
      gapTo = box.to < line.to && doc.sliceString(box.to, box.to + 1) === ' ' ? box.to + 1 : box.to;
      const checked = doc.sliceString(box.from + 1, box.from + 2) !== ' ';
      if (!touches(mark.from, box.to)) {
        out.push(hidden.range(mark.from, box.from));
        out.push(
          Decoration.replace({ widget: new CheckboxWidget(checked) }).range(box.from, box.to),
        );
      }
      if (checked && task.to > gapTo) out.push(done.range(gapTo, task.to));
    } else if (list.name === 'OrderedList') {
      width = (mark.to - mark.from) * 0.5 + 0.1;
      out.push(sized('wf-wiki-ed-marker wf-wiki-ed-marker--number').range(mark.from, mark.to));
    } else {
      width = BULLET_EM;
      if (!touches(mark.from, mark.to)) out.push(bullet.range(mark.from, mark.to));
      else out.push(sized('wf-wiki-ed-marker').range(mark.from, mark.to));
    }
    // Ein zweites Listenzeichen in derselben Zeile bekommt nur seinen Punkt.
    if (lead.trim() !== '') return;
    if (lead.length > 0)
      out.push(
        Decoration.mark({
          class: 'wf-wiki-ed-indent',
          attributes: { style: `width:${(lead.length * INDENT_EM).toFixed(2)}em` },
        }).range(indentFrom, mark.from),
      );
    if (gapTo > gapFrom) out.push(gap.range(gapFrom, gapTo));
    lines.add(
      line.from,
      'wf-wiki-ed-li',
      `--wf-wiki-ed-hang:${(lead.length * INDENT_EM + width + GAP_EM).toFixed(2)}em`,
    );
  };

  /** Steht diese Stelle in einem Codeblock, der nicht selbst in einem Zitat liegt? */
  const inPlainCode = (pos: number): boolean => {
    for (let node: SyntaxNode | null = tree.resolveInner(pos, 1); node; node = node.parent)
      if (node.name === 'FencedCode') return !doc.lineAt(node.from).text.startsWith('>');
    return false;
  };

  /** Zitate und Kästen: Leiste, Farbe nach Art, Etikett statt `[!art]`. */
  const decorateQuotes = (from: number, to: number) => {
    let lastNumber = -1;
    let firstNumber = -1;
    let header: CalloutHeader | null = null;
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      if (!line.text.startsWith('>') || inPlainCode(line.from)) continue;
      if (lastNumber !== line.number - 1) {
        firstNumber = quoteStart(doc, line.number);
        header = calloutHeader(doc.line(firstNumber).text);
      }
      lastNumber = line.number;
      const isFirst = line.number === firstNumber;
      const isLast = line.number === doc.lines || !doc.line(line.number + 1).text.startsWith('>');
      lines.add(
        line.from,
        [
          quoteClass(header),
          isFirst ? 'wf-wiki-ed-quote--first' : '',
          isLast ? 'wf-wiki-ed-quote--last' : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
      const active = touches(line.from, line.to);
      if (header && isFirst) {
        const titleFrom = line.from + header.markerLength;
        if (!active)
          out.push(
            Decoration.replace({ widget: new CalloutLabelWidget(header.label) }).range(
              line.from,
              titleFrom,
            ),
          );
        if (line.to > titleFrom) out.push(boxTitle.range(titleFrom, line.to));
        continue;
      }
      const mark = /^>[ \t]?/.exec(line.text)![0].length;
      if (!active) out.push(hidden.range(line.from, line.from + mark));
      if (header?.kind === 'steckbrief') {
        const contentFrom = line.from + quotePrefixLength(line.text);
        const key = factKeyLength(doc.sliceString(contentFrom, line.to));
        if (key > 0) out.push(fact.range(contentFrom, contentFrom + key));
      }
    }
  };

  for (const visible of view.visibleRanges) {
    let tableEnd = -1;
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter: (ref) => {
        const { name, from, to } = ref;
        const inTable = from < tableEnd;
        /** Nichts ausblenden: im Quelltext und in Tabellen. */
        const plain = !live || inTable;
        const inline = INLINE[name];
        if (inline) {
          if (to > from) out.push(inline.range(from, to));
          if (!plain && !touches(from, to)) hideMarks(ref.node);
          return undefined;
        }
        switch (name) {
          case 'Table': {
            tableEnd = to;
            if (!live) break;
            const last = doc.lineAt(Math.min(to, visible.to)).number;
            for (let n = doc.lineAt(Math.max(from, visible.from)).number; n <= last; n++)
              lines.add(doc.line(n).from, 'wf-wiki-ed-table');
            break;
          }
          case 'FencedCode': {
            if (!live) return false;
            const first = doc.lineAt(from).number;
            const last = doc.lineAt(to).number;
            const stop = Math.min(last, doc.lineAt(visible.to).number);
            for (let n = Math.max(first, doc.lineAt(visible.from).number); n <= stop; n++)
              lines.add(
                doc.line(n).from,
                `wf-wiki-ed-codeblock${n === first ? ' wf-wiki-ed-codeblock--first' : ''}${
                  n === last ? ' wf-wiki-ed-codeblock--last' : ''
                }`,
              );
            return false;
          }
          case 'ATXHeading1':
          case 'ATXHeading2':
          case 'ATXHeading3':
          case 'ATXHeading4':
          case 'ATXHeading5':
          case 'ATXHeading6':
            if (!plain)
              lines.add(doc.lineAt(from).from, `wf-wiki-ed-h wf-wiki-ed-h${name.slice(-1)}`);
            break;
          case 'HeaderMark': {
            if (plain) break;
            const line = doc.lineAt(from);
            if (touches(line.from, line.to)) break;
            let end = to;
            while (end < line.to && /[ \t]/.test(doc.sliceString(end, end + 1))) end++;
            out.push(hidden.range(from, end));
            break;
          }
          case 'WikiLink': {
            const parts = wikiLinkParts(doc.sliceString(from + 2, to - 2));
            out.push(
              Decoration.mark({
                class: isKnown(parts.target)
                  ? 'wf-wiki-ed-link'
                  : 'wf-wiki-ed-link wf-wiki-ed-link--unknown',
                attributes: { 'data-target': parts.target },
              }).range(from, to),
            );
            if (!plain && !touches(from, to) && parts.showTo > parts.showFrom) {
              out.push(hidden.range(from, from + 2 + parts.showFrom));
              out.push(hidden.range(from + 2 + parts.showTo, to));
            }
            return false;
          }
          case 'Link': {
            const marks = ref.node.getChildren('LinkMark');
            // Nur `[Text](Adresse)` ist ein Link; eckige Klammern allein bleiben Text.
            if (marks.length < 4 || !ref.node.getChild('URL')) break;
            const textFrom = marks[0]!.to;
            const textTo = marks[1]!.from;
            if (textTo <= textFrom) break;
            out.push(href.range(textFrom, textTo));
            if (!plain && !touches(from, to)) {
              out.push(hidden.range(from, textFrom));
              out.push(hidden.range(textTo, to));
            }
            break;
          }
          case 'Image': {
            const line = doc.lineAt(from);
            const image = imageLine(line.text);
            // Ein Bild mitten im Text kennt die Textform nicht: Es bleibt, wie es getippt ist.
            if (!image || plain) return false;
            lines.add(line.from, 'wf-wiki-ed-imageline');
            if (!touches(line.from, line.to))
              out.push(
                Decoration.replace({ widget: new ImageLabelWidget(image.alt) }).range(from, to),
              );
            return false;
          }
          case 'ListMark':
            if (!plain) decorateListMark(ref.node);
            break;
          case 'HorizontalRule': {
            if (plain || to <= from) break;
            const line = doc.lineAt(from);
            if (!touches(line.from, line.to)) out.push(rule.range(from, to));
            break;
          }
        }
        return undefined;
      },
    });
    if (live) decorateQuotes(visible.from, visible.to);
  }
  out.push(...lines.ranges());
  return Decoration.set(out, true);
}

function decorations(live: boolean): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, live);
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.viewportChanged ||
          (live && update.selectionSet) ||
          syntaxTree(update.startState) !== syntaxTree(update.state) ||
          update.transactions.some((tr) => tr.effects.some((effect) => effect.is(refreshEffect)))
        )
          this.decorations = buildDecorations(update.view, live);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

// ── Bilder unter ihrer Zeile ───────────────────────────────────────────────

function buildImages(state: EditorState): DecorationSet {
  const host = state.facet(hostFacet);
  return Decoration.set(
    imageLines(state.doc.iterLines()).map((image) => {
      const line = state.doc.line(image.index + 1);
      // Ein Bild im Kasten trägt dessen Leiste und Farbe weiter.
      const frame = line.text.startsWith('>')
        ? quoteClass(calloutHeader(state.doc.line(quoteStart(state.doc, line.number)).text))
        : '';
      return Decoration.widget({
        widget: new ImageWidget(host.imageSrc(image.url), image.alt, frame),
        block: true,
        side: 1,
      }).range(line.to);
    }),
  );
}

const images = StateField.define<DecorationSet>({
  create: buildImages,
  update(value, tr) {
    return tr.docChanged || tr.effects.some((effect) => effect.is(refreshEffect))
      ? buildImages(tr.state)
      : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ── Verweise öffnen ────────────────────────────────────────────────────────

/**
 * Strg/Cmd+Klick öffnet einen Verweis. In der schönen Ansicht genügt ein gewöhnlicher Klick,
 * solange der Cursor nicht in derselben Zeile steht – dort setzt der Klick den Cursor.
 */
function linkClicks(live: boolean): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || !(event.target instanceof Element)) return false;
      const link = event.target.closest('.wf-wiki-ed-link');
      const target = link?.getAttribute('data-target');
      if (!link || !target) return false;
      if (!(event.ctrlKey || event.metaKey)) {
        if (!live) return false;
        const line = view.state.doc.lineAt(view.posAtDOM(link));
        const head = view.state.selection.main.head;
        if (view.hasFocus && head >= line.from && head <= line.to) return false;
      }
      if (!view.state.facet(hostFacet).openLink(target)) return false;
      event.preventDefault();
      return true;
    },
  });
}

/** Alles, was die schöne Ansicht ausmacht. */
export function liveView(): Extension {
  return [decorations(true), images, linkClicks(true)];
}

/** Der Quelltext: nur Färbung, nichts ausgeblendet. */
export function sourceView(): Extension {
  return [decorations(false), linkClicks(false)];
}
