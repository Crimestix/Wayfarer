/**
 * Das Blatt einer Geschichte, gelesen: wer beteiligt ist (mit Rolle und Absicht), wie die
 * Beteiligten zueinander stehen, wo sie spielt, welche losen Fäden zu ihr passen könnten, wie
 * ihre Uhr gerade steht, was an ihr hängt, welche Teilgeschichten sie hat – und umgekehrt, in
 * welchen Geschichten ein Eintrag der Welt vorkommt. Alles abgeleitet aus dem, was der
 * Spielleiter geschrieben und verbunden hat; nichts davon wird gespeichert. Reine Funktionen.
 */
import { clockView } from './clock';
import { openPromises } from './derive';
import { netsOfStory } from './net';
import { namesIn } from './recognize';
import { relationLabel } from './relations';
import type {
  CalendarEvent,
  CampaignData,
  ChronicleEntry,
  Entity,
  Handout,
  Place,
  Relation,
  Story,
  Thread,
} from './schema';
import {
  isLooseThread,
  storyClock,
  storyNodes,
  storyStage,
  threadLive,
  threadNodes,
  threadsOf,
  type StoryPace,
  type StoryStage,
} from './story';
import { formatDayMonth } from './time/calendar';

// ── Beteiligte ─────────────────────────────────────────────────────────────

/**
 * Wörter für die Rolle eines Beteiligten – nur Vorschläge zum Auswählen. Die Rolle ist ein freies
 * Wort; jedes andere gilt genauso.
 */
export const ROLE_SUGGESTIONS: readonly string[] = [
  'Antreiber',
  'Handlanger',
  'Verbündeter',
  'Gegenspieler',
  'Opfer',
  'Zeuge',
  'Auftraggeber',
  'Mitwisser',
  'Schauplatz',
  'begehrtes Ding',
];

export interface CastRow {
  entity: Entity;
  /** Seine Rolle in dieser Geschichte – leer, wenn keine geschrieben ist. */
  role: string;
  /** Was er hier will. */
  wants: string;
  /** Er treibt die Geschichte an. */
  driver: boolean;
  /**
   * Steht in der Liste der Beteiligten (`story.refs`) und lässt sich dort herausnehmen. Sonst
   * gehört er über etwas anderes dazu: als Antreiber, über einen Hinweis, über die Uhr.
   */
  listed: boolean;
  /**
   * Eine Person, Fraktion oder Familie, die mit keinem anderen Beteiligten verbunden ist – nur
   * ein Hinweis, und nur, wenn es überhaupt mehrere gibt.
   */
  lonely: boolean;
}

/** Wer im Netz der Welt steht: Zwischen ihnen zieht man Beziehungen. */
const TIED_KINDS = new Set(['person', 'faction', 'family']);

function castIds(data: CampaignData, story: Story): string[] {
  const heroes = new Set(story.heroes.map((hero) => hero.characterId));
  const listed = new Set(story.refs);
  const ids: string[] = [];
  const add = (id: string | null | undefined) => {
    if (id && data.entities[id] && !ids.includes(id)) ids.push(id);
  };
  add(story.ownerId);
  for (const id of story.refs) add(id);
  // Wer über einen Hinweis oder die Uhr dazugehört. Orte stehen unter „Schauplätze“, Gefährten
  // unter „Wen es persönlich betrifft“.
  for (const id of storyNodes(data, story)) {
    const kind = data.entities[id]?.kind;
    if (listed.has(id) || heroes.has(id) || kind === 'place' || kind === 'character') continue;
    add(id);
  }
  return ids;
}

/**
 * Die Beteiligten einer Geschichte: der Antreiber zuerst, dann die Liste des Spielleiters
 * (`story.refs`), dann, wer über einen Hinweis oder die Uhr dazugehört – je mit Rolle und
 * Absicht (`story.roles`).
 */
