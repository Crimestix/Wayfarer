/**
 * Abgleich: zwei Fassungen desselben Dokuments zusammenführen, wo sie sich nicht
 * widersprechen (Entwurf, Abschnitt 3.5). Reine Funktionen auf geparstem JSON.
 *
 * - Objekte Schlüssel für Schlüssel; Listen aus Objekten mit eindeutiger `id` je `id`; alles
 *   andere als Ganzes. Text wird nie in sich zusammengeführt.
 * - Gleichheit immer ohne `rev` und `updated` der obersten Ebene.
 * - Geschrieben wird der zusammengeführte Wert selbst; das Schema prüft nur. So bleiben Felder,
 *   die dieses Programm nicht kennt.
 * - Für `state.json` und `campaign.json` gelten eigene Regeln (`STATE_RULES`, `CAMPAIGN_RULES`).
 */
import {
  COLLECTION_NAMES,
  COLLECTION_SCHEMAS,
  CampaignMetaSchema,
  PlayStateSchema,
  type CollectionName,
} from './schema';
import { isSyncedPath } from './sync';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export interface MergeRules {
  /** Listen als Menge: Hinzugefügtes kommt dazu, Entferntes geht. Nie eine Rückfrage. */
  sets?: string[];
  /**
   * Wie gewohnt zusammenführen; bleibt darin ein Widerspruch, gilt die Fassung mit dem jüngeren
   * `updated` des ganzen Dokuments (nur für Auslage, nie für Spielstand). Nie eine Rückfrage.
   */
  newerWins?: string[];
  /** Nur als Ganzes vergleichen (kein Hineinsteigen). */
  whole?: string[];
  /** Felder, die nur zusammen gelten (state.json: `now` + `previousNow` = Weltzeit). */
  groups?: MergeGroup[];
}

export interface MergeGroup {
  name: string;
  fields: string[];
  /**
   * Gilt `when` für eine der drei Fassungen, gehört diese Gruppe zur Gruppe `group` – beide
   * werden dann zusammen gewählt (getrennte Wege: `now` ist die Zeit der geleiteten Teilgruppe).
   */
  joins?: { group: string; when: (side: JsonObject) => boolean };
}

export const STATE_RULES: MergeRules = {
  groups: [
    { name: 'time', fields: ['now', 'previousNow'] },
    // Getrennte Wege: Ort, Teilgruppen und geleitete Teilgruppe gelten nur zusammen – und, ist
    // die Gruppe getrennt, auch nur mit der Weltzeit: `now` und `placeId` sind dann die der
    // geleiteten Teilgruppe, die Zeit der einen gehört nie zur anderen.
    {
      name: 'party',
      fields: ['placeId', 'groups', 'leadId'],
      joins: {
        group: 'time',
        when: (side) => Array.isArray(side.groups) && side.groups.length > 0,
      },
    },
  ],
  sets: ['watch', 'continuityOk', 'twinsApart', 'inView', 'dismissed'],
  newerWins: ['board', 'boardAreas', 'boardLinks', 'boardHidden', 'boardNow', 'boardPlayed', 'boardNotes', 'boardStarts', 'netBoard', 'timelineLanes', 'nameMemory', 'recapDismissed'],
  whole: ['march'],
};

export const CAMPAIGN_RULES: MergeRules = {
  whole: ['calendar', 'customConditions'],
};

export interface FieldClash {
  /** Wo: Feldnamen, bei Listen mit `id` die Kennung des Elements. */
  at: string[];
  /** Gehört der Widerspruch zu einer Gruppe (Weltzeit), steht hier ihr Name. */
  group?: string;
  local: Json | undefined;
  remote: Json | undefined;
}

/** Eine Entscheidung: Widersprüche an genau diesen Angaben gehen zur gewählten Seite. */
export interface Choose {
  side: 'local' | 'remote';
  at: string[][];
}

const STAMPS = new Set(['rev', 'updated']);

const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Strukturgleich (Reihenfolge der Schlüssel egal). */
export function jsonEqual(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => jsonEqual(item, b[i]));
  }
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => key in b && jsonEqual(a[key], b[key]));
  }
  return false;
}

