import { describe, expect, it } from 'vitest';
import {
  deleteEntity,
  deleteSession,
  endSession,
  logEntry,
  moveParty,
  resumeSession,
  setAttitude,
  setPromiseDone,
  setPromiseOutcome,
  startSession,
} from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { demoCampaign } from '../../data/__fixtures__/demoWorld';
import { MemoryStore } from '../../data/store';
import {
  chronicleSorted,
  entitiesOfKind,
  openPromises,
  partyStays,
  promiseOutcome,
} from '../../domain/derive';
import { PARTY_ID, type ChronicleEntry } from '../../domain/schema';
import { onChroniclePreset, remembered, showInChronicle, showSessionInChronicle } from './link';
import { MINUTES_PER_DAY, dayIndexOf, formatDate, toTime } from '../../domain/time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../../domain/time/elaris';
import {
  EMPTY_FILTER,
  defaultDue,
  deleteConsequence,
  draftOf,
  entryChange,
  entryFromDraft,
  entryHeadline,
  entryPlainText,
  entryTimeProblem,
  filterEntries,
  formatRealDate,
  formatWorldRange,
  isFilterActive,
  isOverdue,
  keepsOrder,
  lockedRefs,
  mentionCounts,
  parseRealDate,
  promiseDueLabel,
  promiseParties,
  realDateInput,
  relativeDay,
  resumableSessionId,
  sanitizeFilter,
  sessionAt,
  sessionBackfillTime,
  sessionLabel,
  sessionMarkers,
  sessionSpans,
  sessionSummaryText,
  sessionTitle,
  spanDuration,
  timeBounds,
  timeDraftOf,
  timeOfDraft,
  timelineRows,
  type TimelineRow,
} from './model';

const cal = ELARIS_CALENDAR;
const day = MINUTES_PER_DAY;

async function demoDb() {
  return CampaignDb.create(new MemoryStore(), demoCampaign());
}
const byName = (db: CampaignDb, name: string) =>
  Object.values(db.getSnapshot().entities).find((e) => e.name === name)!;
const entries = (db: CampaignDb) => chronicleSorted(db.getSnapshot());
const filtered = (db: CampaignDb, change: Partial<typeof EMPTY_FILTER>) =>
  filterEntries(db.getSnapshot(), entries(db), { ...EMPTY_FILTER, ...change });

