import { useEffect, useState } from 'react';
import { Router } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { CampaignDb, CampaignMissingError } from './data/db';
import { DbContext } from './data/hooks';
import { loadLocalMedia } from './data/media';
import { SyncInterruptedError, openCampaign } from './data/openCampaign';
import { getConfig, isDesktopApp, onAppClosing, onAppClosingAfterSave } from './data/platform';
import { elarisCampaign } from './data/seed';
import { BrowserStore } from './data/store';
import { detectTestMode, useTestMode } from './data/testMode';
import { AppShell } from './shell/AppShell';
import { Welcome, type WelcomeEnv } from './shell/Welcome';
import { startSync, stopSync } from './features/abgleich';
import type { Probe } from './features/abgleich/probe';
import { flushEdits } from './features/wiki/editing';
import { draftRegister } from './ui/drafts';

type Phase =
  | { kind: 'loading' }
  | { kind: 'welcome'; error?: string; interruptedDir?: string; env?: WelcomeEnv }
  | { kind: 'ready'; db: CampaignDb };

/** Probe des Abgleichs in der Vorschau (`?abgleich`, nur während der Entwicklung). */
let probe: Probe | null = null;

/** Öffnet die Kampagne: in der installierten App aus dem Ordner, im Browser den Elaris-Grundstand. */
/**
 * Startet genau einmal, auch wenn React den Effekt im Entwicklungsmodus doppelt ausführt –
 * sonst entstünde der Grundstand zweimal.
 */
let booting: Promise<Phase> | null = null;
const bootOnce = () => (booting ??= boot());

async function boot(): Promise<Phase> {
  if (isDesktopApp()) {
    const { campaignDir } = await getConfig();
    if (!campaignDir) return { kind: 'welcome' };
    try {
      return { kind: 'ready', db: await openCampaign(campaignDir) };
    } catch (error) {
      // Ein unterbrochener Abgleich: nie still einen halben Stand öffnen – „Fortsetzen“ anbieten.
      if (error instanceof SyncInterruptedError)
        return { kind: 'welcome', interruptedDir: campaignDir };
      return {
        kind: 'welcome',
        error:
          error instanceof CampaignMissingError
            ? `Im zuletzt verwendeten Ordner (${campaignDir}) liegt keine Kampagne mehr.`
            : `Die Kampagne in ${campaignDir} ließ sich nicht öffnen: ${(error as Error).message}`,
      };
    }
  }
  const params = new URLSearchParams(location.search);
  if (import.meta.env.DEV && params.has('abgleich')) {
    const { startProbe } = await import('./features/abgleich/probe');
    probe = await startProbe(params.has('welcome'), params.get('abgleich') === 'eingerichtet');
    if (probe.welcome) return { kind: 'welcome', env: probe.welcome };
    return { kind: 'ready', db: await probe.reopen() };
  }
  if (params.has('welcome')) return { kind: 'welcome' };
  const store = new BrowserStore();
  if (params.has('reset')) store.clear();
  try {
    return { kind: 'ready', db: await CampaignDb.open(store) };
  } catch (error) {
    if (!(error instanceof CampaignMissingError)) throw error;
    return { kind: 'ready', db: await CampaignDb.create(store, elarisCampaign()) };
  }
}

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    bootOnce().then(
      (next) => !cancelled && setPhase(next),
      (error) =>
        !cancelled && setPhase({ kind: 'welcome', error: String(error?.message ?? error) }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Testmodus: Liegt sein Zeichen im Ordner, läuft er weiter – und der Abgleich ruht. Erst wenn
  // für diese Kampagne nachgesehen ist, beginnt unten irgendetwas (sonst liefe der Abgleich an).
  const testing = useTestMode() !== null;
  const [checked, setChecked] = useState<CampaignDb | null>(null);
  useEffect(() => {
    if (phase.kind !== 'ready') return;
    let cancelled = false;
    const { db } = phase;
    void detectTestMode(db.store).then(() => !cancelled && setChecked(db));
    return () => {
      cancelled = true;
    };
  }, [phase]);

  useEffect(() => {
    if (phase.kind !== 'ready' || checked !== phase.db) return;
    const { db } = phase;
    // Welche Bilder schon auf diesem Rechner liegen (nur in der installierten App).
    void loadLocalMedia(db.store.location);
    const flush = () => void db.flush();
    window.addEventListener('beforeunload', flush);
    window.addEventListener('blur', flush);
    // Installierte App: Das Fenster schließt erst, wenn alles geschrieben ist.
    const offClosing = onAppClosing(async () => {
      await db.flush();
      return !db.hasUnsavedChanges();
    });
    // Abgleich (nur installierte App, nur mit Verbindung für diesen Ordner; sonst tut er nichts).
    // Im Testmodus ruht er: Nichts davon darf den anderen Rechner erreichen.
    const sync = testing
      ? null
      : startSync(db, {
          beforeScan: flushEdits,
          drafts: draftRegister,
          // Nach „Der Stand aus der Ablage gilt“: neu laden; `openCampaign` bringt es zu Ende.
          reload: probe
            ? () => {
                const current = probe!;
                setPhase({ kind: 'loading' });
                void current.reopen().then((next) => setPhase({ kind: 'ready', db: next }));
              }
            : () => window.location.reload(),
        });
    const offSyncClose = sync ? onAppClosingAfterSave(() => sync.beforeClose()) : () => undefined;
    const away = () => sync?.pushSoon();
    const back = () => sync?.wake();
    const visibility = () => (document.hidden ? away() : back());
    window.addEventListener('blur', away);
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', visibility);
    // Rechner aufgewacht: Ein 30-s-Takt, der über zwei Minuten ausblieb, heißt „Deckel war zu“.
    let tick = Date.now();
    const clock = window.setInterval(() => {
      const now = Date.now();
      if (now - tick > 120_000) back();
      tick = now;
    }, 30_000);
    return () => {
      offClosing();
      offSyncClose();
      window.removeEventListener('blur', away);
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', visibility);
      window.clearInterval(clock);
      stopSync();
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('blur', flush);
      // Nicht schließen: Die Kampagne bleibt geöffnet, solange die App läuft. React führt diesen
      // Effekt im Entwicklungsmodus doppelt aus; ein close() hier würde die Dateiüberwachung beenden.
      flush();
    };
  }, [phase, checked, testing]);

  if (phase.kind === 'loading') return null;
  if (phase.kind === 'welcome')
    return (
      <Welcome
        initialError={phase.error}
        interruptedDir={phase.interruptedDir}
        env={phase.env}
        onOpen={(db) => setPhase({ kind: 'ready', db })}
      />
    );
  const ProbePanel = probe?.Panel;
  return (
    <DbContext.Provider value={phase.db}>
      <Router hook={useHashLocation}>
        <AppShell />
        {ProbePanel && <ProbePanel />}
      </Router>
    </DbContext.Provider>
  );
}
