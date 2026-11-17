/**
 * Geländearten der Hexkarten (Wunsch des Spielleiters, 17. 11.: „verschiedene Terrain-Pinsel“ –
 * und früher: „Gelände, verschiedene Arten … bestimmt Bewegung, Sicht und Orientierung“). Eine
 * Geländeart ist, wie ein Feld aussieht und heißt (Wiese, Moor, Vulkan); für die Regeln zählt ihr
 * Grundgelände (`base`, `hex.terrain`): Tempo, Sicht, Orientierung, Begegnungen. So wird die Karte
 * reich, ohne dass die Simulation neue Regeln braucht.
 *
 * Gespeichert wird die Art am Feld (`hex.kind`); null heißt: das Grundgelände selbst. Jedes
 * Grundgelände ist auch eine Art mit seinem eigenen Schlüssel.
 */
import type { Hex, Terrain } from './schema';
import { TERRAIN_LABEL } from './terrain';

export type KindGroup =
  | 'lowland'
  | 'forest'
  | 'wetland'
  | 'highland'
  | 'arid'
  | 'cold'
  | 'water'
  | 'settled'
  | 'underdark';

export const KIND_GROUP_LABEL: Record<KindGroup, string> = {
  lowland: 'Tiefland',
  forest: 'Wälder',
  wetland: 'Feuchtland',
  highland: 'Hochland',
  arid: 'Trockenland',
  cold: 'Kälte',
  water: 'Wasser',
  settled: 'Besiedelt',
  underdark: 'Unter der Erde',
};

export interface HexKind {
  key: string;
  label: string;
  base: Terrain;
  group: KindGroup;
}

/** Alle Arten, in der Reihenfolge der Palette. Die Grundgelände tragen ihren eigenen Schlüssel. */
export const HEX_KINDS: readonly HexKind[] = [
  { key: 'grassland', label: 'Grasland', base: 'grassland', group: 'lowland' },
  { key: 'meadow', label: 'Wiese', base: 'grassland', group: 'lowland' },
  { key: 'farmland', label: 'Ackerland', base: 'grassland', group: 'lowland' },
  { key: 'valley', label: 'Tal', base: 'grassland', group: 'lowland' },
  { key: 'heath', label: 'Heide', base: 'grassland', group: 'lowland' },
  { key: 'steppe', label: 'Steppe', base: 'grassland', group: 'lowland' },
  { key: 'savanna', label: 'Savanne', base: 'grassland', group: 'lowland' },

  { key: 'forest', label: 'Wald', base: 'forest', group: 'forest' },
  { key: 'dense-forest', label: 'Dichter Wald', base: 'forest', group: 'forest' },
  { key: 'pine', label: 'Nadelwald', base: 'forest', group: 'forest' },
  { key: 'jungle', label: 'Dschungel', base: 'forest', group: 'forest' },
  { key: 'glade', label: 'Lichter Hain', base: 'forest', group: 'forest' },
  { key: 'dead-forest', label: 'Toter Wald', base: 'forest', group: 'forest' },

  { key: 'swamp', label: 'Sumpf', base: 'swamp', group: 'wetland' },
  { key: 'marsh', label: 'Marsch', base: 'swamp', group: 'wetland' },
  { key: 'bog', label: 'Moor', base: 'swamp', group: 'wetland' },
  { key: 'mangrove', label: 'Mangroven', base: 'swamp', group: 'wetland' },

  { key: 'hills', label: 'Hügelland', base: 'hills', group: 'highland' },
  { key: 'crag', label: 'Felsland', base: 'hills', group: 'highland' },
  { key: 'mountains', label: 'Gebirge', base: 'mountains', group: 'highland' },
  { key: 'highpeak', label: 'Hochgebirge', base: 'mountains', group: 'highland' },
  { key: 'volcano', label: 'Vulkan', base: 'mountains', group: 'highland' },
  { key: 'lava', label: 'Lavafeld', base: 'mountains', group: 'highland' },

  { key: 'desert', label: 'Wüste', base: 'desert', group: 'arid' },
  { key: 'dunes', label: 'Dünen', base: 'desert', group: 'arid' },
  { key: 'badlands', label: 'Ödland', base: 'desert', group: 'arid' },
  { key: 'canyon', label: 'Schlucht', base: 'hills', group: 'arid' },
  { key: 'crater', label: 'Krater', base: 'hills', group: 'arid' },
  { key: 'salt', label: 'Salzpfanne', base: 'desert', group: 'arid' },
  { key: 'oasis', label: 'Oase', base: 'grassland', group: 'arid' },

  { key: 'arctic', label: 'Eisland', base: 'arctic', group: 'cold' },
  { key: 'tundra', label: 'Tundra', base: 'arctic', group: 'cold' },
  { key: 'glacier', label: 'Gletscher', base: 'arctic', group: 'cold' },

  { key: 'water', label: 'Meer', base: 'water', group: 'water' },
  { key: 'lake', label: 'See', base: 'water', group: 'water' },
  { key: 'coast', label: 'Küste', base: 'coast', group: 'water' },
  { key: 'reef', label: 'Riff', base: 'water', group: 'water' },

  { key: 'urban', label: 'Siedlung', base: 'urban', group: 'settled' },
  { key: 'village', label: 'Dorf und Weiler', base: 'grassland', group: 'settled' },
  { key: 'ruins', label: 'Ruinenfeld', base: 'hills', group: 'settled' },

  { key: 'underdark', label: 'Höhlengang', base: 'underdark', group: 'underdark' },
  { key: 'fungus', label: 'Pilzwald', base: 'underdark', group: 'underdark' },
  { key: 'crystal', label: 'Kristallhöhle', base: 'underdark', group: 'underdark' },
  { key: 'deep-lake', label: 'Unterirdischer See', base: 'underdark', group: 'underdark' },
  { key: 'magma', label: 'Glutspalten', base: 'underdark', group: 'underdark' },
];

