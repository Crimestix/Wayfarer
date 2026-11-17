import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { addSupplies, startJourney, travelOn } from '../../features/reise/actions';
import { wayWithHexMap } from '../../features/reise/hexway';
import { bodyHalts, bountyOf, journeyUnderway, nextHalt, planJourney } from '../journey';
import { createEntity, createPath, type Place } from '../schema';
import { MINUTES_PER_DAY, dayIndexOf } from '../time/calendar';
import { fallDice, hazardLine, heatDc, marchDc } from '../travelRules';

const dice = () => () => 20;

/** Zwei erfundene Orte über der Erde, ein langer Weg dazwischen; es ist Mittag. */
async function setup(minutes = 3000) {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const place = (name: string, more: Partial<Place['place']> = {}) =>
    db.put('entities', createEntity({ kind: 'place', name, place: more })) as Place;
  const heath = place('Graue Heide', { yield: 'poor', water: false });
  const from = place('Kesselfurt', { parentId: heath.id });
  const to = place('Ostwacht', { parentId: heath.id });
  const path = db.put('paths', createPath({ fromId: from.id, toId: to.id, minutes }));
  const noon = dayIndexOf(db.getSnapshot().state.now) * MINUTES_PER_DAY + 12 * 60;
  db.setState({ placeId: from.id, now: noon });
  return { db, data: () => db.getSnapshot(), from, to, heath, path };
}

describe('Regeln der Reise', () => {
  it('rechnen SG und Sturz nach dem Regelwerk', () => {
    expect(marchDc(1)).toBe(11);
    expect(marchDc(3)).toBe(13);
    expect(heatDc(1)).toBe(5);
    expect(heatDc(4)).toBe(8);
    expect(fallDice(35)).toBe('3W6 Wucht');
    expect(fallDice(500)).toBe('20W6 Wucht');
    expect(hazardLine({ kind: 'slope', dc: 13, fallFeet: 40, text: 'Der Krähenhang' })).toBe(
      'Der Krähenhang – Geschicklichkeit (Akrobatik) SG 13 – wer scheitert, stürzt 40 Fuß: 4W6 Wucht',
    );
  });

  it('liest, was eine Gegend hergibt – auch von der Gegend darüber', async () => {
    const { data, from } = await setup();
    expect(bountyOf(data(), from.id)).toEqual({ yield: 'poor', water: false });
  });

  it('hält, wenn es dunkel wird, und um Mitternacht, wenn Proviant oder Wasser fehlen', async () => {
    const { db, data, from, to } = await setup();
    startJourney(db, {
      toId: to.id,
      plan: planJourney(data(), from.id, to.id)!,
      food: 0,
      water: 0,
    });
    const halts = bodyHalts(data(), journeyUnderway(data())!, data().state.now, 24 * 60);
    const kinds = halts.map((halt) => [halt.kind, halt.at]);
    // Mittag: Um 20 Uhr wird es dunkel, um Mitternacht fehlen Wasser und Proviant.
    expect(kinds).toContainEqual(['dark', 8 * 60]);
    expect(kinds).toContainEqual(['thirst', 12 * 60]);
    expect(kinds).toContainEqual(['hunger', 12 * 60]);
    expect(halts.find((halt) => halt.kind === 'hunger')!.text).toContain('SG 10');
  });

  it('hält an einer Gefahr am Weg – einmal, zu Beginn', async () => {
    const { db, data, from, to, path } = await setup();
    db.patch('paths', path.id, {
      hazard: { kind: 'climb', dc: 15, fallFeet: 20, text: '' },
    });
    startJourney(db, { toId: to.id, plan: planJourney(data(), from.id, to.id)! });
    const first = travelOn(db, dice())!;
    expect(first.halt).toMatchObject({ kind: 'hazard', minutes: 0 });
    expect(first.halt.text).toContain('Stärke (Athletik) SG 15');
    // Danach geht es weiter, ohne noch einmal zu halten.
    expect(nextHalt(data(), journeyUnderway(data())!, dice())?.kind).not.toBe('hazard');
  });

  it('rechnet die Strecke nach dem Tempo – feste Dauern gelten immer', async () => {
    const { data, from, to } = await setup();
    const fixed = planJourney(data(), from.id, to.id, 'fast')!;
    expect(fixed.minutes).toBe(3000);
  });

  it('legt Gefundenes zu den Vorräten – mit Zeile in der Chronik und Rückgängig', async () => {
    const { db, data, from, to } = await setup();
    startJourney(db, { toId: to.id, plan: planJourney(data(), from.id, to.id)!, food: 1 });
    const undo = addSupplies(db, 2, 1)!;
    expect(journeyUnderway(data())!.supplies).toEqual({ food: 3, water: 1 });
    expect(Object.values(data().chronicle).some((e) => e.text.startsWith('Nahrungssuche'))).toBe(
      true,
    );
    undo();
    expect(journeyUnderway(data())!.supplies).toEqual({ food: 1, water: null });
  });

  it('legt eine Landschaft auf die Hexkarte einer freien Strecke', async () => {
    const { db, data, from, to } = await setup();
    const forest = db.put(
      'entities',
      createEntity({ kind: 'landscape', name: 'Nebelforst', landscape: { base: 'forest' } }),
    );
    const path = wayWithHexMap(db, from.id, to.id, 60, {
      landscape: forest.kind === 'landscape' ? forest : null,
    })!;
    const area = data().areas[path.areaId!]!;
    expect(area.biome).toBe('forest');
    expect(area.hexes.some((hex) => hex.landscapeId === forest.id)).toBe(true);
  });
});
