/** Die Arbeitsbereiche von Wayfarer in der Reihenfolge der Navigation. */
import {
  BookOpen,
  CalendarDays,
  Flame,
  Globe,
  Hexagon,
  Landmark,
  Library,
  Map as MapIcon,
  Swords,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';

export interface Area {
  path: string;
  label: string;
  hint: string;
  icon: LucideIcon;
}

export const AREAS: Area[] = [
  { path: '/', label: 'Spieltisch', hint: 'Hier und jetzt', icon: Flame },
  { path: '/welt', label: 'Welt', hint: 'Orte, Personen, Bünde', icon: Landmark },
  { path: '/wiki', label: 'Wiki', hint: 'Artikel über die Welt', icon: Library },
  { path: '/chronik', label: 'Chronik', hint: 'Was geschehen ist', icon: BookOpen },
  { path: '/kalender', label: 'Kalender', hint: 'Zeit, Termine, Monde', icon: CalendarDays },
  { path: '/faeden', label: 'Fadenbrett', hint: 'Geschichten und Fäden', icon: Waypoints },
  { path: '/gruppe', label: 'Gefährten', hint: 'Die Gruppe', icon: Swords },
  { path: '/erkundung', label: 'Erkundung', hint: 'Hexkarten für Reisen', icon: Hexagon },
  { path: '/atlas', label: 'Atlas', hint: 'Der ganze Planet', icon: Globe },
  { path: '/karten', label: 'Karten', hint: 'Zeichnen und ansehen', icon: MapIcon },
];
