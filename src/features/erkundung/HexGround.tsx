/**
 * Der gemalte Boden der Oberwelt (Wunsch des Spielleiters, 20. 11. 2026: „Verbessere … das
 * gesamte Hexkarten-Ding“ – nach „Die Zeichen passen auch nicht, es sollte das Gelände verändert
 * werden, also eine andere Textur“ für das Unterreich): Ein Feld ist kein Farbfleck mit
 * Strichzeichen mehr, sondern trägt den gemalten Boden seiner Geländeart – Baumkronen von oben,
 * Grate, Dünen, Wellen. Zwischen zwei Geländen läuft die Grenze nicht an der Feldkante entlang:
 * Das höhere Gelände greift frei geformt ein Stück über das tiefere (derselbe gerechnete Umriss
 * wie unter der Erde, `caveOutline.ts`), fest je Stelle. Die Regeln rechnen weiter mit Feldern –
 * das hier ist nur ihr Bild.
 */
import { memo, useMemo, useRef } from 'react';
import { HEX_DIRECTIONS, hexCenter, type HexOrientation } from '../../domain/hex';
import { kindKeyOf } from '../../domain/hexKinds';
import type { Hex } from '../../domain/schema';
import { caveOutline, outlinePath } from './caveOutline';
import arctic from '../../ui/assets/hexkarte/oben/arctic.webp';
import badlands from '../../ui/assets/hexkarte/oben/badlands.webp';
import bog from '../../ui/assets/hexkarte/oben/bog.webp';
import canyon from '../../ui/assets/hexkarte/oben/canyon.webp';
import coast from '../../ui/assets/hexkarte/oben/coast.webp';
import crag from '../../ui/assets/hexkarte/oben/crag.webp';
import desert from '../../ui/assets/hexkarte/oben/desert.webp';
import dunes from '../../ui/assets/hexkarte/oben/dunes.webp';
import farmland from '../../ui/assets/hexkarte/oben/farmland.webp';
import glacier from '../../ui/assets/hexkarte/oben/glacier.webp';
import grassland from '../../ui/assets/hexkarte/oben/grassland.webp';
import heath from '../../ui/assets/hexkarte/oben/heath.webp';
import lake from '../../ui/assets/hexkarte/oben/lake.webp';
import lava from '../../ui/assets/hexkarte/oben/lava.webp';
import marsh from '../../ui/assets/hexkarte/oben/marsh.webp';
import meadow from '../../ui/assets/hexkarte/oben/meadow.webp';
import reef from '../../ui/assets/hexkarte/oben/reef.webp';
import salt from '../../ui/assets/hexkarte/oben/salt.webp';
import steppe from '../../ui/assets/hexkarte/oben/steppe.webp';
import swamp from '../../ui/assets/hexkarte/oben/swamp.webp';
import tundra from '../../ui/assets/hexkarte/oben/tundra.webp';
import water from '../../ui/assets/hexkarte/oben/water.webp';

export interface LandGround {
  /** Die gemalte Kachel. */
  src: string;
  /**
   * Wie stark die Farbe der Geländeart (`--terrain-<art>`) darüberliegt (0–1): für Arten, die
   * sich eine Kachel mit einer anderen teilen.
   */
  tint: number;
}

/**
 * Der Boden je Geländeart der Oberwelt, von unten nach oben: Was später steht, greift an der
 * Grenze über das, was früher steht – Wasser liegt am tiefsten, Gebirge und Siedlungen obenauf.
 *
 * Der Boden ist **ruhig**: Er zeigt nur, was flach liegt (Gras, Sand, Wasser, Felder). Was
 * aufragt – Bäume, Berge, Häuser –, steht als gemaltes Zeichen darauf (`HexSymbols.tsx`); solche
 * Arten tragen einen schlichten Boden in ihrer Farbe. Eine neue Art: Kachel nach
 * `ui/assets/hexkarte/oben` (oder eine vorhandene mit `tint`), Eintrag hier.
 */
