/**
 * Befehle, die mehrere Dokumente zusammen ändern. Die Oberfläche ruft diese Funktionen auf,
 * statt Zeit, Ort, Beziehungen und Chronik einzeln zu verändern – so bleiben sie stimmig.
 */
import { attitudeModeChoice, type AttitudeMode } from '../domain/attitudeSetting';
import { clockView, dueSteps, type ClockOccurrence } from '../domain/clock';
import {
  entityName,
  findRelation,
  linksTo,
  occurrencesBetween,
  replaceLink,
  type Occurrence,
  type PromiseOutcome,
} from '../domain/derive';
import { neighboursOfSort } from '../domain/history';
import {
  detach,
  fireFrom,
  frontOf,
  groupsToSplit,
  isSplit,
  isWholeLed,
  ledMembers,
  settleGroups,
  syncedGroups,
} from '../domain/party';
import { carriedChange, prepView, resolveContent } from '../domain/prep';
import {
  PARTY_ID,
  createChronicleEntry,
  createPrep,
  createRelation,
  createSession,
  newId,
  type ChronicleEntry,
  type ChronicleKind,
  type Clock,
  type PartyGroup,
  type PlayState,
  type Relation,
  type Session,
  type Timer,
} from '../domain/schema';
import { runFailure } from '../domain/runs';
import type { WorldTime } from '../domain/time/calendar';
import type { CampaignDb } from './db';

export interface TimeAdvanceResult {
  from: WorldTime;
  to: WorldTime;
  /** Termine, die in der übersprungenen Zeit eingetreten sind. */
  occurred: Occurrence[];
  /** Timer, die abgelaufen sind. */
  expired: Timer[];
  /** Schritte von Uhren, die eingetreten sind – in der Reihenfolge ihres Eintretens. */
  steps: ClockOccurrence[];
  /** Uhren, die stehen geblieben sind, weil die Bedingung ihres nächsten Schrittes weggefallen ist. */
  blocked: ClockBlock[];
}

export interface ClockBlock {
  clock: Clock;
  at: WorldTime;
  /** „Die Lieferung trifft ein: Salzkahn ist ausgeblieben (12. Tauwind)“ */
  reason: string;
}

/**
 * Lässt Weltzeit vergehen. Eingetretene Termine kommen in die Chronik, abgelaufene Timer
 * werden beendet, fällige Schritte der Uhren treten ein und stehen als Veränderung in der
 * Chronik. Der Sprung lässt sich mit undoTimeAdvance zurücknehmen.
 *
 * Getrennte Wege: Es rückt die Uhr der geleiteten Teilgruppe vor. Von selbst tritt nur ein, was
 * hinter der vordersten Uhr liegt (`fireFrom`) – was eine andere Teilgruppe schon erreicht hat,
 * ist längst eingetreten und tritt nie doppelt ein.
 */
export function advanceTime(db: CampaignDb, to: WorldTime): TimeAdvanceResult {
  const data = db.getSnapshot();
  const from = data.state.now;
  if (!Number.isSafeInteger(to) || to <= from)
    throw new Error('Der neue Zeitpunkt muss nach der aktuellen Weltzeit liegen.');
  return db.batch(() => {
    const result = fireWorld(db, from, fireFrom(data, from), to);
    db.setState({ now: to, previousNow: from });
    return result;
  });
}

/**
 * Lässt eintreten, was zwischen `start` (ausschließlich) und `to` von selbst geschieht: Termine,
 * Schritte der Uhren, abgelaufene Timer. `from` ist nur für die Meldung. Liegt `to` nicht hinter
 * `start`, geschieht nichts – so tritt nichts zweimal ein.
 */
function fireWorld(
  db: CampaignDb,
  from: WorldTime,
  start: WorldTime,
  to: WorldTime,
): TimeAdvanceResult {
  const data = db.getSnapshot();
  if (to <= start) return { from, to, occurred: [], expired: [], steps: [], blocked: [] };
  const occurred = occurrencesBetween(data, start + 1, to).filter(
    (o) => !(o.event.done && !o.event.repeat),
  );
  const expired = Object.values(data.timers).filter((t) => !t.done && t.end > start && t.end <= to);
  // Ein Schritt, der an einem Ablauf hängt, tritt nur ein, wenn der Ablauf nicht ausgeblieben
  // ist. Sonst bleibt die Uhr dort stehen: blockiert. Sie plant nie von selbst um.
  const steps: ClockOccurrence[] = [];
  const blocked: ClockBlock[] = [];
  for (const clock of Object.values(data.clocks))
    for (const occurrence of dueSteps(clock, start, to)) {
      const run = occurrence.step.runId ? data.runs[occurrence.step.runId] : undefined;
      const failure = run ? runFailure(data, run, occurrence.at) : null;
      if (failure) {
        const needs = occurrence.step.needs.trim();
        blocked.push({
          clock,
          at: occurrence.at,
          reason: needs ? `${needs}: ${failure}` : failure,
        });
        break;
      }
      steps.push(occurrence);
    }
  steps.sort((a, b) => a.at - b.at || a.clock.title.localeCompare(b.clock.title, 'de'));
  db.batch(() => {
    for (const clock of new Set(steps.map((s) => s.clock))) {
      const mine = new Map(steps.filter((s) => s.clock === clock).map((s) => [s.step.id, s.at]));
      db.patch('clocks', clock.id, {
        steps: clock.steps.map((step) =>
          mine.has(step.id) ? { ...step, at: mine.get(step.id)! } : step,
        ),
      });
    }
    for (const block of blocked)
      db.patch('clocks', block.clock.id, { pausedAt: block.at, blocked: block.reason });
    for (const s of steps)
      db.put('chronicle', stepEntry(s.clock, s.step.id, s.step.text, s.at, data.state.sessionId));
    for (const o of occurred) {
      // Wiederkehrende Termine (Markttag, Wachwechsel …) sind Routine: Sie stehen in der Meldung,
      // aber nicht bei jedem Eintreten in der Chronik – sonst füllt eine lange Reise sie mit Wiederholungen.
      if (o.event.repeat) continue;
      db.put(
        'chronicle',
        createChronicleEntry({
          kind: 'event',
          at: o.at,
          sessionId: data.state.sessionId,
          text: o.event.title,
          placeId: o.event.placeId,
          refs: o.event.refs,
          eventId: o.event.id,
        }),
      );
      if (o.event.kind === 'world' && !o.event.repeat)
        db.patch('events', o.event.id, { done: true });
    }
    for (const timer of expired) db.patch('timers', timer.id, { done: true });
  });
  return { from, to, occurred, expired, steps, blocked };
}

