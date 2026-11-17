/**
 * Befehle der Reise (`domain/journey.ts`): aufbrechen, weiter bis zur nächsten Entscheidung, ein
 * Lager aufschlagen, die Reise beenden. Die Zeit läuft nur über `walk` (am Ende eines Abschnitts:
 * Ortswechsel mit Reisezeit) und `advanceTime` (mitten auf einem Abschnitt) – nie an ihnen
 * vorbei. Was unterwegs geschah, steht in der Chronik.
 */
import { advanceTime, logEntry, undoTimeAdvance } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import {
  CHECK_EVERY,
  HALT_LABEL,
  journeyUnderway,
  nextHalt,
  nightCheck,
  rollTables,
  type Halt,
  type JourneyPlan,
  type Roll,
  type TableResult,
} from '../../domain/journey';
import type { When } from '../../domain/roaming';
import {
  createJourney,
  createRollTable,
  newId,
  type CampaignData,
  type Journey,
  type RollTable,
  type TableKind,
} from '../../domain/schema';
import { walk } from '../wege/actions';
import { markSighted } from '../../domain/afar';
import { searchMinutes, seenFrom } from '../erkundung/travel';
import { hexAtProgress } from './hexway';
import { hexKey, sameHex } from '../../domain/hex';
import { dayIndexOf } from '../../domain/time/calendar';
import { formatWayTime } from '../../domain/ways';

/** Bricht auf: eine laufende Reise vom Ort der Gruppe zum Ziel. Gibt die Reise und `undo` zurück. */
export function startJourney(
  db: CampaignDb,
  input: {
    toId: string;
    plan: JourneyPlan;
    /** Bei unbekannter Dauer: die Minuten, die der Spielleiter einträgt (verteilt auf die Abschnitte). */
    minutes?: number | null;
    food?: number | null;
    water?: number | null;
  },
): { journey: Journey; undo: () => void } | null {
  const data = db.getSnapshot();
  const fromId = data.state.placeId;
  if (!fromId || !input.plan.legs.length) return null;
  const known = input.plan.legs.filter((leg) => leg.minutes > 0).length;
  const spread =
    input.minutes && input.minutes > 0
      ? Math.round(input.minutes / Math.max(1, input.plan.legs.length - known || 1))
      : 0;
  const legs = input.plan.legs.map((leg) => ({
    ...leg,
    id: newId(),
    minutes: leg.minutes > 0 ? leg.minutes : spread,
  }));
  if (legs.every((leg) => leg.minutes === 0)) return null;
  const to = data.entities[input.toId];
  const from = data.entities[fromId];
  return db.batch(() => {
    // Höchstens eine Reise ist unterwegs: eine alte endet hier.
    const before = journeyUnderway(db.getSnapshot());
    if (before) db.patch('journeys', before.id, { status: 'aborted', halt: null });
    const journey = db.put(
      'journeys',
      createJourney({
        name: to?.name ?? '',
        startId: fromId,
        toId: input.toId,
        legs,
        status: 'underway',
        departAt: data.state.now,
        progress: { leg: 0, minutes: 0, km: 0 },
        supplies: { food: input.food ?? null, water: input.water ?? null },
      }),
    );
    const line = logEntry(db, {
      text: `Aufbruch${from ? ` aus ${from.name}` : ''}, Richtung ${to?.name ?? 'Ziel'}`,
      refs: [input.toId],
    });
    return {
      journey,
      undo: () =>
        db.batch(() => {
          if (db.getSnapshot().journeys[journey.id]) db.remove('journeys', journey.id);
          if (db.getSnapshot().chronicle[line.id]) db.remove('chronicle', line.id);
          if (before) db.patch('journeys', before.id, { status: 'underway', halt: before.halt });
        }),
    };
  });
}

export interface TravelResult {
  halt: Halt;
  journey: Journey;
  undo: () => void;
}

/**
 * Reist bis zur nächsten Entscheidung (oder höchstens `limit` Minuten): Zeit vergeht, am Ende
 * eines Abschnitts kommt die Gruppe an (`walk`), unterwegs werden die Prüfungen gewürfelt. Was
 * eine Entscheidung braucht, steht danach als Halt an der Reise und als Zeile in der Chronik.
 */