const withoutStamps = (value: Json | undefined): Json | undefined => {
  if (!isObject(value)) return value;
  const rest: JsonObject = {};
  for (const [key, v] of Object.entries(value)) if (!STAMPS.has(key)) rest[key] = v;
  return rest;
};

/** Gleich bis auf `rev` und `updated` der obersten Ebene. */
export function sameIgnoringStamps(a: Json, b: Json): boolean {
  return jsonEqual(withoutStamps(a), withoutStamps(b));
}

/** Eine Liste aus Objekten mit eindeutiger Zeichenkette `id`? */
function idList(value: Json | undefined): Map<string, Json> | null {
  if (!Array.isArray(value)) return null;
  const map = new Map<string, Json>();
  for (const item of value) {
    if (!isObject(item) || typeof item.id !== 'string' || map.has(item.id)) return null;
    map.set(item.id, item);
  }
  return map;
}

const samePath = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((part, i) => part === b[i]);
/** Gilt eine Entscheidung für diese Stelle (genau sie oder etwas darüber)? */
const covers = (choose: Choose | undefined, at: readonly string[]) =>
  !!choose && choose.at.some((p) => p.length <= at.length && samePath(p, at.slice(0, p.length)));

interface Ctx {
  clashes: FieldClash[];
  choose?: Choose;
  /** Löst Widersprüche ohne Rückfrage (Regel `newerWins`): welche Seite gilt. */
  newer: 'local' | 'remote' | null;
}

/** Ein Widerspruch: gewählt, nach Regel gelöst oder als Rückfrage vermerkt (dann gilt vorerst „hier“). */
function clash(
  ctx: Ctx,
  at: string[],
  local: Json | undefined,
  remote: Json | undefined,
): Json | undefined {
  if (ctx.newer) return ctx.newer === 'local' ? local : remote;
  if (covers(ctx.choose, at)) return ctx.choose!.side === 'local' ? local : remote;
  ctx.clashes.push({ at, local, remote });
  return local;
}

function mergeValue(
  ctx: Ctx,
  at: string[],
  base: Json | undefined,
  local: Json | undefined,
  remote: Json | undefined,
): Json | undefined {
  if (jsonEqual(local, remote)) return local;
  if (jsonEqual(local, base)) return remote;
  if (jsonEqual(remote, base)) return local;
  if (isObject(local) && isObject(remote) && (base === undefined || isObject(base)))
    return mergeObject(ctx, at, base, local, remote);
  const lists = [idList(local), idList(remote), base === undefined ? new Map() : idList(base)];
  if (lists.every((l) => l !== null))
    return mergeIdList(ctx, at, lists[2]!, lists[0]!, lists[1]!, local as Json[], remote as Json[]);
  return clash(ctx, at, local, remote);
}

function mergeObject(
  ctx: Ctx,
  at: string[],
  base: JsonObject | undefined,
  local: JsonObject,
  remote: JsonObject,
): JsonObject {
  const out: JsonObject = {};
  const keys = [...new Set([...Object.keys(local), ...Object.keys(remote)])];
  for (const key of keys) {
    const merged = mergeValue(ctx, [...at, key], base?.[key], local[key], remote[key]);
    if (merged !== undefined) out[key] = merged;
  }
  return out;
}

const idsOf = (list: Json[]) => list.map((item) => (item as JsonObject).id as string);

