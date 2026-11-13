/**
 * Was der Steckbrief eines Artikels über die Welt sagt. Feste Regeln, kein Raten: Wayfarer kennt
 * die üblichen Bezeichnungen der Felder („Beruf“, „Wohnort“, „Zugehörigkeit“ …) und sucht zu den
 * Werten die Einträge der Welt – über einen Verweis oder über den Namen. Daraus entsteht ein Plan,
 * was am Eintrag des Artikels zu setzen ist. Was sich nicht zuordnen lässt, bleibt unberührt und
 * wird genannt.
 */
import { lifeWords, readDatePoint } from '../../domain/lifespan';
import { rarityFromText, readPrice } from '../../domain/nature';
import {
  PERSON_STATUS,
  type Article,
  type CampaignData,
  type Entity,
  type EntityKind,
  type PersonStatus,
  type Relation,
} from '../../domain/schema';
import type { Inline } from '../legendkeeper/model';
import { articleNodes, titleKey } from './text';

type Articles = CampaignData['articles'];

// ── Zeilen des Steckbriefs ─────────────────────────────────────────────────

export interface Fact {
  /** Bezeichnung des Feldes, wie sie im Artikel steht. */
  label: string;
  /** Der Wert als reiner Text. */
  text: string;
  /** Artikel, auf die der Wert verweist – in Klammern gesetzt oder am Namen erkannt. */
  links: string[];
  /** Was vom Wert übrig bleibt, wenn man die Verweise herausnimmt. */
  rest: string;
}

const plain = (inlines: Inline[]): string =>
  inlines
    .map((i) => (i.type === 'text' ? i.text : i.type === 'mention' ? i.label : ' '))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

function collectFacts(value: unknown, into: Fact[], depth = 0): void {
  if (depth > 96 || typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    for (const part of value) collectFacts(part, into, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.type === 'facts' && Array.isArray(record.rows)) {
    for (const row of record.rows as { key: string; value: Inline[] }[]) {
      const label = row.key.replace(/\s+/g, ' ').trim();
      const text = plain(row.value);
      if (!label || !text) continue;
      const linked = (i: Inline) => i.type === 'mention' && i.resourceId !== '';
      into.push({
        label,
        text,
        links: row.value.flatMap((i) =>
          i.type === 'mention' && i.resourceId ? [i.resourceId] : [],
        ),
        rest: plain(row.value.filter((i) => !linked(i))),
      });
    }
    return;
  }
  for (const part of Object.values(record)) collectFacts(part, into, depth + 1);
}

const factCache = new WeakMap<Article, { articles: Articles; facts: Fact[] }>();

/** Alle Zeilen „Feld: Wert“ eines Artikels, in der Reihenfolge, in der sie dastehen. */
export function articleFacts(articles: Articles, article: Article): Fact[] {
  const cached = factCache.get(article);
  if (cached && cached.articles === articles) return cached.facts;
  const facts: Fact[] = [];
  collectFacts(articleNodes(articles, article), facts);
  factCache.set(article, { articles, facts });
  return facts;
}

// ── Was die Bezeichnungen bedeuten ─────────────────────────────────────────

/** Vergleicht Bezeichnungen ohne Groß- und Kleinschreibung, Umlaute und Zeichen. */
const norm = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '');

export type FactField =
  | 'kind'
  | 'role'
  | 'species'
  | 'status'
  | 'whereabouts'
  | 'home'
  | 'origin'
  | 'workplace'
  | 'membership'
  | 'location'
  | 'seat'
  | 'leader'
  | 'owner'
  | 'born'
  | 'died'
  | 'habitat'
  | 'region'
  | 'season'
  | 'rarity'
  | 'price'
  | 'tool'
  | 'profession';

export const FIELD_LABEL: Record<FactField, string> = {
  kind: 'Art',
  role: 'Beruf oder Rolle',
  species: 'Spezies',
  status: 'Zustand',
  whereabouts: 'Aufenthaltsort',
  home: 'Zuhause',
  origin: 'Herkunft',
  workplace: 'Arbeitet bei',
  membership: 'Gehört zu',
  location: 'Liegt in',
  seat: 'Sitz',
  leader: 'Führung',
  owner: 'Besitzer',
  born: 'Geboren',
  died: 'Gestorben',
  habitat: 'Lebensraum',
  region: 'Vorkommen',
  season: 'Jahreszeit',
  rarity: 'Seltenheit',
  price: 'Wert',
  tool: 'Werkzeug',
  profession: 'Beruf',
};

/** Lebensdaten im Steckbrief – für alle Arten; was sie bei welcher Art heißen, steht in `lifeWords`. */
const BORN = [
  'Geboren',
  'Geburt',
  'Geburtstag',
  'Geburtsdatum',
  'Geburtsjahr',
  'Jahrgang',
  'Alter',
  'Gegründet',
  'Gründung',
  'Gründungsjahr',
  'Erbaut',
  'Errichtet',
  'Entstanden',
  'Geschaffen',
  'Geschmiedet',
  'Hergestellt',
];
const DIED = [
  'Gestorben',
  'Verstorben',
  'Tod',
  'Todestag',
  'Todesjahr',
  'Aufgelöst',
  'Untergegangen',
  'Untergang',
  'Zerstört',
  'Gefallen',
];

const KIND = ['Art', 'Typ', 'Kategorie', 'Klassifikation'];
const LEADER = [
  'Führung',
  'Anführer',
  'Anführerin',
  'Oberhaupt',
  'Leitung',
  'Leiter',
  'Leiterin',
  'Vorsitz',
  'Meister',
  'Meisterin',
];
const OWNER = ['Besitzer', 'Besitzerin', 'Aktueller Besitzer', 'Eigentümer', 'Eigentümerin'];

