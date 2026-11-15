/**
 * Handgriffe des Spieltischs, die den Spielstand ändern. Die Oberfläche ruft nur diese Funktionen
 * und die Befehle aus data/actions auf.
 */
import { logEntry, setPromiseOutcome } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import { dropLootLine } from '../beute/actions';
import { entityName } from '../../domain/derive';
import { placeOfWho, touches, whoOf, withPlace } from '../../domain/party';
import { createTimer, type ChronicleEntry, type Timer } from '../../domain/schema';
import { formatDuration } from '../../domain/time/calendar';
import { concentrationOf } from './spells';
import { MAX_EXHAUSTION, type AgendaItem } from './model';

/**
 * Nimmt einen Ortswechsel zurück, solange seitdem nichts weiter geschehen ist: Der Eintrag muss
 * noch der jüngste Ortswechsel sein und die Gruppe noch an seinem Ziel stehen.
 */
export function undoMove(db: CampaignDb, entryId: string): boolean {
  const data = db.getSnapshot();
  const entry = data.chronicle[entryId];
  if (!entry || entry.kind !== 'travel' || !entry.travel) return false;
  const who = whoOf(entry);
  if (placeOfWho(data, who) !== entry.travel.toId) return false;
  const later = Object.values(data.chronicle).some(
    (other) =>
      other.id !== entry.id &&
      other.kind === 'travel' &&
      touches(whoOf(other), who) &&
      (other.at > entry.at || (other.at === entry.at && other.created > entry.created)),
  );
  if (later) return false;
  const fromId = entry.travel.fromId;
  db.batch(() => {
    db.remove('chronicle', entry.id);
    db.setState(withPlace(data, who, fromId && data.entities[fromId] ? fromId : null));
  });
  return true;
}

/** Setzt die Erschöpfungsstufe eines Gefährten (0–6). */
export function setExhaustion(db: CampaignDb, characterId: string, level: number): void {
  const entity = db.getSnapshot().entities[characterId];
  if (entity?.kind !== 'character') return;
  const exhaustion = Math.min(MAX_EXHAUSTION, Math.max(0, Math.round(level)));
  if (exhaustion === entity.character.exhaustion) return;
  db.put('entities', { ...entity, character: { ...entity.character, exhaustion } });
}

/**
 * Hakt etwas Anstehendes ab (oder nimmt den Haken zurück): Vorhaben, Frist, Abmachung, Timer.
 * Eine Abmachung kann dabei auch gescheitert sein (`failed`).
 */
export function settleAgendaItem(
  db: CampaignDb,
  item: Pick<AgendaItem, 'source' | 'id'>,
  done = true,
  failed = false,
): void {
  const data = db.getSnapshot();
  if (item.source === 'promise')
    setPromiseOutcome(db, item.id, !done ? 'open' : failed ? 'failed' : 'kept');
  else if (item.source === 'event' && data.events[item.id]) db.patch('events', item.id, { done });
  else if (item.source === 'timer' && data.timers[item.id]) db.patch('timers', item.id, { done });
}

/** Ändert Text und Verweise eines Chronik-Eintrags. */
export function reviseEntry(
  db: CampaignDb,
  entryId: string,
  change: { text: string; refs?: string[] },
): void {
  const entry = db.getSnapshot().chronicle[entryId];
  if (!entry) return;
  db.patch('chronicle', entryId, {
    text: change.text.trim(),
    refs: change.refs ? [...new Set(change.refs)] : entry.refs,
  });
}

/** Einträge, die sich am Spieltisch ohne Folgen löschen lassen: Notizen, Abmachungen, Veränderungen. */
export function canDeleteEntry(entry: Pick<ChronicleEntry, 'kind'>): boolean {
  return entry.kind === 'note' || entry.kind === 'promise' || entry.kind === 'change';
}

/** Löscht eine Notiz, Abmachung oder Veränderung. Gibt den Eintrag zurück, um ihn wiederherzustellen. */
export function deleteEntry(db: CampaignDb, entryId: string): ChronicleEntry | null {
  return removeEntry(db, entryId)?.entry ?? null;
}

/**
 * Löscht eine Notiz, Abmachung oder Veränderung – mit dem Handgriff, der sie zurückholt. Ist es
 * die Zeile einer Ausgabe im Beute-Buch, gilt die Ausgabe als nicht geschehen: Die Beute liegt
 * wieder bereit, ein Gegenstand ist wieder dort, wo er war.
 */
