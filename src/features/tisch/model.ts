/**
 * Fachlogik des Spieltischs – reine Funktionen: Aufenthalt am Ort, Besetzung, Anstehendes,
 * Mitschrift, Verweise mit „@“ und die Leiste der Gefährten. Die Oberfläche zeigt nur an.
 */
import {
  activeParty,
  attitudeToParty,
  byName,
  chronicleFor,
  chronicleSorted,
  currentSession,
  openPromises,
  overdueEvents,
  placeAncestors,
  placeCast,
  placeChildren,
  placeSubtreeIds,
  runningTimers,
  searchEntities,
  upcomingOccurrences,
  type PlaceStatus,
} from '../../domain/derive';
import { relationLabel } from '../../domain/relations';
import type {
  CalendarEvent,
  CampaignData,
  Character,
  ChronicleEntry,
  Entity,
  EventKind,
  Faction,
  Item,
  Person,
  PersonStatus,
  Place,
  Session,
} from '../../domain/schema';
import {
  dayIndexOf,
  formatClock,
  formatDayMonth,
  formatDuration,
  formatRelative,
  type CalendarDef,
  type WorldTime,
} from '../../domain/time/calendar';

// ── Ort der Gruppe ─────────────────────────────────────────────────────────

/** Der Ort, an dem die Gruppe ist – oder null, wenn keiner gesetzt ist oder er gelöscht wurde. */
export function partyPlace(data: CampaignData): Place | null {
  const entity = data.state.placeId ? data.entities[data.state.placeId] : undefined;
  return entity?.kind === 'place' ? entity : null;
}

export interface StayLabels {
  /** „Erster Besuch“ oder „Zuletzt hier vor 6 Tagen“. */
  headline: string;
  /** War die Gruppe vorher noch nie hier? */
  first: boolean;
  /** „Seit dem 11. Tauwind hier“, „Seit 14:00 Uhr hier“, „Gerade angekommen“ – oder null. */
  since: string | null;
  /** „3. Besuch“ – erst ab dem zweiten. */
  visit: string | null;
}

/** Fasst den Aufenthalt der Gruppe an ihrem Ort in Worte. */
export function stayLabels(cal: CalendarDef, now: WorldTime, status: PlaceStatus): StayLabels {
  const first = status.lastLeft === null;
  const headline = first
    ? 'Erster Besuch'
    : status.lastLeft! >= now
      ? 'Eben erst hier gewesen'
      : `Zuletzt hier ${formatRelative(now, status.lastLeft!)}`;
  let since: string | null = null;
  if (status.current) {
    const from = status.current.from;
    if (from >= now) since = 'Gerade angekommen';
    else if (dayIndexOf(from) === dayIndexOf(now)) since = `Seit ${formatClock(from)} Uhr hier`;
    else since = `Seit dem ${formatDayMonth(cal, from)} hier`;
  }
  const count = status.visits.length;
  return { headline, first, since, visit: count > 1 ? `${count}. Besuch` : null };
}

/** Wie lange die Gruppe vor ihrer Rückkehr fort war, in Minuten; null beim ersten Besuch. */
export function absenceMinutes(status: PlaceStatus, now: WorldTime): number | null {
  if (status.lastLeft === null) return null;
  return Math.max(0, (status.current ? status.current.from : now) - status.lastLeft);
}

// ── Wer hier ist ───────────────────────────────────────────────────────────

const STATUS_NOTE: Record<PersonStatus, string | null> = {
  alive: null,
  dead: 'Tot',
  missing: 'Verschollen',
  unknown: 'Schicksal ungewiss',
};

export interface CastRow {
  entity: Person | Faction | Entity;
  /** Haltung zur Gruppe; null = unbekannt. Nur bei Personen und Fraktionen von Belang. */
  attitude: number | null;
  /** Unterzeile: Rolle, Art oder Beziehung zum Ort. */
  role: string;
  /** Genauer Aufenthalt (Ort darunter) oder, bei Abwesenden, wo sie jetzt sind. */
  where: string | null;
  /** ID des Ortes zu `where`, falls es einer ist. */
  whereId: string | null;
  /** „Tot“, „Verschollen“ … */
  fate: string | null;
  /** Die Gruppe kennt diese Person noch nicht. */
  unmet: boolean;
  /** Lässt sich eine Haltung festlegen? */
  hasAttitude: boolean;
  /** Kurzbeschreibung, sofern sie nicht schon als Unterzeile dient. */
  tagline: string;
  /** Offene Abmachungen, die diesen Eintrag betreffen (ihr Wortlaut). */
  promises: string[];
}

