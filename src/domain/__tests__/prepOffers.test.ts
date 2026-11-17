/** Was das Blatt eines Abends anbietet. Erfundene Welt: Hohenfurt und die Salzgrotte. */
import { describe, expect, it } from 'vitest';
import { advanceTime, endSession, startSession } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { recordEntry } from '../../data/record';
import { emptyCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  addScene,
  addToStart,
  patchPrep,
  setOnSheet,
  takeHint,
  takeStoryScene,
} from '../../features/abend/actions';
import {
  newStory,
  patchStory,
  runStoryClock,
  saveThread,
  setStorySteps,
} from '../../features/faeden/actions';
import { prepView, sceneOfText, secretOfText } from '../prep';
import {
  encounterOffers,
  eveningSecretsOf,
  hintsOnEvening,
  personOffers,
  personRows,
  placeOffers,
  placeRows,
  prepStoryCards,
  prepThreadCards,
  sceneOffers,
  scenesOnEvening,
  startOffers,
  storyStartOffers,
  wantToKnow,
} from '../prepOffers';
import { createEncounter, createEntity, createGuess, createPath } from '../schema';
import { MINUTES_PER_DAY } from '../time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../time/elaris';

const NOW = ELARIS_START + 10 * MINUTES_PER_DAY;

/**
 * Die Gruppe steht in Hohenfurt; die Salzgrotte liegt eine Stunde entfernt. „Der Griff nach dem
 * Zoll“ ist im Spiel: Lando Furtner treibt sie an, mit Uhr, Einstieg, Szenen und einer Frage.
 */
async function setup() {
  const db = await CampaignDb.create(
    new MemoryStore(),
    emptyCampaign('Testwelt', ELARIS_CALENDAR, NOW),
  );
  const data = () => db.getSnapshot();
  const place = (name: string) => db.put('entities', createEntity({ kind: 'place', name }));
  const town = place('Hohenfurt');
  const grotto = place('Salzgrotte');
  const castle = place('Burg Graufels');
  db.setState({ placeId: town.id });
  const ambush = db.put('encounters', createEncounter({ name: 'Hinterhalt am Steg' }));
  db.put(
    'paths',
    // Unter der Erde: Dem Weg kann das Wetter nichts anhaben.
    createPath({
      fromId: town.id,
      toId: grotto.id,
      minutes: 60,
      terrain: 'underdark',
      encounterId: ambush.id,
    }),
  );
  const person = (name: string, placeId: string | null) =>
    db.put('entities', createEntity({ kind: 'person', name, person: { placeId } } as never));
  const lando = person('Lando Furtner', town.id);
  const ilka = person('Ilka Sturmfels', grotto.id);
  const odo = person('Odo Tannhaus', castle.id);
  const mira = db.put(
    'entities',
    createEntity({ kind: 'character', name: 'Mira Tannhaus', character: { goal: '' } } as never),
  );
  const first = startSession(db);
  const story = newStory(db, { title: 'Der Griff nach dem Zoll', inPlay: true, ownerId: lando.id });
  const smugglers = db.put('encounters', createEncounter({ name: 'Schmuggler in der Grotte' }));
  patchStory(db, story.id, {
    refs: [ilka.id, grotto.id],
    roles: { [ilka.id]: { role: 'Zeugin', wants: '' } },
    entries: [
      { id: 'e1', text: 'Ein Aushang am Zollhaus', placeId: town.id, standing: 'any' },
      { id: 'e2', text: 'Lando bittet um einen Gefallen', placeId: null, standing: 'good' },
    ],
    scenes: [
      {
        id: 'sz1',
        text: 'Der Zöllner zählt nachts das Geld',
        encounterId: null,
        odds: 'maybe',
        placeId: town.id,
      },
      {
        id: 'sz2',
        text: 'In der Grotte warten Schmuggler',
        encounterId: smugglers.id,
        odds: 'sure',
        placeId: grotto.id,
      },
      {
        id: 'sz3',
        text: 'Schon gespielt',
        encounterId: null,
        odds: 'maybe',
        placeId: null,
        done: true,
      },
    ],
  });
  setStorySteps(db, story.id, [
    {
      id: 'st1',
      text: 'Der Zoll wird verdoppelt',
      days: 1,
      sign: 'Händler packen ihre Stände ein',
    },
    { id: 'st2', text: 'Die Furt wird gesperrt', days: 3, sign: '' },
  ]);
  runStoryClock(db, story.id, true);
  const thread = saveThread(db, {
    title: 'Wer nimmt das Zollgeld?',
    truth: 'Lando selbst.',
    state: 'open',
    storyId: story.id,
    refs: [],
    known: false,
    hints: [
      { id: 'h1', text: 'Die Kasse hat zwei Böden', placeId: null, sourceId: null, found: false },
      {
        id: 'h2',
        text: 'Ilka sah Lando nachts am Steg',
        placeId: null,
        sourceId: ilka.id,
        found: true,
      },
    ],
  });
  const content = () => prepView(data()).content;
  const number = () => prepView(data()).number;
  return {
    db,
    data,
    content,
    number,
    town,
    grotto,
    castle,
    lando,
    ilka,
    odo,
    mira,
    first,
    story,
    thread,
    ambush,
    smugglers,
  };
}

