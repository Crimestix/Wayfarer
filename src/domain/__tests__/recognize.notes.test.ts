/**
 * Erkennen in erzählten Notizen: Vorstellen und Begrüßen als Begegnung, „im Auftrag von“,
 * Einigung als Abmachung, erfolgreiche Kämpfe, „entschloss sich“, Verneinung im Teilsatz.
 * Erfundene Welt.
 */
import { describe, expect, it } from 'vitest';
import { emptyCampaign } from '../../data/seed';
import { recognizeEntry, type Recognized } from '../recognize';
import { createEntity, type CampaignData, type Entity } from '../schema';
import { ELARIS_CALENDAR, ELARIS_START } from '../time/elaris';

function world() {
  const entities: Record<string, Entity> = {};
  const add = <E extends Entity>(entity: E): E => {
    entities[entity.id] = entity;
    return entity;
  };
  const w = {
    data: emptyCampaign('Testwelt', ELARIS_CALENDAR, ELARIS_START) as CampaignData,
    odo: add(createEntity({ kind: 'person', name: 'Odo Kessler' })),
    hagen: add(createEntity({ kind: 'person', name: 'Hagen Brack' })),
    brann: add(createEntity({ kind: 'character', name: 'Brann Eichwald' })),
  };
  w.data = { ...w.data, entities };
  return w;
}

const kinds = (text: string) => {
  const w = world();
  return { w, items: recognizeEntry(w.data, text) };
};
const only = (items: Recognized[], kind: Recognized['kind']) =>
  items.filter((item) => item.kind === kind);

describe('Begegnung', () => {
  it('„hat sich uns vorgestellt“ und „begrüßte“', () => {
    const a = kinds('Odo Kessler hat sich uns vorgestellt.');
    expect(only(a.items, 'meeting')[0]?.refs).toEqual([a.w.odo.id]);
    const b = kinds('Am Tor begrüßte Hagen Brack die Gruppe.');
    expect(only(b.items, 'meeting')[0]?.refs).toEqual([b.w.hagen.id]);
  });

  it('nicht „stellte sich als Wido vor“ – das ist ein Deckname', () => {
    expect(only(kinds('Brann stellte sich als Wido vor.').items, 'meeting')).toEqual([]);
  });
});

describe('Auftrag und Abmachung', () => {
  it('„im Auftrag von X“ ist kein Auftrag an die Gruppe', () => {
    expect(
      only(kinds('Sie gaben sich als Boten im Auftrag von Odo Kessler aus.').items, 'promise'),
    ).toEqual([]);
    expect(
      only(kinds('Odo Kessler gab der Gruppe den Auftrag, die Grotte zu räumen.').items, 'promise'),
    ).toHaveLength(1);
  });

  it('„einigten sich darauf“ ist eine Abmachung', () => {
    const { w, items } = kinds(
      'Nach langem Feilschen einigte sich Brann mit Odo Kessler auf zehn Silber.',
    );
    expect(only(items, 'promise')[0]?.refs).toEqual([w.brann.id, w.odo.id]);
  });
});

describe('Kampf und Entscheidung', () => {
  it('ein erfolgreicher Kampf ist gewonnen, ein erfolgloser nicht', () => {
    const won = only(kinds('Der Kampf am Steg verlief erfolgreich.').items, 'fight');
    expect(won[0]?.payload.fight?.outcome).toBe('won');
    const open = only(kinds('Der Kampf am Steg verlief erfolglos.').items, 'fight');
    expect(open[0]?.payload.fight?.outcome).toBe('open');
  });

  it('tötet die Gruppe den Gegner, ist der Kampf gewonnen', () => {
    const items = only(
      kinds('Im Kampf am Tor konnte die Gruppe den Hauptmann töten.').items,
      'fight',
    );
    expect(items[0]?.payload.fight?.outcome).toBe('won');
  });

  it('„entschloss sich“ ist eine Entscheidung', () => {
    expect(
      only(kinds('Die Gruppe entschloss sich, dem Bach zu folgen.').items, 'decision'),
    ).toHaveLength(1);
  });

  it('„keine Gelegenheit zur Flucht“ ist verneint – „nicht tot, er lebt“ nicht', () => {
    expect(
      only(kinds('Für die Wachen gab es keine Gelegenheit zur Flucht.').items, 'fight'),
    ).toEqual([]);
    const alive = only(kinds('Hagen Brack ist doch nicht tot, er lebt noch.').items, 'fate');
    expect(alive.map((i) => i.payload.fate?.status)).toEqual(['alive']);
  });
});
