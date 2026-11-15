/**
 * Einen Abend vorbereiten: wo die Gruppe steht, ein starker Einstieg, mögliche Szenen,
 * Geheimnisse, die sie erfahren könnte, Orte, Personen, bereitgelegte Begegnungen, Beute. Je
 * Abend ein Blatt (`preps/`): Das offene Blatt (`sessionId: null`) gilt dem kommenden Abend;
 * beginnt eine Session, gehört es zu ihr. Läuft ein Abend, gibt es zwei Blätter – das des
 * laufenden und das des nächsten.
 *
 * Abend und Geschichte sind eine Welt: Eine Szene oder ein Hinweis einer Geschichte lässt sich
 * auf den Abend legen (`from`, `hint`) – abgehakt wird dann beides zusammen (`resolveContent`).
 * Was am Abend nicht gespielt und nicht aufgedeckt wurde, kommt auf das nächste Blatt und steht
 * dort als „vom letzten Abend übrig“, bis der Spielleiter es angesehen hat (`pending`).
 *
 * Geschrieben wird alles vom Spielleiter – Wayfarer trägt nur weiter und sagt, was noch leer
 * ist. Reine Funktionen.
 */
import { recordHeadline } from './chronicleKinds';
import { activeParty, currentSession, sessionsSorted } from './derive';
import { spotlightHint } from './heroArc';
import { readyLoot } from './loot';
import { namesInText } from './memory';
import { storiesOfHero, threadLive, threadsOf } from './story';
import { isEveryday } from './weight';
import { newId } from './schema';
import type {
  CampaignData,
  Character,
  ChronicleEntry,
  ClockStep,
  Encounter,
  Prep,
  PrepScene,
  PrepSecret,
  Session,
  Story,
  StoryScene,
  Thread,
  ThreadHint,
} from './schema';

/** Ab so vielen Geheimnissen reicht der Vorrat für einen Abend – die Hälfte fällt meist ohnehin. */
export const SECRETS_ENOUGH = 5;
/** So viele mögliche Szenen tragen einen Abend. */
export const SCENES_ENOUGH = 3;

/** Welches Blatt: das des laufenden Abends oder das offene für den nächsten. */
export type PrepWhich = 'now' | 'next';

/** Was auf einem Blatt steht – auch auf einem, das es noch nicht gibt. */
export type PrepContent = Pick<
  Prep,
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
  | 'carriedFrom'
  | 'namesRound'
  | 'notMeant'
>;

/** Ein leeres Blatt. */
export const EMPTY_PREP: PrepContent = {
  start: '',
  startDone: false,
  scenes: [],
  secrets: [],
  encounterIds: [],
  treasure: '',
  plan: '',
  placeIds: [],
  personIds: [],
  skipped: [],
  pending: [],
  carriedFrom: [],
  namesRound: 0,
  notMeant: [],
};

export interface PrepView {
  /** Welches Blatt das ist – ohne laufenden Abend immer das nächste. */
  which: PrepWhich;
  /** Das Blatt, wie es gespeichert ist – null, solange noch nichts geschrieben wurde. */
  prep: Prep | null;
  /**
   * Was auf dem Blatt steht – Haken, wie sie gelten (`resolveContent`), und dazu, was vom letzten
   * Abend übrig ist, solange das Blatt es noch nicht übernommen hat.
   */
  content: PrepContent;
  /** Die laufende Session, zu der das Blatt gehört – null = der kommende Abend. */
  session: Session | null;
  /** Die Session, die gerade läuft – gleich, welches Blatt gezeigt wird. */
  running: Session | null;
  /** Die Nummer des Abends, dem das Blatt gilt. */
  number: number;
  /** Das Blatt des letzten Abends, dessen Übriges noch nicht übernommen ist – sonst null. */
  dueFrom: Prep | null;
}

// ── Welches Blatt ──────────────────────────────────────────────────────────

const sessionNumber = (data: Pick<CampaignData, 'sessions'>, prep: Prep): number =>
  prep.sessionId ? (data.sessions[prep.sessionId]?.number ?? 0) : Number.MAX_SAFE_INTEGER;

/** Die Blätter, das jüngste zuerst: das offene, dann nach der Nummer ihres Abends. */
export function prepsNewestFirst(data: Pick<CampaignData, 'preps' | 'sessions'>): Prep[] {
  return Object.values(data.preps).sort(
    (a, b) => sessionNumber(data, b) - sessionNumber(data, a) || b.created.localeCompare(a.created),
  );
}

/** Ohne laufenden Abend gibt es nur das nächste Blatt. */
export const defaultWhich = (data: CampaignData): PrepWhich =>
  currentSession(data) ? 'now' : 'next';

/** Das gespeicherte Blatt des laufenden Abends (`now`) oder das offene für den nächsten (`next`). */
export function sheetOf(data: CampaignData, which: PrepWhich): Prep | null {
  const preps = prepsNewestFirst(data);
  if (which === 'next') return preps.find((prep) => prep.sessionId === null) ?? null;
  const session = currentSession(data);
  return session ? (preps.find((prep) => prep.sessionId === session.id) ?? null) : null;
}

/** Das Blatt des laufenden Abends – ohne laufenden Abend das offene für den kommenden. */
export function currentPrep(data: CampaignData): Prep | null {
  return sheetOf(data, defaultWhich(data));
}

/** Das Blatt eines bestimmten Abends – zum Nachlesen. */
export function prepOfSession(data: CampaignData, sessionId: string): Prep | null {
  return prepsNewestFirst(data).find((prep) => prep.sessionId === sessionId) ?? null;
}

