/**
 * Lose Fäden aufräumen: zusammenlegen, sammeln, an Geschichten hängen, aufs Brett legen. Erfundene
 * Welt (Hohenfurt, Mira und Odo Tannhaus, Lando Furtner, die Salzgrotte).
 */
import { describe, expect, it } from 'vitest';
import { recordEntry } from '../../data/record';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { looseThreads, threadTwins } from '../../domain/looseThreads';
import {
  CHOICE_FOUND,
  CHOICE_STORIES,
  CHOICE_THREADS,
  OFFERED_THREADS,
  playChoices,
  playView,
} from '../../domain/play';
import { createEntity, createEvent, createSession, newId, type Place } from '../../domain/schema';
import { boardCards, boardLayout, threadsOf } from '../../domain/story';
import {
  markTwinsApart,
  mergeThreads,
  moveThread,
  moveThreads,
  newStory,
  placeOnBoard,
  removeThreads,
  saveThread,
  setThreadOnBoard,
  setThreadsState,
  storyFromThreads,
  tidyBoard,
  type ThreadInput,
} from './actions';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string, parentId: string | null = null) =>
    db.put('entities', createEntity({ kind: 'place', name, place: { parentId } })) as Place;
  const town = place('Hohenfurt');
  const market = place('Markt', town.id);
  const grotto = place('Salzgrotte', town.id);
  const person = (name: string, placeId: string | null = null) =>
    db.put('entities', createEntity({ kind: 'person', name, person: { placeId } }));
  const mira = person('Mira Tannhaus', market.id);
  const odo = person('Odo Tannhaus');
  const lando = person('Lando Furtner');
  db.setState({ placeId: market.id });
  const data = () => db.getSnapshot();
  const thread = (title: string, more: Partial<ThreadInput> = {}) =>
    saveThread(db, {
      title,
      truth: '',
      state: 'open',
      storyId: null,
      refs: [],
      known: false,
      hints: [],
      ...more,
    });
  const hint = (text: string, placeId: string | null = null, found = false) => ({
    id: newId(),
    text,
    placeId,
    sourceId: null,
    found,
  });
  return { db, data, town, market, grotto, mira, odo, lando, thread, hint };
}

