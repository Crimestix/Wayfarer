import { describe, expect, it } from 'vitest';
import { readDatePoint } from '../../domain/lifespan';
import { fromTime } from '../../domain/time/calendar';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createEntity, type CampaignData, type Entity } from '../../domain/schema';
import { lkExportFixture } from './__fixtures__/lkExport';
import {
  applyLkImport,
  canUndoLkImport,
  createArticle,
  createNamedEntity,
  lastLkImport,
  savePageText,
  syncFacts,
  undoLkImport,
} from './actions';
import { planLkImport } from './apply';
import {
  articleFacts,
  articleShare,
  factField,
  kindFromFolder,
  kindFromText,
  nameParts,
  pendingFacts,
  planFacts,
  statedKind,
  statusFromText,
} from './facts';
import { convertLkExport } from './lkexport';

const imported = (): CampaignData =>
  planLkImport(elarisCampaign(), convertLkExport(lkExportFixture())).data;

async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), imported());
  const data = () => db.getSnapshot();
  const entity = <K extends Entity['kind']>(name: string, kind: K) =>
    Object.values(data().entities).find((e) => e.name === name && e.kind === kind) as Extract<
      Entity,
      { kind: K }
    >;
  /** Schreibt den Text der ersten Seite eines Artikels. */
  const write = (articleId: string, text: string) =>
    savePageText(db, articleId, data().articles[articleId]!.docs[0]!.id, text);
  const relations = () =>
    Object.values(data().relations)
      .map((r) => `${r.from} ${r.type} ${r.to}${r.articleId ? ` (${r.articleId})` : ''}`)
      .sort();
  return { db, data, entity, write, relations };
}

describe('Steckbrief lesen', () => {
  it('kennt die Bezeichnungen je Art von Eintrag', () => {
    expect(factField('person', 'Aufenthaltsort')).toBe('whereabouts');
    expect(factField('person', 'TITEL')).toBe('role');
    expect(factField('person', 'Zugehörigkeit')).toBe('membership');
    // Dasselbe Wort heißt je nach Eintrag etwas anderes.
    expect(factField('person', 'Ort')).toBe('whereabouts');
    expect(factField('place', 'Ort')).toBe('location');
    expect(factField('item', 'Ort')).toBe('owner');
    expect(factField('faction', 'Führung')).toBe('leader');
    // Was Wayfarer nicht kennt, lässt es in Ruhe.
    expect(factField('person', 'Haare')).toBeNull();
    expect(factField('character', 'Titel')).toBeNull();
  });

  it('liest die Art aus einem Wort', () => {
    expect(kindFromText('Dorf')).toBe('place');
    expect(kindFromText('Rebellenfraktion')).toBe('faction');
    expect(kindFromText('Religiöse Bewegung / Kult')).toBe('faction');
    expect(kindFromText('Gladiatorenarena')).toBe('place');
    expect(kindFromText('Stadt am Fluss')).toBe('place');
    expect(kindFromText('Person')).toBe('person');
    expect(kindFromText('Adelshaus')).toBe('family');
    // Kurze Wörter zählen nur ganz, nicht als Ende eines anderen Wortes.
    expect(kindFromText('Pirat')).toBeNull();
    expect(kindFromText('Natürlicher Trabant')).toBeNull();
    expect(kindFromText('')).toBeNull();
  });

  it('liest Zustand und Namensteile', () => {
    expect(statusFromText('Lebendig')).toBe('alive');
    expect(statusFromText('Verletzt')).toBe('alive');
    expect(statusFromText('tot')).toBe('dead');
    expect(statusFromText('Verschollen seit dem Winter')).toBe('missing');
    expect(statusFromText('Totengräber')).toBeNull();
    expect(statusFromText('schlecht gelaunt')).toBeNull();
    expect(nameParts('Hohenfurt, Hafenviertel')).toEqual(['Hohenfurt', 'Hafenviertel']);
    expect(nameParts('Der Speicher - Kammer 3 (oben)')).toEqual(['Der Speicher', 'Kammer 3']);
    expect(nameParts('Mira und Odo')).toEqual(['Mira', 'Odo']);
  });
});

