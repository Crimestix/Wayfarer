import { describe, expect, it } from 'vitest';
import {
  deleteSession,
  endSession,
  logEntry,
  moveParty,
  resumeSession,
  setTime,
  startSession,
} from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { recordEntry, removeRecorded } from '../../data/record';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  addToStart,
  ensurePrep,
  keepAllLeftovers,
  newStoryForHero,
  patchPrep,
  removeSecret,
  setOnSheet,
  setSceneDone,
  setSecretRevealed,
  setSkipped,
  setStartDone,
  settleLeftover,
  takeHint,
  takeStoryScene,
} from '../../features/abend/actions';
import { secretChoices } from '../../features/chronik/recordDraft';
import {
  newStory,
  patchStory,
  saveThread,
  setHintFound,
  setSceneDone as setStorySceneDone,
  tieHero,
} from '../../features/faeden/actions';
import {
  SECRETS_ENOUGH,
  allSecrets,
  appendLine,
  carriedNote,
  currentPrep,
  findPrepSecret,
  hasLine,
  lastSessionLines,
  leftoverLines,
  openScenes,
  openSecrets,
  planLines,
  prepAdvice,
  prepHasContent,
  prepNext,
  prepStand,
  prepView,
  readyEncounters,
  sceneOfText,
  secretSheets,
  secretOfText,
  sheetOf,
  stepLine,
  suggestedWhich,
  withoutLines,
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
  const scene = (text: string, done = false): PrepScene => ({ ...sceneOfText(text), done });
  const secret = (text: string, revealed = false): PrepSecret => ({
    ...secretOfText(text),
    revealed,
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
    expect(view.which).toBe('next');
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

  it('gehört zur Session, sobald sie beginnt – und was offen bleibt, wartet auf dem nächsten Blatt', async () => {
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
    });
    const session = startSession(db);
    expect(currentPrep(data())?.sessionId).toBe(session.id);
    expect(prepView(data())).toMatchObject({
      which: 'now',
      number: session.number,
      session: { id: session.id },
    });

    // Am Tisch: der Einstieg und eine Szene gespielt, ein Geheimnis aufgedeckt.
    setStartDone(db, true);
    setSceneDone(db, played.id, true);
    setSecretRevealed(db, told.id, true);
    const during = prepView(data()).content;
    expect(openScenes(during).map((entry) => entry.text)).toEqual(['Die Krähen legen an']);
    expect(openSecrets(during).map((entry) => entry.text)).toEqual(['Das Boot gehört Mira']);
    expect(during.secrets.find((entry) => entry.id === told.id)?.revealedAt).toBe(data().state.now);
    setSecretRevealed(db, told.id, false);
    expect(openSecrets(prepView(data()).content)).toHaveLength(2);
    setSecretRevealed(db, told.id, true);

    // Der Abend ist vorbei: Auf dem neuen Blatt wartet, was offen blieb – nicht der gespielte
    // Einstieg. Es steht als „übrig“ da, bis es angesehen ist.
    endSession(db);
    const next = prepView(data());
    expect(next.prep).toBeNull();
    expect(next.number).toBe(session.number + 1);
    expect(next.content.start).toBe('');
    expect(next.content.scenes.map((entry) => [entry.text, entry.carried])).toEqual([
      ['Die Krähen legen an', 1],
    ]);
    expect(leftoverLines(data(), next.content).map((line) => [line.kind, line.text])).toEqual([
      ['scene', 'Die Krähen legen an'],
      ['secret', 'Das Boot gehört Mira'],
    ]);
    // Das alte Blatt bleibt bei seiner Session.
    const fresh = ensurePrep(db);
    expect(fresh.sessionId).toBeNull();
    expect(fresh.secrets.map((entry) => entry.text)).toEqual(['Das Boot gehört Mira']);
    expect(fresh.pending).toHaveLength(2);
    expect(Object.keys(data().preps)).toHaveLength(2);
    // Ein zweites Mal kommt nichts herüber.
    expect(prepView(data()).dueFrom).toBeNull();
    patchPrep(db, { plan: 'Zur Salzgrotte.' });
    expect(prepView(data()).content.scenes).toHaveLength(1);
  });

  it('läuft ein Abend, gibt es zwei Blätter: dieses und das nächste', async () => {
    const { db, data, scene } = await setup();
    const session = startSession(db);
    expect(prepView(data())).toMatchObject({ prep: null, which: 'now', number: session.number });
    // Wer mitten im Abend auf „Dieser Abend“ schreibt, meint diesen Abend.
    patchPrep(db, { scenes: [scene('Die Krähen legen an')] });
    expect(currentPrep(data())?.sessionId).toBe(session.id);
    // Das Blatt für den nächsten lässt sich trotzdem anlegen und beschreiben.
    patchPrep(
      db,
      { start: 'Glocken läuten Sturm.', scenes: [scene('Der Zöllner flieht')] },
      'next',
    );
    const next = prepView(data(), 'next');
    expect(next).toMatchObject({ which: 'next', session: null, number: session.number + 1 });
    expect(next.prep?.sessionId).toBeNull();
    // Solange der Abend läuft, ist für das nächste Blatt noch nichts übrig.
    expect(next.content.scenes.map((entry) => entry.text)).toEqual(['Der Zöllner flieht']);
    expect(sheetOf(data(), 'now')?.scenes.map((entry) => entry.text)).toEqual([
      'Die Krähen legen an',
    ]);

    // Der nächste Abend beginnt: Das offene Blatt gehört jetzt zu ihm – mit seinem Einstieg; was
    // vom alten Abend offen blieb, kommt dazu und wartet.
    const second = startSession(db);
    const view = prepView(data());
    expect(view.prep?.sessionId).toBe(second.id);
    expect(view.content.start).toBe('Glocken läuten Sturm.');
    expect(view.content.scenes.map((entry) => entry.text)).toEqual([
      'Der Zöllner flieht',
      'Die Krähen legen an',
    ]);
    expect(leftoverLines(data(), view.content).map((line) => line.text)).toEqual([
      'Die Krähen legen an',
    ]);
  });

  it('nichts geht verloren, wenn der nächste Abend ohne offenes Blatt beginnt', async () => {
    const { db, data, scene, secret } = await setup();
    startSession(db);
    // Die Session lief weiter (sie endet nur von Hand) – geschrieben wurde auf ihr Blatt.
    const ambush = db.put('encounters', createEncounter({ name: 'Hinterhalt am Steg' }));
    const fought = db.put(
      'encounters',
      createEncounter({
        name: 'Schlägerei im Krug',
        foes: [
          {
            id: newId(),
            creatureId: newId(),
            name: 'Raufbold 1',
            hp: 3,
            note: '',
            stockId: null,
            booked: false,
          },
        ],
      }),
    );
    patchPrep(db, {
      start: 'Ein leeres Boot treibt aus dem Nebel.',
      scenes: [scene('Die Krähen legen an')],
      secrets: [secret('Das Boot gehört Mira')],
      encounterIds: [ambush.id, fought.id],
      treasure: 'Ein Kompass, der nach unten zeigt',
    });
    const second = startSession(db);
    const view = prepView(data());
    // Mit dem Beginn des Abends steht das Übrige fest auf seinem Blatt – auch ohne offenes.
    expect(view).toMatchObject({
      prep: { sessionId: second.id },
      which: 'now',
      number: second.number,
      dueFrom: null,
    });
    expect(view.content.start).toBe('Ein leeres Boot treibt aus dem Nebel.');
    expect(view.content.treasure).toBe('Ein Kompass, der nach unten zeigt');
    // Die ausgetragene Begegnung bleibt beim alten Abend.
    expect(readyEncounters(data(), view.content).map((entry) => entry.name)).toEqual([
      'Hinterhalt am Steg',
    ]);
    expect(leftoverLines(data(), view.content).map((line) => line.kind)).toEqual([
      'start',
      'scene',
      'secret',
      'encounter',
      'treasure',
    ]);
    patchPrep(db, { plan: 'Dem Boot nach.' });
    const saved = currentPrep(data())!;
    expect(saved.sessionId).toBe(second.id);
    expect(saved).toMatchObject({
      start: 'Ein leeres Boot treibt aus dem Nebel.',
      encounterIds: [ambush.id],
      treasure: 'Ein Kompass, der nach unten zeigt',
    });
  });

  it('über Übriges wird entschieden: weiter oder fallen lassen – mit Rückgängig', async () => {
    const { db, data, scene, secret } = await setup();
    const [crows, toll] = [scene('Die Krähen legen an'), scene('Der Zöllner flieht')];
    patchPrep(db, {
      start: 'Ein leeres Boot treibt aus dem Nebel.',
      scenes: [crows, toll],
      secrets: [secret('Das Boot gehört Mira')],
      treasure: 'Ein Kompass',
    });
    startSession(db);
    endSession(db);
    patchPrep(db, { treasure: 'Für Corrin: ein Brief' });
    let content = prepView(data()).content;
    // Wer die Beute selbst anfasst, hat sie angesehen.
    expect(leftoverLines(data(), content).map((line) => line.kind)).toEqual([
      'start',
      'scene',
      'scene',
      'secret',
    ]);
    settleLeftover(db, `scene:${crows.id}`, 'keep');
    const undo = settleLeftover(db, `scene:${toll.id}`, 'drop');
    settleLeftover(db, 'start', 'drop');
    content = prepView(data()).content;
    expect(content.scenes.map((entry) => entry.text)).toEqual(['Die Krähen legen an']);
    expect(content.start).toBe('');
    expect(leftoverLines(data(), content).map((line) => line.kind)).toEqual(['secret']);
    undo();
    expect(prepView(data()).content.scenes.map((entry) => entry.text)).toEqual([
      'Die Krähen legen an',
      'Der Zöllner flieht',
    ]);
    keepAllLeftovers(db);
    expect(leftoverLines(data(), prepView(data()).content)).toEqual([]);
    // Bleibt es noch einen Abend liegen, sagt das Blatt, zum wievielten Mal.
    startSession(db);
    endSession(db);
    const again = prepView(data()).content;
    expect(again.scenes.map((entry) => entry.carried)).toEqual([2, 2]);
    expect(carriedNote(2)).toBe('zum zweiten Mal dabei');
    expect(carriedNote(3)).toBe('zum dritten Mal dabei');
    expect(carriedNote(1)).toBe('');
    expect(withoutLines('Für Corrin: ein Brief\nEin Kompass', 'Ein Kompass')).toBe(
      'Für Corrin: ein Brief',
    );
  });

  it('„Rückgängig“ nimmt nur die eine Entscheidung zurück – in jeder Reihenfolge', async () => {
    const { db, data, scene, secret } = await setup();
    const [crows, toll] = [scene('Die Krähen legen an'), scene('Der Zöllner flieht')];
    const boat = secret('Das Boot gehört Mira');
    patchPrep(db, {
      start: 'Ein leeres Boot treibt aus dem Nebel.',
      scenes: [crows, toll],
      secrets: [boat],
    });
    startSession(db);
    endSession(db);
    const undoScene = settleLeftover(db, `scene:${crows.id}`, 'drop');
    const undoStart = settleLeftover(db, 'start', 'drop');
    const undoSecret = settleLeftover(db, `secret:${boat.id}`, 'drop');
    // Ein fallen gelassenes Geheimnis steht beim Festhalten nicht mehr zur Wahl – auch wenn es
    // auf dem Blatt des früheren Abends noch liegt. Der Eintrag, der es aufdeckte, behält es.
    expect(secretChoices(data())).toEqual([]);
    expect(secretChoices(data(), boat.id).map((entry) => entry.id)).toEqual([boat.id]);
    // Die älteste Entscheidung zuerst zurück: Die jüngeren bleiben, wie sie sind.
    undoScene();
    let content = prepView(data()).content;
    expect(content.scenes.map((entry) => entry.text)).toEqual([
      'Die Krähen legen an',
      'Der Zöllner flieht',
    ]);
    expect(content.start).toBe('');
    expect(content.secrets).toEqual([]);
    // Dazwischen schreibt der Spielleiter einen neuen Einstieg – er bleibt stehen.
    patchPrep(db, { start: 'Glocken läuten Sturm.' });
    undoStart();
    undoSecret();
    content = prepView(data()).content;
    expect(content.start).toBe('Glocken läuten Sturm.\nEin leeres Boot treibt aus dem Nebel.');
    expect(content.scenes.map((entry) => entry.text)).toEqual([
      'Die Krähen legen an',
      'Der Zöllner flieht',
    ]);
    expect(content.secrets.map((entry) => entry.text)).toEqual(['Das Boot gehört Mira']);
    expect(leftoverLines(data(), content).map((line) => line.kind)).toEqual([
      'start',
      'scene',
      'scene',
      'secret',
    ]);
    expect(secretChoices(data())).toEqual([{ id: boat.id, text: 'Das Boot gehört Mira' }]);
  });

  it('ein übernommenes Geheimnis zählt auf dem jüngsten Blatt – und steht nur einmal zur Wahl', async () => {
    const { db, data, secret } = await setup();
    const kept = secret('Das Boot gehört Mira');
    patchPrep(db, { secrets: [kept] });
    const first = startSession(db);
    endSession(db);
    const fresh = ensurePrep(db);
    // Dieselbe Kennung steht jetzt auf zwei Blättern.
    const old = Object.values(data().preps).find((prep) => prep.sessionId === first.id)!;
    expect(old.secrets[0]!.id).toBe(fresh.secrets[0]!.id);
    expect(findPrepSecret(data(), kept.id)?.prep.id).toBe(fresh.id);
    expect(allSecrets(data()).map((entry) => entry.id)).toEqual([kept.id]);
    expect(secretChoices(data())).toEqual([{ id: kept.id, text: 'Das Boot gehört Mira' }]);
    // „Aufgedeckt“ beim Festhalten setzt den Haken auf dem neuen Blatt.
    const reveal = recordEntry(db, { kind: 'reveal', reveal: { prepSecretId: kept.id } });
    if ('problem' in reveal) throw new Error(reveal.problem);
    expect(data().preps[fresh.id]!.secrets[0]!.revealed).toBe(true);
    expect(data().preps[old.id]!.secrets[0]!.revealed).toBe(false);
    expect(openSecrets(prepView(data()).content)).toEqual([]);
    expect(secretChoices(data())).toEqual([]);
    removeRecorded(db, reveal.entry.id);
    expect(openSecrets(prepView(data()).content)).toHaveLength(1);
  });

  it('eine fortgesetzte Session: Was dort doch noch gespielt wird, steht nicht mehr auf dem nächsten Blatt', async () => {
    const { db, data, scene, secret } = await setup();
    const crows = scene('Die Krähen legen an');
    const boat = secret('Das Boot gehört Mira');
    patchPrep(db, { scenes: [crows], secrets: [boat] });
    const first = startSession(db);
    endSession(db);
    // Das nächste Blatt ist schon angelegt – mit dem, was übrig war.
    patchPrep(db, { plan: 'Zur Salzgrotte.' });
    resumeSession(db, first.id);
    expect(prepView(data())).toMatchObject({ which: 'now', session: { id: first.id } });
    setSceneDone(db, crows.id, true);
    setSecretRevealed(db, boat.id, true);
    const next = prepView(data(), 'next').content;
    expect(openScenes(next)).toEqual([]);
    expect(openSecrets(next)).toEqual([]);
    expect(leftoverLines(data(), next)).toEqual([]);
    endSession(db);
    expect(openScenes(prepView(data()).content)).toEqual([]);
    expect(Object.keys(data().preps)).toHaveLength(2);
  });

  it('ein Abend, an dem niemand das Blatt anfasst, verliert nichts vom Abend davor', async () => {
    const { db, data, scene, secret } = await setup();
    startSession(db);
    patchPrep(db, {
      scenes: [scene('Die Krähen legen an')],
      secrets: [secret('Das Boot gehört Mira')],
    });
    // Der Abend läuft noch – vorbereitet wird schon der nächste.
    patchPrep(db, { plan: 'Zur Salzgrotte.' }, 'next');
    expect(openScenes(prepView(data(), 'next').content)).toEqual([]);
    // Der nächste Abend beginnt, wird gespielt und endet, ohne dass sein Blatt angefasst wird.
    const second = startSession(db);
    expect(currentPrep(data())).toMatchObject({ sessionId: second.id, plan: 'Zur Salzgrotte.' });
    expect(leftoverLines(data(), prepView(data()).content).map((line) => line.kind)).toEqual([
      'scene',
      'secret',
    ]);
    // Auch der Abend danach kennt noch, was zwei Abende zuvor liegen blieb – zum zweiten Mal.
    startSession(db);
    const third = prepView(data()).content;
    expect(openScenes(third).map((entry) => [entry.text, entry.carried])).toEqual([
      ['Die Krähen legen an', 2],
    ]);
    expect(openSecrets(third).map((entry) => entry.text)).toEqual(['Das Boot gehört Mira']);
    // Ohne Übriges und ohne offenes Blatt entsteht mit dem Beginn eines Abends kein Blatt.
    const empty = await setup();
    startSession(empty.db);
    startSession(empty.db);
    expect(Object.keys(empty.data().preps)).toEqual([]);
  });

  it('eine fortgesetzte Session: „Aufgedeckt“ beim Festhalten gilt auf ihrem Blatt und auf dem nächsten', async () => {
    const { db, data, secret } = await setup();
    const boat = secret('Das Boot gehört Mira');
    patchPrep(db, { secrets: [boat] });
    const first = startSession(db);
    endSession(db);
    // Das nächste Blatt trägt das Geheimnis schon – mit derselben Kennung.
    const next = ensurePrep(db);
    resumeSession(db, first.id);
    expect(secretSheets(data(), boat.id).map((entry) => entry.prep.sessionId)).toEqual([
      first.id,
      null,
    ]);
    expect(findPrepSecret(data(), boat.id)?.prep.sessionId).toBe(first.id);
    const reveal = recordEntry(db, { kind: 'reveal', reveal: { prepSecretId: boat.id } });
    if ('problem' in reveal) throw new Error(reveal.problem);
    // Am Spieltisch steht es nicht mehr offen – und auf dem nächsten Blatt auch nicht.
    expect(openSecrets(prepView(data(), 'now').content)).toEqual([]);
    expect(openSecrets(prepView(data(), 'next').content)).toEqual([]);
    expect(secretChoices(data())).toEqual([]);
    // Gelöscht wird es überall wieder ein Geheimnis – auch wenn der Abend inzwischen vorbei ist.
    endSession(db);
    removeRecorded(db, reveal.entry.id);
    expect(data().preps[next.id]!.secrets[0]!.revealed).toBe(false);
    expect(openSecrets(prepView(data()).content).map((entry) => entry.text)).toEqual([
      'Das Boot gehört Mira',
    ]);
    expect(secretChoices(data())).toEqual([{ id: boat.id, text: 'Das Boot gehört Mira' }]);
  });

  it('eine versehentlich begonnene Session löschen: Ihr Blatt ist wieder das offene', async () => {
    const { db, data } = await setup();
    patchPrep(db, { start: 'Ein leeres Boot treibt aus dem Nebel.' });
    const wrong = startSession(db);
    deleteSession(db, wrong.id);
    expect(prepView(data())).toMatchObject({
      which: 'next',
      prep: { sessionId: null },
      content: { start: 'Ein leeres Boot treibt aus dem Nebel.' },
    });
    // Ein früherer Abend nimmt sein Blatt mit – das offene bleibt, wie es ist.
    const first = startSession(db);
    endSession(db);
    patchPrep(db, { plan: 'Zur Salzgrotte.' });
    deleteSession(db, first.id);
    const preps = Object.values(data().preps);
    expect(preps.filter((prep) => prep.sessionId === null)).toHaveLength(1);
    expect(prepView(data()).content.plan).toBe('Zur Salzgrotte.');
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

  it('schlägt das Blatt vor, an dem wohl gearbeitet wird', async () => {
    const { db, data } = await setup();
    expect(suggestedWhich(data(), '2026-11-15')).toBe('next');
    startSession(db, { realDate: '2026-11-15' });
    expect(suggestedWhich(data(), '2026-11-15')).toBe('now');
    // Der Abend von gestern läuft noch (er endet nur von Hand): Vorbereitet wird der nächste.
    expect(suggestedWhich(data(), '2026-11-16')).toBe('next');
  });
});

describe('Abend und Geschichte sind eine Welt', () => {
  async function world() {
    const base = await setup();
    const { db, data } = base;
    const story = newStory(db, { title: 'Der Griff nach dem Zoll', inPlay: true });
    patchStory(db, story.id, {
      scenes: [
        {
          id: 'sz1',
          text: 'Der Zöllner zählt nachts das Geld',
          encounterId: null,
          odds: 'maybe',
          placeId: null,
        },
        { id: 'sz2', text: 'Die Krähen legen an', encounterId: null, odds: 'sure', placeId: null },
      ],
    });
    const thread = saveThread(db, {
      title: 'Wer nimmt das Zollgeld?',
      truth: 'Der Zöllner selbst.',
      state: 'open',
      storyId: story.id,
      refs: [],
      known: false,
      hints: [
        { id: 'h1', text: 'Die Kasse hat zwei Böden', placeId: null, sourceId: null, found: false },
        { id: 'h2', text: 'Lando zahlt nie', placeId: null, sourceId: null, found: false },
      ],
    });
    const storyNow = () => data().stories[story.id]!;
    const threadNow = () => data().threads[thread.id]!;
    return { ...base, story, thread, storyNow, threadNow };
  }

  it('eine Szene der Geschichte liegt auf dem Abend – abgehakt wird beides zusammen', async () => {
    const { db, data, story, storyNow } = await world();
    const undo = takeStoryScene(db, story.id, 'sz1');
    expect(undo).not.toBeNull();
    // Ein zweites Mal kommt sie nicht aufs Blatt.
    expect(takeStoryScene(db, story.id, 'sz1')).toBeNull();
    const scene = prepView(data()).content.scenes[0]!;
    expect(scene).toMatchObject({
      text: 'Der Zöllner zählt nachts das Geld',
      storyId: story.id,
      from: { storyId: story.id, sceneId: 'sz1' },
      done: false,
    });
    setSceneDone(db, scene.id, true);
    expect(storyNow().scenes.find((entry) => entry.id === 'sz1')?.done).toBe(true);
    // Umgekehrt: In der Geschichte zurückgenommen, ist sie auch auf dem Abend wieder offen.
    setStorySceneDone(db, story.id, 'sz1', false);
    expect(openScenes(prepView(data()).content)).toHaveLength(1);
    setStorySceneDone(db, story.id, 'sz1', true);
    expect(openScenes(prepView(data()).content)).toHaveLength(0);
    // Vom Blatt genommen, bleibt sie in der Geschichte.
    undo!();
    expect(prepView(data()).content.scenes).toEqual([]);
    expect(storyNow().scenes).toHaveLength(2);
  });

  it('ein Hinweis wird ein Geheimnis des Abends – aufgedeckt heißt gefunden und umgekehrt', async () => {
    const { db, data, story, thread, threadNow } = await world();
    takeHint(db, thread.id, 'h1');
    expect(takeHint(db, thread.id, 'h1')).toBeNull();
    const secret = prepView(data()).content.secrets[0]!;
    expect(secret).toMatchObject({
      text: 'Die Kasse hat zwei Böden',
      storyId: story.id,
      hint: { threadId: thread.id, hintId: 'h1' },
      revealed: false,
    });
    setSecretRevealed(db, secret.id, true);
    expect(threadNow().hints[0]!.found).toBe(true);
    expect(threadNow()).toMatchObject({ known: true, state: 'active' });
    setHintFound(db, thread.id, 'h1', false);
    expect(openSecrets(prepView(data()).content)).toHaveLength(1);
    setHintFound(db, thread.id, 'h1', true);
    expect(openSecrets(prepView(data()).content)).toHaveLength(0);
    // Ein gefundener Hinweis bleibt nicht übrig.
    startSession(db);
    endSession(db);
    expect(prepView(data()).content.secrets).toEqual([]);
    removeSecret(db, secret.id);
    expect(threadNow().hints).toHaveLength(2);
  });

  it('„Aufgedeckt“ beim Festhalten findet den Hinweis – und Löschen nimmt beides zurück', async () => {
    const { db, data, thread, threadNow } = await world();
    takeHint(db, thread.id, 'h2');
    const secret = prepView(data()).content.secrets[0]!;
    const reveal = recordEntry(db, { kind: 'reveal', reveal: { prepSecretId: secret.id } });
    if ('problem' in reveal) throw new Error(reveal.problem);
    expect(threadNow().hints[1]!.found).toBe(true);
    expect(threadNow().state).toBe('active');
    expect(openSecrets(prepView(data()).content)).toEqual([]);
    removeRecorded(db, reveal.entry.id);
    expect(threadNow().hints[1]!.found).toBe(false);
    expect(threadNow()).toMatchObject({ known: false, state: 'open' });
    expect(openSecrets(prepView(data()).content)).toHaveLength(1);
  });

  it('was übrig bleibt und aus einer Geschichte kam, kann dorthin zurück', async () => {
    const { db, data, story, thread, storyNow } = await world();
    takeStoryScene(db, story.id, 'sz2');
    takeHint(db, thread.id, 'h1');
    startSession(db);
    endSession(db);
    const lines = leftoverLines(data(), prepView(data()).content);
    expect(lines.map((line) => [line.kind, line.backTo?.id])).toEqual([
      ['scene', story.id],
      ['secret', story.id],
    ]);
    settleLeftover(db, lines[0]!.key, 'drop');
    expect(prepView(data()).content.scenes).toEqual([]);
    expect(storyNow().scenes.map((entry) => entry.id)).toEqual(['sz1', 'sz2']);
  });

  it('was am Abend bei der Geschichte abgehakt wurde, steht auf seinem Blatt als gespielt', async () => {
    const { db, data, story, thread } = await world();
    takeStoryScene(db, story.id, 'sz1');
    takeStoryScene(db, story.id, 'sz2');
    takeHint(db, thread.id, 'h1');
    const session = startSession(db);
    // Am Spieltisch stehen Szenen und Hinweise einer Geschichte im Spiel bei ihr – dort wird
    // abgehakt, nicht auf dem Blatt.
    setStorySceneDone(db, story.id, 'sz1', true);
    setHintFound(db, thread.id, 'h1', true);
    const sheet = () => Object.values(data().preps).find((prep) => prep.sessionId === session.id)!;
    expect(sheet().scenes.map((entry) => entry.done)).toEqual([false, false]);
    endSession(db);
    // Mit dem Ende des Abends hält sein Blatt fest, wie es stand – zum Nachlesen in der Chronik.
    expect(sheet().scenes.map((entry) => [entry.text, entry.done])).toEqual([
      ['Der Zöllner zählt nachts das Geld', true],
      ['Die Krähen legen an', false],
    ]);
    expect(sheet().secrets.map((entry) => entry.revealed)).toEqual([true]);
    // Was erst danach gespielt wird, zählt nicht mehr zu diesem Abend.
    setStorySceneDone(db, story.id, 'sz2', true);
    expect(sheet().scenes.map((entry) => entry.done)).toEqual([true, false]);
    expect(openScenes(prepView(data()).content)).toEqual([]);
  });

  it('was schon auf dem nächsten Blatt liegt, kommt vom letzten Abend kein zweites Mal', async () => {
    const { db, data, story, thread } = await world();
    startSession(db);
    takeStoryScene(db, story.id, 'sz2');
    takeHint(db, thread.id, 'h1');
    // Der Abend läuft noch – dieselbe Szene und derselbe Hinweis liegen schon auf dem nächsten.
    takeStoryScene(db, story.id, 'sz2', 'next');
    takeHint(db, thread.id, 'h1', 'next');
    startSession(db);
    const { content } = prepView(data());
    expect(content.scenes.map((entry) => entry.text)).toEqual(['Die Krähen legen an']);
    expect(content.secrets.map((entry) => entry.text)).toEqual(['Die Kasse hat zwei Böden']);
    expect(leftoverLines(data(), content)).toEqual([]);
  });

  it('ein Schritt der Uhr in einer Zeile – wörtlich, mit dem, woran die Gruppe es merkt', () => {
    expect(stepLine({ text: 'Der Zoll wird verdoppelt', sign: 'Händler packen ein' })).toBe(
      'Der Zoll wird verdoppelt – Händler packen ein',
    );
    expect(stepLine({ text: 'Der Zoll wird verdoppelt', sign: '' })).toBe(
      'Der Zoll wird verdoppelt',
    );
  });
});

describe('Stand und Rat', () => {
  it('führt in der Reihenfolge der Fächer – als Rat, mit „reicht“ statt Zählern', async () => {
    const { db, data, scene, secret } = await setup();
    for (const entity of Object.values(data().entities))
      if (entity.kind === 'character') db.remove('entities', entity.id);
    const stand = () => prepStand(data(), prepView(data()).content);
    const open = () =>
      prepAdvice(data(), prepView(data()).content)
        .filter((entry) => !entry.done && !entry.off)
        .map((entry) => entry.key);
    expect(open()).toEqual([
      'where',
      'party',
      'stories',
      'start',
      'scenes',
      'secrets',
      'places',
      'people',
      'encounters',
      'loot',
    ]);
    // Der nächste sinnvolle Schritt steht zuerst.
    expect(prepNext(stand())?.key).toBe('where');
    patchPrep(db, { plan: 'Die Gruppe will dem leeren Boot nach.' });
    expect(prepNext(stand())?.key).toBe('party');

    const mate = db.put(
      'entities',
      createEntity({ kind: 'character', name: 'Corrin', character: { goal: '' } }),
    );
    const party = () => stand().find((entry) => entry.key === 'party')!;
    expect(party()).toMatchObject({
      enough: false,
      note: 'Für Corrin steht noch nichts auf dem Blatt.',
    });
    // Nicht jeder braucht eine Geschichte: Es genügt, dass sein Name irgendwo auf dem Blatt steht.
    patchPrep(db, { scenes: [scene('Corrin erkennt das Siegel auf dem Boot')] });
    expect(party().enough).toBe(true);
    expect(party().note).toContain('Was Corrin will, steht noch nicht da.');
    patchPrep(db, { scenes: [] });
    const story = newStory(db, { inPlay: true });
    expect(party().enough).toBe(false);
    tieHero(db, story.id, mate.id, 'Seine Schwester ist verschwunden.');
    expect(party().enough).toBe(true);

    const ambush = db.put('encounters', createEncounter({ name: 'Hinterhalt am Steg' }));
    const place = db.put('entities', createEntity({ kind: 'place', name: 'Nebelsteg' }));
    const ferryman = db.put('entities', createEntity({ kind: 'person', name: 'Lando Furtner' }));
    patchPrep(db, {
      start: 'Ein leeres Boot treibt aus dem Nebel.',
      scenes: [scene('Eins'), scene('Zwei'), scene('Drei')],
      secrets: Array.from({ length: SECRETS_ENOUGH - 1 }, (_, i) => secret(`Geheimnis ${i + 1}`)),
      encounterIds: [ambush.id],
      treasure: 'Ein Kompass',
    });
    setOnSheet(db, 'placeIds', place.id, true);
    setOnSheet(db, 'personIds', ferryman.id, true);
    expect(open()).toEqual(['secrets']);
    const secrets = stand().find((entry) => entry.key === 'secrets')!;
    // Kein Zähler gegen ein Soll.
    expect(secrets.note).not.toMatch(/\d+ von \d+/);
    expect(secrets.note).toContain('Ein Anfang');
    // „Heute nicht nötig“ – das Fach zählt nicht mehr als offen.
    setSkipped(db, 'secrets', true);
    expect(open()).toEqual([]);
    expect(prepNext(stand())).toBeNull();
    setSkipped(db, 'secrets', false);
    expect(open()).toEqual(['secrets']);
  });

  it('zählt mit, was bei den Geschichten im Spiel bereitliegt', async () => {
    const { db, data } = await setup();
    const story = newStory(db, { title: 'Der Griff nach dem Zoll', inPlay: true });
    const ambush = db.put('encounters', createEncounter({ name: 'Hinterhalt am Steg' }));
    patchStory(db, story.id, {
      scenes: ['Eins', 'Zwei', 'Drei'].map((text, index) => ({
        id: `sz${index}`,
        text,
        encounterId: index === 0 ? ambush.id : null,
        odds: 'maybe' as const,
        placeId: null,
      })),
    });
    saveThread(db, {
      title: 'Wer nimmt das Zollgeld?',
      truth: '',
      state: 'open',
      storyId: story.id,
      refs: [],
      known: false,
      hints: ['a', 'b', 'c', 'd', 'e'].map((text) => ({
        id: text,
        text: `Hinweis ${text}`,
        placeId: null,
        sourceId: null,
        found: false,
      })),
    });
    const of = (key: string) =>
      prepStand(data(), prepView(data()).content).find((entry) => entry.key === key)!;
    // Wer von der Geschichte aus plant, hat schon vorbereitet.
    expect(of('scenes')).toMatchObject({ enough: true });
    expect(of('scenes').note).toContain('bei den Geschichten im Spiel');
    expect(of('secrets').enough).toBe(true);
    expect(of('encounters').enough).toBe(true);
    // Auf den Abend gelegt, zählt es nicht doppelt.
    takeStoryScene(db, story.id, 'sz0');
    expect(of('scenes').brief).toBe('3 Szenen');
    // Nicht im Spiel: Dann liegt es dem Abend nicht bereit.
    patchStory(db, story.id, { inPlay: false });
    expect(of('secrets').enough).toBe(false);
  });

  it('bietet an, was die Gruppe zuletzt entschieden und sich gewünscht hat – wörtlich', async () => {
    const { db, data } = await setup();
    const session = startSession(db);
    const mate = Object.values(data().entities).find((entity) => entity.kind === 'character')!;
    recordEntry(db, { kind: 'decision', text: 'Wir fahren dem Boot nach.' });
    recordEntry(db, { kind: 'note', text: 'Nur eine Notiz.' });
    recordEntry(db, {
      kind: 'wish',
      text: 'Ich will den Zöllner zur Rede stellen.',
      wish: { characterId: mate.id },
    });
    endSession(db);
    expect(planLines(data(), session.number + 1).map((entry) => entry.text)).toEqual([
      'Wir fahren dem Boot nach.',
      'Ich will den Zöllner zur Rede stellen.',
    ]);
    expect(planLines(data(), session.number)).not.toContain('Wir fahren dem Boot nach.');
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
