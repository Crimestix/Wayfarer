import { describe, expect, it } from 'vitest';
import { createVersion, type ArticleVersion } from '../schema';
import {
  KEEP_MOST,
  KEEP_RECENT,
  diffSize,
  foldDiff,
  lineDiff,
  pruneVersions,
  shouldKeepVersion,
  trashOf,
  versionRows,
  versionsOf,
} from '../versions';

const at = (day: number, hour = 12, minute = 0): string =>
  new Date(2026, 10, day, hour, minute).toISOString();

const version = (init: Partial<ArticleVersion> & { savedAt: string }): ArticleVersion =>
  createVersion({ articleId: 'hohenfurt', docId: 'seite', text: 'Ein Dorf.', ...init });

describe('Wann eine Fassung entsteht', () => {
  const input = { docId: 'seite', previousText: 'Ein Dorf an der Furt.', now: at(14, 12, 0) };

  it('immer bei der ersten Änderung', () => {
    expect(shouldKeepVersion([], input)).toBe(true);
  });

  it('nicht für einen leeren Text', () => {
    expect(shouldKeepVersion([], { ...input, previousText: '  \n' })).toBe(false);
  });

  it('höchstens eine je Seite und zehn Minuten – die erste bleibt', () => {
    const first = version({ savedAt: at(14, 11, 55) });
    expect(shouldKeepVersion([first], input)).toBe(false);
    expect(shouldKeepVersion([first], { ...input, now: at(14, 12, 5) })).toBe(true);
    // Eine andere Seite desselben Artikels hat ihre eigene Zeit.
    expect(shouldKeepVersion([first], { ...input, docId: 'geschichte' })).toBe(true);
  });

  it('nicht, wenn die letzte Fassung schon genau so lautet – auch nicht erzwungen', () => {
    const same = version({ savedAt: at(13), text: input.previousText });
    expect(shouldKeepVersion([same], input)).toBe(false);
    expect(shouldKeepVersion([same], { ...input, force: true })).toBe(false);
  });

  it('erzwungen (vor dem Zurückholen) auch innerhalb der zehn Minuten', () => {
    const recent = version({ savedAt: at(14, 11, 58) });
    expect(shouldKeepVersion([recent], { ...input, force: true })).toBe(true);
  });

  it('der Papierkorb zählt nicht als letzte Fassung', () => {
    const trash = version({ savedAt: at(14, 11, 59), reason: 'delete', docId: null });
    expect(shouldKeepVersion([trash], { ...input, docId: null })).toBe(true);
  });
});

describe('Ausdünnen', () => {
  it('lässt wenige Fassungen unberührt', () => {
    const few = Array.from({ length: 5 }, (_, i) => version({ savedAt: at(14, 8 + i) }));
    expect(pruneVersions(few)).toEqual([]);
  });

  it('behält die jüngsten 20, von den älteren nur die letzte je Tag', () => {
    // 20 an einem Tag, davor drei Tage mit je drei Fassungen.
    const recent = Array.from({ length: KEEP_RECENT }, (_, i) =>
      version({ savedAt: at(14, 0, i * 30) }),
    );
    const older = [10, 11, 12].flatMap((day) =>
      [9, 13, 18].map((hour) => version({ savedAt: at(day, hour) })),
    );
    const drop = new Set(pruneVersions([...older, ...recent]));
    expect(recent.every((v) => !drop.has(v.id))).toBe(true);
    const kept = older.filter((v) => !drop.has(v.id));
    expect(kept.map((v) => new Date(v.savedAt).getHours())).toEqual([18, 18, 18]);
    expect(drop.size).toBe(6);
  });

  it('je Seite eine je Tag – zwei Seiten nehmen sich nichts weg', () => {
    const recent = Array.from({ length: KEEP_RECENT }, (_, i) =>
      version({ savedAt: at(14, 0, i * 30) }),
    );
    const first = version({ savedAt: at(10, 18) });
    const second = version({ savedAt: at(10, 9), docId: 'zweite' });
    const earlier = version({ savedAt: at(10, 8), docId: 'zweite' });
    const drop = pruneVersions([...recent, first, second, earlier]);
    expect(drop).toEqual([earlier.id]);
  });

  it(`nie mehr als ${KEEP_MOST} – die ältesten fallen weg`, () => {
    const daily = Array.from({ length: 90 }, (_, i) =>
      version({ savedAt: new Date(2026, 0, 1 + i, 12).toISOString() }),
    );
    const drop = new Set(pruneVersions(daily));
    const kept = daily.filter((v) => !drop.has(v.id));
    expect(kept).toHaveLength(KEEP_MOST);
    expect(kept[0]!.savedAt).toBe(daily[30]!.savedAt);
  });

  it('rührt den Papierkorb nicht an', () => {
    const many = Array.from({ length: 70 }, (_, i) =>
      version({ savedAt: new Date(2026, 0, 1 + i, 12).toISOString() }),
    );
    const trash = version({ savedAt: at(1), reason: 'delete' });
    expect(pruneVersions([...many, trash])).not.toContain(trash.id);
  });
});

