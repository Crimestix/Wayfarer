/**
 * Befehle des Fadenbretts: Geschichten und Fäden anlegen, ändern, löschen; Hinweise abhaken. Was
 * mehrere Dokumente betrifft (eine Geschichte mit ihren Fäden, ein Faden mit seinen Terminen),
 * läuft hier in einem Zug.
 */
import { pauseClock, resumeClock } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import { addFromWriting } from '../welt/writing';
import { threadKey, threadSessionIds } from '../../domain/looseThreads';
import {
  boardCards,
  isLooseThread,
  nameSources,
  storyAttached,
  threadLive,
} from '../../domain/story';
import { storyAncestors } from '../../domain/storySheet';
import { boardWeb, isStoryTied, isTied, ownedPins, pinExists } from '../../domain/threadWeb';
import { AREA_MIN, type BoardArea } from '../../domain/boardAreas';
import {
  createClock,
  createStory,
  createThread,
  newId,
  type CalendarEvent,
  type Entity,
  type EntityKind,
  type Story,
  type StoryRole,
  type StoryScene,
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
 * Legt eine Teilgeschichte an: eine leere Geschichte, die zu einer großen gehört und deren
 * Antreiber übernimmt. Alles Weitere schreibt der Spielleiter auf ihrem Blatt.
 */
export function newSubStory(db: CampaignDb, parentId: string): Story | null {
  const parent = db.getSnapshot().stories[parentId];
  if (!parent) return null;
  return newStory(db, { title: 'Neue Teilgeschichte', ownerId: parent.ownerId, parentId });
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

/** Eine Szene, wie sie geschrieben wird – ob sie gespielt ist, darf fehlen. */
export type SceneInput = Omit<StoryScene, 'done'> & { done?: boolean | undefined };

export type StoryChange = { scenes?: SceneInput[] } & Partial<
  Pick<
    Story,
    | 'title'
    | 'summary'
    | 'ownerId'
    | 'needs'
    | 'stakes'
    | 'refs'
    | 'roles'
    | 'parentId'
    | 'adviceOff'
    | 'heroes'
    | 'entries'
    | 'ending'
    | 'reward'
    | 'memo'
    | 'known'
    | 'closed'
    | 'inPlay'
    | 'notMeant'
  >
>;

/**
 * Ändert einzelne Angaben einer Geschichte. Einstiege und Szenen ohne Text fallen weg, leere
 * Rollen auch; eine Geschichte wird nie Teil ihrer selbst oder eines ihrer eigenen Teile.
 */
export function patchStory(db: CampaignDb, id: string, change: StoryChange): void {
  const data = db.getSnapshot();
  const story = data.stories[id];
  if (!story) return;
  const { scenes, ...rest } = change;
  const clean: Partial<Story> = { ...rest };
  if (change.title !== undefined) clean.title = change.title.trim() || 'Geschichte ohne Namen';
  if (change.refs) clean.refs = [...new Set(change.refs)];
  if (change.roles) {
    clean.roles = {};
    for (const [entityId, role] of Object.entries(change.roles)) {
      const tidy: StoryRole = {
        role: role.role.replace(/\s+/g, ' ').trim(),
        wants: role.wants.trim(),
      };
      if (tidy.role || tidy.wants) clean.roles[entityId] = tidy;
    }
  }
  if (change.parentId !== undefined) {
    const parent = change.parentId ? data.stories[change.parentId] : undefined;
    const circle =
      parent !== undefined &&
      (parent.id === id || storyAncestors(data, parent).some((ancestor) => ancestor.id === id));
    clean.parentId = parent && !circle ? parent.id : null;
  }
  if (change.adviceOff) clean.adviceOff = [...new Set(change.adviceOff)];
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
  if (scenes)
    clean.scenes = scenes
      .filter((scene) => scene.text.trim() || scene.encounterId)
      .map((scene) => ({
        ...scene,
        done: scene.done ?? false,
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
 * Nimmt einen Eintrag zu einer Geschichte: Er steht dann unter „Beteiligte“ – ein Gefährte
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

/**
 * Nimmt einen Eintrag ausdrücklich unter die Beteiligten (`story.refs`) – auch einen, der bisher
 * nur über einen Hinweis, einen Einstieg oder eine Szene dazugehörte. Ein Gefährte kommt unter
 * „Wen es persönlich betrifft“; der Antreiber steht schon da.
 */
export function listInStory(db: CampaignDb, storyId: string, entityId: string): void {
  const data = db.getSnapshot();
  const story = data.stories[storyId];
  const entity = data.entities[entityId];
  if (!story || !entity || story.ownerId === entityId || story.refs.includes(entityId)) return;
  if (entity.kind === 'character') tieHero(db, storyId, entityId);
  else patchStory(db, storyId, { refs: [...story.refs, entityId] });
}

/**
 * Nimmt einen Eintrag wieder von einer Geschichte – soweit er nur dazugenommen war. Seine Rolle
 * geht mit. Gibt `undo` zurück.
 */
export function detachFromStory(db: CampaignDb, storyId: string, entityId: string): () => void {
  const story = db.getSnapshot().stories[storyId];
  if (!story) return () => {};
  const { [entityId]: role, ...roles } = story.roles;
  const index = story.refs.indexOf(entityId);
  const hero = story.heroes.find((entry) => entry.characterId === entityId);
  db.batch(() => {
    if (index >= 0 || role)
      patchStory(db, storyId, { refs: story.refs.filter((ref) => ref !== entityId), roles });
    if (hero) untieHero(db, storyId, entityId);
  });
  return () => {
    const data = db.getSnapshot();
    const now = data.stories[storyId];
    if (!now || !data.entities[entityId]) return;
    db.batch(() => {
      const refs = [...now.refs];
      const listed = index >= 0 && !refs.includes(entityId);
      if (listed) refs.splice(Math.min(index, refs.length), 0, entityId);
      // Die Rolle kommt auch bei dem zurück, der nicht in der Liste stand (der Antreiber, wer
      // über einen Hinweis dazugehört) – außer es steht inzwischen eine neue da.
      const lost = role !== undefined && !now.roles[entityId];
      if (listed || lost)
        patchStory(db, storyId, {
          refs,
          roles: lost ? { ...now.roles, [entityId]: role } : now.roles,
        });
      if (hero) tieHero(db, storyId, entityId, hero.why);
    });
  };
}

/**
 * Schreibt, was ein Beteiligter in dieser Geschichte ist und was er dort will – beides in freien
 * Worten. Leeres fällt weg.
 */
export function setStoryRole(
  db: CampaignDb,
  storyId: string,
  entityId: string,
  change: Partial<StoryRole>,
): void {
  const story = db.getSnapshot().stories[storyId];
  if (!story) return;
  const before = story.roles[entityId] ?? { role: '', wants: '' };
  patchStory(db, storyId, { roles: { ...story.roles, [entityId]: { ...before, ...change } } });
}

/** „Brauche ich nicht“: wählt einen Rat ab – oder nimmt ihn wieder auf. */
export function setAdviceOff(db: CampaignDb, storyId: string, key: string, off: boolean): void {
  const story = db.getSnapshot().stories[storyId];
  if (!story || story.adviceOff.includes(key) === off) return;
  patchStory(db, storyId, {
    adviceOff: off ? [...story.adviceOff, key] : story.adviceOff.filter((entry) => entry !== key),
  });
}

/** Hakt eine Szene ab (gespielt) – oder nimmt den Haken wieder weg. */
export function setSceneDone(db: CampaignDb, storyId: string, sceneId: string, done: boolean) {
  const story = db.getSnapshot().stories[storyId];
  if (!story || !story.scenes.some((scene) => scene.id === sceneId && scene.done !== done)) return;
  db.patch('stories', storyId, {
    scenes: story.scenes.map((scene) => (scene.id === sceneId ? { ...scene, done } : scene)),
  });
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
  /** Woran die Gruppe den Schritt merkt; ohne Angabe bleibt, was dasteht. */
  sign?: string | undefined;
}

/**
 * Schreibt die Schritte, die bei der Uhr einer Geschichte noch ausstehen. Hat die Geschichte noch
 * keine Uhr, entsteht sie mit dem ersten Schritt – nur für die Spielleitung, und sie steht noch:
 * Nichts tritt ein, bis der Spielleiter sie laufen lässt (`runStoryClock`). Was schon eingetreten
 * ist, bleibt; Bedingungen und Aufschub eines Schrittes auch.
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
        sign: step.sign !== undefined ? step.sign.trim() : (before?.sign ?? ''),
      };
    });
  if (clock) {
    const happened = clock.steps.filter((step) => step.at !== null);
    // Stand kein Schritt mehr aus, zählt die Frist des ersten neuen ab jetzt – nicht ab dem
    // letzten Schritt (oder dem Beginn der Uhr), der lange zurückliegen kann: Sonst träte er mit
    // dem nächsten Zeitsprung sofort ein. Bei einer stehenden Uhr zählt sie ab dem Anhalten.
    if (open.length && happened.length === clock.steps.length) {
      const anchor = happened[happened.length - 1]?.at ?? clock.start;
      const since = (clock.pausedAt ?? data.state.now) - anchor;
      if (since > 0) open[0] = { ...open[0]!, delay: open[0]!.delay + since };
    }
    db.patch('clocks', clock.id, { steps: [...happened, ...open] });
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
        // Beim Schreiben soll nichts von selbst eintreten: Die Uhr steht, bis sie gestartet wird.
        pausedAt: data.state.now,
        steps: open,
      }),
    );
    db.patch('stories', storyId, { clockId: created.id });
  });
}

/**
 * Lässt die Uhr einer Geschichte laufen oder hält sie an. Eine Uhr, die noch nie lief, beginnt
 * jetzt: Die Frist ihres ersten Schrittes zählt ab dem Start. Sonst gilt die Mechanik der Uhr
 * (`pauseClock`, `resumeClock`) – die Standzeit schiebt den nächsten Schritt hinaus.
 */
export function runStoryClock(db: CampaignDb, storyId: string, on: boolean): void {
  const data = db.getSnapshot();
  const story = data.stories[storyId];
  const clock = story?.clockId ? data.clocks[story.clockId] : undefined;
  if (!clock) return;
  if (!on) return pauseClock(db, clock.id);
  if (clock.pausedAt === null) return;
  const fresh =
    !clock.blocked &&
    clock.pausedAt <= clock.start &&
    clock.steps.every((step) => step.at === null);
  if (fresh) db.patch('clocks', clock.id, { start: data.state.now, pausedAt: null });
  else resumeClock(db, clock.id);
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

const spotKey = (threadId: string) => `thread:${threadId}`;

/** Nimmt die Stellen dieser Fäden vom Brett und gibt zurück, wie sie wiederkommen. */
function takeSpots(db: CampaignDb, threadIds: readonly string[]): () => void {
  const board = db.getSnapshot().state.board;
  const taken = threadIds.filter((id) => board[spotKey(id)] !== undefined);
  if (!taken.length) return () => {};
  const keys = new Set(taken.map(spotKey));
  db.setState({
    board: Object.fromEntries(Object.entries(board).filter(([key]) => !keys.has(key))),
  });
  return () => {
    const now = db.getSnapshot().state.board;
    const back = taken.filter((id) => now[spotKey(id)] === undefined);
    if (back.length)
      db.setState({
        board: {
          ...now,
          ...Object.fromEntries(back.map((id) => [spotKey(id), board[spotKey(id)]!])),
        },
      });
  };
}

/**
 * Hängt einen Faden an eine Geschichte (er wird eine ihrer Fragen) oder löst ihn von ihr (er
 * wird ein loser Faden und steht in der Liste neben dem Brett). Als Frage liegt er nicht mehr
 * für sich auf dem Brett. Gibt `undo` zurück – null, wenn sich nichts ändert.
 */
export function moveThread(
  db: CampaignDb,
  threadId: string,
  storyId: string | null,
): (() => void) | null {
  const data = db.getSnapshot();
  const thread = data.threads[threadId];
  if (!thread || (storyId !== null && !data.stories[storyId])) return null;
  const before = thread.storyId;
  if (before === storyId) return null;
  const restoreSpot = db.batch(() => {
    db.patch('threads', threadId, { storyId, ...(storyId !== null ? { onBoard: false } : {}) });
    return storyId !== null ? takeSpots(db, [threadId]) : () => {};
  });
  return () =>
    db.batch(() => {
      const now = db.getSnapshot();
      if (now.threads[threadId]?.storyId !== storyId) return;
      db.patch('threads', threadId, {
        storyId: before && now.stories[before] ? before : null,
        onBoard: thread.onBoard,
      });
      restoreSpot();
    });
}

/** Der erste Ort und die erste Person, Fraktion oder Familie, an denen ein Faden hängt. */
function threadAnchors(db: CampaignDb, thread: Thread) {
  const data = db.getSnapshot();
  const ids = [...thread.refs, ...thread.hints.flatMap((hint) => [hint.placeId, hint.sourceId])];
  const first = (kinds: readonly string[]) =>
    ids.find((id) => id && kinds.includes(data.entities[id]?.kind ?? '')) ?? null;
  return { placeId: first(['place']), sourceId: first(['person', 'faction', 'family']) };
}

/** Nimmt einen Faden weg und gibt zurück, wie er mit seinen Terminen wiederkommt. */
function takeThread(db: CampaignDb, thread: Thread, toThreadId: string | null): () => void {
  const events: CalendarEvent[] = Object.values(db.getSnapshot().events).filter(
    (event) => event.threadId === thread.id,
  );
  for (const event of events) db.patch('events', event.id, { threadId: toThreadId });
  db.remove('threads', thread.id);
  return () => {
    const now = db.getSnapshot();
    if (!now.threads[thread.id]) db.put('threads', { ...thread, rev: 0 });
    for (const event of events)
      if (now.events[event.id]?.threadId === toThreadId)
        db.patch('events', event.id, { threadId: thread.id });
  };
}

/**
 * Macht aus einem losen Faden einen Hinweis zu einer Frage: Sein Satz wird der Text des
 * Hinweises, sein erster Ort das „Wo?“, seine erste Person das „Wer weiß es?“; kennt die Gruppe
 * den Faden, hat sie den Hinweis. Der Faden selbst ist danach weg; seine Termine hängen an der
 * Frage. Gibt `undo` zurück – null, wenn es Faden oder Frage nicht gibt.
 */
export function threadToHint(
  db: CampaignDb,
  threadId: string,
  questionId: string,
): (() => void) | null {
  const data = db.getSnapshot();
  const thread = data.threads[threadId];
  const question = data.threads[questionId];
  if (!thread || !question || threadId === questionId) return null;
  const hintId = newId();
  const restore = db.batch(() => {
    db.patch('threads', questionId, {
      hints: [
        ...question.hints,
        { id: hintId, text: thread.title, ...threadAnchors(db, thread), found: false },
      ],
    });
    if (thread.known) setHintFound(db, questionId, hintId, true);
    return takeThread(db, thread, questionId);
  });
  return () =>
    db.batch(() => {
      const now = db.getSnapshot().threads[questionId];
      if (now)
        db.patch('threads', questionId, {
          hints: now.hints.filter((hint) => hint.id !== hintId),
          known: question.known,
          state: now.state === 'active' && question.state === 'open' ? 'open' : now.state,
        });
      restore();
    });
}

/**
 * Macht aus einem losen Faden einen Einstieg einer Geschichte: Sein Satz wird der Text, sein
 * erster Ort das „Wo?“. Der Faden selbst ist danach weg. Gibt `undo` zurück.
 */
export function threadToEntry(
  db: CampaignDb,
  threadId: string,
  storyId: string,
): (() => void) | null {
  const data = db.getSnapshot();
  const thread = data.threads[threadId];
  const story = data.stories[storyId];
  if (!thread || !story) return null;
  const entryId = newId();
  const restore = db.batch(() => {
    db.patch('stories', storyId, {
      entries: [
        ...story.entries,
        {
          id: entryId,
          text: thread.title,
          placeId: threadAnchors(db, thread).placeId,
          standing: 'any' as const,
        },
      ],
    });
    return takeThread(db, thread, null);
  });
  return () =>
    db.batch(() => {
      const now = db.getSnapshot().stories[storyId];
      if (now)
        db.patch('stories', storyId, {
          entries: now.entries.filter((entry) => entry.id !== entryId),
        });
      restore();
    });
}

/**
 * Was ein Faden außer seinem Satz trägt: Hinweise gehen nur mit ihm. Hat er welche, bleibt er
 * als Frage der Geschichte stehen (nichts geht verloren); sonst ist er danach weg.
 */
function settleThread(db: CampaignDb, thread: Thread, storyId: string): () => void {
  if (thread.hints.length > 0) return moveThread(db, thread.id, storyId) ?? (() => {});
  return takeThread(db, thread, null);
}

/**
 * Macht aus einem losen Faden eine Szene der Geschichte: Sein Satz wird ihr Text (mit dem, was
 * dahintersteckt), sein erster Ort ihr „Wo“. Gibt `undo` zurück – null, wenn es Faden oder
 * Geschichte nicht gibt.
 */
export function threadToScene(
  db: CampaignDb,
  threadId: string,
  storyId: string,
): (() => void) | null {
  const data = db.getSnapshot();
  const thread = data.threads[threadId];
  const story = data.stories[storyId];
  if (!thread || !story) return null;
  const sceneId = newId();
  const truth = thread.truth.trim();
  const restore = db.batch(() => {
    db.patch('stories', storyId, {
      scenes: [
        ...story.scenes,
        {
          id: sceneId,
          text: truth ? `${thread.title} – ${truth}` : thread.title,
          encounterId: null,
          odds: 'maybe' as const,
          placeId: threadAnchors(db, thread).placeId,
          done: false,
        },
      ],
    });
    return settleThread(db, thread, storyId);
  });
  return () =>
    db.batch(() => {
      const now = db.getSnapshot().stories[storyId];
      if (now)
        db.patch('stories', storyId, {
          scenes: now.scenes.filter((scene) => scene.id !== sceneId),
        });
      restore();
    });
}

/** Wen oder was ein Faden als Beteiligten meint: einen Eintrag – oder seinen Satz als neuen. */
export type CastPick = { entityId: string } | { kind: EntityKind };

/**
 * Ein loser Faden ist ein Name, der zur Geschichte gehört („Kriegslager der Duergar“): Der
 * Eintrag kommt zu ihren Beteiligten (`attachToStory`); gibt es ihn noch nicht, entsteht er als
 * Platzhalter der Geschichte (`addFromWriting` – nie ein zweiter für einen Namen). Was hinter dem
 * Faden steckt, kommt in das Geheimnis eines neuen Eintrags. Gibt `undo` zurück.
 */
export function threadToCast(
  db: CampaignDb,
  threadId: string,
  storyId: string,
  pick: CastPick,
): { undo: () => void; entity: Entity; created: boolean } | null {
  const data = db.getSnapshot();
  const thread = data.threads[threadId];
  const story = data.stories[storyId];
  if (!thread || !story) return null;
  return db.batch(() => {
    const made =
      'entityId' in pick
        ? data.entities[pick.entityId]
          ? { entity: data.entities[pick.entityId]!, created: false, undo: () => {} }
          : null
        : addFromWriting(db, { name: thread.title, kind: pick.kind, storyId });
    if (!made) return null;
    const { entity, created } = made;
    const truth = thread.truth.trim();
    if (created && truth) db.patch('entities', entity.id, { secret: truth });
    const before = db.getSnapshot().stories[storyId]!;
    attachToStory(db, storyId, entity.id);
    const restore = settleThread(db, thread, storyId);
    return {
      entity,
      created,
      undo: () =>
        db.batch(() => {
          const now = db.getSnapshot().stories[storyId];
          if (now)
            db.patch('stories', storyId, {
              refs: before.refs,
              heroes: before.heroes,
            });
          restore();
          made.undo();
        }),
    };
  });
}

/**
 * Löscht eine Geschichte. Ihre Fäden bleiben – als lose Fäden. Ihre Uhr geht mit ihr: Sie ist
 * ein Teil der Geschichte. Ihre Wegenetze bleiben für sich stehen, ihre Teilgeschichten rücken
 * eine Stufe hinauf. Was schon eingetreten ist, steht weiter in der Chronik.
 */
export function removeStory(db: CampaignDb, id: string): void {
  const data = db.getSnapshot();
  const story = data.stories[id];
  db.batch(() => {
    for (const thread of Object.values(data.threads))
      if (thread.storyId === id) db.patch('threads', thread.id, { storyId: null });
    for (const net of Object.values(data.nets))
      if (net.storyId === id) db.patch('nets', net.id, { storyId: null });
    for (const part of Object.values(data.stories))
      if (part.parentId === id && part.id !== id)
        db.patch('stories', part.id, { parentId: story?.parentId ?? null });
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

/**
 * Räumt das Brett auf: Wayfarer legt alles neu aus. Lose Fäden, die dort eine Stelle hatten,
 * bleiben auf dem Brett. `undo` legt es zurück, wie es war.
 */
export function tidyBoard(db: CampaignDb): () => void {
  const data = db.getSnapshot();
  const before = data.state.board;
  const kept = Object.values(data.threads).filter(
    (thread) =>
      isLooseThread(data, thread) && !thread.onBoard && before[spotKey(thread.id)] !== undefined,
  );
  // Frei hingelegte Namen und Artikel liegen nur, weil sie eine Stelle haben – die bleibt.
  const owned = ownedPins(boardWeb(data, boardCards(data)));
  const free = Object.fromEntries(
    Object.entries(before).filter(([key]) => pinExists(data, key) && !owned.has(key)),
  );
  db.batch(() => {
    for (const thread of kept) db.patch('threads', thread.id, { onBoard: true });
    db.setState({ board: free });
  });
  return () =>
    db.batch(() => {
      db.setState({ board: before });
      for (const thread of kept)
        if (db.getSnapshot().threads[thread.id]) db.patch('threads', thread.id, { onBoard: false });
    });
}

/**
 * Legt einen losen Faden als Karte aufs Brett (`at` = wohin) oder nimmt ihn wieder herunter – dann
 * steht er nur noch in der Liste. Ein Faden im Spiel liegt immer auf dem Brett. Gibt `undo`
 * zurück – null, wenn sich nichts ändert.
 */
export function setThreadOnBoard(
  db: CampaignDb,
  threadId: string,
  on: boolean,
  at?: { x: number; y: number },
): (() => void) | null {
  const data = db.getSnapshot();
  const thread = data.threads[threadId];
  if (!thread) return null;
  const spot = data.state.board[spotKey(threadId)];
  const was = thread.onBoard || spot !== undefined;
  if (was === on && !(on && at)) return null;
  const restoreSpot = db.batch(() => {
    if (thread.onBoard !== on) db.patch('threads', threadId, { onBoard: on });
    if (!on) return takeSpots(db, [threadId]);
    if (at) placeOnBoard(db, spotKey(threadId), at.x, at.y);
    return () => {
      if (!at) return;
      const { [spotKey(threadId)]: _placed, ...rest } = db.getSnapshot().state.board;
      db.setState({ board: spot ? { ...rest, [spotKey(threadId)]: spot } : rest });
    };
  });
  return () =>
    db.batch(() => {
      if (db.getSnapshot().threads[threadId])
        db.patch('threads', threadId, { onBoard: thread.onBoard });
      restoreSpot();
    });
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
> &
  Partial<Pick<Thread, 'sessionIds' | 'articleId'>>;

/**
 * Legt einen Faden an oder ändert ihn. Hinweise ohne Text fallen weg. Kommt er dabei an eine
 * Geschichte, liegt er nicht mehr für sich auf dem Brett.
 */
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
  const data = db.getSnapshot();
  if (!id || !data.threads[id]) return db.put('threads', createThread(clean));
  const bound = clean.storyId !== null && data.stories[clean.storyId] !== undefined;
  return db.batch(() => {
    if (bound) takeSpots(db, [id]);
    return db.patch('threads', id, { ...clean, ...(bound ? { onBoard: false } : {}) });
  });
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

// ── Lose Fäden aufräumen ───────────────────────────────────────────────────

const existing = (db: CampaignDb, ids: readonly string[]): Thread[] => {
  const threads = db.getSnapshot().threads;
  return [...new Set(ids)]
    .map((id) => threads[id])
    .filter((thread): thread is Thread => thread !== undefined);
};

/** Setzt den Zustand mehrerer Fäden in einem Zug („Ruht“, „Erledigt“). Gibt `undo` zurück. */
export function setThreadsState(
  db: CampaignDb,
  ids: readonly string[],
  state: ThreadState,
): (() => void) | null {
  const changed = existing(db, ids).filter((thread) => thread.state !== state);
  if (!changed.length) return null;
  db.batch(() => {
    for (const thread of changed) db.patch('threads', thread.id, { state });
  });
  return () =>
    db.batch(() => {
      for (const thread of changed)
        if (db.getSnapshot().threads[thread.id]?.state === state)
          db.patch('threads', thread.id, { state: thread.state });
    });
}

/** Hängt mehrere Fäden an eine Geschichte – jeder wird eine ihrer Fragen. Gibt `undo` zurück. */
export function moveThreads(
  db: CampaignDb,
  ids: readonly string[],
  storyId: string,
): (() => void) | null {
  if (!db.getSnapshot().stories[storyId]) return null;
  const undos = db.batch(() =>
    existing(db, ids)
      .map((thread) => moveThread(db, thread.id, storyId))
      .filter((undo): undo is () => void => undo !== null),
  );
  if (!undos.length) return null;
  return () => db.batch(() => [...undos].reverse().forEach((undo) => undo()));
}

/** Löscht mehrere Fäden. Ihre Termine bleiben – ohne Faden. Gibt `undo` zurück. */
export function removeThreads(db: CampaignDb, ids: readonly string[]): (() => void) | null {
  const threads = existing(db, ids);
  if (!threads.length) return null;
  const undos = db.batch(() => [
    takeSpots(
      db,
      threads.map((thread) => thread.id),
    ),
    ...threads.map((thread) => takeThread(db, thread, null)),
  ]);
  return () => db.batch(() => [...undos].reverse().forEach((undo) => undo()));
}

/**
 * Macht aus losen Fäden eine Geschichte: Sie entsteht mit dem Namen, den der Spielleiter
 * geschrieben hat (ohne Namen als „Neue Geschichte“), die Fäden werden ihre Fragen, und woran
 * sie hängen, gehört zu den Beteiligten. Alles Weitere schreibt er auf ihrem Blatt. `undo` löst
 * die Fäden wieder und nimmt die Geschichte weg.
 */
export function storyFromThreads(
  db: CampaignDb,
  ids: readonly string[],
  title: string,
): { story: Story; undo: () => void } | null {
  const data = db.getSnapshot();
  const threads = existing(db, ids);
  if (!threads.length) return null;
  return db.batch(() => {
    const refs = [...new Set(threads.flatMap((thread) => thread.refs))].filter(
      (id) => data.entities[id] !== undefined,
    );
    const story = newStory(db, { title: title.trim() || 'Neue Geschichte', refs });
    const undo = moveThreads(
      db,
      threads.map((thread) => thread.id),
      story.id,
    );
    return {
      story,
      undo: () =>
        db.batch(() => {
          undo?.();
          if (db.getSnapshot().stories[story.id]) removeStory(db, story.id);
        }),
    };
  });
}

const ALIVE: ThreadState[] = ['active', 'open', 'dormant'];

/**
 * Die Verbindungen mehrerer Fäden zusammen, als stünden sie an `selfId`: jede nur einmal (das
 * erste Wort, das dasteht, gilt), nie zu sich selbst oder zu `skip`; Verbindungen zu `gone`
 * zeigen danach auf `into`.
 */
function mergedTies(
  threads: readonly Thread[],
  selfId: string,
  skip: ReadonlySet<string>,
  gone: ReadonlySet<string> = new Set(),
  into = selfId,
): Thread['ties'] {
  const out = new Map<string, string>();
  for (const thread of threads)
    for (const tie of thread.ties) {
      const id = gone.has(tie.id) ? into : tie.id;
      if (id === selfId || skip.has(id)) continue;
      if (!out.get(id)) out.set(id, tie.word);
    }
  return [...out].map(([id, word]) => ({ id, word }));
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Legt Fäden zusammen, die dasselbe sagen: `keepId` bleibt und bekommt von den anderen, was ihm
 * fehlt – Hinweise (gleiche nur einmal; gefunden bleibt gefunden), woran sie hängen, was
 * dahintersteckt (Verschiedenes untereinander), die Sessions, aus denen sie stammen, ihre
 * Termine und gefundenen Hinweise der Chronik. Kennt die Gruppe einen, kennt sie ihn; ist einer
 * im Spiel oder weiter (aktiv vor offen vor ruhend), gilt das. Gehört keiner zu einer Geschichte
 * außer einem der anderen, kommt er zu dessen Geschichte. Die anderen sind danach weg. Gibt
 * `undo` zurück – null, wenn es nichts zusammenzulegen gibt.
 */
export function mergeThreads(
  db: CampaignDb,
  keepId: string,
  otherIds: readonly string[],
): (() => void) | null {
  const data = db.getSnapshot();
  const keep = data.threads[keepId];
  const others = existing(
    db,
    otherIds.filter((id) => id !== keepId),
  );
  if (!keep || !others.length) return null;

  const hintKey = (hint: Thread['hints'][number]) =>
    `${threadKey(hint.text)}|${hint.placeId ?? ''}|${hint.sourceId ?? ''}`;
  const hints = keep.hints.map((hint) => ({ ...hint }));
  /** Hinweise der anderen, die es beim Bleibenden schon gab: ihre Kennung dort. */
  const hintMoved = new Map<string, string>();
  for (const other of others)
    for (const hint of other.hints) {
      const twin = hints.find((entry) => hintKey(entry) === hintKey(hint));
      if (!twin) hints.push({ ...hint });
      else {
        hintMoved.set(hint.id, twin.id);
        twin.found = twin.found || hint.found;
      }
    }
  const truths: string[] = [];
  for (const text of [keep.truth, ...others.map((other) => other.truth)]) {
    const clean = text.trim();
    if (clean && !truths.some((entry) => threadKey(entry) === threadKey(clean))) truths.push(clean);
  }
  const all = [keep, ...others];
  const story = all.find((thread) => !isLooseThread(data, thread))?.storyId ?? null;
  const loose = isLooseThread(data, keep) && story === null;
  const merged = {
    hints,
    truth: truths.join('\n'),
    refs: [...new Set(all.flatMap((thread) => thread.refs))],
    known: all.some((thread) => thread.known),
    inPlay: all.some((thread) => thread.inPlay),
    state: threadLive(keep)
      ? (ALIVE.find((state) => all.some((thread) => thread.state === state)) ?? keep.state)
      : keep.state,
    storyId: isLooseThread(data, keep) ? story : keep.storyId,
    onBoard:
      loose &&
      all.some((thread) => thread.onBoard || data.state.board[spotKey(thread.id)] !== undefined),
    sessionIds: [...new Set(all.flatMap((thread) => threadSessionIds(data, thread)))],
    articleId: all.find((thread) => thread.articleId)?.articleId ?? null,
    articleIds: [...new Set(all.flatMap((thread) => thread.articleIds))],
    ties: mergedTies(all, keepId, new Set(others.map((other) => other.id))),
  } satisfies Partial<Thread>;
  const before = Object.fromEntries(
    (Object.keys(merged) as (keyof typeof merged)[]).map((key) => [key, keep[key]]),
  ) as Partial<Thread>;

  const gone = new Set(others.map((other) => other.id));
  const clues = Object.values(data.chronicle).filter(
    (entry) => entry.clue?.threadId && gone.has(entry.clue.threadId),
  );
  // Was an den anderen hing (Verbindung, Hinweis führt zu), hängt danach am Bleibenden.
  const pointing = Object.values(data.threads).filter(
    (thread) =>
      !gone.has(thread.id) &&
      thread.id !== keepId &&
      (thread.ties.some((tie) => gone.has(tie.id)) ||
        thread.hints.some((hint) => hint.leadsTo && gone.has(hint.leadsTo))),
  );
  const undos = db.batch(() => {
    db.patch('threads', keepId, merged);
    for (const thread of pointing)
      db.patch('threads', thread.id, {
        ties: mergedTies([thread], thread.id, new Set(), gone, keepId),
        hints: thread.hints.map((hint) =>
          hint.leadsTo && gone.has(hint.leadsTo) ? { ...hint, leadsTo: keepId } : hint,
        ),
      });
    for (const entry of clues)
      db.patch('chronicle', entry.id, {
        clue: {
          ...entry.clue!,
          threadId: keepId,
          hintId: entry.clue!.hintId
            ? (hintMoved.get(entry.clue!.hintId) ?? entry.clue!.hintId)
            : null,
        },
      });
    return [
      takeSpots(
        db,
        others.map((other) => other.id),
      ),
      ...others.map((other) => takeThread(db, other, keepId)),
    ];
  });
  return () =>
    db.batch(() => {
      const now = db.getSnapshot();
      const kept = now.threads[keepId];
      // Nur zurück, was noch so dasteht, wie das Zusammenlegen es hinterließ.
      if (kept) {
        const back: Partial<Thread> = {};
        for (const key of Object.keys(merged) as (keyof typeof merged)[])
          if (same(kept[key], merged[key])) Object.assign(back, { [key]: before[key] });
        if (Object.keys(back).length) db.patch('threads', keepId, back);
      }
      for (const entry of clues)
        if (now.chronicle[entry.id]?.clue?.threadId === keepId)
          db.patch('chronicle', entry.id, { clue: entry.clue });
      for (const thread of pointing)
        if (now.threads[thread.id])
          db.patch('threads', thread.id, { ties: thread.ties, hints: thread.hints });
      [...undos].reverse().forEach((undo) => undo());
    });
}

/** „Sind verschieden“: Diese Gruppe meldet `threadTwins` nicht mehr. Gibt `undo` zurück. */
export function markTwinsApart(db: CampaignDb, key: string): () => void {
  const before = db.getSnapshot().state.twinsApart;
  if (!before.includes(key)) db.setState({ twinsApart: [...before, key] });
  return () =>
    db.setState({
      twinsApart: db.getSnapshot().state.twinsApart.filter((entry) => entry !== key),
    });
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

// ── Das Netz der Fäden ─────────────────────────────────────────────────────

/**
 * Verbindet zwei Fäden – gleich, zu welcher Geschichte sie gehören. Die Verbindung steht am
 * ersten; gibt es sie schon (auch am anderen), bekommt sie nur das neue Wort, wenn eins da ist.
 * Gibt `undo` zurück – null, wenn sich nichts ändert.
 */
export function tieThreads(
  db: CampaignDb,
  aId: string,
  bId: string,
  word = '',
): (() => void) | null {
  const data = db.getSnapshot();
  const [a, b] = [data.threads[aId], data.threads[bId]];
  if (!a || !b || aId === bId) return null;
  const clean = word.trim();
  if (isTied(data, aId, bId)) return clean ? setTieWord(db, aId, bId, clean) : null;
  db.patch('threads', aId, { ties: [...a.ties, { id: bId, word: clean }] });
  return () => {
    const now = db.getSnapshot().threads[aId];
    if (now) db.patch('threads', aId, { ties: now.ties.filter((tie) => tie.id !== bId) });
  };
}

/** Löst die Verbindung zweier Fäden – an welchem der beiden sie auch steht. Gibt `undo` zurück. */
export function untieThreads(db: CampaignDb, aId: string, bId: string): (() => void) | null {
  const data = db.getSnapshot();
  const holders = [data.threads[aId], data.threads[bId]].filter(
    (thread): thread is Thread =>
      thread !== undefined && thread.ties.some((tie) => tie.id === (thread.id === aId ? bId : aId)),
  );
  if (!holders.length) return null;
  db.batch(() => {
    for (const thread of holders) {
      const other = thread.id === aId ? bId : aId;
      db.patch('threads', thread.id, { ties: thread.ties.filter((tie) => tie.id !== other) });
    }
  });
  return () =>
    db.batch(() => {
      for (const thread of holders)
        if (db.getSnapshot().threads[thread.id])
          db.patch('threads', thread.id, { ties: thread.ties });
    });
}

/** Ändert das Wort einer Verbindung. Gibt `undo` zurück – null, wenn es sie nicht gibt. */
export function setTieWord(
  db: CampaignDb,
  aId: string,
  bId: string,
  word: string,
): (() => void) | null {
  const data = db.getSnapshot();
  const holder = [data.threads[aId], data.threads[bId]].find(
    (thread) => thread?.ties.some((tie) => tie.id === (thread.id === aId ? bId : aId)) === true,
  );
  if (!holder) return null;
  const other = holder.id === aId ? bId : aId;
  const clean = word.trim();
  if (holder.ties.find((tie) => tie.id === other)?.word === clean) return null;
  db.patch('threads', holder.id, {
    ties: holder.ties.map((tie) => (tie.id === other ? { ...tie, word: clean } : tie)),
  });
  return () => {
    if (db.getSnapshot().threads[holder.id]) db.patch('threads', holder.id, { ties: holder.ties });
  };
}

/** Klappt eine Geschichte auf dem Brett auf (ihre Fäden als Knoten) oder zu. */
export function setStoryUnfolded(db: CampaignDb, storyId: string, unfolded: boolean): void {
  const story = db.getSnapshot().stories[storyId];
  if (story && story.unfolded !== unfolded) db.patch('stories', storyId, { unfolded });
}

/** Was eine auf dem Brett gezogene Schnur bewirkt hat – oder warum sie nichts bewirkt. */
export type BoardConnect =
  | { done: true; title: string; body: string; undo: () => void }
  /** Zwei Namen: Das ist eine Beziehung der Welt – sie wird im Fenster dafür eingetragen. */
  | { done: false; relate: { fromId: string; toId: string } }
  /** Zwei Geschichten: verbinden oder als Teilgeschichte einhängen – das wählt der Spielleiter. */
  | { done: false; choose: { fromId: string; toId: string } }
  /** Nichts geschehen; `note` sagt warum (leer = ins Leere gezogen). */
  | { done: false; note: string };

/** Die Kennung des Fadens hinter einem Schlüssel des Bretts (`knot:`, `thread:`), sonst null. */
export const threadOfKey = (key: string): string | null =>
  key.startsWith('knot:') || key.startsWith('thread:') ? key.slice(key.indexOf(':') + 1) : null;

/**
 * Eine Schnur, frei auf dem Brett gezogen, von `fromKey` nach `toKey` (`story:`, `thread:`,
 * `knot:`, `node:`): Faden an Faden verbindet; ein Name an einem Faden oder einer Geschichte
 * hängt dort an; ein loser Faden an einer Geschichte wird ihre Frage. Zwei Namen sind eine
 * Beziehung der Welt – dafür öffnet sich das Fenster. Alles mit Rückgängig.
 */
export function connectOnBoard(db: CampaignDb, fromKey: string, toKey: string): BoardConnect {
  const data = db.getSnapshot();
  const none: BoardConnect = { done: false, note: '' };
  if (fromKey === toKey) return none;
  const title = (key: string): string => {
    const threadId = threadOfKey(key);
    if (threadId) return data.threads[threadId]?.title ?? '';
    if (key.startsWith('story:')) return data.stories[key.slice(6)]?.title ?? '';
    if (key.startsWith('article:')) return data.articles[key.slice(8)]?.title ?? '';
    return data.entities[key.slice(5)]?.name ?? '';
  };
  const [fromThread, toThread] = [threadOfKey(fromKey), threadOfKey(toKey)];
  if (fromThread && toThread) {
    if (fromThread === toThread) return none;
    if (isTied(data, fromThread, toThread))
      return {
        done: false,
        note: `„${title(fromKey)}“ und „${title(toKey)}“ sind schon verbunden.`,
      };
    const undo = tieThreads(db, fromThread, toThread);
    return undo
      ? {
          done: true,
          title: 'Fäden verbunden',
          body: `„${title(fromKey)}“ – „${title(toKey)}“`,
          undo,
        }
      : none;
  }
  const isPin = (key: string) => key.startsWith('node:') || key.startsWith('article:');
  const articleKey = [fromKey, toKey].find((key) => key.startsWith('article:'));
  const articleOther = articleKey === fromKey ? toKey : fromKey;
  if (articleKey && isPin(articleOther))
    return {
      done: false,
      note: 'Ein Artikel hängt an Fäden und Geschichten. Mit Namen verbindet ihn sein Text: Verweise im Artikel schreiben.',
    };
  if (articleKey) {
    const articleId = articleKey.slice(8);
    const threadId = threadOfKey(articleOther);
    const sort = threadId ? 'threads' : articleOther.startsWith('story:') ? 'stories' : null;
    const docId = threadId ?? articleOther.slice(6);
    const doc =
      sort === 'threads'
        ? data.threads[docId]
        : sort === 'stories'
          ? data.stories[docId]
          : undefined;
    if (!sort || !doc || !data.articles[articleId]) return none;
    if (doc.articleIds.includes(articleId))
      return {
        done: false,
        note: `„${title(articleKey)}“ hängt schon an „${title(articleOther)}“.`,
      };
    const undo = setArticleOn(db, sort, docId, articleId, true);
    return undo
      ? {
          done: true,
          title: 'Artikel zugeordnet',
          body: `„${title(articleKey)}“ gehört jetzt zu „${title(articleOther)}“.`,
          undo,
        }
      : none;
  }
  const nodeKey = [fromKey, toKey].find((key) => key.startsWith('node:'));
  const otherKey = nodeKey === fromKey ? toKey : fromKey;
  if (nodeKey && otherKey.startsWith('node:'))
    return { done: false, relate: { fromId: fromKey.slice(5), toId: toKey.slice(5) } };
  if (nodeKey) {
    const entityId = nodeKey.slice(5);
    const threadId = threadOfKey(otherKey);
    const cardKey = threadId ? `thread:${threadId}` : otherKey;
    const [sort, id] = cardKey.split(':') as [string, string];
    const doc = sort === 'story' ? data.stories[id] : data.threads[id];
    if (!doc || !data.entities[entityId]) return none;
    if (doc.refs.includes(entityId))
      return { done: false, note: `${title(nodeKey)} hängt schon an „${title(otherKey)}“.` };
    pinToCard(db, cardKey, entityId);
    return {
      done: true,
      title: 'Angeheftet',
      body: `${title(nodeKey)} hängt jetzt an „${title(otherKey)}“.`,
      undo: () => unpinFromCard(db, cardKey, entityId),
    };
  }
  const storyKey = [fromKey, toKey].find((key) => key.startsWith('story:'));
  const threadKeyOf = [fromKey, toKey].find((key) => threadOfKey(key) !== null);
  if (storyKey && threadKeyOf) {
    const thread = data.threads[threadOfKey(threadKeyOf)!];
    const storyId = storyKey.slice(6);
    if (!thread || !data.stories[storyId] || thread.storyId === storyId) return none;
    if (!isLooseThread(data, thread))
      return {
        done: false,
        note: `„${thread.title}“ gehört zu „${data.stories[thread.storyId!]!.title}“. Klapp „${title(storyKey)}“ auf und zieh die Schnur von Faden zu Faden.`,
      };
    const undo = moveThread(db, thread.id, storyId);
    return undo
      ? {
          done: true,
          title: 'An die Geschichte gehängt',
          body: `„${thread.title}“ ist jetzt eine Frage von „${title(storyKey)}“.`,
          undo,
        }
      : none;
  }
  const stories = [fromKey, toKey].every((key) => key.startsWith('story:'));
  if (stories) {
    const [a, b] = [fromKey.slice(6), toKey.slice(6)];
    if (!data.stories[a] || !data.stories[b]) return none;
    return { done: false, choose: { fromId: a, toId: b } };
  }
  return none;
}

// ── Das Brett anfassen: mehrere zugleich, Schnüre lösen, schnell schreiben ─────

/** Legt mehrere Stücke auf einmal an neue Stellen (gemeinsam verschoben). */
export function placeManyOnBoard(
  db: CampaignDb,
  spots: Readonly<Record<string, { x: number; y: number }>>,
): void {
  const board = db.getSnapshot().state.board;
  const next = { ...board };
  for (const [key, at] of Object.entries(spots))
    next[key] = { x: Math.round(at.x), y: Math.round(at.y) };
  db.setState({ board: next });
}

/** Wohin ein Hinweis führt – setzen oder lösen (null). Gibt `undo` zurück. */
export function setHintLead(
  db: CampaignDb,
  threadId: string,
  hintId: string,
  leadsTo: string | null,
): (() => void) | null {
  const thread = db.getSnapshot().threads[threadId];
  const hint = thread?.hints.find((entry) => entry.id === hintId);
  if (!thread || !hint || (hint.leadsTo ?? null) === leadsTo) return null;
  db.patch('threads', threadId, {
    hints: thread.hints.map((entry) => (entry.id === hintId ? { ...entry, leadsTo } : entry)),
  });
  return () => {
    const now = db.getSnapshot().threads[threadId];
    if (now)
      db.patch('threads', threadId, {
        hints: now.hints.map((entry) =>
          entry.id === hintId ? { ...entry, leadsTo: hint.leadsTo ?? null } : entry,
        ),
      });
  };
}

/**
 * Ein Satz, auf dem Brett hingeschrieben (Doppelklick ins Leere): ein loser Faden, der gleich
 * dort liegt. Leerer Satz = nichts. Gibt den Faden und `undo` zurück.
 */
export function writeOnBoard(
  db: CampaignDb,
  title: string,
  at: { x: number; y: number },
): { thread: Thread; undo: () => void } | null {
  const clean = title.trim();
  if (!clean) return null;
  return db.batch(() => {
    const thread = saveThread(db, {
      title: clean,
      truth: '',
      state: 'open',
      storyId: null,
      refs: [],
      known: false,
      hints: [],
    });
    setThreadOnBoard(db, thread.id, true, at);
    return {
      thread,
      undo: () =>
        db.batch(() => {
          const { [spotKey(thread.id)]: _gone, ...rest } = db.getSnapshot().state.board;
          db.setState({ board: rest });
          if (db.getSnapshot().threads[thread.id]) removeThread(db, thread.id);
        }),
    };
  });
}

/** Was „Entf“ mit einem gewählten Stück des Bretts tun kann. */
export interface TakeOffResult {
  /** Wie viele lose Fäden vom Brett genommen wurden. */
  taken: number;
  /** Was bleiben muss – Geschichten, Namen, Knoten. */
  kept: number;
  undo: (() => void) | null;
}

/**
 * Nimmt Gewähltes vom Brett – nie aus der Welt. Lose Fäden stehen danach nur in der Liste;
 * Geschichten, Namen und Fäden einer Geschichte bleiben (sie liegen, weil sie dazugehören).
 */
export function takeOffBoard(db: CampaignDb, keys: readonly string[]): TakeOffResult {
  const data = db.getSnapshot();
  const undos: (() => void)[] = [];
  let kept = 0;
  db.batch(() => {
    for (const key of keys) {
      const thread = key.startsWith('thread:') ? data.threads[key.slice(7)] : undefined;
      if (!thread || !isLooseThread(data, thread) || thread.inPlay) {
        kept++;
        continue;
      }
      const undo = setThreadOnBoard(db, thread.id, false);
      if (undo) undos.push(undo);
    }
  });
  return {
    taken: undos.length,
    kept,
    undo: undos.length ? () => db.batch(() => [...undos].reverse().forEach((u) => u())) : null,
  };
}

/** Ordnet einen Artikel einer Geschichte oder einem Faden zu – oder löst ihn. Gibt `undo` zurück. */
export function setArticleOn(
  db: CampaignDb,
  sort: 'stories' | 'threads',
  docId: string,
  articleId: string,
  on: boolean,
): (() => void) | null {
  const data = db.getSnapshot();
  const doc = sort === 'stories' ? data.stories[docId] : data.threads[docId];
  if (!doc || doc.articleIds.includes(articleId) === on) return null;
  const next = on
    ? [...doc.articleIds, articleId]
    : doc.articleIds.filter((id) => id !== articleId);
  db.patch(sort, docId, { articleIds: next });
  return () => {
    const now =
      sort === 'stories' ? db.getSnapshot().stories[docId] : db.getSnapshot().threads[docId];
    if (now) db.patch(sort, docId, { articleIds: doc.articleIds });
  };
}

/**
 * Nimmt frei hingelegte Namen und Artikel vom Brett (ihre Stelle fällt weg) – nur solche, an
 * denen nichts hängt; die anderen liegen, weil sie zu einer Karte gehören. Gibt `undo` zurück.
 */
export function takeFreeOffBoard(db: CampaignDb, keys: readonly string[]): (() => void) | null {
  const board = db.getSnapshot().state.board;
  const gone = keys.filter((key) => board[key] !== undefined);
  if (!gone.length) return null;
  const drop = new Set(gone);
  db.setState({
    board: Object.fromEntries(Object.entries(board).filter(([key]) => !drop.has(key))),
  });
  return () => {
    const now = db.getSnapshot().state.board;
    db.setState({
      board: { ...now, ...Object.fromEntries(gone.map((key) => [key, board[key]!])) },
    });
  };
}

// ── Bereiche auf dem Brett ─────────────────────────────────────────────────

type AreaRect = { x: number; y: number; w: number; h: number };

/** Legt einen Bereich an (Name darf leer sein). Gibt ihn und `undo` zurück. */
export function addBoardArea(
  db: CampaignDb,
  rect: AreaRect,
  title = '',
): { area: BoardArea; undo: () => void } {
  const area: BoardArea = {
    id: newId(),
    title: title.trim(),
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(Math.max(AREA_MIN.w, rect.w)),
    h: Math.round(Math.max(AREA_MIN.h, rect.h)),
  };
  db.setState({ boardAreas: [...db.getSnapshot().state.boardAreas, area] });
  return {
    area,
    undo: () =>
      db.setState({
        boardAreas: db.getSnapshot().state.boardAreas.filter((entry) => entry.id !== area.id),
      }),
  };
}

/** Ändert Name, Stelle oder Größe eines Bereichs (nie kleiner als `AREA_MIN`). */
export function patchBoardArea(
  db: CampaignDb,
  id: string,
  change: Partial<Omit<BoardArea, 'id'>>,
): void {
  const areas = db.getSnapshot().state.boardAreas;
  if (!areas.some((area) => area.id === id)) return;
  db.setState({
    boardAreas: areas.map((area) =>
      area.id === id
        ? {
            ...area,
            ...change,
            ...(change.title !== undefined ? { title: change.title.trim() } : {}),
            ...(change.x !== undefined ? { x: Math.round(change.x) } : {}),
            ...(change.y !== undefined ? { y: Math.round(change.y) } : {}),
            ...(change.w !== undefined ? { w: Math.round(Math.max(AREA_MIN.w, change.w)) } : {}),
            ...(change.h !== undefined ? { h: Math.round(Math.max(AREA_MIN.h, change.h)) } : {}),
          }
        : area,
    ),
  });
}

/**
 * Verschiebt einen Bereich samt allem, was darin liegt (`spots`: die neuen Stellen der Stücke) –
 * in einem Zug.
 */
export function moveBoardArea(
  db: CampaignDb,
  id: string,
  to: { x: number; y: number },
  spots: Readonly<Record<string, { x: number; y: number }>>,
): void {
  db.batch(() => {
    patchBoardArea(db, id, to);
    if (Object.keys(spots).length) placeManyOnBoard(db, spots);
  });
}

/** Nimmt einen Bereich weg – was darin liegt, bleibt, wo es ist. Gibt `undo` zurück. */
export function removeBoardArea(db: CampaignDb, id: string): (() => void) | null {
  const areas = db.getSnapshot().state.boardAreas;
  const index = areas.findIndex((area) => area.id === id);
  if (index < 0) return null;
  const area = areas[index]!;
  db.setState({ boardAreas: areas.filter((entry) => entry.id !== id) });
  return () => {
    const now = db.getSnapshot().state.boardAreas;
    if (now.some((entry) => entry.id === id)) return;
    const next = [...now];
    next.splice(Math.min(index, next.length), 0, area);
    db.setState({ boardAreas: next });
  };
}

// ── Geschichte an Geschichte ───────────────────────────────────────────────

/**
 * Verbindet zwei Geschichten von Hand (Fadenbrett). Die Verbindung steht an der ersten; gibt es
 * sie schon, bekommt sie nur das neue Wort, wenn eins da ist. Gibt `undo` zurück.
 */
export function tieStories(
  db: CampaignDb,
  aId: string,
  bId: string,
  word = '',
): (() => void) | null {
  const data = db.getSnapshot();
  const [a, b] = [data.stories[aId], data.stories[bId]];
  if (!a || !b || aId === bId) return null;
  const clean = word.trim();
  if (isStoryTied(data, aId, bId)) return clean ? setStoryTieWord(db, aId, bId, clean) : null;
  db.patch('stories', aId, { ties: [...a.ties, { id: bId, word: clean }] });
  return () => {
    const now = db.getSnapshot().stories[aId];
    if (now) db.patch('stories', aId, { ties: now.ties.filter((tie) => tie.id !== bId) });
  };
}

/** Löst die Verbindung zweier Geschichten – an welcher sie auch steht. Gibt `undo` zurück. */
export function untieStories(db: CampaignDb, aId: string, bId: string): (() => void) | null {
  const data = db.getSnapshot();
  const holders = [data.stories[aId], data.stories[bId]].filter(
    (story): story is Story =>
      story !== undefined && story.ties.some((tie) => tie.id === (story.id === aId ? bId : aId)),
  );
  if (!holders.length) return null;
  db.batch(() => {
    for (const story of holders) {
      const other = story.id === aId ? bId : aId;
      db.patch('stories', story.id, { ties: story.ties.filter((tie) => tie.id !== other) });
    }
  });
  return () =>
    db.batch(() => {
      for (const story of holders)
        if (db.getSnapshot().stories[story.id]) db.patch('stories', story.id, { ties: story.ties });
    });
}

/** Ändert das Wort einer Verbindung zweier Geschichten. Gibt `undo` zurück. */
export function setStoryTieWord(
  db: CampaignDb,
  aId: string,
  bId: string,
  word: string,
): (() => void) | null {
  const data = db.getSnapshot();
  const holder = [data.stories[aId], data.stories[bId]].find(
    (story) => story?.ties.some((tie) => tie.id === (story.id === aId ? bId : aId)) === true,
  );
  if (!holder) return null;
  const other = holder.id === aId ? bId : aId;
  const clean = word.trim();
  if (holder.ties.find((tie) => tie.id === other)?.word === clean) return null;
  db.patch('stories', holder.id, {
    ties: holder.ties.map((tie) => (tie.id === other ? { ...tie, word: clean } : tie)),
  });
  return () => {
    if (db.getSnapshot().stories[holder.id]) db.patch('stories', holder.id, { ties: holder.ties });
  };
}

// ── Teilgeschichten auf dem Brett ──────────────────────────────────────────

/**
 * Hängt eine Geschichte als Teil unter eine große (oder löst sie: `parentId` null) – nie im
 * Kreis (`patchStory` prüft es). Gibt `undo` zurück – null, wenn sich nichts ändert.
 */
export function setStoryParent(
  db: CampaignDb,
  storyId: string,
  parentId: string | null,
): (() => void) | null {
  const story = db.getSnapshot().stories[storyId];
  if (!story || story.parentId === parentId) return null;
  const before = story.parentId;
  patchStory(db, storyId, { parentId });
  if (db.getSnapshot().stories[storyId]?.parentId === before) return null;
  return () => {
    if (db.getSnapshot().stories[storyId]) patchStory(db, storyId, { parentId: before });
  };
}

/** Klappt die Teilgeschichten einer großen Geschichte auf dem Brett ein oder aus. */
export function setPartsFolded(db: CampaignDb, storyId: string, folded: boolean): void {
  const story = db.getSnapshot().stories[storyId];
  if (story && story.partsFolded !== folded) db.patch('stories', storyId, { partsFolded: folded });
}

/**
 * Eine neue Teilgeschichte mit dem Namen, den der Spielleiter geschrieben hat (ohne Namen
 * „Neue Teilgeschichte“); sie liegt gleich bei ihrer großen. Gibt sie und `undo` zurück.
 */
export function addSubStory(
  db: CampaignDb,
  parentId: string,
  title: string,
): { story: Story; undo: () => void } | null {
  return db.batch(() => {
    const story = newSubStory(db, parentId);
    if (!story) return null;
    if (title.trim()) patchStory(db, story.id, { title: title.trim() });
    // Was gerade eingeklappt ist, klappt auf: Das Neue soll man sehen.
    setPartsFolded(db, parentId, false);
    return {
      story: db.getSnapshot().stories[story.id] ?? story,
      undo: () => {
        if (db.getSnapshot().stories[story.id]) removeStory(db, story.id);
      },
    };
  });
}

// ── Eine Schnur zu einem Namen lösen – gleich, worüber sie entstand ─────────

/**
 * Löst einen Namen von einer Karte: überall, worüber er an ihr hängt (`nameSources`) –
 * Beteiligte, Antreiber, Gefährten, Uhr, Einstiege, Szenen, Fäden und Hinweise (bei einer
 * Geschichte ohne die Fäden in `skip`, die als Knoten für sich hängen). Nichts wird gelöscht:
 * Ein Hinweis, eine Szene behalten ihren Text, nur der Name fehlt dann dort. Gibt zurück, was
 * gelöst wurde (in Worten) und `undo` – null, wenn er nirgends hing.
 */
export function detachName(
  db: CampaignDb,
  cardKey: string,
  entityId: string,
  skip: ReadonlySet<string> = new Set(),
): { sources: string[]; undo: () => void } | null {
  const data = db.getSnapshot();
  const sources = nameSources(data, cardKey, entityId, skip);
  if (!sources.length) return null;
  const before: { sort: 'stories' | 'threads' | 'clocks'; id: string; doc: object }[] = [];
  const freeThread = (thread: Thread) => {
    const touched =
      thread.refs.includes(entityId) ||
      thread.hints.some((hint) => hint.placeId === entityId || hint.sourceId === entityId);
    if (!touched) return;
    before.push({
      sort: 'threads',
      id: thread.id,
      doc: { refs: thread.refs, hints: thread.hints },
    });
    db.patch('threads', thread.id, {
      refs: thread.refs.filter((id) => id !== entityId),
      hints: thread.hints.map((hint) => ({
        ...hint,
        placeId: hint.placeId === entityId ? null : hint.placeId,
        sourceId: hint.sourceId === entityId ? null : hint.sourceId,
      })),
    });
  };
  db.batch(() => {
    const threadId = threadOfKey(cardKey);
    if (threadId) {
      const thread = data.threads[threadId];
      if (thread) freeThread(thread);
      return;
    }
    const story = data.stories[cardKey.slice(6)];
    if (!story) return;
    before.push({
      sort: 'stories',
      id: story.id,
      doc: {
        ownerId: story.ownerId,
        refs: story.refs,
        heroes: story.heroes,
        entries: story.entries,
        scenes: story.scenes,
      },
    });
    db.patch('stories', story.id, {
      ownerId: story.ownerId === entityId ? null : story.ownerId,
      refs: story.refs.filter((id) => id !== entityId),
      heroes: story.heroes.filter((hero) => hero.characterId !== entityId),
      entries: story.entries.map((entry) =>
        entry.placeId === entityId ? { ...entry, placeId: null } : entry,
      ),
      scenes: story.scenes.map((scene) =>
        scene.placeId === entityId ? { ...scene, placeId: null } : scene,
      ),
    });
    const clock = story.clockId ? data.clocks[story.clockId] : undefined;
    if (
      clock &&
      (clock.ownerId === entityId || clock.placeId === entityId || clock.refs.includes(entityId))
    ) {
      before.push({
        sort: 'clocks',
        id: clock.id,
        doc: { ownerId: clock.ownerId, placeId: clock.placeId, refs: clock.refs },
      });
      db.patch('clocks', clock.id, {
        ownerId: clock.ownerId === entityId ? null : clock.ownerId,
        placeId: clock.placeId === entityId ? null : clock.placeId,
        refs: clock.refs.filter((id) => id !== entityId),
      });
    }
    for (const thread of Object.values(data.threads))
      if (thread.storyId === story.id && !skip.has(thread.id)) freeThread(thread);
  });
  return {
    sources,
    undo: () =>
      db.batch(() => {
        const now = db.getSnapshot();
        for (const entry of before)
          if (now[entry.sort][entry.id]) db.patch(entry.sort, entry.id, entry.doc as never);
      }),
  };
}
