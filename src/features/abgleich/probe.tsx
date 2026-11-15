/**
 * Probe des Abgleichs in der Browser-Vorschau (`npm run dev`, Adresse mit `?abgleich`) – nur
 * während der Entwicklung geladen, nie in der App. Zwei „Rechner“ gegen eine Ablage im Speicher
 * (die Attrappe aus `fake.ts`): Hier läuft die Oberfläche wie in der App, der andere Rechner wird
 * über eine kleine Tafel bedient. Alles liegt nur im Arbeitsspeicher; Neuladen beginnt von vorn.
 *
 * `?abgleich` – dieser Rechner ist der Windows-PC mit Elaris, die Ablage ist leer.
 * `?abgleich&welcome` – der Windows-PC hat schon hochgeladen; hier beginnt der Startbildschirm
 *   des MacBook („Spielstand vom anderen Rechner holen“).
 * `?abgleich=eingerichtet` – wie `?abgleich`, aber schon eingerichtet, und das MacBook hat geholt.
 */
import { useState, type JSX } from 'react';
import { advanceTime } from '../../data/actions';
import { CampaignDb } from '../../data/db';
import { useDb } from '../../data/hooks';
import { openCampaign } from '../../data/openCampaign';
import type {
  ApplyBeginInput,
  AsideReason,
  FetchItem,
  MarkInput,
  PushInput,
  SyncLink,
  SyncProgress,
} from '../../data/platform';
import { elarisCampaign } from '../../data/seed';
import { MemoryStore } from '../../data/store';
import type { CampaignData } from '../../domain/schema';
import { DATA_SHAPE, DATA_VERSION } from '../../domain/schema';
import type { WelcomeEnv } from '../../shell/Welcome';
import { createSyncEngine, fetchIntoEmptyFolder, type SyncEngine } from './engine';
import { FakeRepo, MemoryPort } from './fake';
import { setProbeEnv, type SyncEnv } from './index';
import type { SyncPort } from './port';

