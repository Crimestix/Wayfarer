/**
 * Unterwegs (Station 2 auf dem Weg zu Version 1.0, Entscheidungen des Spielleiters vom 17. 11.):
 * Eine Reise ist ein Zustand des Spieltischs. Sie besteht aus Abschnitten – Wegen der Welt oder
 * freien Strecken –, deren Dauer und Gelände beim Aufbruch feststehen. Gegangen wird „bis zur
 * nächsten Entscheidung“: Wayfarer rechnet voran und hält von selbst, sobald der Spielleiter etwas
 * entscheiden muss (ein Ort am Weg, Vorbereitetes, eine Begegnung aus seiner Tabelle, ein Termin
 * oder Schritt einer Uhr, ein Licht, das erlischt, acht Stunden seit der Rast).
 *
 * Gelände bringt Wayfarer nicht mit: Es steht an den Gegenden der Welt (`place.ground`,
 * `place.groundSlow`) und gilt für alles darunter. Begegnungen und Entdeckungen würfelt Wayfarer
 * alle vier Reisestunden und einmal nachts auf den Tabellen der Gegend – nur als Vorschlag.
 * Vorräte sind eine Leiste in Tagen, nur ein Hinweis. Reine Funktionen; geschrieben wird über
 * `features/reise/actions.ts`.
 */
import { parseEvents } from './bastion';
import { dueSteps } from './clock';
import { occurrencesBetween, placeAncestors } from './derive';
import { distanceKm } from './geo';
import { TRAVEL_HOURS, marchedMinutes } from './march';
import { partyTravel } from './mounts';
import { newSightings, sightingLine } from './afar';
import { sameHex } from './hex';
import { DIR_DOWN, dirTo, exitsOf, isJunction } from './passages';
import { placeGeo, planetOf } from './planet';
import type {
  Area,
  CampaignData,
  Hex,
  HaltKind,
  Journey,
  JourneyLeg,
  PassageKind,
  Pace,
  RollTable,
  TableKind,
  Terrain,
  Yield,
} from './schema';
import { DAY_KM } from './terrain';
import { MINUTES_PER_DAY, dayIndexOf, type WorldTime } from './time/calendar';
import { routeBetween } from './ways';
import { isUnderground } from './underground';
import { isNightAt, meetingLine, meetingOf, pickRow, type Meeting } from './roaming';
import { isEveryday } from './weight';
import { EXTREME_COLD, EXTREME_HEAT } from './weather';
import { weatherAt } from './weatherZone';
import { coldText, hazardLine, heatText, hungerText, marchText, thirstText } from './travelRules';

/** Alle so viele Reiseminuten prüft Wayfarer auf Begegnungen (Entscheidung 17. 11.: vier Stunden). */
export const CHECK_EVERY = 4 * 60;
/** So weit rechnet „Bis zur nächsten Entscheidung“ höchstens voraus: ein Tag. */
export const HALT_HORIZON = MINUTES_PER_DAY;

export const HALT_LABEL: Record<HaltKind, string> = {
  place: 'Ort am Weg',
  feature: 'Besonderheit unterwegs',
  river: 'Ein Fluss',
  passage: 'Ein schwieriger Durchgang',
  sighted: 'In Sicht',
  search: 'Beim Durchsuchen',
  navigate: 'Orientierung',
  prepared: 'Am Weg vorbereitet',
  encounter: 'Begegnung',
  discovery: 'Entdeckung',
  event: 'Termin',
  clock: 'Eine Uhr rückt vor',
  light: 'Ein Licht erlischt',
  rest: 'Acht Stunden seit der Rast',
  hour: 'Eine Stunde gereist',
  arrived: 'Angekommen',
  march: 'Gewaltmarsch',
  cold: 'Extreme Kälte',
  heat: 'Extreme Hitze',
  hunger: 'Hunger',
  thirst: 'Durst',
  dark: 'Es wird dunkel',
  hazard: 'Gefahr am Weg',
};

// ── Gelände aus der Welt ───────────────────────────────────────────────────

/** Das Gelände einer Gegend: wo es steht, wie es heißt, ob es langsam macht. */
export interface Ground {
  regionId: string;
  word: string;
  slow: boolean;
}

/**
 * Das Gelände an einem Ort: das eigene oder das des nächsten Ortes darüber, der eines hat. null,
 * wenn nirgends eines eingetragen ist.
 */
export function groundOf(data: CampaignData, placeId: string | null): Ground | null {
  if (!placeId) return null;
  const self = data.entities[placeId];
  const chain = [...(self?.kind === 'place' ? [self] : []), ...placeAncestors(data, placeId)];
  for (const place of chain)
    if (place.place.ground.trim() || place.place.groundSlow)
      return { regionId: place.id, word: place.place.ground.trim(), slow: place.place.groundSlow };
  return null;
}

