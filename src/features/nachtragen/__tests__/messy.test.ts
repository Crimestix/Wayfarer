/**
 * Unordentliche Notizen, wie ein Spielleiter sie wirklich schreibt – alles erfunden (Hohenfurt,
 * Mira Tannhaus, Lando Furtner, Krummzahn, die Salzgrotte).
 */
import { describe, expect, it } from 'vitest';
import { formatDate, toTime } from '../../../domain/time/calendar';
import { ELARIS_CALENDAR } from '../../../domain/time/elaris';
import { mergeWithNext, splitAt } from '../boundary';
import { placeSessions, type PlacedSession } from '../order';
import { readNotesFile, type NotesFile } from '../read';
import { missingNumbers, readBoundary, splitSessions, type SessionDraft } from '../split';
import * as messy from './messyNotes';
import { makeDocx, para, run, stylesXml } from './zip';

const cal = ELARIS_CALENDAR;
/** 1. Erntfall 701 AD, mittags. */
const now = toTime(cal, { year: 701 + 27387, month: 5, day: 1, hour: 12, minute: 0 });

async function read(file: messy.MessyFile): Promise<NotesFile> {
  return readNotesFile(file.name, await file.bytes());
}

async function split(file: messy.MessyFile): Promise<SessionDraft[]> {
  return splitSessions([await read(file)], cal, now);
}

function place(drafts: SessionDraft[]): PlacedSession[] {
  return placeSessions(drafts, { campaign: { calendar: cal }, state: { now }, sessions: {} });
}

const summary = (drafts: SessionDraft[]) =>
  drafts.map((d) => [d.number, d.title, d.realDate, d.vorspann]);
const day = (time: number) => formatDate(cal, time);

