/**
 * Fachlogik der Weltdatenbank: Übersicht (Baum der Orte, Listen, Zahlen), Fakten für das Dossier,
 * Beziehungszeilen und der Entwurf, aus dem der Bearbeiten-Dialog einen Eintrag baut.
 * Reine Funktionen ohne React.
 */
import {
  byName,
  chronicleFor,
  entitiesOfKind,
  entityCategory,
  entityName,
  placeAncestors,
  personPlace,
  placeSubtreeIds,
  relationPairs,
  searchEntities,
  upcomingOccurrences,
  linksTo,
  wouldCreatePlaceCycle,
  type Occurrence,
  type PlaceCast,
  type Stay,
} from '../../domain/derive';
import { datePointText, isPast, lifeFacts, lifeWords, readDatePoint } from '../../domain/lifespan';
import { formatGold } from '../../domain/loot';
import { emptyMagic, magicTag, valueOf } from '../../domain/magicItem';
import {
  HABITAT_SUGGESTIONS,
  RARITY_LABEL,
  isNature,
  isNatureKind,
  natureOf,
  priceText,
  readPrice,
} from '../../domain/nature';
import { isRoom, roomArticleIds } from '../../domain/rooms';
import { presetType, relationLabel, relationType } from '../../domain/relations';
import {
  PARTY_ID,
  createEntity,
  type DatePoint,
  type CampaignData,
  type Character,
  type ChronicleEntry,
  type Article,
  type Entity,
  type Faction,
  type Family,
  type Item,
  type Person,
  type PersonStatus,
  type Place,
  type PlaceScale,
  type Rarity,
  type Relation,
} from '../../domain/schema';
import {
  dayIndexOf,
  formatDate,
  formatDayMonth,
  formatDuration,
  formatRelative,
  fromTime,
  type CalendarDef,
  type WorldTime,
} from '../../domain/time/calendar';
import { knowsPerson } from '../../domain/known';
import { templatesOfKind } from '../../domain/pageTemplate';

// ── Arten ──────────────────────────────────────────────────────────────────

/** Was in der Weltdatenbank steht. Gefährten haben ihren eigenen Bereich. */
export const WORLD_KINDS = [
  'place',
  'person',
  'family',
  'faction',
  'item',
  'topic',
  'species',
  'language',
  'script',
  'ability',
  'plant',
  'animal',
  'mineral',
  'profession',
  'deity',
  'realm',
  'happening',
  'landscape',
  'celestial',
  'dimension',
] as const;
export type WorldKind = (typeof WORLD_KINDS)[number];

/** Die Arten, die fast jede Welt hat – in der Liste offen und zuerst. */
export const COMMON_KINDS: readonly WorldKind[] = [
  'place',
  'person',
  'faction',
  'family',
  'realm',
  'landscape',
  'item',
  'deity',
  'happening',
  'topic',
];

/**
 * Die Arten in der Liste links: die üblichen als Gruppen, die seltenen unter „Mehr“ – nur eine
 * Ordnung, nie ein Filter. Arten ohne Eintrag stehen nicht da (die Suche findet trotzdem alles).
 */
export function kindSections(counts: Record<WorldKind, number>): {
  common: WorldKind[];
  rare: WorldKind[];
} {
  return {
    common: COMMON_KINDS.filter((kind) => counts[kind] > 0),
    rare: WORLD_KINDS.filter((kind) => !COMMON_KINDS.includes(kind) && counts[kind] > 0),
  };
}
export type KindFilter = 'all' | WorldKind;
export type WorldEntity = Extract<Entity, { kind: WorldKind }>;

export const isWorldKind = (kind: string): kind is WorldKind =>
  (WORLD_KINDS as readonly string[]).includes(kind);

export const isWorldEntity = (entity: Entity | undefined): entity is WorldEntity =>
  !!entity && isWorldKind(entity.kind);

export const PERSON_STATUS_LABEL: Record<PersonStatus, string> = {
  alive: 'Lebt',
  dead: 'Tot',
  missing: 'Verschollen',
  unknown: 'Schicksal ungewiss',
};

/** Vorschläge für das freie Feld „Art“. */
export const CATEGORY_SUGGESTIONS: Record<Exclude<WorldKind, 'person'>, string[]> = {
  place: [
    'Region',
    'Stadt',
    'Dorf',
    'Viertel',
    'Gebäude',
    'Taverne',
    'Tempel',
    'Ruine',
    'Wildnis',
    'Gewölbe',
  ],
  faction: ['Adelshaus', 'Gilde', 'Orden', 'Kult', 'Bande', 'Handelshaus', 'Stadtwache'],
  item: ['Artefakt', 'Waffe', 'Schriftstück', 'Schlüssel', 'Schatz'],
  topic: ['Legende', 'Prophezeiung', 'Glaube', 'Magiesystem', 'Rätsel', 'Gerücht'],
  deity: ['Göttin', 'Gott', 'Dämonenfürst', 'Schutzgeist', 'Erzfee', 'Alte Macht'],
  realm: ['Königreich', 'Fürstentum', 'Stadtstaat', 'Grenzmark', 'Reich', 'Stammesgebiet'],
  happening: ['Krieg', 'Schlacht', 'Gründung', 'Katastrophe', 'Seuche', 'Krönung', 'Vertrag'],
  landscape: ['Wald', 'Moor', 'Heide', 'Gebirge', 'Wüste', 'Küste', 'Höhlen', 'Steppe'],
  celestial: ['Planet', 'Mond', 'Stern', 'Komet'],
  dimension: ['Materielle Ebene', 'Übergangsebene', 'Innere Ebene', 'Äußere Ebene', 'Halbebene'],
  family: ['Adelshaus', 'Sippe', 'Clan', 'Dynastie', 'Kaufmannsfamilie'],
  species: ['Humanoid', 'Fee', 'Elementar', 'Untoter', 'Drache', 'Tier'],
  language: ['Standardsprache', 'Seltene Sprache', 'Geheimsprache', 'Tote Sprache'],
  script: ['Alphabet', 'Runen', 'Bilderschrift', 'Geheimschrift'],
  ability: ['Gabe', 'Talent', 'Segen', 'Fluch', 'Magie'],
  plant: ['Kraut', 'Baum', 'Strauch', 'Blume', 'Pilz', 'Moos', 'Gras', 'Alge'],
  animal: ['Wild', 'Nutztier', 'Reittier', 'Raubtier', 'Vogel', 'Fisch', 'Insekt', 'Kriechtier'],
  mineral: ['Erz', 'Edelstein', 'Halbedelstein', 'Gestein', 'Salz', 'Kristall', 'Metall'],
  profession: [
    'Handwerk',
    'Handel',
    'Gelehrsamkeit',
    'Heilkunde',
    'Dienst',
    'Land und Wasser',
    'Kunst',
    'Glaube',
  ],
};

/** Vorschläge für „Art“: bereits verwendete Werte zuerst, dann die üblichen. */
export function categoryOptions(data: CampaignData, kind: Exclude<WorldKind, 'person'>): string[] {
  const used = new Set<string>();
  for (const entity of Object.values(data.entities)) {
    if (entity.kind !== kind) continue;
    const category = entityCategory(entity).trim();
    if (category) used.add(category);
  }
  const collator = new Intl.Collator('de');
  const rest = CATEGORY_SUGGESTIONS[kind].filter((c) => !used.has(c));
  return [...[...used].sort(collator.compare), ...rest];
}

/**
 * Vorschläge für das eigene Wort beim Anlegen: Wörter mit eigener Vorlage zuerst, dann die schon
 * verwendeten, dann ein paar übliche, damit eine neue Welt nicht leer startet. Bei Personen die
 * schon vergebenen Rollen.
 */
