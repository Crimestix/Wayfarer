import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { markContinuityOk } from '../../features/offen/actions';
import { setKin } from '../../features/welt/kin';
import { allContinuityIssues, continuityIssues, issuesAbout, pointEnd } from '../continuity';
import {
  createChronicleEntry,
  createEntity,
  createLoot,
  createPath,
  type ChronicleEntry,
  type DatePoint,
} from '../schema';
import { MINUTES_PER_DAY, fromTime, toTime } from '../time/calendar';

const DAY = MINUTES_PER_DAY;

/** Hohenfurt, die Salzgrotte, Mira und Odo Tannhaus, Brann Eichwald – alles erfunden. */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const now = db.getSnapshot().state.now;
  const cal = db.getSnapshot().campaign.calendar;
  const place = (name: string, parentId: string | null = null) =>
    db.put('entities', createEntity({ kind: 'place', name, place: { parentId } }));
  const person = (name: string, extra: Record<string, unknown> = {}) =>
    db.put('entities', createEntity({ kind: 'person', name, ...extra }));
  const add = (init: Partial<ChronicleEntry> & { at: number }) =>
    db.put('chronicle', createChronicleEntry(init));
  const year = fromTime(cal, now).year;
  const yearPoint = (y: number): DatePoint => ({
    at: toTime(cal, { year: y, month: 0, day: 1, hour: 0, minute: 0 }),
    precision: 'year',
  });
  const dayPoint = (at: number): DatePoint => ({ at, precision: 'day' });
  const town = place('Hohenfurt');
  const grotto = place('Salzgrotte');
  const mira = person('Mira Tannhaus', { person: { gender: 'f' } });
  const odo = person('Odo Tannhaus', { person: { gender: 'm' } });
  const brann = person('Brann Eichwald');
  const keys = () => allContinuityIssues(db.getSnapshot()).map((issue) => issue.key);
  const issues = () => continuityIssues(db.getSnapshot());
  return {
    db,
    now,
    year,
    yearPoint,
    dayPoint,
    town,
    grotto,
    mira,
    odo,
    brann,
    add,
    person,
    place,
    keys,
    issues,
  };
}