export interface CastView {
  present: CastRow[];
  away: CastRow[];
  factions: CastRow[];
  /** Gegenstände, die hier (oder bei jemandem von hier) liegen. */
  items: CastRow[];
  linked: CastRow[];
  /** Alle Zeilen zusammen. */
  total: number;
}

const promisesFor = (data: CampaignData, entityId: string) =>
  openPromises(data, entityId).map((entry) => entry.text || 'Abmachung ohne Wortlaut');

function personRow(data: CampaignData, person: Person, where: string | null, whereId: string | null): CastRow {
  const role = person.person.role || person.person.species || person.tagline;
  return {
    entity: person,
    attitude: attitudeToParty(data, person.id),
    role,
    where,
    whereId,
    fate: STATUS_NOTE[person.person.status],
    unmet: !person.person.met,
    hasAttitude: true,
    tagline: role === person.tagline ? '' : person.tagline,
    promises: promisesFor(data, person.id),
  };
}

/** Die Besetzung eines Ortes, fertig für die Anzeige: wer hier ist, wer fehlt, wer dazugehört. */
export function castView(data: CampaignData, placeId: string): CastView {
  const cast = placeCast(data, placeId);
  const placeName = (id: string | null) => (id ? (data.entities[id]?.name ?? null) : null);

  const present = cast.present
    .map((p) => {
      const exact = p.person.placeId === placeId;
      return personRow(data, p, exact ? null : placeName(p.person.placeId), exact ? null : p.person.placeId);
    })
    // Erst wer unmittelbar hier ist, dann nach Ort darunter, dann nach Namen.
    .sort(
      (a, b) =>
        Number(a.where !== null) - Number(b.where !== null) ||
        (a.where ?? '').localeCompare(b.where ?? '', 'de') ||
        byName(a.entity, b.entity),
    );

  const away = cast.away.map((p) => {
    const elsewhere = placeName(p.person.placeId);
    // Bei Toten und Verschollenen sagt das Schicksal schon alles.
    const unknown = STATUS_NOTE[p.person.status] ? null : 'Aufenthalt unbekannt';
    return personRow(
      data,
      p,
      elsewhere ? `jetzt: ${elsewhere}` : unknown,
      elsewhere ? p.person.placeId : null,
    );
  });

  const factions = cast.factions.map((f): CastRow => {
    const exact = f.faction.seatId === placeId;
    const role = f.faction.category || f.tagline;
    return {
      entity: f,
      attitude: attitudeToParty(data, f.id),
      role,
      where: exact ? null : placeName(f.faction.seatId),
      whereId: exact ? null : f.faction.seatId,
      fate: null,
      unmet: false,
      hasAttitude: true,
      tagline: role === f.tagline ? '' : f.tagline,
      promises: promisesFor(data, f.id),
    };
  });

  // Gegenstände, die an diesem Ort liegen oder die jemand von hier bei sich trägt.
  const subtree = placeSubtreeIds(data, placeId);
  const holders = new Set([...subtree, ...cast.present.map((p) => p.id)]);
  const listed = new Set<string>();
  const items = Object.values(data.entities)
    .filter((e): e is Item => e.kind === 'item' && !!e.item.holderId && holders.has(e.item.holderId))
    .sort(byName)
    .map((item): CastRow => {
      listed.add(item.id);
      const role = item.item.category || item.tagline;
      const exact = item.item.holderId === placeId;
      return {
        entity: item,
        attitude: null,
        role,
        where: exact ? null : placeName(item.item.holderId),
        whereId: exact ? null : item.item.holderId,
        fate: null,
        unmet: false,
        hasAttitude: false,
        tagline: role === item.tagline ? '' : item.tagline,
        promises: [],
      };
    });

  const linked = cast.linked.filter((l) => !listed.has(l.entity.id)).map(({ entity, relation, perspective }): CastRow => {
    // Aus Sicht des Eintrags gesprochen: „herrscht über Dornhafen“.
    const label = relationLabel(relation, perspective === 'to' ? 'from' : 'to');
    const hasAttitude = entity.kind === 'person' || entity.kind === 'faction';
    return {
      entity,
      attitude: hasAttitude ? attitudeToParty(data, entity.id) : null,
      role: `${label} ${placeName(placeId) ?? ''}`.trim(),
      where: null,
      whereId: null,
      fate: entity.kind === 'person' ? STATUS_NOTE[entity.person.status] : null,
      unmet: entity.kind === 'person' && !entity.person.met,
      hasAttitude,
      tagline: entity.tagline,
      promises: hasAttitude ? promisesFor(data, entity.id) : [],
    };
  });

  return {
    present,
    away,
    factions,
    items,
    linked,
    total: present.length + away.length + factions.length + items.length + linked.length,
  };
}

