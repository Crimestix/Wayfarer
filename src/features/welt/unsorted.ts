/**
 * „Ohne Kategorie“ (Wunsch des Spielleiters, 18. 11. 2026: „ein Platz, um alle Artikel, die noch
 * keiner Art zugewiesen wurden, anzuzeigen“ – und: „Nicht alles ist ja ein Wiki-Artikel“): die
 * Artikel, die noch zu keinem Eintrag der Welt gehören, zum Einordnen oder Löschen. Die Liste ist
 * dieselbe wie „Texte ohne Eintrag“ (`textsWithoutEntry`); gelöscht wird in den Papierkorb.
 */
import type { CampaignDb } from '../../data/db';
import type { Article, CampaignData, EntityKind } from '../../domain/schema';
import { adoptArticle, deleteArticle } from '../wiki/actions';
import { articleFacts, kindFromFolder, statedKind } from '../wiki/facts';
import { articleWords } from '../wiki/gaps';
import { textsWithoutEntry } from './model';

export interface UnsortedRow {
  article: Article;
  /** Die Ordner darüber, von außen nach innen: „Kosmologie › Ebenen“. */
  path: string;
  /** Wörter im Text – 0 heißt leer (oft eine alte Ordnerseite). */
  words: number;
  /** Artikel unmittelbar darunter. */
  children: number;
  /** Was der Ordner oder der Steckbrief nahelegt – nur ein Vorschlag. */
  suggested: EntityKind | null;
}

/** Alle Artikel ohne Eintrag der Welt, nach Ordner und Titel. */
export function unsortedRows(data: CampaignData): UnsortedRow[] {
  const articles = data.articles;
  const children = new Map<string, number>();
  for (const article of Object.values(articles))
    if (article.parentId) children.set(article.parentId, (children.get(article.parentId) ?? 0) + 1);
  const pathOf = (article: Article): string => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (
      let up = article.parentId ? articles[article.parentId] : undefined;
      up && !seen.has(up.id);
      up = up.parentId ? articles[up.parentId] : undefined
    ) {
      seen.add(up.id);
      names.unshift(up.title);
    }
    return names.join(' › ');
  };
  return textsWithoutEntry(data)
    .map((article) => ({
      article,
      path: pathOf(article),
      words: articleWords(articles, article),
      children: children.get(article.id) ?? 0,
      suggested:
        kindFromFolder(articles, article)?.kind ??
        statedKind(articleFacts(articles, article))?.kind ??
        null,
    }))
    .sort(
      (a, b) =>
        a.path.localeCompare(b.path, 'de') || a.article.title.localeCompare(b.article.title, 'de'),
    );
}

/** Sucht in Titel und Ordnern; „nur leere“ zeigt, was keinen Text hat. */
export function filterUnsorted(
  rows: readonly UnsortedRow[],
  query: string,
  emptyOnly: boolean,
): UnsortedRow[] {
  const needle = query.trim().toLocaleLowerCase('de');
  return rows.filter(
    (row) =>
      (!emptyOnly || row.words === 0) &&
      (!needle ||
        row.article.title.toLocaleLowerCase('de').includes(needle) ||
        row.path.toLocaleLowerCase('de').includes(needle)),
  );
}

/**
 * Gibt Artikeln eine Kategorie: Zu jedem entsteht der Eintrag der Welt, dem er gehört
 * (`adoptArticle`) – der Text bleibt, wie er ist. Was inzwischen einen Eintrag hat, bleibt.
 * `kindOf` sagt je Artikel die Kategorie (null = auslassen). Gibt `undo` zurück.
 */
export function sortArticles(
  db: CampaignDb,
  articleIds: readonly string[],
  kindOf: EntityKind | ((articleId: string) => EntityKind | null),
): { count: number; undo: () => void } {
  const created: string[] = [];
  db.batch(() => {
    const owned = new Set(
      Object.values(db.getSnapshot().entities).flatMap((entity) =>
        entity.lk ? [entity.lk.resourceId] : [],
      ),
    );
    for (const id of articleIds) {
      const article = db.getSnapshot().articles[id];
      const kind = typeof kindOf === 'function' ? kindOf(id) : kindOf;
      if (!article || !kind || owned.has(id)) continue;
      created.push(adoptArticle(db, article, kind).id);
    }
  });
  return {
    count: created.length,
    undo: () =>
      db.batch(() => {
        for (const id of created) if (db.getSnapshot().entities[id]) db.remove('entities', id);
      }),
  };
}

/**
 * Löscht Artikel – in den Papierkorb (Einstellungen), von dort lassen sie sich zurückholen.
 * Unterartikel rücken eine Ebene nach oben (`deleteArticle`). Gibt `undo` zurück.
 */
export function dropArticles(
  db: CampaignDb,
  articleIds: readonly string[],
): { count: number; undo: () => void } {
  const undos: (() => void)[] = [];
  db.batch(() => {
    for (const id of articleIds) {
      const undo = deleteArticle(db, id);
      if (undo) undos.push(undo);
    }
  });
  return {
    count: undos.length,
    // In umgekehrter Folge: So hängt jeder Unterartikel wieder dort, wo er hing.
    undo: () => db.batch(() => [...undos].reverse().forEach((undo) => undo())),
  };
}
