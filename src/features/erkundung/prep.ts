/**
 * Hexkarten vorbereiten (Wunsch des Spielleiters, 17. 11.: „Wir brauchen einen Unterschied
 * zwischen Hexkarten vorbereiten und Hexkarten spielen“ – „Wir brauchen ne richtige
 * Editor-Ansicht“). Reine Rechnung für die Editor-Ansicht: mehrere Felder auf einmal ändern,
 * Rückgängig und Wiederholen über viele Schritte, und was auf der Karte schon vorbereitet ist.
 */
import { hexKey, type HexCoord } from '../../domain/hex';
import { isRock } from '../../domain/passages';
import type { Area, Hex } from '../../domain/schema';

/** Was sich an mehreren Feldern zugleich ändern lässt. */
export type ManyChange = Partial<
  Pick<
    Hex,
    | 'terrain'
    | 'kind'
    | 'landscapeId'
    | 'regionId'
    | 'road'
    | 'river'
    | 'discovered'
    | 'searched'
    | 'feature'
    | 'afar'
    | 'sign'
    | 'hidden'
    | 'prepared'
    | 'note'
  >
>;

/** Alles, was an einem Feld steht, wegnehmen – Gelände und Lage bleiben. */
export const CLEAR_CONTENT: ManyChange = {
  feature: '',
  afar: '',
  sign: '',
  hidden: '',
  prepared: '',
  note: '',
};

/** Die Felder mit der Änderung; sie gelten danach als von Hand gemacht. */
export function patchMany(
  hexes: readonly Hex[],
  coords: readonly HexCoord[],
  change: ManyChange,
): Hex[] {
  const keys = new Set(coords.map((coord) => hexKey(coord)));
  return hexes.map((hex) => (keys.has(hexKey(hex)) ? withChange(hex, change) : hex));
}

/**
 * Ein Feld mit einer Änderung, von Hand gemacht. Ändert sich das Grundgelände ohne eigene Art,
 * gilt wieder das Grundgelände selbst (eine „Wiese“ wird nicht zum „Wald“ mit Wiesen-Namen).
 */
export function withChange(hex: Hex, change: ManyChange): Hex {
  const next = { ...hex, ...change, manual: true };
  if (change.terrain !== undefined && change.kind === undefined && change.terrain !== hex.terrain)
    next.kind = null;
  // Ändert sich das Grundgelände ohne Landschaft, ist das Feld keine Landschaft mehr.
  if (
    change.terrain !== undefined &&
    change.landscapeId === undefined &&
    change.terrain !== hex.terrain
  )
    next.landscapeId = null;
  return next;
}

/** Wählt ein Feld (allein) oder nimmt es zur Auswahl dazu bzw. heraus (`add`). */
export function toggleSelection(
  current: readonly HexCoord[],
  coord: HexCoord,
  add: boolean,
): HexCoord[] {
  const key = hexKey(coord);
  if (!add) return [coord];
  return current.some((entry) => hexKey(entry) === key)
    ? current.filter((entry) => hexKey(entry) !== key)
    : [...current, coord];
}

// ── Rückgängig und Wiederholen ─────────────────────────────────────────────

/** Die Stände der Felder vor jedem Schritt (`past`) und nach jedem Zurücknehmen (`future`). */
export interface HexHistory {
  past: Hex[][];
  future: Hex[][];
}

export const EMPTY_HISTORY: HexHistory = { past: [], future: [] };
/** So viele Schritte lassen sich zurücknehmen. */
export const HISTORY_STEPS = 60;

/** Ein neuer Schritt: der Stand davor kommt auf den Stapel, Wiederholen verfällt. */
export function recordStep(history: HexHistory, before: Hex[]): HexHistory {
  return { past: [...history.past, before].slice(-HISTORY_STEPS), future: [] };
}

/** Zurücknehmen: liefert den Stand, der wieder gilt – und merkt den jetzigen zum Wiederholen. */
export function undoHistory(
  history: HexHistory,
  current: Hex[],
): { history: HexHistory; restore: Hex[] } | null {
  const restore = history.past[history.past.length - 1];
  if (!restore) return null;
  return {
    restore,
    history: { past: history.past.slice(0, -1), future: [...history.future, current] },
  };
}

/** Wiederholen: das Gegenstück zu `undoHistory`. */
export function redoHistory(
  history: HexHistory,
  current: Hex[],
): { history: HexHistory; restore: Hex[] } | null {
  const restore = history.future[history.future.length - 1];
  if (!restore) return null;
  return {
    restore,
    history: { past: [...history.past, current], future: history.future.slice(0, -1) },
  };
}

// ── Was schon vorbereitet ist ──────────────────────────────────────────────

export interface PrepRow {
  key: string;
  label: string;
  /** Die Felder dazu – zum Anzeigen auf der Karte. */
  coords: HexCoord[];
}

/**
 * Was auf der Karte steht, je Sorte mit den Feldern – Orte, von fern zu sehen, Besonderheiten,
 * Vorbereitetes, Verborgenes, Notizen, Gegenden. Nur gezählt, nie bewertet; leere Sorten fehlen.
 */
export function prepOverview(area: Pick<Area, 'hexes'>): PrepRow[] {
  const open = area.hexes.filter((hex) => !isRock(hex));
  const rows: { key: string; label: string; test: (hex: Hex) => boolean }[] = [
    { key: 'place', label: 'Orte', test: (hex) => !!hex.placeId },
    { key: 'afar', label: 'Von fern zu sehen', test: (hex) => !!hex.afar.trim() },
    { key: 'sign', label: 'Von nebenan zu merken', test: (hex) => !!hex.sign.trim() },
    { key: 'feature', label: 'Besonderheiten', test: (hex) => !!hex.feature.trim() },
    { key: 'prepared', label: 'Was dort wartet', test: (hex) => !!hex.prepared.trim() },
    { key: 'hidden', label: 'Verborgenes', test: (hex) => !!hex.hidden.trim() },
    { key: 'note', label: 'Notizen', test: (hex) => !!hex.note.trim() },
    { key: 'region', label: 'Felder mit Gegend', test: (hex) => !!hex.regionId },
    { key: 'road', label: 'Straße oder Pfad', test: (hex) => hex.road !== 'none' },
    { key: 'river', label: 'Fluss', test: (hex) => !!hex.river && hex.exits === null },
    { key: 'empty', label: 'Ganz leer', test: (hex) => isEmpty(hex) },
  ];
  return rows
    .map((row) => ({
      key: row.key,
      label: row.label,
      coords: open.filter(row.test).map(({ q, r, level }) => ({ q, r, level })),
    }))
    .filter((row) => row.coords.length > 0);
}

/** Ein Feld, an dem nichts steht – leere Felder sind gewollt, nur gezählt. */
export const isEmpty = (hex: Hex): boolean =>
  !hex.placeId &&
  !hex.feature.trim() &&
  !hex.afar.trim() &&
  !hex.sign.trim() &&
  !hex.prepared.trim() &&
  !hex.hidden.trim() &&
  !hex.note.trim();