function mergeIdList(
  ctx: Ctx,
  at: string[],
  base: Map<string, Json>,
  local: Map<string, Json>,
  remote: Map<string, Json>,
  localList: Json[],
  remoteList: Json[],
): Json[] | Json | undefined {
  const result = new Map<string, Json>();
  const all = [...new Set([...base.keys(), ...local.keys(), ...remote.keys()])];
  for (const id of all) {
    const b = base.get(id);
    const l = local.get(id);
    const r = remote.get(id);
    const where = [...at, id];
    if (l === undefined && r === undefined) continue;
    if (b !== undefined && l === undefined) {
      // Hier entfernt: geht, wenn dort unverändert; sonst Widerspruch.
      if (jsonEqual(r, b)) continue;
      const kept = clash(ctx, where, undefined, r);
      if (kept !== undefined) result.set(id, kept);
      continue;
    }
    if (b !== undefined && r === undefined) {
      if (jsonEqual(l, b)) continue;
      const kept = clash(ctx, where, l, undefined);
      if (kept !== undefined) result.set(id, kept);
      continue;
    }
    const merged = mergeValue(ctx, where, b, l, r);
    if (merged !== undefined) result.set(id, merged);
  }
  // Reihenfolge: die der Seite, die sie geändert hat; beide verschieden → Widerspruch.
  const common = (ids: string[]) =>
    ids.filter((id) => base.has(id) && local.has(id) && remote.has(id));
  const baseSeq = common([...base.keys()]);
  const localSeq = common(idsOf(localList));
  const remoteSeq = common(idsOf(remoteList));
  let lead: 'local' | 'remote';
  if (samePath(localSeq, baseSeq)) lead = 'remote';
  else if (samePath(remoteSeq, baseSeq) || samePath(localSeq, remoteSeq)) lead = 'local';
  else {
    const chosen = clash(ctx, at, localList, remoteList);
    // Die gewählte Reihenfolge gilt; was die Liste dabei an Inhalt zusammengeführt hat, bleibt.
    lead = chosen === remoteList ? 'remote' : 'local';
  }
  const first = lead === 'local' ? idsOf(localList) : idsOf(remoteList);
  const second = lead === 'local' ? idsOf(remoteList) : idsOf(localList);
  const order = [...first, ...second.filter((id) => !first.includes(id))];
  return order.filter((id) => result.has(id)).map((id) => result.get(id)!);
}

