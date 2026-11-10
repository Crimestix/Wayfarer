/**
 * Vorschläge für Beiwerk-Personen: der Wirt, die Wache am Tor, der Fuhrmann. Wo andere
 * Spielleiter Zufallstabellen nehmen, schlägt Wayfarer vor – und zwar passend zur eigenen Welt:
 * Namen klingen wie die Namen, die es dort schon gibt, Spezies und Familien stammen aus den
 * eigenen Einträgen. Für die Geschichte wichtige Personen entstehen hier nicht; der Vorschlag
 * füllt nur den Entwurf, angelegt wird erst, wenn der Spielleiter speichert.
 *
 * Reine Funktionen; gleicher Ausgangswert → gleicher Vorschlag.
 */
import { byName, normalize, placeAncestors, placeSubtreeIds } from '../../domain/derive';
import { rngOf, type Rng } from '../../domain/random';
import type { CampaignData, Person } from '../../domain/schema';
import { surnameOf } from './dynasty';

// ── Namen ──────────────────────────────────────────────────────────────────

export interface NameCorpus {
  /** Vornamen aus der Welt. */
  given: string[];
  /** Nachnamen aus der Welt, mit Namenszusatz („von Hohenfels“). */
  family: string[];
}

/** Ab so vielen Namen klingt ein gelernter Name nach der Welt statt nach Zufall. */
export const CORPUS_MIN = 6;

const TITLE_LIKE = /^[a-zäöüß]/;

/** Vor- und Nachnamen der Personen – auf Wunsch nur einer Spezies. */
export function nameCorpus(data: CampaignData, speciesId: string | null = null): NameCorpus {
  const given = new Set<string>();
  const family = new Set<string>();
  for (const entity of Object.values(data.entities)) {
    if (entity.kind !== 'person') continue;
    if (speciesId && entity.person.speciesId !== speciesId) continue;
    const surname = surnameOf(entity.name);
    if (surname) family.add(surname.text);
    const rest = surname
      ? entity.name.slice(0, entity.name.lastIndexOf(surname.text))
      : entity.name;
    // Der Vorname ist das letzte großgeschriebene Wort vor dem Nachnamen; Titel stehen davor.
    const words = rest
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}'’-]/gu, ''))
      .filter((w) => w.length > 1 && !TITLE_LIKE.test(w));
    const first = surname ? words[words.length - 1] : words.length === 1 ? words[0] : undefined;
    if (first) given.add(first);
  }
  const sort = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b, 'de'));
  return { given: sort(given), family: sort(family) };
}

/**
 * Baut einen neuen Namen aus den Buchstabenfolgen der Vorlagen (Markow-Kette): Er klingt wie sie,
 * ist aber keiner von ihnen. Meist entscheidet das Buchstabenpaar davor über den nächsten
 * Buchstaben; manchmal nur der letzte Buchstabe – sonst käme bei wenigen Vorlagen immer wieder
 * eine der Vorlagen heraus. Gibt null zurück, wenn nichts Brauchbares entsteht.
 */
export function learnedName(rng: Rng, samples: readonly string[]): string | null {
  const words = samples.map((s) => s.toLocaleLowerCase('de')).filter((s) => s.length >= 3);
  if (words.length < 2) return null;
  const pairs = new Map<string, string[]>();
  const singles = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, next: string) => {
    const list = map.get(key);
    if (list) list.push(next);
    else map.set(key, [next]);
  };
  for (const word of words) {
    const padded = `^^${word}$`;
    for (let i = 0; i + 2 < padded.length; i++) {
      add(pairs, padded.slice(i, i + 2), padded[i + 2]!);
      add(singles, padded[i + 1]!, padded[i + 2]!);
    }
  }
  const known = new Set(words);
  const lengths = words.map((w) => w.length);
  const min = Math.max(3, Math.min(...lengths));
  const max = Math.max(...lengths) + 1;
  const vowel = /[aeiouyäöü]/;
  for (let attempt = 0; attempt < 60; attempt++) {
    let out = '';
    let key = '^^';
    while (out.length <= max) {
      const loose = out.length > 0 && rng.chance(0.4);
      const options = (loose ? singles.get(key[1]!) : pairs.get(key)) ?? ['$'];
      let next = rng.pick(options)!;
      if (next === '$') {
        // Nicht zu früh aufhören: mindestens so lang wie die kürzeste Vorlage.
        if (out.length >= min) break;
        const onward = (singles.get(key[1]!) ?? []).filter((o) => o !== '$');
        if (!onward.length) break;
        next = rng.pick(onward)!;
      }
      out += next;
      key = key[1]! + next;
    }
    if (out.length < min || out.length > max || known.has(out) || !vowel.test(out)) continue;
    // Drei gleiche Buchstaben oder vier Mitlaute am Stück liest niemand als Namen.
    let same = 1;
    let consonants = 0;
    let readable = true;
    for (let i = 0; i < out.length; i++) {
      same = i > 0 && out[i] === out[i - 1] ? same + 1 : 1;
      consonants = vowel.test(out[i]!) ? 0 : consonants + 1;
      if (same >= 3 || consonants >= 4) readable = false;
    }
    if (!readable) continue;
    return out[0]!.toLocaleUpperCase('de') + out.slice(1);
  }
  return null;
}

