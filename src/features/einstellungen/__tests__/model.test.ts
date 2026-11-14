import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../../data/db';
import { elarisCampaign } from '../../../data/seed';
import { MemoryStore } from '../../../data/store';
import { setSeasons } from '../../kalender/actions';
import { formatDateTime, moonPhase, toTime, type CalendarDef } from '../../../domain/time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../../../domain/time/elaris';
import {
  adoptComputedSeasons,
  calendarSummary,
  cleanCampaignName,
  currentYearLength,
  eraRows,
  explainProblem,
  explainProblems,
  isInsideFolder,
  leapText,
  monthRows,
  moonCycleText,
  moonRows,
  seasonSettings,
  weekdayRows,
} from '../model';

const cal = ELARIS_CALENDAR;
const SIMPLE: CalendarDef = {
  id: 'schlicht',
  name: 'Schlichter Kalender',
  months: [{ name: 'Einmond', days: 30 }],
  weekdays: ['Tag'],
  leapRule: 'none',
  weekdayAnchor: { day: 0, weekday: 0 },
  eras: [{ id: 'z', label: 'Z', offset: 0 }],
  moons: [],
};

describe('Kampagnenname', () => {
  it('räumt Leerraum auf und begrenzt die Länge', () => {
    expect(cleanCampaignName('  Elaris  ')).toBe('Elaris');
    expect(cleanCampaignName('Die   Gezeichneten\n von Elaris')).toBe(
      'Die Gezeichneten von Elaris',
    );
    expect(cleanCampaignName('x'.repeat(100))).toHaveLength(60);
  });
  it('lehnt leere Namen ab', () => {
    expect(cleanCampaignName('')).toBeNull();
    expect(cleanCampaignName('  \n ')).toBeNull();
  });
});

describe('Ordnerprüfung', () => {
  it('erkennt denselben Ordner und Unterordner auf macOS und Windows', () => {
    expect(isInsideFolder('/Users/sl/Elaris', '/Users/sl/Elaris')).toBe(true);
    expect(isInsideFolder('/Users/sl/Elaris', '/users/SL/elaris/Sicherungen')).toBe(true);
    expect(isInsideFolder('/Users/sl/Elaris/', '/Users/sl/Elaris')).toBe(true);
    expect(
      isInsideFolder('C:\\Users\\SL\\OneDrive\\Elaris', 'c:/users/sl/onedrive/elaris\\alt'),
    ).toBe(true);
  });
  it('verwechselt keine Ordner mit gleichem Anfang', () => {
    expect(isInsideFolder('/Users/sl/Elaris', '/Users/sl/Elaris-Sicherungen')).toBe(false);
    expect(isInsideFolder('/Users/sl/Elaris', '/Users/sl')).toBe(false);
    expect(isInsideFolder('', '/Users/sl')).toBe(false);
  });
});

describe('Probleme beim Laden erklären', () => {
  it('erkennt Konfliktkopien an Meldung oder Dateinamen', () => {
    const byMessage = explainProblem({
      path: 'entities/abc123.json',
      message: 'Dateiname und Kennung passen nicht zusammen (vermutlich eine Konfliktkopie).',
    });
    expect(byMessage).toMatchObject({
      kind: 'conflict',
      what: 'Eintrag der Welt',
      path: 'entities/abc123.json',
    });
    for (const path of [
      'chronicle/abc (Konflikt).json',
      'chronicle/abc (conflicted copy 2026-11-10).json',
      'chronicle/abc (1).json',
      'chronicle/abc - Kopie.json',
      'chronicle/abc-DESKTOP-4F2K.json',
      'chronicle/abc 2.json',
    ])
      expect(explainProblem({ path, message: 'Unexpected token' })).toMatchObject({
        kind: 'conflict',
        what: 'Chronikeintrag',
      });
  });

  it('unterscheidet beschädigte Dateien von Dateien mit falschem Inhalt', () => {
    expect(
      explainProblem({
        path: 'events/markt.json',
        message: "Expected property name or '}' in JSON at position 2",
      }),
    ).toMatchObject({ kind: 'damaged', what: 'Termin' });
    const shape = explainProblem({
      path: 'timers/fackel.json',
      message:
        '[\n  {\n    "expected": "string",\n    "code": "invalid_type",\n    "path": ["label"]',
    });
    expect(shape).toMatchObject({ kind: 'shape', what: 'Timer' });
    expect(shape.reason).not.toMatch(/invalid_type|JSON/);
    expect(shape.detail).toContain('invalid_type');
    expect(explainProblem({ path: 'sonstwo/x.json', message: 'Unlesbar' }).what).toBe('Datei');
  });

  it('nennt jede Datei nur einmal, auch wenn sie mehrfach gemeldet wurde', () => {
    const list = explainProblems([
      { path: 'events/b.json', message: 'Unexpected end of JSON input' },
      { path: 'chronicle/a.json', message: 'Unexpected token' },
      { path: 'events/b.json', message: '[{"code":"invalid_type"}]' },
    ]);
    expect(list.map((p) => p.path)).toEqual(['chronicle/a.json', 'events/b.json']);
    // Die letzte Meldung zählt.
    expect(list[1]).toMatchObject({ kind: 'shape', detail: '[{"code":"invalid_type"}]' });
    expect(explainProblems([])).toEqual([]);
  });
});

