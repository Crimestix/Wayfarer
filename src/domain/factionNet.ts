/**
 * Das Fraktionsnetz: Fraktionen und Familien als große Siegel, die wichtigen Personen als kleine
 * Siegel um die Fraktion, zu der sie gehören, die Gruppe in der Mitte – und Fäden dazwischen nach
 * Beziehungsart und Haltung. Gelesen wird nur, was als Beziehung eingetragen ist; Wayfarer zieht
 * keine Verbindung von selbst.
 *
 * Die Anordnung ist fest und wiederholbar: Was der Spielleiter hingelegt hat
 * (`state.netBoard`), bleibt liegen; das Übrige legt ein Kräfte-Verfahren aus, das mit
 * `rngOf(seedOf(…))` beginnt – nie mit `Math.random`. Gleicher Stand, gleiches Bild.
 * Reine Funktionen.
 */
import { seedOf, rngOf } from './random';
import { attitudeLabel, relationLabel } from './relations';
import { PARTY_ID, type CampaignData, type Entity, type Relation } from './schema';

export type NetMode = 'factions' | 'people' | 'feuds';

export const NET_MODE_LABEL: Record<NetMode, string> = {
  factions: 'Nur Fraktionen',
  people: 'Mit Personen',
  feuds: 'Nur Feindschaften',
};

export type NetNodeKind = 'faction' | 'family' | 'person' | 'party';

/**
 * `friend` = verbündet, befreundet, wohlgesonnen; `foe` = verfeindet oder feindselig; `tense` =
 * Rivalität, Furcht, Schuld, Misstrauen; `bond` = Zugehörigkeit; `plain` = sonst verbunden.
 */
export type NetTone = 'friend' | 'foe' | 'tense' | 'bond' | 'plain';

export const NET_TONE_LABEL: Record<NetTone, string> = {
  friend: 'verbündet, befreundet',
  foe: 'verfeindet, feindselig',
  tense: 'Rivalität, Furcht, Misstrauen',
  bond: 'gehört dazu, führt',
  plain: 'sonst verbunden',
};

export interface NetNode {
  /** Kennung des Eintrags – oder `party` für die Gruppe. */
  id: string;
  kind: NetNodeKind;
  name: string;
  /** Ein oder zwei Buchstaben für das Siegel ohne Bild. */
  monogram: string;
  /** Das Bild, das der Spielleiter dem Eintrag gegeben hat. */
  image: string | null;
  /** „Gilde“, „Familie“, „Hauptmann der Wache“ – was unter dem Namen steht. */
  sub: string;
  /** Halbmesser des Siegels in den Maßen des Blatts. */
  r: number;
  x: number;
  y: number;
  /** Die Fraktion oder Familie, um die eine Person kreist. */
  orbit: string | null;
  /** Führt ihre Fraktion. */
  leader: boolean;
  /** Haltung zur Gruppe; null = nicht festgelegt. */
  attitude: number | null;
  /** Wie wichtig – bestimmt, wer bei vielen Personen bleibt. */
  weight: number;
  /** Vom Spielleiter hingelegt. */
  placed: boolean;
  /** Bei Fraktionen: Personen, die dazugehören, aber nur am Rand – nicht gezeichnet. */
  more: number;
  /**
   * Bei Personen auf einem Ring: die Richtung von ihrer Fraktion aus (Bogenmaß) – der Name steht
   * nach außen. null = Name unter dem Siegel.
   */
  angle: number | null;
}

export interface NetEdge {
  key: string;
  a: string;
  b: string;
  tone: NetTone;
  /** Was eingetragen ist, je Beziehung ein Satz – für die Beschriftung beim Darüberfahren. */
  lines: string[];
  /** Die Gruppe weiß von keiner dieser Beziehungen. */
  secret: boolean;
  /** Zugehörigkeit einer Person zu der Fraktion, um die sie kreist. */
  member: boolean;
  /** Haltung einer Fraktion zur Gruppe. */
  party: boolean;
}

export interface FactionNet {
  nodes: NetNode[];
  edges: NetEdge[];
}

/** Maße des Netzes in Bildpunkten des Blatts. */
export const NET = {
  faction: 46,
  family: 40,
  party: 56,
  person: 17,
  leader: 21,
  /** Abstand des ersten Rings der Personen vom Rand des Siegels. */
  ring: 36,
  /** Abstand zwischen zwei Ringen. */
  ringStep: 44,
  /** Bogen, den eine Person auf ihrem Ring braucht. */
  arc: 50,
  /** Platz für die Beschriftung unter einem Siegel. */
  label: 18,
} as const;

