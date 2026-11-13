/**
 * Zeit zwischen und in Sessions aus den Worten der Notizen: „Sechs Wochen später …“,
 * „Downtime: 3 Tage“ am Anfang einer Session sind der Abstand zur vorigen; „Nächster Tag“ oder
 * „Insgesamt 5 Tage vergangen“ im Text verlängern die Session. Rein, ohne Kalender außer der
 * Länge von Woche, Monat und Jahr. Nichts davon stellt die Weltzeit vor – es hilft nur beim
 * Einordnen.
 */
import { yearLength, type CalendarDef } from '../../domain/time/calendar';

/** Zwischenzeit vor einer Session. */
export interface DraftGap {
  /** Tage zwischen dem Ende der vorigen und dem Beginn dieser Session; `null` = Dauer unbekannt. */
  days: number | null;
  /** Wo es im Text steht (Zeichen in `text`). */
  from: number;
  to: number;
}

const NUMBER_WORDS: Record<string, number> = {
  ein: 1,
  eine: 1,
  einen: 1,
  einem: 1,
  einer: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  fünf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwölf: 12,
  dreizehn: 13,
  vierzehn: 14,
  fünfzehn: 15,
  zwanzig: 20,
  dreißig: 30,
  anderthalb: 1.5,
  eineinhalb: 1.5,
  zweieinhalb: 2.5,
};

const NUMBER = `(?:\\d{1,4}(?:[,.]\\d)?|${Object.keys(NUMBER_WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|')})`;
const UNIT = '(?:tag(?:e|en)?|woche(?:n)?|monat(?:e|en)?|jahr(?:e|en)?)';
const AMOUNT = `(?<n>${NUMBER})\\s+(?<unit>${UNIT})`;
/** Wörter, die eine Zwischenzeit nennen. */
const PAUSE = '(?:downtime|zwischenzeit|pause|auszeit|ruhezeit)';
const PASSED =
  '(?:später|danach|vergehen|vergingen|vergangen|verstrichen|verstreichen|ziehen ins land)';