/**
 * Was eine Gegend für die Nahrungssuche hergibt und ob es Trinkwasser gibt: an der Landschaft des
 * Feldes, sonst am Ort und den Orten darüber – der nächste, der etwas sagt.
 */
export function bountyOf(
  data: CampaignData,
  placeId: string | null,
  landscapeId: string | null = null,
): { yield: Yield | null; water: boolean | null } {
  let found: Yield | null = null;
  let water: boolean | null = null;
  const land = landscapeId ? data.entities[landscapeId] : undefined;
  if (land?.kind === 'landscape') {
    found = land.landscape.yield;
    water = land.landscape.water;
  }
  if (placeId) {
    const self = data.entities[placeId];
    const chain = [...(self?.kind === 'place' ? [self] : []), ...placeAncestors(data, placeId)];
    for (const place of chain) {
      if (found === null && place.place.yield) found = place.place.yield;
      if (water === null && place.place.water !== null) water = place.place.water;
    }
  }
  return { yield: found, water };
}

/** Die Gegend, deren Tabellen an einem Ort gelten: der Ort und die Orte darüber, der nächste zuerst. */
export function tablesAt(data: CampaignData, placeId: string | null, kind: TableKind): RollTable[] {
  if (!placeId) return [];
  const self = data.entities[placeId];
  const chain = [...(self?.kind === 'place' ? [self] : []), ...placeAncestors(data, placeId)];
  for (const place of chain) {
    const own = Object.values(data.tables).filter(
      (table) => table.placeId === place.id && table.kind === kind && table.entries.length > 0,
    );
    if (own.length) return own.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }
  return [];
}

// ── Planen ─────────────────────────────────────────────────────────────────

/** Minuten je km zu Fuß: die Tagesstrecke des Tempos auf acht Stunden (Regelwerk). */
const minutesPerKm = (pace: Pace = 'normal') => (TRAVEL_HOURS * 60) / DAY_KM[pace];

/** Die Luftlinie zwischen zwei Orten in km – null, wenn einer keine Lage hat. */
export function straightKm(data: CampaignData, fromId: string, toId: string): number | null {
  const planet = planetOf(data);
  const a = placeGeo(data, fromId);
  const b = placeGeo(data, toId);
  if (!a || !b) return null;
  return distanceKm(planet?.radiusKm ?? 6371, a.geo, b.geo);
}

/** Ein geplanter Abschnitt, bevor er Teil einer Reise ist. */
export type LegPlan = Omit<JourneyLeg, 'id'>;

export interface JourneyPlan {
  legs: LegPlan[];
  /** Summe der Dauern. */
  minutes: number;
  /** Ein Abschnitt hat keine bekannte Dauer – sie muss beim Aufbruch eingetragen werden. */
  unknown: boolean;
  /** Es gibt keinen Weg; die Strecke ist frei nach der Luftlinie geschätzt. */
  free: boolean;
}

/** Ein Abschnitt mit dem Gelände seiner Gegend – das Ziel zählt vor dem Start. */
function legOf(
  data: CampaignData,
  fromId: string,
  toId: string,
  base: number | null,
  fixed: boolean,
  extra: Partial<LegPlan>,
): LegPlan {
  const ground = groundOf(data, toId) ?? groundOf(data, fromId);
  const slow = !!ground?.slow;
  const minutes = base === null ? 0 : Math.round(base * (slow && !fixed ? 2 : 1));
  return {
    pathId: null,
    reverse: false,
    fromId,
    toId,
    minutes,
    distanceKm: null,
    ground: ground?.word ?? '',
    slow,
    regionId: ground?.regionId ?? null,
    areaId: null,
    hexes: [],
    mapId: null,
    points: [],
    terrain: null,
    ...extra,
  };
}

/**
 * Plant eine Reise: über die Wege der Welt (`routeBetween`), sonst als freie Strecke nach der
 * Luftlinie. Schwieriges Gelände verdoppelt jede Dauer, die nicht fest am Weg steht.
 */
export function planJourney(
  data: CampaignData,
  fromId: string,
  toId: string,
  pace: Pace = 'normal',
): JourneyPlan | null {
  if (!fromId || !toId || fromId === toId) return null;
  const route = routeBetween(data, fromId, toId, partyTravel(data));
  if (route && !route.barred) {
    const legs = route.legs.map((way) =>
      legOf(
        data,
        way.fromId,
        way.toId,
        // Eine feste Dauer gilt immer; sonst bestimmt das Tempo die Tagesstrecke.
        way.path.minutes !== null || way.minutes === null
          ? way.minutes
          : way.minutes * (DAY_KM.normal / DAY_KM[pace]),
        way.path.minutes !== null,
        {
          pathId: way.path.id,
          reverse: way.reverse,
          distanceKm: way.path.distanceKm ?? null,
        },
      ),
    );
    return {
      legs,
      minutes: legs.reduce((sum, leg) => sum + leg.minutes, 0),
      unknown: route.unknown || legs.some((leg) => leg.minutes === 0),
      free: false,
    };
  }
  const km = straightKm(data, fromId, toId);
  const leg = legOf(data, fromId, toId, km === null ? null : km * minutesPerKm(pace), false, {
    distanceKm: km === null ? null : Math.round(km),
  });
  return { legs: [leg], minutes: leg.minutes, unknown: km === null, free: true };
}

