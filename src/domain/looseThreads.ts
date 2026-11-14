/**
 * Lose Fäden: Fäden, die zu keiner Geschichte gehören. Sie liegen nicht zwischen den Geschichten
 * auf dem Brett, sondern in einer Liste daneben – hier steht, was die Liste zeigt: woran jeder
 * hängt, woher er stammt, zu welcher Geschichte er passen könnte, wie nah er der Gruppe ist. Dazu
 * Fäden, die es wohl doppelt gibt, und die Reihung, in der Fäden überall zur Wahl stehen (was am
 * Ort der Gruppe hängt, zuerst). Alles abgeleitet, nichts gespeichert. Reine Funktionen.
 */
import { normalize } from './derive';
import type { CampaignData, Entity, Session, Story, Thread } from './schema';
import {
  boardCards,
  isLooseThread,
  storyNodes,
  threadLive,
  type BoardCard,
  type BoardView,
  type Nearness,
} from './story';
import { namesLine, sharedNames, sharedReason } from './storySheet';
import { formatDate } from './time/calendar';

// ── Gleiche Sätze ──────────────────────────────────────────────────────────

/** Wörter, die an einem Satz nichts ändern: Artikel und Füllwörter. */
const FILLERS = new Set(
  (
    'der die das den dem des ein eine einen einem einer eines ' +
    'noch immer weiterhin eigentlich wohl denn nun jetzt aktuell bloss schon wirklich genau ' +
    'überhaupt mal'
  ).split(' '),
);

/** Die Wörter eines Satzes, klein geschrieben, ohne Satzzeichen und Füllwörter. */
function keyWords(title: string): string[] {
  const words = title
    .normalize('NFC')
    .toLocaleLowerCase('de')
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const kept = words.filter((word) => !FILLERS.has(word));
  // Ein Satz nur aus Füllwörtern bleibt, wie er ist.
  return kept.length ? kept : words;
}

/**
 * Der Satz eines Fadens, vereinheitlicht: ohne Groß und Klein, Satzzeichen, Artikel und
 * Füllwörter. Zwei Fäden mit demselben Schlüssel sagen dasselbe.
 */
export const threadKey = (title: string): string => keyWords(title).join(' ');

/** Endungen, die aus einem Wort kein anderes machen: „Grotte“ – „Grotten“, „Brief“ – „Briefes“. */
const ENDINGS = new Set(['s', 'es', 'n', 'en', 'e', 'er', 'em', 'ns']);
const inflected = (a: string, b: string): boolean => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short) && ENDINGS.has(long.slice(short.length));
};

/**
 * Fast derselbe Satz: dieselben Wörter in derselben Reihenfolge, höchstens zwei davon nur in der
 * Endung verschieden. Vorsichtig – ein anderes Wort (ein anderer Name) ist ein anderer Satz.
 */
function nearlySame(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length || a.join('').length < 6) return false;
  let bent = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (!inflected(a[i]!, b[i]!) || ++bent > 2) return false;
  }
  return true;
}

/**
 * Der Faden, den es mit diesem Satz schon gibt (derselbe Schlüssel, `threadKey`) – der lebendige
 * vor dem abgeschlossenen, der einer Geschichte vor dem losen, der ältere vor dem jüngeren. null,
 * wenn es keinen gibt. So legen Nachtragen und KI-Leser keinen zweiten an.
 */
export function threadByTitle(
  data: Pick<CampaignData, 'threads' | 'stories'>,
  title: string,
): Thread | null {
  const key = threadKey(title);
  if (!key) return null;
  return (
    Object.values(data.threads)
      .filter((thread) => threadKey(thread.title) === key)
      .sort(
        (a, b) =>
          Number(threadLive(b)) - Number(threadLive(a)) ||
          Number(isLooseThread(data, a)) - Number(isLooseThread(data, b)) ||
          a.created.localeCompare(b.created) ||
          a.id.localeCompare(b.id),
      )[0] ?? null
  );
}

