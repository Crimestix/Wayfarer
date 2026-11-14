import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { newScheme, newStory, setStorySteps } from '../../features/faeden/actions';
import { pauseClock } from '../../data/actions';
import {
  createChronicleEntry,
  createEntity,
  createEvent,
  createSession,
  type CampaignData,
} from '../schema';
import { MINUTES_PER_DAY, formatYear, fromTime, toTime, type CalendarDef } from '../time/calendar';
import {
  APPROX_DAYS,
  MAX_REPEATS_IN_VIEW,
  axisContext,
  axisTicks,
  centerView,
  clusterSpreads,
  defaultLaneKeys,
  evenings,
  fitView,
  laneChoices,
  laneKeysOf,
  layoutLane,
  panView,
  pieceWhen,
  repeatWindow,
  spreadOf,
  tickStep,
  timelineExtent,
  timelineLanes,
  toX,
  zoomBounds,
  zoomPreset,
  zoomUnit,
  zoomView,
  type TimelinePiece,
  type TimelineView,
} from '../timeline';

const DAY = MINUTES_PER_DAY;

/**
 * Erfundene Welt: Die Gruppe reist von Hohenfurt zur Salzgrotte; die Salzsieder wollen die
 * Grotte; Mira Tannhaus wurde um 672 geboren; in Hohenfurt ist jedes Jahr das Brückenfest.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const data = () => db.getSnapshot();
  for (const id of Object.keys(data().sessions)) db.remove('sessions', id);
  for (const id of Object.keys(data().events)) db.remove('events', id);
  db.setState({ sessionId: null });
  const now = data().state.now;
  const cal = data().campaign.calendar;
  const ford = db.put('entities', createEntity({ kind: 'place', name: 'Hohenfurt' }));
  const mill = db.put(
    'entities',
    createEntity({ kind: 'place', name: 'Alte Mühle', place: { parentId: ford.id } }),
  );
  const grotto = db.put('entities', createEntity({ kind: 'place', name: 'Salzgrotte' }));
  const guild = db.put('entities', createEntity({ kind: 'faction', name: 'Salzsieder' }));
  const year672 = toTime(cal, { year: 672 + 27387, month: 0, day: 1, hour: 0, minute: 0 });
  const mira = db.put(
    'entities',
    createEntity({
      kind: 'person',
      name: 'Mira Tannhaus',
      born: { at: year672, precision: 'year' },
    }),
  );
  const travel1 = db.put(
    'chronicle',
    createChronicleEntry({
      kind: 'travel',
      at: now - 5 * DAY,
      travel: { fromId: null, toId: ford.id },
    }),
  );
  const travel2 = db.put(
    'chronicle',
    createChronicleEntry({
      kind: 'travel',
      at: now - 2 * DAY,
      travel: { fromId: ford.id, toId: grotto.id },
    }),
  );
  const millNote = db.put(
    'chronicle',
    createChronicleEntry({
      kind: 'note',
      at: now - 4 * DAY,
      placeId: mill.id,
      text: 'Das Mühlrad steht still.\nZweite Zeile',
      refs: [mira.id],
      precision: 'approx',
    }),
  );
  const milestone = db.put(
    'chronicle',
    createChronicleEntry({ kind: 'milestone', at: now - DAY, text: 'Die Grotte ist offen' }),
  );
  const session = db.put(
    'sessions',
    createSession({ number: 3, title: '', startAt: now - 5 * DAY, endAt: now - 4 * DAY }),
  );
  const scheme = newScheme(db, guild.id)!;
  db.patch('stories', scheme.id, { title: 'Die Pacht der Grotte' });
  setStorySteps(db, scheme.id, [
    { id: 'a', text: 'Die Salzsieder kaufen die Pacht', days: 2 },
    { id: 'b', text: 'Die Salzsieder sperren den Zugang', days: 3 },
  ]);
  return {
    db,
    data,
    now,
    cal,
    ford,
    mill,
    grotto,
    guild,
    mira,
    travel1,
    travel2,
    millNote,
    milestone,
    session,
    scheme,
  };
}

const wide = (data: CampaignData) => ({ from: 0, to: data.state.now + 4000 * DAY });

describe('Bahnen der Zeitleiste', () => {
  it('die Gruppe: Aufenthalte als Abschnitte mit Ortsnamen, Meilensteine als Marken', async () => {
    const { data, now, ford, grotto, milestone } = await setup();
    const [party] = timelineLanes(data(), { keys: ['party'], window: wide(data()) });
    const stays = party!.pieces.filter((p) => p.kind === 'stay');
    expect(stays.map((p) => [p.text, p.from, p.to])).toEqual([
      ['Hohenfurt', now - 5 * DAY, now - 2 * DAY],
      ['Salzgrotte', now - 2 * DAY, now],
    ]);
    expect(stays[0]!.link).toEqual({ type: 'entity', id: ford.id });
    expect(stays[1]!.link).toEqual({ type: 'entity', id: grotto.id });
    const mark = party!.pieces.find((p) => p.kind === 'milestone')!;
    expect(mark).toMatchObject({
      text: 'Die Grotte ist offen',
      to: null,
      weight: 3,
      link: { type: 'chronicle', id: milestone.id },
    });
  });

  it('eine Geschichte mit Uhr: kommende Schritte, Laufzeit als Linie, Verweis auf ihr Blatt', async () => {
    const { data, now, scheme } = await setup();
    const [lane] = timelineLanes(data(), { keys: [`story:${scheme.id}`], window: wide(data()) });
    expect(lane).toMatchObject({ kind: 'story', title: 'Die Pacht der Grotte' });
    expect(lane!.sub).toBe('Geschichte · läuft');
    const steps = lane!.pieces.filter((p) => p.kind === 'step');
    expect(steps.map((p) => [p.text, p.from, p.tone, p.weight])).toEqual([
      ['Die Salzsieder kaufen die Pacht', now + 2 * DAY, 'future', 3],
      ['Die Salzsieder sperren den Zugang', now + 5 * DAY, 'future', 2],
    ]);
    const rail = lane!.pieces.find((p) => p.kind === 'rail')!;
    expect([rail.from, rail.to]).toEqual([now, now + 5 * DAY]);
    expect(steps[0]!.link).toEqual({ type: 'story', id: scheme.id });
  });

  it('eine Geschichte ohne Uhr hat keine Bahn', async () => {
    const { db, data } = await setup();
    const loose = newStory(db, { title: 'Ohne Uhr' });
    expect(timelineLanes(data(), { keys: [`story:${loose.id}`], window: wide(data()) })).toEqual(
      [],
    );
    expect(laneChoices(data()).some((c) => c.key === `story:${loose.id}`)).toBe(false);
  });

  it('eine Fraktion: ihre Vorhaben und die Veränderungen, die sie nennen', async () => {
    const { db, data, now, guild } = await setup();
    const change = db.put(
      'chronicle',
      createChronicleEntry({
        kind: 'change',
        at: now - 3 * DAY,
        refs: [guild.id],
        text: 'Neuer Meister der Gilde',
      }),
    );
    const [lane] = timelineLanes(data(), { keys: [`entity:${guild.id}`], window: wide(data()) });
    expect(lane!.kind).toBe('faction');
    expect(lane!.sub).toBe('Fraktion');
    expect(lane!.monogram).toBe('S');
    expect(lane!.pieces.filter((p) => p.kind === 'step')).toHaveLength(2);
    const entry = lane!.pieces.find((p) => p.link?.type === 'chronicle')!;
    expect(entry).toMatchObject({ text: 'Neuer Meister der Gilde', from: change.at });
  });

  it('eine Person: Lebensdaten nie genauer als bekannt, Einträge mit ihr', async () => {
    const { data, cal, mira, millNote } = await setup();
    const [lane] = timelineLanes(data(), { keys: [`entity:${mira.id}`], window: wide(data()) });
    const born = lane!.pieces.find((p) => p.kind === 'life')!;
    expect(born).toMatchObject({ text: 'Geboren', precision: 'year' });
    // Das ganze Jahr ist ungewiss – von seinem ersten bis zum ersten Tag des nächsten.
    expect(fromTime(cal, born.lo)).toMatchObject({ year: 672 + 27387, month: 0, day: 1 });
    expect(fromTime(cal, born.hi)).toMatchObject({ year: 673 + 27387, month: 0, day: 1 });
    expect(pieceWhen(cal, born)).toBe(formatYear(cal, 672 + 27387));
    const note = lane!.pieces.find((p) => p.link?.type === 'chronicle')!;
    // Nur die erste Zeile, wie geschrieben – und ungefähr.
    expect(note).toMatchObject({ text: 'Das Mühlrad steht still.', precision: 'approx' });
    expect(note.hi - note.lo).toBe(2 * APPROX_DAYS * DAY);
    expect(note.link).toEqual({ type: 'chronicle', id: millNote.id });
    expect(pieceWhen(cal, note).startsWith('etwa ')).toBe(true);
  });

  it('ein Ort: Besuche der Gruppe und was in ihm oder darunter geschah – Ortswechsel nicht doppelt', async () => {
    const { data, now, ford, millNote } = await setup();
    const [lane] = timelineLanes(data(), { keys: [`entity:${ford.id}`], window: wide(data()) });
    const visits = lane!.pieces.filter((p) => p.kind === 'visit');
    expect(visits.map((p) => [p.from, p.to])).toEqual([[now - 5 * DAY, now - 2 * DAY]]);
    const entries = lane!.pieces.filter((p) => p.link?.type === 'chronicle');
    expect(entries.map((p) => p.link)).toEqual([{ type: 'chronicle', id: millNote.id }]);
  });

  it('Termine: Feste und Einmaliges nach Gewicht, Alltag nie; Überfälliges in Rot', async () => {
    const { db, data, now, cal } = await setup();
    const d = fromTime(cal, now);
    const feast = db.put(
      'events',
      createEvent({
        title: 'Brückenfest',
        at: toTime(cal, { year: d.year, month: 2, day: 3, hour: 0, minute: 0 }),
        repeat: { every: 1, unit: 'year' },
      }),
    );
    db.put(
      'events',
      createEvent({ title: 'Wachwechsel', at: now, repeat: { every: 1, unit: 'day' } }),
    );
    const due = db.put(
      'events',
      createEvent({ title: 'Zins an die Gilde', at: now - 3 * DAY, kind: 'deadline' }),
    );
    const window = { from: now, to: now + 3 * 365 * DAY };
    const [lane] = timelineLanes(data(), { keys: ['events'], window });
    const titles = lane!.pieces.map((p) => p.text);
    expect(titles.filter((t) => t === 'Brückenfest')).toHaveLength(3);
    expect(titles).not.toContain('Wachwechsel');
    const overdue = lane!.pieces.find((p) => p.link?.type === 'event' && p.link.id === due.id)!;
    expect(overdue.tone).toBe('overdue');
    expect(lane!.pieces.find((p) => p.text === 'Brückenfest')!.link).toMatchObject({
      type: 'event',
      id: feast.id,
    });
    // Bei Jahrhunderten wäre das Fest nur Rauschen: Es fällt weg, statt die Bahn zu füllen.
    const far = { from: now, to: now + (MAX_REPEATS_IN_VIEW + 5) * 366 * DAY };
    const [farLane] = timelineLanes(data(), { keys: ['events'], window: far });
    expect(farLane!.pieces.map((p) => p.text)).not.toContain('Brückenfest');
  });

  it('Termine: wie oft ein Fest im Bild stünde, misst sich am Bild, nicht am breiteren Fenster', async () => {
    const { db, data, now, cal } = await setup();
    // Ein Markt, der seit Jahrhunderten jeden Monat ist.
    db.put(
      'events',
      createEvent({
        title: 'Mondmarkt',
        at: now - 300 * 365 * DAY,
        repeat: { every: 1, unit: 'month' },
      }),
    );
    const months = repeatWindow({ from: now, mpp: zoomPreset(cal, 'month'), width: 1300 });
    // Das Fenster reicht weit über das Bild hinaus – dort stünde der Markt über 40-mal.
    expect(months.to - months.from).toBeGreaterThan(4 * months.span!);
    const [lane] = timelineLanes(data(), { keys: ['events'], window: months });
    const markets = lane!.pieces.filter((p) => p.text === 'Mondmarkt');
    expect(markets.length).toBeGreaterThan(MAX_REPEATS_IN_VIEW);
    expect(markets.every((p) => p.from >= months.from && p.from <= months.to)).toBe(true);
    // Bei Jahren stünde er über hundertmal im Bild: Er fällt weg.
    const years = repeatWindow({ from: now, mpp: zoomPreset(cal, 'year'), width: 1300 });
    const [far] = timelineLanes(data(), { keys: ['events'], window: years });
    expect(far!.pieces.map((p) => p.text)).not.toContain('Mondmarkt');
  });

  it('Termine: eine Frist mit Uhrzeit ist überfällig, sobald sie verstrichen ist', async () => {
    const { db, data, now } = await setup();
    const timed = db.put(
      'events',
      createEvent({ title: 'Zins am Mittag', at: now - 60, timed: true, kind: 'deadline' }),
    );
    const daily = db.put(
      'events',
      createEvent({ title: 'Zins heute', at: now - 60, kind: 'deadline' }),
    );
    const [lane] = timelineLanes(data(), { keys: ['events'], window: wide(data()) });
    const tone = (id: string) =>
      lane!.pieces.find((p) => p.link?.type === 'event' && p.link.id === id)!.tone;
    expect(tone(timed.id)).toBe('overdue');
    // Ohne Uhrzeit gilt der ganze Tag – heute ist noch nichts versäumt.
    expect(tone(daily.id)).toBe('plain');
  });

  it('eine Uhr: jeder offene Schritt in der Vergangenheit ist überfällig, angehalten keiner', async () => {
    const { db, data, now } = await setup();
    const story = newStory(db, { title: 'Die Furt bricht' });
    setStorySteps(db, story.id, [
      { id: 'a', text: 'Das Wasser steigt', days: 2 },
      { id: 'b', text: 'Die Brücke wankt', days: 3 },
      { id: 'c', text: 'Die Furt bricht', days: 20 },
    ]);
    const clockId = data().stories[story.id]!.clockId!;
    db.patch('clocks', clockId, { start: now - 10 * DAY });
    const tones = () =>
      timelineLanes(data(), { keys: [`story:${story.id}`], window: wide(data()) })[0]!
        .pieces.filter((p) => p.kind === 'step')
        .map((p) => [p.text, p.tone]);
    // Beide treten beim nächsten Vorstellen der Zeit ein – beide sind überfällig.
    expect(tones()).toEqual([
      ['Das Wasser steigt', 'overdue'],
      ['Die Brücke wankt', 'overdue'],
      ['Die Furt bricht', 'future'],
    ]);
    pauseClock(db, clockId);
    expect(tones().map(([, tone]) => tone)).not.toContain('overdue');
  });

  it('Abende als Bänder; die laufende Session reicht bis jetzt', async () => {
    const { db, data, now, session } = await setup();
    const running = db.put('sessions', createSession({ number: 4, startAt: now - DAY }));
    db.setState({ sessionId: running.id });
    const bands = evenings(data());
    expect(bands.map((b) => [b.sessionId, b.title, b.from, b.to, b.running])).toEqual([
      [session.id, 'Session 3', now - 5 * DAY, now - 4 * DAY, false],
      [running.id, 'Session 4', now - DAY, now, true],
    ]);
  });

  it('wählt von selbst Gruppe, Termine, Weltgeschichte, Geschichten mit Uhr und Fraktionen mit Vorhaben', async () => {
    const { db, data, scheme, guild, mira } = await setup();
    expect(defaultLaneKeys(data())).toEqual([
      'party',
      'events',
      'history',
      `story:${scheme.id}`,
      `entity:${guild.id}`,
    ]);
    expect(laneKeysOf(data())).toEqual(defaultLaneKeys(data()));
    // Gewählt wird im Spielstand; Gelöschtes und Doppeltes fällt heraus.
    db.setState({ timelineLanes: [`entity:${mira.id}`, 'party', 'party', 'entity:weg'] });
    expect(laneKeysOf(data())).toEqual([`entity:${mira.id}`, 'party']);
  });

  it('die Ausdehnung reicht vom Frühesten bis zum Spätesten, mindestens bis jetzt', async () => {
    const { data, now, mira, scheme } = await setup();
    const lanes = timelineLanes(data(), {
      keys: ['party', `entity:${mira.id}`, `story:${scheme.id}`],
      window: wide(data()),
    });
    const extent = timelineExtent(lanes, evenings(data()), now);
    expect(extent.to).toBe(now + 5 * DAY);
    expect(extent.from).toBe(lanes[1]!.pieces.find((p) => p.kind === 'life')!.lo);
  });
});

// ── Achse und Maßstab ──────────────────────────────────────────────────────

describe('Achse', () => {
  const cal = elarisCampaign().campaign.calendar;
  const now = elarisCampaign().state.now;
  const view = (mpp: number, width = 1200): TimelineView => ({ from: now, mpp, width });

  it('teilt je Zoomstufe von Stunden bis Jahrtausenden', () => {
    expect(zoomUnit(cal, zoomPreset(cal, 'hour'))).toBe('hour');
    expect(zoomUnit(cal, zoomPreset(cal, 'day'))).toBe('day');
    expect(zoomUnit(cal, zoomPreset(cal, 'month'))).toBe('month');
    expect(zoomUnit(cal, zoomPreset(cal, 'year'))).toBe('year');
    expect(zoomUnit(cal, zoomPreset(cal, 'decade'))).toBe('decade');
    expect(zoomUnit(cal, zoomPreset(cal, 'century'))).toBe('century');
    expect(zoomUnit(cal, zoomPreset(cal, 'millennium'))).toBe('millennium');
    const bounds = zoomBounds(cal);
    expect(zoomUnit(cal, bounds.min)).toBe('hour');
    expect(zoomUnit(cal, bounds.max)).toBe('millennium');
    // Ganz herausgezoomt passen Jahrtausende ins Bild – mit wenigen Teilstrichen.
    const wideView = { from: 0, mpp: bounds.max, width: 1400 };
    const years = (wideView.width * wideView.mpp) / (365 * MINUTES_PER_DAY);
    expect(years).toBeGreaterThan(30000);
    const { ticks } = axisTicks(cal, wideView);
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks.length).toBeLessThan(40);
  });

  it('Stunden: Uhrzeiten, und am Tageswechsel Wochentag und Datum', () => {
    const { unit, ticks } = axisTicks(cal, view(zoomPreset(cal, 'hour'), 4000));
    expect(unit).toBe('hour');
    expect(ticks.some((t) => t.label === '20:00')).toBe(true);
    const midnight = ticks.find((t) => t.major)!;
    expect(midnight.at % MINUTES_PER_DAY).toBe(0);
    expect(midnight.label).toBe('00:00');
    expect(midnight.major).toMatch(/\. Tauwind 701 AD$/);
  });

  it('Tage: Tageszahlen, am Monatsersten Monat und Jahr – aus dem Kalender, nicht fest', () => {
    const { ticks } = axisTicks(cal, view(zoomPreset(cal, 'day'), 6000));
    const first = ticks.find((t) => t.major)!;
    expect(first.label).toBe('1.');
    expect(first.major).toBe('Grünbruch 701 AD');
  });

  it('Monate und Jahre richten sich nach der Jahreszahl der Zeitrechnung', () => {
    const months = axisTicks(cal, view(zoomPreset(cal, 'month'), 3000)).ticks;
    expect(months.find((t) => t.major)?.major).toBe('702 AD');
    expect(months.some((t) => t.label === 'Hochbrand')).toBe(true);
    const decades = axisTicks(cal, view(zoomPreset(cal, 'decade'), 2000)).ticks;
    expect(decades.every((t) => Number(t.label) % 10 === 0)).toBe(true);
    const centuries = axisTicks(cal, view(zoomPreset(cal, 'century'), 2000)).ticks;
    expect(centuries.every((t) => Number(t.label) % 100 === 0)).toBe(true);
    expect(centuries.find((t) => t.major)?.major).toMatch(/000 AD$/);
  });

  it('sagt, wo man ist, auch wenn keine Grenze im Bild liegt', () => {
    const hours = { from: now, mpp: zoomPreset(cal, 'hour'), width: 600 };
    expect(axisContext(cal, hours)).toMatch(/17\. Tauwind 701 AD$/);
    expect(axisContext(cal, { ...hours, mpp: zoomPreset(cal, 'day') })).toMatch(
      /^(Tauwind|Grünbruch) 701 AD$/,
    );
    expect(axisContext(cal, { ...hours, mpp: zoomPreset(cal, 'decade') })).toBeNull();
  });

  it('Teilstriche liegen nie dichter als lesbar', () => {
    for (const mpp of [0.3, 3, 40, 400, 4000, 40000, 400000]) {
      const step = tickStep(cal, mpp);
      expect(step.length / mpp).toBeGreaterThanOrEqual(64);
    }
  });

  it('zoomt um die Maus: der Zeitpunkt darunter bleibt stehen; Grenzen gelten', () => {
    const v = view(10);
    const anchor = 300;
    const before = v.from + anchor * v.mpp;
    const z = zoomView(cal, v, 0.5, anchor);
    expect(z.mpp).toBe(5);
    expect(z.from + anchor * z.mpp).toBeCloseTo(before, 6);
    expect(zoomView(cal, v, 1e-9).mpp).toBe(zoomBounds(cal).min);
    expect(zoomView(cal, v, 1e12).mpp).toBe(zoomBounds(cal).max);
    expect(panView(v, 100).from).toBe(v.from - 1000);
    expect(toX(centerView(v, now + 5000), now + 5000)).toBeCloseTo(400, 6);
    const fit = fitView(cal, v, { from: now, to: now + 10 * DAY });
    expect(toX(fit, now)).toBeGreaterThan(0);
    expect(toX(fit, now + 10 * DAY)).toBeLessThan(1200);
  });
});

// ── Auslegen ───────────────────────────────────────────────────────────────

describe('Auslegen einer Bahn', () => {
  const cal: CalendarDef = elarisCampaign().campaign.calendar;
  const t0 = elarisCampaign().state.now;
  const mark = (key: string, at: number, text: string, weight: 1 | 2 | 3 = 2): TimelinePiece => ({
    key,
    kind: 'entry',
    from: at,
    to: null,
    precision: 'exact',
    lo: at,
    hi: at,
    text,
    link: null,
    weight,
    tone: 'plain',
  });
  const v: TimelineView = { from: t0, mpp: 1, width: 1000 };

  it('Marken mit Platz behalten ihre Schrift in einer Reihe', () => {
    const out = layoutLane([mark('a', t0 + 100, 'Kurz'), mark('b', t0 + 500, 'Auch kurz')], v);
    expect(out.rows).toBe(1);
    expect(out.items.every((i) => i.labelW > 0)).toBe(true);
  });

  it('bei Platzmangel weicht die leichtere Schrift in eine neue Reihe oder ganz', () => {
    const long = 'Ein sehr langer Satz, der viel Platz braucht';
    const pieces = [
      mark('a', t0 + 100, long, 1),
      mark('b', t0 + 130, long, 3),
      mark('c', t0 + 160, long, 2),
      mark('d', t0 + 190, long, 1),
    ];
    const out = layoutLane(pieces, v);
    const by = new Map(out.items.map((i) => [i.key, i]));
    // Das Schwerste bekommt die erste Reihe und die ganze Schrift.
    expect(by.get('b')).toMatchObject({ row: 0 });
    expect(by.get('b')!.labelW).toBeGreaterThan(200);
    expect(out.rows).toBeLessThanOrEqual(3);
    // Nichts liegt mit seiner Schrift über einem anderen.
    for (const a of out.items)
      for (const b of out.items) {
        if (a === b || a.row !== b.row || !a.labelW) continue;
        const aEnd = a.x + 12 + a.labelW;
        expect(b.x + 7 <= a.x - 7 || b.x - 7 >= aEnd - 0.5).toBe(true);
      }
  });

  it('dicht gedrängte Marken werden zu einem Bündel mit ihrer Zahl', () => {
    const pieces = [0, 2, 4, 6, 8].map((n) => mark(`m${n}`, t0 + 400 + n, `Eintrag ${n}`));
    const out = layoutLane(pieces, v);
    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.cluster).toMatchObject({ count: 5, from: t0 + 400, to: t0 + 408 });
  });

  it('ein Bündel kennt seine Stücke; liegen sie zur selben Zeit, hilft kein Heranzoomen', () => {
    const spread = [0, 2, 4, 6, 8].map((n) => mark(`m${n}`, t0 + 400 + n, `Eintrag ${n}`));
    const apart = layoutLane(spread, v).items[0]!.cluster!;
    expect(apart.members.map((p) => p.key)).toEqual(['m0', 'm2', 'm4', 'm6', 'm8']);
    expect(clusterSpreads(cal, apart.members)).toBe(true);
    // Drei Einträge in derselben Minute – festgehalten, ohne dass Zeit verging.
    const same = ['x', 'y', 'z'].map((key) => mark(key, t0 + 400, `Eintrag ${key}`));
    const together = layoutLane(same, { ...v, from: t0 + 300, mpp: zoomBounds(cal).min }).items;
    expect(together).toHaveLength(1);
    expect(clusterSpreads(cal, together[0]!.cluster!.members)).toBe(false);
    // Am selben Tag, nur der Tag bekannt: auch das bleibt beisammen.
    const days = [60, 300, 900].map((m) => {
      const at = Math.floor(t0 / DAY) * DAY + m;
      return {
        ...mark(`d${m}`, at, 'Am Tag'),
        precision: 'day' as const,
        ...spreadOf(cal, at, 'day'),
      };
    });
    expect(clusterSpreads(cal, days)).toBe(false);
  });

  it('das Fenster für wiederkehrende Termine umfasst immer das Bild', () => {
    for (const mpp of [0.3, 13, 900, 40000, 900000])
      for (const from of [0, t0 - 12345, t0, t0 + 987654]) {
        const view = { from, mpp, width: 1100 };
        const w = repeatWindow(view);
        expect(w.from).toBeLessThanOrEqual(from);
        expect(w.to).toBeGreaterThanOrEqual(from + view.width * mpp);
        expect(w.span).toBe(view.width * mpp);
      }
  });

  it('nur Sichtbares wird ausgelegt; Leisten tragen ihre Schrift in sich', () => {
    const bar: TimelinePiece = {
      ...mark('bar', t0 + 50, 'Hohenfurt'),
      kind: 'stay',
      to: t0 + 450,
      hi: t0 + 450,
    };
    const gone = mark('fern', t0 + 100000, 'Weit weg');
    const out = layoutLane([bar, gone], v);
    expect(out.items.map((i) => i.key)).toEqual(['bar']);
    expect(out.items[0]).toMatchObject({ x: 50, w: 400 });
    expect(out.items[0]!.labelW).toBeGreaterThan(0);
  });

  it('Ungewissheit: ein Tag, ein Monat, ein Jahr', () => {
    const at = t0 + 5 * 60;
    expect(spreadOf(cal, at, 'exact')).toEqual({ lo: at, hi: at });
    const day = spreadOf(cal, at, 'day');
    expect(day.hi - day.lo).toBe(DAY);
    const month = spreadOf(cal, at, 'month');
    expect(fromTime(cal, month.lo).day).toBe(1);
    expect(fromTime(cal, month.hi).day).toBe(1);
    expect((month.hi - month.lo) / DAY).toBe(31);
  });
});
