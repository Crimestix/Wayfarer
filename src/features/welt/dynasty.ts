/**
 * Familien aus Nachnamen: Wayfarer erkennt, zu welcher Familie eine Person ihrem Namen nach
 * gehört, statt dass jede Familie von Hand angelegt und jede Person einzeln zugeordnet wird.
 * Reine Funktionen; das Anlegen selbst steht in actions.ts (`adoptFamilies`).
 */
import { byName, normalize } from '../../domain/derive';
import type { CampaignData, Entity, Person } from '../../domain/schema';

/** Vorangestellte Anreden, Titel und Ränge – sie gehören nicht zum Namen. */
const words = (list: string) => new Set(list.split(' ').map(normalize));

const TITLES = words(
  'herr frau fräulein dame ser sir lord lady meister meisterin magister magistra doktor dr ' +
    'bruder schwester vater mutter onkel tante großvater großmutter alter alte ' +
    'könig königin prinz prinzessin kaiser kaiserin herzog herzogin fürst fürstin graf gräfin ' +
    'baron baronin freiherr freifrau ritter junker ' +
    'hauptmann kapitän kommandant general leutnant feldwebel wachtmeister oberst marschall ' +
    'priester priesterin hohepriester hohepriesterin abt äbtissin bischof erzmagier ' +
    'matrone matriarchin patriarch ältester älteste häuptling ' +
    'bürgermeister bürgermeisterin richter richterin vogt gildenmeister gildenmeisterin',
);
/** Artikel vor einem Beinamen: „Erik der Rote“, „Mira die Stille“. */
const ARTICLES = words('der die das den dem the');
/** Namensteile, die zum Nachnamen gehören: „von Hohenfels“, „van der Berg“, „de la Tour“. */
const PARTICLES = words(
  'von vom van de du del della di da zu zur zum af av of la le ten ter el al ibn bin mac',
);
/** Wörter, unter denen Familien und Häuser geführt werden. */
const FAMILY_WORDS = /^(haus|familie|sippe|clan|dynastie|geschlecht|house|family)\s+/i;

/** Schlagwort an Familien, die Wayfarer aus Nachnamen angelegt hat – so bleiben sie erkennbar. */
export const DERIVED_FAMILY_TAG = 'aus Nachnamen';

export interface Surname {
  /** Wie der Nachname geschrieben wird: „von Hohenfels“. */
  text: string;
  /** Vergleichsschlüssel ohne Namenszusätze: „hohenfels“. */
  key: string;
}

