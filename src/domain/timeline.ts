/**
 * Zeitleiste in Bahnen: Was geschah und was kommt, nebeneinander auf einer Achse der Weltzeit.
 * Jede Bahn gehört einem Ding – der Gruppe (Orte, Meilensteine), einer Geschichte mit Uhr, einer
 * Fraktion, einer Person oder einem Ort – oder den Terminen. Die Abende liegen als Bänder über
 * allen Bahnen.
 *
 * Wayfarer formuliert dabei nichts: Jedes Stück trägt den Titel oder Text, den der Spielleiter
 * geschrieben hat (oder die schlichte Bezeichnung seiner Art), und nie eine genauere Zeit, als
 * bekannt ist – ein Geburtsjahr ist ein Jahr, kein Tag. Der Maßstab ist Weltzeit in Minuten; Tage,
 * Monate und Jahre kommen aus der Kalender-Engine. Reine Funktionen.
 */
import { KIND_LABEL as ENTRY_KIND_LABEL, recordHeadline } from './chronicleKinds';
import type { ClockView } from './clock';
import {
  KIND_LABEL,
  entityCategory,
  entityName,
  placeSubtreeIds,
  sessionsSorted,
  visitsTo,
} from './derive';
import { monogramOf } from './factionNet';
import { entryEntityIds, sessionSpans } from './history';
import { endOf, formatDatePoint, lifeWords } from './lifespan';
import { attitudeLabel } from './relations';
import { deedsOf, schemeDrivers, schemesOf } from './schemes';
import {
  PARTY_ID,
  type CalendarEvent,
  type CampaignData,
  type ChronicleEntry,
  type ChroniclePrecision,
  type Clock,
  type DatePoint,
  type Entity,
  type Story,
} from './schema';
import { PACE_LABEL, storyClock } from './story';
import {
  MINUTES_PER_DAY,
  dayIndexOf,
  displayYear,
  formatClock,
  formatDate,
  formatDateTime,
  formatYear,
  fromTime,
  shiftMonth,
  startOfDay,
  toTime,
  weekdayName,
  weekdayOfDay,
  yearLength,
  type CalendarDef,
  type WorldTime,
} from './time/calendar';
import { eventWeight } from './weight';

const DAY = MINUTES_PER_DAY;

/** Wie weit „ungefähr“ zu jeder Seite reicht: ein paar Tage, weich gezeichnet. */
export const APPROX_DAYS = 3;

// ── Stücke und Bahnen ──────────────────────────────────────────────────────

export type LaneKind = 'party' | 'events' | 'story' | 'faction' | 'entity';

/** Wie genau ein Stück bekannt ist. `approx` = ungefähr (nachgetragen, nur die Reihenfolge …). */
export type PiecePrecision = 'exact' | 'day' | 'month' | 'year' | 'approx';

/**
 * `stay` Aufenthalt der Gruppe, `visit` Besuch der Gruppe an einem Ort, `milestone` Meilenstein,
 * `step` Schritt einer Uhr, `life` Geburt, Gründung, Tod …, `entry` Eintrag der Chronik, `event`
 * Termin, `rail` die Laufzeit einer Uhr oder eines Lebens als feine Linie unter den Stücken.
 */
export type PieceKind =
  'stay' | 'visit' | 'milestone' | 'step' | 'life' | 'entry' | 'event' | 'rail';

/**
 * `future` steht noch aus, `prevented` hat die Gruppe verhindert, `blocked` die Uhr steht,
 * `overdue` ist überfällig (das Einzige in Blutrot), `end` ein Ende (Tod, Untergang).
 */
export type PieceTone = 'plain' | 'future' | 'prevented' | 'blocked' | 'overdue' | 'end';

/** Wohin ein Stück führt. */
export type PieceLink =
  | { type: 'entity'; id: string }
  | { type: 'story'; id: string }
  | { type: 'clock'; id: string }
  | { type: 'chronicle'; id: string }
  | { type: 'session'; id: string }
  | { type: 'event'; id: string; at: WorldTime };

export interface TimelinePiece {
  key: string;
  kind: PieceKind;
  /** Beginn – bei einem Punkt der Zeitpunkt. */
  from: WorldTime;
  /** Ende; null = ein Punkt. */
  to: WorldTime | null;
  precision: PiecePrecision;
  /** Wie weit das Stück reicht, samt Ungewissheit: ein Jahr, das nur als Jahr bekannt ist, … */
  lo: WorldTime;
  hi: WorldTime;
  /** Nur der Titel oder Text des Spielleiters – oder die Bezeichnung der Art. */
  text: string;
  link: PieceLink | null;
  /** 3 = trägt die Geschichte, 2 = wichtig, 1 = Beiwerk. Wer schwerer ist, behält die Schrift. */
  weight: 1 | 2 | 3;
  tone: PieceTone;
}

export interface TimelineLane {
  /** `party`, `events`, `story:<id>` oder `entity:<id>`. */
  key: string;
  kind: LaneKind;
  title: string;
  /** Was es ist: „Geschichte · läuft“, „Fraktion“ … */
  sub: string;
  /** Das eigene Bild des Eintrags (Adresse des Ursprungs) – null = Monogramm. */
  image: string | null;
  monogram: string;
  /** Wohin der Kopf der Bahn führt. */
  link: PieceLink | null;
  pieces: TimelinePiece[];
}

/** Ein Abend als Band über allen Bahnen. */
export interface Evening {
  key: string;
  sessionId: string;
  number: number;
  title: string;
  from: WorldTime;
  to: WorldTime;
  running: boolean;
}

const CHRONICLE_PRECISION: Record<ChroniclePrecision, PiecePrecision> = {
  exact: 'exact',
  day: 'day',
  approx: 'approx',
  order: 'approx',
};

const yearStart = (cal: CalendarDef, year: number): WorldTime =>
  toTime(cal, { year: Math.max(1, year), month: 0, day: 1, hour: 0, minute: 0 });

