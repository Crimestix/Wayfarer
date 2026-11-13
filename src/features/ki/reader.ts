/**
 * Der KI-Leser: Ein Sprachmodell liest den Text eines Artikels und schlägt vor, was daraus für
 * die Welt folgt – was regelmäßig oder an einem Tag geschieht, wer wie zu wem steht, was offen
 * ist. Es liest nur; es schreibt keine Geschichte und ändert nichts. Jeder Vorschlag nennt den
 * Satz, aus dem er stammt, und gilt erst, wenn der Spielleiter ihn annimmt.
 *
 * Hier steht die reine Rechnung: den Auftrag bauen, die Antwort prüfen, Namen und Daten in der
 * Welt wiederfinden. Der Abruf selbst läuft über die Rust-Seite (`data/platform.ts`).
 */
import { z } from 'zod';
import { normalize } from '../../domain/derive';
import { RELATION_TYPES, relationType } from '../../domain/relations';
import {
  newId,
  type AiHint,
  type Article,
  type CalendarEvent,
  type CampaignData,
  type Entity,
  type Repeat,
} from '../../domain/schema';
import {
  MINUTES_PER_DAY,
  dayIndexOf,
  formatDate,
  fromTime,
  monthLength,
  toTime,
  type CalendarDef,
  type WorldTime,
} from '../../domain/time/calendar';
import { findDates } from '../../domain/time/textDates';
import { sessionAt } from '../chronik/model';
import { worldIndex, type WorldIndex } from '../wiki/facts';
import { titleKey } from '../wiki/text';

// ── Modelle und Kosten ─────────────────────────────────────────────────────

export interface AiModel {
  id: string;
  label: string;
  hint: string;
  /** Preis in US-Dollar je Million Textbausteine: Eingabe und Ausgabe. */
  input: number;
  output: number;
}

/** Die Modelle, die lesen können – das günstigste zuerst. Preise: Listenpreise, Stand November 2026. */
export const AI_MODELS: AiModel[] = [
  {
    id: 'claude-haiku-5-5',
    label: 'Haiku 5.5 – schnell und sehr günstig',
    hint: 'Reicht für das Herauslesen von Terminen und Beziehungen.',
    input: 0.1,
    output: 0.5,
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Sonnet 5.5 – gründlicher',
    hint: 'Für lange, verschachtelte Texte. Etwa zwanzigmal so teuer wie Haiku.',
    input: 2,
    output: 10,
  },
  {
    id: 'claude-opus-5-5',
    label: 'Opus 5.5 – am gründlichsten',
    hint: 'Etwa vierzigmal so teuer wie Haiku.',
    input: 4,
    output: 20,
  },
];

export const DEFAULT_AI_MODEL = AI_MODELS[0]!.id;

export const aiModel = (id: string): AiModel =>
  AI_MODELS.find((model) => model.id === id) ?? AI_MODELS[0]!;

/** Grobe Schätzung: Ein Textbaustein sind etwa drei Zeichen deutscher Text. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

/** Kosten in US-Dollar für gelesene und geschriebene Textbausteine. */
export const costUsd = (model: AiModel, inputTokens: number, outputTokens: number): number =>
  (inputTokens * model.input + outputTokens * model.output) / 1_000_000;

/** „0,03 $“ – unter einem Cent „unter 0,01 $“. */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.01) return 'unter 0,01 $';
  return `${value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
}

// ── Der Text eines Artikels ────────────────────────────────────────────────

/** Was das Modell von einem Artikel zu lesen bekommt: alle Textseiten, mit ihren Überschriften. */
export function articleText(article: Article): string {
  return article.docs
    .filter((doc) => doc.kind === 'page' && doc.text.trim())
    .map((doc) => (doc.title ? `## ${doc.title}\n${doc.text.trim()}` : doc.text.trim()))
    .join('\n\n');
}

/** Kürzere Texte lohnen das Lesen nicht. */
export const MIN_TEXT_CHARS = 200;

