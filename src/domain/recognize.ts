/**
 * Erkennen ohne Netz: Aus einem geschriebenen Satz schlägt Wayfarer vor, welche Art Eintrag es
 * sein dürfte und welche Dinge der Welt darin vorkommen – „Schicksal: Krummzahn → tot“. Feste
 * Regeln, keine Sprachmodelle. Der Text bleibt, wie er geschrieben wurde; Wayfarer erfindet nichts
 * dazu. Ein Name zählt nur, wenn er eindeutig zu einem Eintrag führt – sonst bleibt das Ding offen
 * (null), und der Spielleiter wählt selbst.
 */
import {
  FATE_LABEL,
  FIGHT_OUTCOME_LABEL,
  type RecordInput,
  type RecordKind,
} from './chronicleKinds';
import { activeParty, entityName } from './derive';
import {
  PARTY_ID,
  type CampaignData,
  type EntityKind,
  type FightOutcome,
  type PersonStatus,
} from './schema';

// ── Ergebnis ───────────────────────────────────────────────────────────────

/**
 * Die Angaben eines Vorschlags – wie in `RecordInput`, aber ein Ding, das nicht eindeutig im
 * Text steht, ist null.
 */
export interface RecognizedPayload {
  travel?: { toId: string | null };
  attitude?: { fromId: string | null; toId: string | null; value: null };
  fight?: { outcome: FightOutcome };
  rest?: { long: boolean };
  fate?: { entityId: string | null; status: PersonStatus };
  whereabouts?: { entityId: string | null; placeId: string | null };
  rumor?: { sourceId: string | null };
  condition?: { entityId: string | null; ended: boolean };
  milestone?: { characterId: string | null; level: number | null };
  wish?: { characterId: string | null };
  clue?: { threadId: null };
  /** Bei einer Entdeckung: der entdeckte Ort. */
  placeId?: string | null;
}

export interface Recognized {
  kind: RecordKind;
  /** Für den Knopf: „Schicksal: Krummzahn → tot“. */
  label: string;
  payload: RecognizedPayload;
  /** Dinge, die der Eintrag nennen soll (Beteiligte, Gegner, wer etwas erfährt …). */
  refs: string[];
  /** Die Stelle im Text, an der es erkannt wurde. */
  from: number;
  to: number;
}

export interface RecognizeOptions {
  /**
   * Schon gewählte Einträge (etwa über „@“): Steht ihr Name im Text, gilt er für sie, auch wenn
   * der Name sonst mehrdeutig wäre.
   */
  refs?: readonly string[];
}

// ── Namen finden ───────────────────────────────────────────────────────────

const LETTER = /[\p{L}\p{N}]/u;
const WORD = /[\p{L}\p{N}]+/gu;
const LEADING_ARTICLE = /^(?:der|die|das)\s+/i;

/** Wörter, die als Name zu leicht ein gewöhnliches Wort träfen. */
const COMMON = new Set(
  [
    'ort',
    'tag',
    'weg',
    'tor',
    'rat',
    'see',
    'tod',
    'rast',
    'kampf',
    'gruppe',
    'stufe',
    'hinweis',
    'gerücht',
    'nacht',
    'morgen',
    'abend',
    'heute',
    'gestern',
  ].map((word) => word.toLocaleLowerCase('de')),
);
const PARTICLES = new Set(['von', 'van', 'zu', 'zum', 'zur', 'de', 'der', 'die', 'das', 'den']);
/**
 * Titel und Anreden sind kein Vor- oder Nachname: „Hauptmann Krell“ heißt nicht „Hauptmann“ –
 * sonst wäre jeder Hauptmann im Text Krell.
 */
const TITLES = new Set(
  [
    'herr',
    'frau',
    'fräulein',
    'graf',
    'gräfin',
    'fürst',
    'fürstin',
    'herzog',
    'herzogin',
    'baron',
    'baronin',
    'könig',
    'königin',
    'prinz',
    'prinzessin',
    'ritter',
    'sir',
    'lady',
    'lord',
    'dame',
    'meister',
    'meisterin',
    'hauptmann',
    'kapitän',
    'kapitänin',
    'bruder',
    'schwester',
    'vater',
    'mutter',
    'onkel',
    'tante',
    'priester',
    'priesterin',
    'hohepriester',
    'hohepriesterin',
    'magister',
    'doktor',
    'alte',
    'alter',
    'junge',
    'kleine',
    'große',
  ].map((word) => word.toLocaleLowerCase('de')),
);

interface NameEntry {
  /** Eigene Namen, Zweitnamen, Name ohne „Der/Die/Das“. */
  full: string[];
  /** Vor- oder Nachname einer Person oder eines Gefährten. */
  short: string[];
}

interface NameIndex {
  keys: Map<string, NameEntry>;
  /** Je erstem Wort die Namen, die damit beginnen – längste zuerst. */
  byFirst: Map<string, string[]>;
}

const indexCache = new WeakMap<CampaignData['entities'], NameIndex>();

const usable = (name: string) => {
  if (name.length < 3) return false;
  const first = name[0]!;
  if (first.toLocaleUpperCase('de') !== first || first.toLocaleLowerCase('de') === first)
    return false;
  return !COMMON.has(name.toLocaleLowerCase('de'));
};

function nameIndex(data: CampaignData): NameIndex {
  const cached = indexCache.get(data.entities);
  if (cached) return cached;
  const keys = new Map<string, NameEntry>();
  const add = (name: string, id: string, tier: keyof NameEntry) => {
    const clean = name.replace(/\s+/g, ' ').trim();
    if (!usable(clean)) return;
    let entry = keys.get(clean);
    if (!entry) keys.set(clean, (entry = { full: [], short: [] }));
    if (!entry[tier].includes(id)) entry[tier].push(id);
  };
  const sorted = Object.values(data.entities).sort((a, b) => a.id.localeCompare(b.id));
  for (const entity of sorted) {
    for (const name of [entity.name, ...entity.aliases]) {
      add(name, entity.id, 'full');
      if (LEADING_ARTICLE.test(name)) add(name.replace(LEADING_ARTICLE, ''), entity.id, 'full');
    }
    if (entity.kind !== 'person' && entity.kind !== 'character') continue;
    const words = entity.name
      .replace(LEADING_ARTICLE, '')
      .split(/\s+/)
      .filter((word) => {
        const lower = word.toLocaleLowerCase('de');
        return !PARTICLES.has(lower) && !TITLES.has(lower);
      });
    // Ein Name aus einem Wort ist schon ganz eingetragen; „Hauptmann Krell“ gibt „Krell“.
    if (!words.length || (words.length === 1 && words[0] === entity.name)) continue;
    add(words[0]!, entity.id, 'short');
    add(words[words.length - 1]!, entity.id, 'short');
  }
  const byFirst = new Map<string, string[]>();
  for (const key of keys.keys()) {
    WORD.lastIndex = 0;
    const first = WORD.exec(key)?.[0];
    if (!first) continue;
    const list = byFirst.get(first);
    if (list) list.push(key);
    else byFirst.set(first, [key]);
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.length - a.length);
  const index = { keys, byFirst };
  indexCache.set(data.entities, index);
  return index;
}

