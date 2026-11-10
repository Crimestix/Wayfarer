/**
 * Artikel als Text. Wayfarers Wiki speichert jede Seite als Markdown, wie man es aus Obsidian
 * kennt, mit wenigen eigenen Zeichen:
 *
 *   [[Titel]]  [[Titel|anderer Text]]     Verweis auf einen Artikel
 *   > [!geheim]                           Abschnitt nur für die Spielleitung
 *   > [!steckbrief]                       Kasten neben dem Text: Bild, „Feld: Wert“, Kurztexte
 *   > [!info]  [!warnung]  …              Hinweiskasten
 *   ==markiert==                          hervorgehobener Text
 *
 * Ein Zeilenumbruch im Absatz ist ein Zeilenumbruch in der Anzeige – was man tippt, sieht man.
 *
 * Zwei Richtungen, beide reine Funktionen: `parseMarkdown` macht aus Text die Knoten der Anzeige
 * (`ArticleNode`), `toMarkdown` aus Knoten wieder Text. Die zweite braucht es für die Übernahme
 * aus LegendKeeper und überall, wo Wayfarer Text für den Spielleiter schreibt.
 */
import {
  safeHref,
  safeImageUrl,
  type ArticleNode,
  type CalloutTone,
  type FactRow,
  type Inline,
  type TableCell,
} from '../legendkeeper/model';

type TextInline = Extract<Inline, { type: 'text' }>;
type Mark = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'sub' | 'sup' | 'highlight';

// ── Verweise ───────────────────────────────────────────────────────────────

export interface LinkTarget {
  id: string;
  title: string;
}

export interface MarkdownContext {
  /** Findet den Artikel zu dem, was zwischen den Klammern steht; null, wenn es ihn nicht gibt. */
  resolve: (target: string) => LinkTarget | null;
  /** Zähler für die Sprungmarken der Überschriften. */
  headings: number;
}

export const plainContext = (): MarkdownContext => ({ resolve: () => null, headings: 0 });

/** Trennt bei einem Verweis das Ziel von einer angehängten Kennung („Titel~kennung“). */
export function splitTarget(target: string): { title: string; id: string | null } {
  const at = target.lastIndexOf('~');
  if (at > 0 && /^[A-Za-z0-9_-]{1,64}$/.test(target.slice(at + 1)))
    return { title: target.slice(0, at).trim(), id: target.slice(at + 1) };
  return { title: target.trim(), id: null };
}

const LINK_UNSAFE = /[[\]|\n]/g;
const linkSafe = (text: string) => text.replace(LINK_UNSAFE, ' ').replace(/\s+/g, ' ').trim();

/**
 * Schreibt einen Verweis. `target` ist der Titel des Artikels (mit Kennung, wenn der Titel
 * mehrfach vorkommt); weicht der gezeigte Text davon ab, steht er hinter dem Strich.
 */
export function wikiLink(target: string, label = ''): string {
  const to = linkSafe(target);
  const shown = linkSafe(label);
  const title = splitTarget(to).title;
  return shown && shown !== title ? `[[${to}|${shown}]]` : `[[${to}]]`;
}

// ── Text → Knoten: Fließtext ───────────────────────────────────────────────

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const TAGS: [open: string, close: string, mark: Mark][] = [
  ['<u>', '</u>', 'underline'],
  ['<sub>', '</sub>', 'sub'],
  ['<sup>', '</sup>', 'sup'],
];

interface Piece {
  /** Leerer Text mit `mention` oder `break` steht für diese; sonst ein Textstück. */
  text: string;
  marks: Mark[];
  href?: string;
  mention?: { resourceId: string; label: string; wanted?: string };
  break?: true;
}

function toInlines(pieces: Piece[]): Inline[] {
  const out: Inline[] = [];
  for (const piece of pieces) {
    if (piece.break) {
      out.push({ type: 'break' });
      continue;
    }
    if (piece.mention) {
      out.push({ type: 'mention', ...piece.mention });
      continue;
    }
    if (!piece.text) continue;
    const next: TextInline = { type: 'text', text: piece.text };
    for (const mark of piece.marks) next[mark] = true;
    if (piece.href) next.href = piece.href;
    const last = out[out.length - 1];
    // Nachbarn mit gleicher Auszeichnung gehören zusammen.
    if (last?.type === 'text' && sameMarks(last, next)) last.text += next.text;
    else out.push(next);
  }
  return out;
}

