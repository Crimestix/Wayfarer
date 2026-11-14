/**
 * Eine Preisliste, wie der Spielleiter sie schreibt oder einfügt: je Zeile ein Ding und sein
 * Preis – „Seil (15 m): 1 GM“, „Heiltrank – 50 Gold“, „Pfeile (20) ... 1 GM 5 SM“. Wayfarer liest
 * nur, was dasteht: Name, Preis in Gold (Platin, Gold, Elektrum, Silber, Kupfer, ausgeschrieben
 * oder abgekürzt, deutsch oder englisch), eine Menge, und Überschriften als Einordnung der
 * Zeilen darunter. Danach sucht es zu jeder Zeile den Eintrag der Welt gleichen Namens – nie
 * wird ein Name ein zweites Mal angelegt. Reine Funktionen; angelegt wird nur nach Bestätigung
 * (`features/laden/actions.ts`).
 */
import { KIND_LABEL } from './derive';
import type { CampaignData, Entity, EntityKind } from './schema';
import { srdMatch, type SrdItem } from './srd/lookup';

// ── Münzen ─────────────────────────────────────────────────────────────────

/** Kleinbuchstaben ohne Akzente; „ß“ wird „ss“. */
function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Wie viel Gold eine Münze wert ist – nach ihren Namen und Abkürzungen. */
const COINS: { value: number; pattern: RegExp }[] = [
  { value: 10, pattern: /^(pm|pp|pt|platin\w*)$/ },
  { value: 1, pattern: /^(gm|gp|g|gs|gold\w*)$/ },
  { value: 0.5, pattern: /^(em|ep|elektrum\w*|electrum\w*)$/ },
  { value: 0.1, pattern: /^(sm|sp|s|ss|silber\w*|silver\w*)$/ },
  { value: 0.01, pattern: /^(km|cp|k|ks|kupfer\w*|copper\w*|heller\w*)$/ },
];

const coinValue = (unit: string): number | null =>
  COINS.find((coin) => coin.pattern.test(unit))?.value ?? null;

/** Eine Zahl in deutscher oder englischer Schreibweise: „12“, „2,5“, „1.250“, „1.250,5“, „0.5“. */
function readAmount(raw: string): number | null {
  const text = raw.replace(/\s+/g, '');
  let normal: string;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) normal = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d+$/.test(text)) normal = text.replace(',', '.');
  else if (/^\d+(\.\d+)?$/.test(text)) normal = text;
  else return null;
  const value = Number(normal);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Auf ein Kupferstück genau. */
export const roundGold = (gold: number): number => Math.round(gold * 100) / 100;

/**
 * Liest einen Preis in Gold: „12“, „2,5 GM“, „5 Silber“, „1 GM 5 SM“, „1 Gold und 2 Kupfer“,
 * „50gp“. Eine Zahl ohne Münze ist Gold. Leer = null, Unlesbares = undefined.
 */
export function parseCoins(text: string): number | null | undefined {
  let rest = plain(text).replace(/\.$/, '');
  if (!rest) return null;
  let total = 0;
  let parts = 0;
  while (rest) {
    const match = /^(\d[\d.,]*)\s*([a-z]*)\.?\s*(?:,|\+|und|and|&)?\s*/.exec(rest);
    if (!match || !match[0]) return undefined;
    const amount = readAmount(match[1]!.replace(/[.,]$/, ''));
    if (amount === null) return undefined;
    const unit = match[2] ?? '';
    const value = unit ? coinValue(unit) : 1;
    if (value === null) return undefined;
    total += amount * value;
    parts++;
    rest = rest.slice(match[0].length);
  }
  return parts ? roundGold(total) : undefined;
}

// ── Zeilen ─────────────────────────────────────────────────────────────────

export interface PriceLine {
  /** Zeile im Text (1-basiert). */
  line: number;
  /** Der Name, wie er dasteht: „Seil (15 m)“. */
  name: string;
  /** Der Preis in Gold; null = steht keiner da. */
  price: number | null;
  /** Wie viele vorrätig sind; null = nicht angegeben. */
  qty: number | null;
  /** Die Einheit hinter dem Preis: „je Pfund“, „je Sack“; leer = je Stück. */
  unit: string;
  /** Die Überschrift darüber („Waffen“) – Einordnung neuer Gegenstände. */
  category: string;
}

