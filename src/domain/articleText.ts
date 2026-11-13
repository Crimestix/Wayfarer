/**
 * Den Text eines Artikels lesen, ohne ihn ganz zu zerlegen: welche Kästen darin stehen, was davon
 * nur für die Spielleitung ist (`> [!geheim]`) und was im Steckbrief steht (`> [!steckbrief]`).
 * Die Regeln für Kästen gelten genauso in der Anzeige (`features/wiki/markdown.ts` liest die
 * Namen von hier). Reine Funktionen auf dem Text – der Wortlaut bleibt, wie er geschrieben wurde.
 */

/** Kästen nur für die Spielleitung. */
export const SECRET_CALLOUTS: ReadonlySet<string> = new Set([
  'geheim',
  'secret',
  'sl',
  'spielleitung',
]);
/** Der Steckbrief neben dem Text. */
export const INFOBOX_CALLOUTS: ReadonlySet<string> = new Set(['steckbrief', 'infobox']);
/** Die erste Zeile eines Kastens: `[!name] Titel`. */
export const CALLOUT = /^\[!([A-Za-zÄÖÜäöüß-]+)\][+-]?[ \t]*(.*)$/;

const FENCE = /^(`{3,})/;

/**
 * Ein Stück Text: gewöhnliche Zeilen oder ein Zitat bzw. Kasten (alle Zeilen beginnen mit „>“,
 * gleich weit eingerückt – in einer Liste steht ein Kasten eingerückt unter dem Punkt).
 */
interface Chunk {
  /** null = gewöhnliche Zeilen; sonst die Einrückung vor dem „>“. */
  indent: string | null;
  lines: string[];
}

/** Eine Zeile eines Zitats: Einrückung (Leerzeichen, Tabulator) und „>“. */
const QUOTE = /^([ \t]*)>/;

/** Teilt Zeilen in gewöhnlichen Text und Zitate – Code zwischen ``` bleibt gewöhnlicher Text. */
function chunks(lines: readonly string[]): Chunk[] {
  const out: Chunk[] = [];
  const push = (indent: string | null, line: string) => {
    const last = out[out.length - 1];
    if (last && last.indent === indent) last.lines.push(line);
    else out.push({ indent, lines: [line] });
  };
  let fence: string | null = null;
  for (const line of lines) {
    if (fence !== null) {
      push(null, line);
      if (line.startsWith(fence)) fence = null;
      continue;
    }
    const open = FENCE.exec(line);
    if (open) {
      fence = open[1]!;
      push(null, line);
      continue;
    }
    push(QUOTE.exec(line)?.[1] ?? null, line);
  }
  return out;
}

/** Die Zeilen eines Zitats ohne Einrückung und „>“ davor. */
const inner = (chunk: Chunk) =>
  chunk.lines.map((line) => line.slice(chunk.indent?.length ?? 0).replace(/^> ?/, ''));

/** Der Name des Kastens, mit dem ein Zitat beginnt (klein geschrieben); null = kein Kasten. */
function calloutOf(chunk: Chunk): string | null {
  if (chunk.indent === null) return null;
  const match = CALLOUT.exec(inner(chunk)[0] ?? '');
  return match ? match[1]!.toLowerCase() : null;
}

const split = (text: string) => text.replace(/\r\n?/g, '\n').split('\n');
const tidy = (text: string) => text.replace(/\n{3,}/g, '\n\n').trim();

/**
 * Der Text ohne die Kästen für die Spielleitung – auch ohne solche, die in einem anderen Kasten
 * oder eingerückt unter einem Listenpunkt stehen. Alles andere bleibt Wort für Wort.
 */
export function withoutSecrets(text: string): string {
  return tidy(stripSecrets(split(text)).join('\n'));
}

function stripSecrets(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const chunk of chunks(lines)) {
    if (chunk.indent === null) {
      out.push(...chunk.lines);
      continue;
    }
    const name = calloutOf(chunk);
    if (name && SECRET_CALLOUTS.has(name)) continue;
    const body = inner(chunk);
    const kept = stripSecrets(body);
    // Unverändert bleibt das Zitat, wie es geschrieben wurde.
    if (kept.length === body.length && kept.every((line, i) => line === body[i]))
      out.push(...chunk.lines);
    else out.push(...kept.map((line) => (line ? `${chunk.indent}> ${line}` : `${chunk.indent}>`)));
  }
  return out;
}

