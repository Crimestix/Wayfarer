/**
 * Das Netz der Fäden: Faden an Faden, Hinweise, die zu einem Faden führen, Knoten und Schnüre auf
 * dem Brett, frei gezogene Schnüre. Erfundene Welt (Hohenfurt, Salzgrotte, Mira Tannhaus).
 */
import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { playView } from '../../domain/play';
import { ArticleSchema, createEntity, newId, type Place } from '../../domain/schema';
import { boardCards, boardLayout, insideOnBoard, nameSources } from '../../domain/story';
import {
  boardWeb,
  isStoryTied,
  isTied,
  leadNote,
  neighboursOf,
  storyTiesOf,
  tieFits,
  tiesOf,
} from '../../domain/threadWeb';
import { dismissSuggestion } from '../../data/actions';
import { SUGGESTION } from '../../domain/dismiss';
import { areaAround, insideArea } from '../../domain/boardAreas';
import {
  setStringsHidden,
  addBoardLink,
  removeBoardLink,
  setBoardLinkWord,
  writeLinkedThread,
  detachName,
  addSubStory,
  setPartsFolded,
  setStoryParent,
  setStoryTieWord,
  tieStories,
  untieStories,
  addBoardArea,
  moveBoardArea,
  patchBoardArea,
  removeBoardArea,
  connectOnBoard,
  mergeThreads,
  placeManyOnBoard,
  placeOnBoard,
  setArticleOn,
  takeFreeOffBoard,
  tidyBoard,
  setHintLead,
  takeOffBoard,
  writeOnBoard,
  newStory,
  saveThread,
  setInPlay,
  setStoryUnfolded,
  setTieWord,
  tieThreads,
  untieThreads,
  type ThreadInput,
} from './actions';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string, parentId: string | null = null) =>
    db.put('entities', createEntity({ kind: 'place', name, place: { parentId } })) as Place;
  const town = place('Hohenfurt');
  const arena = place('Salzgrotte', town.id);
  const mira = db.put('entities', createEntity({ kind: 'person', name: 'Mira Tannhaus' }));
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
  return { db, data: () => db.getSnapshot(), town, arena, mira, thread };
}