/**
 * Welches Blatt die Seite zuerst zeigt: Läuft ein Abend, der an einem früheren Tag begonnen hat
 * (er endet nur von Hand), bereitet der Spielleiter fast immer schon den nächsten vor.
 */
export function suggestedWhich(data: CampaignData, today: string): PrepWhich {
  const session = currentSession(data);
  if (!session) return 'next';
  return session.realDate !== '' && session.realDate < today ? 'next' : 'now';
}

// ── Abend und Geschichte ───────────────────────────────────────────────────

type LinkData = Pick<CampaignData, 'stories' | 'threads'>;

/** Die Szene der Geschichte, die hinter einer Szene des Abends steht – wenn es sie noch gibt. */
export function storySceneOf(
  data: Pick<CampaignData, 'stories'>,
  scene: Pick<PrepScene, 'from'>,
): StoryScene | null {
  if (!scene.from) return null;
  const story = data.stories[scene.from.storyId];
  return story?.scenes.find((entry) => entry.id === scene.from!.sceneId) ?? null;
}

/** Der Hinweis, der hinter einem Geheimnis des Abends steht – wenn es ihn noch gibt. */
export function hintOf(
  data: Pick<CampaignData, 'threads'>,
  secret: Pick<PrepSecret, 'hint'>,
): { thread: Thread; hint: ThreadHint } | null {
  if (!secret.hint) return null;
  const thread = data.threads[secret.hint.threadId];
  const hint = thread?.hints.find((entry) => entry.id === secret.hint!.hintId);
  return thread && hint ? { thread, hint } : null;
}

/**
 * Das Blatt mit den Haken, wie sie gelten: Eine Szene, die von einer Geschichte kam, ist
 * gespielt, wenn sie dort gespielt ist; ein Geheimnis, das ein Hinweis ist, ist aufgedeckt, wenn
 * die Gruppe den Hinweis hat – und umgekehrt. Was auf dem Blatt, von dem etwas herüberkam,
 * inzwischen doch gespielt wurde (eine fortgesetzte Session), gilt auch hier als gespielt. Was
 * erledigt ist, wartet nicht mehr darauf, angesehen zu werden.
 */
export function resolveContent<T extends PrepContent>(
  data: LinkData & Pick<CampaignData, 'preps'>,
  content: T,
): T {
  const sources = content.carriedFrom
    .map((id) => data.preps[id])
    .filter((prep): prep is Prep => !!prep);
  const playedBefore = (id: string) =>
    sources.some((prep) => prep.scenes.some((scene) => scene.id === id && scene.done));
  const toldBefore = (id: string) =>
    sources.some((prep) => prep.secrets.some((secret) => secret.id === id && secret.revealed));
  const scenes = content.scenes.map((scene) => {
    const linked = storySceneOf(data, scene);
    const done = linked ? linked.done : scene.done || (scene.carried > 0 && playedBefore(scene.id));
    return done === scene.done ? scene : { ...scene, done };
  });
  const secrets = content.secrets.map((secret) => {
    const linked = hintOf(data, secret);
    const revealed = linked
      ? linked.hint.found
      : secret.revealed || (secret.carried > 0 && toldBefore(secret.id));
    return revealed === secret.revealed
      ? secret
      : { ...secret, revealed, revealedAt: revealed ? secret.revealedAt : null };
  });
  const open = new Set([
    ...scenes.filter((scene) => !scene.done).map((scene) => `scene:${scene.id}`),
    ...secrets.filter((secret) => !secret.revealed).map((secret) => `secret:${secret.id}`),
    ...content.encounterIds.map((id) => `encounter:${id}`),
    ...(content.start.trim() && !content.startDone ? ['start'] : []),
    ...(content.treasure.trim() ? ['treasure'] : []),
  ]);
  const pending = content.pending.filter((key) => open.has(key));
  const same = <V>(a: readonly V[], b: readonly V[]) =>
    a.length === b.length && a.every((item, index) => item === b[index]);
  if (
    same(scenes, content.scenes) &&
    same(secrets, content.secrets) &&
    same(pending, content.pending)
  )
    return content;
  return { ...content, scenes, secrets, pending };
}

/** Liegt diese Szene einer Geschichte schon auf dem Blatt? */
export const sceneOnSheet = (
  content: Pick<PrepContent, 'scenes'>,
  storyId: string,
  sceneId: string,
): boolean =>
  content.scenes.some((scene) => scene.from?.storyId === storyId && scene.from.sceneId === sceneId);

/** Liegt dieser Hinweis schon als Geheimnis auf dem Blatt? */
export const hintOnSheet = (
  content: Pick<PrepContent, 'secrets'>,
  threadId: string,
  hintId: string,
): boolean =>
  content.secrets.some(
    (secret) => secret.hint?.threadId === threadId && secret.hint.hintId === hintId,
  );

/** Eine Szene der Geschichte als Szene des Abends – mit ihrem Wortlaut, Ort und ihrer Begegnung. */
export function sceneFromStory(story: Pick<Story, 'id'>, scene: StoryScene): PrepScene {
  return {
    id: newId(),
    text: scene.text.trim(),
    done: scene.done,
    placeId: scene.placeId,
    storyId: story.id,
    encounterId: scene.encounterId,
    from: { storyId: story.id, sceneId: scene.id },
    carried: 0,
  };
}

