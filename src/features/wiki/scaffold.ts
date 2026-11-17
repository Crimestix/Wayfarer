/**
 * Steckbrief-Gerüste: je Art eines Eintrags die Felder, die ein neuer Artikel leer bekommt
 * („> Geboren: “). Nur Feldnamen, nie ein Wert – geschrieben wird vom Spielleiter. Die Vorgaben
 * nehmen Bezeichnungen, die Wayfarer liest (`VOCABULARY` in `facts.ts`), dazu ein paar, die nur
 * beim Schreiben helfen. Der Spielleiter kann jedes Gerüst in den Einstellungen ändern; eigene
 * Felder sind erlaubt – Wayfarer wertet sie dann nur nicht aus. Ein Gerüst ist ein Hinweis, nie
 * eine Pflicht: Was im Steckbrief fehlt, wird leise genannt, nie verlangt. Reine Funktionen.
 */
import type { Article, CampaignData, CampaignMeta, EntityKind } from '../../domain/schema';
import { steckbriefLabels } from './factLines';
import { articleFacts, factField, statedKind, worldIndex, type FactField } from './facts';
import { pageText } from './text';

/** Arten, für die es ein Gerüst gibt – in der Reihenfolge der Einstellungen. */
export const SCAFFOLD_KINDS = [
  'person',
  'place',
  'faction',
  'family',
  'item',
  'plant',
  'animal',
  'mineral',
  'profession',
  'species',
  'language',
  'script',
  'ability',
  'topic',
  'deity',
  'realm',
  'happening',
] as const satisfies readonly EntityKind[];
export type ScaffoldKind = (typeof SCAFFOLD_KINDS)[number];

const NATURE = ['Art', 'Lebensraum', 'Gegend', 'Jahreszeit', 'Seltenheit', 'Preis'];

/** Die Vorgaben. Felder, die Wayfarer nicht liest (Einwohner, Ziele …), helfen nur beim Schreiben. */
export const DEFAULT_SCAFFOLDS: Record<ScaffoldKind, readonly string[]> = {
  person: ['Volk', 'Geboren', 'Herkunft', 'Wohnort', 'Beruf', 'Familie', 'Fraktion'],
  place: ['Art', 'Liegt in', 'Herrscher', 'Einwohner', 'Gegründet'],
  faction: ['Art', 'Anführer', 'Sitz', 'Gegründet', 'Ziele'],
  family: ['Oberhaupt', 'Sitz', 'Gegründet'],
  item: ['Art', 'Besitzer', 'Herkunft', 'Preis'],
  plant: NATURE,
  animal: NATURE,
  mineral: NATURE,
  profession: ['Art', 'Werkzeug'],
  species: ['Art', 'Heimat', 'Sprache'],
  language: ['Art', 'Gesprochen in'],
  script: ['Art'],
  ability: ['Art'],
  topic: ['Art'],
  deity: ['Art', 'Domänen', 'Tempel'],
  realm: ['Art', 'Herrscher', 'Hauptstadt', 'Gebiet', 'Gegründet'],
  happening: ['Art', 'Beginn', 'Ende', 'Ort'],
};

export const isScaffoldKind = (kind: string): kind is ScaffoldKind =>
  (SCAFFOLD_KINDS as readonly string[]).includes(kind);

/** Höchstens so viele Felder je Gerüst, je Feld höchstens so viele Zeichen. */
export const SCAFFOLD_MAX = 30;
const LABEL_MAX = 60;