/** Silben für den Fall, dass die Welt noch zu wenige Namen zum Lernen hat. */
const ONSETS = 'b br d dr f g gr h k kr l m n r s st t th tr v w z'.split(' ');
// Nur einfache Vokale: Doppellaute wie „ei“ oder „au“ ergeben zu leicht zufällige deutsche Wörter.
const VOWELS = 'a e i o u a e i o y'.split(' ');
const CODAS = 'l n r s th nd rn m k t'.split(' ');

/** Ein Name aus allgemeinen Silben – nur, solange die Welt keinen eigenen Klang vorgibt. */
export function syllableName(rng: Rng): string {
  const count = rng.chance(0.25) ? 3 : 2;
  let out = '';
  for (let i = 0; i < count; i++) {
    out += rng.pick(ONSETS)! + rng.pick(VOWELS)!;
    if (i === count - 1 && rng.chance(0.7)) out += rng.pick(CODAS)!;
  }
  return out[0]!.toLocaleUpperCase('de') + out.slice(1);
}

// ── Tabellen für das Beiwerk ───────────────────────────────────────────────

/** Tätigkeiten nach Art des Ortes; das Stichwort wird im Namen oder in der Art des Ortes gesucht. */
const WORK: { match: RegExp; roles: string[] }[] = [
  {
    match: /tavern|gasth|schenk|wirtsh|herberg|krug|inn\b/,
    roles: ['Schankdienst', 'Küche', 'Stalldienst', 'Zimmer und Betten', 'Hausmusik'],
  },
  {
    match: /hafen|kai|werft|anleg|dock|pier/,
    roles: ['Hafenarbeit', 'Fischerei', 'Netze flicken', 'Lotsendienst', 'Zolldienst', 'Bootsbau'],
  },
  {
    match: /markt|basar|laden|handel|kontor|kram/,
    roles: ['Handel mit Stoffen', 'Handel mit Gewürzen', 'Marktaufsicht', 'Geldwechsel', 'Trödel'],
  },
  {
    match: /tempel|kloster|schrein|kapell|abtei|heilig/,
    roles: ['Tempeldienst', 'Almosenpflege', 'Totenwache', 'Schreibstube', 'Kräutergarten'],
  },
  {
    match: /wach|kasern|festung|feste|burg|tor\b|turm|garnison/,
    roles: ['Torwache', 'Wachdienst', 'Waffenkammer', 'Botengänge', 'Stalldienst'],
  },
  {
    match: /schmied|werkst|gilde|mine|bergw|stollen/,
    roles: ['Schmiede', 'Zimmerei', 'Gerberei', 'Bergbau', 'Steinmetzarbeit', 'Lehrling'],
  },
  {
    // Verglichen wird ohne Umlaute und Akzente (siehe `normalize`).
    match: /dorf|hof|weiler|feld|muhle|gehoft/,
    roles: ['Feldarbeit', 'Viehhüten', 'Müllerei', 'Imkerei', 'Jagd', 'Hebammendienst'],
  },
];
const WORK_ANYWHERE = [
  'Fuhrwesen',
  'Botengänge',
  'Tagelohn',
  'Heilkunde',
  'Schneiderei',
  'Bäckerei',
  'Kräuterkunde',
  'Schreibdienst',
  'Gaukelei',
  'Wachdienst',
  'Bettelei',
  'Handel',
];

const LOOKS = [
  'Narbe über der Augenbraue',
  'Hinkt leicht',
  'Auffallend leise Stimme',
  'Tintenflecken an den Fingern',
  'Trägt stets Handschuhe',
  'Fehlender Schneidezahn',
  'Wettergegerbtes Gesicht',
  'Ein Ohrring aus Knochen',
  'Sehr gepflegte Kleidung',
  'Riecht nach Rauch',
  'Graue Strähne im Haar',
  'Schwielige Hände',
  'Zuckendes Augenlid',
  'Summt bei der Arbeit',
  'Auffallend groß',
  'Auffallend klein',
  'Brandnarbe am Unterarm',
  'Kahl geschoren',
  'Abgetragener Mantel',
  'Kaut ständig auf etwas herum',
];
const MANNERS = [
  'Misstrauisch gegenüber Fremden',
  'Redet gern und viel',
  'Wortkarg',
  'Neugierig bis zur Aufdringlichkeit',
  'Abergläubisch',
  'Stolz auf die eigene Arbeit',
  'Immer in Eile',
  'Großzügig',
  'Geizig',
  'Leicht zu erschrecken',
  'Schnell gekränkt',
  'Überaus höflich',
  'Vergesslich',
  'Fromm',
  'Zynisch',
  'Schuldet jemandem Geld',
  'Hilfsbereit',
  'Kennt jedes Gerücht',
  'Trauert um jemanden',
  'Träumt vom Fortgehen',
];