describe('Filter', () => {
  it('lässt ohne Filter alles durch und erkennt aktive Filter', async () => {
    const db = await demoDb();
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, query: '  ' })).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, kinds: ['note'] })).toBe(true);
    expect(filtered(db, {})).toHaveLength(10);
  });

  it('filtert nach mehreren Arten zugleich', async () => {
    const db = await demoDb();
    expect(filtered(db, { kinds: ['travel'] })).toHaveLength(4);
    const mixed = filtered(db, { kinds: ['change', 'promise'] });
    expect(mixed.map((e) => e.kind).sort()).toEqual(['change', 'change', 'promise']);
  });

  it('findet Einträge über den betroffenen Eintrag – auch Reiseziel und Haltung', async () => {
    const db = await demoDb();
    const voss = byName(db, 'Hauptmann Voss');
    expect(filtered(db, { entityId: voss.id }).map((e) => e.kind)).toEqual(['attitude']);
    const kloster = byName(db, 'Kloster Sankt Vael');
    expect(filtered(db, { entityId: kloster.id }).map((e) => e.kind)).toEqual([
      'travel',
      'note',
      'travel',
    ]);
  });

  it('nimmt beim Ort die Orte darunter mit', async () => {
    const db = await demoDb();
    const hafen = byName(db, 'Dornhafen');
    const taverne = byName(db, 'Zum Salzigen Raben');
    const inHafen = filtered(db, { placeId: hafen.id });
    const inTaverne = filtered(db, { placeId: taverne.id });
    expect(inTaverne).toHaveLength(2);
    expect(inHafen.length).toBeGreaterThan(inTaverne.length);
    for (const entry of inTaverne) expect(inHafen).toContain(entry);
    const kueste = byName(db, 'Nebelküste');
    expect(filtered(db, { placeId: kueste.id })).toHaveLength(10);
  });

  it('sucht im Text und in den Namen der Beteiligten, ohne auf Akzente und Großschreibung zu achten', async () => {
    const db = await demoDb();
    expect(filtered(db, { query: 'zollkette' })).toHaveLength(1);
    // „Isolde“ steht im Text des einen und nur als Verweis … beim selben Eintrag; „Brann“ als Verweis.
    expect(filtered(db, { query: 'eisenhaken' })).toHaveLength(1);
    expect(filtered(db, { query: 'KRAHENMOOR' }).every((e) => e.kind === 'travel')).toBe(true);
    expect(filtered(db, { query: 'glocke dreimal' })).toHaveLength(1);
    expect(filtered(db, { query: 'glocke zollkette' })).toHaveLength(0);
    expect(filtered(db, { query: 'ablehnend' }).map((e) => e.kind)).toEqual(['attitude']);
  });

  it('filtert nach Session, auch nach „ohne Session“', async () => {
    const db = await demoDb();
    const session = Object.values(db.getSnapshot().sessions)[0]!;
    endSession(db);
    const loose = logEntry(db, { text: 'Zwischen den Spielabenden' });
    expect(loose.sessionId).toBeNull();
    expect(filtered(db, { session: session.id })).toHaveLength(10);
    expect(filtered(db, { session: 'none' }).map((e) => e.id)).toEqual([loose.id]);
  });

  it('zeigt mit der Vorwahl nur offene Abmachungen', async () => {
    const db = await demoDb();
    const open = filtered(db, { openPromisesOnly: true });
    expect(open).toHaveLength(1);
    db.patch('chronicle', open[0]!.id, { promise: { due: null, done: true, failed: false } });
    expect(filtered(db, { openPromisesOnly: true })).toHaveLength(0);
  });

  it('verbindet mehrere Filter mit UND', async () => {
    const db = await demoDb();
    const hafen = byName(db, 'Dornhafen');
    expect(filtered(db, { placeId: hafen.id, kinds: ['change'], query: 'kessa' })).toHaveLength(1);
    expect(filtered(db, { placeId: hafen.id, kinds: ['travel'], query: 'kessa' })).toHaveLength(0);
  });

  it('nimmt Filter auf Gelöschtes zurück und lässt gültige unverändert', async () => {
    const db = await demoDb();
    const voss = byName(db, 'Hauptmann Voss');
    const hafen = byName(db, 'Dornhafen');
    const session = Object.values(db.getSnapshot().sessions)[0]!;
    const filter = {
      ...EMPTY_FILTER,
      session: session.id,
      entityId: voss.id,
      placeId: hafen.id,
      query: 'x',
    };
    expect(sanitizeFilter(db.getSnapshot(), filter)).toBe(filter);
    expect(sanitizeFilter(db.getSnapshot(), { ...EMPTY_FILTER, entityId: PARTY_ID }).entityId).toBe(
      PARTY_ID,
    );
    deleteEntity(db, voss.id);
    deleteSession(db, session.id);
    expect(sanitizeFilter(db.getSnapshot(), filter)).toEqual({
      ...EMPTY_FILTER,
      placeId: hafen.id,
      query: 'x',
    });
  });

  it('zählt, wer und was in einer Auswahl am häufigsten vorkommt', async () => {
    const db = await demoDb();
    const hafen = byName(db, 'Dornhafen');
    const counts = mentionCounts(entries(db));
    expect(counts[0]).toEqual({ id: hafen.id, count: 5 });
    expect(counts.every((c) => c.id !== PARTY_ID)).toBe(true);
    expect(mentionCounts(entries(db), 3)).toHaveLength(3);
    const voss = byName(db, 'Hauptmann Voss');
    expect(
      mentionCounts(filtered(db, { entityId: voss.id }))
        .map((c) => c.id)
        .sort(),
    ).toEqual([hafen.id, voss.id].sort());
  });

  it('bleibt bei 3000 Einträgen schnell', async () => {
    const db = await demoDb();
    const hafen = byName(db, 'Dornhafen');
    db.batch(() => {
      for (let i = 0; i < 3000; i++)
        logEntry(db, {
          text: `Ereignis ${i} am Kai`,
          at: ELARIS_START - i * 97,
          placeId: hafen.id,
          refs: [hafen.id],
        });
    });
    const all = entries(db);
    const started = performance.now();
    const hits = filterEntries(db.getSnapshot(), all, {
      ...EMPTY_FILTER,
      query: 'ereignis 299',
      placeId: hafen.id,
    });
    const rows = timelineRows(all, sessionMarkers(sessionSpans(db.getSnapshot())), true);
    expect(performance.now() - started).toBeLessThan(400);
    // 299, 1299, 2299 und 2990–2999
    expect(hits).toHaveLength(13);
    expect(rows.filter((r) => r.type === 'entry')).toHaveLength(3010);
  });
});