export function wordChoices(data: CampaignData, kind: WorldKind): string[] {
  const own = templatesOfKind(data.campaign, kind).map((entry) => entry.word);
  const rest =
    kind === 'person'
      ? [
          ...new Set(
            Object.values(data.entities).flatMap((entity) =>
              entity.kind === 'person' && entity.person.role.trim()
                ? [entity.person.role.trim()]
                : [],
            ),
          ),
        ].sort(new Intl.Collator('de').compare)
      : categoryOptions(data, kind);
  const seen = new Set(own.map((word) => word.toLocaleLowerCase('de')));
  return [...own, ...rest.filter((word) => !seen.has(word.toLocaleLowerCase('de')))];
}

/** Vorschläge für Lebensräume: was in der Welt schon steht, dann die üblichen Wörter. */
export function habitatChoices(data: CampaignData): string[] {
  const used = new Map<string, string>();
  for (const entity of Object.values(data.entities))
    if (isNature(entity))
      for (const word of natureOf(entity).habitat)
        if (!used.has(word.toLocaleLowerCase('de'))) used.set(word.toLocaleLowerCase('de'), word);
  const rest = HABITAT_SUGGESTIONS.filter((word) => !used.has(word.toLocaleLowerCase('de')));
  return [...[...used.values()].sort((a, b) => a.localeCompare(b, 'de')), ...rest];
}

/** Das freie Feld „Art“ eines Eintrags (`entityCategory` in `domain/derive.ts`). */
export { entityCategory };

// ── Übersicht ──────────────────────────────────────────────────────────────

export function worldCounts(
  data: CampaignData,
  visible: ReadonlySet<string> | null = null,
): Record<WorldKind, number> {
  const counts = Object.fromEntries(WORLD_KINDS.map((kind) => [kind, 0])) as Record<
    WorldKind,
    number
  >;
  for (const entity of Object.values(data.entities))
    if (isWorldKind(entity.kind) && !isRoom(data, entity) && (!visible || visible.has(entity.id)))
      counts[entity.kind]++;
  return counts;
}

/** Haltung zur Gruppe je Eintrag, in einem Durchgang; fehlt ein Eintrag, ist sie unbekannt. */
export function partyAttitudes(data: CampaignData): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const relation of Object.values(data.relations))
    if (relation.to === PARTY_ID) map.set(relation.from, relation.attitude);
  return map;
}

/** Zuletzt angelegte oder geänderte Einträge der Weltdatenbank, neueste zuerst. */
export function recentlyChanged(data: CampaignData, limit = 8): WorldEntity[] {
  return Object.values(data.entities)
    .filter(isWorldEntity)
    .sort((a, b) => b.updated.localeCompare(a.updated) || byName(a, b))
    .slice(0, limit);
}

export interface PlaceRow {
  place: Place;
  depth: number;
  childCount: number;
  open: boolean;
  /** Die Gruppe ist genau hier. */
  partyHere: boolean;
  /** Die Gruppe ist in einem Ort darunter. */
  partyBelow: boolean;
}

/**
 * Orte als eingerückter Baum, in Lesereihenfolge. `openState` enthält, was von Hand auf- oder
 * zugeklappt wurde; ohne Angabe sind nur die obersten Orte aufgeklappt. Mit `visible` zeigt
 * der Baum nur diese Orte; wessen Ort darüber fehlt, steht dann ganz oben.
 */
export function placeTreeRows(
  data: CampaignData,
  openState: Readonly<Record<string, boolean>> = {},
  visible: ReadonlySet<string> | null = null,
): PlaceRow[] {
  // Räume stehen auf der Seite ihres Ortes, nicht im Baum.
  const places = entitiesOfKind(data, 'place').filter(
    (p) => !isRoom(data, p) && (!visible || visible.has(p.id)),
  );
  const byId = new Map(places.map((p) => [p.id, p]));
  const children = new Map<string | null, Place[]>();
  for (const place of places) {
    const parentId = place.place.parentId;
    const key = parentId && parentId !== place.id && byId.has(parentId) ? parentId : null;
    const list = children.get(key);
    if (list) list.push(place);
    else children.set(key, [place]);
  }
  const partyPlace = data.state.placeId;
  const partyAbove = new Set(partyPlace ? placeAncestors(data, partyPlace).map((p) => p.id) : []);
  const rows: PlaceRow[] = [];
  const seen = new Set<string>();
  const walk = (place: Place, depth: number) => {
    if (seen.has(place.id)) return;
    seen.add(place.id);
    const kids = children.get(place.id) ?? [];
    const open = kids.length > 0 && (openState[place.id] ?? depth === 0);
    rows.push({
      place,
      depth,
      childCount: kids.length,
      open,
      partyHere: place.id === partyPlace,
      partyBelow: partyAbove.has(place.id),
    });
    if (open) for (const kid of kids) walk(kid, depth + 1);
    else for (const id of placeSubtreeIds(data, place.id)) seen.add(id);
  };
  for (const root of children.get(null) ?? []) walk(root, 0);
  // Orte, die sich gegenseitig als Elternort haben, wären sonst unsichtbar.
  for (const place of places) if (!seen.has(place.id)) walk(place, 0);
  return rows;
}

/**
 * Was der Vergangenheit angehört, steht für sich: Tote, Untergegangenes, Aufgelöstes. Nie
 * weggefiltert – nur nicht zwischen dem, was heute ist. Reihenfolge bleibt.
 */
export function splitPast<E extends Entity>(
  data: CampaignData,
  entities: readonly E[],
): { present: E[]; past: E[] } {
  const present: E[] = [];
  const past: E[] = [];
  for (const entity of entities) (isPast(data, entity) ? past : present).push(entity);
  return { present, past };
}

/**
 * Orte, die mit allem darin der Vergangenheit angehören – sie stehen unter „Vergangenheit“. Ein
 * untergegangenes Reich, in dem noch eine Stadt besteht, bleibt im Baum, damit die Stadt ihren
 * Platz behält.
 */
export function pastPlaceIds(data: CampaignData): Set<string> {
  const places = entitiesOfKind(data, 'place');
  const children = new Map<string, Place[]>();
  for (const place of places) {
    const parentId = place.place.parentId;
    if (!parentId || parentId === place.id) continue;
    const list = children.get(parentId);
    if (list) list.push(place);
    else children.set(parentId, [place]);
  }
  const done = new Map<string, boolean>();
  const allPast = (place: Place, path: Set<string>): boolean => {
    const known = done.get(place.id);
    if (known !== undefined) return known;
    if (path.has(place.id)) return true; // ein Kreis entscheidet nichts
    path.add(place.id);
    let result = isPast(data, place);
    for (const kid of children.get(place.id) ?? []) if (!allPast(kid, path)) result = false;
    path.delete(place.id);
    done.set(place.id, result);
    return result;
  };
  return new Set(places.filter((place) => allPast(place, new Set())).map((place) => place.id));
}

/**
 * Texte ohne Eintrag der Welt – Ordnerseiten, Übersichten, Abhandlungen. Damit „Nach Art“ alles
 * zeigen kann, was es gibt, nicht nur die Einträge. Ohne Vorlagen und Räume, nach Titel.
 */
export function textsWithoutEntry(data: CampaignData): Article[] {
  const owned = new Set<string>();
  for (const entity of Object.values(data.entities))
    if (entity.lk?.resourceId) owned.add(entity.lk.resourceId);
  const rooms = roomArticleIds(data);
  return Object.values(data.articles)
    .filter((article) => !article.template && !owned.has(article.id) && !rooms.has(article.id))
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
}

/** Einzug einer Zeile im Baum der Orte in Pixeln; ab der fünften Ebene nur noch halb so weit. */
export function treeIndent(depth: number): number {
  return 6 + Math.min(depth, 4) * 16 + Math.max(0, depth - 4) * 8;
}

/** So viele Zeilen zeigt eine Gruppe der Besetzung, bevor sie „weitere anzeigen“ anbietet. */
export const CAST_PREVIEW = 8;

