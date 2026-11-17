/**
 * Der Erzeuger für Höhlennetze – zuerst fürs Unterreich, gedacht auch für Verliese
 * (Wunsch des Spielleiters, 17. 11.: „Es muss interessant werden. Wir brauchen einen starken
 * Generator.“). Er arbeitet nach den Gedanken des Jaquaying: nie nur ein Weg.
 *
 * Ablauf, für jede Ebene:
 * 1. Knoten setzen – Start, Ziel und Orte am Weg, dazu gleichmäßig verteilte Höhlen und
 *    Kreuzungen; auf tieferen Ebenen zuerst die Stellen der Schächte von oben.
 * 2. Verbinden – ein Netz, in dem jeder Knoten nur seine natürlichen Nachbarn kennt
 *    (keine Gänge quer über andere hinweg); erst das Nötigste, damit alles erreichbar ist, dann
 *    gut die Hälfte der übrigen Verbindungen: daraus werden Schleifen.
 * 3. Graben – jeder Verbindung folgt ein gewundener Gang Feld für Feld; wo sich Gänge treffen,
 *    entstehen von selbst Kreuzungen. Manche Gänge haben eine Engstelle, Kletterei oder Wasser.
 * 4. Höhlen bekommen weitere Ausgänge (vier bis sechs), Gänge kurze Sackgassen.
 * 5. Schächte verbinden die Ebenen an Stellen, die sich nicht decken – einer immer in beide
 *    Richtungen, ein anderer manchmal als Abbruch nur hinab.
 * 6. Ein unterirdischer Fluss quert die Karte durch eine Höhle; ein, zwei verborgene Gänge sitzen
 *    dort, wo sie den Weg am meisten verkürzen, und manche Sackgasse liegt hinter einem.
 * 7. Prüfen – mindestens zwei getrennte Wege von Start zum Ziel und Schleifen; sonst wird mit dem
 *    nächsten Ausgangswert neu gegraben (bis zu sechsmal), am Ende gilt der beste Versuch.
 *
 * Alles nach festen Regeln mit `rngOf(seedOf(…))`: gleicher Ausgangswert, gleiches Netz.
 * Erzeugt wird nur die Gestalt (Gänge, Höhlen, Schächte, Sackgassen) – was dort liegt, schreibt
 * der Spielleiter oder würfeln seine Tabellen.
 */
import { hexCenter, hexDistance, hexKey, hexNeighbors, type HexCoord } from './hex';
import { DIR_DOWN, DIR_UP, MinHeap, dirTo, opposite } from './passages';
import { rngOf, seedOf, smoothNoise, type Rng } from './random';
import type { Exit, PassageKind } from './schema';

export type CaveRole = 'rock' | 'tunnel' | 'junction' | 'cave' | 'deadend' | 'place';

export interface CaveCell {
  q: number;
  r: number;
  level: number;
  exits: Exit[];
  role: CaveRole;
  river: boolean;
}

export interface CaveInput {
  /** Die Fläche einer Ebene; alle Ebenen haben dieselbe. */
  cells: readonly HexCoord[];
  start: HexCoord;
  goal: HexCoord;
  /** Wie viele Ebenen (1–4). Start und Ziel liegen auf der obersten. */
  levels: number;
  seed: number;
  /** Felder, auf denen Orte stehen: Sie werden Knoten der obersten Ebene. */
  fixed?: readonly HexCoord[];
  /** Fluss: ja, nein, oder der Erzeuger entscheidet (undefined). */
  river?: boolean;
}

export interface CaveQuality {
  /** Getrennte Wege vom Start zum Ziel (ohne verborgene Gänge), höchstens drei gezählt. */
  routes: number;
  /** Schleifen im Netz. */
  loops: number;
  /** Höhlen mit fünf oder sechs Ausgängen. */
  bigCaves: number;
  /** Felder mit drei Ausgängen oder mehr. */
  junctions: number;
  deadEnds: number;
  secrets: number;
  /** Ebenen, die vom Start aus erreichbar sind. */
  levelsUsed: number;
}

