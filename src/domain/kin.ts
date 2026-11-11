/**
 * Verwandtschaft und Stammbaum. Der Spielleiter trägt ein, was er weiß – „Mira ist die Schwester
 * von Odo“, „Hilda ist die Tante von Mira“ –, Wayfarer leitet den Rest ab: Generationen, weitere
 * Verwandte (wer Geschwister als Eltern hat, ist Cousin) und die Anordnung des Stammbaums.
 *
 * Eine Verwandtschaft ist eine Beziehung mit `kin`: Sie sagt, was `from` für `to` ist.
 * Reine Funktionen.
 */
import type { CampaignData, Entity, Relation } from './schema';

export type Gender = 'f' | 'm';

export interface KinType {
  key: string;
  /** Um wie viele Generationen `from` über `to` steht: Mutter +1, Tochter −1, Schwester 0. */
  up: number;
  /** Was `to` dann für `from` ist. */
  inverse: string;
  f: string;
  m: string;
  /** Ohne bekanntes Geschlecht. */
  n: string;
}

const kin = (
  key: string,
  up: number,
  inverse: string,
  f: string,
  m: string,
  n: string,
): KinType => ({
  key,
  up,
  inverse,
  f,
  m,
  n,
});

/** Alle Verwandtschaften, in der Reihenfolge, in der sie aufgelistet werden. */
export const KIN_TYPES: readonly KinType[] = [
  kin('spouse', 0, 'spouse', 'Ehefrau', 'Ehemann', 'Ehepartner'),
  kin('parent', 1, 'child', 'Mutter', 'Vater', 'Elternteil'),
  kin('child', -1, 'parent', 'Tochter', 'Sohn', 'Kind'),
  kin('sibling', 0, 'sibling', 'Schwester', 'Bruder', 'Geschwister'),
  kin('half-sibling', 0, 'half-sibling', 'Halbschwester', 'Halbbruder', 'Halbgeschwister'),
  kin('grandparent', 2, 'grandchild', 'Großmutter', 'Großvater', 'Großelternteil'),
  kin('grandchild', -2, 'grandparent', 'Enkelin', 'Enkel', 'Enkelkind'),
  kin(
    'great-grandparent',
    3,
    'great-grandchild',
    'Urgroßmutter',
    'Urgroßvater',
    'Urgroßelternteil',
  ),
  kin('great-grandchild', -3, 'great-grandparent', 'Urenkelin', 'Urenkel', 'Urenkelkind'),
  kin('aunt', 1, 'niece', 'Tante', 'Onkel', 'Tante oder Onkel'),
  kin('niece', -1, 'aunt', 'Nichte', 'Neffe', 'Nichte oder Neffe'),
  kin('great-aunt', 2, 'great-niece', 'Großtante', 'Großonkel', 'Großtante oder Großonkel'),
  kin('great-niece', -2, 'great-aunt', 'Großnichte', 'Großneffe', 'Großnichte oder Großneffe'),
  kin('cousin', 0, 'cousin', 'Cousine', 'Cousin', 'Cousin oder Cousine'),
  kin(
    'second-cousin',
    0,
    'second-cousin',
    'Großcousine',
    'Großcousin',
    'Großcousin oder Großcousine',
  ),
  kin('aunt-2', 1, 'niece-2', 'Tante 2. Grades', 'Onkel 2. Grades', 'Tante oder Onkel 2. Grades'),
  kin(
    'niece-2',
    -1,
    'aunt-2',
    'Nichte 2. Grades',
    'Neffe 2. Grades',
    'Nichte oder Neffe 2. Grades',
  ),
  kin('step-parent', 1, 'step-child', 'Stiefmutter', 'Stiefvater', 'Stiefelternteil'),
  kin('step-child', -1, 'step-parent', 'Stieftochter', 'Stiefsohn', 'Stiefkind'),
  kin(
    'parent-in-law',
    1,
    'child-in-law',
    'Schwiegermutter',
    'Schwiegervater',
    'Schwiegerelternteil',
  ),
  kin('child-in-law', -1, 'parent-in-law', 'Schwiegertochter', 'Schwiegersohn', 'Schwiegerkind'),
  kin('sibling-in-law', 0, 'sibling-in-law', 'Schwägerin', 'Schwager', 'Schwager oder Schwägerin'),
  kin('relative', 0, 'relative', 'Verwandte', 'Verwandter', 'verwandt'),
];