/** Klappt alle übergeordneten Orte auf, damit `placeId` im Baum sichtbar ist. */
export function openAncestors(
  data: CampaignData,
  placeId: string,
  openState: Readonly<Record<string, boolean>>,
): Record<string, boolean> {
  const next = { ...openState };
  for (const ancestor of placeAncestors(data, placeId)) next[ancestor.id] = true;
  return next;
}

export type ListMove = 'up' | 'down' | 'first' | 'last';

/** Welche Taste in der Übersicht wohin führt; null = keine Bewegung. */
export function listKeyMove(key: string): ListMove | null {
  switch (key) {
    case 'ArrowDown':
      return 'down';
    case 'ArrowUp':
      return 'up';
    case 'Home':
      return 'first';
    case 'End':
      return 'last';
    default:
      return null;
  }
}

/** Zeile, die nach einer Bewegung den Fokus bekommt; an den Enden bleibt er stehen. */
export function nextRowIndex(index: number, count: number, move: ListMove): number {
  if (count <= 0) return -1;
  if (move === 'first') return 0;
  if (move === 'last') return count - 1;
  return Math.min(count - 1, Math.max(0, index + (move === 'down' ? 1 : -1)));
}

/** Unterzeile eines Eintrags in Listen: das Wichtigste in wenigen Wörtern. */
export function entitySubline(data: CampaignData, entity: Entity): string {
  const parts: string[] = [];
  switch (entity.kind) {
    case 'person':
      parts.push(entity.person.role);
      if (entity.person.status !== 'alive') parts.push(PERSON_STATUS_LABEL[entity.person.status]);
      const at = personPlace(data, entity);
      if (at) parts.push(entityName(data, at));
      break;
    case 'faction':
      parts.push(entity.faction.category);
      if (entity.faction.seatId) parts.push(entityName(data, entity.faction.seatId));
      break;
    case 'family':
      parts.push(entity.family.category);
      if (entity.family.seatId) parts.push(entityName(data, entity.family.seatId));
      break;
    case 'item':
      parts.push(entity.item.category, magicTag(entity));
      if (entity.item.holderId) parts.push(entityName(data, entity.item.holderId));
      break;
    case 'language':
      parts.push(entity.language.category);
      if (entity.language.scriptId) parts.push(entityName(data, entity.language.scriptId));
      break;
    case 'character':
      parts.push(entity.character.className, entity.character.player);
      break;
    case 'plant':
    case 'animal':
    case 'mineral': {
      const details = natureOf(entity);
      parts.push(details.category, details.rarity ? RARITY_LABEL[details.rarity] : '');
      break;
    }
    default:
      parts.push(entityCategory(entity));
  }
  return parts.filter(Boolean).join(' · ');
}

/** Treffer der Suche in der Übersicht, beste zuerst; Gefährten gehören nicht dazu. */
export function searchWorld(
  data: CampaignData,
  query: string,
  filter: KindFilter,
  visible: ReadonlySet<string> | null = null,
): WorldEntity[] {
  const kinds: WorldKind[] = filter === 'all' ? [...WORLD_KINDS] : [filter];
  return searchEntities(data, query, { kinds, limit: 500 })
    .filter(isWorldEntity)
    .filter((entity) => !visible || visible.has(entity.id));
}

// ── Dossier: Fakten im Kopf ────────────────────────────────────────────────

export interface Fact {
  label: string;
  /** Freier Text. */
  text?: string;
  /** Verweise auf Einträge; mehrere werden als Pfad mit „›“ dargestellt, mit `list` als Aufzählung. */
  ids?: string[];
  list?: boolean;
  /** So viele Ebenen des Pfades sind nach dem ersten Verweis ausgelassen. */
  skipped?: number;
  /** Hebt den Wert hervor, z. B. „Tot“. */
  tone?: 'danger';
}

/** Die wichtigsten Fakten eines Eintrags für die Zeile unter dem Namen. */
export function entityFacts(data: CampaignData, entity: Entity): Fact[] {
  const facts = kindFacts(data, entity);
  // Alter, Gründung, Tod – von selbst gerechnet (`domain/lifespan.ts`).
  for (const fact of lifeFacts(data, entity)) facts.push(fact);
  return facts;
}

function kindFacts(data: CampaignData, entity: Entity): Fact[] {
  const facts: Fact[] = [];
  const text = (label: string, value: string, tone?: Fact['tone']) => {
    if (value.trim()) facts.push({ label, text: value.trim(), tone });
  };
  const list = (label: string, ids: string[]) => {
    if (ids.length) facts.push({ label, ids, list: true });
  };
  switch (entity.kind) {
    case 'person': {
      const p = entity.person;
      text('Rolle', p.role);
      if (p.speciesId) facts.push({ label: 'Spezies', ids: [p.speciesId] });
      else text('Volk', p.species);
      text('Zustand', PERSON_STATUS_LABEL[p.status], p.status === 'alive' ? undefined : 'danger');
      if (p.placeId) facts.push({ label: 'Aufenthalt', ids: [p.placeId] });
      else facts.push({ label: 'Aufenthalt', text: 'unbekannt' });
      if (p.homeId) facts.push({ label: 'Zuhause', ids: [p.homeId] });
      if (p.workplaceId) facts.push({ label: 'Arbeitet bei', ids: [p.workplaceId] });
      list('Familie', families(data, entity.id));
      list('Sprachen', linkedIds(data, entity.id, 'speaks', ['language']));
      list('Fähigkeiten', linkedIds(data, entity.id, 'has-ability', ['ability']));
      list('Berufe', linkedIds(data, entity.id, 'practises', ['profession']));
      break;
    }
    case 'family':
      if (entity.family.seatId) facts.push({ label: 'Stammsitz', ids: [entity.family.seatId] });
      text('Art', entity.family.category);
      break;
    case 'language':
      if (entity.language.scriptId)
        facts.push({ label: 'Schrift', ids: [entity.language.scriptId] });
      text('Art', entity.language.category);
      break;
    case 'species':
    case 'script':
    case 'ability':
      text('Art', entityCategory(entity));
      break;
    case 'plant':
    case 'animal':
    case 'mineral': {
      const details = natureOf(entity);
      text('Art', details.category);
      if (details.rarity) text('Seltenheit', RARITY_LABEL[details.rarity]);
      text('Lebensraum', details.habitat.join(', '));
      list(
        'Vorkommen',
        details.regionIds.filter((id) => data.entities[id]),
      );
      text('Zeit', details.seasons.join(', '));
      if (details.price !== null) text('Wert', formatGold(details.price));
      break;
    }
    case 'profession':
      text('Art', entity.profession.category);
      text('Werkzeug', entity.profession.tool);
      break;
    case 'place': {
      const above = placeAncestors(data, entity.id).reverse();
      if (above.length) facts.push({ label: 'Liegt in', ...shortPath(above.map((p) => p.id)) });
      text('Art', entity.place.category);
      break;
    }
    case 'faction':
      if (entity.faction.seatId) facts.push({ label: 'Sitz', ids: [entity.faction.seatId] });
      text('Art', entity.faction.category);
      break;
    case 'item':
      if (entity.item.holderId)
        facts.push({ label: 'Befindet sich bei', ids: [entity.item.holderId] });
      else facts.push({ label: 'Verbleib', text: 'unbekannt' });
      text('Art', entity.item.category);
      if (entity.item.magic) text('Magie', magicTag(entity));
      {
        const value = valueOf(entity);
        if (value)
          text(
            'Wert',
            [formatGold(value.gold), value.note && `(${value.note})`].filter(Boolean).join(' '),
          );
      }
      break;
    case 'topic':
      text('Art', entity.topic.category);
      break;
    case 'character':
      text('Klasse', entity.character.className);
      text('Volk', entity.character.species);
      break;
  }
  return facts;
}

/** Sehr lange Namen stehen im Kopf des Dossiers eine Stufe kleiner, damit sie ihn nicht sprengen. */
export const isLongName = (name: string) => name.trim().length > 36;

