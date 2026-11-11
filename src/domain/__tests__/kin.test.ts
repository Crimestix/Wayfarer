import { describe, expect, it } from 'vitest';
import { CampaignDb } from '../../data/db';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import { removeKin, setKin, skipKinSuggestion } from '../../features/welt/kin';
import { articlesWithHints } from '../../features/ki/AiOverview';
import {
  derivedKin,
  generations,
  kinSuggestions,
  inverseKin,
  kinInSentence,
  kinLabel,
  kinOfWord,
  relativesOf,
} from '../kin';
import { TREE, familyMembers, familyTree, layoutTree } from '../kinTree';
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
    // Der Cousin der Mutter ist ein Onkel zweiten Grades.
    expect(what(bero, odo)).toBe('aunt-2');
    // Aus der anderen Richtung eingetragen, steht es richtig herum in derselben Beziehung.
    say(greta, 'Tante', bero);
    expect(data().relations[relation.id]).toMatchObject({ from: bero.id, kin: 'niece' });
    const undo = removeKin(db, relation.id)!;
    expect(relativesOf(data(), bero.id)).toEqual([]);
    undo();
    // Eingetragen ist die Tante; ihre Kinder und Enkel ergeben sich als Cousins dazu.
    const again = relativesOf(data(), bero.id);
    expect(again.filter((r) => r.relation).map((r) => r.label)).toEqual(['Tante']);
    expect(again.length).toBeGreaterThan(1);
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

