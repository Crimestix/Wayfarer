import { describe, expect, it } from 'vitest';
import { advanceTime, endSession, logEntry, moveParty, startSession } from '../../../data/actions';
import { CampaignDb } from '../../../data/db';
import { emptyCampaign } from '../../../data/seed';
import { demoCampaign } from '../../../data/__fixtures__/demoWorld';
import { MemoryStore } from '../../../data/store';
import { entitiesOfKind, placeStatus } from '../../../domain/derive';
import {
  createEntity,
  createEvent,
  createRelation,
  createTimer,
  type CampaignData,
} from '../../../domain/schema';
import { MINUTES_PER_DAY } from '../../../domain/time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../../../domain/time/elaris';
import {
  absenceMinutes,
  activeMention,
  buildAgenda,
  castView,
  changesFresh,
  companions,
  earlierHere,
  exhaustionAfterClick,
  exhaustionEffect,
  groupByDay,
  insertMention,
  journal,
  keptMentions,
  mentionSuggestions,
  nearbyPlaces,
  ongoingOccurrences,
  overdueLabel,
  partyPlace,
  runningLabel,
  sheetLink,
  stayLabels,
  whenLabel,
} from '../model';

async function demoDb() {
  return CampaignDb.create(new MemoryStore(), demoCampaign());
}
const byName = (data: CampaignData, name: string) =>
  Object.values(data.entities).find((e) => e.name === name)!;
const DAY = MINUTES_PER_DAY;
/** Einträge derselben Weltminute ordnen sich nach dem Zeitpunkt des Anlegens. */
const pause = () => new Promise((resolve) => setTimeout(resolve, 3));

describe('Ort der Gruppe', () => {
  it('kennt den Ort der Gruppe und ignoriert gelöschte oder fremde Verweise', async () => {
    const db = await demoDb();
    expect(partyPlace(db.getSnapshot())?.name).toBe('Krähenmoor');
    db.setState({ placeId: byName(db.getSnapshot(), 'Maera Duskryn').id });
    expect(partyPlace(db.getSnapshot())).toBeNull();
    db.setState({ placeId: null });
    expect(partyPlace(db.getSnapshot())).toBeNull();
  });

  it('nennt den ersten Besuch und seit wann die Gruppe da ist', async () => {
    const db = await demoDb();
    const data = db.getSnapshot();
    const labels = stayLabels(
      data.campaign.calendar,
      data.state.now,
      placeStatus(data, data.state.placeId!),
    );
    expect(labels.first).toBe(true);
    expect(labels.headline).toBe('Erster Besuch');
    // Moor und Kloster darunter zählen als ein Aufenthalt seit sechs Tagen.
    expect(labels.since).toBe('Seit dem 11. Tauwind hier');
    expect(labels.visit).toBeNull();
    expect(absenceMinutes(placeStatus(data, data.state.placeId!), data.state.now)).toBeNull();
  });

  it('nennt bei der Rückkehr den letzten Besuch und zählt die Besuche', async () => {
    const db = await demoDb();
    const hafen = byName(db.getSnapshot(), 'Dornhafen');
    moveParty(db, hafen.id);
    let data = db.getSnapshot();
    let status = placeStatus(data, hafen.id);
    let labels = stayLabels(data.campaign.calendar, data.state.now, status);
    expect(labels.headline).toBe('Zuletzt hier vor 6 Tagen');
    expect(labels.since).toBe('Gerade angekommen');
    expect(labels.visit).toBe('2. Besuch');
    expect(absenceMinutes(status, data.state.now)).toBe(6 * DAY);

    expect(changesFresh(status, data.state.now)).toBe(true);

    advanceTime(db, data.state.now + 90);
    data = db.getSnapshot();
    status = placeStatus(data, hafen.id);
    labels = stayLabels(data.campaign.calendar, data.state.now, status);
    expect(labels.since).toBe('Seit 16:00 Uhr hier');
    expect(changesFresh(status, data.state.now)).toBe(true);
    // Nach einem Tag am Ort sind die Veränderungen keine Neuigkeit mehr.
    expect(changesFresh(status, status.current!.from + DAY - 1)).toBe(true);
    expect(changesFresh(status, status.current!.from + DAY)).toBe(false);
    // Die Abwesenheit wächst nicht weiter, während die Gruppe wieder da ist.
    expect(absenceMinutes(status, data.state.now)).toBe(6 * DAY);
  });

  it('sagt „Erster Besuch“, wenn der Ort ohne Ortswechsel gesetzt wurde', () => {
    const data = emptyCampaign('Test', ELARIS_CALENDAR, ELARIS_START);
    const place = createEntity({ kind: 'place', name: 'Irgendwo' });
    const withPlace = {
      ...data,
      entities: { [place.id]: place },
      state: { ...data.state, placeId: place.id },
    };
    const labels = stayLabels(
      withPlace.campaign.calendar,
      withPlace.state.now,
      placeStatus(withPlace, place.id),
    );
    expect(labels).toEqual({ headline: 'Erster Besuch', first: true, since: null, visit: null });
  });
});

