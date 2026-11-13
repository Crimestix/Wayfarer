/**
 * Einen Abend vorbereiten: ein starker Einstieg, mögliche Szenen, Geheimnisse, die die Gruppe
 * erfahren könnte, bereitgelegte Begegnungen, Beute. Je Abend ein Blatt (`preps/`): Das offene
 * Blatt gilt dem kommenden Abend; beginnt eine Session, gehört es zu ihr. Was am Abend nicht
 * gespielt und nicht aufgedeckt wurde, wandert von selbst auf das nächste Blatt.
 *
 * Geschrieben wird alles vom Spielleiter – Wayfarer trägt nur weiter, zählt und sagt, was noch
 * leer ist. Reine Funktionen.
 */
import { recordHeadline } from './chronicleKinds';
import { activeParty, currentSession, sessionsSorted } from './derive';
import { readyLoot } from './loot';
import { storiesOfHero } from './story';
import { isEveryday } from './weight';
import type {
  CampaignData,
  Character,
  ChronicleEntry,
  Encounter,
  Prep,
  PrepScene,
  PrepSecret,
  Session,
} from './schema';

/** So viele Geheimnisse sind ein guter Vorrat für einen Abend. */
export const SECRETS_WANTED = 10;
/** So viele mögliche Szenen tragen einen Abend. */
export const SCENES_WANTED = 3;

/** Was auf einem Blatt steht – auch auf einem, das es noch nicht gibt. */
export type PrepContent = Pick<Prep, 'start' | 'scenes' | 'secrets' | 'encounterIds' | 'treasure'>;

export interface PrepView {
  /** Das Blatt, wie es gespeichert ist – null, solange noch nichts geschrieben wurde. */
  prep: Prep | null;
  /** Was auf dem Blatt steht; ohne gespeichertes Blatt das, was vom letzten Abend übrig ist. */
  content: PrepContent;
  /** Die laufende Session, zu der das Blatt gehört – null = der kommende Abend. */
  session: Session | null;
  /** Die Nummer des Abends, dem das Blatt gilt. */
  number: number;
  /** Wie viel vom letzten Abend herübergekommen ist (auf einem frischen Blatt). */
  carried: { scenes: number; secrets: number };
}

const EMPTY: PrepContent = { start: '', scenes: [], secrets: [], encounterIds: [], treasure: '' };

/** Das Blatt des laufenden Abends – sonst das offene für den kommenden. */
export function currentPrep(data: CampaignData): Prep | null {
  const preps = Object.values(data.preps);
  const session = currentSession(data);
  if (session) {
    const own = preps.find((prep) => prep.sessionId === session.id);
    if (own) return own;
  }
  return preps.find((prep) => prep.sessionId === null) ?? null;
}

/**
 * Was vom letzten Abend übrig ist: Szenen, die nicht gespielt, und Geheimnisse, die nicht
 * aufgedeckt wurden. Begegnungen, Einstieg und Beute gehören dem Abend, für den sie gedacht
 * waren, und bleiben dort.
 */
export function carryOver(data: CampaignData): PrepContent {
  const number = (prep: Prep) =>
    prep.sessionId ? (data.sessions[prep.sessionId]?.number ?? 0) : 0;
  const last = Object.values(data.preps)
    .filter((prep) => prep.sessionId !== null)
    .sort((a, b) => number(b) - number(a) || b.created.localeCompare(a.created))[0];
  if (!last) return EMPTY;
  return {
    ...EMPTY,
    scenes: last.scenes.filter((scene) => !scene.done),
    secrets: last.secrets.filter((secret) => !secret.revealed),
  };
}

