/**
 * Einen Statblock aus eingefügtem Text lesen – deutsch oder englisch, im Satz der Bücher von 2014
 * und 2024, so wie D&D Beyond ihn beim Kopieren liefert (auch mit Bezeichnung und Wert auf
 * getrennten Zeilen) und so, wie er aus einem PDF kommt (Zeilen mitten im Satz umbrochen,
 * Trennstriche, die Tabelle der Attribute flach gelegt). Gelesen wird nur, was dasteht; was sich
 * nicht zuordnen lässt, wird genannt (`unread`) statt geraten, und was Wayfarer daraus gefolgert
 * hat, steht in `notes`. Reine Funktionen.
 */
import {
  ABILITY_SHORT,
  DEFAULT_BLOCK,
  SIZE_DIE,
  SKILLS,
  abilityMod,
  averageOf,
  parseDice,
  proficiencyOf,
  sensesText,
  signed,
  speedText,
  statsOf,
  typeLine,
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
  /** Zeilen (oder Teile davon), die sich nicht zuordnen ließen. */
  unread: string[];
  /** Was Wayfarer beim Lesen gefolgert hat und der Spielleiter wissen sollte – in ganzen Sätzen. */
  notes: string[];
}

/** Der Name, wenn der Text keinen trägt. */
export const UNNAMED = 'Unbenanntes Wesen';

const SIZES: [RegExp, CreatureSize][] = [
  [/^(winzig|tiny)/i, 'tiny'],
  [/^(klein|small)/i, 'small'],
  [/^(mittelgro(ß|ss)|medium)/i, 'medium'],
  [/^(gro(ß|ss)|large)/i, 'large'],
  [/^(riesig|huge)/i, 'huge'],
  [/^(gigantisch|gargantuan)/i, 'gargantuan'],
];

const ABILITY_WORDS: Record<AbilityKey, string> = {
  str: 'STR|STÄ|STAE',
  dex: 'DEX|GES',
  con: 'CON|KON',
  int: 'INT',
  wis: 'WIS|WEI',
  cha: 'CHA',
};
/** Ausgeschriebene Attribute – in Rettungswürfen wie „Geschicklichkeit +4“. */
const ABILITY_FULL: Record<AbilityKey, string> = {
  str: 'strength|stärke',
  dex: 'dexterity|geschicklichkeit',
  con: 'constitution|konstitution',
  int: 'intelligence|intelligenz',
  wis: 'wisdom|weisheit',
  cha: 'charisma',
};
const abilityOf = (word: string): AbilityKey | null =>
  ABILITY_KEYS.find((key) =>
    new RegExp(`^(${ABILITY_WORDS[key]}|${ABILITY_FULL[key]})$`, 'iu').test(
      word.replace(/\.$/, ''),
    ),
  ) ?? null;
const ANY_ABILITY = Object.values(ABILITY_WORDS).join('|');
/** Ein Kürzel als ganzes Wort – auch „STÄ“, bei dem `\b` versagt. */
const ABILITY_WORD = `(?<!\\p{L})(${ANY_ABILITY})(?!\\p{L})`;
const ONLY_ABILITY = new RegExp(`^${ABILITY_WORD}\\.?$`, 'iu');

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
  nekrotischer: 'Nekrotisch',
  gleißender: 'Gleißend',
  psychischer: 'Psychisch',
};

/** Zustände – um „Immunities Fire; Poisoned“ in Schaden und Zustände zu teilen. */
const CONDITIONS = new Set([
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
  'blind',
  'bezaubert',
  'taub',
  'erschöpfung',
  'erschöpft',
  'verängstigt',
  'gepackt',
  'kampfunfähig',
  'unsichtbar',
  'gelähmt',
  'versteinert',
  'vergiftet',
  'liegend',
  'festgesetzt',
  'betäubt',
  'bewusstlos',
]);

