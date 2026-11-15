import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { activeParty } from '../derive';

import { emptyCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  heroArc,
  lastEveningsText,
  mentorsOf,
  spotlight,
  spotlightHint,
  spotlightHintOf,
} from '../heroArc';
import { prepAdvice, prepView } from '../prep';
import {
  createChronicleEntry,
  createEntity,
  createRelation,
  createSession,
  createStory,
  createTrack,
  type ChronicleEntry,
} from '../schema';
import { MINUTES_PER_DAY } from '../time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../time/elaris';

const NOW = ELARIS_START + 10 * MINUTES_PER_DAY;

/** Hohenfurt mit Mira und Odo Tannhaus, Lando Furtner und Brann Eichwald – erfunden. */
async function setup() {
  const db = await CampaignDb.create(
    new MemoryStore(),
    emptyCampaign('Testwelt', ELARIS_CALENDAR, NOW),
  );
  const character = (name: string, goal = '') =>
    db.put('entities', createEntity({ kind: 'character', name, character: { goal } } as never));
  const mira = character('Mira Tannhaus', 'Die Salzgrotte zurückgewinnen');
  const lando = character('Lando Furtner');
  const brann = character('Brann Eichwald');
  const odo = db.put('entities', createEntity({ kind: 'person', name: 'Odo Tannhaus' }));
  const add = (init: Partial<ChronicleEntry>) =>
    db.put('chronicle', createChronicleEntry({ at: NOW - 60, ...init }));
  return { db, mira, lando, brann, odo, add, data: () => db.getSnapshot() };
}

describe('Heldenbogen', () => {
  it('sammelt Ziel, Wünsche, Wandlungen, Meilensteine, Lehrer, Geschichten, Leisten und Zustände', async () => {
    const { db, mira, lando, odo, add, data } = await setup();
    const asGoal = add({
      kind: 'wish',
      text: 'Die Salzgrotte zurückgewinnen',
      refs: [mira.id],
      wish: { setGoal: true, before: null },
    });
    const wish = add({ kind: 'wish', text: 'Ein eigenes Boot', refs: [mira.id] });
    add({ kind: 'wish', text: 'Erledigt', refs: [mira.id], loose: 'settled' });
    add({ kind: 'wish', text: 'Fremder Wunsch', refs: [lando.id] });
    const change = add({
      kind: 'transformation',
      text: 'Salzhaut',
      transformation: { characterId: mira.id },
    });
    const first = add({
      kind: 'milestone',
      at: NOW - 200,
      text: 'Den Turm gehalten',
      milestone: { characterId: mira.id, level: 4, before: 3 },
    });
    const second = add({
      kind: 'milestone',
      text: 'Krummzahn gestellt',
      milestone: { characterId: mira.id, level: 5, before: 4 },
    });
    const pain = add({
      kind: 'condition',
      text: 'Pfeil im Bein',
      condition: { entityId: mira.id, ended: false, endsId: null },
    });
    db.put('relations', createRelation({ from: odo.id, to: mira.id, type: 'mentor' }));
    db.put('relations', createRelation({ from: mira.id, to: lando.id, type: 'mentor' }));
    db.put('relations', createRelation({ from: odo.id, to: mira.id, type: 'friend' }));
    const story = db.put(
      'stories',
      createStory({
        title: 'Das Erbe der Tannhaus',
        heroes: [{ id: 'held-1', characterId: mira.id, why: 'Odo ist ihr Onkel' }],
      }),
    );
    const track = db.put(
      'tracks',
      createTrack({ name: 'Weg zur Dunkelrobe', ownerId: mira.id, kind: 'steps', segments: 4 }),
    );

    const arc = heroArc(data(), mira.id)!;
    expect(arc.goal).toBe('Die Salzgrotte zurückgewinnen');
    // Der Wunsch, der schon Ziel ist, steht nicht noch einmal da.
    expect(arc.wishes.map((entry) => entry.id)).toEqual([wish.id]);
    expect(arc.wishes.map((entry) => entry.id)).not.toContain(asGoal.id);
    expect(arc.transformations.map((entry) => entry.id)).toEqual([change.id]);
    expect(arc.milestones.map((entry) => entry.id)).toEqual([second.id, first.id]);
    expect(arc.mentors.map((tie) => [tie.otherId, tie.role, tie.label])).toEqual([
      [odo.id, 'teacher', 'lernt von'],
      [lando.id, 'student', 'lehrt'],
    ]);
    expect(arc.stories.map((tie) => [tie.story.id, tie.why])).toEqual([
      [story.id, 'Odo ist ihr Onkel'],
    ]);
    expect(arc.tracks.map((entry) => entry.id)).toEqual([track.id]);
    expect(arc.conditions.map((entry) => entry.entry.id)).toEqual([pain.id]);

    // Lando sieht dieselbe Beziehung von der anderen Seite.
    expect(mentorsOf(data(), lando.id)).toMatchObject([
      { otherId: mira.id, role: 'teacher', label: 'lernt von' },
    ]);
    expect(heroArc(data(), odo.id)).toBeNull();
  });

  it('kennzeichnet geheime Lehrer und nimmt Wandlungen aus der Chronik', async () => {
    const { db, mira, odo, add, data } = await setup();
    db.put(
      'relations',
      createRelation({ from: odo.id, to: mira.id, type: 'mentor', secret: true, ended: true }),
    );
    const older = add({
      kind: 'transformation',
      at: NOW - 500,
      text: 'Salzaugen',
      transformation: { characterId: mira.id },
    });
    const newer = add({
      kind: 'transformation',
      text: 'Salzhaut',
      transformation: { characterId: mira.id },
    });
    const arc = heroArc(data(), mira.id)!;
    expect(arc.mentors).toMatchObject([{ otherId: odo.id, secret: true, ended: true }]);
    expect(arc.transformations.map((entry) => entry.id)).toEqual([newer.id, older.id]);
    expect(arc.wishes).toEqual([]);
  });
});