describe('Passt nicht zusammen', () => {
  it('eine leere Welt hat keine Widersprüche', async () => {
    const { issues } = await setup();
    expect(issues()).toEqual([]);
  });

  it('wer tot ist, wird danach nicht mehr getroffen – außer ein späteres Schicksal hebt es auf', async () => {
    const { add, now, mira, odo, brann, issues } = await setup();
    const fate = add({
      kind: 'fate',
      at: now - 5 * DAY,
      fate: { entityId: mira.id, status: 'dead', before: 'alive' },
    });
    const before = add({ kind: 'meeting', at: now - 6 * DAY, refs: [mira.id] });
    const meeting = add({ kind: 'meeting', at: now - 3 * DAY, refs: [mira.id, odo.id] });
    const quote = add({
      kind: 'quote',
      at: now - 2 * DAY,
      text: 'Nie wieder',
      refs: [odo.id, mira.id],
    });
    const found = issues().filter((issue) => issue.key.startsWith('dead-seen:'));
    expect(found.map((issue) => issue.entryId)).toEqual([meeting.id]);
    expect(found[0]!.weight).toBe('warn');
    expect(found[0]!.refs).toEqual([mira.id]);
    expect(found[0]!.text).toMatch(
      /^Mira Tannhaus starb laut Chronik am .+, wird aber am .+ noch getroffen\.$/,
    );
    // Odo spricht im Zitat, nicht Mira; vor dem Tod getroffen zu werden ist in Ordnung.
    expect(found.map((issue) => issue.entryId)).not.toContain(quote.id);
    expect(found.map((issue) => issue.entryId)).not.toContain(before.id);
    // Gleicher Vorname, andere Person: Brann ist nicht betroffen.
    add({
      kind: 'attitude',
      at: now - DAY,
      attitude: { fromId: brann.id, toId: 'party', before: 0, after: 1 },
    });
    expect(issues().filter((issue) => issue.key.startsWith('dead-seen:'))).toHaveLength(1);
    // Wiedergefunden: ein späteres Schicksal hebt es auf.
    add({ kind: 'fate', at: now, fate: { entityId: mira.id, status: 'alive', before: 'dead' } });
    expect(issues().filter((issue) => issue.key.startsWith('dead-seen:'))).toEqual([]);
    expect(fate.id).toBeTruthy();
  });

  it('verschollen ist nur ein Hinweis; Haltung und neue Beziehung zählen als dabei', async () => {
    const { add, now, mira, odo, issues } = await setup();
    add({
      kind: 'fate',
      at: now - 5 * DAY,
      fate: { entityId: odo.id, status: 'missing', before: 'alive' },
    });
    const attitude = add({
      kind: 'attitude',
      at: now - 2 * DAY,
      attitude: { fromId: odo.id, toId: 'party', before: 0, after: 1 },
    });
    const bond = add({
      kind: 'bond',
      at: now - DAY,
      bond: {
        relationId: null,
        fromId: mira.id,
        toId: odo.id,
        type: 'knows',
        label: '',
        ended: false,
        before: null,
      },
    });
    const ended = add({
      kind: 'bond',
      at: now - DAY,
      bond: {
        relationId: null,
        fromId: mira.id,
        toId: odo.id,
        type: 'knows',
        label: '',
        ended: true,
        before: null,
      },
    });
    const found = issues().filter((issue) => issue.key.startsWith('dead-seen:'));
    expect(found.map((issue) => issue.entryId)).toEqual([attitude.id, bond.id]);
    expect(found.every((issue) => issue.weight === 'hint')).toBe(true);
    expect(found.map((issue) => issue.entryId)).not.toContain(ended.id);
  });

  it('ein Gegenstand, zweimal ausgegeben; ein Besitzer, der tot ist', async () => {
    const { db, now, mira, odo, issues } = await setup();
    const amulet = db.put(
      'entities',
      createEntity({ kind: 'item', name: 'Salzsilber-Amulett', item: { holderId: odo.id } }),
    );
    db.put('loot', createLoot({ itemId: amulet.id, toId: mira.id, given: true, at: now - DAY }));
    db.put('loot', createLoot({ itemId: amulet.id, toId: null, given: false }));
    expect(issues().some((issue) => issue.key.startsWith('loot-twice:'))).toBe(false);
    db.put('loot', createLoot({ itemId: amulet.id, toId: odo.id, given: true, at: now }));
    const twice = issues().find((issue) => issue.key.startsWith('loot-twice:'))!;
    expect(twice.text).toBe(
      '„Salzsilber-Amulett“ wurde zweimal ausgegeben – an Mira Tannhaus und Odo Tannhaus.',
    );
    expect(twice.weight).toBe('warn');
    expect(twice.refs).toEqual([amulet.id, mira.id, odo.id]);
    expect(issues().some((issue) => issue.key.startsWith('holder-dead:'))).toBe(false);
    db.patch('entities', odo.id, { person: { gender: 'm', status: 'dead' } } as never);
    const dead = issues().find((issue) => issue.key.startsWith('holder-dead:'))!;
    expect(dead.text).toBe('„Salzsilber-Amulett“ gehört Odo Tannhaus, aber Odo Tannhaus ist tot.');
  });

  it('Lebensdaten: Geburt nach dem Tod, Geburt in der Zukunft', async () => {
    const { db, year, yearPoint, mira, brann, keys, issues } = await setup();
    db.patch('entities', mira.id, { born: yearPoint(year - 10), ended: yearPoint(year - 20) });
    expect(keys().some((key) => key.startsWith(`born-after-end:${mira.id}`))).toBe(true);
    // Im selben Jahr geboren und gestorben: kann stimmen.
    db.patch('entities', mira.id, { born: yearPoint(year - 20), ended: yearPoint(year - 20) });
    expect(keys().some((key) => key.startsWith('born-after-end:'))).toBe(false);
    db.patch('entities', brann.id, { born: yearPoint(year + 2) });
    const future = issues().find((issue) => issue.key.startsWith('born-future:'))!;
    expect(future.text).toMatch(/^Bei Brann Eichwald liegt „Geboren: .+“ in der Zukunft\.$/);
    expect(future.weight).toBe('hint');
  });

  it('Eltern und Kinder: vor den Eltern geboren, lange nach dem Tod', async () => {
    const { db, year, yearPoint, mira, odo, keys, issues } = await setup();
    setKin(db, mira.id, odo.id, 'parent', 'f');
    db.patch('entities', mira.id, { born: yearPoint(year - 30) });
    db.patch('entities', odo.id, { born: yearPoint(year - 40) });
    const early = issues().find((issue) => issue.key === `child-early:${odo.id}:${mira.id}`)!;
    expect(early.text).toMatch(
      /^Odo Tannhaus ist .+ geboren, die Mutter Mira Tannhaus aber erst .+\.$/,
    );
    db.patch('entities', odo.id, { born: yearPoint(year - 5) });
    db.patch('entities', mira.id, { ended: yearPoint(year - 10) });
    expect(keys()).toContain(`child-late:${odo.id}:${mira.id}`);
    // Ein Jahr nach dem Tod geboren: noch knapp möglich, wird nicht gemeldet.
    db.patch('entities', odo.id, { born: yearPoint(year - 9) });
    expect(keys()).not.toContain(`child-late:${odo.id}:${mira.id}`);
  });

  it('Einträge vor der Geburt – nur bei genauem Tag, nie bei ungefähren Einträgen oder Gerüchten', async () => {
    const { db, add, now, dayPoint, yearPoint, year, mira, issues } = await setup();
    db.patch('entities', mira.id, { born: dayPoint(now - 10 * DAY) });
    const first = add({ kind: 'meeting', at: now - 20 * DAY, refs: [mira.id] });
    add({ kind: 'note', at: now - 15 * DAY, refs: [mira.id] });
    add({ kind: 'note', at: now - 30 * DAY, refs: [mira.id], precision: 'approx' });
    add({ kind: 'rumor', at: now - 40 * DAY, refs: [mira.id] });
    add({ kind: 'note', at: now - 5 * DAY, refs: [mira.id] });
    const found = issues().filter((issue) => issue.key.startsWith('before-birth:'));
    expect(found).toHaveLength(1);
    expect(found[0]!.entryId).toBe(first.id);
    expect(found[0]!.text).toMatch(
      /kommt aber schon in 2 Einträgen der Chronik davor vor – zuerst am/,
    );
    // Nur ein Jahr bekannt: kein Urteil.
    db.patch('entities', mira.id, { born: yearPoint(year) });
    expect(issues().filter((issue) => issue.key.startsWith('before-birth:'))).toEqual([]);
  });

  it('unmögliche Reise: schneller als der kürzeste bekannte Weg', async () => {
    const { db, add, now, town, grotto, place, issues } = await setup();
    db.put('paths', createPath({ fromId: town.id, toId: grotto.id, minutes: 6 * 60 }));
    add({ kind: 'travel', at: now - 10 * 60, travel: { fromId: null, toId: town.id } });
    const fast = add({
      kind: 'travel',
      at: now - 8 * 60,
      travel: { fromId: town.id, toId: grotto.id },
    });
    const found = issues().filter((issue) => issue.key.startsWith('travel-fast:'));
    expect(found.map((issue) => issue.entryId)).toEqual([fast.id]);
    expect(found[0]!.text).toMatch(
      /und 2 Std\. später in Salzgrotte – der kürzeste bekannte Weg dauert auch im schnellen Tempo 6 Std\.\.?$/,
    );
    // Nachgetragen: kein Urteil.
    db.patch('chronicle', fast.id, { backfilled: true });
    expect(issues().filter((issue) => issue.key.startsWith('travel-fast:'))).toEqual([]);
    db.patch('chronicle', fast.id, { backfilled: false, at: now });
    expect(issues().filter((issue) => issue.key.startsWith('travel-fast:'))).toEqual([]);
    // Ohne bekannten Weg nichts melden.
    const far = place('Burg Graufels');
    add({ kind: 'travel', at: now + 1, travel: { fromId: grotto.id, toId: far.id } });
    expect(issues().filter((issue) => issue.key.startsWith('travel-fast:'))).toEqual([]);
  });

  it('eine Verbesserung in derselben Minute zählt nicht als Reise', async () => {
    const { db, add, now, town, grotto, place, issues } = await setup();
    const wrong = place('Burg Graufels');
    db.put('paths', createPath({ fromId: town.id, toId: grotto.id, minutes: 60 }));
    db.put('paths', createPath({ fromId: town.id, toId: wrong.id, minutes: 3 * DAY }));
    db.put('paths', createPath({ fromId: wrong.id, toId: grotto.id, minutes: 3 * DAY }));
    add({ kind: 'travel', at: now - 120, travel: { fromId: null, toId: town.id } });
    add({
      kind: 'travel',
      at: now,
      travel: { fromId: town.id, toId: wrong.id },
      created: '2026-11-13T10:00:00.000Z',
    });
    add({
      kind: 'travel',
      at: now,
      travel: { fromId: wrong.id, toId: grotto.id },
      created: '2026-11-13T10:00:05.000Z',
    });
    expect(issues().filter((issue) => issue.key.startsWith('travel-fast:'))).toEqual([]);
  });

  it('Verweise auf gelöschte Einträge, gleiche Namen als Hinweis', async () => {
    const { add, now, person, place, town, mira, issues } = await setup();
    const entry = add({ kind: 'note', at: now, refs: [mira.id, 'weg-damit', 'party'] });
    add({ kind: 'note', at: now + 1, placeId: 'weg-damit' });
    const gone = issues().find((issue) => issue.key === 'gone-ref:weg-damit')!;
    expect(gone.entryId).toBe(entry.id);
    expect(gone.weight).toBe('hint');
    expect(gone.text).toMatch(/^2 Einträge der Chronik verweisen auf einen Eintrag der Welt/);
    const twin = person('Mira Tannhaus');
    const same = issues().find((issue) => issue.key.startsWith('same-name:'))!;
    expect(same.refs.sort()).toEqual([mira.id, twin.id].sort());
    expect(same.text).toBe(
      'Zwei Einträge der Art „Person“ heißen genau „Mira Tannhaus“. Wenn es verschiedene sind, ist das in Ordnung.',
    );
    // Gleicher Vorname ist kein gleicher Name; gleichnamige Orte an verschiedenen Stellen auch nicht.
    person('Mira Furtner');
    place('Hafen', town.id);
    place('Hafen');
    expect(issues().filter((issue) => issue.key.startsWith('same-name:'))).toHaveLength(1);
  });

  it('„Passt so“ nimmt einen Punkt heraus und lässt sich zurücknehmen', async () => {
    const { db, person, mira, issues } = await setup();
    person('Mira Tannhaus');
    const [issue] = issues();
    expect(issue).toBeDefined();
    expect(issuesAbout(issues(), mira.id)).toHaveLength(1);
    const undo = markContinuityOk(db, issue!.key);
    expect(issues()).toEqual([]);
    expect(allContinuityIssues(db.getSnapshot())).toHaveLength(1);
    undo();
    expect(issues()).toHaveLength(1);
  });

  it('liest alte Stände ohne „Passt so“', async () => {
    const { db, person } = await setup();
    person('Lando Furtner');
    person('Lando Furtner');
    const data = db.getSnapshot();
    const old = {
      ...data,
      state: { ...data.state, continuityOk: undefined as unknown as string[] },
    };
    expect(continuityIssues(old)).toHaveLength(1);
  });

  it('das Ende eines Monats und eines Jahres', async () => {
    const { db } = await setup();
    const cal = db.getSnapshot().campaign.calendar;
    const start = toTime(cal, { year: 700, month: 2, day: 1, hour: 0, minute: 0 });
    const month = pointEnd(cal, { at: start, precision: 'month' });
    expect(fromTime(cal, month)).toMatchObject({ year: 700, month: 3, day: 1 });
    const yearEnd = pointEnd(cal, { at: start, precision: 'year' });
    expect(fromTime(cal, yearEnd)).toMatchObject({ year: 701, month: 0, day: 1 });
  });
});
