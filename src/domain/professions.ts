/**
 * Berufe: eine Liste mittelalterlicher Berufe zum Vorschlagen und das Lesen, welche davon im
 * Geschriebenen schon vorkommen. Nur Name, Einordnung und Werkzeug – keine Beschreibungen; was ein
 * Beruf in der Welt bedeutet, schreibt der Spielleiter. Vorschläge gelten erst, wenn er sie
 * annimmt (`features/welt/professions.ts`).
 *
 * Feste Regeln, kein Raten: Ein Beruf kommt vor, wenn sein Name (oder die weibliche Form, der
 * Genitiv) als ganzes Wort dasteht – nie als Teil eines Namens der Welt („Ilka Weber“). Mit einer
 * Person verbunden wird er nur über ihre Rolle, die Zeile „Beruf“ in ihrem Steckbrief, „Sie ist
 * Schmiedin“ im eigenen Artikel oder Wendungen wie „Brann, der Schmied“ und „der Schmied Brann“.
 */
import type { CampaignData, Entity } from './schema';

/** Werkzeuge nach den Regeln von 2024, auf Deutsch. Der Spielleiter kann sie hier prüfen. */
export const TOOLS = {
  alchemy: 'Alchemistenzubehör',
  brewer: 'Brauerzubehör',
  calligrapher: 'Kalligrafiezubehör',
  carpenter: 'Zimmermannswerkzeug',
  cartographer: 'Kartografenwerkzeug',
  cobbler: 'Schuhmacherwerkzeug',
  cook: 'Kochutensilien',
  glassblower: 'Glasbläserwerkzeug',
  jeweler: 'Juwelierwerkzeug',
  leather: 'Lederwerkzeug',
  mason: 'Maurerwerkzeug',
  painter: 'Malerzubehör',
  potter: 'Töpferwerkzeug',
  smith: 'Schmiedewerkzeug',
  tinker: 'Tüftlerwerkzeug',
  weaver: 'Weberwerkzeug',
  woodcarver: 'Holzschnitzerwerkzeug',
  herbalism: 'Kräuterkundeausrüstung',
  navigator: 'Navigationswerkzeug',
  poisoner: 'Giftmischerausrüstung',
  disguise: 'Verkleidungsausrüstung',
  music: 'Musikinstrument',
  none: '',
} as const;

export interface KnownProfession {
  name: string;
  /** Einordnung wie im Feld „Art“ eines Berufs. */
  category: string;
  /** Werkzeug nach den Regeln; '' = keins. */
  tool: string;
  /** Weitere Formen, die Wayfarer nicht selbst bildet: „Bäuerin“, „Schreiner“. */
  forms?: readonly string[];
}

const p = (
  name: string,
  category: string,
  tool: keyof typeof TOOLS,
  forms?: readonly string[],
): KnownProfession => ({ name, category, tool: TOOLS[tool], ...(forms ? { forms } : {}) });

