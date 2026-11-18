/**
 * Wie groß ein Ort ist (Konzeptbesprechung 16. 11.: „Ort mit Größe, weil sie Mechanik ändert“):
 * Gegend, Siedlung, Gebäude – oder Raum. Festgelegt in `place.scale`; sonst liest Wayfarer es
 * aus dem eigenen Wort (Fischerdorf → Siedlung, Taverne → Gebäude) und aus den Orten darin. Nur
 * eine Lesart, nie eine Pflicht: Ohne Hinweis bleibt die Größe offen.
 */
import { placeChildren } from './derive';
import type { CampaignData, Place, PlaceScale } from './schema';

export type ScaleOrRoom = PlaceScale | 'room';

export const SCALE_LABEL: Record<ScaleOrRoom, string> = {
  world: 'Kontinent und Welt',
  region: 'Land und Gegend',
  settlement: 'Siedlung',
  building: 'Gebäude',
  room: 'Raum',
};

/** Wörter, an deren Ende sich die Größe ablesen lässt („Hafenstadt“, „Waldschmiede“). */
const SCALE_WORDS: [PlaceScale, RegExp][] = [
  // Das Größte zuerst: „Kontinentalwelt“ endet auch auf „welt“, „Unterwelt“ ist eine Welt für sich.
  ['world', /(kontinent|kontinentalwelt|welt|erdteil|halbkugel|hemisphäre|ozean|weltmeer)$/i],
  [
    'region',
    /(region|gegend|provinz|reich|königreich|insel|gebirge|berge|wald|forst|ebene|wüste|sumpf|meer|see|küste|tal|wildnis|land|mark|ödland|steppe|tundra)$/i,
  ],
  [
    'settlement',
    /(stadt|städtchen|dorf|weiler|siedlung|metropole|hafen|posten|lager|viertel|bezirk|kolonie|feste|festung|burg|kloster|abtei|zitadelle|enklave)$/i,
  ],
  [
    'building',
    /(haus|taverne|schenke|gasthaus|gasthof|herberge|tempel|kapelle|schrein|laden|geschäft|schmiede|werkstatt|turm|halle|mühle|lagerhaus|kontor|bibliothek|bad|arena|keller|gruft|höhle|mine|stollen|ruine|gebäude|anwesen|villa|hütte|kaserne|wache|gefängnis|bordell|stall|markt)$/i,
  ],
];

/** Die Größe, die das eigene Wort nahelegt – null, wenn es nichts sagt. */
export function scaleOfWord(word: string): PlaceScale | null {
  const clean = word.trim();
  if (!clean) return null;
  for (const [scale, pattern] of SCALE_WORDS) if (pattern.test(clean)) return scale;
  return null;
}

/**
 * Die Größe eines Ortes: ein Raum ist ein Raum; festgelegt gilt; sonst das eigene Wort; sonst:
 * Wer Orte (keine Räume) in sich hat, ist mindestens eine Siedlung. null = offen.
 */
export function placeScale(data: Pick<CampaignData, 'entities'>, place: Place): ScaleOrRoom | null {
  if (place.place.room) return 'room';
  if (place.place.scale) return place.place.scale;
  const fromWord = scaleOfWord(place.place.category);
  if (fromWord) return fromWord;
  if (placeChildren(data as CampaignData, place.id).some((child) => !child.place.room))
    return 'settlement';
  return null;
}

/** Eine Gegend oder Siedlung – ein Ort, in dem andere Orte liegen (für Läden, „Wer hier ist“). */
export function isWideScale(scale: ScaleOrRoom | null): boolean {
  return scale === 'world' || scale === 'region' || scale === 'settlement';
}
