/**
 * Heldenbögen und Rampenlicht: was die Geschichte eines Gefährten ausmacht – gesammelt aus dem,
 * was der Spielleiter geschrieben hat (Ziel, Wünsche, Wandlungen, Meilensteine, Lehrer,
 * Geschichten, Leisten, Zustände) – und wie oft jeder an den letzten Abenden in der Chronik
 * vorkam. Wayfarer zählt und sammelt nur; es bewertet nichts und erfindet nichts. Reine Funktionen.
 */
import { activeParty, byTime, chronicleSorted, sessionsSorted } from './derive';
import { activeConditions, entryEntityIds, type ActiveCondition } from './history';
import { looseReason } from './looseEnds';
import { relationType } from './relations';
import type { CampaignData, Character, ChronicleEntry, Relation, Session, Track } from './schema';
import { storiesOfHero, type HeroTie } from './story';
import { tracksOf } from './track';

// ── Heldenbogen ────────────────────────────────────────────────────────────

/** Ein Lehrer oder Schüler eines Gefährten – aus einer Beziehung der Art „mentor“. */
export interface MentorTie {
  relation: Relation;
  /** Das Gegenüber. */
  otherId: string;
  /** teacher = das Gegenüber lehrt den Gefährten; student = der Gefährte lehrt das Gegenüber. */
  role: 'teacher' | 'student';
  /** Aus Sicht des Gefährten: „lernt von“ bzw. „lehrt“. */
  label: string;
  /** Die Beziehung besteht nicht mehr – sie gehört trotzdem zu seiner Geschichte. */
  ended: boolean;
}

export interface HeroArc {
  character: Character;
  /** Was er will (`character.goal`), getrimmt; leer = steht noch nirgends. */
  goal: string;
  /** Offene Wünsche des Spielers, der jüngste zuerst – ohne den, der schon sein Ziel ist. */
  wishes: ChronicleEntry[];
  /** Wandlungen (neue Kräfte, Gestalt …), die jüngste zuerst. */
  transformations: ChronicleEntry[];
  /** Meilensteine und Stufen, der jüngste zuerst. */
  milestones: ChronicleEntry[];
  /** Lehrer und Schüler, bestehende zuerst. */
  mentors: MentorTie[];
  /** Geschichten, die ihn persönlich betreffen – mit seinem Grund, die im Spiel zuerst. */
  stories: HeroTie[];
  /** Seine Fortschrittsleisten, offene zuerst. */
  tracks: Track[];
  /** Offene Zustände aus der Chronik, der älteste zuerst. */
  conditions: ActiveCondition[];
}

const newestFirst = (entries: ChronicleEntry[]) => [...entries].sort((a, b) => byTime(b, a));

/** Lehrer und Schüler eines Eintrags: Beziehungen der Art „mentor“ in beiden Richtungen. */
export function mentorsOf(
  data: Pick<CampaignData, 'relations' | 'entities'>,
  entityId: string,
): MentorTie[] {
  const type = relationType('mentor');
  return Object.values(data.relations)
    .flatMap((relation): MentorTie[] => {
      if (relation.type !== 'mentor' || relation.from === relation.to) return [];
      if (relation.to === entityId && data.entities[relation.from])
        return [
          {
            relation,
            otherId: relation.from,
            role: 'teacher',
            label: type.inverse,
            ended: relation.ended,
          },
        ];
      if (relation.from === entityId && data.entities[relation.to])
        return [
          {
            relation,
            otherId: relation.to,
            role: 'student',
            label: type.label,
            ended: relation.ended,
          },
        ];
      return [];
    })
    .sort(
      (a, b) =>
        Number(a.ended) - Number(b.ended) ||
        Number(a.role === 'student') - Number(b.role === 'student') ||
        (data.entities[a.otherId]?.name ?? '').localeCompare(
          data.entities[b.otherId]?.name ?? '',
          'de',
        ),
    );
}

/** Offene Wünsche eines Spielers für seinen Gefährten (der Gefährte ist `refs[0]`). */
export function openWishes(data: CampaignData, characterId: string): ChronicleEntry[] {
  const entity = data.entities[characterId];
  const goal = entity?.kind === 'character' ? entity.character.goal.trim() : '';
  return newestFirst(
    Object.values(data.chronicle).filter(
      (entry) =>
        entry.kind === 'wish' &&
        entry.refs[0] === characterId &&
        looseReason(data, entry) !== null &&
        // Der Wunsch, der sein Ziel ist, steht schon als Ziel da.
        !(goal && entry.text.trim() === goal),
    ),
  );
}

/** Alles, was die Geschichte eines Gefährten ausmacht – null, wenn es keinen solchen gibt. */
export function heroArc(data: CampaignData, characterId: string): HeroArc | null {
  const character = data.entities[characterId];
  if (character?.kind !== 'character') return null;
  const sorted = chronicleSorted(data);
  return {
    character,
    goal: character.character.goal.trim(),
    wishes: openWishes(data, characterId),
    transformations: sorted
      .filter(
        (entry) =>
          entry.kind === 'transformation' && entry.transformation?.characterId === characterId,
      )
      .reverse(),
    milestones: sorted
      .filter((entry) => entry.kind === 'milestone' && entry.milestone?.characterId === characterId)
      .reverse(),
    mentors: mentorsOf(data, characterId),
    stories: storiesOfHero(data, characterId),
    tracks: tracksOf(data, characterId),
    conditions: activeConditions(data, characterId),
  };
}

