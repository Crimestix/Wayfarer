/**
 * Gemalte Bildzeichen auf der Oberwelt (Frage des Spielleiters, 20. 11. 2026: „Wie kriegen wir
 * hochqualitative Maps hin? … einen detaillierten, schönen, hochqualitativen Stil, mit dem man
 * wirklich schöne Maps bauen kann – aber damit nicht viel Arbeit hat“ – die gemalten Böden allein
 * wirkten verschwommen, „gerade die Wälder passen irgendwie nicht so ganz zum Rest“).
 *
 * Der Aufbau schöner Fantasy-Karten: ein **ruhiger Boden**, der weich verläuft, und darauf
 * **scharfe, gemalte Zeichen** – Baumgruppen, Berge, Hügel –, die das Auge führt. Die Arbeit macht
 * Wayfarer: Wer „Wald“ malt, bekommt Bäume. Je Feld steht eine Gruppe, gewählt und leicht versetzt
 * nach fester Regel (dieselbe Karte sieht immer gleich aus, nie `Math.random`); sie ragt über die
 * Feldkante, sodass Wälder und Gebirge zusammenwachsen und kein Sechseck mehr zu sehen ist. Von
 * oben nach unten gezeichnet, damit das Vordere das Hintere verdeckt.
 *
 * Ein neues Zeichen: Datei `<art>-<nummer>.webp` nach `ui/assets/hexkarte/bild` – mehr nicht.
 */
import { memo, useMemo } from 'react';
import { HEX_DIRECTIONS, hexCenter, type HexOrientation } from '../../domain/hex';
import { WIDE_CAVE_KINDS, kindKeyOf } from '../../domain/hexKinds';
import type { Hex } from '../../domain/schema';
import { isSolid, isUnderground } from './HexLayers';

const FILES = import.meta.glob('../../ui/assets/hexkarte/bild/*.webp', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const CAVE_FILES = import.meta.glob('../../ui/assets/hexkarte/unten/*.webp', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

/** Dateien `<name>-<nummer>.webp` nach ihrem Namen gruppiert. */
function byName(files: Record<string, string>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const path of Object.keys(files).sort()) {
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/-\d+\.webp$/, '');
    (out[name] ??= []).push(files[path]!);
  }
  return out;
}

/** Die Zeichen je Geländeart der Oberwelt: alle Dateien `<art>-<nummer>.webp`. */
export const LAND_SYMBOLS: Readonly<Record<string, readonly string[]>> = byName(FILES);

/**
 * Die Zeichen unter der Erde (Wunsch des Spielleiters, 20. 11. 2026: „Genau das Qualitätslevel
 * auch fürs Unterreich“): Riesenpilze, Kristalle, Tropfsteine, Geröll, Ruinen, Bergwerk – und
 * `floor` für Kleinigkeiten auf dem blanken Höhlenboden. Dateien in `ui/assets/hexkarte/unten`.
 */
export const CAVE_SYMBOLS: Readonly<Record<string, readonly string[]>> = byName(CAVE_FILES);
/** Blanker Höhlenboden trägt hier und da einen Tropfstein oder ein paar Brocken. */
const CAVE_ALIAS: Readonly<Record<string, string>> = {
  cavern: 'floor',
  'cave-floor': 'floor',
  // Auch im Gang liegt hier und da ein Brocken.
  underdark: 'floor',
};

/**
 * Wie eine Gruppe im Feld steht: `width` (1 = so breit wie das Feld), `foot` (wie tief ihr Fuß
 * unter der Feldmitte sitzt) und `share` – auf wie vielen Feldern der Art überhaupt eine steht
 * (ohne Angabe auf jedem). Was dicht steht (Wald, Gebirge), ragt über die Feldkante; was vereinzelt
 * steht (Schilf, Felsnadeln, Eiszacken), lässt Felder frei.
 *
 * `scatter`: Statt einer Gruppe stehen viele kleine über das ganze Feld verteilt – eine in der
 * Mitte, sechs im Ring zu den Nachbarn hin (`share` gilt dann je Platz). So wächst unter der Erde
 * ein Pilzwald zusammen wie oben ein Wald (Rückmeldung des Spielleiters, 20. 11. 2026: „Das hat
 * noch einen komischen Look, gerade mit den einzelnen Pilzen“ – eine einzelne Gruppe mitten im
 * Feld wirkt wie ein Aufkleber).
 */
