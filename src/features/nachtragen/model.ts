/**
 * Die Seite „Nachtragen“ in reinen Funktionen: Entwürfe von Hand ändern, die Weltzeit in Worten,
 * was „Übernehmen“ tun würde (`takeOverPlan`) und die übernommenen Sessions. Geschrieben wird
 * nur in `actions.ts`.
 */
import type { CampaignData, ChroniclePrecision, Session, SessionSource } from '../../domain/schema';
import {
  formatDate,
  formatDayMonth,
  fromTime,
  startOfDay,
  type CalendarDef,
  type WorldTime,
} from '../../domain/time/calendar';
import { formatWorldRange } from '../chronik/model';
import type { PlacedSession, PlacePrecision } from './order';
import type { NotesFile } from './read';
import { reviewState } from './review';
import {
  markDuplicates,
  numbersOf,
  RANGE_NOTE_END,
  readBoundary,
  type SessionDraft,
} from './split';

// ── Entwürfe von Hand ändern ───────────────────────────────────────────────

/** Was der Spielleiter an einem Entwurf ändern kann. */
export interface DraftChange {
  number?: number | null;
  title?: string;
  /** JJJJ-MM-TT oder ''. */
  realDate?: string;
}

/**
 * Nummer, Titel oder Spielabend eines Entwurfs ändern. Eine neue Nummer gilt für einen Abend:
 * „Session 3+4“ wird dann zu einer – trennen kann man sie mit `splitAt`.
 */
export function editDraft(
  drafts: readonly SessionDraft[],
  index: number,
  change: DraftChange,
): SessionDraft[] {
  const draft = drafts[index];
  if (!draft) return drafts.slice();
  const next: SessionDraft = { ...draft };
  if (change.number !== undefined && change.number !== draft.number) {
    next.number = change.number;
    next.lastNumber = null;
    next.notes = draft.notes.filter((note) => !note.endsWith(RANGE_NOTE_END));
  }
  if (change.title !== undefined) next.title = change.title.trim();
  if (change.realDate !== undefined) next.realDate = change.realDate;
  return markDuplicates([...drafts.slice(0, index), next, ...drafts.slice(index + 1)]);
}

/** Eine Zeile des Textes eines Entwurfs – zum Trennen an ihr. */
export interface DraftLine {
  text: string;
  /** Stelle im Text des Entwurfs (für `splitAt`). */
  offset: number;
  /** Die Zeile sieht wie eine Grenze aus („Session 6“, ein Datum). */
  boundary: boolean;
  /** Hier lässt sich trennen: nicht die erste Zeile, nicht leer. */
  splittable: boolean;
}

export function draftLines(draft: SessionDraft): DraftLine[] {
  const out: DraftLine[] = [];
  let offset = 0;
  let before = '';
  for (const line of draft.text.split('\n')) {
    out.push({
      text: line,
      offset,
      boundary: readBoundary(line) !== null,
      splittable: before.trim() !== '' && line.trim() !== '',
    });
    before += line;
    offset += line.length + 1;
  }
  return out;
}

/** Wie viele Sessions aus einer Datei kamen. */
export function sessionsPerFile(files: readonly NotesFile[], drafts: readonly SessionDraft[]) {
  return files.map((file, index) => {
    const own = drafts.filter((d) => d.source.fileIndex === index && !d.vorspann);
    return { name: file.name, count: own.length, windows: file.encoding === 'windows-1252' };
  });
}

export const sessionCount = (count: number) =>
  count === 1 ? '1 Session' : `${count.toLocaleString('de-DE')} Sessions`;

// ── Weltzeit in Worten ─────────────────────────────────────────────────────

/** Wie genau eine Session nach dem Einordnen in der Zeit steht – als Genauigkeit der Chronik. */
export function precisionOfPlace(precision: PlacePrecision, squeezed: boolean): ChroniclePrecision {
  if (precision === 'set' || precision === 'existing') return 'exact';
  if (precision === 'day') return 'day';
  return squeezed ? 'approx' : 'order';
}

