/**
 * Festhalten: ein Befehl für alle Arten der Chronik (außer dem automatisch eingetretenen Termin),
 * jetzt oder zu einer früheren Weltzeit. Jede Art wirkt dort, wo sie hingehört – aber nur, wenn
 * der Eintrag der jüngste seiner Sorte ist (`domain/history.ts`). Nachgetragenes Älteres steht nur
 * in der Geschichte. Nichts hier stellt Zeit vor oder löst Termine, Uhren, Abläufe und Meldungen
 * aus.
 *
 * Löschen (`removeRecorded`) nimmt die Wirkung eines Eintrags zurück, solange sie noch gilt – dann
 * gilt wieder der Eintrag davor bzw. der Stand, den der Eintrag vorgefunden hat (`before`).
 */
import { KIND_LABEL, type RecordInput, type RecordKind } from '../domain/chronicleKinds';
import { entityName, findRelation } from '../domain/derive';
import {
  conditionEnding,
  isNewestOfSort,
  neighboursOfSort,
  placeForEntry,
  sessionForEntry,
  statusOf,
} from '../domain/history';
import { findPrepSecret, hintOf } from '../domain/prep';
import { RELATION_TYPES } from '../domain/relations';
import { holderAfter, planTrade, stockAfter } from '../domain/shop';
import {
  CHRONICLE_PRECISIONS,
  FIGHT_OUTCOMES,
  PARTY_ID,
  PERSON_STATUS,
  PROMISE_SORTS,
  RUMOR_TRUTHS,
  createChronicleEntry,
  createRelation,
  type BondBefore,
  type CampaignData,
  type ChronicleEntry,
  type CollectionName,
  type CollectionTypes,
  type PersonStatus,
  type PlayState,
  type RumorTruth,
} from '../domain/schema';
import { formatDateTime } from '../domain/time/calendar';
import type { CampaignDb } from './db';

// ── Eingabe ────────────────────────────────────────────────────────────────

export type { RecordInput } from '../domain/chronicleKinds';

export type RecordResult = { entry: ChronicleEntry; undo: () => void } | { problem: string };

/** Arten, die ohne Text nichts sagen. */
const NEEDS_TEXT: readonly RecordKind[] = [
  'note',
  'change',
  'promise',
  'decision',
  'quote',
  'lore',
  'rumor',
  'knowledge',
  'wish',
  'writing',
  'transformation',
];

/** Wie viele Tage eine Zwischenzeit höchstens dauert (zehn Jahre reichen für jede Pause). */
const MAX_DOWNTIME_DAYS = 3650;

/** Gleich geschrieben – ohne Rücksicht auf Groß- und Kleinschreibung und Leerzeichen. */
const sameName = (a: string, b: string) =>
  a.replace(/\s+/g, ' ').trim().toLocaleLowerCase('de') ===
  b.replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');

// Zeitstempel, die streng wachsen: Einträge derselben Weltzeit behalten so die Reihenfolge, in
// der sie festgehalten wurden – auch innerhalb derselben Millisekunde und auch nach Einträgen,
// die ein Rechner mit vorgehender Uhr geschrieben hat. Sonst wäre ein eben Festgehaltenes nicht
// der jüngste seiner Sorte und hätte keine Wirkung.
let lastStamp = 0;
function stamp(data: CampaignData, at: number): string {
  let latest = 0;
  for (const entry of Object.values(data.chronicle)) {
    if (entry.at !== at) continue;
    const time = Date.parse(entry.created);
    if (Number.isFinite(time) && time > latest) latest = time;
  }
  lastStamp = Math.max(Date.now(), lastStamp + 1, latest + 1);
  return new Date(lastStamp).toISOString();
}

const isKind = (data: CampaignData, id: string | null | undefined, ...kinds: string[]) =>
  !!id && !!data.entities[id] && kinds.includes(data.entities[id]!.kind);

const nameOf = (data: CampaignData, id: string | null) =>
  id ? entityName(data, id) : 'keinem Ort';

// ── Prüfen und Aufbauen ────────────────────────────────────────────────────

type Prepared = { entry: ChronicleEntry } | { problem: string };

/**
 * Baut den Eintrag samt der Stände, die er vorfindet (`before`), ohne etwas zu schreiben. Mit
 * `strictOrder` muss ein früherer Ortswechsel zum nächsten späteren passen.
 */
