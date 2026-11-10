/**
 * LegendKeeper-Export (.lk) → eigenes Wiki. Der Export ist das ganze Projekt als eine Datei:
 * der Baum der Artikel, ihre Seiten (Text, Karten, Boards, Zeitleisten), Steckbriefe, Schlagworte
 * und Kartenpunkte. Hier wird daraus, was Wayfarer selbst speichert und anzeigt – ohne dass
 * LegendKeeper dafür noch erreichbar sein muss.
 *
 * Reine Funktionen. Gelesen wird ohne Vertrauen: Was fehlt oder eine andere Form hat, wird
 * übergangen oder als Hinweis gezeigt, nie geraten. Text geht nicht verloren – Unbekanntes wird,
 * soweit Text darin steckt, als schlichter Text übernommen.
 */
import {
  ArticleSchema,
  MapSchema,
  nowIso,
  safeId,
  type Article,
  type GameMap,
} from '../../domain/schema';
import {
  safeHref,
  safeImageUrl,
  type ArticleNode,
  type CalloutTone,
  type FactRow,
  type Inline,
  type TableCell,
} from '../legendkeeper/model';

type Raw = Record<string, unknown>;
const isRaw = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const obj = (v: unknown): Raw => (isRaw(v) ? v : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** Sortierschlüssel von LegendKeeper vergleichen sich Zeichen für Zeichen. */
const byPos = (a: Raw, b: Raw) => {
  const x = text(a.pos);
  const y = text(b.pos);
  return x < y ? -1 : x > y ? 1 : 0;
};

const MAX_DEPTH = 48;

// ── Text ───────────────────────────────────────────────────────────────────

/** Übliche Überschriften der Steckbrief-Vorlagen von LegendKeeper, auf Deutsch. */
const PROPERTY_TITLE: Record<string, string> = {
  SUMMARY: 'Zusammenfassung',
  FRIENDS: 'Freunde',
  ENEMIES: 'Feinde',
  'LOCATED IN': 'Liegt in',
  FOUNDER: 'Gegründet von',
  HEADQUARTERS: 'Hauptsitz',
  MEMBERS: 'Mitglieder',
  VIBE: 'Stimmung',
  AMBIENCE: 'Atmosphäre',
  LOGO: 'Wappen',
  'QUEST GIVER': 'Auftraggeber',
  REWARD: 'Belohnung',
  ORIGIN: 'Herkunft',
  CREATOR: 'Erschaffen von',
  // Namenlose Vorgaben: Die Art des Feldes sagt schon alles.
  IMAGE: '',
  TEXT: '',
  TAGS: '',
};

const propertyTitle = (value: Raw): string | undefined => {
  if (value.isTitleHidden === true) return undefined;
  const raw = text(value.title).trim();
  const known = PROPERTY_TITLE[raw];
  return (known ?? raw) || undefined;
};

interface Ctx {
  headings: number;
  /** Unterartikel eines Artikels, in Lesereihenfolge. */
  children: string[];
}

function marksOf(node: Raw): Omit<Extract<Inline, { type: 'text' }>, 'type' | 'text'> {
  const out: Omit<Extract<Inline, { type: 'text' }>, 'type' | 'text'> = {};
  for (const mark of list(node.marks)) {
    if (!isRaw(mark)) continue;
    const attrs = obj(mark.attrs);
    switch (mark.type) {
      case 'strong':
        out.bold = true;
        break;
      case 'em':
        out.italic = true;
        break;
      case 'underline':
        out.underline = true;
        break;
      case 'strike':
        out.strike = true;
        break;
      case 'code':
        out.code = true;
        break;
      case 'subsup':
        if (attrs.type === 'sub') out.sub = true;
        else out.sup = true;
        break;
      case 'highlight':
        out.highlight = true;
        break;
      case 'textStyle':
        if (text(attrs.backgroundColor)) out.highlight = true;
        break;
      case 'link': {
        const href = safeHref(attrs.href);
        if (href) out.href = href;
        break;
      }
    }
  }
  return out;
}

/** Fließtext: Textstücke mit Auszeichnung, Zeilenumbrüche und Verweise auf andere Artikel. */
function inlinesOf(nodes: unknown, depth = 0): Inline[] {
  const out: Inline[] = [];
  if (depth > MAX_DEPTH) return out;
  for (const node of list(nodes)) {
    if (!isRaw(node)) continue;
    if (node.type === 'text') {
      const value = text(node.text);
      if (value) out.push({ type: 'text', text: value, ...marksOf(node) });
    } else if (node.type === 'hardBreak') out.push({ type: 'break' });
    else if (node.type === 'mention') {
      const attrs = obj(node.attrs);
      const resourceId = text(attrs.id);
      const label = text(attrs.text).replace(/^@/, '').trim();
      if (resourceId)
        out.push({
          type: 'mention',
          resourceId,
          ...(text(attrs.documentId) ? { documentId: text(attrs.documentId) } : {}),
          label,
        });
      else if (label) out.push({ type: 'text', text: label });
    } else out.push(...inlinesOf(node.content, depth + 1));
  }
  return out;
}

const hasText = (inlines: Inline[]) =>
  inlines.some((i) => i.type === 'mention' || (i.type === 'text' && i.text.trim() !== ''));

/** Der reine Text eines Stücks Inhalt – für Kurzbeschreibungen und die Suche. */
export function plainText(nodes: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) return '';
  const parts: string[] = [];
  for (const node of list(nodes)) {
    if (!isRaw(node)) continue;
    if (node.type === 'text') parts.push(text(node.text));
    else if (node.type === 'mention') parts.push(text(obj(node.attrs).text).replace(/^@/, ''));
    else if (node.type === 'hardBreak') parts.push(' ');
    else {
      const inner = plainText(node.content, depth + 1);
      if (inner) parts.push(inner, ' ');
    }
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

const PANEL_TONE: Record<string, CalloutTone> = {
  info: 'info',
  note: 'note',
  success: 'success',
  tip: 'success',
  warning: 'warning',
  error: 'error',
};

function imageNode(url: unknown, alt: string, caption?: string): ArticleNode {
  const safe = safeImageUrl(url);
  return safe
    ? { type: 'image', url: safe, alt, ...(caption ? { caption } : {}) }
    : { type: 'note', reason: 'image', title: alt || undefined, count: 1 };
}

/** Ein Feld des Steckbriefs oder einer Infobox. */
function propertyNodes(value: unknown, ctx: Ctx, depth: number): ArticleNode[] {
  if (!isRaw(value)) return [];
  const data = obj(value.data);
  const title = propertyTitle(value);
  switch (value.type) {
    case 'IMAGE':
      return data.url ? [imageNode(data.url, title ?? '', title)] : [];
    case 'TEXT_FIELD': {
      const children = blocksOf(obj(data.fragment).content, ctx, depth + 1);
      return children.length ? [{ type: 'group', title, children }] : [];
    }
    case 'KEY_VALUE': {
      const rows: FactRow[] = [];
      for (const row of list(data.rows).filter(isRaw).sort(byPos)) {
        const key = text(row.key).trim();
        const raw = row.value;
        const inlines: Inline[] =
          typeof raw === 'string'
            ? [{ type: 'text', text: raw }]
            : inlinesOf(isRaw(raw) && Array.isArray(raw.content) ? raw.content : [raw]);
        // Zeilen ohne Wert sind unausgefüllte Felder einer Vorlage.
        if (hasText(inlines)) rows.push({ key, value: inlines });
      }
      return rows.length ? [{ type: 'facts', title, rows }] : [];
    }
    case 'RESOURCE_LINK': {
      const items = list(data.items)
        .filter(isRaw)
        .sort(byPos)
        .map((item) => text(item.resourceId))
        .filter(Boolean)
        .map((resourceId) => ({ resourceId }));
      return items.length ? [{ type: 'links', title, items }] : [];
    }
    case 'SPOTIFY_SINGLE': {
      const href = safeHref(data.url);
      return href
        ? [{ type: 'note', reason: 'embed', title, href, kind: 'Spotify', count: 1 }]
        : [];
    }
    // Schlagworte stehen im Kopf des Artikels; verknüpfte Termine führt der Kalender.
    case 'TAGS':
    case 'LINKED_EVENTS':
      return [];
    default:
      return [];
  }
}

/** Blöcke einer Seite. */
function blocksOf(nodes: unknown, ctx: Ctx, depth = 0): ArticleNode[] {
  const out: ArticleNode[] = [];
  if (depth > MAX_DEPTH) return out;
  for (const node of list(nodes)) {
    if (!isRaw(node)) continue;
    const attrs = obj(node.attrs);
    const params = obj(attrs.parameters);
    switch (node.type) {
      case 'paragraph': {
        const inlines = inlinesOf(node.content);
        // Leere Absätze dienen in LegendKeeper nur als Abstand.
        if (hasText(inlines)) out.push({ type: 'paragraph', inlines });
        break;
      }
      case 'heading': {
        const inlines = inlinesOf(node.content);
        if (!hasText(inlines)) break;
        const level = Math.min(6, Math.max(1, num(attrs.level) ?? 2));
        out.push({ type: 'heading', level, inlines, anchor: `abschnitt-${++ctx.headings}` });
        break;
      }
      case 'bulletList':
      case 'orderedList': {
        const items = list(node.content)
          .filter(isRaw)
          .map((item) => blocksOf(item.content, ctx, depth + 1))
          .filter((item) => item.length > 0);
        if (items.length)
          out.push({
            type: 'list',
            ordered: node.type === 'orderedList',
            start: num(attrs.order) ?? num(attrs.start) ?? 1,
            items,
          });
        break;
      }
      case 'blockquote': {
        const children = blocksOf(node.content, ctx, depth + 1);
        if (children.length) out.push({ type: 'quote', children });
        break;
      }
      case 'rule':
        out.push({ type: 'rule' });
        break;
      case 'codeBlock':
        out.push({ type: 'code', text: plainText(node.content) });
        break;
      case 'table': {
        const rows: TableCell[][] = list(node.content)
          .filter(isRaw)
          .map((row) =>
            list(row.content)
              .filter(isRaw)
              .map((cell): TableCell => {
                const cellAttrs = obj(cell.attrs);
                return {
                  header: cell.type === 'tableHeader',
                  colSpan: Math.max(1, num(cellAttrs.colspan) ?? 1),
                  rowSpan: Math.max(1, num(cellAttrs.rowspan) ?? 1),
                  children: blocksOf(cell.content, ctx, depth + 1),
                };
              }),
          )
          .filter((row) => row.length > 0);
        if (rows.length) out.push({ type: 'table', rows });
        break;
      }
      case 'panel': {
        const children = blocksOf(node.content, ctx, depth + 1);
        if (children.length)
          out.push({
            type: 'callout',
            tone: PANEL_TONE[text(attrs.panelType)] ?? 'info',
            children,
          });
        break;
      }
      case 'mediaSingle':
      case 'mediaGroup':
        for (const media of list(node.content))
          if (isRaw(media)) out.push(imageNode(obj(media.attrs).url, ''));
        break;
      case 'media':
        out.push(imageNode(attrs.url, ''));
        break;
      case 'infoboxPm': {
        const children = list(node.content)
          .filter(isRaw)
          .flatMap((row) => propertyNodes(obj(row.attrs).value, ctx, depth + 1));
        if (children.length) out.push({ type: 'infobox', beside: true, children });
        break;
      }
      case 'extension': {
        const title = params.isTitleHidden === true ? '' : text(params.blockTitle).trim();
        switch (attrs.extensionKey) {
          case 'block-image':
            out.push(imageNode(params.url, title, title || undefined));
            break;
          case 'block-subpage-index':
            if (ctx.children.length)
              out.push({
                type: 'links',
                title: 'Unterseiten',
                items: ctx.children.map((resourceId) => ({ resourceId })),
              });
            break;
          case 'block-resource-collection': {
            const items = list(params.items)
              .map((item) => (isRaw(item) ? text(item.resourceId) : text(item)))
              .filter(Boolean)
              .map((resourceId) => ({ resourceId }));
            out.push(
              items.length
                ? { type: 'links', title: title || undefined, items }
                : { type: 'note', reason: 'collection', title: title || undefined, count: 1 },
            );
            break;
          }
          case 'block-meter': {
            const items = list(params.items)
              .filter(isRaw)
              .map((item) => ({
                name: text(item.name),
                current: num(item.current) ?? 0,
                max: num(item.max) ?? 0,
              }));
            if (items.length) out.push({ type: 'meters', title: title || undefined, items });
            break;
          }
          default:
            out.push({
              type: 'note',
              reason: 'unknown',
              kind: text(attrs.extensionKey) || 'Erweiterung',
              count: 1,
            });
        }
        break;
      }
      case 'bodiedExtension': {
        const children = blocksOf(node.content, ctx, depth + 1);
        if (!children.length) break;
        if (attrs.extensionKey === 'block-secret') out.push({ type: 'secret', children });
        // Ohne eigene Art ist es nur ein Rahmen um seinen Inhalt.
        else out.push(...children);
        break;
      }
      default: {
        // Unbekannte Blockart: Inhalt retten, soweit welcher da ist.
        const children = blocksOf(node.content, ctx, depth + 1);
        if (children.length) out.push(...children);
        else {
          const rescued = plainText([node]);
          if (rescued)
            out.push({ type: 'unknown', kind: text(node.type) || 'unbekannt', text: rescued });
        }
      }
    }
  }
  return out;
}

// ── Karten ─────────────────────────────────────────────────────────────────

/**
 * LegendKeeper legt Kartenpunkte in einem Kachelraster ab: Das Bild passt auf der kleinsten
 * Stufe in eine Kachel von 256 Punkten, jede Stufe verdoppelt. Der Faktor zwischen den
 * Koordinaten eines Kartenpunkts und den Bildpunkten des Kartenbilds ist die Zweierpotenz,
 * bei der das ganze Bild hineinpasst.
 */
export function pinScale(width: number, height: number): number {
  return 2 ** Math.max(0, Math.ceil(Math.log2(Math.max(width, height) / 256)));
}

/** Koordinaten eines Kartenpunkts (`[−y, x]` im Kachelraster) → Bildpunkte, Ursprung oben links. */
export function pinToPixel(
  pos: unknown,
  bounds: { minX: number; maxY: number; scale: number },
): [number, number] | null {
  const [lat, lng] = list(pos).map(num);
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
  return [lng * bounds.scale - bounds.minX, bounds.maxY - lat * bounds.scale];
}

/**
 * Wohin ein Kartenpunkt führt. LegendKeeper schreibt entweder nur die Kennung des Artikels oder
 * eine Adresse der Form „lk://resources/<Artikel>“ (auch mit „/docs/<Seite>“ dahinter).
 */
export function resourceOfUri(uri: unknown): string {
  const value = text(uri).trim();
  const match = /^lk:\/\/[^/]+\/([^/?#]+)/.exec(value);
  return match ? match[1]! : value;
}

// ── Das Ganze ──────────────────────────────────────────────────────────────

/** Was die Erkennung von Personen, Orten und Fraktionen über einen Artikel wissen muss. */
export interface LkResourceInfo {
  id: string;
  name: string;
  parentId: string | null;
  icon: string;
  tags: string[];
  /** Verweise im Steckbrief: Überschrift wie in LegendKeeper („FRIENDS“) und Ziele. */
  links: { title: string; ids: string[] }[];
  /** Überschriften aller Steckbrief-Felder – die Vorlage verrät die Art des Artikels. */
  propertyTitles: string[];
  /** Erster Satz der Zusammenfassung, sonst des Artikels; leer, wenn es keinen Text gibt. */
  summary: string;
  /** Vorlage für neue Artikel – gehört nicht zur Welt. */
  template: boolean;
  /** Der Artikel hat Unterartikel. */
  hasChildren: boolean;
  /** Der Artikel hat eigenen Text oder einen Steckbrief. */
  hasText: boolean;
  /** In LegendKeeper vor den Spielern verborgen. */
  hidden: boolean;
  image: string | null;
  /** Der Artikel hat eine eigene Karte mit Bild. */
  hasMap: boolean;
  /** Der Artikel ist auf einer Karte als Punkt eingetragen. */
  pinned: boolean;
}

export interface LkConversion {
  exportedAt: string;
  articles: Article[];
  maps: GameMap[];
  resources: LkResourceInfo[];
  stats: {
    articles: number;
    pages: number;
    maps: number;
    pins: number;
    shapes: number;
    boards: number;
    timelines: number;
    images: number;
    /** Artikel oder Karten, die unlesbar waren und fehlen. */
    skipped: number;
  };
}

const firstSentence = (value: string, max = 160): string => {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const end = clean.search(/[.!?](\s|$)/);
  const sentence = end >= 0 && end < max ? clean.slice(0, end + 1) : clean;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
};

/** Ist das überhaupt ein LegendKeeper-Export? */
export function isLkExport(raw: unknown): raw is Raw {
  return isRaw(raw) && Array.isArray(raw.resources) && typeof raw.version === 'number';
}

/** Wandelt einen ausgepackten LegendKeeper-Export um. Wirft mit einem deutschen Satz. */
export function convertLkExport(raw: unknown): LkConversion {
  if (!isLkExport(raw))
    throw new Error(
      'Diese Datei ist kein LegendKeeper-Export. Erwartet wird die Datei mit der Endung „.lk“ aus „Export Project“.',
    );
  const stamp = nowIso();
  const resources = list(raw.resources).filter(
    (r): r is Raw => isRaw(r) && !!text(r.id) && !!text(r.name).trim(),
  );
  const ids = new Map(resources.map((r) => [text(r.id), safeId(text(r.id))]));
  const idOf = (value: unknown): string | null => ids.get(text(value)) ?? null;
  const childrenOf = new Map<string, Raw[]>();
  for (const r of resources) {
    const parent = idOf(r.parentId);
    if (!parent) continue;
    const siblings = childrenOf.get(parent);
    if (siblings) siblings.push(r);
    else childrenOf.set(parent, [r]);
  }
  for (const siblings of childrenOf.values()) siblings.sort(byPos);

  const stats: LkConversion['stats'] = {
    articles: 0,
    pages: 0,
    maps: 0,
    pins: 0,
    shapes: 0,
    boards: 0,
    timelines: 0,
    images: 0,
    skipped: list(raw.resources).length - resources.length,
  };
  const images = new Set<string>();
  const seeImages = (nodes: ArticleNode[]) => {
    const visit = (node: ArticleNode) => {
      if (node.type === 'image') images.add(node.url);
      for (const key of ['children', 'items', 'columns', 'rows'] as const) {
        const inner = (node as unknown as Record<string, unknown>)[key];
        for (const part of list(inner).flat())
          if (isRaw(part)) {
            if (Array.isArray(part.children)) (part.children as ArticleNode[]).forEach(visit);
            else if (typeof part.type === 'string') visit(part as unknown as ArticleNode);
          }
      }
    };
    nodes.forEach(visit);
  };

  const pinnedIds = new Set<string>();
  const articles: Article[] = [];
  const maps: GameMap[] = [];
  const infos: LkResourceInfo[] = [];

  for (const r of resources) {
    const id = ids.get(text(r.id))!;
    const ctx: Ctx = {
      headings: 0,
      children: (childrenOf.get(id) ?? []).map((c) => ids.get(text(c.id))!),
    };
    const properties = list(r.properties).filter(isRaw).sort(byPos);
    const sidebar = properties.flatMap((p) => propertyNodes(p, ctx, 0));
    seeImages(sidebar);

    const docs: Raw[] = [];
    let hasMap = false;
    for (const d of list(r.documents).filter(isRaw).sort(byPos)) {
      const docId = safeId(text(d.id));
      const kind = d.type;
      const base = { id: docId, title: text(d.name).trim(), hidden: d.isHidden === true };
      if (kind === 'page') {
        const nodes = blocksOf(obj(d.content).content, ctx);
        if (!nodes.length) continue;
        seeImages(nodes);
        stats.pages++;
        docs.push({ ...base, kind: 'page', nodes });
      } else if (kind === 'map') {
        const m = obj(d.map);
        const image = safeImageUrl(m.mapId) ?? safeImageUrl(m.locatorId);
        const minX = num(m.min_x) ?? 0;
        const maxX = num(m.max_x);
        const minY = num(m.min_y);
        const maxY = num(m.max_y) ?? 0;
        if (!image || maxX === null || minY === null || maxX <= minX || maxY <= minY) continue;
        const width = maxX - minX;
        const height = maxY - minY;
        const bounds = { minX, maxY, scale: pinScale(width, height) };
        const markers: Raw[] = [];
        const shapes: Raw[] = [];
        for (const pin of list(obj(d.content).pins).filter(isRaw)) {
          const articleId = idOf(resourceOfUri(pin.uri));
          const label = text(pin.name).trim();
          const line =
            pin.type === 'path' ? pin.polyline : pin.type === 'region' ? pin.polygon : null;
          if (line) {
            const points = list(line)
              .map((p) => pinToPixel(p, bounds))
              .filter((p): p is [number, number] => p !== null);
            if (points.length > 1) {
              shapes.push({
                id: safeId(text(pin.id)),
                kind: pin.type === 'region' ? 'region' : 'path',
                label,
                points,
                articleId,
              });
              stats.shapes++;
            }
            continue;
          }
          const at = pinToPixel(pin.pos, bounds);
          if (!at) continue;
          if (articleId) pinnedIds.add(articleId);
          markers.push({
            id: safeId(text(pin.id)),
            x: at[0],
            y: at[1],
            lkFeatureId: text(pin.id) || null,
            label,
            articleId,
          });
          stats.pins++;
        }
        const mapId = safeId(`${id}-${docId}`);
        const title = text(d.name).trim();
        const parsed = MapSchema.safeParse({
          id: mapId,
          created: stamp,
          updated: stamp,
          // Heißt die Seite nur „Karte“ o. Ä., trägt die Karte den Namen des Artikels.
          name:
            title && !/^(map|karte|main)$/i.test(title)
              ? `${text(r.name).trim()} – ${title}`
              : text(r.name).trim(),
          lk: { resourceId: id, docId },
          frame: { width, height },
          image,
          markers,
          shapes,
        });
        if (!parsed.success) {
          stats.skipped++;
          continue;
        }
        images.add(image);
        maps.push(parsed.data);
        hasMap = true;
        stats.maps++;
        docs.push({ ...base, kind: 'map', mapId });
      } else if (kind === 'board') {
        stats.boards++;
        docs.push({ ...base, kind: 'board' });
      } else if (kind === 'time') {
        stats.timelines++;
        docs.push({ ...base, kind: 'time' });
      }
    }

    const banner = obj(r.banner);
    const bannerUrl = banner.enabled === false ? undefined : safeImageUrl(banner.url);
    if (bannerUrl) images.add(bannerUrl);
    const parsed = ArticleSchema.safeParse({
      id,
      created: stamp,
      updated: stamp,
      title: text(r.name).trim(),
      parentId: idOf(r.parentId),
      // Vorlagen hängen in LegendKeeper an einem eigenen, unsichtbaren Ast.
      template: r.parentId === 'templates',
      order: text(r.pos),
      aliases: list(r.aliases).map(text).filter(Boolean),
      tags: list(r.tags).map(text).filter(Boolean),
      icon: text(r.iconGlyph).replace(/^fa[srb]? fa-/, ''),
      banner: bannerUrl ?? null,
      hidden: r.isHidden === true,
      sidebar,
      docs,
      source: 'legendkeeper',
    });
    if (!parsed.success) {
      stats.skipped++;
      continue;
    }
    articles.push(parsed.data);
    stats.articles++;

    const summaryField = properties.find(
      (p) =>
        p.type === 'TEXT_FIELD' &&
        /^(summary|zusammenfassung|text|auf einen blick)$/i.test(text(p.title).trim()),
    );
    const firstParagraph = parsed.data.docs
      .flatMap((doc) => doc.nodes)
      .find((node) => node.type === 'paragraph');
    const summary =
      (summaryField && firstSentence(plainText(obj(obj(summaryField.data).fragment).content))) ||
      (firstParagraph
        ? firstSentence(
            list(firstParagraph.inlines)
              .map((part) => (isRaw(part) ? text(part.text) || text(part.label) : ''))
              .join(''),
          )
        : '');
    const picture = properties.find((p) => p.type === 'IMAGE' && obj(p.data).url);
    // Viele Artikel führen ihr Bild im Steckbrief, der in der ersten Seite steht.
    const boxed = parsed.data.docs
      .flatMap((doc) => doc.nodes)
      .filter((node) => node.type === 'infobox')
      .flatMap((node) => list(node.children))
      .find((node) => isRaw(node) && node.type === 'image');
    infos.push({
      id,
      name: parsed.data.title,
      parentId: parsed.data.parentId,
      icon: parsed.data.icon,
      tags: parsed.data.tags,
      links: properties
        .filter((p) => p.type === 'RESOURCE_LINK')
        .map((p) => ({
          title: text(p.title).trim().toUpperCase(),
          ids: list(obj(p.data).items)
            .map((item) => idOf(obj(item).resourceId))
            .filter((x): x is string => x !== null),
        })),
      propertyTitles: properties.map((p) => text(p.title).trim().toUpperCase()),
      summary,
      template: parsed.data.template,
      hidden: parsed.data.hidden,
      hasChildren: ctx.children.length > 0,
      hasText: sidebar.length > 0 || parsed.data.docs.some((doc) => doc.kind === 'page'),
      image:
        (picture ? safeImageUrl(obj(picture.data).url) : undefined) ??
        (isRaw(boxed) ? safeImageUrl(boxed.url) : undefined) ??
        null,
      hasMap,
      pinned: false,
    });
  }
  for (const info of infos) info.pinned = pinnedIds.has(info.id);
  stats.images = images.size;
  return {
    exportedAt: text(raw.exportedAt),
    articles,
    maps,
    resources: infos,
    stats,
  };
}
