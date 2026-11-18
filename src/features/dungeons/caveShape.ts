/**
 * Der Umriss einer Höhle: aus ihren Feldern eine geschlossene, unregelmäßige Linie. Wo die Höhle an
 * Fels grenzt, weicht der Rand vom Raster ab und ist gerundet; wo sie an anderen Boden grenzt
 * (ein gebauter Gang, ein Raum), bleibt er gerade und offen. Fest je Feld – die Höhle steht still.
 */
export interface CaveLoop {
  /** Punkte in Feldmaßen, im Kreis. */
  points: [number, number][];
  /** Je Punkt: Die Strecke von ihm zum nächsten grenzt an Boden – dort steht keine Wand. */
  open: boolean[];
}

interface Edge {
  from: [number, number];
  to: [number, number];
  open: boolean;
  used: boolean;
}

/** Ein fester Wert zwischen 0 und 1 für eine Stelle. */
export function spotNoise(x: number, y: number, salt = 0): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

const vkey = (p: readonly [number, number]) => `${p[0]},${p[1]}`;

/**
 * @param cave Schlüssel „x,y“ der Höhlenfelder
 * @param isFloor ob ein Feld (kein Höhlenfeld) Boden ist
 */
export function caveLoops(
  cave: ReadonlySet<string>,
  isFloor: (x: number, y: number, fromX: number, fromY: number) => boolean,
  /** Fels ist kantig: Der Rand wird zerklüftet statt nur gerundet. Ufer bleiben weich. */
  craggy = false,
): CaveLoop[] {
  const edges: Edge[] = [];
  const from = new Map<string, Edge[]>();
  const add = (
    a: [number, number],
    b: [number, number],
    nx: number,
    ny: number,
    cx: number,
    cy: number,
  ) => {
    if (cave.has(`${nx},${ny}`)) return;
    const edge = { from: a, to: b, open: isFloor(nx, ny, cx, cy), used: false };
    edges.push(edge);
    const list = from.get(vkey(a)) ?? [];
    list.push(edge);
    from.set(vkey(a), list);
  };
  for (const key of cave) {
    const [xs, ys] = key.split(',');
    const x = Number(xs);
    const y = Number(ys);
    add([x, y], [x + 1, y], x, y - 1, x, y);
    add([x + 1, y], [x + 1, y + 1], x + 1, y, x, y);
    add([x + 1, y + 1], [x, y + 1], x, y + 1, x, y);
    add([x, y + 1], [x, y], x - 1, y, x, y);
  }
  const loops: CaveLoop[] = [];
  for (const start of edges) {
    if (start.used) continue;
    const ring: Edge[] = [];
    let edge: Edge | undefined = start;
    while (edge && !edge.used) {
      edge.used = true;
      ring.push(edge);
      edge = (from.get(vkey(edge.to)) ?? []).find((next) => !next.used);
    }
    loops.push(craggy ? crag(freeForm(rough(ring))) : smooth(rough(ring), 2));
  }
  return loops;
}

interface Pt {
  x: number;
  y: number;
  /** Bleibt auf dem Raster: an einer offenen Strecke. */
  pinned: boolean;
  open: boolean;
}

/** Ecken und Mitten der Kanten, vom Raster weggerückt, wo Fels ist. */
function rough(ring: Edge[]): Pt[] {
  const points: Pt[] = [];
  ring.forEach((edge, index) => {
    const before = ring[(index + ring.length - 1) % ring.length]!;
    const [x, y] = edge.from;
    const cornerPinned = edge.open || before.open;
    points.push({
      x: cornerPinned ? x : x + (spotNoise(x, y, 1) - 0.5) * 0.34,
      y: cornerPinned ? y : y + (spotNoise(x, y, 2) - 0.5) * 0.34,
      pinned: cornerPinned,
      open: edge.open,
    });
    const mx = (edge.from[0] + edge.to[0]) / 2;
    const my = (edge.from[1] + edge.to[1]) / 2;
    points.push({
      x: edge.open ? mx : mx + (spotNoise(mx * 2, my * 2, 3) - 0.5) * 0.3,
      y: edge.open ? my : my + (spotNoise(mx * 2, my * 2, 4) - 0.5) * 0.3,
      pinned: edge.open,
      open: edge.open,
    });
  });
  return points;
}

/** Die Ecken abschneiden – außer dort, wo der Rand auf dem Raster bleibt. */
function smooth(start: Pt[], rounds: number): CaveLoop {
  let points = start;
  for (let round = 0; round < rounds; round++) {
    const next: Pt[] = [];
    points.forEach((p, i) => {
      if (p.pinned) {
        next.push(p);
        return;
      }
      const a = points[(i + points.length - 1) % points.length]!;
      const b = points[(i + 1) % points.length]!;
      next.push({
        x: p.x * 0.75 + a.x * 0.25,
        y: p.y * 0.75 + a.y * 0.25,
        pinned: false,
        open: false,
      });
      next.push({
        x: p.x * 0.75 + b.x * 0.25,
        y: p.y * 0.75 + b.y * 0.25,
        pinned: false,
        open: p.open,
      });
    });
    points = next;
  }
  return { points: points.map((p) => [p.x, p.y]), open: points.map((p) => p.open) };
}

