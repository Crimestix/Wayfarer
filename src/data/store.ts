/**
 * Ablage einer Kampagne: ein Ordner voller JSON-Dateien (der Kampagnenordner). Mehrere Rechner
 * teilen sich den Spielstand über den eingebauten Abgleich (`features/abgleich`), nie über ein
 * Cloud-Laufwerk.
 * Die App kennt nur diese Schnittstelle, nicht das Dateisystem.
 */
export interface StoredFile {
  /** Relativer Pfad mit „/“, z. B. „entities/abc123.json“. */
  path: string;
  content: string;
}

export interface CampaignStore {
  /** Für die Anzeige: wo die Kampagne liegt. */
  readonly location: string;
  readAll(): Promise<StoredFile[]>;
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Meldet Änderungen, die nicht von dieser App-Instanz stammen. */
  watch?(onChange: (paths: string[]) => void): () => void;
}

/** Flüchtige Ablage für Tests. */
export class MemoryStore implements CampaignStore {
  readonly location = 'Arbeitsspeicher';
  readonly files = new Map<string, string>();
  private watchers = new Set<(paths: string[]) => void>();

  constructor(initial: StoredFile[] = []) {
    for (const f of initial) this.files.set(f.path, f.content);
  }
  async readAll() {
    return [...this.files].map(([path, content]) => ({ path, content }));
  }
  async read(path: string) {
    return this.files.get(path) ?? null;
  }
  async write(path: string, content: string) {
    this.files.set(path, content);
  }
  async remove(path: string) {
    this.files.delete(path);
  }
  watch(onChange: (paths: string[]) => void) {
    this.watchers.add(onChange);
    return () => this.watchers.delete(onChange);
  }
  /** Simuliert eine Änderung von außen (anderes Gerät). */
  externalWrite(path: string, content: string | null) {
    if (content === null) this.files.delete(path);
    else this.files.set(path, content);
    for (const w of this.watchers) w([path]);
  }
}

/** Ablage im Browser (localStorage) – nur für die Vorschau ohne installierte App. */
export class BrowserStore implements CampaignStore {
  readonly location = 'Browser-Vorschau (nur dieses Gerät)';
  private prefix: string;

  constructor(name = 'default') {
    this.prefix = `wayfarer:${name}:`;
  }
  async readAll() {
    const out: StoredFile[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.prefix))
        out.push({ path: key.slice(this.prefix.length), content: localStorage.getItem(key) ?? '' });
    }
    return out;
  }
  async read(path: string) {
    return localStorage.getItem(this.prefix + path);
  }
  async write(path: string, content: string) {
    localStorage.setItem(this.prefix + path, content);
  }
  async remove(path: string) {
    localStorage.removeItem(this.prefix + path);
  }
  /** Löscht die gesamte Vorschau-Kampagne. */
  clear() {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.prefix)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  }
}
