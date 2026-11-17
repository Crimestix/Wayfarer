/**
 * Ausgänge und Gänge auf Hexkarten (Unterreich, Wunsch des Spielleiters 17. 11.: „nicht jedes Hex
 * muss betretbar sein … ein Hex hat nur 2 Ausgänge, ein anderes alle 6“). Ein Feld mit
 * `exits: null` ist nach allen sechs Seiten offen (Oberwelt); sonst führen nur seine Ausgänge
 * hinaus, ein Feld ohne Ausgang ist Fels. Seiten 0–5 wie `HEX_DIRECTIONS`, 6 hinauf, 7 hinab.
 *
 * Zwischen zwei Feldern geht es, wenn beide die Seite zueinander offen haben – oder wenn der
 * Ausgang ein Abbruch ist (`drop`): Dann geht es nur hinunter bzw. hinüber, nicht zurück.
 */
import { HEX_DIRECTIONS, hexKey, type HexCoord } from './hex';
import type { Exit, Hex, PassageKind } from './schema';

export const DIR_UP = 6;
export const DIR_DOWN = 7;

/** Bezeichnungen für die Arten von Ausgängen. */
export const PASSAGE_LABEL: Record<PassageKind, string> = {
  open: 'Gang',
  narrow: 'Engstelle',
  climb: 'Kletterei',
  water: 'Wasser',
  hidden: 'Verborgen',
  drop: 'Abbruch',
};

/** Wie viel länger ein Schritt durch einen solchen Ausgang dauert. */
export const PASSAGE_FACTOR: Record<PassageKind, number> = {
  open: 1,
  narrow: 2,
  climb: 2,
  water: 2,
  hidden: 1,
  drop: 1,
};

/** Minuten für einen Schacht oder eine Treppe innerhalb eines Feldes, ohne Art. */
export const VERTICAL_MINUTES = 60;

/** Die Gegenseite: 0↔3, 1↔4, 2↔5, hinauf↔hinab. */
export const opposite = (dir: number): number =>
  dir === DIR_UP ? DIR_DOWN : dir === DIR_DOWN ? DIR_UP : (dir + 3) % 6;

/** Das Feld hinter einem Ausgang. */
export function across(from: HexCoord, dir: number): HexCoord {
  const level = from.level ?? 0;
  if (dir === DIR_UP) return { q: from.q, r: from.r, level: level - 1 };
  if (dir === DIR_DOWN) return { q: from.q, r: from.r, level: level + 1 };
  const d = HEX_DIRECTIONS[dir]!;
  return { q: from.q + d.q, r: from.r + d.r, level };
}

/** Schlüssel mit Ebene – auch für Koordinaten ohne `level`. */
export const cellKey = (hex: HexCoord): string => hexKey(hex);

const ALL_SIDES: Exit[] = [0, 1, 2, 3, 4, 5].map((dir) => ({ dir, kind: 'open', found: false }));

/** Die Ausgänge eines Feldes; ein Feld ohne Liste ist nach allen sechs Seiten offen. */
export const exitsOf = (hex: Pick<Hex, 'exits'>): readonly Exit[] => hex.exits ?? ALL_SIDES;

/** Fels: ein Feld, aus dem kein Ausgang führt. */
export const isRock = (hex: Pick<Hex, 'exits'>): boolean => !!hex.exits && hex.exits.length === 0;

/** Wie viele Ausgänge ein Feld hat (verborgene mitgezählt). */
export const exitCount = (hex: Pick<Hex, 'exits'>): number => exitsOf(hex).length;

/** Eine Kreuzung: drei Ausgänge oder mehr in einem Feld mit eigenen Ausgängen. */
export const isJunction = (hex: Pick<Hex, 'exits'>): boolean =>
  !!hex.exits && hex.exits.filter((exit) => exit.dir < 6).length >= 3;

export type HexIndex = ReadonlyMap<string, Hex>;

export const indexHexes = (hexes: readonly Hex[]): Map<string, Hex> =>
  new Map(hexes.map((hex) => [cellKey(hex), hex]));

export interface Passage {
  dir: number;
  kind: PassageKind;
  to: Hex;
}

/**
 * Wohin es von einem Feld aus geht. `secrets`: auch verborgene Ausgänge, die noch niemand
 * gefunden hat (für die Spielleitung beim Vorbereiten); sonst nur gefundene.
 */
export function passagesFrom(
  index: HexIndex,
  from: Hex,
  { secrets = false }: { secrets?: boolean } = {},
): Passage[] {
  const out: Passage[] = [];
  for (const exit of exitsOf(from)) {
    if (exit.kind === 'hidden' && !exit.found && !secrets) continue;
    const to = index.get(cellKey(across(from, exit.dir)));
    if (!to || isRock(to)) continue;
    const back = exitsOf(to).some((other) => other.dir === opposite(exit.dir));
    // Ein Feld ohne eigene Liste hat keine Ausgänge nach oben oder unten.
    if (!back && exit.kind !== 'drop') continue;
    out.push({ dir: exit.dir, kind: exit.kind, to });
  }
  return out;
}

