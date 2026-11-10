/**
 * Bekannte Namen im Text erkennen – auch ohne Klammern. Steht in einem Artikel der Titel oder ein
 * Zweitname eines anderen Artikels, wird er beim Lesen zum Verweis: anklickbar, als Rückverweis
 * gezählt und für den Steckbrief als Verweis gewertet. Am Text selbst ändert sich nichts.
 *
 * Feste Regeln: Der Name muss genau so dastehen (Groß- und Kleinschreibung zählt), als ganzes Wort
 * oder mit angehängtem „s“ („Miras Boot“). „Der/Die/Das“ am Anfang eines Titels darf fehlen. Sehr kurze Namen, klein geschriebene
 * Titel, Allerweltswörter und Artikel, bei denen es abgeschaltet ist, bleiben außen vor.
 */
import type { Article, CampaignData } from '../../domain/schema';
import type { ArticleNode, Inline } from '../legendkeeper/model';

type Articles = CampaignData['articles'];

export interface NameHit {
  from: number;
  to: number;
  /** Der Artikel, den der Name meint. */
  id: string;
}

export interface NameMatcher {
  /** Alle erkannten Namen in einem Text, von links nach rechts, ohne Überschneidung. */
  find: (text: string) => NameHit[];
}

/** Kürzer zählt ein Name nicht – die Gefahr, ein gewöhnliches Wort zu treffen, ist zu groß. */
const MIN_LENGTH = 3;

/** Titel, die als Wort in jedem Text stehen können und deshalb nie von selbst verknüpft werden. */
const COMMON = new Set(
  [
    'Allgemein',
    'Art',
    'Ort',
    'Rat',
    'See',
    'Tag',
    'Tod',
    'Tor',
    'Weg',
    'Allgemeines',
    'Artikel',
    'Aussehen',
    'Beschreibung',
    'Bewohner',
    'Ereignisse',
    'Familie',
    'Fraktionen',
    'Gegenstände',
    'Geheimnis',
    'Geheimnisse',
    'Geschichte',
    'Gesellschaft',
    'Glaube',
    'Götter',
    'Handel',
    'Herkunft',
    'Karte',
    'Karten',
    'Kultur',
    'Länder',
    'Magie',
    'Monster',
    'Notizen',
    'Orte',
    'Personen',
    'Politik',
    'Regeln',
    'Religion',
    'Session',
    'Sessions',
    'Sprache',
    'Sprachen',
    'Städte',
    'Übersicht',
    'Vergangenheit',
    'Völker',
    'Welt',
    'Wissen',
    'Zeit',
    'Ziele',
    // Wörter, die in erzählendem Text ständig vorkommen, ohne den Artikel dieses Titels zu meinen.
    'Anfang',
    'Dunkelheit',
    'Ende',
    'Erde',
    'Feuer',
    'Frieden',
    'Gefangene',
    'Gruppe',
    'Hafen',
    'Himmel',
    'Hoffnung',
    'Kampagne',
    'Krieg',
    'Leben',
    'Licht',
    'Liebe',
    'Luft',
    'Macht',
    'Markt',
    'Nacht',
    'Reich',
    'Reiche',
    'Ruine',
    'Ruinen',
    'Schatten',
    'Seele',
    'Stadt',
    'Wahrheit',
    'Wasser',
    'Zug',
  ].map((word) => word.toLocaleLowerCase('de')),
);

const LEADING_ARTICLE = /^(?:Der|Die|Das|Dem|Den|Des)\s+/;
const WORD = /[\p{L}\p{N}]+/gu;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const firstWord = (name: string): string | null => {
  WORD.lastIndex = 0;
  const match = WORD.exec(name);
  return match && match.index === 0 ? match[0] : null;
};

/** Taugt ein Name dazu, im Text erkannt zu werden? */
export function isLinkableName(name: string): boolean {
  if (name.length < MIN_LENGTH) return false;
  const first = name[0]!;
  // Klein geschriebene Titel sind fast immer gewöhnliche Wörter („draft“, „notizen“).
  if (first.toLocaleLowerCase('de') === first && first.toLocaleUpperCase('de') !== first)
    return false;
  if (!firstWord(name)) return false;
  return !COMMON.has(name.toLocaleLowerCase('de'));
}

interface Candidate {
  name: string;
  id: string;
  /** Titel ohne sein „Der/Die/Das“: zählt nur, wenn im Text ein solches Wort davorsteht. */
  bare: boolean;
}

