/**
 * Gedächtnis beim Tippen: Nennt der Spielleiter in der Mitschrift oder beim Festhalten einen Namen
 * der Welt, steht darunter leise das Wichtigste zu ihm – Schicksal, Haltung zur Gruppe, wo er ist,
 * wann die Gruppe zuletzt mit ihm zu tun hatte, offene Abmachungen, sonst sein Satz für den Tisch.
 * Alles stammt aus dem, was eingetragen ist; Wayfarer ergänzt nichts.
 */
import { FATE_LABEL } from './chronicleKinds';
import {
  attitudeToParty,
  chronicleSorted,
  entityName,
  openPromises,
  placeStatus,
  placeSubtreeIds,
} from './derive';
import { entryEntityIds, sessionAt, statusOf } from './history';
import { namesIn } from './recognize';
import { attitudeLabel } from './relations';
import type { CampaignData, ChronicleEntry, EntityKind } from './schema';
import { dayIndexOf, type WorldTime } from './time/calendar';

/** Arten, zu denen das Gedächtnis etwas sagt. */
export const MEMORY_KINDS: readonly EntityKind[] = [
  'person',
  'character',
  'place',
  'faction',
  'item',
];

/** Höchstens so viele Angaben je Name – mehr liest am Tisch niemand. */
export const MEMORY_FACTS = 3;
/** Höchstens so viele Namen gleichzeitig. */
export const MEMORY_NAMES = 2;

/** Was eine Angabe sagt – in der Reihenfolge ihrer Wichtigkeit. */
export type MemoryFactKind = 'fate' | 'attitude' | 'where' | 'seen' | 'promises' | 'tagline';

export interface MemoryFact {
  kind: MemoryFactKind;
  text: string;
}

export interface NameMemoryLine {
  id: string;
  name: string;
  kind: EntityKind;
  facts: MemoryFact[];
}

/** Der Satz für den Tisch wird nach so vielen Zeichen gekürzt. */
const TAGLINE_MAX = 60;

/**
 * Einträge, die nicht heißen, dass die Gruppe mit jemandem zu tun hatte: eingetretene Termine,
 * Veränderungen und Aufenthalte in der Welt, Weltwissen. Ein Gerücht zählt nur für seine Quelle.
 */
const NOT_MET: readonly ChronicleEntry['kind'][] = ['event', 'change', 'whereabouts', 'lore'];

const metIn = (entry: ChronicleEntry, id: string) =>
  !NOT_MET.includes(entry.kind) &&
  (entry.kind !== 'rumor' || entry.rumor?.sourceId === id) &&
  entryEntityIds(entry).includes(id);

/**
 * Wie lange etwas her ist: in Abenden, wenn es zu einer Session gehört („an diesem Abend“, „am
 * vorigen Abend“, „vor 3 Abenden“), sonst in Tagen der Welt.
 */
export function agoText(data: CampaignData, at: WorldTime, sessionId: string | null): string {
  const own = sessionId ? data.sessions[sessionId] : undefined;
  if (own) {
    const now = data.state.now;
    const later = Object.values(data.sessions).filter(
      (session) => session.startAt <= now && session.number > own.number,
    ).length;
    // Läuft keine Session, zählt der kommende Abend: Die letzte gespielte war „der vorige“.
    const evenings = later + (data.state.sessionId ? 0 : 1);
    if (evenings <= 0) return 'an diesem Abend';
    if (evenings === 1) return 'am vorigen Abend';
    return `vor ${evenings} Abenden`;
  }
  const days = dayIndexOf(data.state.now) - dayIndexOf(at);
  if (days <= 0) return 'heute';
  if (days === 1) return 'gestern';
  return `vor ${days} Tagen`;
}

/** Ist ein Ort der der Gruppe oder liegt er darin? */
const isHere = (data: CampaignData, placeId: string | null) =>
  !!placeId && !!data.state.placeId && placeSubtreeIds(data, data.state.placeId).has(placeId);

function fateFact(data: CampaignData, id: string): MemoryFact | null {
  const status = statusOf(data, id);
  return status === 'dead' || status === 'missing'
    ? { kind: 'fate', text: FATE_LABEL[status] }
    : null;
}

function attitudeFact(data: CampaignData, id: string): MemoryFact | null {
  const kind = data.entities[id]?.kind;
  if (kind !== 'person' && kind !== 'faction') return null;
  const value = attitudeToParty(data, id);
  return value === null
    ? null
    : { kind: 'attitude', text: attitudeLabel(value).toLocaleLowerCase('de') };
}