describe('Sessions', () => {
  it('rechnet Weltzeit und Umfang einer Session aus Beginn, Ende und ihren Einträgen', async () => {
    const db = await demoDb();
    const [span] = sessionSpans(db.getSnapshot());
    expect(span!.running).toBe(true);
    expect(span!.entryCount).toBe(10);
    // Die Beispielwelt hat Einträge vor dem eingetragenen Beginn: der früheste Eintrag zählt.
    expect(span!.from).toBe(ELARIS_START - 9 * day);
    expect(span!.to).toBeNull();
    expect(spanDuration(span!, ELARIS_START)).toBe(9 * day);

    endSession(db);
    const [ended] = sessionSpans(db.getSnapshot());
    expect(ended!.running).toBe(false);
    expect(ended!.to).toBe(ELARIS_START);
  });

  it('ordnet einen Zeitpunkt der passenden Session zu', async () => {
    const db = await demoDb();
    const first = Object.values(db.getSnapshot().sessions)[0]!;
    expect(sessionAt(db.getSnapshot(), ELARIS_START - 3 * day)?.id).toBe(first.id);
    expect(sessionAt(db.getSnapshot(), ELARIS_START - 30 * day)).toBeNull();
    endSession(db);
    db.setState({ now: ELARIS_START + 2 * day });
    const second = startSession(db, { title: 'Aufbruch' });
    db.setState({ now: ELARIS_START + 3 * day });
    expect(sessionAt(db.getSnapshot(), ELARIS_START + 1 * day)).toBeNull();
    expect(sessionAt(db.getSnapshot(), ELARIS_START + 2 * day + 60)?.id).toBe(second.id);
    expect(sessionAt(db.getSnapshot(), ELARIS_START)?.id).toBe(first.id);
  });

  it('benennt Sessions ohne doppelte Nummer', async () => {
    const db = await demoDb();
    const session = Object.values(db.getSnapshot().sessions)[0]!;
    expect(sessionLabel(session)).toBe('Session 12');
    expect(sessionTitle(session)).toBe('');
    const named = { ...session, title: 'Die Glocke schlägt' };
    expect(sessionLabel(named)).toBe('Session 12 – Die Glocke schlägt');
    expect(sessionTitle(named)).toBe('Die Glocke schlägt');
  });

  it('löscht eine Session, ohne ihre Einträge zu verlieren', async () => {
    const db = await demoDb();
    const session = Object.values(db.getSnapshot().sessions)[0]!;
    deleteSession(db, session.id);
    const data = db.getSnapshot();
    expect(data.sessions[session.id]).toBeUndefined();
    expect(data.state.sessionId).toBeNull();
    expect(Object.values(data.chronicle)).toHaveLength(10);
    expect(Object.values(data.chronicle).every((e) => e.sessionId === null)).toBe(true);
    await db.flush();
    const reopened = await CampaignDb.open(db.store);
    expect(reopened.getSnapshot()).toEqual(data);
  });

  it('setzt eine beendete Session fort und nimmt damit ein versehentliches Beenden zurück', async () => {
    const db = await demoDb();
    const first = Object.values(db.getSnapshot().sessions)[0]!;
    expect(resumableSessionId(db.getSnapshot())).toBeNull(); // sie läuft ja
    db.setState({ now: ELARIS_START + 60 });
    endSession(db);
    expect(db.getSnapshot().sessions[first.id]!.endAt).toBe(ELARIS_START + 60);
    expect(resumableSessionId(db.getSnapshot())).toBe(first.id);

    resumeSession(db, first.id);
    let data = db.getSnapshot();
    expect(data.state.sessionId).toBe(first.id);
    expect(data.sessions[first.id]!.endAt).toBeNull();
    expect(sessionSpans(data)[0]!.running).toBe(true);
    expect(logEntry(db, { text: 'Weiter geht es' }).sessionId).toBe(first.id);

    // Nur die jüngste Session lässt sich fortsetzen; läuft eine, dann keine.
    endSession(db);
    const second = startSession(db);
    expect(resumableSessionId(db.getSnapshot())).toBeNull();
    endSession(db);
    expect(resumableSessionId(db.getSnapshot())).toBe(second.id);

    // Fortsetzen einer älteren beendet die laufende; Unbekanntes und bereits Laufendes ändern nichts.
    resumeSession(db, second.id);
    resumeSession(db, first.id);
    data = db.getSnapshot();
    expect(data.state.sessionId).toBe(first.id);
    expect(data.sessions[second.id]!.endAt).not.toBeNull();
    const before = db.getSnapshot();
    resumeSession(db, first.id);
    resumeSession(db, 'gibt-es-nicht');
    expect(db.getSnapshot()).toBe(before);

    await db.flush();
    expect((await CampaignDb.open(db.store)).getSnapshot()).toEqual(db.getSnapshot());
  });

  it('schlägt beim Nachtragen zu einer Session ihr Ende vor, bei der laufenden jetzt', async () => {
    const db = await demoDb();
    const first = Object.values(db.getSnapshot().sessions)[0]!;
    expect(sessionBackfillTime(db.getSnapshot(), first.id)).toBe(ELARIS_START);
    db.setState({ now: ELARIS_START + day });
    endSession(db);
    db.setState({ now: ELARIS_START + 4 * day });
    expect(sessionBackfillTime(db.getSnapshot(), first.id)).toBe(ELARIS_START + day);
    expect(sessionBackfillTime(db.getSnapshot(), 'gibt-es-nicht')).toBe(ELARIS_START + 4 * day);
    // Eine neue Abmachung bekommt als Vorschlag eine Woche Frist, bis zum Ende des Tages.
    expect(formatDate(cal, defaultDue(ELARIS_START))).toBe('24. Tauwind 701 AD');
    expect(defaultDue(ELARIS_START) % day).toBe(day - 1);
  });

  it('kennt keine fortsetzbare Session, solange es keine gibt', async () => {
    const db = await demoDb();
    deleteSession(db, Object.values(db.getSnapshot().sessions)[0]!.id);
    expect(resumableSessionId(db.getSnapshot())).toBeNull();
  });

  it('lässt beim Löschen einer beendeten Session die laufende in Ruhe', async () => {
    const db = await demoDb();
    const first = Object.values(db.getSnapshot().sessions)[0]!;
    const second = startSession(db);
    const note = logEntry(db, { text: 'Neu' });
    deleteSession(db, first.id);
    expect(db.getSnapshot().state.sessionId).toBe(second.id);
    expect(db.getSnapshot().chronicle[note.id]!.sessionId).toBe(second.id);
  });
});

