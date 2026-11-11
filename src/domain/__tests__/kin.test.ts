import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { removeKin, setKin } from '../../features/welt/kin';
import { articlesWithHints } from '../../features/ki/AiOverview';
import {
  derivedKin,
  generations,
  inverseKin,
  kinInSentence,
  kinLabel,
  kinOfWord,
  relativesOf,
} from '../kin';
import { TREE, familyMembers, familyTree } from '../kinTree';
import { ArticleSchema, createEntity, createRelation } from '../schema';

/**
 * Die erfundene Familie Tannhaus:
 *
 *   Greta ⚭ Wim            (Großeltern)
 *     ├── Odo ⚭ Hilda       Odo und Mira sind Geschwister (über die Eltern)
 *     │     └── Finn
 *     └── Mira
 *           └── Lene        Finn und Lene sind Cousin und Cousine
 *   Bero ist Bruder von Greta (ohne eingetragene Eltern) – Großonkel von Finn.
 */
async function setup() {
  const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
  const person = (name: string) => db.put('entities', createEntity({ kind: 'person', name }));
  const family = db.put('entities', createEntity({ kind: 'family', name: 'Familie Tannhaus' }));
  const [greta, wim, odo, hilda, mira, finn, lene, bero] = [
    'Greta Tannhaus',
    'Wim Tannhaus',
    'Odo Tannhaus',
    'Hilda vom Reusenhof',
    'Mira Tannhaus',
    'Finn Tannhaus',
    'Lene Tannhaus',
    'Bero Graufels',
  ].map(person) as [
    ReturnType<typeof person>,
    ReturnType<typeof person>,
    ReturnType<typeof person>,
    ReturnType<typeof person>,
    ReturnType<typeof person>,
    ReturnType<typeof person>,
    ReturnType<typeof person>,
    ReturnType<typeof person>,
  ];
  for (const member of [greta, wim, odo, mira, finn, lene])
    db.put('relations', createRelation({ from: member.id, to: family.id, type: 'member' }));
  const say = (from: { id: string }, word: string, to: { id: string }) => {
    const read = kinOfWord(word)!;
    return setKin(db, from.id, to.id, read.kin, read.gender)!;
  };
  say(greta, 'Ehefrau', wim);
  say(greta, 'Mutter', odo);
  say(wim, 'Vater', odo);
  say(greta, 'Mutter', mira);
  say(wim, 'Vater', mira);
  say(hilda, 'Ehefrau', odo);
  say(finn, 'Sohn', odo);
  say(finn, 'Sohn', hilda);
  say(lene, 'Tochter', mira);
  say(bero, 'Bruder', greta);
  const data = () => db.getSnapshot();
  const what = (a: { id: string }, b: { id: string }) => derivedKin(data(), a.id, b.id);
  return { db, data, what, say, family, greta, wim, odo, hilda, mira, finn, lene, bero };
}