/** Ein Ordner im Speicher, der einen eigenen Ort trägt (die Attrappe erkennt daran Kopien). */
class ProbeStore extends MemoryStore {
  constructor(where: string) {
    super();
    Object.defineProperty(this, 'location', { value: where });
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ein Rechner: ein Schlüsselbund, beliebig viele Ordner (je Ordner ein Bote der Attrappe). */
class Machine implements SyncPort {
  key: 'yes' | 'no' | 'denied' = 'no';
  readonly stores = new Map<string, ProbeStore>();
  private ports = new Map<string, MemoryPort>();
  private listeners = new Set<(p: SyncProgress) => void>();

  constructor(
    readonly repo: FakeRepo,
    readonly device: string,
  ) {}

  store(root: string): ProbeStore {
    let store = this.stores.get(root);
    if (!store) this.stores.set(root, (store = new ProbeStore(root)));
    return store;
  }
  port(root: string): MemoryPort {
    let port = this.ports.get(root);
    if (!port) {
      port = new MemoryPort(this.repo, this.store(root), 'spielleiter', 'spielstand-elaris', root);
      this.ports.set(root, port);
    }
    port.key = this.key;
    return port;
  }
  private any(): MemoryPort {
    return this.port(`/Probe/${this.device}`);
  }
  env(): SyncEnv {
    return {
      port: this,
      onProgress: (fn) => {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
      },
    };
  }
  /** Langsam mit Fortschritt, damit Balken und Zeilen zu sehen sind. */
  private async steps(phase: SyncProgress['phase'], total: number) {
    if (!total) return;
    for (let i = 1; i <= 4; i++) {
      await wait(180);
      const done = Math.round((total * i) / 4);
      for (const l of [...this.listeners]) l({ phase, done, total });
    }
  }

  state(root: string, dataVersion: number) {
    return this.port(root).state(root, dataVersion);
  }
  async setKey(key: string) {
    await this.any().setKey(key);
    this.key = 'yes';
  }
  async clearKey() {
    this.key = 'no';
  }
  async probe() {
    await wait(300);
    return this.any().probe();
  }
  link(root: string, link: SyncLink | null, moveTo?: boolean) {
    return this.port(root).link(root, link, moveTo);
  }
  recover(root: string) {
    return this.port(root).recover();
  }
  async scan(root: string, remote: boolean, retryKey?: boolean, link?: SyncLink) {
    if (remote) await wait(250);
    return this.port(root).scan(root, remote, retryKey, link);
  }
  async fetch(root: string, items: FetchItem[], link?: SyncLink) {
    await this.steps('holen', items.length);
    void link;
    return this.port(root).fetch(root, items);
  }
  applyBegin(input: ApplyBeginInput) {
    return this.port(input.root).applyBegin(input);
  }
  applyEnd(root: string, run: number) {
    return this.port(root).applyEnd(root, run);
  }
  applyAbort(root: string, run: number) {
    return this.port(root).applyAbort(root, run);
  }
  async push(input: PushInput) {
    await this.steps('hochladen', input.changes.length);
    return this.port(input.root).push(input);
  }
  mark(input: MarkInput) {
    return this.port(input.root).mark(input);
  }
  asideList(root: string) {
    return this.port(root).asideList();
  }
  asideRead(root: string, run: number, side: 'hier' | 'dort', path: string) {
    return this.port(root).asideRead(root, run, side, path);
  }
  asidePut(root: string, paths: string[], reason: AsideReason) {
    return this.port(root).asidePut(root, paths, reason);
  }
  asideDrop(root: string, run: number) {
    return this.port(root).asideDrop(root, run);
  }
}

const linkOf = (device: string, root: string): SyncLink => ({
  owner: 'spielleiter',
  repo: 'spielstand-elaris',
  branch: 'main',
  device,
  root,
});

interface Other {
  machine: Machine;
  root: string;
  db: CampaignDb | null;
  engine: SyncEngine | null;
}

export interface Probe {
  /** Startbildschirm (nur `?welcome`). */
  welcome: WelcomeEnv | null;
  /** Dieser Rechner: Ordner öffnen (auch nach „Der Stand aus der Ablage gilt“). */
  reopen(): Promise<CampaignDb>;
  root: string;
  Panel: () => JSX.Element;
}

let folders = 0;

export async function startProbe(welcome: boolean, ready = false): Promise<Probe> {
  const repo = new FakeRepo();
  const pc = new Machine(repo, 'Windows-PC');
  const mac = new Machine(repo, 'MacBook');
  const here = welcome ? mac : pc;
  const other: Other = {
    machine: welcome ? pc : mac,
    root: `/Probe/${welcome ? 'Windows-PC' : 'MacBook'}`,
    db: null,
    engine: null,
  };
  let root = `/Probe/${here.device}`;

  const engineFor = (machine: Machine, dir: string, db: CampaignDb) =>
    createSyncEngine(db, machine, { root: dir, dataVersion: DATA_VERSION, dataShape: DATA_SHAPE });

  if (welcome) {
    // Der Windows-PC hat den Abgleich schon eingerichtet und hochgeladen.
    pc.key = 'yes';
    const db = await CampaignDb.create(pc.store(other.root), elarisCampaign());
    const engine = engineFor(pc, other.root, db);
    await engine.firstSync('upload', linkOf('Windows-PC', other.root));
    other.db = db;
    other.engine = engine;
  } else {
    await CampaignDb.create(here.store(root), elarisCampaign());
  }

  const openHere = (dir: string) =>
    openCampaign(dir, {
      recover: (r) => here.recover(r),
      open: (r) => CampaignDb.open(here.store(r)),
    });

  /** Der andere Rechner holt den Spielstand (wie „Spielstand vom anderen Rechner holen“). */
  const otherFetch = async () => {
    other.machine.key = 'yes';
    const link = linkOf(other.machine.device, other.root);
    await fetchIntoEmptyFolder(other.machine, other.root, link);
    other.db = await openCampaign(other.root, {
      recover: (r) => other.machine.recover(r),
      open: (r) => CampaignDb.open(other.machine.store(r)),
    });
    other.engine = engineFor(other.machine, other.root, other.db);
  };

  if (ready && !welcome) {
    here.key = 'yes';
    const db = await openHere(root);
    await engineFor(here, root, db).firstSync('upload', linkOf(here.device, root));
    db.close();
    await otherFetch();
  }

  const welcomeEnv: WelcomeEnv = {
    async pickFolder() {
      await wait(100);
      folders++;
      root = folders === 1 ? `/Probe/${here.device}` : `/Probe/Ordner-${folders}`;
      return root;
    },
    open: openHere,
    create: (dir, data: CampaignData) => CampaignDb.create(here.store(dir), data),
    remember: async () => undefined,
    sync: here.env(),
  };

  function Panel() {
    const db = useDb();
    const [open, setOpen] = useState(true);
    const [line, setLine] = useState('');
    const [, bump] = useState(0);
    const name = other.machine.device;
    const act = (label: string, fn: () => Promise<void> | void) => async () => {
      setLine(`${label} …`);
      try {
        await fn();
        setLine(`${label}: erledigt.`);
      } catch (e) {
        setLine(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      }
      bump((n) => n + 1);
    };
    /** Ein Eintrag der Welt, den beide Rechner gleich finden (der Grundstand hat nur Gefährten). */
    const person = (d: CampaignDb) =>
      Object.values(d.getSnapshot().entities).sort((a, b) => (a.name < b.name ? -1 : 1))[0]!;
    const needOther = () => {
      if (!other.db || !other.engine) throw new Error(`Der ${name} hat noch nichts geholt.`);
      return { db: other.db, engine: other.engine };
    };
    const herePort = here.port(root);
    if (!open)
      return (
        <button
          type="button"
          className="wf-abgleich-probe wf-abgleich-probe--closed"
          onClick={() => setOpen(true)}
        >
          Probe
        </button>
      );
    return (
      <div className="wf-abgleich-probe" role="region" aria-label="Probe des Abgleichs">
        <div className="wf-abgleich-probe__head">
          <strong>Probe des Abgleichs</strong> (nur Vorschau) · hier: {here.device}
          <button type="button" onClick={() => setOpen(false)} aria-label="Zuklappen">
            ×
          </button>
        </div>
        <div className="wf-abgleich-probe__grid">
          {!other.db && (
            <button type="button" onClick={act(`${name} holt den Spielstand`, otherFetch)}>
              {name} holt den Spielstand
            </button>
          )}
          <button
            type="button"
            onClick={act(`${name} ändert etwas`, async () => {
              const o = needOther();
              o.db.patch('entities', person(o.db).id, { tagline: `Am ${name} geändert` });
              await o.db.flush();
              await o.engine.syncNow();
            })}
          >
            {name} ändert etwas
          </button>
          <button
            type="button"
            onClick={act('Widerspruch an einer Person', async () => {
              const o = needOther();
              const id = person(db).id;
              db.patch('entities', id, {
                notes: 'Hier geschrieben: Sie misstraut dem Hafenmeister.',
              });
              o.db.patch('entities', id, {
                notes: `Am ${name} geschrieben: Sie schuldet der Gilde Geld.`,
              });
              await o.db.flush();
              await o.engine.syncNow();
            })}
          >
            Widerspruch an einer Person
          </button>
          <button
            type="button"
            onClick={act('Beide lassen Zeit vergehen', async () => {
              const o = needOther();
              advanceTime(db, db.getSnapshot().state.now + 60);
              advanceTime(o.db, o.db.getSnapshot().state.now + 3 * 1440);
              await o.db.flush();
              await o.engine.syncNow();
            })}
          >
            Beide lassen Zeit vergehen
          </button>
          <button
            type="button"
            onClick={act(`${name} löscht, was hier geändert ist`, async () => {
              const o = needOther();
              const id = Object.keys(o.db.getSnapshot().events).sort()[0];
              if (!id) throw new Error('Kein Termin da.');
              db.patch('events', id, { title: 'Hier inzwischen geändert' });
              o.db.remove('events', id);
              await o.db.flush();
              await o.engine.syncNow();
            })}
          >
            {name} löscht einen Termin, der hier geändert ist
          </button>
          <button
            type="button"
            onClick={act('Netz', () => {
              repo.failAlways = repo.failAlways === 'offline' ? null : 'offline';
            })}
          >
            Netz {repo.failAlways === 'offline' ? 'wieder an' : 'aus'}
          </button>
          <button
            type="button"
            onClick={act('Schlüssel bei GitHub', () => {
              repo.failAlways = repo.failAlways === 'key' ? null : 'key';
            })}
          >
            {repo.failAlways === 'key' ? 'Schlüssel gilt wieder' : 'Schlüssel bei GitHub gelöscht'}
          </button>
          <button
            type="button"
            onClick={act('Ordner', () => {
              herePort.location = herePort.location === root ? '/Probe/Kopie' : root;
            })}
          >
            {herePort.location === root ? 'Ordner als Kopie öffnen' : 'Ordner wieder am alten Ort'}
          </button>
          <button
            type="button"
            onClick={act(`${name} mit neuerer Version`, () => {
              const marker = repo.markerOf(repo.head);
              repo.commitAs(
                name,
                {},
                {
                  datenstand: DATA_VERSION + 1,
                  gestalt: 'neuer',
                  geraete: { ...(marker?.geraete ?? {}), [name]: DATA_VERSION + 1 },
                },
              );
            })}
          >
            {name} mit neuerer Version
          </button>
        </div>
        {line && <div className="wf-abgleich-probe__line">{line}</div>}
      </div>
    );
  }

  setProbeEnv(here.env());
  return {
    welcome: welcome ? welcomeEnv : null,
    get root() {
      return root;
    },
    reopen: () => openHere(root),
    Panel,
  };
}
