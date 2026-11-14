/**
 * „Letztes Mal“: was zu Beginn eines Abends gut zu wissen ist – die wichtigsten Einträge der
 * vorigen Session, so wie der Spielleiter sie festgehalten hat; wo die Gruppe jetzt steht; wie
 * viel noch offen hängt; was als Nächstes ansteht. Wayfarer formuliert nichts: Es wählt nur aus
 * (nach der Art eines Eintrags, Alltag fällt weg) und zeigt die Zeilen, wie sie geschrieben wurden.
 *
 * Am Spieltisch steht der Rückblick, solange im laufenden Abend noch nichts festgehalten ist und
 * der Spielleiter ihn nicht für diesen Abend weggeklickt hat (`state.recapDismissed`). Reine
 * Funktionen.
 */
import { recordHeadline } from './chronicleKinds';
import { openClocks } from './clock';
import { currentSession, upcomingOccurrences } from './derive';
import { LOOSE_REASONS, looseEnds, type LooseReason } from './looseEnds';
import { prepView } from './prep';
import type { CampaignData, ChronicleEntry, ChronicleKind, Session } from './schema';
import { storyOfClock } from './story';
import { MINUTES_PER_DAY, type WorldTime } from './time/calendar';
import { isEveryday } from './weight';

/** So viele Einträge des letzten Abends stehen höchstens im Rückblick. */
export const RECAP_LINES = 8;
/** Am Spieltisch weniger: Dort steht der Rückblick über „Im Spiel“ und soll es nicht verdrängen. */
export const RECAP_TABLE_LINES = 5;
/** So weit voraus schaut der Rückblick nach Terminen und Schritten von Uhren. */
export const RECAP_AHEAD_DAYS = 7;
/** So viele Termine und Schritte stehen höchstens unter „Als Nächstes“. */
export const RECAP_AHEAD = 5;

/**
 * Was ein Eintrag für den Rückblick wiegt: Entscheidungen, Abmachungen, Funde und Schicksale
 * zuerst, dann Ortswechsel, Kämpfe und Wünsche, dann Notizen und Veränderungen. 0 = Alltag
 * (Rast, eingetretene Termine) – er fällt weg.
 */
export const RECAP_WEIGHT: Record<ChronicleKind, number> = {
  decision: 5,
  promise: 5,
  discovery: 5,
  reveal: 5,
  fate: 5,
  clue: 4,
  milestone: 4,
  travel: 4,
  fight: 4,
  wish: 4,
  transformation: 4,
  note: 3,
  change: 3,
  meeting: 3,
  bond: 3,
  rumor: 3,
  lore: 3,
  knowledge: 3,
  writing: 3,
  companion: 3,
  quote: 2,
  attitude: 2,
  whereabouts: 2,
  condition: 2,
  trade: 1,
  downtime: 1,
  rest: 0,
  event: 0,
};

export interface RecapAhead {
  key: string;
  at: WorldTime;
  /** Der Titel des Termins oder der Text des Schrittes – wie geschrieben. */
  title: string;
  kind: 'event' | 'clock';
  /** Bei einem Schritt: die Uhr und ihre Geschichte. */
  clockTitle?: string;
  storyId?: string | null;
  eventId?: string;
}

export interface Recap {
  /** Der Abend, auf den zurückgeblickt wird. */
  session: Session;
  /** Läuft dieser Abend noch? (Auf „Abend vorbereiten“, wenn das Blatt schon dem nächsten gilt.) */
  running: boolean;
  /** Was der Spielleiter selbst als Rückblick zu diesem Abend geschrieben hat. */
  told: string;
  /** Die gewichtigsten Einträge des Abends – in ihrer Reihenfolge. */
  entries: ChronicleEntry[];
  /** So viele weitere Einträge des Abends stehen nur in der Chronik. */
  more: number;
  /** Wo die Gruppe jetzt steht. */
  placeId: string | null;
  /** Was noch offen hängt, nach Gruppen (`looseEnds`). */
  open: { total: number; groups: { reason: LooseReason; count: number }[] };
  /** Was als Nächstes ansteht: Termine (ohne Alltag) und Schritte von Uhren. */
  ahead: RecapAhead[];
}

/** Der Abend vor dem mit dieser Nummer – null, wenn es keinen gibt. */
export function sessionBefore(data: CampaignData, number: number): Session | null {
  return (
    Object.values(data.sessions)
      .filter((session) => session.number < number)
      .sort((a, b) => b.number - a.number || b.startAt - a.startAt)[0] ?? null
  );
}

/**
 * Hat der Spielleiter das festgehalten? Eingetretene Termine und Schritte von Uhren trägt
 * Wayfarer beim Vorstellen der Zeit selbst ein – sie gehören nicht in den Rückblick und beenden
 * ihn nicht.
 */
