import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity } from '../../domain/schema';
import { createArticle } from '../wiki/actions';
import { boardFinds, exactFind } from './finds';

describe('Suchen beim Hinlegen', () => {
  it('findet Einträge und Artikel ohne Eintrag – nie Gefährten', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const daria = db.put(
      'entities',
      createEntity({ kind: 'person', name: 'Daria Hagel', aliases: ['Die Hagel'] }),
    );
    db.put('entities', createEntity({ kind: 'character', name: 'Darian der Gefährte' }));
    const lore = createArticle(db, { title: 'Darias Tagebuch', text: 'Ein altes Buch.' })!;
    const finds = boardFinds(db.getSnapshot(), 'Daria');
    expect(finds.map((find) => find.key)).toEqual(
      expect.arrayContaining([`node:${daria.id}`, `article:${lore.id}`]),
    );
    expect(finds.some((find) => find.label.startsWith('Darian'))).toBe(false);
    expect(boardFinds(db.getSnapshot(), '  ')).toEqual([]);
  });

  it('nimmt mit der Eingabetaste nur den genauen Namen oder Zweitnamen', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    db.put(
      'entities',
      createEntity({ kind: 'person', name: 'Daria Hagel', aliases: ['Die Hagel'] }),
    );
    const data = db.getSnapshot();
    expect(exactFind(boardFinds(data, 'daria  hagel'), 'daria  hagel')).toBe(0);
    expect(exactFind(boardFinds(data, 'die hagel'), 'die hagel')).toBe(0);
    expect(exactFind(boardFinds(data, 'Daria'), 'Daria')).toBe(-1);
  });
});
