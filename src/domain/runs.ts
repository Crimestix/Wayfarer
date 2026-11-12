/**
 * Regelmäßige Abläufe: Transporte, Lieferungen, Patrouillen, Boten – wiederkehrende Reisen mit
 * Strecke, Fahrplan, Träger und Betreiber. Sie laufen von selbst weiter, ohne Meldung. Ohne
 * Fahrplan wüsste Wayfarer nicht, wann etwas fehlt – darum gehört er zu jedem Ablauf.
 *
 * Was eindeutig folgt, geschieht einfach: Ein verschlammter Weg verzögert die Ankunft; fehlt der
 * Betreiber oder ist der Ablauf ausgesetzt, fährt niemand. Was nur naheliegt – der Weg war am Tag
 * der Abfahrt nicht passierbar –, ist ein Vorschlag: Ob die Fahrt ausfällt, entscheidet der
 * Spielleiter. Fällt sie aus, weiß man am Ziel zur fälligen Zeit, dass etwas fehlt – nicht, warum.
 *
 * Reine Funktionen.
 */
import { occurrencesOf } from './derive';
import type { CalendarEvent, CampaignData, Run } from './schema';
import { formatDayMonth } from './time/calendar';
import { wayCondition } from './wayState';
import { routeBetween, wayMinutes, type Route } from './ways';

/** So weit zurück fragt Wayfarer noch, ob eine Fahrt ausgefallen ist – danach gilt sie als gefahren. */
export const RUN_WINDOW = 14 * 24 * 60;

export interface Trip {
  run: Run;
  /** Abfahrt nach Fahrplan – zugleich die Kennung der Fahrt. */
  departs: number;
  /** Ankunft: Abfahrt plus Reisezeit, wie das Wetter am Tag der Abfahrt sie zulässt. */
  arrives: number;
  /** Ausgefallen – vom Spielleiter so entschieden. */
  missed: boolean;
  /** Ein Weg der Strecke war am Tag der Abfahrt nicht passierbar: „Moorsteg (Hohenfurt – Aalinsel)“. */
  blockedBy: string | null;
  /** Wetter hat die Fahrt verzögert, in Minuten. */
  delay: number;
}

/** Der Fahrplan als Termin, damit die Kalenderrechnung ihn versteht. */
const schedule = (run: Run): CalendarEvent =>
  ({
    id: run.id,
    rev: 0,
    created: '',
    updated: '',
    title: run.name,
    at: run.start,
    timed: true,
    kind: 'world',
    details: '',
    placeId: null,
    refs: [],
    durationDays: null,
    repeat: run.every,
    skip: [],
    done: false,
    weight: 'auto',
    threadId: null,
  }) satisfies CalendarEvent;

/** Die Strecke eines Ablaufs über das Wegenetz – ohne Wetter gerechnet; null, wenn es keine gibt. */
export function runRoute(
  data: Pick<CampaignData, 'entities' | 'paths' | 'maps'>,
  run: Run,
): Route | null {
  const { entities, paths, maps } = data;
  return routeBetween({ entities, paths, maps }, run.fromId, run.toId);
}

/**
 * Warum ein Ablauf gerade gar nicht fährt – null, wenn er fährt. Das folgt eindeutig: Er ist
 * ausgesetzt, sein Betreiber oder Träger ist tot, verschollen oder gelöscht.
 */
export function runProblem(data: Pick<CampaignData, 'entities'>, run: Run): string | null {
  if (run.stoppedAt !== null) return run.stopReason || 'Ausgesetzt';
  for (const [id, role] of [
    [run.operatorId, 'Der Betreiber'],
    [run.carrierId, 'Der Träger'],
  ] as const) {
    if (!id) continue;
    const entity = data.entities[id];
    if (!entity) return `${role} fehlt: Den Eintrag gibt es nicht mehr`;
    if (entity.kind === 'person' && entity.person.status === 'dead')
      return `${role} fehlt: ${entity.name} ist tot`;
    if (entity.kind === 'person' && entity.person.status === 'missing')
      return `${role} fehlt: ${entity.name} ist verschollen`;
  }
  return null;
}

