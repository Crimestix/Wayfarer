import { describe, expect, it } from 'vitest';
import { isDesktopApp, onAppClosing, settleBeforeClosing, type ClosingHandler } from '../platform';

describe('Schließen der installierten App', () => {
  it('gilt als gespeichert, wenn nichts angemeldet ist', async () => {
    expect(await settleBeforeClosing([])).toBe(true);
  });

  it('wartet auf alle angemeldeten Stellen', async () => {
    const order: string[] = [];
    const slow: ClosingHandler = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('langsam');
      return true;
    };
    const quick: ClosingHandler = async () => {
      order.push('schnell');
      return true;
    };
    expect(await settleBeforeClosing([slow, quick])).toBe(true);
    expect(order).toEqual(['schnell', 'langsam']);
  });

  it('meldet „nicht gespeichert“, wenn eine Stelle scheitert oder etwas offen bleibt', async () => {
    const saved: ClosingHandler = async () => true;
    const pending: ClosingHandler = async () => false;
    const broken: ClosingHandler = async () => {
      throw new Error('Laufwerk nicht erreichbar');
    };
    expect(await settleBeforeClosing([saved, pending])).toBe(false);
    expect(await settleBeforeClosing([saved, broken])).toBe(false);
  });

  it('lässt sich an- und wieder abmelden, auch außerhalb der installierten App', () => {
    expect(isDesktopApp()).toBe(false);
    const off = onAppClosing(async () => true);
    expect(() => off()).not.toThrow();
  });
});
