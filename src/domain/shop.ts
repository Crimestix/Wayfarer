/**
 * Läden und Preise: was ein Ort verkauft, zu welchem Preis, und was beim Kaufen und Verkaufen
 * geschieht. Ein Laden (`shops/`) hat einen Bestand aus Einträgen der Welt oder Worten; der
 * Preis einer Ware ist ihr eigener Preis im Laden oder ihr Listenpreis mal dem Preisfaktor des
 * Ladens. Was ein Laden verkauft und angekauft hat, steht nur in der Chronik (Einträge der Art
 * „Handel“) – nie doppelt im Laden. Wayfarer rechnet und ordnet; was im Laden liegt, schreibt
 * der Spielleiter. Vorschläge für den Bestand gelten erst, wenn er sie annimmt. Reine Funktionen.
 */
import { KIND_LABEL, chronicleSorted, entityName, normalize, placeAncestors } from './derive';
import { formatGold } from './loot';
import { isNature, natureHere, natureOf, type NatureKind } from './nature';
import { isTradeKind, roundGold } from './priceList';
import {
  newId,
  PARTY_ID,
  type CampaignData,
  type ChronicleEntry,
  type Entity,
  type Item,
  type Shop,
  type ShopStock,
  type TradeDirection,
  type TradeLine,
} from './schema';

// ── Preise ─────────────────────────────────────────────────────────────────

/** Der Listenpreis eines Eintrags in Gold: was er gewöhnlich kostet. null = nicht angegeben. */
export function listPrice(entity: Entity | undefined | null): number | null {
  if (!entity) return null;
  if (entity.kind === 'item') return entity.item.price;
  if (isNature(entity)) return natureOf(entity).price;
  return null;
}

/**
 * Ein Preis zum Lesen am Tisch: Gold mit Komma („1,5 GM“), unter einem Gold in Silber („5 SM“)
 * oder Kupfer („3 KM“).
 */
export function formatPrice(gold: number): string {
  const value = roundGold(gold);
  if (value >= 1 || value === 0) return formatGold(value);
  const copper = Math.round(value * 100);
  return copper % 10 === 0 ? `${copper / 10} SM` : `${copper} KM`;
}

/** Wie teuer ein Laden ist: die Stufen zur Auswahl. Dazwischen geht jeder Faktor. */
export const PRICE_LEVELS = [
  { value: 0.8, label: 'billig' },
  { value: 1, label: 'fair' },
  { value: 1.25, label: 'teuer' },
  { value: 1.5, label: 'Wucher' },
] as const;

/** Was ein Laden beim Ankauf zahlt: die Stufen zur Auswahl. */
export const BUY_LEVELS = [
  { value: 0.25, label: 'ein Viertel' },
  { value: 0.5, label: 'die Hälfte' },
  { value: 0.75, label: 'drei Viertel' },
  { value: 1, label: 'den vollen Preis' },
] as const;

/** Ein Faktor in Prozent: „125 %“. */
export const percentText = (factor: number): string =>
  `${Math.round(factor * 100).toLocaleString('de-DE')} %`;

/** Wie teuer: „teuer“ oder „110 %“. */
export function priceLevelLabel(factor: number): string {
  return PRICE_LEVELS.find((level) => level.value === factor)?.label ?? percentText(factor);
}

/** Was er beim Ankauf zahlt: „die Hälfte“ oder „60 %“. */
export function buyLevelLabel(factor: number): string {
  return BUY_LEVELS.find((level) => level.value === factor)?.label ?? percentText(factor);
}

/** Liest einen Faktor: „1,25“, „125 %“, „125%“. null = unlesbar. */
export function readFactor(text: string): number | null {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*(%)?\s*$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]!.replace(',', '.')) / (match[2] ? 100 : 1);
  return Number.isFinite(value) && value > 0 && value <= 20 ? value : null;
}

// ── Läden ──────────────────────────────────────────────────────────────────

/**
 * Wo ein Laden steht: sein Ort – sonst dort, wo der Händler gerade ist (fahrender Händler). Ein
 * toter oder verschollener Händler ist nirgends, sein fahrender Laden also auch nicht.
 */
