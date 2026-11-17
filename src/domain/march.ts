/**
 * Gewaltmarsch: Wie lange die Gruppe schon reist. Gezählt wird seit dem Ende der letzten Langen
 * Rast – höchstens über die letzten 24 Stunden, damit eine vergessene Rast keinen Marsch über
 * Tage ergibt – und über alle Arten zu reisen zusammen: Wege (Minuten am Ortswechsel,
 * `travel.minutes`) und Schritte auf Hexkarten (`area.party.legs`). Nie über Mitternacht.
 */
import { lastLongRestEnd } from './rest';
import { ledMembers, touches, whoOf } from './party';
import type { Area, CampaignData } from './schema';
import { MINUTES_PER_DAY, dayIndexOf, type WorldTime } from './time/calendar';

/** So viele Stunden am Tag reist man ohne Gewaltmarsch (Regelwerk 2024). */
export const TRAVEL_HOURS = 8;

export interface ForcedMarch {
  /** Angefangene Stunden über die acht hinaus. */
  hours: number;
  /** Schwierigkeit des Konstitutionsrettungswurfs für die letzte dieser Stunden. */
  dc: number;
}

/** Ab der neunten Stunde: je Stunde ein Rettungswurf, sonst eine Stufe Erschöpfung. */
export function forcedMarch(minutes: number): ForcedMarch | null {
  const over = minutes - TRAVEL_HOURS * 60;
  if (over <= 0) return null;
  const hours = Math.ceil(over / 60);
  return { hours, dc: 10 + hours };
}

type MarchData = Pick<CampaignData, 'rests' | 'chronicle' | 'areas' | 'state' | 'entities'> &
  Partial<Pick<CampaignData, 'journeys'>>;

/** Ab wann Reisezeit zur Zeit `at` zählt: Ende der letzten Langen Rast, höchstens 24 Stunden. */
export function marchStart(data: Pick<CampaignData, 'rests'>, at: WorldTime): WorldTime {
  const rests = Object.values(data.rests).filter((rest) => rest.end !== null && rest.end <= at);
  return Math.max(lastLongRestEnd(rests) ?? -Infinity, at - MINUTES_PER_DAY);
}

/** Der Teil einer Reise, die um `end` endete und `minutes` dauerte, der nach `from` liegt. */
const within = (end: WorldTime, minutes: number, from: WorldTime, at: WorldTime): number =>
  end > at ? 0 : Math.max(0, Math.min(minutes, end - from));

/**
 * Wie viele Minuten die (geleitete) Gruppe bis `at` seit der letzten Rast gereist ist. `area`
 * ersetzt das gespeicherte Gebiet gleicher Kennung – für einen Schritt, der erst geplant wird.
 */
export function marchedMinutes(data: MarchData, at: WorldTime, area?: Area): number {
  const from = marchStart(data, at);
  const led = ledMembers(data as CampaignData);
  let total = 0;
  for (const entry of Object.values(data.chronicle)) {
    const minutes = entry.kind === 'travel' ? entry.travel?.minutes : undefined;
    if (!minutes || !touches(whoOf(entry), led)) continue;
    total += within(entry.at, minutes, from, at);
  }
  const areas = { ...data.areas, ...(area ? { [area.id]: area } : {}) };
  for (const each of Object.values(areas)) {
    const party = each.party;
    if (!party) continue;
    if (party.legs.length)
      for (const leg of party.legs) total += within(leg.at, leg.minutes, from, at);
    // Ältere Stände kennen nur die Reisezeit des Tages.
    else if (party.minutes && party.day === dayIndexOf(at)) total += party.minutes;
  }
  // Reisen „bis zur nächsten Entscheidung“: Stücke mitten auf einem Abschnitt (`journey.steps`).
  for (const journey of Object.values(data.journeys ?? {}))
    for (const step of journey.steps) total += within(step.at, step.minutes, from, at);
  return total;
}

/** Was eine Reise von `minutes` ab jetzt für den Gewaltmarsch bedeutet; null = nichts. */
export function marchAfter(data: MarchData, minutes: number): ForcedMarch | null {
  if (minutes <= 0) return null;
  const end = data.state.now + minutes;
  return forcedMarch(marchedMinutes(data, end) + Math.min(minutes, MINUTES_PER_DAY));
}

/** Schritte einer Hexkarte, die für den Gewaltmarsch noch zählen können (die letzten 24 Std.). */
export const recentLegs = (legs: readonly { at: WorldTime; minutes: number }[], at: WorldTime) =>
  legs.filter((leg) => leg.at > at - MINUTES_PER_DAY);

/** Sichtbare Regel zum Gewaltmarsch, in Worten. */
export const marchRule = (march: ForcedMarch): string =>
  `Gewaltmarsch: ${march.hours === 1 ? 'eine Stunde' : `${march.hours} Stunden`} über acht seit der letzten Langen Rast. Am Ende jeder dieser Stunden legt jeder einen Konstitutionsrettungswurf ab (jetzt SG ${march.dc}) oder erhält eine Stufe Erschöpfung.`;