// ── Stand ──────────────────────────────────────────────────────────────────

export interface JourneyView {
  journey: Journey;
  leg: JourneyLeg | null;
  /** Gesamtdauer und schon gereist, in Minuten. */
  total: number;
  done: number;
  /** Tag der Reise: am Tag des Aufbruchs 1. */
  day: number;
  /** Die Orte der Reise in Reihenfolge: Start, Orte am Weg, Ziel – mit „schon erreicht“. */
  stops: { placeId: string; reached: boolean; current: boolean }[];
  /** Gereist seit der letzten Langen Rast (Gewaltmarsch ab acht Stunden). */
  sinceRest: number;
  /** Das Gelände, durch das die Reise gerade geht: gemalt auf das Feld, sonst das des Abschnitts. */
  ground: { word: string; slow: boolean } | null;
  /** Vorräte, die noch reichen, in Tagen – null, wenn nicht gezählt. */
  food: number | null;
  water: number | null;
}

/** Die laufende Reise der geleiteten Gruppe – null, wenn niemand unterwegs ist. */
export function journeyUnderway(data: Pick<CampaignData, 'journeys'>): Journey | null {
  return (
    Object.values(data.journeys)
      .filter((journey) => journey.status === 'underway')
      .sort((a, b) => b.updated.localeCompare(a.updated))[0] ?? null
  );
}

/** Wie viele Kalendertage seit dem Aufbruch vergangen sind (der Tag des Aufbruchs zählt als 0). */
const daysSince = (from: WorldTime | null, now: WorldTime) =>
  from === null ? 0 : Math.max(0, dayIndexOf(now) - dayIndexOf(from));

export function journeyView(data: CampaignData, journey: Journey): JourneyView {
  const legs = journey.legs;
  const index = Math.min(journey.progress.leg, Math.max(0, legs.length - 1));
  const total = legs.reduce((sum, leg) => sum + leg.minutes, 0);
  const done =
    legs.slice(0, journey.progress.leg).reduce((sum, leg) => sum + leg.minutes, 0) +
    (journey.progress.leg < legs.length ? journey.progress.minutes : 0);
  const places = [journey.startId ?? legs[0]?.fromId ?? null, ...legs.map((leg) => leg.toId)];
  const stops = places.flatMap((placeId, i) =>
    placeId
      ? [
          {
            placeId,
            reached: i <= journey.progress.leg,
            current: i === journey.progress.leg && journey.progress.minutes === 0,
          },
        ]
      : [],
  );
  const days = daysSince(journey.departAt, data.state.now);
  const left = (start: number | null) => (start === null ? null : Math.max(0, start - days));
  const current = legs[index];
  const area = current?.areaId ? data.areas[current.areaId] : undefined;
  const passed = current?.hexes.filter((step) => step.at <= journey.progress.minutes) ?? [];
  const step = passed[passed.length - 1];
  const hex = area && step ? area.hexes.find((h) => sameHex(h, step)) : undefined;
  const painted = hex?.regionId ? groundOf(data, hex.regionId) : null;
  const ground = painted
    ? { word: painted.word, slow: painted.slow && hex?.road === 'none' }
    : current && (current.ground || current.slow)
      ? { word: current.ground, slow: current.slow }
      : null;
  return {
    journey,
    ground,
    leg: legs[index] ?? null,
    total,
    done,
    day: days + 1,
    stops,
    sinceRest: marchedMinutes(data, data.state.now),
    food: left(journey.supplies.food),
    water: left(journey.supplies.water),
  };
}

// ── Bis zur nächsten Entscheidung ──────────────────────────────────────────

/** Ein Würfel: gibt 1 bis `sides` zurück (am Tisch echter Zufall, im Test fest). */
export type Roll = (sides: number) => number;

/** Was beim Würfeln auf eine Tabelle herauskam. */
export interface TableResult {
  table: RollTable;
  /** Die Prüfung (W20 gegen den Wert der Tabelle) – null, wenn die Tabelle immer würfelt. */
  check: number | null;
  /** Die gewählte Zeile – null, wenn die Prüfung nichts ergab. */
  roll: number | null;
  /** Die Zeile mit allem, was das Bestiarium dazu weiß, als ein Satz. */
  text: string;
  /** Die Zeile mit Anzahl, Spuren und Bau (`domain/roaming.ts`). */
  meeting: Meeting;
  /** Was gewürfelt wurde, in Worten. */
  rolled: string;
  /** Das Wesen des Bestiariums, wenn die Zeile eines nennt – daraus wird eine Begegnung. */
  creatureId: string | null;
}

