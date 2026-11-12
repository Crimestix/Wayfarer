/**
 * Bestiarium: Statblöcke nach den Regeln von 2024. Wayfarer rechnet, was sich rechnen lässt –
 * Modifikatoren, Übungsbonus aus dem Herausforderungsgrad, Trefferpunkte aus Trefferwürfeln und
 * Konstitution, Angriffsbonus, durchschnittlichen Schaden, Rettungswurf-SG, passive Wahrnehmung –
 * und schätzt, ob der Herausforderungsgrad zu den Werten passt.
 *
 * Erben statt kopieren: Eine Variante hält nur fest, was von ihrer Vorlage abweicht; ein Einzelner
 * ist ein bestimmtes Wesen. `resolveCreature()` legt die Kette übereinander. Reine Funktionen.
 */
import {
  ABILITY_KEYS,
  type AbilityKey,
  type Creature,
  type CreatureAttack,
  type CreatureBlock,
  type CreatureFeature,
  type CreatureKind,
  type CreatureSize,
  type FeatureSection,
} from './schema';

// ── Bezeichnungen ──────────────────────────────────────────────────────────

export const SIZE_LABEL: Record<CreatureSize, string> = {
  tiny: 'Winzig',
  small: 'Klein',
  medium: 'Mittelgroß',
  large: 'Groß',
  huge: 'Riesig',
  gargantuan: 'Gigantisch',
};
/** Der Trefferwürfel folgt aus der Größe. */
export const SIZE_DIE: Record<CreatureSize, number> = {
  tiny: 4,
  small: 6,
  medium: 8,
  large: 10,
  huge: 12,
  gargantuan: 20,
};
export const ABILITY_SHORT: Record<AbilityKey, string> = {
  str: 'STÄ',
  dex: 'GES',
  con: 'KON',
  int: 'INT',
  wis: 'WEI',
  cha: 'CHA',
};
export const ABILITY_NAME: Record<AbilityKey, string> = {
  str: 'Stärke',
  dex: 'Geschicklichkeit',
  con: 'Konstitution',
  int: 'Intelligenz',
  wis: 'Weisheit',
  cha: 'Charisma',
};
export const KIND_LABEL: Record<CreatureKind, string> = {
  template: 'Vorlage',
  variant: 'Variante',
  individual: 'Einzelner',
};
export const SECTION_LABEL: Record<FeatureSection, string> = {
  trait: 'Merkmale',
  action: 'Aktionen',
  bonus: 'Bonusaktionen',
  reaction: 'Reaktionen',
  legendary: 'Legendäre Aktionen',
};
export const SPEED_LABEL: Record<keyof NonNullable<CreatureBlock['speed']>, string> = {
  walk: '',
  fly: 'Fliegen',
  swim: 'Schwimmen',
  climb: 'Klettern',
  burrow: 'Graben',
};
export const SENSE_LABEL: Record<keyof NonNullable<CreatureBlock['senses']>, string> = {
  darkvision: 'Dunkelsicht',
  blindsight: 'Blindsicht',
  tremorsense: 'Erschütterungssinn',
  truesight: 'Wahre Sicht',
};

/** Die Fertigkeiten und ihr Attribut. */
export const SKILLS: Record<string, { label: string; ability: AbilityKey }> = {
  acrobatics: { label: 'Akrobatik', ability: 'dex' },
  arcana: { label: 'Arkane Kunde', ability: 'int' },
  athletics: { label: 'Athletik', ability: 'str' },
  performance: { label: 'Auftreten', ability: 'cha' },
  intimidation: { label: 'Einschüchtern', ability: 'cha' },
  sleight: { label: 'Fingerfertigkeit', ability: 'dex' },
  history: { label: 'Geschichte', ability: 'int' },
  medicine: { label: 'Heilkunde', ability: 'wis' },
  stealth: { label: 'Heimlichkeit', ability: 'dex' },
  animals: { label: 'Mit Tieren umgehen', ability: 'wis' },
  insight: { label: 'Motiv erkennen', ability: 'wis' },
  investigation: { label: 'Nachforschungen', ability: 'int' },
  nature: { label: 'Naturkunde', ability: 'int' },
  religion: { label: 'Religion', ability: 'int' },
  deception: { label: 'Täuschen', ability: 'cha' },
  survival: { label: 'Überlebenskunst', ability: 'wis' },
  persuasion: { label: 'Überzeugen', ability: 'cha' },
  perception: { label: 'Wahrnehmung', ability: 'wis' },
};

