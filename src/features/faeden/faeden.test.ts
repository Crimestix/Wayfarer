import { describe, expect, it } from 'vitest';
import { advanceTime, logEntry, setAttitude } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  PARTY_ID,
  createClock,
  createEncounter,
  createEntity,
  createEvent,
  newId,
  type Entity,
  type Place,
} from '../../domain/schema';
import {
  BOARD_CARD,
  BOARD_PIN,
  boardCards,
  boardLayout,
  entryFit,
  heroesOf,
  looseClocks,
  nearness,
  reputeOf,
  storiesHere,
  storiesOfHero,
  storyAdvice,
  storyNodes,
  storyStage,
  storyOfClock,
  threadWarning,
  touchReason,
  touches,
  untilText,
} from '../../domain/story';
import { clockView } from '../../domain/clock';
import { playClaims, playView } from '../../domain/play';
import { clockStand } from '../../domain/storySheet';
import { withoutHook } from '../../domain/prep';
import { saveWay } from '../wege/actions';
import {
  newStory,
  patchStory,
  patchThread,
  pinToCard,
  placeOnBoard,
  setThreadOnBoard,
  removeStory,
  removeThread,
  saveStory,
  saveThread,
  setHintFound,
  runStoryClock,
  setAdviceOff,
  setInPlay,
  setStoryMemo,
  setStorySteps,
  storyFromClock,
  tieHero,
  untieHero,
  tidyBoard,
  unpinFromCard,
  type StoryInput,
  type ThreadInput,
} from './actions';

