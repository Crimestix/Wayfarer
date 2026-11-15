/**
 * Der einzige Weg, einen Kampagnenordner zu öffnen. Liegt dort ein Merkzettel eines
 * unterbrochenen Abgleichs (`.abgleich/anwenden.json`), bringt die Rust-Seite ihn zuerst zu
 * Ende (`sync_recover`, ohne Netz) – erst danach entsteht die Datenbank. Bleibt danach noch ein
 * Merkzettel liegen (eine Datei fehlt und muss mit Netz nachgeholt werden), öffnet Wayfarer
 * nicht still den halben Stand, sondern meldet `SyncInterruptedError`.
 */
import { CampaignDb } from './db';
import { FolderStore, syncRecover, toSyncFailure } from './platform';

/** Ein Abgleich wurde unterbrochen; „Fortsetzen“ (mit Netz) bringt ihn zu Ende. */
export class SyncInterruptedError extends Error {
  constructor(
    readonly left: { path: string; sha: string }[],
    detail?: string,
  ) {
    super(
      detail
        ? `Ein Abgleich wurde unterbrochen. „Fortsetzen“ bringt ihn zu Ende. (${detail})`
        : 'Ein Abgleich wurde unterbrochen. „Fortsetzen“ bringt ihn zu Ende.',
    );
  }
}

export interface OpenDeps {
  recover: (root: string) => Promise<{ finished: number; left: { path: string; sha: string }[] }>;
  open: (root: string) => Promise<CampaignDb>;
}

const desktop: OpenDeps = {
  recover: syncRecover,
  open: (root) => CampaignDb.open(new FolderStore(root)),
};

export async function openCampaign(dir: string, deps: OpenDeps = desktop): Promise<CampaignDb> {
  let left: { path: string; sha: string }[];
  try {
    ({ left } = await deps.recover(dir));
  } catch (error) {
    const failure = toSyncFailure(error);
    // Ein Ordner, der gar nicht erreichbar ist, meldet das Öffnen selbst verständlicher.
    if (failure.kind === 'input') return deps.open(dir);
    throw new SyncInterruptedError([], failure.message);
  }
  if (left.length) throw new SyncInterruptedError(left);
  return deps.open(dir);
}