/** Liste als Menge: Hinzugefügtes kommt dazu, Entferntes geht. */
function mergeSet(base: Json | undefined, local: Json | undefined, remote: Json | undefined): Json {
  const items = (v: Json | undefined) => (Array.isArray(v) ? v : []);
  const key = (v: Json) => JSON.stringify(v);
  const b = new Set(items(base).map(key));
  const l = new Set(items(local).map(key));
  const r = new Set(items(remote).map(key));
  const removed = new Set([...b].filter((k) => !l.has(k) || !r.has(k)));
  const out: Json[] = [];
  const seen = new Set<string>();
  for (const item of [...items(local), ...items(remote)]) {
    const k = key(item);
    if (removed.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

const stampOf = (value: Json, field: string): string | number | null => {
  const v = isObject(value) ? value[field] : undefined;
  return typeof v === 'string' || typeof v === 'number' ? v : null;
};

/** Die Gruppen dieser Zusammenführung: eine Gruppe mit `joins` geht, wenn es gilt, in ihrer auf. */
function joinedGroups(
  groups: readonly MergeGroup[],
  sides: readonly (JsonObject | undefined)[],
): { name: string; fields: string[] }[] {
  const out = groups.map((g) => ({ name: g.name, fields: [...g.fields] }));
  for (const g of groups) {
    if (!g.joins || !sides.some((side) => side && g.joins!.when(side))) continue;
    const target = out.find((o) => o.name === g.joins!.group);
    const self = out.findIndex((o) => o.name === g.name);
    if (!target || self < 0) continue;
    target.fields.push(...out[self]!.fields);
    out.splice(self, 1);
  }
  return out;
}

/**
 * Führt drei Fassungen zusammen. Ergebnis: der Wert (`rev = max + 1`, `updated = now`) und die
 * Widersprüche, die übrig bleiben. Bei einem Widerspruch steht im Wert vorerst die Fassung von hier.
 */
export function mergeJson(
  base: Json | undefined,
  local: Json,
  remote: Json,
  rules: MergeRules = {},
  choose?: Choose,
  now: string = new Date().toISOString(),
): { value: Json; clashes: FieldClash[] } {
  const ctx: Ctx = { clashes: [], choose, newer: null };
  if (!isObject(local) || !isObject(remote) || (base !== undefined && !isObject(base))) {
    const value = mergeValue(ctx, [], base, local, remote) ?? local;
    return { value, clashes: ctx.clashes };
  }
  const b = withoutStamps(base) as JsonObject | undefined;
  const l = withoutStamps(local) as JsonObject;
  const r = withoutStamps(remote) as JsonObject;
  const newerSide: 'local' | 'remote' =
    String(stampOf(local, 'updated') ?? '') > String(stampOf(remote, 'updated') ?? '')
      ? 'local'
      : 'remote';
  const groups = joinedGroups(rules.groups ?? [], [b, l, r]);
  const special = new Set([
    ...(rules.sets ?? []),
    ...(rules.newerWins ?? []),
    ...(rules.whole ?? []),
    ...groups.flatMap((g) => g.fields),
  ]);
  const out: JsonObject = {};
  const keys = [...new Set([...Object.keys(l), ...Object.keys(r)])];
  for (const key of keys) {
    if (special.has(key)) continue;
    const merged = mergeValue(ctx, [key], b?.[key], l[key], r[key]);
    if (merged !== undefined) out[key] = merged;
  }
  for (const key of rules.sets ?? [])
    if (key in l || key in r) out[key] = mergeSet(b?.[key], l[key], r[key]);
  for (const key of rules.newerWins ?? []) {
    if (!(key in l || key in r)) continue;
    const merged = mergeValue({ ...ctx, newer: newerSide }, [key], b?.[key], l[key], r[key]);
    if (merged !== undefined) out[key] = merged;
  }
  for (const key of rules.whole ?? []) {
    if (!(key in l || key in r)) continue;
    let merged: Json | undefined;
    if (jsonEqual(l[key], r[key]) || jsonEqual(r[key], b?.[key])) merged = l[key];
    else if (jsonEqual(l[key], b?.[key])) merged = r[key];
    else merged = clash(ctx, [key], l[key], r[key]);
    if (merged !== undefined) out[key] = merged;
  }
  for (const group of groups) {
    const pick = (o: JsonObject | undefined) => {
      if (!o) return undefined;
      const part: JsonObject = {};
      for (const f of group.fields) if (f in o) part[f] = o[f]!;
      return part;
    };
    const gb = pick(b);
    const gl = pick(l)!;
    const gr = pick(r)!;
    let chosen: JsonObject;
    if (jsonEqual(gl, gr) || jsonEqual(gr, gb)) chosen = gl;
    else if (jsonEqual(gl, gb)) chosen = gr;
    else {
      const at = [group.fields[0]!];
      if (covers(ctx.choose, at) || group.fields.some((f) => covers(ctx.choose, [f])))
        chosen = ctx.choose!.side === 'local' ? gl : gr;
      else {
        ctx.clashes.push({ at, group: group.name, local: gl, remote: gr });
        chosen = gl;
      }
    }
    Object.assign(out, chosen);
  }
  const revs = [stampOf(local, 'rev'), stampOf(remote, 'rev')].filter(
    (v): v is number => typeof v === 'number',
  );
  if ('rev' in local || 'rev' in remote) out.rev = (revs.length ? Math.max(...revs) : 0) + 1;
  if ('updated' in local || 'updated' in remote) out.updated = now;
  // Die Reihenfolge der Schlüssel wie hier, damit Dateien ruhig aussehen.
  const ordered: JsonObject = {};
  for (const key of [...Object.keys(local), ...Object.keys(out)])
    if (key in out && !(key in ordered)) ordered[key] = out[key]!;
  return { value: ordered, clashes: ctx.clashes };
}

// ── Ganze Dateien ────────────────────────────────────────────────────────────

export type FileMerge =
  /** Zusammengeführt: dieser Text wird geschrieben (und danach hochgeladen). */
  | { kind: 'merged'; content: string }
  /** Eine Seite enthält schon alles. */
  | { kind: 'take'; side: 'local' | 'remote' }
  /** Widersprüche an einzelnen Angaben. */
  | { kind: 'clash'; fields: FieldClash[] }
  /** Nur als Ganzes zu entscheiden. */
  | { kind: 'whole'; why: 'noBase' | 'unknown' | 'invalid' };

const serialize = (value: Json) => JSON.stringify(value, null, 1) + '\n';

function parse(text: string): Json | undefined {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return undefined;
  }
}

type Kind = { rules: MergeRules; check: (value: unknown) => boolean } | null;

/** Regeln und Prüfung je Pfad; null = unbekannte Sammlung. */
function kindOf(path: string): Kind {
  if (path === 'state.json')
    return { rules: STATE_RULES, check: (v) => PlayStateSchema.safeParse(v).success };
  if (path === 'campaign.json')
    return { rules: CAMPAIGN_RULES, check: (v) => CampaignMetaSchema.safeParse(v).success };
  const match = /^([a-z]+)\/([^/]+)\.json$/.exec(path);
  if (!match || !COLLECTION_NAMES.includes(match[1] as CollectionName)) return null;
  const schema = COLLECTION_SCHEMAS[match[1] as CollectionName];
  const id = match[2]!;
  return {
    rules: {},
    check: (v) => {
      const parsed = schema.safeParse(v);
      return parsed.success && (parsed.data as { id: string }).id === id;
    },
  };
}

/**
 * Führt eine Datei zusammen: gemeinsamer Stand (`base`, null = keiner), hier, dort. `choose`
 * kommt aus einer Entscheidung des Spielleiters.
 */
export function mergeFile(
  path: string,
  base: string | null,
  local: string,
  remote: string,
  choose?: Choose,
  now?: string,
): FileMerge {
  const l = parse(local);
  const r = parse(remote);
  if (l === undefined || r === undefined) return { kind: 'whole', why: 'invalid' };
  if (sameIgnoringStamps(l, r)) {
    const lr = stampOf(l, 'rev') ?? 0;
    const rr = stampOf(r, 'rev') ?? 0;
    return { kind: 'take', side: lr > rr ? 'local' : 'remote' };
  }
  if (base === null) return { kind: 'whole', why: 'noBase' };
  const kind = kindOf(path);
  if (!kind) return { kind: 'whole', why: 'unknown' };
  const b = parse(base);
  if (b === undefined) return { kind: 'whole', why: 'invalid' };
  const { value, clashes } = mergeJson(b, l, r, kind.rules, choose, now);
  if (clashes.length) return { kind: 'clash', fields: clashes };
  if (sameIgnoringStamps(value, r)) return { kind: 'take', side: 'remote' };
  if (sameIgnoringStamps(value, l)) return { kind: 'take', side: 'local' };
  if (!kind.check(value)) return { kind: 'whole', why: 'invalid' };
  return { kind: 'merged', content: serialize(value) };
}

/**
 * Prüft eine Datei vom anderen Rechner, bevor sie hier landet: lesbares JSON, und bei bekannten
 * Sammlungen das Schema und die Kennung passend zum Dateinamen. Unbekannte Sammlungen reisen
 * wörtlich mit.
 */
export function checkIncoming(
  path: string,
  content: string,
): { ok: true } | { ok: false; why: string } {
  if (!isSyncedPath(path)) return { ok: false, why: 'Der Pfad gehört nicht zum Spielstand.' };
  const value = parse(content);
  if (value === undefined) return { ok: false, why: 'Kein lesbares JSON.' };
  const kind = kindOf(path);
  if (!kind) return { ok: true };
  if (!kind.check(value))
    return { ok: false, why: 'Passt nicht zur Gestalt der Daten oder Kennung ≠ Dateiname.' };
  return { ok: true };
}

/**
 * Ergänzt Schlüssel, die in `base` stehen und in `local` fehlen – in Objekten und in
 * Listenelementen gleicher `id`. Fehlende Listenelemente kommen nie zurück; Vorhandenes wird
 * nie überschrieben. (Nach dem Aktualisieren eines älteren Programms, Entwurf 2.6.)
 */
export function fillStripped(base: Json, local: Json): Json {
  if (isObject(base) && isObject(local)) {
    const out: JsonObject = { ...local };
    for (const [key, value] of Object.entries(base)) {
      if (!(key in local)) out[key] = value;
      else out[key] = fillStripped(value, local[key]!);
    }
    return out;
  }
  const b = idList(base);
  if (b && Array.isArray(local)) {
    return local.map((item) => {
      const id = isObject(item) && typeof item.id === 'string' ? item.id : null;
      const from = id !== null ? b.get(id) : undefined;
      return from !== undefined ? fillStripped(from, item) : item;
    });
  }
  return local;
}

/** Ergänzt eine ganze Datei; null = nichts zu ergänzen (oder nicht lesbar). */
export function fillStrippedFile(base: string, local: string): string | null {
  const b = parse(base);
  const l = parse(local);
  if (b === undefined || l === undefined) return null;
  const filled = fillStripped(b, l);
  return jsonEqual(filled, l) ? null : serialize(filled);
}