export interface CaveResult {
  cells: CaveCell[];
  quality: CaveQuality;
  /** Der Versuch, der gilt (0 = der erste). */
  attempt: number;
}

interface Cell {
  q: number;
  r: number;
  level: number;
  exits: Map<number, PassageKind>;
  role: CaveRole;
  river: boolean;
}

const ATTEMPTS = 6;

const keyOf = (c: HexCoord, level: number) => hexKey({ q: c.q, r: c.r, level });

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Ein Netz auf Ebenen – der Zustand während des Grabens. */
class Net {
  readonly cells = new Map<string, Cell>();
  readonly footprint: HexCoord[];
  constructor(
    footprint: readonly HexCoord[],
    readonly levels: number,
  ) {
    this.footprint = [...footprint];
    for (let level = 0; level < levels; level++)
      for (const c of footprint)
        this.cells.set(keyOf(c, level), {
          q: c.q,
          r: c.r,
          level,
          exits: new Map(),
          role: 'rock',
          river: false,
        });
  }
  at(c: HexCoord, level = c.level ?? 0): Cell | undefined {
    return this.cells.get(keyOf(c, level));
  }
  carved(cell: Cell): boolean {
    return cell.exits.size > 0 || cell.role !== 'rock';
  }
  /** Öffnet den Durchgang zwischen zwei angrenzenden Feldern; Vorhandenes bleibt. */
  open(a: Cell, b: Cell, kind: PassageKind = 'open'): void {
    const dir = dirTo(a, b);
    if (dir === null) return;
    if (!a.exits.has(dir)) a.exits.set(dir, kind);
    if (kind !== 'drop' && !b.exits.has(opposite(dir))) b.exits.set(opposite(dir), kind);
    if (a.role === 'rock') a.role = 'tunnel';
    if (b.role === 'rock') b.role = 'tunnel';
  }
  connected(a: Cell, b: Cell): boolean {
    const dir = dirTo(a, b);
    return dir !== null && a.exits.has(dir);
  }
  neighbours(cell: Cell): Cell[] {
    return hexNeighbors(cell)
      .map((n) => this.at(n, cell.level))
      .filter((n): n is Cell => !!n);
  }
  /** Wohin es von einem Feld aus geht; `secrets` = auch über verborgene Gänge. */
  moves(cell: Cell, secrets: boolean): Cell[] {
    const out: Cell[] = [];
    for (const [dir, kind] of cell.exits) {
      if (kind === 'hidden' && !secrets) continue;
      const level =
        dir === DIR_UP ? cell.level - 1 : dir === DIR_DOWN ? cell.level + 1 : cell.level;
      const target = dir >= 6 ? this.at(cell, level) : this.at(hexNeighbors(cell)[dir]!, level);
      if (!target) continue;
      if (kind !== 'drop' && !target.exits.has(opposite(dir))) continue;
      out.push(target);
    }
    return out;
  }
}

// ── Knoten ─────────────────────────────────────────────────────────────────

/** Gleichmäßig verteilte Knoten: jeder mindestens `gap` Felder von den anderen entfernt. */
function placeHubs(
  rng: Rng,
  footprint: readonly HexCoord[],
  forced: readonly HexCoord[],
  count: number,
  gap: number,
): HexCoord[] {
  const hubs = [...forced];
  for (const c of shuffle(rng, footprint)) {
    if (hubs.length >= count + forced.length) break;
    if (hubs.every((h) => hexDistance(h, c) >= gap)) hubs.push(c);
  }
  return hubs;
}

/**
 * Die natürlichen Nachbarn unter den Knoten (Netz der relativen Nachbarschaft): a und b sind
 * verbunden, wenn kein dritter Knoten näher an beiden liegt. So kreuzen sich Gänge selten.
 */
function neighbourPairs(hubs: readonly HexCoord[], maxLink: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let a = 0; a < hubs.length; a++)
    for (let b = a + 1; b < hubs.length; b++) {
      const d = hexDistance(hubs[a]!, hubs[b]!);
      if (d > maxLink) continue;
      let blocked = false;
      for (let c = 0; c < hubs.length && !blocked; c++) {
        if (c === a || c === b) continue;
        if (Math.max(hexDistance(hubs[a]!, hubs[c]!), hexDistance(hubs[b]!, hubs[c]!)) < d)
          blocked = true;
      }
      if (!blocked) out.push([a, b, d]);
    }
  return out;
}

