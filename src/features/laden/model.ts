/**
 * Der Korb im Laden: was am Tisch gekauft oder verkauft werden soll, bevor es festgehalten wird.
 * Reine Funktionen; festgehalten wird über `tradeAt` (`actions.ts`).
 */
import type { CampaignData, Entity, Rarity, ShopDemand, TradeDirection } from '../../domain/schema';
import {
  auctionBid,
  demandOf,
  demandThingOf,
  isWideRarity,
  rarityOf,
  type AuctionBid,
  type Die,
} from '../../domain/market';
import { activeParty } from '../../domain/derive';
import {
  baseName,
  isTradeKind,
  roundGold,
  type PricePlan,
  type TradeKind,
} from '../../domain/priceList';
import { kindFromFolderTitle, kindFromText } from '../wiki/facts';
import {
  creatureCategory,
  listOrRulePrice,
  readUnit,
  rulePrice,
  sellPrice,
  type Sellable,
  type StockRow,
  type TradeInput,
  type WareOption,
} from '../../domain/shop';
import type { Shop } from '../../domain/schema';
import {
  SRD_EQUIPMENT,
  srdMatch,
  srdSearch,
  type SrdGroup,
  type SrdItem,
} from '../../domain/srd/lookup';

export interface BasketLine {
  key: string;
  entityId: string | null;
  stockId: string | null;
  text: string;
  qty: number;
  /** Stückpreis in Gold; null = noch keiner – dann fehlt er. */
  price: number | null;
  /** Höchstens so viele (Bestand, einzelnes Stück); null = beliebig. */
  max: number | null;
  /** Wem es gehört (beim Verkauf): der Gefährte; null = die Gruppe; undefined = unbekannt. */
  ownerId?: string | null;
  /** Die Einheit des Preises: „je Pfund“; leer = je Stück. */
  unit?: string;
  /** Der Wert (Listenpreis oder Preis nach dem Regelwerk) – Grundlage beim Versteigern. */
  worth?: number | null;
  /** Seltenheit – beim Versteigern wird Seltenes breiter geboten. */
  rarity?: Rarity | '';
  /** Was der Handelsplatz dazu sagt (beim Verkauf): gesucht oder nicht gefragt. */
  demand?: ShopDemand | null;
}

/** Legt eine Zeile in den Korb – oder zählt eine vorhandene hoch, soweit der Bestand reicht. */
function put(basket: readonly BasketLine[], line: BasketLine): BasketLine[] {
  const found = basket.find((b) => b.key === line.key);
  if (!found) return line.max === 0 ? [...basket] : [...basket, line];
  return basket.map((b) =>
    b.key === line.key ? { ...b, qty: b.max === null ? b.qty + 1 : Math.min(b.max, b.qty + 1) } : b,
  );
}

/** Eine Ware aus dem Bestand des Ladens in den Korb. */
export const addRow = (basket: readonly BasketLine[], row: StockRow): BasketLine[] =>
  put(basket, {
    key: `stock:${row.line.id}`,
    entityId: row.entity?.id ?? null,
    stockId: row.line.id,
    text: row.name,
    qty: 1,
    price: row.price,
    max: row.single ? 1 : row.qty,
    unit: row.unit,
    worth: row.listPrice ?? row.rule?.price ?? null,
    rarity: rarityOf(row.entity),
  });

/** Ein Gegenstand der Gruppe in den Korb (zum Verkaufen). */
export const addSellable = (basket: readonly BasketLine[], item: Sellable): BasketLine[] =>
  put(basket, {
    key: `item:${item.entity.id}`,
    entityId: item.entity.id,
    stockId: null,
    text: item.entity.name,
    qty: 1,
    price: item.price,
    max: 1,
    ownerId: item.ownerId,
    worth: listOrRulePrice(item.entity),
    rarity: rarityOf(item.entity),
    demand: item.demand,
  });

/**
 * Ein Eintrag der Welt in den Korb: beim Kaufen zum Listenpreis mal Faktor, beim Verkaufen zum
 * Ankaufpreis des Ladens.
 */
export function addEntity(
  basket: readonly BasketLine[],
  entity: Entity,
  shop: Shop | null,
  direction: TradeDirection,
): BasketLine[] {
  const list = listOrRulePrice(entity);
  const price =
    direction === 'sell'
      ? sellPrice(shop, entity)
      : list === null
        ? null
        : roundGold(list * (shop?.priceFactor ?? 1));
  return put(basket, {
    key: `entity:${entity.id}`,
    entityId: entity.id,
    stockId: null,
    text: entity.name,
    qty: 1,
    price,
    max: null,
    worth: list,
    rarity: rarityOf(entity),
    demand: direction === 'sell' ? demandOf(shop, demandThingOf(entity)) : null,
  });
}

