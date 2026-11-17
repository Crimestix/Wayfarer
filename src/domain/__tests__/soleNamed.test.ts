import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity } from '../schema';
import { soleNamed } from '../storySheet';

describe('Der eine Name im Satz', () => {
  it('füllt „Wo?“ und „Wer weiß es?“ nur, wenn genau einer dasteht', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const harbour = db.put('entities', createEntity({ kind: 'place', name: 'Möwenhafen' }));
    db.put('entities', createEntity({ kind: 'place', name: 'Schlickmoor' }));
    const monk = db.put('entities', createEntity({ kind: 'person', name: 'Bruder Anselm' }));
    const data = db.getSnapshot();
    expect(soleNamed(data, 'Eine Fischerin bittet in Möwenhafen um Hilfe', ['place'])).toBe(
      harbour.id,
    );
    expect(soleNamed(data, 'Bruder Anselm hat sie gesehen', ['person', 'faction'])).toBe(monk.id);
    // Zwei Orte: keiner ist eindeutig gemeint.
    expect(soleNamed(data, 'Von Möwenhafen ins Schlickmoor', ['place'])).toBeNull();
    expect(soleNamed(data, 'Ein Aushang am Zollhaus', ['place'])).toBeNull();
  });
});