/**
 * Erfundene Welt: Graufels mit Hafen und Markt, weit weg Hohenfurt. Die Gruppe steht am Markt.
 * Mira ist am Hafen, Odo in Hohenfurt; die Aalfischer sind eine Fraktion ohne festen Ort.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string, parentId: string | null = null) =>
    db.put('entities', createEntity({ kind: 'place', name, place: { parentId } })) as Place;
  const town = place('Graufels');
  const harbour = place('Hafen', town.id);
  const market = place('Markt', town.id);
  const far = place('Hohenfurt');
  const person = (name: string, placeId: string): Entity =>
    db.put('entities', createEntity({ kind: 'person', name, person: { placeId } }));
  const mira = person('Mira Tannhaus', harbour.id);
  const odo = person('Odo Tannhaus', far.id);
  const fishers = db.put('entities', createEntity({ kind: 'faction', name: 'Die Aalfischer' }));
  db.setState({ placeId: market.id });
  const data = () => db.getSnapshot();
  const story = (title: string, more: Partial<StoryInput> = {}) =>
    saveStory(db, {
      title,
      summary: '',
      ownerId: null,
      clockId: null,
      refs: [],
      entries: [],
      known: false,
      closed: false,
      ...more,
    });
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
  return { db, data, town, harbour, market, far, mira, odo, fishers, story, thread, hint };
}

describe('Wie nah die Gruppe dran ist', () => {
  it('hier, erreichbar oder fern – nach den Orten, an denen etwas hängt', async () => {
    const { db, data, town, harbour, market, far, mira, odo, fishers } = await setup();
    expect(nearness(data(), [market.id])).toBe('here');
    // Die Stadt, in der die Gruppe steht, ist auch „hier“.
    expect(nearness(data(), [town.id])).toBe('here');
    // Der Hafen liegt in derselben Stadt; Mira ist dort.
    expect(nearness(data(), [harbour.id])).toBe('reachable');
    expect(nearness(data(), [mira.id])).toBe('reachable');
    expect(nearness(data(), [far.id])).toBe('far');
    expect(nearness(data(), [odo.id])).toBe('far');
    // Eine Fraktion ohne Ort ist an nichts festgemacht.
    expect(nearness(data(), [fishers.id])).toBe('far');
    expect(nearness(data(), [])).toBe('far');
    // Führt ein Weg hin, ist es erreichbar.
    saveWay(db, { fromId: market.id, toId: far.id, minutes: 600 });
    expect(nearness(data(), [odo.id])).toBe('reachable');
    // Ein naher Knoten genügt.
    expect(nearness(data(), [fishers.id, market.id])).toBe('here');
  });
});

describe('Woran eine Geschichte hängt', () => {
  it('Antreiber, Zugehöriges, der Ort ihrer Uhr, Einstiege und alles an ihren Fäden', async () => {
    const { db, data, harbour, market, far, mira, fishers, story, thread, hint } = await setup();
    const clock = db.put(
      'clocks',
      createClock({ title: 'Übernahme', start: data().state.now, placeId: harbour.id }),
    );
    const tale = story('Die Aalfischer wollen den Hafen', {
      ownerId: fishers.id,
      clockId: clock.id,
      entries: [
        { id: newId(), text: 'Ein Fischer bittet um Hilfe', placeId: market.id, standing: 'any' },
      ],
    });
    thread('Wer bezahlt die Schläger?', {
      storyId: tale.id,
      refs: [mira.id],
      hints: [hint('Münzen aus Hohenfurt', far.id)],
    });
    expect(storyNodes(data(), data().stories[tale.id]!).sort()).toEqual(
      [fishers.id, harbour.id, market.id, mira.id, far.id].sort(),
    );
  });
});

describe('Das Fadenbrett', () => {
  it('ordnet nach Nähe, Geschichten vor losen Fäden, Abgeschlossenes zuletzt', async () => {
    const { data, market, far, story, thread } = await setup();
    story('Fern: Der Graf rüstet', { refs: [far.id] });
    story('Hier: Die Glocke am Markt', { refs: [market.id] });
    story('Vorbei: Der alte Streit', { refs: [market.id], closed: true });
    thread('Wohin führen die Wolfsfährten?', { refs: [market.id] });
    thread('Gelöst: Wer stahl das Siegel?', { state: 'solved', refs: [market.id] });
    expect(boardCards(data()).map((card) => [card.title, card.nearness, card.closed])).toEqual([
      ['Hier: Die Glocke am Markt', 'here', false],
      ['Wohin führen die Wolfsfährten?', 'here', false],
      ['Fern: Der Graf rüstet', 'far', false],
      ['Vorbei: Der alte Streit', 'here', true],
      ['Gelöst: Wer stahl das Siegel?', 'here', true],
    ]);
  });

  it('erkennt, wo Geschichten sich berühren – an gemeinsamen Knoten', async () => {
    const { data, harbour, mira, far, story, thread } = await setup();
    story('Die Aalfischer wollen den Hafen', { refs: [harbour.id, mira.id] });
    story('Schmuggel aus Hohenfurt', { refs: [far.id, harbour.id] });
    story('Für sich: Die Glocke', {});
    thread('Was sah Mira in jener Nacht?', { refs: [mira.id] });
    const cards = boardCards(data());
    const title = (key: string) => cards.find((card) => card.key === key)!.title;
    const found = touches(cards).map(
      (touch) =>
        `${[title(touch.a), title(touch.b)].sort().join(' ↔ ')} ${touchReason(data(), touch)}`,
    );
    expect(found.sort()).toEqual([
      'Die Aalfischer wollen den Hafen ↔ Schmuggel aus Hohenfurt über Hafen',
      'Die Aalfischer wollen den Hafen ↔ Was sah Mira in jener Nacht? über Mira Tannhaus',
    ]);
  });

  it('zeigt in der Sicht der Gruppe nur, was sie kennt', async () => {
    const { data, harbour, market, story, thread, hint } = await setup();
    const secret = story('Die Aalfischer wollen den Hafen', { refs: [harbour.id] });
    thread('Wer bezahlt die Schläger?', {
      storyId: secret.id,
      known: true,
      truth: 'Der Hafenmeister selbst.',
      hints: [hint('Münzen aus Hohenfurt', market.id, true), hint('Der Brief im Kontor')],
    });
    thread('Was liegt im Wrack?', { storyId: secret.id });
    const open = story('Die Glocke am Markt', { known: true, refs: [market.id] });
    thread('Wer läutet nachts?', { storyId: open.id, known: true });
    thread('Warum schweigt der Küster?', { storyId: open.id });

    const party = boardCards(data(), 'party');
    expect(party.map((card) => [card.title, card.story !== null])).toEqual([
      // Von der Geschichte der Aalfischer weiß die Gruppe nichts: Sie sieht nur den Faden.
      ['Wer bezahlt die Schläger?', false],
      ['Die Glocke am Markt', true],
    ]);
    const lone = party[0]!.threads[0]!;
    expect(lone.truth).toBe('');
    expect(lone.hints.map((entry) => entry.text)).toEqual(['Münzen aus Hohenfurt']);
    expect(party[1]!.threads.map((entry) => entry.title)).toEqual(['Wer läutet nachts?']);
    // Die Wahrheit zeigt alles.
    expect(boardCards(data()).flatMap((card) => card.threads)).toHaveLength(4);
  });

  it('nennt die große Geschichte einer Teilgeschichte – der Gruppe nur, wenn sie von ihr weiß', async () => {
    const { db, data, story } = await setup();
    const big = story('Die Aalfischer wollen den Hafen');
    const part = story('Der Streit um den Liegeplatz', { known: true });
    patchStory(db, part.id, { parentId: big.id });
    const partOf = (view: 'truth' | 'party') =>
      boardCards(data(), view).find((card) => card.key === `story:${part.id}`)!.partOf?.title;
    expect(partOf('truth')).toBe('Die Aalfischer wollen den Hafen');
    // Die Marke „Teil von …“ verriete sonst den Namen einer Geschichte, die die Gruppe nicht kennt.
    expect(partOf('party')).toBeUndefined();
    patchStory(db, big.id, { known: true });
    expect(partOf('party')).toBe('Die Aalfischer wollen den Hafen');
    expect(boardCards(data()).find((card) => card.key === `story:${big.id}`)!.partOf).toBeNull();
  });
});

describe('Die Pinnwand', () => {
  it('legt Karten und Namen aus, ohne dass etwas aufeinanderliegt – und lässt liegen, was hingelegt wurde', async () => {
    const { db, data, story, thread, market, harbour, mira, fishers } = await setup();
    const toll = story('Der Zoll wird verdoppelt', { ownerId: fishers.id, refs: [harbour.id] });
    const bell = story('Die stumme Glocke', { refs: [market.id, harbour.id] });
    const watcher = thread('Wer bezahlt den Aalwächter?', { refs: [mira.id] });
    // Ein loser Faden liegt erst auf dem Brett, wenn der Spielleiter ihn hinlegt.
    expect(Object.keys(boardLayout(boardCards(data())).cards).sort()).toEqual(
      [`story:${toll.id}`, `story:${bell.id}`].sort(),
    );
    setThreadOnBoard(db, watcher.id, true);
    let layout = boardLayout(boardCards(data()), data().state.board);
    expect(Object.keys(layout.cards).sort()).toEqual(
      boardCards(data())
        .map((card) => card.key)
        .sort(),
    );
    // Der Hafen hängt an beiden Geschichten: ein Name, zwei Fäden.
    const shared = layout.pins.find((pin) => pin.id === harbour.id)!;
    expect(shared.cards.sort()).toEqual([`story:${bell.id}`, `story:${toll.id}`].sort());
    expect(layout.pins.find((pin) => pin.id === mira.id)!.cards).toHaveLength(1);
    // Nichts liegt aufeinander.
    const boxes = [
      ...Object.values(layout.cards).map((at) => ({
        x: at.x,
        y: at.y + BOARD_CARD.height / 2,
        w: BOARD_CARD.width,
        h: BOARD_CARD.height,
      })),
      ...layout.pins.map((pin) => ({
        x: pin.x,
        y: pin.y,
        w: BOARD_PIN.width,
        h: BOARD_PIN.height,
      })),
    ];
    for (let i = 0; i < boxes.length; i++)
      for (let k = i + 1; k < boxes.length; k++) {
        const [a, b] = [boxes[i]!, boxes[k]!];
        const apart =
          Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2;
        expect(apart).toBe(true);
      }

    // Was der Spielleiter hinlegt, bleibt dort; die eigenen Namen einer Karte ziehen mit ihr um.
    const before = layout.pins.find((pin) => pin.id === fishers.id)!;
    placeOnBoard(db, `story:${toll.id}`, 2000.4, 900);
    placeOnBoard(db, `node:${harbour.id}`, -300, -200);
    layout = boardLayout(boardCards(data()), data().state.board);
    expect(layout.cards[`story:${toll.id}`]).toEqual({ x: 2000, y: 900 });
    expect(layout.pins.find((pin) => pin.id === harbour.id)).toMatchObject({ x: -300, y: -200 });
    const after = layout.pins.find((pin) => pin.id === fishers.id)!;
    expect(after.x - before.x).toBeGreaterThan(500);

    // Aufräumen legt die Geschichten neu aus – einzeln Hingelegtes (Namen) bleibt liegen – und
    // lässt sich zurücknehmen.
    const undo = tidyBoard(db);
    expect(data().state.board).toEqual({ [`node:${harbour.id}`]: { x: -300, y: -200 } });
    undo();
    expect(Object.keys(data().state.board)).toHaveLength(2);
  });

  it('heftet Namen an eine Karte und löst sie wieder', async () => {
    const { db, data, story, thread, mira, odo } = await setup();
    const toll = story('Der Zoll wird verdoppelt');
    const loose = thread('Das Licht auf der Aalinsel');
    setThreadOnBoard(db, loose.id, true);
    pinToCard(db, `story:${toll.id}`, mira.id);
    pinToCard(db, `story:${toll.id}`, mira.id);
    pinToCard(db, `thread:${loose.id}`, odo.id);
    pinToCard(db, `story:${toll.id}`, 'gibtsnicht');
    expect(data().stories[toll.id]!.refs).toEqual([mira.id]);
    expect(data().threads[loose.id]!.refs).toEqual([odo.id]);
    const layout = boardLayout(boardCards(data()));
    expect(layout.pins.map((pin) => pin.id).sort()).toEqual([mira.id, odo.id].sort());
    unpinFromCard(db, `story:${toll.id}`, mira.id);
    expect(data().stories[toll.id]!.refs).toEqual([]);
  });
});

describe('Eine Geschichte auf ihrem Blatt', () => {
  it('sagt, was noch fehlt – als Rat', async () => {
    const { db, data, hint, market, harbour, fishers } = await setup();
    const blank = newStory(db);
    const open = () =>
      storyAdvice(data(), data().stories[blank.id]!)
        .filter((entry) => !entry.done)
        .map((entry) => entry.key);
    // In der Reihenfolge der Fächer des Blatts.
    expect(open()).toEqual([
      'owner',
      'goal',
      'needs',
      'clock',
      'stakes',
      'hero',
      'entry',
      'threads',
      'place',
      'scene',
      'ending',
      'reward',
    ]);
    patchStory(db, blank.id, {
      title: '  Der Zoll wird verdoppelt ',
      summary: 'Die Aalfischer wollen den Zoll.',
      ownerId: fishers.id,
      stakes: 'Der Hafen gehört bald ihnen.',
      refs: [harbour.id, harbour.id],
      entries: [
        { id: newId(), text: 'Ein Aushang am Zollhaus', placeId: market.id, standing: 'any' },
        { id: newId(), text: '  ', placeId: null, standing: 'any' },
      ],
      ending: 'Der Rat entscheidet.',
      reward: 'Ein Gefallen der Zöllner.',
    });
    const story = () => data().stories[blank.id]!;
    expect(story().title).toBe('Der Zoll wird verdoppelt');
    expect(story().refs).toEqual([harbour.id]);
    // Einstiege ohne Text fallen weg.
    expect(story().entries).toHaveLength(1);
    expect(open()).toEqual(['needs', 'clock', 'hero', 'threads', 'scene']);

    // Eine Frage mit zu wenigen Hinweisen trägt noch nicht – mit dreien ist es gut.
    const who = saveThread(db, {
      title: 'Wer hat den Zöllner bestochen?',
      truth: '',
      state: 'open',
      storyId: blank.id,
      refs: [],
      known: false,
      hints: [hint('Ein Beutel mit fremden Münzen', market.id)],
    });
    expect(open()).toEqual(['needs', 'clock', 'hero', 'threads', 'scene']);
    const lead = () => storyAdvice(data(), story()).find((entry) => entry.key === 'threads')!;
    expect(lead().why).toContain('Erst einer');
    // Der Punkt weiß, welche Frage gemeint ist – dorthin führt er auf dem Blatt.
    expect(lead().threadId).toBe(who.id);
    patchThread(db, who.id, {
      hints: [
        ...data().threads[who.id]!.hints,
        hint('Ein Brief im Kontor', harbour.id),
        hint('Die Wirtin hat es gesehen'),
        hint('   '),
      ],
    });
    expect(data().threads[who.id]!.hints).toHaveLength(3);
    expect(open()).toEqual(['needs', 'clock', 'hero', 'scene']);
    expect(lead().threadId).toBeUndefined();
    // Jede weitere Frage mit zu wenigen Hinweisen wird beim Namen genannt.
    const where = saveThread(db, {
      title: 'Wohin geht das Geld?',
      truth: '',
      state: 'open',
      storyId: blank.id,
      refs: [],
      known: false,
      hints: [],
    });
    expect(open()).toEqual(['needs', 'clock', 'hero', `hints:${where.id}`, 'scene']);
    expect(
      storyAdvice(data(), story()).find((entry) => entry.key === `hints:${where.id}`)!.threadId,
    ).toBe(where.id);
    // Ein Schritt reicht – eine Mindestzahl gibt es nicht.
    setStorySteps(db, blank.id, [{ id: newId(), text: 'Der Zoll steigt', days: 3 }]);
    expect(open()).not.toContain('clock');
    // Was der Spielleiter nicht braucht, wählt er ab; es steht weiter da, zählt aber nicht.
    setAdviceOff(db, blank.id, 'hero', true);
    setAdviceOff(db, blank.id, 'hero', true);
    expect(story().adviceOff).toEqual(['hero']);
    expect(storyAdvice(data(), story()).find((entry) => entry.key === 'hero')).toMatchObject({
      done: false,
      off: true,
      section: 'heroes',
    });
    setAdviceOff(db, blank.id, 'hero', false);
    expect(story().adviceOff).toEqual([]);
  });

  it('nennt den Stand – Keim, spielbar, rund – und was als Nächstes fehlt', async () => {
    const { db, data, hint, market, fishers } = await setup();
    const blank = newStory(db);
    const stage = () => {
      const view = storyStage(data(), data().stories[blank.id]!);
      return [view.stage, view.next.map((entry) => entry.key)];
    };
    // Erst, was zum Keim gehört: wer, was er will, ein nächster Schritt.
    expect(stage()).toEqual(['seed', ['owner', 'goal', 'clock']]);
    patchStory(db, blank.id, { ownerId: fishers.id, summary: 'Den Zoll am Hafen.' });
    setStorySteps(db, blank.id, [{ id: newId(), text: 'Der Zoll steigt', days: 3 }]);
    // Dann, was sie spielbar macht – nie mehr als drei Dinge auf einmal.
    expect(stage()).toEqual(['seed', ['entry', 'threads', 'place']]);
    patchStory(db, blank.id, {
      entries: [{ id: newId(), text: 'Ein Aushang', placeId: market.id, standing: 'any' }],
      scenes: [
        { id: newId(), text: 'Am Zollhaus', encounterId: null, odds: 'sure', placeId: null },
      ],
    });
    saveThread(db, {
      title: 'Wer hat den Zöllner bestochen?',
      truth: '',
      state: 'open',
      storyId: blank.id,
      refs: [],
      known: false,
      hints: [hint('Münzen'), hint('Ein Brief'), hint('Die Wirtin')],
    });
    expect(stage()).toEqual(['playable', ['needs', 'stakes', 'hero']]);
    // Abgewähltes fehlt nicht.
    for (const key of ['needs', 'hero', 'reward']) setAdviceOff(db, blank.id, key, true);
    expect(stage()).toEqual(['playable', ['stakes', 'ending']]);
    patchStory(db, blank.id, { stakes: 'Hält der Rat stand?', ending: 'Der Rat entscheidet.' });
    expect(stage()).toEqual(['round', []]);
  });

  it('schreibt die Schritte der Uhr – die Uhr entsteht mit dem ersten', async () => {
    const { db, data, fishers } = await setup();
    const toll = newStory(db, { title: 'Der Zoll wird verdoppelt', ownerId: fishers.id });
    const now = data().state.now;
    const DAY = 24 * 60;
    // Ohne Text entsteht nichts.
    setStorySteps(db, toll.id, [{ id: newId(), text: '  ', days: 3 }]);
    expect(data().stories[toll.id]!.clockId).toBeNull();
    const [first, second] = [newId(), newId()];
    setStorySteps(db, toll.id, [
      { id: first, text: 'Die Zöllner werden bestochen', days: 2 },
      { id: second, text: 'Der Zoll wird verdoppelt', days: 0 },
    ]);
    const clock = () => data().clocks[data().stories[toll.id]!.clockId!]!;
    expect(clock()).toMatchObject({ title: 'Der Zoll wird verdoppelt', ownerId: fishers.id });
    expect(clock().steps.map((step) => [step.text, step.days])).toEqual([
      ['Die Zöllner werden bestochen', 2],
      // Eine Dauer von null gibt es nicht: mindestens ein Tag.
      ['Der Zoll wird verdoppelt', 1],
    ]);
    // Die Uhr heißt wie die Geschichte – und zieht mit, wenn die umbenannt wird.
    patchStory(db, toll.id, { title: 'Der Griff nach dem Zoll' });
    expect(clock().title).toBe('Der Griff nach dem Zoll');
    // Die neue Uhr steht noch: Beim Schreiben tritt nichts von selbst ein.
    expect(clock().pausedAt).toBe(now);
    expect(clockStand(data(), data().stories[toll.id]!)).toMatchObject({
      pace: 'paused',
      fresh: true,
    });
    advanceTime(db, now + DAY);
    expect(clock().steps[0]!.at).toBeNull();
    // Gestartet zählt die Frist des ersten Schrittes ab dem Start – nicht ab dem Schreiben.
    runStoryClock(db, toll.id, true);
    expect(clock()).toMatchObject({ pausedAt: null, start: now + DAY });
    expect(clock().steps[0]!.delay).toBe(0);
    expect(clockStand(data(), data().stories[toll.id]!)).toMatchObject({
      pace: 'running',
      fresh: false,
    });
    // Was eingetreten ist, bleibt, auch wenn die offenen Schritte neu geschrieben werden.
    advanceTime(db, now + 3 * DAY + 60);
    expect(clock().steps[0]!.at).not.toBeNull();
    // Anhalten und wieder laufen lassen: Die Standzeit schiebt den nächsten Schritt hinaus.
    runStoryClock(db, toll.id, false);
    expect(clock().pausedAt).toBe(now + 3 * DAY + 60);
    advanceTime(db, now + 4 * DAY + 60);
    runStoryClock(db, toll.id, true);
    expect(clock().pausedAt).toBeNull();
    expect(clock().steps[1]!.delay).toBe(DAY);
    // Woran die Gruppe einen Schritt merkt, bleibt stehen, wenn nur der Text neu geschrieben wird.
    setStorySteps(db, toll.id, [
      { id: second, text: 'Der Zoll wird verdoppelt', days: 4, sign: ' Neue Tafeln am Tor ' },
    ]);
    expect(clock().steps[1]!.sign).toBe('Neue Tafeln am Tor');
    setStorySteps(db, toll.id, [{ id: second, text: 'Der Zoll wird verdreifacht', days: 4 }]);
    expect(clock().steps.map((step) => step.text)).toEqual([
      'Die Zöllner werden bestochen',
      'Der Zoll wird verdreifacht',
    ]);
  });

  it('ein neuer Schritt nach langer Pause zählt ab jetzt – er tritt nicht sofort ein', async () => {
    const { db, data } = await setup();
    const toll = newStory(db, { title: 'Der Zoll wird verdoppelt' });
    const now = data().state.now;
    const DAY = 24 * 60;
    const clock = () => data().clocks[data().stories[toll.id]!.clockId!]!;
    const next = () => clockView(clock(), data().state.now).next!.at;
    setStorySteps(db, toll.id, [{ id: newId(), text: 'Die Zöllner werden bestochen', days: 2 }]);
    runStoryClock(db, toll.id, true);
    advanceTime(db, now + 2 * DAY);
    expect(clock().steps[0]!.at).toBe(now + 2 * DAY);
    // Drei Wochen später schreibt der Spielleiter weiter: „nach 3 Tagen“ heißt in drei Tagen.
    advanceTime(db, now + 23 * DAY);
    const later = newId();
    setStorySteps(db, toll.id, [{ id: later, text: 'Der Zoll wird verdoppelt', days: 3 }]);
    expect(next()).toBe(now + 26 * DAY);
    advanceTime(db, now + 24 * DAY);
    expect(clock().steps[1]!.at).toBeNull();
    // Wird nur der Text neu geschrieben, bleibt die Frist; ein weiterer Schritt hängt sich an.
    setStorySteps(db, toll.id, [
      { id: later, text: 'Der Zoll wird verdreifacht', days: 3 },
      { id: newId(), text: 'Die Fähre stellt den Betrieb ein', days: 2 },
    ]);
    expect(next()).toBe(now + 26 * DAY);
    expect(clock().steps[2]!.delay).toBe(0);
    // Dasselbe bei einer laufenden Uhr, deren Schritte alle gestrichen wurden.
    const ferry = newStory(db, { title: 'Die Fähre' });
    setStorySteps(db, ferry.id, [{ id: newId(), text: 'Der Fährmann kündigt', days: 1 }]);
    runStoryClock(db, ferry.id, true);
    setStorySteps(db, ferry.id, []);
    advanceTime(db, now + 40 * DAY);
    setStorySteps(db, ferry.id, [{ id: newId(), text: 'Die Fähre liegt fest', days: 2 }]);
    const ferryClock = data().clocks[data().stories[ferry.id]!.clockId!]!;
    expect(clockView(ferryClock, data().state.now).next!.at).toBe(now + 42 * DAY);
    // Eine Uhr, die noch nie lief, braucht keinen Aufschub: Sie beginnt mit dem Start.
    const quiet = newStory(db, { title: 'Der stille Teilhaber' });
    setStorySteps(db, quiet.id, [{ id: newId(), text: 'Er kauft die Schuldscheine', days: 2 }]);
    setStorySteps(db, quiet.id, []);
    advanceTime(db, now + 50 * DAY);
    setStorySteps(db, quiet.id, [{ id: newId(), text: 'Er fordert sie ein', days: 2 }]);
    expect(data().clocks[data().stories[quiet.id]!.clockId!]!.steps[0]!.delay).toBe(0);
  });

  it('betrifft Gefährten persönlich – jeden einmal, mit seinem Grund', async () => {
    const { db, data, mira } = await setup();
    const mate = (name: string) => db.put('entities', createEntity({ kind: 'character', name })).id;
    const [corrin, nex] = [mate('Corrin'), mate('Nex')];
    const toll = newStory(db, { title: 'Der Griff nach dem Zoll', inPlay: true });
    const crows = newStory(db, { title: 'Die Krähen kommen' });
    tieHero(db, toll.id, corrin, ' Schuldet den Aalfischern Geld. ');
    tieHero(db, toll.id, corrin);
    // Eine Person der Welt ist kein Gefährte.
    tieHero(db, toll.id, mira.id, 'Gehört nicht hierher');
    tieHero(db, crows.id, corrin, 'Sein Bruder ist bei der Bande.');
    const story = () => data().stories[toll.id]!;
    expect(story().heroes.map((hero) => [hero.characterId, hero.why])).toEqual([
      [corrin, 'Schuldet den Aalfischern Geld.'],
    ]);
    expect(storyAdvice(data(), story()).find((entry) => entry.key === 'hero')!.done).toBe(true);
    // Der Gefährte hängt an der Geschichte wie ihre Leute – auf dem Brett verbindet ihn ein Faden.
    expect(storyNodes(data(), story())).toContain(corrin);
    // Bei ihm stehen seine Geschichten, die im Spiel zuerst.
    expect(storiesOfHero(data(), corrin).map((tie) => [tie.story.title, tie.why])).toEqual([
      ['Der Griff nach dem Zoll', 'Schuldet den Aalfischern Geld.'],
      ['Die Krähen kommen', 'Sein Bruder ist bei der Bande.'],
    ]);
    expect(playView(data()).cards[0]!.heroes.map((entry) => entry.character.name)).toEqual([
      'Corrin',
    ]);
    // Für Nex ist an diesem Abend nichts dabei.
    expect(withoutHook(data()).map((character) => character.id)).toContain(nex);
    expect(withoutHook(data()).map((character) => character.id)).not.toContain(corrin);
    untieHero(db, toll.id, corrin);
    expect(story().heroes).toEqual([]);
    // Zu Ende Erzähltes zählt nicht mehr.
    patchStory(db, crows.id, { closed: true });
    expect(storiesOfHero(data(), corrin)).toEqual([]);
    // Ein gelöschter Gefährte verschwindet aus der Geschichte, ohne dass sie kaputtgeht.
    tieHero(db, toll.id, nex);
    db.remove('entities', nex);
    expect(heroesOf(data(), story())).toEqual([]);
  });

  it('hält Szenen bereit – mit oder ohne Begegnung', async () => {
    const { db, data } = await setup();
    const toll = newStory(db, { inPlay: true });
    const ambush = db.put('encounters', createEncounter({ name: 'Überfall am Zollhaus' }));
    patchStory(db, toll.id, {
      scenes: [
        {
          id: newId(),
          text: 'Ein Zöllner will reden',
          encounterId: null,
          odds: 'maybe',
          placeId: null,
        },
        { id: newId(), text: '', encounterId: ambush.id, odds: 'sure', placeId: null },
        {
          id: newId(),
          text: 'Gibt es nicht',
          encounterId: 'gibtsnicht',
          odds: 'unlikely',
          placeId: null,
        },
        { id: newId(), text: ' ', encounterId: null, odds: 'maybe', placeId: null },
      ],
    });
    expect(data().stories[toll.id]!.scenes.map((scene) => scene.encounterId)).toEqual([
      null,
      ambush.id,
      null,
    ]);
    // Am Spieltisch stehen die sicheren zuerst.
    expect(playView(data()).cards[0]!.scenes.map((scene) => scene.odds)).toEqual([
      'sure',
      'maybe',
      'unlikely',
    ]);
  });
});

describe('Im Spiel', () => {
  it('zeigt nur, was der Spielleiter hereingenommen hat – und bietet an, was den Ort berührt', async () => {
    const { db, data, story, thread, market, far } = await setup();
    const bell = story('Die stumme Glocke', { refs: [market.id] });
    const toll = story('Der Zoll wird verdoppelt', { refs: [far.id] });
    const loose = thread('Wer bezahlt den Aalwächter?', { refs: [market.id] });
    expect(playView(data()).cards).toEqual([]);
    // Was am Ort der Gruppe hängt, wird angeboten – das Entfernte nicht.
    expect(
      playView(data())
        .offered.map((card) => card.key)
        .sort(),
    ).toEqual([`story:${bell.id}`, `thread:${loose.id}`].sort());
    setInPlay(db, `story:${toll.id}`, true);
    setInPlay(db, `story:${bell.id}`, true);
    setInPlay(db, `thread:${loose.id}`, true);
    const view = playView(data());
    // Was hier hängt, steht oben.
    expect(view.cards.map((play) => play.card.title)).toEqual([
      'Die stumme Glocke',
      'Wer bezahlt den Aalwächter?',
      'Der Zoll wird verdoppelt',
    ]);
    expect(view.cards.map((play) => play.where)).toEqual([
      'hängt an diesem Ort',
      'hängt an diesem Ort',
      'weit weg',
    ]);
    expect(view.offered).toEqual([]);
    // Zu Ende erzählt: Die Geschichte steht nicht mehr am Tisch.
    db.patch('stories', bell.id, { closed: true });
    expect(playView(data()).cards.map((play) => play.card.title)).not.toContain(
      'Die stumme Glocke',
    );
    setInPlay(db, `story:${toll.id}`, false);
    expect(playView(data()).cards).toHaveLength(1);
  });

  it('sammelt, was an einer Geschichte hängt', async () => {
    const { db, data, story, thread, hint, market, harbour, far, mira, odo, fishers } =
      await setup();
    const now = data().state.now;
    const DAY = 24 * 60;
    for (const id of Object.keys(data().events)) db.remove('events', id);
    const toll = story('Der Zoll wird verdoppelt', {
      ownerId: fishers.id,
      refs: [mira.id, odo.id],
      entries: [
        { id: newId(), text: 'Ein Aushang am Zollhaus', placeId: market.id, standing: 'any' },
        { id: newId(), text: 'Odo erzählt davon', placeId: far.id, standing: 'any' },
      ],
    });
    const who = thread('Wer hat den Zöllner bestochen?', {
      storyId: toll.id,
      hints: [
        hint('Ein Beutel mit fremden Münzen', market.id),
        hint('Ein Brief im Kontor', harbour.id),
        hint('Schon gefunden', market.id, true),
      ],
    });
    thread('Längst gelöst', { storyId: toll.id, state: 'solved' });
    setInPlay(db, `story:${toll.id}`, true);
    // Mira kommt vom Hafen an den Markt, wo die Gruppe steht.
    if (mira.kind === 'person')
      db.put('entities', { ...mira, person: { ...mira.person, placeId: market.id } });
    const promise = logEntry(db, {
      kind: 'promise',
      text: 'Mira schweigt über den Zoll',
      refs: [mira.id],
    });
    logEntry(db, { kind: 'promise', text: 'Ohne Bezug', refs: [market.id] });
    const own = logEntry(db, { kind: 'promise', text: 'Der Rat zahlt', storyId: toll.id });
    db.put('events', createEvent({ title: 'Zollabrechnung', at: now + 6 * DAY, threadId: who.id }));
    db.put('events', createEvent({ title: 'Mira reist ab', at: now + 2 * DAY, refs: [mira.id] }));
    db.put('events', createEvent({ title: 'Markttag', at: now + DAY, placeId: market.id }));
    logEntry(db, { text: 'Die Gruppe hört vom Zoll', storyId: toll.id });
    setStoryMemo(db, toll.id, 'Mira weiß mehr, als sie sagt.');

    const [play] = playView(data()).cards;
    expect(play!.hints.map(({ hint: entry }) => entry.text)).toEqual([
      'Ein Beutel mit fremden Münzen',
    ]);
    expect(play!.entries.map(({ entry }) => entry.text)).toEqual(['Ein Aushang am Zollhaus']);
    expect(play!.present.map((entity) => entity.name)).toEqual(['Mira Tannhaus']);
    expect(play!.threads.map((entry) => [entry.thread.title, entry.found])).toEqual([
      ['Wer hat den Zöllner bestochen?', 1],
    ]);
    expect(play!.promises.map((entry) => entry.id).sort()).toEqual([promise.id, own.id].sort());
    expect(play!.events.map((occurrence) => occurrence.event.title)).toEqual([
      'Mira reist ab',
      'Zollabrechnung',
    ]);
    expect(play!.notes.map((entry) => entry.text)).toEqual(['Die Gruppe hört vom Zoll']);
    expect(play!.memo).toBe('Mira weiß mehr, als sie sagt.');
    // Was bei der Geschichte steht, steht unter „Sonst noch“ nicht noch einmal.
    const claims = playClaims(playView(data()));
    expect(claims.has(`promise:${promise.id}`)).toBe(true);
    expect([...claims].filter((key) => key.startsWith('event:'))).toHaveLength(2);
    // Auch der Hinweis, der hier liegt – auf dem Blatt des Abends steht er dann nicht noch einmal.
    expect([...claims].filter((key) => key.startsWith('hint:'))).toEqual([
      `hint:${who.id}:${play!.hints[0]!.hint.id}`,
    ]);
  });
});

describe('Hinweise', () => {
  it('warnt, wenn ein Faden an einem einzigen Hinweis hängt – eine Idee ohne Hinweise nicht', async () => {
    const { db, data, thread, hint } = await setup();
    const one = thread('Wer bezahlt die Schläger?', { hints: [hint('Münzen aus Hohenfurt')] });
    expect(threadWarning(one)).toContain('einzigen Hinweis');
    // Ohne Hinweise ist er eine Idee, die noch wächst.
    expect(threadWarning(thread('Was liegt im Wrack?'))).toBeNull();
    // Kennt die Gruppe den Faden schon, braucht sie keinen Hinweis, um ihn zu finden.
    expect(threadWarning(thread('Wohin führen die Fährten?', { known: true }))).toBeNull();
    expect(
      threadWarning(thread('Zwei Wege', { hints: [hint('Erster'), hint('Zweiter')] })),
    ).toBeNull();
    expect(threadWarning(thread('Vorbei', { state: 'lost' }))).toBeNull();

    // Findet die Gruppe den Hinweis, kennt sie den Faden – und er wird aktiv.
    setHintFound(db, one.id, one.hints[0]!.id, true);
    const now = data().threads[one.id]!;
    expect(now).toMatchObject({ known: true, state: 'active' });
    expect(threadWarning(now)).toBeNull();
  });
});

describe('Löschen', () => {
  it('eine Geschichte lässt ihre Fäden als lose Fäden zurück', async () => {
    const { db, data, story, thread } = await setup();
    const tale = story('Die Glocke am Markt');
    const question = thread('Wer läutet nachts?', { storyId: tale.id });
    removeStory(db, tale.id);
    expect(data().stories[tale.id]).toBeUndefined();
    expect(data().threads[question.id]!.storyId).toBeNull();
  });

  it('die Uhr gehört zur Geschichte: Sie geht mit ihr – und eine Uhr für sich wird zu einer', async () => {
    const { db, data, market, fishers } = await setup();
    const now = data().state.now;
    // Eine Uhr aus der Zeit, als Uhren im Kalender angelegt wurden.
    const old = db.put(
      'clocks',
      createClock({
        title: 'Die Aalfischer rüsten',
        start: now,
        ownerId: fishers.id,
        placeId: market.id,
      }),
    );
    expect(looseClocks(data()).map((clock) => clock.id)).toEqual([old.id]);
    expect(storyOfClock(data(), old.id)).toBeNull();
    const tale = storyFromClock(db, old.id)!;
    expect(tale).toMatchObject({
      title: 'Die Aalfischer rüsten',
      ownerId: fishers.id,
      clockId: old.id,
      refs: [market.id],
    });
    // Ein zweites Mal entsteht keine zweite Geschichte.
    expect(storyFromClock(db, old.id)!.id).toBe(tale.id);
    expect(looseClocks(data())).toEqual([]);
    expect(storyOfClock(data(), old.id)?.id).toBe(tale.id);
    removeStory(db, tale.id);
    expect(data().clocks[old.id]).toBeUndefined();
  });

  it('ein Faden lässt seine Termine zurück – ohne Faden', async () => {
    const { db, data, thread } = await setup();
    const question = thread('Wer läutet nachts?');
    const bell = db.put(
      'events',
      createEvent({ title: 'Die Glocke läutet', at: data().state.now, threadId: question.id }),
    );
    removeThread(db, question.id);
    expect(data().threads[question.id]).toBeUndefined();
    expect(data().events[bell.id]!.threadId).toBeNull();
  });
});

describe('Ruf', () => {
  it('liest die Haltung zur Gruppe und zu einzelnen Gefährten zusammen', async () => {
    const { db, data, fishers } = await setup();
    const corrin = db.put('entities', createEntity({ kind: 'character', name: 'Corrin' }));
    const nael = db.put('entities', createEntity({ kind: 'character', name: 'Naelmira' }));
    expect(reputeOf(data(), fishers.id)).toEqual({ party: null, members: [] });
    setAttitude(db, fishers.id, PARTY_ID, 2);
    setAttitude(db, fishers.id, nael.id, -3);
    expect(reputeOf(data(), fishers.id)).toEqual({
      party: 2,
      members: [{ id: nael.id, name: 'Naelmira', value: -3 }],
    });
    expect(corrin.kind).toBe('character');
  });

  it('entscheidet, welcher Einstieg passt – nicht, was geschieht', async () => {
    const { db, data, fishers } = await setup();
    const nael = db.put('entities', createEntity({ kind: 'character', name: 'Naelmira' }));
    const tale = { ownerId: fishers.id };
    const fit = (standing: 'any' | 'good' | 'bad') => entryFit(data(), tale, { standing });
    expect(fit('any')).toEqual({ fits: true, note: '' });
    // Solange kein Ruf festgelegt ist, passt nur, was immer passt.
    expect(fit('good').fits).toBe(false);
    expect(fit('good').note).toContain('noch nicht festgelegt');
    expect(fit('bad').fits).toBe(false);

    setAttitude(db, fishers.id, PARTY_ID, 2);
    expect(fit('good').fits).toBe(true);
    expect(fit('good').note).toBe('Haltung zur Gruppe: wohlgesonnen.');
    expect(fit('bad').fits).toBe(false);
    // Ein Gefährte mit schlechtem Ruf genügt: Er wird erkannt.
    setAttitude(db, fishers.id, nael.id, -3);
    expect(fit('bad').fits).toBe(true);
    expect(fit('bad').note).toContain('Naelmira');
    expect(untilText(3 * 1440)).toBe('in 3 Tagen');
    expect(untilText(1440 + 120)).toBe('in 1 Tag 2 Std.');
    expect(untilText(90)).toBe('in 1 Std. 30 Min.');
    // Ohne Antreiber gibt es keinen Ruf, an dem ein Einstieg hängen könnte.
    expect(entryFit(data(), { ownerId: null }, { standing: 'good' }).fits).toBe(false);
  });
});

describe('Am Spieltisch', () => {
  it('nennt, was den Ort berührt und was hier bereitliegt', async () => {
    const { db, data, market, harbour, far, mira, fishers, story, thread, hint } = await setup();
    const tale = story('Die Glocke am Markt', {
      ownerId: fishers.id,
      refs: [market.id],
      entries: [
        { id: newId(), text: 'Der Küster bittet um Hilfe', placeId: market.id, standing: 'good' },
        { id: newId(), text: 'Ein Kind hat etwas gesehen', placeId: market.id, standing: 'any' },
        { id: newId(), text: 'Am Kai wird getuschelt', placeId: harbour.id, standing: 'any' },
      ],
    });
    thread('Wer läutet nachts?', {
      storyId: tale.id,
      hints: [
        hint('Wachs an der Glockenschnur', market.id),
        hint('Schon gefunden', market.id, true),
        hint('Der Brief im Kontor', harbour.id),
      ],
    });
    story('Fern: Der Graf rüstet', { refs: [far.id] });
    thread('Vorbei', { refs: [market.id], state: 'solved' });

    const here = storiesHere(data());
    expect(here.map((entry) => entry.card.title)).toEqual(['Die Glocke am Markt']);
    // Was immer passt, steht vor dem, was am Ruf hängt und gerade nicht passt.
    expect(here[0]!.entries.map((entry) => [entry.entry.text, entry.fits])).toEqual([
      ['Ein Kind hat etwas gesehen', true],
      ['Der Küster bittet um Hilfe', false],
    ]);
    expect(here[0]!.hints.map((entry) => entry.hint.text)).toEqual(['Wachs an der Glockenschnur']);

    // Zieht jemand, der etwas weiß, an den Ort der Gruppe, liegt auch sein Hinweis hier.
    const who = data().entities[mira.id]!;
    if (who.kind === 'person')
      db.put('entities', { ...who, person: { ...who.person, placeId: market.id } });
    const question = Object.values(data().threads).find((entry) => entry.storyId === tale.id)!;
    db.patch('threads', question.id, {
      hints: question.hints.map((entry) =>
        entry.text === 'Der Brief im Kontor' ? { ...entry, sourceId: mira.id } : entry,
      ),
    });
    expect(storiesHere(data())[0]!.hints.map((entry) => entry.hint.text)).toEqual([
      'Wachs an der Glockenschnur',
      'Der Brief im Kontor',
    ]);
    // Ohne Ort der Gruppe gibt es kein „hier“.
    db.setState({ placeId: null });
    expect(storiesHere(data())).toEqual([]);
  });
});
