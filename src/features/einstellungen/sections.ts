/**
 * Die Abschnitte der Einstellungen und ihre Gruppen – an einer Stelle, damit die Seite (Leiste
 * links, eine Gruppe rechts) und die Suche („Würfeltabellen“, „Sicherung“ …) dieselbe Ordnung
 * kennen. Rückmeldung des Spielleiters (17. 11. 2026): „Ich will nicht wieder tausend Jahre nach
 * Funktionen suchen müssen.“ Reine Daten.
 */

export type SettingsGroupId =
  'kampagne' | 'schreiben' | 'sichern' | 'uebernehmen' | 'ki' | 'quellen';

export type SettingsSectionId =
  | 'campaign'
  | 'calendar'
  | 'rules'
  | 'scaffold'
  | 'tables'
  | 'dismissed'
  | 'trash'
  | 'backup'
  | 'sync'
  | 'testmode'
  | 'legacy'
  | 'wikiImport'
  | 'atlas'
  | 'legendkeeper'
  | 'ai'
  | 'sources';

export interface SettingsGroup {
  id: SettingsGroupId;
  title: string;
  /** Ein Satz, was in dieser Gruppe steht. */
  lead: string;
}

export interface SettingsSection {
  id: SettingsSectionId;
  group: SettingsGroupId;
  title: string;
  /** Weitere Wörter, unter denen die Suche den Abschnitt findet. */
  words: readonly string[];
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'kampagne', title: 'Kampagne', lead: 'Name, Ordner, Kalender und die Regeln eurer Runde.' },
  {
    id: 'schreiben',
    title: 'Schreiben und Würfeln',
    lead: 'Gerüste für Steckbriefe, die Würfeltabellen der Erzeuger, Weggeklicktes und Gelöschtes.',
  },
  {
    id: 'sichern',
    title: 'Sichern und Abgleich',
    lead: 'Sicherung in einer Datei, der Abgleich zwischen Rechnern und der Testmodus zum Ausprobieren.',
  },
  {
    id: 'uebernehmen',
    title: 'Übernehmen',
    lead: 'Aus dem alten Wayfarer, aus LegendKeeper und aus dem alten Atlas.',
  },
  { id: 'ki', title: 'KI-Leser', lead: 'Claude liest deine Artikel und schlägt vor.' },
  {
    id: 'quellen',
    title: 'Quellen',
    lead: 'Was Wayfarer an Regelwerk mitbringt und woher es stammt.',
  },
];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'campaign',
    group: 'kampagne',
    title: 'Kampagne',
    words: ['Name', 'Ordner', 'Kampagnenordner'],
  },
  {
    id: 'calendar',
    group: 'kampagne',
    title: 'Kalender',
    words: ['Jahreszeiten', 'Monate', 'Monde', 'Wochentage', 'Zeitrechnung'],
  },
  {
    id: 'rules',
    group: 'kampagne',
    title: 'Regeln des Tisches',
    words: ['Hausregeln', 'Absprachen'],
  },
  {
    id: 'scaffold',
    group: 'schreiben',
    title: 'Steckbrief-Gerüste',
    words: ['Felder', 'Steckbrief'],
  },
  {
    id: 'tables',
    group: 'schreiben',
    title: 'Würfeltabellen',
    words: ['Tabellen', 'Fundstellen', 'Verborgenes', 'Besonderheiten', 'Erzeuger'],
  },
  {
    id: 'dismissed',
    group: 'schreiben',
    title: 'Ausgeblendete Vorschläge',
    words: ['Vorschläge', 'weggeklickt', 'zurückholen'],
  },
  { id: 'trash', group: 'schreiben', title: 'Papierkorb', words: ['gelöscht', 'wiederherstellen'] },
  {
    id: 'backup',
    group: 'sichern',
    title: 'Sicherung',
    words: ['Backup', 'sichern', 'wiederherstellen', 'Datei'],
  },
  {
    id: 'sync',
    group: 'sichern',
    title: 'Abgleich',
    words: ['Mac', 'Windows', 'GitHub', 'zweiter Rechner'],
  },
  {
    id: 'testmode',
    group: 'sichern',
    title: 'Testmodus',
    words: ['testen', 'ausprobieren', 'Spielwiese', 'verwerfen', 'Probe'],
  },
  {
    id: 'legacy',
    group: 'uebernehmen',
    title: 'Alten Spielstand übernehmen',
    words: ['v157', 'alte Version'],
  },
  {
    id: 'wikiImport',
    group: 'uebernehmen',
    title: 'LegendKeeper ganz übernehmen',
    words: ['Export', 'lk', 'Wiki übernehmen'],
  },
  {
    id: 'atlas',
    group: 'uebernehmen',
    title: 'Atlas übernehmen',
    words: ['Planet', 'Küsten', 'Höhen'],
  },
  { id: 'legendkeeper', group: 'uebernehmen', title: 'LegendKeeper', words: ['Verbindung'] },
  { id: 'ai', group: 'ki', title: 'KI-Leser', words: ['Claude', 'Schlüssel', 'KI'] },
  { id: 'sources', group: 'quellen', title: 'Quellen', words: ['Regelwerk', 'SRD', 'Lizenz'] },
];

/** Die Gruppe eines Abschnitts. */
export function groupOfSection(id: SettingsSectionId): SettingsGroupId {
  return SETTINGS_SECTIONS.find((section) => section.id === id)?.group ?? 'kampagne';
}