describe('Faden an Faden', () => {
  it('verbindet in beide Richtungen, nur einmal, mit Wort und Rückgängig', async () => {
    const { db, data, thread } = await setup();
    const a = thread('Wer füllt die Grotte?');
    const b = thread('Woher kommt das Salz?');
    const undo = tieThreads(db, a.id, b.id, 'wer dahintersteckt')!;
    expect(isTied(data(), b.id, a.id)).toBe(true);
    expect(tiesOf(data(), b.id)).toMatchObject([
      { thread: { id: a.id }, word: 'wer dahintersteckt' },
    ]);
    // Noch einmal – auch von der anderen Seite – entsteht keine zweite Verbindung.
    expect(tieThreads(db, b.id, a.id)).toBeNull();
    expect(data().threads[b.id]!.ties).toEqual([]);
    setTieWord(db, b.id, a.id, 'Geld');
    expect(tiesOf(data(), a.id)[0]!.word).toBe('Geld');
    undo();
    expect(isTied(data(), a.id, b.id)).toBe(false);
  });

  it('löst eine Verbindung von beiden Seiten und nimmt das Lösen zurück', async () => {
    const { db, data, thread } = await setup();
    const a = thread('A');
    const b = thread('B');
    tieThreads(db, a.id, b.id);
    const undo = untieThreads(db, b.id, a.id)!;
    expect(isTied(data(), a.id, b.id)).toBe(false);
    undo();
    expect(isTied(data(), a.id, b.id)).toBe(true);
  });

  it('kennt einen Schritt weiter: Verbindung, Hinweis führt hin, Hinweis kommt her', async () => {
    const { db, data, thread } = await setup();
    const c = thread('Wer bezahlt die Kämpfe?');
    const b = thread('Der verschwundene Kämpfer');
    const a = thread('Die Arena', {
      hints: [
        {
          id: newId(),
          text: 'Ein Schuldschein',
          placeId: null,
          sourceId: null,
          found: false,
          leadsTo: c.id,
        },
      ],
    });
    const d = thread('Die alte Wette', {
      hints: [
        {
          id: newId(),
          text: 'Ein Wettzettel',
          placeId: null,
          sourceId: null,
          found: false,
          leadsTo: a.id,
        },
      ],
    });
    tieThreads(db, a.id, b.id);
    const steps = neighboursOf(data(), a.id);
    expect(steps.map((entry) => [entry.thread.title, entry.step])).toEqual([
      ['Der verschwundene Kämpfer', 'tie'],
      ['Wer bezahlt die Kämpfe?', 'leads'],
      ['Die alte Wette', 'ledFrom'],
    ]);
    expect(leadNote(data(), a.id, a.hints[0]!.id)).toBe(
      'Die Spur führt jetzt zu „Wer bezahlt die Kämpfe?“.',
    );
    expect(leadNote(data(), d.id, 'gibt-es-nicht')).toBeNull();
  });

  it('schlägt Fäden am selben Ort vor – nie verbundene, nie weggeklickte', async () => {
    const { db, data, arena, thread } = await setup();
    const a = thread('A', { refs: [arena.id] });
    const b = thread('B', { refs: [arena.id] });
    const c = thread('C', { refs: [arena.id] });
    thread('D');
    expect(tieFits(data(), a.id).map((fit) => fit.thread.title)).toEqual(['B', 'C']);
    expect(tieFits(data(), a.id)[0]!.reason).toBe('gleicher Ort: Salzgrotte');
    tieThreads(db, a.id, b.id);
    dismissSuggestion(db, SUGGESTION.tie(c.id, a.id));
    expect(tieFits(data(), a.id)).toEqual([]);
  });

  it('legt Verbindungen beim Zusammenlegen auf den bleibenden Faden', async () => {
    const { db, data, thread } = await setup();
    const keep = thread('Wer füllt die Grotte?');
    const twin = thread('Wer füllt die Grotte');
    const other = thread('Das Salz', {
      hints: [
        {
          id: newId(),
          text: 'Spur',
          placeId: null,
          sourceId: null,
          found: false,
          leadsTo: twin.id,
        },
      ],
    });
    const far = thread('Der Hafen');
    tieThreads(db, twin.id, far.id, 'Schiffe');
    tieThreads(db, other.id, twin.id);
    const undo = mergeThreads(db, keep.id, [twin.id])!;
    expect(tiesOf(data(), keep.id).map((tie) => [tie.thread.title, tie.word])).toEqual([
      ['Das Salz', ''],
      ['Der Hafen', 'Schiffe'],
    ]);
    expect(data().threads[other.id]!.hints[0]!.leadsTo).toBe(keep.id);
    undo();
    expect(data().threads[other.id]!.hints[0]!.leadsTo).toBe(twin.id);
    expect(isTied(data(), twin.id, far.id)).toBe(true);
  });
});

