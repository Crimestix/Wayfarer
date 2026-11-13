import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  moveTrack,
  removeTrack,
  saveTrack,
  type TrackInput,
} from '../../features/fortschritt/actions';
import { PARTY_ID, createEntity } from '../schema';
import { parseStages, trackGroups, trackView } from '../track';

const input = (more: Partial<TrackInput>): TrackInput => ({
  name: 'Leiste',
  ownerId: null,
  kind: 'steps',
  stages: [],
  target: 0,
  step: 1,
  unit: '',
  segments: 4,
  value: 0,
  note: '',
  ...more,
});

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const brann = db.put('entities', createEntity({ kind: 'character', name: 'Brann Eichwald' }));
  return { db, brann, data: () => db.getSnapshot() };
}

describe('Fortschrittsleisten', () => {
  it('zeigt Stufen, Zahlen und Abschnitte', async () => {
    const { db, brann } = await setup();
    const path = saveTrack(
      db,
      input({
        name: 'Weg der Klinge',
        ownerId: brann.id,
        kind: 'stages',
        stages: parseStages('Schwarz – Grün – Blau – Gold'),
        value: 1,
      }),
    )!;
    expect(trackView(path)).toMatchObject({
      current: 'Grün',
      next: 'Blau',
      pips: [true, true, false, false],
      reached: false,
    });
    const debt = saveTrack(
      db,
      input({
        name: 'Schuld beim Fährmann',
        kind: 'count',
        target: 50000,
        step: 1000,
        unit: 'Gold',
        value: 12000,
      }),
    )!;
    expect(trackView(debt).current).toBe('12.000 von 50.000 Gold');
    const study = saveTrack(db, input({ name: 'Studie', segments: 6, value: 9 }))!;
    expect(study.value).toBe(6); // nie über das Ende
    expect(trackView(study)).toMatchObject({ current: '6 von 6', reached: true });
    expect(saveTrack(db, input({ name: '  ' }))).toBeNull();
    expect(parseStages('Schwarz → Grün, Blau\nGold')).toEqual(['Schwarz', 'Grün', 'Blau', 'Gold']);
  });

  it('geht Schritte, hält sie beim Besitzer fest und nimmt sie zurück', async () => {
    const { db, brann, data } = await setup();
    const path = saveTrack(
      db,
      input({
        name: 'Weg der Klinge',
        ownerId: brann.id,
        kind: 'stages',
        stages: ['Schwarz', 'Grün', 'Blau'],
      }),
    )!;
    const undo = moveTrack(db, path.id, 1)!;
    expect(data().tracks[path.id]!.value).toBe(1);
    const entry = Object.values(data().chronicle).find((e) => e.text === 'Weg der Klinge: Grün')!;
    expect(entry).toMatchObject({ kind: 'change', refs: [brann.id] });
    undo();
    expect(data().tracks[path.id]!.value).toBe(0);
    expect(data().chronicle[entry.id]).toBeUndefined();
    // Am Anfang geht es nicht weiter zurück.
    expect(moveTrack(db, path.id, -1)).toBeNull();
    // Eine Zahl um die Schrittweite; genau gesetzt.
    const debt = saveTrack(
      db,
      input({
        name: 'Schuld',
        ownerId: PARTY_ID,
        kind: 'count',
        target: 100,
        step: 25,
        unit: 'Gold',
      }),
    )!;
    moveTrack(db, debt.id, 1);
    moveTrack(db, debt.id, 60, { exact: true });
    expect(data().tracks[debt.id]!.value).toBe(60);
    const back = removeTrack(db, debt.id)!;
    expect(data().tracks[debt.id]).toBeUndefined();
    back();
    expect(data().tracks[debt.id]).toBeDefined();
    // Nach Besitzern: die Gruppe zuerst, dann Gefährten.
    expect(trackGroups(data()).map((group) => group.title)).toEqual([
      'Die Gruppe',
      'Brann Eichwald',
    ]);
  });
});