export const LAND_GROUND: Readonly<Record<string, LandGround>> = {
  water: { src: water, tint: 0 },
  reef: { src: reef, tint: 0 },
  lake: { src: lake, tint: 0 },
  coast: { src: coast, tint: 0 },
  swamp: { src: swamp, tint: 0 },
  marsh: { src: marsh, tint: 0 },
  bog: { src: bog, tint: 0 },
  mangrove: { src: swamp, tint: 0.3 },
  salt: { src: salt, tint: 0 },
  desert: { src: desert, tint: 0 },
  dunes: { src: dunes, tint: 0 },
  badlands: { src: badlands, tint: 0 },
  arctic: { src: arctic, tint: 0 },
  glacier: { src: glacier, tint: 0 },
  tundra: { src: tundra, tint: 0 },
  steppe: { src: steppe, tint: 0 },
  savanna: { src: steppe, tint: 0.3 },
  grassland: { src: grassland, tint: 0 },
  valley: { src: grassland, tint: 0.3 },
  meadow: { src: meadow, tint: 0 },
  heath: { src: heath, tint: 0 },
  farmland: { src: farmland, tint: 0 },
  oasis: { src: desert, tint: 0.16 },
  glade: { src: grassland, tint: 0.22 },
  'dead-forest': { src: steppe, tint: 0.5 },
  forest: { src: grassland, tint: 0.42 },
  pine: { src: grassland, tint: 0.5 },
  jungle: { src: grassland, tint: 0.4 },
  'dense-forest': { src: grassland, tint: 0.58 },
  hills: { src: grassland, tint: 0.34 },
  crag: { src: crag, tint: 0 },
  crater: { src: crag, tint: 0.3 },
  canyon: { src: canyon, tint: 0 },
  lava: { src: lava, tint: 0 },
  mountains: { src: crag, tint: 0.34 },
  volcano: { src: lava, tint: 0.22 },
  highpeak: { src: arctic, tint: 0.24 },
  ruins: { src: grassland, tint: 0.36 },
  // Um Dorf und Stadt liegen Felder.
  village: { src: farmland, tint: 0.12 },
  urban: { src: farmland, tint: 0.36 },
};
const LAND_ORDER = Object.keys(LAND_GROUND);

/** Wasser: Es liegt am tiefsten; wo Land daran grenzt, steht ein Ufersaum. */
const WET: ReadonlySet<string> = new Set(['water', 'reef', 'lake']);
/** Wie weit das seichte Wasser vom Land aus reicht – von der Mitte des Landfeldes, in Feldgrößen. */
const SHALLOWS = 0.8;

/**
 * Was sich über seine Umgebung erhebt und deshalb einen weichen Schatten wirft: Wälder, Höhen,
 * Siedlungen. Alles andere liegt flach und läuft nur aus.
 */
const RAISED = new Set([
  'glade',
  'dead-forest',
  'forest',
  'pine',
  'jungle',
  'dense-forest',
  'mangrove',
  'hills',
  'crag',
  'crater',
  'canyon',
  'mountains',
  'volcano',
  'highpeak',
  'ruins',
  'village',
  'urban',
]);

/**
 * Der weiche Übergang (Rückmeldung des Spielleiters, 20. 11. 2026: „Die Biome sollten irgendwie
 * auch ein wenig nicer blenden“): Ein Gelände endet nicht an einer Kante, sondern läuft ins
 * Nachbargelände aus. Gemalt als Lagen desselben Bodens, jede schmaler und deckender als die
 * davor – zusammen ein Verlauf von durchscheinend (außen) zu deckend (am Umriss). Kein Filter:
 * Das bleibt auch auf großen Karten und beim Vergrößern flüssig.
 *
 * `width`: Breite der Lage in Feldgrößen (die Hälfte davon reicht nach außen); `alpha`: so
 * gewählt, dass die Deckkraft von außen nach innen gleichmäßig steigt.
 */
