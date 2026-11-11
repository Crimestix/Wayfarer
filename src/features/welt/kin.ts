/** Befehle zur Verwandtschaft: eintragen, was eine Person für eine andere ist, und es wieder lösen. */
import type { CampaignDb } from '../../data/db';
import { inverseKin, kinType, type Gender } from '../../domain/kin';
import { createRelation, type Relation } from '../../domain/schema';

/**
 * Trägt ein, dass `fromId` für `toId` ist, was `kin` sagt („Mira ist die Schwester von Odo“).
 * Gibt es zwischen beiden schon eine Verwandtschaft, wird sie ersetzt. Das Geschlecht des Wortes
 * („Schwester“) merkt sich Wayfarer an der Person, wenn dort noch keines steht – so heißen ihre
 * übrigen Verwandtschaften gleich richtig.
 */
export function setKin(
  db: CampaignDb,
  fromId: string,
  toId: string,
  kin: string,
  gender: Gender | null = null,
): Relation | null {
  if (fromId === toId || !kinType(kin)) return null;
  return db.batch(() => {
    const data = db.getSnapshot();
    const between = Object.values(data.relations).filter(
      (r) =>
        !r.ended && ((r.from === fromId && r.to === toId) || (r.from === toId && r.to === fromId)),
    );
    // Zuerst eine schon eingetragene Verwandtschaft, sonst ein allgemeines „verwandt mit“.
    const existing = between.find((r) => r.kin) ?? between.find((r) => r.type === 'family');
    const relation = existing
      ? db.patch('relations', existing.id, {
          kin: existing.from === fromId ? kin : inverseKin(kin),
        })
      : db.put(
          'relations',
          createRelation({
            from: fromId,
            to: toId,
            type: kin === 'spouse' ? 'lover' : 'family',
            kin,
          }),
        );
    const person = data.entities[fromId];
    if (gender && person?.kind === 'person' && person.person.gender === null)
      db.put('entities', { ...person, person: { ...person.person, gender } });
    return relation;
  });
}

/** Löst eine eingetragene Verwandtschaft. `undo` stellt sie wieder her. */
export function removeKin(db: CampaignDb, relationId: string): (() => void) | null {
  const relation = db.getSnapshot().relations[relationId];
  if (!relation) return null;
  db.remove('relations', relationId);
  return () => {
    if (!db.getSnapshot().relations[relationId]) db.put('relations', relation);
  };
}