export function shopPlaceId(data: Pick<CampaignData, 'entities'>, shop: Shop): string | null {
  if (shop.placeId && data.entities[shop.placeId]?.kind === 'place') return shop.placeId;
  const keeper = shop.keeperId ? data.entities[shop.keeperId] : undefined;
  if (keeper?.kind === 'person') {
    if (keeper.person.status === 'dead' || keeper.person.status === 'missing') return null;
    return keeper.person.placeId ?? keeper.person.homeId;
  }
  if (keeper?.kind === 'faction') return keeper.faction.seatId;
  return null;
}

/** Wie ein Laden heißt: sein Name – sonst Art und Händler („Schmiede · Brann Eichwald“). */
export function shopTitle(data: CampaignData, shop: Shop): string {
  if (shop.title.trim()) return shop.title.trim();
  const keeper =
    shop.keeperId && data.entities[shop.keeperId] ? entityName(data, shop.keeperId) : '';
  return [shop.kind.trim(), keeper].filter(Boolean).join(' · ') || 'Laden';
}

const byTitle = (data: CampaignData) => (a: Shop, b: Shop) =>
  shopTitle(data, a).localeCompare(shopTitle(data, b), 'de');

/** Die Läden an einem Ort und an den Orten darin – die nächsten zuerst. */
export function shopsAt(data: CampaignData, placeId: string | null): Shop[] {
  if (!placeId) return [];
  const depth = (shop: Shop): number => {
    const at = shopPlaceId(data, shop);
    if (!at) return -1;
    if (at === placeId) return 0;
    const above = placeAncestors(data, at);
    const index = above.findIndex((place) => place.id === placeId);
    return index < 0 ? -1 : index + 1;
  };
  return Object.values(data.shops)
    .map((shop) => ({ shop, depth: depth(shop) }))
    .filter((entry) => entry.depth >= 0)
    .sort((a, b) => a.depth - b.depth || byTitle(data)(a.shop, b.shop))
    .map((entry) => entry.shop);
}

/** „Läden hier“ am Spieltisch: am Ort der Gruppe und an den Orten darin. */
export const shopsHere = (data: CampaignData): Shop[] => shopsAt(data, data.state.placeId);

/** Die Läden, die zu einem Eintrag gehören: an diesem Ort oder mit ihm als Händler. */
export function shopsOf(data: CampaignData, entityId: string): Shop[] {
  return Object.values(data.shops)
    .filter((shop) => shop.placeId === entityId || shop.keeperId === entityId)
    .sort(byTitle(data));
}

// ── Bestand ────────────────────────────────────────────────────────────────

/**
 * Ein einzelnes Stück der Welt – kein Gegenstand von der Stange: Es führt seinen Lebenslauf,
 * jemand hat es, oder die Gruppe hat es bekommen. Beim Kauf und Verkauf wechselt es den Besitzer.
 */
export function isSingleItem(data: CampaignData, entity: Entity | undefined | null): boolean {
  if (entity?.kind !== 'item') return false;
  return entity.item.history || entity.item.holderId !== null || groupItems(data).has(entity.id);
}

/**
 * Wer aus der Gruppe ein einzelnes Stück schon hat: der Gefährte, `PARTY_ID` für die Gruppe als
 * Ganzes – null, wenn es niemand aus der Gruppe hat. Ein Laden kann es dann nicht verkaufen, auch
 * wenn sein Bestand die Menge nicht zählt.
 */
export function partyHolder(data: CampaignData, entity: Entity | undefined | null): string | null {
  if (entity?.kind !== 'item') return null;
  const holder = entity.item.holderId;
  if (holder === PARTY_ID) return PARTY_ID;
  if (holder) return data.entities[holder]?.kind === 'character' ? holder : null;
  return groupItems(data).has(entity.id) ? PARTY_ID : null;
}

export interface StockRow {
  line: ShopStock;
  entity: Entity | null;
  name: string;
  /** Preis in diesem Laden je Stück; null = offen. */
  price: number | null;
  /** Ein eigener Preis des Ladens statt Listenpreis mal Faktor. */
  own: boolean;
  listPrice: number | null;
  /** Wie viele noch da sind; null = so viele man will. */
  qty: number | null;
  soldOut: boolean;
  /** Ein einzelnes Stück (wechselt beim Kauf den Besitzer). */
  single: boolean;
  /** Einordnung: die des Eintrags, sonst seine Art. */
  category: string;
}

