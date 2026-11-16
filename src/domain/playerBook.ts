/**
 * Das Spielerbuch: was die Gruppe weiß und vermutet – getrennt von dem, was nur die Spielleitung
 * weiß. Wayfarer schreibt nichts dazu; es sammelt, was in der Chronik für die Spieler steht, wen
 * die Gruppe getroffen und wo sie war, was sie bekommen hat – und die Vermutungen der Spieler.
 * Nie darin: Geheimnisse eines Eintrags, Notizen der Spielleitung, geheime Zeilen, der Stand von
 * Gerüchten und Vermutungen (in der Fassung für die Spieler) und Geheimnisse des Abend-Blatts.
 * Bücher, die die Gruppe hat (`domain/book.ts`), zählen in ihrer eigenen Fassung – mit den
 * Irrtümern des Verfassers. Reine Funktionen.
 */
import { booksAbout, groupBooks, readablePages, type BookKnowledge } from './book';
import { magicOf, playerMagicLine } from './magicItem';
import {
  byName,
  chronicleFor,
  chronicleSorted,
  openPromises,
  partyStays,
  placeAncestors,
  placeSubtreeIds,
} from './derive';
import {
  PARTY_ID,
  type CampaignData,
  type ChronicleEntry,
  type ChronicleKind,
  type EntityKind,
  type Guess,
  type GuessTruth,
  type Handout,
} from './schema';
import { isUnmetPerson, knowsPerson } from './known';

/** Wie eine Vermutung ausgegangen ist – nur für die Spielleitung. */
export const GUESS_TRUTH_LABEL: Record<GuessTruth, string> = {
  open: 'offen',
  true: 'stimmt',
  half: 'halb',
  false: 'stimmt nicht',
};

/** So viele der letzten Zeilen stehen je Ding im Spielerbuch. */
export const LINES_PER_THING = 3;

/**
 * Darf ein Eintrag zu den Spielern? Nicht, wenn er als „nur für die Spielleitung“ markiert ist,
 * eine Haltung offenlegt oder jemanden nennt, den die Gruppe noch nicht kennt.
 */
export function isForPlayers(data: CampaignData, entry: ChronicleEntry): boolean {
  if (entry.secret || entry.kind === 'attitude') return false;
  // Was jemand anderes als ein Gefährte erfahren hat, weiß nur die Spielleitung.
  if (entry.kind === 'knowledge') {
    const knower = entry.refs[0] ? data.entities[entry.refs[0]] : undefined;
    if (knower?.kind !== 'character') return false;
  }
  return !entry.refs.some((id) => {
    const entity = data.entities[id];
    return isUnmetPerson(data, entity);
  });
}

/**
 * Weiß die Gruppe, was in dieser Zeile steht? Sie ist für die Spieler – und nicht von selbst
 * entstanden: Eingetretene Termine und Schritte einer Uhr geschehen in der Welt, ohne dass die
 * Gruppe davon erfährt.
 */
export function isKnownLine(data: CampaignData, entry: ChronicleEntry): boolean {
  return entry.kind !== 'event' && entry.clockId === null && isForPlayers(data, entry);
}

/**
 * Orte, die die Gruppe kennt: wo sie war (Ortswechsel), was sie entdeckt hat, wo sie gerade ist
 * – samt den Orten darüber.
 */
export function knownPlaceIds(data: CampaignData): Set<string> {
  const known = new Set<string>();
  const add = (placeId: string | null) => {
    if (!placeId || known.has(placeId) || data.entities[placeId]?.kind !== 'place') return;
    known.add(placeId);
    for (const ancestor of placeAncestors(data, placeId)) known.add(ancestor.id);
  };
  for (const stay of partyStays(data)) add(stay.placeId);
  for (const entry of Object.values(data.chronicle))
    if (entry.kind === 'discovery' && !entry.secret) add(entry.placeId);
  add(data.state.placeId);
  return known;
}

// ── Das Buch ───────────────────────────────────────────────────────────────

