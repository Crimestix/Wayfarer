/**
 * Geländearten erzeugen (Wunsch des Spielleiters, 17. 11.: „Ja, auf jeden Fall – aber Unterreich
 * und Oberwelt ist ein massiver Unterschied“). Zwei getrennte Regelwerke, beide fest und
 * wiederholbar (gleicher Ausgangswert → gleiche Karte), beide ändern nur das Aussehen (`hex.kind`) –
 * das Grundgelände und damit Tempo, Sicht und Orientierung bleiben, wie der Erzeuger sie gesetzt hat.
 *
 * - **Oben** folgen die Arten Höhe, Feuchte, Klima und Nachbarschaft: Ackerland um Orte, dichter
 *   Wald tief im Wald, Nadelwald in Kälte und Höhe, Dschungel in feuchter Hitze, Marsch am Wasser,
 *   Hochgebirge auf den höchsten Gipfeln, höchstens ein Vulkan, Dünen mitten in der Wüste, Seen im
 *   Land statt Meer.
 * - **Unten** folgen sie dem Höhlennetz: was eine Höhle ist (Pilzwald, Kristallgrotte, See, warme
 *   Quelle), wie tief sie liegt (Glut nur tief unten) und wo Wasser fließt (Pilze am Fluss).
 *   Gänge bleiben Höhlengang. Klima und Tageslicht zählen dort nicht.
 */
import { hexDistance, hexKey, hexNeighbors } from '../../domain/hex';
import { rngOf, seedOf } from '../../domain/random';
import type { Hex, Terrain } from '../../domain/schema';
import type { ClimatePreset } from '../../domain/weather';

export type Warmth = 'hot' | 'temperate' | 'cold';

/** Wie warm es ist: aus dem Klima des Planeten, sonst aus der Landschaft. */
export function warmthOf(climate: ClimatePreset | null | undefined, biome: Terrain): Warmth {
  switch (climate) {
    case 'desert':
    case 'tropical':
    case 'warm':
      return 'hot';
    case 'cold':
    case 'arctic':
    case 'mountain':
      return 'cold';
    case 'temperate':
    case 'maritime':
      return 'temperate';
    default:
      return biome === 'desert' ? 'hot' : biome === 'arctic' ? 'cold' : 'temperate';
  }
}

/** Was der Erzeuger über ein Feld weiß: Höhe, Feuchte und ein ruhiges Muster für Flecken (je 0–1). */
export interface Field {
  height: number;
  wet: number;
  patch: number;
}

/**
 * Oben: die Art eines Feldes aus seinem Grundgelände und dem, was ringsum liegt. null = das
 * Grundgelände selbst. Reine Regel – `pick` ist ein fester Zufall je Feld (0–1).
 */
export function surfaceKind(
  hex: Pick<Hex, 'terrain'>,
  field: Field,
  around: readonly (Terrain | null)[],
  warmth: Warmth,
  nearPlace: boolean,
  innerWater: boolean,
  pick: number,
): string | null {
  const count = (terrain: Terrain) => around.filter((t) => t === terrain).length;
  const { height, wet, patch } = field;
  switch (hex.terrain) {
    case 'grassland':
      if (nearPlace && wet > 0.3) return 'farmland';
      if (count('desert') >= 2) return 'oasis';
      if (count('hills') + count('mountains') >= 3 && height < 0.4) return 'valley';
      if (warmth === 'hot') return wet < 0.4 ? 'savanna' : patch > 0.6 ? 'meadow' : null;
      if (warmth === 'cold') return wet < 0.45 ? 'heath' : null;
      // Steppe nur in offenem Land – neben Wald ist trockenes Grasland eine Wiese oder Heide.
      if (wet < 0.25 && count('forest') === 0) return 'steppe';
      if (height > 0.58 && patch > 0.45) return 'heath';
      return patch > 0.5 ? 'meadow' : null;
    case 'forest':
      if (warmth === 'hot' && wet > 0.55) return 'jungle';
      if (warmth === 'cold' || height > 0.68 || count('mountains') >= 2) return 'pine';
      if (count('forest') === 6 && wet > 0.5) return 'dense-forest';
      if (count('swamp') >= 2 && pick < 0.25) return 'dead-forest';
      if (count('grassland') >= 3 && patch < 0.3) return 'glade';
      return null;
    case 'swamp':
      if (warmth === 'hot' && count('coast') + count('water') >= 2) return 'mangrove';
      if (count('water') + count('coast') >= 1) return 'marsh';
      if (warmth === 'cold' || wet > 0.7 || patch > 0.6) return 'bog';
      return null;
    case 'hills':
      if (warmth === 'hot' && wet < 0.3 && patch > 0.6) return 'canyon';
      if (height > 0.76 || count('mountains') >= 3) return 'crag';
      return null;
    case 'mountains':
      if (count('mountains') >= 5 || height > 0.92) return 'highpeak';
      return null;
    case 'desert':
      if (count('hills') + count('mountains') >= 2) return 'badlands';
      if (height < 0.26 && patch > 0.5) return 'salt';
      if (count('desert') === 6) return 'dunes';
      return null;
    case 'arctic':
      if (count('mountains') >= 2) return 'glacier';
      if (height < 0.45 || patch < 0.35) return 'tundra';
      return null;
    case 'water':
      if (innerWater) return 'lake';
      if (warmth !== 'cold' && count('coast') >= 2 && pick < 0.15) return 'reef';
      return null;
    default:
      return null;
  }
}

