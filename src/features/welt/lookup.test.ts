import { describe, expect, it } from 'vitest';
import { leadOf } from './lookup';

describe('Nachschlagen (F07)', () => {
  it('nimmt den ersten Absatz ohne Steckbrief, Überschrift und Geheimes', () => {
    const text = [
      '> [!steckbrief]',
      '> Geboren: 650',
      '',
      '# Kopf',
      '',
      '> [!geheim]',
      '> Ist in Wahrheit eine Spionin.',
      '',
      'Eine **Fährfrau** am Nebelsee, die [[Brücke]] meidet.',
      '',
      'Zweiter Absatz.',
    ].join('\n');
    const lead = leadOf(text);
    expect(lead).toContain('Fährfrau am Nebelsee');
    expect(lead).not.toContain('Spionin');
    expect(lead).not.toContain('Geboren');
    expect(lead).not.toContain('Zweiter');
  });
  it('kürzt an einer Wortgrenze und bleibt leer ohne Text', () => {
    expect(leadOf('')).toBe('');
    const long = leadOf('wort '.repeat(200), 50);
    expect(long.length).toBeLessThanOrEqual(52);
    expect(long.endsWith(' …')).toBe(true);
  });
});