/** Tage von `from` bis `to` (ausschließlich): „3. Tauwind 701 AD“, „3.–5. Tauwind 701 AD“. */
export function formatDays(cal: CalendarDef, from: WorldTime, to: WorldTime): string {
  const lastDay = Math.max(startOfDay(from), startOfDay(Math.max(from, to - 1)));
  if (lastDay === startOfDay(from)) return formatDate(cal, from);
  const a = fromTime(cal, from);
  const b = fromTime(cal, lastDay);
  if (a.year === b.year && a.month === b.month) return `${a.day}.–${formatDate(cal, lastDay)}`;
  if (a.year === b.year) return `${formatDayMonth(cal, from)} – ${formatDate(cal, lastDay)}`;
  return `${formatDate(cal, from)} – ${formatDate(cal, lastDay)}`;
}

export interface PlacedTime {
  /** „1.–2. Tauwind 701 AD“ */
  text: string;
  /** known: aus den Notizen, von Hand oder aus dem Spielstand; approx: geschätzt; order: nur Reihenfolge. */
  tone: 'known' | 'approx' | 'order';
  /** Kurz, woher die Zeit kommt. */
  how: string;
}

const hasClock = (from: WorldTime, to: WorldTime) =>
  from !== startOfDay(from) || to !== startOfDay(to);

export function placedTime(cal: CalendarDef, placed: PlacedSession): PlacedTime {
  const { startAt, endAt } = placed;
  const range = hasClock(startAt, endAt)
    ? formatWorldRange(cal, startAt, endAt)
    : formatDays(cal, startAt, endAt);
  if (placed.draft.vorspann) return { text: '', tone: 'order', how: 'ohne eigene Weltzeit' };
  if (placed.precision === 'existing')
    return { text: range, tone: 'known', how: 'Zeit der vorhandenen Session' };
  if (placed.precision === 'set') return { text: range, tone: 'known', how: 'von dir gesetzt' };
  if (placed.precision === 'day')
    return { text: range, tone: 'known', how: 'aus den Tagen in den Notizen' };
  if (placed.squeezed) return { text: range, tone: 'approx', how: 'ungefähr – zusammengeschoben' };
  return { text: range, tone: 'order', how: 'nur Reihenfolge – ungefähr' };
}

/** Weltzeit einer übernommenen Session: „ungefähr 3.–4. Tauwind 701 AD“. */
export function sessionTimeText(cal: CalendarDef, session: Session): string {
  const end = session.endAt ?? session.startAt;
  const range = hasClock(session.startAt, end)
    ? formatWorldRange(cal, session.startAt, end)
    : formatDays(cal, session.startAt, end);
  const precision = session.source?.precision ?? 'exact';
  if (precision === 'order') return `nur Reihenfolge – ungefähr ${range}`;
  if (precision === 'approx') return `ungefähr ${range}`;
  return range;
}

// ── Übernehmen ─────────────────────────────────────────────────────────────

/**
 * create: neue Session anlegen; attach: vorhandene Session bekommt die Notizen; same: hat schon
 * dieselben Notizen; skip: wird nicht übernommen (Vorspann).
 */
export type TakeOverAction = 'create' | 'attach' | 'same' | 'skip';

export interface TakeOverItem {
  key: string;
  action: TakeOverAction;
  /** Die vorhandene Session bei attach/same. */
  sessionId: string | null;
  number: number | null;
  /** Die Nummer hat Wayfarer vorgeschlagen (in den Notizen stand keine). */
  numberProposed: boolean;
  title: string;
  realDate: string;
  startAt: WorldTime;
  endAt: WorldTime;
  source: SessionSource;
  /** Hindert am Übernehmen; '' = in Ordnung. */
  problem: string;
  /** Was sonst zu wissen ist. */
  notes: string[];
}

