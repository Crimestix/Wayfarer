/** Befehle der Handouts: anlegen, ändern, löschen, übergeben. */
import { logEntry } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import { HANDOUT_KIND_LABEL } from '../../domain/handout';
import { createHandout, type Handout } from '../../domain/schema';

export type HandoutInput = Pick<
  Handout,
  'title' | 'kind' | 'text' | 'signature' | 'seal' | 'storyId' | 'sourceId'
>;

/** Legt ein Handout an oder ändert es. */
export function saveHandout(db: CampaignDb, input: Partial<HandoutInput>, id?: string): Handout {
  const data = db.getSnapshot();
  const storyId =
    input.storyId === undefined
      ? undefined
      : input.storyId && data.stories[input.storyId]
        ? input.storyId
        : null;
  const values = { ...input, ...(storyId === undefined ? {} : { storyId }) };
  if (id && data.handouts[id]) return db.patch('handouts', id, values);
  return db.put('handouts', createHandout(values));
}

/** Die Gruppe bekommt das Handout: Zeile in der Chronik. `undo` nimmt es zurück. */
export function giveHandout(db: CampaignDb, id: string): (() => void) | null {
  const handout = db.getSnapshot().handouts[id];
  if (!handout || handout.givenAt !== null) return null;
  const now = db.getSnapshot().state.now;
  const entry = db.batch(() => {
    const line = logEntry(db, {
      text: `${HANDOUT_KIND_LABEL[handout.kind]} übergeben: ${handout.title || 'ohne Titel'}`,
      storyId: handout.storyId,
    });
    db.patch('handouts', id, { givenAt: now, chronicleId: line.id });
    return line;
  });
  return () =>
    db.batch(() => {
      if (db.getSnapshot().chronicle[entry.id]) db.remove('chronicle', entry.id);
      if (db.getSnapshot().handouts[id])
        db.patch('handouts', id, { givenAt: null, chronicleId: null });
    });
}

export function removeHandout(db: CampaignDb, id: string): (() => void) | null {
  const handout = db.getSnapshot().handouts[id];
  if (!handout) return null;
  db.remove('handouts', id);
  return () => {
    if (!db.getSnapshot().handouts[id]) db.put('handouts', { ...handout, rev: 0 });
  };
}
