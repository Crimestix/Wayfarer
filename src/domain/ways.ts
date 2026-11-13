/**
 * Wege: das Netz zwischen Orten (Pointcrawl). Ein Weg verbindet zwei Orte und hat eine Dauer –
 * fest in Minuten (eine Gasse durch die Stadt) oder gerechnet aus seiner Länge. Orte sind die
 * Punkte, Wege die Verbindungen; eine Route führt über mehrere Punkte.
 *
 * Reine Funktionen: welche Wege von einem Ort abgehen, wie lange einer dauert und welche Route
 * zwischen zwei Orten die schnellste ist.
 */
import { placeAncestors } from './derive';
import { signBars, signNote, signsAlong, walkAlong } from './mapDraw';
import { wayCondition, type WayCondition } from './wayState';
import type { CampaignData, GameMap, MapSign, Pace, Place, Terrain, TravelPath } from './schema';

type WayData = Pick<CampaignData, 'entities' | 'paths' | 'maps'>;

/** Tempo zu Fuß nach den Reiseregeln: 2, 3 oder 4 Meilen je Stunde. */
export const WALK_KMH: Record<Pace, number> = { slow: 3.2, normal: 4.8, fast: 6.4 };

/** Schwieriges Gelände: Dort kommt man nur halb so schnell voran. */
const DIFFICULT: ReadonlySet<Terrain> = new Set(['mountains', 'swamp', 'arctic', 'desert']);

/** Länge einer Linie auf einer Karte in Kilometern – null ohne Maßstab. */
export function lineKm(
  map: GameMap | undefined,
  points: readonly (readonly number[])[],
): number | null {
  const scale = map?.scale?.kmPerUnit;
  if (!scale || points.length < 2) return null;
  let units = 0;
  for (let i = 1; i < points.length; i++)
    units += Math.hypot(points[i]![0]! - points[i - 1]![0]!, points[i]![1]! - points[i - 1]![1]!);
  return units * scale;
}

/** Die Länge eines Weges: eingetragen, sonst aus seinem Verlauf auf der Karte. */
export function wayKm(data: WayData, path: TravelPath): number | null {
  if (path.distanceKm !== null) return path.distanceKm;
  return path.mapId ? lineKm(data.maps[path.mapId], path.points) : null;
}

/**
 * Wie lange ein Weg dauert, in Minuten: der feste Aufwand, sonst Länge durch Tempo (in schwierigem
 * Gelände doppelt so lang). Null, wenn weder Dauer noch Länge bekannt ist.
 */
export function wayMinutes(data: WayData, path: TravelPath, pace: Pace = 'normal'): number | null {
  if (path.minutes !== null) return path.minutes;
  // Auf einer gezeichneten Karte: Stück für Stück nach dem Gelände, über das der Weg führt.
  const map = path.mapId ? data.maps[path.mapId] : undefined;
  if (map?.kind === 'drawn' && path.points.length >= 2 && path.distanceKm === null) {
    const walk = walkAlong(map, path.points, path.road === 'road');
    if (walk) return Math.max(1, Math.round(walk.minutes * (WALK_KMH.normal / WALK_KMH[pace])));
  }
  const km = wayKm(data, path);
  if (km === null) return null;
  const hours = (km / WALK_KMH[pace]) * (DIFFICULT.has(path.terrain) ? 2 : 1);
  return Math.max(1, Math.round(hours * 60));
}

/** Ein Weg aus der Sicht dessen, der ihn geht: woher, wohin, wie lange. */
export interface Way {
  path: TravelPath;
  fromId: string;
  toId: string;
  /** Der Weg wird gegen seine eingetragene Richtung gegangen. */
  reverse: boolean;
  /** Dauer in Minuten; null = unbekannt. */
  minutes: number | null;
  /** Türen und Fallen der Karte auf diesem Weg – in der Reihenfolge, in der man sie erreicht. */
  signs: MapSign[];
  /** Eine verschlossene Tür versperrt den Weg – oder das Wetter hat ihn verschluckt. */
  barred: boolean;
  /** Was das Wetter aus dem Weg gemacht hat (`domain/wayState.ts`); null = unbekannt. */
  weather: WayCondition | null;
}

/**
 * Der Zustand eines Weges aus dem Wetter – null, wenn der Stand der Welt dafür nicht reicht
 * (Fachlogik, die nur Orte und Wege kennt).
 */
