/**
 * Bastionen nach den Regeln von 2024: Alle `turnDays` Tage ist ein Bastionszug fällig. Wayfarer
 * schlägt ihn vor (die Befehle vom letzten Mal), würfelt auf der Ereignistabelle des Spielleiters
 * und führt Buch – ausgeführt wird er nie von selbst. Reine Funktionen.
 */
import type {
  Bastion,
  BastionFacility,
  BastionOrder,
  CampaignData,
  Character,
  FacilityState,
} from './schema';
import { MINUTES_PER_DAY, dayIndexOf, type WorldTime } from './time/calendar';

export const ORDER_LABEL: Record<BastionOrder, string> = {
  craft: 'Herstellen',
  empower: 'Stärken',
  harvest: 'Ernten',
  maintain: 'Instandhalten',
  recruit: 'Anwerben',
  research: 'Erforschen',
  trade: 'Handeln',
};

export const STATE_LABEL: Record<FacilityState, string> = {
  ready: 'bereit',
  damaged: 'beschädigt',
  repairing: 'wird repariert',
};

const turnLength = (bastion: Bastion) => bastion.turnDays * MINUTES_PER_DAY;

/** Wann der nächste Zug fällig ist; null, solange es noch keinen gab. */
export function nextTurnAt(bastion: Bastion): WorldTime | null {
  return bastion.lastTurnAt === null ? null : bastion.lastTurnAt + turnLength(bastion);
}

/**
 * Wie viele Züge seit dem letzten fällig sind (bei einer Zwischenzeit auch mehrere). Gezählt wird
 * nach Tagen: Am Tag des nächsten Zugs ist er fällig, gleich zu welcher Stunde.
 */
export function turnsDue(bastion: Bastion, now: WorldTime): number {
  if (bastion.lastTurnAt === null) return 0;
  const days = dayIndexOf(now) - dayIndexOf(bastion.lastTurnAt);
  return Math.max(0, Math.floor(days / bastion.turnDays));
}

/** Tage bis zum nächsten Zug (0 = heute fällig oder überfällig). */
export function daysToNextTurn(bastion: Bastion, now: WorldTime): number | null {
  const next = nextTurnAt(bastion);
  if (next === null) return null;
  return Math.max(0, dayIndexOf(next) - dayIndexOf(now));
}

/** Die Bastionen, deren Zug fällig ist – für den Spieltisch. */
export function bastionsDue(data: Pick<CampaignData, 'bastions' | 'state'>): Bastion[] {
  return Object.values(data.bastions).filter((b) => turnsDue(b, data.state.now) > 0);
}

export interface EventRow {
  min: number;
  max: number;
  text: string;
}

/** Die Ereignistabelle aus Zeilen „1–50: Alles ruhig“, „51-55 Angriff“, „100: Schatz“. */
export function parseEvents(text: string): EventRow[] {
  const rows: EventRow[] = [];
  for (const line of text.split('\n')) {
    const match = /^\s*(\d{1,3})\s*(?:[–—-]\s*(\d{1,3}))?\s*[:.)]?\s+(.+)$/.exec(line);
    if (!match) continue;
    const min = Number(match[1]);
    const max = match[2] ? Number(match[2]) : min;
    rows.push({ min: Math.min(min, max), max: Math.max(min, max), text: match[3]!.trim() });
  }
  return rows;
}

/** Was bei diesem Wurf geschieht; null, wenn die Tabelle dazu nichts sagt. */
export function eventFor(rows: EventRow[], roll: number): EventRow | null {
  return rows.find((row) => roll >= row.min && roll <= row.max) ?? null;
}

/** Besondere Einrichtungen, die einen Befehl bekommen können (bereit, mit Befehlen). */
export const commandable = (facility: BastionFacility) =>
  facility.kind === 'special' && facility.state === 'ready' && facility.orders.length > 0;

export interface TurnChoice {
  facilityId: string;
  order: BastionOrder | null;
  /** Was daraus wird, in Worten des Spielleiters. */
  text: string;
  /** Wie viele Züge der Befehl nach diesem noch braucht (0 = mit diesem Zug fertig). */
  turnsLeft: number;
  /** Das Ergebnis als Beute für den Besitzer bereitlegen. */
  asLoot: boolean;
}

/** Der Vorschlag für den nächsten Zug: der laufende Befehl weiter, sonst der erste mögliche. */
export function proposeTurn(bastion: Bastion): TurnChoice[] {
  return bastion.facilities.filter(commandable).map((facility) => {
    const running = facility.order && facility.order.turnsLeft > 0 ? facility.order : null;
    const last = facility.order?.name ?? null;
    const order =
      running?.name ?? (last && facility.orders.includes(last) ? last : facility.orders[0]!);
    return {
      facilityId: facility.id,
      order,
      text: running?.text ?? (facility.order?.name === order ? facility.order.text : ''),
      turnsLeft: running ? running.turnsLeft - 1 : 0,
      asLoot: false,
    };
  });
}

/** Ein Zug braucht ein Ereignis, wenn eine Einrichtung instand gehalten wird. */
export const needsEvent = (choices: TurnChoice[]) =>
  choices.some((choice) => choice.order === 'maintain');

/** Wie ein Zug in der Chronik steht. */
export function turnLine(bastion: Bastion, choices: TurnChoice[], event: string | null): string {
  const parts = choices
    .filter((choice) => choice.order)
    .map((choice) => {
      const facility = bastion.facilities.find((f) => f.id === choice.facilityId);
      const what = choice.text.trim();
      const left = choice.turnsLeft > 0 ? ` (noch ${choice.turnsLeft})` : what ? ' – fertig' : '';
      return `${facility?.name ?? 'Einrichtung'}: ${ORDER_LABEL[choice.order!]}${what ? ` – ${what}` : ''}${left}`;
    });
  return [`Bastionszug ${bastion.name}`, ...parts, event ? `Ereignis: ${event}` : '']
    .filter(Boolean)
    .join('\n');
}

export interface FacilityGroup {
  owner: Character | null;
  facilities: BastionFacility[];
}

/** Einrichtungen nach Besitzer: erst die Gefährten nach Namen, die der Gruppe zuletzt. */
export function facilityGroups(
  data: Pick<CampaignData, 'entities'>,
  bastion: Bastion,
): FacilityGroup[] {
  const groups = new Map<string, FacilityGroup>();
  for (const facility of bastion.facilities) {
    const owner = facility.ownerId ? data.entities[facility.ownerId] : undefined;
    const character = owner?.kind === 'character' ? owner : null;
    const key = character?.id ?? '';
    const group = groups.get(key) ?? { owner: character, facilities: [] };
    group.facilities.push(facility);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) =>
    !a.owner ? 1 : !b.owner ? -1 : a.owner.name.localeCompare(b.owner.name, 'de'),
  );
}