/** Ein Hinweis einer Frage als Geheimnis des Abends – mit seinem Wortlaut. */
export function secretFromHint(
  thread: Pick<Thread, 'id' | 'storyId'>,
  hint: ThreadHint,
): PrepSecret {
  return {
    id: newId(),
    text: hint.text.trim(),
    storyId: thread.storyId,
    revealed: hint.found,
    revealedAt: null,
    hint: { threadId: thread.id, hintId: hint.id },
    carried: 0,
  };
}

/** Ein Schritt der Uhr in einer Zeile: was eintritt – und woran die Gruppe es merkt. */
export function stepLine(step: Pick<ClockStep, 'text' | 'sign'>): string {
  const [text, sign] = [step.text.trim(), step.sign.trim()];
  return text && sign ? `${text} – ${sign}` : text || sign;
}

/** Ein Wortlaut als neues Geheimnis des Abends – etwa der nächste Schritt einer Uhr. */
export function secretOfText(text: string, storyId: string | null = null): PrepSecret {
  return {
    id: newId(),
    text: text.trim(),
    storyId,
    revealed: false,
    revealedAt: null,
    hint: null,
    carried: 0,
  };
}

/** Ein Wortlaut als neue Szene des Abends. */
export function sceneOfText(
  text: string,
  init: Partial<Pick<PrepScene, 'placeId' | 'storyId' | 'encounterId'>> = {},
): PrepScene {
  return {
    id: newId(),
    text: text.trim(),
    done: false,
    placeId: null,
    storyId: null,
    encounterId: null,
    from: null,
    carried: 0,
    ...init,
  };
}

/** Steht dieser Wortlaut schon als Geheimnis auf dem Blatt? */
export const secretWritten = (content: Pick<PrepContent, 'secrets'>, text: string): boolean =>
  content.secrets.some((secret) => secret.text.trim() === text.trim());

/** Steht dieser Wortlaut schon als Szene auf dem Blatt? */
export const sceneWritten = (content: Pick<PrepContent, 'scenes'>, text: string): boolean =>
  content.scenes.some((scene) => scene.text.trim() === text.trim());

// ── Vom letzten Abend übrig ────────────────────────────────────────────────

/** Wurde eine Begegnung ausgetragen? Sobald ein Exemplar Trefferpunkte verloren hat. */
export const encounterFought = (encounter: Pick<Encounter, 'foes'>): boolean =>
  encounter.foes.some((foe) => foe.hp !== null);

/**
 * Das Blatt, von dem etwas herüberkommt: das des jüngsten früheren Abends. Solange ein Abend
 * läuft, ist für das nächste Blatt noch nichts übrig – erst, wenn er vorbei ist.
 */
export function carrySource(data: CampaignData, which: PrepWhich): Prep | null {
  const running = currentSession(data);
  if (which === 'next' && running) return null;
  const limit = which === 'now' && running ? running.number : Number.MAX_SAFE_INTEGER;
  return (
    prepsNewestFirst(data).find(
      (prep) =>
        prep.sessionId !== null &&
        prep.sessionId !== running?.id &&
        data.sessions[prep.sessionId] !== undefined &&
        sessionNumber(data, prep) < limit,
    ) ?? null
  );
}

/** Was von einem Blatt übrig ist. */
export interface Leftover {
  scenes: PrepScene[];
  secrets: PrepSecret[];
  start: string;
  treasure: string;
  encounterIds: string[];
}

/**
 * Was von einem Abend übrig ist: Szenen, die nicht gespielt, und Geheimnisse, die nicht
 * aufgedeckt wurden; der Einstieg, wenn er nicht gespielt ist; Begegnungen, die nicht ausgetragen
 * wurden; die Gedanken zur Beute. Nichts geht verloren – und nichts wandert ungesehen mit: Auf
 * dem nächsten Blatt wartet es, bis der Spielleiter es angesehen hat.
 */
export function leftOf(data: CampaignData, source: Prep): Leftover {
  const own = resolveContent(data, source);
  return {
    scenes: own.scenes
      .filter((scene) => !scene.done && scene.text.trim())
      .map((scene) => ({ ...scene, carried: scene.carried + 1 })),
    secrets: own.secrets
      .filter((secret) => !secret.revealed && secret.text.trim())
      .map((secret) => ({ ...secret, carried: secret.carried + 1 })),
    start: source.startDone ? '' : source.start.trim(),
    treasure: source.treasure.trim(),
    encounterIds: source.encounterIds.filter((id) => {
      const encounter = data.encounters[id];
      return encounter !== undefined && !encounterFought(encounter);
    }),
  };
}

/**
 * Legt Übriges auf ein Blatt – ohne etwas zu überschreiben: Ein geschriebener Einstieg bleibt,
 * Gedanken zur Beute kommen darunter, und was schon auf dem Blatt liegt, kommt kein zweites Mal.
 * Alles Herübergekommene wartet darauf, angesehen zu werden (`pending`).
 */
export function mergeLeft<T extends PrepContent>(content: T, left: Leftover, sourceId: string): T {
  const sceneIds = new Set(content.scenes.map((scene) => scene.id));
  const secretIds = new Set(content.secrets.map((secret) => secret.id));
  const scenes = left.scenes.filter((scene) => !sceneIds.has(scene.id));
  const secrets = left.secrets.filter((secret) => !secretIds.has(secret.id));
  const encounterIds = left.encounterIds.filter((id) => !content.encounterIds.includes(id));
  const start = !content.start.trim() && left.start !== '';
  const treasure = left.treasure !== '' && !hasLine(content.treasure, left.treasure);
  return {
    ...content,
    scenes: [...content.scenes, ...scenes],
    secrets: [...content.secrets, ...secrets],
    encounterIds: [...content.encounterIds, ...encounterIds],
    start: start ? left.start : content.start,
    startDone: start ? false : content.startDone,
    treasure: treasure ? appendLine(content.treasure, left.treasure) : content.treasure,
    pending: [
      ...new Set([
        ...content.pending,
        ...(start ? ['start'] : []),
        ...scenes.map((scene) => `scene:${scene.id}`),
        ...secrets.map((secret) => `secret:${secret.id}`),
        ...encounterIds.map((id) => `encounter:${id}`),
        ...(treasure ? ['treasure'] : []),
      ]),
    ],
    carriedFrom: [...content.carriedFrom.filter((id) => id !== sourceId), sourceId],
  };
}