/** Welche Knoten verbunden werden: erst alles erreichbar (Baum), dann Schleifen. */
function linkHubs(
  rng: Rng,
  hubs: readonly HexCoord[],
  maxLink: number,
  loopShare: number,
  /** Knoten, die mindestens zwei Verbindungen brauchen (Start, Ziel): nie nur ein Gang hinein. */
  twice: readonly number[] = [],
) {
  const pairs = neighbourPairs(hubs, maxLink).map(
    ([a, b, d]) => [a, b, d + rng.next() * 0.9] as [number, number, number],
  );
  const parent = hubs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const tree: [number, number][] = [];
  const rest: [number, number][] = [];
  for (const [a, b] of [...pairs].sort((x, y) => x[2] - y[2])) {
    if (find(a) !== find(b)) {
      parent[find(a)] = find(b);
      tree.push([a, b]);
    } else rest.push([a, b]);
  }
  // Teile, die nichts verbindet (zu weit auseinander): den nächsten Knoten nehmen.
  for (let guard = 0; guard < hubs.length; guard++) {
    const roots = new Set(hubs.map((_, i) => find(i)));
    if (roots.size <= 1) break;
    let best: [number, number, number] | null = null;
    for (let a = 0; a < hubs.length; a++)
      for (let b = 0; b < hubs.length; b++)
        if (find(a) !== find(b)) {
          const d = hexDistance(hubs[a]!, hubs[b]!);
          if (!best || d < best[2]) best = [a, b, d];
        }
    if (!best) break;
    parent[find(best[0])] = find(best[1]);
    tree.push([best[0], best[1]]);
  }
  const links = [...tree, ...rest.filter(() => rng.chance(loopShare))];
  const has = (a: number, b: number) =>
    links.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  for (const hub of twice) {
    const degree = () => links.filter(([x, y]) => x === hub || y === hub).length;
    const others = hubs
      .map((_, i) => i)
      .filter((i) => i !== hub)
      .sort((a, b) => hexDistance(hubs[hub]!, hubs[a]!) - hexDistance(hubs[hub]!, hubs[b]!));
    for (const other of others) {
      if (degree() >= 2) break;
      if (!has(hub, other)) links.push([hub, other]);
    }
  }
  return links;
}

// ── Graben ─────────────────────────────────────────────────────────────────

/** Ein gewundener Weg von a nach b auf einer Ebene; vorhandene Gänge sind etwas billiger. */
function digPath(
  net: Net,
  a: Cell,
  b: Cell,
  seed: number,
  avoid: ReadonlySet<string>,
  /** Felder, durch die der Gang nie führt. */
  forbid: ReadonlySet<string> = new Set(),
): Cell[] {
  const level = a.level;
  const noise = (c: Cell) => {
    const { x, y } = hexCenter(c);
    return smoothNoise(seedOf(seed, 'gang', level), x / 2.2, y / 2.2);
  };
  const start = keyOf(a, level);
  const goal = keyOf(b, level);
  const best = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, string>();
  const heap = new MinHeap<string>();
  heap.push(start, 0);
  while (heap.size) {
    const { item: key, priority } = heap.pop()!;
    const cost = best.get(key)!;
    if (priority - hexDistance(net.cells.get(key)!, b) > cost + 1e-9) continue;
    if (key === goal) break;
    const cell = net.cells.get(key)!;
    for (const next of net.neighbours(cell)) {
      const nk = keyOf(next, level);
      if (forbid.has(nk)) continue;
      let step = 1 + 2.4 * noise(next);
      if (net.carved(next)) step *= 0.75;
      if (avoid.has(nk) && nk !== goal) step += 4;
      const total = cost + step;
      if (total < (best.get(nk) ?? Infinity)) {
        best.set(nk, total);
        prev.set(nk, key);
        heap.push(nk, total + hexDistance(next, b));
      }
    }
  }
  if (!best.has(goal)) return [];
  const path: Cell[] = [];
  for (let key = goal; key !== start; key = prev.get(key)!) path.unshift(net.cells.get(key)!);
  path.unshift(a);
  return path;
}

