/**
 * Bausteine für den Statblock-Editor: die deutschen Regelbegriffe zum Anklicken (Kreaturentypen,
 * Gesinnungen, Schadensarten, Zustände), Listen als Chips, die Bibliothek der Fähigkeiten aus
 * Bestiarium und Welt, Gerüste für häufige Fähigkeiten und Platzhalter im Text, die beim Anzeigen
 * gerechnet werden.
 *
 * Wayfarer erfindet hier nichts: Die Bibliothek zeigt nur, was der Spielleiter schon geschrieben
 * hat; die Gerüste sind leere Formen in eigenen Worten, keine Buchtexte. Reine Funktionen.
 */
import {
  ABILITY_NAME,
  ABILITY_SHORT,
  averageOf,
  formatDice,
  parseDice,
  resolveCreature,
  signed,
  statsOf,
  type FullBlock,
} from './creature';
import {
  ABILITY_KEYS,
  newId,
  type AbilityKey,
  type CampaignData,
  type CreatureBlock,
  type CreatureFeature,
  type Entity,
  type EntityKind,
  type FeatureSection,
} from './schema';

// ── Regelbegriffe ──────────────────────────────────────────────────────────

/** Die Kreaturentypen der Regeln von 2024, deutsch. */
export const CREATURE_TYPES: readonly string[] = [
  'Aberration',
  'Drache',
  'Elementar',
  'Fee',
  'Himmlisches Wesen',
  'Humanoider',
  'Konstrukt',
  'Monstrosität',
  'Pflanze',
  'Riese',
  'Schlick',
  'Tier',
  'Unhold',
  'Untoter',
];

export const ALIGNMENTS: readonly string[] = [
  'rechtschaffen gut',
  'neutral gut',
  'chaotisch gut',
  'rechtschaffen neutral',
  'neutral',
  'chaotisch neutral',
  'rechtschaffen böse',
  'neutral böse',
  'chaotisch böse',
  'gesinnungslos',
  'jede Gesinnung',
];

/** Die Schadensarten, wie sie im Statblock stehen. */
export const DAMAGE_TYPES: readonly string[] = [
  'Blitz',
  'Energie',
  'Feuer',
  'Gift',
  'Gleißend',
  'Hieb',
  'Kälte',
  'Nekrotisch',
  'Psychisch',
  'Säure',
  'Schall',
  'Stich',
  'Wucht',
];

export const CONDITIONS: readonly string[] = [
  'Betäubt',
  'Bewusstlos',
  'Bezaubert',
  'Blind',
  'Erschöpfung',
  'Festgesetzt',
  'Gelähmt',
  'Gepackt',
  'Kampfunfähig',
  'Liegend',
  'Taub',
  'Unsichtbar',
  'Verängstigt',
  'Vergiftet',
  'Versteinert',
];

/** Was unter „Nutzung“ häufig steht – zum Auswählen, frei änderbar. */
export const USES_CHOICES: readonly string[] = [
  'Aufladung 5–6',
  'Aufladung 6',
  'Aufladung nach kurzer oder langer Rast',
  '1/Tag',
  '2/Tag',
  '3/Tag',
  '3/Tag, im Hort 4/Tag',
  'kostet 2 Aktionen',
  'kostet 3 Aktionen',
];

// ── Listen als Chips ───────────────────────────────────────────────────────

export const foldWord = (text: string): string =>
  text.trim().toLocaleLowerCase('de').normalize('NFD').replace(/[̀-ͯ]/g, '');

const sameWord = (a: string, b: string): boolean => foldWord(a) === foldWord(b);

/** „Feuer, Kälte; Gift“ → ["Feuer", "Kälte", "Gift"] – ohne Leeres und Doppeltes. */
export function splitList(text: string): string[] {
  const items: string[] = [];
  for (const part of text.split(/[,;]/)) {
    const item = part.trim();
    if (item && !items.some((known) => sameWord(known, item))) items.push(item);
  }
  return items;
}

export const joinList = (items: readonly string[]): string => items.join(', ');

export const listHas = (text: string, word: string): boolean =>
  splitList(text).some((item) => sameWord(item, word));

/** Nimmt ein Wort in die Liste auf oder heraus. */
export function toggleInList(text: string, word: string): string {
  const items = splitList(text);
  return listHas(text, word)
    ? joinList(items.filter((item) => !sameWord(item, word)))
    : joinList([...items, word.trim()]);
}

export const removeFromList = (text: string, word: string): string =>
  joinList(splitList(text).filter((item) => !sameWord(item, word)));

