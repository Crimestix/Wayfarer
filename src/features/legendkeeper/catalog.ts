/**
 * Das Verzeichnis aller LegendKeeper-Artikel: Titel, Platz im Baum, Schlagworte. Daraus entstehen
 * die Suche nach Titeln (sofort, ohne Netz) und die Vorschläge zu einem Eintragsnamen.
 * Reine Funktionen.
 */
import type { LkResourceListItem } from './types';

export interface CatalogEntry {
  id: string;
  title: string;
  parentId: string | null;
  tags: string[];
  aliases: string[];
  /** In LegendKeeper vor den Spielern verborgen. */
  hidden: boolean;
  /** Zum Vergleichen aufbereiteter Titel. */
  key: string;
  aliasKeys: string[];
  tagKeys: string[];
}

export interface Catalog {
  entries: CatalogEntry[];
  byId: Map<string, CatalogEntry>;
}

export interface CatalogHit {
  entry: CatalogEntry;
  /** Titel der übergeordneten Artikel von der Wurzel abwärts. */
  path: string[];
  score: number;
}

/** Unter diesem gedachten Artikel hängen in LegendKeeper die Vorlagen. */
const TEMPLATE_ROOT = 'templates';

/** Kleinschreibung, ohne Akzente und Satzzeichen – damit „Krähenmoor“ auch „kraehenmoor“ findet. */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const words = (key: string): string[] => (key ? key.split(' ') : []);

/** Baut das Verzeichnis. Vorlagen (und alles darunter) gehören nicht zur Welt und entfallen. */
export function buildCatalog(items: LkResourceListItem[]): Catalog {
  const parents = new Map<string, string | null>();
  for (const item of items) {
    if (item && typeof item.id === 'string') parents.set(item.id, item.parentId ?? null);
  }
  const isTemplate = (id: string): boolean => {
    let current: string | null = id;
    for (let step = 0; current && step < 100; step += 1) {
      if (current === TEMPLATE_ROOT) return true;
      current = parents.get(current) ?? null;
    }
    return false;
  };

  const entries: CatalogEntry[] = [];
  const byId = new Map<string, CatalogEntry>();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || byId.has(item.id) || isTemplate(item.id)) continue;
    const title = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Unbenannter Artikel';
    const aliases = Array.isArray(item.aliases) ? item.aliases.filter((alias) => typeof alias === 'string' && alias.trim()) : [];
    const tags = Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === 'string' && tag.trim()) : [];
    const entry: CatalogEntry = {
      id: item.id,
      title,
      parentId: item.parentId ?? null,
      tags,
      aliases,
      hidden: item.isHidden === true,
      key: normalize(title),
      aliasKeys: aliases.map(normalize),
      tagKeys: tags.map(normalize),
    };
    entries.push(entry);
    byId.set(entry.id, entry);
  }
  entries.sort((a, b) => a.title.localeCompare(b.title, 'de'));
  return { entries, byId };
}

/** Titel der übergeordneten Artikel von der Wurzel abwärts (ohne den Artikel selbst). */
export function catalogPath(catalog: Catalog, id: string): string[] {
  const path: string[] = [];
  const seen = new Set<string>([id]);
  let current = catalog.byId.get(id)?.parentId ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    const parent = catalog.byId.get(current);
    if (!parent) break;
    path.unshift(parent.title);
    current = parent.parentId;
  }
  return path;
}

/** Wie gut passt ein Suchwort auf einen aufbereiteten Namen? 0 = gar nicht. */
function nameScore(name: string, query: string, tokens: string[]): number {
  if (!name) return 0;
  if (name === query) return 100;
  if (name.startsWith(query)) return 85;
  const nameWords = words(name);
  if (tokens.every((token) => nameWords.some((word) => word.startsWith(token)))) return 70;
  if (name.includes(query)) return 55;
  if (tokens.every((token) => name.includes(token))) return 45;
  return 0;
}

function entryScore(entry: CatalogEntry, query: string, tokens: string[]): number {
  let best = nameScore(entry.key, query, tokens);
  for (const alias of entry.aliasKeys) best = Math.max(best, nameScore(alias, query, tokens) - 5);
  if (best === 0 && tokens.every((token) => entry.tagKeys.some((tag) => tag === token || tag.startsWith(token)))) {
    best = 20;
  }
  return best;
}

function ranked(catalog: Catalog, scored: { entry: CatalogEntry; score: number }[], limit: number): CatalogHit[] {
  return scored
    .filter((hit) => hit.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.entry.title.length - b.entry.title.length ||
        a.entry.title.localeCompare(b.entry.title, 'de'),
    )
    .slice(0, limit)
    .map((hit) => ({ ...hit, path: catalogPath(catalog, hit.entry.id) }));
}

/** Sucht Artikel nach Titel, Zweitnamen und Schlagwort. Beste Treffer zuerst. */
export function searchCatalog(catalog: Catalog, text: string, limit = 20): CatalogHit[] {
  const query = normalize(text);
  if (!query) return [];
  const tokens = words(query);
  return ranked(
    catalog,
    catalog.entries.map((entry) => ({ entry, score: entryScore(entry, query, tokens) })),
    limit,
  );
}

/** Wörter, die in Namen nichts unterscheiden. */
const FILLER = new Set([
  'der', 'die', 'das', 'des', 'dem', 'den', 'von', 'vom', 'zu', 'zum', 'zur', 'und', 'am', 'an', 'im', 'in',
  'auf', 'bei', 'the', 'of', 'and', 'a', 'an', 'de', 'la', 'le', 'du', 'van',
]);

