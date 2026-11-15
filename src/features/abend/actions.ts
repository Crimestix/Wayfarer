/**
 * Befehle rund um das Blatt eines Abends: schreiben, abhaken, etwas aus einer Geschichte auf den
 * Abend legen, über Übriges entscheiden. Das Blatt entsteht mit dem ersten Wort – und nimmt dabei
 * mit, was vom letzten Abend übrig ist (`leftOf`). Läuft ein Abend, gibt es zwei Blätter: das des
 * laufenden (`now`) und das offene für den nächsten (`next`).
 *
 * Abgehakt wird auf beiden Seiten: Eine Szene, die von einer Geschichte kam, ist dann auch dort
 * gespielt; ein Geheimnis, das ein Hinweis ist, hat die Gruppe dann auch dort gefunden.
 */
import type { CampaignDb } from '../../data/db';
import {
  appendLine,
  carriedChange,
  defaultWhich,
  hintOf,
  hintOnSheet,
  prepView,
  sceneFromStory,
  sceneOnSheet,
  secretFromHint,
  settleLeft,
  storySceneOf,
  unsettleLeft,
  type PrepContent,
  type PrepSection,
  type PrepWhich,
} from '../../domain/prep';
import {
  createPrep,
  type Prep,
  type PrepScene,
  type PrepSecret,
  type Story,
} from '../../domain/schema';
import {
  newStory,
  setHintFound,
  setSceneDone as setStorySceneDone,
  tieHero,
} from '../faeden/actions';

/** Was auf dem Blatt geschrieben werden kann. */
export type PrepChange = Partial<
  Pick<
    PrepContent,
    | 'start'
    | 'startDone'
    | 'scenes'
    | 'secrets'
    | 'encounterIds'
    | 'treasure'
    | 'plan'
    | 'placeIds'
    | 'personIds'
    | 'skipped'
    | 'pending'
    | 'namesRound'
    | 'notMeant'
  >
>;

/**
 * Das Blatt des Abends – legt es an, falls es noch keines gibt, und nimmt dabei auf, was vom
 * letzten Abend übrig ist. Läuft gerade eine Session, gehört das Blatt `now` zu ihr: Wer mitten
 * im Abend zu schreiben beginnt, meint diesen Abend; `next` ist immer das offene Blatt.
 */
export function ensurePrep(db: CampaignDb, which?: PrepWhich): Prep {
  const view = prepView(db.getSnapshot(), which);
  if (view.prep && !view.dueFrom) return view.prep;
  const { content } = view;
  if (view.prep) return db.patch('preps', view.prep.id, carriedChange(content));
  return db.put('preps', createPrep({ ...content, sessionId: view.session?.id ?? null }));
}

const unique = (ids: readonly string[]) => [...new Set(ids)];

/**
 * Schreibt auf das Blatt des Abends. Leere Szenen und Geheimnisse fallen weg; Verweise auf
 * Gelöschtes auch. Haken an Szenen und Geheimnissen mit Bezug gelten danach auch in der
 * Geschichte.
 */