/**
 * Was vom letzten Abend übrig ist – für ein Blatt, das es noch nicht gibt (wie es mit dem ersten
 * Wort entstünde).
 */
export function carryOver(data: CampaignData, which: PrepWhich = defaultWhich(data)): PrepContent {
  const source = carrySource(data, which);
  return source ? mergeLeft(EMPTY_PREP, leftOf(data, source), source.id) : EMPTY_PREP;
}

/** Das Blatt eines Abends zum Anzeigen – auch bevor das erste Wort darauf steht. */
export function prepView(data: CampaignData, asked?: PrepWhich): PrepView {
  const running = currentSession(data) ?? null;
  const which: PrepWhich = running ? (asked ?? 'now') : 'next';
  const prep = sheetOf(data, which);
  const highest = Math.max(0, ...sessionsSorted(data).map((entry) => entry.number));
  const source = carrySource(data, which);
  const due = source !== null && !(prep?.carriedFrom.includes(source.id) ?? false);
  const own = resolveContent(data, prep ?? EMPTY_PREP);
  return {
    which,
    prep,
    content: due ? resolveContent(data, mergeLeft(own, leftOf(data, source), source.id)) : own,
    session: which === 'now' ? running : null,
    running,
    number: which === 'now' && running ? running.number : highest + 1,
    dueFrom: due ? source : null,
  };
}

export type LeftoverKind = 'start' | 'scene' | 'secret' | 'encounter' | 'treasure';

export const LEFTOVER_LABEL: Record<LeftoverKind, string> = {
  start: 'Einstieg',
  scene: 'Szene',
  secret: 'Geheimnis',
  encounter: 'Begegnung',
  treasure: 'Beute',
};

export interface LeftoverLine {
  /** `scene:<id>`, `secret:<id>`, `encounter:<id>`, `start`, `treasure`. */
  key: string;
  kind: LeftoverKind;
  /** Der Wortlaut – bei einer Begegnung ihr Name. */
  text: string;
  /** Von wie vielen Abenden es schon übrig geblieben ist. */
  times: number;
  /** Die Geschichte, aus der es kam – dorthin kann es zurück. */
  backTo: Story | null;
}

/** „zum dritten Mal dabei“ – leer, wenn etwas zum ersten Mal übrig ist. */
export function carriedNote(times: number): string {
  if (times < 2) return '';
  const words = ['', '', 'zweiten', 'dritten', 'vierten', 'fünften'];
  return `zum ${words[times] ?? `${times}.`} Mal dabei`;
}

/**
 * „Vom letzten Abend übrig“: was herübergekommen ist und noch nicht angesehen wurde – je Zeile
 * mit „weiter“, „fallen lassen“ oder „zurück zur Geschichte“ zu entscheiden.
 */
