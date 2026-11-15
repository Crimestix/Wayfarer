/**
 * Rückfrage vor dem Austausch des gesamten Spielstands (Sicherung einspielen, alten Spielstand
 * übernehmen): zeigt, was kommt, was dafür verschwindet, und bietet an, den jetzigen Stand
 * vorher zu sichern.
 */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download, TriangleAlert } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { Button, Dialog } from '../../ui';
import { backupFileName, serializeBackup, summarize, type CampaignSummary } from './backup';
import { errorText, saveBackupFile } from './files';
import { Notice } from './parts';

/** „6 Personen · 6 Orte · …“ – jede Angabe bleibt beim Umbruch zusammen. */
export function PartsLine({ parts }: { parts: string[] }) {
  // Der Punkt hängt fest am Teil davor; umbrochen wird nur im Leerraum danach.
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={part}>
          <span className="wf-einstellungen-part">
            {part}
            {i < parts.length - 1 && '\u00a0·'}
          </span>
          {i < parts.length - 1 && ' '}
        </Fragment>
      ))}
    </>
  );
}

export function SummaryLine({ summary }: { summary: CampaignSummary }) {
  return (
    <div className="wf-einstellungen-summary">
      <div className="wf-einstellungen-summary__name">{summary.name}</div>
      <div className="wf-einstellungen-summary__date">Weltzeit {summary.worldDate} Uhr</div>
      <div className="wf-einstellungen-summary__parts">
        {summary.parts.length ? <PartsLine parts={summary.parts} /> : 'Noch ohne Einträge'}
      </div>
    </div>
  );
}

export function ReplaceDialog({
  open,
  onClose,
  title,
  incomingLabel,
  incoming,
  children,
  confirmLabel,
  onConfirm,
  width = 720,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Woher der neue Stand kommt, z. B. „Sicherung vom 10. November 2026, 14:05 Uhr“. */
  incomingLabel: string;
  incoming: CampaignSummary | null;
  /** Bericht oder Hinweise zum neuen Stand. */
  children?: ReactNode;
  confirmLabel: string;
  /**
   * Tauscht den Stand aus. Darf werfen; die Meldung erscheint im Dialog. Ein laufender Abgleich
   * wird vorher abgewartet – solange steht „Wird vorbereitet …“ am Knopf.
   */
  onConfirm: () => void | Promise<void>;
  width?: number;
}) {
  const db = useDb();
  const data = useData();
  const current = useMemo(() => summarize(data), [data]);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSaved('');
    setError('');
  }, [open]);

  const confirm = async () => {
    if (preparing) return;
    setError('');
    try {
      const done = onConfirm();
      if (done instanceof Promise) {
        setPreparing(true);
        await done;
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPreparing(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void confirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const saveCurrent = async () => {
    setBusy(true);
    setError('');
    try {
      const where = await saveBackupFile(
        backupFileName(data.campaign.name),
        serializeBackup(db.getSnapshot()),
        db.store.location,
      );
      if (where) setSaved(where);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width={width}
      footer={
        <>
          <span className="wf-einstellungen-keyhint">Strg + Eingabe ersetzt · Esc bricht ab</span>
          <Button onClick={onClose}>Abbrechen</Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={preparing}>
            {preparing ? 'Wird vorbereitet …' : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="wf-einstellungen-replace">
        <div className="wf-einstellungen-replace__pair">
          <div>
            <div className="wf-caps">Das kommt</div>
            <div className="wf-einstellungen-summary__source">{incomingLabel}</div>
            {incoming && <SummaryLine summary={incoming} />}
          </div>
          <div>
            <div className="wf-caps">Das verschwindet</div>
            <div className="wf-einstellungen-summary__source">der jetzige Stand</div>
            <SummaryLine summary={current} />
          </div>
        </div>

        <Notice
          tone="warn"
          icon={<TriangleAlert />}
          action={
            <Button icon={<Download />} onClick={saveCurrent} disabled={busy} data-autofocus>
              Jetzigen Stand vorher sichern
            </Button>
          }
        >
          Der jetzige Stand wird vollständig ersetzt. Das lässt sich nicht zurücknehmen – außer mit
          einer Sicherung.
          {saved && <div className="wf-einstellungen-replace__saved">Gesichert: {saved}</div>}
        </Notice>

        {children}

        {error && (
          <Notice tone="danger" icon={<TriangleAlert />} title="Der Stand wurde nicht ersetzt">
            {error}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}
