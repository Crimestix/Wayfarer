/**
 * Notizen in Sessions trennen. Grenzen sind Zeilen wie „Session 5“, „Sitzung 5“, „S5“,
 * „Spielabend 5“, „#5“, „5. Session“ oder ein echtes Datum („12.04.2026“, „12. April 2026“,
 * „2026-04-12“) – auch zusammen: „Session 5 – Krummzahns Bau (07.06.2026)“. Was vor der ersten
 * Grenze steht, wird ein Vorspann, den der Spielleiter an die erste Session hängen kann.
 *
 * Die Notizen bleiben wörtlich; getrennt wird nur. Was geraten ist, steht in `notes`.
 */
import type { CalendarDef, WorldTime } from '../../domain/time/calendar';
import { findDates, type TextDate } from '../../domain/time/textDates';
import type { NotesFile } from './read';

/** Wo ein Entwurf in seiner Datei steht. Offsets sind Zeichen im Text der Datei. */
export interface DraftSource {
  file: string;
  /** Stelle der Datei in der Liste, die `splitSessions` bekam. */
  fileIndex: number;
  /** Beginn der Überschrift (oder des Textes, wenn es keine gibt). */
  from: number;
  /** Ende des Abschnitts (ausschließlich) – Beginn der nächsten Grenze. */
  to: number;
  /** Wo `text` in der Datei beginnt (nach dem Zusammenlegen ungefähr). */
  textFrom: number;
  /** Zeile der Überschrift, 1-basiert – für die Anzeige. */
  line: number;
}

/** Ein Tag des Kalenders im Entwurf: `from`/`to` zählen in `heading` oder in `text`. */
export interface DraftDate extends TextDate {
  where: 'heading' | 'text';
}

export interface SessionDraft {
  /** Feste Kennung für die Oberfläche: `<fileIndex>:<from>`. */
  key: string;
  number: number | null;
  /**
   * Letzte Nummer, wenn ein Abschnitt mehrere Abende umfasst („Session 3+4“, „Session 5-6“);
   * sonst `null`.
   */
  lastNumber: number | null;
  /** Titel aus der Überschrift, ohne Nummer und Datum; '' = ohne Titel. */
  title: string;
  /** Echtes Datum des Spielabends, JJJJ-MM-TT, oder ''. */
  realDate: string;
  /** Die Zeile(n) der Grenze, wörtlich; '' beim Vorspann und bei Dateien ohne Grenze. */
  heading: string;
  /** Die Notizen, wörtlich, vorne und hinten ohne Leerraum. */
  text: string;
  source: DraftSource;
  /** Tage des Kalenders in Überschrift und Text. */
  worldDates: DraftDate[];
  /** Was geraten ist oder auffällt, als deutsche Sätze. */
  notes: string[];
  /** Text vor der ersten Grenze einer Datei. */
  vorspann: boolean;
}

// ── Eine Zeile lesen ───────────────────────────────────────────────────────

/** Was eine Zeile als Grenze sagt. */
export interface LineMark {
  number: number | null;
  /** Letzte Nummer bei „Session 3+4“, sonst `null`. */
  lastNumber: number | null;
  realDate: string;
  /** Datum ohne Jahr („24.05.“) als MM-TT, wenn `realDate` fehlt; sonst ''. */
  dayMonth: string;
  title: string;
  /**
   * Woran die Grenze erkannt ist: Stichwort mit Nummer, echtes Datum oder – nur in einer
   * Überschrift der Datei – eine nackte Nummer („## 5 – Titel“). Nackte Nummern zählen nur,
   * wenn eine Datei keine anderen Grenzen hat.
   */
  kind: 'keyword' | 'date' | 'bare';
}

/** Stichwörter einer Grenze – samt häufiger Tippfehler („Sesion“, „Sesson“, „Sitzng“). */
const KEYWORDS =
  'se{1,2}s{1,3}i?o?n|sessoin|sitzung|sitzng|sizung|spielsitzung|spielabend|spieltag|abend|episode|folge|sess\\.';
/** Stichwörter, die auch im Fließtext mit einer Zahl stehen („Abend 3 Goblins …“). */
const AMBIGUOUS = /^(?:abend|folge)$/iu;
const MONTHS: Record<string, number> = {
  januar: 1,
  jänner: 1,
  jan: 1,
  februar: 2,
  feber: 2,
  feb: 2,
  märz: 3,
  maerz: 3,
  mär: 3,
  mrz: 3,
  april: 4,
  apr: 4,
  mai: 5,
  juni: 6,
  jun: 6,
  juli: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sept: 9,
  sep: 9,
  oktober: 10,
  okt: 10,
  november: 11,
  nov: 11,
  dezember: 12,
  dez: 12,
};
const MONTH_NAMES = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|');
const WEEKDAYS =
  'montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag|mo|di|mi|do|fr|sa|so';