function prepare(data: CampaignData, input: RecordInput, strictOrder: boolean): Prepared {
  const now = data.state.now;
  const cal = data.campaign.calendar;
  const at = input.at ?? now;
  const kind = input.kind;
  const text = (input.text ?? '').trim();
  if (!Number.isSafeInteger(at) || at < 0) return { problem: 'Dieser Zeitpunkt ist ungültig.' };
  if (at > now)
    return {
      problem: 'Der Zeitpunkt liegt in der Zukunft. Was noch bevorsteht, gehört in den Kalender.',
    };
  if ((kind as string) === 'event')
    return { problem: 'Eingetretene Termine entstehen nur, wenn die Zeit vergeht.' };
  if (input.precision && !CHRONICLE_PRECISIONS.includes(input.precision))
    return { problem: 'Unbekannte Genauigkeit.' };
  if (input.sessionId && !data.sessions[input.sessionId])
    return { problem: 'Diese Session gibt es nicht mehr.' };
  if (input.placeId && !isKind(data, input.placeId, 'place'))
    return { problem: 'Der Ort ist kein Ort der Welt.' };
  if (NEEDS_TEXT.includes(kind) && !text)
    return { problem: `Für „${KIND_LABEL[kind]}“ fehlt der Text.` };

  let refs = [...new Set(input.refs ?? [])];
  let placeId = input.placeId === undefined ? placeForEntry(data, at) : input.placeId;
  let storyId = input.storyId;
  const base: Partial<ChronicleEntry> & { at: number } = {
    kind,
    at,
    text,
    secret: input.secret ?? false,
    backfilled: input.backfilled ?? at < now,
    precision: input.precision ?? 'exact',
    created: stamp(data, at),
  };
  // Der Eintrag, wie er stünde – für die Nachbarn seiner Sorte.
  const probe = (extra: Partial<ChronicleEntry>) =>
    createChronicleEntry({ ...base, ...extra, created: base.created });

  switch (kind) {
    case 'travel': {
      if (!input.travel) return { problem: 'Wohin ist die Gruppe gezogen?' };
      const toId = input.travel.toId;
      if (toId !== null && !isKind(data, toId, 'place'))
        return { problem: 'Das Ziel ist kein Ort.' };
      const { previous, next } = neighboursOfSort(data, probe({ travel: { fromId: null, toId } }));
      const fromId =
        at === now && !next
          ? data.state.placeId
          : previous
            ? previous.travel!.toId
            : next
              ? next.travel!.fromId
              : data.state.placeId;
      if (fromId === toId)
        return {
          problem: toId
            ? `Die Gruppe ist zu dieser Zeit schon in ${entityName(data, toId)}.`
            : 'Die Gruppe ist zu dieser Zeit an keinem Ort.',
        };
      if (strictOrder && next && next.travel!.fromId !== null && next.travel!.fromId !== toId)
        return {
          problem: `Am ${formatDateTime(cal, next.at)} bricht die Gruppe aus ${nameOf(data, next.travel!.fromId)} auf – ein früherer Ortswechsel muss deshalb dorthin führen.`,
        };
      placeId = toId;
      refs = [...new Set([...[toId, fromId].filter((id): id is string => !!id), ...refs])];
      return { entry: probe({ placeId, refs, travel: { fromId, toId }, ...rest() }) };
    }
    case 'attitude': {
      const a = input.attitude;
      if (!a) return { problem: 'Wessen Haltung hat sich geändert?' };
      if (!data.entities[a.fromId])
        return { problem: 'Wessen Haltung? Den Eintrag gibt es nicht.' };
      if (a.toId !== PARTY_ID && !data.entities[a.toId])
        return { problem: 'Gegenüber wem? Den Eintrag gibt es nicht.' };
      if (a.fromId === a.toId) return { problem: 'Eine Haltung gilt immer jemand anderem.' };
      if (a.value !== null && (!Number.isInteger(a.value) || a.value < -5 || a.value > 5))
        return { problem: 'Die Haltung reicht von −5 bis +5.' };
      const attitude = { fromId: a.fromId, toId: a.toId, before: null, after: a.value };
      const { previous, next } = neighboursOfSort(data, probe({ attitude }));
      const before = next
        ? (previous?.attitude?.after ?? null)
        : (findRelation(data, a.fromId, a.toId)?.attitude ?? null);
      refs = [...new Set([...[a.fromId, a.toId].filter((id) => id !== PARTY_ID), ...refs])];
      return { entry: probe({ placeId, refs, attitude: { ...attitude, before }, ...rest() }) };
    }
    case 'promise': {
      const outcome = input.promise?.outcome ?? 'open';
      const promise = {
        due: input.promise?.due ?? null,
        done: outcome !== 'open',
        failed: outcome === 'failed',
        sort: input.promise?.sort ?? 'promise',
      };
      if (!PROMISE_SORTS.includes(promise.sort)) return { problem: 'Unbekannte Sorte.' };
      return { entry: probe({ placeId, refs, promise, ...rest() }) };
    }
    case 'fight': {
      const outcome = input.fight?.outcome ?? 'open';
      if (!FIGHT_OUTCOMES.includes(outcome)) return { problem: 'Unbekannter Ausgang.' };
      const encounterId = input.fight?.encounterId ?? null;
      if (encounterId && !data.encounters[encounterId])
        return { problem: 'Diese Begegnung gibt es nicht mehr.' };
      return { entry: probe({ placeId, refs, fight: { outcome, encounterId }, ...rest() }) };
    }
    case 'rest':
      return {
        entry: probe({ placeId, refs, rest: { long: input.rest?.long ?? false }, ...rest() }),
      };
    case 'meeting': {
      if (!refs.length) return { problem: 'Wen hat die Gruppe getroffen?' };
      const firstMet = refs.filter((id) => {
        const entity = data.entities[id];
        return entity?.kind === 'person' && !entity.person.met;
      });
      return { entry: probe({ placeId, refs, meeting: { firstMet }, ...rest() }) };
    }
    case 'fate': {
      const f = input.fate;
      if (!f) return { problem: 'Wessen Schicksal?' };
      if (!isKind(data, f.entityId, 'person', 'character'))
        return { problem: 'Ein Schicksal gibt es nur für Personen und Gefährten.' };
      if (!PERSON_STATUS.includes(f.status)) return { problem: 'Unbekanntes Schicksal.' };
      const fate = { entityId: f.entityId, status: f.status, before: null };
      const { previous, next } = neighboursOfSort(data, probe({ fate }));
      const before = next ? (previous?.fate?.status ?? null) : statusOf(data, f.entityId);
      refs = [...new Set([f.entityId, ...refs])];
      return { entry: probe({ placeId, refs, fate: { ...fate, before }, ...rest() }) };
    }
    case 'whereabouts': {
      const w = input.whereabouts;
      if (!w) return { problem: 'Wessen Aufenthalt?' };
      const entity = data.entities[w.entityId];
      if (entity?.kind !== 'person' && entity?.kind !== 'character')
        return { problem: 'Einen Aufenthalt haben nur Personen und Gefährten.' };
      if (w.placeId !== null && !isKind(data, w.placeId, 'place'))
        return { problem: 'Der Aufenthalt ist kein Ort der Welt.' };
      const whereabouts = { entityId: w.entityId, placeId: w.placeId, before: null };
      const { previous, next } = neighboursOfSort(data, probe({ whereabouts }));
      const current = entity.kind === 'person' ? entity.person.placeId : entity.character.placeId;
      const before = next ? (previous?.whereabouts?.placeId ?? null) : current;
      refs = [...new Set([...[w.entityId, w.placeId].filter((id): id is string => !!id), ...refs])];
      return {
        entry: probe({ placeId, refs, whereabouts: { ...whereabouts, before }, ...rest() }),
      };
    }
    case 'rumor': {
      const sourceId = input.rumor?.sourceId ?? null;
      const truth = input.rumor?.truth ?? 'unchecked';
      if (sourceId && !data.entities[sourceId])
        return { problem: 'Die Quelle gibt es nicht in der Welt.' };
      if (!RUMOR_TRUTHS.includes(truth)) return { problem: 'Unbekannter Stand.' };
      if (sourceId) refs = [...new Set([sourceId, ...refs])];
      return { entry: probe({ placeId, refs, rumor: { sourceId, truth }, ...rest() }) };
    }
    case 'bond': {
      const b = input.bond;
      if (!b) return { problem: 'Welche Beziehung?' };
      if (!data.entities[b.fromId]) return { problem: 'Den ersten Eintrag gibt es nicht.' };
      if (b.toId !== PARTY_ID && !data.entities[b.toId])
        return { problem: 'Den zweiten Eintrag gibt es nicht.' };
      if (b.fromId === b.toId) return { problem: 'Eine Beziehung braucht zwei.' };
      const type = b.type ?? 'knows';
      if (!RELATION_TYPES.some((t) => t.key === type)) return { problem: 'Unbekannte Beziehung.' };
      const ended = b.ended ?? false;
      const relation = b.relationId
        ? data.relations[b.relationId]
        : Object.values(data.relations).find(
            (r) => r.from === b.fromId && r.to === b.toId && r.type === type,
          );
      if (b.relationId && !relation) return { problem: 'Diese Beziehung gibt es nicht mehr.' };
      const bond = {
        relationId: relation?.id ?? null,
        fromId: b.fromId,
        toId: b.toId,
        type,
        label: b.label ?? relation?.label ?? '',
        ended,
        before: null as BondBefore | null,
      };
      const newest = !neighboursOfSort(data, probe({ bond })).next;
      if (newest) {
        const now: BondBefore = !relation ? 'none' : relation.ended ? 'ended' : 'active';
        bond.before = ended ? (now === 'active' ? now : null) : now === 'active' ? null : now;
      }
      refs = [...new Set([...[b.fromId, b.toId].filter((id) => id !== PARTY_ID), ...refs])];
      return { entry: probe({ placeId, refs, bond, ...rest() }) };
    }
    case 'condition': {
      const c = input.condition;
      if (!c) return { problem: 'Wessen Zustand?' };
      const entity = data.entities[c.entityId];
      if (entity?.kind !== 'person' && entity?.kind !== 'character')
        return { problem: 'Einen Zustand haben nur Personen und Gefährten.' };
      const ended = c.ended ?? false;
      const endsId = ended ? (c.endsId ?? null) : null;
      let words = text;
      if (endsId) {
        const start = data.chronicle[endsId];
        if (!start?.condition || start.condition.ended || start.condition.entityId !== c.entityId)
          return { problem: 'Diesen Zustand gibt es nicht.' };
        if (start.at > at) return { problem: 'Ein Zustand endet nicht, bevor er begann.' };
        if (conditionEnding(data, endsId))
          return { problem: 'Dieser Zustand ist schon aufgehoben.' };
        words = words || start.text;
      }
      if (!words) return { problem: 'Welcher Zustand? Der Eintrag braucht einen Text.' };
      refs = [...new Set([c.entityId, ...refs])];
      return {
        entry: probe({
          text: words,
          placeId,
          refs,
          condition: { entityId: c.entityId, ended, endsId },
          ...rest(),
        }),
      };
    }
    case 'milestone': {
      const m = input.milestone;
      if (!m || !isKind(data, m.characterId, 'character'))
        return { problem: 'Ein Meilenstein gehört zu einem Gefährten.' };
      const level = m.level ?? null;
      if (level !== null && (!Number.isInteger(level) || level < 1 || level > 20))
        return { problem: 'Die Stufe reicht von 1 bis 20.' };
      const milestone = { characterId: m.characterId, level, before: null };
      let before: number | null = null;
      if (level !== null) {
        const { previous, next } = neighboursOfSort(data, probe({ milestone }));
        const character = data.entities[m.characterId]!;
        before = next
          ? (previous?.milestone?.level ?? null)
          : character.kind === 'character'
            ? character.character.level
            : null;
      }
      refs = [...new Set([m.characterId, ...refs])];
      return { entry: probe({ placeId, refs, milestone: { ...milestone, before }, ...rest() }) };
    }
    case 'wish': {
      const w = input.wish;
      if (!w || !isKind(data, w.characterId, 'character'))
        return { problem: 'Ein Spielerwunsch gehört zu einem Gefährten.' };
      const character = data.entities[w.characterId]!;
      const setGoal = w.setGoal ?? false;
      refs = [w.characterId, ...refs.filter((id) => id !== w.characterId)];
      const wish = { setGoal, before: null as string | null };
      if (setGoal) {
        // Wie bei den übrigen Sorten: Ziel wird nur der jüngste Wunsch, der Ziel werden soll.
        const { previous, next } = neighboursOfSort(data, probe({ refs, wish }));
        wish.before = next
          ? (previous?.text ?? null)
          : character.kind === 'character'
            ? character.character.goal
            : null;
      }
      return { entry: probe({ placeId, refs, wish, ...rest() }) };
    }
    case 'clue': {
      const threadId = input.clue?.threadId ?? null;
      const hintId = input.clue?.hintId ?? null;
      const thread = threadId ? data.threads[threadId] : undefined;
      if (threadId && !thread) return { problem: 'Diesen Faden gibt es nicht mehr.' };
      const hint = hintId ? thread?.hints.find((h) => h.id === hintId) : undefined;
      if (hintId && !hint) return { problem: 'Diesen Hinweis gibt es nicht mehr.' };
      if (storyId === undefined) storyId = thread?.storyId ?? null;
      const before = hint && !hint.found ? { known: thread!.known, state: thread!.state } : null;
      return {
        entry: probe({ placeId, refs, clue: { threadId, hintId, before }, ...rest() }),
      };
    }
    case 'reveal': {
      const prepSecretId = input.reveal?.prepSecretId ?? null;
      const secret = prepSecretId ? findPrepSecret(data, prepSecretId)?.secret : undefined;
      if (prepSecretId && !secret) return { problem: 'Dieses Geheimnis gibt es nicht mehr.' };
      if (storyId === undefined) storyId = secret?.storyId ?? null;
      // Ein Geheimnis, das der Hinweis einer Frage ist: Aufgedeckt heißt gefunden.
      const linked = secret ? hintOf(data, secret) : null;
      const known = linked ? linked.hint.found : !!secret?.revealed;
      let alias: { entityId: string; name: string; added: boolean } | null = null;
      if (input.reveal?.alias) {
        const { entityId } = input.reveal.alias;
        const name = input.reveal.alias.name.replace(/\s+/g, ' ').trim();
        const entity = data.entities[entityId];
        if (!entity) return { problem: 'Wessen Name? Den Eintrag gibt es nicht.' };
        if (!name) return { problem: 'Welcher Name? Er fehlt.' };
        const known = [entity.name, ...entity.aliases].some((n) => sameName(n, name));
        alias = { entityId, name, added: !known };
        refs = [...new Set([entityId, ...refs])];
      }
      return {
        entry: probe({
          text: text || secret?.text || '',
          placeId,
          refs,
          reveal: {
            prepSecretId,
            applied: !!secret && !known,
            alias,
            hint:
              linked && !linked.hint.found
                ? {
                    threadId: linked.thread.id,
                    hintId: linked.hint.id,
                    before: { known: linked.thread.known, state: linked.thread.state },
                  }
                : null,
          },
          ...rest(),
        }),
      };
    }
    case 'writing': {
      const title = (input.writing?.title ?? '').replace(/\s+/g, ' ').trim();
      const articleId = input.writing?.articleId ?? null;
      if (articleId && !data.articles[articleId])
        return { problem: 'Diesen Artikel gibt es nicht mehr.' };
      if (input.writing?.createArticle && !articleId && !title)
        return { problem: 'Wie soll der Artikel heißen? Das Schriftstück braucht einen Titel.' };
      return { entry: probe({ placeId, refs, writing: { title, articleId }, ...rest() }) };
    }
    case 'downtime': {
      const d = input.downtime;
      const days = d?.days ?? 0;
      if (!Number.isInteger(days) || days < 0 || days > MAX_DOWNTIME_DAYS)
        return { problem: 'Die freie Zeit ist keine Zahl von Tagen.' };
      const activities: { characterId: string; text: string }[] = [];
      for (const activity of d?.activities ?? []) {
        const words = activity.text.trim();
        if (!words) continue;
        if (!isKind(data, activity.characterId, 'character'))
          return { problem: 'Eine Tätigkeit gehört zu einem Gefährten.' };
        activities.push({ characterId: activity.characterId, text: words });
      }
      if (!days && !text && !activities.length)
        return { problem: 'Wie lange dauert die freie Zeit?' };
      refs = [...new Set([...refs, ...activities.map((a) => a.characterId)])];
      return { entry: probe({ placeId, refs, downtime: { days, activities }, ...rest() }) };
    }
    case 'transformation': {
      const characterId = input.transformation?.characterId;
      if (!characterId || !isKind(data, characterId, 'character'))
        return { problem: 'Eine Wandlung gehört zu einem Gefährten.' };
      refs = [...new Set([characterId, ...refs])];
      return { entry: probe({ placeId, refs, transformation: { characterId }, ...rest() }) };
    }
    case 'companion': {
      const c = input.companion;
      if (!c || !isKind(data, c.entityId, 'person'))
        return { problem: 'Welches Tier oder Wesen? Es braucht einen Eintrag der Welt.' };
      const ownerId = c.ownerId ?? null;
      if (ownerId && !isKind(data, ownerId, 'character'))
        return { problem: 'Ein Begleiter gehört zu einem Gefährten oder zur ganzen Gruppe.' };
      const joined = c.joined ?? true;
      const to = ownerId ?? PARTY_ID;
      const own = Object.values(data.relations).filter(
        (r) => r.from === c.entityId && r.type === 'companion',
      );
      const relation = joined
        ? own.find((r) => r.to === to)
        : (own.find((r) => r.to === to && !r.ended) ?? own.find((r) => !r.ended));
      const companion = {
        entityId: c.entityId,
        joined,
        ownerId: joined
          ? ownerId
          : relation
            ? relation.to === PARTY_ID
              ? null
              : relation.to
            : ownerId,
        relationId: relation?.id ?? null,
        before: null as BondBefore | null,
      };
      const newest = !neighboursOfSort(data, probe({ companion })).next;
      if (newest) {
        const state: BondBefore = !relation ? 'none' : relation.ended ? 'ended' : 'active';
        companion.before = joined
          ? state === 'active'
            ? null
            : state
          : state === 'active'
            ? state
            : null;
      }
      refs = [
        ...new Set([
          ...[c.entityId, companion.ownerId].filter((id): id is string => !!id),
          ...refs,
        ]),
      ];
      return { entry: probe({ placeId, refs, companion, ...rest() }) };
    }
    case 'knowledge':
      if (!refs.length) return { problem: 'Wer hat es erfahren?' };
      return { entry: probe({ placeId, refs, ...rest() }) };
    case 'change': {
      const h = input.holder;
      if (!h) return { entry: probe({ placeId, refs, ...rest() }) };
      const item = data.entities[h.itemId];
      if (item?.kind !== 'item')
        return { problem: 'Welcher Gegenstand? Den Eintrag gibt es nicht.' };
      if (h.holderId !== null && !data.entities[h.holderId])
        return { problem: 'Bei wem? Den Eintrag gibt es nicht.' };
      const holder = {
        itemId: h.itemId,
        holderId: h.holderId,
        before: h.before === undefined ? item.item.holderId : h.before,
      };
      refs = [...new Set([...[h.itemId, h.holderId].filter((id): id is string => !!id), ...refs])];
      return { entry: probe({ placeId, refs, holder, ...rest() }) };
    }
    case 'trade': {
      if (!input.trade) return { problem: 'Was wurde gekauft oder verkauft?' };
      const plan = planTrade(data, input.trade);
      if ('problem' in plan) return plan;
      // Gehandelt wird im Laden – steht er an einem Ort, geschah es dort.
      if (input.placeId === undefined && plan.placeId) placeId = plan.placeId;
      refs = [...new Set([...plan.refs, ...refs])];
      return { entry: probe({ placeId, refs, trade: plan.trade, ...rest() }) };
    }
    case 'discovery':
    case 'decision':
    case 'quote':
    case 'lore':
    case 'note':
      return { entry: probe({ placeId, refs, ...rest() }) };
  }

  function rest(): Partial<ChronicleEntry> {
    return {
      sessionId: input.sessionId === undefined ? sessionForEntry(data, at) : input.sessionId,
      storyId: storyId ?? null,
    };
  }
}

