/**
 * Fachlogik der Chronik: filtern, nach Tagen gliedern, Session-Grenzen, Bearbeiten von Einträgen
 * und die Zusammenfassung einer Session als reiner Text. Reine Funktionen ohne React.
 */
import {
  byTime,
  chronicleSorted,
  entityName,
  findRelation,
  normalize,
  placeSubtreeIds,
  sessionsSorted,
} from '../../domain/derive';
import { attitudeLabel } from '../../domain/relations';
import {
  PARTY_ID,
  createChronicleEntry,
  type CampaignData,
  type ChronicleEntry,
  type ChronicleKind,
  type Session,
} from '../../domain/schema';
import {
  MINUTES_PER_DAY,
  absoluteYear,
  dayIndexOf,
  displayYear,
  formatClock,
  formatDate,
  formatDateTime,
  formatDayMonth,
  formatDuration,
  formatRelative,
  formatYear,
  fromTime,
  isValidDate,
  toTime,
  weekdayName,
  type CalendarDef,
  type WorldTime,
} from '../../domain/time/calendar';

// ── Arten ──────────────────────────────────────────────────────────────────

/** Kurze Bezeichnungen für Filter und Zusammenfassung. */
export const KIND_SHORT: Record<ChronicleKind, string> = {
  note: 'Notiz',
  travel: 'Ortswechsel',
  attitude: 'Haltung',
  event: 'Termin',
  promise: 'Abmachung',
  change: 'Veränderung',
};

/** Arten, die der Spielleiter selbst schreibt. Alle anderen entstehen automatisch. */
export const MANUAL_KINDS = ['note', 'change', 'promise'] as const;
export type ManualKind = (typeof MANUAL_KINDS)[number];

export const isManualKind = (kind: ChronicleKind): kind is ManualKind =>
  (MANUAL_KINDS as readonly string[]).includes(kind);

/** Ist die Abmachung offen und ihre Frist verstrichen? */
export function isOverdue(entry: ChronicleEntry, now: WorldTime): boolean {
  return (
    !!entry.promise && !entry.promise.done && entry.promise.due !== null && entry.promise.due < now
  );
}

/** Frist, die für eine neue Abmachung vorgeschlagen wird: in einer Woche, am Ende des Tages. */
export function defaultDue(now: WorldTime): WorldTime {
  return (dayIndexOf(now) + 8) * MINUTES_PER_DAY - 1;
}

/** Frist einer offenen Abmachung in wenigen Worten: „Seit 3 Tagen überfällig · 12. Tauwind“. */
export function promiseDueLabel(cal: CalendarDef, entry: ChronicleEntry, now: WorldTime): string {
  const due = entry.promise?.due ?? null;
  if (due === null) return 'Ohne Frist';
  if (!isOverdue(entry, now))
    return `Frist ${formatDayMonth(cal, due)} · ${formatRelative(now, due)}`;
  const days = dayIndexOf(now) - dayIndexOf(due);
  const since = days === 0 ? 'Seit heute' : days === 1 ? 'Seit gestern' : `Seit ${days} Tagen`;
  return `${since} überfällig · ${formatDayMonth(cal, due)}`;
}

/** Mit wem eine Abmachung besteht: die verknüpften Einträge ohne den Ort des Geschehens. */
export function promiseParties(data: CampaignData, entry: ChronicleEntry): string[] {
  return entry.refs
    .filter((id) => id !== entry.placeId && data.entities[id])
    .map((id) => entityName(data, id));
}

// ── Filter ─────────────────────────────────────────────────────────────────

export interface ChronicleFilter {
  /** Leer = alle Arten. */
  kinds: ChronicleKind[];
  /** 'all' = jede Session, 'none' = Einträge ohne Session, sonst die ID einer Session. */
  session: string;
  /** Nur Einträge, die diesen Eintrag der Weltdatenbank betreffen. */
  entityId: string | null;
  /** Nur was an diesem Ort oder einem Ort darunter geschah. */
  placeId: string | null;
  query: string;
  /** Vorwahl „Offene Abmachungen“. */
  openPromisesOnly: boolean;
}

