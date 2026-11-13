import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { detailLinks, replaceLink } from '../derive';
import {
  commonPlace,
  habitatKeysOf,
  monthsOfChoice,
  natureAt,
  natureHere,
  natureOnHex,
  rarityFromText,
  readPrice,
  readSeasons,
  seasonNow,
  seasonOfMonth,
} from '../nature';
import { createEntity, type Entity, type NatureEntity } from '../schema';
import { ELARIS_CALENDAR } from '../time/elaris';

/** Eine erfundene Gegend: die Nordmark mit dem Dunkelwald und Hohenfurt darin, dazu ein Sumpf. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string, category: string, parentId: string | null = null) =>
    db.put(
      'entities',
      createEntity({ kind: 'place', name, place: { parentId, category } } as never),
    );
  const mark = place('Nordmark', 'Region');
  const forest = place('Dunkelwald', 'Wald', mark.id);
  const town = place('Hohenfurt', 'Dorf', forest.id);
  const swamp = place('Krummzahn', 'Sumpf');
  const grotto = place('Salzgrotte', 'Höhle', forest.id);
  const nature = (
    kind: 'plant' | 'animal' | 'mineral',
    name: string,
    details: Partial<{ habitat: string[]; regionIds: string[]; seasons: string[] }>,
  ) => db.put('entities', createEntity({ kind, name, [kind]: details } as never)) as NatureEntity;
  return { db, mark, forest, town, swamp, grotto, nature, data: () => db.getSnapshot() };
}

const names = (hits: { entity: Entity }[]) => hits.map((hit) => hit.entity.name);

describe('Jahreszeiten', () => {
  it('teilt das Jahr um den wärmsten Monat', () => {
    // Elaris: Hochbrand (4) ist der wärmste Monat.
    expect([3, 4, 5].map((m) => seasonOfMonth(m, 12, 4))).toEqual(['summer', 'summer', 'summer']);
    expect([6, 8].map((m) => seasonOfMonth(m, 12, 4))).toEqual(['autumn', 'autumn']);
    expect([9, 11].map((m) => seasonOfMonth(m, 12, 4))).toEqual(['winter', 'winter']);
    expect([0, 2].map((m) => seasonOfMonth(m, 12, 4))).toEqual(['spring', 'spring']);
  });

  it('liest Jahreszeiten, Monate und Spannen aus dem Kalender', () => {
    const read = (...words: string[]) => readSeasons(ELARIS_CALENDAR, 4, words);
    expect([...read('Herbst').months!].sort()).toEqual([6, 7, 8]);
    expect([...read('Blüthain bis Erntfall').months!].sort()).toEqual([2, 3, 4, 5]);
    expect([...read('Eisbruch–Tauwind').months!].sort((a, b) => a - b)).toEqual([0, 9, 10, 11]);
    expect([...read('Nebelruh', 'Frühjahr').months!].sort((a, b) => a - b)).toEqual([0, 1, 2, 7]);
    expect(read('ganzjährig').months).toBeNull();
    expect(read().months).toBeNull();
    // Was Wayfarer nicht lesen kann, schränkt nichts ein – und wird genannt.
    expect(read('bei Vollmond')).toEqual({ months: null, unread: ['bei Vollmond'] });
  });

  it('wählt eine Jahreszeit oder einen Monat für eine Sicht', () => {
    expect([...monthsOfChoice(ELARIS_CALENDAR, 4, 's:winter')!]).toEqual([9, 10, 11]);
    expect([...monthsOfChoice(ELARIS_CALENDAR, 4, 'm:7')!]).toEqual([7]);
    expect(monthsOfChoice(ELARIS_CALENDAR, 4, '')).toBeNull();
  });
});

describe('Lebensräume und Seltenheit', () => {
  it('erkennt die üblichen Wörter, auch zusammengesetzt und in der Mehrzahl', () => {
    expect(habitatKeysOf('Bergwald')).toEqual(['wald', 'gebirge']);
    expect(habitatKeysOf('Wälder')).toEqual(['wald']);
    expect(habitatKeysOf('Sümpfe')).toEqual(['sumpf']);
    expect(habitatKeysOf('Unter der Erde')).toEqual(['unten']);
    expect(habitatKeysOf('Höhlen')).toEqual(['hoehle']);
    // Kurze Wörter zählen nur ganz: die Eisenhütte ist kein Eis.
    expect(habitatKeysOf('Eisenhütte')).toEqual([]);
    expect(habitatKeysOf('Eis')).toEqual(['eis']);
  });

  it('liest die Seltenheit', () => {
    expect(rarityFromText('sehr selten')).toBe('very-rare');
    expect(rarityFromText('Selten (nur nachts)')).toBe('rare');
    expect(rarityFromText('häufig')).toBe('common');
    expect(rarityFromText('Ungewöhnlich')).toBe('uncommon');
    expect(rarityFromText('legendär')).toBe('legendary');
    expect(rarityFromText('weiß niemand')).toBeNull();
  });
});

describe('Was hier wächst und lebt', () => {
  it('findet, was in der Gegend vorkommt oder zum Lebensraum passt', async () => {
    const { town, swamp, mark, nature, data } = await setup();
    nature('plant', 'Mondkraut', { habitat: ['Wald'] });
    nature('plant', 'Sumpfwurz', { habitat: ['Sumpf'] });
    nature('animal', 'Nebelfalter', { regionIds: [mark.id], habitat: ['Sumpf'] });
    nature('plant', 'Ohne Angaben', {});

    const here = natureHere(data(), town.id);
    // Die Gegend zuerst, dann der Lebensraum.
    expect(names(here)).toEqual(['Nebelfalter', 'Mondkraut']);
    expect(here[0]!.reasons.map((r) => r.text)).toEqual(['lebt in Nordmark']);
    expect(here[1]!.reasons.map((r) => r.text)).toEqual(['passt zum Lebensraum Wald']);

    // Im Sumpf außerhalb der Nordmark: die Sumpfwurz, aber nicht der Falter – er hat Gegenden.
    expect(names(natureHere(data(), swamp.id))).toEqual(['Sumpfwurz']);
    expect(natureHere(data(), null)).toEqual([]);
  });

  it('richtet sich nach der Jahreszeit', async () => {
    const { db, town, nature, data } = await setup();
    nature('plant', 'Herbstling', { habitat: ['Wald'], seasons: ['Herbst'] });
    nature('plant', 'Lenzblatt', { habitat: ['Wald'], seasons: ['Tauwind', 'Grünbruch'] });
    // Der Grundstand beginnt im Tauwind: Frühling.
    expect(seasonNow(data(), town.id).season).toBe('spring');
    const now = natureHere(data(), town.id);
    expect(names(now)).toEqual(['Lenzblatt']);
    expect(now[0]!.seasonal).toBe('Tauwind, Grünbruch');
    // Ein halbes Jahr später.
    db.setState({ now: data().state.now + 200 * 24 * 60 });
    expect(seasonNow(data(), town.id).season).toBe('autumn');
    expect(names(natureHere(data(), town.id))).toEqual(['Herbstling']);
  });

  it('unter der Erde zählt die Höhle, nicht der Wald darüber', async () => {
    const { grotto, town, nature, data } = await setup();
    nature('plant', 'Mondkraut', { habitat: ['Wald'] });
    nature('mineral', 'Salzkristall', { habitat: ['Höhle'] });
    nature('plant', 'Grottenmoos', { habitat: ['Unter der Erde'] });
    expect(names(natureHere(data(), grotto.id))).toEqual(['Grottenmoos', 'Salzkristall']);
    expect(names(natureHere(data(), town.id))).toEqual(['Mondkraut']);
  });

  it('findet eigene Wörter des Spielleiters im Namen des Ortes wieder', async () => {
    const { db, nature, data } = await setup();
    const reed = db.put(
      'entities',
      createEntity({ kind: 'place', name: 'Am Schilfgürtel' } as never),
    );
    nature('plant', 'Rohrkolben', { habitat: ['Schilfgürtel'] });
    expect(names(natureHere(data(), reed.id))).toEqual(['Rohrkolben']);
  });

  it('nimmt auf einem Feld der Hexkarte dessen Gelände', async () => {
    const { mark, town, swamp, nature, data } = await setup();
    nature('plant', 'Sumpfwurz', { habitat: ['Sumpf'] });
    nature('animal', 'Nebelfalter', { regionIds: [mark.id] });
    expect(names(natureAt(data(), { placeId: null, habitats: ['sumpf'] }))).toEqual(['Sumpfwurz']);
    // Zwischen Hohenfurt und der Nordmark liegt die Nordmark: Der Falter lebt dort.
    expect(commonPlace(data(), town.id, mark.id)).toBe(mark.id);
    expect(commonPlace(data(), town.id, swamp.id)).toBeNull();
    expect(
      names(natureAt(data(), { placeId: mark.id, habitats: ['sumpf'], placeHabitats: false })),
    ).toEqual(['Nebelfalter', 'Sumpfwurz']);
  });
});

describe('Auf der Hexkarte', () => {
  it('nimmt Gelände und Fluss des Feldes, als Gegend den Ort darauf oder über Start und Ziel', async () => {
    const { mark, forest, town, swamp, nature, data } = await setup();
    nature('plant', 'Sumpfwurz', { habitat: ['Sumpf'] });
    nature('plant', 'Uferried', { habitat: ['Fluss'] });
    nature('animal', 'Nebelfalter', { regionIds: [mark.id] });
    nature('plant', 'Mondkraut', { habitat: ['Wald'] });
    const area = { fromId: town.id, toId: forest.id, biome: null };
    const field = { terrain: 'swamp' as const, river: '', placeId: null };
    // Zwischen Hohenfurt und dem Dunkelwald: der Dunkelwald, und der liegt in der Nordmark.
    expect(names(natureOnHex(data(), area, field))).toEqual(['Nebelfalter', 'Sumpfwurz']);
    expect(names(natureOnHex(data(), area, { ...field, river: 'Furt' }))).toEqual([
      'Nebelfalter',
      'Sumpfwurz',
      'Uferried',
    ]);
    // Liegt ein Ort auf dem Feld, zählt auch er: Hohenfurt liegt im Dunkelwald.
    expect(names(natureOnHex(data(), area, { ...field, placeId: town.id }))).toEqual([
      'Nebelfalter',
      'Mondkraut',
      'Sumpfwurz',
    ]);
    expect(
      names(natureOnHex(data(), { fromId: swamp.id, toId: null, biome: null }, field)),
    ).toEqual(['Sumpfwurz']);
  });

  it('auch in der eigenen Gegend muss ein bekannter Lebensraum zum Gelände passen', async () => {
    const { mark, forest, town, nature, data } = await setup();
    nature('plant', 'Moorlilie', { regionIds: [mark.id], habitat: ['Sumpf'] });
    nature('plant', 'Nebelgras', { regionIds: [mark.id], habitat: ['Nebelschleier'] });
    nature('animal', 'Nebelfalter', { regionIds: [mark.id] });
    const area = { fromId: town.id, toId: forest.id, biome: null };
    const mountain = { terrain: 'mountains' as const, river: '', placeId: null };
    // Auf dem Bergfeld keine Sumpfblume; wer keinen bekannten Lebensraum hat, bleibt.
    expect(names(natureOnHex(data(), area, mountain))).toEqual(['Nebelgras', 'Nebelfalter']);
    expect(names(natureOnHex(data(), area, { ...mountain, terrain: 'swamp' }))).toEqual([
      'Moorlilie',
      'Nebelgras',
      'Nebelfalter',
    ]);
    // Ohne bekanntes Gelände entscheidet die Gegend allein.
    expect(names(natureOnHex(data(), area, { ...mountain, terrain: null }))).toEqual([
      'Moorlilie',
      'Nebelgras',
      'Nebelfalter',
    ]);
    // Am Ort selbst (am Spieltisch) bleibt die Gegend genug: Lebensräume eines Ortes sind gelesen.
    expect(names(natureHere(data(), town.id))).toContain('Moorlilie');
  });
});

describe('Preis', () => {
  it('liest Gold, Silber und Kupfer', () => {
    expect(readPrice('')).toBeNull();
    expect(readPrice('12')).toBe(12);
    expect(readPrice('2,5 GM')).toBe(2.5);
    expect(readPrice('5 Silber je Bund')).toBe(0.5);
    expect(readPrice('3 KM')).toBe(0.03);
    expect(readPrice('1 Platin')).toBe(10);
    expect(readPrice('teuer')).toBeUndefined();
    expect(readPrice('5 Äpfel')).toBeUndefined();
  });
});

describe('Gegenden als Verweise', () => {
  it('zählt jede Gegend und lässt eine gelöschte heraus', async () => {
    const { mark, swamp, nature } = await setup();
    const moth = nature('animal', 'Nebelfalter', { regionIds: [mark.id, swamp.id] });
    expect(detailLinks(moth)).toEqual([
      { field: 'regionIds', id: mark.id },
      { field: 'regionIds', id: swamp.id },
    ]);
    const without = replaceLink(moth, mark.id, null) as NatureEntity;
    expect(without.kind === 'animal' && without.animal.regionIds).toEqual([swamp.id]);
    const moved = replaceLink(moth, mark.id, swamp.id) as NatureEntity;
    expect(moved.kind === 'animal' && moved.animal.regionIds).toEqual([swamp.id]);
  });
});