const isOwnEntry = (entry: ChronicleEntry): boolean =>
  entry.kind !== 'event' && entry.clockId === null;

/** Trägt ein Eintrag etwas, das im Rückblick stehen kann? Alltag, Leeres und Uhren nicht. */
function worthRecap(data: CampaignData, entry: ChronicleEntry): boolean {
  if (RECAP_WEIGHT[entry.kind] <= 0 || !isOwnEntry(entry)) return false;
  if (entry.kind === 'travel') return !!entry.travel?.toId;
  if (entry.kind === 'attitude') return !!entry.attitude;
  return entry.text.trim() !== '' || recordHeadline(data, entry) !== '';
}

/** Die gewichtigsten Einträge eines Abends – bei gleichem Gewicht die späteren, gezeigt in ihrer Reihenfolge. */
export function recapEntries(
  data: CampaignData,
  sessionId: string,
  limit: number = RECAP_LINES,
): { entries: ChronicleEntry[]; more: number } {
  const all = Object.values(data.chronicle).filter(
    (entry) => entry.sessionId === sessionId && worthRecap(data, entry),
  );
  const chosen = [...all]
    .sort(
      (a, b) =>
        RECAP_WEIGHT[b.kind] - RECAP_WEIGHT[a.kind] ||
        b.at - a.at ||
        b.created.localeCompare(a.created),
    )
    .slice(0, Math.max(0, limit))
    .sort((a, b) => a.at - b.at || a.created.localeCompare(b.created));
  return { entries: chosen, more: all.length - chosen.length };
}

/** Was als Nächstes ansteht: Termine ohne Alltag und die nächsten Schritte laufender Uhren. */
export function recapAhead(
  data: CampaignData,
  days: number = RECAP_AHEAD_DAYS,
  limit: number = RECAP_AHEAD,
): RecapAhead[] {
  const now = data.state.now;
  const until = now + days * MINUTES_PER_DAY;
  const events: RecapAhead[] = upcomingOccurrences(data, days, 50)
    .filter((o) => !isEveryday(data, o.event))
    .map((o) => ({
      key: `event:${o.event.id}:${o.at}`,
      at: o.at,
      title: o.event.title,
      kind: 'event',
      eventId: o.event.id,
    }));
  const steps: RecapAhead[] = openClocks(data.clocks, now)
    .filter((view) => !view.paused && view.next && view.next.at <= until)
    .map((view) => ({
      key: `clock:${view.clock.id}:${view.next!.index}`,
      at: view.next!.at,
      title: view.next!.step.text,
      kind: 'clock',
      clockTitle: view.clock.title,
      storyId: storyOfClock(data, view.clock.id)?.id ?? null,
    }));
  return [...events, ...steps]
    .sort((a, b) => a.at - b.at || a.title.localeCompare(b.title, 'de'))
    .slice(0, limit);
}

/**
 * Der Rückblick auf den Abend vor dem mit dieser Nummer. Ohne Nummer gilt der Abend, dem das
 * Blatt „Abend vorbereiten“ gilt (wie bei `lastSessionLines`). null ohne früheren Abend.
 */
export function recap(
  data: CampaignData,
  number: number = prepView(data).number,
  limit: number = RECAP_LINES,
): Recap | null {
  const session = sessionBefore(data, number);
  if (!session) return null;
  const { entries, more } = recapEntries(data, session.id, limit);
  const ends = looseEnds(data);
  return {
    session,
    running: data.state.sessionId === session.id,
    told: session.recap.trim(),
    entries,
    more,
    placeId: data.state.placeId,
    open: {
      total: ends.length,
      groups: LOOSE_REASONS.map((reason) => ({
        reason,
        count: ends.filter((end) => end.reason === reason).length,
      })).filter((group) => group.count > 0),
    },
    ahead: recapAhead(data),
  };
}

/**
 * Hat der Spielleiter in diesem Abend schon etwas festgehalten? Eingetretene Termine und Schritte
 * von Uhren zählen nicht – wer zu Beginn die Zeit vorstellt, sieht den Rückblick weiter.
 */
export function hasRecorded(data: CampaignData, sessionId: string): boolean {
  return Object.values(data.chronicle).some(
    (entry) => entry.sessionId === sessionId && isOwnEntry(entry),
  );
}

/**
 * Der Rückblick am Spieltisch: nur, solange ein Abend läuft, in ihm noch nichts festgehalten ist
 * und der Spielleiter ihn für diesen Abend nicht weggeklickt hat.
 */
export function tableRecap(data: CampaignData): Recap | null {
  const session = currentSession(data);
  if (!session || data.state.recapDismissed === session.id) return null;
  if (hasRecorded(data, session.id)) return null;
  return recap(data, session.number, RECAP_TABLE_LINES);
}
