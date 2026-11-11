/**
 * Küsten aus einem Kartenbild ablesen. Aus den Bildpunkten wird eine Maske „Land oder Wasser“,
 * kleine Flecken fallen weg, und um jede Landfläche wird die Küstenlinie gezogen. Feste Regeln:
 * Land oder Wasser entscheidet allein die Ähnlichkeit zu den gewählten Farben.
 *
 * Reine Rechnung auf Zahlen – das Laden des Bildes und die Anzeige stehen in der Oberfläche.
 */
import { destination, simplifyRing, wrapLon } from '../../domain/geo';

export type Rgb = [number, number, number];

export interface TraceOptions {
  /** Was den gewählten Farben ähnelt: das Wasser (alles andere ist Land) oder das Land. */
  mode: 'water' | 'land';
  /**
   * Eine oder mehrere Farben. Ein gemaltes Meer hat viele Töne – tiefes Wasser, flaches Wasser,
   * Schatten; ähnlich ist, was einer davon nahekommt.
   */
  colors: readonly Rgb[];
  /** Wie weit eine Farbe abweichen darf, um noch als ähnlich zu gelten (0…441). */
  tolerance: number;
  /** Flecken mit weniger Bildpunkten fallen weg – Schrift, Zierrat, Körnung. */
  minArea: number;
  /**
   * Weichzeichnen vor dem Lesen, in Bildpunkten. Gemalte Karten haben Schatten, Wellen und
   * Glanzlichter; verwischt bleiben die großen Flächen und die Kleinigkeiten verschwinden.
   */
  smooth?: number;
  /** Ränder, die nicht gelesen werden – dort gilt alles als Meer. */
  crop?: Crop;
}

/** Wie viel vom Bild an jeder Seite wegfällt, als Anteil von 0 bis 1. */
export interface Crop {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Schneidet die Ränder aus der Maske: Was dort liegt, wird Wasser – Titel, Maßstab, Rahmen oder
 * Land, das nicht dazugehören soll. Das Bild behält seine Größe. Ohne Ränder dieselbe Maske.
 */
export function cropMask(
  mask: Uint8Array,
  width: number,
  height: number,
  crop: Crop | undefined,
): Uint8Array {
  if (!crop) return mask;
  const part = (value: number, size: number) => Math.round(Math.max(0, Math.min(1, value)) * size);
  const top = part(crop.top, height);
  const bottom = height - part(crop.bottom, height);
  const left = part(crop.left, width);
  const right = width - part(crop.right, width);
  if (top === 0 && left === 0 && bottom === height && right === width) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) out[y * width + x] = mask[y * width + x]!;
  return out;
}

/**
 * Zeichnet ein Bild weich: Jeder Bildpunkt wird zum Mittel seiner Umgebung (`radius` Punkte nach
 * jeder Seite), zweimal hintereinander. Gibt ein neues Bild zurück; ohne Radius dasselbe.
 */
export function blurPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): Uint8ClampedArray {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return pixels;
  let source = pixels;
  for (let pass = 0; pass < 2; pass++) {
    // Erst waagrecht, dann senkrecht – mit mitlaufender Summe, damit es schnell bleibt.
    const rows = new Uint8ClampedArray(source.length);
    for (let y = 0; y < height; y++)
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let x = -r; x <= r; x++)
          sum += source[(y * width + Math.max(0, Math.min(width - 1, x))) * 4 + channel]!;
        for (let x = 0; x < width; x++) {
          rows[(y * width + x) * 4 + channel] = sum / (2 * r + 1);
          sum +=
            source[(y * width + Math.min(width - 1, x + r + 1)) * 4 + channel]! -
            source[(y * width + Math.max(0, x - r)) * 4 + channel]!;
        }
      }
    const out = new Uint8ClampedArray(source.length);
    for (let x = 0; x < width; x++)
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let y = -r; y <= r; y++)
          sum += rows[(Math.max(0, Math.min(height - 1, y)) * width + x) * 4 + channel]!;
        for (let y = 0; y < height; y++) {
          out[(y * width + x) * 4 + channel] = sum / (2 * r + 1);
          sum +=
            rows[(Math.min(height - 1, y + r + 1) * width + x) * 4 + channel]! -
            rows[(Math.max(0, y - r) * width + x) * 4 + channel]!;
        }
      }
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    source = out;
  }
  return source;
}