export const addToList = (text: string, word: string): string =>
  !word.trim() || listHas(text, word)
    ? joinList(splitList(text))
    : joinList([...splitList(text), word.trim()]);

/** Was in der Liste steht, aber zu keinem der bekannten Wörter gehört – etwa „Telepathie 60 Fuß“. */
export const extrasOf = (text: string, known: readonly string[]): string[] =>
  splitList(text).filter((item) => !known.some((word) => sameWord(word, item)));

/** Ersetzt die freien Zusätze einer Liste und lässt die bekannten Wörter stehen. */
export function withExtras(text: string, known: readonly string[], extras: string): string {
  const kept = splitList(text).filter((item) => known.some((word) => sameWord(word, item)));
  return joinList([...kept, ...splitList(extras).filter((item) => !listHas(joinList(kept), item))]);
}

// ── Abwehr: anfällig, resistent, immun ─────────────────────────────────────

export const DEFENCE_LEVELS = ['resistant', 'immune', 'vulnerable'] as const;
export type DefenceLevel = (typeof DEFENCE_LEVELS)[number];
export const DEFENCE_LABEL: Record<DefenceLevel, string> = {
  resistant: 'resistent',
  immune: 'immun',
  vulnerable: 'anfällig',
};

type Defences = Pick<FullBlock, DefenceLevel>;

/** In welcher der drei Listen eine Schadensart steht – null, wenn in keiner. */
export function defenceOf(block: Defences, word: string): DefenceLevel | null {
  return DEFENCE_LEVELS.find((level) => listHas(block[level], word)) ?? null;
}

/** Der nächste Stand beim Anklicken: keiner → resistent → immun → anfällig → keiner. */
export function nextDefence(level: DefenceLevel | null): DefenceLevel | null {
  if (level === null) return 'resistant';
  const index = DEFENCE_LEVELS.indexOf(level);
  return DEFENCE_LEVELS[index + 1] ?? null;
}

/** Setzt eine Schadensart in genau eine der drei Listen (oder in keine) – alle drei neu. */
export function setDefence(
  block: Defences,
  word: string,
  level: DefenceLevel | null,
): Required<Pick<CreatureBlock, DefenceLevel>> {
  const next = {} as Required<Pick<CreatureBlock, DefenceLevel>>;
  for (const key of DEFENCE_LEVELS) {
    const without = removeFromList(block[key], word);
    next[key] = key === level ? addToList(without, word) : without;
  }
  return next;
}

// ── Auswahl aus der Welt ───────────────────────────────────────────────────

/** Der Eintrag einer Art mit diesem Namen (oder Beinamen) – nie geraten, nur bei Gleichheit. */
export function namedEntry(
  data: Pick<CampaignData, 'entities'>,
  kind: EntityKind,
  name: string,
): Entity | null {
  if (!name.trim()) return null;
  return (
    Object.values(data.entities).find(
      (entity) =>
        entity.kind === kind &&
        (sameWord(entity.name, name) || entity.aliases.some((alias) => sameWord(alias, name))),
    ) ?? null
  );
}

export interface WordChoice {
  word: string;
  /** Der Eintrag der Welt dazu – null, wenn es ihn (noch) nicht gibt. */
  entityId: string | null;
}

/**
 * Sprachen zum Wählen: die der Welt, dazu, was andere Wesen schon sprechen. Was das Wesen schon
 * spricht, fehlt.
 */
export function languageChoices(
  data: Pick<CampaignData, 'entities' | 'creatures'>,
  chosen: string,
): WordChoice[] {
  const choices: WordChoice[] = [];
  const add = (word: string, entityId: string | null) => {
    if (!word.trim() || listHas(chosen, word) || choices.some((c) => sameWord(c.word, word)))
      return;
    choices.push({ word: word.trim(), entityId });
  };
  for (const entity of Object.values(data.entities))
    if (entity.kind === 'language') add(entity.name, entity.id);
  for (const creature of Object.values(data.creatures))
    for (const word of splitList(creature.block.languages ?? ''))
      add(word, namedEntry(data, 'language', word)?.id ?? null);
  return choices.sort((a, b) => a.word.localeCompare(b.word, 'de'));
}

/** Die Wörter einer Liste mit ihrem Eintrag in der Welt – für „in der Welt anlegen“. */
export function wordsWithEntries(
  data: Pick<CampaignData, 'entities'>,
  kind: EntityKind,
  text: string,
): WordChoice[] {
  return splitList(text).map((word) => ({
    word,
    entityId: namedEntry(data, kind, word)?.id ?? null,
  }));
}

