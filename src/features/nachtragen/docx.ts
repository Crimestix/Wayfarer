/**
 * Text aus einer Word-Datei (.docx) lesen – ohne weitere Abhängigkeit.
 *
 * Eine .docx ist ein ZIP-Archiv mit XML darin. Gelesen wird das Inhaltsverzeichnis am Ende des
 * Archivs (zentrales Verzeichnis), daraus `word/document.xml` (und für die Namen der
 * Formatvorlagen `word/styles.xml`). Gepackte Einträge entpackt `DecompressionStream`
 * ('deflate-raw') der Plattform – vorhanden in WebView2, WKWebView und Node ab 18.
 *
 * Ergebnis: je Absatz (`w:p`) eine Zeile, Text der Läufe (`w:t`) aneinander, `w:tab` als
 * Tabulator, `w:br`/`w:cr` als Zeilenumbruch. Fußnoten, Kommentare, gelöschter Text der
 * Änderungsverfolgung und Feldbefehle werden nicht gelesen.
 */

/** Eine Überschrift im gelesenen Text: Zeile (0-basiert) und Ebene (0 = Titel, 1 = Überschrift 1 …). */
export interface NotesHeading {
  line: number;
  level: number;
}

export interface DocxText {
  /** Der Text, Zeilen getrennt durch `\n`. */
  text: string;
  /** Zeilen, die in Word als Überschrift (oder Titel) formatiert sind. */
  headings: NotesHeading[];
}

/** Fehler beim Lesen einer Datei – die Meldung ist ein deutscher Satz für den Spielleiter. */
export class NotesReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotesReadError';
  }
}

// ── ZIP ────────────────────────────────────────────────────────────────────

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

const SIG_END = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

const BROKEN =
  'Die Word-Datei ist beschädigt oder keine echte .docx – Wayfarer kann sie nicht öffnen.';

function zipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  // Das Ende des Verzeichnisses liegt in den letzten 22 + 65535 Bytes (Kommentar am Ende).
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (u32(at) === SIG_END) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new NotesReadError(BROKEN);
  const count = u16(end + 10);
  let at = u32(end + 16);
  if (at === 0xffffffff) throw new NotesReadError('Die Word-Datei ist zu groß für Wayfarer.');
  const names = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || u32(at) !== SIG_CENTRAL) throw new NotesReadError(BROKEN);
    const nameLength = u16(at + 28);
    const extraLength = u16(at + 30);
    const commentLength = u16(at + 32);
    entries.push({
      method: u16(at + 10),
      compressedSize: u32(at + 20),
      size: u32(at + 24),
      localOffset: u32(at + 42),
      name: names.decode(bytes.subarray(at + 46, at + 46 + nameLength)),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new NotesReadError('Dieses System kann gepackte Word-Dateien nicht entpacken.');
  }
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  const writing = writer.write(new Uint8Array(data)).then(() => writer.close());
  try {
    const [out] = await Promise.all([new Response(stream.readable).arrayBuffer(), writing]);
    return new Uint8Array(out);
  } catch {
    throw new NotesReadError(BROKEN);
  }
}

async function readEntry(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.localOffset;
  if (at + 30 > bytes.length || view.getUint32(at, true) !== SIG_LOCAL) {
    throw new NotesReadError(BROKEN);
  }
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (data.length !== entry.compressedSize) throw new NotesReadError(BROKEN);
  if (entry.method === 0) return data;
  if (entry.method === 8) return inflateRaw(data);
  throw new NotesReadError('Die Word-Datei ist auf eine Art gepackt, die Wayfarer nicht kennt.');
}

/** Die Einträge eines ZIP-Archivs, die `wanted` nennt, als Text (UTF-8). Fehlende fehlen. */
export async function unzipText(
  bytes: Uint8Array,
  wanted: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const decoder = new TextDecoder('utf-8');
  for (const entry of zipEntries(bytes)) {
    if (!wanted.includes(entry.name)) continue;
    out.set(entry.name, decoder.decode(await readEntry(bytes, entry)));
  }
  return out;
}

// ── XML ────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** XML-Entitäten auflösen: `&amp;`, `&#228;`, `&#xE4;` … */
export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X'))
      return safeChar(parseInt(name.slice(2), 16), whole);
    if (name.startsWith('#')) return safeChar(parseInt(name.slice(1), 10), whole);
    return ENTITIES[name] ?? whole;
  });
}

function safeChar(code: number, fallback: string): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : fallback;
}