/** Die häufigste Farbe eines Bildes – bei einer Karte fast immer das Meer. */
export function dominantColor(pixels: Uint8ClampedArray): Rgb {
  // Grob in 16 Stufen je Farbkanal gezählt; die Farbe ist der Mittelwert des vollsten Fachs.
  const count = new Uint32Array(4096);
  const sum = new Float64Array(4096 * 3);
  for (let i = 0; i < pixels.length; i += 4) {
    const bucket = ((pixels[i]! >> 4) << 8) | ((pixels[i + 1]! >> 4) << 4) | (pixels[i + 2]! >> 4);
    count[bucket]!++;
    sum[bucket * 3]! += pixels[i]!;
    sum[bucket * 3 + 1]! += pixels[i + 1]!;
    sum[bucket * 3 + 2]! += pixels[i + 2]!;
  }
  let best = 0;
  for (let bucket = 1; bucket < 4096; bucket++) if (count[bucket]! > count[best]!) best = bucket;
  const n = Math.max(1, count[best]!);
  return [
    Math.round(sum[best * 3]! / n),
    Math.round(sum[best * 3 + 1]! / n),
    Math.round(sum[best * 3 + 2]! / n),
  ];
}

/** Die Maske: 1 = Land, 0 = Wasser. Noch mit allen Flecken. */
export function landMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: Pick<TraceOptions, 'mode' | 'colors' | 'tolerance'>,
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const colors = options.colors;
  const limit = options.tolerance * options.tolerance;
  for (let i = 0; i < mask.length; i++) {
    let similar = false;
    for (let c = 0; c < colors.length && !similar; c++) {
      const dr = pixels[i * 4]! - colors[c]![0];
      const dg = pixels[i * 4 + 1]! - colors[c]![1];
      const db = pixels[i * 4 + 2]! - colors[c]![2];
      similar = dr * dr + dg * dg + db * db <= limit;
    }
    mask[i] = (options.mode === 'land') === similar ? 1 : 0;
  }
  return mask;
}

/**
 * Nimmt kleine Flecken aus der Maske: Landflecken unter `minArea` Bildpunkten werden Wasser,
 * ebenso kleine Wasserflecken im Land werden Land. Gibt eine neue Maske zurück.
 */
export function cleanMask(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea: number,
): Uint8Array {
  const out = mask.slice();
  if (minArea <= 1) return out;
  const seen = new Uint8Array(out.length);
  const stack: number[] = [];
  const members: number[] = [];
  for (let start = 0; start < out.length; start++) {
    if (seen[start]) continue;
    const value = out[start]!;
    members.length = 0;
    stack.push(start);
    seen[start] = 1;
    let touchesEdge = false;
    while (stack.length) {
      const i = stack.pop()!;
      members.push(i);
      const x = i % width;
      const y = (i - x) / width;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
      // Nachbarn über die vier Seiten.
      if (x > 0 && !seen[i - 1] && out[i - 1] === value) ((seen[i - 1] = 1), stack.push(i - 1));
      if (x < width - 1 && !seen[i + 1] && out[i + 1] === value)
        ((seen[i + 1] = 1), stack.push(i + 1));
      if (y > 0 && !seen[i - width] && out[i - width] === value)
        ((seen[i - width] = 1), stack.push(i - width));
      if (y < height - 1 && !seen[i + width] && out[i + width] === value)
        ((seen[i + width] = 1), stack.push(i + width));
    }
    // Wasser, das den Bildrand berührt, ist das offene Meer und bleibt – so klein es sein mag.
    if (members.length < minArea && !(value === 0 && touchesEdge))
      for (const i of members) out[i] = value ? 0 : 1;
  }
  return out;
}

