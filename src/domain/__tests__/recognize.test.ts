import { describe, expect, it } from 'vitest';
import { emptyCampaign } from '../../data/seed';
import { recognizeEntry, recognizedInput, type Recognized } from '../recognize';
import { PARTY_ID, createEntity, type CampaignData, type Entity } from '../schema';
import { ELARIS_CALENDAR, ELARIS_START } from '../time/elaris';

/** Eine erfundene Welt: Hohenfurt, die Salzgrotte, Mira Tannhaus, Lando Furtner, Krummzahn … */
function world() {
  const entities: Record<string, Entity> = {};
  const add = <E extends Entity>(entity: E): E => {
    entities[entity.id] = entity;
    return entity;
  };
  const w = {
    data: emptyCampaign('Testwelt', ELARIS_CALENDAR, ELARIS_START) as CampaignData,
    hohenfurt: add(createEntity({ kind: 'place', name: 'Hohenfurt' })),
    grotte: add(createEntity({ kind: 'place', name: 'Salzgrotte' })),
    mira: add(createEntity({ kind: 'person', name: 'Mira Tannhaus' })),
    lando: add(createEntity({ kind: 'person', name: 'Lando Furtner' })),
    krummzahn: add(createEntity({ kind: 'person', name: 'Krummzahn' })),
    bande: add(createEntity({ kind: 'faction', name: 'Die Krähenbande' })),
    schleicher: add(createEntity({ kind: 'species', name: 'Grubenschleicher' })),
    brann: add(createEntity({ kind: 'character', name: 'Brann Eichwald' })),
    ilka: add(createEntity({ kind: 'character', name: 'Ilka Sturmfels' })),
  };
  w.data = { ...w.data, entities };
  return w;
}

const kinds = (items: Recognized[]) => items.map((item) => item.kind);
const only = (items: Recognized[], kind: Recognized['kind']) =>
  items.filter((item) => item.kind === kind);

