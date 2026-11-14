/**
 * Die Welt an einem Tag: Wie stand sie damals? `worldAt` gibt den Spielstand so zurück, wie er zu
 * einem Zeitpunkt war – die Chronik bis dahin, die Weltzeit auf diesem Zeitpunkt, die Gruppe an
 * ihrem damaligen Ort –, damit alle Ableitungen von Wayfarer (Alter, Schicksal, Haltung, Uhren,
 * Spielerbuch …) unverändert darauf rechnen können.
 *
 * Gespeicherte Wirkungen der Chronik werden dabei zurückgerechnet: Ein Eintrag bestimmt einen
 * Stand nur, solange er der jüngste seiner Sorte ist (`domain/history.ts`). Für einen Zeitpunkt
 * gilt also der jüngste Eintrag bis dahin – und gab es bis dahin keinen, der Stand, den der erste
 * spätere Eintrag vorgefunden hat (`before`). Was nirgends mit Zeit festgehalten ist (eine von
 * Hand gesetzte Angabe ohne Eintrag), bleibt, wie es heute ist.
 *
 * `worldOn` fasst daraus zusammen, was die Seite „Welt an einem Tag“ zeigt. Nur lesen – nichts
 * hiervon wird gespeichert. Reine Funktionen.
 */
import { agesAt, type AgeSpan } from './ages';
import { clockView, type StepView } from './clock';
import { activeParty, byTime, chronicleSorted, findRelation } from './derive';
import { activeConditions, partyPlaceAt, sessionAt, sessionSpans, sortKeyOf } from './history';
import { lifeFacts, type LifeFact } from './lifespan';
import { playerBook } from './playerBook';
import {
  PARTY_ID,
  type CampaignData,
  type ChronicleEntry,
  type CollectionName,
  type CollectionTypes,
  type Clock,
  type Entity,
  type PersonStatus,
  type Relation,
  type Session,
} from './schema';
import { holderAfter } from './shop';
import type { WorldTime } from './time/calendar';

// ── Rückrechnen ────────────────────────────────────────────────────────────

/** Eine Sammlung zum Füllen. */
type Docs<C extends CollectionName> = Record<string, CollectionTypes[C]>;

/**
 * Für jede Sorte der jüngste Eintrag bis `at` und der erste danach. Einträge ohne Sorte
 * (`sortKeyOf` = null) fehlen.
 */
function sortsAround(entries: readonly ChronicleEntry[], at: WorldTime) {
  const last = new Map<string, ChronicleEntry>();
  const next = new Map<string, ChronicleEntry>();
  for (const entry of entries) {
    const key = sortKeyOf(entry);
    if (!key) continue;
    if (entry.at <= at) last.set(key, entry);
    else if (!next.has(key)) next.set(key, entry);
  }
  return { last, next };
}

/**
 * Der Stand einer Sorte zur Zeit `at`: was der jüngste Eintrag bis dahin gesetzt hat, sonst was
 * der erste spätere vorgefunden hat. `undefined` = kein Eintrag dieser Sorte – es bleibt, wie es
 * ist.
 */
function stateOfSort<T>(
  sorts: ReturnType<typeof sortsAround>,
  key: string,
  after: (entry: ChronicleEntry) => T,
  before: (entry: ChronicleEntry) => T,
): T | undefined {
  const last = sorts.last.get(key);
  if (last) return after(last);
  const next = sorts.next.get(key);
  return next ? before(next) : undefined;
}

/** Ein Wechsel: wann, in welcher Reihenfolge bei gleicher Zeit, was danach galt und was davor. */
interface Change<T> {
  at: WorldTime;
  order: string;
  value: T;
  before: T;
}
type Changes<T> = Map<string, Change<T>[]>;

function push<T>(map: Changes<T>, id: string, change: Change<T>): void {
  const list = map.get(id);
  if (list) list.push(change);
  else map.set(id, [change]);
}

