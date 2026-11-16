/** Die Seite eines Dings: Steckbrief-Kasten, Gestalt je Art, Läden. Erfundene Welt. */
import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import {
  PARTY_ID,
  createEntity,
  createRelation,
  createShop,
  type Entity,
  type Item,
  type Person,
  type Place,
  type Topic,
} from '../../domain/schema';
import { createArticle, syncFacts } from '../wiki/actions';
import { setSteckbriefField, steckbriefFields } from '../wiki/factLines';
import { scaffoldOf } from '../wiki/scaffold';
import {
  boxCovers,
  boxRows,
  headFacts,
  pagePlan,
  pageShops,
  worldValue,
  writeBoxText,
} from './page';
import { articleOf, shopToOwnPlace, writeBoxField } from './pageActions';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const put = <E extends Entity>(entity: E): E => db.put('entities', entity) as E;
  const stadt = put(
    createEntity({ kind: 'place', name: 'Kesselbruck', place: { category: 'Stadt' } }) as Place,
  );
  const schmiede = put(
    createEntity({ kind: 'place', name: 'Ambosshalle', place: { parentId: stadt.id } }) as Place,
  );
  const tovan = put(
    createEntity({
      kind: 'person',
      name: 'Tovan Reifschlag',
      person: { role: 'Schmied' },
    }) as Person,
  );
  return { db, put, stadt, schmiede, tovan };
}

const text = (db: CampaignDb, entityId: string) => {
  const article = articleOf(db, entityId)!;
  return article.docs.find((d) => d.kind === 'page')!.text;
};

describe('Steckbrief im Text', () => {
  it('liest alle Felder des ersten Kastens, auch leere, in ihrer Reihenfolge', () => {
    const source = '> [!steckbrief]\n> Beruf: Fährmann\n> Geboren: \n> Wohnort: [[Furt]]\n\nText.';
    expect(steckbriefFields(source)).toEqual([
      { label: 'Beruf', value: 'Fährmann' },
      { label: 'Geboren', value: '' },
      { label: 'Wohnort', value: '[[Furt]]' },
    ]);
    expect(steckbriefFields('Nur Text.')).toEqual([]);
  });

  it('setzt ein Feld nach seiner Bezeichnung und lässt den übrigen Text Zeichen für Zeichen', () => {
    const source = '> [!steckbrief]\n> Beruf: Fährmann\n> Geboren: \n\nEr lacht **laut**.\n';
    expect(setSteckbriefField(source, 'geboren', '612')).toBe(
      '> [!steckbrief]\n> Beruf: Fährmann\n> Geboren: 612\n\nEr lacht **laut**.\n',
    );
    // Leer heißt: die Zeile bleibt leer stehen, sie fällt nie weg.
    expect(setSteckbriefField(source, 'Beruf', '  ')).toContain('> Beruf: \n');
    // Ein eigenes Feld kommt hinter die übrigen.
    expect(setSteckbriefField(source, 'Lieblingsessen', 'Hirse')).toBe(
      '> [!steckbrief]\n> Beruf: Fährmann\n> Geboren: \n> Lieblingsessen: Hirse\n\nEr lacht **laut**.\n',
    );
    // Gleicher Wert: nichts geändert.
    expect(setSteckbriefField(source, 'Beruf', 'Fährmann')).toBe(source);
  });

  it('bekommt mit dem ersten Wort das Gerüst seiner Art, vorher nichts', () => {
    const scaffold = ['Volk', 'Beruf', 'Wohnort'];
    expect(writeBoxText('Ein Text.', 'Beruf', '', scaffold)).toBe('Ein Text.');
    expect(writeBoxText('Ein Text.', 'Beruf', 'Gerber', scaffold)).toBe(
      '> [!steckbrief]\n> Volk: \n> Beruf: Gerber\n> Wohnort: \n\nEin Text.',
    );
    // Mit Kasten: nur das eine Feld, kein Gerüst dazu.
    expect(writeBoxText('> [!steckbrief]\n> Art: Dorf\n', 'Einwohner', '80', scaffold)).toBe(
      '> [!steckbrief]\n> Art: Dorf\n> Einwohner: 80\n',
    );
  });

  it('zeigt erst Geschriebenes, dann die fehlenden Felder des Gerüsts – nicht geschrieben', () => {
    const rows = boxRows('> [!steckbrief]\n> Spezies: Zwerg\n> Beruf: \n', 'person', [
      'Volk',
      'Geboren',
      'Beruf',
    ]);
    // „Spezies“ liest Wayfarer wie „Volk“ – das Gerüst bietet es nicht noch einmal an.
    expect(rows.map((r) => [r.label, r.value, r.written])).toEqual([
      ['Spezies', 'Zwerg', true],
      ['Beruf', '', true],
      ['Geboren', '', false],
    ]);
    expect([...boxCovers(rows)]).toEqual(['species']);
    expect(boxRows(null, 'place', ['Art', 'Herrscher']).every((r) => !r.written)).toBe(true);
  });
});

