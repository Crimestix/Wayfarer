/**
 * Vorlagen durch Merken (Konzeptbesprechung 16. 11., nach dem Vorbild der Läden): Der
 * Spielleiter schreibt eine Seite einmal so, wie er sie will, und merkt sie sich als Vorlage für
 * sein Wort („Taverne“). Beim nächsten Ding dieser Kategorie mit diesem Wort bietet Wayfarer die
 * eigene Vorlage an. Kein Baukasten, keine mitgelieferten Vorlagen – nur seine eigenen Seiten.
 *
 * Aus der Seite bleibt die Form: Steckbrief-Zeilen ohne Wert, Überschriften, Kästen ohne Inhalt
 * und eigene Fragen (Zeilen, die mit „?“ enden) – Fragen sind Inspiration, nie Pflicht.
 */
import { SUGGESTION, isDismissed } from './dismiss';
import type { CampaignData, CampaignMeta, EntityKind } from './schema';

/** Ein Wort vergleicht sich ohne Groß- und Kleinschreibung und ohne doppelte Leerzeichen. */
export const wordKey = (word: string): string =>
  word.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');

/** Der Schlüssel einer Vorlage: Kategorie und Wort. */
export const templateKey = (kind: EntityKind, word: string): string => `${kind}:${wordKey(word)}`;

/**
 * Die Form einer Seite als Vorlage: Steckbrief-Zeilen behalten ihre Bezeichnung, verlieren den
 * Wert; Überschriften und die Kopfzeilen von Kästen bleiben; eigene Fragen bleiben; alles andere
 * (der eigentliche Text) fällt weg. Leerzeilen höchstens einzeln.
 */
export function templateOfText(text: string): string {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    let keep: string | null = null;
    if (/^#{1,6}\s+\S/.test(line)) keep = line;
    else if (/^>\s*\[!.+\]/.test(line)) keep = line.replace(/^(>\s*\[![^\]]+\]).*$/, '$1');
    else if (/^>\s*[^:>\n]{1,60}:/.test(line)) keep = line.replace(/^(>\s*[^:]{1,60}:).*$/, '$1 ');
    else if (/\?\s*$/.test(line) && line.trim().length <= 200) keep = line.trim();
    if (keep === null) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    out.push(keep);
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  while (out.length && out[0] === '') out.shift();
  return out.join('\n');
}

/** Hat die Seite überhaupt eine Form, die sich zu merken lohnt? */
export const hasTemplateForm = (text: string): boolean => templateOfText(text).trim() !== '';

/** Die eigene Vorlage für Kategorie und Wort – null, wenn es keine gibt. */
export function templateFor(
  campaign: Pick<CampaignMeta, 'pageTemplates'>,
  kind: EntityKind,
  word: string,
): { word: string; text: string } | null {
  if (!wordKey(word)) return null;
  return campaign.pageTemplates[templateKey(kind, word)] ?? null;
}

/** Die eigenen Vorlagen einer Kategorie, nach Wort sortiert. */
export function templatesOfKind(
  campaign: Pick<CampaignMeta, 'pageTemplates'>,
  kind: EntityKind,
): { key: string; word: string; text: string }[] {
  return Object.entries(campaign.pageTemplates)
    .filter(([, entry]) => entry.kind === (kind as string))
    .map(([key, entry]) => ({ key, word: entry.word, text: entry.text }))
    .sort((a, b) => a.word.localeCompare(b.word, 'de'));
}

/**
 * Leise Leitfragen je Kategorie – eine Form, nie ein Inhalt aus einer Welt. Sie stehen am Rand
 * einer Seite, sind wegklickbar und verschwinden, sobald die Seite eigene Fragen hat.
 */
export const KIND_QUESTIONS: Partial<Record<EntityKind, readonly string[]>> = {
  place: ['Wovon leben die Leute hier?', 'Was sieht man zuerst, wenn man ankommt?'],
  person: ['Was will diese Person – und was hält sie davon ab?', 'Woran erkennt man sie am Tisch?'],
  faction: ['Was will die Fraktion, das sie noch nicht hat?', 'Wem steht sie im Weg?'],
  family: ['Worauf ist das Haus stolz – und was verschweigt es?'],
  item: ['Wer hat das gemacht, und warum?', 'Wer sucht danach?'],
  deity: ['Was verlangt sie von ihren Anhängern?', 'Wo spürt man sie im Alltag?'],
  realm: ['Wer herrscht wirklich?', 'Woran zerbricht es, wenn niemand eingreift?'],
  happening: ['Wer hat davon profitiert?', 'Was merkt man heute noch davon?'],
  topic: ['Wer glaubt daran, und wer nicht?'],
  species: ['Wie leben sie, und was fürchten sie?'],
};

/**
 * Die Leitfragen, die am Rand einer Seite stehen: die der Kategorie ohne weggeklickte – keine,
 * sobald im Text der Seite eigene Fragen stehen (dann hat der Spielleiter seine eigenen).
 */
export function pageQuestions(
  data: Pick<CampaignData, 'state'>,
  kind: EntityKind,
  text: string,
): string[] {
  const own = text.split('\n').some((line) => /\?\s*$/.test(line) && !/^>\s*\S[^:]*:/.test(line));
  if (own) return [];
  return (KIND_QUESTIONS[kind] ?? []).filter(
    (question) => !isDismissed(data, SUGGESTION.question(kind, question)),
  );
}
