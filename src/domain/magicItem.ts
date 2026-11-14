/**
 * Magische Gegenstände: Seltenheit, Art, Einstimmung, Ladungen, Fluch – und was die Gruppe davon
 * weiß. Wirkung und Beschreibung schreibt der Spielleiter in den Artikel; hier steht nur, womit
 * Wayfarer rechnet. Den Wert eines Gegenstands ohne eigenen Preis liest `valueOf` aus den
 * Richtwerten nach Seltenheit (SRD 5.2.1, `srd/equipment.ts`). Nichts schränkt ein: Mehr als drei
 * Einstimmungen sind ein ruhiger Hinweis, kein Verbot. Reine Funktionen.
 */
import { parseDice } from './creature';
import {
  MagicSchema,
  PARTY_ID,
  type CampaignData,
  type Charges,
  type Entity,
  type Item,
  type Magic,
  type MagicRarity,
  type Rarity,
} from './schema';
import { srdItem, type SrdItem } from './srd/lookup';
import { MINUTES_PER_DAY, startOfDay, type WorldTime } from './time/calendar';

/** Die Seltenheit in Worten, wie die Regeln sie nennen. */
export const MAGIC_RARITY_LABEL: Record<MagicRarity, string> = {
  common: 'gewöhnlich',
  uncommon: 'ungewöhnlich',
  rare: 'selten',
  'very-rare': 'sehr selten',
  legendary: 'legendär',
  artifact: 'Artefakt',
};

/** Arten zur Auswahl – jede andere geht auch. */
export const MAGIC_TYPES = [
  'Waffe',
  'Rüstung',
  'Trank',
  'Ring',
  'Stab',
  'Zauberstab',
  'Rute',
  'Schriftrolle',
  'Wundersamer Gegenstand',
] as const;

/** So viele Gegenstände darf man nach den Regeln von 2024 zugleich eingestimmt haben. */
export const ATTUNEMENT_LIMIT = 3;

/** Ein neuer magischer Gegenstand mit allen Vorgaben. */
export const emptyMagic = (more: Partial<Magic> = {}): Magic => ({
  ...MagicSchema.parse({}),
  ...more,
});

/** Die Magie eines Eintrags; null = kein Gegenstand oder nicht magisch. */
export function magicOf(entity: Entity | null | undefined): Magic | null {
  return entity?.kind === 'item' ? entity.item.magic : null;
}

/**
 * Die Seltenheit eines Gegenstands: die seiner Magie – sonst, aus älteren Ständen, die des
 * Rezepts. '' = keine.
 */
export function itemRarity(item: Item): MagicRarity | '' {
  return item.item.magic ? item.item.magic.rarity : (item.item.recipe?.rarity ?? '');
}

/** Ist er ein Verbrauchsgut? Bei Magie zählt die Magie, sonst das Rezept. */
export function itemConsumable(item: Item): boolean {
  return item.item.magic ? item.item.magic.consumable : (item.item.recipe?.consumable ?? false);
}

/** „Artefakt“ oder „Sehr selten“ → Seltenheit. Null, wenn unklar. */
export function magicRarityFromText(text: string): MagicRarity | null {
  const value = text
    .trim()
    .toLocaleLowerCase('de')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\(.*$/, '')
    .trim();
  if (/^(artefakt|artifact)/.test(value)) return 'artifact';
  if (/^(sehr selten|very rare)/.test(value)) return 'very-rare';
  if (/^(legendar|legendary)/.test(value)) return 'legendary';
  if (/^(ungewohnlich|uncommon)/.test(value)) return 'uncommon';
  if (/^(selten|rare)\b/.test(value)) return 'rare';
  if (/^(gewohnlich|common)/.test(value)) return 'common';
  return null;
}

// ── Wert ───────────────────────────────────────────────────────────────────

/** So heißt der Wert, wenn er aus der Seltenheit kommt. */
export const RARITY_VALUE_LABEL = 'Richtwert nach Seltenheit';

