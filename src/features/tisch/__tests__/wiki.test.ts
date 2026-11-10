import { describe, expect, it } from 'vitest';
import { elarisCampaign } from '../../../data/seed';
import type { CampaignData, Place } from '../../../domain/schema';
import { lkExportFixture } from '../../wiki/__fixtures__/lkExport';
import { planLkImport } from '../../wiki/apply';
import { convertLkExport } from '../../wiki/lkexport';
import { articleExcerpt, articleOf, placeMaps } from '../wiki';

const world = (): CampaignData =>
  planLkImport(elarisCampaign(), convertLkExport(lkExportFixture())).data;
const place = (data: CampaignData, name: string): Place =>
  Object.values(data.entities).find((e): e is Place => e.kind === 'place' && e.name === name)!;

describe('Wiki am Spieltisch', () => {
  it('findet den Artikel zum Ort', () => {
    const data = world();
    expect(articleOf(data, place(data, 'Hohenfurt'))?.title).toBe('Hohenfurt');
    expect(articleOf(data, { lk: null })).toBeNull();
    expect(articleOf(data, { lk: { resourceId: 'gibtsnicht' } })).toBeNull();
    expect(articleOf(data, null)).toBeNull();
  });

  it('zeigt den Anfang des Artikels ohne Überschriften und Geheimes', () => {
    const data = world();
    const city = articleOf(data, place(data, 'Hohenfurt'))!;
    const excerpt = articleExcerpt(data.articles, city);
    // Der Absatz der unbekannten Blockart steht weiter unten, zählt aber als Text.
    expect(excerpt.paragraphs).toEqual([
      'Hohenfurt liegt an der Brack. Hier herrscht Mira Tannhaus.',
      'Gerettet.',
    ]);
    expect(excerpt.paragraphs.join(' ')).not.toMatch(/bestochen/);
    // Liste, Bild und Geheimes stehen nur im Artikel.
    expect(excerpt.more).toBe(true);

    const inn = articleOf(data, place(data, 'Zum Krummen Aal'))!;
    expect(articleExcerpt(data.articles, inn)).toEqual({
      paragraphs: ['Es riecht nach Teer.'],
      more: false,
    });
  });

  it('kürzt lange Absätze am Satzende', () => {
    const data = world();
    const base = articleOf(data, place(data, 'Zum Krummen Aal'))!;
    const sentence = 'Der Wind steht gut und die Netze sind voll. ';
    const long = {
      ...base,
      docs: [
        {
          ...base.docs[0]!,
          text: `${sentence.repeat(30).trim()}\n\nZweiter Absatz.`,
        },
      ],
    };
    const excerpt = articleExcerpt(data.articles, long, 200);
    expect(excerpt.paragraphs).toHaveLength(1);
    expect(excerpt.paragraphs[0]!.length).toBeLessThanOrEqual(202);
    expect(excerpt.paragraphs[0]).toMatch(/voll\. …$/);
    expect(excerpt.more).toBe(true);
  });

  it('wählt die Karte des Ortes, sonst die der Umgebung mit dem Punkt der Gruppe', () => {
    const data = world();
    const city = place(data, 'Hohenfurt');
    const inn = place(data, 'Zum Krummen Aal');
    const store = place(data, 'Der Speicher');
    const harbour = place(data, 'Hafenviertel');

    const own = placeMaps(data, city);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ own: true, marker: null, of: { id: city.id } });

    // Die Schenke hat keine eigene Karte: die Stadtkarte mit ihrem Punkt.
    const around = placeMaps(data, inn);
    expect(around).toHaveLength(1);
    expect(around[0]).toMatchObject({ own: false, of: { id: city.id } });
    expect(around[0]!.marker?.label).toBe('Krummer Aal');

    expect(placeMaps(data, store)[0]!.marker?.label).toBe('Speicher');
    // Das Hafenviertel selbst hat keinen Punkt: die Karte kommt trotzdem, ohne Markierung.
    expect(placeMaps(data, harbour)[0]).toMatchObject({ own: false, marker: null });
  });

  it('nimmt für einen Ort ohne eigenen Punkt den des Ortes darüber', () => {
    const data = world();
    const store = place(data, 'Der Speicher');
    // Ein Raum im Speicher: auf der Stadtkarte steht nur der Speicher.
    const room: Place = { ...store, id: 'raum', name: 'Dachboden', lk: null };
    const next: CampaignData = {
      ...data,
      entities: {
        ...data.entities,
        raum: { ...room, place: { ...room.place, parentId: store.id } },
      },
    };
    const maps = placeMaps(next, next.entities.raum as Place);
    expect(maps[0]!.marker?.label).toBe('Speicher');
  });
});
