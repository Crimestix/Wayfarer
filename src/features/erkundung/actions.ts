/** Befehle des Bereichs „Erkundung“. */
import { advanceTime, undoTimeAdvance, type TimeAdvanceResult } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import { hexKey, hexNeighbors, type HexCoord } from '../../domain/hex';
import { freshSeed } from '../../domain/random';
import { HexSchema, type Area, type Hex, type Pace } from '../../domain/schema';
import { dayIndexOf } from '../../domain/time/calendar';
import { generateHexes, groundOf, recognize, type GenerateInput } from './generate';
import { planStep, type StepProblem, type TravelStep } from './travel';

/** Ändert ein Feld einer Karte; fehlt die Karte oder das Feld, geschieht nichts. */
export function patchHex(
  db: CampaignDb,
  areaId: string,
  coord: { q: number; r: number },
  change: Partial<Omit<Hex, 'q' | 'r'>>,
): void {
  const area = db.getSnapshot().areas[areaId];
  if (!area) return;
  let found = false;
  const hexes = area.hexes.map((hex) => {
    if (hex.q !== coord.q || hex.r !== coord.r) return hex;
    found = true;
    return { ...hex, ...change, manual: true };
  });
  if (found) db.patch('areas', areaId, { hexes });
}

/** Deckt alle Felder auf oder wieder zu; das Feld des Startortes bleibt immer entdeckt. */
export function setAllDiscovered(db: CampaignDb, areaId: string, discovered: boolean): void {
  const area = db.getSnapshot().areas[areaId];
  if (!area) return;
  db.patch('areas', areaId, {
    hexes: area.hexes.map((hex) => ({
      ...hex,
      discovered: discovered || (hex.placeId !== null && hex.placeId === area.fromId),
    })),
  });
}

/** Die Angaben, mit denen eine erzeugte Karte neu gebaut werden kann; null, wenn sie fehlen. */
export function rerollInput(
  db: CampaignDb,
  area: Area,
  seed: number = freshSeed(),
): GenerateInput | null {
  if (!area.fromId || !area.toId || !area.biome || !area.distanceKm) return null;
  const known = recognize(db.getSnapshot(), area.fromId, area.toId);
  return {
    fromId: area.fromId,
    toId: area.toId,
    distanceKm: area.distanceKm,
    biome: area.biome,
    hexKm: area.hexKm,
    seed,
    direction: known.direction,
    between: known.between,
    ground: groundOf(db.getSnapshot(), known.origin, area.hexKm),
    route: known.route,
  };
}

/** Hat der Spielleiter an diesem Feld etwas eingetragen, das Neu würfeln nicht anfassen darf? */
const handMade = (hex: Hex): boolean =>
  hex.manual ||
  hex.regionId !== null ||
  hex.road !== 'none' ||
  hex.prepared.trim() !== '' ||
  hex.note.trim() !== '' ||
  hex.tableIds.length > 0;

/**
 * Würfelt das Gelände einer erzeugten Karte neu. Name und Notizen bleiben; was der Spielleiter an
 * Feldern von Hand gemacht hat (gemalt, Gegend, Straße, Vorbereitetes, Notiz), bleibt, wie es ist.
 * Felder, die er angefügt hat, bleiben auch. `undo` stellt den alten Stand wieder her.
 */
export function rerollArea(db: CampaignDb, areaId: string): (() => void) | null {
  const area = db.getSnapshot().areas[areaId];
  const input = area ? rerollInput(db, area) : null;
  if (!area || !input) return null;
  const fresh = generateHexes(input).hexes;
  const kept = new Map(area.hexes.filter(handMade).map((hex) => [hexKey(hex), hex]));
  const present = new Set(area.hexes.map(hexKey));
  // Was weggenommen wurde, bleibt weg; was von Hand angefügt wurde, bleibt.
  const hexes = [
    ...fresh
      .filter((hex) => present.has(hexKey(hex)) || hex.placeId !== null)
      .map((hex) => kept.get(hexKey(hex)) ?? hex),
    ...[...kept.values()].filter((hex) => !fresh.some((other) => hexKey(other) === hexKey(hex))),
  ];
  // Die Gruppe verlässt die Karte: Auf dem neuen Gelände stünde sie womöglich mitten im See.
  db.patch('areas', areaId, { hexes, seed: input.seed, party: null });
  return () => {
    if (db.getSnapshot().areas[areaId])
      db.patch('areas', areaId, { hexes: area.hexes, seed: area.seed, party: area.party });
  };
}

