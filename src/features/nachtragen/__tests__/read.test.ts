import { describe, expect, it } from 'vitest';
import {
  decodeText,
  markdownHeadings,
  notesKindOf,
  NotesReadError,
  readNotesFile,
  rtfText,
} from '../read';
import { makeDocx, para, run } from './zip';

const utf8 = (text: string) => new TextEncoder().encode(text);

describe('Notizdateien lesen', () => {
  it('liest UTF-8 mit und ohne BOM und vereinheitlicht Zeilenenden', async () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Größe\r\nSalz\rgrotte')]);
    const file = await readNotesFile('session-09.txt', withBom);
    expect(file).toMatchObject({ kind: 'txt', text: 'Größe\nSalz\ngrotte', encoding: 'utf-8' });
    expect((await readNotesFile('a.TXT', utf8('Hohenfurt'))).text).toBe('Hohenfurt');
  });

  it('fällt bei ungültigem UTF-8 auf Windows-1252 zurück (Umlaute alter Windows-Dateien)', () => {
    // „Mira Tannhaus läuft über die Brücke“ in Windows-1252
    const bytes = new Uint8Array([
      ...utf8('Mira l'),
      0xe4,
      ...utf8('uft '),
      0xfc,
      ...utf8('ber die Br'),
      0xfc,
      ...utf8('cke '),
      0x96,
      ...utf8(' 5 '),
      0x80,
    ]);
    expect(decodeText(bytes)).toEqual({
      text: 'Mira läuft über die Brücke – 5 €',
      encoding: 'windows-1252',
    });
  });

  it('liest UTF-16 mit BOM', () => {
    const le = new Uint8Array([0xff, 0xfe, 0x53, 0x00, 0xe4, 0x00]);
    expect(decodeText(le)).toEqual({ text: 'Sä', encoding: 'utf-16le' });
  });

  it('merkt sich Überschriften in Markdown, nicht in Codeblöcken', async () => {
    const text =
      '# Notizen\n\n## Session 1\nText\n\nAnkunft\n===\n```\n# kein Titel\n```\nKrummzahn\n---\n\n---\n';
    const file = await readNotesFile('Notizen Herbst.md', utf8(text));
    expect(file.headings).toEqual([
      { line: 0, level: 1 },
      { line: 2, level: 1 + 1 },
      { line: 5, level: 1 },
      { line: 10, level: 2 },
    ]);
    expect(markdownHeadings('Text\n\n---')).toEqual([]);
  });

  it('liest Word-Dateien', async () => {
    const bytes = await makeDocx(
      para(run('Session 2'), 'Heading1') + para(run('Der Zoll der Aalfischer')),
    );
    const file = await readNotesFile('Elaris Notizen 2026.docx', bytes);
    expect(file).toMatchObject({
      kind: 'docx',
      text: 'Session 2\nDer Zoll der Aalfischer',
      headings: [{ line: 0, level: 1 }],
      encoding: 'docx',
    });
  });

  it('liest RTF: Absätze, Umlaute, Unicode, ohne Tabellen der Schriften', async () => {
    const rtf =
      '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Calibri;}}{\\colortbl;\\red0\\green0\\blue0;}' +
      "{\\*\\generator Riched20;}\\pard\\f0\\fs22 Session 3\\par Die Tiefe Pforte \\'f6ffnet sich\\par " +
      '\\u8364?{\\b fett}\\tab Ende}';
    expect(rtfText(rtf)).toBe('Session 3\nDie Tiefe Pforte öffnet sich\n€fett\tEnde');
    const file = await readNotesFile('alt.rtf', utf8(rtf));
    expect(file.text.split('\n')[0]).toBe('Session 3');
    expect(() => rtfText('kein rtf')).toThrow(NotesReadError);
  });

  it('sagt auf Deutsch, was es nicht liest', async () => {
    await expect(readNotesFile('alt.doc', utf8('x'))).rejects.toThrow(/als \.docx/);
    await expect(readNotesFile('scan.pdf', utf8('x'))).rejects.toThrow(/PDF/);
    await expect(readNotesFile('bild.png', utf8('x'))).rejects.toThrow(
      /kann Wayfarer nicht lesen – nur Text \(\.txt\)/,
    );
    await expect(readNotesFile('kaputt.txt', new Uint8Array([0x41, 0, 0x42]))).rejects.toThrow(
      /nicht nach Text/,
    );
    expect(notesKindOf('Notizen.Markdown')).toBe('md');
    expect(notesKindOf('ohne-endung')).toBeNull();
  });
});
