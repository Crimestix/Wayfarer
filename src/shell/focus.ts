/**
 * Eine Seite gezielt öffnen: Die Suche merkt vor, was dort gezeigt werden soll – eine Karte des
 * Fadenbretts, eine Uhr, ein Ablauf, ein Tag im Kalender, ein Handout, eine Bastion, eine Vermutung, ein Laden, ein Fortbewegungsmittel. Die Seite nimmt es, sobald sie offen
 * ist; steht sie schon offen, springt sie sofort.
 */
import { useEffect, useSyncExternalStore } from 'react';

export type Focus =
  /** Eine Karte auf dem Fadenbrett: `story:<id>` oder `thread:<id>`. */
  | { type: 'card'; key: string }
  | { type: 'clock'; id: string }
  | { type: 'run'; id: string }
  | { type: 'handout'; id: string }
  | { type: 'bastion'; id: string }
  /** Eine Vermutung im Spielerbuch – sie öffnet sich zum Ändern. */
  | { type: 'guess'; id: string }
  /** Ein Laden – er öffnet sich auf der Seite seines Ortes oder Händlers. */
  | { type: 'shop'; id: string }
  /** Ein Reittier, Fahrzeug oder Schiff – es öffnet sich auf der Gefährten-Seite zum Ändern. */
  | { type: 'mount'; id: string }
  /** Ein Tag im Kalender (Tagesindex seit Beginn der Zeitrechnung). */
  | { type: 'day'; day: number }
  /** Die Regeln des Tisches – sie öffnen sich am Spieltisch. */
  | { type: 'rules' }
  /** „Abend vorbereiten“: das Blatt des laufenden Abends oder das offene für den nächsten. */
  | { type: 'prep'; which: 'now' | 'next' }
  /** Das Blatt eines früheren Abends – es öffnet sich in der Chronik zum Nachlesen. */
  | { type: 'sheet'; sessionId: string };

let pending: Focus | null = null;
const listeners = new Set<() => void>();

/** Merkt vor, was die nächste Seite zeigen soll. */
export function focusOn(focus: Focus | null): void {
  pending = focus;
  listeners.forEach((listener) => listener());
}

/**
 * Für die Seite: `take` bekommt, was für sie vorgemerkt ist – einmal. Gibt sie `false` zurück,
 * bleibt es vorgemerkt (etwa, weil es das Gesuchte nicht mehr gibt, verfällt es beim nächsten).
 */
export function useFocus<T extends Focus['type']>(
  types: readonly T[],
  take: (focus: Extract<Focus, { type: T }>) => void,
): void {
  const focus = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
  );
  useEffect(() => {
    if (!focus || !(types as readonly string[]).includes(focus.type)) return;
    pending = null;
    take(focus as Extract<Focus, { type: T }>);
    // `take` und `types` ändern sich mit jedem Zeichnen; gemeint ist nur das Vorgemerkte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);
}
