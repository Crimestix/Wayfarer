import { describe, expect, it } from 'vitest';
import { demoCampaign } from '../../data/__fixtures__/demoWorld';
import { entitiesOfKind, partyStays, placeCast } from '../../domain/derive';
import {
  PARTY_ID,
  createEntity,
  createRelation,
  type CampaignData,
  type Entity,
  type Person,
} from '../../domain/schema';
import { MINUTES_PER_DAY } from '../../domain/time/calendar';
import {
  castSubline,
  categoryOptions,
  deletionImpact,
  deletionNotes,
  describeVisit,
  draftChanged,
  draftOf,
  draftProblem,
  emptyDraft,
  entityFacts,
  entityFromDraft,
  entitySubline,
  groupMembers,
  fitWithin,
  forbiddenParents,
  isLongName,
  isWorldEntity,
  itemsHeldBy,
  linkedSubline,
  listKeyMove,
  nameTwin,
  nextRowIndex,
  openAncestors,
  partyAttitudes,
  placeTreeRows,
  recentChronicle,
  recentlyChanged,
  relationDraft,
  relationDraftChanged,
  relationDrafts,
  relationRows,
  relationSentence,
  savesDirection,
  searchWorld,
  shortPath,
  splitList,
  startDirection,
  treeIndent,
  upcomingFor,
  worldCounts,
  kindSections,
  WORLD_KINDS,
  type WorldEntity,
} from './model';

const data = demoCampaign();
const find = (name: string, source: CampaignData = data): Entity =>
  Object.values(source.entities).find((e) => e.name === name)!;
const world = (name: string, source: CampaignData = data) => find(name, source) as WorldEntity;
const withEntities = (source: CampaignData, ...entities: Entity[]): CampaignData => ({
  ...source,
  entities: { ...source.entities, ...Object.fromEntries(entities.map((e) => [e.id, e])) },
});

