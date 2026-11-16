/**
 * Das Netz der Fäden: Fäden hängen an Fäden, quer über Geschichten – „Faden für Faden“ wie ein
 * Spinnennetz (Wunsch des Spielleiters, 16. 11. 2026). Zwei Wege führen von einem Faden zum
 * nächsten:
 *
 * - eine **Verbindung** (`thread.ties`): gilt in beide Richtungen, steht nur an einem der beiden,
 *   darf ein freies Wort tragen („wer dahintersteckt“);
 * - ein **Hinweis, der zu einem Faden führt** (`hint.leadsTo`): Findet die Gruppe ihn, geht die
 *   Spur dort weiter.
 *
 * Gespeichert wird nur, was der Spielleiter zieht. Alles hier ist gelesen: wer mit wem, was einen
 * Schritt weiter liegt, welche Fäden gleiche Namen teilen (nur ein Vorschlag), und wie das Netz
 * auf dem Fadenbrett liegt. Fehlt ein Faden (gelöscht), fällt die Verbindung still weg.
 */
import { SUGGESTION, isDismissed } from './dismiss';
import type { CampaignData, Story, Thread, ThreadHint } from './schema';
import { storyNodes, threadLive, threadNodes, type BoardCard, type BoardView } from './story';

type WebData = Pick<
  CampaignData,
  'threads' | 'stories' | 'entities' | 'state' | 'clocks' | 'paths' | 'maps' | 'relations'
>;

export interface ThreadTie {
  thread: Thread;
  /** Was sie verbindet – frei geschrieben, darf leer sein. */
  word: string;
}

/** Mit welchen Fäden einer verbunden ist – in beide Richtungen, jeder nur einmal. */
export function tiesOf(data: Pick<CampaignData, 'threads'>, threadId: string): ThreadTie[] {
  const own = data.threads[threadId];
  if (!own) return [];
  const out = new Map<string, ThreadTie>();
  for (const tie of own.ties) {
    const other = data.threads[tie.id];
    if (other && other.id !== threadId) out.set(other.id, { thread: other, word: tie.word });
  }
  for (const other of Object.values(data.threads)) {
    if (other.id === threadId) continue;
    const tie = other.ties.find((entry) => entry.id === threadId);
    if (!tie) continue;
    const known = out.get(other.id);
    out.set(other.id, { thread: other, word: known?.word || tie.word });
  }
  return [...out.values()].sort((a, b) => a.thread.title.localeCompare(b.thread.title, 'de'));
}

/** Sind zwei Fäden verbunden (gleich, an welchem die Verbindung steht)? */
export const isTied = (data: Pick<CampaignData, 'threads'>, a: string, b: string): boolean =>
  data.threads[a]?.ties.some((tie) => tie.id === b) === true ||
  data.threads[b]?.ties.some((tie) => tie.id === a) === true;

/** Der Faden, zu dem ein Hinweis führt – null, wenn keiner (oder es ihn nicht mehr gibt). */
export function leadOf(
  data: Pick<CampaignData, 'threads'>,
  hint: Pick<ThreadHint, 'leadsTo'>,
  fromId?: string,
): Thread | null {
  const target = hint.leadsTo ? data.threads[hint.leadsTo] : undefined;
  return target && target.id !== fromId ? target : null;
}

export type WebStep = 'tie' | 'leads' | 'ledFrom';

/** Ein Faden einen Schritt weiter im Netz – und auf welchem Weg. */
export interface WebNeighbour {
  thread: Thread;
  /** `tie` = verbunden; `leads` = ein eigener Hinweis führt hin; `ledFrom` = einer von dort her. */
  step: WebStep;
  /** Das Wort der Verbindung oder der Text des Hinweises. */
  word: string;
  /** Der Hinweis, über den die Spur geht (bei `leads`, `ledFrom`). */
  hint: ThreadHint | null;
}

/**
 * Was von einem Faden aus genau einen Schritt weiter liegt: Verbindungen, die Fäden, zu denen
 * seine Hinweise führen, und die, deren Hinweise zu ihm führen. Jeder Faden nur einmal – die
 * Verbindung vor dem Hinweis.
 */
