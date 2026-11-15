/**
 * Attrappe für die Tests des Abgleichs – ganz ohne Netz und ohne Rust:
 * - `FakeRepo`: eine Ablage „bei GitHub“ im Speicher (Commits, Bäume, Kennungen wie bei Git).
 * - `MemoryPort`: dieselben Befehle wie die Rust-Seite (`port.ts`), auf einer `MemoryStore`
 *   mit dem Ordner `.abgleich` in Feldern.
 * - `machine()`: ein „Rechner“ = Ordner + Datenbank + Bote + Ablauf mit falscher Uhr.
 */
import { createHash } from 'node:crypto';
import { CampaignDb } from '../../../data/db';
import {
  SyncFailure,
  type ApplyBeginInput,
  type ApplyWrite,
  type AsideReason,
  type AsideRun,
  type FetchItem,
  type FetchedFile,
  type MarkInput,
  type Marker,
  type PushInput,
  type RemoteKind,
  type SyncDecision,
  type SyncErrorKind,
  type SyncFile,
  type SyncLink,
  type SyncProbeResult,
  type SyncScan,
  type SyncStateInfo,
} from '../../../data/platform';
import { MemoryStore } from '../../../data/store';
import type { CampaignData } from '../../../domain/schema';
import { isSyncedPath } from '../../../domain/sync';
import { createSyncEngine, type EngineOptions, type SyncEngine, type Timers } from '../engine';
import type { SyncPort } from '../port';

export const gitSha = (text: string) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest('hex');

// ── Die Ablage ───────────────────────────────────────────────────────────────

interface Commit {
  sha: string;
  tree: string;
  files: Map<string, string>;
  parent: string | null;
  device: string | null;
  at: string;
}

export class FakeRepo {
  readonly blobs = new Map<string, string>();
  readonly commits = new Map<string, Commit>();
  head: string | null = null;
  isPrivate = true;
  /** Protokoll aller Anfragen (Art). */
  readonly log: string[] = [];
  private failures: { kind: SyncErrorKind; retryAfter: number | null }[] = [];
  private counter = 0;
  /** Wird unmittelbar vor dem Umschalten aufgerufen (ein anderer schiebt ein). */
  beforeSwitch: (() => void) | null = null;

  /** Die nächste Anfrage scheitert mit dieser Art (bei „limit“ mit Wartezeit in Sekunden). */
  failNext(kind: SyncErrorKind, retryAfter: number | null = null) {
    this.failures.push({ kind, retryAfter });
  }

  request(what: string) {
    this.log.push(what);
    const failure = this.failures.shift();
    if (failure)
      throw new SyncFailure(
        failure.kind,
        `Störung (${failure.kind}) bei ${what}`,
        failure.retryAfter,
      );
  }

  files(commit: string | null): Map<string, string> {
    return commit ? new Map(this.commits.get(commit)!.files) : new Map();
  }

  /** Ein Commit auf `parent` (wie POST git/trees + git/commits, ohne Umschalten). */
  makeCommit(parent: string | null, files: Map<string, string>, device: string | null): Commit {
    const listing = [...files]
      .sort()
      .map(([p, s]) => `${p}:${s}`)
      .join('\n');
    const tree = createHash('sha1').update(`tree\n${listing}`).digest('hex');
    const sha = createHash('sha1')
      .update(`commit ${tree} ${parent} ${this.counter++}`)
      .digest('hex');
    const commit: Commit = {
      sha,
      tree,
      files: new Map(files),
      parent,
      device,
      at: new Date(Date.UTC(2026, 10, 15, 20, 0, this.counter)).toISOString(),
    };
    this.commits.set(sha, commit);
    return commit;
  }

  putBlob(text: string): string {
    const sha = gitSha(text);
    this.blobs.set(sha, text);
    return sha;
  }