export interface PriceListReading {
  lines: PriceLine[];
  /** Zeilen, in denen ein Preis stehen sollte, den Wayfarer nicht lesen kann. */
  unreadable: { line: number; text: string }[];
}

/** Aufzählungszeichen und Nummern am Zeilenanfang. */
const BULLET = /^(?:[-*•·–—]\s+|\d+[.)]\s+)/;
/** „3×“ oder „3 x“ vor dem Namen. */
const LEADING_QTY = /^(\d+)\s*[x×]\s+/i;
/** Menge hinter dem Preis: „(3)“, „(3 Stück)“, „3 Stück“, „× 3“, „3 vorrätig“. */
const TRAILING_QTY =
  /\s*(?:\(\s*(\d+)\s*(?:stuck|stk\.?|vorratig|da)?\s*\)|[x×]\s*(\d+)|,?\s*(\d+)\s*(?:stuck|stk\.?|vorratig))\s*$/;
/** Was nach einem Preis die Einheit nennt: „je Stück“, „pro Bund“, „das Pfund“. */
const PER = /\s*(?:\/|je|pro|per|das|die|der|each)\s+([\p{L} ]+)$/u;

/** Die Einheit hinter dem Preis, wie sie in der App steht: „pro pfund“ → „je Pfund“; Stück = leer. */
function unitOf(word: string | undefined): string {
  const measure = (word ?? '').replace(/\s+/g, ' ').trim();
  if (!measure || /^(stuck|stk|each|piece)$/.test(measure)) return '';
  return `je ${measure.charAt(0).toUpperCase()}${measure.slice(1)}`;
}

/**
 * Trennt Name und Preis: Tabulator, Punkte, Gleichheitszeichen, Doppelpunkt oder Gedankenstrich.
 * `firm`: Hinter diesem Zeichen steht sicher ein Preis, wenn dort eine Zahl steht.
 */
const SEPARATORS: { pattern: RegExp; firm: boolean }[] = [
  { pattern: /\t+/g, firm: true },
  { pattern: /\s*(?:\.{2,}|…+)\s*/g, firm: true },
  { pattern: /\s*=\s*/g, firm: true },
  { pattern: /:\s*/g, firm: true },
  { pattern: /\s+[–—-]\s+/g, firm: false },
];

/**
 * Teilt eine Zeile am letzten Trennzeichen, hinter dem ein lesbarer Preis steht. 'unreadable',
 * wenn hinter einem festen Trennzeichen eine Zahl steht, die kein Preis ist; null ohne Preis.
 */
function splitAtPrice(row: string): { name: string; priceText: string } | 'unreadable' | null {
  let attempted = false;
  for (const { pattern, firm } of SEPARATORS) {
    const cuts = [...row.matchAll(pattern)].filter((m) => m.index! > 0);
    for (const cut of cuts.reverse()) {
      const right = row.slice(cut.index! + cut[0].length);
      if (readPriceText(right) !== null)
        return { name: row.slice(0, cut.index!), priceText: right };
      if (firm && /\d/.test(right)) attempted = true;
    }
  }
  return attempted ? 'unreadable' : null;
}

