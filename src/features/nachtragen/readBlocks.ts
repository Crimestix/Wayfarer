/**
 * Der Aufbau der Notizen einer Session: Rückblick für die Spieler, Listen offener Fäden,
 * Beutelisten, Einkäufe, Bestellungen, wörtliche Schriftstücke, Zitate, Regelnotizen – und der
 * erzählende Text dazwischen. Rein und ohne Welt: nur die Form der Zeilen zählt. Jede Zeile mit
 * Text gehört genau einem Abschnitt an; der Wortlaut bleibt, wie er dasteht.
 */

/** Eine Zeile der Notizen: Nummer (0-basiert), Stelle im Text, Wortlaut ohne Zeilenende. */
export interface NoteLine {
  index: number;
  from: number;
  to: number;
  text: string;
}

/** Eine Gruppe einer Beuteliste: woher (eine Leiche, eine Truhe …) und was. */
export interface LootGroup {
  /** Die Zeile mit der Quelle; null = ohne eigene Überschrift. */
  source: NoteLine | null;
  items: NoteLine[];
}

/** Eine Zeile einer Einkaufsliste: „Name: Gegenstand (gekauft für X)“. */
export interface PurchaseRow {
  line: NoteLine;
  /** Der Name vor dem Doppelpunkt. */
  who: string;
  item: string;
  /** Was in der Klammer steht, wörtlich. */
  note: string;
}

interface BlockBase {
  lines: NoteLine[];
}

export type NoteBlock =
  | (BlockBase & { kind: 'recap'; head: NoteLine | null })
  | (BlockBase & { kind: 'heading' })
  | (BlockBase & { kind: 'text' })
  | (BlockBase & { kind: 'hooks'; head: NoteLine; items: NoteLine[] })
  | (BlockBase & { kind: 'loot'; head: NoteLine | null; groups: LootGroup[] })
  | (BlockBase & { kind: 'purchases'; head: NoteLine | null; rows: PurchaseRow[] })
  | (BlockBase & { kind: 'order'; head: NoteLine; items: NoteLine[] })
  | (BlockBase & { kind: 'writing'; intro: NoteLine | null; body: NoteLine[]; title: string })
  | (BlockBase & { kind: 'quote'; intro: NoteLine; said: NoteLine })
  | (BlockBase & { kind: 'rules' })
  | (BlockBase & { kind: 'list'; head: NoteLine | null });

export type NoteBlockKind = NoteBlock['kind'];

// ── Zeilen ─────────────────────────────────────────────────────────────────

/** Die Zeilen des Textes mit ihren Stellen; „\r“ am Ende zählt nicht zum Wortlaut. */
export function noteLines(text: string): NoteLine[] {
  const out: NoteLine[] = [];
  let at = 0;
  text.split('\n').forEach((raw, index) => {
    const clean = raw.replace(/\r$/, '');
    out.push({ index, from: at, to: at + clean.length, text: clean });
    at += raw.length + 1;
  });
  return out;
}

const blank = (line: NoteLine | undefined) => !line || !line.text.trim();
const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
/** Endet wie ein Satz. */
const sentenceEnd = (text: string) => /[.!?…]["“”»«]?\s*$/u.test(text.trim());
const BULLET = /^\s*(?:[*•·\-–—]|\d{1,2}[.)])\s+/u;
export const stripBullet = (text: string) => text.replace(BULLET, '').trim();