/** Eine Bezeichnung, wie sie im Steckbrief stehen kann: eine Zeile, ohne Doppelpunkt. */
export const cleanLabel = (label: string): string =>
  label
    .replace(/[:\n\r>[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LABEL_MAX)
    .trim();

/** Bezeichnungen ohne Leeres und ohne Doppeltes (ohne Groß- und Kleinschreibung verglichen). */
export function cleanLabels(labels: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of labels) {
    const label = cleanLabel(raw);
    const key = label.toLocaleLowerCase('de');
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
    if (out.length >= SCAFFOLD_MAX) break;
  }
  return out;
}

/** Liest eine Eingabe „ein Feld je Zeile“ (oder durch Komma getrennt) als Gerüst. */
export const readScaffoldInput = (input: string): string[] => cleanLabels(input.split(/[\n,;]/));

/** Das Gerüst einer Art: das des Spielleiters, sonst die Vorgabe. Eine Art ohne Gerüst: leer. */
export function scaffoldOf(
  campaign: Pick<CampaignMeta, 'factScaffolds'>,
  kind: EntityKind,
): string[] {
  const own = campaign.factScaffolds[kind];
  if (own) return cleanLabels(own);
  return isScaffoldKind(kind) ? [...DEFAULT_SCAFFOLDS[kind]] : [];
}

/** Weicht das Gerüst dieser Art von der Vorgabe ab? */
export function isOwnScaffold(campaign: Pick<CampaignMeta, 'factScaffolds'>, kind: ScaffoldKind) {
  const own = campaign.factScaffolds[kind];
  if (!own) return false;
  const a = cleanLabels(own);
  const b = DEFAULT_SCAFFOLDS[kind];
  return a.length !== b.length || a.some((label, i) => label !== b[i]);
}

/**
 * Was die Einstellungen speichern, wenn der Spielleiter das Gerüst einer Art ändert: Gleicht es
 * der Vorgabe, fällt der eigene Stand weg (dann gilt eine spätere bessere Vorgabe von selbst).
 */
export function withScaffold(
  scaffolds: CampaignMeta['factScaffolds'],
  kind: ScaffoldKind,
  labels: readonly string[] | null,
): CampaignMeta['factScaffolds'] {
  const next = { ...scaffolds };
  const clean = labels ? cleanLabels(labels) : null;
  const same =
    clean &&
    clean.length === DEFAULT_SCAFFOLDS[kind].length &&
    clean.every((label, i) => label === DEFAULT_SCAFFOLDS[kind][i]);
  if (!clean || same) delete next[kind];
  else next[kind] = clean;
  return next;
}

/** Liest Wayfarer dieses Feld bei dieser Art – und als was? null = nur für den Spielleiter. */
export const readsAs = (kind: EntityKind, label: string): FactField | null =>
  factField(kind, label);

/** Der Steckbrief eines neuen Artikels: der Kasten mit leeren Feldern. Leer ohne Felder. */
export function scaffoldText(labels: readonly string[]): string {
  const clean = cleanLabels(labels);
  if (!clean.length) return '';
  return ['> [!steckbrief]', ...clean.map((label) => `> ${label}: `)].join('\n') + '\n\n';
}

const fold = (label: string) => cleanLabel(label).toLocaleLowerCase('de');

/**
 * Die Felder des Gerüsts, die im Steckbrief noch nicht stehen – weder leer noch ausgefüllt.
 * Ein Feld gilt als vorhanden, wenn dieselbe Bezeichnung dasteht oder eine andere, die Wayfarer
 * genauso liest („Spezies“ statt „Volk“, „Alter“ statt „Geboren“). Lesen zwei Felder des Gerüsts
 * dasselbe („Familie“ und „Fraktion“ sind beide Zugehörigkeit), zählt nur die gleiche Bezeichnung.
 */
export function missingScaffold(
  kind: EntityKind,
  labels: readonly string[],
  scaffold: readonly string[],
): string[] {
  const present = new Set(labels.map(fold));
  const presentFields = new Set(
    labels.map((label) => factField(kind, label)).filter((f): f is FactField => f !== null),
  );
  const fieldCount = new Map<FactField, number>();
  for (const label of scaffold) {
    const field = factField(kind, label);
    if (field) fieldCount.set(field, (fieldCount.get(field) ?? 0) + 1);
  }
  return cleanLabels(scaffold).filter((label) => {
    if (present.has(fold(label))) return false;
    const field = factField(kind, label);
    if (field && fieldCount.get(field) === 1 && presentFields.has(field)) return false;
    return true;
  });
}

/** Schlüssel in `article.dismissedHints`: „Im Steckbrief fehlt noch …“ ist ausgeblendet. */
export const SCAFFOLD_HINT = 'steckbrief-geruest';

/**
 * Was im Steckbrief eines Artikels nach dem Gerüst seiner Art noch fehlt. Die Art ist die seines
 * Eintrags in der Welt, sonst die, die sein Steckbrief verrät. Null, wenn es nichts zu sagen gibt:
 * keine Art, kein Gerüst, nichts fehlt, eine Vorlage – oder der Spielleiter hat es ausgeblendet.
 */
export function articleScaffoldGap(
  data: CampaignData,
  article: Article,
): { kind: EntityKind; missing: string[] } | null {
  if (article.template || article.dismissedHints.includes(SCAFFOLD_HINT)) return null;
  const doc = article.docs.find((d) => d.kind === 'page');
  if (!doc) return null;
  const kind =
    worldIndex(data).byArticle.get(article.id)?.[0]?.kind ??
    statedKind(articleFacts(data.articles, article))?.kind ??
    null;
  if (!kind) return null;
  // Die Felder des Steckbriefs, auch leere – dazu alles, was anderswo im Artikel als Feld steht
  // (ein zweiter Kasten, eine weitere Seite): Was schon dasteht, fehlt nicht.
  const labels = [
    ...steckbriefLabels(pageText(data.articles, article, doc)),
    ...articleFacts(data.articles, article).map((fact) => fact.label),
  ];
  const missing = missingScaffold(kind, labels, scaffoldOf(data.campaign, kind));
  return missing.length ? { kind, missing } : null;
}