/** Echte Daten: 12.04.2026, 12.4.26, 12. April 2026, 12. Apr. 2026, 2026-04-12. */
const REAL_DATE = new RegExp(
  [
    `(?<d1>\\d{1,2})\\.\\s?(?<m1>\\d{1,2})\\.\\s?(?<y1>\\d{4}|\\d{2})(?!\\d)`,
    `(?<d2>\\d{1,2})\\.\\s?(?<m2>${MONTH_NAMES})\\.?\\s+(?<y2>\\d{4})(?!\\d)`,
    `(?<y3>\\d{4})-(?<m3>\\d{2})-(?<d3>\\d{2})(?!\\d)`,
  ].join('|'),
  'giu',
);

const pad = (value: number) => String(value).padStart(2, '0');

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > length) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

interface RealDateMatch {
  from: number;
  to: number;
  iso: string;
}

/** Alle gültigen echten Daten in einem Text. */
export function findRealDates(text: string): RealDateMatch[] {
  const out: RealDateMatch[] = [];
  for (const match of text.matchAll(REAL_DATE)) {
    if (match.index > 0 && /[\p{L}\p{N}]/u.test(text[match.index - 1]!)) continue;
    const g = match.groups ?? {};
    let iso: string | null = null;
    if (g.d1 !== undefined) {
      const short = g.y1!.length === 2;
      const year = short ? 2000 + Number(g.y1) : Number(g.y1);
      iso = isoDate(year, Number(g.m1), Number(g.d1));
    } else if (g.d2 !== undefined) {
      iso = isoDate(Number(g.y2), MONTHS[g.m2!.toLowerCase()] ?? 0, Number(g.d2));
    } else if (g.y3 !== undefined) {
      iso = isoDate(Number(g.y3), Number(g.m3), Number(g.d3));
    }
    if (iso) out.push({ from: match.index, to: match.index + match[0].length, iso });
  }
  return out;
}

/** Markdown-Zeichen und Hervorhebung um eine Zeile entfernen. */
function bare(line: string): string {
  let s = line.trim();
  s = s.replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '');
  for (;;) {
    const wrapped = /^(\*\*|__|\*|_|~~)(.+)\1$/.exec(s);
    if (!wrapped) break;
    s = wrapped[2]!.trim();
  }
  return s.replace(/^(\*\*|__)(.+?)\1(?=\s|[-–—:]|$)/, '$2').trim();
}

