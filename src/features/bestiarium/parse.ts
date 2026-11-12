/**
 * Einen Statblock aus eingefügtem Text lesen – deutsch oder englisch, im Satz der Bücher von 2014
 * und 2024 und so, wie D&D Beyond ihn beim Kopieren liefert (auch mit Bezeichnung und Wert auf
 * getrennten Zeilen). Gelesen wird nur, was dasteht; was sich nicht zuordnen lässt, wird genannt
 * (`unread`) statt geraten. Reine Funktion.
 */
import {
  SIZE_DIE,
  SKILLS,
  abilityMod,
  averageOf,
  parseDice,
  proficiencyOf,
} from '../../domain/creature';
import {
  ABILITY_KEYS,
  newId,
  type AbilityKey,
  type CreatureBlock,
  type CreatureFeature,
  type CreatureSize,
  type FeatureSection,
} from '../../domain/schema';

export interface ParsedStatblock {
  name: string;
  block: CreatureBlock;
  features: CreatureFeature[];
  /** Zeilen, die sich nicht zuordnen ließen. */
  unread: string[];
}

const SIZES: [RegExp, CreatureSize][] = [
  [/^(winzig|tiny)/i, 'tiny'],
  [/^(klein|small)/i, 'small'],
  [/^(mittelgro(ß|ss)|medium)/i, 'medium'],
  [/^(gro(ß|ss)|large)/i, 'large'],
  [/^(riesig|huge)/i, 'huge'],
  [/^(gigantisch|gargantuan)/i, 'gargantuan'],
];

const ABILITY_WORDS: Record<AbilityKey, string> = {
  str: 'STR|STÄ',
  dex: 'DEX|GES',
  con: 'CON|KON',
  int: 'INT',
  wis: 'WIS|WEI',
  cha: 'CHA',
};
const abilityOf = (word: string): AbilityKey | null =>
  ABILITY_KEYS.find((key) =>
    new RegExp(`^(${ABILITY_WORDS[key]})$`, 'i').test(word.replace(/\.$/, '')),
  ) ?? null;
const ANY_ABILITY = Object.values(ABILITY_WORDS).join('|');

const SKILL_WORDS: Record<string, string> = {
  acrobatics: 'acrobatics',
  arcana: 'arcana',
  athletics: 'athletics',
  performance: 'performance',
  intimidation: 'intimidation',
  'sleight of hand': 'sleight',
  history: 'history',
  medicine: 'medicine',
  stealth: 'stealth',
  'animal handling': 'animals',
  insight: 'insight',
  investigation: 'investigation',
  nature: 'nature',
  religion: 'religion',
  deception: 'deception',
  survival: 'survival',
  persuasion: 'persuasion',
  perception: 'perception',
  ...Object.fromEntries(
    Object.entries(SKILLS).map(([key, skill]) => [skill.label.toLowerCase(), key]),
  ),
};

const DAMAGE_WORDS: Record<string, string> = {
  slashing: 'Hieb',
  piercing: 'Stich',
  bludgeoning: 'Wucht',
  fire: 'Feuer',
  cold: 'Kälte',
  poison: 'Gift',
  acid: 'Säure',
  lightning: 'Blitz',
  thunder: 'Schall',
  necrotic: 'Nekrotisch',
  radiant: 'Gleißend',
  psychic: 'Psychisch',
  force: 'Energie',
};

const SECTIONS: [RegExp, FeatureSection][] = [
  [/^(merkmale|traits|eigenschaften)$/i, 'trait'],
  [/^(aktionen|actions)$/i, 'action'],
  [/^(bonusaktionen|bonus actions)$/i, 'bonus'],
  [/^(reaktionen|reactions)$/i, 'reaction'],
  [/^(legend(ä|ae)re aktionen|legendary actions)$/i, 'legendary'],
];

