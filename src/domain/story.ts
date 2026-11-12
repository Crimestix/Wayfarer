/**
 * Geschichten und Fäden: Eine Geschichte ist ein Vorhaben, kein Plot – jemand treibt sie an, eine
 * Uhr sagt, was geschieht, wenn niemand eingreift. Ein Faden ist eine Frage, die sie stellt, oder
 * eine Spur, der die Gruppe folgen kann; an ihm hängen Hinweise.
 *
 * Geschrieben wird beides vom Spielleiter. Wayfarer leitet ab: woran eine Geschichte hängt, wie
 * nah die Gruppe ihr ist, wie weit ihre Uhr ist, wo zwei Geschichten sich berühren und welcher
 * Faden an einem einzigen Hinweis hängt. Reine Funktionen.
 */
import { clockView, type ClockView } from './clock';
import { findRelation, placeAncestors } from './derive';
import { attitudeLabel } from './relations';
import { formatDuration } from './time/calendar';
import {
  PARTY_ID,
  type CampaignData,
  type EntryStanding,
  type Story,
  type StoryEntry,
  type Thread,
  type ThreadHint,
  type ThreadState,
} from './schema';
import { routeBetween } from './ways';
import { isNear } from './weight';

export const THREAD_STATE_LABEL: Record<ThreadState, string> = {
  open: 'offen',
  active: 'aktiv',
  dormant: 'ruhend',
  solved: 'gelöst',
  lost: 'verloren',
};

export const THREAD_STATE_HINT: Record<ThreadState, string> = {
  open: 'Noch nicht aufgegriffen.',
  active: 'Die Gruppe ist dran.',
  dormant: 'Liegen gelassen – die Welt dreht sich weiter.',
  solved: 'Die Frage ist beantwortet.',
  lost: 'Die Spur ist kalt: Die Gruppe kann ihr nicht mehr folgen.',
};

/** Ein Faden, an dem noch etwas hängt: weder gelöst noch verloren. */
export const threadLive = (thread: Pick<Thread, 'state'>): boolean =>
  thread.state !== 'solved' && thread.state !== 'lost';

type StoryData = Pick<
  CampaignData,
  'entities' | 'state' | 'threads' | 'stories' | 'clocks' | 'paths' | 'maps' | 'relations'
>;

const unique = (ids: readonly (string | null | undefined)[], data: StoryData): string[] => [
  ...new Set(ids.filter((id): id is string => !!id && data.entities[id] !== undefined)),
];

/** Woran ein Faden hängt: seine Personen, Orte und Fraktionen – und wo seine Hinweise liegen. */
export function threadNodes(data: StoryData, thread: Thread): string[] {
  return unique(
    [...thread.refs, ...thread.hints.flatMap((hint) => [hint.placeId, hint.sourceId])],
    data,
  );
}

/** Die Fäden einer Geschichte – die lebendigen zuerst. */
export function threadsOf(data: StoryData, storyId: string | null): Thread[] {
  const order: ThreadState[] = ['active', 'open', 'dormant', 'solved', 'lost'];
  return Object.values(data.threads)
    .filter((thread) => thread.storyId === storyId)
    .sort(
      (a, b) =>
        order.indexOf(a.state) - order.indexOf(b.state) ||
        a.title.localeCompare(b.title, 'de') ||
        a.id.localeCompare(b.id),
    );
}

/**
 * Woran eine Geschichte hängt: wer sie antreibt, wer und was dazugehört, wo ihre Uhr spielt, wo
 * ihre Einstiege liegen – und alles, woran ihre Fäden hängen.
 */
export function storyNodes(data: StoryData, story: Story): string[] {
  const clock = story.clockId ? data.clocks[story.clockId] : undefined;
  return unique(
    [
      story.ownerId,
      ...story.refs,
      clock?.ownerId,
      clock?.placeId,
      ...(clock?.refs ?? []),
      ...story.entries.map((entry) => entry.placeId),
      ...threadsOf(data, story.id).flatMap((thread) => threadNodes(data, thread)),
    ],
    data,
  );
}

/** Wo etwas ist: ein Ort selbst, eine Person dort, wo sie sich aufhält oder wohnt. */
export function whereOf(data: StoryData, id: string): string | null {
  const entity = data.entities[id];
  if (!entity) return null;
  if (entity.kind === 'place') return entity.id;
  if (entity.kind === 'person') return entity.person.placeId ?? entity.person.homeId ?? null;
  return null;
}