/**
 * Nimmt den letzten Zeitsprung samt seiner automatischen Folgen zurück. Bei getrennter Gruppe
 * nur, was dieser Sprung über die vorderste Uhr der anderen hinaus ausgelöst hat.
 */
export function undoTimeAdvance(db: CampaignDb): boolean {
  const data = db.getSnapshot();
  const back = data.state.previousNow;
  if (back === null || back >= data.state.now) return false;
  const now = data.state.now;
  const start = fireFrom(data, back);
  db.batch(() => {
    if (now > start) reopenBetween(db, start, now);
    db.setState({ now: back, previousNow: null });
  });
  return true;
}

export interface Reopened {
  events: number;
  steps: number;
  timers: number;
}

/**
 * Öffnet wieder, was in der Zeit nach `back` bis einschließlich `upto` von selbst eingetreten
 * war: Termine (samt ihrer Chronikzeilen), Timer, Schritte von Uhren (samt ihrer Zeilen) und
 * Blockaden. Was der Spielleiter selbst festgehalten hat, bleibt. Die Weltzeit stellt es nicht.
 */
export function reopenBetween(db: CampaignDb, back: WorldTime, upto: WorldTime): Reopened {
  const data = db.getSnapshot();
  const count: Reopened = { events: 0, steps: 0, timers: 0 };
  db.batch(() => {
    for (const entry of Object.values(data.chronicle)) {
      if (entry.kind !== 'event' || entry.at <= back || entry.at > upto) continue;
      db.remove('chronicle', entry.id);
      count.events++;
      const event = entry.eventId ? data.events[entry.eventId] : undefined;
      if (event?.done && event.kind === 'world' && !event.repeat)
        db.patch('events', event.id, { done: false });
    }
    for (const timer of Object.values(data.timers))
      if (timer.done && timer.end > back && timer.end <= upto) {
        db.patch('timers', timer.id, { done: false });
        count.timers++;
      }
    // Schritte der Uhren, die in dieser Zeit eingetreten sind, stehen wieder aus.
    for (const clock of Object.values(data.clocks)) {
      const reopened = clock.steps.map((step) =>
        step.at !== null && !step.skipped && step.at > back && step.at <= upto
          ? { ...step, at: null }
          : step,
      );
      const changed = reopened.filter((step, index) => step !== clock.steps[index]).length;
      count.steps += changed;
      if (changed) db.patch('clocks', clock.id, { steps: reopened });
      // Was in dieser Zeit blockiert wurde, läuft wieder.
      if (
        clock.blocked &&
        clock.pausedAt !== null &&
        clock.pausedAt > back &&
        clock.pausedAt <= upto
      )
        db.patch('clocks', clock.id, { pausedAt: null, blocked: '' });
    }
    for (const entry of Object.values(data.chronicle))
      if (entry.clockId && entry.kind === 'change' && entry.at > back && entry.at <= upto) {
        const step = data.clocks[entry.clockId]?.steps.find((s) => s.id === entry.stepId);
        if (!step?.skipped) db.remove('chronicle', entry.id);
      }
  });
  return count;
}

export interface SettleSummary {
  reopened: Reopened;
  /** Doppelt eingetretene Zeilen, die zusammengelegt wurden. */
  merged: number;
}

/**
 * Nach der Wahl der Weltzeit beim Abgleich (beide Rechner hatten Zeit vergehen lassen): Lag die
 * andere Weltzeit später, steht wieder aus, was zwischen der gewählten und der anderen eingetreten
 * war. Danach werden doppelt eingetretene Zeilen zusammengelegt (gleicher Termin und gleiche
 * Zeit, gleiche Uhr und gleicher Schritt) – es bleibt die mit der kleineren Kennung. Was der
 * Spielleiter selbst festgehalten hat, bleibt immer.
 */
export function settleTime(db: CampaignDb, chosen: WorldTime, other: WorldTime): SettleSummary {
  let reopened: Reopened = { events: 0, steps: 0, timers: 0 };
  let merged = 0;
  db.batch(() => {
    if (other > chosen) reopened = reopenBetween(db, chosen, other);
    const seen = new Map<string, string>();
    const entries = Object.values(db.getSnapshot().chronicle).sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    for (const entry of entries) {
      let key: string | null = null;
      if (entry.kind === 'event' && entry.eventId) key = `event:${entry.eventId}:${entry.at}`;
      else if (entry.kind === 'change' && entry.clockId && entry.stepId)
        key = `step:${entry.clockId}:${entry.stepId}`;
      if (!key) continue;
      if (seen.has(key)) {
        db.remove('chronicle', entry.id);
        merged++;
      } else seen.set(key, entry.id);
    }
  });
  return { reopened, merged };
}

