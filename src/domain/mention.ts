/**
 * Erwähnungen mit „@“ in einem Textfeld: Tippt der Spielleiter „@“, schlägt Wayfarer Einträge der
 * Welt vor; der gewählte Name bleibt als gewöhnlicher Text stehen – kein Sonderzeichen. Genutzt
 * von der Mitschrift am Spieltisch und den Textfeldern der Blätter (`ui/mention.tsx`).
 */

export interface MentionRange {
  /** Position des „@“. */
  start: number;
  /** Position der Schreibmarke. */
  end: number;
  /** Was nach dem „@“ getippt wurde. */
  query: string;
}

/** Zeichen, nach denen ein „@“ einen Verweis beginnt (Wortanfang) – nicht mitten im Wort. */
const MENTION_LEAD = /[\s(„“"'»›–—\-/:;,.!?]/;

/**
 * Tippt die Spielleitung gerade einen Verweis? Liefert den Bereich vom „@“ bis zur Schreibmarke.
 * Ein Leerzeichen am Ende beendet den Verweis, damit „@“ den Text nicht dauerhaft festhält.
 */
export function activeMention(text: string, caret: number): MentionRange | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf('@');
  if (start < 0) return null;
  if (start > 0 && !MENTION_LEAD.test(before[start - 1]!)) return null;
  const query = before.slice(start + 1);
  if (query.length > 40 || /\n/.test(query) || /^\s/.test(query) || /\s$/.test(query)) return null;
  if (query.split(/\s+/).length > 4) return null;
  return { start, end: caret, query };
}

/** Ersetzt „@getippt“ durch den Namen des gewählten Eintrags. */
export function insertMention(
  text: string,
  range: MentionRange,
  name: string,
): { text: string; caret: number } {
  const after = text.slice(range.end);
  const spacer = /^[\s.,;:!?)]/.test(after) ? '' : ' ';
  return {
    text: text.slice(0, range.start) + name + spacer + after,
    caret: range.start + name.length + spacer.length,
  };
}

export interface Mention {
  id: string;
  name: string;
}

/**
 * Gewählte Verweise, deren Name noch im Text steht – in der Reihenfolge der Wahl, ohne Doppelte.
 * Mit `exists` fällt weg, wen es nicht mehr gibt (ein eben angelegter Eintrag, dessen Anlegen
 * zurückgenommen wurde): Der Name bleibt Text, verknüpft wird er nicht.
 */
export function keptMentions(
  text: string,
  mentions: Mention[],
  exists?: (id: string) => boolean,
): Mention[] {
  const seen = new Set<string>();
  return mentions.filter((m) => {
    if (seen.has(m.id) || !text.includes(m.name) || (exists && !exists(m.id))) return false;
    seen.add(m.id);
    return true;
  });
}