/**
 * Würfelt auf den Tabellen der Gegend (`tablesAt`): erst die Prüfung, dann eine Zeile nach
 * Häufigkeit – tags und nachts nur, was dann unterwegs ist (`at` = Weltzeit, 'night' = im Lager);
 * unter der Erde zählt die Tageszeit nicht. Anzahl, Spuren und Bau kommen aus dem Bestiarium.
 */
export function rollTables(
  data: CampaignData,
  placeId: string | null,
  kind: TableKind,
  roll: Roll,
  at: number | 'night' = data.state.now,
): TableResult | null {
  const night = isUnderground(data, placeId) ? null : at === 'night' ? true : isNightAt(at);
  for (const table of tablesAt(data, placeId, kind)) {
    const check = table.dc === null ? null : roll(20);
    if (check !== null && check < table.dc!) continue;
    const picked = pickRow(data, table, roll, night);
    if (!picked) continue;
    const meeting = meetingOf(data, picked.row, placeId, roll);
    const rolled = [
      check !== null ? `Prüfung W20 = ${check} (ab ${table.dc})` : '',
      `gewählt aus ${picked.from === 1 ? 'einer Zeile' : `${picked.from} Zeilen`}`,
      night === null ? '' : night ? 'nachts' : 'tags',
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      table,
      check,
      roll: picked.row.min,
      text: meetingLine(meeting),
      meeting,
      rolled,
      creatureId: picked.row.creatureId ?? null,
    };
  }
  return null;
}

/** Wo die Reise anhält und wie lange bis dahin gereist wird. */
export interface Halt {
  kind: HaltKind;
  /** Reiseminuten bis zum Halt. */
  minutes: number;
  text: string;
  roll: string;
  /** Die Prüfungen unterwegs, die nichts ergeben haben: so viele. */
  quietChecks: number;
  /** Der Halt liegt am Ende des laufenden Abschnitts (die Gruppe erreicht einen Ort). */
  arrives: boolean;
  /** Bei einer Begegnung aus der Tabelle: welches Wesen und wie viele (`meetingOf`). */
  foe?: { creatureId: string; count: number } | null;
}

/**
 * Rechnet voran, wie weit die Reise bis zur nächsten Entscheidung kommt. `limit` begrenzt die
 * Reisezeit (der Knopf „1 Stunde“). Würfelt nur, wenn unterwegs eine Prüfung fällig wird.
 */
