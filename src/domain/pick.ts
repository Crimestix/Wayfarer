/**
 * Auswählen und Anlegen in einem: was die Auswahl eines Eintrags (`EntityPicker`) und das „@“ im
 * Text unter dem Suchfeld zeigen – die Treffer, dann „neu als …“ – und was die Eingabetaste tut.
 * Grundsatz: Arten helfen beim Finden und Vorschlagen, sie schränken nie ein. Reine Funktionen;
 * angelegt wird über `addFromWriting` (`features/welt/writing.ts`).
 */
import { searchEntities } from './derive';
import { ENTITY_KINDS, type CampaignData, type Entity, type EntityKind } from './schema';

/** Die ersten Arten zum Anlegen, wenn ein Feld keine eigenen nennt. */
const COMMON_KINDS: readonly EntityKind[] = [
  'person',
  'place',
  'faction',
  'family',
  'item',
  'topic',
];

/**
 * Als was sich beim Schreiben etwas anlegen lässt: jede Art der Welt, die üblichen zuerst.
 * Gefährten haben ihren eigenen Bereich und entstehen dort.
 */
export const CREATE_KINDS: readonly EntityKind[] = [
  ...COMMON_KINDS,
  ...ENTITY_KINDS.filter((kind) => kind !== 'character' && !COMMON_KINDS.includes(kind)),
];

/** Wie viele Arten ein Feld ohne eigene Arten gleich anbietet, bevor „andere Art …“ kommt. */
const FIRST_KINDS = 4;

/** Namen vergleichen sich ohne Groß- und Kleinschreibung und ohne doppelte Leerzeichen. */
export const nameKey = (name: string): string =>
  name.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de');

/** Trägt der Eintrag genau diesen Namen oder Zweitnamen? */
export const hasName = (entity: Entity, key: string): boolean =>
  key !== '' && (nameKey(entity.name) === key || entity.aliases.some((a) => nameKey(a) === key));

/** Die Arten, die „neu als …“ zuerst anbietet, und die übrigen hinter „andere Art …“. */
export function createKinds(kinds?: readonly EntityKind[]): {
  first: EntityKind[];
  more: EntityKind[];
} {
  const own = (kinds ?? []).filter((kind) => CREATE_KINDS.includes(kind));
  const first = own.length
    ? CREATE_KINDS.filter((kind) => own.includes(kind))
    : CREATE_KINDS.slice(0, FIRST_KINDS);
  return { first, more: CREATE_KINDS.filter((kind) => !first.includes(kind)) };
}

export type PickRow =
  | { type: 'party' }
  /**
   * Ein Treffer. `foreign`: Er steht nur da, weil er genau so heißt – das Feld bietet seine Art
   * sonst nicht an.
   */
  | { type: 'entity'; entity: Entity; foreign: boolean }
  /** Den Namen gibt es schon, aber das Feld verträgt seine Art nicht: nur ein Hinweis. */
  | { type: 'taken'; entity: Entity }
  /** „„X“ neu als Person“. */
  | { type: 'create'; kind: EntityKind }
  /** „andere Art …“ – klappt die übrigen Arten auf. */
  | { type: 'more' }
  /** „„X“ neu anlegen“ – der alte Weg, bei dem der Aufrufer die Art festlegt. */
  | { type: 'legacy' };

export interface PickInput {
  query: string;
  /** Die Arten des Feldes: zuerst gesucht und zuerst zum Anlegen angeboten. */
  kinds?: readonly EntityKind[] | undefined;
  exclude?: readonly string[] | undefined;
  allowParty?: boolean | undefined;
  /** Fehlendes lässt sich anlegen – mit Wahl der Art. */
  create?: boolean | undefined;
  /** Das Feld verträgt nur seine Arten (ein Ort bei „Wo?“). */
  onlyKinds?: boolean | undefined;
  /** „andere Art …“ ist aufgeklappt. */
  moreOpen?: boolean | undefined;
  /** Der alte Weg `onCreate` ist da. */
  legacy?: boolean | undefined;
  limit?: number | undefined;
  /** Eigene Treffer statt der Suche (das „@“ am Spieltisch zeigt zuerst, wer am Ort ist). */
  hits?: readonly Entity[] | undefined;
}

