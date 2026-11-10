/**
 * Befehle, die mehrere Dokumente zusammen ändern. Die Oberfläche ruft diese Funktionen auf,
 * statt Zeit, Ort, Beziehungen und Chronik einzeln zu verändern – so bleiben sie stimmig.
 */
import { occurrencesBetween, findRelation, type Occurrence } from '../domain/derive';
import {
  PARTY_ID,
  createChronicleEntry,
  createRelation,
  createSession,
  type ChronicleEntry,
  type ChronicleKind,
  type Relation,
  type Session,
  type Timer,
} from '../domain/schema';
import type { WorldTime } from '../domain/time/calendar';
import type { CampaignDb } from './db';

export interface TimeAdvanceResult {
  from: WorldTime;
  to: WorldTime;
  /** Termine, die in der übersprungenen Zeit eingetreten sind. */
  occurred: Occurrence[];
  /** Timer, die abgelaufen sind. */
  expired: Timer[];
}

/**
 * Lässt Weltzeit vergehen. Eingetretene Termine kommen in die Chronik, abgelaufene Timer
 * werden beendet. Der Sprung lässt sich mit undoTimeAdvance zurücknehmen.
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
  db.batch(() => {
    for (const o of occurred) {
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
      if (o.event.kind === 'world' && !o.event.repeat) db.patch('events', o.event.id, { done: true });
    }
    for (const timer of expired) db.patch('timers', timer.id, { done: true });
    db.setState({ now: to, previousNow: from });
  });
  return { from, to, occurred, expired };
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
      if (timer.done && timer.end > back && timer.end <= now) db.patch('timers', timer.id, { done: false });
    db.setState({ now: back, previousNow: null });
  });
  return true;
}

/** Stellt die Weltzeit direkt (Korrektur), ohne Termine auszulösen. */
export function setTime(db: CampaignDb, to: WorldTime): void {
  const from = db.getSnapshot().state.now;
  if (to === from) return;
  db.setState({ now: to, previousNow: null });
}

/** Die Gruppe wechselt den Ort. Der Wechsel steht in der Chronik; daraus entstehen die Besuche. */
export function moveParty(
  db: CampaignDb,
  toId: string | null,
  text = '',
): ChronicleEntry | null {
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
      promise: kind === 'promise' ? { due: input.due ?? null, done: false } : null,
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

/** Hakt eine Abmachung ab oder öffnet sie wieder. */
export function setPromiseDone(db: CampaignDb, entryId: string, done: boolean): void {
  const entry = db.getSnapshot().chronicle[entryId];
  if (!entry?.promise) return;
  db.patch('chronicle', entryId, { promise: { ...entry.promise, done } });
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
      if (relation.from === entityId || relation.to === entityId) db.remove('relations', relation.id);
    for (const other of Object.values(data.entities)) {
      if (other.id === entityId) continue;
      if (other.kind === 'person') {
        const { placeId, homeId } = other.person;
        if (placeId === entityId || homeId === entityId)
          db.put('entities', {
            ...other,
            person: {
              ...other.person,
              placeId: placeId === entityId ? null : placeId,
              homeId: homeId === entityId ? null : homeId,
            },
          });
      } else if (other.kind === 'place' && other.place.parentId === entityId) {
        const removed = data.entities[entityId];
        const parentId = removed?.kind === 'place' ? removed.place.parentId : null;
        db.put('entities', { ...other, place: { ...other.place, parentId } });
      } else if (other.kind === 'faction' && other.faction.seatId === entityId) {
        db.put('entities', { ...other, faction: { ...other.faction, seatId: null } });
      } else if (other.kind === 'character' && other.character.placeId === entityId) {
        db.put('entities', { ...other, character: { ...other.character, placeId: null } });
      } else if (other.kind === 'item' && other.item.holderId === entityId) {
        db.put('entities', { ...other, item: { ...other.item, holderId: null } });
      }
    }
    for (const event of Object.values(data.events))
      if (event.placeId === entityId || event.refs.includes(entityId))
        db.patch('events', event.id, {
          placeId: event.placeId === entityId ? null : event.placeId,
          refs: event.refs.filter((ref) => ref !== entityId),
        });
    if (data.state.placeId === entityId) db.setState({ placeId: null });
    db.remove('entities', entityId);
  });
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
