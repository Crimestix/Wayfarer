/**
 * Beziehungen aus Sätzen lesen. Steht im Text eines Artikels „Sie ist die Schwester von Odo“ oder
 * „Mira dient dem Haus Tannhaus“, schlägt Wayfarer die Beziehung vor. Feste Satzmuster, kein
 * Verstehen: Ein Muster greift nur, wenn das Schlüsselwort unmittelbar vor einem Namen steht, den
 * Wayfarer als Eintrag der Welt kennt (Verweis in Klammern oder erkannter Name). Wer die Aussage
 * trägt, sagt der Satzanfang: ein Name dort – oder, ohne Namen, der Eintrag des Artikels.
 *
 * Es bleibt beim Vorschlag. Eingetragen wird erst, wenn der Spielleiter zustimmt – Sätze sind
 * mehrdeutig, und was in der Welt gilt, entscheidet er. Sätze mit „nicht“, „kein“, „früher“,
 * „war“ und Ähnlichem werden gar nicht erst gelesen.
 */
import type { Article, CampaignData, Entity, EntityKind } from '../../domain/schema';
import type { ArticleNode, Inline } from '../legendkeeper/model';
import { worldIndex, type WorldIndex } from './facts';
import { articleNodes } from './text';

export interface RelationHint {
  /** Eindeutig je Aussage – damit ein abgelehnter Vorschlag nicht wiederkommt. */
  key: string;
  from: Entity;
  to: Entity;
  /** Schlüssel aus RELATION_TYPES – oder `home`: „lebt in“ setzt das Zuhause einer Person. */
  type: string;
  /** Der Satz, aus dem der Vorschlag stammt. */
  sentence: string;
}

const PEOPLE: readonly EntityKind[] = ['person', 'character'];
const GROUPS: readonly EntityKind[] = ['faction', 'family'];
const ACTORS: readonly EntityKind[] = [...PEOPLE, ...GROUPS];

interface Pattern {
  type: string;
  /** Was unmittelbar vor dem Namen stehen muss (klein geschrieben, ohne Artikel am Ende). */
  lead: RegExp;
  /** Welche Arten von Einträgen der Name meinen darf. */
  object: readonly EntityKind[];
  /** Wer die Aussage trägt. */
  subject: readonly EntityKind[];
  /** Die Beziehung läuft vom genannten Namen zum Subjekt („Schüler von X“: X lehrt). */
  inverse?: true;
}

const of = '(?:von|vom|des|der)';
const end = '\\s*$';
const word = (source: string) => new RegExp(`(?:^|[^\\p{L}])(?:${source})${end}`, 'u');

