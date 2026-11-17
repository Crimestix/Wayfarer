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
  type Halt,
  type JourneyPlan,
  type Roll,
  type TableResult,
  tableFromText,
} from '../../domain/journey';
import {
  createJourney,
  createRollTable,
  newId,
  type Journey,
  type RollTable,
  type TableKind,
} from '../../domain/schema';
import { walk } from '../wege/actions';

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
  const halt = nextHalt(data, journey, roll, limit);
  if (!halt) return null;
  const leg = journey.legs[journey.progress.leg]!;
  const left = Math.max(0, leg.minutes - journey.progress.minutes);
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
    const now = db.getSnapshot().state.now;
    const lineFor: Partial<Record<Halt['kind'], string>> = {
      encounter: `Begegnung unterwegs: ${halt.text}`,
      discovery: `Entdeckung unterwegs: ${halt.text}`,
      prepared: `Am Weg: ${halt.text}`,
      light: `Licht erlischt: ${halt.text}`,
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
        }),
    };
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

/**
 * Schreibt die Tabelle einer Gegend aus Text („1–4: …“). Leerer Text nimmt sie weg. `dc`: ab
 * welchem W20 etwas geschieht (null = jede Prüfung würfelt auf die Tabelle).
 */
export function saveRegionTable(
  db: CampaignDb,
  placeId: string,
  kind: TableKind,
  text: string,
  dc: number | null,
): void {
  const data = db.getSnapshot();
  const place = data.entities[placeId];
  if (!place) return;
  const existing = regionTable(data, placeId, kind);
  const { entries, die } = tableFromText(text);
  if (!entries.length) {
    if (existing) db.remove('tables', existing.id);
    return;
  }
  const rows = entries.map((row) => ({ ...row, id: newId(), refs: [] as string[] }));
  const name = `${kind === 'encounter' ? 'Begegnungen' : 'Entdeckungen'} – ${place.name}`;
  if (existing) db.patch('tables', existing.id, { entries: rows, die, dc, name });
  else db.put('tables', createRollTable({ name, kind, placeId, die, dc, entries: rows }));
}