/** Kürzt einen langen Pfad auf die oberste und die nächstgelegenen Ebenen. */
export function shortPath(ids: string[], max = 4): { ids: string[]; skipped?: number } {
  if (ids.length <= max) return { ids };
  return { ids: [ids[0]!, ...ids.slice(-(max - 1))], skipped: ids.length - max };
}

// ── Dossier: Zeit ──────────────────────────────────────────────────────────

/** Datum ohne Jahr, solange es im laufenden Jahr liegt. */
export function formatShortDate(cal: CalendarDef, now: WorldTime, time: WorldTime): string {
  return fromTime(cal, now).year === fromTime(cal, time).year
    ? formatDayMonth(cal, time)
    : formatDate(cal, time);
}

export interface VisitInfo {
  stay: Stay;
  /** „8. Tauwind“ */
  from: string;
  /** „11. Tauwind“; leer, solange die Gruppe noch dort ist oder am selben Tag wieder ging. */
  to: string;
  /** „3 Tage“ – bei laufendem Besuch die Dauer bis jetzt. */
  duration: string;
  ongoing: boolean;
  /** Wann die Gruppe zuletzt hier war: Ende des Besuchs, bei laufendem Besuch sein Beginn – „vor 6 Tagen“. */
  ago: string;
}

export function describeVisit(cal: CalendarDef, now: WorldTime, stay: Stay): VisitInfo {
  const end = stay.to ?? now;
  const sameDay = dayIndexOf(stay.from) === dayIndexOf(end);
  return {
    stay,
    from: formatShortDate(cal, now, stay.from),
    to: stay.to === null || sameDay ? '' : formatShortDate(cal, now, stay.to),
    duration: formatDuration(Math.max(0, end - stay.from)),
    ongoing: stay.to === null,
    ago: formatRelative(now, stay.to ?? stay.from),
  };
}

/** Kommende Termine, die an diesem Ort (oder darunter) stattfinden oder den Eintrag betreffen. */
export function upcomingFor(
  data: CampaignData,
  entityId: string,
  days = 120,
  limit = 6,
): Occurrence[] {
  const entity = data.entities[entityId];
  const placeIds = entity?.kind === 'place' ? placeSubtreeIds(data, entityId) : null;
  return upcomingOccurrences(data, days, 500)
    .filter(
      ({ event }) =>
        event.refs.includes(entityId) ||
        (placeIds !== null &&
          ((event.placeId !== null && placeIds.has(event.placeId)) ||
            event.refs.some((ref) => placeIds.has(ref)))),
    )
    .slice(0, limit);
}

// ── Dossier: Zusammenhänge ─────────────────────────────────────────────────

/** Unterzeile einer Person in der Besetzung eines Ortes: Rolle, Zustand und wo genau sie ist. */
export function castSubline(
  data: CampaignData,
  person: Person,
  placeId: string,
  away = false,
): string {
  const parts = [person.person.role];
  if (person.person.status !== 'alive') parts.push(PERSON_STATUS_LABEL[person.person.status]);
  const at = personPlace(data, person);
  if (away) parts.push(at ? `zurzeit: ${entityName(data, at)}` : 'Aufenthalt unbekannt');
  else if (at && at !== placeId) parts.push(entityName(data, at));
  return parts.filter(Boolean).join(' · ');
}

/** Wie ein über eine Beziehung verbundener Eintrag zum Ort steht: „herrscht über Dornhafen“. */
export function linkedSubline(
  data: CampaignData,
  placeId: string,
  link: PlaceCast['linked'][number],
): string {
  if (link.perspective === 'from' && isOneWay(link.relation))
    return relationSentence(data, placeId, link.entity.id, link.relation);
  const label = relationLabel(link.relation, link.perspective === 'from' ? 'to' : 'from');
  return `${label} ${entityName(data, placeId)}`;
}

/**
 * Die jüngsten Chronik-Einträge zu einem Eintrag, älteste zuerst – ohne das, was das Dossier
 * schon an anderer Stelle zeigt (Verlauf der Haltung zur Gruppe, offene Abmachungen).
 */
export function recentChronicle(
  data: CampaignData,
  entityId: string,
  limit = 3,
): { entries: ChronicleEntry[]; total: number } {
  const all = chronicleFor(data, entityId);
  const rest = all.filter(
    (e) =>
      !(e.kind === 'attitude' && e.attitude?.fromId === entityId && e.attitude.toId === PARTY_ID) &&
      !(e.kind === 'promise' && e.promise && !e.promise.done),
  );
  return { entries: rest.slice(-limit), total: all.length };
}

export interface Member {
  entity: Person | Character;
  /** null = gehört dazu, weil die Person dort arbeitet. */
  relation: Relation | null;
  /** Bezeichnung aus Sicht des Mitglieds: „führt“, „gehört zu“, „arbeitet für“. */
  label: string;
}

/**
 * Ziele der bestehenden Beziehungen einer Art, die von `fromId` ausgehen – etwa die Sprachen,
 * die eine Person spricht. Nach Namen sortiert.
 */
export function linkedIds(
  data: CampaignData,
  fromId: string,
  type: string,
  kinds: readonly Entity['kind'][],
): string[] {
  const ids = new Set<string>();
  for (const relation of Object.values(data.relations)) {
    if (relation.ended || relation.from !== fromId || relation.type !== type) continue;
    const target = data.entities[relation.to];
    if (target && kinds.includes(target.kind)) ids.add(target.id);
  }
  return [...ids].sort((a, b) => byName(data.entities[a]!, data.entities[b]!));
}

/** Wer über eine bestehende Beziehung einer Art auf `targetId` verweist: Sprecher einer Sprache … */
export function linkedFrom(
  data: CampaignData,
  targetId: string,
  type: string,
  kinds: readonly Entity['kind'][] = ['person', 'character'],
): Entity[] {
  const found = new Map<string, Entity>();
  for (const relation of Object.values(data.relations)) {
    if (relation.ended || relation.to !== targetId || relation.type !== type) continue;
    const source = data.entities[relation.from];
    if (source && kinds.includes(source.kind)) found.set(source.id, source);
  }
  return [...found.values()].sort(byName);
}

/** Familien, zu denen eine Person über eine bestehende Beziehung gehört (Mitglied, führt …). */
export function families(data: CampaignData, personId: string): string[] {
  const ids = new Set<string>();
  for (const relation of Object.values(data.relations)) {
    if (relation.ended) continue;
    const otherId =
      relation.from === personId ? relation.to : relation.to === personId ? relation.from : null;
    if (otherId && data.entities[otherId]?.kind === 'family') ids.add(otherId);
  }
  return [...ids].sort((a, b) => byName(data.entities[a]!, data.entities[b]!));
}

/** Personen einer Spezies. */
export function speciesMembers(data: CampaignData, speciesId: string): Person[] {
  return entitiesOfKind(data, 'person').filter((p) => p.person.speciesId === speciesId);
}

/** Sprachen, die in dieser Schrift geschrieben werden. */
export function languagesInScript(data: CampaignData, scriptId: string): Entity[] {
  return entitiesOfKind(data, 'language').filter((l) => l.language.scriptId === scriptId);
}

/** Personen, die an diesem Ort (oder in einem Ort darunter) arbeiten. */
export function workersAt(data: CampaignData, placeId: string): Person[] {
  const ids = placeSubtreeIds(data, placeId);
  return entitiesOfKind(data, 'person').filter(
    (p) => p.person.workplaceId !== null && ids.has(p.person.workplaceId),
  );
}

/**
 * Personen und Gefährten, die zu einer Fraktion oder Familie gehören: über eine bestehende
 * Beziehung oder weil sie dort arbeiten.
 */
