/**
 * Kontinuität: „Passt nicht zusammen“. Wayfarer liest Chronik, Lebensdaten, Verwandtschaft,
 * Beute-Buch und Wege und meldet leise, was sich widerspricht – ein Toter, der danach noch
 * spricht; ein Einzelstück, das zweimal ausgegeben wurde; ein Kind, das vor seiner Mutter geboren
 * ist; eine Reise, die schneller war als jeder bekannte Weg.
 *
 * Geprüft wird immer nach Eintrag (id), nie nach Namen: Zwei Personen dürfen gleich heißen. Was
 * der Spielleiter mit „Passt so“ wegklickt, steht in `state.continuityOk` und fällt heraus.
 * Wayfarer ändert nichts – es zeigt nur. Reine Funktionen.
 */
import { KIND_LABEL, byTime, chronicleSorted, entityName } from './derive';
import { entryEntityIds, fateSince, statusOf } from './history';
import { genderOf, kinGraph, kinLabel } from './kin';
import { formatDatePoint, lifeWords } from './lifespan';
import { formatWayTime, routeBetween } from './ways';
import {
  PARTY_ID,
  type CampaignData,
  type ChronicleEntry,
  type ChronicleKind,
  type DatePoint,
  type Entity,
} from './schema';
import {
  MINUTES_PER_DAY,
  formatDate,
  formatDateTime,
  formatDuration,
  fromTime,
  shiftMonth,
  startOfDay,
  toTime,
  yearLength,
  type CalendarDef,
  type WorldTime,
} from './time/calendar';

export type IssueWeight = 'hint' | 'warn';

/** Ein Widerspruch: was nicht zusammenpasst, in einem ganzen Satz. */
export interface Issue {
  /** Stabil über Neustarts: daran merkt sich „Passt so“ den Punkt. */
  key: string;
  text: string;
  /** Die Einträge der Welt, um die es geht. */
  refs: string[];
  /** Der Eintrag der Chronik, an dem es sich zeigt. */
  entryId?: string;
  /** `warn` = kann so nicht stimmen; `hint` = sieht seltsam aus, kann aber gewollt sein. */
  weight: IssueWeight;
}

// ── Hilfen ─────────────────────────────────────────────────────────────────

const isLiving = (entity: Entity | undefined): boolean =>
  entity?.kind === 'person' || entity?.kind === 'character';

/** Das Ende eines Tages, Monats oder Jahres: der erste Zeitpunkt danach. */
export function pointEnd(cal: CalendarDef, point: DatePoint): WorldTime {
  if (point.precision === 'day') return startOfDay(point.at) + MINUTES_PER_DAY;
  const d = fromTime(cal, point.at);
  if (point.precision === 'month') {
    const next = shiftMonth(cal, d.year, d.month, 1);
    return toTime(cal, { year: next.year, month: next.month, day: 1, hour: 0, minute: 0 });
  }
  return toTime(cal, { year: d.year + 1, month: 0, day: 1, hour: 0, minute: 0 });
}

/** Der Tod: als Lebensdatum eingetragen oder aus der Chronik (Schicksal „tot“). */
function deathOf(data: CampaignData, entity: Entity): DatePoint | null {
  if (entity.ended) return entity.ended;
  if (statusOf(data, entity.id) !== 'dead') return null;
  const since = fateSince(data, entity.id);
  return since ? { at: since.since, precision: 'day' } : null;
}

/** „am 3. Tauwind 680“, „im Tauwind 680“, „680“. */
function onPoint(cal: CalendarDef, point: DatePoint): string {
  const text = formatDatePoint(cal, point);
  return point.precision === 'day'
    ? `am ${text}`
    : point.precision === 'month'
      ? `im ${text}`
      : text;
}

const times = (n: number) =>
  n === 2 ? 'zweimal' : n === 3 ? 'dreimal' : n === 4 ? 'viermal' : `${n}-mal`;

const listNames = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;