export function wayWeather(data: WayData, path: TravelPath): WayCondition | null {
  const full = data as Partial<CampaignData>;
  if (!full.state || !full.campaign || !full.climates || !full.weather) return null;
  return wayCondition(data as CampaignData, path);
}

/** Die Türen und Fallen, die auf einer gezeichneten Karte am Verlauf eines Weges sitzen. */
export function waySigns(data: WayData, path: TravelPath, reverse = false): MapSign[] {
  const map = path.mapId ? data.maps[path.mapId] : undefined;
  if (map?.kind !== 'drawn' || !map.signs.length || path.points.length < 2) return [];
  const signs = signsAlong(map, path.points);
  return reverse ? signs.reverse() : signs;
}

/**
 * Was auf einem Weg zu beachten ist, in Worten: verschlossene Türen, Geheimtüren, scharfe Fallen
 * – und was der Spielleiter für unterwegs vorbereitet hat.
 */
export function wayNotes(
  data: WayData,
  way: Pick<Way, 'path' | 'signs'> & Partial<Pick<Way, 'weather'>>,
): string[] {
  const level = (way.path.mapId && data.maps[way.path.mapId]?.level) || 'surface';
  const encounter = way.path.encounterId
    ? (data as Partial<CampaignData>).encounters?.[way.path.encounterId]
    : undefined;
  return [
    ...(way.weather?.text ? [way.weather.text] : []),
    ...way.signs.flatMap((sign) => signNote(sign, level) ?? []),
    ...(way.path.onTheWay.trim() ? [way.path.onTheWay.trim().replace(/[.!?]+$/, '')] : []),
    ...(encounter ? [`Begegnung „${encounter.name}“`] : []),
  ];
}

const isPlace = (data: WayData, id: string): boolean => data.entities[id]?.kind === 'place';

/** Die Wege, die von einem Ort abgehen – der kürzeste zuerst, unbekannte Dauer zuletzt. */
export function waysFrom(data: WayData, placeId: string, pace: Pace = 'normal'): Way[] {
  const ways: Way[] = [];
  for (const path of Object.values(data.paths)) {
    if (path.fromId === path.toId) continue;
    const forward = path.fromId === placeId;
    const back = path.toId === placeId && !path.oneWay;
    if (!forward && !back) continue;
    const toId = forward ? path.toId : path.fromId;
    if (!isPlace(data, toId)) continue;
    const signs = waySigns(data, path, !forward);
    const weather = wayWeather(data, path);
    const dry = wayMinutes(data, path, pace);
    ways.push({
      path,
      fromId: placeId,
      toId,
      reverse: !forward,
      // Das Wetter bremst: Ein verschlammter oder verschneiter Weg dauert doppelt so lang.
      minutes: dry === null ? null : Math.round(dry * (weather?.factor ?? 1)),
      signs,
      barred: signs.some(signBars) || weather?.state === 'lost',
      weather,
    });
  }
  const name = (way: Way) => data.entities[way.toId]?.name ?? '';
  return ways.sort(
    (a, b) =>
      (a.minutes ?? Infinity) - (b.minutes ?? Infinity) ||
      name(a).localeCompare(name(b), 'de') ||
      a.path.id.localeCompare(b.path.id),
  );
}

export interface WaysAround {
  /** Der Ort, von dem die Wege abgehen: der Ort selbst oder der nächste darüber, der welche hat. */
  origin: Place;
  ways: Way[];
  /**
   * Die Wege des nächsten Ortes darüber, der eigene hat – wer am Markt steht, kann auch die Stadt
   * verlassen. Ohne die Ziele, die schon unter `ways` stehen oder die Gruppe umschließen.
   */
  above: { origin: Place; ways: Way[] } | null;
}

/**
 * Die Wege rund um einen Ort: seine eigenen – oder, wenn von ihm keiner abgeht, die des nächsten
 * Ortes darüber (wer im Gasthaus sitzt, bricht vom Viertel aus auf). Dazu die Wege, die aus dem
 * Ort darüber hinausführen (`above`).
 */
