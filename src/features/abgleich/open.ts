/**
 * Wer welche Fläche des Abgleichs öffnet – nie von selbst, immer auf einen Klick (am Tisch nie
 * ein Dialog). Der Dialog „Das entscheidest du“ öffnet erst nach einem frischen Lauf.
 */
import { useSyncExternalStore } from 'react';
import { activeSync } from './index';

type Surface = { decide: 'closed' | 'looking' | 'open'; focus: SettingsPart | null };
/** Wohin in Einstellungen → Abgleich gesprungen wird. */
export type SettingsPart = 'top' | 'bilder' | 'key' | 'aside';

let state: Surface = { decide: 'closed', focus: null };
const listeners = new Set<() => void>();
const set = (change: Partial<Surface>) => {
  state = { ...state, ...change };
  for (const l of [...listeners]) l();
};

export function useSurface(): Surface {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** „Ansehen und entscheiden“: erst ein frischer Lauf („Wayfarer sieht nach …“), dann der Dialog. */
export async function openDecide(): Promise<void> {
  const sync = activeSync();
  if (!sync || state.decide !== 'closed') return;
  set({ decide: 'looking' });
  try {
    const view = await sync.engine.lookAgain();
    set({ decide: view.conflicts.length ? 'open' : 'closed' });
  } catch {
    set({ decide: 'closed' });
  }
}

export function closeDecide(): void {
  set({ decide: 'closed' });
}

/** Zu Einstellungen → Abgleich (und dort zu einem Teil). */
export function showSyncSettings(navigate: (to: string) => void, part: SettingsPart = 'top') {
  set({ focus: part });
  navigate('/einstellungen');
}

/** Der Abschnitt nimmt den Sprung entgegen (einmal). */
export function takeFocus(): SettingsPart | null {
  const part = state.focus;
  if (part) set({ focus: null });
  return part;
}