  /** Ein anderer Rechner lädt Dateien hoch (ohne den Ablauf), etwa ein neueres Programm. */
  commitAs(device: string, change: Record<string, string | null>, marker?: Marker): string {
    const files = this.files(this.head);
    for (const [path, text] of Object.entries(change)) {
      if (text === null) files.delete(path);
      else files.set(path, this.putBlob(text));
    }
    if (marker) files.set('wayfarer.json', this.putBlob(markerText(marker)));
    const commit = this.makeCommit(this.head, files, device);
    this.head = commit.sha;
    return commit.sha;
  }

  /** Ist `ancestor` ein Vorfahr von (oder gleich) `commit`? */
  descends(commit: string, ancestor: string): boolean {
    for (let at: string | null = commit; at; at = this.commits.get(at)?.parent ?? null)
      if (at === ancestor) return true;
    return false;
  }

  /** Setzt den Kopf auf einen älteren Commit zurück („Ablage steht hinter dem Gesehenen“). */
  rewindHead(to: string) {
    this.head = to;
  }

  markerOf(commit: string | null): Marker | null {
    const sha = this.files(commit).get('wayfarer.json');
    if (!sha) return null;
    const raw = JSON.parse(this.blobs.get(sha)!) as Marker & { format?: string };
    return { datenstand: raw.datenstand, gestalt: raw.gestalt, geraete: raw.geraete };
  }

  /** Inhalt einer Datei im Kopf. */
  text(path: string): string | null {
    const sha = this.files(this.head).get(path);
    return sha ? this.blobs.get(sha)! : null;
  }
}

export const markerText = (m: Marker) =>
  JSON.stringify({ format: 'wayfarer-abgleich', ...m }) + '\n';

const kindOf = (files: Map<string, string>, marker: Marker | null): RemoteKind => {
  if (!files.size) return 'empty';
  if (marker) return 'wayfarer';
  const fresh = [...files.keys()].every((p) =>
    /^(README.*|LICENSE.*|\.gitignore|\.gitattributes)$/i.test(p),
  );
  return fresh ? 'fresh' : 'foreign';
};

// ── Ein Rechner: der Ordner .abgleich in Feldern ─────────────────────────────

interface Seen {
  commit: string;
  tree: string;
  files: Record<string, string>;
  marker: Marker | null;
  device: string | null;
  pushedAt: string | null;
}

interface Stand {
  files: Record<string, string> | null;
  seen: Seen | null;
  decided: Record<string, SyncDecision>;
  maxVersion: number;
  olderEdits: boolean;
  restored: boolean;
  runNo: number;
  syncedAt: string | null;
  repo: string | null;
}

interface Note {
  kind: ApplyBeginInput['kind'];
  run: number;
  head: string | null;
  writes: { path: string; sha: string; expect: string | null; base: string | null }[];
  deletes: { path: string; expect: string }[];
  link: SyncLink | null;
  baseAll: Record<string, string> | null;
}

export type CrashPoint = 'applyBegin' | 'recover:half' | 'push:beforeSwitch' | 'push:afterSwitch';

const emptyStand = (): Stand => ({
  files: null,
  seen: null,
  decided: {},
  maxVersion: 0,
  olderEdits: false,
  restored: false,
  runNo: 0,
  syncedAt: null,
  repo: null,
});

export class MemoryPort implements SyncPort {
  /** Wo der Ordner gerade liegt (für „Kopie oder verschoben“). */
  location: string;
  key: 'yes' | 'no' | 'denied' = 'yes';
  verbindung: SyncLink | null = null;
  stand: Stand | null = null;
  /** Rohtext von stand.json / stand.vorher.json (zum Verfälschen in Tests). */
  standText: string | null = null;
  standVorherText: string | null = null;
  note: Note | null = null;
  readonly eingang = new Map<string, string>();
  readonly beiseite = new Map<number, AsideRun & { texts: Map<string, string> }>();
  /** Ausgelassene Pfade (wie Rust sie meldet: Groß/Klein, Kodierung, Größe, gesperrt). */
  frozen = new Map<string, 'case' | 'encoding' | 'size' | 'locked'>();
  private crash: CrashPoint | null = null;
  readonly calls: string[] = [];
  /** Ein Blick in die Ablage, der dauert: `scan` wartet darauf, bevor er etwas tut. */
  scanGate: (() => Promise<void>) | null = null;