export function groupMembers(data: CampaignData, groupId: string): Member[] {
  const members = new Map<string, Member>();
  const factionId = groupId;
  for (const relation of Object.values(data.relations)) {
    if (relation.ended) continue;
    const outgoing = relation.to === factionId;
    if (!outgoing && relation.from !== factionId) continue;
    const entity = data.entities[outgoing ? relation.from : relation.to];
    if (!entity || (entity.kind !== 'person' && entity.kind !== 'character')) continue;
    // Die Beziehung, die von der Person selbst ausgeht, hat Vorrang.
    if (members.has(entity.id) && !outgoing) continue;
    members.set(entity.id, {
      entity,
      relation,
      label:
        !outgoing && isOneWay(relation)
          ? relationSentence(data, relation.from, relation.to, relation)
          : relationLabel(relation, outgoing ? 'from' : 'to'),
    });
  }
  for (const person of entitiesOfKind(data, 'person'))
    if (person.person.workplaceId === factionId && !members.has(person.id))
      members.set(person.id, { entity: person, relation: null, label: 'arbeitet hier' });
  const rank = (m: Member) => (m.relation?.type === 'leads' && m.relation.to === factionId ? 0 : 1);
  return [...members.values()].sort((a, b) => rank(a) - rank(b) || byName(a.entity, b.entity));
}

/** Eine Familie oder Fraktion, die zu einer anderen gehört – mit dem Wort aus ihrer Sicht. */
export interface GroupMember {
  entity: Faction | Family;
  relation: Relation;
  label: string;
}

/**
 * Familien und Fraktionen, die zu dieser Gruppe gehören („gehört zu“, „führt“, „dient“ –
 * in beide Richtungen eingetragen). Ein Haus im Bund, eine Sippe im Orden.
 */
export function memberGroups(data: CampaignData, groupId: string): GroupMember[] {
  const out = new Map<string, GroupMember>();
  for (const relation of Object.values(data.relations)) {
    if (relation.ended || !BELONGS.has(relation.type)) continue;
    // „hat als Mitglied“ steht als `member` mit der Gruppe als `to`; rückwärts gelesen genauso.
    if (relation.to !== groupId) continue;
    const entity = data.entities[relation.from];
    if (!entity || (entity.kind !== 'family' && entity.kind !== 'faction')) continue;
    if (entity.id === groupId || out.has(entity.id)) continue;
    out.set(entity.id, { entity, relation, label: relationLabel(relation, 'from') });
  }
  return [...out.values()].sort((a, b) => byName(a.entity, b.entity));
}
const BELONGS = new Set(['member', 'leads', 'serves']);

// ── Galerie der Personen ───────────────────────────────────────────────────

export type KnownFilter = 'all' | 'known' | 'unknown';

export interface GalleryFilter {
  query: string;
  /** Nur Personen, die hier (oder darunter) sind, wohnen oder arbeiten. */
  placeId: string | null;
  known: KnownFilter;
}

/** Personen für die Galerie, nach Namen sortiert. */
export function galleryPeople(data: CampaignData, filter: GalleryFilter): Person[] {
  const ids = filter.placeId ? placeSubtreeIds(data, filter.placeId) : null;
  const inPlace = (id: string | null) => id !== null && ids !== null && ids.has(id);
  const pool =
    filter.query.trim() !== ''
      ? searchEntities(data, filter.query, { kinds: ['person'], limit: 1000 }).filter(
          (e): e is Person => e.kind === 'person',
        )
      : entitiesOfKind(data, 'person');
  return pool
    .filter(
      (p) =>
        (filter.known === 'all' || knowsPerson(data, p) === (filter.known === 'known')) &&
        (ids === null ||
          inPlace(personPlace(data, p)) ||
          inPlace(p.person.homeId) ||
          inPlace(p.person.workplaceId)),
    )
    .sort(byName);
}

/** Gegenstände, die bei diesem Eintrag sind (bei Orten auch in Orten darunter). */
export function itemsHeldBy(data: CampaignData, entityId: string): Item[] {
  const entity = data.entities[entityId];
  const ids = entity?.kind === 'place' ? placeSubtreeIds(data, entityId) : new Set([entityId]);
  return entitiesOfKind(data, 'item').filter(
    (item) => item.item.holderId && ids.has(item.item.holderId),
  );
}

export interface RelationRow {
  /** Entity-ID oder PARTY_ID. */
  otherId: string;
  name: string;
  /** Fehlt bei der Gruppe und bei gelöschten Einträgen. */
  entity: Entity | undefined;
  outgoing: Relation | null;
  incoming: Relation | null;
  /**
   * Bezeichnung aus Sicht dieses Eintrags: „führt“, „wird gefürchtet von“. Bei einer eigenen
   * Bezeichnung, die vom Gegenüber ausgeht, der ganze Satz: „Voss erpresst Maera“.
   */
  label: string;
  /** Bezeichnung aus Sicht des Gegenübers. */
  inverseLabel: string;
  /**
   * Die Bezeichnung ist frei formuliert („schuldet seit Jahren Geld an“) oder ein ganzer Satz.
   * Solche Bezeichnungen stehen nicht in Versalien, sonst werden sie unlesbar.
   */
  freeText: boolean;
  /** Alle vorhandenen Richtungen sind beendet. */
  ended: boolean;
  /** Mindestens eine Richtung ist der Gruppe unbekannt. */
  secret: boolean;
  notes: string[];
}

/** Beziehungen eines Eintrags je Gegenüber; bestehende vor beendeten. */
export function relationRows(data: CampaignData, entityId: string): RelationRow[] {
  const rows = relationPairs(data, entityId).map((pair): RelationRow => {
    const { outgoing, incoming } = pair;
    const present = [outgoing, incoming].filter((r): r is Relation => r !== null);
    // Gibt es beide Richtungen, benennt die aussagekräftigere die Beziehung („dient“ vor „kennt“).
    const telling =
      outgoing && (outgoing.type !== 'knows' || !incoming || incoming.type === 'knows')
        ? outgoing
        : (incoming ?? outgoing);
    // Eine eigene Bezeichnung („erpresst“) gilt nur in ihrer Richtung. Vom Gegenüber aus gesehen
    // steht deshalb der ganze Satz da, sonst läse sie sich verkehrt herum.
    const spelledOut =
      telling !== outgoing && isOneWay(telling!)
        ? relationSentence(data, pair.otherId, entityId, telling!)
        : null;
    return {
      otherId: pair.otherId,
      name: entityName(data, pair.otherId),
      entity: data.entities[pair.otherId],
      outgoing,
      incoming,
      label:
        spelledOut ??
        (telling === outgoing ? relationLabel(telling!, 'from') : relationLabel(telling!, 'to')),
      inverseLabel:
        spelledOut ??
        (telling === outgoing ? relationLabel(telling!, 'to') : relationLabel(telling!, 'from')),
      freeText: isOneWay(telling!),
      ended: present.every((r) => r.ended),
      secret: present.some((r) => r.secret),
      notes: present.map((r) => r.note.trim()).filter(Boolean),
    };
  });
  return [...rows.filter((r) => !r.ended), ...rows.filter((r) => r.ended)];
}

/** Eigene Bezeichnungen haben keine Umkehrung; sie lassen sich nur von ihrem Ausgangspunkt aus lesen. */
const isOneWay = (relation: { type: string }) => relationType(relation.type).key === 'custom';

/** „Maera Duskryn führt Haus Duskryn“ */
export function relationSentence(
  data: CampaignData,
  fromId: string,
  toId: string,
  relation: { type: string; label: string },
): string {
  return `${entityName(data, fromId)} ${relationLabel(relation, 'from')} ${entityName(data, toId)}`;
}

export interface RelationDraft {
  type: string;
  label: string;
  attitude: number | null;
  note: string;
  secret: boolean;
  ended: boolean;
}

/**
 * Entwurf einer Richtung. Ohne gespeicherte Beziehung gilt die Vorgabe des Paares (`preset`,
 * `presetType`) – „kennt“ nur, wenn nichts anderes angegeben ist.
 */
