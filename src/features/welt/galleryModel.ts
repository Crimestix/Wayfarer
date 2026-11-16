/**
 * Die Galerie einer Art – dieselbe Ansicht, die die Personen haben, für jede Art der Welt
 * (Wunsch des Spielleiters, 16. 11. 2026: „Wir brauchen die gleiche Ansicht von Personen für
 * alle Ordnerarten“). Suche, Ort, Bekanntheit (nur wo Wayfarer sie kennt: Personen, Orte) und
 * die Vergangenheit für sich. Reine Rechnung.
 */
import {
  entitiesOfKind,
  entityName,
  personPlace,
  placeAncestors,
  searchEntities,
} from '../../domain/derive';
import { scopeMembers } from '../../domain/scope';
import type { CampaignData, Entity } from '../../domain/schema';
import {
  galleryPeople,
  isWorldEntity,
  type GalleryFilter,
  type WorldEntity,
  type WorldKind,
} from './model';
import { isKnown, visitedPlaces } from './scope';

/** Ob die Galerie dieser Art nach „bekannt“ trennen kann – nur dort, wo Wayfarer es weiß. */
export const knowsKnown = (kind: WorldKind): boolean => kind === 'person' || kind === 'place';

/** Die Einträge einer Art für die Galerie, nach Namen. */
export function galleryEntries(
  data: CampaignData,
  kind: WorldKind,
  filter: GalleryFilter,
): WorldEntity[] {
  if (kind === 'person') return galleryPeople(data, filter);
  const pool: Entity[] =
    filter.query.trim() !== ''
      ? searchEntities(data, filter.query, { kinds: [kind], limit: 1000 })
      : entitiesOfKind(data, kind);
  const scope = filter.placeId ? scopeMembers(data, filter.placeId) : null;
  const visited = filter.known !== 'all' && knowsKnown(kind) ? visitedPlaces(data) : null;
  return pool
    .filter(isWorldEntity)
    .filter((entity) => entity.kind === kind)
    .filter((entity) => !scope || (scope.has(entity.id) && entity.id !== filter.placeId))
    .filter((entity) => !visited || isKnown(data, entity, visited) === (filter.known === 'known'))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Die zweite Zeile einer Karte: wo es ist oder wem es gehört – leer, wenn nichts bekannt ist. */
export function galleryWhere(data: CampaignData, entity: Entity): string {
  switch (entity.kind) {
    case 'person': {
      const at = personPlace(data, entity);
      return at ? entityName(data, at) : 'Aufenthalt unbekannt';
    }
    case 'place': {
      const above = placeAncestors(data, entity.id)[0];
      return above ? `in ${above.name}` : '';
    }
    case 'faction':
      return entity.faction.seatId ? entityName(data, entity.faction.seatId) : '';
    case 'family':
      return entity.family.seatId ? entityName(data, entity.family.seatId) : '';
    case 'item':
      return entity.item.holderId ? entityName(data, entity.item.holderId) : '';
    default:
      return '';
  }
}