describe('Übersicht', () => {
  it('zählt die Einträge je Art ohne Gefährten', () => {
    expect(worldCounts(data)).toEqual({
      place: 6,
      person: 6,
      faction: 2,
      item: 1,
      topic: 0,
      family: 0,
      species: 0,
      language: 0,
      script: 0,
      ability: 0,
      plant: 0,
      animal: 0,
      mineral: 0,
      profession: 0,
      deity: 0,
      realm: 0,
      happening: 0,
      landscape: 0,
      celestial: 0,
      dimension: 0,
    });
  });

  it('zeigt Orte als Baum; anfangs sind nur die obersten Orte aufgeklappt', () => {
    const rows = placeTreeRows(data);
    expect(rows.map((r) => `${r.depth} ${r.place.name}`)).toEqual([
      '0 Nebelküste',
      '1 Dornhafen',
      '1 Krähenmoor',
    ]);
    expect(rows[1]).toMatchObject({ childCount: 2, open: false });
  });

  it('klappt auf und zu, wie es von Hand eingestellt wurde', () => {
    const hafen = find('Dornhafen');
    const open = placeTreeRows(data, { [hafen.id]: true });
    expect(open.map((r) => r.place.name)).toEqual([
      'Nebelküste',
      'Dornhafen',
      'Kontor der Duskryn',
      'Zum Salzigen Raben',
      'Krähenmoor',
    ]);
    expect(open.find((r) => r.place.name === 'Zum Salzigen Raben')!.depth).toBe(2);
    const closed = placeTreeRows(data, { [find('Nebelküste').id]: false });
    expect(closed.map((r) => r.place.name)).toEqual(['Nebelküste']);
  });

  it('markiert, wo die Gruppe ist – auch auf zugeklappten Orten darüber', () => {
    const rows = placeTreeRows(data);
    const by = (name: string) => rows.find((r) => r.place.name === name)!;
    expect(by('Krähenmoor')).toMatchObject({ partyHere: true, partyBelow: false });
    expect(by('Nebelküste')).toMatchObject({ partyHere: false, partyBelow: true });
    expect(by('Dornhafen')).toMatchObject({ partyHere: false, partyBelow: false });
  });

  it('macht einen Ort sichtbar, indem alle Orte darüber aufgeklappt werden', () => {
    const kloster = find('Kloster Sankt Vael');
    const state = openAncestors(data, kloster.id, { [find('Nebelküste').id]: false });
    expect(placeTreeRows(data, state).some((r) => r.place.id === kloster.id)).toBe(true);
  });

  it('zeigt Orte mit fehlendem oder kreisförmigem Elternort trotzdem an', () => {
    const a = createEntity({ kind: 'place', name: 'A', place: { parentId: 'gibt-es-nicht' } });
    const b = createEntity({ kind: 'place', name: 'B' });
    const c = createEntity({ kind: 'place', name: 'C', place: { parentId: b.id } });
    const loop = { ...b, place: { ...b.place, parentId: c.id } };
    const rows = placeTreeRows(withEntities(data, a, loop, c), { [loop.id]: true, [c.id]: true });
    const names = rows.map((r) => r.place.name);
    expect(names).toContain('A');
    expect(names).toContain('B');
    expect(names).toContain('C');
    expect(new Set(names).size).toBe(names.length);
  });

  it('fasst einen Eintrag für die Liste in wenigen Wörtern zusammen', () => {
    expect(entitySubline(data, find('Brann Eisenhaken'))).toBe('Hafenmeister · Dornhafen');
    expect(entitySubline(data, find('Bruder Teoric'))).toBe('Mönch · Verschollen');
    expect(entitySubline(data, find('Haus Duskryn'))).toBe('Adelshaus · Kontor der Duskryn');
    expect(entitySubline(data, find('Die Glocke von Sankt Vael'))).toBe(
      'Artefakt · Kloster Sankt Vael',
    );
    expect(entitySubline(data, find('Dornhafen'))).toBe('Stadt');
  });

  it('sucht nur in der Weltdatenbank und beachtet den Filter', () => {
    expect(searchWorld(data, 'duskryn', 'all').map((e) => e.name)).toEqual([
      'Haus Duskryn',
      'Kontor der Duskryn',
      'Maera Duskryn',
      'Dornhafen',
      'Hauptmann Voss',
    ]);
    expect(searchWorld(data, 'maera', 'person').map((e) => e.name)).toEqual(['Maera Duskryn']);
    expect(searchWorld(data, 'tomlin', 'all')).toEqual([]);
    expect(searchWorld(data, '', 'all').every(isWorldEntity)).toBe(true);
  });

  it('nennt die zuletzt geänderten Einträge zuerst', () => {
    const fresh = { ...find('Krähenmoor'), updated: '2999-01-01T00:00:00.000Z' };
    const list = recentlyChanged(withEntities(data, fresh), 3);
    expect(list).toHaveLength(3);
    expect(list[0]!.name).toBe('Krähenmoor');
    expect(list.map((e): string => e.kind)).not.toContain('character');
  });

  it('schlägt für „Art“ zuerst vor, was schon verwendet wird', () => {
    const options = categoryOptions(data, 'place');
    expect(options.slice(0, 6)).toEqual([
      'Gebäude',
      'Region',
      'Ruine',
      'Stadt',
      'Taverne',
      'Wildnis',
    ]);
    expect(options).toContain('Dorf');
    expect(new Set(options).size).toBe(options.length);
  });
});

