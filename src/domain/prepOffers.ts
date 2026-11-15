/**
 * Was das Blatt eines Abends anbietet: was bei den Geschichten im Spiel bereitliegt (zum
 * „Auf den Abend legen“), was sich als Einstieg aufgreifen lässt, mögliche Szenen, was die
 * Spieler wissen wollen, Orte, Personen und Begegnungen in Reichweite. Alles kommt aus dem, was
 * der Spielleiter geschrieben hat, wörtlich – Wayfarer formuliert nichts, und nichts landet ohne
 * Klick auf dem Blatt. Reine Funktionen; die Blätter selbst stehen in `domain/prep.ts`.
 */
import { SUGGESTION, withoutDismissed } from './dismiss';
import { activeParty, openPromises, placeCast, placePath } from './derive';
import { LOOSE_REASON_SHORT, looseEnds, looseEndsHere } from './looseEnds';
import { readyLoot } from './loot';
import { memoryOf, type MemoryFact } from './memory';
import { partyTravel } from './mounts';
import {
  hasLine,
  hintOnSheet,
  openScenes,
  openSecrets,
  prepView,
  sceneOnSheet,
  sceneWritten,
  secretWritten,
  stepLine,
  storiesInPlay,
  threadsInPlay,
  type PrepContent,
  type PrepWhich,
} from './prep';
import type {
  CampaignData,
  Character,
  ChronicleEntry,
  ClockStep,
  Encounter,
  Entity,
  Loot,
  Place,
  PrepScene,
  PrepSecret,
  Session,
  Story,
  StoryEntry,
  StoryScene,
  Thread,
  ThreadHint,
} from './schema';
import { stocksHere, type StockView } from './stock';
import {
  entryFit,
  heroesOf,
  storiesHere,
  storyClock,
  storyStage,
  threadLive,
  threadWarning,
  threadsOf,
  type StoryStage,
} from './story';
import { PLACE_VIA_LABEL, clockStand, storyPlaces, type ClockStand } from './storySheet';
import { isStub } from './stub';
import { formatWayTime, waysFrom } from './ways';
import { isEveryday, isNear } from './weight';

/** Der Abend vor dem mit dieser Nummer. */
const sessionBelow = (data: CampaignData, number: number): Session | null =>
  Object.values(data.sessions)
    .filter((entry) => entry.number < number)
    .sort((a, b) => b.number - a.number || b.startAt - a.startAt)[0] ?? null;

// ── Geschichten im Spiel ───────────────────────────────────────────────────

/** So viele Einträge zeigt eine Geschichte unter „Zuletzt“. */
export const STORY_SINCE = 3;

export interface CardStep {
  step: ClockStep;
  /** Wann er eintritt. */
  at: number;
  /** Der Schritt in einer Zeile, samt dem, woran die Gruppe ihn merkt. */
  line: string;
  /** Steht schon als Geheimnis auf dem Blatt. */
  asSecret: boolean;
  /** Steht schon im Einstieg. */
  inStart: boolean;
}

export interface CardQuestion {
  thread: Thread;
  /** Wie viele Hinweise die Gruppe schon hat. */
  found: number;
  /** Hinweise, die sie noch nicht hat – und ob sie schon auf dem Abend liegen. */
  open: { hint: ThreadHint; onSheet: boolean }[];
  warning: string | null;
}

export interface CardEntry {
  entry: StoryEntry;
  fits: boolean;
  note: string;
  /** Steht schon im Einstieg. */
  inStart: boolean;
}

export interface CardScene {
  scene: StoryScene;
  encounter: Encounter | null;
  onSheet: boolean;
}

/** Eine Geschichte im Spiel – mit allem, was sich davon auf den Abend legen lässt. */
export interface PrepStoryCard {
  story: Story;
  stage: StoryStage;
  /** Wie ihre Uhr steht (`clockStand`). */
  clock: ClockStand;
  /** Der nächste Schritt der Uhr – null ohne Uhr oder wenn alles geschehen ist. */
  next: CardStep | null;
  /** Was seit dem Beginn des letzten Abends zu ihr festgehalten wurde oder eingetreten ist. */
  since: ChronicleEntry[];
  questions: CardQuestion[];
  entries: CardEntry[];
  /** Szenen und Begegnungen, die noch nicht gespielt sind. */
  scenes: CardScene[];
  loot: Loot[];
  heroes: { character: Character; why: string }[];
  /** Wie viel davon sich noch auf den Abend legen ließe. */
  ready: number;
}

