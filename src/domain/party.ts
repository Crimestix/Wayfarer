/**
 * Getrennte Wege: Die Gruppe teilt sich – in einer Stadt kauft einer ein, einer sitzt in der
 * Bibliothek, einer kopiert Zauber. Jede Teilgruppe hat ihren Ort und ihre eigene Uhr
 * (`state.groups`); geleitet wird immer eine (`state.leadId`), und für sie gelten `state.placeId`
 * und `state.now` – so rechnen alle Leser für die geleitete Teilgruppe zu ihrer Zeit.
 *
 * Die wichtigste Regel: **Die vorderste Uhr** (`frontOf`) ist die Weltzeit für alles, was von
 * selbst geschieht. Termine, Schritte der Uhren und abgelaufene Lichter treten genau einmal ein,
 * wenn die vorderste Uhr sie erreicht – nie erneut, wenn eine zurückliegende Teilgruppe vorrückt,
 * und nie rückgängig beim Umschalten (`fireFrom`, angewandt in `data/actions.ts`).
 *
 * Reine Funktionen; geschrieben wird über `data/actions.ts` (`splitParty`, `leadGroup`,
 * `catchUp`, `mergeGroups`, `moveParty`) und `features/wege/actions.ts` (`walk` mit `who`).
 */
import { activeParty, chronicleSorted, entityName } from './derive';
import {
  newId,
  type CampaignData,
  type ChronicleEntry,
  type PartyGroup,
  type PlayState,
} from './schema';
import type { WorldTime } from './time/calendar';

/** Eine Teilgruppe, wie sie gerade steht – die geleitete mit Ort und Zeit aus `state`. */
export interface GroupView extends PartyGroup {
  led: boolean;
}

/** Ist die Gruppe getrennt? */
export const isSplit = (data: Pick<CampaignData, 'state'>): boolean => data.state.groups.length > 0;

/**
 * Die Teilgruppen mit dem heutigen Stand der geleiteten (Ort und Zeit aus `state`). Leer, wenn
 * die Gruppe zusammen ist.
 */
export function syncedGroups(state: PlayState): PartyGroup[] {
  return state.groups.map((group) =>
    group.id === state.leadId ? { ...group, placeId: state.placeId, now: state.now } : group,
  );
}

/** Die Teilgruppen zum Anzeigen, die geleitete zuerst. Leer, wenn die Gruppe zusammen ist. */
export function partyGroups(data: Pick<CampaignData, 'state'>): GroupView[] {
  const groups = syncedGroups(data.state).map((group) => ({
    ...group,
    led: group.id === data.state.leadId,
  }));
  return [...groups.filter((g) => g.led), ...groups.filter((g) => !g.led)];
}

/** Die geleitete Teilgruppe; null, wenn die Gruppe zusammen ist. */
export const ledGroup = (data: Pick<CampaignData, 'state'>): GroupView | null =>
  partyGroups(data).find((group) => group.led) ?? null;

/** Wer gerade geleitet wird: die Mitglieder der geleiteten Teilgruppe, sonst alle aktiven. */
export function ledMembers(data: CampaignData): string[] {
  const led = ledGroup(data);
  return led ? [...led.memberIds] : activeParty(data).map((mate) => mate.id);
}

/** Die Teilgruppe, zu der ein Gefährte gehört; null, wenn die Gruppe zusammen ist. */
export const groupOf = (data: Pick<CampaignData, 'state'>, memberId: string): GroupView | null =>
  partyGroups(data).find((group) => group.memberIds.includes(memberId)) ?? null;

/**
 * Die vorderste Uhr: die späteste Zeit aller Teilgruppen – bis dahin ist in der Welt alles
 * eingetreten. Zusammen ist es die Weltzeit (`state.now`). Zugleich: wann alle wieder frei sind.
 */
export function frontOf(data: Pick<CampaignData, 'state'>): WorldTime {
  return Math.max(data.state.now, ...syncedGroups(data.state).map((group) => group.now));
}

/**
 * Ab wann etwas von selbst eintritt, wenn die Teilgruppe `groupId` (Vorgabe: die geleitete) von
 * `from` aus vorrückt: erst hinter der vordersten Uhr der anderen. Zusammen ist es `from`.
 */
export function fireFrom(
  data: Pick<CampaignData, 'state'>,
  from: WorldTime,
  groupId: string | null = data.state.leadId,
): WorldTime {
  const others = syncedGroups(data.state)
    .filter((group) => group.id !== groupId)
    .map((group) => group.now);
  return Math.max(from, ...others);
}

// ── Wer war dabei ──────────────────────────────────────────────────────────

/** Wen ein Eintrag betrifft: bei Ortswechseln `travel.who`, sonst `party`; leer = alle. */
export const whoOf = (entry: ChronicleEntry): string[] =>
  entry.kind === 'travel' ? (entry.travel?.who ?? []) : entry.party;