describe('Dossier', () => {
  it('nennt die wichtigsten Fakten einer Person', () => {
    const maera = find('Maera Duskryn');
    const kontor = find('Kontor der Duskryn');
    expect(entityFacts(data, maera)).toEqual([
      { label: 'Rolle', text: 'Herrin von Haus Duskryn', tone: undefined },
      { label: 'Volk', text: 'Mensch', tone: undefined },
      { label: 'Zustand', text: 'Lebt', tone: undefined },
      { label: 'Aufenthalt', ids: [kontor.id] },
      { label: 'Zuhause', ids: [kontor.id] },
    ]);
    const teoric = entityFacts(data, find('Bruder Teoric'));
    expect(teoric).toContainEqual({ label: 'Zustand', text: 'Verschollen', tone: 'danger' });
    expect(teoric).toContainEqual({ label: 'Aufenthalt', text: 'unbekannt' });
  });

  it('nennt bei Orten den Pfad von oben nach unten', () => {
    const facts = entityFacts(data, find('Zum Salzigen Raben'));
    expect(facts[0]).toEqual({
      label: 'Liegt in',
      ids: [find('Nebelküste').id, find('Dornhafen').id],
    });
    expect(facts[1]).toMatchObject({ label: 'Art', text: 'Taverne' });
    expect(entityFacts(data, find('Nebelküste')).map((f) => f.label)).toEqual(['Art']);
  });

  it('nennt Sitz und Verbleib', () => {
    expect(entityFacts(data, find('Haus Duskryn'))[0]).toEqual({
      label: 'Sitz',
      ids: [find('Kontor der Duskryn').id],
    });
    expect(entityFacts(data, find('Die Glocke von Sankt Vael'))[0]).toEqual({
      label: 'Befindet sich bei',
      ids: [find('Kloster Sankt Vael').id],
    });
  });

  it('beschreibt Besuche mit Datum und Dauer', () => {
    const cal = data.campaign.calendar;
    const now = data.state.now;
    const stays = partyStays(data);
    const first = describeVisit(cal, now, stays[0]!);
    // Die Gruppe kam vor neun Tagen an und brach vor sechs Tagen auf – „zuletzt hier“ meint den Aufbruch.
    expect(first).toMatchObject({ duration: '3 Tage', ongoing: false, ago: 'vor 6 Tagen' });
    expect(first.from).toBe('8. Tauwind');
    expect(first.to).toBe('11. Tauwind');
    const current = describeVisit(cal, now, stays[stays.length - 1]!);
    expect(current).toMatchObject({ duration: '2 Std.', ongoing: true, to: '' });
    const lastYear = describeVisit(cal, now, {
      placeId: 'x',
      from: now - 400 * MINUTES_PER_DAY,
      to: null,
    });
    expect(lastYear.from).toMatch(/ AD$/);
  });

  it('findet kommende Termine am Ort, in Orten darunter und zu einer Person', () => {
    const titles = (id: string) => upcomingFor(data, id).map((o) => o.event.title);
    expect(titles(find('Dornhafen').id)).toEqual([
      'Treffen mit Brann am Nordkai',
      'Der Graue Fang legt ab',
      'Vollmondmarkt in Dornhafen',
    ]);
    expect(titles(find('Nebelküste').id)).toHaveLength(3);
    expect(titles(find('Brann Eisenhaken').id)).toEqual(['Treffen mit Brann am Nordkai']);
    expect(titles(find('Haus Duskryn').id)).toEqual(['Der Graue Fang legt ab']);
    expect(titles(find('Krähenmoor').id)).toEqual([]);
  });

  it('nennt die Mitglieder einer Fraktion, die Führung zuerst', () => {
    const members = groupMembers(data, find('Haus Duskryn').id);
    expect(members.map((m) => `${m.entity.name} ${m.label}`)).toEqual([
      'Maera Duskryn führt',
      'Brann Eisenhaken arbeitet für',
    ]);
    const lotsen = groupMembers(data, find('Bruderschaft der Lotsen').id);
    expect(lotsen.map((m) => m.entity.name)).toEqual(['Isolde Rabenschwinge', 'Kessa Flutwind']);
    expect(lotsen[0]!.label).toBe('gehört zu');
  });

  it('lässt beendete Mitgliedschaften weg und liest Beziehungen von der Fraktion aus rückwärts', () => {
    const haus = find('Haus Duskryn');
    const voss = find('Hauptmann Voss');
    const kessa = find('Kessa Flutwind');
    const hire = createRelation({ from: haus.id, to: voss.id, type: 'employs' });
    const old = createRelation({ from: kessa.id, to: haus.id, type: 'member', ended: true });
    const next = { ...data, relations: { ...data.relations, [hire.id]: hire, [old.id]: old } };
    const members = groupMembers(next, haus.id);
    expect(members.find((m) => m.entity.id === voss.id)!.label).toBe('arbeitet für');
    expect(members.some((m) => m.entity.id === kessa.id)).toBe(false);
  });

  it('beschreibt die Besetzung eines Ortes', () => {
    const hafen = find('Dornhafen');
    const person = (name: string) => find(name) as Person;
    expect(castSubline(data, person('Brann Eisenhaken'), hafen.id)).toBe('Hafenmeister');
    expect(castSubline(data, person('Isolde Rabenschwinge'), hafen.id)).toBe(
      'Wirtin · Zum Salzigen Raben',
    );
    expect(castSubline(data, person('Bruder Teoric'), find('Kloster Sankt Vael').id, true)).toBe(
      'Mönch · Verschollen · Aufenthalt unbekannt',
    );
    expect(castSubline(data, person('Kessa Flutwind'), find('Krähenmoor').id, true)).toBe(
      'Lotsin · zurzeit: Zum Salzigen Raben',
    );
    const moor = find('Krähenmoor');
    const rules = createRelation({ from: find('Haus Duskryn').id, to: moor.id, type: 'rules' });
    const tied = createRelation({ from: moor.id, to: find('Kessa Flutwind').id, type: 'resides' });
    const next = { ...data, relations: { ...data.relations, [rules.id]: rules, [tied.id]: tied } };
    const linked = placeCast(next, moor.id).linked;
    expect(linked.map((l) => linkedSubline(next, moor.id, l)).sort()).toEqual([
      'herrscht über Krähenmoor',
      'ist wichtig für Krähenmoor',
    ]);
  });

  it('zeigt die jüngsten Chronik-Einträge ohne das, was schon an anderer Stelle steht', () => {
    const voss = recentChronicle(data, find('Hauptmann Voss').id);
    expect(voss).toEqual({ entries: [], total: 1 });
    const brann = recentChronicle(data, find('Brann Eisenhaken').id);
    expect(brann).toEqual({ entries: [], total: 1 });
    const isolde = recentChronicle(data, find('Isolde Rabenschwinge').id);
    expect(isolde.entries.map((e) => e.kind)).toEqual(['note']);
    const hafen = recentChronicle(data, find('Dornhafen').id, 2);
    expect(hafen.entries).toHaveLength(2);
    expect(hafen.entries[0]!.at).toBeLessThan(hafen.entries[1]!.at);
    expect(hafen.total).toBeGreaterThan(5);
  });

  it('findet Gegenstände an einem Ort und in Orten darunter', () => {
    expect(itemsHeldBy(data, find('Krähenmoor').id).map((i) => i.name)).toEqual([
      'Die Glocke von Sankt Vael',
    ]);
    expect(itemsHeldBy(data, find('Dornhafen').id)).toEqual([]);
  });
});