function questionOf(content: PrepContent, thread: Thread): CardQuestion {
  return {
    thread,
    found: thread.hints.filter((hint) => hint.found).length,
    open: thread.hints
      .filter((hint) => !hint.found && hint.text.trim())
      .map((hint) => ({ hint, onSheet: hintOnSheet(content, thread.id, hint.id) })),
    warning: threadWarning(thread),
  };
}

/**
 * Die Geschichten im Spiel als Karten für das Blatt des Abends: nächster Schritt der Uhr (mit
 * dem, woran die Gruppe ihn merkt), was zuletzt geschah, ihre Fragen mit den Hinweisen, die noch
 * fehlen, Einstiege, Szenen, Beute. `number` ist der Abend, dem das Blatt gilt.
 */
export function prepStoryCards(
  data: CampaignData,
  content: PrepContent,
  number: number,
): PrepStoryCard[] {
  const last = sessionBelow(data, number);
  return storiesInPlay(data).map((story) => {
    const { view } = storyClock(data, story);
    const step = view?.next ?? null;
    const line = step ? stepLine(step.step) : '';
    const questions = threadsOf(data, story.id)
      .filter(threadLive)
      .map((thread) => questionOf(content, thread));
    const scenes = story.scenes
      .filter((scene) => !scene.done && (scene.text.trim() || scene.encounterId))
      .map((scene) => ({
        scene,
        encounter: (scene.encounterId && data.encounters[scene.encounterId]) || null,
        onSheet: sceneOnSheet(content, story.id, scene.id),
      }));
    const entries = story.entries
      .filter((entry) => entry.text.trim())
      .map((entry) => ({
        entry,
        ...entryFit(data, story, entry),
        inStart: hasLine(content.start, entry.text),
      }))
      .sort((a, b) => Number(b.fits) - Number(a.fits));
    return {
      story,
      stage: storyStage(data, story).stage,
      clock: clockStand(data, story),
      next:
        step && line
          ? {
              step: step.step,
              at: step.at,
              line,
              asSecret: secretWritten(content, line),
              inStart: hasLine(content.start, line),
            }
          : null,
      since: last
        ? Object.values(data.chronicle)
            .filter(
              (entry) =>
                entry.at >= last.startAt &&
                entry.at <= data.state.now &&
                entry.text.trim() !== '' &&
                (entry.storyId === story.id ||
                  (story.clockId !== null && entry.clockId === story.clockId)),
            )
            .sort((a, b) => a.at - b.at || a.created.localeCompare(b.created))
            .slice(-STORY_SINCE)
        : [],
      questions,
      entries,
      scenes,
      loot: readyLoot(data, story.id),
      heroes: heroesOf(data, story).map(({ hero, character }) => ({ character, why: hero.why })),
      ready:
        scenes.filter((entry) => !entry.onSheet && entry.scene.text.trim()).length +
        questions.reduce(
          (sum, question) => sum + question.open.filter((entry) => !entry.onSheet).length,
          0,
        ),
    };
  });
}

/** Lose Fäden im Spiel – mit den Hinweisen, die die Gruppe noch nicht hat. */
export function prepThreadCards(data: CampaignData, content: PrepContent): CardQuestion[] {
  return threadsInPlay(data).map((thread) => questionOf(content, thread));
}

// ── Starker Einstieg ───────────────────────────────────────────────────────

/** So viele eben eingetretene Schritte und Termine stehen beim Einstieg zur Auswahl. */
export const START_OFFERS = 4;

export interface StartOffer {
  key: string;
  /** „Schritt“ oder „Termin“. */
  kind: 'step' | 'event';
  /** Der Wortlaut zum Übernehmen. */
  line: string;
  /** Wozu er gehört: die Geschichte oder der Ort. */
  sub: string;
  at: number;
  /** Steht schon im Einstieg. */
  taken: boolean;
}

