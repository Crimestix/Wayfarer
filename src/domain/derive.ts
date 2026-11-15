/**
 * Abgeleitete Sichten auf den Spielstand – reine Funktionen ohne Seiteneffekte.
 * Hier steckt der Kern von Wayfarer: Ort, Personen, Besuche und Veränderungen hängen zusammen.
 */
import {
  MINUTES_PER_DAY,
  dayIndexOf,
  fromTime,
  monthLength,
  startOfDay,
  toTime,
  type CalendarDef,
  type WorldTime,
} from './time/calendar';
import {
  PARTY_ID,
  type CalendarEvent,
  type CampaignData,
  type Character,
  type ChronicleEntry,
  type Entity,
  type EntityKind,
  type EntityOf,
  type Faction,
  type Person,
  type Place,
  type Relation,
  type Timer,
} from './schema';
import { bookLinks, bookWithout } from './bookLinks';
import { recipeLinks, recipeWithout } from './crafting';

// ── Einträge ───────────────────────────────────────────────────────────────

export const KIND_LABEL: Record<EntityKind, string> = {
  person: 'Person',
  place: 'Ort',
  faction: 'Fraktion',
  character: 'Gefährte',
  item: 'Gegenstand',
  topic: 'Thema',
  family: 'Familie',
  species: 'Spezies',
  language: 'Sprache',
  script: 'Schrift',
  ability: 'Fähigkeit',
  plant: 'Pflanze',
  animal: 'Tier',
  mineral: 'Gestein',
  profession: 'Beruf',
};

export const KIND_LABEL_PLURAL: Record<EntityKind, string> = {
  person: 'Personen',
  place: 'Orte',
  faction: 'Fraktionen',
  character: 'Gefährten',
  item: 'Gegenstände',
  topic: 'Themen',
  family: 'Familien',
  species: 'Spezies',
  language: 'Sprachen',
  script: 'Schriften',
  ability: 'Fähigkeiten',
  plant: 'Pflanzen',
  animal: 'Tiere',
  mineral: 'Gesteine',
  profession: 'Berufe',
};

/**
 * Einzelangaben, die auf einen anderen Eintrag verweisen – je Art. Grundlage für Löschen,
 * Aufräumen und „wird noch verwendet“. Der Elternort eines Ortes steht mit drin; beim Löschen
 * rückt ein Ort aber eine Ebene nach oben, statt den Verweis zu verlieren. Eine Angabe kann auch
 * eine Liste sein (die Gegenden einer Pflanze): Dann zählt jeder Verweis darin.
 */
export const DETAIL_LINKS = {
  person: ['placeId', 'homeId', 'speciesId', 'workplaceId'],
  place: ['parentId'],
  faction: ['seatId'],
  character: ['placeId'],
  item: ['holderId'],
  family: ['seatId'],
  language: ['scriptId'],
  plant: ['regionIds'],
  animal: ['regionIds'],
  mineral: ['regionIds'],
} as const satisfies Partial<Record<EntityKind, readonly string[]>>;

type LinkKind = keyof typeof DETAIL_LINKS;
const hasLinks = (kind: EntityKind): kind is LinkKind => kind in DETAIL_LINKS;
type DetailValue = string | null | readonly string[] | undefined;

/** Die Einzelangaben eines Eintrags als Liste von Feld und Ziel; leere Angaben fehlen. */
export function detailLinks(entity: Entity): { field: string; id: string }[] {
  if (!hasLinks(entity.kind)) return [];
  // Das Rezept eines Gegenstands zeigt auf seinen Beruf und seine Zutaten.
  const recipe = entity.kind === 'item' ? recipeLinks(entity.item.recipe) : [];
  // Ein Buch zeigt auf seinen Verfasser, seine Gegenden und einzeln gewählte Einträge.
  const book = entity.kind === 'item' ? bookLinks(entity.item.book) : [];
  const details = (entity as unknown as Record<string, Record<string, DetailValue>>)[entity.kind]!;
  const links: { field: string; id: string }[] = [];
  for (const field of DETAIL_LINKS[entity.kind]) {
    const value = details[field];
    if (Array.isArray(value)) for (const id of value as string[]) links.push({ field, id });
    else if (typeof value === 'string' && value) links.push({ field, id: value });
  }
  return [...links, ...recipe, ...book];
}