/** Die Muster, das genauere vor dem allgemeineren. */
const PATTERNS: Pattern[] = [
  {
    type: 'lover',
    lead: word(
      `verheiratet mit|verlobt mit|liiert mit|(?:ehemann|ehefrau|gatte|gattin|gemahl|gemahlin|geliebter|geliebte|verlobter|verlobte|partner|partnerin) ${of}`,
    ),
    object: PEOPLE,
    subject: PEOPLE,
  },
  {
    type: 'family',
    lead: word(
      `verwandt mit|(?:bruder|schwester|halbbruder|halbschwester|zwillingsbruder|zwillingsschwester|vater|mutter|sohn|tochter|onkel|tante|cousin|cousine|vetter|neffe|nichte|großvater|großmutter|enkel|enkelin|schwager|schwägerin) ${of}`,
    ),
    object: PEOPLE,
    subject: PEOPLE,
  },
  {
    type: 'friend',
    lead: word(`befreundet mit|(?:freund|freundin|vertrauter|vertraute) ${of}`),
    object: PEOPLE,
    subject: PEOPLE,
  },
  {
    type: 'ally',
    lead: word(`verbündet mit|(?:verbündeter|verbündete) ${of}`),
    object: ACTORS,
    subject: ACTORS,
  },
  {
    type: 'enemy',
    lead: word(
      `verfeindet mit|hasst|(?:feind|feindin|todfeind|todfeindin|erzfeind|erzfeindin) ${of}`,
    ),
    object: ACTORS,
    subject: ACTORS,
  },
  {
    type: 'rival',
    lead: word(`rivalisiert mit|konkurriert mit|(?:rivale|rivalin|konkurrent|konkurrentin) ${of}`),
    object: ACTORS,
    subject: ACTORS,
  },
  {
    type: 'mentor',
    lead: word(
      `unterrichtet|bildet|(?:lehrmeister|lehrmeisterin|mentor|mentorin|lehrer|lehrerin) ${of}`,
    ),
    object: PEOPLE,
    subject: PEOPLE,
  },
  {
    type: 'mentor',
    lead: word(`lernt bei|in der lehre bei|(?:schüler|schülerin|lehrling|zögling) ${of}`),
    object: PEOPLE,
    subject: PEOPLE,
    inverse: true,
  },
  {
    type: 'serves',
    lead: word(
      `dient|untersteht|gehorcht|(?:diener|dienerin|leibwächter|leibwächterin|gefolgsmann|vasall|vasallin|knappe|handlanger|handlangerin) ${of}`,
    ),
    object: ACTORS,
    subject: PEOPLE,
  },
  {
    type: 'rules',
    lead: word(
      `herrscht über|regiert|verwaltet|(?:herrscher|herrscherin|herr|herrin|bürgermeister|bürgermeisterin|vogt|vögtin|statthalter|statthalterin|verwalter|verwalterin) (?:${of}|über)`,
    ),
    object: ['place'],
    subject: ACTORS,
  },
  {
    type: 'leads',
    lead: word(
      `führt|leitet|befehligt|(?:anführer|anführerin|oberhaupt|leiter|leiterin|meister|meisterin|hauptmann|kommandant|kommandantin) ${of}`,
    ),
    object: GROUPS,
    subject: PEOPLE,
  },
  {
    type: 'member',
    lead: word(
      `gehört zu|gehört zum|gehört zur|(?:mitglied|angehöriger|angehörige|teil) (?:${of}|bei|im|in)`,
    ),
    object: GROUPS,
    subject: ACTORS,
  },
  {
    type: 'employs',
    lead: word(`arbeitet für|arbeitet bei|angestellt bei|im dienst ${of}|steht im dienst ${of}`),
    object: ACTORS,
    subject: PEOPLE,
    inverse: true,
  },
  {
    type: 'owes',
    lead: word(`schuldet|steht in der schuld ${of}`),
    object: ACTORS,
    subject: ACTORS,
  },
  { type: 'fears', lead: word(`fürchtet|hat angst vor`), object: ACTORS, subject: ACTORS },
  { type: 'seeks', lead: word(`sucht nach|sucht|jagt|verfolgt`), object: ACTORS, subject: ACTORS },
  {
    type: 'owns',
    lead: word(`besitzt|(?:besitzer|besitzerin|eigentümer|eigentümerin) ${of}`),
    object: ['place', 'item'],
    subject: ACTORS,
  },
  {
    type: 'home',
    lead: word(`lebt in|lebt im|wohnt in|wohnt im|zu hause in|zu hause im|haust in`),
    object: ['place'],
    subject: ['person'],
  },
];

/** Beziehungen, die in beide Richtungen dasselbe sagen. */
const SYMMETRIC = new Set(['family', 'lover', 'friend', 'ally', 'enemy', 'rival']);

/** Wörter, die eine Aussage verneinen, in die Vergangenheit rücken oder nur vermuten. */
const UNSURE =
  /(?:^|[^\p{L}])(?:nicht|nie|niemals|kein\p{L}*|ehemals|ehemalig\p{L}*|früher\p{L}*|einst|damals|war|waren|wurde|wurden|gewesen|angeblich|vielleicht|vermutlich|wahrscheinlich|möglicherweise|soll|sollen|könnte|wäre|hätte|will|wollte|möchte)(?![\p{L}])/iu;

/** Artikel und Fürwörter zwischen Schlüsselwort und Name: „dient dem Haus“, „Bruder ihres Herrn“. */
const BEFORE_NAME =
  /\s+(?:der|die|das|dem|den|des|einer|einem|einen|eines|seiner|seinem|seinen|seines|ihrer|ihrem|ihren|ihres)(?:\s+\p{Ll}+(?:e|en|er|em|es))?\s*$/iu;