/** Was gegen einen Eintrag spricht – leer, wenn er sich festhalten lässt. Für die Anzeige im Dialog. */
export function recordProblem(data: CampaignData, input: RecordInput): string {
  const prepared = prepare(data, input, true);
  return 'problem' in prepared ? prepared.problem : '';
}

/** Der Eintrag, wie er festgehalten würde – ohne etwas zu schreiben (für eine Vorschau). */
export function previewRecord(data: CampaignData, input: RecordInput): ChronicleEntry | null {
  const prepared = prepare(data, input, true);
  return 'entry' in prepared ? prepared.entry : null;
}

// ── Wirkung ────────────────────────────────────────────────────────────────

/** Wendet die Wirkung eines eben gespeicherten Eintrags an. */
function applyEffect(db: CampaignDb, entry: ChronicleEntry): void {
  const data = db.getSnapshot();
  const newest = isNewestOfSort(data, entry);
  const next = neighboursOfSort(data, entry).next;
  switch (entry.kind) {
    case 'travel':
      if (newest && entry.travel) db.setState({ placeId: entry.travel.toId });
      return;
    case 'attitude': {
      const a = entry.attitude;
      if (!a) return;
      if (newest) {
        const existing = findRelation(data, a.fromId, a.toId);
        if (existing) db.patch('relations', existing.id, { attitude: a.after });
        else db.put('relations', createRelation({ from: a.fromId, to: a.toId, attitude: a.after }));
      } else if (next?.attitude)
        db.patch('chronicle', next.id, { attitude: { ...next.attitude, before: a.after } });
      return;
    }
    case 'fate': {
      const f = entry.fate;
      if (!f) return;
      if (newest) setStatus(db, f.entityId, f.status);
      else if (next?.fate)
        db.patch('chronicle', next.id, { fate: { ...next.fate, before: f.status } });
      return;
    }
    case 'whereabouts': {
      const w = entry.whereabouts;
      if (!w) return;
      if (newest) setWhereabouts(db, w.entityId, w.placeId);
      else if (next?.whereabouts)
        db.patch('chronicle', next.id, { whereabouts: { ...next.whereabouts, before: w.placeId } });
      return;
    }
    case 'milestone': {
      const m = entry.milestone;
      if (!m || m.level === null) return;
      if (newest) patchCharacter(db, m.characterId, { level: m.level });
      else if (next?.milestone)
        db.patch('chronicle', next.id, { milestone: { ...next.milestone, before: m.level } });
      return;
    }
    case 'meeting':
      for (const id of entry.meeting?.firstMet ?? []) patchPerson(db, id, { met: true });
      return;
    case 'bond': {
      const b = entry.bond;
      if (!b || b.before === null) return;
      if (b.before === 'none') {
        const relation = db.put(
          'relations',
          createRelation({ from: b.fromId, to: b.toId, type: b.type, label: b.label }),
        );
        db.patch('chronicle', entry.id, { bond: { ...b, relationId: relation.id } });
      } else if (b.relationId && data.relations[b.relationId])
        db.patch('relations', b.relationId, { ended: b.ended });
      return;
    }
    case 'wish': {
      const characterId = entry.refs[0];
      if (!entry.wish?.setGoal || !characterId) return;
      if (newest) patchCharacter(db, characterId, { goal: entry.text });
      else if (next?.wish)
        db.patch('chronicle', next.id, { wish: { ...next.wish, before: entry.text } });
      return;
    }
    case 'clue': {
      const c = entry.clue;
      if (!c?.before || !c.threadId || !c.hintId) return;
      const thread = data.threads[c.threadId];
      if (!thread) return;
      db.patch('threads', thread.id, {
        hints: thread.hints.map((hint) => (hint.id === c.hintId ? { ...hint, found: true } : hint)),
        known: true,
        state: thread.state === 'open' ? 'active' : thread.state,
      });
      return;
    }
    case 'reveal': {
      const r = entry.reveal;
      const alias = r?.alias;
      if (alias?.added) {
        const entity = data.entities[alias.entityId];
        if (entity && !entity.aliases.some((n) => sameName(n, alias.name)))
          db.patch('entities', entity.id, { aliases: [...entity.aliases, alias.name] });
      }
      if (!r?.applied || !r.prepSecretId) return;
      const found = findPrepSecret(data, r.prepSecretId);
      if (!found) return;
      db.patch('preps', found.prep.id, {
        secrets: found.prep.secrets.map((secret) =>
          secret.id === r.prepSecretId
            ? { ...secret, revealed: true, revealedAt: entry.at }
            : secret,
        ),
      });
      // War es der Hinweis einer Frage, hat die Gruppe ihn jetzt – wie bei „Hinweis gefunden“.
      const thread = r.hint ? data.threads[r.hint.threadId] : undefined;
      if (r.hint && thread)
        db.patch('threads', thread.id, {
          hints: thread.hints.map((hint) =>
            hint.id === r.hint!.hintId ? { ...hint, found: true } : hint,
          ),
          known: true,
          state: thread.state === 'open' ? 'active' : thread.state,
        });
      return;
    }
    case 'companion': {
      const c = entry.companion;
      if (!c || c.before === null) return;
      if (c.before === 'none') {
        const relation = db.put(
          'relations',
          createRelation({ from: c.entityId, to: c.ownerId ?? PARTY_ID, type: 'companion' }),
        );
        db.patch('chronicle', entry.id, { companion: { ...c, relationId: relation.id } });
      } else if (c.relationId && data.relations[c.relationId])
        db.patch('relations', c.relationId, { ended: !c.joined });
      return;
    }
    case 'trade': {
      const t = entry.trade;
      if (!t) return;
      // Der Bestand des Ladens zieht mit; ein einzelnes Stück wechselt den Besitzer.
      const shop = t.shopId ? data.shops[t.shopId] : undefined;
      if (shop) db.patch('shops', shop.id, { stock: stockAfter(shop.stock, t) });
      const holderId = holderAfter(data, t);
      for (const line of t.lines) {
        const item = line.claimed && line.entityId ? data.entities[line.entityId] : undefined;
        if (item?.kind === 'item' && item.item.holderId !== holderId)
          db.put('entities', { ...item, item: { ...item.item, holderId } });
      }
      return;
    }
    default:
      return;
  }
}