/** Einträge, in denen nur über jemanden gesprochen wird – die dürfen vor seiner Geburt liegen. */
const TALK_KINDS: ReadonlySet<ChronicleKind> = new Set<ChronicleKind>([
  'rumor',
  'lore',
  'knowledge',
  'writing',
  'clue',
  'reveal',
]);

/** Ein Zeitpunkt, der nur ungefähr bekannt ist, taugt nicht für einen Widerspruch. */
const roughTime = (entry: ChronicleEntry) =>
  entry.precision === 'approx' || entry.precision === 'order';

// ── a) Tot oder verschollen – und danach noch dabei ────────────────────────

/** Verweise ohne den Ort des Geschehens. */
const others = (entry: ChronicleEntry) => entry.refs.filter((id) => id !== entry.placeId);

/** Wer in einem Eintrag selbst handelt oder anwesend ist – mit dem, was er tut. */
function actorsOf(entry: ChronicleEntry): { id: string; doing: (d: string) => string }[] {
  switch (entry.kind) {
    case 'meeting': {
      const ids = new Set([...others(entry), ...(entry.meeting?.firstMet ?? [])]);
      return [...ids].map((id) => ({ id, doing: (d) => `wird aber ${d} noch getroffen` }));
    }
    case 'fight':
      return others(entry).map((id) => ({
        id,
        doing: (d) => `ist aber ${d} noch an einem Kampf beteiligt`,
      }));
    case 'quote': {
      const speaker = others(entry)[0];
      return speaker ? [{ id: speaker, doing: (d) => `sagt aber ${d} noch etwas` }] : [];
    }
    case 'attitude':
      return entry.attitude
        ? [{ id: entry.attitude.fromId, doing: (d) => `ändert aber ${d} noch die Haltung` }]
        : [];
    case 'bond':
      return entry.bond && !entry.bond.ended
        ? [entry.bond.fromId, entry.bond.toId].map((id) => ({
            id,
            doing: (d: string) => `geht aber ${d} noch eine Beziehung ein`,
          }))
        : [];
    default:
      return [];
  }
}

const isGone = (status: string | undefined) => status === 'dead' || status === 'missing';

function afterFate(data: CampaignData, sorted: ChronicleEntry[]): Issue[] {
  const cal = data.campaign.calendar;
  const fates = new Map<string, ChronicleEntry[]>();
  for (const entry of sorted) {
    if (entry.kind !== 'fate' || !entry.fate) continue;
    const list = fates.get(entry.fate.entityId);
    if (list) list.push(entry);
    else fates.set(entry.fate.entityId, [entry]);
  }
  if (!fates.size) return [];
  const out: Issue[] = [];
  for (const entry of sorted) {
    const seen = new Set<string>();
    for (const actor of actorsOf(entry)) {
      if (seen.has(actor.id)) continue;
      seen.add(actor.id);
      const list = fates.get(actor.id);
      if (!list || !isLiving(data.entities[actor.id])) continue;
      const before = list.filter((fate) => byTime(fate, entry) < 0).at(-1);
      if (!before || !isGone(before.fate!.status)) continue;
      // Ein späteres Schicksal hebt es auf: wiedergefunden, zurückgekehrt.
      if (list.some((fate) => byTime(fate, entry) > 0 && !isGone(fate.fate!.status))) continue;
      const dead = before.fate!.status === 'dead';
      const name = entityName(data, actor.id);
      const when = formatDate(cal, before.at);
      out.push({
        key: `dead-seen:${entry.id}:${actor.id}`,
        text: `${name} ${dead ? `starb laut Chronik am ${when}` : `gilt laut Chronik ab ${when} als verschollen`}, ${actor.doing(`am ${formatDate(cal, entry.at)}`)}.`,
        refs: [actor.id],
        entryId: entry.id,
        weight: dead ? 'warn' : 'hint',
      });
    }
  }
  return out;
}

// ── b) Beute: zweimal ausgegeben, Besitzer tot ─────────────────────────────

