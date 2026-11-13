/**
 * Das Lesen einer nachgetragenen Session festhalten: Der Stand des Lesens (Vorschläge, Fragen,
 * Abschnitte) kommt an die Session, Entscheidungen von früher bleiben (`mergeReading`). Der
 * Rückblick für die Spieler wird zu `session.recap` – außer der Spielleiter hat ihn selbst
 * geändert. Nichts davon legt Einträge an; das geschieht erst beim Annehmen.
 */
import type { CampaignDb } from '../../data/db';
import type { SessionReading } from '../../domain/schema';
import { readSession } from './readSession';

export interface StoredReading {
  reading: SessionReading;
  /** Stellt den Stand vor dem Lesen wieder her. */
  undo: () => void;
}

/** Liest die Notizen der Session (erneut) und speichert den Stand an ihr. null, wenn es sie nicht gibt. */
export function storeReading(
  db: CampaignDb,
  sessionId: string,
  readAt = new Date().toISOString(),
): StoredReading | null {
  const data = db.getSnapshot();
  const session = data.sessions[sessionId];
  if (!session) return null;
  const reading = readSession(data, session, { readAt, previous: session.reading });
  const before = { reading: session.reading, recap: session.recap };
  // Den Rückblick nur ersetzen, wenn er leer ist oder noch so dasteht, wie er gelesen wurde.
  const untouched = !session.recap.trim() || session.recap === (session.reading?.recap ?? '');
  db.patch('sessions', sessionId, {
    reading,
    recap: untouched ? reading.recap : session.recap,
  });
  return { reading, undo: () => db.patch('sessions', sessionId, before) };
}