/** Kreaturentypen zum Wählen: die der Regeln und, was im Bestiarium schon steht. */
export function typeChoices(data: Pick<CampaignData, 'creatures'>): string[] {
  const types = [...CREATURE_TYPES];
  for (const creature of Object.values(data.creatures)) {
    const type = creature.block.type?.trim();
    if (type && !types.some((known) => sameWord(known, type))) types.push(type);
  }
  return types.sort((a, b) => a.localeCompare(b, 'de'));
}

// ── Bibliothek der Fähigkeiten ─────────────────────────────────────────────

export type FeatureShape = Omit<CreatureFeature, 'id'>;

export interface LibraryEntry {
  key: string;
  feature: FeatureShape;
  /** Wo sie steht: die Namen der Wesen – oder „Welt“. */
  origins: string[];
  from: 'creature' | 'world';
  /** Der Eintrag der Art „Fähigkeit“ in der Welt, wenn es einen gibt. */
  entityId: string | null;
}

const shapeKey = (feature: FeatureShape): string =>
  [
    feature.section,
    foldWord(feature.name),
    foldWord(feature.text),
    JSON.stringify(feature.attack),
  ].join('|');

/**
 * Alle Fähigkeiten, die der Spielleiter schon geschrieben hat: die eigenen jedes Wesens im
 * Bestiarium (Geerbtes zählt beim Wesen, das es festlegt) und die Einträge der Art „Fähigkeit“ in
 * der Welt. Gleiche Fähigkeiten stehen einmal da, mit allen Wesen, bei denen sie stehen.
 */
export function featureLibrary(
  data: Pick<CampaignData, 'creatures' | 'entities'>,
  exceptCreatureId: string | null = null,
): LibraryEntry[] {
  const entries = new Map<string, LibraryEntry>();
  const creatures = Object.values(data.creatures).sort((a, b) =>
    a.name.localeCompare(b.name, 'de'),
  );
  for (const creature of creatures) {
    if (creature.id === exceptCreatureId) continue;
    const resolved = resolveCreature(data.creatures, creature.id);
    if (!resolved) continue;
    for (const feature of resolved.features) {
      if (feature.inherited || !feature.name.trim()) continue;
      const { id: _id, inherited: _inherited, ...shape } = feature;
      const key = shapeKey(shape);
      const known = entries.get(key);
      if (known) known.origins.push(creature.name);
      else
        entries.set(key, {
          key,
          feature: shape,
          origins: [creature.name],
          from: 'creature',
          entityId: namedEntry(data, 'ability', shape.name)?.id ?? null,
        });
    }
  }
  for (const entity of Object.values(data.entities)) {
    if (entity.kind !== 'ability') continue;
    const shape: FeatureShape = {
      section: 'trait',
      name: entity.name,
      text: (entity.notes || entity.tagline).trim(),
      attack: null,
      saveAbility: null,
      saveDc: null,
      uses: '',
    };
    // Steht dieselbe Fähigkeit schon bei einem Wesen, genügt ein Eintrag.
    const twin = [...entries.values()].find(
      (entry) => sameWord(entry.feature.name, entity.name) && entry.entityId === entity.id,
    );
    if (twin && (!shape.text || sameWord(twin.feature.text, shape.text))) {
      twin.origins.push('Welt');
      continue;
    }
    const key = `world|${entity.id}`;
    entries.set(key, {
      key,
      feature: shape,
      origins: ['Welt'],
      from: 'world',
      entityId: entity.id,
    });
  }
  return [...entries.values()].sort((a, b) => a.feature.name.localeCompare(b.feature.name, 'de'));
}

/**
 * Sucht in der Bibliothek: Treffer im Namen zuerst, dann im Text oder bei der Herkunft. Mit
 * Abschnitt nur Fähigkeiten dieses Abschnitts (Fähigkeiten der Welt passen zu jedem).
 */
export function searchLibrary(
  entries: readonly LibraryEntry[],
  query: string,
  section: FeatureSection | null = null,
  limit = 40,
): LibraryEntry[] {
  const needle = foldWord(query);
  const rank = (entry: LibraryEntry): number => {
    if (!needle) return 0;
    const name = foldWord(entry.feature.name);
    if (name.startsWith(needle)) return 0;
    if (name.includes(needle)) return 1;
    if (foldWord(`${entry.feature.text} ${entry.origins.join(' ')}`).includes(needle)) return 2;
    return -1;
  };
  return entries
    .filter((entry) => !section || entry.from === 'world' || entry.feature.section === section)
    .map((entry) => ({ entry, rank: rank(entry) }))
    .filter(({ rank }) => rank >= 0)
    .sort(
      (a, b) => a.rank - b.rank || a.entry.feature.name.localeCompare(b.entry.feature.name, 'de'),
    )
    .slice(0, limit)
    .map(({ entry }) => entry);
}

