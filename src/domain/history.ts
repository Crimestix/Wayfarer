/**
 * Die Chronik als Geschichte lesen: Was galt zu einer Zeit? Wo war die Gruppe, welche Session lief,
 * welcher Eintrag ist der jüngste seiner Sorte, welche Zustände sind noch offen? Reine Funktionen –
 * die Befehle dazu stehen in `data/record.ts`.
 *
 * Grundregel: Ein Eintrag ist Geschichte. Seine Wirkung auf den heutigen Stand gilt nur, wenn er
 * der jüngste seiner Sorte für dasselbe Ding ist (`isNewestOfSort`).
 */
import { byTime, chronicleSorted, normalize, sessionsSorted } from './derive';
import {
  PARTY_ID,
  type CampaignData,
  type ChronicleEntry,
  type PersonStatus,
  type Session,
} from './schema';
import type { WorldTime } from './time/calendar';

// ── Sessions ───────────────────────────────────────────────────────────────

export interface SessionSpan {
  session: Session;
  /** Beginn in Weltzeit: Session-Beginn oder ihr frühester Eintrag. */
  from: WorldTime;
  /** Ende in Weltzeit; null = die Session läuft noch. */
  to: WorldTime | null;
  running: boolean;
  entryCount: number;
}

/** Weltzeit und Umfang jeder Session, nach Nummer sortiert. */
export function sessionSpans(data: CampaignData): SessionSpan[] {
  const stats = new Map<string, { min: number; max: number; count: number }>();
  for (const entry of Object.values(data.chronicle)) {
    if (!entry.sessionId) continue;
    const s = stats.get(entry.sessionId);
    if (s) {
      s.min = Math.min(s.min, entry.at);
      s.max = Math.max(s.max, entry.at);
      s.count++;
    } else stats.set(entry.sessionId, { min: entry.at, max: entry.at, count: 1 });
  }
  return sessionsSorted(data).map((session) => {
    const s = stats.get(session.id);
    const running = data.state.sessionId === session.id;
    const end = running ? null : (session.endAt ?? session.startAt);
    return {
      session,
      from: s ? Math.min(session.startAt, s.min) : session.startAt,
      to: end === null ? null : s ? Math.max(end, s.max) : end,
      running,
      entryCount: s?.count ?? 0,
    };
  });
}

/** Die Session, in deren Weltzeit ein Zeitpunkt fällt – bei Überschneidung die spätere. */
export function sessionAt(data: CampaignData, at: WorldTime): Session | null {
  const hit = sessionSpans(data)
    .filter((span) => span.from <= at && at <= (span.to ?? Math.max(data.state.now, span.from)))
    .sort((a, b) => b.from - a.from || b.session.number - a.session.number)[0];
  return hit?.session ?? null;
}

/**
 * Die Session für einen neuen Eintrag zur Zeit `at`: jetzt die laufende (oder keine), früher die,
 * in deren Weltzeit `at` fällt.
 */
export function sessionForEntry(data: CampaignData, at: WorldTime): string | null {
  if (at === data.state.now) return data.state.sessionId;
  return sessionAt(data, at)?.id ?? null;
}

// ── Ort der Gruppe ─────────────────────────────────────────────────────────

const travels = (data: CampaignData) =>
  chronicleSorted(data).filter((entry) => entry.kind === 'travel' && entry.travel);

/**
 * Wo die Gruppe zur Zeit `at` war – aus den Ortswechseln der Chronik abgeleitet: das Ziel des
 * letzten Ortswechsels bis `at`. Gab es davor keinen, der Ausgangsort des nächsten; gibt es gar
 * keinen, der heutige Ort.
 */
export function partyPlaceAt(data: CampaignData, at: WorldTime): string | null {
  const all = travels(data);
  let last: ChronicleEntry | null = null;
  for (const entry of all) if (entry.at <= at) last = entry;
  if (last) return last.travel!.toId;
  const next = all.find((entry) => entry.at > at);
  return next ? next.travel!.fromId : data.state.placeId;
}

