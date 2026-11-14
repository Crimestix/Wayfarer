/**
 * Wegenetze: eine vorbereitete Strecke oder Gegend aus Punkten und den Wegen dazwischen – der Weg
 * von der Bucht bis in die Stadt in der Tiefe, mit allen Abzweigungen. Die Punkte sind Orte der
 * Welt, die Wege liegen in `paths`: Zum Netz gehört jeder Weg, dessen beide Orte Punkte des
 * Netzes sind. Ein Netz merkt sich nur, welche Orte dazugehören und wo sie auf dem Blatt liegen.
 *
 * Reine Funktionen: das Netz zum Anzeigen, was an einem Punkt hängt, und das Lesen einer Strecke,
 * die als Text geschrieben ist („Bucht -> Alter Anleger (4 Std.) -> Kriegslager“).
 */
import { placeAncestors } from './derive';
import type {
  CampaignData,
  Clock,
  Encounter,
  Net,
  NetPoint,
  Place,
  Stock,
  Story,
  Thread,
  TravelPath,
} from './schema';
import { storyNodes } from './story';
import { waysFrom, type Way } from './ways';

/** Ein Punkt des Netzes, fertig zum Zeichnen. */
export interface NetPointView {
  place: Place;
  x: number;
  y: number;
  /** Die Gruppe steht hier – oder in einem Ort, der in diesem liegt. */
  here: boolean;
  /** Wie viel an diesem Punkt hängt: Geschichten, Fäden, Uhren, Bestände, Begegnungen. */
  hanging: number;
  /** Am Punkt ist etwas vorbereitet: Notizen, Spielleiterwissen oder etwas, das dort hängt. */
  prepared: boolean;
}

/** Ein Weg des Netzes, fertig zum Zeichnen. */
export interface NetLinkView {
  path: TravelPath;
  from: NetPointView;
  to: NetPointView;
  /** Dauer in Minuten, wie sie heute gilt (das Wetter bremst); null = offen. */
  minutes: number | null;
  /** Eine verschlossene Tür oder das Wetter versperrt ihn. */
  barred: boolean;
  /** Auf dem Weg wartet etwas: Besonderheiten, ein Eintrag „unterwegs“ oder eine Begegnung. */
  eventful: boolean;
}

export interface NetView {
  net: Net;
  points: NetPointView[];
  links: NetLinkView[];
}

/** Was an einem Ort hängt – für den Punkt im Netz und sein Seitenteil. */
export interface Hanging {
  stories: Story[];
  threads: Thread[];
  clocks: Clock[];
  stocks: Stock[];
  encounters: Encounter[];
}

export function hangingAt(data: CampaignData, placeId: string): Hanging {
  // Eine Geschichte hängt an jedem Ort, an dem etwas von ihr liegt: ein Beteiligter, ein
  // Einstieg, eine Szene, ein Hinweis.
  const stories = Object.values(data.stories).filter(
    (story) => !story.closed && storyNodes(data, story).includes(placeId),
  );
  const inStory = new Set(stories.map((story) => story.id));
  return {
    stories,
    threads: Object.values(data.threads).filter(
      (thread) =>
        (thread.state === 'open' || thread.state === 'active') &&
        !(thread.storyId && inStory.has(thread.storyId)) &&
        (thread.refs.includes(placeId) || thread.hints.some((hint) => hint.placeId === placeId)),
    ),
    clocks: Object.values(data.clocks).filter((clock) => clock.placeId === placeId),
    stocks: Object.values(data.stocks).filter((stock) => stock.placeId === placeId),
    encounters: Object.values(data.encounters).filter((encounter) => encounter.placeId === placeId),
  };
}

const count = (hanging: Hanging) =>
  hanging.stories.length +
  hanging.threads.length +
  hanging.clocks.length +
  hanging.stocks.length +
  hanging.encounters.length;

