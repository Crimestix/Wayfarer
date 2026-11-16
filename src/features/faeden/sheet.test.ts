import { describe, expect, it } from 'vitest';
import { logEntry } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { hangingAt, namesakes, netsOfStory, twinNote } from '../../domain/net';
import {
  PARTY_ID,
  createEntity,
  createEvent,
  createHandout,
  newId,
  type Entity,
  type Place,
} from '../../domain/schema';
import { isStub } from '../../domain/stub';
import { boardCards, boardLayout, storyNodes, storyTexts } from '../../domain/story';
import {
  castOf,
  castTies,
  hintsNote,
  lonelyLine,
  parentChoices,
  storiesOf,
  storyAncestors,
  storyHangs,
  storyParts,
  storyPlaces,
  threadFits,
} from '../../domain/storySheet';
import { backLink, cameFrom, stepTrail } from '../../shell/trail';
import { addRoutes, addStoryNet, addStoryRoute, setNetStory } from '../wegenetz/actions';
import { relate } from '../welt/actions';
import { createArticle } from '../wiki/actions';
import {
  attachToStory,
  detachFromStory,
  listInStory,
  moveThread,
  newStory,
  newSubStory,
  patchStory,
  removeStory,
  saveThread,
  setSceneDone,
  setStoryRole,
  setStorySteps,
  threadToEntry,
  threadToHint,
  type ThreadInput,
} from './actions';