const BY_KEY = new Map(KIN_TYPES.map((type) => [type.key, type]));
const ORDER = new Map(KIN_TYPES.map((type, index) => [type.key, index]));

export const kinType = (key: string | null | undefined): KinType | null =>
  (key && BY_KEY.get(key)) || null;

export const inverseKin = (key: string): string => BY_KEY.get(key)?.inverse ?? 'relative';

/** „Schwester“, „Bruder“ oder – ohne bekanntes Geschlecht – „Geschwister“. */
export function kinLabel(key: string, gender: Gender | null | undefined): string {
  const type = BY_KEY.get(key) ?? BY_KEY.get('relative')!;
  return gender === 'f' ? type.f : gender === 'm' ? type.m : type.n;
}

const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

const WORDS = new Map<string, { kin: string; gender: Gender }>();
for (const type of KIN_TYPES) {
  WORDS.set(fold(type.f), { kin: type.key, gender: 'f' });
  WORDS.set(fold(type.m), { kin: type.key, gender: 'm' });
}
for (const [word, key, gender] of [
  ['Gattin', 'spouse', 'f'],
  ['Gemahlin', 'spouse', 'f'],
  ['Frau', 'spouse', 'f'],
  ['Gatte', 'spouse', 'm'],
  ['Gemahl', 'spouse', 'm'],
  ['Mann', 'spouse', 'm'],
  ['Vetter', 'cousin', 'm'],
  ['Base', 'cousin', 'f'],
  ['Zwillingsschwester', 'sibling', 'f'],
  ['Zwillingsbruder', 'sibling', 'm'],
  ['Oma', 'grandparent', 'f'],
  ['Opa', 'grandparent', 'm'],
] as const)
  WORDS.set(fold(word), { kin: key, gender });

/** Liest ein Wort wie „Schwester“ oder „Onkel“: welche Verwandtschaft und welches Geschlecht. */
export const kinOfWord = (word: string): { kin: string; gender: Gender } | null =>
  WORDS.get(fold(word)) ?? null;

/** Das erste Wort eines Satzes, das eine Verwandtschaft nennt: „Sie ist die Schwester von …“. */
export function kinInSentence(sentence: string): { kin: string; gender: Gender } | null {
  for (const word of sentence.split(/[^\p{L}]+/u)) {
    const read = word ? kinOfWord(word) : null;
    // „Frau“ und „Mann“ sind im Fließtext zu allgemein, um daraus eine Ehe zu lesen.
    if (read && !/^(frau|mann)$/i.test(word)) return read;
  }
  return null;
}

// ── Das Geflecht ───────────────────────────────────────────────────────────

type KinData = Pick<CampaignData, 'entities' | 'relations'>;

const isPerson = (entity: Entity | undefined): entity is Entity =>
  entity?.kind === 'person' || entity?.kind === 'character';

/** Die eingetragenen Verwandtschaften: gültig, nicht beendet, zwischen zwei Personen. */
export function kinRelations(data: KinData): Relation[] {
  return Object.values(data.relations)
    .filter(
      (r) =>
        !r.ended &&
        r.from !== r.to &&
        kinType(r.kin) !== null &&
        isPerson(data.entities[r.from]) &&
        isPerson(data.entities[r.to]),
    )
    .sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
}

export const genderOf = (entity: Entity | undefined): Gender | null =>
  entity?.kind === 'person' ? entity.person.gender : null;

export interface KinGraph {
  /** Kind → seine bekannten Eltern. */
  parents: Map<string, Set<string>>;
  /** Elternteil → seine bekannten Kinder. */
  children: Map<string, Set<string>>;
  partners: Map<string, Set<string>>;
  /** Geschwister, wie eingetragen (ohne die, die sich aus gemeinsamen Eltern ergeben). */
  siblings: Map<string, Set<string>>;
  halfSiblings: Map<string, Set<string>>;
  /** Alle Personen, die in irgendeiner Verwandtschaft vorkommen. */
  people: Set<string>;
  relations: Relation[];
}

const link = (map: Map<string, Set<string>>, a: string, b: string) => {
  const set = map.get(a);
  if (set) set.add(b);
  else map.set(a, new Set([b]));
};