export function nextHalt(
  data: CampaignData,
  journey: Journey,
  roll: Roll,
  limit: number | null = null,
): Halt | null {
  const leg = journey.legs[journey.progress.leg];
  if (!leg) return null;
  const now = data.state.now;
  const left = Math.max(0, leg.minutes - journey.progress.minutes);
  // Orientierung: einmal am Tag, wenn es abseits von Wegen und Straßen weitergeht.
  const nav = navigationAt(data, journey);
  if (
    nav &&
    journey.navDay !== dayIndexOf(now) &&
    !(journey.halt?.kind === 'navigate' && journey.halt.at === now)
  )
    return {
      kind: 'navigate',
      minutes: 0,
      text: navText(nav),
      roll: '',
      quietChecks: 0,
      arrives: false,
    };
  // Was der Spielleiter am Weg vorbereitet hat, hält gleich zu Beginn des Abschnitts – einmal.
  const path = leg.pathId ? data.paths[leg.pathId] : undefined;
  const prepared = path?.onTheWay.trim() ?? '';
  const shown = journey.halt?.kind === 'prepared' && journey.halt.at === now;
  if (journey.progress.minutes === 0 && (prepared || path?.encounterId) && !shown)
    return {
      kind: 'prepared',
      minutes: 0,
      text: prepared || 'Eine Begegnung liegt an diesem Weg bereit.',
      roll: '',
      quietChecks: 0,
      arrives: false,
    };
  // Eine Gefahr auf dem Weg (Abhang, Kletterei): zu Beginn des Abschnitts – einmal.
  const hazardShown = journey.halt?.kind === 'hazard' && journey.halt.at === now;
  if (journey.progress.minutes === 0 && path?.hazard && !hazardShown && !shown)
    return {
      kind: 'hazard',
      minutes: 0,
      text: hazardLine(path.hazard),
      roll: '',
      quietChecks: 0,
      arrives: false,
    };
  const horizon = Math.min(HALT_HORIZON, limit ?? HALT_HORIZON);
  const candidates: { at: number; kind: HaltKind; text: string }[] = [];
  const add = (at: number, kind: HaltKind, text: string) => {
    if (at > 0 && at <= horizon) candidates.push({ at, kind, text });
  };
  const last = journey.progress.leg === journey.legs.length - 1;
  const target = leg.toId ? (data.entities[leg.toId]?.name ?? '') : '';
  if (left > 0 || journey.progress.minutes === 0)
    candidates.push({
      at: Math.max(left, 0),
      kind: last ? 'arrived' : 'place',
      text: target,
    });
  if (limit !== null) add(limit, 'hour', '');
  // Auf der Hexkarte des Weges: Felder mit Vorbereitetem, einem Ort oder einer Besonderheit, die
  // die Gruppe noch nicht kennt – beim Betreten.
  const area = leg.areaId ? data.areas[leg.areaId] : undefined;
  let prevKind: PassageKind | undefined;
  const navDays = new Set<number>();
  const shownFar = new Set<unknown>();
  if (area)
    leg.hexes.slice(1, -1).forEach((step, index) => {
      if (step.at <= journey.progress.minutes) return;
      const hex = area.hexes.find((entry) => sameHex(entry, step));
      if (!hex) return;
      const before = leg.hexes[index]!;
      const prev = area.hexes.find((entry) => sameHex(entry, before));
      const at = step.at - journey.progress.minutes;
      // Unter der Erde: wie der Durchgang ins Feld beschaffen ist.
      const dir = prev ? dirTo(prev, hex) : null;
      const kind =
        prev && dir !== null ? exitsOf(prev).find((e) => e.dir === dir)?.kind : undefined;
      const passage = prev && kind ? passageText(dir!, kind, prevKind) : '';
      prevKind = kind;
      const quiet =
        !hex.prepared.trim() &&
        !passage &&
        !(hex.placeId && hex.placeId !== leg.fromId && hex.placeId !== leg.toId) &&
        !(hex.river && !prev?.river && hex.road === 'none') &&
        !(hex.feature.trim() && !hex.discovered);
      // Orientierung: an der ersten Kreuzung eines neuen Tages, an der sonst nichts hält.
      if (quiet && hex.exits !== null && isJunction(hex)) {
        const day = dayIndexOf(now + at);
        const need = navNeed(data, hex.regionId ?? leg.regionId, hex.terrain, true);
        if (need && day !== journey.navDay && !navDays.has(day)) {
          navDays.add(day);
          add(at, 'navigate', navText(need));
        }
      }
      if (hex.prepared.trim()) add(at, 'prepared', hex.prepared.trim());
      else if (hex.hazard) add(at, 'hazard', hazardLine(hex.hazard));
      else if (passage) add(at, 'passage', passage);
      else if (hex.placeId && hex.placeId !== leg.fromId && hex.placeId !== leg.toId)
        add(at, 'place', data.entities[hex.placeId]?.name ?? '');
      // Ein Fluss ohne Straße oder Brücke: Furt, schwimmen oder Boot – entscheidet der Spielleiter.
      else if (hex.river && !prev?.river && hex.road === 'none')
        add(at, 'river', `${hex.river}: eine Furt suchen, schwimmen oder ein Boot`);
      else if (hex.feature.trim() && !hex.discovered) add(at, 'feature', hex.feature.trim());
      // Was von hier aus zum ersten Mal in der Ferne auftaucht – die Gruppe kann hingehen.
      const sights = newSightings(area, [hex]).filter((sight) => !shownFar.has(sight.hex));
      for (const sight of sights) shownFar.add(sight.hex);
      if (sights.length) add(at, 'sighted', sights.map(sightingLine).join(' · '));
    });
  // Acht Stunden seit der Rast: nur, wenn die Grenze unterwegs erreicht wird.
  const since = marchedMinutes(data, now);
  if (since < TRAVEL_HOURS * 60) add(TRAVEL_HOURS * 60 - since, 'rest', '');
  // Gewaltmarsch: am Ende jeder Stunde nach der achten ein Rettungswurf (Regelwerk).
  else {
    const next = (Math.floor(since / 60) + 1) * 60;
    add(next - since, 'march', marchText(next / 60 - TRAVEL_HOURS));
  }
  for (const halt of bodyHalts(data, journey, now, horizon)) add(halt.at, halt.kind, halt.text);
  // Lichter, die unterwegs erlöschen.
  for (const timer of Object.values(data.timers))
    if (timer.kind === 'light' && !timer.done && timer.end > now)
      add(timer.end - now, 'light', timer.label);
  // Termine (ohne Alltag) und Schritte von Uhren.
  for (const occurrence of occurrencesBetween(data, now + 1, now + horizon))
    if (!isEveryday(data, occurrence.event))
      add(occurrence.at - now, 'event', occurrence.event.title);
  for (const clock of Object.values(data.clocks))
    for (const step of dueSteps(clock, now, now + horizon))
      add(step.at - now, 'clock', step.step.text);
  // Prüfungen alle vier Stunden: würfeln, und nur halten, wenn etwas geschieht.
  let quietChecks = 0;
  // Auf einer Hexkarte gilt die Gegend, die auf das erreichte Feld gemalt ist; sonst die des Weges.
  const regionAt = (after: number): string | null => {
    if (area) {
      const passed = leg.hexes.filter((step) => step.at <= journey.progress.minutes + after);
      const step = passed[passed.length - 1];
      const hex = step ? area.hexes.find((entry) => sameHex(entry, step)) : undefined;
      if (hex?.regionId) return hex.regionId;
    }
    return leg.regionId ?? leg.toId;
  };
  for (let at = CHECK_EVERY - journey.sinceCheck; at <= horizon; at += CHECK_EVERY) {
    if (at <= 0) continue;
    const earliest = Math.min(...candidates.map((c) => c.at), Infinity);
    if (at >= earliest) break;
    const region = regionAt(at);
    const found =
      rollTables(data, region, 'encounter', roll, now + at) ??
      rollTables(data, region, 'discovery', roll, now + at);
    if (!found) {
      quietChecks++;
      continue;
    }
    return {
      kind: found.table.kind === 'discovery' ? 'discovery' : 'encounter',
      minutes: at,
      text: found.text,
      roll: `${found.table.name}: ${found.rolled}`,
      quietChecks,
      arrives: at >= left && left > 0,
      foe:
        found.table.kind !== 'discovery' && found.creatureId
          ? { creatureId: found.creatureId, count: found.meeting.count ?? 1 }
          : null,
    };
  }
  const first = candidates.sort((a, b) => a.at - b.at)[0];
  if (!first) return null;
  return {
    kind: first.kind,
    minutes: first.at,
    text: first.text,
    roll: '',
    quietChecks,
    arrives: first.at >= left,
  };
}

