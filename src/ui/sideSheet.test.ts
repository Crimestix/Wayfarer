import { describe, expect, it } from 'vitest';
import { closeSheet, openSheet, sheetBack, sheetOpensAt, sheetStack } from './sideSheet';

describe('Seitenblatt', () => {
  it('legt Seiten aufeinander, führt zurück und schließt', () => {
    openSheet('a');
    openSheet('b');
    openSheet('b');
    expect(sheetStack()).toEqual(['a', 'b']);
    // Eine schon offene Seite kommt nach oben, statt doppelt zu liegen.
    openSheet('a');
    expect(sheetStack()).toEqual(['b', 'a']);
    sheetBack();
    expect(sheetStack()).toEqual(['b']);
    closeSheet();
    expect(sheetStack()).toEqual([]);
  });

  it('öffnet sich überall außer in der Welt', () => {
    expect(sheetOpensAt('/')).toBe(true);
    expect(sheetOpensAt('/faeden')).toBe(true);
    expect(sheetOpensAt('/geschichte/x')).toBe(true);
    expect(sheetOpensAt('/welt')).toBe(false);
    expect(sheetOpensAt('/welt/abc')).toBe(false);
    expect(sheetOpensAt('/wiki/abc')).toBe(false);
    expect(sheetOpensAt('/weltkarte')).toBe(true);
  });
});
