/**
 * Ein loser Faden gehört zu einer Geschichte – nicht immer als Frage. Oft ist er ein Name (ein
 * Ort, eine Person), den der Spielleiter dort nur festhalten wollte: „Kriegslager der Duergar“
 * gehört zu Vorzagaths Geschichte. Hier steht, welche Einträge der Faden meint – der Eintrag
 * seines Satzes (`entryForTitle`), die Namen darin und was an ihm hängt. Reine Rechnung.
 */
import { namesIn } from '../../domain/recognize';
import type { CampaignData, Entity, Thread } from '../../domain/schema';
import { entryForTitle } from '../wiki/facts';

/**
 * Die Einträge, die ein Faden nennt – der Eintrag, der so heißt wie der ganze Satz, zuerst,
 * dann angeheftete und im Satz genannte. Gefährten nicht: Sie hängen über „betrifft“ an.
 */
export function threadNames(data: CampaignData, thread: Thread): Entity[] {
  const owner = entryForTitle(data, thread.title);
  const whole = owner ? ('free' in owner ? owner.free : owner.taken) : null;
  const ids = [
    ...(whole ? [whole.id] : []),
    ...thread.refs,
    ...namesIn(data, thread.title, thread.refs).flatMap((hit) => (hit.id ? [hit.id] : [])),
  ];
  return [...new Set(ids)]
    .map((id) => data.entities[id])
    .filter((entity): entity is Entity => !!entity && entity.kind !== 'character');
}

/** Heißt ein Eintrag genau wie der Satz des Fadens? Dann gibt es nichts neu anzulegen. */
export function threadIsName(data: CampaignData, thread: Thread): boolean {
  return entryForTitle(data, thread.title) !== null;
}