describe('Zeitstrahl', () => {
  const shape = (rows: TimelineRow[]) =>
    rows.map((r) =>
      r.type === 'day'
        ? `Tag ${r.day - dayIndexOf(ELARIS_START)} (${r.count})`
        : r.type === 'marker'
          ? `${r.edge === 'start' ? 'Beginn' : 'Ende'} ${r.session.number}`
          : r.entry.kind,
    );

  it('gliedert nach Tagen und setzt den Session-Beginn vor den ersten Eintrag', async () => {
    const db = await demoDb();
    const data = db.getSnapshot();
    const rows = timelineRows(entries(db), sessionMarkers(sessionSpans(data)), false);
    expect(shape(rows)).toEqual([
      'Beginn 12',
      'Tag -9 (2)',
      'travel',
      'note',
      'Tag -8 (2)',
      'attitude',
      'promise',
      'Tag -6 (1)',
      'travel',
      'Tag -5 (2)',
      'travel',
      'note',
      'Tag -3 (1)',
      'change',
      'Tag -2 (1)',
      'change',
      'Tag 0 (1)',
      'travel',
    ]);
  });

  it('dreht die Reihenfolge um, behält aber Tagesüberschriften über ihren Einträgen', async () => {
    const db = await demoDb();
    const rows = timelineRows(entries(db), sessionMarkers(sessionSpans(db.getSnapshot())), true);
    expect(shape(rows).slice(0, 5)).toEqual([
      'Tag 0 (1)',
      'travel',
      'Tag -2 (1)',
      'change',
      'Tag -3 (1)',
    ]);
    expect(shape(rows).slice(-4)).toEqual(['Tag -9 (2)', 'note', 'travel', 'Beginn 12']);
  });

  it('ordnet am selben Zeitpunkt: Ende der alten Session, Einträge dazwischen, Beginn der neuen', async () => {
    const db = await demoDb();
    logEntry(db, { text: 'Letzter Satz des Abends' });
    endSession(db);
    logEntry(db, { text: 'In der Vorbereitung ergänzt' });
    startSession(db);
    logEntry(db, { text: 'Erster Satz des neuen Abends' });
    const data = db.getSnapshot();
    const rows = timelineRows(entries(db), sessionMarkers(sessionSpans(data)), false);
    const tail = rows
      .slice(-7)
      .map((r) =>
        r.type === 'entry'
          ? r.entry.text || r.entry.kind
          : r.type === 'marker'
            ? `${r.edge} ${r.session.number}`
            : 'Tag',
      );
    expect(tail).toEqual([
      'Tag',
      'Rückweg Richtung Dornhafen.',
      'Letzter Satz des Abends',
      'end 12',
      'In der Vorbereitung ergänzt',
      'start 13',
      'Erster Satz des neuen Abends',
    ]);
  });

  it('gibt einer Session-Grenze ein Datum, wenn sie nicht bei Einträgen ihres Tages steht', async () => {
    const db = await demoDb();
    // Die Session endet zwei Tage nach dem letzten Eintrag; die nächste beginnt am Tag ihres ersten Eintrags.
    db.setState({ now: ELARIS_START + 2 * day });
    endSession(db);
    db.setState({ now: ELARIS_START + 5 * day });
    startSession(db);
    logEntry(db, { text: 'Neuer Abend' });
    const data = db.getSnapshot();
    for (const newestFirst of [false, true]) {
      const markers = timelineRows(
        entries(db),
        sessionMarkers(sessionSpans(data)),
        newestFirst,
      ).flatMap((r) =>
        r.type === 'marker'
          ? [`${r.edge} ${r.session.number} ${r.dated ? 'mit' : 'ohne'} Datum`]
          : [],
      );
      expect(markers.sort()).toEqual([
        'end 12 mit Datum',
        'start 12 ohne Datum',
        'start 13 ohne Datum',
      ]);
    }
    // Ohne jeden Eintrag in der Nähe steht das Datum immer dabei.
    const alone = timelineRows([], sessionMarkers(sessionSpans(data)), true);
    expect(alone.every((r) => r.type === 'marker' && r.dated)).toBe(true);
  });

  it('zeigt bei aktivem Filter nur Grenzen von Sessions, aus denen etwas zu sehen ist', async () => {
    const db = await demoDb();
    endSession(db);
    startSession(db);
    const spans = sessionSpans(db.getSnapshot());
    expect(sessionMarkers(spans).map((m) => `${m.edge} ${m.session.number}`)).toEqual([
      'start 12',
      'end 12',
      'start 13',
    ]);
    const visible = new Set(filtered(db, { kinds: ['promise'] }).map((e) => e.sessionId!));
    expect(sessionMarkers(spans, visible).map((m) => `${m.edge} ${m.session.number}`)).toEqual([
      'start 12',
      'end 12',
    ]);
  });

  it('nennt Tage relativ zu heute', () => {
    expect(relativeDay(100, 100)).toBe('heute');
    expect(relativeDay(100, 99)).toBe('gestern');
    expect(relativeDay(100, 98)).toBe('vorgestern');
    expect(relativeDay(100, 97)).toBe('vor 3 Tagen');
    expect(relativeDay(100, 101)).toBe('morgen');
    expect(relativeDay(100, 105)).toBe('in 5 Tagen');
  });

  it('fasst Zeiträume knapp', () => {
    const at = (month: number, d: number, hour = 0, year = 701) =>
      toTime(cal, { year: year + 27387, month, day: d, hour, minute: 0 });
    expect(formatWorldRange(cal, at(0, 17, 16), at(0, 17, 16))).toBe('17. Tauwind 701 AD, 16:00');
    expect(formatWorldRange(cal, at(0, 17, 16), at(0, 17, 22))).toBe(
      '17. Tauwind 701 AD, 16:00–22:00',
    );
    expect(formatWorldRange(cal, at(0, 8), at(0, 17))).toBe('8.–17. Tauwind 701 AD');
    expect(formatWorldRange(cal, at(0, 28), at(1, 3))).toBe('28. Tauwind – 3. Grünbruch 701 AD');
    expect(formatWorldRange(cal, at(11, 30, 0, 700), at(0, 2))).toBe(
      '30. Sonnend 700 AD – 2. Tauwind 701 AD',
    );
  });

  it('schreibt das echte Datum eines Spielabends aus', () => {
    expect(formatRealDate('2026-11-03')).toBe('Di., 3. November 2026');
    expect(formatRealDate('2026-11-03', 'long')).toBe('Dienstag, 3. November 2026');
    expect(formatRealDate('')).toBe('');
    expect(formatRealDate('irgendwann')).toBe('irgendwann');
  });
});

