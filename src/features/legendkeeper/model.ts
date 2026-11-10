/**
 * Wandelt Artikelinhalte aus LegendKeeper in das um, was Wayfarer anzeigt. Reine Funktionen.
 *
 * LegendKeeper liefert einen Baum aus Blöcken (`kind`), Text als Läufe („runs“) mit Auszeichnung
 * und Eigenschaften der Seitenleiste. Hier entsteht daraus ein kleiner, fester Satz von Knoten.
 * Grundsatz: nichts verschlucken. Was Wayfarer nicht darstellen kann, wird zum Hinweis; was es
 * nicht kennt, wird – soweit Text darin steckt – als schlichter Text gezeigt.
 */
import type { LkDocument, LkResource } from './types';

// ── Knoten der Anzeige ───────────────────────────────────────────────────────

export type Inline =
  | {
      type: 'text';
      text: string;
      bold?: true;
      italic?: true;
      underline?: true;
      strike?: true;
      code?: true;
      sub?: true;
      sup?: true;
      highlight?: true;
      /** Geprüfte Webadresse (nur http, https, mailto). */
      href?: string;
    }
  /** Verweis auf einen anderen Artikel in LegendKeeper. */
  | { type: 'mention'; resourceId: string; documentId?: string; label: string }
  | { type: 'break' };

type TextInline = Extract<Inline, { type: 'text' }>;

export interface FactRow {
  key: string;
  value: Inline[];
}

export interface TableCell {
  header: boolean;
  colSpan: number;
  rowSpan: number;
  children: ArticleNode[];
}

export type CalloutTone = 'info' | 'note' | 'success' | 'warning' | 'error' | 'custom';

/** Warum etwas nur als Hinweis erscheint. */
export type NoteReason =
  /** LegendKeeper selbst gibt den Inhalt nicht heraus („unsupported“). */
  | 'unsupported'
  /** Eingebettetes Medium (YouTube, Spotify, SoundCloud). */
  | 'embed'
  /** Eingebettete Karte. */
  | 'map'
  /** Sammlung, die LegendKeeper anhand eines Filters zusammenstellt. */
  | 'collection'
  /** Bild ohne brauchbare Adresse. */
  | 'image'
  /** Blockart, die Wayfarer nicht kennt und in der kein Text steckt. */
  | 'unknown';

export type ArticleNode =
  | { type: 'paragraph'; inlines: Inline[]; align?: 'center' | 'right' }
  | { type: 'heading'; level: number; inlines: Inline[]; anchor: string; align?: 'center' | 'right' }
  | { type: 'quote'; children: ArticleNode[] }
  | { type: 'code'; text: string }
  | { type: 'rule' }
  | { type: 'list'; ordered: boolean; start: number; items: ArticleNode[][] }
  | { type: 'tasks'; items: { checked: boolean; inlines: Inline[] }[] }
  | { type: 'table'; rows: TableCell[][] }
  | { type: 'callout'; tone: CalloutTone; children: ArticleNode[] }
  | { type: 'expand'; title: string; children: ArticleNode[] }
  | { type: 'columns'; columns: ArticleNode[][] }
  | { type: 'image'; url: string; alt: string; caption?: string }
  /** Schlüssel-Wert-Zeilen („Fakten“). */
  | { type: 'facts'; title?: string; rows: FactRow[] }
  | { type: 'meters'; title?: string; items: { name: string; current: number; max: number }[] }
  /** Verweise auf andere Artikel. */
  | { type: 'links'; title?: string; items: { resourceId: string; documentId?: string }[] }
  /** Betitelter Textabschnitt („Textfeld“). */
  | { type: 'group'; title?: string; children: ArticleNode[] }
  /** Steckbrief: Bild, Fakten und Kurztexte, in LegendKeeper neben dem Text. */
  | { type: 'infobox'; beside: boolean; children: ArticleNode[] }
  /** Abschnitt, den in LegendKeeper nur die Spielleitung sieht. */
  | { type: 'secret'; children: ArticleNode[] }
  | { type: 'note'; reason: NoteReason; title?: string; href?: string; kind?: string; count: number }
  /** Unbekannte Blockart, deren Text gerettet wurde. */
  | { type: 'unknown'; kind: string; text: string };