/** Verweist eine Einzelangabe dieses Eintrags auf `targetId`? */
export const linksTo = (entity: Entity, targetId: string): boolean =>
  detailLinks(entity).some((link) => link.id === targetId);

/**
 * Der Eintrag mit allen Einzelangaben, die auf `targetId` zeigen, ersetzt durch `replacement`. In
 * einer Liste fällt der Verweis ohne Ersatz heraus.
 */
export function replaceLink(
  entity: Entity,
  targetId: string,
  replacement: string | null,
  /** Der Name des Ziels – eine Zutat im Rezept behält ihn. */
  targetName = '',
): Entity {
  if (!linksTo(entity, targetId)) return entity;
  const kind = entity.kind as LinkKind;
  const details = { ...(entity as unknown as Record<string, Record<string, unknown>>)[kind] };
  for (const field of DETAIL_LINKS[kind]) {
    const value = details[field];
    if (Array.isArray(value))
      details[field] = [
        ...new Set(
          (value as string[]).flatMap((id) =>
            id !== targetId ? [id] : replacement ? [replacement] : [],
          ),
        ),
      ];
    else if (value === targetId) details[field] = replacement;
  }
  // Im Rezept fällt der Verweis weg; eine Zutat bleibt mit ihrem Namen stehen.
  if (entity.kind === 'item' && entity.item.recipe)
    details.recipe = recipeWithout(entity.item.recipe, targetId, targetName);
  if (entity.kind === 'item' && entity.item.book)
    details.book = bookWithout(entity.item.book, targetId, targetName);
  return { ...entity, [kind]: details } as Entity;
}

const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });
export const byName = (a: { name: string }, b: { name: string }) =>
  collator.compare(a.name, b.name);

/** Das freie Feld „Art“ eines Eintrags; Personen und Gefährten haben keines. */
export function entityCategory(entity: Entity): string {
  if (entity.kind === 'person' || entity.kind === 'character') return '';
  const details = (entity as unknown as Record<string, { category?: string }>)[entity.kind];
  return details?.category ?? '';
}

export function entitiesOfKind<K extends EntityKind>(data: CampaignData, kind: K): EntityOf<K>[] {
  return (Object.values(data.entities).filter((e) => e.kind === kind) as EntityOf<K>[]).sort(
    byName,
  );
}

export function entityName(data: CampaignData, id: string | null | undefined): string {
  if (!id) return '';
  if (id === PARTY_ID) return 'Die Gruppe';
  return data.entities[id]?.name ?? 'Unbekannt';
}

/** Vereinheitlicht Text für die Suche: Kleinbuchstaben, ohne Akzente. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** Sucht in Name, Beinamen, Kurzbeschreibung und Schlagworten. Beste Treffer zuerst. */
export function searchEntities(
  data: CampaignData,
  query: string,
  options: { kinds?: EntityKind[]; limit?: number } = {},
): Entity[] {
  const q = normalize(query);
  const scored: { entity: Entity; score: number }[] = [];
  for (const entity of Object.values(data.entities)) {
    if (options.kinds && !options.kinds.includes(entity.kind)) continue;
    if (!q) {
      scored.push({ entity, score: 5 });
      continue;
    }
    const name = normalize(entity.name);
    let score = name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : 9;
    // Zweite Namen (Decknamen, wahre Namen): genau getroffen zählt fast wie der Name selbst.
    for (const alias of entity.aliases) {
      const a = normalize(alias);
      const points = a === q ? 1 : a.startsWith(q) ? 2 : a.includes(q) ? 3 : 9;
      score = Math.min(score, points);
    }
    if (score === 9 && entity.tags.some((t) => normalize(t).includes(q))) score = 4;
    if (score === 9 && normalize(entity.tagline).includes(q)) score = 5;
    if (score < 9) scored.push({ entity, score });
  }
  scored.sort((a, b) => a.score - b.score || byName(a.entity, b.entity));
  return scored.slice(0, options.limit ?? 50).map((s) => s.entity);
}

