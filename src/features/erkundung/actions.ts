/** Befehle des Bereichs „Erkundung“. */
import { advanceTime, logEntry, undoTimeAdvance, type TimeAdvanceResult } from '../../data/actions';
import { markSighted } from '../../domain/afar';
import type { CampaignDb } from '../../data/db';
import { hexKey, hexNeighbors, sameHex, type HexCoord } from '../../domain/hex';
import { DIR_DOWN, across, dirTo, exitsOf, isRock, setPassage } from '../../domain/passages';
import type { PassageKind } from '../../domain/schema';
import { freshSeed } from '../../domain/random';
import {
  HexSchema,
  type Area,
  type CampaignData,
  type Hex,
  type Pace,
  type Place,
} from '../../domain/schema';
import { placeAncestors, placeSubtreeIds } from '../../domain/derive';
import { dayIndexOf } from '../../domain/time/calendar';
import { SIX_MILES_KM, generateHexes, groundOf, recognize, type GenerateInput } from './generate';
import {
  planSearch,
  planStep,
  seenFrom,
  type SearchPlan,
  type StepProblem,
  type TravelStep,
} from './travel';

/** Ändert ein Feld einer Karte; fehlt die Karte oder das Feld, geschieht nichts. */
export function patchHex(
  db: CampaignDb,
  areaId: string,
  coord: HexCoord,
  change: Partial<Omit<Hex, 'q' | 'r'>>,
): void {
  const area = db.getSnapshot().areas[areaId];
  if (!area) return;
  let found = false;
  const hexes = area.hexes.map((hex) => {
    if (!sameHex(hex, coord)) return hex;
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
    hexKm: area.biome === 'underdark' ? SIX_MILES_KM : area.hexKm,
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
  hex.afar.trim() !== '' ||
  hex.hidden.trim() !== '' ||
  hex.sign.trim() !== '' ||
  hex.tableIds.length > 0;

/**
 * Würfelt das Gelände einer erzeugten Karte neu. Name und Notizen bleiben; was der Spielleiter an
 * Feldern von Hand gemacht hat (gemalt, Gegend, Straße, Vorbereitetes, Notiz, von fern zu sehen,
 * verborgen), bleibt, wie es ist.
 * Felder, die er angefügt hat, bleiben auch. `undo` stellt den alten Stand wieder her.
 */
export function rerollArea(db: CampaignDb, areaId: string): (() => void) | null {
  const area = db.getSnapshot().areas[areaId];
  const base = area ? rerollInput(db, area) : null;
  if (!area || !base) return null;
  // Orte, die schon auf der Karte stehen, bleiben dort – unter der Erde mit Gängen dorthin.
  const input = {
    ...base,
    pinned: area.hexes.flatMap((hex) =>
      hex.placeId && hex.level === 0 ? [{ q: hex.q, r: hex.r, placeId: hex.placeId }] : [],
    ),
  };
  const fresh = generateHexes(input).hexes;
  // Unter der Erde entsteht das Gangnetz neu; was an Feldern eingetragen ist, bleibt am selben Feld,
  // und Gänge, Fels und Schächte, die der Spielleiter selbst gesetzt hat, bleiben auch.
  if (fresh.some((hex) => hex.exits !== null)) {
    const old = new Map(area.hexes.map((hex) => [hexKey(hex), hex]));
    const placed = new Set(fresh.flatMap((hex) => (hex.placeId ? [hex.placeId] : [])));
    const dug = (hex: Hex) => hex.dug && hex.exits !== null;
    let hexes = fresh.map((hex) => {
      const before = old.get(hexKey(hex));
      if (!before) return hex;
      const keepPlace = !hex.placeId && before.placeId && !placed.has(before.placeId);
      if (keepPlace) placed.add(before.placeId!);
      return {
        ...hex,
        placeId: hex.placeId ?? (keepPlace ? before.placeId : null),
        prepared: before.prepared,
        note: before.note,
        sign: before.sign,
        afar: before.afar,
        sighted: before.sighted,
        hidden: before.hidden,
        searched: before.searched,
        tableIds: before.tableIds,
        regionId: before.regionId,
        feature: before.manual && before.feature ? before.feature : hex.feature,
        manual: before.manual,
        dug: before.dug,
      };
    });
    // Von Hand Gegrabenes und Zugemauertes setzen, auf beiden Seiten.
    for (const before of area.hexes.filter(dug)) {
      if (!hexes.some((hex) => sameHex(hex, before))) continue;
      const own = new Set(before.exits!.map((exit) => exit.dir));
      for (let dir = 0; dir < 8; dir++)
        if (!own.has(dir)) hexes = setPassage(hexes, before, dir, null);
      for (const exit of before.exits!) hexes = setPassage(hexes, before, exit.dir, exit.kind);
    }
    db.patch('areas', areaId, { hexes, seed: input.seed, hexKm: input.hexKm, party: null });
    return () => {
      if (db.getSnapshot().areas[areaId])
        db.patch('areas', areaId, {
          hexes: area.hexes,
          seed: area.seed,
          hexKm: area.hexKm,
          party: area.party,
        });
    };
  }
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
  const here = area.hexes.find((hex) => sameHex(hex, coord));
  if (!here || isRock(here)) return;
  const seen = new Set([hexKey(here), ...seenFrom(db.getSnapshot(), area, here)]);
  db.patch('areas', areaId, {
    hexes: markSighted(
      area.hexes.map((hex) =>
        hex.discovered || !seen.has(hexKey(hex)) ? hex : { ...hex, discovered: true },
      ),
      [here],
    ),
    party: {
      q: coord.q,
      r: coord.r,
      level: here.level,
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

export interface SearchResult {
  search: SearchPlan;
  time: TimeAdvanceResult;
  undo: () => void;
}

/**
 * Die Gruppe durchsucht ihr Feld: Die Zeit vergeht (so lange wie das Durchqueren), das Feld gilt
 * als durchsucht, und was verborgen lag, steht danach in der Chronik. Gibt null zurück, wenn es
 * nicht geht (keine Gruppe auf der Karte, Wasser).
 */
export function searchHex(db: CampaignDb, areaId: string): SearchResult | null {
  const data = db.getSnapshot();
  const area = data.areas[areaId];
  if (!area) return null;
  const now = data.state.now;
  const search = planSearch(data, area, now);
  if (!search) return null;
  return db.batch(() => {
    const time = advanceTime(db, now + search.minutes);
    db.patch('areas', areaId, {
      hexes: area.hexes.map((hex) => (sameHex(hex, search.hex) ? { ...hex, searched: true } : hex)),
    });
    const line = search.found
      ? logEntry(db, {
          text: `Beim Durchsuchen gefunden: ${search.found}`,
          refs: search.hex.placeId ? [search.hex.placeId] : [],
        })
      : null;
    return {
      search,
      time,
      undo: () =>
        db.batch(() => {
          const current = db.getSnapshot();
          if (line && current.chronicle[line.id]) db.remove('chronicle', line.id);
          if (current.state.now === time.to && current.state.previousNow === time.from)
            undoTimeAdvance(db);
          if (current.areas[areaId]) db.patch('areas', areaId, { hexes: area.hexes });
        }),
    };
  });
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

// ── Orte aus der Welt ──────────────────────────────────────────────────────

/**
 * Orte, die auf diese Karte gehören könnten und noch auf keinem Feld stehen: was in den Gegenden
 * von Start und Ziel liegt (die Orte darüber und alles darunter) – die Nachbarn von Start und Ziel
 * zuerst. Räume zählen nicht. Unter der Erde haben die meisten Orte keine Lage; dann setzt der
 * Spielleiter sie mit dem Werkzeug „Ort“ selbst.
 */
export function placeSuggestions(data: CampaignData, area: Area): Place[] {
  if (!area.fromId || !area.toId) return [];
  const onMap = new Set(area.hexes.flatMap((hex) => (hex.placeId ? [hex.placeId] : [])));
  const ends = [area.fromId, area.toId];
  const parents = new Set(
    ends.map((id) =>
      data.entities[id]?.kind === 'place' ? (data.entities[id] as Place).place.parentId : null,
    ),
  );
  const roots = new Set<string>();
  for (const id of ends) {
    roots.add(id);
    // Höchstens zwei Ebenen hinauf – sonst stünde die ganze Welt zur Wahl.
    for (const place of placeAncestors(data, id).slice(0, 2)) roots.add(place.id);
  }
  const ids = new Set<string>();
  for (const root of roots) for (const id of placeSubtreeIds(data, root)) ids.add(id);
  return [...ids]
    .map((id) => data.entities[id])
    .filter(
      (entity): entity is Place =>
        entity?.kind === 'place' &&
        !entity.place.room &&
        !onMap.has(entity.id) &&
        !ends.includes(entity.id),
    )
    .sort(
      (a, b) =>
        Number(parents.has(b.place.parentId)) - Number(parents.has(a.place.parentId)) ||
        a.name.localeCompare(b.name, 'de'),
    )
    .slice(0, 40);
}

/**
 * Setzt Orte mit einer Lage in der Welt auf ihr Feld – so, wie die Karte sie beim Erzeugen
 * gesetzt hätte. Felder, auf denen schon ein Ort steht, bleiben. Gibt zurück, wie viele es waren,
 * und `undo`.
 */
export function placeWorldPlaces(
  db: CampaignDb,
  areaId: string,
): { added: number; undo: () => void } | null {
  const area = db.getSnapshot().areas[areaId];
  const input = area && area.seed !== null ? rerollInput(db, area, area.seed) : null;
  if (!area || !input) return null;
  const fresh = new Map(
    generateHexes(input)
      .hexes.filter((hex) => hex.placeId)
      .map((hex) => [hexKey(hex), hex.placeId!]),
  );
  const onMap = new Set(area.hexes.flatMap((hex) => (hex.placeId ? [hex.placeId] : [])));
  let added = 0;
  const hexes = area.hexes.map((hex) => {
    const placeId = fresh.get(hexKey(hex));
    if (!placeId || hex.placeId || onMap.has(placeId)) return hex;
    added++;
    onMap.add(placeId);
    return { ...hex, placeId };
  });
  if (added) db.patch('areas', areaId, { hexes });
  return { added, undo: () => restoreHexes(db, areaId, area.hexes) };
}

// ── Gänge unter der Erde ───────────────────────────────────────────────────

/** Markiert die Felder, deren Ausgänge sich geändert haben, als von Hand gemacht. */
function markManual(before: readonly Hex[], after: Hex[]): Hex[] {
  return after.map((hex, i) => (hex === before[i] ? hex : { ...hex, manual: true, dug: true }));
}

/**
 * Gang ziehen: öffnet den Durchgang zwischen zwei angrenzenden Feldern derselben Ebene (oder
 * übereinander) mit seiner Art. Fels wird dabei zum Gang. Gibt zurück, ob sich etwas geändert hat.
 */
export function digBetween(
  db: CampaignDb,
  areaId: string,
  a: HexCoord,
  b: HexCoord,
  kind: PassageKind,
): boolean {
  const area = db.getSnapshot().areas[areaId];
  if (!area) return false;
  const dir = dirTo(a, b);
  const from = area.hexes.find((hex) => sameHex(hex, a));
  if (dir === null || !from || !area.hexes.some((hex) => sameHex(hex, b))) return false;
  if (exitsOf(from).some((exit) => exit.dir === dir && exit.kind === kind)) return false;
  db.patch('areas', areaId, {
    hexes: markManual(area.hexes, setPassage(area.hexes, from, dir, kind)),
  });
  return true;
}

/** Fels: schließt alle Ausgänge eines Feldes – auch die der Nachbarn zu ihm hin. */
export function fillRock(db: CampaignDb, areaId: string, at: HexCoord): boolean {
  const area = db.getSnapshot().areas[areaId];
  const hex = area?.hexes.find((entry) => sameHex(entry, at));
  if (!area || !hex || isRock(hex)) return false;
  // Nie das Feld eines Ortes oder der Gruppe zumauern.
  if (hex.placeId || (area.party && sameHex(area.party, hex))) return false;
  let hexes = area.hexes;
  for (const exit of exitsOf(hex)) hexes = setPassage(hexes, hex, exit.dir, null);
  // Nachbarn, die nur einseitig hierher führten (Abbruch), verlieren den Ausgang auch.
  hexes = hexes.map((entry) => {
    const back = entry.exits?.filter((exit) => !sameHex(across(entry, exit.dir), hex));
    return back && back.length !== entry.exits!.length ? { ...entry, exits: back } : entry;
  });
  hexes = hexes.map((entry) => (sameHex(entry, hex) ? { ...entry, exits: [] } : entry));
  db.patch('areas', areaId, { hexes: markManual(area.hexes, hexes) });
  return true;
}

/**
 * Schacht: öffnet oder schließt den Weg hinab zum selben Feld der Ebene darunter. Gibt zurück, ob
 * er jetzt offen ist – null, wenn es darunter kein Feld gibt.
 */
export function toggleShaft(db: CampaignDb, areaId: string, at: HexCoord): boolean | null {
  const area = db.getSnapshot().areas[areaId];
  const hex = area?.hexes.find((entry) => sameHex(entry, at));
  if (!area || !hex) return null;
  if (!area.hexes.some((entry) => sameHex(entry, across(hex, DIR_DOWN)))) return null;
  const open = exitsOf(hex).some((exit) => exit.dir === DIR_DOWN);
  db.patch('areas', areaId, {
    hexes: markManual(area.hexes, setPassage(area.hexes, hex, DIR_DOWN, open ? null : 'climb')),
  });
  return !open;
}