export interface ThreadTwins {
  /** Die Kennungen der Gruppe, geordnet und verbunden – unter ihm merkt sich „Sind verschieden“. */
  key: string;
  /** Die Fäden der Gruppe – der, der beim Zusammenlegen bleibt, zuerst. */
  threads: Thread[];
  /** Der Faden, der bleibt: der einer Geschichte, sonst der, an dem am meisten geschrieben ist. */
  keepId: string;
}

const hintsWritten = (thread: Thread) => thread.hints.filter((hint) => hint.text.trim()).length;

/**
 * Fäden, die es wohl doppelt gibt: lebendige Fäden mit demselben oder fast demselben Satz, von
 * denen mindestens einer lose ist. Nur ein Hinweis – zusammengelegt wird erst, wenn der
 * Spielleiter es will (`mergeThreads`); was er für verschieden erklärt hat
 * (`state.twinsApart`), wird nicht mehr gemeldet. Lieber eine Gruppe zu wenig als eine falsche.
 */
export function threadTwins(
  data: Pick<CampaignData, 'threads' | 'stories' | 'state'>,
): ThreadTwins[] {
  const live = Object.values(data.threads)
    .filter(threadLive)
    .map((thread) => ({ thread, words: keyWords(thread.title) }))
    .filter((entry) => entry.words.length > 0);
  // Gruppen über „gleich oder fast gleich“ – wer zu einem der Gruppe passt, gehört dazu.
  const group = live.map((_, index) => index);
  const root = (index: number): number =>
    group[index] === index ? index : (group[index] = root(group[index]!));
  const byKey = new Map<string, number>();
  live.forEach((entry, index) => {
    const key = entry.words.join(' ');
    const first = byKey.get(key);
    if (first === undefined) byKey.set(key, index);
    else group[root(index)] = root(first);
  });
  const firsts = [...byKey.values()];
  for (let i = 0; i < firsts.length; i++)
    for (let k = i + 1; k < firsts.length; k++)
      if (nearlySame(live[firsts[i]!]!.words, live[firsts[k]!]!.words))
        group[root(firsts[k]!)] = root(firsts[i]!);
  const groups = new Map<number, Thread[]>();
  live.forEach((entry, index) => {
    const at = root(index);
    groups.set(at, [...(groups.get(at) ?? []), entry.thread]);
  });
  const apart = new Set(data.state.twinsApart);
  const twins: ThreadTwins[] = [];
  for (const threads of groups.values()) {
    if (threads.length < 2 || !threads.some((thread) => isLooseThread(data, thread))) continue;
    const key = threads
      .map((thread) => thread.id)
      .sort()
      .join('+');
    if (apart.has(key)) continue;
    const ordered = [...threads].sort(
      (a, b) =>
        Number(isLooseThread(data, a)) - Number(isLooseThread(data, b)) ||
        hintsWritten(b) - hintsWritten(a) ||
        Number(b.truth.trim() !== '') - Number(a.truth.trim() !== '') ||
        b.refs.length - a.refs.length ||
        a.created.localeCompare(b.created) ||
        a.id.localeCompare(b.id),
    );
    twins.push({ key, threads: ordered, keepId: ordered[0]!.id });
  }
  return twins.sort((a, b) => a.threads[0]!.title.localeCompare(b.threads[0]!.title, 'de'));
}

// ── Woher ein Faden stammt ─────────────────────────────────────────────────

export interface ThreadOrigin {
  /** Die nachgetragenen Sessions, in deren Notizen er steht – die früheste zuerst. */
  sessions: Session[];
  /** Der Artikel, aus dem der KI-Leser ihn gelesen hat. */
  article: { id: string; title: string } | null;
  /** Die Weltzeit, seit der es ihn gibt: der Beginn der frühesten Session; null = unbekannt. */
  since: number | null;
  /** „aus Session 3 (17. Tauwind 701)“, „aus dem Artikel „…““ – leer, wenn nichts bekannt ist. */
  text: string;
}

type OriginData = Pick<CampaignData, 'sessions' | 'articles' | 'campaign'>;

/**
 * Je Faden die Sessions, aus deren Notizen er angenommen wurde – auch für Stände, in denen der
 * Faden selbst es noch nicht wusste: Der angenommene Vorschlag kennt, was er angelegt hat.
 */