/** Der Preis einer Zeile des Bestands in diesem Laden. */
export function stockPrice(data: CampaignData, shop: Shop, line: ShopStock): number | null {
  if (line.price !== null) return line.price;
  const list = listPrice(line.entityId ? data.entities[line.entityId] : null);
  return list === null ? null : roundGold(list * shop.priceFactor);
}

/** Einordnung eines Eintrags in Worten: „Kraut“, sonst „Pflanze“. */
export function tradeCategory(entity: Entity | null | undefined): string {
  if (!entity) return '';
  const category =
    entity.kind === 'item'
      ? entity.item.category
      : isNature(entity)
        ? natureOf(entity).category
        : '';
  return category.trim() || KIND_LABEL[entity.kind];
}

/** Der Bestand eines Ladens, wie er am Tisch steht – in der Reihenfolge des Spielleiters. */
export function stockRows(data: CampaignData, shop: Shop): StockRow[] {
  return shop.stock.map((line) => {
    const found = line.entityId ? data.entities[line.entityId] : undefined;
    const entity = found ?? null;
    const single = isSingleItem(data, entity);
    // Ein einzelnes Stück, das die Gruppe schon hat, liegt nicht mehr im Laden.
    const gone = single && partyHolder(data, entity) !== null;
    return {
      line,
      entity,
      name: line.text.trim() || entity?.name || '',
      price: stockPrice(data, shop, line),
      own: line.price !== null,
      listPrice: listPrice(entity),
      qty: gone ? 0 : single && line.qty === null ? 1 : line.qty,
      soldOut: line.qty === 0 || gone,
      single,
      category: tradeCategory(entity),
    };
  });
}

/** Zeilen, die zu einem Suchwort passen – im Namen oder der Einordnung. */
export function filterRows(rows: readonly StockRow[], query: string): StockRow[] {
  const q = normalize(query.trim());
  if (!q) return [...rows];
  return rows.filter(
    (row) => normalize(row.name).includes(q) || normalize(row.category).includes(q),
  );
}

/** Eine neue Zeile für den Bestand. */
export function stockLine(init: Partial<ShopStock> = {}): ShopStock {
  return { id: newId(), entityId: null, text: '', price: null, qty: null, ...init };
}

// ── Ankauf ─────────────────────────────────────────────────────────────────

const plainWord = (text: string) =>
  normalize(text)
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Kauft der Laden so etwas an? Ohne Angabe kauft er alles; Worte ohne Eintrag immer. */
export function buysThing(shop: Shop | null, entity: Entity | null | undefined): boolean {
  if (!shop || !shop.buys.length || !entity) return true;
  const words = [tradeCategory(entity), KIND_LABEL[entity.kind]].map(plainWord);
  return shop.buys.some((buy) => {
    const want = plainWord(buy);
    return !!want && words.some((word) => word === want || word.includes(want));
  });
}

/** Was der Laden für ein Stück zahlt: Listenpreis mal Ankauf (ohne Laden die Hälfte). */
export function sellPrice(shop: Shop | null, entity: Entity | null | undefined): number | null {
  const list = listPrice(entity);
  return list === null ? null : roundGold(list * (shop?.buyFactor ?? 0.5));
}

/**
 * Gegenstände, die die Gruppe als Ganzes hat: als Beute an die Gruppe gegangen oder von der
 * Gruppe gekauft – und seither weder weitergegeben noch verkauft und bei niemandem sonst.
 */