/** Die Bezeichnungen der Kopfzeilen eines Statblocks. */
const LABELS = {
  ac: /^(rüstungsklasse|rk|armor class|ac)\b/i,
  hp: /^(trefferpunkte|tp|hit points|hp)\b/i,
  speed: /^(bewegungsrate|bewegung|speed)\b/i,
  initiative: /^(initiative)\b/i,
  saves: /^(rettungswürfe|saving throws)\b/i,
  skills: /^(fertigkeiten|skills)\b/i,
  vulnerable: /^(schadensanfälligkeiten|anfälligkeiten|damage vulnerabilities|vulnerabilities)\b/i,
  resistant: /^(schadensresistenzen|resistenzen|damage resistances|resistances)\b/i,
  immune: /^(schadensimmunitäten|immunitäten|damage immunities|immunities)\b/i,
  conditionImmune: /^(zustandsimmunitäten|condition immunities)\b/i,
  senses: /^(sinne|senses)\b/i,
  languages: /^(sprachen|languages)\b/i,
  cr: /^(herausforderungsgrad|herausforderung|hg|challenge|cr)\b/i,
  gear: /^(ausrüstung|gear)\b/i,
} as const;
type Label = keyof typeof LABELS;

const num = (text: string): number => Number(text.replace(',', '.'));

/** Länge in Fuß – aus Metern (1,5 m = 5 Fuß) oder Fuß. */
function toFeet(value: string, unit: string): number {
  const amount = num(value);
  return /^m/i.test(unit) ? Math.round(amount / 1.5) * 5 : Math.round(amount);
}
const LENGTH = /(\d+(?:[.,]\d+)?)\s*(m\b|ft\.?|fuß|feet)/i;

function readSpeed(value: string): Pick<CreatureBlock, 'speed' | 'hover'> {
  const speed = { walk: 0, fly: 0, swim: 0, climb: 0, burrow: 0 };
  const kinds: [RegExp, keyof typeof speed][] = [
    [/flieg|fly/i, 'fly'],
    [/schwimm|swim/i, 'swim'],
    [/kletter|climb/i, 'climb'],
    [/grab|burrow/i, 'burrow'],
  ];
  for (const part of value.split(/[,;]/)) {
    const length = LENGTH.exec(part);
    if (!length) continue;
    const kind = kinds.find(([word]) => word.test(part))?.[1] ?? 'walk';
    speed[kind] = toFeet(length[1]!, length[2]!);
  }
  return { speed, hover: /schweb|hover/i.test(value) };
}

function readSenses(value: string): NonNullable<CreatureBlock['senses']> {
  const senses = { darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0 };
  const kinds: [RegExp, keyof typeof senses][] = [
    [/dunkelsicht|darkvision/i, 'darkvision'],
    [/blindsicht|blindsight/i, 'blindsight'],
    [/erschütterungssinn|tremorsense/i, 'tremorsense'],
    [/wahre sicht|wahrer blick|truesight/i, 'truesight'],
  ];
  for (const part of value.split(/[,;]/)) {
    const length = LENGTH.exec(part);
    const kind = kinds.find(([word]) => word.test(part))?.[1];
    if (length && kind) senses[kind] = toFeet(length[1]!, length[2]!);
  }
  return senses;
}

interface RawAttack {
  ranged: boolean;
  bonus: number;
  reach: string;
  dice: string;
  damageType: string;
}

