/**
 * „Die Welt dreht sich weiter“: was abseits der Gruppe geschieht – nur für den Spielleiter. Oben
 * stehen die Uhren und alles, was er beobachtet; darunter das Übrige nach Gewicht: Was nah an der
 * Gruppe ist oder jemanden betrifft, den sie kennt, wiegt schwerer. Der Rest ist eingeklappt.
 *
 * Gelesen wird, was schon da ist: die Schritte der Uhren und die eingetretenen Ereignisse aus der
 * Chronik, dazu die Zustände, die von selbst entstanden sind (Wege, die das Wetter verändert hat –
 * gebündelt: „Drei Wege verschlammt“ statt drei Einträgen). Nichts wird erfunden. Reine Funktionen.
 */
import { WORLD_CHRONICLE_KINDS, recordHeadline } from './chronicleKinds';
import { openClocks, type ClockView } from './clock';
import { currentSession, findRelation, placeAncestors } from './derive';
import { missedTrips, openTrips, runStatus, type RunStatus, type Trip } from './runs';
import { PARTY_ID, type CampaignData, type Clock, type Entity, type Session } from './schema';
import { deedsOf, schemeDrivers, schemesOf, type Deed, type Scheme } from './schemes';
import { nearness, whereOf } from './story';
import { MINUTES_PER_DAY, formatDayMonth } from './time/calendar';
import { WAY_STATE_LABEL, wayCondition, type WayStateKind } from './wayState';
import { formatWayTime, routeBetween } from './ways';

/** 3 = am Ort der Gruppe, 2 = in ihrer Nähe oder es betrifft Bekannte, 1 = weit weg. */
export type TurnWeight = 1 | 2 | 3;

export interface TurnItem {
  key: string;
  /**
   * `change` = Schritt einer Uhr, `event` = eingetretenes Ereignis, `ways` = Zustand von Wegen,
   * `missing` = etwas Erwartetes ist ausgeblieben.
   */
  kind: 'change' | 'event' | 'ways' | 'missing';
  /** Wann es geschah; null = ein Zustand, der jetzt gilt. */
  at: number | null;
  title: string;
  /** Einzelheiten – bei gebündelten Wegen die Wege selbst. */
  detail: string[];
  placeId: string | null;
  refs: string[];
  weight: TurnWeight;
  /** Warum es so viel wiegt, in Worten. */
  why: string;
  /** Betrifft etwas, das der Spielleiter beobachtet. */
  watched: boolean;
}

/**
 * Ein Vorschlag: etwas, das naheliegt, aber nicht sicher ist – oder eine Frage, die sich stellt.
 * Der Spielleiter nimmt an oder verwirft; was Geschichte ist, entscheidet nie Wayfarer.
 */
export type Suggestion =
  | {
      kind: 'trip';
      key: string;
      /** „Salzkahn vom 12. Tauwind: bleibt wohl aus“ */
      title: string;
      why: string;
      trip: Trip;
    }
  | {
      kind: 'clock';
      key: string;
      /** „Die Aalfischer greifen nach dem Hafen“ ist blockiert */
      title: string;
      why: string;
      clock: Clock;
    };

export interface WorldTurn {
  /** Was naheliegt oder zu entscheiden ist – getrennt von dem, was sicher geschehen ist. */
  suggestions: Suggestion[];
  /** Die regelmäßigen Abläufe und wo sie gerade stehen. */
  runs: RunStatus[];
  /** Die Uhren, die noch laufen – die mit dem nächsten Schritt zuerst. */
  clocks: ClockView[];
  watched: TurnItem[];
  weighty: TurnItem[];
  rest: TurnItem[];
  /** Ab wann Geschehenes gezeigt wird. */
  since: number;
}

