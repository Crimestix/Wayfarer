import { describe, expect, it } from 'vitest';
import { emptyCampaign } from '../../data/seed';
import { demoCampaign } from '../../data/__fixtures__/demoWorld';
import { overdueEvents } from '../../domain/derive';
import {
  createChronicleEntry,
  createEvent,
  createTimer,
  type CampaignData,
} from '../../domain/schema';
import {
  MINUTES_PER_DAY,
  dayIndexOf,
  fromTime,
  moonPhase,
  toTime,
  type CalendarDef,
} from '../../domain/time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../../domain/time/elaris';
import {
  blankEventForm,
  calibrateMoon,
  chronicleMarks,
  chronicleOnDay,
  describePassage,
  describeRepeat,
  eventToForm,
  layoutWeek,
  monthGrid,
  moonEventsBetween,
  nextOccurrences,
  occurredBeforeDay,
  overdueLabel,
  parseDuration,
  parseEventForm,
  previewPassage,
  relativeDay,
  spanState,
  spansBetween,
  spansOnDay,
  splitDuration,
  timerProgress,
  type DaySpan,
} from './model';

const cal = ELARIS_CALENDAR;
const DAY = MINUTES_PER_DAY;
const AD = 27387;
const at = (day: number, month = 0, hour = 0, minute = 0, year = 701) =>
  toTime(cal, { year: year + AD, month, day, hour, minute });

/** Kalender mit zehn Wochentagen und drei Monaten – nichts darf auf sieben Tage bauen. */
const ODD: CalendarDef = {
  id: 'odd',
  name: 'Zehntagekalender',
  months: [
    { name: 'Eins', days: 20 },
    { name: 'Zwei', days: 33 },
    { name: 'Drei', days: 7 },
  ],
  weekdays: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
  leapRule: 'none',
  weekdayAnchor: { day: 0, weekday: 4 },
  eras: [{ id: 'x', label: 'X', offset: 0 }],
  moons: [],
};

function world(events: ReturnType<typeof createEvent>[] = []): CampaignData {
  const data = emptyCampaign('Test', cal, ELARIS_START);
  return { ...data, events: Object.fromEntries(events.map((e) => [e.id, e])) };
}

describe('monthGrid', () => {
  it('legt Tauwind 701 AD in Wochenzeilen mit Ausläufern der Nachbarmonate', () => {
    const grid = monthGrid(cal, 701 + AD, 0);
    expect(grid.weeks.every((week) => week.length === cal.weekdays.length)).toBe(true);
    const cells = grid.weeks.flat().filter((c) => c !== null);
    const inMonth = cells.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0]!.day).toBe(1);
    expect(inMonth[30]!.day).toBe(31);
    // Jede Spalte hat genau einen Wochentag, in der Reihenfolge des Kalenders.
    for (const week of grid.weeks) week.forEach((cell, col) => expect(cell!.weekday).toBe(col));
    // Tagesindizes laufen lückenlos.
    cells.forEach((cell, i) => expect(cell.dayIndex).toBe(grid.firstDay + i));
    expect(grid.lastDay).toBe(cells[cells.length - 1]!.dayIndex);
    // Ausläufer gehören zu den Nachbarmonaten.
    const lead = cells.filter((c) => !c.inMonth && c.dayIndex < inMonth[0]!.dayIndex);
    for (const c of lead) expect(c.month).toBe(11);
  });

  it('kennt den Wochentag des 17. Tauwind (Leuchtabend)', () => {
    const grid = monthGrid(cal, 701 + AD, 0);
    const cell = grid.weeks.flat().find((c) => c?.inMonth && c.day === 17)!;
    expect(cal.weekdays[cell.weekday]).toBe('Leuchtabend');
    expect(cell.dayIndex).toBe(dayIndexOf(ELARIS_START));
  });

  it('rechnet mit beliebiger Wochenlänge und lässt Tage vor Beginn der Zeit leer', () => {
    const grid = monthGrid(ODD, 1, 0);
    expect(grid.weeks[0]).toHaveLength(10);
    // Tag 0 ist Wochentag 4: vier leere Felder davor.
    expect(grid.weeks[0]!.slice(0, 4)).toEqual([null, null, null, null]);
    expect(grid.weeks[0]![4]!.day).toBe(1);
    expect(grid.weeks).toHaveLength(Math.ceil((4 + 20) / 10));
    const second = monthGrid(ODD, 1, 1);
    expect(second.weeks.flat().filter((c) => c?.inMonth)).toHaveLength(33);
  });

  it('berücksichtigt Schaltjahre', () => {
    const leap = monthGrid(cal, 28088, 1); // 28088 ist durch 4 teilbar
    expect(leap.weeks.flat().filter((c) => c?.inMonth)).toHaveLength(29);
    const common = monthGrid(cal, 28089, 1);
    expect(common.weeks.flat().filter((c) => c?.inMonth)).toHaveLength(28);
  });
});