// ── Uhren ──────────────────────────────────────────────────────────────────

/** Der Chronik-Eintrag zu einem Schritt einer Uhr: eine Veränderung der Welt. */
function stepEntry(
  clock: Clock,
  stepId: string,
  text: string,
  at: WorldTime,
  sessionId: string | null,
): ChronicleEntry {
  return createChronicleEntry({
    kind: 'change',
    at,
    sessionId,
    text,
    placeId: clock.placeId,
    refs: [...new Set([...(clock.ownerId ? [clock.ownerId] : []), ...clock.refs])],
    secret: clock.secret,
    clockId: clock.id,
    stepId,
  });
}

/** Hält eine Uhr an: Solange tritt kein Schritt ein. */
export function pauseClock(db: CampaignDb, clockId: string): void {
  const data = db.getSnapshot();
  const clock = data.clocks[clockId];
  if (clock && clock.pausedAt === null) db.patch('clocks', clockId, { pausedAt: data.state.now });
}

/**
 * Blockiert eine Uhr: Die Bedingung ihres nächsten Schrittes ist weggefallen. Sie steht, bis der
 * Spielleiter entscheidet, wie es weitergeht.
 */
export function blockClock(db: CampaignDb, clockId: string, reason: string): void {
  const data = db.getSnapshot();
  const clock = data.clocks[clockId];
  if (!clock) return;
  db.patch('clocks', clockId, {
    pausedAt: clock.pausedAt ?? data.state.now,
    blocked: reason.trim() || 'Die Bedingung ist weggefallen',
  });
}

/**
 * Lässt eine angehaltene oder blockierte Uhr weiterlaufen; die Standzeit schiebt den nächsten
 * Schritt hinaus. War sie blockiert, hat der Spielleiter entschieden, dass es trotzdem weitergeht:
 * Der nächste Schritt hängt dann nicht mehr an seinem Ablauf.
 */
export function resumeClock(db: CampaignDb, clockId: string): void {
  const data = db.getSnapshot();
  const clock = data.clocks[clockId];
  if (!clock || clock.pausedAt === null) return;
  const standing = Math.max(0, data.state.now - clock.pausedAt);
  const next = clock.steps.findIndex((step) => step.at === null);
  db.patch('clocks', clockId, {
    pausedAt: null,
    blocked: '',
    steps: clock.steps.map((step, index) =>
      index === next
        ? { ...step, delay: step.delay + standing, runId: clock.blocked ? null : step.runId }
        : step,
    ),
  });
}

/** Schiebt den nächsten Schritt um `minutes` hinaus (negativ: zieht ihn vor). */
export function delayClock(db: CampaignDb, clockId: string, minutes: number): void {
  const clock = db.getSnapshot().clocks[clockId];
  const next = clock?.steps.findIndex((step) => step.at === null) ?? -1;
  if (!clock || next < 0 || !Number.isSafeInteger(minutes)) return;
  db.patch('clocks', clockId, {
    steps: clock.steps.map((step, index) =>
      index === next ? { ...step, delay: step.delay + minutes } : step,
    ),
  });
}

/**
 * Schließt den nächsten Schritt einer Uhr von Hand ab: Er tritt jetzt ein (`prevented` = false)
 * oder die Gruppe hat ihn verhindert. Beides steht in der Chronik. Gibt `undo` zurück.
 */
export function settleStep(
  db: CampaignDb,
  clockId: string,
  prevented: boolean,
): (() => void) | null {
  const data = db.getSnapshot();
  const clock = data.clocks[clockId];
  const next = clock ? clockView(clock, data.state.now).next : null;
  if (!clock || !next) return null;
  const now = data.state.now;
  return db.batch(() => {
    db.patch('clocks', clockId, {
      steps: clock.steps.map((step) =>
        step.id === next.step.id ? { ...step, at: now, skipped: prevented } : step,
      ),
    });
    const entry = db.put(
      'chronicle',
      stepEntry(
        clock,
        next.step.id,
        prevented ? `Verhindert: ${next.step.text}` : next.step.text,
        now,
        data.state.sessionId,
      ),
    );
    return () =>
      db.batch(() => {
        const current = db.getSnapshot().clocks[clockId];
        if (current)
          db.patch('clocks', clockId, {
            steps: current.steps.map((step) =>
              step.id === next.step.id ? { ...step, at: null, skipped: false } : step,
            ),
          });
        if (db.getSnapshot().chronicle[entry.id]) db.remove('chronicle', entry.id);
      });
  });
}

/** Stellt die Weltzeit direkt (Korrektur), ohne Termine auszulösen. */
export function setTime(db: CampaignDb, to: WorldTime): void {
  const from = db.getSnapshot().state.now;
  if (to === from) return;
  db.setState({ now: to, previousNow: null });
}

/**
 * Die Gruppe wechselt den Ort. Der Wechsel steht in der Chronik; daraus entstehen die Besuche.
 * Getrennte Wege: Es zieht die geleitete Teilgruppe (`who` leer oder genau sie); zieht nur ein
 * Teil von ihr, trennt er sich und steht als eigene Teilgruppe am Ziel (`sendOff`).
 */
