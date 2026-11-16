import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_RULES,
  STATE_RULES,
  checkIncoming,
  fillStripped,
  fillStrippedFile,
  mergeFile,
  mergeJson,
  sameIgnoringStamps,
  type Json,
} from '../syncMerge';
import { createStory } from '../schema';

const NOW = '2026-11-15T21:40:00.000Z';
const text = (v: unknown) => JSON.stringify(v, null, 1) + '\n';

const state = (more: Record<string, Json> = {}): Json => ({
  id: 'state',
  rev: 4,
  now: 1000,
  previousNow: null,
  placeId: 'hohenfurt',
  sessionId: null,
  watch: ['a'],
  board: { 'story:s1': { x: 1, y: 1 }, 'story:s2': { x: 5, y: 5 } },
  twinsApart: [],
  netBoard: {},
  march: [],
  travelBy: null,
  continuityOk: [],
  nameMemory: true,
  timelineLanes: null,
  recapDismissed: null,
  updated: '2026-11-14T10:00:00.000Z',
  ...more,
});

describe('state.json', () => {
  it('PC verschiebt eine Karte, Mac stellt die Zeit vor → beides, keine Rückfrage', () => {
    const base = state();
    const pc = state({ board: { 'story:s1': { x: 9, y: 9 }, 'story:s2': { x: 5, y: 5 } } });
    const mac = state({ now: 5000, previousNow: 1000 });
    const { value, clashes } = mergeJson(base, pc, mac, STATE_RULES, undefined, NOW);
    expect(clashes).toEqual([]);
    expect(value).toMatchObject({
      now: 5000,
      previousNow: 1000,
      board: { 'story:s1': { x: 9, y: 9 } },
      rev: 5,
      updated: NOW,
    });
  });

  it('beide stellen die Zeit verschieden → ein Widerspruch der Gruppe „time“; Wahl nimmt beide Felder', () => {
    const base = state();
    const pc = state({ now: 2000, previousNow: 1000 });
    const mac = state({ now: 9000, previousNow: 1000 });
    const { clashes } = mergeJson(base, pc, mac, STATE_RULES, undefined, NOW);
    expect(clashes).toEqual([
      {
        at: ['now'],
        group: 'time',
        local: { now: 2000, previousNow: 1000 },
        remote: { now: 9000, previousNow: 1000 },
      },
    ]);
    const chosen = mergeJson(base, pc, mac, STATE_RULES, { side: 'remote', at: [['now']] }, NOW);
    expect(chosen.clashes).toEqual([]);
    expect(chosen.value).toMatchObject({ now: 9000, previousNow: 1000 });
  });

  it('PC stellt Zeit vor, Mac startet nur die Session → kein Widerspruch', () => {
    const { value, clashes } = mergeJson(
      state(),
      state({ now: 3000, previousNow: 1000 }),
      state({ sessionId: 's13' }),
      STATE_RULES,
      undefined,
      NOW,
    );
    expect(clashes).toEqual([]);
    expect(value).toMatchObject({ now: 3000, sessionId: 's13' });
  });

  it('„Reist mit“ beidseits verschieden → Rückfrage, nicht „jüngeres updated“', () => {
    const { clashes } = mergeJson(
      state(),
      state({ travelBy: 'pferd' }),
      state({ travelBy: 'kahn', updated: '2026-11-15T00:00:00.000Z' }),
      STATE_RULES,
    );
    expect(clashes).toMatchObject([{ at: ['travelBy'], local: 'pferd', remote: 'kahn' }]);
  });

  it('getrennte Gruppe: Weltzeit und geleitete Teilgruppe gelten nur zusammen', () => {
    // Zwei Teilgruppen; die Zeit am Tisch (`now`) ist die der geleiteten.
    const groups = (leadNow: number) => [
      { id: 'g1', memberIds: ['arn'], placeId: 'hohenfurt', now: leadNow, doing: null },
      { id: 'g2', memberIds: ['bela'], placeId: 'archiv', now: 4000, doing: null },
    ];
    const base = state({ groups: groups(1000), leadId: 'g1' });
    // PC schaltet auf Bela um (ihre Zeit gilt jetzt am Tisch), Mac lässt bei Arn Zeit vergehen.
    const pc = state({ groups: groups(1000), leadId: 'g2', now: 4000, placeId: 'archiv' });
    const mac = state({ groups: groups(1000), leadId: 'g1', now: 2000, previousNow: 1000 });
    const { clashes } = mergeJson(base, pc, mac, STATE_RULES, undefined, NOW);
    // Nie Belas Teilgruppe mit Arns Zeit: ein Widerspruch der Weltzeit, der alles zusammen wählt.
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({ at: ['now'], group: 'time' });
    const chosen = mergeJson(base, pc, mac, STATE_RULES, { side: 'remote', at: [['now']] }, NOW);
    expect(chosen.clashes).toEqual([]);
    expect(chosen.value).toMatchObject({ now: 2000, leadId: 'g1', placeId: 'hohenfurt' });
    // Zusammen (keine Teilgruppen) bleibt es wie bisher: Ort hier, Zeit dort, keine Rückfrage.
    const together = mergeJson(
      state(),
      state({ placeId: 'archiv' }),
      state({ now: 2000, previousNow: 1000 }),
      STATE_RULES,
      undefined,
      NOW,
    );
    expect(together.clashes).toEqual([]);
    expect(together.value).toMatchObject({ now: 2000, placeId: 'archiv' });
  });

  it('Mengen und dieselbe Karte auf beiden Seiten → jüngeres updated', () => {
    const base = state({ watch: ['a', 'b'] });
    const pc = state({
      watch: ['a', 'c'],
      board: { 'story:s1': { x: 2, y: 2 }, 'story:s2': { x: 5, y: 5 } },
      updated: '2026-11-15T10:00:00.000Z',
    });
    const mac = state({
      watch: ['a', 'b', 'd'],
      board: { 'story:s1': { x: 3, y: 3 }, 'story:s2': { x: 6, y: 6 } },
      updated: '2026-11-15T11:00:00.000Z',
    });
    const { value, clashes } = mergeJson(base, pc, mac, STATE_RULES, undefined, NOW);
    expect(clashes).toEqual([]);
    expect((value as { watch: string[] }).watch.sort()).toEqual(['a', 'c', 'd']);
    expect(value).toMatchObject({
      board: { 'story:s1': { x: 3, y: 3 }, 'story:s2': { x: 6, y: 6 } },
    });
  });
});

