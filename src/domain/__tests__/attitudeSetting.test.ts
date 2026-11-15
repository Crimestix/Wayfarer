import { describe, expect, it } from 'vitest';
import { dropAttitudeSettings, setAttitude } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { demoCampaign } from '../../data/__fixtures__/demoWorld';
import { MemoryStore } from '../../data/store';
import { attitudeModeChoice, attitudeSettings } from '../attitudeSetting';
import { attitudeHistory, attitudeToParty, entitiesOfKind } from '../derive';
import { PARTY_ID } from '../schema';

async function demoDb() {
  return CampaignDb.create(new MemoryStore(), demoCampaign());
}
const person = (db: CampaignDb, name: string) =>
  entitiesOfKind(db.getSnapshot(), 'person').find((p) => p.name === name)!;
const attitudeCount = (db: CampaignDb) =>
  Object.values(db.getSnapshot().chronicle).filter((e) => e.kind === 'attitude').length;

describe('Haltung festlegen oder ändern', () => {
  it('schlägt „War schon so“ vor, wenn es weder Haltung noch Verlauf gibt', async () => {
    const db = await demoDb();
    const kessa = person(db, 'Kessa Flutwind');
    expect(attitudeModeChoice(db.getSnapshot(), kessa.id, PARTY_ID)).toEqual({
      givenPossible: true,
      preset: 'given',
    });
    const voss = person(db, 'Hauptmann Voss');
    // Voss hat einen Verlauf – seine Haltung ist eine Änderung.
    expect(attitudeModeChoice(db.getSnapshot(), voss.id, PARTY_ID)).toEqual({
      givenPossible: false,
      preset: 'change',
    });
  });

  it('trägt „War schon so“ ohne Eintrag in der Chronik ein', async () => {
    const db = await demoDb();
    const kessa = person(db, 'Kessa Flutwind');
    const before = attitudeCount(db);
    setAttitude(db, kessa.id, PARTY_ID, 2, '', 'given');
    expect(attitudeToParty(db.getSnapshot(), kessa.id)).toBe(2);
    expect(attitudeCount(db)).toBe(before);
    // Danach ist jede Änderung wieder Geschichte – erst recht nach einem Eintrag.
    setAttitude(db, kessa.id, PARTY_ID, 3, 'Gerettet');
    const history = attitudeHistory(db.getSnapshot(), kessa.id, PARTY_ID);
    expect(history.map((e) => [e.attitude!.before, e.attitude!.after])).toEqual([[2, 3]]);
  });

  it('bleibt eine Änderung, wenn die Chronik zum Paar schon etwas erzählt', async () => {
    const db = await demoDb();
    const voss = person(db, 'Hauptmann Voss');
    const before = attitudeCount(db);
    setAttitude(db, voss.id, PARTY_ID, -4, '', 'given');
    expect(attitudeCount(db)).toBe(before + 1);
  });

  it('nimmt bloße Festlegungen aus der Chronik, die Haltung bleibt', async () => {
    const db = await demoDb();
    const kessa = person(db, 'Kessa Flutwind');
    setAttitude(db, kessa.id, PARTY_ID, 1);
    db.setState({ now: db.getSnapshot().state.now + 60 });
    setAttitude(db, kessa.id, PARTY_ID, -1, 'Verraten');
    const settings = attitudeSettings(db.getSnapshot());
    const first = settings.find((e) => e.attitude!.fromId === kessa.id)!;
    expect(first.attitude).toMatchObject({ before: null, after: 1 });
    // Ein Eintrag mit Grund oder mit vorheriger Haltung ist nie eine bloße Festlegung.
    expect(settings.every((e) => e.attitude!.before === null && !e.text)).toBe(true);

    const undo = dropAttitudeSettings(db, [first.id]);
    let data = db.getSnapshot();
    expect(data.chronicle[first.id]).toBeUndefined();
    expect(attitudeToParty(data, kessa.id)).toBe(-1);
    // Der spätere Eintrag beginnt jetzt bei der festgelegten Haltung.
    expect(attitudeHistory(data, kessa.id, PARTY_ID).map((e) => e.attitude!.before)).toEqual([1]);

    undo();
    data = db.getSnapshot();
    expect(data.chronicle[first.id]).toBeDefined();
    expect(attitudeHistory(data, kessa.id, PARTY_ID).map((e) => e.attitude!.before)).toEqual([
      null,
      1,
    ]);
  });
});