interface Fit {
  width: number;
  foot: number;
  share?: number;
  scatter?: boolean;
}
const FIT: Readonly<Record<string, Fit>> = {
  mountains: { width: 1.5, foot: 0.44 },
  highpeak: { width: 1.6, foot: 0.46 },
  volcano: { width: 1.5, foot: 0.44 },
  hills: { width: 1.2, foot: 0.32 },
  crag: { width: 1.15, foot: 0.34 },
  crater: { width: 1.15, foot: 0.32 },
  'dense-forest': { width: 1.5, foot: 0.5 },
  jungle: { width: 1.45, foot: 0.5 },
  'dead-forest': { width: 1.2, foot: 0.44 },
  glade: { width: 1.2, foot: 0.42 },
  savanna: { width: 1.1, foot: 0.38, share: 0.8 },
  mangrove: { width: 1.3, foot: 0.46 },
  swamp: { width: 1.2, foot: 0.42, share: 0.75 },
  marsh: { width: 0.85, foot: 0.32, share: 0.6 },
  dunes: { width: 1.2, foot: 0.32 },
  badlands: { width: 1.15, foot: 0.36, share: 0.55 },
  oasis: { width: 1.2, foot: 0.4 },
  glacier: { width: 1.1, foot: 0.36, share: 0.5 },
  // Unter der Erde: viele kleine Stücke, dicht über die Höhle verteilt.
  fungus: { width: 0.46, foot: 0.17, share: 0.9, scatter: true },
  crystal: { width: 0.4, foot: 0.14, share: 0.75, scatter: true },
  stalagmites: { width: 0.42, foot: 0.16, share: 0.9, scatter: true },
  rubble: { width: 0.4, foot: 0.12, share: 0.8, scatter: true },
  'deep-ruins': { width: 0.44, foot: 0.16, share: 0.55, scatter: true },
  mine: { width: 0.4, foot: 0.15 },
  cavern: { width: 0.26, foot: 0.09, share: 0.34, scatter: true },
  'cave-floor': { width: 0.24, foot: 0.08, share: 0.26, scatter: true },
  underdark: { width: 0.15, foot: 0.05, share: 0.4 },
  urban: { width: 1.5, foot: 0.44 },
  village: { width: 1.25, foot: 0.4 },
  ruins: { width: 1.2, foot: 0.4 },
};
const DEFAULT_FIT: Fit = { width: 1.36, foot: 0.48 };
/** Wie weit die Plätze im Ring von der Feldmitte liegen: ein Drittel des Wegs zum Nachbarn – so
 * ergeben die Plätze benachbarter Felder zusammen ein gleichmäßiges Netz. Zur Wand hin näher. */
const RING = 1 / 3;
const RING_AT_WALL = 0.19;