describe('Wer hier ist', () => {
  it('zeigt Anwesende mit Haltung, genauem Aufenthalt und ob die Gruppe sie kennt', async () => {
    const db = await demoDb();
    const data = db.getSnapshot();
    const view = castView(data, byName(data, 'Dornhafen').id);
    // Erst wer unmittelbar in der Stadt ist, dann nach Ort darunter.
    expect(view.present.map((r) => r.entity.name)).toEqual([
      'Brann Eisenhaken',
      'Hauptmann Voss',
      'Maera Duskryn',
      'Isolde Rabenschwinge',
      'Kessa Flutwind',
    ]);
    const brann = view.present[0]!;
    expect(brann).toMatchObject({ attitude: -1, role: 'Hafenmeister', where: null, unmet: false });
    const maera = view.present[2]!;
    expect(maera.where).toBe('Kontor der Duskryn');
    expect(maera.whereId).toBe(byName(data, 'Kontor der Duskryn').id);
    const kessa = view.present[4]!;
    expect(kessa).toMatchObject({ attitude: null, unmet: true, where: 'Zum Salzigen Raben' });
    expect(view.factions.map((r) => [r.entity.name, r.role, r.where])).toEqual([
      ['Bruderschaft der Lotsen', 'Gilde', 'Zum Salzigen Raben'],
      ['Haus Duskryn', 'Adelshaus', 'Kontor der Duskryn'],
    ]);
    expect(view.away).toEqual([]);
    expect(view.total).toBe(7);
  });

  it('führt Abwesende mit ihrem Schicksal und Verbundene mit ihrer Beziehung zum Ort', async () => {
    const db = await demoDb();
    let data = db.getSnapshot();
    const kloster = byName(data, 'Kloster Sankt Vael');
    let view = castView(data, kloster.id);
    expect(view.present).toEqual([]);
    // Verschollene und Tote stehen für sich – weder anwesend noch bloß fort.
    expect(view.away).toEqual([]);
    expect(view.lost).toHaveLength(1);
    expect(view.lost[0]).toMatchObject({ fate: 'Verschollen', where: null, unmet: true });
    // Auch wenn als letzter Aufenthalt noch der Ort eingetragen ist: Ein Toter ist nicht anwesend.
    const missing = view.lost[0]!.entity;
    if (missing.kind !== 'person') throw new Error('Person erwartet');
    db.put('entities', {
      ...missing,
      person: { ...missing.person, status: 'dead', placeId: kloster.id },
    });
    view = castView(db.getSnapshot(), kloster.id);
    expect(view.present).toEqual([]);
    expect(view.lost[0]).toMatchObject({ fate: 'Tot' });
    // Wer lebt und nur gerade woanders ist, steht mit seinem jetzigen Ort da – oder als unbekannt.
    const teoric = { ...missing, person: { ...missing.person, placeId: null } };
    if (teoric.kind !== 'person') throw new Error('Person erwartet');
    db.put('entities', { ...teoric, person: { ...teoric.person, status: 'alive' } });
    expect(castView(db.getSnapshot(), kloster.id).away[0]).toMatchObject({
      fate: null,
      where: 'Aufenthalt unbekannt',
    });
    db.put('entities', {
      ...teoric,
      person: { ...teoric.person, status: 'alive', placeId: byName(data, 'Dornhafen').id },
    });
    expect(castView(db.getSnapshot(), kloster.id).away[0]).toMatchObject({
      where: 'jetzt: Dornhafen',
    });
    db.put('entities', teoric);
    data = db.getSnapshot();

    // In Dornhafen ist Haus Duskryn schon als Fraktion mit Sitz geführt – nicht doppelt als Verbundene.
    expect(castView(data, byName(data, 'Dornhafen').id).linked).toEqual([]);

    // Wer nur über eine Beziehung mit dem Ort zu tun hat, steht mit dieser Beziehung da.
    const voss = byName(data, 'Hauptmann Voss');
    const glocke = byName(data, 'Die Glocke von Sankt Vael');
    db.put('relations', createRelation({ from: voss.id, to: kloster.id, type: 'seeks' }));
    db.put('relations', createRelation({ from: kloster.id, to: glocke.id, type: 'owns' }));
    db.put(
      'relations',
      createRelation({ from: kloster.id, to: byName(data, 'Krähenmoor').id, type: 'knows' }),
    );
    data = db.getSnapshot();
    view = castView(data, kloster.id);
    // Die Glocke liegt im Kloster und steht deshalb bei den Gegenständen – nicht noch einmal als Verbundene.
    expect(view.items.map((r) => [r.entity.name, r.role, r.where, r.hasAttitude])).toEqual([
      ['Die Glocke von Sankt Vael', 'Artefakt', null, false],
    ]);
    expect(view.linked.map((r) => [r.entity.name, r.role, r.hasAttitude, r.attitude])).toEqual([
      ['Hauptmann Voss', 'sucht Kloster Sankt Vael', true, -2],
    ]);
    expect(view.total).toBe(3);
    // Vom Moor aus gesehen liegt sie einen Ort tiefer.
    expect(castView(data, byName(data, 'Krähenmoor').id).items[0]).toMatchObject({
      where: 'Kloster Sankt Vael',
      tagline: 'Bronzeglocke, die schlägt, wenn jemand im Moor stirbt.',
    });
  });

  it('zeigt Kurzbeschreibung und offene Abmachungen je Person', async () => {
    const db = await demoDb();
    const data = db.getSnapshot();
    const view = castView(data, byName(data, 'Dornhafen').id);
    const brann = view.present.find((r) => r.entity.name === 'Brann Eisenhaken')!;
    expect(brann.tagline).toBe('Hafenmeister. Schuldet der Gruppe einen Gefallen und hasst es.');
    expect(brann.promises).toEqual([
      'Brann besorgt die Ladeliste des Grauen Fangs – bis das Schiff ablegt.',
    ]);
    expect(view.present.find((r) => r.entity.name === 'Hauptmann Voss')!.promises).toEqual([]);
    // Ohne Rolle und Volk dient die Kurzbeschreibung als Unterzeile und steht nicht doppelt da.
    const stranger = db.put(
      'entities',
      createEntity({
        kind: 'person',
        name: 'Fremder',
        tagline: 'Sagt nichts.',
        person: { placeId: byName(data, 'Dornhafen').id },
      }),
    );
    const row = castView(db.getSnapshot(), byName(data, 'Dornhafen').id).present.find(
      (r) => r.entity.id === stranger.id,
    )!;
    expect(row).toMatchObject({ role: 'Sagt nichts.', tagline: '' });
  });

  it('erinnert an frühere Besuche, ohne zu wiederholen, was sich seither verändert hat', async () => {
    const db = await demoDb();
    let data = db.getSnapshot();
    const moor = byName(data, 'Krähenmoor');
    // Erster, noch laufender Aufenthalt: nichts Früheres.
    expect(earlierHere(data, moor.id, placeStatus(data, moor.id))).toEqual([]);
    const hafen = byName(data, 'Dornhafen');
    moveParty(db, hafen.id);
    logEntry(db, { text: 'Gerade eben in der Stadt' });
    data = db.getSnapshot();
    const status = placeStatus(data, hafen.id);
    expect(status.changesSince).toHaveLength(2);
    expect(earlierHere(data, hafen.id, status).map((e) => e.kind)).toEqual([
      'note',
      'attitude',
      'promise',
    ]);
  });
});

