/**
 * Uhren: Vorhaben der Welt, die ohne die Gruppe weiterlaufen. Eine Fraktion oder Person verfolgt
 * etwas in Schritten, die der Spielleiter schreibt; jeder Schritt tritt eine Zahl von Tagen nach
 * dem vorigen ein. Greift die Gruppe nicht ein, tritt er ein – Wayfarer führt nur Buch.
 *
 * Reine Funktionen: wann welcher Schritt fällig ist und was in einer Zeitspanne eintritt.
 */
import type { Clock, ClockStep } from './schema';
import { MINUTES_PER_DAY, type WorldTime } from './time/calendar';

export type StepState = 'done' | 'prevented' | 'next' | 'later';

export interface StepView {
  step: ClockStep;
  index: number;
  state: StepState;
  /** Wann der Schritt eingetreten ist oder – nach heutigem Stand – eintreten wird. */
  at: WorldTime;
}

export interface ClockView {
  clock: Clock;
  steps: StepView[];
  /** Der nächste Schritt, der eintritt; null, wenn alles geschehen ist. */
  next: StepView | null;
  /** Alle Schritte sind eingetreten oder verhindert. */
  done: boolean;
  paused: boolean;
  /** Blockiert: warum – leer, wenn sie nicht blockiert ist. */
  blocked: string;
  /** Anteil der Schritte, die hinter der Uhr liegen (0…1). */
  progress: number;
}

/** So lange dauert ein Schritt mindestens – auch wenn er vorgezogen wurde. */
const SHORTEST = 1;

/** Die Dauer eines Schrittes in Minuten: seine Tage plus Aufschub (oder minus Vorziehen). */
export const stepMinutes = (step: Pick<ClockStep, 'days' | 'delay'>): number =>
  Math.max(SHORTEST, Math.round(step.days * MINUTES_PER_DAY) + step.delay);

/**
 * Die Uhr, wie sie jetzt steht. Offene Schritte folgen aufeinander; eine angehaltene Uhr schiebt
 * sie um die Zeit hinaus, die sie schon steht.
 */
export function clockView(clock: Clock, now: WorldTime): ClockView {
  const paused = clock.pausedAt !== null;
  const standing = paused ? Math.max(0, now - clock.pausedAt!) : 0;
  const steps: StepView[] = [];
  let anchor = clock.start;
  let next: StepView | null = null;
  clock.steps.forEach((step, index) => {
    if (step.at !== null) {
      anchor = step.at;
      steps.push({ step, index, state: step.skipped ? 'prevented' : 'done', at: step.at });
      return;
    }
    const at = anchor + stepMinutes(step) + (next === null ? standing : 0);
    anchor = at;
    const view: StepView = { step, index, state: next === null ? 'next' : 'later', at };
    if (next === null) next = view;
    steps.push(view);
  });
  const behind = steps.filter((s) => s.state === 'done' || s.state === 'prevented').length;
  return {
    clock,
    steps,
    next,
    done: clock.steps.length > 0 && next === null,
    paused,
    blocked: paused ? clock.blocked : '',
    progress: clock.steps.length ? behind / clock.steps.length : 0,
  };
}

export interface ClockOccurrence {
  clock: Clock;
  step: ClockStep;
  at: WorldTime;
}

/**
 * Die Schritte einer Uhr, die eintreten, wenn die Weltzeit von `from` auf `to` vorrückt – in ihrer
 * Reihenfolge. Was schon überfällig war, tritt gleich zu Beginn ein. Eine angehaltene Uhr steht.
 */
export function dueSteps(clock: Clock, from: WorldTime, to: WorldTime): ClockOccurrence[] {
  if (clock.pausedAt !== null) return [];
  const out: ClockOccurrence[] = [];
  let anchor = clock.start;
  for (const step of clock.steps) {
    if (step.at !== null) {
      anchor = step.at;
      continue;
    }
    const due = anchor + stepMinutes(step);
    if (due > to) break;
    const at = Math.max(due, from + 1);
    out.push({ clock, step, at });
    anchor = at;
  }
  return out;
}

/** Alle Uhren, die noch laufen können: nicht fertig. Die mit dem nächsten Schritt zuerst. */
export function openClocks(clocks: Record<string, Clock>, now: WorldTime): ClockView[] {
  return Object.values(clocks)
    .map((clock) => clockView(clock, now))
    .filter((view) => !view.done)
    .sort(
      (a, b) =>
        Number(a.paused) - Number(b.paused) ||
        (a.next?.at ?? Infinity) - (b.next?.at ?? Infinity) ||
        a.clock.title.localeCompare(b.clock.title, 'de'),
    );
}
