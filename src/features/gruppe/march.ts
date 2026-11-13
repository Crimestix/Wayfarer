/**
 * Marschordnung und was unterwegs zählt: Reihen von vorn nach hinten (`state.march`), wer im
 * Dunkeln sieht, wer ein Licht trägt, wie viel Gold die Gruppe bekommen hat. Reine Funktionen.
 */
import { activeParty } from '../../domain/derive';
import { lootBook } from '../../domain/loot';
import { roundGold } from '../../domain/priceList';
import { tradeTotals } from '../../domain/shop';
import type { CampaignData, Character, Timer } from '../../domain/schema';
import { burningLights } from '../../domain/underground';

/**
 * Die Reihen mit den Gefährten, die gerade dabei sind. Wer nicht (mehr) dabei ist, fällt weg; wer
 * neu dabei ist und noch keinen Platz hat, geht hinten mit. Leere Reihen gibt es nicht.
 */
export function marchRows(data: CampaignData): Character[][] {
  const party = activeParty(data);
  const byId = new Map(party.map((c) => [c.id, c]));
  const placed = new Set<string>();
  const rows: Character[][] = [];
  for (const row of data.state.march ?? []) {
    const members = row
      .map((id) => byId.get(id))
      .filter((c): c is Character => !!c && !placed.has(c.id));
    members.forEach((c) => placed.add(c.id));
    if (members.length) rows.push(members);
  }
  const rest = party
    .filter((c) => !placed.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  if (rest.length) {
    // Ohne gespeicherte Ordnung gehen alle zu zweit nebeneinander, in der Reihenfolge der Namen.
    if (!rows.length) for (let i = 0; i < rest.length; i += 2) rows.push(rest.slice(i, i + 2));
    else rows.push(rest);
  }
  return rows;
}

/** Ids der Reihen, wie sie gespeichert werden. */
export const marchIds = (rows: Character[][]) => rows.map((row) => row.map((c) => c.id));

/**
 * Rückt einen Gefährten eine Reihe nach vorn (-1) oder hinten (+1). Am Anfang oder Ende entsteht
 * eine neue Reihe, wenn er dort nicht allein ist; leere Reihen fallen weg.
 */
export function moveInMarch(rows: string[][], id: string, step: -1 | 1): string[][] {
  const from = rows.findIndex((row) => row.includes(id));
  if (from < 0) return rows;
  const next = rows.map((row) => row.filter((other) => other !== id));
  const alone = rows[from]!.length === 1;
  let to = from + step;
  if (to < 0 || to >= rows.length) {
    if (alone) return rows;
    if (to < 0) {
      next.unshift([id]);
      return next.filter((row) => row.length);
    }
    next.push([id]);
    return next.filter((row) => row.length);
  }
  next[to] = [...next[to]!, id];
  return next.filter((row) => row.length);
}

/** Wie eine Reihe heißt. */
export function rowLabel(index: number, count: number): string {
  if (count === 1) return 'Alle';
  if (index === 0) return 'Vorn';
  if (index === count - 1) return 'Hinten';
  return count === 3 ? 'Mitte' : `Reihe ${index + 1}`;
}

export interface OnTheRoad {
  rows: Character[][];
  /** Wer welches Licht trägt (nach `timer.refs`). */
  lightOf: Map<string, Timer>;
  /** Lichter, die niemandem zugeordnet sind. */
  looseLights: Timer[];
  /**
   * Gold der Gruppe als Ganzes und aller zusammen: was sie als Beute bekommen hat, abzüglich
   * dessen, was sie beim Handel ausgegeben, und zuzüglich dessen, was sie eingenommen hat.
   */
  groupGold: number;
  totalGold: number;
  /** Davon aus dem Handel (Einnahmen minus Ausgaben): der Gruppe und aller zusammen. */
  groupTrade: number;
  totalTrade: number;
}

export function onTheRoad(data: CampaignData): OnTheRoad {
  const rows = marchRows(data);
  const lightOf = new Map<string, Timer>();
  const looseLights: Timer[] = [];
  const ids = new Set(rows.flat().map((c) => c.id));
  for (const light of burningLights(data)) {
    const owner = light.refs.find((ref) => ids.has(ref));
    if (owner && !lightOf.has(owner)) lightOf.set(owner, light);
    else if (!owner) looseLights.push(light);
  }
  const book = lootBook(data);
  const trade = tradeTotals(data);
  const groupTrade = trade.net.get(null) ?? 0;
  const totalTrade = roundGold(trade.earned - trade.spent);
  return {
    rows,
    lightOf,
    looseLights,
    groupGold: roundGold((book.shares.find((share) => !share.character)?.gold ?? 0) + groupTrade),
    totalGold: roundGold(book.gold + totalTrade),
    groupTrade,
    totalTrade,
  };
}