interface NameHit {
  from: number;
  to: number;
  /** Der Eintrag, den der Name eindeutig meint; null = mehrdeutig. */
  id: string | null;
  /** „Miras Bruder“: Der Name besitzt etwas – er handelt nicht und ihm geschieht nichts. */
  genitive: boolean;
}

/** Wo ein Name endet, wenn er an dieser Stelle als ganzes Wort steht (auch „Miras“); sonst -1. */
function endOf(text: string, at: number, name: string): number {
  if (!text.startsWith(name, at)) return -1;
  const end = at + name.length;
  const next = text[end];
  if (next === undefined || !LETTER.test(next)) return end;
  if (next === 's' && !/[sßxz]$/i.test(name)) {
    const after = text[end + 1];
    if (after === undefined || !LETTER.test(after)) return end + 1;
  }
  return -1;
}

function resolve(entry: NameEntry, refs: readonly string[]): string | null {
  for (const tier of [entry.full, entry.short]) {
    if (!tier.length) continue;
    if (tier.length === 1) return tier[0]!;
    const chosen = tier.filter((id) => refs.includes(id));
    return chosen.length === 1 ? chosen[0]! : null;
  }
  return null;
}

/** Alle Namen im Text, von links nach rechts, ohne Überschneidung. */
function findNames(data: CampaignData, text: string, refs: readonly string[]): NameHit[] {
  const { keys, byFirst } = nameIndex(data);
  const hits: NameHit[] = [];
  const words = new RegExp(WORD.source, 'gu');
  let match: RegExpExecArray | null;
  while ((match = words.exec(text))) {
    const word = match[0];
    const candidates =
      byFirst.get(word) ?? (word.endsWith('s') ? byFirst.get(word.slice(0, -1)) : undefined);
    if (!candidates) continue;
    for (const name of candidates) {
      const end = endOf(text, match.index, name);
      if (end < 0) continue;
      hits.push({
        from: match.index,
        to: end,
        id: resolve(keys.get(name)!, refs),
        genitive: end > match.index + name.length,
      });
      words.lastIndex = Math.max(words.lastIndex, end);
      break;
    }
  }
  return hits;
}

// ── Sätze und Wörter ───────────────────────────────────────────────────────

interface Sentence {
  from: number;
  text: string;
  /** „Ist Krummzahn tot?“ – eine Frage hält nichts fest. */
  question: boolean;
}

const END = /[.!?;]/;

/**
 * Teilt in Sätze. Was in Anführungszeichen steht, bleibt beim Satz – auch mit „!“ oder „?“
 * darin („„Lauft!“, rief Mira.“ ist ein Satz).
 */
function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  let depth = 0;
  const push = (end: number) => {
    const part = text.slice(start, end);
    if (part.trim()) {
      const last = part.replace(/[\s„“”"»«‚‘’‹›]+$/u, '');
      out.push({ from: start, text: part, question: /\?[.!?]*$/.test(last) });
    }
    start = end;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '\n') {
      push(i + 1);
      depth = 0;
    } else if (char === '„' || char === '»') depth++;
    else if (char === '“') depth = depth > 0 ? depth - 1 : depth + 1;
    else if (char === '”' || char === '«') depth = Math.max(0, depth - 1);
    else if (char === '"') depth = depth > 0 ? depth - 1 : depth + 1;
    else if (depth === 0 && END.test(char)) {
      // „am 8. Saatmond“: der Punkt nach einer Zahl beendet keinen Satz.
      if (char === '.' && /\d/.test(text[i - 1] ?? '') && /^ \p{L}/u.test(text.slice(i + 1, i + 3)))
        continue;
      let end = i + 1;
      while (end < text.length && END.test(text[end]!)) end++;
      push(end);
      i = end - 1;
    }
  }
  push(text.length);
  return out;
}

