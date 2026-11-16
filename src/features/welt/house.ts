/**
 * Häuser: Ein Adelshaus ist Familie (Blut, Stammbaum) und Fraktion (Gefolge, Ziele, Haltung zur
 * Gruppe) zugleich – und doch nur ein Eintrag. Entscheidung des Spielleiters (16. 11. 2026):
 * „Das Haus Orvyndra ist die Familie Orvyndra. Angestellte gehören da ja irgendwie zu.“
 *
 * - `houseMembers` teilt die Leute eines Hauses in Familie und „Im Dienst des Hauses“ – erkannt
 *   aus der Welt (Nachname, Verwandtschaft, Art der Beziehung), nie gespeichert.
 * - `houseTwins` findet Fraktion und Familie gleichen Namens („Haus Orvyndra“ / „Orvyndra“) –
 *   nur ein Vorschlag, wegklickbar.
 * - `mergeHouse` legt beide zu einem Eintrag (Art Familie) zusammen: Beziehungen, Haltungen,
 *   Vorhaben und alle Verweise ziehen mit; mit Rückgängig.
 */
import type { CampaignDb } from '../../data/db';
import { byName } from '../../domain/derive';
import { SUGGESTION, isDismissed } from '../../domain/dismiss';
import {
  COLLECTION_NAMES,
  type CampaignData,
  type CollectionName,
  type CollectionTypes,
  type Entity,
  type Faction,
  type Family,
  type PlayState,
} from '../../domain/schema';
import { FAMILY_WORDS, familyKey, surnameOf } from './dynasty';
import { groupMembers, type Member } from './model';

// ── Familie und Gefolge ────────────────────────────────────────────────────

export interface HouseMembers {
  /** Blut: Nachname des Hauses, verwandt mit der Familie, eingeheiratet. */
  family: Member[];
  /** Wer dem Haus dient, für es arbeitet oder ohne Verwandtschaft dazugehört. */
  service: Member[];
  /** Ob die Seite beides getrennt zeigt – bei Familien immer, bei Fraktionen mit Familie darin. */
  split: boolean;
}

/** Die Namensschlüssel eines Hauses: „Haus Orvyndra“, „Orvyndra“ → „orvyndra“. */
function houseKeys(group: Entity): Set<string> {
  return new Set([group.name, ...group.aliases].map(familyKey).filter(Boolean));
}

/** Dient, angestellt oder arbeitet dort – das ist Gefolge, nie Blut. */
const SERVICE_TYPES = new Set(['serves', 'employs']);

/**
 * Die Leute eines Hauses, getrennt nach Familie und Gefolge. Zur Familie gehört, wer den Namen
 * des Hauses trägt, über „verwandt mit“ daran hängt oder mit jemandem aus der Familie verwandt
 * ist; bei einer Familie auch, wer ihr ohne weitere Angabe angehört oder sie führt. Wer dient,
 * angestellt ist oder dort arbeitet, ist Gefolge.
 */
export function houseMembers(data: CampaignData, group: Faction | Family): HouseMembers {
  const members = groupMembers(data, group.id);
  const keys = houseKeys(group);
  const isService = (member: Member) =>
    member.relation === null || SERVICE_TYPES.has(member.relation.type);
  const blood = new Set<string>();
  for (const member of members) {
    if (isService(member)) continue;
    const surname = surnameOf(member.entity.name);
    if (
      (surname && keys.has(surname.key)) ||
      member.relation?.type === 'family' ||
      (group.kind === 'family' && member.relation !== null)
    )
      blood.add(member.entity.id);
  }
  // Wer mit jemandem aus der Familie verwandt ist (auch eingeheiratet), gehört dazu.
  const kinOf = new Map<string, Set<string>>();
  for (const relation of Object.values(data.relations)) {
    if (relation.ended || (relation.kin === null && relation.type !== 'family')) continue;
    for (const [a, b] of [
      [relation.from, relation.to],
      [relation.to, relation.from],
    ] as const) {
      const set = kinOf.get(a) ?? new Set<string>();
      set.add(b);
      kinOf.set(a, set);
    }
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const member of members) {
      if (blood.has(member.entity.id) || isService(member)) continue;
      if ([...(kinOf.get(member.entity.id) ?? [])].some((id) => blood.has(id))) {
        blood.add(member.entity.id);
        grew = true;
      }
    }
  }
  const family = members.filter((member) => blood.has(member.entity.id));
  const service = members.filter((member) => !blood.has(member.entity.id));
  return { family, service, split: group.kind === 'family' || family.length > 0 };
}

// ── Dasselbe Haus zweimal ──────────────────────────────────────────────────