/** Der Weg von einem Feld zum Nachbarn (oder darüber/darunter) – null, wenn keiner hinführt. */
export function passageBetween(
  index: HexIndex,
  from: Hex,
  to: HexCoord,
  options: { secrets?: boolean } = {},
): Passage | null {
  const key = cellKey(to);
  return passagesFrom(index, from, options).find((p) => cellKey(p.to) === key) ?? null;
}

/**
 * Öffnet (mit Art) oder schließt (null) den Durchgang zwischen einem Feld und dem hinter seiner
 * Seite `dir` – auf beiden Seiten, damit die Karte stimmig bleibt. Ein Abbruch öffnet nur die
 * eine Seite. Felder ohne eigene Liste bekommen beim Schließen eine (alle übrigen Seiten offen).
 * Gibt die neue Liste der Felder zurück.
 */
export function setPassage(
  hexes: readonly Hex[],
  at: HexCoord,
  dir: number,
  kind: PassageKind | null,
): Hex[] {
  const fromKey = cellKey(at);
  const toKey = cellKey(across(at, dir));
  const edit = (hex: Hex, side: number, open: boolean, how: PassageKind): Hex => {
    const own = [...exitsOf(hex)].filter((exit) => exit.dir !== side);
    if (!open) return { ...hex, exits: own };
    return {
      ...hex,
      exits: [...own, { dir: side, kind: how, found: false }].sort((a, b) => a.dir - b.dir),
    };
  };
  return hexes.map((hex) => {
    const key = cellKey(hex);
    if (key === fromKey) return edit(hex, dir, kind !== null, kind ?? 'open');
    if (key === toKey) {
      if (kind === 'drop') return edit(hex, opposite(dir), false, 'open');
      return edit(hex, opposite(dir), kind !== null, kind ?? 'open');
    }
    return hex;
  });
}

/** Die Seite, die von `a` zum Nachbarn `b` führt (auch hinauf/hinab) – null, wenn sie nicht angrenzen. */
export function dirTo(a: HexCoord, b: HexCoord): number | null {
  const la = a.level ?? 0;
  const lb = b.level ?? 0;
  if (a.q === b.q && a.r === b.r) return lb === la - 1 ? DIR_UP : lb === la + 1 ? DIR_DOWN : null;
  if (la !== lb) return null;
  const index = HEX_DIRECTIONS.findIndex((d) => a.q + d.q === b.q && a.r + d.r === b.r);
  return index < 0 ? null : index;
}

/** Wie viele Ebenen eine Karte hat. */
export const levelCount = (hexes: readonly Pick<Hex, 'level'>[]): number =>
  hexes.reduce((max, hex) => Math.max(max, hex.level + 1), 1);

/**
 * Der günstigste Weg zwischen zwei Feldern über die Ausgänge (Dijkstra). `cost` sagt, was ein
 * Durchgang kostet (null = nicht gangbar). Gibt die Felder ab dem ersten Schritt und die Kosten
 * zurück – null, wenn kein Weg hinführt.
 */
export function cheapestPath(
  index: HexIndex,
  from: HexCoord,
  to: HexCoord,
  cost: (passage: Passage, from: Hex) => number | null,
  options: { secrets?: boolean } = {},
): { steps: Hex[]; cost: number } | null {
  const startKey = cellKey(from);
  const goalKey = cellKey(to);
  const start = index.get(startKey);
  if (!start || !index.has(goalKey)) return null;
  const best = new Map<string, number>([[startKey, 0]]);
  const prev = new Map<string, string>();
  const heap = new MinHeap<string>();
  heap.push(startKey, 0);
  while (heap.size) {
    const { item: key, priority } = heap.pop()!;
    if (priority > (best.get(key) ?? Infinity)) continue;
    if (key === goalKey) break;
    const hex = index.get(key)!;
    for (const passage of passagesFrom(index, hex, options)) {
      const step = cost(passage, hex);
      if (step === null) continue;
      const next = cellKey(passage.to);
      const total = priority + step;
      if (total < (best.get(next) ?? Infinity)) {
        best.set(next, total);
        prev.set(next, key);
        heap.push(next, total);
      }
    }
  }
  if (!best.has(goalKey)) return null;
  const steps: Hex[] = [];
  for (let key = goalKey; key !== startKey; key = prev.get(key)!) steps.unshift(index.get(key)!);
  return { steps, cost: best.get(goalKey)! };
}

/** Ein kleiner Haufen für die Wegsuche: kleinste Priorität zuerst, bei Gleichstand der ältere. */
export class MinHeap<T> {
  private items: { item: T; priority: number; order: number }[] = [];
  private counter = 0;
  get size(): number {
    return this.items.length;
  }
  push(item: T, priority: number): void {
    const items = this.items;
    items.push({ item, priority, order: this.counter++ });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(items[i]!, items[parent]!)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }
  pop(): { item: T; priority: number } | undefined {
    const items = this.items;
    if (!items.length) return undefined;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && this.less(items[l]!, items[m]!)) m = l;
        if (r < items.length && this.less(items[r]!, items[m]!)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m]!, items[i]!];
        i = m;
      }
    }
    return { item: top.item, priority: top.priority };
  }
  private less(a: { priority: number; order: number }, b: { priority: number; order: number }) {
    return a.priority < b.priority || (a.priority === b.priority && a.order < b.order);
  }
}
