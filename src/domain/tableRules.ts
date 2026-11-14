/**
 * Regeln des Tisches: die Hausregeln und Absprachen der Runde – ein Blatt Text in Markdown wie die
 * Artikel, geschrieben vom Spielleiter (`campaign.tableRules`). Wayfarer schreibt nichts hinein;
 * es findet nur darin. Reine Funktionen.
 */
import { normalize } from './derive';

/** So heißt das Blatt überall in Wayfarer. */
export const TABLE_RULES_TITLE = 'Regeln des Tisches';

/** Eine Zeile ohne die Zeichen der Auszeichnung vorn: „## “, „- “, „> “, „1. “. */
function plainLine(line: string): string {
  return line
    .replace(/^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?/, '')
    .replace(/\*\*|__|\[\[|\]\]/g, '')
    .trim();
}

/**
 * Die erste Zeile der Regeln, in der das Suchwort vorkommt – so, wie sie geschrieben ist (ohne
 * die Zeichen der Auszeichnung). null, wenn es nicht vorkommt.
 */
export function rulesLine(text: string, query: string): string | null {
  const q = normalize(query.trim());
  if (!q) return null;
  for (const line of text.split(/\r?\n/)) {
    const plain = plainLine(line);
    if (plain && normalize(plain).includes(q)) return plain;
  }
  return null;
}

/** Steht in den Regeln schon etwas? */
export const hasTableRules = (text: string): boolean => text.trim() !== '';