describe('Beziehungen', () => {
  it('beschreibt jede Beziehung aus Sicht des geöffneten Eintrags', () => {
    const maera = find('Maera Duskryn');
    const rows = relationRows(data, maera.id);
    expect(rows.map((r) => `${r.label} ${r.name}`)).toEqual([
      'kennt Die Gruppe',
      'gebietet über Hauptmann Voss',
      'führt Haus Duskryn',
      'wird gefürchtet von Isolde Rabenschwinge',
    ]);
    const voss = rows[1]!;
    expect(voss.inverseLabel).toBe('dient');
    expect(voss.outgoing).toBeNull();
    expect(voss.incoming!.attitude).toBe(2);
    expect(rows[0]).toMatchObject({ otherId: PARTY_ID, entity: undefined });
    expect(rows[0]!.notes).toEqual(['Sieht die Gruppe als nützliches Werkzeug.']);
    expect(rows[3]!.secret).toBe(true);
  });

  it('benennt ein Paar nach der aussagekräftigeren Richtung', () => {
    const maera = find('Maera Duskryn');
    const voss = find('Hauptmann Voss');
    const back = createRelation({ from: maera.id, to: voss.id, type: 'knows', attitude: 0 });
    const next = { ...data, relations: { ...data.relations, [back.id]: back } };
    const row = relationRows(next, maera.id).find((r) => r.otherId === voss.id)!;
    expect(row).toMatchObject({ label: 'gebietet über', inverseLabel: 'dient' });
    expect(row.outgoing!.attitude).toBe(0);
    expect(row.incoming!.attitude).toBe(2);
    const mirrored = relationRows(next, voss.id).find((r) => r.otherId === maera.id)!;
    expect(mirrored).toMatchObject({ label: 'dient', inverseLabel: 'gebietet über' });
  });

  it('kennt die Haltung aller Einträge zur Gruppe', () => {
    const map = partyAttitudes(data);
    expect(map.get(find('Hauptmann Voss').id)).toBe(-2);
    expect(map.get(find('Isolde Rabenschwinge').id)).toBe(2);
    expect(map.has(find('Kessa Flutwind').id)).toBe(false);
  });

  it('stellt beendete Beziehungen ans Ende', () => {
    const maera = find('Maera Duskryn');
    const haus = find('Haus Duskryn');
    const leads = Object.values(data.relations).find(
      (r) => r.from === maera.id && r.to === haus.id,
    )!;
    const next = {
      ...data,
      relations: { ...data.relations, [leads.id]: { ...leads, ended: true } },
    };
    const rows = relationRows(next, maera.id);
    expect(rows[rows.length - 1]).toMatchObject({ name: 'Haus Duskryn', ended: true });
    expect(rows.slice(0, -1).every((r) => !r.ended)).toBe(true);
  });

  it('formuliert einen ganzen Satz', () => {
    const maera = find('Maera Duskryn');
    const haus = find('Haus Duskryn');
    expect(relationSentence(data, maera.id, haus.id, { type: 'leads', label: '' })).toBe(
      'Maera Duskryn führt Haus Duskryn',
    );
    expect(
      relationSentence(data, maera.id, PARTY_ID, { type: 'custom', label: 'beobachtet' }),
    ).toBe('Maera Duskryn beobachtet Die Gruppe');
  });

  it('erkennt, ob im Dialog etwas geändert wurde', () => {
    const relation = Object.values(data.relations).find((r) => r.note)!;
    expect(relationDraftChanged(relationDraft(relation), relation)).toBe(false);
    expect(relationDraftChanged({ ...relationDraft(relation), attitude: 3 }, relation)).toBe(true);
    expect(relationDraftChanged(relationDraft(), null)).toBe(false);
    expect(relationDraftChanged({ ...relationDraft(), type: 'friend' }, null)).toBe(true);
    expect(relationDraftChanged({ ...relationDraft(), note: '  ' }, null)).toBe(false);
  });
});