describe('Fäden zusammenlegen', () => {
  it('führt Hinweise, Namen, Antwort und Quellen zusammen – und nimmt es zurück', async () => {
    const { db, data, market, grotto, mira, odo, thread, hint } = await setup();
    const first = db.put('sessions', createSession({ number: 1, startAt: data().state.now }));
    const second = db.put('sessions', createSession({ number: 2, startAt: data().state.now }));
    const keep = thread('Wer bezahlt die Krähenbande?', {
      refs: [mira.id],
      hints: [hint('Münzen aus Hohenfurt', market.id)],
      sessionIds: [first.id],
    });
    const twin = thread('wer bezahlt die krähenbande', {
      refs: [mira.id, odo.id],
      truth: 'Lando Furtner.',
      known: true,
      state: 'active',
      hints: [hint('Münzen aus Hohenfurt', market.id, true), hint('Ein Brief im Stroh', grotto.id)],
      sessionIds: [second.id],
    });
    const third = thread('Wer bezahlt noch die Krähenbande?', { truth: 'Lando Furtner' });
    setThreadOnBoard(db, third.id, true, { x: 300, y: 80 });
    const event = db.put(
      'events',
      createEvent({ title: 'Zahltag', at: data().state.now + 600, threadId: twin.id }),
    );
    const before = data().threads[keep.id]!;

    expect(mergeThreads(db, keep.id, [])).toBeNull();
    expect(mergeThreads(db, 'gibtsnicht', [twin.id])).toBeNull();
    const undo = mergeThreads(db, keep.id, [twin.id, third.id, keep.id])!;
    const merged = data().threads[keep.id]!;
    expect(Object.keys(data().threads)).toEqual([keep.id]);
    // Gleiche Hinweise nur einmal – gefunden bleibt gefunden.
    expect(merged.hints.map((entry) => [entry.text, entry.found])).toEqual([
      ['Münzen aus Hohenfurt', true],
      ['Ein Brief im Stroh', false],
    ]);
    expect(merged.refs).toEqual([mira.id, odo.id]);
    // Dieselbe Antwort steht nur einmal da.
    expect(merged.truth).toBe('Lando Furtner.');
    expect(merged).toMatchObject({ known: true, state: 'active', onBoard: true, storyId: null });
    expect(merged.sessionIds).toEqual([first.id, second.id]);
    expect(data().events[event.id]!.threadId).toBe(keep.id);
    expect(data().state.board[`thread:${third.id}`]).toBeUndefined();

    undo();
    expect(Object.keys(data().threads).sort()).toEqual([keep.id, twin.id, third.id].sort());
    expect(data().threads[keep.id]).toMatchObject({
      hints: before.hints,
      refs: before.refs,
      truth: '',
      known: false,
      state: 'open',
      onBoard: false,
      sessionIds: [first.id],
    });
    expect(data().events[event.id]!.threadId).toBe(twin.id);
    expect(data().state.board[`thread:${third.id}`]).toEqual({ x: 300, y: 80 });
  });

  it('hängt den Bleibenden an die Geschichte des anderen und zieht gefundene Hinweise der Chronik mit', async () => {
    const { db, data, thread, hint, market } = await setup();
    const tale = newStory(db, { title: 'Die Krähen' });
    const loose = thread('Der Schlüssel der Grotte', { hints: [hint('Ein Abdruck im Wachs')] });
    const bound = thread('Schlüssel der Grotte', {
      storyId: tale.id,
      hints: [hint('Ein Abdruck im Wachs'), hint('Der Schmied schweigt', market.id)],
    });
    // Die Gruppe fand den Hinweis des Fadens, der gleich verschwindet.
    const gone = data().threads[bound.id]!.hints[0]!;
    const result = recordEntry(db, {
      kind: 'clue',
      text: 'Ein Abdruck im Wachs',
      clue: { threadId: bound.id, hintId: gone.id },
    });
    if (!('entry' in result)) throw new Error('nicht festgehalten');
    const [group] = threadTwins(data());
    expect(group!.keepId).toBe(bound.id);
    // Auch andersherum: Bleibt der lose, kommt er zur Geschichte des anderen.
    const undo = mergeThreads(db, loose.id, [bound.id])!;
    const kept = data().threads[loose.id]!;
    expect(kept.storyId).toBe(tale.id);
    expect(kept.onBoard).toBe(false);
    expect(kept.hints.map((entry) => [entry.text, entry.found])).toEqual([
      ['Ein Abdruck im Wachs', true],
      ['Der Schmied schweigt', false],
    ]);
    expect(data().chronicle[result.entry.id]!.clue).toMatchObject({
      threadId: loose.id,
      hintId: kept.hints[0]!.id,
    });
    expect(threadTwins(data())).toEqual([]);
    undo();
    expect(data().threads[loose.id]!.storyId).toBeNull();
    expect(data().chronicle[result.entry.id]!.clue).toMatchObject({
      threadId: bound.id,
      hintId: gone.id,
    });
  });

  it('lässt beim Zurücknehmen stehen, was seither geändert wurde', async () => {
    const { db, data, thread } = await setup();
    const keep = thread('Das Licht in der Salzgrotte');
    const twin = thread('Das Licht in der Salzgrotte?', { truth: 'Mira stellt es auf.' });
    const undo = mergeThreads(db, keep.id, [twin.id])!;
    db.patch('threads', keep.id, { truth: 'Mira stellt es auf. Odo weiß davon.' });
    undo();
    expect(data().threads[keep.id]!.truth).toBe('Mira stellt es auf. Odo weiß davon.');
    expect(data().threads[twin.id]).toBeDefined();
  });

  it('merkt sich, was verschieden ist', async () => {
    const { db, data, thread } = await setup();
    thread('Das Licht in der Salzgrotte');
    thread('Das Licht in der Salzgrotte?');
    const [group] = threadTwins(data());
    const undo = markTwinsApart(db, group!.key);
    markTwinsApart(db, group!.key);
    expect(data().state.twinsApart).toEqual([group!.key]);
    expect(threadTwins(data())).toEqual([]);
    undo();
    expect(threadTwins(data())).toHaveLength(1);
  });
});