/** So viele Personen kreisen höchstens um eine Fraktion; die übrigen werden nur gezählt. */
export const PERSONS_PER_GROUP = 9;

/** Arten, die für sich nichts über Macht und Bündnisse sagen – nur mit einer Haltung zählen sie. */
const QUIET_TYPES = new Set([
  'knows',
  'speaks',
  'writes',
  'has-ability',
  'practises',
  'companion',
  'persona',
  'resides',
  'owns',
  'rules',
  'borders',
  'seat-of',
]);

const TONE_RANK: Record<NetTone, number> = { foe: 4, friend: 3, tense: 2, bond: 1, plain: 0 };

/** Der Ton einer Haltung: ab „Wohlgesonnen“ freundlich, ab „Feindselig“ verfeindet. */
export function attitudeTone(value: number | null): NetTone | null {
  if (value === null) return null;
  if (value <= -3) return 'foe';
  if (value <= -1) return 'tense';
  if (value >= 2) return 'friend';
  return null;
}

/** Der Ton einer Beziehung: Die Haltung geht vor, sonst sagt es die Art. */
export function relationTone(relation: Pick<Relation, 'type' | 'attitude'>): NetTone {
  const felt = attitudeTone(relation.attitude);
  if (felt) return felt;
  switch (relation.type) {
    case 'ally':
    case 'friend':
    case 'lover':
      return 'friend';
    case 'enemy':
      return 'foe';
    case 'rival':
    case 'fears':
    case 'seeks':
    case 'owes':
      return 'tense';
    case 'member':
    case 'leads':
    case 'serves':
    case 'employs':
      return 'bond';
    default:
      return 'plain';
  }
}

const STOP_WORDS = new Set([
  'der',
  'die',
  'das',
  'des',
  'den',
  'dem',
  'von',
  'vom',
  'zu',
  'zum',
  'zur',
  'und',
  'am',
  'im',
  'in',
  'an',
  'auf',
]);

/** „Gilde der Salzsieder“ → „GS“, „Krummzahn“ → „K“: die Anfänge der tragenden Wörter. */
export function monogramOf(name: string): string {
  const words = name
    .split(/[\s\-–—]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  const strong = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()));
  const pick = (strong.length ? strong : words).slice(0, 2);
  return pick.map((word) => [...word][0]!.toLocaleUpperCase('de')).join('') || '?';
}

type NetData = Pick<CampaignData, 'entities' | 'relations' | 'state'>;

const isGroup = (entity: Entity | undefined): boolean =>
  !!entity && (entity.kind === 'faction' || entity.kind === 'family') && entity.ended === null;

const isPerson = (entity: Entity | undefined): boolean =>
  !!entity && entity.kind === 'person' && entity.person.status !== 'dead';

/** Zugehörigkeit: Rang 0 führt, 1 gehört dazu, 2 dient, 3 arbeitet dort. */
function membershipRank(relation: Relation, personId: string): number | null {
  if (relation.from === personId) {
    if (relation.type === 'leads') return 0;
    if (relation.type === 'member') return 1;
    if (relation.type === 'serves') return 2;
    return null;
  }
  return relation.type === 'employs' ? 3 : null;
}

interface Pending {
  a: string;
  b: string;
  tone: NetTone;
  line: string;
  secret: boolean;
  member: boolean;
  party: boolean;
}

/**
 * Knoten und Fäden des Netzes – noch ohne Lage. Personen ohne Beziehung zu einer Fraktion oder
 * Familie fehlen; um eine Fraktion kreisen höchstens `PERSONS_PER_GROUP`, Führende zuerst.
 */