const clean = (word: string) => word.replace(/^[„“"'‚‘(]+|[“”"'’‘),.;:]+$/g, '');

/** Schlüssel, unter dem Schreibweisen desselben Familiennamens zusammenfallen. */
export function familyKey(name: string): string {
  const words = normalize(name.replace(FAMILY_WORDS, '')).split(/\s+/).map(clean).filter(Boolean);
  while (words.length > 1 && (PARTICLES.has(words[0]!) || ARTICLES.has(words[0]!))) words.shift();
  return words.join(' ');
}

/**
 * Der Nachname in einem Personennamen – oder null, wenn sich keiner sicher erkennen lässt.
 * Erkannt wird nur, was eindeutig ist: mindestens Vor- und Nachname. Ein einzelner Name, ein
 * Titel mit nur einem Namen („Hauptmann Voss“) und Beinamen („Erik der Rote“) ergeben nichts.
 */
export function surnameOf(name: string): Surname | null {
  const words = name
    // Spitznamen in Anführungszeichen und Zusätze in Klammern gehören nicht zum Namen.
    .replace(/[„“"][^„“”"]*[“”"]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .split(/[\s,]+/)
    .map(clean)
    .filter(Boolean);
  // Titel vorn abstreifen, Zählungen hinten („II.“, „der Dritte“ bleibt ein Beiname).
  while (words.length && TITLES.has(normalize(words[0]!))) words.shift();
  while (words.length && /^(?:[ivx]+|jr|sr|jun|sen)$/i.test(words[words.length - 1]!)) words.pop();
  if (words.length < 2) return null;

  // Vom Ende her: der letzte Name samt davorstehender Namenszusätze.
  let start = words.length - 1;
  while (start > 1 && PARTICLES.has(normalize(words[start - 1]!))) start--;
  const before = normalize(words[start - 1]!);
  if (ARTICLES.has(before)) {
    // „van der Berg“ ist ein Name, „Erik der Rote“ ein Beiname.
    if (start - 2 >= 1 && PARTICLES.has(normalize(words[start - 2]!))) {
      start -= 2;
      while (start > 1 && PARTICLES.has(normalize(words[start - 1]!))) start--;
    } else return null;
  }
  const last = words[words.length - 1]!;
  // Ein Nachname ist ein Eigenname: großgeschrieben und mehr als ein Buchstabe.
  if (last.length < 2 || last[0] !== last[0]!.toLocaleUpperCase('de')) return null;
  const text = words.slice(start).join(' ');
  const key = familyKey(text);
  return key ? { text, key } : null;
}

/** Familien und „Häuser“ unter den Fraktionen, nach ihrem Namensschlüssel. */
export function familyIndex(data: CampaignData): Map<string, Entity> {
  const index = new Map<string, Entity>();
  const add = (entity: Entity) => {
    for (const name of [entity.name, ...entity.aliases]) {
      const key = familyKey(name);
      if (key && !index.has(key)) index.set(key, entity);
    }
  };
  const entities = Object.values(data.entities).sort(byName);
  // Echte Familien haben Vorrang vor Fraktionen, die wie ein Haus heißen.
  for (const entity of entities) if (entity.kind === 'family') add(entity);
  for (const entity of entities)
    if (entity.kind === 'faction' && FAMILY_WORDS.test(entity.name)) add(entity);
  return index;
}

export interface FamilyPlan {
  /** Familien, die es noch nicht gibt, mit den Personen, die dazugehören. */
  create: { surname: Surname; name: string; personIds: string[] }[];
  /** Personen, die einer vorhandenen Familie (oder einem Haus) zugeordnet werden. */
  join: { personId: string; familyId: string }[];
}

/** Gehört die Person schon über eine bestehende Beziehung zu einer Familie? */
function hasFamily(data: CampaignData, personId: string): boolean {
  return Object.values(data.relations).some((r) => {
    if (r.ended) return false;
    const other = r.from === personId ? r.to : r.to === personId ? r.from : null;
    return !!other && data.entities[other]?.kind === 'family';
  });
}

/**
 * Was zu tun ist, damit jede der genannten Personen (ohne Angabe: alle) zu der Familie gehört,
 * die ihr Nachname nahelegt. Wer schon einer Familie angehört, bleibt unberührt.
 */
export function planFamilies(data: CampaignData, personIds?: readonly string[]): FamilyPlan {
  const index = familyIndex(data);
  const wanted = personIds ? new Set(personIds) : null;
  const persons = Object.values(data.entities)
    .filter((e): e is Person => e.kind === 'person' && (!wanted || wanted.has(e.id)))
    .sort(byName);
  const create = new Map<string, FamilyPlan['create'][number]>();
  const join: FamilyPlan['join'] = [];
  for (const person of persons) {
    const surname = surnameOf(person.name);
    if (!surname || hasFamily(data, person.id)) continue;
    const family = index.get(surname.key);
    if (family) {
      const linked = Object.values(data.relations).some(
        (r) =>
          !r.ended &&
          ((r.from === person.id && r.to === family.id) ||
            (r.from === family.id && r.to === person.id)),
      );
      if (!linked) join.push({ personId: person.id, familyId: family.id });
      continue;
    }
    const planned = create.get(surname.key);
    if (planned) planned.personIds.push(person.id);
    else
      create.set(surname.key, {
        surname,
        name: `Familie ${surname.text}`,
        personIds: [person.id],
      });
  }
  return { create: [...create.values()].sort(byName), join };
}

/** „Familie Venn angelegt (2 Mitglieder)“ – ein Satz für die Meldung. */
export function describePlan(data: CampaignData, plan: FamilyPlan): string {
  const parts: string[] = [];
  if (plan.create.length === 1) {
    const one = plan.create[0]!;
    parts.push(
      `${one.name} angelegt` +
        (one.personIds.length > 1 ? ` (${one.personIds.length} Mitglieder)` : ''),
    );
  } else if (plan.create.length > 1) parts.push(`${plan.create.length} Familien angelegt`);
  if (plan.join.length === 1) {
    const one = plan.join[0]!;
    parts.push(
      `${data.entities[one.personId]?.name ?? 'Eine Person'} gehört jetzt zu ${data.entities[one.familyId]?.name ?? 'einer Familie'}`,
    );
  } else if (plan.join.length > 1)
    parts.push(`${plan.join.length} Personen vorhandenen Familien zugeordnet`);
  return parts.join(' · ');
}
