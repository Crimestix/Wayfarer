/**
 * Handgriffe des Spieltischs, die den Spielstand ändern. Die Oberfläche ruft nur diese Funktionen
 * und die Befehle aus data/actions auf.
 */
import { setPromiseDone } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import type { ChronicleEntry } from '../../domain/schema';
import { MAX_EXHAUSTION, type AgendaItem } from './model';

/**
 * Nimmt einen Ortswechsel zurück, solange seitdem nichts weiter geschehen ist: Der Eintrag muss
 * noch der jüngste Ortswechsel sein und die Gruppe noch an seinem Ziel stehen.
 */
export function undoMove(db: CampaignDb, entryId: string): boolean {
  const data = db.getSnapshot();
  const entry = data.chronicle[entryId];
  if (!entry || entry.kind !== 'travel' || !entry.travel) return false;
  if (data.state.placeId !== entry.travel.toId) return false;
  const later = Object.values(data.chronicle).some(
    (other) =>
      other.id !== entry.id &&
      other.kind === 'travel' &&
      (other.at > entry.at || (other.at === entry.at && other.created > entry.created)),
  );
  if (later) return false;
  const fromId = entry.travel.fromId;
  db.batch(() => {
    db.remove('chronicle', entry.id);
    db.setState({ placeId: fromId && data.entities[fromId] ? fromId : null });
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

/** Hakt etwas Anstehendes ab (oder nimmt den Haken zurück): Vorhaben, Frist, Abmachung, Timer. */
export function settleAgendaItem(db: CampaignDb, item: Pick<AgendaItem, 'source' | 'id'>, done = true): void {
  const data = db.getSnapshot();
  if (item.source === 'promise') setPromiseDone(db, item.id, done);
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
  const entry = db.getSnapshot().chronicle[entryId];
  if (!entry || !canDeleteEntry(entry)) return null;
  db.remove('chronicle', entryId);
  return entry;
}

/** Stellt einen gelöschten Eintrag wieder her. */
export function restoreEntry(db: CampaignDb, entry: ChronicleEntry): void {
  if (db.getSnapshot().chronicle[entry.id]) return;
  db.put('chronicle', entry);
}
