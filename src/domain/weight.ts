/**
 * Gewicht eines Termins: Was gehört in den Kalender – und was ist Alltag, den Wayfarer führt,
 * ohne ihn ständig zu zeigen? Der Kalender soll zeigen, was die Welt bewegt, was zu einem Faden
 * der Geschichte gehört und was dort los ist, wo die Gruppe gerade ist. Dass jeden Tag am Tor
 * die Wache wechselt, steht am Tag und am Ort – nicht in jedem Kästchen des Monats.
 *
 * Reine Funktionen. Wayfarer entscheidet nach festen Regeln; der Spielleiter kann es je Termin
 * übersteuern (`event.weight`).
 */
import { placeAncestors } from './derive';
import type { CalendarEvent, CampaignData } from './schema';

/**
 * `story` = gehört zu einem Faden; `main` = bewegt die Welt oder ist Sache der Gruppe (Einmaliges,
 * Vorhaben, Fristen, Feste); `local` = Wiederkehrendes dort, wo die Gruppe ist; `everyday` =
 * Alltag: wird geführt, aber nicht im Kalender gezeigt.
 */
export type EventWeight = 'story' | 'main' | 'local' | 'everyday';

type NearData = Pick<CampaignData, 'entities' | 'state'>;

/** Liegt ein Ort dort, wo die Gruppe ist – derselbe Ort, einer darüber oder einer darin? */
export function isNear(data: NearData, placeId: string | null | undefined): boolean {
  const party = data.state.placeId;
  if (!party || !placeId) return false;
  if (placeId === party) return true;
  return (
    placeAncestors(data as CampaignData, party).some((place) => place.id === placeId) ||
    placeAncestors(data as CampaignData, placeId).some((place) => place.id === party)
  );
}

type WeightData = NearData & Partial<Pick<CampaignData, 'threads'>>;

/**
 * Das Gewicht eines Termins.
 *
 * - Was an einem offenen Faden hängt, gehört zur Geschichte.
 * - Einmaliges, Vorhaben und Fristen der Gruppe sowie Feste (monatlich, jährlich) zählen immer.
 * - Was sich nach Wochen wiederholt (ein Markttag), zählt dort, wo die Gruppe ist.
 * - Was sich nach Tagen wiederholt, ist Alltag – überall.
 */
export function eventWeight(data: WeightData, event: CalendarEvent): EventWeight {
  if (event.threadId) {
    const thread = data.threads?.[event.threadId];
    if (thread && thread.state !== 'solved' && thread.state !== 'lost') return 'story';
  }
  if (event.weight === 'important') return 'main';
  if (event.weight === 'everyday') return 'everyday';
  if (event.kind !== 'world' || !event.repeat) return 'main';
  if (event.repeat.unit === 'month' || event.repeat.unit === 'year') return 'main';
  if (event.repeat.unit === 'week' && isNear(data, event.placeId)) return 'local';
  return 'everyday';
}

/** Alltag: wird geführt, aber im Kalender und unter „Anstehend“ nicht gezeigt. */
export const isEveryday = (data: WeightData, event: CalendarEvent): boolean =>
  eventWeight(data, event) === 'everyday';

/** Warum ein Termin so eingeordnet ist – ein Satz für den Spielleiter. */
export function weightReason(data: WeightData, event: CalendarEvent): string {
  const weight = eventWeight(data, event);
  if (weight === 'story') return 'Gehört zu einem Faden – steht immer im Kalender.';
  if (event.weight === 'important') return 'Von dir als wichtig festgelegt.';
  if (event.weight === 'everyday') return 'Von dir als Alltag festgelegt.';
  if (weight === 'local')
    return 'Wiederkehrend am Ort der Gruppe – steht im Kalender, solange sie dort ist.';
  if (weight === 'main')
    return event.repeat
      ? 'Ein Fest oder fester Termin der Welt – steht im Kalender.'
      : 'Einmalig oder Sache der Gruppe – steht im Kalender.';
  return event.repeat?.unit === 'day'
    ? 'Geschieht alle paar Tage: Alltag. Steht am Tag und am Ort, nicht im Monat.'
    : 'Wiederkehrend an einem Ort, an dem die Gruppe nicht ist: Alltag.';
}
