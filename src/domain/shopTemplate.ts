/**
 * Vorlagen für Ladenarten und Vorschläge für den Bestand. Die Art eines Ladens ist ein freies
 * Wort; zu einer Art kann der Spielleiter seine eigene Liste schreiben (`assortments/`, wie eine
 * Preisliste: „Langschwert: 15 GM“, „Salz: 5 KM je Pfund (20)“). Wayfarer schlägt dazu vor – aus
 * dem Regelwerk (`SHOP_KIND_RULES`), aus den Einträgen des Spielleiters (Einordnung, Name, was in
 * der Gegend wächst und lebt) und aus dem Bestiarium. Alles ist eine Liste zum Ankreuzen; in den
 * Bestand kommt nur, was der Spielleiter ankreuzt. Nichts davon schränkt ein: Eine Vorlage passt
 * zu ihrer Art, jede andere bleibt wählbar. Reine Funktionen.
 */
import { plainWord } from './market';
import { nameKey, parsePriceLines, planPriceLines, roundGold } from './priceList';
import type { CampaignData, Creature, Shop, ShopStock, ShopTemplate } from './schema';
import {
  creatureSuggestions,
  formatPrice,
  listOrRulePrice,
  rulePrice,
  ruleSuggestions,
  shopSuggestions,
  stockRows,
  stockedRuleIds,
} from './shop';

// ── Ladenarten ─────────────────────────────────────────────────────────────

/** Ein Wort ohne Endung: „Schmiede“ → „schmied“, „Händlerin“ → „handler“. */
const stem = (word: string): string => {
  const cut = word.replace(/(innen|in|en|e)$/, '');
  return cut.length >= 4 ? cut : word;
};

/** Eine Ladenart zum Vergleichen: ohne Akzente, Satzzeichen und Endungen – „Schmiede“ = „Schmied“. */
export const kindKey = (text: string): string =>
  plainWord(text).split(' ').filter(Boolean).map(stem).join(' ');

/**
 * Wie gut eine Vorlage zur Art eines Ladens passt: 0 = gleiche Art, 1 = eine steckt in der anderen
 * („Waffenschmied“ und „Schmied“), null = nicht. Nur fürs Ordnen – jede Vorlage bleibt wählbar.
 */
export function templateFit(template: Pick<ShopTemplate, 'kind'>, kind: string): 0 | 1 | null {
  const a = kindKey(template.kind);
  const b = kindKey(kind);
  if (!a || !b) return null;
  if (a === b) return 0;
  const short = a.length < b.length ? a : b;
  const long = a.length < b.length ? b : a;
  return short.length >= 4 && long.includes(short) ? 1 : null;
}

const byKind = (a: ShopTemplate, b: ShopTemplate) => a.kind.localeCompare(b.kind, 'de');

/** Die Vorlagen, die zur Art passen (die gleiche zuerst), und alle übrigen – nichts fällt weg. */
export function templatesFor(
  data: Pick<CampaignData, 'assortments'>,
  kind: string,
): { fitting: ShopTemplate[]; others: ShopTemplate[] } {
  const all = Object.values(data.assortments).sort(byKind);
  const fit = (template: ShopTemplate) => templateFit(template, kind);
  return {
    fitting: all
      .filter((template) => fit(template) !== null)
      .sort((a, b) => fit(a)! - fit(b)! || byKind(a, b)),
    others: all.filter((template) => fit(template) === null),
  };
}

/** Die Vorlage genau dieser Art; undefined = keine. */
export const templateOfKind = (
  data: Pick<CampaignData, 'assortments'>,
  kind: string,
): ShopTemplate | undefined =>
  kindKey(kind)
    ? Object.values(data.assortments).find((template) => templateFit(template, kind) === 0)
    : undefined;

// ── Vorschläge zum Ankreuzen ───────────────────────────────────────────────

export type ProposalSource = 'template' | 'world' | 'creature' | 'rule';

/** Eine Zeile zum Ankreuzen – was in den Bestand käme, mit Preis in diesem Laden und Grund. */
export interface Proposal {
  key: string;
  source: ProposalSource;
  name: string;
  line: Omit<ShopStock, 'id'>;
  /** Preis in diesem Laden (je Einheit); null = offen. */
  price: number | null;
  /** Woher: „Einordnung Waffe“, „wächst hier“, „Nahkampf-Kriegswaffe“. */
  reason: string;
  /** Der Laden führt das schon. */
  have: boolean;
}

const blankLine = (init: Partial<Omit<ShopStock, 'id'>>): Omit<ShopStock, 'id'> => ({
  entityId: null,
  text: '',
  price: null,
  qty: null,
  srdId: null,
  creatureId: null,
  unit: '',
  ...init,
});

/** Führt der Laden das schon – als Eintrag, Wesen, Gegenstand des Regelwerks oder gleichen Namens? */
export function inStock(
  data: CampaignData,
  shop: Shop,
  line: Pick<ShopStock, 'entityId' | 'creatureId' | 'srdId' | 'text'>,
): boolean {
  if (line.entityId && shop.stock.some((s) => s.entityId === line.entityId)) return true;
  if (line.creatureId && shop.stock.some((s) => s.creatureId === line.creatureId)) return true;
  if (line.srdId && stockedRuleIds(data, shop).has(line.srdId)) return true;
  const key = nameKey(line.text);
  return !!key && stockRows(data, shop).some((row) => nameKey(row.name) === key);
}

