import { describe, expect, it } from 'vitest';
import { endSession, logEntry, moveParty, setTime, startSession } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  addToStart,
  ensurePrep,
  newStoryForHero,
  patchPrep,
  setSceneDone,
  setSecretRevealed,
} from '../../features/abend/actions';
import { newStory, tieHero } from '../../features/faeden/actions';
import {
  SECRETS_WANTED,
  appendLine,
  currentPrep,
  hasLine,
  lastSessionLines,
  openScenes,
  openSecrets,
  prepAdvice,
  prepHasContent,
  prepView,
  readyEncounters,
} from '../prep';
import {
  createEvent,
  createChronicleEntry,
  createEncounter,
  createEntity,
  newId,
  type PrepScene,
  type PrepSecret,
} from '../schema';
import { storiesOfHero } from '../story';

/** Ein Spielstand ohne laufende Session – der nächste Abend ist noch nicht vorbereitet. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  endSession(db);
  const data = () => db.getSnapshot();
  const scene = (text: string, done = false): PrepScene => ({
    id: newId(),
    text,
    done,
    placeId: null,
  });
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
      'hooks',
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
    const story = newStory(db, { inPlay: true });
    expect(prepAdvice(data(), prepView(data()).content)[1]).toMatchObject({
      key: 'hooks',
      done: false,
      why: 'Keine Geschichte im Spiel betrifft Corrin.',
    });
    tieHero(db, story.id, mate.id, 'Seine Schwester ist verschwunden.');
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

describe('Wo es zuletzt aufhörte', () => {
  /** Ein gespielter Abend mit ein paar Einträgen – die Zeit läuft dabei weiter. */
  async function played() {
    const { db, data } = await setup();
    for (const entry of Object.values(data().chronicle)) db.remove('chronicle', entry.id);
    for (const session of Object.values(data().sessions)) db.remove('sessions', session.id);
    const harbour = db.put('entities', createEntity({ kind: 'place', name: 'Nebelsteg' }));
    const first = startSession(db);
    const tick = () => setTime(db, data().state.now + 30);
    logEntry(db, { text: 'Die Gruppe kauft Salz beim Fährmann.' });
    tick();
    logEntry(db, { text: '   ' });
    moveParty(db, harbour.id);
    tick();
    logEntry(db, { kind: 'change', text: 'Der Steg ist eingestürzt.' });
    tick();
    logEntry(db, { kind: 'promise', text: 'Mira bringt das Boot zurück.' });
    tick();
    logEntry(db, { text: 'Ein Schrei aus dem Nebel – dann Stille.' });
    tick();
    endSession(db);
    return { db, data, first, harbour };
  }

  it('gibt es nicht, solange kein Abend gespielt ist', async () => {
    const { db, data } = await setup();
    for (const session of Object.values(data().sessions)) db.remove('sessions', session.id);
    expect(lastSessionLines(data())).toBeNull();
  });

  it('zeigt die letzten Einträge des letzten Abends – der jüngste zuletzt, Leeres nicht', async () => {
    const { data, first } = await played();
    const last = lastSessionLines(data())!;
    expect(last.session.id).toBe(first.id);
    expect(last.running).toBe(false);
    expect(last.entries.map((entry) => entry.kind)).toEqual([
      'note',
      'travel',
      'change',
      'promise',
      'note',
    ]);
    expect(last.entries.at(-1)!.text).toBe('Ein Schrei aus dem Nebel – dann Stille.');
    // Höchstens so viele, wie gewünscht – vom Ende her.
    expect(lastSessionLines(data(), 2)!.entries.map((entry) => entry.kind)).toEqual([
      'promise',
      'note',
    ]);
  });

  it('nimmt beim laufenden Abend den davor – und lässt Einträge anderer Abende weg', async () => {
    const { db, data, first } = await played();
    patchPrep(db, { start: 'Etwas' });
    const second = startSession(db);
    logEntry(db, { text: 'Am zweiten Abend notiert.' });
    // Das Blatt gehört jetzt zum laufenden Abend: Zuletzt aufgehört hat der erste.
    expect(prepView(data()).session?.id).toBe(second.id);
    const last = lastSessionLines(data())!;
    expect(last.session.id).toBe(first.id);
    expect(last.entries.map((entry) => entry.text)).not.toContain('Am zweiten Abend notiert.');
  });

  it('nimmt Alltägliches nicht mit', async () => {
    const { db, data } = await played();
    const market = db.put(
      'events',
      createEvent({
        title: 'Brot backen',
        at: 0,
        repeat: { every: 1, unit: 'day' },
      }),
    );
    const session = lastSessionLines(data())!.session;
    db.put(
      'chronicle',
      createChronicleEntry({
        kind: 'event',
        at: data().state.now,
        sessionId: session.id,
        text: 'Brot backen',
        eventId: market.id,
      }),
    );
    expect(lastSessionLines(data())!.entries.map((entry) => entry.text)).not.toContain(
      'Brot backen',
    );
  });

  it('hängt eine Zeile an den Einstieg an – nie darüber, nie doppelt', async () => {
    expect(appendLine('', 'Ein Schrei.')).toBe('Ein Schrei.');
    expect(appendLine('Das Boot treibt.  \n', 'Ein Schrei.')).toBe('Das Boot treibt.\nEin Schrei.');
    expect(appendLine('Das Boot treibt.\nEin Schrei.', 'Ein Schrei.')).toBe(
      'Das Boot treibt.\nEin Schrei.',
    );
    expect(appendLine('Das Boot treibt.', '   ')).toBe('Das Boot treibt.');
    // Ein Wort mitten in einem Satz ist noch keine übernommene Zeile.
    expect(hasLine('Ein Schrei – dann Stille.', 'Stille.')).toBe(false);
    expect(appendLine('Ein Schrei – dann Stille.', 'Stille.')).toBe(
      'Ein Schrei – dann Stille.\nStille.',
    );
    // Mehrzeiliges zählt als übernommen, wenn jede seiner Zeilen dasteht.
    expect(hasLine('Vorher.\n Nebel. \nRegen.', 'Nebel.\nRegen.')).toBe(true);
    expect(hasLine('Nebel.', 'Nebel.\nRegen.')).toBe(false);

    const { db, data } = await played();
    patchPrep(db, { start: 'Mitten im Nebel.' });
    addToStart(db, 'Ein Schrei aus dem Nebel – dann Stille.');
    expect(prepView(data()).content.start).toBe(
      'Mitten im Nebel.\nEin Schrei aus dem Nebel – dann Stille.',
    );
    // Auf einem Blatt, das es noch nicht gibt, beginnt der Einstieg mit der Zeile.
    for (const prep of Object.values(data().preps)) db.remove('preps', prep.id);
    addToStart(db, 'Der Steg ist eingestürzt.');
    expect(prepView(data()).content.start).toBe('Der Steg ist eingestürzt.');
  });
});

describe('Eine neue Geschichte für einen Gefährten', () => {
  it('wird angelegt, ist im Spiel und betrifft ihn – ohne erfundenen Text', async () => {
    const { db, data } = await setup();
    const mate = db.put(
      'entities',
      createEntity({ kind: 'character', name: 'Corrin', character: { goal: '' } }),
    );
    const story = newStoryForHero(db, mate.id);
    const saved = data().stories[story.id]!;
    expect(saved.inPlay).toBe(true);
    expect(saved.title).toBe('Neue Geschichte');
    expect(saved.summary).toBe('');
    expect(saved.heroes.map((hero) => hero.characterId)).toEqual([mate.id]);
    expect(storiesOfHero(data(), mate.id).map((tie) => tie.story.id)).toEqual([story.id]);
  });
});
