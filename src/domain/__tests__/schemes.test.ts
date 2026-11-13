import { describe, expect, it } from 'vitest';
import { advanceTime, endSession, setAttitude, settleStep, startSession } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { newScheme, setStorySteps } from '../../features/faeden/actions';
import { spendDowntime } from '../../features/gruppe/downtime';
import { walk } from '../../features/wege/actions';
import { hasNews, meanwhile } from '../../shell/meanwhile';
import { deedsOf, driverOf, schemeDrivers, schemesOf } from '../schemes';
import {
  PARTY_ID,
  createChronicleEntry,
  createClock,
  createEntity,
  createRun,
  createStory,
  type ClockStep,
} from '../schema';
import { MINUTES_PER_DAY } from '../time/calendar';
import { factionTurn, lastEvening, worldTurn } from '../worldTurn';

const DAY = MINUTES_PER_DAY;

const step = (id: string, text: string, days: number, more: Partial<ClockStep> = {}) => ({
  id,
  text,
  days,
  delay: 0,
  at: null,
  skipped: false,
  needs: '',
  runId: null,
  ...more,
});

/**
 * Erfundene Welt: Die Salzsieder von Hohenfurt wollen die Salzgrotte; Lando Furtner schmiedet
 * eigene Pläne; Haus Tannhaus hat noch nichts vor.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const data = () => db.getSnapshot();
  // Ohne Abende aus dem Grundstand: Die Tests legen ihre eigenen an.
  for (const id of Object.keys(data().sessions)) db.remove('sessions', id);
  db.setState({ sessionId: null });
  const now = data().state.now;
  const ford = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const grotto = db.put('entities', createEntity({ kind: 'place', name: 'Salzgrotte' }));
  const guild = db.put('entities', createEntity({ kind: 'faction', name: 'Salzsieder' }));
  const house = db.put('entities', createEntity({ kind: 'family', name: 'Haus Tannhaus' }));
  const lando = db.put('entities', createEntity({ kind: 'person', name: 'Lando Furtner' }));
  db.setState({ placeId: ford.id });
  const scheme = newScheme(db, guild.id)!;
  setStorySteps(db, scheme.id, [
    { id: 'a', text: 'Die Salzsieder kaufen die Pacht der Grotte', days: 2 },
    { id: 'b', text: 'Die Salzsieder sperren den Zugang', days: 3 },
  ]);
  return { db, data, now, ford, grotto, guild, house, lando, scheme };
}

describe('Vorhaben sind Geschichten', () => {
  it('ein neues Vorhaben ist eine Geschichte mit Antreiber; die Uhr entsteht mit dem ersten Schritt', async () => {
    const { db, data, guild, scheme } = await setup();
    const story = data().stories[scheme.id]!;
    expect(story.ownerId).toBe(guild.id);
    expect(story.clockId).not.toBeNull();
    expect(data().clocks[story.clockId!]!.ownerId).toBe(guild.id);
    expect(newScheme(db, 'gibt-es-nicht')).toBeNull();
    // Kein zweites Uhrenwerk: Es gibt genau eine Uhr, und sie gehört zur Geschichte.
    expect(Object.keys(data().clocks)).toEqual([story.clockId]);
  });

  it('zeigt den nächsten Schritt mit Datum, was zuletzt geschah und wie weit es ist', async () => {
    const { db, data, now, guild, scheme } = await setup();
    let [view] = schemesOf(data(), guild.id);
    expect(view).toMatchObject({
      key: `story:${scheme.id}`,
      pace: 'running',
      next: { text: 'Die Salzsieder kaufen die Pacht der Grotte', at: now + 2 * DAY },
      last: null,
      behind: 0,
      total: 2,
    });
    advanceTime(db, now + 2 * DAY);
    [view] = schemesOf(data(), guild.id);
    expect(view!.last).toEqual({
      text: 'Die Salzsieder kaufen die Pacht der Grotte',
      at: now + 2 * DAY,
      prevented: false,
    });
    expect(view!.next).toMatchObject({
      text: 'Die Salzsieder sperren den Zugang',
      at: now + 5 * DAY,
    });
    // Verhindert die Gruppe den Schritt, steht er als verhindert da.
    settleStep(db, data().stories[scheme.id]!.clockId!, true);
    [view] = schemesOf(data(), guild.id);
    expect(view).toMatchObject({ pace: 'done', next: null, last: { prevented: true } });
  });

  it('eine angehaltene Uhr ruht, eine ohne Schritte hat keine Uhr; zu Ende Erzähltes nur auf Wunsch', async () => {
    const { db, data, now, guild, lando } = await setup();
    const plain = db.put('stories', createStory({ title: 'Der Salzpreis', ownerId: guild.id }));
    const paused = db.put(
      'clocks',
      createClock({
        title: 'Furtners Rache',
        ownerId: lando.id,
        start: now,
        pausedAt: now,
        steps: [step('x', 'Lando kauft Gift', 1)],
      }),
    );
    expect(schemesOf(data(), guild.id).map((s) => [s.title, s.pace])).toEqual([
      ['Neues Vorhaben', 'running'],
      ['Der Salzpreis', 'none'],
    ]);
    // Eine alte Uhr ohne Geschichte zählt mit – zum Umwandeln.
    expect(schemesOf(data(), lando.id)).toMatchObject([
      { key: `clock:${paused.id}`, story: null, pace: 'paused' },
    ]);
    db.patch('stories', plain.id, { closed: true });
    expect(schemesOf(data(), guild.id)).toHaveLength(1);
    expect(schemesOf(data(), guild.id, { withClosed: true })).toHaveLength(2);
    expect([...schemeDrivers(data())].sort()).toEqual([guild.id, lando.id].sort());
  });

  it('der Antreiber ist der der Geschichte, sonst der der Uhr', async () => {
    const { db, data, now, house } = await setup();
    const clock = db.put(
      'clocks',
      createClock({ title: 'Die Mitgift', ownerId: house.id, start: now }),
    );
    const story = db.put('stories', createStory({ title: 'Die Mitgift', clockId: clock.id }));
    expect(driverOf(data(), story)).toBe(house.id);
    expect(schemesOf(data(), house.id).map((s) => s.key)).toEqual([`story:${story.id}`]);
  });
});

describe('Was eine Fraktion getan hat', () => {
  it('sammelt Schritte, Haltungsänderungen und Veränderungen, die sie nennen – ohne Doppel', async () => {
    const { db, data, now, guild, grotto } = await setup();
    advanceTime(db, now + 2 * DAY);
    setAttitude(db, guild.id, PARTY_ID, -2, 'Die Gruppe hat in der Grotte geschnüffelt');
    db.put(
      'chronicle',
      createChronicleEntry({
        kind: 'change',
        at: now + DAY,
        text: 'Ein Salzsieder wird in der Grotte gesehen',
        placeId: grotto.id,
        refs: [guild.id],
      }),
    );
    // Eine Notiz am Tisch ist kein Tun der Fraktion.
    db.put(
      'chronicle',
      createChronicleEntry({ kind: 'note', at: now + DAY, text: 'Notiz', refs: [guild.id] }),
    );
    const deeds = deedsOf(data(), guild.id, now);
    expect(deeds.map((deed) => [deed.kind, deed.text])).toEqual([
      [
        'attitude',
        'Haltung zur Gruppe: Unbekannt → Ablehnend – Die Gruppe hat in der Grotte geschnüffelt',
      ],
      ['step', 'Die Salzsieder kaufen die Pacht der Grotte'],
      ['change', 'Ein Salzsieder wird in der Grotte gesehen'],
    ]);
    // Was vor der Spanne liegt (die Veränderung am ersten Tag), zählt nicht.
    expect(deedsOf(data(), guild.id, now + DAY).map((deed) => deed.kind)).toEqual([
      'attitude',
      'step',
    ]);
  });

  it('nach Fraktion: seit dem letzten Abend, Tätige zuerst, Ruhige mit laufendem Vorhaben darunter', async () => {
    const { db, data, now, guild, house, lando } = await setup();
    db.put(
      'clocks',
      createClock({
        title: 'Furtners Rache',
        ownerId: lando.id,
        start: now,
        steps: [step('x', 'Lando kauft Gift', 20)],
      }),
    );
    startSession(db, { number: 1 });
    advanceTime(db, now + 60);
    endSession(db);
    const evening = lastEvening(data());
    expect(evening).toMatchObject({ at: now + 60, running: false });
    advanceTime(db, now + 3 * DAY);
    const turn = factionTurn(data(), evening!.at);
    expect(turn.active.map((group) => group.entity.id)).toEqual([guild.id]);
    expect(turn.active[0]!.deeds[0]!.text).toBe('Die Salzsieder kaufen die Pacht der Grotte');
    expect(turn.active[0]!.schemes[0]!.next!.text).toBe('Die Salzsieder sperren den Zugang');
    // Lando treibt ein Vorhaben an, hat aber noch nichts getan; Haus Tannhaus hat nichts vor.
    expect(turn.quiet.map((group) => group.entity.id)).toEqual([lando.id]);
    expect([...turn.active, ...turn.quiet].some((group) => group.entity.id === house.id)).toBe(
      false,
    );
  });

  it('der letzte Abend: ohne Session keiner, während der ersten ihr Beginn', async () => {
    const { db, data, now } = await setup();
    expect(lastEvening(data())).toBeNull();
    startSession(db, { number: 1 });
    expect(lastEvening(data())).toMatchObject({ at: now, running: true });
  });
});

describe('Zeit vorstellen fragt nie und bleibt nie hängen', () => {
  /** Ein Ablauf, der nicht mehr fährt – die Uhr, die an ihm hängt, bleibt stehen. */
  async function blockedWorld() {
    const world = await setup();
    const { db, now, ford, grotto, guild } = world;
    const run = db.put(
      'runs',
      createRun({
        name: 'Salzkahn',
        fromId: ford.id,
        toId: grotto.id,
        start: now - 10 * DAY,
        stoppedAt: now - DAY,
        stopReason: 'Der Kahn ist leck',
      }),
    );
    const stuck = db.put(
      'clocks',
      createClock({
        title: 'Die Salzsieder füllen die Lager',
        ownerId: guild.id,
        start: now,
        steps: [step('s', 'Die Lager sind voll', 1, { needs: 'Das Salz kommt', runId: run.id })],
      }),
    );
    return { ...world, run, stuck };
  }

  it('advanceTime: Die Zeit läuft ganz durch, andere Uhren auch – die stehende ist ein Vorschlag', async () => {
    const { db, data, now, stuck } = await blockedWorld();
    const result = advanceTime(db, now + 4 * DAY);
    expect(data().state.now).toBe(now + 4 * DAY);
    expect(result.blocked.map((block) => block.clock.id)).toEqual([stuck.id]);
    expect(result.steps.map((s) => s.step.id)).toEqual(['a']);
    // Gemeldet wird leise, mit Verweis aufs Weltgeschehen.
    expect(hasNews({ ...result, steps: [], occurred: [], expired: [] })).toBe(true);
    expect(meanwhile(data(), result).lines.map((line) => line.text)).toContain(
      'Steht still: Die Salzsieder füllen die Lager – Das Salz kommt: Salzkahn fährt nicht: Der Kahn ist leck (siehe Weltgeschehen)',
    );
    expect(worldTurn(data()).suggestions.map((entry) => entry.key)).toEqual([`clock:${stuck.id}`]);
    // Ein zweiter Sprung meldet die stehende Uhr nicht noch einmal und läuft ebenso durch.
    const again = advanceTime(db, now + 10 * DAY);
    expect(again.blocked).toEqual([]);
    expect(data().state.now).toBe(now + 10 * DAY);
  });

  it('Gehen und freie Zeit laufen ebenso durch – ohne Rückfrage', async () => {
    const { db, data, now, grotto, stuck } = await blockedWorld();
    const walked = walk(db, grotto.id, 2 * DAY);
    expect(walked.advance!.blocked.map((block) => block.clock.id)).toEqual([stuck.id]);
    expect(data().state.now).toBe(now + 2 * DAY);
    expect(data().state.placeId).toBe(grotto.id);
    const hero = db.put('entities', createEntity({ kind: 'character', name: 'Ilka Sturmfels' }));
    const spent = spendDowntime(db, { days: 3, projects: [], work: [] });
    expect(hero.kind).toBe('character');
    expect(spent).not.toBeNull();
    expect(data().state.now).toBe(now + 5 * DAY);
  });
});
