/**
 * Handgriffe in der Suche (Rückmeldung des Spielleiters, 17. 11. 2026: „Ich will nicht wieder
 * tausend Jahre nach Funktionen suchen müssen“). Wer „Rast“, „Beute“, „Würfeltabellen“ oder
 * „2 Std.“ tippt, bekommt den Handgriff selbst – und erfährt dabei, wo er zu Hause ist (`home`).
 * Die Suche ist das Netz unter allem: Was die Oberfläche umordnet, bleibt hier zu finden.
 *
 * Reine Rechnung: welcher Handgriff passt und was er tun soll. Ausgeführt wird in der Oberfläche
 * (`shell/dialogs.tsx`).
 */
import { normalize, searchEntities } from '../domain/derive';
import type { CampaignData } from '../domain/schema';
import { SETTINGS_SECTIONS, type SettingsSectionId } from '../features/einstellungen/sections';

/** Was ein Handgriff tut. */
export type GripRun =
  | { type: 'log'; kind?: 'note' | 'promise' | 'change'; own?: 'loot' | 'guess' | 'trade' }
  | { type: 'move'; placeId?: string }
  | { type: 'journey'; toId?: string }
  | { type: 'pass'; minutes: number }
  | { type: 'time' }
  | { type: 'rest'; kind: 'short' | 'long' }
  | { type: 'downtime' }
  | { type: 'spell' }
  | { type: 'shop' }
  | { type: 'newEntry' }
  | { type: 'newStory' }
  | { type: 'rules' }
  | { type: 'page'; href: string }
  | { type: 'settings'; section: SettingsSectionId };

export interface Handgrip {
  key: string;
  label: string;
  /** Wo der Handgriff zu Hause ist – damit man ihn beim nächsten Mal auch ohne Suche findet. */
  home: string;
  /** Weitere Wörter, unter denen er gefunden wird. */
  words: readonly string[];
  run: GripRun;
}