/** Gräbt einen Gang entlang eines Weges; manchmal mit einer Stelle, die schwerer ist. */
function dig(net: Net, rng: Rng, path: readonly Cell[]): void {
  const special =
    path.length > 2 && rng.chance(0.42)
      ? {
          at: rng.int(1, path.length - 1),
          kind: rng.weighted<PassageKind>(['narrow', 'climb', 'water'], (k) =>
            k === 'narrow' ? 5 : k === 'climb' ? 3 : 2,
          )!,
        }
      : null;
  for (let i = 1; i < path.length; i++)
    net.open(path[i - 1]!, path[i]!, special?.at === i ? special.kind : 'open');
}

/** Eine kurze Sackgasse von einem Feld aus in den Fels – nur durch Fels, ohne andere Gänge zu berühren. */
function spur(
  net: Net,
  rng: Rng,
  from: Cell,
  length: number,
  kind: PassageKind = 'open',
): Cell | null {
  let here = from;
  let made: Cell | null = null;
  for (let i = 0; i < length; i++) {
    const options = net
      .neighbours(here)
      .filter(
        (n) => !net.carved(n) && net.neighbours(n).every((m) => m === here || !net.carved(m)),
      );
    const next = rng.pick(options);
    if (!next) break;
    net.open(here, next, i === 0 ? kind : 'open');
    here = next;
    made = next;
  }
  if (made) made.role = 'deadend';
  return made;
}

/** Verbindet ein frisch gegrabenes Feld mit dem nächsten Gang in der Nähe (nicht über `not`). */
function joinNearby(net: Net, rng: Rng, from: Cell, not: Cell, seed: number): boolean {
  const near = [...net.cells.values()]
    .filter(
      (c) =>
        c.level === from.level &&
        c !== not &&
        c !== from &&
        net.carved(c) &&
        hexDistance(c, from) >= 2 &&
        hexDistance(c, from) <= 3 &&
        hexDistance(c, not) >= 2,
    )
    .sort((a, b) => hexDistance(a, from) - hexDistance(b, from));
  const target = rng.pick(near.slice(0, 3));
  if (!target) return false;
  const path = digPath(net, from, target, seed, new Set(), new Set([keyOf(not, not.level)]));
  if (path.length < 2) return false;
  dig(net, rng, path);
  return true;
}

/**
 * Ein Ort mit nur einem Ausgang wäre eine Engstelle für alles: Er bekommt einen zweiten Gang
 * zu einem anderen Knoten, der auf einer anderen Seite hinausführt.
 */
function twoWays(net: Net, rng: Rng, place: Cell, hubs: readonly Cell[], seed: number): void {
  const sides = () => [...place.exits.keys()].filter((d) => d < 6).length;
  for (let guard = 0; guard < 3 && sides() < 2; guard++) {
    const free = net.neighbours(place).filter((n) => !net.connected(place, n));
    const carved = free.find((n) => net.carved(n));
    if (carved) {
      net.open(place, carved);
      continue;
    }
    const n = rng.pick(free);
    if (!n) return;
    const target = [...hubs]
      .filter((h) => h !== place)
      .sort((a, b) => hexDistance(a, n) - hexDistance(b, n))[0];
    if (!target) return;
    net.open(place, n);
    const own = keyOf(place, 0);
    dig(net, rng, digPath(net, n, target, seedOf(seed, 'zweiter'), new Set(), new Set([own])));
  }
}

/** Der kürzeste Weg (in Schritten) ohne verborgene Gänge; `cut` ist ein gesperrter Durchgang. */
function shortest(net: Net, from: Cell, to: Cell, cut?: [Cell, Cell]): Cell[] | null {
  const prev = new Map<Cell, Cell>([[from, from]]);
  const queue = [from];
  while (queue.length && !prev.has(to)) {
    const here = queue.shift()!;
    for (const next of net.moves(here, false)) {
      if (cut && ((here === cut[0] && next === cut[1]) || (here === cut[1] && next === cut[0])))
        continue;
      if (!prev.has(next)) {
        prev.set(next, here);
        queue.push(next);
      }
    }
  }
  if (!prev.has(to)) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0]!)!);
  return path;
}