/** Betreffen zwei Listen dieselben Gefährten? Leer heißt die ganze Gruppe – trifft also immer. */
export const touches = (a: readonly string[], b: readonly string[]): boolean =>
  !a.length || !b.length || a.some((id) => b.includes(id));

/**
 * Wer bei einem neuen Eintrag dabei war: solange die Gruppe getrennt ist, die Mitglieder der
 * geleiteten Teilgruppe – von selbst wie die Session. Nie bei Terminen und Schritten der Uhren
 * (die gehören der Welt), nie über eine schon gesetzte Angabe hinweg.
 */
export function partyStamp(data: CampaignData, entry: ChronicleEntry): string[] {
  if (entry.party.length || !isSplit(data)) return entry.party;
  if (entry.kind === 'event' || entry.clockId) return [];
  if (entry.kind === 'travel' && entry.travel?.who?.length) return [...entry.travel.who];
  return ledMembers(data);
}

/** Wo eine Liste von Gefährten gerade ist: ihre Teilgruppe, sonst der Ort der Gruppe. */
export function placeOfWho(
  data: Pick<CampaignData, 'state'>,
  who: readonly string[],
): string | null {
  if (!who.length || !isSplit(data)) return data.state.placeId;
  return groupOf(data, who[0]!)?.placeId ?? data.state.placeId;
}

/**
 * Der Stand, wenn eine Liste von Gefährten an einen Ort zieht: der Ort der Gruppe (zusammen oder
 * die geleitete Teilgruppe), sonst der Ort ihrer Teilgruppe.
 */
export function withPlace(
  data: Pick<CampaignData, 'state'>,
  who: readonly string[],
  placeId: string | null,
): Partial<PlayState> {
  const group = who.length && isSplit(data) ? groupOf(data, who[0]!) : null;
  if (!group || group.led) return { placeId };
  return {
    groups: data.state.groups.map((g) => (g.id === group.id ? { ...g, placeId } : g)),
  };
}

/**
 * Wo ein Gefährte zur Zeit `at` war – die Kette seiner Ortswechsel: das Ziel des letzten, an dem
 * er beteiligt war; davor der Ausgangsort des nächsten; gibt es keinen, sein heutiger Ort.
 */
export function memberPlaceAt(data: CampaignData, at: WorldTime, memberId: string): string | null {
  const mine = chronicleSorted(data).filter(
    (entry) => entry.kind === 'travel' && entry.travel && touches(whoOf(entry), [memberId]),
  );
  let last: ChronicleEntry | null = null;
  for (const entry of mine) if (entry.at <= at) last = entry;
  if (last) return last.travel!.toId;
  const next = mine.find((entry) => entry.at > at);
  return next ? next.travel!.fromId : placeOfWho(data, [memberId]);
}

// ── Aus Sicht der geleiteten Teilgruppe ────────────────────────────────────

/**
 * Wie eine andere Teilgruppe zur Zeit `at` steht: beschäftigt (unterwegs oder an einer Tätigkeit,
 * „bis 16:20“), schon voraus, zurück (mit „fertig seit …“, wenn ihre Tätigkeit vorbei ist) oder
 * gleichauf.
 */
export type Standing =
  | { kind: 'led' }
  | { kind: 'busy'; until: WorldTime }
  | { kind: 'ahead'; by: number }
  | { kind: 'behind'; by: number; doneSince: WorldTime | null }
  | { kind: 'same'; doneSince: WorldTime | null };

export function groupStanding(group: GroupView, at: WorldTime): Standing {
  if (group.led) return { kind: 'led' };
  const doing = group.doing;
  if (doing && doing.from <= at && at < doing.until) return { kind: 'busy', until: doing.until };
  if (group.now > at) return { kind: 'ahead', by: group.now - at };
  const doneSince = doing && doing.until <= at ? doing.until : null;
  if (group.now < at) return { kind: 'behind', by: at - group.now, doneSince };
  return { kind: 'same', doneSince };
}

/**
 * Was eine Teilgruppe gerade tut, in den Worten des Spielleiters: der Text ihrer Tätigkeit
 * („kopiert Zauber“) oder „unterwegs nach X“. Leer, wenn nichts bekannt ist.
 */
export function doingText(data: CampaignData, group: PartyGroup): string {
  const entry = group.doing?.entryId ? data.chronicle[group.doing.entryId] : undefined;
  if (!entry) return '';
  if (entry.kind === 'travel' && entry.travel?.toId)
    return `unterwegs nach ${entityName(data, entry.travel.toId)}`;
  if (entry.kind === 'downtime') {
    const words = [
      ...new Set((entry.downtime?.activities ?? []).map((a) => a.text.trim()).filter(Boolean)),
    ];
    return words.join(' · ') || entry.text;
  }
  return entry.text;
}

