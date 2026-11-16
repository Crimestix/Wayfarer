/**
 * Das Fadenbrett als Whiteboard (Wunsch des Spielleiters, 16. 11. 2026: „ein Whiteboard, das mehr
 * Optionen bietet, wenn man sie braucht“). Auf dem Brett liegt, was der Spielleiter hinlegt:
 * Geschichten (die liegen von selbst, bis er sie wegnimmt), Fäden, Namen, Artikel. Schnüre sind
 * nur Schnüre (`state.boardLinks`) – Wayfarer zeichnet keine von selbst. Was eine Schnur in der
 * Welt bedeuten könnte, bietet `linkOffers` an; es gilt erst, wenn er es wählt.
 */
import { relationLabel } from './relations';
import type { CampaignData, Entity, Story } from './schema';
import {
  isLooseThread,
  nearness,
  threadLive,
  threadNodes,
  type BoardCard,
  type BoardView,
} from './story';
import { storyAncestors } from './storySheet';
import { isTied } from './threadWeb';
import { writtenNames } from './written';

/**
 * Die Karten des Whiteboards: Geschichten (außer weggelegten, `state.boardHidden`), lose Fäden,
 * die hingelegt sind, und Fäden einer Geschichte, die der Spielleiter einzeln hingelegt hat
 * (`thread:<id>` mit Stelle in `state.board`). Namen und Artikel sind keine Karten, sondern
 * frei liegende Namen (`node:`, `article:`). Nichts hängt von selbst an einer Karte.
 */
export function whiteboardCards(
  data: CampaignData,
  cards: readonly BoardCard[],
  view: BoardView = 'truth',
): BoardCard[] {
  const hidden = new Set(data.state.boardHidden);
  const out: BoardCard[] = cards
    .filter((card) => card.onBoard && !hidden.has(card.key))
    .map((card) => ({ ...card, nodes: [], articles: [] }));
  const have = new Set(out.map((card) => card.key));
  for (const key of Object.keys(data.state.board)) {
    if (!key.startsWith('thread:') || have.has(key) || hidden.has(key)) continue;
    const thread = data.threads[key.slice(7)];
    if (!thread || isLooseThread(data, thread)) continue;
    if (view === 'party' && !thread.known) continue;
    const shown =
      view === 'party'
        ? { ...thread, truth: '', hints: thread.hints.filter((h) => h.found) }
        : thread;
    out.push({
      key,
      story: null,
      threads: [shown],
      title: thread.title,
      nodes: [],
      articles: [],
      nearness: nearness(data, threadNodes(data, shown)),
      pace: 'none',
      clock: null,
      closed: !threadLive(thread),
      onBoard: true,
      partOf: null,
      parts: 0,
      of: data.stories[thread.storyId!] ?? null,
    });
  }
  return out;
}

/** Was eine Schnur zwischen zwei Stücken in der Welt bedeuten könnte – und ob sie es schon tut. */
export type LinkOffer =
  /** Name an Geschichte: unter ihren Beteiligten. */
  | { kind: 'cast'; storyId: string; entityId: string; on: boolean }
  /** Name an Faden: am Faden angeheftet. */
  | { kind: 'pin'; threadId: string; entityId: string; on: boolean }
  /** Zwei Namen: eine Beziehung der Welt (`label`: die eingetragene, sonst leer). */
  | { kind: 'relate'; fromId: string; toId: string; label: string }
  /** Faden an Geschichte: eine ihrer Fragen. */
  | { kind: 'question'; threadId: string; storyId: string; on: boolean }
  /** Geschichte an Geschichte: `partId` ist Teil von `wholeId` (`allowed`: kein Kreis). */
  | { kind: 'part'; partId: string; wholeId: string; on: boolean; allowed: boolean }
  /** Faden an Faden: verbunden (am Spieltisch „ein Schritt weiter“). */
  | { kind: 'tie'; a: string; b: string; on: boolean }
  /** Artikel an Geschichte oder Faden: ihm zugeordnet. */
  | {
      kind: 'article';
      sort: 'stories' | 'threads';
      docId: string;
      articleId: string;
      on: boolean;
    };

const split = (key: string): [string, string] => {
  const at = key.indexOf(':');
  return [key.slice(0, at), key.slice(at + 1)];
};

/**
 * Was eine freie Schnur zwischen `a` und `b` bedeuten könnte – je nach den beiden Stücken. Nur
 * Angebote: Gewählt wird im Menü an der Schnur, nichts geschieht von selbst.
 */
