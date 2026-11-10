/**
 * Rückfrage vor dem Austausch des gesamten Spielstands (Sicherung einspielen, alten Spielstand
 * übernehmen): zeigt, was kommt, was dafür verschwindet, und bietet an, den jetzigen Stand
 * vorher zu sichern.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download, TriangleAlert } from 'lucide-react';
import { useData, useDb } from '../../data/hooks';
import { Button, Dialog } from '../../ui';
import { backupFileName, serializeBackup, summarize, type CampaignSummary } from './backup';
import { errorText, saveBackupFile } from './files';
import { Notice } from './parts';

export function SummaryLine({ summary }: { summary: CampaignSummary }) {
  return (
    <div className="wf-einstellungen-summary">
      <div className="wf-einstellungen-summary__name">{summary.name}</div>
      <div className="wf-einstellungen-summary__date">Weltzeit {summary.worldDate} Uhr</div>
      <div className="wf-einstellungen-summary__parts">
        {summary.parts.length ? summary.parts.join(' · ') : 'Noch ohne Einträge'}
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
  /** Tauscht den Stand aus. Darf werfen; die Meldung erscheint im Dialog. */
  onConfirm: () => void;
  width?: number;
}) {
  const db = useDb();
  const data = useData();
  const current = useMemo(() => summarize(data), [data]);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSaved('');
    setError('');
  }, [open]);

  const confirm = () => {
    setError('');
    try {
      onConfirm();
    } catch (e) {
      setError(errorText(e));
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        confirm();
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
          <Button variant="danger" onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="wf-einstellungen-replace">
        <div className="wf-einstellungen-replace__pair">
          <div>
            <div className="wf-caps">Das kommt · {incomingLabel}</div>
            {incoming && <SummaryLine summary={incoming} />}
          </div>
          <div>
            <div className="wf-caps">Das verschwindet · der jetzige Stand</div>
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
          Der jetzige Stand wird vollständig ersetzt. Das lässt sich nicht zurücknehmen – außer mit einer Sicherung.
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