// ── Lesen ohne Vertrauen ─────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

const isRaw = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const flag = (value: unknown): boolean => value === true;
const count = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const MAX_DEPTH = 64;

/** Nur Adressen, die im Browser gefahrlos geöffnet werden können. */
export function safeHref(value: unknown): string | undefined {
  const raw = text(value).trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** Bilder nur über https – LegendKeeper liefert sie von seinem eigenen Bildspeicher. */
export function safeImageUrl(value: unknown): string | undefined {
  const href = safeHref(value);
  return href?.startsWith('https://') ? href : undefined;
}

/** Erkennt einen Link auf einen Artikel desselben Projekts in LegendKeeper. */
export function internalTarget(
  href: string,
  projectId: string | undefined,
): { resourceId: string; documentId?: string } | null {
  if (!projectId) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' || !/^(www\.)?legendkeeper\.com$/.test(url.hostname)) return null;
    const [marker, project, resourceId, documentId] = url.pathname.split('/').filter(Boolean);
    if (marker !== 'p' || project !== projectId || !resourceId) return null;
    return documentId ? { resourceId, documentId } : { resourceId };
  } catch {
    return null;
  }
}

// ── Textläufe ────────────────────────────────────────────────────────────────

export interface ConvertContext {
  /** Kennung des Projekts – damit Links auf eigene Artikel als Verweise erkannt werden. */
  projectId?: string;
  /** Zähler für Sprungmarken der Überschriften. */
  headings: number;
}

export const newContext = (projectId?: string): ConvertContext => ({ projectId, headings: 0 });

const MARKS = ['bold', 'italic', 'underline', 'strike', 'code', 'sub', 'sup'] as const;

export function convertRuns(runs: unknown, ctx: ConvertContext): Inline[] {
  const out: Inline[] = [];
  for (const run of list(runs)) {
    if (!isRaw(run)) {
      if (typeof run === 'string' && run) out.push({ type: 'text', text: run });
      continue;
    }
    if (isRaw(run.mention)) {
      const resourceId = text(run.mention.resourceId);
      const label = text(run.mention.text).trim() || text(run.mention.name).trim() || 'Unbenannter Artikel';
      if (!resourceId) out.push({ type: 'text', text: label });
      else {
        const documentId = text(run.mention.documentId) || undefined;
        out.push({ type: 'mention', resourceId, label, ...(documentId ? { documentId } : {}) });
      }
      continue;
    }
    if (run.break === true) {
      out.push({ type: 'break' });
      continue;
    }
    // Ein Symbol im Text trägt keinen Inhalt.
    if (isRaw(run.icon)) continue;
    const value = text(run.text);
    if (!value) continue;
    const href = safeHref(run.link);
    const target = href ? internalTarget(href, ctx.projectId) : null;
    if (target) {
      out.push({ type: 'mention', label: value, ...target });
      continue;
    }
    const inline: TextInline = { type: 'text', text: value };
    for (const mark of MARKS) if (flag(run[mark])) inline[mark] = true;
    if (text(run.highlight)) inline.highlight = true;
    if (href) inline.href = href;
    out.push(inline);
  }
  // Zeilenumbrüche am Rand tragen nichts bei.
  while (out[0]?.type === 'break') out.shift();
  while (out[out.length - 1]?.type === 'break') out.pop();
  return out;
}

export function inlineText(inlines: Inline[]): string {
  return inlines
    .map((inline) => (inline.type === 'text' ? inline.text : inline.type === 'mention' ? inline.label : '\n'))
    .join('');
}

const isBlank = (inlines: Inline[]) => inlineText(inlines).trim() === '';

// ── Eigenschaften (Seitenleiste und Steckbrief) ──────────────────────────────

/** Titel einer Eigenschaft oder eines Blocks, wenn LegendKeeper ihn anzeigt. */
function shownTitle(raw: Raw): string | undefined {
  const title = text(raw.title).trim();
  return title && !flag(raw.isTitleHidden) ? title : undefined;
}

const withTitle = <T extends ArticleNode>(node: T, title: string | undefined): T => (title ? { ...node, title } : node);

