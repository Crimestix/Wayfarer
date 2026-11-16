/**
 * Zwei Gefährten, ein Körper: Zwei eigene Gefährten (eigener Bogen, Werte, Fähigkeiten, Name,
 * Haltungen der NSC) teilen sich einen Körper; immer genau einer hat die Kontrolle, der andere
 * ruht (`character.resting`). Wer die Kontrolle hat, zählt als anwesender Gefährte
 * (`activeParty`); der andere ist weder abseits noch inaktiv.
 *
 * Zum Körper gehören: erlittener Schaden (bei verschiedenen Höchstwerten gilt der dessen, der
 * gerade die Kontrolle hat – der Schaden bleibt derselbe), Zustände, Erschöpfung, Wirkungen am
 * Körper, Ort, Teilgruppe und Uhr, Platz in der Marschordnung. Beim Wechsel zieht das alles mit
 * (`switchPlan`). Ein Wechsel steht nie in der Chronik.
 *
 * Reine Funktionen; geschrieben wird über `features/gruppe/actions.ts` (`switchBody`,
 * `linkBody`, `unlinkBody`).
 */
import type { CampaignData, Character, PlayState } from './schema';

/** Der andere Gefährte im selben Körper; null, wenn es keinen (mehr) gibt. */
export function bodyPartner(data: CampaignData, characterId: string): Character | null {
  const self = data.entities[characterId];
  if (self?.kind !== 'character' || !self.character.bodyWith) return null;
  const other = data.entities[self.character.bodyWith];
  return other?.kind === 'character' && other.character.bodyWith === self.id ? other : null;
}

/** Ruht dieser Gefährte gerade im Körper eines anderen? */
export function isResting(data: CampaignData, characterId: string): boolean {
  const self = data.entities[characterId];
  return self?.kind === 'character' && self.character.resting && !!bodyPartner(data, self.id);
}

/** Wer in diesem Körper gerade ruht – für „ruht: Corrina“ an dem, der die Kontrolle hat. */
export function restingIn(data: CampaignData, characterId: string): Character | null {
  const other = bodyPartner(data, characterId);
  return other && other.character.resting ? other : null;
}

/**
 * Trefferpunkte nach dem Wechsel: Der erlittene Schaden bleibt, der Höchstwert ist der des
 * neuen Gefährten. Nie unter 0, nie über das Höchstmaß. Ohne geführte Trefferpunkte bleibt es,
 * wie es beim neuen steht.
 */
export function hpAfterSwitch(from: Character, to: Character): number | null {
  const { hp, hpMax } = from.character;
  if (hp === null || hpMax === null) return to.character.hp;
  const max = to.character.hpMax ?? hpMax;
  const damage = Math.max(0, hpMax - hp);
  return Math.min(max, Math.max(0, max - damage));
}

/** Was ein Wechsel ändert: am Gefährten, an den Teilgruppen und der Marschordnung, an Wirkungen. */
export interface SwitchPlan {
  fromId: string;
  toId: string;
  from: Partial<Character['character']>;
  to: Partial<Character['character']>;
  state: Partial<Pick<PlayState, 'groups' | 'march' | 'inView'>>;
  /** Laufende Wirkungen am Körper, deren Bezug auf den neuen Gefährten zieht. */
  timers: { id: string; refs: string[]; participants: string[] }[];
}

/**
 * Der Wechsel: Wer ruht, übernimmt den Körper – mit Schaden, Zuständen und Erschöpfung des
 * Körpers, seinem Platz in Teilgruppe und Marschordnung und den Wirkungen am Körper. null, wenn
 * es keinen Partner gibt.
 */
export function switchPlan(data: CampaignData, characterId: string): SwitchPlan | null {
  const self = data.entities[characterId];
  const other = bodyPartner(data, characterId);
  if (self?.kind !== 'character' || !other) return null;
  // Wer gerade die Kontrolle hat, gibt sie ab.
  const [from, to] = self.character.resting ? [other, self] : [self, other];
  const swap = (id: string) => (id === from.id ? to.id : id);
  // Der Körper hat einen Platz: Stand der Ruhende schon irgendwo (vor dem Verbinden), fällt das weg.
  const swapAll = (ids: readonly string[]) => [
    ...new Set(ids.filter((id) => id !== to.id).map(swap)),
  ];
  const timers = Object.values(data.timers)
    .filter(
      (timer) =>
        !timer.done && (timer.refs.includes(from.id) || timer.participants.includes(from.id)),
    )
    .map((timer) => ({
      id: timer.id,
      refs: [...new Set(timer.refs.map(swap))],
      participants: [...new Set(timer.participants.map(swap))],
    }));
  return {
    fromId: from.id,
    toId: to.id,
    from: { resting: true },
    to: {
      resting: false,
      hp: hpAfterSwitch(from, to),
      conditions: [...from.character.conditions],
      exhaustion: from.character.exhaustion,
      placeId: from.character.placeId,
    },
    state: {
      groups: data.state.groups.map((group) => ({
        ...group,
        memberIds: swapAll(group.memberIds),
      })),
      march: data.state.march.map(swapAll).filter((row) => row.length > 0),
      inView: [...new Set(data.state.inView.map(swap))],
    },
    timers,
  };
}