/**
 * Was bei früheren Besuchen hier geschah: alles vor dem jetzigen Aufenthalt, ohne Ortswechsel und
 * ohne das, was schon unter „Seit eurem letzten Besuch“ steht. Älteste zuerst.
 */
export function earlierHere(data: CampaignData, placeId: string, status: PlaceStatus): ChronicleEntry[] {
  const before = status.current ? status.current.from : Number.MAX_SAFE_INTEGER;
  const shown = new Set(status.changesSince.map((entry) => entry.id));
  return chronicleFor(data, placeId).filter(
    (entry) => entry.kind !== 'travel' && entry.at < before && !shown.has(entry.id),
  );
}

// ── Orte hier ──────────────────────────────────────────────────────────────

export interface NearbyPlace {
  place: Place;
  /** Personen, die sich dort (oder darunter) aufhalten. */
  people: number;
}

export interface Nearby {
  /** Übergeordneter Ort, zu dem es „zurück“ geht. */
  parent: Place | null;
  children: NearbyPlace[];
}

/** Wohin es von hier aus mit einem Klick geht: hinein in Orte darunter, zurück zum Ort darüber. */
export function nearbyPlaces(data: CampaignData, placeId: string): Nearby {
  const persons = Object.values(data.entities).filter((e): e is Person => e.kind === 'person');
  const children = placeChildren(data, placeId).map((place) => {
    const ids = placeSubtreeIds(data, place.id);
    return { place, people: persons.filter((p) => p.person.placeId && ids.has(p.person.placeId)).length };
  });
  return { parent: placeAncestors(data, placeId)[0] ?? null, children };
}

// ── Anstehend ──────────────────────────────────────────────────────────────

export type AgendaTone = 'overdue' | 'today' | 'later';
export type AgendaSource = 'event' | 'promise' | 'timer';

export interface AgendaItem {
  key: string;
  source: AgendaSource;
  /** ID des Termins, des Chronik-Eintrags oder des Timers. */
  id: string;
  title: string;
  /** Art in einem Wort: Frist, Vorhaben, Ereignis, Abmachung, Wirkung, Tätigkeit. */
  label: string;
  at: WorldTime;
  tone: AgendaTone;
  /** „seit gestern überfällig“, „heute“, „morgen, 22:00“, „noch 40 Min.“ */
  when: string;
  /** „18. Tauwind, 22:00“ */
  date: string;
  placeId: string | null;
  refs: string[];
  /** Lässt sich hier abhaken (Vorhaben, Fristen, Abmachungen) oder beenden (Timer). */
  checkable: boolean;
  /** Beschriftung des Hakens. */
  checkLabel: string;
}

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  world: 'Ereignis',
  plan: 'Vorhaben',
  deadline: 'Frist',
};

/** Abstand eines kommenden Zeitpunkts in Worten. Ohne feste Uhrzeit zählt nur der Tag. */
export function whenLabel(now: WorldTime, at: WorldTime, timed: boolean): string {
  const days = dayIndexOf(at) - dayIndexOf(now);
  if (days > 1) return `in ${days} Tagen`;
  if (days === 1) return timed ? `morgen, ${formatClock(at)}` : 'morgen';
  if (days < 0) return days === -1 ? 'gestern' : `vor ${-days} Tagen`;
  if (!timed) return 'heute';
  if (at === now) return 'jetzt';
  return at > now ? `in ${formatDuration(at - now)}` : `vor ${formatDuration(now - at)}`;
}

/** „seit 3 Tagen überfällig“ */
export function overdueLabel(now: WorldTime, at: WorldTime): string {
  const days = dayIndexOf(now) - dayIndexOf(at);
  if (days <= 0) return at < now ? `seit ${formatDuration(now - at)} überfällig` : 'jetzt fällig';
  return days === 1 ? 'seit gestern überfällig' : `seit ${days} Tagen überfällig`;
}

const dateLabel = (cal: CalendarDef, at: WorldTime, timed: boolean) =>
  timed ? `${formatDayMonth(cal, at)}, ${formatClock(at)}` : formatDayMonth(cal, at);

