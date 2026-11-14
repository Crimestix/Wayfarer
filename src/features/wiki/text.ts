/**
 * Der Text der Artikel und was sich daraus ergibt: welcher Verweis zu welchem Artikel führt,
 * die Knoten der Anzeige zu einer Seite und – für Artikel, die noch in der alten Form im
 * Spielstand liegen – der Text, der daraus wird. Reine Funktionen; Ergebnisse werden je Stand des
 * Wikis gemerkt, damit beim Blättern nicht jedes Mal neu gelesen wird.
 */
import type { Article, ArticleDoc, CampaignData } from '../../domain/schema';
import type { ArticleNode } from '../legendkeeper/model';
import { linkNames, linkShortNames, nameMatcher, type NameMatcher } from './names';
import { looksLikePerson } from './recognize';
import {
  parseMarkdown,
  splitTarget,
  toMarkdown,
  wikiLink,
  type LinkTarget,
  type WriteContext,
} from './markdown';

type Articles = CampaignData['articles'];

/** Titel vergleichen sich ohne Groß- und Kleinschreibung und ohne doppelte Leerzeichen. */
export const titleKey = (title: string): string =>
  title.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');

export interface LinkIndex {
  /** Der Artikel zu dem, was zwischen den Klammern eines Verweises steht. */
  resolve: (target: string) => LinkTarget | null;
  /** Titel eines Artikels und ob er eindeutig ist – so wird ein Verweis auf ihn geschrieben. */
  targetOf: (id: string) => { title: string; unique: boolean } | null;
  /** Der Verweis auf einen Artikel als Text: `[[Titel]]`. */
  linkTo: (id: string, label?: string) => string;
  /**
   * Bleibt dasselbe Objekt, solange sich an Titeln und Zweitnamen nichts ändert. Was nur davon
   * abhängt, wohin Verweise führen, muss dann nicht neu gerechnet werden – etwa beim Tippen.
   */
  stamp: object;
}

let lastStamp: { signature: string; stamp: object } | null = null;

const personCache = new WeakMap<Article, boolean>();

/** Steckbriefzeilen, die nur bei einer Person stehen. */
const PERSON_LINE =
  /^>[ \t]*(?:(?:Art|Typ)[ \t]*:[ \t]*(?:Person|NSC|NPC|Figur|Charakter)\b|(?:Spezies|Volk|Rasse)[ \t]*:[ \t]*\S)/imu;

/**
 * Beschreibt der Artikel eine Person? Am Symbol, an den Schlagworten oder an seinem Steckbrief
 * abgelesen – ohne die Welt zu fragen, damit das Wiki für sich allein lesbar bleibt.
 */
export function isPersonArticle(article: Article): boolean {
  let known = personCache.get(article);
  if (known === undefined) {
    known =
      !article.template &&
      (looksLikePerson(article.icon, article.tags) ||
        article.docs.some((doc) => PERSON_LINE.test(doc.text)));
    personCache.set(article, known);
  }
  return known;
}

const indexCache = new WeakMap<object, LinkIndex>();

/** Wohin Verweise führen. Titel gehen vor Zweitnamen, Artikel vor Vorlagen. */
export function linkIndex(articles: Articles): LinkIndex {
  const cached = indexCache.get(articles);
  if (cached) return cached;
  const byTitle = new Map<string, Article[]>();
  const byAlias = new Map<string, Article[]>();
  const add = (map: Map<string, Article[]>, key: string, article: Article) => {
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(article);
    else map.set(key, [article]);
  };
  // Feste Reihenfolge, damit ein mehrdeutiger Titel immer zum selben Artikel führt.
  const sorted = Object.values(articles).sort(
    (a, b) => Number(a.template) - Number(b.template) || a.id.localeCompare(b.id),
  );
  for (const article of sorted) {
    add(byTitle, titleKey(article.title), article);
    for (const alias of article.aliases) add(byAlias, titleKey(alias), article);
  }
  const signature = sorted
    .map((a) =>
      [
        a.id,
        a.title,
        a.template ? 1 : 0,
        a.autoLink ? 1 : 0,
        isPersonArticle(a) ? 1 : 0,
        ...a.aliases,
      ].join('\u0001'),
    )
    .join('\u0002');
  const stamp = lastStamp?.signature === signature ? lastStamp.stamp : {};
  lastStamp = { signature, stamp };
  const targetOf: LinkIndex['targetOf'] = (id) => {
    const article = articles[id];
    if (!article) return null;
    return {
      title: article.title,
      unique: (byTitle.get(titleKey(article.title))?.length ?? 0) <= 1,
    };
  };
  const index: LinkIndex = {
    resolve: (target) => {
      const { title, id } = splitTarget(target);
      const direct = id ? articles[id] : undefined;
      const key = titleKey(title);
      const found = direct ?? byTitle.get(key)?.[0] ?? byAlias.get(key)?.[0];
      return found ? { id: found.id, title: found.title } : null;
    },
    targetOf,
    stamp,
    linkTo: (id, label = '') => {
      const target = targetOf(id);
      if (!target) return label ? wikiLink(label) : '';
      return wikiLink(target.unique ? target.title : `${target.title}~${id}`, label);
    },
  };
  indexCache.set(articles, index);
  return index;
}