export function leftoverLines(data: CampaignData, content: PrepContent): LeftoverLine[] {
  const lines: LeftoverLine[] = [];
  for (const key of content.pending) {
    const [sort, id] = key.split(':');
    if (key === 'start') {
      if (content.start.trim())
        lines.push({ key, kind: 'start', text: content.start.trim(), times: 1, backTo: null });
    } else if (key === 'treasure') {
      if (content.treasure.trim())
        lines.push({
          key,
          kind: 'treasure',
          text: content.treasure.trim(),
          times: 1,
          backTo: null,
        });
    } else if (sort === 'scene') {
      const scene = content.scenes.find((entry) => entry.id === id);
      if (!scene) continue;
      const story = storySceneOf(data, scene) ? data.stories[scene.from!.storyId] : undefined;
      lines.push({
        key,
        kind: 'scene',
        text: scene.text.trim(),
        times: scene.carried,
        backTo: story ?? null,
      });
    } else if (sort === 'secret') {
      const secret = content.secrets.find((entry) => entry.id === id);
      if (!secret) continue;
      const linked = hintOf(data, secret);
      const story = linked?.thread.storyId ? data.stories[linked.thread.storyId] : undefined;
      lines.push({
        key,
        kind: 'secret',
        text: secret.text.trim(),
        times: secret.carried,
        backTo: story ?? null,
      });
    } else if (sort === 'encounter') {
      const encounter = id ? data.encounters[id] : undefined;
      if (encounter)
        lines.push({ key, kind: 'encounter', text: encounter.name, times: 1, backTo: null });
    }
  }
  const order: LeftoverKind[] = ['start', 'scene', 'secret', 'encounter', 'treasure'];
  return lines.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

/** Nimmt die Zeilen eines Textes aus einem anderen heraus – was sonst dasteht, bleibt. */
export function withoutLines(text: string, lines: string): string {
  const drop = new Set(
    lines
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter(Boolean),
  );
  return text
    .split(/\r?\n/)
    .filter((row) => !drop.has(row.trim()))
    .join('\n')
    .trim();
}

/**
 * Entscheidet über etwas Übriges: `keep` – es bleibt auf dem Blatt; `drop` – es kommt vom Blatt
 * (eine Szene oder ein Hinweis einer Geschichte bleibt dort, wo er herkam). `source` ist das
 * Blatt, von dem es kam: Dessen Zeilen kommen aus Einstieg und Beute wieder heraus.
 */
export function settleLeft(
  content: PrepContent,
  key: string,
  how: 'keep' | 'drop',
  source: Pick<Prep, 'start' | 'treasure'> | null = null,
): Partial<PrepContent> {
  const pending = content.pending.filter((entry) => entry !== key);
  if (how === 'keep') return { pending };
  const [sort, id] = key.split(':');
  if (key === 'start')
    return { pending, start: source ? withoutLines(content.start, source.start) : '' };
  if (key === 'treasure')
    return { pending, treasure: source ? withoutLines(content.treasure, source.treasure) : '' };
  if (sort === 'scene')
    return { pending, scenes: content.scenes.filter((scene) => scene.id !== id) };
  if (sort === 'secret')
    return { pending, secrets: content.secrets.filter((secret) => secret.id !== id) };
  if (sort === 'encounter')
    return { pending, encounterIds: content.encounterIds.filter((entry) => entry !== id) };
  return { pending };
}

/** Das Geheimnis mit dieser Kennung – auf dem jüngsten Blatt, das es trägt. */
export function findPrepSecret(
  data: Pick<CampaignData, 'preps' | 'sessions'>,
  secretId: string,
): { prep: Prep; secret: PrepSecret } | null {
  for (const prep of prepsNewestFirst(data)) {
    const secret = prep.secrets.find((entry) => entry.id === secretId);
    if (secret) return { prep, secret };
  }
  return null;
}

/**
 * Die Geheimnisse aller Blätter, jedes einmal: Was auf ein späteres Blatt herüberkam, zählt
 * dort – das jüngste Blatt zuerst, mit den Haken, wie sie gelten.
 */
export function allSecrets(data: CampaignData): PrepSecret[] {
  const seen = new Set<string>();
  const out: PrepSecret[] = [];
  for (const prep of prepsNewestFirst(data))
    for (const secret of resolveContent(data, prep).secrets) {
      if (seen.has(secret.id)) continue;
      seen.add(secret.id);
      out.push(secret);
    }
  return out;
}

// ── Wo es zuletzt aufhörte ────────────────────────────────────────────────

/** So viele Zeilen vom Ende des letzten Abends stehen beim Einstieg zur Auswahl. */
export const LAST_LINES = 5;

export interface LastSessionLines {
  /** Der letzte Abend vor dem, dem das Blatt gilt. */
  session: Session;
  /** Läuft dieser Abend noch? (Das Blatt gilt dann schon dem danach.) */
  running: boolean;
  /** Die letzten Einträge der Chronik aus diesem Abend – der jüngste zuletzt. */
  entries: ChronicleEntry[];
}

/** Trägt ein Eintrag etwas, das sich als Einstieg aufgreifen lässt? Alltag und Leeres nicht. */
function worthTelling(data: CampaignData, entry: ChronicleEntry): boolean {
  if (entry.kind === 'travel') return !!entry.travel;
  if (entry.kind === 'attitude') return !!entry.attitude;
  if (entry.kind === 'event') {
    const event = entry.eventId ? data.events[entry.eventId] : undefined;
    if (event && isEveryday(data, event)) return false;
  }
  return entry.text.trim() !== '' || recordHeadline(data, entry) !== '';
}

/** Der Abend vor dem mit dieser Nummer. */
const sessionBelow = (data: CampaignData, number: number): Session | null =>
  Object.values(data.sessions)
    .filter((entry) => entry.number < number)
    .sort((a, b) => b.number - a.number || b.startAt - a.startAt)[0] ?? null;

/**
 * Wo es zuletzt aufhörte: die letzten Einträge der Chronik aus dem Abend vor dem, dem das Blatt
 * gilt – Notizen, Veränderungen, Ortswechsel, Abmachungen, so wie sie dort stehen. Gehört das
 * Blatt zur laufenden Session, ist es die davor; gilt es dem kommenden Abend, die letzte bisher.
 * null, wenn es noch keinen früheren Abend gibt. Wayfarer formuliert nichts um – es zeigt nur,
 * was in der Chronik steht.
 */
export function lastSessionLines(
  data: CampaignData,
  limit: number = LAST_LINES,
  number: number = prepView(data).number,
): LastSessionLines | null {
  const session = sessionBelow(data, number);
  if (!session) return null;
  const entries = Object.values(data.chronicle)
    .filter((entry) => entry.sessionId === session.id && worthTelling(data, entry))
    .sort((a, b) => a.at - b.at || a.created.localeCompare(b.created));
  return {
    session,
    running: data.state.sessionId === session.id,
    entries: limit > 0 ? entries.slice(-limit) : [],
  };
}

/** So viele Zeilen stehen bei „Was die Gruppe vorhat“ zur Auswahl. */
export const PLAN_LINES = 4;

/**
 * Was die Gruppe zuletzt entschieden und sich gewünscht hat: die letzten Einträge der Arten
 * „Entscheidung“ und „Wunsch“ aus dem Abend vor diesem Blatt – der jüngste zuletzt, zum
 * wörtlichen Übernehmen.
 */
export function planLines(
  data: CampaignData,
  number: number,
  limit: number = PLAN_LINES,
): ChronicleEntry[] {
  const session = sessionBelow(data, number);
  if (!session) return [];
  return Object.values(data.chronicle)
    .filter(
      (entry) =>
        entry.sessionId === session.id &&
        (entry.kind === 'decision' || entry.kind === 'wish') &&
        entry.text.trim() !== '',
    )
    .sort((a, b) => a.at - b.at || a.created.localeCompare(b.created))
    .slice(-Math.max(0, limit));
}

/**
 * Hängt eine Zeile an einen Text an – in einer neuen Zeile, nie über das Geschriebene. Steht sie
 * schon darin, bleibt der Text, wie er ist.
 */
export function appendLine(text: string, line: string): string {
  const add = line.trim();
  if (!add) return text;
  if (hasLine(text, add)) return text;
  const before = text.trimEnd();
  return before ? `${before}\n${add}` : add;
}

/**
 * Steht diese Zeile schon im Text – als eigene Zeile (bei mehrzeiligen: jede ihrer Zeilen)?
 * Ein kurzes Wort mitten in einem Satz zählt nicht, sonst ließe sich „Stille.“ nicht übernehmen,
 * sobald irgendwo „… dann Stille.“ steht.
 */
export function hasLine(text: string, line: string): boolean {
  const present = new Set(text.split(/\r?\n/).map((row) => row.trim()));
  const wanted = line
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);
  return wanted.length > 0 && wanted.every((row) => present.has(row));
}

