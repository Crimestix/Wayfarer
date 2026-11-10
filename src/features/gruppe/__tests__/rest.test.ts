import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../../data/db';
import { demoCampaign } from '../../../data/__fixtures__/demoWorld';
import { MemoryStore } from '../../../data/store';
import { chronicleFor, entitiesOfKind } from '../../../domain/derive';
import {
  LONG_REST_GAP_MINUTES,
  longRestEffects,
  minutesUntilLongRest,
  proposeWatches,
  remainingMinutes,
  restingParty,
  resumableRest,
  watchAt,
  watchMinutes,
  watchViews,
} from '../../../domain/rest';
import type { Character } from '../../../domain/schema';
import { patchCharacter } from '../actions';
import { takeRest } from '../rest';

async function demoDb() {
  const db = await CampaignDb.create(new MemoryStore(), demoCampaign());
  return db;
}
const heroes = (db: CampaignDb) => restingParty(entitiesOfKind(db.getSnapshot(), 'character'));
const hero = (db: CampaignDb, name: string) =>
  entitiesOfKind(db.getSnapshot(), 'character').find((c) => c.name === name) as Character;
const ids = () => {
  let n = 0;
  return () => `wache${++n}`;
};

describe('Wachplan', () => {
  it('verteilt die Gefährten reihum auf vier Wachen zu zwei Stunden', async () => {
    const db = await demoDb();
    const party = heroes(db);
    const names = party.map((c) => c.name);
    expect(names.length).toBeGreaterThanOrEqual(5);
    const watches = proposeWatches(
      1000,
      party.map((c) => c.id),
      ids(),
    );
    expect(watches.map((w) => [w.start, w.end])).toEqual([
      [1000, 1120],
      [1120, 1240],
      [1240, 1360],
      [1360, 1480],
    ]);
    // Jeder wacht genau einmal, also zwei Stunden.
    for (const c of party) expect(watchMinutes(watches, c.id)).toBe(120);
    expect(watchAt(watches, 1125)?.id).toBe('wache2');
    expect(watchAt(watches, 1480)).toBeUndefined();

    // Zu zweit bleiben zwei Wachen unbesetzt – niemand wacht doppelt.
    const two = proposeWatches(0, [party[0]!.id, party[1]!.id], ids());
    expect(two.map((w) => w.characterIds.length)).toEqual([1, 1, 0, 0]);
  });

  it('nennt je Wache die höchste Passive Wahrnehmung', async () => {
    const db = await demoDb();
    const [a, b] = heroes(db);
    patchCharacter(db, a!.id, { passivePerception: 12 });
    patchCharacter(db, b!.id, { passivePerception: 16 });
    const party = heroes(db);
    const views = watchViews(
      [
        { id: 'w1', start: 0, end: 120, characterIds: [a!.id, b!.id] },
        { id: 'w2', start: 120, end: 240, characterIds: [] },
      ],
      party,
    );
    expect(views[0]!.best).toEqual({ value: 16, name: b!.name });
    expect(views[1]).toMatchObject({ characters: [], best: null });
  });
});