const writerFor = (articles: Articles): WriteContext => ({
  targetOf: linkIndex(articles).targetOf,
  dropped: 0,
});

/** Liest gespeicherte Knoten der alten Form als Knoten der Anzeige. */
const legacyNodes = (nodes: readonly Record<string, unknown>[]): ArticleNode[] =>
  nodes as unknown as ArticleNode[];

/** Ist das die erste Textseite des Artikels? Dort steht der Steckbrief. */
const isFirstPage = (article: Article, doc: ArticleDoc): boolean =>
  article.docs.find((d) => d.kind === 'page')?.id === doc.id;

/**
 * Der Text einer Seite. Artikel, die noch als Knoten im Spielstand liegen (vor der Umstellung
 * übernommen), werden dafür in Text umgeschrieben – der Steckbrief des Artikels steht dann oben
 * auf der ersten Seite.
 */
export function pageText(articles: Articles, article: Article, doc: ArticleDoc): string {
  if (doc.text || doc.kind !== 'page') return doc.text;
  const side = isFirstPage(article, doc) ? legacyNodes(article.sidebar) : [];
  if (!side.length && !doc.nodes.length) return '';
  return toMarkdown(
    [
      ...(side.length ? [{ type: 'infobox', beside: true, children: side } as ArticleNode] : []),
      ...legacyNodes(doc.nodes),
    ],
    writerFor(articles),
  );
}

const matcherCache = new WeakMap<object, NameMatcher>();

/** Der Erkenner für Namen ohne Klammern – einmal je Stand der Titel. */
function matcherFor(articles: Articles): NameMatcher {
  const { stamp, resolve } = linkIndex(articles);
  let matcher = matcherCache.get(stamp);
  if (!matcher) {
    matcher = nameMatcher(articles, resolve);
    matcherCache.set(stamp, matcher);
  }
  return matcher;
}

const nodeCache = new WeakMap<ArticleDoc, { stamp: object; nodes: ArticleNode[] }>();

/** Die Knoten der Anzeige zu einer Seite, gelesen aus ihrem Text. */
export function pageNodes(articles: Articles, article: Article, doc: ArticleDoc): ArticleNode[] {
  const { stamp, resolve } = linkIndex(articles);
  const cached = nodeCache.get(doc);
  if (cached && cached.stamp === stamp) return cached.nodes;
  // Erst die Verweise in Klammern, dann die Namen, die ohne Klammern dastehen.
  const nodes =
    doc.kind === 'page'
      ? linkShortNames(
          linkNames(
            parseMarkdown(pageText(articles, article, doc), { resolve, headings: 0 }),
            matcherFor(articles),
            article.id,
          ),
          // Vornamen und Nachnamen allein gelten für Personen, die auf dieser Seite stehen.
          (id) => {
            const other = articles[id];
            return other && other.autoLink && isPersonArticle(other) ? other.title : null;
          },
          article.id,
        )
      : [];
  nodeCache.set(doc, { stamp, nodes });
  return nodes;
}

/** Alle Knoten eines Artikels über seine Textseiten hinweg. */
export function articleNodes(articles: Articles, article: Article): ArticleNode[] {
  return article.docs.flatMap((doc) => pageNodes(articles, article, doc));
}

