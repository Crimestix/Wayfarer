/**
 * Der Stammbaum als Zeichnung: wer in welcher Zeile steht, wo genau, und welche Linien ihn mit
 * den anderen verbinden. Reine Rechnung auf dem Geflecht aus `kin.ts`; gezeichnet wird in
 * `features/welt/FamilyTree.tsx`.
 */
import {
  derivedKin,
  generations,
  genderOf,
  kinComponent,
  kinGraph,
  kinLabel,
  siblingGroups,
} from './kin';
import type { CampaignData } from './schema';

type TreeData = Pick<CampaignData, 'entities' | 'relations'>;

/** Maße einer Karte im Stammbaum und die Abstände dazwischen, in Bildpunkten. */
export const TREE = { cardW: 172, cardH: 56, gapX: 26, gapY: 62, pad: 24 } as const;

export interface TreeNode {
  id: string;
  /** Generation: 0 ist die älteste. */
  level: number;
  /** Linke obere Ecke der Karte. */
  x: number;
  y: number;
  /** Gehört zur Familie (sonst: eingeheiratet oder über Verwandte verbunden). */
  member: boolean;
}

export interface TreeLayout {
  nodes: TreeNode[];
  width: number;
  height: number;
  /** Paare: eine Linie zwischen den beiden Karten. */
  couples: { a: string; b: string }[];
  /** Linien von Eltern zu Kind als Punktfolge. */
  descents: { child: string; points: [number, number][] }[];
  /** Geschwister ohne bekannte Eltern: eine Klammer über ihnen. */
  brackets: { ids: string[]; points: [number, number][][] }[];
  /** Alles Übrige, was eingetragen ist (Tante, Cousin …): eine gestrichelte Linie mit Wort. */
  links: { from: string; to: string; label: string; points: [number, number][] }[];
  /** Familienmitglieder ohne jede Verwandtschaft – sie stehen nicht im Baum. */
  loose: string[];
}

/** Die Personen, die zu einer Familie gehören: über eine bestehende Beziehung mit ihr verbunden. */
export function familyMembers(data: TreeData, familyId: string): string[] {
  const ids = new Set<string>();
  for (const r of Object.values(data.relations)) {
    if (r.ended) continue;
    const other = r.from === familyId ? r.to : r.to === familyId ? r.from : null;
    const entity = other ? data.entities[other] : undefined;
    if (entity && (entity.kind === 'person' || entity.kind === 'character')) ids.add(entity.id);
  }
  const name = (id: string) => data.entities[id]!.name;
  return [...ids].sort((a, b) => name(a).localeCompare(name(b), 'de') || a.localeCompare(b));
}

const center = (node: TreeNode): number => node.x + TREE.cardW / 2;

/**
 * Ordnet den Stammbaum einer Familie an: ihre Mitglieder und alle, die über Verwandtschaften
 * mit ihnen verbunden sind. Eltern stehen über ihren Kindern, Paare nebeneinander.
 */
export function familyTree(data: TreeData, familyId: string): TreeLayout {
  const members = familyMembers(data, familyId);
  const graph = kinGraph(data);
  const people = new Set<string>();
  const loose: string[] = [];
  for (const id of members) {
    if (!graph.people.has(id)) {
      loose.push(id);
      continue;
    }
    for (const other of kinComponent(data, id)) people.add(other);
  }
  return layoutTree(data, [...people], new Set(members), loose);
}

