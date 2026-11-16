import { describe, expect, it } from 'vitest';
import { emptyCampaign } from '../../data/seed';
import { isPast, lifeFacts, pastLine, readDatePoint, yearsBetween } from '../lifespan';
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
    // „Geboren: 650“ bei einer Person ist ein Jahr, kein Alter von 650.
    expect(fromTime(cal, readDatePoint(cal, '650', now, { age: true })!.at).year).toBe(
      fromTime(cal, yearOnly.at).year,
    );
    // Heißt das Feld „Alter“, ist die Zahl allein ein Alter.
    expect(fromTime(cal, readDatePoint(cal, '34', now, { bareAge: true })!.at).year).toBe(
      year - 34,
    );
  });

  it('zählt ein Ende, das erst noch kommt, noch nicht', () => {
    const y = nowParts.year;
    const guild = createEntity({ kind: 'faction', name: 'Gilde der Sieben Lampen' });
    guild.born = { at: day(y - 40, 0, 1), precision: 'year' };
    guild.ended = { at: day(y + 10, 0, 1), precision: 'year' };
    expect(lifeFacts(world(guild), guild)).toEqual([
      { label: 'Besteht seit', text: expect.stringMatching(/^etwa 40 Jahre \(gegründet /) },
    ]);
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

  it('weiß, was der Vergangenheit angehört – Tote und Untergegangenes, kein künftiges Ende', () => {
    const y = nowParts.year;
    const king = createEntity({ kind: 'person', name: 'König Odran', person: { status: 'dead' } });
    const seer = createEntity({ kind: 'person', name: 'Seherin Ulme' });
    seer.ended = { at: day(y - 120, 0, 1), precision: 'year' };
    const ruin = createEntity({ kind: 'place', name: 'Altfurt' });
    ruin.ended = { at: day(y - 300, 0, 1), precision: 'year' };
    const doomed = createEntity({ kind: 'place', name: 'Morgenwall' });
    doomed.ended = { at: day(y + 5, 0, 1), precision: 'year' };
    const lost = createEntity({ kind: 'person', name: 'Brin', person: { status: 'missing' } });
    const data = world(king, seer, ruin, doomed, lost);
    expect(isPast(data, king)).toBe(true);
    expect(isPast(data, seer)).toBe(true);
    expect(isPast(data, ruin)).toBe(true);
    expect(isPast(data, doomed)).toBe(false);
    expect(isPast(data, lost)).toBe(false);
    expect(pastLine(data, ruin)).toBe('untergegangen vor etwa 300 Jahren');
    expect(pastLine(data, seer)).toBe('gestorben vor etwa 120 Jahren');
    // Tot ohne Tag: vergangen, aber ohne Zeitangabe.
    expect(pastLine(data, king)).toBe('');
  });
});
