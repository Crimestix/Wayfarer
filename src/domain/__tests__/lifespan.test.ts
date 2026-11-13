import { describe, expect, it } from 'vitest';
import { emptyCampaign } from '../../data/seed';
import { lifeFacts, readDatePoint, yearsBetween } from '../lifespan';
import { createEntity, type CampaignData, type Entity } from '../schema';
import { fromTime, toTime } from '../time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../time/elaris';

const cal = ELARIS_CALENDAR;
/** 17. Tauwind 701 (der Beginn der erfundenen Testwelt). */
const now = ELARIS_START;
const nowParts = fromTime(cal, now);
const day = (year: number, month: number, d: number) =>
  toTime(cal, { year, month, day: d, hour: 0, minute: 0 });

function world(...entities: Entity[]): CampaignData {
  const data = emptyCampaign('Testwelt', cal, now) as CampaignData;
  return { ...data, entities: Object.fromEntries(entities.map((e) => [e.id, e])) };
}

describe('Lebensdaten', () => {
  it('liest Tage, Jahre, „vor N Jahren“ und ein Alter', () => {
    const year = nowParts.year;
    expect(readDatePoint(cal, '', now)).toBeNull();
    expect(readDatePoint(cal, 'irgendwann', now)).toBeNull();
    const yearOnly = readDatePoint(cal, '650', now)!;
    expect(yearOnly.precision).toBe('year');
    expect(fromTime(cal, yearOnly.at).year).toBe(
      fromTime(cal, readDatePoint(cal, 'Jahr 650', now)!.at).year,
    );
    expect(readDatePoint(cal, 'vor 300 Jahren', now)).toMatchObject({ precision: 'year' });
    expect(fromTime(cal, readDatePoint(cal, 'vor 300 Jahren', now)!.at).year).toBe(year - 300);
    // Ein Alter nur, wo eines gemeint sein kann.
    expect(readDatePoint(cal, '34', now)).not.toBeNull(); // als Jahr 34
    expect(fromTime(cal, readDatePoint(cal, 'Alter 34', now, { age: true })!.at).year).toBe(
      year - 34,
    );
    expect(fromTime(cal, readDatePoint(cal, '34 Jahre', now, { age: true })!.at).year).toBe(
      year - 34,
    );
  });

  it('rechnet volle Jahre nach Tag und Monat', () => {
    const y = nowParts.year;
    const born = { at: day(y - 30, nowParts.month, nowParts.day + 1), precision: 'day' as const };
    expect(yearsBetween(cal, born, now)).toBe(29);
    expect(yearsBetween(cal, { ...born, precision: 'year' }, now)).toBe(30);
  });

  it('nennt Alter, Tod und Gründung', () => {
    const y = nowParts.year;
    const mira = createEntity({ kind: 'person', name: 'Mira Tannhaus' });
    mira.born = { at: day(y - 34, 0, 1), precision: 'day' };
    const odo = createEntity({ kind: 'person', name: 'Odo Tannhaus' });
    odo.born = { at: day(y - 64, 0, 1), precision: 'year' };
    odo.ended = { at: day(y - 12, 0, 1), precision: 'year' };
    const town = createEntity({ kind: 'place', name: 'Hohenfurt' });
    town.born = { at: day(y - 300, 0, 1), precision: 'year' };
    const data = world(mira, odo, town);
    expect(lifeFacts(data, mira)).toEqual([{ label: 'Alter', text: '34 Jahre' }]);
    expect(lifeFacts(data, odo)).toEqual([
      { label: 'Alter', text: 'starb mit etwa 52' },
      { label: 'Gestorben', text: 'vor etwa 12 Jahren', tone: 'danger' },
    ]);
    expect(lifeFacts(data, town)[0]).toMatchObject({
      label: 'Besteht seit',
      text: expect.stringMatching(/^etwa 300 Jahre \(gegründet /),
    });
    // Ohne Lebensdaten: nichts.
    expect(lifeFacts(data, createEntity({ kind: 'person', name: 'Lando' }))).toEqual([]);
  });
});
