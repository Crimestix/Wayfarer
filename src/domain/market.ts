/**
 * Handelsplätze: Märkte, Häfen, Auktionshäuser, Hehler – Orte, an denen die Gruppe vor allem
 * verkauft. Ein Laden wird zum Handelsplatz durch einen Schalter (`shop.market`); was dort
 * gesucht ist oder nicht gefragt, schreibt der Spielleiter als Hinweis (`shop.demand`), und beim
 * Versteigern würfelt Wayfarer das Höchstgebot nach fester Regel mit echtem Zufall. Alles davon
 * ist ein Vorschlag: Am Tisch gilt der Preis, den der Spielleiter nennt. Reine Funktionen.
 */
import { KIND_LABEL, normalize } from './derive';
import { isNature, natureOf } from './nature';
import { roundGold } from './priceList';
import type { Entity, Rarity, Shop, ShopDemand } from './schema';

/** Kleinbuchstaben ohne Akzente, „ß“ als „ss“, alles andere als Leerzeichen. */
export const plainWord = (text: string): string =>
  normalize(text)
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// ── Handelsplatz ───────────────────────────────────────────────────────────

/** Wörter in Art oder Name, die nach einem Handelsplatz klingen. */
const MARKET_STEMS = [
  'markt',
  'hafen',
  'auktion',
  'versteiger',
  'hehler',
  'basar',
  'bazar',
  'messe',
  'borse',
  'kontor',
  'handelsposten',
  'umschlagplatz',
  'tauschplatz',
  'anleger',
  'pfandleih',
];

/**
 * Klingt die Art oder der Name nach einem Handelsplatz („Markt“, „Hafen“, „Auktionshaus“,
 * „Hehler“)? Nur ein Hinweis beim Anlegen – den Schalter setzt der Spielleiter.
 */
export function looksLikeMarket(...texts: string[]): boolean {
  const words = texts.map(plainWord).join(' ');
  return MARKET_STEMS.some((stem) => words.includes(stem));
}

/** Klingt es nach einem Auktionshaus? Dann steht „Versteigern“ dort besonders nahe. */
export const looksLikeAuction = (...texts: string[]): boolean =>
  /auktion|versteiger/.test(texts.map(plainWord).join(' '));

// ── Gesucht und nicht gefragt ──────────────────────────────────────────────

/**
 * Liest einen Auf- oder Abschlag: „+50 %“ → 1,5; „−30 %“ → 0,7; „50 %“ → 1,5 (ohne Zeichen ein
 * Aufschlag); „x2“ oder „×1,5“ als Faktor. null = unlesbar oder nicht über null.
 */
export function readDemandFactor(text: string): number | null {
  const t = text.replace(/\s+/g, '').replace('−', '-').replace('–', '-');
  const times = /^[x×*](\d+(?:[.,]\d+)?)$/i.exec(t);
  if (times) {
    const value = Number(times[1]!.replace(',', '.'));
    return value > 0 && value <= 20 ? value : null;
  }
  const match = /^([+-])?(\d+(?:[.,]\d+)?)%?$/.exec(t);
  if (!match) return null;
  const amount = Number(match[2]!.replace(',', '.')) / 100;
  const factor = match[1] === '-' ? 1 - amount : 1 + amount;
  return Number.isFinite(factor) && factor > 0 && factor <= 20
    ? Math.round(factor * 100) / 100
    : null;
}

/** Ein Faktor als Auf- oder Abschlag: „+50 %“, „−30 %“, „±0 %“. */
export function demandText(factor: number): string {
  const percent = Math.round((factor - 1) * 100);
  if (percent === 0) return '±0 %';
  return `${percent > 0 ? '+' : '−'}${Math.abs(percent).toLocaleString('de-DE')} %`;
}

/** Was eine Ware ausmacht, wenn man nach Gesuchtem fragt: Name, Einordnung, Art. */
export interface DemandThing {
  name: string;
  category?: string;
  kind?: string;
}

/** Die Wörter einer Ware, wie sie zu Gesuchtem passen – aus einem Eintrag der Welt. */
export function demandThingOf(entity: Entity | null | undefined, name = ''): DemandThing {
  if (!entity) return { name };
  const category =
    entity.kind === 'item'
      ? entity.item.category
      : isNature(entity)
        ? natureOf(entity).category
        : '';
  return { name: name || entity.name, category, kind: KIND_LABEL[entity.kind] };
}

/**
 * Was ein Handelsplatz zu einer Ware sagt: die Zeile unter „Gesucht“ oder „Nicht gefragt“, die
 * passt – ein Wort des Spielleiters, das im Namen, in der Einordnung oder in der Art steht
 * („Salz“ passt auf „Steinsalz“). Der Name zählt vor Einordnung und Art. null = keine passt.
 */
export function demandOf(shop: Shop | null | undefined, thing: DemandThing): ShopDemand | null {
  if (!shop?.demand.length) return null;
  const fields = [thing.name, thing.category ?? '', thing.kind ?? ''].map(plainWord);
  for (const field of fields) {
    if (!field) continue;
    const hit = shop.demand.find((line) => {
      const want = plainWord(line.text);
      return want.length >= 2 && (field === want || field.includes(want));
    });
    if (hit) return hit;
  }
  return null;
}