/** Eine Zauberschriftrolle wird auch als Verbrauchsgut nicht halbiert (SRD: „other than a Spell Scroll“). */
const isSpellScroll = (name: string, type: string) =>
  /zauberschriftrolle|spell\s*scroll/i.test(`${name} ${type}`);

/**
 * Der Richtwert nach Seltenheit aus dem Nachschlagewerk – für Verbrauchsgüter (außer
 * Zauberschriftrollen) der halbe, wie es das SRD sagt. Null ohne Seltenheit und für Artefakte:
 * Die haben keinen Richtwert.
 */
export function rarityRuleItem(item: Item): SrdItem | null {
  const magic = item.item.magic;
  const rarity = itemRarity(item);
  if (!rarity || rarity === 'artifact') return null;
  const half = itemConsumable(item) && !isSpellScroll(item.name, magic?.type ?? '');
  return srdItem(`srd-${half ? 'consumable' : 'magic'}-${rarity}`) ?? null;
}

export interface ItemValue {
  gold: number;
  /** Der eigene Preis des Gegenstands – oder der Richtwert nach seiner Seltenheit. */
  from: 'own' | 'rarity';
  /** Zum Zeigen: '' beim eigenen Preis, sonst „Richtwert nach Seltenheit“. */
  note: string;
}

/** Was ein Gegenstand wert ist: sein eigener Preis, sonst der Richtwert nach Seltenheit. */
export function valueOf(entity: Entity | null | undefined): ItemValue | null {
  if (entity?.kind !== 'item') return null;
  if (entity.item.price !== null) return { gold: entity.item.price, from: 'own', note: '' };
  const rule = rarityRuleItem(entity);
  return rule ? { gold: rule.price, from: 'rarity', note: RARITY_VALUE_LABEL } : null;
}

// ── In Worten ──────────────────────────────────────────────────────────────

/** „magisch · selten“ – für Listen und die Suche. '' = nicht magisch. */
export function magicTag(entity: Entity | null | undefined): string {
  const magic = magicOf(entity);
  if (!magic) return '';
  return ['magisch', magic.rarity && MAGIC_RARITY_LABEL[magic.rarity]].filter(Boolean).join(' · ');
}

/** Einstimmung in Worten: „erfordert Einstimmung durch einen Zauberwirker“; '' = keine nötig. */
export function attunementText(magic: Magic): string {
  if (!magic.attunement.required) return '';
  const by = magic.attunement.by.trim();
  return by ? `erfordert Einstimmung ${by}` : 'erfordert Einstimmung';
}

/** Ladungen in Worten: „3 von 7 Ladungen, 1W6+1 bei Morgengrauen“. */
export function chargesText(charges: Charges): string {
  const count =
    charges.current === charges.max
      ? `${charges.max} ${charges.max === 1 ? 'Ladung' : 'Ladungen'}`
      : `${charges.current} von ${charges.max} Ladungen`;
  return [count, charges.recharge.trim()].filter(Boolean).join(', ');
}

/**
 * Was die Gruppe von der Magie weiß – nur, wenn sie ihn erkannt hat: Seltenheit, Art,
 * Einstimmung, Ladungen. Der Fluch steht nie darin. '' = nichts.
 */