/** Wie weit ein Zeitpunkt reicht, wenn er nur so genau bekannt ist. */
export function spreadOf(
  cal: CalendarDef,
  at: WorldTime,
  precision: PiecePrecision,
): { lo: WorldTime; hi: WorldTime } {
  const t = Math.max(0, at);
  switch (precision) {
    case 'exact':
      return { lo: t, hi: t };
    case 'day':
      return { lo: startOfDay(t), hi: startOfDay(t) + DAY };
    case 'approx':
      return { lo: Math.max(0, t - APPROX_DAYS * DAY), hi: t + APPROX_DAYS * DAY };
    case 'month': {
      const d = fromTime(cal, t);
      const next = shiftMonth(cal, d.year, d.month, 1);
      return {
        lo: toTime(cal, { year: d.year, month: d.month, day: 1, hour: 0, minute: 0 }),
        hi: toTime(cal, { year: next.year, month: next.month, day: 1, hour: 0, minute: 0 }),
      };
    }
    case 'year': {
      const year = fromTime(cal, t).year;
      return { lo: yearStart(cal, year), hi: yearStart(cal, year + 1) };
    }
  }
}

type PieceInit = Omit<TimelinePiece, 'lo' | 'hi'>;

function piece(cal: CalendarDef, init: PieceInit): TimelinePiece {
  const start = spreadOf(cal, init.from, init.precision);
  const end = init.to === null ? start : spreadOf(cal, init.to, init.precision);
  return { ...init, lo: start.lo, hi: Math.max(start.hi, end.hi, init.to ?? 0) };
}

/** Wann ein Stück war – nie genauer als bekannt: „17. Tauwind 701 AD, 14:00“, „667 AD“. */
export function pieceWhen(cal: CalendarDef, p: Pick<TimelinePiece, 'from' | 'to' | 'precision'>) {
  const one = (t: WorldTime): string => {
    switch (p.precision) {
      case 'exact':
        return formatDateTime(cal, t);
      case 'day':
        return formatDate(cal, t);
      case 'approx':
        return `etwa ${formatDate(cal, t)}`;
      default:
        return formatDatePoint(cal, { at: t, precision: p.precision });
    }
  };
  if (p.to === null || p.to === p.from) return one(p.from);
  if (p.precision === 'exact' && dayIndexOf(p.from) === dayIndexOf(p.to))
    return `${formatDate(cal, p.from)}, ${formatClock(p.from)}–${formatClock(p.to)}`;
  return `${one(p.from)} – ${one(p.to)}`;
}

// ── Was ein Eintrag der Chronik sagt ───────────────────────────────────────

const firstLine = (text: string) => text.trim().split('\n')[0]!.trim();

/** Eine Zeile zu einem Eintrag: seine Kopfzeile und der erste Satz des Spielleiters. */
export function entryLine(data: CampaignData, entry: ChronicleEntry): string {
  const text = firstLine(entry.text);
  let head = '';
  if (entry.kind === 'travel' && entry.travel?.toId)
    head = `Ankunft: ${entityName(data, entry.travel.toId)}`;
  else if (entry.kind === 'attitude' && entry.attitude) {
    const { fromId, toId, before, after } = entry.attitude;
    const toward = toId === PARTY_ID ? 'zur Gruppe' : `zu ${entityName(data, toId)}`;
    head = `${entityName(data, fromId)} ${toward}: ${attitudeLabel(before)} → ${attitudeLabel(after)}`;
  } else if (entry.kind !== 'event') head = recordHeadline(data, entry);
  return [head, text].filter(Boolean).join(' – ') || ENTRY_KIND_LABEL[entry.kind];
}

const entryPiece = (
  data: CampaignData,
  entry: ChronicleEntry,
  weight: 1 | 2 | 3,
  lane: string,
): TimelinePiece =>
  piece(data.campaign.calendar, {
    key: `${lane}:chronicle:${entry.id}`,
    kind: entry.kind === 'milestone' ? 'milestone' : 'entry',
    from: entry.at,
    to: null,
    precision: CHRONICLE_PRECISION[entry.precision],
    text: entryLine(data, entry),
    link: { type: 'chronicle', id: entry.id },
    weight,
    tone: entry.kind === 'fate' ? 'end' : 'plain',
  });

/** Wie schwer ein Eintrag in der Bahn eines Dings wiegt. */
const ENTRY_WEIGHT: Partial<Record<ChronicleEntry['kind'], 1 | 2 | 3>> = {
  fate: 3,
  milestone: 3,
  transformation: 3,
  reveal: 3,
  change: 2,
  attitude: 2,
  meeting: 2,
  fight: 2,
  decision: 2,
  discovery: 2,
  promise: 2,
  bond: 2,
  whereabouts: 2,
  event: 2,
};

// ── Bahnen ─────────────────────────────────────────────────────────────────

const chronicleByTime = (data: CampaignData) =>
  Object.values(data.chronicle).sort(
    (a, b) => a.at - b.at || a.created.localeCompare(b.created) || a.id.localeCompare(b.id),
  );

/** Die Gruppe: wo sie war (aus den Ortswechseln) und ihre Meilensteine. */
function partyLane(data: CampaignData): TimelineLane {
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const pieces: TimelinePiece[] = [];
  const travels = chronicleByTime(data).filter((e) => e.kind === 'travel' && e.travel);
  travels.forEach((entry, index) => {
    const placeId = entry.travel!.toId;
    if (!placeId) return;
    const next = travels[index + 1];
    const to = next ? next.at : Math.max(now, entry.at);
    pieces.push(
      piece(cal, {
        key: `party:stay:${entry.id}`,
        kind: 'stay',
        from: entry.at,
        to,
        precision: entry.precision === 'exact' ? 'exact' : CHRONICLE_PRECISION[entry.precision],
        text: entityName(data, placeId),
        link: { type: 'entity', id: placeId },
        weight: 3,
        tone: entry.at > now ? 'future' : 'plain',
      }),
    );
  });
  for (const entry of Object.values(data.chronicle))
    if (entry.kind === 'milestone') pieces.push(entryPiece(data, entry, 3, 'party'));
  const evenings = sessionsSorted(data).length;
  return {
    key: 'party',
    kind: 'party',
    title: 'Die Gruppe',
    sub: evenings === 1 ? '1 Abend' : `${evenings} Abende`,
    image: null,
    monogram: '',
    link: null,
    pieces: sortPieces(pieces),
  };
}

