import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { DEFAULT_TABLES, defaultTable, generatorTables } from './tables';
import { resetGeneratorTable, saveGeneratorRows, saveGeneratorTable } from './tableActions';
import { composeEntry, entryParts, tableToText } from '../../domain/rollTable';

describe('Würfeltabellen der Erzeuger', () => {
  it('nimmt die Vorgaben, solange der Spielleiter keine eigenen hat', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const tables = generatorTables(db.getSnapshot());
    expect(tables.all).toHaveLength(DEFAULT_TABLES.length);
    expect(tables.slot('site')!.rows.length).toBeGreaterThan(10);
    expect(tables.slot('feature:forest')!.rows.map((row) => row.text)).toContain('Lichtung');
    expect(tables.all.every((entry) => entry.own === null)).toBe(true);
  });

  it('speichert eine eigene Liste, Rückgängig und Vorgabe holen sie zurück', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const undo = saveGeneratorTable(db, 'feature:forest', 'Pilzring\n2× Riesenfarn');
    let tables = generatorTables(db.getSnapshot());
    expect(tables.slot('feature:forest')!.rows.map((row) => row.text)).toEqual([
      'Pilzring',
      'Riesenfarn',
    ]);
    expect(tables.slot('feature:forest')!.die).toBe(3);
    undo();
    tables = generatorTables(db.getSnapshot());
    expect(tables.slot('feature:forest')!.rows.map((row) => row.text)).toContain('Lichtung');

    saveGeneratorTable(db, 'hidden', '');
    expect(generatorTables(db.getSnapshot()).slot('hidden')!.rows).toEqual([]);
    resetGeneratorTable(db, 'hidden');
    expect(generatorTables(db.getSnapshot()).slot('hidden')!.rows.length).toBeGreaterThan(0);
  });

  it('legt keine eigene Tabelle an, wenn der Text der Vorgabe gleicht', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const def = DEFAULT_TABLES.find((entry) => entry.slot === 'hidden')!;
    saveGeneratorTable(db, 'hidden', tableToText(defaultTable(def).rows));
    expect(Object.values(db.getSnapshot().tables)).toHaveLength(0);
  });

  it('schreibt Zeilen mit Teilen und Häufigkeit, wie die Tabelle sie zeigt', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const parts = { here: 'Ein Kobold-Markt', afar: 'bunte Fahnen', hidden: 'ein Schuldbuch' };
    expect(entryParts(composeEntry(parts))).toEqual({
      here: 'Ein Kobold-Markt',
      afar: 'Bunte Fahnen',
      hidden: 'Ein Schuldbuch',
    });
    expect(composeEntry({ ...parts, hidden: '' }, true)).toBe(
      'Ein Kobold-Markt (von nebenan: bunte Fahnen)',
    );
    saveGeneratorRows(db, 'site', [
      { text: composeEntry(parts), weight: 3 },
      { text: '  ', weight: 1 },
      { text: 'Eine Quelle', weight: 1 },
    ]);
    const site = generatorTables(db.getSnapshot()).slot('site')!;
    expect(site.die).toBe(4);
    expect(site.rows.map((row) => [row.min, row.max])).toEqual([
      [1, 3],
      [4, 4],
    ]);
  });
});