/**
 * Jaquaying: Hängt der Weg zum Ziel an einem einzigen Durchgang (sperrt man ihn, kommt niemand
 * mehr durch), gräbt der Erzeuger einen Umweg darum herum – vom Weg ein Stück davor zu einem
 * Stück danach, ohne die Stelle selbst zu berühren.
 */
function bypassBridges(net: Net, start: Cell, goal: Cell, seed: number): void {
  for (let round = 0; round < 6; round++) {
    const path = shortest(net, start, goal);
    if (!path) return;
    let fixed = false;
    for (let i = 0; i + 1 < path.length && !fixed; i++) {
      if (shortest(net, start, goal, [path[i]!, path[i + 1]!])) continue;
      // Ein Stück davor und danach auf derselben Ebene.
      for (let reach = 3; reach <= 6 && !fixed; reach++) {
        const from = path[Math.max(0, i - reach + 2)]!;
        const to = path[Math.min(path.length - 1, i + reach)]!;
        if (from.level !== to.level || from === to) continue;
        const inner = path.slice(path.indexOf(from) + 1, path.indexOf(to));
        const bypass = digPath(
          net,
          from,
          to,
          seedOf(seed, 'umweg', round, reach),
          new Set(),
          new Set(inner.map((c) => keyOf(c, c.level))),
        );
        if (bypass.length < 2) continue;
        for (let k = 1; k < bypass.length; k++) net.open(bypass[k - 1]!, bypass[k]!);
        fixed = true;
      }
      if (!fixed) return;
    }
    if (!fixed) return;
  }
}

// ── Prüfen ─────────────────────────────────────────────────────────────────

/** Wie viele Wege ohne gemeinsamen Gang vom Start zum Ziel führen (höchstens `cap`). */
function separateRoutes(net: Net, start: Cell, goal: Cell, cap: number): number {
  const id = (c: Cell) => keyOf(c, c.level);
  // Gerichtete Kanten mit Kapazität 1; Fluss über Restkanten.
  const capacity = new Map<string, number>();
  const edge = (a: string, b: string) => `${a}>${b}`;
  const adjacency = new Map<string, string[]>();
  for (const cell of net.cells.values())
    for (const to of net.moves(cell, false)) {
      const a = id(cell);
      const b = id(to);
      capacity.set(edge(a, b), 1);
      if (!capacity.has(edge(b, a))) capacity.set(edge(b, a), 0);
      adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
      adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
    }
  const s = id(start);
  const t = id(goal);
  let flow = 0;
  while (flow < cap) {
    const prev = new Map<string, string>([[s, s]]);
    const queue = [s];
    while (queue.length && !prev.has(t)) {
      const here = queue.shift()!;
      for (const next of adjacency.get(here) ?? [])
        if (!prev.has(next) && (capacity.get(edge(here, next)) ?? 0) > 0) {
          prev.set(next, here);
          queue.push(next);
        }
    }
    if (!prev.has(t)) break;
    for (let v = t; v !== s; v = prev.get(v)!) {
      const u = prev.get(v)!;
      capacity.set(edge(u, v), capacity.get(edge(u, v))! - 1);
      capacity.set(edge(v, u), (capacity.get(edge(v, u)) ?? 0) + 1);
    }
    flow++;
  }
  return flow;
}

/** Schritte vom Start zu jedem erreichbaren Feld. */
function distances(net: Net, from: Cell, secrets: boolean): Map<Cell, number> {
  const out = new Map<Cell, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const here = queue.shift()!;
    for (const next of net.moves(here, secrets))
      if (!out.has(next)) {
        out.set(next, out.get(here)! + 1);
        queue.push(next);
      }
  }
  return out;
}

