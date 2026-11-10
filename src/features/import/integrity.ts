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

  const isKind =
    (...kinds: Entity['kind'][]) =>
    (id: string | null): boolean =>
      has(id) && kinds.includes(entities[id]!.kind);

  for (const entity of Object.values(input.entities)) {
    if (entity.kind === 'person') {
      const p = entity.person;
      const placeId = keep(p.placeId, isPlace);
      const homeId = keep(p.homeId, isPlace);
      const speciesId = keep(p.speciesId, isKind('species'));
      const workplaceId = keep(p.workplaceId, isKind('place', 'faction'));
      if (
        placeId !== p.placeId ||
        homeId !== p.homeId ||
        speciesId !== p.speciesId ||
        workplaceId !== p.workplaceId
      )
        entities[entity.id] = {
          ...entity,
          person: { ...p, placeId, homeId, speciesId, workplaceId },
        };
    } else if (entity.kind === 'place') {
      const climateId = keep(entity.place.climateId, (cid) => !!cid && cid in input.climates);
      if (climateId !== entity.place.climateId)
        entities[entity.id] = { ...entity, place: { ...entity.place, climateId } };
    } else if (entity.kind === 'family') {
      const seatId = keep(entity.family.seatId, isPlace);
      if (seatId !== entity.family.seatId)
        entities[entity.id] = { ...entity, family: { ...entity.family, seatId } };
    } else if (entity.kind === 'language') {
      const scriptId = keep(entity.language.scriptId, isKind('script'));
      if (scriptId !== entity.language.scriptId)
        entities[entity.id] = { ...entity, language: { ...entity.language, scriptId } };
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
      const before = repaired;
      const refs = keepAll(t.refs);
      const participants = keepAll(t.participants);
      const casterId = keep(t.casterId);
      return [id, repaired === before ? t : { ...t, refs, participants, casterId }];
    }),
  );

  // Wege ohne beide Endpunkte sagen nichts mehr aus.
  const paths = Object.fromEntries(
    Object.entries(input.paths).filter(([, p]) => {
      const ok = isPlace(p.fromId) && isPlace(p.toId) && p.fromId !== p.toId;
      if (!ok) repaired++;
      return ok;
    }),
  );
  const maps = Object.fromEntries(
    Object.entries(input.maps).map(([id, m]) => {
      const before = repaired;
      const placeId = keep(m.placeId, isPlace);
      const markers = m.markers.map((marker) => {
        const entityId = keep(marker.entityId);
        return entityId === marker.entityId ? marker : { ...marker, entityId };
      });
      return [id, repaired === before ? m : { ...m, placeId, markers }];
    }),
  );
  const journeys = Object.fromEntries(
    Object.entries(input.journeys).map(([id, j]) => {
      const before = repaired;
      const startId = keep(j.startId, isPlace);
      const participants = keepAll(j.participants);
      const legs = j.legs.map((leg) => {
        const pathId = keep(leg.pathId, (pid) => !!pid && pid in paths);
        const toId = keep(leg.toId, isPlace);
        return pathId === leg.pathId && toId === leg.toId ? leg : { ...leg, pathId, toId };
      });
      return [id, repaired === before ? j : { ...j, startId, participants, legs }];
    }),
  );
  const rests = Object.fromEntries(
    Object.entries(input.rests).map(([id, r]) => {
      const before = repaired;
      const participants = keepAll(r.participants);
      const placeId = keep(r.placeId, isPlace);
      const watches = r.watches.map((w) => {
        const characterIds = keepAll(w.characterIds);
        return characterIds.length === w.characterIds.length ? w : { ...w, characterIds };
      });
      return [id, repaired === before ? r : { ...r, participants, placeId, watches }];
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
  return {
    data: {
      ...input,
      state,
      entities,
      relations,
      chronicle,
      events,
      timers,
      paths,
      maps,
      journeys,
      rests,
    },
    repaired,
  };
}