/** Die Zeilen der Auswahl, von oben nach unten. */
export function pickRows(data: CampaignData, input: PickInput): PickRow[] {
  const name = input.query.replace(/\s+/g, ' ').trim();
  const key = nameKey(name);
  const kinds = input.kinds?.length ? input.kinds : undefined;
  const excluded = (id: string) => input.exclude?.includes(id) ?? false;
  const rows: PickRow[] = [];
  if (input.allowParty && !name) rows.push({ type: 'party' });

  const hits =
    input.hits ??
    searchEntities(data, input.query, {
      ...(kinds ? { kinds: [...kinds] } : {}),
      limit: input.limit ?? 40,
    });
  const shown = hits.filter((entity) => !excluded(entity.id));
  for (const entity of shown) rows.push({ type: 'entity', entity, foreign: false });
  if (!name) return rows;

  // Wer genau so heißt – auch mit einer Art, die das Feld sonst nicht anbietet.
  const named = Object.values(data.entities)
    .filter((entity) => hasName(entity, key))
    .sort((a, b) => a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id));
  if (input.create)
    for (const entity of named) {
      if (excluded(entity.id) || shown.some((hit) => hit.id === entity.id)) continue;
      rows.push(
        input.onlyKinds ? { type: 'taken', entity } : { type: 'entity', entity, foreign: true },
      );
    }

  // Nie ein zweiter Eintrag für einen Namen: Angelegt wird nur, was es noch nicht gibt.
  if (input.create && !named.length) {
    const { first, more } = createKinds(kinds);
    for (const kind of first) rows.push({ type: 'create', kind });
    if (more.length) {
      rows.push({ type: 'more' });
      if (input.moreOpen) for (const kind of more) rows.push({ type: 'create', kind });
    }
  } else if (!input.create && input.legacy && !shown.some((entity) => hasName(entity, key)))
    rows.push({ type: 'legacy' });
  return rows;
}

/** Lässt sich die Zeile mit den Pfeiltasten markieren und nehmen? */
export const isChoice = (row: PickRow): boolean => row.type !== 'taken';

/** Die nächste markierbare Zeile; von „nichts markiert“ aus die erste bzw. letzte. */
export function moveMark(
  rows: readonly PickRow[],
  marked: number | null,
  step: 1 | -1,
): number | null {
  const choices = rows.map((row, index) => (isChoice(row) ? index : -1)).filter((i) => i >= 0);
  if (!choices.length) return null;
  const at = marked === null ? -1 : choices.indexOf(marked);
  if (at < 0) return step > 0 ? choices[0]! : choices[choices.length - 1]!;
  return choices[(at + step + choices.length) % choices.length]!;
}

export type EnterAction =
  | { type: 'pick'; id: string }
  | { type: 'party' }
  /** Das kleine Formular zum Anlegen öffnen. */
  | { type: 'create'; kind: EntityKind }
  | { type: 'more' }
  | { type: 'legacy' }
  | { type: 'none' };

/** Was ein Klick auf die Zeile (oder die Eingabetaste auf der markierten) tut. */
export function rowAction(row: PickRow | undefined): EnterAction {
  if (!row || row.type === 'taken') return { type: 'none' };
  if (row.type === 'entity') return { type: 'pick', id: row.entity.id };
  if (row.type === 'create') return { type: 'create', kind: row.kind };
  return { type: row.type };
}

/**
 * Was die Eingabetaste in der Auswahl tut. Sie nimmt nur die mit den Pfeiltasten markierte Zeile
 * oder den einen Eintrag, der genau so heißt – nie einen, der nur ähnlich heißt oder nur über
 * seine Kurzbeschreibung passt. Ohne beides öffnet sie das Anlegen mit der ersten Art des Feldes,
 * wenn sich hier anlegen lässt; sonst tut sie nichts.
 */
export function enterAction(
  rows: readonly PickRow[],
  marked: number | null,
  query: string,
): EnterAction {
  if (marked !== null) return rowAction(rows[marked]);
  const key = nameKey(query);
  if (!key) return { type: 'none' };
  const exact = rows.filter(
    (row): row is Extract<PickRow, { type: 'entity' }> =>
      row.type === 'entity' && hasName(row.entity, key),
  );
  if (exact.length === 1) return { type: 'pick', id: exact[0]!.entity.id };
  if (exact.length > 1) return { type: 'none' };
  const create = rows.find((row) => row.type === 'create');
  if (create) return rowAction(create);
  // Der alte Weg legt nur an, wenn sonst nichts zur Wahl steht.
  if (rows.length === 1 && rows[0]!.type === 'legacy') return { type: 'legacy' };
  return { type: 'none' };
}

/**
 * Welche Zeile beim „@“ im Text markiert ist: Dort ist der erste Treffer von selbst markiert (wer
 * „@“ tippt, will verknüpfen). Ohne Treffer ist nichts markiert – die Eingabetaste gehört dann
 * dem Feld (festhalten, neue Zeile), und „neu als …“ erreicht man mit den Pfeiltasten oder einem
 * Klick.
 */
export function mentionMark(rows: readonly PickRow[], marked: number | null): number | null {
  if (marked !== null && rows[marked] && isChoice(rows[marked])) return marked;
  return rows[0]?.type === 'entity' ? 0 : null;
}
