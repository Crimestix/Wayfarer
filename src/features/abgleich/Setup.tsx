/**
 * Abgleich einrichten – eine geführte Folge im Abschnitt selbst (Entwurf 1.2): Vorab-Wahl, fünf
 * Schritte, Wiedereinstieg mit hinterlegtem Schlüssel. Die Verbindung entsteht erst mit dem
 * gelungenen ersten Abgleich; bis dahin gilt „Noch nicht eingerichtet“.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Laptop, Monitor, Upload } from 'lucide-react';
import { useData } from '../../data/hooks';
import { toSyncFailure, type FoundRepo, type SyncLink } from '../../data/platform';
import { DATA_VERSION } from '../../domain/schema';
import { Button, Field, Input, toast } from '../../ui';
import { summarize } from '../einstellungen/backup';
import { FirstSyncDialog, type FirstChoice } from './FirstSyncDialog';
import { KeyForm, KeyGuide, OutLink, ProgressLine } from './KeyParts';
import { activeSync, useSync } from './index';
import {
  DEVICE_MAX,
  GITHUB_HOME,
  NEW_REPO_URL,
  STEP1,
  STEP2_LEAD,
  STEP2_POINTS,
  STEP5_WRONG_REPO,
  STEP_TITLES,
  UPLOAD_DENIED,
  cleanDeviceName,
  defaultDeviceName,
  foundState,
  keyErrorText,
  otherMachineName,
  probeOutcome,
  setUpDone,
  step5Empty,
  SAME_STAND,
} from './model';
import type { FirstSyncInfo } from './state';
import './abgleich.css';

type Step = 0 | 1 | 2 | 3 | 4 | 5;
type Compare = FirstSyncInfo & { older: boolean };

export function Setup({ onClose }: { onClose: () => void }) {
  const sync = activeSync();
  const data = useData();
  const view = useSync();
  const [step, setStep] = useState<Step>(0);
  const [second, setSecond] = useState(false);
  const [device, setDevice] = useState(() => defaultDeviceName(navigator.userAgent));
  const [found, setFound] = useState<FoundRepo | null>(null);
  /** Ein Schlüssel lag schon da und gilt für diese Ablage (Wiedereinstieg). */
  const [stored, setStored] = useState<string | null>(null);
  const [compare, setCompare] = useState<Compare | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; back: boolean } | null>(null);
  const [question, setQuestion] = useState(false);
  const here = useMemo(() => summarize(data), [data]);

  // Wiedereinstieg: Liegt schon ein Schlüssel, gleich prüfen, für welche Ablage er gilt.
  useEffect(() => {
    if (!sync) return;
    let gone = false;
    void (async () => {
      try {
        const st = await sync.port.state(sync.root, DATA_VERSION);
        if (st.key !== 'yes') return;
        const outcome = probeOutcome(await sync.port.probe());
        const final =
          outcome.kind === 'one'
            ? probeOutcome(await sync.port.probe(outcome.repo.owner, outcome.repo.repo))
            : outcome;
        if (gone || final.kind !== 'found') return;
        setFound(final.found);
        setStored(`${final.found.info.owner}/${final.found.info.repo}`);
        setStep(5);
      } catch {
        // Ohne Netz oder mit ungültigem Schlüssel beginnt die Folge von vorn.
      }
    })();
    return () => {
      gone = true;
    };
  }, [sync]);

  const name = cleanDeviceName(device);
  const link: SyncLink | null =
    found && sync && name
      ? {
          owner: found.info.owner,
          repo: found.info.repo,
          branch: found.info.branch,
          device: name,
          root: sync.root,
        }
      : null;

  // Schritt 5: vergleichen, ohne etwas zu ändern.
  useEffect(() => {
    if (step !== 5 || !link || !sync) return;
    let gone = false;
    setCompare(null);
    setError(null);
    sync.engine.compareFirst(link).then(
      (cmp) => !gone && setCompare(cmp),
      (e) => !gone && setError({ text: keyErrorText(toSyncFailure(e)), back: false }),
    );
    return () => {
      gone = true;
    };
    // Der Vergleich gilt für die gewählte Ablage und den Namen des Rechners.
  }, [step, found, name]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sync) return null;

  const run = async (choice: 'upload' | FirstChoice) => {
    if (!link) return;
    setBusy(true);
    setError(null);
    try {
      await sync.engine.firstSync(choice, link);
      setQuestion(false);
      if (choice !== 'remoteWins') {
        toast(
          choice === 'upload'
            ? { ...setUpDone(otherMachineName(name)), duration: 15000 }
            : {
                title: 'Abgleich eingerichtet',
                body: 'Ab jetzt gleicht Wayfarer von selbst ab: beim Öffnen, nach Änderungen und beim Schließen.',
              },
        );
        onClose();
      }
    } catch (e) {
      const failure = toSyncFailure(e);
      setError({
        text: failure.kind === 'denied' ? UPLOAD_DENIED : keyErrorText(failure),
        back: failure.kind === 'denied',
      });
    } finally {
      setBusy(false);
    }
  };

  const nav = (prev: Step | null, next: Step | null, nextOk = true) => (
    <div className="wf-abgleich-setup__nav">
      {/* Während hochgeladen wird, bleibt die Folge stehen – sonst liefe der Abgleich unsichtbar weiter. */}
      <Button variant="ghost" disabled={busy} onClick={onClose}>
        Abbrechen
      </Button>
      <span className="wf-grow" />
      {prev !== null && (
        <Button icon={<ArrowLeft />} disabled={busy} onClick={() => setStep(prev)}>
          Zurück
        </Button>
      )}
      {next !== null && (
        <Button icon={<ArrowRight />} disabled={!nextOk || busy} onClick={() => setStep(next)}>
          Weiter
        </Button>
      )}
    </div>
  );

  const head = (n: number) => (
    <div className="wf-abgleich-setup__head">
      <span className="wf-caps">Schritt {n} von 5</span>
      <h3 className="wf-abgleich-setup__title">{STEP_TITLES[n - 1]}</h3>
    </div>
  );

  if (step === 0)
    return (
      <div className="wf-abgleich-setup">
        <div className="wf-abgleich-setup__choices">
          <button
            type="button"
            className="wf-einstellungen-choice"
            onClick={() => {
              setSecond(false);
              setStep(1);
            }}
          >
            <span className="wf-einstellungen-choice__title">
              <Monitor /> Das ist mein erster Rechner mit Abgleich
            </span>
            <span className="wf-mute">
              Wayfarer legt deinen Spielstand von diesem Rechner in eine neue Ablage bei GitHub.
            </span>
          </button>
          <button
            type="button"
            className="wf-einstellungen-choice"
            onClick={() => {
              setSecond(true);
              setStep(3);
            }}
          >
            <span className="wf-einstellungen-choice__title">
              <Laptop /> Am anderen Rechner ist der Abgleich schon eingerichtet
            </span>
            <span className="wf-mute">
              Du brauchst nur einen eigenen Zugangsschlüssel für diesen Rechner.
            </span>
          </button>
        </div>
        {nav(null, null)}
      </div>
    );

  if (step === 1)
    return (
      <div className="wf-abgleich-setup">
        {head(1)}
        <p className="wf-soft">{STEP1}</p>
        <div>
          <OutLink href={GITHUB_HOME}>GitHub im Browser öffnen</OutLink>
        </div>
        {nav(0, 2)}
      </div>
    );

  if (step === 2)
    return (
      <div className="wf-abgleich-setup">
        {head(2)}
        <p className="wf-soft">{STEP2_LEAD}</p>
        <ol className="wf-abgleich-points">
          {STEP2_POINTS.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
        <div>
          <OutLink href={NEW_REPO_URL}>Seite bei GitHub öffnen</OutLink>
        </div>
        {nav(1, 3)}
      </div>
    );

  if (step === 3)
    return (
      <div className="wf-abgleich-setup">
        {head(3)}
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
        <KeyGuide device={name || 'Rechner'} second={second} />
        {nav(second ? 0 : 2, 4, !!name)}
      </div>
    );

  if (step === 4)
    return (
      <div className="wf-abgleich-setup">
        {head(4)}
        <KeyForm port={sync.port} primary onResult={(result) => setFound(result.found)} />
        {nav(3, 5, !!found)}
      </div>
    );

  // Schritt 5 – der erste Abgleich.
  const state = found ? foundState(found, DATA_VERSION) : null;
  const empty = step5Empty(
    here.name,
    `Weltzeit ${here.worldDate} Uhr`,
    here.parts.slice(0, 4).join(' · '),
  );
  return (
    <div className="wf-abgleich-setup">
      {head(5)}
      {stored && (
        <p className="wf-soft">
          Ein Zugangsschlüssel ist hinterlegt – er gilt für <strong>{stored}</strong>.{' '}
          <Button size="sm" variant="ghost" onClick={() => setStep(3)}>
            Anderen Schlüssel einfügen
          </Button>
        </p>
      )}
      {!compare && !error && <p className="wf-mute">Wayfarer sieht in der Ablage nach …</p>}
      {compare && compare.remoteEmpty && (
        <>
          <p className="wf-soft">
            {empty.before}
            <strong>{empty.strong}</strong>
            {empty.after}
          </p>
          {!second && <p className="wf-mute wf-italic">{STEP5_WRONG_REPO}</p>}
          <div>
            <Button
              variant="primary"
              icon={<Upload />}
              disabled={busy}
              onClick={() => void run('upload')}
            >
              {busy ? 'Wird hochgeladen …' : 'Spielstand hochladen'}
            </Button>
          </div>
        </>
      )}
      {compare &&
        !compare.remoteEmpty &&
        !compare.different.length &&
        !compare.onlyLocal.length &&
        !compare.onlyRemote.length && (
          <>
            <p className="wf-soft">{SAME_STAND}</p>
            <div>
              <Button variant="primary" disabled={busy} onClick={() => void run('localWins')}>
                Fertig
              </Button>
            </div>
          </>
        )}
      {compare &&
        !compare.remoteEmpty &&
        (compare.different.length > 0 ||
          compare.onlyLocal.length > 0 ||
          compare.onlyRemote.length > 0) && (
          <>
            {(state === 'newer' || compare.older) && (
              <p className="wf-soft">
                Der Spielstand in der Ablage wurde mit einer neueren Version von Wayfarer
                geschrieben. Hier gilt deshalb nur „Der Stand aus der Ablage gilt“ – Wayfarer lädt
                von hier aus nichts hoch, bis du es aktualisiert hast.
              </p>
            )}
            <p className="wf-soft">
              In der Ablage liegt schon ein anderer Spielstand. Wayfarer mischt nie von selbst –
              sag, welcher gilt.
            </p>
            <div>
              <Button variant="primary" onClick={() => setQuestion(true)}>
                Ansehen und entscheiden
              </Button>
            </div>
          </>
        )}
      {busy && <ProgressLine progress={view.progress} />}
      {error && (
        <p className="wf-abgleich-line wf-abgleich-error" role="alert">
          {error.text}{' '}
          {error.back && (
            <Button size="sm" onClick={() => setStep(3)}>
              Zurück zu Schritt 3
            </Button>
          )}
        </p>
      )}
      {nav(stored ? null : 4, null)}
      <FirstSyncDialog
        open={question}
        info={compare}
        older={!!compare?.older || state === 'newer'}
        otherSide={{ device: found?.device ?? null, pushedAt: found?.pushedAt ?? null }}
        busy={busy}
        progress={view.progress}
        error={question && error ? error.text : ''}
        onChoose={(choice) => void run(choice)}
        onClose={() => setQuestion(false)}
      />
    </div>
  );
}
