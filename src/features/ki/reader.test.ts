import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { ArticleSchema, createEntity, type Article } from '../../domain/schema';
import { MINUTES_PER_DAY, fromTime, toTime } from '../../domain/time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../../domain/time/elaris';
import {
  acceptAiHint,
  dismissAiHint,
  readArticle,
  readingTotals,
  unreadArticles,
  type Ask,
} from './actions';
import {
  AI_MODELS,
  articleText,
  buildReadRequest,
  costUsd,
  estimateTokens,
  eventTime,
  formatUsd,
  needsReading,
  parseReply,
  replyProblem,
  textMark,
  type Reading,
  threadSort,
} from './reader';

/** Eine erfundene Welt: zwei Orte, zwei Geschwister, ein Schiff. */
const TEXT = `Die Seeschwalbe ist ein alter Küstensegler unter dem Kommando von Mira Tannhaus. Jeden Feuertag legt sie in Hohenfurt ab und läuft nach Graufels. Am 3. Blüthain jedes Jahres feiert die Mannschaft das Netzfest im Hafen von Hohenfurt. Mira ist die Schwester von Odo Tannhaus, dem sie noch die Heuer eines ganzen Sommers schuldet.`;

const article = (text = TEXT, more: Partial<Article> = {}): Article =>
  ArticleSchema.parse({
    id: 'seeschwalbe',
    rev: 0,
    created: '',
    updated: '',
    title: 'Die Seeschwalbe',
    tags: ['Schiff'],
    docs: [{ id: 'seite', kind: 'page', text }],
    ...more,
  });

const READING: Reading = {
  events: [
    {
      title: 'Die Seeschwalbe legt ab',
      past: false,
      rhythm: 'weekly',
      weekday: 'Feuertag',
      day: 0,
      month: '',
      year: 0,
      place: 'Hohenfurt',
      who: ['Mira Tannhaus', 'Unbekannter Maat'],
      quote: 'Jeden Feuertag legt sie in Hohenfurt ab und läuft nach Graufels.',
    },
    {
      title: 'Das Netzfest beginnt',
      past: false,
      rhythm: 'yearly',
      weekday: '',
      day: 3,
      month: 'Blüthain',
      year: 0,
      place: 'Hohenfurt',
      who: [],
      quote:
        'Am 3. Blüthain jedes Jahres feiert die Mannschaft das Netzfest im Hafen von Hohenfurt.',
    },
    {
      title: 'Irgendwann im Frühjahr',
      past: false,
      rhythm: 'once',
      weekday: '',
      day: 0,
      month: '',
      year: 0,
      place: '',
      who: [],
      quote: '',
    },
  ],
  relations: [
    {
      from: 'Mira Tannhaus',
      to: 'Odo Tannhaus',
      kind: 'family',
      quote: 'Mira ist die Schwester von Odo Tannhaus',
    },
    { from: 'Mira Tannhaus', to: 'Die Aalfischer', kind: 'member', quote: '' },
  ],
  threads: [
    {
      text: 'Mira schuldet Odo die Heuer eines ganzen Sommers',
      who: ['Mira Tannhaus', 'Odo Tannhaus'],
      place: '',
      quote: 'dem sie noch die Heuer eines ganzen Sommers schuldet',
    },
  ],
};

const apiReply = (reading: unknown, usage = { input_tokens: 1200, output_tokens: 300 }) =>
  JSON.stringify({
    content: [
      { type: 'thinking', thinking: '…' },
      { type: 'text', text: JSON.stringify(reading) },
    ],
    stop_reason: 'end_turn',
    usage,
  });

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  // Der Grundstand bringt eigene Termine mit; hier zählen nur die des Lesers.
  for (const id of Object.keys(db.getSnapshot().events)) db.remove('events', id);
  const town = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  db.put('entities', createEntity({ kind: 'place', name: 'Graufels' }));
  const mira = db.put('entities', createEntity({ kind: 'person', name: 'Mira Tannhaus' }));
  const odo = db.put('entities', createEntity({ kind: 'person', name: 'Odo Tannhaus' }));
  db.put('articles', article());
  const ask: Ask = async () => ({ status: 200, body: apiReply(READING) });
  return { db, town, mira, odo, ask };
}