/** Ein Tagesmarsch in Minuten: Was näher liegt, gilt als nah an der Gruppe. */
export const DAY_MARCH = 8 * 60;
/** So weit zurück reicht der Überblick, in Tagen. */
export const TURN_DAYS = 14;
/** So weit zurück reicht „Alles“. */
export const TURN_DAYS_ALL = 90;

/**
 * Wie weit der Überblick zurückreicht, in Tagen: zwei Wochen – und mindestens bis vor den letzten
 * Zeitsprung und bis zum Beginn der laufenden Session. Wer die Zeit um einen Monat vorstellt,
 * sieht im Überblick, was in diesem Monat geschah – nicht nur dessen letzte zwei Wochen.
 */
export function turnDays(data: Pick<CampaignData, 'state' | 'sessions'>): number {
  const now = data.state.now;
  const session = currentSession(data as CampaignData);
  const span = Math.max(
    0,
    ...[data.state.previousNow, session?.startAt]
      .filter((time): time is number => typeof time === 'number' && time <= now)
      .map((time) => now - time),
  );
  return Math.max(TURN_DAYS, Math.ceil(span / MINUTES_PER_DAY));
}

/** Ist etwas beobachtet – selbst oder über einen Ort, in dem es liegt? */
function isWatched(data: CampaignData, ids: readonly string[]): boolean {
  const watch = data.state.watch;
  if (!watch.length) return false;
  return ids.some((id) => {
    if (watch.includes(id)) return true;
    const entity = data.entities[id];
    return (
      entity?.kind === 'place' && placeAncestors(data, id).some((place) => watch.includes(place.id))
    );
  });
}

/** Das Gewicht von etwas, das an diesen Orten und Einträgen hängt – mit dem Grund. */
export function turnWeight(
  data: CampaignData,
  ids: readonly string[],
): { weight: TurnWeight; why: string } {
  const near = nearness(data, ids);
  if (near === 'here') return { weight: 3, why: 'am Ort der Gruppe' };
  for (const id of ids) {
    const entity = data.entities[id];
    if (!entity) continue;
    if (entity.kind === 'person' && entity.person.met)
      return { weight: 2, why: `betrifft ${entity.name} – die Gruppe kennt die Person` };
    if (
      (entity.kind === 'faction' || entity.kind === 'family') &&
      findRelation(data, entity.id, PARTY_ID)?.attitude != null
    )
      return { weight: 2, why: `betrifft ${entity.name} – die Gruppe hat mit ihnen zu tun` };
  }
  if (near === 'reachable') {
    const party = data.state.placeId!;
    const places = [...new Set(ids.map((id) => whereOf(data, id)).filter((id) => id !== null))];
    // Dieselbe Stadt, dieselbe Gegend: nah, auch ohne eingetragenen Weg.
    const around = new Set(
      placeAncestors(data, party)
        .slice(0, 2)
        .map((place) => place.id),
    );
    if (places.some((id) => placeAncestors(data, id).some((place) => around.has(place.id))))
      return { weight: 2, why: 'in der Nähe der Gruppe' };
    // Sonst zählt der Weg: Was höchstens einen Tagesmarsch entfernt ist, ist nah.
    const minutes = places
      .map((id) => routeBetween(data, party, id))
      .filter((route) => route !== null && !route.unknown && !route.barred)
      .map((route) => route!.minutes);
    const shortest = Math.min(...minutes);
    if (shortest <= DAY_MARCH)
      return { weight: 2, why: `${formatWayTime(shortest)} von der Gruppe entfernt` };
  }
  return { weight: 1, why: 'weit weg von der Gruppe' };
}

/** Der Ort, der zwei Orte gemeinsam umschließt – für „3 Wege verschlammt in Graufels“. */
function commonPlace(data: CampaignData, a: string, b: string): Entity | null {
  const above = (id: string) => [data.entities[id], ...placeAncestors(data, id)];
  const other = new Set(above(b).map((place) => place?.id));
  return above(a).find((place) => place && other.has(place.id)) ?? null;
}