export function linkOffers(data: CampaignData, a: string, b: string): LinkOffer[] {
  const [sa, ia] = split(a);
  const [sb, ib] = split(b);
  const pair = (one: string, two: string) =>
    (sa === one && sb === two) || (sa === two && sb === one);
  const idOf = (sort: string) => (sa === sort ? ia : ib);
  const otherOf = (sort: string) => (sa === sort ? ib : ia);
  const offers: LinkOffer[] = [];
  if (pair('node', 'story')) {
    const story = data.stories[idOf('story')];
    if (story)
      offers.push({
        kind: 'cast',
        storyId: story.id,
        entityId: idOf('node'),
        on: story.refs.includes(idOf('node')) || story.ownerId === idOf('node'),
      });
  }
  if (pair('node', 'thread')) {
    const thread = data.threads[idOf('thread')];
    if (thread)
      offers.push({
        kind: 'pin',
        threadId: thread.id,
        entityId: idOf('node'),
        on: thread.refs.includes(idOf('node')),
      });
  }
  if (sa === 'node' && sb === 'node' && ia !== ib) {
    const relation = Object.values(data.relations).find(
      (entry) =>
        !entry.ended &&
        ((entry.from === ia && entry.to === ib) || (entry.from === ib && entry.to === ia)),
    );
    offers.push({
      kind: 'relate',
      fromId: ia,
      toId: ib,
      label: relation ? relationLabel(relation, relation.from === ia ? 'from' : 'to') : '',
    });
  }
  if (pair('thread', 'story')) {
    const thread = data.threads[idOf('thread')];
    const story = data.stories[otherOf('thread')];
    if (thread && story)
      offers.push({
        kind: 'question',
        threadId: thread.id,
        storyId: story.id,
        on: thread.storyId === story.id,
      });
  }
  if (sa === 'story' && sb === 'story' && ia !== ib) {
    const [one, two] = [data.stories[ia], data.stories[ib]];
    if (one && two) {
      const allowed = (part: Story, whole: Story) =>
        !storyAncestors(data, whole).some((story) => story.id === part.id);
      offers.push(
        {
          kind: 'part',
          partId: one.id,
          wholeId: two.id,
          on: one.parentId === two.id,
          allowed: allowed(one, two),
        },
        {
          kind: 'part',
          partId: two.id,
          wholeId: one.id,
          on: two.parentId === one.id,
          allowed: allowed(two, one),
        },
      );
    }
  }
  if (sa === 'thread' && sb === 'thread' && ia !== ib && data.threads[ia] && data.threads[ib])
    offers.push({ kind: 'tie', a: ia, b: ib, on: isTied(data, ia, ib) });
  if (pair('article', 'story') || pair('article', 'thread')) {
    const articleId = idOf('article');
    const other = sa === 'article' ? sb : sa;
    const docId = otherOf('article');
    const doc = other === 'story' ? data.stories[docId] : data.threads[docId];
    if (doc)
      offers.push({
        kind: 'article',
        sort: other === 'story' ? 'stories' : 'threads',
        docId,
        articleId,
        on: doc.articleIds.includes(articleId),
      });
  }
  return offers;
}

// ── Storyboard: Karten mit Text, Pfeile, wo die Gruppe steht ───────────────

/** Ein Kasten auf dem Brett: Mitte, Breite, Höhe. */
export interface BoardBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** Der Punkt am Rand eines Kastens, an dem eine Linie zu `toward` ihn verlässt. */
export function edgePoint(
  box: BoardBox,
  toward: { x: number; y: number },
): { x: number; y: number } {
  const dx = toward.x - box.cx;
  const dy = toward.y - box.cy;
  if (dx === 0 && dy === 0) return { x: box.cx, y: box.cy };
  const sx = dx === 0 ? Infinity : box.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : box.h / 2 / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: box.cx + dx * s, y: box.cy + dy * s };
}

/**
 * Der Weg einer Schnur von Kasten zu Kasten – von Rand zu Rand, leicht gebogen, damit eine
 * Pfeilspitze am Ende sichtbar bleibt. `mid` ist die Stelle für ihr Wort.
 */
