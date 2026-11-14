/**
 * Platzhalter: Einträge, die beim Schreiben einer Geschichte entstanden sind – ein Name, eine Art,
 * höchstens ein Satz. Die Welt wächst aus der Geschichte; fertig geschrieben wird später. Ein
 * Platzhalter ist er nur, solange noch nichts Eigenes dasteht: Sobald der Spielleiter Notizen
 * oder einen Artikel schreibt, gilt er von selbst als gewöhnlicher Eintrag. Reine Funktionen.
 */
import { articleParts, plainMarkdown } from './articleText';
import type { Article, CampaignData, Entity, Story } from './schema';

type StubData = Pick<CampaignData, 'articles'>;

/** Steht im Artikel mehr als ein leeres Steckbrief-Gerüst? */
export function articleHasText(article: Article): boolean {
  // Alte Form (Knoten statt Text): Was dort steht, hat jemand geschrieben oder übernommen.
  if (article.sidebar.length > 0) return true;
  return article.docs.some((doc) => {
    if (doc.kind !== 'page') return doc.mapId !== null;
    if (!doc.text) return doc.nodes.length > 0;
    const parts = articleParts(doc.text);
    return parts.facts.length > 0 || !!parts.box.trim() || !!plainMarkdown(parts.body).trim();
  });
}

/** Hat der Eintrag schon etwas Eigenes – Notizen, ein Geheimnis oder einen geschriebenen Artikel? */
export function hasOwnWriting(data: StubData, entity: Entity): boolean {
  if (entity.notes.trim() || entity.secret.trim()) return true;
  const article = entity.lk ? data.articles[entity.lk.resourceId] : undefined;
  return article !== undefined && articleHasText(article);
}

/**
 * Ist das ein Platzhalter, noch zu schreiben? Nur, solange er als solcher angelegt ist
 * (`entity.stub`) und noch nichts Eigenes hat. Der eine Satz vom Anlegen zählt nicht als Eigenes.
 */
export function isStub(data: StubData, entity: Entity | undefined): boolean {
  return !!entity && entity.stub && !hasOwnWriting(data, entity);
}

export interface StubRow {
  entity: Entity;
  /** Die Geschichte, bei deren Schreiben er entstand – wenn es sie noch gibt. */
  story: Story | null;
}

/**
 * Alle Platzhalter der Welt für „Noch zu schreiben“: nach Geschichte gruppiert (die ohne
 * Geschichte zuletzt), darin nach Namen.
 */
export function stubRows(data: Pick<CampaignData, 'entities' | 'articles' | 'stories'>): StubRow[] {
  const rows: StubRow[] = [];
  for (const entity of Object.values(data.entities)) {
    if (!isStub(data, entity)) continue;
    rows.push({ entity, story: (entity.fromStoryId && data.stories[entity.fromStoryId]) || null });
  }
  return rows.sort(
    (a, b) =>
      Number(a.story === null) - Number(b.story === null) ||
      (a.story?.title ?? '').localeCompare(b.story?.title ?? '', 'de') ||
      a.entity.name.localeCompare(b.entity.name, 'de') ||
      a.entity.id.localeCompare(b.entity.id),
  );
}
