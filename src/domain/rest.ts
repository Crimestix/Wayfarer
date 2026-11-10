/**
 * Rast und Wachen nach D&D 2024, als reine Rechnung.
 *
 * Kurze Rast: eine Stunde. Lange Rast: acht Stunden, davon mindestens sechs Schlaf – jeder kann
 * also höchstens zwei Stunden wachen und erholt sich trotzdem. Danach sind die Trefferpunkte voll
 * und die Erschöpfung sinkt um eine Stufe. Eine Lange Rast je 24 Stunden: Die nächste beginnt
 * frühestens 16 Stunden nach dem Ende der letzten. Wird die Rast unterbrochen und fortgesetzt,
 * verlängert sie sich je Unterbrechung um eine Stunde.
 */
import type { Character, Rest } from './schema';
import type { WorldTime } from './time/calendar';

export const SHORT_REST_MINUTES = 60;
export const LONG_REST_MINUTES = 480;
/** So lange darf jeder während einer Langen Rast wachen, ohne die Erholung zu verlieren. */
export const WATCH_MINUTES = 120;
/** Abstand zwischen dem Ende einer Langen Rast und dem Beginn der nächsten. */
export const LONG_REST_GAP_MINUTES = 16 * 60;
/** Je Unterbrechung verlängert sich eine fortgesetzte Rast um so viel. */
export const INTERRUPTION_PENALTY_MINUTES = 60;

export type Watch = Rest['watches'][number];