/**
 * Ein Wesen des Bestiariums in den Korb (ein abgerichtetes Tier, ein Reittier): Preis nach dem
 * Regelwerk, wenn ein Gegenstand gleichen Namens dort steht (Mastiff, Reitpferd) – sonst offen.
 */
export function addCreature(
  basket: readonly BasketLine[],
  data: Pick<CampaignData, 'creatures'>,
  creatureId: string,
  shop: Shop | null,
  direction: TradeDirection,
): BasketLine[] {
  const creature = data.creatures[creatureId];
  if (!creature) return [...basket];
  const worth = srdMatch(creature.name)?.price ?? null;
  const thing = { name: creature.name, category: creatureCategory(data, creatureId) };
  const share =
    direction === 'sell'
      ? (shop?.buyFactor ?? 0.5) * (demandOf(shop, thing)?.factor ?? 1)
      : (shop?.priceFactor ?? 1);
  return put(basket, {
    key: `creature:${creature.id}`,
    entityId: null,
    stockId: null,
    text: creature.name,
    qty: 1,
    price: worth === null ? null : roundGold(worth * share),
    max: null,
    worth,
    demand: direction === 'sell' ? demandOf(shop, thing) : null,
  });
}

/** Eine Ware aus der Wahl (`wareGroups`) in den Korb – Eintrag der Welt oder Wesen. */
export function addWare(
  basket: readonly BasketLine[],
  data: CampaignData,
  option: WareOption,
  shop: Shop | null,
  direction: TradeDirection,
): BasketLine[] {
  if (option.creatureId) return addCreature(basket, data, option.creatureId, shop, direction);
  const entity = option.entityId ? data.entities[option.entityId] : undefined;
  return entity ? addEntity(basket, entity, shop, direction) : [...basket];
}

/** Ein Gegenstand des Regelwerks in den Korb: sein Preis mal Preisfaktor des Ladens. */
export const addRuleItem = (
  basket: readonly BasketLine[],
  item: SrdItem,
  shop: Shop | null,
): BasketLine[] =>
  put(basket, {
    key: `srd:${item.id}`,
    entityId: null,
    stockId: null,
    text: item.name,
    qty: 1,
    price: rulePrice(shop, item),
    max: null,
  });

let freeCount = 0;

/**
 * Etwas nur in Worten, mit Preis – beim Verkauf an einem Handelsplatz mit dem, was er dazu sagt
 * (gesucht, nicht gefragt; der Preis bleibt der genannte).
 */
export function addFree(
  basket: readonly BasketLine[],
  text: string,
  price: number | null,
  options: { shop?: Shop | null; direction?: TradeDirection; qty?: number; unit?: string } = {},
): BasketLine[] {
  const words = text.replace(/\s+/g, ' ').trim();
  if (!words) return [...basket];
  const qty = options.qty && Number.isInteger(options.qty) && options.qty > 0 ? options.qty : 1;
  return [
    ...basket,
    {
      key: `free:${++freeCount}`,
      entityId: null,
      stockId: null,
      text: words,
      qty,
      price,
      max: null,
      unit: readUnit(options.unit ?? ''),
      worth: price,
      demand: options.direction === 'sell' ? demandOf(options.shop ?? null, { name: words }) : null,
    },
  ];
}

/**
 * Liest eine Menge, wie man sie am Tisch tippt: „12“, „3“; leer oder unlesbar = null. Nie unter
 * eins, nie Bruchteile.
 */
export function readQty(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 ? value : null;
}

/** Ändert die Einheit einer Zeile im Korb („je Pfund“). */
export const setUnit = (basket: readonly BasketLine[], key: string, unit: string): BasketLine[] =>
  basket.map((b) => (b.key === key ? { ...b, unit: readUnit(unit) } : b));

/**
 * Versteigert eine Zeile des Korbs: das Höchstgebot nach fester Regel (`auctionBid`) um ihren
 * Wert – den Listenpreis, sonst den genannten Preis. Seltenes (oder `wide`) breiter. null = ohne
 * Wert nichts zu versteigern. Nur ein Vorschlag; angenommen wird mit `setPrice`.
 */
export function auctionFor(line: BasketLine, die: Die, wide?: boolean): AuctionBid | null {
  const worth = line.worth ?? line.price;
  if (worth === null || worth === undefined || worth <= 0) return null;
  return auctionBid(worth, wide ?? isWideRarity(line.rarity), die);
}

/** Ändert die Menge; unter eins fällt die Zeile weg. Nie mehr, als da ist. */
export function setQty(basket: readonly BasketLine[], key: string, qty: number): BasketLine[] {
  if (!Number.isFinite(qty) || qty < 1) return basket.filter((b) => b.key !== key);
  return basket.map((b) =>
    b.key === key ? { ...b, qty: Math.floor(b.max === null ? qty : Math.min(b.max, qty)) } : b,
  );
}

/** Ändert den Stückpreis (gehandelt am Tisch). */
export const setPrice = (
  basket: readonly BasketLine[],
  key: string,
  price: number | null,
): BasketLine[] => basket.map((b) => (b.key === key ? { ...b, price } : b));