export interface TakeOverPlan {
  items: TakeOverItem[];
  counts: Record<TakeOverAction, number>;
  /** Alle Hindernisse als Sätze; leer = „Übernehmen“ geht. */
  problems: string[];
  /** Es gibt etwas zu tun und nichts hindert. */
  ready: boolean;
}

const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

/** Nummern für Entwürfe ohne Nummer: hinter der vorigen, die erste freie. */
function proposeNumbers(placed: readonly PlacedSession[], data: CampaignData): Map<string, number> {
  const taken = new Set<number>([
    ...Object.values(data.sessions).map((s) => s.number),
    ...placed.flatMap((p) => numbersOf(p.draft)),
  ]);
  const out = new Map<string, number>();
  let last = 0;
  for (const p of placed) {
    if (p.draft.vorspann) continue;
    if (p.existing) {
      last = Math.max(last, p.existing.number);
      continue;
    }
    if (p.draft.number !== null) {
      last = Math.max(last, p.draft.lastNumber ?? p.draft.number);
      continue;
    }
    let candidate = last + 1;
    while (taken.has(candidate)) candidate++;
    taken.add(candidate);
    out.set(p.draft.key, candidate);
    last = candidate;
  }
  return out;
}

/** Was „Übernehmen“ mit den eingeordneten Entwürfen täte – und was es hindert. */
export function takeOverPlan(placed: readonly PlacedSession[], data: CampaignData): TakeOverPlan {
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const proposed = proposeNumbers(placed, data);
  const items: TakeOverItem[] = placed.map((p) => {
    const { draft } = p;
    const source: SessionSource = {
      file: draft.source.file,
      text: draft.text,
      line: draft.source.line,
      precision: precisionOfPlace(p.precision, p.squeezed),
    };
    const base = {
      key: draft.key,
      title: draft.title,
      realDate: draft.realDate,
      startAt: p.startAt,
      endAt: p.endAt,
      source,
      problem: '',
      notes: [] as string[],
    };
    if (draft.vorspann) {
      return {
        ...base,
        action: 'skip' as const,
        sessionId: null,
        number: null,
        numberProposed: false,
        notes: [
          'Text vor der ersten Session – wird nicht übernommen. Gehört er zu ihr, lege ihn mit ihr zusammen.',
        ],
      };
    }
    if (p.existing) {
      const session = data.sessions[p.existing.id];
      const before = session?.source ?? null;
      const same = before !== null && squash(before.text) === squash(draft.text);
      const notes: string[] = [];
      if (!same && before)
        notes.push(`Ersetzt die früher übernommenen Notizen aus „${before.file}“.`);
      if (!same) notes.push('Bekommt deine Notizen; Zeit und Mitschrift der Session bleiben.');
      return {
        ...base,
        action: same ? ('same' as const) : ('attach' as const),
        sessionId: p.existing.id,
        number: p.existing.number,
        numberProposed: false,
        startAt: p.existing.startAt,
        endAt: p.existing.endAt ?? p.existing.startAt,
        notes: same ? ['Hat diese Notizen schon.'] : notes,
      };
    }
    const number = draft.number ?? proposed.get(draft.key) ?? null;
    const notes: string[] = [];
    if (draft.number === null && number !== null)
      notes.push(`Ohne Nummer in den Notizen – als Session ${number} vorgeschlagen.`);
    if (draft.lastNumber !== null)
      notes.push(
        `Umfasst auch Session ${draft.number! + 1}${draft.lastNumber > draft.number! + 1 ? `–${draft.lastNumber}` : ''} – wird als eine Session ${draft.number} übernommen. Trenne sie, wenn du weißt, wo ein Abend endet.`,
      );
    let problem = '';
    if (number === null) problem = 'Ohne Nummer.';
    else if (p.endAt < p.startAt) problem = 'Das Ende liegt vor dem Beginn.';
    else if (p.endAt > now)
      problem = `Endet nach dem heutigen Stand der Welt (${formatDate(cal, now)}).`;
    return {
      ...base,
      action: 'create' as const,
      sessionId: null,
      number,
      numberProposed: draft.number === null,
      problem,
      notes,
    };
  });

  // Neue Sessions liegen nie in der Zeit einer anderen – weder einer vorhandenen (eine laufende
  // reicht bis jetzt) noch einer anderen neuen. Sonst wüsste keiner, wohin ein Eintrag gehört.
  const spans = [
    ...Object.values(data.sessions).map((s) => ({
      key: s.id,
      number: s.number,
      startAt: s.startAt,
      endAt: s.endAt ?? now,
    })),
    ...items
      .filter((item) => item.action === 'create')
      .map((item) => ({
        key: item.key,
        number: item.number,
        startAt: item.startAt,
        endAt: item.endAt,
      })),
  ];
  for (const item of items) {
    if (item.action !== 'create' || item.problem) continue;
    const other = spans.find(
      (s) => s.key !== item.key && s.startAt < item.endAt && s.endAt > item.startAt,
    );
    if (other)
      item.problem = `In dieser Zeit liegt schon ${other.number !== null ? `Session ${other.number}` : 'eine andere Session'} (${formatWorldRange(cal, other.startAt, other.endAt)}) – setze die Weltzeit.`;
  }

  // Dieselbe Nummer zweimal: nur eine Session kann sie tragen.
  const byNumber = new Map<number, TakeOverItem[]>();
  for (const item of items)
    if (item.action !== 'skip' && item.number !== null)
      byNumber.set(item.number, [...(byNumber.get(item.number) ?? []), item]);
  for (const [number, same] of byNumber) {
    if (same.length < 2) continue;
    for (const item of same)
      if (!item.problem)
        item.problem = `Session ${number} steht ${same.length}-mal da – lege sie zusammen oder gib einer eine andere Nummer.`;
  }

  const counts: Record<TakeOverAction, number> = { create: 0, attach: 0, same: 0, skip: 0 };
  for (const item of items) counts[item.action]++;
  const problems = items
    .filter((item) => item.problem)
    .map(
      (item) =>
        `${item.number !== null ? `Session ${item.number}` : 'Ohne Nummer'}: ${item.problem}`,
    );
  return {
    items,
    counts,
    problems: [...new Set(problems)],
    ready: problems.length === 0 && counts.create + counts.attach > 0,
  };
}

