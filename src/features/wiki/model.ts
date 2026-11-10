/** Das eigene Wiki: Baum, Pfad, Suche und Rückverweise. Reine Funktionen. */
import type { Article, ArticleDoc, CampaignData, Entity } from '../../domain/schema';
import { nodeText, outlineOf, type ArticleNode, type OutlineEntry } from '../legendkeeper/model';

/**
 * Der Inhalt eines Artikels ist im Spielstand nur als Liste von Objekten geprüft; ihre Form ist
 * die der Anzeige. Hier – und nur hier – wird das eine als das andere gelesen.
 */
export const asNodes = (nodes: readonly Record<string, unknown>[]): ArticleNode[] =>
  nodes as unknown as ArticleNode[];

type Articles = CampaignData['articles'];

/** Geschwister in der Reihenfolge von LegendKeeper (Zeichen für Zeichen), dann nach Titel. */
const byOrder = (a: Article, b: Article): number =>
  a.order < b.order ? -1 : a.order > b.order ? 1 : a.title.localeCompare(b.title, 'de');

export interface TreeNode {
  article: Article;
  children: TreeNode[];
  /** Alle Artikel darunter, über alle Ebenen. */
  size: number;
}

export interface ArticleTree {
  roots: TreeNode[];
  /** Vorlagen für neue Artikel – kein Inhalt der Welt. */
  templates: Article[];
}

export function articleTree(articles: Articles): ArticleTree {
  const all = Object.values(articles);
  const kids = new Map<string, Article[]>();
  const roots: Article[] = [];
  const templates: Article[] = [];
  for (const article of all) {
    if (article.template) templates.push(article);
    // Fehlt der übergeordnete Artikel, steht dieser ganz oben statt zu verschwinden.
    else if (article.parentId && articles[article.parentId] && article.parentId !== article.id) {
      const list = kids.get(article.parentId);
      if (list) list.push(article);
      else kids.set(article.parentId, [article]);
    } else roots.push(article);
  }
  const seen = new Set<string>();
  const build = (article: Article): TreeNode => {
    seen.add(article.id);
    const children = (kids.get(article.id) ?? [])
      .filter((child) => !seen.has(child.id))
      .sort(byOrder)
      .map(build);
    return {
      article,
      children,
      size: children.reduce((sum, child) => sum + 1 + child.size, 0),
    };
  };
  const built = roots.sort(byOrder).map(build);
  // Artikel, die nur über einen Kreis erreichbar wären, gehen nicht verloren.
  for (const article of all)
    if (!article.template && !seen.has(article.id)) built.push(build(article));
  return { roots: built, templates: templates.sort(byOrder) };
}

/** Die Artikel über diesem, vom obersten bis zum direkt übergeordneten. */
export function articlePath(articles: Articles, id: string): Article[] {
  const path: Article[] = [];
  const seen = new Set([id]);
  let current = articles[id]?.parentId ?? null;
  while (current && !seen.has(current)) {
    const article = articles[current];
    if (!article) break;
    path.unshift(article);
    seen.add(current);
    current = article.parentId;
  }
  return path;
}

export function childArticles(articles: Articles, id: string): Article[] {
  return Object.values(articles)
    .filter((a) => a.parentId === id && !a.template)
    .sort(byOrder);
}

/** Seiten, die Wayfarer zeigen kann: Text und Karten. */
export const shownDocs = (article: Article): ArticleDoc[] =>
  article.docs.filter((doc) => doc.kind === 'page' || (doc.kind === 'map' && doc.mapId));

/** Seiten, die es in LegendKeeper gab, deren Inhalt aber (noch) nicht übernommen ist. */
export const missingDocs = (article: Article): ArticleDoc[] =>
  article.docs.filter((doc) => doc.kind === 'board' || doc.kind === 'time');

export const DOC_KIND_LABEL: Record<ArticleDoc['kind'], string> = {
  page: 'Seite',
  map: 'Karte',
  board: 'Zeichenfläche',
  time: 'Zeitleiste',
};

export function docTitle(doc: ArticleDoc, index: number): string {
  const title = doc.title.trim();
  if (title && !/^(untitled|main)$/i.test(title)) return title;
  return doc.kind === 'page'
    ? index === 0
      ? 'Artikel'
      : `Seite ${index + 1}`
    : DOC_KIND_LABEL[doc.kind];
}

/** Steckbrief neben dem Text: die Felder des Artikels und Kästen, die in der Seite stehen. */
export function splitPage(
  article: Article,
  doc: ArticleDoc | undefined,
): { side: ArticleNode[]; body: ArticleNode[]; outline: OutlineEntry[] } {
  const nodes = doc?.kind === 'page' ? asNodes(doc.nodes) : [];
  const boxed = nodes.filter((node) => node.type === 'infobox' && node.beside);
  const body = nodes.filter((node) => !(node.type === 'infobox' && node.beside));
  return { side: [...boxed, ...asNodes(article.sidebar)], body, outline: outlineOf(body) };
}