describe('KI-Leser: Auftrag und Antwort', () => {
  it('gibt dem Modell Kalender, Titel und Text – und nichts sonst von der Welt', () => {
    const data = elarisCampaign();
    const request = buildReadRequest(data, article(), 'Schiffe');
    expect(request.user).toContain('Wochentage: Ruhnacht, Erdtag');
    expect(request.user).toContain('Monate: Tauwind');
    expect(request.user).toContain('Zeitrechnung: AD');
    expect(request.user).toContain('Heute ist der 17. Tauwind 701 AD.');
    expect(request.user).toContain('Artikel: Die Seeschwalbe (Schiffe)');
    expect(request.user).toContain('Schlagworte: Schiff');
    expect(request.user).toContain('Jeden Feuertag legt sie in Hohenfurt ab');
    expect(request.system).toContain('Erfinde nichts');
    expect(request.schema.required).toEqual(['events', 'relations', 'threads']);
  });

  it('liest die Antwort samt Verbrauch – auch wenn Worte um die Angaben stehen', () => {
    const reply = parseReply(200, apiReply(READING));
    expect(reply.reading.events).toHaveLength(3);
    expect(reply).toMatchObject({ inputTokens: 1200, outputTokens: 300 });
    const wrapped = JSON.stringify({
      content: [{ type: 'text', text: 'Hier:\n```json\n{"events":[],"relations":[]}\n```' }],
    });
    expect(parseReply(200, wrapped).reading).toEqual({ events: [], relations: [], threads: [] });
  });

  it('sagt in einem Satz, was schiefging', () => {
    expect(() => parseReply(401, '{"error":{"message":"invalid x-api-key"}}')).toThrow(
      /nimmt den Key nicht an/,
    );
    expect(replyProblem(400, '{"error":{"message":"Your credit balance is too low"}}')).toMatch(
      /Guthaben/,
    );
    expect(replyProblem(429, '')).toMatch(/kurz warten/);
    expect(replyProblem(529, '')).toMatch(/gestört/);
    expect(() => parseReply(200, 'kein JSON')).toThrow(/nicht lesbar/);
    expect(() =>
      parseReply(200, JSON.stringify({ content: [{ type: 'text', text: 'Nö.' }] })),
    ).toThrow(/vereinbarte Form/);
    expect(() => parseReply(200, JSON.stringify({ content: [], stop_reason: 'refusal' }))).toThrow(
      /abgelehnt/,
    );
  });

  it('schätzt und nennt Kosten', () => {
    const haiku = AI_MODELS[0]!;
    expect(estimateTokens('abcdef')).toBe(2);
    // Eine Million Bausteine lesen, hunderttausend schreiben.
    expect(costUsd(haiku, 1_000_000, 100_000)).toBeCloseTo(0.15, 6);
    expect(formatUsd(0.004)).toBe('unter 0,01 $');
    expect(formatUsd(4.5)).toBe('4,50 $');
    expect(formatUsd(0)).toBe('0,00 $');
  });

  it('merkt, ob ein Artikel (neu) gelesen werden sollte', () => {
    expect(needsReading(article())).toBe(true);
    expect(needsReading(article('Kurz.'))).toBe(false);
    expect(needsReading(article(TEXT, { template: true }))).toBe(false);
    const read = article(TEXT, {
      aiRead: {
        at: '',
        model: 'claude-haiku-5-5',
        mark: textMark(articleText(article())),
        inputTokens: 0,
        outputTokens: 0,
      },
    });
    expect(needsReading(read)).toBe(false);
    expect(needsReading({ ...read, docs: [{ ...read.docs[0]!, text: `${TEXT} Und mehr.` }] })).toBe(
      true,
    );
  });
});

