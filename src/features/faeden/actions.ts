/**
 * Befehle des Fadenbretts: Geschichten und Fäden anlegen, ändern, löschen; Hinweise abhaken. Was
 * mehrere Dokumente betrifft (eine Geschichte mit ihren Fäden, ein Faden mit seinen Terminen),
 * läuft hier in einem Zug.
 */
import type { CampaignDb } from '../../data/db';
import { storyAttached } from '../../domain/story';
import {
  createClock,
  createStory,
  createThread,
  newId,
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

/** Legt eine leere Geschichte an – zum Schreiben auf ihrem Blatt. */
export function newStory(db: CampaignDb, init: Partial<Story> = {}): Story {
  return db.put('stories', createStory({ title: 'Neue Geschichte', ...init }));
}

/**
 * Legt ein Vorhaben an: eine leere Geschichte, die `ownerId` antreibt – eine Fraktion, Familie
 * oder Person. Ihre Uhr entsteht mit dem ersten Schritt auf dem Blatt. Uhren gehören zu
 * Geschichten; ein eigenes Uhrenwerk für Fraktionen gibt es nicht.
 */
export function newScheme(db: CampaignDb, ownerId: string): Story | null {
  if (!db.getSnapshot().entities[ownerId]) return null;
  return newStory(db, { title: 'Neues Vorhaben', ownerId });
}

/**
 * Macht aus einer Uhr, die für sich steht, eine Geschichte: Sie heißt wie die Uhr, wird von
 * deren Betreiber angetrieben und hängt an deren Ort. Gehört die Uhr schon zu einer, bleibt es
 * bei der.
 */
export function storyFromClock(db: CampaignDb, clockId: string): Story | null {
  const data = db.getSnapshot();
  const clock = data.clocks[clockId];
  if (!clock) return null;
  const owner = Object.values(data.stories).find((story) => story.clockId === clockId);
  if (owner) return owner;
  return db.put(
    'stories',
    createStory({
      title: clock.title,
      ownerId: clock.ownerId,
      clockId: clock.id,
      refs: [...new Set([...(clock.placeId ? [clock.placeId] : []), ...clock.refs])],
    }),
  );
}

export type StoryChange = Partial<
  Pick<
    Story,
    | 'title'
    | 'summary'
    | 'ownerId'
    | 'stakes'
    | 'refs'
    | 'heroes'
    | 'entries'
    | 'scenes'
    | 'ending'
    | 'reward'
    | 'memo'
    | 'known'
    | 'closed'
    | 'inPlay'
    | 'notMeant'
  >
>;

/** Ändert einzelne Angaben einer Geschichte. Einstiege und Szenen ohne Text fallen weg. */
export function patchStory(db: CampaignDb, id: string, change: StoryChange): void {
  const data = db.getSnapshot();
  const story = data.stories[id];
  if (!story) return;
  const clean: StoryChange = { ...change };
  if (change.title !== undefined) clean.title = change.title.trim() || 'Geschichte ohne Namen';
  if (change.refs) clean.refs = [...new Set(change.refs)];
  if (change.entries) clean.entries = change.entries.filter((entry) => entry.text.trim());
  if (change.heroes) {
    // Jeder Gefährte einmal – und nur, wen es gibt.
    const seen = new Set<string>();
    clean.heroes = change.heroes.filter((hero) => {
      if (seen.has(hero.characterId) || data.entities[hero.characterId]?.kind !== 'character')
        return false;
      seen.add(hero.characterId);
      return true;
    });
  }
  if (change.scenes)
    clean.scenes = change.scenes
      .filter((scene) => scene.text.trim() || scene.encounterId)
      .map((scene) => ({
        ...scene,
        encounterId:
          scene.encounterId && data.encounters[scene.encounterId] ? scene.encounterId : null,
      }));
  db.batch(() => {
    db.patch('stories', id, clean);
    // Die Uhr der Geschichte heißt wie sie und gehört ihrem Antreiber.
    const clock = story.clockId ? data.clocks[story.clockId] : undefined;
    if (clock && clean.title !== undefined && clock.title === story.title)
      db.patch('clocks', clock.id, { title: clean.title });
    if (clock && change.ownerId !== undefined && clock.ownerId === story.ownerId)
      db.patch('clocks', clock.id, { ownerId: change.ownerId });
  });
}

/**
 * Nimmt einen Eintrag zu einer Geschichte: Er steht dann unter „Leute und Orte“ – ein Gefährte
 * unter „Wen es persönlich betrifft“. Gehört er schon dazu (als Antreiber, über einen Hinweis,
 * einen Einstieg …), geschieht nichts. Gelesen wird der gespeicherte Stand, nicht der gezeigte.
 */
export function attachToStory(db: CampaignDb, storyId: string, entityId: string): void {
  const data = db.getSnapshot();
  const story = data.stories[storyId];
  const entity = data.entities[entityId];
  if (!story || !entity || storyAttached(data, story).includes(entityId)) return;
  if (entity.kind === 'character') tieHero(db, storyId, entityId);
  else patchStory(db, storyId, { refs: [...story.refs, entityId] });
}

/** Nimmt einen Eintrag wieder von einer Geschichte – soweit er nur dazugenommen war. */
export function detachFromStory(db: CampaignDb, storyId: string, entityId: string): void {
  const story = db.getSnapshot().stories[storyId];
  if (!story) return;
  if (story.refs.includes(entityId))
    patchStory(db, storyId, { refs: story.refs.filter((ref) => ref !== entityId) });
  if (story.heroes.some((hero) => hero.characterId === entityId)) untieHero(db, storyId, entityId);
}

/**
 * „Nicht gemeint“: Ein Name aus dem Text des Blatts (die Kennung eines Eintrags oder ein
 * unbekannter Name) soll dort nicht wieder vorgeschlagen werden.
 */
export function markNotMeant(db: CampaignDb, storyId: string, key: string): void {
  const story = db.getSnapshot().stories[storyId];
  if (!story || !key || story.notMeant.includes(key)) return;
  patchStory(db, storyId, { notMeant: [...story.notMeant, key] });
}

/**
 * Heftet einen Gefährten an eine Geschichte: Sie betrifft ihn persönlich. Hängt er schon an ihr,
 * ändert sich nur der Grund (wenn einer genannt ist).
 */
export function tieHero(db: CampaignDb, storyId: string, characterId: string, why = ''): void {
  const story = db.getSnapshot().stories[storyId];
  if (!story) return;
  const known = story.heroes.find((hero) => hero.characterId === characterId);
  patchStory(db, storyId, {
    heroes: known
      ? story.heroes.map((hero) =>
          hero === known ? { ...hero, why: why.trim() || hero.why } : hero,
        )
      : [...story.heroes, { id: newId(), characterId, why: why.trim() }],
  });
}

/** Löst einen Gefährten von einer Geschichte. */
export function untieHero(db: CampaignDb, storyId: string, characterId: string): void {
  const story = db.getSnapshot().stories[storyId];
  if (!story) return;
  patchStory(db, storyId, {
    heroes: story.heroes.filter((hero) => hero.characterId !== characterId),
  });
}

export interface StepInput {
  id: string;
  text: string;
  /** Tage nach dem vorigen Schritt. */
  days: number;
}

/**
 * Schreibt die Schritte, die bei der Uhr einer Geschichte noch ausstehen. Hat die Geschichte noch
 * keine Uhr, entsteht sie mit dem ersten Schritt – sie läuft ab jetzt, nur für die Spielleitung.
 * Was schon eingetreten ist, bleibt; Bedingungen und Aufschub eines Schrittes auch.
 */
export function setStorySteps(db: CampaignDb, storyId: string, steps: readonly StepInput[]): void {
  const data = db.getSnapshot();
  const story = data.stories[storyId];
  if (!story) return;
  const clock = story.clockId ? data.clocks[story.clockId] : undefined;
  const open = steps
    .filter((step) => step.text.trim())
    .map((step) => {
      const before = clock?.steps.find((old) => old.id === step.id && old.at === null);
      return {
        id: step.id,
        text: step.text.trim(),
        days: step.days > 0 ? step.days : 1,
        delay: before?.delay ?? 0,
        at: null,
        skipped: false,
        needs: before?.needs ?? '',
        runId: before?.runId ?? null,
      };
    });
  if (clock) {
    db.patch('clocks', clock.id, {
      steps: [...clock.steps.filter((step) => step.at !== null), ...open],
    });
    return;
  }
  if (!open.length) return;
  db.batch(() => {
    const created = db.put(
      'clocks',
      createClock({
        title: story.title,
        ownerId: story.ownerId,
        start: data.state.now,
        steps: open,
      }),
    );
    db.patch('stories', storyId, { clockId: created.id });
  });
}

export type ThreadChange = Partial<
  Pick<Thread, 'title' | 'truth' | 'state' | 'refs' | 'known' | 'hints'>
>;

/** Ändert einzelne Angaben eines Fadens. Hinweise ohne Text fallen weg. */
export function patchThread(db: CampaignDb, id: string, change: ThreadChange): void {
  if (!db.getSnapshot().threads[id]) return;
  db.patch('threads', id, {
    ...change,
    ...(change.title !== undefined ? { title: change.title.trim() || 'Faden ohne Namen' } : {}),
    ...(change.refs ? { refs: [...new Set(change.refs)] } : {}),
    ...(change.hints ? { hints: change.hints.filter((hint) => hint.text.trim()) } : {}),
  });
}

/**
 * Löscht eine Geschichte. Ihre Fäden bleiben – als lose Fäden. Ihre Uhr geht mit ihr: Sie ist
 * ein Teil der Geschichte. Was schon eingetreten ist, steht weiter in der Chronik.
 */
export function removeStory(db: CampaignDb, id: string): void {
  const data = db.getSnapshot();
  const story = data.stories[id];
  db.batch(() => {
    for (const thread of Object.values(data.threads))
      if (thread.storyId === id) db.patch('threads', thread.id, { storyId: null });
    if (story?.clockId && data.clocks[story.clockId]) db.remove('clocks', story.clockId);
    db.remove('stories', id);
  });
}

/** Nimmt eine Geschichte oder einen losen Faden ins Spiel – oder wieder heraus. */
export function setInPlay(db: CampaignDb, cardKey: string, on: boolean): void {
  const data = db.getSnapshot();
  const [sort, id] = cardKey.split(':') as [string, string];
  const doc = sort === 'story' ? data.stories[id] : data.threads[id];
  if (!doc || doc.inPlay === on) return;
  db.patch(sort === 'story' ? 'stories' : 'threads', id, { inPlay: on });
}

/** Schreibt den Merkzettel einer Geschichte. */
export function setStoryMemo(db: CampaignDb, storyId: string, memo: string): void {
  const story = db.getSnapshot().stories[storyId];
  if (story && story.memo !== memo) db.patch('stories', storyId, { memo });
}

/** Legt eine Karte oder einen Namen an eine Stelle des Bretts. */
export function placeOnBoard(db: CampaignDb, key: string, x: number, y: number): void {
  const board = db.getSnapshot().state.board;
  db.setState({ board: { ...board, [key]: { x: Math.round(x), y: Math.round(y) } } });
}

/** Räumt das Brett auf: Wayfarer legt alles neu aus. `undo` legt es zurück, wie es war. */
export function tidyBoard(db: CampaignDb): () => void {
  const before = db.getSnapshot().state.board;
  db.setState({ board: {} });
  return () => db.setState({ board: before });
}

/**
 * Heftet eine Person, einen Ort oder eine Fraktion an eine Karte: Sie gehört dann zur Geschichte
 * (oder zum losen Faden) – auf dem Brett verbindet ein Faden beide.
 */
export function pinToCard(db: CampaignDb, cardKey: string, entityId: string): void {
  const data = db.getSnapshot();
  if (!data.entities[entityId]) return;
  const [sort, id] = cardKey.split(':') as [string, string];
  const doc = sort === 'story' ? data.stories[id] : data.threads[id];
  if (!doc || doc.refs.includes(entityId)) return;
  db.patch(sort === 'story' ? 'stories' : 'threads', id, { refs: [...doc.refs, entityId] });
}

/** Löst einen Namen von einer Karte – soweit er nur angeheftet war. */
export function unpinFromCard(db: CampaignDb, cardKey: string, entityId: string): void {
  const data = db.getSnapshot();
  const [sort, id] = cardKey.split(':') as [string, string];
  const doc = sort === 'story' ? data.stories[id] : data.threads[id];
  if (!doc || !doc.refs.includes(entityId)) return;
  db.patch(sort === 'story' ? 'stories' : 'threads', id, {
    refs: doc.refs.filter((ref) => ref !== entityId),
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