describe('Unordentliche Notizen', () => {
  it('liest eine alte Windows-Datei mit Tippfehler, Geburtstag und Vorgeschichte', async () => {
    const file = await read(messy.kladde);
    expect(file.encoding).toBe('windows-1252');
    expect(file.text).toContain('Zöllner');
    const drafts = splitSessions([file], cal, now);
    expect(summary(drafts)).toEqual([
      [null, 'Vorspann', '', true],
      [1, 'Ankunft in Hohenfurt', '2026-04-12', false],
      // „Sesion“ ist ein Tippfehler – trotzdem eine Grenze.
      [2, 'Der Zoll der Aalfischer', '2026-04-26', false],
      [3, '', '2026-05-10', false],
    ]);
    // Der Geburtstag (1990) steht im Text, er ist kein Spielabend.
    expect(drafts[1]!.text).toContain('14.03.1990');
    // „Notizen zu Session 5 von Mira“ steht mitten im Text und trennt nichts.
    expect(drafts[2]!.text).toContain('Notizen zu Session 5 von Mira');
    const placed = place(drafts);
    expect(placed.slice(1).map((p) => [p.precision, day(p.startAt)])).toEqual([
      ['day', '3. Tauwind 701 AD'],
      ['day', '5. Tauwind 701 AD'],
      // 650 AD ist Vorgeschichte, nicht der Abend.
      ['order', '7. Tauwind 701 AD'],
    ]);
    expect(placed[3]!.notes).toContain(
      'Nicht als Zeit genommen, weil lange vor dem heutigen Stand der Welt: 3. Frostfall 650 AD.',
    );
    expect(placed[3]!.notes.join(' ')).not.toContain('stimmt die Reihenfolge');
  });

  it('trennt Markdown an ##, auch eine Überschrift, die nur ein Datum ist', async () => {
    const drafts = await split(messy.herbst);
    expect(summary(drafts)).toEqual([
      [9, 'Salzgrotte, zweiter Versuch', '2026-09-13', false],
      [10, '', '2026-09-27', false],
      [null, '', '2026-10-11', false],
    ]);
    // Unterüberschriften bleiben Teil der Session.
    expect(drafts[0]!.text).toContain('### Kampf');
    expect(drafts[0]!.text).toContain('### Nachher');
  });

  it('erkennt zwei Abende in einem Abschnitt: „Session 3+4“ und „Session 5-6“', async () => {
    const drafts = await split(messy.doppelabend);
    expect(drafts.map((d) => [d.number, d.lastNumber, d.title])).toEqual([
      [3, 4, 'Die Tiefe Pforte'],
      [5, 6, 'Krummzahns Bau'],
    ]);
    expect(drafts[0]!.notes).toContain(
      'Session 3 und 4 stehen in einem Abschnitt. Weißt du, wo ein Abend endet, trenne sie dort.',
    );
    expect(missingNumbers(drafts)).toEqual([]);
  });

  it('liest einen Block ohne Überschrift als eine Session, die Nummer aus dem Dateinamen', async () => {
    const block = await split(messy.block);
    expect(summary(block)).toEqual([[null, '', '', false]]);
    expect(block[0]!.text.startsWith('gruppe in hohenfurt')).toBe(true);
    const single = await split(messy.einzeln);
    expect(summary(single)).toEqual([[9, '', '', false]]);
    expect(single[0]!.notes).toContain('Nummer aus dem Dateinamen gelesen.');
  });

  it('liest Word mit Überschriften-Vorlagen und Word, das nur fett schreibt', async () => {
    const styled = await split(messy.wordMitVorlagen);
    expect(summary(styled)).toEqual([
      [6, '', '2026-06-21', false],
      [7, 'Der Salzkahn', '2026-07-05', false],
      [8, '', '', false],
    ]);
    // „Kampf“ (Überschrift 2) trennt nicht, der Titel des Dokuments wird kein Vorspann.
    expect(styled[0]!.text).toContain('Kampf\nDrei Goblins am Anleger.');
    const plain = await split(messy.wordOhneVorlagen);
    expect(summary(plain)).toEqual([
      [11, '', '2026-07-19', false],
      [12, '', '', false],
    ]);
  });

  it('trennt an Überschriften ohne Nummer und Datum', async () => {
    const drafts = await split(messy.ohneNummern);
    expect(summary(drafts)).toEqual([
      [null, 'Ankunft', '', false],
      [null, 'Die Grotte', '', false],
      [null, 'Rückweg', '', false],
    ]);
  });

  it('nimmt Daten in vielen Schreibweisen als Grenze', async () => {
    const drafts = await split(messy.datumszeilen);
    expect(summary(drafts)).toEqual([
      [null, '', '2026-06-21', false],
      [null, '', '2026-07-06', false],
      [null, '', '2026-08-02', false],
    ]);
    // „Spieltermin: 20.07.2026“ steht mitten im Abschnitt und bleibt Text.
    expect(drafts[1]!.text).toContain('Spieltermin: 20.07.2026');
  });

  it('lässt Fließtext stehen, der wie eine Grenze aussieht', async () => {
    const drafts = await split(messy.fallen);
    expect(summary(drafts)).toEqual([
      [1, '', '', false],
      [2, '', '', false],
    ]);
    expect(drafts[0]!.text.split('\n')).toEqual([
      'Abend 3 Goblins greifen an, am Abend war Ruhe.',
      'Folge 2 Spuren nach Westen – Lando findet sie.',
      'Session 2 war super, wir haben viel gelacht.',
      'S2 hat Mira gefehlt.',
      '14.03.1990 Geburtstag von Kai',
      'nächster Termin: 26.04.2026',
    ]);
  });

  it('liest UTF-16, Tabulatoren, Großschreibung und Session 0', async () => {
    const file = await read(messy.unicode);
    expect(file.encoding).toBe('utf-16le');
    const drafts = splitSessions([file], cal, now);
    expect(summary(drafts)).toEqual([
      [0, '', '2026-04-05', false],
      [1, 'Ankunft', '', false],
    ]);
  });

  it('nimmt ein Datum ohne Jahr aus dem Titel und meldet das fehlende Jahr', async () => {
    const drafts = await split(messy.ohneJahr);
    expect(summary(drafts)).toEqual([
      [4, '', '', false],
      [4, 'Teil 2', '', false],
    ]);
    expect(drafts[0]!.notes).toContain('Datum ohne Jahr („24.05.“) – das Jahr fehlt.');
    expect(drafts[0]!.notes.some((n) => n.startsWith('Doppelt: Session 4'))).toBe(true);
  });

  it('kennt „Session: 13“ und „Sitzung #14“', async () => {
    expect(summary(await split(messy.doppelpunkt))).toEqual([
      [13, '', '', false],
      [14, 'Flussaufwärts', '', false],
    ]);
  });

  it('zählt setext-Linien zur Überschrift und lässt Hausregeln als Vorspann', async () => {
    const drafts = await split(messy.vorspann);
    expect(summary(drafts)).toEqual([
      [null, 'Vorspann', '', true],
      [15, '', '', false],
      [16, '', '', false],
    ]);
    expect(drafts[1]!.heading).toBe('Session 15\n----------');
    expect(drafts[1]!.text).toBe('Krummzahns Schwester taucht auf.');
  });

  it('liest RTF aus WordPad mit Umlauten', async () => {
    expect(summary(await split(messy.wordpad))).toEqual([
      [17, 'Grüne Höhle', '2026-08-09', false],
      [18, '', '', false],
    ]);
  });

  it('zählt Trennlinien zur Grenze und liest keinen Geburtstag als Spielabend', async () => {
    const drafts = await split(messy.trennlinien);
    expect(summary(drafts)).toEqual([
      [19, 'Der Zöllner', '', false],
      [20, '', '', false],
    ]);
    expect(drafts[0]!.text).toBe(
      'Lando hat am 03.05.1987 Geburtstag – Runde ging aufs Haus.\nZöllner verhaftet.',
    );
  });

  it('bringt alle Dateien zusammen in eine Reihenfolge – ein falsches Datum zieht nichts mit', async () => {
    const files = await Promise.all(messy.MESSY.map(read));
    const drafts = splitSessions(files, cal, now);
    const numbers = drafts.flatMap((d) => (d.number === null ? [] : [d.number]));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    // „11.10.2026“ ohne Nummer steht hinter Session 10 (27.09.2026).
    const at = drafts.findIndex((d) => d.realDate === '2026-10-11');
    expect(drafts[at - 1]!.number).toBe(10);
    // Die Termine vom Juni/Juli ohne Nummer stehen bei Session 6 und 7.
    const june = drafts.findIndex((d) => d.number === null && d.realDate === '2026-06-21');
    expect(drafts[june - 1]!.number).toBe(6);
    expect(missingNumbers(drafts)).toEqual([]);
  });
});

