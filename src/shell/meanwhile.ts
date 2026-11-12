/**
 * „Währenddessen“: Was in der Welt geschehen ist, während Zeit verging – das Wichtige zuerst.
 * Eine lange Reise soll nicht mit zwanzig Markttagen antworten: Schritte von Uhren, einmalige
 * Ereignisse und abgelaufene Wirkungen stehen oben, Routinen am Ort der Gruppe darunter, alle
 * übrigen Routinen werden nur gezählt. Reine Funktion.
 */
import type { TimeAdvanceResult } from '../data/actions';
import type { CampaignData } from '../domain/schema';
import { isNear } from '../domain/weight';

export interface MeanwhileLine {
  text: string;
  /** `main` = hat die Welt verändert oder betrifft die Gruppe; `side` = Routine in der Nähe. */
  weight: 'main' | 'side';
}

export interface Meanwhile {
  lines: MeanwhileLine[];
  /** Routinen anderswo, die nicht einzeln aufgeführt sind. */
  elsewhere: number;
}

/** So viele Zeilen zeigt die Meldung höchstens. */
export const MEANWHILE_LINES = 7;

/** Was währenddessen geschah, geordnet nach Gewicht. */
export function meanwhile(
  data: CampaignData,
  result: Pick<TimeAdvanceResult, 'occurred' | 'expired' | 'steps'>,
  limit = MEANWHILE_LINES,
): Meanwhile {
  const main: string[] = [];
  for (const s of result.steps) main.push(`${s.step.text} (${s.clock.title})`);

  // Wiederkehrende Termine nur einmal, mit Anzahl; einmalige einzeln.
  const routines = new Map<string, { title: string; count: number; here: boolean }>();
  for (const o of result.occurred) {
    if (!o.event.repeat) {
      main.push(`Eingetreten: ${o.event.title}`);
      continue;
    }
    const known = routines.get(o.event.id);
    if (known) known.count++;
    else
      routines.set(o.event.id, {
        title: o.event.title,
        count: 1,
        here: isNear(data, o.event.placeId),
      });
  }
  for (const timer of result.expired)
    main.push(`${timer.kind === 'light' ? 'Erloschen' : 'Abgelaufen'}: ${timer.label}`);

  const label = (r: { title: string; count: number }) =>
    `${r.title}${r.count > 1 ? ` (${r.count}×)` : ''}`;
  // Feste Reihenfolge: nach dem Namen.
  const sorted = [...routines.values()].sort((x, y) => x.title.localeCompare(y.title, 'de'));
  const here = sorted.filter((r) => r.here).map(label);
  const away = sorted.filter((r) => !r.here);

  const lines: MeanwhileLine[] = main.map((text) => ({ text, weight: 'main' as const }));
  // Gibt es sonst nichts zu melden, dürfen auch Routinen anderswo einzeln stehen.
  const side = [...here, ...(main.length + here.length === 0 ? away.splice(0).map(label) : [])];
  for (const text of side) lines.push({ text, weight: 'side' });

  const shown = lines.slice(0, Math.max(1, limit));
  const cut = lines.slice(shown.length);
  return {
    lines: shown,
    // Was nicht mehr auf die Meldung passt, zählt mit zu „weiteres“ – Wichtiges fällt dabei nie
    // vor Routinen weg, weil es zuerst steht.
    elsewhere: away.length + cut.length,
  };
}