export function travelOn(
  db: CampaignDb,
  roll: Roll,
  limit: number | null = null,
): TravelResult | null {
  const data = db.getSnapshot();
  const journey = journeyUnderway(data);
  if (!journey) return null;
  // Verirrt: Erst kostet der Umweg seine Zeit, ohne dass die Reise vorankommt.
  if (journey.lostMinutes > 0) return detour(db, journey);
  const halt = nextHalt(data, journey, roll, limit);
  if (!halt) return null;
  const leg = journey.legs[journey.progress.leg]!;
  const left = Math.max(0, leg.minutes - journey.progress.minutes);
  const areaBefore = leg.areaId ? data.areas[leg.areaId] : undefined;
  return db.batch(() => {
    const undos: (() => void)[] = [];
    let progress = { ...journey.progress };
    let steps = journey.steps;
    let status = journey.status;
    if (halt.minutes > 0 || halt.arrives) {
      if (halt.arrives && leg.toId) {
        const path = leg.pathId ? db.getSnapshot().paths[leg.pathId] : undefined;
        const walked = walk(db, leg.toId, left, path?.name ? `über ${path.name}` : 'unterwegs');
        undos.push(walked.undo);
        progress = { leg: journey.progress.leg + 1, minutes: 0, km: 0 };
        if (progress.leg >= journey.legs.length) status = 'arrived';
      } else {
        const start = db.getSnapshot().state.now;
        advanceTime(db, start + halt.minutes);
        undos.push(() => undoTimeAdvance(db));
        progress = { ...progress, minutes: progress.minutes + halt.minutes };
        steps = [...steps, { at: start + halt.minutes, minutes: halt.minutes }].slice(-20);
      }
    }
    // Die Hexkarte des Weges zieht mit: Die Gruppe steht dort, wo die Reise ist.
    syncArea(db, leg, halt.arrives ? leg.minutes : progress.minutes);
    const now = db.getSnapshot().state.now;
    const lineFor: Partial<Record<Halt['kind'], string>> = {
      encounter: `Begegnung unterwegs: ${halt.text}`,
      discovery: `Entdeckung unterwegs: ${halt.text}`,
      prepared: `Am Weg: ${halt.text}`,
      feature: `Unterwegs: ${halt.text}`,
      light: `Licht erlischt: ${halt.text}`,
      river: `Am Fluss: ${halt.text}`,
      sighted: `In Sicht: ${halt.text}`,
      rest: 'Acht Stunden unterwegs seit der letzten Rast',
    };
    const text = lineFor[halt.kind];
    const line = text ? logEntry(db, { text, refs: leg.toId ? [leg.toId] : [] }) : null;
    const next = db.patch('journeys', journey.id, {
      progress,
      steps,
      status,
      sinceCheck:
        halt.kind === 'encounter' || halt.kind === 'discovery'
          ? 0
          : (journey.sinceCheck + halt.minutes) % CHECK_EVERY,
      navDay: halt.kind === 'navigate' ? dayIndexOf(now) : journey.navDay,
      halt:
        status === 'arrived'
          ? null
          : { kind: halt.kind, text: halt.text, at: now, roll: halt.roll, encounterId: null },
    })!;
    return {
      halt,
      journey: next,
      undo: () =>
        db.batch(() => {
          if (line && db.getSnapshot().chronicle[line.id]) db.remove('chronicle', line.id);
          for (const undo of undos.reverse()) undo();
          db.put('journeys', journey);
          if (areaBefore) db.put('areas', areaBefore);
        }),
    };
  });
}

export interface JourneySearch {
  minutes: number;
  /** Was verborgen lag – null: nichts gefunden. */
  found: string | null;
  /** Die eine Begegnungsprüfung während der Suche. */
  encounter: TableResult | null;
  undo: () => void;
}