const graphCache = new WeakMap<object, KinGraph>();

/** Das Geflecht aus Eltern, Kindern, Paaren und Geschwistern, gelesen aus den Verwandtschaften. */
export function kinGraph(data: KinData): KinGraph {
  const cached = graphCache.get(data.relations);
  if (cached) return cached;
  const graph: KinGraph = {
    parents: new Map(),
    children: new Map(),
    partners: new Map(),
    siblings: new Map(),
    halfSiblings: new Map(),
    people: new Set(),
    relations: kinRelations(data),
  };
  const parentOf = (parent: string, child: string) => {
    link(graph.parents, child, parent);
    link(graph.children, parent, child);
  };
  for (const r of graph.relations) {
    graph.people.add(r.from);
    graph.people.add(r.to);
    switch (r.kin) {
      case 'parent':
        parentOf(r.from, r.to);
        break;
      case 'child':
        parentOf(r.to, r.from);
        break;
      case 'spouse':
        link(graph.partners, r.from, r.to);
        link(graph.partners, r.to, r.from);
        break;
      case 'sibling':
        link(graph.siblings, r.from, r.to);
        link(graph.siblings, r.to, r.from);
        break;
      case 'half-sibling':
        link(graph.halfSiblings, r.from, r.to);
        link(graph.halfSiblings, r.to, r.from);
        break;
    }
  }
  graphCache.set(data.relations, graph);
  return graph;
}

/**
 * Geschwistergruppen: Wer als Geschwister eingetragen ist (auch über Dritte), gehört zusammen.
 * Jede Gruppe steht für ein gemeinsames, vielleicht unbekanntes Elternpaar.
 */
export function siblingGroups(graph: KinGraph): string[][] {
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const start of [...graph.siblings.keys()].sort()) {
    if (seen.has(start)) continue;
    const group: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const id = queue.shift()!;
      group.push(id);
      for (const other of graph.siblings.get(id) ?? [])
        if (!seen.has(other)) {
          seen.add(other);
          queue.push(other);
        }
    }
    groups.push(group.sort());
  }
  return groups;
}

/**
 * Die Vorfahren einer Person mit ihrem Abstand in Generationen. Unbekannte Eltern von
 * Geschwistern zählen als gedachter Vorfahr („~…“), damit sich Cousins auch dann ergeben, wenn
 * die Großeltern nie eingetragen wurden.
 */
function ancestors(
  graph: KinGraph,
  virtual: Map<string, string[]>,
  id: string,
): Map<string, number> {
  const found = new Map<string, number>([[id, 0]]);
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    const depth = found.get(current)!;
    if (depth >= 4) continue;
    for (const parent of [...(graph.parents.get(current) ?? []), ...(virtual.get(current) ?? [])])
      if (!found.has(parent)) {
        found.set(parent, depth + 1);
        queue.push(parent);
      }
  }
  return found;
}

const virtualCache = new WeakMap<KinGraph, Map<string, string[]>>();

/** Gedachte Eltern: je Geschwistergruppe ohne gemeinsamen bekannten Elternteil einer. */
function virtualParents(graph: KinGraph): Map<string, string[]> {
  const cached = virtualCache.get(graph);
  if (cached) return cached;
  const virtual = new Map<string, string[]>();
  const add = (id: string, parent: string) => {
    const list = virtual.get(id);
    if (list) list.push(parent);
    else virtual.set(id, [parent]);
  };
  for (const group of siblingGroups(graph)) {
    const shared = [...(graph.parents.get(group[0]!) ?? [])].filter((parent) =>
      group.every((member) => graph.parents.get(member)?.has(parent)),
    );
    if (shared.length) continue;
    for (const member of group) add(member, `~${group[0]}`);
  }
  for (const [a, others] of graph.halfSiblings)
    for (const b of others) if (a < b) for (const id of [a, b]) add(id, `~halb-${a}-${b}`);
  virtualCache.set(graph, virtual);
  return virtual;
}

/**
 * Blutsverwandtschaft als Zahlenpaar „p/q“: `a` steht p Generationen unter dem nächsten
 * gemeinsamen Vorfahren, `b` q Generationen. 0/1 = Elternteil, 1/1 = Geschwister, 2/2 = Cousin.
 */
