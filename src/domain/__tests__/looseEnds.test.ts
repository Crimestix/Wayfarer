import { describe, expect, it } from 'vitest';
import { advanceTime, moveParty, startSession } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { patchCharacter } from '../../features/gruppe/actions';
import { reviseRecorded } from '../../features/chronik/actions';
import { recordEntry } from '../../data/record';
import { looseAfterPin, looseEnds, looseEndsHere, looseGroups, sinceText } from '../looseEnds';
import { createChronicleEntry, createEntity, type ChronicleEntry } from '../schema';
import { MINUTES_PER_DAY } from '../time/calendar';

/** Hohenfurt mit dem Hafen darin, die Salzgrotte und Lando Furtner – erfunden. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const town = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const harbour = db.put(
    'entities',
    createEntity({ kind: 'place', name: 'Hafen', place: { parentId: town.id } } as never),
  );
  const grotto = db.put('entities', createEntity({ kind: 'place', name: 'Salzgrotte' }));
  const lando = db.put('entities', createEntity({ kind: 'character', name: 'Lando Furtner' }));
  moveParty(db, town.id);
  const add = (init: Partial<ChronicleEntry>) =>
    db.put('chronicle', createChronicleEntry({ at: db.getSnapshot().state.now, ...init }));
  const later = (days: number) =>
    advanceTime(db, db.getSnapshot().state.now + days * MINUTES_PER_DAY);
  return { db, town, harbour, grotto, lando, add, later, data: () => db.getSnapshot() };
}

describe('Was hängt noch offen', () => {
  it('nimmt Abmachungen, ungeprüfte Gerüchte, Wünsche und Angeheftetes', async () => {
    const { add, lando, data, later } = await setup();
    const promise = add({
      kind: 'promise',
      text: 'Die Schuld bei Odo begleichen',
      promise: { due: null, done: false, failed: false },
    });
    const kept = add({
      kind: 'promise',
      text: 'Den Brief abgeben',
      promise: { due: null, done: true, failed: false },
    });
    const rumor = add({ kind: 'rumor', text: 'In der Grotte liegt Salzsilber' });
    const checked = add({
      kind: 'rumor',
      text: 'Der Müller lügt',
      rumor: { sourceId: null, truth: 'false' },
    });
    const wish = add({ kind: 'wish', text: 'Ein eigenes Boot', refs: [lando.id] });
    const note = add({ kind: 'note', text: 'Der Dolch liegt unter dem Stein am Fluss' });
    const pinned = add({ kind: 'note', text: 'Die goldene Eichel', loose: 'open' });
    const settled = add({ kind: 'rumor', text: 'Erledigt', loose: 'settled' });
    later(2);
    const ids = looseEnds(data()).map((end) => end.entry.id);
    expect(ids).toEqual(expect.arrayContaining([promise.id, rumor.id, wish.id, pinned.id]));
    for (const id of [kept.id, checked.id, note.id, settled.id]) expect(ids).not.toContain(id);
    expect(looseGroups(looseEnds(data())).map((group) => group.reason)).toEqual([
      'pinned',
      'promise',
      'rumor',
      'wish',
    ]);
  });

  it('ein Wunsch, der ein Ziel wurde, ist vorbei, wenn das Ziel ein anderes ist', async () => {
    const { db, add, lando, data } = await setup();
    const wish = add({
      kind: 'wish',
      text: 'Ein eigenes Boot',
      refs: [lando.id],
      wish: { setGoal: true, before: null },
    });
    patchCharacter(db, lando.id, { goal: 'Ein eigenes Boot' });
    expect(looseEnds(data()).map((end) => end.entry.id)).toContain(wish.id);
    patchCharacter(db, lando.id, { goal: 'Rache' });
    expect(looseEnds(data()).map((end) => end.entry.id)).not.toContain(wish.id);
  });

  it('Orte: entdeckt und nie dort, vorgenommen und nie angekommen', async () => {
    const { db, add, town, harbour, grotto, data, later } = await setup();
    // Entdeckt, während die Gruppe dort war: nichts offen.
    add({ kind: 'discovery', placeId: town.id });
    const seen = add({ kind: 'discovery', placeId: grotto.id });
    const plan = add({
      kind: 'decision',
      text: 'Morgen zum Hafen',
      placeId: town.id,
      refs: [harbour.id],
    });
    later(1);
    expect(looseEnds(data()).map((end) => end.entry.id)).toEqual([seen.id, plan.id]);
    // Die Gruppe geht in den Hafen: das Vorhaben ist erfüllt, die Grotte bleibt offen.
    moveParty(db, harbour.id);
    expect(looseEnds(data()).map((end) => end.entry.id)).toEqual([seen.id]);
    later(1);
    moveParty(db, grotto.id);
    expect(looseEnds(data())).toEqual([]);
  });

  it('weiß, was hier offen ist und seit wie vielen Abenden', async () => {
    const { db, add, town, harbour, grotto, data, later } = await setup();
    const rumor = add({ kind: 'rumor', text: 'Im Hafen fehlt ein Kahn', refs: [harbour.id] });
    const far = add({ kind: 'rumor', text: 'Die Grotte flutet', refs: [grotto.id] });
    const promise = add({
      kind: 'promise',
      text: 'Mira helfen',
      placeId: town.id,
      refs: [town.id],
      promise: { due: null, done: false, failed: false },
    });
    later(1);
    startSession(db);
    later(3);
    startSession(db);
    const ends = looseEnds(data());
    const of = (id: string) => ends.find((end) => end.entry.id === id)!;
    // In Hohenfurt: das Gerücht über den Hafen darin ist „hier“, die Grotte nicht.
    expect(of(rumor.id).here).toBe(true);
    expect(of(far.id).here).toBe(false);
    expect(sinceText(of(rumor.id))).toBe('seit 2 Abenden');
    // Am Spieltisch ohne Abmachungen – die stehen unter „Sonst noch“.
    expect(of(promise.id).here).toBe(true);
    expect(looseEndsHere(data()).map((end) => end.entry.id)).toEqual([rumor.id]);
  });

  it('ein Ortswechsel in derselben Minute erfüllt ein Vorhaben; wo man schon steht, ist kein Ziel', async () => {
    const { db, add, town, harbour, data } = await setup();
    const plan = add({ kind: 'decision', text: 'Zum Hafen', placeId: town.id, refs: [harbour.id] });
    const stay = add({
      kind: 'decision',
      text: 'Wir bleiben hier',
      placeId: harbour.id,
      refs: [town.id],
    });
    expect(looseEnds(data()).map((end) => end.entry.id)).toEqual([plan.id]);
    // Ohne Weg vergeht keine Zeit: Der Ortswechsel trägt dieselbe Minute.
    moveParty(db, harbour.id);
    expect(looseEnds(data())).toEqual([]);
    expect(stay.id).toBeTruthy();
  });

  it('zählt Abende nach der Session des Eintrags – auch in derselben Minute', async () => {
    const { db, add, data } = await setup();
    startSession(db);
    const rumor = add({
      kind: 'rumor',
      text: 'Am Ende des Abends gehört',
      sessionId: data().state.sessionId,
    });
    // Der nächste Abend beginnt in derselben Weltminute.
    startSession(db);
    expect(sinceText(looseEnds(data()).find((end) => end.entry.id === rumor.id)!)).toBe(
      'seit dem letzten Abend',
    );
  });

  it('die Nadel lösen nimmt auch von selbst Offenes heraus; Bearbeiten behält sie', async () => {
    const { db, add, data } = await setup();
    const rumor = add({ kind: 'rumor', text: 'Die Grotte flutet' });
    const note = add({ kind: 'note', text: 'Nur eine Notiz' });
    expect(looseAfterPin(data(), rumor, true)).toBe('open');
    expect(looseAfterPin(data(), rumor, false)).toBe('settled');
    expect(looseAfterPin(data(), note, false)).toBeNull();
    // Ein angehefteter Eintrag, dessen Art im Dialog geändert wird, bleibt angeheftet.
    const written = recordEntry(db, { kind: 'note', text: 'Die goldene Eichel' });
    if ('problem' in written) throw new Error(written.problem);
    db.patch('chronicle', written.entry.id, { loose: 'open' });
    expect(
      reviseRecorded(db, written.entry.id, { kind: 'decision', text: 'Die goldene Eichel suchen' }),
    ).toBe('');
    expect(data().chronicle[written.entry.id]!.loose).toBe('open');
  });
});