const MARKS: Mark[] = ['bold', 'italic', 'underline', 'strike', 'code', 'sub', 'sup', 'highlight'];
const sameMarks = (a: TextInline, b: TextInline) =>
  MARKS.every((mark) => !!a[mark] === !!b[mark]) && a.href === b.href;

/** Liest den Fließtext eines Absatzes: Auszeichnung, Verweise, Links, Zeilenumbrüche. */
export function parseInline(source: string, ctx: MarkdownContext, href?: string): Inline[] {
  const pieces: Piece[] = [];
  /** Offene Auszeichnungen in der Reihenfolge, in der sie geöffnet wurden. */
  const open: { mark: Mark; at: number; literal: string }[] = [];
  let buffer = '';
  const active = () => open.map((entry) => entry.mark);
  const flush = () => {
    if (buffer) pieces.push({ text: buffer, marks: active(), href });
    buffer = '';
  };
  const openMark = (mark: Mark, literal: string) => {
    flush();
    open.push({ mark, at: pieces.length, literal });
  };
  const closeMark = (mark: Mark): boolean => {
    const index = open.map((entry) => entry.mark).lastIndexOf(mark);
    if (index < 0) return false;
    flush();
    // Was darüber noch offen war, wurde nie geschlossen: Seine Zeichen sind gewöhnlicher Text.
    for (const stale of open.splice(index + 1).reverse()) demote(stale);
    open.pop();
    return true;
  };
  /** Macht eine nie geschlossene Auszeichnung zu dem Text, als der sie getippt wurde. */
  const demote = (entry: { mark: Mark; at: number; literal: string }) => {
    for (let i = entry.at; i < pieces.length; i++)
      pieces[i] = { ...pieces[i]!, marks: pieces[i]!.marks.filter((m) => m !== entry.mark) };
    const before = pieces[entry.at]?.marks ?? active().filter((m) => m !== entry.mark);
    pieces.splice(entry.at, 0, {
      text: entry.literal,
      marks: before.filter((m) => m !== entry.mark),
      href,
    });
    for (const other of open) if (other.at >= entry.at && other !== entry) other.at++;
  };
  const isOpen = (mark: Mark) => open.some((entry) => entry.mark === mark);
  const top = () => open[open.length - 1]?.mark;

  let i = 0;
  while (i < source.length) {
    const char = source[i]!;
    const rest = source.slice(i);
    if (char === '\\' && i + 1 < source.length && PUNCTUATION.test(source[i + 1]!)) {
      buffer += source[i + 1];
      i += 2;
      continue;
    }
    if (char === '\n') {
      // Leerzeichen am Zeilenende tragen nichts bei.
      buffer = buffer.replace(/[ \t]+$/, '');
      flush();
      pieces.push({ text: '', marks: [], break: true });
      i++;
      while (source[i] === ' ' || source[i] === '\t') i++;
      continue;
    }
    const br = /^<br\s*\/?>/i.exec(rest);
    if (br) {
      flush();
      pieces.push({ text: '', marks: [], break: true });
      i += br[0].length;
      continue;
    }
    if (char === '`') {
      const fence = /^`+/.exec(rest)![0];
      const end = source.indexOf(fence, i + fence.length);
      if (end > 0) {
        flush();
        pieces.push({
          text: source.slice(i + fence.length, end).replace(/^ (.*) $/, '$1'),
          marks: [...active(), 'code'],
          href,
        });
        i = end + fence.length;
        continue;
      }
    }
    if (rest.startsWith('[[')) {
      const end = source.indexOf(']]', i + 2);
      const inner = end > 0 ? source.slice(i + 2, end) : '';
      if (end > 0 && inner.trim() && !inner.includes('\n') && !inner.includes('[[')) {
        const bar = inner.indexOf('|');
        const target = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
        const found = ctx.resolve(target);
        const label = (bar >= 0 ? inner.slice(bar + 1) : '').trim() || splitTarget(target).title;
        flush();
        pieces.push({
          text: '',
          marks: [],
          mention: found
            ? { resourceId: found.id, label }
            : { resourceId: '', label, wanted: splitTarget(target).title },
        });
        i = end + 2;
        continue;
      }
    }
    if (char === '[' && !href) {
      const link = /^\[((?:\\.|[^\]\\\n])*)\]\(([^)\s]+)\)/.exec(rest);
      const url = link ? safeHref(link[2]) : undefined;
      if (link && url) {
        flush();
        for (const inline of parseInline(link[1]!, ctx, url)) {
          if (inline.type === 'text') {
            const marks = MARKS.filter((mark) => inline[mark]);
            pieces.push({ text: inline.text, marks: [...active(), ...marks], href: url });
          } else if (inline.type === 'mention')
            pieces.push({ text: '', marks: [], mention: inline });
        }
        i += link[0].length;
        continue;
      }
    }
    if (char === '*') {
      let run = /^\*+/.exec(rest)![0].length;
      const start = i;
      i += run;
      const before = source[start - 1];
      const after = source[i];
      const canClose = before !== undefined && !/\s/.test(before);
      const canOpen = after !== undefined && !/\s/.test(after);
      while (run > 0) {
        if (canClose && top() === 'italic') {
          closeMark('italic');
          run -= 1;
        } else if (canClose && run >= 2 && top() === 'bold') {
          closeMark('bold');
          run -= 2;
        } else if (canClose && run >= 2 && isOpen('bold') && !canOpen) {
          closeMark('bold');
          run -= 2;
        } else if (canClose && isOpen('italic') && !canOpen) {
          closeMark('italic');
          run -= 1;
        } else if (canOpen && run >= 2 && !isOpen('bold')) {
          openMark('bold', '**');
          run -= 2;
        } else if (canOpen && !isOpen('italic')) {
          openMark('italic', '*');
          run -= 1;
        } else {
          buffer += '*'.repeat(run);
          run = 0;
        }
      }
      continue;
    }
    if (rest.startsWith('~~') || rest.startsWith('==')) {
      const mark: Mark = char === '~' ? 'strike' : 'highlight';
      const literal = rest.slice(0, 2);
      if (isOpen(mark)) closeMark(mark);
      else if (source[i + 2] !== undefined && !/\s/.test(source[i + 2]!)) openMark(mark, literal);
      else buffer += literal;
      i += 2;
      continue;
    }
    if (char === '<') {
      const tag = TAGS.find(([o, c]) => rest.startsWith(o) || rest.startsWith(c));
      if (tag) {
        const closing = rest.startsWith(tag[1]);
        const literal = closing ? tag[1] : tag[0];
        if (closing ? closeMark(tag[2]) : (openMark(tag[2], literal), true)) {
          i += literal.length;
          continue;
        }
      }
    }
    buffer += char;
    i++;
  }
  flush();
  for (const stale of [...open].reverse()) demote(stale);
  return toInlines(pieces);
}

const hasContent = (inlines: Inline[]) =>
  inlines.some((i) => i.type === 'mention' || (i.type === 'text' && i.text.trim() !== ''));

// ── Text → Knoten: Blöcke ──────────────────────────────────────────────────

const FENCE = /^(`{3,})(.*)$/;
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST = /^( {0,3})([-+*]|\d{1,9}[.)])[ \t]+(.*)$/;
const LIST_EMPTY = /^( {0,3})([-+*]|\d{1,9}[.)])[ \t]*$/;
const IMAGE = /^!\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)(?:[ \t]+"([^"]*)")?\)[ \t]*$/;
const CALLOUT = /^\[!([A-Za-zÄÖÜäöüß-]+)\][+-]?[ \t]*(.*)$/;
const TABLE_RULE = /^\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const FACT = /^((?:\\.|[^:\\\n[\]*`]){1,60}):[ \t]+(\S.*)$/;
const METER = /^(.+?):[ \t]*(\d+)[ \t]*\/[ \t]*(\d+)[ \t]*$/;

const CALLOUT_TONE: Record<string, CalloutTone> = {
  info: 'info',
  hinweis: 'info',
  note: 'note',
  notiz: 'note',
  tip: 'success',
  tipp: 'success',
  success: 'success',
  erfolg: 'success',
  warning: 'warning',
  warnung: 'warning',
  achtung: 'warning',
  danger: 'error',
  error: 'error',
  gefahr: 'error',
  fehler: 'error',
};
const SECRET_NAMES = new Set(['geheim', 'secret', 'sl', 'spielleitung']);
const INFOBOX_NAMES = new Set(['steckbrief', 'infobox']);
const EXPAND_NAMES = new Set(['aufklappen', 'details', 'spoiler']);
const METER_NAMES = new Set(['stand', 'zähler', 'meter']);

const unescape = (text: string) => text.replace(/\\([!-/:-@[-`{-~])/g, '$1');

/** Beginnt mit dieser Zeile ein anderer Block als ein Absatz? */
function startsBlock(line: string, next: string | undefined): boolean {
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    line.startsWith('>') ||
    LIST.test(line) ||
    (line.trimStart().startsWith('|') && next !== undefined && TABLE_RULE.test(next))
  );
}