/**
 * Fels bricht kantig: Jede Strecke am Fels wird zweimal geteilt und ihre Mitte quer versetzt –
 * große Buchten bleiben, dazu kommen kleine Zacken. Fest je Stelle.
 */
function crag(loop: CaveLoop): CaveLoop {
  const points: [number, number][] = [];
  const open: boolean[] = [];
  const split = (a: [number, number], b: [number, number], depth: number) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (depth === 0 || length < 0.07) {
      points.push(a);
      open.push(false);
      return;
    }
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const shift = (spotNoise(Math.round(mx * 97), Math.round(my * 97), 5 + depth) - 0.5) * 0.62;
    const mid: [number, number] = [mx - dy * shift, my + dx * shift];
    split(a, mid, depth - 1);
    split(mid, b, depth - 1);
  };
  loop.points.forEach((point, index) => {
    const next = loop.points[(index + 1) % loop.points.length]!;
    if (loop.open[index]) {
      points.push(point);
      open.push(true);
    } else split(point, next, 2);
  });
  return { points, open };
}

/** Die Richtung vom Boden weg an jedem Punkt eines Umrisses (er läuft im Uhrzeigersinn). */
export function outward(loop: CaveLoop): [number, number][] {
  const n = loop.points.length;
  return loop.points.map((_, i) => {
    const a = loop.points[(i + n - 1) % n]!;
    const b = loop.points[(i + 1) % n]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    return [dy / length, -dx / length];
  });
}

/** Ein weicher, fester Wert zwischen 0 und 1 an jeder Stelle der Karte – benachbarte Stellen ähneln sich. */
export function fieldNoise(x: number, y: number, salt = 0): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const ease = (t: number) => t * t * (3 - 2 * t);
  const tx = ease(x - x0);
  const ty = ease(y - y0);
  const top = spotNoise(x0, y0, salt) * (1 - tx) + spotNoise(x0 + 1, y0, salt) * tx;
  const bottom = spotNoise(x0, y0 + 1, salt) * (1 - tx) + spotNoise(x0 + 1, y0 + 1, salt) * tx;
  return top * (1 - ty) + bottom * ty;
}

/**
 * Die freie Form einer Höhle: Erst verschwinden die Treppenstufen des Rasters (die Punkte rücken
 * mehrmals zur Mitte ihrer Nachbarn), dann buchtet der Rand nach einem weichen Muster aus – weit
 * in den Fels hinein, nur wenig in den Boden. Wo der Rand an gebautem Boden liegt, bleibt er.
 */
function freeForm(start: Pt[]): CaveLoop {
  // Feiner teilen: vier Punkte je Feldkante.
  let points: Pt[] = [];
  start.forEach((p, i) => {
    const next = start[(i + 1) % start.length]!;
    points.push(p);
    points.push({
      x: (p.x + next.x) / 2,
      y: (p.y + next.y) / 2,
      pinned: p.open,
      open: p.open,
    });
  });
  const n = points.length;
  const near = (i: number) => points[((i % n) + n) % n]!;
  // Wer neben einem festen Punkt liegt, bewegt sich nur halb – so setzt der Rand sauber an.
  const hold = points.map((p, i) =>
    p.pinned ? 0 : near(i - 1).pinned || near(i + 1).pinned ? 0.4 : 1,
  );
  for (let round = 0; round < 7; round++) {
    points = points.map((p, i) => {
      const a = near(i - 1);
      const b = near(i + 1);
      const k = hold[i]! * 0.5;
      return { ...p, x: p.x + ((a.x + b.x) / 2 - p.x) * k, y: p.y + ((a.y + b.y) / 2 - p.y) * k };
    });
  }
  // Buchten und Vorsprünge.
  const moved = points.map((p, i) => {
    if (hold[i] === 0) return p;
    const a = near(i - 1);
    const b = near(i + 1);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    const big = fieldNoise(p.x * 0.42, p.y * 0.42, 61) - 0.38;
    const small = fieldNoise(p.x * 1.3, p.y * 1.3, 62) - 0.5;
    // Nach außen (in den Fels) weit, nach innen nur wenig: Der Boden bleibt begehbar.
    const out = Math.max(-0.22, big * 1.05 + small * 0.3) * hold[i]!;
    return { ...p, x: p.x + (dy / length) * out, y: p.y - (dx / length) * out };
  });
  return { points: moved.map((p) => [p.x, p.y]), open: moved.map((p) => p.open) };
}