/** Wie `stateOfSort`, für eine Liste von Wechseln, die nicht alle in der Chronik stehen. */
function valueAt<T>(changes: readonly Change<T>[], at: WorldTime): { value: T } | null {
  const sorted = [...changes].sort((a, b) => a.at - b.at || a.order.localeCompare(b.order));
  const last = sorted.filter((change) => change.at <= at).at(-1);
  if (last) return { value: last.value };
  const next = sorted.find((change) => change.at > at);
  return next ? { value: next.before } : null;
}

/** Bei wem jeder Gegenstand zur Zeit `at` war – aus Beute, festgehaltenen Wechseln und Handel. */
function holdersAt(data: CampaignData, at: WorldTime): Map<string, string | null> {
  const changes: Changes<string | null> = new Map();
  const lootLines = new Set<string>();
  for (const loot of Object.values(data.loot)) {
    if (!loot.given || loot.at === null) continue;
    if (loot.chronicleId) lootLines.add(loot.chronicleId);
    if (!loot.itemId) continue;
    push(changes, loot.itemId, {
      at: loot.at,
      order: data.chronicle[loot.chronicleId ?? '']?.created ?? loot.created,
      value: loot.toId,
      before: loot.holderBefore,
    });
  }
  for (const entry of Object.values(data.chronicle)) {
    if (lootLines.has(entry.id)) continue;
    if (entry.kind === 'change' && entry.holder)
      push(changes, entry.holder.itemId, {
        at: entry.at,
        order: entry.created,
        value: entry.holder.holderId,
        before: entry.holder.before,
      });
    if (entry.kind === 'trade' && entry.trade) {
      const to = holderAfter(data, entry.trade);
      for (const line of entry.trade.lines)
        if (line.claimed && line.entityId)
          push(changes, line.entityId, {
            at: entry.at,
            order: entry.created,
            value: to,
            before: line.holderBefore,
          });
    }
  }
  const out = new Map<string, string | null>();
  for (const [itemId, list] of changes) {
    const found = valueAt(list, at);
    if (found) out.set(itemId, found.value);
  }
  return out;
}

/** Ob eine Beziehung zur Zeit `at` bestand – aus den Einträgen, die sie begonnen oder beendet haben. */
function relationStates(
  entries: readonly ChronicleEntry[],
  at: WorldTime,
): Map<string, 'none' | 'active' | 'ended'> {
  const changes: Changes<'none' | 'active' | 'ended'> = new Map();
  for (const entry of entries) {
    const b = entry.kind === 'bond' ? entry.bond : null;
    if (b?.relationId && b.before !== null)
      push(changes, b.relationId, {
        at: entry.at,
        order: entry.created,
        value: b.ended ? 'ended' : 'active',
        before: b.before,
      });
    const c = entry.kind === 'companion' ? entry.companion : null;
    if (c?.relationId && c.before !== null)
      push(changes, c.relationId, {
        at: entry.at,
        order: entry.created,
        value: c.joined ? 'active' : 'ended',
        before: c.before,
      });
  }
  const out = new Map<string, 'none' | 'active' | 'ended'>();
  for (const [id, list] of changes) {
    const found = valueAt(list, at);
    if (found) out.set(id, found.value);
  }
  return out;
}

/** Eine Uhr, wie sie zur Zeit `at` stand: Was danach eintrat, stand noch aus. */
function clockAt(clock: Clock, at: WorldTime): Clock {
  const steps = clock.steps.map((step) =>
    step.at !== null && step.at > at ? { ...step, at: null, skipped: false } : step,
  );
  const paused = clock.pausedAt !== null && clock.pausedAt <= at;
  const changed =
    steps.some((step, i) => step !== clock.steps[i]) || (!paused && clock.pausedAt !== null);
  if (!changed) return clock;
  return {
    ...clock,
    steps,
    pausedAt: paused ? clock.pausedAt : null,
    blocked: paused ? clock.blocked : '',
  };
}

/**
 * Der Spielstand, wie er zur Zeit `at` war. Liegt `at` nicht vor dem heutigen Tag der Welt, ist
 * es der heutige. Nur zum Lesen.
 */