describe('Orte hier', () => {
  it('bietet die Orte darunter mit der Zahl der Leute dort und den Weg zurück', async () => {
    const data = (await demoDb()).getSnapshot();
    const near = nearbyPlaces(data, byName(data, 'Dornhafen').id);
    expect(near.parent?.name).toBe('Nebelküste');
    expect(near.children.map((c) => [c.place.name, c.people])).toEqual([
      ['Kontor der Duskryn', 1],
      ['Zum Salzigen Raben', 2],
    ]);
    const top = nearbyPlaces(data, byName(data, 'Nebelküste').id);
    expect(top.parent).toBeNull();
    expect(top.children.map((c) => [c.place.name, c.people])).toEqual([
      ['Dornhafen', 5],
      ['Krähenmoor', 0],
    ]);
  });
});

describe('Anstehend', () => {
  it('ordnet nach Dringlichkeit und benennt den Abstand', async () => {
    const db = await demoDb();
    const now = db.getSnapshot().state.now;
    db.put('events', createEvent({ title: 'Zoll bezahlen', at: now - 2 * DAY, kind: 'deadline' }));
    db.put(
      'events',
      createEvent({ title: 'Wachwechsel', at: now + 30, timed: true, kind: 'world' }),
    );
    db.put('timers', createTimer({ label: 'Fackel brennt', start: now - 20, end: now + 40 }));
    logEntry(db, { kind: 'promise', text: 'Voss die Papiere zeigen', due: now - 60 });
    logEntry(db, { kind: 'promise', text: 'Ohne Frist' });
    const items = buildAgenda(db.getSnapshot(), 7);
    expect(items.map((i) => [i.title, i.tone, i.when])).toEqual([
      ['Zoll bezahlen', 'overdue', 'seit 2 Tagen überfällig'],
      ['Voss die Papiere zeigen', 'overdue', 'seit 1 Std. überfällig'],
      ['Wachwechsel', 'today', 'in 30 Min.'],
      ['Fackel brennt', 'today', 'noch 40 Min.'],
      ['Treffen mit Brann am Nordkai', 'later', 'morgen, 22:00'],
      ['Der Graue Fang legt ab', 'later', 'in 2 Tagen'],
      [
        'Brann besorgt die Ladeliste des Grauen Fangs – bis das Schiff ablegt.',
        'later',
        'in 2 Tagen',
      ],
      ['Vollmondmarkt in Dornhafen', 'later', 'in 5 Tagen'],
      // Abmachungen ohne Frist stehen am Ende: Sie sind offen, drängen aber nicht.
      ['Ohne Frist', 'later', 'ohne Frist'],
    ]);
    expect(items.at(-1)).toMatchObject({ undated: true, checkable: true, checkLabel: 'Eingelöst' });
    expect(items.filter((i) => i.undated)).toHaveLength(1);
    const byTitle = (title: string) => items.find((i) => i.title === title)!;
    expect(byTitle('Zoll bezahlen')).toMatchObject({
      label: 'Frist',
      mark: 'deadline',
      checkable: true,
      source: 'event',
    });
    expect(byTitle('Wachwechsel')).toMatchObject({ label: 'Ereignis', checkable: false });
    expect(byTitle('Fackel brennt')).toMatchObject({
      label: 'Wirkung',
      checkable: true,
      source: 'timer',
    });
    expect(byTitle('Treffen mit Brann am Nordkai').date).toBe('18. Tauwind, 22:00');
    expect(byTitle('Vollmondmarkt in Dornhafen').date).toBe('22. Tauwind');
  });

  it('reicht nur so viele Tage voraus wie verlangt, behält Fristen von Abmachungen aber immer', async () => {
    const db = await demoDb();
    const titles = buildAgenda(db.getSnapshot(), 2).map((i) => i.title);
    expect(titles).toContain('Treffen mit Brann am Nordkai');
    expect(titles).not.toContain('Vollmondmarkt in Dornhafen');
    expect(titles.some((t) => t.startsWith('Brann besorgt'))).toBe(true);
  });

  it('nennt einen wiederkehrenden Termin nur mit seinem nächsten Eintreten', async () => {
    const db = await CampaignDb.create(
      new MemoryStore(),
      emptyCampaign('Test', ELARIS_CALENDAR, ELARIS_START),
    );
    const now = db.getSnapshot().state.now;
    db.put(
      'events',
      createEvent({
        title: 'Abendglocke',
        at: now - 3 * DAY + 120,
        timed: true,
        kind: 'world',
        repeat: { every: 1, unit: 'day' },
        // Tägliches ist sonst Alltag und steht nicht unter „Anstehend“.
        weight: 'important',
      }),
    );
    db.put('events', createEvent({ title: 'Markt', at: now + 2 * DAY, kind: 'world' }));
    const items = buildAgenda(db.getSnapshot(), 7);
    expect(items.map((i) => [i.title, i.when, i.repeats])).toEqual([
      ['Abendglocke', 'in 2 Std.', true],
      ['Markt', 'in 2 Tagen', false],
    ]);
    // Ist das heutige Läuten vorbei, steht das morgige da.
    advanceTime(db, now + 180);
    expect(buildAgenda(db.getSnapshot(), 7).map((i) => [i.title, i.when])).toEqual([
      ['Abendglocke', 'morgen, 18:00'],
      ['Markt', 'in 2 Tagen'],
    ]);
  });

  it('zeigt mehrtägige Ereignisse, solange sie laufen', async () => {
    const db = await CampaignDb.create(
      new MemoryStore(),
      emptyCampaign('Test', ELARIS_CALENDAR, ELARIS_START),
    );
    const now = db.getSnapshot().state.now;
    db.put(
      'events',
      createEvent({ title: 'Erntefest', at: now + DAY, kind: 'world', durationDays: 3 }),
    );
    db.put(
      'events',
      createEvent({ title: 'Belagerung brechen', at: now + DAY, kind: 'plan', durationDays: 3 }),
    );
    const titles = () => buildAgenda(db.getSnapshot(), 7).map((i) => [i.title, i.tone, i.when]);
    expect(ongoingOccurrences(db.getSnapshot())).toEqual([]);
    expect(buildAgenda(db.getSnapshot(), 7)[1]).toMatchObject({
      title: 'Erntefest',
      when: 'morgen',
      date: '18. Tauwind bis 20. Tauwind',
    });

    // Zweiter Tag: Das Fest läuft; das Vorhaben gilt seit seinem Beginn als überfällig.
    advanceTime(db, now + 2 * DAY);
    expect(ongoingOccurrences(db.getSnapshot()).map((o) => o.event.title)).toEqual(['Erntefest']);
    expect(titles()).toEqual([
      ['Belagerung brechen', 'overdue', 'seit gestern überfällig'],
      ['Erntefest', 'today', 'läuft bis morgen'],
    ]);
    expect(buildAgenda(db.getSnapshot(), 7)[1]).toMatchObject({ checkable: false });

    advanceTime(db, now + 3 * DAY);
    expect(titles()[1]).toEqual(['Erntefest', 'today', 'endet heute']);
    advanceTime(db, now + 4 * DAY);
    expect(titles().map((t) => t[0])).toEqual(['Belagerung brechen']);
  });

  it('sagt, wie lange etwas noch läuft', () => {
    const noon = 1000 * DAY + 12 * 60;
    expect(runningLabel(ELARIS_CALENDAR, noon, 1000)).toBe('endet heute');
    expect(runningLabel(ELARIS_CALENDAR, noon, 1001)).toBe('läuft bis morgen');
    expect(runningLabel(ELARIS_CALENDAR, noon, 1004)).toMatch(/^läuft bis \d+\. \S+$/);
  });

  it('beschreibt Abstände in Worten', () => {
    const noon = 1000 * DAY + 12 * 60;
    expect(whenLabel(noon, noon, true)).toBe('jetzt');
    expect(whenLabel(noon, 1000 * DAY, false)).toBe('heute');
    expect(whenLabel(noon, noon + 150, true)).toBe('in 2 Std. 30 Min.');
    expect(whenLabel(noon, 1001 * DAY, false)).toBe('morgen');
    expect(whenLabel(noon, 1001 * DAY + 8 * 60, true)).toBe('morgen, 08:00');
    expect(whenLabel(noon, 1004 * DAY + 5, true)).toBe('in 4 Tagen');
    expect(overdueLabel(noon, noon - 45)).toBe('seit 45 Min. überfällig');
    expect(overdueLabel(noon, noon - DAY)).toBe('seit gestern überfällig');
    expect(overdueLabel(noon, noon - 5 * DAY)).toBe('seit 5 Tagen überfällig');
  });
});

