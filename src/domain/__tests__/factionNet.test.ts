import { describe, expect, it } from 'vitest';
import { setAttitude } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { placeInNet, tidyNet } from '../../features/welt/netActions';
import {
  NET,
  PERSONS_PER_GROUP,
  factionNet,
  filterNet,
  monogramOf,
  netBounds,
  netCurve,
  netIndex,
  netLabel,
  netMatches,
  netNeighbors,
  relationTone,
} from '../factionNet';
import { PARTY_ID, createEntity, createRelation, type EntityKind } from '../schema';

/**
 * Erfundene Welt um Graufels: Die Wache und Krummzahns Bande sind verfeindet, die Salzsieder mit
 * der Wache verbündet. Mira führt Haus Tannhaus, Odo gehört dazu; Brann Eichwald führt die Wache.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  for (const relation of Object.values(db.getSnapshot().relations))
    db.remove('relations', relation.id);
  const add = (kind: EntityKind, name: string, more: Record<string, unknown> = {}) =>
    db.put('entities', createEntity({ kind, name, ...more } as Parameters<typeof createEntity>[0]));
  const relate = (from: string, to: string, type: string, more: Record<string, unknown> = {}) =>
    db.put('relations', createRelation({ from, to, type, ...more }));
  const watch = add('faction', 'Graufelser Wache', { faction: { category: 'Stadtwache' } });
  const gang = add('faction', 'Krummzahns Bande');
  const salt = add('faction', 'Gilde der Salzsieder');
  const house = add('family', 'Haus Tannhaus');
  const brann = add('person', 'Brann Eichwald', { person: { role: 'Hauptmann' } });
  const krumm = add('person', 'Krummzahn');
  const mira = add('person', 'Mira Tannhaus');
  const odo = add('person', 'Odo Tannhaus');
  const lando = add('person', 'Lando Furtner', { person: { workplaceId: salt.id } });
  const host = add('person', 'Wirt Holler');
  const ghost = add('person', 'Alter Graufels', { person: { status: 'dead' } });
  relate(brann.id, watch.id, 'leads');
  relate(krumm.id, gang.id, 'leads');
  relate(mira.id, house.id, 'leads');
  relate(odo.id, house.id, 'member');
  relate(ghost.id, watch.id, 'member');
  relate(watch.id, gang.id, 'enemy');
  relate(salt.id, watch.id, 'ally');
  relate(salt.id, watch.id, 'owes');
  relate(lando.id, gang.id, 'fears');
  relate(mira.id, odo.id, 'custom', { kin: 'sibling' });
  relate(host.id, mira.id, 'friend');
  setAttitude(db, watch.id, PARTY_ID, 3);
  setAttitude(db, gang.id, PARTY_ID, -4);
  const data = () => db.getSnapshot();
  return { db, data, watch, gang, salt, house, brann, krumm, mira, odo, lando, host, ghost };
}

describe('Wer im Netz steht', () => {
  it('Fraktionen, Familien, die Gruppe – und nur Personen, die an einer Fraktion hängen', async () => {
    const w = await setup();
    const net = factionNet(w.data());
    const ids = new Set(net.nodes.map((node) => node.id));
    for (const entity of [
      w.watch,
      w.gang,
      w.salt,
      w.house,
      w.brann,
      w.krumm,
      w.mira,
      w.odo,
      w.lando,
    ])
      expect(ids.has(entity.id)).toBe(true);
    expect(ids.has(PARTY_ID)).toBe(true);
    // Der Wirt kennt nur Mira; der Alte ist tot.
    expect(ids.has(w.host.id)).toBe(false);
    expect(ids.has(w.ghost.id)).toBe(false);
    const node = (id: string) => net.nodes.find((entry) => entry.id === id)!;
    expect(node(w.brann.id)).toMatchObject({ orbit: w.watch.id, leader: true, r: NET.leader });
    expect(node(w.odo.id)).toMatchObject({ orbit: w.house.id, leader: false, r: NET.person });
    expect(node(w.lando.id).orbit).toBe(w.salt.id);
    expect(node(w.watch.id)).toMatchObject({ sub: 'Stadtwache', attitude: 3, monogram: 'GW' });
    expect(node(w.house.id)).toMatchObject({ kind: 'family', sub: 'Familie' });
    // Die Gruppe wird zuletzt gezeichnet, also oben.
    expect(net.nodes[net.nodes.length - 1]!.id).toBe(PARTY_ID);
  });

  it('ohne Haltung zur Gruppe gibt es keinen Knoten der Gruppe', async () => {
    const w = await setup();
    setAttitude(w.db, w.watch.id, PARTY_ID, null);
    setAttitude(w.db, w.gang.id, PARTY_ID, null);
    expect(factionNet(w.data()).nodes.some((node) => node.id === PARTY_ID)).toBe(false);
  });

  it('um eine Fraktion kreisen höchstens neun – Führende und Verbundene bleiben', async () => {
    const w = await setup();
    for (let i = 0; i < 12; i++) {
      const guard = w.db.put(
        'entities',
        createEntity({ kind: 'person', name: `Wächter ${String(i).padStart(2, '0')}` }),
      );
      w.db.put('relations', createRelation({ from: guard.id, to: w.watch.id, type: 'member' }));
    }
    const net = factionNet(w.data());
    const around = net.nodes.filter((node) => node.orbit === w.watch.id);
    expect(around).toHaveLength(PERSONS_PER_GROUP);
    expect(around.some((node) => node.id === w.brann.id)).toBe(true);
    expect(net.nodes.find((node) => node.id === w.watch.id)!.more).toBe(13 - PERSONS_PER_GROUP);
  });
});

describe('Fäden', () => {
  it('Ton nach Art und Haltung; je Paar ein Faden mit allen Sätzen', async () => {
    const w = await setup();
    const net = factionNet(w.data());
    const edge = (a: string, b: string) =>
      net.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
    expect(edge(w.watch.id, w.gang.id)!.tone).toBe('foe');
    const pact = edge(w.salt.id, w.watch.id)!;
    expect(pact.tone).toBe('friend');
    expect(pact.lines).toEqual([
      'Gilde der Salzsieder verbündet mit Graufelser Wache',
      'Gilde der Salzsieder steht in der Schuld von Graufelser Wache',
    ]);
    expect(edge(w.watch.id, PARTY_ID)).toMatchObject({
      party: true,
      tone: 'friend',
      lines: ['Graufelser Wache zur Gruppe: Befreundet'],
    });
    expect(edge(w.gang.id, PARTY_ID)!.tone).toBe('foe');
    expect(edge(w.lando.id, w.gang.id)!.tone).toBe('tense');
    expect(edge(w.brann.id, w.watch.id)).toMatchObject({ member: true, tone: 'bond' });
    expect(edge(w.lando.id, w.salt.id)).toMatchObject({
      member: true,
      lines: ['Lando Furtner arbeitet für Gilde der Salzsieder'],
    });
    // Verwandtschaft zeigt der Stammbaum, nicht das Netz.
    expect(edge(w.mira.id, w.odo.id)).toBeUndefined();
  });

  it('die Haltung geht der Art vor', () => {
    expect(relationTone({ type: 'ally', attitude: -4 })).toBe('foe');
    expect(relationTone({ type: 'knows', attitude: 3 })).toBe('friend');
    expect(relationTone({ type: 'rival', attitude: null })).toBe('tense');
    expect(relationTone({ type: 'mentor', attitude: 0 })).toBe('plain');
  });
});

describe('Anordnung', () => {
  it('fest und wiederholbar; Fraktionen überlappen nicht; die Gruppe liegt in der Mitte', async () => {
    const w = await setup();
    const first = factionNet(w.data());
    expect(factionNet(w.data())).toEqual(first);
    const party = first.nodes.find((node) => node.id === PARTY_ID)!;
    expect([party.x, party.y]).toEqual([0, 0]);
    const groups = first.nodes.filter((node) => node.kind !== 'person');
    for (const a of groups)
      for (const b of groups)
        if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(a.r + b.r);
    for (const node of first.nodes) expect(Number.isFinite(node.x + node.y)).toBe(true);
    // Personen kreisen auf ihrem Ring um die Fraktion.
    const brann = first.nodes.find((node) => node.id === w.brann.id)!;
    const watch = first.nodes.find((node) => node.id === w.watch.id)!;
    expect(Math.round(Math.hypot(brann.x - watch.x, brann.y - watch.y))).toBeCloseTo(
      watch.r + NET.ring,
      -1,
    );
    expect(netBounds(first)).toHaveLength(first.nodes.length * 2);
  });

  it('was der Spielleiter hinlegt, bleibt dort – „Aufräumen“ legt neu aus', async () => {
    const w = await setup();
    placeInNet(w.db, { [w.gang.id]: { x: 900.4, y: -300 }, [w.odo.id]: { x: 10, y: 10 } });
    const net = factionNet(w.data());
    expect(net.nodes.find((node) => node.id === w.gang.id)).toMatchObject({
      x: 900,
      y: -300,
      placed: true,
    });
    expect(net.nodes.find((node) => node.id === w.odo.id)).toMatchObject({ x: 10, y: 10 });
    const undo = tidyNet(w.db);
    expect(w.data().state.netBoard).toEqual({});
    undo();
    expect(Object.keys(w.data().state.netBoard)).toHaveLength(2);
  });
});

describe('Sichten', () => {
  it('nur Fraktionen, mit Personen, nur Feindschaften', async () => {
    const w = await setup();
    const net = factionNet(w.data());
    const factions = filterNet(net, 'factions');
    expect(factions.nodes.every((node) => node.kind !== 'person')).toBe(true);
    expect(factions.edges.every((edge) => !edge.member)).toBe(true);
    expect(filterNet(net, 'people')).toBe(net);
    const feuds = filterNet(net, 'feuds');
    const ids = new Set(feuds.nodes.map((node) => node.id));
    // Bande, Wache, Gruppe (feindselige Haltung), Lando (fürchtet) – und seine Gilde.
    for (const id of [w.gang.id, w.watch.id, PARTY_ID, w.lando.id, w.salt.id])
      expect(ids.has(id)).toBe(true);
    expect(ids.has(w.house.id)).toBe(false);
    expect(feuds.edges.some((edge) => edge.tone === 'friend')).toBe(false);
  });

  it('Nachbarn, Suche, Monogramm und Verlauf der Fäden', async () => {
    const w = await setup();
    const net = factionNet(w.data());
    expect([...netNeighbors(net, w.gang.id)].sort()).toEqual(
      [w.gang.id, w.watch.id, PARTY_ID, w.krumm.id, w.lando.id].sort(),
    );
    expect([...netMatches(net, 'tannhaus')].sort()).toEqual(
      [w.house.id, w.mira.id, w.odo.id].sort(),
    );
    expect(netMatches(net, '  ').size).toBe(0);
    expect(monogramOf('Gilde der Salzsieder')).toBe('GS');
    expect(monogramOf('Krummzahn')).toBe('K');
    expect(monogramOf('Orden vom Ährenkranz')).toBe('OÄ');
    expect(monogramOf('')).toBe('?');
    const a = { x: 0, y: 0, r: 10 };
    const b = { x: 100, y: 0, r: 20 };
    expect(netCurve({ key: 'x', member: true }, a, b)).toEqual({
      d: 'M 10 0 L 80 0',
      mid: { x: 45, y: 0 },
    });
    const curved = netCurve({ key: 'y', member: false }, a, b);
    expect(curved.d).toMatch(/^M 10 0 Q 45 -?14 80 0$/);
    expect(netCurve({ key: 'y', member: false }, a, b)).toEqual(curved);
  });
});

describe('Die Liste neben dem Netz', () => {
  it('Fraktionen und Familien mit Personen, Verbündeten und Feinden – auch über ihre Leute gefunden', async () => {
    const w = await setup();
    const net = factionNet(w.data());
    const rows = netIndex(net);
    expect(rows.map((row) => row.node.kind).every((kind) => kind !== 'person')).toBe(true);
    const watch = rows.find((row) => row.node.id === w.watch.id)!;
    // Brann; verbündet mit den Salzsiedern und der Gruppe; verfeindet mit der Bande.
    expect(watch).toMatchObject({ people: 1, friends: 2, foes: 1 });
    expect(netIndex(net, 'brann').map((row) => row.node.id)).toEqual([w.watch.id]);
  });
});

describe('Namen am Siegel', () => {
  it('unter dem Siegel – oder bei Personen auf dem Ring nach außen', () => {
    expect(netLabel({ r: 40, angle: null, kind: 'faction' })).toEqual({
      x: 0,
      y: 46,
      anchor: 'middle',
      baseline: 'hanging',
    });
    expect(netLabel({ r: 17, angle: 0, kind: 'person' })).toMatchObject({
      x: 22,
      anchor: 'start',
      baseline: 'central',
    });
    expect(netLabel({ r: 17, angle: Math.PI, kind: 'person' }).anchor).toBe('end');
    expect(netLabel({ r: 17, angle: -Math.PI / 2, kind: 'person' })).toMatchObject({
      anchor: 'middle',
      baseline: 'auto',
    });
  });

  it('Personen auf dem Ring tragen ihre Richtung', async () => {
    const w = await setup();
    const net = factionNet(w.data());
    expect(net.nodes.find((node) => node.id === w.brann.id)!.angle).not.toBeNull();
    expect(net.nodes.find((node) => node.id === w.watch.id)!.angle).toBeNull();
  });
});
