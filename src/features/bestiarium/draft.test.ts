import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { createCreature, newId, type CreatureFeature } from '../../domain/schema';
import { keepInWorld, saveCreature } from './actions';
import {
  EMPTY_HISTORY,
  draftOf,
  draftProblem,
  draftsDiffer,
  heirsOf,
  importNoteOf,
  keepHeir,
  moveFeature,
  noteImport,
  parentChoices,
  parkDraft,
  parkedDraft,
  presetFor,
  recordStep,
  redoStep,
  resolveDraft,
  undoStep,
  withBlock,
} from './draft';

const feature = (name: string, section: CreatureFeature['section'] = 'trait'): CreatureFeature => ({
  id: newId(),
  section,
  name,
  text: '',
  attack: null,
  saveAbility: null,
  saveDc: null,
  uses: '',
});

/** Erfundene Wesen: der Grubenschleicher, sein Treiber und Krummzahn. */
function creatures() {
  const base = createCreature({
    name: 'Grubenschleicher',
    block: { hitDice: 2, cr: '1/4' },
    features: [feature('Dunkelpirsch'), feature('Krummsäbel', 'action')],
  });
  const driver = createCreature({ name: 'Treiber', kind: 'variant', parentId: base.id });
  const fang = createCreature({ name: 'Krummzahn', kind: 'individual', parentId: driver.id });
  return {
    all: { [base.id]: base, [driver.id]: driver, [fang.id]: fang },
    base,
    driver,
    fang,
  };
}

describe('Entwurf', () => {
  it('belegt Variante und Einzelnen mit Vorlage und Namen vor', () => {
    const { all, base, fang } = creatures();
    expect(presetFor(all, 'variant', base.id)).toMatchObject({
      kind: 'variant',
      parentId: base.id,
      name: 'Grubenschleicher (Variante)',
    });
    expect(presetFor(all, 'individual', base.id)).toMatchObject({ kind: 'individual' });
    expect(presetFor(all, 'variant', fang.id)).toEqual({});
    expect(presetFor(all, null, null)).toEqual({});
  });

  it('rechnet das Wesen so, wie es eingetragen ist – mit Geerbtem', () => {
    const { all, base, driver } = creatures();
    const draft = withBlock(draftOf(driver), { cr: '1' });
    const resolved = resolveDraft(all, draft, driver);
    expect(resolved.block.cr).toBe('1');
    expect(resolved.block.hitDice).toBe(2);
    expect(resolved.features.map((f) => f.name)).toEqual(['Dunkelpirsch', 'Krummsäbel']);
    // Ein neues Wesen ohne Vorlage erbt nichts.
    const fresh = resolveDraft(all, draftOf(null, { name: 'Neu', parentId: base.id }), null);
    expect(fresh.block.hitDice).toBe(1);
  });

  it('lässt beim Zurücksetzen auf „erben“ das Feld weg', () => {
    const draft = withBlock(draftOf(null), { ac: 14 });
    expect(withBlock(draft, { ac: undefined }).block).toEqual({});
  });

  it('erbt nie von sich selbst oder von etwas, das von ihm erbt', () => {
    const { all, base, driver } = creatures();
    expect(parentChoices(all, 'variant', null).map((c) => c.name)).toEqual(['Grubenschleicher']);
    expect(parentChoices(all, 'individual', null).map((c) => c.name)).toEqual([
      'Grubenschleicher',
      'Treiber',
    ]);
    expect(parentChoices(all, 'individual', base.id)).toEqual([]);
    expect(parentChoices(all, 'individual', driver.id).map((c) => c.name)).toEqual([
      'Grubenschleicher',
    ]);
  });

  it('sagt, was dem Speichern im Weg steht', () => {
    expect(draftProblem(draftOf(null))).toMatch(/Namen/);
    expect(draftProblem(draftOf(null, { name: 'A', kind: 'variant' }))).toMatch(/erbt/);
    expect(draftProblem(draftOf(null, { name: 'A' }))).toBeNull();
    expect(draftsDiffer(draftOf(null), draftOf(null))).toBe(false);
    expect(draftsDiffer(draftOf(null), draftOf(null, { name: 'A' }))).toBe(true);
  });
});