export function groupItems(data: CampaignData): Set<string> {
  const cached = groupCache.get(data);
  if (cached) return cached;
  const events: { at: number; order: string; itemId: string; group: boolean }[] = [];
  for (const loot of Object.values(data.loot))
    if (loot.given && loot.itemId && loot.at !== null)
      events.push({ at: loot.at, order: loot.created, itemId: loot.itemId, group: !loot.toId });
  for (const entry of Object.values(data.chronicle)) {
    const trade = entry.kind === 'trade' ? entry.trade : null;
    if (!trade) continue;
    for (const line of trade.lines)
      if (line.claimed && line.entityId)
        events.push({
          at: entry.at,
          order: entry.created,
          itemId: line.entityId,
          group: trade.direction === 'buy' && !trade.toId,
        });
  }
  events.sort((a, b) => a.at - b.at || a.order.localeCompare(b.order));
  const last = new Map<string, boolean>();
  for (const event of events) last.set(event.itemId, event.group);
  const held = new Set<string>();
  for (const [itemId, group] of last) {
    const item = data.entities[itemId];
    if (group && item?.kind === 'item' && item.item.holderId === null) held.add(itemId);
  }
  groupCache.set(data, held);
  return held;
}

/** Je Spielstand einmal gerechnet – der Spielstand ändert sich nie, er wird ersetzt. */
const groupCache = new WeakMap<CampaignData, Set<string>>();

export interface Sellable {
  entity: Item;
  /** Der Gefährte, der es hat; null = die Gruppe. */
  ownerId: string | null;
  /** Was der Laden zahlt; null = ohne Listenpreis. */
  price: number | null;
  /** Der Laden kauft so etwas an. */
  wanted: boolean;
}

/** Was die Gruppe und ihre Gefährten verkaufen könnten: ihre Gegenstände der Welt. */
export function sellables(data: CampaignData, shop: Shop | null): Sellable[] {
  const party = new Set(
    Object.values(data.entities)
      .filter((e) => e.kind === 'character' && e.character.active)
      .map((e) => e.id),
  );
  const group = groupItems(data);
  const out: Sellable[] = [];
  for (const entity of Object.values(data.entities)) {
    if (entity.kind !== 'item') continue;
    const holder = entity.item.holderId === PARTY_ID ? null : entity.item.holderId;
    const owned = holder
      ? party.has(holder)
      : entity.item.holderId === PARTY_ID || group.has(entity.id);
    if (!owned) continue;
    out.push({
      entity,
      ownerId: holder,
      price: sellPrice(shop, entity),
      wanted: buysThing(shop, entity),
    });
  }
  return out.sort(
    (a, b) =>
      Number(b.wanted) - Number(a.wanted) ||
      entityName(data, a.ownerId).localeCompare(entityName(data, b.ownerId), 'de') ||
      a.entity.name.localeCompare(b.entity.name, 'de'),
  );
}

// ── Handel ─────────────────────────────────────────────────────────────────

/** Eine Zeile, wie sie in den Korb kommt. */
export interface TradeLineInput {
  entityId?: string | null;
  text?: string;
  qty?: number;
  /** Stückpreis in Gold. */
  price: number;
  /** Die Zeile des Bestands; ohne Angabe die des Eintrags, wenn es eine gibt. */
  stockId?: string | null;
}

/** Was beim Festhalten eines Handels angegeben wird (`recordEntry` mit `trade`). */
export interface TradeInput {
  shopId?: string | null;
  direction: TradeDirection;
  /** Der Gefährte, der kauft oder verkauft; null = die Gruppe. */
  toId?: string | null;
  lines: TradeLineInput[];
}

export type TradeData = NonNullable<ChronicleEntry['trade']>;

/** Die Summe eines Korbs. */
export const tradeTotal = (lines: readonly { qty?: number; price: number }[]): number =>
  roundGold(lines.reduce((sum, line) => sum + (line.qty ?? 1) * line.price, 0));

/**
 * Prüft einen Handel und stellt ihn zusammen: welche Zeile des Bestands, ob ein einzelnes Stück
 * den Besitzer wechselt (und bei wem es vorher war), die Summe, die Beteiligten und der Ort des
 * Ladens. Schreibt nichts.
 */