// ── Herausforderungsgrad ───────────────────────────────────────────────────

/** Die Herausforderungsgrade in ihrer Reihenfolge. */
export const CRS: readonly string[] = [
  '0',
  '1/8',
  '1/4',
  '1/2',
  ...Array.from({ length: 30 }, (_, i) => String(i + 1)),
];

const XP: readonly number[] = [
  10, 25, 50, 100, 200, 450, 700, 1100, 1800, 2300, 2900, 3900, 5000, 5900, 7200, 8400, 10000,
  11500, 13000, 15000, 18000, 20000, 22000, 25000, 33000, 41000, 50000, 62000, 75000, 90000, 105000,
  120000, 135000, 155000,
];

const crIndex = (cr: string): number => Math.max(0, CRS.indexOf(cr.trim()));

/** Der Herausforderungsgrad als Zahl: „1/4“ → 0,25. */
export function crValue(cr: string): number {
  const [a, b] = cr.trim().split('/');
  const value = b ? Number(a) / Number(b) : Number(a);
  return Number.isFinite(value) ? value : 0;
}

/** Erfahrungspunkte für einen Herausforderungsgrad. */
export const xpOf = (cr: string): number => XP[crIndex(cr)]!;

/** Übungsbonus aus dem Herausforderungsgrad: +2 bis HG 4, dann alle vier Grade einer mehr. */
export const proficiencyOf = (cr: string): number =>
  2 + Math.max(0, Math.floor((crValue(cr) - 1) / 4));

/** Modifikator eines Attributswerts. */
export const abilityMod = (score: number): number => Math.floor((score - 10) / 2);

/** „+2“, „−1“, „+0“ */
export const signed = (value: number): string => (value < 0 ? `−${-value}` : `+${value}`);

// ── Würfel ─────────────────────────────────────────────────────────────────

export interface Dice {
  count: number;
  sides: number;
  bonus: number;
}

/** Liest „2W6“, „2d6 + 3“, „1W8-1“ oder eine bloße Zahl – null, wenn es keins davon ist. */
export function parseDice(text: string): Dice | null {
  const clean = text.replace(/\s+/g, '').replace(/−/g, '-');
  const dice = /^(\d*)[wWdD](\d+)([+-]\d+)?$/.exec(clean);
  if (dice)
    return {
      count: dice[1] ? Number(dice[1]) : 1,
      sides: Number(dice[2]),
      bonus: dice[3] ? Number(dice[3]) : 0,
    };
  return /^\d+$/.test(clean) ? { count: 0, sides: 0, bonus: Number(clean) } : null;
}

/** Der Durchschnitt eines Wurfs, abgerundet wie im Statblock: 2W6 + 3 → 10. */
export const averageOf = (dice: Dice): number =>
  Math.floor((dice.count * (dice.sides + 1)) / 2 + dice.bonus);

/** „2W6 + 3“, „1W8 − 1“, „2W6“ */
export function formatDice(dice: Dice): string {
  const head = dice.count ? `${dice.count}W${dice.sides}` : '';
  if (!dice.bonus) return head || '0';
  const tail = dice.bonus < 0 ? `− ${-dice.bonus}` : `+ ${dice.bonus}`;
  return head ? `${head} ${tail}` : String(dice.bonus);
}

// ── Erben ──────────────────────────────────────────────────────────────────

export type FullBlock = Required<CreatureBlock>;