function eventItem(
  cal: CalendarDef,
  now: WorldTime,
  event: CalendarEvent,
  at: WorldTime,
  overdue: boolean,
): AgendaItem {
  const today = dayIndexOf(at) === dayIndexOf(now);
  return {
    key: `event:${event.id}:${at}`,
    source: 'event',
    id: event.id,
    title: event.title,
    label: EVENT_KIND_LABEL[event.kind],
    at,
    tone: overdue ? 'overdue' : today ? 'today' : 'later',
    when: overdue ? overdueLabel(now, at) : whenLabel(now, at, event.timed),
    date: dateLabel(cal, at, event.timed),
    placeId: event.placeId,
    refs: event.refs,
    // Wiederkehrendes und Weltereignisse haken sich nicht ab – sie treten ein.
    checkable: event.kind !== 'world' && !event.repeat,
    checkLabel: 'Erledigt',
  };
}

/**
 * Alles, was die Gruppe im Blick behalten muss, nach Dringlichkeit:
 * erst Überfälliges (ältestes zuerst), dann nach Zeitpunkt. Termine reichen `days` Tage voraus;
 * Abmachungen mit Frist und laufende Wirkungen stehen immer darin.
 */
export function buildAgenda(data: CampaignData, days = 7): AgendaItem[] {
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const items: AgendaItem[] = [];

  for (const event of overdueEvents(data))
    items.push(eventItem(cal, now, event, event.at, true));

  for (const o of upcomingOccurrences(data, days, 40))
    items.push(eventItem(cal, now, o.event, o.at, false));

  for (const entry of openPromises(data)) {
    const due = entry.promise?.due ?? null;
    if (due === null) continue;
    const overdue = due < now;
    items.push({
      key: `promise:${entry.id}`,
      source: 'promise',
      id: entry.id,
      title: entry.text || 'Abmachung',
      label: 'Abmachung',
      at: due,
      tone: overdue ? 'overdue' : dayIndexOf(due) === dayIndexOf(now) ? 'today' : 'later',
      when: overdue ? overdueLabel(now, due) : whenLabel(now, due, dayIndexOf(due) === dayIndexOf(now)),
      date: formatDayMonth(cal, due),
      placeId: null,
      refs: entry.refs,
      checkable: true,
      checkLabel: 'Eingelöst',
    });
  }

  for (const timer of runningTimers(data))
    items.push({
      key: `timer:${timer.id}`,
      source: 'timer',
      id: timer.id,
      title: timer.label,
      label: timer.kind === 'task' ? 'Tätigkeit' : 'Wirkung',
      at: timer.end,
      tone: dayIndexOf(timer.end) === dayIndexOf(now) ? 'today' : 'later',
      when: `noch ${formatDuration(timer.end - now)}`,
      date: `bis ${dateLabel(cal, timer.end, true)}`,
      placeId: null,
      refs: timer.refs,
      checkable: true,
      checkLabel: 'Vorzeitig beenden',
    });

  const rank = (item: AgendaItem) => (item.tone === 'overdue' ? 0 : 1);
  return items.sort((a, b) => rank(a) - rank(b) || a.at - b.at || a.title.localeCompare(b.title, 'de'));
}

// ── Mitschrift ─────────────────────────────────────────────────────────────

export interface Journal {
  /** Die laufende Session; null, wenn keine läuft. */
  session: Session | null;
  /** Neueste zuerst, höchstens `limit`. */
  entries: ChronicleEntry[];
  /** Wie viele es insgesamt wären. */
  total: number;
}

/** Verlauf der laufenden Session; ohne Session die letzten Einträge der Chronik. */
export function journal(data: CampaignData, limit = 60): Journal {
  const session = currentSession(data);
  const all = chronicleSorted(data).filter((e) => !session || e.sessionId === session.id);
  return { session, entries: all.slice(-limit).reverse(), total: all.length };
}

export interface DayGroup {
  /** Tagesindex seit Epoche. */
  day: number;
  /** „Heute“, „Gestern“, „Vor 5 Tagen“, „In 2 Tagen“. */
  label: string;
  /** „17. Tauwind“ */
  date: string;
  entries: ChronicleEntry[];
}