/** Das Blatt des Abends zum Anzeigen – auch bevor das erste Wort darauf steht. */
export function prepView(data: CampaignData): PrepView {
  const prep = currentPrep(data);
  const session = currentSession(data);
  const mine = session && prep?.sessionId === session.id ? session : null;
  const highest = Math.max(0, ...sessionsSorted(data).map((entry) => entry.number));
  // Läuft eine Session ohne eigenes Blatt, gilt das offene Blatt schon dem Abend danach.
  const number = mine ? mine.number : highest + 1;
  if (prep)
    return { prep, content: prep, session: mine, number, carried: { scenes: 0, secrets: 0 } };
  const content = carryOver(data);
  return {
    prep: null,
    content,
    // Läuft ein Abend ohne Blatt, gilt das erste Wort ihm.
    session,
    number: session ? session.number : number,
    carried: { scenes: content.scenes.length, secrets: content.secrets.length },
  };
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
): LastSessionLines | null {
  const { number } = prepView(data);
  const session = Object.values(data.sessions)
    .filter((entry) => entry.number < number)
    .sort((a, b) => b.number - a.number || b.startAt - a.startAt)[0];
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
export const openScenes = (content: PrepContent): PrepScene[] =>
  content.scenes.filter((scene) => !scene.done && scene.text.trim());

/** Geheimnisse, die die Gruppe noch nicht kennt. */
export const openSecrets = (content: PrepContent): PrepSecret[] =>
  content.secrets.filter((secret) => !secret.revealed && secret.text.trim());

/** Die bereitgelegten Begegnungen, soweit es sie noch gibt. */
export const readyEncounters = (data: CampaignData, content: PrepContent): Encounter[] =>
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

export interface PrepAdvice {
  key: string;
  done: boolean;
  text: string;
  why: string;
}

/** Gefährten, bei denen noch nicht steht, was sie wollen. */
export const withoutGoal = (data: CampaignData): Character[] =>
  activeParty(data).filter((character) => !character.character.goal.trim());

/** Gefährten, die keine Geschichte im Spiel persönlich betrifft. */
export const withoutHook = (data: CampaignData): Character[] =>
  activeParty(data).filter(
    (character) => !storiesOfHero(data, character.id).some((tie) => tie.story.inPlay),
  );

/**
 * Was ein Abend braucht – als Rat, nie als Pflicht: was die Gefährten wollen, ein Einstieg,
 * Geschichten im Spiel, ein paar mögliche Szenen, ein Vorrat an Geheimnissen, eine Begegnung,
 * Beute.
 */
export function prepAdvice(data: CampaignData, content: PrepContent): PrepAdvice[] {
  const party = activeParty(data);
  const aimless = withoutGoal(data);
  const inPlay = Object.values(data.stories).filter((story) => story.inPlay && !story.closed);
  const unhooked = withoutHook(data);
  const scenes = openScenes(content).length;
  const secrets = openSecrets(content).length;
  return [
    {
      key: 'goals',
      done: party.length > 0 && aimless.length === 0,
      text: 'Was die Gefährten wollen',
      why:
        party.length === 0
          ? 'Noch kein Gefährte eingetragen.'
          : aimless.length
            ? `Fehlt bei ${aimless.map((character) => character.name).join(', ')}.`
            : 'Bei jedem steht, was ihn in den Abend zieht.',
    },
    {
      key: 'hooks',
      done: party.length > 0 && unhooked.length === 0,
      text: 'Für jeden Gefährten ist etwas dabei',
      why:
        party.length === 0
          ? 'Noch kein Gefährte eingetragen.'
          : unhooked.length
            ? `Keine Geschichte im Spiel betrifft ${unhooked.map((character) => character.name).join(', ')}.`
            : 'Jeden betrifft eine Geschichte im Spiel persönlich.',
    },
    {
      key: 'start',
      done: content.start.trim() !== '',
      text: 'Ein starker Einstieg',
      why: 'Etwas passiert – mitten hinein, nicht „ihr sitzt in der Schenke“.',
    },
    {
      key: 'stories',
      done: inPlay.length > 0,
      text: 'Eine Geschichte im Spiel',
      why: 'Was gerade wichtig ist, steht am Spieltisch in der Mitte.',
    },
    {
      key: 'scenes',
      done: scenes >= SCENES_WANTED,
      text: 'Mögliche Szenen',
      why:
        scenes === 0
          ? 'Noch keine. Ein paar Sätze je Szene genügen.'
          : scenes < SCENES_WANTED
            ? `Erst ${scenes === 1 ? 'eine' : scenes} – drei oder vier tragen einen Abend.`
            : `${scenes} liegen bereit.`,
    },
    {
      key: 'secrets',
      done: secrets >= SECRETS_WANTED,
      text: 'Geheimnisse und Hinweise',
      why:
        secrets >= SECRETS_WANTED
          ? `${secrets} liegen bereit.`
          : `${secrets} von ${SECRETS_WANTED}. Ein Vorrat, aus dem du am Tisch schöpfst.`,
    },
    {
      key: 'encounter',
      done: readyEncounters(data, content).length > 0,
      text: 'Eine Begegnung bereit',
      why: 'Zusammengestellt im Bestiarium – am Tisch nur noch öffnen.',
    },
    {
      key: 'treasure',
      done: content.treasure.trim() !== '' || readyLoot(data).length > 0,
      text: 'Beute',
      why: 'Am besten etwas, das zu einem bestimmten Gefährten passt.',
    },
  ];
}