/** Kopf eines Rückblicks für die Spieler (Vorlesetext). */
const RECAP_HEAD =
  /^\s*(?:#+\s*)?(?:intro|einleitung|einstieg|rückblick|vorlesetext|vorlesen|zum vorlesen|was bisher geschah|bisher geschehen|recap|zusammenfassung(?:\s+für\s+die\s+spieler)?)\s*:?\s*$/iu;
/** Überschriften, die nur einen Abschnitt benennen. */
const PLAIN_HEAD =
  /^\s*(?:#+\s*)?(?:notizen|mitschrift|verlauf|ablauf|spielbericht|geschehen|ereignisse|was geschah)\s*:?\s*$/iu;
const HOOKS_HEAD =
  /^\s*(?:#+\s*)?(?:aktuelle\s+|offene\s+)?(?:plot\s*-?\s*hooks?|hooks?|aufhänger|fäden|offene\s+fragen|lose\s+enden)\s*:?\s*$/iu;
const LOOT_HEAD = /^\s*(?:#+\s*)?(?:loot|beute|schätze?|fundstücke|ausbeute)\s*:?\s*$/iu;
/** „Bei den Toten fand die Gruppe:“ */
const LOOT_INTRO =
  /(?:fanden|fand|gefunden|durchsuchten|durchsucht|erbeutet|erbeuteten|plünderten|geplündert|gelootet|looten|lootet)[^:]{0,80}:\s*$/iu;
const ORDER_INTRO =
  /(?:in\s+auftrag|bestellt|bestellte|bestellen|bestellung|gibt\s+folgendes|gab\s+folgendes|lässt\s+anfertigen|ließ\s+anfertigen)[^:]{0,80}:\s*$/iu;
const WRITING_NOUNS =
  'brief|briefe|nachricht|botschaft|zettel|aushang|handout|handouts|inschrift|pergament|schriftrolle|tagebuch|tagebucheintrag|urkunde|erlass|gesetz|gesetzesauszug|auszug|schreiben|schriftstück|dokument|notiz|steckbrief|plakat|schild';
const WRITING_INTRO = new RegExp(
  `(?:(?:^|\\s)(?:stand|steht|standen|lautet|lautete|heißt es|hieß es|geschrieben|schrieb|schreibt)\\b[^:]{0,40}|(?:${WRITING_NOUNS})\\b[^:]{0,60}|^\\s*auf\\s+[\\p{L}-]+\\s*)[:]\\s*$`,
  'iu',
);
/** „Gesetzesauszug“, „Brief des Barons“ – eine Zeile, die ein Schriftstück ankündigt. */
const WRITING_LABEL = new RegExp(`^\\s*(?:#+\\s*)?(?:${WRITING_NOUNS})\\b[^.!?]{0,60}$`, 'iu');
const SPEECH_INTRO =
  /(?:fragte|fragt|antwortete|antwortet|sagte|sagt|rief|ruft|meinte|meint|erwiderte|flüsterte|sprach|schrie|brüllte|murmelte|kommentar dazu|kommentar|worte)\s*:\s*$/iu;
const OPEN_QUOTE = /^\s*[„“"»‚]/u;
const CLOSE_QUOTE = /[“”"«‘]\s*[.!?…]?\s*$/u;
/** „Brann,“ „Liebe Mira,“ – die Anrede eines Briefes. */
const SALUTATION =
  /^\s*(?:(?:liebe[rs]?|hallo|werte[rs]?|sehr\s+geehrte[rs]?)\s+)?\p{Lu}[\p{L}’' .-]{0,40},\s*$/u;
/** Gruß oder Unterschrift am Ende: „Grüße, Hagen“, „— O.“, „H.“ */
const CLOSING =
  /^\s*(?:(?:viele\s+|liebe\s+|herzliche\s+|beste\s+)?grüße|gruß|hochachtungsvoll|gezeichnet|gez\.|in\s+freundschaft|dein(?:e)?\s+\p{Lu}|euer?\s+\p{Lu}|eure\s+\p{Lu})\b.{0,40}$|^\s*[—–-]{1,2}\s*\p{Lu}[\p{L}.]{0,24}\s*[“”"«]?\s*$|^\s*\p{Lu}\.\s*[“”"«]?\s*$/iu;

/** Regelwerte: Stufenlisten von Zaubern, Würfel, Schwierigkeiten, Rüstungsklasse. */
const RULE =
  /^\s*(?:lv\.?|level|grad)\s*\d|^\s*\d+\s*(?:st|nd|rd|th)\s+level|\b(?:lair|legendary)\s+actions?\b|\b(?:AC|RK|DC|SG|HP|TP|TW)\s*\d|(?<![\p{L}\d])\d+\s*[WwDd]\s*\d+(?![\p{L}\d])|\+\s*(?:DEX|STR|CON|INT|WIS|CHA|GE|ST|KO|IN|WE|CH)\b/u;

/** Stufen einer Zauberliste: „Lv.1: …“, „2nd Level: …“ – immer Regelwerte. */
const SPELL_LEVEL = /^\s*(?:lv\.?|level|grad)\s*\d|^\s*\d+\s*(?:st|nd|rd|th)\s+level/iu;
const isRuleLine = (text: string) =>
  SPELL_LEVEL.test(text) || (RULE.test(text) && (!sentenceEnd(text) || wordCount(text) <= 10));
/** „Label: Wert“ ohne Satzende – Steckbrief- oder Werteform. */
const LABELED = /^\s*[\p{Lu}\d][^:]{0,40}:\s*\S.*$/u;
/** Eine Zeile, mit der ein eigener Abschnitt beginnt. */
const startsSection = (text: string) =>
  RECAP_HEAD.test(text) ||
  PLAIN_HEAD.test(text) ||
  HOOKS_HEAD.test(text) ||
  LOOT_HEAD.test(text) ||
  BULLET.test(text) ||
  /^\s*[#>]/.test(text) ||
  /:\s*$/.test(text);
/** Ein Bruchstück: kein Satz, kurz. */
const fragment = (text: string) => !sentenceEnd(text) && wordCount(text) <= 14;
/** Ein erzählender Satz: endet wie ein Satz und hat einige Wörter. */
const narrative = (text: string) => sentenceEnd(text) && wordCount(text) >= 6;
/** Kurze Zeile mit Doppelpunkt am Ende – kündigt eine Liste an. */
const colonHead = (text: string) => /:\s*$/.test(text) && wordCount(text) <= 6;

/** Münzen in einer Zeile: „74 Goldmünzen“, „38 Silber“, „1300 Gold“. */
const COINS =
  /^\s*(\d{1,3}(?:[.\s]\d{3})+|\d+)\s*(?:x\s*)?(goldmünzen|goldstücke|gold|gm|gp|silbermünzen|silberstücke|silber|sm|sp|kupfermünzen|kupferstücke|kupfer|km|cp|platinmünzen|platinstücke|platin|pm|pp)\.?\s*$/iu;

/** Wert in Gold: Silber zählt ein Zehntel, Kupfer ein Hundertstel, Platin zehnfach. */
export function coinGold(text: string): number | null {
  const match = COINS.exec(text);
  if (!match) return null;
  const amount = Number(match[1]!.replace(/[.\s]/g, ''));
  const unit = match[2]!.toLocaleLowerCase('de');
  if (/^(?:silber|sm|sp)/.test(unit)) return amount / 10;
  if (/^(?:kupfer|km|cp)/.test(unit)) return amount / 100;
  if (/^(?:platin|pm|pp)/.test(unit)) return amount * 10;
  return amount;
}

const PURCHASE = /^\s*(\p{Lu}[\p{L}’'-]+(?:\s+\p{Lu}[\p{L}’'-]+)?)\s*:\s*(.+?)\s*\(([^()]*)\)\s*$/u;
const PURCHASE_WORDS =
  /gekauft|geschenkt|bekommen|gegeben|getauscht|erhalten|bezahlt|erworben|geliehen|pfand/iu;

function purchaseRow(line: NoteLine): PurchaseRow | null {
  const match = PURCHASE.exec(line.text);
  if (!match || !PURCHASE_WORDS.test(match[3]!)) return null;
  return { line, who: match[1]!, item: match[2]!.trim(), note: match[3]!.trim() };
}

/** Eine Zeile mit einer Quelle einer Beuteliste: kurz, ohne Zahl, ohne Satzzeichen. */
const sourceHead = (text: string) =>
  wordCount(text) <= 3 && /^\s*\p{Lu}/u.test(text) && !/[\d:.,;!?()]/.test(text);

// ── Abschnitte ─────────────────────────────────────────────────────────────

/**
 * Liest den Aufbau der Notizen. Jede Zeile mit Text steht in genau einem Abschnitt; leere
 * Zeilen gehören zu keinem.
 */
export function noteBlocks(text: string): NoteBlock[] {
  const lines = noteLines(text);
  const blocks: NoteBlock[] = [];
  const n = lines.length;
  let i = 0;

  const nextFilled = (from: number, maxBlank = 3): number => {
    let j = from;
    let blanks = 0;
    while (j < n && blank(lines[j])) {
      blanks++;
      if (blanks > maxBlank) return -1;
      j++;
    }
    return j < n ? j : -1;
  };

  /** Rückblick am Anfang ohne Überschrift: Text in der zweiten Person Plural („ihr habt …“). */
  const SECOND =
    /(?<![\p{L}])(?:ihr|euch|euer|eure|euren|eurem|eurer|habt|seid|wart|fandet|trafet|kamt|gingt|saht)(?![\p{L}])/iu;
  const leading = (() => {
    const first = nextFilled(0, 5);
    if (first < 0) return -1;
    let j = first;
    let hits = 0;
    let count = 0;
    while (j < n && !blank(lines[j])) {
      count++;
      if (SECOND.test(lines[j]!.text)) hits++;
      j++;
    }
    return count >= 2 && hits >= 2 && hits / count >= 0.4 ? j : -1;
  })();

  while (i < n) {
    const line = lines[i]!;
    if (blank(line)) {
      i++;
      continue;
    }
    const t = line.text;

    // Rückblick: unter „Intro“ & Co. bis zu einer Überschrift oder zwei Leerzeilen.
    const recapHead = RECAP_HEAD.test(t);
    if (recapHead || (i === nextFilled(0, 5) && leading > 0)) {
      const body: NoteLine[] = [];
      let j = recapHead ? i + 1 : i;
      let blanks = 0;
      while (j < n) {
        const l = lines[j]!;
        if (blank(l)) {
          blanks++;
          if (blanks >= 2 && body.length) break;
          j++;
          continue;
        }
        if (PLAIN_HEAD.test(l.text) || HOOKS_HEAD.test(l.text) || LOOT_HEAD.test(l.text)) break;
        if (!recapHead && j >= leading) break;
        blanks = 0;
        body.push(l);
        j++;
      }
      blocks.push({
        kind: 'recap',
        head: recapHead ? line : null,
        lines: recapHead ? [line, ...body] : body,
      });
      i = j;
      continue;
    }

    if (PLAIN_HEAD.test(t)) {
      blocks.push({ kind: 'heading', lines: [line] });
      i++;
      continue;
    }

    // Offene Fäden: Überschrift und Aufzählung.
    if (HOOKS_HEAD.test(t) || /(?:plot\s*-?\s*hooks?|offene\s+fäden)\s*:\s*$/iu.test(t)) {
      const items: NoteLine[] = [];
      let j = i + 1;
      while (j < n) {
        const k = nextFilled(j, 1);
        if (k < 0) break;
        const l = lines[k]!;
        if (!BULLET.test(l.text) && !(fragment(l.text) && !colonHead(l.text))) break;
        if (!BULLET.test(l.text) && items.length && !BULLET.test(items[0]!.text)) {
          // ohne Aufzählungszeichen: nur kurze Zeilen direkt untereinander
          if (k !== j) break;
        }
        items.push(l);
        j = k + 1;
      }
      if (items.length) {
        blocks.push({ kind: 'hooks', head: line, items, lines: [line, ...items] });
        i = j;
        continue;
      }
    }

    // Einkäufe: Zeilen „Name: Gegenstand (gekauft für X)“, auch mit einleitendem Satz.
    {
      const first = colonHead(t) || /:\s*$/.test(t) ? nextFilled(i + 1, 1) : i;
      if (first >= 0 && purchaseRow(lines[first]!)) {
        const rows: PurchaseRow[] = [];
        let j = first;
        while (j < n) {
          const row = blank(lines[j]) ? null : purchaseRow(lines[j]!);
          if (!row) break;
          rows.push(row);
          j++;
        }
        const head = first === i ? null : line;
        blocks.push({
          kind: 'purchases',
          head,
          rows,
          lines: [...(head ? [head] : []), ...rows.map((row) => row.line)],
        });
        i = j;
        continue;
      }
    }

    // Beute: „Loot:“ oder „… fand die Gruppe:“ und die Liste darunter.
    if (LOOT_HEAD.test(t) || LOOT_INTRO.test(t)) {
      // Erst die Gruppen, wie Leerzeilen sie trennen …
      const raw: NoteLine[][] = [];
      let current: NoteLine[] | null = null;
      let j = i + 1;
      let lastFilled = i;
      while (j < n) {
        const l = lines[j]!;
        if (blank(l)) {
          if (j - lastFilled > 3) break;
          current = null;
          j++;
          continue;
        }
        if (narrative(l.text) || RECAP_HEAD.test(l.text) || HOOKS_HEAD.test(l.text)) break;
        // Regelwerte nach einer Leerzeile gehören nicht mehr zur Beute („Gifttrank, 2W4 Schaden“ in einer
        // Gruppe schon).
        if (isRuleLine(l.text) && j - lastFilled > 1) break;
        if (j - lastFilled > 1 && colonHead(l.text) && !LOOT_HEAD.test(l.text)) break;
        if (!current) raw.push((current = []));
        current.push(l);
        lastFilled = j++;
      }
      // … dann, ob jede Gruppe mit ihrer Quelle beginnt („Krummzahn“ über seinen Gegenständen).
      const isHeaded = (group: NoteLine[]) =>
        raw.length >= 2 && group.length >= 2 && sourceHead(group[0]!.text);
      const groups: LootGroup[] = raw.map((group) => ({
        source: isHeaded(group) ? group[0]! : null,
        // Stufen eines Zauberbuchs sind Einzelheiten zum Gegenstand darüber, keine eigene Beute.
        items: (isHeaded(group) ? group.slice(1) : group).filter((l) => !SPELL_LEVEL.test(l.text)),
      }));
      const filled = groups.filter((group) => group.items.length);
      if (filled.length) {
        const own: NoteLine[] = [line];
        for (const group of filled) {
          if (group.source) own.push(group.source);
          own.push(...group.items);
        }
        // Stufenzeilen eines Zauberbuchs stehen als Einzelheiten dabei.
        for (let k = i + 1; k < lastFilled + 1; k++)
          if (!blank(lines[k]) && !own.includes(lines[k]!)) own.push(lines[k]!);
        own.sort((a, b) => a.index - b.index);
        blocks.push({ kind: 'loot', head: line, groups: filled, lines: own });
        i = lastFilled + 1;
        continue;
      }
    }

    // Bestellung: „X gibt folgendes in Auftrag:“ und die Liste.
    if (ORDER_INTRO.test(t)) {
      const items: NoteLine[] = [];
      let j = i + 1;
      // Die Liste: kurze Zeilen ohne Satz – bis zu einer Überschrift oder einem Schriftstück.
      while (
        j < n &&
        !blank(lines[j]) &&
        fragment(lines[j]!.text) &&
        wordCount(lines[j]!.text) <= 8 &&
        !WRITING_LABEL.test(lines[j]!.text) &&
        !/^\s*[#>]/.test(lines[j]!.text) &&
        !colonHead(lines[j]!.text)
      )
        items.push(lines[j++]!);
      if (items.length) {
        blocks.push({ kind: 'order', head: line, items, lines: [line, ...items] });
        i = j;
        continue;
      }
    }

    // Zitat: „Brann fragte:“ und in einer der nächsten Zeilen das Gesagte in Anführungszeichen.
    if (SPEECH_INTRO.test(t)) {
      const k = nextFilled(i + 1, 3);
      const said = k >= 0 ? lines[k]! : null;
      if (said && OPEN_QUOTE.test(said.text) && CLOSE_QUOTE.test(said.text)) {
        blocks.push({ kind: 'quote', intro: line, said, lines: [line, said] });
        i = k + 1;
        continue;
      }
    }

    // Schriftstück mit Kennzeichnung und Zitatblock („Gesetzesauszug“, „## …“, „> …“).
    if (/^\s*>/.test(t) || (WRITING_LABEL.test(t) && !sentenceEnd(t))) {
      const label = /^\s*>/.test(t) ? null : line;
      let j = label ? i + 1 : i;
      let title = label ? label.text.replace(/^\s*#+\s*/, '').trim() : '';
      const body: NoteLine[] = [];
      const head = j < n && /^\s*#{1,6}\s+\S/.test(lines[j]!.text) ? lines[j]! : null;
      if (head) {
        title = head.text.replace(/^\s*#+\s*/, '').trim();
        body.push(head);
        j++;
      }
      while (j < n && /^\s*>/.test(lines[j]!.text)) body.push(lines[j++]!);
      if (body.some((l) => /^\s*>/.test(l.text))) {
        blocks.push({
          kind: 'writing',
          intro: label,
          body,
          title: cleanTitle(title),
          lines: [...(label ? [label] : []), ...body],
        });
        i = j;
        continue;
      }
    }

    // Schriftstück nach einer Einleitung („Dort stand:“) bis zu Gruß oder Unterschrift.
    if (WRITING_INTRO.test(t) && !LOOT_INTRO.test(t)) {
      const start = nextFilled(i + 1, 2);
      if (start >= 0) {
        const body = untilClosing(lines, start, 25);
        if (body) {
          blocks.push({
            kind: 'writing',
            intro: line,
            body,
            title: '',
            lines: [line, ...body],
          });
          i = body[body.length - 1]!.index + 1;
          continue;
        }
      }
    }

    // Brief mit Anrede („Brann,“) bis zum Gruß.
    if (SALUTATION.test(t) && !/^\s*(?:und|aber|doch)\b/iu.test(t)) {
      const body = untilClosing(lines, i, 25);
      if (body && body.length >= 3) {
        const previous = blocks[blocks.length - 1];
        const intro =
          previous?.kind === 'text' && new RegExp(WRITING_NOUNS, 'iu').test(previous.lines[0]!.text)
            ? previous.lines[0]!
            : null;
        if (intro) blocks.pop();
        blocks.push({
          kind: 'writing',
          intro,
          body,
          title: '',
          lines: [...(intro ? [intro] : []), ...body],
        });
        i = body[body.length - 1]!.index + 1;
        continue;
      }
    }

    // Mehrzeiliges Zitat: „… über mehrere Zeilen … — K.“
    if (OPEN_QUOTE.test(t) && !CLOSE_QUOTE.test(t)) {
      let j = i + 1;
      while (j < n && j - i < 25 && !CLOSE_QUOTE.test(lines[j]!.text)) j++;
      if (j < n && j - i < 25) {
        const body = lines.slice(i, j + 1).filter((l) => !blank(l));
        blocks.push({ kind: 'writing', intro: null, body, title: '', lines: body });
        i = j + 1;
        continue;
      }
    }

    // Regelwerte und was ohne Leerzeile darunter in derselben Form folgt.
    if (isRuleLine(t)) {
      const own = [line];
      let j = i + 1;
      while (
        j < n &&
        !blank(lines[j]) &&
        (isRuleLine(lines[j]!.text) || (fragment(lines[j]!.text) && !startsSection(lines[j]!.text)))
      )
        own.push(lines[j++]!);
      blocks.push({ kind: 'rules', lines: own });
      i = j;
      continue;
    }

    // Kurze Überschrift mit Doppelpunkt und Bruchstücke darunter („Brann Rüstung:“).
    if (colonHead(t)) {
      const own: NoteLine[] = [];
      let j = i + 1;
      while (j < n && !blank(lines[j]) && fragment(lines[j]!.text) && !colonHead(lines[j]!.text))
        own.push(lines[j++]!);
      if (own.length) {
        const rules = own.some((l) => isRuleLine(l.text));
        blocks.push(
          rules
            ? { kind: 'rules', lines: [line, ...own] }
            : { kind: 'list', head: line, lines: [line, ...own] },
        );
        i = j;
        continue;
      }
      blocks.push({ kind: 'heading', lines: [line] });
      i++;
      continue;
    }

    // Steckbriefzeilen „Name: Wert“ ohne Satz.
    if (LABELED.test(t) && fragment(t) && wordCount(t) <= 8 && !/[.!?]\s*$/.test(t)) {
      const own = [line];
      let j = i + 1;
      while (
        j < n &&
        !blank(lines[j]) &&
        LABELED.test(lines[j]!.text) &&
        fragment(lines[j]!.text) &&
        !purchaseRow(lines[j]!)
      )
        own.push(lines[j++]!);
      blocks.push({ kind: 'list', head: null, lines: own });
      i = j;
      continue;
    }

    blocks.push({ kind: 'text', lines: [line] });
    i++;
  }
  return blocks;
}

/** Die Zeilen ab `start` bis zu einem Gruß oder einer Unterschrift (einschließlich); null ohne. */
function untilClosing(lines: NoteLine[], start: number, max: number): NoteLine[] | null {
  const body: NoteLine[] = [];
  let blanks = 0;
  for (let j = start; j < lines.length && j - start < max; j++) {
    const l = lines[j]!;
    if (blank(l)) {
      blanks++;
      if (blanks >= 2) return null;
      continue;
    }
    blanks = 0;
    body.push(l);
    if (j > start && CLOSING.test(l.text)) return body;
    if (j === start && CLOSING.test(l.text) && !SALUTATION.test(l.text)) return body;
  }
  return null;
}

/** Ein Titel ohne Markdown-Zeichen und Sternchen. */
function cleanTitle(text: string): string {
  return text
    .replace(/^\s*[#>]+\s*/, '')
    .replace(/\*\*|__|\*/g, '')
    .replace(/[:\s]+$/, '')
    .trim();
}

/** Der Wortlaut eines Abschnitts: seine Zeilen, wie sie dastehen. */
export const blockText = (lines: NoteLine[]) => lines.map((line) => line.text).join('\n');

/** Der Rückblick für die Spieler – wörtlich, ohne die Überschrift „Intro“. */
export function recapOf(blocks: NoteBlock[]): string {
  return blocks
    .filter((block): block is Extract<NoteBlock, { kind: 'recap' }> => block.kind === 'recap')
    .map((block) => blockText(block.lines.filter((line) => line !== block.head)).trim())
    .filter(Boolean)
    .join('\n\n');
}

const SMALL = new Set([
  'von',
  'vom',
  'an',
  'des',
  'der',
  'die',
  'das',
  'und',
  'aus',
  'für',
  'im',
  'am',
  'zu',
  'zur',
  'zum',
  'auf',
]);

/** „NACHRICHT VON HAGEN BRACK“ → „Nachricht von Hagen Brack“. */
export function titleCase(text: string): string {
  if (text !== text.toLocaleUpperCase('de')) return text;
  return text
    .toLocaleLowerCase('de')
    .split(/(\s+)/)
    .map((word, index) =>
      index > 0 && SMALL.has(word) ? word : word.charAt(0).toLocaleUpperCase('de') + word.slice(1),
    )
    .join('');
}

const NOUN_PHRASE = new RegExp(
  `(?<![\\p{L}])(${WRITING_NOUNS})(?![\\p{L}])((?:\\s+(?:von|vom|des|der|an)\\s+(?:dem\\s+|der\\s+)?\\p{Lu}[\\p{L}’'-]*(?:\\s+\\p{Lu}[\\p{L}’'-]*)?)?)`,
  'iu',
);

/**
 * Titel eines Schriftstücks aus seiner Einleitung: „… fand einen Brief von Odo“ →
 * „Brief von Odo“. Sonst aus der Unterschrift („— O.“ → „Schriftstück von O.“).
 */
export function writingTitle(
  block: Extract<NoteBlock, { kind: 'writing' }>,
  before: string,
): string {
  if (block.title) return block.title;
  const base = baseTitle(block, before);
  // „Dort stand auf Zwergisch:“, „Auf Elfisch:“ – die Sprache gehört zum Titel.
  const language = /(?:^|\s)auf\s+([\p{L}-]+)\s*:\s*$/iu.exec(block.intro?.text ?? '')?.[1];
  return language ? `${base} (${language})` : base;
}

function baseTitle(block: Extract<NoteBlock, { kind: 'writing' }>, before: string): string {
  const last = block.body[block.body.length - 1]?.text ?? '';
  const sign = /^\s*(?:[—–-]{1,2}\s*)?(\p{Lu}[\p{L}.]{0,24})\s*[“”"«]?\s*$/u.exec(last)?.[1];
  for (const source of [block.intro?.text ?? '', before]) {
    const plain = titleCase(source.trim());
    const match = NOUN_PHRASE.exec(plain);
    if (!match) continue;
    const noun = match[1]!;
    const head = noun.charAt(0).toLocaleUpperCase('de') + noun.slice(1);
    const from = match[2]?.trim() ? match[2] : sign ? ` von ${sign}` : '';
    return `${head}${from}`.trim();
  }
  if (sign) return `Schriftstück von ${sign}`;
  const greeting =
    /^\s*(?:(?:viele\s+|liebe\s+|herzliche\s+|beste\s+)?grüße|gruß)\s*,?\s*(\p{Lu}[\p{L}]+)/iu.exec(
      last,
    );
  if (greeting) return `Brief von ${greeting[1]}`;
  return 'Schriftstück';
}
