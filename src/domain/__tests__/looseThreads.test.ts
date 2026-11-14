import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { emptyCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  filterLoose,
  filterStoryChoices,
  fitsLine,
  looseThreads,
  storyChoices,
  storyFits,
  threadByTitle,
  threadKey,
  threadLike,
  threadOrigin,
  threadTwins,
  threadsInOrder,
} from '../looseThreads';
import {
  ArticleSchema,
  createEntity,
  createSession,
  createStory,
  createThread,
  newId,
  type Place,
  type ReadProposal,
  type Thread,
} from '../schema';
import { boardCards, boardLayout } from '../story';
import { namesLine } from '../storySheet';
import { MINUTES_PER_DAY } from '../time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../time/elaris';

const NOW = ELARIS_START + 30 * MINUTES_PER_DAY;

/**
 * Erfundene Welt: Hohenfurt mit Markt und Salzgrotte, abseits Burg Graufels. Mira und Odo
 * Tannhaus, Lando Furtner, die Salzsieder. Die Gruppe steht am Markt.
 */
async function setup() {
  const db = await CampaignDb.create(
    new MemoryStore(),
    emptyCampaign('Testwelt', ELARIS_CALENDAR, NOW),
  );
  const place = (name: string, parentId: string | null = null) =>
    db.put('entities', createEntity({ kind: 'place', name, place: { parentId } })) as Place;
  const town = place('Hohenfurt');
  const market = place('Markt', town.id);
  const grotto = place('Salzgrotte', town.id);
  const castle = place('Burg Graufels');
  const person = (name: string, placeId: string | null = null) =>
    db.put('entities', createEntity({ kind: 'person', name, person: { placeId } }));
  const mira = person('Mira Tannhaus', market.id);
  const odo = person('Odo Tannhaus');
  const lando = person('Lando Furtner', castle.id);
  const guild = db.put('entities', createEntity({ kind: 'faction', name: 'Die Salzsieder' }));
  db.setState({ placeId: market.id });
  const data = () => db.getSnapshot();
  const thread = (title: string, more: Partial<Thread> = {}) =>
    db.put('threads', createThread({ title, ...more }));
  const story = (title: string, refs: string[] = [], more: Partial<{ closed: boolean }> = {}) =>
    db.put('stories', createStory({ title, refs, ...more }));
  return { db, data, town, market, grotto, castle, mira, odo, lando, guild, thread, story };
}

describe('Derselbe Satz', () => {
  it('vereinheitlicht Groß und Klein, Satzzeichen, Artikel und Füllwörter', () => {
    expect(threadKey('Der Schlüssel der Grotte')).toBe('schlüssel grotte');
    expect(threadKey('  – der schlüssel der Grotte?! ')).toBe('schlüssel grotte');
    expect(threadKey('Wer bezahlt eigentlich noch die Krähenbande?')).toBe(
      'wer bezahlt krähenbande',
    );
    expect(threadKey('Straße')).toBe('strasse');
    // Ein Satz nur aus Füllwörtern bleibt, wie er ist.
    expect(threadKey('Noch immer?')).toBe('noch immer');
    expect(threadKey(' … ')).toBe('');
  });

  it('findet den Faden, den es mit einem Satz schon gibt – den lebendigen und den einer Geschichte zuerst', async () => {
    const { data, thread, story } = await setup();
    expect(threadByTitle(data(), 'Der Schlüssel der Grotte')).toBeNull();
    const solved = thread('Der Schlüssel der Grotte', { state: 'solved' });
    expect(threadByTitle(data(), 'der schlüssel der grotte?')?.id).toBe(solved.id);
    const loose = thread('Schlüssel der Grotte');
    expect(threadByTitle(data(), 'Der Schlüssel der Grotte')?.id).toBe(loose.id);
    const pact = story('Die Pacht der Grotte');
    const question = thread('Der Schlüssel der Grotte!', { storyId: pact.id });
    expect(threadByTitle(data(), 'Der Schlüssel der Grotte')?.id).toBe(question.id);
    expect(threadByTitle(data(), 'Der Schlüssel der Burg')).toBeNull();
    expect(threadByTitle(data(), '?')).toBeNull();
  });
});