/** Einträge der Weltdatenbank, die zu einem Artikel gehören. */
export function entitiesOfArticle(data: CampaignData, articleId: string): Entity[] {
  return Object.values(data.entities).filter((e) => e.lk?.resourceId === articleId);
}

// ── Suche ──────────────────────────────────────────────────────────────────

const fold = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export interface SearchIndexEntry {
  article: Article;
  title: string;
  names: string;
  /** Der ganze Text des Artikels, klein geschrieben und ohne Akzente. */
  text: string;
  /** Derselbe Text, wie er dasteht – für den Ausschnitt. */
  plain: string;
}

/** Bereitet alle Artikel für die Suche vor. Einmal je Stand des Wikis. */
export function searchIndex(articles: Articles): SearchIndexEntry[] {
  return Object.values(articles)
    .filter((article) => !article.template)
    .map((article) => {
      const plain = [
        ...asNodes(article.sidebar).map(nodeText),
        ...article.docs.flatMap((doc) => asNodes(doc.nodes).map(nodeText)),
      ]
        .join(' ')
        .replace(/\s+/g, ' ');
      return {
        article,
        title: fold(article.title),
        names: fold([...article.aliases, ...article.tags].join(' · ')),
        text: fold(plain),
        plain,
      };
    });
}

export interface SearchHit {
  article: Article;
  /** Wo der Treffer steht. */
  where: 'title' | 'names' | 'text';
  /** Ausschnitt um die Fundstelle, bei Treffern im Text. */
  snippet: string;
}

/** Sucht alle Wörter der Anfrage; Treffer im Titel zuerst, dann Zweitnamen, dann Text. */
export function searchArticles(
  index: readonly SearchIndexEntry[],
  query: string,
  limit = 60,
): SearchHit[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits: (SearchHit & { rank: number })[] = [];
  for (const entry of index) {
    const inTitle = words.every((w) => entry.title.includes(w));
    const inNames =
      !inTitle && words.every((w) => entry.title.includes(w) || entry.names.includes(w));
    const inText =
      !inTitle &&
      !inNames &&
      words.every(
        (w) => entry.title.includes(w) || entry.names.includes(w) || entry.text.includes(w),
      );
    if (!inTitle && !inNames && !inText) continue;
    let snippet = '';
    if (inText) {
      const word = words.find((w) => entry.text.includes(w)) ?? words[0]!;
      // Gefaltet und ungefaltet sind fast immer gleich lang; sonst verrutscht nur der Ausschnitt.
      const at = entry.text.indexOf(word);
      // Der Ausschnitt beginnt und endet an einer Wortgrenze.
      let from = Math.max(0, at - 50);
      if (from > 0) {
        const space = entry.plain.indexOf(' ', from);
        if (space >= 0 && space < at) from = space + 1;
      }
      let to = Math.min(entry.plain.length, at + word.length + 90);
      if (to < entry.plain.length) {
        const space = entry.plain.lastIndexOf(' ', to);
        if (space > at + word.length) to = space;
      }
      snippet =
        (from > 0 ? '… ' : '') +
        entry.plain.slice(from, to).trim() +
        (to < entry.plain.length ? ' …' : '');
    }
    hits.push({
      article: entry.article,
      where: inTitle ? 'title' : inNames ? 'names' : 'text',
      snippet,
      rank: inTitle ? (entry.title.startsWith(words[0]!) ? 0 : 1) : inNames ? 2 : 3,
    });
  }
  return hits
    .sort((a, b) => a.rank - b.rank || a.article.title.localeCompare(b.article.title, 'de'))
    .slice(0, limit)
    .map(({ rank: _rank, ...hit }) => hit);
}

// ── Rückverweise ───────────────────────────────────────────────────────────

/** Sammelt alle Artikel, auf die ein Inhalt verweist – im Fließtext wie in Verweislisten. */
function collectTargets(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 96 || typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    for (const part of value) collectTargets(part, into, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.resourceId === 'string') into.add(record.resourceId);
  for (const part of Object.values(record)) collectTargets(part, into, depth + 1);
}

/** Für jeden Artikel: welche anderen ihn erwähnen. */
export function backlinks(articles: Articles): Map<string, Article[]> {
  const out = new Map<string, Article[]>();
  for (const article of Object.values(articles)) {
    if (article.template) continue;
    const targets = new Set<string>();
    collectTargets(article.sidebar, targets);
    for (const doc of article.docs) collectTargets(doc.nodes, targets);
    for (const target of targets) {
      if (target === article.id || !articles[target]) continue;
      const list = out.get(target);
      if (list) list.push(article);
      else out.set(target, [article]);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.title.localeCompare(b.title, 'de'));
  return out;
}