export interface TracedShape {
  width: number;
  height: number;
  /** Küstenlinien in Bildpunkten, flach als x, y. */
  rings: number[][];
  /** Wasser im Land (Seen, Buchten ohne Ausgang), ebenso. */
  holes: number[][];
}

// Richtungen im Uhrzeigersinn: Osten, Süden, Westen, Norden (y wächst nach unten).
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

/**
 * Zieht die Küstenlinien um alle Landflächen einer Maske. Das Land liegt beim Abschreiten immer
 * rechts: Außenküsten laufen im Uhrzeigersinn, Ufer von Seen dagegen.
 */
export function traceMask(mask: Uint8Array, width: number, height: number): TracedShape {
  const cols = width + 1;
  // Je Gitterecke: in welche Richtungen eine Küstenkante abgeht (ein Bit je Richtung).
  const edges = new Uint8Array(cols * (height + 1));
  const land = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!land(x, y)) continue;
      if (!land(x, y - 1)) edges[y * cols + x]! |= 1; // oben: nach Osten
      if (!land(x + 1, y)) edges[y * cols + x + 1]! |= 2; // rechts: nach Süden
      if (!land(x, y + 1)) edges[(y + 1) * cols + x + 1]! |= 4; // unten: nach Westen
      if (!land(x - 1, y)) edges[(y + 1) * cols + x]! |= 8; // links: nach Norden
    }

  const rings: number[][] = [];
  const holes: number[][] = [];
  for (let start = 0; start < edges.length; start++) {
    while (edges[start]) {
      const loop: number[] = [];
      let corner = start;
      // Die erste freie Richtung an dieser Ecke.
      let direction = [0, 1, 2, 3].find((d) => edges[corner]! & (1 << d))!;
      let area = 0;
      for (;;) {
        edges[corner]! &= ~(1 << direction);
        const x = corner % cols;
        const y = (corner - x) / cols;
        const nx = x + DX[direction]!;
        const ny = y + DY[direction]!;
        loop.push(x, y);
        area += x * ny - nx * y;
        corner = ny * cols + nx;
        // Zurück am Anfang: Die Linie ist geschlossen – auch wenn dort noch eine zweite abgeht.
        if (corner === start) break;
        // Berühren sich zwei Landflächen nur über Eck, bleibt die Linie bei ihrer Fläche:
        // erst rechts abbiegen, dann geradeaus, dann links.
        const next = [(direction + 1) % 4, direction, (direction + 3) % 4].find(
          (d) => edges[corner]! & (1 << d),
        );
        if (next === undefined) break;
        direction = next;
      }
      if (loop.length >= 8) (area > 0 ? rings : holes).push(loop);
    }
  }
  return { width, height, rings, holes };
}

/** Alles in einem: Maske bilden, Flecken entfernen, Küsten ziehen. */
export function traceImage(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: TraceOptions,
): TracedShape {
  const soft = blurPixels(pixels, width, height, options.smooth ?? 0);
  const mask = cropMask(landMask(soft, width, height, options), width, height, options.crop);
  return traceMask(cleanMask(mask, width, height, options.minArea), width, height);
}

// ── Auf den Planeten legen ─────────────────────────────────────────────────

export interface Placement {
  /**
   * Wie das Bild gelesen wird. „local“: als Karte eines Gebiets – es liegt flach auf der Kugel
   * auf, seine Größe steht in Kilometern, und die Formen bleiben überall erhalten, auch am Pol.
   * „grid“: als Ausschnitt der Weltkarte – links und rechts sind Längengrade, oben und unten
   * Breitengrade; das passt für Bilder, die von Pol zu Pol oder rund um den Planeten reichen.
   */
  kind: 'local' | 'grid';
  /** Mitte des Bildes auf dem Planeten. */
  lon: number;
  lat: number;
  /** „local“: Breite des Bildes in Kilometern; die Höhe folgt dem Bild. */
  widthKm: number;
  /** „local“: Drehung im Uhrzeigersinn in Grad – 0 heißt, in der Bildmitte ist oben Norden. */
  turnDeg: number;
  /** „grid“: Wie viele Grad das Bild in der Breite und in der Höhe überdeckt. */
  widthDeg: number;
  heightDeg: number;
}