/** Ordnet eine Gruppe verwandter Personen an. */
export function layoutTree(
  data: TreeData,
  people: readonly string[],
  members: ReadonlySet<string> = new Set(people),
  loose: string[] = [],
): TreeLayout {
  const graph = kinGraph(data);
  const inView = new Set(people);
  const level = generations(data, people);
  const name = (id: string) => data.entities[id]?.name ?? '';
  const parentsOf = (id: string) => [...(graph.parents.get(id) ?? [])].filter((p) => inView.has(p));
  const childrenOf = (id: string) =>
    [...(graph.children.get(id) ?? [])].filter((c) => inView.has(c));
  const partnersOf = (id: string) =>
    [...(graph.partners.get(id) ?? [])].filter(
      (p) => inView.has(p) && level.get(p) === level.get(id),
    );

  // ── Reihenfolge je Zeile ──
  const rows: string[][] = [];
  for (const id of [...inView].sort(
    (a, b) => name(a).localeCompare(name(b), 'de') || a.localeCompare(b),
  )) {
    const row = level.get(id) ?? 0;
    (rows[row] ??= []).push(id);
  }
  for (let i = 0; i < rows.length; i++) rows[i] ??= [];
  const index = new Map<string, number>();
  const reindex = (row: string[]) => row.forEach((id, i) => index.set(id, i));
  rows.forEach((row, depth) => {
    if (depth > 0) {
      // Kinder stehen unter ihren Eltern: sortiert nach deren mittlerem Platz.
      const key = (id: string) => {
        const parents = parentsOf(id).filter((p) => level.get(p) === depth - 1);
        return parents.length
          ? parents.reduce((sum, p) => sum + index.get(p)!, 0) / parents.length
          : Infinity;
      };
      const keys = new Map(row.map((id) => [id, key(id)]));
      row.sort((a, b) => keys.get(a)! - keys.get(b)! || name(a).localeCompare(name(b), 'de'));
    }
    // Wer einheiratet (keine Eltern im Bild), rückt neben seinen Partner.
    const placed = new Set<string>();
    const ordered: string[] = [];
    const married = (id: string) => parentsOf(id).length === 0 && partnersOf(id).length > 0;
    for (const id of row) {
      if (placed.has(id) || (married(id) && partnersOf(id).some((p) => !married(p)))) continue;
      ordered.push(id);
      placed.add(id);
      for (const partner of partnersOf(id))
        if (!placed.has(partner) && parentsOf(partner).length === 0) {
          ordered.push(partner);
          placed.add(partner);
        }
    }
    for (const id of row) if (!placed.has(id)) ordered.push(id);
    rows[depth] = ordered;
    reindex(ordered);
  });

  // ── Plätze ──
  const step = TREE.cardW + TREE.gapX;
  const nodes = new Map<string, TreeNode>();
  rows.forEach((row, depth) =>
    row.forEach((id, i) =>
      nodes.set(id, {
        id,
        level: depth,
        x: i * step,
        y: depth * (TREE.cardH + TREE.gapY),
        member: members.has(id),
      }),
    ),
  );
  const settle = (row: string[], wish: (id: string) => number | null) => {
    let free = -Infinity;
    for (const id of row) {
      const node = nodes.get(id)!;
      const wanted = wish(id);
      node.x = Math.max(wanted ?? node.x, free);
      free = node.x + step;
    }
  };
  const mean = (ids: string[]) =>
    ids.length ? ids.reduce((sum, id) => sum + nodes.get(id)!.x, 0) / ids.length : null;
  for (let pass = 0; pass < 3; pass++) {
    // Abwärts: Kinder rücken unter die Mitte ihrer Eltern.
    for (let depth = 1; depth < rows.length; depth++)
      settle(rows[depth]!, (id) => mean(parentsOf(id)));
    // Aufwärts: Eltern rücken über die Mitte ihrer Kinder.
    for (let depth = rows.length - 2; depth >= 0; depth--)
      settle(rows[depth]!, (id) => mean(childrenOf(id)));
  }
  const all = [...nodes.values()];
  const left = all.length ? Math.min(...all.map((n) => n.x)) : 0;
  for (const node of all) {
    node.x = Math.round(node.x - left + TREE.pad);
    node.y += TREE.pad;
  }

  // ── Linien ──
  const couples: TreeLayout['couples'] = [];
  for (const [a, others] of graph.partners)
    for (const b of others) if (a < b && nodes.has(a) && nodes.has(b)) couples.push({ a, b });

  const descents: TreeLayout['descents'] = [];
  for (const node of all) {
    const parents = parentsOf(node.id).map((id) => nodes.get(id)!);
    if (!parents.length) continue;
    const top: [number, number] = [center(node), node.y];
    const pair =
      parents.length === 2 &&
      parents[0]!.level === parents[1]!.level &&
      graph.partners.get(parents[0]!.id)?.has(parents[1]!.id);
    // Ein Paar: Die Linie beginnt in der Mitte zwischen beiden; sonst unter jedem Elternteil.
    const starts: [number, number][] = pair
      ? [[(center(parents[0]!) + center(parents[1]!)) / 2, parents[0]!.y + TREE.cardH / 2]]
      : parents.map((p) => [center(p), p.y + TREE.cardH] as [number, number]);
    for (const start of starts) {
      const turn = node.y - TREE.gapY / 2;
      descents.push({
        child: node.id,
        points: [start, [start[0], turn], [top[0], turn], top],
      });
    }
  }

  const brackets: TreeLayout['brackets'] = [];
  for (const group of siblingGroups(graph)) {
    const shown = group
      .filter((id) => nodes.has(id) && parentsOf(id).length === 0)
      .map((id) => nodes.get(id)!)
      .sort((a, b) => a.x - b.x);
    if (shown.length < 2 || new Set(shown.map((n) => n.level)).size > 1) continue;
    const bar = shown[0]!.y - 14;
    brackets.push({
      ids: shown.map((n) => n.id),
      points: [
        [
          [center(shown[0]!), bar],
          [center(shown[shown.length - 1]!), bar],
        ],
        ...shown.map(
          (n) =>
            [
              [center(n), bar],
              [center(n), n.y],
            ] as [number, number][],
        ),
      ],
    });
  }

  const drawn = new Set(['parent', 'child', 'spouse', 'sibling']);
  const links: TreeLayout['links'] = [];
  for (const r of graph.relations) {
    const from = nodes.get(r.from);
    const to = nodes.get(r.to);
    if (!from || !to || drawn.has(r.kin!)) continue;
    // Was sich aus Eltern, Paaren und Geschwistern ohnehin ergibt, braucht keine eigene Linie.
    if (derivedKin(data, r.from, r.to) === r.kin) continue;
    const mid = TREE.cardH / 2;
    links.push({
      from: r.from,
      to: r.to,
      label: kinLabel(r.kin!, genderOf(data.entities[r.from])),
      points: [
        [center(from), from.y + mid],
        [center(to), to.y + mid],
      ],
    });
  }

  return {
    nodes: all.sort((a, b) => a.level - b.level || a.x - b.x),
    width: Math.max(0, ...all.map((n) => n.x + TREE.cardW)) + TREE.pad,
    height: rows.length ? rows.length * (TREE.cardH + TREE.gapY) - TREE.gapY + TREE.pad * 2 : 0,
    couples,
    descents,
    brackets,
    links,
    loose,
  };
}