describe('KI-Leser: Zeiten im Kalender', () => {
  const cal = ELARIS_CALENDAR;
  const base = { weekday: '', day: 0, month: '', year: 0 };

  it('findet den nächsten Wochentag, Monatstag und Jahrestag', () => {
    const weekly = eventTime(cal, ELARIS_START, {
      ...base,
      rhythm: 'weekly',
      weekday: 'feuertag',
    })!;
    expect(weekly.repeat).toEqual({ every: 1, unit: 'week' });
    expect(cal.weekdays[fromTime(cal, weekly.at).weekday]).toBe('Feuertag');
    expect(weekly.at).toBeGreaterThanOrEqual(ELARIS_START - 16 * 60);
    expect(weekly.at - ELARIS_START).toBeLessThan(7 * MINUTES_PER_DAY);

    // Heute ist der 17.: Der 20. kommt noch diesen Monat, der 5. erst im nächsten.
    const later = eventTime(cal, ELARIS_START, { ...base, rhythm: 'monthly', day: 20 })!;
    expect(fromTime(cal, later.at)).toMatchObject({ month: 0, day: 20 });
    const next = eventTime(cal, ELARIS_START, { ...base, rhythm: 'monthly', day: 5 })!;
    expect(fromTime(cal, next.at)).toMatchObject({ month: 1, day: 5 });

    const yearly = eventTime(cal, ELARIS_START, {
      ...base,
      rhythm: 'yearly',
      day: 3,
      month: 'Blüthain',
    })!;
    expect(fromTime(cal, yearly.at)).toMatchObject({ year: 701 + 27387, month: 2, day: 3 });
    // Der 2. Tauwind ist dieses Jahr schon vorbei.
    const past = eventTime(cal, ELARIS_START, {
      ...base,
      rhythm: 'yearly',
      day: 2,
      month: 'Tauwind',
    })!;
    expect(fromTime(cal, past.at).year).toBe(702 + 27387);
    expect(eventTime(cal, ELARIS_START, { ...base, rhythm: 'daily' })!.repeat).toEqual({
      every: 1,
      unit: 'day',
    });
  });

  it('rechnet ein einmaliges Datum aus der Zeitrechnung um und gibt auf, wenn etwas fehlt', () => {
    const once = eventTime(cal, ELARIS_START, {
      ...base,
      rhythm: 'once',
      day: 9,
      month: 'Erntfall',
      year: 650,
    })!;
    expect(once).toEqual({
      at: toTime(cal, { year: 650 + 27387, month: 5, day: 9, hour: 0, minute: 0 }),
      repeat: null,
    });
    expect(
      eventTime(cal, ELARIS_START, { ...base, rhythm: 'once', day: 9, month: 'Erntfall' }),
    ).toBeNull();
    expect(
      eventTime(cal, ELARIS_START, { ...base, rhythm: 'weekly', weekday: 'Montag' }),
    ).toBeNull();
    expect(
      eventTime(cal, ELARIS_START, { ...base, rhythm: 'yearly', day: 3, month: 'März' }),
    ).toBeNull();
    expect(eventTime(cal, ELARIS_START, { ...base, rhythm: 'monthly' })).toBeNull();
  });
});