export function moveParty(
  db: CampaignDb,
  toId: string | null,
  text = '',
  who: readonly string[] = [],
): ChronicleEntry | null {
  const data = db.getSnapshot();
  if (!isWholeLed(data, who)) return sendOff(db, who, toId, 0, text).entry;
  const fromId = data.state.placeId;
  if (fromId === toId) return null;
  const movers = isSplit(data) ? ledMembers(data) : [];
  return db.batch(() => {
    const entry = db.put(
      'chronicle',
      createChronicleEntry({
        kind: 'travel',
        at: data.state.now,
        sessionId: data.state.sessionId,
        text,
        placeId: toId,
        refs: [toId, fromId].filter((id): id is string => !!id),
        travel: movers.length ? { fromId, toId, who: movers } : { fromId, toId },
      }),
    );
    db.setState({ placeId: toId });
    return entry;
  });
}

// ── Getrennte Wege ─────────────────────────────────────────────────────────

/** Der Stand der Teilgruppen vor einem Handgriff – für „Rückgängig“. */
interface PartyBefore {
  state: Pick<PlayState, 'now' | 'previousNow' | 'placeId' | 'groups' | 'leadId'>;
  front: WorldTime;
}

function partyBefore(db: CampaignDb): PartyBefore {
  const { now, previousNow, placeId, groups, leadId } = db.getSnapshot().state;
  return { state: { now, previousNow, placeId, groups, leadId }, front: frontOf(db.getSnapshot()) };
}

/**
 * „Rückgängig“ für einen Handgriff an den Teilgruppen: Seine Einträge gehen, was er über die
 * vorderste Uhr hinaus ausgelöst hat, steht wieder aus, und die Teilgruppen stehen wie vorher.
 */
function partyUndo(db: CampaignDb, before: PartyBefore, created: string[]): () => void {
  return () =>
    db.batch(() => {
      for (const id of created) if (db.getSnapshot().chronicle[id]) db.remove('chronicle', id);
      const front = frontOf(db.getSnapshot());
      if (front > before.front) reopenBetween(db, before.front, front);
      db.setState(before.state);
    });
}

const noAdvance = (at: WorldTime): TimeAdvanceResult => ({
  from: at,
  to: at,
  occurred: [],
  expired: [],
  steps: [],
  blocked: [],
});

export interface PartyResult {
  /** Was über die vorderste Uhr hinaus von selbst eingetreten ist. */
  advance: TimeAdvanceResult;
  /** Die neuen Einträge der Chronik (Ortswechsel, Tätigkeiten). */
  entries: ChronicleEntry[];
  undo: () => void;
}

/** Eine Zeile im Dialog „Wer macht was?“. */
export interface PartyRow {
  memberIds: string[];
  /** Wo; Vorgabe: der Ort der geleiteten Teilgruppe. */
  placeId?: string | null;
  /** Was, in den Worten des Spielleiters; leer = nichts Bestimmtes. */
  text?: string;
  /** Wie lange in Minuten; 0 = keine Dauer (die Teilgruppe bleibt in der Zeit). */
  minutes?: number;
}

/**
 * Trennt die geleitete Teilgruppe (oder die ganze Gruppe): Jede Zeile wird eine eigene
 * Teilgruppe. Ein anderer Ort ist ein Ortswechsel; eine Dauer ist eine Tätigkeit (Eintrag der Art
 * „Freie Zeit“ mit Minuten und ihrem Wortlaut je Gefährte), und die Uhr dieser Teilgruppe rückt
 * um die Dauer vor – was dabei die vorderste Uhr überholt, tritt ein. Wer in keiner Zeile steht,
 * bleibt. Ohne Dauer steht der Wortlaut als Notiz da. Wayfarer schreibt keinen Text.
 */
export function splitParty(db: CampaignDb, rows: PartyRow[]): PartyResult | { problem: string } {
  const data = db.getSnapshot();
  const { groups: start, leadId } = groupsToSplit(data);
  const led = start.find((group) => group.id === leadId)!;
  const used = new Set<string>();
  if (!rows.length) return { problem: 'Wer macht was? Es fehlt eine Zeile.' };
  for (const row of rows) {
    if (!row.memberIds.length) return { problem: 'Jede Zeile braucht mindestens einen Gefährten.' };
    for (const id of row.memberIds) {
      if (!led.memberIds.includes(id))
        return { problem: `${entityName(data, id)} ist gerade nicht bei der geleiteten Gruppe.` };
      if (used.has(id)) return { problem: `${entityName(data, id)} steht in zwei Zeilen.` };
      used.add(id);
    }
  }
  const before = partyBefore(db);
  const at = data.state.now;
  const sessionId = data.state.sessionId;
  return db.batch(() => {
    let groups = start;
    const entries: ChronicleEntry[] = [];
    const fresh: PartyGroup[] = [];
    for (const row of rows) {
      const who = [...row.memberIds];
      const placeId = row.placeId === undefined ? led.placeId : row.placeId;
      const minutes = Math.max(0, Math.round(row.minutes ?? 0));
      const text = (row.text ?? '').trim();
      if (placeId !== led.placeId)
        entries.push(
          db.put(
            'chronicle',
            createChronicleEntry({
              kind: 'travel',
              at,
              sessionId,
              placeId,
              refs: [placeId, led.placeId, ...who].filter((id): id is string => !!id),
              travel: { fromId: led.placeId, toId: placeId, who },
              party: who,
            }),
          ),
        );
      let doing: PartyGroup['doing'] = null;
      if (minutes > 0) {
        const entry = db.put(
          'chronicle',
          createChronicleEntry({
            kind: 'downtime',
            at,
            sessionId,
            placeId,
            refs: who,
            downtime: {
              days: 0,
              minutes,
              activities: who.map((characterId) => ({ characterId, text })),
            },
            party: who,
          }),
        );
        entries.push(entry);
        doing = { entryId: entry.id, from: at, until: at + minutes };
      } else if (text)
        entries.push(
          db.put(
            'chronicle',
            createChronicleEntry({
              kind: 'note',
              at,
              sessionId,
              placeId,
              text,
              refs: who,
              party: who,
            }),
          ),
        );
      const group: PartyGroup = { id: newId(), memberIds: who, placeId, now: at + minutes, doing };
      fresh.push(group);
      groups = detach(groups, group);
    }
    const until = Math.max(at, ...fresh.map((group) => group.now));
    const advance = fireWorld(db, at, before.front, until);
    // Bleibt von der geleiteten niemand, geht das Spiel bei der größten neuen ohne Dauer weiter.
    const stays = groups.find((group) => group.id === leadId)?.memberIds.length;
    const idle = fresh
      .filter((group) => group.now === at)
      .sort((a, b) => b.memberIds.length - a.memberIds.length)[0];
    const next = stays ? leadId : (idle?.id ?? null);
    db.setState({ ...settleGroups(groups, next, data.state), previousNow: null });
    return {
      advance,
      entries,
      undo: partyUndo(
        db,
        before,
        entries.map((e) => e.id),
      ),
    };
  });
}

