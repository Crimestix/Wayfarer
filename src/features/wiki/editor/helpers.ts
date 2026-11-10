/**
 * Reine Hilfsfunktionen des Artikel-Editors: Sie lesen und verändern Text, kennen aber weder
 * CodeMirror noch den Bildschirm. Was hier über die Textform steht (Verweise, Kästen, Listen,
 * Bilder), folgt `../markdown.ts`; die Muster sind bewusst dieselben.
 */

// ── Verweise ───────────────────────────────────────────────────────────────

/** Trennt bei einem Verweis das Ziel von einer angehängten Kennung („Titel~kennung“). */
export function splitTarget(target: string): { title: string; id: string | null } {
  const at = target.lastIndexOf('~');
  if (at > 0 && /^[A-Za-z0-9_-]{1,64}$/.test(target.slice(at + 1)))
    return { title: target.slice(0, at).trim(), id: target.slice(at + 1) };
  return { title: target.trim(), id: null };
}

export interface WikiLinkParts {
  /** Was vor dem Strich steht: Titel, gegebenenfalls mit Kennung. */
  target: string;
  /** Was in der schönen Ansicht zu lesen ist. */
  display: string;
  /** Anfang und Ende des gezeigten Stücks, gezählt ab dem ersten Zeichen nach `[[`. */
  showFrom: number;
  showTo: number;
}

/** Zerlegt, was zwischen `[[` und `]]` steht. */
export function wikiLinkParts(inner: string): WikiLinkParts {
  const bar = inner.indexOf('|');
  const rawTarget = bar >= 0 ? inner.slice(0, bar) : inner;
  const target = rawTarget.trim();
  const rawLabel = bar >= 0 ? inner.slice(bar + 1) : '';
  if (rawLabel.trim()) {
    const lead = rawLabel.length - rawLabel.trimStart().length;
    const showFrom = bar + 1 + lead;
    return {
      target,
      display: rawLabel.trim(),
      showFrom,
      showTo: showFrom + rawLabel.trim().length,
    };
  }
  const { title, id } = splitTarget(target);
  const lead = rawTarget.length - rawTarget.trimStart().length;
  // Mit Kennung endet das Gezeigte vor der Tilde; der Titel selbst kann davor noch Leerraum haben.
  const shown = id === null ? target : target.slice(0, target.lastIndexOf('~')).trimEnd();
  return { target, display: title, showFrom: lead, showTo: lead + shown.length };
}

export interface LinkQuery {
  /** Wo das Getippte beginnt (das erste `[` bzw. das `@`), als Spalte in der Zeile. */
  from: number;
  query: string;
  trigger: 'brackets' | 'at';
}

