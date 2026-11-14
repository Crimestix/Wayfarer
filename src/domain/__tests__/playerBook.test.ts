import { describe, expect, it } from 'vitest';
import { moveParty } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { recordEntry, type RecordInput } from '../../data/record';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { giveHandout, saveHandout } from '../../features/handouts/actions';
import { removeGuess, saveGuess, setGuessTruth } from '../../features/spielerbuch/actions';
import { playerBookText } from '../../features/spielerbuch/model';
import {
  LINES_PER_THING,
  bookIds,
  isKnownLine,
  knowledgeOf,
  knownPlaceIds,
  playerBook,
  type BookSection,
} from '../playerBook';
import { emptyMagic } from '../magicItem';
import {
  PARTY_ID,
  createChronicleEntry,
  createEntity,
  createLoot,
  createStory,
  type ChronicleEntry,
  type Item,
} from '../schema';

/** Hohenfurt mit Hafen, die Salzgrotte, Burg Graufels; Mira, Odo, Krummzahn – erfunden. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const put = <T extends Parameters<typeof createEntity>[0]>(init: T) =>
    db.put('entities', createEntity(init as never));
  const town = put({ kind: 'place', name: 'Hohenfurt' });
  const harbour = put({ kind: 'place', name: 'Hafen', place: { parentId: town.id } });
  const grotto = put({ kind: 'place', name: 'Salzgrotte' });
  const castle = put({ kind: 'place', name: 'Burg Graufels' });
  const mira = put({ kind: 'person', name: 'Mira Tannhaus', person: { met: true } });
  const odo = put({
    kind: 'person',
    name: 'Odo Tannhaus',
    secret: 'Schmuggelt Salz für die Graue Hand',
    notes: 'Spielt falsch',
  });
  const krummzahn = put({ kind: 'person', name: 'Krummzahn', person: { met: true } });
  const fishers = put({ kind: 'faction', name: 'Die Aalfischer' });
  const hand = put({ kind: 'faction', name: 'Die Graue Hand' });
  const compass = put({ kind: 'item', name: 'Silberner Kompass' });
  const crown = put({ kind: 'item', name: 'Eisenkrone' });
  const salt = db.put('stories', createStory({ title: 'Das Salz der Grotte', known: true }));
  const betrayal = db.put('stories', createStory({ title: 'Der Verrat', known: false }));

  moveParty(db, town.id);
  moveParty(db, harbour.id);
  const record = (input: RecordInput): ChronicleEntry => {
    const result = recordEntry(db, input);
    if ('problem' in result) throw new Error(result.problem);
    return result.entry;
  };
  const raw = (init: Partial<ChronicleEntry>) =>
    db.put('chronicle', createChronicleEntry({ at: db.getSnapshot().state.now, ...init }));

  record({ kind: 'discovery', placeId: grotto.id, text: 'Ein Spalt im Fels' });
  const told = record({
    kind: 'note',
    text: 'Mira erzählt von den Aalfischern',
    refs: [mira.id, fishers.id],
    storyId: salt.id,
  });
  const hidden = record({
    kind: 'note',
    text: 'Mira arbeitet für die Graue Hand',
    refs: [mira.id, hand.id, crown.id],
    secret: true,
  });
  const aboutOdo = record({ kind: 'note', text: 'Odo verkauft Netze', refs: [odo.id] });
  const rumor = record({
    kind: 'rumor',
    text: 'In der Grotte liegt Salzsilber',
    rumor: { sourceId: mira.id, truth: 'false' },
  });
  const promise = record({ kind: 'promise', text: 'Mira den Kompass zeigen', refs: [mira.id] });
  const clue = raw({ kind: 'clue', text: 'Fußspuren am Ufer' });
  const reveal = raw({ kind: 'reveal', text: 'Der Turm ist hohl' });
  const writing = record({
    kind: 'writing',
    text: 'Kommt allein.',
    writing: { title: 'Zettel am Anleger' },
  });
  const event = raw({ kind: 'event', text: 'Markttag', refs: [mira.id] });
  const step = raw({ kind: 'change', text: 'Die Graue Hand rückt vor', clockId: 'uhr1' });
  db.put('loot', createLoot({ itemId: compass.id, given: true, text: 'Kompass' }));
  const letter = saveHandout(db, { title: 'Brief der Mira', text: 'Ich warte am Hafen.' });
  giveHandout(db, letter.id);
  saveHandout(db, { title: 'Noch nicht übergeben', text: 'Geheim' });

  const guess = saveGuess(db, { text: 'Mira lügt über die Grotte', refs: [mira.id] })!;
  setGuessTruth(db, guess.id, 'half', 'Sie weiß mehr, als sie sagt');
  const loose = saveGuess(db, { text: 'Der Bürgermeister steckt dahinter', refs: [] })!;

  return {
    db,
    data: () => db.getSnapshot(),
    ...{ town, harbour, grotto, castle, mira, odo, krummzahn, fishers, hand, compass, crown },
    ...{ salt, betrayal, told, hidden, aboutOdo, rumor, promise, clue, reveal, writing },
    ...{ event, step, guess, loose, record },
  };
}

const section = <S extends BookSection['sort']>(
  sections: BookSection[],
  id: string,
): Extract<BookSection, { sort: S }> | undefined =>
  sections.find((s) => s.id === id) as Extract<BookSection, { sort: S }> | undefined;

describe('Spielerbuch', () => {
  it('kennt Orte aus Ortswechseln, Entdeckungen und dem heutigen Ort – samt den Orten darüber', async () => {
    const w = await setup();
    const places = knownPlaceIds(w.data());
    expect(places.has(w.town.id)).toBe(true);
    expect(places.has(w.harbour.id)).toBe(true);
    expect(places.has(w.grotto.id)).toBe(true);
    expect(places.has(w.castle.id)).toBe(false);
  });

  it('nimmt nur Zeilen, die die Gruppe kennen kann', async () => {
    const w = await setup();
    const data = w.data();
    expect(isKnownLine(data, w.told)).toBe(true);
    expect(isKnownLine(data, w.hidden)).toBe(false);
    // Odo hat die Gruppe nie getroffen – die Zeile nennt ihn.
    expect(isKnownLine(data, w.aboutOdo)).toBe(false);
    // Termine und Schritte einer Uhr geschehen ohne die Gruppe.
    expect(isKnownLine(data, w.event)).toBe(false);
    expect(isKnownLine(data, w.step)).toBe(false);
  });

  it('gliedert, was die Gruppe weiß, in Abschnitte', async () => {
    const w = await setup();
    const book = playerBook(w.data());
    expect(book.sections.map((s) => s.id)).toEqual([
      'people',
      'places',
      'factions',
      'items',
      'stories',
      'promises',
      'rumors',
      'clues',
      'reveals',
      'writings',
      'handouts',
      'guesses',
    ]);
    const names = (id: string) => section<'things'>(book.sections, id)!.things.map((t) => t.name);
    expect(names('people')).toEqual(['Krummzahn', 'Mira Tannhaus']);
    expect(names('places')).toEqual(['Hafen', 'Hohenfurt', 'Salzgrotte']);
    // Die Graue Hand und die Eisenkrone stehen nur in einer geheimen Zeile.
    expect(names('factions')).toEqual(['Die Aalfischer']);
    expect(names('items')).toEqual(['Silberner Kompass']);
    expect(names('stories')).toEqual(['Das Salz der Grotte']);

    const mira = section<'things'>(book.sections, 'people')!.things[1]!;
    // Das Gerücht hängt an Mira, weil sie es erzählt hat.
    expect(mira.lines.map((e) => e.text)).toEqual([
      'Mira erzählt von den Aalfischern',
      'In der Grotte liegt Salzsilber',
      'Mira den Kompass zeigen',
    ]);
    expect(mira.guesses.map((g) => g.text)).toEqual(['Mira lügt über die Grotte']);
    const story = section<'things'>(book.sections, 'stories')!.things[0]!;
    expect(story.lines.map((e) => e.id)).toEqual([w.told.id]);

    expect(section<'lines'>(book.sections, 'promises')!.entries.map((e) => e.id)).toEqual([
      w.promise.id,
    ]);
    expect(section<'lines'>(book.sections, 'rumors')!.entries.map((e) => e.id)).toEqual([
      w.rumor.id,
    ]);
    expect(section<'handouts'>(book.sections, 'handouts')!.handouts.map((h) => h.title)).toEqual([
      'Brief der Mira',
    ]);
    // Nur die Vermutung, die an keinem Ding des Buchs hängt, steht für sich.
    const loose = section<'guesses'>(book.sections, 'guesses')!;
    expect(loose.label).toBe('Weitere Vermutungen');
    expect(loose.guesses.map((g) => g.id)).toEqual([w.loose.id]);
    expect(book).toMatchObject({ guessCount: 2, openGuesses: 1 });
    expect(bookIds(w.data()).has(w.odo.id)).toBe(false);
  });

  it('zeigt je Ding nur die letzten Zeilen', async () => {
    const w = await setup();
    for (const text of ['Eins', 'Zwei', 'Drei', 'Vier'])
      w.record({ kind: 'note', text, refs: [w.krummzahn.id] });
    const people = section<'things'>(playerBook(w.data()).sections, 'people')!;
    const krummzahn = people.things[0]!;
    expect(krummzahn.lines.map((e) => e.text)).toEqual(['Zwei', 'Drei', 'Vier']);
    expect(krummzahn.lines).toHaveLength(LINES_PER_THING);
    expect(krummzahn.lineCount).toBe(4);
  });

  it('verrät in der Fassung für die Spieler nichts Geheimes', async () => {
    const w = await setup();
    const players = playerBookText(w.data(), 'players');
    expect(players).toContain('Mira Tannhaus');
    expect(players).toContain('Gerücht von Mira Tannhaus: In der Grotte liegt Salzsilber');
    expect(players).toContain('Vermutung: Mira lügt über die Grotte');
    expect(players).toContain('Ich warte am Hafen.');
    for (const hidden of [
      'falsch',
      'halb',
      'Sie weiß mehr',
      'Graue Hand',
      'Eisenkrone',
      'Odo',
      'Schmuggelt',
      'Spielt falsch',
      'Der Verrat',
      'Noch nicht übergeben',
      'Markttag',
      'Burg Graufels',
    ])
      expect(players).not.toContain(hidden);

    const gm = playerBookText(w.data(), 'gm');
    expect(gm).toContain(
      'Vermutung: Mira lügt über die Grotte (halb – Sie weiß mehr, als sie sagt)',
    );
    expect(gm).toContain('falsch');
  });

  it('teilt das Wissen zu einem Eintrag in drei Schichten', async () => {
    const w = await setup();
    const mira = knowledgeOf(w.data(), w.mira.id);
    expect(mira.inBook).toBe(true);
    expect(mira.known.map((e) => e.id)).toEqual([w.told.id, w.rumor.id, w.promise.id]);
    expect(mira.guesses.map((g) => g.truth)).toEqual(['half']);
    expect(mira.secretLines.map((e) => e.id)).toEqual([w.hidden.id]);
    expect(mira.empty).toBe(false);

    const odo = knowledgeOf(w.data(), w.odo.id);
    expect(odo).toMatchObject({
      inBook: false,
      known: [],
      guesses: [],
      secret: 'Schmuggelt Salz für die Graue Hand',
      empty: false,
    });
    expect(knowledgeOf(w.data(), w.castle.id).empty).toBe(true);
  });
});

describe('Vermutungen', () => {
  it('hält fest, setzt den Stand und nimmt das Löschen zurück', async () => {
    const w = await setup();
    expect(saveGuess(w.db, { text: '   ', refs: [] })).toBeNull();
    const guess = saveGuess(w.db, {
      text: ' Krummzahn ist der Erbe ',
      refs: [w.krummzahn.id, w.krummzahn.id, 'weg', w.salt.id],
    })!;
    expect(guess).toMatchObject({
      text: 'Krummzahn ist der Erbe',
      refs: [w.krummzahn.id, w.salt.id],
      at: w.data().state.now,
      sessionId: w.data().state.sessionId,
      truth: 'open',
      note: '',
    });
    setGuessTruth(w.db, guess.id, 'true');
    expect(w.data().guesses[guess.id]!.truth).toBe('true');
    const edited = saveGuess(w.db, { text: 'Krummzahn ist der wahre Erbe', refs: [] }, guess.id)!;
    expect(edited).toMatchObject({ id: guess.id, refs: [], truth: 'true' });

    const undo = removeGuess(w.db, guess.id)!;
    expect(w.data().guesses[guess.id]).toBeUndefined();
    undo();
    expect(w.data().guesses[guess.id]!.text).toBe('Krummzahn ist der wahre Erbe');
    expect(removeGuess(w.db, 'weg')).toBeNull();
  });

  it('legt beim Ändern einer gelöschten Vermutung keine zweite an', async () => {
    const w = await setup();
    removeGuess(w.db, w.guess.id);
    const count = Object.keys(w.data().guesses).length;
    expect(saveGuess(w.db, { text: 'Mira lügt doch nicht', refs: [] }, w.guess.id)).toBeNull();
    expect(Object.keys(w.data().guesses)).toHaveLength(count);
  });
});

describe('Spielerbuch – Randfälle', () => {
  it('ein Raum, in dem die Gruppe war, gilt als bekannt – steht aber bei seinem Ort', async () => {
    const w = await setup();
    const cellar = w.db.put(
      'entities',
      createEntity({
        kind: 'place',
        name: 'Weinkeller',
        place: { parentId: w.castle.id, room: true },
      } as never),
    );
    moveParty(w.db, cellar.id);
    const data = w.data();
    expect(knowledgeOf(data, cellar.id).inBook).toBe(true);
    expect(bookIds(data).has(cellar.id)).toBe(false);
    expect(bookIds(data).has(w.castle.id)).toBe(true);
  });

  it('nennt bei einem übergebenen Handout die Unterschrift', async () => {
    const w = await setup();
    const note = saveHandout(w.db, { title: 'Zettel', text: 'Morgen am Steg.', signature: 'L.' });
    giveHandout(w.db, note.id);
    expect(playerBookText(w.data(), 'players')).toContain('Morgen am Steg.\n  – L.');
  });

  it('ein leerer Spielstand hat ein leeres Buch', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const data = db.getSnapshot();
    expect(playerBook(data)).toEqual({ sections: [], guessCount: 0, openGuesses: 0 });
    expect(playerBookText(data, 'players')).toContain('Noch steht nichts darin.');
  });
});

describe('Spielerbuch – magische Gegenstände', () => {
  it('nennt die Magie erst, wenn die Gruppe sie erkannt hat, und nie den Fluch', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const ring = db.put(
      'entities',
      createEntity({
        kind: 'item',
        name: 'Ring des Brann Eichwald',
        item: {
          holderId: PARTY_ID,
          magic: {
            ...emptyMagic(),
            rarity: 'rare',
            type: 'Ring',
            cursed: true,
            charges: { max: 3, current: 1, recharge: 'alle bei Morgengrauen', spentAt: null },
          },
        },
      }),
    ) as Item;
    const things = () =>
      playerBook(db.getSnapshot()).sections.flatMap((s) => (s.sort === 'things' ? s.things : []));
    expect(things().find((t) => t.id === ring.id)?.magic).toBe('');
    expect(knowledgeOf(db.getSnapshot(), ring.id)).toMatchObject({ magic: '', cursed: true });
    let text = playerBookText(db.getSnapshot(), 'players');
    expect(text).toContain('Ring des Brann Eichwald');
    expect(text).not.toMatch(/selten|fluch|verflucht|Ladung/i);

    db.put('entities', {
      ...ring,
      item: { ...ring.item, magic: { ...ring.item.magic!, identified: true } },
    });
    const magic = things().find((t) => t.id === ring.id)?.magic;
    expect(magic).toBe('magisch · selten · Ring · 1 von 3 Ladungen, alle bei Morgengrauen');
    text = playerBookText(db.getSnapshot(), 'players');
    expect(text).toContain('magisch · selten · Ring');
    expect(text).not.toMatch(/fluch|verflucht/i);
  });
});
