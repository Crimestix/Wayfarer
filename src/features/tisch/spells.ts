/**
 * Zauber am Tisch: wer wirkt was, wie lange, mit oder ohne Konzentration. Ein Zauber ist eine
 * Wirkung (`timers/`, Art `spell`); hält jemand schon eine Konzentration, endet sie beim
 * nächsten Konzentrationszauber – so sagt es das Regelwerk. Wayfarer sagt es dabei leise.
 */
import { runningTimers } from '../../domain/derive';
import type { CampaignData, Timer } from '../../domain/schema';

/** Übliche Dauern von Zaubern in Minuten Weltzeit. */
export const SPELL_DURATIONS: readonly { label: string; minutes: number }[] = [
  { label: '1 Minute', minutes: 1 },
  { label: '10 Minuten', minutes: 10 },
  { label: '1 Stunde', minutes: 60 },
  { label: '8 Stunden', minutes: 8 * 60 },
  { label: '24 Stunden', minutes: 24 * 60 },
];

/** Die Konzentration, die `casterId` gerade hält (laufende Zauber mit Konzentration). */
export function concentrationOf(data: CampaignData, casterId: string | null): Timer[] {
  if (!casterId) return [];
  return runningTimers(data).filter(
    (timer) => timer.kind === 'spell' && timer.concentration && timer.casterId === casterId,
  );
}

/**
 * Wer vermutlich zaubert: unter den genannten Dingen der erste Gefährte, sonst die erste Person.
 * Nur ein Vorschlag – das Feld bleibt frei wählbar.
 */
export function casterFromRefs(data: CampaignData, refs: readonly string[]): string | null {
  const kindOf = (id: string) => data.entities[id]?.kind;
  return (
    refs.find((id) => kindOf(id) === 'character') ??
    refs.find((id) => kindOf(id) === 'person') ??
    null
  );
}

/** Wie ein Zauber am Tisch heißt: „Mira: Unsichtbarkeit“. */
export function spellTitle(data: CampaignData, timer: Timer): string {
  const caster = timer.casterId ? data.entities[timer.casterId]?.name : undefined;
  return caster ? `${caster}: ${timer.label}` : timer.label;
}

/**
 * Der Zauber aus dem Satz der Mitschrift: ohne den Namen des Wirkers und ohne „wirkt“ –
 * „Corrin wirkt Unsichtbarkeit“ wird „Unsichtbarkeit“. Sonst bleibt der Satz, wie er ist.
 */
export function spellLabelFrom(text: string, casterName: string | null): string {
  let label = text.trim();
  if (casterName) {
    const at = label.toLocaleLowerCase('de').indexOf(casterName.toLocaleLowerCase('de'));
    if (at >= 0) label = `${label.slice(0, at)} ${label.slice(at + casterName.length)}`;
  }
  return label
    .replace(/\b(wirkt|zaubert|spricht)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:,–-]+|[\s:,–-]+$/g, '')
    .trim();
}
