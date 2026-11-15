import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../../data/db';
import { demoCampaign } from '../../../data/__fixtures__/demoWorld';
import { MemoryStore } from '../../../data/store';
import { entitiesOfKind } from '../../../domain/derive';
import { clearInView, toggleInView } from '../commands';
import { castRowOf, castView, type CastRow } from '../model';
import { castMatches, castSections, inViewIds, peekView, stepIn } from '../peek';

async function demoDb() {
  return CampaignDb.create(new MemoryStore(), demoCampaign());
}
const person = (db: CampaignDb, name: string) =>
  entitiesOfKind(db.getSnapshot(), 'person').find((p) => p.name === name)!;

describe('Kurzblick', () => {
  it('zeigt das Wichtigste, ohne Kurzbeschreibung doppelt', async () => {
    const db = await demoDb();
    const voss = person(db, 'Hauptmann Voss');
    const view = peekView(db.getSnapshot(), voss.id)!;
    expect(view.entity.id).toBe(voss.id);
    expect(view.hasAttitude).toBe(true);
    expect(view.memory.some((fact) => fact.kind === 'tagline')).toBe(false);
    expect(view.ties.length).toBeGreaterThan(0);
    expect(peekView(db.getSnapshot(), 'gibt-es-nicht')).toBeNull();
  });

  it('blättert ringsum', () => {
    expect(stepIn(['a', 'b', 'c'], 'c', 1)).toBe('a');
    expect(stepIn(['a', 'b', 'c'], 'a', -1)).toBe('c');
    expect(stepIn(['a', 'b'], 'x', 1)).toBe('a');
    expect(stepIn([], 'a', 1)).toBeNull();
  });
});

describe('Im Blick', () => {
  it('nimmt auf, nimmt heraus und leert mit Rückgängig', async () => {
    const db = await demoDb();
    const voss = person(db, 'Hauptmann Voss');
    expect(toggleInView(db, voss.id)).toBe(true);
    expect(inViewIds(db.getSnapshot())).toEqual([voss.id]);
    expect(castRowOf(db.getSnapshot(), voss.id)?.entity.id).toBe(voss.id);
    const undo = clearInView(db);
    expect(inViewIds(db.getSnapshot())).toEqual([]);
    undo();
    expect(toggleInView(db, voss.id)).toBe(false);
    expect(inViewIds(db.getSnapshot())).toEqual([]);
  });
});

describe('Große Orte', () => {
  const row = (name: string, where: string | null, role = ''): CastRow =>
    ({
      entity: { id: name, name, aliases: [] },
      role,
      where,
      tagline: '',
    }) as unknown as CastRow;

  it('sucht in Name, Rolle und Ort, ohne Groß/Klein und Akzente', () => {
    expect(castMatches(row('Ilvara', 'Fischkai', 'Widerständler'), 'wider')).toBe(true);
    expect(castMatches(row('Ilvara', 'Fischkai'), 'fisch')).toBe(true);
    expect(castMatches(row('Ilvara', null), 'ILV')).toBe(true);
    expect(castMatches(row('Ilvara', null), 'Tosk')).toBe(false);
    expect(castMatches(row('Ilvara', null), '  ')).toBe(true);
  });

  it('ordnet nach den Orten darin, wer unmittelbar hier ist zuerst', () => {
    const sections = castSections([
      row('A', null),
      row('B', 'Fischkai'),
      row('C', 'Fischkai'),
      row('D', 'Nordkai'),
    ]);
    expect(sections.map((s) => [s.title, s.rows.map((r) => r.entity.name)])).toEqual([
      [null, ['A']],
      ['Fischkai', ['B', 'C']],
      ['Nordkai', ['D']],
    ]);
  });

  it('passt zu dem, was „Wer hier ist“ zeigt', async () => {
    const db = await demoDb();
    const data = db.getSnapshot();
    const hafen = entitiesOfKind(data, 'place').find((p) => p.name === 'Dornhafen')!;
    const cast = castView(data, hafen.id);
    expect(castSections(cast.present).flatMap((s) => s.rows)).toHaveLength(cast.present.length);
  });
});