/** hier = dort, wo die Gruppe ist; erreichbar = ein bekannter Weg führt hin oder es liegt nebenan. */
export type Nearness = 'here' | 'reachable' | 'far';

export const NEARNESS_LABEL: Record<Nearness, string> = {
  here: 'Hier',
  reachable: 'Erreichbar',
  far: 'Fern',
};

/**
 * Wie nah die Gruppe an etwas dran ist, das an diesen Knoten hängt: Liegt einer dort, wo sie
 * steht, ist es „hier“. Führt ein Weg des Wegenetzes hin oder liegt einer im selben Ort eine
 * Stufe höher (dieselbe Stadt, dieselbe Gegend), ist es „erreichbar“. Sonst – oder ohne Ort –
 * ist es fern.
 */
export function nearness(data: StoryData, nodes: readonly string[]): Nearness {
  const party = data.state.placeId;
  if (!party) return 'far';
  const places = [...new Set(nodes.map((id) => whereOf(data, id)).filter((id) => id !== null))];
  if (places.some((id) => isNear(data, id))) return 'here';
  const around = new Set(
    placeAncestors(data as CampaignData, party)
      .slice(0, 2)
      .map((place) => place.id),
  );
  const reachable = places.some(
    (id) =>
      placeAncestors(data as CampaignData, id).some((place) => around.has(place.id)) ||
      routeBetween(data, party, id) !== null,
  );
  return reachable ? 'reachable' : 'far';
}

/** läuft, ruht (angehalten), abgelaufen (alle Schritte geschehen) – oder die Geschichte hat keine Uhr. */
export type StoryPace = 'running' | 'paused' | 'done' | 'none';

export const PACE_LABEL: Record<StoryPace, string> = {
  running: 'läuft',
  paused: 'ruht',
  done: 'abgelaufen',
  none: 'ohne Uhr',
};

export function storyClock(
  data: StoryData,
  story: Story,
): { pace: StoryPace; view: ClockView | null } {
  const clock = story.clockId ? data.clocks[story.clockId] : undefined;
  if (!clock) return { pace: 'none', view: null };
  const view = clockView(clock, data.state.now);
  return { pace: view.done ? 'done' : view.paused ? 'paused' : 'running', view };
}

/**
 * Warnung zu einem Faden – null, wenn nichts zu sagen ist. Ein lebendiger Faden, von dem die
 * Gruppe noch nichts in der Hand hat, hängt an seinen Hinweisen: Gibt es keinen, kann sie ihn
 * nicht finden; gibt es nur einen, kann sie ihn verpassen.
 */
export function threadWarning(thread: Thread): string | null {
  if (!threadLive(thread)) return null;
  const found = thread.hints.filter((hint) => hint.found).length;
  const open = thread.hints.length - found;
  if (found > 0) return null;
  if (thread.hints.length === 0)
    return thread.known ? null : 'Kein Hinweis führt zu ihm: Die Gruppe kann ihn nicht finden.';
  if (open === 1) return 'Hängt an einem einzigen Hinweis – verpasst die Gruppe ihn, reißt er ab.';
  return null;
}

/** Eine Karte auf dem Fadenbrett: eine Geschichte mit ihren Fäden – oder ein loser Faden. */
export interface BoardCard {
  /** `story:…` oder `thread:…` */
  key: string;
  story: Story | null;
  /** Bei einer Geschichte ihre Fäden; bei einem losen Faden nur er. */
  threads: Thread[];
  title: string;
  nodes: string[];
  nearness: Nearness;
  pace: StoryPace;
  clock: ClockView | null;
  /** Abgeschlossen: Die Geschichte ist zu Ende, der lose Faden gelöst oder verloren. */
  closed: boolean;
}

/** `truth` = alles, was der Spielleiter weiß; `party` = nur, was die Gruppe kennt. */
export type BoardView = 'truth' | 'party';

const NEAR_ORDER: Nearness[] = ['here', 'reachable', 'far'];

/**
 * Die Karten des Fadenbretts – das Nahe zuerst, Abgeschlossenes zuletzt. In der Sicht der Gruppe
 * bleiben nur die Fäden, die sie kennt; eine Geschichte, von der sie nichts weiß, zerfällt in
 * ihre bekannten Fäden, und Hinweise, die sie nicht hat, zählen nicht mit.
 */
