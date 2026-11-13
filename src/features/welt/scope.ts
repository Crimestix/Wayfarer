/**
 * Die Übersicht der Welt eingrenzen: auf einen Bereich (einen Ort mit allem, was dazugehört) und
 * auf das, was die Gruppe schon kennt. Reine Funktionen.
 */
import { placeAncestors, placeSubtreeIds, partyStays } from '../../domain/derive';
import { isNature, natureOf } from '../../domain/nature';
import type { CampaignData, Entity, Place } from '../../domain/schema';

/**
 * Was zu einem Ort gehört: der Ort mit allen Orten darunter; Personen, die sich dort aufhalten,
 * dort wohnen oder arbeiten; Fraktionen und Familien mit Sitz dort; deren Mitglieder;
 * Gegenstände, die dort oder bei jemandem von dort liegen; und Pflanzen, Tiere und Gesteine, die
 * in einer Gegend darunter oder darüber vorkommen.
 */
export function scopeMembers(data: CampaignData, placeId: string): Set<string> {
  const places = placeSubtreeIds(data, placeId);
  const members = new Set<string>(places);
  const entities = Object.values(data.entities);
  const inPlace = (id: string | null) => id !== null && places.has(id);

  for (const entity of entities) {
    if (entity.kind === 'faction' && inPlace(entity.faction.seatId)) members.add(entity.id);
    if (entity.kind === 'family' && inPlace(entity.family.seatId)) members.add(entity.id);
  }
  for (const entity of entities) {
    if (entity.kind !== 'person') continue;
    const { placeId: at, homeId, workplaceId } = entity.person;
    if (inPlace(at) || inPlace(homeId) || (workplaceId !== null && members.has(workplaceId)))
      members.add(entity.id);
  }
  // Wer zu einer Fraktion von hier gehört, gehört dazu; eine Familie, sobald ein Mitglied hier ist.
  const groups = new Set(
    entities.filter((e) => e.kind === 'faction' || e.kind === 'family').map((e) => e.id),
  );
  for (const relation of Object.values(data.relations)) {
    if (relation.ended || relation.type !== 'member') continue;
    const [personId, groupId] = groups.has(relation.to)
      ? [relation.from, relation.to]
      : groups.has(relation.from)
        ? [relation.to, relation.from]
        : [null, null];
    if (!personId || !groupId) continue;
    const group = data.entities[groupId];
    if (group?.kind === 'faction' && members.has(groupId)) members.add(personId);
    if (group?.kind === 'family' && members.has(personId)) members.add(groupId);
  }
  for (const entity of entities)
    if (entity.kind === 'item' && entity.item.holderId && members.has(entity.item.holderId))
      members.add(entity.id);
  // Pflanzen, Tiere und Gesteine, die hier vorkommen: in einer Gegend darunter oder darüber.
  const around = new Set([...places, ...placeAncestors(data, placeId).map((p) => p.id)]);
  for (const entity of entities)
    if (isNature(entity) && natureOf(entity).regionIds.some((id) => around.has(id)))
      members.add(entity.id);
  return members;
}

/**
 * Die Bereiche, die sich am Tisch anbieten: der Ort der Gruppe und die Orte darüber, vom
 * nächsten zum weitesten. Ein eigens gewählter Bereich, der nicht dazugehört, steht am Ende.
 */
export function scopeChoices(data: CampaignData, chosenId: string | null): Place[] {
  const out: Place[] = [];
  const partyPlace = data.state.placeId ? data.entities[data.state.placeId] : undefined;
  if (partyPlace?.kind === 'place') out.push(partyPlace, ...placeAncestors(data, partyPlace.id));
  const chosen = chosenId ? data.entities[chosenId] : undefined;
  if (chosen?.kind === 'place' && !out.some((p) => p.id === chosen.id)) out.push(chosen);
  return out;
}

/** Orte, an denen die Gruppe schon war – samt den Orten darüber. */
export function visitedPlaces(data: CampaignData): Set<string> {
  const visited = new Set<string>();
  const add = (placeId: string) => {
    if (visited.has(placeId)) return;
    visited.add(placeId);
    for (const ancestor of placeAncestors(data, placeId)) visited.add(ancestor.id);
  };
  for (const stay of partyStays(data)) add(stay.placeId);
  if (data.state.placeId) add(data.state.placeId);
  return visited;
}

/**
 * Kennt die Gruppe diesen Eintrag? Personen: getroffen. Orte: besucht. Alles andere gilt als
 * bekannt – dafür führt Wayfarer kein eigenes Merkmal.
 */
export function isKnown(entity: Entity, visited: ReadonlySet<string>): boolean {
  if (entity.kind === 'person') return entity.person.met;
  if (entity.kind === 'place') return visited.has(entity.id);
  return true;
}

export interface WorldView {
  /** Ort, auf den die Übersicht eingegrenzt ist; null = die ganze Welt. */
  scopeId: string | null;
  /** Nur zeigen, was die Gruppe kennt. */
  knownOnly: boolean;
}

/** Die Einträge, die bei dieser Eingrenzung zu sehen sind; null = alle. */
export function visibleIds(data: CampaignData, view: WorldView): Set<string> | null {
  const scope =
    view.scopeId && data.entities[view.scopeId]?.kind === 'place'
      ? scopeMembers(data, view.scopeId)
      : null;
  if (!scope && !view.knownOnly) return null;
  const visited = view.knownOnly ? visitedPlaces(data) : null;
  const out = new Set<string>();
  for (const entity of Object.values(data.entities)) {
    if (scope && !scope.has(entity.id)) continue;
    if (visited && !isKnown(entity, visited)) continue;
    out.add(entity.id);
  }
  return out;
}