/** Der Ort für einen neuen Eintrag zur Zeit `at`: jetzt der Ort der Gruppe, früher der damalige. */
export function placeForEntry(data: CampaignData, at: WorldTime): string | null {
  return at === data.state.now ? data.state.placeId : partyPlaceAt(data, at);
}

// ── Sorten: der jüngste Eintrag zählt ──────────────────────────────────────

/**
 * Die Sorte eines Eintrags: Einträge derselben Sorte betreffen dasselbe Ding auf dieselbe Weise,
 * und nur der jüngste von ihnen bestimmt den heutigen Stand. null = der Eintrag hat keine
 * solche Wirkung.
 */
export function sortKeyOf(entry: ChronicleEntry): string | null {
  switch (entry.kind) {
    case 'travel':
      return entry.travel ? 'travel' : null;
    case 'attitude':
      return entry.attitude ? `attitude:${entry.attitude.fromId}:${entry.attitude.toId}` : null;
    case 'fate':
      return entry.fate ? `fate:${entry.fate.entityId}` : null;
    case 'whereabouts':
      return entry.whereabouts ? `whereabouts:${entry.whereabouts.entityId}` : null;
    case 'milestone':
      return entry.milestone && entry.milestone.level !== null
        ? `milestone:${entry.milestone.characterId}`
        : null;
    case 'bond':
      return entry.bond ? `bond:${entry.bond.fromId}:${entry.bond.toId}:${entry.bond.type}` : null;
    case 'wish':
      // Nur ein Wunsch, der Ziel des Gefährten wurde, bestimmt einen Stand: sein heutiges Ziel.
      return entry.wish?.setGoal && entry.refs[0] ? `wish:${entry.refs[0]}` : null;
    case 'companion':
      return entry.companion ? `companion:${entry.companion.entityId}` : null;
    default:
      return null;
  }
}

/** Alle Einträge derselben Sorte, älteste zuerst (mit dem Eintrag selbst, wenn er gespeichert ist). */
export function sameSort(data: CampaignData, entry: ChronicleEntry): ChronicleEntry[] {
  const key = sortKeyOf(entry);
  if (!key) return [];
  return Object.values(data.chronicle)
    .filter((other) => sortKeyOf(other) === key)
    .sort(byTime);
}

/** Der Eintrag derselben Sorte unmittelbar davor bzw. danach (ohne den Eintrag selbst). */
export function neighboursOfSort(
  data: CampaignData,
  entry: ChronicleEntry,
): { previous: ChronicleEntry | null; next: ChronicleEntry | null } {
  const others = sameSort(data, entry).filter((other) => other.id !== entry.id);
  let previous: ChronicleEntry | null = null;
  let next: ChronicleEntry | null = null;
  for (const other of others) {
    if (byTime(other, entry) < 0) previous = other;
    else if (!next) next = other;
  }
  return { previous, next };
}

/** Ist der Eintrag der jüngste seiner Sorte? Nur dann bestimmt er den heutigen Stand. */
export function isNewestOfSort(data: CampaignData, entry: ChronicleEntry): boolean {
  return sortKeyOf(entry) !== null && neighboursOfSort(data, entry).next === null;
}

// ── Zustände ───────────────────────────────────────────────────────────────

export interface ActiveCondition {
  /** Der Eintrag, mit dem der Zustand begann; sein Text ist der Zustand. */
  entry: ChronicleEntry;
  since: WorldTime;
}

const isConditionStart = (entry: ChronicleEntry) =>
  entry.kind === 'condition' && !!entry.condition && !entry.condition.ended;
const isConditionEnd = (entry: ChronicleEntry) =>
  entry.kind === 'condition' && !!entry.condition?.ended;