describe('Rampenlicht', () => {
  /** Drei vergangene Abende, ein künftiger. */
  async function evenings() {
    const base = await setup();
    const { db } = base;
    const sessions = [1, 2, 3, 4].map((number) =>
      db.put(
        'sessions',
        createSession({ number, startAt: ELARIS_START + (number - 1) * 3 * MINUTES_PER_DAY }),
      ),
    );
    const future = db.put('sessions', createSession({ number: 5, startAt: NOW + MINUTES_PER_DAY }));
    return { ...base, sessions, future };
  }

  it('zählt je Eintrag höchstens einmal, nur die letzten begonnenen Abende', async () => {
    const { mira, lando, brann, odo, add, data, sessions, future } = await evenings();
    const [s1, s2, s3, s4] = sessions.map((session) => session.id);
    // Abend 1 liegt außerhalb der letzten drei.
    add({ sessionId: s1!, refs: [brann.id] });
    add({ sessionId: s2!, refs: [mira.id, lando.id] });
    add({
      sessionId: s3!,
      kind: 'attitude',
      refs: [mira.id],
      attitude: { fromId: odo.id, toId: mira.id, before: 0, after: 2 },
    });
    add({
      sessionId: s4!,
      kind: 'milestone',
      milestone: { characterId: lando.id, level: 3, before: 2 },
    });
    add({ sessionId: s4!, kind: 'quote', text: 'Nie wieder Salz.', refs: [mira.id] });
    // Termine der Welt und Abende in der Zukunft zählen nicht.
    add({ sessionId: s4!, kind: 'event', refs: [brann.id] });
    add({ sessionId: future.id, refs: [brann.id] });

    const view = spotlight(data(), { sessions: 3 });
    expect(view.sessions.map((session) => session.id)).toEqual([s2, s3, s4]);
    expect(view.sessionsWithEntries).toBe(3);
    expect(view.rows.map((row) => [row.character.name, row.count, row.rank])).toEqual([
      ['Mira Tannhaus', 3, 1],
      ['Lando Furtner', 2, 2],
      ['Brann Eichwald', 0, 3],
    ]);
    expect(view.total).toBe(5);
    expect(view.rows[0]!.share).toBeCloseTo(0.6);
    expect(spotlightHint(data())).toBe(
      'Brann Eichwald kam an den letzten drei Abenden in keinem Eintrag vor.',
    );
  });

  it('schweigt bei weniger als zwei Abenden mit Einträgen oder ohne deutlichen Abstand', async () => {
    const { mira, lando, brann, add, data, sessions } = await evenings();
    const [, , s3, s4] = sessions.map((session) => session.id);
    add({ sessionId: s4!, refs: [mira.id] });
    add({ sessionId: s4!, refs: [lando.id] });
    expect(spotlightHint(data())).toBeNull();

    add({ sessionId: s3!, refs: [mira.id, lando.id, brann.id] });
    add({ sessionId: s3!, refs: [brann.id] });
    // Mira 2, Lando 2, Brann 2 – niemand liegt unter der Hälfte des Schnitts.
    expect(spotlightHint(data())).toBeNull();

    add({ sessionId: s3!, refs: [mira.id, lando.id] });
    add({ sessionId: s4!, refs: [mira.id, lando.id] });
    add({ sessionId: s4!, refs: [mira.id, lando.id] });
    // Mira 5, Lando 5, Brann 2: Schnitt 4, Brann liegt darunter, aber nicht unter der Hälfte.
    expect(spotlightHint(data())).toBeNull();
    add({ sessionId: s4!, refs: [mira.id, lando.id] });
    add({ sessionId: s4!, refs: [mira.id, lando.id] });
    add({ sessionId: s4!, refs: [mira.id, lando.id] });
    // Mira 8, Lando 8, Brann 2: Schnitt 6, Brann unter 3.
    expect(spotlightHint(data())).toBe(
      'Brann Eichwald stand an den letzten drei Abenden selten im Mittelpunkt.',
    );
  });

  it('zählt einen Abend nur, wenn ein Eintrag einen Gefährten nennt', async () => {
    const { mira, odo, add, data, sessions } = await evenings();
    const [, , s3, s4] = sessions.map((session) => session.id);
    // An Abend 3 steht nur etwas über Odo – das sagt über das Rampenlicht nichts.
    add({ sessionId: s3!, refs: [odo.id], text: 'Odo verschwindet im Nebel' });
    add({ sessionId: s4!, refs: [mira.id] });
    const view = spotlight(data());
    expect(view.sessionsWithEntries).toBe(1);
    // Ein einziger Eintrag über Mira reicht nicht für einen Satz über die anderen.
    expect(spotlightHint(data())).toBeNull();
    expect(spotlightHintOf(view)).toBeNull();
  });

  it('bleibt ohne Gefährten und ohne Abende leer', async () => {
    const empty = await CampaignDb.create(
      new MemoryStore(),
      emptyCampaign('Leer', ELARIS_CALENDAR, NOW),
    );
    const view = spotlight(empty.getSnapshot());
    expect(view).toMatchObject({ rows: [], sessions: [], total: 0, average: 0 });
    expect(spotlightHint(empty.getSnapshot())).toBeNull();
    expect(spotlight(empty.getSnapshot(), { sessions: 0 }).sessions).toEqual([]);
  });

  it('erscheint als Rat beim Vorbereiten des Abends', async () => {
    const { db, mira, lando, add, data, sessions } = await evenings();
    const [, , s3, s4] = sessions.map((session) => session.id);
    add({ sessionId: s4!, refs: [mira.id] });
    add({ sessionId: s4!, refs: [lando.id] });
    // Ein Abend allein sagt noch nichts.
    const party = () =>
      prepAdvice(data(), prepView(data()).content).find((entry) => entry.key === 'party')!;
    // Ein Abend allein sagt noch nichts.
    expect(spotlightHint(data())).toBeNull();
    add({ sessionId: s3!, refs: [mira.id, lando.id] });
    const hint = spotlightHint(data())!;
    expect(hint).toContain('Brann Eichwald');
    expect(party().why).not.toContain(hint);
    // Ein ruhiger Satz bei den Gefährten – erst, wenn für jeden etwas auf dem Blatt steht, und
    // nie als eigener offener Punkt.
    db.put(
      'stories',
      createStory({
        title: 'Der Griff nach dem Zoll',
        inPlay: true,
        heroes: activeParty(data()).map((character) => ({
          id: character.id,
          characterId: character.id,
          why: '',
        })),
      }),
    );
    expect(party()).toMatchObject({ done: true });
    expect(party().why).toContain(hint);
  });

  it('spricht die Zahl der Abende aus', () => {
    expect(lastEveningsText(0)).toBe('am letzten Abend');
    expect(lastEveningsText(1)).toBe('am letzten Abend');
    expect(lastEveningsText(2)).toBe('an den letzten beiden Abenden');
    expect(lastEveningsText(3)).toBe('an den letzten drei Abenden');
    expect(lastEveningsText(12)).toBe('an den letzten 12 Abenden');
  });
});
