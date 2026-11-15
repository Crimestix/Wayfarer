/**
 * Der geladene Spielstand im Arbeitsspeicher. Lädt alle Dokumente aus der Ablage, prüft sie,
 * hält sie als unveränderliche Momentaufnahme bereit und schreibt Änderungen zurück.
 *
 * Regeln:
 * - Jede Änderung läuft über put / remove / setState / setCampaign (oder die Befehle in actions.ts).
 * - Ungültige oder fremde Dateien werden nie überschrieben, nur gemeldet.
 * - Änderungen von außen werden übernommen, solange hier nichts Ungespeichertes für dieselbe
 *   Datei wartet.
 * - Was der Abgleich vom anderen Rechner bringt, kommt nur über `takeRemote` herein: wörtlich, in
 *   einem Schritt, alles oder nichts.
 * - Nach `close()` wird nichts mehr angenommen und nichts mehr geschrieben.
 */
import {
  COLLECTION_NAMES,
  COLLECTION_SCHEMAS,
  CampaignMetaSchema,
  PlayStateSchema,
  emptyCollections,
  nowIso,
  type CampaignData,
  type CampaignMeta,
  type CollectionName,
  type CollectionTypes,
  type PlayState,
} from '../domain/schema';
import { NEVER_DELETED, isSyncedPath } from '../domain/sync';
import { checkIncoming } from '../domain/syncMerge';
import type { CampaignStore, StoredFile } from './store';

export type SaveStatus = 'saved' | 'saving' | 'error';

export interface LoadProblem {
  path: string;
  message: string;
}

/** Eine Datei vom anderen Rechner (Abgleich); `content: null` = dort gelöscht. */
export interface RemoteFile {
  path: string;
  content: string | null;
}

/** Ergebnis von `takeRemote`: Bei `ok: false` ist nichts geändert. */
export interface TakeResult {
  ok: boolean;
  /** Hier wartet für diesen Pfad etwas, oder die Platte steht nicht mehr wie im Abbild. */
  busy: string[];
  /** Ungültig: Schema, Kennung ≠ Dateiname, fremder Pfad oder Löschen von campaign/state. */
  invalid: string[];
}

const CLOSED = 'Die Kampagne wird gerade neu geladen.';

/** Die Ablage enthält noch keine Kampagne. */
export class CampaignMissingError extends Error {
  constructor() {
    super('In diesem Ordner liegt noch keine Wayfarer-Kampagne.');
  }
}

const CAMPAIGN_PATH = 'campaign.json';
/** Wartezeit bis zum nächsten Speicherversuch nach einem Fehler. */
const RETRY_MS = 5000;
const STATE_PATH = 'state.json';
const docPath = (collection: CollectionName, id: string) => `${collection}/${id}.json`;
const serialize = (doc: unknown) => JSON.stringify(doc, null, 1) + '\n';

type Listener = () => void;

export class CampaignDb {
  private data: CampaignData;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<Listener>();
  private pending = new Map<string, string | null>();
  private lastWritten = new Map<string, string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> | null = null;
  private batchDepth = 0;
  private dirty = false;
  private status: SaveStatus = 'saved';
  private lastError = '';
  private unwatch: (() => void) | null = null;
  private changes = 0;
  private closed = false;
  /** Dateien, die beim Laden nicht gelesen werden konnten. */
  problems: LoadProblem[] = [];

  private constructor(
    readonly store: CampaignStore,
    data: CampaignData,
  ) {
    this.data = data;
    this.unwatch = store.watch?.((paths) => void this.reload(paths)) ?? null;
  }

  // ── Öffnen und Anlegen ───────────────────────────────────────────────────

  static async open(store: CampaignStore): Promise<CampaignDb> {
    const files = await store.readAll();
    const byPath = new Map(files.map((f) => [f.path, f.content]));
    const campaignRaw = byPath.get(CAMPAIGN_PATH);
    if (campaignRaw === undefined) throw new CampaignMissingError();
    const campaign = CampaignMetaSchema.parse(JSON.parse(campaignRaw));
    const stateRaw = byPath.get(STATE_PATH);
    const state = PlayStateSchema.parse(stateRaw ? JSON.parse(stateRaw) : { id: 'state', now: 0 });
    const data: CampaignData = { campaign, state, ...emptyCollections() };
    const db = new CampaignDb(store, data);
    const next = { ...data } as Record<string, unknown>;
    for (const name of COLLECTION_NAMES) next[name] = {};
    for (const file of files) {
      db.lastWritten.set(file.path, file.content);
      const parsed = db.parseDoc(file);
      if (parsed) (next[parsed.collection] as Record<string, unknown>)[parsed.doc.id] = parsed.doc;
    }
    db.data = next as unknown as CampaignData;
    return db;
  }