describe('Papierkorb und Liste', () => {
  const article = { title: 'Salzgrotte' } as const;
  const deleted = (articleId: string, savedAt: string) =>
    version({
      articleId,
      savedAt,
      reason: 'delete',
      docId: null,
      article: {
        id: articleId,
        rev: 1,
        created: '',
        updated: '',
        title: article.title,
        parentId: null,
        order: 'V',
        aliases: [],
        tags: [],
        icon: '',
        banner: null,
        hidden: false,
        template: false,
        autoLink: true,
        dismissedHints: [],
        aiHints: [],
        aiRead: null,
        sidebar: [],
        docs: [],
        source: 'wayfarer',
      },
    });

  it('zeigt nur gelöschte Artikel, die es nicht wieder gibt – je Artikel das letzte Löschen', () => {
    const a = deleted('salzgrotte', at(10));
    const b = deleted('salzgrotte', at(12));
    const c = deleted('graufels', at(11));
    const edit = version({ articleId: 'salzgrotte', savedAt: at(9) });
    const versions = Object.fromEntries([a, b, c, edit].map((v) => [v.id, v]));
    expect(trashOf({ versions, articles: {} }).map((v) => v.id)).toEqual([b.id, c.id]);
    const back = { graufels: c.article! };
    expect(trashOf({ versions, articles: back }).map((v) => v.id)).toEqual([b.id]);
    expect(versionsOf({ versions }, 'salzgrotte').map((v) => v.id)).toEqual([edit.id]);
  });

  it('nennt je Fassung, wie groß die Änderung danach war', () => {
    const old = version({ savedAt: at(10), text: 'Ein Dorf.' });
    const mid = version({ savedAt: at(11), text: 'Ein Dorf.\nMit Mühle.' });
    const rows = versionRows([old, mid], () => 'Ein Dorf an der Furt.\nMit Mühle.\nUnd Brücke.');
    expect(rows.map((r) => r.version.id)).toEqual([mid.id, old.id]);
    expect(rows[0]!.change).toEqual({ added: 2, removed: 1 });
    expect(rows[1]!.change).toEqual({ added: 1, removed: 0 });
    expect(rows.every((r) => r.pageExists && !r.sameAsNow)).toBe(true);
    const gone = versionRows([old], () => null)[0]!;
    expect(gone.pageExists).toBe(false);
  });
});

describe('Zeilenweiser Vergleich', () => {
  it('erkennt gleiche, entfernte und hinzugefügte Zeilen', () => {
    const before = ['Hohenfurt', 'Ein Dorf.', 'Mira wohnt hier.', 'Ende'].join('\n');
    const after = ['Hohenfurt', 'Ein Dorf an der Furt.', 'Mira wohnt hier.', 'Odo auch.', 'Ende'];
    expect(lineDiff(before, after.join('\n'))).toEqual([
      { kind: 'same', text: 'Hohenfurt' },
      { kind: 'removed', text: 'Ein Dorf.' },
      { kind: 'added', text: 'Ein Dorf an der Furt.' },
      { kind: 'same', text: 'Mira wohnt hier.' },
      { kind: 'added', text: 'Odo auch.' },
      { kind: 'same', text: 'Ende' },
    ]);
  });

  it('kommt mit leeren Texten zurecht', () => {
    expect(lineDiff('', '')).toEqual([]);
    expect(lineDiff('', 'Neu')).toEqual([{ kind: 'added', text: 'Neu' }]);
    expect(lineDiff('Alt', '')).toEqual([{ kind: 'removed', text: 'Alt' }]);
  });

  it('findet die längste gemeinsame Folge auch bei Verschiebungen', () => {
    const diff = lineDiff('a\nb\nc\nd', 'b\nc\na\nd');
    expect(diff.filter((l) => l.kind === 'same').map((l) => l.text)).toEqual(['b', 'c', 'd']);
    expect(diffSize('a\nb\nc\nd', 'b\nc\na\nd')).toEqual({ added: 1, removed: 1 });
  });

  it('zählt Leerzeilen nicht als Änderung', () => {
    expect(diffSize('Eins\nZwei', 'Eins\n\n\nZwei')).toEqual({ added: 0, removed: 0 });
  });

  it('bleibt bei sehr langen Texten schnell und richtig', () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `Zeile ${i}`);
    const changed = [...lines];
    changed[1500] = 'Geändert';
    const diff = lineDiff(lines.join('\n'), changed.join('\n'));
    expect(diff.filter((l) => l.kind !== 'same')).toEqual([
      { kind: 'removed', text: 'Zeile 1500' },
      { kind: 'added', text: 'Geändert' },
    ]);
  });

  it('kürzt lange gleiche Strecken auf den Rand um jede Änderung', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Z${i}`);
    const changed = [...lines];
    changed[10] = 'neu';
    const parts = foldDiff(lineDiff(lines.join('\n'), changed.join('\n')), 2);
    expect(parts[0]).toEqual({ kind: 'gap', count: 8 });
    expect(parts.at(-1)).toEqual({ kind: 'gap', count: 7 });
    expect(parts.filter((p) => p.kind === 'same')).toHaveLength(4);
  });

  it('zeigt kurze gleiche Strecken lieber, als sie zu kürzen', () => {
    const parts = foldDiff(
      lineDiff(['a', 'b', 'c', 'd'].join('\n'), ['a', 'b', 'c', 'D'].join('\n')),
      2,
    );
    expect(parts.map((p) => p.kind)).toEqual(['same', 'same', 'same', 'removed', 'added']);
  });
});