/**
 * Das Feld durchsuchen, auf dem die Reise gerade steht: Es dauert so lange wie das Durchqueren
 * (`searchMinutes`), die Reise kommt dabei nicht voran, und einmal wird auf den Begegnungen der
 * Gegend geprüft (wie im Lager). Was verborgen lag, findet die Gruppe und steht in der Chronik.
 */
export function searchOnJourney(db: CampaignDb, roll: Roll): JourneySearch | null {
  const data = db.getSnapshot();
  const journey = journeyUnderway(data);
  if (!journey) return null;
  const leg = journey.legs[journey.progress.leg];
  const spot = hexAtProgress(journey);
  const area = spot ? data.areas[spot.areaId] : undefined;
  const hex = area?.hexes.find((entry) => sameHex(entry, spot!.hex));
  if (!leg || !area || !hex) return null;
  const minutes = searchMinutes(data, area, hex);
  if (minutes === null) return null;
  const encounter = rollTables(data, hex.regionId ?? leg.regionId ?? leg.toId, 'encounter', roll);
  const found = hex.hidden.trim() || null;
  return db.batch(() => {
    const start = db.getSnapshot().state.now;
    advanceTime(db, start + minutes);
    db.patch('areas', area.id, {
      hexes: area.hexes.map((entry) => (entry === hex ? { ...entry, searched: true } : entry)),
    });
    const line = logEntry(db, {
      text: found
        ? `Beim Durchsuchen gefunden: ${found}`
        : 'Die Gegend durchsucht – nichts gefunden',
      refs: leg.toId ? [leg.toId] : [],
    });
    const at = db.getSnapshot().state.now;
    db.patch('journeys', journey.id, {
      halt: found
        ? { kind: 'search', text: found, at, roll: '', encounterId: null }
        : encounter
          ? {
              kind: 'encounter',
              text: encounter.text,
              at,
              roll: `Beim Durchsuchen · ${encounter.table.name}: ${encounter.rolled}`,
              encounterId: null,
            }
          : null,
    });
    return {
      minutes,
      found,
      encounter,
      undo: () =>
        db.batch(() => {
          if (db.getSnapshot().chronicle[line.id]) db.remove('chronicle', line.id);
          undoTimeAdvance(db);
          db.put('journeys', journey);
          if (db.getSnapshot().areas[area.id]) db.patch('areas', area.id, { hexes: area.hexes });
        }),
    };
  });
}

/** Der Umweg nach dem Verirren: Zeit vergeht, die Reise kommt nicht voran. */
function detour(db: CampaignDb, journey: Journey): TravelResult {
  const minutes = journey.lostMinutes;
  return db.batch(() => {
    const start = db.getSnapshot().state.now;
    advanceTime(db, start + minutes);
    const line = logEntry(db, { text: `Umweg: etwa ${formatWayTime(minutes)} verloren` });
    const next = db.patch('journeys', journey.id, {
      lostMinutes: 0,
      steps: [...journey.steps, { at: start + minutes, minutes }].slice(-20),
      sinceCheck: (journey.sinceCheck + minutes) % CHECK_EVERY,
      halt: {
        kind: 'navigate',
        text: 'Wieder auf Kurs.',
        at: start + minutes,
        roll: '',
        encounterId: null,
      },
    })!;
    return {
      halt: {
        kind: 'navigate',
        minutes,
        text: 'Umweg gegangen – wieder auf Kurs.',
        roll: '',
        quietChecks: 0,
        arrives: false,
      },
      journey: next,
      undo: () =>
        db.batch(() => {
          if (db.getSnapshot().chronicle[line.id]) db.remove('chronicle', line.id);
          undoTimeAdvance(db);
          db.put('journeys', journey);
        }),
    };
  });
}

/**
 * Verirrt (nach einer misslungenen Orientierung, entschieden vom Spielleiter): Wayfarer würfelt
 * den Umweg – 1W6 Stunden –, den die nächste Etappe kostet. Gibt die Stunden und `undo` zurück.
 */
export function getLost(db: CampaignDb, roll: Roll): { hours: number; undo: () => void } | null {
  const journey = journeyUnderway(db.getSnapshot());
  if (!journey) return null;
  const hours = roll(6);
  db.patch('journeys', journey.id, { lostMinutes: hours * 60, halt: null });
  return { hours, undo: () => db.put('journeys', journey) };
}