/** Was gilt, wo niemand in der Kette etwas festlegt. */
export const DEFAULT_BLOCK: FullBlock = {
  size: 'medium',
  type: '',
  tags: '',
  alignment: '',
  ac: 10,
  acNote: '',
  hitDice: 1,
  hp: null,
  initiative: 0,
  speed: { walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0 },
  hover: false,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  saves: [],
  skills: {},
  vulnerable: '',
  resistant: '',
  immune: '',
  conditionImmune: '',
  senses: { darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0 },
  languages: '',
  cr: '0',
  attacksPerRound: 1,
  gear: '',
  habitat: '',
  treasure: '',
};

export interface ResolvedFeature extends CreatureFeature {
  /** Von weiter oben in der Kette geerbt, nicht selbst festgelegt. */
  inherited: boolean;
}

export interface Resolved {
  creature: Creature;
  /** Die Kette, von der Vorlage bis zu diesem Wesen. */
  chain: Creature[];
  block: FullBlock;
  /** Welche Felder dieses Wesen selbst festlegt – alles andere ist geerbt. */
  own: ReadonlySet<keyof CreatureBlock>;
  features: ResolvedFeature[];
  source: string;
}

type Creatures = Readonly<Record<string, Creature>>;

const sameName = (a: string, b: string): boolean =>
  a.trim().toLocaleLowerCase('de') === b.trim().toLocaleLowerCase('de');

/** Die Kette eines Wesens, von der Vorlage abwärts – ohne sich im Kreis zu drehen. */
export function creatureChain(creatures: Creatures, id: string): Creature[] {
  const chain: Creature[] = [];
  const seen = new Set<string>();
  for (let at = creatures[id]; at && !seen.has(at.id); at = creatures[at.parentId ?? '']) {
    seen.add(at.id);
    chain.unshift(at);
  }
  return chain;
}

/**
 * Legt die Kette übereinander: Jedes Feld gilt so, wie es das unterste Glied festlegt, das es
 * festlegt. Fähigkeiten werden vererbt; eine gleichnamige ersetzt die geerbte, und was unter
 * `dropped` steht, fällt weg. Ändert sich die Vorlage, ziehen alle mit, die nichts anderes sagen.
 */
export function resolveCreature(creatures: Creatures, id: string): Resolved | null {
  const chain = creatureChain(creatures, id);
  const creature = chain[chain.length - 1];
  if (!creature) return null;
  let block: FullBlock = DEFAULT_BLOCK;
  let features: ResolvedFeature[] = [];
  let source = '';
  for (const link of chain) {
    const set = Object.fromEntries(
      Object.entries(link.block).filter(([, value]) => value !== undefined),
    ) as CreatureBlock;
    block = { ...block, ...set };
    const last = link === creature;
    features = features
      .filter(
        (feature) =>
          !link.dropped.some((name) => sameName(name, feature.name)) &&
          !link.features.some((own) => sameName(own.name, feature.name)),
      )
      .map((feature) => ({ ...feature, inherited: true }));
    features.push(...link.features.map((feature) => ({ ...feature, inherited: !last })));
    if (link.source) source = link.source;
  }
  const own = new Set(
    (Object.keys(creature.block) as (keyof CreatureBlock)[]).filter(
      (key) => creature.block[key] !== undefined,
    ),
  );
  return { creature, chain, block, own, features, source };
}