describe('Verwandtschaft schließen', () => {
  async function people(...names: string[]) {
    const db = await CampaignDb.create(new MemoryStore(), elarisCampaign());
    const made = names.map((name) => db.put('entities', createEntity({ kind: 'person', name })));
    const say = (from: number, word: string, to: number) => {
      const read = kinOfWord(word)!;
      return setKin(db, made[from]!.id, made[to]!.id, read.kin, read.gender)!;
    };
    const what = (a: number, b: number) => derivedKin(db.getSnapshot(), made[a]!.id, made[b]!.id);
    return { db, made, say, what };
  }

  it('folgert aus „Tante von“ und „Sohn von“ den Cousin – und alles Weitere', async () => {
    // 0 Hilda, 1 Odo, 2 Finn, 3 Lene
    const { say, what } = await people('Hilda', 'Odo', 'Finn', 'Lene');
    say(0, 'Tante', 1);
    say(2, 'Sohn', 0);
    expect(what(2, 1)).toBe('cousin');
    expect(what(1, 2)).toBe('cousin');
    // Odos Tochter: Hilda ist ihre Großtante, Finn ihr Onkel zweiten Grades.
    say(3, 'Tochter', 1);
    expect(what(0, 3)).toBe('great-aunt');
    expect(what(3, 0)).toBe('great-niece');
    expect(what(2, 3)).toBe('aunt-2');
  });

  it('teilt unter vollen Geschwistern Eltern, Geschwister und entfernte Verwandte', async () => {
    // 0 Mira, 1 Odo, 2 Greta (Mutter), 3 Till (Bruder), 4 Rika (Cousine), 5 Uroma
    const { db, made, say, what } = await people('Mira', 'Odo', 'Greta', 'Till', 'Rika', 'Uroma');
    say(0, 'Schwester', 1);
    say(2, 'Mutter', 0);
    expect(what(2, 1)).toBe('parent');
    say(3, 'Bruder', 1);
    expect(what(3, 0)).toBe('sibling');
    expect(what(2, 3)).toBe('parent');
    say(4, 'Cousine', 0);
    expect(what(4, 1)).toBe('cousin');
    say(5, 'Urgroßmutter', 3);
    expect(what(5, 0)).toBe('great-grandparent');
    // Im Stammbaum steht Odo unter der Mutter, obwohl sie nur bei Mira eingetragen ist.
    const tree = layoutTree(
      db.getSnapshot(),
      made.map((p) => p.id),
    );
    expect(tree.descents.map((d) => d.child).sort()).toEqual(
      [made[0]!.id, made[1]!.id, made[3]!.id].sort(),
    );
    expect(tree.brackets).toEqual([]);
  });

  it('schließt nicht, was offen ist: die Cousine kann über Mutter oder Vater kommen', async () => {
    // 0 Rika, 1 Lene, 2 Jon
    const { say, what } = await people('Rika', 'Lene', 'Jon');
    say(0, 'Cousine', 1);
    say(2, 'Cousin', 1);
    expect(what(0, 2)).toBeNull();
  });

  it('schlägt vor, was naheliegt – und nimmt es zurück, sobald es geklärt ist', async () => {
    // 0 Hilda, 1 Odo, 2 Greta (Odos Mutter), 3 Wim (Odos Vater)
    const { db, made, say, what } = await people('Hilda', 'Odo', 'Greta', 'Wim');
    const aunt = say(0, 'Tante', 1);
    expect(kinSuggestions(db.getSnapshot())).toEqual([]);
    say(2, 'Mutter', 1);
    const one = kinSuggestions(db.getSnapshot());
    expect(one.map((s) => [s.line, s.reason])).toEqual([
      [
        'Hilda könnte Schwester von Greta sein',
        'weil Hilda Tante von Odo ist und Greta Mutter von Odo ist',
      ],
    ]);
    // Mit beiden Eltern gibt es zwei Möglichkeiten.
    say(3, 'Vater', 1);
    expect(
      kinSuggestions(db.getSnapshot())
        .map((s) => s.toId)
        .sort(),
    ).toEqual([made[2]!.id, made[3]!.id].sort());
    // Eine ablehnen: Sie kommt nicht wieder – bis der Spielleiter es sich anders überlegt.
    const undo = skipKinSuggestion(db, aunt.id, one[0]!.key)!;
    expect(kinSuggestions(db.getSnapshot()).map((s) => s.toId)).toEqual([made[3]!.id]);
    undo();
    expect(kinSuggestions(db.getSnapshot())).toHaveLength(2);
    // Eine annehmen: Die Tante ist geklärt, der andere Vorschlag erledigt sich.
    setKin(db, made[0]!.id, made[2]!.id, 'sibling');
    expect(kinSuggestions(db.getSnapshot())).toEqual([]);
    expect(what(0, 1)).toBe('aunt');
  });

  it('schlägt bei Cousins vor, dass ihre Eltern Geschwister sind', async () => {
    // 0 Rika, 1 Lene, 2 Bero (Rikas Vater), 3 Mira (Lenes Mutter)
    const { db, say } = await people('Rika', 'Lene', 'Bero', 'Mira');
    say(0, 'Cousine', 1);
    say(2, 'Vater', 0);
    say(3, 'Mutter', 1);
    expect(kinSuggestions(db.getSnapshot()).map((s) => s.line)).toEqual([
      'Bero könnte Bruder von Mira sein',
    ]);
  });
});

describe('Stammbaum', () => {
  it('zeichnet nach Art eines Genogramms: Zeichen nach Geschlecht, Linie unter dem Paar', async () => {
    const { data, family, greta, wim, hilda } = await setup();
    const tree = familyTree(data(), family.id);
    const node = (p: { id: string }) => tree.nodes.find((n) => n.id === p.id)!;
    expect([node(greta).gender, node(wim).gender, node(hilda).gender]).toEqual(['f', 'm', 'f']);
    const couple = tree.couples.find((c) => [c.a, c.b].includes(greta.id))!;
    const [l, r] = [node(greta), node(wim)].sort((a, b) => a.x - b.x);
    const under = l!.y + TREE.symbol + TREE.drop;
    // Von der Unterkante des einen Zeichens hinab, hinüber und zum anderen hinauf.
    expect(couple.points).toEqual([
      [l!.x + TREE.symbol / 2, l!.y + TREE.symbol],
      [l!.x + TREE.symbol / 2, under],
      [r!.x + TREE.symbol / 2, under],
      [r!.x + TREE.symbol / 2, r!.y + TREE.symbol],
    ]);
  });

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
    expect(finnLine[0]![0]).toBeCloseTo((node(odo).x + node(hilda).x) / 2 + TREE.symbol / 2, 6);
    expect(finnLine[finnLine.length - 1]).toEqual([node(finn).x + TREE.symbol / 2, node(finn).y]);
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