describe('Löschen', () => {
  it('nennt, was am Löschen eines Ortes hängt', () => {
    const impact = deletionImpact(data, find('Dornhafen').id);
    expect(impact).toMatchObject({
      children: 2,
      residents: 3,
      relations: 1,
      events: 3,
      partyIsHere: false,
    });
    expect(impact.chronicle).toBeGreaterThan(3);
    const notes = deletionNotes(impact);
    expect(notes[0]).toBe('Eine Beziehung wird mit gelöscht.');
    expect(notes[1]).toBe('2 Orte darunter rücken eine Ebene nach oben.');
    expect(notes[2]).toBe('Bei 3 anderen Einträgen wird die Angabe zu diesem Eintrag geleert.');
    expect(notes[3]).toBe('3 Termine verlieren den Verweis auf diesen Eintrag.');
    expect(notes[4]).toMatch(/^\d+ Chronik-Einträge bleiben erhalten, nennen dann aber/);
    expect(notes).toHaveLength(5);
  });

  it('warnt, wenn die Gruppe gerade dort ist, und schweigt, wenn nichts daran hängt', () => {
    expect(deletionNotes(deletionImpact(data, find('Krähenmoor').id)).pop()).toMatch(
      /Die Gruppe ist gerade hier/,
    );
    const lonely = createEntity({ kind: 'topic', name: 'Allein' });
    expect(deletionNotes(deletionImpact(withEntities(data, lonely), lonely.id))).toEqual([]);
  });
});

