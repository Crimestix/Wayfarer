/**
 * Übernahme der alten Version (v157). Die Fixtures unter __fixtures__ stammen aus den Modulen der
 * alten Version selbst (make-fixtures.mjs) und sind dort mit validateCampaign geprüft; die
 * Inhalte sind erfunden.
 */
import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../../data/db';
import { MemoryStore } from '../../../data/store';
import {
  attitudeHistory,
  attitudeToParty,
  entitiesOfKind,
  findRelation,
  openPromises,
  partyStays,
  placePath,
  placeStatus,
  runningTimers,
  upcomingOccurrences,
  visitsTo,
} from '../../../domain/derive';
import {
  COLLECTION_NAMES,
  COLLECTION_SCHEMAS,
  CampaignMetaSchema,
  PARTY_ID,
  PlayStateSchema,
  type CampaignData,
  type Entity,
  type EntityKind,
  type EntityOf,
} from '../../../domain/schema';
import {
  MINUTES_PER_DAY,
  formatClock,
  formatDate,
  formatDateTime,
  fromTime,
  moonPhase,
  toTime,
} from '../../../domain/time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../../../domain/time/elaris';
import minimalBackup from '../__fixtures__/v157-minimal.json';
import fullBackup from '../__fixtures__/v157-voll.json';
import legacyTime from '../__fixtures__/v157-zeit.json';
import { repairReferences } from '../integrity';
import {
  LEGACY_OPINIONS,
  LEGACY_PARTY,
  importV157Backup,
  lastImport,
  opinionToAttitude,
  previewV157Backup,
  rememberImport,
} from '../v157';

type Legacy = Record<string, unknown> & typeof fullBackup;
const full = (): Legacy => structuredClone(fullBackup) as Legacy;
const T0 = legacyTime.initial;
const DAY = MINUTES_PER_DAY;

const byName = <K extends EntityKind>(data: CampaignData, kind: K, name: string): EntityOf<K> => {
  const hit = entitiesOfKind(data, kind).find((e) => e.name === name);
  if (!hit) throw new Error(`${kind} „${name}“ fehlt`);
  return hit;
};

