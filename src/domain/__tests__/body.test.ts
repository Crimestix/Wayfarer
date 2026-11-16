import { describe, expect, it } from 'vitest';
import { splitParty } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { linkBody, saveCharacter, switchBody, unlinkBody } from '../../features/gruppe/actions';
import { takeRest } from '../../features/gruppe/rest';
import { bodyPartner, hpAfterSwitch, isResting, restingIn } from '../body';
import { activeParty } from '../derive';
import { groupOf, ledMembers } from '../party';
import { createEntity, createTimer, type Character } from '../schema';

/** Erfunden: Ilo und Ila teilen sich einen Körper; dazu Brom und Sef. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  for (const entity of Object.values(db.getSnapshot().entities))
    if (entity.kind === 'character')
      db.patch('entities', entity.id, { character: { ...entity.character, active: false } });
  const mate = (name: string, hpMax: number) =>
    db.put(
      'entities',
      createEntity({ kind: 'character', name, character: { hpMax, hp: hpMax } } as never),
    ) as Character;
  const ilo = mate('Ilo', 40);
  const ila = mate('Ila', 30);
  const brom = mate('Brom', 50);
  const sef = mate('Sef', 20);
  const town = db.put('entities', createEntity({ kind: 'place', name: 'Graufurt' }));
  db.setState({ placeId: town.id });
  linkBody(db, ilo.id, ila.id);
  return { db, ilo, ila, brom, sef, town };
}

const char = (db: CampaignDb, id: string) => db.getSnapshot().entities[id] as Character;

describe('Zwei Gefährten, ein Körper', () => {
  it('genau einer hat die Kontrolle; wer ruht, zählt nicht als anwesend', async () => {
    const { db, ilo, ila } = await setup();
    const data = db.getSnapshot();
    expect(bodyPartner(data, ilo.id)?.id).toBe(ila.id);
    expect(isResting(data, ila.id)).toBe(true);
    expect(restingIn(data, ilo.id)?.id).toBe(ila.id);
    expect(
      activeParty(data)
        .map((c) => c.name)
        .sort(),
    ).toEqual(['Brom', 'Ilo', 'Sef']);
  });

  it('Schaden als Ilo, wechseln: Ila hat denselben Schaden – mit ihrem Höchstwert', async () => {
    const { db, ilo, ila } = await setup();
    db.patch('entities', ilo.id, { character: { ...char(db, ilo.id).character, hp: 28 } });
    const entries = Object.keys(db.getSnapshot().chronicle).length;
    const undo = switchBody(db, ilo.id)!;
    // 12 Schaden bei Ila (30): 18 übrig; nie unter 0.
    expect(char(db, ila.id).character).toMatchObject({ hp: 18, resting: false });
    expect(char(db, ilo.id).character.resting).toBe(true);
    expect(activeParty(db.getSnapshot()).map((c) => c.name)).toContain('Ila');
    // Nichts in der Chronik.
    expect(Object.keys(db.getSnapshot().chronicle)).toHaveLength(entries);
    undo();
    expect(char(db, ilo.id).character).toMatchObject({ hp: 28, resting: false });
    expect(hpAfterSwitch({ ...ilo, character: { ...ilo.character, hp: 0 } }, ila)).toBe(0);
  });

  it('Zustände und Erschöpfung bleiben beim Wechsel, ebenso Teilgruppe, Marsch und Wirkungen', async () => {
    const { db, ilo, ila, brom } = await setup();
    db.patch('entities', ilo.id, {
      character: { ...char(db, ilo.id).character, conditions: ['Vergiftet'], exhaustion: 2 },
    });
    db.setState({ march: [[ilo.id, brom.id]] });
    const light = db.put(
      'timers',
      createTimer({ label: 'Fackel', start: 0, end: 10_000_000, refs: [ilo.id] }),
    );
    splitParty(db, [{ memberIds: [ilo.id], minutes: 60, text: 'wacht am Tor' }]);
    switchBody(db, ilo.id);
    const data = db.getSnapshot();
    expect(char(db, ila.id).character).toMatchObject({ conditions: ['Vergiftet'], exhaustion: 2 });
    expect(groupOf(data, ila.id)?.memberIds).toEqual([ila.id]);
    expect(groupOf(data, ilo.id)).toBeNull();
    expect(data.state.march).toEqual([[ila.id, brom.id]]);
    expect(data.timers[light.id]!.refs).toEqual([ila.id]);
  });

  it('eine Rast heilt den Körper einmal', async () => {
    const { db, ilo, ila, brom, sef } = await setup();
    db.patch('entities', ilo.id, { character: { ...char(db, ilo.id).character, hp: 10 } });
    takeRest(db, {
      kind: 'long',
      participants: activeParty(db.getSnapshot()).map((c) => c.id),
    });
    expect(char(db, ilo.id).character.hp).toBe(40);
    // Ila wurde nicht eigens geheilt – sie übernimmt den Körper mit dem Stand des Körpers.
    switchBody(db, ila.id);
    expect(char(db, ila.id).character.hp).toBe(30);
    expect([brom.id, sef.id].every((id) => char(db, id).character.hp !== null)).toBe(true);
  });

  it('bleibt beim Speichern im Dialog verbunden und lässt sich lösen', async () => {
    const { db, ilo, ila } = await setup();
    const current = char(db, ilo.id);
    saveCharacter(db, ilo.id, {
      name: 'Ilo',
      tagline: '',
      image: null,
      character: { ...current.character, bodyWith: null, resting: false },
    });
    expect(char(db, ilo.id).character.bodyWith).toBe(ila.id);
    unlinkBody(db, ila.id);
    expect(char(db, ilo.id).character).toMatchObject({ bodyWith: null, resting: false });
    expect(char(db, ila.id).character).toMatchObject({ bodyWith: null, resting: false });
    expect(activeParty(db.getSnapshot())).toHaveLength(4);
  });
  it('getrennt verbunden: wer ruht, gehört keiner Teilgruppe an, und ein Wechsel doppelt niemanden', async () => {
    const { db, ilo, ila, brom, sef } = await setup();
    unlinkBody(db, ilo.id);
    // Getrennt: Brom geht für eine Stunde wachen; Ilo, Ila und Sef bleiben (geleitet).
    splitParty(db, [{ memberIds: [brom.id], minutes: 60, text: 'wacht am Tor' }]);
    db.setState({ march: [[ilo.id, ila.id], [sef.id]] });
    linkBody(db, ilo.id, ila.id);
    expect(ledMembers(db.getSnapshot()).sort()).toEqual([ilo.id, sef.id].sort());
    switchBody(db, ilo.id);
    const data = db.getSnapshot();
    expect(ledMembers(data).sort()).toEqual([ila.id, sef.id].sort());
    expect(data.state.march).toEqual([[ila.id], [sef.id]]);
    expect(groupOf(data, ilo.id)).toBeNull();
  });

  it('Lösen in einer Teilgruppe: beide bleiben in ihr', async () => {
    const { db, ilo, ila, brom } = await setup();
    // Ilo (mit Ila im Körper) geht für zwei Stunden ins Archiv, Brom und Sef bleiben (geleitet).
    splitParty(db, [{ memberIds: [ilo.id], minutes: 120, text: 'liest' }]);
    unlinkBody(db, ilo.id);
    const data = db.getSnapshot();
    expect(groupOf(data, ila.id)?.id).toBe(groupOf(data, ilo.id)?.id);
    expect(ledMembers(data)).not.toContain(ila.id);
    expect(ledMembers(data)).toContain(brom.id);
  });

  it('wer während der Trennung dazukommt, geht mit der geleiteten Teilgruppe', async () => {
    const { db, brom, sef } = await setup();
    splitParty(db, [{ memberIds: [brom.id], minutes: 60, text: 'wacht am Tor' }]);
    const neu = db.put(
      'entities',
      createEntity({ kind: 'character', name: 'Tavi', character: { hpMax: 9, hp: 9 } } as never),
    );
    const data = db.getSnapshot();
    expect(ledMembers(data)).toContain(neu.id);
    expect(groupOf(data, neu.id)?.led).toBe(true);
    // … und lässt sich von dort aus wie jeder andere losschicken.
    const sent = splitParty(db, [
      { memberIds: [neu.id, sef.id], minutes: 30, text: 'holt Wasser' },
    ]);
    expect('problem' in sent).toBe(false);
  });
});
