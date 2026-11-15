/**
 * Startbildschirm der installierten App: Kampagnenordner wählen, neu anlegen, importieren – oder
 * den Spielstand vom anderen Rechner holen (Abgleich). Liegt ein unterbrochener Abgleich im
 * Ordner, bietet er „Fortsetzen“ an, statt einen halben Stand zu öffnen.
 */
import { useRef, useState } from 'react';
import { Download, FolderOpen, RotateCw, Scroll, Sparkles } from 'lucide-react';
import { CampaignDb, CampaignMissingError } from '../data/db';
import { SyncInterruptedError, openCampaign } from '../data/openCampaign';
import { FolderStore, pickFolder, setConfig, toSyncFailure } from '../data/platform';
import { elarisCampaign } from '../data/seed';
import type { CampaignData } from '../domain/schema';
import { DATA_VERSION } from '../domain/schema';
import { hasCampaignFiles } from '../domain/sync';
import { FetchPanel } from '../features/abgleich/FetchPanel';
import { syncEnv, type SyncEnv } from '../features/abgleich';
import { FETCH_NOT_EMPTY, PARTS_IN_FOLDER, fetchErrorText } from '../features/abgleich/model';
import { showSyncSettings } from '../features/abgleich/open';
import { importV157Backup } from '../features/import/v157';
import { Button, Panel, toast } from '../ui';
import emblem from '../ui/assets/emblem.webp';
import './shell.css';

/** Was der Startbildschirm braucht – in der App die Rust-Seite, in der Probe der Vorschau eine Attrappe. */
export interface WelcomeEnv {
  pickFolder(title: string): Promise<string | null>;
  open(dir: string): Promise<CampaignDb>;
  create(dir: string, data: CampaignData): Promise<CampaignDb>;
  remember(dir: string): Promise<void>;
  sync: SyncEnv | null;
}

export const desktopWelcome = (): WelcomeEnv => ({
  pickFolder,
  open: (dir) => openCampaign(dir),
  create: (dir, data) => CampaignDb.create(new FolderStore(dir), data),
  remember: (dir) => setConfig({ campaignDir: dir }),
  sync: syncEnv(),
});

type Mode =
  | { kind: 'start' }
  | { kind: 'empty'; parts: boolean }
  | { kind: 'fetch'; resume: { path: string; sha: string }[] | null }
  /** `fetching`: Es war ein Holen in diesen Ordner (dann „Holen fortsetzen“). */
  | { kind: 'interrupted'; fetching: boolean };

/** Nach dem Holen: einmal die Meldung „Spielstand geholt“ mit dem Weg zu den Bildern. */
function announceFetched() {
  toast({
    title: 'Spielstand geholt.',
    body: 'Bilder reisen nicht mit – hole sie einmal auf diesen Rechner.',
    duration: 20000,
    action: {
      label: 'Zu den Bildern',
      run: () => showSyncSettings((to) => (window.location.hash = `#${to}`), 'bilder'),
    },
  });
}

