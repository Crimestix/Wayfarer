import { describe, expect, it } from 'vitest';
import { endSession, logEntry, moveParty, setTime, startSession } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { lastSessionLines } from '../../domain/prep';
import { createEntity } from '../../domain/schema';
import { lastLinesView, startLineOf } from './model';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  endSession(db);
  const data = () => db.getSnapshot();
  for (const entry of Object.values(data().chronicle)) db.remove('chronicle', entry.id);
  for (const session of Object.values(data().sessions)) db.remove('sessions', session.id);
  return { db, data };
}

describe('Wo es zuletzt aufhörte – als Zeilen', () => {
  it('sagt, warum nichts dasteht, solange kein Abend gespielt ist', async () => {
    const { data } = await setup();
    const view = lastLinesView(data(), lastSessionLines(data()), '');
    expect(view.lines).toEqual([]);
    expect(view.empty).toContain('Sobald ein Abend gespielt ist');
  });

  it('zeigt Geschriebenes wörtlich und Ortswechsel als Kurzfassung', async () => {
    const { db, data } = await setup();
    const steg = db.put('entities', createEntity({ kind: 'place', name: 'Nebelsteg' }));
    startSession(db, { title: 'Das leere Boot' });
    logEntry(db, { text: 'Mira verschwindet im Schilf.' });
    setTime(db, data().state.now + 10);
    const travel = moveParty(db, steg.id, 'Im Regen.')!;
    endSession(db);

    expect(startLineOf(data(), travel)).toBe('Ankunft: Nebelsteg. Im Regen.');
    const view = lastLinesView(data(), lastSessionLines(data()), 'Mira verschwindet im Schilf.');
    expect(view.title).toMatch(/^Wo es zuletzt aufhörte – Session \d+ – Das leere Boot$/);
    expect(view.empty).toBe('');
    expect(view.lines.map((line) => [line.kind, line.line, line.taken])).toEqual([
      ['Notiz', 'Mira verschwindet im Schilf.', true],
      ['Ortswechsel', 'Ankunft: Nebelsteg. Im Regen.', false],
    ]);
  });

  it('sagt es, wenn der letzte Abend nichts in der Chronik hat', async () => {
    const { db, data } = await setup();
    startSession(db);
    endSession(db);
    const view = lastLinesView(data(), lastSessionLines(data()), '');
    expect(view.lines).toEqual([]);
    expect(view.empty).toMatch(/^Zu Session \d+ steht nichts in der Chronik\.$/);
  });
});