/** Die Schritte einer Uhr und ihre Laufzeit als Linie darunter. */
function clockPieces(
  data: CampaignData,
  clock: Clock,
  view: ClockView,
  lane: string,
  link: PieceLink,
): TimelinePiece[] {
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const out: TimelinePiece[] = [];
  const times = view.steps.map((s) => s.at);
  const end = times.length ? Math.max(clock.start, ...times) : clock.start;
  out.push(
    piece(cal, {
      key: `${lane}:rail:${clock.id}`,
      kind: 'rail',
      from: clock.start,
      to: end,
      precision: 'exact',
      text: clock.title,
      link,
      weight: 1,
      tone: view.done ? 'plain' : 'future',
    }),
  );
  for (const s of view.steps) {
    const tone: PieceTone =
      s.state === 'prevented'
        ? 'prevented'
        : s.state === 'done'
          ? 'plain'
          : s.state === 'next' && view.blocked
            ? 'blocked'
            : s.state === 'next' && s.at < now
              ? 'overdue'
              : 'future';
    out.push(
      piece(cal, {
        key: `${lane}:step:${clock.id}:${s.step.id}`,
        kind: 'step',
        from: s.at,
        to: null,
        precision: 'exact',
        text: s.step.text,
        link,
        weight: s.state === 'later' ? 2 : 3,
        tone,
      }),
    );
  }
  return out;
}

function storyLane(data: CampaignData, story: Story): TimelineLane | null {
  const clock = story.clockId ? data.clocks[story.clockId] : undefined;
  if (!clock) return null;
  const { pace, view } = storyClock(data, story);
  const lane = `story:${story.id}`;
  const link: PieceLink = { type: 'story', id: story.id };
  const pieces = clockPieces(data, clock, view!, lane, link);
  for (const entry of Object.values(data.chronicle))
    if (entry.storyId === story.id && !entry.clockId)
      pieces.push(entryPiece(data, entry, ENTRY_WEIGHT[entry.kind] ?? 1, lane));
  const driver = story.ownerId ?? clock.ownerId;
  const owner = driver ? data.entities[driver] : undefined;
  return {
    key: lane,
    kind: 'story',
    title: story.title,
    sub: `Geschichte · ${story.closed ? 'zu Ende erzählt' : PACE_LABEL[pace]}`,
    image: owner?.image ?? null,
    monogram: monogramOf(story.title),
    link,
    pieces: sortPieces(pieces),
  };
}

/** Geburt und Tod, Gründung und Untergang – mit ihrer Genauigkeit – und die Linie dazwischen. */
function lifePieces(data: CampaignData, entity: Entity, lane: string): TimelinePiece[] {
  const cal = data.campaign.calendar;
  const words = lifeWords(entity.kind);
  const link: PieceLink = { type: 'entity', id: entity.id };
  const born = entity.born;
  const ended = endOf(data, entity);
  const out: TimelinePiece[] = [];
  const mark = (point: DatePoint, text: string, tone: PieceTone, key: string) =>
    out.push(
      piece(cal, {
        key: `${lane}:${key}`,
        kind: 'life',
        from: point.at,
        to: null,
        precision: point.precision,
        text,
        link,
        weight: 3,
        tone,
      }),
    );
  if (born) mark(born, words.start, born.at > data.state.now ? 'future' : 'plain', 'born');
  if (ended) mark(ended, words.end, 'end', 'ended');
  if (born) {
    const until = ended?.at ?? Math.max(data.state.now, born.at);
    const rail = piece(cal, {
      key: `${lane}:rail:life`,
      kind: 'rail',
      from: born.at,
      to: until,
      precision: born.precision,
      text: entity.name,
      link,
      weight: 1,
      tone: 'plain',
    });
    // Ungewiss ist nur, was ungewiss ist: der Anfang – und das Ende nur, wenn es eins gibt.
    rail.hi = ended ? spreadOf(cal, ended.at, ended.precision).hi : until;
    out.push(rail);
  }
  return out;
}

const isGroupKind = (entity: Entity) => entity.kind === 'faction' || entity.kind === 'family';

/** Eine Fraktion oder Familie: ihre Vorhaben, was sie getan hat, Gründung und Ende. */
function factionLane(data: CampaignData, entity: Entity): TimelineLane {
  const cal = data.campaign.calendar;
  const lane = `entity:${entity.id}`;
  const pieces = lifePieces(data, entity, lane);
  for (const scheme of schemesOf(data, entity.id, { withClosed: true })) {
    if (!scheme.clock || !scheme.view) continue;
    const link: PieceLink = scheme.story
      ? { type: 'story', id: scheme.story.id }
      : { type: 'clock', id: scheme.clock.id };
    pieces.push(...clockPieces(data, scheme.clock, scheme.view, lane, link));
  }
  for (const deed of deedsOf(data, entity.id, -1, Number.MAX_SAFE_INTEGER)) {
    if (deed.kind === 'step' || deed.kind === 'prevented' || !deed.entryId) continue;
    const entry = data.chronicle[deed.entryId];
    if (!entry) continue;
    pieces.push(
      piece(cal, {
        key: `${lane}:chronicle:${entry.id}`,
        kind: 'entry',
        from: entry.at,
        to: null,
        precision: CHRONICLE_PRECISION[entry.precision],
        text: deed.text,
        link: { type: 'chronicle', id: entry.id },
        weight: 2,
        tone: 'plain',
      }),
    );
  }
  return {
    key: lane,
    kind: 'faction',
    title: entity.name,
    sub: KIND_LABEL[entity.kind],
    image: entity.image,
    monogram: monogramOf(entity.name),
    link: { type: 'entity', id: entity.id },
    pieces: sortPieces(pieces),
  };
}

/** Eine Person, ein Ort, ein Gefährte …: Lebensdaten, Besuche der Gruppe, Einträge mit ihm. */
function entityLane(data: CampaignData, entity: Entity): TimelineLane {
  const lane = `entity:${entity.id}`;
  const pieces = lifePieces(data, entity, lane);
  const cal = data.campaign.calendar;
  const isPlace = entity.kind === 'place';
  const inside = isPlace ? placeSubtreeIds(data, entity.id) : null;
  if (isPlace)
    for (const visit of visitsTo(data, entity.id))
      pieces.push(
        piece(cal, {
          key: `${lane}:visit:${visit.from}`,
          kind: 'visit',
          from: visit.from,
          to: visit.to ?? Math.max(data.state.now, visit.from),
          precision: 'exact',
          text: 'Die Gruppe ist hier',
          link: { type: 'entity', id: entity.id },
          weight: 3,
          tone: 'plain',
        }),
      );
  for (const entry of Object.values(data.chronicle)) {
    // Ortswechsel stehen als Besuche da – nicht noch einmal als Punkt.
    if (isPlace && entry.kind === 'travel') continue;
    const named =
      entryEntityIds(entry).includes(entity.id) ||
      (inside !== null && entry.placeId !== null && inside.has(entry.placeId));
    if (named) pieces.push(entryPiece(data, entry, ENTRY_WEIGHT[entry.kind] ?? 1, lane));
  }
  return {
    key: lane,
    kind: 'entity',
    title: entity.name,
    sub: [KIND_LABEL[entity.kind], entityCategory(entity)].filter(Boolean).join(' · '),
    image: entity.image,
    monogram: monogramOf(entity.name),
    link: { type: 'entity', id: entity.id },
    pieces: sortPieces(pieces),
  };
}

