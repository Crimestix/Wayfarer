/**
 * Befehle der Bastion: anlegen, Einrichtungen pflegen, Reparaturen, einen Zug ausführen. Ein Zug
 * steht in der Chronik; Fertiges kann als Beute für den Besitzer bereitliegen.
 */
import { logEntry } from '../../data/actions';
import type { CampaignDb } from '../../data/db';
import { turnLine, type TurnChoice } from '../../domain/bastion';
import { createBastion, newId, type Bastion, type BastionFacility } from '../../domain/schema';
import { saveLoot } from '../beute/actions';
import { saveTrack } from '../fortschritt/actions';

/** Legt eine Bastion an einem Ort an; der erste Zug ist in `turnDays` Tagen fällig. */
export function addBastion(db: CampaignDb, name: string, placeId: string | null): Bastion {
  return db.put(
    'bastions',
    createBastion({
      name: name.trim() || 'Bastion',
      placeId,
      lastTurnAt: db.getSnapshot().state.now,
    }),
  );
}

export function patchBastion(db: CampaignDb, id: string, change: Partial<Bastion>): void {
  if (db.getSnapshot().bastions[id]) db.patch('bastions', id, change);
}

/** Legt eine Einrichtung an oder ändert sie. */
export function saveFacility(
  db: CampaignDb,
  bastionId: string,
  facility: Omit<BastionFacility, 'id'> & { id?: string },
): void {
  const bastion = db.getSnapshot().bastions[bastionId];
  if (!bastion || !facility.name.trim()) return;
  const clean: BastionFacility = {
    ...facility,
    id: facility.id ?? newId(),
    name: facility.name.trim(),
    hirelings: facility.hirelings.trim(),
    orders: facility.kind === 'basic' ? [] : facility.orders,
  };
  const facilities = bastion.facilities.some((f) => f.id === clean.id)
    ? bastion.facilities.map((f) => (f.id === clean.id ? clean : f))
    : [...bastion.facilities, clean];
  db.patch('bastions', bastionId, { facilities });
}

export function removeFacility(db: CampaignDb, bastionId: string, facilityId: string): () => void {
  const bastion = db.getSnapshot().bastions[bastionId];
  if (!bastion) return () => undefined;
  const before = bastion.facilities;
  db.patch('bastions', bastionId, { facilities: before.filter((f) => f.id !== facilityId) });
  return () => {
    if (db.getSnapshot().bastions[bastionId])
      db.patch('bastions', bastionId, { facilities: before });
  };
}

/** Beginnt eine Reparatur: eine Fortschrittsleiste „Reparatur: …“ am Ort der Bastion. */
export function startRepair(
  db: CampaignDb,
  bastionId: string,
  facilityId: string,
  steps = 4,
): void {
  const bastion = db.getSnapshot().bastions[bastionId];
  const facility = bastion?.facilities.find((f) => f.id === facilityId);
  if (!bastion || !facility) return;
  db.batch(() => {
    const track = saveTrack(db, {
      name: `Reparatur: ${facility.name}`,
      ownerId: bastion.placeId,
      kind: 'steps',
      stages: [],
      target: 0,
      step: 1,
      unit: '',
      segments: steps,
      value: 0,
      note: '',
    });
    saveFacility(db, bastionId, { ...facility, state: 'repairing', trackId: track?.id ?? null });
  });
}

export function setFacilityState(
  db: CampaignDb,
  bastionId: string,
  facilityId: string,
  state: BastionFacility['state'],
): void {
  const facility = db
    .getSnapshot()
    .bastions[bastionId]?.facilities.find((f) => f.id === facilityId);
  if (facility) saveFacility(db, bastionId, { ...facility, state });
}

/**
 * Führt einen Bastionszug aus: Befehle bei den Einrichtungen, eine Zeile in der Chronik, Fertiges
 * auf Wunsch als Beute für den Besitzer. Der nächste Zug ist dann `turnDays` Tage später fällig.
 * `undo` nimmt alles zurück.
 */
export function runTurn(
  db: CampaignDb,
  bastionId: string,
  choices: TurnChoice[],
  event: string | null,
): (() => void) | null {
  const data = db.getSnapshot();
  const bastion = data.bastions[bastionId];
  if (!bastion || bastion.lastTurnAt === null) return null;
  const turnAt = bastion.lastTurnAt + bastion.turnDays * 24 * 60;
  const lootIds: string[] = [];
  const entry = db.batch(() => {
    const facilities = bastion.facilities.map((facility) => {
      const choice = choices.find((c) => c.facilityId === facility.id);
      if (!choice?.order) return facility;
      if (choice.asLoot && choice.turnsLeft === 0 && choice.text.trim()) {
        const loot = saveLoot(db, {
          text: choice.text,
          gold: 0,
          itemId: null,
          toId: facility.ownerId,
          source: `aus der Bastion (${facility.name})`,
          storyId: null,
        });
        if (loot) lootIds.push(loot.id);
      }
      return {
        ...facility,
        order: { name: choice.order, text: choice.text.trim(), turnsLeft: choice.turnsLeft },
      };
    });
    db.patch('bastions', bastionId, { facilities, lastTurnAt: turnAt });
    return logEntry(db, {
      kind: 'change',
      text: turnLine(bastion, choices, event),
      refs: bastion.placeId ? [bastion.placeId] : [],
      placeId: bastion.placeId,
      at: Math.min(turnAt, data.state.now),
    });
  });
  return () =>
    db.batch(() => {
      if (db.getSnapshot().bastions[bastionId])
        db.patch('bastions', bastionId, {
          facilities: bastion.facilities,
          lastTurnAt: bastion.lastTurnAt,
        });
      if (db.getSnapshot().chronicle[entry.id]) db.remove('chronicle', entry.id);
      for (const id of lootIds) if (db.getSnapshot().loot[id]) db.remove('loot', id);
    });
}