const AT_QUERY = /(?:^|[\s(„“"'>/-])@([^\s@[\]|]*(?: [^\s@[\]|]+){0,3})$/;

/**
 * Erkennt, ob vor dem Cursor gerade ein Verweis getippt wird: nach `[[` (solange weder `]]` noch
 * ein Strich folgt) oder nach einem `@` am Wortanfang. `before` ist die Zeile bis zum Cursor.
 */
export function linkQueryBefore(before: string): LinkQuery | null {
  const open = before.lastIndexOf('[[');
  if (open >= 0) {
    const query = before.slice(open + 2);
    if (!/[[\]|]/.test(query)) return { from: open, query, trigger: 'brackets' };
  }
  const at = AT_QUERY.exec(before);
  if (at) return { from: before.length - at[1]!.length - 1, query: at[1]!, trigger: 'at' };
  return null;
}

const same = (a: string, b: string) =>
  a.trim().toLocaleLowerCase('de') === b.trim().toLocaleLowerCase('de');

/** Trifft die Anfrage einen der Vorschläge genau (Groß- und Kleinschreibung egal)? */
export function hasExactMatch(
  query: string,
  suggestions: readonly { label: string; target: string }[],
): boolean {
  return suggestions.some(
    (s) =>
      same(s.label, query) || same(s.target, query) || same(splitTarget(s.target).title, query),
  );
}

/** Der Text eines Verweises auf dieses Ziel. Klammern und Umbrüche im Ziel würden ihn zerreißen. */
export function linkText(target: string): string {
  return `[[${target
    .replace(/[[\]\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()}]]`;
}

// ── Auszeichnung um eine Auswahl ───────────────────────────────────────────

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export interface WrapResult {
  /** Änderungen am ursprünglichen Text, aufsteigend geordnet. */
  changes: TextChange[];
  /** Auswahl nach den Änderungen. */
  from: number;
  to: number;
}

const onlyStars = (text: string) => /^\*+$/.test(text);

function starsBefore(text: string, pos: number): number {
  let n = 0;
  while (pos - n > 0 && text[pos - n - 1] === '*') n++;
  return n;
}

function starsAfter(text: string, pos: number): number {
  let n = 0;
  while (text[pos + n] === '*') n++;
  return n;
}

/**
 * Sternchen stehen für zweierlei: einer für kursiv, zwei für fett, drei für beides. Ob die
 * gesuchte Auszeichnung in einer Folge von Sternchen steckt, hängt deshalb von deren Länge ab.
 */
function starsContain(run: number, wanted: number): boolean {
  return wanted === 1 ? run % 2 === 1 : run >= 2;
}

/**
 * Schaltet eine Auszeichnung um die Auswahl `from`–`to` um: Steht sie schon da (um die Auswahl
 * herum oder als ihr Rand), wird sie entfernt, sonst gesetzt. Ohne Auswahl entsteht ein leeres
 * Paar mit dem Cursor dazwischen.
 */
export function toggleWrap(
  text: string,
  from: number,
  to: number,
  before: string,
  after: string,
): WrapResult {
  let a = Math.min(from, to);
  let b = Math.max(from, to);
  // Leerraum am Rand gehört nicht in die Auszeichnung, sonst gilt sie nicht.
  while (a < b && /\s/.test(text[a]!)) a++;
  while (b > a && /\s/.test(text[b - 1]!)) b--;
  const stars = onlyStars(before) && before === after;

  const outside = stars
    ? starsContain(Math.min(starsBefore(text, a), starsAfter(text, b)), before.length)
    : text.slice(Math.max(0, a - before.length), a) === before &&
      text.slice(b, b + after.length) === after;
  if (outside)
    return {
      changes: [
        { from: a - before.length, to: a, insert: '' },
        { from: b, to: b + after.length, insert: '' },
      ],
      from: a - before.length,
      to: b - before.length,
    };

  const inner = text.slice(a, b);
  const inside =
    inner.length > before.length + after.length &&
    (stars
      ? starsContain(Math.min(starsAfter(text, a), starsBefore(text, b)), before.length)
      : inner.startsWith(before) && inner.endsWith(after));
  if (inside)
    return {
      changes: [
        { from: a, to: a + before.length, insert: '' },
        { from: b - after.length, to: b, insert: '' },
      ],
      from: a,
      to: b - before.length - after.length,
    };

  if (a === b)
    return {
      changes: [{ from: a, to: a, insert: before + after }],
      from: a + before.length,
      to: a + before.length,
    };
  return {
    changes: [
      { from: a, to: a, insert: before },
      { from: b, to: b, insert: after },
    ],
    from: a + before.length,
    to: b + before.length,
  };
}

// ── Kästen ─────────────────────────────────────────────────────────────────

export type CalloutKind =
  | 'geheim'
  | 'steckbrief'
  | 'info'
  | 'notiz'
  | 'tipp'
  | 'warnung'
  | 'gefahr'
  | 'aufklappen'
  | 'stand';

const CALLOUT_KINDS: Record<string, CalloutKind> = {
  geheim: 'geheim',
  secret: 'geheim',
  sl: 'geheim',
  spielleitung: 'geheim',
  steckbrief: 'steckbrief',
  infobox: 'steckbrief',
  info: 'info',
  hinweis: 'info',
  note: 'notiz',
  notiz: 'notiz',
  tip: 'tipp',
  tipp: 'tipp',
  success: 'tipp',
  erfolg: 'tipp',
  warning: 'warnung',
  warnung: 'warnung',
  achtung: 'warnung',
  danger: 'gefahr',
  error: 'gefahr',
  gefahr: 'gefahr',
  fehler: 'gefahr',
  aufklappen: 'aufklappen',
  details: 'aufklappen',
  spoiler: 'aufklappen',
  stand: 'stand',
  zähler: 'stand',
  meter: 'stand',
};

const CALLOUT_LABELS: Record<CalloutKind, string> = {
  geheim: 'Geheim',
  steckbrief: 'Steckbrief',
  info: 'Hinweis',
  notiz: 'Notiz',
  tipp: 'Tipp',
  warnung: 'Warnung',
  gefahr: 'Gefahr',
  aufklappen: 'Aufklappen',
  stand: 'Stand',
};

/** Die Art eines Kastens zu dem Wort in `[!…]`. Unbekannte Wörter ergeben einen Hinweis. */
export function calloutKind(name: string): CalloutKind {
  return CALLOUT_KINDS[name.toLocaleLowerCase('de')] ?? 'info';
}

/** Der deutsche Name, der statt `[!art]` als Etikett erscheint. */
export function calloutLabel(name: string): string {
  return CALLOUT_LABELS[calloutKind(name)];
}

export interface CalloutHeader {
  kind: CalloutKind;
  label: string;
  /** Länge von `> [!art]` samt folgendem Leerraum – so viel ersetzt das Etikett. */
  markerLength: number;
  title: string;
}

const CALLOUT_LINE = /^(>[ \t]?\[!([A-Za-zÄÖÜäöüß-]+)\][+-]?[ \t]*)(.*)$/;

/** Liest die erste Zeile eines Kastens (`> [!art] Titel`); null, wenn die Zeile keine ist. */
export function calloutHeader(line: string): CalloutHeader | null {
  const match = CALLOUT_LINE.exec(line);
  if (!match) return null;
  return {
    kind: calloutKind(match[2]!),
    label: calloutLabel(match[2]!),
    markerLength: match[1]!.length,
    title: match[3]!.trim(),
  };
}

/** Länge der Zitatzeichen am Zeilenanfang (`> `, auch geschachtelt), 0 ohne Zitat. */
export function quotePrefixLength(line: string): number {
  return /^(?:>[ \t]?)+/.exec(line)?.[0].length ?? 0;
}

const FACT = /^((?:\\.|[^:\\[\]*`]){1,60}):(?:[ \t]+\S|[ \t]*$)/;

/** Länge von „Feld:“ am Anfang einer Steckbriefzeile (ohne Zitatzeichen), 0 wenn es keine ist. */
export function factKeyLength(content: string): number {
  // Listenpunkte, Überschriften und Bilder sind keine Felder, auch wenn ein Doppelpunkt folgt.
  if (/^(?:[-+>#|!]|\d+[.)][ \t])/.test(content)) return 0;
  const match = FACT.exec(content);
  return match ? match[1]!.length + 1 : 0;
}

// ── Listen und Zitate fortsetzen ───────────────────────────────────────────

/** So viele Leerzeichen rückt eine Stufe ein. */
export const LIST_INDENT = 2;

const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const LIST_ITEM = /^([ \t]*)([-+*]|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;

/** Ist das eine Linie (`---`)? */
export function isRule(line: string): boolean {
  return RULE.test(line);
}

export type Continuation =
  /** Am Cursor einfügen: Umbruch samt den Zeichen, mit denen die nächste Zeile weitergeht. */
  | { kind: 'continue'; insert: string }
  /** Die Spalten `from`–`to` der Zeile ersetzen: Die leere Fortsetzung endet hier. */
  | { kind: 'end'; from: number; to: number; insert: string };

/**
 * Was die Eingabetaste in dieser Zeile tut, wenn der Cursor in Spalte `column` steht: Listen und
 * Zitate (auch Kästen) gehen in der nächsten Zeile weiter; ein leerer Listenpunkt oder eine leere
 * Zitatzeile beendet sie. null heißt: gewöhnlicher Zeilenumbruch.
 */
export function continueMarkup(line: string, column: number): Continuation | null {
  const quoteLength = quotePrefixLength(line);
  const quote = line.slice(0, quoteLength).replace(/>[ \t]?/g, '> ');
  const rest = line.slice(quoteLength);
  const item = RULE.test(rest) ? null : LIST_ITEM.exec(rest);
  if (item) {
    if (column < quoteLength + item[0].length) return null;
    const indent = item[1]!;
    if (rest.slice(item[0].length).trim() === '') {
      // Ein leerer eingerückter Punkt rückt erst eine Stufe aus, ein äußerer endet.
      if (indent.length > 0)
        return {
          kind: 'end',
          from: quoteLength,
          to: quoteLength + Math.min(indent.length, LIST_INDENT),
          insert: '',
        };
      return { kind: 'end', from: quoteLength, to: line.length, insert: '' };
    }
    const marker = item[3] !== undefined ? `${Number(item[3]) + 1}${item[4]}` : item[2]!;
    return { kind: 'continue', insert: `\n${quote}${indent}${marker} ${item[6] ? '[ ] ' : ''}` };
  }
  if (quoteLength > 0) {
    if (column < quoteLength) return null;
    if (rest.trim() === '') return { kind: 'end', from: 0, to: line.length, insert: '' };
    return { kind: 'continue', insert: `\n${quote}` };
  }
  return null;
}

/**
 * Rückt einen Listenpunkt eine Stufe ein (`by` = 1) oder aus (`by` = -1). Liefert die Änderung an
 * der Zeile; null, wenn die Zeile kein Listenpunkt ist oder sich nichts ändert.
 */
export function shiftListIndent(line: string, by: 1 | -1): TextChange | null {
  const quoteLength = quotePrefixLength(line);
  const rest = line.slice(quoteLength);
  const item = RULE.test(rest) ? null : LIST_ITEM.exec(rest);
  if (!item) return null;
  if (by > 0) return { from: quoteLength, to: quoteLength, insert: ' '.repeat(LIST_INDENT) };
  const remove = Math.min(item[1]!.length, LIST_INDENT);
  return remove > 0 ? { from: quoteLength, to: quoteLength + remove, insert: '' } : null;
}

/** Das Gegenstück zu einem Aufgabenkästchen: aus `[ ]` wird `[x]`, aus `[x]` wieder `[ ]`. */
export function toggledTaskBox(box: string): string | null {
  if (box === '[ ]') return '[x]';
  if (box === '[x]' || box === '[X]') return '[ ]';
  return null;
}

// ── Bilder ─────────────────────────────────────────────────────────────────

const IMAGE = /^!\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)(?:[ \t]+"([^"]*)")?\)[ \t]*$/;
const FENCE = /^(`{3,})/;

export interface ImageRef {
  alt: string;
  url: string;
}

/** Liest eine Bildzeile (`![Alt](https://…)`, auch in einem Kasten); null, wenn es keine ist. */
export function imageLine(line: string): ImageRef | null {
  if (!line.includes('![')) return null;
  const match = IMAGE.exec(line.slice(quotePrefixLength(line)));
  if (!match || !/^https:\/\//i.test(match[2]!)) return null;
  return { alt: match[1]!.replace(/\\([!-/:-@[-`{-~])/g, '$1'), url: match[2]! };
}

/** Alle Bildzeilen eines Textes mit ihrer Zeilennummer (ab 0). Codeblöcke zählen nicht. */
export function imageLines(lines: Iterable<string>): (ImageRef & { index: number })[] {
  const out: (ImageRef & { index: number })[] = [];
  let fence: string | null = null;
  let index = -1;
  for (const line of lines) {
    index++;
    if (fence !== null) {
      if (line.startsWith(fence)) fence = null;
      continue;
    }
    const opening = FENCE.exec(line);
    if (opening) {
      fence = opening[1]!;
      continue;
    }
    const image = imageLine(line);
    if (image) out.push({ ...image, index });
  }
  return out;
}

// ── Zeilenanfänge und Absätze (Werkzeugleiste) ─────────────────────────────

const HEADING_PREFIX = /^#{1,6}[ \t]+/;
const NUMBER_PREFIX = /^\d{1,9}[.)][ \t]+/;

/**
 * Setzt `prefix` (etwa `## `, `- `, `1. `, `> `) vor jede der Zeilen – oder nimmt ihn weg, wenn
 * er schon vor allen steht. Eine Überschrift ersetzt eine andere Überschrift, statt sich
 * davorzusetzen; eine nummerierte Liste zählt von der ersten Zeile an weiter. Leere Zeilen
 * zwischen mehreren bleiben leer.
 */
export function togglePrefix(lines: readonly string[], prefix: string): string[] {
  const heading = HEADING_PREFIX.test(prefix);
  const number = NUMBER_PREFIX.exec(prefix);
  const counts = (line: string) => lines.length === 1 || line.trim() !== '';
  const has = (line: string) => (number ? NUMBER_PREFIX.test(line) : line.startsWith(prefix));
  const strip = (line: string) =>
    number ? line.replace(NUMBER_PREFIX, '') : line.slice(prefix.length);
  if (lines.filter(counts).every(has)) return lines.map((line) => (has(line) ? strip(line) : line));
  let next = number ? Number.parseInt(number[0], 10) : 0;
  return lines.map((line) => {
    if (!counts(line)) return line;
    if (number) return `${next++}${prefix.replace(/^\d+/, '')}${has(line) ? strip(line) : line}`;
    if (heading) return prefix + line.replace(HEADING_PREFIX, '');
    return has(line) ? line : prefix + line;
  });
}

export interface BlockInsertion extends TextChange {
  /** Wo die Schreibmarke danach steht: am Ende des eingefügten Textes. */
  cursor: number;
}

/**
 * Fügt `block` als eigenen Absatz hinter dem Absatz ein, in dem `pos` steht (zusammenhängende
 * Zeilen bis zur nächsten Leerzeile). Davor und danach steht genau eine Leerzeile; am Anfang und
 * am Ende des Textes keine.
 */
export function blockInsertion(text: string, pos: number, block: string): BlockInsertion {
  const lines = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const blank = (index: number) => lines[index]!.trim() === '';
  let current = 0;
  while (current + 1 < lines.length && starts[current + 1]! <= pos) current++;
  // Die letzte Zeile mit Text, hinter die der Absatz kommt (-1: ganz an den Anfang).
  let before = current;
  if (blank(current)) while (before >= 0 && blank(before)) before--;
  else while (before + 1 < lines.length && !blank(before + 1)) before++;
  let after = before + 1;
  while (after < lines.length && blank(after)) after++;
  const from = before >= 0 ? starts[before]! + lines[before]!.length : 0;
  const to = after < lines.length ? starts[after]! : text.length;
  const lead = before >= 0 ? '\n\n' : '';
  const body = block.replace(/^\n+|\s+$/g, '');
  return {
    from,
    to,
    insert: lead + body + (after < lines.length ? '\n\n' : ''),
    cursor: from + lead.length + body.length,
  };
}