function convertRows(rows: unknown, ctx: ConvertContext): FactRow[] {
  const out: FactRow[] = [];
  for (const row of list(rows)) {
    if (!isRaw(row)) continue;
    const key = text(row.key).trim();
    let value = convertRuns(row.content, ctx);
    if (isBlank(value) && text(row.text).trim()) value = [{ type: 'text', text: text(row.text).trim() }];
    if (isBlank(value)) continue;
    out.push({ key, value });
  }
  return out;
}

function convertTargets(items: unknown): { resourceId: string; documentId?: string }[] {
  const out: { resourceId: string; documentId?: string }[] = [];
  for (const item of list(items)) {
    if (!isRaw(item)) continue;
    const resourceId = text(item.resourceId);
    if (!resourceId) continue;
    const documentId = text(item.documentId) || undefined;
    out.push(documentId ? { resourceId, documentId } : { resourceId });
  }
  return out;
}

function note(reason: NoteReason, extra: { title?: string; href?: string; kind?: string } = {}): ArticleNode {
  return { type: 'note', reason, count: 1, ...extra };
}

/**
 * Arten, die als Block und als Eigenschaft gleich aussehen (Bild, Fakten, Anzeigen, Verweise,
 * Medien, Karte, Textfeld). Gibt `undefined` zurück, wenn die Art hier nicht hingehört,
 * und `null`, wenn der Inhalt leer ist.
 */
function convertStructured(raw: Raw, ctx: ConvertContext, depth: number): ArticleNode | null | undefined {
  const title = shownTitle(raw);
  switch (text(raw.kind)) {
    case 'image': {
      if (!text(raw.url).trim()) return null;
      const url = safeImageUrl(raw.url);
      if (!url) return note('image', { title });
      return { type: 'image', url, alt: text(raw.alt).trim() || title || '', ...(title ? { caption: title } : {}) };
    }
    case 'keyValue': {
      const rows = convertRows(raw.rows, ctx);
      return rows.length ? withTitle({ type: 'facts', rows }, title) : null;
    }
    case 'textField': {
      const children = convertBlocks(raw.children, ctx, depth + 1);
      return children.length ? withTitle({ type: 'group', children }, title) : null;
    }
    case 'meter': {
      const items = list(raw.items)
        .filter(isRaw)
        .map((item) => ({
          name: text(item.name).trim(),
          current: Math.max(0, count(item.current, 0)),
          max: Math.max(1, count(item.max, 1)),
        }));
      return items.length ? withTitle({ type: 'meters', items }, title) : null;
    }
    case 'resourceLink': {
      const items = convertTargets(raw.items);
      return items.length ? withTitle({ type: 'links', items }, title) : null;
    }
    case 'resourceCollection': {
      const items = convertTargets(raw.items);
      if (items.length) return withTitle({ type: 'links', items }, title);
      return isRaw(raw.filter) ? note('collection', { title }) : null;
    }
    case 'embed': {
      const href = safeHref(raw.url);
      return href ? note('embed', { title, href, kind: text(raw.provider) || undefined }) : null;
    }
    case 'map':
      return text(raw.resourceId) ? note('map', { title }) : null;
    default:
      return undefined;
  }
}

/** Eine Eigenschaft der Seitenleiste oder eines Steckbriefs. `null`, wenn sie leer ist. */
export function convertProperty(property: unknown, ctx: ConvertContext, depth = 0): ArticleNode | null {
  if (!isRaw(property)) return null;
  const structured = convertStructured(property, ctx, depth);
  if (structured !== undefined) return structured;
  const kind = text(property.kind);
  if (kind === 'unsupported') return note('unsupported', { title: text(property.title).trim() || undefined });
  return rescue(property, kind);
}

export function convertProperties(properties: unknown, ctx: ConvertContext, depth = 0): ArticleNode[] {
  const out: ArticleNode[] = [];
  for (const property of list(properties)) {
    const node = convertProperty(property, ctx, depth);
    if (node) out.push(node);
  }
  return mergeNotes(out);
}

// ── Blöcke ───────────────────────────────────────────────────────────────────