export function castOf(data: CampaignData, story: Story): CastRow[] {
  const ids = castIds(data, story);
  const inCast = new Set(ids);
  const tied = new Set<string>();
  for (const relation of Object.values(data.relations)) {
    if (relation.ended || !inCast.has(relation.from) || !inCast.has(relation.to)) continue;
    tied.add(relation.from);
    tied.add(relation.to);
  }
  return ids.map((id) => {
    const entity = data.entities[id]!;
    const role = story.roles[id];
    return {
      entity,
      role: role?.role ?? '',
      wants: role?.wants ?? '',
      driver: id === story.ownerId,
      listed: story.refs.includes(id),
      lonely: ids.length > 1 && TIED_KINDS.has(entity.kind) && !tied.has(id),
    };
  });
}

/** Eine Beziehung der Welt zwischen zwei Beteiligten: „Mira – verbündet mit – Odo“. */
export interface CastTie {
  relation: Relation;
  from: Entity;
  to: Entity;
  /** Die Art in Worten, aus Sicht von `from`. */
  label: string;
}

/**
 * Die Verbindungen einer Geschichte: die Beziehungen der Welt zwischen ihren Beteiligten
 * (einschließlich Antreiber). Es sind dieselben wie auf den Seiten der Einträge und im Netz –
 * hier nur zusammen gelesen.
 */
export function castTies(data: CampaignData, story: Story): CastTie[] {
  const inCast = new Set(castIds(data, story));
  const ties: CastTie[] = [];
  for (const relation of Object.values(data.relations)) {
    if (!inCast.has(relation.from) || !inCast.has(relation.to)) continue;
    const from = data.entities[relation.from]!;
    const to = data.entities[relation.to]!;
    ties.push({ relation, from, to, label: relationLabel(relation, 'from') });
  }
  return ties.sort(
    (a, b) =>
      Number(a.relation.ended) - Number(b.relation.ended) ||
      a.from.name.localeCompare(b.from.name, 'de') ||
      a.to.name.localeCompare(b.to.name, 'de') ||
      a.relation.id.localeCompare(b.relation.id),
  );
}

// ── Schauplätze ────────────────────────────────────────────────────────────

/** Woher ein Ort zur Geschichte gehört. */
export type PlaceVia = 'cast' | 'entry' | 'scene' | 'hint' | 'clock' | 'net';

export const PLACE_VIA_LABEL: Record<PlaceVia, string> = {
  cast: 'beteiligt',
  entry: 'Einstieg',
  scene: 'Szene',
  hint: 'Hinweis',
  clock: 'Uhr',
  net: 'Wegenetz',
};

export interface StoryPlace {
  place: Place;
  via: PlaceVia[];
  /**
   * Der Ort gehört zur Geschichte (`storyNodes`). Sonst liegt er nur auf einem ihrer Wegenetze:
   * ein Punkt unterwegs, an dem sie nicht hängt.
   */
  own: boolean;
}

/**
 * Die Orte einer Geschichte: die unter den Beteiligten und die ihrer Einstiege, Szenen und
 * Hinweise – jeder einmal, mit dem, woher er kommt. Dahinter die übrigen Punkte ihrer Wegenetze:
 * Orte unterwegs, die erst dazugehören, wenn der Spielleiter sie dazunimmt.
 */
export function storyPlaces(data: CampaignData, story: Story): StoryPlace[] {
  const clock = story.clockId ? data.clocks[story.clockId] : undefined;
  const found = new Map<string, StoryPlace>();
  const add = (id: string | null | undefined, via: PlaceVia) => {
    const place = id ? data.entities[id] : undefined;
    if (place?.kind !== 'place') return;
    const row = found.get(place.id) ?? { place, via: [], own: false };
    if (!row.via.includes(via)) row.via.push(via);
    if (via !== 'net') row.own = true;
    found.set(place.id, row);
  };
  add(story.ownerId, 'cast');
  for (const id of story.refs) add(id, 'cast');
  for (const entry of story.entries) add(entry.placeId, 'entry');
  for (const scene of story.scenes) add(scene.placeId, 'scene');
  for (const thread of threadsOf(data, story.id)) {
    for (const id of thread.refs) add(id, 'hint');
    for (const hint of thread.hints) add(hint.placeId, 'hint');
  }
  add(clock?.placeId, 'clock');
  for (const id of clock?.refs ?? []) add(id, 'clock');
  for (const net of netsOfStory(data, story.id))
    for (const point of net.points) add(point.placeId, 'net');
  // Was zur Geschichte gehört, zuerst – in der Reihenfolge, in der es dazukam.
  return [...found.values()].sort((a, b) => Number(b.own) - Number(a.own));
}