type PersonDetails = Extract<CollectionTypes['entities'], { kind: 'person' }>['person'];
type CharacterDetails = Extract<CollectionTypes['entities'], { kind: 'character' }>['character'];

function patchPerson(db: CampaignDb, id: string, change: Partial<PersonDetails>): void {
  const entity = db.getSnapshot().entities[id];
  if (entity?.kind === 'person')
    db.put('entities', { ...entity, person: { ...entity.person, ...change } });
}

function patchCharacter(db: CampaignDb, id: string, change: Partial<CharacterDetails>): void {
  const entity = db.getSnapshot().entities[id];
  if (entity?.kind === 'character')
    db.put('entities', { ...entity, character: { ...entity.character, ...change } });
}

function setStatus(db: CampaignDb, id: string, status: PersonStatus): void {
  const entity = db.getSnapshot().entities[id];
  if (entity?.kind === 'person') patchPerson(db, id, { status });
  else if (entity?.kind === 'character') patchCharacter(db, id, { status });
}

/** Steht der zweite Name noch so am Eintrag, wie ihn ein Aufgedeckt hinzugefügt hat? */
function aliasHolds(data: CampaignData, entry: ChronicleEntry): boolean {
  const alias = entry.reveal?.alias;
  if (!alias?.added) return false;
  return !!data.entities[alias.entityId]?.aliases.some((n) => sameName(n, alias.name));
}

