/**
 * Lebenslauf eines Gegenstands: was ihm geschah, zeitlich geordnet – Entstehung, jede Ausgabe im
 * Beute-Buch, jeder Wechsel des Besitzers, den der Spielleiter festgehalten hat, jeder Eintrag der
 * Chronik, der ihn nennt, und sein Ende. Dazu, wer ihn nacheinander hatte. Wayfarer liest das
 * nur aus dem, was ohnehin dasteht; nichts davon wird gespeichert. Geheimes bleibt drin und ist
 * als geheim markiert – die Spielleitung sieht alles. Reine Funktionen.
 */
import { KIND_LABEL } from './chronicleKinds';
import { entityName } from './derive';
import { formatDatePoint, lifeWords } from './lifespan';
import { lootLine } from './loot';
import type { CampaignData, ChronicleEntry, ChroniclePrecision, DatePoint, Loot } from './schema';
import {
  formatDate,
  formatDayMonth,
  fromTime,
  type CalendarDef,
  type WorldTime,
} from './time/calendar';

export type ItemEventSort = 'made' | 'given' | 'holder' | 'entry' | 'ended';

export interface ItemEvent {
  key: string;
  sort: ItemEventSort;
  at: WorldTime;
  /** Wie genau `at` bekannt ist: Lebensdaten oft nur aufs Jahr, Einträge wie festgehalten. */
  precision: DatePoint['precision'] | ChroniclePrecision;
  /** Was es ist: „Geschaffen“, „Beute“, „Neuer Besitzer“ oder die Art des Eintrags. */
  label: string;
  /** Was geschah, in den Worten des Spielleiters (bei Beute: die Zeile des Beute-Buchs). */
  text: string;
  /**
   * Wer: der Empfänger oder neue Besitzer; bei anderen Einträgen die übrigen Beteiligten. Leer bei
   * Beute für die Gruppe (`party`) oder bei unbekanntem Verbleib.
   */
  whoIds: string[];
  /** Die Beute ging an die ganze Gruppe. */
  party: boolean;
  placeId: string | null;
  sessionId: string | null;
  /** Woher die Beute stammt („aus der Truhe im Keller“). */
  source: string;
  /** Nur für die Spielleitung. */
  secret: boolean;
  entryId: string | null;
  lootId: string | null;
}

export interface Holding {
  /** Bei wem der Gegenstand war; null mit `party` = bei der ganzen Gruppe. */
  holderId: string | null;
  party: boolean;
  /** Seit wann; null = nicht bekannt. */
  from: WorldTime | null;
  /** Wie genau „seit“ bekannt ist (die Entstehung oft nur aufs Jahr). Vorgabe: genau. */
  fromPrecision?: ItemEvent['precision'];
  /** Bis wann; null = bis heute (`current`) oder nicht bekannt. */
  to: WorldTime | null;
  /** Wie genau „bis“ bekannt ist. Vorgabe: genau. */
  toPrecision?: ItemEvent['precision'];
  /** Hat ihn heute noch. */
  current: boolean;
  /** Der Wechsel zu ihm steht nur für die Spielleitung fest. */
  secret: boolean;
}

/** Reihenfolge bei gleicher Zeit: Entstehung zuerst, Ende zuletzt. */
const SORT_RANK: Record<ItemEventSort, number> = {
  made: 0,
  given: 1,
  holder: 1,
  entry: 1,
  ended: 2,
};

/** Die Zeilen der Chronik, die zu einer Ausgabe im Beute-Buch gehören – sie zählen als Ausgabe. */
function lootLines(data: Pick<CampaignData, 'loot'>): Set<string> {
  const ids = new Set<string>();
  for (const loot of Object.values(data.loot))
    if (loot.given && loot.chronicleId) ids.add(loot.chronicleId);
  return ids;
}

/** Die Ausgaben dieses Gegenstands im Beute-Buch. */
const givenLoot = (data: Pick<CampaignData, 'loot'>, itemId: string): Loot[] =>
  Object.values(data.loot).filter(
    (loot): loot is Loot & { at: number } =>
      loot.given && loot.itemId === itemId && loot.at !== null,
  );

/** Hält dieser Eintrag einen Wechsel des Besitzers dieses Gegenstands fest? */
const isHolderEntry = (entry: ChronicleEntry, itemId: string) =>
  entry.kind === 'change' && entry.holder?.itemId === itemId;

/**
 * Was dem Gegenstand geschah, das Älteste zuerst. Leer, wenn es ihn nicht gibt. Beute, die nur
 * bereitliegt, steht nicht darin (`readyFor`); zurückgenommene Ausgaben gelten als nicht
 * geschehen und fehlen ebenso.
 */
