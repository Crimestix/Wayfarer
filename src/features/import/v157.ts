import type { CampaignData } from '../../domain/schema';

export interface ImportResult {
  data: CampaignData;
  /** Was übernommen wurde und was nicht – in ganzen Sätzen für die Anzeige. */
  report: string[];
}

/** Liest ein Backup der alten Wayfarer-Version (v157) und baut daraus eine neue Kampagne. */
export function importV157Backup(_raw: unknown): ImportResult {
  throw new Error('Der Import der alten Version ist noch nicht fertig.');
}