/**
 * Was gerade eingetreten ist und sich als Einstieg aufgreifen lässt: Schritte von Uhren seit dem
 * Beginn des letzten Abends (bei Geschichten im Spiel oder am Ort der Gruppe) – mit dem, woran
 * die Gruppe sie merkt – und eingetretene Termine am Ort der Gruppe, ohne Alltag. Das Neueste
 * zuerst.
 */
export function startOffers(
  data: CampaignData,
  content: PrepContent,
  number: number,
): StartOffer[] {
  const last = sessionBelow(data, number);
  const since = last ? last.startAt : Number.NEGATIVE_INFINITY;
  const offers: StartOffer[] = [];
  for (const entry of Object.values(data.chronicle)) {
    if (entry.at < since || entry.at > data.state.now) continue;
    if (entry.clockId) {
      const clock = data.clocks[entry.clockId];
      const step = clock?.steps.find((item) => item.id === entry.stepId);
      const story = Object.values(data.stories).find((item) => item.clockId === entry.clockId);
      if (!clock || !step || step.skipped) continue;
      if (!(story?.inPlay && !story.closed) && !isNear(data, clock.placeId)) continue;
      const line = stepLine(step);
      if (!line) continue;
      offers.push({
        key: `step:${entry.id}`,
        kind: 'step',
        line,
        sub: story?.title ?? clock.title,
        at: entry.at,
        taken: hasLine(content.start, line),
      });
    } else if (entry.kind === 'event') {
      const event = entry.eventId ? data.events[entry.eventId] : undefined;
      if (event && isEveryday(data, event)) continue;
      const line = entry.text.trim();
      if (!line || !isNear(data, entry.placeId)) continue;
      offers.push({
        key: `event:${entry.id}`,
        kind: 'event',
        line,
        sub: (entry.placeId && data.entities[entry.placeId]?.name) || '',
        at: entry.at,
        taken: hasLine(content.start, line),
      });
    }
  }
  return withoutDismissed(data, offers, (offer) => SUGGESTION.prep('start', offer.key))
    .sort((a, b) => b.at - a.at || a.key.localeCompare(b.key))
    .slice(0, START_OFFERS);
}

// ── Mögliche Szenen ────────────────────────────────────────────────────────

/** Was eine angebotene Szene mitbringt – die Kennung entsteht erst beim Dazunehmen. */
export type SceneDraft = Pick<PrepScene, 'text' | 'placeId' | 'storyId' | 'encounterId' | 'from'>;

export interface SceneOffer {
  key: string;
  /** Woher das Angebot kommt – in Worten. */
  sub: string;
  scene: SceneDraft;
}

/** So viele Szenen bietet das Blatt auf einmal an. */
export const SCENE_OFFERS = 8;

/**
 * Szenen zum Dazunehmen: die der Geschichten im Spiel, was am Ort der Gruppe bereitliegt (Szenen
 * und Einstiege anderer Geschichten) und was dort offen hängt. Was schon auf dem Blatt steht,
 * wird nicht noch einmal angeboten.
 */
export function sceneOffers(data: CampaignData, content: PrepContent): SceneOffer[] {
  const offers: SceneOffer[] = [];
  const add = (key: string, sub: string, scene: SceneDraft) => {
    if (!scene.text.trim()) return;
    if (scene.from && sceneOnSheet(content, scene.from.storyId, scene.from.sceneId)) return;
    if (!scene.from && sceneWritten(content, scene.text)) return;
    if (offers.some((offer) => offer.scene.text === scene.text)) return;
    offers.push({ key, sub, scene });
  };
  const ofStory = (story: Story, scene: StoryScene, sub: string) =>
    add(`scene:${story.id}:${scene.id}`, sub, {
      text: scene.text.trim(),
      placeId: scene.placeId,
      storyId: story.id,
      encounterId: scene.encounterId,
      from: { storyId: story.id, sceneId: scene.id },
    });
  for (const story of storiesInPlay(data))
    for (const scene of story.scenes) if (!scene.done) ofStory(story, scene, story.title);
  // Was am Ort der Gruppe bereitliegt, auch aus Geschichten, die nicht im Spiel sind.
  for (const story of Object.values(data.stories)) {
    if (story.closed || story.inPlay) continue;
    for (const scene of story.scenes)
      if (!scene.done && isNear(data, scene.placeId))
        ofStory(story, scene, `${story.title} · liegt am Ort der Gruppe bereit`);
  }
  for (const here of storiesHere(data))
    for (const { entry } of here.entries)
      add(`entry:${entry.id}`, `Einstieg · ${here.card.title}`, {
        text: entry.text.trim(),
        placeId: entry.placeId,
        storyId: here.card.story?.id ?? null,
        encounterId: null,
        from: null,
      });
  for (const end of looseEndsHere(data))
    add(`loose:${end.entry.id}`, `${LOOSE_REASON_SHORT[end.reason]} · hängt hier noch offen`, {
      text: end.entry.text.trim(),
      placeId: end.placeIds[0] ?? null,
      storyId: end.entry.storyId,
      encounterId: null,
      from: null,
    });
  return withoutDismissed(data, offers, (offer) => SUGGESTION.prep('scene', offer.key)).slice(
    0,
    SCENE_OFFERS,
  );
}