/** Szenen, die noch nicht gespielt sind. */
export const openScenes = (content: Pick<PrepContent, 'scenes'>): PrepScene[] =>
  content.scenes.filter((scene) => !scene.done && scene.text.trim());

/** Geheimnisse, die die Gruppe noch nicht kennt. */
export const openSecrets = (content: Pick<PrepContent, 'secrets'>): PrepSecret[] =>
  content.secrets.filter((secret) => !secret.revealed && secret.text.trim());

/** Die bereitgelegten Begegnungen, soweit es sie noch gibt. */
export const readyEncounters = (
  data: Pick<CampaignData, 'encounters'>,
  content: Pick<PrepContent, 'encounterIds'>,
): Encounter[] =>
  content.encounterIds
    .map((id) => data.encounters[id])
    .filter((encounter): encounter is Encounter => !!encounter);

/** Steht auf dem Blatt irgendetwas, das am Tisch zu sehen sein sollte? */
export function prepHasContent(data: CampaignData, content: PrepContent): boolean {
  return (
    content.start.trim() !== '' ||
    content.treasure.trim() !== '' ||
    openScenes(content).length > 0 ||
    openSecrets(content).length > 0 ||
    readyEncounters(data, content).length > 0
  );
}

// ── Stand und Rat ──────────────────────────────────────────────────────────

/** Die Fächer des Blatts, von oben nach unten – in dieser Reihenfolge führt auch der Rat. */
export const PREP_SECTIONS = [
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
] as const;
export type PrepSection = (typeof PREP_SECTIONS)[number];

export const PREP_SECTION_TITLE: Record<PrepSection, string> = {
  where: 'Wo wir stehen',
  party: 'Die Gefährten',
  stories: 'Geschichten im Spiel',
  start: 'Starker Einstieg',
  scenes: 'Mögliche Szenen',
  secrets: 'Geheimnisse und Hinweise',
  places: 'Orte',
  people: 'Personen',
  encounters: 'Begegnungen',
  loot: 'Beute',
};

/** Die Leitfrage jedes Fachs – sie beschreibt die Form, nie einen Inhalt. */
export const PREP_SECTION_QUESTION: Record<PrepSection, string> = {
  where: 'Wo hat es aufgehört – und was hat die Gruppe als Nächstes vor?',
  party: 'Was will jeder – und steht für jeden irgendwo auf dem Blatt etwas?',
  stories: 'Was ist an diesem Abend wichtig – und was davon legst du dir bereit?',
  start: 'Was passiert in den ersten Minuten, das eine Reaktion verlangt?',
  scenes:
    'Was könnte geschehen? Wenige kurze Sätze je Szene – ein Angebot, bereit, verworfen zu werden.',
  secrets:
    'Was könnte die Gruppe erfahren? Ein Vorrat, noch an keinen Fundort gebunden – wo sie es findet, entscheidet sich am Tisch.',
  places: 'Wohin kann es die Gruppe an diesem Abend führen?',
  people: 'Wem kann sie begegnen – und welche Namen brauchst du zur Hand?',
  encounters: 'Was liegt bereit, falls es zum Kampf kommt?',
  loot: 'Was kann der Abend bringen – am besten etwas für einen bestimmten Gefährten?',
};

export interface PrepStand {
  key: PrepSection;
  title: string;
  /** Die Leitfrage zur Form. */
  question: string;
  /** Für einen Abend reicht, was dasteht. */
  enough: boolean;
  /** „Heute nicht nötig“ – das Fach zählt nicht als offen. */
  skipped: boolean;
  /** Was dasteht oder noch fehlt – ein ruhiger Satz, nie ein Zähler gegen ein Soll. */
  note: string;
  /** Eine kurze Angabe für das eingeklappte Fach: „3 Szenen“. */
  brief: string;
}

/** Gefährten, bei denen noch nicht steht, was sie wollen. */
export const withoutGoal = (data: CampaignData): Character[] =>
  activeParty(data).filter((character) => !character.character.goal.trim());

/** Gefährten, die keine Geschichte im Spiel persönlich betrifft. */
export const withoutHook = (data: CampaignData): Character[] =>
  activeParty(data).filter(
    (character) => !storiesOfHero(data, character.id).some((tie) => tie.story.inPlay),
  );