const COUNT = [
  '',
  'Ein',
  'Zwei',
  'Drei',
  'Vier',
  'Fünf',
  'Sechs',
  'Sieben',
  'Acht',
  'Neun',
  'Zehn',
];

/** Die Wege, die das Wetter verändert hat – gebündelt nach Zustand und Gegend. */
function wayItems(data: CampaignData): TurnItem[] {
  const bundles = new Map<
    string,
    { state: WayStateKind; region: Entity | null; ways: string[]; ids: Set<string>; text: string }
  >();
  for (const path of Object.values(data.paths)) {
    const [from, to] = [data.entities[path.fromId], data.entities[path.toId]];
    if (from?.kind !== 'place' || to?.kind !== 'place') continue;
    const condition = wayCondition(data, path);
    if (condition.state === 'clear') continue;
    const region = commonPlace(data, from.id, to.id);
    const key = `${condition.state}:${region?.id ?? ''}`;
    let bundle = bundles.get(key);
    if (!bundle)
      bundles.set(
        key,
        (bundle = {
          state: condition.state,
          region,
          ways: [],
          ids: new Set(),
          text: condition.text,
        }),
      );
    bundle.ways.push(
      path.name ? `${path.name} (${from.name} – ${to.name})` : `${from.name} – ${to.name}`,
    );
    bundle.ids.add(from.id).add(to.id);
  }
  return [...bundles.entries()].map(([key, bundle]) => {
    const ids = [...bundle.ids];
    const count = bundle.ways.length;
    const where = bundle.region ? ` in ${bundle.region.name}` : '';
    return {
      key: `ways:${key}`,
      kind: 'ways' as const,
      at: null,
      title:
        count === 1
          ? `Weg ${bundle.ways[0]} ${WAY_STATE_LABEL[bundle.state]}`
          : `${COUNT[count] ?? count} Wege ${WAY_STATE_LABEL[bundle.state]}${where}`,
      detail:
        count === 1 ? [bundle.text] : [...bundle.ways.sort((a, b) => a.localeCompare(b, 'de'))],
      placeId: bundle.region?.id ?? null,
      refs: ids,
      ...turnWeight(data, ids),
      watched: isWatched(data, ids),
    };
  });
}

/**
 * Was sich in der Welt getan hat – in den letzten `days` Tagen – und was jetzt gilt.
 */