export function patchPrep(db: CampaignDb, change: PrepChange, which?: PrepWhich): Prep {
  return db.batch(() => {
    const prep = ensurePrep(db, which);
    const data = db.getSnapshot();
    const exists = (id: string | null) => (id && data.entities[id] ? id : null);
    const scenes = change.scenes
      ?.filter((scene) => scene.text.trim())
      .map((scene) => ({
        ...scene,
        placeId: exists(scene.placeId),
        storyId: scene.storyId && data.stories[scene.storyId] ? scene.storyId : null,
        encounterId:
          scene.encounterId && data.encounters[scene.encounterId] ? scene.encounterId : null,
      }));
    const secrets = change.secrets
      ?.filter((secret) => secret.text.trim())
      .map((secret) => ({
        ...secret,
        storyId: secret.storyId && data.stories[secret.storyId] ? secret.storyId : null,
      }));
    const start = change.start;
    const treasure = change.treasure;
    // Wer Einstieg oder Beute selbst anfasst, hat das Herübergekommene angesehen.
    const touched = new Set([
      ...(start !== undefined && start !== prep.start ? ['start'] : []),
      ...(treasure !== undefined && treasure !== prep.treasure ? ['treasure'] : []),
    ]);
    const kept = new Set([
      ...(scenes ?? prep.scenes).map((scene) => `scene:${scene.id}`),
      ...(secrets ?? prep.secrets).map((secret) => `secret:${secret.id}`),
      ...(change.encounterIds ?? prep.encounterIds).map((id) => `encounter:${id}`),
      'start',
      'treasure',
    ]);
    const pending = (change.pending ?? prep.pending).filter(
      (key) => kept.has(key) && !touched.has(key),
    );
    const next = db.patch('preps', prep.id, {
      ...change,
      ...(scenes ? { scenes } : {}),
      ...(secrets ? { secrets } : {}),
      ...(change.encounterIds
        ? { encounterIds: unique(change.encounterIds).filter((id) => data.encounters[id]) }
        : {}),
      ...(change.placeIds
        ? {
            placeIds: unique(change.placeIds).filter((id) => data.entities[id]?.kind === 'place'),
          }
        : {}),
      ...(change.personIds
        ? { personIds: unique(change.personIds).filter((id) => data.entities[id]) }
        : {}),
      // Ein leerer Einstieg ist nicht gespielt.
      ...(start !== undefined && !start.trim() ? { startDone: false } : {}),
      pending,
    });
    // Abgehakt wird beides zusammen: hier und in der Geschichte.
    for (const scene of scenes ?? []) {
      const linked = storySceneOf(data, scene);
      if (linked && linked.done !== scene.done)
        setStorySceneDone(db, scene.from!.storyId, scene.from!.sceneId, scene.done);
    }
    for (const secret of secrets ?? []) {
      const linked = hintOf(data, secret);
      if (linked && linked.hint.found !== secret.revealed)
        setHintFound(db, linked.thread.id, linked.hint.id, secret.revealed);
    }
    return next;
  });
}

/** Das Blatt, wie es gilt – angelegt, falls es noch keines gibt. */
function sheet(db: CampaignDb, which?: PrepWhich): PrepContent {
  ensurePrep(db, which);
  return prepView(db.getSnapshot(), which).content;
}

/** Hakt eine Szene als gespielt ab – oder nimmt den Haken zurück. */
export function setSceneDone(
  db: CampaignDb,
  sceneId: string,
  done: boolean,
  which?: PrepWhich,
): void {
  db.batch(() => {
    const content = sheet(db, which);
    patchPrep(
      db,
      {
        scenes: content.scenes.map((scene) => (scene.id === sceneId ? { ...scene, done } : scene)),
      },
      which,
    );
  });
}

/** Die Gruppe hat ein Geheimnis erfahren – oder doch nicht. Gemerkt wird, wann. */
export function setSecretRevealed(
  db: CampaignDb,
  secretId: string,
  revealed: boolean,
  which?: PrepWhich,
): void {
  db.batch(() => {
    const content = sheet(db, which);
    const now = db.getSnapshot().state.now;
    patchPrep(
      db,
      {
        secrets: content.secrets.map((secret) =>
          secret.id === secretId
            ? { ...secret, revealed, revealedAt: revealed ? now : null }
            : secret,
        ),
      },
      which,
    );
  });
}

/** Der Einstieg ist gespielt – oder doch nicht. Ein gespielter Einstieg wandert nicht weiter. */
export function setStartDone(db: CampaignDb, done: boolean, which?: PrepWhich): void {
  patchPrep(db, { startDone: done }, which);
}

/**
 * Nimmt eine Zeile in den Einstieg auf – in einer neuen Zeile unter dem, was schon dasteht, nie
 * darüber. Gelesen wird der Einstieg, wie er gerade gespeichert ist.
 */
export function addToStart(db: CampaignDb, line: string, which?: PrepWhich): Prep {
  const start = prepView(db.getSnapshot(), which).content.start;
  return patchPrep(db, { start: appendLine(start, line) }, which);
}

/** Nimmt eine Zeile in „Was die Gruppe vorhat“ auf – darunter, nie darüber. */
export function addToPlan(db: CampaignDb, line: string, which?: PrepWhich): Prep {
  const plan = prepView(db.getSnapshot(), which).content.plan;
  return patchPrep(db, { plan: appendLine(plan, line) }, which);
}