/** „der “, „den “, „des “ … unmittelbar vor einer Stelle. */
const ARTICLE_BEFORE = /(?:^|[^\p{L}\p{N}])(?:der|die|das|den|dem|des)\s$/iu;

/**
 * Baut den Erkenner für einen Stand des Wikis. `resolve` sagt, zu welchem Artikel ein Name führt –
 * dieselbe Regel wie bei Verweisen in Klammern.
 */
export function nameMatcher(
  articles: Articles,
  resolve: (name: string) => { id: string } | null,
): NameMatcher {
  const byFirst = new Map<string, Candidate[]>();
  const taken = new Set<string>();
  const add = (name: string, article: Article, bare = false) => {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!isLinkableName(clean) || taken.has(clean)) return;
    // Führt der Name nach den Regeln der Verweise woandershin, gilt das.
    const target = resolve(clean);
    const id = target ? target.id : article.id;
    if (articles[id]?.template || articles[id]?.autoLink === false) return;
    taken.add(clean);
    const key = firstWord(clean)!;
    const list = byFirst.get(key);
    if (list) list.push({ name: clean, id, bare });
    else byFirst.set(key, [{ name: clean, id, bare }]);
  };
  const sorted = Object.values(articles)
    .filter((article) => !article.template && article.autoLink !== false)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const article of sorted) add(article.title, article);
  for (const article of sorted) for (const alias of article.aliases) add(alias, article);
  // Zuletzt die Titel ohne ihr „Der/Die/Das“: „Die Aalfischer“ steht im Satz als „der Aalfischer“
  // oder „den Aalfischer“. Erkannt wird das nur, wenn ein solches Wort davorsteht – sonst träfe
  // „Das Licht“ jedes „Licht“ im Text.
  for (const article of sorted)
    if (LEADING_ARTICLE.test(article.title))
      add(article.title.replace(LEADING_ARTICLE, ''), article, true);
  // Der längste Name zuerst: „Haus Tannhaus“ geht vor „Haus“.
  for (const list of byFirst.values()) list.sort((a, b) => b.name.length - a.name.length);

  /** Wo ein Name endet, wenn er an dieser Stelle als ganzes Wort steht; sonst -1. */
  const endOf = (text: string, at: number, name: string): number => {
    if (!text.startsWith(name, at)) return -1;
    let end = at + name.length;
    const next = text[end];
    if (next === undefined || !WORD_CHAR.test(next)) {
      // „Miras“ schreibt sich bei Namen auf s, x, z mit Apostroph: „Tannhaus’ Boot“.
      return end;
    }
    // Angehängtes „s“: „Miras Boot“, „Hohenfurts Mauern“.
    if (next === 's' && !/[sßxz]$/i.test(name)) {
      end++;
      const after = text[end];
      if (after === undefined || !WORD_CHAR.test(after)) return end;
    }
    return -1;
  };

  return {
    find: (text) => {
      const hits: NameHit[] = [];
      if (!byFirst.size) return hits;
      const words = new RegExp(WORD.source, 'gu');
      let match: RegExpExecArray | null;
      while ((match = words.exec(text))) {
        const word = match[0];
        const candidates =
          byFirst.get(word) ?? (word.endsWith('s') ? byFirst.get(word.slice(0, -1)) : undefined);
        if (!candidates) continue;
        for (const candidate of candidates) {
          const end = endOf(text, match.index, candidate.name);
          if (end < 0) continue;
          if (
            candidate.bare &&
            !ARTICLE_BEFORE.test(text.slice(Math.max(0, match.index - 5), match.index))
          )
            continue;
          hits.push({
            from: match.index,
            to: match.index + candidate.name.length,
            id: candidate.id,
          });
          words.lastIndex = Math.max(words.lastIndex, end);
          break;
        }
      }
      return hits;
    },
  };
}

// ── In die Knoten der Anzeige einsetzen ────────────────────────────────────

type Finder = (text: string) => NameHit[];

