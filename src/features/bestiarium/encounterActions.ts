/**
 * Befehle für Begegnungen: anlegen, Wesen hinzufügen (jedes Exemplar mit eigenen Trefferpunkten),
 * Schaden und Heilung führen, zurücksetzen, löschen.
 */
import type { CampaignDb } from '../../data/db';
import { nextFoeName, resolveCreature, statsOf } from '../../domain/creature';
import { createEncounter, newId, type Encounter, type EncounterFoe } from '../../domain/schema';

export function newEncounter(db: CampaignDb, name = ''): Encounter {
  const count = Object.keys(db.getSnapshot().encounters).length;
  return db.put(
    'encounters',
    createEncounter({
      name: name.trim() || `Begegnung ${count + 1}`,
      placeId: db.getSnapshot().state.placeId,
    }),
  );
}

export function updateEncounter(
  db: CampaignDb,
  id: string,
  patch: Partial<Pick<Encounter, 'name' | 'placeId' | 'notes'>>,
): void {
  if (db.getSnapshot().encounters[id]) db.patch('encounters', id, patch);
}

/**
 * Fügt Exemplare eines Wesens hinzu. Ein Einzelner kommt mit seinem Namen und seinen jetzigen
 * Trefferpunkten; von einer Vorlage oder Variante heißen sie „Grubenschleicher 1“, „… 2“.
 */
export function addFoes(db: CampaignDb, id: string, creatureId: string, count = 1): void {
  const data = db.getSnapshot();
  const encounter = data.encounters[id];
  const creature = data.creatures[creatureId];
  if (!encounter || !creature) return;
  const foes: EncounterFoe[] = [...encounter.foes];
  const single = creature.kind === 'individual';
  for (let index = 0; index < Math.max(1, Math.min(30, Math.round(count))); index++) {
    foes.push({
      id: newId(),
      creatureId,
      name: single ? creature.name : nextFoeName(foes, creature.name),
      hp: single ? creature.hpNow : null,
      note: '',
      stockId: null,
      booked: false,
    });
    if (single) break;
  }
  db.patch('encounters', id, { foes });
}

export function removeFoe(db: CampaignDb, id: string, foeId: string): void {
  const encounter = db.getSnapshot().encounters[id];
  if (encounter)
    db.patch('encounters', id, { foes: encounter.foes.filter((foe) => foe.id !== foeId) });
}

/** Setzt die Trefferpunkte eines Exemplars – zwischen 0 und seinem Höchstwert. */
export function setFoeHp(db: CampaignDb, id: string, foeId: string, hp: number): void {
  const data = db.getSnapshot();
  const encounter = data.encounters[id];
  const foe = encounter?.foes.find((entry) => entry.id === foeId);
  const resolved = foe ? resolveCreature(data.creatures, foe.creatureId) : null;
  if (!encounter || !foe || !resolved) return;
  const max = statsOf(resolved.block).hp;
  const next = Math.max(0, Math.min(max, Math.round(hp)));
  db.patch('encounters', id, {
    foes: encounter.foes.map((entry) =>
      entry.id === foeId ? { ...entry, hp: next >= max ? null : next } : entry,
    ),
  });
}

/**
 * Alle wieder unverletzt – die Begegnung beginnt von vorn. Wessen Verlust schon in einem Bestand
 * verbucht ist, bleibt besiegt: Er fehlt dort.
 */
export function resetEncounter(db: CampaignDb, id: string): void {
  const encounter = db.getSnapshot().encounters[id];
  if (encounter)
    db.patch('encounters', id, {
      foes: encounter.foes.map((foe) => (foe.booked ? foe : { ...foe, hp: null })),
    });
}

export function removeEncounter(db: CampaignDb, id: string): void {
  if (db.getSnapshot().encounters[id]) db.remove('encounters', id);
}