/** Ein Muster für ganze Wörter (auch mit Umlauten), ohne Rücksicht auf Groß- und Kleinschreibung. */
const words = (source: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${source})(?![\\p{L}\\p{N}])`, 'iu');

interface Cue {
  from: number;
  to: number;
  word: string;
}

function cues(text: string, pattern: RegExp): Cue[] {
  const out: Cue[] = [];
  const all = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
  let match: RegExpExecArray | null;
  while ((match = all.exec(text))) {
    out.push({ from: match.index, to: match.index + match[0].length, word: match[0] });
    if (match[0] === '') all.lastIndex++;
  }
  return out;
}

/** Steht kurz vor der Stelle ein „nicht“, „kein“, „fast“ …? Dann gilt das Wort nicht. */
function negated(text: string, at: number): boolean {
  const before = text.slice(Math.max(0, at - 24), at);
  return words('nicht|nie|niemals|kein|keine|keiner|fast|beinahe|halb|nahezu').test(
    before.split(/\s+/).slice(-3).join(' '),
  );
}

/** Wo der Teilsatz um eine Stelle beginnt und endet (Komma, Doppelpunkt, Gedankenstrich …). */
const CLAUSE_MARK = /[,;:–—()]/;

function clauseAround(text: string, from: number, to = from): [number, number] {
  let start = from;
  while (start > 0 && !CLAUSE_MARK.test(text[start - 1]!)) start--;
  let end = to;
  while (end < text.length && !CLAUSE_MARK.test(text[end]!)) end++;
  return [start, end];
}

/** „Krummzahn starb nicht.“ – ein „nicht“ gleich danach, im selben Teilsatz. */
function negatedAfter(text: string, to: number): boolean {
  const [, end] = clauseAround(text, to);
  const after = text.slice(to, end).trim().split(/\s+/).slice(0, 2).join(' ');
  return words('nicht|nie|niemals|nichts|kein|keine|keinen|keiner|keinem').test(after);
}

/** Verneint – davor oder gleich danach. */
const denied = (text: string, cue: Cue) => negated(text, cue.from) || negatedAfter(text, cue.to);

/**
 * Nur gedacht, gewollt oder vermutet: „Wenn Krummzahn tot ist …“, „Brann möchte Krummzahn tot
 * sehen“, „ob Lando tot ist“. Das hält noch nichts fest.
 */
const HYPOTHETICAL = words(
  'wenn|falls|sobald|ob|will|willst|wollen|wollte|wollten|möchte|möchten|soll|sollen|sollte|sollten|könnte|könnten|würde|würden|wäre|wären|vielleicht|eventuell|vermutlich|wahrscheinlich|womöglich|angeblich|plant|planen|plante|planten|hofft|hoffen|hoffte|fürchtet|fürchten|befürchtet|droht|drohen|drohte',
);

function hypothetical(text: string, at: number): boolean {
  const [start] = clauseAround(text, at);
  return HYPOTHETICAL.test(text.slice(start, at));
}

const PARTY_ACTOR = words('wir|die Gruppe|unsere Gruppe|die Helden|die Gefährten|die Abenteurer');
const PARTY_TARGET = words(
  'uns|die Gruppe|der Gruppe|den Helden|die Helden|den Gefährten|die Gefährten|unsere Gruppe',
);

type Actor = { party: true } | { party: false; id: string | null; kind: EntityKind | null };

interface Context {
  data: CampaignData;
  sentence: Sentence;
  /** Namen im Satz, Stellen im Satz. */
  names: NameHit[];
}

const kindOf = (data: CampaignData, id: string | null) =>
  id ? (data.entities[id]?.kind ?? null) : null;

/** Steht vor einem Namen „von“, „vom“, „durch“? Dann ist er der Täter, nicht der Betroffene. */
const agentBefore = (text: string, at: number) =>
  /(?:^|\s)(?:von|vom|durch)\s+$/i.test(text.slice(0, at));

interface ActorOptions {
  /** Nur Namen dieser Arten zählen. */
  kinds: readonly EntityKind[];
  /** Namen nach „von/durch“ zählen nicht (Passiv: „wurde von X getötet“). */
  skipAgents?: boolean;
  /** Zählen „wir“, „die Gruppe“ … als Handelnde? Vorgabe: ja. */
  party?: boolean;
}

/** Wer vor der Stelle handelt: der nächste passende Name davor oder „wir“, „die Gruppe“. */
function actorBefore(ctx: Context, at: number, options: ActorOptions): Actor | null {
  return actorAt(ctx, at, options)?.actor ?? null;
}

/**
 * Wie `actorBefore`, aber über ein „und“ hinweg, hinter dem gleich das Tun steht: In
 * „Krummzahn erschlug Lando und floh nach Hohenfurt“ flieht Krummzahn, nicht Lando.
 */
function subjectBefore(ctx: Context, at: number, options: ActorOptions): Actor | null {
  let found = actorAt(ctx, at, options);
  while (
    found &&
    !found.actor.party &&
    /\s(?:und|dann)\s+(?!(?:wir|die|der|das|er|sie|es|man)(?![\p{L}\p{N}]))\p{Ll}/u.test(
      ctx.sentence.text.slice(found.at, at),
    )
  ) {
    const earlier = actorAt(ctx, found.at, options);
    if (!earlier) break;
    found = earlier;
  }
  return found?.actor ?? null;
}

function actorAt(
  ctx: Context,
  at: number,
  options: ActorOptions,
): { at: number; actor: Actor } | null {
  const text = ctx.sentence.text;
  let best: { at: number; actor: Actor } | null = null;
  for (const hit of ctx.names) {
    if (hit.to > at) break;
    if (hit.genitive) continue;
    const kind = kindOf(ctx.data, hit.id);
    if (hit.id && !options.kinds.includes(kind!)) continue;
    if (options.skipAgents && agentBefore(text, hit.from)) continue;
    best = { at: hit.from, actor: { party: false, id: hit.id, kind } };
  }
  if (options.party !== false)
    for (const cue of cues(text.slice(0, at), PARTY_ACTOR))
      if (!best || cue.from > best.at) best = { at: cue.from, actor: { party: true } };
  return best;
}

/** Der erste passende Name nach der Stelle. */
function nameAfter(ctx: Context, at: number, kinds: readonly EntityKind[]): NameHit | null {
  return (
    ctx.names.find(
      (hit) =>
        hit.from >= at &&
        !hit.genitive &&
        (hit.id === null || kinds.includes(kindOf(ctx.data, hit.id)!)),
    ) ?? null
  );
}

/** „Lando und Mira“, „Lando, Mira und Krummzahn“: Namen, die mit dem gefundenen eine Reihe bilden. */
const JOINED = /^\s*(?:,|und|sowie|&|,\s*und)\s*$/;

function joinedWith(ctx: Context, hit: NameHit, kinds: readonly EntityKind[]): NameHit[] {
  const fits = (other: NameHit) =>
    !other.genitive && (other.id === null || kinds.includes(kindOf(ctx.data, other.id)!));
  const index = ctx.names.indexOf(hit);
  const out = [hit];
  for (let i = index - 1; i >= 0; i--) {
    const other = ctx.names[i]!;
    if (!fits(other) || !JOINED.test(ctx.sentence.text.slice(other.to, out[0]!.from))) break;
    out.unshift(other);
  }
  for (let i = index + 1; i < ctx.names.length; i++) {
    const other = ctx.names[i]!;
    const last = out[out.length - 1]!;
    if (!fits(other) || !JOINED.test(ctx.sentence.text.slice(last.to, other.from))) break;
    out.push(other);
  }
  return out;
}

/** Der nächste Name vor der Stelle (ohne „von X“ im Passiv), mit seiner Reihe. */
function subjectsBefore(ctx: Context, at: number, kinds: readonly EntityKind[]): NameHit[] {
  let best: NameHit | null = null;
  for (const hit of ctx.names) {
    if (hit.to > at) break;
    if (hit.genitive || agentBefore(ctx.sentence.text, hit.from)) continue;
    if (hit.id && !kinds.includes(kindOf(ctx.data, hit.id)!)) continue;
    best = hit;
  }
  return best ? joinedWith(ctx, best, kinds) : [];
}

/** Der erste Name nach der Stelle, mit seiner Reihe. */
function objectsAfter(ctx: Context, at: number, kinds: readonly EntityKind[]): NameHit[] {
  const hit = nameAfter(ctx, at, kinds);
  return hit ? joinedWith(ctx, hit, kinds) : [];
}

const PEOPLE: EntityKind[] = ['person', 'character', 'faction', 'family'];
const OPPONENTS: EntityKind[] = ['person', 'faction', 'family', 'species'];

/** Eindeutige Einträge der gewünschten Arten im Satz, in der Reihenfolge des Textes. */
function namedIds(ctx: Context, kinds: readonly EntityKind[], except: string[] = []): string[] {
  const ids: string[] = [];
  for (const hit of ctx.names)
    if (hit.id && kinds.includes(kindOf(ctx.data, hit.id)!) && !except.includes(hit.id))
      if (!ids.includes(hit.id)) ids.push(hit.id);
  return ids;
}

// ── Regeln ─────────────────────────────────────────────────────────────────

type Draft = Omit<Recognized, 'from' | 'to'> & { at: Cue };

const FATE_RULES: { status: PersonStatus; pattern: RegExp; object?: boolean }[] = [
  {
    status: 'dead',
    pattern: words(
      'tot|gestorben|verstorben|getötet|ermordet|erschlagen|totgeschlagen|erstochen|erdolcht|enthauptet|hingerichtet|gehängt|gehenkt|umgebracht|umgekommen|ertrunken|ertrank|ertranken|starb|starben|stirbt|(?:im Kampf|in der Schlacht|im Gefecht)(?:\\s+[^.,;!?]{1,40}?)?\\s+gefallen|(?:ist|sind|war|waren) gefallen(?=\\s*[.,;!?]|\\s*$)|nicht überlebt|überlebte nicht|überlebten nicht|überlebt nicht|nicht mehr am Leben|lebt nicht mehr|lebte nicht mehr',
    ),
  },
  {
    status: 'dead',
    pattern: words(
      'tötete|töteten|tötet|töten|erschlug|erschlugen|erschlägt|ermordete|ermordeten|erstach|erstachen|erdolchte|erdolchten|enthauptete|enthaupteten',
    ),
    object: true,
  },
  {
    status: 'missing',
    pattern: words('verschwunden|verschollen|vermisst|verschwand|verschwanden'),
  },
  {
    status: 'alive',
    pattern: words(
      // „lebt“ allein nur am Satzende – „Mira lebt in Hohenfurt“ sagt nichts übers Schicksal.
      'lebt noch|lebt doch|lebt wieder|am Leben|wieder aufgetaucht|aufgetaucht|überlebt|überlebte|überlebten|lebt(?=\\s*[.!]|\\s*$)',
    ),
  },
];

/** Mittelwörter des Tötens: Mit „hat/haben“ davor tötet der Name davor – getötet wird, wer danach steht. */
const KILLED = words(
  'getötet|ermordet|erschlagen|totgeschlagen|erstochen|erdolcht|enthauptet|hingerichtet|umgebracht',
);
const HAVE = words('hat|haben|hatte|hatten');
/** Der Teilsatz bis zur Stelle: vom letzten Satzzeichen an. */
const clauseStart = (text: string, at: number) =>
  Math.max(
    text.lastIndexOf(',', at - 1),
    text.lastIndexOf(';', at - 1),
    text.lastIndexOf(':', at - 1),
  ) + 1;

function fateRules(ctx: Context, out: Draft[]) {
  const text = ctx.sentence.text;
  const living: EntityKind[] = ['person', 'character'];
  for (const rule of FATE_RULES)
    for (const cue of cues(text, rule.pattern)) {
      if (denied(text, cue) || hypothetical(text, cue.from)) continue;
      let targets = rule.object ? objectsAfter(ctx, cue.to, living) : [];
      const start = clauseStart(text, cue.from);
      const aux = rule.object ? undefined : cues(text.slice(start, cue.from), HAVE)[0];
      if (aux && KILLED.test(cue.word)) {
        // „Lando hat Krummzahn erschlagen“: getötet ist, wer zwischen „hat“ und dem Wort steht.
        // Steht dort nur „ihn“ oder „sie“, rät Wayfarer nicht, wer gemeint ist.
        targets = ctx.names.filter(
          (hit) =>
            hit.from >= start + aux.to &&
            hit.to <= cue.from &&
            !hit.genitive &&
            (hit.id === null || living.includes(kindOf(ctx.data, hit.id)!)),
        );
        if (!targets.length) continue;
      } else if (!rule.object) {
        // Wer davor steht; erst wenn dort niemand steht, wer danach kommt („Tot: Krummzahn“).
        targets = subjectsBefore(ctx, cue.from, living);
        if (!targets.length) targets = objectsAfter(ctx, cue.to, living);
      }
      // „Wir töteten zwei Grubenschleicher“: Wesen haben kein Schicksal, das ist ein Kampf.
      if (!targets.length && ctx.names.some((hit) => kindOf(ctx.data, hit.id) === 'species'))
        continue;
      const ids = targets.length ? targets.map((hit) => hit.id) : [null];
      for (const id of ids) {
        // Gefährten haben kein Schicksal – für sie gibt es den Zustand.
        if (id && kindOf(ctx.data, id) !== 'person') continue;
        out.push({
          kind: 'fate',
          label: id
            ? `Schicksal: ${entityName(ctx.data, id)} → ${FATE_LABEL[rule.status]}`
            : `Schicksal: ${FATE_LABEL[rule.status]}`,
          payload: { fate: { entityId: id, status: rule.status } },
          refs: id ? [id] : [],
          at: cue,
        });
      }
    }
}

/** Ein Wort der Bewegung im Teilsatz: „reisen“, „zog“, „aufgebrochen“, „weiter“, „zurück“ … */
const MOTION = words(
  '(?:weiter|zurück|los|auf|fort|hin)?(?:reise|reisen|reist|reiste|reisten|gereist|ziehe|ziehen|zieht|zog|zogen|gezogen|gehe|gehen|geht|ging|gingen|gegangen|fahre|fahren|fährt|fuhr|fuhren|gefahren|reite|reiten|reitet|ritt|ritten|geritten|wandern|wandert|wanderte|wanderten|gewandert|marschieren|marschiert|marschierte|marschierten|segeln|segelt|segelte|segelten|gesegelt|kehren|kehrt|kehrte|kehrten|gekehrt|laufen|läuft|lief|liefen|gelaufen|fliehen|flieht|floh|flohen|geflohen|flüchten|flüchtet|flüchtete|flüchteten|geflüchtet|eilen|eilt|eilte|eilten|geeilt|brechen|bricht|brach|brachen|gebrochen)|weiter|zurück|unterwegs|Aufbruch',
);
/** Unmittelbar vor dem Ort: wohin es geht. */
const TOWARD =
  /(?:^|[\s,])(?:nach|in die|in den|ins|zur|zum|Richtung)\s+(?:(?:die|der|das|den|dem)\s+)?$/i;
/** Unmittelbar vor dem Ort: angekommen. */
const ARRIVED_BEFORE =
  /(?:^|[\s,])(?:Ankunft in|angekommen in|ankommen in|kommt in|kommen in|kamen in|kam in|zurück in|wieder in|eingetroffen in|erreicht|erreichen|erreichte|erreichten)\s+(?:(?:wir|die Gruppe)\s+)?(?:(?:die|der|das|den|dem)\s+)?$/i;
/** „in Hohenfurt angekommen“, „Hohenfurt erreicht“. */
const IN_BEFORE = /(?:^|\s)in\s+(?:(?:der|dem|den)\s+)?$/i;
const ARRIVED_AFTER = /^\s*(?:angekommen|eingetroffen|gelandet)(?![\p{L}\p{N}])/iu;
const REACHED_AFTER = /^\s*(?:erreicht|erreichen|erreichte|erreichten)(?![\p{L}\p{N}])/iu;
/** Wo jemand jetzt ist: „ist jetzt in“, „lebt nun in“ – für Personen und die Gruppe. */
const NOW_IN =
  /(?:^|\s)(?:ist|sind|lebt|leben|wohnt|wohnen|bleibt|bleiben)\s+(?:jetzt|nun|wieder|seitdem|seither)\s+in\s+(?:(?:der|dem|den)\s+)?$/i;
/** Wo eine Person ist: „blieb in“, „wartet in“ – „Wir sind in …“ ist noch kein Ortswechsel. */
const STAYS_IN =
  /(?:^|\s)(?:ist|war|lebt|lebte|wohnt|wohnte|bleibt|blieb|wartet|wartete|versteckt sich|versteckte sich|hält sich|hielt sich|sitzt|saß)\s+in\s+(?:(?:der|dem|den)\s+)?$/i;
const INTENT = /(?:^|\s)zu\s+\p{L}{2,}en(?![\p{L}\p{N}])/iu;
const SOMEONE = words('er|sie|es|man|ihr|jemand');

function moveRules(ctx: Context, out: Draft[]) {
  const text = ctx.sentence.text;
  for (const place of ctx.names) {
    if (!place.id || place.genitive || kindOf(ctx.data, place.id) !== 'place') continue;
    const before = text.slice(0, place.from);
    const after = text.slice(place.to);
    const [start, end] = clauseAround(text, place.from, place.to);
    const clause = text.slice(start, end);
    const arrived =
      ARRIVED_BEFORE.test(before) ||
      (IN_BEFORE.test(before) && ARRIVED_AFTER.test(after)) ||
      REACHED_AFTER.test(after);
    const nowIn = NOW_IN.test(before);
    const toward = TOWARD.test(before) && MOTION.test(clause);
    const staysIn = STAYS_IN.test(before);
    if (!arrived && !nowIn && !toward && !staysIn) continue;
    if (negated(text, place.from) || hypothetical(text, place.from) || INTENT.test(clause))
      continue;
    const placeId = place.id;
    const actor = subjectBefore(ctx, place.from, { kinds: ['person', 'character'] });
    if (actor && !actor.party) {
      if (!actor.id) continue; // ein mehrdeutiger Name: nicht raten
      out.push({
        kind: 'whereabouts',
        label: `Aufenthalt: ${entityName(ctx.data, actor.id)} → ${entityName(ctx.data, placeId)}`,
        payload: { whereabouts: { entityId: actor.id, placeId } },
        refs: [actor.id, placeId],
        at: { from: place.from, to: place.to, word: text.slice(place.from, place.to) },
      });
      continue;
    }
    if (staysIn && !arrived && !nowIn && !toward) continue;
    if (!actor) {
      // Ohne „wir“ nur, wenn auch sonst niemand davor steht: „Ankunft in Hohenfurt.“ ja,
      // „Die Krähenbande zieht nach Hohenfurt“ oder „Er zog nach Hohenfurt“ nicht.
      const own = text.slice(start, place.from);
      const someone = ctx.names.some(
        (hit) => hit.to <= place.from && kindOf(ctx.data, hit.id) !== 'place',
      );
      if (someone || SOMEONE.test(own)) continue;
    }
    out.push({
      kind: 'travel',
      label: `Ortswechsel: → ${entityName(ctx.data, placeId)}`,
      payload: { travel: { toId: placeId } },
      refs: [placeId],
      at: { from: place.from, to: place.to, word: text.slice(place.from, place.to) },
    });
  }
}

const MEETING = words(
  'getroffen|trifft|treffen auf|trafen|traf|kennengelernt|kennen gelernt|lernen .{0,40}kennen|lernten .{0,40}kennen|begegnet|begegnen|begegneten|begegnete',
);

/** „vom Pfeil getroffen“, „der Hieb trifft Brann“: getroffen, nicht begegnet. */
const STRUCK = words(
  'Pfeil|Pfeile|Pfeilen|Bolzen|Schlag|Schläge|Hieb|Hiebe|Klinge|Schwert|Axt|Dolch|Keule|Speer|Stein|Steine|Kralle|Krallen|Biss|Zauber|Feuerball|Blitz|Treffer|Schuss|Wurf|kritisch|Entscheidung|Wahl',
);
const PASSIVE = words('wurde|wurden|wird|werden|worden');

function meetingRules(ctx: Context, out: Draft[]) {
  const text = ctx.sentence.text;
  const cue = cues(text, MEETING)[0];
  if (!cue || denied(text, cue)) return;
  if (STRUCK.test(text) || PASSIVE.test(text.slice(0, cue.from))) return;
  const refs = namedIds(ctx, ['person', 'faction', 'family']);
  if (!refs.length) {
    // Ohne Person nur, wenn die Gruppe jemanden trifft – und nicht auf Wesen, mit denen sie kämpft.
    const actor = actorBefore(ctx, cue.from, { kinds: PEOPLE });
    const creatures = ctx.names.some((hit) => kindOf(ctx.data, hit.id) === 'species');
    if (!actor?.party || creatures || FIGHT.test(text)) return;
  }
  out.push({
    kind: 'meeting',
    label: refs.length
      ? `Begegnung: ${refs.map((id) => entityName(ctx.data, id)).join(', ')}`
      : 'Begegnung',
    payload: {},
    refs,
    at: cue,
  });
}

const FIGHT = words(
  'kämpfen|kämpft|kämpfte|kämpften|gekämpft|Kampf|Gefecht|angegriffen|greift .{0,40}an|griff .{0,40}an|griffen .{0,40}an|überfallen|Überfall|besiegt|besiegen|besiegten|geflohen|flieht|fliehen|floh|flohen|Flucht|Waffenruhe|Waffenstillstand',
);

function fightRules(ctx: Context, out: Draft[]) {
  const text = ctx.sentence.text;
  const found = cues(text, FIGHT).filter(
    (cue) => !denied(text, cue) && !hypothetical(text, cue.from),
  );
  if (!found.length) return;
  const first = found[0]!;
  const actor = actorBefore(ctx, first.from, { kinds: PEOPLE });
  const isParty = (who: Actor | null) =>
    !who || who.party || (who.id !== null && kindOf(ctx.data, who.id) === 'character');
  const actorIsParty = isParty(actor);
  // Ist die Gruppe nicht dabei, braucht es einen Gegner: „Lando kämpfte gegen Krummzahn“ ja,
  // „Die Krähenbande hat Hohenfurt angegriffen“ (das ist eine Veränderung) oder „Krummzahn hat
  // den Kampf nicht überlebt“ (ein Schicksal) nicht.
  const partyInvolved =
    actorIsParty ||
    words('wir|uns|unser|unsere').test(text) ||
    PARTY_TARGET.test(text) ||
    ctx.names.some((hit) => kindOf(ctx.data, hit.id) === 'character');
  if (!partyInvolved) {
    const opponent = ctx.names.some(
      (hit) =>
        (hit.from > first.from ||
          /(?:^|\s)gegen\s+(?:(?:die|den|der|das)\s+)?$/i.test(text.slice(0, hit.from))) &&
        !hit.genitive &&
        hit.id !== null &&
        OPPONENTS.includes(kindOf(ctx.data, hit.id)!),
    );
    if (!opponent) return;
  }
  const only = (pattern: string) => found.every((cue) => words(pattern).test(cue.word));
  const FLED = 'geflohen|flieht|fliehen|floh|flohen|Flucht';
  // „Krummzahn ist geflohen“ allein ist kein Kampf der Gruppe.
  if (!actorIsParty && only(FLED)) return;
  /**
   * Tut die Gruppe das? Wer davor handelt, entscheidet – Gegner, die erst nach dem ersten
   * Kampfwort stehen („gegen die Krähenbande“), handeln dabei nicht.
   */
  const subjects = { ...ctx, names: ctx.names.filter((hit) => hit.from < first.from) };
  const partyDoes = (pattern: string) =>
    cues(text, words(pattern)).some(
      (cue) => !denied(text, cue) && isParty(actorBefore(subjects, cue.from, { kinds: PEOPLE })),
    );
  let outcome: FightOutcome = 'open';
  if (words('Waffenruhe|Waffenstillstand').test(text)) outcome = 'truce';
  else if (words('uns besiegt|die Gruppe besiegt|unterlegen|verloren|verlieren').test(text))
    outcome = 'lost';
  else if (partyDoes(FLED)) outcome = 'fled';
  else if (partyDoes('besiegt|besiegen|besiegten|gewonnen|erschlagen|siegreich')) outcome = 'won';
  const except = actor && !actor.party && actor.id && actorIsParty ? [actor.id] : [];
  const refs = namedIds(ctx, OPPONENTS, except);
  const against = refs.map((id) => entityName(ctx.data, id)).join(', ');
  const tail = outcome === 'open' ? '' : ` · ${FIGHT_OUTCOME_LABEL[outcome]}`;
  out.push({
    kind: 'fight',
    label: `Kampf${against ? `: ${against}` : ''}${tail}`,
    payload: { fight: { outcome } },
    refs,
    at: first,
  });
}

const REST = words(
  'rasten|rastet|rastete|rasteten|Rast|lagern|lagerten|lagert|übernachten|übernachtet|übernachteten|schlafen|schliefen|Nachtlager',
);

function restRules(ctx: Context, out: Draft[]) {
  const text = ctx.sentence.text;
  const cue = cues(text, REST)[0];
  if (!cue || denied(text, cue) || hypothetical(text, cue.from)) return;
  // Rastet eine Person der Welt („Lando übernachtet in Hohenfurt“), rastet nicht die Gruppe.
  const actor = actorBefore(ctx, cue.from, { kinds: ['person', 'faction', 'family'] });
  if (actor && !actor.party) return;
  const long =
    !words('kurze Rast|kurz').test(text) &&
    words('lange Rast|übernacht\\p{L}*|schlafen|schliefen|Nachtlager|die Nacht|über Nacht').test(
      text,
    );
  out.push({
    kind: 'rest',
    label: long ? 'Lange Rast' : 'Kurze Rast',
    payload: { rest: { long } },
    refs: [],
    at: cue,
  });
}

const PROMISE = words(
  'versprach|versprachen|verspricht|versprechen|versprochen|schuldet|schulden|schuldig|vereinbart|abgemacht|Abmachung|schwört|schwor|geschworen|Auftrag|beauftragt',
);

function promiseRules(ctx: Context, out: Draft[]) {
  const cue = cues(ctx.sentence.text, PROMISE)[0];
  if (!cue) return;
  const refs = namedIds(ctx, PEOPLE);
  out.push({
    kind: 'promise',
    label: refs.length
      ? `Abmachung: ${refs.map((id) => entityName(ctx.data, id)).join(', ')}`
      : 'Abmachung',
    payload: {},
    refs,
    at: cue,
  });
}

const DISCOVER = words(
  'entdeckt|entdecken|entdeckte|entdeckten|gefunden|finden|fanden|findet|stoßen auf|stießen auf|stößt auf',
);
const CLUE_WORD = words('Hinweis|Hinweise|Spur|Spuren|Beweis|Beweise');

function discoveryRules(ctx: Context, out: Draft[]) {
  const text = ctx.sentence.text;
  const cue = cues(text, DISCOVER).find((c) => !denied(text, c) && !hypothetical(text, c.from));
  if (!cue) return;
  // „Wir entdeckten, dass Lando lügt“ – das ist Wissen, keine Entdeckung.
  if (/^\s*(?:heraus\s*)?,?\s*(?:dass|wer|wie|wo|was|warum|wieso|ob)\b/i.test(text.slice(cue.to)))
    return;
  if (CLUE_WORD.test(text)) {
    out.push({
      kind: 'clue',
      label: 'Hinweis gefunden',
      payload: { clue: { threadId: null } },
      refs: namedIds(ctx, PEOPLE),
      at: cue,
    });
    return;
  }
  const place = nameAfter(ctx, cue.to, ['place']) ?? actorBeforePlace(ctx, cue.from);
  const placeId = place?.id ?? null;
  // „gefunden“ ohne Ort ist meist ein Gegenstand – das gehört ins Beute-Buch.
  if (!placeId && !words('entdeckt|entdecken|entdeckte|entdeckten').test(cue.word)) return;
  out.push({
    kind: 'discovery',
    label: placeId ? `Entdeckung: ${entityName(ctx.data, placeId)}` : 'Entdeckung',
    payload: { placeId },
    refs: placeId ? [placeId] : [],
    at: cue,
  });
}

function actorBeforePlace(ctx: Context, at: number): NameHit | null {
  const before = ctx.names.filter(
    (hit) => hit.to <= at && hit.id && kindOf(ctx.data, hit.id) === 'place',
  );
  return before[before.length - 1] ?? null;
}

const RUMOR_SAYS = words(
  'sagt, dass|sagte, dass|sagen, dass|erzählt, dass|erzählte, dass|erzählen, dass|berichtet, dass|berichtete, dass|behauptet|behauptete|meint, dass|munkelt',
);
const RUMOR_WORD = words('angeblich|Gerücht|Gerüchte|es heißt|man sagt|man erzählt|man munkelt');
// „laut“ nur vor einer Quelle („laut Mira“, „laut dem Wirt“), nicht „es war laut“. Ohne
// „i“, damit der Großbuchstabe danach zählt.
const RUMOR_LAUT = /(?<![\p{L}\p{N}])[Ll]aut(?=\s+(?:\p{Lu}|(?:dem|der|den|einem|einer|eines)\s))/u;

function rumorRules(ctx: Context, out: Draft[]) {
  const text = ctx.sentence.text;
  const says = cues(text, RUMOR_SAYS)[0];
  const word = [...cues(text, RUMOR_WORD), ...cues(text, RUMOR_LAUT)].sort(
    (a, b) => a.from - b.from,
  )[0];
  const cue = says ?? word;
  if (!cue) return;
  let sourceId: string | null = null;
  if (says) {
    const actor = actorBefore(ctx, says.from, { kinds: PEOPLE });
    if (actor && !actor.party) sourceId = actor.id;
  } else {
    // „laut Mira“, „Gerücht von Mira“
    const source = /(?:laut|von)\s+$/i;
    const hit = ctx.names.find(
      (h) =>
        h.from >= cue.from &&
        h.id &&
        PEOPLE.includes(kindOf(ctx.data, h.id)!) &&
        source.test(text.slice(0, h.from)),
    );
    sourceId = hit?.id ?? null;
  }
  out.push({
    kind: 'rumor',
    label: sourceId ? `Gerücht: von ${entityName(ctx.data, sourceId)}` : 'Gerücht',
    payload: { rumor: { sourceId } },
    refs: sourceId ? [sourceId] : [],
    at: cue,
  });
}

const LEVEL = /(?<![\p{L}\p{N}])Stufe\s+(\d{1,2})(?![\p{L}\p{N}])/giu;
const MILESTONE = words(
  // „steigt auf“ nur am Ende oder vor „Stufe“ – „wir steigen auf die Pferde“ ist kein Aufstieg.
  'aufgestiegen|aufsteigen|(?:steigt|stieg|steigen|stiegen) auf(?=\\s*(?:[.,;!?]|$|Stufe))|Meilenstein|Stufenaufstieg|eine Stufe höher',
);

function milestoneRules(ctx: Context, out: Draft[]) {
  const text = ctx.sentence.text;
  const verb = cues(text, MILESTONE).find((c) => !denied(text, c));
  // „Stufe 5“ zählt nur als Aufstieg („auf Stufe 5“, „erreicht Stufe 5“, „jetzt Stufe 5“) –
  // „ein Zauber der Stufe 3“ ist keiner.
  let levelMatch: RegExpExecArray | null = null;
  LEVEL.lastIndex = 0;
  for (let match = LEVEL.exec(text); match; match = LEVEL.exec(text)) {
    const before = text.slice(0, match.index);
    if (
      verb ||
      /(?:^|\s)(?:auf|jetzt|nun|erreicht|erreichen|erreichte|erreichten)\s+$/i.test(before)
    ) {
      if (!negated(text, match.index)) levelMatch = match;
      break;
    }
  }
  const cue: Cue | undefined = levelMatch
    ? { from: levelMatch.index, to: levelMatch.index + levelMatch[0].length, word: levelMatch[0] }
    : verb;
  if (!cue || hypothetical(text, cue.from)) return;
  const number = levelMatch ? Number(levelMatch[1]) : null;
  const level = number !== null && number >= 1 && number <= 20 ? number : null;
  const all = words('alle|alle Gefährten|jeder|jede|die ganze Gruppe').test(
    text.slice(0, cue.from),
  );
  const found = actorBefore(ctx, cue.from, { kinds: ['character'] });
  const actor: Actor | null = all && !(found && !found.party) ? { party: true } : found;
  const named =
    actor && !actor.party ? actor.id : (nameAfter(ctx, cue.to, ['character'])?.id ?? null);
  const add = (characterId: string | null) =>
    out.push({
      kind: 'milestone',
      label: `Meilenstein: ${characterId ? entityName(ctx.data, characterId) : 'Gefährte'}${level !== null ? ` → Stufe ${level}` : ''}`,
      payload: { milestone: { characterId, level } },
      refs: characterId ? [characterId] : [],
      at: cue,
    });
  // Steigt die ganze Gruppe auf, je Gefährte ein Vorschlag.
  if (actor?.party) for (const character of activeParty(ctx.data)) add(character.id);
  else add(named);
}

const WISH = words(
  'will|wollte|möchte|möchten|wünscht sich|wünscht|würde gern|würde gerne|träumt davon',
);

function wishRules(ctx: Context, out: Draft[]) {
  const text = ctx.sentence.text;
  for (const cue of cues(text, WISH)) {
    const actor = actorBefore(ctx, cue.from, { kinds: PEOPLE });
    if (!actor || actor.party || !actor.id || kindOf(ctx.data, actor.id) !== 'character') continue;
    out.push({
      kind: 'wish',
      label: `Spielerwunsch: ${entityName(ctx.data, actor.id)}`,
      payload: { wish: { characterId: actor.id } },
      refs: [actor.id],
      at: cue,
    });
    return;
  }
}

const DECISION = words(
  'entscheide[nt]? (?:sich|uns)|entschied(?:en)? (?:sich|uns)|(?:hat|haben) (?:sich|uns) entschieden|beschließt|beschließen|beschloss|beschlossen|die Gruppe will|wir wollen|(?:treffen|trafen|trifft|traf) eine Entscheidung|Entscheidung getroffen|Entscheidung gefallen',
);

function decisionRules(ctx: Context, out: Draft[]) {
  const cue = cues(ctx.sentence.text, DECISION)[0];
  if (!cue) return;
  out.push({ kind: 'decision', label: 'Entscheidung', payload: {}, refs: [], at: cue });
}

const KNOWLEDGE = words(
  'erfährt|erfuhr|erfuhren|erfahren|weiß jetzt|weiß nun|wissen jetzt|wissen nun|kennt jetzt|kennt nun|kennen jetzt|kennen nun|findet heraus|fand heraus|fanden heraus|finden heraus|herausgefunden|(?:entdeckt|entdeckte|entdeckten|entdecken),\\s*dass',
);
/** „Lando ist sehr erfahren“: erfahren als Eigenschaft, nicht als Tun. */
const SKILLED = /(?:^|\s)(?:ist|sind|war|waren|sehr|wenig|kaum|gut|recht|ziemlich)\s+$/i;

function knowledgeRules(ctx: Context, out: Draft[]) {
  const text = ctx.sentence.text;
  const cue = cues(text, KNOWLEDGE).find(
    (c) =>
      !denied(text, c) &&
      !(c.word.toLocaleLowerCase('de') === 'erfahren' && SKILLED.test(text.slice(0, c.from))),
  );
  if (!cue) return;
  const actor = actorBefore(ctx, cue.from, { kinds: PEOPLE });
  const id = actor && !actor.party ? actor.id : null;
  out.push({
    kind: 'knowledge',
    label: id ? `Wer was weiß: ${entityName(ctx.data, id)}` : 'Wer was weiß',
    payload: {},
    refs: id ? [id] : [],
    at: cue,
  });
}

const ATTITUDE = words(
  'hasst|hasste|hassen|ist wütend|war wütend|sind wütend|wütend auf|zornig|verabscheut|misstraut|misstraute|vertraut|vertraute|mag uns|liebt|ist dankbar|sind dankbar|dankbar|feindselig|freundlich gesinnt|beleidigt|verärgert',
);

function attitudeRules(ctx: Context, out: Draft[]) {
  const text = ctx.sentence.text;
  const cue = cues(text, ATTITUDE).find((c) => !negated(text, c.from));
  if (!cue) return;
  const actor = actorBefore(ctx, cue.from, { kinds: PEOPLE });
  if (actor?.party) return;
  const fromId = actor?.id ?? null;
  let toId: string | null = null;
  if (cues(text.slice(cue.from), PARTY_TARGET).length) toId = PARTY_ID;
  else {
    const hit = nameAfter(ctx, cue.to, PEOPLE);
    toId = hit?.id ?? null;
  }
  const label = fromId
    ? `Haltung: ${entityName(ctx.data, fromId)}${toId ? ` gegenüber ${toId === PARTY_ID ? 'der Gruppe' : entityName(ctx.data, toId)}` : ''}`
    : 'Haltung';
  out.push({
    kind: 'attitude',
    label,
    payload: { attitude: { fromId, toId, value: null } },
    refs: [fromId, toId].filter((id): id is string => !!id && id !== PARTY_ID),
    at: cue,
  });
}

const CONDITION = words(
  'verflucht|vergiftet|schwer verletzt|verwundet|verletzt|erkrankt|krank|gefangen genommen|gefangen|gefesselt|bewusstlos|gelähmt|besessen|blind|taub|Pfeil im \\p{L}+',
);
const CONDITION_END = words(
  'geheilt|befreit|wieder gesund|erholt sich|hat sich erholt|Fluch gebrochen|Fluch aufgehoben|nicht mehr verflucht',
);

/** „nicht mehr vergiftet“, „kein bisschen mehr verflucht“: Der Zustand endet. */
const NO_LONGER = /(?:nicht|kein\p{L}*)\s+(?:\p{L}+\s+)?mehr\s+$/iu;

function conditionRules(ctx: Context, out: Draft[]) {
  const text = ctx.sentence.text;
  const living: EntityKind[] = ['person', 'character'];
  const pick = (ended: boolean): Cue[] =>
    (ended
      ? [
          ...cues(text, CONDITION_END).filter((c) => !negatedAfter(text, c.to)),
          ...cues(text, CONDITION).filter((c) => NO_LONGER.test(text.slice(0, c.from))),
        ]
      : cues(text, CONDITION).filter((c) => !denied(text, c))
    ).filter((c) => !hypothetical(text, c.from));
  // Endet etwas, zählt nur das Ende; sonst jeder genannte Zustand („Ilka bewusstlos, Brann
  // vergiftet“) mit dem, der davor steht.
  const ending = pick(true);
  const ended = ending.length > 0;
  for (const cue of ended ? ending : pick(false)) {
    const actor = actorBefore(ctx, cue.from, { kinds: living, skipAgents: true });
    if (actor?.party) continue; // „Wir sind gefangen“: für die Gruppe gibt es keinen Zustand
    let targets = subjectsBefore(ctx, cue.from, living);
    if (!targets.length) targets = objectsAfter(ctx, cue.to, living);
    const word = cue.word.toLocaleLowerCase('de').startsWith('pfeil')
      ? cue.word
      : cue.word.toLocaleLowerCase('de');
    for (const id of targets.length ? targets.map((hit) => hit.id) : [null]) {
      const who = id ? entityName(ctx.data, id) : '';
      out.push({
        kind: 'condition',
        label: ended
          ? `Zustand aufgehoben${who ? `: ${who}` : ''}`
          : `Zustand${who ? `: ${who}` : ''} – ${word}`,
        payload: { condition: { entityId: id, ended } },
        refs: id ? [id] : [],
        at: cue,
      });
    }
  }
}

const QUOTE = /[„"»‚‹“]([^„"»«“”‚‘‹›]{2,})[“”"«‘›]/u;

function quoteRules(ctx: Context, out: Draft[]) {
  const text = ctx.sentence.text;
  const match = QUOTE.exec(text);
  if (!match) return;
  const from = match.index;
  const to = from + match[0].length;
  // Wer es sagte: der nächste Name außerhalb des Zitats.
  const outside = ctx.names.filter(
    (hit) =>
      (hit.to <= from || hit.from >= to) &&
      hit.id &&
      ['person', 'character'].includes(kindOf(ctx.data, hit.id)!),
  );
  const speaker = outside
    .map((hit) => ({ hit, distance: hit.from >= to ? hit.from - to : from - hit.to }))
    .sort((a, b) => a.distance - b.distance)[0]?.hit.id;
  out.push({
    kind: 'quote',
    label: speaker ? `Zitat: ${entityName(ctx.data, speaker)}` : 'Zitat',
    payload: {},
    refs: speaker ? [speaker] : [],
    at: { from, to, word: match[0] },
  });
}

const RULES = [
  quoteRules,
  fateRules,
  conditionRules,
  moveRules,
  meetingRules,
  fightRules,
  restRules,
  promiseRules,
  discoveryRules,
  rumorRules,
  milestoneRules,
  wishRules,
  decisionRules,
  knowledgeRules,
  attitudeRules,
];

/**
 * Was ein geschriebener Satz sein dürfte – Vorschläge, älteste Stelle zuerst, mehrere je Satz
 * möglich. Nie geraten: Ist ein Name mehrdeutig oder fehlt er, bleibt das Ding offen.
 */
export function recognizeEntry(
  data: CampaignData,
  text: string,
  options: RecognizeOptions = {},
): Recognized[] {
  if (!text.trim()) return [];
  const refs = options.refs ?? [];
  const names = findNames(data, text, refs);
  const drafts: Recognized[] = [];
  for (const sentence of sentences(text)) {
    const end = sentence.from + sentence.text.length;
    const ctx: Context = {
      data,
      sentence,
      names: names
        .filter((hit) => hit.from >= sentence.from && hit.to <= end)
        .map((hit) => ({ ...hit, from: hit.from - sentence.from, to: hit.to - sentence.from })),
    };
    const found: Draft[] = [];
    // Eine Frage („Ist Krummzahn tot?“) hält nichts fest – nur ein Zitat darin zählt.
    for (const rule of sentence.question ? [quoteRules] : RULES) rule(ctx, found);
    for (const { at, ...draft } of found)
      drafts.push({ ...draft, from: sentence.from + at.from, to: sentence.from + at.to });
  }
  const seen = new Set<string>();
  return drafts
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .filter((item) => {
      const key = `${item.kind}:${JSON.stringify(item.payload)}:${item.refs.join(',')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Macht aus einem Vorschlag die Eingabe für `recordEntry` (ohne Text, Zeit und Ort – die bringt
 * der Dialog). null, wenn ein nötiges Ding offen ist und der Spielleiter es erst wählen muss.
 */
export function recognizedInput(item: Recognized): Omit<RecordInput, 'text'> | null {
  const p = item.payload;
  const refs = item.refs;
  switch (item.kind) {
    case 'fate':
      return p.fate?.entityId
        ? { kind: 'fate', refs, fate: { entityId: p.fate.entityId, status: p.fate.status } }
        : null;
    case 'whereabouts':
      return p.whereabouts?.entityId
        ? {
            kind: 'whereabouts',
            refs,
            whereabouts: { entityId: p.whereabouts.entityId, placeId: p.whereabouts.placeId },
          }
        : null;
    case 'travel':
      return p.travel?.toId ? { kind: 'travel', refs, travel: { toId: p.travel.toId } } : null;
    case 'attitude':
      return p.attitude?.fromId && p.attitude.toId
        ? {
            kind: 'attitude',
            refs,
            attitude: { fromId: p.attitude.fromId, toId: p.attitude.toId, value: null },
          }
        : null;
    case 'condition':
      return p.condition?.entityId
        ? {
            kind: 'condition',
            refs,
            condition: { entityId: p.condition.entityId, ended: p.condition.ended },
          }
        : null;
    case 'milestone':
      return p.milestone?.characterId
        ? {
            kind: 'milestone',
            refs,
            milestone: { characterId: p.milestone.characterId, level: p.milestone.level },
          }
        : null;
    case 'wish':
      return p.wish?.characterId
        ? { kind: 'wish', refs, wish: { characterId: p.wish.characterId } }
        : null;
    case 'meeting':
    case 'knowledge':
      return refs.length ? { kind: item.kind, refs } : null;
    case 'fight':
      return { kind: 'fight', refs, fight: { outcome: p.fight?.outcome ?? 'open' } };
    case 'rest':
      return { kind: 'rest', refs, rest: { long: p.rest?.long ?? false } };
    case 'rumor':
      return { kind: 'rumor', refs, rumor: { sourceId: p.rumor?.sourceId ?? null } };
    case 'discovery':
      return p.placeId
        ? { kind: 'discovery', refs, placeId: p.placeId }
        : { kind: 'discovery', refs };
    case 'clue':
      return { kind: 'clue', refs, clue: { threadId: null } };
    default:
      return { kind: item.kind, refs };
  }
}