describe('Echtes Datum eingeben', () => {
  it('liest deutsche und ISO-Schreibweise', () => {
    expect(parseRealDate('3.11.2026')).toBe('2026-11-03');
    expect(parseRealDate(' 03.11.26 ')).toBe('2026-11-03');
    expect(parseRealDate('3. 11. 2026')).toBe('2026-11-03');
    expect(parseRealDate('2026-11-03')).toBe('2026-11-03');
    expect(parseRealDate('')).toBe('');
  });

  it('lehnt Unsinn und unmögliche Tage ab', () => {
    expect(parseRealDate('31.2.2026')).toBeNull();
    expect(parseRealDate('morgen')).toBeNull();
    expect(parseRealDate('3.11.')).toBeNull();
    expect(parseRealDate('0.11.2026')).toBeNull();
  });

  it('zeigt gespeicherte Daten deutsch an', () => {
    expect(realDateInput('2026-11-03')).toBe('03.11.2026');
    expect(realDateInput('')).toBe('');
    expect(parseRealDate(realDateInput('2026-11-03'))).toBe('2026-11-03');
  });
});

describe('Zeitpunkt eingeben', () => {
  it('wandelt Weltzeit in Felder und zurück', () => {
    const draft = timeDraftOf(cal, ELARIS_START);
    expect(draft).toEqual({ day: '17', month: 0, year: '701', hour: '16', minute: '00' });
    expect(timeOfDraft(cal, draft)).toBe(ELARIS_START);
  });

  it('lehnt Daten ab, die es im Kalender nicht gibt', () => {
    const draft = timeDraftOf(cal, ELARIS_START);
    expect(timeOfDraft(cal, { ...draft, day: '32' })).toBeNull();
    expect(timeOfDraft(cal, { ...draft, day: '' })).toBeNull();
    expect(timeOfDraft(cal, { ...draft, hour: '24' })).toBeNull();
    expect(timeOfDraft(cal, { ...draft, minute: '' })).toBeNull();
    // 701 AD ist ein Schaltjahr, 702 AD nicht.
    expect(timeOfDraft(cal, { ...draft, month: 1, day: '29' })).not.toBeNull();
    expect(timeOfDraft(cal, { ...draft, month: 1, day: '29', year: '702' })).toBeNull();
  });
});