describe('relativeDay', () => {
  it('benennt Abstände in Tagen', () => {
    expect(relativeDay(10, 10)).toBe('Heute');
    expect(relativeDay(10, 11)).toBe('Morgen');
    expect(relativeDay(10, 9)).toBe('Gestern');
    expect(relativeDay(10, 15)).toBe('in 5 Tagen');
    expect(relativeDay(10, 7)).toBe('vor 3 Tagen');
  });
});

describe('spansBetween', () => {
  it('findet mehrtägige Termine auch, wenn sie vor dem Zeitraum beginnen', () => {
    const fest = createEvent({ title: 'Erntefest', at: at(10), durationDays: 4 });
    const data = world([fest, createEvent({ title: 'Markt', at: at(20) })]);
    const day12 = dayIndexOf(at(12));
    const spans = spansBetween(data, day12, day12 + 2);
    expect(spans.map((s) => s.event.title)).toEqual(['Erntefest']);
    expect(spans[0]!.startDay).toBe(dayIndexOf(at(10)));
    expect(spans[0]!.endDay).toBe(dayIndexOf(at(13)));
    expect(spansBetween(data, dayIndexOf(at(14)), dayIndexOf(at(19)))).toEqual([]);
  });

  it('entfaltet Wiederholungen, jedes Vorkommen mit eigener Dauer', () => {
    const markt = createEvent({
      title: 'Wochenmarkt',
      at: at(3),
      durationDays: 2,
      repeat: { every: 1, unit: 'week' },
    });
    const spans = spansBetween(world([markt]), dayIndexOf(at(1)), dayIndexOf(at(31)));
    expect(spans.map((s) => fromTime(cal, s.at).day)).toEqual([3, 10, 17, 24, 31]);
    expect(spans.every((s) => s.endDay === s.startDay + 1)).toBe(true);
  });

  it('ordnet die Termine eines Tages: ohne Uhrzeit zuerst, dann nach Uhrzeit', () => {
    const data = world([
      createEvent({ title: 'Abendmahl', at: at(5, 0, 19), timed: true }),
      createEvent({ title: 'Audienz', at: at(5, 0, 9), timed: true }),
      createEvent({ title: 'Feiertag', at: at(5) }),
      createEvent({ title: 'Belagerung', at: at(4, 0, 22), timed: true, durationDays: 3 }),
    ]);
    const day = dayIndexOf(at(5));
    const spans = spansBetween(data, day, day);
    expect(spansOnDay(spans, day).map((s) => s.event.title)).toEqual([
      'Belagerung',
      'Feiertag',
      'Audienz',
      'Abendmahl',
    ]);
    expect(spansOnDay(spans, day + 3)).toEqual([]);
  });
});

