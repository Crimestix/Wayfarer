/**
 * Namen beim Lesen der Notizen – tolerant gegenüber den Eigenheiten schnell getippter Notizen:
 * Großbuchstaben mitten im Wort („BRann“), verdoppelte Buchstaben („Krummmzahn“),
 * typografische Apostrophe („Hagen’s Rast“). Was Wayfarer nicht findet und mehrfach als Name
 * dasteht, wird zur Frage „Wer oder was ist X?“ – nie legt Wayfarer selbst etwas an.
 */
import type { CampaignData, Entity, EntityKind } from '../../domain/schema';

/** Vereinheitlicht einen Namen: klein, Apostrophe gleich, keine doppelten Buchstaben. */
export function foldName(name: string): string {
  return name
    .normalize('NFC')
    .toLocaleLowerCase('de')
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/(\p{L})\1+/gu, '$1')
    .trim();
}

/**
 * Text zum Erkennen, gleich lang wie der Wortlaut (Stellen bleiben gültig): „SChwester“ →
 * „Schwester“, „die Spieler“ → „die Gruppe“, „fast sofort“ → „kurz sofort“ (kein „fast“ getötet).
 */
export function readingText(text: string): string {
  const pad = (word: string, length: number) =>
    word + ' '.repeat(Math.max(0, length - word.length));
  return (
    text
      // Zwei Großbuchstaben am Wortanfang, dann klein: Tippfehler.
      .replace(
        /(?<![\p{L}])(\p{Lu})(\p{Lu})(\p{Ll}{2,})/gu,
        (_, a: string, b: string, rest: string) => `${a}${b.toLocaleLowerCase('de')}${rest}`,
      )
      // Wer in den Notizen handelt, ist meist die Gruppe.
      .replace(
        /(?<![\p{L}])([Dd]ie\s+)(Spieler(?:innen)?|Charaktere|Helden|Abenteurer)(?![\p{L}])/gu,
        (_, art: string, noun: string) => `${art}${pad('Gruppe', noun.length)}`,
      )
      .replace(
        /(?<![\p{L}])(fast|beinahe)(\s+)(sofort|gleich|augenblicklich)(?![\p{L}])/giu,
        (_, near: string, space: string, then: string) =>
          `${pad('kurz', near.length)}${space}${then}`,
      )
  );
}

/** Ein Name im Text und der Eintrag, den er eindeutig meint. */
export interface Mention {
  from: number;
  to: number;
  id: string;
}

interface Known {
  /** gefalteter Name → Einträge */
  byFold: Map<string, string[]>;
  /** gefaltetes erstes Wort → gefaltete Namen, längste zuerst */
  byFirst: Map<string, string[]>;
}

const knownCache = new WeakMap<CampaignData['entities'], Known>();

const PARTICLES = new Set(['von', 'van', 'zu', 'de', 'der', 'die', 'das', 'den', 'dem']);

function known(data: CampaignData): Known {
  const cached = knownCache.get(data.entities);
  if (cached) return cached;
  const byFold = new Map<string, string[]>();
  const add = (name: string, id: string) => {
    const fold = foldName(name);
    if (fold.length < 3) return;
    const list = byFold.get(fold);
    if (!list) byFold.set(fold, [id]);
    else if (!list.includes(id)) list.push(id);
  };
  const shortCount = new Map<string, Set<string>>();
  for (const entity of Object.values(data.entities)) {
    for (const name of [entity.name, ...entity.aliases]) {
      add(name, entity.id);
      add(name.replace(/^(?:der|die|das)\s+/i, ''), entity.id);
    }
    if (entity.kind === 'person' || entity.kind === 'character') {
      const words = entity.name.split(/\s+/).filter((w) => !PARTICLES.has(w.toLowerCase()));
      if (words.length > 1)
        for (const word of [words[0]!, words[words.length - 1]!]) {
          const fold = foldName(word);
          if (!shortCount.has(fold)) shortCount.set(fold, new Set());
          shortCount.get(fold)!.add(entity.id);
        }
    }
  }
  for (const [fold, ids] of shortCount)
    if (!byFold.has(fold) && fold.length >= 3) byFold.set(fold, [...ids]);
  const byFirst = new Map<string, string[]>();
  for (const fold of byFold.keys()) {
    const first = fold.split(' ')[0]!;
    const list = byFirst.get(first);
    if (list) list.push(fold);
    else byFirst.set(first, [fold]);
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.length - a.length);
  const result = { byFold, byFirst };
  knownCache.set(data.entities, result);
  return result;
}