function tableCells(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  const body = line.trim().replace(/^\|/, '');
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      current += '|';
      i++;
    } else if (body[i] === '|') {
      cells.push(current.trim());
      current = '';
    } else current += body[i];
  }
  if (current.trim()) cells.push(current.trim());
  return cells;
}

/** Deutet den Inhalt eines Steckbriefs: Bilder, betitelte Felder „Name: Wert“, Kurztexte. */
function infoboxChildren(nodes: ArticleNode[]): ArticleNode[] {
  const out: ArticleNode[] = [];
  let title: string | undefined;
  let prose: ArticleNode[] = [];
  const endProse = () => {
    if (prose.length || title !== undefined) {
      if (prose.length) out.push({ type: 'group', title, children: prose });
      // Eine Überschrift ohne Inhalt bleibt als Zeile stehen, statt zu verschwinden.
      else out.push({ type: 'group', title, children: [] });
    }
    prose = [];
    title = undefined;
  };
  for (const node of nodes) {
    if (node.type === 'image') {
      endProse();
      out.push(node);
      continue;
    }
    if (node.type !== 'paragraph') {
      prose.push(node);
      continue;
    }
    // Ein Absatz nur aus Fettdruck ist die Überschrift für das, was folgt.
    const texts = node.inlines.filter((i) => i.type !== 'break');
    if (
      texts.length > 0 &&
      texts.every((i) => i.type === 'text' && i.bold && !i.italic && !i.href) &&
      !node.inlines.some((i) => i.type === 'break')
    ) {
      endProse();
      title = texts.map((i) => (i.type === 'text' ? i.text : '')).join('');
      continue;
    }
    // Zeilen der Form „Name: Wert“ sind Felder.
    const lines: Inline[][] = [[]];
    for (const inline of node.inlines) {
      if (inline.type === 'break') lines.push([]);
      else lines[lines.length - 1]!.push(inline);
    }
    const rows: FactRow[] = [];
    let allFacts = true;
    for (const line of lines) {
      const first = line[0];
      const match =
        first?.type === 'text' && MARKS.every((m) => !first[m]) && !first.href
          ? /^([^:\n]{1,60}):(?:[ \t]+|$)([\s\S]*)$/.exec(first.text)
          : null;
      const value: Inline[] = match
        ? [...(match[2] ? [{ ...first, text: match[2] } as Inline] : []), ...line.slice(1)]
        : [];
      if (!match || !hasContent(value)) {
        allFacts = false;
        break;
      }
      rows.push({ key: match[1]!.trim(), value });
    }
    if (allFacts && rows.length) {
      if (prose.length) endProse();
      out.push({ type: 'facts', title, rows });
      title = undefined;
    } else prose.push(node);
  }
  endProse();
  return out.filter((node) => node.type !== 'group' || node.children.length > 0 || node.title);
}