export function relationDraft(relation?: Relation | null, preset = 'knows'): RelationDraft {
  return {
    type: relation?.type ?? preset,
    label: relation?.label ?? '',
    attitude: relation?.attitude ?? null,
    note: relation?.note ?? '',
    secret: relation?.secret ?? false,
    ended: relation?.ended ?? false,
  };
}

/** Hat der Entwurf gegenüber der gespeicherten Beziehung (oder der Vorgabe) etwas geändert? */
export function relationDraftChanged(
  draft: RelationDraft,
  relation?: Relation | null,
  preset?: string,
): boolean {
  const base = relationDraft(relation, preset);
  return (
    draft.type !== base.type ||
    draft.label.trim() !== base.label.trim() ||
    draft.attitude !== base.attitude ||
    draft.note.trim() !== base.note.trim() ||
    draft.secret !== base.secret ||
    draft.ended !== base.ended
  );
}

/**
 * Wird diese Richtung beim Speichern geschrieben? Geändertes immer. Unverändertes nur, wenn
 * zwischen den beiden noch gar nichts besteht: Dann entsteht die Beziehung, die im Dialog gerade
 * zu sehen ist, auch mit den Vorgaben („kennt“). Eine leere Gegenrichtung, in die man nur
 * hineingesehen hat, bleibt leer.
 */
export function savesDirection(
  draft: RelationDraft,
  current: Relation | null | undefined,
  context: { active: boolean; pairExists: boolean; preset?: string },
): boolean {
  if (relationDraftChanged(draft, current, context.preset)) return true;
  return !current && context.active && !context.pairExists;
}

/**
 * In welcher Richtung der Beziehungsdialog beginnt: bei einer vorhandenen Beziehung in ihrer
 * Richtung, sonst in der gewünschten (`prefer`).
 */
export function startDirection(
  outgoing: Relation | null | undefined,
  incoming: Relation | null | undefined,
  prefer: 'out' | 'in' = 'out',
): 'out' | 'in' {
  if (outgoing && incoming) return prefer;
  if (outgoing) return 'out';
  if (incoming) return 'in';
  return prefer;
}

/**
 * Entwürfe beider Richtungen für ein gewähltes Gegenüber. Beim Eintragen eines Mitglieds geht
 * eine neue Beziehung vom Mitglied aus: „Kessa gehört zu den Lotsen“.
 */
export function relationDrafts(
  outgoing: Relation | null | undefined,
  incoming: Relation | null | undefined,
  asMember = false,
  presets: { out: string; in: string } = { out: 'knows', in: 'knows' },
): Record<'out' | 'in', RelationDraft> {
  const fresh = !outgoing && !incoming;
  return {
    out: relationDraft(outgoing, presets.out),
    in:
      fresh && asMember
        ? { ...relationDraft(), type: 'member' }
        : relationDraft(incoming, presets.in),
  };
}

/** Die Art eines Gegenübers für die Regeln der Beziehungen: die Gruppe ist `'party'`. */
export const relationKind = (data: CampaignData, id: string | null): string =>
  id === PARTY_ID ? 'party' : ((id && data.entities[id]?.kind) ?? '');

/** Die Vorgaben beider Richtungen zwischen `selfId` und `otherId` (`presetType`). */
export function relationPresets(
  data: CampaignData,
  selfId: string,
  otherId: string | null,
): { out: string; in: string } {
  const self = relationKind(data, selfId);
  const other = relationKind(data, otherId);
  return { out: presetType(self, other), in: presetType(other, self) };
}

/** Die Gruppe kann nur Ziel einer Beziehung sein, nie ihr Ausgangspunkt. */
export const canRelateFrom = (id: string) => id !== PARTY_ID;

// ── Löschen ────────────────────────────────────────────────────────────────

export interface DeletionImpact {
  relations: number;
  /** Chronik-Einträge, die den Eintrag erwähnen; sie bleiben erhalten. */
  chronicle: number;
  /** Orte direkt darunter; sie rücken eine Ebene nach oben. */
  children: number;
  /** Andere Einträge, bei denen eine Angabe zu diesem Eintrag geleert wird. */
  residents: number;
  events: number;
  partyIsHere: boolean;
}

/** Was das Löschen eines Eintrags nach sich zieht – für die Rückfrage. */
export function deletionImpact(data: CampaignData, entityId: string): DeletionImpact {
  let residents = 0;
  let children = 0;
  for (const other of Object.values(data.entities)) {
    if (other.id === entityId || !linksTo(other, entityId)) continue;
    if (other.kind === 'place') children++;
    else residents++;
  }
  return {
    relations: Object.values(data.relations).filter((r) => r.from === entityId || r.to === entityId)
      .length,
    chronicle: Object.values(data.chronicle).filter(
      (e) => e.refs.includes(entityId) || e.placeId === entityId,
    ).length,
    children,
    residents,
    events: Object.values(data.events).filter(
      (e) => e.placeId === entityId || e.refs.includes(entityId),
    ).length,
    partyIsHere: data.state.placeId === entityId,
  };
}

/** Sätze für die Rückfrage vor dem Löschen. */
export function deletionNotes(impact: DeletionImpact): string[] {
  const notes: string[] = [];
  const say = (count: number, one: string, many: string) => {
    if (count > 0) notes.push(count === 1 ? one : many.replace('#', String(count)));
  };
  say(impact.relations, 'Eine Beziehung wird mit gelöscht.', '# Beziehungen werden mit gelöscht.');
  say(
    impact.children,
    'Ein Ort darunter rückt eine Ebene nach oben.',
    '# Orte darunter rücken eine Ebene nach oben.',
  );
  say(
    impact.residents,
    'Bei einem anderen Eintrag wird die Angabe zu diesem Eintrag geleert.',
    'Bei # anderen Einträgen wird die Angabe zu diesem Eintrag geleert.',
  );
  say(
    impact.events,
    'Ein Termin verliert den Verweis auf diesen Eintrag.',
    '# Termine verlieren den Verweis auf diesen Eintrag.',
  );
  say(
    impact.chronicle,
    'Ein Chronik-Eintrag bleibt erhalten, nennt dann aber einen gelöschten Eintrag.',
    '# Chronik-Einträge bleiben erhalten, nennen dann aber einen gelöschten Eintrag.',
  );
  if (impact.partyIsHere)
    notes.push('Die Gruppe ist gerade hier; ihr Aufenthaltsort ist danach offen.');
  return notes;
}

// ── Bearbeiten ─────────────────────────────────────────────────────────────