describe('Mitschrift', () => {
  it('zeigt die laufende Session, neueste zuerst, und ohne Session die letzten Einträge', async () => {
    const db = await demoDb();
    logEntry(db, { text: 'Erste Notiz' });
    await pause();
    logEntry(db, { text: 'Zweite Notiz' });
    let j = journal(db.getSnapshot());
    expect(j.session?.number).toBe(12);
    expect(j.total).toBe(12);
    expect(j.entries.slice(0, 2).map((e) => e.text)).toEqual(['Zweite Notiz', 'Erste Notiz']);
    expect(journal(db.getSnapshot(), 3).entries).toHaveLength(3);

    startSession(db);
    j = journal(db.getSnapshot());
    expect(j.session?.number).toBe(13);
    expect(j.entries).toEqual([]);
    await pause();
    logEntry(db, { text: 'Neue Session' });
    expect(journal(db.getSnapshot()).entries.map((e) => e.text)).toEqual(['Neue Session']);

    endSession(db);
    j = journal(db.getSnapshot());
    expect(j.session).toBeNull();
    expect(j.total).toBe(13);
    expect(j.entries[0]!.text).toBe('Neue Session');
  });

  it('teilt den Verlauf in Tage', async () => {
    const db = await demoDb();
    logEntry(db, { text: 'Heute' });
    const data = db.getSnapshot();
    const groups = groupByDay(data.campaign.calendar, data.state.now, journal(data).entries);
    expect(groups.map((g) => [g.label, g.date, g.entries.length])).toEqual([
      ['Heute', '17. Tauwind', 2],
      ['Vor 2 Tagen', '15. Tauwind', 1],
      ['Vor 3 Tagen', '14. Tauwind', 1],
      ['Vor 5 Tagen', '12. Tauwind', 2],
      ['Vor 6 Tagen', '11. Tauwind', 1],
      ['Vor 8 Tagen', '9. Tauwind', 2],
      ['Vor 9 Tagen', '8. Tauwind', 2],
    ]);
  });
});

