/**
 * Der Korb im Laden: was am Tisch gekauft oder verkauft werden soll, bevor es festgehalten wird.
 * Reine Funktionen; festgehalten wird über `tradeAt` (`actions.ts`).
 */
import type { CampaignData, Entity, TradeDirection } from '../../domain/schema';
import { activeParty } from '../../domain/derive';
import { roundGold } from '../../domain/priceList';
import {
  listPrice,
  sellPrice,
  type Sellable,
  type StockRow,
  type TradeInput,
} from '../../domain/shop';
import type { Shop } from '../../domain/schema';

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
  const list = listPrice(entity);
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
  });
}

let freeCount = 0;

/** Etwas nur in Worten, mit Preis. */
export function addFree(
  basket: readonly BasketLine[],
  text: string,
  price: number | null,
): BasketLine[] {
  const words = text.replace(/\s+/g, ' ').trim();
  if (!words) return [...basket];
  return [
    ...basket,
    {
      key: `free:${++freeCount}`,
      entityId: null,
      stockId: null,
      text: words,
      qty: 1,
      price,
      max: null,
    },
  ];
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
    })),
  };
}

/** Wer kaufen oder verkaufen kann: die Gruppe und die aktiven Gefährten. */
export const tradersOf = (data: CampaignData) =>
  [...activeParty(data)].sort((a, b) => a.name.localeCompare(b.name, 'de'));
