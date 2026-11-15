/**
 * Der Ablauf eines Abgleichs (Entwurf, Abschnitt 3.3): holen und prüfen → beiseitelegen →
 * Merkzettel → anwenden → hochladen mit Schutz gegen gleichzeitiges Schreiben → bei einem
 * Wettlauf von vorn, mit Grenzen.
 *
 * Regeln, die hier nie umgangen werden:
 * - Übernommenes kommt nur über `db.takeRemote` herein (alles oder nichts).
 * - Angewendet wird nur in einem ruhigen Moment (kein offener Entwurf); Hochladen geht trotzdem.
 * - Ein Widerspruch hält nur seinen Eintrag an; alles andere läuft weiter.
 * - Ohne gemeinsamen Stand wird nie still gelöscht oder gemischt (erster Abgleich, `firstSync`).
 * - Ein älteres Programm holt, lädt aber nicht hoch.
 * - Am Tisch nie ein Dialog: Der Ablauf meldet nur über seinen Stand (`state.ts`).
 */
import { settleTime, type SettleSummary } from '../../data/actions';
import type { CampaignDb, RemoteFile } from '../../data/db';
import {
  SyncFailure,
  toSyncFailure,
  type ApplyWrite,
  type FetchItem,
  type SyncDecision,
  type SyncFile,
  type SyncLink,
  type SyncScan,
} from '../../data/platform';
import { DATA_SHAPE, DATA_VERSION } from '../../domain/schema';
import {
  blobSha,
  compareWithoutBase,
  countChanges,
  isSyncedPath,
  planSync,
  type Sha,
  type SyncStep,
} from '../../domain/sync';
import {
  checkIncoming,
  fillStrippedFile,
  mergeFile,
  type Choose,
  type Json,
} from '../../domain/syncMerge';
import type { SyncPort } from './port';
import {
  INITIAL_VIEW,
  createViewStore,
  type FirstSyncInfo,
  type NeedsWhy,
  type RawConflict,
  type SyncView,
  type ViewStore,
} from './state';

