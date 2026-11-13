/**
 * Zeilen, die Wayfarer selbst in einen Artikel schreiben darf – und nur diese: eine Zeile
 * „Feld: Wert“ im Steckbrief (`> [!steckbrief]`) und ein Punkt unter der Überschrift
 * „## Was geschah“. Der Fließtext bleibt unberührt. Jede Änderung lässt sich genau zurücknehmen,
 * solange die Zeile noch so dasteht, wie Wayfarer sie geschrieben hat. Reine Funktionen auf dem
 * Text einer Seite (Dialekt: `markdown.ts`).
 */
import type { EntityKind } from '../../domain/schema';
import { FIELD_LABEL, factField, type FactField } from './facts';

/** Die Überschrift des Abschnitts, unter dem das Geschehene steht. */
export const HAPPENED_HEADING = 'Was geschah';

const BOX = /^>\s*\[!(?:steckbrief|infobox)\][^\n]*$/i;
const QUOTED = /^>/;
const BLANK_QUOTED = /^>\s*$/;
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FACT = /^>\s?([^:\n]{1,60}):(?:[ \t]+|$)(.*)$/;

const splitLines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n');

/** Welche Zeilen in einem Codeblock stehen – dort zählt nichts als Steckbrief oder Überschrift. */
function inCode(lines: string[]): boolean[] {
  const out: boolean[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const fence = FENCE.exec(line);
    if (fence && (open === null || fence[1] === open)) {
      out.push(true);
      open = open === null ? fence[1]! : null;
    } else out.push(open !== null);
  }
  return out;
}

/** Der erste Steckbrief: Zeile der Kopfzeile und letzte Zeile (einschließlich). */
function findBox(lines: string[]): { head: number; last: number } | null {
  const code = inCode(lines);
  for (let i = 0; i < lines.length; i++) {
    if (code[i] || !BOX.test(lines[i]!)) continue;
    let last = i;
    while (last + 1 < lines.length && QUOTED.test(lines[last + 1]!)) last++;
    return { head: i, last };
  }
  return null;
}

/** Ein Wert in einer Zeile: ohne Zeilenumbrüche. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export interface FactLineEdit {
  text: string;
  /** Die Zeile, wie sie jetzt dasteht („> Zustand: tot“). */
  line: string;
  /** Die Zeile, die sie ersetzt hat; null = neu hinzugekommen. */
  before: string | null;
  /** Der Steckbrief entstand dabei erst. */
  made: boolean;
}

/**
 * Setzt im Steckbrief das Feld `field` auf `value`: Steht es schon da (unter irgendeiner
 * Bezeichnung, die Wayfarer für dieses Feld kennt), wird nur der Wert ersetzt; sonst kommt eine
 * Zeile hinzu – in den Absatz mit den Feldern, sonst ans Ende des Steckbriefs. Gibt es keinen
 * Steckbrief, entsteht einer ganz oben. Der übrige Text bleibt Zeichen für Zeichen.
 */
export function setFactLine(
  text: string,
  kind: EntityKind,
  field: FactField,
  value: string,
): FactLineEdit {
  const lines = splitLines(text);
  const clean = oneLine(value);
  const box = findBox(lines);
  if (!box) {
    const line = `> ${FIELD_LABEL[field]}: ${clean}`;
    const rest = text.replace(/^\s*\n/, '');
    return {
      text: rest.trim() ? `> [!steckbrief]\n${line}\n\n${rest}` : `> [!steckbrief]\n${line}\n`,
      line,
      before: null,
      made: true,
    };
  }
  // Steht das Feld schon da?
  for (let i = box.head + 1; i <= box.last; i++) {
    const match = FACT.exec(lines[i]!);
    if (!match || factField(kind, match[1]!.trim()) !== field) continue;
    const before = lines[i]!;
    const line = `> ${match[1]!.trim()}: ${clean}`;
    if (before === line) return { text, line, before, made: false };
    lines[i] = line;
    return { text: lines.join('\n'), line, before, made: false };
  }
  // Sonst hinter die letzte Zeile eines Absatzes, der nur aus Feldern besteht.
  const line = `> ${FIELD_LABEL[field]}: ${clean}`;
  let at = -1;
  let i = box.head + 1;
  while (i <= box.last) {
    if (BLANK_QUOTED.test(lines[i]!)) {
      i++;
      continue;
    }
    let end = i;
    while (end + 1 <= box.last && !BLANK_QUOTED.test(lines[end + 1]!)) end++;
    let facts = true;
    for (let k = i; k <= end; k++) if (!FACT.exec(lines[k]!)?.[2]?.trim()) facts = false;
    if (facts) {
      at = end;
      break;
    }
    i = end + 1;
  }
  if (at >= 0) lines.splice(at + 1, 0, line);
  else if (box.last === box.head || BLANK_QUOTED.test(lines[box.last]!))
    lines.splice(box.last + 1, 0, line);
  else lines.splice(box.last + 1, 0, '>', line);
  return { text: lines.join('\n'), line, before: null, made: false };
}

