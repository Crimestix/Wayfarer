import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../../data/db';
import { elarisCampaign } from '../../../data/seed';
import { MemoryStore } from '../../../data/store';
import { ChronicleEntrySchema, SessionSchema, type CampaignData } from '../../../domain/schema';
import { MINUTES_PER_DAY } from '../../../domain/time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../../../domain/time/elaris';
import { takeOverSessions } from '../actions';
import {
  draftLines,
  editDraft,
  formatDays,
  placedTime,
  planSummary,
  sessionTimeText,
  sourcedSessions,
  takeOverPlan,
} from '../model';
import { placeSessions } from '../order';
import type { NotesFile } from '../read';
import { splitSessions } from '../split';

const cal = ELARIS_CALENDAR;
const now = ELARIS_START;
const DAY = MINUTES_PER_DAY;
const freshDb = () => CampaignDb.create(new MemoryStore(), elarisCampaign());

const txt = (text: string, name = 'hohenfurt.txt'): NotesFile => ({
  name,
  kind: 'txt',
  text,
  headings: [],
  encoding: 'utf-8',
});

const NOTES = [
  'Was vorher war: Mira Tannhaus hat die Gruppe angeheuert.',
  '',
  'Session 1 – Ankunft in Hohenfurt',
  'Die Gruppe kommt in Hohenfurt an.',
  'Lando Furtner bietet die Überfahrt an.',
  '',
  'Session 2',
  'Kampf gegen die Grubenschleicher.',
  '',
  'Sitzung vom 12.05.2026',
  'Krummzahn ist tot.',
].join('\n');

const draftsOf = (text = NOTES) => splitSessions([txt(text)], cal, now);
const plan = (data: CampaignData, text = NOTES) =>
  takeOverPlan(placeSessions(draftsOf(text), data), data);

describe('Entwürfe von Hand ändern', () => {
  it('setzt Nummer, Titel und Spielabend und meldet doppelte Nummern', () => {
    const drafts = draftsOf();
    const index = drafts.findIndex((d) => d.number === null && !d.vorspann);
    const changed = editDraft(drafts, index, {
      number: 2,
      title: '  Der Bau ',
      realDate: '2026-05-12',
    });
    expect(changed[index]).toMatchObject({ number: 2, title: 'Der Bau', realDate: '2026-05-12' });
    expect(changed[index]!.notes.some((n) => n.startsWith('Doppelt: '))).toBe(true);
    // Das Original bleibt, wie es war.
    expect(drafts[index]!.number).toBeNull();
  });

  it('macht aus „Session 3+4“ eine Session, wenn die Nummer geändert wird', () => {
    const drafts = draftsOf('Session 3+4\nViel passiert.');
    expect(drafts[0]!.lastNumber).toBe(4);
    const changed = editDraft(drafts, 0, { number: 3 });
    expect(changed[0]!.lastNumber).toBe(4);
    const other = editDraft(drafts, 0, { number: 5 });
    expect(other[0]).toMatchObject({ number: 5, lastNumber: null });
    expect(other[0]!.notes.some((n) => n.includes('in einem Abschnitt'))).toBe(false);
  });

  it('zeigt die Zeilen mit ihren Stellen und wo man trennen kann', () => {
    const [draft] = draftsOf('Session 1\nErste Zeile.\n\nSession 2 – vergessen\nWeiter.');
    expect(draft!.number).toBe(1);
    const merged = draftsOf('Session 1\nErste Zeile.\nZweite Zeile.')[0]!;
    expect(draftLines(merged)).toEqual([
      { text: 'Erste Zeile.', offset: 0, boundary: false, splittable: false },
      { text: 'Zweite Zeile.', offset: 13, boundary: false, splittable: true },
    ]);
    const lines = draftLines({ ...merged, text: 'Eins.\nSession 2\nZwei.' });
    expect(lines[1]).toMatchObject({ boundary: true, splittable: true, offset: 6 });
  });
});

describe('Weltzeit in Worten', () => {
  it('nennt Tage ohne Uhrzeit und sagt, woher die Zeit kommt', () => {
    const start = now - 5 * DAY - (now % DAY);
    expect(formatDays(cal, start, start + DAY)).toBe('12. Tauwind 701 AD');
    expect(formatDays(cal, start, start + 3 * DAY)).toBe('12.–14. Tauwind 701 AD');
    const placed = placeSessions(
      draftsOf('Session 1\nAm 3. Tauwind, Jahr 701.\nSession 2\nWeiter.'),
      {
        campaign: { calendar: cal },
        state: { now },
        sessions: {},
      },
    );
    expect(placedTime(cal, placed[0]!)).toEqual({
      text: '3. Tauwind 701 AD',
      tone: 'known',
      how: 'aus den Tagen in den Notizen',
    });
    expect(placedTime(cal, placed[1]!)).toMatchObject({ tone: 'order' });
  });
});