/** Sammelt allen Text, der in einem unbekannten Block steckt. */
function rescueText(value: unknown, depth: number, lines: string[]): void {
  if (depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const item of value) rescueText(item, depth + 1, lines);
    return;
  }
  if (!isRaw(value)) return;
  const own = [text(value.title), text(value.key)].filter((part) => part.trim());
  const runs = inlineText(convertRuns(value.content, newContext())).trim();
  const body = runs || text(value.text).trim();
  const line = [...own, body].filter(Boolean).join(': ');
  if (line) lines.push(line);
  for (const field of ['children', 'rows', 'items', 'blocks']) rescueText(value[field], depth + 1, lines);
}

function rescue(raw: Raw, kind: string): ArticleNode {
  const lines: string[] = [];
  rescueText(raw, 0, lines);
  const label = kind || 'ohne Art';
  return lines.length ? { type: 'unknown', kind: label, text: lines.join('\n') } : note('unknown', { kind: label });
}

const ALIGN = { center: 'center', right: 'right' } as const;
const alignOf = (raw: Raw): { align?: 'center' | 'right' } => {
  const align = ALIGN[text(raw.align) as keyof typeof ALIGN];
  return align ? { align } : {};
};

const TONES: readonly CalloutTone[] = ['info', 'note', 'success', 'warning', 'error', 'custom'];

function convertBlock(block: unknown, ctx: ConvertContext, depth: number): ArticleNode[] {
  if (!isRaw(block)) return [];
  if (depth > MAX_DEPTH) return [note('unknown', { kind: 'zu tief verschachtelt' })];
  const kind = text(block.kind);
  const children = () => convertBlocks(block.children, ctx, depth + 1);

  switch (kind) {
    case 'paragraph': {
      const inlines = convertRuns(block.content, ctx);
      return isBlank(inlines) ? [] : [{ type: 'paragraph', inlines, ...alignOf(block) }];
    }
    case 'heading': {
      const inlines = convertRuns(block.content, ctx);
      if (isBlank(inlines)) return [];
      const level = Math.min(6, Math.max(1, Math.round(count(block.level, 2))));
      ctx.headings += 1;
      return [{ type: 'heading', level, inlines, anchor: `lk-abschnitt-${ctx.headings}`, ...alignOf(block) }];
    }
    case 'quote': {
      const inner = children();
      return inner.length ? [{ type: 'quote', children: inner }] : [];
    }
    case 'code': {
      const value = text(block.text);
      return value.trim() ? [{ type: 'code', text: value }] : [];
    }
    case 'rule':
      return [{ type: 'rule' }];
    case 'bulletList':
    case 'orderedList': {
      const items: ArticleNode[][] = [];
      for (const child of list(block.children)) {
        // Ein Listenpunkt enthält Absätze und weitere Listen; alles andere wird selbst zum Punkt.
        const item = isRaw(child) && child.kind === 'listItem' ? convertBlocks(child.children, ctx, depth + 2) : convertBlock(child, ctx, depth + 1);
        if (item.length) items.push(item);
      }
      if (!items.length) return [];
      const ordered = kind === 'orderedList';
      return [{ type: 'list', ordered, start: ordered ? Math.max(0, Math.round(count(block.start, 1))) : 1, items }];
    }
    case 'taskList': {
      const items: { checked: boolean; inlines: Inline[] }[] = [];
      for (const child of list(block.children)) {
        if (!isRaw(child)) continue;
        const inlines = convertRuns(child.content, ctx);
        if (!isBlank(inlines)) items.push({ checked: flag(child.checked), inlines });
      }
      return items.length ? [{ type: 'tasks', items }] : [];
    }
    case 'table': {
      const rows: TableCell[][] = [];
      for (const row of list(block.children)) {
        if (!isRaw(row)) continue;
        const cells: TableCell[] = [];
        for (const cell of list(row.children)) {
          if (!isRaw(cell)) continue;
          cells.push({
            header: flag(cell.header),
            colSpan: Math.max(1, Math.round(count(cell.colspan, 1))),
            rowSpan: Math.max(1, Math.round(count(cell.rowspan, 1))),
            children: convertBlocks(cell.children, ctx, depth + 3),
          });
        }
        if (cells.length) rows.push(cells);
      }
      // Eine Tabelle ohne jeden Inhalt ist nur ein leeres Gitter.
      return rows.some((cells) => cells.some((cell) => cell.children.length)) ? [{ type: 'table', rows }] : [];
    }
    case 'callout': {
      const inner = children();
      if (!inner.length) return [];
      const tone = TONES.find((candidate) => candidate === block.tone) ?? 'note';
      return [{ type: 'callout', tone, children: inner }];
    }
    case 'expand': {
      const inner = children();
      const title = text(block.title).trim();
      if (!inner.length && !title) return [];
      return [{ type: 'expand', title: title || 'Aufklappen', children: inner }];
    }
    case 'layout': {
      const columns = list(block.children)
        .map((column) => (isRaw(column) && column.kind === 'layoutColumn' ? convertBlocks(column.children, ctx, depth + 2) : convertBlock(column, ctx, depth + 1)))
        .filter((column) => column.length > 0);
      if (columns.length === 0) return [];
      // Eine einzige gefüllte Spalte ist einfach Fließtext.
      return columns.length === 1 ? (columns[0] ?? []) : [{ type: 'columns', columns }];
    }
    case 'infobox': {
      const inner = convertProperties(block.rows, ctx, depth + 1);
      if (!inner.length) return [];
      const layout = text(block.layout);
      return [{ type: 'infobox', beside: layout === '' || layout === 'wrapLeft' || layout === 'wrapRight', children: inner }];
    }
    case 'secret': {
      const inner = children();
      return inner.length ? [{ type: 'secret', children: inner }] : [];
    }
    case 'unsupported':
      return [note('unsupported')];
    // Verirrte Teile ohne ihren Rahmen: den Inhalt trotzdem zeigen.
    case 'listItem':
    case 'tableRow':
    case 'tableCell':
    case 'layoutColumn':
      return children();
    case 'taskItem': {
      const inlines = convertRuns(block.content, ctx);
      return isBlank(inlines) ? [] : [{ type: 'tasks', items: [{ checked: flag(block.checked), inlines }] }];
    }
    default: {
      const structured = convertStructured(block, ctx, depth);
      if (structured !== undefined) return structured ? [structured] : [];
      return [rescue(block, kind)];
    }
  }
}