function measure(net: Net, start: Cell, goal: Cell): CaveQuality {
  const carved = [...net.cells.values()].filter((c) => net.carved(c));
  // Durchgänge ohne Richtung: jeder zählt einmal, auch ein Abbruch.
  const links = new Map<Cell, Set<Cell>>(carved.map((c) => [c, new Set<Cell>()]));
  let secrets = 0;
  for (const cell of carved)
    for (const to of net.moves(cell, true)) {
      links.get(cell)?.add(to);
      links.get(to)?.add(cell);
    }
  for (const cell of carved)
    for (const kind of cell.exits.values()) if (kind === 'hidden') secrets += 0.5;
  let edges = 0;
  for (const set of links.values()) edges += set.size;
  edges /= 2;
  const seen = new Set<Cell>();
  let parts = 0;
  for (const cell of carved) {
    if (seen.has(cell)) continue;
    parts++;
    const stack = [cell];
    seen.add(cell);
    while (stack.length)
      for (const next of links.get(stack.pop()!) ?? [])
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
  }
  const reach = distances(net, start, true);
  return {
    routes: separateRoutes(net, start, goal, 3),
    loops: Math.max(0, Math.round(edges) - carved.length + parts),
    bigCaves: carved.filter((c) => [...c.exits.keys()].filter((d) => d < 6).length >= 5).length,
    junctions: carved.filter((c) => [...c.exits.keys()].filter((d) => d < 6).length >= 3).length,
    deadEnds: carved.filter((c) => c.role === 'deadend').length,
    secrets: Math.round(secrets),
    levelsUsed: new Set([...reach.keys()].map((c) => c.level)).size,
  };
}

const score = (q: CaveQuality) =>
  (q.routes >= 2 ? 100 : 0) +
  Math.min(q.routes, 3) * 10 +
  Math.min(q.loops, 6) * 3 +
  Math.min(q.bigCaves, 3) * 4 +
  Math.min(q.junctions, 8) +
  q.levelsUsed * 5;

// ── Ein Versuch ────────────────────────────────────────────────────────────

