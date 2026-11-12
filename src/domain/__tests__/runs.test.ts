import { describe, expect, it } from 'vitest';
import { advanceTime, resumeClock, undoTimeAdvance } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { decideTrip, removeRun, saveRun, type RunInput } from '../../features/geschehen/actions';
import { saveWay } from '../../features/wege/actions';
import { setManualWeather } from '../../features/wetter/actions';
import {
  missedTrips,
  openTrips,
  runFailure,
  runProblem,
  runStatus,
  scheduleText,
  tripsBetween,
} from '../runs';
import { createClock, createEntity, newId, type Place, type Weather } from '../schema';
import { MINUTES_PER_DAY, dayIndexOf } from '../time/calendar';
import { weatherZone } from '../weatherZone';
import { worldTurn } from '../worldTurn';

const DAY = MINUTES_PER_DAY;

/**
 * Erfundene Gegend: Von Hohenfurt führt der Moorsteg zur Aalinsel (30 Min.) und ein Pfad nach
 * Graufels (60 Min.). Der Salzkahn fährt alle fünf Tage von Hohenfurt zur Aalinsel – zuletzt vor
 * drei Tagen, das nächste Mal in zwei.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string) =>
    db.put('entities', createEntity({ kind: 'place', name })) as Place;
  const ford = place('Hohenfurt');
  const town = place('Graufels');
  const isle = place('Aalinsel');
  saveWay(db, { fromId: ford.id, toId: isle.id, minutes: 30, sort: 'swamp', name: 'Moorsteg' });
  saveWay(db, { fromId: ford.id, toId: town.id, minutes: 60, sort: 'trail' });
  const skipper = db.put('entities', createEntity({ kind: 'person', name: 'Odo Tannhaus' }));
  const data = () => db.getSnapshot();
  const now = data().state.now;
  const today = dayIndexOf(now);
  const sky = (back: number, precipitation: Weather['precipitation']) => {
    for (const where of [ford, town, isle])
      setManualWeather(db, weatherZone(data(), where.id), today - back, {
        temperature: 12,
        precipitation,
        wind: 'none',
        fog: false,
        note: '',
      });
  };
  // Trockenes Wetter rund um alle Abfahrten, die im Test vorkommen.
  for (let back = -8; back <= 6; back++) sky(back, 'none');
  const run = (name: string, toId: string, more: Partial<RunInput> = {}) =>
    saveRun(db, {
      name,
      fromId: ford.id,
      toId,
      start: now - 3 * DAY,
      every: { every: 5, unit: 'day' },
      carrier: 'Flusskahn',
      operatorId: null,
      stoppedAt: null,
      stopReason: '',
      note: '',
      ...more,
    });
  const barge = run('Salzkahn', isle.id);
  const live = (id: string) => data().runs[id]!;
  return { db, data, now, ford, town, isle, skipper, sky, run, barge, live };
}

describe('Der Fahrplan', () => {
  it('nennt die Fahrten mit Abfahrt und Ankunft', async () => {
    const { data, now, barge, live } = await setup();
    const trips = tripsBetween(data(), live(barge.id), now - 4 * DAY, now + 8 * DAY);
    expect(trips.map((trip) => [trip.departs - now, trip.arrives - trip.departs])).toEqual([
      [-3 * DAY, 30],
      [2 * DAY, 30],
      [7 * DAY, 30],
    ]);
    expect(trips.every((trip) => !trip.missed && trip.blockedBy === null)).toBe(true);
    expect(scheduleText(barge)).toBe('alle 5 Tage');
    expect(scheduleText({ every: { every: 1, unit: 'month' } })).toBe('jeden Monat');
  });

  it('weiß, wo der Ablauf gerade steht', async () => {
    const { data, now, town, run, barge, live } = await setup();
    expect(runStatus(data(), live(barge.id))).toMatchObject({
      phase: 'waiting',
      current: null,
      next: { departs: now + 2 * DAY },
      noRoute: false,
    });
    // Eine Fahrt, die vor einer halben Stunde aufgebrochen ist und eine Stunde dauert.
    const patrol = run('Patrouille', town.id, { start: now - 30 });
    expect(runStatus(data(), live(patrol.id))).toMatchObject({
      phase: 'underway',
      current: { arrives: now + 30 },
    });
  });

  it('das Wetter verzögert die Ankunft – das geschieht einfach', async () => {
    const { data, now, town, sky, run, live } = await setup();
    const patrol = run('Patrouille', town.id);
    sky(3, 'heavy');
    const [trip] = tripsBetween(data(), live(patrol.id), now - 4 * DAY, now);
    // Der verschlammte Pfad: zwei Stunden statt einer.
    expect(trip).toMatchObject({ arrives: now - 3 * DAY + 120, delay: 60, blockedBy: null });
  });
});

describe('Wer nicht fährt', () => {
  it('ein ausgesetzter Ablauf – und einer, dessen Betreiber fehlt', async () => {
    const { db, data, now, skipper, isle, run, barge, live } = await setup();
    expect(runProblem(data(), live(barge.id))).toBeNull();
    const stopped = run('Postreiter', isle.id, {
      stoppedAt: now - DAY,
      stopReason: 'Das Pferd lahmt',
    });
    expect(runProblem(data(), live(stopped.id))).toBe('Das Pferd lahmt');
    expect(runStatus(data(), live(stopped.id)).phase).toBe('stopped');
    // Vor dem Aussetzen ist er noch gefahren, danach nicht mehr.
    expect(tripsBetween(data(), live(stopped.id), now - 4 * DAY, now + 8 * DAY)).toHaveLength(1);

    const owned = run('Fähre', isle.id, { operatorId: skipper.id });
    expect(runProblem(data(), live(owned.id))).toBeNull();
    const person = data().entities[skipper.id]!;
    if (person.kind === 'person')
      db.put('entities', { ...person, person: { ...person.person, status: 'dead' } });
    expect(runProblem(data(), live(owned.id))).toBe('Der Betreiber fehlt: Odo Tannhaus ist tot');
    expect(runFailure(data(), live(owned.id), now)).toContain('Fähre fährt nicht');
    db.remove('entities', skipper.id);
    expect(runProblem(data(), live(owned.id))).toContain('gibt es nicht mehr');
  });
});

describe('Ausbleiben als Ereignis', () => {
  it('war der Weg am Tag der Abfahrt nicht passierbar, ist das ein Vorschlag – kein Urteil', async () => {
    const { db, data, now, sky, barge, live } = await setup();
    expect(openTrips(data())).toEqual([]);
    sky(3, 'heavy');
    const open = openTrips(data());
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      departs: now - 3 * DAY,
      blockedBy: 'Moorsteg (Hohenfurt – Aalinsel)',
      missed: false,
    });
    let turn = worldTurn(data());
    expect(turn.suggestions.map((entry) => entry.kind)).toEqual(['trip']);
    expect(turn.suggestions[0]!.why).toBe(
      'Am Tag der Abfahrt war der Weg Moorsteg (Hohenfurt – Aalinsel) nicht passierbar.',
    );
    // Solange nichts entschieden ist, ist nichts ausgeblieben.
    expect(missedTrips(data(), now - 14 * DAY)).toEqual([]);

    const undo = decideTrip(db, barge.id, now - 3 * DAY, 'missed');
    expect(openTrips(data())).toEqual([]);
    turn = worldTurn(data());
    const missing = [...turn.watched, ...turn.weighty, ...turn.rest].find(
      (item) => item.kind === 'missing',
    );
    expect(missing).toMatchObject({
      title: 'Salzkahn bleibt in Aalinsel aus',
      detail: ['Am Ziel weiß man, dass etwas fehlt – aber nicht, warum.'],
    });
    expect(runFailure(data(), live(barge.id), now)).toContain('Salzkahn ist ausgeblieben');
    undo();
    expect(openTrips(data())).toHaveLength(1);
    // Verwirft der Spielleiter den Vorschlag, fand die Fahrt statt.
    decideTrip(db, barge.id, now - 3 * DAY, 'ran');
    expect(openTrips(data())).toEqual([]);
    expect(runFailure(data(), live(barge.id), now)).toBeNull();
  });
});

describe('Uhren mit Bedingungen', () => {
  const step = (text: string, days: number, runId: string | null) => ({
    id: newId(),
    text,
    days,
    delay: 0,
    at: null,
    skipped: false,
    needs: runId ? 'Das Salz trifft ein' : '',
    runId,
  });

  it('bleibt der Ablauf aus, steht die Uhr: blockiert – sie plant nie von selbst um', async () => {
    const { db, data, now, barge } = await setup();
    const clock = db.put(
      'clocks',
      createClock({
        title: 'Die Aalfischer pökeln den Fang',
        start: now,
        steps: [
          step('Die Fässer sind gefüllt', 1, barge.id),
          step('Der Fang geht in den Handel', 2, null),
        ],
      }),
    );
    decideTrip(db, barge.id, now - 3 * DAY, 'missed');
    const result = advanceTime(db, now + 4 * DAY);
    expect(result.steps).toEqual([]);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]!.reason).toContain('Das Salz trifft ein: Salzkahn ist ausgeblieben');
    const blocked = data().clocks[clock.id]!;
    expect(blocked.pausedAt).toBe(now + DAY);
    expect(blocked.steps.every((entry) => entry.at === null)).toBe(true);
    const turn = worldTurn(data());
    expect(turn.suggestions.map((entry) => entry.kind)).toContain('clock');
    expect(turn.clocks[0]!.blocked).toContain('Salzkahn ist ausgeblieben');

    // Der Zeitsprung lässt sich zurücknehmen – dann läuft die Uhr wieder.
    undoTimeAdvance(db);
    expect(data().clocks[clock.id]).toMatchObject({ pausedAt: null, blocked: '' });
  });

  it('der Spielleiter entscheidet, dass es trotzdem weitergeht', async () => {
    const { db, data, now, barge } = await setup();
    const clock = db.put(
      'clocks',
      createClock({
        title: 'Die Aalfischer pökeln den Fang',
        start: now,
        steps: [step('Die Fässer sind gefüllt', 1, barge.id)],
      }),
    );
    decideTrip(db, barge.id, now - 3 * DAY, 'missed');
    advanceTime(db, now + DAY + 60);
    expect(data().clocks[clock.id]!.blocked).not.toBe('');
    resumeClock(db, clock.id);
    const resumed = data().clocks[clock.id]!;
    expect(resumed).toMatchObject({ pausedAt: null, blocked: '' });
    // Der Schritt hängt nicht mehr an seinem Ablauf – sonst bliebe die Uhr gleich wieder stehen.
    expect(resumed.steps[0]!.runId).toBeNull();
    const result = advanceTime(db, now + 2 * DAY);
    expect(result.steps.map((entry) => entry.step.text)).toEqual(['Die Fässer sind gefüllt']);
    expect(result.blocked).toEqual([]);
  });

  it('kommt der Ablauf an, tritt der Schritt ein', async () => {
    const { db, now, barge } = await setup();
    db.put(
      'clocks',
      createClock({
        title: 'Pökeln',
        start: now,
        steps: [step('Die Fässer sind gefüllt', 1, barge.id)],
      }),
    );
    const result = advanceTime(db, now + 2 * DAY);
    expect(result.steps).toHaveLength(1);
    expect(result.blocked).toEqual([]);
  });

  it('ein gelöschter Ablauf nimmt seine Bedingung mit', async () => {
    const { db, data, now, barge } = await setup();
    const clock = db.put(
      'clocks',
      createClock({
        title: 'Pökeln',
        start: now,
        steps: [step('Die Fässer sind gefüllt', 1, barge.id)],
      }),
    );
    removeRun(db, barge.id);
    expect(data().runs[barge.id]).toBeUndefined();
    expect(data().clocks[clock.id]!.steps[0]!.runId).toBeNull();
  });
});
