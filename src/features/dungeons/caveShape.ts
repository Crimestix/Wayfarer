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
  isFloor: (x: number, y: number) => boolean,
): CaveLoop[] {
  const edges: Edge[] = [];
  const from = new Map<string, Edge[]>();
  const add = (a: [number, number], b: [number, number], nx: number, ny: number) => {
    if (cave.has(`${nx},${ny}`)) return;
    const edge = { from: a, to: b, open: isFloor(nx, ny), used: false };
    edges.push(edge);
    const list = from.get(vkey(a)) ?? [];
    list.push(edge);
    from.set(vkey(a), list);
  };
  for (const key of cave) {
    const [xs, ys] = key.split(',');
    const x = Number(xs);
    const y = Number(ys);
    add([x, y], [x + 1, y], x, y - 1);
    add([x + 1, y], [x + 1, y + 1], x + 1, y);
    add([x + 1, y + 1], [x, y + 1], x, y + 1);
    add([x, y + 1], [x, y], x - 1, y);
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
    loops.push(smooth(rough(ring)));
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

/** Zweimal die Ecken abschneiden – außer dort, wo der Rand auf dem Raster bleibt. */
function smooth(start: Pt[]): CaveLoop {
  let points = start;
  for (let round = 0; round < 2; round++) {
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
