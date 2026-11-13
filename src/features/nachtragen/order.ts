/**
 * Nachgetragene Sessions in die Weltzeit legen. Steht ein Tag des Kalenders in den Notizen, gilt
 * er (auf den Tag genau); gibt es die Session schon im Spielstand, gilt ihre Zeit; sonst reiht
 * Wayfarer die Sessions nur hintereinander („ungefähr“) – vor die erste Session, die es schon
 * gibt, und vor den heutigen Stand der Welt. Passt es nicht, wird zusammengeschoben und gemeldet.
 */
import {
  formatDate,
  fromTime,
  MINUTES_PER_DAY,
  startOfDay,
  type CalendarDef,
  type WorldTime,
} from '../../domain/time/calendar';
import { daysWithin, gapAtStart, type DraftGap } from './gaps';
import type { SessionDraft } from './split';

/** Was `placeSessions` von einer vorhandenen Session braucht (passt auf `Session`). */
export interface ExistingSessionLike {
  id: string;
  number: number;
  title: string;
  realDate: string;
  startAt: WorldTime;
  endAt: WorldTime | null;
  notes: string;
}

/** Was `placeSessions` vom Spielstand braucht (passt auf `CampaignData`). */
export interface PlaceData {
  campaign: { calendar: CalendarDef };
  state: { now: WorldTime };
  sessions: Readonly<Record<string, ExistingSessionLike>>;
}

/**
 * day: aus Tagen des Kalenders im Text; existing: Zeit der Session, die es schon gibt;
 * order: nur hintereinander gereiht – ungefähr; set: vom Spielleiter gesetzt.
 */
export type PlacePrecision = 'day' | 'existing' | 'order' | 'set';

/** Von Hand gesetzte Weltzeiten, nach `SessionDraft.key`. */
export type PlaceOverrides = Readonly<Record<string, { startAt: WorldTime; endAt: WorldTime }>>;

export interface ExistingMatch {
  id: string;
  number: number;
  title: string;
  startAt: WorldTime;
  endAt: WorldTime | null;
  /** Die Session hat schon Notizen (etwa aus der Übernahme der alten Version). */
  hasNotes: boolean;
  /** Ihre Notizen sind dieselben wie die gelesenen (bis auf Leerraum). */
  sameNotes: boolean;
}

export interface PlacedSession {
  draft: SessionDraft;
  startAt: WorldTime;
  /** Ende, ausschließlich. */
  endAt: WorldTime;
  precision: PlacePrecision;
  /** Es war zu wenig Platz – die Zeit ist zusammengeschoben. */
  squeezed: boolean;
  /** Die Session gibt es schon im Spielstand. */
  existing: ExistingMatch | null;
  /** Zwischenzeit vor der Session laut ihrem Anfang („sechs Wochen später“). */
  gap: DraftGap | null;
  /** Tage, die die Session nach ihren Worten umfasst („Nächster Tag“ …), mindestens 1. */
  days: number;
  notes: string[];
}

const DAY = MINUTES_PER_DAY;
/** Liegen Tage im Text weiter auseinander, gehören sie nicht zum selben Abend. */
const CLUSTER_GAP_DAYS = 10;
/** Tage mit Jahr, die mehr Jahre vor dem heutigen Stand liegen, gelten als Vorgeschichte. */
const LORE_YEARS = 1;

const squash = (value: string) => value.replace(/\s+/g, ' ').trim();

function labelOf(draft: SessionDraft): string {
  if (draft.number !== null) return `Session ${draft.number}`;
  if (draft.title && !draft.vorspann) return `„${draft.title}“`;
  if (draft.realDate) {
    const [y, m, d] = draft.realDate.split('-');
    return `der Session vom ${d}.${m}.${y}`;
  }
  return 'einer Session ohne Titel';
}

interface Span {
  start: WorldTime;
  end: WorldTime;
}

