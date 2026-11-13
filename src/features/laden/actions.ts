/**
 * Befehle der Läden: anlegen, ändern, Bestand pflegen, eine Preisliste übernehmen, Vorschläge
 * annehmen – und handeln. Gekauft und verkauft wird nur über `tradeAt`: ein Eintrag der Art
 * „Handel“ (`recordEntry`), der Bestand und Besitzer einzelner Stücke mitzieht; Löschen des
 * Eintrags nimmt beides zurück. Die Rechnung steht in `domain/shop.ts` und `domain/priceList.ts`.
 */
import type { CampaignDb } from '../../data/db';
import { recordEntry, type RecordResult } from '../../data/record';
import type { PricePlan } from '../../domain/priceList';
import { listPrice, stockLine, withListPrice, type TradeInput } from '../../domain/shop';
import {
  createEntity,
  createShop,
  type CampaignData,
  type Entity,
  type Shop,
  type ShopStock,
} from '../../domain/schema';
import type { WorldTime } from '../../domain/time/calendar';
import { linkTwins } from '../wiki/actions';

/** Legt einen Laden an – an einem Ort, bei einem Händler oder beidem. */
export function newShop(db: CampaignDb, init: Partial<Shop> = {}): Shop {
  return db.put('shops', createShop(init));
}

/** Ändert die Angaben eines Ladens (nicht den Bestand Zeile für Zeile – dafür `patchStockLine`). */
export function patchShop(db: CampaignDb, shopId: string, change: Partial<Shop>): void {
  if (!db.getSnapshot().shops[shopId]) return;
  db.patch('shops', shopId, change);
}

/**
 * Löscht einen Laden. Einträge der Chronik über seine Geschäfte bleiben – sie nennen ihn dann
 * nicht mehr. Gibt zurück, was ihn wiederherstellt.
 */
export function removeShop(db: CampaignDb, shopId: string): (() => void) | null {
  const shop = db.getSnapshot().shops[shopId];
  if (!shop) return null;
  db.remove('shops', shopId);
  return () => {
    if (!db.getSnapshot().shops[shopId]) db.put('shops', { ...shop, rev: 0 });
  };
}

/** Hängt Zeilen an den Bestand. Ein Eintrag, den der Laden schon führt, kommt nicht doppelt. */
export function addStockLines(db: CampaignDb, shopId: string, lines: Partial<ShopStock>[]): void {
  const shop = db.getSnapshot().shops[shopId];
  if (!shop) return;
  const next = [...shop.stock];
  for (const line of lines) {
    if (line.entityId && next.some((s) => s.entityId === line.entityId)) continue;
    if (!line.entityId && !line.text?.trim()) continue;
    next.push(stockLine({ ...line, text: line.text?.trim() ?? '' }));
  }
  db.patch('shops', shopId, { stock: next });
}

/** Ändert eine Zeile des Bestands. */
export function patchStockLine(
  db: CampaignDb,
  shopId: string,
  lineId: string,
  change: Partial<Omit<ShopStock, 'id'>>,
): void {
  const shop = db.getSnapshot().shops[shopId];
  if (!shop?.stock.some((s) => s.id === lineId)) return;
  db.patch('shops', shopId, {
    stock: shop.stock.map((s) => (s.id === lineId ? { ...s, ...change } : s)),
  });
}

/** Nimmt eine Zeile aus dem Bestand. */
export function removeStockLine(db: CampaignDb, shopId: string, lineId: string): void {
  const shop = db.getSnapshot().shops[shopId];
  if (!shop) return;
  db.patch('shops', shopId, { stock: shop.stock.filter((s) => s.id !== lineId) });
}

/** Verschiebt eine Zeile des Bestands um eins nach oben (-1) oder unten (+1). */
export function moveStockLine(db: CampaignDb, shopId: string, lineId: string, step: -1 | 1): void {
  const shop = db.getSnapshot().shops[shopId];
  if (!shop) return;
  const index = shop.stock.findIndex((s) => s.id === lineId);
  const target = index + step;
  if (index < 0 || target < 0 || target >= shop.stock.length) return;
  const stock = [...shop.stock];
  [stock[index], stock[target]] = [stock[target]!, stock[index]!];
  db.patch('shops', shopId, { stock });
}

/** Nimmt Vorschläge in den Bestand – mit Listenpreis mal Faktor und ohne Mengenangabe. */
export function acceptShopSuggestions(
  db: CampaignDb,
  shopId: string,
  entityIds: readonly string[],
): (() => void) | null {
  const before = db.getSnapshot().shops[shopId];
  if (!before) return null;
  const data = db.getSnapshot();
  addStockLines(
    db,
    shopId,
    entityIds
      .filter((id) => data.entities[id])
      .map((entityId) => ({ entityId, text: data.entities[entityId]!.name })),
  );
  return restoreShop(db, before);
}