function sessionsByThread(data: Pick<CampaignData, 'sessions'>): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const add = (threadId: string, sessionId: string) =>
    found.set(threadId, (found.get(threadId) ?? new Set<string>()).add(sessionId));
  for (const session of Object.values(data.sessions))
    for (const proposal of session.reading?.proposals ?? []) {
      if (proposal.kind !== 'thread' || proposal.state !== 'accepted') continue;
      for (const made of proposal.created)
        if (made.collection === 'threads') add(made.id, session.id);
      for (const edit of proposal.edits) if (edit.kind === 'source') add(edit.targetId, session.id);
    }
  return found;
}

/** „Session 3“, „den Sessions 3 und 5“, „den Sessions 3, 5 und 2 weiteren“. */
function sessionsLine(sessions: readonly Session[]): string {
  const numbers = sessions.map((session) => session.number);
  if (numbers.length === 1) return `Session ${numbers[0]}`;
  if (numbers.length === 2) return `den Sessions ${numbers[0]} und ${numbers[1]}`;
  return `den Sessions ${numbers[0]}, ${numbers[1]} und ${numbers.length - 2} weiteren`;
}

/** „2026-11-12T…“ → „12. 11. 2026“; leer, wenn es kein Datum ist. */
function realDay(stamp: string): string {
  const found = /^(\d{4})-(\d{2})-(\d{2})/.exec(stamp);
  return found ? `${Number(found[3])}. ${Number(found[2])}. ${found[1]}` : '';
}

function originOf(
  data: OriginData,
  thread: Thread,
  bySession: ReadonlyMap<string, ReadonlySet<string>>,
): ThreadOrigin {
  const ids = new Set([...thread.sessionIds, ...(bySession.get(thread.id) ?? [])]);
  const sessions = [...ids]
    .map((id) => data.sessions[id])
    .filter((session): session is Session => session !== undefined)
    .sort((a, b) => a.startAt - b.startAt || a.number - b.number);
  const found = thread.articleId ? data.articles[thread.articleId] : undefined;
  const article = found ? { id: found.id, title: found.title } : null;
  const since = sessions[0]?.startAt ?? null;
  const day = since === null ? '' : formatDate(data.campaign.calendar, since);
  const made = realDay(thread.created);
  const text = sessions.length
    ? `aus ${sessionsLine(sessions)} (${sessions.length > 1 ? 'seit ' : ''}${day})`
    : article
      ? `aus dem Artikel „${article.title}“`
      : made
        ? `angelegt am ${made}`
        : '';
  return { sessions, article, since, text };
}

/** Woher ein Faden stammt und seit wann es ihn gibt – soweit bekannt. */
export const threadOrigin = (data: OriginData, thread: Thread): ThreadOrigin =>
  originOf(data, thread, sessionsByThread(data));

/**
 * Die Sessions, die beim Zusammenlegen mit einem Faden mitgehen: die an ihm stehen und die, aus
 * deren Vorschlägen er stammt.
 */
export function threadSessionIds(data: Pick<CampaignData, 'sessions'>, thread: Thread): string[] {
  return [...new Set([...thread.sessionIds, ...(sessionsByThread(data).get(thread.id) ?? [])])];
}

// ── Zu welcher Geschichte ein Faden passen könnte ──────────────────────────

/** Was einen Faden ausmacht, auch bevor es ihn gibt (ein Vorschlag aus Notizen). */
export type ThreadLike = Pick<Thread, 'title' | 'truth' | 'refs' | 'hints'>;

/** Ein Satz und seine Namen als Faden gelesen – für Vorschläge, die noch keiner sind. */
export const threadLike = (title: string, refs: readonly string[] = []): ThreadLike => ({
  title,
  truth: '',
  refs: [...refs],
  hints: [],
});

export interface StoryFit {
  story: Story;
  /** Die Namen, die Faden und Geschichte gemeinsam haben. */
  shared: Entity[];
  /** „nennt auch Mira Tannhaus“ */
  reason: string;
}

interface StoryIndexEntry {
  story: Story;
  nodes: Set<string>;
}

