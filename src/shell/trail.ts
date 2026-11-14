/**
 * Der Weg durch die App: Von wo kam man auf eine Seite? Ein Blatt (die Geschichte) führt damit
 * dorthin zurück, woher man kam – zum Fadenbrett, zum Abend, zur Seite eines Eintrags –, statt
 * immer an denselben Ort. Gemerkt wird nur für die Dauer der Sitzung; reine Funktionen und ein
 * kleiner Merker.
 */
import type { CampaignData } from '../domain/schema';

/** Länger wird die Spur nicht – ältere Schritte fallen vorn heraus. */
const TRAIL_MAX = 40;

/**
 * Ein Schritt weiter: Die neue Adresse kommt ans Ende. Führt er auf die Seite davor zurück, wird
 * die Spur kürzer – „zurück“ ist kein neuer Schritt.
 */
export function stepTrail(trail: readonly string[], location: string): string[] {
  const last = trail[trail.length - 1];
  if (last === location) return [...trail];
  if (trail.length >= 2 && trail[trail.length - 2] === location) return trail.slice(0, -1);
  return [...trail, location].slice(-TRAIL_MAX);
}

/** Die Seite vor der jetzigen – null, wenn es keine gab. */
export function cameFrom(trail: readonly string[], location: string): string | null {
  const index = trail.lastIndexOf(location);
  return (index > 0 ? trail[index - 1] : null) ?? null;
}

export interface BackLink {
  href: string;
  label: string;
}

const PLAIN: Record<string, string> = {
  '/': 'Spieltisch',
  '/faeden': 'Fadenbrett',
  '/abend': 'Abend vorbereiten',
  '/handouts': 'Handouts',
  '/offen': 'Noch offen',
  '/welt': 'Welt',
  '/gruppe': 'Gefährten',
  '/geschehen': 'Weltgeschehen',
  '/zeitleiste': 'Zeitleiste',
  '/kalender': 'Kalender',
  '/chronik': 'Chronik',
};

const FALLBACK: BackLink = { href: '/faeden', label: 'Fadenbrett' };

/**
 * Der Zurück-Verweis eines Blatts: dorthin, woher man kam, mit dem Namen der Seite – der Name
 * eines Eintrags, eines Artikels, einer Geschichte, eines Wegenetzes. Unbekanntes führt zum
 * Fadenbrett.
 */
export function backLink(
  data: Pick<CampaignData, 'entities' | 'stories' | 'nets' | 'articles'>,
  from: string | null,
): BackLink {
  if (!from) return FALLBACK;
  const plain = PLAIN[from];
  if (plain) return { href: from, label: plain };
  const [, area, id] = from.split('/');
  if (!id) return FALLBACK;
  if (area === 'welt' || area === 'gruppe') {
    const entity = data.entities[id];
    return entity ? { href: from, label: entity.name } : FALLBACK;
  }
  if (area === 'geschichte') {
    const story = data.stories[id];
    return story ? { href: from, label: story.title } : FALLBACK;
  }
  if (area === 'wiki') {
    const article = data.articles[id];
    return article ? { href: from, label: article.title } : FALLBACK;
  }
  if (area === 'wegenetze') {
    const net = data.nets[id];
    // Das Netz einer Geschichte heißt wie sie – das Wort davor sagt, wohin es zurückgeht.
    return net ? { href: from, label: `Wegenetz „${net.name}“` } : FALLBACK;
  }
  return FALLBACK;
}

let trail: string[] = [];

/** Für das Gerüst: meldet die Adresse, auf der die App gerade steht. */
export function noteLocation(location: string): void {
  trail = stepTrail(trail, location);
}

/** Für ein Blatt: die Seite, von der man hierher kam. */
export function previousLocation(location: string): string | null {
  return cameFrom(trail, location);
}
