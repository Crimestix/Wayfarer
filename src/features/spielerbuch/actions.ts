/**
 * Befehle des Spielerbuchs: Vermutungen der Spieler festhalten, ihren Stand setzen, löschen.
 * Eine Vermutung ist keine Zeile der Chronik – sie ändert nichts an der Welt.
 */
import type { CampaignDb } from '../../data/db';
import { sessionForEntry } from '../../domain/history';
import { createGuess, type Guess, type GuessTruth } from '../../domain/schema';

export interface GuessInput {
  text: string;
  refs: string[];
  /** Vorgabe: jetzt. */
  at?: number;
  /** undefined = die Session, in deren Weltzeit `at` fällt (jetzt: die laufende). */
  sessionId?: string | null;
  note?: string;
}

/** Nur Verweise, die es gibt – Einträge der Welt oder Geschichten –, jeder einmal. */
function cleanRefs(db: CampaignDb, refs: string[]): string[] {
  const data = db.getSnapshot();
  return [...new Set(refs)].filter((id) => data.entities[id] || data.stories[id]);
}

/**
 * Hält eine Vermutung fest oder ändert sie (`id`). Ohne Text geschieht nichts (null). Neue
 * Vermutungen stehen jetzt, in der laufenden Session; nie in der Zukunft.
 */
export function saveGuess(db: CampaignDb, input: GuessInput, id?: string): Guess | null {
  const text = input.text.trim();
  if (!text) return null;
  const data = db.getSnapshot();
  const refs = cleanRefs(db, input.refs);
  if (id && data.guesses[id])
    return db.patch('guesses', id, {
      text,
      refs,
      ...(input.note === undefined ? {} : { note: input.note.trim() }),
    });
  const at = Math.min(input.at ?? data.state.now, data.state.now);
  return db.put(
    'guesses',
    createGuess({
      text,
      refs,
      at,
      sessionId: input.sessionId === undefined ? sessionForEntry(data, at) : input.sessionId,
      note: input.note?.trim() ?? '',
    }),
  );
}

/** Setzt, ob eine Vermutung stimmt – und auf Wunsch die Bemerkung der Spielleitung dazu. */
export function setGuessTruth(db: CampaignDb, id: string, truth: GuessTruth, note?: string): void {
  const guess = db.getSnapshot().guesses[id];
  if (!guess) return;
  const change: Partial<Guess> = { truth };
  if (note !== undefined) change.note = note.trim();
  if (guess.truth === truth && (note === undefined || guess.note === change.note)) return;
  db.patch('guesses', id, change);
}

/** Löscht eine Vermutung; zurück kommt, was sie wiederherstellt. */
export function removeGuess(db: CampaignDb, id: string): (() => void) | null {
  const guess = db.getSnapshot().guesses[id];
  if (!guess) return null;
  db.remove('guesses', id);
  return () => {
    if (!db.getSnapshot().guesses[id]) db.put('guesses', { ...guess, rev: 0 });
  };
}
