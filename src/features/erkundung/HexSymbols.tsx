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
import { kindKeyOf } from '../../domain/hexKinds';
import type { Hex } from '../../domain/schema';

const FILES = import.meta.glob('../../ui/assets/hexkarte/bild/*.webp', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

/** Die Zeichen je Geländeart: alle Dateien `<art>-<nummer>.webp`. */
export const LAND_SYMBOLS: Readonly<Record<string, readonly string[]>> = (() => {
  const out: Record<string, string[]> = {};
  for (const path of Object.keys(FILES).sort()) {
    const name = path.slice(path.lastIndexOf('/') + 1).replace(/-\d+\.webp$/, '');
    (out[name] ??= []).push(FILES[path]!);
  }
  return out;
})();

/**
 * Wie eine Gruppe im Feld steht: `width` (1 = so breit wie das Feld), `foot` (wie tief ihr Fuß
 * unter der Feldmitte sitzt) und `share` – auf wie vielen Feldern der Art überhaupt eine steht
 * (ohne Angabe auf jedem). Was dicht steht (Wald, Gebirge), ragt über die Feldkante; was vereinzelt
 * steht (Schilf, Felsnadeln, Eiszacken), lässt Felder frei.
 */
const FIT: Readonly<Record<string, { width: number; foot: number; share?: number }>> = {
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
  urban: { width: 1.5, foot: 0.44 },
  village: { width: 1.25, foot: 0.4 },
  ruins: { width: 1.2, foot: 0.4 },
};
const DEFAULT_FIT: { width: number; foot: number; share?: number } = { width: 1.36, foot: 0.48 };

/** Eine feste Zahl zwischen 0 und 1 aus Feld und Wort – dieselbe an jedem Rechner. */
function fixed(q: number, r: number, salt: number): number {
  let h = (q * 374761393 + r * 668265263 + salt * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** Hat diese Geländeart gemalte Zeichen? */
export const symbolsOf = (hex: Pick<Hex, 'kind' | 'terrain' | 'exits'>): readonly string[] | null =>
  hex.terrain && hex.exits === null && hex.terrain !== 'underdark'
    ? (LAND_SYMBOLS[kindKeyOf(hex) ?? ''] ?? null)
    : null;

export interface SymbolCell {
  hex: Hex;
  x: number;
  y: number;
}

export const SymbolLayer = memo(function SymbolLayer({
  cells,
  size,
  fog,
}: {
  cells: readonly SymbolCell[];
  size: number;
  /** Spielen: Zeichen auf unentdeckten Feldern stehen nur gedämpft da. */
  fog: boolean;
}) {
  const items = useMemo(
    () =>
      cells
        .map((cell) => {
          const list = symbolsOf(cell.hex);
          if (!list?.length) return null;
          const { q, r } = cell.hex;
          const fit = FIT[kindKeyOf(cell.hex) ?? ''] ?? DEFAULT_FIT;
          if (fit.share !== undefined && fixed(q, r, 6) > fit.share) return null;
          const width = size * fit.width * (0.94 + fixed(q, r, 3) * 0.12);
          return {
            key: `${q},${r}`,
            href: list[Math.floor(fixed(q, r, 1) * list.length) % list.length]!,
            // Der Fuß der Gruppe: unten im Feld, ein wenig versetzt – nie in einer Reihe.
            x: cell.x + (fixed(q, r, 4) - 0.5) * size * 0.14,
            y: cell.y + size * fit.foot + (fixed(q, r, 5) - 0.5) * size * 0.1,
            width,
            dim: fog && !cell.hex.discovered,
          };
        })
        .filter((item): item is NonNullable<typeof item> => !!item)
        // Von hinten nach vorn: Was weiter unten steht, verdeckt, was darüber steht.
        .sort((a, b) => a.y - b.y || a.x - b.x),
    [cells, size, fog],
  );
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