/**
 * Nimmt `setFactLine` zurück: Steht die Zeile noch so im Steckbrief, kommt die alte zurück bzw.
 * sie geht weg – und ein Steckbrief, der erst dabei entstand und jetzt leer ist, auch. Hat der
 * Spielleiter die Zeile inzwischen geändert, bleibt alles, wie es ist.
 */
export function unsetFactLine(text: string, edit: Omit<FactLineEdit, 'text'>): string {
  const lines = splitLines(text);
  const box = findBox(lines);
  if (!box) return text;
  let found = -1;
  for (let i = box.head + 1; i <= box.last; i++)
    if (lines[i] === edit.line) {
      found = i;
      break;
    }
  if (found < 0) return text;
  if (edit.before !== null) {
    lines[found] = edit.before;
    return lines.join('\n');
  }
  lines.splice(found, 1);
  // Eine leere Zeile im Kasten, die nur vor der Zeile stand, geht mit.
  if (BLANK_QUOTED.test(lines[found - 1] ?? '') && found - 1 > box.head) {
    const next = lines[found];
    if (next === undefined || !QUOTED.test(next)) lines.splice(found - 1, 1);
  }
  if (edit.made) {
    const after = findBox(lines);
    if (after) {
      const inner = lines.slice(after.head + 1, after.last + 1);
      if (inner.every((l) => BLANK_QUOTED.test(l))) {
        let end = after.last + 1;
        while (end < lines.length && !lines[end]!.trim()) end++;
        lines.splice(after.head, end - after.head);
      }
    }
  }
  return lines.join('\n');
}

export interface HappenedLineEdit {
  text: string;
  /** Der Punkt, wie er jetzt dasteht („- 8. Saatmond …“). */
  line: string;
  /** Der Abschnitt „Was geschah“ entstand dabei erst. */
  made: boolean;
  /** false = der Punkt stand schon da; nichts geändert. */
  added: boolean;
}

/** Abschnitt „Was geschah“: Zeile der Überschrift und erste Zeile danach, die nicht mehr dazugehört. */
function findHappened(lines: string[]): { head: number; end: number } | null {
  const code = inCode(lines);
  for (let i = 0; i < lines.length; i++) {
    if (code[i]) continue;
    const match = HEADING.exec(lines[i]!);
    if (!match || match[2]!.trim().toLocaleLowerCase('de') !== HAPPENED_HEADING.toLowerCase())
      continue;
    const level = match[1]!.length;
    let end = i + 1;
    while (end < lines.length) {
      const next = !code[end] && HEADING.exec(lines[end]!);
      if (next && next[1]!.length <= level) break;
      end++;
    }
    return { head: i, end };
  }
  return null;
}

/**
 * Hängt unter „## Was geschah“ einen Punkt an (`- …`). Fehlt der Abschnitt, entsteht er am Ende
 * des Artikels. Steht derselbe Punkt dort schon, geschieht nichts.
 */
export function addHappenedLine(text: string, entry: string): HappenedLineEdit {
  const line = `- ${oneLine(entry)}`;
  const lines = splitLines(text);
  const section = findHappened(lines);
  if (!section) {
    const body = text.replace(/\s+$/, '');
    return {
      text: `${body}${body ? '\n\n' : ''}## ${HAPPENED_HEADING}\n\n${line}\n`,
      line,
      made: true,
      added: true,
    };
  }
  if (lines.slice(section.head + 1, section.end).includes(line))
    return { text, line, made: false, added: false };
  let last = section.end - 1;
  while (last > section.head && !lines[last]!.trim()) last--;
  if (last === section.head) lines.splice(section.head + 1, 0, '', line);
  else if (/^\s*[-*+]\s/.test(lines[last]!)) lines.splice(last + 1, 0, line);
  else lines.splice(last + 1, 0, '', line);
  return { text: lines.join('\n'), line, made: false, added: true };
}

/**
 * Nimmt `addHappenedLine` zurück: Der Punkt geht weg, wenn er noch so dasteht – und der
 * Abschnitt, wenn er erst dabei entstand und nun leer ist.
 */
export function removeHappenedLine(text: string, edit: { line: string; made: boolean }): string {
  const lines = splitLines(text);
  const section = findHappened(lines);
  if (!section) return text;
  let found = -1;
  for (let i = section.head + 1; i < section.end; i++)
    if (lines[i] === edit.line) {
      found = i;
      break;
    }
  if (found < 0) return text;
  lines.splice(found, 1);
  const end = section.end - 1;
  // Eine Leerzeile, die nur den Punkt vom Text davor trennte, geht mit.
  if (
    found - 1 > section.head &&
    !lines[found - 1]!.trim() &&
    (found >= end || !lines[found]?.trim())
  )
    lines.splice(found - 1, 1);
  if (edit.made) {
    const after = findHappened(lines);
    if (after && lines.slice(after.head + 1, after.end).every((l) => !l.trim())) {
      let start = after.head;
      while (start > 0 && !lines[start - 1]!.trim()) start--;
      lines.splice(start, after.end - start);
    }
  }
  return lines.join('\n');
}