function whereFact(data: CampaignData, id: string, gone: boolean): MemoryFact | null {
  const entity = data.entities[id];
  if (!entity) return null;
  const at = (placeId: string | null, lead: string): MemoryFact | null =>
    placeId && data.entities[placeId]
      ? { kind: 'where', text: `${lead}${entityName(data, placeId)}` }
      : null;
  switch (entity.kind) {
    case 'person': {
      if (gone) return null;
      const placeId = entity.person.placeId;
      if (isHere(data, placeId)) return { kind: 'where', text: 'hier am Ort' };
      return at(placeId, 'jetzt in ');
    }
    case 'character': {
      const placeId = entity.character.placeId;
      if (gone || !placeId || isHere(data, placeId)) return null;
      return at(placeId, 'abseits der Gruppe in ');
    }
    case 'place':
      return at(entity.place.parentId, 'in ');
    case 'faction':
      return at(entity.faction.seatId, 'Sitz in ');
    case 'item': {
      const holderId = entity.item.holderId;
      if (!holderId) return null;
      return { kind: 'where', text: `bei ${entityName(data, holderId)}` };
    }
    default:
      return null;
  }
}

function seenFact(data: CampaignData, id: string): MemoryFact | null {
  const entity = data.entities[id];
  if (!entity || entity.kind === 'character') return null;
  if (entity.kind === 'place') {
    const status = placeStatus(data, id);
    if (status.here) return { kind: 'seen', text: 'die Gruppe ist hier' };
    if (status.lastLeft === null) return null;
    const session = sessionAt(data, status.lastLeft);
    return {
      kind: 'seen',
      text: `zuletzt besucht ${agoText(data, status.lastLeft, session?.id ?? null)}`,
    };
  }
  const now = data.state.now;
  const last = chronicleSorted(data)
    .filter((entry) => entry.at <= now && metIn(entry, id))
    .at(-1);
  if (!last) return null;
  const where =
    last.placeId && last.placeId !== id && data.entities[last.placeId]
      ? ` in ${entityName(data, last.placeId)}`
      : '';
  return { kind: 'seen', text: `zuletzt ${agoText(data, last.at, last.sessionId)}${where}` };
}

function promisesFact(data: CampaignData, id: string): MemoryFact | null {
  const count = openPromises(data, id).length;
  if (!count) return null;
  return {
    kind: 'promises',
    text: count === 1 ? 'eine offene Abmachung' : `${count} offene Abmachungen`,
  };
}

function taglineFact(data: CampaignData, id: string): MemoryFact | null {
  const line = (data.entities[id]?.tagline ?? '').replace(/\s+/g, ' ').trim();
  if (!line) return null;
  return {
    kind: 'tagline',
    text: line.length > TAGLINE_MAX ? `${line.slice(0, TAGLINE_MAX - 1).trimEnd()}…` : line,
  };
}

/**
 * Das Wichtigste zu einem Eintrag, höchstens drei Angaben: Schicksal, Haltung zur Gruppe, wo er
 * ist (bzw. wo der Ort liegt), wann die Gruppe zuletzt mit ihm zu tun hatte, offene Abmachungen,
 * zuletzt sein Satz für den Tisch. Was nicht eingetragen ist, fehlt.
 */
export function memoryOf(data: CampaignData, entityId: string): MemoryFact[] {
  const entity = data.entities[entityId];
  if (!entity || !MEMORY_KINDS.includes(entity.kind)) return [];
  const fate = fateFact(data, entityId);
  const facts = [
    fate,
    attitudeFact(data, entityId),
    whereFact(data, entityId, fate !== null),
    seenFact(data, entityId),
    promisesFact(data, entityId),
    taglineFact(data, entityId),
  ].filter((fact): fact is MemoryFact => fact !== null);
  return facts.slice(0, MEMORY_FACTS);
}

/**
 * Welche Einträge der Welt im Text namentlich vorkommen – nur Personen, Gefährten, Orte,
 * Fraktionen und Gegenstände, jeder einmal, der zuletzt genannte zuerst. Es gelten die Regeln
 * des Erkennens (`namesIn`): ganze Wörter, wie geschrieben; mehrdeutige Namen zählen nicht,
 * außer `refs` macht sie eindeutig.
 */
export function namesInText(
  data: CampaignData,
  text: string,
  refs: readonly string[] = [],
): string[] {
  const ids: string[] = [];
  const hits = namesIn(data, text, refs);
  for (let i = hits.length - 1; i >= 0; i--) {
    const id = hits[i]!.id;
    if (!id || ids.includes(id)) continue;
    const kind = data.entities[id]?.kind;
    if (kind && MEMORY_KINDS.includes(kind)) ids.push(id);
  }
  return ids;
}

/**
 * Die Zeilen unter dem Feld: je genanntem Namen seine Angaben – höchstens zwei Namen, der zuletzt
 * genannte zuerst. Ein Name, zu dem nichts eingetragen ist, bekommt keine Zeile.
 */
export function nameMemory(
  data: CampaignData,
  text: string,
  refs: readonly string[] = [],
  limit = MEMORY_NAMES,
): NameMemoryLine[] {
  const lines: NameMemoryLine[] = [];
  for (const id of namesInText(data, text, refs)) {
    if (lines.length >= limit) break;
    const facts = memoryOf(data, id);
    const entity = data.entities[id]!;
    if (facts.length) lines.push({ id, name: entity.name, kind: entity.kind, facts });
  }
  return lines;
}
