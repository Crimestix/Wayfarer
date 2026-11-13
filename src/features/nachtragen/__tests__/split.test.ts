import { describe, expect, it } from 'vitest';
import { formatDate } from '../../../domain/time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../../../domain/time/elaris';
import type { NotesFile } from '../read';
import { markdownHeadings } from '../read';
import { findRealDates, missingNumbers, readBoundary, splitSessions } from '../split';

const cal = ELARIS_CALENDAR;
const now = ELARIS_START;

const txt = (name: string, text: string): NotesFile => ({
  name,
  kind: 'txt',
  text,
  headings: [],
  encoding: 'utf-8',
});
const md = (name: string, text: string): NotesFile => ({
  name,
  kind: 'md',
  text,
  headings: markdownHeadings(text),
  encoding: 'utf-8',
});

const mark = (line: string, heading = false) => {
  const m = readBoundary(line, heading);
  return m && [m.number, m.title, m.realDate];
};

describe('Grenzen erkennen', () => {
  it('liest Nummern in vielen Schreibweisen', () => {
    expect(mark('Session 5')).toEqual([5, '', '']);
    expect(mark('Sitzung 12: Der Salzkahn')).toEqual([12, 'Der Salzkahn', '']);
    expect(mark('S5 – Krummzahns Bau')).toEqual([5, 'Krummzahns Bau', '']);
    expect(mark('Spielabend 3')).toEqual([3, '', '']);
    expect(mark('#7 Der Salzkahn')).toEqual([7, 'Der Salzkahn', '']);
    expect(mark('5. Session')).toEqual([5, '', '']);
    expect(mark('## Session Nr. 04 – „Salzgrotte“')).toEqual([4, 'Salzgrotte', '']);
    expect(mark('**Session 6**')).toEqual([6, '', '']);
    expect(mark('**Session 6** – Ohne Mira')).toEqual([6, 'Ohne Mira', '']);
  });

  it('liest echte Daten, auch zusammen mit Nummer und Titel', () => {
    expect(mark('Session 5 – Krummzahns Bau (07.06.2026)')).toEqual([
      5,
      'Krummzahns Bau',
      '2026-06-07',
    ]);
    expect(mark('12.04.2026')).toEqual([null, '', '2026-04-12']);
    expect(mark('Sa, 12. April 2026 – Ankunft in Hohenfurt')).toEqual([
      null,
      'Ankunft in Hohenfurt',
      '2026-04-12',
    ]);
    expect(mark('2026-04-26')).toEqual([null, '', '2026-04-26']);
    expect(mark('Sitzung vom 10.05.26')).toEqual([null, '', '2026-05-10']);
    expect(mark('Sitzung 12.04.2026')).toEqual([null, '', '2026-04-12']);
    expect(mark('Session 2 (Samstag, 26.04.2026)')).toEqual([2, '', '2026-04-26']);
  });

  it('hält Fließtext nicht für eine Grenze', () => {
    expect(mark('Session 5 war super, Lando kam zu spät.')).toBeNull();
    expect(mark('In Session 3 haben wir Krummzahn getroffen.')).toBeNull();
    expect(mark('12.04.2026 waren wir alle müde.')).toBeNull();
    expect(mark('Session 5er-Würfel')).toBeNull();
    expect(mark('Am 12.04.2026 gespielt')).toBeNull();
    expect(mark('Sessions sind lang')).toBeNull();
    expect(mark('31.02.2026')).toBeNull();
    expect(mark('Session 5: ' + 'sehr lang '.repeat(12))).toBeNull();
    expect(mark('So geht es weiter')).toBeNull();
  });

  it('nimmt nackte Nummern nur in Überschriften', () => {
    expect(mark('5 – Krummzahns Bau')).toBeNull();
    expect(mark('## 5 – Krummzahns Bau', true)).toEqual([5, 'Krummzahns Bau', '']);
  });

  it('findet echte Daten im Text', () => {
    expect(
      findRealDates('gespielt am 7.6.26 und 2026-06-21, nicht 1.13.2026').map((d) => d.iso),
    ).toEqual(['2026-06-07', '2026-06-21']);
  });
});