  constructor(
    readonly repo: FakeRepo,
    readonly store: MemoryStore,
    readonly owner = 'spielleiter',
    readonly name = 'spielstand-elaris',
    location = '/kampagne',
  ) {
    this.location = location;
  }

  crashAt(point: CrashPoint | null) {
    this.crash = point;
  }
  private crashIf(point: CrashPoint) {
    if (this.crash === point) {
      this.crash = null;
      throw new SyncFailure('offline', `Abbruch bei ${point}`);
    }
  }

  // ── stand.json mit Rückfall ──
  private readStand(): Stand | null {
    for (const text of [this.standText, this.standVorherText]) {
      if (text === null) continue;
      try {
        return JSON.parse(text) as Stand;
      } catch {
        // weiter mit der vorigen Fassung
      }
    }
    return null;
  }
  private writeStand(next: Stand) {
    this.standVorherText = this.standText;
    this.standText = JSON.stringify(next);
    this.stand = next;
  }
  private load(): Stand {
    return this.readStand() ?? emptyStand();
  }

  private localFiles(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [path, text] of this.store.files)
      if (isSyncedPath(path) && !this.frozen.has(path)) out.set(path, text);
    return out;
  }
  private localSha(path: string): string | null {
    const text = this.store.files.get(path);
    return text === undefined ? null : gitSha(text);
  }

  private needKey() {
    if (this.key === 'no') throw new SyncFailure('nokey', 'Kein Zugangsschlüssel hinterlegt.');
    if (this.key === 'denied') throw new SyncFailure('keychain', 'Schlüsselbund verweigert.');
  }

  async state(_root: string, dataVersion: number): Promise<SyncStateInfo> {
    this.calls.push('state');
    const stand = this.readStand();
    if (stand && dataVersion < stand.maxVersion && !stand.olderEdits)
      this.writeStand({ ...stand, olderEdits: true });
    const s = this.readStand();
    return {
      key: this.key,
      link: this.verbindung,
      moved: !!this.verbindung && this.verbindung.root !== this.location,
      hasBase: !!s?.files,
      pending: this.note?.kind ?? null,
      older: !!s && dataVersion < s.maxVersion,
      syncedAt: s?.syncedAt ?? null,
      device: s?.seen?.device ?? null,
      pushedAt: s?.seen?.pushedAt ?? null,
      aside: this.beiseite.size,
      restored: !!s?.restored,
    };
  }
  async setKey(key: string) {
    if (!key.startsWith('github_pat_'))
      throw new SyncFailure('input', 'Das ist kein Zugangsschlüssel.');
    this.key = 'yes';
  }
  async clearKey() {
    this.key = 'no';
  }
  async probe(): Promise<SyncProbeResult> {
    this.needKey();
    this.repo.request('probe');
    const marker = this.repo.markerOf(this.repo.head);
    const info = {
      owner: this.owner,
      repo: this.name,
      branch: 'main',
      isPrivate: this.repo.isPrivate,
      canPush: true,
      archived: false,
      kind: kindOf(this.repo.files(this.repo.head), marker),
    };
    return {
      login: this.owner,
      repos: [info],
      found: {
        info,
        kind: info.kind,
        files: this.repo.files(this.repo.head).size,
        marker,
        device: null,
        pushedAt: null,
        campaign: null,
        state: null,
      },
    };
  }
  async link(_root: string, link: SyncLink | null, moveTo?: boolean) {
    this.calls.push('link');
    if (link === null) {
      this.verbindung = null;
      this.stand = null;
      this.standText = this.standVorherText = null;
      this.note = null;
      this.eingang.clear();
      return;
    }
    this.verbindung = moveTo ? { ...link, root: this.location } : { ...link };
  }

  /** Bringt einen liegenden Merkzettel zu Ende (vor dem Öffnen, ohne Netz). */
  async recover() {
    this.calls.push('recover');
    const note = this.note;
    if (!note) return { finished: 0, left: [] };
    const done: string[] = [];
    const left: { path: string; sha: string }[] = [];
    let n = 0;
    for (const w of note.writes) {
      const text = this.eingang.get(w.sha);
      if (text === undefined || gitSha(text) !== w.sha) {
        // Eingangsdatei fehlt oder ist verfälscht: Die Datei hier bleibt unberührt.
        if (note.kind !== 'run') left.push({ path: w.path, sha: w.sha });
        continue;
      }
      const now = this.localSha(w.path);
      if (now === w.sha) done.push(w.path);
      else if (now === w.expect) {
        if (n++ === 1) this.crashIf('recover:half');
        this.store.files.set(w.path, text);
        done.push(w.path);
      }
    }
    for (const d of note.deletes) {
      const now = this.localSha(d.path);
      if (now === null) done.push(d.path);
      else if (now === d.expect) {
        this.store.files.delete(d.path);
        done.push(d.path);
      }
    }
    if (left.length) {
      this.note = {
        ...note,
        writes: note.writes.filter((w) => left.some((l) => l.path === w.path)),
      };
      return { finished: done.length, left };
    }
    this.finishNote(note, done);
    return { finished: done.length, left };
  }

  /** Gemeinsamen Stand für Erledigtes nachtragen, Merkzettel weg. */
  private finishNote(note: Note, done: string[]) {
    const stand = this.load();
    if (note.kind === 'run') {
      const files = { ...(stand.files ?? {}) };
      const decided = { ...stand.decided };
      for (const w of note.writes)
        if (done.includes(w.path)) {
          if (w.base) files[w.path] = w.base;
          else delete files[w.path];
          delete decided[w.path];
        }
      for (const d of note.deletes)
        if (done.includes(d.path)) {
          delete files[d.path];
          delete decided[d.path];
        }
      this.writeStand({ ...stand, files: stand.files ? files : null, decided });
    } else {
      // Erstes Holen / „Ablage gilt“: gemeinsamer Stand und Verbindung erst ganz am Ende.
      const files = note.baseAll ?? {};
      const commit = note.head ? this.repo.commits.get(note.head) : undefined;
      this.writeStand({
        ...stand,
        files,
        restored: false,
        repo: `${this.owner}/${this.name}`,
        seen: commit
          ? {
              commit: commit.sha,
              tree: commit.tree,
              files: Object.fromEntries(commit.files),
              marker: this.repo.markerOf(commit.sha),
              device: commit.device,
              pushedAt: commit.at,
            }
          : null,
      });
      this.verbindung = note.link;
    }
    this.note = null;
  }

  async scan(
    _root: string,
    remote: boolean,
    _retryKey?: boolean,
    link?: SyncLink,
  ): Promise<SyncScan> {
    this.calls.push(remote ? 'scan' : 'scan-local');
    if (remote && this.scanGate) await this.scanGate();
    let settled = 0;
    // (a) Ein liegender Merkzettel wird abgeschlossen, ohne zu schreiben.
    if (this.note && this.note.kind === 'run') {
      const done = [
        ...this.note.writes.filter((w) => this.localSha(w.path) === w.sha).map((w) => w.path),
        ...this.note.deletes.filter((d) => this.localSha(d.path) === null).map((d) => d.path),
      ];
      settled = done.length;
      this.finishNote(this.note, done);
    }
    // (b) Die Liste hier.
    const local: SyncFile[] = [...this.localFiles()].map(([path, text]) => ({
      path,
      sha: gitSha(text),
      size: Buffer.byteLength(text),
    }));
    local.sort((a, b) => (a.path < b.path ? -1 : 1));
    const frozen = [...this.frozen].map(([path, reason]) => ({ path, reason }));
    let stand = this.readStand();
    let remoteScan: SyncScan['remote'] = null;
    if (remote) {
      this.needKey();
      const target = link ?? this.verbindung;
      if (!target) throw new SyncFailure('input', 'Der Abgleich ist nicht eingerichtet.');
      this.repo.request('ref');
      const head = this.repo.head;
      if (!head && (stand?.files || stand?.seen))
        throw new SyncFailure('server', 'Die Ablage antwortet unerwartet.');
      let behind = false;
      if (head && stand?.seen && head !== stand.seen.commit) {
        this.repo.request('compare');
        behind = !this.repo.descends(head, stand.seen.commit);
      }
      const all = this.repo.files(head);
      const marker = this.repo.markerOf(head);
      const commit = head ? this.repo.commits.get(head)! : null;
      if (head && head !== stand?.seen?.commit) this.repo.request('tree');
      remoteScan = {
        live: true,
        kind: kindOf(all, marker),
        isPrivate: this.repo.isPrivate,
        behind,
        head,
        tree: commit?.tree ?? null,
        files: [...all]
          .filter(([path]) => isSyncedPath(path))
          .map(([path, sha]) => ({
            path,
            sha,
            size: Buffer.byteLength(this.repo.blobs.get(sha)!),
          })),
        marker,
        device: commit?.device ?? null,
        pushedAt: commit?.at ?? null,
      };
      if (stand && commit && !behind) {
        const maxVersion = Math.max(stand.maxVersion, marker?.datenstand ?? 0);
        this.writeStand({
          ...stand,
          maxVersion,
          seen: {
            commit: commit.sha,
            tree: commit.tree,
            files: Object.fromEntries(all),
            marker,
            device: commit.device,
            pushedAt: commit.at,
          },
        });
        stand = this.readStand();
      }
    }
    return {
      link: link ?? this.verbindung,
      base: stand?.files ?? null,
      decided: stand?.decided ?? {},
      local,
      frozen,
      settled,
      maxVersion: stand?.maxVersion ?? 0,
      olderEdits: stand?.olderEdits ?? false,
      restored: stand?.restored ?? false,
      remote: remoteScan,
    };
  }

  async fetch(_root: string, items: FetchItem[]): Promise<FetchedFile[]> {
    this.calls.push('fetch');
    const out: FetchedFile[] = [];
    for (const item of items) {
      const have = this.eingang.get(item.sha);
      if (have !== undefined && gitSha(have) === item.sha) {
        out.push({ sha: item.sha, content: have });
        continue;
      }
      this.needKey();
      this.repo.request('blob');
      const text = this.repo.blobs.get(item.sha);
      if (text === undefined) throw new SyncFailure('server', 'Datei fehlt in der Ablage.');
      this.eingang.set(item.sha, text);
      out.push({ sha: item.sha, content: text });
    }
    return out;
  }

  async applyBegin(input: ApplyBeginInput) {
    this.calls.push(`applyBegin:${input.kind}`);
    if (this.note) throw new SyncFailure('local', 'Es liegt schon ein Merkzettel.');
    if (input.kind === 'adopt' && [...this.store.files.keys()].some(isSyncedPath))
      throw new SyncFailure('input', 'Der Ordner ist nicht leer.');
    const busy: string[] = [];
    for (const w of input.writes) if (this.localSha(w.path) !== w.expect) busy.push(w.path);
    for (const d of input.deletes) if (this.localSha(d.path) !== d.expect) busy.push(d.path);
    if (busy.length) return { run: 0, busy };
    const stand = this.load();
    let run = stand.runNo + 1;
    while (this.beiseite.has(run)) run++;
    const texts = new Map<string, string>();
    const entries: AsideRun['entries'] = [];
    const aside = (side: 'hier' | 'dort', path: string, text: string) => {
      texts.set(`${side}/${path}`, text);
      entries.push({ side, path, sha: gitSha(text), title: path });
    };
    const writes: Note['writes'] = input.writes.map((w: ApplyWrite) => {
      const here = this.store.files.get(w.path);
      if (here !== undefined) aside('hier', w.path, here);
      if ('content' in w) {
        const sha = gitSha(w.content);
        this.eingang.set(sha, w.content);
        return { path: w.path, sha, expect: w.expect, base: w.base };
      }
      return { path: w.path, sha: w.sha, expect: w.expect, base: w.base };
    });
    for (const d of input.deletes) aside('hier', d.path, this.store.files.get(d.path)!);
    for (const k of input.keep) aside('dort', k.path, this.eingang.get(k.sha)!);
    if (entries.length)
      this.beiseite.set(run, {
        run,
        at: new Date().toISOString(),
        reason: input.reason,
        entries,
        texts,
      });
    this.writeStand({ ...stand, runNo: run });
    this.note = {
      kind: input.kind,
      run,
      head: input.head,
      writes,
      deletes: input.deletes,
      link: input.link ?? null,
      baseAll: input.baseAll ?? null,
    };
    this.crashIf('applyBegin');
    return { run, busy: [] };
  }

  async applyEnd(_root: string, run: number) {
    this.calls.push('applyEnd');
    const note = this.note;
    if (!note || note.run !== run) throw new SyncFailure('local', 'Der Merkzettel passt nicht.');
    const done = [
      ...note.writes.filter((w) => this.localSha(w.path) === w.sha).map((w) => w.path),
      ...note.deletes.filter((d) => this.localSha(d.path) === null).map((d) => d.path),
    ];
    const left = [...note.writes, ...note.deletes]
      .map((x) => x.path)
      .filter((p) => !done.includes(p));
    this.finishNote(note, done);
    return { done, left };
  }

  async applyAbort(_root: string, run: number) {
    this.calls.push('applyAbort');
    if (this.note?.run === run) this.note = null;
    this.beiseite.delete(run);
  }

  async push(input: PushInput) {
    this.calls.push('push');
    this.needKey();
    const target = input.link ?? this.verbindung;
    if (!target) throw new SyncFailure('input', 'Der Abgleich ist nicht eingerichtet.');
    if (!this.repo.isPrivate) throw new SyncFailure('denied', 'Die Ablage ist öffentlich.');
    const hadBase = !!this.load().files;
    // 1. Jede Datei roh lesen und gegen den Plan prüfen – eine Abweichung, und nichts geht hoch.
    const texts = new Map<string, string>();
    for (const c of input.changes) {
      if (c.sha === null) continue;
      const text = this.store.files.get(c.path);
      if (text === undefined || gitSha(text) !== c.sha)
        throw new SyncFailure('busy', 'Eine Datei hat sich inzwischen geändert.');
      texts.set(c.path, text);
    }
    let parent = input.head;
    if (parent === null && this.repo.head === null) {
      this.repo.request('put-readme');
      const files = new Map([['README.md', this.repo.putBlob('# Spielstand\n')]]);
      const first = this.repo.makeCommit(null, files, null);
      this.repo.head = first.sha;
      parent = first.sha;
    }
    const files = this.repo.files(parent);
    for (const c of input.changes) {
      if (c.sha === null) files.delete(c.path);
      else files.set(c.path, this.repo.putBlob(texts.get(c.path)!));
    }
    const old = this.repo.markerOf(parent);
    const marker: Marker = {
      datenstand: Math.max(old?.datenstand ?? 0, input.dataVersion),
      gestalt: !old || input.dataVersion >= old.datenstand ? input.dataShape : old.gestalt,
      geraete: { ...(old?.geraete ?? {}), [target.device]: input.dataVersion },
    };
    files.set('wayfarer.json', this.repo.putBlob(markerText(marker)));
    if (!files.has('.gitattributes')) files.set('.gitattributes', this.repo.putBlob('* -text\n'));
    this.repo.request('trees');
    this.repo.request('commit');
    const commit = this.repo.makeCommit(parent, files, target.device);
    this.crashIf('push:beforeSwitch');
    this.repo.beforeSwitch?.();
    this.repo.request('patch');
    if (this.repo.head !== parent)
      throw new SyncFailure('moved', 'Der andere Rechner war schneller.');
    this.repo.head = commit.sha;
    this.crashIf('push:afterSwitch');
    const stand = this.load();
    const base = { ...(stand.files ?? {}) };
    for (const c of input.changes) {
      if (c.sha === null) delete base[c.path];
      else base[c.path] = c.sha;
    }
    this.writeStand({
      ...stand,
      // Wie die Rust-Seite: Ein inzwischen verworfener gemeinsamer Stand entsteht nicht neu.
      files: stand.files || !hadBase ? base : null,
      repo: `${target.owner}/${target.repo}`,
      maxVersion: Math.max(stand.maxVersion, marker.datenstand),
      seen: {
        commit: commit.sha,
        tree: commit.tree,
        files: Object.fromEntries(commit.files),
        marker,
        device: target.device,
        pushedAt: commit.at,
      },
    });
    return { head: commit.sha, tree: commit.tree };
  }

  async mark(input: MarkInput) {
    this.calls.push(input.dropBase ? 'mark:dropBase' : 'mark');
    const stand = this.load();
    const next: Stand = { ...stand, decided: { ...stand.decided } };
    if (input.base) {
      const files = { ...(stand.files ?? {}) };
      for (const b of input.base) {
        if (b.sha === null) delete files[b.path];
        else files[b.path] = b.sha;
      }
      next.files = files;
    }
    if (input.decided)
      for (const [key, d] of Object.entries(input.decided)) {
        if (d === null) delete next.decided[key];
        else next.decided[key] = d;
      }
    if (input.olderEdits !== undefined) next.olderEdits = input.olderEdits;
    if (input.dropBase) {
      next.files = null;
      next.restored = true;
    }
    if (input.synced) {
      // Wie die Rust-Seite: Mit gemeinsamem Stand ist der eingespielte Stand erledigt.
      if (next.files) next.restored = false;
      next.syncedAt = new Date().toISOString();
      if (!this.note) this.eingang.clear();
      // Ausdünnen: die 50 jüngsten gewöhnlichen Läufe bleiben, Entscheidungen immer.
      const ordinary = [...this.beiseite.values()]
        .filter((r) => r.reason === 'abgleich' || r.reason === 'zurueckholen')
        .sort((a, b) => b.run - a.run);
      for (const r of ordinary.slice(50)) this.beiseite.delete(r.run);
    }
    this.writeStand(next);
  }

  async asideList(): Promise<AsideRun[]> {
    return [...this.beiseite.values()]
      .sort((a, b) => b.run - a.run)
      .map(({ run, at, reason, entries }) => ({ run, at, reason, entries }));
  }
  async asideRead(_root: string, run: number, side: 'hier' | 'dort', path: string) {
    const text = this.beiseite.get(run)?.texts.get(`${side}/${path}`);
    if (text === undefined) throw new SyncFailure('input', 'Nicht beiseitegelegt.');
    return text;
  }
  async asidePut(_root: string, paths: string[], reason: AsideReason) {
    const stand = this.load();
    let run = stand.runNo + 1;
    while (this.beiseite.has(run)) run++;
    const texts = new Map<string, string>();
    const entries = paths.flatMap((path) => {
      const text = this.store.files.get(path);
      if (text === undefined) return [];
      texts.set(`hier/${path}`, text);
      return [{ side: 'hier' as const, path, sha: gitSha(text), title: path }];
    });
    this.beiseite.set(run, { run, at: new Date().toISOString(), reason, entries, texts });
    this.writeStand({ ...stand, runNo: run });
    return { run };
  }
  async asideDrop(_root: string, run: number) {
    this.beiseite.delete(run);
  }
}

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
