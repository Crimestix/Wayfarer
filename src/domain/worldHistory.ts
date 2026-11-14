/**
 * Was in der Welt ein Datum hat, ohne dass die Gruppe dabei war: Lebensdaten, Daten im Text der
 * Artikel, Termine und Einträge vor der ersten Session. Daraus legt die Zeitleiste die Bahn
 * „Geschichte der Welt“ (`laneOf(data, 'history')` in `domain/timeline.ts`).
 *
 * Aus einem Artikel nimmt Wayfarer nur den Satz, in dem das Datum steht – wörtlich, höchstens
 * gekürzt. Es formuliert nichts. Ein Datum ohne Jahr („am 3. Tauwind“) gehört zu keinem Jahr und
 * fehlt; ebenso der Steckbrief, dessen Lebensdaten schon am Eintrag stehen. Reine Funktionen.
 */
import { articleParts, plainMarkdown } from './articleText';
import { sessionSpans } from './history';
import type { Article, CampaignData } from './schema';
import type { CalendarDef, WorldTime } from './time/calendar';
import { findDates, type TextDate } from './time/textDates';

/**
 * Wann die Kampagne begann: der Beginn der ersten Session. Ohne Session ist alles bis heute
 * Vorgeschichte.
 */
export function campaignStart(data: CampaignData): WorldTime {
  let start = data.state.now;
  for (const span of sessionSpans(data)) start = Math.min(start, span.from);
  return start;
}

/** So lang wird ein Satz aus einem Artikel höchstens – länger wird er um das Datum herum gekürzt. */
export const SENTENCE_MAX = 160;

/** Kurze Wörter mit Punkt, die keinen Satz beenden. */
const ABBREVIATION = /(?:^|[\s(„"])(?:\p{L}|ca|bzw|usw|etc|Nr|St|Hl|ggf|vgl|evtl|sog|Jh|Jhd)$/iu;

/** Endet bei `i` (einem Satzzeichen) ein Satz? */
function endsSentence(text: string, i: number): boolean {
  const ch = text[i];
  if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…') return false;
  const after = text.slice(i + 1);
  // Danach Ende der Zeile, oder Leerraum und ein neuer Satz (Großbuchstabe, Ziffer, Anführung).
  if (after.trim() && !/^[\s"“”»«)']*(?:\s+[\p{Lu}\d„"»«(]|$)/u.test(after)) return false;
  if (ch !== '.') return true;
  const before = text.slice(Math.max(0, i - 8), i);
  // „am 3. Tauwind“: eine Ordnungszahl, kein Satzende.
  if (/(?:^|[^\p{L}\p{N}])\d{1,2}$/u.test(before)) return false;
  return !ABBREVIATION.test(before);
}

/**
 * Der Satz um eine Stelle eines Textes – wörtlich, ohne Zeilenumbrüche, höchstens `max` Zeichen:
 * Ist er länger, bleibt das Stück um die Stelle, mit „…“ an den Schnitten.
 */
export function sentenceAround(text: string, from: number, to: number, max = SENTENCE_MAX): string {
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  const lineEnd = text.indexOf('\n', to);
  const line = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
  const a = from - lineStart;
  const b = to - lineStart;
  let start = 0;
  for (let i = a - 1; i >= 0; i--)
    if (endsSentence(line, i)) {
      start = i + 1;
      break;
    }
  let end = line.length;
  for (let i = b; i < line.length; i++)
    if (endsSentence(line, i)) {
      end = i + 1;
      break;
    }
  const raw = line.slice(start, end);
  const lead = raw.length - raw.trimStart().length;
  const sentence = raw.trim().replace(/^[-*+]\s+|^\d+\.\s+/, '');
  if (sentence.length <= max) return sentence;
  // Um das Datum herum kürzen.
  const offset = start + lead + (raw.trim().length - sentence.length);
  const da = Math.max(0, a - offset);
  const db = Math.max(da, b - offset);
  const room = Math.max(0, max - (db - da));
  let left = Math.max(0, da - Math.floor(room / 2));
  const right = Math.min(sentence.length, left + max);
  left = Math.max(0, right - max);
  const cut = (s: string, from: number, to: number) => {
    let piece = s.slice(from, to);
    // An Wortgrenzen schneiden.
    if (from > 0) piece = piece.replace(/^\S*\s/, '');
    if (to < s.length) piece = piece.replace(/\s\S*$/, '');
    return piece.trim();
  };
  return `${left > 0 ? '… ' : ''}${cut(sentence, left, right)}${right < sentence.length ? ' …' : ''}`;
}

/** Ein Datum aus dem Text eines Artikels – mit seinem Satz. */
export interface ArticleDate {
  articleId: string;
  docId: string;
  /** Laufende Nummer im Artikel – für einen beständigen Schlüssel. */
  index: number;
  at: WorldTime;
  precision: TextDate['precision'];
  sentence: string;
}

const cache = new WeakMap<Article, { cal: CalendarDef; dates: ArticleDate[] }>();

/**
 * Die Daten im Text eines Artikels mit Jahr, je mit dem Satz, in dem sie stehen. Der Steckbrief
 * fehlt (seine Lebensdaten stehen am Eintrag), Vorlagen auch.
 */
export function articleDates(cal: CalendarDef, article: Article): ArticleDate[] {
  if (article.template) return [];
  const hit = cache.get(article);
  if (hit && hit.cal === cal) return hit.dates;
  const dates: ArticleDate[] = [];
  for (const doc of article.docs) {
    if (doc.kind !== 'page' || !/\d/.test(doc.text)) continue;
    const text = plainMarkdown(articleParts(doc.text).body);
    for (const found of findDates(cal, text, 0)) {
      if (found.assumedYear) continue;
      const sentence = sentenceAround(text, found.from, found.to);
      if (!sentence) continue;
      dates.push({
        articleId: article.id,
        docId: doc.id,
        index: dates.length,
        at: found.time,
        precision: found.precision,
        sentence,
      });
    }
  }
  cache.set(article, { cal, dates });
  return dates;
}

/** Alle Daten aus den Texten aller Artikel. */
export function worldTextDates(data: CampaignData): ArticleDate[] {
  const cal = data.campaign.calendar;
  return Object.values(data.articles).flatMap((article) => articleDates(cal, article));
}
