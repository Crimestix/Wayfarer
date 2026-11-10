/**
 * Was das Wiki zum Ort der Gruppe beiträgt: der Artikel, ein Auszug daraus und die Karte, auf
 * der die Gruppe gerade steht. Reine Funktionen.
 */
import { placeAncestors } from '../../domain/derive';
import type { Article, CampaignData, GameMap, MapMarker, Place } from '../../domain/schema';
import { pageNodes } from '../wiki/text';

type Raw = Record<string, unknown>;
const isRaw = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Der Artikel, der zu einem Eintrag gehört – wenn er im eigenen Wiki liegt. */
export function articleOf(
  data: CampaignData,
  entity: { lk: { resourceId: string } | null } | null | undefined,
): Article | null {
  return (entity?.lk && data.articles[entity.lk.resourceId]) || null;
}

/** Fließtext eines Absatzes, ohne Auszeichnung. */
function inlineText(inlines: unknown): string {
  return (Array.isArray(inlines) ? inlines : [])
    .map((part) =>
      isRaw(part)
        ? part.type === 'break'
          ? ' '
          : typeof part.text === 'string'
            ? part.text
            : typeof part.label === 'string'
              ? part.label
              : ''
        : '',
    )
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Excerpt {
  /** Die ersten Absätze des Artikels. */
  paragraphs: string[];
  /** Der Artikel hat mehr Text, als hier steht. */
  more: boolean;
}

/**
 * Der Anfang eines Artikels zum schnellen Überfliegen am Tisch: die ersten Absätze der ersten
 * Textseite, bis `maxChars` erreicht sind. Überschriften, Listen und Kästen bleiben dem Artikel
 * selbst vorbehalten; Abschnitte nur für die Spielleitung gehören nicht in den Auszug.
 */
export function articleExcerpt(
  articles: CampaignData['articles'],
  article: Article,
  maxChars = 520,
  maxParagraphs = 3,
): Excerpt {
  const page = article.docs.find((doc) => doc.kind === 'page');
  const nodes = page ? pageNodes(articles, article, page) : [];
  const all = nodes
    .filter((node) => node.type === 'paragraph')
    .map((node) => inlineText(node.inlines))
    .filter(Boolean);
  const paragraphs: string[] = [];
  let used = 0;
  for (const text of all) {
    if (paragraphs.length >= maxParagraphs) break;
    const room = maxChars - used;
    if (room < 60 && paragraphs.length) break;
    if (text.length <= room) {
      paragraphs.push(text);
      used += text.length;
      continue;
    }
    // Der Absatz ist zu lang: am letzten Satzende kürzen, sonst an einem Wort.
    const cut = text.slice(0, Math.max(room, 60));
    const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    const end = sentence > cut.length * 0.5 ? sentence + 1 : cut.lastIndexOf(' ');
    paragraphs.push(`${cut.slice(0, end > 0 ? end : cut.length).trimEnd()} …`);
    used = maxChars;
    break;
  }
  const shownAll =
    paragraphs.length === all.length && !paragraphs[paragraphs.length - 1]?.endsWith(' …');
  // Der Steckbrief zählt nicht als „mehr Text“ – er steht ohnehin im Artikel daneben.
  const otherContent =
    nodes.filter((node) => node.type !== 'infobox').length > all.length ||
    article.docs.filter((doc) => doc.kind === 'page').length > 1;
  return { paragraphs, more: !shownAll || otherContent };
}

export interface PlaceMap {
  map: GameMap;
  /** Der Ort, den die Karte zeigt. */
  of: Place;
  /** Die Karte zeigt den Ort der Gruppe selbst – nicht nur seine Umgebung. */
  own: boolean;
  /** Der Punkt, an dem die Gruppe auf dieser Karte steht, wenn er eingetragen ist. */
  marker: MapMarker | null;
}

const mapsOf = (data: CampaignData, placeId: string): GameMap[] =>
  Object.values(data.maps)
    .filter((map) => map.placeId === placeId && map.image && map.frame)
    .sort((a, b) => b.markers.length - a.markers.length || a.name.localeCompare(b.name, 'de'));

/**
 * Die Karten, die am Ort der Gruppe weiterhelfen, die nächste zuerst: die Karte des Ortes selbst,
 * dann die der Orte darüber. Auf einer Karte der Umgebung ist der Punkt markiert, der zum Ort der
 * Gruppe führt – oder zu dem Ort darüber, der auf dieser Karte eingetragen ist.
 */
export function placeMaps(data: CampaignData, place: Place): PlaceMap[] {
  const out: PlaceMap[] = [];
  for (const map of mapsOf(data, place.id)) out.push({ map, of: place, own: true, marker: null });
  // Vom Ort der Gruppe aufwärts: Wer davon auf der Karte steht, ist „hier“.
  const below: string[] = [place.id];
  for (const ancestor of placeAncestors(data, place.id)) {
    for (const map of mapsOf(data, ancestor.id)) {
      const marker =
        below
          .map((id) => map.markers.find((m) => m.entityId === id))
          .find((m): m is MapMarker => m !== undefined) ?? null;
      out.push({ map, of: ancestor, own: false, marker });
    }
    below.push(ancestor.id);
  }
  return out;
}