interface Tag {
  /** Name ohne Präfix. */
  local: string;
  prefix: string;
  close: boolean;
  empty: boolean;
  raw: string;
}

function attr(raw: string, name: string): string | null {
  const match = new RegExp(
    `(?:^|\\s)${name.replace(/[.:]/g, '\\$&')}\\s*=\\s*("([^"]*)"|'([^']*)')`,
  ).exec(raw);
  if (!match) return null;
  return decodeEntities(match[2] ?? match[3] ?? '');
}

/** Läuft über alle Tags und Textstücke eines XML-Textes. */
function walkXml(xml: string, onTag: (tag: Tag) => void, onText: (text: string) => void): void {
  const pattern = /<([^>]*)>/g;
  let last = 0;
  for (const match of xml.matchAll(pattern)) {
    if (match.index > last) onText(xml.slice(last, match.index));
    last = match.index + match[0].length;
    const inner = match[1] ?? '';
    if (inner.startsWith('?') || inner.startsWith('!')) continue;
    const close = inner.startsWith('/');
    const empty = inner.endsWith('/');
    const body = inner.slice(close ? 1 : 0, empty ? -1 : undefined).trim();
    const name = /^[^\s/]+/.exec(body)?.[0] ?? '';
    const colon = name.indexOf(':');
    onTag({
      local: colon >= 0 ? name.slice(colon + 1) : name,
      prefix: colon >= 0 ? name.slice(0, colon) : '',
      close,
      empty,
      raw: body,
    });
  }
  if (last < xml.length) onText(xml.slice(last));
}

const WORD_NAMESPACES = [
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
];

/** Präfix, unter dem das Word-Schema im Dokument steht (fast immer „w“). */
function wordPrefix(xml: string): string {
  for (const match of xml.matchAll(/xmlns:([\w.-]+)\s*=\s*"([^"]*)"/g)) {
    if (WORD_NAMESPACES.includes(match[2] ?? '')) return match[1] ?? 'w';
  }
  return 'w';
}

/** Überschrift nach dem Namen der Formatvorlage: „heading 2“ → 2, „Title“ → 0. */
function levelOfStyleName(name: string): number | null {
  const lower = name.toLowerCase().trim();
  const numbered = /^(?:heading|überschrift|berschrift)\s*(\d)$/.exec(lower);
  if (numbered) return Number(numbered[1]);
  if (lower === 'title' || lower === 'titel') return 0;
  return null;
}

interface StyleInfo {
  name: string;
  outline: number | null;
  basedOn: string | null;
}

/** Formatvorlagen: Kennung → Überschriftenebene (geerbt über `basedOn`). */
function headingStyles(stylesXml: string | undefined): Map<string, number> {
  const styles = new Map<string, StyleInfo>();
  if (stylesXml) {
    const w = wordPrefix(stylesXml);
    let current: { id: string; info: StyleInfo } | null = null;
    walkXml(
      stylesXml,
      (tag) => {
        if (tag.prefix !== w) return;
        if (tag.local === 'style') {
          if (tag.close) {
            if (current) styles.set(current.id, current.info);
            current = null;
          } else {
            const id = attr(tag.raw, `${w}:styleId`);
            const type = attr(tag.raw, `${w}:type`);
            current =
              id && (type === null || type === 'paragraph')
                ? { id, info: { name: '', outline: null, basedOn: null } }
                : null;
            if (tag.empty && current) {
              styles.set(current.id, current.info);
              current = null;
            }
          }
        } else if (current && !tag.close) {
          const value = attr(tag.raw, `${w}:val`);
          if (value === null) return;
          if (tag.local === 'name') current.info.name = value;
          else if (tag.local === 'basedOn') current.info.basedOn = value;
          else if (tag.local === 'outlineLvl') current.info.outline = Number(value);
        }
      },
      () => {},
    );
  }
  const levels = new Map<string, number>();
  const levelOf = (id: string, seen: Set<string>): number | null => {
    const info = styles.get(id);
    if (!info || seen.has(id)) return null;
    seen.add(id);
    const byName = levelOfStyleName(info.name);
    if (byName !== null) return byName;
    if (info.outline !== null && info.outline >= 0 && info.outline < 9) return info.outline + 1;
    return info.basedOn ? levelOf(info.basedOn, seen) : null;
  };
  for (const id of styles.keys()) {
    const level = levelOf(id, new Set());
    if (level !== null) levels.set(id, level);
  }
  return levels;
}