describe('Das Netz auf dem Brett', () => {
  it('zeigt Fäden als Knoten, wenn die Geschichte aufgeklappt oder quer verbunden ist', async () => {
    const { db, data, arena, mira, thread } = await setup();
    const story = newStory(db, { title: 'Die Arena' });
    const other = newStory(db, { title: 'Der Salzhandel' });
    const a = thread('Wer kämpft dort?', { storyId: story.id, refs: [arena.id] });
    thread('Wer verliert?', { storyId: story.id });
    const b = thread('Wer kauft?', { storyId: other.id, refs: [mira.id] });
    let web = boardWeb(data(), boardCards(data()));
    expect(web.knots).toEqual([]);
    tieThreads(db, a.id, b.id);
    web = boardWeb(data(), boardCards(data()));
    expect(web.knots.map((knot) => knot.thread.title).sort()).toEqual([
      'Wer kauft?',
      'Wer kämpft dort?',
    ]);
    expect(web.strings).toMatchObject([{ kind: 'tie', a: `knot:${a.id}`, b: `knot:${b.id}` }]);
    // Die Salzgrotte hängt jetzt am Knoten, nicht mehr an der Karte.
    const card = web.cards.find((entry) => entry.key === `story:${story.id}`)!;
    expect(card.nodes).not.toContain(arena.id);
    expect(web.knots.find((knot) => knot.thread.id === a.id)!.nodes).toEqual([arena.id]);
    setStoryUnfolded(db, story.id, true);
    web = boardWeb(data(), boardCards(data()));
    expect(web.knots).toHaveLength(3);
    const layout = boardLayout(web.cards, {}, web.knots);
    expect(Object.keys(layout.knots)).toHaveLength(3);
    const pin = layout.pins.find((entry) => entry.id === arena.id)!;
    expect(pin.cards).toEqual([`knot:${a.id}`]);
  });

  it('zeigt der Gruppe nur, was sie kennt', async () => {
    const { db, data, thread } = await setup();
    const story = newStory(db, { title: 'Die Arena', known: true });
    const a = thread('Bekannt', { storyId: story.id, known: true });
    const b = thread('Geheim', { storyId: story.id });
    const c = thread('Lose und bekannt', { known: true });
    tieThreads(db, a.id, b.id);
    tieThreads(db, a.id, c.id);
    const party = boardWeb(data(), boardCards(data(), 'party'), 'party');
    // Der lose Faden liegt nicht auf dem Brett: Er hält keine Schnur.
    expect(party.strings).toEqual([]);
    expect(party.knots).toEqual([]);
  });

  it('zieht Schnüre frei: Faden an Faden, Name an Faden, loser Faden an Geschichte', async () => {
    const { db, data, mira, thread } = await setup();
    const story = newStory(db, { title: 'Die Arena' });
    const other = newStory(db, { title: 'Der Salzhandel' });
    const a = thread('A', { storyId: story.id });
    const b = thread('B', { storyId: other.id });
    const loose = thread('Lose');
    const tied = connectOnBoard(db, `knot:${a.id}`, `knot:${b.id}`);
    expect(tied).toMatchObject({ done: true, title: 'Fäden verbunden' });
    expect(connectOnBoard(db, `knot:${b.id}`, `knot:${a.id}`)).toMatchObject({ done: false });
    const pinned = connectOnBoard(db, `node:${mira.id}`, `knot:${a.id}`);
    expect(pinned).toMatchObject({ done: true });
    expect(data().threads[a.id]!.refs).toEqual([mira.id]);
    if (pinned.done) pinned.undo();
    expect(data().threads[a.id]!.refs).toEqual([]);
    const moved = connectOnBoard(db, `thread:${loose.id}`, `story:${story.id}`);
    expect(moved).toMatchObject({ done: true });
    expect(data().threads[loose.id]!.storyId).toBe(story.id);
    // Ein Faden einer anderen Geschichte wechselt nicht still die Geschichte.
    expect(connectOnBoard(db, `knot:${b.id}`, `story:${story.id}`)).toMatchObject({ done: false });
    // Geschichte an Geschichte: Der Spielleiter wählt – verbinden oder Teil von.
    expect(connectOnBoard(db, `story:${story.id}`, `story:${other.id}`)).toMatchObject({
      done: false,
      choose: { fromId: story.id, toId: other.id },
    });
    // Zwei Namen: sofort eine freie Schnur – kein Fenster, keine Beziehung verlangt.
    const odo = db.put('entities', createEntity({ kind: 'person', name: 'Odo' }));
    const linked = connectOnBoard(db, `node:${mira.id}`, `node:${odo.id}`);
    expect(linked).toMatchObject({ done: true, title: 'Verbunden' });
    expect(data().state.boardLinks).toMatchObject([{ a: `node:${mira.id}`, b: `node:${odo.id}` }]);
    expect(connectOnBoard(db, `node:${odo.id}`, `node:${mira.id}`)).toMatchObject({ done: false });
    if (linked.done) linked.undo();
    expect(data().state.boardLinks).toEqual([]);
  });
});

describe('Am Spieltisch', () => {
  it('zeigt bei Fäden am Ort, was einen Schritt weiter liegt', async () => {
    const { db, arena, thread } = await setup();
    db.setState({ placeId: arena.id });
    const story = newStory(db, { title: 'Die Arena' });
    const far = thread('Wer bezahlt?');
    const here = thread('Die Kämpfe', { storyId: story.id, refs: [arena.id] });
    const away = thread('Anderswo', { storyId: story.id });
    tieThreads(db, here.id, far.id, 'Geld');
    setInPlay(db, `story:${story.id}`, true);
    const card = playView(db.getSnapshot()).cards[0]!;
    expect(card.threads.map((entry) => [entry.thread.title, entry.here])).toEqual([
      ['Die Kämpfe', true],
      ['Anderswo', false],
    ]);
    expect(card.threads[0]!.next).toMatchObject([{ thread: { id: far.id }, word: 'Geld' }]);
    expect(card.threads[1]!.next).toEqual([]);
    void away;
  });
});