/** Liest den Angriff am Anfang einer Fähigkeit und gibt den Rest des Textes zurück. */
function readAttack(text: string): { attack: RawAttack; rest: string } | null {
  const head =
    /^(nahkampf|fernkampf|melee|ranged)[^:]{0,40}(angriff|attack)[^:]{0,20}:\s*([+\-−]\s*\d+)/i.exec(
      text,
    );
  if (!head) return null;
  const hit = /(?:treffer|hit):\s*(\d+)(?:\s*\(([^)]+)\))?\s*([A-Za-zÄÖÜäöüß]+)?/i.exec(text);
  const reach =
    /(?:reichweite|reach|range)\s+(\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?)\s*(m\b|ft\.?|fuß|feet)/i.exec(
      text,
    );
  const word = (hit?.[3] ?? '').replace(/schaden$/i, '');
  const damageType =
    DAMAGE_WORDS[word.toLowerCase()] ?? (word ? word.charAt(0).toUpperCase() + word.slice(1) : '');
  // Der Rest: was nach dem Satz mit dem Schaden noch folgt.
  const after = hit ? text.slice(hit.index + hit[0].length) : '';
  const rest = after.replace(/^\s*(schaden|damage)?\s*\.?\s*/i, '').trim();
  return {
    attack: {
      ranged: /^(fernkampf|ranged)/i.test(head[1]!),
      bonus: Number(head[3]!.replace(/\s/g, '').replace('−', '-')),
      reach: reach
        ? `${reach[1]!
            .split('/')
            .map((part) => toFeet(part.trim(), reach[2]!))
            .join('/')} Fuß`
        : '',
      dice: hit ? (hit[2] ?? hit[1]!).replace(/d/gi, 'W').replace(/\s+/g, ' ').trim() : '',
      damageType,
    },
    rest,
  };
}