/** Eine Zeile im Überblick „Wer macht was – bis wann“. */
export interface OverviewRow {
  group: GroupView;
  names: string[];
  placeId: string | null;
  /** Die Tätigkeit oder der Weg, in seinen Worten; leer = nichts Bestimmtes. */
  doing: string;
  /** Bis wann sie beschäftigt ist; null = frei. */
  until: WorldTime | null;
  standing: Standing;
}

export interface PartyOverview {
  rows: OverviewRow[];
  /** Wann alle wieder frei sind: die vorderste Uhr. */
  allFree: WorldTime;
}

/**
 * Der Überblick am Spieltisch: je Teilgruppe Mitglieder, Ort, Tätigkeit und Ende – nach dem
 * Ende geordnet, die freien zuerst –, dazu wann alle wieder frei sind.
 */
export function partyOverview(data: CampaignData): PartyOverview {
  const at = data.state.now;
  const rows = partyGroups(data).map((group): OverviewRow => {
    const standing = groupStanding(group, at);
    const until = group.doing && group.doing.until > at ? group.doing.until : null;
    return {
      group,
      names: group.memberIds.map((id) => entityName(data, id)),
      placeId: group.placeId,
      doing: doingText(data, group),
      until,
      standing,
    };
  });
  rows.sort(
    (a, b) => (a.until ?? -1) - (b.until ?? -1) || Number(b.group.led) - Number(a.group.led),
  );
  return { rows, allFree: frontOf(data) };
}

/** Die Einträge der Chronik, die eine Teilgruppe betreffen (für die Marke in der Mitschrift). */
export function entryGroupMark(
  data: CampaignData,
  entry: ChronicleEntry,
): { mine: boolean; names: string[] } {
  const who = whoOf(entry);
  if (!who.length) return { mine: true, names: [] };
  return {
    mine: touches(who, ledMembers(data)),
    names: who.map((id) => entityName(data, id)),
  };
}

// ── Trennen und zusammenführen (rein; geschrieben über `data/actions.ts`) ─────

/**
 * Die Teilgruppen, mit denen ein Handgriff rechnet: die heutigen – oder, ist die Gruppe zusammen,
 * eine einzige mit allen aktiven Gefährten am Ort und zur Zeit der Gruppe (sie wird geleitet).
 */
export function groupsToSplit(data: CampaignData): { groups: PartyGroup[]; leadId: string } {
  if (isSplit(data) && data.state.leadId)
    return { groups: syncedGroups(data.state), leadId: data.state.leadId };
  const all: PartyGroup = {
    id: newId(),
    memberIds: activeParty(data).map((mate) => mate.id),
    placeId: data.state.placeId,
    now: data.state.now,
    doing: null,
  };
  return { groups: [all], leadId: all.id };
}

/** Nimmt Gefährten aus ihren Teilgruppen und stellt sie in eine neue. */
export function detach(groups: readonly PartyGroup[], group: PartyGroup): PartyGroup[] {
  const moving = new Set(group.memberIds);
  return [
    ...groups.map((g) => ({ ...g, memberIds: g.memberIds.filter((id) => !moving.has(id)) })),
    group,
  ];
}

/**
 * Der Stand nach einem Handgriff: leere Teilgruppen fallen weg; bleibt höchstens eine, ist die
 * Gruppe wieder zusammen (ihr Ort und ihre Zeit gelten). Fehlt die geleitete, wird die
 * zurückliegendste geleitet – dort geht das Spiel weiter.
 */
export function settleGroups(
  groups: readonly PartyGroup[],
  leadId: string | null,
  fallback: Pick<PlayState, 'now' | 'placeId'>,
): Pick<PlayState, 'groups' | 'leadId' | 'now' | 'placeId'> {
  const kept = groups.filter((group) => group.memberIds.length > 0);
  if (kept.length <= 1) {
    const only = kept[0];
    return {
      groups: [],
      leadId: null,
      now: only?.now ?? fallback.now,
      placeId: only ? only.placeId : fallback.placeId,
    };
  }
  const lead =
    kept.find((group) => group.id === leadId) ?? [...kept].sort((a, b) => a.now - b.now)[0]!;
  return { groups: kept, leadId: lead.id, now: lead.now, placeId: lead.placeId };
}

/** Gehören genau diese Gefährten zur geleiteten Teilgruppe (bzw. zur ganzen Gruppe)? */
export function isWholeLed(data: CampaignData, who: readonly string[]): boolean {
  if (!who.length) return true;
  const led = ledMembers(data);
  return led.length === who.length && led.every((id) => who.includes(id));
}