const BY_KEY = new Map(HEX_KINDS.map((kind) => [kind.key, kind]));

/** Die Art zu einem Schlüssel (oder undefined). */
export const hexKind = (key: string | null | undefined): HexKind | undefined =>
  key ? BY_KEY.get(key) : undefined;

/** Der Schlüssel der Art, die ein Feld zeigt: seine eigene, sonst sein Grundgelände. */
export function kindKeyOf(hex: Pick<Hex, 'kind' | 'terrain'>): string | null {
  const own = hexKind(hex.kind);
  if (own && own.base === hex.terrain) return own.key;
  return hex.terrain;
}

/** Wie ein Feld heißt: „Moor“, sonst das Grundgelände. */
export function kindLabelOf(hex: Pick<Hex, 'kind' | 'terrain'>): string {
  const key = kindKeyOf(hex);
  return hexKind(key)?.label ?? (hex.terrain ? TERRAIN_LABEL[hex.terrain] : 'Ohne Gelände');
}

/** Was ein Pinsel mit dieser Art an einem Feld setzt: Grundgelände und Art. */
export function paintOfKind(key: string): Pick<Hex, 'terrain' | 'kind'> | null {
  const kind = hexKind(key);
  if (!kind) return null;
  return { terrain: kind.base, kind: kind.key === kind.base ? null : kind.key };
}

/** Die Arten nach Gruppen, gefiltert nach einem Suchwort (Name oder Gruppe). */
export function kindsByGroup(query = ''): { group: KindGroup; kinds: HexKind[] }[] {
  const q = query.trim().toLowerCase();
  const groups = Object.keys(KIND_GROUP_LABEL) as KindGroup[];
  return groups
    .map((group) => ({
      group,
      kinds: HEX_KINDS.filter(
        (kind) =>
          kind.group === group &&
          (!q ||
            kind.label.toLowerCase().includes(q) ||
            KIND_GROUP_LABEL[group].toLowerCase().includes(q)),
      ),
    }))
    .filter((entry) => entry.kinds.length > 0);
}
