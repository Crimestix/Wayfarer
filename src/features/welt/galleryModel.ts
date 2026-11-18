/**
 * Die Galerie einer Art – dieselbe Ansicht, die die Personen haben, für jede Art der Welt
 * (Wunsch des Spielleiters, 16. 11. 2026: „Wir brauchen die gleiche Ansicht von Personen für
 * alle Ordnerarten“). Suche, Ort, Bekanntheit (nur wo Wayfarer sie kennt: Personen, Orte) und
 * die Vergangenheit für sich. Reine Rechnung.
 */
import {
  entitiesOfKind,
  entityCategory,
  entityName,
  personPlace,
  placeAncestors,
  searchEntities,
} from '../../domain/derive';
import { scopeMembers } from '../../domain/scope';
import { PARTY_ID, type CampaignData, type Entity } from '../../domain/schema';
import { attitudeLevel } from '../../domain/relations';
import { SCALE_LABEL, placeScale } from '../../domain/placeScale';
import { isMagicItem } from '../../domain/magicItem';
import { ownKindOf } from '../../domain/ownKind';
import { isRoom } from '../../domain/rooms';
import { isStub } from '../../domain/stub';
import { TERRAIN_LABEL } from '../../domain/terrain';
import { agesAt } from '../../domain/ages';
import {
  galleryPeople,
  isWorldEntity,
  type GalleryFilter,
  type WorldEntity,
  type WorldKind,
} from './model';
import { isKnown, visitedPlaces } from './scope';

/** Ob die Galerie dieser Art nach „bekannt“ trennen kann – nur dort, wo Wayfarer es weiß. */
export const knowsKnown = (kind: WorldKind): boolean => kind === 'person' || kind === 'place';

/** Die Einträge einer Art für die Galerie, nach Namen. */
export function galleryEntries(
  data: CampaignData,
  kind: WorldKind,
  filter: GalleryFilter,
): WorldEntity[] {
  if (kind === 'person') return galleryPeople(data, filter);
  const pool: Entity[] =
    filter.query.trim() !== ''
      ? searchEntities(data, filter.query, { kinds: [kind], limit: 1000 })
      : entitiesOfKind(data, kind);
  const scope = filter.placeId ? scopeMembers(data, filter.placeId) : null;
  const visited = filter.known !== 'all' && knowsKnown(kind) ? visitedPlaces(data) : null;
  return (
    pool
      .filter(isWorldEntity)
      .filter((entity) => entity.kind === kind)
      // Räume stehen auf der Seite ihres Ortes, nicht zwischen den Orten.
      .filter((entity) => !isRoom(data, entity))
      .filter((entity) => !scope || (scope.has(entity.id) && entity.id !== filter.placeId))
      .filter((entity) => !visited || isKnown(data, entity, visited) === (filter.known === 'known'))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  );
}

/** Die zweite Zeile einer Karte: wo es ist oder wem es gehört – leer, wenn nichts bekannt ist. */
export function galleryWhere(data: CampaignData, entity: Entity): string {
  switch (entity.kind) {
    case 'person': {
      const at = personPlace(data, entity);
      return at ? entityName(data, at) : 'Aufenthalt unbekannt';
    }
    case 'place': {
      const above = placeAncestors(data, entity.id)[0];
      return above ? `in ${above.name}` : '';
    }
    case 'faction':
      return entity.faction.seatId ? entityName(data, entity.faction.seatId) : '';
    case 'family':
      return entity.family.seatId ? entityName(data, entity.family.seatId) : '';
    case 'item':
      return entity.item.holderId ? entityName(data, entity.item.holderId) : '';
    default:
      return '';
  }
}

// ── Filter je Kategorie ─────────────────────────────────────────────────────

/**
 * Filter, die zur Kategorie passen (Wunsch des Spielleiters, 17. 11. 2026: „Kachelansicht … dazu
 * Filter, die zu den Kategorien passen“): das eigene Wort für alle, dazu je Kategorie, was sie
 * ausmacht – Personen nach Volk, Zugehörigkeit und Haltung, Orte nach Größe, Gegenstände nach
 * Magie und Besitz, Landschaften nach Gelände; überall „Platzhalter“. Ein Filter ist nur Ansicht,
 * nie Spielstand – und steht nur da, wenn er mindestens zwei Möglichkeiten hat.
 */
export type FacetKey =
  | 'own'
  | 'word'
  | 'stub'
  | 'species'
  | 'group'
  | 'attitude'
  | 'scale'
  | 'magic'
  | 'holder'
  | 'ground'
  | 'domain'
  | 'age';

export const FACET_LABEL: Record<FacetKey, string> = {
  own: 'Unterkategorie',
  word: 'Genauer',
  stub: 'Stand',
  species: 'Volk',
  group: 'Gehört zu',
  attitude: 'Haltung zur Gruppe',
  scale: 'Was für ein Ort',
  magic: 'Magie',
  holder: 'Besitz',
  ground: 'Gelände',
  domain: 'Wofür sie steht',
  age: 'Zeitalter',
};

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface Facet {
  key: FacetKey;
  label: string;
  options: FacetOption[];
}

/** Welche Filter eine Kategorie hat, in dieser Reihenfolge. */
const FACETS_OF: Partial<Record<WorldKind, FacetKey[]>> = {
  person: ['word', 'species', 'group', 'attitude', 'age', 'stub'],
  place: ['scale', 'word', 'age', 'stub'],
  item: ['word', 'magic', 'holder', 'stub'],
  landscape: ['ground', 'word', 'stub'],
  deity: ['word', 'domain', 'stub'],
  faction: ['word', 'age', 'stub'],
  family: ['word', 'age', 'stub'],
  realm: ['word', 'age', 'stub'],
  happening: ['word', 'age', 'stub'],
};
const facetsOfKind = (kind: WorldKind): FacetKey[] => [
  'own',
  ...(FACETS_OF[kind] ?? (['word', 'age', 'stub'] satisfies FacetKey[])),
];

