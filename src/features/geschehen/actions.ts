/**
 * Befehle des Weltgeschehens: Abläufe anlegen und ändern, über eine fragliche Fahrt entscheiden,
 * beobachten.
 */
import type { CampaignDb } from '../../data/db';
import { createRun, type Run } from '../../domain/schema';

export type RunInput = Pick<
  Run,
  | 'name'
  | 'fromId'
  | 'toId'
  | 'start'
  | 'every'
  | 'carrier'
  | 'operatorId'
  | 'stoppedAt'
  | 'stopReason'
  | 'note'
>;

/** Legt einen Ablauf an oder ändert ihn. */
export function saveRun(db: CampaignDb, input: RunInput, id?: string): Run {
  const clean: RunInput = {
    ...input,
    name: input.name.trim() || 'Ablauf ohne Namen',
    carrier: input.carrier.trim(),
    stopReason: input.stoppedAt === null ? '' : input.stopReason.trim(),
    note: input.note.trim(),
    every: { every: Math.max(1, Math.round(input.every.every)), unit: input.every.unit },
  };
  if (id && db.getSnapshot().runs[id]) return db.patch('runs', id, clean);
  return db.put('runs', createRun(clean));
}

/** Löscht einen Ablauf. Schritte von Uhren, die an ihm hingen, hängen danach an nichts mehr. */
export function removeRun(db: CampaignDb, id: string): void {
  db.batch(() => {
    for (const clock of Object.values(db.getSnapshot().clocks))
      if (clock.steps.some((step) => step.runId === id))
        db.patch('clocks', clock.id, {
          steps: clock.steps.map((step) => (step.runId === id ? { ...step, runId: null } : step)),
        });
    db.remove('runs', id);
  });
}

/**
 * Entscheidet über eine fragliche Fahrt: ausgefallen (`missed`) oder sie fand trotzdem statt
 * (`ran`). Gibt zurück, wie sich das zurücknehmen lässt.
 */
export function decideTrip(
  db: CampaignDb,
  runId: string,
  departs: number,
  verdict: 'missed' | 'ran',
): () => void {
  const run = db.getSnapshot().runs[runId];
  if (!run) return () => {};
  const field = verdict === 'missed' ? 'missed' : 'decided';
  db.patch('runs', runId, { [field]: [...new Set([...run[field], departs])] });
  return () => {
    const now = db.getSnapshot().runs[runId];
    if (now) db.patch('runs', runId, { [field]: now[field].filter((entry) => entry !== departs) });
  };
}

/** Beobachten oder nicht mehr beobachten. */
export function setWatch(db: CampaignDb, id: string, on: boolean): void {
  const watch = db.getSnapshot().state.watch;
  db.setState({
    watch: on ? [...new Set([...watch, id])] : watch.filter((entry) => entry !== id),
  });
}