/**
 * Stellt die Gruppe auf der Hexkarte eines Abschnitts dorthin, wo die Reise nach `minutes` ist:
 * das letzte erreichte Feld; was sie dabei durchquert hat, ist entdeckt und steht in ihrer Spur.
 */
function syncArea(db: CampaignDb, leg: Journey['legs'][number], minutes: number): void {
  if (!leg.areaId || !leg.hexes.length) return;
  const area = db.getSnapshot().areas[leg.areaId];
  if (!area) return;
  const passed = leg.hexes.filter((hex) => hex.at <= minutes);
  const at = passed[passed.length - 1] ?? leg.hexes[0]!;
  // Entdeckt ist, was die Gruppe von jedem durchquerten Feld aus sieht (`seenFrom`).
  const seen = new Set<string>();
  for (const hex of passed) for (const key of seenFrom(db.getSnapshot(), area, hex)) seen.add(key);
  const before = area.party;
  const trail = [
    ...(before?.trail ?? []),
    ...passed.map(({ q, r, level }) => ({ q, r, level })),
  ].filter((hex, index, all) => all.findIndex((other) => sameHex(other, hex)) === index);
  db.patch('areas', area.id, {
    party: {
      q: at.q,
      r: at.r,
      level: at.level,
      pace: before?.pace ?? 'normal',
      day: before?.day ?? 0,
      minutes: before?.minutes ?? 0,
      trail,
      legs: before?.legs ?? [],
    },
    // Was dabei in der Ferne auftauchte, gilt als gesehen (`hex.sighted`).
    hexes: markSighted(
      area.hexes.map((hex) =>
        seen.has(hexKey(hex)) && !hex.discovered ? { ...hex, discovered: true } : hex,
      ),
      passed,
    ),
  });
}

/**
 * Ein Lager unterwegs: die Nachtprüfung auf den Begegnungen der Gegend (nur ein Vorschlag). Die
 * Rast selbst läuft über den Dialog der Rast. Gibt das Ergebnis zurück – null, wenn nichts geschieht.
 */
export function campCheck(db: CampaignDb, roll: Roll): TableResult | null {
  const data = db.getSnapshot();
  const journey = journeyUnderway(data);
  if (!journey) return null;
  const found = nightCheck(data, journey, roll);
  db.patch('journeys', journey.id, {
    sinceCheck: 0,
    halt: found
      ? {
          kind: 'encounter',
          text: found.text,
          at: data.state.now,
          roll: `Nachts · ${found.table.name}: ${found.rolled}`,
          encounterId: null,
        }
      : null,
  });
  if (found) logEntry(db, { text: `Begegnung in der Nacht: ${found.text}` });
  return found;
}

/** Nimmt den Halt zur Kenntnis („Trotzdem weiter“ ohne zu reisen). */
export function clearHalt(db: CampaignDb): void {
  const journey = journeyUnderway(db.getSnapshot());
  if (journey?.halt) db.patch('journeys', journey.id, { halt: null });
}

/** Beendet die Reise hier – angekommen oder abgebrochen. Gibt `undo` zurück. */
export function endJourney(db: CampaignDb, arrived: boolean): (() => void) | null {
  const journey = journeyUnderway(db.getSnapshot());
  if (!journey) return null;
  db.patch('journeys', journey.id, { status: arrived ? 'arrived' : 'aborted', halt: null });
  return () => db.put('journeys', journey);
}

export { HALT_LABEL };

// ── Gegenden: Gelände und Tabellen ─────────────────────────────────────────

/** Gelände und Tempo einer Gegend – gilt für alles darunter. */
export function setPlaceGround(
  db: CampaignDb,
  placeId: string,
  change: { word?: string; slow?: boolean },
): void {
  const place = db.getSnapshot().entities[placeId];
  if (place?.kind !== 'place') return;
  db.patch('entities', placeId, {
    place: {
      ...place.place,
      ...(change.word !== undefined ? { ground: change.word.replace(/\s+/g, ' ').trim() } : {}),
      ...(change.slow !== undefined ? { groundSlow: change.slow } : {}),
    },
  });
}