/** Ob im Bogen noch gar nichts steht. */
export function arcIsEmpty(arc: HeroArc): boolean {
  return (
    !arc.goal &&
    arc.wishes.length === 0 &&
    arc.transformations.length === 0 &&
    arc.milestones.length === 0 &&
    arc.mentors.length === 0 &&
    arc.stories.length === 0 &&
    arc.tracks.length === 0 &&
    arc.conditions.length === 0
  );
}

// ── Rampenlicht ────────────────────────────────────────────────────────────

/** So viele Abende blickt das Rampenlicht zurück. */
export const SPOTLIGHT_SESSIONS = 3;
/** Wer weniger als diesen Teil des Schnitts hat, steht selten im Mittelpunkt. */
export const SPOTLIGHT_LOW = 0.5;

export interface SpotlightRow {
  character: Character;
  /** In so vielen Einträgen der Chronik kam er vor (je Eintrag höchstens einmal). */
  count: number;
  /** Sein Teil an allen gezählten Nennungen (0…1). */
  share: number;
  /** 1 = am häufigsten; Gleichstand teilt sich den Rang. */
  rank: number;
  /** Im Verhältnis zum Häufigsten (0…1) – für einen Balken. */
  ratio: number;
}

export interface Spotlight {
  /** Die gezählten Abende, der früheste zuerst. */
  sessions: Session[];
  /** Davon die Abende, an denen überhaupt etwas festgehalten wurde. */
  sessionsWithEntries: number;
  /** Je aktivem Gefährten, der häufigste zuerst. */
  rows: SpotlightRow[];
  /** Alle Nennungen zusammen. */
  total: number;
  /** Nennungen je Gefährte im Schnitt. */
  average: number;
}

/**
 * Zählt nicht mit: eingetretene Termine und Schritte von Uhren – das geschieht in der Welt, nicht
 * am Tisch.
 */
const countsAtTable = (entry: ChronicleEntry) => entry.kind !== 'event' && !entry.clockId;

/**
 * Wie oft jeder aktive Gefährte an den letzten `sessions` begonnenen Abenden in Einträgen der
 * Chronik vorkommt – über die Verweise und die Angaben der Art (Haltung, Meilenstein, Wunsch,
 * Wandlung, Zitat …). Ein Eintrag zählt je Gefährte höchstens einmal.
 */
export function spotlight(
  data: CampaignData,
  { sessions: wanted = SPOTLIGHT_SESSIONS }: { sessions?: number } = {},
): Spotlight {
  const party = activeParty(data);
  const begun = sessionsSorted(data).filter((session) => session.startAt <= data.state.now);
  const sessions = wanted > 0 ? begun.slice(-wanted) : [];
  const ids = new Set(sessions.map((session) => session.id));
  const counts = new Map(party.map((character) => [character.id, 0]));
  const withEntries = new Set<string>();
  for (const entry of Object.values(data.chronicle)) {
    if (!entry.sessionId || !ids.has(entry.sessionId) || !countsAtTable(entry)) continue;
    withEntries.add(entry.sessionId);
    for (const id of new Set(entryEntityIds(entry)))
      if (counts.has(id)) counts.set(id, counts.get(id)! + 1);
  }
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const ordered = [...party].sort(
    (a, b) => counts.get(b.id)! - counts.get(a.id)! || a.name.localeCompare(b.name, 'de'),
  );
  const most = Math.max(0, ...counts.values());
  const rows = ordered.map((character) => {
    const count = counts.get(character.id)!;
    return {
      character,
      count,
      share: total > 0 ? count / total : 0,
      rank: 1 + ordered.filter((other) => counts.get(other.id)! > count).length,
      ratio: most > 0 ? count / most : 0,
    };
  });
  return {
    sessions,
    sessionsWithEntries: withEntries.size,
    rows,
    total,
    average: party.length ? total / party.length : 0,
  };
}

const WORDS = ['', 'einen', 'beiden', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];

/** „an den letzten drei Abenden“, „an den letzten beiden Abenden“. */
export function lastEveningsText(count: number): string {
  if (count === 1) return 'am letzten Abend';
  return `an den letzten ${WORDS[count] ?? count} Abenden`;
}

/**
 * Höchstens ein ruhiger Satz: wer an den letzten Abenden deutlich seltener als die anderen in der
 * Chronik vorkam. Nur, wenn an mindestens zwei Abenden etwas festgehalten wurde und jemand unter
 * der Hälfte des Schnitts liegt – sonst null.
 */
export function spotlightHint(
  data: CampaignData,
  options: { sessions?: number } = {},
): string | null {
  const view = spotlight(data, options);
  if (view.rows.length < 2 || view.sessionsWithEntries < 2 || view.average <= 0) return null;
  const fewest = Math.min(...view.rows.map((row) => row.count));
  if (fewest >= view.average * SPOTLIGHT_LOW) return null;
  // Bei Gleichstand der erste nach Namen – immer derselbe Satz für denselben Stand.
  const quiet = view.rows.find((row) => row.count === fewest)!;
  const when = lastEveningsText(view.sessions.length);
  return quiet.count === 0
    ? `${quiet.character.name} kam ${when} in keinem Eintrag vor.`
    : `${quiet.character.name} stand ${when} selten im Mittelpunkt.`;
}
