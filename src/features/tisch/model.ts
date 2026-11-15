/**
 * Fachlogik des Spieltischs – reine Funktionen: Aufenthalt am Ort, Besetzung, Anstehendes,
 * Mitschrift, Verweise mit „@“ und die Leiste der Gefährten. Die Oberfläche zeigt nur an.
 */
import { spellTitle } from './spells';
import { bastionsDue, nextTurnAt, turnsDue } from '../../domain/bastion';
import { openClocks } from '../../domain/clock';
import {
  activeParty,
  attitudeToParty,
  byName,
  chronicleFor,
  chronicleSorted,
  KIND_LABEL,
  currentSession,
  occurrencesBetween,
  openPromises,
  overdueEvents,
  placeAncestors,
  placeCast,
  placeChildren,
  placeSubtreeIds,
  runningTimers,
  TIMER_KIND_LABEL,
  searchEntities,
  upcomingOccurrences,
  type Occurrence,
  type PlaceStatus,
} from '../../domain/derive';
import { isEveryday } from '../../domain/weight';
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
  Timer,
} from '../../domain/schema';
import {
  MINUTES_PER_DAY,
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

/**
 * Stehen die Veränderungen seit dem letzten Besuch von sich aus offen da? Ja, solange die Gruppe
 * frisch angekommen ist (weniger als einen Tag hier). Danach genügt die Überschrift zum Aufklappen.
 */
export function changesFresh(status: PlaceStatus, now: WorldTime): boolean {
  return !status.current || now - status.current.from < MINUTES_PER_DAY;
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
  /** Tote und Verschollene von hier – ihr Schicksal steht in `fate`. */
  lost: CastRow[];
  factions: CastRow[];
  /** Gegenstände, die hier (oder bei jemandem von hier) liegen. */
  items: CastRow[];
  linked: CastRow[];
  /** Alle Zeilen zusammen. */
  total: number;
}

const promisesFor = (data: CampaignData, entityId: string) =>
  openPromises(data, entityId).map((entry) => entry.text || 'Abmachung ohne Wortlaut');

function personRow(
  data: CampaignData,
  person: Person,
  where: string | null,
  whereId: string | null,
): CastRow {
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
/**
 * Eine Zeile wie in „Wer hier ist“ für einen beliebigen Eintrag – für „Im Blick“, wo Personen
 * von überall stehen können: wo sie sind, ihre Haltung, offene Abmachungen.
 */
export function castRowOf(data: CampaignData, id: string): CastRow | null {
  const entity = data.entities[id];
  if (!entity) return null;
  const nameOf = (placeId: string | null) =>
    placeId ? (data.entities[placeId]?.name ?? null) : null;
  if (entity.kind === 'person')
    return personRow(data, entity, nameOf(entity.person.placeId), entity.person.placeId);
  if (entity.kind === 'faction') {
    const role = entity.faction.category || entity.tagline;
    return {
      entity,
      attitude: attitudeToParty(data, id),
      role,
      where: nameOf(entity.faction.seatId),
      whereId: entity.faction.seatId,
      fate: null,
      unmet: false,
      hasAttitude: true,
      tagline: role === entity.tagline ? '' : entity.tagline,
      promises: promisesFor(data, id),
    };
  }
  return {
    entity,
    attitude: null,
    role: KIND_LABEL[entity.kind],
    where: null,
    whereId: null,
    fate: null,
    unmet: false,
    hasAttitude: entity.kind === 'family',
    tagline: entity.tagline,
    promises: promisesFor(data, id),
  };
}

export function castView(data: CampaignData, placeId: string): CastView {
  const cast = placeCast(data, placeId);
  const placeName = (id: string | null) => (id ? (data.entities[id]?.name ?? null) : null);

  const present = cast.present
    .map((p) => {
      const exact = p.person.placeId === placeId;
      return personRow(
        data,
        p,
        exact ? null : placeName(p.person.placeId),
        exact ? null : p.person.placeId,
      );
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

  const lost = cast.lost.map((p) => personRow(data, p, null, null));

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
    .filter(
      (e): e is Item => e.kind === 'item' && !!e.item.holderId && holders.has(e.item.holderId),
    )
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

  const linked = cast.linked
    .filter((l) => !listed.has(l.entity.id))
    .map(({ entity, relation, perspective }): CastRow => {
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
    lost,
    factions,
    items,
    linked,
    total:
      present.length + away.length + lost.length + factions.length + items.length + linked.length,
  };
}

/**
 * Was bei früheren Besuchen hier geschah: alles vor dem jetzigen Aufenthalt, ohne Ortswechsel und
 * ohne das, was schon unter „Seit eurem letzten Besuch“ steht. Älteste zuerst.
 */
export function earlierHere(
  data: CampaignData,
  placeId: string,
  status: PlaceStatus,
): ChronicleEntry[] {
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
    return {
      place,
      people: persons.filter((p) => p.person.placeId && ids.has(p.person.placeId)).length,
    };
  });
  return { parent: placeAncestors(data, placeId)[0] ?? null, children };
}

// ── Anstehend ──────────────────────────────────────────────────────────────

export type AgendaTone = 'overdue' | 'today' | 'later';
export type AgendaSource = 'event' | 'promise' | 'timer' | 'clock' | 'bastion';
/** Welches Zeichen vor der Zeile steht. */
export type AgendaMark = EventKind | 'promise' | Timer['kind'] | 'clock' | 'bastion';

export interface AgendaItem {
  key: string;
  source: AgendaSource;
  /** ID des Termins, des Chronik-Eintrags oder des Timers. */
  id: string;
  title: string;
  /** Art in einem Wort: Frist, Vorhaben, Ereignis, Abmachung, Wirkung, Tätigkeit. */
  label: string;
  mark: AgendaMark;
  at: WorldTime;
  tone: AgendaTone;
  /** „seit gestern überfällig“, „heute“, „morgen, 22:00“, „noch 40 Min.“, „ohne Frist“ */
  when: string;
  /** „18. Tauwind, 22:00“ */
  date: string;
  placeId: string | null;
  refs: string[];
  /** Lässt sich hier abhaken (Vorhaben, Fristen, Abmachungen) oder beenden (Timer). */
  checkable: boolean;
  /** Beschriftung des Hakens. */
  checkLabel: string;
  /** Wiederkehrender Termin; hier steht nur sein nächstes Eintreten. */
  repeats: boolean;
  /** Abmachung ohne Frist: steht am Ende, drängt nicht. */
  undated: boolean;
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

/** Wie lange ein mehrtägiger Termin noch läuft: „endet heute“, „läuft bis morgen“, „läuft bis 21. Tauwind“. */
export function runningLabel(cal: CalendarDef, now: WorldTime, endDay: number): string {
  const left = endDay - dayIndexOf(now);
  if (left <= 0) return 'endet heute';
  if (left === 1) return 'läuft bis morgen';
  return `läuft bis ${formatDayMonth(cal, endDay * MINUTES_PER_DAY)}`;
}

const dateLabel = (cal: CalendarDef, at: WorldTime, timed: boolean) =>
  timed ? `${formatDayMonth(cal, at)}, ${formatClock(at)}` : formatDayMonth(cal, at);

/** Letzter Tag eines Termins, der an `at` beginnt. */
const lastDayOf = (event: CalendarEvent, at: WorldTime) =>
  dayIndexOf(at) + (event.durationDays ?? 1) - 1;

/**
 * Mehrtägige Termine, die vor heute begonnen haben und heute noch laufen – etwa ein Markt, der
 * drei Tage dauert. Vorhaben und Fristen fehlen hier: Sie gelten ab ihrem Beginn als überfällig,
 * bis sie abgehakt sind, und stehen dort.
 */
export function ongoingOccurrences(data: CampaignData): Occurrence[] {
  const today = dayIndexOf(data.state.now);
  const longest = Math.max(1, ...Object.values(data.events).map((e) => e.durationDays ?? 1));
  if (longest < 2) return [];
  const from = Math.max(0, today - (longest - 1)) * MINUTES_PER_DAY;
  return occurrencesBetween(data, from, today * MINUTES_PER_DAY - 1).filter(
    (o) =>
      lastDayOf(o.event, o.at) >= today && (o.event.kind === 'world' || o.event.repeat !== null),
  );
}

function eventItem(
  cal: CalendarDef,
  now: WorldTime,
  event: CalendarEvent,
  at: WorldTime,
  state: 'overdue' | 'ongoing' | 'upcoming',
): AgendaItem {
  const today = state === 'ongoing' || dayIndexOf(at) === dayIndexOf(now);
  const lastDay = lastDayOf(event, at);
  const date = dateLabel(cal, at, event.timed);
  return {
    key: `event:${event.id}:${at}`,
    source: 'event',
    id: event.id,
    title: event.title,
    label: EVENT_KIND_LABEL[event.kind],
    mark: event.kind,
    at,
    tone: state === 'overdue' ? 'overdue' : today ? 'today' : 'later',
    when:
      state === 'overdue'
        ? overdueLabel(now, at)
        : state === 'ongoing'
          ? runningLabel(cal, now, lastDay)
          : whenLabel(now, at, event.timed),
    date:
      lastDay > dayIndexOf(at)
        ? `${date} bis ${formatDayMonth(cal, lastDay * MINUTES_PER_DAY)}`
        : date,
    placeId: event.placeId,
    refs: event.refs,
    // Wiederkehrendes und Weltereignisse haken sich nicht ab – sie treten ein.
    checkable: event.kind !== 'world' && !event.repeat,
    checkLabel: 'Erledigt',
    repeats: event.repeat !== null,
    undated: false,
  };
}

/**
 * Alles, was die Gruppe im Blick behalten muss, nach Dringlichkeit:
 * erst Überfälliges (ältestes zuerst), dann was gerade läuft und was kommt, nach Zeitpunkt.
 * Termine reichen `days` Tage voraus; ein wiederkehrender Termin steht nur mit seinem nächsten
 * Eintreten da. Abmachungen und laufende Wirkungen stehen immer darin – Abmachungen ohne Frist
 * ganz am Ende.
 */
export function buildAgenda(data: CampaignData, days = 7): AgendaItem[] {
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const items: AgendaItem[] = [];

  for (const event of overdueEvents(data))
    items.push(eventItem(cal, now, event, event.at, 'overdue'));

  const listed = new Set<string>();
  for (const o of ongoingOccurrences(data)) {
    if (isEveryday(data, o.event)) continue;
    listed.add(o.event.id);
    items.push(eventItem(cal, now, o.event, o.at, 'ongoing'));
  }
  for (const o of upcomingOccurrences(data, days, 400)) {
    // Alltag steht nicht unter „Anstehend“ – er liefe sonst jeden Tag durch die Liste.
    if (isEveryday(data, o.event)) continue;
    if (o.event.repeat && listed.has(o.event.id)) continue;
    listed.add(o.event.id);
    items.push(eventItem(cal, now, o.event, o.at, 'upcoming'));
  }

  for (const entry of openPromises(data)) {
    const due = entry.promise?.due ?? null;
    const overdue = due !== null && due < now;
    const today = due !== null && dayIndexOf(due) === dayIndexOf(now);
    items.push({
      key: `promise:${entry.id}`,
      source: 'promise',
      id: entry.id,
      title: entry.text || 'Abmachung',
      label: 'Abmachung',
      mark: 'promise',
      at: due ?? entry.at,
      tone: overdue ? 'overdue' : today ? 'today' : 'later',
      when:
        due === null ? 'ohne Frist' : overdue ? overdueLabel(now, due) : whenLabel(now, due, today),
      date:
        due === null
          ? `festgehalten am ${formatDayMonth(cal, entry.at)}`
          : formatDayMonth(cal, due),
      placeId: null,
      refs: entry.refs,
      checkable: true,
      checkLabel: 'Eingelöst',
      repeats: false,
      undated: due === null,
    });
  }

  for (const timer of runningTimers(data))
    items.push({
      key: `timer:${timer.id}`,
      source: 'timer',
      id: timer.id,
      title: timer.kind === 'spell' ? spellTitle(data, timer) : timer.label,
      label:
        timer.kind === 'spell' && timer.concentration
          ? 'Zauber mit Konzentration'
          : TIMER_KIND_LABEL[timer.kind],
      mark: timer.kind,
      at: timer.end,
      tone: dayIndexOf(timer.end) === dayIndexOf(now) ? 'today' : 'later',
      when: `noch ${formatDuration(timer.end - now)}`,
      date: `bis ${dateLabel(cal, timer.end, true)}`,
      placeId: null,
      refs: timer.refs,
      checkable: true,
      checkLabel: 'Vorzeitig beenden',
      repeats: false,
      undated: false,
    });

  // Uhren: der nächste Schritt, wenn er in den kommenden Tagen eintritt.
  const horizon = now + days * MINUTES_PER_DAY;
  for (const view of openClocks(data.clocks, now)) {
    if (view.paused || !view.next || view.next.at > horizon) continue;
    const { clock } = view;
    items.push({
      key: `clock:${clock.id}`,
      source: 'clock',
      id: clock.id,
      title: view.next.step.text,
      label: `Uhr: ${clock.title}`,
      mark: 'clock',
      at: view.next.at,
      tone: dayIndexOf(view.next.at) === dayIndexOf(now) ? 'today' : 'later',
      when: whenLabel(now, view.next.at, false),
      date: dateLabel(cal, view.next.at, false),
      placeId: clock.placeId,
      refs: [...new Set([...(clock.ownerId ? [clock.ownerId] : []), ...clock.refs])],
      checkable: false,
      checkLabel: '',
      repeats: false,
      undated: false,
    });
  }

  // Bastionen: ein fälliger Zug steht hier, bis er ausgeführt ist (unter Gefährten → Bastion).
  for (const bastion of bastionsDue(data)) {
    const due = turnsDue(bastion, now);
    const at = nextTurnAt(bastion) ?? now;
    items.push({
      key: `bastion:${bastion.id}`,
      source: 'bastion',
      id: bastion.id,
      title:
        due > 1
          ? `${due} Bastionszüge fällig: ${bastion.name}`
          : `Bastionszug fällig: ${bastion.name}`,
      label: 'Bastion',
      mark: 'bastion',
      at,
      tone: 'overdue',
      when: dayIndexOf(at) === dayIndexOf(now) ? 'heute' : overdueLabel(now, at),
      date: formatDayMonth(cal, at),
      placeId: bastion.placeId,
      refs: [],
      checkable: false,
      checkLabel: '',
      repeats: false,
      undated: false,
    });
  }

  const rank = (item: AgendaItem) => (item.undated ? 2 : item.tone === 'overdue' ? 0 : 1);
  return items.sort(
    (a, b) => rank(a) - rank(b) || a.at - b.at || a.title.localeCompare(b.title, 'de'),
  );
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
export function groupByDay(
  cal: CalendarDef,
  now: WorldTime,
  entries: ChronicleEntry[],
): DayGroup[] {
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

// Die Regeln für „@“ stehen in `domain/mention.ts` – die Blätter nutzen sie auch.
export {
  activeMention,
  insertMention,
  keptMentions,
  type Mention,
  type MentionRange,
} from '../../domain/mention';

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

/**
 * Adresse des Charakterbogens (D&D Beyond), sofern sie sich gefahrlos öffnen lässt: nur http und
 * https. Ohne Angabe eines Protokolls wird https angenommen.
 */
export function sheetLink(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.includes('.') ? parsed.href : null;
  } catch {
    return null;
  }
}

export interface Companion {
  character: Character;
  /** Link zum Charakterbogen, falls einer eingetragen ist. */
  sheet: string | null;
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
      sheet: sheetLink(character.character.sheetUrl),
      elsewhere: place?.kind === 'place' ? place : null,
      astray: apart && place?.kind !== 'place',
    };
  });
}