/** Pflanze, Tier, Gestein: wo, wann, wie selten, was es wert ist (`domain/nature.ts`). */
const NATURE: Partial<Record<FactField, string[]>> = {
  kind: KIND,
  habitat: ['Lebensraum', 'Lebensräume', 'Habitat', 'Standort', 'Fundort', 'Fundorte'],
  region: ['Vorkommen', 'Gegend', 'Gegenden', 'Verbreitung', 'Region', 'Heimat'],
  season: [
    'Jahreszeit',
    'Jahreszeiten',
    'Zeit',
    'Blütezeit',
    'Erntezeit',
    'Sammelzeit',
    'Brunft',
    'Brunftzeit',
    'Brutzeit',
    'Jagdzeit',
    'Saison',
  ],
  rarity: ['Seltenheit', 'Häufigkeit'],
  price: ['Preis', 'Wert', 'Marktwert', 'Kosten'],
};

/** Welche Bezeichnung bei welcher Art von Eintrag was bedeutet. */
const VOCABULARY: Partial<Record<EntityKind, Partial<Record<FactField, string[]>>>> = {
  person: {
    role: ['Titel', 'Rolle', 'Amt', 'Funktion', 'Tätigkeit', 'Position', 'Stellung', 'Rang'],
    species: ['Spezies', 'Volk', 'Rasse'],
    profession: ['Beruf', 'Berufe', 'Handwerk', 'Gewerbe'],
    status: ['Status', 'Zustand'],
    whereabouts: ['Aufenthaltsort', 'Aufenthalt', 'Befindet sich in', 'Zuletzt gesehen', 'Ort'],
    home: ['Wohnort', 'Wohnsitz', 'Zuhause', 'Heimat', 'Lebt in', 'Wohnt in'],
    origin: ['Herkunft', 'Stammt aus', 'Geburtsort'],
    workplace: ['Arbeitet bei', 'Arbeitet in', 'Arbeitsplatz', 'Arbeitgeber', 'Dient'],
    membership: [
      'Zugehörigkeit',
      'Fraktion',
      'Organisation',
      'Gilde',
      'Orden',
      'Haus',
      'Familie',
      'Clan',
      'Sippe',
      'Mitglied von',
      'Gehört zu',
    ],
  },
  place: {
    kind: KIND,
    location: [
      'Liegt in',
      'Lage',
      'Ort',
      'Region',
      'Gebiet',
      'Standort',
      'Land',
      'Teil von',
      'Gehört zu',
      'Übergeordnet',
    ],
    leader: [
      ...LEADER,
      'Herrscher',
      'Herrscherin',
      'Herrschaft',
      'Regiert von',
      'Regierung',
      'Verwalter',
      'Verwalterin',
      'Vogt',
      'Vögtin',
      'Bürgermeister',
      'Bürgermeisterin',
    ],
    owner: OWNER,
  },
  faction: {
    kind: KIND,
    seat: ['Sitz', 'Hauptsitz', 'Hauptquartier', 'Standort', 'Stammsitz'],
    leader: LEADER,
    membership: ['Zugehörigkeit', 'Gehört zu', 'Teil von'],
  },
  family: {
    kind: KIND,
    seat: ['Sitz', 'Stammsitz', 'Hauptsitz', 'Standort'],
    leader: LEADER,
    membership: ['Zugehörigkeit', 'Gehört zu'],
  },
  item: {
    kind: KIND,
    owner: [...OWNER, 'Träger', 'Trägerin', 'Aufbewahrungsort', 'Ort'],
    price: ['Preis', 'Wert', 'Marktwert', 'Kosten', 'Listenpreis'],
  },
  species: { kind: KIND },
  language: { kind: KIND },
  script: { kind: KIND },
  ability: { kind: KIND },
  topic: { kind: KIND },
  plant: NATURE,
  animal: NATURE,
  mineral: NATURE,
  profession: { kind: KIND, tool: ['Werkzeug', 'Werkzeuge', 'Handwerkszeug'] },
};

for (const kind of ['person', 'place', 'faction', 'family', 'item', 'species', 'topic'] as const)
  VOCABULARY[kind] = { ...VOCABULARY[kind], born: BORN, died: DIED };

const meaningCache = new Map<EntityKind, Map<string, FactField>>();

/** Was eine Bezeichnung bei dieser Art von Eintrag bedeutet; null = sagt Wayfarer nichts. */
export function factField(kind: EntityKind, label: string): FactField | null {
  let map = meaningCache.get(kind);
  if (!map) {
    map = new Map();
    for (const [field, labels] of Object.entries(VOCABULARY[kind] ?? {}))
      for (const entry of labels)
        if (!map.has(norm(entry))) map.set(norm(entry), field as FactField);
    meaningCache.set(kind, map);
  }
  return map.get(norm(label)) ?? null;
}

// ── Art aus einem Wort ─────────────────────────────────────────────────────

