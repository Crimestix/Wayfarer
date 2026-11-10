/** Ausgangsdaten: leere Kampagne und der Elaris-Grundstand – ohne erfundene Weltinhalte. */
import {
  CampaignMetaSchema,
  PlayStateSchema,
  createEntity,
  createEvent,
  createSession,
  emptyCollections,
  nowIso,
  type CampaignData,
  type Entity,
} from '../domain/schema';
import { toTime, type CalendarDef, type WorldTime } from '../domain/time/calendar';
import { ELARIS_CALENDAR, ELARIS_START } from '../domain/time/elaris';

export function emptyCampaign(name: string, calendar: CalendarDef, now: WorldTime): CampaignData {
  const stamp = nowIso();
  return {
    campaign: CampaignMetaSchema.parse({
      id: 'campaign',
      schema: 1,
      name,
      calendar,
      created: stamp,
      updated: stamp,
    }),
    state: PlayStateSchema.parse({ id: 'state', now, updated: stamp }),
    ...emptyCollections(),
  };
}

const index = <T extends { id: string }>(docs: T[]): Record<string, T> =>
  Object.fromEntries(docs.map((d) => [d.id, d]));

/** Elaris mit Kalender, Startzeit und den sechs Gefährten – ohne erfundene Weltinhalte. */
export function elarisCampaign(): CampaignData {
  const data = emptyCampaign('Elaris', ELARIS_CALENDAR, ELARIS_START);
  const characters = ['Tomlin', 'Naelmira', 'Neil', 'Corrin', 'Veres', 'Nex'].map((name) =>
    createEntity({ kind: 'character', name }),
  );
  const session = createSession({ number: 12, title: 'Session 12', startAt: ELARIS_START });
  const event = createEvent({
    title: 'Der Graue Fang legt ab',
    at: toTime(ELARIS_CALENDAR, { year: 701 + 27387, month: 0, day: 19, hour: 0, minute: 0 }),
    timed: false,
    kind: 'world',
    details:
      'Das Boot von Haus Duskryn legt ab. Festes Weltereignis, unabhängig von Spielerentscheidungen.',
  });
  return {
    ...data,
    state: { ...data.state, sessionId: session.id },
    entities: index<Entity>(characters),
    sessions: index([session]),
    events: index([event]),
  };
}