/**
 * Ein Teil der geleiteten Teilgruppe geht an einen Ort: Er trennt sich, seine Uhr rückt um den
 * Weg vor, dann steht er am Ziel (der Ortswechsel zur Ankunftszeit). Die geleitete bleibt in ihrer
 * Zeit. Was die vorderste Uhr dabei überholt, tritt ein.
 */
export function sendOff(
  db: CampaignDb,
  who: readonly string[],
  toId: string | null,
  minutes: number,
  text = '',
): PartyResult & { entry: ChronicleEntry | null } {
  const data = db.getSnapshot();
  const { groups: start, leadId } = groupsToSplit(data);
  const led = start.find((group) => group.id === leadId)!;
  const movers = who.filter((id) => led.memberIds.includes(id));
  const before = partyBefore(db);
  const at = data.state.now;
  const length = Math.max(0, Math.round(minutes));
  return db.batch(() => {
    const entry =
      toId === led.placeId
        ? null
        : db.put(
            'chronicle',
            createChronicleEntry({
              kind: 'travel',
              at: at + length,
              sessionId: data.state.sessionId,
              text,
              placeId: toId,
              refs: [toId, led.placeId, ...movers].filter((id): id is string => !!id),
              travel: { fromId: led.placeId, toId, who: movers },
              party: movers,
            }),
          );
    const group: PartyGroup = {
      id: newId(),
      memberIds: movers,
      placeId: toId,
      now: at + length,
      doing: entry && length > 0 ? { entryId: entry.id, from: at, until: at + length } : null,
    };
    const advance = fireWorld(db, at, before.front, at + length);
    db.setState({
      ...settleGroups(detach(start, group), leadId, data.state),
      previousNow: null,
    });
    const entries = entry ? [entry] : [];
    return {
      advance,
      entries,
      entry,
      undo: partyUndo(
        db,
        before,
        entries.map((e) => e.id),
      ),
    };
  });
}

/**
 * Leitet eine andere Teilgruppe: Ort und Zeit am Tisch werden ihre. Nichts steht in der Chronik,
 * nichts tritt ein und nichts wird zurückgenommen – die Uhren bleiben, wie sie sind.
 */
export function leadGroup(db: CampaignDb, groupId: string): void {
  const data = db.getSnapshot();
  if (!isSplit(data) || data.state.leadId === groupId) return;
  const groups = syncedGroups(data.state);
  const target = groups.find((group) => group.id === groupId);
  if (!target) return;
  db.setState({
    groups,
    leadId: target.id,
    now: target.now,
    placeId: target.placeId,
    previousNow: null,
  });
}

/**
 * Holt eine zurückliegende Teilgruppe auf eine spätere Zeit nach – nur auf Klick, nie von selbst.
 * Was sie dabei tat, schreibt der Spielleiter, wenn er will. Was die vorderste Uhr dabei
 * überholt, tritt ein (sonst nichts).
 */
export function catchUp(db: CampaignDb, groupId: string, to: WorldTime): PartyResult | null {
  const data = db.getSnapshot();
  const group = syncedGroups(data.state).find((g) => g.id === groupId);
  if (!group || !Number.isSafeInteger(to) || to <= group.now) return null;
  const before = partyBefore(db);
  return db.batch(() => {
    const advance = fireWorld(db, group.now, fireFrom(data, group.now, group.id), to);
    if (group.id === data.state.leadId) db.setState({ now: to, previousNow: null });
    else
      db.setState({
        groups: data.state.groups.map((g) => (g.id === group.id ? { ...g, now: to } : g)),
      });
    return { advance, entries: [], undo: partyUndo(db, before, []) };
  });
}

/**
 * Führt Teilgruppen zusammen – nur auf Klick. Die zurückliegenden werden auf die Zeit der
 * vordersten unter ihnen gezogen (dabei tritt nichts ein: Die Welt war schon dort). Wer an einem
 * anderen Ort steht, zieht zum Ort von `intoId` (Vorgabe: die geleitete, sonst die erste) – ein
 * Ortswechsel ohne Text. Bleibt eine Teilgruppe, ist die Gruppe wieder zusammen.
 */