/** Ein Ding, das die Gruppe kennt: Name, die letzten Zeilen dazu und die Vermutungen. */
export interface BookThing {
  id: string;
  name: string;
  /** Art des Eintrags der Welt; `story` bei einer Geschichte. */
  kind: EntityKind | 'story';
  /**
   * Was die Gruppe von der Magie eines Gegenstands weiß – nur, wenn sie ihn erkannt hat
   * (`playerMagicLine`); nie der Fluch. '' = nichts.
   */
  magic: string;
  /** Die letzten Zeilen der Chronik, die die Gruppe kennt – älteste zuerst. */
  lines: ChronicleEntry[];
  /** So viele Zeilen gibt es insgesamt. */
  lineCount: number;
  guesses: Guess[];
}

export type ThingSectionId = 'people' | 'places' | 'factions' | 'items' | 'stories';
export type LineSectionId = 'promises' | 'rumors' | 'clues' | 'reveals' | 'writings';

/** Ein Buch, das die Gruppe hat, und was darin steht. */
export interface GroupBook {
  id: string;
  name: string;
  /** Der Verfasser; '' = unbekannt. */
  author: string;
  /** Die Einträge, über die es etwas sagt – nach Namen. */
  entries: { id: string; name: string }[];
}

export type BookSection =
  | { sort: 'things'; id: ThingSectionId; label: string; things: BookThing[] }
  | { sort: 'lines'; id: LineSectionId; label: string; entries: ChronicleEntry[] }
  | { sort: 'handouts'; id: 'handouts'; label: string; handouts: Handout[] }
  | { sort: 'books'; id: 'books'; label: string; books: GroupBook[] }
  | { sort: 'guesses'; id: 'guesses'; label: string; guesses: Guess[] };

export interface PlayerBook {
  /** Nur Abschnitte, in denen etwas steht. */
  sections: BookSection[];
  /** Alle Vermutungen und wie viele davon noch offen sind. */
  guessCount: number;
  openGuesses: number;
}

const THING_LABEL: Record<ThingSectionId, string> = {
  people: 'Personen',
  places: 'Orte',
  factions: 'Fraktionen und Familien',
  items: 'Gegenstände',
  stories: 'Geschichten',
};

const LINE_SECTIONS: { id: LineSectionId; label: string; kind: ChronicleKind }[] = [
  { id: 'rumors', label: 'Gerüchte', kind: 'rumor' },
  { id: 'clues', label: 'Gefundene Hinweise', kind: 'clue' },
  { id: 'reveals', label: 'Aufgedeckt', kind: 'reveal' },
  { id: 'writings', label: 'Schriftstücke', kind: 'writing' },
];

const byGuessTime = (a: Guess, b: Guess) =>
  a.at - b.at || a.created.localeCompare(b.created) || a.id.localeCompare(b.id);

/** Die Vermutungen, älteste zuerst. */
export const guessesSorted = (data: CampaignData): Guess[] =>
  Object.values(data.guesses).sort(byGuessTime);

/** Die Vermutungen zu einem Eintrag der Welt oder einer Geschichte, älteste zuerst. */
export const guessesAbout = (data: CampaignData, id: string): Guess[] =>
  guessesSorted(data).filter((guess) => guess.refs.includes(id));

