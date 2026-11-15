import { describe, expect, it } from 'vitest';
import { createChronicleEntry, createClock, createEvent } from '../../domain/schema';
import { advanceTime, settleTime } from '../actions';
import { CampaignDb } from '../db';
import { elarisCampaign } from '../seed';
import { MemoryStore } from '../store';

const DAY = 24 * 60;

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const now = db.getSnapshot().state.now;
  const markt = db.put('events', createEvent({ title: 'Markt in Hohenfurt', at: now + DAY }));
  const fest = db.put('events', createEvent({ title: 'Fest in Tannhaus', at: now + 2 * DAY }));
  const clock = db.put(
    'clocks',
    createClock({
      title: 'Die Salzgrotte stürzt ein',
      start: now,
      steps: [{ id: 'a', text: 'Ein Riss in der Decke', days: 2 }].map((step) => ({
        delay: 0,
        at: null,
        skipped: false,
        needs: '',
        runId: null,
        ...step,
      })),
    }),
  );
  return { db, now, markt, fest, clock };
}

describe('Weltzeit nach dem Abgleich ordnen', () => {
  it('Wahl der früheren Zeit: Termine und Schritt stehen wieder aus, Notizen bleiben', async () => {
    const { db, now, markt, fest, clock } = await setup();
    // Am MacBook sind drei Tage vergangen …
    advanceTime(db, now + 3 * DAY);
    const note = db.put(
      'chronicle',
      createChronicleEntry({ kind: 'note', at: now + DAY, text: 'Die Gruppe kauft Salz.' }),
    );
    // … am PC nur eine Stunde; der Spielleiter wählt die Weltzeit vom PC.
    db.setState({ now: now + 60, previousNow: now });
    const summary = settleTime(db, now + 60, now + 3 * DAY);
    // Der Grundstand bringt eigene Termine mit; mindestens die beiden hier stehen wieder aus.
    expect(summary.reopened.events).toBeGreaterThanOrEqual(2);
    expect(summary.reopened.steps).toBe(1);
    expect(summary.merged).toBe(0);
    const data = db.getSnapshot();
    expect(data.events[markt.id]!.done).toBe(false);
    expect(data.events[fest.id]!.done).toBe(false);
    expect(data.clocks[clock.id]!.steps[0]!.at).toBeNull();
    const kinds = Object.values(data.chronicle).map((e) => e.kind);
    expect(kinds).toEqual(['note']);
    expect(data.chronicle[note.id]).toBeDefined();
  });

  it('Wahl der späteren Zeit: nichts geöffnet, doppelte Terminzeile zusammengelegt', async () => {
    const { db, now, markt } = await setup();
    advanceTime(db, now + 3 * DAY);
    const line = Object.values(db.getSnapshot().chronicle).find((e) => e.eventId === markt.id)!;
    // Dieselbe Zeile ist auch am anderen Rechner entstanden (andere Kennung).
    const twin = db.put('chronicle', createChronicleEntry({ ...line, id: 'zzzz-zwilling' }));
    const summary = settleTime(db, now + 3 * DAY, now + 60);
    expect(summary).toEqual({ reopened: { events: 0, steps: 0, timers: 0 }, merged: 1 });
    const left = Object.values(db.getSnapshot().chronicle).filter((e) => e.eventId === markt.id);
    expect(left).toHaveLength(1);
    expect(left[0]!.id).toBe(line.id < twin.id ? line.id : twin.id);
  });
});