export function mergeGroups(
  db: CampaignDb,
  groupIds: readonly string[],
  intoId?: string,
): PartyResult | null {
  const data = db.getSnapshot();
  const groups = syncedGroups(data.state);
  const chosen = groups.filter((group) => groupIds.includes(group.id));
  if (chosen.length < 2) return null;
  const target =
    chosen.find((group) => group.id === intoId) ??
    chosen.find((group) => group.id === data.state.leadId) ??
    chosen[0]!;
  const at = Math.max(...chosen.map((group) => group.now));
  const before = partyBefore(db);
  return db.batch(() => {
    const entries: ChronicleEntry[] = [];
    for (const group of chosen)
      if (group !== target && group.placeId !== target.placeId)
        entries.push(
          db.put(
            'chronicle',
            createChronicleEntry({
              kind: 'travel',
              at,
              sessionId: data.state.sessionId,
              placeId: target.placeId,
              refs: [target.placeId, group.placeId, ...group.memberIds].filter(
                (id): id is string => !!id,
              ),
              travel: { fromId: group.placeId, toId: target.placeId, who: group.memberIds },
              party: group.memberIds,
            }),
          ),
        );
    const merged: PartyGroup = {
      ...target,
      memberIds: chosen.flatMap((group) => group.memberIds),
      now: at,
      doing: null,
    };
    const rest = groups
      .filter((group) => !chosen.includes(group) || group === target)
      .map((group) => (group === target ? merged : group));
    const leadInside = chosen.some((group) => group.id === data.state.leadId);
    db.setState({
      ...settleGroups(rest, leadInside ? merged.id : data.state.leadId, data.state),
      previousNow: null,
    });
    return {
      advance: noAdvance(at),
      entries,
      undo: partyUndo(
        db,
        before,
        entries.map((e) => e.id),
      ),
    };
  });
}

export interface LogInput {
  text: string;
  kind?: Extract<ChronicleKind, 'note' | 'promise' | 'change'>;
  refs?: string[];
  /** Vorgabe: Aufenthaltsort der Gruppe. */
  placeId?: string | null;
  /** Vorgabe: aktuelle Weltzeit. */
  at?: WorldTime;
  /** Nur bei kind = promise. */
  due?: WorldTime | null;
  /** Nur für die Spielleitung. */
  secret?: boolean;
  /** Die Geschichte, zu der die Notiz gehört. */
  storyId?: string | null;
}

/** Hält fest, was am Tisch passiert ist. */
export function logEntry(db: CampaignDb, input: LogInput): ChronicleEntry {
  const data = db.getSnapshot();
  const kind = input.kind ?? 'note';
  return db.put(
    'chronicle',
    createChronicleEntry({
      kind,
      at: input.at ?? data.state.now,
      sessionId: data.state.sessionId,
      text: input.text.trim(),
      placeId: input.placeId === undefined ? data.state.placeId : input.placeId,
      refs: [...new Set(input.refs ?? [])],
      promise: kind === 'promise' ? { due: input.due ?? null, done: false, failed: false } : null,
      secret: input.secret ?? false,
      storyId: input.storyId ?? null,
    }),
  );
}

/**
 * Setzt die Haltung von `fromId` gegenüber `toId` (Entity-ID oder PARTY_ID) und hält die
 * Änderung mit Grund in der Chronik fest. Legt die Beziehung an, falls es sie noch nicht gibt.
 * Mit `mode: 'given'` („War schon so“) wird nur die Haltung eingetragen, ohne Eintrag in der
 * Chronik – das geht nur, solange die Chronik zu diesem Paar nichts erzählt
 * (`attitudeModeChoice`); sonst bleibt es eine Änderung.
 */
export function setAttitude(
  db: CampaignDb,
  fromId: string,
  toId: string,
  value: number | null,
  reason = '',
  mode: AttitudeMode = 'change',
): Relation {
  const data = db.getSnapshot();
  const existing = findRelation(data, fromId, toId);
  const before = existing?.attitude ?? null;
  const quiet = mode === 'given' && attitudeModeChoice(data, fromId, toId).givenPossible;
  return db.batch(() => {
    const relation = existing
      ? db.patch('relations', existing.id, { attitude: value })
      : db.put('relations', createRelation({ from: fromId, to: toId, attitude: value }));
    if (!quiet && (before !== value || reason.trim())) {
      db.put(
        'chronicle',
        createChronicleEntry({
          kind: 'attitude',
          at: data.state.now,
          sessionId: data.state.sessionId,
          text: reason.trim(),
          placeId: data.state.placeId,
          refs: [fromId, toId].filter((id) => id !== PARTY_ID),
          attitude: { fromId, toId, before, after: value },
        }),
      );
    }
    return relation;
  });
}

/**
 * Nimmt einen Eintrag aus der Chronik, der eine Haltung nur festgelegt hat (`attitudeSettings`):
 * Die Haltung bleibt, wie sie ist; sie galt dann schon immer. Ein späterer Eintrag zum selben
 * Paar beginnt danach bei ihr. Gibt „Rückgängig“ zurück.
 */
export function dropAttitudeSettings(db: CampaignDb, entryIds: string[]): () => void {
  const removed: ChronicleEntry[] = [];
  const patched: { id: string; before: number | null }[] = [];
  db.batch(() => {
    for (const id of entryIds) {
      const entry = db.getSnapshot().chronicle[id];
      if (!entry?.attitude) continue;
      const { next } = neighboursOfSort(db.getSnapshot(), entry);
      if (next?.attitude) {
        patched.push({ id: next.id, before: next.attitude.before });
        db.patch('chronicle', next.id, {
          attitude: { ...next.attitude, before: entry.attitude.after },
        });
      }
      removed.push(entry);
      db.remove('chronicle', entry.id);
    }
  });
  return () =>
    db.batch(() => {
      for (const entry of removed) db.put('chronicle', entry);
      for (const { id, before } of patched) {
        const entry = db.getSnapshot().chronicle[id];
        if (entry?.attitude) db.patch('chronicle', id, { attitude: { ...entry.attitude, before } });
      }
    });
}