/** Wörter, an denen sich die Art eines Eintrags ablesen lässt. Genau oder als Wortende. */
const KIND_WORDS: [EntityKind, string[]][] = [
  ['person', ['Person', 'NSC', 'NPC', 'Figur', 'Charakter']],
  ['family', ['Familie', 'Adelshaus', 'Adelsfamilie', 'Dynastie', 'Geschlecht', 'Sippe']],
  [
    'faction',
    [
      'Fraktion',
      'Gilde',
      'Zunft',
      'Orden',
      'Kult',
      'Sekte',
      '=Bund',
      'Bündnis',
      'Zirkel',
      'Bande',
      'Organisation',
      'Bewegung',
      'Bruderschaft',
      'Schwesternschaft',
      'Partei',
      'Kompanie',
      'Legion',
      'Armee',
      'Clan',
      'Stamm',
      'Gesellschaft',
      'Konsortium',
      'Handelshaus',
      'Syndikat',
      'Widerstand',
    ],
  ],
  [
    'place',
    [
      'Ort',
      'Stadt',
      'Dorf',
      'Weiler',
      'Siedlung',
      'Region',
      'Provinz',
      'Land',
      '=Reich',
      'Kontinent',
      'Insel',
      'Gebirge',
      'Berg',
      'Tal',
      'Wald',
      'Sumpf',
      'Wüste',
      'See',
      'Fluss',
      'Meer',
      'Küste',
      'Hafen',
      'Viertel',
      'Distrikt',
      'Bezirk',
      'Gebäude',
      'Taverne',
      'Gasthaus',
      'Wirtshaus',
      'Schenke',
      'Herberge',
      'Tempel',
      'Schrein',
      'Kloster',
      'Burg',
      'Festung',
      'Feste',
      'Turm',
      'Schloss',
      'Palast',
      'Villa',
      'Anwesen',
      'Gehöft',
      '=Mine',
      'Höhle',
      'Gewölbe',
      'Verlies',
      'Dungeon',
      'Ruine',
      'Arena',
      'Markt',
      'Platz',
      'Brücke',
      'Lager',
      'Akademie',
      'Schule',
      'Bibliothek',
      'Werkstatt',
      'Schmiede',
      'Laden',
      'Rathaus',
      'Planet',
      'Ebene',
      'Welt',
    ],
  ],
  [
    'item',
    [
      'Gegenstand',
      'Artefakt',
      'Waffe',
      'Rüstung',
      'Relikt',
      'Schwert',
      'Amulett',
      'Trank',
      'Elixier',
      'Tinktur',
      'Salbe',
      'Gift',
      'Buch',
      '=Stab',
    ],
  ],
  ['species', ['Spezies', 'Volk', 'Rasse', 'Kreatur', 'Monster']],
  ['language', ['Sprache', 'Dialekt']],
  ['script', ['Schrift', 'Alphabet']],
  ['ability', ['Fähigkeit', '=Gabe', 'Fluch']],
  [
    'plant',
    [
      'Pflanze',
      'Kraut',
      'Heilkraut',
      'Baum',
      'Strauch',
      'Busch',
      'Blume',
      'Pilz',
      'Moos',
      'Flechte',
      'Farn',
      'Alge',
      'Gewächs',
      'Flora',
    ],
  ],
  [
    'animal',
    [
      '=Tier',
      'Tierart',
      'Haustier',
      'Nutztier',
      'Reittier',
      'Lasttier',
      'Zugtier',
      'Raubtier',
      'Wildtier',
      'Säugetier',
      '=Wild',
      'Rotwild',
      'Vogel',
      'Fisch',
      'Insekt',
      'Reptil',
      'Fauna',
    ],
  ],
  [
    'mineral',
    [
      'Gestein',
      'Mineral',
      'Erz',
      'Eisenerz',
      'Kupfererz',
      'Silbererz',
      'Golderz',
      'Edelstein',
      'Kristall',
      'Salz',
    ],
  ],
  ['profession', ['Beruf', 'Handwerk', 'Gewerbe']],
  ['topic', ['Thema', 'Ereignis', 'Begriff', 'Legende', 'Mythos']],
];

/** Ein „=“ vor dem Wort: zählt nur ganz, nicht als Ende eines längeren Wortes („Aufgabe“). */
const KIND_STEMS = KIND_WORDS.flatMap(([kind, words]) =>
  words.map((word) => ({ kind, stem: norm(word), whole: word.startsWith('=') })),
);

/** Mindestlänge, ab der ein Wort auch als Ende eines längeren Wortes zählt („Bergdorf“). */
const SUFFIX_MIN = 4;

function kindOfWord(word: string): EntityKind | null {
  const key = norm(word);
  if (!key) return null;
  let best: { kind: EntityKind; length: number } | null = null;
  let tie = false;
  for (const { kind, stem, whole } of KIND_STEMS) {
    const hit = key === stem || (!whole && stem.length >= SUFFIX_MIN && key.endsWith(stem));
    if (!hit) continue;
    if (!best || stem.length > best.length) {
      best = { kind, length: stem.length };
      tie = false;
    } else if (stem.length === best.length && kind !== best.kind) tie = true;
  }
  return best && !tie ? best.kind : null;
}

/**
 * Liest aus dem Wert eines Feldes „Art“ ab, was für ein Eintrag gemeint ist: „Dorf“ ist ein Ort,
 * „Rebellenfraktion“ eine Fraktion. Null, wenn das Wort nichts verrät.
 */
export function kindFromText(text: string): EntityKind | null {
  const first = text.split(/[,;/(]/)[0] ?? '';
  const words = first.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  // Im Deutschen trägt das letzte Wort die Bedeutung („Religiöse Bewegung“); sonst das erste.
  const order = [words[words.length - 1]!, words[0]!, ...words.slice(1, -1)];
  for (const word of order) {
    const kind = kindOfWord(word);
    if (kind) return kind;
  }
  return null;
}

/** Ordner, deren Name verrät, was darin liegt: „Kräuter“ enthält Pflanzen. Ganz, in der Mehrzahl. */
const FOLDER_WORDS: [EntityKind, string[]][] = [
  ['plant', ['Pflanzen', 'Flora', 'Kräuter', 'Herbarium', 'Pilze', 'Bäume', 'Gewächse']],
  ['animal', ['Tiere', 'Fauna', 'Tierwelt', 'Wildtiere', 'Haustiere', 'Reittiere']],
  ['mineral', ['Mineralien', 'Gesteine', 'Erze', 'Edelsteine', 'Steine', 'Rohstoffe']],
  ['profession', ['Berufe', 'Handwerke', 'Gewerbe']],
  ['person', ['Personen', 'NSC', 'Figuren', 'Leute']],
  ['place', ['Orte', 'Städte', 'Siedlungen']],
  ['faction', ['Fraktionen', 'Gilden', 'Orden']],
  ['family', ['Familien', 'Adelshäuser', 'Dynastien']],
  ['item', ['Gegenstände', 'Artefakte', 'Tränke', 'Gifte', 'Bücher']],
  ['species', ['Spezies', 'Völker', 'Rassen']],
  ['language', ['Sprachen']],
  ['script', ['Schriften']],
  ['ability', ['Fähigkeiten']],
];
const FOLDER_KIND = new Map(
  FOLDER_WORDS.flatMap(([kind, words]) => words.map((word) => [norm(word), kind] as const)),
);

/**
 * Was ein Artikel wohl ist, nach dem Ordner, in dem er liegt: der nächste Ordner, dessen Name es
 * verrät („Flora › Kräuter › Mondkraut“ ist eine Pflanze). Nur ein Vorschlag für „In die Welt
 * aufnehmen“ – angelegt wird erst, wenn der Spielleiter wählt.
 */
export function kindFromFolder(
  articles: Articles,
  article: Pick<Article, 'parentId'>,
): { kind: EntityKind; folder: string } | null {
  const seen = new Set<string>();
  let parentId = article.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const folder = articles[parentId];
    if (!folder) break;
    const kind = FOLDER_KIND.get(norm(folder.title));
    if (kind) return { kind, folder: folder.title };
    parentId = folder.parentId;
  }
  return null;
}

