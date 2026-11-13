/**
 * Notizdateien des Spielleiters lesen: Text (.txt), Markdown (.md), Word (.docx) und RTF (.rtf).
 * Ergebnis ist immer Text mit `\n` als Zeilenende – so, wie er geschrieben wurde.
 */
import { docxText, NotesReadError, type NotesHeading } from './docx';

export { NotesReadError, type NotesHeading } from './docx';

export type NotesKind = 'txt' | 'md' | 'docx' | 'rtf';

export interface NotesFile {
  /** Dateiname, wie er gewählt wurde (ohne Pfad). */
  name: string;
  kind: NotesKind;
  /** Der Text, Zeilenenden `\n`. */
  text: string;
  /**
   * Zeilen (0-basiert), die die Datei selbst als Überschrift auszeichnet: Word-Formatvorlagen
   * „Überschrift n“/„Titel“ und Markdown (`# …`, unterstrichen mit `===` oder `---`).
   */
  headings: NotesHeading[];
  /** Wie der Text kodiert war – für den Hinweis bei alten Windows-Dateien. */
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252' | 'docx';
}

const KINDS: Record<string, NotesKind> = {
  txt: 'txt',
  text: 'txt',
  md: 'md',
  markdown: 'md',
  docx: 'docx',
  rtf: 'rtf',
};

/** Dateiendungen, die Wayfarer liest – für die Dateiauswahl. */
export const NOTES_EXTENSIONS = Object.keys(KINDS);

const extensionOf = (name: string) => /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

/** Art der Datei nach ihrer Endung; `null`, wenn Wayfarer sie nicht liest. */
export function notesKindOf(name: string): NotesKind | null {
  return KINDS[extensionOf(name)] ?? null;
}

function unsupported(name: string): string {
  const ext = extensionOf(name);
  if (ext === 'doc') {
    return `„${name}“ ist im alten Word-Format (.doc). Öffne sie in Word und speichere sie als .docx – dann liest Wayfarer sie.`;
  }
  if (ext === 'odt' || ext === 'pages') {
    return `„${name}“ kann Wayfarer nicht lesen. Speichere sie als Word-Datei (.docx) oder als Text (.txt).`;
  }
  if (ext === 'pdf') {
    return `„${name}“ ist ein PDF – daraus liest Wayfarer keinen Text. Nimm die Datei, aus der das PDF entstanden ist, oder speichere den Text als .txt.`;
  }
  return `„${name}“ kann Wayfarer nicht lesen – nur Text (.txt), Markdown (.md), Word (.docx) und RTF (.rtf).`;
}

/** Zeilenenden auf `\n` bringen. */
export const normalizeLines = (text: string) => text.replace(/\r\n?/g, '\n');