/** Oben: allen erzeugten Feldern ihre Art geben; höchstens ein Vulkan auf dem höchsten Gipfel. */
export function assignSurfaceKinds(
  hexes: Hex[],
  fields: ReadonlyMap<string, Field>,
  warmth: Warmth,
  seed: number,
): void {
  const byKey = new Map(hexes.map((hex) => [hexKey(hex), hex]));
  const places = hexes.filter((hex) => hex.placeId);
  const inner = innerWaters(hexes, byKey);
  for (const hex of hexes) {
    const field = fields.get(hexKey(hex));
    if (!field || !hex.terrain || hex.manual) continue;
    const around = hexNeighbors(hex).map((n) => byKey.get(hexKey(n))?.terrain ?? null);
    const nearPlace = places.some((place) => place !== hex && hexDistance(place, hex) <= 2);
    const pick = rngOf(seedOf(seed, 'art', hex.q, hex.r)).next();
    hex.kind = surfaceKind(hex, field, around, warmth, nearPlace, inner.has(hex), pick);
  }
  // Ein Vulkan: der höchste Gipfel, wenn es ein Gebirge gibt – und nur manchmal.
  const peaks = hexes.filter((hex) => hex.terrain === 'mountains' && !hex.placeId && !hex.manual);
  if (peaks.length >= 4 && rngOf(seedOf(seed, 'vulkan')).chance(0.35)) {
    const top = peaks.reduce((a, b) =>
      (fields.get(hexKey(b))?.height ?? 0) > (fields.get(hexKey(a))?.height ?? 0) ? b : a,
    );
    top.kind = 'volcano';
    for (const n of hexNeighbors(top)) {
      const next = byKey.get(hexKey(n));
      if (next?.terrain === 'mountains' && !next.placeId && !next.manual) next.kind = 'lava';
    }
  }
}

/**
 * Wasser, das nicht ans Meer reicht: zusammenhängende Wasserfelder, die den Rand der Karte nicht
 * berühren – ein See statt Meer.
 */
function innerWaters(hexes: readonly Hex[], byKey: ReadonlyMap<string, Hex>): Set<Hex> {
  const out = new Set<Hex>();
  const seen = new Set<Hex>();
  const edge = (hex: Hex) => hexNeighbors(hex).some((n) => !byKey.has(hexKey(n)));
  for (const start of hexes) {
    if (start.terrain !== 'water' || seen.has(start)) continue;
    const group: Hex[] = [];
    const queue = [start];
    seen.add(start);
    let open = false;
    while (queue.length) {
      const hex = queue.pop()!;
      group.push(hex);
      if (edge(hex)) open = true;
      for (const n of hexNeighbors(hex)) {
        const next = byKey.get(hexKey(n));
        if (next?.terrain === 'water' && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    if (!open && group.length <= 40) for (const hex of group) out.add(hex);
  }
  return out;
}

/**
 * Unten: die Art eines Feldes aus dem Höhlennetz. Eine Höhle trägt ihr Gepräge (der Name ihrer
 * Besonderheit), Gänge bleiben Höhlengang – nur nahe am Wasser wachsen Pilze, und tief unten
 * glüht es in Spalten. null = Höhlengang.
 */
export function caveKind(
  hex: Pick<Hex, 'feature' | 'river' | 'level'>,
  role: 'cave' | 'tunnel' | 'junction' | 'deadend' | 'place' | 'rock',
  levels: number,
  nearWater: boolean,
  patch: number,
): string | null {
  if (role === 'rock') return null;
  const feature = hex.feature.toLowerCase();
  if (/pilz|moos/.test(feature)) return 'fungus';
  if (/kristall/.test(feature)) return 'crystal';
  if (/see\b|see$|wasser|senkloch/.test(feature)) return 'deep-lake';
  if (/quell|schlot|warm/.test(feature)) return 'magma';
  const deepest = levels > 1 && hex.level === levels - 1;
  if (role === 'cave') {
    if (deepest && patch > 0.55) return 'magma';
    if (nearWater && patch > 0.4) return 'fungus';
    if (hex.level > 0 && patch < 0.25) return 'crystal';
    return null;
  }
  if (nearWater && !hex.river && patch > 0.7) return 'fungus';
  if (deepest && patch > 0.85) return 'magma';
  return null;
}