// ── Einträge über den Namen finden ─────────────────────────────────────────

export interface WorldIndex {
  entities: CampaignData['entities'];
  /** Einträge je Name, Zweitname oder Titel des verknüpften Artikels. */
  byName: Map<string, Entity[]>;
  /** Einträge je Artikel. */
  byArticle: Map<string, Entity[]>;
}

const indexCache = new WeakMap<object, { articles: Articles; index: WorldIndex }>();

export function worldIndex(data: Pick<CampaignData, 'entities' | 'articles'>): WorldIndex {
  const cached = indexCache.get(data.entities);
  if (cached && cached.articles === data.articles) return cached.index;
  const byName = new Map<string, Entity[]>();
  const byArticle = new Map<string, Entity[]>();
  const add = (name: string, entity: Entity) => {
    const key = titleKey(name);
    if (!key) return;
    const list = byName.get(key);
    if (!list) byName.set(key, [entity]);
    else if (!list.includes(entity)) list.push(entity);
  };
  // Feste Reihenfolge, damit ein mehrdeutiger Name immer zum selben Eintrag führt.
  const sorted = Object.values(data.entities).sort((a, b) => a.id.localeCompare(b.id));
  for (const entity of sorted) {
    add(entity.name, entity);
    const article = entity.lk ? data.articles[entity.lk.resourceId] : undefined;
    if (article) {
      add(article.title, entity);
      const list = byArticle.get(article.id);
      if (list) list.push(entity);
      else byArticle.set(article.id, [entity]);
    }
  }
  // Zweitnamen erst danach: Der eigentliche Name geht vor.
  for (const entity of sorted) {
    for (const alias of entity.aliases) add(alias, entity);
    const article = entity.lk ? data.articles[entity.lk.resourceId] : undefined;
    for (const alias of article?.aliases ?? []) add(alias, entity);
  }
  // Zuletzt die Namen ohne ihren Artikel: „Die Aalfischer“ findet sich auch als „Aalfischer“.
  for (const entity of sorted)
    if (bare(entity.name) !== entity.name) add(bare(entity.name), entity);
  const index = { entities: data.entities, byName, byArticle };
  indexCache.set(data.entities, { articles: data.articles, index });
  return index;
}

/** Werte, die „nichts“ oder „weiß man nicht“ bedeuten. */
const NOTHING = new Set(
  [
    'unbekannt',
    'ungewiss',
    'unklar',
    'keine',
    'keiner',
    'keines',
    'kein',
    'nichts',
    'niemand',
    'unabhängig',
    'ohne',
    'offen',
    'nein',
    '?',
    '-',
    '–',
    '—',
    'n/a',
    'k. a.',
    'k.a.',
  ].map((word) => titleKey(word)),
);

const LEAD_IN =
  /^(?:in der|in den|in dem|an der|auf der|aus dem|aus der|in|im|bei|beim|aus|von|vom|zu|zur|zum|am|auf)\s+/i;