/** Fasst gleiche, direkt aufeinander folgende Hinweise zusammen. */
function mergeNotes(nodes: ArticleNode[]): ArticleNode[] {
  const out: ArticleNode[] = [];
  for (const node of nodes) {
    const last = out[out.length - 1];
    if (
      node.type === 'note' &&
      last?.type === 'note' &&
      last.reason === node.reason &&
      !last.title &&
      !node.title &&
      !last.href &&
      !node.href &&
      last.kind === node.kind
    ) {
      out[out.length - 1] = { ...last, count: last.count + node.count };
    } else out.push(node);
  }
  return out;
}

export function convertBlocks(blocks: unknown, ctx: ConvertContext, depth = 0): ArticleNode[] {
  const out: ArticleNode[] = [];
  for (const block of list(blocks)) out.push(...convertBlock(block, ctx, depth));
  return mergeNotes(out);
}

// ── Auswertung der Knoten ────────────────────────────────────────────────────

const EMBED_PROVIDERS: Record<string, string | undefined> = {
  youtube: 'YouTube',
  spotify: 'Spotify',
  soundcloud: 'SoundCloud',
};

/** Der Satz, der an Stelle eines nicht darstellbaren Inhalts steht. */
export function noteText(node: Extract<ArticleNode, { type: 'note' }>): string {
  const named = node.title ? `„${node.title}“` : '';
  switch (node.reason) {
    case 'unsupported':
      if (node.count > 1) return `${node.count} Abschnitte lassen sich nur in LegendKeeper ansehen.`;
      return named
        ? `${named} lässt sich nur in LegendKeeper ansehen.`
        : 'Dieser Abschnitt lässt sich nur in LegendKeeper ansehen.';
    case 'embed': {
      const provider = EMBED_PROVIDERS[node.kind ?? ''];
      return `Eingebettetes Medium${provider ? ` (${provider})` : ''}${named ? ` ${named}` : ''} – öffnet sich im Browser.`;
    }
    case 'map':
      return `Karte${named ? ` ${named}` : ''} – nur in LegendKeeper zu sehen.`;
    case 'collection':
      return `Sammlung${named ? ` ${named}` : ''} – stellt LegendKeeper selbst zusammen.`;
    case 'image':
      return `Bild${named ? ` ${named}` : ''} – lässt sich hier nicht laden.`;
    case 'unknown':
    default:
      return node.count > 1
        ? `${node.count} Bausteine (${node.kind ?? 'unbekannt'}) kennt Wayfarer noch nicht – in LegendKeeper ansehen.`
        : `Einen Baustein (${node.kind ?? 'unbekannt'}) kennt Wayfarer noch nicht – in LegendKeeper ansehen.`;
  }
}

