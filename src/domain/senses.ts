/**
 * Witterung (Wunsch des Spielleiters, 17. 11.: „Sobald sie ein neues Hex betreten, liest Wayfarer
 * die benachbarten Hexes, die betretbar sind, und gibt Hinweise für den DM“): was die Gruppe von
 * den Feldern ringsum bemerkt – nur über Gänge, die sie gehen könnte (keine verborgenen, kein
 * Fels). Ein Hinweis für die Spielleitung, nie ein Ereignis.
 *
 * Woher ein Hinweis kommt: das eigene Wort des Spielleiters am Feld (`hex.sign`), sonst die
 * Besonderheit (`FEATURE_SIGNS`), ein Fluss, ein Schacht, die Art des Durchgangs; dazu für die
 * Spielleitung, was dort liegt oder vorbereitet ist.
 */
import { sameHex, type HexCoord } from './hex';
import { DIR_DOWN, DIR_UP, exitsOf, indexHexes, passagesFrom } from './passages';
import type { Area, CampaignData, PassageKind } from './schema';

/** Richtungen der sechs Seiten bei Feldern mit der Spitze oben (Norden oben). */
export const DIR_WORD = [
  'nordöstlichen',
  'östlichen',
  'südöstlichen',
  'südwestlichen',
  'westlichen',
  'nordwestlichen',
] as const;

const DIR_FROM = [
  'Aus Nordosten',
  'Aus Osten',
  'Aus Südosten',
  'Aus Südwesten',
  'Aus Westen',
  'Aus Nordwesten',
];

/** „Aus dem westlichen Gang“, „Von oben“, „Von unten“ – auf der Oberwelt „Aus Westen“. */
export function fromWhere(dir: number, underground: boolean): string {
  if (dir === DIR_UP) return 'Von oben';
  if (dir === DIR_DOWN) return 'Von unten';
  return underground ? `Aus dem ${DIR_WORD[dir] ?? ''} Gang` : (DIR_FROM[dir] ?? '');
}

/** Woran man eine Besonderheit von nebenan bemerkt. */
export const FEATURE_SIGNS: Record<string, string> = {
  'Große Höhle': 'Ein Luftzug, der Hall wird weiter',
  Tropfsteinhalle: 'Gleichmäßiges Tropfen hallt herüber',
  Pilzwald: 'Modriger, süßlicher Pilzgeruch',
  Kristallgrotte: 'Ein schwaches Glitzern, wo Licht hinfällt',
  'Unterirdischer See': 'Feuchte, kühle Luft',
  Einsturzhalle: 'Staub und loses Geröll im Gang',
  Leuchtmooshöhle: 'Ein fahles, grünliches Schimmern',
  Schlotkammer: 'Warmer Luftzug, der nach oben zieht',
  Säulenhalle: 'Schritte hallen wie in einem großen Saal',
  'Warme Quellhöhle': 'Warme, schweflige Luft',
  'Verschütteter Gang': 'Kein Luftzug, der Gang riecht nach Staub',
  'Nische mit Tropfwasser': 'Leises Tropfen',
  'Senkloch voller Wasser': 'Stehendes Wasser riecht faulig',
  'Alter Lagerplatz': 'Ein Hauch von altem Rauch',
};

const PASSAGE_SIGNS: Partial<Record<PassageKind, string>> = {
  narrow: 'der Gang wird eng',
  climb: 'der Gang steigt steil an oder fällt ab',
  water: 'Wasser steht im Gang',
  drop: 'der Boden bricht dort ab',
};

export interface Sense {
  /** Seite des Feldes (0–5, 6 oben, 7 unten). */
  dir: number;
  /** „Aus dem westlichen Gang“. */
  where: string;
  /** Was die Gruppe bemerkt. */
  noticed: string[];
  /** Nur für die Spielleitung: was dort liegt oder vorbereitet ist. */
  gm: string[];
}

/**
 * Was die Gruppe auf einem Feld von den Feldern ringsum bemerkt – ohne das Feld, aus dem sie
 * gerade kam (`from`), das kennt sie schon.
 */
export function sensesAt(
  data: CampaignData,
  area: Pick<Area, 'hexes'>,
  at: HexCoord,
  from: HexCoord | null = null,
): Sense[] {
  const here = area.hexes.find((hex) => sameHex(hex, at));
  if (!here) return [];
  const underground = here.exits !== null;
  const index = indexHexes(area.hexes);
  const out: Sense[] = [];
  for (const passage of passagesFrom(index, here)) {
    const there = passage.to;
    if (from && sameHex(there, from)) continue;
    const noticed: string[] = [];
    if (there.sign.trim()) noticed.push(there.sign.trim());
    else if (FEATURE_SIGNS[there.feature.trim()])
      noticed.push(FEATURE_SIGNS[there.feature.trim()]!);
    if (there.river && !here.river) noticed.push('Rauschen von Wasser');
    const shafts = exitsOf(there).filter((exit) => exit.dir >= 6 && exit.kind !== 'hidden');
    if (passage.dir < 6 && shafts.some((exit) => exit.dir === DIR_DOWN))
      noticed.push('ein kalter Luftzug aus der Tiefe');
    else if (passage.dir < 6 && shafts.some((exit) => exit.dir === DIR_UP))
      noticed.push('ein Hauch frischerer Luft von oben');
    const kind = PASSAGE_SIGNS[passage.kind];
    if (kind) noticed.push(kind);
    const gm: string[] = [];
    if (there.placeId && data.entities[there.placeId])
      gm.push(`Dort liegt ${data.entities[there.placeId]!.name}`);
    if (there.prepared.trim()) gm.push(`Vorbereitet: ${there.prepared.trim()}`);
    if (!noticed.length && !gm.length) continue;
    out.push({
      dir: passage.dir,
      where: fromWhere(passage.dir, underground),
      noticed: noticed.map((text, i) => (i === 0 ? text[0]!.toUpperCase() + text.slice(1) : text)),
      gm,
    });
  }
  return out.sort((a, b) => a.dir - b.dir);
}

/** Ein Hinweis als Zeile: „Aus dem westlichen Gang: Modriger Pilzgeruch · der Gang wird eng“. */
export const senseLine = (sense: Sense): string =>
  `${sense.where}: ${[...sense.noticed, ...sense.gm].join(' · ')}`;
