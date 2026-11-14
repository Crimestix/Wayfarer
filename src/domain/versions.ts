/**
 * Frühere Fassungen der Artikel: wann eine Fassung abgelegt wird, welche beim Ausdünnen bleiben,
 * was im Papierkorb liegt, und ein zeilenweiser Vergleich zweier Texte. Rein, ohne Datenbank –
 * geschrieben wird über `features/wiki/actions.ts`.
 *
 * Eine Fassung hält den Wortlaut, wie er *vor* einer Änderung stand. Beim Schreiben entsteht
 * höchstens eine je Seite und zehn Minuten: Die erste bleibt, solange weitergeschrieben wird – sie
 * ist der Stand vor dem Ansetzen, und genau den will man zurückholen können. Was in den zehn
 * Minuten dazwischen stand, geht nicht verloren, sondern wird zur nächsten Fassung, sobald danach
 * wieder geschrieben wird.
 */
import type { ArticleVersion, CampaignData } from './schema';

/** Innerhalb dieser Zeit nach der letzten Fassung entsteht keine neue. */
export const VERSION_WINDOW_MS = 10 * 60 * 1000;
/** So viele der jüngsten Fassungen eines Artikels bleiben immer. */
export const KEEP_RECENT = 20;
/** Höchstens so viele Fassungen je Artikel. */
export const KEEP_MOST = 60;

const time = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : -Infinity;
};