/** Liest einen Statblock – null, wenn der Text leer ist. */
export function parseStatblock(input: string): ParsedStatblock | null {
  const lines = input
    .replace(/\r/g, '')
    .replace(/[   ]/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const name = lines[0]!;
  const block: CreatureBlock = {};
  const unread: string[] = [];
  const raw: {
    hp?: { value: number; dice: string };
    initiative?: number;
    skills: [string, number][];
    saves: [AbilityKey, number][];
    features: { section: FeatureSection; name: string; text: string }[];
  } = { skills: [], saves: [], features: [] };

  const labelOf = (line: string): Label | null =>
    (Object.keys(LABELS) as Label[]).find((key) => LABELS[key].test(line)) ?? null;
  const isSection = (line: string) => SECTIONS.some(([word]) => word.test(line));
  const abilityLine = (line: string) =>
    new RegExp(`^(${ANY_ABILITY})\\b`, 'i').test(line) ||
    /^[\d\s()+\-−]+$/.test(line) ||
    /^(mod|save|rw)\b/i.test(line);

  // Attribute: „STR 8 (−1)“, „Str 8 −1 −1“ – oder eine Kopfzeile mit den Zahlen darunter.
  const scores: Partial<Record<AbilityKey, number>> = {};
  // Nur im Kopf suchen – bis zum Herausforderungsgrad oder zur ersten Überschrift.
  const end = lines.findIndex(
    (line, index) => index > 0 && (isSection(line) || LABELS.cr.test(line)),
  );
  const head = lines.slice(0, end < 0 ? lines.length : end + 1);
  const labels = new RegExp(`\\b(${ANY_ABILITY})\\b`, 'gi');
  const row = head.findIndex((line) => (line.match(labels) ?? []).length >= 4);
  if (row >= 0) {
    // Eine Kopfzeile mit den sechs Kürzeln, die Zahlen stehen darunter.
    const order = (head[row]!.match(labels) ?? [])
      .map(abilityOf)
      .filter((key): key is AbilityKey => key !== null);
    const numbers = head
      .slice(row + 1, row + 8)
      .join(' ')
      .replace(/\([^)]*\)/g, ' ')
      .split(/\s+/)
      .filter((part) => /^\d{1,2}$/.test(part))
      .map(Number);
    order.forEach((key, index) => {
      if (numbers[index] !== undefined) scores[key] = numbers[index];
    });
  } else {
    // „STR 8 (−1)“ – im Satz von 2024 folgt nach dem Modifikator der Rettungswurf.
    const pair = new RegExp(
      `\\b(${ANY_ABILITY})\\b\\.?:?[ \\n]+(\\d{1,2})\\b(?:[ \\n]+\\(?([+\\-−]\\d+)\\)?(?:[ \\n]+([+\\-−]\\d+))?)?`,
      'gi',
    );
    for (const match of head.join('\n').matchAll(pair)) {
      const key = abilityOf(match[1]!);
      if (!key || scores[key] !== undefined) continue;
      scores[key] = Number(match[2]);
      if (match[4]) raw.saves.push([key, Number(match[4].replace('−', '-'))]);
    }
  }
  if (Object.keys(scores).length === 6)
    block.abilities = scores as Required<typeof scores> as NonNullable<CreatureBlock['abilities']>;

  // Art und Gesinnung: die erste Zeile nach dem Namen, die mit einer Größe beginnt.
  let at = 1;
  const kind = lines[1] && SIZES.find(([word]) => word.test(lines[1]!));
  if (kind) {
    block.size = kind[1];
    const rest = lines[1]!.replace(/^\S+(\s+(oder|or)\s+\S+)?\s*/i, '');
    const comma = rest.lastIndexOf(',');
    const [type, alignment] =
      comma < 0 ? [rest, ''] : [rest.slice(0, comma), rest.slice(comma + 1)];
    const tags = /\(([^)]*)\)/.exec(type);
    block.type = type.replace(/\([^)]*\)/, '').trim();
    if (tags) block.tags = tags[1]!.trim();
    if (alignment.trim()) block.alignment = alignment.trim();
    at = 2;
  }

  let section: FeatureSection = 'trait';
  let body = false;
  for (; at < lines.length; at++) {
    const line = lines[at]!;
    const found = SECTIONS.find(([word]) => word.test(line));
    if (found) {
      section = found[1];
      body = true;
      continue;
    }
    const label = body ? null : labelOf(line);
    if (label) {
      let value = line.replace(LABELS[label], '').replace(/^[:\s]+/, '');
      // D&D Beyond setzt Bezeichnung und Wert gern auf zwei Zeilen.
      const next = lines[at + 1];
      if (!value && next && !labelOf(next) && !isSection(next)) {
        value = next;
        at++;
      }
      if (label === 'ac') {
        const ac = /(\d+)/.exec(value);
        if (ac) block.ac = Number(ac[1]);
        const note = /\(([^)]*)\)/.exec(value);
        if (note) block.acNote = note[1]!.trim();
        const init = /initiative\s*([+\-−]\d+)/i.exec(value);
        if (init) raw.initiative = Number(init[1]!.replace('−', '-'));
      } else if (label === 'initiative') {
        const init = /([+\-−]\d+)/.exec(value);
        if (init) raw.initiative = Number(init[1]!.replace('−', '-'));
      } else if (label === 'hp') {
        const hp = /(\d+)(?:\s*\(([^)]+)\))?/.exec(value);
        if (hp) raw.hp = { value: Number(hp[1]), dice: hp[2] ?? '' };
      } else if (label === 'speed') Object.assign(block, readSpeed(value));
      else if (label === 'saves') {
        for (const part of value.split(/[,;]/)) {
          const save = /(\S+)\s*([+\-−]\d+)/.exec(part.trim());
          const key = save && abilityOf(save[1]!);
          if (key) raw.saves.push([key, Number(save![2]!.replace('−', '-'))]);
        }
      } else if (label === 'skills') {
        for (const part of value.split(/[,;]/)) {
          const skill = /^(.+?)\s*([+\-−]\d+)/.exec(part.trim());
          const key = skill && SKILL_WORDS[skill[1]!.trim().toLowerCase()];
          if (key) raw.skills.push([key, Number(skill![2]!.replace('−', '-'))]);
        }
      } else if (label === 'senses') block.senses = readSenses(value);
      else if (label === 'cr') {
        const cr = /(\d+\s*\/\s*\d+|\d+)/.exec(value);
        if (cr) block.cr = cr[1]!.replace(/\s/g, '');
        // Nach dem Herausforderungsgrad beginnen die Fähigkeiten.
        body = true;
      } else block[label] = value;
      continue;
    }
    if (!body) {
      if (!abilityLine(line)) unread.push(line);
      continue;
    }
    // Eine Fähigkeit: „Name. Text“ – sonst die Fortsetzung der vorigen.
    const feature = /^([^.:]{2,70}?)[.:]\s+(.+)$/.exec(line);
    const last = raw.features[raw.features.length - 1];
    if (feature && feature[1]!.split(' ').length <= 8)
      raw.features.push({ section, name: feature[1]!.trim(), text: feature[2]!.trim() });
    else if (last && last.section === section) last.text += ` ${line}`;
    else unread.push(line);
  }

  // Was sich erst aus dem Zusammenhang ergibt: Übung, Trefferwürfel, Attribut eines Angriffs.
  const pb = proficiencyOf(block.cr ?? '0');
  const mod = (key: AbilityKey) => abilityMod(block.abilities?.[key] ?? 10);
  if (raw.hp) {
    const dice = parseDice(raw.hp.dice);
    if (dice?.count) block.hitDice = dice.count;
    const die = SIZE_DIE[block.size ?? 'medium'];
    const computed = dice?.count
      ? averageOf({ count: dice.count, sides: die, bonus: dice.count * mod('con') })
      : null;
    // Folgen die Trefferpunkte nicht aus Größe und Konstitution, gelten sie fest.
    if (computed !== raw.hp.value) block.hp = raw.hp.value;
  }
  const saves = [
    ...new Set(raw.saves.filter(([key, bonus]) => bonus > mod(key)).map(([key]) => key)),
  ];
  if (saves.length) block.saves = saves;
  if (raw.skills.length)
    block.skills = Object.fromEntries(
      raw.skills.map(([key, bonus]) => [
        key,
        pb > 0 && bonus >= mod(SKILLS[key]!.ability) + 2 * pb ? 2 : 1,
      ]),
    );
  if (raw.initiative !== undefined) {
    const extra = raw.initiative - mod('dex');
    block.initiative = extra >= 2 * pb ? 2 : extra >= pb ? 1 : 0;
  }

  const features: CreatureFeature[] = raw.features.map((entry) => {
    const read = readAttack(entry.text);
    const dc = /\b(?:SG|DC)\s*(\d+)/.exec(entry.text);
    const feature: CreatureFeature = {
      id: newId(),
      section: entry.section,
      name: entry.name,
      text: entry.text,
      attack: null,
      saveAbility: null,
      saveDc: dc ? Number(dc[1]) : null,
    };
    if (!read) return feature;
    const { attack } = read;
    const dice = parseDice(attack.dice);
    // Welches Attribut erklärt Angriffsbonus und Schadensbonus? Dann rechnet Wayfarer beides.
    const order: AbilityKey[] = attack.ranged
      ? ['dex', 'str', ...ABILITY_KEYS]
      : ['str', 'dex', ...ABILITY_KEYS];
    const ability = order.find(
      (key) => mod(key) + pb === attack.bonus && (!dice || dice.bonus === mod(key) || !dice.count),
    );
    return {
      ...feature,
      text: read.rest,
      attack: ability
        ? {
            ranged: attack.ranged,
            ability,
            bonus: null,
            reach: attack.reach,
            dice: dice?.count ? `${dice.count}W${dice.sides}` : attack.dice,
            addMod: Boolean(dice?.count),
            damageType: attack.damageType,
          }
        : {
            ranged: attack.ranged,
            ability: attack.ranged ? 'dex' : 'str',
            bonus: attack.bonus,
            reach: attack.reach,
            dice: attack.dice,
            addMod: false,
            damageType: attack.damageType,
          },
    };
  });

  return { name, block, features, unread };
}