function netGraph(data: NetData): { nodes: Map<string, NetNode>; edges: NetEdge[] } {
  const entities = data.entities;
  const name = (id: string) => (id === PARTY_ID ? 'die Gruppe' : (entities[id]?.name ?? '?'));
  const nodes = new Map<string, NetNode>();
  const node = (entity: Entity, kind: NetNodeKind, r: number, sub: string): NetNode => ({
    id: entity.id,
    kind,
    name: entity.name,
    monogram: monogramOf(entity.name),
    image: entity.image,
    sub,
    r,
    x: 0,
    y: 0,
    orbit: null,
    leader: false,
    attitude: null,
    weight: 0,
    placed: false,
    more: 0,
    angle: null,
  });
  for (const entity of Object.values(entities)) {
    if (!isGroup(entity)) continue;
    nodes.set(
      entity.id,
      entity.kind === 'faction'
        ? node(entity, 'faction', NET.faction, entity.faction.category || 'Fraktion')
        : node(
            entity,
            'family',
            NET.family,
            (entity.kind === 'family' && entity.family.category) || 'Familie',
          ),
    );
  }

  // Zugehörigkeit und Beziehungen lesen.
  const memberships = new Map<string, { groupId: string; rank: number }[]>();
  const join = (personId: string, groupId: string, rank: number) => {
    const list = memberships.get(personId) ?? [];
    list.push({ groupId, rank });
    memberships.set(personId, list);
  };
  const pending: Pending[] = [];
  const personAttitude = new Map<string, number>();
  const relations = Object.values(data.relations).sort((x, y) => x.id.localeCompare(y.id));
  for (const relation of relations) {
    if (relation.ended || relation.from === relation.to) continue;
    const [from, to] = [entities[relation.from], entities[relation.to]];
    // Haltungen zur Gruppe.
    if (relation.to === PARTY_ID) {
      if (relation.attitude === null) continue;
      if (isGroup(from)) {
        nodes.get(from!.id)!.attitude = relation.attitude;
        pending.push({
          a: from!.id,
          b: PARTY_ID,
          tone: attitudeTone(relation.attitude) ?? 'plain',
          line: `${from!.name} zur Gruppe: ${attitudeLabel(relation.attitude)}`,
          secret: relation.secret,
          member: false,
          party: true,
        });
      } else if (isPerson(from)) personAttitude.set(from!.id, relation.attitude);
      continue;
    }
    if (relation.from === PARTY_ID) continue;
    const fromKind = isGroup(from) ? 'group' : isPerson(from) ? 'person' : null;
    const toKind = isGroup(to) ? 'group' : isPerson(to) ? 'person' : null;
    if (!fromKind || !toKind) continue;
    // Verwandtschaft zeigt der Stammbaum; hier zählen Macht und Bündnisse.
    if (fromKind === 'person' && toKind === 'person' && relation.kin) continue;
    if (QUIET_TYPES.has(relation.type) && relation.attitude === null) continue;
    const personId =
      fromKind === 'person' && toKind === 'group'
        ? from!.id
        : fromKind === 'group' && toKind === 'person'
          ? to!.id
          : null;
    const groupId = personId ? (personId === from!.id ? to!.id : from!.id) : null;
    const rank = personId ? membershipRank(relation, personId) : null;
    if (personId && groupId && rank !== null) join(personId, groupId, rank);
    const felt = relation.attitude === null ? '' : ` (${attitudeLabel(relation.attitude)})`;
    pending.push({
      a: from!.id,
      b: to!.id,
      tone: relationTone(relation),
      line: `${name(from!.id)} ${relationLabel(relation, 'from')} ${name(to!.id)}${felt}`,
      secret: relation.secret,
      member: rank !== null,
      party: false,
    });
  }
  for (const entity of Object.values(entities)) {
    if (!isPerson(entity) || entity.kind !== 'person') continue;
    const work = entity.person.workplaceId;
    if (work && isGroup(entities[work])) {
      join(entity.id, work, 3);
      pending.push({
        a: entity.id,
        b: work,
        tone: 'bond',
        line: `${entity.name} arbeitet für ${name(work)}`,
        secret: false,
        member: true,
        party: false,
      });
    }
  }

  // Personen: wer mit einer Fraktion oder Familie verbunden ist.
  const linkedToGroup = new Set<string>();
  for (const edge of pending) {
    const aGroup = nodes.has(edge.a);
    const bGroup = nodes.has(edge.b);
    if (aGroup && isPerson(entities[edge.b])) linkedToGroup.add(edge.b);
    if (bGroup && isPerson(entities[edge.a])) linkedToGroup.add(edge.a);
  }
  const links = new Map<string, number>();
  for (const edge of pending) {
    if (edge.member || edge.party) continue;
    links.set(edge.a, (links.get(edge.a) ?? 0) + 1);
    links.set(edge.b, (links.get(edge.b) ?? 0) + 1);
  }
  const kindOrder = (id: string) => (entities[id]?.kind === 'faction' ? 0 : 1);
  const persons: NetNode[] = [];
  for (const id of [...linkedToGroup].sort()) {
    const entity = entities[id]!;
    if (entity.kind !== 'person') continue;
    const joined = (memberships.get(id) ?? []).sort(
      (x, y) =>
        x.rank - y.rank ||
        kindOrder(x.groupId) - kindOrder(y.groupId) ||
        name(x.groupId).localeCompare(name(y.groupId), 'de'),
    );
    const primary = joined[0] ?? null;
    const leader = primary?.rank === 0;
    const person = node(
      entity,
      'person',
      leader ? NET.leader : NET.person,
      entity.person.role || entity.tagline,
    );
    person.orbit = primary?.groupId ?? null;
    person.leader = leader;
    person.attitude = personAttitude.get(id) ?? null;
    person.weight = (leader ? 3 : 0) + 2 * (links.get(id) ?? 0) + (entity.person.met ? 1 : 0);
    persons.push(person);
  }
  // Höchstens so viele um eine Fraktion – wer nur dazugehört und sonst nichts, fällt zuerst weg.
  const byGroup = new Map<string, NetNode[]>();
  for (const person of persons)
    if (person.orbit) byGroup.set(person.orbit, [...(byGroup.get(person.orbit) ?? []), person]);
  const dropped = new Set<string>();
  for (const [groupId, list] of byGroup) {
    list.sort(orbitOrder);
    for (const person of list.slice(PERSONS_PER_GROUP))
      if (!person.leader && !(links.get(person.id) ?? 0)) {
        dropped.add(person.id);
        nodes.get(groupId)!.more++;
      }
  }
  for (const person of persons) if (!dropped.has(person.id)) nodes.set(person.id, person);

  // Die Gruppe – sobald jemand eine Haltung zu ihr hat.
  if (pending.some((edge) => edge.party))
    nodes.set(PARTY_ID, {
      id: PARTY_ID,
      kind: 'party',
      name: 'Die Gruppe',
      monogram: '',
      image: null,
      sub: '',
      r: NET.party,
      x: 0,
      y: 0,
      orbit: null,
      leader: false,
      attitude: null,
      weight: 100,
      placed: false,
      more: 0,
      angle: null,
    });

  // Fäden: je Paar einer, mit allen Sätzen; der stärkste Ton gilt.
  const merged = new Map<string, NetEdge>();
  for (const edge of pending) {
    if (!nodes.has(edge.a) || !nodes.has(edge.b)) continue;
    const [a, b] = edge.a < edge.b ? [edge.a, edge.b] : [edge.b, edge.a];
    const key = `${a}|${b}`;
    const found = merged.get(key);
    if (!found) {
      merged.set(key, {
        key,
        a,
        b,
        tone: edge.tone,
        lines: [edge.line],
        secret: edge.secret,
        member: false,
        party: edge.party,
      });
      continue;
    }
    if (TONE_RANK[edge.tone] > TONE_RANK[found.tone]) found.tone = edge.tone;
    if (!found.lines.includes(edge.line)) found.lines.push(edge.line);
    found.secret = found.secret && edge.secret;
    found.party = found.party || edge.party;
  }
  // Der Satz mit dem stärksten Ton zuerst, sonst nach dem Alphabet – unabhängig von der Ablage.
  const lineRank = new Map(pending.map((edge) => [edge.line, TONE_RANK[edge.tone]]));
  for (const edge of merged.values()) {
    const [a, b] = [nodes.get(edge.a)!, nodes.get(edge.b)!];
    edge.member = a.orbit === b.id || b.orbit === a.id;
    edge.lines.sort(
      (x, y) => (lineRank.get(y) ?? 0) - (lineRank.get(x) ?? 0) || x.localeCompare(y, 'de'),
    );
  }
  for (const group of nodes.values())
    if (group.kind === 'faction' || group.kind === 'family')
      group.weight =
        10 +
        (byGroup.get(group.id)?.length ?? 0) +
        2 * (links.get(group.id) ?? 0) +
        (group.attitude !== null ? 2 : 0);
  const edges = [...merged.values()].sort((x, y) => x.key.localeCompare(y.key));
  return { nodes, edges };
}