/** So oft darf ein wiederkehrender Termin im Bild stehen – sonst ist er bei diesem Maßstab Rauschen. */
export const MAX_REPEATS_IN_VIEW = 40;

/** Termine: Feste und einmalige Ereignisse nach ihrem Gewicht – Alltägliches nie. */
function eventsLane(data: CampaignData, window: TimeWindow): TimelineLane {
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const pieces: TimelinePiece[] = [];
  const add = (event: CalendarEvent, at: WorldTime, key: string) => {
    const weight = eventWeight(data, event);
    const overdue =
      !event.repeat && !event.done && event.kind !== 'world' && dayIndexOf(at) < dayIndexOf(now);
    pieces.push(
      piece(cal, {
        key,
        kind: 'event',
        from: at,
        to: event.durationDays ? at + event.durationDays * DAY : null,
        precision: event.timed ? 'exact' : 'day',
        text: event.title,
        link: { type: 'event', id: event.id, at },
        weight: weight === 'story' ? 3 : weight === 'main' ? 2 : 1,
        tone: overdue ? 'overdue' : at > now ? 'future' : 'plain',
      }),
    );
  };
  for (const event of Object.values(data.events)) {
    if (eventWeight(data, event) === 'everyday') continue;
    if (!event.repeat) {
      add(event, event.timed ? event.at : startOfDay(event.at), `events:${event.id}`);
      continue;
    }
    const times = occurrencesIn(cal, event, window);
    if (times.length > MAX_REPEATS_IN_VIEW) continue;
    for (const at of times) add(event, at, `events:${event.id}:${at}`);
  }
  return {
    key: 'events',
    kind: 'events',
    title: 'Termine',
    sub: 'Feste und Ereignisse',
    image: null,
    monogram: '',
    link: null,
    pieces: sortPieces(pieces),
  };
}

/** Die Male eines wiederkehrenden Termins im Fenster – nach Tag, Woche, Monat oder Jahr. */
function occurrencesIn(cal: CalendarDef, event: CalendarEvent, window: TimeWindow): WorldTime[] {
  const repeat = event.repeat!;
  const base = event.timed ? event.at : startOfDay(event.at);
  const from = Math.max(base, window.from);
  if (from > window.to) return [];
  const skipped = new Set(event.skip);
  const out: WorldTime[] = [];
  const fixed =
    repeat.unit === 'day'
      ? repeat.every * DAY
      : repeat.unit === 'week'
        ? repeat.every * cal.weekdays.length * DAY
        : 0;
  if (fixed) {
    let at = base + Math.max(0, Math.ceil((from - base) / fixed)) * fixed;
    for (; at <= window.to && out.length <= MAX_REPEATS_IN_VIEW; at += fixed)
      if (!skipped.has(dayIndexOf(at))) out.push(at);
    return out;
  }
  const b = fromTime(cal, base);
  const months = repeat.unit === 'year' ? repeat.every * cal.months.length : repeat.every;
  const start = fromTime(cal, from);
  const gone = (start.year - b.year) * cal.months.length + start.month - b.month;
  let n = Math.max(0, Math.floor(gone / months) - 1);
  for (let guard = 0; guard < 4 * MAX_REPEATS_IN_VIEW && out.length <= MAX_REPEATS_IN_VIEW; n++) {
    guard++;
    const m = shiftMonth(cal, b.year, b.month, n * months);
    const days = monthDays(cal, m.year, m.month);
    const at = toTime(cal, {
      year: m.year,
      month: m.month,
      day: Math.min(b.day, days),
      hour: b.hour,
      minute: b.minute,
    });
    if (at > window.to) break;
    if (at >= window.from && !skipped.has(dayIndexOf(at))) out.push(at);
  }
  return out;
}

const monthDays = (cal: CalendarDef, year: number, month: number): number => {
  const next = shiftMonth(cal, year, month, 1);
  return (
    (toTime(cal, { year: next.year, month: next.month, day: 1, hour: 0, minute: 0 }) -
      toTime(cal, { year, month, day: 1, hour: 0, minute: 0 })) /
    DAY
  );
};

const sortPieces = (pieces: TimelinePiece[]) =>
  pieces.sort((a, b) => a.from - b.from || b.weight - a.weight || a.key.localeCompare(b.key));

// ── Welche Bahnen ──────────────────────────────────────────────────────────

export interface TimeWindow {
  from: WorldTime;
  to: WorldTime;
}

export interface LaneChoice {
  key: string;
  kind: LaneKind;
  title: string;
  sub: string;
}

/** So viele Geschichten und Fraktionen nimmt Wayfarer von selbst – der Rest ist wählbar. */
export const DEFAULT_STORIES = 6;
export const DEFAULT_FACTIONS = 4;

const storiesWithClock = (data: CampaignData) =>
  Object.values(data.stories)
    .filter((story) => story.clockId && data.clocks[story.clockId])
    .sort(
      (a, b) =>
        Number(a.closed) - Number(b.closed) ||
        Number(b.inPlay) - Number(a.inPlay) ||
        a.title.localeCompare(b.title, 'de'),
    );

const groups = (data: CampaignData) =>
  Object.values(data.entities)
    .filter(isGroupKind)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

/**
 * Was Wayfarer zeigt, solange der Spielleiter nichts gewählt hat: die Gruppe, die Termine, die
 * Geschichten mit Uhr (im Spiel zuerst, zu Ende erzählte nicht) und die Fraktionen, die etwas
 * vorhaben.
 */