/** Eine Fähigkeit als eigene übernehmen: eine Abschrift mit neuer Kennung, frei änderbar. */
export function adoptFeature(feature: FeatureShape, section?: FeatureSection): CreatureFeature {
  return {
    ...feature,
    id: newId(),
    section: section ?? feature.section,
    attack: feature.attack && { ...feature.attack },
  };
}

/** Ein leeres Merkmal, eine leere Aktion … */
export const blankFeature = (section: FeatureSection): CreatureFeature => ({
  id: newId(),
  section,
  name: '',
  text: '',
  attack: null,
  saveAbility: null,
  saveDc: null,
  uses: '',
});

// ── Gerüste ────────────────────────────────────────────────────────────────

export interface FeatureTemplate {
  key: string;
  label: string;
  hint: string;
  section: FeatureSection;
  build: (block: FullBlock) => FeatureShape;
}

const TIMES = ['', 'einmal', 'zweimal', 'dreimal', 'viermal', 'fünfmal', 'sechsmal'];

/** Das stärkste geistige Attribut – damit zaubert ein Wesen gewöhnlich. */
function castingAbility(block: FullBlock): AbilityKey {
  return (['cha', 'wis', 'int'] as const).reduce((best, key) =>
    block.abilities[key] > block.abilities[best] ? key : best,
  );
}

const bare = (section: FeatureSection, name: string, text = ''): FeatureShape => ({
  section,
  name,
  text,
  attack: null,
  saveAbility: null,
  saveDc: null,
  uses: '',
});

/**
 * Gerüste für häufige Bausteine – leere Formen in eigenen Worten, die der Spielleiter benennt und
 * ausfüllt. Angriff und SG rechnet Wayfarer aus den Werten; Würfel in eckigen Klammern auch.
 */
export const FEATURE_TEMPLATES: readonly FeatureTemplate[] = [
  {
    key: 'multiattack',
    label: 'Mehrfachangriff',
    hint: 'Wie viele Angriffe je Aktion – nach „Angriffe je Runde“',
    section: 'action',
    build: (block) => {
      const count = Math.max(2, block.attacksPerRound);
      return bare(
        'action',
        'Mehrfachangriff',
        `Das Wesen greift ${TIMES[count] ?? `${count}-mal`} an.`,
      );
    },
  },
  {
    key: 'melee',
    label: 'Nahkampfangriff',
    hint: 'Angriff mit Reichweite 5 Fuß – Bonus und Schaden rechnet Wayfarer',
    section: 'action',
    build: (block) => ({
      ...bare('action', 'Nahkampfangriff'),
      attack: {
        ranged: false,
        ability: block.abilities.dex > block.abilities.str ? 'dex' : 'str',
        bonus: null,
        reach: '5 Fuß',
        dice: '1W6',
        addMod: true,
        damageType: 'Hieb',
      },
    }),
  },
  {
    key: 'ranged',
    label: 'Fernkampfangriff',
    hint: 'Angriff auf Entfernung – Bonus und Schaden rechnet Wayfarer',
    section: 'action',
    build: () => ({
      ...bare('action', 'Fernkampfangriff'),
      attack: {
        ranged: true,
        ability: 'dex',
        bonus: null,
        reach: '80/320 Fuß',
        dice: '1W6',
        addMod: true,
        damageType: 'Stich',
      },
    }),
  },
  {
    key: 'save',
    label: 'Fähigkeit mit Rettungswurf und Aufladung',
    hint: 'Etwa ein Odem: SG aus Konstitution, wieder bereit bei 5–6',
    section: 'action',
    build: () => ({
      ...bare(
        'action',
        'Flächenangriff',
        'Jede Kreatur in einem Kegel von 15 Fuß legt einen Geschicklichkeitsrettungswurf ab. Misserfolg: [4W6] Schaden. Erfolg: halber Schaden.',
      ),
      saveAbility: 'con',
      uses: 'Aufladung 5–6',
    }),
  },
  {
    key: 'spells',
    label: 'Zauberwirken',
    hint: 'Zauber mit Attribut und SG – die Zauber trägst du ein',
    section: 'action',
    build: (block) => {
      const ability = castingAbility(block);
      return {
        ...bare(
          'action',
          'Zauberwirken',
          `Das Wesen wirkt einen der folgenden Zauber, ohne Materialkomponenten zu brauchen; sein Zauberattribut ist ${ABILITY_NAME[ability]}.\nBeliebig oft: …\nJe 1/Tag: …`,
        ),
        saveAbility: ability,
      };
    },
  },
  {
    key: 'resistance',
    label: 'Legendäre Resistenz',
    hint: 'Einen misslungenen Rettungswurf in einen gelungenen verwandeln',
    section: 'trait',
    build: () => ({
      ...bare(
        'trait',
        'Legendäre Resistenz',
        'Misslingt dem Wesen ein Rettungswurf, kann es stattdessen entscheiden, dass er gelingt.',
      ),
      uses: '3/Tag',
    }),
  },
  {
    key: 'legendary',
    label: 'Legendäre Aktion',
    hint: 'Eine Aktion außerhalb des eigenen Zuges',
    section: 'legendary',
    build: () => bare('legendary', 'Legendäre Aktion'),
  },
];

