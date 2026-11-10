/**
 * Der Text der Artikel und was sich daraus ergibt: welcher Verweis zu welchem Artikel führt,
 * die Knoten der Anzeige zu einer Seite und – für Artikel, die noch in der alten Form im
 * Spielstand liegen – der Text, der daraus wird. Reine Funktionen; Ergebnisse werden je Stand des
 * Wikis gemerkt, damit beim Blättern nicht jedes Mal neu gelesen wird.
 */
import type { Article, ArticleDoc, CampaignData } from '../../domain/schema';
import type { ArticleNode } from '../legendkeeper/model';
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

const nodeCache = new WeakMap<ArticleDoc, { articles: Articles; nodes: ArticleNode[] }>();

/** Die Knoten der Anzeige zu einer Seite, gelesen aus ihrem Text. */
export function pageNodes(articles: Articles, article: Article, doc: ArticleDoc): ArticleNode[] {
  const cached = nodeCache.get(doc);
  if (cached && cached.articles === articles) return cached.nodes;
  const nodes =
    doc.kind === 'page'
      ? parseMarkdown(pageText(articles, article, doc), {
          resolve: linkIndex(articles).resolve,
          headings: 0,
        })
      : [];
  nodeCache.set(doc, { articles, nodes });
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
