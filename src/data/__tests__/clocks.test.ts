import { describe, expect, it } from 'vitest';
import { createClock, createEntity } from '../../domain/schema';
import {
  advanceTime,
  delayClock,
  pauseClock,
  resumeClock,
  settleStep,
  undoTimeAdvance,
} from '../actions';
import { CampaignDb } from '../db';
import { elarisCampaign } from '../seed';
import { MemoryStore } from '../store';

const DAY = 24 * 60;

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const now = db.getSnapshot().state.now;
  const guild = db.put('entities', createEntity({ kind: 'faction', name: 'Die Aalfischer' }));
  const harbour = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const clock = db.put(
    'clocks',
    createClock({
      title: 'Die Aalfischer übernehmen den Hafen',
      ownerId: guild.id,
      placeId: harbour.id,
      start: now,
      steps: [
        { id: 'a', text: 'Die Aalfischer bestechen den Hafenmeister', days: 2 },
        { id: 'b', text: 'Der alte Hafenmeister verschwindet', days: 3 },
      ].map((step) => ({ delay: 0, at: null, skipped: false, ...step })),
    }),
  );
  const changes = () =>
    Object.values(db.getSnapshot().chronicle)
      .filter((entry) => entry.clockId === clock.id)
      .sort((x, y) => x.at - y.at);
  const steps = () => db.getSnapshot().clocks[clock.id]!.steps;
  return { db, now, guild, harbour, clock, changes, steps };
}

describe('Uhren laufen mit der Weltzeit', () => {
  it('lässt fällige Schritte eintreten und schreibt sie als Veränderung in die Chronik', async () => {
    const { db, now, guild, harbour, changes, steps } = await setup();
    expect(advanceTime(db, now + DAY).steps).toEqual([]);
    const result = advanceTime(db, now + 2 * DAY);
    expect(result.steps.map((s) => [s.step.id, s.at])).toEqual([['a', now + 2 * DAY]]);
    expect(steps().map((step) => step.at)).toEqual([now + 2 * DAY, null]);
    expect(changes()).toMatchObject([
      {
        kind: 'change',
        at: now + 2 * DAY,
        text: 'Die Aalfischer bestechen den Hafenmeister',
        placeId: harbour.id,
        refs: [guild.id],
        // Die Spieler wissen nichts davon, solange die Uhr geheim ist.
        secret: true,
        stepId: 'a',
      },
    ]);
  });

  it('nimmt mit dem Zeitsprung auch die eingetretenen Schritte zurück', async () => {
    const { db, now, changes, steps } = await setup();
    advanceTime(db, now + 30 * DAY);
    expect(steps().map((step) => step.at)).toEqual([now + 2 * DAY, now + 5 * DAY]);
    expect(changes()).toHaveLength(2);
    expect(undoTimeAdvance(db)).toBe(true);
    expect(steps().map((step) => step.at)).toEqual([null, null]);
    expect(changes()).toEqual([]);
    expect(db.getSnapshot().state.now).toBe(now);
  });

  it('steht, solange sie angehalten ist, und läuft danach um die Standzeit später weiter', async () => {
    const { db, now, clock, changes, steps } = await setup();
    advanceTime(db, now + DAY);
    pauseClock(db, clock.id);
    expect(advanceTime(db, now + 4 * DAY).steps).toEqual([]);
    resumeClock(db, clock.id);
    expect(db.getSnapshot().clocks[clock.id]!.pausedAt).toBeNull();
    expect(steps()[0]!.delay).toBe(3 * DAY);
    // Ein Tag fehlte noch: Er tritt am fünften Tag ein, nicht früher.
    expect(advanceTime(db, now + 5 * DAY - 1).steps).toEqual([]);
    expect(advanceTime(db, now + 5 * DAY).steps.map((s) => s.step.id)).toEqual(['a']);
    expect(changes()).toHaveLength(1);
  });

  it('lässt verzögern, verhindern und von Hand eintreten', async () => {
    const { db, now, clock, changes, steps } = await setup();
    delayClock(db, clock.id, 2 * DAY);
    expect(advanceTime(db, now + 3 * DAY).steps).toEqual([]);
    // Die Gruppe greift ein: Der erste Schritt ist verhindert, der zweite zählt von jetzt.
    const undo = settleStep(db, clock.id, true)!;
    expect(steps()[0]).toMatchObject({ at: now + 3 * DAY, skipped: true });
    expect(changes()[0]!.text).toBe('Verhindert: Die Aalfischer bestechen den Hafenmeister');
    undo();
    expect(steps()[0]).toMatchObject({ at: null, skipped: false });
    expect(changes()).toEqual([]);

    settleStep(db, clock.id, true);
    expect(advanceTime(db, now + 5 * DAY).steps).toEqual([]);
    // Der Spielleiter lässt den zweiten Schritt vorzeitig geschehen.
    settleStep(db, clock.id, false);
    expect(steps()[1]).toMatchObject({ at: now + 5 * DAY, skipped: false });
    expect(changes().map((entry) => entry.text)).toEqual([
      'Verhindert: Die Aalfischer bestechen den Hafenmeister',
      'Der alte Hafenmeister verschwindet',
    ]);
    // Alles ist geschehen: Es gibt keinen nächsten Schritt mehr.
    expect(settleStep(db, clock.id, false)).toBeNull();
    // Ein Verhindern übersteht das Zurücknehmen des Zeitsprungs.
    undoTimeAdvance(db);
    expect(steps()[0]).toMatchObject({ skipped: true });
    expect(changes()[0]!.text).toMatch(/^Verhindert/);
  });
});