/**
 * Schreibt einen Artikel der alten Form (Knoten und eigener Steckbrief) in die Textform um.
 * `articles` muss alle Artikel enthalten, auf die verwiesen wird – daraus kommen die Titel.
 * Gibt zurück, wie viele Platzhalter dabei wegfielen (Dinge, die es nur in LegendKeeper gab).
 */
export function articleAsText(
  articles: Articles,
  article: Article,
): { article: Article; dropped: number } {
  const writer = writerFor(articles);
  const side = legacyNodes(article.sidebar);
  let pending: ArticleNode[] = side.length
    ? [{ type: 'infobox', beside: true, children: side }]
    : [];
  const docs = article.docs.map((doc) => {
    if (doc.kind !== 'page' || doc.text) return { ...doc, nodes: [] };
    const text = toMarkdown([...pending, ...legacyNodes(doc.nodes)], writer);
    pending = [];
    return { ...doc, text, nodes: [] };
  });
  // Ein Artikel ohne Textseite, aber mit Steckbrief, bekommt eine Seite dafür.
  if (pending.length)
    docs.unshift({
      id: `${article.id}-seite`.slice(0, 64),
      title: '',
      kind: 'page',
      hidden: false,
      nodes: [],
      mapId: null,
      text: toMarkdown(pending, writer),
    });
  return { article: { ...article, sidebar: [], docs }, dropped: writer.dropped };
}

// ── Verweise nachziehen ────────────────────────────────────────────────────

/** Ein Verweis im Text: `[[Ziel]]` oder `[[Ziel|Text]]`, nicht mit „\\“ davor. */
const LINK = /(?<!\\)\[\[([^[\]\n|]+)(\|[^[\]\n]*)?\]\]/g;

/** Alle Verweisziele im Text einer Seite, wie sie geschrieben stehen. */
export function linkTargets(text: string): string[] {
  return [...text.matchAll(LINK)].map((match) => match[1]!.trim());
}

/**
 * Hält Verweise beim Alten, wenn sich Titel ändern: Jeder Verweis, der vorher zu einem Artikel
 * führte, führt danach zu demselben – auch wenn der Artikel umbenannt wurde oder ein anderer nun
 * genauso heißt. Verweise auf gelöschte Artikel bleiben als Name stehen. Gibt nur die Artikel
 * zurück, deren Text sich dabei geändert hat.
 */
export function relinked(before: Articles, after: Articles): Article[] {
  const was = linkIndex(before);
  const now = linkIndex(after);
  const changed: Article[] = [];
  for (const article of Object.values(after)) {
    let touched = false;
    const docs = article.docs.map((doc) => {
      // Seiten der alten Form merken sich ihre Ziele über die Kennung – dort ändert sich nichts.
      if (doc.kind !== 'page' || !doc.text) return doc;
      const next = doc.text.replace(LINK, (whole, target: string, label: string | undefined) => {
        const aim = was.resolve(target.trim());
        if (!aim || !after[aim.id]) return whole;
        const canonical = now.targetOf(aim.id)!;
        const written = canonical.unique ? canonical.title : `${canonical.title}~${aim.id}`;
        const { title, id } = splitTarget(target);
        const byTitle = titleKey(title) === titleKey(canonical.title);
        if (id) {
          // Mit Kennung geschrieben: nur anfassen, wenn Titel oder Eindeutigkeit sich geändert haben.
          if (byTitle && !canonical.unique) return whole;
        } else if (now.resolve(target.trim())?.id === aim.id && (!byTitle || canonical.unique)) {
          // Führt weiter zum selben Artikel – über den eindeutigen Titel oder einen Zweitnamen.
          return whole;
        }
        // Stand dort der alte Titel, zeigt der Verweis künftig den neuen. War es ein Zweitname,
        // den es nicht mehr gibt, bleibt der Wortlaut als gezeigter Text erhalten.
        const wasTitle = titleKey(title) === titleKey(before[aim.id]?.title ?? '');
        const shown = label ?? (wasTitle || byTitle ? '' : `|${title}`);
        return `[[${written}${shown}]]`;
      });
      if (next === doc.text) return doc;
      touched = true;
      return { ...doc, text: next };
    });
    if (touched) changed.push({ ...article, docs });
  }
  return changed;
}