  /** Schreibt eine neue Kampagne in eine leere Ablage. */
  static async create(store: CampaignStore, seed: CampaignData): Promise<CampaignDb> {
    const db = new CampaignDb(store, seed);
    db.pending.set(CAMPAIGN_PATH, serialize(seed.campaign));
    db.pending.set(STATE_PATH, serialize(seed.state));
    for (const name of COLLECTION_NAMES)
      for (const doc of Object.values(seed[name]))
        db.pending.set(docPath(name, doc.id), serialize(doc));
    await db.flush();
    return db;
  }

  private parseDoc(
    file: StoredFile,
  ): { collection: CollectionName; doc: CollectionTypes[CollectionName] } | null {
    const match = /^([a-z]+)\/([^/]+)\.json$/.exec(file.path);
    if (!match) return null;
    const collection = match[1] as CollectionName;
    if (!COLLECTION_NAMES.includes(collection)) return null;
    try {
      const doc = COLLECTION_SCHEMAS[collection].parse(JSON.parse(file.content));
      if (doc.id !== match[2]) {
        this.setProblem(
          file.path,
          'Dateiname und Kennung passen nicht zusammen (vermutlich eine Konfliktkopie).',
        );
        return null;
      }
      this.setProblem(file.path, null);
      return { collection, doc };
    } catch (error) {
      this.setProblem(file.path, error instanceof Error ? error.message.slice(0, 300) : 'Unlesbar');
      return null;
    }
  }

  /** Merkt ein Ladeproblem je Datei genau einmal; null entfernt es (Datei inzwischen in Ordnung). */
  private setProblem(path: string, message: string | null) {
    const rest = this.problems.filter((p) => p.path !== path);
    this.problems = message === null ? rest : [...rest, { path, message }];
  }

  // ── Lesen ────────────────────────────────────────────────────────────────

  getSnapshot = (): CampaignData => this.data;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getStatus = (): SaveStatus => this.status;
  getLastError = (): string => this.lastError;

  subscribeStatus = (listener: Listener) => {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  };

  // ── Ändern ───────────────────────────────────────────────────────────────

  /** Legt ein Dokument an oder ersetzt es. Gibt die gespeicherte Fassung zurück. */
  put<C extends CollectionName>(collection: C, doc: CollectionTypes[C]): CollectionTypes[C] {
    this.assertOpen();
    const stamped = { ...doc, rev: doc.rev + 1, updated: nowIso() } as CollectionTypes[C];
    const valid = COLLECTION_SCHEMAS[collection].parse(stamped) as CollectionTypes[C];
    this.data = { ...this.data, [collection]: { ...this.data[collection], [valid.id]: valid } };
    this.enqueue(docPath(collection, valid.id), serialize(valid));
    return valid;
  }

  /** Ändert einzelne Felder eines vorhandenen Dokuments. */
  patch<C extends CollectionName>(
    collection: C,
    id: string,
    change: Partial<CollectionTypes[C]>,
  ): CollectionTypes[C] {
    const current = (this.data[collection] as Record<string, CollectionTypes[C]>)[id];
    if (!current) throw new Error('Der Eintrag existiert nicht mehr.');
    return this.put(collection, { ...current, ...change });
  }

  remove(collection: CollectionName, id: string): void {
    this.assertOpen();
    if (!(id in this.data[collection])) return;
    const next = { ...this.data[collection] } as Record<string, unknown>;
    delete next[id];
    this.data = { ...this.data, [collection]: next };
    this.enqueue(docPath(collection, id), null);
  }

  setState(change: Partial<Omit<PlayState, 'id'>>): void {
    this.assertOpen();
    const state = PlayStateSchema.parse({
      ...this.data.state,
      ...change,
      rev: this.data.state.rev + 1,
      updated: nowIso(),
    });
    this.data = { ...this.data, state };
    this.enqueue(STATE_PATH, serialize(state));
  }