describe('Fähigkeiten im Entwurf', () => {
  it('zeigt Geerbtes mit abgelegt und ersetzt', () => {
    const { all, base, driver } = creatures();
    const parent = resolveDraft(all, draftOf(base), base);
    let draft = keepHeir(draftOf(driver), 'Dunkelpirsch', false);
    draft = { ...draft, features: [feature('Krummsäbel', 'action')] };
    expect(heirsOf(parent, draft, 'trait')).toMatchObject([
      { feature: { name: 'Dunkelpirsch' }, dropped: true, replaced: false },
    ]);
    expect(heirsOf(parent, draft, 'action')).toMatchObject([{ replaced: true, dropped: false }]);
    expect(keepHeir(draft, 'dunkelpirsch', true).dropped).toEqual([]);
  });

  it('verschiebt eine Fähigkeit nur innerhalb ihres Abschnitts', () => {
    const a = feature('A', 'action');
    const t = feature('T');
    const b = feature('B', 'action');
    expect(moveFeature([a, t, b], b.id, -1).map((f) => f.name)).toEqual(['B', 'T', 'A']);
    expect(moveFeature([a, t, b], a.id, -1).map((f) => f.name)).toEqual(['A', 'T', 'B']);
    expect(moveFeature([a, t, b], t.id, 1).map((f) => f.name)).toEqual(['A', 'T', 'B']);
  });
});

describe('Rückgängig', () => {
  it('fasst Tippen im selben Feld zusammen und kann vor und zurück', () => {
    const one = draftOf(null, { name: 'K' });
    const two = draftOf(null, { name: 'Kr' });
    const three = draftOf(null, { name: 'Kru' });
    let history = recordStep(EMPTY_HISTORY, draftOf(null), 'name', 1000);
    history = recordStep(history, one, 'name', 1500);
    history = recordStep(history, two, 'name', 1900);
    expect(history.past).toHaveLength(1);
    history = recordStep(history, three, 'ac', 2000);
    expect(history.past).toHaveLength(2);
    const back = undoStep(history, withBlock(three, { ac: 12 }))!;
    expect(back.draft).toBe(three);
    const again = redoStep(back.history, back.draft)!;
    expect(again.draft.block.ac).toBe(12);
    expect(undoStep(EMPTY_HISTORY, one)).toBeNull();
    expect(redoStep(EMPTY_HISTORY, one)).toBeNull();
  });

  it('merkt sich liegen gelassene Entwürfe und Hinweise vom Einlesen', () => {
    const draft = draftOf(null, { name: 'Halbfertig' });
    parkDraft('neu', draft);
    expect(parkedDraft('neu')).toBe(draft);
    parkDraft('neu', null);
    expect(parkedDraft('neu')).toBeNull();
    noteImport('x', { missing: [], unread: [], notes: [] });
    expect(importNoteOf('x')).toBeNull();
    noteImport('y', { missing: ['Trefferpunkte'], unread: [], notes: [] });
    expect(importNoteOf('y')?.missing).toEqual(['Trefferpunkte']);
  });
});

describe('Aus dem Bestiarium in die Welt', () => {
  it('legt Spezies, Sprache und Fähigkeit an – nie doppelt', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const tongue = keepInWorld(db, 'language', ' Grubenzunge ')!;
    expect(tongue).toMatchObject({ kind: 'language', name: 'Grubenzunge' });
    expect(keepInWorld(db, 'language', 'grubenzunge')!.id).toBe(tongue.id);
    const gift = keepInWorld(db, 'ability', 'Salzblick', {
      tagline: 'Sieht durch Salz.',
      notes: 'Sieht durch Salz. Lange.',
    })!;
    expect(gift).toMatchObject({ kind: 'ability', tagline: 'Sieht durch Salz.' });
    expect(keepInWorld(db, 'species', '  ')).toBeNull();
  });

  it('speichert die Spezies mit dem Wesen', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const folk = keepInWorld(db, 'species', 'Tannhauser Grubenvolk')!;
    const saved = saveCreature(db, draftOf(null, { name: 'Grubenschleicher', speciesId: folk.id }));
    expect(saved.speciesId).toBe(folk.id);
    // Ohne Angabe bleibt die Spezies, wie sie war.
    const { speciesId: _speciesId, ...rest } = draftOf(saved);
    expect(saveCreature(db, { ...rest, notes: 'still' }, saved.id).speciesId).toBe(folk.id);
  });
});
