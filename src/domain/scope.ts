/**
 * Was zu einem Ort gehört – für die Eingrenzung der Welt auf einen Bereich und für die Auswahl
 * eines Buches nach Gegenden. Reine Funktionen.
 */
import { placeAncestors, placeSubtreeIds } from './derive';
import { isNature, natureAt, natureOf } from './nature';
import type { CampaignData } from './schema';

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
  // Pflanzen, Tiere und Gesteine, die hier vorkommen: in einer Gegend darunter oder darüber –
  // oder, wie am Spieltisch, weil ihr Lebensraum zum Ort passt (übers ganze Jahr).
  const around = new Set([...places, ...placeAncestors(data, placeId).map((p) => p.id)]);
  for (const entity of entities)
    if (isNature(entity) && natureOf(entity).regionIds.some((id) => around.has(id)))
      members.add(entity.id);
  for (const hit of natureAt(data, { placeId, allYear: true })) members.add(hit.entity.id);
  return members;
}
