/**
 * Dimensionen und Himmelskörper: worin die Orte liegen (Rückmeldung des Spielleiters,
 * 18. 11. 2026: „Wir haben ja Himmelskörper und wir haben Dimensionen. Feenreich. Äther.
 * Materielle Welt“ – und: „das ganze ‚Liegt in‘ stottert“, sobald Planeten keine Orte mehr sind).
 *
 * „Liegt in“ läuft deshalb über die Kategorien hinweg durch, von innen nach außen:
 *   Ort › Orte darüber › Himmelskörper › Dimension
 * - Ein Ort liegt in einem Ort (`place.parentId`).
 * - Ein **oberster** Ort liegt auf einem Himmelskörper oder direkt in einer Dimension
 *   (`place.worldId`) – alles darunter erbt es.
 * - Ein Himmelskörper liegt in einer Dimension (`celestial.dimensionId`).
 * Das ist nur Ordnung: Lage auf der Weltkarte, Klima und Gelände hängen weiter an den Orten.
 * Reine Rechnung.
 */
import { placeAncestors } from './derive';
import type { CampaignData, Celestial, Dimension, Entity, Place } from './schema';

type Data = Pick<CampaignData, 'entities'>;

export type World = Celestial | Dimension;

/** Ein Himmelskörper oder eine Dimension – etwas, worin Orte liegen können. */
export const isWorld = (entity: Entity | undefined | null): entity is World =>
  entity?.kind === 'celestial' || entity?.kind === 'dimension';

/** Die Dimension eines Himmelskörpers – null, wenn keine eingetragen ist oder es sie nicht mehr gibt. */
export function dimensionOf(data: Data, celestial: Celestial): Dimension | null {
  const found = celestial.celestial.dimensionId
    ? data.entities[celestial.celestial.dimensionId]
    : undefined;
  return found?.kind === 'dimension' ? found : null;
}

/** Der oberste Ort über einem Ort – er selbst, wenn nichts darüber liegt. */
function rootOf(data: Data, place: Place): Place {
  const above = placeAncestors(data as CampaignData, place.id);
  return above[above.length - 1] ?? place;
}

/** Der Himmelskörper oder die Dimension, worin ein Ort liegt – geerbt vom obersten Ort darüber. */
export function worldOfPlace(data: Data, place: Place): World | null {
  const root = rootOf(data, place);
  const found = root.place.worldId ? data.entities[root.place.worldId] : undefined;
  return isWorld(found) ? found : null;
}

/**
 * Worin ein Eintrag liegt, von außen nach innen: Dimension, Himmelskörper, die Orte darüber. Für
 * den Pfad über dem Namen. Leer, wenn er nirgends liegt.
 */
export function liesIn(data: Data, entity: Entity): Entity[] {
  if (entity.kind === 'celestial') {
    const dimension = dimensionOf(data, entity);
    return dimension ? [dimension] : [];
  }
  if (entity.kind !== 'place') return [];
  const places = placeAncestors(data as CampaignData, entity.id).reverse();
  const world = worldOfPlace(data, entity);
  if (!world) return places;
  const dimension = world.kind === 'celestial' ? dimensionOf(data, world) : null;
  return [...(dimension ? [dimension] : []), world, ...places];
}

export interface WorldContents {
  /** In einer Dimension: die Himmelskörper darin. */
  celestials: Celestial[];
  /** Die obersten Orte, die unmittelbar hier liegen (keine Räume, keine Orte unter Orten). */
  places: Place[];
}

const byName = (a: Entity, b: Entity) => a.name.localeCompare(b.name, 'de', { numeric: true });

/** Was unmittelbar in einer Dimension oder auf einem Himmelskörper liegt. */
export function worldContents(data: Data, world: World): WorldContents {
  const celestials: Celestial[] = [];
  const places: Place[] = [];
  for (const entity of Object.values(data.entities)) {
    if (
      world.kind === 'dimension' &&
      entity.kind === 'celestial' &&
      entity.celestial.dimensionId === world.id
    )
      celestials.push(entity);
    else if (
      entity.kind === 'place' &&
      entity.place.parentId === null &&
      entity.place.worldId === world.id
    )
      places.push(entity);
  }
  return { celestials: celestials.sort(byName), places: places.sort(byName) };
}

/** Oberste Orte, die noch in keiner Welt liegen – zum Einordnen. */
export function unplacedRoots(data: Data): Place[] {
  return Object.values(data.entities)
    .filter(
      (entity): entity is Place =>
        entity.kind === 'place' &&
        entity.place.parentId === null &&
        !entity.place.room &&
        !isWorld(entity.place.worldId ? data.entities[entity.place.worldId] : undefined),
    )
    .sort(byName);
}
