import { describe, expect, it } from 'vitest';
import { articleParts } from '../../domain/articleText';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity, createRelation, type Entity } from '../../domain/schema';
import {
  addScaffoldFields,
  createArticleOfKind,
  dismissHint,
  savePageText,
  setFactScaffold,
  syncFacts,
} from './actions';
import { addBlankFactLines, setFactLine, steckbriefLabels } from './factLines';
import { articleFacts, factField } from './facts';
import { splitPage } from './model';
import {
  DEFAULT_SCAFFOLDS,
  SCAFFOLD_HINT,
  articleScaffoldGap,
  SCAFFOLD_KINDS,
  isOwnScaffold,
  missingScaffold,
  readScaffoldInput,
  readsAs,
  scaffoldOf,
  scaffoldText,
  withScaffold,
} from './scaffold';
import { isPersonArticle } from './text';

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const data = () => db.getSnapshot();
  const add = <E extends Entity>(entity: E): E => db.put('entities', entity) as E;
  const textOf = (articleId: string) => data().articles[articleId]!.docs[0]!.text;
  return { db, data, add, textOf };
}

describe('Steckbrief-Gerüst: Vorgaben', () => {
  it('hat für jede Art Felder; die meisten liest Wayfarer auch', () => {
    for (const kind of SCAFFOLD_KINDS) expect(DEFAULT_SCAFFOLDS[kind].length).toBeGreaterThan(0);
    expect(DEFAULT_SCAFFOLDS.person.map((label) => readsAs('person', label))).toEqual([
      'species',
      'born',
      'origin',
      'home',
      'profession',
      'membership',
      'membership',
    ]);
    expect(readsAs('place', 'Liegt in')).toBe('location');
    expect(readsAs('place', 'Herrscher')).toBe('leader');
    expect(readsAs('faction', 'Anführer')).toBe('leader');
    expect(readsAs('plant', 'Gegend')).toBe('region');
    expect(readsAs('profession', 'Werkzeug')).toBe('tool');
    // Felder nur zum Schreiben: Wayfarer wertet sie nicht aus.
    expect(readsAs('place', 'Einwohner')).toBeNull();
    expect(readsAs('faction', 'Ziele')).toBeNull();
  });

  it('nimmt das Gerüst des Spielleiters, sonst die Vorgabe; eigene Felder sind erlaubt', () => {
    const campaign = elarisCampaign().campaign;
    expect(scaffoldOf(campaign, 'place')).toEqual([...DEFAULT_SCAFFOLDS.place]);
    expect(scaffoldOf(campaign, 'character')).toEqual([]);
    const own = { factScaffolds: withScaffold({}, 'place', ['Art', 'Wappen', 'Liegt in:', 'art']) };
    expect(scaffoldOf(own, 'place')).toEqual(['Art', 'Wappen', 'Liegt in']);
    expect(isOwnScaffold(own, 'place')).toBe(true);
    // Ein leeres Gerüst heißt: diese Art bekommt keins.
    expect(scaffoldOf({ factScaffolds: withScaffold({}, 'item', []) }, 'item')).toEqual([]);
    // Zurück auf die Vorgabe: Der eigene Stand fällt weg.
    expect(withScaffold(own.factScaffolds, 'place', [...DEFAULT_SCAFFOLDS.place])).toEqual({});
    expect(withScaffold(own.factScaffolds, 'place', null)).toEqual({});
    expect(readScaffoldInput('Art\n\n Wappen ,Liegt in; Wappen')).toEqual([
      'Art',
      'Wappen',
      'Liegt in',
    ]);
  });

  it('schreibt den Kasten mit leeren Feldern – ohne Inhalt', () => {
    expect(scaffoldText(['Volk', 'Geboren'])).toBe('> [!steckbrief]\n> Volk: \n> Geboren: \n\n');
    expect(scaffoldText([])).toBe('');
  });
});

