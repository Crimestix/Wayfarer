/**
 * Erfundene Welt und erfundene Notizen für die Tests des Lesens (Schritt 3). Die Notizen ahmen
 * nur die Form echter Spielleiter-Notizen nach: Vorlesetext unter „Intro“, Stichpunkte und lange
 * Absätze, Beutelisten unter Namen, Einkaufszeilen, wörtliche Briefe, Regelwerte, eine Liste
 * offener Fäden. Alles erfunden: Hohenfurt, Mira Tannhaus, Lando Furtner, Krummzahn …
 */
import { emptyCampaign } from '../../../data/seed';
import {
  createEntity,
  createSession,
  type CampaignData,
  type ChroniclePrecision,
  type Entity,
  type Session,
} from '../../../domain/schema';
import { toTime } from '../../../domain/time/calendar';
import { ELARIS_CALENDAR } from '../../../domain/time/elaris';

/** Weltzeit in Elaris: Tag, Monat (1-basiert), Jahr AD, Uhrzeit. */
export const at = (day: number, month: number, year: number, hour = 0, minute = 0) =>
  toTime(ELARIS_CALENDAR, { year: year + 27387, month: month - 1, day, hour, minute });

export const NOW = at(20, 1, 701, 6);

export function readWorld() {
  const entities: Record<string, Entity> = {};
  const add = <E extends Entity>(entity: E): E => {
    entities[entity.id] = entity;
    return entity;
  };
  const w = {
    hohenfurt: add(createEntity({ kind: 'place', name: 'Hohenfurt' })),
    grotte: add(createEntity({ kind: 'place', name: 'Salzgrotte' })),
    mira: add(createEntity({ kind: 'character', name: 'Mira Tannhaus' })),
    lando: add(createEntity({ kind: 'character', name: 'Lando Furtner' })),
    brann: add(createEntity({ kind: 'character', name: 'Brann Eichwald' })),
    krummzahn: add(createEntity({ kind: 'person', name: 'Krummzahn' })),
    odo: add(createEntity({ kind: 'person', name: 'Odo Kessler' })),
    hagen: add(createEntity({ kind: 'person', name: 'Hagen Brack' })),
    bande: add(createEntity({ kind: 'faction', name: 'Krähenbande' })),
    data: emptyCampaign('Testwelt', ELARIS_CALENDAR, NOW) as CampaignData,
  };
  w.data = { ...w.data, entities };
  return w;
}

export type ReadWorld = ReturnType<typeof readWorld>;

/** Eine nachgetragene Session mit diesen Notizen. */
export function noted(
  number: number,
  text: string,
  startAt: number,
  endAt: number | null,
  precision: ChroniclePrecision = 'exact',
): Session {
  return createSession({
    number,
    startAt,
    endAt,
    source: { file: 'kladde.txt', text, line: 1, precision },
  });
}

export function withSessions(w: ReadWorld, ...sessions: Session[]): CampaignData {
  const all = { ...w.data.sessions };
  for (const session of sessions) all[session.id] = session;
  return { ...w.data, sessions: all };
}

/** Eine Session wie aus einer Kladde: Rückblick, Stichpunkte, Brief, Beute, Regeln, Fäden. */
export const ABEND_EINS = `Intro
Ihr seid nach langer Reise in Hohenfurt angekommen. Der Regen hat euch begleitet.
Ihr habt Krummzahn am Anleger gesehen und euch gefragt, was er dort will.
Am Ende des Tages wart ihr müde.


Notizen
Sind in Hohenfurt angekommen, haben mit Odo Kesssler gesprochen.
Haben den Auftrag für die Salzgrotte bekommen.
Brann hat Krummzahn erschlagen.
Lando sprach mit Tessa am Brunnen und gab sich als Wido aus. Tessa gab ihnen einen Apfel.
Nächster Tag.
8 Uhr - Mira hat Hörner aus Bernstein bekommen.
Der Bote brachte eine Nachricht von Hagen Brack.
Dort stand:
Mira,
kommt nicht in die Grotte. Dort wartet die Bande.
Grüße, Hagen
Was er selbst noch nicht weiß: Odo Kessler arbeitet für die Krähenbande.
Bei den Toten fand die Gruppe:
Krummzahn
12 Goldmünzen
5 Silbermünzen
Rostiger Schlüssel


Schmuggler
Eine Karte der Salzgrotte
3 Goldmünzen

Lair Actions: Felssturz - 2W6 Schaden gegen SG 13 Geschick
Lv.1: Licht, Schild, Magisches Geschoss
Aktuelle Plothooks:
* Der Schlüssel der Grotte
* Wer bezahlt die Krähenbande?
Hier endete Session 1.`;

/** Ein zweiter Abend: Krummzahn handelt wieder – ohne dass er zurückgekehrt wäre. */
export const ABEND_ZWEI = `Krummzahn lachte und floh in die Salzgrotte.
Die Gruppe folgte ihm.`;

/** Ein dritter Abend, in dem Krummzahn ausdrücklich zurückkehrt. */
export const ABEND_RUECKKEHR = `Ein Ritual brachte Krummzahn zurück.
Krummzahn lachte und floh in die Salzgrotte.`;

/** Einkäufe, Bestellung, Zwischenzeit, Gesetzesauszug, Zitat. */
export const ABEND_STADT = `Mira Downtime: Übt mit dem Bogen.
Lando Downtime: Schmuggelt drei Wochen lang Salz.
Brann Downtime: Repariert die Mühle.
In der Kammer des Krämers wurden folgende Gegenstände gefunden:
Brann: Kurzschwert +1 (Gekauft für Lando)
Mira: Laterne (Gekauft, gegeben an Mira)
Lando: Seidenschal (Nicht gekauft)
Lando gibt folgendes beim Krämer in Auftrag:
1 Seil
1 Zelt
Gesetzesauszug
## Recht der Furt
> **Über den Zoll**
> Wer die Furt quert, zahlt zwei Kupfer.
Brann fragte:


„Wohin jetzt?“
Hier endete Session 3.`;