describe('Erkennen: Schicksal', () => {
  it('erkennt „ist tot“ und nennt die Person', () => {
    const w = world();
    const [fate, ...rest] = recognizeEntry(w.data, 'Krummzahn ist tot.');
    expect(rest).toEqual([]);
    expect(fate).toMatchObject({
      kind: 'fate',
      label: 'Schicksal: Krummzahn → tot',
      payload: { fate: { entityId: w.krummzahn.id, status: 'dead' } },
      refs: [w.krummzahn.id],
    });
    expect('Krummzahn ist tot.'.slice(fate!.from, fate!.to)).toBe('tot');
  });

  it('nimmt im Passiv den Betroffenen, nicht den Täter', () => {
    const w = world();
    const fates = only(
      recognizeEntry(w.data, 'Krummzahn wurde von Lando Furtner getötet.'),
      'fate',
    );
    expect(fates.map((f) => f.payload.fate?.entityId)).toEqual([w.krummzahn.id]);
  });

  it('bei „hat … erschlagen“ stirbt, wer nach „hat“ steht – bei „ihn“ rät Wayfarer nicht', () => {
    const w = world();
    const fatesOf = (text: string) =>
      only(recognizeEntry(w.data, text), 'fate').map((f) => f.payload.fate?.entityId);
    expect(fatesOf('Lando Furtner hat Krummzahn erschlagen.')).toEqual([w.krummzahn.id]);
    expect(fatesOf('Lando hat ihn erschlagen.')).toEqual([]);
    expect(
      fatesOf('Krummzahn ist im Kampf am Anleger gefallen, Lando Furtner hat ihn erschlagen.'),
    ).toEqual([w.krummzahn.id]);
    // „Gefallen“ ohne Kampf ist kein Tod.
    expect(fatesOf('Krummzahn ist in den Fluss gefallen.')).toEqual([]);
  });

  it('nimmt bei „tötete“ den, der danach steht', () => {
    const w = world();
    const fates = only(recognizeEntry(w.data, 'Lando Furtner tötete Krummzahn.'), 'fate');
    expect(fates.map((f) => f.payload.fate?.entityId)).toEqual([w.krummzahn.id]);
  });

  it('erkennt verschwunden, gestorben und wieder aufgetaucht', () => {
    const w = world();
    expect(
      only(recognizeEntry(w.data, 'Lando Furtner ist verschwunden.'), 'fate')[0]?.payload.fate,
    ).toEqual({ entityId: w.lando.id, status: 'missing' });
    expect(
      only(recognizeEntry(w.data, 'Am Morgen starb Mira Tannhaus.'), 'fate')[0]?.payload.fate,
    ).toEqual({ entityId: w.mira.id, status: 'dead' });
    expect(
      only(recognizeEntry(w.data, 'Lando ist wieder aufgetaucht.'), 'fate')[0]?.payload.fate,
    ).toEqual({ entityId: w.lando.id, status: 'alive' });
  });

  it('lässt Verneinung und „fast“ aus', () => {
    const w = world();
    expect(only(recognizeEntry(w.data, 'Krummzahn ist nicht tot.'), 'fate')).toEqual([]);
    expect(only(recognizeEntry(w.data, 'Krummzahn ist fast tot.'), 'fate')).toEqual([]);
  });

  it('rät nie: ein unbekannter Name bleibt offen', () => {
    const w = world();
    const [fate] = recognizeEntry(w.data, 'Gorbag ist tot.');
    expect(fate).toMatchObject({
      kind: 'fate',
      label: 'Schicksal: tot',
      payload: { fate: { entityId: null, status: 'dead' } },
      refs: [],
    });
    expect(recognizedInput(fate!)).toBeNull();
  });

  it('rät nie: ein mehrdeutiger Vorname bleibt offen – außer er ist schon gewählt', () => {
    const w = world();
    const kessel = createEntity({ kind: 'person', name: 'Mira Kessel' });
    w.data = { ...w.data, entities: { ...w.data.entities, [kessel.id]: kessel } };
    expect(
      only(recognizeEntry(w.data, 'Mira ist tot.'), 'fate')[0]?.payload.fate?.entityId,
    ).toBeNull();
    expect(
      only(recognizeEntry(w.data, 'Mira ist tot.', { refs: [w.mira.id] }), 'fate')[0]?.payload.fate
        ?.entityId,
    ).toBe(w.mira.id);
    // Der ganze Name ist eindeutig.
    expect(
      only(recognizeEntry(w.data, 'Mira Kessel ist tot.'), 'fate')[0]?.payload.fate?.entityId,
    ).toBe(kessel.id);
  });

  it('schlägt für Gefährten kein Schicksal vor', () => {
    const w = world();
    expect(only(recognizeEntry(w.data, 'Brann Eichwald ist tot.'), 'fate')).toEqual([]);
  });

  it('bleibt im eigenen Satz', () => {
    const w = world();
    const fates = only(recognizeEntry(w.data, 'Krummzahn lacht. Lando ist tot.'), 'fate');
    expect(fates.map((f) => f.payload.fate?.entityId)).toEqual([w.lando.id]);
  });
});

describe('Erkennen: mehrere Vorschläge je Satz', () => {
  it('erkennt Gerücht mit Quelle und das Schicksal darin', () => {
    const w = world();
    const items = recognizeEntry(w.data, 'Mira Tannhaus sagt, dass Krummzahn verschwunden ist.');
    expect(kinds(items)).toEqual(['rumor', 'fate']);
    expect(items[0]).toMatchObject({
      label: 'Gerücht: von Mira Tannhaus',
      payload: { rumor: { sourceId: w.mira.id } },
    });
    expect(items[1]!.payload.fate).toEqual({ entityId: w.krummzahn.id, status: 'missing' });
  });

  it('erkennt „laut X“ als Quelle und „angeblich“ ohne Quelle', () => {
    const w = world();
    expect(
      only(recognizeEntry(w.data, 'Laut Lando Furtner liegt Gold in der Salzgrotte.'), 'rumor')[0]
        ?.payload.rumor,
    ).toEqual({ sourceId: w.lando.id });
    expect(
      only(recognizeEntry(w.data, 'Angeblich liegt Gold in der Salzgrotte.'), 'rumor')[0]?.payload
        .rumor,
    ).toEqual({ sourceId: null });
  });
});