export function defaultLaneKeys(data: CampaignData): string[] {
  const drivers = schemeDrivers(data);
  const stories = storiesWithClock(data)
    .filter((story) => !story.closed)
    .slice(0, DEFAULT_STORIES)
    .map((story) => `story:${story.id}`);
  const factions = groups(data)
    .filter((entity) => drivers.has(entity.id) && entity.ended === null)
    .slice(0, DEFAULT_FACTIONS)
    .map((entity) => `entity:${entity.id}`);
  return ['party', 'events', ...stories, ...factions];
}

/** Gibt es zu diesem Schlüssel (noch) etwas? */
export function laneExists(data: CampaignData, key: string): boolean {
  if (key === 'party' || key === 'events') return true;
  if (key.startsWith('story:')) {
    const story = data.stories[key.slice(6)];
    return !!story?.clockId && !!data.clocks[story.clockId];
  }
  if (key.startsWith('entity:')) return !!data.entities[key.slice(7)];
  return false;
}

/** Die Bahnen, wie sie stehen: gewählt oder von Wayfarer – ohne Gelöschtes, ohne Doppelte. */
export function laneKeysOf(data: CampaignData): string[] {
  const keys = data.state.timelineLanes ?? defaultLaneKeys(data);
  return [...new Set(keys)].filter((key) => laneExists(data, key));
}

/** Was sich als Bahn wählen lässt, ohne zu suchen: Gruppe, Termine, Geschichten mit Uhr, Fraktionen. */
export function laneChoices(data: CampaignData): LaneChoice[] {
  const out: LaneChoice[] = [
    { key: 'party', kind: 'party', title: 'Die Gruppe', sub: 'Abende, Orte, Meilensteine' },
    { key: 'events', kind: 'events', title: 'Termine', sub: 'Feste und Ereignisse' },
  ];
  for (const story of storiesWithClock(data))
    out.push({
      key: `story:${story.id}`,
      kind: 'story',
      title: story.title,
      sub: story.closed ? 'Geschichte · zu Ende erzählt' : 'Geschichte',
    });
  for (const entity of groups(data))
    out.push({
      key: `entity:${entity.id}`,
      kind: 'faction',
      title: entity.name,
      sub: KIND_LABEL[entity.kind],
    });
  return out;
}

/** Eine Bahn nach ihrem Schlüssel – null, wenn es sie nicht (mehr) gibt. */
export function laneOf(data: CampaignData, key: string, window: TimeWindow): TimelineLane | null {
  if (key === 'party') return partyLane(data);
  if (key === 'events') return eventsLane(data, window);
  if (key.startsWith('story:')) {
    const story = data.stories[key.slice(6)];
    return story ? storyLane(data, story) : null;
  }
  if (key.startsWith('entity:')) {
    const entity = data.entities[key.slice(7)];
    if (!entity) return null;
    return isGroupKind(entity) ? factionLane(data, entity) : entityLane(data, entity);
  }
  return null;
}

/**
 * Die Bahnen der Zeitleiste in der gewählten Reihenfolge. Termine, die sich wiederholen, stehen
 * nur im Fenster `window` – alles andere ganz.
 */
export function timelineLanes(
  data: CampaignData,
  options: { keys?: readonly string[]; window: TimeWindow },
): TimelineLane[] {
  const keys = options.keys ?? laneKeysOf(data);
  return keys
    .map((key) => laneOf(data, key, options.window))
    .filter((lane): lane is TimelineLane => lane !== null);
}

/** Die Abende als Bänder: von ihrem Beginn bis zum Ende (der laufende bis jetzt). */
export function evenings(data: CampaignData): Evening[] {
  const now = data.state.now;
  return sessionSpans(data).map((span) => ({
    key: `session:${span.session.id}`,
    sessionId: span.session.id,
    number: span.session.number,
    title: span.session.title.trim() || `Abend ${span.session.number}`,
    from: span.from,
    to: Math.max(span.from, span.to ?? now),
    running: span.running,
  }));
}

/** Von wann bis wann es überhaupt etwas zu sehen gibt – mindestens jetzt. */
export function timelineExtent(
  lanes: readonly TimelineLane[],
  bands: readonly Evening[],
  now: WorldTime,
): TimeWindow {
  let from = now;
  let to = now;
  for (const lane of lanes)
    for (const p of lane.pieces) {
      from = Math.min(from, p.lo);
      to = Math.max(to, p.hi);
    }
  for (const band of bands) {
    from = Math.min(from, band.from);
    to = Math.max(to, band.to);
  }
  return { from, to };
}

// ── Maßstab und Achse ──────────────────────────────────────────────────────

/** Was im Bild ist: der linke Rand in Weltzeit, Minuten je Bildpunkt, die Breite. */
export interface TimelineView {
  from: number;
  mpp: number;
  width: number;
}

export type AxisUnit = 'hour' | 'day' | 'month' | 'year' | 'decade' | 'century';

export const AXIS_UNITS: readonly AxisUnit[] = [
  'hour',
  'day',
  'month',
  'year',
  'decade',
  'century',
];

export const AXIS_UNIT_LABEL: Record<AxisUnit, string> = {
  hour: 'Stunden',
  day: 'Tage',
  month: 'Monate',
  year: 'Jahre',
  decade: 'Jahrzehnte',
  century: 'Jahrhunderte',
};

/** Ein Jahr im Mittel, in Minuten – für den Maßstab, nie für ein Datum. */
const meanYear = (cal: CalendarDef): number =>
  ((yearLength(cal, 1) * 3 + yearLength(cal, 4)) / 4) * DAY;

/** Die Grenzen des Zoomens: von einer Stunde auf 240 Bildpunkten bis zwei Jahren je Bildpunkt. */
export function zoomBounds(cal: CalendarDef): { min: number; max: number } {
  return { min: 0.25, max: meanYear(cal) * 2 };
}

/** So breit ist eine Einheit beim Wählen einer Zoomstufe. */
const PRESET_PX = 110;

/** Der Maßstab, bei dem eine Einheit gut zu lesen ist: eine Stunde, ein Tag … auf `PRESET_PX`. */
export function zoomPreset(cal: CalendarDef, unit: AxisUnit): number {
  const year = meanYear(cal);
  switch (unit) {
    case 'hour':
      return 60 / PRESET_PX;
    case 'day':
      return DAY / PRESET_PX;
    case 'month':
      return year / cal.months.length / PRESET_PX;
    case 'year':
      return year / PRESET_PX;
    case 'decade':
      return (10 * year) / PRESET_PX;
    case 'century':
      return (100 * year) / PRESET_PX;
  }
}