const SECTIONS: [RegExp, FeatureSection][] = [
  [/^(merkmale|traits|eigenschaften)$/i, 'trait'],
  [/^(aktionen|actions)$/i, 'action'],
  [/^(bonusaktionen|bonus actions)$/i, 'bonus'],
  [/^(reaktionen|reactions)$/i, 'reaction'],
  [/^(legend(ä|ae)re aktionen|legendary actions)$/i, 'legendary'],
];
/** Name für Text, der unter einer Überschrift vor der ersten Fähigkeit steht. */
const PREAMBLE: Record<FeatureSection, string> = {
  trait: 'Hinweis',
  action: 'Hinweis',
  bonus: 'Hinweis',
  reaction: 'Hinweis',
  legendary: 'Nutzung',
};

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
  habitat: /^(lebensräume|lebensraum|habitat)\b/i,
  treasure: /^(schatz|treasure)\b/i,
  /** Folgt aus dem Herausforderungsgrad – wird gelesen und übergangen. */
  pb: /^(übungsbonus|proficiency bonus)\b/i,
} as const;
type Label = keyof typeof LABELS;
const labelOf = (line: string): Label | null =>
  (Object.keys(LABELS) as Label[]).find((key) => LABELS[key].test(line)) ?? null;
const sectionOf = (line: string): FeatureSection | null =>
  SECTIONS.find(([word]) => word.test(line.replace(/:$/, '')))?.[1] ?? null;
/** Überschriften, für die Wayfarer keinen eigenen Abschnitt hat – ihr Text bleibt beisammen. */
const EXTRA_SECTION =
  /^(lair actions|regional effects|hortaktionen|versteckaktionen|regionale effekte|regionale auswirkungen):?$/i;

const num = (text: string): number => Number(text.replace(',', '.'));

/** Länge in Fuß – aus Metern (1,5 m = 5 Fuß) oder Fuß. */
function toFeet(value: string, unit: string): number {
  const amount = num(value);
  return /^m/i.test(unit) ? Math.round(amount / 1.5) * 5 : Math.round(amount);
}
const LENGTH = /(\d+(?:[.,]\d+)?)\s*(m\b|ft\.?|fuß|feet)/i;

// ── Text vorbereiten ───────────────────────────────────────────────────────

/**
 * Den eingefügten Text in saubere Zeilen bringen: geschützte und schmale Leerzeichen, weiche
 * Trennstriche, Minuszeichen und Gedankenstriche vor Zahlen vereinheitlichen.
 */
