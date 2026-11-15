import { describe, expect, it } from 'vitest';
import {
  blobSha,
  compareWithoutBase,
  countChanges,
  hasCampaignFiles,
  isSyncedPath,
  massKey,
  planSync,
  type Sha,
  type SyncLists,
  type SyncStep,
} from '../sync';

const map = (o: Record<string, Sha>) => new Map(Object.entries(o));

function lists(
  g: Record<string, Sha> | null,
  h: Record<string, Sha>,
  d: Record<string, Sha>,
  more: Partial<SyncLists> = {},
): SyncLists {
  return {
    base: g ? map(g) : null,
    local: map(h),
    remote: map(d),
    hold: new Set(),
    localTexts: new Map(),
    older: false,
    ...more,
  };
}

const P = 'events/x.json';
/** Der Schritt für einen Pfad bei G, H, D („“ = fehlt). */
function stepFor(g: string, h: string, d: string, more: Partial<SyncLists> = {}, path = P) {
  const pick = (v: string): Record<string, Sha> => (v ? { [path]: v } : {});
  const plan = planSync(lists(pick(g), pick(h), pick(d), more), new Set());
  return plan.steps.find((s) => s.path === path) ?? null;
}

describe('Muster der abgeglichenen Pfade', () => {
  it('nimmt nur campaign.json, state.json und <ordner>/<kennung>.json', () => {
    for (const ok of ['entities/abc.json', 'entities/Abc-1_x.json', 'campaign.json', 'state.json'])
      expect(isSyncedPath(ok), ok).toBe(true);
    for (const no of [
      'Entities/a.json',
      'a.json',
      'entities/a.JSON',
      'entities/ä.json',
      'entities/Aldric (Konfliktkopie 2).json',
      'entities/sub/a.json',
      'media/x.png',
      '.abgleich/stand.json',
      'wayfarer.json',
      'README.md',
      `entities/${'x'.repeat(65)}.json`,
      `${'a'.repeat(33)}/x.json`,
    ])
      expect(isSyncedPath(no), no).toBe(false);
  });

  it('erkennt Teile eines Spielstands', () => {
    expect(hasCampaignFiles([])).toBe(false);
    expect(hasCampaignFiles(['desktop.ini', 'notiz.txt'])).toBe(false);
    expect(hasCampaignFiles(['entities/a.json'])).toBe(true);
  });
});