describe('Erkennen: Orte und Wege', () => {
  it('die Gruppe zieht weiter: Ortswechsel', () => {
    const w = world();
    const [travel] = recognizeEntry(w.data, 'Die Gruppe zieht nach Hohenfurt.');
    expect(travel).toMatchObject({
      kind: 'travel',
      label: 'Ortswechsel: → Hohenfurt',
      payload: { travel: { toId: w.hohenfurt.id } },
    });
    expect(kinds(recognizeEntry(w.data, 'Ankunft in Hohenfurt.'))).toEqual(['travel']);
  });

  it('eine Person zieht weiter: Aufenthalt', () => {
    const w = world();
    expect(recognizeEntry(w.data, 'Lando Furtner zieht nach Hohenfurt.')).toMatchObject([
      {
        kind: 'whereabouts',
        label: 'Aufenthalt: Lando Furtner → Hohenfurt',
        payload: { whereabouts: { entityId: w.lando.id, placeId: w.hohenfurt.id } },
      },
    ]);
    expect(
      only(recognizeEntry(w.data, 'Mira Tannhaus ist jetzt in der Salzgrotte.'), 'whereabouts'),
    ).toHaveLength(1);
  });

  it('ohne Ort kein Aufenthalt', () => {
    const w = world();
    expect(recognizeEntry(w.data, 'Lando Furtner ist nach dem Streit gegangen.')).toEqual([]);
  });

  it('erkennt Entdeckungen nur mit Ort; Gefundenes ohne Ort bleibt Beute', () => {
    const w = world();
    expect(recognizeEntry(w.data, 'Wir entdeckten die Salzgrotte.')).toMatchObject([
      { kind: 'discovery', label: 'Entdeckung: Salzgrotte', payload: { placeId: w.grotte.id } },
    ]);
    expect(only(recognizeEntry(w.data, 'Brann hat ein Schwert gefunden.'), 'discovery')).toEqual(
      [],
    );
    expect(kinds(recognizeEntry(w.data, 'Wir haben einen Hinweis gefunden.'))).toEqual(['clue']);
  });
});

describe('Erkennen: am Tisch', () => {
  it('Begegnung mit den Personen des Satzes', () => {
    const w = world();
    expect(recognizeEntry(w.data, 'Wir haben Mira Tannhaus kennengelernt.')).toMatchObject([
      { kind: 'meeting', label: 'Begegnung: Mira Tannhaus', refs: [w.mira.id] },
    ]);
  });

  it('Kampf mit Ausgang', () => {
    const w = world();
    expect(
      recognizeEntry(w.data, 'Wir kämpften gegen die Krähenbande und sind geflohen.'),
    ).toMatchObject([
      {
        kind: 'fight',
        label: 'Kampf: Die Krähenbande · geflohen',
        payload: { fight: { outcome: 'fled' } },
        refs: [w.bande.id],
      },
    ]);
    expect(
      only(recognizeEntry(w.data, 'Die Gruppe hat den Grubenschleicher besiegt.'), 'fight'),
    ).toMatchObject([{ payload: { fight: { outcome: 'won' } }, refs: [w.schleicher.id] }]);
    expect(
      only(recognizeEntry(w.data, 'Die Krähenbande hat uns besiegt.'), 'fight')[0]?.payload.fight,
    ).toEqual({ outcome: 'lost' });
  });

  it('„Krummzahn ist geflohen“ allein ist kein Kampf', () => {
    const w = world();
    expect(only(recognizeEntry(w.data, 'Krummzahn ist geflohen.'), 'fight')).toEqual([]);
  });

  it('Rast: lang über Nacht, sonst kurz', () => {
    const w = world();
    expect(recognizeEntry(w.data, 'Wir rasten über Nacht.')).toMatchObject([
      { kind: 'rest', label: 'Lange Rast', payload: { rest: { long: true } } },
    ]);
    expect(recognizeEntry(w.data, 'Kurze Rast am Fluss.')).toMatchObject([
      { kind: 'rest', payload: { rest: { long: false } } },
    ]);
  });

  it('Zitat mit dem, der es sagte', () => {
    const w = world();
    expect(
      only(recognizeEntry(w.data, '„Ihr kommt hier nicht lebend raus“, sagte Krummzahn.'), 'quote'),
    ).toMatchObject([{ label: 'Zitat: Krummzahn', refs: [w.krummzahn.id] }]);
  });

  it('Entscheidung der Gruppe', () => {
    const w = world();
    expect(kinds(recognizeEntry(w.data, 'Wir entscheiden uns, die Salzgrotte zu meiden.'))).toEqual(
      ['decision'],
    );
  });
});

