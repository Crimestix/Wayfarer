import { describe, expect, it } from 'vitest';
import { setAttitude } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { castRowOf } from '../../features/tisch/model';
import { peekView } from '../../features/tisch/peek';
import { attitudeTargets } from '../attitudeSetting';
import { attitudeToParty, mateAttitudeText, mateAttitudes, signedAttitude } from '../derive';
import { memoryOf } from '../memory';
import { PARTY_ID, createEntity } from '../schema';

/** Erfunden: Selra Dornweb mag Arno nicht, ist aber in Fenwick verliebt. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  // Nur die erfundenen Gefährten dieses Tests sind dabei.
  for (const entity of Object.values(db.getSnapshot().entities))
    if (entity.kind === 'character')
      db.patch('entities', entity.id, { character: { ...entity.character, active: false } });
  const selra = db.put('entities', createEntity({ kind: 'person', name: 'Selra Dornweb' }));
  const arno = db.put('entities', createEntity({ kind: 'character', name: 'Arno' }));
  const fenwick = db.put('entities', createEntity({ kind: 'character', name: 'Fenwick' }));
  const gone = db.put(
    'entities',
    createEntity({ kind: 'character', name: 'Ulf', character: { active: false } } as never),
  );
  return { db, selra, arno, fenwick, gone };
}

describe('Haltung je Gefährte', () => {
  it('zeigt nur, was von der Haltung zur Gruppe abweicht, nach dem Namen', async () => {
    const { db, selra, arno, fenwick, gone } = await setup();
    setAttitude(db, selra.id, PARTY_ID, 1, 'Freundlich empfangen');
    setAttitude(db, selra.id, arno.id, -3, 'Er hat sie beleidigt');
    setAttitude(db, selra.id, fenwick.id, 5, 'Verliebt');
    setAttitude(db, selra.id, gone.id, -5, 'Alte Feindschaft');
    const data = db.getSnapshot();
    expect(attitudeToParty(data, selra.id)).toBe(1);
    expect(mateAttitudes(data, selra.id).map((m) => [m.name, m.value])).toEqual([
      ['Arno', -3],
      ['Fenwick', 5],
    ]);
    expect(mateAttitudeText(mateAttitudes(data, selra.id))).toBe('Arno −3 · Fenwick +5');
    // Gleich wie zur Gruppe: sagt nichts Neues.
    setAttitude(db, selra.id, arno.id, 1, 'Versöhnt');
    expect(mateAttitudeText(mateAttitudes(db.getSnapshot(), selra.id))).toBe('Fenwick +5');
    expect(signedAttitude(0)).toBe('±0');
  });

  it('steht am Tisch: Wer hier ist, Kurzblick und Gedächtnis beim Tippen', async () => {
    const { db, selra, arno, fenwick } = await setup();
    setAttitude(db, selra.id, arno.id, -3, 'Beleidigt');
    setAttitude(db, selra.id, fenwick.id, 5, 'Verliebt');
    const data = db.getSnapshot();
    expect(castRowOf(data, selra.id)?.mates).toBe('Arno −3 · Fenwick +5');
    expect(peekView(data, selra.id)?.mates).toBe('Arno −3 · Fenwick +5');
    // Ohne Haltung zur Gruppe nur die zu den Gefährten.
    expect(memoryOf(data, selra.id).find((f) => f.kind === 'attitude')?.text).toBe(
      'Arno −3 · Fenwick +5',
    );
    setAttitude(db, selra.id, PARTY_ID, 1, 'Freundlich');
    expect(memoryOf(db.getSnapshot(), selra.id).find((f) => f.kind === 'attitude')?.text).toMatch(
      /^\S.* · Arno −3 · Fenwick \+5$/,
    );
  });

  it('bietet im Dialog die Gruppe und jeden aktiven Gefährten zur Wahl', async () => {
    const { db, selra, arno, fenwick, gone } = await setup();
    setAttitude(db, selra.id, fenwick.id, 4, 'Mag ihn');
    const data = db.getSnapshot();
    const targets = attitudeTargets(data, selra.id, undefined);
    expect(targets.map((t) => [t.name, t.value])).toEqual([
      ['Gruppe', null],
      ['Arno', null],
      ['Fenwick', 4],
    ]);
    expect(targets.some((t) => t.id === gone.id)).toBe(false);
    // Ein Gefährte selbst wählt nie sich selbst.
    expect(attitudeTargets(data, arno.id, undefined).map((t) => t.name)).toEqual([
      'Gruppe',
      'Fenwick',
    ]);
    // Steht ein anderes Gegenüber fest, gibt es keine Wahl.
    expect(attitudeTargets(data, arno.id, selra.id)).toEqual([]);
    // Und die Haltung zu einem Gefährten steht in der Chronik wie die zur Gruppe.
    const entries = Object.values(db.getSnapshot().chronicle).filter(
      (e) => e.kind === 'attitude' && e.attitude?.toId === fenwick.id,
    );
    expect(entries).toHaveLength(1);
  });
});
