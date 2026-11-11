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

/**
 * Was `a` für `b` ist, abgeleitet aus dem Geflecht – null, wenn sich nichts ergibt. Erst das
 * Blut (gemeinsame Vorfahren), dann die Ehe (Schwager, Schwiegereltern, Stiefeltern).
 */
export function derivedKin(data: KinData, a: string, b: string): string | null {
  if (a === b) return null;
  const graph = kinGraph(data);
  if (graph.partners.get(a)?.has(b)) return 'spouse';
  const virtual = virtualParents(graph);
  const up = ancestors(graph, virtual, a);
  const other = ancestors(graph, virtual, b);
  let best: { da: number; db: number; half: boolean } | null = null;
  for (const [ancestor, da] of up) {
    const db = other.get(ancestor);
    if (db === undefined) continue;
    if (!best || da + db < best.da + best.db)
      best = { da, db, half: ancestor.startsWith('~halb-') };
  }
  if (best) {
    if (best.da === 1 && best.db === 1) {
      // Zwei bekannte Elternpaare, aber nur ein gemeinsamer Elternteil: Halbgeschwister.
      const pa = graph.parents.get(a);
      const pb = graph.parents.get(b);
      const shared = pa && pb ? [...pa].filter((p) => pb.has(p)).length : 0;
      if (best.half || (pa && pb && pa.size >= 2 && pb.size >= 2 && shared === 1))
        return 'half-sibling';
    }
    return BLOOD[`${best.da}/${best.db}`] ?? 'relative';
  }
  const partnersOf = (id: string) => [...(graph.partners.get(id) ?? [])];
  const isParent = (parent: string, child: string) =>
    graph.parents.get(child)?.has(parent) ?? false;
  const isSibling = (x: string, y: string) => derivedBlood(graph, virtual, x, y) === '1/1';
  // Der Partner eines Elternteils, der selbst kein Elternteil ist – und umgekehrt.
  if (partnersOf(a).some((p) => isParent(p, b))) return 'step-parent';
  if (partnersOf(b).some((p) => isParent(p, a))) return 'step-child';
  // Die Eltern des Partners – und der Partner des Kindes.
  if (partnersOf(b).some((p) => isParent(a, p))) return 'parent-in-law';
  if (partnersOf(a).some((p) => isParent(b, p))) return 'child-in-law';
  // Geschwister des Partners oder Partner der Geschwister.
  if (partnersOf(a).some((p) => isSibling(p, b)) || partnersOf(b).some((p) => isSibling(p, a)))
    return 'sibling-in-law';
  return null;
}

function derivedBlood(
  graph: KinGraph,
  virtual: Map<string, string[]>,
  a: string,
  b: string,
): string | null {
  const up = ancestors(graph, virtual, a);
  const other = ancestors(graph, virtual, b);
  let best: [number, number] | null = null;
  for (const [ancestor, da] of up) {
    const db = other.get(ancestor);
    if (db !== undefined && (!best || da + db < best[0] + best[1])) best = [da, db];
  }
  return best ? `${best[0]}/${best[1]}` : null;
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