describe('Verwandtschaft', () => {
  it('liest Wörter mit ihrem Geschlecht und kennt die Gegenrichtung', () => {
    expect(kinOfWord('Schwester')).toEqual({ kin: 'sibling', gender: 'f' });
    expect(kinOfWord('Großonkel')).toEqual({ kin: 'great-aunt', gender: 'm' });
    expect(kinOfWord('Vetter')).toEqual({ kin: 'cousin', gender: 'm' });
    expect(kinOfWord('Nachbarin')).toBeNull();
    expect(inverseKin('aunt')).toBe('niece');
    expect(inverseKin('cousin')).toBe('cousin');
    expect([kinLabel('aunt', 'f'), kinLabel('aunt', 'm'), kinLabel('aunt', null)]).toEqual([
      'Tante',
      'Onkel',
      'Tante oder Onkel',
    ]);
    expect(kinInSentence('Sie ist die Schwester von Odo Tannhaus.')).toEqual({
      kin: 'sibling',
      gender: 'f',
    });
    // „Frau“ allein ist noch keine Ehe.
    expect(kinInSentence('Eine Frau aus Hohenfurt.')).toBeNull();
  });

  it('leitet ab, was sich aus Eltern, Paaren und Geschwistern ergibt', async () => {
    const { what, greta, wim, odo, hilda, mira, finn, lene, bero } = await setup();
    expect(what(mira, odo)).toBe('sibling');
    expect(what(greta, finn)).toBe('grandparent');
    expect(what(finn, wim)).toBe('grandchild');
    expect(what(mira, finn)).toBe('aunt');
    expect(what(finn, mira)).toBe('niece');
    expect(what(finn, lene)).toBe('cousin');
    // Bero ist Gretas Bruder, ihre Eltern kennt niemand: Großonkel der Enkel, Onkel der Kinder.
    expect(what(bero, odo)).toBe('aunt');
    expect(what(bero, finn)).toBe('great-aunt');
    // Angeheiratet.
    expect(what(hilda, mira)).toBe('sibling-in-law');
    expect(what(greta, hilda)).toBe('parent-in-law');
    expect(what(hilda, wim)).toBe('child-in-law');
    expect(what(greta, wim)).toBe('spouse');
    // Kein gemeinsamer Vorfahr und keine Ehe dazwischen: nichts.
    expect(what(hilda, lene)).toBeNull();
  });

  it('erkennt Großcousins, Halbgeschwister und Stiefeltern', async () => {
    const { db, what, say, mira, odo, finn, lene } = await setup();
    const person = (name: string) => db.put('entities', createEntity({ kind: 'person', name }));
    // Die Kinder von Cousin und Cousine sind Großcousins.
    const [jon, ada] = [person('Jon Tannhaus'), person('Ada Tannhaus')];
    say(jon, 'Sohn', finn);
    say(ada, 'Tochter', lene);
    expect(what(jon, ada)).toBe('second-cousin');
    expect(what(finn, ada)).toBe('aunt-2');
    // Ein neuer Partner von Mira ist Lenes Stiefvater; sein Kind mit Mira ihre Halbschwester.
    const [kurt, ida] = [person('Kurt Aalfischer'), person('Ida Aalfischer')];
    say(kurt, 'Ehemann', mira);
    expect(what(kurt, lene)).toBe('step-parent');
    say(ida, 'Tochter', mira);
    say(ida, 'Tochter', kurt);
    const vater = person('Lenes Vater');
    say(vater, 'Vater', lene);
    expect(what(ida, lene)).toBe('half-sibling');
    expect(what(odo, ida)).toBe('aunt');
  });

  it('nennt die Verwandten einer Person – eingetragen und abgeleitet, mit dem richtigen Wort', async () => {
    const { data, finn, greta } = await setup();
    const list = relativesOf(data(), finn.id).map((r) => [
      r.person.name,
      r.label,
      r.relation ? 'eingetragen' : 'abgeleitet',
    ]);
    expect(list).toEqual([
      ['Hilda vom Reusenhof', 'Mutter', 'eingetragen'],
      ['Odo Tannhaus', 'Elternteil', 'eingetragen'],
      ['Greta Tannhaus', 'Großmutter', 'abgeleitet'],
      ['Wim Tannhaus', 'Großvater', 'abgeleitet'],
      ['Mira Tannhaus', 'Tante oder Onkel', 'abgeleitet'],
      ['Bero Graufels', 'Großonkel', 'abgeleitet'],
      ['Lene Tannhaus', 'Cousine', 'abgeleitet'],
    ]);
    // Das Geschlecht merkt sich Wayfarer aus dem eingetragenen Wort.
    const stored = data().entities[greta.id];
    expect(stored?.kind === 'person' && stored.person.gender).toBe('f');
  });

  it('ersetzt eine vorhandene Verwandtschaft und lässt sie lösen', async () => {
    const { db, data, what, say, mira, odo, bero, greta } = await setup();
    const before = Object.keys(data().relations).length;
    // Bero ist doch nicht der Bruder, sondern der Cousin: dieselbe Beziehung, neu gelesen.
    const relation = say(bero, 'Cousin', greta);
    expect(Object.keys(data().relations).length).toBe(before);
    expect(relation.kin).toBe('cousin');
    expect(what(bero, odo)).toBeNull();
    // Aus der anderen Richtung eingetragen, steht es richtig herum in derselben Beziehung.
    say(greta, 'Tante', bero);
    expect(data().relations[relation.id]).toMatchObject({ from: bero.id, kin: 'niece' });
    const undo = removeKin(db, relation.id)!;
    expect(relativesOf(data(), bero.id)).toEqual([]);
    undo();
    expect(relativesOf(data(), bero.id).map((r) => r.label)).toEqual(['Tante']);
    expect(setKin(db, mira.id, mira.id, 'sibling')).toBeNull();
  });

  it('ordnet Generationen auch dann, wenn nur „Tante“ eingetragen ist', async () => {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const person = (name: string) => db.put('entities', createEntity({ kind: 'person', name }));
    const [tante, nichte, cousin, uroma] = ['Tante', 'Nichte', 'Cousin', 'Uroma'].map(person);
    setKin(db, tante!.id, nichte!.id, 'aunt', 'f');
    setKin(db, cousin!.id, nichte!.id, 'cousin', 'm');
    setKin(db, uroma!.id, tante!.id, 'grandparent', 'f');
    const level = generations(db.getSnapshot(), [tante!.id, nichte!.id, cousin!.id, uroma!.id]);
    expect([uroma, tante, nichte, cousin].map((p) => level.get(p!.id))).toEqual([0, 2, 3, 3]);
  });
});