export function itemHistory(data: CampaignData, itemId: string): ItemEvent[] {
  const item = data.entities[itemId];
  if (item?.kind !== 'item') return [];
  const words = lifeWords('item');
  const events: (ItemEvent & { created: string })[] = [];
  const blank = {
    whoIds: [],
    party: false,
    placeId: null,
    sessionId: null,
    source: '',
    secret: false,
    entryId: null,
    lootId: null,
    created: '',
  };
  if (item.born)
    events.push({
      ...blank,
      key: 'made',
      sort: 'made',
      at: item.born.at,
      precision: item.born.precision,
      label: words.start,
      text: '',
    });

  for (const loot of givenLoot(data, itemId)) {
    const entry = loot.chronicleId ? data.chronicle[loot.chronicleId] : undefined;
    events.push({
      ...blank,
      key: `loot:${loot.id}`,
      sort: 'given',
      at: loot.at!,
      precision: entry?.precision ?? 'exact',
      label: 'Beute',
      text: lootLine(data, loot),
      // Ohne Empfänger ging sie an die Gruppe; ein inzwischen gelöschter Empfänger bleibt einer.
      whoIds: loot.toId ? [loot.toId] : [],
      party: !loot.toId,
      placeId: loot.placeId,
      sessionId: loot.sessionId,
      source: loot.source,
      secret: entry?.secret ?? false,
      entryId: entry?.id ?? null,
      lootId: loot.id,
      created: entry?.created ?? loot.created,
    });
  }

  const fromLoot = lootLines(data);
  for (const entry of Object.values(data.chronicle)) {
    if (fromLoot.has(entry.id)) continue;
    const holder = isHolderEntry(entry, itemId);
    if (!holder && !entry.refs.includes(itemId)) continue;
    events.push({
      ...blank,
      key: `entry:${entry.id}`,
      sort: holder ? 'holder' : 'entry',
      at: entry.at,
      precision: entry.precision,
      label: holder ? 'Neuer Besitzer' : KIND_LABEL[entry.kind],
      text: entry.text,
      whoIds: holder
        ? entry.holder!.holderId
          ? [entry.holder!.holderId]
          : []
        : entry.refs.filter((id) => id !== itemId),
      placeId: entry.placeId,
      sessionId: entry.sessionId,
      secret: entry.secret,
      entryId: entry.id,
      created: entry.created,
    });
  }

  if (item.ended)
    events.push({
      ...blank,
      key: 'ended',
      sort: 'ended',
      at: item.ended.at,
      precision: item.ended.precision,
      label: words.end,
      text: '',
    });

  events.sort(
    (a, b) =>
      a.at - b.at ||
      SORT_RANK[a.sort] - SORT_RANK[b.sort] ||
      a.created.localeCompare(b.created) ||
      a.key.localeCompare(b.key),
  );
  return events.map(({ created: _created, ...event }) => event);
}

/** Beute im Beute-Buch, die diesen Gegenstand enthält und noch bereitliegt. */
export function readyFor(data: Pick<CampaignData, 'loot'>, itemId: string): Loot[] {
  return Object.values(data.loot)
    .filter((loot) => !loot.given && loot.itemId === itemId)
    .sort((a, b) => a.created.localeCompare(b.created));
}

/**
 * Wer den Gegenstand nacheinander hatte, der Erste zuerst – mit von–bis, soweit bekannt. Gelesen
 * aus den Ausgaben im Beute-Buch und den festgehaltenen Wechseln (wer ihn davor hatte, wissen
 * beide); der heutige Besitzer steht immer zuletzt, auch wenn sein Wechsel nirgends steht.
 * Unbekannter Verbleib beendet einen Besitz, ist aber selbst keiner.
 */
