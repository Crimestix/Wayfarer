import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { natureHere } from '../nature';
import { createEntity } from '../schema';
import {
  addSeason,
  assignMonth,
  cleanSeasons,
  monthsOfChoice,
  readSeasons,
  removeSeason,
  renameSeason,
  seasonNow,
  seasonOfMonthIn,
  seasonYear,
  seasonsAt,
  seasonsFromComputed,
} from '../seasons';
import type { SeasonDef } from '../time/calendar';
import { ELARIS_CALENDAR } from '../time/elaris';

const withSeasons = (seasons: SeasonDef[]) => ({ ...ELARIS_CALENDAR, seasons });
const sorted = (months: Iterable<number> | null | undefined) =>
  [...(months ?? [])].sort((a, b) => a - b);

/** Zwei Jahreszeiten, wie sie ein Spielleiter für eine heiße Gegend festlegen könnte. */
const WET_DRY: SeasonDef[] = [
  { name: 'Regenzeit', months: [9, 10, 11, 0, 1] },
  { name: 'Trockenzeit', months: [2, 3, 4, 5, 6, 7, 8] },
];

describe('Jahreszeiten des Kalenders', () => {
  it('rechnet ohne Festlegung vier Viertel um den wärmsten Monat', () => {
    const year = seasonYear(ELARIS_CALENDAR, 4);
    expect(year.own).toBe(false);
    expect(year.seasons.map((s) => [s.name, s.months])).toEqual([
      ['Frühling', [0, 1, 2]],
      ['Sommer', [3, 4, 5]],
      ['Herbst', [6, 7, 8]],
      ['Winter', [9, 10, 11]],
    ]);
    expect(seasonOfMonthIn(year, 7)?.name).toBe('Herbst');
  });

  it('nimmt die festgelegten Jahreszeiten mit ihren Namen', () => {
    const year = seasonYear(withSeasons(WET_DRY), 4);
    expect(year.own).toBe(true);
    expect(year.seasons.map((s) => s.name)).toEqual(['Regenzeit', 'Trockenzeit']);
    expect(seasonOfMonthIn(year, 0)?.name).toBe('Regenzeit');
    expect(sorted(readSeasons(ELARIS_CALENDAR, year, ['Regenzeit']).months)).toEqual([
      0, 1, 9, 10, 11,
    ]);
    // Die üblichen Wörter meinen die Jahreszeit, die die meisten ihrer Monate hat.
    expect(sorted(readSeasons(ELARIS_CALENDAR, year, ['Herbst']).months)).toEqual([
      2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(sorted(readSeasons(ELARIS_CALENDAR, year, ['Winter']).months)).toEqual([
      0, 1, 9, 10, 11,
    ]);
    // Spannen gehen in der Reihenfolge der Liste.
    expect(readSeasons(ELARIS_CALENDAR, year, ['Regenzeit bis Trockenzeit']).months?.size).toBe(12);
    expect(sorted(monthsOfChoice(ELARIS_CALENDAR, year, 's:own-1'))).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it('nimmt eine umbenannte oder verschobene Jahreszeit beim Wort', () => {
    const year = seasonYear(
      withSeasons([
        { name: 'Frühling', months: [1, 2, 3] },
        { name: 'Sommer', months: [4, 5, 6] },
        { name: 'Laubfall', months: [7, 8] },
        { name: 'Winter', months: [9, 10, 11] },
      ]),
      4,
    );
    expect(sorted(readSeasons(ELARIS_CALENDAR, year, ['Sommer']).months)).toEqual([4, 5, 6]);
    // „Herbst“ meint den Laubfall – er hat die meisten Monate des errechneten Herbstes.
    expect(sorted(readSeasons(ELARIS_CALENDAR, year, ['Herbst']).months)).toEqual([7, 8]);
    // Ein Monat ohne Jahreszeit gehört zu keiner – nichts wird erfunden.
    expect(seasonOfMonthIn(year, 0)).toBeNull();
  });

  it('nimmt eine gleichnamige Jahreszeit ohne Monate nicht als das übliche Wort', () => {
    // Gerade hinzugefügt und „Winter“ genannt, aber noch ohne Monat: „Winter“ bei einer Pflanze
    // meint weiter die Jahreszeit mit den meisten Wintermonaten – nicht „das ganze Jahr“.
    const year = seasonYear(withSeasons([...WET_DRY, { name: 'Winter', months: [] }]), 4);
    expect(sorted(readSeasons(ELARIS_CALENDAR, year, ['Winter']).months)).toEqual([
      0, 1, 9, 10, 11,
    ]);
  });

  it('versetzt auf der Südhalbkugel auch die festgelegten Monate um ein halbes Jahr', () => {
    const year = seasonYear(withSeasons(WET_DRY), 10, true);
    expect(year.seasons[0]!.months).toEqual([3, 4, 5, 6, 7]);
  });

  it('lässt Namenlose weg und zählt keinen Monat doppelt', () => {
    expect(
      cleanSeasons(
        [
          { name: 'A', months: [0, 1, 1, 14] },
          { name: 'B', months: [1, 2] },
        ],
        12,
      ),
    ).toEqual([
      { name: 'A', months: [0, 1] },
      { name: 'B', months: [2] },
    ]);
    expect(seasonYear(withSeasons([{ name: '  ', months: [0] }]), 4).own).toBe(false);
  });

  it('legt fest: errechnet übernehmen, Monate zuordnen, umbenennen, hinzufügen, herausnehmen', () => {
    let seasons = seasonsFromComputed(12, 4);
    expect(seasons.map((s) => s.name)).toEqual(['Frühling', 'Sommer', 'Herbst', 'Winter']);
    seasons = assignMonth(seasons, 2, 1);
    expect(seasons[0]!.months).toEqual([0, 1]);
    expect(seasons[1]!.months).toEqual([2, 3, 4, 5]);
    seasons = assignMonth(seasons, 5, null);
    expect(seasons.flatMap((s) => s.months)).not.toContain(5);
    seasons = renameSeason(seasons, 2, 'Laubfall');
    expect(seasons[2]!.name).toBe('Laubfall');
    seasons = addSeason(seasons, 'Sturmzeit');
    expect(seasons).toHaveLength(5);
    seasons = removeSeason(seasons, 0);
    expect(seasons.map((s) => s.name)).toEqual(['Sommer', 'Laubfall', 'Winter', 'Sturmzeit']);
  });

  it('gilt überall, wo Jahreszeiten gelesen werden: auch beim Wachsen am Ort', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const town = db.put(
      'entities',
      createEntity({
        kind: 'place',
        name: 'Hohenfurt',
        place: { category: 'Dorf im Wald' },
      } as never),
    );
    db.put(
      'entities',
      createEntity({
        kind: 'plant',
        name: 'Regenmoos',
        plant: { habitat: ['Wald'], seasons: ['Regenzeit'] },
      } as never),
    );
    // Ohne die Regenzeit im Kalender kann Wayfarer das Wort nicht lesen – es schränkt nichts ein.
    expect(natureHere(db.getSnapshot(), town.id).map((hit) => hit.entity.name)).toEqual([
      'Regenmoos',
    ]);
    db.setCampaign({ calendar: withSeasons(WET_DRY) });
    const data = db.getSnapshot();
    expect(seasonsAt(data).own).toBe(true);
    // Der Grundstand steht im Tauwind (Monat 0): Regenzeit.
    expect(seasonNow(data, town.id).season?.name).toBe('Regenzeit');
    expect(natureHere(data, town.id)[0]?.seasonal).toBe('Regenzeit');
    db.setState({ now: data.state.now + 120 * 24 * 60 });
    expect(seasonNow(db.getSnapshot(), town.id).season?.name).toBe('Trockenzeit');
    expect(natureHere(db.getSnapshot(), town.id)).toEqual([]);
  });
});