/** Der Satz für den Knopf und die Rückfrage: „3 neu, 1 vorhandene bekommt die Notizen“. */
export function planSummary(plan: TakeOverPlan): string {
  const parts: string[] = [];
  if (plan.counts.create)
    parts.push(
      `${sessionCount(plan.counts.create)} ${plan.counts.create === 1 ? 'wird' : 'werden'} angelegt`,
    );
  if (plan.counts.attach)
    parts.push(
      plan.counts.attach === 1
        ? '1 vorhandene Session bekommt die Notizen'
        : `${plan.counts.attach} vorhandene Sessions bekommen die Notizen`,
    );
  if (plan.counts.same)
    parts.push(plan.counts.same === 1 ? '1 hat sie schon' : `${plan.counts.same} haben sie schon`);
  if (plan.counts.skip) parts.push('der Vorspann bleibt weg');
  return parts.join(', ');
}

// ── Übernommene Sessions ───────────────────────────────────────────────────

/** Sessions, die aus Notizen nachgetragen wurden, in der Reihenfolge des Spiels. */
export function sourcedSessions(data: CampaignData): Session[] {
  return Object.values(data.sessions)
    .filter((s) => s.source !== null)
    .sort((a, b) => a.number - b.number || a.startAt - b.startAt);
}

/** Stand einer übernommenen Session in Worten („gelesen · 14 Vorschläge“, „3 von 14 geprüft“). */
export function readingStateText(session: Session): string {
  if (!session.reading)
    return (session.source?.text ?? session.notes).trim()
      ? 'übernommen · noch nicht gelesen'
      : 'übernommen · ohne Notizen';
  return reviewState(session).text;
}