const BLOOD: Record<string, string> = {
  '0/1': 'parent',
  '0/2': 'grandparent',
  '0/3': 'great-grandparent',
  '1/0': 'child',
  '2/0': 'grandchild',
  '3/0': 'great-grandchild',
  '1/1': 'sibling',
  '1/2': 'aunt',
  '2/1': 'niece',
  '1/3': 'great-aunt',
  '3/1': 'great-niece',
  '2/2': 'cousin',
  '3/3': 'second-cousin',
  '2/3': 'aunt-2',
  '3/2': 'niece-2',
};
const PAIR_OF = new Map(Object.entries(BLOOD).map(([pair, key]) => [key, pair]));

/** Weiter als so viele Generationen reicht kein Schluss. */
const MAX_DEPTH = 4;

interface Blood {
  p: number;
  q: number;
  /** Geschwister mit denselben beiden Eltern – nur dann teilen sie auch alle Vorfahren. */
  full: boolean;
}

export interface KinClosure {
  /** a → b → was `a` für `b` ist. */
  blood: Map<string, Map<string, Blood>>;
  /** Kind → Eltern, eingetragen oder erschlossen. */
  parents: Map<string, Set<string>>;
  children: Map<string, Set<string>>;
  /** Volle Geschwister, eingetragen oder erschlossen. */
  siblings: Map<string, Set<string>>;
}

const closureCache = new WeakMap<object, KinClosure>();

/**
 * Alles, was sich aus den eingetragenen Verwandtschaften sicher schließen lässt. Zuerst, was aus
 * Eltern und Geschwistern folgt (gemeinsame Vorfahren), dazu das Eingetragene selbst („Tante
 * von“), dann Schluss um Schluss, bis nichts Neues mehr dazukommt:
 *
 * - Wer von jemandem abstammt, erbt dessen Verwandte nach oben: Ist X die Tante von Y und Z der
 *   Sohn von X, dann ist Z der Cousin von Y.
 * - Wer mit jemandem verwandt ist, ist es auch mit dessen Nachkommen: Die Tante der Mutter ist
 *   die Großtante des Kindes.
 * - Volle Geschwister teilen Eltern, Geschwister und alle Verwandten über die Großeltern hinaus.
 *
 * Nicht geschlossen wird, was offen ist: Die Cousine von Y kann über Mutter oder Vater kommen.
 */