/** Ein Wesen des Bestiariums mit genau diesem Namen; undefined = keins. */
const creatureNamed = (
  data: Pick<CampaignData, 'creatures'>,
  name: string,
): Creature | undefined => {
  const key = nameKey(name);
  return key ? Object.values(data.creatures).find((c) => nameKey(c.name) === key) : undefined;
};

/**
 * Die Zeilen einer Vorlage für diesen Laden: Jeder Name findet seinen Eintrag der Welt (wie bei
 * der Preisliste), sonst ein Wesen des Bestiariums gleichen Namens, sonst den Gegenstand des
 * Regelwerks – sonst bleibt er in Worten. Ein Preis in der Vorlage ist der eigene Preis des
 * Ladens, wenn er vom Listenpreis abweicht; ohne Preis gilt Listenpreis mal Preisstufe. Legt
 * nichts an. `unreadable` = Zeilen mit einem Preis, den Wayfarer nicht lesen kann.
 */
export function templateProposals(
  data: CampaignData,
  shop: Shop,
  template: ShopTemplate,
): { proposals: Proposal[]; unreadable: { line: number; text: string }[] } {
  const reading = parsePriceLines(template.text);
  const proposals = planPriceLines(data, reading.lines).map((plan, index): Proposal => {
    const entity = plan.entityId ? data.entities[plan.entityId] : undefined;
    const creature = entity ? undefined : creatureNamed(data, plan.name);
    const rule = entity ? null : plan.rule;
    const base = entity ? listOrRulePrice(entity) : (rule?.price ?? null);
    const own = plan.price !== null && plan.price !== base ? plan.price : null;
    const line = blankLine({
      entityId: entity?.id ?? null,
      creatureId: creature?.id ?? null,
      text: entity?.name ?? creature?.name ?? plan.name,
      price: own,
      qty: plan.qty,
      srdId: !entity && !creature && rule ? rule.id : null,
      unit: plan.unit,
    });
    return {
      key: `template:${template.id}:${index}`,
      source: 'template',
      name: line.text,
      line,
      price: own ?? (base === null ? null : roundGold(base * shop.priceFactor)),
      reason: plan.category,
      have: inStock(data, shop, line),
    };
  });
  return { proposals, unreadable: reading.unreadable };
}

/**
 * „Wayfarer schlägt vor“: was zur Art des Ladens passen könnte – aus den Einträgen des
 * Spielleiters (`shopSuggestions`: Einordnung, Name, was in der Gegend wächst, lebt und vorkommt),
 * aus dem Bestiarium (bei Tierhändlern, `creatureSuggestions`) und aus dem Regelwerk
 * (`ruleSuggestions`). Ohne das, was der Laden schon führt. Nichts ist angekreuzt.
 */
export function wayfarerProposals(
  data: CampaignData,
  shop: Shop,
): { world: Proposal[]; creatures: Proposal[]; rules: Proposal[]; ruleLabels: string[] } {
  const world = shopSuggestions(data, shop).map((s): Proposal => ({
    key: `world:${s.entity.id}`,
    source: 'world',
    name: s.entity.name,
    line: blankLine({ entityId: s.entity.id, text: s.entity.name }),
    price: s.price,
    reason: s.reason,
    have: false,
  }));
  const creatures = creatureSuggestions(data, shop).map((s): Proposal => ({
    key: `creature:${s.creature.id}`,
    source: 'creature',
    name: s.creature.name,
    line: blankLine({ creatureId: s.creature.id, text: s.creature.name }),
    price: s.price,
    reason: s.reason,
    have: false,
  }));
  const ruled = ruleSuggestions(data, shop);
  const rules = ruled.items.map((item): Proposal => ({
    key: `rule:${item.id}`,
    source: 'rule',
    name: item.name,
    line: blankLine({ text: item.name, srdId: item.id }),
    price: rulePrice(shop, item),
    reason: item.sub,
    have: false,
  }));
  return { world, creatures, rules, ruleLabels: ruled.labels };
}

// ── Einen Laden als Vorlage merken ─────────────────────────────────────────

/** Ein Name, in dem ein Trennzeichen der Preisliste steht – dann braucht er einen Preis dahinter. */
const SPLITS = /[:=\t]|\.{2}|…|\s[–—-]\s/;

/**
 * Der Bestand eines Ladens als Liste für eine Vorlage – so geschrieben, wie der Spielleiter eine
 * Preisliste schreibt: „Name: eigener Preis Einheit (Menge)“. Ohne eigenen Preis steht nur der
 * Name (mit Einheit der Listenpreis, damit die Einheit bleibt), eine Menge dann vorn („3× …“).
 * Ausverkauftes zählt ohne Menge. Das ist kein Welttext – nur die Zeilen des Ladens.
 */
export function templateTextOf(data: CampaignData, shop: Shop): string {
  const out: string[] = [];
  for (const row of stockRows(data, shop)) {
    const name = row.name.trim();
    if (!name) continue;
    const base = row.listPrice ?? row.rule?.price ?? null;
    const shown = row.own
      ? row.line.price
      : row.unit || SPLITS.test(name) || row.line.qty !== null
        ? base
        : null;
    const qty = row.line.qty && row.line.qty > 0 ? row.line.qty : null;
    if (shown === null) {
      out.push(qty !== null ? `${qty}× ${name}` : name);
      continue;
    }
    const unit = row.unit ? ` ${row.unit}` : '';
    out.push(`${name}: ${formatPrice(shown)}${unit}${qty !== null ? ` (${qty})` : ''}`);
  }
  return out.join('\n');
}
