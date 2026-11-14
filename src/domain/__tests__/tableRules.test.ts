import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { setTableRules } from '../../features/tisch/commands';
import { hasTableRules, rulesLine } from '../tableRules';

describe('Regeln des Tisches', () => {
  const rules = [
    '## Würfel',
    '',
    '- Kritische Treffer: **doppelte** Würfel',
    '> Grenzen: keine Folter am Tisch',
    '1. Pausen nach jeder Stunde',
  ].join('\n');

  it('findet die Zeile, in der ein Wort steht – ohne die Zeichen davor', () => {
    expect(rulesLine(rules, 'kritisch')).toBe('Kritische Treffer: doppelte Würfel');
    expect(rulesLine(rules, 'folter')).toBe('Grenzen: keine Folter am Tisch');
    expect(rulesLine(rules, 'Pausen')).toBe('Pausen nach jeder Stunde');
    expect(rulesLine(rules, 'wurfel')).toBe('Würfel');
    expect(rulesLine(rules, 'Inspiration')).toBeNull();
    expect(rulesLine(rules, '  ')).toBeNull();
  });

  it('weiß, ob schon etwas dasteht', () => {
    expect(hasTableRules('')).toBe(false);
    expect(hasTableRules('  \n ')).toBe(false);
    expect(hasTableRules(rules)).toBe(true);
  });
});

describe('Regeln des Tisches im Spielstand', () => {
  it('stehen leer da, bis der Spielleiter sie schreibt', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    expect(db.getSnapshot().campaign.tableRules).toBe('');
    setTableRules(db, '- Keine Handys am Tisch');
    expect(db.getSnapshot().campaign.tableRules).toBe('- Keine Handys am Tisch');
  });
});