/** Zeit aus den Tagen im Text: die größte Gruppe nah beieinander liegender Tage bis heute. */
function spanFromText(
  draft: SessionDraft,
  cal: CalendarDef,
  now: WorldTime,
  notes: string[],
): Span | null {
  const thisYear = fromTime(cal, now).year;
  const all = draft.worldDates.filter((d) => d.precision === 'day');
  // „Sein Bruder starb am 3. Frostfall 650 AD“: Tage mit Jahr, die Jahre zurückliegen, sind
  // Vorgeschichte, nicht der Abend.
  const lore = all.filter(
    (d) => !d.assumedYear && thisYear - fromTime(cal, d.time).year > LORE_YEARS,
  );
  const days = all.filter((d) => !lore.includes(d));
  if (lore.length) {
    const shown = [...new Set(lore.map((d) => formatDate(cal, d.time)))].slice(0, 3).join(', ');
    notes.push(`Nicht als Zeit genommen, weil lange vor dem heutigen Stand der Welt: ${shown}.`);
  }
  if (!days.length) return null;
  const today = startOfDay(now);
  const past = days.filter((d) => d.time <= today).sort((a, b) => a.time - b.time);
  if (past.length < days.length) {
    const later = days.filter((d) => d.time > today).map((d) => formatDate(cal, d.time));
    notes.push(
      `Nicht als Zeit genommen, weil nach dem heutigen Stand der Welt: ${[...new Set(later)].slice(0, 3).join(', ')}.`,
    );
  }
  if (!past.length) return null;
  const clusters: (typeof past)[] = [[past[0]!]];
  for (const date of past.slice(1)) {
    const current = clusters[clusters.length - 1]!;
    if (date.time - current[current.length - 1]!.time > CLUSTER_GAP_DAYS * DAY)
      clusters.push([date]);
    else current.push(date);
  }
  // Die meisten Tage gewinnen, bei Gleichstand die spätere Gruppe.
  const best = clusters.reduce((a, b) => (b.length >= a.length ? b : a));
  if (clusters.length > 1) {
    const others = clusters
      .filter((c) => c !== best)
      .flat()
      .map((d) => formatDate(cal, d.time));
    notes.push(
      `Weitere Tage im Text gehören wohl nicht zu diesem Abend: ${[...new Set(others)].slice(0, 3).join(', ')}.`,
    );
  }
  return { start: startOfDay(best[0]!.time), end: startOfDay(best[best.length - 1]!.time) + DAY };
}

function matchExisting(
  draft: SessionDraft,
  sessions: ExistingSessionLike[],
): ExistingSessionLike | null {
  if (draft.vorspann) return null;
  if (draft.number !== null) return sessions.find((s) => s.number === draft.number) ?? null;
  if (draft.realDate) return sessions.find((s) => s.realDate === draft.realDate) ?? null;
  return null;
}

type Item = { kind: 'draft'; index: number } | { kind: 'fixed'; span: Span; label: string };

/**
 * Schlägt für jeden Entwurf eine Spanne der Weltzeit vor (Reihenfolge wie `drafts`) und findet
 * Sessions, die es schon gibt (gleiche Nummer, ohne Nummer gleiches echtes Datum).
 * Zwischenzeiten am Anfang („sechs Wochen später“) halten Abstand zur vorigen Session, Tage im
 * Text („Nächster Tag“) verlängern eine Session. `overrides`: von Hand gesetzte Weltzeiten –
 * sie gelten wie Tage im Text, nur genauer; die übrigen reihen sich um sie herum.
 */
