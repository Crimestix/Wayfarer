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

/** Teilt die Textstücke eines Absatzes an den erkannten Namen. Ohne Treffer dieselbe Liste. */
function linkInlines(inlines: Inline[], matcher: NameMatcher, selfId: string): Inline[] {
  let out: Inline[] | null = null;
  inlines.forEach((inline, index) => {
    if (inline.type !== 'text' || inline.code || inline.href) {
      out?.push(inline);
      return;
    }
    // Der Artikel verweist nie auf sich selbst.
    const hits = matcher.find(inline.text).filter((hit) => hit.id !== selfId);
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
  const inlines = (list: Inline[]) => linkInlines(list, matcher, selfId);
  const many = (list: ArticleNode[]) => linkNames(list, matcher, selfId);
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