export interface Timers {
  now(): number;
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface DraftRegister {
  has(): boolean;
  subscribe(fn: () => void): () => void;
}

export interface EngineOptions {
  /** Der Kampagnenordner (in der App `db.store.location`). */
  root?: string;
  timers?: Timers;
  /** Vor dem Lesen: offene Editoren speichern lassen (`flushEdits`). */
  beforeScan?: () => void;
  drafts?: DraftRegister;
  dataVersion?: number;
  dataShape?: string;
  /** Nach „Der Stand aus der Ablage gilt“: die App neu laden (dann bringt `openCampaign` es zu Ende). */
  reload?: () => void;
}

export type Choice = 'local' | 'remote' | 'ok' | 'back';

export interface SyncEngine {
  readonly view: ViewStore;
  start(): void;
  stop(): void;
  syncNow(): Promise<void>;
  /** Frischer Lauf, bevor der Dialog öffnet. */
  lookAgain(): Promise<SyncView>;
  decide(choices: Record<string, Choice>): Promise<void>;
  /** Erster Abgleich (kein gemeinsamer Stand): ausdrücklich gewählt. */
  firstSync(choice: 'upload' | 'localWins' | 'remoteWins', link?: SyncLink): Promise<void>;
  /** Der Ordner ist eine Kopie oder wurde verschoben (Frage 1.15). */
  confirmMove(isMine: boolean): Promise<void>;
  /** Beim Schließen: nur hochladen. */
  beforeClose(): Promise<void>;
  /** Fenster verliert den Fokus oder wird verborgen: bald hochladen. */
  pushSoon(): void;
  /** Fenster bekommt den Fokus, wird sichtbar, Rechner wacht auf. */
  wake(): void;
  /**
   * Führt `work` aus, während kein Lauf unterwegs ist und keiner beginnt (wartet auf einen
   * laufenden). Für alles, was den gemeinsamen Stand von außen ändert (`syncBeforeRestore`).
   */
  hold<T>(work: () => Promise<T>): Promise<T>;
  /** „Noch einmal versuchen“, nachdem der Schlüsselbund den Schlüssel verweigert hat. */
  retryKeychain(): Promise<void>;
  /**
   * Einrichten, Schritt 5: Was liegt in der gewählten Ablage, verglichen mit hier? Ändert nichts
   * (kein gemeinsamer Stand, keine Verbindung).
   */
  compareFirst(link: SyncLink): Promise<FirstSyncInfo & { older: boolean }>;
  /** „Abgleich trennen“: Verbindung weg, Spielstand bleibt; auf Wunsch auch den Schlüssel. */
  disconnect(removeKey: boolean): Promise<void>;
  /**
   * Beiseitegelegte Fassungen zurückholen (alle eines Laufs oder die genannten). Die heutigen
   * Fassungen werden vorher ihrerseits beiseitegelegt. Eine gewöhnliche Änderung, die danach
   * abgeglichen wird. Ergebnis: wie viele zurückgeholt wurden.
   */
  restoreAside(run: number, only?: { side: 'hier' | 'dort'; path: string }[]): Promise<number>;
}

/** Wartezeiten (ms). */
export const TIMING = {
  /** Nach dem letzten „Gespeichert“. */
  quiet: 30_000,
  /** Bei Dauerarbeit spätestens nach der ersten Änderung. */
  cap: 5 * 60_000,
  /** Fokus/Aufwachen: nur, wenn der letzte Blick älter ist. */
  look: 60_000,
  /** Nur hochladen frühestens so lange nach dem letzten Lauf. */
  pushGap: 20_000,
  /** Regelmäßig. */
  every: 10 * 60_000,
  /** Kein Netz: 1, 2, 5, dann alle 10 Minuten. */
  backoff: [60_000, 120_000, 300_000, 600_000],
  /** busy / Entwurf offen. */
  retry: 20_000,
  /** Von vorn (moved, Änderung während des Laufs): höchstens so oft, dann später. */
  attempts: 3,
};

type Attempt = 'done' | 'again' | 'stop';

interface Pending {
  path: string;
  kind: RawConflict['kind'];
  remote: Sha | null;
  fields: string[][] | null;
  massKind?: 'deleteHere' | 'deleteThere' | 'changeHere';
  paths?: string[];
}

const parseJson = (text: string | null | undefined): Json | null => {
  if (text === null || text === undefined) return null;
  try {
    return JSON.parse(text) as Json;
  } catch {
    return null;
  }
};
const updatedOf = (json: Json | null): string | null =>
  json && typeof json === 'object' && !Array.isArray(json) && typeof json.updated === 'string'
    ? json.updated
    : null;
const toMap = (files: readonly SyncFile[]) => new Map(files.map((f) => [f.path, f.sha]));

/** Prüft, ob die Liste der Rust-Seite zum Abbild der Datenbank passt. */
async function matchesDisk(disk: ReadonlyMap<string, string>, scan: SyncScan): Promise<boolean> {
  const listed = new Set(scan.local.map((f) => f.path));
  const frozen = new Set(scan.frozen.map((f) => f.path));
  for (const file of scan.local) {
    const text = disk.get(file.path);
    if (text === undefined || (await blobSha(text)) !== file.sha) return false;
  }
  for (const path of disk.keys())
    if (isSyncedPath(path) && !listed.has(path) && !frozen.has(path)) return false;
  return true;
}

export function createSyncEngine(
  db: CampaignDb,
  port: SyncPort,
  opts: EngineOptions = {},
): SyncEngine {
  const root = opts.root ?? db.store.location;
  const timers = opts.timers ?? realTimers;
  const dataVersion = opts.dataVersion ?? DATA_VERSION;
  const dataShape = opts.dataShape ?? DATA_SHAPE;
  const view = createViewStore({ ...INITIAL_VIEW });
  const nowIso = () => new Date(timers.now()).toISOString();

  let running: Promise<void> | null = null;
  let again: 'full' | 'push' | null = null;
  let applying = false;
  let retryKey = false;
  let started = false;
  let failures = 0;
  /** Kein Netz oder Pause von GitHub: Von selbst wird vorher nicht wieder gefragt. */
  let notBefore = 0;
  let lastLook = 0;
  let lastRun = 0;
  let firstChange: number | null = null;
  let timer: unknown = null;
  let every: unknown = null;
  let offs: (() => void)[] = [];
  /** Offene Rückfragen dieses Laufs (je id), mit dem, was eine Entscheidung braucht. */
  let pendings = new Map<string, Pending>();
  let lastLocal = new Map<string, Sha>();

  /**
   * Braucht es den Spielleiter wegen einer Antwort von GitHub (Schlüssel, Recht, Ablage weg),
   * fragt der Ablauf von selbst nicht wieder – 401 nie wiederholen. Erst ein ausdrücklicher Lauf.
   */
  const blocked = () => {
    const { phase, needs } = view.get();
    const why = needs?.why;
    return phase === 'needsYou' && (why === 'key' || why === 'denied' || why === 'missing');
  };

  /** Ein Lauf von selbst (Takt, Speichern, Fokus …): nie vor `notBefore`, nie, wenn gesperrt. */
  const schedule = (ms: number, mode: 'full' | 'push' = 'full') => {
    if (!started || blocked()) return;
    const wait = Math.max(ms, notBefore - timers.now());
    if (timer !== null) timers.clear(timer);
    timer = timers.set(() => {
      timer = null;
      void run(mode);
    }, wait);
  };
  const auto = (mode: 'full' | 'push' = 'full') => {
    if (blocked()) return;
    if (timers.now() >= notBefore) void run(mode);
    // Die Wartezeit läuft schon (der Versuch danach ist geplant) – nichts vorziehen.
    else if (timer === null) schedule(0, mode);
  };

  const needs = (why: NeedsWhy, detail?: string) =>
    view.set({ phase: 'needsYou', needs: detail ? { why, detail } : { why }, progress: null });
  /** Eine Sperre: Der Lauf endet, der Spielleiter muss etwas tun. */
  const halt = (why: NeedsWhy): Attempt => {
    needs(why);
    return 'stop';
  };

  // ── Ein Lauf ──────────────────────────────────────────────────────────────

  async function run(mode: 'full' | 'push'): Promise<void> {
    if (running) {
      again = again === 'full' || mode === 'full' ? 'full' : 'push';
      // Erst fertig, wenn auch der gewünschte Lauf gelaufen ist – nicht schon mit dem laufenden.
      // Der erste Aufrufer startet ihn gleich nach dem laufenden; `running` zeigt dann auf ihn.
      while (running) await running;
      return;
    }
    running = (async () => {
      try {
        await runOnce(mode);
      } finally {
        running = null;
        lastRun = timers.now();
      }
    })();
    await running;
    if (again) {
      const next = again;
      again = null;
      await run(next);
    }
  }

  /**
   * Arbeit, während kein Lauf unterwegs ist: wartet auf einen laufenden und hält neue an (sie
   * folgen danach). Die Rust-Seite liest und schreibt `stand.json` – was gleichzeitig daneben
   * gemerkt würde (eine eingespielte Sicherung, eine Entscheidung), ginge sonst verloren.
   */
  async function exclusive<T>(work: () => Promise<T>): Promise<T> {
    while (running) await running;
    let release: () => void = () => undefined;
    running = new Promise<void>((resolve) => (release = resolve));
    try {
      return await work();
    } finally {
      running = null;
      release();
      if (again) {
        const next = again;
        again = null;
        void run(next);
      }
    }
  }

  async function runOnce(mode: 'full' | 'push'): Promise<void> {
    const before = view.get();
    view.set({ phase: 'running' });
    try {
      const st = await port.state(root, dataVersion);
      view.set({
        link: st.link,
        syncedAt: st.syncedAt,
        other: { device: st.device, pushedAt: st.pushedAt },
      });
      if (!st.link) {
        view.set({ phase: st.key === 'yes' ? 'unlinked' : 'off', needs: null });
        return;
      }
      if (st.moved) return needs('moved');
      if (st.key === 'no') return needs('nokey');
      if (st.key === 'denied' && !retryKey) return needs('keychain');
      for (let attempt = 0; attempt < TIMING.attempts; attempt++) {
        const result = await tryOnce(mode);
        if (result !== 'again') {
          failures = 0;
          notBefore = 0;
          return;
        }
      }
      // Immer wieder kam etwas dazwischen: später noch einmal.
      view.set({ phase: before.phase === 'running' ? 'synced' : before.phase });
      schedule(TIMING.quiet);
    } catch (error) {
      fail(error);
    } finally {
      retryKey = false;
    }
  }

  function fail(error: unknown) {
    const failure = toSyncFailure(error);
    view.set({ progress: null });
    switch (failure.kind) {
      case 'offline':
      case 'server': {
        const delay = TIMING.backoff[Math.min(failures, TIMING.backoff.length - 1)]!;
        failures++;
        notBefore = timers.now() + delay;
        view.set({
          phase: 'offline',
          offline: { why: failure.kind === 'offline' ? 'net' : 'server' },
        });
        schedule(delay);
        return;
      }
      case 'limit': {
        const wait = Math.max(60, failure.retryAfter ?? 60) * 1000;
        notBefore = timers.now() + wait;
        view.set({
          phase: 'offline',
          offline: { why: 'limit', until: new Date(timers.now() + wait).toISOString() },
        });
        schedule(wait);
        return;
      }
      case 'busy':
        schedule(TIMING.retry);
        view.set({ phase: 'synced', due: true });
        return;
      case 'moved':
        schedule(TIMING.quiet * 2);
        return;
      case 'key':
      case 'nokey':
      case 'keychain':
      case 'denied':
      case 'missing':
        return needs(failure.kind);
      default:
        return needs('local', failure.message);
    }
  }

  async function tryOnce(mode: 'full' | 'push'): Promise<Attempt> {
    // 1. Offene Editoren speichern, Datenbank schreiben.
    opts.beforeScan?.();
    await db.flush();
    if (db.hasUnsavedChanges()) {
      schedule(TIMING.quiet);
      view.set({ phase: 'synced', due: true });
      return 'stop';
    }
    // 2. Marke und Abbild.
    const mark = db.changeMark();
    const disk = db.diskSnapshot();
    // 3. Lesen (hier und dort).
    const scan = await port.scan(root, true, retryKey || undefined);
    lastLook = timers.now();
    // 4. Hat sich inzwischen etwas geändert?
    if (db.changeMark() !== mark || !(await matchesDisk(disk, scan))) return 'again';
    const remote = scan.remote;
    if (!remote) throw new SyncFailure('server', 'Die Ablage wurde nicht gelesen.');
    view.set({ other: { device: remote.device, pushedAt: remote.pushedAt } });
    // 5. Sperren.
    if (remote.kind === 'foreign') return halt('foreign');
    if (!remote.isPrivate) return halt('public');
    if (scan.base && (remote.kind === 'empty' || remote.kind === 'fresh')) return halt('emptied');
    const marker = remote.marker;
    if (marker && marker.datenstand === dataVersion && marker.gestalt !== dataShape)
      return halt('shape');
    const older = (marker?.datenstand ?? 0) > dataVersion || scan.maxVersion > dataVersion;
    const otherOld = marker
      ? Object.entries(marker.geraete).find(
          ([device, v]) => device !== scan.link?.device && v < dataVersion,
        )
      : undefined;
    const peer = marker
      ? (Object.keys(marker.geraete).find((device) => device !== scan.link?.device) ?? null)
      : null;
    view.set({ older, otherNeedsUpdate: otherOld ? otherOld[0] : null, peer });
    if (!scan.base) {
      const local = toMap(scan.local);
      const cmp = compareWithoutBase(local, toMap(remote.files));
      view.set({
        phase: 'needsYou',
        needs: { why: 'firstSync' },
        firstSync: {
          same: cmp.same.length,
          onlyLocal: cmp.onlyLocal,
          onlyRemote: cmp.onlyRemote,
          different: cmp.different,
          remoteEmpty: remote.kind === 'empty' || remote.kind === 'fresh',
          restored: scan.restored,
        },
      });
      return 'stop';
    }
    if (remote.behind) {
      view.set({ phase: 'offline', offline: { why: 'behind' } });
      schedule(TIMING.backoff[1]!);
      return 'stop';
    }
    if (older && !scan.olderEdits) await port.mark({ root, olderEdits: true });
    if (!older && scan.olderEdits) {
      const filled = await fillAfterUpdate(scan, disk);
      return filled === 'stop' ? 'stop' : 'again';
    }

    // 6. Planen.
    const base = new Map(Object.entries(scan.base));
    const local = toMap(scan.local);
    lastLocal = local;
    const remoteMap = toMap(remote.files);
    const hold = new Set([...scan.frozen.map((f) => f.path), ...db.problems.map((p) => p.path)]);
    const massOk = new Set(
      Object.entries(scan.decided)
        .filter(([key, d]) => key.startsWith('*mass:') && d.choice === 'ok')
        .map(([key]) => key),
    );
    const plan = planSync(
      { base, local, remote: remoteMap, hold, localTexts: disk, older },
      massOk,
    );

    // 7–8. Holen, prüfen, zusammenführen.
    const conflicts: RawConflict[] = [];
    const nextPendings = new Map<string, Pending>();
    const skipped: SyncView['skipped'] = [];
    const files: RemoteFile[] = [];
    const writes: ApplyWrite[] = [];
    const deletes: { path: string; expect: string }[] = [];
    const keep: { path: string; sha: string }[] = [];
    /** Beide Seiten gleich: nur nachziehen (gilt immer). */
    const settleMarks: { path: string; sha: string | null }[] = [];
    /** Folgen von Entscheidungen und Zusammenführen: gelten nur, wenn dieser Lauf anwendet. */
    const baseMarks: { path: string; sha: string | null }[] = [];
    const decidedDone: string[] = [];
    let timeChoice: { chosen: number; other: number } | null = null;
    let decisionUsed = false;

    const fetched = new Map<Sha, string | null>();
    if (mode === 'full') {
      const items: FetchItem[] = [];
      const want = (sha: Sha | undefined, path: string) => {
        if (sha && !fetched.has(sha) && !items.some((i) => i.sha === sha))
          items.push({ sha, path });
      };
      for (const step of plan.steps) {
        if (step.do === 'pull' || step.do === 'merge' || step.do === 'clash')
          want(remoteMap.get(step.path), step.path);
        if (step.do === 'merge') want(base.get(step.path), step.path);
      }
      if (items.length) {
        view.set({ incoming: { count: items.length, from: remote.device } });
        for (const file of await port.fetch(root, items)) fetched.set(file.sha, file.content);
      }
    }

    const decisionFor = (path: string, remoteSha: Sha | null): SyncDecision | null => {
      const d = scan.decided[path];
      return d && d.remote === remoteSha ? d : null;
    };
    const conflict = (
      step: SyncStep,
      kind: RawConflict['kind'],
      extra: Partial<RawConflict> = {},
      pending: Partial<Pending> = {},
    ) => {
      const remoteSha = remoteMap.get(step.path) ?? null;
      const localJson = parseJson(disk.get(step.path));
      const remoteJson = remoteSha ? parseJson(fetched.get(remoteSha)) : null;
      conflicts.push({
        id: step.path,
        path: step.path,
        kind,
        local: { json: localJson, at: updatedOf(localJson) },
        remote: { json: remoteJson, at: updatedOf(remoteJson), device: remote.device },
        fields: [],
        ...extra,
      });
      nextPendings.set(step.path, {
        path: step.path,
        kind,
        remote: remoteSha,
        fields: null,
        ...pending,
      });
    };
    const pullWrite = (path: string, remoteSha: Sha, content: string) => {
      files.push({ path, content });
      writes.push({ path, sha: remoteSha, expect: local.get(path) ?? null, base: remoteSha });
    };

    if (mode === 'full')
      for (const step of plan.steps) {
        const remoteSha = remoteMap.get(step.path) ?? null;
        switch (step.do) {
          case 'settle':
            settleMarks.push({ path: step.path, sha: step.sha });
            break;
          case 'pull': {
            const content = remoteSha ? fetched.get(remoteSha) : null;
            if (!remoteSha || content == null || !checkIncoming(step.path, content).ok) {
              const d = decisionFor(step.path, remoteSha);
              if (d?.choice === 'local' && remoteSha && local.has(step.path)) {
                // „Fassung von hier hochladen“: Die unlesbare Fassung dort gilt als gesehen und
                // liegt danach beiseite (sie wird in der Ablage gleich ersetzt).
                baseMarks.push({ path: step.path, sha: remoteSha });
                if (fetched.has(remoteSha)) keep.push({ path: step.path, sha: remoteSha });
                decidedDone.push(step.path);
                decisionUsed = true;
              } else conflict(step, 'whole', { why: 'unreadable' });
              break;
            }
            pullWrite(step.path, remoteSha, content);
            break;
          }
          case 'pullDelete':
            deletes.push({ path: step.path, expect: local.get(step.path)! });
            break;
          case 'merge': {
            const localText = disk.get(step.path) ?? '';
            const remoteText = remoteSha ? fetched.get(remoteSha) : null;
            const baseSha = base.get(step.path);
            const baseText = baseSha ? (fetched.get(baseSha) ?? null) : null;
            if (!remoteSha || remoteText == null || !checkIncoming(step.path, remoteText).ok) {
              const d = decisionFor(step.path, remoteSha);
              if (d?.choice === 'local' && remoteSha) {
                baseMarks.push({ path: step.path, sha: remoteSha });
                if (fetched.has(remoteSha)) keep.push({ path: step.path, sha: remoteSha });
                decidedDone.push(step.path);
                decisionUsed = true;
              } else conflict(step, 'whole', { why: 'unreadable' });
              break;
            }
            const d = decisionFor(step.path, remoteSha);
            if (d && d.fields === null) {
              decidedDone.push(step.path);
              decisionUsed = true;
              if (d.choice === 'local') {
                baseMarks.push({ path: step.path, sha: remoteSha });
                keep.push({ path: step.path, sha: remoteSha });
              } else pullWrite(step.path, remoteSha, remoteText);
              break;
            }
            const choose: Choose | undefined = d
              ? { side: d.choice === 'local' ? 'local' : 'remote', at: d.fields ?? [] }
              : undefined;
            let merged = mergeFile(step.path, baseText, localText, remoteText, choose, nowIso());
            // Eine Entscheidung gilt nur, wenn der Eintrag mit ihr ganz zusammengeht. Bleibt ein
            // Widerspruch (hier hat sich inzwischen eine weitere strittige Angabe geändert), gilt
            // nichts von ihr – auch nicht die Folgen einer Weltzeit –, und die Karte zeigt alles.
            const applies = !!d && (merged.kind === 'merged' || merged.kind === 'take');
            if (d && !applies)
              merged = mergeFile(step.path, baseText, localText, remoteText, undefined, nowIso());
            if (d && applies) {
              decidedDone.push(step.path);
              decisionUsed = true;
              if (step.path === 'state.json' && d.fields?.some((f) => f[0] === 'now')) {
                const l = parseJson(localText) as { now?: number } | null;
                const r = parseJson(remoteText) as { now?: number } | null;
                if (typeof l?.now === 'number' && typeof r?.now === 'number')
                  timeChoice =
                    d.choice === 'local'
                      ? { chosen: l.now, other: r.now }
                      : { chosen: r.now, other: l.now };
              }
            }
            if (merged.kind === 'merged') {
              files.push({ path: step.path, content: merged.content });
              writes.push({
                path: step.path,
                content: merged.content,
                expect: local.get(step.path) ?? null,
                base: remoteSha,
              });
              if (applies && d?.choice === 'local') keep.push({ path: step.path, sha: remoteSha });
            } else if (merged.kind === 'take') {
              if (merged.side === 'remote') pullWrite(step.path, remoteSha, remoteText);
              else {
                baseMarks.push({ path: step.path, sha: remoteSha });
                if (applies && d?.choice === 'local')
                  keep.push({ path: step.path, sha: remoteSha });
              }
            } else if (merged.kind === 'clash') {
              const isTime = merged.fields.some((f) => f.group === 'time');
              conflict(
                step,
                isTime && merged.fields.length === 1 ? 'time' : 'fields',
                { fields: merged.fields },
                { fields: merged.fields.map((f) => f.at) },
              );
            } else conflict(step, 'whole', { why: merged.why });
            break;
          }
          case 'clash': {
            if (step.kind === 'deletedHere') {
              const d = decisionFor(step.path, remoteSha);
              const content = remoteSha ? fetched.get(remoteSha) : null;
              if (d?.choice === 'remote' && remoteSha && content != null) {
                decidedDone.push(step.path);
                decisionUsed = true;
                pullWrite(step.path, remoteSha, content);
              } else if (d?.choice === 'local' && remoteSha) {
                decidedDone.push(step.path);
                decisionUsed = true;
                baseMarks.push({ path: step.path, sha: remoteSha });
                keep.push({ path: step.path, sha: remoteSha });
              } else conflict(step, 'deletedHere');
            } else {
              const d = decisionFor(step.path, null);
              if (d?.choice === 'local') {
                decidedDone.push(step.path);
                decisionUsed = true;
                baseMarks.push({ path: step.path, sha: null });
              } else if (d?.choice === 'remote') {
                decidedDone.push(step.path);
                decisionUsed = true;
                deletes.push({ path: step.path, expect: local.get(step.path)! });
              } else
                conflict(step, step.kind === 'referenced' ? 'referenced' : 'deletedThere', {
                  ...(step.by ? { by: step.by } : {}),
                });
            }
            break;
          }
          case 'hold':
            if (step.why === 'frozen') {
              const frozen = scan.frozen.find((f) => f.path === step.path);
              const problem = db.problems.find((p) => p.path === step.path);
              skipped.push({
                path: step.path,
                why: frozen?.reason ?? (problem ? 'unreadable' : 'never-deleted'),
                title: null,
              });
            }
            break;
          case 'push':
          case 'pushDelete':
            break;
        }
      }
    for (const group of plan.mass) {
      conflicts.push({
        id: group.key,
        path: group.paths[0] ?? '',
        kind: 'mass',
        local: { json: null, at: null },
        remote: { json: null, at: null, device: remote.device },
        fields: [],
        mass: group,
      });
      nextPendings.set(group.key, {
        path: group.key,
        kind: 'mass',
        remote: null,
        fields: null,
        massKind: group.kind,
        paths: group.paths,
      });
    }
    pendings = nextPendings;
    const held = conflicts.length > 0;
    view.set({
      conflicts,
      skipped,
      heldSince: held ? (view.get().heldSince ?? nowIso()) : null,
    });

    // 9. Anwenden – nur in einem ruhigen Moment.
    let reopened: SettleSummary | null = null;
    let applied = false;
    let deferred = false;
    if (mode === 'full' && (writes.length || deletes.length || keep.length)) {
      if (opts.drafts?.has()) {
        // Ein Entwurf ist offen: nichts anwenden, auch keine Entscheidung verbrauchen.
        deferred = true;
        view.set({ due: true });
        waitForDrafts();
      } else {
        const begun = await port.applyBegin({
          root,
          kind: 'run',
          head: remote.head,
          reason: decisionUsed ? 'entscheidung' : 'abgleich',
          writes,
          deletes,
          keep,
        });
        if (begun.busy.length) return 'again';
        applying = true;
        try {
          const taken =
            files.length || deletes.length
              ? db.takeRemote(
                  [...files, ...deletes.map((d) => ({ path: d.path, content: null }))],
                  disk,
                )
              : { ok: true, busy: [], invalid: [] };
          if (!taken.ok) {
            await port.applyAbort(root, begun.run);
            return 'again';
          }
          await db.flush();
        } finally {
          applying = false;
        }
        await port.applyEnd(root, begun.run);
        applied = true;
      }
    }

    // 10. Gemeinsamen Stand nachziehen, angewendete Entscheidungen löschen.
    // Nach der Wahl der Weltzeit: Was zwischen beiden Zeiten von selbst eingetreten war, steht
    // wieder aus; doppelt Eingetretenes wird zusammengelegt. Eine gewöhnliche Änderung, die
    // gleich unten hochgeladen wird.
    if (timeChoice && !deferred) {
      const { chosen, other } = timeChoice;
      reopened = settleTime(db, chosen, other);
      await db.flush();
    }
    const marks = deferred ? settleMarks : [...settleMarks, ...baseMarks];
    const consumed = deferred ? [] : decidedDone;
    if (marks.length || consumed.length)
      await port.mark({
        root,
        ...(marks.length ? { base: marks } : {}),
        ...(consumed.length ? { decided: Object.fromEntries(consumed.map((p) => [p, null])) } : {}),
      });

    // 11. Hochladen.
    let up = { changed: 0, added: 0, removed: 0 };
    if (!older) {
      await db.flush();
      const mark2 = db.changeMark();
      const disk2 = db.diskSnapshot();
      const scan2 = await port.scan(root, false);
      if (db.changeMark() !== mark2 || !(await matchesDisk(disk2, scan2))) return 'again';
      const base2 = new Map(Object.entries(scan2.base ?? {}));
      const local2 = toMap(scan2.local);
      const plan2 = planSync(
        {
          base: base2,
          local: local2,
          remote: remoteMap,
          hold: new Set([...hold, ...scan2.frozen.map((f) => f.path)]),
          localTexts: disk2,
          older: false,
        },
        massOk,
      );
      const changes = plan2.steps.flatMap((s): { path: string; sha: string | null }[] =>
        s.do === 'push'
          ? [{ path: s.path, sha: local2.get(s.path)! }]
          : s.do === 'pushDelete'
            ? [{ path: s.path, sha: null }]
            : [],
      );
      if (changes.length) {
        up = countChanges(plan2.steps, base2).up;
        try {
          await port.push({
            root,
            head: remote.head,
            tree: remote.tree,
            changes,
            dataVersion,
            dataShape,
            counts: up,
          });
        } catch (error) {
          const failure = toSyncFailure(error);
          if (failure.kind === 'moved') return 'again';
          throw failure;
        }
      }
    }

    // 12. Fertig.
    await port.mark({ root, synced: true });
    const st = await port.state(root, dataVersion);
    const down = countChanges(plan.steps, base).down;
    view.set({
      phase: held ? 'needsYou' : older ? 'needsYou' : 'synced',
      needs: held ? { why: 'conflicts' } : older ? { why: 'version' } : null,
      offline: null,
      due: deferred,
      syncedAt: st.syncedAt,
      incoming: null,
      progress: null,
      firstSync: null,
      last: {
        up,
        down: applied ? down : { changed: 0, added: 0, removed: 0 },
        from: remote.device,
      },
      ...(reopened ? { reopened } : {}),
    });
    firstChange = null;
    return 'done';
  }

  /** Nach dem Aktualisieren: ergänzen, was das ältere Programm beim Speichern weggelassen hat. */
  async function fillAfterUpdate(
    scan: SyncScan,
    disk: ReadonlyMap<string, string>,
  ): Promise<Attempt> {
    if (opts.drafts?.has()) {
      waitForDrafts();
      return 'stop';
    }
    const base = scan.base ?? {};
    const changed = scan.local.filter((f) => base[f.path] && base[f.path] !== f.sha);
    const items = changed.map((f) => ({ sha: base[f.path]!, path: f.path }));
    const texts = new Map<string, string | null>();
    if (items.length) for (const f of await port.fetch(root, items)) texts.set(f.sha, f.content);
    const files: RemoteFile[] = [];
    const writes: ApplyWrite[] = [];
    for (const f of changed) {
      const baseText = texts.get(base[f.path]!);
      const localText = disk.get(f.path);
      if (baseText == null || localText === undefined) continue;
      const filled = fillStrippedFile(baseText, localText);
      // Was sich nicht sauber ergänzen lässt, bleibt, wie es ist – sonst lehnte `takeRemote`
      // alles ab, und kein Lauf käme je über diese Stelle hinaus.
      if (!filled || !checkIncoming(f.path, filled).ok) continue;
      files.push({ path: f.path, content: filled });
      writes.push({ path: f.path, content: filled, expect: f.sha, base: base[f.path]! });
    }
    if (writes.length) {
      const begun = await port.applyBegin({
        root,
        kind: 'run',
        head: scan.remote?.head ?? null,
        reason: 'abgleich',
        writes,
        deletes: [],
        keep: [],
      });
      if (begun.busy.length) return 'again';
      applying = true;
      try {
        const taken = db.takeRemote(files, disk);
        if (!taken.ok) {
          await port.applyAbort(root, begun.run);
          return 'again';
        }
        await db.flush();
      } finally {
        applying = false;
      }
      await port.applyEnd(root, begun.run);
    }
    await port.mark({ root, olderEdits: false });
    return 'again';
  }

  let draftsOff: (() => void) | null = null;
  function waitForDrafts() {
    if (!opts.drafts || draftsOff) return;
    draftsOff = opts.drafts.subscribe(() => {
      if (opts.drafts!.has()) return;
      draftsOff?.();
      draftsOff = null;
      auto('full');
    });
    schedule(TIMING.retry);
  }

  // ── Erster Abgleich ───────────────────────────────────────────────────────

  async function firstSync(
    choice: 'upload' | 'localWins' | 'remoteWins',
    given?: SyncLink,
  ): Promise<void> {
    if (await exclusive(() => firstSyncAlone(choice, given))) await run('full');
  }

  /** Der erste Abgleich ohne gleichzeitigen Lauf. Ergebnis: danach gleich abgleichen? */
  async function firstSyncAlone(
    choice: 'upload' | 'localWins' | 'remoteWins',
    given?: SyncLink,
  ): Promise<boolean> {
    const st = await port.state(root, dataVersion);
    const link = given ?? st.link;
    if (!link) throw new SyncFailure('input', 'Der Abgleich ist noch nicht eingerichtet.');
    opts.beforeScan?.();
    await db.flush();
    if (db.hasUnsavedChanges())
      throw new SyncFailure(
        'local',
        'Gerade lässt sich nicht speichern. Bitte gleich noch einmal.',
      );
    const scan = await port.scan(root, true, undefined, given);
    const remote = scan.remote;
    if (!remote) throw new SyncFailure('server', 'Die Ablage wurde nicht gelesen.');
    if (remote.kind === 'foreign') {
      needs('foreign');
      return false;
    }
    if (!remote.isPrivate) {
      needs('public');
      return false;
    }
    const local = toMap(scan.local);
    const remoteMap = toMap(remote.files);
    const cmp = compareWithoutBase(local, remoteMap);
    // Ein älteres Programm bringt die Ablage nie auf seinen Stand (es kennte nicht alle Felder).
    const olderHere =
      (remote.marker?.datenstand ?? 0) > dataVersion || scan.maxVersion > dataVersion;
    const differs = cmp.different.length + cmp.onlyLocal.length + cmp.onlyRemote.length > 0;
    if (olderHere && differs && choice !== 'remoteWins')
      throw new SyncFailure(
        'input',
        'Die Ablage stammt von einer neueren Version. Hier gilt nur „Der Stand aus der Ablage gilt“.',
      );
    const linkIt = async () => {
      if (given || !st.link) await port.link(root, { ...link, root });
    };
    const pushAll = async (changes: { path: string; sha: string | null }[]) => {
      if (!changes.length) return;
      await port.push({
        root,
        head: remote.head,
        tree: remote.tree,
        changes,
        dataVersion,
        dataShape,
        counts: {
          changed: changes.filter((c) => c.sha && remoteMap.has(c.path)).length,
          added: changes.filter((c) => c.sha && !remoteMap.has(c.path)).length,
          removed: changes.filter((c) => !c.sha).length,
        },
        ...(given ? { link: given } : {}),
      });
    };
    if (remote.kind === 'empty' || remote.kind === 'fresh') {
      if (choice !== 'upload' && choice !== 'localWins')
        throw new SyncFailure('input', 'In der Ablage liegt noch kein Spielstand.');
      await pushAll(scan.local.map((f) => ({ path: f.path, sha: f.sha })));
      await linkIt();
    } else if (!cmp.different.length && !cmp.onlyLocal.length && !cmp.onlyRemote.length) {
      await port.mark({ root, base: scan.local.map((f) => ({ path: f.path, sha: f.sha })) });
      await linkIt();
    } else if (choice === 'remoteWins') {
      const want = [...cmp.different, ...cmp.onlyRemote];
      const fetched = await port.fetch(
        root,
        want.map((path) => ({ sha: remoteMap.get(path)!, path })),
        given,
      );
      if (fetched.some((f) => f.content === null))
        throw new SyncFailure('local', 'Eine Fassung aus der Ablage ist hier nicht lesbar.');
      db.close();
      try {
        await port.applyBegin({
          root,
          kind: 'remoteWins',
          head: remote.head,
          reason: 'erster-abgleich',
          writes: want.map((path) => ({
            path,
            sha: remoteMap.get(path)!,
            expect: local.get(path) ?? null,
            base: remoteMap.get(path)!,
          })),
          deletes: cmp.onlyLocal.map((path) => ({ path, expect: local.get(path)! })),
          keep: [],
          link: { ...link, root },
          baseAll: Object.fromEntries(remoteMap),
        });
      } finally {
        // Die Datenbank ist geschlossen; beim Neuladen bringt `openCampaign` es zu Ende.
        opts.reload?.();
      }
      return false;
    } else {
      // Der Stand dieses Rechners gilt: Was dort anders ist, liegt danach hier beiseite.
      const aside = [...cmp.different, ...cmp.onlyRemote];
      if (aside.length) {
        await port.fetch(
          root,
          aside.map((path) => ({ sha: remoteMap.get(path)!, path })),
          given,
        );
        const begun = await port.applyBegin({
          root,
          kind: 'run',
          head: remote.head,
          reason: 'erster-abgleich',
          writes: [],
          deletes: [],
          keep: aside.map((path) => ({ path, sha: remoteMap.get(path)! })),
        });
        await port.applyEnd(root, begun.run);
      }
      await port.mark({ root, base: cmp.same.map((path) => ({ path, sha: local.get(path)! })) });
      await pushAll([
        ...[...cmp.different, ...cmp.onlyLocal].map((path) => ({ path, sha: local.get(path)! })),
        ...cmp.onlyRemote.map((path) => ({ path, sha: null })),
      ]);
      await linkIt();
    }
    await port.mark({ root, synced: true });
    view.set({ phase: 'synced', needs: null, firstSync: null, progress: null });
    return true;
  }

  async function compareFirst(link: SyncLink): Promise<FirstSyncInfo & { older: boolean }> {
    return exclusive(async () => {
      opts.beforeScan?.();
      await db.flush();
      const scan = await port.scan(root, true, undefined, link);
      const remote = scan.remote;
      if (!remote) throw new SyncFailure('server', 'Die Ablage wurde nicht gelesen.');
      const cmp = compareWithoutBase(toMap(scan.local), toMap(remote.files));
      return {
        same: cmp.same.length,
        onlyLocal: cmp.onlyLocal,
        onlyRemote: cmp.onlyRemote,
        different: cmp.different,
        remoteEmpty: remote.kind === 'empty' || remote.kind === 'fresh',
        restored: scan.restored,
        older: (remote.marker?.datenstand ?? 0) > dataVersion || scan.maxVersion > dataVersion,
      };
    });
  }

  async function disconnect(removeKey: boolean): Promise<void> {
    await exclusive(async () => {
      await port.link(root, null);
      if (removeKey) await port.clearKey();
    });
    pendings = new Map();
    view.set({
      ...INITIAL_VIEW,
      phase: removeKey ? 'off' : 'unlinked',
    });
  }

  async function restoreAside(
    run: number,
    only?: { side: 'hier' | 'dort'; path: string }[],
  ): Promise<number> {
    const count = await exclusive(async () => {
      const found = (await port.asideList(root)).find((r) => r.run === run);
      if (!found) return 0;
      const wanted = found.entries.filter(
        (e) => !only || only.some((o) => o.side === e.side && o.path === e.path),
      );
      // Je Pfad die eine Fassung (bei beiden Seiten gilt die von hier).
      const byPath = new Map<string, { side: 'hier' | 'dort'; path: string }>();
      for (const e of wanted) if (!byPath.has(e.path) || e.side === 'hier') byPath.set(e.path, e);
      if (!byPath.size) return 0;
      const files: RemoteFile[] = [];
      for (const e of byPath.values())
        files.push({ path: e.path, content: await port.asideRead(root, run, e.side, e.path) });
      opts.beforeScan?.();
      await db.flush();
      if (db.hasUnsavedChanges())
        throw new SyncFailure(
          'local',
          'Gerade lässt sich nicht speichern. Bitte gleich noch einmal.',
        );
      const disk = db.diskSnapshot();
      const present = files.map((f) => f.path).filter((p) => disk.has(p));
      if (present.length) await port.asidePut(root, present, 'zurueckholen');
      const taken = db.takeRemote(files, disk);
      if (!taken.ok)
        throw new SyncFailure(
          'local',
          taken.invalid.length
            ? 'Diese Fassung passt nicht mehr zu diesem Spielstand.'
            : 'Gerade wird an diesem Eintrag geschrieben. Bitte gleich noch einmal.',
        );
      await db.flush();
      return files.length;
    });
    // Eine gewöhnliche Änderung: Sie wird gleich abgeglichen.
    if (count) onLocalChange();
    return count;
  }

  // ── Entscheidungen ────────────────────────────────────────────────────────

  async function decide(choices: Record<string, Choice>): Promise<void> {
    const decided: Record<string, SyncDecision> = {};
    const baseMarks: { path: string; sha: string | null }[] = [];
    for (const [id, choice] of Object.entries(choices)) {
      const p = pendings.get(id);
      if (!p) continue;
      if (p.kind === 'mass') {
        if (choice === 'ok') decided[id] = { choice: 'ok', remote: null, fields: null };
        else if (choice === 'back')
          for (const path of p.paths ?? [])
            baseMarks.push({
              path,
              sha: p.massKind === 'changeHere' ? (lastLocal.get(path) ?? null) : null,
            });
        continue;
      }
      decided[p.path] = {
        choice: choice === 'remote' ? 'remote' : 'local',
        remote: p.kind === 'deletedThere' || p.kind === 'referenced' ? null : p.remote,
        fields: p.kind === 'fields' || p.kind === 'time' ? p.fields : null,
      };
    }
    await exclusive(() =>
      port.mark({
        root,
        ...(Object.keys(decided).length ? { decided } : {}),
        ...(baseMarks.length ? { base: baseMarks } : {}),
      }),
    );
    await run('full');
  }

  // ── Auslöser ──────────────────────────────────────────────────────────────

  function onLocalChange() {
    const now = timers.now();
    firstChange ??= now;
    view.set({ due: true });
    schedule(Math.max(0, Math.min(TIMING.quiet, firstChange + TIMING.cap - now)));
  }

  function start() {
    if (started) return;
    started = true;
    let sessionId = db.getSnapshot().state.sessionId;
    offs.push(
      db.subscribeStatus(() => {
        if (!applying && db.getStatus() === 'saved') onLocalChange();
      }),
      db.subscribe(() => {
        const next = db.getSnapshot().state.sessionId;
        const ended = sessionId !== null && next === null;
        sessionId = next;
        if (ended && !applying) auto('full');
      }),
    );
    const tick = () => {
      every = timers.set(() => {
        auto('full');
        tick();
      }, TIMING.every);
    };
    tick();
    void run('full');
  }

  function stop() {
    started = false;
    for (const off of offs) off();
    offs = [];
    draftsOff?.();
    draftsOff = null;
    if (timer !== null) timers.clear(timer);
    if (every !== null) timers.clear(every);
    timer = every = null;
  }

  return {
    view,
    start,
    stop,
    syncNow: () => run('full'),
    async lookAgain() {
      await run('full');
      return view.get();
    },
    decide,
    firstSync,
    async confirmMove(isMine) {
      const changed = await exclusive(async () => {
        const st = await port.state(root, dataVersion);
        if (!st.link) return false;
        if (isMine) await port.link(root, { ...st.link, root }, true);
        else await port.link(root, null);
        // Eine Kopie mit Schlüssel auf diesem Rechner: „Abgleich nicht verbunden“.
        view.set({
          phase: isMine ? 'synced' : st.key === 'yes' ? 'unlinked' : 'off',
          needs: null,
          ...(isMine ? {} : { link: null, conflicts: [] }),
        });
        return true;
      });
      if (changed && isMine) await run('full');
    },
    async beforeClose() {
      view.set({ closing: true });
      try {
        await run('push');
      } finally {
        view.set({ closing: false });
      }
    },
    pushSoon() {
      if (!view.get().due) return;
      const wait = lastRun + TIMING.pushGap - timers.now();
      if (wait <= 0) auto('push');
      else if (timers.now() >= notBefore) schedule(wait, 'push');
    },
    wake() {
      if (timers.now() - lastLook > TIMING.look) {
        if (view.get().needs?.why === 'keychain') return;
        auto('full');
      }
    },
    hold: exclusive,
    async retryKeychain() {
      retryKey = true;
      await run('full');
    },
    compareFirst,
    disconnect,
    restoreAside,
  };
}

/**
 * Holen in einen leeren Ordner (Startbildschirm, „In diesen Ordner holen“): alles nach
 * `.abgleich/eingang/`, dann der Merkzettel „adopt“. Abgelegt wird beim Öffnen über
 * `openCampaign` → `sync_recover` – es gibt keinen eigenen Schreibweg.
 */
export async function fetchIntoEmptyFolder(
  port: SyncPort,
  root: string,
  link: SyncLink,
): Promise<{ files: number }> {
  const scan = await port.scan(root, true, undefined, link);
  if (scan.local.length || scan.frozen.length)
    throw new SyncFailure(
      'input',
      'In diesem Ordner liegt schon etwas. Zum Holen braucht Wayfarer einen neuen, leeren Ordner.',
    );
  const remote = scan.remote;
  if (!remote || remote.kind !== 'wayfarer' || !remote.files.length)
    throw new SyncFailure('input', 'In deiner Ablage liegt noch kein Spielstand.');
  if (!remote.isPrivate) throw new SyncFailure('input', 'Die Ablage ist öffentlich.');
  const fetched = await port.fetch(
    root,
    remote.files.map((f) => ({ sha: f.sha, path: f.path })),
    link,
  );
  const unreadable = new Set(fetched.filter((f) => f.content === null).map((f) => f.sha));
  const files = remote.files.filter((f) => !unreadable.has(f.sha));
  await port.applyBegin({
    root,
    kind: 'adopt',
    head: remote.head,
    reason: 'abgleich',
    writes: files.map((f) => ({ path: f.path, sha: f.sha, expect: null, base: f.sha })),
    deletes: [],
    keep: [],
    link: { ...link, root },
    baseAll: Object.fromEntries(files.map((f) => [f.path, f.sha])),
  });
  return { files: files.length };
}