/** Das Netz zum Anzeigen: seine Punkte (ohne gelöschte Orte) und die Wege dazwischen. */
export function netView(data: CampaignData, net: Net): NetView {
  const party = data.state.placeId;
  const around = party
    ? new Set([party, ...placeAncestors(data, party).map((place) => place.id)])
    : new Set<string>();
  const points: NetPointView[] = [];
  for (const point of net.points) {
    const place = data.entities[point.placeId];
    if (place?.kind !== 'place') continue;
    const hanging = count(hangingAt(data, place.id));
    points.push({
      place,
      x: point.x,
      y: point.y,
      here: around.has(place.id),
      hanging,
      prepared: hanging > 0 || place.notes.trim() !== '' || place.secret.trim() !== '',
    });
  }
  // Steht die Gruppe in einem Viertel und sind Viertel und Stadt beide Punkte, gilt das Viertel.
  const exact = points.find((point) => point.place.id === party);
  if (exact) for (const point of points) point.here = point === exact;
  const byId = new Map(points.map((point) => [point.place.id, point]));
  const links: NetLinkView[] = [];
  for (const point of points) {
    for (const way of waysFrom(data, point.place.id)) {
      // Jeder Weg einmal: in seiner eingetragenen Richtung.
      if (way.reverse) continue;
      const to = byId.get(way.path.toId);
      if (to) links.push(linkOf(way, point, to));
    }
  }
  links.sort((a, b) => a.path.id.localeCompare(b.path.id));
  return { net, points, links };
}

const linkOf = (way: Way, from: NetPointView, to: NetPointView): NetLinkView => ({
  path: way.path,
  from,
  to,
  minutes: way.minutes,
  barred: way.barred,
  eventful:
    way.path.conditions.trim() !== '' ||
    way.path.onTheWay.trim() !== '' ||
    way.path.encounterId !== null,
});

/** Die Netze, zu denen ein Ort gehört – er selbst oder ein Ort, in dem er liegt. */
export function netsOfPlace(data: CampaignData, placeId: string | null): Net[] {
  if (!placeId) return [];
  const ids = new Set([placeId, ...placeAncestors(data, placeId).map((place) => place.id)]);
  return Object.values(data.nets)
    .filter((net) => net.points.some((point) => ids.has(point.placeId)))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Die Wegenetze, die für eine Geschichte vorbereitet sind. */
export function netsOfStory(data: Pick<CampaignData, 'nets'>, storyId: string): Net[] {
  return Object.values(data.nets)
    .filter((net) => net.storyId === storyId)
    .sort((a, b) => a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id));
}

// ── Strecke als Text ───────────────────────────────────────────────────────

const UNITS: [RegExp, number][] = [
  [/^(?:wochen?|w)$/, 7 * 24 * 60],
  [/^(?:tage?n?|t|d)$/, 24 * 60],
  [/^(?:stunden?|std|h)$/, 60],
  [/^(?:minuten?|min|m)$/, 1],
];

/**
 * Liest eine Dauer, wie man sie schreibt: „2 Tage“, „4 Std.“, „1 Tag 6 Std“, „1,5 Stunden“,
 * „90“ (Minuten). Null, wenn der Text keine Dauer ist.
 */
export function parseDurationText(text: string): number | null {
  const clean = text.trim().toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (/^\d+$/.test(clean)) return Number(clean);
  const parts = clean.match(/\d+(?:,\d+)?\s*[a-zäöü]+/g);
  if (!parts || parts.join(' ').replace(/\s+/g, '') !== clean.replace(/\s+/g, '')) return null;
  let minutes = 0;
  for (const part of parts) {
    const [, amount, unit] = /^(\d+(?:,\d+)?)\s*([a-zäöü]+)$/.exec(part) ?? [];
    const factor = UNITS.find(([pattern]) => pattern.test(unit ?? ''))?.[1];
    if (!amount || factor === undefined) return null;
    minutes += Number(amount.replace(',', '.')) * factor;
  }
  return Math.round(minutes);
}

export interface RouteStep {
  /** Der Name des Punktes, wie er geschrieben wurde. */
  name: string;
  /** Wie lange der Weg zu diesem Punkt dauert – null, wenn nichts dabeisteht. */
  minutes: number | null;
}