/**
 * Was der Körper der Gruppe unterwegs nach den Regeln aushalten muss – als Halte, die kommen:
 * extreme Kälte (stündlich), extreme Hitze ohne Trinkwasser (stündlich, steigend), Einbruch der
 * Nacht unter freiem Himmel, Hunger und Durst um Mitternacht, wenn die Vorräte nicht reichen.
 * Gezählt ab jetzt (`now`), höchstens bis `horizon` Minuten.
 */
export function bodyHalts(
  data: CampaignData,
  journey: Journey,
  now: WorldTime,
  horizon: number,
): { at: number; kind: HaltKind; text: string }[] {
  const out: { at: number; kind: HaltKind; text: string }[] = [];
  const leg = journey.legs[journey.progress.leg];
  const placeId = leg?.toId ?? leg?.regionId ?? data.state.placeId;
  const below = placeId ? isUnderground(data, placeId) : false;
  const left = (start: number | null, at: WorldTime) =>
    start === null ? null : start - daysSince(journey.departAt, at);
  const bounty = bountyOf(data, leg?.regionId ?? placeId);
  // Stündlich: Kälte und Hitze, je nur die nächste Stunde, in der es zählt.
  if (!below) {
    let cold = false;
    let heat = false;
    let hotHours = 0;
    for (let hour = 1; hour * 60 <= horizon && (!cold || !heat); hour++) {
      const at = now + hour * 60;
      const temperature = weatherAt(data, placeId, at).now.temperature;
      const water = left(journey.supplies.water, at);
      const dry = water !== null && water <= 0 && bounty.water !== true;
      if (temperature >= EXTREME_HEAT && dry) hotHours++;
      else hotHours = 0;
      if (!cold && temperature <= EXTREME_COLD) {
        cold = true;
        out.push({ at: hour * 60, kind: 'cold', text: coldText() });
      }
      if (!heat && hotHours > 0) {
        heat = true;
        out.push({ at: hour * 60, kind: 'heat', text: heatText(hotHours) });
      }
    }
    // Einbruch der Nacht – nur, wenn es jetzt noch hell ist.
    if (!isNightAt(now))
      for (let minute = 10; minute <= horizon; minute += 10)
        if (isNightAt(now + minute)) {
          out.push({
            at: minute,
            kind: 'dark',
            text: 'Die Sonne geht unter. Lager aufschlagen – oder mit Licht weiter (Dunkelheit: ohne Licht oder Dunkelsicht sieht niemand etwas).',
          });
          break;
        }
  }
  // Um Mitternacht: Reichen Proviant und Wasser für den Tag, der zu Ende ist?
  const midnight = (dayIndexOf(now) + 1) * MINUTES_PER_DAY - now;
  for (let at = midnight; at <= horizon; at += MINUTES_PER_DAY) {
    const food = left(journey.supplies.food, now + at);
    const water = left(journey.supplies.water, now + at);
    if (water !== null && water < 0 && bounty.water !== true)
      out.push({ at, kind: 'thirst', text: thirstText() });
    if (food !== null && food < 0) out.push({ at, kind: 'hunger', text: hungerText(-food) });
    if ((food !== null && food < 0) || (water !== null && water < 0)) break;
  }
  return out;
}

/** Die Nachtprüfung im Lager: einmal würfeln auf Begegnungen der Gegend. */
export function nightCheck(data: CampaignData, journey: Journey, roll: Roll): TableResult | null {
  const leg = journey.legs[journey.progress.leg];
  const regionAt = leg ? (leg.regionId ?? leg.toId) : data.state.placeId;
  return rollTables(data, regionAt, 'encounter', roll, 'night');
}

