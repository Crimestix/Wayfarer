/**
 * Namen aus LegendKeeper nachtragen.
 *
 * Die alte Wayfarer-Version kannte viele Personen nur als Verweis auf einen LegendKeeper-Artikel;
 * ihr Name stand nicht im Backup. Nach der Übernahme tragen sie einen vorläufigen Namen und das
 * Schlagwort „Name fehlt“. Sobald das Artikelverzeichnis von LegendKeeper vorliegt, lassen sich
 * die Namen daraus ergänzen. Reine Funktionen – gelesen wird das Verzeichnis woanders.
 */
import type { CampaignData, Entity } from '../../domain/schema';
import { MISSING_NAME_TAG, MISSING_NAME_TAGLINE, placeholderName, type ImportResult } from './v157';

/** Was das Artikelverzeichnis zu einem Artikel weiß. */
export interface LkArticleName {
  title: string;
  aliases?: readonly string[];
}

/** Artikel nach ihrer Kennung in LegendKeeper. */
export type LkNames = ReadonlyMap<string, LkArticleName>;

/** Baut die Nachschlagetabelle aus den Einträgen des Artikelverzeichnisses. */
export function namesFromCatalog(
  entries: readonly { id: string; title: string; aliases?: readonly string[] }[],
): LkNames {
  return new Map(entries.map((e) => [e.id, { title: e.title, aliases: e.aliases }]));
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Einträge, die noch auf ihren Namen aus LegendKeeper warten. */
export function unnamedFromLk(data: CampaignData): Entity[] {
  return Object.values(data.entities).filter(
    (e) => e.lk !== null && e.tags.includes(MISSING_NAME_TAG),
  );
}

export interface NameFixes {
  /** Geänderte Einträge, fertig zum Speichern. */
  changed: Entity[];
  /** Einträge, die jetzt ihren Namen tragen. */
  named: number;
  /** Einträge, zu denen es in LegendKeeper keinen Artikel (mehr) gibt. */
  notFound: number;
}

/**
 * Ergänzt die Namen aller Einträge mit dem Schlagwort „Name fehlt“ aus dem Artikelverzeichnis.
 * Ein von Hand vergebener Name bleibt stehen; dann fällt nur das Schlagwort weg. Zweitnamen des
 * Artikels kommen zu den „auch bekannt als“ dazu. Bei allen übrigen verknüpften Einträgen wird
 * ein fehlender Artikeltitel in der Verknüpfung ergänzt.
 */
export function nameFixes(data: CampaignData, names: LkNames): NameFixes {
  const changed: Entity[] = [];
  let named = 0;
  let notFound = 0;
  for (const entity of Object.values(data.entities)) {
    if (!entity.lk) continue;
    const waiting = entity.tags.includes(MISSING_NAME_TAG);
    const article = names.get(entity.lk.resourceId);
    const title = article?.title.trim() ?? '';
    if (!title) {
      if (waiting) notFound++;
      continue;
    }
    if (!waiting) {
      if (!entity.lk.title) changed.push({ ...entity, lk: { ...entity.lk, title } });
      continue;
    }
    const keepsOwnName = entity.name !== placeholderName(entity.lk.resourceId);
    const name = keepsOwnName ? entity.name : title;
    const aliases = [...entity.aliases];
    for (const alias of [...(keepsOwnName ? [title] : []), ...(article?.aliases ?? [])]) {
      const clean = alias.trim();
      if (clean && !sameText(clean, name) && !aliases.some((a) => sameText(a, clean)))
        aliases.push(clean);
    }
    changed.push({
      ...entity,
      name,
      aliases,
      tagline: entity.tagline === MISSING_NAME_TAGLINE ? '' : entity.tagline,
      tags: entity.tags.filter((tag) => tag !== MISSING_NAME_TAG),
      lk: { ...entity.lk, title },
    });
    named++;
  }
  return { changed, named, notFound };
}

/** Der Spielstand mit den ergänzten Namen. */
export function applyNameFixes(data: CampaignData, fixes: NameFixes): CampaignData {
  if (!fixes.changed.length) return data;
  const entities = { ...data.entities };
  for (const entity of fixes.changed) entities[entity.id] = entity;
  return { ...data, entities };
}

/**
 * Trägt die Namen schon bei der Übernahme ein, wenn das Artikelverzeichnis gerade vorliegt, und
 * sagt das im Bericht – dort, wo sonst vom Schlagwort „Name fehlt“ die Rede ist. Ohne Treffer
 * bleibt das Ergebnis unverändert.
 */
export function withLkNames(result: ImportResult, names: LkNames): ImportResult {
  const fixes = nameFixes(result.data, names);
  if (!fixes.named) return result;
  const one = fixes.named === 1;
  const adopted = [...result.sections.adopted];
  const at = adopted.findIndex((sentence) => sentence.includes(`„${MISSING_NAME_TAG}“`));
  if (fixes.notFound === 0) {
    // Niemand wartet mehr auf einen Namen: Der Satz über das Schlagwort wäre jetzt falsch.
    const line =
      `${one ? '1 Person' : `${fixes.named} Personen`} kannte die alte Version nur als Verweis auf einen LegendKeeper-Artikel. ` +
      `${one ? 'Sie wurde' : 'Sie wurden'} mit dieser Verknüpfung angelegt; ${one ? 'ihr Name stammt' : 'ihre Namen stammen'} aus dem Artikelverzeichnis von LegendKeeper.`;
    adopted.splice(at < 0 ? adopted.length : at, at < 0 ? 0 : 1, line);
  } else {
    const line =
      `Davon ${one ? 'hat 1 Person' : `haben ${fixes.named} Personen`} den Namen gleich aus dem Artikelverzeichnis von LegendKeeper erhalten und ${one ? 'braucht' : 'brauchen'} das Schlagwort nicht mehr; ` +
      `zu ${fixes.notFound === 1 ? '1 weiteren' : `${fixes.notFound} weiteren`} gibt es dort keinen Artikel.`;
    adopted.splice(at < 0 ? adopted.length : at + 1, 0, line);
  }
  const sections = { ...result.sections, adopted };
  return {
    data: applyNameFixes(result.data, fixes),
    sections,
    report: [...sections.adopted, ...sections.hints, ...sections.omitted, ...sections.skipped],
  };
}
