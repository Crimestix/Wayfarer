/** Namen im geschriebenen Text eines Blatts. Erfundene Welt. */
import { describe, expect, it } from 'vitest';
import { emptyCampaign } from '../../data/seed';
import { createEntity, type CampaignData, type Entity } from '../schema';
import { ELARIS_CALENDAR } from '../time/elaris';
import { writtenNames } from '../written';

function world() {
  const entities: Record<string, Entity> = {};
  const add = <E extends Entity>(entity: E): E => {
    entities[entity.id] = entity;
    return entity;
  };
  const w = {
    hohenfurt: add(createEntity({ kind: 'place', name: 'Hohenfurt' })),
    mira: add(createEntity({ kind: 'person', name: 'Mira Tannhaus' })),
    odo: add(createEntity({ kind: 'person', name: 'Odo Tannhaus' })),
    brann: add(createEntity({ kind: 'character', name: 'Brann Eichwald' })),
    schmied: add(createEntity({ kind: 'profession', name: 'Schmied' })),
    data: emptyCampaign('Testwelt', ELARIS_CALENDAR, 0) as CampaignData,
  };
  w.data = { ...w.data, entities };
  return w;
}

const known = (w: ReturnType<typeof world>, texts: string[], attached: string[] = []) =>
  writtenNames(w.data, texts, attached).known.map((entity) => entity.name);

describe('Im Text genannt', () => {
  it('findet Einträge, die genannt, aber noch nicht angeheftet sind – wie sie vorkommen', () => {
    const w = world();
    expect(
      known(w, ['Mira Tannhaus verlangt in Hohenfurt den doppelten Zoll.', 'Brann kennt Mira.']),
    ).toEqual(['Mira Tannhaus', 'Hohenfurt', 'Brann Eichwald']);
  });

  it('lässt weg, was schon dazugehört', () => {
    const w = world();
    expect(known(w, ['Mira Tannhaus wartet in Hohenfurt.'], [w.mira.id])).toEqual(['Hohenfurt']);
  });

  it('zählt mehrdeutige Namen nicht – außer das Blatt macht sie eindeutig', () => {
    const w = world();
    expect(known(w, ['Tannhaus schweigt.'])).toEqual([]);
    // Odo gehört schon dazu: „Tannhaus“ meint ihn, und er ist schon angeheftet.
    expect(known(w, ['Tannhaus schweigt.'], [w.odo.id])).toEqual([]);
  });

  it('nennt nur Leute, Orte, Gruppen und Dinge – keine Begriffe', () => {
    const w = world();
    expect(known(w, ['Der Schmied von Hohenfurt weiß mehr.'])).toEqual(['Hohenfurt']);
  });

  it('zeigt nicht wieder, was der Spielleiter weggeklickt hat', () => {
    const w = world();
    const result = writtenNames(w.data, ['Mira Tannhaus wartet in Hohenfurt.'], [], [w.mira.id]);
    expect(result.known.map((entity) => entity.name)).toEqual(['Hohenfurt']);
  });

  it('sagt zu leerem Text nichts', () => {
    const w = world();
    expect(writtenNames(w.data, ['', '  '], [])).toEqual({ known: [], unknown: [] });
  });
});

describe('Noch unbekannt', () => {
  const unknown = (texts: string[], ignored: string[] = []) =>
    writtenNames(world().data, texts, [], ignored).unknown.map((entry) => entry.name);

  it('findet Eigennamen, die mehrfach dastehen', () => {
    expect(
      unknown(['Die Spur führt nach Graufels.', 'Wer nach Graufels geht, kommt nicht wieder.']),
    ).toEqual(['Graufels']);
    // Endet ein Wort wie ein Hauptwort, braucht es einen Beleg mehr.
    const grotte = ['Die Spur führt nach Salzgrotte.', 'Wer nach Salzgrotte geht, bleibt dort.'];
    expect(unknown(grotte)).toEqual([]);
    expect(unknown([...grotte, 'Auch Mira war in Salzgrotte.'])).toEqual(['Salzgrotte']);
  });

  it('findet Vor- und Nachnamen mitten im Satz schon beim ersten Mal', () => {
    expect(unknown(['An der Furt verlangt Lando Furtner den doppelten Zoll.'])).toEqual([
      'Lando Furtner',
    ]);
  });

  it('findet einen Namen nach „namens“ schon beim ersten Mal', () => {
    expect(unknown(['Ein Fährmann namens Lando setzt nachts über.'])).toEqual(['Lando']);
  });

  it('hält gewöhnliche Hauptwörter nicht für Namen', () => {
    expect(unknown(['Dichter Nebel liegt über der Furt.', 'Der Fährmann verlangt Zoll.'])).toEqual(
      [],
    );
    // Einmal ohne Begleiter genügt nicht.
    expect(unknown(['Die Spur führt nach Graufels.'])).toEqual([]);
  });

  it('kennt keinen Namen als unbekannt, den es in der Welt gibt', () => {
    expect(unknown(['Dann trifft die Gruppe Mira Tannhaus. Später hilft Mira Tannhaus.'])).toEqual(
      [],
    );
  });

  it('zeigt nicht wieder, was der Spielleiter weggeklickt hat', () => {
    const texts = ['An der Furt verlangt Lando Furtner den doppelten Zoll.'];
    const first = writtenNames(world().data, texts, []).unknown;
    expect(first).toHaveLength(1);
    expect(unknown(texts, [first[0]!.key])).toEqual([]);
  });
});