export function placeSessions(
  drafts: readonly SessionDraft[],
  data: PlaceData,
  overrides: PlaceOverrides = {},
): PlacedSession[] {
  const cal = data.campaign.calendar;
  const now = data.state.now;
  const sessions = Object.values(data.sessions);
  const fmt = (time: WorldTime) => formatDate(cal, time);
  const year = fromTime(cal, now).year;

  const placed: PlacedSession[] = drafts.map((draft) => {
    const notes: string[] = [];
    const match = matchExisting(draft, sessions);
    const existing: ExistingMatch | null = match
      ? {
          id: match.id,
          number: match.number,
          title: match.title,
          startAt: match.startAt,
          endAt: match.endAt,
          hasNotes: match.notes.trim() !== '',
          sameNotes: match.notes.trim() !== '' && squash(match.notes) === squash(draft.text),
        }
      : null;
    if (existing) {
      const name = `Session ${existing.number}${existing.title ? ` „${existing.title}“` : ''}`;
      notes.push(
        existing.sameNotes
          ? `Gibt es schon: ${name} – mit denselben Notizen.`
          : existing.hasNotes
            ? `Gibt es schon: ${name} – mit eigenen Notizen.`
            : `Gibt es schon: ${name}.`,
      );
    }
    const gap = draft.vorspann ? null : gapAtStart(cal, draft.text, year);
    const within = daysWithin(cal, draft.text, year, gap);
    if (gap) {
      const words = `„${draft.text.slice(gap.from, gap.to)}“`;
      notes.push(
        gap.days === null
          ? `Zwischenzeit am Anfang (${words}) – ohne Dauer; setze die Tage, wenn du sie weißt.`
          : gap.days === 0
            ? `Schließt an den Abend davor an (${words}).`
            : `Zwischenzeit am Anfang (${words}) – ${gap.days === 1 ? 'ein Tag' : `${gap.days} Tage`} Abstand zur Session davor.`,
      );
    }
    if (within.days > 1) {
      const shown = [...new Set(within.marks)]
        .slice(0, 3)
        .map((m) => `„${m}“`)
        .join(', ');
      notes.push(`Umfasst nach den Notizen etwa ${within.days} Tage (${shown}).`);
    }
    return {
      draft,
      startAt: 0,
      endAt: 0,
      precision: 'order',
      squeezed: false,
      existing,
      gap,
      days: within.days,
      notes,
    };
  });

  // Bekannte Zeiten: die Session, die es schon gibt, sonst die Tage im Text.
  const known: (Span | null)[] = placed.map((p) => {
    if (p.draft.vorspann) return null;
    const set = overrides[p.draft.key];
    if (set && !p.existing) {
      p.precision = 'set';
      p.notes.push('Weltzeit von dir gesetzt.');
      return { start: set.startAt, end: Math.max(set.endAt, set.startAt) };
    }
    const fromText = spanFromText(p.draft, cal, now, p.notes);
    if (p.existing) {
      const span = {
        start: p.existing.startAt,
        end: Math.max(p.existing.endAt ?? p.existing.startAt + DAY, p.existing.startAt),
      };
      if (fromText && Math.abs(startOfDay(fromText.start) - startOfDay(span.start)) >= DAY) {
        p.notes.push(
          `Die Notizen nennen ${fmt(fromText.start)}; die Session steht aber am ${fmt(span.start)} – diese Zeit gilt.`,
        );
      }
      p.precision = 'existing';
      return span;
    }
    if (!fromText) return null;
    p.precision = 'day';
    // „Nächster Tag“ … verlängert die Session über die genannten Tage hinaus – nie über heute.
    const longer = Math.min(fromText.start + p.days * DAY, Math.max(fromText.end, startOfDay(now)));
    return { start: fromText.start, end: Math.max(fromText.end, longer) };
  });

  // Sessions des Spielstands ohne Entwurf sind feste Punkte: nach Nummer einsortiert.
  const matched = new Set(placed.flatMap((p) => (p.existing ? [p.existing.id] : [])));
  const items: Item[] = drafts.map((_, index) => ({ kind: 'draft', index }));
  const others = sessions
    .filter((s) => !matched.has(s.id))
    .sort((a, b) => a.number - b.number || a.startAt - b.startAt);
  for (const session of others) {
    const at = items.findIndex(
      (item) =>
        item.kind === 'draft' &&
        drafts[item.index]!.number !== null &&
        drafts[item.index]!.number! > session.number,
    );
    const fixed: Item = {
      kind: 'fixed',
      span: {
        start: session.startAt,
        end: Math.max(session.endAt ?? session.startAt, session.startAt),
      },
      label: `Session ${session.number}`,
    };
    if (at < 0) items.push(fixed);
    else items.splice(at, 0, fixed);
  }
  items.push({
    kind: 'fixed',
    span: { start: now, end: now },
    label: 'dem heutigen Stand der Welt',
  });

  let previous = null as { end: WorldTime; label: string } | null;
  let run: number[] = [];

  /** Tage Abstand vor einer Session: ihre Zwischenzeit, sonst ein Tag. */
  const gapDays = (index: number) => placed[index]!.gap?.days ?? 1;

  /**
   * Die Sessions ohne eigene Zeit vor den nächsten festen Punkt legen. `next.gap`: Zwischenzeit
   * am Anfang der Session dort (Tage), wenn ihre Notizen eine nennen.
   */
  const placeRun = (next: { start: WorldTime; label: string; gap: number | null }) => {
    const k = run.length;
    if (!k) return;
    if (previous === null) {
      // Rückwärts vor den nächsten festen Punkt: mit den Zwischenzeiten, sonst je ein Tag Abstand.
      let cursor = startOfDay(next.start) - (next.gap ?? 1) * DAY;
      for (let j = k - 1; j >= 0; j--) {
        const index = run[j]!;
        const p = placed[index]!;
        p.endAt = Math.max(0, cursor);
        p.startAt = Math.max(0, cursor - p.days * DAY);
        cursor = p.startAt - gapDays(index) * DAY;
        const after = run[j + 1];
        const before = after === undefined ? next.label : labelOf(placed[after]!.draft);
        p.notes.push(`Weltzeit unbekannt – vor ${before} eingereiht.`);
      }
    } else {
      const base = Math.ceil(previous.end / DAY) * DAY;
      /** Hintereinander ab `base`; `words`: mit Zwischenzeiten und Tagen aus den Notizen. */
      const layout = (words: boolean) => {
        const spans: Span[] = [];
        let cursor = base + (words ? gapDays(run[0]!) : 1) * DAY;
        run.forEach((index, j) => {
          const start = cursor;
          const end = start + (words ? placed[index]!.days : 1) * DAY;
          spans.push({ start, end });
          const after = run[j + 1];
          if (after !== undefined) cursor = end + (words ? gapDays(after) : 1) * DAY;
        });
        return spans;
      };
      const withWords = layout(true);
      const plain = layout(false);
      const fits = (spans: Span[], gap: number) =>
        spans[spans.length - 1]!.end + gap * DAY <= next.start;
      const spans = fits(withWords, next.gap ?? 0) ? withWords : fits(plain, 0) ? plain : null;
      const dropped =
        spans === plain &&
        withWords.some((span, j) => span.start !== plain[j]!.start || span.end !== plain[j]!.end);
      if (spans) {
        run.forEach((index, j) => {
          const p = placed[index]!;
          p.startAt = spans[j]!.start;
          p.endAt = spans[j]!.end;
          p.notes.push(
            `Weltzeit unbekannt – nach ${j === 0 ? previous!.label : labelOf(placed[run[j - 1]!]!.draft)} eingereiht.`,
          );
          if (dropped)
            p.notes.push(
              `Zwischenzeiten und Tage aus den Notizen passen nicht vor ${next.label} – nur hintereinander gereiht.`,
            );
        });
      } else {
        const room = Math.max(0, next.start - previous.end);
        const slot = Math.floor(room / k);
        run.forEach((index, j) => {
          const p = placed[index]!;
          p.startAt = previous!.end + j * slot;
          p.endAt = p.startAt + Math.min(DAY, slot);
          p.squeezed = true;
          p.notes.push(
            room > 0
              ? `Zwischen ${previous!.label} und ${next.label} ist zu wenig Zeit für ${k === 1 ? 'diese Session' : `${k} Sessions`} – zusammengeschoben. Setze einen Tag, wenn du ihn weißt.`
              : `Zwischen ${previous!.label} und ${next.label} ist keine Zeit – die Reihenfolge widerspricht den Tagen. Setze einen Tag, wenn du ihn weißt.`,
          );
        });
      }
    }
    run = [];
  };

  for (const item of items) {
    if (item.kind === 'draft') {
      const p = placed[item.index]!;
      if (p.draft.vorspann) continue;
      const span = known[item.index];
      if (!span) {
        run.push(item.index);
        continue;
      }
      placeRun({ start: span.start, label: labelOf(p.draft), gap: p.gap?.days ?? null });
      p.startAt = span.start;
      p.endAt = span.end;
      if (previous && span.start < previous.end) {
        p.notes.push(`Laut Weltzeit vor ${previous.label} – stimmt die Reihenfolge?`);
      }
      if (span.end > now && p.precision !== 'existing') {
        p.notes.push('Liegt nach dem heutigen Stand der Welt.');
      }
      previous = {
        end: Math.max(previous?.end ?? span.end, span.end),
        label: labelOf(p.draft),
      };
    } else {
      placeRun({ start: item.span.start, label: item.label, gap: null });
      if (item.label !== 'dem heutigen Stand der Welt') {
        previous = {
          end: Math.max(previous?.end ?? item.span.end, item.span.end),
          label: item.label,
        };
      }
    }
  }

  // Der Vorspann hat keine eigene Zeit: er steht am Beginn der Session danach.
  placed.forEach((p, index) => {
    if (!p.draft.vorspann) return;
    const next = placed.slice(index + 1).find((q) => !q.draft.vorspann);
    p.startAt = p.endAt = next ? next.startAt : now;
    p.notes.push('Vorspann – ohne eigene Weltzeit.');
  });
  return placed;
}
