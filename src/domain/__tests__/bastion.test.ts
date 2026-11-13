import { describe, expect, it } from 'vitest';
import { advanceTime } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { addBastion, runTurn, saveFacility, startRepair } from '../../features/bastion/actions';
import { daysToNextTurn, eventFor, parseEvents, proposeTurn, turnsDue } from '../bastion';
import { createEntity, type BastionFacility } from '../schema';
import { MINUTES_PER_DAY } from '../time/calendar';

const facility = (more: Partial<BastionFacility>): Omit<BastionFacility, 'id'> => ({
  name: 'Schmiede',
  roomId: null,
  kind: 'special',
  ownerId: null,
  orders: ['craft', 'maintain'],
  hirelings: '',
  state: 'ready',
  trackId: null,
  order: null,
  notes: '',
  ...more,
});

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const keep = db.put('entities', createEntity({ kind: 'place', name: 'Burg Graufels' }));
  const brann = db.put('entities', createEntity({ kind: 'character', name: 'Brann Eichwald' }));
  const bastion = addBastion(db, 'Burg Graufels', keep.id);
  return { db, keep, brann, bastion, data: () => db.getSnapshot() };
}

describe('Bastion', () => {
  it('liest die Ereignistabelle und findet den Wurf', () => {
    const rows = parseEvents('1–50: Alles ruhig\n51-55 Angriff\n100: Schatz\nkeine Zeile');
    expect(rows).toEqual([
      { min: 1, max: 50, text: 'Alles ruhig' },
      { min: 51, max: 55, text: 'Angriff' },
      { min: 100, max: 100, text: 'Schatz' },
    ]);
    expect(eventFor(rows, 53)?.text).toBe('Angriff');
    expect(eventFor(rows, 70)).toBeNull();
  });

  it('meldet den Zug nach sieben Tagen – bei langer Zeit auch mehrere', async () => {
    const { db, bastion, data } = await setup();
    const now = () => data().state.now;
    expect(turnsDue(data().bastions[bastion.id]!, now())).toBe(0);
    expect(daysToNextTurn(data().bastions[bastion.id]!, now())).toBe(7);
    advanceTime(db, data().state.now + 15 * MINUTES_PER_DAY);
    expect(turnsDue(data().bastions[bastion.id]!, now())).toBe(2);
  });

  it('schlägt die Befehle vor, führt den Zug aus und nimmt ihn zurück', async () => {
    const { db, brann, bastion, data } = await setup();
    saveFacility(db, bastion.id, facility({ ownerId: brann.id }));
    saveFacility(db, bastion.id, facility({ name: 'Küche', kind: 'basic' }));
    saveFacility(db, bastion.id, facility({ name: 'Labor', state: 'damaged' }));
    advanceTime(db, data().state.now + 7 * MINUTES_PER_DAY);
    const plan = proposeTurn(data().bastions[bastion.id]!);
    // Nur die bereite besondere Einrichtung bekommt einen Befehl.
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ order: 'craft', turnsLeft: 0 });
    const undo = runTurn(
      db,
      bastion.id,
      [{ ...plan[0]!, text: 'ein Langschwert', asLoot: true }],
      'Alles ruhig',
    )!;
    const after = data().bastions[bastion.id]!;
    expect(turnsDue(after, data().state.now)).toBe(0);
    expect(after.facilities[0]!.order).toMatchObject({ name: 'craft', text: 'ein Langschwert' });
    const line = Object.values(data().chronicle).find((e) => e.text.startsWith('Bastionszug'))!;
    expect(line.text).toBe(
      'Bastionszug Burg Graufels\nSchmiede: Herstellen – ein Langschwert – fertig\nEreignis: Alles ruhig',
    );
    expect(Object.values(data().loot).map((l) => [l.text, l.toId, l.given])).toEqual([
      ['ein Langschwert', brann.id, false],
    ]);
    undo();
    expect(turnsDue(data().bastions[bastion.id]!, data().state.now)).toBe(1);
    expect(data().chronicle[line.id]).toBeUndefined();
    expect(Object.values(data().loot)).toEqual([]);
  });

  it('beginnt eine Reparatur als Fortschrittsleiste', async () => {
    const { db, keep, bastion, data } = await setup();
    saveFacility(db, bastion.id, facility({ name: 'Bibliothek', state: 'damaged' }));
    const id = data().bastions[bastion.id]!.facilities[0]!.id;
    startRepair(db, bastion.id, id, 3);
    const repaired = data().bastions[bastion.id]!.facilities[0]!;
    expect(repaired.state).toBe('repairing');
    expect(data().tracks[repaired.trackId!]).toMatchObject({
      name: 'Reparatur: Bibliothek',
      ownerId: keep.id,
      segments: 3,
    });
  });
});