describe('gewöhnliche Dokumente', () => {
  const story = () =>
    createStory({
      title: 'Die Salzgrotte',
      scenes: [
        {
          id: 'sc1',
          text: 'Der Überfall',
          encounterId: null,
          odds: 'maybe',
          placeId: null,
          done: false,
        },
        {
          id: 'sc2',
          text: 'Die Flucht',
          encounterId: null,
          odds: 'maybe',
          placeId: null,
          done: false,
        },
      ],
    }) as unknown as Record<string, Json>;

  it('Szene abgehakt hier, Zusammenfassung dort → zusammen', () => {
    const base = story();
    const id = (base as { id: string }).id;
    const path = `stories/${id}.json`;
    const pc = structuredClone(base) as { scenes: { done: boolean }[] };
    pc.scenes[0]!.done = true;
    const mac = { ...base, summary: 'Der Wirt will die Grotte für sich.' };
    const result = mergeFile(path, text(base), text(pc), text(mac), undefined, NOW);
    expect(result.kind).toBe('merged');
    const merged = JSON.parse((result as { content: string }).content);
    expect(merged.scenes[0].done).toBe(true);
    expect(merged.summary).toBe('Der Wirt will die Grotte für sich.');
    // Zweimal zusammenführen ergibt dasselbe.
    expect(mergeFile(path, text(base), text(pc), text(mac), undefined, NOW)).toEqual(result);
  });

  it('Listen mit id: beidseits hinzugefügt, Entfernen gegen Ändern, Umordnen', () => {
    const base = story();
    const add = (s: Json, id: string) => ({
      ...(s as object),
      scenes: [...(s as { scenes: Json[] }).scenes, { id, text: id, done: false }],
    });
    const both = mergeJson(base, add(base, 'h'), add(base, 'd'), {}, undefined, NOW);
    expect(both.clashes).toEqual([]);
    expect((both.value as { scenes: { id: string }[] }).scenes.map((s) => s.id).sort()).toEqual([
      'd',
      'h',
      'sc1',
      'sc2',
    ]);

    const removed = {
      ...(base as object),
      scenes: [(base as { scenes: Json[] }).scenes[1]],
    } as Json;
    const changed = structuredClone(base) as { scenes: { text: string }[] };
    changed.scenes[0]!.text = 'Der große Überfall';
    expect(mergeJson(base, removed, changed as Json).clashes).toMatchObject([
      { at: ['scenes', 'sc1'] },
    ]);

    const s = (base as { scenes: Json[] }).scenes;
    const reversed = { ...(base as object), scenes: [s[1], s[0]] } as Json;
    const withNew = { ...(base as object), scenes: [s[0], s[1], { id: 'x', text: 'x' }] } as Json;
    // Nur eine Seite ordnet um → ohne Rückfrage.
    expect(mergeJson(base, reversed, withNew).clashes).toEqual([]);
    const otherOrder = {
      ...(base as object),
      scenes: [s[1], { id: 'x', text: 'x' }, s[0]],
    } as Json;
    const reversedWithY = {
      ...(base as object),
      scenes: [{ id: 'y', text: 'y' }, s[1], s[0]],
    } as Json;
    expect(mergeJson(base, reversedWithY, otherOrder).clashes).toEqual([]);
  });

  it('Umordnen beidseits verschieden → Widerspruch für die Liste', () => {
    const list = (...ids: string[]) => ({ id: 'x', items: ids.map((id) => ({ id })) });
    const { clashes } = mergeJson(list('a', 'b', 'c'), list('b', 'a', 'c'), list('a', 'c', 'b'));
    expect(clashes).toMatchObject([{ at: ['items'] }]);
  });

  it('Seitentext beidseits → Widerspruch; nur rev/updated verschieden → take', () => {
    const doc = (t: string, rev = 1) => ({
      id: 'p1',
      title: 'Tannhaus',
      text: t,
      rev,
      updated: 'x',
    });
    const r = mergeFile('articles/p1.json', text(doc('a')), text(doc('b')), text(doc('c')));
    expect(r.kind).toBe('clash');
    expect(mergeFile('articles/p1.json', null, text(doc('a', 3)), text(doc('a', 5)))).toEqual({
      kind: 'take',
      side: 'remote',
    });
    expect(mergeFile('articles/p1.json', null, text(doc('a', 6)), text(doc('a', 5)))).toEqual({
      kind: 'take',
      side: 'local',
    });
    expect(sameIgnoringStamps(doc('a', 1), doc('a', 9))).toBe(true);
  });

  it('ein unbekanntes Feld auf einer Seite bleibt im Ergebnis', () => {
    const base = story();
    const id = (base as { id: string }).id;
    const pc = { ...base, summary: 'neu' };
    const mac = { ...base, neuesFeld: { tief: [1, 2] } };
    const r = mergeFile(`stories/${id}.json`, text(base), text(pc), text(mac), undefined, NOW);
    expect(r.kind).toBe('merged');
    expect(JSON.parse((r as { content: string }).content).neuesFeld).toEqual({ tief: [1, 2] });
  });

  it('choose löst nur die genannten Angaben; ein neuer Widerspruch anderswo bleibt', () => {
    const base = { id: 'x', a: 1, b: 1 };
    const pc = { id: 'x', a: 2, b: 2 };
    const mac = { id: 'x', a: 3, b: 3 };
    const { value, clashes } = mergeJson(base, pc, mac, {}, { side: 'remote', at: [['a']] });
    expect(value).toMatchObject({ a: 3, b: 2 });
    expect(clashes).toMatchObject([{ at: ['b'] }]);
  });

  it('Schema verletzt → invalid; unbekannte Sammlung → unknown; ohne Basis → noBase', () => {
    const base = story();
    const id = (base as { id: string }).id;
    const path = `stories/${id}.json`;
    const bad = mergeFile(
      path,
      text(base),
      text({ ...base, title: 5 }),
      text({ ...base, summary: 'x' }),
    );
    expect(bad).toEqual({ kind: 'whole', why: 'invalid' });
    expect(mergeFile('zukunft/a.json', '{"a":1}', '{"a":2}', '{"a":3}')).toEqual({
      kind: 'whole',
      why: 'unknown',
    });
    expect(mergeFile(path, null, text(base), text({ ...base, summary: 'x' }))).toEqual({
      kind: 'whole',
      why: 'noBase',
    });
    expect(mergeFile(path, text(base), 'kaputt', text(base))).toEqual({
      kind: 'whole',
      why: 'invalid',
    });
  });
});