describe('Das Brett anfassen', () => {
  it('schreibt einen Faden gleich aufs Brett und nimmt ihn zurück', async () => {
    const { db, data } = await setup();
    expect(writeOnBoard(db, '   ', { x: 0, y: 0 })).toBeNull();
    const written = writeOnBoard(db, ' Wer hat die Tür geöffnet? ', { x: 120, y: 80 })!;
    expect(written.thread.title).toBe('Wer hat die Tür geöffnet?');
    expect(data().threads[written.thread.id]!.onBoard).toBe(true);
    expect(data().state.board[`thread:${written.thread.id}`]).toEqual({ x: 120, y: 80 });
    written.undo();
    expect(data().threads[written.thread.id]).toBeUndefined();
    expect(data().state.board[`thread:${written.thread.id}`]).toBeUndefined();
  });

  it('nimmt nur lose Fäden vom Brett – Geschichten und Namen bleiben', async () => {
    const { db, data, mira } = await setup();
    const story = newStory(db, { title: 'Die Arena' });
    const loose = writeOnBoard(db, 'Lose', { x: 0, y: 0 })!.thread;
    const result = takeOffBoard(db, [`thread:${loose.id}`, `story:${story.id}`, `node:${mira.id}`]);
    expect(result).toMatchObject({ taken: 1, kept: 2 });
    expect(data().threads[loose.id]!.onBoard).toBe(false);
    result.undo!();
    expect(data().threads[loose.id]!.onBoard).toBe(true);
  });

  it('legt mehrere zugleich und löst, wohin ein Hinweis führt', async () => {
    const { db, data, thread } = await setup();
    placeManyOnBoard(db, { 'story:a': { x: 10.4, y: 20 }, 'node:b': { x: -5, y: 7.6 } });
    expect(data().state.board).toMatchObject({
      'story:a': { x: 10, y: 20 },
      'node:b': { x: -5, y: 8 },
    });
    const target = thread('Ziel');
    const hintId = newId();
    const from = thread('Start', {
      hints: [
        {
          id: hintId,
          text: 'Spur',
          placeId: null,
          sourceId: null,
          found: false,
          leadsTo: target.id,
        },
      ],
    });
    const undo = setHintLead(db, from.id, hintId, null)!;
    expect(data().threads[from.id]!.hints[0]!.leadsTo).toBeNull();
    expect(setHintLead(db, from.id, hintId, null)).toBeNull();
    undo();
    expect(data().threads[from.id]!.hints[0]!.leadsTo).toBe(target.id);
  });

  it('findet, was in einem aufgezogenen Rahmen liegt', async () => {
    const { db, data, arena, thread } = await setup();
    const story = newStory(db, { title: 'Die Arena', unfolded: true });
    thread('Wer kämpft?', { storyId: story.id, refs: [arena.id] });
    const web = boardWeb(data(), boardCards(data()));
    const layout = boardLayout(web.cards, {}, web.knots);
    const all = insideOnBoard(layout, { x: -1000, y: -1000 }, { x: 3000, y: 3000 });
    expect(all).toEqual(expect.arrayContaining([`story:${story.id}`, `node:${arena.id}`]));
    expect(all.some((key) => key.startsWith('knot:'))).toBe(true);
    expect(insideOnBoard(layout, { x: 5000, y: 5000 }, { x: 6000, y: 6000 })).toEqual([]);
  });
});