export interface HouseTwin {
  faction: Faction;
  family: Family;
  /** Der Schlüssel zum Wegklicken des Vorschlags. */
  key: string;
}

/**
 * Fraktionen und Familien, die dasselbe Haus meinen: gleicher Name ohne „Haus“, „Familie“ …
 * (auch über Zweitnamen). Weggeklickte nicht.
 */
export function houseTwins(data: CampaignData): HouseTwin[] {
  const families = Object.values(data.entities)
    .filter((entity): entity is Family => entity.kind === 'family')
    .sort(byName);
  const out: HouseTwin[] = [];
  for (const faction of Object.values(data.entities).sort(byName)) {
    if (faction.kind !== 'faction') continue;
    const keys = houseKeys(faction);
    for (const family of families) {
      if (![...houseKeys(family)].some((key) => keys.has(key))) continue;
      const key = SUGGESTION.house(faction.id, family.id);
      if (!isDismissed(data, key)) out.push({ faction, family, key });
    }
  }
  return out;
}

/** Der Name des Hauses nach dem Zusammenlegen: „Haus Orvyndra“ vor „Orvyndra“. */
export function houseName(family: Family, faction: Faction): string {
  return FAMILY_WORDS.test(faction.name) && !FAMILY_WORDS.test(family.name)
    ? faction.name
    : family.name;
}

const joinText = (a: string, b: string) =>
  [a.trim(), b.trim()].filter((text, i, all) => text && all.indexOf(text) === i).join('\n\n');

/** Der eine Eintrag aus beiden: die Familie, ergänzt um alles, was nur die Fraktion wusste. */
export function mergedHouse(family: Family, faction: Faction): Family {
  const name = houseName(family, faction);
  const [lead, other] = name === faction.name ? [faction, family] : [family, faction];
  const aliases = [...family.aliases, ...faction.aliases, family.name, faction.name].filter(
    (alias, i, all) => alias.trim() && alias !== name && all.indexOf(alias) === i,
  );
  return {
    ...family,
    name,
    aliases,
    // Der eine Satz kommt von dort, woher der Name kommt; der andere steht über den Notizen.
    tagline: lead.tagline.trim() || other.tagline,
    notes: joinText(
      lead.tagline.trim() && other.tagline.trim() !== lead.tagline.trim() ? other.tagline : '',
      joinText(family.notes, faction.notes),
    ),
    secret: joinText(family.secret, faction.secret),
    tags: [...new Set([...family.tags, ...faction.tags])],
    born: family.born ?? faction.born,
    ended: family.ended ?? faction.ended,
    image: family.image ?? faction.image,
    lk: family.lk ?? faction.lk,
    stub: family.stub && faction.stub,
    fromStoryId: family.fromStoryId ?? faction.fromStoryId,
    family: {
      ...family.family,
      seatId: family.family.seatId ?? faction.faction.seatId,
      category: family.family.category.trim() || faction.faction.category,
    },
  };
}

/** Eine Kennung, allein oder als Teil eines Schlüssels („story:…“, „house:…:…“). */
const idPattern = (id: string) =>
  new RegExp(`(^|:)${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|:)`, 'g');

/**
 * Ersetzt überall die Kennung `from` durch `to` – in Werten und in Schlüsseln von Objekten.
 * Gibt dasselbe Objekt zurück, wenn nichts darin vorkam.
 */
export function rewireId<T>(value: T, from: string, to: string): T {
  const pattern = idPattern(from);
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      if (!node.includes(from)) return node;
      const next = node.replace(pattern, `$1${to}`);
      return next === node ? node : next;
    }
    if (Array.isArray(node)) {
      let changed = false;
      const next = node.map((item) => {
        const out = walk(item);
        if (out !== item) changed = true;
        return out;
      });
      return changed ? next : node;
    }
    if (node && typeof node === 'object') {
      let changed = false;
      const next: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(node)) {
        const newKey = walk(key) as string;
        const out = walk(item);
        if (newKey !== key || out !== item) changed = true;
        next[newKey] = out;
      }
      return changed ? next : node;
    }
    return node;
  };
  return walk(value) as T;
}

export interface MergeResult {
  /** Der Eintrag, der bleibt. */
  houseId: string;
  name: string;
  /** Hatten beide einen Text, bleibt der der Fraktion als Artikel ohne Eintrag stehen. */
  textLeft: string | null;
  undo: () => void;
}