export function kinClosure(data: KinData): KinClosure {
  const cached = closureCache.get(data.relations);
  if (cached) return cached;
  const graph = kinGraph(data);
  const virtual = virtualParents(graph);
  const blood: KinClosure['blood'] = new Map();
  const get = (a: string, b: string) => blood.get(a)?.get(b);
  const set = (a: string, b: string, p: number, q: number, full: boolean): boolean => {
    if (a === b || p > MAX_DEPTH || q > MAX_DEPTH || get(a, b)) return false;
    const put = (x: string, y: string, value: Blood) => {
      const row = blood.get(x);
      if (row) row.set(y, value);
      else blood.set(x, new Map([[y, value]]));
    };
    put(a, b, { p, q, full });
    put(b, a, { p: q, q: p, full });
    return true;
  };
  const people = [...graph.people].sort();

  // 1. Aus Eltern und Geschwistern: der nächste gemeinsame Vorfahr.
  const stated = new Set<string>();
  for (const group of siblingGroups(graph))
    for (const a of group) for (const b of group) if (a !== b) stated.add(`${a}|${b}`);
  const lines = new Map(people.map((id) => [id, ancestors(graph, virtual, id)]));
  for (let i = 0; i < people.length; i++)
    for (let j = i + 1; j < people.length; j++) {
      const [a, b] = [people[i]!, people[j]!];
      let best: [number, number] | null = null;
      for (const [ancestor, da] of lines.get(a)!) {
        const db = lines.get(b)!.get(ancestor);
        if (db !== undefined && (!best || da + db < best[0] + best[1])) best = [da, db];
      }
      if (!best) continue;
      const pa = graph.parents.get(a);
      const pb = graph.parents.get(b);
      const shared = pa && pb ? [...pa].filter((parent) => pb.has(parent)).length : 0;
      set(a, b, best[0], best[1], stated.has(`${a}|${b}`) || shared >= 2);
    }

  // 2. Was eingetragen ist: Tante, Cousin, Großvater …
  for (const r of graph.relations) {
    const pair = PAIR_OF.get(r.kin!);
    if (!pair || r.kin === 'parent' || r.kin === 'child' || r.kin === 'sibling') continue;
    const [p, q] = pair.split('/').map(Number) as [number, number];
    set(r.from, r.to, p, q, false);
  }

  // 3. Schließen, bis nichts Neues mehr folgt.
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const b of people) {
      const row = blood.get(b);
      if (!row) continue;
      const around = [...row.entries()];
      for (const [a, back] of around) {
        // back ist „b für a“; gebraucht wird „a für b“.
        const { p, q } = { p: back.q, q: back.p };
        for (const [c, next] of around) {
          if (c === a || get(a, c)) continue;
          const { p: r, q: s } = next;
          const siblingsAB = p === 1 && q === 1 && back.full;
          const siblingsBC = r === 1 && s === 1 && next.full;
          let found: [number, number, boolean] | null = null;
          // a stammt von b ab: b's Verwandte nach oben sind auch a's.
          if (q === 0 && r >= 1) found = [p + r, s, false];
          // c stammt von b ab: Wer mit b verwandt ist, ist es auch mit c.
          else if (r === 0 && (q >= 1 || p === 0)) found = [p, q + s, false];
          else if (siblingsAB) {
            if (r >= 2) found = [r, s, false];
            else if (r === 1 && s === 0) found = [1, 0, false];
            else if (siblingsBC) found = [1, 1, true];
          } else if (siblingsBC) {
            if (q >= 2) found = [p, q, false];
            else if (q === 1 && p === 0) found = [0, 1, false];
          }
          if (found && set(a, c, found[0], found[1], found[2])) changed = true;
        }
      }
    }
    if (!changed) break;
  }

  const closure: KinClosure = {
    blood,
    parents: new Map(),
    children: new Map(),
    siblings: new Map(),
  };
  for (const [a, row] of blood)
    for (const [b, value] of row) {
      if (value.p === 1 && value.q === 0) {
        link(closure.parents, a, b);
        link(closure.children, b, a);
      }
      if (value.p === 1 && value.q === 1 && value.full) link(closure.siblings, a, b);
    }
  closureCache.set(data.relations, closure);
  return closure;
}

const pairName = (p: number, q: number): string => BLOOD[`${p}/${q}`] ?? 'relative';

/**
 * Was `a` für `b` ist, abgeleitet aus allem Eingetragenen – null, wenn sich nichts ergibt. Erst
 * das Blut, dann die Ehe (Schwager, Schwiegereltern, Stiefeltern).
 */
export function derivedKin(data: KinData, a: string, b: string): string | null {
  if (a === b) return null;
  const graph = kinGraph(data);
  if (graph.partners.get(a)?.has(b)) return 'spouse';
  const closure = kinClosure(data);
  const found = closure.blood.get(a)?.get(b);
  if (found) {
    if (found.p === 1 && found.q === 1 && !found.full) {
      // Eingetragen als Halbgeschwister – oder zwei bekannte Elternpaare mit nur einem
      // gemeinsamen Elternteil.
      const pa = graph.parents.get(a);
      const pb = graph.parents.get(b);
      const shared = pa && pb ? [...pa].filter((parent) => pb.has(parent)).length : 0;
      if (
        graph.halfSiblings.get(a)?.has(b) ||
        (pa && pb && pa.size >= 2 && pb.size >= 2 && shared === 1)
      )
        return 'half-sibling';
    }
    return pairName(found.p, found.q);
  }
  const partnersOf = (id: string) => [...(graph.partners.get(id) ?? [])];
  const isParent = (parent: string, child: string) =>
    closure.parents.get(child)?.has(parent) ?? false;
  const isSibling = (x: string, y: string) => {
    const pair = closure.blood.get(x)?.get(y);
    return pair?.p === 1 && pair.q === 1;
  };
  // Der Partner eines Elternteils, der selbst kein Elternteil ist – und umgekehrt.
  if (partnersOf(a).some((partner) => isParent(partner, b))) return 'step-parent';
  if (partnersOf(b).some((partner) => isParent(partner, a))) return 'step-child';
  // Die Eltern des Partners – und der Partner des Kindes.
  if (partnersOf(b).some((partner) => isParent(a, partner))) return 'parent-in-law';
  if (partnersOf(a).some((partner) => isParent(b, partner))) return 'child-in-law';
  // Geschwister des Partners oder Partner der Geschwister.
  if (
    partnersOf(a).some((partner) => isSibling(partner, b)) ||
    partnersOf(b).some((partner) => isSibling(partner, a))
  )
    return 'sibling-in-law';
  return null;
}

