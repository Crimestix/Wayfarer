/** Die Arbeitsbereiche von Wayfarer in der Reihenfolge der Navigation. */
import {
  BookOpen,
  CalendarDays,
  Coins,
  Flame,
  Gauge,
  Globe,
  Hexagon,
  Landmark,
  Skull,
  Map as MapIcon,
  NotebookPen,
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
}

/** Zeit: der Kalender, was geschehen ist – auch aus alten Notizen nachgetragen. */
export const TIME_TABS: readonly AreaTab[] = [
  { path: '/kalender', label: 'Kalender', hint: 'Zeit, Termine, Monde', icon: CalendarDays },
  { path: '/chronik', label: 'Chronik', hint: 'Was geschehen ist', icon: BookOpen },
  {
    path: '/nachtragen',
    label: 'Nachtragen',
    hint: 'Alte Sessions aus deinen Notizen',
    icon: ScrollText,
  },
  {
    path: '/geschehen',
    label: 'Weltgeschehen',
    hint: 'Die Welt dreht sich weiter – abseits der Gruppe',
    icon: Orbit,
  },
];

/** Bestiarium: die Wesen – und die Begegnungen, die aus ihnen entstehen. */
export const BEAST_TABS: readonly AreaTab[] = [
  { path: '/bestiarium', label: 'Wesen', hint: 'Statblöcke bauen und finden', icon: Skull },
  { path: '/begegnungen', label: 'Begegnungen', hint: 'Zusammenstellen und führen', icon: Swords },
  { path: '/bestaende', label: 'Bestände', hint: 'Baue, Horte und Nester', icon: Tent },
];

/** Geschichten: das Brett mit allen – und das Blatt für den nächsten Abend. */
export const STORY_TABS: readonly AreaTab[] = [
  { path: '/faeden', label: 'Fadenbrett', hint: 'Geschichten und Fäden', icon: Waypoints },
  {
    path: '/abend',
    label: 'Abend vorbereiten',
    hint: 'Einstieg, Szenen, Geheimnisse, Begegnungen, Beute',
    icon: NotebookPen,
  },
];

/** Gefährten: die Gruppe – und was sie bekommen hat. */
export const GROUP_TABS: readonly AreaTab[] = [
  { path: '/gruppe', label: 'Gefährten', hint: 'Die Gruppe', icon: Users },
  { path: '/beute', label: 'Beute-Buch', hint: 'Was die Gruppe bekommen hat', icon: Coins },
  {
    path: '/fortschritt',
    label: 'Fortschritt',
    hint: 'Ausbildungswege, Ruf, Schulden, Studien',
    icon: Gauge,
  },
];

/** Karten: der Planet, gezeichnete und Bildkarten, Wegenetze, Hexkarten für Reisen. */
export const MAP_TABS: readonly AreaTab[] = [
  { path: '/atlas', label: 'Weltkarte', hint: 'Der ganze Planet und wo alles liegt', icon: Globe },
  { path: '/karten', label: 'Karten', hint: 'Zeichnen und ansehen', icon: MapIcon },
  {
    path: '/wegenetze',
    label: 'Wegenetze',
    hint: 'Strecken und Gegenden vorbereiten',
    icon: Route,
  },
  { path: '/erkundung', label: 'Hexkarten', hint: 'Erkundung und Reisen', icon: Hexagon },
];

export const AREAS: Area[] = [
  { path: '/', label: 'Spieltisch', hint: 'Hier und jetzt', icon: Flame },
  {
    path: '/welt',
    label: 'Welt',
    hint: 'Orte, Personen, Artikel',
    icon: Landmark,
    also: ['/wiki'],
  },
  {
    path: '/kalender',
    label: 'Zeit',
    hint: 'Kalender, Chronik, Nachtragen, Weltgeschehen',
    icon: CalendarDays,
    tabs: TIME_TABS,
  },
  {
    path: '/faeden',
    label: 'Fadenbrett',
    hint: 'Geschichten, Fäden, der nächste Abend',
    icon: Waypoints,
    tabs: STORY_TABS,
    also: ['/geschichte'],
  },
  {
    path: '/bestiarium',
    label: 'Bestiarium',
    hint: 'Wesen, Begegnungen, Bestände',
    icon: Skull,
    tabs: BEAST_TABS,
  },
  {
    path: '/gruppe',
    label: 'Gefährten',
    hint: 'Die Gruppe und ihre Beute',
    icon: Users,
    tabs: GROUP_TABS,
  },
  {
    path: '/karten',
    label: 'Karten',
    hint: 'Weltkarte, Karten, Wegenetze, Hexkarten',
    icon: MapIcon,
    tabs: MAP_TABS,
  },
];

/** Die Pfade, unter denen ein Bereich zu Hause ist: sein eigener und die seiner Ansichten. */
export const areaPaths = (area: Area): string[] => [
  area.path,
  ...(area.tabs ?? []).map((tab) => tab.path),
  ...(area.also ?? []),
];
