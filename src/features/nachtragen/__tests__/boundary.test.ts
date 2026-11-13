import { describe, expect, it } from 'vitest';
import { formatDate } from '../../../domain/time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../../../domain/time/elaris';
import { mergeWithNext, splitAt } from '../boundary';
import type { NotesFile } from '../read';
import { splitSessions, type SessionDraft } from '../split';

const cal = ELARIS_CALENDAR;
const txt = (name: string, text: string): NotesFile => ({
  name,
  kind: 'txt',
  text,
  headings: [],
  encoding: 'utf-8',
});
const split = (...files: NotesFile[]) => splitSessions(files, cal, ELARIS_START);

/** Jeder Tag des Kalenders zeigt noch auf seinen Text. */
const datesRead = (d: SessionDraft) =>
  d.worldDates.map((w) => [
    w.where,
    (w.where === 'heading' ? d.heading : d.text).slice(w.from, w.to),
  ]);

describe('Grenzen von Hand verschieben', () => {
  const notes = [
    'Vorrede über Hohenfurt am 1. Tauwind 701',
    '',
    'Session 1 – Ankunft (2. Tauwind 701)',
    'Mira Tannhaus am 3. Tauwind 701.',
    'Session 2',
    'Lando Furtner am 5. Tauwind 701.',
  ].join('\n');

  it('legt den Vorspann vor die erste Session', () => {
    const drafts = split(txt('a.txt', notes));
    expect(drafts.map((d) => d.vorspann)).toEqual([true, false, false]);
    const merged = mergeWithNext(drafts, 0);
    expect(merged).toHaveLength(2);
    const first = merged[0]!;
    expect(first).toMatchObject({ number: 1, title: 'Ankunft', vorspann: false });
    expect(first.text).toBe(
      'Vorrede über Hohenfurt am 1. Tauwind 701\n\nMira Tannhaus am 3. Tauwind 701.',
    );
    expect(datesRead(first)).toEqual([
      ['heading', '2. Tauwind 701'],
      ['text', '1. Tauwind 701'],
      ['text', '3. Tauwind 701'],
    ]);
    expect(first.notes).toContain('Mit dem Text davor zusammengelegt.');
  });

  it('legt zwei Sessions zusammen, ohne die Überschrift der zweiten zu verlieren', () => {
    const drafts = split(txt('a.txt', notes)).slice(1);
    const merged = mergeWithNext(drafts, 0);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.number).toBe(1);
    expect(merged[0]!.text).toBe(
      'Mira Tannhaus am 3. Tauwind 701.\n\nSession 2\nLando Furtner am 5. Tauwind 701.',
    );
    expect(datesRead(merged[0]!)).toEqual([
      ['heading', '2. Tauwind 701'],
      ['text', '3. Tauwind 701'],
      ['text', '5. Tauwind 701'],
    ]);
    expect(merged[0]!.notes).toContain('Session 2 ist hier hineingelegt.');
    expect(mergeWithNext(merged, 0)).toEqual(merged);
  });

  it('meldet, wenn Notizen aus zwei Dateien zusammenkommen, und prüft Doppelte neu', () => {
    const drafts = split(
      txt('a.txt', 'Session 5\nKrummzahn'),
      txt('b.txt', 'Session 5\nKrummzahns Bau'),
    );
    expect(drafts[0]!.notes.some((n) => n.startsWith('Doppelt'))).toBe(true);
    const merged = mergeWithNext(drafts, 0);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.notes.some((n) => n.startsWith('Doppelt'))).toBe(false);
    expect(merged[0]!.notes).toContain('Enthält auch Notizen aus „b.txt“.');
  });

  it('teilt an einer Zeile; eine Grenze darin wird die neue Überschrift', () => {
    const text =
      'Session 3\nDie Tiefe Pforte am 6. Tauwind 701.\n\nSession 4 – Salzgrotte (24.05.2026)\nAm 8. Tauwind 701 in der Grotte.';
    const drafts = split(txt('a.txt', text));
    expect(drafts).toHaveLength(2);
    const joined = mergeWithNext(drafts, 0);
    expect(joined).toHaveLength(1);
    const at = joined[0]!.text.indexOf('Session 4') + 3; // mitten in der Zeile
    const parts = splitAt(joined, 0, at);
    expect(parts).toHaveLength(2);
    expect(parts[0]!.text).toBe('Die Tiefe Pforte am 6. Tauwind 701.');
    expect(parts[1]).toMatchObject({
      number: 4,
      title: 'Salzgrotte',
      realDate: '2026-05-24',
      heading: 'Session 4 – Salzgrotte (24.05.2026)',
      text: 'Am 8. Tauwind 701 in der Grotte.',
    });
    expect(datesRead(parts[1]!)).toEqual([['text', '8. Tauwind 701']]);
    expect(parts[1]!.notes).toEqual(['Von Hand getrennt.']);
    expect(formatDate(cal, parts[1]!.worldDates[0]!.time)).toBe('8. Tauwind 701 AD');
  });

  it('teilt auch ohne Grenze in der Zeile – dann ohne Nummer und Titel', () => {
    const drafts = split(
      txt('a.txt', 'Session 7\nDer Salzkahn legt ab.\nKrummzahn am 9. Tauwind 701 an Bord.'),
    );
    const parts = splitAt(drafts, 0, drafts[0]!.text.indexOf('Krummzahn'));
    expect(parts.map((d) => [d.number, d.heading, d.text])).toEqual([
      [7, 'Session 7', 'Der Salzkahn legt ab.'],
      [null, '', 'Krummzahn am 9. Tauwind 701 an Bord.'],
    ]);
    expect(datesRead(parts[1]!)).toEqual([['text', '9. Tauwind 701']]);
    expect(parts[1]!.source.textFrom).toBe(
      drafts[0]!.source.textFrom + drafts[0]!.text.indexOf('Krummzahn'),
    );
  });

  it('tut nichts, wenn eine Seite leer bliebe', () => {
    const drafts = split(txt('a.txt', 'Session 7\nNur eine Zeile.'));
    expect(splitAt(drafts, 0, 0)).toEqual(drafts);
    expect(splitAt(drafts, 0, 5)).toEqual(drafts);
    expect(splitAt(drafts, 3, 2)).toEqual(drafts);
  });
});