/** Eine feste Zahl zwischen 0 und 1 aus Feld und Wort – dieselbe an jedem Rechner. */
function fixed(q: number, r: number, salt: number): number {
  let h = (q * 374761393 + r * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Hat diese Geländeart gemalte Zeichen? */
export const symbolsOf = (
  hex: Pick<Hex, 'kind' | 'terrain' | 'exits'>,
): readonly string[] | null =>
  hex.terrain && hex.exits === null && hex.terrain !== 'underdark'
    ? (LAND_SYMBOLS[kindKeyOf(hex) ?? ''] ?? null)
    : null;

/** Hat dieses Feld unter der Erde gemalte Zeichen? Fels und Gänge nie. */
export const caveSymbolsOf = (hex: Hex): readonly string[] | null => {
  if (!isUnderground(hex) || isSolid(hex)) return null;
  const kind = kindKeyOf(hex) ?? '';
  return CAVE_SYMBOLS[CAVE_ALIAS[kind] ?? kind] ?? null;
};

export interface SymbolCell {
  hex: Hex;
  x: number;
  y: number;
}

/** Ein Feld, dessen Höhlenboden bis zum Nachbarn reicht: eine weite Höhle, kein Fels. */
const isOpenCave = (hex: Hex): boolean =>
  isUnderground(hex) && !isSolid(hex) && WIDE_CAVE_KINDS.has(kindKeyOf(hex) ?? '');

export const SymbolLayer = memo(function SymbolLayer({
  cells,
  size,
  orientation,
  fog,
  where,
}: {
  cells: readonly SymbolCell[];
  size: number;
  orientation: HexOrientation;
  /**
   * Spielen: Zeichen auf unentdeckten Feldern stehen oben nur gedämpft da; unter der Erde fehlen
   * sie – dort ist Unentdecktes nur eine Ahnung.
   */
  fog: boolean;
  /** Oben stehen die Zeichen unter dem Gangnetz, unten darauf – deshalb zwei Schichten. */
  where: 'land' | 'cave';
}) {
  const items = useMemo(() => {
    const byKey = new Map(cells.map((cell) => [`${cell.hex.q},${cell.hex.r}`, cell]));
    const out: { key: string; href: string; x: number; y: number; width: number; dim: boolean }[] =
      [];
    for (const cell of cells) {
      const list = where === 'land' ? symbolsOf(cell.hex) : caveSymbolsOf(cell.hex);
      if (!list?.length) continue;
      if (where === 'cave' && fog && !cell.hex.discovered) continue;
      const { q, r } = cell.hex;
      const fit = FIT[kindKeyOf(cell.hex) ?? ''] ?? DEFAULT_FIT;
      const dim = fog && !cell.hex.discovered;
      if (!fit.scatter) {
        if (fit.share !== undefined && fixed(q, r, 6) > fit.share) continue;
        out.push({
          key: `${q},${r}`,
          href: list[Math.floor(fixed(q, r, 1) * list.length) % list.length]!,
          // Der Fuß der Gruppe: unten im Feld, ein wenig versetzt – nie in einer Reihe.
          x: cell.x + (fixed(q, r, 4) - 0.5) * size * 0.14,
          y: cell.y + size * fit.foot + (fixed(q, r, 5) - 0.5) * size * 0.1,
          width: size * fit.width * (0.94 + fixed(q, r, 3) * 0.12),
          dim,
        });
        continue;
      }
      // Verteilt: ein Platz in der Mitte, sechs im Ring. Zum Nachbarn hin, mit dem die Höhle
      // zusammenhängt, liegt der Platz weiter außen – zur Wand hin bleibt er im Feld.
      for (let slot = 0; slot < 7; slot++) {
        if (fixed(q, r, 10 + slot) > (fit.share ?? 1)) continue;
        let dx = 0;
        let dy = 0;
        if (slot > 0) {
          const d = HEX_DIRECTIONS[slot - 1]!;
          const other = byKey.get(`${q + d.q},${r + d.r}`);
          const reach = other && isOpenCave(other.hex) ? RING : RING_AT_WALL;
          const way = hexCenter(d, orientation);
          dx = way.x * reach;
          dy = way.y * reach;
        }
        out.push({
          key: `${q},${r},${slot}`,
          href: list[Math.floor(fixed(q, r, 20 + slot) * list.length) % list.length]!,
          x: cell.x + (dx + (fixed(q, r, 30 + slot) - 0.5) * 0.12) * size,
          y: cell.y + (dy + fit.foot + (fixed(q, r, 40 + slot) - 0.5) * 0.1) * size,
          width: size * fit.width * (0.8 + fixed(q, r, 50 + slot) * 0.4),
          dim,
        });
      }
    }
    // Von hinten nach vorn: Was weiter unten steht, verdeckt, was darüber steht.
    return out.sort((a, b) => a.y - b.y || a.x - b.x);
  }, [cells, size, orientation, fog, where]);
  if (!items.length) return null;
  return (
    <g className="wf-hexsym" pointerEvents="none">
      {items.map((item) => (
        <image
          key={item.key}
          href={item.href}
          // Die Gruppe steht auf ihrem Fuß: unten mittig verankert, nie verzerrt.
          x={-item.width / 2}
          y={-item.width}
          width={item.width}
          height={item.width}
          preserveAspectRatio="xMidYMax meet"
          // Nie gespiegelt: Das Licht kommt auf der ganzen Karte von oben links.
          transform={`translate(${item.x.toFixed(1)} ${item.y.toFixed(1)})`}
          data-dim={item.dim || undefined}
        />
      ))}
    </g>
  );
});
