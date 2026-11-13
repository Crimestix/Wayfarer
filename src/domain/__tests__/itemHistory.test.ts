import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { recordEntry } from '../../data/record';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { giveLoot, saveLoot, takeBackLoot, type LootInput } from '../../features/beute/actions';
import { noteHolderChange, patchDetails } from '../../features/welt/actions';
import {
  holdingName,
  holdingSpan,
  holdersOf,
  itemEventWhen,
  itemEventWho,
  itemHistory,
  readyFor,
} from '../itemHistory';
import { createEntity, type Item } from '../schema';
import { MINUTES_PER_DAY } from '../time/calendar';

/** Eine Welt mit Hohenfurt, zwei erfundenen Gefährten und einem Kompass, der bei Lando liegt. */
async function setup(history = true) {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  for (const entity of Object.values(db.getSnapshot().entities))
    if (entity.kind === 'character') db.remove('entities', entity.id);
  const data = () => db.getSnapshot();
  const hohenfurt = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  db.setState({ placeId: hohenfurt.id });
  const mate = (name: string) => db.put('entities', createEntity({ kind: 'character', name }));
  const [mira, odo] = [mate('Mira Tannhaus'), mate('Odo Tannhaus')];
  const lando = db.put('entities', createEntity({ kind: 'person', name: 'Lando Furtner' }));
  const compass = db.put(
    'entities',
    createEntity({
      kind: 'item',
      name: 'Kompass der Tiefe',
      item: { holderId: lando.id, history },
    }),
  ) as Item;
  const later = (days: number) => db.setState({ now: data().state.now + days * MINUTES_PER_DAY });
  const loot = (more: Partial<LootInput>) =>
    saveLoot(db, {
      text: '',
      gold: 0,
      itemId: null,
      toId: null,
      source: '',
      storyId: null,
      ...more,
    })!;
  const item = () => data().entities[compass.id] as Item;
  return { db, data, hohenfurt, mira, odo, lando, compass, later, loot, item };
}