describe('Notizen in Sessions trennen', () => {
  it('trennt eine Datei an „Session n“ und hält den Text wörtlich', () => {
    const text = [
      'Elaris – meine Notizen',
      'bitte nicht verlieren',
      '',
      'Session 1 – Ankunft in Hohenfurt (12.04.2026)',
      'Mira Tannhaus empfängt die Gruppe am 3. Tauwind 701.',
      '',
      'Am 4. Tauwind geht es zum Markt.',
      '',
      'Session 2',
      '26.04.2026',
      '',
      'Lando Furtner verlangt Zoll.',
    ].join('\n');
    const drafts = splitSessions([txt('notizen.txt', text)], cal, now);
    expect(drafts.map((d) => [d.number, d.title, d.realDate, d.vorspann])).toEqual([
      [null, 'Vorspann', '', true],
      [1, 'Ankunft in Hohenfurt', '2026-04-12', false],
      [2, '', '2026-04-26', false],
    ]);
    const [vorspann, one, two] = drafts;
    expect(vorspann!.text).toBe('Elaris – meine Notizen\nbitte nicht verlieren');
    expect(vorspann!.notes[0]).toMatch(/Text vor der ersten Session/);
    expect(one!.heading).toBe('Session 1 – Ankunft in Hohenfurt (12.04.2026)');
    expect(one!.text).toBe(
      'Mira Tannhaus empfängt die Gruppe am 3. Tauwind 701.\n\nAm 4. Tauwind geht es zum Markt.',
    );
    expect(text.slice(one!.source.textFrom, one!.source.textFrom + one!.text.length)).toBe(
      one!.text,
    );
    expect(one!.source.line).toBe(4);
    expect(text.slice(one!.source.from, one!.source.to).startsWith('Session 1')).toBe(true);
    expect(one!.source.to).toBe(two!.source.from);
    expect(one!.worldDates.map((d) => [d.where, formatDate(cal, d.time), d.assumedYear])).toEqual([
      ['text', '3. Tauwind 701 AD', false],
      ['text', '4. Tauwind 701 AD', true],
    ]);
    expect(one!.notes.some((n) => n.includes('„4. Tauwind“') && n.includes('laufendes Jahr'))).toBe(
      true,
    );
    // „Session 2“ und das Datum darunter sind eine Grenze.
    expect(two!.heading).toBe('Session 2\n26.04.2026');
    expect(two!.text).toBe('Lando Furtner verlangt Zoll.');
  });

  it('liest Tage des Kalenders in der Überschrift, nicht als Titel', () => {
    const drafts = splitSessions(
      [txt('a.txt', 'Session 3 – Die Tiefe Pforte (5. Tauwind 701)\nKrummzahn flieht.')],
      cal,
      now,
    );
    expect(drafts[0]!.title).toBe('Die Tiefe Pforte');
    expect(drafts[0]!.worldDates.map((d) => [d.where, formatDate(cal, d.time)])).toEqual([
      ['heading', '5. Tauwind 701 AD'],
    ]);
  });

  it('nimmt das Datum aus der Zeile unter der Überschrift', () => {
    const drafts = splitSessions(
      [txt('a.txt', 'Session 4\ngespielt am 24.05.2026\nSalzgrotte.')],
      cal,
      now,
    );
    expect(drafts[0]!.realDate).toBe('2026-05-24');
    expect(drafts[0]!.notes).toContain(
      'Datum des Spielabends aus der Zeile unter der Überschrift gelesen.',
    );
  });

  it('liest eine Datei ohne Grenze als eine Session, Nummer aus dem Dateinamen', () => {
    const drafts = splitSessions(
      [txt('session-09.txt', 'Der Salzkahn sinkt.\nLando schwimmt.')],
      cal,
      now,
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      number: 9,
      heading: '',
      text: 'Der Salzkahn sinkt.\nLando schwimmt.',
    });
    expect(drafts[0]!.notes).toContain('Nummer aus dem Dateinamen gelesen.');
    expect(splitSessions([txt('leer.txt', '  \n ')], cal, now)).toEqual([]);
  });

  it('trennt Markdown ohne Nummern an Überschriften derselben Ebene', () => {
    const text =
      '# Notizen Herbst\n\n## Der Salzkahn\nText A\n### Kampf\nHiebe\n## Krummzahns Rache\nText B\n';
    const drafts = splitSessions([md('Notizen Herbst.md', text)], cal, now);
    expect(drafts.map((d) => [d.title, d.text])).toEqual([
      ['Der Salzkahn', 'Text A\n### Kampf\nHiebe'],
      ['Krummzahns Rache', 'Text B'],
    ]);
    expect(drafts[0]!.notes[0]).toMatch(/An Überschriften getrennt/);
  });

  it('übergeht nackte Nummern in Überschriften, wenn es echte Grenzen gibt', () => {
    const text = '## Session 1\nA\n### 3 Wachen am Tor\nB\n## Session 2\nC';
    const drafts = splitSessions([md('a.md', text)], cal, now);
    expect(drafts.map((d) => d.number)).toEqual([1, 2]);
    expect(drafts[0]!.text).toBe('A\n### 3 Wachen am Tor\nB');
  });

  it('ordnet über Dateien hinweg nach Nummer, sonst nach Datum, sonst nach Datei', () => {
    const a = txt('Elaris Notizen 2026.txt', 'Session 3\nC\n\nSession 1\nA\n\nNachtrag ohne Kopf');
    const b = txt('session-02.txt', 'B');
    const c = txt('lose.txt', 'Irgendwas');
    const drafts = splitSessions([a, b, c], cal, now);
    expect(drafts.map((d) => [d.number, d.source.file])).toEqual([
      [1, 'Elaris Notizen 2026.txt'],
      [2, 'session-02.txt'],
      [3, 'Elaris Notizen 2026.txt'],
      [null, 'lose.txt'],
    ]);
    expect(drafts[0]!.text).toBe('A\n\nNachtrag ohne Kopf');

    const byDate = splitSessions(
      [txt('x.txt', '26.04.2026\nB\n12.04.2026\nA\nOhne Datum')],
      cal,
      now,
    );
    expect(byDate.map((d) => d.realDate)).toEqual(['2026-04-12', '2026-04-26']);

    const mixed = splitSessions(
      [
        txt('a.txt', 'Session 1 (12.04.2026)\nA\nSession 3 (10.05.2026)\nC'),
        txt('b.txt', '26.04.2026\nB'),
      ],
      cal,
      now,
    );
    expect(mixed.map((d) => d.number ?? d.realDate)).toEqual([1, '2026-04-26', 3]);
  });

  it('behält doppelte Nummern und meldet sie', () => {
    const drafts = splitSessions(
      [txt('a.txt', 'Session 5\nKrummzahn'), txt('b.txt', 'Session 5\nKrummzahns Bau')],
      cal,
      now,
    );
    expect(drafts).toHaveLength(2);
    for (const d of drafts) {
      expect(
        d.notes.some(
          (n) => n.includes('Session 5 steht 2-mal') && n.includes('„a.txt“ und „b.txt“'),
        ),
      ).toBe(true);
    }
  });

  it('nennt fehlende Nummern', () => {
    const drafts = splitSessions(
      [txt('a.txt', 'Session 1\nA\nSession 4\nD\nSession 2\nB')],
      cal,
      now,
    );
    expect(missingNumbers(drafts)).toEqual([3]);
  });
});