/** Ein Name ohne Schmuck: Fettdruck, Verweisklammern, Punkte, Doppelpunkt am Ende. */
function cleanName(text: string): string {
  return text
    .replace(/\*\*|__/g, '')
    .replace(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, '$1')
    .replace(/[\s.…:–—-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Der Preisteil einer Zeile – mit Menge und ohne „je Stück“. */
function readPriceText(text: string): { price: number; qty: number | null; unit: string } | null {
  let rest = plain(text);
  let qty: number | null = null;
  const trailing = TRAILING_QTY.exec(rest);
  if (trailing) {
    qty = Number(trailing[1] ?? trailing[2] ?? trailing[3]);
    rest = rest.slice(0, trailing.index);
  }
  const per = PER.exec(rest);
  if (per) rest = rest.slice(0, per.index).trim();
  const price = parseCoins(rest.trim());
  return typeof price === 'number' ? { price, qty, unit: unitOf(per?.[1]) } : null;
}

/** Ein Preis am Ende einer Zeile ohne Trennzeichen: „Seil 1 GM“ – nur mit Münze. */
const TAIL_PRICE =
  /^(.*\S)\s+(\d[\d.,]*\s*[\p{L}]+\.?(?:\s*(?:,|\+|und)?\s*\d[\d.,]*\s*[\p{L}]+\.?)*(?:\s*\(\s*\d+[^)]*\))?)$/u;

/** Eine Zeile einer Tabelle: „| Seil | 1 GM |“. */
function readTableRow(text: string): { name: string; priceText: string } | null {
  const cells = text
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell, i, all) => !(cell === '' && (i === 0 || i === all.length - 1)));
  if (!cells.length || cells.every((cell) => /^:?-{2,}:?$/.test(cell))) return null;
  const [name, ...rest] = cells;
  const priceText = rest.find((cell) => readPriceText(cell) !== null) ?? '';
  return { name: name ?? '', priceText };
}

/**
 * Liest eine Preisliste. Überschriften („## Waffen“, „Waffen:“, „**Waffen**“) gelten als
 * Einordnung der Zeilen darunter; Zeilen ohne lesbaren Preis zählen mit Preis null, wenn sie
 * keinen Preis versuchen – sonst stehen sie unter `unreadable`.
 */
export function parsePriceLines(text: string): PriceListReading {
  const lines: PriceLine[] = [];
  const unreadable: PriceListReading['unreadable'] = [];
  let category = '';
  text.split(/\r?\n/).forEach((raw, index) => {
    const number = index + 1;
    let row = raw.trim();
    if (!row) return;
    // Überschriften
    const heading = /^#{1,6}\s+(.+)$/.exec(row) ?? /^\*\*([^*]+)\*\*:?$/.exec(row);
    if (heading) {
      category = cleanName(heading[1]!);
      return;
    }
    if (/^[^\d:|]+:$/.test(row) && !BULLET.test(row)) {
      category = cleanName(row);
      return;
    }
    let name = '';
    let priceText = '';
    if (row.startsWith('|')) {
      const cells = readTableRow(row);
      if (!cells) return;
      name = cells.name;
      priceText = cells.priceText;
      // Kopfzeile einer Tabelle: „| Ware | Preis |“
      if (!priceText && /^(ware|gegenstand|name|artikel|ding)$/i.test(cleanName(name))) return;
    } else {
      row = row.replace(BULLET, '');
      const split = splitAtPrice(row);
      if (split === 'unreadable') {
        unreadable.push({ line: number, text: raw.trim() });
        return;
      }
      if (split) {
        name = split.name;
        priceText = split.priceText;
      } else {
        const tail = TAIL_PRICE.exec(row);
        const reading = tail ? readPriceText(tail[2]!) : null;
        if (tail && reading) {
          name = tail[1]!;
          priceText = tail[2]!;
        } else name = row;
      }
    }
    let qty: number | null = null;
    const leading = LEADING_QTY.exec(name.trim());
    if (leading) {
      qty = Number(leading[1]);
      name = name.trim().slice(leading[0].length);
    }
    const reading = priceText ? readPriceText(priceText) : null;
    const clean = cleanName(name);
    if (!clean) return;
    lines.push({
      line: number,
      name: clean,
      price: reading?.price ?? null,
      qty: reading?.qty ?? qty,
      unit: reading?.unit ?? '',
      category,
    });
  });
  return { lines, unreadable };
}

// ── Einträge der Welt ──────────────────────────────────────────────────────

/** Was man kaufen und verkaufen kann: Gegenstände, Pflanzen, Tiere, Gesteine. */
export const TRADE_KINDS = ['item', 'plant', 'animal', 'mineral'] as const;
export type TradeKind = (typeof TRADE_KINDS)[number];
export const isTradeKind = (kind: EntityKind): kind is TradeKind =>
  (TRADE_KINDS as readonly string[]).includes(kind);

