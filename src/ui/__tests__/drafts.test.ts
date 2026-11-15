import { describe, expect, it } from 'vitest';
import { hasOpenDrafts, holdDraft, subscribeDrafts } from '../drafts';

describe('Register offener Entwürfe', () => {
  it('hält und gibt frei, auch mehrfach, und meldet jede Änderung', () => {
    let calls = 0;
    const off = subscribeDrafts(() => calls++);
    expect(hasOpenDrafts()).toBe(false);
    const a = holdDraft('feld');
    const b = holdDraft('feld');
    expect(hasOpenDrafts()).toBe(true);
    a();
    a();
    expect(hasOpenDrafts()).toBe(true);
    b();
    expect(hasOpenDrafts()).toBe(false);
    expect(calls).toBe(4);
    off();
    holdDraft('dialog')();
    expect(calls).toBe(4);
  });
});