/** Die Teile eines Wertes, die für sich ein Name sein können: „Unterreich, Anbruch“ sind zwei. */
export function nameParts(text: string): string[] {
  return text
    .split(/\s*[,;/•|]\s*|\s+[-–—]\s+|\s+und\s+/)
    .map((part) =>
      part
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

/** „Der“, „die“, „das“ vor einem Namen – mit und ohne gilt als derselbe Name. */
const ARTICLE = /^(?:der|die|das|dem|den|des)\s+/i;
const bare = (name: string) => name.trim().replace(ARTICLE, '');

function lookup(index: WorldIndex, name: string, kinds: readonly EntityKind[]): Entity | null {
  const plainName = name.replace(LEAD_IN, '');
  for (const candidate of [name, plainName, bare(name), bare(plainName)]) {
    const found = index.byName.get(titleKey(candidate))?.find((e) => kinds.includes(e.kind));
    if (found) return found;
  }
  return null;
}

/** Wie tief ein Ort in der Welt liegt (Zahl der übergeordneten Orte). */
function depthOf(index: WorldIndex, entity: Entity): number {
  let depth = 0;
  let current: Entity | undefined = entity;
  const seen = new Set<string>();
  while (current?.kind === 'place' && current.place.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = index.entities[current.place.parentId];
    depth++;
  }
  return depth;
}

export interface Resolved {
  /** Gefundene Einträge, in der Reihenfolge des Textes. */
  found: Entity[];
  /** Namen, zu denen es keinen passenden Eintrag gibt. */
  missing: string[];
}

/**
 * Sucht die Einträge, die ein Wert meint. Verweise gehen vor; sonst zählt der ganze Wert als
 * Name, dann seine Teile.
 */
export function resolveEntities(
  index: WorldIndex,
  fact: Pick<Fact, 'text' | 'links'> & { rest?: string },
  kinds: readonly EntityKind[],
): Resolved {
  const linked = [
    ...new Set(
      fact.links.flatMap(
        (id) => index.byArticle.get(id)?.filter((e) => kinds.includes(e.kind)) ?? [],
      ),
    ),
  ];
  // Neben den Verweisen kann der Wert weitere Namen nennen: „[[Jost Reuse]], Die Alte vom Wehr“.
  const text = linked.length ? (fact.rest ?? '') : fact.text;
  if (!linked.length) {
    if (NOTHING.has(titleKey(text))) return { found: [], missing: [] };
    const whole = lookup(index, text, kinds);
    if (whole) return { found: [whole], missing: [] };
  }
  const found: Entity[] = linked;
  const missing: string[] = [];
  for (const part of nameParts(text)) {
    if (NOTHING.has(titleKey(part))) continue;
    const entity = lookup(index, part, kinds);
    if (entity) {
      if (!found.includes(entity)) found.push(entity);
    } else missing.push(part);
  }
  return { found, missing };
}

/** Der genaueste Ort unter mehreren: „Unterreich, Anbruch“ meint Anbruch. */
function deepest(index: WorldIndex, entities: Entity[]): Entity | undefined {
  return entities
    .map((entity, order) => ({ entity, order, depth: depthOf(index, entity) }))
    .sort((a, b) => b.depth - a.depth || a.order - b.order)[0]?.entity;
}

// ── Feste Werte ────────────────────────────────────────────────────────────

const STATUS_WORDS: [PersonStatus, RegExp][] = [
  [
    'dead',
    /^(tot|tod|verstorben|gestorben|gefallen|ermordet|hingerichtet|getötet|vernichtet)(?![a-zäöüß])/,
  ],
  ['missing', /^(vermisst|verschollen|verschwunden)(?![a-zäöüß])/],
  ['unknown', /^(unbekannt|ungewiss|unklar)(?![a-zäöüß])/],
  [
    'alive',
    /^(leb[a-zäöüß]*|am leben|aktiv|gesund|wohlauf|verletzt|verwundet|krank|gefangen|inhaftiert)(?![a-zäöüß])/,
  ],
];

/** Liest „Lebendig“, „tot“, „verschollen“ … als Zustand einer Person. */
export function statusFromText(text: string): PersonStatus | null {
  const value = text.trim().toLocaleLowerCase('de');
  for (const [status, pattern] of STATUS_WORDS) if (pattern.test(value)) return status;
  return null;
}

// ── Lesen ──────────────────────────────────────────────────────────────────

export interface Reading {
  field: FactField;
  /** Bezeichnung und Wert, wie sie im Steckbrief stehen. */
  label: string;
  text: string;
  /** Einträge der Welt, die der Wert meint. */
  entities: Entity[];
  /** Namen im Wert, zu denen es keinen Eintrag gibt. */
  missing: string[];
  /** Arten von Einträgen, die hier gemeint sein können – für „anlegen“. */
  kinds: readonly EntityKind[];
  /** Gelesener fester Wert: Zustand einer Person oder Art eines Eintrags. */
  value?: string;
}

const TARGET_KINDS: Partial<Record<FactField, readonly EntityKind[]>> = {
  species: ['species'],
  whereabouts: ['place'],
  home: ['place'],
  origin: ['place'],
  workplace: ['place', 'faction', 'family'],
  membership: ['faction', 'family'],
  location: ['place'],
  seat: ['place'],
  leader: ['person', 'character', 'faction', 'family'],
  owner: ['person', 'character', 'faction', 'family', 'place'],
  region: ['place'],
  profession: ['profession'],
};

/** Liest die Zeilen eines Steckbriefs für einen Eintrag dieser Art. Jedes Feld zählt einmal. */
export function readFacts(index: WorldIndex, facts: Fact[], kind: EntityKind): Reading[] {
  const out: Reading[] = [];
  const seen = new Set<FactField>();
  for (const fact of facts) {
    const field = factField(kind, fact.label);
    if (!field || seen.has(field)) continue;
    seen.add(field);
    const base = {
      field,
      label: fact.label,
      text: fact.text,
      entities: [],
      missing: [],
      kinds: [],
    };
    const kinds = TARGET_KINDS[field];
    if (field === 'status') {
      const status = statusFromText(fact.text);
      if (status) out.push({ ...base, value: status });
    } else if (field === 'rarity') {
      const rarity = rarityFromText(fact.text);
      if (rarity) out.push({ ...base, value: rarity });
    } else if (field === 'kind') {
      const read = kindFromText(fact.text);
      out.push({ ...base, ...(read ? { value: read } : {}) });
    } else if (field === 'species') {
      // „Dunkelelf – 93 Jahre“: Die Spezies steht vorn.
      const name = nameParts(fact.text)[0] ?? fact.text;
      const { found } = resolveEntities(index, { text: name, links: fact.links }, kinds!);
      out.push({ ...base, text: name, entities: found.slice(0, 1), kinds: kinds! });
    } else if (kinds) {
      const { found, missing } = resolveEntities(index, fact, kinds);
      const many =
        field === 'membership' ||
        field === 'leader' ||
        field === 'owner' ||
        field === 'region' ||
        field === 'profession';
      const pick = many ? found : [deepest(index, found)].filter((e): e is Entity => !!e);
      // Bei einem einzelnen Ort ist der Rest des Wertes nur die nähere Angabe („Villa – Zimmer 3“).
      // Ein Beruf ohne Eintrag ist nur die Rolle in Worten – kein fehlender Eintrag.
      const unmatched = field === 'profession' ? [] : missing;
      out.push({ ...base, entities: pick, missing: many || !pick.length ? unmatched : [], kinds });
    } else out.push(base);
  }
  return out;
}

/** Felder, die nur der Steckbrief einer Person trägt. Zwei davon genügen. */
const PERSON_ONLY: FactField[] = ['species', 'role', 'status', 'whereabouts', 'home', 'origin'];

/**
 * Die Art, die der Steckbrief selbst verrät – für Artikel ohne Eintrag in der Welt: über das Feld
 * „Art“ („Art: Dorf“) oder über Felder, die nur eine Person hat (Spezies und Beruf etwa).
 */
export function statedKind(facts: Fact[]): { kind: EntityKind; category: string } | null {
  for (const fact of facts) {
    if (!KIND.some((label) => norm(label) === norm(fact.label))) continue;
    const kind = kindFromText(fact.text);
    return kind ? { kind, category: kind === 'person' ? '' : fact.text.slice(0, 80) } : null;
  }
  const personal = new Set(
    facts.map((fact) => factField('person', fact.label)).filter((field) => field !== null),
  );
  if (personal.has('species') && PERSON_ONLY.filter((field) => personal.has(field)).length >= 2)
    return { kind: 'person', category: '' };
  return null;
}

// ── Zwillinge: Artikel und Eintrag gleichen Namens ─────────────────────────

export interface Twin {
  article: Article;
  entity: Entity;
}

const twinCache = new WeakMap<object, { articles: Articles; twins: Twin[] }>();

/**
 * Artikel ohne Eintrag und Einträge ohne Artikel, die denselben Namen tragen – sie meinen dasselbe
 * Ding. Nur was eindeutig ist: genau ein solcher Artikel und genau ein solcher Eintrag. Nennt der
 * Steckbrief eine andere Art, als der Eintrag hat, gehören die beiden nicht zusammen.
 */
export function twins(data: Pick<CampaignData, 'entities' | 'articles'>): Twin[] {
  const cached = twinCache.get(data.entities);
  if (cached && cached.articles === data.articles) return cached.twins;
  const owned = new Set<string>();
  const free = new Map<string, Entity[]>();
  for (const entity of Object.values(data.entities)) {
    if (entity.lk) {
      owned.add(entity.lk.resourceId);
      continue;
    }
    const key = titleKey(entity.name);
    if (!key) continue;
    const list = free.get(key);
    if (list) list.push(entity);
    else free.set(key, [entity]);
  }
  const waiting = new Map<string, Article[]>();
  for (const article of Object.values(data.articles)) {
    if (article.template || owned.has(article.id)) continue;
    const key = titleKey(article.title);
    if (!free.has(key)) continue;
    const list = waiting.get(key);
    if (list) list.push(article);
    else waiting.set(key, [article]);
  }
  const out: Twin[] = [];
  for (const [key, articles] of waiting) {
    const entities = free.get(key)!;
    if (articles.length !== 1 || entities.length !== 1) continue;
    const [article, entity] = [articles[0]!, entities[0]!];
    const stated = statedKind(articleFacts(data.articles, article))?.kind;
    // Ein Gefährte ist auch eine Person.
    const kind = entity.kind === 'character' ? 'person' : entity.kind;
    if (stated && stated !== kind) continue;
    out.push({ article, entity });
  }
  twinCache.set(data.entities, { articles: data.articles, twins: out });
  return out;
}

// ── Plan: was am Eintrag zu setzen ist ─────────────────────────────────────

export interface RelationWish {
  from: string;
  to: string;
  type: string;
}

export interface FactsPlan {
  /** Der Eintrag mit den Angaben aus dem Steckbrief; derselbe wie vorher, wenn sich nichts ändert. */
  entity: Entity;
  /** Beziehungen, die neu aus dem Steckbrief entstehen. */
  addRelations: RelationWish[];
  /** Beziehungen aus einem früheren Stand des Steckbriefs, die dort nicht mehr stehen. */
  removeRelations: string[];
  /** Was gelesen wurde – auch das, was sich nicht zuordnen ließ. */
  readings: Reading[];
  /** Kurz und lesbar, was sich ändert: „Aufenthaltsort: Hohenfurt“. */
  changes: string[];
}

const ROLE_MAX = 160;

/** Liegt `placeId` unter `ancestorId` – oder ist er es selbst? */
function isUnder(index: WorldIndex, placeId: string, ancestorId: string): boolean {
  let current: Entity | undefined = index.entities[placeId];
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    if (current.id === ancestorId) return true;
    seen.add(current.id);
    current =
      current.kind === 'place' && current.place.parentId
        ? index.entities[current.place.parentId]
        : undefined;
  }
  return false;
}

const sameValue = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((value, i) => value === b[i])
    : a === b;

/** Wörter eines Wertes: „Wald, Sumpf und Moor“ sind drei. */
const valueWords = (text: string) => nameParts(text).map((part) => part.slice(0, 60));

const sameRecord = (a: Record<string, string>, b: Record<string, string>) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

/** Wie die Angaben heißen, die ein Eintrag aus dem Steckbrief übernimmt – nach dem Namen, unter dem er sie sich merkt. */
const SHARE_LABEL: Record<string, string> = {
  role: FIELD_LABEL.role,
  status: FIELD_LABEL.status,
  species: FIELD_LABEL.species,
  speciesId: FIELD_LABEL.species,
  placeId: FIELD_LABEL.whereabouts,
  homeId: FIELD_LABEL.home,
  workplaceId: FIELD_LABEL.workplace,
  parentId: FIELD_LABEL.location,
  seatId: FIELD_LABEL.seat,
  category: FIELD_LABEL.kind,
  holderId: FIELD_LABEL.owner,
  habitat: FIELD_LABEL.habitat,
  regionIds: FIELD_LABEL.region,
  seasons: FIELD_LABEL.season,
  rarity: FIELD_LABEL.rarity,
  price: FIELD_LABEL.price,
  tool: FIELD_LABEL.tool,
};

/**
 * Was ein Eintrag der Welt gerade aus dem Steckbrief seines Artikels hat: die Bezeichnungen der
 * Angaben (in der Reihenfolge des Steckbriefs, jede einmal) und die Zahl der Beziehungen.
 */
export function articleShare(entity: Pick<Entity, 'fromArticle'>): {
  fields: string[];
  relations: number;
} {
  const fields: string[] = [];
  let relations = 0;
  for (const key of Object.keys(entity.fromArticle)) {
    if (key.includes('>') || key.includes('<')) relations++;
    else {
      const label = SHARE_LABEL[key];
      if (label && !fields.includes(label)) fields.push(label);
    }
  }
  return { fields, relations };
}

/** Unter welchem Namen sich der Eintrag eine übernommene Beziehung merkt. */
const relationMark = (entityId: string, wish: RelationWish) =>
  wish.from === entityId ? `${wish.type}>${wish.to}` : `${wish.type}<${wish.from}`;

/**
 * Was der Steckbrief des Artikels für seinen Eintrag in der Welt bedeutet. Rechnet nur; geschrieben
 * wird in `actions.ts`.
 *
 * Der Artikel gilt, wenn sich der Artikel ändert: Jede Angabe wird übernommen, sobald ihr Wortlaut
 * im Steckbrief neu oder anders ist. Steht derselbe Wortlaut wie beim letzten Mal da, bleibt der
 * Eintrag, wie er ist – auch wenn er inzwischen von Hand geändert wurde (ein NSC ist am Tisch
 * weitergezogen). Zweimal nacheinander ausgeführt, ändert der zweite Lauf deshalb nichts.
 */
export function planFacts(data: CampaignData, article: Article, entity: Entity): FactsPlan {
  const index = worldIndex(data);
  const readings = readFacts(index, articleFacts(data.articles, article), entity.kind);
  const changes: string[] = [];
  /** Was diesmal im Steckbrief steht: je Angabe der Wortlaut. */
  const stated: Record<string, string> = {};
  const wishes: RelationWish[] = [];
  let next: Entity = entity;

  /** Setzt eine Einzelangabe, wenn der Steckbrief hier etwas Neues sagt. */
  const set = (
    reading: Reading,
    key: string,
    value: unknown,
    shown: string,
    as: FactField = reading.field,
  ) => {
    stated[key] = reading.text;
    if (entity.fromArticle[key] === reading.text) return;
    const group = next.kind;
    const details = (next as unknown as Record<string, Record<string, unknown>>)[group]!;
    if (sameValue(details[key], value)) return;
    next = { ...next, [group]: { ...details, [key]: value } } as Entity;
    changes.push(`${FIELD_LABEL[as]}: ${shown}`);
  };
  const first = (reading: Reading) => reading.entities.find((e) => e.id !== entity.id);
  const has = (field: FactField) => readings.some((r) => r.field === field && r.entities.length);
  const others = (reading: Reading) => reading.entities.filter((e) => e.id !== entity.id);

  for (const reading of readings) {
    const target = first(reading);
    switch (reading.field) {
      case 'role':
        set(reading, 'role', reading.text.slice(0, ROLE_MAX), reading.text.slice(0, ROLE_MAX));
        break;
      case 'status':
        if (reading.value && (PERSON_STATUS as readonly string[]).includes(reading.value))
          set(reading, 'status', reading.value, reading.text);
        break;
      case 'species':
        if (target) set(reading, 'speciesId', target.id, target.name);
        // Keine Spezies dieses Namens in der Welt: Der Name bleibt als Text stehen.
        else set(reading, 'species', reading.text, reading.text);
        break;
      case 'whereabouts':
        if (target) set(reading, 'placeId', target.id, target.name);
        break;
      case 'home':
        if (target) set(reading, 'homeId', target.id, target.name);
        break;
      case 'origin':
        // Die Herkunft gilt als Zuhause, solange der Steckbrief keinen Wohnort nennt.
        if (target && !has('home')) set(reading, 'homeId', target.id, target.name, 'home');
        break;
      case 'workplace':
        if (target) set(reading, 'workplaceId', target.id, target.name);
        break;
      case 'location':
        // Ein Ort liegt nie in sich selbst oder in einem Ort, der unter ihm liegt.
        if (target && !isUnder(index, target.id, entity.id))
          set(reading, 'parentId', target.id, target.name);
        break;
      case 'seat':
        if (target) set(reading, 'seatId', target.id, target.name);
        break;
      case 'kind':
        if (
          (!reading.value || reading.value === entity.kind) &&
          entity.kind !== 'person' &&
          entity.kind !== 'character'
        )
          set(reading, 'category', reading.text.slice(0, 80), reading.text.slice(0, 80));
        break;
      case 'membership':
        for (const other of others(reading))
          wishes.push({ from: entity.id, to: other.id, type: 'member' });
        break;
      case 'profession':
        for (const other of others(reading))
          wishes.push({ from: entity.id, to: other.id, type: 'practises' });
        // „Beruf: Schmied“ ist auch die Rolle, solange der Steckbrief keine eigene nennt.
        if (!readings.some((r) => r.field === 'role'))
          set(
            reading,
            'role',
            reading.text.slice(0, ROLE_MAX),
            reading.text.slice(0, ROLE_MAX),
            'role',
          );
        break;
      case 'habitat':
        set(reading, 'habitat', valueWords(reading.text), reading.text);
        break;
      case 'season':
        set(reading, 'seasons', valueWords(reading.text), reading.text);
        break;
      case 'region': {
        const found = others(reading);
        if (found.length)
          set(
            reading,
            'regionIds',
            found.map((e) => e.id),
            found.map((e) => e.name).join(', '),
          );
        break;
      }
      case 'rarity':
        if (reading.value) set(reading, 'rarity', reading.value, reading.text);
        break;
      case 'price': {
        const price = readPrice(reading.text);
        if (typeof price === 'number') set(reading, 'price', price, reading.text);
        break;
      }
      case 'tool':
        set(reading, 'tool', reading.text.slice(0, ROLE_MAX), reading.text.slice(0, ROLE_MAX));
        break;
      case 'leader':
        for (const other of others(reading))
          wishes.push({
            from: other.id,
            to: entity.id,
            type: entity.kind === 'place' ? 'rules' : 'leads',
          });
        break;
      case 'owner':
        if (entity.kind === 'item') {
          if (target) set(reading, 'holderId', target.id, target.name);
        } else
          for (const other of others(reading))
            wishes.push({ from: other.id, to: entity.id, type: 'owns' });
        break;
      case 'born':
      case 'died': {
        // Lebensdaten: „Geboren: 3. Tauwind 667“, „Alter: 34“, „Gegründet: vor 300 Jahren“.
        const key = reading.field === 'born' ? 'born' : 'ended';
        // „Alter: 34“ ist ein Alter; „Geboren: 650“ ein Jahr, „Geboren: 34 Jahre“ wieder ein Alter.
        const bareAge = reading.field === 'born' && norm(reading.label) === 'alter';
        const age = reading.field === 'born' && (entity.kind === 'person' || bareAge);
        const point = readDatePoint(data.campaign.calendar, reading.text, data.state.now, {
          age,
          bareAge,
        });
        if (!point) break;
        stated[key] = reading.text;
        if (entity.fromArticle[key] === reading.text) break;
        const current = next[key];
        if (current && current.at === point.at && current.precision === point.precision) break;
        next = { ...next, [key]: point };
        const words = lifeWords(entity.kind);
        changes.push(`${reading.field === 'born' ? words.start : words.end}: ${reading.text}`);
        break;
      }
    }
  }

  // Beziehungen: Was dieser Artikel früher ergab und nicht mehr sagt, fällt weg; Neues kommt
  // hinzu. Eine übernommene Beziehung, die von Hand gelöscht wurde, entsteht nicht von selbst neu.
  const relations = Object.values(data.relations);
  const key = (r: RelationWish) => `${r.from}|${r.to}|${r.type}`;
  const wanted = new Map(wishes.map((wish) => [key(wish), wish]));
  for (const wish of wanted.values()) stated[relationMark(entity.id, wish)] = '1';
  const removeRelations = relations
    .filter(
      (r) =>
        r.articleId === article.id &&
        (r.from === entity.id || r.to === entity.id) &&
        !wanted.has(key(r)),
    )
    .map((r) => r.id);
  const exists = (wish: RelationWish) =>
    relations.some((r: Relation) => !r.ended && key(r) === key(wish));
  const addRelations = [...wanted.values()].filter(
    (wish) => !exists(wish) && entity.fromArticle[relationMark(entity.id, wish)] === undefined,
  );
  const nameOf = (id: string) => data.entities[id]?.name ?? '?';
  const shown = (wish: RelationWish) =>
    wish.type === 'member'
      ? `${FIELD_LABEL.membership}: ${nameOf(wish.to)}`
      : wish.type === 'practises'
        ? `${FIELD_LABEL.profession}: ${nameOf(wish.to)}`
        : wish.type === 'owns'
          ? `${FIELD_LABEL.owner}: ${nameOf(wish.from)}`
          : `${FIELD_LABEL.leader}: ${nameOf(wish.from)}`;
  for (const wish of addRelations) changes.push(shown(wish));
  for (const id of removeRelations) {
    const relation = data.relations[id];
    if (relation) changes.push(`Entfällt – ${shown(relation)}`);
  }

  if (!sameRecord(stated, next.fromArticle)) next = { ...next, fromArticle: stated };
  return { entity: next, addRelations, removeRelations, readings, changes };
}

// ── Überblick: was noch nicht in der Welt steht ────────────────────────────

export interface MissingName {
  /** Der Name, wie er im Steckbrief steht. */
  name: string;
  /** In welchen Feldern er steht. */
  fields: FactField[];
  /** Als was der Eintrag angelegt werden kann; die naheliegende Art zuerst. */
  kinds: EntityKind[];
  /** Artikel, in deren Steckbrief der Name steht. */
  articleIds: string[];
}

export interface PendingFacts {
  /** Einträge, deren Steckbrief mehr oder anderes sagt als sie selbst. */
  changes: { article: Article; entity: Entity; changes: string[] }[];
  /** Artikel ohne Eintrag, deren Steckbrief verrät, was sie beschreiben. */
  create: { article: Article; kind: EntityKind }[];
  /** Namen in Steckbriefen, zu denen es keinen Eintrag gibt – am häufigsten Genannte zuerst. */
  missing: MissingName[];
}

/**
 * Was die Steckbriefe sagen, ohne dass es schon in der Welt steht – für die genannten Artikel
 * oder, ohne Angabe, für alle.
 */
export function pendingFacts(data: CampaignData, articleIds?: readonly string[]): PendingFacts {
  const index = worldIndex(data);
  const out: PendingFacts = { changes: [], create: [], missing: [] };
  const missing = new Map<string, MissingName>();
  const ids = articleIds ?? Object.keys(data.articles);
  for (const id of ids) {
    const article = data.articles[id];
    if (!article || article.template) continue;
    const owners = index.byArticle.get(id) ?? [];
    if (!owners.length) {
      const facts = articleFacts(data.articles, article);
      const stated = facts.length ? statedKind(facts) : null;
      if (stated) out.create.push({ article, kind: stated.kind });
      continue;
    }
    for (const entity of owners) {
      const plan = planFacts(data, article, entity);
      if (plan.changes.length) out.changes.push({ article, entity, changes: plan.changes });
      for (const reading of plan.readings)
        for (const name of reading.missing) {
          const key = titleKey(bare(name));
          const kinds = reading.kinds.filter((kind) => kind !== 'character');
          const entry = missing.get(key);
          if (entry) {
            if (!entry.articleIds.includes(id)) entry.articleIds.push(id);
            if (!entry.fields.includes(reading.field)) entry.fields.push(reading.field);
            for (const kind of kinds) if (!entry.kinds.includes(kind)) entry.kinds.push(kind);
          } else missing.set(key, { name, fields: [reading.field], kinds, articleIds: [id] });
        }
    }
  }
  out.missing = [...missing.values()].sort(
    (a, b) => b.articleIds.length - a.articleIds.length || a.name.localeCompare(b.name, 'de'),
  );
  return out;
}