describe('Steckbrief-Gerüst: was fehlt', () => {
  it('nennt Felder, die weder leer noch ausgefüllt dastehen', () => {
    const scaffold = DEFAULT_SCAFFOLDS.person;
    expect(missingScaffold('person', ['Volk', 'Wohnort', 'Familie'], scaffold)).toEqual([
      'Geboren',
      'Herkunft',
      'Beruf',
      'Fraktion',
    ]);
  });

  it('erkennt andere Bezeichnungen für dasselbe Feld', () => {
    const scaffold = DEFAULT_SCAFFOLDS.person;
    // „Spezies“ statt „Volk“, „Alter“ statt „Geboren“ – das Feld ist da.
    const missing = missingScaffold('person', ['Spezies', 'Alter'], scaffold);
    expect(missing).not.toContain('Volk');
    expect(missing).not.toContain('Geboren');
    // „Familie“ und „Fraktion“ lesen beide die Zugehörigkeit: Da zählt nur die gleiche Bezeichnung.
    expect(missingScaffold('person', ['Gilde'], scaffold)).toContain('Fraktion');
    expect(missingScaffold('person', ['Gilde'], scaffold)).toContain('Familie');
  });
});

describe('Leere Felder im Steckbrief', () => {
  const text = [
    '> [!steckbrief]',
    '> Volk: Mensch',
    '> Geboren: ',
    '> Wohnort:',
    '',
    'Mira Tannhaus führt die Fähre bei Hohenfurt.',
  ].join('\n');

  it('stehen als Bezeichnung bereit, werden aber nicht gelesen und nicht gezeigt', async () => {
    const { db, data } = await setup();
    const result = createArticleOfKind(db, {
      title: 'Mira Tannhaus',
      kind: null,
      scaffold: false,
    })!;
    savePageText(db, result.article.id, result.article.docs[0]!.id, text);
    const article = data().articles[result.article.id]!;
    expect(steckbriefLabels(text)).toEqual(['Volk', 'Geboren', 'Wohnort']);
    expect(articleFacts(data().articles, article).map((f) => f.label)).toEqual(['Volk']);
    // In Büchern und für die Spieler: nur ausgefüllte Felder.
    const parts = articleParts(text);
    expect(parts.facts).toEqual([{ label: 'Volk', value: 'Mensch' }]);
    expect(parts.box).toBe('');
    // Nur leere Felder: kein leerer Kasten neben dem Text.
    savePageText(
      db,
      article.id,
      article.docs[0]!.id,
      '> [!steckbrief]\n> Volk: \n> Geboren: \n\nText',
    );
    const empty = data().articles[article.id]!;
    expect(splitPage(data().articles, empty, empty.docs[0]).side).toEqual([]);
    expect(isPersonArticle(empty)).toBe(false);
  });

  it('löschen nie einen Wert der Welt', async () => {
    const { db, data, add } = await setup();
    const hohenfurt = add(createEntity({ kind: 'place', name: 'Hohenfurt' }));
    const guild = add(createEntity({ kind: 'faction', name: 'Fährleute' }));
    const created = createArticleOfKind(db, {
      title: 'Odo Tannhaus',
      kind: 'person',
      scaffold: false,
    })!;
    const odo = created.entity!;
    const doc = created.article.docs[0]!.id;
    savePageText(
      db,
      created.article.id,
      doc,
      '> [!steckbrief]\n> Wohnort: [[Hohenfurt]]\n> Fraktion: Fährleute\n',
    );
    syncFacts(db, [created.article.id]);
    const filled = data().entities[odo.id]!;
    expect(filled.kind === 'person' && filled.person.homeId).toBe(hohenfurt.id);
    expect(
      Object.values(data().relations).some((r) => r.from === odo.id && r.to === guild.id),
    ).toBe(true);
    // Von Hand eingetragene Werte und das Gerüst daneben: Leere Felder ändern nichts.
    db.put('entities', { ...filled, born: { at: 1000, precision: 'year' } });
    db.put('relations', createRelation({ from: odo.id, to: hohenfurt.id, type: 'member' }));
    addScaffoldFields(db, created.article.id, DEFAULT_SCAFFOLDS.person);
    const sync = syncFacts(db, [created.article.id]);
    expect(sync.changed).toEqual([]);
    const after = data().entities[odo.id]!;
    expect(after.born).toEqual({ at: 1000, precision: 'year' });
    expect(after.kind === 'person' && after.person.homeId).toBe(hohenfurt.id);
    expect(Object.values(data().relations)).toHaveLength(2);
  });

  it('zählen Familie und Fraktion beide als Zugehörigkeit', async () => {
    const { db, data, add } = await setup();
    const house = add(createEntity({ kind: 'family', name: 'Haus Eichwald' }));
    const guild = add(createEntity({ kind: 'faction', name: 'Salzgilde' }));
    const created = createArticleOfKind(db, {
      title: 'Brann Eichwald',
      kind: 'person',
      scaffold: false,
    })!;
    savePageText(
      db,
      created.article.id,
      created.article.docs[0]!.id,
      '> [!steckbrief]\n> Familie: Haus Eichwald\n> Fraktion: Salzgilde\n',
    );
    syncFacts(db, [created.article.id]);
    const targets = Object.values(data().relations)
      .filter((r) => r.from === created.entity!.id && r.type === 'member')
      .map((r) => r.to)
      .sort();
    expect(targets).toEqual([house.id, guild.id].sort());
  });

  it('füllt Wayfarer selbst aus, statt eine zweite Zeile zu schreiben', () => {
    const edit = setFactLine(
      '> [!steckbrief]\n> Volk: \n> Wohnort: \n',
      'person',
      'home',
      'Hohenfurt',
    );
    expect(edit.text).toBe('> [!steckbrief]\n> Volk: \n> Wohnort: Hohenfurt\n');
    // Ein neues Feld kommt zu den anderen Feldern, auch wenn sie noch leer sind.
    const more = setFactLine('> [!steckbrief]\n> Volk: \n> Wohnort: \n', 'person', 'status', 'tot');
    expect(more.text).toBe('> [!steckbrief]\n> Volk: \n> Wohnort: \n> Zustand: tot\n');
    expect(factField('person', 'Zustand')).toBe('status');
  });
});

