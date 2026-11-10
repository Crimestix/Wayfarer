import { describe, expect, it } from 'vitest';
import { elarisCampaign } from '../../data/seed';
import { createEntity, weatherId, WeatherSchema, type CampaignData, type Place } from '../schema';
import { toTime } from '../time/calendar';
import { ELARIS_CALENDAR, ELARIS_WARMEST_MONTH } from '../time/elaris';
import {
  CLIMATE_PRESETS,
  climateOn,
  describeWeather,
  drift,
  isSheltered,
  presetClimate,
  presetClimateId,
  presetOfClimateId,
  recognizeClimate,
  simulateDay,
  temperatureAt,
  temperatureLabel,
  weatherAtMinute,
  weatherEffects,
  withManual,
  type DayWeather,
} from '../weather';
import { forecast, warmestMonth, weatherAt, weatherZone, zoneWeather } from '../weatherZone';

const cal = ELARIS_CALENDAR;
const YEAR = 28088;
/** Tagesindex des ersten Tages eines Monats. */
const firstOf = (month: number, year = YEAR) =>
  Math.floor(toTime(cal, { year, month, day: 1, hour: 0, minute: 0 }) / 1440);
const climate = (preset: (typeof CLIMATE_PRESETS)[number]) =>
  presetClimate(preset, cal.months.length, ELARIS_WARMEST_MONTH);
const days = (from: number, count: number, preset: (typeof CLIMATE_PRESETS)[number], seed = 7) =>
  Array.from({ length: count }, (_, i) => simulateDay(climate(preset), cal, seed, from + i));
const share = <T>(items: T[], test: (item: T) => boolean) =>
  items.filter(test).length / items.length;
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

describe('Zusammenhängender Zufall', () => {
  it('ist gleichverteilt und hängt von Tag zu Tag zusammen', () => {
    const values = Array.from({ length: 6000 }, (_, day) => drift(11, 'probe', day, 3));
    expect(mean(values)).toBeCloseTo(0.5, 1);
    for (const limit of [0.1, 0.3, 0.5, 0.8])
      expect(share(values, (v) => v < limit)).toBeCloseTo(limit, 1);
    // Aufeinanderfolgende Tage liegen näher beieinander als zufällig gewählte (im Mittel 1/3).
    const steps = values.slice(1).map((v, i) => Math.abs(v - values[i]!));
    expect(mean(steps)).toBeLessThan(0.24);
    // Verschiedene Kanäle und Ausgangswerte haben nichts miteinander zu tun.
    expect(drift(11, 'probe', 100, 3)).not.toBe(drift(11, 'andere', 100, 3));
    expect(drift(11, 'probe', 100, 3)).not.toBe(drift(12, 'probe', 100, 3));
    expect(drift(11, 'probe', 100, 3)).toBe(drift(11, 'probe', 100, 3));
  });
});