describe('KI-Leser: lesen, vorschlagen, annehmen', () => {
  it('legt Vorschläge am Artikel ab und ändert die Welt noch nicht', async () => {
    const { db, town, mira, odo, ask } = await setup();
    const result = await readArticle(db, 'seeschwalbe', ask);
    expect(result.added).toBe(4);
    // Ohne Datum kein Termin; ohne bekannten Eintrag keine Beziehung.
    expect(result.skipped).toEqual([
      '„Irgendwann im Frühjahr“: Aus dem Text ergibt sich kein Datum.',
      'Beziehung: „Die Aalfischer“ kennt die Welt nicht (oder nicht eindeutig).',
    ]);
    expect(result.usd).toBeCloseTo((1200 * 0.1 + 300 * 0.5) / 1_000_000, 9);
    const read = db.getSnapshot().articles.seeschwalbe!;
    expect(read.aiRead).toMatchObject({ model: 'claude-haiku-5-5', inputTokens: 1200 });
    expect(read.aiHints.map((hint) => [hint.kind, hint.state])).toEqual([
      ['event', 'open'],
      ['event', 'open'],
      ['relation', 'open'],
      ['thread', 'open'],
    ]);
    const [sail, feast, family, debt] = read.aiHints;
    expect(sail!.line).toBe('Die Seeschwalbe legt ab – jeden Feuertag, in Hohenfurt');
    expect(sail!.quote).toContain('Jeden Feuertag legt sie');
    // Unbekannte Namen werden nicht verknüpft, bekannte schon.
    expect(sail!.payload).toMatchObject({
      placeId: town.id,
      refs: [mira.id],
      repeat: { unit: 'week' },
    });
    expect(feast!.line).toMatch(
      /^Das Netzfest beginnt – jedes Jahr, das nächste Mal am 3\. Blüthain 701 AD/,
    );
    expect(family!.line).toBe('Mira Tannhaus verwandt mit Odo Tannhaus');
    expect(debt!.payload).toMatchObject({ refs: [mira.id, odo.id] });
    expect(Object.keys(db.getSnapshot().events)).toHaveLength(0);
    expect(Object.keys(db.getSnapshot().relations)).toHaveLength(0);
    expect(unreadArticles(db.getSnapshot())).toEqual([]);
    expect(readingTotals(db.getSnapshot())).toMatchObject({ articles: 1, open: 4 });

    // Noch einmal dasselbe gelesen: nichts kommt doppelt.
    expect((await readArticle(db, 'seeschwalbe', ask)).added).toBe(0);
    expect(db.getSnapshot().articles.seeschwalbe!.aiHints).toHaveLength(4);
  });

  it('trägt beim Annehmen ein – Termin, Beziehung, Abmachung – und lässt es zurücknehmen', async () => {
    const { db, town, mira, odo, ask } = await setup();
    await readArticle(db, 'seeschwalbe', ask);
    const hints = () => db.getSnapshot().articles.seeschwalbe!.aiHints;
    const [sail, feast, family, debt] = hints();

    const undoSail = acceptAiHint(db, 'seeschwalbe', sail!.id)!;
    const events = Object.values(db.getSnapshot().events);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      title: 'Die Seeschwalbe legt ab',
      kind: 'world',
      placeId: town.id,
      refs: [mira.id],
      repeat: { every: 1, unit: 'week' },
      done: false,
      details: 'Aus dem Artikel „Die Seeschwalbe“.',
    });
    expect(hints()[0]!.state).toBe('accepted');
    // Ein angenommener Vorschlag lässt sich nicht noch einmal annehmen.
    expect(acceptAiHint(db, 'seeschwalbe', sail!.id)).toBeNull();
    undoSail();
    expect(Object.keys(db.getSnapshot().events)).toHaveLength(0);
    expect(hints()[0]!.state).toBe('open');

    acceptAiHint(db, 'seeschwalbe', family!.id);
    expect(Object.values(db.getSnapshot().relations)).toMatchObject([
      { from: mira.id, to: odo.id, type: 'family' },
    ]);
    acceptAiHint(db, 'seeschwalbe', debt!.id);
    const promises = Object.values(db.getSnapshot().chronicle).filter(
      (entry) => entry.kind === 'promise',
    );
    expect(promises).toMatchObject([
      { text: 'Mira schuldet Odo die Heuer eines ganzen Sommers', refs: [mira.id, odo.id] },
    ]);

    const undoDismiss = dismissAiHint(db, 'seeschwalbe', feast!.id);
    expect(hints()[1]!.state).toBe('dismissed');
    expect(readingTotals(db.getSnapshot()).open).toBe(1);
    undoDismiss();
    expect(hints()[1]!.state).toBe('open');

    // Was schon in der Welt steht, schlägt ein erneutes Lesen nicht wieder vor.
    db.patch('articles', 'seeschwalbe', { aiHints: [] });
    const again = await readArticle(db, 'seeschwalbe', ask);
    expect(db.getSnapshot().articles.seeschwalbe!.aiHints.map((hint) => hint.kind)).toEqual([
      'event',
      'event',
    ]);
    expect(again.added).toBe(2);
  });

  it('trägt Wissen und Geheimnisse ohne Datum bei der Person ein – nicht als Abmachung', async () => {
    const { db, mira } = await setup();
    const reading: Reading = {
      events: [],
      relations: [],
      threads: [
        {
          text: 'Mira weiß nicht, was Odo im Wrack der Seeschwalbe fand',
          sort: 'secret',
          who: ['Mira Tannhaus', 'Odo Tannhaus'],
          place: '',
          quote: 'Was ihr Bruder im Wrack fand, hat Mira nie erfahren.',
        },
        // Ältere Vorschläge nennen die Art nicht: Dann entscheiden die Worte.
        { text: 'Odo verheimlicht seine Schulden', who: ['Odo Tannhaus'], place: '', quote: '' },
        // Ohne jemanden, bei dem es stehen könnte, gehört es zum Eintrag des Artikels – hier
        // gibt es keinen.
        {
          text: 'Niemand weiß, wer das Leuchtfeuer löschte',
          sort: 'secret',
          who: [],
          place: '',
          quote: '',
        },
      ],
    };
    const result = await readArticle(db, 'seeschwalbe', async () => ({
      status: 200,
      body: apiReply(reading),
    }));
    expect(result.added).toBe(2);
    expect(result.skipped).toEqual([
      '„Niemand weiß, wer das Leuchtfeuer löschte“: Dazu gibt es in der Welt niemanden, bei dem es stehen könnte.',
    ]);
    const [secret, hidden] = db.getSnapshot().articles.seeschwalbe!.aiHints;
    expect(secret!.payload).toMatchObject({ sort: 'secret' });
    expect(hidden!.payload).toMatchObject({ sort: 'secret' });
    const entries = Object.keys(db.getSnapshot().chronicle).length;
    const undo = acceptAiHint(db, 'seeschwalbe', secret!.id)!;
    // Es steht im Dossier der Person, im Feld „Geheimnis“ – die Chronik bleibt, wie sie war.
    expect(db.getSnapshot().entities[mira.id]!.secret).toBe(
      'Mira weiß nicht, was Odo im Wrack der Seeschwalbe fand',
    );
    expect(Object.keys(db.getSnapshot().chronicle)).toHaveLength(entries);
    undo();
    expect(db.getSnapshot().entities[mira.id]!.secret).toBe('');
    expect(db.getSnapshot().articles.seeschwalbe!.aiHints[0]!.state).toBe('open');
    expect(threadSort('Mira schuldet Odo die Heuer')).toBe('promise');
    expect(threadSort('Aldo ahnt nicht, wer ihn verriet')).toBe('secret');
  });

  it('trägt eine Spur oder offene Frage als Faden ein – nicht als Abmachung oder Geheimnis', async () => {
    const { db, mira } = await setup();
    const trail =
      'Die Wolfsfährten führen nach Norden, tiefer in den Wald; woher das Gift stammt, ist noch unbekannt';
    const reading: Reading = {
      events: [],
      relations: [],
      threads: [
        {
          text: trail,
          sort: 'lead',
          who: ['Mira Tannhaus'],
          place: '',
          quote: 'Die Fährten verloren sich im Norden.',
        },
        {
          text: 'Odo schuldet dem Hafenmeister eine Antwort',
          sort: 'promise',
          who: ['Odo Tannhaus'],
          place: '',
          quote: '',
        },
      ],
    };
    const result = await readArticle(db, 'seeschwalbe', async () => ({
      status: 200,
      body: apiReply(reading),
    }));
    expect(result.added).toBe(2);
    const [lead, debt] = db.getSnapshot().articles.seeschwalbe!.aiHints;
    const threads = () => Object.values(db.getSnapshot().threads);
    const entries = Object.keys(db.getSnapshot().chronicle).length;
    const undo = acceptAiHint(db, 'seeschwalbe', lead!.id)!;
    expect(threads()).toHaveLength(1);
    expect(threads()[0]).toMatchObject({
      title: trail,
      refs: [mira.id],
      state: 'open',
      articleId: 'seeschwalbe',
    });
    // Kein Eintrag in der Chronik, kein Geheimnis im Dossier.
    expect(Object.keys(db.getSnapshot().chronicle)).toHaveLength(entries);
    expect(db.getSnapshot().entities[mira.id]!.secret).toBe('');
    undo();
    expect(threads()).toHaveLength(0);
    // Was der Leser als Abmachung sah, kann der Spielleiter trotzdem zum Faden machen.
    acceptAiHint(db, 'seeschwalbe', debt!.id, 'lead');
    expect(threads().map((thread) => thread.title)).toEqual([
      'Odo schuldet dem Hafenmeister eine Antwort',
    ]);
    // Ein zweites Lesen schlägt den Faden nicht noch einmal vor.
    db.patch('articles', 'seeschwalbe', { aiHints: [] });
    const again = await readArticle(db, 'seeschwalbe', async () => ({
      status: 200,
      body: apiReply(reading),
    }));
    expect(again.added).toBe(1);
    // Ältere Vorschläge nennen die Art nicht: Dann entscheiden die Worte.
    expect(threadSort('Die Spuren führen nach Südwesten; die Quelle ist noch unbekannt')).toBe(
      'lead',
    );
  });

  it('trägt Vergangenes nie als „ab heute“ ein', async () => {
    const { db } = await setup();
    const past = { past: true, weekday: '', place: '', who: [], quote: '' };
    const reading: Reading = {
      events: [
        // Früher regelmäßig, heute nicht mehr: kein Termin.
        {
          ...past,
          title: 'Der Rat tagte jeden Monat',
          rhythm: 'monthly',
          day: 5,
          month: '',
          year: 0,
        },
        // Vergangen mit genauem Datum: steht an seinem Tag und ist schon eingetreten.
        {
          ...past,
          title: 'Die Seeschwalbe sinkt',
          rhythm: 'once',
          day: 4,
          month: 'Blüthain',
          year: 650,
        },
      ],
      relations: [],
      threads: [],
    };
    const result = await readArticle(db, 'seeschwalbe', async () => ({
      status: 200,
      body: apiReply(reading),
    }));
    expect(result.skipped).toEqual([
      '„Der Rat tagte jeden Monat“: Das ist schon geschehen und hat kein genaues Datum.',
    ]);
    const [sunk] = db.getSnapshot().articles.seeschwalbe!.aiHints;
    expect(sunk!.payload).toMatchObject({ done: true, repeat: null });
    expect((sunk!.payload as { at: number }).at).toBeLessThan(db.getSnapshot().state.now);
  });

  it('meldet Fehler als Satz und lässt den Artikel dann unberührt', async () => {
    const { db } = await setup();
    await expect(
      readArticle(db, 'seeschwalbe', async () => ({ status: 401, body: '{}' })),
    ).rejects.toThrow(/nimmt den Key nicht an/);
    await expect(
      readArticle(db, 'gibt-es-nicht', async () => ({ status: 200, body: '' })),
    ).rejects.toThrow(/gibt es nicht/);
    db.put('articles', article('Zu kurz.', { id: 'kurz' }));
    await expect(readArticle(db, 'kurz', async () => ({ status: 200, body: '' }))).rejects.toThrow(
      /zu wenig Text/,
    );
    expect(db.getSnapshot().articles.seeschwalbe!.aiRead).toBeNull();
  });
});