/**
 * Welcher Beginn eines Zustands von welchem Ende aufgehoben wird. Ein Ende nennt seinen Beginn
 * (`endsId`); ohne diese Angabe hebt es den jüngsten offenen Zustand derselben Person mit
 * gleichem Wortlaut auf – sonst nichts.
 */
function conditionEndings(data: CampaignData): Map<string, ChronicleEntry> {
  const ended = new Map<string, ChronicleEntry>();
  const all = chronicleSorted(data);
  for (const end of all) {
    if (!isConditionEnd(end)) continue;
    const endsId = end.condition!.endsId;
    if (endsId) {
      const start = data.chronicle[endsId];
      if (start && isConditionStart(start) && !ended.has(endsId)) ended.set(endsId, end);
      continue;
    }
    const words = normalize(end.text);
    const start = all
      .filter(
        (candidate) =>
          isConditionStart(candidate) &&
          candidate.condition!.entityId === end.condition!.entityId &&
          byTime(candidate, end) < 0 &&
          !ended.has(candidate.id) &&
          normalize(candidate.text) === words,
      )
      .at(-1);
    if (start) ended.set(start.id, end);
  }
  return ended;
}

/** Der Eintrag, der einen Zustand aufgehoben hat; null = er besteht noch. */
export function conditionEnding(data: CampaignData, entryId: string): ChronicleEntry | null {
  return conditionEndings(data).get(entryId) ?? null;
}

/**
 * Offene Zustände einer Person oder eines Gefährten zur Zeit `at` (Vorgabe: jetzt), älteste
 * zuerst: begonnen bis dahin und bis dahin nicht aufgehoben.
 */
export function activeConditions(
  data: CampaignData,
  entityId: string,
  at: WorldTime = data.state.now,
): ActiveCondition[] {
  const endings = conditionEndings(data);
  return chronicleSorted(data)
    .filter(
      (entry) =>
        isConditionStart(entry) &&
        entry.condition!.entityId === entityId &&
        entry.at <= at &&
        !((endings.get(entry.id)?.at ?? Infinity) <= at),
    )
    .map((entry) => ({ entry, since: entry.at }));
}

// ── Seit wann ──────────────────────────────────────────────────────────────

/** Das heutige Schicksal einer Person oder eines Gefährten; null bei anderen Einträgen. */
export function statusOf(data: CampaignData, entityId: string): PersonStatus | null {
  const entity = data.entities[entityId];
  if (entity?.kind === 'person') return entity.person.status;
  if (entity?.kind === 'character') return entity.character.status;
  return null;
}

/**
 * Seit wann eine Person oder ein Gefährte in ihrem heutigen Zustand ist (tot, verschollen …):
 * der jüngste Eintrag der Art „Schicksal“, der genau diesen Zustand gesetzt hat. null, wenn
 * keiner dazu passt.
 */
export function fateSince(
  data: CampaignData,
  personId: string,
): { status: PersonStatus; since: WorldTime; entry: ChronicleEntry } | null {
  const status = statusOf(data, personId);
  if (status === null) return null;
  const entry = chronicleSorted(data)
    .filter((e) => e.kind === 'fate' && e.fate?.entityId === personId)
    .at(-1);
  if (!entry || entry.fate!.status !== status) return null;
  return { status: entry.fate!.status, since: entry.at, entry };
}

/**
 * Seit wann eine Person oder ein Gefährte an ihrem heutigen Aufenthaltsort ist: der jüngste
 * Eintrag der Art „Aufenthalt“, wenn er zum heutigen Ort passt.
 */
export function whereaboutsSince(
  data: CampaignData,
  entityId: string,
): { placeId: string | null; since: WorldTime; entry: ChronicleEntry } | null {
  const entity = data.entities[entityId];
  const current =
    entity?.kind === 'person'
      ? entity.person.placeId
      : entity?.kind === 'character'
        ? entity.character.placeId
        : undefined;
  if (current === undefined) return null;
  const entry = chronicleSorted(data)
    .filter((e) => e.kind === 'whereabouts' && e.whereabouts?.entityId === entityId)
    .at(-1);
  if (!entry || entry.whereabouts!.placeId !== current) return null;
  return { placeId: current, since: entry.at, entry };
}