const meaningful = (key: string): string[] => words(key).filter((word) => word.length > 1 && !FILLER.has(word));

/**
 * Artikel, die zu einem Eintragsnamen passen könnten – auch wenn die Namen nicht gleich sind:
 * „Hauptmann Voss“ findet „Voss“, „Zum Salzigen Raben“ findet „Taverne zum Salzigen Raben“.
 */
export function suggestForName(catalog: Catalog, name: string, limit = 5): CatalogHit[] {
  const query = normalize(name);
  if (!query) return [];
  const tokens = words(query);
  const wanted = meaningful(query);
  const scored = catalog.entries.map((entry) => {
    let score = entryScore(entry, query, tokens);
    // Ein Schlagwort allein macht noch keinen Vorschlag.
    if (score <= 20) score = 0;
    for (const candidate of [entry.key, ...entry.aliasKeys]) {
      const have = meaningful(candidate);
      if (!have.length || !wanted.length) continue;
      // Der Artikeltitel steckt vollständig im Eintragsnamen.
      if (have.every((word) => wanted.includes(word))) score = Math.max(score, 60 + Math.min(20, have.length * 5));
      // Teilweise Übereinstimmung: mindestens die Hälfte der Wörter beider Seiten.
      const shared = have.filter((word) => wanted.includes(word)).length;
      if (shared && shared * 2 >= have.length && shared * 2 >= wanted.length) {
        score = Math.max(score, Math.round((40 * shared) / Math.max(have.length, wanted.length)));
      }
    }
    return { entry, score };
  });
  return ranked(catalog, scored, limit);
}

// ── Trefferliste ─────────────────────────────────────────────────────────────

/** Fundstelle im Text: die Umgebung des Treffers, auf lesbare Länge gekürzt. */
export interface Snippet {
  before: string;
  match: string;
  after: string;
}

/** Schneidet rund um eine Fundstelle aus und kürzt an Wortgrenzen. */
export function snippetOf(segment: string, start: number, end: number, radius = 70): Snippet {
  const from = Math.max(0, Math.min(Math.floor(start), segment.length));
  const to = Math.max(from, Math.min(Math.floor(end), segment.length));
  let before = segment.slice(0, from).replace(/\s+/g, ' ');
  let after = segment.slice(to).replace(/\s+/g, ' ');
  if (before.length > radius) {
    const cut = before.slice(before.length - radius);
    const space = cut.indexOf(' ');
    before = `… ${space >= 0 && space < 20 ? cut.slice(space + 1) : cut}`;
  }
  if (after.length > radius) {
    const cut = after.slice(0, radius);
    const space = cut.lastIndexOf(' ');
    after = `${space > radius - 20 ? cut.slice(0, space) : cut} …`;
  }
  return { before, match: segment.slice(from, to), after };
}

/** Ein Treffer der Artikelsuche, wie ihn die Oberfläche zeigt. */
export interface FinderHit {
  resourceId: string;
  title: string;
  path: string[];
  tags: string[];
  hidden: boolean;
  /** Im Namen gefunden oder im Text einer Seite. */
  match: 'title' | 'text';
  documentId?: string;
  snippet?: Snippet;
}

/** Was die Volltextsuche von LegendKeeper liefert – nur die Felder, die hier gebraucht werden. */
export interface RemoteHit {
  resource: { id: string; name: string; tags?: string[]; path?: { id: string; name: string }[] };
  document?: { id: string; name: string; highlights?: { segment: string; matchStart: number; matchEnd: number }[] };
}

/**
 * Führt Titeltreffer aus dem Verzeichnis und Treffer der Volltextsuche zusammen: erst die Titel,
 * dann Fundstellen im Text. Jeder Artikel erscheint nur einmal.
 */
export function mergeHits(
  local: CatalogHit[],
  remote: RemoteHit[],
  catalog: Catalog | null,
  limit = 30,
): FinderHit[] {
  const seen = new Set<string>();
  const titles: FinderHit[] = [];
  const texts: FinderHit[] = [];
  for (const hit of local) {
    if (seen.has(hit.entry.id)) continue;
    seen.add(hit.entry.id);
    titles.push({
      resourceId: hit.entry.id,
      title: hit.entry.title,
      path: hit.path,
      tags: hit.entry.tags,
      hidden: hit.entry.hidden,
      match: 'title',
    });
  }
  for (const hit of remote) {
    const id = hit?.resource?.id;
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    const known = catalog?.byId.get(id);
    const base = {
      resourceId: id,
      title: known?.title ?? (hit.resource.name?.trim() || 'Unbenannter Artikel'),
      path: known && catalog ? catalogPath(catalog, id) : (hit.resource.path ?? []).map((step) => step.name),
      tags: known?.tags ?? hit.resource.tags ?? [],
      hidden: known?.hidden ?? false,
    };
    const highlight = hit.document?.highlights?.[0];
    if (hit.document) {
      texts.push({
        ...base,
        match: 'text',
        documentId: hit.document.id,
        ...(highlight ? { snippet: snippetOf(highlight.segment, highlight.matchStart, highlight.matchEnd) } : {}),
      });
    } else titles.push({ ...base, match: 'title' });
  }
  return [...titles, ...texts].slice(0, limit);
}