export function neighboursOf(
  data: Pick<CampaignData, 'threads'>,
  threadId: string,
): WebNeighbour[] {
  const own = data.threads[threadId];
  if (!own) return [];
  const out = new Map<string, WebNeighbour>();
  for (const tie of tiesOf(data, threadId))
    out.set(tie.thread.id, { thread: tie.thread, step: 'tie', word: tie.word, hint: null });
  for (const hint of own.hints) {
    const target = leadOf(data, hint, threadId);
    if (target && !out.has(target.id))
      out.set(target.id, { thread: target, step: 'leads', word: hint.text, hint });
  }
  for (const other of Object.values(data.threads)) {
    if (other.id === threadId || out.has(other.id)) continue;
    const hint = other.hints.find((entry) => entry.leadsTo === threadId);
    if (hint) out.set(other.id, { thread: other, step: 'ledFrom', word: hint.text, hint });
  }
  return [...out.values()];
}

/**
 * Was ein gefundener Hinweis sagt: wohin die Spur jetzt geht – null, wenn er nirgendwohin
 * führt. Nur ein Satz für den Spielleiter; ins Spiel nimmt er den Faden selbst.
 */
export function leadNote(
  data: Pick<CampaignData, 'threads'>,
  threadId: string,
  hintId: string,
): string | null {
  const hint = data.threads[threadId]?.hints.find((entry) => entry.id === hintId);
  const target = hint ? leadOf(data, hint, threadId) : null;
  return target ? `Die Spur führt jetzt zu „${target.title}“.` : null;
}

/** Ein Faden, der zu diesem passen könnte – weil beide an denselben Namen hängen. */
export interface TieFit {
  thread: Thread;
  /** „gleicher Ort: Duskryns Arena“ */
  reason: string;
}

/** So viele Fäden schlägt Wayfarer zum Verbinden höchstens vor. */
export const TIE_FITS = 3;

/**
 * Fäden, die zu einem passen könnten: Sie hängen an demselben Ort, derselben Person oder
 * Fraktion, sind noch nicht verbunden und nicht weggeklickt. Nur ein Vorschlag – verbunden wird
 * nie von selbst.
 */
export function tieFits(data: WebData, threadId: string): TieFit[] {
  const own = data.threads[threadId];
  if (!own) return [];
  const mine = new Set(threadNodes(data, own));
  if (!mine.size) return [];
  const near = new Set(neighboursOf(data, threadId).map((entry) => entry.thread.id));
  const fits: (TieFit & { shared: number })[] = [];
  for (const other of Object.values(data.threads)) {
    if (other.id === threadId || near.has(other.id) || !threadLive(other)) continue;
    if (isDismissed(data, SUGGESTION.tie(threadId, other.id))) continue;
    const shared = threadNodes(data, other).filter((id) => mine.has(id));
    if (!shared.length) continue;
    const first = data.entities[shared[0]!];
    const what = first?.kind === 'place' ? 'gleicher Ort' : 'gleicher Name';
    const names = shared.map((id) => data.entities[id]?.name ?? '?');
    fits.push({
      thread: other,
      reason: `${what}: ${names.slice(0, 2).join(', ')}${names.length > 2 ? ' …' : ''}`,
      shared: shared.length,
    });
  }
  return fits
    .sort((a, b) => b.shared - a.shared || a.thread.title.localeCompare(b.thread.title, 'de'))
    .map(({ thread, reason }) => ({ thread, reason }));
}

// ── Das Netz auf dem Fadenbrett ────────────────────────────────────────────

/** Ein Faden als eigener Knoten an seiner Geschichte. */
export interface BoardKnot {
  /** `knot:<threadId>` – unter diesem Schlüssel merkt sich das Brett seine Stelle. */
  key: string;
  thread: Thread;
  /** Die Karte der Geschichte, an der er hängt. */
  cardKey: string;
  /** Woran er hängt – diese Namen hängen am Knoten, nicht mehr an der Karte. */
  nodes: string[];
}

/** Eine Schnur zwischen zwei Fäden auf dem Brett. */
export interface WebString {
  key: string;
  /** Wo sie beginnt und endet: `knot:…`, `thread:…` (loser Faden) oder `story:…`. */
  a: string;
  b: string;
  /** `tie` = verbunden; `lead` = ein Hinweis von `a` führt zu `b`. */
  kind: 'tie' | 'lead';
  word: string;
  /** Die beiden Fäden – für Rückgängig und den Seitenteil. */
  from: string;
  to: string;
  /** Bei `lead`: der Hinweis an `from`, der zu `to` führt. */
  hintId: string | null;
}