/** Die Fahrten eines Ablaufs mit Abfahrt im Zeitraum [from, to] – früheste zuerst. */
export function tripsBetween(data: CampaignData, run: Run, from: number, to: number): Trip[] {
  // Ein ausgesetzter Ablauf fährt ab dem Aussetzen nicht mehr.
  const end = run.stoppedAt === null ? to : Math.min(to, run.stoppedAt - 1);
  if (end < from) return [];
  const route = runRoute(data, run);
  const missed = new Set(run.missed);
  return occurrencesOf(data.campaign.calendar, schedule(run), from, end).map(({ at }) => {
    let [minutes, delay] = [0, 0];
    let blockedBy: string | null = null;
    for (const leg of route?.legs ?? []) {
      const dry = wayMinutes(data, leg.path) ?? 0;
      const weather = wayCondition(data, leg.path, at);
      minutes += dry * weather.factor;
      delay += dry * (weather.factor - 1);
      if (weather.state === 'lost' && !blockedBy) {
        const [a, b] = [
          data.entities[leg.fromId]?.name ?? '?',
          data.entities[leg.toId]?.name ?? '?',
        ];
        blockedBy = leg.path.name ? `${leg.path.name} (${a} – ${b})` : `${a} – ${b}`;
      }
    }
    return {
      run,
      departs: at,
      arrives: at + Math.round(minutes),
      missed: missed.has(at),
      blockedBy,
      delay: Math.round(delay),
    };
  });
}

export type RunPhase = 'stopped' | 'underway' | 'waiting';

export interface RunStatus {
  run: Run;
  phase: RunPhase;
  /** Warum er nicht fährt – nur bei `stopped`. */
  problem: string | null;
  /** Die Fahrt, die gerade unterwegs ist. */
  current: Trip | null;
  /** Die nächste Abfahrt. */
  next: Trip | null;
  /** Es gibt keinen Weg im Wegenetz: Die Reisezeit ist unbekannt. */
  noRoute: boolean;
}

/** Wo ein Ablauf gerade steht: unterwegs, wartet auf die nächste Abfahrt oder fährt nicht. */
export function runStatus(data: CampaignData, run: Run): RunStatus {
  const now = data.state.now;
  const problem = runProblem(data, run);
  const noRoute = runRoute(data, run) === null;
  if (problem) return { run, phase: 'stopped', problem, current: null, next: null, noRoute };
  // Weit genug zurück, um eine Fahrt zu finden, die noch unterwegs ist.
  const recent = tripsBetween(data, run, now - 60 * 24 * 60, now);
  const current = [...recent].reverse().find((trip) => !trip.missed && trip.arrives > now) ?? null;
  const next = tripsBetween(data, run, now + 1, now + 800 * 24 * 60)[0] ?? null;
  return { run, phase: current ? 'underway' : 'waiting', problem: null, current, next, noRoute };
}

/**
 * Ist die Bedingung „dieser Ablauf trifft ein“ zu einem Zeitpunkt weggefallen? Ja, wenn er nicht
 * mehr fährt – oder wenn seine letzte Fahrt, die bis dahin hätte ankommen sollen, ausgefallen
 * ist. Gibt den Grund zurück, sonst null.
 */
export function runFailure(data: CampaignData, run: Run, at: number): string | null {
  const problem = runProblem(data, run);
  if (problem) return `${run.name} fährt nicht: ${problem}`;
  const due = tripsBetween(data, run, Math.max(run.start, at - 400 * 24 * 60), at).filter(
    (trip) => trip.arrives <= at,
  );
  const last = due[due.length - 1];
  return last?.missed
    ? `${run.name} ist ausgeblieben (${formatDayMonth(data.campaign.calendar, last.arrives)})`
    : null;
}

/** Fahrten der letzten Zeit, bei denen sich fragt, ob sie ausgefallen sind – noch unentschieden. */
export function openTrips(data: CampaignData): Trip[] {
  const now = data.state.now;
  return Object.values(data.runs)
    .filter((run) => runProblem(data, run) === null)
    .flatMap((run) => {
      const decided = new Set([...run.missed, ...run.decided]);
      return tripsBetween(data, run, now - RUN_WINDOW, now).filter(
        (trip) => trip.blockedBy !== null && !decided.has(trip.departs),
      );
    })
    .sort((a, b) => a.departs - b.departs || a.run.name.localeCompare(b.run.name, 'de'));
}

/** Fahrten, die ausgefallen sind und im Zeitraum hätten ankommen sollen – das Ausbleiben am Ziel. */
export function missedTrips(data: CampaignData, since: number): Trip[] {
  const now = data.state.now;
  return Object.values(data.runs).flatMap((run) =>
    tripsBetween(data, run, since - 60 * 24 * 60, now).filter(
      (trip) => trip.missed && trip.arrives >= since && trip.arrives <= now,
    ),
  );
}

/** „alle 2 Wochen“, „jeden Tag“, „jeden Monat“ */
export function scheduleText(run: Pick<Run, 'every'>): string {
  const { every, unit } = run.every;
  const one = { day: 'jeden Tag', week: 'jede Woche', month: 'jeden Monat', year: 'jedes Jahr' };
  const many = { day: 'Tage', week: 'Wochen', month: 'Monate', year: 'Jahre' };
  return every === 1 ? one[unit] : `alle ${every} ${many[unit]}`;
}