describe('Verweise mit @', () => {
  it('erkennt einen begonnenen Verweis an der Schreibmarke', () => {
    expect(activeMention('@', 1)).toEqual({ start: 0, end: 1, query: '' });
    expect(activeMention('Treffen mit @Bra', 16)).toEqual({ start: 12, end: 16, query: 'Bra' });
    expect(activeMention('Treffen mit @Maera Du', 21)?.query).toBe('Maera Du');
    // Schreibmarke mitten im Text: nur bis dorthin.
    expect(activeMention('@Brann kommt', 3)?.query).toBe('Br');
  });

  it('lässt E-Mail-artiges, beendete und zu lange Verweise in Ruhe', () => {
    expect(activeMention('kein Verweis', 5)).toBeNull();
    expect(activeMention('name@ort', 8)).toBeNull();
    expect(activeMention('@Brann ', 7)).toBeNull();
    expect(activeMention('@ Brann', 7)).toBeNull();
    expect(activeMention('@eins zwei drei vier fünf', 25)).toBeNull();
    expect(activeMention('@Brann\nweiter', 13)).toBeNull();
  });

  it('setzt den Namen ein und stellt die Schreibmarke dahinter', () => {
    const text = 'Treffen mit @Bra am Kai';
    const range = activeMention(text, 16)!;
    expect(insertMention(text, range, 'Brann Eisenhaken')).toEqual({
      text: 'Treffen mit Brann Eisenhaken am Kai',
      caret: 28,
    });
    const end = insertMention('@isol', { start: 0, end: 5, query: 'isol' }, 'Isolde Rabenschwinge');
    expect(end).toEqual({ text: 'Isolde Rabenschwinge ', caret: 21 });
  });

  it('behält nur Verweise, deren Name noch im Text steht', () => {
    const mentions = [
      { id: 'a', name: 'Brann Eisenhaken' },
      { id: 'b', name: 'Isolde Rabenschwinge' },
      { id: 'a', name: 'Brann Eisenhaken' },
    ];
    expect(
      keptMentions('Brann Eisenhaken und Isolde Rabenschwinge streiten', mentions).map((m) => m.id),
    ).toEqual(['a', 'b']);
    expect(keptMentions('Brann Eisenhaken geht', mentions).map((m) => m.id)).toEqual(['a']);
    expect(keptMentions('', mentions)).toEqual([]);
    // Wen es nicht mehr gibt (Anlegen zurückgenommen), der bleibt Text und wird nicht verknüpft.
    expect(
      keptMentions(
        'Brann Eisenhaken und Isolde Rabenschwinge streiten',
        mentions,
        (id) => id !== 'a',
      ).map((m) => m.id),
    ).toEqual(['b']);
  });

  it('schlägt ohne Suchwort vor, wer am Ort ist, und sucht sonst in der ganzen Welt', async () => {
    const db = await demoDb();
    moveParty(db, byName(db.getSnapshot(), 'Zum Salzigen Raben').id);
    const data = db.getSnapshot();
    expect(mentionSuggestions(data, '', 4).map((e) => e.name)).toEqual([
      'Isolde Rabenschwinge',
      'Kessa Flutwind',
      'Corrin',
      'Naelmira',
    ]);
    expect(mentionSuggestions(data, 'bra').map((e) => e.name)).toEqual(['Brann Eisenhaken']);
    expect(mentionSuggestions(data, 'xyz')).toEqual([]);
    db.setState({ placeId: null });
    expect(mentionSuggestions(db.getSnapshot(), '', 3)).toHaveLength(3);
  });
});