/** Die festen Handgriffe – je einer mit seinem Zuhause. */
export const HANDGRIPS: readonly Handgrip[] = [
  {
    key: 'log',
    label: 'Festhalten',
    home: 'Weltleiste oben rechts',
    words: ['Eintrag', 'Chronik', 'aufschreiben', 'notieren'],
    run: { type: 'log' },
  },
  {
    key: 'note',
    label: 'Notiz festhalten',
    home: 'Mitschrift am Spieltisch',
    words: ['Notiz', 'Mitschrift'],
    run: { type: 'log', kind: 'note' },
  },
  {
    key: 'promise',
    label: 'Abmachung festhalten',
    home: 'Festhalten · Abmachung',
    words: ['Abmachung', 'Versprechen', 'Auftrag', 'Deal'],
    run: { type: 'log', kind: 'promise' },
  },
  {
    key: 'change',
    label: 'Veränderung der Welt festhalten',
    home: 'Festhalten · Veränderung',
    words: ['Veränderung', 'Welt ändert sich'],
    run: { type: 'log', kind: 'change' },
  },
  {
    key: 'loot',
    label: 'Beute verteilen',
    home: 'Festhalten · Beute, oder „/beute“ in der Mitschrift',
    words: ['Beute', 'Gold', 'Schatz', 'Belohnung', 'geben'],
    run: { type: 'log', own: 'loot' },
  },
  {
    key: 'trade',
    label: 'Handeln – kaufen oder verkaufen',
    home: 'Spieltisch · Läden hier',
    words: ['Handel', 'Laden', 'kaufen', 'verkaufen', 'Händler', 'Markt'],
    run: { type: 'shop' },
  },
  {
    key: 'guess',
    label: 'Vermutung der Spieler festhalten',
    home: 'Festhalten · Vermutung',
    words: ['Vermutung', 'Theorie', 'Spielerbuch'],
    run: { type: 'log', own: 'guess' },
  },
  {
    key: 'spell',
    label: 'Zauber wirken',
    home: 'Mitschrift · „/zauber“',
    words: ['Zauber', 'Konzentration', 'Wirkung'],
    run: { type: 'spell' },
  },
  {
    key: 'move',
    label: 'Ort wechseln',
    home: 'Spieltisch · Ort links · Weiterziehen',
    words: ['Ortswechsel', 'weiterziehen', 'gehen', 'Ort der Gruppe'],
    run: { type: 'move' },
  },
  {
    key: 'journey',
    label: 'Reise antreten',
    home: 'Spieltisch · Ort links · Weiterziehen',
    words: ['Reise', 'reisen', 'aufbrechen', 'unterwegs'],
    run: { type: 'journey' },
  },
  {
    key: 'time',
    label: 'Zeit vergehen lassen',
    home: 'Weltleiste · Zeit',
    words: ['Zeit', 'vorstellen', 'warten', 'Datum'],
    run: { type: 'time' },
  },
  {
    key: 'shortRest',
    label: 'Kurze Rast',
    home: 'Weltleiste · Zeit',
    words: ['Rast', 'ausruhen', 'Pause'],
    run: { type: 'rest', kind: 'short' },
  },
  {
    key: 'longRest',
    label: 'Lange Rast',
    home: 'Weltleiste · Zeit',
    words: ['Rast', 'schlafen', 'Nachtlager', 'Lager'],
    run: { type: 'rest', kind: 'long' },
  },
  {
    key: 'downtime',
    label: 'Freie Zeit verbringen',
    home: 'Gefährten · Freie Zeit',
    words: ['Zwischenzeit', 'Handwerk', 'herstellen', 'Ausbildung'],
    run: { type: 'downtime' },
  },
  {
    key: 'rules',
    label: 'Regeln des Tisches',
    home: 'Spieltisch · Schriftrolle über der Mitschrift',
    words: ['Hausregeln', 'Absprachen'],
    run: { type: 'rules' },
  },
  {
    key: 'newEntry',
    label: 'Neuer Eintrag in der Welt',
    home: 'Welt · Neu',
    words: ['neu', 'anlegen', 'Person', 'Ort', 'Fraktion', 'Gegenstand', 'Artikel'],
    run: { type: 'newEntry' },
  },
  {
    key: 'newStory',
    label: 'Neue Geschichte',
    home: 'Fadenbrett · + Geschichte',
    words: ['Geschichte', 'Abenteuer', 'Plot', 'neu'],
    run: { type: 'newStory' },
  },
  {
    key: 'prep',
    label: 'Abend vorbereiten',
    home: 'Spieltisch · Abend vorbereiten',
    words: ['Vorbereitung', 'Session', 'Einstieg', 'Szenen'],
    run: { type: 'page', href: '/abend' },
  },
  {
    key: 'hexmap',
    label: 'Hexkarte anlegen oder bearbeiten',
    home: 'Welt · Hexkarten',
    words: ['Hexkarte', 'Hex', 'Erkundung', 'Gelände'],
    run: { type: 'page', href: '/erkundung' },
  },
  {
    key: 'net',
    label: 'Wegenetz vorbereiten',
    home: 'Fadenbrett · Wegenetze',
    words: ['Strecke', 'Wege', 'Punkte', 'Gegend'],
    run: { type: 'page', href: '/wegenetze' },
  },
  {
    key: 'creature',
    label: 'Wesen bauen',
    home: 'Bestiarium · Wesen',
    words: ['Monster', 'Werte', 'Statblock', 'Gegner'],
    run: { type: 'page', href: '/bestiarium' },
  },
  {
    key: 'encounter',
    label: 'Begegnung zusammenstellen',
    home: 'Bestiarium · Begegnungen',
    words: ['Kampf', 'Gegner', 'Schwierigkeit'],
    run: { type: 'page', href: '/begegnungen' },
  },
  {
    key: 'handout',
    label: 'Handout schreiben',
    home: 'Spieltisch · Handouts',
    words: ['Brief', 'Aushang', 'Hinweiskarte', 'drucken'],
    run: { type: 'page', href: '/handouts' },
  },
  {
    key: 'backfill',
    label: 'Alte Sessions nachtragen',
    home: 'Zeit · Nachtragen',
    words: ['Notizen', 'nachtragen', 'Textdatei'],
    run: { type: 'page', href: '/nachtragen' },
  },
  ...SETTINGS_SECTIONS.map((section): Handgrip => ({
    key: `settings:${section.id}`,
    label: section.title,
    home: 'Einstellungen',
    words: section.words,
    run: { type: 'settings', section: section.id },
  })),
];

