/**
 * Die Übersicht der Welt eingrenzen: auf einen Bereich (einen Ort mit allem, was dazugehört) und
 * auf das, was die Gruppe schon kennt. Reine Funktionen.
 */
import { placeAncestors, partyStays } from '../../domain/derive';
import { scopeMembers } from '../../domain/scope';
import type { CampaignData, Entity, Place } from '../../domain/schema';

export { scopeMembers };

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