export const EMPTY_FILTER: ChronicleFilter = {
  kinds: [],
  session: 'all',
  entityId: null,
  placeId: null,
  query: '',
  openPromisesOnly: false,
};

export function isFilterActive(filter: ChronicleFilter): boolean {
  return (
    filter.kinds.length > 0 ||
    filter.session !== 'all' ||
    filter.entityId !== null ||
    filter.placeId !== null ||
    filter.query.trim() !== '' ||
    filter.openPromisesOnly
  );
}

/** Nimmt Filter zurück, deren Session, Eintrag oder Ort es nicht mehr gibt. */
export function sanitizeFilter(data: CampaignData, filter: ChronicleFilter): ChronicleFilter {
  const session =
    filter.session === 'all' || filter.session === 'none' || data.sessions[filter.session]
      ? filter.session
      : 'all';
  const entityId =
    filter.entityId && filter.entityId !== PARTY_ID && !data.entities[filter.entityId]
      ? null
      : filter.entityId;
  const placeId = filter.placeId && !data.entities[filter.placeId] ? null : filter.placeId;
  if (session === filter.session && entityId === filter.entityId && placeId === filter.placeId)
    return filter;
  return { ...filter, session, entityId, placeId };
}

/** Alle Einträge der Weltdatenbank, die ein Chronik-Eintrag nennt – auch Ort, Reiseziel, Haltung. */
export function involvedIds(entry: ChronicleEntry): string[] {
  const ids = new Set(entry.refs);
  if (entry.placeId) ids.add(entry.placeId);
  if (entry.travel?.fromId) ids.add(entry.travel.fromId);
  if (entry.travel?.toId) ids.add(entry.travel.toId);
  if (entry.attitude) {
    ids.add(entry.attitude.fromId);
    ids.add(entry.attitude.toId);
  }
  return [...ids];
}

/**
 * Suchtext je Eintrag: eigener Text, Art und die Namen von allem, was er nennt.
 * Einmal berechnen und für jede Suche wiederverwenden.
 */
export function buildSearchIndex(data: CampaignData): Map<string, string> {
  const index = new Map<string, string>();
  for (const entry of Object.values(data.chronicle)) {
    const parts = [entry.text, KIND_SHORT[entry.kind]];
    for (const id of involvedIds(entry)) parts.push(entityName(data, id));
    if (entry.attitude)
      parts.push(attitudeLabel(entry.attitude.before), attitudeLabel(entry.attitude.after));
    index.set(entry.id, normalize(parts.join(' ')));
  }
  return index;
}

/** Wendet den Filter an. Die Reihenfolge der Einträge bleibt erhalten. */
export function filterEntries(
  data: CampaignData,
  entries: ChronicleEntry[],
  filter: ChronicleFilter,
  searchIndex: Map<string, string> = buildSearchIndex(data),
): ChronicleEntry[] {
  if (!isFilterActive(filter)) return entries;
  const kinds = filter.kinds.length ? new Set<ChronicleKind>(filter.kinds) : null;
  const placeIds = filter.placeId ? placeSubtreeIds(data, filter.placeId) : null;
  const words = normalize(filter.query).split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (kinds && !kinds.has(entry.kind)) return false;
    if (
      filter.openPromisesOnly &&
      !(entry.kind === 'promise' && entry.promise && !entry.promise.done)
    )
      return false;
    if (
      filter.session === 'none'
        ? entry.sessionId !== null
        : filter.session !== 'all' && entry.sessionId !== filter.session
    )
      return false;
    if (filter.entityId || placeIds) {
      const ids = involvedIds(entry);
      if (filter.entityId && !ids.includes(filter.entityId)) return false;
      if (placeIds && !ids.some((id) => placeIds.has(id))) return false;
    }
    if (words.length) {
      const text = searchIndex.get(entry.id) ?? '';
      if (!words.every((word) => text.includes(word))) return false;
    }
    return true;
  });
}

