/**
 * „Im Spiel“: die Geschichten, die der Spielleiter gerade am Tisch haben will – mit allem, was an
 * ihnen hängt: der nächste Schritt ihrer Uhr, was am Ort der Gruppe bereitliegt (Hinweise,
 * Einstiege), wer von ihren Leuten hier ist, ihre Fäden, offene Abmachungen, kommende Termine und
 * was zuletzt zu ihnen notiert wurde. Welche Geschichten im Spiel sind, entscheidet der
 * Spielleiter (`story.inPlay`); Wayfarer sammelt nur, was dazugehört. Reine Funktionen.
 */
import { occurrencesOf, openPromises, type Occurrence } from './derive';
import type {
  CampaignData,
  ChronicleEntry,
  Entity,
  StoryEntry,
  Thread,
  ThreadHint,
} from './schema';
import { boardCards, entryFit, threadLive, threadWarning, whereOf, type BoardCard } from './story';
import { MINUTES_PER_DAY, startOfDay } from './time/calendar';
import { formatWayTime, routeBetween } from './ways';
import { isEveryday, isNear } from './weight';

export interface PlayThread {
  thread: Thread;
  /** Wie viele seiner Hinweise die Gruppe schon hat. */
  found: number;
  /** Warnung, wenn die Gruppe ihn nicht finden kann oder er an einem einzigen Hinweis hängt. */
  warning: string | null;
}

/** Eine Geschichte (oder ein loser Faden) im Spiel, mit allem, was an ihr hängt. */
export interface PlayCard {
  card: BoardCard;
  /** „hängt an diesem Ort“, „1 Tag entfernt“, „in der Nähe“, „weit weg“. */
  where: string;
  /** Hinweise, die die Gruppe noch nicht hat und die hier liegen oder von denen hier jemand weiß. */
  hints: { thread: Thread; hint: ThreadHint }[];
  /** Einstiege, die hier liegen – die passenden zuerst. */
  entries: { entry: StoryEntry; fits: boolean; note: string }[];
  /** Wer von den Leuten der Geschichte gerade am Ort der Gruppe ist. */
  present: Entity[];
  /** Die lebendigen Fäden. */
  threads: PlayThread[];
  /** Offene Abmachungen, die zu ihr gehören oder ihre Leute betreffen. */
  promises: ChronicleEntry[];
  /** Kommende Termine, die an ihren Fäden oder ihren Leuten hängen – je Termin das nächste Mal. */
  events: Occurrence[];
  /** Was zuletzt zu ihr notiert wurde, das Neueste zuerst. */
  notes: ChronicleEntry[];
  /** Der Merkzettel des Spielleiters – nur Geschichten haben einen. */
  memo: string;
}

export interface PlayView {
  cards: PlayCard[];
  /** Was den Ort der Gruppe berührt, aber nicht im Spiel ist – zum Hereinnehmen. */
  offered: BoardCard[];
}

/** So weit voraus zählt ein Termin zu dem, was ansteht. */
const AHEAD_DAYS = 30;
const NOTES_SHOWN = 3;
const EVENTS_SHOWN = 4;

const inPlay = (card: BoardCard): boolean =>
  !card.closed && (card.story ? card.story.inPlay : (card.threads[0]?.inPlay ?? false));

/** Wie weit die Gruppe von einer Karte weg ist, in Worten. */
function whereText(data: CampaignData, card: BoardCard): string {
  if (card.nearness === 'here') return 'hängt an diesem Ort';
  const party = data.state.placeId;
  if (!party) return '';
  const places = [
    ...new Set(card.nodes.map((id) => whereOf(data, id)).filter((id) => id !== null)),
  ];
  const minutes = places
    .map((id) => routeBetween(data, party, id))
    .filter((route) => route !== null && route.minutes > 0)
    .map((route) => route!.minutes);
  if (minutes.length) return `${formatWayTime(Math.min(...minutes))} entfernt`;
  return card.nearness === 'reachable' ? 'in der Nähe' : 'weit weg';
}