export function worldAt(data: CampaignData, at: WorldTime): CampaignData {
  const now = data.state.now;
  if (at >= now) return data;
  const t = Math.max(0, Math.floor(at));
  const all = chronicleSorted(data);
  const later = all.filter((entry) => entry.at > t);
  const sorts = sortsAround(all, t);

  // Die Chronik bis dahin.
  const chronicle: Docs<'chronicle'> = {};
  for (const entry of all) if (entry.at <= t) chronicle[entry.id] = entry;

  // Wen die Gruppe erst später zum ersten Mal traf; welche Namen erst später aufgedeckt wurden.
  const metLater = new Set<string>();
  const aliasLater = new Map<string, Set<string>>();
  for (const entry of later) {
    for (const id of entry.meeting?.firstMet ?? []) metLater.add(id);
    const alias = entry.kind === 'reveal' ? entry.reveal?.alias : null;
    if (alias?.added) {
      const names = aliasLater.get(alias.entityId) ?? new Set<string>();
      names.add(alias.name.trim().toLowerCase());
      aliasLater.set(alias.entityId, names);
    }
  }
  const holders = holdersAt(data, t);

  const entities: Docs<'entities'> = {};
  for (const entity of Object.values(data.entities)) {
    let next: Entity = entity;
    const dropped = aliasLater.get(entity.id);
    if (dropped)
      next = {
        ...next,
        aliases: next.aliases.filter((name) => !dropped.has(name.trim().toLowerCase())),
      };
    if (next.kind === 'person' || next.kind === 'character') {
      const status = stateOfSort<PersonStatus>(
        sorts,
        `fate:${entity.id}`,
        (e) => e.fate!.status,
        (e) => e.fate!.before ?? 'alive',
      );
      const placeId = stateOfSort<string | null>(
        sorts,
        `whereabouts:${entity.id}`,
        (e) => e.whereabouts!.placeId,
        (e) => e.whereabouts!.before,
      );
      if (next.kind === 'person') {
        const person = { ...next.person };
        if (status !== undefined) person.status = status;
        if (placeId !== undefined) person.placeId = placeId;
        if (metLater.has(entity.id)) person.met = false;
        next = { ...next, person };
      } else {
        const character = { ...next.character };
        if (status !== undefined) character.status = status;
        if (placeId !== undefined) character.placeId = placeId;
        const level = stateOfSort<number>(
          sorts,
          `milestone:${entity.id}`,
          (e) => e.milestone!.level!,
          (e) => e.milestone!.before ?? 1,
        );
        if (level !== undefined) character.level = level;
        const goal = stateOfSort<string>(
          sorts,
          `wish:${entity.id}`,
          (e) => e.text,
          (e) => e.wish!.before ?? '',
        );
        if (goal !== undefined) character.goal = goal;
        next = { ...next, character };
      }
    }
    if (next.kind === 'item' && holders.has(entity.id))
      next = { ...next, item: { ...next.item, holderId: holders.get(entity.id)! } };
    entities[entity.id] = next;
  }

  // Beziehungen: Haltungen nach ihren Einträgen; was erst später begann, gab es noch nicht.
  const bonds = relationStates(all, t);
  const relations: Docs<'relations'> = {};
  for (const relation of Object.values(data.relations)) {
    let next: Relation = relation;
    const state = bonds.get(relation.id);
    if (state === 'none') continue;
    if (state !== undefined) next = { ...next, ended: state === 'ended' };
    const attitude = stateOfSort<number | null>(
      sorts,
      `attitude:${relation.from}:${relation.to}`,
      (e) => e.attitude!.after,
      (e) => e.attitude!.before,
    );
    // Nur die Beziehung, die `findRelation` für die Haltung nimmt.
    if (attitude !== undefined && findRelation(data, relation.from, relation.to) === relation)
      next = { ...next, attitude };
    relations[relation.id] = next;
  }

  // Fäden: Hinweise, die erst später gefunden wurden, waren noch offen.
  // Wie der Faden vor dem ersten späteren Fund stand, sagt dieser Fund (`clue.before`).
  const threads: Docs<'threads'> = { ...data.threads };
  const firstFind = new Set<string>();
  for (const entry of later) {
    const c = entry.kind === 'clue' ? entry.clue : null;
    if (!c?.before || !c.threadId) continue;
    const thread = threads[c.threadId];
    if (!thread) continue;
    const hints = thread.hints.map((hint) =>
      hint.id === c.hintId ? { ...hint, found: false } : hint,
    );
    const first = !firstFind.has(c.threadId);
    firstFind.add(c.threadId);
    threads[c.threadId] = first
      ? { ...thread, hints, known: c.before.known, state: c.before.state }
      : { ...thread, hints };
  }

  // Abend-Blätter: Was erst später aufgedeckt wurde, war noch ein Geheimnis.
  const preps: Docs<'preps'> = {};
  for (const prep of Object.values(data.preps)) {
    const secrets = prep.secrets.map((secret) =>
      secret.revealed && secret.revealedAt !== null && secret.revealedAt > t
        ? { ...secret, revealed: false, revealedAt: null }
        : secret,
    );
    preps[prep.id] = secrets.some((s, i) => s !== prep.secrets[i]) ? { ...prep, secrets } : prep;
  }

  const clocks: Docs<'clocks'> = {};
  for (const clock of Object.values(data.clocks)) clocks[clock.id] = clockAt(clock, t);

  const loot: Docs<'loot'> = {};
  for (const item of Object.values(data.loot))
    loot[item.id] =
      item.given && item.at !== null && item.at > t
        ? { ...item, given: false, at: null, sessionId: null, placeId: null, chronicleId: null }
        : item;

  const handouts: Docs<'handouts'> = {};
  for (const handout of Object.values(data.handouts))
    handouts[handout.id] =
      handout.givenAt !== null && handout.givenAt > t
        ? { ...handout, givenAt: null, chronicleId: null }
        : handout;

  const guesses: Docs<'guesses'> = {};
  for (const guess of Object.values(data.guesses)) if (guess.at <= t) guesses[guess.id] = guess;

  const events: Docs<'events'> = {};
  for (const event of Object.values(data.events))
    events[event.id] =
      event.done && !event.repeat && event.at > t ? { ...event, done: false } : event;

  // Abende, die erst später begannen, gab es noch nicht; der damals laufende läuft.
  const session = sessionAt(data, t);
  const sessions: Docs<'sessions'> = {};
  for (const span of sessionSpans(data))
    if (span.from <= t) sessions[span.session.id] = span.session;

  return {
    ...data,
    chronicle,
    entities,
    relations,
    threads,
    preps,
    clocks,
    loot,
    handouts,
    guesses,
    events,
    sessions,
    state: {
      ...data.state,
      now: t,
      previousNow: null,
      placeId: partyPlaceAt(data, t),
      sessionId: session?.id ?? null,
    },
  };
}