const RULES_GROUP: Record<'hostile' | 'indifferent' | 'friendly', string> = {
  friendly: 'Freundlich',
  indifferent: 'Gleichgültig',
  hostile: 'Feindselig',
};

type Pair = { value: string; label: string };

/** Was ein Eintrag zu einem Filter sagt – mehrere Werte, wenn er mehreren Fraktionen angehört. */
export function facetValues(data: CampaignData, entity: WorldEntity, key: FacetKey): Pair[] {
  switch (key) {
    case 'own': {
      const own = ownKindOf(data, entity);
      return own ? [{ value: own.id, label: own.name }] : [];
    }
    case 'word': {
      const word = (entity.kind === 'person' ? entity.person.role : entityCategory(entity)).trim();
      return word ? [{ value: word.toLocaleLowerCase('de'), label: word }] : [];
    }
    case 'stub':
      return isStub(data, entity)
        ? [{ value: 'stub', label: 'Platzhalter' }]
        : [{ value: 'done', label: 'Geschrieben' }];
    case 'species': {
      if (entity.kind !== 'person') return [];
      const id = entity.person.speciesId;
      const name = id ? data.entities[id]?.name : entity.person.species.trim();
      return name ? [{ value: name.toLocaleLowerCase('de'), label: name }] : [];
    }
    case 'group':
      return Object.values(data.relations)
        .filter(
          (relation) =>
            relation.from === entity.id && relation.type === 'member' && !relation.ended,
        )
        .map((relation) => data.entities[relation.to])
        .filter((other): other is Entity => !!other)
        .map((other) => ({ value: other.id, label: other.name }));
    case 'attitude': {
      const relation = Object.values(data.relations).find(
        (r) => r.from === entity.id && r.to === PARTY_ID && !r.ended,
      );
      const level = attitudeLevel(relation?.attitude ?? null);
      return level
        ? [{ value: level.rules, label: RULES_GROUP[level.rules] }]
        : [{ value: 'none', label: 'Keine' }];
    }
    case 'scale': {
      if (entity.kind !== 'place') return [];
      const scale = placeScale(data, entity);
      return scale ? [{ value: scale, label: SCALE_LABEL[scale] }] : [];
    }
    case 'magic':
      if (entity.kind !== 'item') return [];
      return isMagicItem(entity)
        ? [{ value: 'magic', label: 'Magisch' }]
        : [{ value: 'plain', label: 'Nicht magisch' }];
    case 'holder': {
      if (entity.kind !== 'item') return [];
      const holder = entity.item.holderId ? data.entities[entity.item.holderId] : undefined;
      if (entity.item.holderId === PARTY_ID || holder?.kind === 'character')
        return [{ value: 'party', label: 'Bei der Gruppe' }];
      return holder
        ? [{ value: 'other', label: 'Bei jemand anderem' }]
        : [{ value: 'none', label: 'Ohne Besitzer' }];
    }
    case 'ground':
      return entity.kind === 'landscape'
        ? [{ value: entity.landscape.base, label: TERRAIN_LABEL[entity.landscape.base] }]
        : [];
    case 'domain':
      return entity.kind === 'deity'
        ? entity.deity.domains
            .map((word) => word.trim())
            .filter(Boolean)
            .map((word) => ({ value: word.toLocaleLowerCase('de'), label: word }))
        : [];
    case 'age': {
      // In welches Zeitalter ein Eintrag fällt: nach seinem Beginn, sonst nach seinem Ende.
      const at = entity.born?.at ?? entity.ended?.at;
      if (at === undefined) return [];
      return agesAt(data, at).map((span) => ({ value: span.age.id, label: span.age.name }));
    }
  }
}

/** Höchstens so viele Möglichkeiten je Filter – die häufigsten. */
const MOST_OPTIONS = 14;

/** Die Filter einer Kategorie mit ihren Möglichkeiten und wie oft sie vorkommen. */
export function galleryFacets(
  data: CampaignData,
  kind: WorldKind,
  entries: readonly WorldEntity[],
): Facet[] {
  return (
    facetsOfKind(kind)
      .map((key) => {
        const counts = new Map<string, FacetOption>();
        for (const entity of entries)
          for (const pair of facetValues(data, entity, key)) {
            const option = counts.get(pair.value) ?? { ...pair, count: 0 };
            option.count++;
            counts.set(pair.value, option);
          }
        const options = [...counts.values()]
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'de'))
          .slice(0, MOST_OPTIONS);
        return { key, label: FACET_LABEL[key], options };
      })
      // Eine eigene Kategorie ist schon allein ein Filter: „alle“ oder nur sie.
      .filter((facet) => facet.options.length >= (facet.key === 'own' ? 1 : 2))
  );
}

/** Lässt stehen, was zu allen gewählten Filtern passt. */
export function withFacets(
  data: CampaignData,
  entries: readonly WorldEntity[],
  chosen: Partial<Record<FacetKey, string>>,
): WorldEntity[] {
  const active = Object.entries(chosen).filter(([, value]) => value) as [FacetKey, string][];
  if (!active.length) return [...entries];
  return entries.filter((entity) =>
    active.every(([key, value]) =>
      facetValues(data, entity, key).some((pair) => pair.value === value),
    ),
  );
}