describe('Klimazonen', () => {
  it('schwingen zwischen dem wärmsten und dem kältesten Monat', () => {
    const temperate = climate('temperate');
    expect(temperate.id).toBe('klima-temperate');
    expect(temperate.months).toHaveLength(12);
    expect(temperate.months[ELARIS_WARMEST_MONTH]).toMatchObject({ tempMax: 23, tempMin: 13 });
    expect(temperate.months[(ELARIS_WARMEST_MONTH + 6) % 12]).toMatchObject({
      tempMax: 3,
      tempMin: -3,
    });
    const highs = temperate.months.map((m) => m.tempMax);
    expect(Math.max(...highs)).toBe(23);
    expect(Math.min(...highs)).toBe(3);
    // Zwischen den Monatsmitten wird überblendet, ohne Sprung am Monatswechsel.
    const last = climateOn(temperate, cal, firstOf(5) - 1)!;
    const next = climateOn(temperate, cal, firstOf(5))!;
    expect(Math.abs(last.tempMax - next.tempMax)).toBeLessThan(0.3);
    expect(climateOn({ ...temperate, months: [] }, cal, 5)).toBeNull();
    for (const preset of CLIMATE_PRESETS) {
      expect(presetOfClimateId(presetClimateId(preset))).toBe(preset);
      expect(isSheltered(climate(preset))).toBe(preset === 'underground');
    }
    expect(presetOfClimateId('eigenes')).toBeNull();
  });

  it('werden aus den Worten der Orte erkannt', () => {
    const place = (name: string, category = '', tags: string[] = []) => ({ name, category, tags });
    expect(recognizeClimate([place('Graufels', 'Stadt')])).toBeNull();
    expect(recognizeClimate([place('Sandmeer', 'Wüste')])).toEqual({ preset: 'desert', index: 0 });
    expect(recognizeClimate([place('Wirtshaus'), place('Nordhafen')])).toEqual({
      preset: 'maritime',
      index: 1,
    });
    // Der nähere Hinweis gilt …
    expect(recognizeClimate([place('Wachturm', 'Gebirge'), place('Küstenland')])?.preset).toBe(
      'mountain',
    );
    // … außer es liegt etwas unter der Erde: Dort gibt es kein Wetter.
    expect(
      recognizeClimate([place('Der Hafen', 'Distrikt'), place('Tiefenstadt'), place('Unterreich')]),
    ).toEqual({ preset: 'underground', index: 2 });
    expect(recognizeClimate([place('Die alte Mine')])?.preset).toBe('underground');
    // Ortsnamen auf „-berg“ oder mit „Eis“ sind kein Hinweis.
    expect(recognizeClimate([place('Rosenberg'), place('Eisenhut')])).toBeNull();
  });
});