describe('Erkennen: zwischen Leuten', () => {
  it('Abmachung mit den Beteiligten, ohne den Ort', () => {
    const w = world();
    expect(
      recognizeEntry(w.data, 'Lando Furtner versprach, uns in Hohenfurt zu helfen.'),
    ).toMatchObject([{ kind: 'promise', label: 'Abmachung: Lando Furtner', refs: [w.lando.id] }]);
  });

  it('Haltung nur als Vorschlag ohne Wert', () => {
    const w = world();
    expect(recognizeEntry(w.data, 'Krummzahn hasst uns.')).toMatchObject([
      {
        kind: 'attitude',
        label: 'Haltung: Krummzahn gegenüber der Gruppe',
        payload: { attitude: { fromId: w.krummzahn.id, toId: PARTY_ID, value: null } },
      },
    ]);
    expect(
      only(recognizeEntry(w.data, 'Lando ist wütend auf Mira Tannhaus.'), 'attitude')[0]?.payload
        .attitude,
    ).toEqual({ fromId: w.lando.id, toId: w.mira.id, value: null });
  });

  it('Wer was weiß', () => {
    const w = world();
    expect(
      only(recognizeEntry(w.data, 'Mira Tannhaus erfährt, dass Lando lügt.'), 'knowledge'),
    ).toMatchObject([{ label: 'Wer was weiß: Mira Tannhaus', refs: [w.mira.id] }]);
  });
});

describe('Erkennen: die Gruppe', () => {
  it('Meilenstein mit Stufe', () => {
    const w = world();
    expect(recognizeEntry(w.data, 'Brann Eichwald erreicht Stufe 5.')).toMatchObject([
      {
        kind: 'milestone',
        label: 'Meilenstein: Brann Eichwald → Stufe 5',
        payload: { milestone: { characterId: w.brann.id, level: 5 } },
      },
    ]);
  });

  it('steigt die Gruppe auf, je Gefährte ein Vorschlag', () => {
    const w = world();
    const items = only(recognizeEntry(w.data, 'Die Gruppe steigt auf Stufe 4 auf.'), 'milestone');
    expect(items.map((item) => item.payload.milestone?.characterId).sort()).toEqual(
      [w.brann.id, w.ilka.id].sort(),
    );
    expect(items.every((item) => item.payload.milestone?.level === 4)).toBe(true);
  });

  it('Spielerwunsch nur bei Gefährten', () => {
    const w = world();
    expect(
      only(recognizeEntry(w.data, 'Ilka will das Schwert ihres Vaters finden.'), 'wish'),
    ).toMatchObject([{ label: 'Spielerwunsch: Ilka Sturmfels', refs: [w.ilka.id] }]);
    expect(only(recognizeEntry(w.data, 'Krummzahn will Rache.'), 'wish')).toEqual([]);
  });

  it('Zustand und sein Ende', () => {
    const w = world();
    expect(recognizeEntry(w.data, 'Brann wurde vergiftet.')).toMatchObject([
      {
        kind: 'condition',
        label: 'Zustand: Brann Eichwald – vergiftet',
        payload: { condition: { entityId: w.brann.id, ended: false } },
      },
    ]);
    expect(
      only(recognizeEntry(w.data, 'Brann ist wieder gesund.'), 'condition')[0]?.payload.condition,
    ).toEqual({ entityId: w.brann.id, ended: true });
  });
});

