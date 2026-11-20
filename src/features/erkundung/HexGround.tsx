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
import { hexCenter, type HexOrientation } from '../../domain/hex';
import { kindKeyOf } from '../../domain/hexKinds';
import type { Hex } from '../../domain/schema';
import { caveOutline, outlinePath } from './caveOutline';
import ruins from '../../ui/assets/hexkarte/deep-ruins.webp';
import arctic from '../../ui/assets/hexkarte/oben/arctic.webp';
import badlands from '../../ui/assets/hexkarte/oben/badlands.webp';
import bog from '../../ui/assets/hexkarte/oben/bog.webp';
import canyon from '../../ui/assets/hexkarte/oben/canyon.webp';
import coast from '../../ui/assets/hexkarte/oben/coast.webp';
import crag from '../../ui/assets/hexkarte/oben/crag.webp';
import deadForest from '../../ui/assets/hexkarte/oben/dead-forest.webp';
import denseForest from '../../ui/assets/hexkarte/oben/dense-forest.webp';
import desert from '../../ui/assets/hexkarte/oben/desert.webp';
import dunes from '../../ui/assets/hexkarte/oben/dunes.webp';
import farmland from '../../ui/assets/hexkarte/oben/farmland.webp';
import forest from '../../ui/assets/hexkarte/oben/forest.webp';
import glacier from '../../ui/assets/hexkarte/oben/glacier.webp';
import glade from '../../ui/assets/hexkarte/oben/glade.webp';
import grassland from '../../ui/assets/hexkarte/oben/grassland.webp';
import heath from '../../ui/assets/hexkarte/oben/heath.webp';
import highpeak from '../../ui/assets/hexkarte/oben/highpeak.webp';
import hills from '../../ui/assets/hexkarte/oben/hills.webp';
import jungle from '../../ui/assets/hexkarte/oben/jungle.webp';
import lake from '../../ui/assets/hexkarte/oben/lake.webp';
import lava from '../../ui/assets/hexkarte/oben/lava.webp';
import mangrove from '../../ui/assets/hexkarte/oben/mangrove.webp';
import marsh from '../../ui/assets/hexkarte/oben/marsh.webp';
import meadow from '../../ui/assets/hexkarte/oben/meadow.webp';
import mountains from '../../ui/assets/hexkarte/oben/mountains.webp';
import oasis from '../../ui/assets/hexkarte/oben/oasis.webp';
import pine from '../../ui/assets/hexkarte/oben/pine.webp';
import reef from '../../ui/assets/hexkarte/oben/reef.webp';
import salt from '../../ui/assets/hexkarte/oben/salt.webp';
import savanna from '../../ui/assets/hexkarte/oben/savanna.webp';
import steppe from '../../ui/assets/hexkarte/oben/steppe.webp';
import swamp from '../../ui/assets/hexkarte/oben/swamp.webp';
import tundra from '../../ui/assets/hexkarte/oben/tundra.webp';
import urban from '../../ui/assets/hexkarte/oben/urban.webp';
import village from '../../ui/assets/hexkarte/oben/village.webp';
import water from '../../ui/assets/hexkarte/oben/water.webp';

export interface LandGround {
  /** Die gemalte Kachel. */
  src: string;
  /**
   * Wie stark die Farbe der Geländeart (`--terrain-<art>`) darüberliegt (0–1): für Arten, die
   * sich eine Kachel mit einer anderen teilen.
   */
  tint: number;
  /** Ein Wahrzeichen: Diese Art trägt zusätzlich ihr gezeichnetes Zeichen (Vulkan, Krater). */
  mark?: boolean;
}

/**
 * Der Boden je Geländeart der Oberwelt, von unten nach oben: Was später steht, greift an der
 * Grenze über das, was früher steht – Wasser liegt am tiefsten, Gebirge und Siedlungen obenauf.
 * Eine neue Art mit eigenem Boden: Kachel nach `ui/assets/hexkarte/oben`, Eintrag hier.
 */
export const LAND_GROUND: Readonly<Record<string, LandGround>> = {
  water: { src: water, tint: 0 },
  reef: { src: reef, tint: 0 },
  lake: { src: lake, tint: 0 },
  coast: { src: coast, tint: 0 },
  swamp: { src: swamp, tint: 0 },
  marsh: { src: marsh, tint: 0 },
  bog: { src: bog, tint: 0 },
  mangrove: { src: mangrove, tint: 0 },
  salt: { src: salt, tint: 0 },
  desert: { src: desert, tint: 0 },
  dunes: { src: dunes, tint: 0 },
  badlands: { src: badlands, tint: 0 },
  arctic: { src: arctic, tint: 0 },
  glacier: { src: glacier, tint: 0 },
  tundra: { src: tundra, tint: 0 },
  steppe: { src: steppe, tint: 0 },
  savanna: { src: savanna, tint: 0 },
  grassland: { src: grassland, tint: 0 },
  valley: { src: grassland, tint: 0.3 },
  meadow: { src: meadow, tint: 0 },
  heath: { src: heath, tint: 0 },
  farmland: { src: farmland, tint: 0 },
  oasis: { src: oasis, tint: 0 },
  glade: { src: glade, tint: 0 },
  'dead-forest': { src: deadForest, tint: 0 },
  forest: { src: forest, tint: 0 },
  pine: { src: pine, tint: 0 },
  jungle: { src: jungle, tint: 0 },
  'dense-forest': { src: denseForest, tint: 0 },
  hills: { src: hills, tint: 0 },
  crag: { src: crag, tint: 0 },
  crater: { src: crag, tint: 0.3, mark: true },
  canyon: { src: canyon, tint: 0 },
  lava: { src: lava, tint: 0 },
  mountains: { src: mountains, tint: 0 },
  volcano: { src: lava, tint: 0.22, mark: true },
  highpeak: { src: highpeak, tint: 0 },
  ruins: { src: ruins, tint: 0 },
  village: { src: village, tint: 0 },
  urban: { src: urban, tint: 0 },
};
const LAND_ORDER = Object.keys(LAND_GROUND);

/** Wasser: Es liegt am tiefsten und bekommt am Ufer einen hellen Saum. */
const WET = new Set(['water', 'reef', 'lake']);

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
 * Feldkante bei 0,5): etwas über die Kante hinaus, damit die Grenze frei im tieferen Gelände
 * verläuft und nie als gerade Kante stehen bleibt.
 */
const REACH = 0.61;
const ROUGH = 0.1;

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
  if (!groups.length) return null;
  return (
    <g className="wf-hexland" pointerEvents="none" style={{ ['--hex' as string]: `${size}px` }}>
      {/* Erst jedes Feld mit seinem Boden – so bleibt nirgends eine Lücke. */}
      {groups.map(({ kind, base }) => (
        <path key={kind} d={base} fill={`url(#wf-hex-land-${kind})`} />
      ))}
      {/* Dann von unten nach oben: Das höhere Gelände greift frei geformt über das tiefere. */}
      {groups.map(({ kind, loops }) => {
        const d = outlinePath(loops, size);
        const paint = `url(#wf-hex-land-${kind})`;
        return (
          <g key={kind} data-wet={WET.has(kind) || undefined}>
            <path className="wf-hexland__shade" d={d} />
            <path className="wf-hexland__fade" d={d} stroke={paint} />
            <path d={d} fill={paint} fillRule="evenodd" />
            <path className="wf-hexland__edge" d={d} />
          </g>
        );
      })}
    </g>
  );
});
