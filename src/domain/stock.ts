/**
 * Bestände: Ein Bau, Hort oder Nest ist ein Ort mit Bewohnern – „rund 30, davon 6 Krieger und ein
 * Anführer“ – statt einzelner Statblöcke. Verluste im Kampf fehlen danach. Der Spielleiter legt
 * fest, wer dort haust; Wayfarer führt Buch.
 *
 * Reine Funktionen. (Nachwachsen, Abwandern und Reviere kommen später.)
 */
import { resolveCreature, xpOf, type Resolved } from './creature';
import type { CampaignData, Encounter, Stock, StockGroup } from './schema';
import { isNear } from './weight';

export interface GroupView {
  group: StockGroup;
  /** Das Wesen dahinter – null, wenn es aus dem Bestiarium gelöscht wurde. */
  resolved: Resolved | null;
  name: string;
  /** Wie viele noch da sind. */
  alive: number;
}

export interface StockView {
  stock: Stock;
  groups: GroupView[];
  /** Wie viele es einmal waren – und wie viele noch da sind. */
  count: number;
  alive: number;
  /** Erfahrungspunkte aller, die noch da sind. */
  xp: number;
}

type StockData = Pick<CampaignData, 'creatures'>;

export function stockView(data: StockData, stock: Stock): StockView {
  const groups = stock.groups.map((group): GroupView => {
    const resolved = resolveCreature(data.creatures, group.creatureId);
    return {
      group,
      resolved,
      name: resolved?.creature.name ?? 'Nicht mehr im Bestiarium',
      alive: Math.max(0, group.count - group.lost),
    };
  });
  return {
    stock,
    groups,
    count: groups.reduce((sum, entry) => sum + entry.group.count, 0),
    alive: groups.reduce((sum, entry) => sum + entry.alive, 0),
    xp: groups.reduce(
      (sum, entry) => sum + (entry.resolved ? xpOf(entry.resolved.block.cr) * entry.alive : 0),
      0,
    ),
  };
}

/** „27 von 30 – 20 Grubenschleicher, 6 Grubenschleicher-Treiber, 1 Krummzahn“ */
export function stockSummary(view: StockView): string {
  if (!view.groups.length) return 'noch niemand eingetragen';
  const head =
    view.alive === view.count
      ? `${view.count}`
      : view.alive === 0
        ? `niemand mehr von ${view.count}`
        : `${view.alive} von ${view.count}`;
  const parts = view.groups
    .filter((entry) => entry.alive > 0)
    .map((entry) => `${entry.alive} ${entry.name}`);
  return parts.length ? `${head} – ${parts.join(', ')}` : head;
}

/** Die Bestände dort, wo die Gruppe ist – am Ort, darüber oder darin. */
export function stocksHere(
  data: Pick<CampaignData, 'stocks' | 'entities' | 'state' | 'creatures'>,
): StockView[] {
  return Object.values(data.stocks)
    .filter((stock) => isNear(data, stock.placeId))
    .map((stock) => stockView(data, stock))
    .sort((a, b) => a.stock.name.localeCompare(b.stock.name, 'de'));
}

/** Wie viele eines Wesens aus einem Bestand schon in einer Begegnung stehen. */
export function fielded(encounter: Encounter, stockId: string, creatureId: string): number {
  return encounter.foes.filter(
    (foe) => foe.stockId === stockId && foe.creatureId === creatureId && !foe.booked,
  ).length;
}

export interface LossPlan {
  /** Besiegte Exemplare, die aus einem Bestand stammen und noch nicht verbucht sind. */
  foeIds: string[];
  /** Je Bestand und Wesen: wie viele fehlen. */
  losses: { stockId: string; creatureId: string; count: number }[];
}

/**
 * Was eine Begegnung einen Bestand gekostet hat: Wer aus ihm stammt und bei 0 Trefferpunkten
 * steht, fehlt danach. Schon Verbuchtes zählt nicht noch einmal.
 */
export function lossPlan(
  data: StockData & Pick<CampaignData, 'stocks'>,
  encounter: Encounter,
): LossPlan {
  const plan: LossPlan = { foeIds: [], losses: [] };
  for (const foe of encounter.foes) {
    if (!foe.stockId || foe.booked || foe.hp !== 0) continue;
    if (!data.stocks[foe.stockId] || !data.creatures[foe.creatureId]) continue;
    plan.foeIds.push(foe.id);
    const known = plan.losses.find(
      (entry) => entry.stockId === foe.stockId && entry.creatureId === foe.creatureId,
    );
    if (known) known.count++;
    else plan.losses.push({ stockId: foe.stockId, creatureId: foe.creatureId, count: 1 });
  }
  return plan;
}