export function planTrade(
  data: CampaignData,
  input: TradeInput,
): { problem: string } | { trade: TradeData; refs: string[]; placeId: string | null } {
  const shop = input.shopId ? data.shops[input.shopId] : null;
  if (input.shopId && !shop) return { problem: 'Diesen Laden gibt es nicht mehr.' };
  const toId = input.toId ?? null;
  if (toId && data.entities[toId]?.kind !== 'character')
    return { problem: 'Kaufen und verkaufen kann ein Gefährte oder die Gruppe.' };
  const buying = input.direction === 'buy';
  if (!input.lines.length) return { problem: buying ? 'Was wird gekauft?' : 'Was wird verkauft?' };

  const lines: TradeLine[] = [];
  const taken = new Map<string, number>();
  for (const raw of input.lines) {
    const qty = raw.qty ?? 1;
    if (!Number.isInteger(qty) || qty < 1) return { problem: 'Die Menge ist keine ganze Zahl.' };
    if (!Number.isFinite(raw.price) || raw.price < 0) return { problem: 'Ein Preis ist ungültig.' };
    const found = raw.entityId ? data.entities[raw.entityId] : undefined;
    const entity = found && isTradeKind(found.kind) ? found : undefined;
    const text = (raw.text ?? '').replace(/\s+/g, ' ').trim() || entity?.name || '';
    if (!text) return { problem: 'Eine Zeile hat keinen Namen.' };
    const line: TradeLine = {
      entityId: entity?.id ?? null,
      text,
      qty,
      price: roundGold(raw.price),
      stockId: null,
      stockAdded: false,
      claimed: false,
      holderBefore: null,
    };
    // Die Zeile des Bestands: die angegebene, sonst die des Eintrags.
    const stock =
      shop &&
      (raw.stockId
        ? shop.stock.find((s) => s.id === raw.stockId)
        : entity
          ? shop.stock.find((s) => s.entityId === entity.id)
          : undefined);
    if (raw.stockId && !stock) return { problem: `${text} gibt es im Laden nicht mehr.` };
    if (stock) line.stockId = stock.id;
    if (buying && stock && stock.qty !== null) {
      const want = (taken.get(stock.id) ?? 0) + qty;
      if (want > stock.qty)
        return {
          problem: stock.qty
            ? `Von ${text} ${stock.qty === 1 ? 'ist nur noch eins' : `sind nur noch ${stock.qty}`} da.`
            : `${text} ist ausverkauft.`,
        };
      taken.set(stock.id, want);
    }
    if (entity && isSingleItem(data, entity)) {
      if (qty > 1) return { problem: `${text} ist ein einzelnes Stück.` };
      const holder = entity.kind === 'item' ? entity.item.holderId : null;
      const has = partyHolder(data, entity);
      if (buying && has)
        return {
          problem: `${text} gehört schon ${has === PARTY_ID ? 'der Gruppe' : entityName(data, has)}.`,
        };
      line.claimed = true;
      line.holderBefore = holder;
      // Ein einzelnes Stück, das der Laden noch nicht führt, liegt danach in seinem Bestand.
      if (!buying && shop && !stock) {
        line.stockId = newId();
        line.stockAdded = true;
      }
    }
    lines.push(line);
  }

  const refs = [
    toId,
    shop?.keeperId && data.entities[shop.keeperId] ? shop.keeperId : null,
    ...lines.map((line) => line.entityId),
  ].filter((id, i, all): id is string => !!id && all.indexOf(id) === i);
  return {
    trade: {
      shopId: shop?.id ?? null,
      direction: input.direction,
      toId,
      lines,
      total: tradeTotal(lines),
    },
    refs,
    placeId: shop ? shopPlaceId(data, shop) : null,
  };
}

/**
 * Der Bestand nach einem Handel (`undo`: vor ihm). Gekauftes geht aus dem Bestand, Verkauftes
 * kommt hinein – nur, wo der Laden die Menge zählt. Nie unter null.
 */
export function stockAfter(
  stock: readonly ShopStock[],
  trade: Pick<TradeData, 'direction' | 'lines'>,
  undo = false,
): ShopStock[] {
  let next = stock.map((line) => ({ ...line }));
  const sign = (trade.direction === 'buy' ? -1 : 1) * (undo ? -1 : 1);
  for (const line of trade.lines) {
    if (!line.stockId) continue;
    if (line.stockAdded) {
      if (!undo && !next.some((s) => s.id === line.stockId))
        next.push({
          id: line.stockId,
          entityId: line.entityId,
          text: line.text,
          price: null,
          qty: line.qty,
        });
      else if (undo) next = next.filter((s) => s.id !== line.stockId);
      continue;
    }
    const target = next.find((s) => s.id === line.stockId);
    if (target && target.qty !== null) target.qty = Math.max(0, target.qty + sign * line.qty);
  }
  return next;
}