describe('Grenzen in schwierigen Zeilen', () => {
  const mark = (line: string, heading = false) => {
    const m = readBoundary(line, heading);
    return m && [m.number, m.lastNumber, m.title, m.realDate, m.dayMonth];
  };

  it('verzeiht Tippfehler, aber nicht jedes ähnliche Wort', () => {
    expect(mark('Sesion 2')).toEqual([2, null, '', '', '']);
    expect(mark('Sesson 4')).toEqual([4, null, '', '', '']);
    expect(mark('Sitzng 4')).toEqual([4, null, '', '', '']);
    expect(mark('SESION 7 - Der Kahn')).toEqual([7, null, 'Der Kahn', '', '']);
    expect(mark('Season 2')).toBeNull();
    expect(mark('Sessel 3 kaputt')).toBeNull();
  });

  it('nimmt „Abend“ und „Folge“ nur mit etwas Trennendem', () => {
    expect(mark('Abend 3 Goblins greifen an')).toBeNull();
    expect(mark('Folge 2 Spuren nach Westen')).toBeNull();
    expect(mark('Abend 3 – Salzgrotte')).toEqual([3, null, 'Salzgrotte', '', '']);
    expect(mark('Folge 2: Spuren')).toEqual([2, null, 'Spuren', '', '']);
    expect(mark('Abend 3')).toEqual([3, null, '', '', '']);
    expect(mark('## Abend 3 Goblins', true)).toEqual([3, null, 'Goblins', '', '']);
  });

  it('liest mehrere Abende, aber kein Datum als zweite Nummer', () => {
    expect(mark('Session 1 & 2')).toEqual([1, 2, '', '', '']);
    expect(mark('Session 10 bis 12')).toEqual([10, 12, '', '', '']);
    expect(mark('Session 3 und dann Pause')).toBeNull();
    expect(mark('Session 2-26.04.2026')).toEqual([2, null, '', '2026-04-26', '']);
    expect(mark('Session 5 - 12.04.2026')).toEqual([5, null, '', '2026-04-12', '']);
  });

  it('liest Daten ohne Jahr, aber keine Gliederung und keinen Geburtstag', () => {
    expect(mark('Sa 21.6.')).toEqual([null, null, '', '', '06-21']);
    expect(mark('Sitzung vom 24.05.')).toEqual([null, null, '', '', '05-24']);
    expect(mark('24.05. – Salzgrotte')).toEqual([null, null, 'Salzgrotte', '', '05-24']);
    expect(mark('Session 5 (17.3.)')).toEqual([5, null, '', '', '03-17']);
    expect(mark('1.2. Kampf')).toBeNull();
    expect(mark('12.5. – Lando hat Geburtstag')).toBeNull();
    expect(mark('14.03.1990')).toBeNull();
  });

  it('räumt den Titel auf', () => {
    expect(mark('Sitzung 3, gespielt am 10.05.2026')).toEqual([3, null, '', '2026-05-10', '']);
    expect(mark('Session: 13')).toEqual([13, null, '', '', '']);
    expect(mark('Session 5 + Nachtrag')).toEqual([5, null, 'Nachtrag', '', '']);
  });
});