export function waysAround(
  data: WayData,
  placeId: string | null,
  pace: Pace = 'normal',
): WaysAround | null {
  const start = placeId ? data.entities[placeId] : undefined;
  if (start?.kind !== 'place') return null;
  const chain = [start, ...placeAncestors(data as CampaignData, start.id)];
  const inside = new Set(chain.map((place) => place.id));
  let found: WaysAround | null = null;
  for (const place of chain) {
    const ways = waysFrom(data, place.id, pace);
    if (!ways.length) continue;
    if (!found) {
      found = { origin: place, ways, above: null };
      continue;
    }
    const known = new Set(found.ways.map((way) => way.toId));
    const beyond = ways.filter((way) => !known.has(way.toId) && !inside.has(way.toId));
    if (beyond.length) found.above = { origin: place, ways: beyond };
    break;
  }
  return found;
}

/** Eine Route durchs Wegenetz: Abschnitt für Abschnitt von Punkt zu Punkt. */
export interface Route {
  legs: Way[];
  /** Summe der bekannten Dauern in Minuten. */
  minutes: number;
  /** Mindestens ein Abschnitt hat keine bekannte Dauer – die Summe ist dann zu klein. */
  unknown: boolean;
  /** Die Orte, über die es geht (ohne Start und Ziel). */
  via: string[];
  /** Ein Abschnitt ist versperrt (verschlossene Tür) – und kein anderer Weg führt hin. */
  barred: boolean;
  /**
   * Das gefragte Ziel. Der letzte Abschnitt kann bei dem Ort darüber enden (die Stadt, in der das
   * Viertel liegt) – angekommen ist die Gruppe trotzdem hier.
   */
  toId: string;
}

/** So viel zählt ein Abschnitt unbekannter Dauer bei der Suche: wie eine halbe Stunde. */
const UNKNOWN_WEIGHT = 30;
/** Ein versperrter Abschnitt zählt so viel, dass jeder freie Weg vorgeht – wie hundert Jahre. */
const BARRED_WEIGHT = 52_560_000;

/**
 * Dijkstra von einem Ort aus: über welchen Weg jeder erreichte Ort am schnellsten erreicht wird.
 * Hört auf, sobald `toId` feststeht; sonst ist danach alles Erreichbare bekannt.
 */
function reach(data: WayData, fromId: string, toId: string, pace: Pace): Map<string, Way> {
  const best = new Map<string, number>([[fromId, 0]]);
  const came = new Map<string, Way>();
  const open = new Set<string>([fromId]);
  const done = new Set<string>();
  while (open.size) {
    let current: string | null = null;
    for (const id of open)
      if (
        current === null ||
        best.get(id)! < best.get(current)! ||
        (best.get(id) === best.get(current) && id < current)
      )
        current = id;
    if (current === null || current === toId) break;
    open.delete(current);
    done.add(current);
    for (const way of waysFrom(data, current, pace)) {
      if (done.has(way.toId)) continue;
      const cost =
        best.get(current)! + (way.minutes ?? UNKNOWN_WEIGHT) + (way.barred ? BARRED_WEIGHT : 0);
      if (cost < (best.get(way.toId) ?? Infinity)) {
        best.set(way.toId, cost);
        came.set(way.toId, way);
        open.add(way.toId);
      }
    }
  }
  return came;
}

/**
 * Die schnellste Route zwischen zwei Orten über die bekannten Wege (Dijkstra) – null, wenn es
 * keine Verbindung gibt. Geheime Wege zählen mit: Der Spielleiter kennt sie. Ein Weg mit einer
 * verschlossenen Tür – oder einer, den das Wetter verschluckt hat – wird nur genommen, wenn kein
 * anderer hinführt; die Route ist dann `barred`. Was das Wetter bremst, zählt mit seiner
 * längeren Dauer.
 *
 * Wer in einem Viertel steht, steht auch in der Stadt: Führt vom Ort selbst kein Weg zum Ziel,
 * zählen die Wege der Orte darüber – und am Ziel genügt es, den Ort zu erreichen, in dem es
 * liegt. Was Start und Ziel gemeinsam umschließt (dieselbe Stadt, dieselbe Gegend), ist dabei
 * kein Punkt auf dem Weg. Ein eingetragener Weg geht immer vor.
 */