describe('Fäden, die es wohl doppelt gibt', () => {
  it('meldet gleiche und fast gleiche Sätze – vorsichtig', async () => {
    const { db, data, thread, story, mira } = await setup();
    const a = thread('Wer bezahlt die Krähenbande?');
    const b = thread('wer bezahlt die krähenbande', { truth: 'Lando Furtner.' });
    const c = thread('Wer bezahlt noch die Krähenbande?', { refs: [mira.id] });
    // Nur die Endung verschieden: derselbe Satz.
    thread('Der Schlüssel der Grotte', { truth: 'Er liegt im Brunnen.' });
    thread('Schlüssel der Grotten');
    // Ein anderes Wort ist ein anderer Satz – auch wenn es nur ein Name ist.
    thread('Wer hat Mira entführt?');
    thread('Wer hat Odo entführt?');
    thread('Wer bezahlt die Salzsieder?');
    // Gelöstes zählt nicht.
    thread('Das falsche Siegel');
    thread('Das falsche Siegel', { state: 'solved' });
    const twins = threadTwins(data());
    expect(twins.map((group) => group.threads.map((entry) => entry.title))).toEqual([
      ['Der Schlüssel der Grotte', 'Schlüssel der Grotten'],
      [
        'wer bezahlt die krähenbande',
        'Wer bezahlt noch die Krähenbande?',
        'Wer bezahlt die Krähenbande?',
      ],
    ]);
    // Es bleibt der, an dem am meisten geschrieben ist.
    const crows = twins[1]!;
    expect(crows.keepId).toBe(b.id);
    expect(crows.key).toBe([a.id, b.id, c.id].sort().join('+'));
    // Gehört einer zu einer Geschichte, bleibt der.
    const tale = story('Die Krähen');
    db.patch('threads', c.id, { storyId: tale.id });
    expect(threadTwins(data())[1]!.keepId).toBe(c.id);
    // Zwei Fragen in Geschichten sind kein Fall für die losen Fäden.
    db.patch('threads', a.id, { storyId: tale.id });
    db.patch('threads', b.id, { storyId: tale.id });
    expect(threadTwins(data())).toHaveLength(1);
  });

  it('meldet nicht mehr, was für verschieden erklärt ist', async () => {
    const { db, data, thread } = await setup();
    thread('Das Licht in der Salzgrotte');
    thread('Das Licht in der Salzgrotte?');
    const [group] = threadTwins(data());
    db.setState({ twinsApart: [group!.key] });
    expect(threadTwins(data())).toEqual([]);
    // Kommt ein dritter dazu, ist es eine neue Gruppe.
    thread('das licht in der salzgrotte');
    expect(threadTwins(data())).toHaveLength(1);
  });
});