function calloutNode(
  kind: string,
  title: string,
  inner: string[],
  ctx: MarkdownContext,
): ArticleNode {
  const name = kind.toLowerCase();
  if (METER_NAMES.has(name)) {
    const items = inner
      .map((line) => METER.exec(unescape(line.trim())))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ name: m[1]!.trim(), current: Number(m[2]), max: Number(m[3]) }));
    return { type: 'meters', title: title || undefined, items };
  }
  const children = parseBlocks(inner, ctx);
  if (SECRET_NAMES.has(name)) return { type: 'secret', children };
  if (INFOBOX_NAMES.has(name))
    return { type: 'infobox', beside: true, children: infoboxChildren(children) };
  if (EXPAND_NAMES.has(name)) return { type: 'expand', title: unescape(title), children };
  const withTitle: ArticleNode[] = title
    ? [
        { type: 'paragraph', inlines: [{ type: 'text', text: unescape(title), bold: true }] },
        ...children,
      ]
    : children;
  return { type: 'callout', tone: CALLOUT_TONE[name] ?? 'info', children: withTitle };
}

/** Liest Zeilen als Blöcke: Absätze, Überschriften, Listen, Zitate, Kästen, Tabellen, Bilder. */
export function parseBlocks(lines: string[], ctx: MarkdownContext): ArticleNode[] {
  const out: ArticleNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith(fence[1]!)) body.push(lines[i++]!);
      i++;
      out.push({ type: 'code', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const inlines = parseInline(heading[2]!, ctx);
      if (hasContent(inlines))
        out.push({
          type: 'heading',
          level: heading[1]!.length,
          inlines,
          anchor: `abschnitt-${++ctx.headings}`,
        });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ type: 'rule' });
      i++;
      continue;
    }
    if (line.startsWith('>')) {
      const inner: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>'))
        inner.push(lines[i++]!.replace(/^> ?/, ''));
      const callout = CALLOUT.exec(inner[0] ?? '');
      if (callout) out.push(calloutNode(callout[1]!, callout[2]!.trim(), inner.slice(1), ctx));
      else {
        const children = parseBlocks(inner, ctx);
        if (children.length) out.push({ type: 'quote', children });
      }
      continue;
    }
    if (line.trimStart().startsWith('|') && TABLE_RULE.test(lines[i + 1] ?? '')) {
      const header = tableCells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && lines[i]!.trimStart().startsWith('|'))
        body.push(tableCells(lines[i++]!));
      const width = Math.max(header.length, ...body.map((row) => row.length));
      const row = (cells: string[], isHeader: boolean): TableCell[] =>
        Array.from({ length: width }, (_, col) => {
          const inlines = parseInline(cells[col] ?? '', ctx);
          return {
            header: isHeader,
            colSpan: 1,
            rowSpan: 1,
            children: hasContent(inlines) ? [{ type: 'paragraph', inlines }] : [],
          };
        });
      // Eine leere Kopfzeile heißt: Die Tabelle hat keine Überschriften.
      const rows = [
        ...(header.some((cell) => cell !== '') ? [row(header, true)] : []),
        ...body.map((cells) => row(cells, false)),
      ];
      if (rows.length) out.push({ type: 'table', rows });
      continue;
    }
    const image = IMAGE.exec(line);
    const imageUrl = image ? safeImageUrl(image[2]) : undefined;
    if (image && imageUrl) {
      const alt = unescape(image[1]!);
      const caption = image[3] ?? alt;
      out.push({ type: 'image', url: imageUrl, alt, ...(caption ? { caption } : {}) });
      i++;
      continue;
    }
    const first = LIST.exec(line) ?? LIST_EMPTY.exec(line);
    if (first) {
      const indent = first[1]!.length;
      const ordered = /\d/.test(first[2]!);
      const start = ordered ? Number.parseInt(first[2]!, 10) : 1;
      const items: string[][] = [];
      while (i < lines.length) {
        const marker = LIST.exec(lines[i]!) ?? LIST_EMPTY.exec(lines[i]!);
        if (!marker || marker[1]!.length !== indent || /\d/.test(marker[2]!) !== ordered) break;
        const content = indent + marker[2]!.length + 1;
        const item = [marker[3] ?? ''];
        i++;
        while (i < lines.length) {
          const current = lines[i]!;
          const lead = current.length - current.trimStart().length;
          if (!current.trim()) {
            // Eine Leerzeile gehört nur dazu, wenn danach eingerückter Text folgt.
            let ahead = i + 1;
            while (ahead < lines.length && !lines[ahead]!.trim()) ahead++;
            const after = lines[ahead];
            if (after === undefined || after.length - after.trimStart().length < indent + 2) break;
            item.push('');
            i++;
            continue;
          }
          if (lead < indent + 2) break;
          item.push(current.slice(Math.min(lead, content)));
          i++;
        }
        items.push(item);
      }
      const tasks = items.map((item) => /^\[([ xX])\][ \t]+(.*)$/.exec(item[0] ?? ''));
      if (!ordered && tasks.every((task, n) => task !== null && items[n]!.length === 1)) {
        out.push({
          type: 'tasks',
          items: tasks.map((task) => ({
            checked: task![1] !== ' ',
            inlines: parseInline(task![2]!, ctx),
          })),
        });
      } else {
        const parsed = items.map((item) => parseBlocks(item, ctx)).filter((item) => item.length);
        if (parsed.length) out.push({ type: 'list', ordered, start, items: parsed });
      }
      continue;
    }
    // Ein Absatz: alle Zeilen bis zur Leerzeile oder bis ein anderer Block beginnt.
    const paragraph = [line.trimStart()];
    i++;
    while (i < lines.length && lines[i]!.trim() && !startsBlock(lines[i]!, lines[i + 1]))
      paragraph.push(lines[i++]!.trimStart());
    const inlines = parseInline(paragraph.join('\n'), ctx);
    if (hasContent(inlines)) out.push({ type: 'paragraph', inlines });
  }
  return out;
}