describe('Artikel und Namen auf dem Brett', () => {
  const article = (db: CampaignDb, title: string) =>
    db.put(
      'articles',
      ArticleSchema.parse({
        id: newId(),
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        title,
      }),
    );

  it('legt Namen und Artikel frei hin und hängt sie mit einer Schnur an', async () => {
    const { db, data, mira, thread } = await setup();
    const lore = article(db, 'Die alte Prophezeiung');
    const story = newStory(db, { title: 'Die Arena' });
    const a = thread('Wer kämpft?', { storyId: story.id });
    placeOnBoard(db, `node:${mira.id}`, 500, 500);
    placeOnBoard(db, `article:${lore.id}`, 700, 500);
    const free = Object.keys(data().state.board);
    let layout = boardLayout(boardCards(data()), data().state.board, [], free);
    expect(layout.pins.map((pin) => [pin.key, pin.article, pin.cards])).toEqual(
      expect.arrayContaining([
        [`node:${mira.id}`, false, []],
        [`article:${lore.id}`, true, []],
      ]),
    );
    const tied = connectOnBoard(db, `article:${lore.id}`, `thread:${a.id}`);
    expect(tied).toMatchObject({ done: true, title: 'Artikel zugeordnet' });
    expect(data().threads[a.id]!.articleIds).toEqual([lore.id]);
    layout = boardLayout(boardCards(data()), data().state.board, [], free);
    expect(layout.pins.find((pin) => pin.key === `article:${lore.id}`)!.cards).toEqual([
      `story:${story.id}`,
    ]);
    // Artikel an Name: eine freie Schnur.
    expect(connectOnBoard(db, `article:${lore.id}`, `node:${mira.id}`)).toMatchObject({
      done: true,
    });
    if (tied.done) tied.undo();
    expect(data().threads[a.id]!.articleIds).toEqual([]);
    expect(setArticleOn(db, 'stories', story.id, lore.id, true)).not.toBeNull();
    expect(data().stories[story.id]!.articleIds).toEqual([lore.id]);
  });

  it('nimmt frei Hingelegtes vom Brett und behält es beim Aufräumen', async () => {
    const { db, data, mira } = await setup();
    const story = newStory(db, { title: 'Die Arena' });
    placeOnBoard(db, `story:${story.id}`, 10, 10);
    placeOnBoard(db, `node:${mira.id}`, 500, 500);
    const undoTidy = tidyBoard(db);
    expect(data().state.board).toEqual({ [`node:${mira.id}`]: { x: 500, y: 500 } });
    undoTidy();
    const undo = takeFreeOffBoard(db, [`node:${mira.id}`])!;
    expect(data().state.board[`node:${mira.id}`]).toBeUndefined();
    undo();
    expect(data().state.board[`node:${mira.id}`]).toEqual({ x: 500, y: 500 });
  });
});

describe('Bereiche auf dem Brett', () => {
  it('legt einen Bereich an, benennt ihn, verschiebt ihn samt Inhalt und nimmt ihn weg', async () => {
    const { db, data, mira } = await setup();
    const story = newStory(db, { title: 'Die Arena' });
    placeOnBoard(db, `story:${story.id}`, 100, 100);
    placeOnBoard(db, `node:${mira.id}`, 900, 900);
    const layout = boardLayout(boardCards(data()), data().state.board, [], [`node:${mira.id}`]);
    const rect = areaAround(layout, [`story:${story.id}`], { x: 0, y: 0 });
    expect(rect.x).toBeLessThan(100 - 125);
    expect(rect.y).toBeLessThan(100);
    const { area, undo } = addBoardArea(db, rect, '  Grauwasser ');
    expect(data().state.boardAreas).toEqual([{ ...area, title: 'Grauwasser' }]);
    expect(insideArea(layout, area)).toEqual([`story:${story.id}`]);
    patchBoardArea(db, area.id, { w: 10, title: 'Die Stadt' });
    expect(data().state.boardAreas[0]).toMatchObject({ w: 220, title: 'Die Stadt' });
    moveBoardArea(
      db,
      area.id,
      { x: area.x + 50, y: area.y },
      { [`story:${story.id}`]: { x: 150, y: 100 } },
    );
    expect(data().state.boardAreas[0]!.x).toBe(area.x + 50);
    expect(data().state.board[`story:${story.id}`]).toEqual({ x: 150, y: 100 });
    const back = removeBoardArea(db, area.id)!;
    expect(data().state.boardAreas).toEqual([]);
    // Was darin lag, bleibt liegen.
    expect(data().state.board[`story:${story.id}`]).toEqual({ x: 150, y: 100 });
    back();
    expect(data().state.boardAreas).toHaveLength(1);
    undo();
    expect(data().state.boardAreas).toEqual([]);
  });

  it('legt ohne Auswahl einen Bereich mittlerer Größe um die Mitte', async () => {
    const { data } = await setup();
    const layout = boardLayout(boardCards(data()), {});
    expect(areaAround(layout, [], { x: 1000, y: 500 })).toEqual({ x: 680, y: 290, w: 640, h: 420 });
  });
});