/** Mittelalterliche Berufe. Einordnungen wie in den Vorschlägen für „Art“ eines Berufs. */
export const KNOWN_PROFESSIONS: readonly KnownProfession[] = [
  // Metall
  p('Schmied', 'Handwerk', 'smith'),
  p('Hufschmied', 'Handwerk', 'smith'),
  p('Waffenschmied', 'Handwerk', 'smith'),
  p('Plattner', 'Handwerk', 'smith', ['Harnischmacher']),
  p('Schwertfeger', 'Handwerk', 'smith'),
  p('Nagelschmied', 'Handwerk', 'smith'),
  p('Kupferschmied', 'Handwerk', 'smith'),
  p('Goldschmied', 'Handwerk', 'jeweler'),
  p('Silberschmied', 'Handwerk', 'jeweler'),
  p('Edelsteinschleifer', 'Handwerk', 'jeweler'),
  p('Zinngießer', 'Handwerk', 'smith'),
  p('Glockengießer', 'Handwerk', 'smith'),
  p('Schlosser', 'Handwerk', 'tinker'),
  p('Feinmechaniker', 'Handwerk', 'tinker', ['Uhrmacher']),
  // Leder und Pelz
  p('Gerber', 'Handwerk', 'leather'),
  p('Kürschner', 'Handwerk', 'leather'),
  p('Schuster', 'Handwerk', 'cobbler', ['Schuhmacher', 'Schuhmacherin']),
  p('Sattler', 'Handwerk', 'leather'),
  p('Riemer', 'Handwerk', 'leather'),
  p('Pergamenter', 'Handwerk', 'leather'),
  // Tuch und Faden
  p('Weber', 'Handwerk', 'weaver'),
  p('Tuchmacher', 'Handwerk', 'weaver'),
  p('Walker', 'Handwerk', 'weaver'),
  p('Färber', 'Handwerk', 'weaver'),
  p('Schneider', 'Handwerk', 'weaver'),
  p('Seiler', 'Handwerk', 'weaver'),
  p('Hutmacher', 'Handwerk', 'weaver'),
  p('Korbflechter', 'Handwerk', 'weaver'),
  // Holz
  p('Zimmermann', 'Handwerk', 'carpenter', ['Zimmerer', 'Zimmerin', 'Zimmerleute']),
  p('Tischler', 'Handwerk', 'carpenter', ['Schreiner', 'Schreinerin']),
  p('Böttcher', 'Handwerk', 'carpenter', ['Fassbinder', 'Küfer']),
  p('Wagner', 'Handwerk', 'carpenter', ['Stellmacher']),
  p('Drechsler', 'Handwerk', 'woodcarver'),
  p('Holzschnitzer', 'Handwerk', 'woodcarver'),
  p('Bogner', 'Handwerk', 'woodcarver', ['Bogenmacher']),
  p('Pfeilschnitzer', 'Handwerk', 'woodcarver', ['Pfeilmacher']),
  p('Schiffbauer', 'Handwerk', 'carpenter', ['Schiffszimmermann']),
  p('Dachdecker', 'Handwerk', 'carpenter'),
  // Stein, Erde und Glas
  p('Steinmetz', 'Handwerk', 'mason'),
  p('Maurer', 'Handwerk', 'mason'),
  p('Ziegler', 'Handwerk', 'potter'),
  p('Töpfer', 'Handwerk', 'potter'),
  p('Glasbläser', 'Handwerk', 'glassblower'),
  p('Maler', 'Kunst', 'painter'),
  // Feuer und Tiefe
  p('Köhler', 'Land und Wasser', 'none'),
  p('Bergmann', 'Land und Wasser', 'none', ['Bergleute']),
  p('Salzsieder', 'Handwerk', 'none'),
  p('Kerzenzieher', 'Handwerk', 'none', ['Lichtzieher']),
  p('Seifensieder', 'Handwerk', 'alchemy'),
  // Nahrung
  p('Müller', 'Handwerk', 'none'),
  p('Bäcker', 'Handwerk', 'cook'),
  p('Metzger', 'Handwerk', 'cook', ['Fleischer', 'Schlachter']),
  p('Koch', 'Dienst', 'cook', ['Köchin']),
  p('Brauer', 'Handwerk', 'brewer'),
  p('Winzer', 'Land und Wasser', 'brewer'),
  p('Imker', 'Land und Wasser', 'none', ['Zeidler']),
  // Land und Wasser
  p('Bauer', 'Land und Wasser', 'none', ['Bäuerin']),
  p('Schäfer', 'Land und Wasser', 'none'),
  p('Hirte', 'Land und Wasser', 'none', ['Hirtin']),
  p('Jäger', 'Land und Wasser', 'none'),
  p('Fallensteller', 'Land und Wasser', 'none'),
  p('Förster', 'Land und Wasser', 'none'),
  p('Holzfäller', 'Land und Wasser', 'none'),
  p('Fischer', 'Land und Wasser', 'none'),
  p('Fährmann', 'Land und Wasser', 'navigator', ['Fährleute']),
  p('Seemann', 'Land und Wasser', 'navigator', ['Seeleute', 'Matrose']),
  p('Steuermann', 'Land und Wasser', 'navigator'),
  p('Fuhrmann', 'Handel', 'none', ['Fuhrleute']),
  // Heilkunde
  p('Kräuterkundige', 'Heilkunde', 'herbalism', ['Kräuterkundiger', 'Kräuterfrau']),
  p('Apotheker', 'Heilkunde', 'alchemy'),
  p('Alchemist', 'Heilkunde', 'alchemy'),
  p('Bader', 'Heilkunde', 'herbalism'),
  p('Barbier', 'Heilkunde', 'none'),
  p('Wundarzt', 'Heilkunde', 'herbalism', ['Wundärztin', 'Feldscher']),
  p('Hebamme', 'Heilkunde', 'herbalism'),
  p('Heiler', 'Heilkunde', 'herbalism'),
  p('Giftmischer', 'Heilkunde', 'poisoner'),
  // Schrift und Wissen
  p('Schreiber', 'Gelehrsamkeit', 'calligrapher'),
  p('Buchbinder', 'Gelehrsamkeit', 'calligrapher'),
  p('Kartograf', 'Gelehrsamkeit', 'cartographer', ['Kartograph', 'Kartographin']),
  p('Gelehrter', 'Gelehrsamkeit', 'none', ['Gelehrte']),
  p('Sterndeuter', 'Gelehrsamkeit', 'navigator', ['Astrologe', 'Astrologin']),
  p('Lehrer', 'Gelehrsamkeit', 'none'),
  // Handel
  p('Händler', 'Handel', 'none'),
  p('Kaufmann', 'Handel', 'none', ['Kauffrau', 'Kaufleute']),
  p('Krämer', 'Handel', 'none'),
  p('Hausierer', 'Handel', 'none'),
  p('Geldwechsler', 'Handel', 'none'),
  // Dienst und Kunst
  p('Wirt', 'Dienst', 'brewer'),
  p('Herold', 'Dienst', 'calligrapher'),
  p('Bote', 'Dienst', 'none', ['Botin']),
  p('Stallknecht', 'Dienst', 'none'),
  p('Wächter', 'Dienst', 'none'),
  p('Nachtwächter', 'Dienst', 'none'),
  p('Büttel', 'Dienst', 'none'),
  p('Henker', 'Dienst', 'none', ['Scharfrichter']),
  p('Totengräber', 'Dienst', 'none'),
  p('Söldner', 'Dienst', 'none'),
  // Ämter
  p('Hafenmeister', 'Dienst', 'none'),
  p('Zöllner', 'Dienst', 'none'),
  p('Steuereintreiber', 'Dienst', 'none'),
  p('Vogt', 'Dienst', 'none'),
  p('Richter', 'Dienst', 'none'),
  p('Kerkermeister', 'Dienst', 'none'),
  p('Spielmann', 'Kunst', 'music', ['Spielfrau', 'Spielleute']),
  p('Barde', 'Kunst', 'music', ['Bardin']),
  p('Gaukler', 'Kunst', 'disguise'),
  p('Schauspieler', 'Kunst', 'disguise'),
  p('Priester', 'Glaube', 'none'),
  p('Mönch', 'Glaube', 'calligrapher', ['Nonne']),
];

