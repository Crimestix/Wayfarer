/**
 * Befehle, die mehrere Dokumente zusammen ändern. Die Oberfläche ruft diese Funktionen auf,
 * statt Zeit, Ort, Beziehungen und Chronik einzeln zu verändern – so bleiben sie stimmig.
 */
import { clockView, dueSteps, type ClockOccurrence } from '../domain/clock';
import {
  findRelation,
  linksTo,
  occurrencesBetween,
  replaceLink,
  type Occurrence,
  type PromiseOutcome,
} from '../domain/derive';
import {
  PARTY_ID,
  createChronicleEntry,
  createRelation,
  createSession,
  type ChronicleEntry,
  type ChronicleKind,
  type Clock,
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
 */
export function advanceTime(db: CampaignDb, to: WorldTime): TimeAdvanceResult {
  const data = db.getSnapshot();
  const from = data.state.now;
  if (!Number.isSafeInteger(to) || to <= from)
    throw new Error('Der neue Zeitpunkt muss nach der aktuellen Weltzeit liegen.');
  const occurred = occurrencesBetween(data, from + 1, to).filter(
    (o) => !(o.event.done && !o.event.repeat),
  );
  const expired = Object.values(data.timers).filter((t) => !t.done && t.end > from && t.end <= to);
  // Ein Schritt, der an einem Ablauf hängt, tritt nur ein, wenn der Ablauf nicht ausgeblieben
  // ist. Sonst bleibt die Uhr dort stehen: blockiert. Sie plant nie von selbst um.
  const steps: ClockOccurrence[] = [];
  const blocked: ClockBlock[] = [];
  for (const clock of Object.values(data.clocks))
    for (const occurrence of dueSteps(clock, from, to)) {
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
    db.setState({ now: to, previousNow: from });
  });
  return { from, to, occurred, expired, steps, blocked };
}

/** Nimmt den letzten Zeitsprung samt seiner automatischen Folgen zurück. */
export function undoTimeAdvance(db: CampaignDb): boolean {
  const data = db.getSnapshot();
  const back = data.state.previousNow;
  if (back === null || back >= data.state.now) return false;
  const now = data.state.now;
  db.batch(() => {
    for (const entry of Object.values(data.chronicle)) {
      if (entry.kind !== 'event' || entry.at <= back || entry.at > now) continue;
      db.remove('chronicle', entry.id);
      const event = entry.eventId ? data.events[entry.eventId] : undefined;
      if (event?.done && event.kind === 'world' && !event.repeat)
        db.patch('events', event.id, { done: false });
    }
    for (const timer of Object.values(data.timers))
      if (timer.done && timer.end > back && timer.end <= now)
        db.patch('timers', timer.id, { done: false });
    // Schritte der Uhren, die in dieser Zeit eingetreten sind, stehen wieder aus.
    for (const clock of Object.values(data.clocks)) {
      const reopened = clock.steps.map((step) =>
        step.at !== null && !step.skipped && step.at > back && step.at <= now
          ? { ...step, at: null }
          : step,
      );
      if (reopened.some((step, index) => step !== clock.steps[index]))
        db.patch('clocks', clock.id, { steps: reopened });
      // Was in dieser Zeit blockiert wurde, läuft wieder.
      if (
        clock.blocked &&
        clock.pausedAt !== null &&
        clock.pausedAt > back &&
        clock.pausedAt <= now
      )
        db.patch('clocks', clock.id, { pausedAt: null, blocked: '' });
    }
    for (const entry of Object.values(data.chronicle))
      if (entry.clockId && entry.kind === 'change' && entry.at > back && entry.at <= now) {
        const step = data.clocks[entry.clockId]?.steps.find((s) => s.id === entry.stepId);
        if (!step?.skipped) db.remove('chronicle', entry.id);
      }
    db.setState({ now: back, previousNow: null });
  });
  return true;
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

/** Die Gruppe wechselt den Ort. Der Wechsel steht in der Chronik; daraus entstehen die Besuche. */
export function moveParty(db: CampaignDb, toId: string | null, text = ''): ChronicleEntry | null {
  const data = db.getSnapshot();
  const fromId = data.state.placeId;
  if (fromId === toId) return null;
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
        travel: { fromId, toId },
      }),
    );
    db.setState({ placeId: toId });
    return entry;
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
 */
export function setAttitude(
  db: CampaignDb,
  fromId: string,
  toId: string,
  value: number | null,
  reason = '',
): Relation {
  const data = db.getSnapshot();
  const existing = findRelation(data, fromId, toId);
  const before = existing?.attitude ?? null;
  return db.batch(() => {
    const relation = existing
      ? db.patch('relations', existing.id, { attitude: value })
      : db.put('relations', createRelation({ from: fromId, to: toId, attitude: value }));
    if (before !== value || reason.trim()) {
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
 * zu keiner Session mehr. Läuft die Session gerade, endet sie damit.
 */
export function deleteSession(db: CampaignDb, sessionId: string): void {
  const data = db.getSnapshot();
  if (!data.sessions[sessionId]) return;
  db.batch(() => {
    for (const entry of Object.values(data.chronicle))
      if (entry.sessionId === sessionId) db.patch('chronicle', entry.id, { sessionId: null });
    if (data.state.sessionId === sessionId) db.setState({ sessionId: null });
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