export function routeBetween(
  data: WayData,
  fromId: string,
  toId: string,
  pace: Pace = 'normal',
): Route | null {
  if (fromId === toId || !isPlace(data, fromId) || !isPlace(data, toId)) return null;
  const up = (id: string) => [
    id,
    ...placeAncestors(data as CampaignData, id).map((place) => place.id),
  ];
  const [starts, ends] = [up(fromId), up(toId)];
  const shared = new Set(starts.filter((id) => ends.includes(id)));
  const linked = new Set(Object.values(data.paths).flatMap((path) => [path.fromId, path.toId]));
  for (const start of starts) {
    if (start !== fromId && (shared.has(start) || !linked.has(start))) continue;
    const came = reach(data, start, toId, pace);
    for (const end of ends) {
      if (end !== toId && shared.has(end)) continue;
      if (!came.has(end)) continue;
      const legs: Way[] = [];
      for (let at = end; at !== start; at = came.get(at)!.fromId) legs.unshift(came.get(at)!);
      return {
        legs,
        minutes: legs.reduce((sum, leg) => sum + (leg.minutes ?? 0), 0),
        unknown: legs.some((leg) => leg.minutes === null),
        via: legs.slice(0, -1).map((leg) => leg.toId),
        barred: legs.some((leg) => leg.barred),
        toId,
      };
    }
  }
  return null;
}

/** Was auf einer Route zu beachten ist – Abschnitt für Abschnitt, in Worten. */
export function routeNotes(data: WayData, route: Route): string[] {
  return route.legs.flatMap((leg) => wayNotes(data, leg));
}

/**
 * Warum eine Route einen Umweg nimmt: Der direkte Weg ist versperrt. In Worten – null, wenn es
 * keinen versperrten direkten Weg gibt oder die Route ihn trotzdem geht.
 */
export function routeDetour(data: WayData, route: Route): string | null {
  const [first, last] = [route.legs[0], route.legs[route.legs.length - 1]];
  if (!first || !last) return null;
  const direct = waysFrom(data, first.fromId).find(
    (way) =>
      way.toId === last.toId &&
      way.barred &&
      !route.legs.some((leg) => leg.path.id === way.path.id),
  );
  if (!direct) return null;
  const why = wayNotes(data, {
    path: direct.path,
    signs: direct.signs.filter(signBars),
    weather: direct.weather?.state === 'lost' ? direct.weather : null,
  });
  return `Der direkte Weg ist versperrt: ${why.join('; ')}`;
}

/** Der direkte Weg zwischen zwei Orten, falls es einen gibt – der schnellste. */
export function directWay(data: WayData, fromId: string, toId: string): Way | null {
  return waysFrom(data, fromId).find((way) => way.toId === toId) ?? null;
}

/** „25 Min.“, „1 Std.“, „2 Std. 15 Min.“, „3 Tage 4 Std.“ */
export function formatWayTime(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const rest = total % 60;
  const parts: string[] = [];
  if (days) parts.push(days === 1 ? '1 Tag' : `${days} Tage`);
  if (hours) parts.push(`${hours} Std.`);
  if (rest && !days) parts.push(`${rest} Min.`);
  return parts.length ? parts.join(' ') : '0 Min.';
}

/** „über Marktplatz und Alte Brücke“ – leer bei einem direkten Weg. */
export function describeVia(data: Pick<CampaignData, 'entities'>, route: Route): string {
  const names = route.via.map((id) => data.entities[id]?.name ?? '?');
  if (!names.length) return '';
  return `über ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`}`;
}

/** Die Linie eines Weges auf einer Karte: sein Verlauf, sonst die Gerade zwischen den Punkten seiner Orte. */
export function wayLine(map: GameMap, path: TravelPath): [number, number][] | null {
  if (path.mapId === map.id && path.points.length >= 2)
    return path.points.map((p) => [p[0], p[1]] as [number, number]);
  const a = map.markers.find((m) => m.entityId === path.fromId);
  const b = map.markers.find((m) => m.entityId === path.toId);
  return a && b
    ? [
        [a.x, a.y],
        [b.x, b.y],
      ]
    : null;
}

/**
 * Vorschlag für die Länge eines neuen Weges: die Luftlinie zwischen den Punkten zweier Orte auf
 * einer Karte mit Maßstab – null, wenn keine Karte beide zeigt.
 */
export function suggestedKm(data: WayData, fromId: string, toId: string): number | null {
  for (const map of Object.values(data.maps)) {
    const a = map.markers.find((m) => m.entityId === fromId);
    const b = map.markers.find((m) => m.entityId === toId);
    if (!a || !b) continue;
    const km = lineKm(map, [
      [a.x, a.y],
      [b.x, b.y],
    ]);
    if (km !== null) return km;
  }
  return null;
}