describe('Kalender lesbar', () => {
  it('fasst Jahr und Woche zusammen', () => {
    expect(calendarSummary(cal)).toBe(
      '12 Monate · 365 Tage, im Schaltjahr 366 · Woche mit 7 Tagen',
    );
    expect(calendarSummary(SIMPLE)).toBe('1 Monat · 30 Tage · Woche mit 1 Tag');
  });

  it('listet die Monate mit Tagen, Schalttagen und dem laufenden Monat', () => {
    const rows = monthRows(cal, ELARIS_START);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ index: 0, name: 'Tauwind', days: 31, leapDays: null, current: true });
    expect(rows[1]).toEqual({
      index: 1,
      name: 'Grünbruch',
      days: 28,
      leapDays: 29,
      current: false,
    });
    expect(rows.filter((r) => r.current)).toHaveLength(1);
    expect(monthRows({ ...cal, leapRule: 'none' }, ELARIS_START)[1]!.leapDays).toBeNull();
  });

  it('erklärt die Schaltjahre und nennt das laufende oder nächste', () => {
    // 701 AD = JF 28088, durch 4 teilbar.
    expect(leapText(cal, ELARIS_START)).toBe(
      'Jedes vierte Jahr der Zählung JF ist ein Schaltjahr – ausgenommen volle Jahrhunderte, die nicht durch 400 teilbar sind. Dann hat der Grünbruch 29 statt 28 Tage. 701 AD ist ein Schaltjahr.',
    );
    const next = toTime(cal, { year: 702 + 27387, month: 0, day: 1, hour: 0, minute: 0 });
    expect(leapText(cal, next)).toMatch(/Das nächste Schaltjahr ist 705 AD\.$/);
    expect(leapText(SIMPLE, 0)).toBe('Dieser Kalender kennt keine Schaltjahre.');
    expect(currentYearLength(cal, ELARIS_START)).toBe(366);
    expect(currentYearLength(cal, next)).toBe(365);
  });

  it('zeigt jede Zeitrechnung mit dem laufenden Jahr', () => {
    expect(eraRows(cal, ELARIS_START)).toEqual([
      { id: 'ad', label: 'AD', year: 701, primary: true, relation: '' },
      { id: 'jf', label: 'JF', year: 28088, primary: false, relation: '27.387 Jahre vor AD' },
    ]);
  });

  it('markiert den heutigen Wochentag', () => {
    const rows = weekdayRows(cal, ELARIS_START);
    expect(rows.map((r) => r.name)).toEqual(cal.weekdays);
    expect(rows.filter((r) => r.today).map((r) => r.name)).toEqual(['Leuchtabend']);
  });

  it('beschreibt die Monde mit Umlaufzeit, Phase, letztem Neumond und nächstem Vollmond', () => {
    expect(cal.moons.map(moonCycleText)).toEqual(['22,9 Tage', '41 Tage']);
    const rows = moonRows(cal, ELARIS_START);
    expect(rows.map((r) => [r.moon.name, r.cycle, r.phase])).toEqual([
      ['Caldus', '22,9 Tage', 'Neumond'],
      ['Damaros', '41 Tage', 'Vollmond'],
    ]);
    for (const row of rows) {
      expect(row.lastNew).not.toBeNull();
      expect(row.lastNew!).toBeLessThanOrEqual(ELARIS_START);
      expect(ELARIS_START - row.lastNew!).toBeLessThan(row.moon.period);
      expect(moonPhase(row.moon, row.lastNew!).light).toBe(0);
      expect(moonPhase(row.moon, row.nextFull).light).toBe(100);
    }
    expect(formatDateTime(cal, rows[0]!.lastNew!)).toBe('16. Tauwind 701 AD, 13:12');
    // Vor dem ersten Neumond der Zeitrechnung gibt es keinen „letzten Neumond“.
    expect(moonRows(cal, 10)[0]!.lastNew).toBeNull();
  });
});

describe('Jahreszeiten in den Einstellungen', () => {
  it('zeigt die errechneten, bis der Spielleiter sie übernimmt und ändert', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const before = seasonSettings(db.getSnapshot());
    expect(before.own).toBe(false);
    expect(before.computedText[0]).toBe('Frühling: Tauwind, Grünbruch, Blüthain');
    expect(before.months[4]).toEqual({ index: 4, season: null, computed: 'Sommer' });

    setSeasons(db, adoptComputedSeasons(db.getSnapshot()));
    const adopted = seasonSettings(db.getSnapshot());
    expect(adopted.own).toBe(true);
    expect(adopted.seasons.map((s) => s.name)).toEqual(['Frühling', 'Sommer', 'Herbst', 'Winter']);
    expect(adopted.months[4]!.season).toBe(1);

    setSeasons(db, []);
    expect(seasonSettings(db.getSnapshot()).own).toBe(false);
  });
});
