/** Erkennen, Schritt 1b: Schriftstück, Zwischenzeit, Wandlung, Begleiter, Auftrag, Lieferung. */
import { describe, expect, it } from 'vitest';
import { emptyCampaign } from '../../data/seed';
import { recognizeDelivery, recognizeEntry, recognizedInput, type Recognized } from '../recognize';
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
    hohenfurt: add(createEntity({ kind: 'place', name: 'Hohenfurt' })),
    mira: add(createEntity({ kind: 'person', name: 'Mira Tannhaus' })),
    lando: add(createEntity({ kind: 'person', name: 'Lando Furtner', aliases: ['Der Graue'] })),
    feder: add(
      createEntity({ kind: 'person', name: 'Schwarzfeder', person: { role: 'Begleiter' } }),
    ),
    grauzahn: add(createEntity({ kind: 'person', name: 'Grauzahn' })),
    bande: add(createEntity({ kind: 'faction', name: 'Die Krähenbande' })),
    brann: add(createEntity({ kind: 'character', name: 'Brann Eichwald' })),
    ilka: add(createEntity({ kind: 'character', name: 'Ilka Sturmfels', aliases: ['Leni'] })),
  };
  w.data = { ...w.data, entities };
  return w;
}

const only = (items: Recognized[], kind: Recognized['kind']) =>
  items.filter((item) => item.kind === kind);

describe('Erkennen: Schriftstück', () => {
  it('erkennt einen Brief mit Absender', () => {
    const w = world();
    const [item] = only(
      recognizeEntry(w.data, 'Wir finden einen Brief von Mira Tannhaus im Schreibtisch.'),
      'writing',
    );
    expect(item).toMatchObject({ label: 'Schriftstück: von Mira Tannhaus', refs: [w.mira.id] });
    expect(recognizedInput(item!)).toEqual({ kind: 'writing', refs: [w.mira.id], writing: {} });
  });

  it('erkennt „auf dem Zettel stand“ und bleibt ohne Absender offen', () => {
    const w = world();
    expect(
      only(recognizeEntry(w.data, 'Auf dem Zettel stand: Kommt allein.'), 'writing')[0]?.refs,
    ).toEqual([]);
    expect(only(recognizeEntry(w.data, 'Ein Brief kam nicht an.'), 'writing')).toEqual([]);
  });
});

describe('Erkennen: Zwischenzeit', () => {
  it('liest „sechs Wochen Zwischenzeit“ als 42 Tage', () => {
    const w = world();
    const [item] = only(recognizeEntry(w.data, 'Sechs Wochen Zwischenzeit.'), 'downtime');
    expect(item?.payload.downtime).toEqual({ days: 42 });
    expect(recognizedInput(item!)).toMatchObject({ kind: 'downtime', downtime: { days: 42 } });
  });

  it('liest „3 Tage vergehen“, aber nicht „in 3 Tagen“', () => {
    const w = world();
    expect(
      only(recognizeEntry(w.data, 'Drei Tage vergehen in Hohenfurt.'), 'downtime')[0]?.payload,
    ).toEqual({ downtime: { days: 3 } });
    expect(only(recognizeEntry(w.data, 'In 3 Tagen ist es fertig.'), 'downtime')).toEqual([]);
  });

  it('lässt Monate offen', () => {
    const w = world();
    expect(
      only(recognizeEntry(w.data, 'Zwei Monate später geht es weiter.'), 'downtime')[0]?.payload,
    ).toEqual({ downtime: { days: null } });
  });
});

describe('Erkennen: Wandlung', () => {
  it('erkennt einen verlorenen Arm bei einem Gefährten', () => {
    const w = world();
    const [item] = only(
      recognizeEntry(w.data, 'Brann Eichwald verliert seinen linken Arm.'),
      'transformation',
    );
    expect(item?.payload.transformation).toEqual({ characterId: w.brann.id });
  });

  it('schlägt bei Personen der Welt keine Wandlung vor', () => {
    const w = world();
    expect(
      only(recognizeEntry(w.data, 'Mira Tannhaus verwandelt sich in eine Eule.'), 'transformation'),
    ).toEqual([]);
  });
});