/** Die Geschichten, an die sich ein Faden hängen lässt: alle, die nicht zu Ende erzählt sind. */
function openStories(data: CampaignData, view: BoardView = 'truth'): StoryIndexEntry[] {
  return Object.values(data.stories)
    .filter((story) => !story.closed && (view === 'truth' || story.known))
    .map((story) => ({ story, nodes: new Set(storyNodes(data, story)) }));
}

const byFit = (a: { shared: Entity[]; story: Story }, b: { shared: Entity[]; story: Story }) =>
  b.shared.length - a.shared.length ||
  Number(b.story.inPlay) - Number(a.story.inPlay) ||
  a.story.title.localeCompare(b.story.title, 'de') ||
  a.story.id.localeCompare(b.story.id);

function fitsOf(data: CampaignData, thread: ThreadLike, stories: StoryIndexEntry[]): StoryFit[] {
  const fits: StoryFit[] = [];
  for (const { story, nodes } of stories) {
    const shared = sharedNames(data, thread, nodes);
    if (shared.length) fits.push({ story, shared, reason: sharedReason(shared) });
  }
  return fits.sort(byFit);
}

/**
 * Die Geschichten, zu denen ein Faden passen könnte – `threadFits` umgekehrt: Sie hängen an
 * denselben Namen, oder sein Satz nennt einen von ihnen. Die mit den meisten gemeinsamen Namen
 * zuerst. Nur ein Vorschlag.
 */
export const storyFits = (data: CampaignData, thread: ThreadLike): StoryFit[] =>
  fitsOf(data, thread, openStories(data));

export interface StoryChoice {
  story: Story;
  /** Wie viele der Fäden zu ihr passen könnten; 0 = sie steht nur zur Wahl. */
  count: number;
  /** „nennt auch Mira“, bei mehreren Fäden „2 von 3 nennen auch Mira“ – leer, wenn keiner passt. */
  reason: string;
}

/**
 * Die Geschichten zur Wahl für einen oder mehrere Fäden: die passenden zuerst (zu je mehr Fäden
 * sie passt, desto weiter oben), dann alle übrigen nach Namen. Zu Ende Erzähltes steht nicht zur
 * Wahl.
 */
export function storyChoices(data: CampaignData, threads: readonly ThreadLike[]): StoryChoice[] {
  return openStories(data)
    .map(({ story, nodes }) => {
      const each = threads.map((thread) => sharedNames(data, thread, nodes));
      const count = each.filter((shared) => shared.length > 0).length;
      const ids = new Set(each.flat().map((entity) => entity.id));
      const shared = [...ids]
        .map((id) => data.entities[id])
        .filter((entity): entity is Entity => entity !== undefined)
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));
      const who = count === threads.length ? 'alle' : `${count} von ${threads.length}`;
      const reason = !count
        ? ''
        : threads.length === 1
          ? sharedReason(shared)
          : `${who} nennen auch ${namesLine(shared)}`;
      return { story, count, shared, reason };
    })
    .sort((a, b) => b.count - a.count || byFit(a, b))
    .map(({ story, count, reason }) => ({ story, count, reason }));
}

/** Die Geschichten zur Wahl, die zu einer Suche passen: nach ihrem Namen und dem ihres Antreibers. */
export function filterStoryChoices(
  data: Pick<CampaignData, 'entities'>,
  choices: readonly StoryChoice[],
  query: string,
): StoryChoice[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...choices];
  return choices.filter(({ story }) => {
    const owner = story.ownerId ? data.entities[story.ownerId] : undefined;
    const text = normalize(`${story.title} ${owner?.name ?? ''}`);
    return words.every((word) => text.includes(word));
  });
}

// ── Die Liste „Lose Fäden“ ─────────────────────────────────────────────────

export interface LooseThread {
  thread: Thread;
  /** Woran er hängt: seine Personen, Orte, Fraktionen und wo seine Hinweise liegen. */
  nodes: Entity[];
  /** Die Geschichten, zu denen er passen könnte – die beste zuerst. */
  fits: StoryFit[];
  origin: ThreadOrigin;
  /** Wie nah er der Gruppe ist: Hängt er an ihrem Ort, steht er oben. */
  nearness: Nearness;
  /** Er liegt als Karte auf dem Brett (hingelegt oder im Spiel). */
  onBoard: boolean;
  /** Er ruht: liegen gelassen – steht in der Später-Liste. */
  resting: boolean;
  /** Alles, woran ihn die Suche findet – vereinheitlicht. */
  search: string;
}