/** Neueste zuerst; bei gleicher Zeit nach Kennung, damit die Reihenfolge feststeht. */
const newestFirst = (a: ArticleVersion, b: ArticleVersion): number =>
  time(b.savedAt) - time(a.savedAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** Der Kalendertag (Ortszeit des Rechners), an dem eine Fassung abgelegt wurde. */
export function versionDay(iso: string): string {
  const t = time(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Soll vor einer Änderung der bisherige Text als Fassung abgelegt werden? Nein, wenn er leer ist,
 * wenn die letzte Fassung dieser Seite schon genau so lautet oder wenn sie jünger als zehn
 * Minuten ist. `force` (vor dem Zurückholen einer älteren Fassung) übergeht nur die zehn Minuten.
 */
export function shouldKeepVersion(
  versions: readonly ArticleVersion[],
  input: { docId: string | null; previousText: string; now: string; force?: boolean },
): boolean {
  if (!input.previousText.trim()) return false;
  const latest = versions
    .filter((v) => v.reason !== 'delete' && v.docId === input.docId)
    .sort(newestFirst)[0];
  if (!latest) return true;
  if (latest.text === input.previousText) return false;
  if (input.force) return true;
  return time(input.now) - time(latest.savedAt) >= VERSION_WINDOW_MS;
}

/**
 * Dünnt die Fassungen eines Artikels aus und gibt die Kennungen zurück, die wegfallen: Die
 * jüngsten 20 bleiben; von den älteren bleibt je Tag nur die letzte des Tages; insgesamt höchstens
 * 60 – darüber fallen die ältesten weg. Fassungen im Papierkorb (`delete`) zählen nicht mit.
 */
export function pruneVersions(versions: readonly ArticleVersion[]): string[] {
  const sorted = versions.filter((v) => v.reason !== 'delete').sort(newestFirst);
  const keep: ArticleVersion[] = [];
  const drop: string[] = [];
  const days = new Set<string>();
  sorted.forEach((version, index) => {
    if (index < KEEP_RECENT) {
      keep.push(version);
      return;
    }
    const day = versionDay(version.savedAt);
    if (days.has(day)) drop.push(version.id);
    else {
      days.add(day);
      keep.push(version);
    }
  });
  for (const version of keep.slice(KEEP_MOST)) drop.push(version.id);
  return drop;
}

/** Die früheren Fassungen eines Artikels (ohne Papierkorb), neueste zuerst. */
export function versionsOf(
  data: Pick<CampaignData, 'versions'>,
  articleId: string,
): ArticleVersion[] {
  return Object.values(data.versions)
    .filter((v) => v.articleId === articleId && v.reason !== 'delete')
    .sort(newestFirst);
}

/**
 * Der Papierkorb: gelöschte Artikel, die es nicht mehr gibt, neueste zuerst – je Artikel nur das
 * letzte Löschen.
 */
export function trashOf(data: Pick<CampaignData, 'versions' | 'articles'>): ArticleVersion[] {
  const seen = new Set<string>();
  return Object.values(data.versions)
    .filter((v) => v.reason === 'delete' && v.article && !data.articles[v.articleId])
    .sort(newestFirst)
    .filter((v) => {
      if (seen.has(v.articleId)) return false;
      seen.add(v.articleId);
      return true;
    });
}

// ── Vergleich ──────────────────────────────────────────────────────────────

export type DiffKind = 'same' | 'added' | 'removed';
export interface DiffLine {
  kind: DiffKind;
  text: string;
}

/** Größer als so viele Vergleichsfelder wird nicht mehr fein verglichen (Speicher). */
const MAX_CELLS = 4_000_000;

const linesOf = (text: string): string[] => (text === '' ? [] : text.split(/\r?\n/));

/**
 * Zeilenweiser Unterschied von `before` zu `after`: gleiche Zeilen, entfernte und hinzugefügte –
 * innerhalb einer Änderung erst die entfernten, dann die neuen. Gleicher Anfang und gleiches Ende
 * werden vorab abgetrennt; dazwischen die längste gemeinsame Folge. Ist der geänderte Teil riesig,
 * gilt er als ganz ersetzt.
 */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = linesOf(before);
  const b = linesOf(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out: DiffLine[] = a.slice(0, start).map((text) => ({ kind: 'same', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    for (const text of midA) out.push({ kind: 'removed', text });
    for (const text of midB) out.push({ kind: 'added', text });
  } else {
    // lcs[i][j]: längste gemeinsame Folge von midA[i..] und midB[j..].
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i * width + j] =
          midA[i] === midB[j]
            ? lcs[(i + 1) * width + j + 1]! + 1
            : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        out.push({ kind: 'same', text: midA[i]! });
        i++;
        j++;
      } else if (j >= m || (i < n && lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)) {
        out.push({ kind: 'removed', text: midA[i]! });
        i++;
      } else {
        out.push({ kind: 'added', text: midB[j]! });
        j++;
      }
    }
  }
  for (const text of a.slice(endA)) out.push({ kind: 'same', text });
  return out;
}

/** Wie groß eine Änderung ist: hinzugekommene und entfernte Zeilen, Leerzeilen nicht gezählt. */
export function diffSize(before: string, after: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lineDiff(before, after)) {
    if (!line.text.trim()) continue;
    if (line.kind === 'added') added++;
    else if (line.kind === 'removed') removed++;
  }
  return { added, removed };
}

export type DiffPart = DiffLine | { kind: 'gap'; count: number };

/**
 * Kürzt lange gleiche Strecken eines Vergleichs: Um jede Änderung bleiben `context` Zeilen
 * stehen, dazwischen steht nur, wie viele Zeilen unverändert sind.
 */
export function foldDiff(lines: readonly DiffLine[], context = 2): DiffPart[] {
  const near = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, index) => {
    if (line.kind === 'same') return;
    for (
      let k = Math.max(0, index - context);
      k <= Math.min(lines.length - 1, index + context);
      k++
    )
      near[k] = true;
  });
  const out: DiffPart[] = [];
  let gap = 0;
  lines.forEach((line, index) => {
    if (line.kind !== 'same' || near[index]) {
      if (gap) out.push({ kind: 'gap', count: gap });
      gap = 0;
      out.push(line);
    } else gap++;
  });
  if (gap) out.push({ kind: 'gap', count: gap });
  return out;
}

// ── Liste für die Anzeige ──────────────────────────────────────────────────

export interface VersionRow {
  version: ArticleVersion;
  /** Was danach geändert wurde: bis zur nächsten Fassung derselben Seite oder bis heute. */
  change: { added: number; removed: number };
  /** Lautet die Seite heute genau so? */
  sameAsNow: boolean;
  /** Gibt es die Seite noch? */
  pageExists: boolean;
}

/**
 * Die Fassungen eines Artikels für die Liste: je Fassung, wie groß die Änderung war, die ihr
 * folgte. `currentText` liefert den heutigen Text einer Seite (oder `null`, wenn es sie nicht mehr
 * gibt).
 */
export function versionRows(
  versions: readonly ArticleVersion[],
  currentText: (docId: string | null) => string | null,
): VersionRow[] {
  const sorted = [...versions].sort(newestFirst);
  const newer = new Map<string | null, string>();
  return sorted.map((version) => {
    const now = currentText(version.docId);
    const next = newer.get(version.docId) ?? now ?? '';
    newer.set(version.docId, version.text);
    return {
      version,
      change: diffSize(version.text, next),
      sameAsNow: now !== null && now === version.text,
      pageExists: now !== null,
    };
  });
}
