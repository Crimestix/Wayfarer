/** Wiederkehrende Termine: einzelne Male ausfallen lassen. */
import { describe, expect, it } from 'vitest';
import { skipOccurrence } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { occurrencesOf } from '../derive';
import { CalendarEventSchema, createEvent } from '../schema';
import { MINUTES_PER_DAY, dayIndexOf } from '../time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../time/elaris';

const weekly = () =>
  createEvent({
    title: 'Markt',
    at: ELARIS_START,
    timed: true,
    repeat: { every: 1, unit: 'week' },
  });
const week = ELARIS_CALENDAR.weekdays.length * MINUTES_PER_DAY;
const days = (event: ReturnType<typeof weekly>) =>
  occurrencesOf(ELARIS_CALENDAR, event, ELARIS_START, ELARIS_START + 4 * week).map((o) =>
    dayIndexOf(o.at),
  );

describe('Ausnahmen bei wiederkehrenden Terminen', () => {
  it('kennt alte Termine ohne Ausnahmen', () => {
    expect(CalendarEventSchema.parse({ id: 'e1', title: 'Markt', at: 0 }).skip).toEqual([]);
  });

  it('lässt genau das gewählte Mal aus; die Reihe läuft weiter', () => {
    const event = weekly();
    const all = days(event);
    expect(all).toHaveLength(5);
    const skipped = { ...event, skip: [all[1]!] };
    expect(days(skipped)).toEqual([all[0], all[2], all[3], all[4]]);
  });

  it('wirkt nur auf wiederkehrende Termine', () => {
    const once = createEvent({ title: 'Fest', at: ELARIS_START, skip: [dayIndexOf(ELARIS_START)] });
    expect(occurrencesOf(ELARIS_CALENDAR, once, 0, ELARIS_START + 10)).toHaveLength(1);
  });

  it('lässt sich setzen und wieder zurücknehmen', async () => {
    const event = weekly();
    const db = await CampaignDb.create(new MemoryStore(), {
      ...elarisCampaign(),
      events: { [event.id]: event },
    });
    const [, second, third] = days(event);
    expect(skipOccurrence(db, event.id, third!)).toBe(true);
    expect(skipOccurrence(db, event.id, second!)).toBe(true);
    // Noch einmal dasselbe ändert nichts; die Liste bleibt sortiert.
    expect(skipOccurrence(db, event.id, second!)).toBe(false);
    expect(db.getSnapshot().events[event.id]!.skip).toEqual([second, third]);
    expect(skipOccurrence(db, event.id, second!, false)).toBe(true);
    expect(db.getSnapshot().events[event.id]!.skip).toEqual([third]);
    expect(skipOccurrence(db, 'fehlt', 1)).toBe(false);
  });
});
