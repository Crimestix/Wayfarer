import { describe, expect, it } from 'vitest';
import { endSession, startSession } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  ensurePrep,
  patchPrep,
  setSceneDone,
  setSecretRevealed,
} from '../../features/abend/actions';
import { newStory } from '../../features/faeden/actions';
import {
  SECRETS_WANTED,
  currentPrep,
  openScenes,
  openSecrets,
  prepAdvice,
  prepHasContent,
  prepView,
  readyEncounters,
} from '../prep';
import { createEncounter, createEntity, newId, type PrepScene, type PrepSecret } from '../schema';

/** Ein Spielstand ohne laufende Session – der nächste Abend ist noch nicht vorbereitet. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  endSession(db);
  const data = () => db.getSnapshot();
  const scene = (text: string, done = false): PrepScene => ({ id: newId(), text, done });
  const secret = (text: string, revealed = false): PrepSecret => ({
    id: newId(),
    text,
    storyId: null,
    revealed,
    revealedAt: null,
  });
  const highest = () => Math.max(0, ...Object.values(data().sessions).map((s) => s.number));
  return { db, data, scene, secret, highest };
}

describe('Das Blatt eines Abends', () => {
  it('entsteht mit dem ersten Wort und gilt dem kommenden Abend', async () => {
    const { db, data, scene, secret, highest } = await setup();
    let view = prepView(data());
    expect(view.prep).toBeNull();
    expect(view.session).toBeNull();
    expect(view.number).toBe(highest() + 1);
    expect(prepHasContent(data(), view.content)).toBe(false);

    patchPrep(db, {
      start: 'Ein leeres Boot treibt aus dem Nebel.',
      scenes: [scene('Der Fährmann verlangt Salz'), scene('   ')],
      secrets: [secret('Der Zöllner hat das Geld selbst genommen'), secret('')],
    });
    expect(Object.keys(data().preps)).toHaveLength(1);
    view = prepView(data());
    expect(view.prep?.sessionId).toBeNull();
    // Leere Zeilen werden nie gespeichert.
    expect(view.content.scenes).toHaveLength(1);
    expect(view.content.secrets).toHaveLength(1);
    expect(prepHasContent(data(), view.content)).toBe(true);
    // Ein zweites Schreiben legt kein zweites Blatt an.
    patchPrep(db, { treasure: 'Ein Kompass, der nach unten zeigt' });
    expect(Object.keys(data().preps)).toHaveLength(1);
  });

  it('gehört zur Session, sobald sie beginnt – und was offen bleibt, wandert weiter', async () => {
    const { db, data, scene, secret } = await setup();
    const [played, waiting] = [scene('Der Fährmann verlangt Salz'), scene('Die Krähen legen an')];
    const [told, kept] = [
      secret('Der Zöllner hat das Geld genommen'),
      secret('Das Boot gehört Mira'),
    ];
    patchPrep(db, {
      start: 'Ein leeres Boot treibt aus dem Nebel.',
      scenes: [played, waiting],
      secrets: [told, kept],
      treasure: 'Ein Kompass',
    });
    const session = startSession(db);
    expect(currentPrep(data())?.sessionId).toBe(session.id);
    expect(prepView(data())).toMatchObject({ number: session.number, session: { id: session.id } });

    // Am Tisch: eine Szene gespielt, ein Geheimnis aufgedeckt.
    setSceneDone(db, played.id, true);
    setSecretRevealed(db, told.id, true);
    const during = prepView(data()).content;
    expect(openScenes(during).map((entry) => entry.text)).toEqual(['Die Krähen legen an']);
    expect(openSecrets(during).map((entry) => entry.text)).toEqual(['Das Boot gehört Mira']);
    expect(during.secrets.find((entry) => entry.id === told.id)?.revealedAt).toBe(data().state.now);
    setSecretRevealed(db, told.id, false);
    expect(openSecrets(prepView(data()).content)).toHaveLength(2);
    setSecretRevealed(db, told.id, true);

    // Der Abend ist vorbei: Das neue Blatt beginnt mit dem, was offen blieb – nicht mit dem
    // Einstieg und der Beute des alten.
    endSession(db);
    const next = prepView(data());
    expect(next.prep).toBeNull();
    expect(next.number).toBe(session.number + 1);
    expect(next.carried).toEqual({ scenes: 1, secrets: 1 });
    expect(next.content).toMatchObject({ start: '', treasure: '' });
    expect(next.content.scenes.map((entry) => entry.text)).toEqual(['Die Krähen legen an']);
    // Das alte Blatt bleibt bei seiner Session.
    const fresh = ensurePrep(db);
    expect(fresh.sessionId).toBeNull();
    expect(fresh.secrets.map((entry) => entry.text)).toEqual(['Das Boot gehört Mira']);
    expect(Object.keys(data().preps)).toHaveLength(2);
  });

  it('wer mitten im Abend zu schreiben beginnt, meint diesen Abend', async () => {
    const { db, data, scene } = await setup();
    const session = startSession(db);
    expect(prepView(data())).toMatchObject({ prep: null, number: session.number });
    patchPrep(db, { scenes: [scene('Die Krähen legen an')] });
    expect(currentPrep(data())?.sessionId).toBe(session.id);
  });

  it('legt Begegnungen bereit und hängt Geheimnisse an Geschichten – nur an solche, die es gibt', async () => {
    const { db, data, secret } = await setup();
    const ambush = db.put('encounters', createEncounter({ name: 'Hinterhalt am Steg' }));
    const story = newStory(db, { title: 'Der Griff nach dem Zoll' });
    patchPrep(db, {
      encounterIds: [ambush.id, ambush.id, 'gibtsnicht'],
      secrets: [
        { ...secret('Der Zöllner hat das Geld genommen'), storyId: story.id },
        { ...secret('Das Boot gehört Mira'), storyId: 'gibtsnicht' },
      ],
    });
    const content = prepView(data()).content;
    expect(content.encounterIds).toEqual([ambush.id]);
    expect(readyEncounters(data(), content).map((entry) => entry.name)).toEqual([
      'Hinterhalt am Steg',
    ]);
    expect(content.secrets.map((entry) => entry.storyId)).toEqual([story.id, null]);
    // Eine gelöschte Begegnung verschwindet einfach vom Blatt.
    db.remove('encounters', ambush.id);
    expect(readyEncounters(data(), prepView(data()).content)).toEqual([]);
  });

  it('sagt, was dem Abend noch fehlt – als Rat', async () => {
    const { db, data, scene, secret } = await setup();
    for (const entity of Object.values(data().entities))
      if (entity.kind === 'character') db.remove('entities', entity.id);
    const open = () =>
      prepAdvice(data(), prepView(data()).content)
        .filter((entry) => !entry.done)
        .map((entry) => entry.key);
    expect(open()).toEqual([
      'goals',
      'start',
      'stories',
      'scenes',
      'secrets',
      'encounter',
      'treasure',
    ]);
    const mate = db.put(
      'entities',
      createEntity({ kind: 'character', name: 'Corrin', character: { goal: '' } }),
    );
    expect(prepAdvice(data(), prepView(data()).content)[0]!.why).toBe('Fehlt bei Corrin.');
    if (mate.kind === 'character')
      db.put('entities', {
        ...mate,
        character: { ...mate.character, goal: 'Will seine Schwester finden.' },
      });
    newStory(db, { inPlay: true });
    const ambush = db.put('encounters', createEncounter({ name: 'Hinterhalt am Steg' }));
    patchPrep(db, {
      start: 'Ein leeres Boot treibt aus dem Nebel.',
      scenes: [scene('Eins'), scene('Zwei'), scene('Drei')],
      secrets: Array.from({ length: SECRETS_WANTED - 1 }, (_, i) => secret(`Geheimnis ${i + 1}`)),
      encounterIds: [ambush.id],
      treasure: 'Ein Kompass',
    });
    expect(open()).toEqual(['secrets']);
    expect(
      prepAdvice(data(), prepView(data()).content).find((entry) => entry.key === 'secrets')!.why,
    ).toContain(`${SECRETS_WANTED - 1} von ${SECRETS_WANTED}`);
  });
});