const SEPARATORS = /^[\s\-–—:.,;|/·•+&]+|[\s\-–—:.,;|/·•+&]+$/g;
/** Wörter, die vor einem Datum standen („gespielt am“, „vom“) – ohne Datum bleiben sie übrig. */
const DATE_WORDS = /(?:^|[\s,;(])(?:gespielt(?:\s+am)?|am|vom|datum:?)$/iu;

/** Titel aufräumen: Trennzeichen, leere Klammern und Anführungszeichen weg. */
function cleanTitle(value: string): string {
  let s = value;
  for (let round = 0; round < 4; round++) {
    const before = s;
    s = s
      .replace(/\(\s*\)|\[\s*\]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(SEPARATORS, '');
    const quoted = /^[„"“”'‚‘«»](.*)[“”"'‘’«»]$/.exec(s);
    if (quoted) s = quoted[1]!.trim();
    if (s === before) break;
  }
  return s.trim();
}

/** Tage des Kalenders aus einem Titel nehmen („Krummzahns Bau (17. Tauwind)“). */
type WorldDateStrip = (title: string) => string;

const WEEKDAY_BEFORE = new RegExp(`(?:^|[\\s(,])(?:${WEEKDAYS})\\.?,?\\s*$`, 'iu');

/** Rest hinter Nummer oder Datum: Datum (samt Wochentag davor) herausnehmen, Titel übrig. */
function restOf(
  rest: string,
  strip: WorldDateStrip | null,
): { title: string; realDate: string; dayMonth: string } {
  let realDate = '';
  let dayMonth = '';
  let s = rest;
  const cut = (date: { from: number; to: number }) => {
    let from = date.from;
    const weekday = WEEKDAY_BEFORE.exec(s.slice(0, from));
    if (weekday) from = weekday.index + (/^[\s(,]/.test(weekday[0]) ? 1 : 0);
    s = `${s.slice(0, from)} ${s.slice(date.to)}`;
  };
  const dates = findRealDates(s);
  if (dates[0]) realDate = dates[0].iso;
  for (const date of [...dates].reverse()) cut(date);
  // Kalendertage („17. Tauwind“) zuerst heraus – sonst sähe „17.“ wie ein halbes Datum aus.
  if (strip) s = strip(s);
  const partial = findDayMonths(s);
  if (!realDate && partial[0]) dayMonth = partial[0].dayMonth;
  for (const date of [...partial].reverse()) cut(date);
  let title = cleanTitle(s);
  // „Sitzung 3, gespielt am 10.05.2026“: was zum Datum gehörte, ist kein Titel.
  if (dates.length || partial.length) title = cleanTitle(title.replace(DATE_WORDS, ''));
  return { title, realDate, dayMonth };
}

/** Daten ohne Jahr: „24.05.“, „6.7.“. */
const DAY_MONTH = /(?<![\p{L}\p{N}.])(\d{1,2})\.(\d{1,2})\.(?!\s?\p{N})/gu;

/** Daten ohne Jahr in einem Text, als MM-TT. */
function findDayMonths(text: string): { from: number; to: number; dayMonth: string }[] {
  const out: { from: number; to: number; dayMonth: string }[] = [];
  for (const match of text.matchAll(DAY_MONTH)) {
    // Ein Schaltjahr, damit auch der 29.02. gilt.
    const iso = isoDate(2024, Number(match[2]), Number(match[1]));
    if (iso) {
      out.push({ from: match.index, to: match.index + match[0].length, dayMonth: iso.slice(5) });
    }
  }
  return out;
}

/** Spielabende liegen in diesem Jahrhundert – ältere Daten sind Geburtstage und Ähnliches. */
const plausibleYear = (iso: string) => iso >= '2000' && iso < '2100';
/** Ein Datum mit diesen Wörtern ist kein Spielabend. */
const NOT_A_SESSION = /geburtstag|geboren|\bgeb\./iu;

/** Beginnt der Rest wie ein Satz („Session 5 war super“)? Dann ist es keine Überschrift. */
const readsLikeSentence = (rest: string) => /^\s+\p{Ll}/u.test(rest);
/** Hinter der Nummer muss etwas Trennendes kommen, nicht „Session 5er“. */
const cleanBreak = (rest: string) => rest === '' || /^[\s\-–—:.,;|/()[\]]/.test(rest);

/** Zeilen über dieser Länge sind Fließtext, außer die Datei zeichnet sie als Überschrift aus. */
const MAX_HEADING_LENGTH = 100;

/**
 * Liest eine Zeile als Grenze. `formatHeading`: die Datei zeichnet sie als Überschrift aus –
 * dann gelten auch „## 5 – Titel“ und lange Zeilen. `null`, wenn die Zeile keine Grenze ist.
 */
export function readBoundary(
  line: string,
  formatHeading = false,
  strip: WorldDateStrip | null = null,
): LineMark | null {
  const raw = line.trim();
  if (!raw) return null;
  if (!formatHeading && raw.length > MAX_HEADING_LENGTH) return null;
  const withNumber = (digits: string, ambiguous = false): LineMark | null => {
    const range = numberRange(digits);
    if (!range) return null;
    const { number, lastNumber, rest } = range;
    if (!cleanBreak(rest)) return null;
    if (!formatHeading && readsLikeSentence(rest)) return null;
    // „Abend 3 Goblins greifen an“: hinter solchen Wörtern muss etwas Trennendes folgen.
    if (ambiguous && !formatHeading && !/^\s*(?:[-–—:|/([]|$)/.test(rest)) return null;
    return { number, lastNumber, ...restOf(rest, strip), kind: 'keyword' };
  };
  // „#5“ ohne Leerzeichen – „# 5“ wäre eine Markdown-Überschrift.
  const hash = /^#(\d{1,3}(?!\d).*)$/.exec(raw);
  if (hash) return withNumber(hash[1]!);
  const s = bare(raw);
  const keyword = new RegExp(
    `^(${KEYWORDS})\\s*:?\\s*(?:nr\\.?|nummer|no\\.?|#)?\\s*[-_]?\\s*(\\d{1,3}(?!\\d).*)$`,
    'iu',
  ).exec(s);
  if (keyword && !/^\d+[.,]\d/.test(keyword[2]!)) {
    return withNumber(keyword[2]!, AMBIGUOUS.test(keyword[1]!));
  }
  const ordinal = new RegExp(`^(\\d{1,3})\\.\\s*(${KEYWORDS})(?![\\p{L}])(.*)$`, 'iu').exec(s);
  if (ordinal) return withNumber(`${ordinal[1]}${ordinal[3]}`, AMBIGUOUS.test(ordinal[2]!));
  const short = /^S\s?(\d{1,3}(?![\d\p{L}]).*)$/u.exec(s);
  if (short) return withNumber(short[1]!);
  const dated = new RegExp(`^(?:${KEYWORDS})\\s+(?:(?:vom|am)\\s+)?(.*)$`, 'iu').exec(s);
  const datePart = dated
    ? dated[1]!
    : s.replace(new RegExp(`^(?:${WEEKDAYS})\\.?,?\\s+`, 'iu'), '');
  const first = findRealDates(datePart)[0];
  if (first && first.from === 0) {
    const rest = datePart.slice(first.to);
    if (!formatHeading && readsLikeSentence(rest)) return null;
    if (!plausibleYear(first.iso) || NOT_A_SESSION.test(rest)) return null;
    const { title } = restOf(rest, strip);
    return { ...NO_NUMBER, realDate: first.iso, title, kind: 'date' };
  }
  // „24.05.“ allein, „Sitzung vom 24.05.“ oder „24.05. – Salzgrotte“: Datum ohne Jahr.
  const partial = findDayMonths(datePart)[0];
  if (partial && partial.from === 0) {
    const rest = datePart.slice(partial.to);
    if (/^\s*:?\s*$/.test(rest) || (/^\s*[-–—|(]/.test(rest) && !NOT_A_SESSION.test(rest))) {
      const { title } = restOf(rest, strip);
      return { ...NO_NUMBER, dayMonth: partial.dayMonth, title, kind: 'date' };
    }
  }
  if (formatHeading) {
    // „## 5 – Krummzahns Bau“: eine nackte Nummer, nur in einer Überschrift.
    const numbered = /^(\d{1,3})(?:\.(?!\d)|\s*[-–—:)]|\s+(?=\S))(.*)$/.exec(s);
    if (numbered) {
      const rest = restOf(numbered[2]!, strip);
      return { ...NO_NUMBER, number: Number(numbered[1]), ...rest, kind: 'bare' };
    }
  }
  return null;
}

const NO_NUMBER = { number: null, lastNumber: null, realDate: '', dayMonth: '' } as const;

/** Mehrere Abende in einem Abschnitt: „3+4“, „3 & 4“, „3/4“, „3 und 4“, „3 bis 4“, „5-6“. */
const RANGE = /^(\d{1,3})(?:(\s*(?:\+|&|\/|und|bis)\s*|[-–])(\d{1,3})(?![\d.]))?(?!\d)(.*)$/iu;
/** Mehr Abende in einem Abschnitt sind eher ein Tippfehler oder etwas anderes. */
const MAX_RANGE = 4;

/** Nummer (und letzte Nummer) am Anfang von `digits`, dahinter der Rest. */
function numberRange(
  digits: string,
): { number: number; lastNumber: number | null; rest: string } | null {
  const match = RANGE.exec(digits);
  if (!match) return null;
  const number = Number(match[1]);
  if (match[3] === undefined) return { number, lastNumber: null, rest: match[4]! };
  const last = Number(match[3]);
  if (last > number && last - number <= MAX_RANGE) {
    return { number, lastNumber: last, rest: match[4]! };
  }
  return { number, lastNumber: null, rest: `${match[2]}${match[3]}${match[4]}` };
}

// ── Trennen ────────────────────────────────────────────────────────────────

const VORSPANN_NOTE =
  'Text vor der ersten Session. Gehört er zu ihr, lege ihn mit ihr zusammen – sonst bleibt er hier.';
/** Beginn der Meldung über doppelte Nummern – wird bei jeder Prüfung neu gesetzt. */
const DUPLICATE_PREFIX = 'Doppelt: ';
const ASSUMED_PREFIX = 'Ohne Jahr geschrieben: ';
/** Ende der Meldung über mehrere Abende in einem Abschnitt – `splitAt` nimmt sie weg. */
export const RANGE_NOTE_END = 'in einem Abschnitt. Weißt du, wo ein Abend endet, trenne sie dort.';

interface Boundary {
  /** Erste und letzte Zeile der Grenze (mehrere, wenn z. B. das Datum in der Zeile darunter steht). */
  first: number;
  last: number;
  mark: LineMark;
}

const compatible = (a: LineMark, b: LineMark) =>
  !(a.number !== null && b.number !== null) &&
  !(a.realDate && b.realDate && a.realDate !== b.realDate) &&
  !(a.dayMonth && b.dayMonth && a.dayMonth !== b.dayMonth);

function combine(a: LineMark, b: LineMark): LineMark {
  const realDate = a.realDate || b.realDate;
  return {
    number: a.number ?? b.number,
    lastNumber: a.number !== null ? a.lastNumber : b.lastNumber,
    realDate,
    dayMonth: realDate ? '' : a.dayMonth || b.dayMonth,
    title: a.title && b.title ? `${a.title} – ${b.title}` : a.title || b.title,
    kind: a.kind,
  };
}

const EMPTY_MARK: LineMark = { ...NO_NUMBER, title: '', kind: 'bare' };

const baseName = (name: string) => (name.split(/[\\/]/).pop() ?? name).replace(/\.[^.]*$/, '');

interface FileContext {
  file: NotesFile;
  fileIndex: number;
  cal: CalendarDef;
  now: WorldTime;
  strip: WorldDateStrip;
}

function worldDatesOf(ctx: FileContext, heading: string, text: string): DraftDate[] {
  return [
    ...findDates(ctx.cal, heading, ctx.now).map((d) => ({ ...d, where: 'heading' as const })),
    ...findDates(ctx.cal, text, ctx.now).map((d) => ({ ...d, where: 'text' as const })),
  ];
}

function assumedNote(dates: DraftDate[], heading: string, text: string): string[] {
  const assumed = dates.filter((d) => d.assumedYear);
  if (!assumed.length) return [];
  const shown = assumed
    .slice(0, 3)
    .map((d) => `„${(d.where === 'heading' ? heading : text).slice(d.from, d.to)}“`)
    .join(', ');
  return [`${ASSUMED_PREFIX}${shown} – als laufendes Jahr der Welt gelesen.`];
}

/** Was vor dem Datum unter einer Überschrift stehen darf („gespielt am“, „Datum:“, „Sa,“). */
const DATE_PREFIX = new RegExp(
  `^[(\\[]?\\s*(?:(?:gespielt|spieldatum|datum|spieltermin|termin|am|vom|irl|real)(?![\\p{L}])\\s*:?\\s*)*(?:(?:${WEEKDAYS})\\.?,?\\s+)?`,
  'iu',
);
/** So viel darf hinter dem Datum noch stehen („(bei Tobi)“), damit es die Zeile des Datums ist. */
const DATE_LINE_TAIL = 30;

/**
 * Datum in den ersten Zeilen unter der Überschrift („gespielt am 12.04.2026“) – nur, wenn die
 * Zeile das Datum ist, nicht ein Satz mit einem Datum („Lando hat am 03.05.1987 Geburtstag“).
 */
function dateBelow(text: string): string {
  const lines = text
    .split('\n')
    .filter((line) => line.trim() && !RULE.test(line))
    .slice(0, 2);
  for (const line of lines) {
    const rest = bare(line).replace(DATE_PREFIX, '');
    const date = findRealDates(rest)[0];
    if (!date || date.from !== 0 || rest.length - date.to > DATE_LINE_TAIL) continue;
    if (plausibleYear(date.iso) && !NOT_A_SESSION.test(rest)) return date.iso;
  }
  return '';
}

/** Eine Trennlinie aus Zeichen: „=====“, „-----“, „*****“. */
const RULE = /^\s*[=\-_*~#+.•·–—]{3,}\s*$/u;

/** Trennlinien und Leerraum am Ende eines Abschnitts gehören nicht zu den Notizen. */
function trimRules(text: string): string {
  const lines = text.trimEnd().split('\n');
  while (lines.length && (RULE.test(lines[lines.length - 1]!) || !lines[lines.length - 1]!.trim()))
    lines.pop();
  return lines.join('\n');
}

const dayMonthShown = (dayMonth: string) => `${dayMonth.slice(3)}.${dayMonth.slice(0, 2)}.`;

/** Fehlt das Jahr („24.05.“), nimmt es Wayfarer vom Abend davor (oder danach) in der Datei. */
function completeYears(drafts: SessionDraft[], pending: Map<SessionDraft, string>): void {
  drafts.forEach((draft, index) => {
    const dayMonth = pending.get(draft);
    if (!dayMonth || draft.realDate) return;
    const before = drafts
      .slice(0, index)
      .reverse()
      .find((d) => d.realDate);
    const after = drafts.slice(index + 1).find((d) => d.realDate);
    let iso = '';
    if (before) {
      const year = Number(before.realDate.slice(0, 4));
      iso =
        `${year}-${dayMonth}` < before.realDate ? `${year + 1}-${dayMonth}` : `${year}-${dayMonth}`;
    } else if (after) {
      const year = Number(after.realDate.slice(0, 4));
      iso =
        `${year}-${dayMonth}` > after.realDate ? `${year - 1}-${dayMonth}` : `${year}-${dayMonth}`;
    }
    const [y, m, d] = iso.split('-').map(Number);
    const valid = iso && isoDate(y!, m!, d!) ? iso : '';
    draft.realDate = valid;
    draft.notes.push(
      valid
        ? `Datum ohne Jahr („${dayMonthShown(dayMonth)}“) – das Jahr ${valid.slice(0, 4)} von den Abenden daneben genommen.`
        : `Datum ohne Jahr („${dayMonthShown(dayMonth)}“) – das Jahr fehlt.`,
    );
  });
}

function boundariesOf(
  ctx: FileContext,
  lines: string[],
): { list: Boundary[]; byHeadings: boolean } {
  const headingLevel = new Map(ctx.file.headings.map((h) => [h.line, h.level]));
  let list: Boundary[] = [];
  lines.forEach((line, index) => {
    const mark = readBoundary(line, headingLevel.has(index), ctx.strip);
    if (mark) list.push({ first: index, last: index, mark });
  });
  if (list.some((b) => b.mark.kind !== 'bare')) list = list.filter((b) => b.mark.kind !== 'bare');
  if (list.length) return { list: mergeAdjacent(list, lines), byHeadings: false };
  // Keine Nummer, kein Datum: an Überschriften der Datei trennen – der obersten Ebene, die
  // mehr als einmal vorkommt (eine einzelne oberste ist meist der Titel des Dokuments).
  const counts = new Map<number, number>();
  for (const h of ctx.file.headings) counts.set(h.level, (counts.get(h.level) ?? 0) + 1);
  const level = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort(([a], [b]) => a - b)[0]?.[0];
  if (level === undefined) return { list: [], byHeadings: false };
  const byHeadings = ctx.file.headings
    .filter((h) => h.level === level)
    .map((h) => ({
      first: h.line,
      last: h.line,
      mark: {
        ...EMPTY_MARK,
        title: cleanTitle(ctx.strip(bare(lines[h.line] ?? ''))),
      },
    }));
  return { list: byHeadings, byHeadings: true };
}

/** Zwei Grenzen ohne Text dazwischen („Session 5“, darunter „07.06.2026“) sind eine. */
function mergeAdjacent(list: Boundary[], lines: string[]): Boundary[] {
  const out: Boundary[] = [];
  for (const boundary of list) {
    const previous = out[out.length - 1];
    const between = previous ? lines.slice(previous.last + 1, boundary.first) : [];
    if (
      previous &&
      between.every((line) => !line.trim()) &&
      compatible(previous.mark, boundary.mark)
    ) {
      previous.last = boundary.last;
      previous.mark = combine(previous.mark, boundary.mark);
    } else {
      out.push({ ...boundary });
    }
  }
  return out;
}

function draftsOfFile(ctx: FileContext): SessionDraft[] {
  const { file, fileIndex } = ctx;
  const text = file.text;
  const lines = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const lineStart = (index: number) => (index < lines.length ? starts[index]! : text.length);
  const lineEnd = (index: number) => Math.min(text.length, lineStart(index) + lines[index]!.length);

  const make = (
    from: number,
    to: number,
    headingTo: number,
    mark: LineMark,
    line: number,
    extra: Partial<SessionDraft> = {},
  ): SessionDraft => {
    const heading = text.slice(from, headingTo).trim();
    const body = text.slice(headingTo, to);
    const lead = body.length - body.trimStart().length;
    const trimmed = trimRules(body).trim();
    const worldDates = worldDatesOf(ctx, heading, trimmed);
    const notes: string[] = [];
    let realDate = mark.realDate;
    if (!realDate && heading) {
      realDate = dateBelow(trimmed);
      if (realDate)
        notes.push('Datum des Spielabends aus der Zeile unter der Überschrift gelesen.');
    }
    if (!trimmed) notes.push('Unter dieser Überschrift stehen keine Notizen.');
    if (mark.number !== null && mark.lastNumber !== null) {
      const sessions =
        mark.lastNumber === mark.number + 1
          ? `Session ${mark.number} und ${mark.lastNumber} stehen`
          : `Die Sessions ${mark.number} bis ${mark.lastNumber} stehen`;
      notes.push(`${sessions} ${RANGE_NOTE_END}`);
    }
    notes.push(...assumedNote(worldDates, heading, trimmed));
    return {
      key: `${fileIndex}:${from}`,
      number: mark.number,
      lastNumber: mark.lastNumber,
      title: mark.title,
      realDate,
      heading,
      text: trimmed,
      source: { file: file.name, fileIndex, from, to, textFrom: headingTo + lead, line: line + 1 },
      worldDates,
      notes,
      vorspann: false,
      ...extra,
    };
  };

  const { list, byHeadings } = boundariesOf(ctx, lines);
  // Trennlinien direkt über und unter der Grenze gehören zu ihr („=====“, setext „-----“).
  list.forEach((boundary, index) => {
    const floor = index > 0 ? list[index - 1]!.last + 1 : 0;
    while (boundary.first > floor && RULE.test(lines[boundary.first - 1]!)) boundary.first--;
    const ceiling = list[index + 1]?.first ?? lines.length;
    while (boundary.last + 1 < ceiling && RULE.test(lines[boundary.last + 1]!)) boundary.last++;
  });
  if (!list.length) {
    if (!text.trim()) return [];
    // Eine Datei, eine Session: Nummer, Datum und Titel vielleicht aus dem Dateinamen.
    const name = baseName(file.name).replace(/_/g, ' ');
    const fromName = readBoundary(name, true, ctx.strip);
    const draft = make(0, text.length, 0, fromName ?? EMPTY_MARK, 0);
    draft.notes.unshift(
      'Keine Überschrift wie „Session 5“ gefunden – die ganze Datei als eine Session gelesen.',
    );
    if (fromName?.number != null) draft.notes.push('Nummer aus dem Dateinamen gelesen.');
    if (fromName?.realDate) draft.notes.push('Datum des Spielabends aus dem Dateinamen gelesen.');
    return [draft];
  }

  const drafts: SessionDraft[] = [];
  const firstStart = lineStart(list[0]!.first);
  const before = text.slice(0, firstStart);
  const headingLines = new Set(file.headings.map((h) => h.line));
  const beforeLines = lines.slice(0, list[0]!.first);
  const onlyTitle = beforeLines.every(
    (line, index) => !line.trim() || RULE.test(line) || headingLines.has(index),
  );
  if (before.trim() && !onlyTitle) {
    const vorspann = make(0, firstStart, 0, { ...EMPTY_MARK, title: 'Vorspann' }, 0, {
      vorspann: true,
    });
    vorspann.notes.unshift(VORSPANN_NOTE);
    drafts.push(vorspann);
  }
  const pending = new Map<SessionDraft, string>();
  list.forEach((boundary, index) => {
    const next = list[index + 1];
    const from = lineStart(boundary.first);
    const to = next ? lineStart(next.first) : text.length;
    const draft = make(from, to, lineEnd(boundary.last), boundary.mark, boundary.first);
    if (byHeadings)
      draft.notes.unshift('An Überschriften getrennt – keine Nummer und kein Datum gefunden.');
    if (boundary.mark.dayMonth) pending.set(draft, boundary.mark.dayMonth);
    drafts.push(draft);
  });
  completeYears(drafts, pending);
  return drafts;
}

// ── Reihenfolge und Doppelte ───────────────────────────────────────────────

/** Position im Spiel: Nummer; ohne Nummer aus Datum oder Nachbarn in der Datei. */
function orderKeys(drafts: SessionDraft[]): number[] {
  const keys: (number | null)[] = drafts.map((d) => d.number);
  const anyNumber = keys.some((k) => k !== null);
  const numberedDates = drafts
    .filter((d) => d.number !== null && d.realDate)
    .map((d) => ({ date: d.realDate, number: d.number! }));
  if (!anyNumber) {
    // Keine Nummern: echte Daten geben die Reihenfolge.
    const dates = [...new Set(drafts.map((d) => d.realDate).filter(Boolean))].sort();
    drafts.forEach((d, i) => {
      if (d.realDate) keys[i] = dates.indexOf(d.realDate) + 1;
    });
  } else if (numberedDates.length) {
    // Hinter die Session mit dem nächstfrüheren Datum – nicht hinter die höchste Nummer mit
    // früherem Datum: ein einziges falsches Datum würde sonst alles dahinter ziehen.
    drafts.forEach((d, i) => {
      if (d.number !== null || !d.realDate) return;
      const earlier = numberedDates
        .filter((n) => n.date <= d.realDate)
        .sort((a, b) => b.date.localeCompare(a.date) || b.number - a.number)[0];
      keys[i] = earlier
        ? earlier.number + 0.5
        : Math.min(...numberedDates.map((n) => n.number)) - 0.5;
    });
  }
  // Übrige nach ihren Nachbarn in derselben Datei: hinter der vorigen, sonst vor der nächsten.
  const resolved = keys.slice();
  for (let i = 0; i < drafts.length; i++) {
    if (resolved[i] !== null) continue;
    const file = drafts[i]!.source.fileIndex;
    let found: number | null = null;
    for (let j = i - 1; j >= 0 && drafts[j]!.source.fileIndex === file; j--) {
      if (resolved[j] !== null) {
        found = resolved[j]! + 0.001 * (i - j);
        break;
      }
    }
    if (found === null) {
      for (let j = i + 1; j < drafts.length && drafts[j]!.source.fileIndex === file; j++) {
        if (keys[j] !== null) {
          found = keys[j]! - 0.001 * (j - i + 1) - 0.4;
          break;
        }
      }
    }
    resolved[i] = found ?? 1e9 + file;
  }
  return resolved.map((k) => k ?? 1e9);
}

/** Alle Nummern eines Entwurfs: eine, oder bei „Session 3+4“ alle von 3 bis 4. */
export function numbersOf(draft: Pick<SessionDraft, 'number' | 'lastNumber'>): number[] {
  if (draft.number === null) return [];
  const last = draft.lastNumber ?? draft.number;
  const out: number[] = [];
  for (let n = draft.number; n <= last; n++) out.push(n);
  return out;
}

/** Meldet Nummern, die mehrmals vorkommen – an jedem betroffenen Entwurf. */
export function markDuplicates(drafts: SessionDraft[]): SessionDraft[] {
  const byNumber = new Map<number, SessionDraft[]>();
  for (const d of drafts) {
    for (const n of numbersOf(d)) byNumber.set(n, [...(byNumber.get(n) ?? []), d]);
  }
  return drafts.map((d) => {
    const notes = d.notes.filter((note) => !note.startsWith(DUPLICATE_PREFIX));
    for (const n of numbersOf(d)) {
      const same = byNumber.get(n) ?? [];
      if (same.length < 2) continue;
      const where = [...new Set(same.map((s) => `„${s.source.file}“`))].join(' und ');
      notes.push(
        `${DUPLICATE_PREFIX}Session ${n} steht ${same.length}-mal in den Notizen (${where}). ${same.length === 2 ? 'Beide' : 'Alle'} bleiben – lege sie zusammen oder gib einer eine andere Nummer.`,
      );
    }
    return notes.length === d.notes.length && notes.every((n, i) => n === d.notes[i])
      ? d
      : { ...d, notes };
  });
}

/**
 * Alle Dateien in Sessions trennen und in die Reihenfolge des Spiels bringen: nach Nummer,
 * sonst nach echtem Datum, sonst wie in den Dateien. `now` ist die Weltzeit der Kampagne – Tage
 * ohne Jahr gelten als im laufenden Jahr.
 */
export function splitSessions(
  files: readonly NotesFile[],
  cal: CalendarDef,
  now: WorldTime,
): SessionDraft[] {
  const strip: WorldDateStrip = (title) => {
    let s = title;
    for (const date of findDates(cal, s, now).reverse())
      s = `${s.slice(0, date.from)} ${s.slice(date.to)}`;
    return s;
  };
  const inFileOrder = files.flatMap((file, fileIndex) =>
    draftsOfFile({ file, fileIndex, cal, now, strip }),
  );
  const keys = orderKeys(inFileOrder);
  const sorted = inFileOrder
    .map((draft, index) => ({ draft, key: keys[index]!, index }))
    .sort(
      (a, b) =>
        a.key - b.key ||
        (a.draft.realDate && b.draft.realDate
          ? a.draft.realDate.localeCompare(b.draft.realDate)
          : 0) ||
        a.index - b.index,
    )
    .map((entry) => entry.draft);
  return markDuplicates(sorted);
}

/** Nummern zwischen der kleinsten und größten, die in den Notizen fehlen. */
export function missingNumbers(drafts: readonly SessionDraft[]): number[] {
  const numbers = new Set(drafts.flatMap(numbersOf));
  if (!numbers.size) return [];
  const out: number[] = [];
  for (let n = Math.min(...numbers); n <= Math.max(...numbers); n++)
    if (!numbers.has(n)) out.push(n);
  return out;
}