/** Ein kurzer Fingerabdruck des Textes: Hat er sich seit dem Lesen geändert? */
export function textMark(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}-${(hash >>> 0).toString(36)}`;
}

/** Ob ein Artikel gelesen werden sollte: genug Text, keine Vorlage, noch nicht in diesem Wortlaut gelesen. */
export function needsReading(article: Article): boolean {
  if (article.template) return false;
  const text = articleText(article);
  return text.length >= MIN_TEXT_CHARS && article.aiRead?.mark !== textMark(text);
}

// ── Auftrag ────────────────────────────────────────────────────────────────

const RELATION_KEYS = RELATION_TYPES.map((type) => type.key).filter((key) => key !== 'custom');

/** Die Form der Antwort. Leere Angaben sind ein leerer Text oder 0 – so bleibt die Form einfach. */
export const READING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['events', 'relations', 'threads'],
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title',
          'past',
          'rhythm',
          'weekday',
          'day',
          'month',
          'year',
          'place',
          'who',
          'quote',
        ],
        properties: {
          title: { type: 'string' },
          past: { type: 'boolean' },
          rhythm: { type: 'string', enum: ['once', 'daily', 'weekly', 'monthly', 'yearly'] },
          weekday: { type: 'string' },
          day: { type: 'integer' },
          month: { type: 'string' },
          year: { type: 'integer' },
          place: { type: 'string' },
          who: { type: 'array', items: { type: 'string' } },
          quote: { type: 'string' },
        },
      },
    },
    relations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['from', 'to', 'kind', 'quote'],
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          kind: { type: 'string', enum: RELATION_KEYS },
          quote: { type: 'string' },
        },
      },
    },
    threads: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'sort', 'day', 'month', 'year', 'who', 'place', 'quote'],
        properties: {
          text: { type: 'string' },
          sort: { type: 'string', enum: ['promise', 'secret', 'lead'] },
          day: { type: 'integer' },
          month: { type: 'string' },
          year: { type: 'integer' },
          who: { type: 'array', items: { type: 'string' } },
          place: { type: 'string' },
          quote: { type: 'string' },
        },
      },
    },
  },
} as const;

export interface ReadRequest {
  system: string;
  user: string;
  schema: typeof READING_SCHEMA;
  maxTokens: number;
}

const SYSTEM = `Du liest für einen Spielleiter Artikel aus seinem selbst geschriebenen Welt-Wiki (Pen & Paper). Ein Programm simuliert diese Welt: Es lässt die Zeit laufen und meldet, was währenddessen geschieht. Dafür braucht es aus dem Text drei Dinge.

1. events – was zu einer bestimmten Zeit oder regelmäßig geschieht, unabhängig von den Spielern: ein Schiff legt ab, ein Markt findet statt, ein Fest wird gefeiert, eine Frist läuft ab, eine Versammlung tagt.
   - title: ein kurzer Satz in der Gegenwart, so wie er später gemeldet wird, z. B. „Die Seeschwalbe legt ab“.
   - past: true, wenn der Text es als vergangen erzählt (Vergangenheitsform, „damals“, „einst“, „vor Jahren“) – also etwas, das schon geschehen ist und nicht wieder geschieht. false, wenn es noch bevorsteht oder bis heute regelmäßig geschieht.
   - rhythm: once (einmal an einem Datum), daily, weekly, monthly oder yearly.
   - weekday: bei weekly der Wochentag, genau so geschrieben wie in der Liste unten; sonst leer.
   - day und month: bei monthly der Tag; bei yearly und once Tag und Monat (Monat genau wie in der Liste); was fehlt, ist 0 oder leer.
   - year: nur bei once, als Jahreszahl der genannten Zeitrechnung; sonst 0.
   - place: der Ort des Geschehens, mit dem Namen aus dem Text; sonst leer.
   - who: beteiligte Personen, Gruppen, Schiffe – mit den Namen aus dem Text.
2. relations – wie zwei benannte Personen, Gruppen oder Orte zueinander stehen. from und to sind Namen aus dem Text. kind ist eine dieser Arten (gelesen von from aus): ${RELATION_TYPES.filter(
  (type) => type.key !== 'custom',
)
  .map((type) => `${type.key} = „${type.label}“`)
  .join(', ')}.
