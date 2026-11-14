/**
 * Nachschlagen in der Ausrüstung des SRD 5.2.1: finden (deutsch und englisch), einen Namen
 * wiedererkennen und nach der Art eines Ladens vorschlagen, was er führen könnte. Reine
 * Funktionen; angelegt wird nichts – das entscheidet der Spielleiter (`features/laden`).
 */
import { SRD_EQUIPMENT, SRD_GROUPS, type SrdGroup, type SrdItem } from './equipment';

export { SRD_EQUIPMENT, SRD_GROUPS, type SrdGroup, type SrdItem } from './equipment';
export { SRD_ATTRIBUTION } from './attribution';

/** Kleinbuchstaben ohne Akzente, „ß“ als „ss“, Satzzeichen als Leerzeichen. */
export function srdKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}()]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** „Seil (15 m)“ → „Seil“: ohne Zusatz in Klammern am Ende. */
const withoutAddition = (text: string): string => text.replace(/\s*\([^)]*\)\s*$/, '').trim();

const BY_ID = new Map(SRD_EQUIPMENT.map((item) => [item.id, item]));

/** Ein Gegenstand nach seiner Kennung; undefined = gibt es nicht (mehr). */
export const srdItem = (id: string | null | undefined): SrdItem | undefined =>
  id ? BY_ID.get(id) : undefined;

/** Die Bezeichnung einer Gruppe. */
export const srdGroupLabel = (group: SrdGroup): string =>
  SRD_GROUPS.find((g) => g.id === group)?.label ?? '';

/** Volle Namen (deutsch, englisch) → Gegenstand; Namen ohne Zusatz nur, wenn sie eindeutig sind. */
const FULL = new Map<string, SrdItem>();
const SHORT = new Map<string, SrdItem[]>();
for (const item of SRD_EQUIPMENT) {
  for (const name of [item.name, item.en]) {
    FULL.set(srdKey(name), item);
    const short = srdKey(withoutAddition(name));
    if (short && short !== srdKey(name)) {
      const list = SHORT.get(short) ?? [];
      if (!list.includes(item)) list.push(item);
      SHORT.set(short, list);
    }
  }
}

/**
 * Welcher Gegenstand des SRD mit einem Namen gemeint ist – deutsch oder englisch, ohne Rücksicht
 * auf Groß- und Kleinschreibung: erst der ganze Name, dann ohne Zusatz in Klammern („Seil (15 m)“
 * → Seil, „Pfeile“ → Pfeile (20)). Nur, wenn es eindeutig ist; sonst null.
 */
export function srdMatch(text: string): SrdItem | null {
  const key = srdKey(text);
  if (!key) return null;
  const full = FULL.get(key);
  if (full) return full;
  const short = srdKey(withoutAddition(text));
  const hit = FULL.get(short);
  if (hit) return hit;
  const shorts = SHORT.get(short) ?? SHORT.get(key);
  return shorts?.length === 1 ? shorts[0]! : null;
}

/**
 * Sucht in der Ausrüstung: Jedes Wort der Suche muss im deutschen oder englischen Namen oder in
 * der Unterteilung stehen. Treffer am Namensanfang zuerst. `groups` schränkt ein (leer = alle).
 */
