/**
 * „Was hängt noch offen“: Dinge, die die Gruppe angestoßen und nie zu Ende gebracht hat – aus der
 * Chronik abgeleitet, nie gespeichert. Offen ist nach der Art des Eintrags:
 *
 * - eine Abmachung oder ein Auftrag, solange sie nicht abgehakt ist;
 * - ein Gerücht, solange niemand gesagt hat, ob es stimmt;
 * - ein Wunsch eines Spielers, solange er noch das Ziel des Gefährten ist (oder kein Ziel wurde);
 * - ein entdeckter Ort, an dem die Gruppe nie war;
 * - eine Entscheidung, die einen Ort nennt, an dem die Gruppe seitdem nie angekommen ist;
 * - alles, was der Spielleiter angeheftet hat (`entry.loose = 'open'`).
 *
 * Was der Spielleiter erledigt hat (`loose = 'settled'`), fällt heraus. Wayfarer erfindet dabei
 * nichts: Jeder Punkt ist ein Eintrag der Chronik, so wie er geschrieben wurde.
 */
import { byTime, placeAncestors, placeCast } from './derive';
import type { CampaignData, ChronicleEntry } from './schema';
import { dayIndexOf } from './time/calendar';

export type LooseReason = 'pinned' | 'promise' | 'decision' | 'discovery' | 'rumor' | 'wish';

/** Reihenfolge und Überschrift der Gruppen. */
export const LOOSE_REASONS: readonly LooseReason[] = [
  'pinned',
  'promise',
  'decision',
  'discovery',
  'rumor',
  'wish',
];

export const LOOSE_REASON_LABEL: Record<LooseReason, string> = {
  pinned: 'Von dir angeheftet',
  promise: 'Abmachungen und Aufträge',
  decision: 'Vorgenommen, nie angekommen',
  discovery: 'Entdeckt, nie hingegangen',
  rumor: 'Gerüchte, nie geprüft',
  wish: 'Wünsche der Spieler',
};

/** Kurz, für eine Zeile am Spieltisch. */
export const LOOSE_REASON_SHORT: Record<LooseReason, string> = {
  pinned: 'angeheftet',
  promise: 'Abmachung',
  decision: 'vorgenommen',
  discovery: 'entdeckt',
  rumor: 'Gerücht',
  wish: 'Wunsch',
};

export interface LooseEnd {
  entry: ChronicleEntry;
  reason: LooseReason;
  /** Die Orte, um die es geht. */
  placeIds: string[];
  /** Wie viele Spielabende seitdem begonnen haben. */
  sessionsSince: number;
  /** Tage seitdem (Weltzeit). */
  daysSince: number;
  /** Es geht um den Ort der Gruppe (oder einen darin) oder um jemanden, der gerade hier ist. */
  here: boolean;
}

const isPlace = (data: CampaignData, id: string) => data.entities[id]?.kind === 'place';

/** Der Ort und alle Orte darüber. */
function chainOf(data: CampaignData, placeId: string | null): string[] {
  if (!placeId) return [];
  return [placeId, ...placeAncestors(data, placeId).map((place) => place.id)];
}

/** Die Ortswechsel der Gruppe in der Reihenfolge der Chronik (auch innerhalb einer Minute). */
const travelsOf = (data: CampaignData) =>
  Object.values(data.chronicle)
    .filter((entry) => entry.kind === 'travel' && entry.travel)
    .sort(byTime);

/**
 * Wo die Gruppe stand, als der Eintrag geschrieben wurde: das Ziel des letzten Ortswechsels davor –
 * ein Ortswechsel in derselben Minute zählt nur, wenn er vorher angelegt wurde.
 */
export function placeAtEntry(data: CampaignData, entry: ChronicleEntry): string | null {
  const travels = travelsOf(data);
  const before = travels.filter((travel) => byTime(travel, entry) < 0);
  const last = before[before.length - 1];
  if (last) return last.travel!.toId;
  const next = travels.find((travel) => byTime(travel, entry) > 0);
  return next ? next.travel!.fromId : data.state.placeId;
}

/**
 * Ob die Gruppe nach dem Eintrag an `placeId` angekommen ist: ein späterer Ortswechsel dorthin
 * (oder in einen Ort darin) – oder sie steht jetzt dort und stand damals noch nicht dort.
 */
export function reachedSince(data: CampaignData, placeId: string, entry: ChronicleEntry): boolean {
  for (const travel of travelsOf(data)) {
    if (byTime(travel, entry) <= 0 || !travel.travel?.toId) continue;
    if (chainOf(data, travel.travel.toId).includes(placeId)) return true;
  }
  return (
    chainOf(data, data.state.placeId).includes(placeId) &&
    !chainOf(data, placeAtEntry(data, entry)).includes(placeId)
  );
}