// ── Was die Seite zeigt ────────────────────────────────────────────────────

/** Ein Wert damals – und ob er heute anders ist. */
export interface ThenAndNow<T> {
  then: T;
  today: T;
  changed: boolean;
}

const thenAndNow = <T>(then: T, today: T): ThenAndNow<T> => ({
  then,
  today,
  changed: then !== today,
});

export interface WorldOnLife {
  entity: Entity;
  /** Alter, Bestehen, Ende – damals gerechnet. */
  facts: LifeFact[];
  /** Damals schon gestorben, aufgelöst, zerstört. */
  gone: boolean;
}

export interface WorldOnMember {
  entity: Entity;
  level: ThenAndNow<number>;
  status: ThenAndNow<PersonStatus>;
  /** Zustände, die damals bestanden. */
  conditions: string[];
}

export interface WorldOnClock {
  clock: Clock;
  /** Was bis dahin eingetreten oder verhindert war, in der Reihenfolge der Uhr. */
  behind: StepView[];
  /** Was als Nächstes kam. */
  next: StepView | null;
}

export interface WorldOn {
  /** Der Zeitpunkt, für den gerechnet ist (nie nach dem heutigen Tag der Welt). */
  at: WorldTime;
  /** Gewünscht war ein Tag nach dem heutigen – gezeigt wird heute. */
  future: boolean;
  /** Der Spielstand damals – für alle weiteren Ableitungen. */
  view: CampaignData;
  ages: AgeSpan[];
  placeId: string | null;
  session: Session | null;
  /** Die Gefährten (die heute aktiven) – Stufe, Schicksal, Zustände damals. */
  party: WorldOnMember[];
  /** Was Lebensdaten hat und damals schon bestand – Lebewesen zuerst. */
  lives: WorldOnLife[];
  /** So viele Einträge mit Lebensdaten entstanden erst später. */
  notYet: number;
  /** Personen und Gefährten, die damals nicht (mehr) am Leben oder verschollen waren. */
  fates: { entity: Entity; status: ThenAndNow<PersonStatus> }[];
  /** Wo jemand damals war – nach den Einträgen der Art „Aufenthalt“. */
  whereabouts: { entity: Entity; placeId: ThenAndNow<string | null> }[];
  /** Haltungen zur Gruppe damals. */
  attitudes: { entity: Entity; value: ThenAndNow<number | null> }[];
  /** Gegenstände, deren Besitzer sich mit der Zeit geändert hat – bei wem sie damals waren. */
  holders: { entity: Entity; holderId: ThenAndNow<string | null> }[];
  /** Uhren, die damals schon liefen. */
  clocks: WorldOnClock[];
  /** Was die Gruppe damals wusste: je Abschnitt des Spielerbuchs die Zahl und die Namen. */
  knew: { label: string; count: number; names: string[] }[];
  /** Die letzten Einträge der Chronik bis dahin, der jüngste zuerst. */
  recent: ChronicleEntry[];
}