describe('Erkennen: Begleiter', () => {
  it('erkennt ein Wesen mit der Rolle „Begleiter“, das sich anschließt', () => {
    const w = world();
    const [item] = only(
      recognizeEntry(w.data, 'Schwarzfeder schließt sich der Gruppe an.'),
      'companion',
    );
    expect(item?.payload.companion).toEqual({ entityId: w.feder.id, joined: true, ownerId: null });
  });

  it('nimmt den Namen nach dem Tierwort und den Gefährten als Halter', () => {
    const w = world();
    const [item] = only(
      recognizeEntry(w.data, 'Brann Eichwald zähmt den Wolf Grauzahn.'),
      'companion',
    );
    expect(item?.payload.companion).toEqual({
      entityId: w.grauzahn.id,
      joined: true,
      ownerId: w.brann.id,
    });
  });

  it('erkennt das Gehen und lässt Personen ohne Tierwort aus', () => {
    const w = world();
    expect(
      only(recognizeEntry(w.data, 'Schwarzfeder verlässt die Gruppe.'), 'companion')[0]?.payload
        .companion?.joined,
    ).toBe(false);
    expect(
      only(recognizeEntry(w.data, 'Mira Tannhaus schließt sich uns an.'), 'companion'),
    ).toEqual([]);
  });
});

describe('Erkennen: Auftrag', () => {
  it('erkennt einen Auftrag mit Auftraggeber statt einer Abmachung', () => {
    const w = world();
    const items = recognizeEntry(w.data, 'Mira Tannhaus beauftragt uns, den Wolf zu jagen.');
    const jobs = only(items, 'promise');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      label: 'Auftrag: Mira Tannhaus',
      payload: { promise: { sort: 'job' } },
      refs: [w.mira.id],
    });
    expect(recognizedInput(jobs[0]!)).toMatchObject({ promise: { sort: 'job' } });
  });

  it('eine Schuld bleibt eine Abmachung', () => {
    const w = world();
    const [item] = only(recognizeEntry(w.data, 'Wir schulden Mira Tannhaus 50 Gold.'), 'promise');
    expect(item?.payload.promise).toBeUndefined();
  });
});

describe('Erkennen: Schicksal und zweite Namen', () => {
  it('findet Einträge auch über ihre zweiten Namen', () => {
    const w = world();
    expect(
      only(recognizeEntry(w.data, 'Der Graue ist tot.'), 'fate')[0]?.payload.fate?.entityId,
    ).toBe(w.lando.id);
    expect(only(recognizeEntry(w.data, 'Leni ist tot.'), 'fate')[0]?.payload.fate?.entityId).toBe(
      w.ilka.id,
    );
  });
});

describe('Lieferung als Termin', () => {
  it('liest Tage, Wochen, morgen und übermorgen', () => {
    expect(recognizeDelivery('Das Schwert ist in 3 Tagen fertig.')).toMatchObject({
      days: 3,
      sentence: 'Das Schwert ist in 3 Tagen fertig.',
    });
    expect(recognizeDelivery('Die Lieferung kommt in einer Woche.')?.days).toBe(7);
    expect(recognizeDelivery('Wir rasten. Die Rüstung ist übermorgen repariert.')?.days).toBe(2);
  });

  it('braucht beides: eine Frist und ein Wort des Lieferns', () => {
    expect(recognizeDelivery('In 3 Tagen ist Vollmond.')).toBeNull();
    expect(recognizeDelivery('Die Lieferung ist angekommen.')).toBeNull();
    expect(recognizeDelivery('Ist das Schwert in 3 Tagen fertig?')).toBeNull();
  });
});
