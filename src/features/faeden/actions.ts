/**
 * Befehle des Fadenbretts: Geschichten und Fäden anlegen, ändern, löschen; Hinweise abhaken. Was
 * mehrere Dokumente betrifft (eine Geschichte mit ihren Fäden, ein Faden mit seinen Terminen),
 * läuft hier in einem Zug.
 */
import type { CampaignDb } from '../../data/db';
import {
  createStory,
  createThread,
  type Story,
  type Thread,
  type ThreadState,
} from '../../domain/schema';

export type StoryInput = Pick<
  Story,
  'title' | 'summary' | 'ownerId' | 'clockId' | 'refs' | 'entries' | 'known' | 'closed'
>;

/** Legt eine Geschichte an oder ändert sie. Einstiege ohne Text fallen weg. */
export function saveStory(db: CampaignDb, input: StoryInput, id?: string): Story {
  const clean: StoryInput = {
    ...input,
    title: input.title.trim() || 'Geschichte ohne Namen',
    summary: input.summary.trim(),
    refs: [...new Set(input.refs)],
    entries: input.entries
      .map((entry) => ({ ...entry, text: entry.text.trim() }))
      .filter((entry) => entry.text),
  };
  if (id && db.getSnapshot().stories[id]) return db.patch('stories', id, clean);
  return db.put('stories', createStory(clean));
}

/** Löscht eine Geschichte. Ihre Fäden bleiben – als lose Fäden. */
export function removeStory(db: CampaignDb, id: string): void {
  db.batch(() => {
    for (const thread of Object.values(db.getSnapshot().threads))
      if (thread.storyId === id) db.patch('threads', thread.id, { storyId: null });
    db.remove('stories', id);
  });
}

export type ThreadInput = Pick<
  Thread,
  'title' | 'truth' | 'state' | 'storyId' | 'refs' | 'known' | 'hints'
>;

/** Legt einen Faden an oder ändert ihn. Hinweise ohne Text fallen weg. */
export function saveThread(db: CampaignDb, input: ThreadInput, id?: string): Thread {
  const clean: ThreadInput = {
    ...input,
    title: input.title.trim() || 'Faden ohne Namen',
    truth: input.truth.trim(),
    refs: [...new Set(input.refs)],
    hints: input.hints
      .map((hint) => ({ ...hint, text: hint.text.trim() }))
      .filter((hint) => hint.text),
  };
  if (id && db.getSnapshot().threads[id]) return db.patch('threads', id, clean);
  return db.put('threads', createThread(clean));
}

/** Löscht einen Faden. Termine, die an ihm hingen, bleiben – ohne Faden. */
export function removeThread(db: CampaignDb, id: string): void {
  db.batch(() => {
    for (const event of Object.values(db.getSnapshot().events))
      if (event.threadId === id) db.patch('events', event.id, { threadId: null });
    db.remove('threads', id);
  });
}

export function setThreadState(db: CampaignDb, id: string, state: ThreadState): void {
  if (db.getSnapshot().threads[id]) db.patch('threads', id, { state });
}

/**
 * Die Gruppe hat einen Hinweis gefunden (oder doch nicht). Mit dem ersten gefundenen Hinweis
 * kennt sie den Faden – und ein offener Faden wird aktiv.
 */
export function setHintFound(db: CampaignDb, threadId: string, hintId: string, found: boolean) {
  const thread = db.getSnapshot().threads[threadId];
  if (!thread) return;
  const hints = thread.hints.map((hint) => (hint.id === hintId ? { ...hint, found } : hint));
  db.patch('threads', threadId, {
    hints,
    known: thread.known || found,
    state: found && thread.state === 'open' ? 'active' : thread.state,
  });
}