describe('Stammbaum', () => {
  it('stellt Eltern über Kinder, Paare nebeneinander und zeichnet die Linien', async () => {
    const { data, family, greta, wim, odo, hilda, mira, finn, lene, bero } = await setup();
    expect(familyMembers(data(), family.id)).toHaveLength(6);
    const tree = familyTree(data(), family.id);
    const node = (p: { id: string }) => tree.nodes.find((n) => n.id === p.id)!;
    expect([greta, wim, bero].map((p) => node(p).level)).toEqual([0, 0, 0]);
    expect([odo, hilda, mira].map((p) => node(p).level)).toEqual([1, 1, 1]);
    expect([finn, lene].map((p) => node(p).level)).toEqual([2, 2]);
    // Paare stehen direkt nebeneinander, niemand überlappt.
    expect(Math.abs(node(greta).x - node(wim).x)).toBe(TREE.cardW + TREE.gapX);
    expect(Math.abs(node(odo).x - node(hilda).x)).toBe(TREE.cardW + TREE.gapX);
    for (const row of [0, 1, 2]) {
      const xs = tree.nodes.filter((n) => n.level === row).map((n) => n.x);
      xs.forEach((x, i) => i > 0 && expect(x - xs[i - 1]!).toBeGreaterThanOrEqual(TREE.cardW));
    }
    // Hilda und Bero gehören nicht zur Familie, stehen aber im Baum.
    expect([hilda, bero].map((p) => node(p).member)).toEqual([false, false]);
    expect(tree.couples).toHaveLength(2);
    // Finn hat ein Elternpaar: eine Linie aus dessen Mitte. Odo und Mira ebenso, Lene eine.
    expect(tree.descents.filter((d) => d.child === finn.id)).toHaveLength(1);
    expect(tree.descents).toHaveLength(4);
    const finnLine = tree.descents.find((d) => d.child === finn.id)!.points;
    expect(finnLine[0]![0]).toBeCloseTo((node(odo).x + node(hilda).x) / 2 + TREE.cardW / 2, 6);
    expect(finnLine[finnLine.length - 1]).toEqual([node(finn).x + TREE.cardW / 2, node(finn).y]);
    // Greta und Bero sind Geschwister ohne bekannte Eltern: eine Klammer über ihnen.
    expect(tree.brackets.map((b) => b.ids.sort())).toEqual([[bero.id, greta.id].sort()]);
    expect(tree.links).toEqual([]);
    expect(tree.loose).toEqual([]);
    expect(tree.width).toBeGreaterThan(3 * TREE.cardW);
    // Der Baum beginnt am linken Rand – kein leerer Streifen davor.
    expect(Math.min(...tree.nodes.map((n) => n.x))).toBe(TREE.pad);
  });

  it('zeichnet Eingetragenes ohne Eltern als eigene Linie und nennt Mitglieder ohne Verwandte', async () => {
    const { db, data, family, say, lene } = await setup();
    const person = (name: string) => db.put('entities', createEntity({ kind: 'person', name }));
    const base = person('Rika Graufels');
    say(base, 'Cousine', lene);
    const allein = person('Till Tannhaus');
    db.put('relations', createRelation({ from: allein.id, to: family.id, type: 'member' }));
    const tree = familyTree(data(), family.id);
    expect(tree.links.map((l) => [l.from, l.to, l.label])).toEqual([[base.id, lene.id, 'Cousine']]);
    expect(tree.loose).toEqual([allein.id]);
    // Eine Familie ganz ohne Verwandtschaften hat keinen Baum.
    const other = db.put('entities', createEntity({ kind: 'family', name: 'Familie Aalfischer' }));
    expect(familyTree(data(), other.id)).toMatchObject({ nodes: [], loose: [] });
  });
});

describe('Vorschläge des KI-Lesers im Wiki', () => {
  it('listet die Artikel mit offenen Vorschlägen, die mit den meisten zuerst', () => {
    const article = (id: string, title: string, states: string[]) =>
      ArticleSchema.parse({
        id,
        rev: 0,
        created: '',
        updated: '',
        title,
        aiHints: states.map((state, i) => ({
          id: `${id}-${i}`,
          key: `${id}-${i}`,
          kind: 'thread',
          line: 'Offen',
          quote: '',
          payload: {},
          state,
        })),
      });
    const articles = {
      a: article('a', 'Hohenfurt', ['open', 'dismissed']),
      b: article('b', 'Graufels', ['open', 'open']),
      c: article('c', 'Reusenhof', ['accepted']),
      d: article('d', 'Aalinsel', []),
    };
    expect(articlesWithHints(articles).map((a) => a.title)).toEqual(['Graufels', 'Hohenfurt']);
  });
});