describe('Kennung wie bei Git', () => {
  it('stimmt mit den Prüfwerten überein', async () => {
    expect(await blobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(await blobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    expect(await blobSha('ä\n')).toBe('8be8316c70848caa99b9b3086c64976e82d1c17d');
    expect(await blobSha('﻿hello\n')).toBe('c2d46024e14dbd9078bb0aafcf920bb8e7216455');
  });
});

describe('Dreiwege-Entscheidung je Pfad', () => {
  it('folgt den 14 Zeilen der Tabelle', () => {
    const cases: [string, string, string, Partial<SyncStep> | null][] = [
      ['a', 'a', 'a', null],
      ['', 'a', 'a', { do: 'settle', sha: 'a' }],
      ['a', 'b', 'b', { do: 'settle', sha: 'b' }],
      ['a', '', '', { do: 'settle', sha: null }],
      ['', 'a', '', { do: 'push' }],
      ['a', 'b', 'a', { do: 'push' }],
      ['a', '', 'a', { do: 'pushDelete' }],
      ['', '', 'a', { do: 'pull' }],
      ['a', 'a', 'b', { do: 'pull' }],
      ['a', 'a', '', { do: 'pullDelete' }],
      ['a', 'b', 'c', { do: 'merge' }],
      ['', 'a', 'b', { do: 'merge' }],
      ['a', 'b', '', { do: 'clash', kind: 'deletedThere' }],
      ['a', '', 'b', { do: 'clash', kind: 'deletedHere' }],
    ];
    for (const [g, h, d, expected] of cases) {
      const step = stepFor(g, h, d);
      if (expected === null) expect(step, `${g}|${h}|${d}`).toBeNull();
      else expect(step, `${g}|${h}|${d}`).toMatchObject(expected);
    }
  });

  it('ausgelassen schlägt jede Zeile', () => {
    const hold = new Set([P]);
    for (const [g, h, d] of [
      ['', 'a', ''],
      ['a', 'a', 'b'],
      ['a', 'b', 'c'],
      ['a', '', 'a'],
    ] as const)
      expect(stepFor(g, h, d, { hold })).toEqual({ do: 'hold', path: P, why: 'frozen' });
  });

  it('campaign.json und state.json werden nie gelöscht', () => {
    for (const path of ['campaign.json', 'state.json']) {
      for (const [g, h, d] of [
        ['a', '', 'a'],
        ['a', 'a', ''],
        ['a', 'b', ''],
        ['a', '', 'b'],
      ] as const) {
        const pick = (v: string): Record<string, Sha> => (v ? { [path]: v } : {});
        const plan = planSync(lists(pick(g), pick(h), pick(d)), new Set());
        expect(plan.broken).toBe(path);
        expect(plan.steps).toEqual([{ do: 'hold', path, why: 'frozen' }]);
      }
    }
  });

  it('wirft ohne gemeinsamen Stand', () => {
    expect(() => planSync(lists(null, {}, {}), new Set())).toThrow();
  });

  it('ein abgebrochener Lauf (H = D ≠ G) wird nur nachgezogen', () => {
    expect(stepFor('alt', 'neu', 'neu')).toEqual({ do: 'settle', path: P, sha: 'neu' });
  });
});

describe('„verweist“', () => {
  it('dort gelöscht, hier verweist eine neue Chronikzeile darauf → Rückfrage', () => {
    const plan = planSync(
      lists(
        { 'entities/brann.json': 'b' },
        { 'entities/brann.json': 'b', 'chronicle/c1.json': 'c' },
        {},
        { localTexts: new Map([['chronicle/c1.json', '{"refs":["brann"]}']]) },
      ),
      new Set(),
    );
    expect(plan.steps).toContainEqual({
      do: 'clash',
      path: 'entities/brann.json',
      kind: 'referenced',
      by: 'chronicle/c1.json',
    });
  });

  it('ohne Verweis wird hier gelöscht', () => {
    const plan = planSync(
      lists(
        { 'entities/brann.json': 'b' },
        { 'entities/brann.json': 'b', 'chronicle/c1.json': 'c' },
        {},
        { localTexts: new Map([['chronicle/c1.json', '{"refs":["anders"]}']]) },
      ),
      new Set(),
    );
    expect(plan.steps).toContainEqual({ do: 'pullDelete', path: 'entities/brann.json' });
  });
});

describe('Sehr viel auf einmal', () => {
  const many = (n: number, sha = 'a') =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`events/e${i}.json`, sha]));

  it('21 Löschungen hier → eine Gruppe; 20 → keine', () => {
    const plan = planSync(lists(many(21), {}, many(21)), new Set());
    expect(plan.mass).toHaveLength(1);
    expect(plan.mass[0]!.kind).toBe('deleteHere');
    expect(plan.steps.every((s) => s.do === 'hold' && s.why === 'mass')).toBe(true);
    const fine = planSync(lists(many(20), {}, many(20)), new Set());
    expect(fine.mass).toEqual([]);
    expect(fine.steps.every((s) => s.do === 'pushDelete')).toBe(true);
  });

  it('21 Löschungen dort und 101 Änderungen hier', () => {
    expect(planSync(lists(many(21), many(21), {}), new Set()).mass[0]!.kind).toBe('deleteThere');
    const changed = planSync(lists(many(101), many(101, 'b'), many(101)), new Set());
    expect(changed.mass[0]!.kind).toBe('changeHere');
    expect(planSync(lists(many(100), many(100, 'b'), many(100)), new Set()).mass).toEqual([]);
  });

  it('die Antwort gilt nur für dieselbe Pfadmenge', () => {
    const plan = planSync(lists(many(25), {}, many(25)), new Set());
    const ok = new Set([plan.mass[0]!.key]);
    const again = planSync(lists(many(25), {}, many(25)), ok);
    expect(again.mass).toEqual([]);
    expect(again.steps.every((s) => s.do === 'pushDelete')).toBe(true);
    const more = planSync(lists(many(26), {}, many(26)), ok);
    expect(more.mass).toHaveLength(1);
    expect(massKey('deleteHere', ['b', 'a'])).toBe(massKey('deleteHere', ['a', 'b']));
  });
});

describe('Modus „nur holen“', () => {
  it('erlaubt nur 2–4 und 8–10', () => {
    const older = { older: true };
    expect(stepFor('', '', 'a', older)).toMatchObject({ do: 'pull' });
    expect(stepFor('a', 'a', 'b', older)).toMatchObject({ do: 'pull' });
    expect(stepFor('a', 'a', '', older)).toMatchObject({ do: 'pullDelete' });
    expect(stepFor('', 'a', 'a', older)).toMatchObject({ do: 'settle' });
    for (const [g, h, d] of [
      ['', 'a', ''],
      ['a', 'b', 'a'],
      ['a', '', 'a'],
      ['a', 'b', 'c'],
      ['a', 'b', ''],
      ['a', '', 'b'],
    ] as const)
      expect(stepFor(g, h, d, older)).toEqual({ do: 'hold', path: P, why: 'older' });
  });
});

describe('Ohne gemeinsamen Stand', () => {
  it('vergleicht beide Seiten', () => {
    expect(
      compareWithoutBase(
        map({ 'a/1.json': 'x', 'a/2.json': 'y', 'a/3.json': 'z' }),
        map({ 'a/1.json': 'x', 'a/2.json': 'q', 'a/4.json': 'w' }),
      ),
    ).toEqual({
      same: ['a/1.json'],
      different: ['a/2.json'],
      onlyLocal: ['a/3.json'],
      onlyRemote: ['a/4.json'],
    });
  });

  it('zählt Änderungen', () => {
    const steps: SyncStep[] = [
      { do: 'push', path: 'a/1.json' },
      { do: 'push', path: 'a/2.json' },
      { do: 'pull', path: 'a/3.json' },
      { do: 'pullDelete', path: 'a/4.json' },
    ];
    expect(countChanges(steps, map({ 'a/1.json': 'x', 'a/3.json': 'y' }))).toEqual({
      up: { changed: 1, added: 1, removed: 0 },
      down: { changed: 1, added: 0, removed: 1 },
    });
  });
});