describe('Geschichte an Geschichte', () => {
  it('verbindet zwei Geschichten von Hand, mit Wort, und zeigt die Schnur auf dem Brett', async () => {
    const { db, data } = await setup();
    const a = newStory(db, { title: 'Die Arena' });
    const b = newStory(db, { title: 'Der Salzhandel' });
    const undo = tieStories(db, a.id, b.id, 'dasselbe Geld')!;
    expect(isStoryTied(data(), b.id, a.id)).toBe(true);
    expect(tieStories(db, b.id, a.id)).toBeNull();
    expect(storyTiesOf(data(), b.id)).toMatchObject([
      { story: { id: a.id }, word: 'dasselbe Geld' },
    ]);
    const web = boardWeb(data(), boardCards(data()));
    expect(web.strings).toMatchObject([
      { kind: 'story', a: `story:${a.id}`, b: `story:${b.id}`, word: 'dasselbe Geld' },
    ]);
    setStoryTieWord(db, b.id, a.id, 'Schulden');
    expect(storyTiesOf(data(), a.id)[0]!.word).toBe('Schulden');
    const back = untieStories(db, b.id, a.id)!;
    expect(isStoryTied(data(), a.id, b.id)).toBe(false);
    back();
    expect(isStoryTied(data(), a.id, b.id)).toBe(true);
    undo();
    expect(isStoryTied(data(), a.id, b.id)).toBe(false);
  });
});

describe('Teilgeschichten auf dem Brett', () => {
  it('hängt ein, zeigt die Schnur „Teil von“, zählt die Teile und klappt sie ein', async () => {
    const { db, data } = await setup();
    const big = newStory(db, { title: 'Vorzagath' });
    const part = newStory(db, { title: 'Die Duergar' });
    const undo = setStoryParent(db, part.id, big.id)!;
    expect(data().stories[part.id]!.parentId).toBe(big.id);
    // Nie im Kreis: Die große wird kein Teil ihres Teils.
    expect(setStoryParent(db, big.id, part.id)).toBeNull();
    let cards = boardCards(data());
    expect(cards.find((card) => card.key === `story:${big.id}`)!.parts).toBe(1);
    expect(boardWeb(data(), cards).strings).toMatchObject([
      { kind: 'part', a: `story:${big.id}`, b: `story:${part.id}` },
    ]);
    setPartsFolded(db, big.id, true);
    cards = boardCards(data());
    expect(cards.find((card) => card.key === `story:${part.id}`)!.onBoard).toBe(false);
    expect(boardWeb(data(), cards).strings).toEqual([]);
    setPartsFolded(db, big.id, false);
    undo();
    expect(data().stories[part.id]!.parentId).toBeNull();
  });

  it('legt eine Teilgeschichte mit Namen an und klappt dafür auf', async () => {
    const { db, data } = await setup();
    const big = newStory(db, { title: 'Vorzagath', partsFolded: true });
    const made = addSubStory(db, big.id, ' Die Geschichte Duskryns ')!;
    expect(made.story).toMatchObject({ title: 'Die Geschichte Duskryns', parentId: big.id });
    expect(data().stories[big.id]!.partsFolded).toBe(false);
    made.undo();
    expect(data().stories[made.story.id]).toBeUndefined();
  });
});

describe('Jede Schnur lässt sich lösen', () => {
  it('löst einen Namen überall, worüber er an der Geschichte hängt – der Text bleibt', async () => {
    const { db, data, arena, mira, thread } = await setup();
    const story = newStory(db, { title: 'Die Arena', ownerId: mira.id, refs: [arena.id] });
    const a = thread('Wer kämpft?', {
      storyId: story.id,
      hints: [
        { id: newId(), text: 'Ein Zettel', placeId: arena.id, sourceId: mira.id, found: false },
      ],
    });
    expect(nameSources(data(), `story:${story.id}`, mira.id)).toEqual([
      'Antreiber',
      'Hinweis „Ein Zettel“ (Wer weiß es?)',
    ]);
    const done = detachName(db, `story:${story.id}`, mira.id)!;
    expect(data().stories[story.id]!.ownerId).toBeNull();
    expect(data().threads[a.id]!.hints[0]).toMatchObject({
      text: 'Ein Zettel',
      sourceId: null,
      placeId: arena.id,
    });
    expect(
      boardCards(data()).find((card) => card.key === `story:${story.id}`)!.nodes,
    ).not.toContain(mira.id);
    done.undo();
    expect(data().stories[story.id]!.ownerId).toBe(mira.id);
    expect(data().threads[a.id]!.hints[0]!.sourceId).toBe(mira.id);
    // Ein Faden als Knoten behält seine Namen, wenn die Schnur der Geschichte gelöst wird.
    const knotted = detachName(db, `story:${story.id}`, arena.id, new Set([a.id]))!;
    expect(knotted.sources).toEqual(['Beteiligte']);
    expect(data().threads[a.id]!.hints[0]!.placeId).toBe(arena.id);
    expect(detachName(db, `knot:${a.id}`, arena.id)!.sources).toEqual([
      'Hinweis „Ein Zettel“ (Wo?)',
    ]);
    expect(detachName(db, `knot:${a.id}`, arena.id)).toBeNull();
  });
});