/** Ist das Geheimnis vom Abend-Blatt noch so aufgedeckt, wie es dieser Eintrag tat? */
function secretHolds(data: CampaignData, entry: ChronicleEntry): boolean {
  const r = entry.reveal;
  const found = r?.applied && r.prepSecretId ? findPrepSecret(data, r.prepSecretId) : null;
  return !!found && found.secret.revealed && found.secret.revealedAt === entry.at;
}

function setWhereabouts(db: CampaignDb, id: string, placeId: string | null): void {
  const entity = db.getSnapshot().entities[id];
  if (entity?.kind === 'person') patchPerson(db, id, { placeId });
  else if (entity?.kind === 'character') patchCharacter(db, id, { placeId });
}

// ── Befehle ────────────────────────────────────────────────────────────────

/**
 * Hält einen Eintrag fest – jetzt oder früher – und wendet seine Wirkung an, wenn er der jüngste
 * seiner Sorte ist. `undo` nimmt ihn samt Wirkung zurück. Bei einem Widerspruch (Zukunft,
 * Reihenfolge der Ortswechsel, fehlende Angaben) wird nichts geschrieben.
 */
export function recordEntry(db: CampaignDb, input: RecordInput): RecordResult {
  return record(db, input, true);
}

function record(db: CampaignDb, input: RecordInput, strictOrder: boolean): RecordResult {
  const before = db.getSnapshot();
  const prepared = prepare(before, input, strictOrder);
  if ('problem' in prepared) return prepared;
  const entry = db.batch(() => {
    db.put('chronicle', prepared.entry);
    applyEffect(db, prepared.entry);
    return db.getSnapshot().chronicle[prepared.entry.id]!;
  });
  // Eine Haltung legt die Beziehung an, wenn es sie noch nicht gab. Rückgängig nimmt sie dann
  // wieder weg – solange seitdem niemand sonst etwas an ihr geändert hat.
  const a = entry.attitude;
  const made =
    a && !findRelation(before, a.fromId, a.toId)
      ? findRelation(db.getSnapshot(), a.fromId, a.toId)
      : undefined;
  const madeRev = made?.rev ?? null;
  return {
    entry,
    undo: () =>
      db.batch(() => {
        const untouched = !!made && db.getSnapshot().relations[made.id]?.rev === madeRev;
        if (removeRecorded(db, entry.id) && untouched) db.remove('relations', made!.id);
      }),
  };
}