describe('Übernehmen', () => {
  it('plant neue Sessions vor der vorhandenen, schlägt Nummern vor und lässt den Vorspann weg', async () => {
    const data = (await freshDb()).getSnapshot();
    const result = plan(data);
    expect(result.items.map((i) => [i.action, i.number, i.numberProposed])).toEqual([
      ['skip', null, false],
      ['create', 1, false],
      ['create', 2, false],
      ['create', 3, true],
    ]);
    expect(result.ready).toBe(true);
    expect(result.problems).toEqual([]);
    // Alles liegt vor dem heutigen Stand der Welt und vor Session 12.
    for (const item of result.items.filter((i) => i.action === 'create'))
      expect(item.endAt).toBeLessThanOrEqual(now);
    expect(result.items[1]!.source).toEqual({
      file: 'hohenfurt.txt',
      text: 'Die Gruppe kommt in Hohenfurt an.\nLando Furtner bietet die Überfahrt an.',
      line: 3,
      precision: 'order',
    });
    expect(planSummary(result)).toBe('3 Sessions werden angelegt, der Vorspann bleibt weg');
  });

  it('hindert bei doppelten Nummern und bei einem Ende nach heute', async () => {
    const data = (await freshDb()).getSnapshot();
    const twice = plan(data, 'Session 1\nA.\nSession 1\nB.');
    expect(twice.ready).toBe(false);
    expect(twice.problems[0]).toContain('2-mal');
    const drafts = draftsOf('Session 1\nA.');
    const late = takeOverPlan(
      placeSessions(drafts, data, { [drafts[0]!.key]: { startAt: now - DAY, endAt: now + DAY } }),
      data,
    );
    expect(late.ready).toBe(false);
    expect(late.items[0]!.problem).toContain('heutigen Stand');
  });

  it('legt Sessions mit den Notizen wörtlich an, ohne Zeit vorzustellen – und nimmt es zurück', async () => {
    const db = await freshDb();
    const before = db.getSnapshot();
    const loose = db.put(
      'chronicle',
      ChronicleEntrySchema.parse({ id: 'frueher', at: 0, text: 'Ganz früher.' }),
    );
    const result = takeOverSessions(db, plan(before))!;
    expect(result.created).toHaveLength(3);
    const data = db.getSnapshot();
    expect(data.state.now).toBe(before.state.now);
    expect(data.state.sessionId).toBe(before.state.sessionId);
    const sessions = sourcedSessions(data);
    expect(sessions.map((s) => [s.number, s.title, s.realDate])).toEqual([
      [1, 'Ankunft in Hohenfurt', ''],
      [2, '', ''],
      [3, '', '2026-05-12'],
    ]);
    expect(sessions[2]!.source).toMatchObject({ text: 'Krummzahn ist tot.', line: 10 });
    expect(sessions[0]!.notes).toBe('');
    expect(sessionTimeText(cal, sessions[0]!)).toMatch(/^nur Reihenfolge – ungefähr /);
    expect(data.chronicle[loose.id]!.sessionId).toBeNull();

    // Noch einmal: alles schon da.
    const again = plan(data);
    expect(again.items.filter((i) => i.action !== 'skip').map((i) => i.action)).toEqual([
      'same',
      'same',
      'same',
    ]);
    expect(again.ready).toBe(false);

    result.undo();
    expect(sourcedSessions(db.getSnapshot())).toEqual([]);
    expect(Object.keys(db.getSnapshot().sessions)).toEqual(Object.keys(before.sessions));
  });

  it('gibt einer vorhandenen Session die Notizen und lässt ihre Zeit und Mitschrift', async () => {
    const db = await freshDb();
    const own = db.put(
      'sessions',
      SessionSchema.parse({
        id: 'elf',
        number: 11,
        startAt: now - 3 * DAY,
        endAt: now - 2 * DAY,
        notes: 'Meine Mitschrift.',
      }),
    );
    const data = db.getSnapshot();
    const result = plan(data, 'Session 11 – Der Salzkahn\nLando rudert.');
    expect(result.items[0]).toMatchObject({ action: 'attach', sessionId: own.id });
    const done = takeOverSessions(db, result)!;
    const session = db.getSnapshot().sessions[own.id]!;
    expect(session).toMatchObject({
      title: 'Der Salzkahn',
      notes: 'Meine Mitschrift.',
      startAt: now - 3 * DAY,
      endAt: now - 2 * DAY,
      source: { file: 'hohenfurt.txt', text: 'Lando rudert.', precision: 'exact' },
    });
    done.undo();
    expect(db.getSnapshot().sessions[own.id]).toMatchObject({ title: '', source: null });
  });

  it('lädt alte Sessions ohne die neuen Felder', () => {
    const old = SessionSchema.parse({ id: 'alt', number: 1, startAt: 0 });
    expect(old).toMatchObject({ source: null, recap: '', reading: null });
  });
});