function playCard(data: CampaignData, card: BoardCard): PlayCard {
  const story = card.story;
  const here = (id: string | null): boolean => {
    const place = id ? whereOf(data, id) : null;
    return place !== null && isNear(data, place);
  };
  const nodes = new Set(card.nodes);
  /** Personen, Fraktionen, Dinge – ein gemeinsamer Ort allein macht noch keine Zugehörigkeit. */
  const people = card.nodes.filter((id) => data.entities[id]?.kind !== 'place');
  const threadIds = new Set(card.threads.map((thread) => thread.id));
  const now = data.state.now;
  const from = startOfDay(now);

  const events: Occurrence[] = [];
  for (const event of Object.values(data.events)) {
    if (event.done && !event.repeat) continue;
    const tied = event.threadId !== null && threadIds.has(event.threadId);
    if (!tied && (isEveryday(data, event) || !event.refs.some((id) => people.includes(id))))
      continue;
    const next = occurrencesOf(
      data.campaign.calendar,
      event,
      from,
      from + AHEAD_DAYS * MINUTES_PER_DAY,
    ).find((occurrence) => !event.timed || occurrence.at >= now);
    if (next) events.push(next);
  }
  events.sort((a, b) => a.at - b.at || a.event.title.localeCompare(b.event.title, 'de'));

  return {
    card,
    where: whereText(data, card),
    hints: card.threads
      .filter(threadLive)
      .flatMap((thread) =>
        thread.hints
          .filter((hint) => !hint.found && (here(hint.placeId) || here(hint.sourceId)))
          .map((hint) => ({ thread, hint })),
      ),
    entries: (story?.entries ?? [])
      .filter((entry) => here(entry.placeId))
      .map((entry) => ({ entry, ...entryFit(data, story!, entry) }))
      .sort((a, b) => Number(b.fits) - Number(a.fits)),
    present: card.nodes
      .map((id) => data.entities[id])
      .filter(
        (entity): entity is Entity =>
          !!entity &&
          ((entity.kind === 'person' &&
            entity.person.status !== 'dead' &&
            entity.person.status !== 'missing' &&
            isNear(data, entity.person.placeId)) ||
            (entity.kind === 'faction' && isNear(data, entity.faction.seatId))),
      ),
    threads: card.threads.filter(threadLive).map((thread) => ({
      thread,
      found: thread.hints.filter((hint) => hint.found).length,
      warning: threadWarning(thread),
    })),
    promises: openPromises(data).filter(
      (entry) =>
        (story !== null && entry.storyId === story.id) ||
        entry.refs.some((id) => people.includes(id) && nodes.has(id)),
    ),
    events: events.slice(0, EVENTS_SHOWN),
    notes: story
      ? Object.values(data.chronicle)
          .filter((entry) => entry.storyId === story.id && entry.kind !== 'promise')
          .sort((a, b) => b.at - a.at || b.created.localeCompare(a.created))
          .slice(0, NOTES_SHOWN)
      : [],
    memo: story?.memo ?? '',
  };
}

const NEAR_ORDER = ['here', 'reachable', 'far'] as const;

/**
 * Was am Spieltisch „im Spiel“ steht: die Geschichten und losen Fäden, die der Spielleiter
 * hereingenommen hat – was am Ort der Gruppe hängt zuerst, dann nach dem nächsten Schritt ihrer
 * Uhr. Dazu, was den Ort berührt und noch nicht im Spiel ist.
 */
export function playView(data: CampaignData): PlayView {
  const cards = boardCards(data);
  const next = (card: BoardCard) =>
    card.clock?.next && !card.clock.paused ? card.clock.next.at : Number.MAX_SAFE_INTEGER;
  return {
    cards: cards
      .filter(inPlay)
      .sort(
        (a, b) =>
          NEAR_ORDER.indexOf(a.nearness) - NEAR_ORDER.indexOf(b.nearness) ||
          next(a) - next(b) ||
          a.title.localeCompare(b.title, 'de'),
      )
      .map((card) => playCard(data, card)),
    offered: cards.filter((card) => !card.closed && !inPlay(card) && card.nearness === 'here'),
  };
}

/**
 * Was die Geschichten im Spiel schon zeigen – als Schlüssel `promise:<id>`, `event:<id>`,
 * `clock:<id>`. So steht unter „Sonst noch“ nichts ein zweites Mal.
 */
export function playClaims(view: PlayView): Set<string> {
  const claims = new Set<string>();
  for (const play of view.cards) {
    for (const entry of play.promises) claims.add(`promise:${entry.id}`);
    for (const occurrence of play.events) claims.add(`event:${occurrence.event.id}`);
    if (play.card.clock) claims.add(`clock:${play.card.clock.clock.id}`);
  }
  return claims;
}