/** Was die Gruppe kennt: je Abschnitt die Kennungen, in der Reihenfolge des Buchs. */
function knownThings(
  data: CampaignData,
  known: ChronicleEntry[],
): Record<ThingSectionId, string[]> {
  const places = knownPlaceIds(data);
  const mentioned = new Set<string>();
  for (const entry of known) for (const id of entry.refs) mentioned.add(id);
  // Was die Gruppe bekommen hat oder bei sich trägt.
  const received = new Set<string>();
  for (const loot of Object.values(data.loot))
    if (loot.given && loot.itemId) received.add(loot.itemId);

  const ids: Record<ThingSectionId, string[]> = {
    people: [],
    places: [],
    factions: [],
    items: [],
    stories: [],
  };
  for (const entity of Object.values(data.entities).sort(byName)) {
    switch (entity.kind) {
      case 'person':
        if (knowsPerson(data, entity)) ids.people.push(entity.id);
        break;
      case 'place':
        // Räume stehen auf der Seite ihres Ortes, nicht einzeln.
        if (places.has(entity.id) && !entity.place.room) ids.places.push(entity.id);
        break;
      case 'faction':
      case 'family':
        if (mentioned.has(entity.id)) ids.factions.push(entity.id);
        break;
      case 'item': {
        const holder = entity.item.holderId;
        const carried =
          holder === PARTY_ID || (holder !== null && data.entities[holder]?.kind === 'character');
        if (mentioned.has(entity.id) || received.has(entity.id) || carried)
          ids.items.push(entity.id);
        break;
      }
      default:
        break;
    }
  }
  ids.stories = Object.values(data.stories)
    .filter((story) => story.known)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'))
    .map((story) => story.id);
  return ids;
}

/** Die Zeilen, die die Gruppe zu einem Ding kennt – älteste zuerst. */
function linesOf(data: CampaignData, known: ChronicleEntry[], id: string): ChronicleEntry[] {
  if (data.stories[id]) return known.filter((entry) => entry.storyId === id);
  if (data.entities[id]?.kind === 'place') {
    const ids = placeSubtreeIds(data, id);
    return known.filter(
      (entry) =>
        (entry.placeId !== null && ids.has(entry.placeId)) || entry.refs.some((r) => ids.has(r)),
    );
  }
  return known.filter((entry) => entry.refs.includes(id));
}

/** Die Kennungen aller Dinge, die im Spielerbuch stehen. */
export function bookIds(data: CampaignData): Set<string> {
  const known = chronicleSorted(data).filter((entry) => isKnownLine(data, entry));
  return new Set(Object.values(knownThings(data, known)).flat());
}

/**
 * Das Spielerbuch: Personen, die die Gruppe getroffen hat, Orte, an denen sie war, Fraktionen
 * und Gegenstände, die in Zeilen für die Spieler vorkommen (oder die sie bekommen hat),
 * Geschichten, von denen sie weiß – je mit den letzten Zeilen dazu und den Vermutungen. Dazu
 * offene Abmachungen, Gerüchte, Hinweise, Aufgedecktes, Schriftstücke, übergebene Handouts und
 * die Vermutungen, die an keinem dieser Dinge hängen.
 */
export function playerBook(data: CampaignData): PlayerBook {
  const known = chronicleSorted(data).filter((entry) => isKnownLine(data, entry));
  const guesses = guessesSorted(data);
  const things = knownThings(data, known);
  const shown = new Set<string>();
  const sections: BookSection[] = [];

  for (const id of Object.keys(THING_LABEL) as ThingSectionId[]) {
    const list: BookThing[] = things[id].map((thingId) => {
      shown.add(thingId);
      const lines = linesOf(data, known, thingId);
      const story = data.stories[thingId];
      const entity = data.entities[thingId];
      return {
        id: thingId,
        name: story ? story.title : (entity?.name ?? ''),
        kind: story ? 'story' : entity!.kind,
        magic: story ? '' : playerMagicLine(entity),
        lines: lines.slice(-LINES_PER_THING),
        lineCount: lines.length,
        guesses: guesses.filter((guess) => guess.refs.includes(thingId)),
      };
    });
    if (list.length) sections.push({ sort: 'things', id, label: THING_LABEL[id], things: list });
  }

  const promises = openPromises(data)
    .filter((entry) => isKnownLine(data, entry))
    .sort((a, b) => a.at - b.at);
  if (promises.length)
    sections.push({
      sort: 'lines',
      id: 'promises',
      label: 'Offene Abmachungen und Aufträge',
      entries: promises,
    });
  for (const { id, label, kind } of LINE_SECTIONS) {
    const entries = known.filter((entry) => entry.kind === kind);
    if (entries.length) sections.push({ sort: 'lines', id, label, entries });
  }

  const handouts = Object.values(data.handouts)
    .filter((handout) => handout.givenAt !== null)
    .sort((a, b) => a.givenAt! - b.givenAt! || a.title.localeCompare(b.title, 'de'));
  if (handouts.length)
    sections.push({ sort: 'handouts', id: 'handouts', label: 'Handouts', handouts });

  const books = groupBooks(data).map((book) => ({
    id: book.id,
    name: book.name,
    author: data.entities[book.item.book.authorId ?? '']?.name ?? book.item.book.authorText.trim(),
    entries: readablePages(data, book)
      .map((page) => ({ id: page.entityId, name: page.title }))
      .sort(byName),
  }));
  if (books.length)
    sections.push({ sort: 'books', id: 'books', label: 'Bücher der Gruppe', books });

  const loose = guesses.filter((guess) => !guess.refs.some((id) => shown.has(id)));
  if (loose.length)
    sections.push({
      sort: 'guesses',
      id: 'guesses',
      label: shown.size ? 'Weitere Vermutungen' : 'Vermutungen',
      guesses: loose,
    });

  return {
    sections,
    guessCount: guesses.length,
    openGuesses: guesses.filter((guess) => guess.truth === 'open').length,
  };
}

