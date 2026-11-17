/**
 * Suchen beim Hinlegen (Wunsch des Spielleiters, 17. 11. 2026: „Wenn ich etwas auf das Brett
 * bringen möchte, muss ich beim Doppelklick aufs leere Brett Artikel suchen können“): Was beim
 * Tippen im Feld des Doppelklicks dasteht und was die Eingabetaste nimmt. Reine Funktionen.
 */
import type { CampaignData, Entity } from '../../domain/schema';
import { searchWorld } from '../../shell/search';

/** Ein Fund beim Doppelklick ins Leere: was sich aufs Brett holen lässt. */
export interface BoardFind {
  /** Der Schlüssel auf dem Brett: `node:`, `article:`, `story:`, `thread:`. */
  key: string;
  label: string;
  sub: string;
  sort: 'entity' | 'article' | 'story' | 'thread';
  entity: Entity | null;
}

/** So viele Funde zeigt das Feld höchstens – nie eine endlose Liste. */
export const BOARD_FINDS = 7;

const BOARD_SORTS = new Set<string>(['entity', 'article', 'story', 'thread']);

/**
 * Was beim Tippen dasteht: Einträge der Welt, Artikel (auch ohne Eintrag), Geschichten und
 * Fäden – über die Suche der App (`searchWorld`), ohne Gefährten und anderes, das nicht aufs
 * Brett gehört.
 */
export function boardFinds(data: CampaignData, text: string): BoardFind[] {
  const query = text.replace(/\s+/g, ' ').trim();
  if (!query) return [];
  return searchWorld(data, query)
    .filter((hit) => BOARD_SORTS.has(hit.sort) && hit.entity?.kind !== 'character')
    .slice(0, BOARD_FINDS)
    .map((hit) => ({
      key: hit.entity ? `node:${hit.entity.id}` : hit.key,
      label: hit.label,
      sub: hit.sub,
      sort: hit.sort as BoardFind['sort'],
      entity: hit.entity ?? null,
    }));
}

const nameKey = (name: string): string =>
  name.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');

/**
 * Der Fund, den die Eingabetaste nimmt: nur einer, der genau so heißt (Name oder Zweitname, ohne
 * Groß- und Kleinschreibung und doppelte Leerzeichen) – nie ein ähnlicher. -1 = keiner, dann
 * entsteht Neues.
 */
export function exactFind(finds: readonly BoardFind[], text: string): number {
  const key = nameKey(text);
  if (!key) return -1;
  return finds.findIndex(
    (find) =>
      nameKey(find.label) === key ||
      (find.entity?.aliases ?? []).some((alias) => nameKey(alias) === key),
  );
}