/**
 * Legt Fraktion und Familie zu einem Haus zusammen. Es bleibt die Familie (Stammbaum, Blut),
 * unter dem Namen des Hauses; alles, was auf die Fraktion zeigt, zeigt danach auf sie. Doppelte
 * Beziehungen in derselben Richtung werden eine (die Haltung der Fraktion gilt, wo die Familie
 * keine hatte). Gibt null, wenn eines von beiden fehlt.
 */
export function mergeHouse(
  db: CampaignDb,
  familyId: string,
  factionId: string,
): MergeResult | null {
  const before = db.getSnapshot();
  const family = before.entities[familyId];
  const faction = before.entities[factionId];
  if (family?.kind !== 'family' || faction?.kind !== 'faction') return null;
  const house = mergedHouse(family, faction);
  const textLeft =
    family.lk && faction.lk && family.lk.resourceId !== faction.lk.resourceId
      ? (before.articles[faction.lk.resourceId]?.title ?? null)
      : null;

  db.batch(() => {
    for (const name of COLLECTION_NAMES) {
      const docs = before[name] as Readonly<Record<string, { id: string }>>;
      for (const doc of Object.values(docs)) {
        if (name === 'entities' && (doc.id === familyId || doc.id === factionId)) continue;
        const next = rewireId(doc, factionId, familyId);
        if (next !== doc) db.put(name, next as CollectionTypes[typeof name]);
      }
    }
    db.put('entities', house);
    db.remove('entities', factionId);
    const state = rewireId(before.state, factionId, familyId);
    const stateChange: Partial<Omit<PlayState, 'id'>> = {};
    for (const key of Object.keys(state) as (keyof PlayState)[])
      if (key !== 'id' && state[key] !== before.state[key])
        (stateChange as Record<string, unknown>)[key] = state[key];
    if (Object.keys(stateChange).length) db.setState(stateChange);
    // Was jetzt doppelt dasteht oder auf sich selbst zeigt, fällt weg.
    const seen = new Map<string, string>();
    const relations = Object.values(db.getSnapshot().relations).sort(
      // Die Beziehungen der Familie zuerst – sie bleiben.
      (a, b) =>
        Number(
          before.relations[a.id]?.from === factionId || before.relations[a.id]?.to === factionId,
        ) -
        Number(
          before.relations[b.id]?.from === factionId || before.relations[b.id]?.to === factionId,
        ),
    );
    for (const relation of relations) {
      if (relation.from !== familyId && relation.to !== familyId) continue;
      if (relation.from === relation.to) {
        db.remove('relations', relation.id);
        continue;
      }
      if (relation.kin !== null || relation.ended) continue;
      const pair = `${relation.from}>${relation.to}`;
      const keptId = seen.get(pair);
      if (!keptId) {
        seen.set(pair, relation.id);
        continue;
      }
      const kept = db.getSnapshot().relations[keptId];
      if (kept) {
        // Das genauere Wort gewinnt („führt“ vor „gehört zu“), die Haltung, wo eine fehlt.
        const vague = (type: string) => type === 'member' || type === 'knows';
        db.patch('relations', keptId, {
          ...(vague(kept.type) && !vague(relation.type)
            ? { type: relation.type, label: relation.label }
            : {}),
          ...(kept.attitude === null && relation.attitude !== null
            ? { attitude: relation.attitude }
            : {}),
        });
      }
      db.remove('relations', relation.id);
    }
  });
  const after = db.getSnapshot();

  const restore = <C extends CollectionName>(name: C) => {
    const was = before[name] as Readonly<Record<string, CollectionTypes[C]>>;
    const became = after[name] as Readonly<Record<string, CollectionTypes[C]>>;
    const now = db.getSnapshot()[name] as Readonly<Record<string, CollectionTypes[C]>>;
    for (const doc of Object.values(was)) {
      if (became[doc.id] === doc) continue;
      const current = now[doc.id];
      // Nur zurückdrehen, was noch so dasteht, wie das Zusammenlegen es hinterlassen hat.
      if (current !== became[doc.id]) continue;
      db.put(name, { ...doc, rev: Math.max(doc.rev, current?.rev ?? 0) });
    }
  };
  const undo = () =>
    db.batch(() => {
      for (const name of COLLECTION_NAMES) restore(name);
      const current = db.getSnapshot().state;
      const change: Partial<Omit<PlayState, 'id'>> = {};
      for (const key of Object.keys(before.state) as (keyof PlayState)[]) {
        if (key === 'id' || before.state[key] === after.state[key]) continue;
        if (current[key] !== after.state[key]) continue;
        (change as Record<string, unknown>)[key] = before.state[key];
      }
      if (Object.keys(change).length) db.setState(change);
    });
  return { houseId: familyId, name: house.name, textLeft, undo };
}
