/** Startbildschirm der installierten App: Kampagnenordner wählen, neu anlegen oder importieren. */
import { useRef, useState } from 'react';
import { FolderOpen, Scroll, Sparkles } from 'lucide-react';
import { CampaignDb, CampaignMissingError } from '../data/db';
import { FolderStore, pickFolder, setConfig } from '../data/platform';
import { elarisCampaign } from '../data/seed';
import type { CampaignData } from '../domain/schema';
import { importV157Backup } from '../features/import/v157';
import { Button, Panel } from '../ui';
import { Sigil } from './Sigil';
import './shell.css';

export function Welcome({ onOpen, initialError }: { onOpen: (db: CampaignDb) => void; initialError?: string }) {
  const [dir, setDir] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState(initialError ?? '');
  const [report, setReport] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

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

  const choose = () =>
    run(async () => {
      const picked = await pickFolder('Kampagnenordner wählen');
      if (!picked) return;
      setDir(picked);
      try {
        const db = await CampaignDb.open(new FolderStore(picked));
        await setConfig({ campaignDir: picked });
        onOpen(db);
      } catch (e) {
        if (!(e instanceof CampaignMissingError)) throw e;
        setEmpty(true);
      }
    });

  const create = (seed: () => CampaignData) =>
    run(async () => {
      if (!dir) return;
      const db = await CampaignDb.create(new FolderStore(dir), seed());
      await setConfig({ campaignDir: dir });
      onOpen(db);
    });

  const importFile = (f: File) =>
    run(async () => {
      const result = importV157Backup(JSON.parse(await f.text()));
      setReport(result.report);
      await create(() => result.data);
    });

  return (
    <div className="wf-welcome">
      <div className="wf-welcome__card">
        <div className="wf-welcome__mark">
          <Sigil />
          <h1 className="wf-welcome__title">Wayfarer</h1>
          <p className="wf-mute wf-italic">Der Spielleiterschirm für eine lebendige Kampagne.</p>
        </div>
        <Panel title={empty ? 'Dieser Ordner ist noch leer' : 'Kampagne öffnen'}>
          <div className="wf-col">
            {!empty ? (
              <>
                <p className="wf-soft">
                  Wayfarer speichert eine Kampagne als Ordner voller kleiner Dateien. Liegt der Ordner in
                  einem Cloud-Laufwerk (OneDrive, Dropbox, Google Drive, iCloud), teilen sich alle deine
                  Rechner denselben Spielstand.
                </p>
                <button type="button" className="wf-choice" onClick={choose} disabled={busy}>
                  <FolderOpen />
                  <span>
                    <span className="wf-choice__title">Kampagnenordner wählen</span>
                    <br />
                    <span className="wf-mute">Einen vorhandenen öffnen oder einen leeren Ordner für eine neue Kampagne.</span>
                  </span>
                </button>
              </>
            ) : (
              <>
                <p className="wf-soft">
                  In <span className="wf-gold">{dir}</span> liegt noch keine Kampagne. Womit soll sie beginnen?
                </p>
                <button type="button" className="wf-choice" onClick={() => file.current?.click()} disabled={busy}>
                  <Scroll />
                  <span>
                    <span className="wf-choice__title">Spielstand der alten Version übernehmen</span>
                    <br />
                    <span className="wf-mute">Backup-Datei (.json) aus dem bisherigen Wayfarer einlesen.</span>
                  </span>
                </button>
                <button type="button" className="wf-choice" onClick={() => create(elarisCampaign)} disabled={busy}>
                  <Sparkles />
                  <span>
                    <span className="wf-choice__title">Elaris neu beginnen</span>
                    <br />
                    <span className="wf-mute">Kalender von Elaris, die sechs Gefährten, 17. Tauwind 701 AD.</span>
                  </span>
                </button>
                <div>
                  <Button variant="ghost" onClick={() => setEmpty(false)}>
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
            {error && <p style={{ color: 'var(--blood-bright)' }}>{error}</p>}
            {report.length > 0 && (
              <ul className="wf-mute">
                {report.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