/** Alles, was auf dem Blatt geschrieben steht. */
export function prepTexts(
  content: Pick<PrepContent, 'plan' | 'start' | 'scenes' | 'secrets' | 'treasure'>,
): string[] {
  return [
    content.plan,
    content.start,
    ...content.scenes.map((scene) => scene.text),
    ...content.secrets.map((secret) => secret.text),
    content.treasure,
  ].filter((text) => text.trim());
}

/**
 * Für wen noch nichts auf dem Blatt steht: Ein Gefährte ist bedacht, wenn ihn eine Geschichte im
 * Spiel persönlich betrifft, wenn sein Name irgendwo auf dem Blatt steht oder wenn Beute für ihn
 * bereitliegt. Nicht jeder braucht eine eigene Geschichte.
 */
export function partyUncovered(data: CampaignData, content: PrepContent): Character[] {
  const named = new Set(prepTexts(content).flatMap((text) => namesInText(data, text)));
  const gifted = new Set(readyLoot(data).map((loot) => loot.toId));
  const unhooked = new Set(withoutHook(data).map((character) => character.id));
  return activeParty(data).filter(
    (character) =>
      unhooked.has(character.id) && !named.has(character.id) && !gifted.has(character.id),
  );
}

/** Die offenen Geschichten im Spiel, nach ihrem Namen. */
export const storiesInPlay = (data: Pick<CampaignData, 'stories'>): Story[] =>
  Object.values(data.stories)
    .filter((story) => story.inPlay && !story.closed)
    .sort((a, b) => a.title.localeCompare(b.title, 'de') || a.id.localeCompare(b.id));

/** Lose Fäden, die der Spielleiter ins Spiel genommen hat. */
export const threadsInPlay = (data: Pick<CampaignData, 'threads' | 'stories'>): Thread[] =>
  Object.values(data.threads)
    .filter(
      (thread) =>
        thread.inPlay &&
        threadLive(thread) &&
        (thread.storyId === null || !data.stories[thread.storyId]),
    )
    .sort((a, b) => a.title.localeCompare(b.title, 'de') || a.id.localeCompare(b.id));

/**
 * Was bei den Geschichten im Spiel bereitliegt und noch nicht auf dem Blatt steht: Szenen, die
 * nicht gespielt sind, Hinweise, die die Gruppe noch nicht hat, Begegnungen an diesen Szenen.
 * Wer von der Geschichte aus plant, hat damit schon vorbereitet – der Rat zählt es mit.
 */
export function readyAtStories(
  data: CampaignData,
  content: PrepContent,
): { scenes: number; hints: number; encounters: number } {
  let scenes = 0;
  let hints = 0;
  const encounters = new Set<string>();
  const openHints = (thread: Thread) =>
    thread.hints.filter(
      (hint) => !hint.found && hint.text.trim() && !hintOnSheet(content, thread.id, hint.id),
    ).length;
  for (const story of storiesInPlay(data)) {
    for (const scene of story.scenes) {
      if (scene.done || !(scene.text.trim() || scene.encounterId)) continue;
      if (!sceneOnSheet(content, story.id, scene.id)) scenes++;
      if (scene.encounterId && data.encounters[scene.encounterId])
        encounters.add(scene.encounterId);
    }
    for (const thread of threadsOf(data, story.id).filter(threadLive)) hints += openHints(thread);
  }
  for (const thread of threadsInPlay(data)) hints += openHints(thread);
  for (const id of content.encounterIds) encounters.delete(id);
  return { scenes, hints, encounters: encounters.size };
}

const names = (list: readonly { name: string }[]) => list.map((entry) => entry.name).join(', ');
const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
const firstLine = (text: string) => text.trim().split(/\r?\n/)[0] ?? '';

/**
 * Wie jedes Fach steht – in der Reihenfolge des Blatts. „Reicht“ heißt: Für einen Abend genügt,
 * was dasteht; gezählt wird auch, was bei den Geschichten im Spiel bereitliegt. Nie ein Soll,
 * nie ein Zähler dagegen – und jedes Fach lässt sich abwählen („heute nicht nötig“).
 */