// ── Orte ───────────────────────────────────────────────────────────────────

/** Übergeordnete Orte, vom direkten Elternort bis zur Wurzel. Bricht bei Zyklen ab. */
export function placeAncestors(data: CampaignData, placeId: string): Place[] {
  const out: Place[] = [];
  const seen = new Set([placeId]);
  let current = data.entities[placeId];
  while (current?.kind === 'place' && current.place.parentId) {
    const parent = data.entities[current.place.parentId];
    if (!parent || parent.kind !== 'place' || seen.has(parent.id)) break;
    out.push(parent);
    seen.add(parent.id);
    current = parent;
  }
  return out;
}

export function placeChildren(data: CampaignData, placeId: string | null): Place[] {
  return entitiesOfKind(data, 'place').filter((p) => p.place.parentId === placeId);
}

/** Der Ort selbst und alle Orte darunter. */
export function placeSubtreeIds(data: CampaignData, placeId: string): Set<string> {
  const ids = new Set([placeId]);
  const places = entitiesOfKind(data, 'place');
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of places) {
      if (p.place.parentId && ids.has(p.place.parentId) && !ids.has(p.id)) {
        ids.add(p.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** „Ostmark › Dornhafen › Zum Grauen Fang“ */
export function placePath(data: CampaignData, placeId: string): string {
  const self = data.entities[placeId];
  if (!self) return '';
  return [...placeAncestors(data, placeId).reverse(), self].map((p) => p.name).join(' › ');
}

/** Wäre `parentId` als Elternort von `placeId` ein Zyklus? */
export function wouldCreatePlaceCycle(
  data: CampaignData,
  placeId: string,
  parentId: string,
): boolean {
  return parentId === placeId || placeSubtreeIds(data, placeId).has(parentId);
}

export interface PlaceCast {
  /** Personen, die sich hier (oder in einem Ort darunter) aufhalten. */
  present: Person[];
  /** Personen, die hier zu Hause sind, aber gerade woanders. */
  away: Person[];
  /** Tote und Verschollene, die zuletzt hier waren oder hier zu Hause sind – anwesend ist keiner. */
  lost: Person[];
  /** Fraktionen mit Sitz hier. */
  factions: Faction[];
  /** Alles Weitere, das über eine Beziehung mit dem Ort verbunden ist. */
  linked: { entity: Entity; relation: Relation; perspective: 'from' | 'to' }[];
  /** Gefährten, die abseits der Gruppe hier sind. */
  characters: Character[];
}

/** Wer spielt an diesem Ort eine Rolle? */
export function placeCast(data: CampaignData, placeId: string): PlaceCast {
  const ids = placeSubtreeIds(data, placeId);
  const persons = entitiesOfKind(data, 'person');
  const here = (id: string | null) => id !== null && ids.has(id);
  // Wer tot oder verschollen ist, hält sich nirgends auf – auch wenn sein letzter Ort noch dasteht.
  // Ein ungewisses Schicksal ist noch keins: Der steht weiter da, mit seinem Vermerk.
  const gone = (p: Person) => p.person.status === 'dead' || p.person.status === 'missing';
  const alive = persons.filter((p) => !gone(p));
  const present = alive.filter((p) => here(p.person.placeId));
  const presentIds = new Set(present.map((p) => p.id));
  const away = alive.filter((p) => !presentIds.has(p.id) && here(p.person.homeId));
  const lost = persons.filter((p) => gone(p) && (here(p.person.placeId) || here(p.person.homeId)));
  const factions = entitiesOfKind(data, 'faction').filter(
    (f) => f.faction.seatId && ids.has(f.faction.seatId),
  );
  const known = new Set([
    ...presentIds,
    ...[...away, ...lost, ...factions].map((entity) => entity.id),
  ]);
  const linked: PlaceCast['linked'] = [];
  for (const relation of Object.values(data.relations)) {
    if (relation.ended) continue;
    const otherId =
      relation.to === placeId ? relation.from : relation.from === placeId ? relation.to : null;
    if (!otherId || known.has(otherId)) continue;
    const entity = data.entities[otherId];
    if (!entity || entity.kind === 'place') continue;
    linked.push({ entity, relation, perspective: relation.from === placeId ? 'from' : 'to' });
  }
  linked.sort((a, b) => byName(a.entity, b.entity));
  const characters = entitiesOfKind(data, 'character').filter(
    (c) => c.character.placeId && ids.has(c.character.placeId),
  );
  return { present, away, lost, factions, linked, characters };
}

// ── Chronik ────────────────────────────────────────────────────────────────

/** Wie eine Abmachung steht: offen, eingelöst oder gescheitert. */
export type PromiseOutcome = 'open' | 'kept' | 'failed';

export const PROMISE_OUTCOME_LABEL: Record<PromiseOutcome, string> = {
  open: 'Offen',
  kept: 'Erledigt',
  failed: 'Gescheitert',
};

export function promiseOutcome(
  promise: { done: boolean; failed?: boolean } | null | undefined,
): PromiseOutcome {
  return !promise?.done ? 'open' : promise.failed ? 'failed' : 'kept';
}

/** Älteste zuerst; bei gleicher Weltzeit in der Reihenfolge des Anlegens. */
export const byTime = (a: ChronicleEntry, b: ChronicleEntry) =>
  a.at - b.at || a.created.localeCompare(b.created) || a.id.localeCompare(b.id);

export function chronicleSorted(data: CampaignData): ChronicleEntry[] {
  return Object.values(data.chronicle).sort(byTime);
}

/** Einträge, die einen Datenbankeintrag betreffen (bei Orten auch alles, was dort geschah). */
export function chronicleFor(data: CampaignData, entityId: string): ChronicleEntry[] {
  const entity = data.entities[entityId];
  const placeIds = entity?.kind === 'place' ? placeSubtreeIds(data, entityId) : null;
  return chronicleSorted(data).filter(
    (entry) =>
      entry.refs.includes(entityId) ||
      (placeIds !== null &&
        ((entry.placeId !== null && placeIds.has(entry.placeId)) ||
          entry.refs.some((ref) => placeIds.has(ref)))),
  );
}

export interface Stay {
  placeId: string;
  from: WorldTime;
  /** null = die Gruppe ist noch dort. */
  to: WorldTime | null;
}

/** Aufenthalte der Gruppe, abgeleitet aus den Ortswechseln der Chronik. Älteste zuerst. */
export function partyStays(data: CampaignData): Stay[] {
  const stays: Stay[] = [];
  for (const entry of chronicleSorted(data)) {
    if (entry.kind !== 'travel' || !entry.travel) continue;
    const last = stays[stays.length - 1];
    if (last && last.to === null) last.to = entry.at;
    if (entry.travel.toId) stays.push({ placeId: entry.travel.toId, from: entry.at, to: null });
  }
  return stays;
}

/** Besuche eines Ortes; Aufenthalte in Orten darunter zählen mit und werden zusammengelegt. */
export function visitsTo(data: CampaignData, placeId: string): Stay[] {
  const ids = placeSubtreeIds(data, placeId);
  const visits: Stay[] = [];
  for (const stay of partyStays(data)) {
    if (!ids.has(stay.placeId)) continue;
    const last = visits[visits.length - 1];
    if (last && last.to === stay.from) last.to = stay.to;
    else visits.push({ placeId, from: stay.from, to: stay.to });
  }
  return visits;
}

/**
 * Arten der Chronik, die nur die Gruppe selbst betreffen: Sie sind kein Geschehen in der Welt und
 * zählen nicht zu dem, was sich an einem Ort verändert hat, während die Gruppe fort war.
 */
export const PARTY_KINDS: readonly ChronicleEntry['kind'][] = [
  'travel',
  'rest',
  'quote',
  'decision',
  'milestone',
  'wish',
  'downtime',
  'transformation',
  'trade',
];

export interface PlaceStatus {
  visits: Stay[];
  /** Ist die Gruppe gerade hier? */
  here: boolean;
  /** Der laufende Aufenthalt, falls die Gruppe hier ist. */
  current: Stay | null;
  /** Ende des letzten abgeschlossenen Besuchs. */
  lastLeft: WorldTime | null;
  /**
   * Was hier oder mit den Leuten von hier geschah, während die Gruppe fort war:
   * seit dem letzten Abschied bis jetzt bzw. bis zur Rückkehr.
   */
  changesSince: ChronicleEntry[];
}

/** Wann war die Gruppe hier, und was hat sich seitdem verändert? */
export function placeStatus(data: CampaignData, placeId: string): PlaceStatus {
  const visits = visitsTo(data, placeId);
  const current = visits.find((v) => v.to === null) ?? null;
  const finished = visits.filter((v) => v.to !== null);
  const lastLeft = finished.length ? finished[finished.length - 1]!.to : null;
  let changesSince: ChronicleEntry[] = [];
  if (lastLeft !== null) {
    const until = current ? current.from : Number.MAX_SAFE_INTEGER;
    const cast = placeCast(data, placeId);
    const related = new Set([
      ...placeSubtreeIds(data, placeId),
      ...cast.present.map((p) => p.id),
      ...cast.away.map((p) => p.id),
      ...cast.lost.map((p) => p.id),
      ...cast.factions.map((f) => f.id),
    ]);
    changesSince = chronicleSorted(data).filter(
      (entry) =>
        entry.at > lastLeft &&
        entry.at < until &&
        !PARTY_KINDS.includes(entry.kind) &&
        ((entry.placeId !== null && related.has(entry.placeId)) ||
          entry.refs.some((ref) => related.has(ref))),
    );
  }
  return { visits, here: current !== null, current, lastLeft, changesSince };
}

/** Offene Abmachungen und Verpflichtungen, früheste Frist zuerst. */
export function openPromises(data: CampaignData, entityId?: string): ChronicleEntry[] {
  return Object.values(data.chronicle)
    .filter(
      (e) =>
        e.kind === 'promise' &&
        e.promise &&
        !e.promise.done &&
        (!entityId || e.refs.includes(entityId)),
    )
    .sort(
      (a, b) =>
        (a.promise!.due ?? Number.MAX_SAFE_INTEGER) - (b.promise!.due ?? Number.MAX_SAFE_INTEGER) ||
        byTime(a, b),
    );
}

// ── Beziehungen ────────────────────────────────────────────────────────────

export function findRelation(data: CampaignData, from: string, to: string): Relation | undefined {
  return Object.values(data.relations).find((r) => r.from === from && r.to === to);
}

export interface RelationPair {
  /** ID des Gegenübers (Entity-ID oder PARTY_ID). */
  otherId: string;
  /** Beziehung von diesem Eintrag zum Gegenüber. */
  outgoing: Relation | null;
  /** Beziehung vom Gegenüber zu diesem Eintrag. */
  incoming: Relation | null;
}

/** Alle Beziehungen eines Eintrags, je Gegenüber zusammengefasst. */
export function relationPairs(data: CampaignData, entityId: string): RelationPair[] {
  const pairs = new Map<string, RelationPair>();
  const pair = (otherId: string) => {
    let p = pairs.get(otherId);
    if (!p) pairs.set(otherId, (p = { otherId, outgoing: null, incoming: null }));
    return p;
  };
  for (const relation of Object.values(data.relations)) {
    if (relation.from === entityId) pair(relation.to).outgoing = relation;
    else if (relation.to === entityId) pair(relation.from).incoming = relation;
  }
  return [...pairs.values()].sort((a, b) => {
    if (a.otherId === PARTY_ID) return -1;
    if (b.otherId === PARTY_ID) return 1;
    return collator.compare(entityName(data, a.otherId), entityName(data, b.otherId));
  });
}

/** Haltung eines Eintrags gegenüber der Gruppe; null = unbekannt. */
export function attitudeToParty(data: CampaignData, entityId: string): number | null {
  return findRelation(data, entityId, PARTY_ID)?.attitude ?? null;
}

/** Eine Haltung zu einem einzelnen Gefährten, die von der zur Gruppe abweicht. */
export interface MateAttitude {
  id: string;
  name: string;
  value: number;
}

/**
 * Die Haltungen von `fromId` zu einzelnen aktiven Gefährten, die von seiner Haltung zur Gruppe
 * abweichen („mag Neil nicht, ist aber in Tomlin verliebt“) – nach dem Namen. Gleiche Haltungen
 * stehen nicht da: Sie sagen nichts über die zur Gruppe hinaus.
 */
export function mateAttitudes(data: CampaignData, fromId: string): MateAttitude[] {
  const toParty = attitudeToParty(data, fromId);
  return activeParty(data)
    .filter((mate) => mate.id !== fromId)
    .flatMap((mate) => {
      const value = findRelation(data, fromId, mate.id)?.attitude ?? null;
      return value === null || value === toParty ? [] : [{ id: mate.id, name: mate.name, value }];
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Eine Stufe der Haltung als Zahl mit Vorzeichen: „+5“, „−3“, „±0“. */
export const signedAttitude = (value: number): string =>
  value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '±0';

/** Abweichende Haltungen knapp in einer Zeile: „Tomlin +5 · Neil −3“; leer, wenn keine. */
export const mateAttitudeText = (mates: readonly MateAttitude[]): string =>
  mates.map((mate) => `${mate.name} ${signedAttitude(mate.value)}`).join(' · ');

/** Verlauf der Haltung von `fromId` gegenüber `toId`, älteste zuerst. */
export function attitudeHistory(
  data: CampaignData,
  fromId: string,
  toId: string,
): ChronicleEntry[] {
  return chronicleSorted(data).filter(
    (e) => e.kind === 'attitude' && e.attitude?.fromId === fromId && e.attitude.toId === toId,
  );
}

// ── Gruppe ─────────────────────────────────────────────────────────────────

/**
 * Die aktiven Gefährten, die gerade da sind. Wer mit einem anderen einen Körper teilt und gerade
 * ruht (`character.resting`, `domain/body.ts`), zählt nicht – der andere hat die Kontrolle.
 */
export function activeParty(data: CampaignData): Character[] {
  return entitiesOfKind(data, 'character').filter(
    (c) => c.character.active && !(c.character.resting && c.character.bodyWith),
  );
}

/**
 * Wo ein Gefährte gerade ist: bei getrennter Gruppe der Ort seiner Teilgruppe (`domain/party.ts`),
 * sonst sein eigener Aufenthaltsort oder der der Gruppe.
 */
export function characterPlaceId(data: CampaignData, character: Character): string | null {
  const group = data.state.groups.find((g) => g.memberIds.includes(character.id));
  if (group) return group.id === data.state.leadId ? data.state.placeId : group.placeId;
  return character.character.placeId ?? data.state.placeId;
}

// ── Termine ────────────────────────────────────────────────────────────────

export interface Occurrence {
  event: CalendarEvent;
  /** Zeitpunkt dieses Eintretens (bei offener Uhrzeit: Tagesbeginn). */
  at: WorldTime;
}

function addRepeat(cal: CalendarDef, time: WorldTime, every: number, unit: string): WorldTime {
  if (unit === 'day') return time + every * MINUTES_PER_DAY;
  if (unit === 'week') return time + every * cal.weekdays.length * MINUTES_PER_DAY;
  const d = fromTime(cal, time);
  const months = unit === 'year' ? every * cal.months.length : every;
  const total = (d.year - 1) * cal.months.length + d.month + months;
  const year = Math.floor(total / cal.months.length) + 1;
  const month = total % cal.months.length;
  const day = Math.min(d.day, monthLength(cal, year, month));
  return toTime(cal, { year, month, day, hour: d.hour, minute: d.minute });
}

/** Alle Vorkommen eines Termins im Zeitraum [from, to]. */
export function occurrencesOf(
  cal: CalendarDef,
  event: CalendarEvent,
  from: WorldTime,
  to: WorldTime,
): Occurrence[] {
  const base = event.timed ? event.at : startOfDay(event.at);
  if (!event.repeat) return base >= from && base <= to ? [{ event, at: base }] : [];
  const out: Occurrence[] = [];
  const { every, unit } = event.repeat;
  const skipped = new Set(event.skip);
  // Bei Tages- und Wochenrhythmus direkt in die Nähe des Zeitraums springen.
  const stepMinutes =
    unit === 'day'
      ? every * MINUTES_PER_DAY
      : unit === 'week'
        ? every * cal.weekdays.length * MINUTES_PER_DAY
        : 0;
  let step = stepMinutes && from > base ? Math.floor((from - base) / stepMinutes) : 0;
  // Monats- und Jahresschritte rechnen immer vom Ursprungstermin, damit der 31. nicht verrutscht.
  for (let guard = 0; guard < 5000; guard++, step++) {
    const at = step === 0 ? base : addRepeat(cal, base, every * step, unit);
    if (at > to) break;
    // Einzelne Male können ausfallen, ohne dass die Reihe endet.
    if (at >= from && !skipped.has(dayIndexOf(at))) out.push({ event, at });
  }
  return out;
}

/** Vorkommen aller Termine im Zeitraum [from, to], früheste zuerst. */
export function occurrencesBetween(
  data: CampaignData,
  from: WorldTime,
  to: WorldTime,
): Occurrence[] {
  const cal = data.campaign.calendar;
  return Object.values(data.events)
    .flatMap((event) => occurrencesOf(cal, event, from, to))
    .sort((a, b) => a.at - b.at || a.event.title.localeCompare(b.event.title));
}

/** Kommende Termine ab jetzt (heutige Termine mit offener Uhrzeit zählen mit). */
export function upcomingOccurrences(data: CampaignData, days: number, limit = 20): Occurrence[] {
  const from = startOfDay(data.state.now);
  const to = from + days * MINUTES_PER_DAY;
  return occurrencesBetween(data, from, to)
    .filter(
      (o) => (o.event.timed ? o.at >= data.state.now : true) && !(o.event.done && !o.event.repeat),
    )
    .slice(0, limit);
}

/** Überfällige Vorhaben und Fristen: Zeitpunkt vorbei, aber nicht abgehakt. */
export function overdueEvents(data: CampaignData): CalendarEvent[] {
  const today = dayIndexOf(data.state.now);
  return Object.values(data.events)
    .filter(
      (e) =>
        !e.done &&
        !e.repeat &&
        e.kind !== 'world' &&
        (e.timed ? e.at < data.state.now : dayIndexOf(e.at) < today),
    )
    .sort((a, b) => a.at - b.at);
}

// ── Timer ──────────────────────────────────────────────────────────────────

export const TIMER_KIND_LABEL: Record<Timer['kind'], string> = {
  effect: 'Wirkung',
  task: 'Tätigkeit',
  spell: 'Zauber',
  light: 'Licht',
};

export function runningTimers(data: CampaignData): Timer[] {
  return Object.values(data.timers)
    .filter((t) => !t.done && t.end > data.state.now)
    .sort((a, b) => a.end - b.end);
}

// ── Sessions ───────────────────────────────────────────────────────────────

export function sessionsSorted(data: CampaignData) {
  return Object.values(data.sessions).sort((a, b) => a.number - b.number);
}

export function currentSession(data: CampaignData) {
  return data.state.sessionId ? (data.sessions[data.state.sessionId] ?? null) : null;
}