describe('campaign.json', () => {
  const campaign = (more: Record<string, Json> = {}): Json => ({
    id: 'campaign',
    schema: 1,
    rev: 1,
    name: 'Tannhaus',
    calendar: { months: ['Eins', 'Zwei'], weekDays: 7 },
    tableRules: 'Zeile 1',
    ages: [
      { id: 'a1', name: 'Erstes Zeitalter' },
      { id: 'a2', name: 'Zweites Zeitalter' },
    ],
    ...more,
  });

  it('Kalender als Ganzes; Zeitalter je Kennung; Regeln des Tisches beidseits → Widerspruch', () => {
    const cal = mergeJson(
      campaign(),
      campaign({ calendar: { months: ['Eins', 'Drei'], weekDays: 7 } }),
      campaign({ calendar: { months: ['Eins', 'Zwei'], weekDays: 8 } }),
      CAMPAIGN_RULES,
    );
    expect(cal.clashes).toMatchObject([{ at: ['calendar'] }]);

    const ages = mergeJson(
      campaign(),
      campaign({
        ages: [
          { id: 'a1', name: 'Zeit der Riesen' },
          { id: 'a2', name: 'Zweites Zeitalter' },
        ],
      }),
      campaign({
        ages: [
          { id: 'a1', name: 'Erstes Zeitalter' },
          { id: 'a2', name: 'Zeit der Zwerge' },
        ],
      }),
      CAMPAIGN_RULES,
    );
    expect(ages.clashes).toEqual([]);
    expect(ages.value).toMatchObject({
      ages: [{ name: 'Zeit der Riesen' }, { name: 'Zeit der Zwerge' }],
    });

    const rules = mergeJson(
      campaign(),
      campaign({ tableRules: 'Zeile 1\nHier' }),
      campaign({ tableRules: 'Zeile 1\nDort' }),
      CAMPAIGN_RULES,
    );
    expect(rules.clashes).toMatchObject([{ at: ['tableRules'] }]);
  });
});

