/**
 * Befehle des Bestiariums: Wesen anlegen, ändern, löschen, aus Text übernehmen; Varianten und
 * Einzelne ableiten; Trefferpunkte eines Einzelnen führen.
 */
import type { CampaignDb } from '../../data/db';
import { resolveCreature, statsOf } from '../../domain/creature';
import { createCreature, type Creature } from '../../domain/schema';
import type { ParsedStatblock } from './parse';

export type CreatureInput = Pick<
  Creature,
  'name' | 'kind' | 'parentId' | 'block' | 'features' | 'dropped' | 'source' | 'notes'
>;

/** Legt ein Wesen an oder ändert es. Fähigkeiten ohne Namen fallen weg. */
export function saveCreature(db: CampaignDb, input: CreatureInput, id?: string): Creature {
  const clean: CreatureInput = {
    ...input,
    name: input.name.trim() || 'Wesen ohne Namen',
    // Eine Vorlage erbt von niemandem.
    parentId: input.kind === 'template' ? null : input.parentId,
    features: input.features
      .map((feature) => ({ ...feature, name: feature.name.trim(), text: feature.text.trim() }))
      .filter((feature) => feature.name),
    source: input.source.trim(),
    notes: input.notes.trim(),
  };
  if (id && db.getSnapshot().creatures[id])
    return db.put('creatures', { ...db.getSnapshot().creatures[id]!, ...clean });
  return db.put('creatures', createCreature(clean));
}

/** Übernimmt einen gelesenen Statblock als Vorlage. */
export function importStatblock(db: CampaignDb, parsed: ParsedStatblock, source: string): Creature {
  return db.put(
    'creatures',
    createCreature({
      name: parsed.name,
      kind: 'template',
      block: parsed.block,
      features: parsed.features,
      source: source.trim(),
    }),
  );
}

/** Eine Variante: erbt alles und hält fest, was abweicht – zunächst nichts. */
export function makeVariant(db: CampaignDb, parentId: string): Creature | null {
  const parent = db.getSnapshot().creatures[parentId];
  if (!parent) return null;
  return db.put(
    'creatures',
    createCreature({ name: `${parent.name} (Variante)`, kind: 'variant', parentId }),
  );
}

/** Ein Einzelner: ein bestimmtes Wesen mit Namen und eigenen Trefferpunkten. */
export function makeIndividual(db: CampaignDb, parentId: string, name: string): Creature | null {
  const parent = db.getSnapshot().creatures[parentId];
  if (!parent) return null;
  return db.put(
    'creatures',
    createCreature({ name: name.trim() || parent.name, kind: 'individual', parentId }),
  );
}

/**
 * Setzt die aktuellen Trefferpunkte eines Einzelnen: zwischen 0 und seinem Höchstwert. Bei vollen
 * Trefferpunkten steht nichts fest (`hpNow` = null) – er zieht dann mit, wenn sich der Höchstwert
 * ändert.
 */
export function setCreatureHp(db: CampaignDb, id: string, hp: number): void {
  const resolved = resolveCreature(db.getSnapshot().creatures, id);
  if (!resolved) return;
  const max = statsOf(resolved.block).hp;
  const next = Math.max(0, Math.min(max, Math.round(hp)));
  db.patch('creatures', id, { hpNow: next >= max ? null : next });
}

/**
 * Löscht ein Wesen. Was von ihm geerbt hat, behält seine Werte: Sie werden ihm fest
 * eingeschrieben, und es steht danach für sich.
 */
export function removeCreature(db: CampaignDb, id: string): void {
  const creatures = db.getSnapshot().creatures;
  if (!creatures[id]) return;
  db.batch(() => {
    for (const child of Object.values(creatures)) {
      if (child.parentId !== id) continue;
      const resolved = resolveCreature(creatures, child.id)!;
      db.put('creatures', {
        ...child,
        parentId: null,
        kind: child.kind === 'variant' ? 'template' : child.kind,
        block: resolved.block,
        features: resolved.features.map(({ inherited: _inherited, ...feature }) => feature),
        dropped: [],
        source: resolved.source,
      });
    }
    db.remove('creatures', id);
  });
}
