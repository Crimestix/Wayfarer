/** Die Arbeitsbereiche von Wayfarer in der Reihenfolge der Navigation. */
import {
  BookOpen,
  CalendarDays,
  Flame,
  Hexagon,
  Landmark,
  Swords,
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
  { path: '/welt', label: 'Welt', hint: 'Orte, Personen, Fraktionen', icon: Landmark },
  { path: '/chronik', label: 'Chronik', hint: 'Was geschehen ist', icon: BookOpen },
  { path: '/kalender', label: 'Kalender', hint: 'Zeit, Termine, Monde', icon: CalendarDays },
  { path: '/gruppe', label: 'Gefährten', hint: 'Die Gruppe', icon: Swords },
  { path: '/erkundung', label: 'Erkundung', hint: 'Hexkarten zwischen Orten', icon: Hexagon },
];