/** Kennung einer Vorlage ohne styles.xml deuten: „Heading1“, „berschrift2“, „Title“. */
function levelOfStyleId(id: string): number | null {
  const match = /^(?:heading|überschrift|berschrift)(\d)$/i.exec(id);
  if (match) return Number(match[1]);
  return /^(?:title|titel)$/i.test(id) ? 0 : null;
}

/** Vorlagen des Inhaltsverzeichnisses: „TOC1“, deutsch „Verzeichnis1“. */
const TOC_STYLE = /^(?:toc|verzeichnis|inhaltsverzeichnis)\s*\d*$/i;

/** Zählt nicht als Text: Ersatzdarstellungen, verschobener alter Text. */
const SKIPPED = new Set(['Fallback', 'moveFrom']);

/** Text und Überschriften aus `word/document.xml`. */
export function documentText(documentXml: string, stylesXml?: string): DocxText {
  const w = wordPrefix(documentXml);
  const styles = headingStyles(stylesXml);
  const out: string[] = [];
  const headings: NotesHeading[] = [];
  let lineCount = 0;
  const stack: { text: string; level: number | null; toc: boolean }[] = [];
  let runDepth = 0;
  let textDepth = 0;
  let propsDepth = 0;
  let skipDepth = 0;

  walkXml(
    documentXml,
    (tag) => {
      if (SKIPPED.has(tag.local)) {
        if (tag.empty) return;
        skipDepth += tag.close ? -1 : 1;
        return;
      }
      if (skipDepth > 0 || tag.prefix !== w) return;
      const paragraph = stack[stack.length - 1];
      switch (tag.local) {
        case 'p':
          if (tag.close || tag.empty) {
            const done = tag.empty ? { text: '', level: null, toc: false } : stack.pop();
            if (!done) return;
            // Ein Inhaltsverzeichnis wiederholt nur die Überschriften – es wären lauter leere
            // Sessions.
            if (done.toc) return;
            if (done.level !== null && done.text.trim()) {
              headings.push({ line: lineCount, level: done.level });
            }
            out.push(done.text);
            lineCount += done.text.split('\n').length;
          } else {
            stack.push({ text: '', level: null, toc: false });
          }
          return;
        case 'pPr':
          if (!tag.empty) propsDepth += tag.close ? -1 : 1;
          return;
        case 'pStyle':
          if (paragraph && propsDepth > 0) {
            const id = attr(tag.raw, `${w}:val`) ?? '';
            paragraph.level = styles.get(id) ?? levelOfStyleId(id) ?? paragraph.level;
            if (TOC_STYLE.test(id)) paragraph.toc = true;
          }
          return;
        case 'outlineLvl':
          if (paragraph && propsDepth > 0) {
            const level = Number(attr(tag.raw, `${w}:val`));
            if (Number.isInteger(level) && level >= 0 && level < 9) paragraph.level = level + 1;
          }
          return;
        case 'r':
          if (!tag.empty) runDepth += tag.close ? -1 : 1;
          return;
        case 't':
          if (!tag.empty) textDepth += tag.close ? -1 : 1;
          return;
        case 'tab':
          if (paragraph && runDepth > 0 && !tag.close) paragraph.text += '\t';
          return;
        case 'br':
        case 'cr':
          if (paragraph && runDepth > 0 && !tag.close) paragraph.text += '\n';
          return;
        case 'noBreakHyphen':
          if (paragraph && runDepth > 0 && !tag.close) paragraph.text += '-';
          return;
        default:
          return;
      }
    },
    (text) => {
      const paragraph = stack[stack.length - 1];
      if (skipDepth === 0 && textDepth > 0 && paragraph) paragraph.text += decodeEntities(text);
    },
  );
  return { text: out.join('\n'), headings };
}

/** Text einer .docx-Datei. Wirft `NotesReadError` mit einem Satz für den Spielleiter. */
export async function docxText(bytes: Uint8Array): Promise<DocxText> {
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    throw new NotesReadError(
      'Die Word-Datei ist mit einem Kennwort geschützt oder im alten Format (.doc). Speichere sie in Word ohne Kennwort als .docx.',
    );
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new NotesReadError(BROKEN);
  const parts = await unzipText(bytes, ['word/document.xml', 'word/styles.xml']);
  const document = parts.get('word/document.xml');
  if (document === undefined) throw new NotesReadError(BROKEN);
  return documentText(document, parts.get('word/styles.xml'));
}
