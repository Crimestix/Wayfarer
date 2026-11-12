import { describe, expect, it } from 'vitest';
import { clockView, dueSteps, openClocks, stepMinutes } from '../clock';
import { createClock, type Clock } from '../schema';

const DAY = 24 * 60;
const START = 1000 * DAY;

/** Eine erfundene Uhr: drei Schritte nach 2, 3 und 5 Tagen. */
const clock = (more: Partial<Clock> = {}): Clock =>
  createClock({
    id: 'uhr',
    title: 'Die Aalfischer übernehmen den Hafen',
    start: START,
    steps: [
      { id: 'a', text: 'Die Aalfischer bestechen den Hafenmeister', days: 2 },
      { id: 'b', text: 'Der alte Hafenmeister verschwindet', days: 3 },
      { id: 'c', text: 'Der Hafen gehört den Aalfischern', days: 5 },
    ].map((step) => ({ delay: 0, at: null, skipped: false, needs: '', runId: null, ...step })),
    ...more,
  });

describe('Uhren', () => {
  it('reiht die Schritte aneinander: jeder folgt auf den vorigen', () => {
    const view = clockView(clock(), START);
    expect(view.steps.map((s) => [s.state, s.at - START])).toEqual([
      ['next', 2 * DAY],
      ['later', 5 * DAY],
      ['later', 10 * DAY],
    ]);
    expect(view).toMatchObject({ done: false, paused: false, progress: 0 });
    expect(view.next?.step.id).toBe('a');
  });

  it('rechnet vom tatsächlichen Eintreten weiter – und kennt verhinderte Schritte', () => {
    const base = clock();
    // Der erste Schritt trat erst nach 4 Tagen ein, der zweite wurde am 6. Tag verhindert.
    const moved = clock({
      steps: [
        { ...base.steps[0]!, at: START + 4 * DAY },
        { ...base.steps[1]!, at: START + 6 * DAY, skipped: true },
        base.steps[2]!,
      ],
    });
    const view = clockView(moved, START + 6 * DAY);
    expect(view.steps.map((s) => s.state)).toEqual(['done', 'prevented', 'next']);
    expect(view.next!.at).toBe(START + 11 * DAY);
    expect(view.progress).toBeCloseTo(2 / 3, 6);
    const finished = clock({
      steps: moved.steps.map((step) => ({ ...step, at: step.at ?? START + 12 * DAY })),
    });
    expect(clockView(finished, START + 20 * DAY)).toMatchObject({
      done: true,
      next: null,
      progress: 1,
    });
  });

  it('schiebt mit Aufschub und Standzeit hinaus, zieht mit Vorziehen vor', () => {
    const base = clock();
    const delayed = clock({
      steps: [{ ...base.steps[0]!, delay: DAY }, base.steps[1]!, base.steps[2]!],
    });
    expect(clockView(delayed, START).steps.map((s) => s.at - START)).toEqual([
      3 * DAY,
      6 * DAY,
      11 * DAY,
    ]);
    // Seit einem Tag angehalten: Der nächste Schritt rückt mit jedem Tag weiter weg.
    const paused = clock({ pausedAt: START + DAY });
    expect(clockView(paused, START + 2 * DAY)).toMatchObject({ paused: true });
    expect(clockView(paused, START + 2 * DAY).next!.at).toBe(START + 3 * DAY);
    expect(clockView(paused, START + 4 * DAY).next!.at).toBe(START + 5 * DAY);
    // Vorgezogen um mehr als die Dauer: Es bleibt bei einer Minute.
    expect(stepMinutes({ days: 2, delay: -10 * DAY })).toBe(1);
  });

  it('nennt, was in einer Zeitspanne eintritt – auch mehrere Schritte auf einmal', () => {
    const c = clock();
    expect(dueSteps(c, START, START + DAY)).toEqual([]);
    expect(dueSteps(c, START, START + 2 * DAY).map((o) => [o.step.id, o.at - START])).toEqual([
      ['a', 2 * DAY],
    ]);
    expect(dueSteps(c, START, START + 30 * DAY).map((o) => [o.step.id, o.at - START])).toEqual([
      ['a', 2 * DAY],
      ['b', 5 * DAY],
      ['c', 10 * DAY],
    ]);
    // Schon überfällig (die Uhr wurde in der Vergangenheit begonnen): tritt gleich zu Beginn ein.
    const late = dueSteps(c, START + 20 * DAY, START + 21 * DAY);
    expect(late.map((o) => o.at - START)).toEqual([20 * DAY + 1]);
    // Eine angehaltene Uhr steht.
    expect(dueSteps(clock({ pausedAt: START }), START, START + 30 * DAY)).toEqual([]);
  });

  it('listet offene Uhren: laufende vor angehaltenen, die nächste zuerst', () => {
    const soon = clock({ id: 'bald', title: 'Bald' });
    const later = clock({ id: 'spaet', title: 'Später', start: START + 10 * DAY });
    const paused = clock({ id: 'steht', title: 'Steht', pausedAt: START });
    const done = clock({
      id: 'fertig',
      steps: clock().steps.map((step) => ({ ...step, at: START })),
    });
    const all = { [later.id]: later, [paused.id]: paused, [done.id]: done, [soon.id]: soon };
    expect(openClocks(all, START).map((view) => view.clock.title)).toEqual([
      'Bald',
      'Später',
      'Steht',
    ]);
  });
});