/** Reiner Text eines Knotens (für Tests und die Suche im Artikel). */
export function nodeText(node: ArticleNode): string {
  const many = (nodes: ArticleNode[]) => nodes.map(nodeText).filter(Boolean).join('\n');
  switch (node.type) {
    case 'paragraph':
    case 'heading':
      return inlineText(node.inlines);
    case 'quote':
    case 'callout':
    case 'secret':
    case 'infobox':
      return many(node.children);
    case 'group':
    case 'expand':
      return [node.title, many(node.children)].filter(Boolean).join('\n');
    case 'code':
      return node.text;
    case 'rule':
      return '';
    case 'list':
      return node.items.map(many).join('\n');
    case 'tasks':
      return node.items.map((item) => inlineText(item.inlines)).join('\n');
    case 'table':
      return node.rows.map((row) => row.map((cell) => many(cell.children)).join(' | ')).join('\n');
    case 'columns':
      return node.columns.map(many).join('\n');
    case 'image':
      return node.caption ?? node.alt;
    case 'facts':
      return node.rows.map((row) => `${row.key}: ${inlineText(row.value)}`).join('\n');
    case 'meters':
      return node.items.map((item) => `${item.name}: ${item.current}/${item.max}`).join('\n');
    case 'links':
      return node.title ?? '';
    case 'note':
      return noteText(node);
    case 'unknown':
      return node.text;
  }
}

export interface OutlineEntry {
  anchor: string;
  level: number;
  text: string;
}

/** Überschriften des Fließtexts für das Inhaltsverzeichnis (nicht aus Steckbriefen). */
export function outlineOf(nodes: ArticleNode[]): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const visit = (node: ArticleNode) => {
    if (node.type === 'heading') out.push({ anchor: node.anchor, level: node.level, text: inlineText(node.inlines).trim() });
    else if (node.type === 'columns') node.columns.forEach((column) => column.forEach(visit));
    else if (node.type === 'secret' || node.type === 'group') node.children.forEach(visit);
  };
  nodes.forEach(visit);
  // Ebenen so verschieben, dass die oberste vorkommende Ebene 1 ist.
  const top = Math.min(...out.map((entry) => entry.level));
  return out.map((entry) => ({ ...entry, level: entry.level - top + 1 }));
}

/** Alle Artikel, auf die ein Inhalt verweist (für das Nachschlagen der Namen). */
export function linkedResourceIds(nodes: ArticleNode[]): string[] {
  const ids = new Set<string>();
  const visit = (node: ArticleNode) => {
    switch (node.type) {
      case 'links':
        node.items.forEach((item) => ids.add(item.resourceId));
        break;
      case 'quote':
      case 'callout':
      case 'expand':
      case 'group':
      case 'infobox':
      case 'secret':
        node.children.forEach(visit);
        break;
      case 'columns':
        node.columns.forEach((column) => column.forEach(visit));
        break;
      case 'list':
        node.items.forEach((item) => item.forEach(visit));
        break;
      case 'table':
        node.rows.forEach((row) => row.forEach((cell) => cell.children.forEach(visit)));
        break;
      default:
        break;
    }
  };
  nodes.forEach(visit);
  return [...ids];
}

// ── Artikel ──────────────────────────────────────────────────────────────────

export type DocKind = 'page' | 'blank' | 'map' | 'board' | 'time' | 'other';

export interface ArticleDoc {
  id: string;
  name: string;
  kind: DocKind;
  /** In LegendKeeper vor den Spielern verborgen. */
  hidden: boolean;
}

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  page: 'Seite',
  blank: 'Leere Seite',
  map: 'Karte',
  board: 'Tafel',
  time: 'Zeitleiste',
  other: 'Dokument',
};

