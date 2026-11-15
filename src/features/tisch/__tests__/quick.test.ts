import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../../data/db';
import { demoCampaign } from '../../../data/__fixtures__/demoWorld';
import { MemoryStore } from '../../../data/store';
import { entitiesOfKind, runningTimers } from '../../../domain/derive';
import { recognizeEntry } from '../../../domain/recognize';
import { castSpell } from '../commands';
import {
  QUICK_OPTIONS,
  placeIn,
  quickChoiceOf,
  quickMatches,
  quickPlan,
  restKindIn,
  routeOf,
  slashOf,
} from '../quick';
import { casterFromRefs, concentrationOf, spellLabelFrom, spellTitle } from '../spells';
import { withName } from '../journalInsert';

async function demoDb() {
  return CampaignDb.create(new MemoryStore(), demoCampaign());
}
const named = (db: CampaignDb, kind: 'person' | 'place' | 'character', name: string) =>
  entitiesOfKind(db.getSnapshot(), kind).find((e) => e.name === name)!;

describe('Kurzwahl „/“ in der Mitschrift', () => {
  it('liest Kürzel und Rest', () => {
    expect(slashOf('Notiz')).toBeNull();
    expect(slashOf('/or')).toEqual({ query: 'or', rest: '', typing: true });
    expect(slashOf('/ort nach Dornhafen')).toEqual({
      query: 'ort',
      rest: 'nach Dornhafen',
      typing: false,
    });
  });

  it('findet Arten über Namen und Wörter, ohne Kürzel alle', () => {
    expect(quickMatches('')).toHaveLength(QUICK_OPTIONS.length);
    expect(quickMatches('ort')[0]!.choice).toBe('travel');
    expect(quickMatches('zau')[0]!.choice).toBe('spell');
    expect(quickMatches('beu')[0]!.choice).toBe('loot');
    expect(quickMatches('haltung')[0]!.choice).toBe('attitude');
    // Groß/klein und Umlaute zählen nicht.
    expect(quickMatches('GERUCHT')[0]!.choice).toBe('rumor');
    expect(quickChoiceOf('tot')?.choice).toBe('fate');
    expect(quickChoiceOf('')).toBeNull();
  });

  it('kennt jede Art des Festhaltens und dazu Zauber', () => {
    const choices = QUICK_OPTIONS.map((option) => option.choice);
    expect(new Set(choices).size).toBe(choices.length);
    expect(choices).toContain('spell');
    expect(choices).toContain('trade');
    expect(QUICK_OPTIONS.every((option) => option.label && !/^[a-z]/.test(option.label))).toBe(
      true,
    );
  });

  it('führt Ortswechsel, Rast, Handel und Zauber zu ihrem Handgriff', () => {
    expect(routeOf('travel')).toBe('move');
    expect(routeOf('rest')).toBe('rest');
    expect(routeOf('trade')).toBe('shop');
    expect(routeOf('spell')).toBe('spell');
    expect(routeOf('fate')).toBe('record');
    expect(restKindIn('kurze Rast am Fluss')).toBe('short');
    expect(restKindIn('Rast')).toBe('long');
  });
});