/** Löscht eine Karte; `undo` holt sie zurück. */
export function removeArea(db: CampaignDb, areaId: string): (() => void) | null {
  const area = db.getSnapshot().areas[areaId];
  if (!area) return null;
  db.remove('areas', areaId);
  return () => {
    if (!db.getSnapshot().areas[areaId]) db.put('areas', { ...area, rev: 0 });
  };
}

// ── Reisen ─────────────────────────────────────────────────────────────────

/**
 * Stellt die Gruppe auf ein Feld der Karte (oder nimmt sie mit `null` von der Karte). Dabei
 * vergeht keine Zeit; das Feld und seine Nachbarn gelten als entdeckt. Der bisherige Weg und die
 * Reisezeit des Tages beginnen neu.
 */
export function placeParty(db: CampaignDb, areaId: string, coord: HexCoord | null): void {
  const area = db.getSnapshot().areas[areaId];
  if (!area) return;
  if (!coord) {
    db.patch('areas', areaId, { party: null });
    return;
  }
  if (!area.hexes.some((hex) => hex.q === coord.q && hex.r === coord.r)) return;
  const seen = new Set([hexKey(coord), ...hexNeighbors(coord).map(hexKey)]);
  db.patch('areas', areaId, {
    hexes: area.hexes.map((hex) =>
      hex.discovered || !seen.has(hexKey(hex)) ? hex : { ...hex, discovered: true },
    ),
    party: {
      q: coord.q,
      r: coord.r,
      pace: area.party?.pace ?? 'normal',
      day: dayIndexOf(db.getSnapshot().state.now),
      minutes: 0,
      trail: [],
      legs: [],
    },
  });
}

/** Ändert das Reisetempo der Gruppe auf dieser Karte. */
export function setTravelPace(db: CampaignDb, areaId: string, pace: Pace): void {
  const area = db.getSnapshot().areas[areaId];
  if (area?.party) db.patch('areas', areaId, { party: { ...area.party, pace } });
}

export interface TravelResult {
  step: TravelStep;
  /** Was in der Reisezeit eingetreten und abgelaufen ist. */
  time: TimeAdvanceResult;
  /** Nimmt den Schritt zurück: Stellung, Entdecktes und die vergangene Zeit. */
  undo: () => void;
}

/**
 * Die Gruppe zieht auf ein Nachbarfeld: Die Reisezeit vergeht (Termine treten ein, Timer laufen
 * ab), das Feld und seine Umgebung werden entdeckt. Gibt den Grund zurück, wenn der Schritt
 * nicht geht.
 */
export function travelTo(db: CampaignDb, areaId: string, to: HexCoord): TravelResult | StepProblem {
  const data = db.getSnapshot();
  const area = data.areas[areaId];
  if (!area) return 'off-map';
  const now = data.state.now;
  const step = planStep(data, area, to, now);
  if (typeof step === 'string') return step;
  const time = db.batch(() => {
    const result = advanceTime(db, now + step.minutes);
    db.patch('areas', areaId, { hexes: step.area.hexes, party: step.area.party });
    return result;
  });
  return {
    step,
    time,
    undo: () =>
      db.batch(() => {
        // Nur zurücknehmen, wenn seither nichts anderes die Zeit bewegt hat.
        const current = db.getSnapshot();
        if (current.state.now === time.to && current.state.previousNow === time.from)
          undoTimeAdvance(db);
        if (current.areas[areaId])
          db.patch('areas', areaId, { hexes: area.hexes, party: area.party });
      }),
  };
}