const DOC_KINDS: readonly DocKind[] = ['page', 'blank', 'map', 'board', 'time'];

function docOf(document: LkDocument): ArticleDoc {
  const kind = DOC_KINDS.find((candidate) => candidate === document.type) ?? 'other';
  return {
    id: document.id,
    name: text(document.name).trim() || DOC_KIND_LABEL[kind],
    kind,
    hidden: flag(document.isHidden),
  };
}

export interface ArticleHead {
  id: string;
  title: string;
  /** Übergeordnete Artikel von der Wurzel abwärts. */
  path: { id: string; name: string }[];
  tags: string[];
  aliases: string[];
  hidden: boolean;
  banner: { url: string; position: number } | null;
  /** Lesbare Seiten in der Reihenfolge von LegendKeeper. */
  pages: ArticleDoc[];
  /** Karten, Tafeln und Zeitleisten – nur in LegendKeeper selbst anzusehen. */
  others: ArticleDoc[];
  /** Eigenschaften der Seitenleiste. */
  side: ArticleNode[];
}

/** Kopf eines Artikels: Titel, Pfad, Dokumente und Seitenleiste. */
export function articleHead(resource: LkResource, projectId?: string): ArticleHead {
  const docs = [...list(resource.documents)]
    .filter((document): document is LkDocument => isRaw(document) && typeof document.id === 'string')
    .sort((a, b) => {
      const left = text(a.rank);
      const right = text(b.rank);
      return left < right ? -1 : left > right ? 1 : 0;
    })
    .map(docOf);
  const bannerUrl = resource.banner && resource.banner.enabled !== false ? safeImageUrl(resource.banner.url) : undefined;
  return {
    id: resource.id,
    title: text(resource.name).trim() || 'Unbenannter Artikel',
    path: list(resource.ancestors)
      .filter(isRaw)
      .map((ancestor) => ({ id: text(ancestor.id), name: text(ancestor.name).trim() || 'Unbenannt' }))
      .filter((ancestor) => ancestor.id),
    tags: list(resource.tags).map(text).filter(Boolean),
    aliases: list(resource.aliases).map(text).filter(Boolean),
    hidden: flag(resource.isHidden),
    banner: bannerUrl
      ? { url: bannerUrl, position: Math.min(100, Math.max(0, count(resource.banner?.yPosition, 50))) }
      : null,
    pages: docs.filter((doc) => doc.kind === 'page'),
    others: docs.filter((doc) => doc.kind !== 'page' && doc.kind !== 'blank'),
    side: convertProperties(resource.properties, newContext(projectId)),
  };
}

export interface ArticleBody {
  /** Fließtext. */
  body: ArticleNode[];
  /** Steckbriefe, die in LegendKeeper neben dem Text stehen – hier in der Randspalte. */
  aside: ArticleNode[];
  outline: OutlineEntry[];
}

const sameTitle = (a: string, b: string) =>
  a.trim().toLocaleLowerCase('de') === b.trim().toLocaleLowerCase('de') && a.trim() !== '';

/**
 * Inhalt einer Seite: Fließtext, Randspalte und Inhaltsverzeichnis. Beginnt der Text mit einer
 * Überschrift, die nur den Titel des Artikels wiederholt, entfällt sie – der Titel steht schon darüber.
 */
export function articleBody(blocks: unknown, projectId?: string, title?: string): ArticleBody {
  const nodes = convertBlocks(blocks, newContext(projectId));
  const body: ArticleNode[] = [];
  const aside: ArticleNode[] = [];
  for (const node of nodes) {
    if (node.type === 'infobox' && node.beside) aside.push(...node.children);
    else body.push(node);
  }
  const first = body[0];
  if (title && first?.type === 'heading' && sameTitle(inlineText(first.inlines), title)) body.shift();
  return { body, aside, outline: outlineOf(body) };
}

/** Bezeichnung eines Dokuments, das nur in LegendKeeper anzusehen ist: „Karte „Stadtplan““. */
export function docLabel(doc: ArticleDoc): string {
  const kind = DOC_KIND_LABEL[doc.kind];
  return sameTitle(doc.name, kind) ? kind : `${kind} „${doc.name}“`;
}