/** Trennt eine mit Komma oder Semikolon geschriebene Liste; ohne Leeres und Doppeltes. */
export function splitList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,;\n]/)) {
    const value = part.trim();
    const key = value.toLocaleLowerCase('de');
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Inhalt des Dialogs „Eintrag bearbeiten“. Hält die Felder aller Arten, gespeichert werden die passenden. */
export interface EntityDraft {
  kind: WorldKind;
  name: string;
  /** Mit Komma getrennt. */
  aliases: string;
  tagline: string;
  notes: string;
  secret: string;
  /** Mit Komma getrennt. */
  tags: string;
  image: string | null;
  /** Ort, Fraktion, Gegenstand, Thema. */
  category: string;
  // Person
  role: string;
  /** Freitext der ersten Welle; gilt nur, solange keine Spezies gewählt ist. */
  species: string;
  speciesId: string | null;
  workplaceId: string | null;
  status: PersonStatus;
  placeId: string | null;
  homeId: string | null;
  met: boolean;
  /** Über Beziehungen: Familien („gehört zu“), Sprachen („spricht“), Fähigkeiten („verfügt über“). */
  familyIds: string[];
  languageIds: string[];
  abilityIds: string[];
  // Ort
  parentId: string | null;
  /** Oberster Ort: der Himmelskörper oder die Dimension, worin er liegt. */
  worldId: string | null;
  /** Himmelskörper: die Dimension, in der er liegt. */
  dimensionId: string | null;
  /** Größe eines Ortes; '' = offen (Wayfarer liest sie aus dem eigenen Wort). */
  scale: PlaceScale | '';
  // Fraktion und Familie
  seatId: string | null;
  // Gegenstand
  holderId: string | null;
  /** Gegenstand: magisch (die Angaben dazu stehen dann auf seiner Seite unter „Magie“). */
  magic: boolean;
  // Sprache
  scriptId: string | null;
  /** Pflanze, Tier, Gestein: Lebensräume, Gegenden, Jahreszeiten, Seltenheit, Preis als Text. */
  habitat: string[];
  regionIds: string[];
  seasons: string[];
  rarity: Rarity | '';
  price: string;
  /** Tier: Kampfwerte im Bestiarium. */
  creatureId: string | null;
  /** Beruf: Werkzeug. */
  tool: string;
  /** Person: Berufe („übt aus“). */
  professionIds: string[];
  /** Lebensdaten als Worte: „3. Tauwind 667“, „667“, „vor 300 Jahren“, bei Lebewesen auch „Alter 34“. */
  born: string;
  ended: string;
  /** Gehört der Vergangenheit an, auch ohne bekanntes Datum (`entity.past`). */
  past: boolean;
  /** Die eigene Kategorie des Spielleiters (`campaign.ownKinds`) – null = keine. */
  ownKindId: string | null;
}

/** Beziehungen, die der Dialog bei einer Person als Auswahl führt: Feld, Art und Ziel. */
export const PERSON_LINKS = [
  { field: 'familyIds', type: 'member', kinds: ['family'] },
  { field: 'languageIds', type: 'speaks', kinds: ['language'] },
  { field: 'abilityIds', type: 'has-ability', kinds: ['ability'] },
  { field: 'professionIds', type: 'practises', kinds: ['profession'] },
] as const satisfies readonly {
  field: keyof EntityDraft;
  type: string;
  kinds: readonly Entity['kind'][];
}[];

export function emptyDraft(kind: WorldKind, preset: Partial<EntityDraft> = {}): EntityDraft {
  return {
    kind,
    name: '',
    aliases: '',
    tagline: '',
    notes: '',
    secret: '',
    tags: '',
    image: null,
    category: '',
    role: '',
    species: '',
    speciesId: null,
    workplaceId: null,
    status: 'alive',
    placeId: null,
    homeId: null,
    met: false,
    familyIds: [],
    languageIds: [],
    abilityIds: [],
    parentId: null,
    worldId: null,
    dimensionId: null,
    scale: '',
    seatId: null,
    holderId: null,
    magic: false,
    scriptId: null,
    habitat: [],
    regionIds: [],
    seasons: [],
    rarity: '',
    price: '',
    creatureId: null,
    tool: '',
    professionIds: [],
    born: '',
    ended: '',
    past: false,
    ownKindId: null,
    ...preset,
  };
}

/** Entwurf aus einem gespeicherten Eintrag; `data` liefert die Auswahl, die über Beziehungen läuft. */
export function draftOf(entity: WorldEntity, data?: CampaignData): EntityDraft {
  const draft = emptyDraft(entity.kind, {
    name: entity.name,
    aliases: entity.aliases.join(', '),
    tagline: entity.tagline,
    notes: entity.notes,
    secret: entity.secret,
    tags: entity.tags.join(', '),
    image: entity.image,
    born: data ? datePointText(data.campaign.calendar, entity.born) : '',
    ended: data ? datePointText(data.campaign.calendar, entity.ended) : '',
    past: entity.past,
    ownKindId: entity.ownKindId,
  });
  if (entity.kind === 'person') {
    const links = Object.fromEntries(
      PERSON_LINKS.map(({ field, type, kinds }) => [
        field,
        data ? linkedIds(data, entity.id, type, kinds) : [],
      ]),
    );
    return { ...draft, ...entity.person, ...links };
  }
  if (isNature(entity)) {
    const { price, ...details } = natureOf(entity);
    return { ...draft, ...details, price: priceText(price) };
  }
  if (entity.kind === 'item') {
    const { price, holderId, category } = entity.item;
    return { ...draft, holderId, category, price: priceText(price), magic: !!entity.item.magic };
  }
  const details = (entity as unknown as Record<string, Partial<EntityDraft>>)[entity.kind];
  return { ...draft, ...details };
}

const sameValue = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b) ? a.join('\u0000') === b.join('\u0000') : a === b;

/** Wurde im Dialog etwas eingetragen oder geändert? Die gewählte Art allein zählt nicht. */
export function draftChanged(draft: EntityDraft, baseline: EntityDraft): boolean {
  return (Object.keys(baseline) as (keyof EntityDraft)[]).some(
    (key) => key !== 'kind' && !sameValue(draft[key], baseline[key]),
  );
}

/** Prüft den Entwurf; gibt eine Meldung zurück oder null, wenn gespeichert werden kann. */
export function draftProblem(
  data: CampaignData,
  draft: EntityDraft,
  entityId: string | null,
): string | null {
  if (!draft.name.trim()) return 'Der Eintrag braucht einen Namen.';
  const words = lifeWords(draft.kind);
  for (const [text, word, age] of [
    [draft.born, words.start, draft.kind === 'person'],
    [draft.ended, words.end, false],
  ] as const)
    if (text.trim() && !readDatePoint(data.campaign.calendar, text, data.state.now, { age }))
      return `„${word}“ verstehe ich nicht – zum Beispiel „3. Tauwind 667“, „667“ oder „vor 300 Jahren“${age ? ' oder „Alter 34“' : ''}.`;
  if ((isNatureKind(draft.kind) || draft.kind === 'item') && readPrice(draft.price) === undefined)
    return '„Wert“ verstehe ich nicht – zum Beispiel „12“, „2,5 GM“ oder „5 Silber“.';
  if (draft.kind === 'place' && draft.parentId) {
    const parent = data.entities[draft.parentId];
    if (!parent || parent.kind !== 'place') return 'Der übergeordnete Ort existiert nicht mehr.';
    if (entityId && wouldCreatePlaceCycle(data, entityId, draft.parentId))
      return 'Ein Ort kann nicht in sich selbst oder in einem seiner eigenen Unterorte liegen.';
  }
  return null;
}

/** Orte, die als Elternort nicht in Frage kommen: der Ort selbst und alles darunter. */
export function forbiddenParents(data: CampaignData, placeId: string | null): string[] {
  return placeId ? [...placeSubtreeIds(data, placeId)] : [];
}

/**
 * Baut aus dem Entwurf den Eintrag zum Speichern. Bei einem vorhandenen Eintrag bleiben ID,
 * LegendKeeper-Verknüpfung und alle Felder erhalten, die der Dialog nicht kennt.
 */
export function entityFromDraft(
  draft: EntityDraft,
  existing?: WorldEntity,
  data?: Pick<CampaignData, 'campaign' | 'state'>,
): WorldEntity {
  const built = buildFromDraft(draft, existing, data);
  if (!existing || existing.kind === draft.kind) return built;
  // Die Kategorie wurde geändert: Es bleibt derselbe Eintrag – Kennung, Artikel, Platzhalter –,
  // nur die Angaben, die allein die alte Kategorie hatte, fallen weg. Was aus dem Steckbrief
  // stammt, liest Wayfarer mit den Feldern der neuen Kategorie neu (`fromArticle` leer).
  return {
    ...built,
    id: existing.id,
    rev: existing.rev,
    created: existing.created,
    updated: existing.updated,
    lk: existing.lk,
    stub: existing.stub,
    fromStoryId: existing.fromStoryId,
    fromArticle: {},
  } as WorldEntity;
}

/** Wo ein Eintrag ist, liegt oder sitzt – das eine „Wo“ jeder Kategorie, die eines hat. */
const WHERE_FIELD: Partial<Record<WorldKind, 'placeId' | 'parentId' | 'seatId'>> = {
  person: 'placeId',
  place: 'parentId',
  faction: 'seatId',
  family: 'seatId',
};

