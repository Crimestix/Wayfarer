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
import { findRelation, personPlace, placeAncestors } from './derive';
import { attitudeLabel } from './relations';
import { formatDuration } from './time/calendar';
import {
  PARTY_ID,
  type CampaignData,
  type Character,
  type Clock,
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
> &
  Partial<Pick<CampaignData, 'articles'>>;

/**
 * Die Artikel, die es noch gibt – jeder einmal; in der Sicht der Gruppe ohne verborgene. Ohne
 * Artikel im Spielstand (Teile von Tests) keiner.
 */
export function articlesIn(
  data: Partial<Pick<CampaignData, 'articles'>>,
  ids: readonly string[],
  party = false,
): string[] {
  const articles = data.articles;
  if (!articles) return [];
  return [...new Set(ids)].filter((id) => {
    const article = articles[id];
    return article !== undefined && !article.template && !(party && article.hidden);
  });
}

const unique = (ids: readonly (string | null | undefined)[], data: StoryData): string[] => [
  ...new Set(ids.filter((id): id is string => !!id && data.entities[id] !== undefined)),
];

/** Ein loser Faden: Er gehört zu keiner Geschichte – oder zu einer, die es nicht mehr gibt. */
export const isLooseThread = (
  data: Pick<CampaignData, 'stories'>,
  thread: Pick<Thread, 'storyId'>,
): boolean => !(thread.storyId && data.stories[thread.storyId]);

/**
 * Liegt ein loser Faden als Karte auf dem Brett? Nur, wenn der Spielleiter ihn hingelegt hat
 * (`thread.onBoard` – oder er hat dort aus früheren Ständen eine Stelle) oder wenn er im Spiel
 * ist. Alle anderen stehen in der Liste „Lose Fäden“ (`domain/looseThreads.ts`).
 */
export const threadOnBoard = (
  data: Pick<CampaignData, 'state'>,
  thread: Pick<Thread, 'id' | 'inPlay' | 'onBoard'>,
): boolean =>
  thread.inPlay || thread.onBoard || data.state.board[`thread:${thread.id}`] !== undefined;

/** Woran ein Faden hängt: seine Personen, Orte und Fraktionen – und wo seine Hinweise liegen. */
export function threadNodes(data: StoryData, thread: Pick<Thread, 'refs' | 'hints'>): string[] {
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
 * ihre Einstiege und Szenen liegen – und alles, woran ihre Fäden hängen.
 */
export function storyNodes(
  data: StoryData,
  story: Story,
  /** Fäden, deren Namen hier nicht mitzählen – sie hängen auf dem Brett an ihrem eigenen Knoten. */
  skip?: ReadonlySet<string>,
): string[] {
  const clock = story.clockId ? data.clocks[story.clockId] : undefined;
  return unique(
    [
      story.ownerId,
      ...story.refs,
      // Gefährten, die sie persönlich betrifft, hängen an ihr wie ihre Leute.
      ...story.heroes.map((hero) => hero.characterId),
      clock?.ownerId,
      clock?.placeId,
      ...(clock?.refs ?? []),
      ...story.entries.map((entry) => entry.placeId),
      ...story.scenes.map((scene) => scene.placeId),
      ...threadsOf(data, story.id)
        .filter((thread) => !skip?.has(thread.id))
        .flatMap((thread) => threadNodes(data, thread)),
    ],
    data,
  );
}

/**
 * Worüber ein Name an einer Karte hängt – in Worten, für das Menü an der Schnur: „Beteiligte“,
 * „Antreiber“, „Uhr“, „Hinweis „…“ (Wo?)“ … `cardKey` ist `story:<id>`, `thread:<id>` oder
 * `knot:<id>`; bei einer Geschichte zählen ihre Fäden mit, außer denen in `skip` (Knoten).
 */
export function nameSources(
  data: StoryData,
  cardKey: string,
  entityId: string,
  skip: ReadonlySet<string> = new Set(),
): string[] {
  const out: string[] = [];
  const ofThread = (thread: Thread, own: boolean) => {
    if (thread.refs.includes(entityId))
      out.push(own ? 'hängt am Faden' : `Faden „${thread.title}“`);
    for (const hint of thread.hints) {
      if (hint.placeId === entityId) out.push(`Hinweis „${hint.text}“ (Wo?)`);
      if (hint.sourceId === entityId) out.push(`Hinweis „${hint.text}“ (Wer weiß es?)`);
    }
  };
  const threadId =
    cardKey.startsWith('knot:') || cardKey.startsWith('thread:')
      ? cardKey.slice(cardKey.indexOf(':') + 1)
      : null;
  if (threadId) {
    const thread = data.threads[threadId];
    if (thread) ofThread(thread, true);
    return out;
  }
  const story = data.stories[cardKey.slice(6)];
  if (!story) return out;
  if (story.ownerId === entityId) out.push('Antreiber');
  if (story.refs.includes(entityId)) out.push('Beteiligte');
  if (story.heroes.some((hero) => hero.characterId === entityId)) out.push('betrifft persönlich');
  const clock = story.clockId ? data.clocks[story.clockId] : undefined;
  if (
    clock &&
    (clock.ownerId === entityId || clock.placeId === entityId || clock.refs.includes(entityId))
  )
    out.push('Uhr');
  for (const entry of story.entries)
    if (entry.placeId === entityId) out.push(`Einstieg „${entry.text}“`);
  for (const scene of story.scenes)
    if (scene.placeId === entityId) out.push(`Szene „${scene.text || 'ohne Namen'}“`);
  for (const thread of threadsOf(data, story.id)) if (!skip.has(thread.id)) ofThread(thread, false);
  return out;
}

/**
 * Was auf dem Blatt einer Geschichte geschrieben steht – jedes Feld für sich: was der Antreiber
 * will und was ihm fehlt, was auf dem Spiel steht, die Schritte ihrer Uhr und woran man sie
 * merkt, was die Beteiligten wollen, Fragen mit Antwort und Hinweisen, Einstiege, Szenen, Ende,
 * Belohnung, Merkzettel. Daraus liest `writtenNames`, wer im Text genannt ist.
 */
export function storyTexts(data: StoryData, story: Story): string[] {
  const clock = story.clockId ? data.clocks[story.clockId] : undefined;
  return [
    story.text,
    story.summary,
    story.needs,
    story.stakes,
    ...(clock?.steps ?? []).flatMap((step) => [step.text, step.sign]),
    ...Object.values(story.roles).map((role) => role.wants),
    ...threadsOf(data, story.id).flatMap((thread) => [
      thread.title,
      thread.truth,
      ...thread.hints.map((hint) => hint.text),
    ]),
    ...story.entries.map((entry) => entry.text),
    ...story.scenes.map((scene) => scene.text),
    ...story.heroes.map((hero) => hero.why),
    story.ending,
    story.reward,
    story.memo,
  ].filter((text) => text.trim() !== '');
}

/** Wer auf dem Blatt schon dazugehört: alles, woran die Geschichte hängt (`storyNodes`). */
export const storyAttached = storyNodes;

/** Wo etwas ist: ein Ort selbst, eine Person dort, wo sie sich aufhält oder wohnt. */
export function whereOf(data: StoryData, id: string): string | null {
  const entity = data.entities[id];
  if (!entity) return null;
  if (entity.kind === 'place') return entity.id;
  if (entity.kind === 'person') return personPlace(data, entity) ?? entity.person.homeId ?? null;
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
export type StoryPace = 'running' | 'paused' | 'blocked' | 'done' | 'none';

export const PACE_LABEL: Record<StoryPace, string> = {
  running: 'läuft',
  paused: 'ruht',
  blocked: 'blockiert',
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
  return {
    pace: view.done ? 'done' : view.blocked ? 'blocked' : view.paused ? 'paused' : 'running',
    view,
  };
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
  /** Artikel des Wikis, die an der Karte hängen (an der Geschichte und an ihren Fäden). */
  articles: string[];
  nearness: Nearness;
  pace: StoryPace;
  clock: ClockView | null;
  /** Abgeschlossen: Die Geschichte ist zu Ende, der lose Faden gelöst oder verloren. */
  closed: boolean;
  /**
   * Liegt auf dem Brett. Eine Geschichte immer; ein loser Faden nur, wenn der Spielleiter ihn
   * hingelegt hat oder er im Spiel ist (`threadOnBoard`) – sonst steht er in der Liste daneben.
   */
  onBoard: boolean;
  /**
   * Die große Geschichte, zu der diese gehört – null, wenn sie für sich steht. In der Sicht der
   * Gruppe nur, wenn sie von der großen weiß: Sonst verriete die Marke deren Namen.
   */
  partOf: Story | null;
  /** Wie viele Teilgeschichten diese hat (in der Sicht der Gruppe: die sie kennt). */
  parts: number;
}

/**
 * Liegt eine Geschichte gerade nicht auf dem Brett, weil eine große Geschichte über ihr ihre Teile
 * eingeklappt hat? Ein Kreis bricht ab.
 */
export function foldedAway(data: Pick<CampaignData, 'stories'>, story: Story): boolean {
  const seen = new Set([story.id]);
  let current = story.parentId ? data.stories[story.parentId] : undefined;
  while (current && !seen.has(current.id)) {
    if (current.partsFolded) return true;
    seen.add(current.id);
    current = current.parentId ? data.stories[current.parentId] : undefined;
  }
  return false;
}

/** `truth` = alles, was der Spielleiter weiß; `party` = nur, was die Gruppe kennt. */
export type BoardView = 'truth' | 'party';

const NEAR_ORDER: Nearness[] = ['here', 'reachable', 'far'];

/**
 * Die Karten des Fadenbretts – das Nahe zuerst, Abgeschlossenes zuletzt. In der Sicht der Gruppe
 * bleiben nur die Fäden, die sie kennt; eine Geschichte, von der sie nichts weiß, zerfällt in
 * ihre bekannten Fäden, und Hinweise, die sie nicht hat, zählen nicht mit. Lose Fäden sind alle
 * dabei (der Spieltisch braucht sie); welche davon auf dem Brett liegen, sagt `card.onBoard`.
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
    const parent = story.parentId ? data.stories[story.parentId] : undefined;
    cards.push({
      key: `story:${story.id}`,
      story,
      threads: shown,
      title: story.title,
      nodes,
      articles: articlesIn(
        data,
        [...(party ? [] : story.articleIds), ...shown.flatMap((thread) => thread.articleIds)],
        party,
      ),
      nearness: nearness(data, nodes),
      // Wie weit die Uhr ist, weiß die Gruppe nur, wenn die Uhr nicht geheim ist.
      pace: party && clock?.clock.secret ? 'none' : pace,
      clock: party && clock?.clock.secret ? null : clock,
      closed: story.closed,
      // Eingeklappt unter einer großen Geschichte: Sie zählt dort nur mit.
      onBoard: !foldedAway(data, story),
      partOf: parent && (!party || parent.known) ? parent : null,
      parts: Object.values(data.stories).filter(
        (part) => part.parentId === story.id && part.id !== story.id && (!party || part.known),
      ).length,
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
      articles: articlesIn(data, thread.articleIds, party),
      nearness: nearness(data, nodes),
      pace: 'none',
      clock: null,
      closed: !threadLive(thread),
      // Die Frage einer Geschichte, von der die Gruppe nichts weiß, liegt für sie auf dem Brett.
      onBoard: !isLooseThread(data, thread) || threadOnBoard(data, thread),
      partOf: null,
      parts: 0,
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

export interface HeroTie {
  story: Story;
  /** Der eigene Grund des Gefährten. */
  why: string;
}

/** Die Gefährten, die eine Geschichte persönlich betrifft – ohne gelöschte. */
export function heroesOf(
  data: Pick<CampaignData, 'entities'>,
  story: Story,
): { hero: Story['heroes'][number]; character: Character }[] {
  return story.heroes.flatMap((hero) => {
    const character = data.entities[hero.characterId];
    return character?.kind === 'character' ? [{ hero, character }] : [];
  });
}

/**
 * Die Geschichten, die einen Gefährten persönlich betreffen – die im Spiel zuerst. Zu Ende
 * Erzähltes zählt nicht mehr.
 */
export function storiesOfHero(data: Pick<CampaignData, 'stories'>, characterId: string): HeroTie[] {
  return Object.values(data.stories)
    .filter((story) => !story.closed)
    .flatMap((story) => {
      const hero = story.heroes.find((entry) => entry.characterId === characterId);
      return hero ? [{ story, why: hero.why }] : [];
    })
    .sort(
      (a, b) =>
        Number(b.story.inPlay) - Number(a.story.inPlay) ||
        a.story.title.localeCompare(b.story.title, 'de'),
    );
}

/** Die Geschichte, zu der eine Uhr gehört – null, wenn sie (noch) für sich steht. */
export function storyOfClock(data: Pick<CampaignData, 'stories'>, clockId: string): Story | null {
  return Object.values(data.stories).find((story) => story.clockId === clockId) ?? null;
}

/** Uhren, die zu keiner Geschichte gehören – aus der Zeit, als sie im Kalender angelegt wurden. */
export function looseClocks(data: Pick<CampaignData, 'stories' | 'clocks'>): Clock[] {
  const owned = new Set(Object.values(data.stories).map((story) => story.clockId));
  return Object.values(data.clocks)
    .filter((clock) => !owned.has(clock.id))
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
}

// ── Stand und Rat zu einer Geschichte ──────────────────────────────────────

/** So viele Hinweise sollten zu jeder Frage führen: Einen übersieht die Gruppe, einen versteht sie falsch. */
export const HINTS_WANTED = 3;

/** Die Fächer des Blatts, von oben nach unten – in dieser Reihenfolge steht auch der Rat. */
export const STORY_SECTIONS = [
  'who',
  'needs',
  'clock',
  'stakes',
  'cast',
  'heroes',
  'entries',
  'threads',
  'places',
  'scenes',
  'ending',
  'memo',
] as const;
export type StorySection = (typeof STORY_SECTIONS)[number];

/**
 * Wie weit eine Geschichte ist – ein Stand, keine Zahl. Keim: jemand will etwas, und es gibt
 * einen nächsten Schritt. Spielbar: dazu ein Einstieg, ein Ort, eine Frage mit drei Hinweisen,
 * eine Szene. Rund: der Rest.
 */
export type StoryStage = 'seed' | 'playable' | 'round';

export const STAGE_LABEL: Record<StoryStage, string> = {
  seed: 'Keim',
  playable: 'Spielbar',
  round: 'Rund',
};

export interface StoryAdvice {
  key: string;
  /** Das ist geschrieben. */
  done: boolean;
  /** Abgewählt („brauche ich nicht“): Es zählt nicht mehr als offen. */
  off: boolean;
  /** Was es ist: „Was auf dem Spiel steht“. */
  text: string;
  /** Die Leitfrage dazu – oder was genau noch fehlt. Beschreibt die Form, nie einen Inhalt. */
  why: string;
  /** Das Fach des Blatts, in dem es geschrieben wird. */
  section: StorySection;
  /** Für welchen Stand es zählt: Was zum Keim gehört, was zum Spielen, was sie rund macht. */
  stage: StoryStage;
  /** Die Frage, deren Hinweise gemeint sind – dorthin führt der Punkt auf dem Blatt. */
  threadId?: string | undefined;
}

const written = (hints: readonly ThreadHint[]) => hints.filter((hint) => hint.text.trim()).length;

/**
 * Was eine Geschichte braucht, damit sie am Tisch trägt – als Rat, nie als Pflicht, in der
 * Reihenfolge der Fächer des Blatts: wer was will und was ihm fehlt, ein nächster Schritt, was
 * auf dem Spiel steht, wen es persönlich betrifft, wie die Gruppe hineinkommt, welche Fragen sie
 * stellt (mit genug Hinweisen), wo sie spielt, was bereitliegt und wie sie enden kann. Jeder
 * Punkt lässt sich abwählen (`story.adviceOff`). Wayfarer schreibt nichts davon; es zeigt nur,
 * was noch leer ist.
 */
export function storyAdvice(data: StoryData, story: Story): StoryAdvice[] {
  const clock = story.clockId ? data.clocks[story.clockId] : undefined;
  const steps = clock?.steps.filter((step) => step.text.trim()).length ?? 0;
  const all = threadsOf(data, story.id);
  const threads = all.filter(threadLive);
  // Die Frage, die am weitesten ist, trägt den Punkt „Eine Frage mit drei Hinweisen“.
  const byHints = [...threads].sort((a, b) => written(b.hints) - written(a.hints));
  const lead = byHints[0];
  const full = lead !== undefined && written(lead.hints) >= HINTS_WANTED;
  const thin = byHints.filter(
    (thread) => written(thread.hints) < HINTS_WANTED && (full || thread !== lead),
  );
  const entries = story.entries.filter((entry) => entry.text.trim()).length;
  const scenes = story.scenes.filter((scene) => scene.text.trim() || scene.encounterId).length;
  const placed = storyNodes(data, story).some((id) => whereOf(data, id) !== null);
  const few = (count: number) =>
    count === 0 ? 'Noch keiner.' : count === 1 ? 'Erst einer.' : 'Erst zwei.';
  const off = new Set(story.adviceOff);
  const advice: Omit<StoryAdvice, 'off'>[] = [
    {
      key: 'owner',
      done: story.ownerId !== null && data.entities[story.ownerId] !== undefined,
      text: 'Wer sie antreibt',
      why: 'Jemand mit einem Ziel. Sein Ruf bei der Gruppe zählt für die Einstiege.',
      section: 'who',
      stage: 'seed',
    },
    {
      key: 'goal',
      done: story.summary.trim() !== '',
      text: 'Was er will',
      why: 'In einem Satz, aus seiner Sicht.',
      section: 'who',
      stage: 'seed',
    },
    {
      key: 'needs',
      done: story.needs.trim() !== '',
      text: 'Was ihm noch fehlt',
      why: 'Was braucht er noch, bevor er am Ziel ist? Jede Hürde ist ein Schritt.',
      section: 'needs',
      stage: 'round',
    },
    {
      key: 'clock',
      done: steps > 0,
      text: 'Ein nächster Schritt',
      why:
        steps === 0
          ? 'Was geschieht als Nächstes, wenn niemand eingreift? Einer reicht.'
          : steps === 1
            ? 'Ein Schritt steht – das reicht.'
            : `${steps} Schritte stehen.`,
      section: 'clock',
      stage: 'seed',
    },
    {
      key: 'stakes',
      done: story.stakes.trim() !== '',
      text: 'Was auf dem Spiel steht',
      why: 'Ein bis drei offene Fragen, deren Antwort du dem Spiel überlässt.',
      section: 'stakes',
      stage: 'round',
    },
    {
      key: 'hero',
      done: heroesOf(data, story).length > 0,
      text: 'Ein Gefährte hat einen eigenen Grund',
      why: 'Warum mischt sich gerade er ein? Dann ist es mehr als ein Auftrag.',
      section: 'heroes',
      stage: 'round',
    },
    {
      key: 'entry',
      done: entries > 0,
      text: 'Ein Einstieg',
      why:
        entries > 1
          ? `${entries} Wege hinein.`
          : 'Wo und wie stößt die Gruppe darauf? Zwei an verschiedenen Orten sind sicherer als einer.',
      section: 'entries',
      stage: 'playable',
    },
    {
      key: 'threads',
      // Sind alle Fragen beantwortet oder verloren, ist hier nichts mehr zu schreiben.
      done: full || (threads.length === 0 && all.length > 0),
      text: 'Eine Frage mit drei Hinweisen',
      why: !lead
        ? 'Was soll die Gruppe herausfinden – und was steckt dahinter?'
        : full
          ? 'Einen Hinweis übersieht die Gruppe, einen versteht sie falsch – der dritte trägt.'
          : `Hinweise zu „${lead.title}“: ${few(written(lead.hints))} Einen übersieht die Gruppe, einen versteht sie falsch.`,
      section: 'threads',
      stage: 'playable',
      threadId: lead && !full ? lead.id : undefined,
    },
    ...thin.map((thread): Omit<StoryAdvice, 'off'> => ({
      key: `hints:${thread.id}`,
      done: false,
      text: `Drei Hinweise zu „${thread.title}“`,
      why: `${few(written(thread.hints))} Einen übersieht die Gruppe, einen versteht sie falsch.`,
      section: 'threads',
      stage: 'round',
      threadId: thread.id,
    })),
    {
      key: 'place',
      done: placed,
      text: 'Ein Ort',
      why: 'Wo spielt sie? Über ihre Orte erkennt Wayfarer, wie nah die Gruppe dran ist.',
      section: 'places',
      stage: 'playable',
    },
    {
      key: 'scene',
      done: scenes > 0,
      text: 'Eine Szene',
      why: 'Was liegt bereit, wenn die Gruppe hingeht?',
      section: 'scenes',
      stage: 'playable',
    },
    {
      key: 'ending',
      done: story.ending.trim() !== '',
      text: 'Wie es enden kann',
      why: 'Zwei, drei mögliche Enden – offen, nicht der Weg dorthin.',
      section: 'ending',
      stage: 'round',
    },
    {
      key: 'reward',
      done: story.reward.trim() !== '',
      text: 'Was die Gruppe davon hat',
      why: 'Beute, ein Gefallen, ein Verbündeter, Wissen.',
      section: 'ending',
      stage: 'round',
    },
  ];
  return advice.map((entry) => ({ ...entry, off: off.has(entry.key) }));
}

/** Mehr als so viele Dinge nennt der Stand nie auf einmal. */
export const STAGE_NEXT = 3;

export interface StoryStageView {
  stage: StoryStage;
  /** Die ein bis drei Dinge, die zum nächsten Stand fehlen – leer, wenn sie rund ist. */
  next: StoryAdvice[];
}

/**
 * Der Stand einer Geschichte: Keim, bis sie spielbar ist; spielbar, bis sie rund ist. Dazu, was
 * als Nächstes fehlt – erst, was zum Keim gehört (wer, was er will, ein nächster Schritt), dann,
 * was sie spielbar macht. Abgewähltes fehlt nicht. Ein Rat, nie eine Schuld.
 */
export function storyStage(
  data: StoryData,
  story: Story,
  advice: readonly StoryAdvice[] = storyAdvice(data, story),
): StoryStageView {
  const open = advice.filter((entry) => !entry.done && !entry.off);
  const of = (stage: StoryStage) => open.filter((entry) => entry.stage === stage);
  const [seed, playable, round] = [of('seed'), of('playable'), of('round')];
  const stage: StoryStage =
    seed.length || playable.length ? 'seed' : round.length ? 'playable' : 'round';
  const next = seed.length ? seed : playable.length ? playable : round;
  return { stage, next: next.slice(0, STAGE_NEXT) };
}

// ── Das Brett als Pinnwand ─────────────────────────────────────────────────

export interface Spot {
  x: number;
  y: number;
}

/** Ein Name auf dem Brett: eine Person, ein Ort, eine Fraktion – oder ein Artikel des Wikis. */
export interface BoardPin {
  /** `node:<id>` oder `article:<id>` – unter diesem Schlüssel merkt sich das Brett seine Stelle. */
  key: string;
  /** Der Eintrag der Welt – bei einem Artikel (`article`) der Artikel. */
  id: string;
  article: boolean;
  x: number;
  y: number;
  /** Die Karten, die an ihm hängen. Mehr als eine: Dort berühren sich Geschichten. Leer: frei hingelegt. */
  cards: string[];
}

export interface BoardLayout {
  /** Je Karte die Stelle: Mitte ihrer Oberkante. */
  cards: Record<string, Spot>;
  /** Je Faden als Knoten (`knot:<id>`) die Stelle: sein Kreis links, auf halber Höhe. */
  knots: Record<string, Spot>;
  pins: BoardPin[];
}

/** Ein Faden als Knoten an seiner Geschichte – was das Auslegen von ihm wissen muss. */
export interface KnotToLay {
  key: string;
  cardKey: string;
  nodes: readonly string[];
  /** Artikel, die an diesem Faden hängen. */
  articles?: readonly string[];
}

/** Breite und ungefähre Höhe einer Karte auf dem Brett. */
export const BOARD_CARD = { width: 250, height: 170 } as const;
/** Platz, den ein Name auf dem Brett braucht. */
export const BOARD_PIN = { width: 150, height: 34 } as const;
/** Platz, den ein Faden als Knoten braucht – und der Abstand der Knoten untereinander. */
export const BOARD_KNOT = { width: 210, height: 30, step: 40 } as const;
const CELL = { width: 440, height: 380 } as const;
const PER_ROW = 3;
/** Teilgeschichten: so viele nebeneinander unter ihrer großen, so weit auseinander. */
const PARTS_PER_ROW = 3;
const PART_STEP = 280;
const PINS_PER_ROW = 2;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlaps = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

/** Teilgeschichten liegen bei ihrer großen: in der Reihe gleich hinter ihr. */
function withParts(cards: readonly BoardCard[]): BoardCard[] {
  const byKey = new Map(cards.map((card) => [card.key, card]));
  const parentOf = (card: BoardCard) =>
    card.story?.parentId ? byKey.get(`story:${card.story.parentId}`) : undefined;
  const out: BoardCard[] = [];
  const seen = new Set<string>();
  const add = (card: BoardCard) => {
    if (seen.has(card.key)) return;
    seen.add(card.key);
    out.push(card);
    for (const part of cards) if (parentOf(part) === card) add(part);
  };
  for (const card of cards) if (!parentOf(card)) add(card);
  // Ein Kreis (A Teil von B, B Teil von A) dürfte nie entstehen – verloren geht trotzdem nichts.
  for (const card of cards) add(card);
  return out;
}

/**
 * Wo alles auf dem Brett liegt: Was der Spielleiter hingelegt hat (`placed`), bleibt dort; alles
 * andere legt Wayfarer aus – die Karten in Reihen (das Nahe zuerst, Teilgeschichten bei ihrer
 * großen), die Namen einer Karte darunter, und ein Name, an dem mehrere Karten hängen, zwischen
 * sie. Nichts liegt aufeinander. Abgeschlossenes liegt nicht auf dem Brett, und von den losen
 * Fäden nur, was der Spielleiter hingelegt hat oder was im Spiel ist (`card.onBoard`) – hinter
 * den Geschichten, damit ein Faden, der aufs Brett kommt, keine Geschichte verschiebt.
 */
export function boardLayout(
  cards: readonly BoardCard[],
  placed: Readonly<Record<string, Spot>> = {},
  /** Fäden als Knoten (`boardWeb` in `domain/threadWeb.ts`): Sie hängen unter ihrer Karte. */
  knotsToLay: readonly KnotToLay[] = [],
  /** Frei hingelegte Namen und Artikel (`node:<id>`, `article:<id>`), die es noch gibt. */
  free: readonly string[] = [],
): BoardLayout {
  const lying = cards.filter((card) => !card.closed && card.onBoard);
  const open = withParts([
    ...lying.filter((card) => card.story),
    ...lying.filter((card) => !card.story),
  ]);
  const knotsOf = new Map<string, KnotToLay[]>();
  for (const knot of knotsToLay)
    knotsOf.set(knot.cardKey, [...(knotsOf.get(knot.cardKey) ?? []), knot]);
  const knotRoom = (key: string) => (knotsOf.get(key)?.length ?? 0) * BOARD_KNOT.step;

  // Teilgeschichten liegen unter ihrer großen Geschichte, nicht in der Reihe neben ihr.
  const lyingKeys = new Set(open.map((card) => card.key));
  const parentOf = (card: BoardCard): string | null => {
    const parent = card.story?.parentId ? `story:${card.story.parentId}` : null;
    return parent && parent !== card.key && lyingKeys.has(parent) ? parent : null;
  };
  const childrenOf = new Map<string, BoardCard[]>();
  for (const card of open) {
    const parent = parentOf(card);
    if (parent) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), card]);
  }
  /** Wie viele Reihen die Teile unter einer Karte brauchen (mit ihren eigenen Teilen). */
  const rowsBelow = (key: string, seen: ReadonlySet<string> = new Set()): number => {
    const parts = (childrenOf.get(key) ?? []).filter((card) => !seen.has(card.key));
    if (!parts.length) return 0;
    const next = new Set([...seen, key]);
    return (
      Math.ceil(parts.length / PARTS_PER_ROW) +
      Math.max(0, ...parts.map((card) => rowsBelow(card.key, next)))
    );
  };
  // Ein Teil, dessen große Geschichte nicht daliegt (oder ein Kreis), liegt wie jede andere.
  const top = open.filter((card) => !parentOf(card) || !reachesTop(card));
  function reachesTop(card: BoardCard): boolean {
    const seen = new Set<string>();
    let current: string | null = card.key;
    while (current) {
      if (seen.has(current)) return false;
      seen.add(current);
      const entry = open.find((other) => other.key === current);
      current = entry ? parentOf(entry) : null;
    }
    return true;
  }

  // Eine Reihe ist so hoch, wie ihre längste Liste von Knoten und ihre Teile es verlangen.
  const rowTop: number[] = [0];
  for (let row = 0; row * PER_ROW < top.length; row++) {
    const inRow = top.slice(row * PER_ROW, row * PER_ROW + PER_ROW);
    const most = Math.max(0, ...inRow.map((card) => knotRoom(card.key)));
    const deepest = Math.max(0, ...inRow.map((card) => rowsBelow(card.key)));
    rowTop.push(rowTop[row]! + CELL.height + most + deepest * CELL.height);
  }
  const spots: Record<string, Spot> = {};
  top.forEach((card, index) => {
    spots[card.key] = placed[card.key] ?? {
      x: (index % PER_ROW) * CELL.width,
      y: rowTop[Math.floor(index / PER_ROW)]!,
    };
  });
  /** Legt die Teile einer Karte in Reihen zu höchstens drei darunter – und deren Teile darunter. */
  const layParts = (key: string, seen: ReadonlySet<string>) => {
    const parent = spots[key];
    const parts = (childrenOf.get(key) ?? []).filter((card) => !seen.has(card.key));
    if (!parent) return;
    const next = new Set([...seen, key]);
    parts.forEach((card, index) => {
      const row = Math.floor(index / PARTS_PER_ROW);
      const inRow = Math.min(PARTS_PER_ROW, parts.length - row * PARTS_PER_ROW);
      const col = index % PARTS_PER_ROW;
      spots[card.key] = placed[card.key] ?? {
        x: parent.x + (col - (inRow - 1) / 2) * PART_STEP,
        y: parent.y + knotRoom(key) + CELL.height * (row + 1),
      };
    });
    for (const card of parts) layParts(card.key, next);
  };
  for (const card of top) layParts(card.key, new Set());
  // Die Karten sind Hindernisse – ihre Mitte liegt eine halbe Höhe unter der Oberkante.
  const taken: Box[] = open.map((card) => ({
    x: spots[card.key]!.x,
    y: spots[card.key]!.y + BOARD_CARD.height / 2,
    w: BOARD_CARD.width + 20,
    h: BOARD_CARD.height + 20,
  }));
  // Die Knoten einer Karte: untereinander gleich unter ihr – sie sind Hindernisse für die Namen.
  const knots: Record<string, Spot> = {};
  for (const [cardKey, list] of knotsOf) {
    const card = spots[cardKey];
    if (!card) continue;
    list.forEach((knot, index) => {
      knots[knot.key] = placed[knot.key] ?? {
        x: card.x,
        y: card.y + BOARD_CARD.height + 34 + index * BOARD_KNOT.step,
      };
      taken.push({
        x: knots[knot.key]!.x + BOARD_KNOT.width / 2,
        y: knots[knot.key]!.y,
        w: BOARD_KNOT.width + 10,
        h: BOARD_KNOT.height + 8,
      });
    });
  }
  const pinBox = (spot: Spot): Box => ({ ...spot, w: BOARD_PIN.width, h: BOARD_PIN.height });
  /** Rückt eine Stelle so lange nach unten, bis dort nichts liegt. */
  const settle = (spot: Spot): Spot => {
    const free = { ...spot };
    for (let tries = 0; tries < 60 && taken.some((box) => overlaps(pinBox(free), box)); tries++)
      free.y += BOARD_PIN.height + 6;
    return free;
  };

  /** Je Name (`node:<id>`) oder Artikel (`article:<id>`) die Karten und Knoten, die an ihm hängen. */
  const owners = new Map<string, string[]>();
  const own_ = (pinKey: string, owner: string) =>
    owners.set(pinKey, [...(owners.get(pinKey) ?? []), owner]);
  for (const card of open) {
    for (const id of card.nodes) own_(`node:${id}`, card.key);
    for (const id of card.articles) own_(`article:${id}`, card.key);
  }
  for (const knot of knotsToLay)
    if (knots[knot.key]) {
      for (const id of knot.nodes) own_(`node:${id}`, knot.key);
      for (const id of knot.articles ?? []) own_(`article:${id}`, knot.key);
    }
  // Was der Spielleiter frei hingelegt hat, liegt da, auch wenn noch nichts an ihm hängt.
  for (const key of free) if (placed[key] && !owners.has(key)) owners.set(key, []);
  /** Die Stelle, an der ein Name hängt: Oberkante einer Karte oder Mitte eines Knotens. */
  const anchor = (key: string): Spot => spots[key] ?? knots[key]!;
  const pins: BoardPin[] = [];
  const own = new Map<string, number>();
  const add = (key: string, keys: string[], wish: Spot) => {
    const spot = placed[key] ?? settle(wish);
    taken.push(pinBox(spot));
    const article = key.startsWith('article:');
    pins.push({ key, id: key.slice(key.indexOf(':') + 1), article, ...spot, cards: keys });
  };
  // Erst die Namen, die der Spielleiter hingelegt hat: Sie sind Hindernisse für die übrigen.
  for (const [id, keys] of owners) if (placed[id]) add(id, keys, placed[id]!);
  // Dann, was mehrere Karten verbindet – in ihre Mitte.
  for (const [id, keys] of owners) {
    if (placed[id] || keys.length < 2) continue;
    const at = keys.map(anchor);
    add(id, keys, {
      x: at.reduce((sum, spot) => sum + spot.x, 0) / at.length,
      y: at.reduce((sum, spot) => sum + spot.y, 0) / at.length + BOARD_CARD.height / 2,
    });
  }
  // Zuletzt die eigenen Namen jeder Karte: in Reihen unter ihr.
  for (const [id, keys] of owners) {
    if (placed[id] || keys.length !== 1) continue;
    const index = own.get(keys[0]!) ?? 0;
    own.set(keys[0]!, index + 1);
    const card = spots[keys[0]!];
    if (!card) {
      // Ein Name eines Knotens: gleich daneben, nach rechts.
      const knot = knots[keys[0]!]!;
      add(id, keys, {
        x: knot.x + BOARD_KNOT.width + 20 + BOARD_PIN.width / 2 + index * (BOARD_PIN.width + 6),
        y: knot.y,
      });
      continue;
    }
    add(id, keys, {
      x: card.x + ((index % PINS_PER_ROW) - (PINS_PER_ROW - 1) / 2) * (BOARD_PIN.width + 6),
      y:
        card.y + BOARD_CARD.height + 46 + Math.floor(index / PINS_PER_ROW) * (BOARD_PIN.height + 6),
    });
  }
  return { cards: spots, knots, pins };
}