/** Klickt einen Vorschlag weg (`domain/dismiss.ts`). Gibt „Rückgängig“ zurück. */
export function dismissSuggestion(db: CampaignDb, key: string): () => void {
  const current = db.getSnapshot().state.dismissed;
  if (current.includes(key)) return () => {};
  db.setState({ dismissed: [...current, key] });
  return () =>
    db.setState({ dismissed: db.getSnapshot().state.dismissed.filter((other) => other !== key) });
}

/** Holt weggeklickte Vorschläge zurück – eine Sorte („fit“) oder alle. Gibt „Rückgängig“ zurück. */
export function restoreSuggestions(db: CampaignDb, sort?: string): () => void {
  const before = db.getSnapshot().state.dismissed;
  db.setState({
    dismissed: sort ? before.filter((key) => key.split(':')[0] !== sort) : [],
  });
  return () => db.setState({ dismissed: before });
}

/** Hakt eine Abmachung als eingelöst ab oder öffnet sie wieder. */
export function setPromiseDone(db: CampaignDb, entryId: string, done: boolean): void {
  setPromiseOutcome(db, entryId, done ? 'kept' : 'open');
}

/** Setzt, wie eine Abmachung steht: offen, eingelöst oder gescheitert. */
export function setPromiseOutcome(db: CampaignDb, entryId: string, outcome: PromiseOutcome): void {
  const entry = db.getSnapshot().chronicle[entryId];
  if (!entry?.promise) return;
  db.patch('chronicle', entryId, {
    promise: { ...entry.promise, done: outcome !== 'open', failed: outcome === 'failed' },
  });
}

/** Beginnt eine Session; eine laufende wird vorher beendet. */
export function startSession(
  db: CampaignDb,
  init: { title?: string; realDate?: string; number?: number } = {},
): Session {
  const data = db.getSnapshot();
  const highest = Math.max(0, ...Object.values(data.sessions).map((s) => s.number));
  return db.batch(() => {
    if (data.state.sessionId) endSession(db);
    const session = db.put(
      'sessions',
      createSession({
        number: init.number ?? highest + 1,
        title: init.title ?? '',
        realDate: init.realDate ?? new Date().toISOString().slice(0, 10),
        startAt: data.state.now,
      }),
    );
    db.setState({ sessionId: session.id });
    // Was für den kommenden Abend vorbereitet wurde, ist jetzt das Blatt dieses Abends.
    const prep = Object.values(db.getSnapshot().preps).find((entry) => entry.sessionId === null);
    if (prep) db.patch('preps', prep.id, { sessionId: session.id });
    // Was vom Abend davor übrig ist, steht ab jetzt fest auf diesem Blatt – auch ohne offenes
    // Blatt. Sonst ginge es verloren, wenn an diesem Abend niemand das Blatt anfasst: Der Abend
    // danach sähe nur noch, was hier gespeichert ist.
    const view = prepView(db.getSnapshot(), 'now');
    if (view.dueFrom) {
      if (view.prep) db.patch('preps', view.prep.id, carriedChange(view.content));
      else if (view.content.pending.length > 0)
        db.put('preps', createPrep({ ...view.content, sessionId: session.id }));
    }
    return session;
  });
}

export interface PastSessionInput {
  number: number;
  title?: string;
  /** Echtes Datum des Spielabends (JJJJ-MM-TT) oder leer. */
  realDate?: string;
  startAt: WorldTime;
  endAt: WorldTime;
}

/**
 * Trägt eine vergangene Session nach. Sie läuft nicht; was in ihrem Zeitraum in der Chronik
 * steht und noch zu keiner Session gehört, wird ihr zugeordnet.
 */
export function addPastSession(db: CampaignDb, input: PastSessionInput): Session {
  if (input.endAt < input.startAt) throw new Error('Das Ende liegt vor dem Beginn.');
  const data = db.getSnapshot();
  return db.batch(() => {
    const session = db.put(
      'sessions',
      createSession({
        number: input.number,
        title: (input.title ?? '').trim(),
        realDate: input.realDate ?? '',
        startAt: input.startAt,
        endAt: input.endAt,
      }),
    );
    for (const entry of Object.values(data.chronicle))
      if (entry.sessionId === null && entry.at >= input.startAt && entry.at <= input.endAt)
        db.patch('chronicle', entry.id, { sessionId: session.id });
    return session;
  });
}

export function endSession(db: CampaignDb): void {
  const data = db.getSnapshot();
  const id = data.state.sessionId;
  if (!id) return;
  db.batch(() => {
    if (data.sessions[id]) db.patch('sessions', id, { endAt: data.state.now });
    // Das Blatt des Abends hält fest, was bis zu seinem Ende gespielt und aufgedeckt war – auch,
    // was bei der Geschichte selbst abgehakt wurde (am Spieltisch stehen ihre Szenen und Hinweise
    // bei ihr). Sonst hieße es beim Nachlesen „an diesem Abend nicht gespielt“.
    const sheet = Object.values(data.preps).find((prep) => prep.sessionId === id);
    const settled = sheet ? resolveContent(data, sheet) : null;
    if (sheet && settled && settled !== sheet)
      db.patch('preps', sheet.id, {
        scenes: settled.scenes,
        secrets: settled.secrets,
        pending: settled.pending,
      });
    db.setState({ sessionId: null });
  });
}