/** Macht aus dem Text einer Seite die Knoten der Anzeige. */
export function parseMarkdown(text: string, ctx: MarkdownContext = plainContext()): ArticleNode[] {
  return parseBlocks(text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'), ctx);
}

// ── Knoten → Text ──────────────────────────────────────────────────────────

export interface WriteContext {
  /** Titel des Artikels zu einer Kennung und ob er eindeutig ist; null, wenn es ihn nicht gibt. */
  targetOf: (resourceId: string) => { title: string; unique: boolean } | null;
  /** Was sich nicht als Text ausdrücken ließ und weggelassen wurde. */
  dropped: number;
}

export const plainWriter = (): WriteContext => ({ targetOf: () => null, dropped: 0 });

/** Zeichen, die im Fließtext sonst als Auszeichnung gelesen würden. */
function escapeText(text: string): string {
  return text
    .replace(/\\(?=[!-/:-@[-`{-~])/g, '\\\\')
    .replace(/[*`]/g, '\\$&')
    .replace(/\[(?=\[)/g, '\\[')
    .replace(/\[(?=[^\]\n]*\]\()/g, '\\[')
    .replace(/<(?=\/?(u|sub|sup)>|br\s*\/?>)/gi, '\\<')
    .replace(/~(?=~)/g, '\\~')
    .replace(/=(?==)/g, '\\=');
}

/** Am Zeilenanfang hätten diese Zeichen eine eigene Bedeutung. */
function escapeLineStart(line: string): string {
  if (/^(#{1,6}[ \t]|>|[-+][ \t]|\||`{3,})/.test(line)) return `\\${line}`;
  if (/^\d{1,9}[.)][ \t]/.test(line)) return line.replace(/^(\d+)([.)])/, '$1\\$2');
  if (RULE.test(line) || /^!\[/.test(line)) return `\\${line}`;
  return line;
}

const WRAP: Partial<Record<Mark, [string, string]>> = {
  highlight: ['==', '=='],
  bold: ['**', '**'],
  italic: ['*', '*'],
  strike: ['~~', '~~'],
  underline: ['<u>', '</u>'],
  sub: ['<sub>', '</sub>'],
  sup: ['<sup>', '</sup>'],
};
/** Reihenfolge, in der Auszeichnungen geöffnet werden – außen zuerst. */
const NESTING: Mark[] = ['highlight', 'bold', 'italic', 'strike', 'underline', 'sub', 'sup'];

function mentionText(inline: Extract<Inline, { type: 'mention' }>, ctx: WriteContext): string {
  const target = inline.resourceId ? ctx.targetOf(inline.resourceId) : null;
  if (!target) return inline.label ? wikiLink(inline.label) : '';
  return wikiLink(
    target.unique ? target.title : `${target.title}~${inline.resourceId}`,
    inline.label,
  );
}

/** Schreibt Fließtext. `breakAs` ist das Zeichen für einen Zeilenumbruch im Absatz. */
export function inlineMarkdown(inlines: Inline[], ctx: WriteContext, breakAs = '\n'): string {
  let out = '';
  /** Offene Auszeichnungen, außen zuerst. */
  let open: Mark[] = [];
  let link: string | undefined;
  const close = (keep: Mark[]) => {
    // Schließen von innen nach außen, bis nur noch übrig ist, was offen bleiben soll.
    let last = open.length;
    while (
      last > 0 &&
      !(open.slice(0, last).every((m) => keep.includes(m)) && sameOrder(open.slice(0, last), keep))
    )
      last--;
    for (const mark of open.slice(last).reverse()) out += WRAP[mark]![1];
    open = open.slice(0, last);
  };
  const sameOrder = (current: Mark[], wanted: Mark[]) =>
    current.every((mark, index) => wanted[index] === mark);
  const endLink = () => {
    if (link === undefined) return;
    close([]);
    out += `](${link})`;
    link = undefined;
  };

  for (const inline of inlines) {
    if (inline.type === 'break') {
      close([]);
      endLink();
      out = out.replace(/[ \t]+$/, '') + breakAs;
      continue;
    }
    if (inline.type === 'mention') {
      close([]);
      endLink();
      out += mentionText(inline, ctx);
      continue;
    }
    if (!inline.text) continue;
    if (inline.code) {
      close([]);
      endLink();
      const fence = inline.text.includes('`') ? '``' : '`';
      const pad = inline.text.startsWith('`') || inline.text.endsWith('`') ? ' ' : '';
      out += `${fence}${pad}${inline.text}${pad}${fence}`;
      continue;
    }
    // Leerraum am Rand gehört vor und hinter die Zeichen der Auszeichnung, sonst gelten sie nicht.
    const lead = /^\s*/.exec(inline.text)![0];
    const trail = inline.text.trim() ? /\s*$/.exec(inline.text)![0] : '';
    const core = inline.text.slice(lead.length, inline.text.length - trail.length);
    const wanted = core ? NESTING.filter((mark) => inline[mark]) : [];
    if (inline.href !== link) {
      close([]);
      endLink();
    }
    if (!core) {
      close([]);
      out += lead;
      continue;
    }
    close(wanted);
    out += lead;
    if (inline.href && link === undefined) {
      out += '[';
      link = inline.href;
    }
    for (const mark of wanted.filter((m) => !open.includes(m))) {
      out += WRAP[mark]![0];
      open.push(mark);
    }
    out += escapeText(core);
    if (trail) {
      close([]);
      out += trail;
    }
  }
  close([]);
  endLink();
  return out;
}

const prefix = (text: string, first: string, rest = first) =>
  text
    .split('\n')
    .map((line, index) => ((index === 0 ? first : rest) + line).replace(/[ \t]+$/, ''))
    .join('\n');

const paragraphText = (inlines: Inline[], ctx: WriteContext) =>
  inlineMarkdown(inlines, ctx).split('\n').map(escapeLineStart).join('\n');

/** Der Inhalt einer Tabellenzelle in einer Zeile: Absätze und Listenpunkte durch Umbrüche getrennt. */
function cellText(nodes: ArticleNode[], ctx: WriteContext): string {
  const parts: string[] = [];
  const visit = (node: ArticleNode, bullet = '') => {
    switch (node.type) {
      case 'paragraph':
      case 'heading':
        parts.push(bullet + inlineMarkdown(node.inlines, ctx, '<br>'));
        break;
      case 'list':
        node.items.forEach((item, index) =>
          item.forEach((child, n) =>
            visit(child, n === 0 ? (node.ordered ? `${node.start + index}\\. ` : '• ') : ''),
          ),
        );
        break;
      case 'image':
        parts.push(`![${escapeText(node.alt)}](${node.url})`);
        break;
      default: {
        const text = blocksMarkdown([node], ctx).replace(/\n+/g, ' ').trim();
        if (text) parts.push(bullet + text);
      }
    }
  };
  nodes.forEach((node) => visit(node));
  return parts.join('<br>').replace(/\|/g, '\\|');
}

const TONE_NAME: Record<CalloutTone, string> = {
  info: 'info',
  note: 'notiz',
  success: 'tipp',
  warning: 'warnung',
  error: 'gefahr',
  custom: 'info',
};

const callout = (name: string, body: string, title = '') =>
  [`> [!${name}]${title ? ` ${title}` : ''}`, ...(body ? [prefix(body, '> ')] : [])].join('\n');

/** Der Inhalt eines Steckbriefs: Bilder, Felder „Name: Wert“ mit Überschrift, Kurztexte. */
function infoboxText(children: ArticleNode[], ctx: WriteContext): string {
  const parts: string[] = [];
  const heading = (title: string | undefined) => {
    if (title?.trim()) parts.push(`**${escapeText(title.trim())}**`);
  };
  for (const node of children) {
    switch (node.type) {
      case 'facts': {
        heading(node.title);
        const lines = node.rows
          .map((row) => {
            const value = inlineMarkdown(row.value, ctx, '<br>').trim();
            const key = escapeText(row.key.trim()).replace(/:/g, '\\:');
            return key ? `${key}: ${value}` : value;
          })
          .filter(Boolean);
        if (lines.length) parts.push(lines.map(escapeLineStart).join('\n'));
        break;
      }
      case 'links': {
        const items = node.items
          .map((item) =>
            mentionText({ type: 'mention', resourceId: item.resourceId, label: '' }, ctx),
          )
          .filter(Boolean);
        if (!items.length) break;
        if (node.title)
          parts.push(`${escapeText(node.title).replace(/:/g, '\\:')}: ${items.join(', ')}`);
        else parts.push(items.join(', '));
        break;
      }
      case 'group': {
        heading(node.title);
        // Eine Zeile „Wort: Text“ im Kurztext soll nicht als Feld gelesen werden.
        const body = blocksMarkdown(node.children, ctx)
          .split('\n')
          .map((line) => (FACT.test(line) ? line.replace(':', '\\:') : line))
          .join('\n');
        if (body) parts.push(body);
        break;
      }
      default: {
        const text = blocksMarkdown([node], ctx);
        if (text) parts.push(text);
      }
    }
  }
  return parts.join('\n\n');
}

/** Schreibt Knoten als Text. Blöcke sind durch eine Leerzeile getrennt. */
export function blocksMarkdown(nodes: ArticleNode[], ctx: WriteContext): string {
  const parts: string[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph': {
        const text = paragraphText(node.inlines, ctx);
        if (text.trim()) parts.push(text);
        break;
      }
      case 'heading': {
        const text = inlineMarkdown(node.inlines, ctx, ' ').trim();
        if (text) parts.push(`${'#'.repeat(Math.min(6, Math.max(1, node.level)))} ${text}`);
        break;
      }
      case 'quote': {
        const body = blocksMarkdown(node.children, ctx);
        // Ein Zitat darf nicht wie ein Kasten beginnen.
        if (body) parts.push(prefix(body.replace(/^\[!/, '\\[!'), '> '));
        break;
      }
      case 'code': {
        const fence = '`'.repeat(
          Math.max(3, ...[...node.text.matchAll(/`+/g)].map((m) => m[0].length + 1)),
        );
        parts.push(`${fence}\n${node.text}\n${fence}`);
        break;
      }
      case 'rule':
        parts.push('---');
        break;
      case 'list': {
        const lines = node.items.map((item, index) => {
          const marker = node.ordered ? `${node.start + index}. ` : '- ';
          const body = blocksMarkdown(item, ctx) || ' ';
          // Ein Absatz mit direkt folgender Unterliste braucht keine Leerzeile dazwischen.
          const tight = body.replace(/\n\n(?=(?:[-+]|\d+[.)])[ \t])/g, '\n');
          return prefix(tight, marker, ' '.repeat(marker.length));
        });
        parts.push(lines.join('\n'));
        break;
      }
      case 'tasks':
        parts.push(
          node.items
            .map(
              (item) => `- [${item.checked ? 'x' : ' '}] ${inlineMarkdown(item.inlines, ctx, ' ')}`,
            )
            .join('\n'),
        );
        break;
      case 'table': {
        if (!node.rows.length) break;
        const width = Math.max(...node.rows.map((row) => row.length));
        const line = (cells: string[]) =>
          `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
        const hasHeader = node.rows[0]!.length > 0 && node.rows[0]!.every((cell) => cell.header);
        const rows = node.rows.map((row) => row.map((cell) => cellText(cell.children, ctx)));
        parts.push(
          [
            line(hasHeader ? rows[0]! : []),
            line(Array.from({ length: width }, () => '---')),
            ...rows.slice(hasHeader ? 1 : 0).map(line),
          ].join('\n'),
        );
        break;
      }
      case 'callout':
        parts.push(callout(TONE_NAME[node.tone], blocksMarkdown(node.children, ctx)));
        break;
      case 'secret':
        parts.push(callout('geheim', blocksMarkdown(node.children, ctx)));
        break;
      case 'expand':
        parts.push(
          callout('aufklappen', blocksMarkdown(node.children, ctx), escapeText(node.title)),
        );
        break;
      case 'infobox': {
        const body = infoboxText(node.children, ctx);
        if (body) parts.push(callout('steckbrief', body));
        break;
      }
      case 'columns':
        for (const column of node.columns) {
          const text = blocksMarkdown(column, ctx);
          if (text) parts.push(text);
        }
        break;
      case 'image':
        parts.push(
          `![${escapeText(node.alt).replace(/[[\]]/g, '')}](${node.url}${
            node.caption && node.caption !== node.alt ? ` "${node.caption.replace(/"/g, '”')}"` : ''
          })`,
        );
        break;
      case 'facts':
      case 'group':
      case 'links': {
        // Außerhalb eines Steckbriefs: als betitelter Abschnitt im Fließtext.
        const text = infoboxText([node], ctx);
        if (text) parts.push(text);
        break;
      }
      case 'meters':
        parts.push(
          callout(
            'stand',
            node.items
              .map((item) => `${escapeText(item.name)}: ${item.current}/${item.max}`)
              .join('\n'),
            node.title ? escapeText(node.title) : '',
          ),
        );
        break;
      case 'note':
        // Ein eingebettetes Medium bleibt als Link; alles andere war nur ein Platzhalter.
        if (node.reason === 'embed' && node.href)
          parts.push(`[${escapeText(node.title || node.kind || 'Medium')}](${node.href})`);
        else ctx.dropped++;
        break;
      case 'unknown':
        if (node.text.trim()) parts.push(escapeLineStart(escapeText(node.text.trim())));
        break;
    }
  }
  return parts.join('\n\n');
}

/** Schreibt die Knoten einer Seite als Text. */
export function toMarkdown(nodes: ArticleNode[], ctx: WriteContext = plainWriter()): string {
  return blocksMarkdown(nodes, ctx);
}