describe('spanState', () => {
  const now = at(17, 0, 16);
  const span = (init: Parameters<typeof createEvent>[0]): DaySpan => {
    const event = createEvent(init);
    const startDay = dayIndexOf(event.at);
    return { event, at: event.at, startDay, endDay: startDay + (event.durationDays ?? 1) - 1 };
  };

  it('unterscheidet offen, abgehakt, überfällig und vorbei', () => {
    expect(spanState(span({ title: 'a', at: at(19) }), now)).toBe('open');
    expect(spanState(span({ title: 'a', at: at(17) }), now)).toBe('open');
    expect(spanState(span({ title: 'a', at: at(12), done: true }), now)).toBe('done');
    expect(spanState(span({ title: 'a', at: at(12), kind: 'world' }), now)).toBe('past');
    expect(spanState(span({ title: 'a', at: at(12), kind: 'deadline' }), now)).toBe('overdue');
    expect(spanState(span({ title: 'a', at: at(17, 0, 15), timed: true, kind: 'plan' }), now)).toBe(
      'overdue',
    );
    expect(spanState(span({ title: 'a', at: at(17, 0, 17), timed: true, kind: 'plan' }), now)).toBe(
      'open',
    );
    expect(spanState(span({ title: 'a', at: at(17, 0, 15), timed: true }), now)).toBe('past');
  });

  it('behandelt wiederkehrende Termine nie als überfällig oder abgehakt', () => {
    const weekly = span({
      title: 'a',
      at: at(3),
      kind: 'plan',
      repeat: { every: 1, unit: 'week' },
      done: true,
    });
    expect(spanState(weekly, now)).toBe('past');
  });

  it('lässt laufende mehrtägige Weltereignisse offen', () => {
    expect(spanState(span({ title: 'a', at: at(15), durationDays: 4 }), now)).toBe('open');
    expect(spanState(span({ title: 'a', at: at(12), durationDays: 4 }), now)).toBe('past');
  });

  it('stimmt bei Vorhaben und Fristen mit overdueEvents überein', () => {
    const events = [
      createEvent({ title: 'a', at: at(12), kind: 'deadline' }),
      createEvent({ title: 'b', at: at(16), kind: 'plan', durationDays: 3 }),
      createEvent({ title: 'c', at: at(17), kind: 'plan' }),
      createEvent({ title: 'd', at: at(17, 0, 10), kind: 'plan', timed: true }),
      createEvent({ title: 'e', at: at(18), kind: 'deadline' }),
      createEvent({ title: 'f', at: at(10), kind: 'deadline', done: true }),
      createEvent({ title: 'g', at: at(10), kind: 'world' }),
    ];
    const data = { ...world(events), state: { ...world().state, now } };
    const overdue = new Set(overdueEvents(data).map((e) => e.title));
    const spans = spansBetween(data, dayIndexOf(at(1)), dayIndexOf(at(31)));
    for (const s of spans) expect(spanState(s, now) === 'overdue').toBe(overdue.has(s.event.title));
    expect([...overdue].sort()).toEqual(['a', 'b', 'd']);
  });
});