/**
 * Hält mehrere Einträge zusammen fest – etwa, was Wayfarer in einem Satz erkannt hat, oder eine
 * Folge von Ortswechseln beim Nachtragen. Die Reihenfolge der Ortswechsel wird erst am Ende
 * geprüft, damit sich auch eine Rundreise zwischen zwei bekannte Ortswechsel schieben lässt.
 * Alles oder nichts: Bei einem Problem bleibt der Spielstand, wie er war.
 */
export function recordEntries(
  db: CampaignDb,
  inputs: RecordInput[],
): { entries: ChronicleEntry[]; undo: () => void } | { problem: string } {
  return db.batch(() => {
    const done: { entry: ChronicleEntry; undo: () => void }[] = [];
    const byInput: ChronicleEntry[] = [];
    const rollback = () => {
      for (const item of [...done].reverse()) item.undo();
    };
    // Festgehalten wird in der Reihenfolge der Weltzeit, damit jeder Ortswechsel dort aufbricht,
    // wo der vorige hinführte – gleich, in welcher Reihenfolge die Eingaben kommen. Einträge
    // derselben Zeit behalten ihre Reihenfolge.
    const now = db.getSnapshot().state.now;
    const order = inputs
      .map((input, index) => ({ input, index }))
      .sort((x, y) => (x.input.at ?? now) - (y.input.at ?? now));
    for (const { input, index } of order) {
      const result = record(db, input, false);
      if ('problem' in result) {
        rollback();
        return result;
      }
      done.push(result);
      byInput[index] = result.entry;
    }
    const problem = travelOrderProblem(
      db.getSnapshot(),
      done.map((item) => item.entry.id),
    );
    if (problem) {
      rollback();
      return { problem };
    }
    return { entries: byInput, undo: () => db.batch(rollback) };
  });
}

