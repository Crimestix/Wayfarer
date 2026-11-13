/**
 * Befehle des Fraktionsnetzes: Siegel hinlegen und das Netz aufräumen. Die Lage steht im
 * Spielstand (`state.netBoard`); gerechnet wird in `domain/factionNet.ts`.
 */
import type { CampaignDb } from '../../data/db';

type Spot = { x: number; y: number };

/**
 * Legt Siegel an Stellen des Netzes. Wer eins verschiebt, legt damit auch alle anderen fest, die
 * gerade zu sehen sind – sonst ordnete Wayfarer den Rest neu, und das Bild spränge.
 */
export function placeInNet(db: CampaignDb, spots: Readonly<Record<string, Spot>>): void {
  const before = db.getSnapshot().state.netBoard ?? {};
  const next = { ...before };
  for (const [id, spot] of Object.entries(spots))
    next[id] = { x: Math.round(spot.x), y: Math.round(spot.y) };
  db.setState({ netBoard: next });
}

/** Räumt das Netz auf: Wayfarer legt alles neu aus. `undo` legt es zurück, wie es war. */
export function tidyNet(db: CampaignDb): () => void {
  const before = db.getSnapshot().state.netBoard ?? {};
  db.setState({ netBoard: {} });
  return () => db.setState({ netBoard: before });
}