describe('layoutWeek', () => {
  const mk = (title: string, startDay: number, days = 1, timed = false): DaySpan => {
    const event = createEvent({
      title,
      at: startDay * DAY + (timed ? 600 : 0),
      timed,
      durationDays: days > 1 ? days : null,
    });
    return { event, at: event.at, startDay, endDay: startDay + days - 1 };
  };

  it('legt mehrtägige Termine als einen Balken und kappt sie an den Wochenrändern', () => {
    const spans = [mk('Fest', 68, 5), mk('Markt', 71)];
    const first = layoutWeek(spans, 63, 7, 3);
    expect(first.segments).toHaveLength(1);
    expect(first.segments[0]).toMatchObject({
      col: 5,
      length: 2,
      lane: 0,
      continuesBefore: false,
      continuesAfter: true,
    });
    const second = layoutWeek(spans, 70, 7, 3);
    const fest = second.segments.find((s) => s.span.event.title === 'Fest')!;
    expect(fest).toMatchObject({
      col: 0,
      length: 3,
      lane: 0,
      continuesBefore: true,
      continuesAfter: false,
    });
    const markt = second.segments.find((s) => s.span.event.title === 'Markt')!;
    expect(markt).toMatchObject({ col: 1, length: 1, lane: 1 });
    expect(second.hidden).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('nutzt freie Zeilen wieder und überlappt nie', () => {
    const spans = [mk('A', 70, 2), mk('B', 72, 2), mk('C', 71, 3), mk('D', 74)];
    const { segments } = layoutWeek(spans, 70, 7, 4);
    const lane = (title: string) => segments.find((s) => s.span.event.title === title)!.lane;
    expect(lane('A')).toBe(0);
    expect(lane('B')).toBe(0);
    expect(lane('C')).toBe(1);
    expect(lane('D')).toBe(0);
    for (const a of segments)
      for (const b of segments)
        if (a !== b && a.lane === b.lane)
          expect(a.col + a.length <= b.col || b.col + b.length <= a.col).toBe(true);
  });

  it('macht an vollen Tagen Platz für den Hinweis auf weitere Termine', () => {
    const spans = [mk('A', 70), mk('B', 70), mk('C', 70), mk('D', 70), mk('E', 71), mk('F', 71)];
    const { segments, hidden } = layoutWeek(spans, 70, 7, 2);
    // Tag 70: vier Termine, zwei Zeilen → einer sichtbar, drei verborgen.
    expect(segments.filter((s) => s.col === 0).map((s) => s.span.event.title)).toEqual(['A']);
    expect(hidden[0]).toBe(3);
    // Tag 71: zwei Termine passen genau.
    expect(segments.filter((s) => s.col === 1)).toHaveLength(2);
    expect(hidden[1]).toBe(0);
  });

  it('zählt einen verdrängten mehrtägigen Termin an jedem seiner Tage', () => {
    const spans = [mk('Lang', 70, 3), mk('X', 70, 3), mk('Y', 70, 3)];
    const { segments, hidden } = layoutWeek(spans, 70, 7, 2);
    expect(segments).toHaveLength(1);
    expect(hidden.slice(0, 4)).toEqual([2, 2, 2, 0]);
  });

  it('kommt mit anderer Wochenlänge zurecht', () => {
    const { segments } = layoutWeek([mk('Zug', 8, 5)], 0, 10, 3);
    expect(segments[0]).toMatchObject({ col: 8, length: 2, continuesAfter: true });
  });

  it('lässt eintägige Termine die freie Zeile darunter mitbenutzen', () => {
    const spans = [mk('Allein', 70), mk('Oben', 71), mk('Unten', 71), mk('Lang', 72, 2)];
    const { segments } = layoutWeek(spans, 70, 7, 3);
    const tall = (title: string) => segments.find((s) => s.span.event.title === title)!.tall;
    expect(tall('Allein')).toBe(true);
    // Darunter steht schon ein Termin.
    expect(tall('Oben')).toBe(false);
    expect(tall('Unten')).toBe(true);
    // Mehrtägige Balken bleiben einzeilig.
    expect(tall('Lang')).toBe(false);
  });

  it('bricht nicht um, wo die letzte Zeile fehlt oder „weitere“ anzeigt', () => {
    // Nur eine Zeile: nichts darunter.
    expect(layoutWeek([mk('A', 70)], 70, 7, 1).segments[0]!.tall).toBe(false);
    // Vier Termine, drei Zeilen: A und B sichtbar, die dritte Zeile gehört dem Hinweis.
    const { segments, hidden } = layoutWeek(
      [mk('A', 70), mk('B', 70), mk('C', 70), mk('D', 70)],
      70,
      7,
      3,
    );
    expect(hidden[0]).toBe(2);
    expect(segments.map((s) => [s.span.event.title, s.tall])).toEqual([
      ['A', false],
      ['B', false],
    ]);
    // Ein Balken darunter, der nur über den Tag hinwegläuft, belegt die Zeile ebenfalls.
    const crossing = layoutWeek([mk('Lang', 70, 3), mk('Kurz', 71)], 70, 7, 3);
    const lang = crossing.segments.find((s) => s.span.event.title === 'Lang')!;
    const kurz = crossing.segments.find((s) => s.span.event.title === 'Kurz')!;
    expect(lang.lane).toBe(0);
    expect(kurz).toMatchObject({ lane: 1, tall: true });
  });
});

describe('Chronik im Raster', () => {
  it('zählt Einträge je Tag und merkt Ortswechsel getrennt', () => {
    const data = demoCampaign();
    const today = dayIndexOf(data.state.now);
    const marks = chronicleMarks(data, today - 30, today + 30);
    // Beispielwelt: am heutigen Tag nur der Rückweg (Ortswechsel).
    expect(marks.get(today)).toMatchObject({ entries: 0 });
    expect(marks.get(today)!.travels).toHaveLength(1);
    // Vor neun Tagen: Ankunft und eine Notiz.
    expect(marks.get(today - 9)!.entries).toBe(1);
    expect(marks.get(today - 9)!.travels).toHaveLength(1);
    expect(marks.has(today + 1)).toBe(false);
    expect(chronicleMarks(data, today + 1, today + 30).size).toBe(0);
  });

  it('liefert die Chronik eines Tages in zeitlicher Folge', () => {
    const base = emptyCampaign('Test', cal, ELARIS_START);
    const entries = [
      createChronicleEntry({ at: at(5, 0, 18), text: 'spät' }),
      createChronicleEntry({ at: at(5, 0, 7), text: 'früh' }),
      createChronicleEntry({ at: at(6, 0, 0), text: 'anderer Tag' }),
    ];
    const data = { ...base, chronicle: Object.fromEntries(entries.map((e) => [e.id, e])) };
    expect(chronicleOnDay(data, dayIndexOf(at(5))).map((e) => e.text)).toEqual(['früh', 'spät']);
  });
});

describe('Monde', () => {
  it('findet Voll- und Neumonde dort, wo moonPhase sie ankündigt', () => {
    const now = ELARIS_START;
    const today = dayIndexOf(now);
    const events = moonEventsBetween(cal, today, today + 60);
    for (const moon of cal.moons) {
      const phase = moonPhase(moon, now);
      const full = events
        .get(dayIndexOf(phase.nextFull))
        ?.find((e) => e.moon.id === moon.id && e.quarter === 2);
      expect(full?.label).toBe('Vollmond');
      expect(Math.abs(full!.at - phase.nextFull)).toBeLessThanOrEqual(1);
      const dark = events
        .get(dayIndexOf(phase.nextNew))
        ?.find((e) => e.moon.id === moon.id && e.quarter === 0);
      expect(dark?.label).toBe('Neumond');
    }
  });

  it('liefert je Umlauf vier Hauptphasen in fester Folge', () => {
    const moon = cal.moons[0]!;
    const from = 1000;
    const days = Math.ceil((moon.period * 3) / DAY);
    const all = [
      ...moonEventsBetween({ ...cal, moons: [moon] }, from, from + days).values(),
    ].flat();
    all.sort((a, b) => a.at - b.at);
    expect(all.length).toBeGreaterThanOrEqual(12);
    for (let i = 1; i < all.length; i++)
      expect(all[i]!.quarter).toBe((all[i - 1]!.quarter + 1) % 4);
  });

  it('lässt Monde aus, die schneller als alle zwei Tage umlaufen', () => {
    const fast = { ...cal, moons: [{ ...cal.moons[0]!, period: 600 }] };
    expect(moonEventsBetween(fast, 0, 30).size).toBe(0);
  });

  it('stellt einen Mond auf Vollmond oder Neumond, ohne die anderen zu ändern', () => {
    const now = ELARIS_START;
    const full = calibrateMoon(cal, 'caldus', now, 'full');
    expect(moonPhase(full.moons[0]!, now).label).toBe('Vollmond');
    expect(moonPhase(full.moons[0]!, now).light).toBe(100);
    expect(full.moons[1]).toEqual(cal.moons[1]);
    expect(full.months).toBe(cal.months);
    const dark = calibrateMoon(cal, 'damaros', now, 'new');
    expect(moonPhase(dark.moons[1]!, now).fraction).toBe(0);
    expect(dark.moons[0]).toEqual(cal.moons[0]);
    // Der Vollmond fällt im Raster auf den heutigen Tag.
    const today = dayIndexOf(now);
    expect(
      moonEventsBetween(full, today, today)
        .get(today)
        ?.some((e) => e.quarter === 2),
    ).toBe(true);
    // Unbekannter Mond: nichts ändert sich.
    expect(calibrateMoon(cal, 'nix', now, 'full').moons).toEqual(cal.moons);
  });
});

describe('Wiederholung', () => {
  it('beschreibt den Rhythmus in Worten', () => {
    expect(describeRepeat(null)).toBe('einmalig');
    expect(describeRepeat({ every: 1, unit: 'day' })).toBe('täglich');
    expect(describeRepeat({ every: 1, unit: 'week' })).toBe('jede Woche');
    expect(describeRepeat({ every: 2, unit: 'week' })).toBe('alle 2 Wochen');
    expect(describeRepeat({ every: 1, unit: 'month' })).toBe('jeden Monat');
    expect(describeRepeat({ every: 3, unit: 'month' })).toBe('alle 3 Monate');
    expect(describeRepeat({ every: 1, unit: 'year' })).toBe('jedes Jahr');
    expect(describeRepeat({ every: 10, unit: 'year' })).toBe('alle 10 Jahre');
  });

  it('nennt die nächsten Vorkommen ab einem Zeitpunkt', () => {
    const monthly = createEvent({ title: 'Zins', at: at(31), repeat: { every: 1, unit: 'month' } });
    const next = nextOccurrences(cal, monthly, at(1, 1), 3).map((t) => {
      const d = fromTime(cal, t);
      return `${d.day}.${d.month + 1}`;
    });
    // Grünbruch hat im Schaltjahr 701 AD (JF 28088) 29 Tage.
    expect(next).toEqual(['29.2', '31.3', '30.4']);
    const yearly = createEvent({
      title: 'Jahrfest',
      at: at(5),
      repeat: { every: 2, unit: 'year' },
    });
    expect(nextOccurrences(cal, yearly, at(6), 2).map((t) => fromTime(cal, t).year - AD)).toEqual([
      703, 705,
    ]);
    expect(nextOccurrences(cal, createEvent({ title: 'x', at: at(5) }), at(1), 3)).toEqual([]);
  });
});

describe('Termin-Dialog', () => {
  it('füllt ein leeres Formular mit dem gewählten Tag in der Hauptzeitrechnung', () => {
    const form = blankEventForm(cal, at(22));
    expect(form).toMatchObject({
      day: '22',
      month: 0,
      year: '701',
      timed: false,
      repeatUnit: 'none',
      kind: 'world',
    });
  });

  it('übersetzt einen Termin ins Formular und wieder zurück', () => {
    const event = createEvent({
      title: 'Treffen',
      at: at(18, 0, 22, 5),
      timed: true,
      kind: 'plan',
      placeId: 'ort',
      refs: ['a', 'b'],
      durationDays: 3,
      repeat: { every: 2, unit: 'week' },
      details: 'Am Nordkai.',
    });
    const form = eventToForm(cal, event);
    expect(form).toMatchObject({
      day: '18',
      hour: '22',
      minute: '05',
      durationDays: '3',
      repeatUnit: 'week',
      repeatEvery: '2',
    });
    const parsed = parseEventForm(cal, form);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const {
      title,
      at: time,
      timed,
      kind,
      placeId,
      refs,
      durationDays,
      repeat,
      details,
      done,
    } = event;
    expect(parsed.value).toEqual({
      title,
      at: time,
      timed,
      kind,
      placeId,
      refs,
      durationDays,
      repeat,
      details,
      done,
      weight: 'auto',
      threadId: null,
    });
  });

  it('legt Termine ohne Uhrzeit auf den Tagesbeginn', () => {
    const parsed = parseEventForm(cal, {
      ...blankEventForm(cal, at(22, 0, 15, 30)),
      title: ' Markt ',
      hour: '99',
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: { title: 'Markt', at: at(22), timed: false, durationDays: null, repeat: null },
    });
  });

  it('weist unvollständige und unmögliche Eingaben mit verständlicher Meldung zurück', () => {
    const base = { ...blankEventForm(cal, at(22)), title: 'Markt' };
    const error = (change: Partial<typeof base>) => {
      const result = parseEventForm(cal, { ...base, ...change });
      return result.ok ? null : result.error;
    };
    expect(error({})).toBeNull();
    expect(error({ title: '  ' })).toMatch(/Titel/);
    expect(error({ day: '32' })).toMatch(/Datum/);
    expect(error({ day: '30', month: 1 })).toMatch(/Datum/);
    expect(error({ day: '' })).toMatch(/Datum/);
    expect(error({ day: '1.5' })).toMatch(/Datum/);
    expect(error({ year: 'abc' })).toMatch(/Datum/);
    expect(error({ year: '-30000' })).toMatch(/Datum/);
    expect(error({ timed: true, hour: '24' })).toMatch(/Uhrzeit/);
    expect(error({ timed: true, hour: '7', minute: '60' })).toMatch(/Uhrzeit/);
    expect(error({ timed: true, hour: '', minute: '0' })).toMatch(/Uhrzeit/);
    expect(error({ durationDays: '0' })).toMatch(/Dauer/);
    expect(error({ durationDays: 'drei' })).toMatch(/Dauer/);
    expect(error({ repeatUnit: 'week', repeatEvery: '0' })).toMatch(/Wiederholung/);
    expect(error({ repeatUnit: 'week', repeatEvery: '' })).toMatch(/Wiederholung/);
    // Ohne Wiederholung ist das Feld „alle N“ gleichgültig.
    expect(error({ repeatUnit: 'none', repeatEvery: '' })).toBeNull();
  });

  it('behandelt eine Dauer von einem Tag wie keine Angabe und hakt Wiederkehrendes nicht ab', () => {
    const base = { ...blankEventForm(cal, at(22)), title: 'Markt' };
    expect(parseEventForm(cal, { ...base, durationDays: '1' })).toMatchObject({
      value: { durationDays: null },
    });
    expect(parseEventForm(cal, { ...base, done: true })).toMatchObject({ value: { done: true } });
    expect(parseEventForm(cal, { ...base, done: true, repeatUnit: 'month' })).toMatchObject({
      value: { done: false, repeat: { every: 1, unit: 'month' } },
    });
  });

  it('rechnet das Jahr der Hauptzeitrechnung um, auch im Schaltjahr', () => {
    const parsed = parseEventForm(cal, {
      ...blankEventForm(cal, at(1)),
      title: 'Schalttag',
      day: '29',
      month: 1,
    });
    expect(parsed).toMatchObject({ ok: true, value: { at: at(29, 1) } });
    const next = parseEventForm(cal, {
      ...blankEventForm(cal, at(1)),
      title: 'x',
      day: '29',
      month: 1,
      year: '702',
    });
    expect(next.ok).toBe(false);
  });
});

describe('Wirkungen und Tätigkeiten', () => {
  it('rechnet Dauern aus Tagen, Stunden und Minuten', () => {
    expect(parseDuration('', '1', '')).toBe(60);
    expect(parseDuration('2', '3', '15')).toBe(2 * DAY + 195);
    expect(parseDuration('', '', '')).toBeNull();
    expect(parseDuration('0', '0', '0')).toBeNull();
    expect(parseDuration('', 'x', '')).toBeNull();
    expect(parseDuration('', '-1', '')).toBeNull();
    expect(splitDuration(2 * DAY + 195)).toEqual({ days: '2', hours: '3', minutes: '15' });
    expect(splitDuration(60)).toEqual({ days: '', hours: '1', minutes: '' });
    expect(splitDuration(-5)).toEqual({ days: '', hours: '', minutes: '' });
    const split = splitDuration(3 * DAY + 61);
    expect(parseDuration(split.days, split.hours, split.minutes)).toBe(3 * DAY + 61);
  });

  it('gibt den verstrichenen Anteil an', () => {
    const timer = { start: 100, end: 200 };
    expect(timerProgress(timer, 100)).toBe(0);
    expect(timerProgress(timer, 150)).toBe(0.5);
    expect(timerProgress(timer, 500)).toBe(1);
    expect(timerProgress(timer, 0)).toBe(0);
    expect(timerProgress({ start: 5, end: 5 }, 5)).toBe(1);
  });
});

describe('Zeit bis zu einem Tag', () => {
  it('sagt voraus, was unterwegs eintritt und endet', () => {
    const base = demoCampaign();
    const now = base.state.now;
    const torch = createTimer({ label: 'Fackel', start: now, end: now + 60 });
    const ward = createTimer({ label: 'Schutzkreis', start: now, end: now + 10 * DAY });
    const done = createTimer({ label: 'Alt', start: now, end: now + 30, done: true });
    const data = { ...base, timers: { [torch.id]: torch, [ward.id]: ward, [done.id]: done } };
    const target = (dayIndexOf(now) + 2) * DAY + 6 * 60; // 19. Tauwind, 06:00
    const preview = previewPassage(data, target)!;
    expect(preview.minutes).toBe(target - now);
    expect(preview.occurred.map((o) => o.event.title).sort()).toEqual([
      'Der Graue Fang legt ab',
      'Treffen mit Brann am Nordkai',
    ]);
    expect(preview.expired.map((t) => t.label)).toEqual(['Fackel']);
    expect(describePassage(preview)).toBe(
      '1 Tag 14 Std. vergehen · 2 Termine treten ein · 1 Wirkung oder Tätigkeit endet',
    );
    // Auf dem Weg zum 19. liegt nur das Treffen am 18.; die Abfahrt gehört zum Zieltag selbst.
    expect(occurredBeforeDay(preview, dayIndexOf(target)).map((o) => o.event.title)).toEqual([
      'Treffen mit Brann am Nordkai',
    ]);
    expect(occurredBeforeDay(preview, dayIndexOf(now) + 1)).toEqual([]);
    expect(previewPassage(data, now)).toBeNull();
    expect(previewPassage(data, now - 5)).toBeNull();
  });

  it('nennt nur die Dauer, wenn nichts dazwischenliegt', () => {
    const data = world();
    const preview = previewPassage(data, data.state.now + 90)!;
    expect(describePassage(preview)).toBe('1 Std. 30 Min. vergehen');
  });
});

describe('overdueLabel', () => {
  it('sagt, seit wann etwas überfällig ist', () => {
    const now = at(17, 0, 16);
    expect(overdueLabel(now, { at: at(16), timed: false })).toBe('seit gestern überfällig');
    expect(overdueLabel(now, { at: at(12), timed: false })).toBe('seit 5 Tagen überfällig');
    expect(overdueLabel(now, { at: at(17, 0, 14), timed: true })).toBe('seit 2 Std. überfällig');
  });
});