/** Ein Name zum Vergleichen: ohne Groß- und Kleinschreibung, Akzente und doppelte Leerzeichen. */
export const nameKey = (name: string): string => plain(name);

/** „Seil (15 m)“ → „Seil“: der Name ohne Zusatz in Klammern. */
export const baseName = (name: string): string => name.replace(/\s*\([^)]*\)\s*$/, '').trim();

export interface PricePlan extends PriceLine {
  /** Der Eintrag der Welt, der gemeint ist; null = keiner. */
  entityId: string | null;
  /** Mehrere Einträge passen – der Spielleiter wählt; `entityId` ist der erste. */
  choices: string[];
  /** Kein Eintrag dieses Namens: Er würde als Gegenstand angelegt. */
  create: boolean;
  /** Der Name gehört schon einem Eintrag, den man nicht kaufen kann (etwa einer Person). */
  takenBy: string | null;
  /**
   * Der Gegenstand des Regelwerks (SRD 5.2.1) gleichen Namens – deutsch oder englisch. Steht kein
   * Preis da, schlägt die Vorschau seinen Preis vor (`withRulePrices`). null = keiner.
   */
  rule: SrdItem | null;
}

/**
 * Ergänzt fehlende Preise nach dem Regelwerk: Zeilen ohne Preis, deren Name einem Gegenstand des
 * SRD entspricht, bekommen dessen Preis – außer, der gemeinte Eintrag hat schon einen Listenpreis
 * (`hasPrice`). Gilt nur, wenn der Spielleiter es in der Vorschau so lässt.
 */
export function withRulePrices<P extends Pick<PricePlan, 'price' | 'rule'>>(
  plans: readonly P[],
  hasPrice: (plan: P) => boolean = () => false,
): P[] {
  return plans.map((plan) =>
    plan.price === null && plan.rule && !hasPrice(plan)
      ? { ...plan, price: plan.rule.price }
      : plan,
  );
}

/** Die Einträge gleichen Namens (oder zweiten Namens). */
function named(data: Pick<CampaignData, 'entities'>, name: string): Entity[] {
  const key = nameKey(name);
  if (!key) return [];
  return Object.values(data.entities).filter((entity) =>
    [entity.name, ...entity.aliases].some((n) => nameKey(n) === key),
  );
}

const KIND_RANK: Record<TradeKind, number> = { item: 0, plant: 1, mineral: 2, animal: 3 };

/**
 * Sucht zu jeder Zeile den Eintrag der Welt: erst nach dem ganzen Namen, dann ohne Zusatz in
 * Klammern („Seil (15 m)“ → „Seil“). Gegenstände vor Pflanzen, Gesteinen und Tieren. Wo keiner
 * passt, würde ein Gegenstand angelegt – außer, der Name gehört schon einem Eintrag anderer Art.
 */
export function planPriceLines(
  data: Pick<CampaignData, 'entities'>,
  lines: readonly PriceLine[],
): PricePlan[] {
  return lines.map((line) => {
    const names = [line.name, baseName(line.name)].filter((n, i, all) => n && all.indexOf(n) === i);
    let found: Entity[] = [];
    let other: Entity | undefined;
    for (const name of names) {
      const all = named(data, name);
      found = all.filter((entity) => isTradeKind(entity.kind));
      other ??= all.find((entity) => !isTradeKind(entity.kind));
      if (found.length) break;
    }
    found.sort(
      (a, b) =>
        KIND_RANK[a.kind as TradeKind] - KIND_RANK[b.kind as TradeKind] ||
        a.name.localeCompare(b.name, 'de'),
    );
    return {
      ...line,
      entityId: found[0]?.id ?? null,
      choices: found.map((entity) => entity.id),
      create: !found.length && !other,
      takenBy: !found.length && other ? `${other.name} (${KIND_LABEL[other.kind]})` : null,
      rule: srdMatch(line.name),
    };
  });
}