/** Bei wem ein einzelnes Stück nach dem Handel ist: beim Käufer – oder beim Händler, sonst im Laden. */
export function holderAfter(data: CampaignData, trade: TradeData): string | null {
  if (trade.direction === 'buy') return trade.toId;
  const shop = trade.shopId ? data.shops[trade.shopId] : undefined;
  if (!shop) return null;
  if (shop.keeperId && data.entities[shop.keeperId]) return shop.keeperId;
  return shopPlaceId(data, shop);
}

/** Die Waren eines Handels in einer Zeile: „2× Seil (15 m), Heiltrank“. */
export function tradeGoods(trade: Pick<TradeData, 'lines'>): string {
  return trade.lines
    .map((line) => (line.qty > 1 ? `${line.qty}× ${line.text}` : line.text))
    .join(', ');
}

/** Die Kopfzeile eines Handels: „Mira kauft bei Schmiede · Brann Eichwald: Dolch · 2 GM“. */
export function tradeHeadline(data: CampaignData, entry: ChronicleEntry): string {
  const trade = entry.trade;
  if (!trade) return '';
  const who = trade.toId ? entityName(data, trade.toId) : 'Die Gruppe';
  const shop = trade.shopId ? data.shops[trade.shopId] : undefined;
  const at = shop ? ` ${trade.direction === 'buy' ? 'bei' : 'an'} ${shopTitle(data, shop)}` : '';
  const verb = trade.direction === 'buy' ? 'kauft' : 'verkauft';
  const goods = tradeGoods(trade);
  return `${who} ${verb}${at}${goods ? `: ${goods}` : ''} · ${formatPrice(trade.total)}`;
}

/** Was ein Laden verkauft und angekauft hat, das Jüngste zuerst – aus der Chronik. */
export function shopTrades(data: CampaignData, shopId: string): ChronicleEntry[] {
  return chronicleSorted(data)
    .filter((entry) => entry.kind === 'trade' && entry.trade?.shopId === shopId)
    .reverse();
}

export interface TradeTotals {
  /** Was die Gruppe beim Handel ausgegeben und eingenommen hat. */
  spent: number;
  earned: number;
  /** Der Saldo je Gefährte (null = die Gruppe): Einnahmen minus Ausgaben. */
  net: Map<string | null, number>;
}

/** Was die Gruppe beim Handel ausgegeben und eingenommen hat – aus der Chronik. */
export function tradeTotals(data: CampaignData): TradeTotals {
  let spent = 0;
  let earned = 0;
  const net = new Map<string | null, number>();
  for (const entry of Object.values(data.chronicle)) {
    const trade = entry.kind === 'trade' ? entry.trade : null;
    if (!trade) continue;
    const signed = trade.direction === 'buy' ? -trade.total : trade.total;
    if (signed < 0) spent += -signed;
    else earned += signed;
    net.set(trade.toId, roundGold((net.get(trade.toId) ?? 0) + signed));
  }
  return { spent: roundGold(spent), earned: roundGold(earned), net };
}

// ── Vorschläge ─────────────────────────────────────────────────────────────

/** Wörter in der Art eines Ladens, die sagen, was aus der Natur er führt. */
const SHOP_NATURE: { kind: NatureKind; words: string[] }[] = [
  {
    kind: 'plant',
    words: [
      'kraut',
      'krauter',
      'heil',
      'apothek',
      'alchem',
      'arznei',
      'salb',
      'blume',
      'garten',
      'pflanz',
      'samen',
      'gewurz',
      'bader',
      'tee',
    ],
  },
  {
    kind: 'mineral',
    words: [
      'juwel',
      'edelstein',
      'stein',
      'erz',
      'berg',
      'mine',
      'schmied',
      'schmuck',
      'salz',
      'gold',
      'silber',
    ],
  },
  {
    kind: 'animal',
    words: [
      'jager',
      'jagd',
      'pelz',
      'fell',
      'kurschner',
      'gerber',
      'leder',
      'metzger',
      'fleisch',
      'vieh',
      'stall',
      'tierhand',
      'fisch',
    ],
  },
];