/** Eine Zeile „Feld: Wert“ aus dem Steckbrief. Der Wert kann Verweise enthalten (`[[…]]`). */
export interface ArticleFact {
  label: string;
  value: string;
}

/** Feld und Wert – das Feld ohne Auszeichnung, höchstens 60 Zeichen. */
const FACT = /^([^:\n*_`![\]>#][^:\n[\]`]{0,59}):[ \t]+(\S.*)$/;
/** Eine Zeile nur aus Fettdruck: die Überschrift eines Abschnitts im Steckbrief. */
const BOLD_TITLE = /^\*\*[^*]+\*\*\s*$/;
const IMAGE = /^!\[/;

/** Was ein Artikel neben dem Text im Steckbrief sagt – und der Text ohne den Steckbrief. */
export interface ArticleParts {
  /** Die Zeilen „Feld: Wert“ aus dem Steckbrief, in ihrer Reihenfolge. */
  facts: ArticleFact[];
  /** Kurztexte im Steckbrief, die keine Felder sind – als Text. */
  box: string;
  /** Der übrige Text. */
  body: string;
}

/**
 * Trennt den Steckbrief vom übrigen Text. Bilder und Abschnittsüberschriften im Steckbrief
 * fallen weg; Kästen für die Spielleitung sollten vorher mit `withoutSecrets` entfernt sein.
 */
export function articleParts(text: string): ArticleParts {
  const facts: ArticleFact[] = [];
  const box: string[] = [];
  const body: string[] = [];
  for (const chunk of chunks(split(text))) {
    // Nur ein Steckbrief am Rand des Textes steht neben ihm; eingerückt gehört er zum Text.
    const name = chunk.indent === '' ? calloutOf(chunk) : null;
    if (!name || !INFOBOX_CALLOUTS.has(name)) {
      body.push(...chunk.lines);
      continue;
    }
    for (const raw of inner(chunk).slice(1)) {
      const line = raw.trim();
      if (!line || IMAGE.test(line) || BOLD_TITLE.test(line)) {
        if (!line && box.length && box[box.length - 1] !== '') box.push('');
        continue;
      }
      const fact = FACT.exec(line);
      if (fact) facts.push({ label: fact[1]!.trim(), value: fact[2]!.trim() });
      else box.push(line);
    }
    body.push('');
  }
  return { facts, box: tidy(box.join('\n')), body: tidy(body.join('\n')) };
}

/**
 * Markdown als reiner Text zum Lesen und Kopieren: Verweise als ihr Name, Links als ihr Text,
 * ohne Zeichen für Auszeichnung, Überschriften und Zitate. Absätze bleiben.
 */
export function plainMarkdown(text: string): string {
  return tidy(
    split(text)
      .filter((line) => !IMAGE.test(line.trim()) && !/^(`{3,})/.test(line))
      .map((line) =>
        line
          .replace(/^(?:>\s?)+/, '')
          .replace(/^\[![^\]]+\][+-]?\s*/, '')
          .replace(/^#{1,6}\s+/, '')
          .replace(/(?<!\\)\[\[([^[\]\n|]+)\|([^[\]\n]*)\]\]/g, '$2')
          .replace(/(?<!\\)\[\[([^[\]\n|]+?)(?:~[A-Za-z0-9_-]{1,64})?\]\]/g, '$1')
          .replace(/\[([^\]\n]*)\]\([^)\s]+\)/g, '$1')
          .replace(/\*\*|__|==|~~|<\/?(?:u|sub|sup)>/g, '')
          .replace(/(^|[\s(])\*(\S[^*\n]*?)\*(?=$|[\s.,;:!?)])/g, '$1$2')
          .replace(/\\([!-/:-@[-`{-~])/g, '$1')
          .trimEnd(),
      )
      .join('\n'),
  );
}
