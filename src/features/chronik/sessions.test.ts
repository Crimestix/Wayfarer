/** Frühere Sessions nachtragen und die Zusammenfassung für die Spieler. */
import { describe, expect, it } from 'vitest';
import { addPastSession, logEntry, setAttitude, startSession } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { ChronicleEntrySchema, PARTY_ID, createEntity } from '../../domain/schema';
import { MINUTES_PER_DAY } from '../../domain/time/calendar';
import { ELARIS_START } from '../../domain/time/elaris';
import { isForPlayers, pastSessionProblem, sessionSummaryText, suggestPastSession } from './model';

const day = MINUTES_PER_DAY;
const freshDb = () => CampaignDb.create(new MemoryStore(), elarisCampaign());

describe('Frühere Session nachtragen', () => {
  it('schlägt die Nummer vor der frühesten Session und einen Tag davor vor', async () => {
    const db = await freshDb();
    // Der Grundstand beginnt mit Session 12.
    expect(suggestPastSession(db.getSnapshot())).toEqual({
      number: 11,
      startAt: ELARIS_START - day,
    });
  });

  it('prüft Nummer und Zeitraum', async () => {
    const data = (await freshDb()).getSnapshot();
    const ok = { number: 11, startAt: ELARIS_START - 2 * day, endAt: ELARIS_START - day };
    expect(pastSessionProblem(data, ok)).toBe('');
    expect(pastSessionProblem(data, { ...ok, number: 12 })).toBe('Session 12 gibt es schon.');
    expect(pastSessionProblem(data, { ...ok, endAt: ok.startAt - 1 })).toContain('vor dem Beginn');
    expect(pastSessionProblem(data, { ...ok, endAt: ELARIS_START + day })).toContain('Zukunft');
    expect(pastSessionProblem(data, { ...ok, startAt: null })).toContain('Beginn');
    expect(pastSessionProblem(data, { ...ok, number: 1.5 })).toContain('ganze Zahl');
  });

  it('legt die Session an, ohne die laufende zu stören, und sammelt herrenlose Einträge ein', async () => {
    const db = await freshDb();
    const running = db.getSnapshot().state.sessionId;
    const inside = db.put(
      'chronicle',
      ChronicleEntrySchema.parse({ id: 'alt', at: ELARIS_START - 2 * day + 60, text: 'Früher.' }),
    );
    const outside = db.put(
      'chronicle',
      ChronicleEntrySchema.parse({ id: 'davor', at: ELARIS_START - 9 * day, text: 'Viel früher.' }),
    );
    const session = addPastSession(db, {
      number: 11,
      title: ' Der Weg hinab ',
      realDate: '2026-10-20',
      startAt: ELARIS_START - 2 * day,
      endAt: ELARIS_START - day,
    });
    const data = db.getSnapshot();
    expect(session).toMatchObject({ number: 11, title: 'Der Weg hinab', realDate: '2026-10-20' });
    expect(data.state.sessionId).toBe(running);
    expect(data.chronicle[inside.id]!.sessionId).toBe(session.id);
    expect(data.chronicle[outside.id]!.sessionId).toBeNull();
    expect(() =>
      addPastSession(db, { number: 10, startAt: ELARIS_START, endAt: ELARIS_START - 1 }),
    ).toThrow();
  });
});

describe('Zusammenfassung für die Spieler', () => {
  it('lässt weg, was nur die Spielleitung wissen soll', async () => {
    const db = await freshDb();
    const known = db.put(
      'entities',
      createEntity({ kind: 'person', name: 'Wirtin', person: { met: true } }),
    );
    const stranger = db.put(
      'entities',
      createEntity({ kind: 'person', name: 'Der Beobachter', person: { met: false } }),
    );
    const session = startSession(db, { title: 'Probe' });
    db.patch('sessions', session.id, { notes: 'Geheimer Plan der Spielleitung.' });
    logEntry(db, { text: 'Die Gruppe kehrt ein.', refs: [known.id] });
    logEntry(db, { text: 'Jemand folgt der Gruppe.', refs: [stranger.id] });
    logEntry(db, { text: 'Die Wirtin lügt.', secret: true });
    setAttitude(db, known.id, PARTY_ID, 2, 'Großzügiges Trinkgeld');

    const data = db.getSnapshot();
    const gm = sessionSummaryText(data, session.id);
    const players = sessionSummaryText(data, session.id, 'players');
    for (const text of [
      'Die Gruppe kehrt ein.',
      'Jemand folgt',
      'Die Wirtin lügt',
      'Geheimer Plan',
    ])
      expect(gm).toContain(text);
    expect(gm).toContain('Großzügiges Trinkgeld');

    expect(players).toContain('Die Gruppe kehrt ein.');
    for (const text of ['Jemand folgt', 'Die Wirtin lügt', 'Geheimer Plan', 'Trinkgeld'])
      expect(players).not.toContain(text);

    const entries = Object.values(data.chronicle);
    expect(entries.filter((e) => isForPlayers(data, e)).map((e) => e.text)).toEqual([
      'Die Gruppe kehrt ein.',
    ]);
  });

  it('kennt alte Einträge ohne die Markierung', () => {
    expect(ChronicleEntrySchema.parse({ id: 'e1', at: 0 }).secret).toBe(false);
  });
});