describe('Bearbeiten', () => {
  it('trennt Listen und entfernt Leeres und Doppeltes', () => {
    expect(splitList(' Hafen, Duskryn ; hafen,, Zoll\nMoor ')).toEqual([
      'Hafen',
      'Duskryn',
      'Zoll',
      'Moor',
    ]);
    expect(splitList('')).toEqual([]);
  });

  it('legt aus dem Entwurf einen neuen Eintrag mit allen Feldern an', () => {
    const hafen = find('Dornhafen');
    const person = entityFromDraft(
      emptyDraft('person', {
        name: '  Jorun Salzbart ',
        aliases: 'der Alte, Salzbart',
        tagline: 'Fährmann.',
        tags: 'Hafen',
        role: 'Fährmann',
        species: 'Mensch',
        status: 'missing',
        placeId: hafen.id,
        met: true,
      }),
    );
    expect(person).toMatchObject({
      kind: 'person',
      name: 'Jorun Salzbart',
      aliases: ['der Alte', 'Salzbart'],
      tags: ['Hafen'],
      person: {
        role: 'Fährmann',
        species: 'Mensch',
        status: 'missing',
        placeId: hafen.id,
        homeId: null,
        met: true,
      },
    });
    expect(person.id).toMatch(/^[a-z0-9]{12}$/);
    const place = entityFromDraft(
      emptyDraft('place', { name: 'Zollhaus', parentId: hafen.id, category: ' Gebäude ' }),
    );
    expect(place).toMatchObject({
      kind: 'place',
      place: { parentId: hafen.id, category: 'Gebäude' },
    });
    expect(entityFromDraft(emptyDraft('faction', { name: 'F', seatId: hafen.id }))).toMatchObject({
      kind: 'faction',
      faction: { seatId: hafen.id },
    });
    expect(entityFromDraft(emptyDraft('item', { name: 'I', holderId: hafen.id }))).toMatchObject({
      kind: 'item',
      item: { holderId: hafen.id },
    });
    expect(entityFromDraft(emptyDraft('topic', { name: 'T', category: 'Gerücht' }))).toMatchObject({
      kind: 'topic',
      topic: { category: 'Gerücht' },
    });
  });

  it('ändert einen vorhandenen Eintrag, ohne ID oder Verknüpfungen zu verlieren', () => {
    const maera = { ...world('Maera Duskryn'), lk: { resourceId: 'abc', title: 'Maera' } };
    const draft = draftOf(maera);
    expect(draft).toMatchObject({
      name: 'Maera Duskryn',
      tags: 'Adel',
      role: 'Herrin von Haus Duskryn',
      met: true,
    });
    const saved = entityFromDraft({ ...draft, tagline: 'Neu.', status: 'dead', secret: '' }, maera);
    expect(saved.id).toBe(maera.id);
    expect(saved.created).toBe(maera.created);
    expect(saved.lk).toEqual({ resourceId: 'abc', title: 'Maera' });
    expect(saved).toMatchObject({
      tagline: 'Neu.',
      secret: '',
      person: { status: 'dead', homeId: maera.kind === 'person' ? maera.person.homeId : null },
    });
  });

  it('gibt jeden Eintrag unverändert zurück, wenn im Dialog nichts geändert wurde', () => {
    for (const entity of Object.values(data.entities)) {
      if (!isWorldEntity(entity)) continue;
      expect(entityFromDraft(draftOf(entity), entity)).toEqual(entity);
    }
  });

  it('verlangt einen Namen', () => {
    expect(draftProblem(data, emptyDraft('person'), null)).toMatch(/Namen/);
    expect(draftProblem(data, emptyDraft('person', { name: 'X' }), null)).toBeNull();
  });

  it('verhindert, dass ein Ort in sich selbst oder in einem Unterort liegt', () => {
    const kueste = world('Nebelküste');
    const hafen = world('Dornhafen');
    const taverne = find('Zum Salzigen Raben');
    expect(draftProblem(data, { ...draftOf(kueste), parentId: taverne.id }, kueste.id)).toMatch(
      /sich selbst/,
    );
    expect(draftProblem(data, { ...draftOf(hafen), parentId: hafen.id }, hafen.id)).toMatch(
      /sich selbst/,
    );
    expect(
      draftProblem(data, { ...draftOf(hafen), parentId: find('Krähenmoor').id }, hafen.id),
    ).toBeNull();
    expect(draftProblem(data, { ...draftOf(hafen), parentId: 'weg' }, hafen.id)).toMatch(
      /existiert nicht/,
    );
    expect(forbiddenParents(data, hafen.id).sort()).toEqual(
      [hafen.id, taverne.id, find('Kontor der Duskryn').id].sort(),
    );
    expect(forbiddenParents(data, null)).toEqual([]);
  });

  it('weist auf gleichnamige Einträge derselben Art hin', () => {
    expect(nameTwin(data, emptyDraft('place', { name: ' dornhafen ' }), null)?.name).toBe(
      'Dornhafen',
    );
    expect(nameTwin(data, emptyDraft('person', { name: 'Dornhafen' }), null)).toBeUndefined();
    expect(nameTwin(data, draftOf(world('Dornhafen')), find('Dornhafen').id)).toBeUndefined();
  });
});

describe('Bild', () => {
  it('verkleinert auf höchstens 512 Pixel Kantenlänge und vergrößert nie', () => {
    expect(fitWithin(2048, 1024, 512)).toEqual({ width: 512, height: 256 });
    expect(fitWithin(900, 1600, 512)).toEqual({ width: 288, height: 512 });
    expect(fitWithin(300, 200, 512)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(4000, 3, 512)).toEqual({ width: 512, height: 1 });
  });
});