describe('Geschichten im Spiel auf dem Blatt des Abends', () => {
  it('zeigt je Geschichte den nächsten Schritt, Fragen, Einstiege und Szenen – und was schon auf dem Abend liegt', async () => {
    const { db, data, content, number, story, thread } = await setup();
    endSession(db);
    let [card] = prepStoryCards(data(), content(), number());
    expect(card!.story.id).toBe(story.id);
    expect(card!.clock.pace).toBe('running');
    expect(card!.next).toMatchObject({
      line: 'Der Zoll wird verdoppelt – Händler packen ihre Stände ein',
      at: NOW + MINUTES_PER_DAY,
      asSecret: false,
      inStart: false,
    });
    expect(card!.questions).toHaveLength(1);
    expect(card!.questions[0]).toMatchObject({ found: 1 });
    expect(card!.questions[0]!.open.map((entry) => [entry.hint.text, entry.onSheet])).toEqual([
      ['Die Kasse hat zwei Böden', false],
    ]);
    // Gespieltes steht nicht mehr da.
    expect(card!.scenes.map((entry) => entry.scene.id)).toEqual(['sz1', 'sz2']);
    expect(card!.scenes[1]!.encounter?.name).toBe('Schmuggler in der Grotte');
    // Der Einstieg „bei gutem Ruf“ passt nicht, solange kein Ruf feststeht – er steht hinten.
    expect(card!.entries.map((entry) => [entry.entry.id, entry.fits])).toEqual([
      ['e1', true],
      ['e2', false],
    ]);
    expect(card!.ready).toBe(3);

    takeStoryScene(db, story.id, 'sz1');
    takeHint(db, thread.id, 'h1');
    addToStart(db, 'Ein Aushang am Zollhaus');
    patchPrep(db, {
      secrets: [
        ...content().secrets,
        secretOfText('Der Zoll wird verdoppelt – Händler packen ihre Stände ein', story.id),
      ],
    });
    [card] = prepStoryCards(data(), content(), number());
    expect(card!.scenes.map((entry) => entry.onSheet)).toEqual([true, false]);
    expect(card!.questions[0]!.open[0]!.onSheet).toBe(true);
    expect(card!.entries[0]!.inStart).toBe(true);
    expect(card!.next!.asSecret).toBe(true);
    expect(card!.ready).toBe(1);
    // Auf dem Blatt der Geschichte ist zu sehen, was für den Abend bereitliegt.
    expect(hintsOnEvening(data())).toEqual(new Set([`${thread.id}:h1`]));
    expect(scenesOnEvening(data(), story.id)).toEqual(new Set(['sz1']));
    expect(eveningSecretsOf(data(), story.id).map((entry) => entry.secret.text)).toEqual([
      'Der Zoll wird verdoppelt – Händler packen ihre Stände ein',
    ]);
  });

  it('zeigt, was seit dem letzten Abend zu ihr geschah – und bietet den eingetretenen Schritt als Einstieg an', async () => {
    const { db, data, content, number, story } = await setup();
    recordEntry(db, { kind: 'note', text: 'Lando wirkt nervös.', storyId: story.id });
    endSession(db);
    advanceTime(db, NOW + MINUTES_PER_DAY + 60);
    const [card] = prepStoryCards(data(), content(), number());
    expect(card!.since.map((entry) => entry.text)).toEqual([
      'Lando wirkt nervös.',
      'Der Zoll wird verdoppelt',
    ]);
    expect(card!.next?.line).toBe('Die Furt wird gesperrt');
    const offers = startOffers(data(), content(), number());
    expect(offers).toMatchObject([
      {
        kind: 'step',
        line: 'Der Zoll wird verdoppelt – Händler packen ihre Stände ein',
        sub: 'Der Griff nach dem Zoll',
        taken: false,
      },
    ]);
    addToStart(db, offers[0]!.line);
    expect(startOffers(data(), content(), number())[0]!.taken).toBe(true);
  });

  it('bietet beim starken Einstieg die Einstiege der Geschichten im Spiel an', async () => {
    const { db, data, content } = await setup();
    const offers = storyStartOffers(data(), content());
    expect(offers.map((offer) => [offer.line, offer.fits, offer.taken])).toEqual([
      ['Ein Aushang am Zollhaus', true, false],
      ['Lando bittet um einen Gefallen', false, false],
    ]);
    expect(offers[0]!.sub).toContain('Der Griff nach dem Zoll');
    addToStart(db, offers[0]!.line);
    expect(storyStartOffers(data(), content())[0]!.taken).toBe(true);
  });

  it('nimmt lose Fäden im Spiel mit ihren offenen Hinweisen auf', async () => {
    const { db, data, content } = await setup();
    saveThread(db, {
      title: 'Wem gehört das leere Boot?',
      truth: '',
      state: 'open',
      storyId: null,
      refs: [],
      known: true,
      hints: [
        {
          id: 'l1',
          text: 'Am Bug ein fremdes Siegel',
          placeId: null,
          sourceId: null,
          found: false,
        },
      ],
    });
    expect(prepThreadCards(data(), content())).toEqual([]);
    const loose = Object.values(data().threads).find((thread) => thread.storyId === null)!;
    db.patch('threads', loose.id, { inPlay: true });
    expect(prepThreadCards(data(), content()).map((card) => card.thread.title)).toEqual([
      'Wem gehört das leere Boot?',
    ]);
  });
});

