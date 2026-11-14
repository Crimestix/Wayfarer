/** Auswählen und Anlegen: die Zeilen der Auswahl und was die Eingabetaste tut. Erfundene Welt. */
import { describe, expect, it } from 'vitest';
import { emptyCampaign } from '../../data/seed';
import {
  CREATE_KINDS,
  createKinds,
  enterAction,
  mentionMark,
  moveMark,
  pickRows,
  type PickRow,
} from '../pick';
import { ENTITY_KINDS, createEntity, type CampaignData, type Entity } from '../schema';
import { ELARIS_CALENDAR } from '../time/elaris';

function world() {
  const entities: Record<string, Entity> = {};
  const add = <E extends Entity>(entity: E): E => {
    entities[entity.id] = entity;
    return entity;
  };
  const w = {
    hohenfurt: add(createEntity({ kind: 'place', name: 'Hohenfurt' })),
    grotte: add(createEntity({ kind: 'place', name: 'Salzgrotte' })),
    mira: add(
      createEntity({ kind: 'person', name: 'Mira Tannhaus', tagline: 'Fährfrau aus Hohenfurt' }),
    ),
    odo: add(createEntity({ kind: 'person', name: 'Odo Tannhaus', aliases: ['Der Lange'] })),
    furtner: add(createEntity({ kind: 'family', name: 'Furtner' })),
    data: emptyCampaign('Testwelt', ELARIS_CALENDAR, 0) as CampaignData,
  };
  w.data = { ...w.data, entities };
  return w;
}

const names = (rows: PickRow[]) =>
  rows.map((row) =>
    row.type === 'entity'
      ? `${row.entity.name}${row.foreign ? '*' : ''}`
      : row.type === 'create'
        ? `+${row.kind}`
        : row.type === 'taken'
          ? `!${row.entity.name}`
          : row.type,
  );

describe('Arten zum Anlegen', () => {
  it('bietet jede Art der Welt an – nur Gefährten entstehen woanders', () => {
    expect([...CREATE_KINDS].sort()).toEqual(
      ENTITY_KINDS.filter((kind) => kind !== 'character').sort(),
    );
  });

  it('nennt zuerst die Arten des Feldes, dann alle übrigen', () => {
    const { first, more } = createKinds(['faction', 'person', 'family']);
    expect(first).toEqual(['person', 'faction', 'family']);
    expect(more).toContain('place');
    expect([...first, ...more]).toHaveLength(CREATE_KINDS.length);
    // Ohne eigene Arten: die üblichen zuerst.
    expect(createKinds().first).toEqual(['person', 'place', 'faction', 'family']);
  });
});

describe('Zeilen der Auswahl', () => {
  it('zeigt ohne Suchwort die Einträge der Arten und die Gruppe, wenn sie wählbar ist', () => {
    const w = world();
    expect(names(pickRows(w.data, { query: '', kinds: ['place'], allowParty: true }))).toEqual([
      'party',
      'Hohenfurt',
      'Salzgrotte',
    ]);
  });

  it('bietet ohne genauen Treffer „neu als …“ an: erst die Arten des Feldes, dann „andere Art“', () => {
    const w = world();
    const rows = pickRows(w.data, { query: 'Lando', kinds: ['person', 'faction'], create: true });
    expect(names(rows)).toEqual(['+person', '+faction', 'more']);
    const open = pickRows(w.data, {
      query: 'Lando',
      kinds: ['person', 'faction'],
      create: true,
      moreOpen: true,
    });
    expect(names(open).slice(0, 4)).toEqual(['+person', '+faction', 'more', '+place']);
    expect(open.filter((row) => row.type === 'create')).toHaveLength(CREATE_KINDS.length);
  });

  it('legt nie einen zweiten Eintrag für einen Namen an – auch nicht für einen Zweitnamen', () => {
    const w = world();
    expect(names(pickRows(w.data, { query: 'mira tannhaus', create: true }))).toEqual([
      'Mira Tannhaus',
    ]);
    expect(names(pickRows(w.data, { query: 'der lange', create: true }))).toEqual(['Odo Tannhaus']);
  });

  it('zeigt, wer genau so heißt, auch wenn das Feld seine Art sonst nicht anbietet', () => {
    const w = world();
    // Ein Feld für Personen und Fraktionen: Die Familie Furtner steht trotzdem zur Wahl.
    expect(
      names(pickRows(w.data, { query: 'Furtner', kinds: ['person', 'faction'], create: true })),
    ).toEqual(['Furtner*']);
    // Verträgt das Feld nur seine Arten, steht sie als Hinweis da – nicht zur Wahl.
    expect(
      names(
        pickRows(w.data, { query: 'Furtner', kinds: ['place'], create: true, onlyKinds: true }),
      ),
    ).toEqual(['!Furtner']);
    // Ohne Anlegen bleibt das Feld bei seinen Arten.
    expect(names(pickRows(w.data, { query: 'Furtner', kinds: ['place'] }))).toEqual([]);
  });

  it('lässt weg, was schon gewählt ist, und bietet es nicht neu an', () => {
    const w = world();
    const rows = pickRows(w.data, { query: 'Hohenfurt', create: true, exclude: [w.hohenfurt.id] });
    // Mira passt über ihre Kurzbeschreibung; Hohenfurt selbst steht schon da.
    expect(names(rows)).toEqual(['Mira Tannhaus']);
  });

  it('kennt den alten Weg: eine Zeile „neu anlegen“, solange kein Treffer genau so heißt', () => {
    const w = world();
    expect(names(pickRows(w.data, { query: 'Tann', kinds: ['person'], legacy: true }))).toEqual([
      'Mira Tannhaus',
      'Odo Tannhaus',
      'legacy',
    ]);
    expect(names(pickRows(w.data, { query: 'Salzgrotte', legacy: true }))).toEqual(['Salzgrotte']);
  });
});