3. threads – was offen ist. text ist ein kurzer Satz dazu, sort sagt, was es ist:
   - promise: etwas, das noch eingelöst werden muss – ein Versprechen, eine Schuld, ein Auftrag, eine Drohung.
   - secret: Wissen und Nichtwissen – ein Geheimnis, etwas, das jemand weiß, nicht weiß oder verbirgt, ein ungelöstes Rätsel. Beispiel: „Mira weiß nicht, was ihr Bruder im Wrack fand“ ist secret, kein promise.
   - lead: eine Spur oder offene Frage der Geschichte, der die Gruppe nachgehen kann – wohin etwas führt, woher etwas kommt, wer oder was dahintersteckt. Niemand verbirgt es und niemand schuldet es; es ist schlicht noch nicht geklärt. Beispiel: „Die Wolfsfährten führen nach Norden in den Wald; woher das Gift stammt, ist noch unbekannt“ ist lead.
   - day, month und year: nur bei promise – der Tag, an dem die Abmachung getroffen wurde (Monat genau wie in der Liste, Jahr der genannten Zeitrechnung), wenn der Text ihn nennt. Nicht die Frist, bis wann sie eingelöst sein muss. Nennt der Text den Tag nicht, ist day 0, month leer und year 0 – rate nie.

Regeln:
- Nimm nur auf, was im Text steht. Erfinde nichts, ergänze nichts, deute nichts aus.
- Vergangenes aus der Geschichte der Welt (Legenden, alte Kriege) gehört nicht zu events, außer es trägt ein genaues Datum. Dann ist past true.
- Was früher regelmäßig geschah und heute nicht mehr („früher tagte der Rat jeden Monat“), lass weg.
- Ist ein Zeitpunkt zu ungenau für die Felder (etwa „im Frühjahr“), lass das Ereignis weg.
- quote ist immer der Satz aus dem Text, wörtlich, aus dem du die Angabe liest – höchstens 200 Zeichen.
- Lieber wenige sichere Angaben als viele unsichere. Leere Listen sind eine gute Antwort.
- Antworte auf Deutsch und nur in der vorgegebenen Form.`;

/** Der Auftrag für einen Artikel: was zu tun ist, der Kalender der Welt und der Text. */
export function buildReadRequest(
  data: Pick<CampaignData, 'campaign' | 'state'>,
  article: Article,
  path = '',
): ReadRequest {
  const cal = data.campaign.calendar;
  const text = articleText(article);
  const user = [
    `Wochentage: ${cal.weekdays.join(', ')}`,
    `Monate: ${cal.months.map((month) => month.name).join(', ')}`,
    `Zeitrechnung: ${cal.eras[0]?.label ?? 'Jahre'}`,
    `Heute ist der ${formatDate(cal, data.state.now)}.`,
    '',
    `Artikel: ${article.title}${path ? ` (${path})` : ''}`,
    article.tags.length ? `Schlagworte: ${article.tags.join(', ')}` : '',
    '',
    text,
  ]
    .filter((line, index) => line !== '' || index === 4 || index === 7)
    .join('\n');
  return {
    system: SYSTEM,
    user,
    schema: READING_SCHEMA,
    // Die Antwort ist kurz; Platz zum Nachdenken eingerechnet.
    maxTokens: 6000,
  };
}

// ── Antwort ────────────────────────────────────────────────────────────────

const words = z.string().default('');
const names = z.array(z.string()).default([]);

export const ReadingSchema = z.object({
  events: z
    .array(
      z.object({
        title: z.string(),
        past: z.boolean().default(false),
        rhythm: z.enum(['once', 'daily', 'weekly', 'monthly', 'yearly']),
        weekday: words,
        day: z.number().int().default(0),
        month: words,
        year: z.number().int().default(0),
        place: words,
        who: names,
        quote: words,
      }),
    )
    .default([]),
  relations: z
    .array(z.object({ from: z.string(), to: z.string(), kind: z.string(), quote: words }))
    .default([]),
  threads: z
    .array(
      z.object({
        text: z.string(),
        sort: z.enum(['promise', 'secret', 'lead']).optional(),
        /** Wann eine Abmachung getroffen wurde – fehlt bei älteren Antworten. */
        day: z.number().int().optional(),
        month: z.string().optional(),
        year: z.number().int().optional(),
        who: names,
        place: words,
        quote: words,
      }),
    )
    .default([]),
});
export type Reading = z.infer<typeof ReadingSchema>;

export interface AiReply {
  reading: Reading;
  inputTokens: number;
  outputTokens: number;
}

/** Was bei einer Antwort der API schiefgehen kann – als Satz für den Spielleiter. */
export function replyProblem(status: number, body: string): string {
  let message = '';
  try {
    const parsed: unknown = JSON.parse(body);
    const error = (parsed as { error?: { message?: unknown } }).error;
    if (typeof error?.message === 'string') message = error.message;
  } catch {
    // Keine lesbare Fehlermeldung – der Status sagt genug.
  }
  if (status === 401) return 'Claude nimmt den Key nicht an. Bitte in den Einstellungen prüfen.';
  if (status === 403) return 'Dieser Key darf das gewählte Modell nicht benutzen.';
  if (status === 429)
    return 'Claude nimmt gerade keine weiteren Anfragen an (zu viele auf einmal). Bitte kurz warten.';
  if (status === 400 && /credit balance/i.test(message))
    return 'Das Guthaben bei Anthropic ist aufgebraucht. Es lässt sich in deren Konsole aufladen.';
  if (status >= 500) return 'Claude ist gerade gestört. Bitte später erneut versuchen.';
  return `Claude hat die Anfrage abgelehnt (${status})${message ? `: ${message}` : '.'}`;
}

/**
 * Liest die Antwort der API: den Text der Antwort als Angaben in der vereinbarten Form, dazu der
 * Verbrauch. Wirft einen Fehler mit verständlichem Satz, wenn die Antwort nicht zu gebrauchen ist.
 */
export function parseReply(status: number, body: string): AiReply {
  if (status !== 200) throw new Error(replyProblem(status, body));
  let message: {
    content?: { type?: string; text?: string }[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  try {
    message = JSON.parse(body) as typeof message;
  } catch {
    throw new Error('Die Antwort von Claude war nicht lesbar.');
  }
  if (message.stop_reason === 'refusal')
    throw new Error('Claude hat es abgelehnt, diesen Text zu lesen.');
  if (message.stop_reason === 'max_tokens')
    throw new Error('Die Antwort von Claude wurde zu lang und ist abgeschnitten.');
  const text = (message.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
  // Falls doch Worte um die Angaben stehen: von der ersten bis zur letzten Klammer.
  const from = text.indexOf('{');
  const to = text.lastIndexOf('}');
  let raw: unknown;
  try {
    raw = JSON.parse(from >= 0 && to > from ? text.slice(from, to + 1) : text);
  } catch {
    throw new Error('Die Antwort von Claude hatte nicht die vereinbarte Form.');
  }
  const parsed = ReadingSchema.safeParse(raw);
  if (!parsed.success) throw new Error('Die Antwort von Claude hatte nicht die vereinbarte Form.');
  return {
    reading: parsed.data,
    inputTokens: message.usage?.input_tokens ?? 0,
    outputTokens: message.usage?.output_tokens ?? 0,
  };
}

// ── In der Welt wiederfinden ───────────────────────────────────────────────

const ARTICLE_WORD = /^(?:der|die|das|dem|den|des)\s+/i;

/** Der Eintrag der Welt zu einem Namen aus dem Text – nur, wenn er eindeutig ist. */
export function findEntity(
  index: WorldIndex,
  name: string,
  kinds?: readonly Entity['kind'][],
): Entity | null {
  const clean = name.trim();
  if (!clean) return null;
  const found =
    index.byName.get(titleKey(clean)) ??
    index.byName.get(titleKey(clean.replace(ARTICLE_WORD, '')));
  const fitting = (found ?? []).filter((entity) => !kinds || kinds.includes(entity.kind));
  return fitting.length === 1 ? fitting[0]! : null;
}

type ReadEvent = Reading['events'][number];

/**
 * Wann ein gelesenes Ereignis das nächste Mal eintritt und wie es sich wiederholt – oder null,
 * wenn die Angaben nicht für ein Datum reichen.
 */
export function eventTime(
  cal: CalendarDef,
  now: number,
  event: Pick<ReadEvent, 'rhythm' | 'weekday' | 'day' | 'month' | 'year'>,
): { at: number; repeat: Repeat | null } | null {
  const today = dayIndexOf(now);
  const date = fromTime(cal, today * MINUTES_PER_DAY);
  const monthIndex = cal.months.findIndex(
    (month) => normalize(month.name) === normalize(event.month),
  );
  const dayAt = (year: number, month: number, day: number) =>
    toTime(cal, {
      year,
      month,
      day: Math.max(1, Math.min(day, monthLength(cal, year, month))),
      hour: 0,
      minute: 0,
    });
  switch (event.rhythm) {
    case 'daily':
      return { at: today * MINUTES_PER_DAY, repeat: { every: 1, unit: 'day' } };
    case 'weekly': {
      const target = cal.weekdays.findIndex((name) => normalize(name) === normalize(event.weekday));
      if (target < 0) return null;
      const ahead = (target - date.weekday + cal.weekdays.length) % cal.weekdays.length;
      return { at: (today + ahead) * MINUTES_PER_DAY, repeat: { every: 1, unit: 'week' } };
    }
    case 'monthly': {
      if (event.day < 1) return null;
      let { year, month } = date;
      if (date.day > Math.min(event.day, monthLength(cal, year, month))) {
        month++;
        if (month >= cal.months.length) {
          month = 0;
          year++;
        }
      }
      return { at: dayAt(year, month, event.day), repeat: { every: 1, unit: 'month' } };
    }
    case 'yearly': {
      if (event.day < 1 || monthIndex < 0) return null;
      const thisYear = dayAt(date.year, monthIndex, event.day);
      const at =
        thisYear >= today * MINUTES_PER_DAY
          ? thisYear
          : dayAt(date.year + 1, monthIndex, event.day);
      return { at, repeat: { every: 1, unit: 'year' } };
    }
    case 'once': {
      if (event.day < 1 || monthIndex < 0 || event.year === 0) return null;
      const year = event.year + (cal.eras[0]?.offset ?? 0);
      if (year < 1) return null;
      return { at: dayAt(year, monthIndex, event.day), repeat: null };
    }
  }
}

const RHYTHM_WORD: Record<ReadEvent['rhythm'], string> = {
  once: 'einmal',
  daily: 'täglich',
  weekly: 'jede Woche',
  monthly: 'jeden Monat',
  yearly: 'jedes Jahr',
};

/** Was der Kalender für einen angenommenen Termin braucht. */
export type EventDraft = Pick<
  CalendarEvent,
  'title' | 'at' | 'timed' | 'kind' | 'details' | 'placeId' | 'refs' | 'repeat' | 'done'
>;

/** promise = Abmachung; secret = Geheimnis; lead = ein Faden: eine Spur, eine offene Frage. */
export type ThreadSort = 'promise' | 'secret' | 'lead';

const LEAD_WORDS =
  /\bspur(?:en)?\b|fährte|führ(?:t|en) (?:nach|zu|zum|zur|in|tiefer|weiter)|noch (?:immer )?unbekannt|(?:quelle|ursprung|herkunft|ursache) .*(?:unbekannt|ungeklärt|unklar)|\bwoher\b|\bwohin\b|wer .* (?:dahinter ?steckt|dahinter ?steht)|offene frage|ist (?:noch )?ungeklärt|bleibt (?:offen|unklar)/i;

const SECRET_WORDS =
  /weiß nicht|weiss nicht|wissen nicht|ahnt nicht|ahnen nicht|ahnt nichts|ohne zu wissen|ohne dass .* (?:weiß|wissen|ahnt)|geheim|heimlich|verbirgt|verbergen|verheimlicht|verschweigt|verschwiegen|niemand weiß|niemand ahnt|kennt .* nicht|unbekannt ist|ungeklärt|ungelöst|rätsel|was .* wirklich|in wahrheit|tatsächlich aber/i;

/**
 * Was ein offener Punkt ist: etwas, das eingelöst werden muss (Versprechen, Schuld, Auftrag),
 * Wissen und Nichtwissen (Geheimnis) – oder ein Faden: eine Spur, eine offene Frage der
 * Geschichte. Sagt der Leser es nicht selbst (ältere Vorschläge), entscheiden die Worte.
 */
export function threadSort(text: string, given?: unknown): ThreadSort {
  if (given === 'promise' || given === 'secret' || given === 'lead') return given;
  if (LEAD_WORDS.test(text)) return 'lead';
  return SECRET_WORDS.test(text) ? 'secret' : 'promise';
}

// ── Wann eine Abmachung getroffen wurde ────────────────────────────────────

type ReadThread = Reading['threads'][number];

/** Worte direkt vor einem Datum, die eine Frist nennen („bis zum 3. Tauwind“) – kein Tag der Abmachung. */
const DEADLINE_BEFORE =
  /(?<![\p{L}\p{N}])(?:bis|spätestens|vor|binnen|ab|fällig|frist)(?:\s+(?:zum|zur|am|an|dem|den|der|ende|anfang|mitte))*\s*$/iu;

/**
 * Der Tag, an dem eine Abmachung getroffen wurde: aus der Antwort des Lesers, sonst aus einem
 * Datum in den Worten des Kalenders in den genannten Sätzen („am 3. Tauwind 701“). Aus den
 * Sätzen zählt nur ein Tag oder Monat, der nicht nach heute liegt und nicht als Frist dasteht
 * („bis zum …“) – das ist nicht der Tag der Abmachung. null, wenn der Text es nicht sagt.
 */
export function promiseDate(
  cal: CalendarDef,
  now: WorldTime,
  given: Partial<Pick<ReadThread, 'day' | 'month' | 'year'>>,
  sentences: readonly string[],
): WorldTime | null {
  const told = eventTime(cal, now, {
    rhythm: 'once',
    weekday: '',
    day: given.day ?? 0,
    month: given.month ?? '',
    year: given.year ?? 0,
  });
  if (told) return told.at;
  for (const sentence of sentences) {
    const found = findDates(cal, sentence, now).find(
      (date) =>
        date.precision !== 'year' &&
        date.time <= now &&
        !DEADLINE_BEFORE.test(sentence.slice(0, date.from)),
    );
    if (found) return found.time;
  }
  return null;
}

/** Ob ein Vorschlag eine Abmachung wird (und damit in die Chronik kommt). */
export function isPromiseHint(hint: AiHint): boolean {
  if (hint.kind !== 'thread') return false;
  const payload = hint.payload as { text?: unknown; sort?: unknown };
  return (
    threadSort(typeof payload.text === 'string' ? payload.text : hint.line, payload.sort) ===
    'promise'
  );
}

/**
 * Der Tag, den ein Vorschlag für eine Abmachung kennt. Ältere Vorschläge haben keinen
 * gespeichert – dann wird der zitierte Satz gelesen.
 */
export function hintPromiseDate(
  data: Pick<CampaignData, 'campaign' | 'state'>,
  hint: AiHint,
): WorldTime | null {
  const at = hint.payload.at;
  if (typeof at === 'number') return at;
  if (at === null) return null;
  const text = typeof hint.payload.text === 'string' ? hint.payload.text : hint.line;
  return promiseDate(data.campaign.calendar, data.state.now, {}, [hint.quote, text]);
}

/**
 * Beginn der Mitschrift: der erste Spielabend oder das Früheste, was an einem Abend festgehalten
 * wurde. Gibt es noch keinen Abend, das Früheste der Chronik – und ohne alles: jetzt.
 */
export function recordStart(
  data: Pick<CampaignData, 'state' | 'sessions' | 'chronicle'>,
): WorldTime {
  const entries = Object.values(data.chronicle);
  const played = [
    ...Object.values(data.sessions).map((session) => session.startAt),
    ...entries.filter((entry) => entry.sessionId !== null).map((entry) => entry.at),
  ];
  const times = played.length ? played : entries.map((entry) => entry.at);
  return Math.min(data.state.now, ...times);
}

export interface PromiseWhen {
  /** Weltzeit des Eintrags in der Chronik. */
  at: WorldTime;
  /** Der Abend, zu dem der Eintrag gehört – nur, wenn es an einem Abend geschah. */
  sessionId: string | null;
  /**
   * dated = am genannten Tag; later = genannt war ein Tag nach heute, eingetragen wird heute;
   * undated = kein Tag bekannt, der Eintrag steht vor dem Beginn der Mitschrift.
   */
  how: 'dated' | 'later' | 'undated';
  /** „am 3. Tauwind 701 AD“ – so steht es hinter dem Vorschlag. */
  text: string;
}

/**
 * Wohin eine Abmachung in der Chronik kommt. Nie in die Zukunft und nie „jetzt“, nur weil der
 * Tag unbekannt ist: Ohne Tag steht sie vor dem Beginn der Mitschrift, an keinem Abend. Mit Tag
 * gehört sie zu dem Abend, in dessen Weltzeit er fällt – wie beim Nachtragen in der Chronik.
 */
export function promiseWhen(data: CampaignData, date: WorldTime | null): PromiseWhen {
  const cal = data.campaign.calendar;
  const now = data.state.now;
  if (date === null)
    return {
      at: Math.max(0, recordStart(data) - 1),
      sessionId: null,
      how: 'undated',
      text: 'vor Beginn der Mitschrift',
    };
  const later = date > now;
  const at = later ? now : date;
  return {
    at,
    // Auf heute geholt, weil der genannte Tag nach heute liegt: geschehen ist sie trotzdem nicht
    // am laufenden Abend.
    sessionId: later ? null : (sessionAt(data, at)?.id ?? null),
    how: later ? 'later' : 'dated',
    text: later
      ? `am ${formatDate(cal, at)} (genannt ist der ${formatDate(cal, date)} – das liegt nach heute)`
      : `am ${formatDate(cal, at)}`,
  };
}

export interface Suggestions {
  hints: AiHint[];
  /** Angaben, die sich nicht eintragen lassen – mit dem Grund. */
  skipped: string[];
}

/**
 * Macht aus dem Gelesenen Vorschläge: Namen werden zu Einträgen der Welt, Zeiten zu Daten im
 * Kalender. Was es schon gibt oder schon vorgeschlagen ist, fällt weg.
 */
export function suggest(data: CampaignData, article: Article, reading: Reading): Suggestions {
  const index = worldIndex(data);
  const cal = data.campaign.calendar;
  const hints: AiHint[] = [];
  const skipped: string[] = [];
  const known = new Set(article.aiHints.map((hint) => hint.key));
  const seen = new Set<string>();
  const add = (hint: Omit<AiHint, 'id' | 'state'>) => {
    if (known.has(hint.key) || seen.has(hint.key)) return;
    seen.add(hint.key);
    hints.push({ ...hint, id: newId(), state: 'open' });
  };
  const refsOf = (list: readonly string[]) => [
    ...new Set(
      list
        .map((name) => findEntity(index, name))
        .filter((entity): entity is Entity => entity !== null && entity.kind !== 'place')
        .map((entity) => entity.id),
    ),
  ];
  const quote = (text: string) => text.trim().slice(0, 240);

  const titles = new Set(Object.values(data.events).map((event) => normalize(event.title)));
  for (const event of reading.events) {
    const title = event.title.trim();
    if (!title) continue;
    const time = eventTime(cal, data.state.now, event);
    if (!time) {
      skipped.push(`„${title}“: Aus dem Text ergibt sich kein Datum.`);
      continue;
    }
    // Vergangenes kommt nur mit seinem eigenen Datum in den Kalender – nie als „ab heute“.
    if (event.past && (time.repeat !== null || time.at > data.state.now)) {
      skipped.push(`„${title}“: Das ist schon geschehen und hat kein genaues Datum.`);
      continue;
    }
    if (titles.has(normalize(title))) continue;
    const place = findEntity(index, event.place, ['place']);
    const draft: EventDraft = {
      title,
      at: time.at,
      timed: false,
      kind: 'world',
      details: `Aus dem Artikel „${article.title}“.`,
      placeId: place?.id ?? null,
      refs: refsOf(event.who),
      repeat: time.repeat,
      // Ein einmaliges Ereignis in der Vergangenheit ist längst eingetreten.
      done: time.repeat === null && time.at <= data.state.now,
    };
    const when =
      event.rhythm === 'weekly'
        ? `jeden ${event.weekday}`
        : event.rhythm === 'once'
          ? `am ${formatDate(cal, time.at)}`
          : `${RHYTHM_WORD[event.rhythm]}, das nächste Mal am ${formatDate(cal, time.at)}`;
    add({
      key: `event:${normalize(title)}`,
      kind: 'event',
      line: `${title} – ${when}${place ? `, in ${place.name}` : ''}`,
      quote: quote(event.quote),
      payload: draft,
    });
  }

  for (const relation of reading.relations) {
    const from = findEntity(index, relation.from);
    const to = findEntity(index, relation.to);
    if (!from || !to) {
      const missing = [!from && relation.from, !to && relation.to].filter(Boolean).join(' und ');
      skipped.push(`Beziehung: „${missing}“ kennt die Welt nicht (oder nicht eindeutig).`);
      continue;
    }
    if (from.id === to.id) continue;
    const type = relationType(relation.kind);
    if (type.key === 'custom') continue;
    const exists = Object.values(data.relations).some(
      (entry) =>
        entry.type === type.key &&
        ((entry.from === from.id && entry.to === to.id) ||
          (type.label === type.inverse && entry.from === to.id && entry.to === from.id)),
    );
    if (exists) continue;
    add({
      key: `relation:${from.id}>${type.key}>${to.id}`,
      kind: 'relation',
      line: `${from.name} ${type.label} ${to.name}`,
      quote: quote(relation.quote),
      payload: { from: from.id, to: to.id, type: type.key },
    });
  }

  const open = new Set(
    Object.values(data.chronicle)
      .filter((entry) => entry.kind === 'promise')
      .map((entry) => normalize(entry.text)),
  );
  // Der Eintrag der Welt, den dieser Artikel beschreibt – dorthin gehört ein Geheimnis im Zweifel.
  const owner = Object.values(data.entities).find((entity) => entity.lk?.resourceId === article.id);
  const leads = new Set(Object.values(data.threads).map((entry) => normalize(entry.title)));
  for (const thread of reading.threads) {
    const text = thread.text.trim();
    if (!text || open.has(normalize(text)) || leads.has(normalize(text))) continue;
    const place = findEntity(index, thread.place, ['place']);
    const sort = threadSort(text, thread.sort);
    const refs = refsOf(thread.who);
    // Ein Geheimnis braucht jemanden, bei dem es steht.
    const holder = refs[0] ?? owner?.id ?? null;
    if (sort === 'secret' && !holder) {
      skipped.push(`„${text}“: Dazu gibt es in der Welt niemanden, bei dem es stehen könnte.`);
      continue;
    }
    add({
      key: `thread:${normalize(text).slice(0, 80)}`,
      kind: 'thread',
      line: text,
      quote: quote(thread.quote),
      payload: {
        text,
        sort,
        refs: sort === 'secret' && !refs.length && holder ? [holder] : refs,
        placeId: place?.id ?? null,
        // Wann eine Abmachung getroffen wurde – Geheimnisse und Spuren haben kein Datum.
        at:
          sort === 'promise'
            ? promiseDate(cal, data.state.now, thread, [thread.quote, text])
            : null,
      },
    });
  }
  return { hints, skipped };
}
