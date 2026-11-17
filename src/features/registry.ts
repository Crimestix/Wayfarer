/** Die Arbeitsbereiche von Wayfarer in der Reihenfolge der Navigation. */
import {
  BookOpen,
  BookUser,
  CalendarDays,
  ChartNoAxesGantt,
  Castle,
  Coins,
  Flame,
  Gauge,
  Globe,
  Hexagon,
  Landmark,
  Skull,
  NotebookPen,
  Pin,
  Orbit,
  Route,
  ScrollText,
  Swords,
  Tent,
  Users,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';

/** Eine Ansicht innerhalb eines Bereichs – ein Reiter oben auf der Seite. */
export interface AreaTab {
  path: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

export interface Area {
  path: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Mehrere Ansichten unter einem Eintrag der Navigation. */
  tabs?: readonly AreaTab[];
  /** Weitere Pfade, die zu diesem Bereich gehören. */
  also?: readonly string[];
  /** Einer der drei Kerne (Leiten, Storyboarding, Worldbuilding) – stehen oben in der Leiste. */
  core?: boolean;
}

/**
 * Die Ordnung folgt den drei Kernen (Konzeptbesprechung 16. 11.): Leiten (Spieltisch),
 * Storyboarding (Fadenbrett), Worldbuilding (Welt). Darunter die Bereiche, die sie füttern:
 * Gefährten, Zeit, Bestiarium. Die Adressen der Seiten bleiben, nur die Gruppierung folgt den
 * Kernen.
 */

/** Leiten: der Spieltisch – und was dazugehört: den Abend vorbereiten, sein Gedächtnis. */
export const LEAD_TABS: readonly AreaTab[] = [
  { path: '/', label: 'Spieltisch', hint: 'Hier und jetzt', icon: Flame },
  {
    path: '/abend',
    label: 'Abend vorbereiten',
    hint: 'Wo wir stehen, Einstieg, Szenen, Geheimnisse, Orte, Personen',
    icon: NotebookPen,
  },
  { path: '/chronik', label: 'Chronik', hint: 'Was am Tisch geschehen ist', icon: BookOpen },
  {
    path: '/offen',
    label: 'Noch offen',
    hint: 'Was die Gruppe angestoßen und nie beendet hat',
    icon: Pin,
  },
  {
    path: '/handouts',
    label: 'Handouts',
    hint: 'Briefe, Aushänge, Hinweiskarten drucken',
    icon: ScrollText,
  },
];

/** Storyboarding: das Fadenbrett – und Strecken und Gegenden, durch die eine Geschichte führt. */
export const STORY_TABS: readonly AreaTab[] = [
  { path: '/faeden', label: 'Fadenbrett', hint: 'Geschichten, Dinge, Fäden', icon: Waypoints },
  {
    path: '/wegenetze',
    label: 'Wegenetze',
    hint: 'Strecken und Gegenden vorbereiten',
    icon: Route,
  },
];

/** Worldbuilding: die Welt mit ihren Texten – und ihre Karten. */
export const WORLD_TABS: readonly AreaTab[] = [
  { path: '/welt', label: 'Welt', hint: 'Orte, Personen, Artikel', icon: Landmark },
  { path: '/atlas', label: 'Weltkarte', hint: 'Der ganze Planet und wo alles liegt', icon: Globe },
  // „Karten“ (der Zeichen-Editor) ist vorerst verworfen (Spielleiter, 17. 11. 2026: „Wir werden
  // nur noch Hexkarten machen“). Die Seite bleibt unter ihrer Adresse erreichbar, steht aber
  // nicht mehr in der Navigation; gezeichnete Karten und ihre Wege bleiben im Spielstand.
  { path: '/erkundung', label: 'Hexkarten', hint: 'Erkundung und Reisen', icon: Hexagon },
];

/** Gefährten: alles, was die Charaktere der Spieler betrifft. */
export const GROUP_TABS: readonly AreaTab[] = [
  { path: '/gruppe', label: 'Gefährten', hint: 'Die Gruppe', icon: Users },
  { path: '/beute', label: 'Beute-Buch', hint: 'Was die Gruppe bekommen hat', icon: Coins },
  {
    path: '/fortschritt',
    label: 'Fortschritt',
    hint: 'Ausbildungswege, Ruf, Schulden, Studien',
    icon: Gauge,
  },
  { path: '/bastion', label: 'Bastion', hint: 'Einrichtungen und Bastionszüge', icon: Castle },
  {
    path: '/spielerbuch',
    label: 'Spielerbuch',
    hint: 'Was die Gruppe weiß und vermutet',
    icon: BookUser,
  },
];

/** Zeit: der Kalender, die Zeitleiste, was abseits geschieht – und alte Abende nachtragen. */
export const TIME_TABS: readonly AreaTab[] = [
  { path: '/kalender', label: 'Kalender', hint: 'Zeit, Termine, Monde', icon: CalendarDays },
  {
    path: '/zeitleiste',
    label: 'Zeitleiste',
    hint: 'Was war und was kommt – in Bahnen',
    icon: ChartNoAxesGantt,
  },
  {
    path: '/geschehen',
    label: 'Weltgeschehen',
    hint: 'Die Welt dreht sich weiter – abseits der Gruppe',
    icon: Orbit,
  },
  {
    path: '/nachtragen',
    label: 'Nachtragen',
    hint: 'Alte Sessions aus deinen Notizen',
    icon: ScrollText,
  },
];

/** Bestiarium: die Wesen – und die Begegnungen, die aus ihnen entstehen. */
export const BEAST_TABS: readonly AreaTab[] = [
  { path: '/bestiarium', label: 'Wesen', hint: 'Statblöcke bauen und finden', icon: Skull },
  { path: '/begegnungen', label: 'Begegnungen', hint: 'Zusammenstellen und führen', icon: Swords },
  { path: '/bestaende', label: 'Bestände', hint: 'Baue, Horte und Nester', icon: Tent },
];

export const AREAS: Area[] = [
  {
    path: '/',
    label: 'Spieltisch',
    hint: 'Leiten: der Abend, die Chronik',
    icon: Flame,
    tabs: LEAD_TABS,
    core: true,
  },
  {
    path: '/faeden',
    label: 'Fadenbrett',
    hint: 'Geschichten: Dinge, Fäden, Wege',
    icon: Waypoints,
    tabs: STORY_TABS,
    also: ['/geschichte'],
    core: true,
  },
  {
    path: '/welt',
    label: 'Welt',
    hint: 'Orte, Personen, Texte, Karten',
    icon: Landmark,
    tabs: WORLD_TABS,
    also: ['/wiki'],
    core: true,
  },
  {
    path: '/gruppe',
    label: 'Gefährten',
    hint: 'Die Gruppe, Beute, Bastion',
    icon: Users,
    tabs: GROUP_TABS,
  },
  {
    path: '/kalender',
    label: 'Zeit',
    hint: 'Kalender, Zeitleiste, Weltgeschehen',
    icon: CalendarDays,
    tabs: TIME_TABS,
    also: ['/damals'],
  },
  {
    path: '/bestiarium',
    label: 'Bestiarium',
    hint: 'Wesen, Begegnungen, Bestände',
    icon: Skull,
    tabs: BEAST_TABS,
  },
];

/** Die Pfade, unter denen ein Bereich zu Hause ist: sein eigener und die seiner Ansichten. */
export const areaPaths = (area: Area): string[] => [
  area.path,
  ...(area.tabs ?? []).map((tab) => tab.path),
  ...(area.also ?? []),
];