const FEATHER: readonly { width: number; alpha: number }[] = [
  { width: 0.5, alpha: 0.1 },
  { width: 0.43, alpha: 0.111 },
  { width: 0.36, alpha: 0.125 },
  { width: 0.29, alpha: 0.143 },
  { width: 0.22, alpha: 0.2 },
  { width: 0.15, alpha: 0.25 },
  { width: 0.09, alpha: 0.4 },
  { width: 0.04, alpha: 0.6 },
];

/** Ein Umriss, der weich ausläuft: die Lagen des Verlaufs. `scale` macht ihn schmaler oder breiter. */
export function Feather({ d, paint, scale = 1 }: { d: string; paint: string; scale?: number }) {
  return (
    <g className="wf-hex-feather">
      {FEATHER.map(({ width, alpha }) => (
        <path
          key={width}
          d={d}
          stroke={paint}
          strokeOpacity={alpha}
          style={{ strokeWidth: `calc(var(--hex) * ${(width * scale).toFixed(3)})` }}
        />
      ))}
    </g>
  );
}

/** Hat dieses Feld einen gemalten Boden der Oberwelt? */
export const landGroundOf = (hex: Pick<Hex, 'kind' | 'terrain' | 'exits'>): LandGround | null =>
  hex.terrain && hex.exits === null && hex.terrain !== 'underdark'
    ? (LAND_GROUND[kindKeyOf(hex) ?? ''] ?? null)
    : null;

export interface GroundCell {
  hex: Hex;
  points: string;
}

/** Die gemalten Flächen der Oberwelt – einmal je Karte. */
export function GroundDefs({ size }: { size: number }) {
  const tile = Math.max(80, size * 2.6);
  return (
    <defs>
      {LAND_ORDER.map((kind) => {
        const ground = LAND_GROUND[kind]!;
        return (
          <pattern
            key={kind}
            id={`wf-hex-land-${kind}`}
            patternUnits="userSpaceOnUse"
            width={tile}
            height={tile}
          >
            <image href={ground.src} width={tile} height={tile} preserveAspectRatio="none" />
            {ground.tint > 0 && (
              <rect
                width={tile}
                height={tile}
                opacity={ground.tint}
                style={{ fill: `var(--terrain-${kind})` }}
              />
            )}
          </pattern>
        );
      })}
    </defs>
  );
}

/** Eine feste Zahl aus einem Wort – unterscheidet die Geländearten im Rauschen. */
const saltOf = (text: string): number => {
  let h = 7;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 9973;
  return h;
};

/**
 * Wie weit ein Gelände von der Mitte seines Feldes reicht (Nachbarn liegen 1 auseinander, die
 * Feldkante bei 0,5): knapp über die Kante hinaus, damit die Grenze frei im tieferen Gelände
 * verläuft und nie als gerade Kante stehen bleibt – der weiche Auslauf kommt noch dazu.
 */
const REACH = 0.57;
const ROUGH = 0.12;