/** Passen die Ortswechsel um diese Einträge herum zueinander? Leer, wenn ja. */
function travelOrderProblem(data: CampaignData, ids: string[]): string {
  const travels = Object.values(data.chronicle)
    .filter((entry) => entry.kind === 'travel' && entry.travel)
    .sort((a, b) => a.at - b.at || a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
  const touched = new Set(ids);
  for (let i = 1; i < travels.length; i++) {
    const previous = travels[i - 1]!;
    const current = travels[i]!;
    if (!touched.has(previous.id) && !touched.has(current.id)) continue;
    const fromId = current.travel!.fromId;
    if (fromId !== null && fromId !== previous.travel!.toId)
      return `Am ${formatDateTime(data.campaign.calendar, current.at)} bricht die Gruppe aus ${nameOf(data, fromId)} auf – der Ortswechsel davor führt aber nach ${nameOf(data, previous.travel!.toId)}.`;
  }
  return '';
}

/** Gilt die Wirkung eines Eintrags noch? Dann nimmt Löschen sie zurück. */
export function effectHolds(data: CampaignData, entry: ChronicleEntry): boolean {
  switch (entry.kind) {
    case 'travel':
      return (
        !!entry.travel && isNewestOfSort(data, entry) && data.state.placeId === entry.travel.toId
      );
    case 'attitude': {
      const relation = entry.attitude
        ? findRelation(data, entry.attitude.fromId, entry.attitude.toId)
        : undefined;
      return (
        !!relation && isNewestOfSort(data, entry) && relation.attitude === entry.attitude!.after
      );
    }
    case 'fate':
      return (
        !!entry.fate &&
        isNewestOfSort(data, entry) &&
        statusOf(data, entry.fate.entityId) === entry.fate.status
      );
    case 'whereabouts': {
      const entity = entry.whereabouts ? data.entities[entry.whereabouts.entityId] : undefined;
      const current =
        entity?.kind === 'person'
          ? entity.person.placeId
          : entity?.kind === 'character'
            ? entity.character.placeId
            : undefined;
      return (
        current !== undefined &&
        isNewestOfSort(data, entry) &&
        current === entry.whereabouts!.placeId
      );
    }
    case 'milestone': {
      const m = entry.milestone;
      const character = m ? data.entities[m.characterId] : undefined;
      return (
        !!m &&
        m.level !== null &&
        character?.kind === 'character' &&
        isNewestOfSort(data, entry) &&
        character.character.level === m.level
      );
    }
    case 'meeting':
      return (entry.meeting?.firstMet ?? []).some((id) => {
        const person = data.entities[id];
        return person?.kind === 'person' && person.person.met;
      });
    case 'bond': {
      const b = entry.bond;
      if (!b || b.before === null || !b.relationId) return false;
      const relation = data.relations[b.relationId];
      if (!relation) return false;
      return relation.ended === b.ended;
    }
    case 'wish': {
      const character = entry.refs[0] ? data.entities[entry.refs[0]] : undefined;
      return (
        !!entry.wish?.setGoal &&
        character?.kind === 'character' &&
        isNewestOfSort(data, entry) &&
        character.character.goal === entry.text
      );
    }
    case 'clue': {
      const c = entry.clue;
      const thread = c?.threadId ? data.threads[c.threadId] : undefined;
      return !!c?.before && !!thread?.hints.find((h) => h.id === c.hintId)?.found;
    }
    case 'reveal':
      return secretHolds(data, entry) || aliasHolds(data, entry);
    case 'companion': {
      const c = entry.companion;
      if (!c || c.before === null || !c.relationId) return false;
      const relation = data.relations[c.relationId];
      return !!relation && relation.ended === !c.joined;
    }
    case 'trade': {
      const t = entry.trade;
      if (!t) return false;
      const holderId = holderAfter(data, t);
      const stocked = !!t.shopId && !!data.shops[t.shopId] && t.lines.some((l) => l.stockId);
      return (
        stocked ||
        t.lines.some((line) => {
          const item = line.claimed && line.entityId ? data.entities[line.entityId] : undefined;
          return item?.kind === 'item' && item.item.holderId === holderId;
        })
      );
    }
    default:
      return false;
  }
}

/** Merkt sich, was ein Löschen geändert hat, um es genau so zurückzunehmen. */
class Changes {
  private docs: {
    collection: CollectionName;
    id: string;
    before: unknown;
    afterRev: number | null;
  }[] = [];
  private place: { before: string | null; after: string | null } | null = null;

  constructor(private readonly db: CampaignDb) {}

  private remember(collection: CollectionName, id: string) {
    if (this.docs.some((doc) => doc.collection === collection && doc.id === id)) return;
    const current = (this.db.getSnapshot()[collection] as Record<string, unknown>)[id];
    this.docs.push({ collection, id, before: current, afterRev: null });
  }

  put<C extends CollectionName>(collection: C, doc: CollectionTypes[C]) {
    this.remember(collection, doc.id);
    this.db.put(collection, doc);
  }

  patch<C extends CollectionName>(collection: C, id: string, change: Partial<CollectionTypes[C]>) {
    this.remember(collection, id);
    this.db.patch(collection, id, change);
  }

  remove(collection: CollectionName, id: string) {
    this.remember(collection, id);
    this.db.remove(collection, id);
  }

  setPlace(placeId: PlayState['placeId']) {
    this.place = { before: this.db.getSnapshot().state.placeId, after: placeId };
    this.db.setState({ placeId });
  }

  /** Nach dem Ändern aufrufen: merkt sich den Stand danach. */
  seal() {
    const data = this.db.getSnapshot();
    for (const doc of this.docs) {
      const now = (data[doc.collection] as Record<string, { rev: number }>)[doc.id];
      doc.afterRev = now ? now.rev : null;
    }
  }

  /** Stellt alles wieder her, was seitdem niemand sonst geändert hat. */
  restore() {
    const db = this.db;
    db.batch(() => {
      const data = db.getSnapshot();
      for (const doc of [...this.docs].reverse()) {
        const now = (data[doc.collection] as Record<string, { rev: number }>)[doc.id];
        if ((now ? now.rev : null) !== doc.afterRev) continue;
        if (doc.before === undefined) db.remove(doc.collection, doc.id);
        else db.put(doc.collection, doc.before as CollectionTypes[typeof doc.collection]);
      }
      if (this.place && db.getSnapshot().state.placeId === this.place.after)
        db.setState({ placeId: this.place.before });
    });
  }
}

/**
 * Löscht einen Eintrag samt seiner Wirkung, solange sie noch gilt: Danach gilt wieder der
 * Eintrag davor bzw. der Stand, den er vorgefunden hat. Der nächste Eintrag derselben Sorte
 * übernimmt seinen Stand davor. Gibt `undo` zurück; null, wenn es den Eintrag nicht gibt oder er
 * die Zeile einer Beute-Ausgabe ist (die geht über `dropLootLine` in `features/beute`).
 */
export function removeRecorded(db: CampaignDb, entryId: string): (() => void) | null {
  const data = db.getSnapshot();
  const entry = data.chronicle[entryId];
  if (!entry) return null;
  if (Object.values(data.loot).some((loot) => loot.given && loot.chronicleId === entryId))
    return null;
  const changes = new Changes(db);
  db.batch(() => {
    const holds = effectHolds(data, entry);
    const { previous, next } = neighboursOfSort(data, entry);
    switch (entry.kind) {
      case 'travel': {
        const fromId = entry.travel?.fromId ?? null;
        if (holds) changes.setPlace(fromId && data.entities[fromId] ? fromId : null);
        // Der nächste Ortswechsel bricht dann dort auf, wo die Gruppe vorher war.
        const after = next?.travel;
        if (next && after && entry.travel && after.fromId === entry.travel.toId)
          changes.patch('chronicle', next.id, {
            travel: { ...after, fromId },
            refs: [
              ...new Set(
                [after.toId, fromId, ...next.refs.filter((id) => id !== after.fromId)].filter(
                  (id): id is string => !!id,
                ),
              ),
            ],
          });
        break;
      }
      case 'attitude': {
        const a = entry.attitude!;
        if (holds) {
          const relation = findRelation(data, a.fromId, a.toId)!;
          changes.patch('relations', relation.id, {
            attitude: a.before ?? previous?.attitude?.after ?? null,
          });
        }
        if (next?.attitude)
          changes.patch('chronicle', next.id, { attitude: { ...next.attitude, before: a.before } });
        break;
      }
      case 'fate': {
        const f = entry.fate!;
        const entity = data.entities[f.entityId];
        const status = f.before ?? previous?.fate?.status ?? 'alive';
        if (holds && entity?.kind === 'person')
          changes.put('entities', { ...entity, person: { ...entity.person, status } });
        if (holds && entity?.kind === 'character')
          changes.put('entities', { ...entity, character: { ...entity.character, status } });
        if (next?.fate)
          changes.patch('chronicle', next.id, { fate: { ...next.fate, before: f.before } });
        break;
      }
      case 'whereabouts': {
        const w = entry.whereabouts!;
        const entity = data.entities[w.entityId];
        if (holds && entity?.kind === 'person')
          changes.put('entities', { ...entity, person: { ...entity.person, placeId: w.before } });
        if (holds && entity?.kind === 'character')
          changes.put('entities', {
            ...entity,
            character: { ...entity.character, placeId: w.before },
          });
        if (next?.whereabouts)
          changes.patch('chronicle', next.id, {
            whereabouts: { ...next.whereabouts, before: w.before },
          });
        break;
      }
      case 'milestone': {
        const m = entry.milestone!;
        const entity = data.entities[m.characterId];
        const back = m.before ?? previous?.milestone?.level ?? null;
        if (holds && entity?.kind === 'character' && back !== null)
          changes.put('entities', { ...entity, character: { ...entity.character, level: back } });
        if (next?.milestone && m.level !== null)
          changes.patch('chronicle', next.id, {
            milestone: { ...next.milestone, before: m.before },
          });
        break;
      }
      case 'meeting': {
        const others = Object.values(data.chronicle).filter(
          (e) => e.kind === 'meeting' && e.id !== entry.id,
        );
        for (const id of entry.meeting?.firstMet ?? []) {
          const person = data.entities[id];
          if (person?.kind !== 'person' || !person.person.met) continue;
          if (others.some((e) => e.refs.includes(id))) continue;
          changes.put('entities', { ...person, person: { ...person.person, met: false } });
        }
        break;
      }
      case 'bond': {
        const b = entry.bond!;
        if (!holds || !b.relationId) break;
        if (b.before === 'none') changes.remove('relations', b.relationId);
        else changes.patch('relations', b.relationId, { ended: b.before === 'ended' });
        break;
      }
      case 'wish': {
        const character = data.entities[entry.refs[0] ?? ''];
        if (holds && character?.kind === 'character')
          changes.put('entities', {
            ...character,
            character: {
              ...character.character,
              goal: entry.wish?.before ?? previous?.text ?? '',
            },
          });
        if (next?.wish)
          changes.patch('chronicle', next.id, {
            wish: { ...next.wish, before: entry.wish?.before ?? null },
          });
        break;
      }
      case 'clue': {
        const c = entry.clue!;
        const thread = c.threadId ? data.threads[c.threadId] : undefined;
        if (!holds || !thread || !c.before) break;
        const hints = thread.hints.map((hint) =>
          hint.id === c.hintId ? { ...hint, found: false } : hint,
        );
        const stateAfter = c.before.state === 'open' ? 'active' : c.before.state;
        changes.patch('threads', thread.id, {
          hints,
          known: c.before.known || hints.some((hint) => hint.found),
          state: thread.state === stateAfter ? c.before.state : thread.state,
        });
        break;
      }
      case 'reveal': {
        const alias = entry.reveal?.alias;
        const entity = alias ? data.entities[alias.entityId] : undefined;
        if (alias && entity && aliasHolds(data, entry))
          changes.patch('entities', entity.id, {
            aliases: entity.aliases.filter((n) => !sameName(n, alias.name)),
          });
        const found = entry.reveal?.prepSecretId
          ? findPrepSecret(data, entry.reveal.prepSecretId)
          : null;
        if (!secretHolds(data, entry) || !found) break;
        changes.patch('preps', found.prep.id, {
          secrets: found.prep.secrets.map((secret) =>
            secret.id === found.secret.id
              ? { ...secret, revealed: false, revealedAt: null }
              : secret,
          ),
        });
        // Der Hinweis dahinter ist dann auch nicht mehr gefunden – der Faden steht wie zuvor.
        const h = entry.reveal?.hint;
        const thread = h ? data.threads[h.threadId] : undefined;
        if (h && thread) {
          const hints = thread.hints.map((hint) =>
            hint.id === h.hintId ? { ...hint, found: false } : hint,
          );
          const stateAfter = h.before.state === 'open' ? 'active' : h.before.state;
          changes.patch('threads', thread.id, {
            hints,
            known: h.before.known || hints.some((hint) => hint.found),
            state: thread.state === stateAfter ? h.before.state : thread.state,
          });
        }
        break;
      }
      case 'companion': {
        const c = entry.companion!;
        if (!holds || !c.relationId) break;
        if (c.before === 'none') changes.remove('relations', c.relationId);
        else changes.patch('relations', c.relationId, { ended: c.before === 'ended' });
        break;
      }
      case 'trade': {
        const t = entry.trade;
        if (!t) break;
        // Der Bestand geht zurück; ein einzelnes Stück kehrt zurück, wenn es noch dort ist,
        // wohin der Handel es brachte.
        const shop = t.shopId ? data.shops[t.shopId] : undefined;
        if (shop) changes.patch('shops', shop.id, { stock: stockAfter(shop.stock, t, true) });
        const holderId = holderAfter(data, t);
        for (const line of t.lines) {
          const item = line.claimed && line.entityId ? data.entities[line.entityId] : undefined;
          if (item?.kind === 'item' && item.item.holderId === holderId)
            changes.put('entities', {
              ...item,
              item: { ...item.item, holderId: line.holderBefore },
            });
        }
        break;
      }
      default:
        break;
    }
    changes.remove('chronicle', entry.id);
    changes.seal();
  });
  return () => changes.restore();
}

/** Setzt, ob ein Gerücht stimmt: ungeprüft, stimmt oder falsch. */
export function setRumorTruth(db: CampaignDb, entryId: string, truth: RumorTruth): void {
  const entry = db.getSnapshot().chronicle[entryId];
  if (entry?.kind !== 'rumor') return;
  db.patch('chronicle', entryId, { rumor: { sourceId: entry.rumor?.sourceId ?? null, truth } });
}

/**
 * Hebt einen Zustand auf: ein neuer Eintrag der Art „Zustand“ mit `ended`, der den Beginn nennt.
 * So steht das Ende mit eigener Zeit und Session in der Geschichte – auch nachgetragen.
 */
export function endCondition(
  db: CampaignDb,
  entryId: string,
  options: Pick<RecordInput, 'at' | 'text' | 'sessionId' | 'placeId' | 'secret' | 'precision'> = {},
): RecordResult {
  const start = db.getSnapshot().chronicle[entryId];
  if (!start?.condition || start.condition.ended)
    return { problem: 'Diesen Zustand gibt es nicht.' };
  return recordEntry(db, {
    kind: 'condition',
    ...options,
    secret: options.secret ?? start.secret,
    storyId: start.storyId,
    condition: { entityId: start.condition.entityId, ended: true, endsId: start.id },
  });
}