/** Was sich allein aus Eltern, Paaren und Geschwistern ergibt – ohne das übrige Eingetragene. */
export function plainKin(data: KinData, a: string, b: string): string | null {
  const graph = kinGraph(data);
  if (graph.partners.get(a)?.has(b)) return 'spouse';
  const virtual = virtualParents(graph);
  const up = ancestors(graph, virtual, a);
  const other = ancestors(graph, virtual, b);
  let best: [number, number] | null = null;
  for (const [ancestor, da] of up) {
    const db = other.get(ancestor);
    if (db !== undefined && (!best || da + db < best[0] + best[1])) best = [da, db];
  }
  return best ? pairName(best[0], best[1]) : null;
}

// ── Vorschläge ─────────────────────────────────────────────────────────────

export interface KinSuggestion {
  /** Eindeutig – damit ein abgelehnter Vorschlag nicht wiederkommt. */
  key: string;
  fromId: string;
  toId: string;
  kin: string;
  /** „Hilda könnte die Schwester von Greta sein“ */
  line: string;
  /** „weil Hilda die Tante von Odo ist und Greta dessen Mutter“ */
  reason: string;
  /** Die eingetragene Verwandtschaft, aus der der Vorschlag folgt. */
  relationId: string;
}

/**
 * Was naheliegt, aber nicht sicher ist. Eine eingetragene Verwandtschaft über mehrere
 * Generationen („Tante von Odo“) führt über Eltern, die vielleicht schon eingetragen sind: Ist
 * Odos Mutter bekannt, könnte die Tante deren Schwester sein – oder die des Vaters. Solche
 * Verbindungen schlägt Wayfarer vor; der Spielleiter entscheidet.
 */
export function kinSuggestions(data: KinData): KinSuggestion[] {
  const graph = kinGraph(data);
  const closure = kinClosure(data);
  const name = (id: string) => data.entities[id]?.name ?? '?';
  const word = (key: string, id: string) => kinLabel(key, genderOf(data.entities[id]));
  const related = (a: string, b: string) => closure.blood.get(a)?.get(b);
  const is = (a: string, b: string, p: number, q: number) => {
    const pair = related(a, b);
    return pair?.p === p && pair.q === q;
  };
  const out = new Map<string, KinSuggestion>();
  for (const r of graph.relations) {
    const pair = PAIR_OF.get(r.kin!);
    if (!pair) continue;
    const [p, q] = pair.split('/').map(Number) as [number, number];
    const [a, b] = [r.from, r.to];
    const parentsA = p >= 2 ? [...(closure.parents.get(a) ?? [])].sort() : [];
    const parentsB = q >= 2 ? [...(closure.parents.get(b) ?? [])].sort() : [];
    const because = `${name(a)} ${word(r.kin!, a)} von ${name(b)} ist`;
    const suggest = (fromId: string, toId: string, np: number, nq: number, via: string[]) => {
      const parts = [because, ...via.map((part) => `${part} ist`)];
      const kin = pairName(np, nq);
      const key = `${fromId}|${toId}|${kin}`;
      if (fromId === toId || kin === 'relative' || related(fromId, toId)) return;
      if (r.kinSkip.includes(key) || out.has(key)) return;
      out.set(key, {
        key,
        fromId,
        toId,
        kin,
        line: `${name(fromId)} könnte ${word(kin, fromId)} von ${name(toId)} sein`,
        reason: `weil ${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`,
        relationId: r.id,
      });
    };
    const parentWord = (parent: string, child: string) =>
      `${name(parent)} ${word('parent', parent)} von ${name(child)}`;
    // Beide Seiten führen über bekannte Eltern: Dann sind es am ehesten die Eltern untereinander.
    if (parentsA.length && parentsB.length) {
      if (parentsA.some((n) => parentsB.some((m) => is(n, m, p - 1, q - 1)))) continue;
      for (const n of parentsA)
        for (const m of parentsB) suggest(n, m, p - 1, q - 1, [parentWord(n, a), parentWord(m, b)]);
      continue;
    }
    if (parentsB.length && !parentsB.some((m) => is(a, m, p, q - 1)))
      for (const m of parentsB) suggest(a, m, p, q - 1, [parentWord(m, b)]);
    if (parentsA.length && !parentsA.some((n) => is(n, b, p - 1, q)))
      for (const n of parentsA) suggest(n, b, p - 1, q, [parentWord(n, a)]);
  }
  return [...out.values()];
}

