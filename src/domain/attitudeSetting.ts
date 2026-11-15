/**
 * Haltung festlegen oder ändern: Nicht jede gesetzte Haltung ist Geschichte. Kennt die Gruppe
 * jemanden seit Langem und trägt der Spielleiter nur nach, wie er zu ihr steht, gehört das nicht
 * als heutige Änderung in die Chronik („War schon so“). Erst was sich im Spiel ändert, steht dort.
 */
import { attitudeHistory, byTime, findRelation } from './derive';
import type { CampaignData, ChronicleEntry } from './schema';

/** Wie eine Haltung gesetzt wird: als Änderung im Spiel (Chronik) oder als schon bestehend. */
export type AttitudeMode = 'change' | 'given';

export interface AttitudeModeChoice {
  /**
   * „War schon so“ geht nur, solange die Chronik zu diesem Paar nichts erzählt – sonst stünde
   * die heutige Haltung im Widerspruch zum jüngsten Eintrag.
   */
  givenPossible: boolean;
  /** Was vorgewählt ist: ohne bisherige Haltung und ohne Verlauf „War schon so“. */
  preset: AttitudeMode;
}

export function attitudeModeChoice(
  data: CampaignData,
  fromId: string,
  toId: string,
): AttitudeModeChoice {
  const givenPossible = attitudeHistory(data, fromId, toId).length === 0;
  const before = findRelation(data, fromId, toId)?.attitude ?? null;
  return { givenPossible, preset: givenPossible && before === null ? 'given' : 'change' };
}

/**
 * Einträge, die nur eine Haltung festgelegt haben: der erste Eintrag zu einem Paar, von „keine
 * Haltung“ zu einer Haltung, ohne Grund. Sie lassen sich aus der Chronik nehmen, ohne dass sich
 * an der Haltung etwas ändert (`dropAttitudeSetting`). Jüngste zuerst.
 */
export function attitudeSettings(data: CampaignData): ChronicleEntry[] {
  const firsts = new Map<string, ChronicleEntry>();
  for (const entry of Object.values(data.chronicle)) {
    if (entry.kind !== 'attitude' || !entry.attitude) continue;
    const key = `${entry.attitude.fromId}:${entry.attitude.toId}`;
    const known = firsts.get(key);
    if (!known || byTime(entry, known) < 0) firsts.set(key, entry);
  }
  return [...firsts.values()]
    .filter(
      (entry) =>
        entry.attitude!.before === null && entry.attitude!.after !== null && !entry.text.trim(),
    )
    .sort((a, b) => byTime(b, a));
}