describe('Lebenslauf eines Gegenstands', () => {
  it('ist ausgeschaltet, bis der Spielleiter ihn einschaltet', async () => {
    const { db, data, compass, mira, item } = await setup(false);
    expect(createEntity({ kind: 'item', name: 'Becher' })).toMatchObject({
      item: { history: false },
    });
    patchDetails(db, item(), { holderId: mira.id });
    expect(item().item.holderId).toBe(mira.id);
    expect(Object.values(data().chronicle).some((e) => e.refs.includes(compass.id))).toBe(false);
  });

  it('hält einen neuen Besitzer als Veränderung fest – jetzt, am Ort der Gruppe', async () => {
    const { db, data, compass, mira, lando, hohenfurt, item } = await setup();
    patchDetails(db, item(), { holderId: mira.id });
    const entries = Object.values(data().chronicle).filter((e) => e.refs.includes(compass.id));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'change',
      text: 'Kompass der Tiefe ist jetzt bei Mira Tannhaus',
      refs: [compass.id, mira.id],
      placeId: hohenfurt.id,
      at: data().state.now,
      secret: true,
      holder: { itemId: compass.id, holderId: mira.id, before: lando.id },
    });
    // An einem Ort: „in“.
    patchDetails(db, item(), { holderId: hohenfurt.id });
    expect(
      Object.values(data().chronicle).find((e) => e.holder?.holderId === hohenfurt.id)?.text,
    ).toBe('Kompass der Tiefe ist jetzt in Hohenfurt');
    patchDetails(db, item(), { holderId: mira.id });
    // Nichts geändert: nichts festgehalten.
    patchDetails(db, item(), { category: 'Artefakt' });
    patchDetails(db, item(), { holderId: mira.id });
    expect(Object.values(data().chronicle).filter((e) => e.refs.includes(compass.id))).toHaveLength(
      3,
    );
    // Unbekannter Verbleib.
    patchDetails(db, item(), { holderId: null });
    expect(Object.values(data().chronicle).find((e) => e.holder?.holderId === null)?.text).toBe(
      'Verbleib von Kompass der Tiefe ist jetzt unbekannt',
    );
  });

  it('nimmt den Besitzer aus dem Dialog wie aus dem Überblick', async () => {
    const { db, data, odo, item } = await setup();
    const before = item();
    const after = db.put('entities', { ...before, item: { ...before.item, holderId: odo.id } });
    const entry = noteHolderChange(db, before, after);
    expect(entry?.holder).toMatchObject({ holderId: odo.id });
    expect(noteHolderChange(db, undefined, after)).toBeNull();
    expect(data().chronicle[entry!.id]).toBeDefined();
  });

  it('doppelt keine Ausgabe aus dem Beute-Buch', async () => {
    const { db, data, compass, mira, loot } = await setup();
    const given = loot({ itemId: compass.id, toId: mira.id, source: 'Truhe in der Salzgrotte' });
    giveLoot(db, given.id);
    const lines = Object.values(data().chronicle).filter((e) => e.refs.includes(compass.id));
    expect(lines).toHaveLength(1);
    const history = itemHistory(data(), compass.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      sort: 'given',
      label: 'Beute',
      whoIds: [mira.id],
      party: false,
      source: 'Truhe in der Salzgrotte',
      lootId: given.id,
    });
  });

  it('ordnet Entstehung, Beute, Wechsel, Chronik und Ende nach der Zeit', async () => {
    const { db, data, compass, mira, odo, lando, later, loot, item } = await setup();
    const start = data().state.now;
    db.patch('entities', compass.id, {
      born: { at: start - 400 * 365 * MINUTES_PER_DAY, precision: 'year' },
    });
    later(1);
    giveLoot(db, loot({ itemId: compass.id, toId: mira.id }).id);
    later(2);
    const note = recordEntry(db, {
      kind: 'note',
      text: 'Der Kompass zeigt nach unten.',
      refs: [compass.id, mira.id],
      secret: true,
    });
    expect('entry' in note).toBe(true);
    later(3);
    patchDetails(db, item(), { holderId: odo.id });
    later(1);
    db.patch('entities', compass.id, { ended: { at: data().state.now, precision: 'day' } });

    const history = itemHistory(data(), compass.id);
    expect(history.map((e) => e.sort)).toEqual(['made', 'given', 'entry', 'holder', 'ended']);
    expect(history[0]!.label).toBe('Geschaffen');
    expect(history[2]).toMatchObject({ label: 'Notiz', secret: true, whoIds: [mira.id] });
    expect(history[3]).toMatchObject({ label: 'Neuer Besitzer', whoIds: [odo.id] });
    expect(history[4]!.label).toBe('Zerstört');

    const holders = holdersOf(data(), compass.id);
    expect(holders.map((h) => h.holderId)).toEqual([lando.id, mira.id, odo.id]);
    expect(holders[0]).toMatchObject({ from: start - 400 * 365 * MINUTES_PER_DAY });
    expect(holders[1]).toMatchObject({ from: start + MINUTES_PER_DAY, to: history[3]!.at });
    // Zerstört: niemand hat ihn heute.
    expect(holders[2]).toMatchObject({ current: false, to: data().state.now });
  });

  it('gilt beim Einschalten für alles, was schon dasteht', async () => {
    const { db, data, compass, mira, lando, later, loot, item } = await setup(false);
    later(1);
    giveLoot(db, loot({ itemId: compass.id, toId: mira.id }).id);
    expect(itemHistory(data(), compass.id)).toHaveLength(1);
    patchDetails(db, item(), { history: true });
    expect(holdersOf(data(), compass.id)).toMatchObject([
      { holderId: lando.id, from: null, current: false },
      { holderId: mira.id, current: true },
    ]);
  });

  it('kennt Beute für die Gruppe und den heutigen Besitzer, auch ohne Wechsel', async () => {
    const { db, data, compass, odo, later, loot } = await setup();
    later(1);
    giveLoot(db, loot({ itemId: compass.id, toId: null }).id);
    const holders = holdersOf(data(), compass.id);
    expect(holders.at(-1)).toMatchObject({ party: true, holderId: null, current: true });
    expect(holdingName(data(), holders.at(-1)!)).toBe('die Gruppe');
    // Von Hand umgesetzt, ohne dass ein Wechsel festgehalten wurde (etwa aus dem Steckbrief).
    db.patch('entities', compass.id, {
      item: { holderId: odo.id, category: '', history: false },
    });
    expect(holdersOf(data(), compass.id).at(-1)).toMatchObject({
      holderId: odo.id,
      from: null,
      current: true,
    });
  });

  it('lässt zurückgenommene Ausgaben weg und kennt bereitliegende Beute', async () => {
    const { db, data, compass, mira, lando, loot } = await setup();
    const given = loot({ itemId: compass.id, toId: mira.id });
    giveLoot(db, given.id);
    takeBackLoot(db, given.id);
    expect(itemHistory(data(), compass.id)).toEqual([]);
    expect(readyFor(data(), compass.id).map((l) => l.id)).toEqual([given.id]);
    expect(holdersOf(data(), compass.id)).toMatchObject([{ holderId: lando.id, current: true }]);
  });

  it('nennt Zeiten so genau, wie sie bekannt sind', async () => {
    const { db, data, compass, mira } = await setup();
    const cal = data().campaign.calendar;
    const now = data().state.now;
    db.patch('entities', compass.id, { born: { at: now, precision: 'year' } });
    const made = itemHistory(data(), compass.id)[0]!;
    expect(itemEventWhen(cal, now, made)).toMatch(/\d/);
    expect(itemEventWhen(cal, now, { ...made, precision: 'approx' })).toMatch(/^etwa /);
    const holding = {
      holderId: mira.id,
      party: false,
      from: now,
      to: null,
      current: true,
      secret: false,
    };
    expect(holdingSpan(cal, now, holding)).toMatch(/^seit /);
    expect(holdingSpan(cal, now, { ...holding, from: null })).toBe('bis heute');
    expect(itemEventWho(data(), { ...made, sort: 'given', party: true })).toBe('an die Gruppe');
    expect(itemEventWho(data(), { ...made, sort: 'given', whoIds: [mira.id] })).toBe('an');
    expect(itemEventWho(data(), { ...made, sort: 'holder' })).toBe('Verbleib unbekannt');
    expect(itemEventWho(data(), { ...made, sort: 'entry', whoIds: [mira.id] })).toBe('mit');
    expect(itemEventWho(data(), made)).toBe('');
    expect(holdingSpan(cal, now, { ...holding, current: false, from: null, to: null })).toBe(
      'Zeit unbekannt',
    );
  });
});
