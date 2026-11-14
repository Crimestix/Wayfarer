/**
 * Befehle der Läden: anlegen, ändern, Bestand pflegen, eine Preisliste übernehmen, Vorschläge
 * und Vorlagen annehmen, Vorlagen für Ladenarten schreiben und merken – und handeln. Gekauft und verkauft wird nur über `tradeAt`: ein Eintrag der Art
 * „Handel“ (`recordEntry`), der Bestand und Besitzer einzelner Stücke mitzieht; Löschen des
 * Eintrags nimmt beides zurück. Die Rechnung steht in `domain/shop.ts` und `domain/priceList.ts`.
 */
import type { CampaignDb } from '../../data/db';
import { recordEntry, type RecordResult } from '../../data/record';
import { KIND_LABEL } from '../../domain/derive';
import { isTradeKind, nameKey, type PricePlan, type TradeKind } from '../../domain/priceList';
import {
  listPrice,
  stockLine,
  stockRuleItem,
  stockedRuleIds,
  withListPrice,
  type TradeInput,
} from '../../domain/shop';
import { srdItem } from '../../domain/srd/lookup';
import { templateOfKind, templateTextOf } from '../../domain/shopTemplate';
import {
  createEntity,
  createShop,
  createShopTemplate,
  type CampaignData,
  type Entity,
  type Shop,
  type ShopStock,
  type ShopTemplate,
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

/**
 * Hängt Zeilen an den Bestand. Ein Eintrag, ein Wesen oder ein Gegenstand des Regelwerks, den der
 * Laden schon führt, kommt nicht doppelt. Gibt zurück, wie viele dazukamen.
 */
export function addStockLines(
  db: CampaignDb,
  shopId: string,
  lines: Partial<Omit<ShopStock, 'id'>>[],
): number {
  const shop = db.getSnapshot().shops[shopId];
  if (!shop) return 0;
  const next = [...shop.stock];
  let added = 0;
  for (const line of lines) {
    if (line.entityId && next.some((s) => s.entityId === line.entityId)) continue;
    if (line.creatureId && next.some((s) => s.creatureId === line.creatureId)) continue;
    if (!line.entityId && line.srdId && next.some((s) => s.srdId === line.srdId)) continue;
    if (!line.entityId && !line.creatureId && !line.text?.trim()) continue;
    next.push(stockLine({ ...line, text: line.text?.trim() ?? '', unit: line.unit?.trim() ?? '' }));
    added++;
  }
  if (added) db.patch('shops', shopId, { stock: next });
  return added;
}

/**
 * Nimmt angekreuzte Zeilen in den Bestand – aus einer Vorlage, einem Vorschlag Wayfarers oder
 * dem Bestiarium. Gibt zurück, wie viele dazukamen, und was es rückgängig macht.
 */
export function addProposedLines(
  db: CampaignDb,
  shopId: string,
  lines: readonly Partial<Omit<ShopStock, 'id'>>[],
): { added: number; undo: () => void } | null {
  const before = db.getSnapshot().shops[shopId];
  if (!before) return null;
  const added = addStockLines(db, shopId, [...lines]);
  return { added, undo: added ? restoreShop(db, before) : () => {} };
}

// ── Vorlagen für Ladenarten ────────────────────────────────────────────────

/** Legt eine Vorlage an – leer oder mit Art und Liste. */
export function newShopTemplate(db: CampaignDb, init: Partial<ShopTemplate> = {}): ShopTemplate {
  return db.put('assortments', createShopTemplate(init));
}

/** Ändert Art oder Liste einer Vorlage. */
export function patchShopTemplate(
  db: CampaignDb,
  templateId: string,
  change: Partial<Pick<ShopTemplate, 'kind' | 'text'>>,
): void {
  if (!db.getSnapshot().assortments[templateId]) return;
  db.patch('assortments', templateId, change);
}

/** Löscht eine Vorlage – Läden bleiben, wie sie sind. Gibt zurück, was sie wiederherstellt. */
export function removeShopTemplate(db: CampaignDb, templateId: string): (() => void) | null {
  const template = db.getSnapshot().assortments[templateId];
  if (!template) return null;
  db.remove('assortments', templateId);
  return () => {
    if (!db.getSnapshot().assortments[templateId]) db.put('assortments', { ...template, rev: 0 });
  };
}

/**
 * „Als Vorlage für <Art> merken“: Der Bestand des Ladens wird die Liste der Vorlage seiner Art –
 * eine vorhandene Vorlage dieser Art bekommt die neue Liste (`replaced`), sonst entsteht eine.
 * null, wenn der Laden keine Art hat. Gibt zurück, was es rückgängig macht.
 */
export function rememberAsTemplate(
  db: CampaignDb,
  shopId: string,
): { template: ShopTemplate; replaced: boolean; undo: () => void } | null {
  const data = db.getSnapshot();
  const shop = data.shops[shopId];
  const kind = shop?.kind.trim() ?? '';
  if (!shop || !kind) return null;
  const text = templateTextOf(data, shop);
  const existing = templateOfKind(data, kind);
  if (existing) {
    db.patch('assortments', existing.id, { text });
    const after = db.getSnapshot().assortments[existing.id]!;
    return {
      template: after,
      replaced: true,
      undo: () => {
        const now = db.getSnapshot().assortments[existing.id];
        if (now && now.rev === after.rev) db.put('assortments', { ...now, text: existing.text });
      },
    };
  }
  const template = newShopTemplate(db, { kind, text });
  return {
    template,
    replaced: false,
    undo: () => {
      if (db.getSnapshot().assortments[template.id]) db.remove('assortments', template.id);
    },
  };
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

/**
 * Nimmt Gegenstände aus dem Regelwerk (SRD 5.2.1) in den Bestand – als Zeilen in Worten mit
 * Verweis aufs Regelwerk (`srdId`): ohne eigenen Preis gilt der Preis des Regelwerks mal
 * Preisfaktor. Legt keine Einträge der Welt an. Was der Laden schon führt, kommt nicht doppelt.
 * Gibt zurück, wie viele dazukamen, und was es rückgängig macht.
 */
export function addRuleItems(
  db: CampaignDb,
  shopId: string,
  srdIds: readonly string[],
): { added: number; undo: () => void } | null {
  const before = db.getSnapshot().shops[shopId];
  if (!before) return null;
  const have = stockedRuleIds(db.getSnapshot(), before);
  const lines: ShopStock[] = [];
  for (const id of srdIds) {
    const item = srdItem(id);
    if (!item || have.has(item.id)) continue;
    have.add(item.id);
    lines.push(stockLine({ text: item.name, srdId: item.id }));
  }
  if (!lines.length) return { added: 0, undo: () => {} };
  db.patch('shops', shopId, { stock: [...before.stock, ...lines] });
  return { added: lines.length, undo: restoreShop(db, before) };
}

/**
 * „Als Gegenstand anlegen“: macht aus einer Zeile des Regelwerks einen Eintrag der Welt – nur auf
 * ausdrücklichen Wunsch des Spielleiters. Gibt es schon einen Eintrag dieses Namens, wird er
 * genommen (nie ein zweiter); sonst entsteht ein Gegenstand (Reittiere: ein Tier) mit dem Preis
 * des Regelwerks als Listenpreis und der Unterteilung als Einordnung. Trägt schon ein Eintrag
 * anderer Art den Namen (eine Person, ein Ort …), entsteht nichts (`takenBy`). Gibt die Kennung
 * des Eintrags zurück und was es rückgängig macht; null, wenn die Zeile nicht passt.
 */
export function stockLineToItem(
  db: CampaignDb,
  shopId: string,
  lineId: string,
):
  | { entityId: string; created: boolean; rule: boolean; undo: () => void }
  | { takenBy: string }
  | null {
  const data = db.getSnapshot();
  const shop = data.shops[shopId];
  const line = shop?.stock.find((s) => s.id === lineId);
  if (!shop || !line || line.entityId) return null;
  const rule = stockRuleItem(data, line);
  const name = line.text.trim() || rule?.name || '';
  if (!name) return null;
  const key = nameKey(name);
  const same = Object.values(data.entities).filter((entity) =>
    [entity.name, ...entity.aliases].some((n) => nameKey(n) === key),
  );
  // Gegenstand vor Pflanze, Gestein und Tier – wie bei der Preisliste.
  const twin =
    same.find((entity) => entity.kind === 'item') ??
    same.find((entity) => isTradeKind(entity.kind));
  // Trägt eine Person, ein Ort … den Namen, entsteht kein zweiter Eintrag gleichen Namens.
  const other = same.find((entity) => !isTradeKind(entity.kind));
  if (!twin && other) return { takenBy: `${other.name} (${KIND_LABEL[other.kind]})` };
  let entityId = twin?.id ?? '';
  db.batch(() => {
    if (!twin) {
      const details = { price: rule?.price ?? null, category: rule?.sub ?? '' };
      const made = db.put(
        'entities',
        rule?.group === 'mounts'
          ? createEntity({ kind: 'animal', name, animal: details })
          : createEntity({ kind: 'item', name, item: details }),
      );
      entityId = made.id;
    }
    db.patch('shops', shopId, {
      stock: shop.stock.map((s) => (s.id === lineId ? { ...s, entityId } : s)),
    });
    if (!twin) linkTwins(db);
  });
  return {
    entityId,
    created: !twin,
    rule: !twin && rule !== null,
    // Löst die Zeile wieder vom Eintrag – auch wenn der Laden seither anders geändert wurde.
    undo: () =>
      db.batch(() => {
        const now = db.getSnapshot().shops[shopId];
        if (now?.stock.some((s) => s.id === lineId && s.entityId === entityId))
          db.patch('shops', shopId, {
            stock: now.stock.map((s) => (s.id === lineId ? { ...s, entityId: null } : s)),
          });
        if (!twin && db.getSnapshot().entities[entityId]) db.remove('entities', entityId);
      }),
  };
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
  /** Als was ein neuer Name angelegt wird (`newKindOf`); ohne Angabe ein Gegenstand. */
  kind?: TradeKind;
}

export interface PriceListResult {
  /** Neu angelegte Einträge. */
  created: number;
  /** Einträge, die ihren Listenpreis bekamen. */
  priced: number;
  /** Zeilen im Bestand (neu oder geändert). */
  stocked: number;
  undo: () => void;
}

/**
 * Übernimmt bestätigte Zeilen einer Preisliste: Fehlende Einträge werden angelegt – als
 * Gegenstand, Pflanze, Gestein oder Tier, wie der Spielleiter bestätigt hat (mit Preis und der
 * Überschrift als Einordnung), Einträge ohne Listenpreis bekommen den Preis der Zeile.
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
  // Zeilen des Bestands, die neu sind oder geändert wurden – eine zweimal genannte zählt einmal.
  const stocked = new Set<string>();
  // Steht ein neuer Name zweimal in der Liste, wird er nur einmal angelegt.
  const made = new Map<string, Entity>();
  db.batch(() => {
    const lines: ShopStock[] = shopBefore ? [...shopBefore.stock] : [];
    for (const { plan, entityId, kind } of picks) {
      const data = db.getSnapshot();
      let entity: Entity | undefined = entityId ? data.entities[entityId] : undefined;
      if (!entity && !entityId && plan.create && made.has(nameKey(plan.name)))
        entity = made.get(nameKey(plan.name));
      else if (!entity && !entityId && plan.create) {
        entity = db.put('entities', newTradeEntity(kind ?? 'item', plan));
        createdIds.push(entity.id);
        made.set(nameKey(plan.name), entity);
      } else if (entity && plan.price !== null && listPrice(entity) === null) {
        entity = db.put('entities', withListPrice(entity, plan.price));
        priced.push({ id: entity.id, price: plan.price });
      }
      if (!shopBefore) continue;
      const list = listPrice(entity);
      const own = plan.price !== null && plan.price !== list ? plan.price : null;
      const existing = entity ? lines.findIndex((s) => s.entityId === entity!.id) : -1;
      if (existing >= 0) {
        stocked.add(lines[existing]!.id);
        lines[existing] = {
          ...lines[existing]!,
          price: own,
          qty: plan.qty ?? lines[existing]!.qty,
          unit: plan.unit || lines[existing]!.unit,
        };
      } else {
        const line = stockLine({
          entityId: entity?.id ?? null,
          text: entity ? entity.name : plan.name,
          price: entity ? own : plan.price,
          qty: plan.qty,
          unit: plan.unit,
        });
        lines.push(line);
        stocked.add(line.id);
      }
    }
    if (shopBefore) db.patch('shops', shopBefore.id, { stock: lines });
    if (createdIds.length) linkTwins(db);
  });
  const restore = shopBefore ? restoreShop(db, shopBefore) : () => {};
  return {
    created: createdIds.length,
    priced: priced.length,
    stocked: stocked.size,
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

/** Ein neuer Eintrag aus einer Zeile der Preisliste: Listenpreis und Überschrift als Einordnung. */
function newTradeEntity(kind: TradeKind, plan: PricePlan): Entity {
  const details = { price: plan.price, category: plan.category };
  switch (kind) {
    case 'plant':
      return createEntity({ kind, name: plan.name, plant: details });
    case 'animal':
      return createEntity({ kind, name: plan.name, animal: details });
    case 'mineral':
      return createEntity({ kind, name: plan.name, mineral: details });
    default:
      return createEntity({ kind: 'item', name: plan.name, item: details });
  }
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