/**
 * Was an einer Stelle des Bretts liegt – für eine frei gezogene Schnur: erst ein Name, dann ein
 * Knoten, dann eine Karte (was oben liegt, gewinnt). Null, wenn dort nichts ist.
 */
export function hitOnBoard(layout: BoardLayout, at: Spot): string | null {
  const within = (center: Spot, w: number, h: number) =>
    Math.abs(at.x - center.x) <= w / 2 && Math.abs(at.y - center.y) <= h / 2;
  const pin = layout.pins.find((entry) => within(entry, BOARD_PIN.width, BOARD_PIN.height + 6));
  if (pin) return pin.key;
  const knot = Object.entries(layout.knots).find(([, spot]) =>
    within(
      { x: spot.x + BOARD_KNOT.width / 2, y: spot.y },
      BOARD_KNOT.width,
      BOARD_KNOT.height + 6,
    ),
  );
  if (knot) return knot[0];
  const card = Object.entries(layout.cards).find(([, spot]) =>
    within({ x: spot.x, y: spot.y + BOARD_CARD.height / 2 }, BOARD_CARD.width, BOARD_CARD.height),
  );
  return card ? card[0] : null;
}

/**
 * Was in einem aufgezogenen Rahmen liegt (zwei Ecken, gleich in welcher Folge): Karten, Knoten
 * und Namen, deren Mitte darin ist – für die Auswahl mehrerer Stücke.
 */
export function insideOnBoard(layout: BoardLayout, a: Spot, b: Spot): string[] {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const inside = (spot: Spot) => spot.x >= x0 && spot.x <= x1 && spot.y >= y0 && spot.y <= y1;
  return [
    ...Object.entries(layout.cards)
      .filter(([, spot]) => inside({ x: spot.x, y: spot.y + BOARD_CARD.height / 2 }))
      .map(([key]) => key),
    ...Object.entries(layout.knots)
      .filter(([, spot]) => inside({ x: spot.x + BOARD_KNOT.width / 2, y: spot.y }))
      .map(([key]) => key),
    ...layout.pins.filter((pin) => inside(pin)).map((pin) => pin.key),
  ];
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
  // Was fällig ist, ist „jetzt“ fällig – nicht „in 0 Min.“.
  minutes <= 0
    ? 'jetzt'
    : `in ${formatDuration(minutes).replace(/ Tage$| Tage /, (found) => found.replace('Tage', 'Tagen'))}`;

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