interface TickStep {
  unit: AxisUnit;
  every: number;
  /** Ungefähre Länge in Minuten. */
  length: number;
}

function tickSteps(cal: CalendarDef): TickStep[] {
  const year = meanYear(cal);
  const month = year / cal.months.length;
  const week = cal.weekdays.length;
  const out: TickStep[] = [];
  for (const every of [1, 2, 3, 6, 12]) out.push({ unit: 'hour', every, length: every * 60 });
  for (const every of [1, 2, week]) out.push({ unit: 'day', every, length: every * DAY });
  for (const every of [1, 2, 3, 6])
    if (cal.months.length % every === 0) out.push({ unit: 'month', every, length: every * month });
  for (const every of [1, 2, 5]) out.push({ unit: 'year', every, length: every * year });
  for (const every of [10, 20, 50]) out.push({ unit: 'decade', every, length: every * year });
  for (const every of [100, 200, 500, 1000, 2000, 5000])
    out.push({ unit: 'century', every, length: every * year });
  return out;
}

/** Mindestabstand zweier Teilstriche in Bildpunkten. */
export const TICK_MIN_PX = 64;

/** Die Teilung für einen Maßstab: die feinste, deren Striche mindestens `TICK_MIN_PX` auseinander liegen. */
export function tickStep(cal: CalendarDef, mpp: number): TickStep {
  const steps = tickSteps(cal);
  return steps.find((step) => step.length / mpp >= TICK_MIN_PX) ?? steps[steps.length - 1]!;
}

/** Die Einheit, die ein Maßstab zeigt – für die Anzeige „Tage“, „Jahre“ … */
export const zoomUnit = (cal: CalendarDef, mpp: number): AxisUnit => tickStep(cal, mpp).unit;