/** Warum ein Eintrag offen ist – oder null, wenn er es nicht (mehr) ist. */
export function looseReason(data: CampaignData, entry: ChronicleEntry): LooseReason | null {
  if (entry.loose === 'settled' || entry.at > data.state.now) return null;
  switch (entry.kind) {
    case 'promise':
      // Abmachungen haben ihren eigenen Stand; angeheftet zu sein ändert daran nichts.
      return entry.promise && !entry.promise.done ? 'promise' : null;
    case 'rumor':
      if (entry.loose === 'open') return 'pinned';
      return (entry.rumor?.truth ?? 'unchecked') === 'unchecked' ? 'rumor' : null;
    case 'wish': {
      if (entry.loose === 'open') return 'pinned';
      const character = entry.refs[0] ? data.entities[entry.refs[0]] : undefined;
      // Wurde der Wunsch zum Ziel und das Ziel ist inzwischen ein anderes, ist er vorbei.
      if (entry.wish?.setGoal && character?.kind === 'character')
        return character.character.goal.trim() === entry.text.trim() ? 'wish' : null;
      return 'wish';
    }
    case 'discovery': {
      if (entry.loose === 'open') return 'pinned';
      const placeId = entry.placeId;
      if (!placeId) return null;
      const there = chainOf(data, placeAtEntry(data, entry)).includes(placeId);
      return there || reachedSince(data, placeId, entry) ? null : 'discovery';
    }
    case 'decision': {
      if (entry.loose === 'open') return 'pinned';
      // Orte, an denen die Gruppe damals schon stand, sind kein Ziel („Wir bleiben in Hohenfurt“).
      const there = chainOf(data, placeAtEntry(data, entry));
      const targets = entry.refs.filter(
        (id) => id !== entry.placeId && isPlace(data, id) && !there.includes(id),
      );
      if (!targets.length) return null;
      return targets.some((id) => reachedSince(data, id, entry)) ? null : 'decision';
    }
    default:
      return entry.loose === 'open' ? 'pinned' : null;
  }
}

/**
 * Was `loose` wird, wenn der Spielleiter die Nadel setzt oder löst. Gelöst ist der Eintrag nicht
 * mehr offen – auch wenn er es von selbst wäre (ein ungeprüftes Gerücht): dann gilt er als erledigt.
 */
export function looseAfterPin(
  data: CampaignData,
  entry: ChronicleEntry,
  pin: boolean,
): ChronicleEntry['loose'] {
  if (pin) return 'open';
  return looseReason(data, { ...entry, loose: null }) ? 'settled' : null;
}

/** Die Orte, um die es bei einem offenen Punkt geht. */
function placesOf(data: CampaignData, entry: ChronicleEntry, reason: LooseReason): string[] {
  const refs = entry.refs.filter((id) => isPlace(data, id));
  if (entry.kind === 'discovery') return entry.placeId ? [entry.placeId] : [];
  // Bei Entscheidungen und Gerüchten ist der Ort des Eintrags nur, wo es gesagt wurde.
  if (entry.kind === 'decision' || entry.kind === 'rumor')
    return refs.filter((id) => id !== entry.placeId);
  const all = entry.placeId ? [entry.placeId, ...refs] : refs;
  return reason === 'promise' && !refs.length ? [] : [...new Set(all)];
}

/** Alles, was noch offen ist – das Älteste zuerst. */
export function looseEnds(data: CampaignData): LooseEnd[] {
  const now = data.state.now;
  const here = data.state.placeId;
  const chain = new Set(chainOf(data, here));
  const present = new Set(here ? placeCast(data, here).present.map((person) => person.id) : []);
  const begun = Object.values(data.sessions).filter((session) => session.startAt <= now);
  // Ein neuer Abend beginnt in derselben Minute, in der der alte endete: Gezählt wird deshalb nach
  // der Session des Eintrags, ohne sie nach der Zeit
  // (ein Eintrag zwischen den Abenden zählt den Abend, der in seiner Minute beginnt, nicht mit).
  const sessionsSince = (entry: ChronicleEntry) => {
    const own = entry.sessionId ? data.sessions[entry.sessionId] : undefined;
    return own
      ? begun.filter((session) => session.number > own.number).length
      : begun.filter((session) => session.startAt > entry.at).length;
  };
  const out: LooseEnd[] = [];
  for (const entry of Object.values(data.chronicle)) {
    const reason = looseReason(data, entry);
    if (!reason) continue;
    const placeIds = placesOf(data, entry, reason);
    const isHere =
      here !== null &&
      (placeIds.some((id) => chain.has(id) || chainOf(data, id).includes(here)) ||
        entry.refs.some((id) => present.has(id)));
    out.push({
      entry,
      reason,
      placeIds,
      sessionsSince: sessionsSince(entry),
      daysSince: dayIndexOf(now) - dayIndexOf(entry.at),
      here: isHere,
    });
  }
  return out.sort((a, b) => a.entry.at - b.entry.at);
}

/** Was am Ort der Gruppe offen ist – ohne Abmachungen, die stehen am Spieltisch schon unter „Sonst noch“. */
export function looseEndsHere(data: CampaignData): LooseEnd[] {
  return looseEnds(data).filter((end) => end.here && end.reason !== 'promise');
}

/** „seit 3 Abenden“, „seit diesem Abend“, sonst in Tagen. */
export function sinceText(end: LooseEnd): string {
  if (end.sessionsSince > 1) return `seit ${end.sessionsSince} Abenden`;
  if (end.sessionsSince === 1) return 'seit dem letzten Abend';
  if (end.daysSince <= 0) return 'von heute';
  return end.daysSince === 1 ? 'seit gestern' : `seit ${end.daysSince} Tagen`;
}

/** Offene Punkte nach Gruppen, in der Reihenfolge von `LOOSE_REASONS`; leere fehlen. */
export function looseGroups(ends: LooseEnd[]): { reason: LooseReason; ends: LooseEnd[] }[] {
  return LOOSE_REASONS.map((reason) => ({
    reason,
    ends: ends.filter((end) => end.reason === reason),
  })).filter((group) => group.ends.length > 0);
}