describe('Wetter eines Tages', () => {
  it('ist wiederholbar und je Gegend verschieden', () => {
    const a = days(firstOf(3), 60, 'temperate', 1);
    const again = days(firstOf(3), 60, 'temperate', 1);
    const b = days(firstOf(3), 60, 'temperate', 2);
    expect(a).toEqual(again);
    expect(a).not.toEqual(b);
  });

  it('regnet so oft, wie das Klima sagt – in zusammenhängenden Tagen', () => {
    const year = days(firstOf(0), 365 * 12, 'temperate');
    const wet = (d: DayWeather) => d.precipitation !== 'none';
    // Gemäßigt: zwischen 35 % (Sommer) und 45 % (Winter).
    expect(share(year, wet)).toBeGreaterThan(0.36);
    expect(share(year, wet)).toBeLessThan(0.44);
    expect(share(year, (d) => d.precipitation === 'heavy')).toBeGreaterThan(0.08);
    expect(share(year, (d) => d.precipitation === 'heavy')).toBeLessThan(0.16);
    // Nach einem Regentag regnet es deutlich öfter als im Schnitt.
    const afterWet = year.slice(1).filter((_, i) => wet(year[i]!));
    expect(share(afterWet, wet)).toBeGreaterThan(share(year, wet) + 0.15);
    // Die Wüste bleibt trocken, die Tropen sind nass.
    expect(share(days(firstOf(0), 2000, 'desert'), wet)).toBeLessThan(0.07);
    expect(share(days(firstOf(0), 2000, 'tropical'), wet)).toBeGreaterThan(0.45);
  });

  it('folgt den Jahreszeiten', () => {
    const summer = days(firstOf(ELARIS_WARMEST_MONTH), 31, 'temperate');
    const winter = days(firstOf((ELARIS_WARMEST_MONTH + 6) % 12), 30, 'temperate');
    expect(mean(summer.map((d) => d.high))).toBeGreaterThan(19);
    expect(mean(summer.map((d) => d.high))).toBeLessThan(26);
    expect(mean(winter.map((d) => d.high))).toBeLessThan(6);
    expect(mean(winter.map((d) => d.low))).toBeLessThan(0);
    for (const d of [...summer, ...winter]) expect(d.high).toBeGreaterThanOrEqual(d.low);
    // Im Sommer fällt Regen, im tiefen Winter des Nordens Schnee.
    expect(summer.every((d) => d.kind === null || d.kind === 'rain')).toBe(true);
    const north = days(firstOf((ELARIS_WARMEST_MONTH + 6) % 12), 30, 'cold');
    expect(north.filter((d) => d.kind !== null).every((d) => d.kind === 'snow')).toBe(true);
    // Temperaturen hängen zusammen: von Tag zu Tag selten große Sprünge.
    const jumps = summer.slice(1).map((d, i) => Math.abs(d.high - summer[i]!.high));
    expect(mean(jumps)).toBeLessThan(3.5);
  });

  it('kennt Wind, Nebel und den Himmel', () => {
    const coast = days(firstOf(0), 3000, 'maritime');
    const inland = days(firstOf(0), 3000, 'temperate');
    expect(share(coast, (d) => d.wind !== 'none')).toBeGreaterThan(
      share(inland, (d) => d.wind !== 'none') + 0.1,
    );
    // Sturm kommt gern mit starkem Regen.
    const storm = (d: DayWeather) => d.wind === 'strong';
    expect(
      share(
        inland.filter((d) => d.precipitation === 'heavy'),
        storm,
      ),
    ).toBeGreaterThan(
      share(
        inland.filter((d) => d.precipitation === 'none'),
        storm,
      ),
    );
    // Nebel nie im Sturm und nie im Starkregen.
    for (const d of inland.filter((x) => x.fog)) {
      expect(d.wind).not.toBe('strong');
      expect(d.precipitation).not.toBe('heavy');
    }
    expect(share(inland, (d) => d.fog)).toBeGreaterThan(0.03);
    // Niederschlag heißt bedeckter Himmel; ohne ist jede Bewölkung möglich.
    expect(
      inland.filter((d) => d.precipitation !== 'none').every((d) => d.sky === 'overcast'),
    ).toBe(true);
    expect(new Set(inland.map((d) => d.sky)).size).toBe(4);
  });

  it('verteilt Niederschlag und Nebel über den Tag', () => {
    const all = days(firstOf(0), 3000, 'temperate');
    for (const d of all) {
      expect(d.parts.map((p) => p.key)).toEqual(['night', 'morning', 'day', 'evening']);
      const wetParts = d.parts.filter((p) => p.precipitation !== 'none').length;
      if (d.precipitation === 'none') expect(wetParts).toBe(0);
      if (d.precipitation === 'light') {
        expect(wetParts).toBeGreaterThanOrEqual(1);
        expect(wetParts).toBeLessThanOrEqual(3);
        expect(d.parts.some((p) => p.precipitation === 'heavy')).toBe(false);
      }
      if (d.precipitation === 'heavy') {
        expect(wetParts).toBeGreaterThanOrEqual(2);
        expect(d.parts.some((p) => p.precipitation === 'heavy')).toBe(true);
      }
      if (d.fog) expect(d.parts.find((p) => p.key === 'morning')!.fog).toBe(true);
      else expect(d.parts.some((p) => p.fog)).toBe(false);
      // Nachts am kältesten, nachmittags am wärmsten.
      expect(d.parts[0]!.temperature).toBe(d.low);
      expect(d.parts[2]!.temperature).toBe(d.high);
    }
  });

  it('kennt unter der Erde kein Wetter', () => {
    for (const d of days(firstOf(0), 400, 'underground')) {
      expect(d).toMatchObject({ sheltered: true, precipitation: 'none', wind: 'none', fog: false });
      expect(d.high).toBeGreaterThanOrEqual(10);
      expect(d.high).toBeLessThanOrEqual(13);
    }
  });
});