describe('Festhalten aus der Mitschrift', () => {
  it('findet den Ort eines Ortswechsels im Satz', async () => {
    const db = await demoDb();
    const dornhafen = named(db, 'place', 'Dornhafen');
    expect(placeIn(db.getSnapshot(), 'weiter nach Dornhafen', [])).toBe(dornhafen.id);
    expect(placeIn(db.getSnapshot(), 'weiter, irgendwohin', [])).toBeNull();
    // Der ganze Name ohne Groß/Klein zählt, ein Teil davon nie.
    const raben = named(db, 'place', 'Zum Salzigen Raben');
    expect(placeIn(db.getSnapshot(), 'rüber zum salzigen raben', [])).toBe(raben.id);
    expect(placeIn(db.getSnapshot(), 'rüber zum Raben', [])).toBeNull();
  });

  it('hält ohne Rückfrage fest, wenn nichts fehlt', async () => {
    const db = await demoDb();
    const voss = named(db, 'person', 'Hauptmann Voss');
    const data = db.getSnapshot();
    const plan = quickPlan(data, { text: 'Hauptmann Voss ist tot.', refs: [] }, { choice: 'fate' });
    expect(plan.direct).not.toBeNull();
    expect(plan.direct![0]).toMatchObject({ kind: 'fate', fate: { entityId: voss.id } });
  });

  it('übernimmt einen erkannten Vorschlag mit seinen Angaben', async () => {
    const db = await demoDb();
    const data = db.getSnapshot();
    const item = recognizeEntry(data, 'Hauptmann Voss ist tot.').find((r) => r.kind === 'fate')!;
    const plan = quickPlan(
      data,
      { text: 'Hauptmann Voss ist tot.', refs: [] },
      { recognized: item },
    );
    expect(plan.direct?.[0]?.kind).toBe('fate');
  });

  it('fragt nach, wenn etwas fehlt – mit Art und Text', async () => {
    const db = await demoDb();
    const plan = quickPlan(
      db.getSnapshot(),
      { text: 'Hauptmann Voss mag uns nicht mehr', refs: [] },
      { choice: 'attitude' },
    );
    expect(plan.direct).toBeNull();
    expect(plan.parts[0]!.choice).toBe('attitude');
    // „Wer“ steht schon da: genau eine Person ist genannt.
    expect(plan.parts[0]!.draft.whoId).toBe(named(db, 'person', 'Hauptmann Voss').id);
  });
});

describe('Zauber am Tisch', () => {
  it('läuft als Wirkung, schreibt eine Zeile und beendet eine alte Konzentration', async () => {
    const db = await demoDb();
    const caster = entitiesOfKind(db.getSnapshot(), 'character')[0]!;
    expect(casterFromRefs(db.getSnapshot(), [caster.id])).toBe(caster.id);
    const first = castSpell(db, {
      casterId: caster.id,
      label: 'Segen',
      minutes: 1,
      concentration: true,
    });
    expect(concentrationOf(db.getSnapshot(), caster.id).map((t) => t.id)).toEqual([first.timer.id]);
    const second = castSpell(db, {
      casterId: caster.id,
      label: 'Unsichtbarkeit',
      minutes: 60,
      concentration: true,
    });
    expect(second.ended.map((t) => t.id)).toEqual([first.timer.id]);
    const data = db.getSnapshot();
    expect(runningTimers(data).map((t) => t.label)).toEqual(['Unsichtbarkeit']);
    expect(spellTitle(data, second.timer)).toBe(`${caster.name}: Unsichtbarkeit`);
    const line = Object.values(data.chronicle).find((e) => e.text.includes('Unsichtbarkeit'))!;
    expect(line.text).toContain('Segen endet');
    expect(line.refs).toContain(caster.id);

    second.undo();
    const back = db.getSnapshot();
    expect(runningTimers(back).map((t) => t.label)).toEqual(['Segen']);
    expect(Object.values(back.chronicle).some((e) => e.text.includes('Unsichtbarkeit'))).toBe(
      false,
    );
  });
});

describe('Namen aus der Leiste in die Mitschrift', () => {
  it('setzt den Namen an den Anfang einer leeren Zeile, sonst dahinter', () => {
    expect(withName('', 'Mira')).toBe('Mira ');
    expect(withName('Mira schleicht,  ', 'Brann')).toBe('Mira schleicht, Brann ');
  });
});

describe('Zauber aus dem Satz', () => {
  it('nimmt den Wirker und „wirkt“ heraus', () => {
    expect(spellLabelFrom('Corrin wirkt Unsichtbarkeit', 'Corrin')).toBe('Unsichtbarkeit');
    expect(spellLabelFrom('corrin: Segen', 'Corrin')).toBe('Segen');
    expect(spellLabelFrom('Feuerball', null)).toBe('Feuerball');
  });
});