function attempt(input: CaveInput, seed: number): { net: Net; quality: CaveQuality } {
  const rng = rngOf(seedOf(seed, 'hoehlen'));
  const levels = Math.max(1, Math.min(4, Math.round(input.levels)));
  const net = new Net(input.cells, levels);
  const n = input.cells.length;
  const gap = n < 40 ? 2 : 3;
  const count = Math.max(2, Math.min(40, Math.round(n / 15)));
  const start = net.at(input.start, 0)!;
  const goal = net.at(input.goal, 0)!;
  const fixed = [input.start, input.goal, ...(input.fixed ?? [])].filter(
    (c, i, all) => all.findIndex((o) => o.q === c.q && o.r === c.r) === i,
  );
  // Lage entlang des Weges: 0 am Start, 1 am Ziel.
  const along = (c: HexCoord) => {
    const a = hexCenter(input.start);
    const b = hexCenter(input.goal);
    const p = hexCenter(c);
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
    return ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2;
  };

  const hubsByLevel: Cell[][] = [];
  const shafts: { cell: HexCoord; level: number; kind: PassageKind }[] = [];
  for (let level = 0; level < levels; level++) {
    const forced: HexCoord[] =
      level === 0 ? fixed : shafts.filter((s) => s.level === level - 1).map((s) => s.cell);
    const hubs = placeHubs(
      rng,
      input.cells,
      forced,
      Math.round(count * (level === 0 ? 1 : 0.75)),
      gap,
    ).map((c) => net.at(c, level)!);
    hubsByLevel.push(hubs);
    for (const hub of hubs)
      hub.role =
        level === 0 && fixed.some((f) => f.q === hub.q && f.r === hub.r)
          ? 'place'
          : rng.chance(0.4)
            ? 'cave'
            : 'junction';
    // Schächte zur nächsten Ebene: an Stellen, die sich nicht decken – eine im ersten, eine im
    // letzten Drittel, auf längeren Karten eine weitere in der Mitte.
    if (level + 1 < levels) {
      const candidates = hubs.filter((h) => h.role !== 'place');
      const targets = candidates.length >= 6 ? [0.2, 0.5, 0.8] : [0.25, 0.75];
      const used = new Set<Cell>();
      targets.forEach((t, i) => {
        const pick = [...candidates]
          .filter((c) => !used.has(c))
          .sort((a, b) => Math.abs(along(a) - t) - Math.abs(along(b) - t))[0];
        if (!pick) return;
        used.add(pick);
        const kind: PassageKind = i === 0 ? 'climb' : rng.chance(0.4) ? 'drop' : 'open';
        shafts.push({ cell: { q: pick.q, r: pick.r }, level, kind });
      });
    }
  }

  // Verbinden und graben, Ebene für Ebene.
  for (let level = 0; level < levels; level++) {
    const hubs = hubsByLevel[level]!;
    const twice = hubs.flatMap((hub, i) => (hub.role === 'place' ? [i] : []));
    const links = linkHubs(rng, hubs, gap * 3 + 1, level === 0 ? 0.4 : 0.3, twice);
    const avoid = new Set(hubs.map((h) => keyOf(h, level)));
    for (const [a, b] of links) {
      const path = digPath(net, hubs[a]!, hubs[b]!, seed, avoid);
      dig(net, rng, path);
    }
  }
  // Schächte: oben hinab, unten hinauf – ein Abbruch nur in eine Richtung.
  for (const shaft of shafts) {
    const upper = net.at(shaft.cell, shaft.level)!;
    const lower = net.at(shaft.cell, shaft.level + 1)!;
    upper.exits.set(DIR_DOWN, shaft.kind);
    if (shaft.kind !== 'drop') lower.exits.set(DIR_UP, shaft.kind);
    if (lower.role === 'rock') lower.role = 'junction';
  }

  // Höhlen: vier bis sechs Ausgänge – die zusätzlichen führen zu Nachbargängen oder in Sackgassen.
  for (const hubs of hubsByLevel)
    for (const hub of hubs) {
      if (hub.role !== 'cave') continue;
      const want = rng.weighted([3, 4, 5, 6], (k) =>
        k === 3 ? 2 : k === 4 ? 4 : k === 5 ? 3 : 2,
      )!;
      for (const n of shuffle(rng, net.neighbours(hub))) {
        if ([...hub.exits.keys()].filter((d) => d < 6).length >= want) break;
        if (net.connected(hub, n)) continue;
        const fresh = !net.carved(n);
        net.open(hub, n);
        // Ein neuer Ausgang in den Fels führt meist zu einem nahen Gang (eine weitere Schleife),
        // sonst als kurzer Gang ins Blinde.
        if (fresh && !(rng.chance(0.35) && joinNearby(net, rng, n, hub, seed))) {
          const end = spur(net, rng, n, rng.int(0, 2));
          if (!end && n.exits.size === 1) n.role = 'deadend';
        }
      }
    }
  // Start und Ziel: nie nur ein Gang hinein – und kein Gang, an dem alles hängt.
  for (const place of [start, goal]) twoWays(net, rng, place, hubsByLevel[0]!, seed);
  bypassBridges(net, start, goal, seed);
  // Sackgassen von Gängen aus.
  const tunnels = [...net.cells.values()].filter((c) => c.role === 'tunnel' && c.exits.size === 2);
  const deadEnds = Math.round(hubsByLevel.flat().length * 0.25);
  for (const cell of shuffle(rng, tunnels).slice(0, deadEnds)) spur(net, rng, cell, rng.int(1, 3));

  // Ein Fluss quert die Karte durch eine Höhle.
  const wantsRiver = input.river ?? (n >= 30 && rng.chance(0.7));
  if (wantsRiver) river(net, rng, input, seed, hubsByLevel);

  // Verborgene Abkürzungen: wo zwei Gänge nebeneinander liegen, die sonst weit auseinander sind.
  const hidden = n > 300 ? 2 : 1;
  for (let i = 0; i < hidden; i++) {
    const reach = distances(net, start, true);
    let best: { a: Cell; b: Cell; gain: number } | null = null;
    for (const a of reach.keys())
      for (const b of net.neighbours(a)) {
        if (!reach.has(b) || net.connected(a, b) || net.connected(b, a)) continue;
        const gain = Math.abs(reach.get(a)! - reach.get(b)!);
        if (gain >= 4 && (!best || gain > best.gain)) best = { a, b, gain };
      }
    if (!best) break;
    net.open(best.a, best.b, 'hidden');
  }
  // Manche Sackgasse liegt hinter einem verborgenen Durchgang.
  const ends = [...net.cells.values()].filter((c) => c.role === 'deadend' && c.exits.size === 1);
  const secretEnd = rng.chance(0.6) ? rng.pick(ends) : undefined;
  if (secretEnd) {
    const [dir] = [...secretEnd.exits.keys()];
    const other = dir! >= 6 ? undefined : net.at(hexNeighbors(secretEnd)[dir!]!, secretEnd.level);
    if (other) {
      secretEnd.exits.set(dir!, 'hidden');
      other.exits.set(opposite(dir!), 'hidden');
    }
  }
  // Kreuzungen: Gänge, die sich treffen; Gänge mit nur einem Ausgang enden blind.
  for (const cell of net.cells.values()) {
    if (cell.role !== 'tunnel') continue;
    const sides = [...cell.exits.keys()].filter((d) => d < 6).length;
    if (sides >= 3) cell.role = 'junction';
    else if (cell.exits.size === 1 && !cell.river) cell.role = 'deadend';
  }
  return { net, quality: measure(net, start, goal) };
}

