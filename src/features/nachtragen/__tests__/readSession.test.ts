/** Eine nachgetragene Session lesen: Vorschläge, Rückblick, Zeit, Fragen, Widersprüche, erneutes Lesen. */
import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../../data/db';
import { MemoryStore } from '../../../data/store';
import { dayIndexOf, minuteOfDay } from '../../../domain/time/calendar';
import type { ReadProposal, SessionReading } from '../../../domain/schema';
import {
  MAX_PROPOSALS,
  isSafeProposal,
  mergeReading,
  proposalInput,
  proposalKey,
  proposalKindLabel,
  readSession,
  secretSentences,
  splitSentences,
} from '../readSession';
import { storeReading } from '../readActions';
import {
  ABEND_EINS,
  ABEND_RUECKKEHR,
  ABEND_STADT,
  ABEND_ZWEI,
  at,
  noted,
  readWorld,
  withSessions,
} from './readWorld';

const READ_AT = '2026-11-13T10:00:00.000Z';
const first = (reading: SessionReading, kind: ReadProposal['kind']) =>
  reading.proposals.find((p) => p.kind === kind);
const all = (reading: SessionReading, kind: ReadProposal['kind']) =>
  reading.proposals.filter((p) => p.kind === kind);

function eins(sessions: 'allein' | 'mit-zwei' | 'mit-rueckkehr' = 'allein') {
  const w = readWorld();
  const s1 = noted(1, ABEND_EINS, at(3, 1, 701, 9), at(5, 1, 701, 22));
  const extra =
    sessions === 'mit-zwei'
      ? [noted(2, ABEND_ZWEI, at(6, 1, 701, 9), at(6, 1, 701, 22))]
      : sessions === 'mit-rueckkehr'
        ? [noted(2, ABEND_RUECKKEHR, at(6, 1, 701, 9), at(6, 1, 701, 22))]
        : [];
  const data = withSessions(w, s1, ...extra);
  return { w, data, s1, reading: readSession(data, s1, { readAt: READ_AT }) };
}

describe('Sätze', () => {
  it('teilt Sätze, ohne an „8. Runde“, „Dr.“ oder Initialen zu trennen', () => {
    const text =
      'Dr. Odo kam in der 8. Runde. Er sprach mit K. Brack! Danach „Lauft! Schnell.“ rief Mira.';
    expect(splitSentences(text).map((s) => text.slice(s.from, s.to))).toEqual([
      'Dr. Odo kam in der 8. Runde.',
      'Er sprach mit K. Brack!',
      'Danach „Lauft! Schnell.“ rief Mira.',
    ]);
  });

  it('erkennt Geheimes für die Spielleitung – bis zum Ende der Zeile', () => {
    const line = 'Brann schlief. Was er selbst noch nicht weiß: Odo lügt. Er plant den Verrat.';
    const spans = splitSentences(line);
    expect(secretSentences(line, spans)).toEqual([false, true, true]);
    const meta = 'Odo spielte noch keine Rolle. Es gab keinen Kontakt.';
    expect(secretSentences(meta, splitSentences(meta))).toEqual([true, true]);
    const one = 'Mira ahnte es (geheim). Brann lachte.';
    expect(secretSentences(one, splitSentences(one))).toEqual([true, false]);
  });
});