describe('Erledigte Fäden verschwinden vom Brett', () => {
  it('ein gelöster oder verlorener Faden hält keinen Knoten und keine Schnur mehr', async () => {
    const { db, data, thread } = await setup();
    const story = newStory(db, { title: 'Die Arena' });
    const other = newStory(db, { title: 'Der Salzhandel' });
    const a = thread('Wer kämpft?', { storyId: story.id });
    const b = thread('Wer kauft?', { storyId: other.id });
    tieThreads(db, a.id, b.id);
    expect(boardWeb(data(), boardCards(data())).strings).toHaveLength(1);
    db.patch('threads', a.id, { state: 'solved' });
    const web = boardWeb(data(), boardCards(data()));
    expect(web.strings).toEqual([]);
    expect(web.knots).toEqual([]);
    // Die Verbindung selbst bleibt gespeichert – wird er wieder offen, ist sie wieder da.
    expect(isTied(data(), a.id, b.id)).toBe(true);
    db.patch('threads', a.id, { state: 'open' });
    expect(boardWeb(data(), boardCards(data())).strings).toHaveLength(1);
  });
});

describe('Freie Schnüre und Suche am Schnurende', () => {
  it('legt eine freie Schnur an, gibt ihr ein Wort und löst sie wieder', async () => {
    const { db, data, mira, arena } = await setup();
    const link = addBoardLink(db, `node:${mira.id}`, `node:${arena.id}`)!;
    expect(addBoardLink(db, `node:${arena.id}`, `node:${mira.id}`)).toBeNull();
    setBoardLinkWord(db, link.id, ' kennt sich aus ');
    expect(data().state.boardLinks[0]!.word).toBe('kennt sich aus');
    const back = removeBoardLink(db, link.id)!;
    expect(data().state.boardLinks).toEqual([]);
    back();
    expect(data().state.boardLinks).toHaveLength(1);
  });

  it('schreibt einen Faden am Schnurende – an einer Geschichte, einem Faden, einem Namen', async () => {
    const { db, data, mira, thread } = await setup();
    const story = newStory(db, { title: 'Die Arena' });
    const fromStory = writeLinkedThread(db, `story:${story.id}`, 'Wer zahlt?', { x: 5, y: 5 })!;
    expect(fromStory.thread.storyId).toBe(story.id);
    expect(data().stories[story.id]!.unfolded).toBe(true);
    fromStory.undo();
    expect(data().threads[fromStory.thread.id]).toBeUndefined();
    expect(data().stories[story.id]!.unfolded).toBe(false);
    const a = thread('Start');
    const fromThread = writeLinkedThread(db, `thread:${a.id}`, 'Weiter', { x: 5, y: 5 })!;
    expect(isTied(data(), a.id, fromThread.thread.id)).toBe(true);
    const fromName = writeLinkedThread(db, `node:${mira.id}`, 'Was weiß Mira?', { x: 9, y: 9 })!;
    expect(data().threads[fromName.thread.id]!.refs).toEqual([mira.id]);
    expect(writeLinkedThread(db, `node:${mira.id}`, '  ', { x: 0, y: 0 })).toBeNull();
  });
});

describe('Schnüre ausblenden', () => {
  it('blendet nur das Bild aus – an der Geschichte ändert sich nichts', async () => {
    const { db, data, mira } = await setup();
    const story = newStory(db, { title: 'Die Arena', refs: [mira.id] });
    const key = `name:story:${story.id}|node:${mira.id}`;
    const undo = setStringsHidden(db, [key], true)!;
    expect(data().state.boardHidden).toEqual([key]);
    expect(data().stories[story.id]!.refs).toEqual([mira.id]);
    expect(setStringsHidden(db, [key], true)).toBeNull();
    undo();
    expect(data().state.boardHidden).toEqual([]);
    setStringsHidden(db, [key], true);
    setStringsHidden(db, [key], false);
    expect(data().state.boardHidden).toEqual([]);
  });
});