describe('Erkennen: Grenzen', () => {
  it('liefert für leeren und gewöhnlichen Text nichts', () => {
    const w = world();
    expect(recognizeEntry(w.data, '')).toEqual([]);
    expect(recognizeEntry(w.data, 'Das Wetter ist schön.')).toEqual([]);
  });

  it('macht aus einem vollständigen Vorschlag die Eingabe zum Festhalten', () => {
    const w = world();
    const [fate] = recognizeEntry(w.data, 'Krummzahn ist tot.');
    expect(recognizedInput(fate!)).toEqual({
      kind: 'fate',
      refs: [w.krummzahn.id],
      fate: { entityId: w.krummzahn.id, status: 'dead' },
    });
  });
});

describe('Erkennen: Notizen, wie sie am Tisch entstehen', () => {
  /** Die Welt von oben, Krummzahn mit Spitznamen. */
  function table() {
    const w = world();
    const krummzahn = { ...w.krummzahn, aliases: ['Krummi'] };
    w.data = { ...w.data, entities: { ...w.data.entities, [krummzahn.id]: krummzahn } };
    return w;
  }
  const labels = (text: string) => recognizeEntry(table().data, text).map((item) => item.label);

  const CASES: [string, string[]][] = [
    // Fragen halten nichts fest.
    ['Ist Krummzahn tot?', []],
    ['Krummzahn tot?!', []],
    ['Wer hat Mira getötet?', []],
    ['Ist Lando wirklich nach Hohenfurt gezogen?', []],
    // Verneinung davor und danach.
    ['Krummzahn starb nicht.', []],
    ['Lando tötete Krummzahn nicht.', []],
    ['Lando hat Mira nicht getötet.', []],
    ['Krummzahn ist doch nicht tot, er lebt noch.', ['Schicksal: Krummzahn → lebt']],
    // Verneint heißt manchmal: tot.
    ['Krummzahn hat den Kampf nicht überlebt.', ['Schicksal: Krummzahn → tot']],
    ['Mira ist nicht mehr am Leben.', ['Schicksal: Mira Tannhaus → tot']],
    ['Lando lebt nicht mehr.', ['Schicksal: Lando Furtner → tot']],
    ['Mira lebt!', ['Schicksal: Mira Tannhaus → lebt']],
    // Nur gedacht oder gewollt.
    ['Wenn Krummzahn tot ist, zahlt Lando.', []],
    ['Wir wissen nicht, ob Lando tot ist.', []],
    ['Brann möchte Krummzahn tot sehen.', ['Spielerwunsch: Brann Eichwald']],
    ['Brann will nach Hohenfurt.', ['Spielerwunsch: Brann Eichwald']],
    // Spitznamen, Nachnamen, Tippfehler, Besitz.
    ['Krummi ist tot.', ['Schicksal: Krummzahn → tot']],
    ['Furtner ist tot.', ['Schicksal: Lando Furtner → tot']],
    ['Krumzahn ist tot.', ['Schicksal: tot']],
    ['Miras Bruder ist tot.', ['Schicksal: tot']],
    ['Lando wurde totgeschlagen.', ['Schicksal: Lando Furtner → tot']],
    ['Krummzahn stirbt.', ['Schicksal: Krummzahn → tot']],
    ['Wir töteten zwei Grubenschleicher.', []],
    // Mehrere Dinge in einem Satz.
    [
      'Lando und Mira sind tot.',
      ['Schicksal: Lando Furtner → tot', 'Schicksal: Mira Tannhaus → tot'],
    ],
    [
      'Mira Tannhaus ist schwer verletzt, Lando tot.',
      ['Zustand: Mira Tannhaus – schwer verletzt', 'Schicksal: Lando Furtner → tot'],
    ],
    [
      'Ilka ist bewusstlos, Brann vergiftet.',
      ['Zustand: Ilka Sturmfels – bewusstlos', 'Zustand: Brann Eichwald – vergiftet'],
    ],
    [
      'Brann und Ilka sind vergiftet.',
      ['Zustand: Brann Eichwald – vergiftet', 'Zustand: Ilka Sturmfels – vergiftet'],
    ],
    [
      'Krummzahn erschlug Lando und floh in die Salzgrotte.',
      ['Schicksal: Lando Furtner → tot', 'Aufenthalt: Krummzahn → Salzgrotte'],
    ],
    [
      'Krummzahn ist tot, Lando verschwunden und wir sind nach Hohenfurt gezogen.',
      [
        'Schicksal: Krummzahn → tot',
        'Schicksal: Lando Furtner → verschollen',
        'Ortswechsel: → Hohenfurt',
      ],
    ],
    ['Zurück nach Hohenfurt, dort lange Rast.', ['Ortswechsel: → Hohenfurt', 'Lange Rast']],
    // Zustände.
    ['Ilka ist nicht mehr vergiftet.', ['Zustand aufgehoben: Ilka Sturmfels']],
    ['Wir haben Lando befreit.', ['Zustand aufgehoben: Lando Furtner']],
    ['Brann wird von Krummzahn verflucht.', ['Zustand: Brann Eichwald – verflucht']],
    // Unterwegs.
    ['Wir sind in Hohenfurt angekommen.', ['Ortswechsel: → Hohenfurt']],
    ['Gestern sind wir nach Hohenfurt gereist.', ['Ortswechsel: → Hohenfurt']],
    ['Wir reisen weiter nach Hohenfurt.', ['Ortswechsel: → Hohenfurt']],
    ['Am 3. Tag erreichten wir Hohenfurt.', ['Ortswechsel: → Hohenfurt']],
    ['Wir haben Hohenfurt erreicht.', ['Ortswechsel: → Hohenfurt']],
    ['Der Weg nach Hohenfurt ist verschneit.', []],
    ['Die Krähenbande zieht nach Hohenfurt.', []],
    ['Wir beschließen, nach Hohenfurt zu gehen.', ['Entscheidung']],
    ['Lando ist in Hohenfurt.', ['Aufenthalt: Lando Furtner → Hohenfurt']],
    [
      'Lando ging nach dem Streit, Mira blieb in Hohenfurt.',
      ['Aufenthalt: Mira Tannhaus → Hohenfurt'],
    ],
    ['Lando kehrt nach Hohenfurt zurück.', ['Aufenthalt: Lando Furtner → Hohenfurt']],
    // Getroffen ist nicht immer begegnet; gekämpft nicht immer von der Gruppe.
    ['Brann wurde von einem Pfeil getroffen.', []],
    ['Der Pfeil trifft Brann.', []],
    ['Wir trafen eine Entscheidung.', ['Entscheidung']],
    ['Wir trafen auf Grubenschleicher und kämpften.', ['Kampf: Grubenschleicher']],
    [
      'Wir trafen Lando und zogen nach Hohenfurt.',
      ['Begegnung: Lando Furtner', 'Ortswechsel: → Hohenfurt'],
    ],
    ['Die Krähenbande hat Hohenfurt angegriffen.', []],
    ['Krummzahn kämpfte gegen Lando.', ['Kampf: Krummzahn, Lando Furtner']],
    ['Krummzahn griff Hohenfurt an.', []],
    ['Lando hat gegen Krummzahn gekämpft.', ['Kampf: Lando Furtner, Krummzahn']],
    ['Krummzahn hat den Kampf überlebt.', ['Schicksal: Krummzahn → lebt']],
    [
      'Die Krähenbande hat uns überfallen, wir sind in die Salzgrotte geflohen.',
      ['Kampf: Die Krähenbande · geflohen', 'Ortswechsel: → Salzgrotte'],
    ],
    ['Krummzahn hat uns angegriffen, wir haben gewonnen.', ['Kampf: Krummzahn · gewonnen']],
    // Wörter mit zweitem Sinn.
    ['Es war laut in der Taverne.', []],
    ['Lando ist sehr erfahren.', []],
    ['Lando erfährt nichts.', []],
    ['Wir finden keine Spur.', []],
    ['Wir steigen auf die Pferde.', []],
    ['Brann wirkt einen Zauber der Stufe 3.', []],
    ['Lando übernachtet in Hohenfurt.', []],
    ['Wir entdeckten, dass Lando lügt.', ['Wer was weiß']],
    // Zitate bleiben ganz, auch mit „!“ oder „?“ darin.
    ['„Ihr kommt hier nicht lebend raus!“, sagte Krummzahn.', ['Zitat: Krummzahn']],
    ['„Seid ihr verrückt?“, fragte Mira.', ['Zitat: Mira Tannhaus']],
    ['Mira fragt: „Ist Krummzahn tot?“', ['Zitat: Mira Tannhaus']],
  ];

  it.each(CASES)('„%s“', (text, expected) => {
    expect(labels(text)).toEqual(expected);
  });

  it('nimmt die Ids, nicht nur die Namen', () => {
    const w = table();
    const items = recognizeEntry(w.data, 'Krummi erschlug Lando und floh in die Salzgrotte.');
    expect(only(items, 'fate')[0]?.payload.fate).toEqual({ entityId: w.lando.id, status: 'dead' });
    expect(only(items, 'whereabouts')[0]?.payload.whereabouts).toEqual({
      entityId: w.krummzahn.id,
      placeId: w.grotte.id,
    });
  });

  it('ein Titel ist kein Name: „der Hauptmann“ ist nicht Hauptmann Krell', () => {
    const w = table();
    const krell = createEntity({ kind: 'person', name: 'Hauptmann Krell' });
    w.data = { ...w.data, entities: { ...w.data.entities, [krell.id]: krell } };
    expect(
      only(recognizeEntry(w.data, 'Der Hauptmann der Wache ist tot.'), 'fate')[0]?.payload.fate
        ?.entityId,
    ).toBeNull();
    expect(only(recognizeEntry(w.data, 'Krell ist tot.'), 'fate')[0]?.payload.fate?.entityId).toBe(
      krell.id,
    );
    expect(
      only(recognizeEntry(w.data, 'Hauptmann Krell ist tot.'), 'fate')[0]?.payload.fate?.entityId,
    ).toBe(krell.id);
  });

  it('steigen alle auf, je Gefährte ein Vorschlag', () => {
    const w = table();
    const items = only(recognizeEntry(w.data, 'Alle steigen auf Stufe 3.'), 'milestone');
    expect(items.map((item) => item.payload.milestone?.characterId).sort()).toEqual(
      [w.brann.id, w.ilka.id].sort(),
    );
  });

  it('ein Ortswechsel zeigt auf den Ort im Text', () => {
    const w = table();
    const text = 'Wir reisen weiter nach Hohenfurt.';
    const [travel] = recognizeEntry(w.data, text);
    expect(text.slice(travel!.from, travel!.to)).toBe('Hohenfurt');
  });
});
