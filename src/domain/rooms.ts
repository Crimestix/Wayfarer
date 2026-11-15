/**
 * Räume: Orte, die zu einem Ort darüber gehören (Festung, Verlies, Haus) und deshalb nicht einzeln
 * in der Welt und im Wiki stehen, sondern auf der Seite des Ortes darüber. Reine Funktionen.
 */
import { SUGGESTION } from './dismiss';
import type { CampaignData, Entity, Place } from './schema';

/** So viel Text zeigt ein aufgeklappter Raum; der Rest steht auf seiner Seite. */
export const ROOM_TEXT_MAX = 700;

/**
 * Was zu einem Raum geschrieben steht: die Notizen – sonst der Text seines Artikels (Räume aus
 * LegendKeeper), ohne Kästen wie den Steckbrief, gekürzt.
 */
export function roomText(data: Pick<CampaignData, 'articles'>, room: Place): string {
  if (room.notes.trim()) return room.notes.trim();
  const article = room.lk?.resourceId ? data.articles[room.lk.resourceId] : undefined;
  if (!article) return '';
  const text = article.docs
    .map((doc) => doc.text)
    .join('\n\n')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > ROOM_TEXT_MAX ? `${text.slice(0, ROOM_TEXT_MAX).trimEnd()} …` : text;
}

/**
 * Ein Raum, der auf der Seite seines Ortes steht. Gibt es den Ort darüber nicht (mehr) – gelöscht,
 * ganz oben, von Hand gelöst –, steht er für sich, damit er nirgends verloren geht.
 */
export function isRoom(data: Pick<CampaignData, 'entities'>, entity: Entity | undefined): boolean {
  if (entity?.kind !== 'place' || !entity.place.room || !entity.place.parentId) return false;
  return data.entities[entity.place.parentId]?.kind === 'place';
}

const natural = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** Die Räume eines Ortes, nach Namen („2 Halle“ vor „10 Gruft“). */
export function roomsOf(data: Pick<CampaignData, 'entities'>, placeId: string): Place[] {
  return Object.values(data.entities)
    .filter(
      (entity): entity is Place =>
        entity.kind === 'place' && entity.place.room && entity.place.parentId === placeId,
    )
    .sort((a, b) => natural.compare(a.name, b.name));
}

/** Die Artikel der Räume – sie stehen nicht im Baum des Wikis. */
export function roomArticleIds(data: Pick<CampaignData, 'entities'>): Set<string> {
  const out = new Set<string>();
  for (const entity of Object.values(data.entities))
    if (isRoom(data, entity) && entity.lk?.resourceId) out.add(entity.lk.resourceId);
  return out;
}

/** Wörter der Art, an denen man einen Raum erkennt („Dungeonraum“, „Kammer“ …). */
const ROOM_WORDS = /(raum|räume|kammer|halle|zelle|gewölbe|gruft|kerker|stube|saal|keller)/i;

/** Orte unter diesem Ort, die wie Räume aussehen, aber noch keine sind – zum einmaligen Umwandeln. */
export function roomCandidates(
  data: Pick<CampaignData, 'entities'> & Partial<Pick<CampaignData, 'state'>>,
  placeId: string,
): Place[] {
  // „Passt nicht“ am Ort weggeklickt: kein Vorschlag mehr für ihn.
  if (data.state?.dismissed.includes(SUGGESTION.room(placeId))) return [];
  return Object.values(data.entities).filter(
    (entity): entity is Place =>
      entity.kind === 'place' &&
      !entity.place.room &&
      entity.place.parentId === placeId &&
      ROOM_WORDS.test(entity.place.category),
  );
}

export interface RoomLine {
  name: string;
  /** Was nach einem Gedankenstrich oder Doppelpunkt steht: die kurze Beschreibung. */
  tagline: string;
}

/** Mehrere Räume auf einmal: eine Zeile je Raum, „1 Eingangshalle – eingestürzt“. */
export function parseRoomLines(text: string): RoomLine[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ...rest] = line.split(/\s+[–—-]\s+|:\s+/);
      return { name: name!.trim(), tagline: rest.join(' – ').trim() };
    })
    .filter((line) => line.name);
}