/**
 * Bloße Verben vor dem Namen. Im Deutschen kann das Subjekt auch dahinter stehen („Im Hafen
 * besitzt Hohenfurt nichts“) – deshalb zählen sie nur, wenn der Satzanfang das Subjekt zeigt.
 */
const BARE_VERB =
  /(?:^|[^\p{L}])(?:dient|untersteht|gehorcht|hasst|führt|leitet|befehligt|regiert|verwaltet|unterrichtet|bildet|schuldet|fürchtet|sucht|jagt|verfolgt|besitzt)\s*$/u;

/** Beginnt der Satz mit „Er/Sie/Es“ oder einem Teil des Namens? Dann spricht er vom Eintrag. */
function speaksOf(sentence: string, owner: Entity): boolean {
  const first = /^[\s„"»(–-]*([\p{L}'’]+)/u.exec(sentence)?.[1]?.toLocaleLowerCase('de');
  if (!first) return false;
  if (first === 'er' || first === 'sie' || first === 'es') return true;
  return [owner.name, ...owner.aliases].some((name) =>
    name
      .toLocaleLowerCase('de')
      .split(/[^\p{L}'’]+/u)
      .includes(first),
  );
}

/** Am Satzanfang vor dem Namen: „Der alte Odo dient …“. */
const SENTENCE_START = /^\s*(?:(?:der|die|das)\s+)?(?:\p{Ll}+(?:e|en|er)\s+)?$/iu;

/** Abkürzungen, nach deren Punkt kein Satz endet. */
const ABBREVIATIONS = new Set([
  'dr',
  'prof',
  'hr',
  'fr',
  'st',
  'nr',
  'bzw',
  'ca',
  'evtl',
  'ggf',
  'usw',
  'etc',
  'vgl',
  'sog',
]);

interface Span {
  from: number;
  to: number;
  entity: Entity;
}

interface Passage {
  text: string;
  spans: Span[];
}

/** Die Absätze eines Artikels als Text mit den Stellen, an denen ein Eintrag der Welt steht. */
function passagesOf(nodes: ArticleNode[], index: WorldIndex, into: Passage[] = []): Passage[] {
  const add = (inlines: Inline[]) => {
    let text = '';
    const spans: Span[] = [];
    for (const inline of inlines) {
      if (inline.type === 'break') text += ' ';
      else if (inline.type === 'text') text += inline.text;
      else {
        const entity = inline.resourceId ? index.byArticle.get(inline.resourceId)?.[0] : undefined;
        if (entity)
          spans.push({ from: text.length, to: text.length + inline.label.length, entity });
        text += inline.label;
      }
    }
    if (spans.length) into.push({ text, spans });
  };
  for (const node of nodes) {
    switch (node.type) {
      case 'paragraph':
        add(node.inlines);
        break;
      case 'quote':
      case 'callout':
      case 'expand':
      case 'group':
      case 'secret':
        passagesOf(node.children, index, into);
        break;
      case 'list':
        for (const item of node.items) passagesOf(item, index, into);
        break;
      case 'columns':
        for (const column of node.columns) passagesOf(column, index, into);
        break;
      case 'tasks':
        for (const item of node.items) add(item.inlines);
        break;
      // Der Steckbrief wird über seine Felder gelesen (`facts.ts`), nicht über Sätze.
      default:
        break;
    }
  }
  return into;
}

/** Wo in einem Absatz ein Satz endet – nie mitten in einem Namen, nie nach einer Abkürzung. */
function sentenceEnds(passage: Passage): number[] {
  const ends: number[] = [];
  const pattern = /[.!?…]+(?=\s+[\p{Lu}„"»(]|\s*$)/gu;
  for (const match of passage.text.matchAll(pattern)) {
    const at = match.index;
    if (passage.spans.some((span) => at >= span.from && at < span.to)) continue;
    const before = /([\p{L}]+)$/u.exec(passage.text.slice(0, at))?.[1] ?? '';
    if (match[0] === '.' && (before.length <= 1 || ABBREVIATIONS.has(before.toLowerCase())))
      continue;
    ends.push(at + match[0].length);
  }
  if (ends[ends.length - 1] !== passage.text.length) ends.push(passage.text.length);
  return ends;
}

const hintKey = (type: string, from: string, to: string) =>
  SYMMETRIC.has(type) && from > to ? `${type}:${to}>${from}` : `${type}:${from}>${to}`;

/** Steht das schon in der Welt? */
function known(data: CampaignData, type: string, from: Entity, to: Entity): boolean {
  if (type === 'home') return from.kind === 'person' && from.person.homeId !== null;
  return Object.values(data.relations).some(
    (r) =>
      !r.ended &&
      r.type === type &&
      ((r.from === from.id && r.to === to.id) ||
        (SYMMETRIC.has(type) && r.from === to.id && r.to === from.id)),
  );
}

/** Wie weit das Schlüsselwort vom Subjekt entfernt sein darf, wenn beide im Satz stehen. */
const MAX_GAP = 70;

/**
 * Beziehungen, die der Text eines Artikels nahelegt und die noch nicht in der Welt stehen.
 * `owner` ist der Eintrag des Artikels: Er trägt die Aussage, wenn der Satz kein Subjekt nennt
 * („Schwester von Odo.“, „Sie dient dem Haus Tannhaus.“).
 */
export function relationHints(
  data: CampaignData,
  article: Article,
  owner: Entity | undefined,
): RelationHint[] {
  const index = worldIndex(data);
  const out = new Map<string, RelationHint>();
  const dismissed = new Set(article.dismissedHints);
  for (const passage of passagesOf(articleNodes(data.articles, article), index)) {
    let start = 0;
    for (const stop of sentenceEnds(passage)) {
      const sentence = passage.text.slice(start, stop).trim();
      const spans = passage.spans.filter((span) => span.from >= start && span.to <= stop);
      const from = start;
      start = stop;
      if (!spans.length || UNSURE.test(sentence)) continue;
      // Das Subjekt: der Name, mit dem der Satz beginnt („Jost Reuse dient …“) – sonst der
      // Eintrag des Artikels („Sie ist die Schwester von … und arbeitet für …“).
      const opener = spans[0]!;
      const named = SENTENCE_START.test(passage.text.slice(from, opener.from));
      const subject = named ? opener.entity : owner;
      spans.forEach((span, position) => {
        if (named && position === 0) return;
        const previous = spans[position - 1];
        if (!subject || subject.id === span.entity.id) return;
        const leadStart = previous ? previous.to : from;
        if (named && span.from - opener.to > MAX_GAP) return;
        // Mit und ohne das Wort vor dem Namen: „dient dem Haus“ wie „Bruder des Vogts“.
        const lead = passage.text.slice(leadStart, span.from).toLocaleLowerCase('de');
        const short = lead.replace(BEFORE_NAME, ' ');
        for (const pattern of PATTERNS) {
          if (!pattern.object.includes(span.entity.kind)) continue;
          if (!pattern.subject.includes(subject.kind)) continue;
          if (!pattern.lead.test(lead) && !pattern.lead.test(short)) continue;
          if (!named && BARE_VERB.test(short) && !speaksOf(sentence, subject)) break;
          const [a, b] = pattern.inverse ? [span.entity, subject] : [subject, span.entity];
          const key = hintKey(pattern.type, a.id, b.id);
          if (!out.has(key) && !dismissed.has(key) && !known(data, pattern.type, a, b))
            out.set(key, { key, from: a, to: b, type: pattern.type, sentence });
          break;
        }
      });
    }
  }
  return [...out.values()];
}

export interface ArticleHints {
  article: Article;
  hints: RelationHint[];
}

/** Die Vorschläge aller Artikel, die welche haben – in der Reihenfolge der Titel. */
export function allRelationHints(data: CampaignData): ArticleHints[] {
  const index = worldIndex(data);
  const out: ArticleHints[] = [];
  for (const article of Object.values(data.articles)) {
    if (article.template) continue;
    const hints = relationHints(data, article, index.byArticle.get(article.id)?.[0]);
    if (hints.length) out.push({ article, hints });
  }
  return out.sort((a, b) => a.article.title.localeCompare(b.article.title, 'de'));
}
