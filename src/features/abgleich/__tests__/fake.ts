/**
 * Attrappe für die Tests des Abgleichs: Ablage und Bote stehen in `../fake.ts` (auch für die
 * Probe der Vorschau); hier dazu die falsche Uhr und `machine()` – ein „Rechner“ = Ordner +
 * Datenbank + Bote + Ablauf mit falscher Uhr.
 */
import { CampaignDb } from '../../../data/db';
import type { SyncLink } from '../../../data/platform';
import { MemoryStore } from '../../../data/store';
import type { CampaignData } from '../../../domain/schema';
import { createSyncEngine, type EngineOptions, type SyncEngine, type Timers } from '../engine';
import { MemoryPort, type FakeRepo } from '../fake';

export { FakeRepo, MemoryPort, gitSha, markerText, type CrashPoint } from '../fake';

// ── Falsche Uhr ──────────────────────────────────────────────────────────────

export class FakeTimers implements Timers {
  private t = Date.UTC(2026, 10, 15, 20, 0, 0);
  private next = 1;
  private queue = new Map<number, { at: number; fn: () => void }>();
  now() {
    return this.t;
  }
  set(fn: () => void, ms: number) {
    const id = this.next++;
    this.queue.set(id, { at: this.t + ms, fn });
    return id;
  }
  clear(handle: unknown) {
    this.queue.delete(handle as number);
  }
  pending() {
    return [...this.queue.values()].map((q) => q.at - this.t).sort((a, b) => a - b);
  }
  /** Lässt Zeit vergehen und führt Fälliges aus. */
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.queue.entries()]
        .filter(([, q]) => q.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.queue.delete(due[0]);
      this.t = due[1].at;
      due[1].fn();
      await settle();
    }
    this.t = end;
    await settle();
  }
}

/** Lässt alle wartenden Versprechen laufen. */
export async function settle() {
  // Die Kennungen rechnet WebCrypto abseits – das braucht echte Zeit, nicht nur Mikroaufgaben.
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 8));
}

// ── Ein Rechner ──────────────────────────────────────────────────────────────

export interface Machine {
  name: string;
  store: MemoryStore;
  db: CampaignDb;
  port: MemoryPort;
  engine: SyncEngine;
  timers: FakeTimers;
  drafts: {
    held: number;
    has(): boolean;
    subscribe(fn: () => void): () => void;
    set(n: number): void;
  };
  /** Neu öffnen wie nach einem Neustart (erst `recover`, dann die Datenbank). */
  restart(opts?: Partial<EngineOptions>): Promise<void>;
  link: SyncLink;
}

export async function machine(
  repo: FakeRepo,
  name: string,
  seed?: CampaignData,
  options: Partial<EngineOptions> = {},
): Promise<Machine> {
  const store = new MemoryStore();
  const port = new MemoryPort(repo, store, 'spielleiter', 'spielstand-elaris', `/${name}`);
  const timers = new FakeTimers();
  const listeners = new Set<() => void>();
  const drafts = {
    held: 0,
    has() {
      return this.held > 0;
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set(n: number) {
      this.held = n;
      for (const l of [...listeners]) l();
    },
  };
  const db = seed ? await CampaignDb.create(store, seed) : (null as unknown as CampaignDb);
  const m: Machine = {
    name,
    store,
    db,
    port,
    timers,
    drafts,
    link: {
      owner: 'spielleiter',
      repo: 'spielstand-elaris',
      branch: 'main',
      device: name,
      root: `/${name}`,
    },
    engine: null as unknown as SyncEngine,
    async restart(more = {}) {
      m.engine?.stop();
      m.db?.close();
      const { left } = await port.recover();
      if (left.length) throw new Error('Merkzettel liegt noch');
      m.db = await CampaignDb.open(store);
      m.engine = createSyncEngine(m.db, port, {
        root: `/${name}`,
        timers,
        drafts,
        reload: () => void 0,
        ...options,
        ...more,
      });
    },
  };
  if (seed)
    m.engine = createSyncEngine(db, port, {
      root: `/${name}`,
      timers,
      drafts,
      reload: () => void 0,
      ...options,
    });
  return m;
}
