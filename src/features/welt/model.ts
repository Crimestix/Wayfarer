/**
 * Fachlogik der Weltdatenbank: Übersicht (Baum der Orte, Listen, Zahlen), Fakten für das Dossier,
 * Beziehungszeilen und der Entwurf, aus dem der Bearbeiten-Dialog einen Eintrag baut.
 * Reine Funktionen ohne React.
 */
import {
  byName,
  chronicleFor,
  entitiesOfKind,
  entityName,
  placeAncestors,
  placeSubtreeIds,
  relationPairs,
  searchEntities,
  upcomingOccurrences,
  wouldCreatePlaceCycle,
  type Occurrence,
  type PlaceCast,
  type Stay,
} from '../../domain/derive';
import { relationLabel, relationType } from '../../domain/relations';
import {
  PARTY_ID,
  createEntity,
  type CampaignData,
  type Character,
  type ChronicleEntry,
  type Entity,
  type Item,
  type Person,
  type PersonStatus,
  type Place,
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

// ── Arten ──────────────────────────────────────────────────────────────────

/** Was in der Weltdatenbank steht. Gefährten haben ihren eigenen Bereich. */
export const WORLD_KINDS = ['place', 'person', 'faction', 'item', 'topic'] as const;
export type WorldKind = (typeof WORLD_KINDS)[number];
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
  topic: ['Gerücht', 'Geschichte', 'Glaube', 'Rätsel', 'Handlungsfaden'],
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

function entityCategory(entity: Entity): string {
  switch (entity.kind) {
    case 'place':
      return entity.place.category;
    case 'faction':
      return entity.faction.category;
    case 'item':
      return entity.item.category;
    case 'topic':
      return entity.topic.category;
    default:
      return '';
  }
}

// ── Übersicht ──────────────────────────────────────────────────────────────

export function worldCounts(data: CampaignData): Record<WorldKind, number> {
  const counts: Record<WorldKind, number> = { place: 0, person: 0, faction: 0, item: 0, topic: 0 };
  for (const entity of Object.values(data.entities))
    if (isWorldKind(entity.kind)) counts[entity.kind]++;
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
 * zugeklappt wurde; ohne Angabe sind nur die obersten Orte aufgeklappt.
 */
export function placeTreeRows(
  data: CampaignData,
  openState: Readonly<Record<string, boolean>> = {},
): PlaceRow[] {
  const places = entitiesOfKind(data, 'place');
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
      if (entity.person.placeId) parts.push(entityName(data, entity.person.placeId));
      break;
    case 'place':
      parts.push(entity.place.category);
      break;
    case 'faction':
      parts.push(entity.faction.category);
      if (entity.faction.seatId) parts.push(entityName(data, entity.faction.seatId));
      break;
    case 'item':
      parts.push(entity.item.category);
      if (entity.item.holderId) parts.push(entityName(data, entity.item.holderId));
      break;
    case 'topic':
      parts.push(entity.topic.category);
      break;
    case 'character':
      parts.push(entity.character.className, entity.character.player);
      break;
  }
  return parts.filter(Boolean).join(' · ');
}

/** Treffer der Suche in der Übersicht, beste zuerst; Gefährten gehören nicht dazu. */
export function searchWorld(data: CampaignData, query: string, filter: KindFilter): WorldEntity[] {
  const kinds: WorldKind[] = filter === 'all' ? [...WORLD_KINDS] : [filter];
  return searchEntities(data, query, { kinds, limit: 500 }).filter(isWorldEntity);
}

// ── Dossier: Fakten im Kopf ────────────────────────────────────────────────

export interface Fact {
  label: string;
  /** Freier Text. */
  text?: string;
  /** Verweise auf Einträge; mehrere werden als Pfad mit „›“ dargestellt. */
  ids?: string[];
  /** So viele Ebenen des Pfades sind nach dem ersten Verweis ausgelassen. */
  skipped?: number;
  /** Hebt den Wert hervor, z. B. „Tot“. */
  tone?: 'danger';
}

/** Die wichtigsten Fakten eines Eintrags für die Zeile unter dem Namen. */
export function entityFacts(data: CampaignData, entity: Entity): Fact[] {
  const facts: Fact[] = [];
  const text = (label: string, value: string, tone?: Fact['tone']) => {
    if (value.trim()) facts.push({ label, text: value.trim(), tone });
  };
  switch (entity.kind) {
    case 'person': {
      const p = entity.person;
      text('Rolle', p.role);
      text('Volk', p.species);
      text('Zustand', PERSON_STATUS_LABEL[p.status], p.status === 'alive' ? undefined : 'danger');
      if (p.placeId) facts.push({ label: 'Aufenthalt', ids: [p.placeId] });
      else facts.push({ label: 'Aufenthalt', text: 'unbekannt' });
      if (p.homeId) facts.push({ label: 'Zuhause', ids: [p.homeId] });
      break;
    }
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
  const at = person.person.placeId;
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
  relation: Relation;
  /** Bezeichnung aus Sicht des Mitglieds: „führt“, „gehört zu“, „arbeitet für“. */
  label: string;
}

/** Personen und Gefährten, die über eine bestehende Beziehung mit der Fraktion verbunden sind. */
export function factionMembers(data: CampaignData, factionId: string): Member[] {
  const members = new Map<string, Member>();
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
  const rank = (m: Member) => (m.relation.type === 'leads' && m.relation.to === factionId ? 0 : 1);
  return [...members.values()].sort((a, b) => rank(a) - rank(b) || byName(a.entity, b.entity));
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

export function relationDraft(relation?: Relation | null): RelationDraft {
  return {
    type: relation?.type ?? 'knows',
    label: relation?.label ?? '',
    attitude: relation?.attitude ?? null,
    note: relation?.note ?? '',
    secret: relation?.secret ?? false,
    ended: relation?.ended ?? false,
  };
}

/** Hat der Entwurf gegenüber der gespeicherten Beziehung (oder der Vorgabe) etwas geändert? */
export function relationDraftChanged(draft: RelationDraft, relation?: Relation | null): boolean {
  const base = relationDraft(relation);
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
  context: { active: boolean; pairExists: boolean },
): boolean {
  if (relationDraftChanged(draft, current)) return true;
  return !current && context.active && !context.pairExists;
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
  /** Personen, Fraktionen, Gegenstände und Gefährten, deren Ortsangabe geleert wird. */
  residents: number;
  events: number;
  partyIsHere: boolean;
}

/** Was das Löschen eines Eintrags nach sich zieht – für die Rückfrage. */
export function deletionImpact(data: CampaignData, entityId: string): DeletionImpact {
  let residents = 0;
  let children = 0;
  for (const other of Object.values(data.entities)) {
    if (other.id === entityId) continue;
    if (
      other.kind === 'person' &&
      (other.person.placeId === entityId || other.person.homeId === entityId)
    )
      residents++;
    else if (other.kind === 'faction' && other.faction.seatId === entityId) residents++;
    else if (other.kind === 'item' && other.item.holderId === entityId) residents++;
    else if (other.kind === 'character' && other.character.placeId === entityId) residents++;
    else if (other.kind === 'place' && other.place.parentId === entityId) children++;
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
  species: string;
  status: PersonStatus;
  placeId: string | null;
  homeId: string | null;
  met: boolean;
  // Ort
  parentId: string | null;
  // Fraktion
  seatId: string | null;
  // Gegenstand
  holderId: string | null;
}

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
    status: 'alive',
    placeId: null,
    homeId: null,
    met: false,
    parentId: null,
    seatId: null,
    holderId: null,
    ...preset,
  };
}

export function draftOf(entity: WorldEntity): EntityDraft {
  const draft = emptyDraft(entity.kind, {
    name: entity.name,
    aliases: entity.aliases.join(', '),
    tagline: entity.tagline,
    notes: entity.notes,
    secret: entity.secret,
    tags: entity.tags.join(', '),
    image: entity.image,
  });
  switch (entity.kind) {
    case 'person':
      return { ...draft, ...entity.person };
    case 'place':
      return { ...draft, ...entity.place };
    case 'faction':
      return { ...draft, ...entity.faction };
    case 'item':
      return { ...draft, ...entity.item };
    case 'topic':
      return { ...draft, ...entity.topic };
  }
}

/** Wurde im Dialog etwas eingetragen oder geändert? Die gewählte Art allein zählt nicht. */
export function draftChanged(draft: EntityDraft, baseline: EntityDraft): boolean {
  return (Object.keys(baseline) as (keyof EntityDraft)[]).some(
    (key) => key !== 'kind' && draft[key] !== baseline[key],
  );
}

/** Prüft den Entwurf; gibt eine Meldung zurück oder null, wenn gespeichert werden kann. */
export function draftProblem(
  data: CampaignData,
  draft: EntityDraft,
  entityId: string | null,
): string | null {
  if (!draft.name.trim()) return 'Der Eintrag braucht einen Namen.';
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
export function entityFromDraft(draft: EntityDraft, existing?: WorldEntity): WorldEntity {
  const common = {
    name: draft.name.trim(),
    aliases: splitList(draft.aliases),
    tagline: draft.tagline.trim(),
    notes: draft.notes.trim(),
    secret: draft.secret.trim(),
    tags: splitList(draft.tags),
    image: draft.image,
  };
  const category = draft.category.trim();
  const base = existing && existing.kind === draft.kind ? existing : undefined;
  switch (draft.kind) {
    case 'person': {
      const person = {
        role: draft.role.trim(),
        species: draft.species.trim(),
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
      const place = { parentId: draft.parentId, category };
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
      const item = { holderId: draft.holderId, category };
      return base?.kind === 'item'
        ? { ...base, ...common, item: { ...base.item, ...item } }
        : createEntity({ kind: 'item', ...common, item });
    }
    case 'topic': {
      const topic = { category };
      return base?.kind === 'topic'
        ? { ...base, ...common, topic: { ...base.topic, ...topic } }
        : createEntity({ kind: 'topic', ...common, topic });
    }
  }
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