/** Welche Einträge der Weltdatenbank in diesen Chronik-Einträgen am häufigsten vorkommen. */
export function mentionCounts(
  entries: ChronicleEntry[],
  limit = 10,
): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const entry of entries)
    for (const id of involvedIds(entry))
      if (id !== PARTY_ID) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

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

/** Weltzeit, die eine Session bisher umfasst (bei der laufenden: bis jetzt). */
export function spanDuration(span: SessionSpan, now: WorldTime): number {
  return Math.max(0, (span.to ?? Math.max(now, span.from)) - span.from);
}

/** Die Session, in deren Weltzeit ein Zeitpunkt fällt – bei Überschneidung die spätere. */
export function sessionAt(data: CampaignData, at: WorldTime): Session | null {
  const hit = sessionSpans(data)
    .filter((span) => span.from <= at && at <= (span.to ?? Math.max(data.state.now, span.from)))
    .sort((a, b) => b.from - a.from || b.session.number - a.session.number)[0];
  return hit?.session ?? null;
}

/**
 * Die Session, die sich fortsetzen lässt: die jüngste, solange keine läuft. So lässt sich ein
 * versehentliches Beenden zurücknehmen oder ein Abend nach einer Pause weiterführen.
 */
export function resumableSessionId(data: CampaignData): string | null {
  if (data.state.sessionId && data.sessions[data.state.sessionId]) return null;
  const sessions = sessionsSorted(data);
  return sessions[sessions.length - 1]?.id ?? null;
}

/** Zeitpunkt, der beim Nachtragen zu einer Session vorgeschlagen wird: ihr Ende, bei der laufenden jetzt. */
export function sessionBackfillTime(data: CampaignData, sessionId: string): WorldTime {
  const span = sessionSpans(data).find((s) => s.session.id === sessionId);
  return Math.min(span?.to ?? data.state.now, data.state.now);
}

/** „Session 12 – Die Glocke“ bzw. „Session 12“. Ein Titel, der nur die Nummer wiederholt, entfällt. */
export function sessionLabel(session: Session): string {
  const name = `Session ${session.number}`;
  const title = session.title.trim();
  return title && title.toLowerCase() !== name.toLowerCase() ? `${name} – ${title}` : name;
}

/** Der Titel ohne die bloße Wiederholung von „Session 12“. */
export function sessionTitle(session: Session): string {
  const title = session.title.trim();
  return title.toLowerCase() === `session ${session.number}` ? '' : title;
}

// ── Zeitstrahl ─────────────────────────────────────────────────────────────

export interface SessionMarker {
  session: Session;
  edge: 'start' | 'end';
  at: WorldTime;
}

export type TimelineRow =
  | { type: 'day'; day: number; count: number }
  | { type: 'entry'; entry: ChronicleEntry }
  /** `dated`: Die Grenze steht nicht bei Einträgen ihres eigenen Tages und braucht deshalb ein Datum. */
  | ({ type: 'marker'; dated: boolean } & SessionMarker);

/**
 * Grenzen der Sessions für den Zeitstrahl. Mit `onlySessionIds` nur für Sessions, von denen
 * überhaupt etwas zu sehen ist (bei aktivem Filter).
 */
export function sessionMarkers(
  spans: SessionSpan[],
  onlySessionIds?: Set<string>,
): SessionMarker[] {
  const markers: SessionMarker[] = [];
  for (const span of spans) {
    if (onlySessionIds && !onlySessionIds.has(span.session.id)) continue;
    markers.push({ session: span.session, edge: 'start', at: span.from });
    if (span.to !== null) markers.push({ session: span.session, edge: 'end', at: span.to });
  }
  return markers;
}

