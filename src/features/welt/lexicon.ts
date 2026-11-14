/**
 * Pflanzen, Tiere, Gesteine und Berufe als Lexikon: eine Sicht auf die Einträge der Welt, nach
 * ihrer Einordnung gruppiert und nach Lebensraum, Gegend und Jahreszeit zu filtern. Keine eigene
 * Ablage – gelesen wird, was an den Einträgen steht. Reine Funktionen.
 */
import { byName, entitiesOfKind, placeSubtreeIds } from '../../domain/derive';
import { formatGold } from '../../domain/loot';
import {
  HABITAT_LABEL,
  NATURE_KINDS,
  RARITY_LABEL,
  habitatKeysOf,
  isNatureKind,
  monthsOfChoice,
  natureAt,
  natureOf,
  readSeasons,
  type HabitatKey,
  type NatureKind,
} from '../../domain/nature';
import { seasonsAt } from '../../domain/seasons';
import type { CampaignData, Entity, NatureEntity, Place, Profession } from '../../domain/schema';
import { linkedFrom } from './model';

export const LEXICON_KINDS = [...NATURE_KINDS, 'profession'] as const;
export type LexiconKind = (typeof LEXICON_KINDS)[number];

export const isLexiconKind = (kind: string): kind is LexiconKind =>
  (LEXICON_KINDS as readonly string[]).includes(kind);

export interface LexiconFilter {
  /** Lebensraum: „k:wald“ (ein Wort, das Wayfarer kennt) oder „w:salzwiesen“ (ein eigenes); '' = alle. */
  habitat: string;
  /** Gegend (ein Ort); null = überall. */
  regionId: string | null;
  /** Jahreszeit „s:winter“ oder Monat „m:3“; '' = das ganze Jahr. */
  season: string;
}

export const NO_LEXICON_FILTER: LexiconFilter = { habitat: '', regionId: null, season: '' };

export interface LexiconRow {
  entity: NatureEntity | Profession;
  /** Die Kurzzeile des Spielleiters. */
  line: string;
  rarity: string;
  habitats: string;
  seasons: string;
  price: string;
  /** Beruf: Werkzeug und wer ihn ausübt. */
  tool: string;
  people: Entity[];
}

export interface LexiconGroup {
  /** Die Einordnung („Kraut“); '' = ohne. */
  category: string;
  rows: LexiconRow[];
}

const lower = (word: string) => word.toLocaleLowerCase('de').replace(/\s+/g, ' ').trim();

/** Der Wert eines Lebensraums für den Filter: ein bekanntes Wort zählt mit seinem Lebensraum. */
function habitatValues(word: string): string[] {
  const keys = habitatKeysOf(word);
  return keys.length ? keys.map((key) => `k:${key}`) : [`w:${lower(word)}`];
}

/** Die Einträge einer Art, wie das Lexikon sie zeigt – gefiltert und nach Einordnung gruppiert. */
export function lexicon(
  data: CampaignData,
  kind: LexiconKind,
  filter: LexiconFilter = NO_LEXICON_FILTER,
  visible: ReadonlySet<string> | null = null,
): LexiconGroup[] {
  const entities = (entitiesOfKind(data, kind) as (NatureEntity | Profession)[]).filter(
    (entity) => !visible || visible.has(entity.id),
  );
  const keep = isNatureKind(kind) ? natureFilter(data, kind, filter) : () => true;
  const groups = new Map<string, LexiconRow[]>();
  for (const entity of entities) {
    if (entity.kind !== 'profession' && !keep(entity)) continue;
    const row = rowOf(data, entity);
    const category = (
      entity.kind === 'profession' ? entity.profession.category : natureOf(entity).category
    ).trim();
    const list = groups.get(category);
    if (list) list.push(row);
    else groups.set(category, [row]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'de')))
    .map(([category, rows]) => ({
      category,
      rows: rows.sort((a, b) => byName(a.entity, b.entity)),
    }));
}

/** Wie viele Einträge dieser Art im gewählten Ausschnitt der Welt stehen – ohne die Filter des Lexikons. */
export function lexiconTotal(
  data: CampaignData,
  kind: LexiconKind,
  visible: ReadonlySet<string> | null = null,
): number {
  return entitiesOfKind(data, kind).filter((entity) => !visible || visible.has(entity.id)).length;
}