export interface PlacedShape {
  rings: number[][];
  holes: number[][];
}

/** Längste Strecke in Bildpunkten, die auf der Kugel noch als gerade Linie durchgeht. */
const MAX_STEP = 12;

/**
 * Als Karte eines Gebiets: Jeder Bildpunkt liegt so weit und in der Richtung von der Mitte
 * entfernt wie im Bild – Entfernungen und Winkel zur Mitte stimmen, wo immer das Bild liegt.
 */
function placeLocal(shape: TracedShape, placement: Placement, radiusKm: number): PlacedShape {
  const kmPerPixel = placement.widthKm / shape.width;
  // Genau auf dem Pol gäbe es keine Richtungen mehr; knapp daneben schon.
  const center = { lon: placement.lon, lat: Math.max(-89.99, Math.min(89.99, placement.lat)) };
  const midX = shape.width / 2;
  const midY = shape.height / 2;
  // Weiter als bis zur Gegenseite des Planeten reicht kein Bild.
  const farthest = Math.PI * radiusKm * 0.98;
  // Zum Vereinfachen auf höchstens 100 Einheiten gestaucht (die Rechnung dort denkt in Grad).
  const unit = 100 / Math.max(shape.width, shape.height);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const convert = (loop: number[]): number[] => {
    const slim = simplifyRing(
      loop.map((value) => value * unit),
      0.8 * unit,
    ).map((value) => value / unit);
    const count = slim.length / 2;
    const ring: number[] = [];
    const add = (x: number, y: number) => {
      const dx = (x - midX) * kmPerPixel;
      const dy = (y - midY) * kmPerPixel;
      const bearing = (Math.atan2(dx, -dy) * 180) / Math.PI + placement.turnDeg;
      const point = destination(radiusKm, center, bearing, Math.min(farthest, Math.hypot(dx, dy)));
      ring.push(round(point.lon), round(point.lat));
    };
    for (let i = 0; i < count; i++) {
      const ax = slim[i * 2]!;
      const ay = slim[i * 2 + 1]!;
      const bx = slim[((i + 1) % count) * 2]!;
      const by = slim[((i + 1) % count) * 2 + 1]!;
      // Lange gerade Strecken bekommen Zwischenpunkte – auf der Kugel sind sie gebogen.
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / MAX_STEP));
      for (let step = 0; step < steps; step++)
        add(ax + ((bx - ax) * step) / steps, ay + ((by - ay) * step) / steps);
    }
    return ring;
  };
  return {
    rings: shape.rings.map(convert).filter((ring) => ring.length >= 6),
    holes: shape.holes.map(convert).filter((ring) => ring.length >= 6),
  };
}

/**
 * Legt die Küsten eines Bildes auf den Planeten; seine Mitte kommt auf die gewählte Lage. Linien
 * werden dabei auf knapp einen Bildpunkt vereinfacht – aus Treppenstufen werden Küsten.
 */
export function placeShape(
  shape: TracedShape,
  placement: Placement,
  radiusKm: number,
): PlacedShape {
  if (placement.kind === 'local') return placeLocal(shape, placement, radiusKm);
  const perX = placement.widthDeg / shape.width;
  const perY = placement.heightDeg / shape.height;
  const west = placement.lon - placement.widthDeg / 2;
  const north = placement.lat + placement.heightDeg / 2;
  // Etwas mehr als die Abweichung einer Treppenstufe von ihrer Schräge (0,71 Bildpunkte).
  const tolerance = 0.8 * Math.min(perX, perY);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const convert = (loop: number[]): number[] => {
    const ring: number[] = [];
    for (let i = 0; i < loop.length; i += 2)
      ring.push(
        wrapLon(west + loop[i]! * perX),
        Math.max(-90, Math.min(90, north - loop[i + 1]! * perY)),
      );
    return simplifyRing(ring, tolerance).map(round);
  };
  return {
    rings: shape.rings.map(convert).filter((ring) => ring.length >= 6),
    holes: shape.holes.map(convert).filter((ring) => ring.length >= 6),
  };
}
