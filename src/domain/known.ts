/**
 * Kennt die Gruppe eine Person? Getroffen (`person.met`, gesetzt über „Begegnung“ oder von Hand)
 * – oder die Person hat eine Haltung zur Gruppe oder zu einem Gefährten. Rückmeldung des
 * Spielleiters (16. 11. 2026): „Wenn eine Person eine Haltung gegenüber der Gruppe hat, kennt die
 * Gruppe diese Person natürlich.“ Gefragt wird immer hierüber, nie über `person.met` direkt.
 * Reine Rechnung.
 */
import { PARTY_ID, type CampaignData, type Entity } from './schema';

/** Personen mit einer Haltung zur Gruppe oder zu einem Gefährten – je Stand der Beziehungen. */
const stanceCache = new WeakMap<object, Set<string>>();

function withStance(data: Pick<CampaignData, 'entities' | 'relations'>): Set<string> {
  const cached = stanceCache.get(data.relations);
  if (cached) return cached;
  const out = new Set<string>();
  for (const relation of Object.values(data.relations)) {
    if (relation.ended || relation.attitude === null) continue;
    if (relation.to !== PARTY_ID && data.entities[relation.to]?.kind !== 'character') continue;
    out.add(relation.from);
  }
  stanceCache.set(data.relations, out);
  return out;
}

/** Hat die Person eine Haltung zur Gruppe oder zu einem Gefährten? Dann kennt die Gruppe sie. */
export function hasStance(
  data: Pick<CampaignData, 'entities' | 'relations'>,
  personId: string,
): boolean {
  return withStance(data).has(personId);
}

/** Kennt die Gruppe diese Person? Bei allem anderen als Personen: ja. */
export function knowsPerson(
  data: Pick<CampaignData, 'entities' | 'relations'>,
  entity: Entity | undefined,
): boolean {
  if (entity?.kind !== 'person') return true;
  return entity.person.met || hasStance(data, entity.id);
}

/** Eine Person, die die Gruppe nicht kennt (für alles andere: false). */
export function isUnmetPerson(
  data: Pick<CampaignData, 'entities' | 'relations'>,
  entity: Entity | undefined,
): boolean {
  return entity?.kind === 'person' && !knowsPerson(data, entity);
}