/** So viele Einträge der Chronik nennt „Zuletzt geschehen“. */
export const RECENT_ENTRIES = 6;

const LIVING_KINDS = new Set<Entity['kind']>(['person', 'character']);

const statusOfEntity = (entity: Entity | undefined): PersonStatus | null =>
  entity?.kind === 'person'
    ? entity.person.status
    : entity?.kind === 'character'
      ? entity.character.status
      : null;

const placeOfEntity = (entity: Entity | undefined): string | null | undefined =>
  entity?.kind === 'person'
    ? entity.person.placeId
    : entity?.kind === 'character'
      ? entity.character.placeId
      : undefined;

const byEntityName = (a: { entity: Entity }, b: { entity: Entity }) =>
  a.entity.name.localeCompare(b.entity.name, 'de');

/** Was „Welt an einem Tag“ zeigt: die Welt, wie sie zur Zeit `at` stand, neben der heutigen. */
export function worldOn(data: CampaignData, at: WorldTime): WorldOn {
  const now = data.state.now;
  const future = at > now;
  const t = Math.max(0, Math.min(at, now));
  const view = worldAt(data, t);
  const today = (id: string) => data.entities[id];

  const party: WorldOnMember[] = activeParty(view).map((character) => {
    const current = today(character.id);
    return {
      entity: character,
      level: thenAndNow(
        character.character.level,
        current?.kind === 'character' ? current.character.level : character.character.level,
      ),
      status: thenAndNow(character.character.status, statusOfEntity(current) ?? 'alive'),
      conditions: activeConditions(view, character.id).map((c) => c.entry.text.trim()),
    };
  });

  const lives: WorldOnLife[] = [];
  let notYet = 0;
  for (const entity of Object.values(view.entities)) {
    if (!entity.born && !entity.ended) continue;
    if (entity.born && entity.born.at > t) {
      notYet++;
      continue;
    }
    const facts = lifeFacts(view, entity);
    if (!facts.length) continue;
    lives.push({ entity, facts, gone: !!entity.ended && entity.ended.at <= t });
  }
  lives.sort(
    (a, b) =>
      Number(a.gone) - Number(b.gone) ||
      Number(!LIVING_KINDS.has(a.entity.kind)) - Number(!LIVING_KINDS.has(b.entity.kind)) ||
      a.entity.name.localeCompare(b.entity.name, 'de'),
  );

  const fates: WorldOn['fates'] = [];
  const whereabouts: WorldOn['whereabouts'] = [];
  const told = new Set<string>();
  for (const entry of Object.values(view.chronicle))
    if (entry.kind === 'whereabouts' && entry.whereabouts) told.add(entry.whereabouts.entityId);
  for (const entity of Object.values(view.entities)) {
    const status = statusOfEntity(entity);
    if (status === null) continue;
    const current = statusOfEntity(today(entity.id)) ?? status;
    if (status !== 'alive' || current !== status)
      fates.push({ entity, status: thenAndNow(status, current) });
    if (told.has(entity.id)) {
      const place = placeOfEntity(entity) ?? null;
      whereabouts.push({
        entity,
        placeId: thenAndNow(place, placeOfEntity(today(entity.id)) ?? null),
      });
    }
  }

  const attitudes: WorldOn['attitudes'] = [];
  for (const relation of Object.values(view.relations)) {
    if (relation.to !== PARTY_ID || relation.ended) continue;
    const entity = view.entities[relation.from];
    if (!entity || findRelation(view, relation.from, PARTY_ID) !== relation) continue;
    const current = findRelation(data, relation.from, PARTY_ID)?.attitude ?? null;
    if (relation.attitude === null && current === null) continue;
    attitudes.push({ entity, value: thenAndNow(relation.attitude, current) });
  }

  const moved = holdersAt(data, Number.MAX_SAFE_INTEGER);
  const holders: WorldOn['holders'] = [];
  for (const id of moved.keys()) {
    const entity = view.entities[id];
    if (entity?.kind !== 'item') continue;
    const current = today(id);
    holders.push({
      entity,
      holderId: thenAndNow(
        entity.item.holderId,
        current?.kind === 'item' ? current.item.holderId : null,
      ),
    });
  }

  const clocks: WorldOnClock[] = Object.values(view.clocks)
    .filter((clock) => clock.start <= t && clock.steps.length > 0)
    .map((clock) => {
      const v = clockView(clock, t);
      return {
        clock,
        behind: v.steps.filter((s) => s.state === 'done' || s.state === 'prevented'),
        next: v.next,
      };
    })
    .sort(
      (a, b) =>
        Number(a.next === null) - Number(b.next === null) ||
        a.clock.title.localeCompare(b.clock.title, 'de'),
    );

  const knew: WorldOn['knew'] = [];
  for (const section of playerBook(view).sections) {
    if (section.sort === 'things')
      knew.push({
        label: section.label,
        count: section.things.length,
        names: section.things.map((thing) => thing.name),
      });
    else if (section.sort === 'lines')
      knew.push({ label: section.label, count: section.entries.length, names: [] });
    else if (section.sort === 'handouts')
      knew.push({
        label: section.label,
        count: section.handouts.length,
        names: section.handouts.map((h) => h.title.trim()).filter(Boolean),
      });
  }

  const recent = Object.values(view.chronicle).sort(byTime).slice(-RECENT_ENTRIES).reverse();

  return {
    at: t,
    future,
    view,
    ages: agesAt(data, t),
    placeId: view.state.placeId,
    session: view.state.sessionId ? (view.sessions[view.state.sessionId] ?? null) : null,
    party,
    lives,
    notYet,
    fates: fates.sort(byEntityName),
    whereabouts: whereabouts.sort(byEntityName),
    attitudes: attitudes.sort(byEntityName),
    holders: holders.sort(byEntityName),
    clocks,
    knew,
    recent,
  };
}