export function cleanLines(input: string): string[] {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/[\t\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
    .replace(/[\u2212\u2011]/g, '-')
    .replace(/(^|[\s(])[\u2013\u2014](?=\d)/gm, '$1-')
    .split('\n')

    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Endet der Text mit einem ganzen Satz? */
const ended = (text: string): boolean => /[.!?…]["'“”„»«’)\]]*$/.test(text);

/** Zwei Stücke einer umbrochenen Zeile zusammenfügen – Trennstriche fallen weg. */
export function joinBroken(before: string, line: string): string {
  if (/\p{L}-$/u.test(before) && /^\p{Ll}/u.test(line) && !/^(und|oder|and|or|bzw)\b/.test(line))
    return before.slice(0, -1) + line;
  if (/\d-$/.test(before)) return before + line;
  return `${before} ${line}`;
}

/** Steht eine Kopfzeile noch nicht zu Ende? Dann gehört die nächste Zeile dazu. */
const headGoesOn = (before: string, line: string): boolean =>
  /^\p{Ll}/u.test(line) ||
  /[,;(/-]$/.test(before) ||
  /\b(und|oder|and|or|but|aber|sowie|of|von|the|der|die|das|mit|with)$/i.test(before) ||
  (/\p{L}$/u.test(before) && /^\d/.test(line));

/** „Name. Text“ – der Anfang einer Fähigkeit. */
function featureStart(line: string): { name: string; text: string } | null {
  const match = /^([^.:]{2,80}?)[.:]\s+(.+)$/.exec(line);
  if (!match || /^\p{Ll}/u.test(match[1]!) || /^[\d+-]/.test(match[1]!)) return null;
  const name = match[1]!.trim();
  if (name.split(' ').length > 8) return null;
  return { name, text: match[2]!.trim() };
}
/**
 * Beginnt das vermeintliche „Name.“ wie ein Satz („The weaver can’t …“, „Der Aschenweber …“)?
 * Dann endete im PDF nur zufällig eine Zeile mit einem Satz, und es geht weiter.
 */
const SENTENCE_START =
  /^(the|a|an|it|its|if|when|while|each|this|that|these|those|he|she|they|then|otherwise|unless|der|die|das|den|dem|ein|eine|einer|eines|er|sie|es|wenn|solange|sobald|falls|jede|jeder|jedes|diese|dieser|dieses|danach|außerdem)\s/i;
const ATTACK_HEAD =
  /^(nahkampf|fernkampf|melee|ranged)[^:]{0,40}(angriff|attack)[^:]{0,20}:\s*([+-]\s*\d+)/i;
const SAVE_HEAD = /^(rettungswurf|\p{L}+ saving throw)/iu;

// ── Teile lesen ────────────────────────────────────────────────────────────

function readSpeed(value: string): Pick<CreatureBlock, 'speed' | 'hover'> {
  const speed = { walk: 0, fly: 0, swim: 0, climb: 0, burrow: 0 };
  const kinds: [RegExp, keyof typeof speed][] = [
    [/flieg|flug|fly/i, 'fly'],
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

/** „Fire; Poisoned“ → Schaden und Zustände getrennt. */
function readImmunities(value: string): { damage: string; conditions: string } {
  const damage: string[] = [];
  const conditions: string[] = [];
  for (const part of value.split(';').map((entry) => entry.trim())) {
    if (!part) continue;
    const words = part
      .split(/,|\s+(?:und|and|or|oder)\s+/)
      .map((word) => word.trim().toLowerCase())
      .filter(Boolean);
    (words.every((word) => CONDITIONS.has(word)) ? conditions : damage).push(part);
  }
  return { damage: damage.join('; '), conditions: conditions.join('; ') };
}

/** Die sechs Attribute aus dem Kopf – mit den Rettungswürfen, wenn sie in der Tabelle stehen. */
function readAbilities(head: string[]): {
  scores: Partial<Record<AbilityKey, number>>;
  saves: [AbilityKey, number][];
} {
  const scores: Partial<Record<AbilityKey, number>> = {};
  const saves: [AbilityKey, number][] = [];
  // D&D Beyond setzt die sechs Kürzel gern untereinander: zu einer Kopfzeile zusammenziehen.
  const lines: string[] = [];
  for (const line of head) {
    const last = lines[lines.length - 1];
    if (
      last !== undefined &&
      ONLY_ABILITY.test(line) &&
      new RegExp(`^(${ABILITY_WORD}\\.?\\s*)+$`, 'iu').test(last)
    )
      lines[lines.length - 1] = `${last} ${line}`;
    else lines.push(line);
  }
  const words = new RegExp(ABILITY_WORD, 'giu');
  // Eine Kopfzeile, die mit mindestens vier Kürzeln beginnt: Die Zahlen folgen dahinter.
  const tableHead = new RegExp(`^((?:${ABILITY_WORD}\\.?\\s+){3,}${ABILITY_WORD}\\.?)(.*)$`, 'iu');
  const row = lines.findIndex((line) => tableHead.test(line));
  if (row >= 0) {
    const match = tableHead.exec(lines[row]!)!;
    const order = (match[1]!.match(words) ?? [])
      .map(abilityOf)
      .filter((key): key is AbilityKey => key !== null);
    const numbers = [match[match.length - 1]!, ...lines.slice(row + 1, row + 8)]
      .join(' ')
      .replace(/\([^)]*\)/g, ' ')
      .split(/\s+/)
      .filter((part) => /^\d{1,2}$/.test(part))
      .map(Number);
    order.forEach((key, index) => {
      if (numbers[index] !== undefined) scores[key] = numbers[index];
    });
    return { scores, saves };
  }
  // „STR 8 (−1)“ – im Satz von 2024 folgt nach dem Modifikator der Rettungswurf.
  const pair = new RegExp(
    `${ABILITY_WORD}\\.?:?[ \\n]+(\\d{1,2})(?!\\d)(?:[ \\n]+\\(?([+-]\\d+)\\)?(?:[ \\n]+([+-]\\d+))?)?`,
    'giu',
  );
  for (const match of lines.join('\n').matchAll(pair)) {
    const key = abilityOf(match[1]!);
    if (!key || scores[key] !== undefined) continue;
    scores[key] = Number(match[2]);
    if (match[4]) saves.push([key, Number(match[4])]);
  }
  return { scores, saves };
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
  const head = ATTACK_HEAD.exec(text);
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
      bonus: Number(head[3]!.replace(/\s/g, '')),
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

// ── Der ganze Block ────────────────────────────────────────────────────────

/** Liest einen Statblock – null, wenn der Text leer ist. */
export function parseStatblock(input: string): ParsedStatblock | null {
  const lines = cleanLines(input);
  if (!lines.length) return null;
  const block: CreatureBlock = {};
  const unread: string[] = [];
  const notes: string[] = [];
  const skills: [string, number][] = [];
  const saves: [AbilityKey, number][] = [];
  const raw: { hp?: { value: number; dice: string }; initiative?: number } = {};
  const features: { section: FeatureSection; name: string; text: string }[] = [];

  // Der Name – es sei denn, der Text beginnt gleich mit einer Kopfzeile. Namen wie „Großer
  // Dornwolf“ oder „Gear Golem“ beginnen auch mit einer Größe oder Bezeichnung: Kopfzeile ist die
  // erste Zeile nur, wenn ein Wert folgt bzw. sie wie eine Zeile „Größe Typ, Gesinnung“ aussieht.
  const isSize = (line: string | undefined) =>
    line !== undefined && SIZES.some(([word]) => word.test(line));
  const named = labelOf(lines[0]!)
    ? !/\d/.test(lines[0]!) && !/^\d/.test(lines[1] ?? '')
    : !isSize(lines[0]) ||
      isSize(lines[1]) ||
      (!lines[0]!.includes(',') && !(lines[1] && labelOf(lines[1])));
  const name = named ? lines[0]! : UNNAMED;
  let at = named ? 1 : 0;
  if (!named)
    notes.push('Der Text beginnt ohne Namen – bitte nach dem Übernehmen einen eintragen.');

  // Art und Gesinnung: die Zeile nach dem Namen, die mit einer Größe beginnt.
  const kind = lines[at] ? SIZES.find(([word]) => word.test(lines[at]!)) : undefined;
  if (kind) {
    let line = lines[at]!;
    // „Medium Humanoid (Wizard),“ und die Gesinnung auf der nächsten Zeile
    while (/,$/.test(line) && lines[at + 1] && !labelOf(lines[at + 1]!)) line += ` ${lines[++at]}`;
    block.size = kind[1];
    const rest = line.replace(/^\S+(\s+(oder|or)\s+\S+)?\s*/i, '');
    const comma = rest.lastIndexOf(',');
    const [type, alignment] =
      comma < 0 ? [rest, ''] : [rest.slice(0, comma), rest.slice(comma + 1)];
    const tags = /\(([^)]*)\)/.exec(type);
    block.type = type.replace(/\([^)]*\)/, '').trim();
    if (tags) block.tags = tags[1]!.trim();
    if (alignment.trim()) block.alignment = alignment.trim();
    at++;
  }

  // Der Kopf reicht bis zum Herausforderungsgrad oder zur ersten Überschrift.
  const isAbilityLine = (line: string) =>
    new RegExp(`^${ABILITY_WORD}`, 'iu').test(line) ||
    /^[\d\s()+-]+$/.test(line) ||
    /^(mod|save|rw)\b/i.test(line);
  const end = lines.findIndex(
    (line, index) => index >= at && (sectionOf(line) !== null || LABELS.cr.test(line)),
  );
  const ability = readAbilities(lines.slice(at, end < 0 ? lines.length : end + 1));
  saves.push(...ability.saves);
  if (Object.keys(ability.scores).length === 6)
    block.abilities = ability.scores as NonNullable<CreatureBlock['abilities']>;
  else if (Object.keys(ability.scores).length > 0)
    notes.push(
      `Von den Attributen standen nur ${Object.keys(ability.scores)
        .map((key) => ABILITY_SHORT[key as AbilityKey])
        .join(', ')} lesbar da – die übrigen bitte nachtragen.`,
    );

  // Die Kopfzeilen: Bezeichnung und Wert, auch über mehrere Zeilen.
  const fields: { label: Label; value: string }[] = [];
  let section: FeatureSection = 'trait';
  let header = false;
  let body = false;
  let afterCr = false;
  /** Unter einer Überschrift ohne eigenen Abschnitt (Hortaktionen …): alles in eine Fähigkeit. */
  let extra: { section: FeatureSection; name: string; text: string } | null = null;
  for (; at < lines.length; at++) {
    const line = lines[at]!;
    const found = sectionOf(line);
    if (found) {
      section = found;
      header = true;
      body = true;
      afterCr = false;
      extra = null;
      continue;
    }
    if (body && EXTRA_SECTION.test(line)) {
      const heading = line.replace(/:$/, '');
      extra = { section: 'legendary', name: heading, text: '' };
      features.push(extra);
      notes.push(
        `Für „${heading}“ hat Wayfarer keinen eigenen Abschnitt – der Text steht beisammen bei den legendären Aktionen.`,
      );
      continue;
    }
    if (extra) {
      extra.text = extra.text ? joinBroken(extra.text, line) : line;
      continue;
    }
    // Nach dem Herausforderungsgrad setzt D&D Beyond noch den Übungsbonus.
    const label = !body ? labelOf(line) : afterCr && LABELS.pb.test(line) ? 'pb' : null;
    if (label) {
      let value = line.replace(LABELS[label], '').replace(/^[:\s]+/, '');
      // D&D Beyond setzt Bezeichnung und Wert gern auf zwei Zeilen.
      const next = lines[at + 1];
      if (!value && next && !labelOf(next) && !sectionOf(next) && !ONLY_ABILITY.test(next)) {
        value = next;
        at++;
      }
      fields.push({ label, value });
      if (label === 'cr') {
        // Nach dem Herausforderungsgrad beginnen die Fähigkeiten.
        body = true;
        afterCr = true;
      }
      continue;
    }
    if (!body) {
      const last = fields[fields.length - 1];
      if (isAbilityLine(line)) continue;
      if (last && headGoesOn(last.value, line)) last.value = joinBroken(last.value, line);
      else unread.push(line);
      continue;
    }
    afterCr = false;
    // Eine Fähigkeit: „Name. Text“ – sonst die Fortsetzung der vorigen.
    const start = featureStart(line);
    const last = features[features.length - 1];
    const same = last?.section === section;
    const strong = start && (ATTACK_HEAD.test(start.text) || SAVE_HEAD.test(start.text));
    if (start && (!same || strong || (ended(last.text) && !SENTENCE_START.test(start.name))))
      features.push({ section, ...start });
    else if (last && same) last.text = joinBroken(last.text, line);
    else if (header) features.push({ section, name: PREAMBLE[section], text: line });
    else unread.push(line);
  }

  for (const { label, value } of fields) {
    if (label === 'ac') {
      const [before] = value.split(/initiative/i);
      const ac = /(\d+)/.exec(before!);
      if (ac) block.ac = Number(ac[1]);
      const note = /\(([^)]*)\)/.exec(before!);
      if (note) block.acNote = note[1]!.trim();
      const init = /initiative\s*([+-]\d+)/i.exec(value);
      if (init) raw.initiative = Number(init[1]);
      if (!ac) unread.push(`Rüstungsklasse: ${value}`);
    } else if (label === 'initiative') {
      const init = /([+-]\d+)/.exec(value);
      if (init) raw.initiative = Number(init[1]);
    } else if (label === 'hp') {
      const hp = /(\d+)(?:\s*\(([^)]+)\))?/.exec(value);
      if (hp) raw.hp = { value: Number(hp[1]), dice: hp[2] ?? '' };
      else unread.push(`Trefferpunkte: ${value}`);
    } else if (label === 'speed') Object.assign(block, readSpeed(value));
    else if (label === 'saves') {
      for (const part of value.split(/[,;]/).map((entry) => entry.trim())) {
        const save = /^(\S+)\s*([+-]\d+)/.exec(part);
        const key = save && abilityOf(save[1]!);
        if (key) saves.push([key, Number(save![2])]);
        else if (part) unread.push(`Rettungswurf: ${part}`);
      }
    } else if (label === 'skills') {
      for (const part of value.split(/[,;]/).map((entry) => entry.trim())) {
        const skill = /^(.+?)\s*([+-]\d+)/.exec(part);
        const key = skill && SKILL_WORDS[skill[1]!.trim().toLowerCase()];
        if (key) skills.push([key, Number(skill![2])]);
        else if (part) unread.push(`Fertigkeit: ${part}`);
      }
    } else if (label === 'senses') block.senses = readSenses(value);
    else if (label === 'immune') {
      const { damage, conditions } = readImmunities(value);
      if (damage) block.immune = damage;
      if (conditions)
        block.conditionImmune = [block.conditionImmune, conditions].filter(Boolean).join('; ');
    } else if (label === 'conditionImmune')
      block.conditionImmune = [block.conditionImmune, value].filter(Boolean).join('; ');
    else if (label === 'cr') {
      const cr = /(\d+\s*\/\s*\d+|\d+)/.exec(value);
      if (cr) block.cr = cr[1]!.replace(/\s/g, '');
      else unread.push(`Herausforderungsgrad: ${value}`);
    } else if (label === 'habitat') {
      // „Habitat: Forest; Treasure: Any“ in einer Zeile
      const [habitat, treasure] = value.split(
        /;?\s*(?<!\p{L})(?:treasure|schatz)(?!\p{L})\s*:?\s*/iu,
      );
      block.habitat = habitat!.trim();
      if (treasure?.trim()) block.treasure = treasure.trim();
    } else if (label !== 'pb') block[label] = value;
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
    if (computed !== raw.hp.value) {
      block.hp = raw.hp.value;
      if (computed !== null)
        notes.push(
          `${raw.hp.value} Trefferpunkte folgen nicht aus ${raw.hp.dice} bei dieser Größe und Konstitution – sie gelten fest.`,
        );
    }
  }
  const proficient = [
    ...new Set(saves.filter(([key, bonus]) => bonus > mod(key)).map(([key]) => key)),
  ];
  if (proficient.length) block.saves = proficient;
  if (skills.length)
    block.skills = Object.fromEntries(
      skills.map(([key, bonus]) => [
        key,
        pb > 0 && bonus >= mod(SKILLS[key]!.ability) + 2 * pb ? 2 : 1,
      ]),
    );
  if (raw.initiative !== undefined) {
    const extra = raw.initiative - mod('dex');
    block.initiative = extra >= 2 * pb ? 2 : extra >= pb ? 1 : 0;
  }

  const read: CreatureFeature[] = features.map((entry) => {
    const attackRead = readAttack(entry.text);
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
    if (!attackRead) return feature;
    const { attack } = attackRead;
    const dice = parseDice(attack.dice);
    // Welches Attribut erklärt Angriffsbonus und Schadensbonus? Dann rechnet Wayfarer beides.
    const order: AbilityKey[] = attack.ranged
      ? ['dex', 'str', ...ABILITY_KEYS]
      : ['str', 'dex', ...ABILITY_KEYS];
    const ability = order.find(
      (key) => mod(key) + pb === attack.bonus && (!dice || dice.bonus === mod(key) || !dice.count),
    );
    if (!ability)
      notes.push(
        `„${entry.name}“: Der Angriffsbonus ${signed(attack.bonus)} passt zu keinem Attribut – er gilt fest, so wie er dasteht.`,
      );
    return {
      ...feature,
      text: attackRead.rest,
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

  return { name, block, features: read, unread, notes };
}

// ── Was der Spielleiter vor dem Übernehmen sieht ───────────────────────────

/** Die wichtigen Angaben, die im Text nicht gefunden wurden. */
export function missingOf(parsed: ParsedStatblock): string[] {
  const { block } = parsed;
  return [
    parsed.name === UNNAMED ? 'Name' : '',
    block.size ? '' : 'Größe und Typ',
    block.abilities ? '' : 'Attribute',
    block.ac === undefined ? 'Rüstungsklasse' : '',
    block.hitDice === undefined && block.hp === undefined ? 'Trefferpunkte' : '',
    block.speed ? '' : 'Bewegungsrate',
    block.cr === undefined ? 'Herausforderungsgrad' : '',
  ].filter(Boolean);
}

/** Zeilen „Bezeichnung – Wert“: was Wayfarer aus dem Text verstanden hat. */
export function readSummary(parsed: ParsedStatblock): { label: string; value: string }[] {
  const block = { ...DEFAULT_BLOCK, ...parsed.block };
  const stats = statsOf(block);
  const rows: { label: string; value: string }[] = [
    { label: 'Art', value: parsed.block.size ? typeLine(block) : '' },
    { label: 'RK', value: parsed.block.ac !== undefined ? String(block.ac) : '' },
    {
      label: 'TP',
      value:
        parsed.block.hp !== undefined || parsed.block.hitDice !== undefined
          ? `${stats.hp}${block.hp === null ? ` (${stats.hpFormula})` : ' (fest)'}`
          : '',
    },
    { label: 'HG', value: parsed.block.cr ?? '' },
    { label: 'Bewegung', value: parsed.block.speed ? speedText(block) : '' },
    {
      label: 'Attribute',
      value: parsed.block.abilities
        ? ABILITY_KEYS.map((key) => `${ABILITY_SHORT[key]} ${block.abilities[key]}`).join(' · ')
        : '',
    },
    {
      label: 'Rettungswürfe',
      value: block.saves
        .map((key) => `${ABILITY_SHORT[key]} ${signed(stats.saves[key])}`)
        .join(', '),
    },
    {
      label: 'Fertigkeiten',
      value: stats.skills.map((skill) => `${skill.label} ${signed(skill.bonus)}`).join(', '),
    },
    { label: 'Resistenzen', value: block.resistant },
    {
      label: 'Immunitäten',
      value: [block.immune, block.conditionImmune].filter(Boolean).join('; '),
    },
    { label: 'Sinne', value: parsed.block.senses ? sensesText(block) : '' },
    { label: 'Sprachen', value: block.languages },
    {
      label: 'Fähigkeiten',
      value: parsed.features
        .map((feature) => feature.name + (feature.attack ? ' (Angriff)' : ''))
        .join(', '),
    },
  ];
  return rows.filter((row) => row.value);
}