/** Wie gut ein Handgriff zum Suchwort passt: 0 genau, 1 Anfang, 2 Wortanfang, 3 enthalten; 9 nicht. */
function gripScore(q: string, grip: Handgrip): number {
  const label = normalize(grip.label);
  if (label === q) return 0;
  if (label.startsWith(q)) return 1;
  const words = [label, ...grip.words.map(normalize)].flatMap((text) => text.split(/[\s\-·–,]+/));
  if (words.some((word) => word.startsWith(q))) return 2;
  if (grip.words.some((word) => normalize(word).startsWith(q))) return 2;
  if (label.includes(q)) return 3;
  // Mehrere Wörter: Jedes muss irgendwo beginnen.
  const parts = q.split(/\s+/).filter(Boolean);
  if (parts.length > 1 && parts.every((part) => words.some((word) => word.startsWith(part))))
    return 3;
  return 9;
}

/** Eine Dauer aus dem Suchwort: „2 Std.“, „+30 min“, „3 Tage“, „zeit 1 tag“. null = keine. */
export function readDuration(query: string): number | null {
  const q = normalize(query)
    .replace(/^zeit\s+/, '')
    .replace(/^\+\s*/, '');
  const match =
    /^(\d+(?:[.,]\d+)?)\s*(min|minute|minuten|m|std|stunde|stunden|h|tag|tage|tagen|d|woche|wochen)\.?$/.exec(
      q,
    );
  if (!match) return null;
  const value = Number.parseFloat(match[1]!.replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2]!;
  const factor = /^(min|minute|minuten|m)$/.test(unit)
    ? 1
    : /^(std|stunde|stunden|h)$/.test(unit)
      ? 60
      : /^(woche|wochen)$/.test(unit)
        ? 60 * 24 * 7
        : 60 * 24;
  const minutes = Math.round(value * factor);
  return minutes > 0 && minutes <= 60 * 24 * 366 ? minutes : null;
}

/** „2 Std.“ in Worten – für die Zeile des Handgriffs. */
export function durationWords(minutes: number): string {
  if (minutes % (60 * 24) === 0) {
    const days = minutes / (60 * 24);
    return days === 1 ? 'Einen Tag' : `${days} Tage`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? 'Eine Stunde' : `${hours} Stunden`;
  }
  return `${minutes} Minuten`;
}

/**
 * Die Handgriffe zu einem Suchwort, die besten zuerst. Dazu, was sich aus dem Wort lesen lässt:
 * eine Dauer („2 Std.“ → so lange vergehen lassen) und ein Ziel („nach Krähenmoor“ → dorthin
 * ziehen oder reisen).
 */
export function findHandgrips(data: CampaignData, query: string, limit = 6): Handgrip[] {
  const q = normalize(query.trim());
  if (!q) return [];
  const out: Handgrip[] = [];
  const minutes = readDuration(q);
  if (minutes !== null)
    out.push({
      key: `pass:${minutes}`,
      label: `${durationWords(minutes)} vergehen lassen`,
      home: 'Weltleiste · Zeit',
      words: [],
      run: { type: 'pass', minutes },
    });
  const target =
    /^(?:gruppe\s+)?(?:nach|zu|zum|zur|reise nach|reisen nach|ziehen nach)\s+(.+)$/.exec(q);
  if (target) {
    const places = searchEntities(data, target[1]!, { kinds: ['place'], limit: 3 }).filter(
      (place) => place.id !== data.state.placeId,
    );
    for (const place of places) {
      out.push({
        key: `move:${place.id}`,
        label: `Gruppe nach ${place.name} ziehen`,
        home: 'Spieltisch · Ort links · Weiterziehen',
        words: [],
        run: { type: 'move', placeId: place.id },
      });
      out.push({
        key: `journey:${place.id}`,
        label: `Reise nach ${place.name} antreten`,
        home: 'Spieltisch · Ort links · Weiterziehen',
        words: [],
        run: { type: 'journey', toId: place.id },
      });
    }
  }
  const scored = HANDGRIPS.map((grip) => ({ grip, score: gripScore(q, grip) }))
    .filter((entry) => entry.score < 9)
    .sort((a, b) => a.score - b.score);
  for (const { grip } of scored) out.push(grip);
  return out.slice(0, limit);
}