/** Der Schwierigkeitsgrad der Orientierung in einer Gegend (null = Vorschlag nach Gelände, 0 = nie). */
export function setPlaceNav(db: CampaignDb, placeId: string, dc: number | null): void {
  const place = db.getSnapshot().entities[placeId];
  if (place?.kind !== 'place') return;
  db.patch('entities', placeId, { place: { ...place.place, navDc: dc } });
}

/** Die Tabelle einer Gegend für eine Art (die erste, die es gibt) – null, wenn keine. */
export function regionTable(
  data: ReturnType<CampaignDb['getSnapshot']>,
  placeId: string,
  kind: TableKind,
): RollTable | null {
  return (
    Object.values(data.tables).find((table) => table.placeId === placeId && table.kind === kind) ??
    null
  );
}

/** Eine Zeile einer Begegnungstabelle, wie die Tabelle an der Gegend sie zeigt. */
export interface RegionRow {
  text: string;
  /** Wesen des Bestiariums mit genau diesem Namen (sonst null). */
  creatureId: string | null;
  weight: number;
  when: When | null;
}

/** Das Wesen des Bestiariums, das genau so heißt (ohne Groß/Klein) – sonst null. */
export function creatureNamed(data: CampaignData, name: string): string | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  return Object.values(data.creatures).find((c) => c.name.trim().toLowerCase() === key)?.id ?? null;
}

/** Die Zeilen der Tabelle einer Gegend. */
export function regionRows(table: RollTable | null): RegionRow[] {
  return (table?.entries ?? []).map((row) => ({
    text: row.text,
    creatureId: row.creatureId,
    weight: row.max - row.min + 1,
    when: row.when,
  }));
}

/**
 * Schreibt die Tabelle einer Gegend Zeile für Zeile (Was, Häufigkeit, Wann). Trägt eine Zeile genau
 * den Namen eines Wesens im Bestiarium, hängt es daran – Anzahl, Spuren und Bau kommen dann von
 * dort. Keine Zeile mehr nimmt die Tabelle weg. `dc`: ab welchem W20 etwas geschieht (null = jede
 * Prüfung wählt eine Zeile). Gibt `undo` zurück.
 */
export function saveRegionRows(
  db: CampaignDb,
  placeId: string,
  kind: TableKind,
  rows: readonly RegionRow[],
  dc: number | null,
): () => void {
  const data = db.getSnapshot();
  const place = data.entities[placeId];
  const existing = regionTable(data, placeId, kind);
  const undo = () => {
    const now = regionTable(db.getSnapshot(), placeId, kind);
    if (now) db.remove('tables', now.id);
    if (existing) db.put('tables', { ...existing, rev: 0 });
  };
  if (!place) return () => {};
  let next = 1;
  const entries = rows
    .filter((row) => row.text.trim())
    .map((row) => {
      const weight = Math.max(1, Math.min(99, Math.round(row.weight) || 1));
      const entry = {
        id: newId(),
        min: next,
        max: next + weight - 1,
        text: row.text.trim(),
        refs: [] as string[],
        creatureId: creatureNamed(data, row.text),
        when: row.when,
      };
      next += weight;
      return entry;
    });
  if (!entries.length) {
    if (existing) db.remove('tables', existing.id);
    return undo;
  }
  const die = Math.max(2, next - 1);
  const name = `${kind === 'encounter' ? 'Begegnungen' : 'Entdeckungen'} – ${place.name}`;
  if (existing) db.patch('tables', existing.id, { entries, die, dc, name });
  else db.put('tables', createRollTable({ name, kind, placeId, die, dc, entries }));
  return undo;
}

/** Ändert nur, ab welchem W20 auf der Tabelle einer Gegend etwas geschieht. */
export function setRegionTableDc(
  db: CampaignDb,
  placeId: string,
  kind: TableKind,
  dc: number | null,
): void {
  const table = regionTable(db.getSnapshot(), placeId, kind);
  if (table) db.patch('tables', table.id, { dc });
}
