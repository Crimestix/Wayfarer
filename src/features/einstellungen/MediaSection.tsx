/**
 * Bilder auf diesen Rechner holen: Kartenbilder, Porträts und Bilder der Artikel liegen danach im
 * Kampagnenordner und brauchen weder Netz noch LegendKeeper.
 */
import { useMemo, useRef, useState } from 'react';
import { Check, Download, ImageDown, TriangleAlert } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { mediaName, useLocalMediaCount, hasLocalMedia } from '../../data/media';
import { isDesktopApp } from '../../data/platform';
import { campaignImages, fetchImages, formatBytes, type FetchProgress } from '../wiki/media';
import { Button } from '../../ui';
import { ActionRow, Notice } from './parts';

/** `primary`: Der Knopf darf Messing tragen (nicht, wenn die Ansicht schon einen hat). */
export function MediaSection({ primary = true }: { primary?: boolean } = {}) {
  const db = useDb();
  const data = useData();
  const images = useMemo(() => campaignImages(data), [data]);
  // Die Zahl der Bilder auf diesem Rechner: ändert sie sich, wird neu gezählt, was fehlt.
  const localCount = useLocalMediaCount();
  const missing = useMemo(
    () => images.filter((item) => !hasLocalMedia(item.name)),
    [images, localCount],
  );
  const [progress, setProgress] = useState<FetchProgress | null>(null);
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const desktop = isDesktopApp();

  // Eingebettete Bilder (von Hand gewählte Porträts) liegen schon im Spielstand selbst.
  const embedded = useMemo(
    () => Object.values(data.entities).filter((e) => e.image && !mediaName(e.image)).length,
    [data.entities],
  );

  if (!images.length) return null;
  const have = images.length - missing.length;

  const start = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    try {
      setProgress(await fetchImages(db.store.location, images, setProgress, controller.signal));
    } finally {
      setRunning(false);
      abort.current = null;
    }
  };

  const status =
    missing.length === 0
      ? `Alle ${images.length} Bilder liegen auf diesem Rechner.`
      : have === 0
        ? `${images.length} Bilder liegen noch im Netz – keines davon auf diesem Rechner.`
        : `${have} von ${images.length} Bildern liegen auf diesem Rechner, ${missing.length} noch im Netz.`;

  return (
    <>
      <div className="wf-einstellungen-actions">
        <ActionRow
          icon={<ImageDown />}
          title="Bilder auf diesen Rechner holen"
          action={
            running ? (
              <Button onClick={() => abort.current?.abort()}>Anhalten</Button>
            ) : (
              <Button
                icon={<Download />}
                variant={missing.length && primary ? 'primary' : 'default'}
                onClick={start}
                disabled={!desktop || missing.length === 0}
              >
                {missing.length === 0
                  ? 'Alles da'
                  : `${missing.length === 1 ? '1 Bild' : `${missing.length} Bilder`} holen`}
              </Button>
            )
          }
        >
          {status} Geholte Bilder liegen im Kampagnenordner unter „media“ und werden ohne Netz
          angezeigt.
          {embedded > 0 &&
            ` ${embedded === 1 ? 'Ein von Hand gewähltes Bild steckt' : `${embedded} von Hand gewählte Bilder stecken`} ohnehin im Spielstand.`}
          {!desktop &&
            ' Das geht nur in der installierten App – die Vorschau im Browser hat keinen Ordner.'}
        </ActionRow>
      </div>

      {progress && progress.total > 0 && (
        <div className="wf-einstellungen-progress" role="status" aria-live="polite">
          <div className="wf-einstellungen-progress__bar">
            <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <span>
            {running ? 'Hole Bilder …' : progress.done < progress.total ? 'Angehalten:' : 'Fertig:'}{' '}
            {progress.done} von {progress.total}
            {progress.bytes > 0 && ` · ${formatBytes(progress.bytes)}`}
          </span>
        </div>
      )}

      {progress && !running && progress.failed.length === 0 && progress.done === progress.total && (
        <Notice icon={<Check />} title="Die Bilder liegen jetzt auf diesem Rechner">
          Wayfarer zeigt sie ab sofort aus dem Kampagnenordner. Auf einem anderen Rechner holst du
          sie dort genauso – oder du kopierst den Ordner „media“ hinüber.
        </Notice>
      )}
      {progress && !running && progress.failed.length > 0 && (
        <Notice
          tone="warn"
          icon={<TriangleAlert />}
          title={
            progress.failed.length === 1
              ? 'Ein Bild ließ sich nicht holen'
              : `${progress.failed.length} Bilder ließen sich nicht holen`
          }
          action={<Button onClick={start}>Noch einmal versuchen</Button>}
        >
          {progress.failed[0]!.reason}
          {progress.failed.length > 1 &&
            ' Bei den übrigen kann der Grund ein anderer sein; ein zweiter Versuch holt nur, was fehlt.'}
        </Notice>
      )}
    </>
  );
}