// ── Geheimnisse ────────────────────────────────────────────────────────────

export interface WantToKnow {
  key: string;
  kind: 'guess' | 'rumor';
  /** In den Worten der Spieler bzw. wie das Gerücht festgehalten ist. */
  text: string;
}

/** So viele Vermutungen und Gerüchte stehen unter „Das wollen sie wissen“. */
export const WANT_TO_KNOW = 6;

/**
 * „Das wollen sie wissen“: offene Vermutungen der Spieler und Gerüchte, die noch nicht geprüft
 * sind – das Neueste zuerst. Kein Geheimnis entsteht daraus von selbst; es zeigt nur, wonach die
 * Gruppe fragt.
 */
export function wantToKnow(data: CampaignData): WantToKnow[] {
  const guesses = Object.values(data.guesses)
    .filter((guess) => guess.truth === 'open' && guess.text.trim())
    .map((guess) => ({
      key: `guess:${guess.id}`,
      kind: 'guess' as const,
      text: guess.text.trim(),
      at: guess.at,
    }));
  const rumors = looseEnds(data)
    .filter((end) => end.reason === 'rumor' && end.entry.text.trim())
    .map((end) => ({
      key: `rumor:${end.entry.id}`,
      kind: 'rumor' as const,
      text: end.entry.text.trim(),
      at: end.entry.at,
    }));
  return withoutDismissed(data, [...guesses, ...rumors], (item) =>
    SUGGESTION.prep('know', item.key),
  )
    .sort((a, b) => b.at - a.at || a.key.localeCompare(b.key))
    .slice(0, WANT_TO_KNOW)
    .map(({ key, kind, text }) => ({ key, kind, text }));
}

/**
 * Geheimnisse des Abends, die zu einer Geschichte gehören und kein Hinweis einer Frage sind –
 * auf dem Blatt der Geschichte stehen sie unter ihren Hinweisen als „für den Abend bereit“.
 */
export function eveningSecretsOf(
  data: CampaignData,
  storyId: string,
): { secret: PrepSecret; which: PrepWhich }[] {
  const out: { secret: PrepSecret; which: PrepWhich }[] = [];
  const seen = new Set<string>();
  const sheets: PrepWhich[] = data.state.sessionId ? ['now', 'next'] : ['next'];
  for (const which of sheets)
    for (const secret of openSecrets(prepView(data, which).content)) {
      if (secret.storyId !== storyId || secret.hint || seen.has(secret.id)) continue;
      seen.add(secret.id);
      out.push({ secret, which });
    }
  return out;
}

/** Die Hinweise, die gerade als Geheimnis auf einem Blatt liegen – als `Faden:Hinweis`. */
export function hintsOnEvening(data: CampaignData): Set<string> {
  const keys = new Set<string>();
  const sheets: PrepWhich[] = data.state.sessionId ? ['now', 'next'] : ['next'];
  for (const which of sheets)
    for (const secret of openSecrets(prepView(data, which).content))
      if (secret.hint) keys.add(`${secret.hint.threadId}:${secret.hint.hintId}`);
  return keys;
}