export interface BoardWeb {
  /** Die Karten, wie sie auf dem Brett liegen: Namen eines Knotens hängen nicht mehr an der Karte. */
  cards: BoardCard[];
  knots: BoardKnot[];
  strings: WebString[];
}

const unique = (ids: readonly string[]) => [...new Set(ids)];

/**
 * Das Netz auf dem Brett. Eine aufgeklappte Geschichte (`story.unfolded`) zeigt ihre lebendigen
 * Fäden als Knoten; ein Faden, der über seine Karte hinaus verbunden ist, steht immer als Knoten
 * da – sonst sähe man das Netz nicht. Schnüre gehen zwischen den Stellen der Fäden: ihr Knoten,
 * sonst ihre Karte. Was nicht auf dem Brett liegt (abgeschlossen, loser Faden in der Liste),
 * hält keine Schnur. In der Sicht der Gruppe zählen nur die Fäden und gefundenen Hinweise, die
 * sie kennt (`cards` kommt schon so aus `boardCards`).
 */
export function boardWeb(
  data: WebData,
  cards: readonly BoardCard[],
  view: BoardView = 'truth',
): BoardWeb {
  const lying = cards.filter((card) => !card.closed && card.onBoard);
  /** Wo jeder sichtbare Faden liegt: Schlüssel seiner Karte. */
  const cardOf = new Map<string, string>();
  const seen = new Map<string, Thread>();
  for (const card of lying)
    for (const thread of card.threads) {
      cardOf.set(thread.id, card.key);
      seen.set(thread.id, thread);
    }

  /** Alle Paare von Fäden, die eine Schnur verbinden könnte. */
  const pairs: Omit<WebString, 'key' | 'a' | 'b'>[] = [];
  const tied = new Set<string>();
  for (const thread of seen.values()) {
    for (const tie of data.threads[thread.id]?.ties ?? []) {
      if (!seen.has(tie.id) || tie.id === thread.id) continue;
      const pair = [thread.id, tie.id].sort().join('|');
      if (tied.has(pair)) continue;
      tied.add(pair);
      pairs.push({ kind: 'tie', word: tie.word, from: thread.id, to: tie.id, hintId: null });
    }
    for (const hint of thread.hints)
      if (hint.leadsTo && hint.leadsTo !== thread.id && seen.has(hint.leadsTo))
        pairs.push({
          kind: 'lead',
          word: hint.text,
          from: thread.id,
          to: hint.leadsTo,
          hintId: hint.id,
        });
  }

  // Knoten: aufgeklappt – oder über die eigene Karte hinaus verbunden.
  const knotted = new Set<string>();
  for (const card of lying) {
    if (!card.story) continue;
    for (const thread of card.threads) {
      const reaches = pairs.some(
        (pair) =>
          (pair.from === thread.id && cardOf.get(pair.to) !== card.key) ||
          (pair.to === thread.id && cardOf.get(pair.from) !== card.key),
      );
      const shown = card.story.unfolded && threadLive(thread);
      if (shown || reaches) knotted.add(thread.id);
    }
  }

  const knots: BoardKnot[] = [];
  const adjusted = cards.map((card): BoardCard => {
    if (!card.story || !lying.includes(card)) return card;
    const mine = card.threads.filter((thread) => knotted.has(thread.id));
    if (!mine.length) return card;
    for (const thread of mine)
      knots.push({
        key: `knot:${thread.id}`,
        thread,
        cardKey: card.key,
        nodes: threadNodes(data, thread),
      });
    const skip = new Set(mine.map((thread) => thread.id));
    // Die Namen der Knoten hängen an den Knoten; an der Karte bleibt, was sonst zu ihr gehört.
    const nodes =
      view === 'party'
        ? unique(
            card.threads
              .filter((thread) => !skip.has(thread.id))
              .flatMap((thread) => threadNodes(data, thread)),
          )
        : storyNodes(data, card.story as Story, skip);
    return { ...card, nodes };
  });

  const spot = (threadId: string) =>
    knotted.has(threadId) ? `knot:${threadId}` : (cardOf.get(threadId) ?? null);
  const strings: WebString[] = [];
  for (const pair of pairs) {
    const [a, b] = [spot(pair.from), spot(pair.to)];
    if (!a || !b || a === b) continue;
    strings.push({ ...pair, a, b, key: `${pair.kind}:${pair.from}:${pair.to}` });
  }
  return { cards: adjusted, knots, strings };
}