describe('Mehrere Fäden auf einmal', () => {
  it('macht aus losen Fäden eine Geschichte: Sie werden ihre Fragen, ihre Namen Beteiligte', async () => {
    const { db, data, mira, odo, grotto, thread } = await setup();
    const light = thread('Das Licht in der Salzgrotte', { refs: [grotto.id, mira.id] });
    const debt = thread('Odos Schulden', { refs: [odo.id, mira.id] });
    const other = thread('Die fremde Münze');
    expect(storyFromThreads(db, [], 'Leer')).toBeNull();
    const made = storyFromThreads(
      db,
      [light.id, debt.id, 'gibtsnicht'],
      '  Die Pacht der Grotte ',
    )!;
    expect(data().stories[made.story.id]).toMatchObject({
      title: 'Die Pacht der Grotte',
      refs: [grotto.id, mira.id, odo.id],
      summary: '',
    });
    expect(
      threadsOf(data(), made.story.id)
        .map((entry) => entry.id)
        .sort(),
    ).toEqual([light.id, debt.id].sort());
    expect(looseThreads(data()).map((row) => row.thread.id)).toEqual([other.id]);
    made.undo();
    expect(data().stories[made.story.id]).toBeUndefined();
    expect(looseThreads(data())).toHaveLength(3);
    // Ohne Namen heißt sie wie jede neue Geschichte – Wayfarer denkt sich keinen aus.
    expect(storyFromThreads(db, [other.id], '  ')!.story.title).toBe('Neue Geschichte');
  });

  it('hängt mehrere an eine Geschichte, lässt sie ruhen, erledigt und löscht sie – mit Rückgängig', async () => {
    const { db, data, thread } = await setup();
    const tale = newStory(db, { title: 'Die Krähen' });
    const [a, b, c] = [thread('Erster Faden'), thread('Zweiter Faden'), thread('Dritter Faden')];
    expect(moveThreads(db, [a!.id], 'gibtsnicht')).toBeNull();
    const attach = moveThreads(db, [a!.id, b!.id], tale.id)!;
    expect(threadsOf(data(), tale.id)).toHaveLength(2);
    expect(moveThreads(db, [a!.id, b!.id], tale.id)).toBeNull();
    attach();
    expect(threadsOf(data(), tale.id)).toHaveLength(0);

    const rest = setThreadsState(db, [a!.id, b!.id], 'dormant')!;
    expect(looseThreads(data()).map((row) => [row.thread.title, row.resting])).toEqual([
      ['Dritter Faden', false],
      ['Erster Faden', true],
      ['Zweiter Faden', true],
    ]);
    expect(setThreadsState(db, [a!.id], 'dormant')).toBeNull();
    // Was seither anders steht, bleibt beim Zurücknehmen.
    db.patch('threads', b!.id, { state: 'active' });
    rest();
    expect(data().threads[a!.id]!.state).toBe('open');
    expect(data().threads[b!.id]!.state).toBe('active');

    setThreadsState(db, [c!.id], 'solved');
    expect(looseThreads(data()).map((row) => row.thread.id)).not.toContain(c!.id);

    const event = db.put(
      'events',
      createEvent({ title: 'Markttag', at: data().state.now + 60, threadId: a!.id }),
    );
    placeOnBoard(db, `thread:${a!.id}`, 10, 20);
    const remove = removeThreads(db, [a!.id, b!.id])!;
    expect(Object.keys(data().threads)).toEqual([c!.id]);
    expect(data().events[event.id]!.threadId).toBeNull();
    expect(data().state.board).toEqual({});
    remove();
    expect(Object.keys(data().threads).sort()).toEqual([a!.id, b!.id, c!.id].sort());
    expect(data().events[event.id]!.threadId).toBe(a!.id);
    expect(data().state.board[`thread:${a!.id}`]).toEqual({ x: 10, y: 20 });
    expect(removeThreads(db, ['gibtsnicht'])).toBeNull();
  });
});