/** Wie viele schon im Korb liegen. */
export const inBasket = (basket: readonly BasketLine[], key: string): number =>
  basket.find((b) => b.key === key)?.qty ?? 0;

/** Die Summe des Korbs (Zeilen ohne Preis zählen nicht). */
export const basketTotal = (basket: readonly BasketLine[]): number =>
  roundGold(basket.reduce((sum, b) => sum + (b.price ?? 0) * b.qty, 0));

/** Was dem Festhalten im Weg steht – leer, wenn nichts. */
export function basketProblem(basket: readonly BasketLine[], direction: TradeDirection): string {
  if (!basket.length)
    return direction === 'buy' ? 'Der Korb ist leer.' : 'Noch nichts zum Verkaufen gewählt.';
  const missing = basket.find((b) => b.price === null);
  return missing ? `Für ${missing.text} fehlt ein Preis.` : '';
}

/** Wer verkauft: der eine Besitzer aller gewählten Gegenstände – sonst bleibt die Wahl. */
export function sellerOf(basket: readonly BasketLine[]): string | null | undefined {
  const owners = new Set(basket.filter((b) => b.ownerId !== undefined).map((b) => b.ownerId));
  return owners.size === 1 ? [...owners][0] : undefined;
}

/** Der Korb als Handel zum Festhalten. */
export function tradeInputOf(
  basket: readonly BasketLine[],
  shopId: string | null,
  direction: TradeDirection,
  toId: string | null,
): TradeInput {
  return {
    shopId,
    direction,
    toId,
    lines: basket.map((b) => ({
      entityId: b.entityId,
      stockId: b.stockId,
      text: b.text,
      qty: b.qty,
      price: b.price ?? 0,
      unit: b.unit ?? '',
    })),
  };
}

/**
 * Als was ein neuer Name der Preisliste angelegt wird – nach fester Regel: Was der Name selbst
 * sagt („Mondkraut“ → Pflanze, „Eisenerz“ → Gestein, „Heiltrank“ → Gegenstand), sonst was die
 * Überschrift darüber sagt („## Kräuter“ → Pflanze, „## Reittiere“ → Tier), sonst ein Gegenstand.
 * Ein Tier nur nach der Überschrift: „Räucherfisch“ ist Ware, kein Tier. Der Spielleiter kann es
 * in der Vorschau ändern.
 */
export function newKindOf(plan: Pick<PricePlan, 'name' | 'category'>): TradeKind {
  const named = kindFromText(baseName(plan.name));
  if (named && isTradeKind(named) && named !== 'animal') return named;
  const heading = plan.category
    ? (kindFromFolderTitle(plan.category) ?? kindFromText(plan.category))
    : null;
  return heading && isTradeKind(heading) ? heading : 'item';
}

/** Wer kaufen oder verkaufen kann: die Gruppe und die aktiven Gefährten. */
export const tradersOf = (data: CampaignData) =>
  [...activeParty(data)].sort((a, b) => a.name.localeCompare(b.name, 'de'));

// ── Aus dem Regelwerk durchsehen ───────────────────────────────────────────

export interface RuleView {
  /** Gewählte Gruppen – mehrere zugleich. */
  groups: readonly SrdGroup[];
  /** Der Vorschlag nach der Art des Ladens ist gewählt (dessen Gegenstände). */
  suggested: readonly SrdItem[] | null;
  query: string;
}

/**
 * Was im Nachschlagewerk gerade zu sehen ist: alles aus den gewählten Gruppen und dem Vorschlag,
 * eingeschränkt auf die Suche (deutsch oder englisch). Ohne Wahl findet die Suche in allem; ohne
 * Wahl und ohne Suche ist nichts zu sehen. In der Reihenfolge des Regelwerks.
 */
export function ruleChoice(view: RuleView): SrdItem[] {
  const query = view.query.trim();
  const chosen = view.groups.length > 0 || view.suggested !== null;
  if (!chosen) return query ? srdSearch(query) : [];
  const ids = new Set(view.suggested?.map((item) => item.id) ?? []);
  const pool = SRD_EQUIPMENT.filter((item) => ids.has(item.id) || view.groups.includes(item.group));
  if (!query) return pool;
  const hits = new Set(srdSearch(query).map((item) => item.id));
  return pool.filter((item) => hits.has(item.id));
}

/** Teilt eine Liste nach Unterteilung („Leichte Rüstung“, „Schild“) – in ihrer Reihenfolge. */
export function ruleSections(items: readonly SrdItem[]): { sub: string; items: SrdItem[] }[] {
  const out: { sub: string; items: SrdItem[] }[] = [];
  for (const item of items) {
    const section = out.find((s) => s.sub === item.sub);
    if (section) section.items.push(item);
    else out.push({ sub: item.sub, items: [item] });
  }
  return out;
}
