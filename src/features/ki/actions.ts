/**
 * Befehle des KI-Lesers: einen Artikel lesen lassen, Vorschläge annehmen oder ablehnen.
 * Geschrieben wird in die Welt erst beim Annehmen – und nur das, was der Vorschlag nennt.
 */
import { z } from 'zod';
import { logEntry } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import { aiAsk, type AiAskRequest, type AiAskResponse } from '../../data/platform';
import {
  CalendarEventSchema,
  createEvent,
  createRelation,
  nowIso,
  type AiHint,
  type Article,
  type CampaignData,
} from '../../domain/schema';
import { articlePath } from '../wiki/model';
import {
  DEFAULT_AI_MODEL,
  MIN_TEXT_CHARS,
  aiModel,
  articleText,
  buildReadRequest,
  threadSort,
  costUsd,
  needsReading,
  parseReply,
  suggest,
  textMark,
} from './reader';

export type Ask = (request: AiAskRequest) => Promise<AiAskResponse>;

/** Das Modell, das für diese Kampagne liest. */
export const modelOf = (data: Pick<CampaignData, 'campaign'>) =>
  aiModel(data.campaign.aiModel || DEFAULT_AI_MODEL);

export interface ReadResult {
  /** Neue Vorschläge am Artikel. */
  added: number;
  /** Angaben, die sich nicht eintragen ließen – mit dem Grund. */
  skipped: string[];
  usd: number;
}

/**
 * Lässt einen Artikel lesen und legt die Vorschläge an ihm ab. In der Welt ändert sich dadurch
 * nichts. Wirft einen Fehler mit verständlichem Satz, wenn das Lesen nicht gelingt.
 */
export async function readArticle(
  db: CampaignDb,
  articleId: string,
  ask: Ask = aiAsk,
): Promise<ReadResult> {
  const data = db.getSnapshot();
  const article = data.articles[articleId];
  if (!article) throw new Error('Diesen Artikel gibt es nicht mehr.');
  const text = articleText(article);
  if (text.length < MIN_TEXT_CHARS)
    throw new Error('In diesem Artikel steht zu wenig Text zum Lesen.');
  const model = modelOf(data);
  const path = articlePath(data.articles, articleId)
    .slice(0, -1)
    .map((entry) => entry.title)
    .join(' › ');
  const request = buildReadRequest(data, article, path);
  const response = await ask({ model: model.id, ...request });
  const reply = parseReply(response.status, response.body);

  // Währenddessen kann sich der Spielstand geändert haben: mit dem jetzigen Stand weiterrechnen.
  const now = db.getSnapshot();
  const current = now.articles[articleId];
  if (!current) throw new Error('Der Artikel wurde gelöscht, während er gelesen wurde.');
  const { hints, skipped } = suggest(now, current, reply.reading);
  db.patch('articles', articleId, {
    aiHints: [...current.aiHints, ...hints],
    aiRead: {
      at: nowIso(),
      model: model.id,
      mark: textMark(text),
      inputTokens: reply.inputTokens,
      outputTokens: reply.outputTokens,
    },
  });
  return {
    added: hints.length,
    skipped,
    usd: costUsd(model, reply.inputTokens, reply.outputTokens),
  };
}

const RelationPayload = z.object({ from: z.string(), to: z.string(), type: z.string() });
const ThreadPayload = z.object({
  text: z.string(),
  /** Abmachung oder Geheimnis; fehlt bei älteren Vorschlägen – dann entscheiden die Worte. */
  sort: z.enum(['promise', 'secret']).optional(),
  refs: z.array(z.string()).default([]),
  placeId: z.string().nullable().default(null),
});
const EventPayload = CalendarEventSchema.pick({
  title: true,
  at: true,
  timed: true,
  kind: true,
  details: true,
  placeId: true,
  refs: true,
  repeat: true,
  done: true,
});

function setState(db: CampaignDb, articleId: string, hintId: string, state: AiHint['state']) {
  const article = db.getSnapshot().articles[articleId];
  if (!article) return;
  db.patch('articles', articleId, {
    aiHints: article.aiHints.map((hint) => (hint.id === hintId ? { ...hint, state } : hint)),
  });
}

/**
 * Nimmt einen Vorschlag an: Der Termin kommt in den Kalender, die Beziehung in die Welt, das
 * Offene als Abmachung in die Chronik. Gibt `undo` zurück – oder null, wenn der Vorschlag nicht
 * (mehr) zu gebrauchen ist.
 */
