/**
 * Rasten: Die Weltzeit vergeht, Termine treten ein, die Gefährten erholen sich, und die Rast steht
 * in der Chronik. Die Regeln rechnet `domain/rest.ts`; hier wird geschrieben.
 */
import { advanceTime, logEntry, undoTimeAdvance, type TimeAdvanceResult } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import {
  LONG_REST_MINUTES,
  SHORT_REST_MINUTES,
  changesSomething,
  longRestEffects,
  remainingMinutes,
  watchAt,
  watchesUntil,
  type RestEffect,
  type Watch,
} from '../../domain/rest';
import { RestSchema, newId, nowIso, type Character, type Rest } from '../../domain/schema';
import { formatDuration } from '../../domain/time/calendar';
import { joinNames } from './model';

export interface RestInput {
  kind: Rest['kind'];
  /** Wer rastet (Kennungen der Gefährten). */
  participants: string[];
  /** Wachplan ab jetzt; nur bei der Langen Rast. */
  watches?: Watch[];
  /** Nach so vielen Minuten wird die Rast gestört; ohne Angabe verläuft sie ungestört. */
  interruptedAfter?: number;
  /** Was die Rast stört. */
  reason?: string;
  /** Eine unterbrochene Lange Rast fortsetzen, statt eine neue zu beginnen. */
  resumeId?: string;
}

export interface RestResult {
  rest: Rest;
  /** Was in der vergangenen Zeit eingetreten ist. */
  advance: TimeAdvanceResult;
  /** Die Notiz in der Chronik. */
  text: string;
  /** Was sich bei den Gefährten geändert hat (nur nach abgeschlossener Langer Rast). */
  effects: RestEffect[];
  /** Wurde die Rast gestört? */
  interrupted: boolean;
  undo: () => void;
}

const names = (list: { name: string }[]) => joinNames(list.map((entry) => entry.name));