describe('Gefährten', () => {
  it('setzt die angeklickte Stufe und nimmt bei erneutem Klick eine zurück', () => {
    expect(exhaustionAfterClick(0, 1)).toBe(1);
    expect(exhaustionAfterClick(1, 1)).toBe(0);
    expect(exhaustionAfterClick(2, 5)).toBe(5);
    expect(exhaustionAfterClick(5, 2)).toBe(2);
    expect(exhaustionAfterClick(6, 6)).toBe(5);
    expect(exhaustionAfterClick(3, 9)).toBe(6);
  });

  it('erklärt die Stufe nach den Regeln von 2024', () => {
    expect(exhaustionEffect(0)).toBe('Nicht erschöpft');
    expect(exhaustionEffect(3)).toBe('Erschöpfung 3: −6 auf alle W20-Würfe, Bewegungsrate −15 Fuß');
    expect(exhaustionEffect(6)).toContain('stirbt');
  });

  it('öffnet nur Charakterbögen mit gefahrloser Adresse', () => {
    expect(sheetLink('')).toBeNull();
    expect(sheetLink('  https://www.dndbeyond.com/characters/123 ')).toBe(
      'https://www.dndbeyond.com/characters/123',
    );
    expect(sheetLink('dndbeyond.com/characters/123')).toBe('https://dndbeyond.com/characters/123');
    expect(sheetLink('javascript:alert(1)')).toBeNull();
    expect(sheetLink('file:///etc/passwd')).toBeNull();
    expect(sheetLink('kein link')).toBeNull();
  });

  it('zeigt die aktive Gruppe und wer woanders ist', async () => {
    const db = await demoDb();
    const data = db.getSnapshot();
    const [corrin, naelmira, neil] = entitiesOfKind(data, 'character');
    const hafen = byName(data, 'Dornhafen');
    db.put('entities', { ...corrin!, character: { ...corrin!.character, placeId: hafen.id } });
    db.put('entities', {
      ...naelmira!,
      character: { ...naelmira!.character, placeId: data.state.placeId },
    });
    db.put('entities', { ...neil!, character: { ...neil!.character, active: false } });
    const list = companions(db.getSnapshot());
    expect(list).toHaveLength(5);
    expect(list.find((c) => c.character.id === corrin!.id)).toMatchObject({
      elsewhere: { name: 'Dornhafen' },
      astray: false,
    });
    expect(list.find((c) => c.character.id === naelmira!.id)).toMatchObject({
      elsewhere: null,
      astray: false,
    });
    expect(list.every((c) => c.character.id !== neil!.id)).toBe(true);
  });
});