describe('Lange Rast', () => {
  it('lässt acht Stunden vergehen, füllt die Trefferpunkte und senkt die Erschöpfung', async () => {
    const db = await demoDb();
    const tomlin = hero(db, 'Tomlin');
    const corrin = hero(db, 'Corrin');
    patchCharacter(db, tomlin.id, { hpMax: 30, hp: 11, exhaustion: 1 });
    patchCharacter(db, corrin.id, { hpMax: null, hp: null, exhaustion: 3 });
    const now = db.getSnapshot().state.now;
    const party = heroes(db);
    const watches = proposeWatches(
      now,
      party.map((c) => c.id),
      ids(),
    );

    const result = takeRest(db, { kind: 'long', participants: party.map((c) => c.id), watches });
    expect(db.getSnapshot().state.now).toBe(now + 480);
    expect(hero(db, 'Tomlin').character).toMatchObject({ hp: 30, exhaustion: 0 });
    // Wer keine Trefferpunkte mitführt, bekommt auch keine eingetragen.
    expect(hero(db, 'Corrin').character).toMatchObject({ hp: null, exhaustion: 2 });
    expect(result.interrupted).toBe(false);
    expect(result.text).toBe(
      'Lange Rast abgeschlossen. Trefferpunkte wieder voll: Tomlin. Erschöpfung um 1 gesenkt: Corrin noch Stufe 2 und Tomlin ist wieder frisch.',
    );
    const note = chronicleFor(db.getSnapshot(), tomlin.id).at(-1)!;
    expect(note).toMatchObject({ kind: 'note', at: now + 480, text: result.text });
    expect(Object.values(db.getSnapshot().rests)).toMatchObject([
      { kind: 'long', status: 'done', start: now, end: now + 480 },
    ]);
    // Die nächste Lange Rast ist erst 16 Stunden nach dem Ende wieder dran.
    const rests = Object.values(db.getSnapshot().rests);
    expect(minutesUntilLongRest(rests, now + 480)).toBe(LONG_REST_GAP_MINUTES);
    expect(minutesUntilLongRest(rests, now + 480 + LONG_REST_GAP_MINUTES)).toBe(0);

    result.undo();
    expect(db.getSnapshot().state.now).toBe(now);
    expect(hero(db, 'Tomlin').character).toMatchObject({ hp: 11, exhaustion: 1 });
    expect(hero(db, 'Corrin').character.exhaustion).toBe(3);
    expect(Object.keys(db.getSnapshot().rests)).toEqual([]);
    expect(chronicleFor(db.getSnapshot(), tomlin.id).some((e) => e.text === result.text)).toBe(
      false,
    );
  });

  it('gibt nichts, wenn jemand länger als zwei Stunden wacht', async () => {
    const db = await demoDb();
    const tomlin = hero(db, 'Tomlin');
    patchCharacter(db, tomlin.id, { hpMax: 30, hp: 5, exhaustion: 2 });
    const effects = longRestEffects(
      [hero(db, 'Tomlin')],
      [
        { id: 'w1', start: 0, end: 120, characterIds: [tomlin.id] },
        { id: 'w2', start: 120, end: 240, characterIds: [tomlin.id] },
      ],
    );
    expect(effects[0]).toMatchObject({ overWatched: true, hpAfter: 5, exhaustionAfter: 2 });
  });

  it('lässt sich stören und danach fortsetzen – je Störung eine Stunde länger', async () => {
    const db = await demoDb();
    const tomlin = hero(db, 'Tomlin');
    patchCharacter(db, tomlin.id, { hpMax: 30, hp: 11, exhaustion: 1 });
    const now = db.getSnapshot().state.now;
    const party = heroes(db);
    const watches = proposeWatches(
      now,
      party.map((c) => c.id),
      ids(),
    );
    const third = watches[1]!.characterIds.map((id) => db.getSnapshot().entities[id]!.name);

    const first = takeRest(db, {
      kind: 'long',
      participants: party.map((c) => c.id),
      watches,
      interruptedAfter: 180,
      reason: 'Wölfe am Lager',
    });
    expect(first.interrupted).toBe(true);
    expect(db.getSnapshot().state.now).toBe(now + 180);
    // Noch keine Erholung – aber die Chronik weiß, wer gerade wachte.
    expect(hero(db, 'Tomlin').character).toMatchObject({ hp: 11, exhaustion: 1 });
    expect(first.text).toContain('Lange Rast nach 3 Std. unterbrochen: Wölfe am Lager.');
    for (const name of third) expect(first.text).toContain(name);

    // Im Plan der unterbrochenen Rast steht nur, was bis zur Störung gewacht wurde.
    expect(first.rest.watches.map((w) => [w.start - now, w.end - now])).toEqual([
      [0, 120],
      [120, 180],
    ]);

    // Eine halbe Stunde Aufregung, dann weiter.
    const later = now + 210;
    db.setState({ now: later });
    const open = resumableRest(Object.values(db.getSnapshot().rests), later)!;
    expect(open.id).toBe(first.rest.id);
    // Acht Stunden, drei davon geruht, eine Stunde Aufschlag.
    expect(remainingMinutes(open)).toBe(480 - 180 + 60);

    // Der neue Wachplan teilt nur ein, wer sein Maß von zwei Stunden noch nicht voll hat.
    const used = Object.fromEntries(party.map((c) => [c.id, watchMinutes(open.watches, c.id)]));
    const rested = party.filter((c) => !used[c.id]).map((c) => c.id);
    const more = proposeWatches(
      later,
      party.map((c) => c.id),
      ids(),
      remainingMinutes(open),
      used,
    );
    expect(more).toHaveLength(3);
    expect(more.flatMap((w) => w.characterIds).sort()).toEqual([...rested].sort());

    const second = takeRest(db, {
      kind: 'long',
      participants: party.map((c) => c.id),
      watches: more,
      resumeId: open.id,
    });
    expect(second.effects.some((e) => e.overWatched)).toBe(false);
    expect(db.getSnapshot().state.now).toBe(later + 360);
    expect(hero(db, 'Tomlin').character).toMatchObject({ hp: 30, exhaustion: 0 });
    expect(second.text).toMatch(/^Lange Rast nach der Unterbrechung abgeschlossen\./);
    const rests = Object.values(db.getSnapshot().rests);
    expect(rests).toHaveLength(1);
    expect(rests[0]).toMatchObject({
      status: 'done',
      start: now,
      end: later + 360,
      interruptions: [{ at: now + 180, minutes: 30, text: 'Wölfe am Lager' }],
    });
    expect(resumableRest(rests, later + 360)).toBeNull();

    // Zurücknehmen stellt die unterbrochene Rast wieder her.
    second.undo();
    expect(db.getSnapshot().state.now).toBe(later);
    expect(hero(db, 'Tomlin').character).toMatchObject({ hp: 11, exhaustion: 1 });
    expect(Object.values(db.getSnapshot().rests)[0]).toMatchObject({ status: 'interrupted' });
  });

  it('überschreibt beim Zurücknehmen keine späteren Änderungen von Hand', async () => {
    const db = await demoDb();
    const tomlin = hero(db, 'Tomlin');
    patchCharacter(db, tomlin.id, { hpMax: 30, hp: 11, exhaustion: 2 });
    const result = takeRest(db, { kind: 'long', participants: [tomlin.id] });
    patchCharacter(db, tomlin.id, { hp: 20, exhaustion: 4 });
    result.undo();
    expect(hero(db, 'Tomlin').character).toMatchObject({ hp: 20, exhaustion: 4 });
  });
});

describe('Kurze Rast', () => {
  it('lässt eine Stunde vergehen und steht in der Chronik', async () => {
    const db = await demoDb();
    const tomlin = hero(db, 'Tomlin');
    patchCharacter(db, tomlin.id, { hpMax: 30, hp: 11, exhaustion: 1 });
    const now = db.getSnapshot().state.now;
    const result = takeRest(db, { kind: 'short', participants: [tomlin.id] });
    expect(db.getSnapshot().state.now).toBe(now + 60);
    expect(result.text).toBe('Kurze Rast (1 Std.).');
    // Die Kurze Rast ändert von selbst nichts an den Werten.
    expect(hero(db, 'Tomlin').character).toMatchObject({ hp: 11, exhaustion: 1 });
    expect(Object.values(db.getSnapshot().rests)).toMatchObject([
      { kind: 'short', status: 'done' },
    ]);
    // Sie sperrt keine Lange Rast.
    expect(minutesUntilLongRest(Object.values(db.getSnapshot().rests), now + 60)).toBe(0);
  });
});