export interface ShopSuggestion {
  entity: Entity;
  /** Der Preis im Laden (Listenpreis mal Faktor); null = ohne Listenpreis. */
  price: number | null;
  /** Warum: „wächst in Hohenfurt“, „Einordnung Waffe“. */
  reason: string;
}

/**
 * Was zum Bestand passen könnte – nur aus den Einträgen des Spielleiters, nie erfunden: Pflanzen,
 * Gesteine und Tiere, die am Ort des Ladens vorkommen, wenn die Art des Ladens sie nennt
 * (Kräuterhändler → Pflanzen, Juwelier → Gesteine, Kürschner → Tiere), und Einträge, deren
 * Einordnung zur Art oder zum Ankauf des Ladens passt. Ohne das, was er schon führt, und ohne
 * einzelne Stücke, die jemand anderem gehören.
 */
export function shopSuggestions(data: CampaignData, shop: Shop): ShopSuggestion[] {
  const own = new Set(shop.stock.map((line) => line.entityId).filter(Boolean));
  const words = [shop.kind, shop.title].map(plainWord).join(' ');
  const kinds = new Set(
    SHOP_NATURE.filter((rule) => rule.words.some((word) => words.includes(word))).map(
      (rule) => rule.kind,
    ),
  );
  const wants = [shop.kind, ...shop.buys].map(plainWord).filter((w) => w.length >= 3);
  const fits = (category: string) => {
    const c = plainWord(category);
    return c.length >= 3 && wants.some((want) => want.includes(c) || c.includes(want));
  };
  const out: ShopSuggestion[] = [];
  const add = (entity: Entity, reason: string) => {
    if (own.has(entity.id) || out.some((s) => s.entity.id === entity.id)) return;
    const list = listPrice(entity);
    out.push({
      entity,
      price: list === null ? null : roundGold(list * shop.priceFactor),
      reason,
    });
  };
  for (const hit of natureHere(data, shopPlaceId(data, shop))) {
    const category = natureOf(hit.entity).category;
    if (kinds.has(hit.entity.kind) || fits(category)) add(hit.entity, hit.reasons[0]!.text);
  }
  const items = Object.values(data.entities)
    .filter((entity): entity is Item => entity.kind === 'item' && fits(entity.item.category))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  for (const item of items) {
    const holder = item.item.holderId;
    if (isSingleItem(data, item) && holder !== shop.keeperId) continue;
    add(item, `Einordnung „${item.item.category.trim()}“`);
  }
  return out;
}

/** Der Eintrag mit neuem Listenpreis – bei Gegenständen, Pflanzen, Tieren und Gesteinen. */
export function withListPrice<E extends Entity>(entity: E, price: number | null): E {
  if (entity.kind === 'item') return { ...entity, item: { ...entity.item, price } };
  if (entity.kind === 'plant') return { ...entity, plant: { ...entity.plant, price } };
  if (entity.kind === 'animal') return { ...entity, animal: { ...entity.animal, price } };
  if (entity.kind === 'mineral') return { ...entity, mineral: { ...entity.mineral, price } };
  return entity;
}

/** Wörter in Rolle oder Beruf einer Person, die sagen: Sie verkauft etwas. */
const TRADER_WORDS = [
  'handl',
  'kramer',
  'kaufmann',
  'kauffrau',
  'verkauf',
  'schmied',
  'wirt',
  'apothek',
  'backer',
  'metzger',
  'schneider',
  'juwel',
  'kurschner',
  'gerber',
  'marketend',
  'hoker',
  'trodler',
  'alchemist',
];

/**
 * Sieht die Person nach jemandem aus, der etwas verkauft – nach ihrer Rolle und ihren Berufen?
 * Dann bietet ihre Seite an, einen Laden anzulegen.
 */
export function looksLikeTrader(data: CampaignData, entity: Entity): boolean {
  if (entity.kind !== 'person') return false;
  const professions = Object.values(data.relations)
    .filter((r) => r.from === entity.id && r.type === 'practises' && !r.ended)
    .map((r) => data.entities[r.to]?.name ?? '');
  const words = [entity.person.role, ...professions].map(plainWord).join(' ');
  return TRADER_WORDS.some((word) => words.includes(word));
}