export function removeEntry(
  db: CampaignDb,
  entryId: string,
): { entry: ChronicleEntry; undo: () => void } | null {
  const entry = db.getSnapshot().chronicle[entryId];
  if (!entry || !canDeleteEntry(entry)) return null;
  const undoLoot = dropLootLine(db, entryId);
  if (undoLoot) return { entry, undo: undoLoot };
  db.remove('chronicle', entryId);
  return { entry, undo: () => restoreEntry(db, entry) };
}

/** Stellt einen gelöschten Eintrag wieder her. */
export function restoreEntry(db: CampaignDb, entry: ChronicleEntry): void {
  if (db.getSnapshot().chronicle[entry.id]) return;
  db.put('chronicle', entry);
}

/**
 * Klickt „Letztes Mal“ für den laufenden Abend weg (`state.recapDismissed`); `show` holt den
 * Rückblick zurück. Ohne laufenden Abend geschieht nichts.
 */
export function dismissRecap(db: CampaignDb, show = false): void {
  const sessionId = db.getSnapshot().state.sessionId;
  if (!sessionId) return;
  db.setState({ recapDismissed: show ? null : sessionId });
}

/** Schreibt die Regeln des Tisches (Hausregeln und Absprachen der Runde) – nur, wenn sie sich ändern. */
export function setTableRules(db: CampaignDb, text: string): void {
  if (db.getSnapshot().campaign.tableRules === text) return;
  db.setCampaign({ tableRules: text });
}

export interface CastInput {
  /** Wer zaubert (Gefährte oder Person); null = nicht gesagt. */
  casterId: string | null;
  /** Der Zauber, frei geschrieben. */
  label: string;
  minutes: number;
  concentration: boolean;
  /** Wen er betrifft – kommt mit dem Wirker in die Zeile der Mitschrift. */
  refs?: string[];
}

/**
 * Ein Zauber wird gewirkt: Er läuft als Wirkung bis zu seinem Ende, und die Mitschrift bekommt
 * eine Zeile. Ein neuer Konzentrationszauber beendet die Konzentration, die der Wirker gerade
 * hält. Gibt den Zauber, die beendeten und „Rückgängig“ zurück.
 */
export function castSpell(
  db: CampaignDb,
  input: CastInput,
): { timer: Timer; ended: Timer[]; undo: () => void } {
  const data = db.getSnapshot();
  const now = data.state.now;
  const label = input.label.trim();
  const minutes = Math.max(1, Math.round(input.minutes));
  const ended = input.concentration ? concentrationOf(data, input.casterId) : [];
  const refs = [...new Set([...(input.casterId ? [input.casterId] : []), ...(input.refs ?? [])])];
  const line = [
    input.casterId ? `${entityName(data, input.casterId)} wirkt ${label}` : `Zauber: ${label}`,
    input.concentration ? 'Konzentration' : '',
    formatDuration(minutes),
    ...ended.map((timer) => `${timer.label} endet`),
  ]
    .filter(Boolean)
    .join(' · ');
  const result = db.batch(() => {
    for (const timer of ended) db.patch('timers', timer.id, { done: true });
    const timer = db.put(
      'timers',
      createTimer({
        label,
        kind: 'spell',
        start: now,
        end: now + minutes,
        casterId: input.casterId,
        concentration: input.concentration,
        refs,
      }),
    );
    const entry = logEntry(db, { text: line, refs });
    return { timer, entry };
  });
  return {
    timer: result.timer,
    ended,
    undo: () =>
      db.batch(() => {
        const after = db.getSnapshot();
        if (after.timers[result.timer.id]) db.remove('timers', result.timer.id);
        if (after.chronicle[result.entry.id]) db.remove('chronicle', result.entry.id);
        for (const timer of ended)
          if (db.getSnapshot().timers[timer.id]) db.patch('timers', timer.id, { done: false });
      }),
  };
}

/** Nimmt einen Eintrag „Im Blick“ auf oder wieder heraus (`state.inView`). */
export function toggleInView(db: CampaignDb, id: string): boolean {
  const current = db.getSnapshot().state.inView;
  const on = !current.includes(id);
  db.setState({ inView: on ? [...current, id] : current.filter((other) => other !== id) });
  return on;
}

/** Leert „Im Blick“ – etwa, wenn die Szene vorbei ist. Gibt „Rückgängig“ zurück. */
export function clearInView(db: CampaignDb): () => void {
  const before = db.getSnapshot().state.inView;
  db.setState({ inView: [] });
  return () => db.setState({ inView: before });
}