// ── Lose Fäden, die passen könnten ─────────────────────────────────────────

export interface ThreadFit {
  thread: Thread;
  /** Die Namen, die Faden und Geschichte gemeinsam haben. */
  shared: Entity[];
  /** „nennt auch Mira Tannhaus“ */
  reason: string;
}

/** „A“, „A und B“, „A, B und C“, „A, B und 2 weitere“ – nie „und 1 weitere“. */
export function namesLine(shared: readonly Entity[]): string {
  const names = shared.map((entity) => entity.name);
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} und ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} und ${names[2]}`;
  return `${names[0]}, ${names[1]} und ${names.length - 2} weitere`;
}

/** „nennt auch A“, „nennt auch A und B“, „nennt auch A, B und 2 weitere“. */
export const sharedReason = (shared: readonly Entity[]): string =>
  `nennt auch ${namesLine(shared)}`;

/**
 * Die Namen, die ein Faden mit einer Geschichte gemeinsam hat (`nodes` = woran sie hängt): woran
 * er selbst hängt und wen sein Satz, seine Antwort und seine Hinweise nennen – nach Namen.
 */
export function sharedNames(
  data: CampaignData,
  thread: Pick<Thread, 'title' | 'truth' | 'refs' | 'hints'>,
  nodes: ReadonlySet<string>,
): Entity[] {
  if (!nodes.size) return [];
  const ids = new Set(threadNodes(data, thread));
  const known = [...nodes];
  for (const text of [thread.title, thread.truth, ...thread.hints.map((hint) => hint.text)])
    for (const hit of namesIn(data, text, known)) if (hit.id) ids.add(hit.id);
  return [...ids]
    .filter((id) => nodes.has(id))
    .map((id) => data.entities[id])
    .filter((entity): entity is Entity => entity !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * Lose Fäden, die zu einer Geschichte passen könnten: lebendige Fäden ohne Geschichte, die an
 * denselben Namen hängen oder sie im Text nennen – die mit den meisten gemeinsamen Namen zuerst.
 * Nur ein Vorschlag; ob einer dazugehört, entscheidet der Spielleiter.
 */
export function threadFits(data: CampaignData, story: Story): ThreadFit[] {
  const nodes = new Set(storyNodes(data, story));
  if (!nodes.size) return [];
  const fits: ThreadFit[] = [];
  for (const thread of Object.values(data.threads)) {
    if (!isLooseThread(data, thread) || !threadLive(thread)) continue;
    const shared = sharedNames(data, thread, nodes);
    if (shared.length) fits.push({ thread, shared, reason: sharedReason(shared) });
  }
  return fits.sort(
    (a, b) =>
      b.shared.length - a.shared.length ||
      a.thread.title.localeCompare(b.thread.title, 'de') ||
      a.thread.id.localeCompare(b.thread.id),
  );
}

// ── Die Uhr auf dem Blatt ──────────────────────────────────────────────────

export interface ClockStand {
  pace: StoryPace;
  /** Die Uhr ist angelegt, aber noch nie gelaufen. */
  fresh: boolean;
  /** Ein Satz: seit wann sie läuft oder steht und wann der nächste Schritt eintritt. */
  line: string;
}

/**
 * Wie die Uhr einer Geschichte gerade steht – in einem Satz für das Blatt. Eine Uhr, die mit dem
 * ersten Schritt entstanden ist, steht noch: Nichts tritt ein, bis der Spielleiter sie laufen
 * lässt.
 */
export function clockStand(data: CampaignData, story: Story): ClockStand {
  const { pace, view } = storyClock(data, story);
  const clock = view?.clock;
  if (!clock || !view || !clock.steps.length) return { pace: 'none', fresh: false, line: '' };
  const cal = data.campaign.calendar;
  const day = (at: number) => formatDayMonth(cal, at);
  const happened = clock.steps.filter((step) => step.at !== null);
  const fresh = clock.pausedAt !== null && happened.length === 0 && clock.pausedAt <= clock.start;
  if (pace === 'done') return { pace, fresh: false, line: 'Alle Schritte sind geschehen.' };
  if (pace === 'blocked')
    return {
      pace,
      fresh: false,
      line: `Blockiert seit dem ${day(clock.pausedAt!)}: ${view.blocked}`,
    };
  if (pace === 'paused')
    return {
      pace,
      fresh,
      line: fresh
        ? 'Nichts tritt ein, bis du sie laufen lässt.'
        : `Angehalten seit dem ${day(clock.pausedAt!)} – solange tritt nichts ein.`,
    };
  const last = happened.reduce<number | null>(
    (latest, step) => (latest === null || step.at! > latest ? step.at : latest),
    null,
  );
  return {
    pace,
    fresh: false,
    line: last === null ? `Seit dem ${day(clock.start)}.` : `Zuletzt am ${day(last)} ein Schritt.`,
  };
}

// ── Was sonst daran hängt ──────────────────────────────────────────────────

export interface StoryHangs {
  handouts: Handout[];
  /** Termine, die an ihren Fragen hängen und noch ausstehen. */
  events: CalendarEvent[];
  /** Offene Abmachungen, die zu ihr festgehalten sind. */
  promises: ChronicleEntry[];
  /** Was zuletzt zu ihr notiert wurde, das Neueste zuerst. */
  notes: ChronicleEntry[];
}

const NOTES_SHOWN = 4;

/**
 * Was außerhalb des Blatts an einer Geschichte hängt: ihre Handouts, die Termine an ihren Fragen,
 * die offenen Abmachungen und die letzten Notizen, die zu ihr festgehalten sind. Nur zum
 * Hinspringen.
 */
export function storyHangs(data: CampaignData, story: Story): StoryHangs {
  const threadIds = new Set(threadsOf(data, story.id).map((thread) => thread.id));
  return {
    events: Object.values(data.events)
      .filter(
        (event) =>
          event.threadId !== null &&
          threadIds.has(event.threadId) &&
          (!event.done || event.repeat !== null),
      )
      .sort((a, b) => a.at - b.at || a.title.localeCompare(b.title, 'de')),
    handouts: Object.values(data.handouts)
      .filter((handout) => handout.storyId === story.id)
      .sort((a, b) => a.title.localeCompare(b.title, 'de')),
    promises: openPromises(data).filter((entry) => entry.storyId === story.id),
    notes: Object.values(data.chronicle)
      .filter((entry) => entry.storyId === story.id && entry.kind !== 'promise')
      .sort((a, b) => b.at - a.at || b.created.localeCompare(a.created))
      .slice(0, NOTES_SHOWN),
  };
}

// ── Große Geschichten und ihre Teile ───────────────────────────────────────

export interface StoryPart {
  story: Story;
  stage: StoryStage;
  pace: StoryPace;
  /** Der nächste Schritt ihrer Uhr – null ohne Uhr oder wenn alles geschehen ist. */
  next: string | null;
}

/** Die Teilgeschichten einer großen Geschichte – mit Stand und nächstem Schritt. */
export function storyParts(data: CampaignData, storyId: string): StoryPart[] {
  return Object.values(data.stories)
    .filter((story) => story.parentId === storyId)
    .sort(
      (a, b) =>
        Number(a.closed) - Number(b.closed) ||
        a.title.localeCompare(b.title, 'de') ||
        a.id.localeCompare(b.id),
    )
    .map((story) => {
      const clock = story.clockId ? data.clocks[story.clockId] : undefined;
      return {
        story,
        stage: storyStage(data, story).stage,
        pace: storyClock(data, story).pace,
        next: clock ? (clockView(clock, data.state.now).next?.step.text ?? null) : null,
      };
    });
}

/** Die großen Geschichten über einer – die nächste zuerst. Ein Kreis bricht ab. */
export function storyAncestors(data: Pick<CampaignData, 'stories'>, story: Story): Story[] {
  const out: Story[] = [];
  let current = story.parentId ? data.stories[story.parentId] : undefined;
  while (current && current.id !== story.id && !out.includes(current)) {
    out.push(current);
    current = current.parentId ? data.stories[current.parentId] : undefined;
  }
  return out;
}

/**
 * Zu welchen Geschichten eine Geschichte gehören kann: zu jeder außer sich selbst und ihren
 * eigenen Teilen – sonst entstünde ein Kreis.
 */
export function parentChoices(data: Pick<CampaignData, 'stories'>, story: Story): Story[] {
  return Object.values(data.stories)
    .filter(
      (other) =>
        other.id !== story.id &&
        !storyAncestors(data, other).some((ancestor) => ancestor.id === story.id),
    )
    .sort((a, b) => a.title.localeCompare(b.title, 'de') || a.id.localeCompare(b.id));
}

// ── Kommt vor in ───────────────────────────────────────────────────────────

export interface StoryRoleOf {
  story: Story;
  /** Seine Rolle dort – geschrieben, sonst „Antreiber“, sonst leer. */
  role: string;
  wants: string;
  driver: boolean;
}

/**
 * Die Geschichten, in denen ein Eintrag vorkommt: alle, an denen er hängt (`storyNodes`) – mit
 * seiner Rolle. Die im Spiel zuerst, zu Ende Erzähltes zuletzt.
 */
export function storiesOf(data: CampaignData, entityId: string): StoryRoleOf[] {
  const rows: StoryRoleOf[] = [];
  for (const story of Object.values(data.stories)) {
    if (!storyNodes(data, story).includes(entityId)) continue;
    const driver = story.ownerId === entityId;
    const role = story.roles[entityId];
    rows.push({
      story,
      role: role?.role.trim() || (driver ? 'Antreiber' : ''),
      wants: role?.wants.trim() ?? '',
      driver,
    });
  }
  return rows.sort(
    (a, b) =>
      Number(a.story.closed) - Number(b.story.closed) ||
      Number(b.story.inPlay) - Number(a.story.inPlay) ||
      a.story.title.localeCompare(b.story.title, 'de') ||
      a.story.id.localeCompare(b.story.id),
  );
}

// ── Kleine Sätze des Blatts ────────────────────────────────────────────────

/** „Mira hängt an niemandem.“ – leer, wenn alle verbunden sind. */
export function lonelyLine(rows: readonly CastRow[]): string {
  const names = rows.filter((row) => row.lonely).map((row) => row.entity.name);
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} hängt an niemandem.`;
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]} hängen an niemandem.`;
}

/**
 * Wie eine Frage mit ihren Hinweisen dasteht – in Worten, nie als Bruch: Einen Hinweis übersieht
 * die Gruppe, einen versteht sie falsch; ab dreien reicht es.
 */
export function hintsNote(count: number): { text: string; thin: boolean } {
  if (count <= 0)
    return { text: 'Noch kein Hinweis – so findet die Gruppe die Antwort nicht.', thin: true };
  if (count === 1)
    return { text: 'Ein Hinweis – verpasst die Gruppe ihn, reißt die Frage ab.', thin: true };
  if (count === 2) return { text: 'Zwei Hinweise – ein dritter trägt.', thin: true };
  return { text: count === 3 ? 'Drei Hinweise – das reicht.' : 'Das reicht.', thin: false };
}