/** Stellt den Bestand wieder her, solange seither niemand sonst den Laden geändert hat. */
function restoreShop(db: CampaignDb, before: Shop): () => void {
  const after = db.getSnapshot().shops[before.id]?.rev;
  return () => {
    const now = db.getSnapshot().shops[before.id];
    if (now && now.rev === after) db.put('shops', { ...now, stock: before.stock });
  };
}

/** Eine Zeile der Preisliste, wie der Spielleiter sie bestätigt hat. */
export interface PriceListPick {
  plan: PricePlan;
  /** Der gewählte Eintrag (bei mehreren, die passen); null = keiner. */
  entityId: string | null;
}

export interface PriceListResult {
  /** Neu angelegte Gegenstände. */
  created: number;
  /** Einträge, die ihren Listenpreis bekamen. */
  priced: number;
  /** Zeilen im Bestand (neu oder geändert). */
  stocked: number;
  undo: () => void;
}

/**
 * Übernimmt bestätigte Zeilen einer Preisliste: Fehlende Gegenstände werden angelegt (mit Preis
 * und der Überschrift als Einordnung), Einträge ohne Listenpreis bekommen den Preis der Zeile.
 * Mit `shopId` kommen die Zeilen in den Bestand: Weicht der Preis vom Listenpreis ab, ist er der
 * eigene Preis des Ladens. Angelegte Gegenstände finden danach ihren Artikel gleichen Namens.
 */
export function takePriceList(
  db: CampaignDb,
  shopId: string | null,
  picks: readonly PriceListPick[],
): PriceListResult {
  const createdIds: string[] = [];
  const priced: { id: string; price: number }[] = [];
  const shopBefore = shopId ? db.getSnapshot().shops[shopId] : undefined;
  let stocked = 0;
  db.batch(() => {
    const lines: ShopStock[] = shopBefore ? [...shopBefore.stock] : [];
    for (const { plan, entityId } of picks) {
      const data = db.getSnapshot();
      let entity: Entity | undefined = entityId ? data.entities[entityId] : undefined;
      if (!entity && !entityId && plan.create) {
        entity = db.put(
          'entities',
          createEntity({
            kind: 'item',
            name: plan.name,
            item: { price: plan.price, category: plan.category },
          }),
        );
        createdIds.push(entity.id);
      } else if (entity && plan.price !== null && listPrice(entity) === null) {
        entity = db.put('entities', withListPrice(entity, plan.price));
        priced.push({ id: entity.id, price: plan.price });
      }
      if (!shopBefore) continue;
      const list = listPrice(entity);
      const own = plan.price !== null && plan.price !== list ? plan.price : null;
      const existing = entity ? lines.findIndex((s) => s.entityId === entity!.id) : -1;
      if (existing >= 0) {
        lines[existing] = {
          ...lines[existing]!,
          price: own,
          qty: plan.qty ?? lines[existing]!.qty,
        };
      } else
        lines.push(
          stockLine({
            entityId: entity?.id ?? null,
            text: entity ? entity.name : plan.name,
            price: entity ? own : plan.price,
            qty: plan.qty,
          }),
        );
      stocked++;
    }
    if (shopBefore) db.patch('shops', shopBefore.id, { stock: lines });
    if (createdIds.length) linkTwins(db);
  });
  const restore = shopBefore ? restoreShop(db, shopBefore) : () => {};
  return {
    created: createdIds.length,
    priced: priced.length,
    stocked,
    undo: () =>
      db.batch(() => {
        restore();
        // Der Preis geht nur weg, wenn ihn seither niemand geändert hat.
        for (const { id, price } of priced) {
          const now = db.getSnapshot().entities[id];
          if (now && listPrice(now) === price) db.put('entities', withListPrice(now, null));
        }
        for (const id of createdIds) if (db.getSnapshot().entities[id]) db.remove('entities', id);
      }),
  };
}

/** Wann und mit welcher Anmerkung ein Handel festgehalten wird. */
export interface TradeWhen {
  text?: string;
  at?: WorldTime;
  secret?: boolean;
}

/**
 * Hält einen Handel fest: ein Eintrag der Art „Handel“ – Bestand des Ladens und Besitzer
 * einzelner Stücke ziehen mit. Kaufen ist keine Beute: Das Beute-Buch bleibt, wie es ist.
 */
export function tradeAt(db: CampaignDb, input: TradeInput, when: TradeWhen = {}): RecordResult {
  return recordEntry(db, {
    kind: 'trade',
    text: when.text ?? '',
    at: when.at,
    secret: when.secret,
    trade: input,
  });
}

/** Die Läden, die es gibt – für Auswahllisten. */
export const allShops = (data: Pick<CampaignData, 'shops'>): Shop[] => Object.values(data.shops);