/** Die Szenen einer Geschichte, die gerade auf einem Blatt liegen. */
export function scenesOnEvening(data: CampaignData, storyId: string): Set<string> {
  const ids = new Set<string>();
  const sheets: PrepWhich[] = data.state.sessionId ? ['now', 'next'] : ['next'];
  for (const which of sheets)
    for (const scene of openScenes(prepView(data, which).content))
      if (scene.from?.storyId === storyId) ids.add(scene.from.sceneId);
  return ids;
}

// ── Orte ───────────────────────────────────────────────────────────────────

/** So viele Orte und Personen bietet das Blatt auf einmal an. */
export const PLACE_OFFERS = 10;
export const PERSON_OFFERS = 8;

export interface PlaceOffer {
  place: Place;
  /** Warum er naheliegt: „Ort der Gruppe“, „2 Std. entfernt“, „Szene“ … */
  why: string;
}

/**
 * Orte, die der Abend brauchen kann: wo die Gruppe ist, was über Wege erreichbar ist (mit Dauer),
 * die Orte der Szenen auf dem Blatt und die der Geschichten im Spiel samt ihren Wegenetzen. Was
 * schon auf dem Blatt liegt, wird nicht angeboten.
 */
export function placeOffers(data: CampaignData, content: PrepContent): PlaceOffer[] {
  const taken = new Set(content.placeIds);
  const offers = new Map<string, PlaceOffer>();
  const add = (id: string | null | undefined, why: string) => {
    const place = id ? data.entities[id] : undefined;
    if (place?.kind !== 'place' || taken.has(place.id) || offers.has(place.id)) return;
    offers.set(place.id, { place, why });
  };
  const party = data.state.placeId;
  add(party, 'Ort der Gruppe');
  if (party)
    for (const way of waysFrom(data, party, partyTravel(data))) {
      if (way.barred) continue;
      add(
        way.toId,
        way.minutes === null
          ? 'über einen Weg erreichbar'
          : `${formatWayTime(way.minutes)} entfernt`,
      );
    }
  for (const scene of openScenes(content)) add(scene.placeId, 'Ort einer Szene');
  for (const story of storiesInPlay(data))
    for (const row of storyPlaces(data, story))
      add(
        row.place.id,
        `${story.title} · ${row.via.map((via) => PLACE_VIA_LABEL[via]).join(', ')}`,
      );
  return withoutDismissed(data, [...offers.values()], (offer) =>
    SUGGESTION.prep('place', offer.place.id),
  ).slice(0, PLACE_OFFERS);
}

export interface PlaceRow {
  place: Place;
  /** Sein Satz für den Tisch – leer, wenn keiner dasteht. */
  line: string;
  /** Wo er liegt. */
  path: string;
  /** Die Gruppe ist gerade dort. */
  here: boolean;
  /** Noch ohne Text: ein Platzhalter oder ein Eintrag ohne Satz. */
  unwritten: boolean;
}

/** Die Orte auf dem Blatt – je mit ihrer Kurzzeile. */
export function placeRows(data: CampaignData, content: PrepContent): PlaceRow[] {
  return content.placeIds
    .map((id) => data.entities[id])
    .filter((entity): entity is Place => entity?.kind === 'place')
    .map((place) => ({
      place,
      line: place.tagline.trim(),
      path: placePath(data, place.id),
      here: isNear(data, place.id),
      unwritten: isStub(data, place) || (!place.tagline.trim() && !place.notes.trim() && !place.lk),
    }));
}

// ── Personen ───────────────────────────────────────────────────────────────

export interface PersonOffer {
  entity: Entity;
  why: string;
}

/**
 * Wer dem Abend begegnen kann: wer die Geschichten im Spiel antreibt und an ihnen beteiligt ist,
 * wem die Gruppe noch etwas schuldet (offene Abmachungen) und wer am Ort der Gruppe und an den
 * Orten der Szenen ist – in dieser Reihenfolge. Nur Personen und Gruppen von Personen.
 */