/** Der Fluss: von einem Rand über eine Höhle zum gegenüberliegenden Rand. */
function river(net: Net, rng: Rng, input: CaveInput, seed: number, hubsByLevel: Cell[][]): void {
  const level = rng.int(0, net.levels - 1);
  const hubs = hubsByLevel[level]!;
  const through =
    rng.pick(hubs.filter((h) => h.role === 'cave')) ??
    rng.pick(hubs.filter((h) => h.role !== 'place'));
  if (!through) return;
  const inside = new Set(input.cells.map((c) => hexKey(c)));
  const edge = input.cells.filter((c) => hexNeighbors(c).some((n) => !inside.has(hexKey(n))));
  // Quer zum Weg: links und rechts der Linie vom Start zum Ziel.
  const a = hexCenter(input.start);
  const b = hexCenter(input.goal);
  const side = (c: HexCoord) => {
    const p = hexCenter(c);
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  };
  const near = (cells: HexCoord[]) =>
    rng.pick(
      [...cells].sort((x, y) => hexDistance(x, through) - hexDistance(y, through)).slice(0, 4),
    );
  const left = near(edge.filter((c) => side(c) < -0.5));
  const right = near(edge.filter((c) => side(c) > 0.5));
  if (!left || !right) return;
  const course = [
    ...digPath(net, net.at(left, level)!, through, seedOf(seed, 'fluss'), new Set()),
    ...digPath(net, through, net.at(right, level)!, seedOf(seed, 'fluss'), new Set()).slice(1),
  ];
  for (let i = 0; i < course.length; i++) {
    const cell = course[i]!;
    cell.river = true;
    if (i > 0) net.open(course[i - 1]!, cell, 'water');
  }
}

/** Erzeugt das Höhlennetz – gleicher Ausgangswert, gleiches Netz. */
export function generateCaves(input: CaveInput): CaveResult {
  let chosen: { net: Net; quality: CaveQuality; attempt: number } | null = null;
  for (let k = 0; k < ATTEMPTS; k++) {
    const result = attempt(input, seedOf(input.seed, 'versuch', k));
    const good = result.quality.routes >= 2 && result.quality.loops >= 2;
    if (!chosen || score(result.quality) > score(chosen.quality))
      chosen = { ...result, attempt: k };
    if (good) {
      chosen = { ...result, attempt: k };
      break;
    }
  }
  const { net, quality, attempt: used } = chosen!;
  const cells: CaveCell[] = [...net.cells.values()].map((cell) => ({
    q: cell.q,
    r: cell.r,
    level: cell.level,
    role: cell.role,
    river: cell.river,
    exits: [...cell.exits]
      .sort((x, y) => x[0] - y[0])
      .map(([dir, kind]) => ({ dir, kind, found: false })),
  }));
  return { cells, quality, attempt: used };
}
