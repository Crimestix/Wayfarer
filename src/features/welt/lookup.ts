/**
 * Nachschlagen (F07): Wer beim Arbeiten einen Namen anklickt, will kurz wissen, wer oder was das
 * ist – nicht die ganze Seite. Das Seitenblatt zeigt deshalb zuerst den Anfang des Textes (ohne
 * Geheimes und ohne Steckbrief, der steht schon darüber) und öffnet die volle Seite nur auf Wunsch.
 */
import { articleParts, plainMarkdown, withoutSecrets } from '../../domain/articleText';

/** Höchstens so viele Zeichen vom Anfang des Textes. */
export const LEAD_CHARS = 420;

/**
 * Der erste Absatz des Textes in einfachen Worten: Überschriften, Kästen und Bilder fallen weg,
 * Geheimes auch. Zu lang wird an einer Wortgrenze gekürzt („…“). Leer, wenn nichts dasteht.
 */
export function leadOf(text: string, max = LEAD_CHARS): string {
  if (!text.trim()) return '';
  const body = articleParts(withoutSecrets(text)).body;
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split('\n')
        .filter((line) => !/^\s*(#|>|!\[|---|\|)/.test(line))
        .join(' ')
        .trim(),
    )
    .filter(Boolean);
  const first = plainMarkdown(paragraphs[0] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:–-]+$/, '')} …`;
}