function lootIssues(data: CampaignData): Issue[] {
  const out: Issue[] = [];
  const given = new Map<string, CampaignData['loot'][string][]>();
  for (const loot of Object.values(data.loot)) {
    if (!loot.given || !loot.itemId || data.entities[loot.itemId]?.kind !== 'item') continue;
    const list = given.get(loot.itemId);
    if (list) list.push(loot);
    else given.set(loot.itemId, [loot]);
  }
  for (const [itemId, list] of given) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || a.created.localeCompare(b.created));
    const recipients = list.map((loot) => (loot.toId ? entityName(data, loot.toId) : 'die Gruppe'));
    const last = list[list.length - 1]!;
    out.push({
      key: `loot-twice:${itemId}:${list
        .map((loot) => loot.id)
        .sort()
        .join(',')}`,
      text: `„${entityName(data, itemId)}“ wurde ${times(list.length)} ausgegeben – an ${listNames(recipients)}.`,
      refs: [itemId, ...new Set(list.map((loot) => loot.toId).filter((id): id is string => !!id))],
      ...(last.chronicleId && data.chronicle[last.chronicleId]
        ? { entryId: last.chronicleId }
        : {}),
      weight: 'warn',
    });
  }
  for (const item of Object.values(data.entities)) {
    if (item.kind !== 'item' || !item.item.holderId) continue;
    const holderId = item.item.holderId;
    if (statusOf(data, holderId) !== 'dead') continue;
    const holder = entityName(data, holderId);
    out.push({
      key: `holder-dead:${item.id}:${holderId}`,
      text: `„${item.name}“ gehört ${holder}, aber ${holder} ist tot.`,
      refs: [item.id, holderId],
      weight: 'hint',
    });
  }
  return out;
}

// ── c) Lebensdaten ─────────────────────────────────────────────────────────

const ARTICLE: Record<string, { nom: string; gen: string }> = {
  Mutter: { nom: 'die Mutter', gen: 'der Mutter' },
  Vater: { nom: 'der Vater', gen: 'des Vaters' },
  Elternteil: { nom: 'der Elternteil', gen: 'des Elternteils' },
};

function lifeIssues(data: CampaignData, sorted: ChronicleEntry[]): Issue[] {
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const out: Issue[] = [];
  const deaths = new Map<string, DatePoint | null>();
  const death = (entity: Entity) => {
    if (!deaths.has(entity.id)) deaths.set(entity.id, deathOf(data, entity));
    return deaths.get(entity.id)!;
  };

  for (const entity of Object.values(data.entities)) {
    const born = entity.born;
    if (!born) continue;
    const words = lifeWords(entity.kind);
    const ended = death(entity);
    if (ended && born.at >= pointEnd(cal, ended))
      out.push({
        key: `born-after-end:${entity.id}:${born.at}:${ended.at}`,
        text: `Bei ${entity.name} liegt „${words.start}: ${formatDatePoint(cal, born)}“ nach „${words.end}: ${formatDatePoint(cal, ended)}“.`,
        refs: [entity.id],
        weight: 'warn',
      });
    if (born.at > now)
      out.push({
        key: `born-future:${entity.id}:${born.at}`,
        text: `Bei ${entity.name} liegt „${words.start}: ${formatDatePoint(cal, born)}“ in der Zukunft.`,
        refs: [entity.id],
        weight: 'hint',
      });
  }

  // Eltern und Kinder: wie eingetragen, nur direkte Verwandtschaft.
  const graph = kinGraph(data);
  for (const [childId, parents] of graph.parents) {
    const child = data.entities[childId];
    if (!child?.born) continue;
    for (const parentId of parents) {
      const parent = data.entities[parentId];
      if (!parent) continue;
      const word = kinLabel('parent', genderOf(parent));
      const article = ARTICLE[word] ?? { nom: word, gen: word };
      if (parent.born && pointEnd(cal, child.born) <= parent.born.at)
        out.push({
          key: `child-early:${childId}:${parentId}`,
          text: `${child.name} ist ${onPoint(cal, child.born)} geboren, ${article.nom} ${parent.name} aber erst ${onPoint(cal, parent.born)}.`,
          refs: [childId, parentId],
          weight: 'warn',
        });
      const ended = death(parent);
      if (!ended) continue;
      const grace = yearLength(cal, fromTime(cal, ended.at).year) * MINUTES_PER_DAY;
      if (child.born.at >= pointEnd(cal, ended) + grace)
        out.push({
          key: `child-late:${childId}:${parentId}`,
          text: `${child.name} ist ${onPoint(cal, child.born)} geboren – mehr als ein Jahr nach dem Tod ${article.gen} ${parent.name} (${formatDatePoint(cal, ended)}).`,
          refs: [childId, parentId],
          weight: 'warn',
        });
    }
  }

  // Einträge der Chronik vor der Geburt – nur bei genau bekanntem Tag oder Monat.
  const early = new Map<string, ChronicleEntry[]>();
  for (const entry of sorted) {
    if (roughTime(entry) || TALK_KINDS.has(entry.kind)) continue;
    for (const id of entryEntityIds(entry)) {
      const entity = data.entities[id];
      if (!isLiving(entity) || !entity!.born || entity!.born.precision === 'year') continue;
      if (entry.at >= entity!.born.at) continue;
      const list = early.get(id);
      if (list) list.push(entry);
      else early.set(id, [entry]);
    }
  }
  for (const [id, entries] of early) {
    const entity = data.entities[id]!;
    const born = entity.born!;
    const first = entries[0]!;
    const n = entries.length;
    out.push({
      key: `before-birth:${id}:${born.at}`,
      text: `${entity.name} ist ${onPoint(cal, born)} geboren, kommt aber schon ${n === 1 ? 'in einem Eintrag' : `in ${n} Einträgen`} der Chronik davor vor – ${n === 1 ? '' : 'zuerst '}am ${formatDate(cal, first.at)}.`,
      refs: [id],
      entryId: first.id,
      weight: 'hint',
    });
  }
  return out;
}

