import { describe, expect, it } from 'vitest';
import { entryParts, pickFrom, readTable, tableToText } from '../rollTable';

describe('Tabellen als Listen', () => {
  it('liest eine bloße Liste, jede Zeile gleich oft', () => {
    const table = readTable('Pilzwald', 'Riesenkäfer\n\nSporenwolke\nPilzsammler');
    expect(table.die).toBe(3);
    expect(table.rows.map((row) => [row.min, row.max, row.text])).toEqual([
      [1, 1, 'Riesenkäfer'],
      [2, 2, 'Sporenwolke'],
      [3, 3, 'Pilzsammler'],
    ]);
  });

  it('nimmt „3×“ als Häufigkeit und eingefügte Würfeltabellen als Bereiche', () => {
    const table = readTable('X', '3× Wölfe\nEin Bär\n1–2: Rehe');
    expect(table.die).toBe(6);
    expect(table.rows.map((row) => [row.min, row.max])).toEqual([
      [1, 3],
      [4, 4],
      [5, 6],
    ]);
    expect(tableToText(table.rows)).toBe('3× Wölfe\nEin Bär\n2× Rehe');
  });

  it('kennt beliebig viele Einträge, ohne Würfelgröße', () => {
    const text = Array.from({ length: 37 }, (_, i) => `Eintrag ${i + 1}`).join('\n');
    const table = readTable('Lang', text);
    expect(table.die).toBe(37);
    expect(pickFrom(table, () => 37)).toBe('Eintrag 37');
    expect(pickFrom(table, () => 5)).toBe('Eintrag 5');
    expect(pickFrom(readTable('Leer', ''), () => 1)).toBe('');
  });

  it('liest, was man von fern sieht und was verborgen liegt', () => {
    expect(
      entryParts('Ein Köhlerlager (von fern: eine Rauchsäule) (verborgen: ein Beutel Silber)'),
    ).toEqual({ here: 'Ein Köhlerlager', afar: 'Eine Rauchsäule', hidden: 'Ein Beutel Silber' });
    expect(entryParts('Klopfen (von nebenan: ein Hall)').afar).toBe('Ein Hall');
    expect(entryParts('–')).toEqual({ here: '', afar: '', hidden: '' });
    expect(entryParts('Lichtung').here).toBe('Lichtung');
  });
});