/** Löscht einen Eintrag der Weltdatenbank samt seiner Beziehungen und löst Verweise auf ihn. */
export function deleteEntity(db: CampaignDb, entityId: string): void {
  const data = db.getSnapshot();
  db.batch(() => {
    for (const relation of Object.values(data.relations))
      if (relation.from === entityId || relation.to === entityId)
        db.remove('relations', relation.id);
    const removed = data.entities[entityId];
    // Orte darunter rücken eine Ebene nach oben; alle anderen Angaben werden geleert.
    const grandparent = removed?.kind === 'place' ? removed.place.parentId : null;
    for (const other of Object.values(data.entities)) {
      if (other.id === entityId || !linksTo(other, entityId)) continue;
      db.put(
        'entities',
        replaceLink(
          other,
          entityId,
          other.kind === 'place' ? grandparent : null,
          removed?.name ?? '',
        ),
      );
    }
    for (const event of Object.values(data.events))
      if (event.placeId === entityId || event.refs.includes(entityId))
        db.patch('events', event.id, {
          placeId: event.placeId === entityId ? null : event.placeId,
          refs: event.refs.filter((ref) => ref !== entityId),
        });
    // Hexkarten: Der Ort verschwindet von seinem Feld; Start und Ziel einer Karte werden offen.
    for (const area of Object.values(data.areas)) {
      const onMap = area.hexes.some((hex) => hex.placeId === entityId);
      if (!onMap && area.fromId !== entityId && area.toId !== entityId) continue;
      db.patch('areas', area.id, {
        fromId: area.fromId === entityId ? null : area.fromId,
        toId: area.toId === entityId ? null : area.toId,
        hexes: onMap
          ? area.hexes.map((hex) => (hex.placeId === entityId ? { ...hex, placeId: null } : hex))
          : area.hexes,
      });
    }
    // Beute-Buch: Ein Gegenstand bleibt mit seinem Namen stehen; was für einen Gefährten
    // bereitlag, ist jetzt für die Gruppe. Ausgegebenes behält, wem es gegeben wurde.
    for (const loot of Object.values(data.loot)) {
      if (loot.itemId === entityId)
        db.patch('loot', loot.id, { itemId: null, text: loot.text.trim() || removed?.name || '' });
      if (loot.toId === entityId && !loot.given) db.patch('loot', loot.id, { toId: null });
      if (loot.holderBefore === entityId) db.patch('loot', loot.id, { holderBefore: null });
    }
    // Ein Vorhaben der freien Zeit bleibt mit seinem Namen; nur der Verweis auf den Gegenstand fällt.
    for (const track of Object.values(data.tracks))
      if (track.downtime?.itemId === entityId)
        db.patch('tracks', track.id, { downtime: { ...track.downtime, itemId: null } });
    if (data.state.placeId === entityId) db.setState({ placeId: null });
    db.remove('entities', entityId);
  });
}

/**
 * Lässt einen wiederkehrenden Termin an einem Tag ausfallen (`skip = true`) oder nimmt ihn dort
 * wieder auf. Die Reihe selbst bleibt, wie sie ist. Gibt zurück, ob sich etwas geändert hat.
 */
export function skipOccurrence(db: CampaignDb, eventId: string, day: number, skip = true): boolean {
  const event = db.getSnapshot().events[eventId];
  if (!event?.repeat || event.skip.includes(day) === skip) return false;
  const next = skip
    ? [...event.skip, day].sort((a, b) => a - b)
    : event.skip.filter((d) => d !== day);
  db.patch('events', eventId, { skip: next });
  return true;
}

/**
 * Löscht eine Session. Was in ihr festgehalten wurde, bleibt in der Chronik, gehört dann aber
 * zu keiner Session mehr. Läuft die Session gerade, endet sie damit. War sie der jüngste Abend
 * (etwa versehentlich begonnen), ist ihr Blatt wieder das offene für den kommenden Abend – was
 * vorbereitet war, verschwindet nicht mit ihr.
 */
export function deleteSession(db: CampaignDb, sessionId: string): void {
  const data = db.getSnapshot();
  const session = data.sessions[sessionId];
  if (!session) return;
  db.batch(() => {
    for (const entry of Object.values(data.chronicle))
      if (entry.sessionId === sessionId) db.patch('chronicle', entry.id, { sessionId: null });
    if (data.state.sessionId === sessionId) db.setState({ sessionId: null });
    const preps = Object.values(data.preps);
    const sheet = preps.find((prep) => prep.sessionId === sessionId);
    const latest = Object.values(data.sessions).every(
      (other) => other.id === sessionId || other.number < session.number,
    );
    if (sheet && latest && !preps.some((prep) => prep.sessionId === null))
      db.patch('preps', sheet.id, { sessionId: null });
    db.remove('sessions', sessionId);
  });
}

/**
 * Setzt eine beendete Session fort – etwa nach einem versehentlichen Beenden oder einer Pause.
 * Ihr Ende wird gelöscht; eine andere laufende Session wird vorher beendet.
 */
export function resumeSession(db: CampaignDb, sessionId: string): void {
  const data = db.getSnapshot();
  if (!data.sessions[sessionId] || data.state.sessionId === sessionId) return;
  db.batch(() => {
    if (data.state.sessionId) endSession(db);
    db.patch('sessions', sessionId, { endAt: null });
    db.setState({ sessionId });
  });
}
