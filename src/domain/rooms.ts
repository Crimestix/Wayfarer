/**
 * Räume: Orte, die zu einem Ort darüber gehören (Festung, Verlies, Haus) und deshalb nicht einzeln
 * in der Welt und im Wiki stehen, sondern auf der Seite des Ortes darüber. Reine Funktionen.
 */
import type { CampaignData, Entity, Place } from './schema';

export const isRoom = (entity: Entity | undefined): entity is Place =>
  entity?.kind === 'place' && entity.place.room;

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
    if (isRoom(entity) && entity.lk?.resourceId) out.add(entity.lk.resourceId);
  return out;
}

/** Wörter der Art, an denen man einen Raum erkennt („Dungeonraum“, „Kammer“ …). */
const ROOM_WORDS = /(raum|räume|kammer|halle|zelle|gewölbe|gruft|kerker|stube|saal|keller)/i;

/** Orte unter diesem Ort, die wie Räume aussehen, aber noch keine sind – zum einmaligen Umwandeln. */
export function roomCandidates(data: Pick<CampaignData, 'entities'>, placeId: string): Place[] {
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