// ── Formen ─────────────────────────────────────────────────────────────────

const key = (word: string) => word.toLocaleLowerCase('de').replace(/\s+/g, ' ').trim();

/**
 * Die Formen eines Berufsnamens: der Name, die weibliche Form auf „-in“, der Genitiv auf „-s“
 * und „-es“ (bei „-e“ auf „-n“) – dazu, was ausdrücklich genannt ist.
 */
export function professionForms(name: string, extra: readonly string[] = []): string[] {
  const base = name.trim();
  if (!base) return [];
  const forms = new Set<string>([base, ...extra.map((f) => f.trim()).filter(Boolean)]);
  // Mehrere Wörter („Fahrender Händler“) nur genau so.
  if (!/\s/.test(base)) {
    if (base.endsWith('e')) forms.add(`${base}n`);
    else {
      if (!base.endsWith('mann')) forms.add(`${base}in`);
      forms.add(`${base}s`);
      forms.add(`${base}es`);
    }
  }
  return [...forms];
}

// ── Was geschrieben steht ──────────────────────────────────────────────────

/**
 * Etwas, das der Spielleiter geschrieben hat: ein Artikel oder die Angaben eines Eintrags. Die
 * Artikel liest `features/welt/professions.ts` aus dem Wiki und reicht sie herein.
 */
export interface WrittenSource {
  /** Kennung des Artikels oder Eintrags. */
  id: string;
  title: string;
  /** Wem der Text gehört: die Person des Artikels; null = niemandem. */
  ownerId: string | null;
  /** Werte der Zeile „Beruf“ im Steckbrief. */
  professionLines: readonly string[];
  /** Werte von „Rolle“, „Amt“, „Tätigkeit“ … im Steckbrief oder am Eintrag. */
  roleLines: readonly string[];
  /** Der übrige Text. */
  text: string;
}

export interface SuggestedPerson {
  entityId: string;
  name: string;
  /** Woher die Verbindung stammt: „Rolle: Schmiedin“, „„Brann, der Schmied“ in Hohenfurt“. */
  why: string;
}