export function acceptAiHint(
  db: CampaignDb,
  articleId: string,
  hintId: string,
): (() => void) | null {
  const data = db.getSnapshot();
  const hint = data.articles[articleId]?.aiHints.find((entry) => entry.id === hintId);
  if (!hint || hint.state !== 'open') return null;
  const exists = (id: string | null) => id === null || data.entities[id] !== undefined;
  return db.batch(() => {
    let undo: () => void;
    if (hint.kind === 'event') {
      const draft = EventPayload.safeParse(hint.payload);
      if (!draft.success) return null;
      const event = db.put(
        'events',
        createEvent({
          ...draft.data,
          placeId: exists(draft.data.placeId) ? draft.data.placeId : null,
          refs: draft.data.refs.filter(exists),
        }),
      );
      undo = () => db.remove('events', event.id);
    } else if (hint.kind === 'relation') {
      const draft = RelationPayload.safeParse(hint.payload);
      if (!draft.success || !exists(draft.data.from) || !exists(draft.data.to)) return null;
      const relation = db.put('relations', createRelation(draft.data));
      undo = () => db.remove('relations', relation.id);
    } else {
      const draft = ThreadPayload.safeParse(hint.payload);
      if (!draft.success) return null;
      if (threadSort(draft.data.text, draft.data.sort) === 'secret') {
        // Wissen und Geheimnisse sind nichts, was heute geschah: Sie stehen ohne Datum im
        // Dossier dessen, den sie betreffen – im Feld „Geheimnis“, das nur der Spielleiter sieht.
        const holderId =
          draft.data.refs.find((id) => data.entities[id]) ??
          Object.values(data.entities).find((entity) => entity.lk?.resourceId === articleId)?.id;
        const holder = holderId ? data.entities[holderId] : undefined;
        if (!holder) return null;
        const before = holder.secret;
        db.put('entities', {
          ...holder,
          secret: before.trim() ? `${before.trimEnd()}\n${draft.data.text}` : draft.data.text,
        });
        setState(db, articleId, hintId, 'accepted');
        return () =>
          db.batch(() => {
            const now = db.getSnapshot().entities[holder.id];
            if (now) db.put('entities', { ...now, secret: before });
            setState(db, articleId, hintId, 'open');
          });
      }
      const entry = logEntry(db, {
        kind: 'promise',
        text: draft.data.text,
        refs: draft.data.refs.filter(exists),
        placeId: exists(draft.data.placeId) ? draft.data.placeId : null,
      });
      undo = () => db.remove('chronicle', entry.id);
    }
    setState(db, articleId, hintId, 'accepted');
    return () =>
      db.batch(() => {
        undo();
        setState(db, articleId, hintId, 'open');
      });
  });
}

/** Lehnt einen Vorschlag ab; er wird für diesen Artikel nicht wieder gezeigt. Gibt `undo` zurück. */
export function dismissAiHint(db: CampaignDb, articleId: string, hintId: string): () => void {
  setState(db, articleId, hintId, 'dismissed');
  return () => setState(db, articleId, hintId, 'open');
}

/** Die Artikel, die noch nicht – oder nicht in ihrem jetzigen Wortlaut – gelesen wurden. */
export function unreadArticles(data: Pick<CampaignData, 'articles'>): Article[] {
  return Object.values(data.articles)
    .filter(needsReading)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
}

export interface ReadingTotals {
  /** Gelesene Artikel. */
  articles: number;
  /** Offene Vorschläge über alle Artikel. */
  open: number;
  /** Bisherige Kosten in US-Dollar, mit den Preisen des jeweils benutzten Modells. */
  usd: number;
}

/** Was der KI-Leser in dieser Kampagne bisher gelesen und gekostet hat. */
export function readingTotals(data: Pick<CampaignData, 'articles'>): ReadingTotals {
  const totals: ReadingTotals = { articles: 0, open: 0, usd: 0 };
  for (const article of Object.values(data.articles)) {
    totals.open += article.aiHints.filter((hint) => hint.state === 'open').length;
    if (!article.aiRead) continue;
    totals.articles++;
    totals.usd += costUsd(
      aiModel(article.aiRead.model),
      article.aiRead.inputTokens,
      article.aiRead.outputTokens,
    );
  }
  return totals;
}
