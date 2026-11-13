import { describe, expect, it } from 'vitest';
import { decodeEntities, docxText, documentText, NotesReadError } from '../docx';
import { documentXml, makeDocx, makeZip, para, run, stylesXml } from './zip';

describe('Word-Dateien lesen', () => {
  it('macht aus Absätzen Zeilen und verbindet die Läufe', async () => {
    const bytes = await makeDocx(
      para(run('Session 1 – Ankunft in ') + run('Hohenfurt')) +
        para('') +
        para(run('Mira Tannhaus wartet am Tor.')),
    );
    const doc = await docxText(bytes);
    expect(doc.text).toBe('Session 1 – Ankunft in Hohenfurt\n\nMira Tannhaus wartet am Tor.');
    expect(doc.headings).toEqual([]);
  });

  it('liest gepackte Einträge (deflate)', async () => {
    const long = Array.from({ length: 40 }, (_, i) =>
      para(run(`Zeile ${i}: Lando Furtner zählt Salz.`)),
    ).join('');
    const bytes = await makeDocx(long, { deflate: true });
    const doc = await docxText(bytes);
    expect(doc.text.split('\n')).toHaveLength(40);
    expect(doc.text.split('\n')[39]).toBe('Zeile 39: Lando Furtner zählt Salz.');
  });

  it('kennt Tabulator, Zeilenumbruch und Entitäten', () => {
    const xml = documentXml(
      para(
        '<w:r><w:t>Krummzahn</w:t><w:tab/><w:t>&lt;Goblin&gt; &amp; Co</w:t><w:br/><w:t>zweite Zeile &#228;&#xFC;</w:t></w:r>',
      ),
    );
    expect(documentText(xml).text).toBe('Krummzahn\t<Goblin> & Co\nzweite Zeile äü');
  });

  it('merkt sich Überschriften – über Vorlagennamen, Kennung oder Gliederungsebene', () => {
    const styles = stylesXml([
      { id: 'berschrift1', name: 'heading 1' },
      { id: 'Sitzungskopf', name: 'Sitzungskopf', basedOn: 'berschrift1' },
    ]);
    const xml = documentXml(
      para(run('Notizen'), 'Title') +
        para(run('Session 1'), 'berschrift1') +
        para('<w:r><w:t>Mira</w:t><w:br/><w:t>Tannhaus</w:t></w:r>') +
        para(run('Session 2'), 'Sitzungskopf') +
        para(run('Salzgrotte'), 'Heading2') +
        '<w:p><w:pPr><w:outlineLvl w:val="2"/></w:pPr>' +
        run('Gliederung') +
        '</w:p>',
    );
    const doc = documentText(xml, styles);
    expect(doc.text.split('\n')).toEqual([
      'Notizen',
      'Session 1',
      'Mira',
      'Tannhaus',
      'Session 2',
      'Salzgrotte',
      'Gliederung',
    ]);
    expect(doc.headings).toEqual([
      { line: 0, level: 0 },
      { line: 1, level: 1 },
      { line: 4, level: 1 },
      { line: 5, level: 2 },
      { line: 6, level: 3 },
    ]);
  });

  it('lässt Tabstopps, gelöschten Text, Feldbefehle und Ersatzdarstellungen weg', () => {
    const xml = documentXml(
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>' +
        run('Hohenfurt') +
        '<w:del><w:r><w:delText>gestrichen</w:delText></w:r></w:del>' +
        '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
        '<mc:AlternateContent><mc:Choice><w:r><w:t>!</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t>doppelt</w:t></w:r></mc:Fallback></mc:AlternateContent>' +
        '</w:p>',
    );
    expect(documentText(xml).text).toBe('Hohenfurt!');
  });

  it('kommt mit einem anderen Präfix für das Word-Schema zurecht', () => {
    const xml = `<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:body><x:p><x:r><x:t>Salzgrotte</x:t></x:r></x:p></x:body></x:document>`;
    expect(documentText(xml).text).toBe('Salzgrotte');
  });

  it('meldet kaputte, geschützte und fremde Dateien mit einem Satz', async () => {
    await expect(docxText(new TextEncoder().encode('kein zip'))).rejects.toThrow(NotesReadError);
    await expect(docxText(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0]))).rejects.toThrow(
      /Kennwort/,
    );
    const noDocument = await makeZip([{ name: 'hallo.txt', content: 'x' }]);
    await expect(docxText(noDocument)).rejects.toThrow(/beschädigt/);
  });

  it('löst nur gültige Entitäten auf', () => {
    expect(decodeEntities('&amp;lt; &unbekannt; &#9999999999;')).toBe(
      '&lt; &unbekannt; &#9999999999;',
    );
  });
});