describe('Einträge bearbeiten', () => {
  const find = (db: CampaignDb, kind: ChronicleEntry['kind'], n = 0) =>
    entries(db).filter((e) => e.kind === kind)[n]!;

  it('ändert Text, Zeit, Ort und Verweise einer Notiz und macht sie auf Wunsch zur Abmachung', async () => {
    const db = await demoDb();
    const note = find(db, 'note');
    const brann = byName(db, 'Brann Eisenhaken');
    const draft = {
      ...draftOf(note),
      kind: 'promise' as const,
      text: '  Neu  ',
      at: note.at + 60,
      refs: [brann.id],
      due: note.at + day,
      done: false,
    };
    const saved = db.patch('chronicle', note.id, entryChange(note, draft));
    expect(saved.kind).toBe('promise');
    expect(saved.text).toBe('Neu');
    expect(saved.at).toBe(note.at + 60);
    expect(saved.refs).toEqual([brann.id]);
    expect(saved.promise).toEqual({ due: note.at + day, done: false, failed: false });
    const back = db.patch(
      'chronicle',
      note.id,
      entryChange(saved, { ...draftOf(saved), kind: 'note' }),
    );
    expect(back.promise).toBeNull();
  });

  it('lässt einen Ortswechsel in Art, Weg und Ort unangetastet, erlaubt aber Anmerkung und Verweise', async () => {
    const db = await demoDb();
    const travel = find(db, 'travel', 1);
    const isolde = byName(db, 'Isolde Rabenschwinge');
    const taverne = byName(db, 'Zum Salzigen Raben');
    expect(lockedRefs(travel).sort()).toEqual([travel.travel!.toId, travel.travel!.fromId].sort());
    expect(draftOf(travel).refs).toEqual([]);
    const change = entryChange(travel, {
      ...draftOf(travel),
      kind: 'note',
      text: 'Im Morgengrauen',
      placeId: taverne.id,
      refs: [isolde.id],
    });
    const saved = db.patch('chronicle', travel.id, change);
    expect(saved.kind).toBe('travel');
    expect(saved.travel).toEqual(travel.travel);
    expect(saved.placeId).toBe(travel.placeId);
    expect(saved.text).toBe('Im Morgengrauen');
    expect(saved.refs).toEqual([...lockedRefs(travel), isolde.id]);
    expect(saved.promise).toBeNull();
    expect(partyStays(db.getSnapshot())).toEqual(partyStays(demoCampaignWith(db)));
  });

  it('behält bei einer Haltungsänderung den Schritt und die Beteiligten', async () => {
    const db = await demoDb();
    const attitude = find(db, 'attitude');
    const saved = db.patch(
      'chronicle',
      attitude.id,
      entryChange(attitude, { ...draftOf(attitude), refs: [], text: 'Grund' }),
    );
    expect(saved.attitude).toEqual(attitude.attitude);
    expect(saved.refs).toEqual([attitude.attitude!.fromId]);
    expect(lockedRefs(attitude)).not.toContain(PARTY_ID);
  });

  it('verschiebt einen eingetretenen Termin nicht', async () => {
    const db = await demoDb();
    const event = db.put('chronicle', entryFromDraft({ ...draftOf(find(db, 'note')), text: 'x' }));
    const asEvent = db.patch('chronicle', event.id, { kind: 'event', eventId: null });
    const change = entryChange(asEvent, {
      ...draftOf(asEvent),
      at: asEvent.at + 500,
      text: 'Der Graue Fang legt ab',
    });
    expect(change.at).toBe(asEvent.at);
    expect(change.kind).toBe('event');
    expect(change.text).toBe('Der Graue Fang legt ab');
  });

  it('legt nachgetragene Einträge mit freiem Zeitpunkt an', async () => {
    const db = await demoDb();
    const hafen = byName(db, 'Dornhafen');
    const entry = db.put(
      'chronicle',
      entryFromDraft({
        kind: 'change',
        text: ' Die Wache verdoppelt die Posten. ',
        at: ELARIS_START - 4 * day,
        placeId: hafen.id,
        refs: [hafen.id, hafen.id],
        sessionId: null,
        secret: false,
        due: ELARIS_START,
        done: false,
        failed: false,
      }),
    );
    expect(entry.kind).toBe('change');
    expect(entry.text).toBe('Die Wache verdoppelt die Posten.');
    expect(entry.refs).toEqual([hafen.id]);
    expect(entry.promise).toBeNull();
    expect(entry.sessionId).toBeNull();
    const promise = entryFromDraft({
      ...draftOf(entry),
      kind: 'promise',
      due: ELARIS_START,
      done: false,
    });
    expect(promise.promise).toEqual({ due: ELARIS_START, done: false, failed: false });
    // Eine Abmachung kann auch scheitern – gescheitert ist sie nur, wenn sie nicht mehr offen ist.
    const broken = db.put(
      'chronicle',
      entryFromDraft({ ...draftOf(promise), done: true, failed: true }),
    );
    expect(broken.promise).toEqual({ due: ELARIS_START, done: true, failed: true });
    expect(promiseOutcome(broken.promise)).toBe('failed');
    expect(openPromises(db.getSnapshot()).map((e) => e.id)).not.toContain(broken.id);
    setPromiseOutcome(db, broken.id, 'open');
    expect(db.getSnapshot().chronicle[broken.id]!.promise).toMatchObject({
      done: false,
      failed: false,
    });
    setPromiseOutcome(db, broken.id, 'failed');
    expect(promiseOutcome(db.getSnapshot().chronicle[broken.id]!.promise)).toBe('failed');
    setPromiseDone(db, broken.id, true);
    expect(promiseOutcome(db.getSnapshot().chronicle[broken.id]!.promise)).toBe('kept');
    expect(entryFromDraft({ ...draftOf(promise), done: false, failed: true }).promise).toEqual({
      due: ELARIS_START,
      done: false,
      failed: false,
    });
    expect(entryFromDraft({ ...draftOf(entry), kind: 'travel' }).kind).toBe('note');
  });

  it('hält die Abfolge der Ortswechsel beim Verschieben ein', async () => {
    const db = await demoDb();
    const data = db.getSnapshot();
    const travels = entries(db).filter((e) => e.kind === 'travel');
    const second = travels[1]!;
    const bounds = timeBounds(data, second);
    expect(bounds.previous?.id).toBe(travels[0]!.id);
    expect(bounds.next?.id).toBe(travels[2]!.id);
    expect(keepsOrder(data, second, second.at + 120)).toBe(true);
    expect(keepsOrder(data, second, travels[0]!.at - 1)).toBe(false);
    expect(keepsOrder(data, second, travels[2]!.at + 1)).toBe(false);
    expect(timeBounds(data, travels[0]!).previous).toBeNull();
    expect(timeBounds(data, travels[3]!).next).toBeNull();
    // Notizen dürfen überallhin.
    const note = entries(db).find((e) => e.kind === 'note')!;
    expect(keepsOrder(data, note, 5)).toBe(true);
    expect(timeBounds(data, note)).toEqual({ previous: null, next: null });
  });

  it('hält die Abfolge eines Haltungsverlaufs ein, nicht die fremder Verläufe', async () => {
    const db = await demoDb();
    const voss = byName(db, 'Hauptmann Voss');
    const isolde = byName(db, 'Isolde Rabenschwinge');
    setAttitude(db, voss.id, PARTY_ID, -3, 'Noch ein Zwischenfall');
    setAttitude(db, isolde.id, PARTY_ID, 3, 'Gerettet');
    const data = db.getSnapshot();
    const [first, second] = entries(db).filter(
      (e) => e.kind === 'attitude' && e.attitude?.fromId === voss.id,
    );
    expect(keepsOrder(data, first!, second!.at + 10)).toBe(false);
    expect(keepsOrder(data, first!, second!.at - 10)).toBe(true);
    const other = entries(db).find((e) => e.attitude?.fromId === isolde.id)!;
    expect(keepsOrder(data, other, 5)).toBe(true);
  });

  it('erklärt, was das Löschen eines Ortswechsels oder einer Haltungsänderung bedeutet', async () => {
    const db = await demoDb();
    const data = db.getSnapshot();
    const travel = deleteConsequence(data, find(db, 'travel', 1));
    expect(travel).toContain('Aufenthalt in Krähenmoor');
    expect(travel).toContain('Besuche der betroffenen Orte werden neu berechnet');
    expect(travel).toContain('Der aktuelle Aufenthaltsort der Gruppe bleibt');
    const attitude = deleteConsequence(data, find(db, 'attitude'));
    expect(attitude).toContain('Hauptmann Voss gegenüber der Gruppe');
    // Gelöscht wird samt Wirkung (removeRecorded): Der jüngste Schritt nimmt die Haltung mit.
    expect(attitude).toContain('Die Haltung ist danach wieder, wie sie vorher war (Neutral)');
    setAttitude(db, byName(db, 'Hauptmann Voss').id, PARTY_ID, -3, 'Noch ein Zwischenfall');
    const older = deleteConsequence(db.getSnapshot(), find(db, 'attitude'));
    expect(older).toContain('Die aktuelle Haltung bleibt, wie sie ist (Feindselig)');
    expect(deleteConsequence(data, find(db, 'note'))).toContain('verschwindet aus der Chronik');
  });

  it('sagt, was gegen einen Zeitpunkt spricht', async () => {
    const db = await demoDb();
    const data = db.getSnapshot();
    const note = find(db, 'note');
    expect(entryTimeProblem(data, note, null)).toContain('gibt es im Kalender nicht');
    expect(entryTimeProblem(data, note, note.at - 5 * day)).toBe('');
    expect(entryTimeProblem(data, note, ELARIS_START)).toBe('');
    expect(entryTimeProblem(data, note, ELARIS_START + 1)).toContain('Zukunft');
    // Nachtragen: bis jetzt erlaubt, danach nicht.
    expect(entryTimeProblem(data, null, ELARIS_START)).toBe('');
    expect(entryTimeProblem(data, null, ELARIS_START + 1)).toContain('Kalender');
    // Ein unveränderter Zeitpunkt wird nie beanstandet – auch wenn die Weltzeit zurückgestellt wurde.
    const earlier = { ...data, state: { ...data.state, now: note.at - day } };
    expect(entryTimeProblem(earlier, note, note.at)).toBe('');
    expect(entryTimeProblem(earlier, note, note.at + 1)).toContain('Zukunft');
    // Ortswechsel bleiben in ihrer Reihenfolge; die Meldung nennt die Grenzen.
    const travels = entries(db).filter((e) => e.kind === 'travel');
    const problem = entryTimeProblem(data, travels[1]!, travels[0]!.at - 10);
    expect(problem).toContain('Reihenfolge der Ortswechsel');
    expect(problem).toContain(`nach dem ${formatDate(cal, travels[0]!.at)}`);
    expect(problem).toContain(`vor dem ${formatDate(cal, travels[2]!.at)}`);
    expect(entryTimeProblem(data, travels[1]!, travels[1]!.at + 30)).toBe('');
  });

  it('beschreibt Frist und Beteiligte einer offenen Abmachung in wenigen Worten', async () => {
    const db = await demoDb();
    const promise = find(db, 'promise');
    const due = promise.promise!.due!;
    expect(promiseDueLabel(cal, promise, ELARIS_START)).toBe('Frist 19. Tauwind · in 2 Tagen');
    expect(promiseDueLabel(cal, promise, due + 60)).toBe('Seit heute überfällig · 19. Tauwind');
    expect(promiseDueLabel(cal, promise, due + day)).toBe('Seit gestern überfällig · 19. Tauwind');
    expect(promiseDueLabel(cal, promise, due + 5 * day)).toBe(
      'Seit 5 Tagen überfällig · 19. Tauwind',
    );
    expect(
      promiseDueLabel(
        cal,
        { ...promise, promise: { due: null, done: false, failed: false } },
        ELARIS_START,
      ),
    ).toBe('Ohne Frist');
    // Der Ort des Geschehens und Gelöschtes zählen nicht zu den Beteiligten.
    expect(promiseParties(db.getSnapshot(), promise)).toEqual(['Brann Eisenhaken']);
    const withPlace = { ...promise, refs: [...promise.refs, promise.placeId!, 'geloescht'] };
    expect(promiseParties(db.getSnapshot(), withPlace)).toEqual(['Brann Eisenhaken']);
    // Abhaken und wieder öffnen.
    setPromiseDone(db, promise.id, true);
    expect(isOverdue(db.getSnapshot().chronicle[promise.id]!, due + day)).toBe(false);
    setPromiseDone(db, promise.id, false);
    expect(isOverdue(db.getSnapshot().chronicle[promise.id]!, due + day)).toBe(true);
  });

  it('erkennt überfällige Abmachungen', async () => {
    const db = await demoDb();
    const promise = find(db, 'promise');
    expect(isOverdue(promise, ELARIS_START)).toBe(false);
    expect(isOverdue(promise, ELARIS_START + 3 * day)).toBe(true);
    expect(
      isOverdue(
        { ...promise, promise: { due: promise.promise!.due, done: true, failed: false } },
        ELARIS_START + 3 * day,
      ),
    ).toBe(false);
    expect(
      isOverdue(
        { ...promise, promise: { due: null, done: false, failed: false } },
        ELARIS_START + 3 * day,
      ),
    ).toBe(false);
    expect(isOverdue(find(db, 'note'), ELARIS_START)).toBe(false);
  });
});