/** Reihenfolge um eine Fraktion: Führende zuerst, dann die Wichtigen, dann nach Namen. */
function orbitOrder(a: NetNode, b: NetNode): number {
  return (
    Number(b.leader) - Number(a.leader) ||
    b.weight - a.weight ||
    a.name.localeCompare(b.name, 'de') ||
    a.id.localeCompare(b.id)
  );
}

// ── Anordnung ──────────────────────────────────────────────────────────────

/** Die Ringe um eine Fraktion: wie viele Personen auf welchem Halbmesser. */
/**
 * Unter dem Siegel steht sein Name – dort kreist niemand. Der freie Bogen beginnt rechts unten
 * und läuft über oben bis links unten.
 */
const LABEL_GAP = 2.6;
const FREE_ARC = 2 * Math.PI - LABEL_GAP;
const FREE_FROM = Math.PI / 2 + LABEL_GAP / 2;

function rings(r: number, count: number): { radius: number; count: number }[] {
  const out: { radius: number; count: number }[] = [];
  let left = count;
  for (let i = 0; left > 0; i++) {
    const radius = r + NET.ring + i * NET.ringStep;
    const fits = Math.max(4, Math.floor((FREE_ARC * radius) / NET.arc) + 1);
    const here = Math.min(fits, left);
    out.push({ radius, count: here });
    left -= here;
  }
  return out;
}

