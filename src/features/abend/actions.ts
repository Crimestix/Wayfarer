/**
 * Befehle rund um das Blatt eines Abends: schreiben, abhaken. Das Blatt entsteht mit dem ersten
 * Wort – und nimmt dabei mit, was vom letzten Abend übrig ist (`carryOver`).
 */
import type { CampaignDb } from '../../data/db';
import { currentSession } from '../../domain/derive';
import { carryOver, currentPrep, type PrepContent } from '../../domain/prep';
import { createPrep, type Prep } from '../../domain/schema';

/**
 * Das Blatt des Abends – legt es an, falls es noch keines gibt. Läuft gerade eine Session, gehört
 * das neue Blatt zu ihr: Wer mitten im Abend zu schreiben beginnt, meint diesen Abend.
 */
export function ensurePrep(db: CampaignDb): Prep {
  const data = db.getSnapshot();
  return (
    currentPrep(data) ??
    db.put('preps', createPrep({ ...carryOver(data), sessionId: currentSession(data)?.id ?? null }))
  );
}

/** Schreibt auf das Blatt des Abends. Leere Szenen und Geheimnisse fallen weg. */
export function patchPrep(db: CampaignDb, change: Partial<PrepContent>): Prep {
  return db.batch(() => {
    const prep = ensurePrep(db);
    const data = db.getSnapshot();
    return db.patch('preps', prep.id, {
      ...change,
      ...(change.scenes ? { scenes: change.scenes.filter((scene) => scene.text.trim()) } : {}),
      ...(change.secrets
        ? {
            secrets: change.secrets
              .filter((secret) => secret.text.trim())
              .map((secret) => ({
                ...secret,
                storyId: secret.storyId && data.stories[secret.storyId] ? secret.storyId : null,
              })),
          }
        : {}),
      ...(change.encounterIds
        ? {
            encounterIds: [...new Set(change.encounterIds)].filter((id) => data.encounters[id]),
          }
        : {}),
    });
  });
}

/** Hakt eine Szene als gespielt ab – oder nimmt den Haken zurück. */
export function setSceneDone(db: CampaignDb, sceneId: string, done: boolean): void {
  const prep = ensurePrep(db);
  db.patch('preps', prep.id, {
    scenes: prep.scenes.map((scene) => (scene.id === sceneId ? { ...scene, done } : scene)),
  });
}

/** Die Gruppe hat ein Geheimnis erfahren – oder doch nicht. Gemerkt wird, wann. */
export function setSecretRevealed(db: CampaignDb, secretId: string, revealed: boolean): void {
  const prep = ensurePrep(db);
  const now = db.getSnapshot().state.now;
  db.patch('preps', prep.id, {
    secrets: prep.secrets.map((secret) =>
      secret.id === secretId ? { ...secret, revealed, revealedAt: revealed ? now : null } : secret,
    ),
  });
}
