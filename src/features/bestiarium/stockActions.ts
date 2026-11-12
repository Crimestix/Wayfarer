/**
 * Befehle für Bestände: anlegen, Bewohner eintragen, Verluste zählen – von Hand oder aus einer
 * Begegnung heraus.
 */
import type { CampaignDb } from '../../data/db';
import { nextFoeName } from '../../domain/creature';
import { fielded, lossPlan } from '../../domain/stock';
import {
  createStock,
  newId,
  type EncounterFoe,
  type Stock,
  type StockGroup,
} from '../../domain/schema';

export function newStock(db: CampaignDb, name = ''): Stock {
  const count = Object.keys(db.getSnapshot().stocks).length;
  return db.put(
    'stocks',
    createStock({
      name: name.trim() || `Bestand ${count + 1}`,
      placeId: db.getSnapshot().state.placeId,
    }),
  );
}

export function updateStock(
  db: CampaignDb,
  id: string,
  patch: Partial<Pick<Stock, 'name' | 'placeId' | 'stores' | 'loot' | 'range' | 'notes'>>,
): void {
  if (db.getSnapshot().stocks[id]) db.patch('stocks', id, patch);
}

export function removeStock(db: CampaignDb, id: string): void {
  if (db.getSnapshot().stocks[id]) db.remove('stocks', id);
}

const groupsOf = (db: CampaignDb, id: string): StockGroup[] | null =>
  db.getSnapshot().stocks[id]?.groups ?? null;

/** Trägt Bewohner ein. Gibt es das Wesen im Bestand schon, werden es mehr. */
export function addGroup(db: CampaignDb, id: string, creatureId: string, count: number): void {
  const groups = groupsOf(db, id);
  if (!groups || !db.getSnapshot().creatures[creatureId]) return;
  const more = Math.max(1, Math.min(9999, Math.round(count)));
  const known = groups.find((group) => group.creatureId === creatureId);
  db.patch('stocks', id, {
    groups: known
      ? groups.map((group) => (group === known ? { ...group, count: group.count + more } : group))
      : [...groups, { id: newId(), creatureId, count: more, lost: 0 }],
  });
}

export function removeGroup(db: CampaignDb, id: string, groupId: string): void {
  const groups = groupsOf(db, id);
  if (groups) db.patch('stocks', id, { groups: groups.filter((group) => group.id !== groupId) });
}

/** Zählt Verluste: `change` mehr (oder weniger) fehlen – nie mehr, als es waren. */
export function loseFromGroup(db: CampaignDb, id: string, groupId: string, change: number): void {
  const groups = groupsOf(db, id);
  if (!groups) return;
  db.patch('stocks', id, {
    groups: groups.map((group) =>
      group.id === groupId
        ? { ...group, lost: Math.max(0, Math.min(group.count, group.lost + Math.round(change))) }
        : group,
    ),
  });
}

/**
 * Stellt Bewohner eines Bestands in eine Begegnung – höchstens so viele, wie noch da sind und
 * nicht schon dort stehen. Gibt zurück, wie viele es wurden.
 */
export function fieldFromStock(
  db: CampaignDb,
  encounterId: string,
  stockId: string,
  creatureId: string,
  count: number,
): number {
  const data = db.getSnapshot();
  const encounter = data.encounters[encounterId];
  const stock = data.stocks[stockId];
  const creature = data.creatures[creatureId];
  const group = stock?.groups.find((entry) => entry.creatureId === creatureId);
  if (!encounter || !stock || !creature || !group) return 0;
  const free = group.count - group.lost - fielded(encounter, stockId, creatureId);
  const take = Math.max(0, Math.min(free, Math.round(count)));
  const foes: EncounterFoe[] = [...encounter.foes];
  for (let index = 0; index < take; index++)
    foes.push({
      id: newId(),
      creatureId,
      name: creature.kind === 'individual' ? creature.name : nextFoeName(foes, creature.name),
      hp: creature.kind === 'individual' ? creature.hpNow : null,
      note: '',
      stockId,
      booked: false,
    });
  if (take) db.patch('encounters', encounterId, { foes });
  return take;
}

/**
 * Verbucht die Verluste einer Begegnung: Wer aus einem Bestand stammt und besiegt ist, fehlt dort
 * danach. Gibt zurück, wie viele es waren, und wie sich das zurücknehmen lässt – null, wenn es
 * nichts zu verbuchen gibt.
 */
export function bookLosses(
  db: CampaignDb,
  encounterId: string,
): { count: number; undo: () => void } | null {
  const data = db.getSnapshot();
  const encounter = data.encounters[encounterId];
  if (!encounter) return null;
  const plan = lossPlan(data, encounter);
  if (!plan.foeIds.length) return null;
  const apply = (sign: 1 | -1) =>
    db.batch(() => {
      for (const loss of plan.losses) {
        const group = db
          .getSnapshot()
          .stocks[loss.stockId]?.groups.find((entry) => entry.creatureId === loss.creatureId);
        if (group) loseFromGroup(db, loss.stockId, group.id, sign * loss.count);
      }
      const now = db.getSnapshot().encounters[encounterId];
      if (now)
        db.patch('encounters', encounterId, {
          foes: now.foes.map((foe) =>
            plan.foeIds.includes(foe.id) ? { ...foe, booked: sign === 1 } : foe,
          ),
        });
    });
  apply(1);
  return { count: plan.foeIds.length, undo: () => apply(-1) };
}