// ── Vorschlag ──────────────────────────────────────────────────────────────

export interface NpcSuggestion {
  name: string;
  role: string;
  /** „Hinkt leicht. Wortkarg.“ – ein Satz, der am Tisch reicht. */
  tagline: string;
  speciesId: string | null;
  placeId: string | null;
  homeId: string | null;
  /** Woher der Name stammt: aus dem Klang der Welt gelernt oder aus allgemeinen Silben. */
  nameSource: 'world' | 'generic';
}

export interface NpcRequest {
  /** Wo die Person anzutreffen ist; bestimmt Tätigkeit, Spezies und Nachnamen. */
  placeId?: string | null;
  /** Feste Spezies; sonst nach der Verteilung am Ort bzw. in der Welt. */
  speciesId?: string | null;
}

const personsAt = (data: CampaignData, placeId: string | null): Person[] => {
  const all = Object.values(data.entities).filter((e): e is Person => e.kind === 'person');
  if (!placeId) return all;
  const ids = placeSubtreeIds(data, placeId);
  const here = all.filter(
    (p) =>
      (p.person.placeId && ids.has(p.person.placeId)) ||
      (p.person.homeId && ids.has(p.person.homeId)),
  );
  return here.length ? here : all;
};

/** Tätigkeiten, die zum Ort passen: nach seinem Namen und seiner Art, sonst nach denen darüber. */
export function rolesFor(data: CampaignData, placeId: string | null): string[] {
  if (placeId) {
    const place = data.entities[placeId];
    const chain = place?.kind === 'place' ? [place, ...placeAncestors(data, placeId)] : [];
    for (const p of chain) {
      const text = normalize(`${p.name} ${p.kind === 'place' ? p.place.category : ''}`);
      const hit = WORK.find((w) => w.match.test(text));
      if (hit) return hit.roles;
    }
  }
  return WORK_ANYWHERE;
}

/** Schlägt eine Beiwerk-Person vor. Gleicher Ausgangswert und gleiche Welt → gleicher Vorschlag. */
export function suggestNpc(data: CampaignData, request: NpcRequest, seed: number): NpcSuggestion {
  const rng = rngOf(seed);
  const placeId =
    request.placeId && data.entities[request.placeId]?.kind === 'place' ? request.placeId : null;
  const locals = personsAt(data, placeId);

  // Spezies: wie sie am Ort (sonst in der Welt) verteilt ist.
  const species = Object.values(data.entities)
    .filter((e) => e.kind === 'species')
    .sort(byName);
  const speciesId =
    request.speciesId && data.entities[request.speciesId]?.kind === 'species'
      ? request.speciesId
      : (rng.weighted(
          species,
          (s) => 1 + 4 * locals.filter((p) => p.person.speciesId === s.id).length,
        )?.id ?? null);

  // Name: erst aus den Namen derselben Spezies lernen, dann aus allen, zuletzt aus Silben.
  const own = nameCorpus(data, speciesId);
  const all = nameCorpus(data);
  const givenPool = own.given.length >= CORPUS_MIN ? own.given : all.given;
  const learned = givenPool.length >= CORPUS_MIN ? learnedName(rng, givenPool) : null;
  const given = learned ?? syllableName(rng);
  const taken = new Set(Object.values(data.entities).map((e) => normalize(e.name)));

  // Nachname: oft einer, den es am Ort schon gibt – so wachsen Familien von selbst.
  const localFamilies = nameCorpus({
    ...data,
    entities: Object.fromEntries(locals.map((p) => [p.id, p])),
  }).family;
  const familyPool = localFamilies.length ? localFamilies : all.family;
  let family = '';
  if (familyPool.length && rng.chance(0.45)) family = rng.pick(familyPool)!;
  else if (all.family.length >= CORPUS_MIN) family = learnedName(rng, all.family) ?? '';
  else if (rng.chance(0.6)) family = syllableName(rng);
  let name = family ? `${given} ${family}` : given;
  // Kein zweiter Eintrag mit demselben Namen.
  for (let i = 0; i < 5 && taken.has(normalize(name)); i++) {
    const other =
      (givenPool.length >= CORPUS_MIN ? learnedName(rng, givenPool) : null) ?? syllableName(rng);
    name = family ? `${other} ${family}` : other;
  }

  return {
    name,
    role: rng.pick(rolesFor(data, placeId))!,
    tagline: `${rng.pick(LOOKS)!}. ${rng.pick(MANNERS)!}.`,
    speciesId,
    placeId,
    homeId: placeId,
    nameSource: learned ? 'world' : 'generic',
  };
}