export function boardCards(data: StoryData, view: BoardView = 'truth'): BoardCard[] {
  const party = view === 'party';
  const seen = (thread: Thread): Thread =>
    party ? { ...thread, truth: '', hints: thread.hints.filter((hint) => hint.found) } : thread;
  const cards: BoardCard[] = [];
  const loose: Thread[] = [...threadsOf(data, null)];

  for (const story of Object.values(data.stories)) {
    const threads = threadsOf(data, story.id);
    if (party && !story.known) {
      loose.push(...threads);
      continue;
    }
    const shown = (party ? threads.filter((thread) => thread.known) : threads).map(seen);
    const nodes = party
      ? unique([...shown.flatMap((thread) => threadNodes(data, thread))], data)
      : storyNodes(data, story);
    const { pace, view: clock } = storyClock(data, story);
    cards.push({
      key: `story:${story.id}`,
      story,
      threads: shown,
      title: story.title,
      nodes,
      nearness: nearness(data, nodes),
      // Wie weit die Uhr ist, weiß die Gruppe nur, wenn die Uhr nicht geheim ist.
      pace: party && clock?.clock.secret ? 'none' : pace,
      clock: party && clock?.clock.secret ? null : clock,
      closed: story.closed,
    });
  }
  // Fäden, deren Geschichte es nicht mehr gibt, sind lose.
  for (const thread of Object.values(data.threads))
    if (thread.storyId && !data.stories[thread.storyId] && !loose.includes(thread))
      loose.push(thread);
  for (const thread of loose) {
    if (party && !thread.known) continue;
    const shown = seen(thread);
    const nodes = threadNodes(data, shown);
    cards.push({
      key: `thread:${thread.id}`,
      story: null,
      threads: [shown],
      title: thread.title,
      nodes,
      nearness: nearness(data, nodes),
      pace: 'none',
      clock: null,
      closed: !threadLive(thread),
    });
  }
  return cards.sort(
    (a, b) =>
      Number(a.closed) - Number(b.closed) ||
      NEAR_ORDER.indexOf(a.nearness) - NEAR_ORDER.indexOf(b.nearness) ||
      Number(b.story !== null) - Number(a.story !== null) ||
      a.title.localeCompare(b.title, 'de') ||
      a.key.localeCompare(b.key),
  );
}

/** Zwei Karten berühren sich: Sie hängen an denselben Personen, Orten oder Fraktionen. */
export interface Touch {
  a: string;
  b: string;
  /** Die gemeinsamen Knoten. */
  via: string[];
}

/** Wo Geschichten sich berühren – erkannt an gemeinsamen Knoten, nie von Hand gezogen. */
export function touches(cards: readonly BoardCard[]): Touch[] {
  const found: Touch[] = [];
  const live = cards.filter((card) => !card.closed);
  for (let i = 0; i < live.length; i++)
    for (let k = i + 1; k < live.length; k++) {
      const [a, b] = [live[i]!, live[k]!];
      const via = a.nodes.filter((id) => b.nodes.includes(id));
      if (via.length) found.push({ a: a.key, b: b.key, via });
    }
  return found;
}

/** „über den Hafen“, „über Mira und den Hafen“ – der Grund einer Berührung in Worten. */
export function touchReason(data: Pick<CampaignData, 'entities'>, touch: Touch): string {
  const names = touch.via.map((id) => data.entities[id]?.name ?? '?');
  if (names.length === 1) return `über ${names[0]}`;
  if (names.length === 2) return `über ${names[0]} und ${names[1]}`;
  return `über ${names[0]}, ${names[1]} und ${names.length - 2} weitere`;
}

/** „in 3 Tagen“, „in 5 Std.“ – wie lange es bis zu einem Schritt noch dauert. */
export const untilText = (minutes: number): string =>
  `in ${formatDuration(Math.max(0, minutes)).replace(/ Tage$| Tage /, (found) => found.replace('Tage', 'Tagen'))}`;

// ── Ruf ────────────────────────────────────────────────────────────────────

/**
 * Der Ruf bei jemandem – meist einer Fraktion: wie er zur Gruppe steht und, wo es abweicht oder
 * eigens festgehalten ist, zu einzelnen Gefährten. Das sind die Haltungen, die es schon gibt;
 * hier werden sie nur zusammen gelesen.
 */
