/**
 * Der Umriss von Höhlen und Gängen auf der Hexkarte (Rückmeldung des Spielleiters, 20. 11. 2026:
 * „Das sieht alles janky aus im Unterreich“ – man sah Kreise und gerade Bänder mit verwaschenem
 * Rand). Aus Kammern (Kreise) und Gängen (Bänder) wird hier **eine** geschlossene, frei geformte
 * Linie gerechnet: Die Formen verschmelzen weich miteinander, ein festes Rauschen lässt den Rand
 * in den Fels buchten, und heraus kommt ein Linienzug mit klarer Kante – kein Filter, nichts
 * Verwackeltes. Gerechnet wird in Feldgrößen (Nachbarabstand = 1), fest je Stelle: Dieselbe Karte
 * sieht an jedem Rechner und bei jeder Vergrößerung gleich aus. Reine Funktionen.
 */

/** Eine Kammer (Kreis) oder ein Gang (Band mit runden Enden), in Feldgrößen. */
export interface CaveBlob {
  x1: number;
  y1: number;
  /** Fehlen sie, ist es ein Kreis um (x1, y1). */
  x2?: number;
  y2?: number;
  r: number;
}

export interface OutlineOptions {
  /** Abstand der Stützpunkte in Feldgrößen – kleiner ist feiner und langsamer. */
  step?: number;
  /** Wie weit der Rand buchtet (in Feldgrößen). */
  rough?: number;
  /** Unterscheidet Flächen, die an derselben Stelle liegen (Boden, See), im Rauschen. */
  salt?: number;
  /**
   * Feine Zacken, in Feldgrößen – unabhängig davon, wie breit eine Form ist: So ist auch die Wand
   * eines schmalen Gangs schroff wie Fels, ohne dass er abreißt. Braucht einen feinen `step`.
   */
  crisp?: number;
}