describe('Lose Fäden und das Brett', () => {
  it('legt einen Faden aufs Brett und nimmt ihn wieder herunter', async () => {
    const { db, data, thread } = await setup();
    const loose = thread('Die fremde Münze');
    const lying = () => Object.keys(boardLayout(boardCards(data()), data().state.board).cards);
    expect(lying()).toEqual([]);
    expect(setThreadOnBoard(db, loose.id, false)).toBeNull();
    const put = setThreadOnBoard(db, loose.id, true, { x: 120.4, y: 60 })!;
    expect(lying()).toEqual([`thread:${loose.id}`]);
    expect(data().state.board[`thread:${loose.id}`]).toEqual({ x: 120, y: 60 });
    put();
    expect(lying()).toEqual([]);
    expect(data().state.board).toEqual({});

    setThreadOnBoard(db, loose.id, true);
    const off = setThreadOnBoard(db, loose.id, false)!;
    expect(lying()).toEqual([]);
    off();
    expect(lying()).toEqual([`thread:${loose.id}`]);
    // Aufräumen lässt ihn auf dem Brett – auch einen, der dort nur eine Stelle hatte.
    const old = thread('Die alte Schuld');
    placeOnBoard(db, `thread:${old.id}`, 500, 500);
    const undo = tidyBoard(db);
    expect(data().state.board).toEqual({});
    expect(lying().sort()).toEqual([`thread:${loose.id}`, `thread:${old.id}`].sort());
    undo();
    expect(data().threads[old.id]!.onBoard).toBe(false);
    expect(data().state.board[`thread:${old.id}`]).toEqual({ x: 500, y: 500 });
  });

  it('eine Frage liegt nicht mehr für sich auf dem Brett – gelöst steht sie in der Liste', async () => {
    const { db, data, thread } = await setup();
    const tale = newStory(db, { title: 'Die Krähen' });
    const loose = thread('Die fremde Münze');
    setThreadOnBoard(db, loose.id, true, { x: 40, y: 40 });
    const undo = moveThread(db, loose.id, tale.id)!;
    expect(data().threads[loose.id]).toMatchObject({ storyId: tale.id, onBoard: false });
    expect(data().state.board[`thread:${loose.id}`]).toBeUndefined();
    const back = moveThread(db, loose.id, null)!;
    expect(looseThreads(data())[0]).toMatchObject({ onBoard: false });
    back();
    undo();
    expect(data().threads[loose.id]).toMatchObject({ storyId: null, onBoard: true });
    expect(data().state.board[`thread:${loose.id}`]).toEqual({ x: 40, y: 40 });
  });
});

describe('Am Spieltisch', () => {
  it('bietet nie eine endlose Liste an: was am Ort hängt zuerst, der Rest über die Suche', async () => {
    const { db, data, market, mira, thread } = await setup();
    for (let i = 1; i <= 12; i++) thread(`Ferner Faden ${String(i).padStart(2, '0')}`);
    for (let i = 1; i <= 5; i++) thread(`Faden am Markt ${i}`, { refs: [market.id] });
    thread('Wer warnte die Wache?', { refs: [mira.id] });
    const played = thread('Schon im Spiel', { refs: [market.id] });
    db.patch('threads', played.id, { inPlay: true });
    thread('Gelöst', { state: 'solved' });
    const near = newStory(db, { title: 'Der leere Stand', refs: [market.id] });
    for (let i = 1; i <= 9; i++) newStory(db, { title: `Ferne Geschichte ${i}` });
    newStory(db, { title: 'Zu Ende erzählt', closed: true });

    const view = playView(data());
    // Am Ort: die Geschichte und nur die ersten losen Fäden – der Rest ist gezählt.
    expect(view.offered.map((card) => card.title)).toEqual([
      'Der leere Stand',
      'Faden am Markt 1',
      'Faden am Markt 2',
      'Faden am Markt 3',
    ]);
    expect(view.offered.filter((card) => !card.story)).toHaveLength(OFFERED_THREADS);
    expect(view.offeredMore).toBe(3);

    const cards = boardCards(data());
    const choices = playChoices(data(), cards);
    expect(choices.stories).toHaveLength(CHOICE_STORIES);
    expect(choices.stories[0]!.story!.id).toBe(near.id);
    expect(choices.moreStories).toBe(2);
    expect(choices.threads.map((card) => card.title)).toEqual([
      'Faden am Markt 1',
      'Faden am Markt 2',
      'Faden am Markt 3',
      'Faden am Markt 4',
      'Faden am Markt 5',
    ]);
    expect(choices.threads).toHaveLength(CHOICE_THREADS);
    expect(choices.moreThreads).toBe(13);
    expect(choices.search).toBe(true);
    // Die Suche findet nach dem Satz und nach den Namen – was im Spiel oder vorbei ist, nie.
    const found = playChoices(data(), cards, 'ferner faden');
    expect(found.threads).toHaveLength(CHOICE_FOUND);
    expect(found.moreThreads).toBe(0);
    expect(found.stories).toEqual([]);
    expect(playChoices(data(), cards, 'mira').threads.map((card) => card.title)).toEqual([
      'Wer warnte die Wache?',
    ]);
    expect(playChoices(data(), cards, 'spiel').threads).toEqual([]);
    expect(playChoices(data(), cards, 'gelöst').threads).toEqual([]);
    expect(playChoices(data(), cards, 'erzählt').stories).toEqual([]);
    // Bei wenigen braucht es keine Suche.
    expect(playChoices(data(), cards.slice(0, 3)).search).toBe(false);
  });
});