export interface Repute {
  /** Haltung zur Gruppe (−5…5); null = nicht festgelegt. */
  party: number | null;
  /** Gefährten, zu denen eine eigene Haltung festgehalten ist. */
  members: { id: string; name: string; value: number }[];
}

export function reputeOf(data: StoryData, entityId: string): Repute {
  const full = data as CampaignData;
  const members: Repute['members'] = [];
  for (const entity of Object.values(data.entities)) {
    if (entity.kind !== 'character' || !entity.character.active) continue;
    const value = findRelation(full, entityId, entity.id)?.attitude ?? null;
    if (value !== null) members.push({ id: entity.id, name: entity.name, value });
  }
  members.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return { party: findRelation(full, entityId, PARTY_ID)?.attitude ?? null, members };
}

export const ENTRY_STANDING_LABEL: Record<EntryStanding, string> = {
  any: 'immer',
  good: 'bei gutem Ruf',
  bad: 'bei schlechtem Ruf',
};

/**
 * Passt ein Einstieg gerade? Ein Einstieg „bei gutem Ruf“ passt, wenn der Antreiber der
 * Geschichte der Gruppe oder einem Gefährten wohlgesinnt ist; einer „bei schlechtem Ruf“, wenn er
 * der Gruppe oder einem Gefährten übel will – dann wird etwa ein Gefährte am Tor erkannt. Der Ruf
 * ändert nicht die Geschichte, nur wie die Gruppe hineinkommt.
 */
export function entryFit(
  data: StoryData,
  story: Pick<Story, 'ownerId'>,
  entry: Pick<StoryEntry, 'standing'>,
): { fits: boolean; note: string } {
  if (entry.standing === 'any') return { fits: true, note: '' };
  const owner = story.ownerId ? data.entities[story.ownerId] : undefined;
  if (!owner) return { fits: false, note: 'Die Geschichte hat niemanden, der sie antreibt.' };
  const repute = reputeOf(data, owner.id);
  const good = entry.standing === 'good';
  const matches = (value: number) => (good ? value >= 1 : value <= -1);
  if (repute.party !== null && matches(repute.party))
    return {
      fits: true,
      note: `Haltung zur Gruppe: ${attitudeLabel(repute.party).toLowerCase()}.`,
    };
  const member = repute.members.find((entry) => matches(entry.value));
  if (member)
    return {
      fits: true,
      note: `Haltung zu ${member.name}: ${attitudeLabel(member.value).toLowerCase()}.`,
    };
  return {
    fits: false,
    note:
      repute.party === null && !repute.members.length
        ? `Der Ruf ist noch nicht festgelegt (${owner.name}).`
        : `Passt gerade nicht: Der Ruf ist ${good ? 'nicht gut' : 'nicht schlecht'} genug.`,
  };
}

// ── Am Spieltisch ──────────────────────────────────────────────────────────

/** Was eine Geschichte am Ort der Gruppe bereithält. */
export interface HereCard {
  card: BoardCard;
  /** Einstiege, die hier liegen – die passenden zuerst. */
  entries: { entry: StoryEntry; fits: boolean; note: string }[];
  /** Hinweise, die die Gruppe noch nicht hat und die hier liegen oder von denen hier jemand weiß. */
  hints: { thread: Thread; hint: ThreadHint }[];
}

/**
 * Die Geschichten und losen Fäden, die den Ort der Gruppe gerade berühren – mit dem, was hier
 * bereitliegt: Einstiege, Hinweise und wer hier etwas weiß.
 */
export function storiesHere(data: StoryData): HereCard[] {
  if (!data.state.placeId) return [];
  const here = (id: string | null): boolean => {
    const place = id ? whereOf(data, id) : null;
    return place !== null && isNear(data, place);
  };
  return boardCards(data)
    .filter((card) => !card.closed && card.nearness === 'here')
    .map((card) => ({
      card,
      entries: (card.story?.entries ?? [])
        .filter((entry) => here(entry.placeId))
        .map((entry) => ({ entry, ...entryFit(data, card.story!, entry) }))
        .sort((a, b) => Number(b.fits) - Number(a.fits)),
      hints: card.threads
        .filter(threadLive)
        .flatMap((thread) =>
          thread.hints
            .filter((hint) => !hint.found && (here(hint.placeId) || here(hint.sourceId)))
            .map((hint) => ({ thread, hint })),
        ),
    }));
}