describe('Wetter zu einer Uhrzeit, in Worten und nach Regelwerk', () => {
  const base: DayWeather = {
    day: 1,
    high: 20,
    low: 10,
    precipitation: 'heavy',
    kind: 'rain',
    wind: 'strong',
    fog: true,
    sky: 'overcast',
    parts: [
      { key: 'night', temperature: 10, precipitation: 'none', fog: true },
      { key: 'morning', temperature: 15, precipitation: 'light', fog: true },
      { key: 'day', temperature: 20, precipitation: 'heavy', fog: false },
      { key: 'evening', temperature: 15, precipitation: 'none', fog: false },
    ],
    manual: false,
    sheltered: false,
    note: '',
  };

  it('liest den Tagesabschnitt und die Temperatur ab', () => {
    expect(temperatureAt(base, 15)).toBe(20);
    expect(temperatureAt(base, 3)).toBe(10);
    expect(temperatureAt(base, 9)).toBe(15);
    expect(weatherAtMinute(base, 2 * 60)).toMatchObject({
      part: 'night',
      precipitation: 'none',
      kind: null,
      fog: true,
    });
    expect(weatherAtMinute(base, 13 * 60)).toMatchObject({
      part: 'day',
      precipitation: 'heavy',
      kind: 'rain',
      fog: false,
      wind: 'strong',
    });
    expect(weatherAtMinute(base, 23 * 60 + 59).part).toBe('evening');
  });

  it('beschreibt das Wetter in wenigen Worten', () => {
    expect(describeWeather(weatherAtMinute(base, 13 * 60))).toBe('Starker Regen, starker Wind');
    expect(describeWeather(weatherAtMinute(base, 8 * 60))).toBe(
      'Leichter Regen, Nebel, starker Wind',
    );
    expect(
      describeWeather({ ...weatherAtMinute(base, 20 * 60), wind: 'light', sky: 'clear' }),
    ).toBe('Klar, windig');
    expect(describeWeather({ ...weatherAtMinute(base, 20 * 60), wind: 'none', sky: 'fair' })).toBe(
      'Heiter',
    );
    expect(describeWeather({ ...weatherAtMinute(base, 13 * 60), kind: 'snow', wind: 'none' })).toBe(
      'Starker Schneefall',
    );
    expect(describeWeather({ ...weatherAtMinute(base, 13 * 60), sheltered: true })).toBe(
      'Kein Wetter',
    );
    expect(temperatureLabel(-4.4)).toBe('−4 °C');
    expect(temperatureLabel(21)).toBe('21 °C');
  });

  it('nennt die Folgen nach Regelwerk', () => {
    const titles = (weather: Parameters<typeof weatherEffects>[0]) =>
      weatherEffects(weather).map((effect) => effect.title);
    const now = weatherAtMinute(base, 13 * 60);
    expect(titles(now)).toEqual(['Starker Wind', 'Starker Niederschlag']);
    expect(titles({ ...now, temperature: -20, kind: 'snow' })).toEqual([
      'Extreme Kälte',
      'Starker Wind',
      'Starker Schneefall',
    ]);
    expect(titles({ ...now, temperature: 39, precipitation: 'none', wind: 'none' })).toEqual([
      'Extreme Hitze',
    ]);
    expect(titles({ ...now, precipitation: 'light', wind: 'light', fog: true })).toEqual(['Nebel']);
    expect(titles({ ...now, sheltered: true })).toEqual([]);
    expect(titles({ ...now, precipitation: 'none', wind: 'light', temperature: 15 })).toEqual([]);
  });

  it('lässt sich von Hand festlegen', () => {
    const manual = WeatherSchema.parse({
      id: 'x',
      climateId: 'klima-temperate',
      day: 1,
      temperature: 2,
      precipitation: 'light',
      wind: 'none',
      fog: true,
      manual: true,
      note: 'Der Fluch liegt über dem Tal.',
    });
    const set = withManual({ ...base, sheltered: true }, manual);
    expect(set).toMatchObject({
      manual: true,
      sheltered: false,
      high: 2,
      low: -8,
      precipitation: 'light',
      kind: 'sleet',
      wind: 'none',
      fog: true,
      sky: 'overcast',
      note: 'Der Fluch liegt über dem Tal.',
    });
    expect(set.parts.every((p) => p.precipitation === 'light')).toBe(true);
    expect(set.parts.map((p) => p.fog)).toEqual([true, true, false, false]);
    expect(withManual(base, undefined)).toBe(base);
  });
});