export interface ProfessionSuggestion {
  /** „e:<Kennung>“ für einen vorhandenen Beruf, „n:<Name>“ für einen neuen. */
  key: string;
  name: string;
  category: string;
  tool: string;
  /** Den Beruf gibt es schon als Eintrag. */
  professionId: string | null;
  /** In wie vielen Texten er vorkommt. */
  mentions: number;
  /** Die ersten Fundstellen: Titel der Artikel oder Namen der Einträge. */
  sources: string[];
  /** Personen, die man mit ihm verbinden könnte (übt aus). */
  people: SuggestedPerson[];
}

export interface ProfessionSuggestions {
  /** Was im Geschriebenen vorkommt: neue Berufe und vorhandene mit Personen zum Verbinden. */
  found: ProfessionSuggestion[];
  /** Die übrigen Berufe der Liste, die es noch nicht gibt – nach Einordnung und Namen. */
  more: ProfessionSuggestion[];
}

const lastWord = (text: string) => text.trim().split(/\s+/).pop() ?? '';
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LETTER = '[\\p{L}\\p{N}]';
const NAME = "\\p{Lu}[\\p{L}'’-]+";
/** Was in der Zeile „Beruf“ steht, wenn es keinen gibt oder er offen ist – kein neuer Beruf. */
const NO_PROFESSION =
  /^(?:keiner|keine|keins|kein|ohne|nichts|unbekannt|unklar|offen|ungewiss|geheim|verschiedene|diverse)(?!\p{L})/iu;

/** Die Angaben der Einträge selbst: Rolle, Kurzzeile, Notizen von Personen und Gefährten. */
function entitySources(data: Pick<CampaignData, 'entities'>): WrittenSource[] {
  const out: WrittenSource[] = [];
  for (const entity of Object.values(data.entities)) {
    if (entity.kind !== 'person' && entity.kind !== 'character') continue;
    const role = entity.kind === 'person' ? entity.person.role.trim() : '';
    out.push({
      id: entity.id,
      title: entity.name,
      ownerId: entity.id,
      professionLines: [],
      roleLines: role ? [role] : [],
      text: [entity.tagline, entity.notes].join('\n'),
    });
  }
  return out;
}

interface Candidate {
  key: string;
  name: string;
  category: string;
  tool: string;
  professionId: string | null;
  forms: string[];
}

/** Teile eines Wertes: „Schmied, Hufschmied“, „Bäcker und Wirt“. */
const parts = (text: string) =>
  text
    .split(/\s*[,;/•|]\s*|\s+und\s+|\s+[-–—]\s+/)
    .map((part) =>
      part
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);

/**
 * Welche Berufe vorgeschlagen werden: die aus dem Geschriebenen zuerst (mit den Personen dazu),
 * dann die übrigen der Liste, die es noch nicht als Eintrag gibt. `written` sind die Artikel.
 */