// ── d) Unmögliche Reise ────────────────────────────────────────────────────

function travelIssues(data: CampaignData, sorted: ChronicleEntry[]): Issue[] {
  const cal = data.campaign.calendar;
  // Wer in derselben Minute mehrmals den Ort wechselt, hat sich verbessert: Es zählt der letzte.
  const arrivals: ChronicleEntry[] = [];
  for (const entry of sorted) {
    if (entry.kind !== 'travel' || !entry.travel?.toId) continue;
    if (arrivals.at(-1)?.at === entry.at) arrivals[arrivals.length - 1] = entry;
    else arrivals.push(entry);
  }
  // Ohne Wetter: Gerechnet wird mit dem schnellsten Tempo bei trockenem Weg.
  const ways = { entities: data.entities, paths: data.paths, maps: data.maps };
  const out: Issue[] = [];
  for (let i = 1; i < arrivals.length; i++) {
    const before = arrivals[i - 1]!;
    const entry = arrivals[i]!;
    if (before.backfilled || entry.backfilled) continue;
    if (before.precision !== 'exact' || entry.precision !== 'exact') continue;
    const fromId = before.travel!.toId!;
    const toId = entry.travel!.toId!;
    if (fromId === toId) continue;
    const route = routeBetween(ways, fromId, toId, 'fast');
    if (!route || route.minutes <= 0) continue;
    const gap = entry.at - before.at;
    if (gap >= route.minutes) continue;
    const from = entityName(data, fromId);
    const to = entityName(data, toId);
    out.push({
      key: `travel-fast:${entry.id}`,
      text: `Die Gruppe war am ${formatDateTime(cal, before.at)} in ${from} und ${gap === 0 ? 'in derselben Minute' : `${formatDuration(gap)} später`} in ${to} – der kürzeste bekannte Weg dauert auch im schnellen Tempo ${formatWayTime(route.minutes)}.`,
      refs: [fromId, toId],
      entryId: entry.id,
      weight: 'hint',
    });
  }
  return out;
}

