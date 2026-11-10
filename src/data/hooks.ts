/** React-Anbindung an den Spielstand. */
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { entitiesOfKind } from '../domain/derive';
import type { CampaignData, Entity, EntityKind, EntityOf } from '../domain/schema';
import type { CalendarDef, WorldTime } from '../domain/time/calendar';
import type { CampaignDb, SaveStatus } from './db';

export const DbContext = createContext<CampaignDb | null>(null);

/** Zugriff auf die Datenbank für Änderungen. */
export function useDb(): CampaignDb {
  const db = useContext(DbContext);
  if (!db) throw new Error('Keine Kampagne geöffnet.');
  return db;
}

/** Der gesamte Spielstand; rendert bei jeder Änderung neu. */
export function useData(): CampaignData {
  const db = useDb();
  return useSyncExternalStore(db.subscribe, db.getSnapshot);
}

export function useCalendar(): CalendarDef {
  return useData().campaign.calendar;
}

export function useNow(): WorldTime {
  return useData().state.now;
}

export function useEntity(id: string | null | undefined): Entity | undefined {
  const data = useData();
  return id ? data.entities[id] : undefined;
}

/** Alle Einträge einer Art, nach Namen sortiert. */
export function useEntitiesOfKind<K extends EntityKind>(kind: K): EntityOf<K>[] {
  const data = useData();
  return useMemo(() => entitiesOfKind(data, kind), [data, kind]);
}

export function useSaveStatus(): { status: SaveStatus; error: string } {
  const db = useDb();
  const status = useSyncExternalStore(db.subscribeStatus, db.getStatus);
  return { status, error: db.getLastError() };
}