/** Der Satz für die Chronik. */
function restText(
  kind: Rest['kind'],
  minutes: number,
  effects: RestEffect[],
  options: { interrupted: boolean; resumed: boolean; reason: string; onWatch: Character[] },
): string {
  if (options.interrupted) {
    const watch = options.onWatch.length ? ` Auf Wache: ${names(options.onWatch)}.` : '';
    const why = options.reason ? `: ${options.reason}` : '';
    const what = kind === 'long' ? 'Lange Rast' : 'Kurze Rast';
    return `${what} nach ${formatDuration(minutes)} unterbrochen${why}.${watch}`;
  }
  if (kind === 'short') return `Kurze Rast (${formatDuration(minutes)}).`;
  const healed = effects.filter((e) => e.hpAfter !== e.hpBefore);
  const eased = effects.filter((e) => e.exhaustionAfter !== e.exhaustionBefore);
  const tired = effects.filter((e) => e.overWatched);
  return [
    options.resumed
      ? 'Lange Rast nach der Unterbrechung abgeschlossen.'
      : 'Lange Rast abgeschlossen.',
    healed.length ? `Trefferpunkte wieder voll: ${names(healed)}.` : '',
    eased.length
      ? `Erschöpfung um 1 gesenkt: ${joinNames(
          eased.map((e) =>
            e.exhaustionAfter === 0
              ? `${e.name} ist wieder frisch`
              : `${e.name} noch Stufe ${e.exhaustionAfter}`,
          ),
        )}.`
      : '',
    tired.length ? `Zu lange gewacht und nicht erholt: ${names(tired)}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Lässt die Gruppe rasten. Die Zeit vergeht bis zum Ende der Rast oder bis zur Störung; nach einer
 * ungestörten Langen Rast sind die Trefferpunkte voll und die Erschöpfung sinkt um eine Stufe.
 * `undo` nimmt alles zurück, was seither nicht von Hand geändert wurde.
 */
export function takeRest(db: CampaignDb, input: RestInput): RestResult {
  const before = db.getSnapshot();
  const now = before.state.now;
  const previous = input.resumeId ? before.rests[input.resumeId] : undefined;
  const resumed = previous?.kind === 'long' && previous.status === 'interrupted';
  const kind = resumed ? 'long' : input.kind;
  const total = resumed
    ? remainingMinutes(previous)
    : kind === 'long'
      ? LONG_REST_MINUTES
      : SHORT_REST_MINUTES;
  const stop =
    input.interruptedAfter !== undefined &&
    input.interruptedAfter > 0 &&
    input.interruptedAfter < total
      ? Math.round(input.interruptedAfter)
      : null;
  const minutes = stop ?? total;
  const end = now + minutes;
  const participants = input.participants
    .map((id) => before.entities[id])
    .filter((entity): entity is Character => entity?.kind === 'character');
  const planned = kind === 'long' ? (input.watches ?? []) : [];
  // Bei einer Störung zählt nur, was bis dahin wirklich gewacht wurde.
  const watches = stop === null ? planned : watchesUntil(planned, end);
  const allWatches = resumed ? [...previous.watches, ...watches] : watches;
  const effects = stop === null && kind === 'long' ? longRestEffects(participants, allWatches) : [];
  const onWatch = (stop === null ? [] : (watchAt(watches, end - 1)?.characterIds ?? []))
    .map((id) => before.entities[id])
    .filter((entity): entity is Character => entity?.kind === 'character');
  const reason = (input.reason ?? '').trim();
  const text = restText(kind, minutes, effects, {
    interrupted: stop !== null,
    resumed,
    reason,
    onWatch,
  });

  const stamp = nowIso();
  // Bei einer fortgesetzten Rast endet die letzte Unterbrechung jetzt.
  const pauses = resumed
    ? previous.interruptions.map((entry, index) =>
        index === previous.interruptions.length - 1 ? { ...entry, minutes: now - entry.at } : entry,
      )
    : [];
  const doc: Rest = RestSchema.parse({
    ...(resumed ? previous : { id: newId(), created: stamp, start: now }),
    updated: stamp,
    kind,
    participants: participants.map((c) => c.id),
    placeId: resumed ? previous.placeId : before.state.placeId,
    sessionId: before.state.sessionId,
    end,
    status: stop === null ? 'done' : 'interrupted',
    watches: allWatches,
    interruptions: stop === null ? pauses : [...pauses, { at: end, minutes: 0, text: reason }],
  });

  const { advance, rest, entryId } = db.batch(() => {
    const advance = advanceTime(db, end);
    for (const effect of effects) {
      if (!changesSomething(effect)) continue;
      const current = db.getSnapshot().entities[effect.id];
      if (current?.kind !== 'character') continue;
      db.put('entities', {
        ...current,
        character: {
          ...current.character,
          hp: effect.hpAfter,
          exhaustion: effect.exhaustionAfter,
        },
      });
    }
    const rest = db.put('rests', doc);
    const entry = logEntry(db, { text, refs: participants.map((c) => c.id) });
    return { advance, rest, entryId: entry.id };
  });

  const undo = () =>
    db.batch(() => {
      const current = db.getSnapshot();
      // Die Zeit nur zurückstellen, wenn seither kein weiterer Sprung kam.
      if (current.state.now === end && current.state.previousNow === now) undoTimeAdvance(db);
      for (const effect of effects) {
        const entity = db.getSnapshot().entities[effect.id];
        if (entity?.kind !== 'character') continue;
        // Nur zurücksetzen, was seit der Rast niemand von Hand geändert hat.
        const { hp, exhaustion } = entity.character;
        db.put('entities', {
          ...entity,
          character: {
            ...entity.character,
            hp: hp === effect.hpAfter ? effect.hpBefore : hp,
            exhaustion:
              exhaustion === effect.exhaustionAfter ? effect.exhaustionBefore : exhaustion,
          },
        });
      }
      if (db.getSnapshot().chronicle[entryId]) db.remove('chronicle', entryId);
      if (resumed) db.put('rests', previous);
      else if (db.getSnapshot().rests[rest.id]) db.remove('rests', rest.id);
    });

  return { rest, advance, text, effects, interrupted: stop !== null, undo };
}
