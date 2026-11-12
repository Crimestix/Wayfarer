import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  createClock,
  createEntity,
  createEvent,
  newId,
  type Entity,
  type Place,
} from '../../domain/schema';
import {
  boardCards,
  nearness,
  storyNodes,
  threadWarning,
  touchReason,
  touches,
} from '../../domain/story';
import { saveWay } from '../wege/actions';
import {
  removeStory,
  removeThread,
  saveStory,
  saveThread,
  setHintFound,
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
      entries: [{ id: newId(), text: 'Ein Fischer bittet um Hilfe', placeId: market.id }],
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
});

describe('Hinweise', () => {
  it('warnt, wenn ein Faden an einem einzigen Hinweis hängt oder an keinem', async () => {
    const { db, data, thread, hint } = await setup();
    const one = thread('Wer bezahlt die Schläger?', { hints: [hint('Münzen aus Hohenfurt')] });
    expect(threadWarning(one)).toContain('einzigen Hinweis');
    expect(threadWarning(thread('Was liegt im Wrack?'))).toContain('nicht finden');
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