function amountOf(raw: string): number | null {
  const word = NUMBER_WORDS[raw.toLowerCase()];
  if (word !== undefined) return word;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Tage einer Einheit im Kalender: Woche = Wochentage, Monat = Mittel der Monate, Jahr. */
function unitDays(cal: CalendarDef, unit: string, year: number): number {
  const u = unit.toLowerCase();
  if (u.startsWith('tag')) return 1;
  if (u.startsWith('woche')) return cal.weekdays.length || 7;
  const perYear = yearLength(cal, year);
  if (u.startsWith('monat')) return Math.round(perYear / Math.max(1, cal.months.length));
  return perYear;
}

const daysOf = (cal: CalendarDef, year: number, n: string, unit: string): number | null => {
  const amount = amountOf(n);
  return amount === null ? null : Math.round(amount * unitDays(cal, unit, year));
};

/** So weit vom Anfang darf die Zwischenzeit stehen: in der ersten Zeile mit Text. */
const START_CHARS = 240;
const START_LINES = 1;

/** Wo der Anfang einer Session endet: nach den ersten Zeilen mit Text. */
function startEnd(text: string): number {
  let seen = 0;
  let at = 0;
  for (const line of text.split('\n')) {
    at += line.length + 1;
    if (line.trim()) seen++;
    if (seen >= START_LINES) break;
  }
  return Math.min(at, START_CHARS, text.length);
}

const NEXT_DAY =
  /(?<![\p{L}])(?:am\s+)?(?:nächste[nrs]?|folgende[nrs]?|darauffolgende[nrs]?)\s+(?:tag|morgen)(?![\p{L}])|(?<![\p{L}])am\s+tag\s+darauf(?![\p{L}])/giu;

/**
 * Zwischenzeit am Anfang einer Session: „Sechs Wochen später“, „Nach 3 Tagen …“, „Downtime:
 * 2 Wochen“, „(Zwischenzeit, ein Monat)“ – oder „Am nächsten Morgen“ (kein Tag dazwischen).
 * „Downtime“ ohne Dauer liefert `days: null`. `year` (absolut) für die Länge von Monat und Jahr.
 */
export function gapAtStart(cal: CalendarDef, text: string, year: number): DraftGap | null {
  const head = text.slice(0, startEnd(text));
  const patterns: RegExp[] = [
    // „Downtime: 6 Wochen“, „Zwischenzeit von drei Tagen“, „Pause (2 Wochen)“
    new RegExp(
      `(?<![\\p{L}])${PAUSE}(?![\\p{L}])\\s*[:(–—-]?\\s*(?:von|für|über|ca\\.?|etwa|rund)?\\s*${AMOUNT}(?![\\p{L}])`,
      'iu',
    ),
    // „6 Wochen Downtime“, „sechs Wochen später“, „drei Tage vergehen“
    new RegExp(
      `(?<![\\p{L}\\p{N}])${AMOUNT}(?![\\p{L}])\\s*(?:${PAUSE}|${PASSED})(?![\\p{L}])`,
      'iu',
    ),
    // „Nach sechs Wochen …“ am Anfang einer Zeile
    new RegExp(
      `(?:^|\\n)\\s*(?:erst\\s+)?nach\\s+(?:etwa\\s+|rund\\s+)?${AMOUNT}(?![\\p{L}])`,
      'iu',
    ),
  ];
  let best: DraftGap | null = null;
  for (const pattern of patterns) {
    const match = pattern.exec(head);
    if (!match?.groups) continue;
    // „Insgesamt 5 Tage vergangen“ ist die Länge der Session, kein Abstand davor.
    if (/insgesamt\s*$/iu.test(head.slice(Math.max(0, match.index - 12), match.index))) continue;
    const days = daysOf(cal, year, match.groups.n!, match.groups.unit!);
    const lead = match[0].length - match[0].trimStart().length;
    const found = { days, from: match.index + lead, to: match.index + match[0].length };
    if (!best || found.from < best.from) best = found;
  }
  if (best) return best;
  const pause = new RegExp(`(?<![\\p{L}])${PAUSE}(?![\\p{L}])`, 'iu').exec(head);
  if (pause) return { days: null, from: pause.index, to: pause.index + pause[0].length };
  NEXT_DAY.lastIndex = 0;
  const next = NEXT_DAY.exec(text.slice(0, startEnd(text)));
  // Nur ganz vorn: „Am nächsten Morgen brechen sie auf“ schließt an den Abend davor an.
  if (next && !text.slice(0, next.index).trim())
    return { days: 0, from: next.index, to: next.index + next[0].length };
  return null;
}

/** Wie viele Tage die Session nach ihren Worten umfasst – und woran es abgelesen ist. */
export interface SessionDays {
  days: number;
  /** Was im Text dazu stand, wörtlich (für den Hinweis). */
  marks: string[];
}

/** Mehr Tage als so viele liest Wayfarer nicht aus einem Abend – dann ist es eher Vorgeschichte. */
const MAX_SESSION_DAYS = 60;

/**
 * Tage einer Session aus ihrem Text: ein Tag, dazu je „Nächster Tag“/„am nächsten Morgen“ einer
 * und je „3 Tage später“ drei; „Insgesamt 5 Tage vergangen“ setzt die Zahl. Die Zwischenzeit am
 * Anfang (`gap`) zählt nicht mit.
 */
export function daysWithin(
  cal: CalendarDef,
  text: string,
  year: number,
  gap: DraftGap | null = null,
): SessionDays {
  const body = gap
    ? `${text.slice(0, gap.from)}${' '.repeat(gap.to - gap.from)}${text.slice(gap.to)}`
    : text;
  const marks: string[] = [];
  let counted = 1;
  NEXT_DAY.lastIndex = 0;
  for (const match of body.matchAll(NEXT_DAY)) {
    counted += 1;
    marks.push(match[0].trim());
  }
  const later = new RegExp(
    `(?<![\\p{L}\\p{N}])${AMOUNT}(?![\\p{L}])\\s*(?:später|danach)(?![\\p{L}])`,
    'giu',
  );
  for (const match of body.matchAll(later)) {
    const days = daysOf(cal, year, match.groups!.n!, match.groups!.unit!);
    if (days === null) continue;
    counted += days;
    marks.push(match[0].trim());
  }
  let total = 0;
  const overall = new RegExp(
    `insgesamt\\s+(?:sind\\s+)?(?:etwa\\s+|rund\\s+)?${AMOUNT}(?![\\p{L}])`,
    'giu',
  );
  for (const match of body.matchAll(overall)) {
    const days = daysOf(cal, year, match.groups!.n!, match.groups!.unit!);
    if (days === null) continue;
    total = Math.max(total, days);
    marks.push(match[0].trim());
  }
  const days = Math.max(
    1,
    Math.min(MAX_SESSION_DAYS, Math.max(Math.ceil(counted), Math.ceil(total))),
  );
  return { days, marks };
}
