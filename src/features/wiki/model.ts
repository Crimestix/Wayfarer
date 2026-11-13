/** Das eigene Wiki: Baum, Pfad, Suche und Rückverweise. Reine Funktionen. */
import type { Article, ArticleDoc, CampaignData, Entity } from '../../domain/schema';
import { nodeText, outlineOf, type ArticleNode, type OutlineEntry } from '../legendkeeper/model';
import { articleNodes, linkIndex, pageNodes, titleKey } from './text';

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

export function articleTree(
  articles: Articles,
  /** Artikel, die nicht im Baum stehen (die Räume eines Ortes). */
  hidden: ReadonlySet<string> = new Set(),
): ArticleTree {
  const all = Object.values(articles).filter((article) => !hidden.has(article.id));
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
  articles: Articles,
  article: Article,
  doc: ArticleDoc | undefined,
): { side: ArticleNode[]; body: ArticleNode[]; outline: OutlineEntry[] } {
  const nodes = doc?.kind === 'page' ? pageNodes(articles, article, doc) : [];
  const side = nodes.filter((node) => node.type === 'infobox' && node.beside);
  const body = nodes.filter((node) => !(node.type === 'infobox' && node.beside));
  return { side, body, outline: outlineOf(body) };
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
      const plain = [...articleNodes(articles, article).map(nodeText)]
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

interface Targets {
  /** Kennungen der Artikel, auf die verwiesen wird. */
  ids: Set<string>;
  /** Titel, auf die verwiesen wird, ohne dass es den Artikel gibt – je Schreibweise einmal. */
  wanted: Map<string, string>;
}

/** Sammelt alle Artikel, auf die ein Inhalt verweist – im Fließtext wie in Verweislisten. */
function collectTargets(value: unknown, into: Targets, depth = 0): void {
  if (depth > 96 || typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    for (const part of value) collectTargets(part, into, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.resourceId === 'string') into.ids.add(record.resourceId);
  if (typeof record.wanted === 'string' && record.type === 'mention') {
    const key = titleKey(record.wanted);
    if (key && !into.wanted.has(key)) into.wanted.set(key, record.wanted);
  }
  for (const part of Object.values(record)) collectTargets(part, into, depth + 1);
}

const targetCache = new WeakMap<Article, { stamp: object; targets: Targets }>();

/** Wohin ein Artikel verweist – je Artikel nur einmal gelesen, solange sich kein Titel ändert. */
function targetsOf(articles: Articles, article: Article): Targets {
  const { stamp } = linkIndex(articles);
  const cached = targetCache.get(article);
  if (cached && cached.stamp === stamp) return cached.targets;
  const targets: Targets = { ids: new Set(), wanted: new Map() };
  collectTargets(articleNodes(articles, article), targets);
  targetCache.set(article, { stamp, targets });
  return targets;
}

/** Für jeden Artikel: welche anderen ihn erwähnen. */
export function backlinks(articles: Articles): Map<string, Article[]> {
  const out = new Map<string, Article[]>();
  for (const article of Object.values(articles)) {
    if (article.template) continue;
    for (const target of targetsOf(articles, article).ids) {
      if (target === article.id || !articles[target]) continue;
      const list = out.get(target);
      if (list) list.push(article);
      else out.set(target, [article]);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.title.localeCompare(b.title, 'de'));
  return out;
}

// ── Oft zusammen genannt ───────────────────────────────────────────────────

/** Sammelt je Absatz (oder Zeile eines Steckbriefs), welche Artikel darin genannt werden. */
function collectGroups(value: unknown, into: Set<string>[], depth = 0): void {
  if (depth > 96 || typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    const first = value[0] as { type?: unknown } | undefined;
    const inline = first?.type === 'text' || first?.type === 'mention' || first?.type === 'break';
    if (inline) {
      const ids = new Set<string>();
      for (const part of value as { type?: unknown; resourceId?: unknown }[])
        if (part.type === 'mention' && typeof part.resourceId === 'string' && part.resourceId)
          ids.add(part.resourceId);
      if (ids.size > 1) into.push(ids);
      return;
    }
    for (const part of value) collectGroups(part, into, depth + 1);
    return;
  }
  for (const part of Object.values(value)) collectGroups(part, into, depth + 1);
}

const groupCache = new WeakMap<Article, { stamp: object; groups: Set<string>[] }>();

function groupsOf(articles: Articles, article: Article): Set<string>[] {
  const { stamp } = linkIndex(articles);
  const cached = groupCache.get(article);
  if (cached && cached.stamp === stamp) return cached.groups;
  const groups: Set<string>[] = [];
  collectGroups(articleNodes(articles, article), groups);
  groupCache.set(article, { stamp, groups });
  return groups;
}

export interface CoMention {
  article: Article;
  /** In wie vielen Absätzen beide zusammen stehen. */
  count: number;
}

/**
 * Mit wem ein Artikel oft im selben Absatz genannt wird – über das ganze Wiki. Das zeigt
 * Verbindungen, die nirgends eigens eingetragen sind. Einmal zusammen genannt zählt noch nicht.
 */
export function coMentions(articles: Articles, id: string, limit = 8): CoMention[] {
  const counts = new Map<string, number>();
  for (const article of Object.values(articles)) {
    if (article.template) continue;
    for (const group of groupsOf(articles, article)) {
      if (!group.has(id)) continue;
      for (const other of group)
        if (other !== id && articles[other] && !articles[other].template)
          counts.set(other, (counts.get(other) ?? 0) + 1);
    }
  }
  return [...counts]
    .filter(([, count]) => count >= 2)
    .map(([other, count]) => ({ article: articles[other]!, count }))
    .sort((a, b) => b.count - a.count || a.article.title.localeCompare(b.article.title, 'de'))
    .slice(0, limit);
}

// ── Erwähnt, aber noch nicht angelegt ──────────────────────────────────────

export interface WantedArticle {
  /** So steht der Titel im ersten Verweis. */
  title: string;
  /** Artikel, die darauf verweisen, nach Titel. */
  from: Article[];
}

/**
 * Titel, auf die Verweise zeigen, ohne dass es den Artikel schon gibt. Am häufigsten Erwähntes
 * zuerst – das sind die Lücken, die sich am ehesten lohnen.
 */
export function wantedArticles(articles: Articles): WantedArticle[] {
  const found = new Map<string, WantedArticle>();
  const sorted = Object.values(articles)
    .filter((article) => !article.template)
    .sort((a, b) => a.title.localeCompare(b.title, 'de') || a.id.localeCompare(b.id));
  for (const article of sorted)
    for (const [key, title] of targetsOf(articles, article).wanted) {
      const entry = found.get(key);
      if (entry) entry.from.push(article);
      else found.set(key, { title, from: [article] });
    }
  return [...found.values()].sort(
    (a, b) => b.from.length - a.from.length || a.title.localeCompare(b.title, 'de'),
  );
}

// ── Vorschläge ─────────────────────────────────────────────────────────────

/**
 * Artikel, die zu einer Eingabe passen: zuerst Titel, die so beginnen, dann Titel, die es
 * enthalten, dann Zweitnamen. Ohne Eingabe die zuletzt geänderten.
 */
export function articleSuggestions(articles: Articles, query: string, limit = 12): Article[] {
  const q = fold(query).trim();
  const all = Object.values(articles).filter((article) => !article.template);
  if (!q)
    return all
      .sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title, 'de'))
      .slice(0, limit);
  const ranked: { article: Article; rank: number }[] = [];
  for (const article of all) {
    const title = fold(article.title);
    const rank =
      title === q
        ? 0
        : title.startsWith(q)
          ? 1
          : title.split(/\s+/).some((word) => word.startsWith(q))
            ? 2
            : title.includes(q)
              ? 3
              : article.aliases.some((alias) => fold(alias).includes(q))
                ? 4
                : -1;
    if (rank >= 0) ranked.push({ article, rank });
  }
  return ranked
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        a.article.title.length - b.article.title.length ||
        a.article.title.localeCompare(b.article.title, 'de'),
    )
    .slice(0, limit)
    .map((entry) => entry.article);
}