export function playerMagicLine(entity: Entity | null | undefined): string {
  const magic = magicOf(entity);
  if (!magic || !magic.identified) return '';
  return [
    'magisch',
    magic.rarity && MAGIC_RARITY_LABEL[magic.rarity],
    magic.type.trim(),
    attunementText(magic),
    magic.charges && chargesText(magic.charges),
    magic.spent && 'verbraucht',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Bezeichnungen im Steckbrief, die von der Magie erzählen (Seltenheit, Art, Einstimmung, Ladungen). */
const MAGIC_FACT =
  /^(seltenheit|art des magischen gegenstands|magische art|einstimmung.*|erfordert einstimmung|ladung|ladungen)$/i;
/** Bezeichnungen, die von einem Fluch erzählen – nie für die Spieler. */
const CURSE_FACT = /^(fluch|verflucht|flüche)$/i;

/**
 * Welche Zeilen eines Steckbriefs die Spieler sehen dürfen (Bücher): nie den Fluch, und von der
 * Magie nur, was die Gruppe erkannt hat.
 */
export function playerFacts<T extends { label: string }>(
  entity: Entity | null | undefined,
  facts: readonly T[],
): T[] {
  const magic = magicOf(entity);
  return facts.filter((fact) => {
    const label = fact.label.trim();
    if (CURSE_FACT.test(label)) return false;
    if (entity?.kind === 'item' && MAGIC_FACT.test(label)) return !!magic?.identified;
    return true;
  });
}

// ── Steckbrief ─────────────────────────────────────────────────────────────

/**
 * Liest die Einstimmung: „erfordert Einstimmung“, „Einstimmung durch einen Zauberwirker“, „ja“,
 * „nein“. Null, wenn unklar.
 */
export function readAttunement(text: string): Magic['attunement'] | null {
  const value = text.replace(/\s+/g, ' ').trim();
  const lower = value.toLocaleLowerCase('de');
  if (!lower) return null;
  if (/^(nein|keine|nicht|ohne|-|–)\b/.test(lower) || lower === '-' || lower === '–')
    return { required: false, by: '' };
  const by = /\b(durch|von)\s+(.+)$/i.exec(value);
  if (by) return { required: true, by: `${by[1]!.toLocaleLowerCase('de')} ${by[2]!.trim()}` };
  if (/^(ja|erforderlich|erfordert|notwendig|nötig|einstimmung)/.test(lower))
    return { required: true, by: '' };
  return null;
}

/**
 * Liest Ladungen: „7 Ladungen, 1W6+1 bei Morgengrauen“, „7 (1W6+1 bei Morgengrauen)“, „7“.
 * Null, wenn keine Zahl vorn steht.
 */
export function readCharges(text: string): { max: number; recharge: string } | null {
  const match = /^\s*(\d{1,4})\s*(?:ladungen|ladung)?\s*[,;:(–—-]?\s*(.*?)\)?\s*$/iu.exec(text);
  if (!match) return null;
  return { max: Number(match[1]), recharge: match[2]!.trim() };
}

// ── Ladungen ───────────────────────────────────────────────────────────────

/** Eine Zahl von 1 bis `sides` – am Tisch echter Zufall (`fairDie`), in Tests eingespeist. */
export type Die = (sides: number) => number;

export interface RechargeRoll {
  /** Wie viele Ladungen zurückkommen. */
  gained: number;
  /** Die einzelnen Würfe; leer, wenn nicht gewürfelt wurde. */
  rolls: number[];
  /** Was zu den Würfen dazukommt (oder abgeht). */
  bonus: number;
  /** Der Ausdruck, der gewürfelt wurde: „1W6+1“; „alle“, wenn alle zurückkommen. */
  formula: string;
}

/**
 * Würfelt, wie viele Ladungen zurückkommen: „1W6+1 bei Morgengrauen“ wird gewürfelt, „alle“
 * (oder „vollständig“) füllt auf, eine bloße Zahl vorn gilt so. Null, wenn der Text nichts davon
 * sagt – dann trägt der Spielleiter die Zahl selbst ein.
 */
export function rollRecharge(charges: Charges, die: Die): RechargeRoll | null {
  const text = charges.recharge.replace(/−/g, '-');
  const expr = /(\d*)\s*[wWdD]\s*(\d+)(?:\s*([+-])\s*(\d+))?/.exec(text);
  if (expr) {
    const dice = parseDice(`${expr[1] ?? ''}W${expr[2]}${expr[3] ? `${expr[3]}${expr[4]}` : ''}`);
    if (dice && dice.sides > 0) {
      const rolls = Array.from({ length: Math.max(1, dice.count) }, () => die(dice.sides));
      const sum = rolls.reduce((a, b) => a + b, 0) + dice.bonus;
      const formula = `${Math.max(1, dice.count)}W${dice.sides}${dice.bonus ? (dice.bonus > 0 ? `+${dice.bonus}` : `${dice.bonus}`) : ''}`;
      return { gained: Math.max(0, sum), rolls, bonus: dice.bonus, formula };
    }
  }
  if (/\b(alle|vollständig|voll|komplett)\b/i.test(text))
    return { gained: charges.max, rolls: [], bonus: 0, formula: 'alle' };
  const fixed = /^\s*(\d+)\b/.exec(text);
  if (fixed) return { gained: Number(fixed[1]), rolls: [], bonus: 0, formula: fixed[1]! };
  return null;
}

/** Ein Wurf in Worten: „1W6+1: 4 + 1 = 5“, „Alle Ladungen kommen zurück.“ */
export function rollText(roll: RechargeRoll): string {
  if (!roll.rolls.length)
    return roll.formula === 'alle'
      ? 'Alle Ladungen kommen zurück.'
      : `${roll.gained} kommen zurück.`;
  const bonus = roll.bonus ? ` ${roll.bonus > 0 ? '+' : '−'} ${Math.abs(roll.bonus)}` : '';
  return `${roll.formula}: ${roll.rolls.join(' + ')}${bonus} = ${roll.gained}`;
}

/** Die Ladungen nach dem Auffrischen: höchstens bis zum Höchstwert; nichts mehr offen. */
export function rechargedCharges(charges: Charges, gained: number): Charges {
  return {
    ...charges,
    current: Math.min(charges.max, charges.current + Math.max(0, Math.round(gained))),
    spentAt: null,
  };
}

/** Eine Ladung mehr oder weniger. Wer eine verbraucht, öffnet das Auffrischen (`spentAt`). */
export function stepCharges(charges: Charges, delta: number, now: WorldTime): Charges {
  const current = Math.max(0, Math.min(charges.max, charges.current + delta));
  if (current === charges.current) return charges;
  if (current >= charges.max) return { ...charges, current, spentAt: null };
  return { ...charges, current, spentAt: delta < 0 ? (charges.spentAt ?? now) : charges.spentAt };
}

/**
 * Ein neuer Höchstwert: Waren alle Ladungen da, sind es danach wieder alle; sonst bleibt der
 * Stand (höchstens der neue Höchstwert).
 */
export function withMaxCharges(charges: Charges, max: number): Charges {
  const full = charges.current >= charges.max;
  return { ...charges, max, current: full ? max : Math.min(charges.current, max) };
}

/** Bei Morgengrauen – so rechnet Wayfarer, wenn die Welt keinen eigenen Sonnenaufgang kennt. */
export const DAWN_MINUTE = 6 * 60;

/** Das erste Morgengrauen nach einem Zeitpunkt. */
export function nextDawn(after: WorldTime): WorldTime {
  const dawn = startOfDay(after) + DAWN_MINUTE;
  return dawn > after ? dawn : dawn + MINUTES_PER_DAY;
}

/** Wann die Ladungen wiederkommen, nach dem Text: bei Morgengrauen, nach einer Langen Rast – oder beides. */
function rechargeWhen(recharge: string): { dawn: boolean; rest: boolean } {
  const dawn = /morgengrauen|morgen|sonnenaufgang|tagesanbruch|dawn|t[aä]glich|tag\b/i.test(
    recharge,
  );
  const rest = /rast|rest/i.test(recharge);
  return dawn || rest ? { dawn, rest } : { dawn: true, rest: true };
}

/** Gehört der Gegenstand der Gruppe: bei der Gruppe, bei einem Gefährten oder auf einen eingestimmt? */
export function isPartyItem(data: Pick<CampaignData, 'entities'>, item: Item): boolean {
  const holder = item.item.holderId;
  if (holder === PARTY_ID) return true;
  if (holder && data.entities[holder]?.kind === 'character') return true;
  const attuned = item.item.magic?.attunedTo;
  return !!attuned && data.entities[attuned]?.kind === 'character';
}

export interface RechargeDue {
  item: Item;
  charges: Charges;
  /** Was den Anlass gibt: „Morgengrauen“ oder „Lange Rast“. */
  reason: string;
}

/**
 * Gegenstände der Gruppe, deren Ladungen wiederkommen könnten: Es fehlen welche, und seit der
 * ersten verbrauchten kam ein Morgengrauen oder endete eine Lange Rast (je nach Text). Nur ein
 * Angebot – aufgefrischt wird erst, wenn der Spielleiter es bestätigt.
 */
export function rechargesDue(
  data: Pick<CampaignData, 'entities' | 'rests' | 'state'>,
): RechargeDue[] {
  const now = data.state.now;
  const out: RechargeDue[] = [];
  const longRests = Object.values(data.rests).filter(
    (rest) => rest.kind === 'long' && rest.status === 'done' && rest.end !== null,
  );
  for (const entity of Object.values(data.entities)) {
    if (entity.kind !== 'item') continue;
    const charges = entity.item.magic?.charges;
    if (!charges || charges.spentAt === null || charges.current >= charges.max) continue;
    if (entity.item.magic!.spent || !isPartyItem(data, entity)) continue;
    const when = rechargeWhen(charges.recharge);
    const since = charges.spentAt;
    const rested = when.rest && longRests.some((rest) => rest.end! > since && rest.end! <= now);
    const dawned = when.dawn && nextDawn(since) <= now;
    if (rested || dawned)
      out.push({ item: entity, charges, reason: dawned ? 'Morgengrauen' : 'Lange Rast' });
  }
  return out.sort((a, b) => a.item.name.localeCompare(b.item.name, 'de'));
}

// ── Einstimmung ────────────────────────────────────────────────────────────

export interface Attunement {
  /** Die Gegenstände, auf die er eingestimmt ist – nach Namen. */
  items: Item[];
  count: number;
  limit: number;
  /** Ein ruhiger Satz, wenn es mehr sind als die Regeln erlauben; sonst ''. */
  hint: string;
}

/** Worauf ein Gefährte (oder eine Person) eingestimmt ist: „2 von 3“. Mehr ist nur ein Hinweis. */
export function attunementOf(data: Pick<CampaignData, 'entities'>, holderId: string): Attunement {
  const items = Object.values(data.entities)
    .filter(
      (entity): entity is Item =>
        entity.kind === 'item' && entity.item.magic?.attunedTo === holderId,
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const count = items.length;
  return {
    items,
    count,
    limit: ATTUNEMENT_LIMIT,
    hint:
      count > ATTUNEMENT_LIMIT
        ? `Nach den Regeln sind höchstens ${ATTUNEMENT_LIMIT} Einstimmungen zugleich üblich.`
        : '',
  };
}

// ── Ordnen ─────────────────────────────────────────────────────────────────

const RARITY_ORDER: (MagicRarity | '')[] = [
  'common',
  'uncommon',
  'rare',
  'very-rare',
  'legendary',
  'artifact',
  '',
];

export interface ItemGroup {
  /** „Selten“, „Magisch, ohne Seltenheit“ oder „Nicht magisch“. */
  label: string;
  items: Item[];
}

/**
 * Gegenstände nach Seltenheit gruppiert – zum Finden, nie zum Verstecken: Jeder Gegenstand steht
 * in genau einer Gruppe, die nicht magischen zuerst. Ohne magische Gegenstände eine Gruppe ohne
 * Namen.
 */
export function itemsByRarity(items: readonly Item[]): ItemGroup[] {
  const magic = items.filter((item) => item.item.magic);
  if (!magic.length) return [{ label: '', items: [...items] }];
  const groups: ItemGroup[] = [];
  const plain = items.filter((item) => !item.item.magic);
  if (plain.length) groups.push({ label: 'Nicht magisch', items: plain });
  for (const rarity of RARITY_ORDER) {
    const list = magic.filter((item) => item.item.magic!.rarity === rarity);
    if (!list.length) continue;
    const label = rarity ? `Magisch, ${MAGIC_RARITY_LABEL[rarity]}` : 'Magisch, ohne Seltenheit';
    groups.push({ label, items: list });
  }
  return groups;
}

/** Die Stufen der Herstellung (ohne Artefakt) – für alte Rezepte. */
export const isCraftRarity = (rarity: MagicRarity | ''): rarity is Rarity =>
  rarity !== '' && rarity !== 'artifact';