/**
 * Baut die Zeilen des Zeitstrahls: Tagesüberschriften, Einträge und Session-Grenzen.
 * `entries` müssen zeitlich aufsteigend sortiert sein. Eine Session beginnt vor und endet nach
 * den Einträgen desselben Zeitpunkts.
 */
export function timelineRows(
  entries: ChronicleEntry[],
  markers: SessionMarker[],
  newestFirst: boolean,
): TimelineRow[] {
  // Reihenfolge am selben Zeitpunkt: erst das Ende der älteren Session, dann Einträge ohne
  // Session, dann der Beginn der neueren – jede Session umschließt ihre eigenen Einträge.
  type Item = { at: number; group: number; rank: number; seq: number; row: TimelineRow };
  const numberOf = new Map(markers.map((m) => [m.session.id, m.session.number]));
  const firstStartAt = new Map<number, number>();
  for (const m of markers)
    if (m.edge === 'start')
      firstStartAt.set(m.at, Math.min(firstStartAt.get(m.at) ?? Infinity, m.session.number));
  const items: Item[] = [];
  entries.forEach((entry, seq) => {
    const number = entry.sessionId ? numberOf.get(entry.sessionId) : undefined;
    const group =
      number ?? (firstStartAt.has(entry.at) ? firstStartAt.get(entry.at)! - 0.5 : Infinity);
    items.push({ at: entry.at, group, rank: 1, seq, row: { type: 'entry', entry } });
  });
  markers.forEach((marker, seq) =>
    items.push({
      at: marker.at,
      group: marker.session.number,
      rank: marker.edge === 'start' ? 0 : 2,
      seq,
      row: { type: 'marker', dated: false, ...marker },
    }),
  );
  items.sort((a, b) => a.at - b.at || a.group - b.group || a.rank - b.rank || a.seq - b.seq);
  if (newestFirst) items.reverse();

  const perDay = new Map<number, number>();
  for (const entry of entries) {
    const day = dayIndexOf(entry.at);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  // Eine Grenze steht optisch bei den Einträgen davor und danach. Liegt sie an keinem dieser
  // beiden Tage, wäre ohne eigenes Datum nicht zu erkennen, wann die Session begann oder endete.
  const neighbourDay = (from: number, step: 1 | -1): number | null => {
    for (let i = from + step; i >= 0 && i < items.length; i += step) {
      const row = items[i]!.row;
      if (row.type === 'entry') return dayIndexOf(row.entry.at);
    }
    return null;
  };
  items.forEach((item, i) => {
    if (item.row.type !== 'marker') return;
    const day = dayIndexOf(item.row.at);
    item.row.dated = neighbourDay(i, -1) !== day && neighbourDay(i, 1) !== day;
  });

  const rows: TimelineRow[] = [];
  let currentDay: number | null = null;
  for (const item of items) {
    if (item.row.type === 'entry') {
      const day = dayIndexOf(item.row.entry.at);
      if (day !== currentDay) {
        rows.push({ type: 'day', day, count: perDay.get(day) ?? 0 });
        currentDay = day;
      }
    }
    rows.push(item.row);
  }
  return rows;
}

/** „heute“, „gestern“, „vor 3 Tagen“, „in 2 Tagen“ – auf ganze Welt-Tage bezogen. */
export function relativeDay(today: number, day: number): string {
  const diff = day - today;
  if (diff === 0) return 'heute';
  if (diff === -1) return 'gestern';
  if (diff === 1) return 'morgen';
  if (diff === -2) return 'vorgestern';
  return diff < 0 ? `vor ${-diff} Tagen` : `in ${diff} Tagen`;
}

/** Zeitraum in Weltzeit, so knapp wie möglich: „8.–17. Tauwind 701 AD“. */
export function formatWorldRange(cal: CalendarDef, from: WorldTime, to: WorldTime): string {
  const a = fromTime(cal, from);
  const b = fromTime(cal, to);
  if (from === to) return formatDateTime(cal, from);
  if (a.dayIndex === b.dayIndex)
    return `${formatDate(cal, from)}, ${formatClock(from)}–${formatClock(to)}`;
  if (a.year === b.year && a.month === b.month)
    return `${a.day}.–${b.day}. ${cal.months[a.month]!.name} ${formatYear(cal, a.year)}`;
  if (a.year === b.year) return `${formatDayMonth(cal, from)} – ${formatDate(cal, to)}`;
  return `${formatDate(cal, from)} – ${formatDate(cal, to)}`;
}

/** Echtes Datum eines Spielabends (JJJJ-MM-TT) in Worten: „Di., 3. November 2026“. */
export function formatRealDate(iso: string, weekday: 'short' | 'long' = 'short'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return iso.trim();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return iso.trim();
  return new Intl.DateTimeFormat('de-DE', {
    weekday,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Echtes Datum für das Eingabefeld: „03.11.2026“. */
export function realDateInput(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  return match ? `${match[3]}.${match[2]}.${match[1]}` : iso.trim();
}

/**
 * Liest ein echtes Datum, wie man es tippt: „3.11.2026“, „03.11.26“ oder „2026-11-03“.
 * Leere Eingabe ergibt '', eine unlesbare null.
 */
export function parseRealDate(input: string): string | null {
  const text = input.trim();
  if (!text) return '';
  let year: number, month: number, day: number;
  const german = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2}|\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (german) {
    day = Number(german[1]);
    month = Number(german[2]);
    year = Number(german[3]);
    if (german[3]!.length === 2) year += 2000;
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

// ── Zeitpunkt eingeben ─────────────────────────────────────────────────────

/** Ein Zeitpunkt im Weltkalender, wie er in den Eingabefeldern steht. */
export interface TimeDraft {
  day: string;
  month: number;
  /** Jahr in der Hauptzeitrechnung. */
  year: string;
  hour: string;
  minute: string;
}

export function timeDraftOf(cal: CalendarDef, time: WorldTime): TimeDraft {
  const d = fromTime(cal, time);
  return {
    day: String(d.day),
    month: d.month,
    year: String(displayYear(cal, d.year)),
    hour: String(d.hour).padStart(2, '0'),
    minute: String(d.minute).padStart(2, '0'),
  };
}

/** Weltzeit der Eingabe; null, wenn es dieses Datum im Kalender nicht gibt. */
export function timeOfDraft(cal: CalendarDef, draft: TimeDraft): WorldTime | null {
  const filled = [draft.day, draft.year, draft.hour, draft.minute].every((v) => v.trim() !== '');
  if (!filled) return null;
  const parts = {
    year: absoluteYear(cal, Number(draft.year)),
    month: draft.month,
    day: Number(draft.day),
    hour: Number(draft.hour),
    minute: Number(draft.minute),
  };
  return isValidDate(cal, parts) ? toTime(cal, parts) : null;
}

// ── Einträge bearbeiten ────────────────────────────────────────────────────

/** Verweise, die zur Bedeutung eines automatischen Eintrags gehören und nicht entfernt werden. */
export function lockedRefs(entry: ChronicleEntry): string[] {
  const ids: string[] = [];
  if (entry.travel) {
    if (entry.travel.toId) ids.push(entry.travel.toId);
    if (entry.travel.fromId) ids.push(entry.travel.fromId);
  }
  if (entry.attitude)
    for (const id of [entry.attitude.fromId, entry.attitude.toId])
      if (id !== PARTY_ID) ids.push(id);
  return ids;
}

/** Was der Bearbeiten-Dialog verändern kann. */
export interface EntryDraft {
  kind: ChronicleKind;
  text: string;
  at: WorldTime;
  placeId: string | null;
  /** Frei gewählte Verweise – ohne die festen eines automatischen Eintrags. */
  refs: string[];
  sessionId: string | null;
  /** Nur bei Abmachungen. */
  due: WorldTime | null;
  done: boolean;
}

export function draftOf(entry: ChronicleEntry): EntryDraft {
  const locked = lockedRefs(entry);
  return {
    kind: entry.kind,
    text: entry.text,
    at: entry.at,
    placeId: entry.placeId,
    refs: entry.refs.filter((id) => !locked.includes(id)),
    sessionId: entry.sessionId,
    due: entry.promise?.due ?? null,
    done: entry.promise?.done ?? false,
  };
}

/**
 * Die Änderung, die aus einer Bearbeitung folgt. Automatisch entstandene Einträge behalten ihre
 * Bedeutung: Art, Reiseweg, Haltungsschritt und Termin bleiben; ein Ortswechsel behält seinen Ort,
 * ein eingetretener Termin seinen Zeitpunkt.
 */
export function entryChange(entry: ChronicleEntry, draft: EntryDraft): Partial<ChronicleEntry> {
  const manual = isManualKind(entry.kind);
  const kind = manual && isManualKind(draft.kind) ? draft.kind : entry.kind;
  const refs = [...new Set([...lockedRefs(entry), ...draft.refs])];
  return {
    kind,
    text: draft.text.trim(),
    at: entry.kind === 'event' ? entry.at : draft.at,
    placeId: entry.kind === 'travel' ? entry.placeId : draft.placeId,
    refs,
    sessionId: draft.sessionId,
    promise: kind === 'promise' ? { due: draft.due, done: draft.done } : null,
  };
}

/** Ein nachgetragener Eintrag (Notiz, Veränderung oder Abmachung). */
export function entryFromDraft(draft: EntryDraft): ChronicleEntry {
  const kind = isManualKind(draft.kind) ? draft.kind : 'note';
  return createChronicleEntry({
    kind,
    at: draft.at,
    sessionId: draft.sessionId,
    text: draft.text.trim(),
    placeId: draft.placeId,
    refs: [...new Set(draft.refs)],
    promise: kind === 'promise' ? { due: draft.due, done: draft.done } : null,
  });
}

/** Einträge, deren Reihenfolge untereinander etwas bedeutet: alle Ortswechsel bzw. ein Haltungsverlauf. */
function orderedGroup(data: CampaignData, entry: ChronicleEntry): ChronicleEntry[] {
  if (entry.kind === 'travel')
    return Object.values(data.chronicle).filter((e) => e.kind === 'travel');
  if (entry.kind === 'attitude' && entry.attitude) {
    const { fromId, toId } = entry.attitude;
    return Object.values(data.chronicle).filter(
      (e) => e.kind === 'attitude' && e.attitude?.fromId === fromId && e.attitude.toId === toId,
    );
  }
  return [];
}

export interface TimeBounds {
  /** Der Schritt davor und der danach in derselben Abfolge. */
  previous: ChronicleEntry | null;
  next: ChronicleEntry | null;
}

/** Zwischen welchen Nachbarn ein Ortswechsel oder Haltungsschritt zeitlich bleiben muss. */
export function timeBounds(data: CampaignData, entry: ChronicleEntry): TimeBounds {
  const group = orderedGroup(data, entry).sort(byTime);
  const index = group.findIndex((e) => e.id === entry.id);
  if (index < 0) return { previous: null, next: null };
  return { previous: group[index - 1] ?? null, next: group[index + 1] ?? null };
}

/**
 * Bleibt die Abfolge der Ortswechsel bzw. der Haltungsschritte gleich, wenn der Eintrag auf `at`
 * verschoben wird? Andere Arten dürfen frei verschoben werden.
 */
export function keepsOrder(data: CampaignData, entry: ChronicleEntry, at: WorldTime): boolean {
  const group = orderedGroup(data, entry);
  if (group.length < 2) return true;
  const before = [...group].sort(byTime).map((e) => e.id);
  const after = group
    .map((e) => (e.id === entry.id ? { ...e, at } : e))
    .sort(byTime)
    .map((e) => e.id);
  return before.every((id, i) => id === after[i]);
}

/**
 * Was gegen einen Zeitpunkt spricht – leer, wenn alles in Ordnung ist. `entry` ist der Eintrag,
 * der bearbeitet wird, oder null beim Nachtragen; `at` ist null, wenn es das Datum nicht gibt.
 * Ein unveränderter Zeitpunkt wird nie beanstandet.
 */
export function entryTimeProblem(
  data: CampaignData,
  entry: ChronicleEntry | null,
  at: WorldTime | null,
): string {
  if (at === null) return 'Dieses Datum gibt es im Kalender nicht.';
  if (entry && at === entry.at) return '';
  if (at > data.state.now)
    return 'Der Zeitpunkt liegt in der Zukunft. Was noch bevorsteht, gehört in den Kalender.';
  if (!entry || keepsOrder(data, entry, at)) return '';
  const cal = data.campaign.calendar;
  const { previous, next } = timeBounds(data, entry);
  const range = [
    previous && `nach dem ${formatDateTime(cal, previous.at)}`,
    next && `vor dem ${formatDateTime(cal, next.at)}`,
  ]
    .filter(Boolean)
    .join(' und ');
  return entry.kind === 'travel'
    ? `Die Reihenfolge der Ortswechsel muss bleiben: Dieser liegt ${range}.`
    : `Die Reihenfolge der Haltungsänderungen muss bleiben: Diese liegt ${range}.`;
}

const partyName = (data: CampaignData, id: string) =>
  id === PARTY_ID ? 'der Gruppe' : entityName(data, id);

/** Was das Löschen eines Eintrags bedeutet – für die Rückfrage. */
export function deleteConsequence(data: CampaignData, entry: ChronicleEntry): string {
  if (entry.kind === 'travel' && entry.travel) {
    const { toId, fromId } = entry.travel;
    const what = toId
      ? `gilt der Aufenthalt in ${entityName(data, toId)} ab diesem Zeitpunkt als nie begonnen`
      : `gilt der Aufbruch aus ${entityName(data, fromId)} als nie geschehen`;
    return `Aus den Ortswechseln ergibt sich, wann die Gruppe wo war. Ohne diesen Eintrag ${what}; die Besuche der betroffenen Orte werden neu berechnet. Der aktuelle Aufenthaltsort der Gruppe bleibt, wie er ist.`;
  }
  if (entry.kind === 'attitude' && entry.attitude) {
    const { fromId, toId } = entry.attitude;
    const current = findRelation(data, fromId, toId)?.attitude ?? null;
    return `Der Schritt verschwindet aus dem Verlauf der Haltung von ${entityName(data, fromId)} gegenüber ${partyName(data, toId)}. Die aktuelle Haltung bleibt, wie sie ist (${attitudeLabel(current)}).`;
  }
  if (entry.kind === 'event')
    return 'Der Termin selbst bleibt im Kalender. Es verschwindet nur der Vermerk, dass er eingetreten ist.';
  if (entry.kind === 'promise')
    return 'Die Abmachung verschwindet aus der Chronik und von den Seiten aller Beteiligten.';
  return 'Der Eintrag verschwindet aus der Chronik und von den Seiten der verknüpften Orte und Personen.';
}

// ── Reiner Text ────────────────────────────────────────────────────────────

/** Kurzfassung dessen, was ein automatischer Eintrag bedeutet; leer bei frei geschriebenen. */
export function entryHeadline(data: CampaignData, entry: ChronicleEntry): string {
  if (entry.kind === 'travel' && entry.travel) {
    const { fromId, toId } = entry.travel;
    if (toId)
      return `Ankunft: ${entityName(data, toId)}${fromId ? ` (von ${entityName(data, fromId)})` : ''}`;
    return fromId ? `Aufbruch aus ${entityName(data, fromId)}` : 'Die Gruppe bricht auf';
  }
  if (entry.kind === 'attitude' && entry.attitude) {
    const { fromId, toId, before, after } = entry.attitude;
    return `${entityName(data, fromId)} gegenüber ${partyName(data, toId)}: ${attitudeLabel(before)} → ${attitudeLabel(after)}`;
  }
  if (entry.kind === 'event') return `Termin eingetreten: ${entry.text}`;
  return '';
}

/** Ein Eintrag als eine Zeile reiner Text, für die Zusammenfassung. */
export function entryPlainText(data: CampaignData, entry: ChronicleEntry): string {
  const cal = data.campaign.calendar;
  const text = entry.text.trim();
  let line: string;
  if (entry.kind === 'travel' || entry.kind === 'attitude') {
    const headline = entryHeadline(data, entry);
    line = text ? `${headline}. ${text}` : `${headline}.`;
  } else if (entry.kind === 'event') {
    line = entryHeadline(data, entry);
  } else if (entry.kind === 'promise') {
    const state = entry.promise?.done
      ? 'erledigt'
      : entry.promise?.due != null
        ? `offen, Frist: ${formatDate(cal, entry.promise.due)}`
        : 'offen';
    line = `Abmachung: ${text} (${state})`;
  } else if (entry.kind === 'change') {
    line = `Veränderung: ${text}`;
  } else line = text;

  // Ort und Beteiligte nur nennen, wenn sie nicht ohnehin im Text stehen.
  const mentioned = normalize(line);
  const fixed = lockedRefs(entry);
  const context: string[] = [];
  const add = (id: string) => {
    const name = entityName(data, id);
    if (name && !mentioned.includes(normalize(name)) && !context.includes(name)) context.push(name);
  };
  if (entry.placeId && entry.kind !== 'travel' && data.entities[entry.placeId]) add(entry.placeId);
  for (const id of entry.refs) if (!fixed.includes(id) && data.entities[id]) add(id);
  return context.length ? `${line} [${context.join(', ')}]` : line;
}

/** Die Chronik einer Session als reiner Text für die Zwischenablage. */
export function sessionSummaryText(data: CampaignData, sessionId: string): string {
  const span = sessionSpans(data).find((s) => s.session.id === sessionId);
  if (!span) return '';
  const cal = data.campaign.calendar;
  const { session } = span;
  const lines: string[] = [sessionLabel(session)];
  if (session.realDate) lines.push(`Spielabend: ${formatRealDate(session.realDate, 'long')}`);
  const duration = spanDuration(span, data.state.now);
  lines.push(
    span.to === null
      ? `Weltzeit: seit ${formatDateTime(cal, span.from)} (läuft noch, bisher ${formatDuration(duration)})`
      : duration > 0
        ? `Weltzeit: ${formatWorldRange(cal, span.from, span.to)} (${formatDuration(duration)})`
        : `Weltzeit: ${formatDateTime(cal, span.from)}`,
  );

  const entries = chronicleSorted(data).filter((e) => e.sessionId === sessionId);
  let day: number | null = null;
  for (const entry of entries) {
    const d = dayIndexOf(entry.at);
    if (d !== day) {
      lines.push('', `${weekdayName(cal, entry.at)}, ${formatDate(cal, entry.at)}`);
      day = d;
    }
    const [first = '', ...rest] = entryPlainText(data, entry).split('\n');
    lines.push(`${formatClock(entry.at)}  ${first}`, ...rest.map((l) => `       ${l}`));
  }
  if (!entries.length) lines.push('', 'In dieser Session wurde nichts festgehalten.');

  const open = entries.filter((e) => e.kind === 'promise' && e.promise && !e.promise.done);
  if (open.length) {
    lines.push('', 'Offene Abmachungen');
    for (const entry of open) {
      const due = entry.promise!.due;
      lines.push(
        `- ${entry.text.trim()}${due !== null ? ` (Frist: ${formatDate(cal, due)})` : ''}`,
      );
    }
  }
  if (session.notes.trim()) lines.push('', 'Notizen', session.notes.trim());
  return lines.join('\n') + '\n';
}