describe('Wetter an einem Ort', () => {
  function world() {
    const base = elarisCampaign();
    const land = createEntity({ kind: 'place', name: 'Graumark' });
    const city = createEntity({ kind: 'place', name: 'Hohenfurt', place: { parentId: land.id } });
    const inn = createEntity({ kind: 'place', name: 'Zum Aal', place: { parentId: city.id } });
    const coast = createEntity({ kind: 'place', name: 'Nordküste', place: { parentId: land.id } });
    const deep = createEntity({
      kind: 'place',
      name: 'Die alte Mine',
      place: { parentId: city.id },
    });
    const far = createEntity({ kind: 'place', name: 'Ferne Lande' });
    const data: CampaignData = {
      ...base,
      entities: Object.fromEntries([land, city, inn, coast, deep, far].map((e) => [e.id, e])),
    };
    return { data, land, city, inn, coast, deep, far };
  }

  it('kennt für Elaris den Hochsommer und lässt ihn festlegen', () => {
    const { data } = world();
    expect(warmestMonth(data)).toBe(ELARIS_WARMEST_MONTH);
    expect(warmestMonth({ ...data, campaign: { ...data.campaign, warmestMonth: 7 } })).toBe(7);
    const foreign = {
      ...data,
      campaign: { ...data.campaign, calendar: { ...data.campaign.calendar, id: 'eigen' } },
    };
    expect(warmestMonth(foreign)).toBe(7);
  });

  it('findet die Zone: festgelegt vor erkannt vor Vorgabe', () => {
    const { data, land, city, inn, coast, deep } = world();
    expect(weatherZone(data, inn.id)).toMatchObject({ source: 'default', preset: 'temperate' });
    expect(weatherZone(data, null)).toMatchObject({ source: 'default', from: null });
    expect(weatherZone(data, coast.id)).toMatchObject({
      source: 'recognized',
      preset: 'maritime',
      from: { id: coast.id },
    });
    expect(weatherZone(data, deep.id)).toMatchObject({ preset: 'underground' });

    // Ein für das Land festgelegtes Klima gilt für alles darunter – auch für die Küste.
    const cold = presetClimate('cold', 12, ELARIS_WARMEST_MONTH);
    const chosen: CampaignData = {
      ...data,
      climates: { [cold.id]: cold },
      entities: {
        ...data.entities,
        [land.id]: { ...land, place: { ...land.place, climateId: cold.id } } as Place,
      },
    };
    for (const id of [city.id, inn.id, coast.id])
      expect(weatherZone(chosen, id)).toMatchObject({
        source: 'chosen',
        preset: 'cold',
        from: { id: land.id },
      });
    // Zeigt ein Ort auf ein gelöschtes Klima, zählt das nicht.
    const dangling: CampaignData = { ...chosen, climates: {} };
    expect(weatherZone(dangling, city.id).source).toBe('default');
  });

  it('teilt das Wetter innerhalb einer Gegend und trennt Gegenden', () => {
    const { data, city, inn, far } = world();
    const day = firstOf(3);
    const here = forecast(data, weatherZone(data, inn.id), day, 40);
    expect(forecast(data, weatherZone(data, city.id), day, 40)).toEqual(here);
    expect(forecast(data, weatherZone(data, far.id), day, 40)).not.toEqual(here);
    // Eine andere Kampagne hat anderes Wetter.
    const other = { ...data, campaign: { ...data.campaign, created: 'andere' } };
    expect(forecast(other, weatherZone(other, inn.id), day, 40)).not.toEqual(here);
  });

  it('nimmt festgelegtes Wetter vor errechnetem und kennt die Uhrzeit', () => {
    const { data, inn } = world();
    const zone = weatherZone(data, inn.id);
    const time = toTime(cal, { year: YEAR, month: 4, day: 10, hour: 14, minute: 30 });
    const day = Math.floor(time / 1440);
    const fixed = WeatherSchema.parse({
      id: weatherId(zone.climate.id, day),
      climateId: zone.climate.id,
      day,
      temperature: 31,
      precipitation: 'heavy',
      wind: 'strong',
      manual: true,
    });
    const set: CampaignData = { ...data, weather: { [fixed.id]: fixed } };
    expect(zoneWeather(data, zone, day).manual).toBe(false);
    const at = weatherAt(set, inn.id, time);
    expect(at.today).toMatchObject({ manual: true, high: 31, precipitation: 'heavy' });
    expect(at.now).toMatchObject({ part: 'day', precipitation: 'heavy', wind: 'strong' });
    expect(at.now.temperature).toBeGreaterThan(29);
    expect(at.effects.map((e) => e.title)).toEqual(['Starker Wind', 'Starker Niederschlag']);
    // Der Tag davor ist unberührt.
    expect(weatherAt(set, inn.id, time - 1440).today.manual).toBe(false);
  });
});
