/**
 * Befehle der Zeitleiste: welche Bahnen in welcher Reihenfolge stehen. Gemerkt im Spielstand
 * (`state.timelineLanes`); null heißt: Wayfarer wählt (`defaultLaneKeys` in `domain/timeline.ts`).
 * Dazu die Zeitalter der Welt (`campaign.ages`, `domain/ages.ts`).
 */
import type { CampaignDb } from '../../data/db';
import { readAge, type AgeInput } from '../../domain/ages';
import { newId } from '../../domain/schema';
import { laneKeysOf } from '../../domain/timeline';

const save = (db: CampaignDb, keys: string[]) => db.setState({ timelineLanes: keys });

/** Nimmt eine Bahn dazu (unten) – steht sie schon da, bleibt alles, wie es ist. */
export function addLane(db: CampaignDb, key: string): void {
  const keys = laneKeysOf(db.getSnapshot());
  if (!keys.includes(key)) save(db, [...keys, key]);
}

/** Nimmt eine Bahn heraus. */
export function removeLane(db: CampaignDb, key: string): void {
  save(
    db,
    laneKeysOf(db.getSnapshot()).filter((other) => other !== key),
  );
}

/** Schiebt eine Bahn um eine Stelle nach oben (-1) oder unten (+1). */
export function moveLane(db: CampaignDb, key: string, by: -1 | 1): void {
  const keys = laneKeysOf(db.getSnapshot());
  const at = keys.indexOf(key);
  const to = at + by;
  if (at < 0 || to < 0 || to >= keys.length) return;
  [keys[at], keys[to]] = [keys[to]!, keys[at]!];
  save(db, keys);
}

/** Wayfarer wählt wieder selbst. */
export function resetLanes(db: CampaignDb): void {
  db.setState({ timelineLanes: null });
}

// ── Zeitalter ──────────────────────────────────────────────────────────────

/**
 * Legt ein Zeitalter an oder ändert es (`id`). Gibt den Grund zurück, wenn sich die Felder nicht
 * lesen lassen – dann bleibt alles, wie es war.
 */
export function saveAge(
  db: CampaignDb,
  input: AgeInput,
  id?: string,
): { problem: string } | { id: string } {
  const { campaign, state } = db.getSnapshot();
  const read = readAge(campaign.calendar, input, state.now);
  if ('problem' in read) return read;
  const age = { id: id ?? newId(), ...read };
  const exists = campaign.ages.some((other) => other.id === age.id);
  db.setCampaign({
    ages: exists
      ? campaign.ages.map((other) => (other.id === age.id ? age : other))
      : [...campaign.ages, age],
  });
  return { id: age.id };
}

/** Nimmt ein Zeitalter heraus. */
export function removeAge(db: CampaignDb, id: string): void {
  const { campaign } = db.getSnapshot();
  db.setCampaign({ ages: campaign.ages.filter((age) => age.id !== id) });
}