/** Legt eine Szene auf den Abend. Gibt zurück, wie sie wieder herunterkommt. */
export function addScene(db: CampaignDb, scene: PrepScene, which?: PrepWhich): () => void {
  return db.batch(() => {
    const content = sheet(db, which);
    patchPrep(db, { scenes: [...content.scenes, scene] }, which);
    return () => removeScene(db, scene.id, which);
  });
}

/** Nimmt eine Szene vom Blatt – eine Szene einer Geschichte bleibt dort, wo sie herkam. */
export function removeScene(db: CampaignDb, sceneId: string, which?: PrepWhich): void {
  const content = prepView(db.getSnapshot(), which).content;
  if (content.scenes.some((scene) => scene.id === sceneId))
    patchPrep(db, { scenes: content.scenes.filter((scene) => scene.id !== sceneId) }, which);
}

/** Legt ein Geheimnis auf den Abend. Gibt zurück, wie es wieder herunterkommt. */
export function addSecret(db: CampaignDb, secret: PrepSecret, which?: PrepWhich): () => void {
  return db.batch(() => {
    const content = sheet(db, which);
    patchPrep(db, { secrets: [...content.secrets, secret] }, which);
    return () => removeSecret(db, secret.id, which);
  });
}

/** Nimmt ein Geheimnis vom Blatt – ein Hinweis einer Frage bleibt dort, wo er herkam. */
export function removeSecret(db: CampaignDb, secretId: string, which?: PrepWhich): void {
  const content = prepView(db.getSnapshot(), which).content;
  if (content.secrets.some((secret) => secret.id === secretId))
    patchPrep(db, { secrets: content.secrets.filter((secret) => secret.id !== secretId) }, which);
}

/**
 * „Auf den Abend legen“: Eine Szene der Geschichte wird eine Szene des Abends – mit ihrem
 * Wortlaut; abgehakt wird danach beides zusammen. Liegt sie schon dort, geschieht nichts.
 */
export function takeStoryScene(
  db: CampaignDb,
  storyId: string,
  sceneId: string,
  which?: PrepWhich,
): (() => void) | null {
  const data = db.getSnapshot();
  const story = data.stories[storyId];
  const scene = story?.scenes.find((entry) => entry.id === sceneId);
  if (!story || !scene?.text.trim()) return null;
  if (sceneOnSheet(prepView(data, which).content, storyId, sceneId)) return null;
  return addScene(db, sceneFromStory(story, scene), which);
}

/**
 * „Auf den Abend legen“: Ein Hinweis, den die Gruppe noch nicht hat, wird ein Geheimnis des
 * Abends – „aufgedeckt“ heißt danach „gefunden“ und umgekehrt.
 */
export function takeHint(
  db: CampaignDb,
  threadId: string,
  hintId: string,
  which?: PrepWhich,
): (() => void) | null {
  const data = db.getSnapshot();
  const thread = data.threads[threadId];
  const hint = thread?.hints.find((entry) => entry.id === hintId);
  if (!thread || !hint?.text.trim()) return null;
  if (hintOnSheet(prepView(data, which).content, threadId, hintId)) return null;
  return addSecret(db, secretFromHint(thread, hint), which);
}

/**
 * Entscheidet über etwas, das vom letzten Abend übrig ist: `keep` – es bleibt auf dem Blatt;
 * `drop` – es kommt herunter (was aus einer Geschichte kam, bleibt dort). Gibt zurück, wie sich
 * das zurücknehmen lässt.
 */
export function settleLeftover(
  db: CampaignDb,
  key: string,
  how: 'keep' | 'drop',
  which?: PrepWhich,
): () => void {
  return db.batch(() => {
    const prep = ensurePrep(db, which);
    const data = db.getSnapshot();
    const content = prepView(data, which).content;
    const before = db.getSnapshot().preps[prep.id] ?? prep;
    const sourceId = content.carriedFrom[content.carriedFrom.length - 1];
    const source = sourceId ? (data.preps[sourceId] ?? null) : null;
    const change = settleLeft(content, key, how, source);
    // Am Blatt vorbei: Die Entscheidung ist kein Anfassen von Einstieg oder Beute.
    db.patch('preps', prep.id, change);
    // Zurückgenommen wird nur diese eine Entscheidung – nicht, was danach noch geschah.
    return () => {
      const now = db.getSnapshot().preps[prep.id];
      if (now) db.patch('preps', prep.id, unsettleLeft(now, before, key));
    };
  });
}