export function worldTurn(data: CampaignData, days = TURN_DAYS): WorldTurn {
  const now = data.state.now;
  const since = Math.max(0, now - days * MINUTES_PER_DAY);
  const items: TurnItem[] = wayItems(data);
  for (const entry of Object.values(data.chronicle)) {
    if (!WORLD_CHRONICLE_KINDS.includes(entry.kind) || entry.at < since || entry.at > now) continue;
    const ids = [...(entry.placeId ? [entry.placeId] : []), ...entry.refs];
    // Schicksal und Aufenthalt sind Veränderungen der Welt; ihre Kopfzeile sagt, was geschah.
    const headline =
      entry.kind === 'change' || entry.kind === 'event' ? '' : recordHeadline(data, entry);
    items.push({
      key: `chronicle:${entry.id}`,
      kind: entry.kind === 'event' ? 'event' : 'change',
      at: entry.at,
      title: headline || entry.text || (entry.kind === 'event' ? 'Ereignis' : 'Veränderung'),
      detail: headline && entry.text ? [entry.text] : [],
      placeId: entry.placeId,
      refs: entry.refs,
      ...turnWeight(data, ids),
      watched: isWatched(data, ids),
    });
  }
  // Ausbleiben als Ereignis: Am Ziel weiß man zur fälligen Zeit, dass etwas fehlt – nicht, warum.
  for (const trip of missedTrips(data, since)) {
    const to = data.entities[trip.run.toId];
    const ids = [trip.run.toId, ...(trip.run.operatorId ? [trip.run.operatorId] : [])];
    items.push({
      key: `missing:${trip.run.id}:${trip.departs}`,
      kind: 'missing',
      at: trip.arrives,
      title: `${trip.run.name} bleibt${to ? ` in ${to.name}` : ''} aus`,
      detail: ['Am Ziel weiß man, dass etwas fehlt – aber nicht, warum.'],
      placeId: trip.run.toId,
      refs: trip.run.operatorId ? [trip.run.operatorId] : [],
      ...turnWeight(data, ids),
      watched: isWatched(data, ids),
    });
  }
  const cal = data.campaign.calendar;
  const suggestions: Suggestion[] = [
    ...Object.values(data.clocks)
      .filter((clock) => clock.blocked && clock.pausedAt !== null)
      .sort((a, b) => a.title.localeCompare(b.title, 'de'))
      .map((clock) => ({
        kind: 'clock' as const,
        key: `clock:${clock.id}`,
        title: `„${clock.title}“ ist blockiert`,
        why: `${clock.blocked}. Die Uhr plant nicht von selbst um – wie geht es weiter?`,
        clock,
      })),
    ...openTrips(data).map((trip) => ({
      kind: 'trip' as const,
      key: `trip:${trip.run.id}:${trip.departs}`,
      title: `${trip.run.name} vom ${formatDayMonth(cal, trip.departs)}: bleibt wohl aus`,
      why: `Am Tag der Abfahrt war der Weg ${trip.blockedBy} nicht passierbar.`,
      trip,
    })),
  ];
  // Das Schwerste zuerst, darunter das Neueste; was jetzt gilt (ohne Zeit), vor dem Geschehenen.
  items.sort(
    (a, b) =>
      b.weight - a.weight ||
      (b.at ?? Infinity) - (a.at ?? Infinity) ||
      a.title.localeCompare(b.title, 'de') ||
      a.key.localeCompare(b.key),
  );
  return {
    suggestions,
    runs: Object.values(data.runs)
      .map((run) => runStatus(data, run))
      .sort(
        (a, b) =>
          Number(a.phase !== 'stopped') - Number(b.phase !== 'stopped') ||
          (a.current?.arrives ?? a.next?.departs ?? Infinity) -
            (b.current?.arrives ?? b.next?.departs ?? Infinity) ||
          a.run.name.localeCompare(b.run.name, 'de'),
      ),
    clocks: openClocks(data.clocks, now),
    watched: items.filter((item) => item.watched),
    weighty: items.filter((item) => !item.watched && item.weight >= 2),
    rest: items.filter((item) => !item.watched && item.weight === 1),
    since,
  };
}