describe('Was die Welt schon weiß', () => {
  it('steht im leeren Feld: Art, Ort darüber, Beruf – als Name in Worten', async () => {
    const { db, schmiede, tovan, stadt } = await setup();
    const data = db.getSnapshot();
    expect(worldValue(data, stadt, 'kind')).toBe('Stadt');
    expect(worldValue(data, schmiede, 'location')).toBe('Kesselbruck');
    expect(worldValue(data, tovan, 'role')).toBe('Schmied');
    expect(worldValue(data, tovan, 'home')).toBe('');
    expect(worldValue(data, tovan, null)).toBe('');
  });
});

describe('Feld schreiben auf der Seite', () => {
  it('ohne Artikel: entsteht mit dem ersten Wort, mit Gerüst, als Text dieses Eintrags', async () => {
    const { db, tovan } = await setup();
    const entities = Object.keys(db.getSnapshot().entities).length;
    expect(writeBoxField(db, tovan, 'Beruf', '  ')).toBeNull();
    expect(articleOf(db, tovan.id)).toBeNull();

    const articleId = writeBoxField(db, tovan, 'Geboren', '612')!;
    expect(articleOf(db, tovan.id)?.id).toBe(articleId);
    expect(Object.keys(db.getSnapshot().entities)).toHaveLength(entities);
    const written = text(db, tovan.id);
    for (const label of scaffoldOf(db.getSnapshot().campaign, 'person'))
      expect(written).toContain(`> ${label}:`);
    expect(written).toContain('> Geboren: 612');
  });

  it('der Steckbrief speist den Eintrag; was dort steht, merkt sich `fromArticle`', async () => {
    const { db, tovan, stadt } = await setup();
    const articleId = writeBoxField(db, tovan, 'Beruf', 'Hufschmied')!;
    writeBoxField(db, tovan, 'Wohnort', 'Kesselbruck');
    syncFacts(db, [articleId]);
    const person = db.getSnapshot().entities[tovan.id] as Person;
    expect(person.person.role).toBe('Hufschmied');
    expect(person.person.homeId).toBe(stadt.id);
    expect(person.fromArticle.role).toBe('Hufschmied');
    // Eine Änderung im Kasten zieht nach.
    writeBoxField(db, tovan, 'Beruf', 'Waffenschmied');
    syncFacts(db, [articleId]);
    expect((db.getSnapshot().entities[tovan.id] as Person).person.role).toBe('Waffenschmied');
  });

  it('mit Artikel: schreibt in dessen Kasten und legt eine frühere Fassung ab', async () => {
    const { db } = await setup();
    const article = createArticle(db, { title: 'Glutzange', text: 'Eine alte Zange.' })!;
    const item = db.put(
      'entities',
      createEntity({
        kind: 'item',
        name: 'Glutzange',
        lk: { resourceId: article.id, title: article.title },
      }),
    ) as Item;
    writeBoxField(db, item, 'Preis', '5 gm');
    const written = text(db, item.id);
    expect(written.startsWith('> [!steckbrief]\n')).toBe(true);
    expect(written).toContain('> Preis: 5 gm');
    expect(written.endsWith('Eine alte Zange.')).toBe(true);
    expect(
      Object.values(db.getSnapshot().versions).some((v) => v.text === 'Eine alte Zange.'),
    ).toBe(true);
  });
});

describe('Gestalt je Art', () => {
  it('Person: Steckbrief, dann Besitz und Text; rechts wo sie ist und Haltung', async () => {
    const { db, tovan } = await setup();
    const plan = pagePlan(db.getSnapshot(), tovan, { hasText: false });
    expect(plan.main).toEqual(['box', 'belongings', 'notes', 'secret', 'text']);
    expect(plan.side.slice(0, 2)).toEqual(['whereabouts', 'attitude']);
    expect(plan.add).toEqual(['shop', 'scheme', 'promise']);
  });

  it('Haltung bei Familien immer, bei Orten nur, wenn eine eingetragen ist', async () => {
    const { db, put, stadt } = await setup();
    const family = put(createEntity({ kind: 'family', name: 'Haus Reifschlag' }));
    expect(pagePlan(db.getSnapshot(), family as never, { hasText: false }).side).toContain(
      'attitude',
    );
    expect(pagePlan(db.getSnapshot(), stadt, { hasText: false }).side).not.toContain('attitude');
    db.put('relations', createRelation({ from: stadt.id, to: PARTY_ID, attitude: -2 }));
    expect(pagePlan(db.getSnapshot(), stadt, { hasText: false }).side[0]).toBe('attitude');
  });

  it('ein schlichter Gegenstand zeigt keine leeren Kästen – sie warten unter „Hinzufügen“', async () => {
    const { db, put } = await setup();
    const sword = put(createEntity({ kind: 'item', name: 'Kurzschwert' }) as Item);
    const plan = pagePlan(db.getSnapshot(), sword as Item, { hasText: true });
    expect(plan.main).toEqual(['box', 'text']);
    expect(plan.add).toEqual(['magic', 'recipe', 'book', 'life']);
    // Geöffnet steht er da – an seinem Platz.
    const opened = pagePlan(db.getSnapshot(), sword as Item, {
      hasText: true,
      opened: new Set(['recipe']),
    });
    expect(opened.main).toEqual(['box', 'recipe', 'text']);
    expect(opened.add).toEqual(['magic', 'book', 'life']);
  });

  it('Notizen und Geheimnis neben einem Text nur, wenn schon etwas darin steht', async () => {
    const { db, put } = await setup();
    const topic = put(
      createEntity({
        kind: 'topic',
        name: 'Der lange Winter',
        secret: 'Er kommt wieder.',
      }) as Topic,
    );
    expect(pagePlan(db.getSnapshot(), topic, { hasText: true }).main).toEqual([
      'box',
      'secret',
      'text',
    ]);
  });

  it('Ort: Orte darin und Gegenstände; rechts die Gruppe, wer hier ist', async () => {
    const { db, stadt, schmiede } = await setup();
    const plan = pagePlan(db.getSnapshot(), stadt, { hasText: true });
    expect(plan.main).toEqual(['box', 'places', 'items', 'text']);
    expect(plan.side.slice(0, 3)).toEqual(['party', 'changes', 'cast']);
    expect(plan.add).toEqual(['shop', 'rooms']);
    // Ein Ort ohne Orte darin zeigt keinen leeren Abschnitt „Darin“.
    const leaf = pagePlan(db.getSnapshot(), schmiede, { hasText: true });
    expect(leaf.main).not.toContain('places');
    expect(leaf.add).toContain('place');
  });

  it('der Kopf nennt nicht noch einmal, was rechts oder im Pfad steht', () => {
    expect(
      headFacts([
        { label: 'Familie' },
        { label: 'Rolle' },
        { label: 'Aufenthalt' },
        { label: 'Liegt in' },
      ]).map((f) => f.label),
    ).toEqual(['Familie']);
  });
});