/** Teilt Einträge in Tage auf; die Reihenfolge der Einträge bleibt erhalten. */
export function groupByDay(cal: CalendarDef, now: WorldTime, entries: ChronicleEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const today = dayIndexOf(now);
  for (const entry of entries) {
    const day = dayIndexOf(entry.at);
    let group = groups[groups.length - 1];
    if (!group || group.day !== day) {
      const diff = day - today;
      const label =
        diff === 0
          ? 'Heute'
          : diff === -1
            ? 'Gestern'
            : diff === 1
              ? 'Morgen'
              : diff < 0
                ? `Vor ${-diff} Tagen`
                : `In ${diff} Tagen`;
      group = { day, label, date: formatDayMonth(cal, entry.at), entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

// ── Verweise mit „@“ ───────────────────────────────────────────────────────

export interface MentionRange {
  /** Position des „@“. */
  start: number;
  /** Position der Schreibmarke. */
  end: number;
  /** Was nach dem „@“ getippt wurde. */
  query: string;
}

/** Zeichen, nach denen ein „@“ einen Verweis beginnt (Wortanfang) – nicht mitten im Wort. */
const MENTION_LEAD = /[\s(„“"'»›–—\-/:;,.!?]/;

/**
 * Tippt die Spielleitung gerade einen Verweis? Liefert den Bereich vom „@“ bis zur Schreibmarke.
 * Ein Leerzeichen am Ende beendet den Verweis, damit „@“ den Text nicht dauerhaft festhält.
 */
export function activeMention(text: string, caret: number): MentionRange | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf('@');
  if (start < 0) return null;
  if (start > 0 && !MENTION_LEAD.test(before[start - 1]!)) return null;
  const query = before.slice(start + 1);
  if (query.length > 40 || /\n/.test(query) || /^\s/.test(query) || /\s$/.test(query)) return null;
  if (query.split(/\s+/).length > 4) return null;
  return { start, end: caret, query };
}

/** Ersetzt „@getippt“ durch den Namen des gewählten Eintrags. */
export function insertMention(
  text: string,
  range: MentionRange,
  name: string,
): { text: string; caret: number } {
  const after = text.slice(range.end);
  const spacer = /^[\s.,;:!?)]/.test(after) ? '' : ' ';
  return {
    text: text.slice(0, range.start) + name + spacer + after,
    caret: range.start + name.length + spacer.length,
  };
}

export interface Mention {
  id: string;
  name: string;
}

/** Gewählte Verweise, deren Name noch im Text steht – in der Reihenfolge der Wahl, ohne Doppelte. */
export function keptMentions(text: string, mentions: Mention[]): Mention[] {
  const seen = new Set<string>();
  return mentions.filter((m) => {
    if (seen.has(m.id) || !text.includes(m.name)) return false;
    seen.add(m.id);
    return true;
  });
}

/**
 * Vorschläge für einen Verweis. Ohne Suchwort zuerst, wer und was am Ort der Gruppe ist –
 * das wird am Tisch am häufigsten gebraucht. Mit Suchwort die besten Treffer der Weltdatenbank.
 */
export function mentionSuggestions(data: CampaignData, query: string, limit = 7): Entity[] {
  if (query.trim()) return searchEntities(data, query, { limit });
  const place = partyPlace(data);
  if (!place) return searchEntities(data, '', { limit });
  const cast = placeCast(data, place.id);
  const local: Entity[] = [
    ...cast.present,
    ...activeParty(data),
    ...cast.factions,
    ...placeChildren(data, place.id),
    place,
  ];
  const seen = new Set<string>();
  return local.filter((e) => !seen.has(e.id) && seen.add(e.id)).slice(0, limit);
}

// ── Gefährten ──────────────────────────────────────────────────────────────

export const MAX_EXHAUSTION = 6;

/**
 * Neue Erschöpfungsstufe nach einem Klick auf Marke `clicked` (1–6): Die angeklickte Stufe wird
 * gesetzt; ein Klick auf die aktuelle Stufe nimmt eine zurück.
 */
export function exhaustionAfterClick(current: number, clicked: number): number {
  const next = clicked === current ? current - 1 : clicked;
  return Math.min(MAX_EXHAUSTION, Math.max(0, next));
}

/** Was die Stufe nach den Regeln von 2024 bedeutet. */
export function exhaustionEffect(level: number): string {
  if (level <= 0) return 'Nicht erschöpft';
  if (level >= MAX_EXHAUSTION) return 'Erschöpfung 6: Der Gefährte stirbt.';
  return `Erschöpfung ${level}: −${level * 2} auf alle W20-Würfe, Bewegungsrate −${level * 5} Fuß`;
}

export interface Companion {
  character: Character;
  /** Ort, an dem der Gefährte abseits der Gruppe ist; null = bei der Gruppe. */
  elsewhere: Place | null;
  /** Abseits der Gruppe, aber der Ort ist nicht (mehr) bekannt. */
  astray: boolean;
}

/** Die aktive Gruppe mit dem Hinweis, wer gerade woanders ist. */
export function companions(data: CampaignData): Companion[] {
  return activeParty(data).map((character) => {
    const own = character.character.placeId;
    const apart = own !== null && own !== data.state.placeId;
    const place = apart ? data.entities[own] : undefined;
    return {
      character,
      elsewhere: place?.kind === 'place' ? place : null,
      astray: apart && place?.kind !== 'place',
    };
  });
}