/** Jedes Dokument muss durch sein Schema gehen und unter seiner eigenen Kennung liegen. */
function expectValid(data: CampaignData) {
  expect(CampaignMetaSchema.parse(data.campaign)).toEqual(data.campaign);
  expect(PlayStateSchema.parse(data.state)).toEqual(data.state);
  for (const name of COLLECTION_NAMES) {
    const seen = new Set<string>();
    for (const [key, doc] of Object.entries(data[name])) {
      expect(COLLECTION_SCHEMAS[name].parse(doc)).toEqual(doc);
      expect(doc.id).toBe(key);
      expect(doc.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      // Dateinamen: auf macOS und Windows zählt Groß-/Kleinschreibung nicht.
      expect(seen.has(doc.id.toLowerCase())).toBe(false);
      seen.add(doc.id.toLowerCase());
      expect(doc.id).not.toMatch(/^(con|prn|aux|nul|com[1-9]|lpt[1-9]|party)$/i);
    }
  }
  expect(repairReferences(data).repaired).toBe(0);
}

describe('Weltzeit: alte und neue Version rechnen gleich', () => {
  it('der Startpunkt der alten Version ist der Elaris-Start der neuen', () => {
    expect(legacyTime.initial).toBe(ELARIS_START);
  });

  it('jedes Datum der alten Zeitrechnung ergibt in der neuen dieselbe Minutenzahl – und umgekehrt', () => {
    expect(legacyTime.samples.length).toBeGreaterThan(250);
    const era = ELARIS_CALENDAR.eras[0]!;
    for (const s of legacyTime.samples) {
      const parts = {
        year: s.year + era.offset,
        month: s.month,
        day: s.day,
        hour: s.hour,
        minute: s.minute,
      };
      expect(toTime(ELARIS_CALENDAR, parts)).toBe(s.stamp);
      const back = fromTime(ELARIS_CALENDAR, s.stamp);
      expect(back).toMatchObject({ ...parts, year: s.cosmic, weekday: s.weekday });
      // Auch die Anzeige stimmt überein: „17. Tauwind 701 AD“ und „16:00“.
      expect(formatDate(ELARIS_CALENDAR, s.stamp)).toBe(s.label);
      expect(formatClock(s.stamp)).toBe(s.clock);
    }
  });

  it('die Monde haben dieselbe Umlaufzeit und denselben Bezugspunkt', () => {
    expect(
      ELARIS_CALENDAR.moons.map(({ id, period, anchor }) => ({ id, period, shift: anchor })),
    ).toEqual(legacyTime.moons);
  });

  it('übernimmt die aktuelle Weltzeit und den letzten Zeitsprung unverändert', () => {
    const { data } = importV157Backup(full());
    expect(data.state.now).toBe(fullBackup.now);
    expect(data.state.previousNow).toBe(fullBackup.previous);
    expect(formatDateTime(data.campaign.calendar, data.state.now)).toBe(
      '19. Tauwind 701 AD, 21:00',
    );
  });
});

describe('Vollständiges Backup', () => {
  const result = importV157Backup(full());
  const data = result.data;

  it('ergibt einen Spielstand, der durch alle Schemata geht und sich speichern und wieder laden lässt', async () => {
    expectValid(data);
    const store = new MemoryStore();
    const db = await CampaignDb.create(store, data);
    const reopened = await CampaignDb.open(store);
    expect(reopened.problems).toEqual([]);
    expect(reopened.getSnapshot()).toEqual(db.getSnapshot());
    expect(data.campaign.name).toBe('Elaris');
    expect(data.campaign.calendar.months.map((m) => m.name)).toEqual(
      ELARIS_CALENDAR.months.map((m) => m.name),
    );
  });

  it('übernimmt die Orte mit Gliederung, Beschreibung, Schlagworten und LegendKeeper-Verknüpfung', () => {
    const places = entitiesOfKind(data, 'place');
    expect(places.map((p) => p.name)).toEqual([
      'Alte Salzstraße',
      'Aschenmark',
      'Hohenfurt',
      'Verlassene Mühle',
      'Wachturm Graufels',
      'Zum Lahmen Eber',
    ]);
    expect(placePath(data, byName(data, 'place', 'Zum Lahmen Eber').id)).toBe(
      'Aschenmark › Hohenfurt › Zum Lahmen Eber',
    );
    const mark = byName(data, 'place', 'Aschenmark');
    expect(mark).toMatchObject({
      aliases: ['Die Mark'],
      tags: ['Grenzland'],
      place: { category: 'Grafschaft' },
    });
    expect(mark.notes).toBe(
      'Karges Hügelland zwischen Fluss und Salzsümpfen.\n\nEinordnung: Territorium',
    );
    expect(byName(data, 'place', 'Hohenfurt').lk).toEqual({
      resourceId: 'lkres-hohenfurt',
      title: '',
    });
    expect(byName(data, 'place', 'Alte Salzstraße').place.category).toBe('Reiseabschnitt');
    // Alte Kennungen bleiben erhalten, wo sie gültig sind.
    expect(mark.id).toBe('p-mark');
  });

  it('macht ungültige Kennungen gültig und schreibt die Verweise darauf um', () => {
    const muehle = byName(data, 'place', 'Verlassene Mühle');
    expect(muehle.id).toBe('Ort-7-M-hle-alt');
    expect(muehle.place.parentId).toBe('p-mark');
  });

  it('setzt räumliche Zuordnungen der Weltdatenbank als übergeordneten Ort', () => {
    // „Aschenmark enthält Wachturm Graufels“ – der Turm hatte keinen Navigations-Elternort.
    expect(placePath(data, byName(data, 'place', 'Wachturm Graufels').id)).toBe(
      'Aschenmark › Wachturm Graufels',
    );
  });

  it('leitet aus den Besuchen die Ortswechsel der Chronik und den Aufenthaltsort ab', () => {
    const turm = byName(data, 'place', 'Wachturm Graufels');
    const eber = byName(data, 'place', 'Zum Lahmen Eber');
    const strasse = byName(data, 'place', 'Alte Salzstraße');
    const hohenfurt = byName(data, 'place', 'Hohenfurt');
    expect(data.state.placeId).toBe(turm.id);
    expect(partyStays(data)).toEqual([
      { placeId: hohenfurt.id, from: T0 - 3 * DAY, to: T0 - 60 },
      { placeId: eber.id, from: T0 - 60, to: T0 + DAY + 9 * 60 },
      // Verfolgte Reise: unterwegs der Reiseabschnitt, bei Ablauf des Timers der Ankunftsort.
      { placeId: strasse.id, from: T0 + DAY + 9 * 60, to: T0 + DAY + 15 * 60 },
      { placeId: turm.id, from: T0 + DAY + 15 * 60, to: T0 + 2 * DAY },
      // Dazwischen war der Aufenthaltsort eine Stunde lang offen.
      { placeId: turm.id, from: T0 + 2 * DAY + 60, to: null },
    ]);
    // Die Taverne liegt in der Stadt: beides zusammen ist ein Besuch von Hohenfurt.
    expect(visitsTo(data, hohenfurt.id)).toEqual([
      { placeId: hohenfurt.id, from: T0 - 3 * DAY, to: T0 + DAY + 9 * 60 },
    ]);
    expect(placeStatus(data, turm.id).here).toBe(true);
    expect(placeStatus(data, hohenfurt.id).lastLeft).toBe(T0 + DAY + 9 * 60);
    const arrival = Object.values(data.chronicle).find(
      (e) => e.kind === 'travel' && e.at === T0 + DAY + 15 * 60,
    )!;
    expect(arrival.text).toBe('Ankunft: Reise nach Graufels');
    expect(arrival.travel).toEqual({ fromId: strasse.id, toId: turm.id });
  });

  it('legt die sechs Gefährten mit den Werten an, die das neue Modell kennt', () => {
    const party = entitiesOfKind(data, 'character');
    expect(party.map((c) => c.name).sort()).toEqual(LEGACY_PARTY.map((p) => p.name).sort());
    const tomlin = byName(data, 'character', 'Tomlin');
    expect(tomlin.id).toBe('tomlin');
    expect(tomlin.character).toMatchObject({
      className: 'Magier · Illusion',
      level: 7,
      armorClass: 13,
      passivePerception: 12,
      passiveInvestigation: 18,
      passiveInsight: 12,
      languages: ['Gemeinsprache', 'Elfisch'],
      exhaustion: 2,
      active: true,
      placeId: null,
    });
    expect(tomlin.image).toMatch(/^data:image\/png;base64,/);
    // Was das neue Modell nicht als Feld kennt, steht lesbar in den Notizen.
    expect(tomlin.notes).toBe(
      [
        'Trägt das Buch der Schleier bei sich.',
        '',
        'Zauberrettungs-SG: 16',
        'Übung: Arkane Kunde (Fertigkeit, Expertise, +10)',
        'Übung: Intelligenz (Rettungswurf, geübt, +7)',
        'Übung: Kalligrafenwerkzeug (Werkzeug, geübt)',
        'Frühere Aufenthalte abseits der Gruppe:',
        '– 14. Tauwind 701 AD, 16:00 Uhr: Hohenfurt',
        '– 17. Tauwind 701 AD, 18:00 Uhr: Bibliothek der Furt',
      ].join('\n'),
    );
    // Ohne eigene Werte gilt, was die alte Version anzeigte: feste Klasse und Stufe 6.
    expect(byName(data, 'character', 'Corrin').character).toMatchObject({
      className: 'Barde · College of Dance',
      level: 6,
      armorClass: null,
    });
    // Ein Bild, das nur ein Link war, wird nicht als Bild übernommen.
    const neil = byName(data, 'character', 'Neil');
    expect(neil.image).toBeNull();
    expect(neil.notes).toBe('Bild (Link): https://beispiel.invalid/neil.webp');
  });

  it('arbeitet Stammdaten eines Gefährten aus der Weltdatenbank in dessen Eintrag ein', () => {
    const veres = byName(data, 'character', 'Veres');
    expect(veres.character).toMatchObject({ species: 'Halbelf', armorClass: 19 });
    expect(veres.notes).toBe(
      'Schwur am Furtstein.\n\nAufgewachsen an der Furt.\n\nHeimat: Hohenfurt',
    );
    expect(entitiesOfKind(data, 'person').some((p) => p.name === 'Veres')).toBe(false);
  });

  it('übernimmt Personen, Fraktionen und Themen der Weltdatenbank', () => {
    const ardo = byName(data, 'person', 'Ardo Venn');
    const turm = byName(data, 'place', 'Wachturm Graufels');
    const hohenfurt = byName(data, 'place', 'Hohenfurt');
    expect(ardo).toMatchObject({
      aliases: ['Der Graue', 'Venn'],
      tags: ['Wacht'],
      lk: null,
      person: {
        species: 'Mensch',
        role: 'Hauptmann der Wacht',
        status: 'alive',
        placeId: turm.id,
        homeId: hohenfurt.id,
        met: true,
      },
    });
    expect(ardo.image).toMatch(/^data:image\/png/);
    expect(ardo.notes).toBe(
      [
        'Müder Veteran, der den Turm nicht aufgeben will.',
        '',
        'Titel: Hauptmann',
        'Geschlecht: Männlich',
        'Geboren: 12. Sonnfeld 660 AD in Hohenfurt',
        'Fähigkeiten: Dunkelsicht',
        'Sprachen: Gemeinsprache, Zwergisch',
        'Schriften: Markrunen',
        'Zustand: Alte Beinwunde.',
        'Ziele: Den Turm halten, bis Ablösung kommt.',
      ].join('\n'),
    );
    expect(byName(data, 'person', 'Edda Venn').notes).toContain(
      'Geschätztes Alter: 70 Jahre (Stand 1. Erntfall 700 AD)',
    );
    expect(byName(data, 'person', 'Der Fährmann').person.met).toBe(false);

    expect(byName(data, 'faction', 'Graufelser Wacht')).toMatchObject({
      notes: 'Hält Turm und Furt.\n\nRollen: Hauptmann, Späher',
      faction: { category: 'Stadtwache', seatId: turm.id },
    });
    expect(byName(data, 'faction', 'Salzgilde').faction.seatId).toBe(hohenfurt.id);
    expect(byName(data, 'faction', 'Familie Venn').faction.category).toBe('Familie');
    expect(byName(data, 'topic', 'Halbelf')).toMatchObject({
      notes: 'Selten in der Mark.\n\nÜbergeordnete Spezies: Mensch\nLebenserwartung: 180 Jahre',
      topic: { category: 'Spezies' },
    });
    expect(entitiesOfKind(data, 'topic').map((t) => `${t.topic.category}: ${t.name}`)).toEqual([
      'Notiz: Abenteuerverlauf · Exploration',
      'Fähigkeit: Dunkelsicht',
      'Sprache: Gemeinsprache',
      'Notiz: Gerüchte in Hohenfurt',
      'Spezies: Halbelf',
      'Schrift: Markrunen',
      'Spezies: Mensch',
      'Sprache: Zwergisch',
    ]);
  });

  it('übersetzt die Beziehungen der Weltdatenbank in die Beziehungsarten des neuen Modells', () => {
    const id = (kind: EntityKind, name: string) => byName(data, kind, name).id;
    const rel = (from: string, to: string) => {
      const r = findRelation(data, from, to);
      if (!r) throw new Error(`Beziehung ${from} → ${to} fehlt`);
      return { type: r.type, label: r.label, note: r.note, attitude: r.attitude };
    };
    const ardo = id('person', 'Ardo Venn');
    const wacht = id('faction', 'Graufelser Wacht');
    expect(rel(ardo, wacht)).toEqual({
      type: 'member',
      label: '',
      note: 'Hauptmann',
      attitude: null,
    });
    expect(rel(ardo, id('faction', 'Familie Venn')).type).toBe('member');
    expect(rel(ardo, id('place', 'Wachturm Graufels'))).toMatchObject({
      type: 'resides',
      note: 'Arbeitsort',
    });
    expect(rel(id('person', 'Edda Venn'), ardo)).toMatchObject({
      type: 'family',
      note: 'Edda Venn ist die Mutter von Ardo Venn.',
    });
    expect(rel(id('person', 'Ilse Kornblum'), id('person', 'Der Fährmann'))).toMatchObject({
      type: 'custom',
      label: 'Vormundschaft',
      note: 'Ilse Kornblum betreut Der Fährmann.',
    });
    expect(rel(wacht, id('place', 'Aschenmark'))).toMatchObject({
      type: 'resides',
      note: 'Wirkungsgebiet',
    });
    expect(rel(wacht, id('faction', 'Salzgilde'))).toMatchObject({
      type: 'custom',
      label: 'verbunden mit',
    });
    expect(rel(id('faction', 'Zollstube'), id('faction', 'Salzgilde'))).toMatchObject({
      type: 'member',
      note: 'Teilorganisation',
    });
    expect(rel(id('place', 'Hohenfurt'), id('place', 'Aschenmark'))).toMatchObject({
      type: 'member',
      note: 'Politisch zugeordnet',
    });
    expect(rel(id('place', 'Alte Salzstraße'), id('place', 'Hohenfurt'))).toMatchObject({
      type: 'custom',
      label: 'verbunden mit',
    });
    // Der Sitz steht an der Fraktion, nicht als Beziehung.
    expect(findRelation(data, wacht, id('place', 'Wachturm Graufels'))).toBeUndefined();
    // Je Richtung gibt es höchstens eine Beziehung.
    const pairs = Object.values(data.relations).map((r) => `${r.from}→${r.to}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('bildet die alte Meinungsskala auf die Haltung ab – zur Gruppe und zu einzelnen Gefährten', () => {
    const ardo = byName(data, 'person', 'Ardo Venn');
    const ilse = byName(data, 'person', 'Ilse Kornblum');
    // Ardo (nur Weltdatenbank): Gruppe „Zuneigung“ (5) → +2, Tomlin „Abneigung“ (2) → −2.
    expect(attitudeToParty(data, ardo.id)).toBe(2);
    expect(findRelation(data, ardo.id, 'tomlin')?.attitude).toBe(-2);
    // Ilse (LegendKeeper-NPC mit Stammdaten): Gruppe 4 → +1; Tomlin 5 → +2, Neil 3 → −1 aus npcOpinions.
    expect(ilse.lk).toEqual({ resourceId: 'lkres-ilse', title: '' });
    expect(ilse.person.met).toBe(true);
    expect(attitudeToParty(data, ilse.id)).toBe(1);
    expect(findRelation(data, ilse.id, 'tomlin')?.attitude).toBe(2);
    expect(findRelation(data, ilse.id, 'neil')?.attitude).toBe(-1);
    expect(findRelation(data, ilse.id, 'veres')).toBeUndefined();
  });

  it('legt Personen an, die es nur als LegendKeeper-Verweis gab – ohne Namen zu erfinden', () => {
    const unnamed = entitiesOfKind(data, 'person').filter((p) => p.tags.includes('Name fehlt'));
    expect(unnamed.map((p) => p.lk?.resourceId).sort()).toEqual([
      'lkres-bote',
      'lkres-fremder',
      'lkres-zoellner',
    ]);
    for (const p of unnamed)
      expect(p.name).toBe(`Person aus LegendKeeper (${p.lk!.resourceId.slice(0, 8)})`);
    // „Der Gruppe bekannt“ war eine eigene Angabe der alten Version – unabhängig von Meinungen.
    expect(Object.fromEntries(unnamed.map((p) => [p.lk!.resourceId, p.person.met]))).toEqual({
      'lkres-bote': true,
      'lkres-fremder': true,
      'lkres-zoellner': false,
    });
    // „lkres-geruecht“ stand nur als „nicht bekannt“ im Backup: dafür entsteht kein Eintrag.
    expect(Object.values(data.entities).some((e) => e.lk?.resourceId === 'lkres-geruecht')).toBe(
      false,
    );
    // Alle sechs Gefährten hatten dieselbe Meinung (2 „Abneigung“): das ist die Haltung zur Gruppe.
    const fremder = unnamed.find((p) => p.lk!.resourceId === 'lkres-fremder')!;
    expect(attitudeToParty(data, fremder.id)).toBe(-2);
    expect(Object.values(data.relations).filter((r) => r.from === fremder.id)).toHaveLength(1);
    // Beim Zöllner wurde die einzige Meinung zurückgenommen: keine Beziehung, aber der Verlauf bleibt.
    const zoellner = unnamed.find((p) => p.lk!.resourceId === 'lkres-zoellner')!;
    expect(Object.values(data.relations).some((r) => r.from === zoellner.id)).toBe(false);
    expect(
      attitudeHistory(data, zoellner.id, 'corrin').map((e) => [
        e.attitude!.before,
        e.attitude!.after,
      ]),
    ).toEqual([
      [null, 3],
      [3, null],
    ]);
  });

  it('hält den Verlauf der Haltung als Chronik fest', () => {
    const ilse = byName(data, 'person', 'Ilse Kornblum');
    const history = attitudeHistory(data, ilse.id, 'tomlin');
    expect(history.map((e) => ({ at: e.at, text: e.text, ...e.attitude }))).toEqual([
      {
        at: T0 + 60,
        text: 'Tomlin hat die Zeche bezahlt.',
        fromId: ilse.id,
        toId: 'tomlin',
        before: null,
        after: 1,
      },
      {
        at: T0 + DAY,
        text: 'Er hat ihren Sohn geheilt.',
        fromId: ilse.id,
        toId: 'tomlin',
        before: 1,
        after: 2,
      },
    ]);
    expect(history[0]!.refs).toEqual([ilse.id, 'tomlin']);
    // Die echte Entstehungszeit bleibt für die Reihenfolge erhalten.
    expect(history[0]!.created).toBe(new Date(1760000100000).toISOString());
    const fremder = Object.values(data.entities).find((e) => e.lk?.resourceId === 'lkres-fremder')!;
    expect(
      attitudeHistory(data, fremder.id, PARTY_ID).map((e) => [
        e.attitude!.before,
        e.attitude!.after,
        e.refs,
      ]),
    ).toEqual([
      [null, -1, [fremder.id]],
      [-1, -2, [fremder.id]],
    ]);
  });

  it('übernimmt Notizen und Abmachungen der Dossiers mit Frist und Erledigt-Status', () => {
    const ilse = byName(data, 'person', 'Ilse Kornblum');
    const fremder = Object.values(data.entities).find((e) => e.lk?.resourceId === 'lkres-fremder')!;
    const note = Object.values(data.chronicle).find((e) => e.kind === 'note')!;
    expect(note).toMatchObject({
      text: 'Ilse kennt den alten Schmugglerpfad.',
      at: T0 + 70,
      refs: [ilse.id],
      promise: null,
    });
    const open = openPromises(data);
    expect(open.map((e) => e.text)).toEqual([
      'Schuld: 12 Goldstücke Spielschuld.',
      'Zusage: Nachricht von ihrem Bruder aus Graufels mitbringen.',
      'Gefallen: Ein freies Zimmer, wann immer sie zurückkehren.',
    ]);
    expect(open[0]).toMatchObject({
      refs: [fremder.id, 'neil'],
      promise: { due: fullBackup.now - DAY, done: false },
    });
    expect(open[1]).toMatchObject({
      refs: [ilse.id, 'tomlin', 'veres'],
      promise: { due: fullBackup.now + 5 * DAY, done: false },
    });
    // Betraf es die ganze Gruppe, steht nur die Person in den Beteiligten.
    expect(open[2]).toMatchObject({ refs: [ilse.id], promise: { due: null, done: false } });
    const done = Object.values(data.chronicle).filter((e) => e.promise?.done);
    expect(done.map((e) => e.text)).toEqual(['Schweigen über den Vorfall am Würfeltisch.']);
    expect(openPromises(data, ilse.id)).toHaveLength(2);
  });

  it('übernimmt Termine mit Art, Uhrzeit, Wiederholung, Dauer, Ort und Erledigt-Haken', () => {
    const event = (title: string) => Object.values(data.events).find((e) => e.title === title)!;
    expect(Object.keys(data.events)).toHaveLength(6);
    expect(event('Salzmarkt in Hohenfurt')).toMatchObject({
      id: 'markt',
      kind: 'world',
      timed: false,
      durationDays: 3,
      repeat: { every: 1, unit: 'month' },
      placeId: byName(data, 'place', 'Hohenfurt').id,
      details: 'Drei Tage Markt auf dem Furtplatz.',
      done: false,
    });
    expect(event('Treffen mit Ardo Venn am Turm')).toMatchObject({
      kind: 'plan',
      timed: true,
      at: toTime(ELARIS_CALENDAR, { year: 701 + 27387, month: 0, day: 20, hour: 18, minute: 30 }),
      placeId: byName(data, 'place', 'Wachturm Graufels').id,
      repeat: null,
      durationDays: null,
    });
    expect(event('Wachwechsel am Tor').repeat).toEqual({ every: 2, unit: 'week' });
    expect(event('Zoll bezahlen').done).toBe(true);
    expect(event('Der Graue Fang legt ab')).toMatchObject({
      id: 'grauer-fang',
      kind: 'world',
      timed: false,
      done: false,
    });
    // Die Termine greifen in der neuen Kalenderrechnung: heute der Graue Fang, morgen das Treffen,
    // in drei Tagen der Markt.
    expect(upcomingOccurrences(data, 4).map((o) => o.event.title)).toEqual([
      'Der Graue Fang legt ab',
      'Treffen mit Ardo Venn am Turm',
      'Salzmarkt in Hohenfurt',
    ]);
  });

  it('macht aus Notizen mit dem Titel „Session …“ Sessions und aus den übrigen Themen', () => {
    const sessions = Object.values(data.sessions).sort((a, b) => a.number - b.number);
    expect(sessions).toMatchObject([
      {
        id: 'session12',
        number: 12,
        title: '',
        startAt: T0,
        endAt: T0 + DAY + 8 * 60,
        notes:
          'Ankunft in Hohenfurt. Die Wache am Tor war nervös.\n\nIlse Kornblum bot ein Zimmer an.',
      },
      {
        id: 'session13',
        number: 13,
        title: 'Der Turm im Nebel',
        startAt: T0 + DAY + 8 * 60,
        endAt: null,
        notes: 'Aufbruch zur Salzstraße.',
      },
    ]);
    expect(data.state.sessionId).toBe('session13');
    const rumours = byName(data, 'topic', 'Gerüchte in Hohenfurt');
    expect(rumours).toMatchObject({
      notes: 'Im Lahmen Eber heißt es, der Turm sei seit dem Winter unbesetzt.',
      tagline: 'Notiz aus der alten Version, angelegt am 17. Tauwind 701 AD.',
      topic: { category: 'Notiz' },
    });
    // Sessions und Termine dürfen dieselbe alte Kennung tragen – sie liegen in getrennten Sammlungen.
    expect(data.events.session12?.title).toBe('Session 12');
  });

  it('ordnet Chronikeinträge der Session zu, in deren Zeitraum sie fallen', () => {
    for (const entry of Object.values(data.chronicle)) {
      const expected =
        entry.at < T0 ? null : entry.at < T0 + DAY + 8 * 60 ? 'session12' : 'session13';
      expect(entry.sessionId).toBe(expected);
    }
    expect(Object.values(data.chronicle).filter((e) => e.sessionId === null)).toHaveLength(2);
  });

  it('übernimmt Timer mit Art, Beteiligten und Status', () => {
    const timer = (label: string) => Object.values(data.timers).find((t) => t.label === label)!;
    expect(Object.keys(data.timers)).toHaveLength(4);
    expect(timer('Unsichtbarkeit')).toMatchObject({
      kind: 'effect',
      start: fullBackup.now - 20,
      end: fullBackup.now + 40,
      refs: ['naelmira'],
      note: 'Wirkender: Tomlin · Ziel / Ort: Naelmira · Konzentration',
      done: false,
    });
    expect(timer('Ritual: Magie entdecken')).toMatchObject({
      kind: 'task',
      refs: ['nex'],
      note: 'Ausführend: Nex · Vorzeitig beendet am 17. Tauwind 701 AD, 16:15 Uhr',
      done: true,
    });
    // Ganze Gruppe: keine einzelnen Beteiligten. Abgelaufen: erledigt.
    expect(timer('Reise nach Graufels')).toMatchObject({
      kind: 'task',
      refs: [],
      note: 'Reise · Ziel / Ort: Wachturm Graufels',
      done: true,
    });
    expect(runningTimers(data).map((t) => t.label)).toEqual(['Fackel', 'Unsichtbarkeit']);
  });

  it('übernimmt die Mond-Kalibrierung in den Kalender', () => {
    const [caldus, damaros] = data.campaign.calendar.moons;
    expect(caldus!.anchor).toBe(fullBackup.sky.caldus);
    expect(damaros!.anchor).toBe(ELARIS_CALENDAR.moons[1]!.anchor);
    // Am kalibrierten Zeitpunkt ist Neumond.
    expect(moonPhase(caldus!, fullBackup.sky.caldus).label).toBe('Neumond');
  });

  it('berichtet in ganzen Sätzen mit Zahlen, was übernommen wurde', () => {
    const { adopted, hints } = result.sections;
    expect(adopted).toEqual([
      'Die Weltzeit steht auf dem 19. Tauwind 701 AD, 21:00 Uhr.',
      '6 Orte wurden mit Gliederung, Beschreibung und Schlagworten übernommen, 1 davon mit Verknüpfung zu einem LegendKeeper-Artikel.',
      'Aus der Weltdatenbank: 4 Fraktionen (davon 1 Familie) und 6 Themen (Spezies, Fähigkeiten, Sprachen und Schriften).',
      'Die 6 Gefährten wurden angelegt; für 3 von ihnen standen Werte im Backup (Klasse, Stufe, Rüstungsklasse, passive Werte, Sprachen, Erschöpfung, Bild). Zauberrettungs-SG, Übungen und frühere Aufenthalte stehen als Text in ihren Notizen.',
      '4 Personen wurden aus der Weltdatenbank übernommen – mit Beruf, Spezies, Heimat und Aufenthaltsort; Titel, Geburt, Alter, Zustand und Ziele stehen als Text in den Notizen.',
      'Die Stammdaten von 1 Gefährten aus der Weltdatenbank wurden in dessen Eintrag eingearbeitet.',
      'Verknüpfungen der Weltdatenbank: 9 Beziehungen (Mitgliedschaften, Familie, Wirkungsgebiete, Verbindungen), 2 Sitze von Fraktionen und 1 räumliche Zuordnung als übergeordneter Ort.',
      '3 Personen kannte die alte Version nur als Verweis auf einen LegendKeeper-Artikel. Sie wurden mit dieser Verknüpfung angelegt und tragen das Schlagwort „Name fehlt“, weil der Name nicht im Backup steht. Steht die Verbindung zu LegendKeeper, holt ein Klick in den Einstellungen unter „Alten Spielstand übernehmen“ die Namen nach.',
      'Haltungen: 3 gegenüber der Gruppe und 3 gegenüber einzelnen Gefährten.',
      'Aus den Dossiers stehen 1 Notiz und 4 Abmachungen (davon 1 erledigt) samt Fristen in der Chronik bei der jeweiligen Person. Zusagen, Schulden und Gefallen sind am Wort vor dem Text zu erkennen.',
      '6 Haltungsänderungen stehen mit Grund und Zeitpunkt in der Chronik und bilden den Verlauf bei der Person.',
      '4 Timer wurden übernommen (2 laufen noch); Wirkender, Ziel und Konzentration stehen in der Notiz.',
      '6 Ortswechsel der Gruppe stehen in der Chronik; daraus ergeben sich die Besuche der Orte. Die Gruppe ist jetzt in „Wachturm Graufels“.',
      '6 Termine wurden übernommen (davon 2 mit Wiederholung) – mit Art, Uhrzeit, Dauer, Ort und Erledigt-Haken.',
      '2 Sessions wurden aus den Notizen mit dem Titel „Session …“ angelegt, der Notiztext steht in der Mitschrift. Session 13 gilt als laufende Session.',
      '2 weitere Notizen wurden als Thema der Art „Notiz“ in die Welt übernommen, weil sie zu keiner Session gehören.',
      'Die Mond-Kalibrierung für Caldus wurde in den Kalender übernommen.',
    ]);
    // Die Zahlen des Berichts stimmen mit dem Ergebnis überein.
    expect(entitiesOfKind(data, 'place')).toHaveLength(6);
    expect(entitiesOfKind(data, 'faction')).toHaveLength(4);
    expect(entitiesOfKind(data, 'person')).toHaveLength(4 + 3);
    expect(Object.values(data.chronicle).filter((e) => e.kind === 'travel')).toHaveLength(6);
    expect(Object.values(data.chronicle).filter((e) => e.kind === 'attitude')).toHaveLength(6);
    expect(Object.values(data.relations).filter((r) => r.to === PARTY_ID)).toHaveLength(3);
    // Die Skala wird erklärt.
    expect(hints.join(' ')).toContain(
      'Hass → Feindselig (−3), Abneigung → Ablehnend (−2), Skepsis → Misstrauisch (−1), Wohlwollen → Wohlgesonnen (+1), Zuneigung → Freundlich (+2), Liebe → Ergeben (+3)',
    );
    expect(hints.join(' ')).toContain('„wichtig“ (1 Termin) und „lokales Ereignis“ (1 Termin)');
    // Tomlin hat ein eigenes Bild, Neil einen Link; die übrigen vier nutzten das mitgelieferte Porträt.
    expect(hints).toContain(
      '4 Gefährten zeigten in der alten Version das mitgelieferte Porträt. Es steht nicht im Backup; das Bild lässt sich im Bereich „Gefährten“ neu einfügen.',
    );
    expect(hints.join(' ')).toContain(
      '1 von ihnen gilt als getroffen, weil eine Meinung zur Gruppe oder zu Gefährten eingetragen war.',
    );
  });

  it('nennt klar, was nicht übernommen wurde, statt es zu erfinden', () => {
    expect(result.sections.omitted).toEqual([
      'Nicht übernommen: 1 gespeicherte Route, 3 Kartenanker, 1 Kartenzuordnung und 1 Kartenmaßstab – folgt mit dem Bereich Reisen.',
      'Nicht übernommen: 1 Erkundung mit Hexfeldern und Würfeltabellen – dafür gibt es im neuen Wayfarer noch keinen Bereich.',
      'Nicht übernommen: 1 protokollierte Rast mit Wachen und Schlafzeiten. Die Erschöpfung der Gefährten ist übernommen.',
      'Nicht übernommen: Stand und Notizen zu 2 Dungeonräumen.',
      'Nicht übernommen: 1 Einordnung von LegendKeeper-Artikeln (Tagging). Verknüpfte Artikel an Orten und Personen bleiben erhalten.',
      'Nicht übernommen: 1 Gewaltmarsch-Prüfung und die aufgelaufene Reisezeit der Gefährten – folgt mit dem Bereich Reisen.',
      'Nicht übernommen: der Link zum LegendKeeper-Projekt. Die Verbindung wird in den Einstellungen unter „LegendKeeper“ neu eingerichtet.',
    ]);
    expect(result.sections.skipped).toEqual([]);
    // Nichts davon taucht als erfundener Eintrag auf.
    const everything = JSON.stringify(data);
    for (const needle of [
      'Über die Salzstraße',
      'Durch die Salzsümpfe',
      'Eingangshalle',
      'beispielprojekt/startseite',
    ])
      expect(everything).not.toContain(needle);
  });

  it('der flache Bericht enthält alle Abschnitte in fester Reihenfolge, jede Zeile ein ganzer Satz', () => {
    const { adopted, hints, omitted, skipped } = result.sections;
    expect(result.report).toEqual([...adopted, ...hints, ...omitted, ...skipped]);
    for (const line of result.report) {
      expect(line.trim()).toBe(line);
      expect(line).toMatch(/^[A-ZÄÖÜ0-9].*[.“]$/);
      expect(line).not.toMatch(/undefined|null|NaN|\[object/);
    }
  });
});

describe('Unberührter Spielstand der alten Version', () => {
  const result = importV157Backup(structuredClone(minimalBackup));

  it('ergibt die sechs Gefährten, die laufende Session 12 und die beiden Start-Termine', () => {
    expectValid(result.data);
    const { data } = result;
    expect(data.state).toMatchObject({
      now: ELARIS_START + 90,
      previousNow: ELARIS_START,
      placeId: null,
    });
    expect(entitiesOfKind(data, 'character')).toHaveLength(6);
    expect(Object.keys(data.entities)).toHaveLength(6);
    expect(Object.values(data.sessions)).toMatchObject([
      { number: 12, startAt: ELARIS_START, endAt: null, notes: '' },
    ]);
    expect(data.state.sessionId).toBe(Object.keys(data.sessions)[0]);
    expect(
      Object.values(data.events)
        .map((e) => e.title)
        .sort(),
    ).toEqual(['Der Graue Fang legt ab', 'Session 12']);
    expect(data.campaign.calendar).toEqual(ELARIS_CALENDAR);
    expect(Object.keys(data.relations)).toHaveLength(0);
    expect(Object.keys(data.chronicle)).toHaveLength(0);
  });

  it('berichtet knapp und ohne leere Abschnitte', () => {
    expect(result.report).toEqual([
      'Die Weltzeit steht auf dem 17. Tauwind 701 AD, 17:30 Uhr.',
      'Die 6 Gefährten wurden angelegt – eigene Werte standen nicht im Backup, deshalb gelten Klasse und Stufe 6 wie in der alten Anzeige.',
      '2 Termine wurden übernommen – mit Art, Uhrzeit, Dauer, Ort und Erledigt-Haken.',
      '1 Session wurde aus den Notizen mit dem Titel „Session …“ angelegt, der Notiztext steht in der Mitschrift. Session 12 gilt als laufende Session.',
      '6 Gefährten zeigten in der alten Version das mitgelieferte Porträt. Es steht nicht im Backup; das Bild lässt sich im Bereich „Gefährten“ neu einfügen.',
    ]);
  });
});

describe('Meinungsskala', () => {
  it('bildet 1–6 auf −3…+3 ohne Mitte ab', () => {
    expect([1, 2, 3, 4, 5, 6].map(opinionToAttitude)).toEqual([-3, -2, -1, 1, 2, 3]);
    expect(LEGACY_OPINIONS).toHaveLength(6);
  });
  it('kennt „unbekannt“ und weist alles andere ab', () => {
    for (const value of [null, undefined, 0, 7, 2.5, '3', NaN])
      expect(opinionToAttitude(value)).toBeNull();
  });
});

describe('Reisen und Zeitsprünge', () => {
  it('lässt eine laufende Reise offen, statt die Ankunft vorwegzunehmen', () => {
    const backup = full();
    // Uhr auf „mitten in der Reise“: 18. Tauwind, 12:00.
    backup.now = T0 + DAY + 12 * 60;
    const { data, sections } = importV157Backup(backup);
    expectValid(data);
    expect(data.state.placeId).toBe(byName(data, 'place', 'Alte Salzstraße').id);
    expect(
      Object.values(data.chronicle).every((e) => e.at <= data.state.now || e.kind !== 'travel'),
    ).toBe(true);
    expect(sections.hints.join(' ')).toContain('Eine Reise der Gruppe läuft noch.');
    // Die beiden späteren Ortswechsel liegen jetzt in der Zukunft.
    expect(sections.hints.join(' ')).toContain('2 Ortswechsel lagen nach der aktuellen Weltzeit');
    expect(runningTimers(data).map((t) => t.label)).toContain('Reise nach Graufels');
  });

  it('führt die Gruppe nach einer abgebrochenen Reise an den Ausgangsort zurück', () => {
    const backup = full();
    const travel = backup.timers.find((t) => t.id === 't-reise')!;
    (travel as { stoppedAt: number | null }).stoppedAt = T0 + DAY + 11 * 60;
    backup.world.visits = backup.world.visits.filter((v) => v.id !== 'v4' && v.id !== 'v5');
    const { data } = importV157Backup(backup);
    expectValid(data);
    const eber = byName(data, 'place', 'Zum Lahmen Eber');
    expect(data.state.placeId).toBe(eber.id);
    const last = Object.values(data.chronicle)
      .filter((e) => e.kind === 'travel')
      .sort((a, b) => b.at - a.at)[0]!;
    expect(last).toMatchObject({
      at: T0 + DAY + 11 * 60,
      text: 'Reise abgebrochen: Reise nach Graufels',
    });
    expect(last.travel?.toId).toBe(eber.id);
  });

  it('behandelt einen Reise-Besuch ohne zugehörigen Timer wie einen gewöhnlichen Ortswechsel', () => {
    const backup = full();
    backup.timers = backup.timers.filter((t) => t.id !== 't-reise');
    backup.world.visits = backup.world.visits.filter((v) => v.id !== 'v4' && v.id !== 'v5');
    const { data } = importV157Backup(backup);
    expect(data.state.placeId).toBe(byName(data, 'place', 'Alte Salzstraße').id);
  });

  it('übernimmt den letzten Zeitsprung nur, wenn er vor der aktuellen Zeit liegt', () => {
    const backup = full();
    (backup as { previous: number | null }).previous = backup.now + 10;
    expect(importV157Backup(backup).data.state.previousNow).toBeNull();
    (backup as { previous: number | null }).previous = null;
    expect(importV157Backup(backup).data.state.previousNow).toBeNull();
  });
});

describe('Kennungen', () => {
  it('weicht reservierten, doppelten und zu langen Kennungen aus und hält alle Verweise zusammen', () => {
    const backup = full();
    const places = backup.world.places as {
      id: string;
      name: string;
      kind: string;
      parentId: string | null;
    }[];
    const long = 'x'.repeat(80);
    places.push(
      { id: 'party', name: 'Ort namens party', kind: 'site', parentId: null },
      { id: 'CON', name: 'Ort namens CON', kind: 'site', parentId: 'party' },
      { id: 'Abc', name: 'Großes Abc', kind: 'site', parentId: 'CON' },
      { id: 'abc', name: 'Kleines abc', kind: 'site', parentId: 'Abc' },
      { id: long, name: 'Langer Ort', kind: 'site', parentId: 'abc' },
      { id: 'ä ö/ü', name: 'Umlaut-Ort', kind: 'site', parentId: long },
    );
    backup.events.push({
      id: 'ä ö/ü',
      title: 'Fest am Umlaut-Ort',
      at: backup.now + 60,
      timed: true,
      kind: 'plan',
      details: '',
      done: false,
      locationId: 'ä ö/ü',
    } as never);
    backup.world.visits.push({ id: 'v6', at: backup.now, placeId: 'ä ö/ü' } as never);
    const { data } = importV157Backup(backup);
    expectValid(data);
    const umlaut = byName(data, 'place', 'Umlaut-Ort');
    expect(placePath(data, umlaut.id)).toBe(
      'Ort namens party › Ort namens CON › Großes Abc › Kleines abc › Langer Ort › Umlaut-Ort',
    );
    expect(byName(data, 'place', 'Ort namens party').id).not.toBe('party');
    expect(byName(data, 'place', 'Langer Ort').id).toBe('x'.repeat(64));
    expect(Object.values(data.events).find((e) => e.title === 'Fest am Umlaut-Ort')?.placeId).toBe(
      umlaut.id,
    );
    expect(data.state.placeId).toBe(umlaut.id);
  });
});

describe('Unbekanntes und Kaputtes', () => {
  it('lehnt Dateien ab, die kein Backup der alten Version sind', () => {
    for (const raw of [
      null,
      undefined,
      'text',
      42,
      [],
      {},
      { version: 2, notes: [], events: [] },
      { version: 1 },
    ])
      expect(() => importV157Backup(raw)).toThrow(
        /kein(en)? (Backup|Spielstand) der alten Wayfarer-Version/,
      );
    expect(() => importV157Backup({ format: 'wayfarer-sicherung', version: 1 })).toThrow(
      /Sicherung einspielen/,
    );
  });

  it('überspringt kaputte Einträge, nennt sie im Bericht und übernimmt den Rest', () => {
    const backup = full() as Record<string, unknown> & Legacy;
    const world = backup.world as unknown as Record<string, unknown[]> & {
      database: { records: Record<string, unknown[]>; relations: unknown[] };
    };
    world.places!.push(
      null,
      { id: 'ohne-namen', kind: 'site', parentId: null },
      { id: 'p-mark', name: 'Doppelte Mark', kind: 'region', parentId: null },
    );
    world.places!.push({ id: 'waise', name: 'Waise', kind: 'site', parentId: 'gibt-es-nicht' });
    world.visits!.push(
      { id: 'vx', at: T0 - DAY, placeId: 'gibt-es-nicht' },
      { id: 'vy', at: 'gestern', placeId: null },
    );
    world.database.records.characters!.push({ id: 'c-kaputt' }, 'kein Objekt');
    world.database.records.kreaturen = [{ id: 'k1', name: 'Grottenschrat' }];
    world.database.relations.push(
      { id: 'rx', type: 'membership', from: 'c-ardo', to: 'gibt-es-nicht' },
      { id: 'ry', type: 'zauber', from: 'c-ardo', to: 'o-wacht' },
    );
    (backup.events as unknown[]).push({ id: 'ohne-zeit', title: 'Ohne Zeit' }, 17, {
      id: 'markt',
      title: 'Doppelter Markt',
      at: T0,
      timed: false,
      kind: 'world',
      details: '',
      done: false,
    });
    (backup.timers as unknown[]).push(
      { id: 'rueckwaerts', name: 'Rückwärts', kind: 'effect', start: 20, end: 10 },
      null,
    );
    (backup.notes as unknown[]).push({ id: 'n-kaputt', title: 5, body: 'x' });
    (backup.dossierJournal as Record<string, unknown>).kaputt = {
      id: 'kaputt',
      kind: 'note',
      text: 'ohne Verweis',
      at: T0,
    };
    (backup.dossierJournal as Record<string, unknown>).raetsel = {
      id: 'raetsel',
      projectId: 'proj1',
      resourceId: 'lkres-ilse',
      kind: 'orakel',
      text: 'unbekannte Art',
      at: T0,
    };
    (backup.npcOpinions as Record<string, unknown>).proj2 = { 'lkres-x': { tomlin: 9, fremd: 3 } };
    (backup.characters as Record<string, unknown>).gast = { level: 3 };
    backup.wetter = { heute: 'Nebel' };

    const { data, sections, report } = importV157Backup(backup);
    expectValid(data);
    expect(sections.skipped.sort()).toEqual([
      'Übersprungen, weil unlesbar: 1 Beziehung der Weltdatenbank.',
      'Übersprungen, weil unlesbar: 1 Beziehung unbekannter Art.',
      'Übersprungen, weil unlesbar: 1 Gefährte mit unbekannter Kennung.',
      'Übersprungen, weil unlesbar: 1 Notiz.',
      'Übersprungen, weil unlesbar: 2 Dossiereinträge.',
      'Übersprungen, weil unlesbar: 2 Einträge der Weltdatenbank.',
      'Übersprungen, weil unlesbar: 2 Ortswechsel.',
      'Übersprungen, weil unlesbar: 2 Timer.',
      'Übersprungen, weil unlesbar: 3 Orte.',
      'Übersprungen, weil unlesbar: 3 Termine.',
    ]);
    expect(sections.omitted).toContain(
      'Nicht übernommen: unbekannte Kategorien der Weltdatenbank (kreaturen).',
    );
    expect(sections.omitted).toContain(
      'Nicht übernommen: unbekannte Bereiche des Backups (wetter).',
    );
    expect(report.join(' ')).not.toMatch(/undefined|NaN/);
    // Der Rest ist vollständig da.
    expect(entitiesOfKind(data, 'place').map((p) => p.name)).toContain('Waise');
    expect(byName(data, 'place', 'Waise').place.parentId).toBeNull();
    expect(byName(data, 'place', 'Aschenmark').place.category).toBe('Grafschaft');
    expect(Object.keys(data.events)).toHaveLength(6);
    expect(Object.keys(data.timers)).toHaveLength(4);
    expect(entitiesOfKind(data, 'character')).toHaveLength(6);
    expect(Object.values(data.entities).some((e) => e.lk?.resourceId === 'lkres-x')).toBe(false);
    expect(data.state.placeId).toBe(byName(data, 'place', 'Wachturm Graufels').id);
  });

  it('verkraftet ganze Bereiche mit falschem Aufbau', () => {
    const backup = full() as unknown as Record<string, unknown>;
    backup.world = 'kaputt';
    backup.characters = [1, 2, 3];
    backup.notes = { a: 1 };
    backup.events = null;
    backup.timers = 'viele';
    backup.dossierJournal = [];
    backup.npcOpinions = 7;
    backup.npcKnowledge = null;
    backup.sky = 'bewölkt';
    backup.now = 'jetzt';
    backup.removedTimers = {};
    const { data, report } = importV157Backup(backup);
    expectValid(data);
    expect(data.state.now).toBe(ELARIS_START);
    expect(report.join(' ')).toContain('Die Weltzeit im Backup war unlesbar');
    expect(entitiesOfKind(data, 'character')).toHaveLength(6);
    expect(Object.keys(data.entities)).toHaveLength(6);
    expect(data.campaign.calendar).toEqual(ELARIS_CALENDAR);
  });

  it('lässt gelöschte Timer weg, auch wenn ein älteres Gerät sie noch im Backup hatte', () => {
    const backup = full();
    (backup.timers as unknown[]).push({
      id: 't-geloescht',
      name: 'Gelöscht',
      kind: 'effect',
      who: '',
      target: '',
      concentration: false,
      start: T0,
      end: T0 + 10,
      stoppedAt: null,
    });
    const { data, sections } = importV157Backup(backup);
    expect(Object.values(data.timers).some((t) => t.label === 'Gelöscht')).toBe(false);
    expect(sections.skipped).toEqual([]);
  });

  it('bricht Kreise in der Ortsgliederung auf', () => {
    const backup = full();
    const places = backup.world.places as { id: string; parentId: string | null }[];
    places.find((p) => p.id === 'p-mark')!.parentId = 'p-eber';
    const { data } = importV157Backup(backup);
    expectValid(data);
    const paths = entitiesOfKind(data, 'place').map((p) => placePath(data, p.id));
    expect(paths.every((path) => path.split(' › ').length <= 4)).toBe(true);
  });

  it('begrenzt Stufen über 20 und nennt den alten Wert', () => {
    const backup = full();
    (backup.characters as Record<string, { level?: number }>).neil!.level = 24;
    const { data, sections } = importV157Backup(backup);
    const neil = byName(data, 'character', 'Neil');
    expect(neil.character.level).toBe(20);
    expect(neil.notes).toContain('Stufe in der alten Version: 24');
    expect(sections.hints.join(' ')).toContain('1 Gefährte hatte eine Stufe über 20');
  });

  it('verändert das übergebene Backup nicht', () => {
    const backup = full();
    const before = JSON.stringify(backup);
    importV157Backup(backup);
    expect(JSON.stringify(backup)).toBe(before);
  });
});

describe('Mehrere Verbindungen zwischen denselben beiden Einträgen', () => {
  it('werden zu einer Beziehung je Richtung zusammengelegt', () => {
    const backup = full();
    const relations = backup.world.database.relations as {
      id: string;
      type: string;
      from: string;
      to: string;
    }[];
    // Die Zollstube ist Teil der Salzgilde und zusätzlich mit ihr „verbunden“.
    relations.push({ id: 'r20', type: 'connection', from: 'o-zoll', to: 'o-gilde' });
    // Ardo ist mit dem Gefährten Veres verschwistert und hat zugleich eine Meinung über ihn.
    relations.push({ id: 'r21', type: 'sibling', from: 'c-ardo', to: 'c-veres-db' });
    const ardo = backup.world.database.records.characters.find((c) => c.id === 'c-ardo')!;
    (ardo.dynamic!.opinions as Record<string, number>).veres = 6;
    const { data } = importV157Backup(backup);
    expectValid(data);
    const zoll = findRelation(
      data,
      byName(data, 'faction', 'Zollstube').id,
      byName(data, 'faction', 'Salzgilde').id,
    )!;
    expect(zoll).toMatchObject({
      type: 'member',
      label: '',
      note: 'Teilorganisation · verbunden mit',
    });
    const sibling = findRelation(data, byName(data, 'person', 'Ardo Venn').id, 'veres')!;
    expect(sibling).toMatchObject({ type: 'family', note: 'Geschwister', attitude: 3 });
    const pairs = Object.values(data.relations).map((r) => `${r.from}→${r.to}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe('Bericht der letzten Übernahme', () => {
  it('bleibt nach einer Übernahme einsehbar, eine bloße Vorschau ändert ihn nicht', () => {
    const first = importV157Backup(structuredClone(minimalBackup));
    expect(lastImport()?.sections).toBe(first.sections);
    expect(lastImport()?.fileName).toBe('');
    const preview = previewV157Backup(full());
    expect(preview.report.length).toBeGreaterThan(first.report.length);
    expect(lastImport()?.sections).toBe(first.sections);
    rememberImport(preview, 'elaris-backup-2026-11-09.json');
    expect(lastImport()).toMatchObject({
      sections: preview.sections,
      fileName: 'elaris-backup-2026-11-09.json',
    });
    expect(Number.isNaN(Date.parse(lastImport()!.at))).toBe(false);
  });

  it('eine abgelehnte Datei lässt den letzten Bericht stehen', () => {
    const before = lastImport();
    expect(() => importV157Backup({ version: 3 })).toThrow();
    expect(lastImport()).toBe(before);
  });
});

describe('Verweise aufräumen (repairReferences)', () => {
  const base = () => importV157Backup(full()).data;
  const drop = (data: CampaignData, ...ids: string[]): CampaignData => ({
    ...data,
    entities: Object.fromEntries(Object.entries(data.entities).filter(([id]) => !ids.includes(id))),
  });

  it('lässt einen stimmigen Spielstand unverändert', () => {
    const data = base();
    const result = repairReferences(data);
    expect(result.repaired).toBe(0);
    expect(result.data).toBe(data);
  });

  it('löst Verweise auf fehlende Orte, Personen und Sessions', () => {
    const data = base();
    const turm = byName(data, 'place', 'Wachturm Graufels');
    const ilse = byName(data, 'person', 'Ilse Kornblum');
    const broken: CampaignData = { ...drop(data, turm.id, ilse.id), sessions: {} };
    const { data: fixed, repaired } = repairReferences(broken);
    expect(repaired).toBeGreaterThan(10);
    expect(repairReferences(fixed).repaired).toBe(0);
    expect(fixed.state).toMatchObject({ placeId: null, sessionId: null });
    expect(byName(fixed, 'person', 'Ardo Venn').person.placeId).toBeNull();
    expect(byName(fixed, 'faction', 'Graufelser Wacht').faction.seatId).toBeNull();
    expect(Object.values(fixed.relations).some((r) => r.from === ilse.id || r.to === turm.id)).toBe(
      false,
    );
    // Haltungsänderungen ohne Person entfallen, Notizen bleiben ohne den Verweis erhalten.
    expect(Object.values(fixed.chronicle).some((e) => e.attitude?.fromId === ilse.id)).toBe(false);
    expect(
      Object.values(fixed.chronicle).find((e) => e.text === 'Ilse kennt den alten Schmugglerpfad.')
        ?.refs,
    ).toEqual([]);
    expect(Object.values(fixed.chronicle).every((e) => e.sessionId === null)).toBe(true);
    expect(
      Object.values(fixed.events).find((e) => e.title === 'Treffen mit Ardo Venn am Turm')?.placeId,
    ).toBeNull();
    for (const name of COLLECTION_NAMES)
      for (const doc of Object.values(fixed[name]))
        expect(COLLECTION_SCHEMAS[name].parse(doc)).toEqual(doc);
  });

  it('verlangt, dass Orte auf Orte zeigen, und bricht Kreise auf', () => {
    const data = base();
    const mark = byName(data, 'place', 'Aschenmark');
    const eber = byName(data, 'place', 'Zum Lahmen Eber');
    const ardo = byName(data, 'person', 'Ardo Venn');
    const entities: Record<string, Entity> = {
      ...data.entities,
      [mark.id]: { ...mark, place: { ...mark.place, parentId: eber.id } },
      [ardo.id]: { ...ardo, person: { ...ardo.person, homeId: ardo.id } },
    };
    const { data: fixed, repaired } = repairReferences({ ...data, entities });
    expect(repaired).toBeGreaterThan(0);
    expect(byName(fixed, 'person', 'Ardo Venn').person.homeId).toBeNull();
    for (const place of entitiesOfKind(fixed, 'place'))
      expect(placePath(fixed, place.id).split(' › ').length).toBeLessThan(6);
    expect(repairReferences(fixed).repaired).toBe(0);
  });
});

describe('Session-Notizen in anderer Schreibweise', () => {
  it('erkennt auch „Sitzung 3“, „Spielabend 4“ und „Session #5“ – sonstige Titel bleiben Themen', () => {
    const raw = structuredClone(minimalBackup) as Record<string, unknown> & typeof minimalBackup;
    const at = raw.notes[0]!.at;
    raw.notes = [
      { id: 'a', title: 'Sitzung 3: Der Markt', body: 'Text A', at: at - 3000 },
      { id: 'b', title: 'spielabend 4', body: 'Text B', at: at - 2000 },
      { id: 'c', title: 'Session #5 – Aufbruch', body: 'Text C', at: at - 1000 },
      { id: 'd', title: 'Sessionplanung 6', body: 'Kein Abend, nur Planung.', at },
      { id: 'e', title: 'Sitzungsprotokoll', body: 'Auch kein Abend.', at },
    ];
    raw.active = 'c';
    const { data } = previewV157Backup(raw);
    expect(
      Object.values(data.sessions)
        .sort((x, y) => x.number - y.number)
        .map((s) => [s.number, s.title, s.notes]),
    ).toEqual([
      [3, 'Der Markt', 'Text A'],
      [4, '', 'Text B'],
      [5, 'Aufbruch', 'Text C'],
    ]);
    expect(data.state.sessionId).toBe('c');
    expect(
      entitiesOfKind(data, 'topic')
        .map((t) => t.name)
        .sort(),
    ).toEqual(['Sessionplanung 6', 'Sitzungsprotokoll']);
  });
});