// ── e) Verweise auf Gelöschtes ─────────────────────────────────────────────

function goneRefs(data: CampaignData, sorted: ChronicleEntry[]): Issue[] {
  const cal = data.campaign.calendar;
  const gone = new Map<string, ChronicleEntry[]>();
  for (const entry of sorted)
    for (const id of entryEntityIds(entry)) {
      if (id === PARTY_ID || data.entities[id]) continue;
      const list = gone.get(id);
      if (list) list.push(entry);
      else gone.set(id, [entry]);
    }
  return [...gone].map(([id, entries]) => {
    const n = entries.length;
    const first = entries[0]!;
    return {
      key: `gone-ref:${id}`,
      text:
        n === 1
          ? `Ein Eintrag der Chronik vom ${formatDate(cal, first.at)} verweist auf einen Eintrag der Welt, den es nicht mehr gibt.`
          : `${n} Einträge der Chronik verweisen auf einen Eintrag der Welt, den es nicht mehr gibt – der erste vom ${formatDate(cal, first.at)}.`,
      refs: [],
      entryId: first.id,
      weight: 'hint' as const,
    };
  });
}

// ── f) Gleiche Namen ───────────────────────────────────────────────────────

function sameNames(data: CampaignData): Issue[] {
  const groups = new Map<string, Entity[]>();
  for (const entity of Object.values(data.entities)) {
    const name = entity.name.trim().toLocaleLowerCase('de');
    if (!name) continue;
    // Räume heißen oft gleich („Eingang“); gleichnamige Orte an verschiedenen Stellen auch.
    if (entity.kind === 'place' && entity.place.room) continue;
    const where = entity.kind === 'place' ? (entity.place.parentId ?? '') : '';
    const key = `${entity.kind}:${where}:${name}`;
    const list = groups.get(key);
    if (list) list.push(entity);
    else groups.set(key, [entity]);
  }
  const out: Issue[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const ids = list.map((entity) => entity.id).sort();
    const first = list[0]!;
    out.push({
      key: `same-name:${ids.join(',')}`,
      text: `${list.length === 2 ? 'Zwei' : list.length} Einträge der Art „${KIND_LABEL[first.kind]}“ heißen genau „${first.name.trim()}“. Wenn es verschiedene sind, ist das in Ordnung.`,
      refs: ids,
      weight: 'hint',
    });
  }
  return out;
}

// ── Alles zusammen ─────────────────────────────────────────────────────────

const cache = new WeakMap<CampaignData, Issue[]>();

/** Alle Widersprüche, auch die weggeklickten – wichtige zuerst. */
export function allContinuityIssues(data: CampaignData): Issue[] {
  const hit = cache.get(data);
  if (hit) return hit;
  const sorted = chronicleSorted(data);
  const issues = [
    ...afterFate(data, sorted),
    ...lootIssues(data),
    ...lifeIssues(data, sorted),
    ...travelIssues(data, sorted),
    ...goneRefs(data, sorted),
    ...sameNames(data),
  ];
  // Stabil sortiert: erst was nicht stimmen kann, sonst in der Reihenfolge der Prüfungen.
  const result = issues
    .map((issue, index) => ({ issue, index }))
    .sort(
      (a, b) =>
        (a.issue.weight === 'warn' ? 0 : 1) - (b.issue.weight === 'warn' ? 0 : 1) ||
        a.index - b.index,
    )
    .map(({ issue }) => issue);
  cache.set(data, result);
  return result;
}

/** Was nicht zusammenpasst – ohne das, was der Spielleiter mit „Passt so“ weggeklickt hat. */
export function continuityIssues(data: CampaignData): Issue[] {
  const ok = new Set(data.state.continuityOk ?? []);
  return allContinuityIssues(data).filter((issue) => !ok.has(issue.key));
}

/** Die Widersprüche, die einen Eintrag der Welt betreffen – für seine Seite. */
export function issuesAbout(issues: Issue[], entityId: string): Issue[] {
  return issues.filter((issue) => issue.refs.includes(entityId));
}
