import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  giveLoot,
  removeLoot,
  saveLoot,
  takeBackLoot,
  type LootInput,
} from '../../features/beute/actions';
import { newStory, setInPlay } from '../../features/faeden/actions';
import {
  eveningLoot,
  formatGold,
  lootBook,
  lootLine,
  lootRecipient,
  parseGold,
  readyLoot,
  receivedBy,
  receivedText,
} from '../loot';
import { playView } from '../play';
import { prepAdvice, prepView } from '../prep';
import { createEntity } from '../schema';
import { deleteEntity } from '../../data/actions';
import { removeEntry } from '../../features/tisch/commands';
import { patchStory } from '../../features/faeden/actions';

/** Eine laufende Session am Markt von Hohenfurt, mit zwei erfundenen Gefährten. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  for (const entity of Object.values(db.getSnapshot().entities))
    if (entity.kind === 'character') db.remove('entities', entity.id);
  const data = () => db.getSnapshot();
  const market = db.put('entities', createEntity({ kind: 'place', name: 'Markt' }));
  db.setState({ placeId: market.id });
  const mate = (name: string) => db.put('entities', createEntity({ kind: 'character', name }));
  const [mira, odo] = [mate('Mira'), mate('Odo')];
  const compass = db.put('entities', createEntity({ kind: 'item', name: 'Kompass der Tiefe' }));
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
  return { db, data, market, mira, odo, compass, loot };
}

describe('Das Beute-Buch', () => {
  it('schreibt Beute in einer Zeile', async () => {
    const { data, mira, compass, loot } = await setup();
    expect(formatGold(20)).toBe('20 GM');
    expect(formatGold(1250.5)).toBe('1.250,5 GM');
    expect(lootLine(data(), loot({ text: 'Ein Beutel fremder Münzen', gold: 20 }))).toBe(
      'Ein Beutel fremder Münzen · 20 GM',
    );
    // Ein Gegenstand der Welt steht mit seinem Namen da – aber nicht doppelt.
    expect(lootLine(data(), loot({ itemId: compass.id }))).toBe('Kompass der Tiefe');
    expect(lootLine(data(), loot({ text: 'Aus dem Hort', itemId: compass.id }))).toBe(
      'Aus dem Hort · Kompass der Tiefe',
    );
    expect(
      lootLine(data(), loot({ text: 'Der Kompass der Tiefe, verbeult', itemId: compass.id })),
    ).toBe('Der Kompass der Tiefe, verbeult');
    expect(lootRecipient(data(), loot({ gold: 5 }))).toBe('die Gruppe');
    expect(lootRecipient(data(), loot({ gold: 5, toId: mira.id }))).toBe('Mira');
  });

  it('legt Beute bereit – ohne Inhalt entsteht nichts', async () => {
    const { db, data, market, mira, loot } = await setup();
    expect(
      saveLoot(db, { text: '  ', gold: 0, itemId: null, toId: null, source: '', storyId: null }),
    ).toBeNull();
    const story = newStory(db);
    const purse = loot({ text: ' Ein  Beutel ', gold: 20.004, toId: market.id, storyId: 'nein' });
    // Aufgeräumt: Leerzeichen, Gold auf Hundertstel, nur Gefährten als Empfänger.
    expect(purse).toMatchObject({ text: 'Ein Beutel', gold: 20, toId: null, storyId: null });
    const ring = loot({ text: 'Ein Siegelring', toId: mira.id, storyId: story.id });
    expect(readyLoot(data()).map((entry) => entry.id)).toEqual([purse.id, ring.id]);
    expect(readyLoot(data(), story.id).map((entry) => entry.id)).toEqual([ring.id]);
    expect(readyLoot(data(), null).map((entry) => entry.id)).toEqual([purse.id]);
    saveLoot(db, { ...ring, gold: 3 }, ring.id);
    expect(data().loot[ring.id]!.gold).toBe(3);
  });

  it('gibt Beute aus: Abend, Ort, Chronik – und der Gegenstand wechselt den Besitzer', async () => {
    const { db, data, market, mira, compass, loot } = await setup();
    const session = data().state.sessionId!;
    const prize = loot({
      itemId: compass.id,
      gold: 15,
      toId: mira.id,
      source: 'aus dem Hort des Aalwächters',
    });
    const undo = giveLoot(db, prize.id)!;
    const given = data().loot[prize.id]!;
    expect(given).toMatchObject({
      given: true,
      at: data().state.now,
      sessionId: session,
      placeId: market.id,
    });
    const entry = data().chronicle[given.chronicleId!]!;
    expect(entry.text).toBe(
      'Beute: Kompass der Tiefe · 15 GM – an Mira (aus dem Hort des Aalwächters)',
    );
    expect(entry.refs.sort()).toEqual([mira.id, compass.id].sort());
    const holder = () => {
      const item = data().entities[compass.id];
      return item?.kind === 'item' ? item.item.holderId : undefined;
    };
    expect(holder()).toBe(mira.id);
    // Ein zweites Mal ausgeben geht nicht.
    expect(giveLoot(db, prize.id)).toBeNull();
    expect(readyLoot(data())).toEqual([]);

    undo();
    expect(data().loot[prize.id]).toMatchObject({ given: false, at: null, chronicleId: null });
    expect(data().chronicle[entry.id]).toBeUndefined();
    expect(holder()).toBeNull();
  });

  it('weiß, wer was bekommen hat – und schreibt „Heute erhalten“', async () => {
    const { db, data, mira, odo, loot } = await setup();
    const session = data().sessions[data().state.sessionId!]!;
    for (const entry of [
      loot({ text: 'Ein Beutel fremder Münzen', gold: 40 }),
      loot({ text: 'Ein Siegelring', gold: 5, toId: mira.id }),
      loot({ text: 'Ein Dolch aus Aalzahn', toId: odo.id }),
      loot({ text: 'Lohn des Fährmanns', gold: 10, toId: mira.id }),
    ])
      giveLoot(db, entry.id);
    const waiting = loot({ text: 'Die Karte der Aalinsel' });

    const book = lootBook(data());
    expect(book.ready.map((entry) => entry.id)).toEqual([waiting.id]);
    expect(book.gold).toBe(55);
    expect(book.sessions).toHaveLength(1);
    expect(book.sessions[0]).toMatchObject({ session: { id: session.id }, gold: 55 });
    expect(book.shares.map((share) => [share.character?.name ?? 'Gruppe', share.gold])).toEqual([
      ['Gruppe', 40],
      ['Mira', 15],
      ['Odo', 0],
    ]);
    expect(book.shares[1]!.items).toHaveLength(2);
    expect(receivedText(data(), session.id)).toBe(
      [
        `Beute – Session ${session.number}`,
        'Die Gruppe: Ein Beutel fremder Münzen · 40 GM',
        'Mira: Ein Siegelring · 5 GM; Lohn des Fährmanns · 10 GM',
        'Odo: Ein Dolch aus Aalzahn',
      ].join('\n'),
    );
    expect(receivedText(data(), 'gibtsnicht')).toBe('');

    // Zurücknehmen und Löschen räumen die Chronik mit auf.
    const ring = book.shares[1]!.items.find((entry) => entry.text === 'Ein Siegelring')!;
    takeBackLoot(db, ring.id);
    expect(lootBook(data()).shares[1]!.gold).toBe(10);
    const purse = lootBook(data()).shares[0]!.items[0]!;
    const back = removeLoot(db, purse.id)!;
    expect(data().loot[purse.id]).toBeUndefined();
    expect(data().chronicle[purse.chronicleId!]).toBeUndefined();
    back();
    expect(data().loot[purse.id]).toBeDefined();
    expect(data().chronicle[purse.chronicleId!]).toBeDefined();
  });

  it('zeigt Beute dort, wo sie hingehört: bei der Geschichte im Spiel, sonst beim Abend', async () => {
    const { db, data, mira, loot } = await setup();
    const advice = () =>
      prepAdvice(data(), prepView(data()).content).find((item) => item.key === 'loot');

    expect(advice()?.done).toBe(false);
    const story = newStory(db);
    const purse = loot({ text: 'Ein Beutel fremder Münzen', gold: 20 });
    const ring = loot({ text: 'Ein Siegelring', toId: mira.id, storyId: story.id });
    expect(advice()?.done).toBe(true);
    const ofStory = () =>
      playView(data())
        .cards.flatMap((card) => card.loot)
        .map((entry) => entry.id);

    // Die Geschichte ist nicht im Spiel: Beides liegt beim Abend.
    expect(eveningLoot(data()).map((entry) => entry.id)).toEqual([purse.id, ring.id]);
    expect(ofStory()).toEqual([]);
    setInPlay(db, 'story:' + story.id, true);
    expect(eveningLoot(data()).map((entry) => entry.id)).toEqual([purse.id]);
    expect(ofStory()).toEqual([ring.id]);

    giveLoot(db, ring.id);
    expect(ofStory()).toEqual([]);
    expect(receivedBy(data(), mira.id)).toMatchObject({ gold: 0, items: [{ id: ring.id }] });
    expect(data().chronicle[data().loot[ring.id]!.chronicleId!]!.storyId).toBe(story.id);
  });

  it('nimmt mit der Ausgabe auch den Gegenstand zurück', async () => {
    const { db, data, mira, odo, compass, loot } = await setup();
    const holder = () => {
      const item = data().entities[compass.id];
      return item?.kind === 'item' ? item.item.holderId : undefined;
    };
    const prize = loot({ itemId: compass.id, toId: mira.id });
    giveLoot(db, prize.id);
    expect(holder()).toBe(mira.id);
    takeBackLoot(db, prize.id);
    expect(holder()).toBeNull();

    // Löschen einer Ausgabe nimmt ihn ebenfalls zurück – und „Rückgängig“ gibt ihn wieder.
    giveLoot(db, prize.id);
    const back = removeLoot(db, prize.id)!;
    expect(holder()).toBeNull();
    back();
    expect(holder()).toBe(mira.id);

    // Hat ihn inzwischen jemand anderes, bleibt er dort.
    const item = data().entities[compass.id]!;
    if (item.kind === 'item')
      db.put('entities', { ...item, item: { ...item.item, holderId: odo.id } });
    takeBackLoot(db, prize.id);
    expect(holder()).toBe(odo.id);
  });

  it('liest Gold, wie man es schreibt', () => {
    expect(parseGold('')).toBe(0);
    expect(parseGold(' 20 ')).toBe(20);
    expect(parseGold('12,5')).toBe(12.5);
    expect(parseGold('1.250')).toBe(1250);
    expect(parseGold('1.250,50')).toBe(1250.5);
    expect(parseGold('2.5')).toBe(2.5);
    expect(parseGold('300 GM')).toBe(300);
    expect(parseGold('abc')).toBeNull();
    expect(parseGold('-5')).toBeNull();
    expect(parseGold('1,2,3')).toBeNull();
  });

  it('bringt einen Gegenstand dorthin zurück, wo er vorher lag', async () => {
    const { db, data, market, mira, odo, compass, loot } = await setup();
    const holder = () => {
      const item = data().entities[compass.id];
      return item?.kind === 'item' ? item.item.holderId : undefined;
    };
    const lay = (id: string | null) => {
      const item = data().entities[compass.id]!;
      if (item.kind === 'item')
        db.put('entities', { ...item, item: { ...item.item, holderId: id } });
    };
    lay(market.id);
    // An die Gruppe: Er liegt nicht mehr am Markt.
    const forAll = loot({ itemId: compass.id });
    giveLoot(db, forAll.id);
    expect(holder()).toBeNull();
    const again = takeBackLoot(db, forAll.id)!;
    expect(holder()).toBe(market.id);
    // „Rückgängig“ gibt ihn so wieder aus, wie er war – mit Abend, Zeit und Zeile.
    again();
    expect(data().loot[forAll.id]).toMatchObject({ given: true, holderBefore: market.id });
    expect(data().chronicle[data().loot[forAll.id]!.chronicleId!]).toBeDefined();
    removeLoot(db, forAll.id);
    expect(holder()).toBe(market.id);

    // Ändern einer Ausgabe: Gegenstand und Zeile ziehen mit, der Abend bleibt.
    const prize = loot({ itemId: compass.id, toId: mira.id });
    giveLoot(db, prize.id);
    const at = data().loot[prize.id]!.at;
    saveLoot(db, { ...data().loot[prize.id]!, toId: odo.id }, prize.id);
    expect(holder()).toBe(odo.id);
    const changed = data().loot[prize.id]!;
    expect(changed).toMatchObject({ toId: odo.id, at, holderBefore: market.id });
    expect(data().chronicle[changed.chronicleId!]!.text).toBe('Beute: Kompass der Tiefe – an Odo');
    takeBackLoot(db, prize.id);
    expect(holder()).toBe(market.id);
  });

  it('nimmt eine Ausgabe zurück, wenn ihre Zeile aus der Mitschrift gelöscht wird', async () => {
    const { db, data, mira, loot } = await setup();
    const ring = loot({ text: 'Ein Siegelring', toId: mira.id });
    giveLoot(db, ring.id);
    const line = data().loot[ring.id]!.chronicleId!;
    const removed = removeEntry(db, line)!;
    expect(data().chronicle[line]).toBeUndefined();
    expect(data().loot[ring.id]!.given).toBe(false);
    removed.undo();
    expect(data().loot[ring.id]).toMatchObject({ given: true, chronicleId: line });
    expect(data().chronicle[line]).toBeDefined();
  });

  it('zeigt die Beute einer abgeschlossenen Geschichte beim Abend', async () => {
    const { db, data, loot } = await setup();
    const story = newStory(db);
    const ring = loot({ text: 'Ein Siegelring', storyId: story.id });
    setInPlay(db, 'story:' + story.id, true);
    expect(eveningLoot(data())).toEqual([]);
    patchStory(db, story.id, { closed: true });
    expect(eveningLoot(data()).map((entry) => entry.id)).toEqual([ring.id]);
  });

  it('räumt auf, wenn ein Gegenstand oder Gefährte gelöscht wird', async () => {
    const { db, data, mira, compass, loot } = await setup();
    const bare = loot({ itemId: compass.id, toId: mira.id });
    const given = loot({ text: 'Ein Siegelring', toId: mira.id });
    giveLoot(db, given.id);
    deleteEntity(db, compass.id);
    expect(data().loot[bare.id]).toMatchObject({ itemId: null, text: 'Kompass der Tiefe' });
    deleteEntity(db, mira.id);
    expect(data().loot[bare.id]!.toId).toBeNull();
    expect(data().loot[given.id]!.toId).toBe(mira.id);
  });
});