/** Aufenthalte der unveränderten Beispielwelt – zum Vergleich. Orte heißen dort gleich, IDs nicht. */
function demoCampaignWith(db: CampaignDb) {
  const data = db.getSnapshot();
  return {
    ...data,
    chronicle: Object.fromEntries(
      Object.values(data.chronicle).map((e) => [e.id, { ...e, text: '' }]),
    ),
  };
}

describe('Reiner Text', () => {
  it('beschreibt automatische Einträge in einem Satz', async () => {
    const db = await demoDb();
    const data = db.getSnapshot();
    const all = entries(db);
    expect(
      entryHeadline(
        data,
        all.find((e) => e.kind === 'travel')!,
      ),
    ).toBe('Ankunft: Dornhafen');
    expect(entryHeadline(data, all.filter((e) => e.kind === 'travel')[1]!)).toBe(
      'Ankunft: Krähenmoor (von Dornhafen)',
    );
    expect(
      entryHeadline(
        data,
        all.find((e) => e.kind === 'attitude')!,
      ),
    ).toBe('Hauptmann Voss gegenüber der Gruppe: Neutral → Ablehnend');
    expect(
      entryHeadline(
        data,
        all.find((e) => e.kind === 'note')!,
      ),
    ).toBe('');
    moveParty(db, null);
    const leave = entries(db).at(-1)!;
    expect(entryHeadline(db.getSnapshot(), leave)).toBe('Aufbruch aus Krähenmoor');
  });

  it('nennt Ort und Beteiligte nur, wenn sie nicht schon im Text stehen', async () => {
    const db = await demoDb();
    const data = db.getSnapshot();
    const all = entries(db);
    expect(entryPlainText(data, all[1]!)).toBe(
      'Isolde vermittelt ein Zimmer und warnt vor der Hafenwache. [Zum Salzigen Raben, Isolde Rabenschwinge]',
    );
    expect(
      entryPlainText(
        data,
        all.find((e) => e.kind === 'attitude')!,
      ),
    ).toBe(
      'Hauptmann Voss gegenüber der Gruppe: Neutral → Ablehnend. Die Gruppe hat seine Leute am Zollhaus bloßgestellt. [Dornhafen]',
    );
    expect(
      entryPlainText(
        data,
        all.find((e) => e.kind === 'promise')!,
      ),
    ).toBe(
      `Abmachung: Brann besorgt die Ladeliste des Grauen Fangs – bis das Schiff ablegt. (offen, Frist: ${formatDate(cal, ELARIS_START + 2 * day)}) [Dornhafen, Brann Eisenhaken]`,
    );
    expect(entryPlainText(data, all.filter((e) => e.kind === 'change')[1]!)).toBe(
      'Veränderung: Kessa Flutwind taucht im Salzigen Raben unter – die Wache sucht sie. [Zum Salzigen Raben]',
    );
  });

  it('fasst eine Session als sauber gegliederten Text zusammen', async () => {
    const db = await demoDb();
    const session = Object.values(db.getSnapshot().sessions)[0]!;
    db.patch('sessions', session.id, {
      title: 'Die Glocke schlägt',
      realDate: '2026-11-03',
      notes: 'Nächstes Mal: Kessa finden.\n',
    });
    const text = sessionSummaryText(db.getSnapshot(), session.id);
    const lines = text.split('\n');
    expect(lines.slice(0, 3)).toEqual([
      'Session 12 – Die Glocke schlägt',
      'Spielabend: Dienstag, 3. November 2026',
      'Weltzeit: seit 8. Tauwind 701 AD, 16:00 (läuft noch, bisher 9 Tage)',
    ]);
    expect(lines[3]).toBe('');
    expect(lines[4]).toBe('Erdtag, 8. Tauwind 701 AD'.replace('Erdtag', lines[4]!.split(',')[0]!));
    expect(lines[5]).toBe('16:00  Ankunft: Dornhafen. Ankunft mit dem Küstensegler.');
    expect(text).toContain(
      '\n\nOffene Abmachungen\n- Brann besorgt die Ladeliste des Grauen Fangs – bis das Schiff ablegt. (Frist: 19. Tauwind 701 AD)\n',
    );
    expect(text.endsWith('\n\nNotizen\nNächstes Mal: Kessa finden.\n')).toBe(true);
    expect(text).not.toMatch(/\n\n\n/);

    endSession(db);
    expect(sessionSummaryText(db.getSnapshot(), session.id).split('\n')[2]).toBe(
      'Weltzeit: 8.–17. Tauwind 701 AD (9 Tage)',
    );
    expect(sessionSummaryText(db.getSnapshot(), 'gibt-es-nicht')).toBe('');
  });

  it('sagt es, wenn in einer Session nichts festgehalten wurde', async () => {
    const db = await demoDb();
    const fresh = startSession(db, { title: 'Leer' });
    const text = sessionSummaryText(db.getSnapshot(), fresh.id);
    expect(text).toContain('In dieser Session wurde nichts festgehalten.');
    expect(entitiesOfKind(db.getSnapshot(), 'place').length).toBeGreaterThan(0);
  });
});

describe('Vorwahl aus anderen Bereichen', () => {
  it('stellt den Verlauf auf einen Eintrag ein und setzt alle anderen Filter zurück', () => {
    let calls = 0;
    const off = onChroniclePreset(() => calls++);
    Object.assign(remembered, {
      view: 'sessions',
      filter: { ...EMPTY_FILTER, query: 'alt', kinds: ['note'] },
    });
    showInChronicle({ entityId: 'abc' });
    expect(remembered.view).toBe('verlauf');
    expect(remembered.filter).toEqual({ ...EMPTY_FILTER, entityId: 'abc' });
    showSessionInChronicle('s1');
    expect(remembered.view).toBe('sessions');
    expect(remembered.sessionId).toBe('s1');
    expect(calls).toBe(2);
    off();
    showInChronicle({});
    expect(calls).toBe(2);
    expect(isFilterActive(remembered.filter)).toBe(false);
  });
});