/** Fester Wert zwischen 0 und 1 für einen Gitterpunkt. */
function lattice(ix: number, iy: number, salt: number): number {
  let h = (ix * 374761393 + iy * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Weiches Rauschen zwischen −1 und 1: Werte auf einem Gitter, dazwischen sanft überblendet. */
export function smoothNoise(x: number, y: number, salt = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = lattice(ix, iy, salt);
  const b = lattice(ix + 1, iy, salt);
  const c = lattice(ix, iy + 1, salt);
  const d = lattice(ix + 1, iy + 1, salt);
  return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1;
}

/** Abstand eines Punktes zu einer Form, von ihrem Rand aus: positiv innen, negativ außen. */
function depth(blob: CaveBlob, x: number, y: number): number {
  let dx = x - blob.x1;
  let dy = y - blob.y1;
  if (blob.x2 !== undefined && blob.y2 !== undefined) {
    const ex = blob.x2 - blob.x1;
    const ey = blob.y2 - blob.y1;
    const len = ex * ex + ey * ey;
    const t = len > 0 ? Math.max(0, Math.min(1, (dx * ex + dy * ey) / len)) : 0;
    dx -= ex * t;
    dy -= ey * t;
  }
  return blob.r - Math.sqrt(dx * dx + dy * dy);
}

/** Wie scharf Formen ineinander übergehen – kleiner rundet die Kehlen stärker aus. */
const BLEND = 14;

/**
 * Die Umrisse der Fläche, die alle Formen zusammen bedecken: geschlossene Linienzüge in
 * Feldgrößen. Löcher (Fels mitten in einer Höhle) sind eigene Linienzüge – gefüllt wird mit der
 * Regel „gerade/ungerade“.
 */
export function caveOutline(blobs: readonly CaveBlob[], options: OutlineOptions = {}): number[][] {
  if (!blobs.length) return [];
  const step = options.step ?? 0.1;
  const rough = options.rough ?? 0.1;
  const salt = options.salt ?? 0;
  const crisp = options.crisp ?? 0;

  // Rahmen um alle Formen, mit Rand für das Rauschen.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const blob of blobs) {
    const pad = blob.r + rough * 2 + step * 2;
    minX = Math.min(minX, blob.x1 - pad, (blob.x2 ?? blob.x1) - pad);
    minY = Math.min(minY, blob.y1 - pad, (blob.y2 ?? blob.y1) - pad);
    maxX = Math.max(maxX, blob.x1 + pad, (blob.x2 ?? blob.x1) + pad);
    maxY = Math.max(maxY, blob.y1 + pad, (blob.y2 ?? blob.y1) + pad);
  }
  const cols = Math.ceil((maxX - minX) / step) + 1;
  const rows = Math.ceil((maxY - minY) / step) + 1;

  // Nur die Formen in der Nähe eines Punktes zählen: nach Kästchen von einer Feldgröße sortiert.
  // Schlüssel als Zahl: Auf großen Karten wird für jeden Stützpunkt nachgeschlagen.
  const cellOf = (bx: number, by: number) => (bx + 32768) * 65536 + (by + 32768);
  const buckets = new Map<number, CaveBlob[]>();
  for (const blob of blobs) {
    const reach = blob.r + rough * 2 + 0.3;
    const x0 = Math.floor(Math.min(blob.x1, blob.x2 ?? blob.x1) - reach);
    const x1 = Math.floor(Math.max(blob.x1, blob.x2 ?? blob.x1) + reach);
    const y0 = Math.floor(Math.min(blob.y1, blob.y2 ?? blob.y1) - reach);
    const y1 = Math.floor(Math.max(blob.y1, blob.y2 ?? blob.y1) + reach);
    for (let bx = x0; bx <= x1; bx++)
      for (let by = y0; by <= y1; by++) {
        const key = cellOf(bx, by);
        const list = buckets.get(key);
        if (list) list.push(blob);
        else buckets.set(key, [blob]);
      }
  }

  // Das Feld: positiv innen, negativ außen. Die Formen verschmelzen weich; das Rauschen schiebt
  // den Rand – grob in weiten Bögen, fein in kleinen Zacken.
  const field = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const y = minY + j * step;
    for (let i = 0; i < cols; i++) {
      const x = minX + i * step;
      const near = buckets.get(cellOf(Math.floor(x), Math.floor(y)));
      if (!near) {
        field[j * cols + i] = -1;
        continue;
      }
      let sum = 0;
      let best = -Infinity;
      let size = 0;
      for (const blob of near) {
        const inside = depth(blob, x, y);
        sum += Math.exp(BLEND * inside);
        if (inside > best) {
          best = inside;
          size = blob.r;
        }
      }
      const merged = Math.log(sum) / BLEND;
      // Eine weite Höhle buchtet kräftig; ein Gang bleibt in seiner Bahn und wird nur mal enger,
      // mal weiter – nie so sehr, dass er abreißt.
      const weight = Math.max(0.15, Math.min(1, (size - 0.05) / 0.45));
      // Drei Lagen: weite Bögen, Buchten, und feine Zacken – Fels ist kantig.
      const bend =
        (smoothNoise(x * 1.3, y * 1.3, salt) +
          smoothNoise(x * 3.7, y * 3.7, salt + 7) * 0.55 +
          smoothNoise(x * 6.3, y * 6.3, salt + 13) * 0.32) *
        rough *
        weight;
      const jag = crisp
        ? (smoothNoise(x * 9.7, y * 9.7, salt + 29) +
            smoothNoise(x * 17, y * 17, salt + 41) * 0.5) *
          crisp
        : 0;
      field[j * cols + i] = merged + bend + jag;
    }
  }

  // Kanten zwischen innen und außen je Kästchen finden und zu Linienzügen verbinden.
  const at = (i: number, j: number) => field[j * cols + i]!;
  /** Wo der Rand eine Gitterkante schneidet: Punkt und fester Schlüssel der Kante. */
  const cut = (i1: number, j1: number, i2: number, j2: number) => {
    const a = at(i1, j1);
    const b = at(i2, j2);
    const t = a === b ? 0.5 : a / (a - b);
    return {
      key: i1 === i2 ? `v${i1},${Math.min(j1, j2)}` : `h${Math.min(i1, i2)},${j1}`,
      x: minX + (i1 + (i2 - i1) * t) * step,
      y: minY + (j1 + (j2 - j1) * t) * step,
    };
  };
  const next = new Map<string, { to: string; x: number; y: number }[]>();
  const link = (
    a: { key: string; x: number; y: number },
    b: { key: string; x: number; y: number },
  ) => {
    const from = next.get(a.key);
    if (from) from.push({ to: b.key, x: b.x, y: b.y });
    else next.set(a.key, [{ to: b.key, x: b.x, y: b.y }]);
    const back = next.get(b.key);
    if (back) back.push({ to: a.key, x: a.x, y: a.y });
    else next.set(b.key, [{ to: a.key, x: a.x, y: a.y }]);
  };
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < cols - 1; i++) {
      const tl = at(i, j) > 0;
      const tr = at(i + 1, j) > 0;
      const br = at(i + 1, j + 1) > 0;
      const bl = at(i, j + 1) > 0;
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => cut(i, j, i + 1, j);
      const right = () => cut(i + 1, j, i + 1, j + 1);
      const bottom = () => cut(i, j + 1, i + 1, j + 1);
      const left = () => cut(i, j, i, j + 1);
      switch (code) {
        case 1:
        case 14:
          link(left(), bottom());
          break;
        case 2:
        case 13:
          link(bottom(), right());
          break;
        case 3:
        case 12:
          link(left(), right());
          break;
        case 4:
        case 11:
          link(top(), right());
          break;
        case 6:
        case 9:
          link(top(), bottom());
          break;
        case 7:
        case 8:
          link(left(), top());
          break;
        case 5:
          link(left(), top());
          link(bottom(), right());
          break;
        case 10:
          link(top(), right());
          link(left(), bottom());
          break;
      }
    }

  const loops: number[][] = [];
  const used = new Set<string>();
  const where = new Map<string, { x: number; y: number }>();
  for (const list of next.values())
    for (const hop of list) if (!where.has(hop.to)) where.set(hop.to, hop);
  for (const start of next.keys()) {
    if (used.has(start)) continue;
    const loop: number[] = [];
    let key: string | undefined = start;
    let from: string | null = null;
    while (key && !used.has(key)) {
      used.add(key);
      const here = where.get(key);
      if (here) loop.push(here.x, here.y);
      const hops: { to: string }[] = next.get(key) ?? [];
      const onward: { to: string } | undefined =
        hops.find((hop) => hop.to !== from && !used.has(hop.to)) ??
        hops.find((hop) => hop.to !== from);
      from = key;
      key = onward?.to;
    }
    // Winzige Ringe (ein Krümel Fels im Boden, ein Loch von wenigen Punkten) sind nur Rauschen.
    if (loop.length >= 20) loops.push(soften(loop));
  }
  return loops;
}

/** Nimmt die Ecken des Gitters weg, ohne die Zacken des Felsens zu glätten (ein Durchgang). */
function soften(loop: number[]): number[] {
  const n = loop.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const ax = loop[i * 2]!;
    const ay = loop[i * 2 + 1]!;
    const bx = loop[((i + 1) % n) * 2]!;
    const by = loop[((i + 1) % n) * 2 + 1]!;
    out.push(
      ax * 0.75 + bx * 0.25,
      ay * 0.75 + by * 0.25,
      ax * 0.25 + bx * 0.75,
      ay * 0.25 + by * 0.75,
    );
  }
  return out;
}

/** Die Linienzüge als Pfad – in Bildpunkten, bei der Feldgröße `size`. */
export function outlinePath(loops: readonly number[][], size: number): string {
  let d = '';
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i += 2)
      d += `${i === 0 ? 'M' : 'L'}${(loop[i]! * size).toFixed(1)} ${(loop[i + 1]! * size).toFixed(1)}`;
    d += 'Z';
  }
  return d;
}
