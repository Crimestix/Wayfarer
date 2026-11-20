import { describe, expect, it } from 'vitest';
import { claimShortcut, shortcutOwner } from './shortcuts';

describe('F17: ein Kürzel, eine Aktion', () => {
  it('ohne Arbeitsfläche gilt die Vorgabe der Leiste', () => {
    expect(shortcutOwner('e')).toBeNull();
  });

  it('die zuletzt angemeldete Fläche ist zuständig, nach dem Abmelden wieder die davor', () => {
    const calls: string[] = [];
    const page = claimShortcut('e', () => calls.push('Seite'));
    const sheet = claimShortcut('e', () => calls.push('Seitenblatt'));
    shortcutOwner('e')!();
    sheet();
    shortcutOwner('e')!();
    page();
    expect(calls).toEqual(['Seitenblatt', 'Seite']);
    expect(shortcutOwner('e')).toBeNull();
  });
});
