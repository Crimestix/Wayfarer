/**
 * Startbildschirm: „Spielstand holen“ (Entwurf 1.3) – am zweiten Rechner in einen neuen, leeren
 * Ordner. Alles steht als Zeile im Panel, keine Meldungen. Abgelegt wird erst beim Öffnen über
 * `openCampaign` (Merkzettel) – es gibt keinen eigenen Schreibweg. Liegt im Ordner ein
 * angefangenes Holen, macht „Holen fortsetzen“ dort weiter.
 */
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { CampaignDb } from '../../data/db';
import { toSyncFailure, type FoundRepo, type SyncProgress } from '../../data/platform';
import { DATA_VERSION } from '../../domain/schema';
import { Button, Field, Input } from '../../ui';
import { fetchIntoEmptyFolder } from './engine';
import { KeyForm, KeyGuide, ProgressLine } from './KeyParts';
import type { SyncEnv } from './index';
import {
  DEVICE_MAX,
  FETCH_NEWER,
  FETCH_REPO_EMPTY,
  cleanDeviceName,
  defaultDeviceName,
  fetchErrorText,
  foundState,
  foundText,
  probeOutcome,
} from './model';
import './abgleich.css';

export function FetchPanel({
  dir,
  env,
  resume,
  open,
  onOpened,
  onBack,
}: {
  dir: string;
  env: SyncEnv;
  /** Ein angefangenes Holen: diese Einträge fehlen noch. */
  resume: { path: string; sha: string }[] | null;
  /** Öffnet den Ordner (über `openCampaign`). */
  open: (dir: string) => Promise<CampaignDb>;
  onOpened: (db: CampaignDb) => void;
  onBack: () => void;
}) {
  const { port } = env;
  const [device, setDevice] = useState(() => defaultDeviceName(navigator.userAgent));
  const [hasKey, setHasKey] = useState(false);
  const [newKey, setNewKey] = useState(false);
  const [found, setFound] = useState<FoundRepo | null>(null);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState('');
  const [progress, setProgress] = useState<SyncProgress | null>(null);

  useEffect(() => {
    let gone = false;
    port.state(dir, DATA_VERSION).then(
      (st) => !gone && setHasKey(st.key === 'yes'),
      () => undefined,
    );
    return () => {
      gone = true;
    };
  }, [port, dir]);

  useEffect(() => env.onProgress(setProgress), [env]);

  const name = cleanDeviceName(device);
  const state = found ? foundState(found, DATA_VERSION) : null;

  const checkStored = async () => {
    setBusy(true);
    setLine('');
    try {
      let outcome = probeOutcome(await port.probe());
      if (outcome.kind === 'one')
        outcome = probeOutcome(await port.probe(outcome.repo.owner, outcome.repo.repo));
      if (outcome.kind === 'found') setFound(outcome.found);
      else {
        setFound(null);
        setNewKey(true);
      }
      if (outcome.kind !== 'found')
        setLine('Der hinterlegte Schlüssel passt nicht. Füge einen neuen ein.');
    } catch (e) {
      setLine(fetchErrorText(toSyncFailure(e)));
    } finally {
      setBusy(false);
    }
  };

  const fetchHere = async () => {
    if (!found || !name) return;
    const link = {
      owner: found.info.owner,
      repo: found.info.repo,
      branch: found.info.branch,
      device: name,
      root: dir,
    };
    setBusy(true);
    setLine('');
    try {
      if (resume?.length) await port.fetch(dir, resume, link);
      else await fetchIntoEmptyFolder(port, dir, link);
      setProgress({ phase: 'ablegen', done: 0, total: 0 });
      onOpened(await open(dir));
    } catch (e) {
      setLine(fetchErrorText(toSyncFailure(e)));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="wf-abgleich-fetch">
      <p className="wf-soft">
        In <span className="wf-gold">{dir}</span> landet deine Kampagne. Dafür braucht Wayfarer
        einen eigenen Zugangsschlüssel für diesen Rechner. Den vom anderen Rechner kannst du nicht
        noch einmal verwenden – er wird nirgends angezeigt.
      </p>
      <Field
        label="So heißt dieser Rechner im Abgleich"
        hint={name ? undefined : 'Der Rechner braucht einen Namen.'}
      >
        <Input
          value={device}
          maxLength={DEVICE_MAX}
          onChange={(e) => setDevice(e.target.value)}
          className="wf-abgleich-device"
        />
      </Field>
      <details open>
        <summary>So erzeugst du den Schlüssel</summary>
        <KeyGuide device={name || 'Rechner'} second loginOnly />
      </details>
      {hasKey && !newKey ? (
        <div className="wf-row-wrap">
          <span className="wf-soft">Ein Zugangsschlüssel ist hinterlegt.</span>
          <Button disabled={busy} onClick={() => void checkStored()}>
            {busy && !found ? 'Wird geprüft …' : 'Prüfen'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNewKey(true)}>
            Anderen einfügen
          </Button>
        </div>
      ) : (
        <KeyForm
          port={port}
          label="Prüfen"
          primary={false}
          quietFound
          onResult={(r) => setFound(r.found)}
        />
      )}
      {found && (
        <p className="wf-soft">
          <strong>{foundText(found)}</strong>
        </p>
      )}
      {state === 'empty' && <p className="wf-abgleich-error">{FETCH_REPO_EMPTY}</p>}
      {state === 'newer' && <p className="wf-soft">{FETCH_NEWER}</p>}
      <div className="wf-row-wrap">
        <Button
          variant="primary"
          icon={<Download />}
          disabled={busy || !found || state === 'empty' || !name}
          onClick={() => void fetchHere()}
        >
          {resume?.length ? 'Holen fortsetzen' : 'In diesen Ordner holen'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onBack}>
          {resume ? 'Anderen Ordner wählen' : 'Abbrechen'}
        </Button>
      </div>
      {busy && progress && (
        <ProgressLine
          progress={progress}
          fallback={progress.phase === 'ablegen' ? 'Lege ab …' : 'Hole den Spielstand …'}
        />
      )}
      {line && (
        <p className="wf-abgleich-line wf-abgleich-error" role="alert">
          {line}
        </p>
      )}
    </div>
  );
}