export function prepStand(data: CampaignData, content: PrepContent): PrepStand[] {
  const party = activeParty(data);
  const uncovered = partyUncovered(data, content);
  const aimless = withoutGoal(data);
  const playing = storiesInPlay(data).length + threadsInPlay(data).length;
  const atStories = readyAtStories(data, content);
  const own = {
    scenes: openScenes(content).length,
    secrets: openSecrets(content).length,
    encounters: readyEncounters(data, content).length,
  };
  const scenes = own.scenes + atStories.scenes;
  const secrets = own.secrets + atStories.hints;
  const encounters = own.encounters + atStories.encounters;
  const places = content.placeIds.filter((id) => data.entities[id]).length;
  const people = content.personIds.filter((id) => data.entities[id]).length;
  const loot = readyLoot(data).length;
  /** Wer an den letzten Abenden selten vorkam – ein ruhiger Satz, nie eine Wertung. */
  const quiet = spotlightHint(data);
  /** Was davon bei den Geschichten im Spiel liegt statt auf dem Blatt. */
  const there = (ownCount: number, atStory: number, one: string, many: string) =>
    atStory === 0
      ? ''
      : ownCount === 0
        ? ` ${atStory === 1 ? `${one} liegt` : `${many} liegen`} bei den Geschichten im Spiel.`
        : ` ${atStory === 1 ? `${one} davon liegt` : `${atStory} davon liegen`} bei den Geschichten im Spiel.`;
  const stand: Omit<PrepStand, 'title' | 'question' | 'skipped'>[] = [
    {
      key: 'where',
      enough: content.plan.trim() !== '',
      note: content.plan.trim()
        ? 'Steht da.'
        : 'Ein Satz genügt: Was hat die Gruppe als Nächstes vor?',
      brief: firstLine(content.plan),
    },
    {
      key: 'party',
      enough: party.length > 0 && uncovered.length === 0,
      note:
        party.length === 0
          ? 'Noch kein Gefährte eingetragen.'
          : uncovered.length
            ? `Für ${names(uncovered)} steht noch nichts auf dem Blatt.`
            : [
                'Für jeden steht etwas auf dem Blatt.',
                aimless.length ? `Was ${names(aimless)} will, steht noch nicht da.` : '',
                quiet ?? '',
              ]
                .filter(Boolean)
                .join(' '),
      brief: party.length ? count(party.length, 'Gefährte', 'Gefährten') : '',
    },
    {
      key: 'stories',
      enough: playing > 0,
      note:
        playing > 0
          ? 'Was im Spiel ist, steht am Spieltisch in der Mitte.'
          : 'Noch nichts im Spiel. Nimm herein, was an diesem Abend wichtig ist.',
      brief: playing ? `${playing} im Spiel` : '',
    },
    {
      key: 'start',
      enough: content.start.trim() !== '',
      note: content.start.trim() ? 'Steht da.' : 'Etwas passiert – mitten hinein.',
      brief: firstLine(content.start),
    },
    {
      key: 'scenes',
      enough: scenes >= SCENES_ENOUGH,
      note:
        (scenes === 0
          ? 'Noch keine. Etwa eine je Dreiviertelstunde trägt einen Abend.'
          : scenes < SCENES_ENOUGH
            ? 'Ein Anfang – drei oder vier tragen einen Abend.'
            : 'Reicht für einen Abend.') + there(own.scenes, atStories.scenes, 'Eine', 'Sie'),
      brief: scenes ? count(scenes, 'Szene', 'Szenen') : '',
    },
    {
      key: 'secrets',
      enough: secrets >= SECRETS_ENOUGH,
      note:
        (secrets === 0
          ? 'Noch keins. Ein Vorrat, aus dem du am Tisch schöpfst.'
          : secrets < SECRETS_ENOUGH
            ? 'Ein Anfang – ein Vorrat von fünf bis zehn trägt einen Abend; die Hälfte fällt meist.'
            : 'Reicht für einen Abend – mehr als zehn brauchst du nie.') +
        there(own.secrets, atStories.hints, 'Ein Hinweis', 'Die Hinweise'),
      brief: secrets ? count(secrets, 'Geheimnis', 'Geheimnisse') : '',
    },
    {
      key: 'places',
      enough: places > 0,
      note: places
        ? 'Liegen bereit.'
        : 'Noch keiner. Verweise genügen – nichts muss abgeschrieben werden.',
      brief: places ? count(places, 'Ort', 'Orte') : '',
    },
    {
      key: 'people',
      enough: people > 0,
      note: people
        ? 'Liegen bereit.'
        : 'Noch niemand. Namen lassen sich am Tisch schlecht erfinden.',
      brief: people ? count(people, 'Person', 'Personen') : '',
    },
    {
      key: 'encounters',
      enough: encounters > 0,
      note:
        (encounters
          ? 'Liegt bereit – am Tisch nur noch öffnen.'
          : 'Noch keine. Zusammengestellt wird im Bestiarium.') +
        (own.encounters === 0 && atStories.encounters > 0
          ? ' Sie hängt an einer Szene einer Geschichte im Spiel.'
          : ''),
      brief: encounters ? count(encounters, 'Begegnung', 'Begegnungen') : '',
    },
    {
      key: 'loot',
      enough: content.treasure.trim() !== '' || loot > 0,
      note:
        content.treasure.trim() !== '' || loot > 0
          ? 'Liegt bereit.'
          : 'Noch nichts. Am besten etwas, das zu einem bestimmten Gefährten passt.',
      brief: loot ? `${loot}× Beute` : firstLine(content.treasure),
    },
  ];
  return stand.map((entry) => ({
    ...entry,
    title: PREP_SECTION_TITLE[entry.key],
    question: PREP_SECTION_QUESTION[entry.key],
    skipped: content.skipped.includes(entry.key),
  }));
}

/** Der nächste sinnvolle Schritt: das erste Fach, das noch nicht reicht und nicht abgewählt ist. */
export function prepNext(stand: readonly PrepStand[]): PrepStand | null {
  return stand.find((entry) => !entry.enough && !entry.skipped) ?? null;
}

export interface PrepAdvice {
  key: PrepSection;
  done: boolean;
  /** Abgewählt („heute nicht nötig“). */
  off: boolean;
  text: string;
  why: string;
}

/**
 * Was ein Abend braucht – als Rat, nie als Pflicht, in der Reihenfolge der Fächer: wo die Gruppe
 * steht, die Gefährten, Geschichten im Spiel, ein Einstieg, ein paar mögliche Szenen, ein Vorrat
 * an Geheimnissen, Orte, Personen, eine Begegnung, Beute.
 */
export function prepAdvice(
  data: CampaignData,
  content: PrepContent,
  stand: readonly PrepStand[] = prepStand(data, content),
): PrepAdvice[] {
  return stand.map((entry) => ({
    key: entry.key,
    done: entry.enough,
    off: entry.skipped,
    text: entry.title,
    why: entry.note,
  }));
}