/** Was der Spielleiter beobachtet – als Einträge, nach Namen. */
export function watchedEntities(data: Pick<CampaignData, 'entities' | 'state'>): Entity[] {
  return data.state.watch
    .map((id) => data.entities[id])
    .filter((entity): entity is Entity => entity !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

// ── Nach Fraktion ──────────────────────────────────────────────────────────

/**
 * Der letzte Abend: die jüngste begonnene Session außer der laufenden – ab ihrem Ende (ohne Ende
 * ab ihrem Beginn). Gibt es keine frühere, gilt die laufende ab ihrem Beginn; null, wenn noch
 * kein Abend war.
 */
export function lastEvening(
  data: Pick<CampaignData, 'sessions' | 'state'>,
): { at: number; session: Session; running: boolean } | null {
  const now = data.state.now;
  const started = Object.values(data.sessions)
    .filter((session) => session.startAt <= now)
    .sort((a, b) => b.startAt - a.startAt || b.number - a.number);
  const past = started.find((session) => session.id !== data.state.sessionId);
  if (past) {
    const end = past.endAt !== null && past.endAt <= now ? past.endAt : past.startAt;
    return { at: end, session: past, running: false };
  }
  const running = started.find((session) => session.id === data.state.sessionId);
  return running ? { at: running.startAt, session: running, running: true } : null;
}

/**
 * Ab wann „nach Fraktion“ zählt: `wide` = der ganze Überblick; `evening` = seit dem Ende des
 * letzten Abends; `first` = während der ersten Session – es gibt keinen früheren Abend, also gilt
 * der Überblick (samt allem, was in dieser Session schon geschah); `none` = noch kein Abend.
 */
export interface FactionWindow {
  at: number;
  kind: 'wide' | 'evening' | 'first' | 'none';
  session: Session | null;
}

/**
 * Die Zeitspanne der Sicht „nach Fraktion“. Seit dem letzten Abend – gibt es vor der laufenden
 * Session keinen, wäre die Spanne leer, obwohl die Welt sich gedreht hat; dann gilt der Überblick
 * (`overview`, der Beginn des Weltgeschehens).
 */
export function factionWindow(
  data: Pick<CampaignData, 'sessions' | 'state'>,
  overview: number,
  wide: boolean,
): FactionWindow {
  if (wide) return { at: overview, kind: 'wide', session: null };
  const evening = lastEvening(data);
  if (!evening) return { at: overview, kind: 'none', session: null };
  if (evening.running)
    return { at: Math.min(overview, evening.at), kind: 'first', session: evening.session };
  return { at: evening.at, kind: 'evening', session: evening.session };
}

export interface FactionTurnGroup {
  entity: Entity;
  /** Was sie in der Zeitspanne getan hat – das Neueste zuerst. */
  deeds: Deed[];
  /** Vorhaben mit Uhr, die noch nicht abgelaufen sind. */
  schemes: Scheme[];
  /** Haltung zur Gruppe; null = nicht festgelegt. */
  attitude: number | null;
  watched: boolean;
}

export interface FactionTurn {
  since: number;
  /** Wer etwas getan hat – Beobachtetes zuerst, dann das zuletzt Tätige. */
  active: FactionTurnGroup[];
  /** Wer ein laufendes Vorhaben hat, aber in der Zeitspanne nichts tat. */
  quiet: FactionTurnGroup[];
}

/**
 * Was jede Fraktion seit `since` getan hat: eingetretene Schritte ihrer Vorhaben und
 * Veränderungen, die sie nennen. Dazu gehören auch Familien und Personen, die ein Vorhaben
 * antreiben. Nur gelesen – was zu entscheiden ist, steht unter den Vorschlägen.
 */
export function factionTurn(data: CampaignData, since: number): FactionTurn {
  const drivers = schemeDrivers(data);
  const watch = new Set(data.state.watch);
  const groups: FactionTurnGroup[] = [];
  for (const entity of Object.values(data.entities)) {
    const group = entity.kind === 'faction' || entity.kind === 'family';
    if (!group && !(entity.kind === 'person' && drivers.has(entity.id))) continue;
    const deeds = deedsOf(data, entity.id, since);
    const schemes = schemesOf(data, entity.id).filter(
      (scheme) => scheme.clock !== null && scheme.pace !== 'done',
    );
    if (!deeds.length && !schemes.length) continue;
    groups.push({
      entity,
      deeds,
      schemes,
      attitude: findRelation(data, entity.id, PARTY_ID)?.attitude ?? null,
      watched: watch.has(entity.id),
    });
  }
  const rank = (entity: Entity) => (entity.kind === 'person' ? 1 : 0);
  groups.sort(
    (a, b) =>
      Number(b.watched) - Number(a.watched) ||
      (b.deeds[0]?.at ?? -Infinity) - (a.deeds[0]?.at ?? -Infinity) ||
      rank(a.entity) - rank(b.entity) ||
      a.entity.name.localeCompare(b.entity.name, 'de'),
  );
  return {
    since,
    active: groups.filter((group) => group.deeds.length > 0),
    quiet: groups.filter((group) => group.deeds.length === 0),
  };
}