export const GroundLayer = memo(function GroundLayer({
  cells,
  size,
  orientation,
}: {
  cells: readonly GroundCell[];
  size: number;
  orientation: HexOrientation;
}) {
  // Die Umrisse hängen nur daran, welche Felder eine Art hat – nicht an der Vergrößerung, und
  // beim Malen ändern sich nur die Arten unter dem Pinsel: je Art gemerkt.
  const cache = useRef(new Map<string, { sig: string; loops: number[][] }>());
  const groups = useMemo(() => {
    const by = new Map<string, GroundCell[]>();
    for (const cell of cells) {
      if (!landGroundOf(cell.hex)) continue;
      const kind = kindKeyOf(cell.hex)!;
      const list = by.get(kind);
      if (list) list.push(cell);
      else by.set(kind, [cell]);
    }
    return LAND_ORDER.filter((kind) => by.has(kind)).map((kind) => {
      const list = by.get(kind)!;
      const sig = orientation + list.map((cell) => `${cell.hex.q},${cell.hex.r}`).join(';');
      let hit = cache.current.get(kind);
      if (!hit || hit.sig !== sig) {
        hit = {
          sig,
          loops: caveOutline(
            list.map((cell) => {
              const c = hexCenter(cell.hex, orientation);
              return { x1: c.x, y1: c.y, r: REACH };
            }),
            { rough: ROUGH, step: 0.125, salt: saltOf(kind) },
          ),
        };
        cache.current.set(kind, hit);
      }
      return {
        kind,
        base: list.map((cell) => `M ${cell.points.replace(/ /g, ' L ')} Z`).join(' '),
        loops: hit.loops,
      };
    });
  }, [cells, orientation]);
  // Der Ufersaum: seichtes Wasser und eine helle Linie vor jeder Küste – gerechnet aus den
  // Landfeldern, die an Wasser grenzen, gezeigt nur auf dem Wasser.
  const shoreCache = useRef<{ sig: string; loops: number[][] } | null>(null);
  const shore = useMemo(() => {
    const wet = new Set<string>();
    const wetCells: GroundCell[] = [];
    for (const cell of cells)
      if (landGroundOf(cell.hex) && WET.has(kindKeyOf(cell.hex)!)) {
        wet.add(`${cell.hex.q},${cell.hex.r}`);
        wetCells.push(cell);
      }
    if (!wetCells.length) return null;
    const coast = cells.filter(
      (cell) =>
        landGroundOf(cell.hex) &&
        !wet.has(`${cell.hex.q},${cell.hex.r}`) &&
        HEX_DIRECTIONS.some((d) => wet.has(`${cell.hex.q + d.q},${cell.hex.r + d.r}`)),
    );
    if (!coast.length) return null;
    const sig = orientation + coast.map((cell) => `${cell.hex.q},${cell.hex.r}`).join(';');
    if (shoreCache.current?.sig !== sig)
      shoreCache.current = {
        sig,
        loops: caveOutline(
          coast.map((cell) => {
            const c = hexCenter(cell.hex, orientation);
            return { x1: c.x, y1: c.y, r: SHALLOWS };
          }),
          { rough: 0.09, step: 0.125, salt: 4711 },
        ),
      };
    return {
      loops: shoreCache.current.loops,
      water: wetCells.map((cell) => `M ${cell.points.replace(/ /g, ' L ')} Z`).join(' '),
    };
  }, [cells, orientation]);
  if (!groups.length) return null;
  /** Ein Gelände über dem, was tiefer liegt: frei geformt, weich auslaufend. */
  const over = ({ kind, loops }: (typeof groups)[number]) => {
    const d = outlinePath(loops, size);
    const paint = `url(#wf-hex-land-${kind})`;
    return (
      <g key={kind}>
        {RAISED.has(kind) && <path className="wf-hexland__shade" d={d} />}
        <Feather d={d} paint={paint} scale={0.6} />
        <path d={d} fill={paint} fillRule="evenodd" />
      </g>
    );
  };
  const shoreLine = shore ? outlinePath(shore.loops, size) : '';
  return (
    <g className="wf-hexland" pointerEvents="none" style={{ ['--hex' as string]: `${size}px` }}>
      {/* Erst jedes Feld mit seinem Boden – so bleibt nirgends eine Lücke. */}
      {groups.map(({ kind, base }) => (
        <path key={kind} d={base} fill={`url(#wf-hex-land-${kind})`} />
      ))}
      {/* Dann von unten nach oben: Das höhere Gelände greift frei geformt über das tiefere. */}
      {groups.filter((group) => WET.has(group.kind)).map(over)}
      {shore && (
        <g className="wf-hexland__shore">
          <clipPath id="wf-hexland-water">
            <path d={shore.water} />
          </clipPath>
          <g clipPath="url(#wf-hexland-water)">
            <path className="wf-hexland__shallows" d={shoreLine} fillRule="evenodd" />
            <path className="wf-hexland__foam" d={shoreLine} />
          </g>
        </g>
      )}
      {groups.filter((group) => !WET.has(group.kind)).map(over)}
    </g>
  );
});