// ── Für eine Seite ─────────────────────────────────────────────────────────

/** Was die Gruppe über einen Eintrag weiß, was sie vermutet – und was nur die Spielleitung weiß. */
export interface Knowledge {
  /**
   * Die Gruppe kennt den Eintrag: Er steht im Spielerbuch (getroffen, besucht, erwähnt, bekommen)
   * – oder ist ein Raum, in dem sie war (Räume stehen dort bei ihrem Ort).
   */
  inBook: boolean;
  /** Weiß die Gruppe: die letzten Zeilen für die Spieler, älteste zuerst. */
  known: ChronicleEntry[];
  /** Weiß die Gruppe von der Magie (erkannt; nie der Fluch). '' = nichts. */
  magic: string;
  knownCount: number;
  /**
   * Weiß die Gruppe aus einem Buch, das sie hat: die Seite zu diesem Eintrag in der Fassung des
   * Buches – nichts Geheimes, aber vielleicht mit den Irrtümern des Verfassers.
   */
  books: BookKnowledge[];
  /** Vermutet die Gruppe – mit Stand, für die Spielleitung. */
  guesses: Guess[];
  /** Nur du: das Geheimnis des Eintrags … */
  secret: string;
  /** … ob er verflucht ist … */
  cursed: boolean;
  /** … und die geheimen Zeilen der Chronik, älteste zuerst. */
  secretLines: ChronicleEntry[];
  secretCount: number;
  /** In keiner der drei Schichten steht etwas. */
  empty: boolean;
}

/** Die drei Schichten des Wissens zu einem Eintrag der Welt: weiß, vermutet, nur du. */
export function knowledgeOf(
  data: CampaignData,
  entityId: string,
  limit = LINES_PER_THING,
): Knowledge {
  const entity = data.entities[entityId];
  const lines = chronicleFor(data, entityId);
  const known = lines.filter((entry) => isKnownLine(data, entry));
  const secret = lines.filter((entry) => entry.secret);
  const guesses = guessesAbout(data, entityId);
  const secretText = entity?.secret.trim() ?? '';
  const books = booksAbout(data, entityId);
  const magic = playerMagicLine(entity);
  const cursed = magicOf(entity)?.cursed ?? false;
  return {
    inBook:
      bookIds(data).has(entityId) ||
      (entity?.kind === 'place' && knownPlaceIds(data).has(entityId)) ||
      books.length > 0,
    known: known.slice(-limit),
    knownCount: known.length,
    magic,
    books,
    guesses,
    secret: secretText,
    cursed,
    secretLines: secret.slice(-limit),
    secretCount: secret.length,
    empty:
      !known.length &&
      !books.length &&
      !guesses.length &&
      !secret.length &&
      !secretText &&
      !magic &&
      !cursed,
  };
}