describe('Angebote für das Blatt', () => {
  it('bietet Szenen an: die der Geschichten im Spiel, Einstiege am Ort und was hier offen hängt', async () => {
    const { db, data, content, town, lando, story } = await setup();
    recordEntry(db, {
      kind: 'rumor',
      text: 'Lando soll nachts Kisten verladen.',
      refs: [lando.id],
    });
    const other = newStory(db, { title: 'Das leere Boot' });
    patchStory(db, other.id, {
      scenes: [
        {
          id: 'b1',
          text: 'Kinder spielen am Wrack',
          encounterId: null,
          odds: 'maybe',
          placeId: town.id,
        },
        { id: 'b2', text: 'Weit draußen', encounterId: null, odds: 'maybe', placeId: null },
      ],
    });
    const offers = sceneOffers(data(), content());
    expect(offers.map((offer) => offer.scene.text)).toEqual([
      'Der Zöllner zählt nachts das Geld',
      'In der Grotte warten Schmuggler',
      'Kinder spielen am Wrack',
      'Ein Aushang am Zollhaus',
      'Lando soll nachts Kisten verladen.',
    ]);
    expect(offers[0]!.scene.from).toEqual({ storyId: story.id, sceneId: 'sz1' });
    expect(offers[2]!.sub).toContain('liegt am Ort der Gruppe bereit');
    expect(offers[4]!.sub).toContain('Gerücht');
    // Was dazugenommen ist, wird nicht noch einmal angeboten.
    takeStoryScene(db, story.id, 'sz1');
    addScene(db, sceneOfText('Lando soll nachts Kisten verladen.', { placeId: town.id }));
    expect(sceneOffers(data(), content()).map((offer) => offer.scene.text)).toEqual([
      'In der Grotte warten Schmuggler',
      'Kinder spielen am Wrack',
      'Ein Aushang am Zollhaus',
    ]);
  });

  it('zeigt, was die Spieler wissen wollen: offene Vermutungen und ungeprüfte Gerüchte', async () => {
    const { db, data } = await setup();
    db.put(
      'guesses',
      createGuess({ text: 'Lando steckt mit den Schmugglern unter einer Decke', at: NOW }),
    );
    db.put('guesses', createGuess({ text: 'Längst geklärt', at: NOW, truth: 'true' }));
    recordEntry(db, { kind: 'rumor', text: 'In der Salzgrotte liegt ein Schatz.' });
    expect(wantToKnow(data()).map((entry) => [entry.kind, entry.text])).toEqual([
      ['guess', 'Lando steckt mit den Schmugglern unter einer Decke'],
      ['rumor', 'In der Salzgrotte liegt ein Schatz.'],
    ]);
  });

  it('bietet Orte an: wo die Gruppe ist, was erreichbar ist, Orte der Szenen und der Geschichten', async () => {
    const { db, data, content, town, grotto, castle } = await setup();
    patchPrep(db, { scenes: [sceneOfText('Ein Bote aus Graufels', { placeId: castle.id })] });
    expect(placeOffers(data(), content()).map((offer) => [offer.place.name, offer.why])).toEqual([
      ['Hohenfurt', 'Ort der Gruppe'],
      ['Salzgrotte', '1 Std. entfernt'],
      ['Burg Graufels', 'Ort einer Szene'],
    ]);
    setOnSheet(db, 'placeIds', grotto.id, true);
    setOnSheet(db, 'placeIds', town.id, true);
    expect(placeOffers(data(), content()).map((offer) => offer.place.name)).toEqual([
      'Burg Graufels',
    ]);
    expect(
      placeRows(data(), content()).map((row) => [row.place.name, row.here, row.unwritten]),
    ).toEqual([
      ['Salzgrotte', false, true],
      ['Hohenfurt', true, true],
    ]);
    db.patch('entities', grotto.id, { tagline: 'Feucht, salzig, voller Echos.' });
    expect(placeRows(data(), content())[0]).toMatchObject({
      line: 'Feucht, salzig, voller Echos.',
      unwritten: false,
    });
  });

  it('bietet Personen an: wer am Ort ist, wer die Geschichten trägt, wem die Gruppe etwas schuldet', async () => {
    const { db, data, content, lando, ilka, odo, mira } = await setup();
    recordEntry(db, {
      kind: 'promise',
      text: 'Odo bekommt sein Boot zurück.',
      refs: [odo.id, mira.id],
    });
    expect(personOffers(data(), content()).map((offer) => [offer.entity.name, offer.why])).toEqual([
      ['Lando Furtner', 'Der Griff nach dem Zoll · treibt sie an'],
      ['Ilka Sturmfels', 'Der Griff nach dem Zoll · Zeugin'],

      ['Odo Tannhaus', 'offene Abmachung'],
    ]);
    setOnSheet(db, 'personIds', lando.id, true);
    expect(personOffers(data(), content()).map((offer) => offer.entity.id)).toEqual([
      ilka.id,
      odo.id,
    ]);
    const [row] = personRows(data(), content());
    expect(row!.entity.id).toBe(lando.id);
    expect(row!.facts.some((fact) => fact.kind === 'where')).toBe(true);
    // Tote begegnen niemandem.
    db.patch('entities', ilka.id, {
      person: { ...(ilka as never as { person: object }).person, status: 'dead' },
    } as never);
    expect(personOffers(data(), content()).map((offer) => offer.entity.id)).toEqual([odo.id]);
  });

  it('bietet Begegnungen an: an Szenen der Geschichten im Spiel und an Wegen vom Ort', async () => {
    const { db, data, content, ambush, smugglers } = await setup();
    expect(
      encounterOffers(data(), content()).map((offer) => [offer.encounter.name, offer.why]),
    ).toEqual([
      ['Schmuggler in der Grotte', 'Szene · Der Griff nach dem Zoll'],
      ['Hinterhalt am Steg', 'am Weg nach Salzgrotte'],
    ]);
    patchPrep(db, { encounterIds: [smugglers.id] });
    expect(encounterOffers(data(), content()).map((offer) => offer.encounter.id)).toEqual([
      ambush.id,
    ]);
  });
});