/** Teilt die Textstücke eines Absatzes an den erkannten Namen. Ohne Treffer dieselbe Liste. */
function linkInlines(inlines: Inline[], find: Finder, selfId: string): Inline[] {
  let out: Inline[] | null = null;
  inlines.forEach((inline, index) => {
    if (inline.type !== 'text' || inline.code || inline.href) {
      out?.push(inline);
      return;
    }
    // Der Artikel verweist nie auf sich selbst.
    const hits = find(inline.text).filter((hit) => hit.id !== selfId);
    if (!hits.length) {
      out?.push(inline);
      return;
    }
    out ??= inlines.slice(0, index);
    const { type: _type, text, ...style } = inline;
    let at = 0;
    for (const hit of hits) {
      if (hit.from > at) out.push({ ...inline, text: text.slice(at, hit.from) });
      out.push({
        type: 'mention',
        resourceId: hit.id,
        label: text.slice(hit.from, hit.to),
        implicit: true,
        ...(Object.keys(style).length ? { style } : {}),
      });
      at = hit.to;
    }
    if (at < text.length) out.push({ ...inline, text: text.slice(at) });
  });
  return out ?? inlines;
}

/** Wendet `change` auf jede Liste an und gibt dieselbe Liste zurück, wenn sich nichts ändert. */
function mapSame<T>(list: T[], change: (item: T) => T): T[] {
  let out: T[] | null = null;
  list.forEach((item, index) => {
    const next = change(item);
    if (next !== item) out ??= list.slice(0, index);
    out?.push(next);
  });
  return out ?? list;
}

/**
 * Setzt in den Knoten eines Artikels erkannte Namen als Verweise ein. Überschriften und Code
 * bleiben, wie sie sind. Der Artikel verweist nie auf sich selbst.
 */
export function linkNames(
  nodes: ArticleNode[],
  matcher: NameMatcher,
  selfId: string,
): ArticleNode[] {
  return linkWith(nodes, matcher.find, selfId);
}

function linkWith(nodes: ArticleNode[], find: Finder, selfId: string): ArticleNode[] {
  const inlines = (list: Inline[]) => linkInlines(list, find, selfId);
  const many = (list: ArticleNode[]) => linkWith(list, find, selfId);
  return mapSame(nodes, (node) => {
    switch (node.type) {
      case 'paragraph': {
        const next = inlines(node.inlines);
        return next === node.inlines ? node : { ...node, inlines: next };
      }
      case 'quote':
      case 'callout':
      case 'expand':
      case 'group':
      case 'infobox':
      case 'secret': {
        const next = many(node.children);
        return next === node.children ? node : { ...node, children: next };
      }
      case 'list': {
        const next = mapSame(node.items, many);
        return next === node.items ? node : { ...node, items: next };
      }
      case 'columns': {
        const next = mapSame(node.columns, many);
        return next === node.columns ? node : { ...node, columns: next };
      }
      case 'tasks': {
        const next = mapSame(node.items, (item) => {
          const value = inlines(item.inlines);
          return value === item.inlines ? item : { ...item, inlines: value };
        });
        return next === node.items ? node : { ...node, items: next };
      }
      case 'table': {
        const next = mapSame(node.rows, (row) =>
          mapSame(row, (cell) => {
            const value = many(cell.children);
            return value === cell.children ? cell : { ...cell, children: value };
          }),
        );
        return next === node.rows ? node : { ...node, rows: next };
      }
      case 'facts': {
        const next = mapSame(node.rows, (row) => {
          const value = inlines(row.value);
          return value === row.value ? row : { ...row, value };
        });
        return next === node.rows ? node : { ...node, rows: next };
      }
      default:
        return node;
    }
  });
}

// ── Vornamen und Nachnamen allein ──────────────────────────────────────────

/**
 * Eine Person, die auf einer Seite mit vollem Namen steht, heißt danach oft nur noch „Mira“ oder
 * „Tannhaus“. Das gilt wie in jedem Text nur dort, wo sie vorgestellt wurde: auf derselben Seite.
 * Eine Suche über die ganze Welt gäbe es bei tausenden Personen nie eindeutig her. Tragen auf der
 * Seite zwei Personen denselben Namensteil – oder der Artikel selbst und eine weitere –, wird er
 * nicht verknüpft.
 */

/** Wörter eines Namens, die allein niemanden bezeichnen. */
const NOT_A_NAME = new Set(
  [
    'von',
    'van',
    'de',
    'der',
    'den',
    'die',
    'das',
    'zu',
    'zur',
    'zum',
    'vom',
    'am',
    'di',
    'da',
    'la',
    'le',
    'al',
    'el',
    'bin',
    'ibn',
    'of',
    'the',
    'und',
    'dr',
    'prof',
    'herr',
    'frau',
    'meister',
    'meisterin',
    'graf',
    'gräfin',
    'baron',
    'baronin',
    'fürst',
    'fürstin',
    'herzog',
    'herzogin',
    'könig',
    'königin',
    'prinz',
    'prinzessin',
    'lord',
    'lady',
    'sir',
    'hauptmann',
    'kapitän',
    'kommandant',
    'kommandantin',
    'bruder',
    'schwester',
    'vater',
    'mutter',
    'onkel',
    'tante',
    'alte',
    'alter',
    'junge',
    'haus',
  ].map((word) => word.toLocaleLowerCase('de')),
);