/** Alle, die von einem Wesen erben – unmittelbar. */
export function creatureChildren(creatures: Creatures, id: string): Creature[] {
  return Object.values(creatures)
    .filter((entry) => entry.parentId === id)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

// ── Rechnung ───────────────────────────────────────────────────────────────

export interface CreatureStats {
  pb: number;
  xp: number;
  mods: Record<AbilityKey, number>;
  /** Trefferpunkte: festgelegt – sonst aus Trefferwürfeln und Konstitution. */
  hp: number;
  /** „5W8 + 10“ */
  hpFormula: string;
  initiative: number;
  saves: Record<AbilityKey, number>;
  skills: { key: string; label: string; bonus: number }[];
  passivePerception: number;
}

export function statsOf(block: FullBlock): CreatureStats {
  const pb = proficiencyOf(block.cr);
  const mods = Object.fromEntries(
    ABILITY_KEYS.map((ability) => [ability, abilityMod(block.abilities[ability])]),
  ) as Record<AbilityKey, number>;
  const hitDice: Dice = {
    count: block.hitDice,
    sides: SIZE_DIE[block.size],
    bonus: block.hitDice * mods.con,
  };
  const skills = Object.entries(block.skills)
    .filter(([key]) => SKILLS[key])
    .map(([key, level]) => ({
      key,
      label: SKILLS[key]!.label,
      bonus: mods[SKILLS[key]!.ability] + pb * level,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
  return {
    pb,
    xp: xpOf(block.cr),
    mods,
    hp: block.hp ?? Math.max(1, averageOf(hitDice)),
    hpFormula: formatDice(hitDice),
    initiative: mods.dex + pb * block.initiative,
    saves: Object.fromEntries(
      ABILITY_KEYS.map((ability) => [
        ability,
        mods[ability] + (block.saves.includes(ability) ? pb : 0),
      ]),
    ) as Record<AbilityKey, number>,
    skills,
    passivePerception: 10 + mods.wis + pb * (block.skills.perception ?? 0),
  };
}

export interface AttackMath {
  bonus: number;
  /** Durchschnittlicher Schaden; null ohne lesbare Würfel. */
  average: number | null;
  /** „1W6 + 2“ */
  formula: string;
  dice: Dice | null;
}

/** Angriffsbonus und Schaden eines Angriffs. */
export function attackMath(block: FullBlock, attack: CreatureAttack): AttackMath {
  const stats = statsOf(block);
  const mod = stats.mods[attack.ability];
  const base = parseDice(attack.dice);
  const dice = base ? { ...base, bonus: base.bonus + (attack.addMod ? mod : 0) } : null;
  return {
    bonus: attack.bonus ?? mod + stats.pb,
    average: dice ? Math.max(dice.count ? 1 : 0, averageOf(dice)) : null,
    formula: dice ? formatDice(dice) : attack.dice,
    dice,
  };
}

/** Der SG eines Rettungswurfs gegen eine Fähigkeit – null, wenn sie keinen verlangt. */
export function saveDcOf(
  block: FullBlock,
  feature: Pick<CreatureFeature, 'saveAbility' | 'saveDc'>,
): number | null {
  if (feature.saveDc !== null) return feature.saveDc;
  if (!feature.saveAbility) return null;
  const stats = statsOf(block);
  return 8 + stats.pb + stats.mods[feature.saveAbility];
}

/** „30 Fuß, Fliegen 60 Fuß (schweben)“ */
export function speedText(block: FullBlock): string {
  const parts: string[] = [`${block.speed.walk} Fuß`];
  for (const key of ['burrow', 'climb', 'fly', 'swim'] as const)
    if (block.speed[key])
      parts.push(
        `${SPEED_LABEL[key]} ${block.speed[key]} Fuß${key === 'fly' && block.hover ? ' (schweben)' : ''}`,
      );
  return parts.join(', ');
}

/** „Dunkelsicht 60 Fuß; passive Wahrnehmung 12“ */
export function sensesText(block: FullBlock): string {
  const parts = (Object.keys(SENSE_LABEL) as (keyof typeof SENSE_LABEL)[])
    .filter((key) => block.senses[key])
    .map((key) => `${SENSE_LABEL[key]} ${block.senses[key]} Fuß`);
  const passive = `passive Wahrnehmung ${statsOf(block).passivePerception}`;
  return parts.length ? `${parts.join(', ')}; ${passive}` : passive;
}

/** „Mittelgroßer Humanoider (Goblinoide), neutral böse“ – so, wie es eingetragen ist. */
export function typeLine(block: FullBlock): string {
  const kind = [SIZE_LABEL[block.size], block.type].filter(Boolean).join(' · ');
  return [block.tags ? `${kind} (${block.tags})` : kind, block.alignment]
    .filter(Boolean)
    .join(', ');
}

/** Die Lebensräume eines Wesens, einzeln. */
export const habitatsOf = (block: Pick<FullBlock, 'habitat'>): string[] =>
  block.habitat
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean);

// ── Passt der Herausforderungsgrad? ────────────────────────────────────────

/**
 * Richtwerte je Herausforderungsgrad: Rüstungsklasse, höchste Trefferpunkte, Angriffsbonus und
 * höchster Schaden je Runde. Eine Faustregel zum Einschätzen selbst gebauter Wesen – kein Gesetz.
 */
const GUIDE: readonly (readonly [ac: number, hp: number, attack: number, damage: number])[] = [
  [13, 6, 3, 1],
  [13, 35, 3, 3],
  [13, 49, 3, 5],
  [13, 70, 3, 8],
  [13, 85, 3, 14],
  [13, 100, 3, 20],
  [13, 115, 4, 26],
  [14, 130, 5, 32],
  [15, 145, 6, 38],
  [15, 160, 6, 44],
  [15, 175, 6, 50],
  [16, 190, 7, 56],
  [16, 205, 7, 62],
  [17, 220, 7, 68],
  [17, 235, 8, 74],
  [17, 250, 8, 80],
  [18, 265, 8, 86],
  [18, 280, 8, 92],
  [18, 295, 8, 98],
  [18, 310, 9, 104],
  [19, 325, 10, 110],
  [19, 340, 10, 116],
  [19, 355, 10, 122],
  [19, 400, 10, 140],
  [19, 445, 11, 158],
  [19, 490, 11, 176],
  [19, 535, 11, 194],
  [19, 580, 12, 212],
  [19, 625, 12, 230],
  [19, 670, 12, 248],
  [19, 715, 13, 266],
  [19, 760, 13, 284],
  [19, 805, 13, 302],
  [19, 850, 14, 320],
];

const clampIndex = (index: number): number => Math.max(0, Math.min(GUIDE.length - 1, index));

export interface CrCheck {
  /** Was die Verteidigung (Trefferpunkte, Rüstungsklasse) nahelegt. */
  defensive: string;
  /** Was der Angriff (Schaden je Runde, Angriffsbonus) nahelegt – null ohne Angriff mit Würfeln. */
  offensive: string | null;
  /** Der Herausforderungsgrad, den die Werte zusammen nahelegen. */
  suggested: string;
  /** Schaden je Runde: der stärkste Angriff mal der Zahl der Angriffe. */
  damage: number;
  verdict: 'fits' | 'low' | 'high';
  text: string;
}

/**
 * Schätzt, ob der Herausforderungsgrad zu den Werten passt: aus Trefferpunkten und Rüstungsklasse
 * für die Verteidigung, aus dem Schaden je Runde und dem Angriffsbonus für den Angriff. Merkmale,
 * Zauber und Resistenzen kennt die Faustregel nicht – sie ist eine Einschätzung, kein Urteil.
 */
export function crCheck(resolved: Pick<Resolved, 'block' | 'features'>): CrCheck {
  const { block, features } = resolved;
  const stats = statsOf(block);
  const byValue = (column: 1 | 3, value: number): number => {
    const index = GUIDE.findIndex((row) => value <= row[column]);
    return index < 0 ? GUIDE.length - 1 : index;
  };
  // Verteidigung: Trefferpunkte; je zwei Punkte Rüstungsklasse über oder unter dem Richtwert ein Grad.
  const byHp = byValue(1, stats.hp);
  const defence = clampIndex(byHp + Math.trunc((block.ac - GUIDE[byHp]![0]) / 2));

  const attacks = features
    .filter((feature) => feature.attack && feature.section !== 'reaction')
    .map((feature) => attackMath(block, feature.attack!))
    .filter((math) => math.average !== null);
  const best = attacks.sort((a, b) => b.average! - a.average!)[0];
  const damage = best ? best.average! * block.attacksPerRound : 0;
  const byDamage = byValue(3, damage);
  const offence = best
    ? clampIndex(byDamage + Math.trunc((best.bonus - GUIDE[byDamage]![2]) / 2))
    : null;

  const suggested = offence === null ? defence : Math.round((defence + offence) / 2);
  const chosen = crIndex(block.cr);
  const gap = chosen - suggested;
  const verdict = Math.abs(gap) <= 1 ? 'fits' : gap > 0 ? 'high' : 'low';
  const name = (index: number) => `HG ${CRS[index]}`;
  const parts = [
    `Verteidigung wie ${name(defence)} (${stats.hp} TP, RK ${block.ac})`,
    offence === null
      ? 'kein Angriff mit Würfeln eingetragen'
      : `Angriff wie ${name(offence)} (${damage} Schaden je Runde, ${signed(best!.bonus)})`,
  ].join(', ');
  return {
    defensive: CRS[defence]!,
    offensive: offence === null ? null : CRS[offence]!,
    suggested: CRS[suggested]!,
    damage,
    verdict,
    text:
      verdict === 'fits'
        ? `HG ${block.cr} passt zu den Werten: ${parts}.`
        : verdict === 'high'
          ? `HG ${block.cr} ist eher hoch gegriffen – die Werte sprechen für ${name(suggested)}: ${parts}.`
          : `HG ${block.cr} ist eher niedrig gegriffen – die Werte sprechen für ${name(suggested)}: ${parts}.`,
  };
}

// ── Begegnungen ────────────────────────────────────────────────────────────

/** EP-Budget je Gefährte nach Stufe (Regeln 2024): niedrig, mittel, hoch. */
const BUDGET: readonly (readonly [low: number, moderate: number, high: number])[] = [
  [50, 75, 100],
  [100, 150, 200],
  [150, 225, 400],
  [250, 375, 500],
  [500, 750, 1100],
  [600, 1000, 1400],
  [750, 1300, 1700],
  [1000, 1700, 2100],
  [1300, 2000, 2600],
  [1600, 2300, 3100],
  [1900, 2900, 4100],
  [2200, 3700, 4700],
  [2600, 4200, 5400],
  [2900, 4900, 6200],
  [3300, 5400, 7800],
  [3800, 6100, 9800],
  [4500, 7200, 11700],
  [5000, 8700, 14200],
  [5500, 10700, 17200],
  [6400, 13200, 22000],
];

export interface XpBudget {
  low: number;
  moderate: number;
  high: number;
}

/** Das EP-Budget einer Gruppe: die Summe über ihre Gefährten, je nach Stufe. */
export function xpBudget(levels: readonly number[]): XpBudget {
  const sum = (column: 0 | 1 | 2) =>
    levels.reduce(
      (total, level) => total + BUDGET[Math.max(1, Math.min(20, level)) - 1]![column],
      0,
    );
  return { low: sum(0), moderate: sum(1), high: sum(2) };
}

export type Difficulty = 'none' | 'trivial' | 'low' | 'moderate' | 'high' | 'beyond';

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  none: 'keine Gegner',
  trivial: 'kaum der Rede wert',
  low: 'niedrig',
  moderate: 'mittel',
  high: 'hoch',
  beyond: 'über dem Budget für „hoch“',
};

/** Wie schwer eine Begegnung für die Gruppe ist: Summe der EP gegen das Budget. */
export function difficultyOf(xp: number, budget: XpBudget): Difficulty {
  if (xp <= 0) return 'none';
  if (xp > budget.high) return 'beyond';
  if (xp > budget.moderate) return 'high';
  if (xp > budget.low) return 'moderate';
  return xp > budget.low / 2 ? 'low' : 'trivial';
}