describe('Leere Felder einfügen', () => {
  it('hängt sie an die Felder an, ohne Doppeltes, und lässt den Text stehen', () => {
    const text = '> [!steckbrief]\n> ![](bild.png)\n>\n> Volk: Zwerg\n\nBrann schmiedet.';
    expect(addBlankFactLines(text, ['Volk', 'Geboren', 'Wohnort'])).toBe(
      '> [!steckbrief]\n> ![](bild.png)\n>\n> Volk: Zwerg\n> Geboren: \n> Wohnort: \n\nBrann schmiedet.',
    );
    expect(addBlankFactLines(text, ['volk'])).toBe(text);
  });

  it('legt einen Steckbrief oben an, wenn es keinen gibt', () => {
    expect(addBlankFactLines('Ein Dorf am Fluss.', ['Art', 'Liegt in'])).toBe(
      '> [!steckbrief]\n> Art: \n> Liegt in: \n\nEin Dorf am Fluss.',
    );
    expect(addBlankFactLines('', ['Art'])).toBe('> [!steckbrief]\n> Art: \n');
  });

  it('nimmt das Einfügen zurück, solange niemand weiterschrieb', async () => {
    const { db, textOf } = await setup();
    const created = createArticleOfKind(db, { title: 'Salzgrotte', kind: null, scaffold: false })!;
    savePageText(db, created.article.id, created.article.docs[0]!.id, 'Tief unter dem Hang.');
    const undo = addScaffoldFields(db, created.article.id, ['Art', 'Liegt in'])!;
    expect(textOf(created.article.id)).toBe(
      '> [!steckbrief]\n> Art: \n> Liegt in: \n\nTief unter dem Hang.',
    );
    undo();
    expect(textOf(created.article.id)).toBe('Tief unter dem Hang.');
    expect(addScaffoldFields(db, 'gibt-es-nicht', ['Art'])).toBeNull();
  });
});

