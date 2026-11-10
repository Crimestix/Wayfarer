/**
 * Erkennt, was ein Artikel beschreibt: eine Person, einen Ort, eine Fraktion oder einen
 * Gegenstand. Feste Regeln, kein Raten: Gezählt werden die Vorlage des Steckbriefs, die
 * Schlagworte, das Symbol und ob der Artikel eine Karte hat oder auf einer liegt. Nur wenn die
 * Hinweise eindeutig sind, gibt es ein Ergebnis – alles andere bleibt ein reiner Wiki-Artikel
 * und lässt sich von Hand in die Welt aufnehmen.
 */
import type { LkResourceInfo } from './lkexport';

export type RecognizedKind = 'person' | 'place' | 'faction' | 'item';

export const RECOGNIZED_KINDS: readonly RecognizedKind[] = ['person', 'place', 'faction', 'item'];

export interface Recognition {
  kind: RecognizedKind;
  /** Freie Einordnung, soweit erkennbar: „Stadt“, „Tempel“, „Gewölbe“ … */
  category: string;
}

/** Schlagworte und Überschriften vergleichen sich ohne Groß- und Kleinschreibung und Zeichen. */
const norm = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const words = (...values: string[]) => new Set(values.map(norm));

/** Felder der Steckbrief-Vorlagen, die nur bei einer Art von Artikel vorkommen. */
const TEMPLATE: Record<RecognizedKind, Set<string>> = {
  person: words('FRIENDS', 'ENEMIES', 'Freunde', 'Feinde', 'Verbündete'),
  place: words('LOCATED IN', 'Liegt in', 'Gelegen in'),
  faction: words(
    'FOUNDER',
    'HEADQUARTERS',
    'MEMBERS',
    'Gründer',
    'Gegründet von',
    'Hauptsitz',
    'Mitglieder',
  ),
  item: words('CREATOR', 'Erschaffer', 'Erschaffen von'),
};

const TAGS: Record<RecognizedKind, Set<string>> = {
  person: words(
    'NPC',
    'NSC',
    'MinorNPC',
    'MajorNPC',
    'character',
    'Charakter',
    'Charaktere',
    'Person',
    'Personen',
  ),
  place: words(
    'POI',
    'location',
    'place',
    'Ort',
    'Orte',
    'Stadt',
    'Städte',
    'city',
    'town',
    'Dorf',
    'village',
    'Siedlung',
    'settlement',
    'Region',
    'Land',
    'country',
    'Kontinent',
    'continent',

    'Planet',
    'Distrikt',
    'district',
    'Viertel',
    'Dungeon',
    'Dungeonraum',
    'Gewölbe',
    'Bastion',
    'Gebäude',
    'building',
    'Fluss',
    'Unterreich',
  ),
  faction: words(
    'Fraktion',
    'Fraktionen',
    'faction',
    'organization',
    'Organisation',
    'Gilde',
    'guild',
    'Orden',
    'Kult',
  ),
  item: words('item', 'artifact', 'Artefakt', 'Gegenstand', 'Gegenstände'),
};

/** Symbole, wie LegendKeeper sie nennt (ohne Vorsatz wie „fas fa-“). */
const ICONS: Record<RecognizedKind, RegExp> = {
  person: /^(user(-(?!group)[a-z-]+)?|person(-[a-z-]+)?|child|baby)$/,
  place:
    /^(map-pin|location-(pin|dot)|city|house(-[a-z-]+)?|building(-[a-z-]+)?|place-of-worship|church|dungeon|castle|fort|tower-[a-z-]+|mountains?|trees?|forest|island-[a-z-]+|earth-[a-z-]+|globe|map|landmark(-[a-z-]+)?|tent|campground|shop|store|warehouse|bridge(-[a-z-]+)?|volcano|igloo|anchor|ship)$/,
  faction: /^(users(-[a-z-]+)?|people-group|user-group|flag|chess-rook)$/,
  item: /^(gem|ring|sword|swords|axe(-[a-z-]+)?|bow-arrow|staff|wand(-[a-z-]+)?|flask(-[a-z-]+)?|crown|key|shield(-[a-z-]+)?)$/,
};

/**
 * Symbole, die auch die Einordnung verraten. Bewusst wenige: Viele Symbole sind nur die Vorgabe
 * einer Vorlage (das Gotteshaus etwa steht in LegendKeeper bei jedem „Ort“).
 */
const PLACE_ICON_CATEGORY: [RegExp, string][] = [
  [/^city$/, 'Stadt'],
  [/^dungeon$/, 'Gewölbe'],
  [/^island-.*$/, 'Insel'],
  [/^mountains?$/, 'Gebirge'],
  [/^(trees?|forest)$/, 'Wald'],
];

/** Schlagworte, die zwar einen Ort anzeigen, als Einordnung aber nichts sagen. */
const PLAIN_PLACE_TAGS = words('POI', 'location', 'place', 'Ort', 'Orte');

/** Artikel, die nur andere Artikel ordnen. */
const STRUCTURE_TAGS = words(
  'Strukturartikel',
  'Struktur',
  'Ordner',
  'folder',
  'Kategorie',
  'category',
  'Übersicht',
  'index',
);

/** Entwürfe und Abgelegtes gehören nicht in die Welt. */
const DRAFT_TAGS = words('draft', 'Entwurf', 'Entwürfe', 'unused', 'Archiv');

export const isDraft = (info: Pick<LkResourceInfo, 'tags'>): boolean =>
  info.tags.some((tag) => DRAFT_TAGS.has(norm(tag)));

/** Was der Artikel beschreibt – oder null, wenn die Hinweise fehlen oder sich widersprechen. */
export function recognizeKind(info: LkResourceInfo): Recognition | null {
  if (info.template) return null;
  const titles = info.propertyTitles.map(norm);
  const tags = info.tags.map(norm);
  // Ein Ordner („Siedlungen“, „Leute“) trägt oft das Symbol seines Inhalts, ist aber
  // selbst nichts davon: als Ordner markiert oder ohne eigenen Text. Eine Karte widerlegt das.
  const folder =
    !info.hasMap &&
    (tags.some((tag) => STRUCTURE_TAGS.has(tag)) || (info.hasChildren && !info.hasText));
  const score: Record<RecognizedKind, number> = { person: 0, place: 0, faction: 0, item: 0 };
  for (const kind of RECOGNIZED_KINDS) {
    if (titles.some((title) => TEMPLATE[kind].has(title))) score[kind] += 3;
    if (tags.some((tag) => TAGS[kind].has(tag))) score[kind] += 2;
    // Das Symbol allein zählt nur bei Artikeln ohne Unterartikel – außer bei Orten, die
    // naturgemäß weitere Orte enthalten.
    const alone = score[kind] === 0 && info.hasChildren && kind !== 'place';
    if (!folder && !alone && ICONS[kind].test(info.icon)) score[kind] += 2;
  }
  if (info.hasMap) score.place += 1;
  if (info.pinned) score.place += 1;

  const ranked = [...RECOGNIZED_KINDS].sort((a, b) => score[b] - score[a]);
  const best = ranked[0]!;
  // Eine Karte oder ein Kartenpunkt allein reicht nicht; zwei gleich starke Deutungen auch nicht.
  if (score[best] < 2 || score[best] === score[ranked[1]!]) return null;

  let category = '';
  if (best === 'place') {
    const tag = info.tags.find((t) => TAGS.place.has(norm(t)) && !PLAIN_PLACE_TAGS.has(norm(t)));
    category = tag ?? PLACE_ICON_CATEGORY.find(([icon]) => icon.test(info.icon))?.[1] ?? '';
  }
  return { kind: best, category };
}