// ── Bearbeiten: malen, Linien ziehen, anfügen, wegnehmen ───────────────────

/** Was ein Pinselstrich an einem Feld ändert. */
export type HexPaint = Partial<Pick<Hex, 'terrain' | 'regionId' | 'road' | 'river'>>;

/**
 * Malt auf Felder der Karte (ein Pinselstrich): Sie gelten danach als von Hand geändert. Gibt den
 * alten Stand der Felder zurück, damit ein ganzer Strich zurückgenommen werden kann.
 */
export function paintHexes(
  db: CampaignDb,
  areaId: string,
  coords: readonly HexCoord[],
  change: HexPaint,
): void {
  const area = db.getSnapshot().areas[areaId];
  if (!area || !coords.length) return;
  const keys = new Set(coords.map(hexKey));
  let changed = false;
  const hexes = area.hexes.map((hex) => {
    if (!keys.has(hexKey(hex))) return hex;
    const next = { ...hex, ...change, manual: true };
    if (
      next.terrain === hex.terrain &&
      next.regionId === hex.regionId &&
      next.road === hex.road &&
      next.river === hex.river &&
      hex.manual
    )
      return hex;
    changed = true;
    return next;
  });
  if (changed) db.patch('areas', areaId, { hexes });
}

/** Die Felder einer Karte wieder so, wie sie vor einem Strich waren. */
export function restoreHexes(db: CampaignDb, areaId: string, hexes: Hex[]): void {
  if (db.getSnapshot().areas[areaId]) db.patch('areas', areaId, { hexes });
}

/**
 * Fügt ein Feld am Rand an: mit dem Gelände, das unter seinen Nachbarn am häufigsten ist. Nur
 * neben einem vorhandenen Feld und nur, wo noch keins ist.
 */
export function addHex(db: CampaignDb, areaId: string, coord: HexCoord): boolean {
  const area = db.getSnapshot().areas[areaId];
  if (!area || area.hexes.some((hex) => hexKey(hex) === hexKey(coord))) return false;
  const around = hexNeighbors(coord)
    .map((n) => area.hexes.find((hex) => hexKey(hex) === hexKey(n)))
    .filter((hex): hex is Hex => !!hex);
  if (!around.length) return false;
  const count = new Map<string, number>();
  for (const hex of around)
    if (hex.terrain) count.set(hex.terrain, (count.get(hex.terrain) ?? 0) + 1);
  const terrain = ([...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) as Hex['terrain'];
  db.patch('areas', areaId, {
    hexes: [
      ...area.hexes,
      HexSchema.parse({ q: coord.q, r: coord.r, terrain, manual: true, discovered: false }),
    ],
  });
  return true;
}

/**
 * Nimmt ein Feld weg – nie das Feld von Start oder Ziel und nie das, auf dem die Gruppe steht.
 * Gibt zurück, ob es weg ist.
 */
export function removeHex(db: CampaignDb, areaId: string, coord: HexCoord): boolean {
  const area = db.getSnapshot().areas[areaId];
  if (!area) return false;
  const hex = area.hexes.find((entry) => hexKey(entry) === hexKey(coord));
  if (!hex) return false;
  if (hex.placeId && (hex.placeId === area.fromId || hex.placeId === area.toId)) return false;
  if (area.party && hexKey(area.party) === hexKey(coord)) return false;
  db.patch('areas', areaId, { hexes: area.hexes.filter((entry) => entry !== hex) });
  return true;
}

/** Die freien Plätze am Rand: wo sich ein Feld anfügen ließe. */
export function edgeSlots(area: Pick<Area, 'hexes'>): HexCoord[] {
  const taken = new Set(area.hexes.map(hexKey));
  const out = new Map<string, HexCoord>();
  for (const hex of area.hexes)
    for (const n of hexNeighbors(hex)) if (!taken.has(hexKey(n))) out.set(hexKey(n), n);
  return [...out.values()];
}