/** Gesucht (Faktor über 1) oder nicht gefragt (unter 1)? */
export const isWanted = (line: ShopDemand): boolean => line.factor >= 1;

// ── Handelsgüter ───────────────────────────────────────────────────────────

/**
 * Ein Handelsgut: Pflanze, Tier oder Gestein der Welt – Ware, die nach Gewicht, Sack oder Stück
 * gehandelt wird. Nach den Regeln behalten Handelsgüter auf dem Markt ihren vollen Wert
 * (anders als gebrauchte Ausrüstung, die die Hälfte bringt).
 */
export const isTradeGood = (entity: Entity | null | undefined): boolean =>
  isNature(entity ?? undefined);

/**
 * Der Anteil am Wert, den ein Laden beim Ankauf zahlt: sein Ankauf – auf einem Handelsplatz für
 * Handelsgüter der volle Wert (oder mehr, wenn er sonst mehr zahlt) –, mal dem, was dort gesucht
 * oder nicht gefragt ist. Ohne Laden die Hälfte.
 */
export function buyShare(
  shop: Shop | null | undefined,
  entity: Entity | null | undefined,
  name = '',
): number {
  const base = shop?.buyFactor ?? 0.5;
  const share = shop?.market && isTradeGood(entity) ? Math.max(1, base) : base;
  const demand = demandOf(shop, demandThingOf(entity, name));
  return share * (demand?.factor ?? 1);
}

// ── Versteigern ────────────────────────────────────────────────────────────

/** Eine Zahl von 1 bis `sides` – am Tisch echter Zufall (`fairDie`), in Tests eingespeist. */
export type Die = (sides: number) => number;

/** Seltenes wird breiter geboten: von selten an. */
export const isWideRarity = (rarity: Rarity | '' | null | undefined): boolean =>
  rarity === 'rare' || rarity === 'very-rare' || rarity === 'legendary';

/** Die Seltenheit eines Eintrags: Pflanze, Tier, Gestein – oder ein magischer Gegenstand. */
export function rarityOf(entity: Entity | null | undefined): Rarity | '' {
  if (!entity) return '';
  if (isNature(entity)) return natureOf(entity).rarity;
  if (entity.kind === 'item') return entity.item.recipe?.rarity ?? '';
  return '';
}

/** In welchen Schritten geboten wird: Kupfer, Silber, ein Gold, fünf Gold … nach der Höhe. */
export function bidStep(value: number): number {
  if (value < 1) return 0.01;
  if (value < 10) return 0.1;
  if (value < 100) return 1;
  if (value < 1000) return 5;
  if (value < 10000) return 50;
  return 500;
}

export interface AuctionBid {
  /** Die vier Würfel (W6). */
  dice: number[];
  /** Das Höchstgebot im Verhältnis zum Wert: 0,5 bis 1,5 (selten: 0,25 bis 1,75). */
  share: number;
  /** Das Höchstgebot in Gold, auf Schritte gerundet. */
  bid: number;
  /** Der Rahmen, in dem geboten werden kann. */
  low: number;
  high: number;
  /** Breiter Rahmen (seltene Dinge). */
  wide: boolean;
}

/** Wie weit ein Augenpunkt über oder unter der Mitte das Gebot verschiebt. */
const AUCTION_STEP = { normal: 0.05, wide: 0.075 } as const;
const AUCTION_DICE = 4;
const AUCTION_MIDDLE = 14;

/** Rundet auf den nächsten Schritt des Bietens – nie auf null, wenn etwas geboten wird. */
function toStep(gold: number): number {
  if (gold <= 0) return 0;
  const step = bidStep(gold);
  return roundGold(Math.max(step, Math.round(gold / step) * step));
}

/**
 * Das Höchstgebot einer Versteigerung – feste Regel, echter Zufall: vier W6 (4 bis 24, die Mitte
 * 14 ist der Wert). Jeder Augenpunkt über oder unter der Mitte macht 5 % mehr oder weniger, so
 * liegt das Gebot zwischen der Hälfte und dem Anderthalbfachen des Werts, meist nahe am Wert.
 * Bei seltenen Dingen (`wide`) sind es 7,5 % je Punkt: ein Viertel bis sieben Viertel. Gerundet
 * auf die Schritte, in denen geboten wird (`bidStep`). Nur ein Vorschlag.
 */
export function auctionBid(worth: number, wide: boolean, die: Die): AuctionBid {
  const dice = Array.from({ length: AUCTION_DICE }, () => die(6));
  const sum = dice.reduce((a, b) => a + b, 0);
  const step = wide ? AUCTION_STEP.wide : AUCTION_STEP.normal;
  const share = Math.round((1 + (sum - AUCTION_MIDDLE) * step) * 1000) / 1000;
  const spread = (AUCTION_MIDDLE - AUCTION_DICE) * step;
  const value = Math.max(0, worth);
  return {
    dice,
    share,
    bid: toStep(value * share),
    low: toStep(value * (1 - spread)),
    high: toStep(value * (1 + spread)),
    wide,
  };
}

/** Ein Gebot in Worten: „4 W6: 3, 5, 6, 2 → 80 % des Werts“. */
export function auctionDetail(result: AuctionBid): string {
  return `4 W6: ${result.dice.join(', ')} → ${Math.round(result.share * 100).toLocaleString('de-DE')} % des Werts`;
}
