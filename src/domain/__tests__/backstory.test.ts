import { describe, expect, it } from 'vitest';
import { backstoryParts, cardTitleOf } from '../backstory';

describe('Backstory', () => {
  it('trennt Absätze an Leerzeilen – ohne Leerzeile zählt jede Zeile', () => {
    expect(backstoryParts('Erster Teil.\nnoch dazu.\n\nZweiter Teil.')).toEqual([
      'Erster Teil. noch dazu.',
      'Zweiter Teil.',
    ]);
    expect(backstoryParts('Eins.\nZwei.')).toEqual(['Eins.', 'Zwei.']);
    expect(backstoryParts('   ')).toEqual([]);
  });

  it('nimmt als Überschrift den ersten Satz, gekürzt an einer Wortgrenze', () => {
    expect(cardTitleOf('Sie floh aus Hohenfurt. Danach kam lange nichts.')).toBe(
      'Sie floh aus Hohenfurt.',
    );
    const long = cardTitleOf(
      'Als junges Mädchen hörte sie in der Schmiede ein Gespräch zwischen Theo Becker und seiner Frau',
    );
    expect(long.endsWith(' …')).toBe(true);
    expect(long.length).toBeLessThanOrEqual(72);
  });
});
