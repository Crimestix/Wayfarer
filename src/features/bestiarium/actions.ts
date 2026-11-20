/**
 * Befehle des Bestiariums: Wesen anlegen, ändern, löschen, aus Text übernehmen; Varianten und
 * Einzelne ableiten; Trefferpunkte eines Einzelnen führen.
 */
import type { CampaignDb } from '../../data/db';
import { animalsOfCreature } from '../../domain/nature';
import { resolveCreature, statsOf } from '../../domain/creature';
import { namedEntry } from '../../domain/creatureParts';
import { createCreature, createEntity, type Creature, type Entity } from '../../domain/schema';
import type { ParsedStatblock } from './parse';

export type CreatureInput = Pick<
  Creature,
  'name' | 'kind' | 'parentId' | 'block' | 'features' | 'dropped' | 'source' | 'notes'
> & {
  /** Die Spezies der Welt; fehlt die Angabe, bleibt sie, wie sie war. */
  speciesId?: string | null;
  /** Unterwegs: Anzahl, Spuren, Tageszeit; fehlt die Angabe, bleibt sie, wie sie war. */
  roaming?: Creature['roaming'];
};

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
    ...(input.roaming
      ? {
          roaming: {
            appearing: input.roaming.appearing.trim(),
            signs: input.roaming.signs.trim(),
            active: input.roaming.active,
          },
        }
      : {}),
  };
  if (clean.speciesId === undefined) delete clean.speciesId;
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
/**
 * Löscht einen Statblock. Erben behalten ihre Werte und stehen danach für sich; Tiere verlieren
 * den Verweis. Was ihn sonst nennt (Begegnungen, Bestände …), behält seinen Verweis – `undo` stellt
 * den Statblock mit derselben Kennung wieder her, Erben und Tiere wie vorher, und alles passt
 * wieder zusammen (F16). Die Verwendungen nennt vorher `creatureUses`.
 */
export function removeCreature(db: CampaignDb, id: string): (() => void) | null {
  const before = db.getSnapshot();
  const creatures = before.creatures;
  const removed = creatures[id];
  if (!removed) return null;
  const heirs = Object.values(creatures).filter((child) => child.parentId === id);
  const animals = animalsOfCreature(before, id);
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
    // Ein Tier, dessen Kampfwerte das waren, hat danach keine mehr.
    for (const animal of animalsOfCreature(db.getSnapshot(), id))
      db.put('entities', { ...animal, animal: { ...animal.animal, creatureId: null } });
    db.remove('creatures', id);
  });
  return () =>
    db.batch(() => {
      const now = db.getSnapshot();
      if (!now.creatures[id]) db.put('creatures', removed);
      for (const heir of heirs) if (now.creatures[heir.id]) db.put('creatures', heir);
      for (const animal of animals) {
        const current = db.getSnapshot().entities[animal.id];
        if (current?.kind === 'animal' && current.animal.creatureId === null)
          db.put('entities', { ...current, animal: { ...current.animal, creatureId: id } });
      }
    });
}

/**
 * Legt aus dem Bestiarium einen Eintrag der Welt an – eine Spezies, Sprache oder Fähigkeit, die
 * im Statblock steht, aber in der Welt noch fehlt. Gibt es schon einen mit diesem Namen, bleibt es
 * bei ihm: Nie zwei Einträge für einen Namen. Ein Artikel gleichen Namens verbindet sich danach
 * von selbst (`linkTwins`).
 */
export function keepInWorld(
  db: CampaignDb,
  kind: WorldPart,
  name: string,
  more: { tagline?: string; notes?: string } = {},
): Entity | null {
  return addToWorld(db, kind, name, more)?.entity ?? null;
}

type WorldPart = 'species' | 'language' | 'ability';

/**
 * Wie `keepInWorld`, sagt aber dazu, ob der Eintrag gerade erst entstanden ist. Nur solche darf
 * der Editor beim Abbrechen wieder wegräumen – einen Eintrag, den es vorher schon gab (etwa unter
 * einem Beinamen gefunden), nie.
 */
export function addToWorld(
  db: CampaignDb,
  kind: WorldPart,
  name: string,
  more: { tagline?: string; notes?: string } = {},
): { entity: Entity; created: boolean } | null {
  const clean = name.trim();
  if (!clean) return null;
  const known = namedEntry(db.getSnapshot(), kind, clean);
  if (known) return { entity: known, created: false };
  const entity = db.put(
    'entities',
    createEntity({
      kind,
      name: clean,
      tagline: more.tagline?.trim() ?? '',
      notes: more.notes?.trim() ?? '',
    }),
  );
  return { entity, created: true };
}

/** Verbindet ein Tier der Welt mit seinen Kampfwerten im Bestiarium. */
export function linkAnimalCreature(db: CampaignDb, animalId: string, creatureId: string): void {
  const animal = db.getSnapshot().entities[animalId];
  if (animal?.kind !== 'animal' || animal.animal.creatureId === creatureId) return;
  db.put('entities', { ...animal, animal: { ...animal.animal, creatureId } });
}
