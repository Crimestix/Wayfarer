/**
 * Die Backstory eines Gefährten (Konzeptbesprechung 16. 11.: „Die Backstory trägt der
 * Spielleiter als Text ein“). Wayfarer zerlegt sie nur in Absätze, damit der Spielleiter einzelne
 * Stücke als Haken für Geschichten aufs Fadenbrett holen kann – welche, entscheidet er.
 */

/**
 * Die Absätze einer Backstory: getrennt an Leerzeilen; steht alles ohne Leerzeile da, zählt jede
 * Zeile für sich. Leere Stücke fallen weg.
 */
export function backstoryParts(text: string): string[] {
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (!clean) return [];
  const blocks = clean.split(/\n\s*\n/);
  const parts = blocks.length > 1 ? blocks : clean.split('\n');
  return parts.map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Höchstens so lang ist die Überschrift einer Karte aus einem Absatz. */
const TITLE_MAX = 70;

/**
 * Die Überschrift einer Karte aus einem Stück Text: der erste Satz, gekürzt an einer Wortgrenze,
 * wenn er zu lang ist. Formuliert wird nichts – es sind immer die Worte des Spielleiters.
 */
export function cardTitleOf(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  const sentence = clean.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? clean;
  if (sentence.length <= TITLE_MAX) return sentence;
  const cut = sentence.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(' ');
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[,;:–-]+$/, '')} …`;
}
