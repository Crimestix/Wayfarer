import { useEffect, useState } from 'react';
import { Router } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { CampaignDb, CampaignMissingError } from './data/db';
import { DbContext } from './data/hooks';
import { loadLocalMedia } from './data/media';
import { openCampaign } from './data/openCampaign';
import { getConfig, isDesktopApp, onAppClosing, onAppClosingAfterSave } from './data/platform';
import { elarisCampaign } from './data/seed';
import { BrowserStore } from './data/store';
import { AppShell } from './shell/AppShell';
import { Welcome } from './shell/Welcome';
import { startSync, stopSync } from './features/abgleich';
import { flushEdits } from './features/wiki/editing';
import { draftRegister } from './ui/drafts';

type Phase =
  { kind: 'loading' } | { kind: 'welcome'; error?: string } | { kind: 'ready'; db: CampaignDb };

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

  useEffect(() => {
    if (phase.kind !== 'ready') return;
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
    const sync = startSync(db, {
      beforeScan: flushEdits,
      drafts: draftRegister,
      reload: () => window.location.reload(),
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
  }, [phase]);

  if (phase.kind === 'loading') return null;
  if (phase.kind === 'welcome')
    return <Welcome initialError={phase.error} onOpen={(db) => setPhase({ kind: 'ready', db })} />;
  return (
    <DbContext.Provider value={phase.db}>
      <Router hook={useHashLocation}>
        <AppShell />
      </Router>
    </DbContext.Provider>
  );
}