/**
 * Bytes als Text: UTF-8 (mit oder ohne BOM), UTF-16 mit BOM; ist UTF-8 ungültig, Windows-1252 –
 * so kommen Umlaute aus alten Windows-Dateien richtig an.
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: NotesFile['encoding'] } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be' };
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

/** Markdown-Überschriften: `# Titel` und Zeilen mit `===`/`---` darunter. */
export function markdownHeadings(text: string): NotesHeading[] {
  const lines = text.split('\n');
  const out: NotesHeading[] = [];
  let fence = false;
  lines.forEach((line, index) => {
    if (/^\s{0,3}(```|~~~)/.test(line)) fence = !fence;
    if (fence) return;
    const atx = /^\s{0,3}(#{1,6})\s+\S/.exec(line);
    if (atx) {
      out.push({ line: index, level: atx[1]!.length });
      return;
    }
    const next = lines[index + 1];
    if (next === undefined || !line.trim() || /^\s{0,3}#/.test(line)) return;
    // `---` unter einer Textzeile macht sie zur Überschrift; nach einer Leerzeile ist es eine
    // Trennlinie – dann ist `line` leer und kommt hier nicht an.
    if (/^\s{0,3}=+\s*$/.test(next)) out.push({ line: index, level: 1 });
    else if (/^\s{0,3}-+\s*$/.test(next) && !/^\s*[-*+]\s/.test(line)) {
      out.push({ line: index, level: 2 });
    }
  });
  return out;
}

// ── RTF ────────────────────────────────────────────────────────────────────

/** Gruppen, deren Inhalt kein Text ist. */
const RTF_SKIP = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'pict',
  'object',
  'header',
  'headerl',
  'headerr',
  'headerf',
  'footer',
  'footerl',
  'footerr',
  'footerf',
  'footnote',
  'annotation',
  'atnid',
  'atnauthor',
  'themedata',
  'colorschememapping',
  'latentstyles',
  'datastore',
  'xmlnstbl',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'generator',
  'mmathPr',
  'fldinst',
  'pgdsctbl',
  'filetbl',
  'revtbl',
  'userprops',
  'nonshppict',
  'shppict',
  'bkmkstart',
  'bkmkend',
]);

const RTF_SYMBOLS: Record<string, string> = {
  par: '\n',
  line: '\n',
  sect: '\n',
  page: '\n',
  row: '\n',
  tab: '\t',
  cell: '\t',
  emdash: '—',
  endash: '–',
  bullet: '•',
  lquote: '‘',
  rquote: '’',
  ldblquote: '“',
  rdblquote: '”',
  emspace: ' ',
  enspace: ' ',
  qmspace: ' ',
};

/** Text aus RTF: Steuerwörter weg, `\par` als Zeile, `\'e4` und `\u228?` als Zeichen. */
export function rtfText(source: string): string {
  if (!source.startsWith('{\\rtf')) throw new NotesReadError('Die RTF-Datei ist beschädigt.');
  const cp1252 = new TextDecoder('windows-1252');
  let out = '';
  const stack: { skip: boolean; uc: number }[] = [];
  let state = { skip: false, uc: 1 };
  /** Ersatzzeichen nach `\uN`, die übersprungen werden. */
  let pending = 0;
  const emit = (text: string) => {
    if (pending > 0) {
      pending--;
      return;
    }
    if (!state.skip) out += text;
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '{') {
      stack.push(state);
      state = { ...state };
      i++;
      continue;
    }
    if (ch === '}') {
      state = stack.pop() ?? state;
      pending = 0;
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      i++;
      continue;
    }
    if (ch !== '\\') {
      emit(ch);
      i++;
      continue;
    }
    const next = source[i + 1] ?? '';
    if (/[a-zA-Z]/.test(next)) {
      const match = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(source.slice(i, i + 64))!;
      i += match[0].length;
      const word = match[1]!;
      const param = match[2] === undefined ? null : Number(match[2]);
      if (RTF_SKIP.has(word)) state.skip = true;
      else if (word === 'uc' && param !== null) state.uc = param;
      else if (word === 'u' && param !== null) {
        emit(String.fromCharCode(param < 0 ? param + 65536 : param));
        pending = state.uc;
      } else if (RTF_SYMBOLS[word] !== undefined) emit(RTF_SYMBOLS[word]!);
      continue;
    }
    if (next === "'") {
      const hex = source.slice(i + 2, i + 4);
      i += 4;
      if (/^[0-9a-fA-F]{2}$/.test(hex)) emit(cp1252.decode(new Uint8Array([parseInt(hex, 16)])));
      continue;
    }
    i += 2;
    if (next === '*') state.skip = true;
    else if (next === '\\' || next === '{' || next === '}') emit(next);
    else if (next === '~') emit(' ');
    else if (next === '_') emit('-');
    else if (next === '\n' || next === '\r') emit('\n');
  }
  return out;
}

// ── Lesen ──────────────────────────────────────────────────────────────────

/** Eine Notizdatei lesen. Wirft `NotesReadError` mit einem deutschen Satz, wenn es nicht geht. */
export async function readNotesFile(name: string, bytes: Uint8Array): Promise<NotesFile> {
  const kind = notesKindOf(name);
  if (!kind) throw new NotesReadError(unsupported(name));
  if (kind === 'docx') {
    const { text, headings } = await docxText(bytes);
    return { name, kind, text: normalizeLines(text), headings, encoding: 'docx' };
  }
  const { text: raw, encoding } = decodeText(bytes);
  if (kind === 'rtf') {
    return { name, kind, text: normalizeLines(rtfText(raw.trimStart())), headings: [], encoding };
  }
  if (raw.includes('\u0000')) {
    throw new NotesReadError(
      `„${name}“ sieht nicht nach Text aus – Wayfarer kann sie nicht lesen.`,
    );
  }
  const text = normalizeLines(raw);
  return { name, kind, text, headings: kind === 'md' ? markdownHeadings(text) : [], encoding };
}