/** Alles Übrige bleibt auf dem Blatt – angesehen ist es damit. */
export function keepAllLeftovers(db: CampaignDb, which?: PrepWhich): void {
  const prep = ensurePrep(db, which);
  db.patch('preps', prep.id, { pending: [] });
}

/** „Heute nicht nötig“: wählt ein Fach für diesen Abend ab – oder nimmt es wieder auf. */
export function setSkipped(
  db: CampaignDb,
  section: PrepSection,
  skipped: boolean,
  which?: PrepWhich,
): void {
  const content = prepView(db.getSnapshot(), which).content;
  if (content.skipped.includes(section) === skipped) return;
  patchPrep(
    db,
    {
      skipped: skipped
        ? [...content.skipped, section]
        : content.skipped.filter((entry) => entry !== section),
    },
    which,
  );
}

/** Legt einen Ort oder eine Person auf den Abend – oder nimmt sie wieder herunter. */
export function setOnSheet(
  db: CampaignDb,
  list: 'placeIds' | 'personIds',
  entityId: string,
  on: boolean,
  which?: PrepWhich,
): void {
  const ids = prepView(db.getSnapshot(), which).content[list];
  if (ids.includes(entityId) === on) return;
  patchPrep(
    db,
    { [list]: on ? [...ids, entityId] : ids.filter((id) => id !== entityId) } as PrepChange,
    which,
  );
}

/**
 * Nimmt einen Eintrag zum Blatt: ein Ort zu den Orten, eine Person, Fraktion oder Familie zu den
 * Personen. Anderes (ein Gegenstand, ein Gefährte) gehört nicht auf diese Listen.
 */
export function attachToSheet(db: CampaignDb, entityId: string, which?: PrepWhich): void {
  const entity = db.getSnapshot().entities[entityId];
  if (!entity) return;
  if (entity.kind === 'place') setOnSheet(db, 'placeIds', entityId, true, which);
  else if (['person', 'faction', 'family'].includes(entity.kind))
    setOnSheet(db, 'personIds', entityId, true, which);
}

/** Nimmt einen Eintrag wieder von den Orten und Personen des Blatts. */
export function detachFromSheet(db: CampaignDb, entityId: string, which?: PrepWhich): void {
  setOnSheet(db, 'placeIds', entityId, false, which);
  setOnSheet(db, 'personIds', entityId, false, which);
}

/** „Nicht gemeint“: Ein Name aus dem Text des Blatts soll dort nicht wieder vorgeschlagen werden. */
export function markNotMeant(db: CampaignDb, key: string, which?: PrepWhich): void {
  const content = prepView(db.getSnapshot(), which).content;
  if (!key || content.notMeant.includes(key)) return;
  patchPrep(db, { notMeant: [...content.notMeant, key] }, which);
}

/** Würfelt die „Namen für den Notfall“ neu – der neue Satz bleibt danach wieder stabil. */
export function rerollNames(db: CampaignDb, which?: PrepWhich): void {
  const content = prepView(db.getSnapshot(), which).content;
  patchPrep(db, { namesRound: content.namesRound + 1 }, which);
}

/**
 * Eine neue Geschichte für einen Gefährten: Sie betrifft ihn persönlich und ist gleich im Spiel.
 * Mehr steht nicht darin – was sie erzählt, schreibt der Spielleiter auf ihrem Blatt.
 */
export function newStoryForHero(db: CampaignDb, characterId: string): Story {
  return db.batch(() => {
    const story = newStory(db, { inPlay: true });
    tieHero(db, story.id, characterId);
    return db.getSnapshot().stories[story.id] ?? story;
  });
}

/** Welches Blatt gemeint ist, wenn keines genannt wird. */
export const whichNow = (db: CampaignDb): PrepWhich => defaultWhich(db.getSnapshot());