describe('Artikel einer Art anlegen', () => {
  it('setzt das Gerüst der Art und nimmt den Artikel in die Welt auf', async () => {
    const { db, data, textOf } = await setup();
    const result = createArticleOfKind(db, {
      title: 'Burg Graufels',
      kind: 'place',
      scaffold: true,
    })!;
    expect(textOf(result.article.id)).toBe(scaffoldText(DEFAULT_SCAFFOLDS.place));
    expect(result.entity?.kind).toBe('place');
    expect(result.entity?.lk?.resourceId).toBe(result.article.id);
    // Abgewählt: ein leerer Artikel, trotzdem in der Welt.
    const plain = createArticleOfKind(db, {
      title: 'Ilka Sturmfels',
      kind: 'person',
      scaffold: false,
    })!;
    expect(textOf(plain.article.id)).toBe('');
    expect(plain.entity?.kind).toBe('person');
    // Ohne Art: nur ein Artikel.
    const free = createArticleOfKind(db, { title: 'Notizen', kind: null, scaffold: true })!;
    expect(free.entity).toBeNull();
    expect(Object.values(data().entities).filter((e) => e.name === 'Notizen')).toEqual([]);
  });

  it('nimmt das Gerüst des Spielleiters', async () => {
    const { db, data, textOf } = await setup();
    setFactScaffold(db, 'place', ['Wappen', 'Liegt in']);
    expect(data().campaign.factScaffolds).toEqual({ place: ['Wappen', 'Liegt in'] });
    const result = createArticleOfKind(db, { title: 'Hohenfurt', kind: 'place', scaffold: true })!;
    expect(textOf(result.article.id)).toBe('> [!steckbrief]\n> Wappen: \n> Liegt in: \n\n');
    setFactScaffold(db, 'place', null);
    expect(data().campaign.factScaffolds).toEqual({});
  });

  it('verbindet einen Eintrag gleichen Namens, statt einen zweiten anzulegen', async () => {
    const { db, data, add } = await setup();
    const lando = add(createEntity({ kind: 'person', name: 'Lando Furtner' }));
    const result = createArticleOfKind(db, {
      title: 'Lando Furtner',
      kind: 'person',
      scaffold: true,
    })!;
    expect(result.entity?.id).toBe(lando.id);
    expect(Object.values(data().entities).filter((e) => e.name === 'Lando Furtner')).toHaveLength(
      1,
    );
  });

  it('wird der Artikel des genannten Eintrags, auch wenn der Name nicht eindeutig ist', async () => {
    const { db, data, add } = await setup();
    const first = add(createEntity({ kind: 'place', name: 'Furt' }));
    add(createEntity({ kind: 'place', name: 'Furt' }));
    const result = createArticleOfKind(db, {
      title: 'Furt',
      kind: 'place',
      scaffold: true,
      entityId: first.id,
    })!;
    expect(result.entity?.id).toBe(first.id);
    expect(data().entities[first.id]!.lk?.resourceId).toBe(result.article.id);
    expect(Object.values(data().entities).filter((e) => e.name === 'Furt')).toHaveLength(2);
  });

  it('legt nie einen zweiten Eintrag für einen Namen an, den es schon gibt', async () => {
    const { db, data, add } = await setup();
    // „Brann“ ist der Zweitname eines Eintrags, der schon einen Artikel hat.
    const brann = createArticleOfKind(db, {
      title: 'Brann Eichwald',
      kind: 'person',
      scaffold: false,
    })!;
    db.patch('entities', brann.entity!.id, { aliases: ['Brann'] });
    const count = () => Object.keys(data().entities).length;
    let before = count();
    const second = createArticleOfKind(db, { title: 'Brann', kind: 'person', scaffold: true })!;
    expect(second.entity).toBeNull();
    expect(count()).toBe(before);
    expect(data().entities[brann.entity!.id]!.lk?.resourceId).toBe(brann.article.id);
    // Ein Eintrag mit Zweitnamen und ohne Artikel bekommt den neuen Artikel.
    const grotte = add(createEntity({ kind: 'place', name: 'Salzgrotte am Fluss' }));
    db.patch('entities', grotte.id, { aliases: ['Salzgrotte'] });
    before = count();
    const linked = createArticleOfKind(db, { title: 'Salzgrotte', kind: 'place', scaffold: true })!;
    expect(linked.entity?.id).toBe(grotte.id);
    expect(data().entities[grotte.id]!.lk?.resourceId).toBe(linked.article.id);
    expect(count()).toBe(before);
    // Ein Eintrag, der mit LegendKeeper verknüpft ist, behält seine Verknüpfung.
    const ilka = add(
      createEntity({
        kind: 'person',
        name: 'Ilka Sturmfels',
        lk: { resourceId: 'lk-ilka', title: 'Ilka Sturmfels' },
      }),
    );
    before = count();
    const kept = createArticleOfKind(db, {
      title: 'Ilka Sturmfels',
      kind: 'person',
      scaffold: true,
    })!;
    expect(kept.entity).toBeNull();
    expect(data().entities[ilka.id]!.lk?.resourceId).toBe('lk-ilka');
    expect(count()).toBe(before);
  });

  it('der genannte Eintrag geht vor, auch wenn ein gleichnamiger von selbst verbunden würde', async () => {
    const { db, data, add } = await setup();
    // Der genannte ist mit LegendKeeper verknüpft; ein zweiter gleichen Namens ist frei.
    const meant = add(
      createEntity({ kind: 'place', name: 'Furt', lk: { resourceId: 'lk-furt', title: 'Furt' } }),
    );
    const other = add(createEntity({ kind: 'place', name: 'Furt' }));
    const result = createArticleOfKind(db, {
      title: 'Furt',
      kind: 'place',
      scaffold: false,
      entityId: meant.id,
    })!;
    expect(result.entity?.id).toBe(meant.id);
    expect(data().entities[meant.id]!.lk?.resourceId).toBe(result.article.id);
    expect(data().entities[other.id]!.lk).toBeFalsy();
  });

  it('zählt Felder aus einem zweiten Kasten als vorhanden', async () => {
    const { db, data } = await setup();
    const result = createArticleOfKind(db, {
      title: 'Odo Tannhaus',
      kind: 'person',
      scaffold: false,
    })!;
    savePageText(
      db,
      result.article.id,
      result.article.docs[0]!.id,
      '> [!steckbrief]\n> Volk: Mensch\n\nOdo hütet die Furt.\n\n> [!infobox]\n> Beruf: Fährmann\n> Wohnort: Hohenfurt\n',
    );
    const gap = articleScaffoldGap(data(), data().articles[result.article.id]!);
    expect(gap?.missing).toEqual(['Geboren', 'Herkunft', 'Familie', 'Fraktion']);
  });

  it('nennt am Artikel, was nach dem Gerüst seiner Art fehlt – bis er ausgeblendet ist', async () => {
    const { db, data } = await setup();
    const free = createArticleOfKind(db, { title: 'Ohne Art', kind: null, scaffold: false })!;
    expect(articleScaffoldGap(data(), data().articles[free.article.id]!)).toBeNull();
    const result = createArticleOfKind(db, {
      title: 'Mira Tannhaus',
      kind: 'person',
      scaffold: false,
    })!;
    savePageText(
      db,
      result.article.id,
      result.article.docs[0]!.id,
      '> [!steckbrief]\n> Volk: Mensch\n> Wohnort: \n',
    );
    const gap = articleScaffoldGap(data(), data().articles[result.article.id]!);
    expect(gap?.kind).toBe('person');
    expect(gap?.missing).toEqual(['Geboren', 'Herkunft', 'Beruf', 'Familie', 'Fraktion']);
    addScaffoldFields(db, result.article.id, gap!.missing);
    expect(articleScaffoldGap(data(), data().articles[result.article.id]!)).toBeNull();
  });

  it('blendet den Hinweis je Artikel aus', async () => {
    const { db, data } = await setup();
    const result = createArticleOfKind(db, {
      title: 'Mira Tannhaus',
      kind: 'person',
      scaffold: false,
    })!;
    dismissHint(db, result.article.id, SCAFFOLD_HINT);
    expect(data().articles[result.article.id]!.dismissedHints).toEqual([SCAFFOLD_HINT]);
    expect(articleScaffoldGap(data(), data().articles[result.article.id]!)).toBeNull();
  });
});