/** Gefährten, die rasten können: aktiv und bei der Gruppe. */
export function restingParty(characters: Character[]): Character[] {
  return characters
    .filter((c) => c.character.active && c.character.placeId === null)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * Vorschlag für den Wachplan einer Langen Rast: Wachen zu je zwei Stunden, die Gefährten reihum
 * verteilt. Niemand wacht länger als zwei Stunden – bei wenigen Gefährten bleiben deshalb Wachen
 * unbesetzt. `used` nennt, wie lange jemand in dieser Rast schon gewacht hat (bei einer
 * fortgesetzten Rast); wer sein Maß voll hat, wird nicht mehr eingeteilt. `ids` liefert die
 * Kennungen der Wachen.
 */
export function proposeWatches(
  start: WorldTime,
  characterIds: readonly string[],
  ids: () => string,
  minutes = LONG_REST_MINUTES,
  used: Readonly<Record<string, number>> = {},
): Watch[] {
  const count = Math.max(1, Math.round(minutes / WATCH_MINUTES));
  const watches: Watch[] = Array.from({ length: count }, (_, index) => ({
    id: ids(),
    start: start + index * WATCH_MINUTES,
    end: Math.min(start + (index + 1) * WATCH_MINUTES, start + minutes),
    characterIds: [],
  }));
  for (const id of characterIds) {
    // Die am dünnsten besetzte Wache, die das Maß des Gefährten nicht sprengt – die frühere zuerst.
    const fitting = watches
      .filter((watch) => (used[id] ?? 0) + (watch.end - watch.start) <= WATCH_MINUTES)
      .sort((a, b) => a.characterIds.length - b.characterIds.length || a.start - b.start)[0];
    fitting?.characterIds.push(id);
  }
  return watches;
}

/** Der Teil eines Wachplans, der bis zu einem Zeitpunkt tatsächlich gewacht wurde. */
export function watchesUntil(watches: readonly Watch[], time: WorldTime): Watch[] {
  return watches
    .filter((watch) => watch.start < time)
    .map((watch) => (watch.end > time ? { ...watch, end: time } : watch));
}

/** Wie viele Minuten jemand laut Wachplan wacht. */
export function watchMinutes(watches: readonly Watch[], characterId: string): number {
  return watches
    .filter((watch) => watch.characterIds.includes(characterId))
    .reduce((sum, watch) => sum + (watch.end - watch.start), 0);
}

/** Die Wache, die zu einem Zeitpunkt läuft. */
export function watchAt(watches: readonly Watch[], time: WorldTime): Watch | undefined {
  return watches.find((watch) => time >= watch.start && time < watch.end);
}

export interface WatchView {
  watch: Watch;
  characters: Character[];
  /** Die höchste Passive Wahrnehmung unter den Wachenden und wer sie hat. */
  best: { value: number; name: string } | null;
}

/** Der Wachplan zum Anzeigen: je Wache wer wacht und wie wachsam die Wache ist. */
export function watchViews(watches: readonly Watch[], characters: Character[]): WatchView[] {
  const byId = new Map(characters.map((c) => [c.id, c]));
  return watches.map((watch) => {
    const present = watch.characterIds
      .map((id) => byId.get(id))
      .filter((c): c is Character => c !== undefined);
    let best: WatchView['best'] = null;
    for (const c of present) {
      const value = c.character.passivePerception;
      if (value !== null && (!best || value > best.value)) best = { value, name: c.name };
    }
    return { watch, characters: present, best };
  });
}

export interface RestEffect {
  id: string;
  name: string;
  /** Trefferpunkte vorher und nachher; null = werden nicht mitgeführt. */
  hpBefore: number | null;
  hpAfter: number | null;
  exhaustionBefore: number;
  exhaustionAfter: number;
  /** Hat zu lange gewacht und erholt sich deshalb nicht. */
  overWatched: boolean;
}

/**
 * Was eine abgeschlossene Lange Rast bei jedem Teilnehmer ändert. Wer länger als zwei Stunden
 * gewacht hat, bekommt nichts.
 */
export function longRestEffects(
  participants: Character[],
  watches: readonly Watch[] = [],
): RestEffect[] {
  return participants.map((c) => {
    const { hp, hpMax, exhaustion } = c.character;
    const overWatched = watchMinutes(watches, c.id) > WATCH_MINUTES;
    return {
      id: c.id,
      name: c.name,
      hpBefore: hp,
      hpAfter: overWatched || hp === null || hpMax === null ? hp : hpMax,
      exhaustionBefore: exhaustion,
      exhaustionAfter: overWatched ? exhaustion : Math.max(0, exhaustion - 1),
      overWatched,
    };
  });
}

/** Ändert die Rast bei diesem Teilnehmer überhaupt etwas? */
export const changesSomething = (effect: RestEffect): boolean =>
  effect.hpAfter !== effect.hpBefore || effect.exhaustionAfter !== effect.exhaustionBefore;

/** Ende der letzten abgeschlossenen Langen Rast. */
export function lastLongRestEnd(rests: readonly Rest[]): WorldTime | null {
  let last: WorldTime | null = null;
  for (const rest of rests)
    if (rest.kind === 'long' && rest.status === 'done' && rest.end !== null)
      if (last === null || rest.end > last) last = rest.end;
  return last;
}

/**
 * Wie viele Minuten es noch dauert, bis wieder eine Lange Rast beginnen darf; 0 = jetzt.
 * Rasten, die erst nach `now` enden (Zeit zurückgestellt), zählen nicht.
 */
export function minutesUntilLongRest(rests: readonly Rest[], now: WorldTime): number {
  const last = lastLongRestEnd(rests.filter((rest) => rest.end !== null && rest.end <= now));
  return last === null ? 0 : Math.max(0, last + LONG_REST_GAP_MINUTES - now);
}

/** Wie lange in einer Rast schon geruht wurde, bis zu ihrer letzten Unterbrechung. */
export function restedMinutes(rest: Rest): number {
  const last = rest.interruptions[rest.interruptions.length - 1];
  const until = last ? last.at : (rest.end ?? rest.start);
  const pauses = rest.interruptions.slice(0, -1).reduce((sum, i) => sum + i.minutes, 0);
  return Math.max(0, until - rest.start - pauses);
}

/** Wie lange eine unterbrochene Lange Rast noch dauert, wenn sie jetzt fortgesetzt wird. */
export function remainingMinutes(rest: Rest): number {
  return Math.max(
    0,
    LONG_REST_MINUTES -
      restedMinutes(rest) +
      rest.interruptions.length * INTERRUPTION_PENALTY_MINUTES,
  );
}

/**
 * Die unterbrochene Lange Rast, die sich noch fortsetzen lässt: die jüngste, sofern seither keine
 * andere Rast begonnen wurde und die Unterbrechung nicht länger als acht Stunden her ist.
 */
export function resumableRest(rests: readonly Rest[], now: WorldTime): Rest | null {
  const sorted = [...rests].sort((a, b) => b.start - a.start);
  const latest = sorted[0];
  if (!latest || latest.kind !== 'long' || latest.status !== 'interrupted') return null;
  const last = latest.interruptions[latest.interruptions.length - 1];
  if (!last || last.at > now || now - last.at > LONG_REST_MINUTES) return null;
  return latest;
}
