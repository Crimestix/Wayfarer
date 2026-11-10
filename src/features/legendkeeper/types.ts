/**
 * Antworten der LegendKeeper-API (v3), soweit Wayfarer sie liest. Abgeleitet aus der offiziellen
 * Beschreibung unter https://www.legendkeeper.com/api/v3/openapi.json.
 *
 * Artikelinhalte (Blöcke, Eigenschaften, Textläufe) sind hier bewusst nur lose beschrieben:
 * `model.ts` liest sie Feld für Feld und verkraftet auch Arten, die es heute noch nicht gibt.
 */

/** Jede Liste der API: eine Seite mit Verweis auf die nächste. */
export interface LkPage<T> {
  data: T[];
  hasMore?: boolean;
  nextCursor?: string | null;
}

export interface LkProject {
  id: string;
  name?: string;
}

/** Dokument eines Artikels, wie es in der Artikelliste steht. */
export interface LkListedDocument {
  id: string;
  name: string | null;
  /** `page`, `board`, `map`, `time` oder `blank`. */
  type: string | null;
}

/** Artikel („resource“), wie er in der Liste aller Artikel steht. */
export interface LkResourceListItem {
  id: string;
  name: string;
  /** Übergeordneter Artikel. Vorlagen hängen unter dem gedachten Artikel `templates`. */
  parentId?: string | null;
  tags: string[];
  aliases: string[];
  isHidden?: boolean;
  documents: LkListedDocument[];
  hasChildren?: boolean;
}

export interface LkDocument {
  id: string;
  name: string;
  type: string;
  rank?: string;
  isHidden?: boolean;
}

export interface LkAncestor {
  id: string;
  name: string;
}

/** Ein einzelner Artikel mit Dokumenten, Eigenschaften der Seitenleiste und seinem Pfad. */
export interface LkResource {
  id: string;
  name: string;
  tags?: string[];
  aliases?: string[];
  parentId?: string | null;
  isHidden?: boolean;
  banner?: { enabled?: boolean; url?: string; yPosition?: number } | null;
  documents?: LkDocument[];
  /** Eigenschaften der Seitenleiste; Aufbau siehe `model.ts`. */
  properties?: unknown[];
  /** Von der Wurzel abwärts, ohne den Artikel selbst. */
  ancestors?: LkAncestor[];
  updatedAt?: string | null;
}

/** Inhalt eines Seiten-Dokuments als Baum aus Blöcken. */
export interface LkDocumentBlocks {
  id: string;
  version?: string;
  schema?: number;
  text?: string;
  blocks: unknown[];
}

export interface LkSearchHit {
  resource: {
    id: string;
    name: string;
    parentId?: string | null;
    tags?: string[];
    /** Übergeordnete Artikel von der Wurzel abwärts; fehlt bei Artikeln der obersten Ebene. */
    path?: LkAncestor[];
  };
  /** Vorhanden, wenn der Treffer im Text eines Dokuments liegt statt im Namen. */
  document?: {
    id: string;
    name: string;
    highlights?: { segment: string; matchStart: number; matchEnd: number }[];
  };
}

/** Fehlerantwort der API (jeder Status ab 400). */
export interface LkErrorBody {
  message?: string;
  code?: string;
  requestId?: string;
}