describe('Eingehendes prüfen', () => {
  it('gültig, Schema verletzt, Kennung ≠ Dateiname, unbekannte Sammlung', () => {
    const s = createStory({ title: 'Hohenfurt' });
    expect(checkIncoming(`stories/${s.id}.json`, text(s))).toEqual({ ok: true });
    expect(checkIncoming(`stories/${s.id}.json`, text({ ...s, title: 3 })).ok).toBe(false);
    expect(checkIncoming('stories/anders.json', text(s)).ok).toBe(false);
    expect(checkIncoming('zukunft/x.json', '{"was":"neu"}')).toEqual({ ok: true });
    expect(checkIncoming('zukunft/x.json', 'kein json').ok).toBe(false);
    expect(checkIncoming('media/x.png', '{}').ok).toBe(false);
  });
});

describe('Ergänzen nach dem Aktualisieren', () => {
  it('bringt Fehlendes zurück, aber nie Listenelemente, und überschreibt nichts', () => {
    const base: Json = {
      id: 'x',
      neu: 1,
      tief: { a: 1, neu: 2 },
      liste: [
        { id: 'l1', text: 'eins', neu: 3 },
        { id: 'l2', text: 'zwei' },
      ],
      text: 'alt',
    };
    const local: Json = {
      id: 'x',
      tief: { a: 5 },
      liste: [{ id: 'l1', text: 'EINS' }],
      text: 'neu',
    };
    expect(fillStripped(base, local)).toEqual({
      id: 'x',
      neu: 1,
      tief: { a: 5, neu: 2 },
      liste: [{ id: 'l1', text: 'EINS', neu: 3 }],
      text: 'neu',
    });
    expect(fillStrippedFile(text(base), text(base))).toBeNull();
    expect(fillStrippedFile(text(base), text(local))).not.toBeNull();
  });
});