export function stringPath(
  a: BoardBox,
  b: BoardBox,
  gap = 6,
): { d: string; mid: { x: number; y: number } } {
  const from = edgePoint(a, { x: b.cx, y: b.cy });
  const raw = edgePoint(b, { x: a.cx, y: a.cy });
  const len = Math.hypot(raw.x - from.x, raw.y - from.y) || 1;
  const to = {
    x: raw.x + ((from.x - raw.x) / len) * gap,
    y: raw.y + ((from.y - raw.y) / len) * gap,
  };
  // Leicht gebogen: die Mitte um ein Zwölftel der Länge zur Seite.
  const bend = Math.min(40, len / 12);
  const nx = -(to.y - from.y) / len;
  const ny = (to.x - from.x) / len;
  const cx = (from.x + to.x) / 2 + nx * bend;
  const cy = (from.y + to.y) / 2 + ny * bend;
  return {
    d: `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`,
    mid: { x: (from.x + 2 * cx + to.x) / 4, y: (from.y + 2 * cy + to.y) / 4 },
  };
}

/** Ein Stück des Bretts, wie es auf einer Karte oder am Spieltisch steht. */
export interface BoardPiece {
  key: string;
  sort: 'thread' | 'story' | 'node' | 'article';
  /** Die Kennung dahinter (Faden, Geschichte, Eintrag, Artikel). */
  id: string;
  title: string;
  /** Der Text des Spielleiters – leer, wenn keiner dasteht. */
  text: string;
}

/** Was hinter einem Schlüssel des Bretts steht – null, wenn es das nicht mehr gibt. */
export function boardPiece(data: CampaignData, key: string): BoardPiece | null {
  const cut = key.indexOf(':');
  const id = key.slice(cut + 1);
  switch (key.slice(0, cut)) {
    case 'thread': {
      const thread = data.threads[id];
      return thread ? { key, sort: 'thread', id, title: thread.title, text: thread.text } : null;
    }
    case 'story': {
      const story = data.stories[id];
      return story ? { key, sort: 'story', id, title: story.title, text: story.text } : null;
    }
    case 'node': {
      const entity = data.entities[id];
      return entity ? { key, sort: 'node', id, title: entity.name, text: entity.tagline } : null;
    }
    case 'article': {
      const article = data.articles[id];
      return article ? { key, sort: 'article', id, title: article.title, text: '' } : null;
    }
    default:
      return null;
  }
}

/**
 * Die Namen auf einer Faden-Karte: wer im Text genannt ist (Regeln des Erkennens, ohne
 * Weggeklicktes) und wer am Faden angeheftet ist – in dieser Reihenfolge, jeder einmal.
 */
export function cardNames(data: CampaignData, threadId: string): Entity[] {
  const thread = data.threads[threadId];
  if (!thread) return [];
  const seen = new Set<string>();
  const out: Entity[] = [];
  const add = (entity: Entity | undefined) => {
    if (!entity || seen.has(entity.id) || thread.notMeant.includes(entity.id)) return;
    seen.add(entity.id);
    out.push(entity);
  };
  for (const entity of writtenNames(data, [thread.title, thread.text], [], thread.notMeant).known)
    add(entity);
  for (const id of thread.refs) add(data.entities[id]);
  return out;
}

/** Ein Pfeil, der von einer Karte wegführt: wohin und mit welchem Wort. */
export interface BoardStep extends BoardPiece {
  word: string;
}

/** Wo die Gruppe auf dem Storyboard steht – und wohin ihre Pfeile führen. */
export interface BoardNowView {
  here: BoardPiece;
  /** Pfeile von hier weg (`dir: 'to'`, `a` = hier): die Abzweigungen. */
  next: BoardStep[];
  /** Pfeile, die hierher führten. */
  came: BoardStep[];
  /** Wie viele Karten schon zum gespielten Weg gehören. */
  played: number;
}

/**
 * Die markierte Karte (`state.boardNow`) mit dem, wohin ihre Pfeile führen. null, wenn keine
 * markiert ist oder es sie nicht mehr gibt. Schnüre ohne Richtung zählen nicht.
 */
export function boardNowView(data: CampaignData): BoardNowView | null {
  const key = data.state.boardNow;
  if (!key) return null;
  const here = boardPiece(data, key);
  if (!here) return null;
  const step = (other: string, word: string): BoardStep[] => {
    const piece = boardPiece(data, other);
    return piece ? [{ ...piece, word }] : [];
  };
  const arrows = data.state.boardLinks.filter((link) => link.dir === 'to');
  return {
    played: data.state.boardPlayed.filter((entry) => boardPiece(data, entry)).length,
    here,
    next: arrows.filter((link) => link.a === key).flatMap((link) => step(link.b, link.word)),
    came: arrows.filter((link) => link.b === key).flatMap((link) => step(link.a, link.word)),
  };
}