const TOKEN = /[\p{L}][\p{L}’'`´-]*/gu;

interface Token {
  from: number;
  to: number;
  word: string;
}

function tokens(text: string): Token[] {
  const out: Token[] = [];
  for (const match of text.matchAll(TOKEN)) {
    // „Hagen’s“, „Miras“: der Wortteil vor dem Apostroph zählt mit.
    out.push({ from: match.index, to: match.index + match[0].length, word: match[0] });
  }
  return out;
}

/** Ohne Genitiv: „Miras“ → „Mira“, „Hagen’s“ → „Hagen“. */
const stems = (word: string) => {
  const out = [word];
  const apostrophe = /^(.+?)[’'`´]s?$/u.exec(word);
  if (apostrophe) out.push(apostrophe[1]!);
  else if (/[^sßxz]s$/u.test(word)) out.push(word.slice(0, -1));
  return out;
};

/**
 * Alle Namen der Welt im Text, tolerant geschrieben, von links nach rechts. Ein Name zählt nur,
 * wenn er genau einen Eintrag meint.
 */
export function mentions(data: CampaignData, text: string): Mention[] {
  const { byFold, byFirst } = known(data);
  const words = tokens(text);
  const out: Mention[] = [];
  for (let i = 0; i < words.length; i++) {
    const first = words[i]!;
    if (!/^\p{Lu}/u.test(first.word)) continue;
    let hit: Mention | null = null;
    for (const stem of stems(first.word)) {
      const candidates = byFirst.get(foldName(stem));
      if (!candidates) continue;
      for (const fold of candidates) {
        const parts = fold.split(' ').length;
        if (i + parts > words.length) continue;
        const span = words.slice(i, i + parts);
        // Zwischen den Wörtern nur Leerraum.
        if (span.some((w, k) => k > 0 && text.slice(span[k - 1]!.to, w.from).trim())) continue;
        const last = span[span.length - 1]!;
        const phrase = text.slice(first.from, last.to);
        const variants =
          parts === 1
            ? stems(first.word)
            : [phrase, ...stems(last.word).map((s) => text.slice(first.from, last.from) + s)];
        if (!variants.some((v) => foldName(v) === fold)) continue;
        const ids = byFold.get(fold)!;
        if (ids.length !== 1) continue;
        hit = { from: first.from, to: last.to, id: ids[0]! };
        i += parts - 1;
        break;
      }
      if (hit) break;
    }
    if (hit) out.push(hit);
  }
  return out;
}

/**
 * Die Welt mit vorübergehenden zweiten Namen für Schreibweisen im Text, die tolerant gelesen
 * einen Eintrag eindeutig meinen („Krummmzahn“ für „Krummzahn“). So findet das Erkennen
 * (`recognizeEntry`) sie. Die Welt selbst bleibt unverändert.
 */
export function tolerantWorld(data: CampaignData, text: string): CampaignData {
  const extra = new Map<string, Set<string>>();
  for (const mention of mentions(data, text)) {
    const written = text.slice(mention.from, mention.to);
    const entity = data.entities[mention.id];
    if (!entity) continue;
    const exact = [entity.name, ...entity.aliases];
    const plain = stems(written);
    // Steht er so (oder im Genitiv davon) schon in der Welt, findet ihn das Erkennen selbst.
    if (plain.some((variant) => exact.includes(variant))) continue;
    if (!extra.has(mention.id)) extra.set(mention.id, new Set());
    extra.get(mention.id)!.add(plain[plain.length - 1]!);
  }
  if (!extra.size) return data;
  const entities: Record<string, Entity> = { ...data.entities };
  for (const [id, names] of extra) {
    const entity = entities[id]!;
    entities[id] = { ...entity, aliases: [...entity.aliases, ...names] };
  }
  return { ...data, entities };
}

/** Die Einträge einer Art, die ein Name meint (tolerant geschrieben); leer, wenn keiner. */
export function entitiesNamed(
  data: CampaignData,
  name: string,
  kinds?: readonly EntityKind[],
): string[] {
  const { byFold } = known(data);
  for (const stem of stems(name.trim())) {
    const ids = byFold.get(foldName(stem));
    if (!ids) continue;
    return kinds ? ids.filter((id) => kinds.includes(data.entities[id]!.kind)) : ids;
  }
  return [];
}

// ── Unbekannte Namen ───────────────────────────────────────────────────────

/** Begleiter eines Hauptworts: Steht davor eines davon, ist das Wort ein gewöhnliches Hauptwort. */
const DETERMINERS = new Set(
  'der die das den dem des ein eine einen einem einer eines kein keine keinen keinem keiner sein seine seinen seinem seiner seines ihr ihre ihren ihrem ihrer ihres mein meine meinen meinem meiner dein deine deinen unser unsere unseren unserem euer eure euren jede jeden jedem jeder jedes diese diesen diesem dieser dieses alle allen viele vielen einige einigen mehrere zwei drei vier fünf sechs sieben acht neun zehn zum zur im am vom beim ins ans aufs ums durchs welche welchen welcher welches manche manchen solche solchen'.split(
    ' ',
  ),
);

/** Verhältniswörter: Mit einem Beiwort dazwischen („aus schwarzem Stoff“) folgt ein Hauptwort. */
const PREPOSITIONS = new Set(
  'aus mit von zu für ohne durch gegen um bei nach vor über unter in an auf hinter neben zwischen'.split(
    ' ',
  ),
);

/** Häufige Hauptwörter und Spielbegriffe, die ohne Begleiter dastehen können. */
const COMMON_WORDS = new Set(
  'gruppe spieler spielerin charaktere charakter session sitzung kampf runde runden phase level stufe uhr tag tage tagen nacht morgen abend mittag mittags abends nachts downtime notizen intro loot beute gold silber kupfer platin insgesamt leute dorf stadt heute gestern später danach dann dort hier auch aber doch noch nur sofort zusätzlich außerdem anschließend daraufhin schließlich kurz erst zuerst nachdem während als wenn weil dass ob sie er es wir ihr ihnen ihm uns euch man jemand niemand alle jeder nichts etwas ja nein nicht hilfe teil teile ende anfang weg ziel zeit plan pläne idee fragen frage antwort grund hinweise hinweis gold mal male meter fuß minute minuten sekunde sekunden stunde stunden woche wochen monat monate jahr jahre spell spells spellscroll scroll potion ring armor shield wand staff cloak amulet save damage bonus action actions fighter paladin wizard druid druide rogue warlock sorcerer cleric bard ranger monk barbarian leather studded plate half light heavy religion arcana perception stealth insight check wurf würfe rettungswurf schaden resistenz telepathie dunkelsicht handout handouts'.split(
    ' ',
  ),
);

/** Endungen deutscher Hauptwörter, die kein Name trägt. */
const NOUN_END =
  /(?:ung|ungen|heit|heiten|keit|keiten|schaft|schaften|tion|tionen|tät|täten|nis|nisse|tum|tümer|chen|lein|ismus|ment|ling|linge|isse|ierung|erei|ität|tik|sik|gik|fik|mik)$/u;

export interface NameQuestionDraft {
  key: string;
  /** Die Schreibweise, in der er am häufigsten dasteht. */
  name: string;
  count: number;
  /** Zeilen (0-basiert). */
  lines: number[];
}

/** Ein Stück Text der Notizen mit seiner Zeile. */
export interface TextPiece {
  text: string;
  line: number;
}

const SENTENCE_START = /(?:^|[.!?:;]["“”»«]?\s+|[„“"»(]\s*|^\s*(?:[*•·\-–—]|\d{1,2}[.)])\s+)$/u;

/**
 * Unbekannte Eigennamen: großgeschrieben, nicht am Satzanfang, nicht in der Welt, kein
 * gewöhnliches Hauptwort (steht nirgends hinter „der/die/das …“) und mehrfach in der Session.
 * `corpus` – weitere Texte (andere Sessions), an denen sich gewöhnliche Hauptwörter verraten.
 */
export function unknownNames(
  data: CampaignData,
  pieces: TextPiece[],
  corpus: string[] = [],
  limit = 12,
): NameQuestionDraft[] {
  const { byFold } = known(data);
  const all = [...pieces.map((p) => p.text), ...corpus];
  // Wörter, die irgendwo hinter einem Begleiter stehen oder kleingeschrieben vorkommen. Ein
  // „das“ direkt davor zählt für sich: Oft ist es ein verschriebenes „dass“ („erfuhr das Odo …“).
  const nouns = new Set<string>();
  const afterDas = new Map<string, number>();
  const noun = (fold: string, das = false) =>
    das ? afterDas.set(fold, (afterDas.get(fold) ?? 0) + 1) : nouns.add(fold);
  const lower = new Map<string, number>();
  const upper = new Map<string, number>();
  for (const text of all) {
    const words = tokens(text);
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!;
      const fold = foldName(w.word);
      if (/^\p{Ll}/u.test(w.word)) lower.set(fold, (lower.get(fold) ?? 0) + 1);
      else upper.set(fold, (upper.get(fold) ?? 0) + 1);
      if (!/^\p{Lu}/u.test(w.word)) continue;
      // „vor 60 Jahren“: eine Zahl davor.
      if (/\d\s*$/.test(text.slice(Math.max(0, w.from - 4), w.from))) noun(fold);
      // „den kleinen Beutel“, „aus schwarzem Stoff“: Begleiter oder Verhältniswort mit Beiwort.
      for (let back = 1; back <= 3 && i - back >= 0; back++) {
        const prev = words[i - back]!;
        const between = text.slice(prev.to, w.from);
        if (/[.!?:;,]/.test(between)) break;
        const lowerPrev = prev.word.toLocaleLowerCase('de');
        if (DETERMINERS.has(lowerPrev) || (back >= 2 && PREPOSITIONS.has(lowerPrev))) {
          noun(fold, back === 1 && lowerPrev === 'das');
          break;
        }
        if (/^\p{Lu}/u.test(prev.word)) break;
        // Ein Beiwort dazwischen („den alten Beutel“) – nicht „das es Odo ist“.
        if (back === 1 && (lowerPrev.length < 4 || !/(?:e|em|en|er|es)$/u.test(lowerPrev))) break;
      }
    }
  }
  const isKnown = (fold: string) =>
    byFold.has(fold) || [...byFold.keys()].some((k) => k.split(' ').includes(fold));
  // Der Name ohne Genitiv: „Hagen’s“ → „Hagen“ immer, „Miras“ → „Mira“ nur, wenn „Mira“ auch
  // für sich dasteht – sonst endet der Name selbst auf s („Fabius“).
  const bareOf = (word: string) => {
    const bare = stems(word);
    if (bare.length < 2) return word;
    if (/[’'`´]/u.test(word)) return bare[1]!;
    return upper.has(foldName(bare[1]!)) ? bare[1]! : word;
  };
  const candidate = (word: string) => {
    const fold = foldName(bareOf(word));
    if (word.length < 3 || fold.length < 3) return false;
    if (word === word.toLocaleUpperCase('de')) return false; // „HALT“, „DC“
    if (!/^\p{Lu}\p{Ll}/u.test(word)) return false;
    if (COMMON_WORDS.has(fold) || NOUN_END.test(fold)) return false;
    // Öfter kleingeschrieben als groß: ein gewöhnliches Wort am Satzanfang.
    const written = foldName(word);
    if (nouns.has(fold) || nouns.has(written)) return false;
    const das = Math.max(afterDas.get(fold) ?? 0, afterDas.get(written) ?? 0);
    if (das * 2 > (upper.get(written) ?? 0)) return false;
    if ((lower.get(written) ?? 0) >= (upper.get(written) ?? 0)) return false;
    return !isKnown(fold) && !isKnown(written);
  };

  interface Found {
    key: string;
    name: string;
    count: number;
    lines: Set<number>;
    inner: number;
    /** Wie oft er wie geschrieben steht – gezeigt wird die häufigste Schreibweise. */
    spellings: Map<string, number>;
  }
  const found = new Map<string, Found>();
  for (const piece of pieces) {
    const words = tokens(piece.text);
    for (let i = 0; i < words.length; i++) {
      if (!candidate(words[i]!.word)) continue;
      // Benachbarte unbekannte Namen gehören zusammen („Elsa Morgentau“).
      let j = i;
      while (
        j + 1 < words.length &&
        candidate(words[j + 1]!.word) &&
        /^\s$/.test(piece.text.slice(words[j]!.to, words[j + 1]!.from))
      )
        j++;
      const span = words.slice(i, j + 1);
      const name = span.map((w) => bareOf(w.word)).join(' ');
      const key = foldName(name);
      const initial = SENTENCE_START.test(piece.text.slice(0, words[i]!.from));
      const entry = found.get(key) ?? {
        key,
        name,
        count: 0,
        lines: new Set<number>(),
        inner: 0,
        spellings: new Map<string, number>(),
      };
      entry.count++;
      entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1);
      entry.lines.add(piece.line);
      if (!initial) entry.inner++;
      found.set(key, entry);
      i = j;
    }
  }
  // Ein längerer Name, der nur einmal dasteht („erschlug Wilmar Gundolf“), sind zwei Namen –
  // außer ein Teil davon steht auch sonst zusammen („Wido Brechts Haus“ zu „Wido Brecht“).
  const longest = [...found.values()]
    .filter((e) => e.key.includes(' ') && e.count === 1)
    .sort((a, b) => b.key.split(' ').length - a.key.split(' ').length);
  for (const entry of longest) {
    if (entry.count > 1 || found.get(entry.key) !== entry) continue;
    found.delete(entry.key);
    const parts = entry.key.split(' ');
    let target: Found | undefined;
    for (let size = parts.length - 1; size >= 2 && !target; size--)
      for (let at = 0; at + size <= parts.length && !target; at++)
        target = found.get(parts.slice(at, at + size).join(' '));
    if (target) {
      target.count += entry.count;
      target.inner += entry.inner;
      for (const line of entry.lines) target.lines.add(line);
      continue;
    }
    for (const part of entry.name.split(' ')) {
      if (!candidate(part)) continue;
      const key = foldName(part);
      const single = found.get(key) ?? {
        key,
        name: part,
        count: 0,
        lines: new Set<number>(),
        inner: 0,
        spellings: new Map<string, number>(),
      };
      single.count++;
      single.spellings.set(part, (single.spellings.get(part) ?? 0) + 1);
      single.inner += entry.inner;
      for (const line of entry.lines) single.lines.add(line);
      found.set(key, single);
    }
  }
  // Einzelne Wörter, die Teil eines längeren Namens sind, zählen zu ihm („Elsa“ zu „Elsa Morgentau“).
  const entries = [...found.values()];
  for (const short of entries) {
    if (short.key.includes(' ')) continue;
    const long = entries.filter(
      (e) => e.key.includes(' ') && e.key.split(' ').some((part) => part === short.key),
    );
    if (long.length !== 1) continue;
    const target = long[0]!;
    target.count += short.count;
    target.inner += short.inner;
    for (const line of short.lines) target.lines.add(line);
    found.delete(short.key);
  }
  // Endet ein einzelnes Wort wie ein Hauptwort („Schatten“, „Gottkrieger“), braucht es mehr Belege.
  const nounish = (key: string) => !key.includes(' ') && /(?:e|en|er|el|em|es|ern|eln)$/u.test(key);
  return [...found.values()]
    .filter((e) => e.count >= (nounish(e.key) ? 3 : 2) && e.inner >= 1)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'))
    .slice(0, limit)
    .map((e) => ({
      key: e.key,
      name: [...e.spellings].reduce<[string, number]>(
        (best, next) => (next[1] > best[1] ? next : best),
        [e.name, e.spellings.get(e.name) ?? 0],
      )[0],
      count: e.count,
      lines: [...e.lines].sort((a, b) => a - b),
    }));
}