describe('Beispielwelt', () => {
  it('enthält die Einträge, auf die sich diese Tests stützen', () => {
    expect(entitiesOfKind(data, 'person')).toHaveLength(6);
  });
});

describe('Ergänzungen der Prüfung', () => {
  const data = demoCampaign();
  const find = (name: string) => Object.values(data.entities).find((e) => e.name === name)!;

  it('führt mit den Pfeiltasten durch die Übersicht und bleibt an den Enden stehen', () => {
    expect(listKeyMove('ArrowDown')).toBe('down');
    expect(listKeyMove('ArrowUp')).toBe('up');
    expect(listKeyMove('Home')).toBe('first');
    expect(listKeyMove('End')).toBe('last');
    expect(listKeyMove('a')).toBeNull();
    expect(nextRowIndex(0, 5, 'down')).toBe(1);
    expect(nextRowIndex(4, 5, 'down')).toBe(4);
    expect(nextRowIndex(0, 5, 'up')).toBe(0);
    expect(nextRowIndex(3, 5, 'first')).toBe(0);
    expect(nextRowIndex(1, 5, 'last')).toBe(4);
    expect(nextRowIndex(0, 0, 'down')).toBe(-1);
  });

  it('erkennt, ob im Dialog etwas eingetragen wurde – die Art allein zählt nicht', () => {
    const empty = emptyDraft('person', { placeId: 'x' });
    expect(draftChanged(empty, empty)).toBe(false);
    expect(draftChanged({ ...empty, kind: 'place' }, empty)).toBe(false);
    expect(draftChanged({ ...empty, name: 'Jorun' }, empty)).toBe(true);
    expect(draftChanged({ ...empty, placeId: null }, empty)).toBe(true);
    const maera = find('Maera Duskryn');
    if (!isWorldEntity(maera)) throw new Error('Maera fehlt');
    const stored = draftOf(maera);
    expect(draftChanged(draftOf(maera), stored)).toBe(false);
    expect(draftChanged({ ...stored, met: false }, stored)).toBe(true);
  });

  it('kürzt tiefe Pfade und rückt tiefe Ebenen im Baum weniger ein', () => {
    expect(shortPath(['a', 'b', 'c', 'd'])).toEqual({ ids: ['a', 'b', 'c', 'd'] });
    expect(shortPath(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual({
      ids: ['a', 'd', 'e', 'f'],
      skipped: 2,
    });
    expect([0, 1, 4, 5, 9].map(treeIndent)).toEqual([6, 22, 70, 78, 110]);
    expect(isLongName('Maera Duskryn')).toBe(false);
    expect(isLongName('Großherzogliche Freie und Hansestadt Ödmarschen')).toBe(true);
    // Ein tief verschachtelter Ort nennt die oberste und die drei nächsten Ebenen.
    let world = data;
    let parentId = find('Dornhafen').id;
    for (let depth = 0; depth < 5; depth++) {
      const place = createEntity({ kind: 'place', name: `Ebene ${depth}`, place: { parentId } });
      world = { ...world, entities: { ...world.entities, [place.id]: place } };
      parentId = place.id;
    }
    const fact = entityFacts(world, world.entities[parentId]!).find((f) => f.label === 'Liegt in')!;
    expect(fact.ids).toHaveLength(4);
    expect(fact.ids![0]).toBe(find('Nebelküste').id);
    expect(fact.skipped).toBe(2);
  });

  it('liest eigene Bezeichnungen nie verkehrt herum', () => {
    const maera = find('Maera Duskryn');
    const voss = find('Hauptmann Voss');
    const haus = find('Haus Duskryn');
    const moor = find('Krähenmoor');
    const custom = (from: string, to: string, label: string) =>
      createRelation({ from, to, type: 'custom', label });
    const extort = custom(find('Kessa Flutwind').id, maera.id, 'erpresst');
    const pays = custom(haus.id, find('Isolde Rabenschwinge').id, 'bezahlt heimlich');
    const swallows = custom(moor.id, voss.id, 'verschlang die Patrouille von');
    const next = {
      ...data,
      relations: {
        ...data.relations,
        [extort.id]: extort,
        [pays.id]: pays,
        [swallows.id]: swallows,
      },
    };
    // Von der Erpressten aus gesehen steht der ganze Satz da.
    const seen = relationRows(next, maera.id).find((r) => r.otherId === extort.from)!;
    expect(seen.label).toBe('Kessa Flutwind erpresst Maera Duskryn');
    expect(seen.inverseLabel).toBe(seen.label);
    // Von der Erpresserin aus bleibt es beim Satzteil.
    const own = relationRows(next, extort.from).find((r) => r.otherId === maera.id)!;
    expect(own.label).toBe('erpresst');
    // Frei formulierte Bezeichnungen werden nicht in Versalien gesetzt.
    expect(seen.freeText).toBe(true);
    expect(own.freeText).toBe(true);
    expect(relationRows(next, maera.id).find((r) => r.otherId === voss.id)!.freeText).toBe(false);
    const member = groupMembers(next, haus.id).find((m) => m.entity.name.startsWith('Isolde'))!;
    expect(member.label).toBe('Haus Duskryn bezahlt heimlich Isolde Rabenschwinge');
    const link = placeCast(next, moor.id).linked.find((l) => l.entity.id === voss.id)!;
    expect(linkedSubline(next, moor.id, link)).toBe(
      'Krähenmoor verschlang die Patrouille von Hauptmann Voss',
    );
  });

  it('beginnt den Beziehungsdialog in der Richtung, die es schon gibt', () => {
    const out = createRelation({ from: 'a', to: 'b', type: 'serves' });
    const back = createRelation({ from: 'b', to: 'a', type: 'knows' });
    expect(startDirection(null, null)).toBe('out');
    expect(startDirection(null, null, 'in')).toBe('in');
    expect(startDirection(out, null, 'in')).toBe('out');
    expect(startDirection(null, back)).toBe('in');
    expect(startDirection(out, back, 'in')).toBe('in');
  });

  it('trägt ein neues Mitglied vom Mitglied aus ein, ohne Vorhandenes zu überschreiben', () => {
    const fresh = relationDrafts(null, null, true);
    expect(fresh.in.type).toBe('member');
    expect(fresh.out.type).toBe('knows');
    const serves = createRelation({ from: 'b', to: 'a', type: 'serves', attitude: 1 });
    const loaded = relationDrafts(null, serves, true);
    expect(loaded.in).toMatchObject({ type: 'serves', attitude: 1 });
    expect(relationDrafts(null, null).in.type).toBe('knows');
  });

  it('schreibt beim Speichern nur Richtungen, die es geben soll', () => {
    const untouched = relationDraft();
    const existing = createRelation({ from: 'a', to: 'b', type: 'serves' });
    // Ganz neue Beziehung: was zu sehen ist, wird angelegt – auch mit den Vorgaben.
    expect(savesDirection(untouched, null, { active: true, pairExists: false })).toBe(true);
    // Die Gegenrichtung, die niemand angesehen hat, bleibt leer.
    expect(savesDirection(untouched, null, { active: false, pairExists: false })).toBe(false);
    // Besteht schon eine Richtung, entsteht die andere nicht durch bloßes Hineinsehen.
    expect(savesDirection(untouched, null, { active: true, pairExists: true })).toBe(false);
    expect(
      savesDirection({ ...untouched, type: 'fears' }, null, { active: false, pairExists: true }),
    ).toBe(true);
    // Vorhandenes wird nur geschrieben, wenn sich etwas geändert hat.
    expect(
      savesDirection(relationDraft(existing), existing, { active: true, pairExists: true }),
    ).toBe(false);
    expect(
      savesDirection({ ...relationDraft(existing), ended: true }, existing, {
        active: true,
        pairExists: true,
      }),
    ).toBe(true);
  });
});

describe('Arten in der Liste', () => {
  it('stellt die üblichen Arten zuerst, die seltenen unter „Mehr“ – ohne leere', () => {
    const counts = Object.fromEntries(WORLD_KINDS.map((kind) => [kind, 0])) as Record<
      (typeof WORLD_KINDS)[number],
      number
    >;
    counts.person = 3;
    counts.place = 2;
    counts.language = 1;
    counts.plant = 4;
    expect(kindSections(counts)).toEqual({
      common: ['place', 'person'],
      rare: ['language', 'plant'],
    });
  });
});