export function professionSuggestions(
  data: Pick<CampaignData, 'entities' | 'relations'>,
  written: readonly WrittenSource[] = [],
): ProfessionSuggestions {
  const entities = Object.values(data.entities);
  const takenNames = new Set(entities.flatMap((e) => [e.name, ...e.aliases].map(key)));
  const people = entities.filter((e) => e.kind === 'person' || e.kind === 'character');

  // Kandidaten: die vorhandenen Berufe und die Liste ohne Namen, die es schon gibt.
  const candidates: Candidate[] = [];
  for (const entity of entities)
    if (entity.kind === 'profession')
      candidates.push({
        key: `e:${entity.id}`,
        name: entity.name,
        category: entity.profession.category,
        tool: entity.profession.tool,
        professionId: entity.id,
        forms: [entity.name, ...entity.aliases].flatMap((n) => professionForms(n)),
      });
  const known = new Set(candidates.flatMap((c) => c.forms.map(key)));
  for (const entry of KNOWN_PROFESSIONS) {
    const forms = professionForms(entry.name, entry.forms);
    if (takenNames.has(key(entry.name)) || forms.some((f) => known.has(key(f)))) continue;
    candidates.push({
      key: `n:${key(entry.name)}`,
      name: entry.name,
      category: entry.category,
      tool: entry.tool,
      professionId: null,
      forms,
    });
    for (const form of forms) known.add(key(form));
  }

  const byForm = new Map<string, Candidate>();
  const spelled = new Map<string, string>();
  for (const candidate of candidates)
    for (const form of candidate.forms)
      if (!byForm.has(key(form))) {
        byForm.set(key(form), candidate);
        spelled.set(key(form), form);
      }

  // Im Text zählt nur das großgeschriebene Wort („knappe Vorräte“ ist kein Beruf), in den
  // Zeilen des Steckbriefs und der Rolle jede Schreibung.
  const allForms = [...spelled.values()].sort((a, b) => b.length - a.length).map(escape);
  const pattern = (flags: string) =>
    allForms.length
      ? new RegExp(`(?<!${LETTER})(${allForms.join('|')})(?!${LETTER})`, flags)
      : null;
  const textPattern = pattern('gu');
  const linePattern = pattern('giu');
  // Namen der Welt, in denen ein Berufswort steckt („Ilka Weber“), zählen nicht als Beruf.
  const masked = entities
    .flatMap((e) => [e.name, ...e.aliases])
    .filter((name) => /\s/.test(name.trim()) && textPattern && new RegExp(textPattern).test(name))
    .sort((a, b) => b.length - a.length)
    .map(escape);
  const maskPattern = masked.length
    ? new RegExp(`(?<!${LETTER})(?:${masked.join('|')})(?!${LETTER})`, 'gu')
    : null;
  const mask = (text: string) =>
    maskPattern ? text.replace(maskPattern, (m) => ' '.repeat(m.length)) : text;

  // Personen nach ganzem Namen, Zweitnamen und eindeutigem Vornamen.
  const personByName = new Map<string, Entity | null>();
  const addName = (name: string, person: Entity) => {
    const k = key(name);
    if (!k) return;
    const current = personByName.get(k);
    personByName.set(k, current === undefined || current === person ? person : null);
  };
  for (const person of people)
    for (const name of [person.name, ...person.aliases]) addName(name, person);
  const firstNames = new Map<string, Entity | null>();
  for (const person of people) {
    const first = person.name.trim().split(/\s+/)[0] ?? '';
    if (first.length < 3 || first === person.name.trim()) continue;
    const k = key(first);
    firstNames.set(k, firstNames.has(k) && firstNames.get(k) !== person ? null : person);
  }
  for (const [k, person] of firstNames)
    if (person && !personByName.has(k)) personByName.set(k, person);
  const personNamed = (name: string): Entity | null => personByName.get(key(name)) ?? null;

  const practising = new Set(
    Object.values(data.relations)
      .filter((r) => r.type === 'practises' && !r.ended)
      .map((r) => `${r.from}|${r.to}`),
  );

  interface Tally {
    candidate: Candidate;
    sources: string[];
    people: Map<string, SuggestedPerson>;
  }
  const tallies = new Map<string, Tally>();
  const tallyOf = (candidate: Candidate) => {
    let tally = tallies.get(candidate.key);
    if (!tally) {
      tally = { candidate, sources: [], people: new Map() };
      tallies.set(candidate.key, tally);
    }
    return tally;
  };
  const connect = (candidate: Candidate, person: Entity | null, why: string) => {
    if (!person) return;
    if (candidate.professionId && practising.has(`${person.id}|${candidate.professionId}`)) return;
    const tally = tallyOf(candidate);
    if (!tally.people.has(person.id))
      tally.people.set(person.id, { entityId: person.id, name: person.name, why });
  };
  const hitsIn = (
    text: string,
    inLine = false,
  ): { candidate: Candidate; form: string; index: number }[] => {
    const found = inLine ? linePattern : textPattern;
    if (!found) return [];
    const out: { candidate: Candidate; form: string; index: number }[] = [];
    for (const match of mask(text).matchAll(new RegExp(found))) {
      const candidate = byForm.get(key(match[1]!));
      if (candidate) out.push({ candidate, form: match[1]!, index: match.index });
    }
    return out;
  };
  // Neue Berufe aus der Zeile „Beruf“, die weder in der Liste noch in der Welt stehen.
  const freeNew = new Map<string, Candidate>();

  const sources = [...entitySources(data), ...written];
  for (const source of sources) {
    const owner = source.ownerId ? (data.entities[source.ownerId] ?? null) : null;
    const ownerIsPerson = owner?.kind === 'person' || owner?.kind === 'character';
    const seen = new Set<string>();
    const mention = (candidate: Candidate) => {
      if (seen.has(candidate.key)) return;
      seen.add(candidate.key);
      tallyOf(candidate).sources.push(source.title);
    };
    // Zeilen des Steckbriefs und die Rolle: Wer sie hat, übt den Beruf aus.
    for (const [label, lines] of [
      ['Beruf', source.professionLines],
      ['Rolle', source.roleLines],
    ] as const)
      for (const line of lines) {
        const hits = hitsIn(line, true);
        for (const hit of hits) {
          mention(hit.candidate);
          if (ownerIsPerson) connect(hit.candidate, owner, `${label}: ${line.trim()}`);
        }
        if (label !== 'Beruf' || hits.length) continue;
        for (const part of parts(line)) {
          if (!/^\p{Lu}/u.test(part) || part.length > 40 || part.split(' ').length > 3) continue;
          if (takenNames.has(key(part)) || NO_PROFESSION.test(part)) continue;
          const k = `n:${key(part)}`;
          let candidate = freeNew.get(k);
          if (!candidate) {
            candidate = {
              key: k,
              name: part,
              category: '',
              tool: '',
              professionId: null,
              forms: [part],
            };
            freeNew.set(k, candidate);
          }
          mention(candidate);
          if (ownerIsPerson) connect(candidate, owner, `${label}: ${line.trim()}`);
        }
      }
    // Der Text: Wendungen, die eine Person und ihren Beruf verbinden.
    const text = source.text;
    for (const hit of hitsIn(text)) {
      mention(hit.candidate);
      const before = text.slice(Math.max(0, hit.index - 80), hit.index);
      const after = text.slice(hit.index + hit.form.length, hit.index + hit.form.length + 80);
      const quote = (phrase: string) => `„${phrase.trim()}“ in ${source.title}`;
      // „Brann, der Schmied“ · „Brann Eichwald, die Schmiedin“
      const named = new RegExp(`(${NAME}(?:\\s+${NAME})?),\\s+(?:der|die)\\s+$`, 'u').exec(before);
      if (named) {
        const person = personNamed(named[1]!) ?? personNamed(lastWord(named[1]!));
        connect(hit.candidate, person, quote(`${named[0]}${hit.form}`));
        continue;
      }
      // „Brann ist Schmied“ · „Brann ist der Schmied“
      const is = new RegExp(
        `(${NAME}(?:\\s+${NAME})?)\\s+ist\\s+(?:(?:ein|eine|der|die)\\s+)?$`,
        'u',
      ).exec(before);
      if (is) {
        const name = is[1]!;
        const person = personNamed(name) ?? personNamed(lastWord(name));
        if (person) {
          connect(hit.candidate, person, quote(`${is[0]}${hit.form}`));
          continue;
        }
        // „Sie ist Schmiedin“ im eigenen Artikel.
        if (/^(?:er|sie)$/i.test(lastWord(name)) && ownerIsPerson) {
          connect(hit.candidate, owner, quote(`${is[0]}${hit.form}`));
          continue;
        }
      }
      // „der Schmied Brann“ · „die Schmiedin Ilka Sturmfels“
      if (/(?:^|[^\p{L}])(?:der|die)\s+$/iu.test(before)) {
        const follows = new RegExp(`^\\s+(${NAME})(?:\\s+(${NAME}))?`, 'u').exec(after);
        if (follows) {
          const two = follows[2] ? `${follows[1]} ${follows[2]}` : '';
          const person = (two && personNamed(two)) || personNamed(follows[1]!);
          if (person)
            connect(
              hit.candidate,
              person,
              quote(`${before.match(/(?:der|die)\s+$/i)![0]}${hit.form}${follows[0]}`),
            );
        }
      }
    }
  }

  const toSuggestion = (candidate: Candidate): ProfessionSuggestion => {
    const tally = tallies.get(candidate.key);
    return {
      key: candidate.key,
      name: candidate.name,
      category: candidate.category,
      tool: candidate.tool,
      professionId: candidate.professionId,
      mentions: tally?.sources.length ?? 0,
      sources: tally?.sources.slice(0, 3) ?? [],
      people: [...(tally?.people.values() ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, 'de'),
      ),
    };
  };
  const all = [...candidates, ...freeNew.values()].map(toSuggestion);
  const found = all
    .filter((s) => (s.professionId ? s.people.length > 0 : s.mentions > 0))
    .sort(
      (a, b) =>
        b.people.length - a.people.length ||
        b.mentions - a.mentions ||
        a.name.localeCompare(b.name, 'de'),
    );
  const more = all
    .filter((s) => !s.professionId && s.mentions === 0)
    .sort(
      (a, b) => a.category.localeCompare(b.category, 'de') || a.name.localeCompare(b.name, 'de'),
    );
  return { found, more };
}