/** Alle, die mit einer Person über Verwandtschaften verbunden sind (sie selbst eingeschlossen). */
export function kinComponent(data: KinData, start: string): Set<string> {
  const graph = kinGraph(data);
  const next = new Map<string, Set<string>>();
  for (const r of graph.relations) {
    link(next, r.from, r.to);
    link(next, r.to, r.from);
  }
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length)
    for (const other of next.get(queue.shift()!) ?? [])
      if (!seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
  return seen;
}

export interface Relative {
  person: Entity;
  /** Was die Person für den Gefragten ist. */
  kin: string;
  label: string;
  /** Eingetragen (mit der Beziehung) oder von Wayfarer abgeleitet. */
  relation: Relation | null;
}

/**
 * Die Verwandten einer Person: was eingetragen ist und was sich daraus ergibt. Eingetragenes
 * geht vor; „verwandt“ ohne nähere Angabe erscheint nur, wenn es so eingetragen wurde.
 */
export function relativesOf(data: KinData, personId: string): Relative[] {
  const graph = kinGraph(data);
  const out = new Map<string, Relative>();
  const put = (otherId: string, key: string, relation: Relation | null) => {
    const person = data.entities[otherId];
    if (!person || out.has(otherId)) return;
    out.set(otherId, { person, kin: key, label: kinLabel(key, genderOf(person)), relation });
  };
  for (const r of graph.relations) {
    if (r.to === personId) put(r.from, r.kin!, r);
    else if (r.from === personId) put(r.to, inverseKin(r.kin!), r);
  }
  for (const otherId of kinComponent(data, personId)) {
    if (otherId === personId || out.has(otherId)) continue;
    const key = derivedKin(data, otherId, personId);
    if (key && key !== 'relative') put(otherId, key, null);
  }
  return [...out.values()].sort(
    (a, b) =>
      (ORDER.get(a.kin) ?? 99) - (ORDER.get(b.kin) ?? 99) ||
      a.person.name.localeCompare(b.person.name, 'de'),
  );
}

// ── Generationen ───────────────────────────────────────────────────────────

/**
 * Die Generation jeder Person einer Gruppe: 0 ist die älteste, nach unten wird gezählt. Sie
 * ergibt sich aus allen Verwandtschaften – eine Tante steht eine Zeile über ihrer Nichte, auch
 * wenn deren Eltern nie eingetragen wurden.
 */
export function generations(data: KinData, people: Iterable<string>): Map<string, number> {
  const graph = kinGraph(data);
  const wanted = new Set(people);
  const steps = new Map<string, { other: string; down: number }[]>();
  const add = (from: string, other: string, down: number) => {
    const list = steps.get(from);
    if (list) list.push({ other, down });
    else steps.set(from, [{ other, down }]);
  };
  for (const r of graph.relations) {
    if (!wanted.has(r.from) || !wanted.has(r.to)) continue;
    const up = kinType(r.kin)!.up;
    // `from` steht `up` Generationen über `to`.
    add(r.from, r.to, up);
    add(r.to, r.from, -up);
  }
  const level = new Map<string, number>();
  for (const start of [...wanted].sort()) {
    if (level.has(start)) continue;
    const group = [start];
    level.set(start, 0);
    for (let i = 0; i < group.length; i++) {
      const id = group[i]!;
      for (const { other, down } of steps.get(id) ?? [])
        if (!level.has(other)) {
          level.set(other, level.get(id)! + down);
          group.push(other);
        }
    }
    const top = Math.min(...group.map((id) => level.get(id)!));
    for (const id of group) level.set(id, level.get(id)! - top);
  }
  return level;
}