/**
 * Der Entwurf in einer anderen Kategorie (Rückmeldung des Spielleiters, 18. 11. 2026: „Jana Becker
 * wird als Ort angezeigt und ist offensichtlich eine Person“ – „man muss alles anpassen können“).
 * Mit hinüber gehen das eigene Wort (bei Personen die Rolle) und das „Wo“; alles Gemeinsame
 * (Name, Satz, Notizen, Geheimnis, Lebensdaten) steht ohnehin im Entwurf.
 */
export function draftWithKind(
  draft: EntityDraft,
  kind: WorldKind,
  ownKindId: string | null = null,
): EntityDraft {
  if (draft.kind === kind) return { ...draft, ownKindId };
  const word = (draft.kind === 'person' ? draft.role : draft.category).trim();
  const fromField = WHERE_FIELD[draft.kind];
  const where = fromField ? draft[fromField] : null;
  const toField = WHERE_FIELD[kind];
  return {
    ...draft,
    kind,
    ownKindId,
    ...(kind === 'person' ? { role: draft.role.trim() || word } : { category: word }),
    ...(toField && !draft[toField] ? { [toField]: where } : {}),
    // Ein Ort, der ein Himmelskörper wird, bleibt in seiner Dimension.
    ...(kind === 'celestial' && draft.kind === 'place' && !draft.dimensionId
      ? { dimensionId: draft.worldId }
      : {}),
  };
}

function buildFromDraft(
  draft: EntityDraft,
  existing?: WorldEntity,
  data?: Pick<CampaignData, 'campaign' | 'state'>,
): WorldEntity {
  // Lebensdaten: nur mit Kalender lesbar; unverändert bleibt der genaue gespeicherte Wert.
  const life = (text: string, kept: DatePoint | null, age: boolean): DatePoint | null => {
    if (!data) return kept;
    if (text.trim() === datePointText(data.campaign.calendar, kept)) return kept;
    return readDatePoint(data.campaign.calendar, text, data.state.now, { age });
  };
  const common = {
    born: life(draft.born, existing?.born ?? null, draft.kind === 'person'),
    ended: life(draft.ended, existing?.ended ?? null, false),
    name: draft.name.trim(),
    aliases: splitList(draft.aliases),
    tagline: draft.tagline.trim(),
    notes: draft.notes.trim(),
    secret: draft.secret.trim(),
    tags: splitList(draft.tags),
    image: draft.image,
    past: draft.past,
    ownKindId: draft.ownKindId,
  };
  const category = draft.category.trim();
  const base = existing && existing.kind === draft.kind ? existing : undefined;
  switch (draft.kind) {
    case 'person': {
      const person = {
        role: draft.role.trim(),
        // Mit gewählter Spezies ist der alte Freitext überholt.
        species: draft.speciesId ? '' : draft.species.trim(),
        speciesId: draft.speciesId,
        workplaceId: draft.workplaceId,
        status: draft.status,
        placeId: draft.placeId,
        homeId: draft.homeId,
        met: draft.met,
      };
      return base?.kind === 'person'
        ? { ...base, ...common, person: { ...base.person, ...person } }
        : createEntity({ kind: 'person', ...common, person });
    }
    case 'place': {
      // Unter einem Ort gilt dessen Welt; nur ein oberster Ort trägt selbst eine.
      const place = {
        parentId: draft.parentId,
        worldId: draft.parentId ? null : draft.worldId,
        category,
        scale: draft.scale,
      };
      return base?.kind === 'place'
        ? { ...base, ...common, place: { ...base.place, ...place } }
        : createEntity({ kind: 'place', ...common, place });
    }
    case 'faction': {
      const faction = { seatId: draft.seatId, category };
      return base?.kind === 'faction'
        ? { ...base, ...common, faction: { ...base.faction, ...faction } }
        : createEntity({ kind: 'faction', ...common, faction });
    }
    case 'item': {
      const item = { holderId: draft.holderId, category, price: readPrice(draft.price) ?? null };
      // Magisch machen ja – zurück nur auf der Seite unter „Magie“, wo nichts verloren geht.
      const magic =
        base?.kind === 'item' && base.item.magic
          ? base.item.magic
          : draft.magic
            ? emptyMagic()
            : null;
      return base?.kind === 'item'
        ? { ...base, ...common, item: { ...base.item, ...item, magic } }
        : createEntity({ kind: 'item', ...common, item: { ...item, magic } });
    }
    case 'family': {
      const family = { seatId: draft.seatId, category };
      return base?.kind === 'family'
        ? { ...base, ...common, family: { ...base.family, ...family } }
        : createEntity({ kind: 'family', ...common, family });
    }
    case 'language': {
      const language = { scriptId: draft.scriptId, category };
      return base?.kind === 'language'
        ? { ...base, ...common, language: { ...base.language, ...language } }
        : createEntity({ kind: 'language', ...common, language });
    }
    case 'plant':
    case 'animal':
    case 'mineral': {
      const nature = {
        category,
        habitat: cleanWords(draft.habitat),
        regionIds: [...new Set(draft.regionIds)],
        seasons: cleanWords(draft.seasons),
        rarity: draft.rarity,
        price: readPrice(draft.price) ?? null,
      };
      if (draft.kind === 'animal') {
        const animal = { ...nature, creatureId: draft.creatureId };
        return base?.kind === 'animal'
          ? { ...base, ...common, animal: { ...base.animal, ...animal } }
          : createEntity({ kind: 'animal', ...common, animal });
      }
      const kind = draft.kind;
      if (base) {
        const details = (base as unknown as Record<string, object>)[kind];
        return { ...base, ...common, [kind]: { ...details, ...nature } } as WorldEntity;
      }
      return createEntity({ kind, ...common, [kind]: nature }) as WorldEntity;
    }
    case 'profession': {
      const profession = { category, tool: draft.tool.trim() };
      return base?.kind === 'profession'
        ? { ...base, ...common, profession: { ...base.profession, ...profession } }
        : createEntity({ kind: 'profession', ...common, profession });
    }
    case 'celestial': {
      const celestial = { category, dimensionId: draft.dimensionId };
      return base?.kind === 'celestial'
        ? { ...base, ...common, celestial: { ...base.celestial, ...celestial } }
        : createEntity({ kind: 'celestial', ...common, celestial });
    }
    case 'topic':
    case 'species':
    case 'script':
    case 'ability':
    case 'deity':
    case 'realm':
    case 'happening':
    case 'landscape':
    case 'dimension': {
      const kind = draft.kind;
      if (base) {
        const details = (base as unknown as Record<string, object>)[kind];
        return { ...base, ...common, [kind]: { ...details, category } } as WorldEntity;
      }
      return createEntity({ kind, ...common, [kind]: { category } }) as WorldEntity;
    }
  }
}

/** Wörter einer Liste ohne Leere und ohne Doppelte (gleich geschrieben, groß oder klein). */
function cleanWords(words: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const word of words) {
    const clean = word.replace(/\s+/g, ' ').trim();
    const key = clean.toLocaleLowerCase('de');
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/** Gibt es schon einen Eintrag dieser Art mit demselben Namen? (Hinweis, kein Verbot.) */
export function nameTwin(
  data: CampaignData,
  draft: EntityDraft,
  entityId: string | null,
): Entity | undefined {
  const name = draft.name.trim().toLocaleLowerCase('de');
  if (!name) return undefined;
  return Object.values(data.entities).find(
    (e) =>
      e.id !== entityId && e.kind === draft.kind && e.name.trim().toLocaleLowerCase('de') === name,
  );
}

// ── Bild ───────────────────────────────────────────────────────────────────

/** Größe, auf die ein Bild verkleinert wird, damit keine Kante länger als `max` ist. Vergrößert nie. */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max || longest <= 0)
    return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