// ── Wen ein Eintrag nennt ──────────────────────────────────────────────────

/**
 * Alle Einträge der Weltdatenbank, die ein Chronik-Eintrag nennt: Verweise, Ort und die Dinge
 * aus seinen Angaben (Reiseziel, Haltung, Schicksal, Beziehung …).
 */
export function entryEntityIds(entry: ChronicleEntry): string[] {
  const ids = new Set(entry.refs);
  const add = (id: string | null | undefined) => {
    if (id) ids.add(id);
  };
  add(entry.placeId);
  add(entry.travel?.fromId);
  add(entry.travel?.toId);
  add(entry.attitude?.fromId);
  add(entry.attitude?.toId);
  add(entry.fate?.entityId);
  add(entry.whereabouts?.entityId);
  add(entry.whereabouts?.placeId);
  add(entry.rumor?.sourceId);
  add(entry.bond?.fromId);
  add(entry.bond?.toId);
  add(entry.condition?.entityId);
  add(entry.milestone?.characterId);
  add(entry.transformation?.characterId);
  add(entry.companion?.entityId);
  add(entry.companion?.ownerId);
  add(entry.reveal?.alias?.entityId);
  for (const activity of entry.downtime?.activities ?? []) add(activity.characterId);
  add(entry.trade?.toId);
  for (const line of entry.trade?.lines ?? []) add(line.entityId);
  return [...ids];
}

// ── Gefährten ──────────────────────────────────────────────────────────────

/** Die Wandlungen eines Gefährten (neue Kräfte, Gestalt …), die jüngste zuerst – für seine Seite. */
export function transformationsOf(data: CampaignData, characterId: string): ChronicleEntry[] {
  return chronicleSorted(data)
    .filter(
      (entry) =>
        entry.kind === 'transformation' && entry.transformation?.characterId === characterId,
    )
    .reverse();
}

export interface PartyCompanion {
  /** Das Tier oder Wesen (Eintrag der Art „person“). */
  entityId: string;
  /** Der Gefährte, zu dem es gehört; null = die ganze Gruppe. */
  ownerId: string | null;
  relationId: string;
}

/**
 * Begleiter der Gruppe: Tiere und Wesen, die gerade mit ihr ziehen – aus den Beziehungen der Art
 * „companion“ (gesetzt über Einträge der Art „Begleiter“). Mit `ownerId` nur die eines Gefährten.
 */
export function partyCompanions(data: CampaignData, ownerId?: string): PartyCompanion[] {
  return Object.values(data.relations)
    .filter((relation) => {
      if (relation.type !== 'companion' || relation.ended) return false;
      if (!data.entities[relation.from]) return false;
      const owner = relation.to === PARTY_ID ? null : relation.to;
      if (owner !== null && data.entities[owner]?.kind !== 'character') return false;
      return ownerId === undefined || owner === ownerId;
    })
    .map((relation) => ({
      entityId: relation.from,
      ownerId: relation.to === PARTY_ID ? null : relation.to,
      relationId: relation.id,
    }))
    .sort((a, b) =>
      (data.entities[a.entityId]?.name ?? '').localeCompare(
        data.entities[b.entityId]?.name ?? '',
        'de',
      ),
    );
}

/**
 * Zweite Gestalten eines Gefährten oder einer Person: eigene Einträge, verbunden über eine
 * Beziehung der Art „persona“ (die zweite Gestalt → der Gefährte).
 */
export function personasOf(data: CampaignData, entityId: string): string[] {
  return Object.values(data.relations)
    .filter(
      (relation) =>
        relation.type === 'persona' &&
        !relation.ended &&
        relation.to === entityId &&
        !!data.entities[relation.from],
    )
    .map((relation) => relation.from);
}