function rowOf(data: CampaignData, entity: NatureEntity | Profession): LexiconRow {
  if (entity.kind === 'profession')
    return {
      entity,
      line: entity.tagline,
      rarity: '',
      habitats: '',
      seasons: '',
      price: '',
      tool: entity.profession.tool,
      people: linkedFrom(data, entity.id, 'practises'),
    };
  const details = natureOf(entity);
  return {
    entity,
    line: entity.tagline,
    rarity: details.rarity ? RARITY_LABEL[details.rarity] : '',
    habitats: details.habitat.join(', '),
    seasons: details.seasons.join(', '),
    price: details.price !== null ? formatGold(details.price) : '',
    tool: '',
    people: [],
  };
}

/** Passt ein Eintrag zum Filter? Lebensraum, Gegend und Jahreszeit müssen alle passen. */
function natureFilter(
  data: CampaignData,
  kind: NatureKind,
  filter: LexiconFilter,
): (entity: NatureEntity) => boolean {
  const cal = data.campaign.calendar;
  const year = seasonsAt(data);
  const months = filter.season ? monthsOfChoice(cal, year, filter.season) : null;
  // Die Gegend: wer dort Gegenden hat (darin oder darüber) – oder ohne Gegenden zum Ort passt.
  const region = filter.regionId ? data.entities[filter.regionId] : undefined;
  const regionIds =
    region?.kind === 'place'
      ? new Set([...placeSubtreeIds(data, region.id), ...ancestorIds(data, region)])
      : null;
  const fits =
    region?.kind === 'place'
      ? new Set(
          natureAt(data, { placeId: region.id, allYear: true })
            .filter((hit) => hit.entity.kind === kind)
            .map((hit) => hit.entity.id),
        )
      : null;
  return (entity) => {
    const details = natureOf(entity);
    if (filter.habitat && !details.habitat.some((w) => habitatValues(w).includes(filter.habitat)))
      return false;
    if (regionIds && !details.regionIds.some((id) => regionIds.has(id)) && !fits!.has(entity.id))
      return false;
    if (months) {
      const when = readSeasons(cal, year, details.seasons).months;
      if (when && ![...months].some((m) => when.has(m))) return false;
    }
    return true;
  };
}

function ancestorIds(data: CampaignData, place: Place): string[] {
  const out: string[] = [];
  let current: Entity | undefined = place;
  const seen = new Set<string>();
  while (current?.kind === 'place' && current.place.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    out.push(current.place.parentId);
    current = data.entities[current.place.parentId];
  }
  return out;
}

export interface LexiconFacets {
  habitats: { value: string; label: string; count: number }[];
  seasons: { value: string; label: string }[];
}

/** Was sich bei dieser Art filtern lässt: nur, was an den Einträgen auch vorkommt. */
export function lexiconFacets(data: CampaignData, kind: LexiconKind): LexiconFacets {
  if (!isNatureKind(kind)) return { habitats: [], seasons: [] };
  const habitats = new Map<string, { label: string; ids: Set<string> }>();
  for (const entity of entitiesOfKind(data, kind)) {
    const details = natureOf(entity);
    for (const word of details.habitat)
      for (const value of habitatValues(word)) {
        const label = value.startsWith('k:')
          ? HABITAT_LABEL[value.slice(2) as HabitatKey]
          : word.trim();
        const entry = habitats.get(value);
        if (entry) entry.ids.add(entity.id);
        else habitats.set(value, { label, ids: new Set([entity.id]) });
      }
  }
  return {
    habitats: [...habitats.entries()]
      .map(([value, { label, ids }]) => ({ value, label, count: ids.size }))
      .sort((a, b) => a.label.localeCompare(b.label, 'de')),
    seasons: [
      ...seasonsAt(data).seasons.map((season) => ({
        value: `s:${season.key}`,
        label: season.name,
      })),
      ...data.campaign.calendar.months.map((month, index) => ({
        value: `m:${index}`,
        label: month.name,
      })),
    ],
  };
}