describe('Steckbrief speist die Welt', () => {
  it('trägt bei einer Person ein, was im Steckbrief steht', async () => {
    const { db, data, entity, write, relations } = await setup();
    const before = entity('Vera Kohl', 'person');
    expect(before.person.role).toBe('');
    write(
      'vera0001',
      [
        '> [!steckbrief]',
        '> Titel: Hafenmeisterin',
        '> Spezies: Halbling - 41 Jahre',
        '> Status: Verletzt',
        '> Aufenthaltsort: Hohenfurt, Hafenviertel',
        '> Herkunft: aus Hohenfurt',
        '> Zugehörigkeit: Die Aalfischer',
        '> Arbeitet bei: [[Zum Krummen Aal]]',
        '> Haare: grau',
        '',
        'Sie führt Buch über jedes Boot.',
      ].join('\n'),
    );
    const sync = syncFacts(db, ['vera0001']);
    const vera = entity('Vera Kohl', 'person');
    expect(vera.person).toMatchObject({
      role: 'Hafenmeisterin',
      species: 'Halbling',
      speciesId: null,
      status: 'alive',
      // Von zwei genannten Orten zählt der genauere.
      placeId: 'lk-hafen001',
      // Die Herkunft gilt als Zuhause, solange kein Wohnort dasteht.
      homeId: 'lk-hohenf01',
      workplaceId: 'lk-aal00001',
    });
    // Der Eintrag merkt sich, was er aus dem Steckbrief hat – mit dem Wortlaut von dort.
    expect(vera.fromArticle).toEqual({
      role: 'Hafenmeisterin',
      species: 'Halbling',
      status: 'Verletzt',
      placeId: 'Hohenfurt, Hafenviertel',
      homeId: 'aus Hohenfurt',
      workplaceId: 'Zum Krummen Aal',
      'member>lk-fischer1': '1',
    });
    expect(relations()).toContain(`${vera.id} member lk-fischer1 (vera0001)`);
    expect(sync.created).toEqual([]);
    expect(sync.changed).toHaveLength(1);
    expect(sync.changed[0]!.changes).toEqual([
      'Beruf oder Rolle: Hafenmeisterin',
      'Spezies: Halbling',
      'Aufenthaltsort: Hafenviertel',
      'Zuhause: Hohenfurt',
      'Arbeitet bei: Zum Krummen Aal',
      'Gehört zu: Die Aalfischer',
    ]);

    // Ein zweiter Lauf ändert nichts mehr.
    const rev = vera.rev;
    const again = syncFacts(db, ['vera0001']);
    expect(again.changed).toEqual([]);
    expect(entity('Vera Kohl', 'person').rev).toBe(rev);

    // Der Steckbrief ändert sich: Der Wohnort geht der Herkunft vor, die Zugehörigkeit fällt weg.
    write(
      'vera0001',
      ['> [!steckbrief]', '> Herkunft: Hohenfurt', '> Wohnort: Der Speicher', '> Status: tot'].join(
        '\n',
      ),
    );
    syncFacts(db, ['vera0001']);
    const later = entity('Vera Kohl', 'person');
    expect(later.person).toMatchObject({ homeId: 'lk-speich01', status: 'dead' });
    // Was nicht mehr im Steckbrief steht, bleibt als Angabe stehen, gilt aber nicht mehr als gelesen.
    expect(later.person.role).toBe('Hafenmeisterin');
    expect(later.fromArticle).toEqual({ homeId: 'Der Speicher', status: 'tot' });
    expect(relations().some((r) => r.includes('(vera0001)'))).toBe(false);

    // Zurücknehmen stellt den Eintrag wieder her.
    sync.undo();
    expect(data().entities[vera.id]).toMatchObject({
      person: before.person,
      aliases: before.aliases,
      fromArticle: {},
    });
  });

  it('liest Lebensdaten: Geboren, Alter, Gestorben', async () => {
    const { db, data, entity, write } = await setup();
    write(
      'vera0001',
      ['> [!steckbrief]', '> Alter: 34', '> Gestorben: 12. Tauwind 701'].join('\n'),
    );
    syncFacts(db, ['vera0001']);
    const vera = entity('Vera Kohl', 'person');
    const cal = data().campaign.calendar;
    expect(vera.born?.precision).toBe('year');
    expect(fromTime(cal, data().state.now).year - fromTime(cal, vera.born!.at).year).toBe(34);
    expect(vera.ended).toMatchObject({ precision: 'day' });
    expect(vera.fromArticle).toMatchObject({ born: '34', ended: '12. Tauwind 701' });
  });

  it('liest „Geboren: 650“ bei einer Person als Jahr, nicht als Alter', async () => {
    const { db, data, entity, write } = await setup();
    write('vera0001', ['> [!steckbrief]', '> Geboren: 650'].join('\n'));
    syncFacts(db, ['vera0001']);
    const vera = entity('Vera Kohl', 'person');
    const cal = data().campaign.calendar;
    // Das Jahr 650 der Zeitrechnung – nicht 650 Jahre vor heute.
    expect(vera.born).toEqual(readDatePoint(cal, '650', data().state.now));
    expect(fromTime(cal, data().state.now).year - fromTime(cal, vera.born!.at).year).not.toBe(650);
  });

  it('lässt stehen, was von Hand geändert wurde, bis der Artikel etwas anderes sagt', async () => {
    const { db, data, entity, write, relations } = await setup();
    const text = (place: string) =>
      `> [!steckbrief]\n> Aufenthaltsort: ${place}\n> Zugehörigkeit: Die Aalfischer`;
    write('vera0001', text('Hafenviertel'));
    syncFacts(db, ['vera0001']);
    const vera = entity('Vera Kohl', 'person');
    expect(vera.person.placeId).toBe('lk-hafen001');

    // Am Tisch zieht Vera weiter und verlässt die Fischer – von Hand eingetragen.
    db.put('entities', { ...vera, person: { ...vera.person, placeId: 'lk-speich01' } });
    const membership = Object.values(data().relations).find((r) => r.articleId === 'vera0001')!;
    db.remove('relations', membership.id);
    // Der Artikel wird an anderer Stelle geändert; der Steckbrief sagt dasselbe wie zuvor.
    write('vera0001', `${text('Hafenviertel')}\n\nEin neuer Absatz.`);
    expect(syncFacts(db, ['vera0001']).changed).toEqual([]);
    expect(entity('Vera Kohl', 'person').person.placeId).toBe('lk-speich01');
    expect(relations().some((r) => r.includes('(vera0001)'))).toBe(false);

    // Erst wenn im Steckbrief etwas anderes steht, gilt wieder der Artikel.
    write('vera0001', text('Zum Krummen Aal'));
    expect(syncFacts(db, ['vera0001']).changed[0]!.changes).toEqual([
      'Aufenthaltsort: Zum Krummen Aal',
    ]);
    expect(entity('Vera Kohl', 'person').person.placeId).toBe('lk-aal00001');
  });

  it('erkennt eine Person an ihren Feldern, auch ohne das Feld „Art“', async () => {
    const { db, data, entity } = await setup();
    createArticle(db, {
      title: 'Brun Kesselflicker',
      text: '> [!steckbrief]\n> Spezies: Zwerg\n> Titel: Kesselflicker\n> Herkunft: Hohenfurt',
    });
    // Ein einzelnes Feld reicht nicht.
    const lone = createArticle(db, {
      title: 'Die Flusskrebse',
      text: '> [!steckbrief]\n> Volk: Krebse',
    })!;
    expect(statedKind(articleFacts(data().articles, data().articles[lone.id]!))).toBeNull();
    const sync = syncFacts(db);
    expect(sync.created.map((e) => `${e.kind} ${e.name}`)).toEqual(['person Brun Kesselflicker']);
    expect(entity('Brun Kesselflicker', 'person').person).toMatchObject({
      species: 'Zwerg',
      role: 'Kesselflicker',
      homeId: 'lk-hohenf01',
    });
  });

  it('zeigt, was noch nicht in der Welt steht, und legt Fehlendes auf einen Klick an', async () => {
    const { db, data, entity, write, relations } = await setup();
    expect(pendingFacts(data())).toEqual({ changes: [], create: [], missing: [] });
    write(
      'vera0001',
      '> [!steckbrief]\n> Beruf: Hafenmeisterin\n> Zugehörigkeit: Die Lotsen\n> Aufenthaltsort: Alte Idee\n> Arbeitet bei: Lotsen',
    );
    write('mira0001', '> [!steckbrief]\n> Zugehörigkeit: Die Lotsen, Die Aalfischer');
    createArticle(db, { title: 'Graufels', text: '> [!steckbrief]\n> Art: Bergdorf' });

    const pending = pendingFacts(data());
    expect(pending.changes.map((c) => [c.entity.name, c.changes])).toEqual([
      ['Mira Tannhaus', ['Gehört zu: Die Aalfischer']],
      ['Vera Kohl', ['Beruf oder Rolle: Hafenmeisterin']],
    ]);
    expect(pending.create.map((c) => [c.article.title, c.kind])).toEqual([['Graufels', 'place']]);
    // Am häufigsten Genanntes zuerst.
    expect(pending.missing).toEqual([
      // Ein Name steht einmal da, auch wenn ihn zwei Felder nennen – mit oder ohne „Die“.
      {
        name: 'Die Lotsen',
        fields: ['membership', 'workplace'],
        kinds: ['faction', 'family', 'place'],
        articleIds: ['mira0001', 'vera0001'],
      },
      { name: 'Alte Idee', fields: ['whereabouts'], kinds: ['place'], articleIds: ['vera0001'] },
    ]);
    // Nur für einen Artikel gefragt, kommt nur dessen Teil.
    expect(pendingFacts(data(), ['vera0001']).changes.map((c) => c.entity.name)).toEqual([
      'Vera Kohl',
    ]);

    // „Die Lotsen“ entstehen neu; beide Steckbriefe zeigen sofort darauf.
    const lotsen = createNamedEntity(db, 'Die Lotsen', 'faction', ['mira0001', 'vera0001']);
    expect(lotsen.entity).toMatchObject({ kind: 'faction', name: 'Die Lotsen', lk: null });
    // Auch „Lotsen“ ohne „Die“ meint sie.
    expect(entity('Vera Kohl', 'person').person.workplaceId).toBe(lotsen.entity.id);
    expect(relations()).toEqual(
      expect.arrayContaining([
        `lk-mira0001 member ${lotsen.entity.id} (mira0001)`,
        `lk-vera0001 member ${lotsen.entity.id} (vera0001)`,
      ]),
    );
    // Zu „Alte Idee“ gibt es einen Artikel ohne Eintrag: Er wird der Artikel des neuen Ortes.
    const idea = createNamedEntity(db, 'Alte Idee', 'place', ['vera0001']);
    expect(idea.entity.lk).toEqual({ resourceId: 'entwurf1', title: 'Alte Idee' });
    expect(entity('Vera Kohl', 'person').person.placeId).toBe(idea.entity.id);
    expect(pendingFacts(data()).missing).toEqual([]);

    // Zurücknehmen entfernt den Eintrag und was auf ihn zeigte.
    idea.undo();
    expect(data().entities[idea.entity.id]).toBeUndefined();
    expect(entity('Vera Kohl', 'person').person.placeId).toBeNull();
  });

  it('wertet die Steckbriefe bei der Übernahme gleich mit aus', async () => {
    const before = elarisCampaign();
    const db = await CampaignDb.create(new MemoryStore(), before);
    const plan = planLkImport(before, convertLkExport(lkExportFixture()));
    applyLkImport(db, plan, 'welt.lk', { facts: true });
    // Nichts mehr offen: Was die Steckbriefe der Übernahme sagen, steht schon in der Welt.
    expect(pendingFacts(db.getSnapshot()).changes).toEqual([]);
    expect(lastLkImport()?.facts).toEqual({
      created: expect.any(Number),
      changed: expect.any(Number),
    });
    // Die Übernahme lässt sich weiterhin als Ganzes zurücknehmen.
    expect(canUndoLkImport(db)).toBe(true);
    expect(undoLkImport(db)).toBe(true);
    expect(Object.keys(db.getSnapshot().articles)).toEqual([]);
  });

  it('lässt von Hand eingetragene Beziehungen in Ruhe', async () => {
    const { db, write, relations } = await setup();
    // Odo gehört schon zu den Aalfischern – von der Übernahme, nicht aus dem Steckbrief.
    expect(relations()).toContain('lk-odo00001 member lk-fischer1');
    write('odo00001', '> [!steckbrief]\n> Zugehörigkeit: Die Aalfischer');
    syncFacts(db, ['odo00001']);
    expect(relations().filter((r) => r.startsWith('lk-odo00001 member'))).toEqual([
      'lk-odo00001 member lk-fischer1',
    ]);
    write('odo00001', 'Ohne Steckbrief.');
    syncFacts(db, ['odo00001']);
    expect(relations()).toContain('lk-odo00001 member lk-fischer1');
  });

  it('liest Lage, Sitz, Führung und Art bei Orten und Fraktionen', async () => {
    const { db, data, entity, write, relations } = await setup();
    write(
      'hafen001',
      [
        '> [!steckbrief]',
        '> Art: Stadtviertel',
        // Der Speicher liegt im Hafenviertel – umgekehrt geht es nicht.
        '> Liegt in: Der Speicher',
        '> Herrscher: Mira Tannhaus',
      ].join('\n'),
    );
    write(
      'fischer1',
      [
        '> [!steckbrief]',
        '> Art: Fischergilde',
        '> Sitz: Der Speicher',
        '> Führung: Jost Reuse, Die Alte vom Wehr',
      ].join('\n'),
    );
    syncFacts(db);
    const quarter = entity('Hafenviertel', 'place');
    expect(quarter.place).toMatchObject({ category: 'Stadtviertel', parentId: 'lk-hohenf01' });
    expect(Object.keys(quarter.fromArticle).sort()).toEqual(['category', 'rules<lk-mira0001']);
    const guild = entity('Die Aalfischer', 'faction');
    expect(guild.faction).toMatchObject({ category: 'Fischergilde', seatId: 'lk-speich01' });
    expect(relations()).toEqual(
      expect.arrayContaining([
        'lk-mira0001 rules lk-hafen001 (hafen001)',
        'lk-jost0001 leads lk-fischer1 (fischer1)',
      ]),
    );
    // Wen es nicht gibt, nennt der Plan – angelegt wird niemand.
    const plan = planFacts(data(), data().articles.fischer1!, guild);
    expect(plan.readings.find((r) => r.field === 'leader')).toMatchObject({
      missing: ['Die Alte vom Wehr'],
      kinds: expect.arrayContaining(['person']),
    });
    expect(plan.changes).toEqual([]);
  });

  it('legt einen Eintrag an, wenn der Steckbrief die Art nennt', async () => {
    const { db, data, entity, write } = await setup();
    const village = createArticle(db, {
      title: 'Graufels',
      text: '> [!steckbrief]\n> Art: Bergdorf\n> Region: Hohenfurt\n\nEin Dorf am Hang.',
    })!;
    // Eine Person, die auf das neue Dorf zeigt – im selben Lauf.
    const smith = createArticle(db, {
      title: 'Bran Eisenhand',
      text: '> [!steckbrief]\n> Art: Person\n> Beruf: Schmied\n> Wohnort: Graufels',
    })!;
    // Kein Wort, das eine Art verrät: bleibt ein reiner Artikel.
    write('entwurf1', '> [!steckbrief]\n> Art: Natürlicher Trabant');
    expect(statedKind(articleFacts(data().articles, data().articles.entwurf1!))).toBeNull();

    const sync = syncFacts(db);
    expect(sync.created.map((e) => `${e.kind} ${e.name}`).sort()).toEqual([
      'person Bran Eisenhand',
      'place Graufels',
    ]);
    const place = entity('Graufels', 'place');
    expect(place.lk).toEqual({ resourceId: village.id, title: 'Graufels' });
    expect(place.place).toMatchObject({ category: 'Bergdorf', parentId: 'lk-hohenf01' });
    const person = entity('Bran Eisenhand', 'person');
    expect(person.lk?.resourceId).toBe(smith.id);
    expect(person.person).toMatchObject({ role: 'Schmied', homeId: place.id });

    // Zurücknehmen entfernt auch die neuen Einträge.
    sync.undo();
    expect(entity('Graufels', 'place')).toBeUndefined();
    expect(entity('Bran Eisenhand', 'person')).toBeUndefined();
    // Vorlagen bekommen nie einen Eintrag.
    expect(Object.values(data().entities).some((e) => e.lk?.resourceId === 'vorlage1')).toBe(false);
  });
  it('sagt, was ein Eintrag aus dem Steckbrief hat', () => {
    expect(
      articleShare({
        fromArticle: {
          role: 'Fischerin',
          speciesId: 'Mensch',
          species: 'Mensch',
          homeId: 'Hohenfurt',
          'sibling>abc': '1',
          'member<def': '1',
          unbekannt: 'x',
        },
      }),
    ).toEqual({ fields: ['Beruf oder Rolle', 'Spezies', 'Zuhause'], relations: 2 });
    expect(articleShare({ fromArticle: {} })).toEqual({ fields: [], relations: 0 });
  });
});