// ── Tabellen als Text ──────────────────────────────────────────────────────

/** Eine Tabelle als Text zum Schreiben: je Zeile „1–4: Eine Grauzwerg-Streife“. */
export function tableText(table: Pick<RollTable, 'entries'> | null | undefined): string {
  if (!table) return '';
  return table.entries
    .map((row) => `${row.min === row.max ? row.min : `${row.min}–${row.max}`}: ${row.text}`)
    .join('\n');
}

/**
 * Die Zeilen einer Tabelle aus Text („1–4: …“, „5-8 …“, „9: …“) und der Würfel dazu: der größte
 * Wert, der vorkommt (W4, W6, W8, W10, W12, W20, W100 – der nächste passende).
 */
export function tableFromText(text: string): {
  entries: { min: number; max: number; text: string }[];
  die: number;
} {
  const entries = parseEvents(text);
  const top = Math.max(0, ...entries.map((row) => row.max));
  const die = [4, 6, 8, 10, 12, 20, 100].find((sides) => sides >= top) ?? Math.max(2, top);
  return { entries, die };
}

// ── Orientierung ───────────────────────────────────────────────────────────

/**
 * Vorschlag für die Orientierung abseits von Wegen, wenn die Gegend keinen eigenen Wert hat – nur
 * ein Vorschlag, in der Gegend änderbar (`place.navDc`, 0 = nie prüfen). Offenes Land braucht keine
 * Prüfung, unübersichtliches Gelände und das Unterreich schon.
 */
export const SUGGESTED_NAV_DC: Record<Terrain, number> = {
  grassland: 0,
  coast: 0,
  urban: 0,
  water: 0,
  hills: 10,
  desert: 15,
  arctic: 15,
  mountains: 15,
  forest: 15,
  swamp: 15,
  underdark: 15,
};

/** Der eigene Wert der Gegend (oder einer darüber) – null, wenn keiner eingetragen ist. */
function ownNavDc(data: CampaignData, regionId: string | null): number | null {
  if (!regionId) return null;
  const self = data.entities[regionId];
  const chain = [...(self?.kind === 'place' ? [self] : []), ...placeAncestors(data, regionId)];
  for (const place of chain) if (place.place.navDc !== null) return place.place.navDc;
  return null;
}

/**
 * Muss die Gruppe sich hier orientieren? Nur abseits von Wegen: auf einer freien Strecke oder auf
 * einem Feld der Hexkarte ohne Straße und Pfad. Gibt den Schwierigkeitsgrad zurück (eigener Wert
 * der Gegend, sonst Vorschlag nach Gelände) – null, wenn nicht geprüft wird.
 */
export function navigationAt(
  data: CampaignData,
  journey: Journey,
): { dc: number; suggested: boolean } | null {
  const leg = journey.legs[journey.progress.leg];
  if (!leg) return null;
  const area = leg.areaId ? data.areas[leg.areaId] : undefined;
  if (leg.pathId && !area) return null;
  let terrain: Terrain | null = null;
  let regionId = leg.regionId;
  if (area) {
    const passed = leg.hexes.filter((step) => step.at <= journey.progress.minutes);
    const step = passed[passed.length - 1] ?? leg.hexes[0];
    const hex = step ? area.hexes.find((h) => sameHex(h, step)) : undefined;
    if (!hex || hex.road !== 'none') return null;
    // Im Gangnetz verirrt man sich nur, wo sich Wege teilen: an Kreuzungen und in Höhlen.
    if (hex.exits !== null && !isJunction(hex)) return null;
    terrain = hex.terrain;
    regionId = hex.regionId ?? regionId;
  }
  const below = leg.toId ? isUnderground(data, leg.toId) : false;
  return navNeed(data, regionId, terrain, below);
}

/**
 * Muss sich die Gruppe auf diesem Feld einer Hexkarte orientieren? Nur abseits von Straße und
 * Pfad, im Gangnetz nur an Kreuzungen. SG der Gegend, sonst Vorschlag nach Gelände.
 */
export function hexNavigation(
  data: CampaignData,
  hex: Pick<Hex, 'road' | 'exits' | 'terrain' | 'regionId'>,
): { dc: number; suggested: boolean } | null {
  if (hex.road !== 'none') return null;
  if (hex.exits !== null && !isJunction(hex as Hex)) return null;
  return navNeed(data, hex.regionId, hex.terrain, hex.terrain === 'underdark');
}

/** Die Seiten eines Feldes als Himmelsrichtung (Spitze oben): 0 = Nordosten … 5 = Nordwesten. */
export const HEADING_LABEL = [
  'Nordosten',
  'Osten',
  'Südosten',
  'Südwesten',
  'Westen',
  'Nordwesten',
] as const;