describe('Ein Laden ist ein Laden', () => {
  it('auf dem Ort, der der Laden ist, und beim Händler: der Hauptteil, zuerst', async () => {
    const { db, schmiede, tovan } = await setup();
    db.put('shops', createShop({ placeId: schmiede.id, keeperId: tovan.id, kind: 'Schmiede' }));
    const data = db.getSnapshot();
    expect(pageShops(data, schmiede).lead).toHaveLength(1);
    expect(pagePlan(data, schmiede, { hasText: true }).main[0]).toBe('shop');
    expect(pageShops(data, tovan).lead).toHaveLength(1);
    expect(pagePlan(data, tovan, { hasText: true }).main[0]).toBe('shop');
    expect(pagePlan(data, tovan, { hasText: true }).add).not.toContain('shop');
  });

  it('nie der Hauptteil einer Stadt – dort nur genannt', async () => {
    const { db, put, stadt, schmiede } = await setup();
    db.put('shops', createShop({ placeId: schmiede.id, kind: 'Schmiede' }));
    const direct = db.put('shops', createShop({ placeId: stadt.id, title: 'Krämerei Holm' }));
    const data = db.getSnapshot();
    expect(pageShops(data, stadt)).toEqual({ lead: [], listed: [direct] });
    const plan = pagePlan(data, stadt, { hasText: true });
    expect(plan.main).not.toContain('shop');
    expect(plan.main).toContain('shopsHere');
    expect(plan.add).not.toContain('shop');
    // Ein Ort ohne Orte darin, der seiner Art nach eine Stadt ist, auch nicht.
    const dorf = put(
      createEntity({ kind: 'place', name: 'Weidenau', place: { category: 'Dorf' } }) as Place,
    );
    db.put('shops', createShop({ placeId: dorf.id }));
    expect(pageShops(db.getSnapshot(), dorf).lead).toEqual([]);
  });

  it('„als eigenen Ort anlegen“: ein Platzhalter in der Stadt, der Laden zieht um – mit Rückgängig', async () => {
    const { db, stadt } = await setup();
    const shop = db.put('shops', createShop({ placeId: stadt.id, title: 'Krämerei Holm' }));
    const result = shopToOwnPlace(db, shop.id)!;
    const data = db.getSnapshot();
    const place = data.entities[result.placeId]!;
    expect(place).toMatchObject({ kind: 'place', name: 'Krämerei Holm', stub: true });
    expect(place.kind === 'place' && place.place.parentId).toBe(stadt.id);
    expect(data.shops[shop.id]!.placeId).toBe(place.id);
    result.undo();
    expect(db.getSnapshot().shops[shop.id]!.placeId).toBe(stadt.id);
    expect(db.getSnapshot().entities[result.placeId]).toBeUndefined();
  });

  it('gibt es den Ort schon, wird er genommen – nie ein zweiter', async () => {
    const { db, stadt, schmiede } = await setup();
    const shop = db.put('shops', createShop({ placeId: stadt.id, title: 'Ambosshalle' }));
    const before = Object.keys(db.getSnapshot().entities).length;
    const result = shopToOwnPlace(db, shop.id)!;
    expect(result).toMatchObject({ placeId: schmiede.id, created: false });
    expect(Object.keys(db.getSnapshot().entities)).toHaveLength(before);
  });
});