export interface AxisTick {
  at: WorldTime;
  /** Die Beschriftung der Teilung: „14:00“, „17.“, „Tauwind“, „701“. */
  label: string;
  /**
   * Grenze der nächstgrößeren Einheit (Tag, Monat, Jahr …) – stärker gezeichnet und mit dem,
   * wo man ist: „17. Tauwind 701 AD“, „Tauwind 701 AD“, „701 AD“. null = gewöhnlicher Strich.
   */
  major: string | null;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Die Zeitpunkte, an denen eine Einheit beginnt, im Fenster. */
function boundaries(
  cal: CalendarDef,
  from: WorldTime,
  to: WorldTime,
  unit: AxisUnit,
  every: number,
): WorldTime[] {
  const out: WorldTime[] = [];
  const lo = Math.max(0, Math.floor(from));
  const hi = Math.max(lo, Math.ceil(to));
  const LIMIT = 1000;
  if (unit === 'hour') {
    const step = every * 60;
    for (let t = Math.ceil(lo / step) * step; t <= hi && out.length < LIMIT; t += step) out.push(t);
    return out;
  }
  if (unit === 'day') {
    for (let d = dayIndexOf(lo); d * DAY <= hi && out.length < LIMIT; d++) {
      const t = d * DAY;
      if (t < lo) continue;
      if (every === 1) out.push(t);
      else if (every === cal.weekdays.length) {
        if (weekdayOfDay(cal, d) === 0) out.push(t);
      } else if (mod(fromTime(cal, t).day - 1, every) === 0) out.push(t);
    }
    return out;
  }
  if (unit === 'month') {
    const start = fromTime(cal, lo);
    for (let n = 0; out.length < LIMIT; n++) {
      const m = shiftMonth(cal, start.year, start.month, n);
      const t = toTime(cal, { year: m.year, month: m.month, day: 1, hour: 0, minute: 0 });
      if (t > hi) break;
      if (t >= lo && m.month % every === 0) out.push(t);
    }
    return out;
  }
  // Jahre, Jahrzehnte, Jahrhunderte: ausgerichtet an der Jahreszahl der Hauptzeitrechnung.
  const first = fromTime(cal, lo).year;
  let year = first + mod(-displayYear(cal, first), every);
  for (; out.length < LIMIT; year += every) {
    const t = yearStart(cal, year);
    if (t > hi) break;
    if (t >= lo) out.push(t);
  }
  return out;
}

/** Die nächstgrößere Teilung zu einer Einheit. */
function majorOf(step: TickStep): { unit: AxisUnit; every: number } {
  switch (step.unit) {
    case 'hour':
      return { unit: 'day', every: 1 };
    case 'day':
      return { unit: 'month', every: 1 };
    case 'month':
      return { unit: 'year', every: 1 };
    case 'year':
      return { unit: 'decade', every: 10 };
    case 'decade':
      return { unit: 'century', every: 100 };
    case 'century':
      return { unit: 'century', every: step.every >= 1000 ? step.every * 10 : 1000 };
  }
}

function tickLabel(cal: CalendarDef, t: WorldTime, unit: AxisUnit): string {
  const d = fromTime(cal, t);
  switch (unit) {
    case 'hour':
      return formatClock(t);
    case 'day':
      return `${d.day}.`;
    case 'month':
      return cal.months[d.month]?.name ?? '';
    default:
      return String(displayYear(cal, d.year));
  }
}

function majorLabel(cal: CalendarDef, t: WorldTime, unit: AxisUnit): string {
  const d = fromTime(cal, t);
  switch (unit) {
    case 'hour':
      return `${weekdayName(cal, t)}, ${formatDate(cal, t)}`;
    case 'day':
      return `${cal.months[d.month]?.name ?? ''} ${formatYear(cal, d.year)}`;
    default:
      return formatYear(cal, d.year);
  }
}

/**
 * Die Teilstriche der Achse im Fenster: die Teilung, die zum Maßstab passt, und dazu die
 * Grenzen der nächstgrößeren Einheit (beim Blick auf Tage die Monate) mit Monat und Jahr.
 */
export function axisTicks(
  cal: CalendarDef,
  view: TimelineView,
): { unit: AxisUnit; ticks: AxisTick[] } {
  const from = view.from;
  const to = view.from + view.width * view.mpp;
  const step = tickStep(cal, view.mpp);
  const major = majorOf(step);
  const majors = new Set(boundaries(cal, from, to, major.unit, major.every));
  const minors = boundaries(cal, from, to, step.unit, step.every);
  const all = [...new Set([...minors, ...majors])].sort((a, b) => a - b);
  return {
    unit: step.unit,
    ticks: all.map((at) => ({
      at,
      label: tickLabel(cal, at, step.unit),
      major: majors.has(at) ? majorLabel(cal, at, step.unit) : null,
    })),
  };
}

/**
 * Wo man ist, wenn keine Grenze im Bild liegt: bei Stunden der Tag, bei Tagen Monat und Jahr, bei
 * Monaten das Jahr – gemessen an der Mitte des Bildes. null bei Jahren und mehr (die Achse sagt es).
 */
export function axisContext(cal: CalendarDef, view: TimelineView): string | null {
  const unit = tickStep(cal, view.mpp).unit;
  if (unit !== 'hour' && unit !== 'day' && unit !== 'month') return null;
  const middle = Math.max(0, Math.round(view.from + (view.width / 2) * view.mpp));
  return majorLabel(cal, middle, unit);
}

/** Wo ein Zeitpunkt im Bild liegt, in Bildpunkten vom linken Rand. */
export const toX = (view: TimelineView, t: number): number => (t - view.from) / view.mpp;

/** Welcher Zeitpunkt an einer Stelle des Bildes liegt. */
export const atX = (view: TimelineView, x: number): number => view.from + x * view.mpp;

/**
 * Zoomen um eine Stelle: Der Zeitpunkt unter der Maus bleibt, wo er ist. Der Maßstab bleibt
 * zwischen Stunden und Jahrhunderten (`zoomBounds`).
 */
export function zoomView(
  cal: CalendarDef,
  view: TimelineView,
  factor: number,
  anchorX: number = view.width / 2,
): TimelineView {
  const bounds = zoomBounds(cal);
  const mpp = Math.min(bounds.max, Math.max(bounds.min, view.mpp * factor));
  const at = atX(view, anchorX);
  return { ...view, mpp, from: Math.max(0, at - anchorX * mpp) };
}

/** Verschiebt um Bildpunkte (positiv = in die Vergangenheit). */
export const panView = (view: TimelineView, dx: number): TimelineView => ({
  ...view,
  from: Math.max(0, view.from - dx * view.mpp),
});

/** Stellt einen Zeitpunkt an eine Stelle des Bildes (Vorgabe: ein Drittel von links). */
export const centerView = (
  view: TimelineView,
  t: WorldTime,
  at: number = view.width / 3,
): TimelineView => ({ ...view, from: Math.max(0, t - at * view.mpp) });

/** Zeigt einen Zeitraum ganz, mit etwas Rand. */
export function fitView(cal: CalendarDef, view: TimelineView, window: TimeWindow): TimelineView {
  const bounds = zoomBounds(cal);
  const span = Math.max(window.to - window.from, 60);
  const mpp = Math.min(bounds.max, Math.max(bounds.min, (span * 1.12) / Math.max(1, view.width)));
  const middle = (window.from + window.to) / 2;
  return { ...view, mpp, from: Math.max(0, middle - (view.width / 2) * mpp) };
}

// ── Auslegen einer Bahn ────────────────────────────────────────────────────

/** Ungefähre Breite eines Zeichens der Beschriftung in Bildpunkten (Crimson Pro, klein). */
export const CHAR_PX = 7;
/** Halbe Breite einer Marke und Abstand bis zur Schrift. */
export const MARK_HALF = 7;
const LABEL_GAP = 5;
/** Kürzer als so wird eine Beschriftung nicht – dann weicht sie ganz. */
export const MIN_LABEL_PX = 34;
/** Höchstens so viele Reihen je Bahn. */
export const MAX_ROWS = 3;
/** Marken, die näher beieinander liegen, werden ab drei zu einem Bündel. */
export const CLUSTER_PX = 9;
const MARGIN_PX = 240;

export interface LaidPiece {
  key: string;
  piece: TimelinePiece;
  /** Linker Rand (Leiste) bzw. Mitte (Marke) in Bildpunkten. */
  x: number;
  /** Breite der Leiste; 0 bei einer Marke. */
  w: number;
  /** Die Ungewissheit in Bildpunkten. */
  lo: number;
  hi: number;
  row: number;
  /** Platz für die Beschriftung in Bildpunkten; 0 = sie weicht (nur beim Darüberfahren). */
  labelW: number;
  /** Ein Bündel dicht beieinander liegender Marken – mit ihrer Zahl. */
  cluster: { count: number; from: WorldTime; to: WorldTime } | null;
}

export interface LaneLayout {
  rows: number;
  rails: LaidPiece[];
  items: LaidPiece[];
}

const isBar = (p: TimelinePiece) => p.to !== null && p.to > p.from;
/** Breite einer Beschriftung samt ihrem Polster (4 Bildpunkte je Seite). */
const textPx = (text: string) => Math.ceil(text.length * CHAR_PX) + 8;

/**
 * Legt die Stücke einer Bahn im Bild aus: Leisten und Marken in Reihen, so dass nichts
 * übereinander liegt; Beschriftungen bekommen Platz nach Gewicht – wer leichter ist, weicht.
 * Dicht gedrängte Marken werden zu Bündeln. Nur was im Bild ist (mit etwas Rand), wird ausgelegt.
 */
export function layoutLane(pieces: readonly TimelinePiece[], view: TimelineView): LaneLayout {
  const left = view.from - MARGIN_PX * view.mpp;
  const right = view.from + (view.width + MARGIN_PX) * view.mpp;
  const rails: LaidPiece[] = [];
  const bars: LaidPiece[] = [];
  let marks: LaidPiece[] = [];
  for (const p of pieces) {
    if (p.hi < left || p.lo > right) continue;
    const lo = toX(view, p.lo);
    const hi = toX(view, p.hi);
    const base = { key: p.key, piece: p, lo, hi, row: 0, labelW: 0, cluster: null };
    if (p.kind === 'rail') {
      const x = toX(view, p.from);
      rails.push({ ...base, x, w: Math.max(0, toX(view, p.to ?? p.from) - x) });
    } else if (isBar(p)) {
      const x = toX(view, p.from);
      bars.push({ ...base, x, w: Math.max(3, toX(view, p.to!) - x) });
    } else {
      // Ungefähres steht in der Mitte dessen, was es sein kann – ein Jahr in seiner Mitte.
      const x = p.precision === 'exact' ? toX(view, p.from) : (lo + hi) / 2;
      marks.push({ ...base, x, w: 0 });
    }
  }
  marks = clusterMarks(marks);

  // Schweres zuerst; bei gleichem Gewicht die Leisten vor den Marken, damit Abschnitte wie die
  // Aufenthalte der Gruppe in einer Reihe bleiben.
  const items = [...bars, ...marks].sort(
    (a, b) =>
      b.piece.weight - a.piece.weight ||
      Number(b.w > 0) - Number(a.w > 0) ||
      a.x - b.x ||
      a.key.localeCompare(b.key),
  );
  /** Belegte Stücke je Reihe; `label` = ab hier ist es nur Schrift einer Marke (die weichen kann). */
  type Span = { a: number; b: number; item: LaidPiece; label: number };
  const rows: Span[][] = Array.from({ length: MAX_ROWS }, () => []);
  const free = (row: number, a: number, b: number) =>
    rows[row]!.every((span) => b <= span.a + 0.5 || a >= span.b - 0.5);
  /** Wie viel Platz rechts von `a` in einer Reihe frei ist. */
  const room = (row: number, a: number) =>
    rows[row]!.reduce(
      (limit, span) => (span.b <= a ? limit : span.a <= a ? 0 : Math.min(limit, span.a - a)),
      Number.POSITIVE_INFINITY,
    );
  const take = (row: number, item: LaidPiece, a: number, b: number, label: number) => {
    rows[row]!.push({ a, b, item, label });
    item.row = row;
  };
  /**
   * Kürzt in einer Reihe die Schrift links liegender Marken, damit etwas bei `a`…`b` Platz hat.
   * Geht nur, wenn dort nichts als Schrift im Weg ist. Von mehreren Reihen weicht die, deren
   * Schrift am wenigsten wiegt.
   */
  const yieldLabels = (a: number, b: number): number => {
    let best = -1;
    let bestWeight = Number.POSITIVE_INFINITY;
    rows.forEach((row, r) => {
      const hits = row.filter((span) => !(b <= span.a + 0.5 || a >= span.b - 0.5));
      if (!hits.every((span) => span.label < a - 2)) return;
      const weight = hits.reduce((w, span) => Math.max(w, span.item.piece.weight), 0);
      if (weight < bestWeight) [best, bestWeight] = [r, weight];
    });
    if (best < 0) return -1;
    for (const span of rows[best]!) {
      if (b <= span.a + 0.5 || a >= span.b - 0.5) continue;
      const left = a - 2 - span.label;
      span.item.labelW = left >= MIN_LABEL_PX ? left : 0;
      span.b = span.item.labelW ? span.label + left : span.label - LABEL_GAP;
    }
    return best;
  };

  for (const item of items) {
    const text = item.cluster ? `${item.cluster.count}` : item.piece.text;
    if (item.w > 0) {
      // Eine Leiste: Die Schrift steht in ihr.
      const a = item.x;
      const b = item.x + item.w;
      let row = rows.findIndex((_, r) => free(r, a, b));
      if (row < 0) row = yieldLabels(a, b);
      take(Math.max(0, row), item, a, b, Number.POSITIVE_INFINITY);
      const inside = Math.min(item.w - 12, textPx(text));
      item.labelW = inside >= MIN_LABEL_PX ? inside : 0;
      continue;
    }
    // Eine Marke: Die Schrift steht rechts daneben.
    const a = item.x - MARK_HALF;
    const body = item.x + MARK_HALF;
    const start = body + LABEL_GAP;
    const full = item.cluster ? 0 : textPx(text);
    let placed = false;
    for (let r = 0; r < MAX_ROWS && !placed && full; r++)
      if (free(r, a, start + full)) {
        take(r, item, a, start + full, start);
        item.labelW = full;
        placed = true;
      }
    for (let r = 0; r < MAX_ROWS && !placed; r++) {
      if (!free(r, a, body)) continue;
      const space = Math.min(full, room(r, start) - LABEL_GAP);
      item.labelW = space >= MIN_LABEL_PX ? space : 0;
      take(r, item, a, item.labelW ? start + item.labelW : body, start);
      placed = true;
    }
    // Kein Platz mehr: Die Schrift links davon weicht, sonst liegt die Marke in der ersten Reihe.
    if (!placed) {
      const r = yieldLabels(a, body);
      if (r >= 0) {
        item.labelW = 0;
        take(r, item, a, body, start);
        placed = true;
      }
    }
    if (!placed) {
      item.labelW = 0;
      take(0, item, a, body, start);
    }
  }
  const used = items.reduce((n, item) => Math.max(n, item.row + 1), 1);
  return {
    rows: used,
    rails,
    items: items.sort((a, b) => a.row - b.row || a.x - b.x),
  };
}

/** Bündelt Marken, die dichter als `CLUSTER_PX` liegen, ab drei Stück. */
function clusterMarks(marks: LaidPiece[]): LaidPiece[] {
  const sorted = [...marks].sort((a, b) => a.x - b.x);
  const out: LaidPiece[] = [];
  let run: LaidPiece[] = [];
  const flush = () => {
    if (run.length >= 3) {
      const first = run[0]!;
      const last = run[run.length - 1]!;
      const heaviest = run.reduce((best, m) => (m.piece.weight > best.piece.weight ? m : best));
      out.push({
        ...heaviest,
        key: `cluster:${first.key}`,
        x: (first.x + last.x) / 2,
        lo: Math.min(...run.map((m) => m.lo)),
        hi: Math.max(...run.map((m) => m.hi)),
        cluster: {
          count: run.length,
          from: Math.min(...run.map((m) => m.piece.lo)),
          to: Math.max(...run.map((m) => m.piece.hi)),
        },
      });
    } else out.push(...run);
    run = [];
  };
  for (const mark of sorted) {
    const prev = run[run.length - 1];
    if (prev && mark.x - prev.x >= CLUSTER_PX) flush();
    run.push(mark);
  }
  flush();
  return out;
}

/** Die Abende, die im Bild liegen. */
export const eveningsInView = (bands: readonly Evening[], view: TimelineView): Evening[] => {
  const to = view.from + view.width * view.mpp;
  return bands.filter((band) => band.to >= view.from && band.from <= to);
};