const SPRING_GAP: Record<NetTone, number> = {
  friend: 30,
  bond: 60,
  plain: 80,
  tense: 110,
  foe: 150,
};

const ITERATIONS = 320;

interface Body {
  id: string;
  x: number;
  y: number;
  /** Halbmesser samt Ring der Personen. */
  r: number;
  fixed: boolean;
}

/**
 * Das Netz mit Lage. Was in `state.netBoard` liegt, bleibt dort; Fraktionen, Familien, die
 * Gruppe und Personen ohne Fraktion legt ein Kräfte-Verfahren aus (Verbündete ziehen sich an,
 * Feinde halten Abstand), die übrigen Personen kreisen um ihre Fraktion – nach außen gewandt.
 */
export function factionNet(data: NetData): FactionNet {
  const { nodes, edges } = netGraph(data);
  const placed = data.state.netBoard ?? {};
  const all = [...nodes.values()];
  const members = new Map<string, NetNode[]>();
  for (const node of all)
    if (node.orbit && nodes.has(node.orbit))
      members.set(node.orbit, [...(members.get(node.orbit) ?? []), node]);
  for (const list of members.values()) list.sort(orbitOrder);

  // Körper: alles, was nicht um eine Fraktion kreist.
  const bodies: Body[] = [];
  const bodyOf = new Map<string, Body>();
  const free = all.filter((node) => !node.orbit || !nodes.has(node.orbit));
  free.sort((a, b) => a.id.localeCompare(b.id));
  const spread = 170 * Math.sqrt(Math.max(1, free.length));
  for (const node of free) {
    const around = members.get(node.id) ?? [];
    const ring = rings(node.r, around.length);
    const outer = ring.length ? ring[ring.length - 1]!.radius + NET.leader : node.r;
    const spot = placed[node.id];
    let x: number;
    let y: number;
    if (spot) [x, y] = [spot.x, spot.y];
    else if (node.kind === 'party') [x, y] = [0, 0];
    else {
      const rng = rngOf(seedOf('fraktionsnetz', node.id));
      const angle = rng.next() * 2 * Math.PI;
      const distance = 220 + rng.next() * spread;
      [x, y] = [Math.cos(angle) * distance, Math.sin(angle) * distance];
    }
    const body: Body = {
      id: node.id,
      x,
      y,
      r: outer + NET.label,
      fixed: !!spot || node.kind === 'party',
    };
    bodies.push(body);
    bodyOf.set(node.id, body);
  }
  const owner = (id: string): Body | undefined => {
    const node = nodes.get(id);
    return bodyOf.get(node?.orbit && nodes.has(node.orbit) ? node.orbit : id);
  };

  // Federn zwischen Körpern: je Paar die stärkste Verbindung.
  const springs = new Map<string, { a: Body; b: Body; tone: NetTone; count: number }>();
  for (const edge of edges) {
    const [a, b] = [owner(edge.a), owner(edge.b)];
    if (!a || !b || a === b) continue;
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    const found = springs.get(key);
    if (!found) springs.set(key, { a, b, tone: edge.tone, count: 1 });
    else {
      found.count++;
      if (TONE_RANK[edge.tone] > TONE_RANK[found.tone]) found.tone = edge.tone;
    }
  }
  const springList = [...springs.values()];
  // Was nicht mit dem Kern verbunden ist (der Gruppe, sonst dem größten Geflecht), wird stärker
  // zur Mitte gezogen – sonst triebe es davon.
  const tied = mainComponent(bodies, springList);

  for (let step = 0; step < ITERATIONS; step++) {
    const heat = 1 - step / ITERATIONS;
    const move = new Map<Body, { x: number; y: number }>(bodies.map((b) => [b, { x: 0, y: 0 }]));
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const [a, b] = [bodies[i]!, bodies[j]!];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) [dx, dy, d] = [1, 0, 1];
        const near = a.r + b.r + 24;
        // Abstoßen auf Abstand, Drängen bei Überlappung.
        const push = (5000 * (a.r + b.r)) / (d * d) + (d < near ? (near - d) * 0.5 : 0);
        const [ux, uy] = [dx / d, dy / d];
        move.get(a)!.x -= ux * push;
        move.get(a)!.y -= uy * push;
        move.get(b)!.x += ux * push;
        move.get(b)!.y += uy * push;
      }
    for (const spring of springList) {
      const { a, b } = spring;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      // Um die Gruppe bleibt Platz – wie Ringe um eine Sonne: Freunde näher, Feinde weiter weg.
      const party = a.id === PARTY_ID || b.id === PARTY_ID ? 110 : 0;
      const rest = a.r + b.r + SPRING_GAP[spring.tone] + party;
      const pull = (d - rest) * 0.06 * Math.min(2, 0.7 + 0.3 * spring.count);
      const [ux, uy] = [dx / d, dy / d];
      move.get(a)!.x += ux * pull;
      move.get(a)!.y += uy * pull;
      move.get(b)!.x -= ux * pull;
      move.get(b)!.y -= uy * pull;
    }
    const limit = 4 + 50 * heat;
    for (const body of bodies) {
      if (body.fixed) continue;
      const m = move.get(body)!;
      // Sanft zur Mitte, damit Unverbundenes nicht davontreibt.
      const gravity = tied.has(body) ? 0.008 : 0.05;
      m.x -= body.x * gravity;
      m.y -= body.y * gravity;
      const length = Math.hypot(m.x, m.y);
      const scale = length > limit ? limit / length : 1;
      body.x += m.x * scale;
      body.y += m.y * scale;
    }
  }
  // Zum Schluss: nichts überlappt.
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const [a, b] = [bodies[i]!, bodies[j]!];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.max(0.01, Math.hypot(dx, dy));
        const near = a.r + b.r + 16;
        if (d >= near || (a.fixed && b.fixed)) continue;
        moved = true;
        const gap = near - d;
        const [ux, uy] = [dx / d, dy / d];
        const share = a.fixed ? 0 : b.fixed ? 1 : 0.5;
        a.x -= ux * gap * share;
        a.y -= uy * gap * share;
        b.x += ux * gap * (1 - share);
        b.y += uy * gap * (1 - share);
      }
    if (!moved) break;
  }

  for (const body of bodies) {
    const node = nodes.get(body.id)!;
    node.x = Math.round(body.x);
    node.y = Math.round(body.y);
    node.placed = !!placed[body.id];
  }
  // Personen auf ihren Ringen – vom Mittelpunkt des Netzes weg gewandt.
  const center = bodies.length
    ? {
        x: bodies.reduce((sum, b) => sum + b.x, 0) / bodies.length,
        y: bodies.reduce((sum, b) => sum + b.y, 0) / bodies.length,
      }
    : { x: 0, y: 0 };
  for (const [groupId, list] of members) {
    const group = nodes.get(groupId)!;
    const away =
      Math.hypot(group.x - center.x, group.y - center.y) < 1
        ? -Math.PI / 2
        : Math.atan2(group.y - center.y, group.x - center.x);
    // Die Richtung nach außen im freien Bogen (0 … FREE_ARC); liegt sie unten, gilt der nächste Rand.
    const turn = (((away - FREE_FROM) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const aim = turn <= FREE_ARC ? turn : turn - FREE_ARC < LABEL_GAP / 2 ? FREE_ARC : 0;
    let index = 0;
    for (const ring of rings(group.r, list.length)) {
      const step =
        ring.count > 1 ? Math.min(FREE_ARC / (ring.count - 1), NET.arc / ring.radius) : 0;
      const span = step * (ring.count - 1);
      const first = Math.min(Math.max(0, aim - span / 2), FREE_ARC - span);
      for (let k = 0; k < ring.count; k++) {
        const person = list[index++]!;
        const spot = placed[person.id];
        const angle = FREE_FROM + first + k * step;
        person.placed = !!spot;
        person.x = spot ? spot.x : Math.round(group.x + Math.cos(angle) * ring.radius);
        person.y = spot ? spot.y : Math.round(group.y + Math.sin(angle) * ring.radius);
        person.angle = Math.round(Math.atan2(person.y - group.y, person.x - group.x) * 1000) / 1000;
      }
    }
  }
  return { nodes: [...nodes.values()].sort(nodeOrder), edges };
}

/** Die Körper des Kerns: das Geflecht um die Gruppe – oder, ohne Gruppe, das größte. */
function mainComponent(bodies: Body[], springs: { a: Body; b: Body }[]): Set<Body> {
  const links = new Map<Body, Body[]>(bodies.map((body) => [body, []]));
  for (const { a, b } of springs) {
    links.get(a)!.push(b);
    links.get(b)!.push(a);
  }
  const seen = new Set<Body>();
  let best = new Set<Body>();
  for (const start of bodies) {
    if (seen.has(start)) continue;
    const part = new Set<Body>([start]);
    const queue = [start];
    while (queue.length)
      for (const next of links.get(queue.pop()!)!)
        if (!part.has(next)) (part.add(next), queue.push(next));
    part.forEach((body) => seen.add(body));
    if (start.id === PARTY_ID || [...part].some((body) => body.id === PARTY_ID)) return part;
    if (part.size > best.size) best = part;
  }
  return best;
}

/** Gezeichnet wird von hinten nach vorn: Personen, dann Familien und Fraktionen, die Gruppe oben. */
const DRAW_ORDER: Record<NetNodeKind, number> = { person: 0, family: 1, faction: 2, party: 3 };
const nodeOrder = (a: NetNode, b: NetNode) =>
  DRAW_ORDER[a.kind] - DRAW_ORDER[b.kind] || a.id.localeCompare(b.id);

// ── Sichten ────────────────────────────────────────────────────────────────

/**
 * Das Netz für eine Sicht: nur Fraktionen (mit der Gruppe), alles mit Personen – oder nur
 * Feindschaften und Spannungen samt der Fraktion, zu der eine beteiligte Person gehört.
 */
export function filterNet(net: FactionNet, mode: NetMode): FactionNet {
  if (mode === 'people') return net;
  if (mode === 'factions') {
    const nodes = net.nodes.filter((node) => node.kind !== 'person');
    const ids = new Set(nodes.map((node) => node.id));
    return { nodes, edges: net.edges.filter((edge) => ids.has(edge.a) && ids.has(edge.b)) };
  }
  const hostile = net.edges.filter((edge) => edge.tone === 'foe' || edge.tone === 'tense');
  const ids = new Set(hostile.flatMap((edge) => [edge.a, edge.b]));
  const byId = new Map(net.nodes.map((node) => [node.id, node]));
  for (const id of [...ids]) {
    const orbit = byId.get(id)?.orbit;
    if (orbit) ids.add(orbit);
  }
  const edges = net.edges.filter(
    (edge) =>
      edge.tone === 'foe' ||
      edge.tone === 'tense' ||
      (edge.member && ids.has(edge.a) && ids.has(edge.b)),
  );
  return { nodes: net.nodes.filter((node) => ids.has(node.id)), edges };
}

/** Die Nachbarn eines Knotens – samt ihm selbst –, zum Hervorheben beim Darüberfahren. */
export function netNeighbors(net: FactionNet, id: string): Set<string> {
  const out = new Set([id]);
  for (const edge of net.edges) {
    if (edge.a === id) out.add(edge.b);
    if (edge.b === id) out.add(edge.a);
  }
  return out;
}

/** Knoten, deren Name die Suche enthält (ohne Groß- und Kleinschreibung). */
export function netMatches(net: FactionNet, query: string): Set<string> {
  const wanted = query.trim().toLocaleLowerCase('de');
  if (!wanted) return new Set();
  return new Set(
    net.nodes
      .filter((node) => node.name.toLocaleLowerCase('de').includes(wanted))
      .map((node) => node.id),
  );
}

export interface NetCurve {
  /** SVG-Pfad vom Rand des einen Siegels zum Rand des anderen. */
  d: string;
  /** Die Mitte des Fadens – dort steht die Beschriftung. */
  mid: { x: number; y: number };
}

/**
 * Der Verlauf eines Fadens: Zugehörigkeit gerade, alles andere in einem leichten Bogen, der je
 * Faden fest zur einen oder anderen Seite schwingt.
 */
export function netCurve(
  edge: Pick<NetEdge, 'key' | 'member'>,
  a: Pick<NetNode, 'x' | 'y' | 'r'>,
  b: Pick<NetNode, 'x' | 'y' | 'r'>,
): NetCurve {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.max(0.01, Math.hypot(dx, dy));
  const [ux, uy] = [dx / d, dy / d];
  const start = { x: a.x + ux * a.r, y: a.y + uy * a.r };
  const end = { x: b.x - ux * b.r, y: b.y - uy * b.r };
  const r1 = (n: number) => Math.round(n * 10) / 10;
  if (edge.member || d < a.r + b.r + 4)
    return {
      d: `M ${r1(start.x)} ${r1(start.y)} L ${r1(end.x)} ${r1(end.y)}`,
      mid: { x: r1((start.x + end.x) / 2), y: r1((start.y + end.y) / 2) },
    };
  const side = seedOf(edge.key) % 2 === 0 ? 1 : -1;
  const bend = Math.min(90, d * 0.14) * side;
  const control = { x: (start.x + end.x) / 2 - uy * bend, y: (start.y + end.y) / 2 + ux * bend };
  return {
    d: `M ${r1(start.x)} ${r1(start.y)} Q ${r1(control.x)} ${r1(control.y)} ${r1(end.x)} ${r1(end.y)}`,
    mid: {
      x: r1(0.25 * start.x + 0.5 * control.x + 0.25 * end.x),
      y: r1(0.25 * start.y + 0.5 * control.y + 0.25 * end.y),
    },
  };
}

/** Die Ausdehnung des Netzes – für „Alles zeigen“. */
export function netBounds(net: FactionNet): { x: number; y: number }[] {
  return net.nodes.flatMap((node) => [
    { x: node.x - node.r, y: node.y - node.r },
    { x: node.x + node.r, y: node.y + node.r + NET.label },
  ]);
}

export interface NetIndexRow {
  node: NetNode;
  /** Personen, die um sie kreisen (gezeichnet und nur gezählt). */
  people: number;
  friends: number;
  foes: number;
}

/**
 * Die Fraktionen und Familien des Netzes als Liste: die Gewichtigsten zuerst, mit Zahl der
 * Personen, Verbündeten und Feinde. `query` grenzt nach dem Namen ein – auch nach dem einer
 * Person, die zu ihr gehört.
 */
export function netIndex(net: FactionNet, query = ''): NetIndexRow[] {
  const wanted = query.trim().toLocaleLowerCase('de');
  const rows: NetIndexRow[] = [];
  for (const node of net.nodes) {
    if (node.kind !== 'faction' && node.kind !== 'family') continue;
    const around = net.nodes.filter((other) => other.orbit === node.id);
    if (
      wanted &&
      ![node, ...around].some((entry) => entry.name.toLocaleLowerCase('de').includes(wanted))
    )
      continue;
    let friends = 0;
    let foes = 0;
    for (const edge of net.edges) {
      if (edge.member || (edge.a !== node.id && edge.b !== node.id)) continue;
      if (edge.tone === 'friend') friends++;
      if (edge.tone === 'foe') foes++;
    }
    rows.push({ node, people: around.length + node.more, friends, foes });
  }
  return rows.sort(
    (a, b) => b.node.weight - a.node.weight || a.node.name.localeCompare(b.node.name, 'de'),
  );
}

export interface NetLabel {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  baseline: 'hanging' | 'central' | 'auto';
}

/**
 * Wo der Name eines Knotens steht: bei Personen auf einem Ring nach außen, von der Fraktion weg
 * (rechts beginnend, links endend, oben darüber) – sonst unter dem Siegel.
 */
export function netLabel(node: Pick<NetNode, 'r' | 'angle' | 'kind'>): NetLabel {
  if (node.angle === null)
    return {
      x: 0,
      y: node.r + (node.kind === 'party' ? 10 : 6),
      anchor: 'middle',
      baseline: 'hanging',
    };
  const [cos, sin] = [Math.cos(node.angle), Math.sin(node.angle)];
  const reach = node.r + 5;
  return {
    x: Math.round(cos * reach * 10) / 10,
    y: Math.round(sin * reach * 10) / 10,
    anchor: cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle',
    baseline: sin > 0.35 ? 'hanging' : sin < -0.35 ? 'auto' : 'central',
  };
}