const NEAR_ORDER: Nearness[] = ['here', 'reachable', 'far'];
const STATE_ORDER = ['active', 'open', 'dormant', 'solved', 'lost'];

/**
 * Die Reihung, in der lose Fäden überall stehen: was am Ort der Gruppe hängt zuerst, dann das
 * Erreichbare, dann das Ferne; darin die aktiven vor den offenen, dann nach dem Satz.
 */
const looseOrder = (a: LooseThread, b: LooseThread) =>
  NEAR_ORDER.indexOf(a.nearness) - NEAR_ORDER.indexOf(b.nearness) ||
  STATE_ORDER.indexOf(a.thread.state) - STATE_ORDER.indexOf(b.thread.state) ||
  a.thread.title.localeCompare(b.thread.title, 'de') ||
  a.thread.id.localeCompare(b.thread.id);

/**
 * Die losen Fäden für die Liste neben dem Brett – ohne die gelösten und verlorenen (die stehen
 * unter „Abgeschlossen“). Je Faden: woran er hängt, woher er stammt, wozu er passen könnte, ob
 * er auf dem Brett liegt. In der Sicht der Gruppe nur, was sie kennt – ohne Antwort, ohne
 * Hinweise, die sie nicht hat, und nur mit Geschichten, von denen sie weiß. `cards` sind die
 * Karten des Bretts, wenn sie schon gerechnet sind.
 */
export function looseThreads(
  data: CampaignData,
  view: BoardView = 'truth',
  cards: readonly BoardCard[] = boardCards(data, view),
): LooseThread[] {
  const stories = openStories(data, view);
  const bySession = sessionsByThread(data);
  const rows: LooseThread[] = [];
  for (const card of cards) {
    const thread = card.threads[0];
    if (card.story || card.closed || !thread) continue;
    const stored = data.threads[thread.id];
    if (!stored || !isLooseThread(data, stored)) continue;
    const nodes = card.nodes
      .map((id) => data.entities[id])
      .filter((entity): entity is Entity => entity !== undefined);
    const origin = originOf(data, stored, bySession);
    rows.push({
      thread,
      nodes,
      fits: fitsOf(data, thread, stories),
      origin,
      nearness: card.nearness,
      onBoard: card.onBoard,
      resting: thread.state === 'dormant',
      search: normalize(
        [
          thread.title,
          thread.truth,
          ...thread.hints.map((hint) => hint.text),
          ...nodes.map((entity) => entity.name),
          origin.text,
        ].join(' '),
      ),
    });
  }
  return rows.sort(looseOrder);
}

/** Die Zeilen, die zu einer Suche passen: Jedes Wort steht im Satz, im Text oder in einem Namen. */
export function filterLoose(rows: readonly LooseThread[], query: string): LooseThread[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...rows];
  return rows.filter((row) => words.every((word) => row.search.includes(word)));
}

// ── Fäden zur Wahl ─────────────────────────────────────────────────────────

/**
 * Alle Fäden in der Reihung, in der sie zur Wahl stehen (Hinweis gefunden, Termin an einem
 * Faden): die lebendigen zuerst, darin was am Ort der Gruppe hängt, dann das Erreichbare, dann
 * das Ferne – Fragen einer Geschichte vor losen Fäden, dann nach dem Satz.
 */
export function threadsInOrder(data: CampaignData): Thread[] {
  const near = new Map<string, number>();
  for (const card of boardCards(data))
    for (const thread of card.threads) near.set(thread.id, NEAR_ORDER.indexOf(card.nearness));
  const far = NEAR_ORDER.length;
  return Object.values(data.threads).sort(
    (a, b) =>
      Number(threadLive(b)) - Number(threadLive(a)) ||
      (near.get(a.id) ?? far) - (near.get(b.id) ?? far) ||
      Number(isLooseThread(data, a)) - Number(isLooseThread(data, b)) ||
      a.title.localeCompare(b.title, 'de') ||
      a.id.localeCompare(b.id),
  );
}