export function srdSearch(query: string, groups: readonly SrdGroup[] = []): SrdItem[] {
  const words = srdKey(query).split(' ').filter(Boolean);
  const pool = groups.length
    ? SRD_EQUIPMENT.filter((item) => groups.includes(item.group))
    : SRD_EQUIPMENT;
  if (!words.length) return [...pool];
  const scored: { item: SrdItem; score: number; index: number }[] = [];
  pool.forEach((item, index) => {
    const name = srdKey(item.name);
    const en = srdKey(item.en);
    const hay = `${name} ${en} ${srdKey(item.sub)}`;
    if (!words.every((word) => hay.includes(word))) return;
    const first = words[0]!;
    const score =
      name.startsWith(first) || en.startsWith(first)
        ? 0
        : name.split(' ').some((w) => w.startsWith(first)) ||
            en.split(' ').some((w) => w.startsWith(first))
          ? 1
          : 2;
    scored.push({ item, score, index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((s) => s.item);
}

// ── Was ein Laden führen könnte ────────────────────────────────────────────

/**
 * Welche Ausrüstung zu welcher Art von Laden passt – feste Regeln an einer Stelle. `stems` passen
 * auch mitten im Wort („Waffenschmied“ enthält „schmied“), `words` nur als ganzes Wort („Händler“,
 * aber nicht „Pferdehändler“). Ein Laden bekommt alles, was zu einer seiner Regeln passt.
 */
export const SHOP_KIND_RULES: readonly {
  label: string;
  stems?: readonly string[];
  words?: readonly string[];
  groups?: readonly SrdGroup[];
  subs?: readonly string[];
  ids?: readonly string[];
  /** Passt nicht, wenn eines davon im Namen steht („Goldschmied“ ist keine Waffenschmiede). */
  unless?: readonly string[];
}[] = [
  {
    label: 'Schmiede',
    stems: ['schmied', 'schmiede'],
    unless: ['goldschmied', 'silberschmied', 'hufschmied'],
    groups: ['weapons', 'armor'],
    ids: ['srd-chain', 'srd-iron-spikes', 'srd-iron-pot', 'srd-manacles', 'srd-smiths-tools'],
  },
  { label: 'Waffen', stems: ['waffen', 'klingen', 'schwert'], groups: ['weapons', 'ammunition'] },
  {
    label: 'Juwelier',
    stems: ['juwel', 'goldschmied', 'silberschmied', 'edelstein'],
    ids: ['srd-jewelers-tools', 'srd-magnifying-glass', 'srd-mirror', 'srd-lock', 'srd-chest'],
  },
  { label: 'Rüstungen', stems: ['rustung', 'plattner', 'harnisch', 'panzer'], groups: ['armor'] },
  {
    label: 'Bogner',
    stems: ['bogner', 'bogen', 'pfeilmacher', 'armbrust'],
    ids: [
      'srd-shortbow',
      'srd-longbow',
      'srd-light-crossbow',
      'srd-hand-crossbow',
      'srd-heavy-crossbow',
      'srd-arrows',
      'srd-bolts',
      'srd-quiver',
      'srd-crossbow-bolt-case',
    ],
  },
  {
    label: 'Krämer',
    stems: ['kramer', 'gemischtwaren', 'kaufmann', 'kauffrau', 'ausstatter', 'hoker', 'trodler'],
    words: ['handler', 'handlerin', 'laden', 'markt', 'marktstand', 'warenhaus', 'kontor'],
    subs: ['Abenteuerausrüstung', 'Ausrüstungspaket'],
    ids: ['srd-arrows', 'srd-bolts', 'srd-sling-bullets', 'srd-climbers-kit', 'srd-healers-kit'],
  },
  {
    label: 'Stall',
    stems: [
      'stall',
      'pferd',
      'gestut',
      'sattler',
      'fuhrwerk',
      'fuhrmann',
      'wagner',
      'kutsch',
      'hufschmied',
    ],
    groups: ['mounts', 'tack'],
  },
  {
    label: 'Gasthaus',
    stems: ['gasthaus', 'gasthof', 'taverne', 'schanke', 'wirt', 'herberge', 'kneipe', 'spelunke'],
    words: ['krug', 'inn'],
    groups: ['food'],
  },
  {
    label: 'Alchemist',
    stems: ['alchem'],
    ids: [
      'srd-acid',
      'srd-alchemists-fire',
      'srd-antitoxin',
      'srd-potion-of-healing',
      'srd-basic-poison',
      'srd-perfume',
      'srd-oil',
      'srd-vial',
      'srd-glass-bottle',
      'srd-flask',
      'srd-alchemists-supplies',
    ],
  },
  {
    label: 'Kräuter und Heilkunst',
    stems: ['kraut', 'krauter', 'apothek', 'heiler', 'heilkund', 'arznei', 'bader', 'medik'],
    ids: [
      'srd-healers-kit',
      'srd-herbalism-kit',
      'srd-antitoxin',
      'srd-potion-of-healing',
      'srd-vial',
      'srd-flask',
    ],
  },
  {
    label: 'Handwerk',
    stems: [
      'werkzeug',
      'handwerk',
      'tischler',
      'schreiner',
      'zimmer',
      'schuster',
      'topfer',
      'weber',
      'steinmetz',
      'tuftler',
      'kesselflick',
      'glasblas',
      'gerber',
      'brauer',
    ],
    groups: ['tools'],
  },
  {
    label: 'Tempel',
    stems: ['tempel', 'priester', 'kirche', 'schrein', 'kloster', 'kapelle'],
    subs: ['Heiliges Symbol'],
    ids: ['srd-holy-water', 'srd-priests-pack', 'srd-candle', 'srd-healers-kit'],
  },
  {
    label: 'Schreibstube',
    stems: ['schreib', 'buch', 'papier', 'kartograf', 'gelehrt', 'bibliothek', 'archiv'],
    ids: [
      'srd-book',
      'srd-ink',
      'srd-ink-pen',
      'srd-paper',
      'srd-parchment',
      'srd-map',
      'srd-map-case',
      'srd-calligraphers-supplies',
      'srd-cartographers-tools',
      'srd-scholars-pack',
    ],
  },
  {
    label: 'Zauberbedarf',
    stems: ['magie', 'magier', 'zauber', 'arkan', 'hexe', 'okkult'],
    subs: ['Arkaner Fokus'],
    ids: ['srd-component-pouch', 'srd-spell-scroll-cantrip', 'srd-spell-scroll-1'],
  },
  {
    label: 'Druiden',
    stems: ['druid', 'hain'],
    subs: ['Druidischer Fokus'],
    ids: ['srd-herbalism-kit'],
  },
  {
    label: 'Musik',
    stems: ['musik', 'instrument', 'spielmann', 'barde', 'laut'],
    groups: ['instruments'],
  },
  {
    label: 'Schneiderei',
    stems: ['schneider', 'tuch', 'kleid', 'gewand', 'stoff'],
    ids: [
      'srd-fine-clothes',
      'srd-travelers-clothes',
      'srd-costume',
      'srd-robe',
      'srd-blanket',
      'srd-bedroll',
      'srd-weavers-tools',
    ],
  },
  {
    label: 'Jagd',
    stems: ['jager', 'jagd', 'fallensteller', 'trapper', 'pelz', 'kurschner'],
    ids: [
      'srd-hunting-trap',
      'srd-net',
      'srd-shortbow',
      'srd-longbow',
      'srd-arrows',
      'srd-quiver',
      'srd-sling',
      'srd-sling-bullets',
      'srd-javelin',
      'srd-spear',
      'srd-explorers-pack',
    ],
  },
  {
    label: 'Unterwelt',
    stems: ['dieb', 'hehler', 'schwarzmarkt', 'schmuggel', 'gilde der schatten'],
    ids: [
      'srd-thieves-tools',
      'srd-burglars-pack',
      'srd-disguise-kit',
      'srd-forgery-kit',
      'srd-poisoners-kit',
      'srd-basic-poison',
      'srd-caltrops',
      'srd-ball-bearings',
      'srd-crowbar',
      'srd-hooded-lantern',
    ],
  },
  {
    label: 'Hafen',
    stems: ['hafen', 'werft', 'schiff', 'boot', 'fahrmann', 'faehre', 'fahre', 'seefahr'],
    groups: ['ships'],
    ids: [
      'srd-rope',
      'srd-navigators-tools',
      'srd-spyglass',
      'srd-passage-hammock',
      'srd-passage-cabin',
    ],
  },
  {
    label: 'Söldner und Dienste',
    stems: ['sold', 'tagelohn', 'botendienst', 'vermittl'],
    groups: ['services'],
  },
];

/** Die Wörter einer Ladenart, ohne Akzente: „Waffenschmied & Bogner“ → ["waffenschmied", "bogner"]. */
const kindWords = (text: string): string[] =>
  srdKey(text)
    .replace(/[()]/g, ' ')
    .split(' ')
    .filter((word) => word.length >= 3);

/**
 * Was ein Laden dieser Art führen könnte – nach `SHOP_KIND_RULES`: die Ausrüstung (in der
 * Reihenfolge des SRD) und welche Regeln gepasst haben. Leer, wenn keine passt.
 */
export function srdForShopKind(...texts: string[]): { items: SrdItem[]; labels: string[] } {
  const words = texts.flatMap(kindWords);
  const joined = words.join(' ');
  if (!words.length) return { items: [], labels: [] };
  const rules = SHOP_KIND_RULES.filter(
    (rule) =>
      !rule.unless?.some((stem) => joined.includes(stem)) &&
      (rule.stems?.some((stem) => joined.includes(stem)) ||
        rule.words?.some((word) => words.includes(word))),
  );
  const ids = new Set(rules.flatMap((rule) => rule.ids ?? []));
  const items = SRD_EQUIPMENT.filter(
    (item) =>
      ids.has(item.id) ||
      rules.some((rule) => rule.groups?.includes(item.group) || rule.subs?.includes(item.sub)),
  );
  return { items, labels: rules.map((rule) => rule.label) };
}

/** Ein Gewicht zum Lesen: Pfund wie in den deutschen Regelbüchern halbiert – „1,5 kg“. */
export function srdWeightText(lb: number | null): string {
  if (lb === null) return '';
  const kg = Math.round(lb * 0.5 * 100) / 100;
  return `${kg.toLocaleString('de-DE')} kg`;
}