describe('Eine Session lesen', () => {
  it('löst den Rückblick heraus und liest aus ihm nichts', () => {
    const { reading } = eins();
    expect(reading.recap).toContain('Ihr seid nach langer Reise in Hohenfurt angekommen.');
    expect(reading.proposals.every((p) => p.line > 5)).toBe(true);
    expect(reading.sections[0]).toEqual({ kind: 'recap', from: 1, to: 4, title: 'Intro' });
  });

  it('schlägt Ortswechsel, Auftrag und Schicksal aus den Sätzen vor', () => {
    const { w, reading } = eins();
    expect(first(reading, 'travel')).toMatchObject({
      payload: { travel: { toId: w.hohenfurt.id } },
      quote: 'Sind in Hohenfurt angekommen, haben mit Odo Kesssler gesprochen.',
      line: 8,
    });
    expect(first(reading, 'promise')).toMatchObject({ payload: { promise: { sort: 'job' } } });
    expect(first(reading, 'fate')).toMatchObject({
      label: 'Schicksal: Krummzahn → tot',
      payload: { fate: { entityId: w.krummzahn.id, status: 'dead' } },
      refs: [w.krummzahn.id],
      quote: 'Brann hat Krummzahn erschlagen.',
    });
  });

  it('merkt sich einen Decknamen als zweiten Namen und fragt nach Unbekannten', () => {
    const { w, reading } = eins();
    const alias = reading.proposals.find((p) => p.label.startsWith('Zweiter Name'));
    expect(alias).toMatchObject({
      kind: 'note',
      label: 'Zweiter Name: Wido (Lando Furtner)',
      payload: { aliases: [{ entityId: w.lando.id, name: 'Wido' }] },
    });
    expect(reading.questions).toEqual([
      { key: 'tesa', name: 'Tessa', count: 2, lines: [11], state: 'open', entityId: null },
    ]);
    expect(alias!.names).toEqual(['tesa']);
  });

  it('liest eine Wandlung des Gefährten', () => {
    const { w, reading } = eins();
    expect(first(reading, 'transformation')).toMatchObject({
      payload: { transformation: { characterId: w.mira.id } },
      quote: '8 Uhr - Mira hat Hörner aus Bernstein bekommen.',
    });
  });

  it('schlägt den Brief als Schriftstück vor – wörtlich, mit Titel und Absender', () => {
    const { w, reading } = eins();
    const writing = first(reading, 'writing')!;
    expect(writing.text).toBe(
      'Mira,\nkommt nicht in die Grotte. Dort wartet die Bande.\nGrüße, Hagen',
    );
    expect(writing.payload).toEqual({ writing: { title: 'Nachricht von Hagen Brack' } });
    expect(writing.refs).toEqual([w.hagen.id]);
    // Die ankündigende Zeile ist keine eigene Notiz.
    expect(reading.proposals.some((p) => p.line === 14 && p.kind === 'note')).toBe(false);
  });

  it('hält Geheimes als Notiz nur für die Spielleitung', () => {
    const { w, reading } = eins();
    const secret = reading.proposals.find((p) => p.secret)!;
    expect(secret).toMatchObject({ kind: 'note', line: 19 });
    expect(secret.refs.sort()).toEqual([w.odo.id, w.bande.id].sort());
  });

  it('macht aus der Beuteliste je Quelle einen Vorschlag – Münzen als Gold', () => {
    const { w, reading } = eins();
    expect(all(reading, 'loot').map((p) => p.payload)).toEqual([
      {
        text: 'Rostiger Schlüssel',
        gold: 12.5,
        toId: null,
        source: 'Krummzahn',
        items: ['Rostiger Schlüssel'],
      },
      {
        text: 'Eine Karte der Salzgrotte',
        gold: 3,
        toId: null,
        source: 'Schmuggler',
        items: ['Eine Karte der Salzgrotte'],
      },
    ]);
    expect(all(reading, 'loot')[0]!.refs).toEqual([w.krummzahn.id]);
  });

  it('macht aus der Liste offener Fäden je Punkt einen Faden – nur der Wortlaut', () => {
    const { w, reading } = eins();
    expect(all(reading, 'thread').map((p) => p.payload)).toEqual([
      { title: 'Der Schlüssel der Grotte' },
      { title: 'Wer bezahlt die Krähenbande?' },
    ]);
    expect(all(reading, 'thread')[1]!.refs).toEqual([w.bande.id]);
  });

  it('liest aus Regelwerten und dem Ende der Session nichts', () => {
    const { reading } = eins();
    expect(reading.sections.map((s) => s.kind)).toContain('rules');
    expect(reading.proposals.some((p) => /Lair|Lv\.1|endete/.test(p.quote))).toBe(false);
  });

  it('verteilt die Zeit in der Reihenfolge des Textes – „Nächster Tag“, „8 Uhr“', () => {
    const { s1, reading } = eins();
    const times = reading.proposals.map((p) => p.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const before = first(reading, 'fate')!;
    const after = first(reading, 'transformation')!;
    expect(dayIndexOf(before.at)).toBe(dayIndexOf(s1.startAt));
    expect(dayIndexOf(after.at)).toBe(dayIndexOf(s1.startAt) + 1);
    expect(minuteOfDay(after.at)).toBe(8 * 60);
    expect(after.precision).toBe('approx');
    expect(before.precision).toBe('order');
  });

  it('bleibt bei höchstens zwanzig Vorschlägen', () => {
    const w = readWorld();
    const many = Array.from(
      { length: 40 },
      (_, i) => `Brann sprach mit Odo Kessler über den ${i + 1}. Brief und verließ dann Hohenfurt.`,
    ).join('\n');
    const session = noted(4, many, at(3, 1, 701, 9), at(5, 1, 701, 22));
    const reading = readSession(withSessions(w, session), session);
    expect(reading.proposals.length).toBeLessThanOrEqual(MAX_PROPOSALS);
    expect(reading.proposals.length).toBeGreaterThan(8);
  });

  it('liest Einkäufe an den Empfänger, Bestellung, Zwischenzeit, Gesetz und Zitat', () => {
    const w = readWorld();
    const session = noted(3, ABEND_STADT, at(8, 1, 701, 9), at(9, 1, 701, 22));
    const reading = readSession(withSessions(w, session), session);
    expect(all(reading, 'loot').map((p) => [p.payload.text, p.payload.toId])).toEqual([
      ['Kurzschwert +1', w.lando.id],
      ['Laterne', w.mira.id],
    ]);
    expect(reading.proposals.find((p) => p.label === 'Bestellung')?.text).toBe(
      'Lando gibt folgendes beim Krämer in Auftrag:\n1 Seil\n1 Zelt',
    );
    expect(first(reading, 'downtime')!.payload).toEqual({
      downtime: {
        days: 21,
        activities: [
          { characterId: w.mira.id, text: 'Übt mit dem Bogen.' },
          { characterId: w.lando.id, text: 'Schmuggelt drei Wochen lang Salz.' },
          { characterId: w.brann.id, text: 'Repariert die Mühle.' },
        ],
      },
    });
    expect(first(reading, 'writing')).toMatchObject({
      payload: { writing: { title: 'Recht der Furt' } },
      text: '## Recht der Furt\n> **Über den Zoll**\n> Wer die Furt quert, zahlt zwei Kupfer.',
    });
    expect(first(reading, 'quote')).toMatchObject({ text: '„Wohin jetzt?“', refs: [w.brann.id] });
    // Was in den Zeilen der Zwischenzeit steht, ist Tätigkeit, kein eigenes Geschehen.
    expect(reading.proposals.filter((p) => p.line <= 3)).toHaveLength(1);
  });
});

describe('Schicksal in den Wendungen der Notizen', () => {
  const read = (text: string) => {
    const w = readWorld();
    const session = noted(5, text, at(3, 1, 701, 9), at(3, 1, 701, 22));
    return { w, reading: readSession(withSessions(w, session), session) };
  };
  const fates = (reading: SessionReading) =>
    all(reading, 'fate').map((p) => p.payload.fate as { entityId: string | null; status: string });

  it('„erschlug A B“: B stirbt', () => {
    const { w, reading } = read('Im Hof erschlug Brann Krummzahn.');
    expect(fates(reading)).toEqual([{ entityId: w.krummzahn.id, status: 'dead' }]);
  });

  it('„auf Geheiß von X“ macht X nicht zum Opfer', () => {
    const { reading } = read('Odo Kessler erstach auf Geheiß von Krummzahn einen Wächter.');
    expect(fates(reading)).toEqual([]);
  });

  it('Nebensatz „…, die X fast sofort tötete“ und „X’ Schicksal besiegelt“ – einmal', () => {
    const { w, reading } = read(
      'Odo wirkte einen Zauber, der Mira fast sofort tötete. Brann bat um Gnade, doch Pfeile besiegelten Miras Schicksal.',
    );
    expect(reading.proposals.filter((p) => p.kind === 'fate')).toHaveLength(1);
    expect(fates(reading)).toEqual([{ entityId: w.mira.id, status: 'dead' }]);
  });

  it('„um hingerichtet zu werden“ ist noch kein Tod; ein Gegenstand, der verschwindet, auch nicht', () => {
    const { reading } = read(
      'Krummzahn wird nach Hohenfurt gebracht, um hingerichtet zu werden.\nBei Mira war das Amulett verschwunden.',
    );
    expect(fates(reading)).toEqual([]);
  });

  it('„Ein Eid holte X zurück“ ist eine Rückkehr', () => {
    const { w, reading } = read('Ein alter Eid holte Mira zurück und vertrieb den Schatten.');
    expect(fates(reading)).toEqual([{ entityId: w.mira.id, status: 'alive' }]);
  });

  it('einen unbekannten Namen schlägt es mit dem Namen vor', () => {
    const { reading } = read('Wilmar wurde getötet.');
    expect(first(reading, 'fate')).toMatchObject({
      label: 'Schicksal: Wilmar → tot',
      payload: { fate: { entityId: null, status: 'dead' }, name: 'Wilmar' },
    });
  });

  it('liest den wahren Namen eines Gefährten', () => {
    const { w, reading } = read(
      'Odo erzählte Mira von einem Dorf. Am Feuer verriet sie ihren wahren Namen: Mirabel Tann.',
    );
    expect(first(reading, 'reveal')).toMatchObject({
      payload: {
        reveal: { prepSecretId: null, alias: { entityId: w.mira.id, name: 'Mirabel Tann' } },
      },
    });
  });

  it('liest einen Aufstieg der ganzen Gruppe als einen Vorschlag', () => {
    const { reading } = read('Am Ende des Abends haben alle Stufe 4 erreicht.');
    expect(all(reading, 'milestone').map((p) => p.payload)).toEqual([
      { milestone: { characterId: null, level: 4 }, party: true },
    ]);
  });
});

describe('Widersprüche', () => {
  it('weist hin, wenn ein Toter in einer späteren Session wieder handelt', () => {
    const { reading } = eins('mit-zwei');
    expect(first(reading, 'fate')!.hints).toEqual([
      'In Session 2 (Zeile 1) kommt Krummzahn wieder vor – tot hier, aber dort ohne Rückkehr.',
    ]);
    expect(isSafeProposal(reading, first(reading, 'fate')!)).toBe(false);
  });

  it('schweigt, wenn die spätere Session die Rückkehr erzählt', () => {
    const { reading } = eins('mit-rueckkehr');
    expect(first(reading, 'fate')!.hints).toEqual([]);
  });

  it('weist bei einer Rückkehr hin, wenn vorher niemand gestorben ist', () => {
    const w = readWorld();
    const session = noted(1, ABEND_RUECKKEHR, at(3, 1, 701, 9), at(3, 1, 701, 22));
    const reading = readSession(withSessions(w, session), session);
    expect(first(reading, 'fate')!.hints).toEqual([
      'Vorher steht nirgends, dass Krummzahn tot oder verschollen war.',
    ]);
  });
});

describe('Erneut lesen', () => {
  it('hat feste Schlüssel aus Art und Satz', () => {
    expect(proposalKey('fate', 'Brann hat  Krummzahn erschlagen!')).toBe(
      proposalKey('fate', 'brann hat krummzahn erschlagen'),
    );
    const { data, s1, reading } = eins();
    const again = readSession(data, s1, { readAt: READ_AT });
    expect(again.proposals.map((p) => p.key)).toEqual(reading.proposals.map((p) => p.key));
    expect(new Set(reading.proposals.map((p) => p.key)).size).toBe(reading.proposals.length);
  });

  it('behält Entscheidungen und Antworten; Verschwundenes bleibt als „nicht mehr da“', () => {
    const { data, s1, reading } = eins();
    const fate = first(reading, 'fate')!;
    const job = first(reading, 'promise')!;
    const decided: SessionReading = {
      ...reading,
      proposals: reading.proposals.map((p) =>
        p.id === fate.id
          ? { ...p, state: 'accepted', created: [{ collection: 'chronicle', id: 'e1' }] }
          : p.id === job.id
            ? { ...p, state: 'dismissed' }
            : p,
      ),
      questions: reading.questions.map((q) => ({ ...q, state: 'none' })),
    };
    // Die Notizen ändern sich: Der Satz mit dem Auftrag fällt weg.
    const changed = {
      ...s1,
      source: {
        ...s1.source!,
        text: ABEND_EINS.replace('Haben den Auftrag für die Salzgrotte bekommen.\n', ''),
      },
    };
    const next = readSession(data, changed, { readAt: READ_AT, previous: decided });
    const keptFate = next.proposals.find((p) => p.key === fate.key)!;
    expect(keptFate).toMatchObject({
      id: fate.id,
      state: 'accepted',
      stale: false,
      line: fate.line - 1,
    });
    expect(keptFate.created).toEqual([{ collection: 'chronicle', id: 'e1' }]);
    expect(next.proposals.find((p) => p.key === job.key)).toMatchObject({
      state: 'dismissed',
      stale: true,
    });
    expect(next.questions[0]!.state).toBe('none');
    // Offenes behält seine Kennung.
    const travel = first(reading, 'travel')!;
    expect(next.proposals.find((p) => p.key === travel.key)?.id).toBe(travel.id);
  });

  it('mergeReading ohne Vorstand ändert nichts', () => {
    const { reading } = eins();
    const empty: SessionReading = { ...reading, proposals: [], questions: [] };
    expect(mergeReading(empty, reading)).toEqual(reading);
  });
});

describe('Sicher annehmen', () => {
  it('nennt sicher, was keine Frage, keinen Widerspruch und kein offenes Ding hat', () => {
    const { reading } = eins();
    const safe = (kind: ReadProposal['kind']) => isSafeProposal(reading, first(reading, kind)!);
    expect(safe('travel')).toBe(true);
    expect(safe('fate')).toBe(true);
    expect(safe('loot')).toBe(true);
    // Der Deckname steht in einem Satz mit dem unbekannten Namen „Tessa“.
    expect(
      isSafeProposal(
        reading,
        reading.proposals.find((p) => p.names.length)!,
      ),
    ).toBe(false);
  });

  it('benennt die Arten', () => {
    expect(proposalKindLabel('thread')).toBe('Faden');
    expect(proposalKindLabel('loot')).toBe('Beute');
    expect(proposalKindLabel('fate')).toBe('Schicksal');
  });
});

describe('Eingabe zum Annehmen', () => {
  it('macht aus einem Vorschlag einen nachgetragenen Eintrag zur Zeit des Vorschlags', () => {
    const { w, s1, reading } = eins();
    const fate = first(reading, 'fate')!;
    expect(proposalInput(fate, s1.id)).toEqual({
      kind: 'fate',
      refs: [w.krummzahn.id],
      fate: { entityId: w.krummzahn.id, status: 'dead' },
      text: 'Brann hat Krummzahn erschlagen.',
      at: fate.at,
      sessionId: s1.id,
      secret: false,
      backfilled: true,
      precision: 'order',
    });
    expect(proposalInput(first(reading, 'writing')!, s1.id)).toMatchObject({
      kind: 'writing',
      writing: { title: 'Nachricht von Hagen Brack' },
      text: 'Mira,\nkommt nicht in die Grotte. Dort wartet die Bande.\nGrüße, Hagen',
    });
    expect(proposalInput(first(reading, 'loot')!, s1.id)).toBeNull();
    expect(proposalInput(first(reading, 'thread')!, s1.id)).toBeNull();
  });
});

describe('Lesen speichern', () => {
  it('legt den Stand und den Rückblick an die Session; erneutes Lesen behält Entscheidungen', async () => {
    const w = readWorld();
    const db = await CampaignDb.create(new MemoryStore(), w.data);
    const session = db.put('sessions', noted(1, ABEND_EINS, at(3, 1, 701, 9), at(5, 1, 701, 22)));
    const result = storeReading(db, session.id, READ_AT)!;
    const stored = db.getSnapshot().sessions[session.id]!;
    expect(stored.reading?.proposals.length).toBe(result.reading.proposals.length);
    expect(stored.recap).toBe(result.reading.recap);

    // Der Spielleiter verwirft einen Vorschlag und ändert den Rückblick von Hand.
    const dismissed = result.reading.proposals[0]!;
    db.patch('sessions', session.id, {
      recap: 'Mein eigener Rückblick.',
      reading: {
        ...stored.reading!,
        proposals: stored.reading!.proposals.map((p) =>
          p.id === dismissed.id ? { ...p, state: 'dismissed' as const } : p,
        ),
      },
    });
    const again = storeReading(db, session.id, READ_AT)!;
    expect(again.reading.proposals.find((p) => p.id === dismissed.id)?.state).toBe('dismissed');
    expect(db.getSnapshot().sessions[session.id]!.recap).toBe('Mein eigener Rückblick.');

    again.undo();
    expect(
      db.getSnapshot().sessions[session.id]!.reading?.proposals.find((p) => p.id === dismissed.id)
        ?.state,
    ).toBe('dismissed');
    expect(storeReading(db, 'gibt-es-nicht')).toBeNull();
  });
});