describe('Eingabetaste in der Auswahl', () => {
  it('nimmt den einen Eintrag, der genau so heißt', () => {
    const w = world();
    const rows = pickRows(w.data, { query: 'salzgrotte', create: true });
    expect(enterAction(rows, null, 'salzgrotte')).toEqual({ type: 'pick', id: w.grotte.id });
    const alias = pickRows(w.data, { query: 'Der Lange' });
    expect(enterAction(alias, null, 'Der Lange')).toEqual({ type: 'pick', id: w.odo.id });
  });

  it('nimmt nie einen, der nur ähnlich heißt oder nur über die Kurzbeschreibung passt', () => {
    const w = world();
    // „Tann“ trifft Mira und Odo nur ähnlich.
    const similar = pickRows(w.data, { query: 'Tann', kinds: ['person'] });
    expect(similar.length).toBe(2);
    expect(enterAction(similar, null, 'Tann')).toEqual({ type: 'none' });
    // „Fährfrau“ steht nur in Miras Kurzbeschreibung.
    const tagline = pickRows(w.data, { query: 'Fährfrau' });
    expect(names(tagline)).toEqual(['Mira Tannhaus']);
    expect(enterAction(tagline, null, 'Fährfrau')).toEqual({ type: 'none' });
  });

  it('öffnet ohne genauen Treffer das Anlegen mit der ersten Art des Feldes', () => {
    const w = world();
    const rows = pickRows(w.data, { query: 'Tann', kinds: ['faction', 'person'], create: true });
    expect(enterAction(rows, null, 'Tann')).toEqual({ type: 'create', kind: 'person' });
    const place = pickRows(w.data, { query: 'Burg Graufels', kinds: ['place'], create: true });
    expect(enterAction(place, null, 'Burg Graufels')).toEqual({ type: 'create', kind: 'place' });
  });

  it('nimmt die mit den Pfeiltasten markierte Zeile – auch eine ähnliche', () => {
    const w = world();
    const rows = pickRows(w.data, { query: 'Tann', kinds: ['person'], create: true });
    const first = moveMark(rows, null, 1);
    expect(first).toBe(0);
    expect(enterAction(rows, first, 'Tann')).toEqual({ type: 'pick', id: w.mira.id });
    const last = moveMark(rows, null, -1);
    expect(enterAction(rows, last, 'Tann')).toEqual({ type: 'more' });
    // Rundherum: nach der letzten kommt wieder die erste.
    expect(moveMark(rows, last, 1)).toBe(0);
  });

  it('tut ohne Suchwort und ohne Markierung nichts', () => {
    const w = world();
    const rows = pickRows(w.data, { query: '', create: true, allowParty: true });
    expect(enterAction(rows, null, '')).toEqual({ type: 'none' });
    expect(enterAction(rows, 0, '')).toEqual({ type: 'party' });
  });

  it('legt auf dem alten Weg nur an, wenn sonst nichts zur Wahl steht', () => {
    const w = world();
    const none = pickRows(w.data, { query: 'Graufels', legacy: true });
    expect(enterAction(none, null, 'Graufels')).toEqual({ type: 'legacy' });
    const similar = pickRows(w.data, { query: 'Tann', legacy: true });
    expect(enterAction(similar, null, 'Tann')).toEqual({ type: 'none' });
  });

  it('überspringt beim Markieren Zeilen, die nur ein Hinweis sind', () => {
    const w = world();
    const rows = pickRows(w.data, {
      query: 'Furtner',
      kinds: ['place'],
      create: true,
      onlyKinds: true,
    });
    expect(moveMark(rows, null, 1)).toBeNull();
    expect(enterAction(rows, null, 'Furtner')).toEqual({ type: 'none' });
  });
});

describe('„@“ im Text', () => {
  it('markiert den ersten Treffer von selbst, „neu als …“ aber nie', () => {
    const w = world();
    const hits = pickRows(w.data, { query: 'Mir', create: true });
    expect(mentionMark(hits, null)).toBe(0);
    const fresh = pickRows(w.data, { query: 'Lando', create: true });
    expect(fresh[0]?.type).toBe('create');
    expect(mentionMark(fresh, null)).toBeNull();
    // Mit den Pfeiltasten markiert, bleibt die Zeile markiert.
    expect(mentionMark(fresh, 1)).toBe(1);
  });
});