/**
 * Erfundene Welt: Hohenfurt mit Markt und Salzgrotte, abseits Burg Graufels. Mira und Odo
 * Tannhaus, Lando Furtner, die Salzsieder. Die Gruppe steht am Markt.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string, parentId: string | null = null) =>
    db.put('entities', createEntity({ kind: 'place', name, place: { parentId } })) as Place;
  const town = place('Hohenfurt');
  const market = place('Markt', town.id);
  const grotto = place('Salzgrotte', town.id);
  const castle = place('Burg Graufels');
  const person = (name: string, placeId: string | null = null): Entity =>
    db.put('entities', createEntity({ kind: 'person', name, person: { placeId } }));
  const mira = person('Mira Tannhaus', market.id);
  const odo = person('Odo Tannhaus');
  const lando = person('Lando Furtner');
  const guild = db.put('entities', createEntity({ kind: 'faction', name: 'Die Salzsieder' }));
  const brann = db.put('entities', createEntity({ kind: 'character', name: 'Brann Eichwald' }));
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
  const hint = (text: string, placeId: string | null = null, sourceId: string | null = null) => ({
    id: newId(),
    text,
    placeId,
    sourceId,
    found: false,
  });
  return { db, data, town, market, grotto, castle, mira, odo, lando, guild, brann, thread, hint };
}

describe('Beteiligte einer Geschichte', () => {
  it('der Antreiber zuerst, dann die Liste, dann wer über einen Hinweis dazugehört – mit Rolle', async () => {
    const { db, data, market, grotto, mira, odo, lando, guild, brann, thread, hint } =
      await setup();
    const pact = newStory(db, { title: 'Die Pacht der Grotte', ownerId: guild.id });
    patchStory(db, pact.id, { refs: [mira.id, grotto.id] });
    thread('Wer hat unterschrieben?', {
      storyId: pact.id,
      hints: [hint('Ein Siegel im Wachs', market.id, lando.id)],
    });
    attachToStory(db, pact.id, brann.id);
    setStoryRole(db, pact.id, mira.id, { role: '  Zeugin ', wants: ' Ihre Ruhe. ' });
    setStoryRole(db, pact.id, guild.id, { wants: 'Die Grotte für sich.' });
    const story = () => data().stories[pact.id]!;
    expect(story().roles[mira.id]).toEqual({ role: 'Zeugin', wants: 'Ihre Ruhe.' });
    const rows = () =>
      castOf(data(), story()).map((row) => [row.entity.name, row.role, row.driver, row.listed]);
    // Orte aus Hinweisen stehen unter „Schauplätze“, Gefährten unter „Wen es persönlich betrifft“.
    expect(rows()).toEqual([
      ['Die Salzsieder', '', true, false],
      ['Mira Tannhaus', 'Zeugin', false, true],
      ['Salzgrotte', '', false, true],
      ['Lando Furtner', '', false, false],
    ]);
    // Was die Beteiligten wollen, zählt zum Text des Blatts.
    expect(storyTexts(data(), story())).toContain('Ihre Ruhe.');
    // Eine leere Rolle fällt weg.
    setStoryRole(db, pact.id, guild.id, { wants: ' ' });
    expect(story().roles[guild.id]).toBeUndefined();

    // Herausnehmen nimmt die Rolle mit – und „Rückgängig“ bringt beides an seine Stelle zurück.
    const undo = detachFromStory(db, pact.id, mira.id);
    expect(story().refs).toEqual([grotto.id]);
    expect(story().roles[mira.id]).toBeUndefined();
    undo();
    expect(story().refs).toEqual([mira.id, grotto.id]);
    expect(story().roles[mira.id]).toEqual({ role: 'Zeugin', wants: 'Ihre Ruhe.' });
    expect(castOf(data(), story()).some((row) => row.entity.id === odo.id)).toBe(false);
    // Auch die Rolle dessen, der nicht in der Liste steht (der Antreiber), kommt zurück – außer
    // es steht inzwischen eine neue da.
    setStoryRole(db, pact.id, guild.id, { wants: 'Die Grotte für sich.' });
    const back = detachFromStory(db, pact.id, guild.id);
    expect(story().roles[guild.id]).toBeUndefined();
    back();
    expect(story().roles[guild.id]).toEqual({ role: '', wants: 'Die Grotte für sich.' });
    const again = detachFromStory(db, pact.id, guild.id);
    setStoryRole(db, pact.id, guild.id, { role: 'Auftraggeber' });
    again();
    expect(story().roles[guild.id]).toEqual({ role: 'Auftraggeber', wants: '' });
    expect(story().refs).toEqual([mira.id, grotto.id]);
    // Wer nur über einen Hinweis dazugehört, lässt sich ausdrücklich in die Liste nehmen.
    listInStory(db, pact.id, lando.id);
    listInStory(db, pact.id, lando.id);
    listInStory(db, pact.id, guild.id);
    expect(story().refs).toEqual([mira.id, grotto.id, lando.id]);
    expect(castOf(data(), story()).find((row) => row.entity.id === lando.id)!.listed).toBe(true);
  });

  it('Verbindungen: die Beziehungen der Welt zwischen den Beteiligten – und wer an niemandem hängt', async () => {
    const { db, data, grotto, mira, odo, lando, guild } = await setup();
    const pact = newStory(db, { title: 'Die Pacht der Grotte', ownerId: guild.id });
    patchStory(db, pact.id, { refs: [mira.id, lando.id, grotto.id] });
    const story = () => data().stories[pact.id]!;
    const lonely = () =>
      castOf(data(), story())
        .filter((row) => row.lonely)
        .map((row) => row.entity.name);
    // Ein Ort hängt nie „an niemandem“ – gefragt sind Personen, Fraktionen und Familien.
    expect(lonely()).toEqual(['Die Salzsieder', 'Mira Tannhaus', 'Lando Furtner']);
    relate(db, { from: lando.id, to: guild.id, type: 'serves' });
    // Eine Beziehung zu jemandem außerhalb der Geschichte zählt hier nicht.
    relate(db, { from: mira.id, to: odo.id, type: 'family' });
    relate(db, { from: mira.id, to: PARTY_ID, type: 'knows' });
    expect(castTies(data(), story()).map((tie) => [tie.from.name, tie.label, tie.to.name])).toEqual(
      [['Lando Furtner', 'dient', 'Die Salzsieder']],
    );
    expect(lonely()).toEqual(['Mira Tannhaus']);
    expect(lonelyLine(castOf(data(), story()))).toBe('Mira Tannhaus hängt an niemandem.');
    // Allein ist niemand einsam.
    const solo = newStory(db, { title: 'Miras Schweigen', ownerId: mira.id });
    expect(castOf(data(), solo).map((row) => row.lonely)).toEqual([false]);
    expect(lonelyLine(castOf(data(), solo))).toBe('');
  });

  it('sagt in Worten, wer an niemandem hängt und wie eine Frage mit ihren Hinweisen dasteht', async () => {
    const { db, data, mira, lando, guild } = await setup();
    const pact = newStory(db, { title: 'Die Pacht der Grotte', ownerId: guild.id });
    patchStory(db, pact.id, { refs: [mira.id, lando.id] });
    expect(lonelyLine(castOf(data(), data().stories[pact.id]!))).toBe(
      'Die Salzsieder, Mira Tannhaus und Lando Furtner hängen an niemandem.',
    );
    // Nie ein Bruch („1 von 3“): Bis drei ist es dünn, ab drei reicht es.
    expect([0, 1, 2].map((count) => hintsNote(count).thin)).toEqual([true, true, true]);
    expect(hintsNote(3)).toEqual({ text: 'Drei Hinweise – das reicht.', thin: false });
    expect(hintsNote(5)).toEqual({ text: 'Das reicht.', thin: false });
    for (const count of [0, 1, 2, 3, 5]) expect(hintsNote(count).text).not.toMatch(/\d/);
  });

  it('Schauplätze: die Orte der Beteiligten, Einstiege, Szenen und Hinweise – jeder einmal', async () => {
    const { db, data, market, grotto, castle, guild, thread, hint } = await setup();
    const pact = newStory(db, { title: 'Die Pacht der Grotte', ownerId: guild.id });
    patchStory(db, pact.id, {
      refs: [grotto.id],
      entries: [{ id: newId(), text: 'Ein Aushang', placeId: market.id, standing: 'any' }],
      scenes: [
        { id: newId(), text: 'Im Salz', encounterId: null, odds: 'maybe', placeId: grotto.id },
        { id: newId(), text: 'Vor dem Tor', encounterId: null, odds: 'maybe', placeId: castle.id },
      ],
    });
    thread('Wer hat unterschrieben?', {
      storyId: pact.id,
      hints: [hint('Ein Siegel im Wachs', market.id)],
    });
    const story = data().stories[pact.id]!;
    expect(storyPlaces(data(), story).map((row) => [row.place.name, row.via])).toEqual([
      ['Salzgrotte', ['cast', 'scene']],
      ['Markt', ['entry', 'hint']],
      ['Burg Graufels', ['scene']],
    ]);
    // Die Orte von Szenen zählen zu dem, woran die Geschichte hängt – auch am Punkt eines Netzes.
    expect(storyNodes(data(), story)).toContain(castle.id);
    expect(hangingAt(data(), castle.id).stories.map((entry) => entry.id)).toEqual([pact.id]);
  });

  it('hakt Szenen ab', async () => {
    const { db, data } = await setup();
    const pact = newStory(db, { title: 'Die Pacht der Grotte' });
    const sceneId = newId();
    patchStory(db, pact.id, {
      scenes: [{ id: sceneId, text: 'Im Salz', encounterId: null, odds: 'maybe', placeId: null }],
    });
    expect(data().stories[pact.id]!.scenes[0]!.done).toBe(false);
    setSceneDone(db, pact.id, sceneId, true);
    expect(data().stories[pact.id]!.scenes[0]!.done).toBe(true);
    setSceneDone(db, pact.id, 'gibtsnicht', true);
    setSceneDone(db, pact.id, sceneId, false);
    expect(data().stories[pact.id]!.scenes[0]!.done).toBe(false);
  });
});

describe('Lose Fäden und Fragen', () => {
  it('schlägt lose Fäden vor, die dieselben Namen nennen – die mit den meisten zuerst', async () => {
    const { db, data, grotto, mira, odo, guild, thread } = await setup();
    const pact = newStory(db, { title: 'Die Pacht der Grotte', ownerId: guild.id });
    patchStory(db, pact.id, { refs: [mira.id, grotto.id] });
    const light = thread('Das Licht in der Salzgrotte', { truth: 'Mira Tannhaus stellt es auf.' });
    const debt = thread('Odos Schulden', { refs: [odo.id] });
    const seal = thread('Das falsche Siegel', { refs: [guild.id] });
    const solved = thread('Wer hat Mira Tannhaus gewarnt?', { state: 'solved' });
    const own = thread('Wer hat unterschrieben?', { storyId: pact.id, refs: [mira.id] });
    const fits = threadFits(data(), data().stories[pact.id]!);
    expect(fits.map((fit) => [fit.thread.title, fit.reason])).toEqual([
      ['Das Licht in der Salzgrotte', 'nennt auch Mira Tannhaus und Salzgrotte'],
      ['Das falsche Siegel', 'nennt auch Die Salzsieder'],
    ]);
    expect(fits.some((fit) => [debt.id, solved.id, own.id].includes(fit.thread.id))).toBe(false);
    expect(fits[0]!.thread.id).toBe(light.id);
    expect(fits[1]!.thread.id).toBe(seal.id);
    // Eine Geschichte, an der noch nichts hängt, hat nichts zum Vergleichen.
    expect(threadFits(data(), newStory(db))).toEqual([]);
  });

  it('hängt einen Faden an eine Geschichte und löst ihn wieder – mit Rückgängig', async () => {
    const { db, data, thread } = await setup();
    const pact = newStory(db, { title: 'Die Pacht der Grotte' });
    const loose = thread('Das falsche Siegel');
    expect(moveThread(db, loose.id, null)).toBeNull();
    expect(moveThread(db, loose.id, 'gibtsnicht')).toBeNull();
    const undo = moveThread(db, loose.id, pact.id)!;
    expect(data().threads[loose.id]!.storyId).toBe(pact.id);
    undo();
    expect(data().threads[loose.id]!.storyId).toBeNull();
    moveThread(db, loose.id, pact.id);
    const back = moveThread(db, loose.id, null)!;
    expect(data().threads[loose.id]!.storyId).toBeNull();
    // Gibt es die Geschichte nicht mehr, bleibt der Faden lose.
    removeStory(db, pact.id);
    back();
    expect(data().threads[loose.id]!.storyId).toBeNull();
  });

  it('macht aus einem losen Faden einen Hinweis zu einer Frage', async () => {
    const { db, data, grotto, lando, thread } = await setup();
    const pact = newStory(db, { title: 'Die Pacht der Grotte' });
    const question = thread('Wer hat unterschrieben?', { storyId: pact.id });
    const loose = thread('Das falsche Siegel', { refs: [lando.id, grotto.id], known: true });
    const event = db.put(
      'events',
      createEvent({ title: 'Der Siegelschneider reist ab', at: 100, threadId: loose.id }),
    );
    const undo = threadToHint(db, loose.id, question.id)!;
    expect(data().threads[loose.id]).toBeUndefined();
    const asked = () => data().threads[question.id]!;
    expect(asked().hints.map((hint) => [hint.text, hint.placeId, hint.sourceId])).toEqual([
      ['Das falsche Siegel', grotto.id, lando.id],
    ]);
    // Die Gruppe kannte den Faden: Sie hat den Hinweis, kennt die Frage und ist dran.
    expect(asked()).toMatchObject({ known: true, state: 'active' });
    expect(asked().hints[0]!.found).toBe(true);
    expect(data().events[event.id]!.threadId).toBe(question.id);
    undo();
    expect(data().threads[loose.id]).toMatchObject({ title: 'Das falsche Siegel', storyId: null });
    expect(asked()).toMatchObject({ hints: [], known: false, state: 'open' });
    expect(data().events[event.id]!.threadId).toBe(loose.id);
    expect(threadToHint(db, loose.id, loose.id)).toBeNull();
  });

  it('macht aus einem losen Faden einen Einstieg', async () => {
    const { db, data, grotto, thread, hint } = await setup();
    const pact = newStory(db, { title: 'Die Pacht der Grotte' });
    const loose = thread('Ein Aushang sucht Träger', { hints: [hint('Am Brett', grotto.id)] });
    const undo = threadToEntry(db, loose.id, pact.id)!;
    expect(data().threads[loose.id]).toBeUndefined();
    expect(data().stories[pact.id]!.entries).toMatchObject([
      { text: 'Ein Aushang sucht Träger', placeId: grotto.id, standing: 'any' },
    ]);
    undo();
    expect(data().stories[pact.id]!.entries).toEqual([]);
    expect(data().threads[loose.id]!.hints).toHaveLength(1);
  });
});

describe('Große Geschichten und ihre Teile', () => {
  it('eine Teilgeschichte übernimmt den Antreiber; Kreise entstehen nicht', async () => {
    const { db, data, guild } = await setup();
    const big = newStory(db, { title: 'Der Griff nach dem Salz', ownerId: guild.id });
    const part = newSubStory(db, big.id)!;
    expect(part).toMatchObject({ parentId: big.id, ownerId: guild.id });
    setStorySteps(db, part.id, [{ id: newId(), text: 'Die Pacht wird gekauft', days: 2 }]);
    const small = newSubStory(db, part.id)!;
    expect(newSubStory(db, 'gibtsnicht')).toBeNull();
    expect(
      storyParts(data(), big.id).map((row) => [row.story.id, row.stage, row.pace, row.next]),
    ).toEqual([[part.id, 'seed', 'paused', 'Die Pacht wird gekauft']]);
    expect(storyAncestors(data(), data().stories[small.id]!).map((story) => story.id)).toEqual([
      part.id,
      big.id,
    ]);
    // Die große Geschichte kann nicht Teil ihrer eigenen Teile werden – und nichts Teil seiner selbst.
    expect(parentChoices(data(), data().stories[big.id]!)).toEqual([]);
    patchStory(db, big.id, { parentId: small.id });
    expect(data().stories[big.id]!.parentId).toBeNull();
    patchStory(db, part.id, { parentId: part.id });
    expect(data().stories[part.id]!.parentId).toBeNull();
    patchStory(db, part.id, { parentId: big.id });
    // Auf dem Brett liegt eine Teilgeschichte unter ihrer großen – und deren Teil darunter.
    const eel = newStory(db, { title: 'Aalfang' });
    newStory(db, { title: 'Die Furt bricht' });
    const spots = boardLayout(boardCards(data())).cards;
    const at = (id: string) => spots[`story:${id}`]!;
    expect(at(part.id).x).toBe(at(big.id).x);
    expect(at(part.id).y).toBeGreaterThan(at(big.id).y);
    expect(at(small.id).x).toBe(at(part.id).x);
    expect(at(small.id).y).toBeGreaterThan(at(part.id).y);
    // Was für sich steht, liegt in der Reihe neben der großen – nicht zwischen ihren Teilen.
    expect(at(eel.id).y).toBe(at(big.id).y);
    expect(at(eel.id).y).toBeLessThan(at(part.id).y);
    // Wird die mittlere gelöscht, rückt ihr Teil eine Stufe hinauf.
    removeStory(db, part.id);
    expect(data().stories[small.id]!.parentId).toBe(big.id);
  });
});

describe('Kommt vor in', () => {
  it('nennt die Geschichten eines Eintrags mit seiner Rolle – die im Spiel zuerst', async () => {
    const { db, data, market, mira, guild } = await setup();
    const pact = newStory(db, { title: 'Die Pacht der Grotte', ownerId: guild.id });
    patchStory(db, pact.id, { refs: [mira.id] });
    setStoryRole(db, pact.id, mira.id, { role: 'Zeugin' });
    const fair = newStory(db, { title: 'Der Jahrmarkt', inPlay: true });
    patchStory(db, fair.id, {
      scenes: [{ id: newId(), text: 'Buden', encounterId: null, odds: 'sure', placeId: market.id }],
      refs: [mira.id],
    });
    const old = newStory(db, { title: 'Alte Schuld', closed: true, ownerId: mira.id });
    expect(storiesOf(data(), mira.id).map((row) => [row.story.id, row.role, row.driver])).toEqual([
      [fair.id, '', false],
      [pact.id, 'Zeugin', false],
      [old.id, 'Antreiber', true],
    ]);
    expect(storiesOf(data(), market.id).map((row) => row.story.id)).toEqual([fair.id]);
    expect(storiesOf(data(), guild.id).map((row) => row.role)).toEqual(['Antreiber']);
  });

  it('sammelt, was sonst an einer Geschichte hängt: Handouts, Abmachungen, Notizen', async () => {
    const { db, data, mira } = await setup();
    const pact = newStory(db, { title: 'Die Pacht der Grotte' });
    const letter = db.put('handouts', createHandout({ title: 'Der Pachtbrief', storyId: pact.id }));
    db.put('handouts', createHandout({ title: 'Ein anderer Brief' }));
    const note = logEntry(db, { text: 'Mira schweigt.', refs: [mira.id] });
    db.patch('chronicle', note.id, { storyId: pact.id });
    const promise = logEntry(db, { kind: 'promise', text: 'Die Gruppe schweigt auch.' });
    db.patch('chronicle', promise.id, { storyId: pact.id });
    const question = saveThread(db, {
      title: 'Wer hat unterschrieben?',
      truth: '',
      state: 'open',
      storyId: pact.id,
      refs: [],
      known: false,
      hints: [],
    });
    const due = db.put(
      'events',
      createEvent({ title: 'Der Notar reist ab', at: 500, threadId: question.id }),
    );
    db.put('events', createEvent({ title: 'Markttag', at: 400 }));
    const hangs = storyHangs(data(), data().stories[pact.id]!);
    expect(hangs.events.map((event) => event.id)).toEqual([due.id]);
    expect(hangs.handouts.map((handout) => handout.id)).toEqual([letter.id]);
    expect(hangs.notes.map((entry) => entry.id)).toEqual([note.id]);
    expect(hangs.promises.map((entry) => entry.id)).toEqual([promise.id]);
  });
});

describe('Wegenetze einer Geschichte', () => {
  it('legt ein Netz mit den Orten der Geschichte an, hängt Netze an und löst sie', async () => {
    const { db, data, market, grotto, guild } = await setup();
    const pact = newStory(db, { title: 'Die Pacht der Grotte', ownerId: guild.id });
    patchStory(db, pact.id, {
      refs: [grotto.id],
      entries: [{ id: newId(), text: 'Ein Aushang', placeId: market.id, standing: 'any' }],
    });
    const { net, undo } = addStoryNet(db, pact.id)!;
    expect(net).toMatchObject({ name: 'Die Pacht der Grotte', storyId: pact.id });
    expect(net.points.map((point) => point.placeId)).toEqual([grotto.id, market.id]);
    // Die Punkte liegen nebeneinander, nicht aufeinander.
    expect(net.points[0]!.x).not.toBe(net.points[1]!.x);
    expect(netsOfStory(data(), pact.id).map((entry) => entry.id)).toEqual([net.id]);
    const loosen = setNetStory(db, net.id, null)!;
    expect(netsOfStory(data(), pact.id)).toEqual([]);
    loosen();
    expect(netsOfStory(data(), pact.id)).toHaveLength(1);
    expect(setNetStory(db, net.id, pact.id)).toBeNull();
    expect(setNetStory(db, net.id, 'gibtsnicht')).toBeNull();
    // Mit der Geschichte geht der Bezug, nicht das Netz.
    removeStory(db, pact.id);
    expect(data().nets[net.id]!.storyId).toBeNull();
    undo();
    expect(data().nets[net.id]).toBeUndefined();
    expect(addStoryNet(db, 'gibtsnicht')).toBeNull();
  });

  it('eine geschriebene Strecke: neue Orte sind Platzhalter dieser Geschichte', async () => {
    const { db, data, grotto } = await setup();
    const pact = newStory(db, { title: 'Die Pacht der Grotte' });
    patchStory(db, pact.id, { refs: [grotto.id] });
    // Ohne Netz entsteht eines – mit den Orten der Geschichte und der Strecke.
    const added = addStoryRoute(db, pact.id, 'Salzgrotte -> Alter Stollen (4 Std.) -> Tiefer See')!;
    expect(added).toMatchObject({ places: 2, ways: 2 });
    expect(added.net.storyId).toBe(pact.id);
    const named = (name: string) =>
      Object.values(data().entities).find((entity) => entity.name === name);
    const tunnel = named('Alter Stollen')!;
    expect(tunnel).toMatchObject({ kind: 'place', stub: true, fromStoryId: pact.id });
    expect(isStub(data(), tunnel)).toBe(true);
    expect(data().nets[added.net.id]!.points.map((point) => point.placeId)).toEqual([
      grotto.id,
      tunnel.id,
      named('Tiefer See')!.id,
    ]);
    // Wer eine Strecke auf das Blatt schreibt, meint ihre Orte: Sie gehören zur Geschichte.
    const lake = named('Tiefer See')!;
    expect(data().stories[pact.id]!.refs).toEqual([grotto.id, tunnel.id, lake.id]);
    expect(storyPlaces(data(), data().stories[pact.id]!).every((row) => row.own)).toBe(true);
    // Die zweite Strecke geht ins selbe Netz.
    const more = addStoryRoute(db, pact.id, 'Alter Stollen -> Blinder Schacht')!;
    expect(more.net.id).toBe(added.net.id);
    expect(data().stories[pact.id]!.refs).toHaveLength(4);
    more.undo();
    expect(named('Blinder Schacht')).toBeUndefined();
    expect(data().stories[pact.id]!.refs).toEqual([grotto.id, tunnel.id, lake.id]);
    expect(data().nets[added.net.id]).toBeDefined();
    // „Rückgängig“ der ersten nimmt auch das dabei entstandene Netz zurück.
    added.undo();
    expect(named('Alter Stollen')).toBeUndefined();
    expect(data().stories[pact.id]!.refs).toEqual([grotto.id]);
    expect(data().nets[added.net.id]).toBeUndefined();
    expect(addStoryRoute(db, pact.id, '  ')).toBeNull();
    // In einem Netz ohne Geschichte entstehen gewöhnliche Orte.
    const { net } = addStoryNet(db, pact.id)!;
    setNetStory(db, net.id, null);
    addRoutes(db, net.id, 'Salzgrotte -> Krähenfels');
    expect(named('Krähenfels')).toMatchObject({ stub: false, fromStoryId: null });
    // Ein angehängtes Netz bringt seine Punkte nur als Orte unterwegs mit – sie hängen nicht an
    // der Geschichte und kommen nicht von selbst auf ein weiteres Netz.
    setNetStory(db, net.id, pact.id);
    const story = data().stories[pact.id]!;
    const rows = storyPlaces(data(), story);
    expect(rows.map((row) => [row.place.name, row.own, row.via])).toEqual([
      ['Salzgrotte', true, ['cast', 'net']],
      ['Krähenfels', false, ['net']],
    ]);
    expect(storyNodes(data(), story)).toEqual([grotto.id]);
    expect(addStoryNet(db, pact.id)!.net.points.map((point) => point.placeId)).toEqual([grotto.id]);
  });

  it('eine Strecke ohne Namen legt nichts an; Namen gelten genau, nie ähnlich', async () => {
    const { db, data, castle, lando } = await setup();
    const pact = newStory(db, { title: 'Die Pacht der Grotte' });
    const places = () =>
      Object.values(data().entities)
        .filter((entity) => entity.kind === 'place')
        .map((entity) => entity.name)
        .sort();
    const before = places();
    // Nur Pfeile: kein leeres Netz, keine Meldung.
    expect(addStoryRoute(db, pact.id, ' -> ')).toBeNull();
    expect(netsOfStory(data(), pact.id)).toEqual([]);
    // Groß und klein und doppelte Leerzeichen zählen nicht – ein fehlender Buchstabe schon.
    const added = addStoryRoute(db, pact.id, 'burg   graufels -> Burg Graufel')!;
    expect(added.placeIds[0]).toBe(castle.id);
    expect(added.places).toBe(1);
    expect(places()).toEqual([...before, 'Burg Graufel'].sort());
    expect(added.twins).toEqual([]);
    expect(twinNote(added.twins)).toBe('');
    // Heißt ein Eintrag anderer Art schon so, entsteht der Ort trotzdem – mit einem Hinweis.
    const more = addStoryRoute(db, pact.id, 'Burg Graufels -> Lando Furtner')!;
    expect(more.twins.map((entity) => entity.id)).toEqual([lando.id]);
    expect(twinNote(more.twins)).toBe(
      '„Lando Furtner“ gibt es schon als Person – der neue Ort heißt genauso.',
    );
    expect(namesakes(data(), 'lando  furtner')).toHaveLength(2);
    more.undo();
    expect(namesakes(data(), 'Lando Furtner').map((entity) => entity.id)).toEqual([lando.id]);
  });
});

describe('Der Weg zurück', () => {
  it('merkt sich, woher man kam – „zurück“ ist kein neuer Schritt', () => {
    let trail: string[] = [];
    for (const step of ['/abend', '/geschichte/a', '/geschichte/a', '/geschichte/b'])
      trail = stepTrail(trail, step);
    expect(trail).toEqual(['/abend', '/geschichte/a', '/geschichte/b']);
    expect(cameFrom(trail, '/geschichte/b')).toBe('/geschichte/a');
    trail = stepTrail(trail, '/geschichte/a');
    expect(trail).toEqual(['/abend', '/geschichte/a']);
    expect(cameFrom(trail, '/geschichte/a')).toBe('/abend');
    expect(cameFrom(['/geschichte/a'], '/geschichte/a')).toBeNull();
    expect(cameFrom([], '/geschichte/a')).toBeNull();
  });

  it('nennt die Seite beim Namen – sonst führt der Weg zum Fadenbrett', async () => {
    const { db, data, mira } = await setup();
    const pact = newStory(db, { title: 'Die Pacht der Grotte' });
    const brett = { href: '/faeden', label: 'Fadenbrett' };
    expect(backLink(data(), null)).toEqual(brett);
    expect(backLink(data(), '/abend')).toEqual({ href: '/abend', label: 'Abend vorbereiten' });
    expect(backLink(data(), '/')).toEqual({ href: '/', label: 'Spieltisch' });
    expect(backLink(data(), `/welt/${mira.id}`)).toEqual({
      href: `/welt/${mira.id}`,
      label: 'Mira Tannhaus',
    });
    expect(backLink(data(), `/geschichte/${pact.id}`).label).toBe('Die Pacht der Grotte');
    const article = createArticle(db, { title: 'Das Salzrecht von Hohenfurt' })!;
    expect(backLink(data(), `/wiki/${article.id}`).label).toBe('Das Salzrecht von Hohenfurt');
    // Das Wegenetz einer Geschichte heißt wie sie – der Verweis sagt, dass es das Netz ist.
    const { net } = addStoryNet(db, pact.id)!;
    expect(backLink(data(), `/wegenetze/${net.id}`)).toEqual({
      href: `/wegenetze/${net.id}`,
      label: 'Wegenetz „Die Pacht der Grotte“',
    });
    expect(backLink(data(), '/wegenetze')).toEqual(brett);
    expect(backLink(data(), '/welt/gibtsnicht')).toEqual(brett);
    expect(backLink(data(), '/einstellungen')).toEqual(brett);
  });
});