describe('Die Liste der losen Fäden', () => {
  it('nennt, woran ein Faden hängt, wozu er passen könnte und wie nah er ist – was am Ort hängt zuerst', async () => {
    const { db, data, thread, story, market, grotto, castle, mira, odo, lando, guild } =
      await setup();
    const pact = story('Die Pacht der Grotte', [mira.id, grotto.id]);
    db.patch('stories', pact.id, { ownerId: guild.id });
    const feud = story('Der Streit der Tannhaus', [mira.id, odo.id]);
    story('Vorbei: Der alte Zoll', [mira.id], { closed: true });
    const light = thread('Das Licht in der Salzgrotte', { truth: 'Mira Tannhaus stellt es auf.' });
    const siege = thread('Wer belagert Burg Graufels?', { refs: [castle.id, lando.id] });
    const stall = thread('Der leere Stand', { refs: [market.id], state: 'active' });
    const coin = thread('Die fremde Münze', { refs: [market.id] });
    const old = thread('Die alte Schuld', { state: 'dormant', refs: [odo.id] });
    thread('Gelöst: Das falsche Siegel', { state: 'solved' });
    thread('Wer hat unterschrieben?', { storyId: pact.id });
    const rows = looseThreads(data());
    expect(rows.map((row) => [row.thread.title, row.nearness, row.resting])).toEqual([
      ['Der leere Stand', 'here', false],
      ['Die fremde Münze', 'here', false],
      ['Das Licht in der Salzgrotte', 'far', false],
      ['Wer belagert Burg Graufels?', 'far', false],
      // Was ruht, steht hinten – es kommt in die Später-Liste.
      ['Die alte Schuld', 'far', true],
    ]);
    const row = (id: string) => rows.find((entry) => entry.thread.id === id)!;
    expect(row(siege.id).nodes.map((entity) => entity.name)).toEqual([
      'Burg Graufels',
      'Lando Furtner',
    ]);
    expect(row(siege.id).fits).toEqual([]);
    // Die beste Geschichte zuerst, mit ihrem Grund – Abgeschlossenes steht nicht zur Wahl.
    expect(row(light.id).fits.map((fit) => [fit.story.id, fit.reason])).toEqual([
      [pact.id, 'nennt auch Mira Tannhaus und Salzgrotte'],
      [feud.id, 'nennt auch Mira Tannhaus'],
    ]);
    expect(row(old.id).fits.map((fit) => fit.story.id)).toEqual([feud.id]);
    // In einer Zeile: die beste Geschichte mit ihrem Grund – und dass es weitere gibt.
    expect(fitsLine(row(light.id).fits)).toBe(
      'passt zu „Die Pacht der Grotte“ – nennt auch Mira Tannhaus und Salzgrotte; auch zu 1 weiteren Geschichte',
    );
    expect(fitsLine(row(old.id).fits)).toBe(
      'passt zu „Der Streit der Tannhaus“ – nennt auch Odo Tannhaus',
    );
    expect(fitsLine(row(siege.id).fits)).toBe('');
    expect(storyFits(data(), threadLike('Odos Schulden', [odo.id])).map((f) => f.story.id)).toEqual(
      [feud.id],
    );
    expect(row(stall.id).onBoard).toBe(false);
    expect(row(coin.id).onBoard).toBe(false);
  });

  it('auf dem Brett liegt ein loser Faden nur, wenn er hingelegt wurde oder im Spiel ist', async () => {
    const { db, data, thread, story } = await setup();
    const pact = story('Die Pacht der Grotte');
    const plain = thread('Die fremde Münze');
    const laid = thread('Der leere Stand', { onBoard: true });
    const played = thread('Das Licht in der Salzgrotte', { inPlay: true });
    const old = thread('Die alte Schuld');
    // Aus früheren Ständen: Der Spielleiter hat ihn von Hand aufs Brett gelegt.
    db.setState({ board: { [`thread:${old.id}`]: { x: 40, y: 900 } } });
    const cards = boardCards(data());
    // Am Spieltisch stehen weiter alle zur Wahl.
    expect(cards).toHaveLength(5);
    const lying = (id: string) => cards.find((card) => card.key === `thread:${id}`)!.onBoard;
    expect([plain, laid, played, old].map((entry) => lying(entry.id))).toEqual([
      false,
      true,
      true,
      true,
    ]);
    const layout = boardLayout(cards, data().state.board);
    expect(Object.keys(layout.cards).sort()).toEqual(
      [`story:${pact.id}`, `thread:${laid.id}`, `thread:${played.id}`, `thread:${old.id}`].sort(),
    );
    expect(layout.cards[`thread:${old.id}`]).toEqual({ x: 40, y: 900 });
    // Die Geschichte liegt vorn: Ein Faden, der aufs Brett kommt, verschiebt sie nicht.
    expect(layout.cards[`story:${pact.id}`]).toEqual({ x: 0, y: 0 });
    expect(looseThreads(data()).filter((row) => row.onBoard)).toHaveLength(3);
  });

  it('weiß, woher ein Faden stammt und seit wann es ihn gibt', async () => {
    const { db, data, thread } = await setup();
    const proposal = (threadId: string, source = false): ReadProposal =>
      ({
        id: newId(),
        key: newId(),
        kind: 'thread',
        label: '',
        quote: '',
        text: '',
        line: 1,
        from: 0,
        to: 0,
        at: 0,
        precision: 'order',
        secret: false,
        refs: [],
        payload: {},
        hints: [],
        names: [],
        state: 'accepted',
        created: source ? [] : [{ collection: 'threads', id: threadId }],
        edits: source
          ? [{ kind: 'source', targetId: threadId, line: 'x', before: null, made: true }]
          : [],
        stale: false,
      }) satisfies ReadProposal;
    const reading = (proposals: ReadProposal[]) => ({
      readAt: '',
      mark: '',
      recap: '',
      proposals,
      questions: [],
      sections: [],
    });
    const hook = thread('Der Schlüssel der Grotte');
    const first = db.put(
      'sessions',
      createSession({ number: 3, startAt: ELARIS_START + 2 * MINUTES_PER_DAY }),
    );
    const second = db.put(
      'sessions',
      createSession({ number: 5, startAt: ELARIS_START + 9 * MINUTES_PER_DAY }),
    );
    // Aus älteren Ständen: Der angenommene Vorschlag weiß, was er angelegt hat.
    db.patch('sessions', first.id, { reading: reading([proposal(hook.id)]) as never });
    expect(threadOrigin(data(), data().threads[hook.id]!)).toMatchObject({
      sessions: [{ number: 3 }],
      since: first.startAt,
    });
    expect(threadOrigin(data(), data().threads[hook.id]!).text).toMatch(
      /^aus Session 3 \(19\. Tauwind 701/,
    );
    // Eine spätere Session nennt ihn wieder: Sie steht als Quelle dabei.
    db.patch('threads', hook.id, { sessionIds: [second.id] });
    const origin = threadOrigin(data(), data().threads[hook.id]!);
    expect(origin.sessions.map((session) => session.number)).toEqual([3, 5]);
    expect(origin.text).toMatch(/^aus den Sessions 3 und 5 \(seit 19\. Tauwind 701/);
    // Vom KI-Leser: aus einem Artikel.
    const article = db.put(
      'articles',
      ArticleSchema.parse({ id: newId(), title: 'Die Seeschwalbe' }),
    );
    const lead = thread('Wem gehört die Seeschwalbe?', { articleId: article.id });
    expect(threadOrigin(data(), lead).text).toBe('aus dem Artikel „Die Seeschwalbe“');
    // Sonst der Tag, an dem er angelegt wurde.
    const own = thread('Die fremde Münze', { created: '2026-11-09T18:00:00.000Z' });
    expect(threadOrigin(data(), own).text).toBe('angelegt am 9. 11. 2026');
    expect(looseThreads(data()).find((row) => row.thread.id === hook.id)!.origin.since).toBe(
      first.startAt,
    );
  });

  it('sucht in Satz, Antwort, Hinweisen und Namen', async () => {
    const { data, thread, market, mira } = await setup();
    thread('Die fremde Münze', { refs: [market.id] });
    thread('Der leere Stand', { truth: 'Der Krämer ist geflohen.' });
    thread('Wer warnte die Wache?', {
      refs: [mira.id],
      hints: [
        { id: newId(), text: 'Ein Zettel im Stroh', placeId: null, sourceId: null, found: false },
      ],
    });
    const rows = looseThreads(data());
    const found = (query: string) => filterLoose(rows, query).map((row) => row.thread.title);
    expect(found('')).toHaveLength(3);
    expect(found('münze')).toEqual(['Die fremde Münze']);
    expect(found('KRÄMER')).toEqual(['Der leere Stand']);
    expect(found('zettel stroh')).toEqual(['Wer warnte die Wache?']);
    expect(found('mira')).toEqual(['Wer warnte die Wache?']);
    expect(found('markt')).toEqual(['Die fremde Münze']);
    expect(found('mira münze')).toEqual([]);
  });

  it('zeigt in der Sicht der Gruppe nur, was sie kennt – ohne Antwort und fremde Geschichten', async () => {
    const { db, data, thread, story, mira } = await setup();
    const secret = story('Die Pacht der Grotte', [mira.id]);
    thread('Die fremde Münze', { known: false });
    thread('Wer warnte Mira Tannhaus?', { known: true, truth: 'Odo.' });
    const rows = looseThreads(data(), 'party');
    expect(rows.map((row) => row.thread.title)).toEqual(['Wer warnte Mira Tannhaus?']);
    expect(rows[0]!.thread.truth).toBe('');
    expect(rows[0]!.fits).toEqual([]);
    db.patch('stories', secret.id, { known: true });
    expect(looseThreads(data(), 'party')[0]!.fits.map((fit) => fit.story.id)).toEqual([secret.id]);
  });

  it('nennt der Gruppe als Herkunft nur den Abend – nie den Artikel oder den Tag des Anlegens', async () => {
    const { db, data, thread } = await setup();
    const article = db.put(
      'articles',
      ArticleSchema.parse({ id: newId(), title: 'Das Geheimnis der Salzsieder' }),
    );
    const evening = db.put('sessions', createSession({ number: 4, startAt: ELARIS_START }));
    thread('Aus einem Artikel', { articleId: article.id });
    thread('Aus einem Abend', { sessionIds: [evening.id] });
    thread('Von Hand', { created: '2026-11-09T18:00:00.000Z' });
    const origins = (view: 'truth' | 'party') =>
      Object.fromEntries(
        looseThreads(data(), view).map((row) => [row.thread.title, row.origin.text]),
      );
    expect(origins('truth')).toMatchObject({
      'Aus einem Artikel': 'aus dem Artikel „Das Geheimnis der Salzsieder“',
      'Von Hand': 'angelegt am 9. 11. 2026',
    });
    expect(origins('party')).toMatchObject({ 'Aus einem Artikel': '', 'Von Hand': '' });
    expect(origins('party')['Aus einem Abend']).toMatch(/^aus Session 4 /);
    // Auch die Suche findet in der Sicht der Gruppe nicht über den Namen des Artikels.
    expect(filterLoose(looseThreads(data(), 'party'), 'Geheimnis')).toEqual([]);
    expect(filterLoose(looseThreads(data(), 'truth'), 'Geheimnis')).toHaveLength(1);
  });
});

describe('Namen in einer Zeile', () => {
  it('nennt bis zu drei beim Namen – nie „und 1 weitere“', async () => {
    const { mira, odo, lando, guild } = await setup();
    expect(namesLine([])).toBe('');
    expect(namesLine([mira])).toBe('Mira Tannhaus');
    expect(namesLine([mira, odo])).toBe('Mira Tannhaus und Odo Tannhaus');
    expect(namesLine([mira, odo, lando])).toBe('Mira Tannhaus, Odo Tannhaus und Lando Furtner');
    expect(namesLine([mira, odo, lando, guild])).toBe('Mira Tannhaus, Odo Tannhaus und 2 weitere');
  });
});

describe('Geschichten und Fäden zur Wahl', () => {
  it('stellt für mehrere Fäden die passenden Geschichten zuerst', async () => {
    const { db, data, thread, story, mira, odo, grotto, guild } = await setup();
    const pact = story('Die Pacht der Grotte', [mira.id, grotto.id]);
    const feud = story('Der Streit der Tannhaus', [odo.id]);
    const other = story('Aalfang');
    story('Vorbei', [mira.id], { closed: true });
    const light = thread('Das Licht in der Salzgrotte');
    const warned = thread('Wer warnte Mira Tannhaus?');
    const debt = thread('Odos Schulden', { refs: [odo.id] });
    expect(storyChoices(data(), [light]).map((choice) => [choice.story.id, choice.reason])).toEqual(
      [
        [pact.id, 'nennt auch Salzgrotte'],
        [other.id, ''],
        [feud.id, ''],
      ],
    );
    expect(
      storyChoices(data(), [light, warned, debt]).map((choice) => [
        choice.story.id,
        choice.count,
        choice.reason,
      ]),
    ).toEqual([
      [pact.id, 2, '2 von 3 nennen auch Mira Tannhaus und Salzgrotte'],
      [feud.id, 1, '1 von 3 nennen auch Odo Tannhaus'],
      [other.id, 0, ''],
    ]);
    expect(storyChoices(data(), [light, warned])[0]!.reason).toBe(
      'alle nennen auch Mira Tannhaus und Salzgrotte',
    );
    // Die Suche findet nach dem Namen der Geschichte und dem ihres Antreibers.
    db.patch('stories', other.id, { ownerId: guild.id });
    const all = storyChoices(data(), [light]);
    expect(filterStoryChoices(data(), all, 'STREIT tannhaus').map((c) => c.story.id)).toEqual([
      feud.id,
    ]);
    expect(filterStoryChoices(data(), all, 'salzsieder').map((c) => c.story.id)).toEqual([
      other.id,
    ]);
    expect(filterStoryChoices(data(), all, '  ')).toHaveLength(3);
    expect(filterStoryChoices(data(), all, 'gibtsnicht')).toEqual([]);
  });

  it('reiht Fäden überall gleich: lebendig, am Ort, in einer Geschichte, nach dem Satz', async () => {
    const { data, thread, story, market, castle } = await setup();
    const tale = story('Die Pacht der Grotte', [castle.id]);
    thread('Zebra am Markt', { refs: [market.id] });
    thread('Aal am Markt', { refs: [market.id] });
    thread('Fern und lose', { refs: [castle.id] });
    thread('Frage der Geschichte', { storyId: tale.id });
    thread('Gelöst am Markt', { refs: [market.id], state: 'solved' });
    expect(threadsInOrder(data()).map((entry) => entry.title)).toEqual([
      'Aal am Markt',
      'Zebra am Markt',
      'Frage der Geschichte',
      'Fern und lose',
      'Gelöst am Markt',
    ]);
  });
});