export function personOffers(data: CampaignData, content: PrepContent): PersonOffer[] {
  const taken = new Set(content.personIds);
  const offers = new Map<string, PersonOffer>();
  const add = (id: string | null | undefined, why: string) => {
    const entity = id ? data.entities[id] : undefined;
    if (!entity || !['person', 'faction', 'family'].includes(entity.kind)) return;
    if (entity.kind === 'person' && ['dead', 'missing'].includes(entity.person.status)) return;
    if (taken.has(entity.id) || offers.has(entity.id)) return;
    offers.set(entity.id, { entity, why });
  };
  // Wer die Geschichten trägt, zuerst – dann, wem die Gruppe etwas schuldet, dann wer einfach da ist.
  for (const story of storiesInPlay(data)) {
    add(story.ownerId, `${story.title} · treibt sie an`);
    for (const id of story.refs) {
      const role = story.roles[id]?.role.trim();
      add(id, role ? `${story.title} · ${role}` : story.title);
    }
  }
  for (const entry of openPromises(data)) for (const id of entry.refs) add(id, 'offene Abmachung');
  const party = data.state.placeId;
  if (party)
    for (const person of placeCast(data, party).present) add(person.id, 'am Ort der Gruppe');
  for (const scene of openScenes(content)) {
    const place = scene.placeId ? data.entities[scene.placeId] : undefined;
    if (!place || isNear(data, place.id)) continue;
    for (const person of placeCast(data, place.id).present)
      add(person.id, `in ${place.name} – Ort einer Szene`);
  }
  const mates = new Set(activeParty(data).map((character) => character.id));
  return withoutDismissed(data, [...offers.values()], (offer) =>
    SUGGESTION.prep('person', offer.entity.id),
  )
    .filter((offer) => !mates.has(offer.entity.id))
    .slice(0, PERSON_OFFERS);
}

export interface PersonRow {
  entity: Entity;
  /** Haltung, wo, zuletzt – höchstens drei Angaben (`memoryOf`). */
  facts: MemoryFact[];
  /** Noch ohne Text: ein Platzhalter. */
  unwritten: boolean;
}

/** Die Personen auf dem Blatt – je mit dem Wichtigsten für den Tisch. */
export function personRows(data: CampaignData, content: PrepContent): PersonRow[] {
  return content.personIds
    .map((id) => data.entities[id])
    .filter((entity): entity is Entity => !!entity)
    .map((entity) => ({
      entity,
      facts: memoryOf(data, entity.id),
      unwritten: isStub(data, entity),
    }));
}

// ── Begegnungen ────────────────────────────────────────────────────────────

export interface EncounterOffer {
  encounter: Encounter;
  why: string;
}

/**
 * Begegnungen, die naheliegen: an Szenen der Geschichten im Spiel und des Abends, an Wegen vom
 * Ort der Gruppe und am Ort selbst. Was schon bereitliegt, wird nicht angeboten.
 */
export function encounterOffers(data: CampaignData, content: PrepContent): EncounterOffer[] {
  const taken = new Set(content.encounterIds);
  const offers = new Map<string, EncounterOffer>();
  const add = (id: string | null | undefined, why: string) => {
    const encounter = id ? data.encounters[id] : undefined;
    if (!encounter || taken.has(encounter.id) || offers.has(encounter.id)) return;
    offers.set(encounter.id, { encounter, why });
  };
  for (const scene of openScenes(content)) add(scene.encounterId, 'an einer Szene des Abends');
  for (const story of storiesInPlay(data))
    for (const scene of story.scenes)
      if (!scene.done) add(scene.encounterId, `Szene · ${story.title}`);
  const party = data.state.placeId;
  if (party)
    for (const way of waysFrom(data, party, partyTravel(data))) {
      const to = data.entities[way.toId];
      add(way.path.encounterId, to ? `am Weg nach ${to.name}` : 'an einem Weg von hier');
    }
  for (const encounter of Object.values(data.encounters))
    if (isNear(data, encounter.placeId)) add(encounter.id, 'am Ort der Gruppe');
  return withoutDismissed(data, [...offers.values()], (offer) =>
    SUGGESTION.prep('encounter', offer.encounter.id),
  );
}

/** Baue und Horte dort, wo die Gruppe ist – aus ihnen lässt sich im Bestiarium eine Begegnung stellen. */
export const stocksNear = (data: CampaignData): StockView[] => stocksHere(data);