export function Welcome({
  onOpen,
  initialError,
  interruptedDir,
  env: given,
}: {
  onOpen: (db: CampaignDb) => void;
  initialError?: string;
  /** Beim Start: In diesem Ordner liegt ein unterbrochener Abgleich. */
  interruptedDir?: string;
  env?: WelcomeEnv;
}) {
  const [dir, setDir] = useState<string | null>(interruptedDir ?? null);
  const [mode, setMode] = useState<Mode>(
    interruptedDir ? { kind: 'interrupted', fetching: false } : { kind: 'start' },
  );
  const [error, setError] = useState(initialError ?? '');
  const [report, setReport] = useState<string[]>([]);
  const [pending, setPending] = useState<CampaignData | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [env] = useState(() => given ?? desktopWelcome());
  const sync = env.sync;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const opened = async (picked: string, db: CampaignDb) => {
    await env.remember(picked);
    onOpen(db);
  };

  /** Was schon im Ordner liegt (ohne Netz): Teile eines Spielstands, ein angefangenes Holen. */
  const lookInto = async (picked: string) => {
    if (!sync) return { parts: false, pending: null as string | null };
    const [scan, state] = await Promise.all([
      sync.port.scan(picked, false),
      sync.port.state(picked, DATA_VERSION),
    ]);
    const paths = [...scan.local.map((f) => f.path), ...scan.frozen.map((f) => f.path)];
    return { parts: hasCampaignFiles(paths), pending: state.pending };
  };

  const choose = () =>
    run(async () => {
      const picked = await env.pickFolder('Kampagnenordner wählen');
      if (!picked) return;
      setDir(picked);
      try {
        await opened(picked, await env.open(picked));
      } catch (e) {
        if (e instanceof SyncInterruptedError) {
          const seen = await lookInto(picked);
          return setMode({ kind: 'interrupted', fetching: seen.pending === 'adopt' });
        }
        if (!(e instanceof CampaignMissingError)) throw e;
        const seen = await lookInto(picked);
        if (seen.pending)
          return setMode({ kind: 'interrupted', fetching: seen.pending === 'adopt' });
        setMode({ kind: 'empty', parts: seen.parts });
      }
    });

  const fetchInto = (picked?: string) =>
    run(async () => {
      const target = picked ?? (await env.pickFolder('Neuen, leeren Ordner anlegen und wählen'));
      if (!target) return;
      setDir(target);
      const seen = await lookInto(target);
      if (seen.pending) return setMode({ kind: 'interrupted', fetching: seen.pending === 'adopt' });
      if (seen.parts) {
        setMode({ kind: 'start' });
        throw new Error(FETCH_NOT_EMPTY);
      }
      setMode({ kind: 'fetch', resume: null });
    });

  /** „Fortsetzen“: den Merkzettel zu Ende bringen; fehlt etwas, wird es (mit Netz) nachgeholt. */
  const resume = () =>
    run(async () => {
      if (!dir || !sync) return;
      try {
        const state = await sync.port.state(dir, DATA_VERSION);
        const { left } = await sync.port.recover(dir);
        if (left.length) {
          if (!state.link) return setMode({ kind: 'fetch', resume: left });
          await sync.port.fetch(dir, left);
        }
        await opened(dir, await env.open(dir));
        if (state.pending === 'adopt') announceFetched();
      } catch (e) {
        if (e instanceof SyncInterruptedError) throw new Error(e.message);
        throw new Error(fetchErrorText(toSyncFailure(e)));
      }
    });

  const create = (seed: () => CampaignData) =>
    run(async () => {
      if (!dir) return;
      await opened(dir, await env.create(dir, seed()));
    });

  /** Liest die Backup-Datei und zeigt erst den Bericht; übernommen wird nach Bestätigung. */
  const importFile = (f: File) =>
    run(async () => {
      let raw: unknown;
      try {
        raw = JSON.parse(await f.text());
      } catch {
        throw new Error(
          `„${f.name}“ ist keine lesbare Backup-Datei. Erwartet wird die .json-Datei aus dem Menü der alten Version („Backup herunterladen“).`,
        );
      }
      const result = importV157Backup(raw);
      setReport(result.report);
      setPending(result.data);
    });

  const fetchCard = (
    <button
      type="button"
      className="wf-choice"
      onClick={() => void fetchInto(mode.kind === 'empty' ? (dir ?? undefined) : undefined)}
      disabled={busy}
    >
      <Download />
      <span>
        <span className="wf-choice__title">Spielstand vom anderen Rechner holen</span>
        <br />
        <span className="wf-mute">
          Du hast den Abgleich am anderen Rechner eingerichtet? Wayfarer lädt die Kampagne in einen
          neuen, leeren Ordner.
        </span>
      </span>
    </button>
  );

  const title =
    mode.kind === 'empty'
      ? 'Dieser Ordner ist noch leer'
      : mode.kind === 'fetch'
        ? 'Spielstand holen'
        : mode.kind === 'interrupted'
          ? 'Ein Abgleich wurde unterbrochen'
          : 'Kampagne öffnen';

  return (
    <div className="wf-welcome">
      <div className="wf-welcome__card">
        <div className="wf-welcome__mark">
          <img src={emblem} alt="" draggable={false} />
          <h1 className="wf-welcome__title">Wayfarer</h1>
          <p className="wf-mute wf-italic">Der Spielleiterschirm für eine lebendige Kampagne.</p>
        </div>
        <Panel title={title}>
          <div className="wf-col">
            {mode.kind === 'start' && (
              <>
                <p className="wf-soft">
                  Wayfarer speichert eine Kampagne als Ordner voller kleiner Dateien auf deinem
                  Rechner. Wähle dafür einen eigenen, leeren Ordner – oder einen, in dem schon eine
                  Wayfarer-Kampagne liegt.
                </p>
                <button type="button" className="wf-choice" onClick={choose} disabled={busy}>
                  <FolderOpen />
                  <span>
                    <span className="wf-choice__title">Kampagnenordner wählen</span>
                    <br />
                    <span className="wf-mute">
                      Einen vorhandenen öffnen oder einen leeren Ordner für eine neue Kampagne.
                    </span>
                  </span>
                </button>
                {sync && fetchCard}
              </>
            )}
            {mode.kind === 'empty' && (
              <>
                <p className="wf-soft">
                  In <span className="wf-gold">{dir}</span> liegt noch keine Kampagne. Womit soll
                  sie beginnen?
                </p>
                {sync && fetchCard}
                {mode.parts && <p className="wf-soft">{PARTS_IN_FOLDER}</p>}
                <button
                  type="button"
                  className="wf-choice"
                  onClick={() => file.current?.click()}
                  disabled={busy || mode.parts}
                >
                  <Scroll />
                  <span>
                    <span className="wf-choice__title">
                      Spielstand der alten Version übernehmen
                    </span>
                    <br />
                    <span className="wf-mute">
                      Backup-Datei (.json) aus dem bisherigen Wayfarer einlesen.
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="wf-choice"
                  onClick={() => create(elarisCampaign)}
                  disabled={busy || mode.parts}
                >
                  <Sparkles />
                  <span>
                    <span className="wf-choice__title">Elaris neu beginnen</span>
                    <br />
                    <span className="wf-mute">
                      Kalender von Elaris, die sechs Gefährten, 17. Tauwind 701 AD.
                    </span>
                  </span>
                </button>
                <div>
                  <Button variant="ghost" onClick={() => setMode({ kind: 'start' })}>
                    Anderen Ordner wählen
                  </Button>
                </div>
                <input
                  ref={file}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importFile(f);
                    e.target.value = '';
                  }}
                />
              </>
            )}
            {mode.kind === 'fetch' && dir && sync && (
              <FetchPanel
                dir={dir}
                env={sync}
                resume={mode.resume}
                open={env.open}
                onOpened={(db) => {
                  void opened(dir, db).then(announceFetched);
                }}
                onBack={() => setMode({ kind: 'start' })}
              />
            )}
            {mode.kind === 'interrupted' && (
              <>
                <p className="wf-soft">
                  In <span className="wf-gold">{dir}</span> wurde ein Abgleich mittendrin
                  unterbrochen – etwa weil der Rechner ausging oder die Verbindung abriss. Damit
                  kein halber Stand geöffnet wird, bringt „Fortsetzen“ ihn zuerst zu Ende. Was schon
                  da ist, bleibt.
                </p>
                <div className="wf-row-wrap">
                  <Button variant="primary" icon={<RotateCw />} disabled={busy} onClick={resume}>
                    {busy
                      ? 'Wird fortgesetzt …'
                      : mode.fetching
                        ? 'Holen fortsetzen'
                        : 'Fortsetzen'}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setMode({ kind: 'start' })}
                  >
                    Anderen Ordner wählen
                  </Button>
                </div>
              </>
            )}
            {error && <p style={{ color: 'var(--blood-bright)' }}>{error}</p>}
            {report.length > 0 && (
              <ul className="wf-mute">
                {report.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
            {pending && (
              <div className="wf-row">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => {
                    const data = pending;
                    setPending(null);
                    void create(() => data);
                  }}
                >
                  So übernehmen
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setPending(null);
                    setReport([]);
                  }}
                >
                  Abbrechen
                </Button>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
