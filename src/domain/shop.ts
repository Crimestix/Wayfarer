/**
 * Läden und Preise: was ein Ort verkauft, zu welchem Preis, und was beim Kaufen und Verkaufen
 * geschieht. Ein Laden (`shops/`) hat einen Bestand aus Einträgen der Welt oder Worten; der
 * Preis einer Ware ist ihr eigener Preis im Laden oder ihr Listenpreis mal dem Preisfaktor des
 * Ladens. Was ein Laden verkauft und angekauft hat, steht nur in der Chronik (Einträge der Art
 * „Handel“) – nie doppelt im Laden. Wayfarer rechnet und ordnet; was im Laden liegt, schreibt
 * der Spielleiter. Vorschläge für den Bestand gelten erst, wenn er sie annimmt. Nichts schränkt
 * ein: Ein Laden kann alles führen (jeden Eintrag der Welt, Wesen des Bestiariums, Regelwerk,
 * Worte), und am Tisch kauft und verkauft jeder alles – Art, Einordnung und „kauft gern“ sind
 * nur Hinweise. Reine Funktionen.
 */
import { resolveCreature } from './creature';
import {
  KIND_LABEL,
  KIND_LABEL_PLURAL,
  chronicleSorted,
  entityName,
  normalize,
  placeAncestors,
  searchEntities,
} from './derive';
import { formatGold } from './loot';
import { RARITY_VALUE_LABEL, rarityRuleItem } from './magicItem';
import { buyShare, demandOf, demandThingOf, isBeastType, plainWord } from './market';
import { isNature, natureHere, natureOf, type NatureKind } from './nature';
import { isTradeKind, nameKey, roundGold, TRADE_KINDS } from './priceList';
import { srdForShopKind, srdItem, srdMatch, srdSearch, type SrdItem } from './srd/lookup';
import {
  newId,
  PARTY_ID,
  type CampaignData,
  type ChronicleEntry,
  type Creature,
  type Entity,
  type EntityKind,
  type Item,
  type Shop,
  type ShopDemand,
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
 * Der Gegenstand des Regelwerks (SRD 5.2.1), dessen Preis für einen Eintrag ohne Listenpreis gilt:
 * bei einem magischen Gegenstand der Richtwert nach Seltenheit (`rarityRuleItem`, wie `valueOf`),
 * sonst der gleichen Namens (deutsch oder englisch, `srdMatch`). null, wenn der Eintrag einen
 * eigenen Listenpreis hat oder nichts passt.
 */
export function ruleItemOf(entity: Entity | undefined | null): SrdItem | null {
  if (!entity || !isTradeKind(entity.kind) || listPrice(entity) !== null) return null;
  return (entity.kind === 'item' ? rarityRuleItem(entity) : null) ?? srdMatch(entity.name);
}

/** Wie ein Preis aus dem Nachschlagewerk heißt: „Richtwert nach Seltenheit“ oder „Regelwerk“. */
export const ruleLabel = (rule: SrdItem): string =>
  rule.group === 'magic' ? RARITY_VALUE_LABEL : 'Regelwerk';

/** Der Listenpreis – sonst der Preis nach dem Regelwerk (`ruleItemOf`). null = keiner. */
export function listOrRulePrice(entity: Entity | undefined | null): number | null {
  return listPrice(entity) ?? ruleItemOf(entity)?.price ?? null;
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

// ── Einheiten ──────────────────────────────────────────────────────────────

/** Übliche Einheiten für Handelsgüter – zur Auswahl, jede andere geht auch. */
export const UNIT_SUGGESTIONS = [
  'je Pfund',
  'je Sack',
  'je Fass',
  'je Elle',
  'je Ballen',
  'je Kiste',
  'je Krug',
  'je Bund',
  'je Barren',
  'je Tag',
] as const;

/**
 * Eine Einheit, wie sie dasteht: „Pfund“, „pro Sack“, „/ Fass“, „das Pfund“ → „je Pfund“. Leer
 * oder „Stück“ = je Stück (leer).
 */
export function readUnit(text: string): string {
  const word = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:\/|je\s|pro\s|per\s|das\s|die\s|der\s|each\s)\s*/i, '')
    .trim();
  if (!word || /^(stuck|stück|stk\.?)$/i.test(word)) return '';
  return `je ${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/** Das Maß einer Einheit: „je Pfund“ → „Pfund“. */
export const unitMeasure = (unit: string): string => unit.replace(/^je\s+/i, '').trim();

/** Ein Preis mit Einheit: „5 KM je Pfund“. */
export const priceWithUnit = (gold: number, unit: string): string =>
  unit.trim() ? `${formatPrice(gold)} ${unit.trim()}` : formatPrice(gold);

/** Maße, die nach einer Zahl in die Mehrzahl gehen und nicht auf -e enden: „3 Tage“. */
const MEASURE_PLURAL: Record<string, string> = { Tag: 'Tage', Nacht: 'Nächte', Monat: 'Monate' };

/**
 * Ein Maß nach einer Zahl: Pfund, Sack, Fass, Ballen bleiben in der Einzahl („drei Sack Mehl“),
 * Maße auf -e gehen in die Mehrzahl („zwei Kisten“, „drei Ellen“), dazu „Tage“ und „Nächte“.
 */
function measureAfter(qty: number, measure: string): string {
  if (qty === 1 || measure.includes(' ')) return measure;
  const plural = MEASURE_PLURAL[measure];
  if (plural) return plural;
  return /[^e]e$/.test(measure) ? `${measure}n` : measure;
}

/**
 * Eine Menge einer Ware in Worten: „20 Pfund Salz“, „2 Kisten Äpfel“ (`measureAfter`), ohne
 * Einheit „3× Seil“, eins ohne Einheit nur der Name.
 */
export function amountText(qty: number, text: string, unit = ''): string {
  const measure = unitMeasure(unit);
  if (measure) return `${qty.toLocaleString('de-DE')} ${measureAfter(qty, measure)} ${text}`;
  return qty > 1 ? `${qty}× ${text}` : text;
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

/**
 * Wie der Abschnitt am Spieltisch heißt: „Läden hier“ – mit Handelsplätzen „Läden und
 * Handelsplätze hier“, nur Handelsplätze „Handelsplatz hier“ / „Handelsplätze hier“.
 */
export function shopsHereTitle(shops: readonly Pick<Shop, 'market'>[]): string {
  const markets = shops.filter((shop) => shop.market).length;
  if (!markets) return 'Läden hier';
  if (markets < shops.length) return 'Läden und Handelsplätze hier';
  return markets === 1 ? 'Handelsplatz hier' : 'Handelsplätze hier';
}

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
  /** Ein Wesen des Bestiariums, wenn die Zeile eins ist. */
  creature: Creature | null;
  name: string;
  /** Die Einheit des Preises: „je Pfund“; leer = je Stück. */
  unit: string;
  /** Preis in diesem Laden je Stück; null = offen. */
  price: number | null;
  /** Ein eigener Preis des Ladens statt Listenpreis mal Faktor. */
  own: boolean;
  listPrice: number | null;
  /**
   * Der Gegenstand des Regelwerks, nach dem sich der Preis richtet, wenn es keinen eigenen und
   * keinen Listenpreis gibt: übernommen (`line.srdId`) oder am Namen erkannt. Sonst null.
   */
  rule: SrdItem | null;
  /** Wie viele noch da sind; null = so viele man will. */
  qty: number | null;
  soldOut: boolean;
  /** Ein einzelnes Stück (wechselt beim Kauf den Besitzer). */
  single: boolean;
  /** Einordnung: die des Eintrags, sonst seine Art. */
  category: string;
}

/**
 * Nach welchem Gegenstand des Regelwerks sich eine Zeile richtet: der übernommene (`srdId`) – bei
 * einem Eintrag der Welt nur, solange er keinen Listenpreis hat; bei Worten ohne Eintrag der
 * Gegenstand gleichen Namens.
 */
export function stockRuleItem(data: CampaignData, line: ShopStock): SrdItem | null {
  const entity = line.entityId ? data.entities[line.entityId] : undefined;
  // Ein magischer Gegenstand richtet sich nach seiner Seltenheit – auch wenn die Zeile aus der
  // Ausrüstung gleichen Namens stammt (wie `valueOf`).
  if (entity)
    return listPrice(entity) !== null
      ? null
      : ((entity.kind === 'item' ? rarityRuleItem(entity) : null) ??
          srdItem(line.srdId) ??
          ruleItemOf(entity));
  const creature = line.creatureId ? data.creatures[line.creatureId] : undefined;
  return srdItem(line.srdId) ?? srdMatch(line.text || creature?.name || '');
}

/** Was ein Wesen des Bestiariums ist, in einem Wort: seine Art („Tier“), sonst „Wesen“. */
export function creatureCategory(
  data: Pick<CampaignData, 'creatures'>,
  creatureId: string,
): string {
  const type = resolveCreature(data.creatures, creatureId)?.block.type.trim() ?? '';
  return type || 'Wesen';
}

/** Der Preis einer Zeile des Bestands in diesem Laden – ohne eigenen Preis nach Liste oder Regelwerk. */
export function stockPrice(data: CampaignData, shop: Shop, line: ShopStock): number | null {
  if (line.price !== null) return line.price;
  const list =
    listPrice(line.entityId ? data.entities[line.entityId] : null) ??
    stockRuleItem(data, line)?.price ??
    null;
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
    const creature = (line.creatureId ? data.creatures[line.creatureId] : undefined) ?? null;
    const single = isSingleItem(data, entity);
    // Ein einzelnes Stück, das die Gruppe schon hat, liegt nicht mehr im Laden.
    const gone = single && partyHolder(data, entity) !== null;
    return {
      line,
      entity,
      creature,
      name: line.text.trim() || entity?.name || creature?.name || '',
      unit: line.unit.trim(),
      price: stockPrice(data, shop, line),
      own: line.price !== null,
      listPrice: listPrice(entity),
      rule: stockRuleItem(data, line),
      qty: gone ? 0 : single && line.qty === null ? 1 : line.qty,
      soldOut: line.qty === 0 || gone,
      single,
      category:
        tradeCategory(entity) ||
        (creature ? creatureCategory(data, creature.id) : '') ||
        stockRuleItem(data, line)?.sub ||
        '',
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
  return {
    id: newId(),
    entityId: null,
    text: '',
    price: null,
    qty: null,
    srdId: null,
    creatureId: null,
    unit: '',
    ...init,
  };
}

// ── Ankauf ─────────────────────────────────────────────────────────────────

/**
 * Kauft der Laden so etwas gern an („kauft gern …“)? Ohne Angabe: ja; Worte ohne Eintrag immer.
 * Nur ein Hinweis – angekauft wird am Tisch alles.
 */
export function buysThing(shop: Shop | null, entity: Entity | null | undefined): boolean {
  if (!shop || !shop.buys.length || !entity) return true;
  const words = [tradeCategory(entity), KIND_LABEL[entity.kind]].map(plainWord);
  return shop.buys.some((buy) => {
    const want = plainWord(buy);
    return !!want && words.some((word) => word === want || word.includes(want));
  });
}

/**
 * Was der Laden für ein Stück zahlt: Listenpreis (sonst Preis nach dem Regelwerk) mal Ankauf –
 * ohne Laden die Hälfte; auf einem Handelsplatz bringen Handelsgüter den vollen Wert, und was
 * dort gesucht oder nicht gefragt ist, schlägt auf oder ab (`buyShare`, `domain/market.ts`).
 */
export function sellPrice(shop: Shop | null, entity: Entity | null | undefined): number | null {
  const list = listOrRulePrice(entity);
  return list === null ? null : roundGold(list * buyShare(shop, entity));
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
  /** Der Laden kauft so etwas gern an (nur ein Hinweis). */
  wanted: boolean;
  /** Was der Handelsplatz dazu sagt: gesucht oder nicht gefragt; null = nichts. */
  demand: ShopDemand | null;
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
      demand: demandOf(shop, demandThingOf(entity)),
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
  /** Stückpreis in Gold (je Einheit). */
  price: number;
  /** Die Einheit: „je Pfund“; leer = je Stück. */
  unit?: string;
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
    // Jeder Eintrag der Welt lässt sich handeln – nicht nur Gegenstände, Pflanzen, Tiere, Gesteine.
    const entity = raw.entityId ? data.entities[raw.entityId] : undefined;
    const text = (raw.text ?? '').replace(/\s+/g, ' ').trim() || entity?.name || '';
    if (!text) return { problem: 'Eine Zeile hat keinen Namen.' };
    const line: TradeLine = {
      entityId: entity?.id ?? null,
      text,
      qty,
      price: roundGold(raw.price),
      unit: readUnit(raw.unit ?? ''),
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
          srdId: null,
          creatureId: null,
          unit: line.unit,
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

/** Die Waren eines Handels in einer Zeile: „2× Seil (15 m), Heiltrank, 20 Pfund Salz“. */
export function tradeGoods(trade: Pick<TradeData, 'lines'>): string {
  return trade.lines.map((line) => amountText(line.qty, line.text, line.unit)).join(', ');
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

/**
 * Wörter in der Art eines Ladens, die sagen: Er verkauft Tiere – Tierhändler, Haustiere, Stall,
 * Falkner, Zwinger. Dann schlägt Wayfarer Tiere der Welt mit Preis und Tiere des Bestiariums vor.
 */
const ANIMAL_SHOP = [
  'tierhandl',
  'tierhandel',
  'haustier',
  'tierzucht',
  'zuchter',
  'menagerie',
  'falkner',
  'zwinger',
  'viehhandl',
  'viehmarkt',
  'stall',
  'gestut',
  'pferd',
];

/** Verkauft der Laden nach seiner Art Tiere? Nur für Vorschläge – führen kann jeder alles. */
export function sellsAnimals(shop: Pick<Shop, 'kind' | 'title'>): boolean {
  const words = [shop.kind, shop.title].map(plainWord).join(' ');
  return ANIMAL_SHOP.some((stem) => words.includes(stem));
}

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
    const list = listOrRulePrice(entity);
    out.push({
      entity,
      price: list === null ? null : roundGold(list * shop.priceFactor),
      reason,
    });
  };
  const animals = sellsAnimals(shop);
  if (animals) kinds.add('animal');
  for (const hit of natureHere(data, shopPlaceId(data, shop))) {
    const category = natureOf(hit.entity).category;
    if (kinds.has(hit.entity.kind) || fits(category)) add(hit.entity, hit.reasons[0]!.text);
  }
  const byName = (a: Entity, b: Entity) => a.name.localeCompare(b.name, 'de');
  const all = Object.values(data.entities);
  const items = all
    .filter((entity): entity is Item => entity.kind === 'item' && fits(entity.item.category))
    .sort(byName);
  const notOthers = (item: Item) =>
    !isSingleItem(data, item) || item.item.holderId === shop.keeperId;
  for (const item of items) {
    if (!notOthers(item)) continue;
    add(item, `Einordnung „${item.item.category.trim()}“`);
  }
  // Einträge der Welt, die so heißen wie Ausrüstung, die zur Art passt (Regelwerk).
  const { items: ruled, labels } = srdForShopKind(shop.kind, shop.title);
  if (ruled.length) {
    const ids = new Set(ruled.map((item) => item.id));
    for (const entity of all.filter((e) => isTradeKind(e.kind)).sort(byName)) {
      if (entity.kind === 'item' && !notOthers(entity)) continue;
      const rule = srdMatch(entity.name);
      if (rule && ids.has(rule.id)) add(entity, `passt zu „${labels.join(', ')}“`);
    }
  }
  // Tierhändler, Stall, Falkner: die Tiere der Welt, die einen Preis haben.
  if (animals)
    for (const animal of all.filter((e) => e.kind === 'animal').sort(byName))
      if (listPrice(animal) !== null) add(animal, 'Tier mit Preis');
  return out;
}

export interface CreatureSuggestion {
  creature: Creature;
  /** Preis nach dem Regelwerk (gleicher Name, etwa „Mastiff“) mal Faktor; null = offen. */
  price: number | null;
  reason: string;
}

/**
 * Wesen des Bestiariums für einen Laden, der nach seiner Art Tiere verkauft (`sellsAnimals`):
 * die Tiere darin (Art „Tier“ oder „Beast“) – ohne die, die er schon führt. Nur ein Vorschlag.
 */
export function creatureSuggestions(data: CampaignData, shop: Shop): CreatureSuggestion[] {
  if (!sellsAnimals(shop)) return [];
  const have = new Set(shop.stock.map((line) => line.creatureId).filter(Boolean));
  return Object.values(data.creatures)
    .filter((creature) => !have.has(creature.id))
    .filter((creature) => isBeastType(creatureCategory(data, creature.id)))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    .map((creature) => {
      const rule = srdMatch(creature.name);
      return {
        creature,
        price: rule ? roundGold(rule.price * shop.priceFactor) : null,
        reason: 'Tier im Bestiarium',
      };
    });
}

// ── Waren wählen ───────────────────────────────────────────────────────────

/** Eine Ware zur Wahl: ein Eintrag der Welt oder ein Wesen des Bestiariums. */
export interface WareOption {
  key: string;
  entityId: string | null;
  creatureId: string | null;
  name: string;
  /** Was es ist: Einordnung, Art; bei Orten der Ort darüber. */
  sub: string;
  /** Listenpreis (sonst nach dem Regelwerk); null = keiner. */
  price: number | null;
}

export interface WareGroup {
  label: string;
  options: WareOption[];
  /** Was man gewöhnlich handelt (Gegenstände, Tiere, Pflanzen, Gesteine, Wesen) – nicht die übrigen Einträge. */
  common: boolean;
}

/** Die Reihenfolge der Gruppen: was man gewöhnlich verkauft, zuerst. */
const WARE_KIND_ORDER: readonly EntityKind[] = [...TRADE_KINDS];

/**
 * Was ein Laden führen oder am Tisch gehandelt werden kann – alles: jeder Eintrag der Welt und
 * jedes Wesen des Bestiariums. Nach Art gruppiert als Hilfe beim Finden, nie als Filter:
 * Gegenstände, Tiere, Pflanzen, Gesteine, dann die Wesen, dann alle übrigen Einträge (ein Haus,
 * ein Söldner, eine Karte …). `exclude` = Kennungen, die schon gewählt sind.
 */
export function wareGroups(
  data: CampaignData,
  query: string,
  options: { exclude?: ReadonlySet<string>; perGroup?: number } = {},
): WareGroup[] {
  const limit = options.perGroup ?? 12;
  const skip = options.exclude ?? new Set<string>();
  const q = normalize(query.trim());
  const found = searchEntities(data, query, { limit: 400 }).filter((e) => !skip.has(e.id));
  const option = (entity: Entity): WareOption => ({
    key: `entity:${entity.id}`,
    entityId: entity.id,
    creatureId: null,
    name: entity.name,
    sub:
      entity.kind === 'place' && entity.place.parentId
        ? `${KIND_LABEL.place} · ${entityName(data, entity.place.parentId)}`
        : tradeCategory(entity),
    price: listOrRulePrice(entity),
  });
  const groups: WareGroup[] = [];
  for (const kind of WARE_KIND_ORDER) {
    const options = found
      .filter((e) => e.kind === kind)
      .slice(0, limit)
      .map(option);
    if (options.length) groups.push({ label: KIND_LABEL_PLURAL[kind], options, common: true });
  }
  const creatures = Object.values(data.creatures)
    .filter((c) => !skip.has(c.id) && (!q || normalize(c.name).includes(q)))
    .sort(
      (a, b) =>
        Number(!normalize(a.name).startsWith(q)) - Number(!normalize(b.name).startsWith(q)) ||
        a.name.localeCompare(b.name, 'de'),
    )
    .slice(0, limit)
    .map((creature): WareOption => ({
      key: `creature:${creature.id}`,
      entityId: null,
      creatureId: creature.id,
      name: creature.name,
      sub: creatureCategory(data, creature.id),
      price: srdMatch(creature.name)?.price ?? null,
    }));
  if (creatures.length)
    groups.push({ label: 'Wesen des Bestiariums', options: creatures, common: true });
  const rest = found
    .filter((e) => !WARE_KIND_ORDER.includes(e.kind))
    .slice(0, limit)
    .map(option);
  if (rest.length)
    groups.push({ label: 'Weitere Einträge der Welt', options: rest, common: false });
  return groups;
}

/**
 * Was die Eingabetaste in der Wahl nimmt: die Ware genau dieses Namens, sonst die erste, die man
 * gewöhnlich handelt – nie von selbst einen Ort oder eine Person, nur weil der Name anfängt wie
 * das Getippte („Salz“ ist nicht „Salzgrotte“). null = keine; dann bleibt das Getippte in Worten.
 */
export function enterWare(groups: readonly WareGroup[], query: string): WareOption | null {
  const key = nameKey(query);
  if (!key) return null;
  const exact = groups.flatMap((g) => g.options).find((o) => nameKey(o.name) === key);
  return exact ?? groups.find((g) => g.common)?.options[0] ?? null;
}

/**
 * Gibt es schon etwas dieses Namens – ein Eintrag der Welt jeder Art (auch unter zweitem Namen)
 * oder ein Wesen des Bestiariums? Dann wird kein zweiter Eintrag gleichen Namens angelegt.
 */
export function wareNamed(
  data: Pick<CampaignData, 'entities' | 'creatures'>,
  name: string,
): { entityId: string | null; creatureId: string | null; name: string } | null {
  const key = nameKey(name);
  if (!key) return null;
  const same = Object.values(data.entities).filter((entity) =>
    [entity.name, ...entity.aliases].some((n) => nameKey(n) === key),
  );
  const entity =
    same.find((e) => e.kind === 'item') ?? same.find((e) => isTradeKind(e.kind)) ?? same[0];
  if (entity) return { entityId: entity.id, creatureId: null, name: entity.name };
  const creature = Object.values(data.creatures).find((c) => nameKey(c.name) === key);
  return creature ? { entityId: null, creatureId: creature.id, name: creature.name } : null;
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

// ── Aus dem Regelwerk ──────────────────────────────────────────────────────

/**
 * Welche Gegenstände des Regelwerks der Laden schon führt: übernommen (`srdId`), in Worten mit
 * gleichem Namen oder als Eintrag der Welt gleichen Namens – so kommt nichts doppelt hinein.
 */
export function stockedRuleIds(data: CampaignData, shop: Shop): Set<string> {
  const ids = new Set<string>();
  for (const line of shop.stock) {
    if (line.srdId) ids.add(line.srdId);
    const entity = line.entityId ? data.entities[line.entityId] : undefined;
    const named = srdMatch(entity?.name ?? line.text);
    if (named) ids.add(named.id);
  }
  return ids;
}

/** Was ein Gegenstand des Regelwerks in diesem Laden kostet: sein Preis mal Preisfaktor. */
export const rulePrice = (shop: Shop | null, item: SrdItem): number =>
  roundGold(item.price * (shop?.priceFactor ?? 1));

/**
 * Was ein Laden nach seiner Art führen könnte – aus dem Regelwerk (`srdForShopKind`), ohne das,
 * was er schon führt. Nur ein Vorschlag: In den Bestand kommt es erst, wenn der Spielleiter es
 * ankreuzt.
 */
export function ruleSuggestions(
  data: CampaignData,
  shop: Shop,
): { items: SrdItem[]; labels: string[] } {
  const { items, labels } = srdForShopKind(shop.kind, shop.title);
  const have = stockedRuleIds(data, shop);
  return { items: items.filter((item) => !have.has(item.id)), labels };
}

/**
 * Was die Suche am Tisch zusätzlich findet: Gegenstände des Regelwerks, die der Laden nicht führt –
 * erst ab zwei Buchstaben, höchstens `limit`.
 */
export function ruleHits(
  data: CampaignData,
  shop: Shop | null,
  query: string,
  limit = 8,
): SrdItem[] {
  if (normalize(query.trim()).length < 2) return [];
  const have = shop ? stockedRuleIds(data, shop) : new Set<string>();
  return srdSearch(query)
    .filter((item) => !have.has(item.id))
    .slice(0, limit);
}
