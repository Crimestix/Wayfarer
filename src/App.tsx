import { useEffect, useState } from 'react';
import { Router } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { CampaignDb, CampaignMissingError } from './data/db';
import { DbContext } from './data/hooks';
import { FolderStore, getConfig, isDesktopApp } from './data/platform';
import { demoCampaign } from './data/seed';
import { BrowserStore } from './data/store';
import { AppShell } from './shell/AppShell';
import { Welcome } from './shell/Welcome';

type Phase =
  | { kind: 'loading' }
  | { kind: 'welcome'; error?: string }
  | { kind: 'ready'; db: CampaignDb };

/** Öffnet die Kampagne: in der installierten App aus dem Ordner, im Browser eine Beispielwelt. */
async function boot(): Promise<Phase> {
  if (isDesktopApp()) {
    const { campaignDir } = await getConfig();
    if (!campaignDir) return { kind: 'welcome' };
    try {
      return { kind: 'ready', db: await CampaignDb.open(new FolderStore(campaignDir)) };
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
    return { kind: 'ready', db: await CampaignDb.create(store, demoCampaign()) };
  }
}

export function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    boot().then(
      (next) => !cancelled && setPhase(next),
      (error) => !cancelled && setPhase({ kind: 'welcome', error: String(error?.message ?? error) }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase.kind !== 'ready') return;
    const { db } = phase;
    const flush = () => void db.flush();
    window.addEventListener('beforeunload', flush);
    window.addEventListener('blur', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      window.removeEventListener('blur', flush);
      db.close();
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