export function holdersOf(data: CampaignData, itemId: string): Holding[] {
  const item = data.entities[itemId];
  if (item?.kind !== 'item') return [];
  const ended = item.ended && item.ended.at <= data.state.now ? item.ended : null;
  const changes = itemHistory(data, itemId).filter(
    (event) => event.sort === 'given' || event.sort === 'holder',
  );

  /** Wer ihn hatte: null = unbekannt. */
  type Who = { holderId: string | null; party: boolean } | null;
  const whoOf = (holderId: string | null, party: boolean): Who =>
    party ? { holderId: null, party: true } : holderId ? { holderId, party: false } : null;
  const same = (a: Who, b: Who) => !!a && !!b && a.party === b.party && a.holderId === b.holderId;

  type Precision = ItemEvent['precision'];
  const steps: { who: Who; at: WorldTime | null; precision: Precision; secret: boolean }[] = [];
  const first = changes[0];
  if (first) {
    // Wer ihn vor dem ersten bekannten Wechsel hatte – seit seiner Entstehung, wenn sie bekannt ist.
    const before = first.lootId
      ? (data.loot[first.lootId]?.holderBefore ?? null)
      : first.entryId
        ? (data.chronicle[first.entryId]?.holder?.before ?? null)
        : null;
    if (before)
      steps.push({
        who: whoOf(before, false),
        at: item.born?.at ?? null,
        precision: item.born?.precision ?? 'exact',
        secret: false,
      });
  }
  for (const change of changes)
    steps.push({
      who: whoOf(change.whoIds[0] ?? null, change.party),
      at: change.at,
      precision: change.precision,
      secret: change.secret,
    });
  // Was heute gilt, auch wenn der letzte Wechsel nirgends festgehalten ist. Nach einer Ausgabe an
  // die Gruppe hat der Gegenstand keinen bestimmten Besitzer – dann bleibt die Gruppe.
  const last = steps[steps.length - 1]?.who ?? null;
  const now = item.item.holderId ? whoOf(item.item.holderId, false) : last?.party ? last : null;
  if (!same(last, now) && (now || last))
    steps.push({ who: now, at: null, precision: 'exact', secret: false });

  const out: Holding[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const next = steps[i + 1];
    const previous = out[out.length - 1];
    if (!step.who) continue;
    // Derselbe Besitzer zweimal hintereinander ist ein Besitz.
    if (previous && same(previous, step.who) && (steps[i - 1]?.who ?? null) !== null) {
      previous.to = next ? next.at : null;
      previous.toPrecision = next?.precision ?? 'exact';
      continue;
    }
    out.push({
      holderId: step.who.holderId,
      party: step.who.party,
      from: step.at,
      fromPrecision: step.precision,
      to: next ? next.at : null,
      toPrecision: next?.precision ?? 'exact',
      current: false,
      secret: step.secret,
    });
  }
  const lastHolding = out[out.length - 1];
  const lastStep = steps[steps.length - 1];
  if (lastHolding && lastStep?.who && same(lastHolding, lastStep.who)) {
    if (ended) {
      lastHolding.to = ended.at;
      lastHolding.toPrecision = ended.precision;
    } else lastHolding.current = true;
  }
  return out;
}

/** Ein Tag kurz: im laufenden Jahr ohne Jahreszahl. */
function shortDay(cal: CalendarDef, now: WorldTime, at: WorldTime): string {
  return fromTime(cal, now).year === fromTime(cal, at).year
    ? formatDayMonth(cal, at)
    : formatDate(cal, at);
}

/**
 * Wann es geschah, so genau, wie es bekannt ist: „3. Tauwind“, „Tauwind 667 AD“, „667 AD“,
 * „etwa 3. Tauwind“.
 */
export function itemEventWhen(cal: CalendarDef, now: WorldTime, event: ItemEvent): string {
  return pointText(cal, now, event.at, event.precision);
}

/** Ein Zeitpunkt so genau, wie er bekannt ist – nie genauer. */
function pointText(
  cal: CalendarDef,
  now: WorldTime,
  at: WorldTime,
  precision: ItemEvent['precision'] = 'exact',
): string {
  switch (precision) {
    case 'year':
    case 'month':
      return formatDatePoint(cal, { at, precision });
    case 'approx':
      return `etwa ${shortDay(cal, now, at)}`;
    default:
      return shortDay(cal, now, at);
  }
}

/** Wer: „Mira Tannhaus“, „die Gruppe“ oder „unbekannt“. */
export function holdingName(data: CampaignData, holding: Holding): string {
  if (holding.party) return 'die Gruppe';
  return holding.holderId ? entityName(data, holding.holderId) : 'unbekannt';
}

/** Von wann bis wann: „seit 3. Tauwind“, „bis 9. Tauwind“, „3. – 9. Tauwind“, „bis heute“. */
export function holdingSpan(cal: CalendarDef, now: WorldTime, holding: Holding): string {
  const from =
    holding.from === null ? null : pointText(cal, now, holding.from, holding.fromPrecision);
  const to = holding.to === null ? null : pointText(cal, now, holding.to, holding.toPrecision);
  if (from && to) return from === to ? from : `${from} bis ${to}`;
  if (from) return holding.current ? `seit ${from}` : `ab ${from}`;
  if (to) return `bis ${to}`;
  return holding.current ? 'bis heute' : 'Zeit unbekannt';
}

/**
 * Das Wort vor den Beteiligten: „an“ (Beute), „bei“ oder „in“ (neuer Besitzer, ein Ort), „mit“
 * (andere Einträge), „an die Gruppe“ oder „Verbleib unbekannt“. Leer, wenn niemand dabei ist.
 */
export function itemEventWho(data: Pick<CampaignData, 'entities'>, event: ItemEvent): string {
  if (event.sort === 'given')
    return event.party ? 'an die Gruppe' : event.whoIds.length ? 'an' : '';
  if (event.sort === 'holder')
    return event.whoIds[0] ? holderWord(data, event.whoIds[0]) : 'Verbleib unbekannt';
  return event.whoIds.length ? 'mit' : '';
}

/** „in“ vor einem Ort, sonst „bei“: „in Hohenfurt“, „bei Mira“. */
export const holderWord = (data: Pick<CampaignData, 'entities'>, holderId: string): string =>
  data.entities[holderId]?.kind === 'place' ? 'in' : 'bei';
