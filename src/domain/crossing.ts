/**
 * Überfahrten: Abläufe nach Fahrplan (`runs`), die dort abfahren, wo die Gruppe steht – eine
 * Fähre, ein Schiff, eine Kutschlinie. Am Tisch steht „Nächste Fahrt nach X“; mitgefahren wird
 * über die vorhandenen Befehle (`features/wege/actions.ts`, `bookCrossing`): Die Zeit bis zur
 * Ankunft der Fahrt vergeht, dann ist die Gruppe dort. Nie von Hand gerechnet, nie gesperrt –
 * fährt ein Ablauf gerade nicht, steht nur der Grund dabei.
 *
 * Reine Funktionen.
 */
import { placeAncestors, placeSubtreeIds } from './derive';
import { runStatus, type Trip } from './runs';
import type { CampaignData, Place, Run } from './schema';
import { srdItem } from './srd/lookup';
import {
  MINUTES_PER_DAY,
  dayIndexOf,
  formatClock,
  formatDayMonth,
  formatDuration,
  type CalendarDef,
} from './time/calendar';

export interface Crossing {
  run: Run;
  /** Die nächste Fahrt; null, wenn keine mehr ansteht oder der Ablauf nicht fährt. */
  next: Trip | null;
  /** Warum der Ablauf gerade nicht fährt (ausgesetzt, Betreiber fehlt …). */
  problem: string | null;
  /** Die Abfahrt liegt nicht am Ort der Gruppe selbst, sondern darüber oder darin („ab Hafen“). */
  elsewhere: boolean;
}

/**
 * Die Abläufe, die vom Ort der Gruppe abfahren – auch vom Ort darüber und von Orten darin. Wer im
 * Gasthaus sitzt (oder in einem seiner Räume), bricht von der Stadt auf und erreicht ihren Hafen;
 * wer in der Stadt steht, sieht ihre Häfen – nicht gleich alle Häfen der ganzen Gegend. Die
 * nächste Abfahrt zuerst; was gerade nicht fährt, zuletzt.
 */
export function crossingsHere(data: CampaignData): Crossing[] {
  const placeId = data.state.placeId;
  const place = placeId ? data.entities[placeId] : undefined;
  if (!placeId || place?.kind !== 'place') return [];
  // Ein Raum gehört zu seinem Haus; ein Ort ohne eigene Orte darin (Gasthaus, Markt) zu dem Ort,
  // in dem er liegt – höchstens eine Stufe hinauf.
  const parentOf = (p: Place): Place | null => {
    const up = p.place.parentId ? data.entities[p.place.parentId] : undefined;
    return up?.kind === 'place' ? up : null;
  };
  let base: Place = place;
  for (let up = parentOf(base), i = 0; base.place.room && up && i < 20; up = parentOf(base), i++)
    base = up;
  const leaf = !Object.values(data.entities).some(
    (e) => e.kind === 'place' && e.place.parentId === base.id && !e.place.room,
  );
  const origin = (leaf && parentOf(base)) || base;
  const near = new Set([
    ...placeSubtreeIds(data, origin.id),
    ...placeAncestors(data, placeId).map((up) => up.id),
  ]);
  return Object.values(data.runs)
    .filter((run) => near.has(run.fromId) && run.toId !== placeId && data.entities[run.toId])
    .map((run) => {
      const status = runStatus(data, run);
      return {
        run,
        next: status.next,
        problem: status.problem,
        elsewhere: run.fromId !== placeId,
      };
    })
    .sort(
      (a, b) =>
        (a.next?.departs ?? Infinity) - (b.next?.departs ?? Infinity) ||
        a.run.name.localeCompare(b.run.name, 'de'),
    );
}

/** Ganze Tage einer Fahrt, angefangene zählen voll (mindestens einer). */
export const tripDays = (trip: Pick<Trip, 'departs' | 'arrives'>): number =>
  Math.max(1, Math.ceil((trip.arrives - trip.departs) / MINUTES_PER_DAY));

export interface PassagePrice {
  label: string;
  /** Gold für die ganze Fahrt. */
  gold: number;
}

/**
 * Was eine Überfahrt nach dem Regelwerk kostet (SRD 5.2.1: Hängematte oder eigene Kabine je Tag)
 * – nur als Vorschlag; der Preis bleibt frei.
 */
export function passagePrices(trip: Pick<Trip, 'departs' | 'arrives'>): PassagePrice[] {
  const days = tripDays(trip);
  return [
    ['srd-passage-hammock', 'Hängematte'],
    ['srd-passage-cabin', 'Eigene Kabine'],
  ].flatMap(([id, label]) => {
    const item = srdItem(id);
    return item ? [{ label: label!, gold: Math.round(item.price * days * 100) / 100 }] : [];
  });
}

/**
 * Wann eine Fahrt abgeht, in Worten: „heute 14:00 (in 3 Std.)“, „morgen 06:00“, „17. Tauwind,
 * 06:00 (in 4 Tagen)“.
 */
export function departureText(cal: CalendarDef, now: number, departs: number): string {
  const days = dayIndexOf(departs) - dayIndexOf(now);
  const clock = formatClock(departs);
  if (days <= 0) return `heute ${clock} (in ${formatDuration(Math.max(0, departs - now))})`;
  if (days === 1) return `morgen ${clock}`;
  return `${formatDayMonth(cal, departs)}, ${clock} (in ${days} Tagen)`;
}