describe('Steckbrief: Pflanzen, Tiere, Gesteine und Berufe', () => {
  it('erkennt die neuen Arten am Wort', () => {
    expect(kindFromText('Heilkraut')).toBe('plant');
    expect(kindFromText('Pilz')).toBe('plant');
    expect(kindFromText('Reittier')).toBe('animal');
    expect(kindFromText('Tier')).toBe('animal');
    // „Quartier“ endet zwar auf „tier“, ist aber kein Tier.
    expect(kindFromText('Quartier')).toBeNull();
    expect(kindFromText('Edelstein')).toBe('mineral');
    expect(kindFromText('Eisenerz')).toBe('mineral');
    expect(kindFromText('Steinsalz')).toBe('mineral');
    expect(kindFromText('Handwerk')).toBe('profession');
    // Ein Trank ist ein Gegenstand, auch wenn er aus einem Kraut gemacht ist.
    expect(kindFromText('Trank')).toBe('item');
    // Gifte, Salben und Bücher sind von Hand gemacht: Gegenstände, auch aus Kräutern.
    expect(kindFromText('Kräutersalbe')).toBe('item');
    expect(kindFromText('Pflanzengift')).toBe('item');
    expect(kindFromText('Heilelixier')).toBe('item');
    expect(kindFromText('Zauberbuch')).toBe('item');
    expect(kindFromText('Blutbuche')).toBeNull();
    expect(factField('plant', 'Blütezeit')).toBe('season');
    expect(factField('animal', 'Verbreitung')).toBe('region');
    expect(factField('mineral', 'Preis')).toBe('price');
    expect(factField('profession', 'Werkzeug')).toBe('tool');
    expect(factField('person', 'Beruf')).toBe('profession');
  });

  it('speist Lebensraum, Vorkommen, Zeit, Seltenheit und Wert', async () => {
    const { db, data, entity } = await setup();
    const region = db.put(
      'entities',
      createEntity({ kind: 'place', name: 'Krummzahn-Sumpf' } as never),
    );
    const article = createArticle(db, {
      title: 'Mondkraut',
      text: '> [!steckbrief]\n> Art: Heilkraut\n> Lebensraum: Wald, Sümpfe\n> Vorkommen: Krummzahn-Sumpf\n> Blütezeit: Frühling\n> Seltenheit: selten\n> Preis: 5 Silber',
    })!;
    syncFacts(db, [article.id]);
    const herb = entity('Mondkraut', 'plant');
    expect(herb.plant).toMatchObject({
      category: 'Heilkraut',
      habitat: ['Wald', 'Sümpfe'],
      regionIds: [region.id],
      seasons: ['Frühling'],
      rarity: 'rare',
      price: 0.5,
    });
    expect(articleShare(herb).fields).toEqual([
      'Art',
      'Lebensraum',
      'Vorkommen',
      'Jahreszeit',
      'Seltenheit',
      'Wert',
    ]);
    // Ein zweiter Lauf ändert nichts.
    expect(planFacts(data(), data().articles[article.id]!, herb).changes).toEqual([]);
  });

  it('schlägt die Art nach dem Ordner vor', async () => {
    const { db, data } = await setup();
    const flora = createArticle(db, { title: 'Flora' })!;
    const herbs = createArticle(db, { title: 'Kräuter', parentId: flora.id })!;
    const herb = createArticle(db, { title: 'Mondkraut', parentId: herbs.id })!;
    const loose = createArticle(db, { title: 'Allerlei' })!;
    expect(kindFromFolder(data().articles, herb)).toEqual({ kind: 'plant', folder: 'Kräuter' });
    expect(kindFromFolder(data().articles, herbs)).toEqual({ kind: 'plant', folder: 'Flora' });
    expect(kindFromFolder(data().articles, loose)).toBeNull();
  });

  it('verbindet eine Person mit ihrem Beruf und behält ihn als Rolle', async () => {
    const { db, data, entity, write, relations } = await setup();
    const smith = db.put(
      'entities',
      createEntity({ kind: 'profession', name: 'Schmied' } as never),
    );
    write('vera0001', '> [!steckbrief]\n> Beruf: Schmied, Hafenmeisterin');
    syncFacts(db, ['vera0001']);
    const vera = entity('Vera Kohl', 'person');
    expect(vera.person.role).toBe('Schmied, Hafenmeisterin');
    expect(relations()).toContain(`${vera.id} practises ${smith.id} (vera0001)`);
    // Ein Beruf ohne Eintrag ist kein fehlender Eintrag.
    expect(pendingFacts(data()).missing).toEqual([]);
  });
});