export function fromTemplate(key: string, block: FullBlock): CreatureFeature | null {
  const template = FEATURE_TEMPLATES.find((entry) => entry.key === key);
  return template ? adoptFeature(template.build(block)) : null;
}

// ── Platzhalter im Text ────────────────────────────────────────────────────

const ABILITY_WORDS: Record<string, AbilityKey> = {
  ...Object.fromEntries(ABILITY_KEYS.map((key) => [foldWord(ABILITY_SHORT[key]), key])),
  str: 'str',
  sta: 'str',
  dex: 'dex',
  ges: 'dex',
  con: 'con',
  kon: 'con',
  int: 'int',
  wis: 'wis',
  wei: 'wis',
  cha: 'cha',
};
const abilityWord = (word: string): AbilityKey | null => ABILITY_WORDS[foldWord(word)] ?? null;

/**
 * Rechnet Platzhalter in eckigen Klammern aus, damit der Text zu den Werten passt, auch wenn sich
 * ein Attribut ändert:
 * - `[SG KON]` → „SG 13“ (8 + Übungsbonus + Modifikator)
 * - `[ANG STÄ]` → „+5“ (Modifikator + Übungsbonus)
 * - `[MOD GES]` → „+2“
 * - `[2W6]` → „7 (2W6)“, `[2W6 STÄ]` → „10 (2W6 + 3)“, `[1W8+2]` → „6 (1W8 + 2)“
 * Was sich nicht lesen lässt, bleibt stehen, wie es geschrieben ist.
 */
export function fillPlaceholders(block: FullBlock, text: string): string {
  if (!text.includes('[')) return text;
  const stats = statsOf(block);
  return text.replace(/\[([^\]\n]{1,24})\]/g, (whole, inner: string) => {
    const words = inner.trim().split(/\s+/);
    const head = foldWord(words[0] ?? '');
    const ability = words[1] ? abilityWord(words[1]) : null;
    if (words.length === 2 && ability) {
      if (head === 'sg' || head === 'dc') return `SG ${8 + stats.pb + stats.mods[ability]}`;
      if (head === 'ang' || head === 'atk') return signed(stats.mods[ability] + stats.pb);
      if (head === 'mod') return signed(stats.mods[ability]);
    }
    if (words.length > 2) return whole;
    const dice = parseDice(words[0] ?? '');
    if (!dice || !dice.count || (words.length === 2 && !ability)) return whole;
    const full = { ...dice, bonus: dice.bonus + (ability ? stats.mods[ability] : 0) };
    return `${Math.max(1, averageOf(full))} (${formatDice(full)})`;
  });
}

/** Die Platzhalter zum Nachschlagen – für den Hinweis im Editor. */
export const PLACEHOLDER_HELP =
  '[SG KON] wird zum Rettungswurf-SG, [ANG STÄ] zum Angriffsbonus, [2W6 STÄ] zu Schaden mit Durchschnitt.';

/** Was eine Fähigkeit als Eintrag der Welt mitbringt: der erste Satz als Kurzbeschreibung. */
export function abilityEntryText(feature: Pick<CreatureFeature, 'text'>): {
  tagline: string;
  notes: string;
} {
  const text = feature.text.trim();
  const first = /^(.{1,200}?[.!?])(\s|$)/s.exec(text)?.[1] ?? text.slice(0, 200);
  return { tagline: first.replace(/\s+/g, ' ').trim(), notes: text };
}