const ARROW = /\s*(?:-+>|=+>|–>|—>|→|⟶|>)\s*/;

/**
 * Liest Strecken, die als Text geschrieben sind: je Zeile eine Kette von Punkten, getrennt durch
 * Pfeile („->“ oder „→“). Hinter einem Punkt kann in Klammern stehen, wie lange der Weg dorthin
 * dauert: „Bucht -> Alter Anleger (4 Std.) -> Kriegslager (2 Tage)“. Eine Abzweigung ist einfach
 * eine weitere Zeile, die bei einem schon genannten Punkt beginnt.
 */
export function parseRoutes(text: string): RouteStep[][] {
  const chains: RouteStep[][] = [];
  for (const line of text.split(/\r?\n/)) {
    const steps: RouteStep[] = [];
    for (const raw of line.split(ARROW)) {
      const part = raw.replace(/\s+/g, ' ').trim();
      if (!part) continue;
      const bracket = /^(.*\S)\s*\(([^()]*)\)$/.exec(part);
      const minutes = bracket ? parseDurationText(bracket[2]!) : null;
      steps.push(
        bracket && minutes !== null
          ? { name: bracket[1]!, minutes }
          : { name: part, minutes: null },
      );
    }
    if (steps.length) chains.push(steps);
  }
  return chains;
}

export interface PlannedStep extends RouteStep {
  /** Der Ort, der gemeint ist – null, wenn er neu entsteht. */
  place: Place | null;
}

const nameKey = (name: string) =>
  name.normalize('NFC').replace(/s+/g, ' ').trim().toLocaleLowerCase('de');

/**
 * Der Ort, den ein Name in diesem Netz meint: ein Punkt des Netzes, sonst der eine Ort der Welt,
 * der so heißt. Heißen mehrere so und ist keiner davon im Netz, rät Wayfarer nicht.
 */
export function placeNamed(data: CampaignData, net: Net, name: string): Place | null {
  const key = nameKey(name);
  if (!key) return null;
  const matches = Object.values(data.entities).filter(
    (entity): entity is Place =>
      entity.kind === 'place' &&
      (nameKey(entity.name) === key || entity.aliases.some((alias) => nameKey(alias) === key)),
  );
  const inNet = matches.filter((place) => net.points.some((point) => point.placeId === place.id));
  if (inNet.length) return inNet[0]!;
  return matches.length === 1 ? matches[0]! : null;
}

/** Was aus einer geschriebenen Strecke würde: je Punkt, ob es den Ort schon gibt. */
export function planRoutes(data: CampaignData, net: Net, text: string): PlannedStep[][] {
  return parseRoutes(text).map((chain) =>
    chain.map((step) => ({ ...step, place: placeNamed(data, net, step.name) })),
  );
}

// ── Platz auf dem Blatt ────────────────────────────────────────────────────

/** Abstand zweier Punkte einer Kette auf dem Blatt. */
export const NET_STEP = 210;
/** Abstand zweier Zeilen auf dem Blatt. */
export const NET_ROW = 130;

const taken = (points: readonly NetPoint[], x: number, y: number) =>
  points.some((point) => Math.abs(point.x - x) < NET_STEP * 0.6 && Math.abs(point.y - y) < 60);

/**
 * Ein freier Platz für einen neuen Punkt: rechts neben `after` (dem Punkt, von dem man kommt),
 * sonst am Anfang einer neuen Zeile unter allem. Ist der Platz belegt, rückt er eine Zeile tiefer.
 */
export function freeSpot(
  points: readonly NetPoint[],
  after?: Pick<NetPoint, 'x' | 'y'> | null,
): { x: number; y: number } {
  let x = 0;
  let y = points.length ? Math.max(...points.map((point) => point.y)) + NET_ROW : 0;
  if (after) {
    x = after.x + NET_STEP;
    y = after.y;
  }
  while (taken(points, x, y)) y += NET_ROW;
  return { x, y };
}