/**
 * Die Namensteile, unter denen eine Person kurz genannt wird: ihr erstes und ihr letztes Wort,
 * ohne Titel und Partikel („Dr. Odo von Tannhaus“ → Odo, Tannhaus). Ein einzelnes Wort gibt nichts
 * her – es ist schon der ganze Name.
 */
export function shortNames(title: string): string[] {
  const words = title
    .replace(LEADING_ARTICLE, '')
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))
    .filter((word) => word && !NOT_A_NAME.has(word.toLocaleLowerCase('de')));
  if (words.length < 2) return [];
  return [...new Set([words[0]!, words[words.length - 1]!])].filter(isLinkableName);
}

/** Sammelt, auf welche Artikel die Knoten verweisen. */
function mentioned(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 96 || typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    for (const part of value) mentioned(part, into, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (record.type === 'mention' && typeof record.resourceId === 'string' && record.resourceId)
    into.add(record.resourceId);
  else for (const part of Object.values(record)) mentioned(part, into, depth + 1);
}

/** Wörter, nach denen ein Nachname stehen darf, ohne zu einem fremden Vornamen zu gehören. */
const BEFORE_SURNAME = new Set(
  ['der', 'die', 'das', 'den', 'dem', 'des', 'herr', 'frau', 'familie', 'haus', 'und', 'oder'].map(
    (word) => word,
  ),
);

/**
 * Setzt auf einer Seite Vornamen und Nachnamen als Verweise ein, wenn die Person dort schon mit
 * vollem Namen (oder als Verweis) steht und der Namensteil auf der Seite nur zu ihr gehört.
 * `personTitle` gibt den Titel eines Artikels zurück, wenn er eine Person beschreibt.
 */
export function linkShortNames(
  nodes: ArticleNode[],
  personTitle: (id: string) => string | null,
  selfId: string,
): ArticleNode[] {
  const ids = new Set<string>([selfId]);
  mentioned(nodes, ids);
  const owners = new Map<string, Set<string>>();
  for (const id of ids) {
    const title = personTitle(id);
    if (!title) continue;
    for (const name of shortNames(title)) {
      const set = owners.get(name);
      if (set) set.add(id);
      else owners.set(name, new Set([id]));
    }
  }
  // Nur, was auf dieser Seite eindeutig ist – und nicht der Artikel selbst.
  const unique = new Map<string, string>();
  for (const [name, set] of owners) {
    const [only] = set;
    if (set.size === 1 && only !== selfId) unique.set(name, only!);
  }
  if (!unique.size) return nodes;

  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${[...unique.keys()]
      .sort((a, b) => b.length - a.length)
      .map(escape)
      .join('|')})(?:s(?![\\p{L}\\p{N}])|(?![\\p{L}\\p{N}]))`,
    'gu',
  );
  const find: Finder = (text) => {
    const hits: NameHit[] = [];
    for (const match of text.matchAll(pattern)) {
      const name = match[1]!;
      const from = match.index;
      const to = from + name.length;
      // „Mira Kohl“ ist jemand anderes als die Mira dieser Seite; „Jost Tannhaus“ ebenso.
      // Mit angehängtem „s“ folgt dagegen ein Hauptwort („Miras Boot“) – das ist in Ordnung.
      const after = /^\s(\p{Lu}[\p{L}'’-]+)/u.exec(text.slice(to))?.[1];
      if (after && !NOT_A_NAME.has(after.toLocaleLowerCase('de'))) continue;
      const before = /(\p{Lu}[\p{L}'’-]*)\s$/u.exec(text.slice(0, from))?.[1];
      if (before && !BEFORE_SURNAME.has(before.toLocaleLowerCase('de'))) {
        // Ein großes Wort davor ist nur am Satzanfang unverdächtig („Gestern kam Mira“ ist klein).
        const lead = text.slice(0, from - before.length - 1);
        if (lead.trim() !== '' && !/[.!?:;„"»(–-]\s*$/.test(lead)) continue;
      }
      hits.push({ from, to, id: unique.get(name)! });
    }
    return hits;
  };
  return linkWith(nodes, find, selfId);
}
