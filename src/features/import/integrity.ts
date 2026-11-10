/**
 * Räumt Verweise auf, die ins Leere zeigen. Ein eingespielter Spielstand (Sicherung oder
 * Übernahme aus der alten Version) soll in sich stimmig sein, auch wenn einzelne Dokumente
 * fehlten oder unlesbar waren.
 */
import { PARTY_ID, type CampaignData, type ChronicleEntry, type Entity } from '../../domain/schema';

export interface RepairResult {
  data: CampaignData;
  /** Anzahl der Stellen, an denen ein Verweis entfernt wurde. */
  repaired: number;
}

export function repairReferences(input: CampaignData): RepairResult {
  let repaired = 0;
  const entities: Record<string, Entity> = { ...input.entities };
  const has = (id: string | null | undefined): id is string => !!id && id in entities;
  const isPlace = (id: string | null | undefined): id is string =>
    has(id) && entities[id]!.kind === 'place';
  /** Lässt einen Verweis nur stehen, wenn das Ziel existiert. */
  const keep = <T extends string | null>(
    id: T,
    ok: (id: string | null) => boolean = has,
  ): T | null => {
    if (id === null || ok(id)) return id;
    repaired++;
    return null;
  };
  const keepAll = (ids: readonly string[]): string[] => {
    const out = ids.filter((id) => has(id));
    repaired += ids.length - out.length;
    return out;
  };

  for (const entity of Object.values(input.entities)) {
    if (entity.kind === 'person') {
      const placeId = keep(entity.person.placeId, isPlace);
      const homeId = keep(entity.person.homeId, isPlace);
      if (placeId !== entity.person.placeId || homeId !== entity.person.homeId)
        entities[entity.id] = { ...entity, person: { ...entity.person, placeId, homeId } };
    } else if (entity.kind === 'faction') {
      const seatId = keep(entity.faction.seatId, isPlace);
      if (seatId !== entity.faction.seatId)
        entities[entity.id] = { ...entity, faction: { ...entity.faction, seatId } };
    } else if (entity.kind === 'character') {
      const placeId = keep(entity.character.placeId, isPlace);
      if (placeId !== entity.character.placeId)
        entities[entity.id] = { ...entity, character: { ...entity.character, placeId } };
    } else if (entity.kind === 'item') {
      const holderId = keep(entity.item.holderId);
      if (holderId !== entity.item.holderId)
        entities[entity.id] = { ...entity, item: { ...entity.item, holderId } };
    }
  }
  // Orte: Elternort muss ein Ort sein, und die Gliederung darf keinen Kreis bilden.
  for (const entity of Object.values(entities)) {
    if (entity.kind !== 'place' || entity.place.parentId === null) continue;
    let broken = !isPlace(entity.place.parentId);
    const seen = new Set([entity.id]);
    let cursor: string | null = entity.place.parentId;
    while (!broken && cursor !== null) {
      if (seen.has(cursor)) broken = true;
      seen.add(cursor);
      const parent: Entity | undefined = entities[cursor];
      cursor = parent?.kind === 'place' ? parent.place.parentId : null;
    }
    if (broken) {
      repaired++;
      entities[entity.id] = { ...entity, place: { ...entity.place, parentId: null } };
    }
  }

  const relations = Object.fromEntries(
    Object.entries(input.relations).filter(([, r]) => {
      const ok = has(r.from) && (r.to === PARTY_ID || has(r.to)) && r.from !== r.to;
      if (!ok) repaired++;
      return ok;
    }),
  );

  const sessions = input.sessions;
  const events = Object.fromEntries(
    Object.entries(input.events).map(([id, e]) => {
      const placeId = keep(e.placeId, isPlace);
      const refs = keepAll(e.refs);
      return [
        id,
        placeId === e.placeId && refs.length === e.refs.length ? e : { ...e, placeId, refs },
      ];
    }),
  );
  const timers = Object.fromEntries(
    Object.entries(input.timers).map(([id, t]) => {
      const refs = keepAll(t.refs);
      return [id, refs.length === t.refs.length ? t : { ...t, refs }];
    }),
  );

  const chronicle: Record<string, ChronicleEntry> = {};
  for (const [id, entry] of Object.entries(input.chronicle)) {
    if (entry.attitude) {
      const { fromId, toId } = entry.attitude;
      if (!has(fromId) || !(toId === PARTY_ID || has(toId))) {
        // Eine Haltungsänderung ohne Beteiligte sagt nichts mehr aus.
        repaired++;
        continue;
      }
    }
    const before = repaired;
    const placeId = keep(entry.placeId, isPlace);
    const refs = keepAll(entry.refs);
    const sessionId = keep(entry.sessionId, (sid) => !!sid && sid in sessions);
    const eventId = keep(entry.eventId, (eid) => !!eid && eid in events);
    const travel = entry.travel
      ? { fromId: keep(entry.travel.fromId, isPlace), toId: keep(entry.travel.toId, isPlace) }
      : null;
    chronicle[id] =
      repaired === before ? entry : { ...entry, placeId, refs, sessionId, eventId, travel };
  }

  const placeId = keep(input.state.placeId, isPlace);
  const sessionId = keep(input.state.sessionId, (sid) => !!sid && sid in sessions);
  const state =
    placeId === input.state.placeId && sessionId === input.state.sessionId
      ? input.state
      : { ...input.state, placeId, sessionId };

  if (repaired === 0) return { data: input, repaired };
  return { data: { ...input, state, entities, relations, chronicle, events, timers }, repaired };
}
