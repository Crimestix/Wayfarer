/**
 * Was die Chronik sich merkt, solange die App läuft – und der Weg, auf dem andere Bereiche sie mit
 * einer Vorwahl öffnen („alles zu dieser Person“, „was an diesem Ort geschah“):
 *
 *   showInChronicle({ entityId: person.id });
 *   navigate('/chronik');
 */
import { EMPTY_FILTER, type ChronicleFilter } from './model';

export type ChronikView = 'verlauf' | 'sessions';

export const remembered: {
  view: ChronikView;
  filter: ChronicleFilter;
  newestFirst: boolean;
  sessionId: string | null;
} = {
  view: 'verlauf',
  filter: EMPTY_FILTER,
  newestFirst: true,
  sessionId: null,
};

const listeners = new Set<() => void>();

/** Die geöffnete Chronik erfährt hierüber von einer neuen Vorwahl. */
export function onChroniclePreset(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stellt den Verlauf auf eine Vorwahl ein; alle anderen Filter werden zurückgesetzt. */
export function showInChronicle(preset: Partial<ChronicleFilter>): void {
  remembered.view = 'verlauf';
  remembered.filter = { ...EMPTY_FILTER, ...preset };
  listeners.forEach((listener) => listener());
}

/** Öffnet in der Chronik eine bestimmte Session. */
export function showSessionInChronicle(sessionId: string): void {
  remembered.view = 'sessions';
  remembered.sessionId = sessionId;
  listeners.forEach((listener) => listener());
}
