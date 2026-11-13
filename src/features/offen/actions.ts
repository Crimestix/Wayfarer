/** Befehle der Seite „Noch offen“: einen Widerspruch für richtig erklären („Passt so“). */
import type { CampaignDb } from '../../data/db';

/** Merkt sich, dass ein Widerspruch so stimmt. Gibt das Rückgängig zurück. */
export function markContinuityOk(db: CampaignDb, key: string): () => void {
  const ok = db.getSnapshot().state.continuityOk ?? [];
  if (!ok.includes(key)) db.setState({ continuityOk: [...ok, key] });
  return () => {
    const now = db.getSnapshot().state.continuityOk ?? [];
    if (now.includes(key)) db.setState({ continuityOk: now.filter((entry) => entry !== key) });
  };
}