describe('Jahr ergänzen', () => {
  const txt = (text: string): NotesFile => ({
    name: 'jahr.txt',
    kind: 'txt',
    text,
    headings: [],
    encoding: 'utf-8',
  });

  it('nimmt das Jahr vom Abend davor, auch über den Jahreswechsel', () => {
    const drafts = splitSessions(
      [txt('Session 4 (20.12.2026)\nA\n\nSession 5 (3.1.)\nB\n\nSession 6 – 17.1.\nC')],
      cal,
      now,
    );
    expect(drafts.map((d) => d.realDate)).toEqual(['2026-12-20', '2027-01-03', '2027-01-17']);
    expect(drafts[1]!.notes).toContain(
      'Datum ohne Jahr („03.01.“) – das Jahr 2027 von den Abenden daneben genommen.',
    );
  });

  it('nimmt das Jahr vom Abend danach, wenn davor keiner ein Jahr hat', () => {
    const drafts = splitSessions([txt('Sa 21.6.\nA\n\nSo 6.7.26\nB')], cal, now);
    expect(drafts.map((d) => d.realDate)).toEqual(['2026-06-21', '2026-07-06']);
  });
});

describe('Grenzen von Hand bei mehreren Abenden', () => {
  const txt = (text: string): NotesFile => ({
    name: 'hand.txt',
    kind: 'txt',
    text,
    headings: [],
    encoding: 'utf-8',
  });

  it('teilt „Session 3+4“ in 3 und 4', () => {
    const drafts = splitSessions(
      [txt('Session 3+4 – Die Tiefe Pforte\nTor geöffnet.\nAm zweiten Abend: Salzgrotte.')],
      cal,
      now,
    );
    const at = drafts[0]!.text.indexOf('Am zweiten');
    const after = splitAt(drafts, 0, at);
    expect(after.map((d) => [d.number, d.lastNumber, d.text])).toEqual([
      [3, null, 'Tor geöffnet.'],
      [4, null, 'Am zweiten Abend: Salzgrotte.'],
    ]);
    expect(after[0]!.notes.join(' ')).not.toContain('in einem Abschnitt');
    expect(after[1]!.notes).toEqual(['Von Hand getrennt.', 'Als Session 4 angenommen.']);
  });

  it('legt Session 5 und 6 zusammen zu einem Abschnitt über beide Abende', () => {
    const drafts = splitSessions([txt('Session 5\nA\nSession 6\nB\nSession 7\nC')], cal, now);
    const merged = mergeWithNext(drafts, 0);
    expect(merged.map((d) => [d.number, d.lastNumber])).toEqual([
      [5, 6],
      [7, null],
    ]);
    expect(missingNumbers(merged)).toEqual([]);
    // Und an derselben Zeile wieder getrennt: wie vorher.
    const again = splitAt(merged, 0, merged[0]!.text.indexOf('Session 6'));
    expect(again.map((d) => [d.number, d.lastNumber, d.heading, d.text])).toEqual([
      [5, null, 'Session 5', 'A'],
      [6, null, 'Session 6', 'B'],
      [7, null, 'Session 7', 'C'],
    ]);
  });
});

describe('Word mit Inhaltsverzeichnis', () => {
  it('liest das Inhaltsverzeichnis nicht als lauter leere Sessions', async () => {
    const bytes = await makeDocx(
      para(run('Inhalt')) +
        para(run('Session 1 – Ankunft\t2'), 'Verzeichnis1') +
        para(run('Session 2 – Der Zoll\t3'), 'TOC1') +
        para(run('Session 1 – Ankunft'), 'berschrift1') +
        para(run('Mira Tannhaus wartet am Tor.')) +
        para(run('Session 2 – Der Zoll'), 'berschrift1') +
        para(run('Lando Furtner zahlt.')),
      {
        styles: stylesXml([
          { id: 'berschrift1', name: 'heading 1' },
          { id: 'Verzeichnis1', name: 'toc 1' },
          { id: 'TOC1', name: 'toc 1' },
        ]),
      },
    );
    const file = await readNotesFile('Elaris.docx', bytes);
    expect(file.text).toBe(
      'Inhalt\nSession 1 – Ankunft\nMira Tannhaus wartet am Tor.\nSession 2 – Der Zoll\nLando Furtner zahlt.',
    );
    expect(file.headings).toEqual([
      { line: 1, level: 1 },
      { line: 3, level: 1 },
    ]);
    const drafts = splitSessions([file], cal, now);
    expect(drafts.map((d) => [d.number, d.title, d.vorspann])).toEqual([
      [null, 'Vorspann', true],
      [1, 'Ankunft', false],
      [2, 'Der Zoll', false],
    ]);
  });
});