  setCampaign(change: Partial<Omit<CampaignMeta, 'id' | 'schema'>>): void {
    this.assertOpen();
    const campaign = CampaignMetaSchema.parse({
      ...this.data.campaign,
      ...change,
      rev: this.data.campaign.rev + 1,
      updated: nowIso(),
    });
    this.data = { ...this.data, campaign };
    this.enqueue(CAMPAIGN_PATH, serialize(campaign));
  }

  /**
   * Tauscht den gesamten Spielstand aus (Sicherung einspielen, alten Spielstand übernehmen):
   * Alle bisherigen Dokumente werden entfernt, die neuen geschrieben, und es gibt genau eine
   * Benachrichtigung. Vorher wird alles mit den Schemata geprüft – ist etwas ungültig, bleibt
   * der bisherige Stand unangetastet. Dateien, die beim Laden unlesbar waren, bleiben liegen.
   */
  replaceAll(next: CampaignData): void {
    this.assertOpen();
    const campaign = CampaignMetaSchema.parse(next.campaign);
    const state = PlayStateSchema.parse(next.state);
    const unreadable = new Set(this.problems.map((p) => p.path));
    const collections = {} as Record<
      CollectionName,
      Record<string, CollectionTypes[CollectionName]>
    >;
    for (const name of COLLECTION_NAMES) {
      const docs: Record<string, CollectionTypes[CollectionName]> = {};
      for (const [key, raw] of Object.entries(next[name])) {
        const doc = COLLECTION_SCHEMAS[name].parse(raw);
        if (doc.id !== key)
          throw new Error(`Ein Eintrag in „${name}“ trägt eine andere Kennung als sein Schlüssel.`);
        if (unreadable.has(docPath(name, doc.id)))
          throw new Error(
            `Im Kampagnenordner liegt eine unlesbare Datei „${docPath(name, doc.id)}“, die nicht überschrieben wird. Bitte zuerst diese Datei prüfen.`,
          );
        docs[doc.id] = doc;
      }
      collections[name] = docs;
    }
    // Erst ab hier wird verändert.
    for (const name of COLLECTION_NAMES) {
      for (const id of Object.keys(this.data[name]))
        if (!(id in collections[name])) this.pending.set(docPath(name, id), null);
      for (const doc of Object.values(collections[name]))
        this.pending.set(docPath(name, doc.id), serialize(doc));
    }
    this.pending.set(CAMPAIGN_PATH, serialize(campaign));
    this.pending.set(STATE_PATH, serialize(state));
    this.data = { campaign, state, ...collections } as unknown as CampaignData;
    this.changes++;
    this.setStatus('saving');
    this.notify();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), 250);
  }

  /** Fasst mehrere Änderungen zu einer Benachrichtigung zusammen. */
  batch<T>(fn: () => T): T {
    this.batchDepth++;
    try {
      return fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.dirty) this.notify();
    }
  }

  /**
   * Übernimmt Dateien vom anderen Rechner (Abgleich) – wörtlich, in einem Schritt, alles oder
   * nichts. `disk` ist das Abbild (`diskSnapshot`), gegen das der Abgleich geplant hat: Wartet
   * für einen Pfad noch etwas, oder steht auf der Platte inzwischen etwas anderes, wird nichts
   * übernommen (`busy`). Ebenso, wenn eine Datei nicht durchs Schema kommt (`invalid`).
   * Geschrieben wird der gelieferte Text selbst – so bleiben Felder, die dieses Programm nicht kennt.
   */
  takeRemote(files: readonly RemoteFile[], disk: ReadonlyMap<string, string>): TakeResult {
    this.assertOpen();
    const busy: string[] = [];
    const invalid: string[] = [];
    for (const { path, content } of files) {
      if (
        !isSyncedPath(path) ||
        (content === null && (NEVER_DELETED as readonly string[]).includes(path)) ||
        (content !== null && !checkIncoming(path, content).ok)
      ) {
        invalid.push(path);
        continue;
      }
      if (
        this.pending.has(path) ||
        (this.lastWritten.get(path) ?? null) !== (disk.get(path) ?? null)
      )
        busy.push(path);
    }
    if (busy.length || invalid.length) return { ok: false, busy, invalid };
    for (const { path, content } of files) {
      this.applyExternal(path, content);
      this.pending.set(path, content);
    }
    this.changes++;
    this.setStatus('saving');
    this.notify();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), 250);
    return { ok: true, busy, invalid };
  }

  /** Zählt jede Änderung im Speicher – der Abgleich merkt so, ob während seines Laufs etwas geschah. */
  changeMark(): number {
    return this.changes;
  }

  /** Was zuletzt auf der Platte stand bzw. geschrieben wurde: Pfad → Text. */
  diskSnapshot(): ReadonlyMap<string, string> {
    return new Map(this.lastWritten);
  }

  private assertOpen() {
    if (this.closed) throw new Error(CLOSED);
  }

  private enqueue(path: string, content: string | null) {
    this.changes++;
    this.pending.set(path, content);
    this.setStatus('saving');
    this.notify();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), 250);
  }

  private notify() {
    if (this.batchDepth > 0) {
      this.dirty = true;
      return;
    }
    this.dirty = false;
    for (const listener of this.listeners) listener();
  }

  private setStatus(status: SaveStatus, error = '') {
    if (this.status === status && this.lastError === error) return;
    this.status = status;
    this.lastError = error;
    for (const listener of this.statusListeners) listener();
  }

  // ── Speichern ────────────────────────────────────────────────────────────

  /** Schreibt alle wartenden Änderungen. Fehler bleiben in der Warteschlange. */
  async flush(): Promise<void> {
    if (this.closed) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.writing) await this.writing;
    if (!this.pending.size) return;
    this.writing = (async () => {
      try {
        while (this.pending.size) {
          const [path, content] = this.pending.entries().next().value as [string, string | null];
          if (content === null) {
            await this.store.remove(path);
            this.lastWritten.delete(path);
          } else {
            await this.store.write(path, content);
            this.lastWritten.set(path, content);
          }
          if (this.pending.get(path) === content) this.pending.delete(path);
        }
        this.setStatus('saved');
      } catch (error) {
        this.setStatus('error', error instanceof Error ? error.message : String(error));
        // Von selbst erneut versuchen (z. B. wenn ein Laufwerk kurz nicht erreichbar war).
        if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush(), RETRY_MS);
      } finally {
        this.writing = null;
      }
    })();
    await this.writing;
  }

  hasUnsavedChanges(): boolean {
    return this.pending.size > 0;
  }

  // ── Änderungen von außen ─────────────────────────────────────────────────

  private async reload(paths: string[]) {
    let changed = false;
    for (const path of paths) {
      if (this.pending.has(path)) continue;
      const before = this.lastWritten.get(path);
      const content = await this.store.read(path);
      // Während des Lesens wurde dieselbe Datei geschrieben oder wartet wieder: Dann gilt der
      // Speicher, nicht das, was unterwegs gelesen wurde.
      if (this.pending.has(path) || this.lastWritten.get(path) !== before) continue;
      if (content === (this.lastWritten.get(path) ?? null)) continue;
      if (content === null) this.lastWritten.delete(path);
      else this.lastWritten.set(path, content);
      changed = this.applyExternal(path, content) || changed;
    }
    if (changed) {
      this.changes++;
      this.notify();
    }
  }

  private applyExternal(path: string, content: string | null): boolean {
    try {
      if (path === CAMPAIGN_PATH && content !== null) {
        this.data = { ...this.data, campaign: CampaignMetaSchema.parse(JSON.parse(content)) };
        return true;
      }
      if (path === STATE_PATH && content !== null) {
        this.data = { ...this.data, state: PlayStateSchema.parse(JSON.parse(content)) };
        return true;
      }
    } catch {
      return false;
    }
    const match = /^([a-z]+)\/([^/]+)\.json$/.exec(path);
    if (!match) return false;
    const collection = match[1] as CollectionName;
    if (!COLLECTION_NAMES.includes(collection)) return false;
    const next = { ...this.data[collection] } as Record<string, unknown>;
    if (content === null) {
      this.setProblem(path, null);
      if (!(match[2]! in next)) return false;
      delete next[match[2]!];
    } else {
      const parsed = this.parseDoc({ path, content });
      if (!parsed) return false;
      next[parsed.doc.id] = parsed.doc;
    }
    this.data = { ...this.data, [collection]: next };
    return true;
  }

  /** Schließt die Kampagne: Danach wird nichts mehr angenommen und nichts mehr geschrieben. */
  close() {
    this.closed = true;
    this.unwatch?.();
    this.unwatch = null;
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }
}
