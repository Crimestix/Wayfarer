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
import type { CampaignData, Run } from './schema';
import { srdItem } from './srd/lookup';
import { MINUTES_PER_DAY } from './time/calendar';
import { waysAround } from './ways';

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
 * Die Abläufe, die vom Ort der Gruppe abfahren – auch vom Ort darüber und von Orten darin. Wie
 * bei den Wegen (`waysAround`) zählt der Ort, von dem die Gruppe aufbricht: Wer im Gasthaus sitzt,
 * bricht von der Stadt auf und erreicht ihren Hafen. Die nächste Abfahrt zuerst; was gerade nicht
 * fährt, zuletzt.
 */
export function crossingsHere(data: CampaignData): Crossing[] {
  const placeId = data.state.placeId;
  const place = placeId ? data.entities[placeId] : undefined;
  if (!placeId || place?.kind !== 'place') return [];
  // Höchstens eine Stufe hinauf: Wer in der Stadt steht, nicht gleich in der ganzen Gegend.
  const start = waysAround(data, placeId)?.origin.id ?? place.place.parentId ?? placeId;
  const origin = start === place.place.parentId ? start : placeId;
  const near = new Set([
    ...placeSubtreeIds(data, placeId),
    ...placeSubtreeIds(data, origin),
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