/**
 * Wohin eine verirrte Gruppe abkommt: eine Seite neben der gewollten (60° nach links oder rechts,
 * `left` entscheidet), aber nur auf ein Feld, das es gibt und das betretbar ist (`ok`); sonst die
 * andere Seite, sonst bleibt es bei der gewollten.
 */
export function veerHeading(intended: number, left: boolean, ok: (dir: number) => boolean): number {
  const first = (intended + (left ? 5 : 1)) % 6;
  const second = (intended + (left ? 1 : 5)) % 6;
  if (ok(first)) return first;
  if (ok(second)) return second;
  return intended;
}

/** Ob und mit welchem SG geprüft wird: eigener Wert der Gegend, sonst Vorschlag nach Gelände. */
function navNeed(
  data: CampaignData,
  regionId: string | null,
  terrain: Terrain | null,
  below: boolean,
): { dc: number; suggested: boolean } | null {
  const own = ownNavDc(data, regionId);
  if (own !== null) return own > 0 ? { dc: own, suggested: false } : null;
  const dc = terrain ? SUGGESTED_NAV_DC[terrain] : below ? SUGGESTED_NAV_DC.underdark : 0;
  return dc > 0 ? { dc, suggested: true } : null;
}

const navText = (nav: { dc: number; suggested: boolean }) =>
  `Weisheit (Überlebenskunst) SG ${nav.dc}${nav.suggested ? ' (Vorschlag nach Gelände)' : ''}`;

/**
 * Was ein schwieriger Durchgang verlangt – nur ein Hinweis, die Probe entscheidet der
 * Spielleiter. Leer, wenn der Durchgang nicht hält (Gang, Engstelle, Wasser in Folge).
 */
function passageText(dir: number, kind: PassageKind, before: PassageKind | undefined): string {
  if (dir >= 6) {
    const way = dir === DIR_DOWN ? 'hinab' : 'hinauf';
    if (kind === 'drop') return 'Ein Abbruch: hinunter geht es, zurück nicht.';
    return kind === 'climb'
      ? `Ein Schacht ${way}: klettern – Stärke (Athletik).`
      : `Ein Schacht ${way}.`;
  }
  if (kind === 'climb') return 'Kletterei: Stärke (Athletik).';
  if (kind === 'drop') return 'Ein Abbruch: hinunter geht es, zurück nicht.';
  if (kind === 'water' && before !== 'water')
    return 'Wasser im Gang: schwimmen – Stärke (Athletik) – oder ein Boot.';
  return '';
}

/**
 * Ist die Gruppe gerade zwischen zwei Orten? Auf einer laufenden Reise oder auf einer Hexkarte
 * zwischen ihrem Ort und einem anderen, auf einem Feld ohne Ort – dann steht in der Weltleiste
 * „Unterwegs“ statt des Ortes, von dem sie aufgebrochen ist. null = sie ist an ihrem Ort.
 */
export function partyBetween(
  data: Pick<CampaignData, 'journeys' | 'areas' | 'entities' | 'state' | 'chronicle'>,
): { toId: string | null; areaId: string | null } | null {
  const journey = journeyUnderway(data);
  if (journey) {
    const leg = journey.legs[journey.progress.leg];
    return {
      toId: journey.legs[journey.legs.length - 1]?.toId ?? leg?.toId ?? null,
      areaId: leg?.areaId ?? null,
    };
  }
  const here = data.state.placeId;
  if (!here) return null;
  // Ein Schritt auf der Hexkarte zählt nur, wenn er nach dem letzten Ortswechsel kam – sonst ist
  // es ein alter Stand der Karte, und die Gruppe ist längst irgendwo angekommen.
  let movedAt = Number.NEGATIVE_INFINITY;
  for (const entry of Object.values(data.chronicle))
    if (entry.kind === 'travel' && entry.at > movedAt) movedAt = entry.at;
  // Auch eine Reise, die danach aufbrach (und vielleicht ohne Ortswechsel endete), löst ab.
  for (const journey of Object.values(data.journeys))
    if (journey.departAt !== null && journey.departAt > movedAt) movedAt = journey.departAt;
  const lastStep = (area: Area) => area.party!.legs[area.party!.legs.length - 1]?.at ?? null;
  const walking = Object.values(data.areas)
    .filter((area) => area.party && (area.fromId === here || area.toId === here))
    .filter((area) => {
      const at = area.hexes.find((hex) => sameHex(hex, area.party!));
      const step = lastStep(area);
      return at && !at.placeId && area.party!.trail.length > 0 && step !== null && step > movedAt;
    })
    .sort(
      (a, b) =>
        (b.party!.legs[b.party!.legs.length - 1]?.at ?? 0) -
        (a.party!.legs[a.party!.legs.length - 1]?.at ?? 0),
    )[0];
  if (!walking) return null;
  return { toId: walking.fromId === here ? walking.toId : walking.fromId, areaId: walking.id };
}
